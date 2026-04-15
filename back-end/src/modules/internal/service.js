import bcrypt from "bcryptjs"
import crypto from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId, createStationPublicId, createSupportCasePublicId } from "../common/db.js"
import { postWalletRefund } from "../common/wallets.js"
import {
  assertRefundStatusIn,
  canReopenRefundLinkedSupportCase,
  deriveRefundEvidenceCoverage,
  evaluateRefundEvidence,
  hasComplianceFalsePositiveAuditEvent,
  hasComplianceFalsePositiveDisposition,
  initialSupportRefundStatus,
  initialUserRefundStatus,
  mapLegacyRefundStatusToInvestigationStatus,
  mapLegacyRefundStatusToReviewStage,
  REFUND_INVESTIGATION_STATUSES,
  REFUND_RECOMMENDATIONS,
  REFUND_REVIEW_STAGES,
  REFUND_STATUSES,
  resolveSupportRefundApproval,
  selectUnambiguousRefundTransactionLink,
  shouldCloseLinkedSupportCaseForRefund,
} from "./refundWorkflow.js"
import {
  createPump as createStationPump,
  createPumpNozzle as createStationPumpNozzle,
  createTank as createStationTank,
  deletePump as deleteStationPump,
  deletePumpNozzle as deleteStationPumpNozzle,
  getSettingsSnapshot as getStationSettingsSnapshot,
  patchPump as patchStationPump,
  patchPumpNozzle as patchStationPumpNozzle,
  patchStaff as patchStationStaffAssignment,
  patchStation as patchStationProfile,
  patchTank as patchStationTank,
} from "../settings/settings.service.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import { INTERNAL_ROLE_CODES, normalizePermissionList } from "./permissions.js"
import {
  canActivateCompletedOnboarding,
  deriveBackfilledOnboardingStatus,
  normalizeOnboardingStatus,
} from "./onboardingRules.js"
import { appTodayISO } from "../../utils/dateTime.js"
import {
  appendSupportTicketMessage,
  listSupportTicketMessages,
  isSupportConversationOpen,
  isSupportTicketMessagesTableMissingError,
} from "../support/messages.service.js"

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : []
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase()
  const scopedTable = String(tableName || "").trim().toLowerCase()
  if (!scopedTable || !message.includes(scopedTable)) return false
  return message.includes("doesn't exist") || message.includes("does not exist") || message.includes("unknown table")
}

function wrapMissingTableError(error, message) {
  const wrapped = badRequest(message)
  wrapped.cause = error
  return wrapped
}

async function optionalRows(promise, tableName) {
  try {
    return await promise
  } catch (error) {
    if (isMissingTableError(error, tableName)) return []
    throw error
  }
}

async function optionalSingletonRow(promise, tableName, fallback = {}) {
  const rows = await optionalRows(promise, tableName)
  return rows?.[0] || fallback
}

function toCount(value) {
  const normalized = Number(value || 0)
  return Number.isFinite(normalized) ? normalized : 0
}

function toNumber(value) {
  const normalized = Number(value || 0)
  return Number.isFinite(normalized) ? normalized : 0
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeDateTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeDateOnly(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function minutesSince(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 0
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
}

function severityWeight(value) {
  switch (String(value || "").toUpperCase()) {
    case "CRITICAL":
      return 4
    case "HIGH":
      return 3
    case "WARNING":
    case "MEDIUM":
      return 2
    case "LOW":
    case "INFO":
      return 1
    default:
      return 0
  }
}

const SYSTEM_HEALTH_WARNING_PERSIST_MINUTES = 30
const SYSTEM_HEALTH_INGEST_WARNING_MINUTES = 30
const SYSTEM_HEALTH_INGEST_DEGRADED_MINUTES = 60
const SETTLEMENT_PLATFORM_FEE_RATE = 0.008
const SETTLEMENT_INTEGRITY_ALERT_ENTITY_TYPE = "SETTLEMENT_BATCH"
const SETTLEMENT_INTEGRITY_ALERT_OWNER_ROLE = INTERNAL_ROLE_CODES.FINANCE_MANAGER
const SETTLEMENT_INTEGRITY_ALERT_TITLE = "Settlement Batch Integrity Review Required"

function comparePriority(a, b) {
  const severityDelta = severityWeight(b.severity) - severityWeight(a.severity)
  if (severityDelta !== 0) return severityDelta
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
}

function calculateSettlementAmounts(grossAmount) {
  const normalizedGross = toNumber(grossAmount)
  const feeAmount = Number((normalizedGross * SETTLEMENT_PLATFORM_FEE_RATE).toFixed(2))
  const netAmount = Number((normalizedGross - feeAmount).toFixed(2))
  return {
    grossAmount: normalizedGross,
    feeAmount,
    netAmount,
  }
}

export function summarizeSettlementIntegrityTransactions(rows = []) {
  const normalizedRows = normalizeRows(rows)
  const missingUserTransactions = []
  const missingJourneyLinkTransactions = []

  for (const row of normalizedRows) {
    const transactionPublicId = String(row?.public_id || "").trim() || null
    const userId = Number(row?.user_id || 0)
    const queueEntryId = Number(row?.queue_entry_id || 0)
    const reservationPublicId = String(row?.reservation_public_id || "").trim() || null

    if (!userId) {
      missingUserTransactions.push(transactionPublicId)
      continue
    }

    if (!queueEntryId && !reservationPublicId) {
      missingJourneyLinkTransactions.push(transactionPublicId)
    }
  }

  const missingUserCount = missingUserTransactions.length
  const missingJourneyLinkCount = missingJourneyLinkTransactions.length
  const flagged = missingUserCount > 0 || missingJourneyLinkCount > 0
  const severity = missingUserCount > 0 ? "HIGH" : missingJourneyLinkCount > 0 ? "MEDIUM" : "LOW"

  const summaryParts = []
  if (missingUserCount > 0) {
    summaryParts.push(`${missingUserCount} transaction${missingUserCount === 1 ? "" : "s"} without a linked user`)
  }
  if (missingJourneyLinkCount > 0) {
    summaryParts.push(
      `${missingJourneyLinkCount} transaction${missingJourneyLinkCount === 1 ? "" : "s"} with a user but no queue or reservation link`
    )
  }

  return {
    flagged,
    severity,
    transactionCount: normalizedRows.length,
    missingUserCount,
    missingJourneyLinkCount,
    missingUserTransactionPublicIds: missingUserTransactions.slice(0, 5),
    missingJourneyLinkTransactionPublicIds: missingJourneyLinkTransactions.slice(0, 5),
    sampleTransactionPublicIds: [...missingUserTransactions, ...missingJourneyLinkTransactions]
      .filter(Boolean)
      .slice(0, 5),
    headline: flagged ? SETTLEMENT_INTEGRITY_ALERT_TITLE : "Settlement batch links look clean.",
    summary: flagged
      ? `Settlement batch includes ${summaryParts.join(" and ")}.`
      : "All reviewed transactions are linked to a user journey.",
    recommendedAction: flagged ? "Review the linked transactions before settlement approval." : null,
  }
}

export function buildAutomaticFinanceReconciliationFindings({ settlementAlerts = [] } = {}) {
  return normalizeRows(settlementAlerts)
    .map((row) => {
      const metadata = parseJsonField(row.metadata, {})
      const review = metadata?.review && typeof metadata.review === "object" ? metadata.review : null
      const batchPublicId = String(row.entity_public_id || metadata?.batchPublicId || "").trim() || null
      const stationName = String(row.station_name || metadata?.stationName || "").trim() || "Unknown station"
      const batchDate = normalizeDateOnly(metadata?.batchDate)
      const summary = batchPublicId
        ? `Settlement batch ${batchPublicId} for ${stationName} requires integrity review.`
        : `Settlement activity for ${stationName} requires integrity review.`

      const detailParts = [
        String(row.summary || "").trim(),
        batchDate ? `Batch date: ${batchDate}` : "",
        review?.missingUserCount ? `Missing user links: ${toCount(review.missingUserCount)}` : "",
        review?.missingJourneyLinkCount ? `Missing queue/reservation links: ${toCount(review.missingJourneyLinkCount)}` : "",
        Array.isArray(review?.sampleTransactionPublicIds) && review.sampleTransactionPublicIds.length
          ? `Sample transactions: ${review.sampleTransactionPublicIds.join(", ")}`
          : "",
      ].filter(Boolean)

      return {
        exceptionType: "SETTLEMENT_INTEGRITY",
        severity: String(row.severity || review?.severity || "MEDIUM").toUpperCase() || "MEDIUM",
        summary: summary.slice(0, 255),
        detail: detailParts.join("\n").trim() || null,
      }
    })
    .filter((item) => item.summary)
}

function settlementIntegrityReviewChanged(previousReview = null, nextReview = null) {
  if (!previousReview && !nextReview) return false
  if (!previousReview || !nextReview) return true
  return (
    Boolean(previousReview.flagged) !== Boolean(nextReview.flagged)
    || String(previousReview.severity || "") !== String(nextReview.severity || "")
    || toCount(previousReview.transactionCount) !== toCount(nextReview.transactionCount)
    || toCount(previousReview.missingUserCount) !== toCount(nextReview.missingUserCount)
    || toCount(previousReview.missingJourneyLinkCount) !== toCount(nextReview.missingJourneyLinkCount)
    || JSON.stringify(previousReview.sampleTransactionPublicIds || []) !== JSON.stringify(nextReview.sampleTransactionPublicIds || [])
  )
}

async function evaluateSettlementBatchIntegrity(db, { stationId, batchDate }) {
  const normalizedStationId = Number(stationId || 0)
  const normalizedBatchDate = normalizeDateOnly(batchDate)
  if (!normalizedStationId || !normalizedBatchDate) {
    return summarizeSettlementIntegrityTransactions([])
  }

  const rows = await db.$queryRaw`
    SELECT public_id, user_id, queue_entry_id, reservation_public_id
    FROM transactions
    WHERE station_id = ${normalizedStationId}
      AND DATE(occurred_at) = ${normalizedBatchDate}
      AND status NOT IN ('CANCELLED', 'REVERSED')
  `

  return summarizeSettlementIntegrityTransactions(rows)
}

async function syncSettlementIntegrityAlert(db, { batch, review, actor = null }) {
  const existingRows = await optionalRows(db.$queryRaw`
    SELECT id, public_id
    FROM dashboard_alerts
    WHERE entity_type = ${SETTLEMENT_INTEGRITY_ALERT_ENTITY_TYPE}
      AND entity_public_id = ${batch.public_id}
      AND owner_role_code = ${SETTLEMENT_INTEGRITY_ALERT_OWNER_ROLE}
      AND status = 'OPEN'
    ORDER BY created_at DESC
    LIMIT 1
  `, "dashboard_alerts")

  const existingAlert = existingRows?.[0] || null
  const metadata = JSON.stringify({
    kind: "SETTLEMENT_BATCH_INTEGRITY",
    batchPublicId: batch.public_id,
    stationPublicId: batch.station_public_id || null,
    stationName: batch.station_name || null,
    batchDate: normalizeDateOnly(batch.batch_date),
    review,
    actorUserId: Number(actor?.userId || 0) || null,
  })

  if (review.flagged) {
    if (existingAlert?.id) {
      await db.$executeRaw`
        UPDATE dashboard_alerts
        SET
          severity = ${review.severity},
          summary = ${review.summary},
          metadata = ${metadata},
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${existingAlert.id}
      `
      return existingAlert.public_id
    }

    const alertPublicId = createPublicId()
    await db.$executeRaw`
      INSERT INTO dashboard_alerts (
        public_id,
        category,
        severity,
        status,
        station_id,
        user_id,
        entity_type,
        entity_public_id,
        owner_role_code,
        title,
        summary,
        metadata
      )
      VALUES (
        ${alertPublicId},
        'FINANCE',
        ${review.severity},
        'OPEN',
        ${batch.station_id},
        ${Number(actor?.userId || 0) || null},
        ${SETTLEMENT_INTEGRITY_ALERT_ENTITY_TYPE},
        ${batch.public_id},
        ${SETTLEMENT_INTEGRITY_ALERT_OWNER_ROLE},
        ${SETTLEMENT_INTEGRITY_ALERT_TITLE},
        ${review.summary},
        ${metadata}
      )
    `
    return alertPublicId
  }

  if (existingAlert?.id) {
    await db.$executeRaw`
      UPDATE dashboard_alerts
      SET
        status = 'RESOLVED',
        resolved_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3),
        metadata = ${metadata}
      WHERE id = ${existingAlert.id}
    `
  }

  return null
}

async function syncSettlementBatchIntegrityState(db, { batch, actor = null, trigger = "SETTLEMENT_REVIEW" }) {
  const previousMetadata = parseJsonField(batch.metadata_json, {})
  const previousReview = previousMetadata?.integrityReview && typeof previousMetadata.integrityReview === "object"
    ? previousMetadata.integrityReview
    : null
  const review = await evaluateSettlementBatchIntegrity(db, {
    stationId: batch.station_id,
    batchDate: batch.batch_date,
  })
  const checkedAt = normalizeDateTime(new Date())
  const nextReview = {
    ...review,
    checkedAt,
    checkedByUserId: Number(actor?.userId || 0) || null,
    trigger,
  }

  await db.$executeRaw`
    UPDATE settlement_batches
    SET
      metadata_json = ${JSON.stringify({
        ...previousMetadata,
        integrityReview: nextReview,
      })},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${batch.id}
  `

  const alertPublicId = await syncSettlementIntegrityAlert(db, {
    batch,
    review: nextReview,
    actor,
  })

  if (
    Boolean(previousReview?.flagged) !== Boolean(nextReview.flagged)
    && (Number(actor?.userId || 0) > 0 || String(actor?.primaryRole || "").trim())
  ) {
    await createInternalAuditLog({
      actorUserId: actor?.userId || null,
      actorRoleCode: actor?.primaryRole || null,
      actionType: nextReview.flagged ? "SETTLEMENT_BATCH_AUTO_FLAGGED" : "SETTLEMENT_BATCH_FLAG_RESOLVED",
      targetType: "SETTLEMENT_BATCH",
      targetPublicId: batch.public_id,
      summary: nextReview.flagged
        ? `Settlement batch ${batch.public_id} was automatically flagged for finance integrity review.`
        : `Settlement batch ${batch.public_id} cleared automated finance integrity review.`,
      severity: nextReview.severity,
      metadata: {
        alertPublicId,
        batchDate: normalizeDateOnly(batch.batch_date),
        missingUserCount: nextReview.missingUserCount,
        missingJourneyLinkCount: nextReview.missingJourneyLinkCount,
        trigger,
      },
    })
  }

  return {
    ...nextReview,
    alertPublicId,
  }
}

const TRANSACTION_WORKFLOW_STATUSES = new Set(["RECORDED", "UNDER_REVIEW", "FROZEN", "CANCELLED", "REVERSED"])
const TRANSACTION_SETTLEMENT_IMPACT_STATUSES = new Set(["UNCHANGED", "ADJUSTED", "REVERSED"])
const FINANCE_CANCELLATION_REVIEW_ACTIONS = new Set([
  "REQUEST_CANCELLATION_REVIEW",
  "ATTACH_FINANCIAL_NOTE",
  "ESCALATE_TO_COMPLIANCE",
])
const FINANCE_TRANSACTION_ERROR_REASON_CODES = new Set([
  "DUPLICATE_PAYMENT",
  "PAYMENT_GATEWAY_FAILURE",
  "INCORRECT_TRANSACTION_CAPTURE",
])
const PRIMARY_RISK_REASON_CODES = new Set([
  "CONFIRMED_FRAUD",
  "PUMP_MANIPULATION",
  "FAKE_TRANSACTION_RECORD",
  "DUPLICATE_SYSTEM_TRANSACTION",
  "STATION_ABUSE_SMARTLINK",
])
const PLATFORM_OWNER_OVERRIDE_REASON_CODES = new Set([
  "SYSTEM_MALFUNCTION",
  "CRITICAL_FINANCIAL_INCIDENT",
  "COMPLIANCE_ESCALATION",
  "REGULATOR_REQUEST",
])
const TRANSACTION_CASE_ALLOWED_STATUSES = new Set(["OPEN", "INVESTIGATING", "FROZEN", "FRAUD_CONFIRMED", "RESOLVED"])

function getOperationalRegion(cityName) {
  const city = String(cityName || "").trim().toLowerCase()
  if (["mzuzu", "karonga", "rumphi", "nkhatabay", "nkhata bay"].includes(city.replace(/\s+/g, ""))) return "North"
  if (["lilongwe", "kasungu", "salima", "mchinji", "dedza", "ntcheu"].includes(city)) return "Central"
  if (["blantyre", "zomba", "thyolo", "mulanje", "mangochi"].includes(city)) return "South"
  return "Other"
}

const DEFAULT_ONBOARDING_CHECKLIST_KEYS = Object.freeze([
  "STATION_PROFILE",
  "STAFF_ASSIGNMENTS",
  "VERIFICATION_REQUIREMENTS",
  "PUMP_AND_NOZZLE_SETUP",
  "SUBSCRIPTION_SETUP",
])

function defaultOnboardingChecklist() {
  return Object.fromEntries(DEFAULT_ONBOARDING_CHECKLIST_KEYS.map((key) => [key, false]))
}

function normalizeOnboardingChecklistState(value) {
  const parsed = parseJsonField(value, defaultOnboardingChecklist())

  if (Array.isArray(parsed)) {
    const next = defaultOnboardingChecklist()
    parsed.forEach((item) => {
      const key = String(item || "").trim().toUpperCase()
      if (key) next[key] = false
    })
    return next
  }

  if (parsed && typeof parsed === "object") {
    const next = defaultOnboardingChecklist()
    Object.entries(parsed).forEach(([key, complete]) => {
      const normalizedKey = String(key || "").trim().toUpperCase()
      if (!normalizedKey) return
      next[normalizedKey] = Boolean(complete)
    })
    return next
  }

  return defaultOnboardingChecklist()
}

function normalizeOnboardingEvidence(value) {
  const parsed = parseJsonField(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function getPendingOnboardingChecklistItems(checklist) {
  return Object.entries(normalizeOnboardingChecklistState(checklist))
    .filter(([, complete]) => !Boolean(complete))
    .map(([key]) => key)
}

function formatOnboardingChecklistKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
}

function buildOnboardingChecklistGateMessage(pendingChecklistItems) {
  const pending = Array.isArray(pendingChecklistItems)
    ? pendingChecklistItems.map((item) => formatOnboardingChecklistKey(item)).filter(Boolean)
    : []
  if (!pending.length) return "Onboarding checklist is incomplete."
  return `Onboarding checklist is incomplete: ${pending.join(", ")}.`
}

function deriveOnboardingChecklistState({
  stationProfile,
  activeStaffCount = 0,
  pumpCount = 0,
  nozzleCount = 0,
  subscriptionRow,
  evidenceJson,
  currentChecklist,
}) {
  const next = normalizeOnboardingChecklistState(currentChecklist)
  const evidence = normalizeOnboardingEvidence(evidenceJson)
  const hasVerificationEvidence = evidence.some((item) => {
    if (!item || typeof item !== "object") return false
    const type = String(item.type || "").trim().toUpperCase()
    const url = String(item.url || "").trim()
    return Boolean(url) || ["VERIFICATION_EVIDENCE", "VISIT_REPORT", "STATION_PHOTOS"].includes(type)
  })
  const hasStationProfile = Boolean(
    String(stationProfile?.name || "").trim() &&
    String(stationProfile?.city || "").trim() &&
    String(stationProfile?.timezone || "").trim() &&
    String(stationProfile?.country_code || "").trim() &&
    (
      Boolean(Number(stationProfile?.open_24h)) ||
      (
        String(stationProfile?.opening_time || "").trim() &&
        String(stationProfile?.closing_time || "").trim()
      )
    )
  )
  const hasSubscription = Boolean(
    String(subscriptionRow?.plan_code || "").trim() &&
    String(subscriptionRow?.status || "").trim()
  )

  next.STATION_PROFILE = hasStationProfile
  next.STAFF_ASSIGNMENTS = Number(activeStaffCount || 0) > 0
  next.VERIFICATION_REQUIREMENTS = hasVerificationEvidence
  next.PUMP_AND_NOZZLE_SETUP = Number(pumpCount || 0) > 0 && Number(nozzleCount || 0) > 0
  next.SUBSCRIPTION_SETUP = hasSubscription

  return next
}

async function evaluateOnboardingChecklistState({ stationId, checklistJson, evidenceJson }) {
  const currentChecklist = normalizeOnboardingChecklistState(checklistJson)
  if (!stationId) {
    return {
      checklist: currentChecklist,
      pendingChecklistItems: getPendingOnboardingChecklistItems(currentChecklist),
    }
  }

  const [stationRows, staffCountRows, pumpSetupRows, subscriptionRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT name, city, timezone, country_code, open_24h, opening_time, closing_time
      FROM stations
      WHERE id = ${stationId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS active_staff_count
      FROM station_staff
      WHERE station_id = ${stationId}
        AND is_active = 1
    `,
    prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM pumps WHERE station_id = ${stationId}) AS pump_count,
        (SELECT COUNT(*) FROM pump_nozzles WHERE station_id = ${stationId} AND is_active = 1) AS nozzle_count
    `,
    prisma.$queryRaw`
      SELECT plan_code, status
      FROM station_subscription_statuses
      WHERE station_id = ${stationId}
      LIMIT 1
    `,
  ])

  const checklist = deriveOnboardingChecklistState({
    stationProfile: stationRows?.[0] || null,
    activeStaffCount: staffCountRows?.[0]?.active_staff_count || 0,
    pumpCount: pumpSetupRows?.[0]?.pump_count || 0,
    nozzleCount: pumpSetupRows?.[0]?.nozzle_count || 0,
    subscriptionRow: subscriptionRows?.[0] || null,
    evidenceJson,
    currentChecklist,
  })

  return {
    checklist,
    pendingChecklistItems: getPendingOnboardingChecklistItems(checklist),
  }
}

function appendNoteEntry(existingValue, entry) {
  const normalizedEntry = String(entry || "").trim()
  if (!normalizedEntry) return String(existingValue || "").trim()
  const timestamp = new Date().toISOString()
  const current = String(existingValue || "").trim()
  return current ? `${current}\n[${timestamp}] ${normalizedEntry}` : `[${timestamp}] ${normalizedEntry}`
}

function mapInternalSupportCaseTypeCode({ actorRoleCode, caseType, category }) {
  const normalizedRoleCode = String(actorRoleCode || "").trim().toUpperCase()
  const normalizedCaseType = String(caseType || "").trim().toUpperCase()
  const normalizedCategory = String(category || "").trim().toUpperCase()

  if (normalizedCategory.includes("PAYMENT") || normalizedCategory.includes("REFUND") || normalizedCategory.includes("WALLET")) {
    return "PAY"
  }

  if (
    normalizedCategory.includes("RESERVATION") ||
    normalizedCategory.includes("BOOKING") ||
    normalizedCategory === "RSV"
  ) {
    return "RSV"
  }

  if (
    normalizedCategory.includes("ACCOUNT") ||
    normalizedCategory.includes("ACCESS") ||
    normalizedCategory.includes("LOGIN") ||
    normalizedCategory.includes("AUTH")
  ) {
    return "ACC"
  }

  if (
    normalizedCategory.includes("FRAUD") ||
    normalizedCategory.includes("RISK") ||
    normalizedCategory.includes("SUSPICIOUS")
  ) {
    return "FRD"
  }

  if (normalizedCategory === "STATION_COMPLAINT") {
    return "STN"
  }

  if (normalizedCategory === "QUEUE_DISPUTE" && normalizedCaseType === "DISPUTE") {
    return "DRV"
  }

  if (normalizedRoleCode === "CUSTOMER_SUPPORT_AGENT" && normalizedCategory === "GENERAL") {
    return "DRV"
  }

  return "OPS"
}

async function notifySupportUserCaseStatus({
  supportCase,
  stationId = null,
  title,
  body,
  metadata = {},
}) {
  const userId = Number(supportCase?.user_id || 0)
  if (!Number.isFinite(userId) || userId <= 0) return null

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return null
  }

  const alert = await createUserAlert({
    userId,
    stationId: Number(stationId || supportCase?.station_id || 0) || null,
    category: "SYSTEM",
    title,
    body,
    metadata: {
      supportCasePublicId: supportCase?.public_id || null,
      sourceTicketId: supportCase?.source_ticket_id || null,
      supportStatus: supportCase?.status || null,
      path: "/m/help",
      ...(metadata || {}),
    },
  })

  publishUserAlert({
    userId,
    eventType: "user_alert:new",
    data: alert,
  })

  await sendPushAlertToUser({
    userId,
    notification: {
      title: alert.title,
      body: alert.message,
      tag: alert.publicId || `support-${Date.now()}`,
      url: "/m/help",
      icon: "/smartlogo.png",
      badge: "/smartlogo.png",
    },
    data: {
      alertPublicId: alert.publicId || null,
      supportCasePublicId: supportCase?.public_id || null,
      path: "/m/help",
      ...(metadata || {}),
    },
  }).catch(() => {
    // Push is best-effort.
  })

  return alert
}

async function notifyRefundRequestStatus({
  refund,
  title,
  body,
  metadata = {},
}) {
  const userId = Number(refund?.user_id || 0)
  if (!Number.isFinite(userId) || userId <= 0) return null

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return null
  }

  const alert = await createUserAlert({
    userId,
    stationId: Number(refund?.station_id || 0) || null,
    category: "SYSTEM",
    title,
    body,
    metadata: {
      refundPublicId: refund?.public_id || null,
      transactionPublicId: refund?.transaction_public_id || null,
      path: "/m/wallet",
      ...(metadata || {}),
    },
  })

  publishUserAlert({
    userId,
    eventType: "user_alert:new",
    data: alert,
  })

  await sendPushAlertToUser({
    userId,
    notification: {
      title: alert.title,
      body: alert.message,
      tag: alert.publicId || `refund-${Date.now()}`,
      url: "/m/wallet",
      icon: "/smartlogo.png",
      badge: "/smartlogo.png",
    },
    data: {
      alertPublicId: alert.publicId || null,
      refundPublicId: refund?.public_id || null,
      path: "/m/wallet",
      ...(metadata || {}),
    },
  }).catch(() => {
    // Push is best-effort.
  })

  return alert
}

function buildPanelOrder(primaryRole) {
  const role = String(primaryRole || "").toUpperCase()
  const defaults = [
    "needsAttention",
    "regionalOperations",
    "liveIncidents",
    "supportSnapshot",
    "financeSnapshot",
    "riskSnapshot",
    "pendingOnboarding",
    "latestAuditActivity",
    "systemHealthSummary",
    "subscriptionCommercial",
    "recentChanges",
  ]

  switch (role) {
    case "FINANCE_MANAGER":
      return [
        "needsAttention",
        "financeSnapshot",
        "subscriptionCommercial",
        "supportSnapshot",
        "regionalOperations",
        "latestAuditActivity",
        "systemHealthSummary",
        "recentChanges",
      ]
    case "NETWORK_OPERATIONS_MANAGER":
      return [
        "needsAttention",
        "regionalOperations",
        "liveIncidents",
        "systemHealthSummary",
        "riskSnapshot",
        "pendingOnboarding",
        "latestAuditActivity",
        "recentChanges",
      ]
    case "STATION_ONBOARDING_MANAGER":
      return [
        "needsAttention",
        "pendingOnboarding",
        "regionalOperations",
        "subscriptionCommercial",
        "supportSnapshot",
        "latestAuditActivity",
        "recentChanges",
      ]
    case "CUSTOMER_SUPPORT_AGENT":
      return [
        "needsAttention",
        "supportSnapshot",
        "liveIncidents",
        "regionalOperations",
        "latestAuditActivity",
        "recentChanges",
      ]
    case "RISK_COMPLIANCE_OFFICER":
      return [
        "needsAttention",
        "riskSnapshot",
        "liveIncidents",
        "latestAuditActivity",
        "systemHealthSummary",
        "recentChanges",
      ]
    case "DATA_ANALYST":
      return [
        "regionalOperations",
        "financeSnapshot",
        "subscriptionCommercial",
        "riskSnapshot",
        "systemHealthSummary",
        "recentChanges",
      ]
    case "SOFTWARE_DEVELOPER":
      return [
        "systemHealthSummary",
        "latestAuditActivity",
        "recentChanges",
      ]
    default:
      return defaults
  }
}

async function createInternalAuditLog({
  actorUserId,
  actorRoleCode,
  actionType,
  targetType,
  targetPublicId = null,
  summary,
  severity = "MEDIUM",
  metadata = {},
}) {
  await prisma.$executeRaw`
    INSERT INTO internal_audit_log (
      public_id,
      actor_user_id,
      actor_role_code,
      action_type,
      target_type,
      target_public_id,
      summary,
      severity,
      metadata
    )
    VALUES (
      ${createPublicId()},
      ${actorUserId},
      ${actorRoleCode || null},
      ${actionType},
      ${targetType},
      ${targetPublicId},
      ${summary},
      ${severity},
      ${JSON.stringify(metadata || {})}
    )
  `
}

async function getInternalSettingsMap() {
  const rows = await prisma.$queryRaw`
    SELECT setting_key, setting_value
    FROM internal_settings
  `
  return Object.fromEntries(normalizeRows(rows).map((row) => [row.setting_key, row.setting_value]))
}

async function getSupportRefundThreshold() {
  const settings = await getInternalSettingsMap()
  return toNumber(settings.support_refund_threshold_mwk || 15000)
}

async function resolveStationOrThrow(stationPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, is_active, city, operator_name, deleted_at
    FROM stations
    WHERE public_id = ${stationPublicId}
      AND deleted_at IS NULL
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  return station
}

async function resolveOnboardingRecordOrThrow(onboardingPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      sor.id,
      sor.public_id,
      sor.station_id,
      sor.status,
      sor.assigned_user_id,
      sor.checklist_json,
      sor.evidence_json,
      COALESCE(st.public_id, NULL) AS station_public_id,
      COALESCE(st.name, sor.proposed_station_name) AS station_name
    FROM station_onboarding_records sor
    LEFT JOIN stations st ON st.id = sor.station_id
    WHERE sor.public_id = ${onboardingPublicId}
    LIMIT 1
  `
  const record = rows?.[0]
  if (!record?.id) throw notFound("Onboarding record not found")
  return record
}

async function resolveFieldVisitOrThrow(fieldVisitPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      fv.id,
      fv.public_id,
      fv.station_id,
      fv.onboarding_record_id,
      fv.assigned_user_id,
      fv.visit_type,
      fv.status,
      fv.scheduled_for,
      fv.completed_at,
      fv.summary,
      fv.evidence_url,
      fv.notes,
      fv.created_at,
      fv.updated_at,
      sor.public_id AS onboarding_public_id,
      sor.checklist_json,
      sor.evidence_json,
      sor.notes AS onboarding_notes,
      COALESCE(st.public_id, NULL) AS station_public_id,
      COALESCE(st.name, sor.proposed_station_name, 'Unassigned station') AS station_name,
      COALESCE(st.city, sor.city, 'Unknown') AS station_city
    FROM field_visits fv
    LEFT JOIN station_onboarding_records sor ON sor.id = fv.onboarding_record_id
    LEFT JOIN stations st ON st.id = fv.station_id
    WHERE fv.public_id = ${fieldVisitPublicId}
    LIMIT 1
  `
  const fieldVisit = rows?.[0]
  if (!fieldVisit?.id) throw notFound("Field visit not found")
  return fieldVisit
}

async function resolveStationStaffAssignmentOrThrow({ stationId, staffId }) {
  const rows = await prisma.$queryRaw`
    SELECT
      ss.id,
      ss.station_id,
      ss.user_id,
      ss.is_active,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      sr.code AS role_code,
      sr.name AS role_name
    FROM station_staff ss
    INNER JOIN users u ON u.id = ss.user_id
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    WHERE ss.station_id = ${stationId}
      AND ss.id = ${staffId}
    LIMIT 1
  `
  const staff = rows?.[0]
  if (!staff?.id) throw notFound("Station staff assignment not found")
  return staff
}

async function resolveSupportCaseOrThrow(casePublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, source_ticket_id, subject, status, priority, resolution_notes, assigned_user_id, station_id, user_id, category
    FROM internal_support_cases
    WHERE public_id = ${casePublicId}
    LIMIT 1
  `
  const supportCase = rows?.[0]
  if (!supportCase?.id) throw notFound("Support case not found")
  return supportCase
}

async function hasClosedRefundLinkedToSupportCase(supportCaseId) {
  const scopedSupportCaseId = Number(supportCaseId || 0)
  if (!Number.isFinite(scopedSupportCaseId) || scopedSupportCaseId <= 0) return false

  const rows = await optionalRows(prisma.$queryRaw`
    SELECT review_stage, status
    FROM refund_requests
    WHERE support_case_id = ${scopedSupportCaseId}
    ORDER BY COALESCE(final_decision_at, reviewed_at, requested_at, created_at) DESC, id DESC
    LIMIT 5
  `, "refund_requests")

  return normalizeRows(rows).some((row) =>
    shouldCloseLinkedSupportCaseForRefund({
      reviewStage: row.review_stage,
      status: row.status,
    })
  )
}

async function closeLinkedSupportCaseForRefund({
  supportCaseId,
  actor,
  refundPublicId,
  resolutionNote,
}) {
  const scopedSupportCaseId = Number(supportCaseId || 0)
  if (!Number.isFinite(scopedSupportCaseId) || scopedSupportCaseId <= 0) return

  const supportCaseRows = await prisma.$queryRaw`
    SELECT id, public_id, source_ticket_id, subject, status, priority, resolution_notes, assigned_user_id, station_id, user_id, category
    FROM internal_support_cases
    WHERE id = ${scopedSupportCaseId}
    LIMIT 1
  `
  const supportCase = supportCaseRows?.[0]
  if (!supportCase?.public_id) return

  const nextResolutionNotes = appendNoteEntry(
    supportCase.resolution_notes,
    String(resolutionNote || "").trim() || `Refund ${refundPublicId} reached a closed review stage.`
  )

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET
      status = 'CLOSED',
      resolution_notes = ${nextResolutionNotes},
      resolved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${scopedSupportCaseId}
  `

  await resolveOpenSupportEscalationAlerts(supportCase.public_id, {
    closedAt: new Date().toISOString(),
    closedByRoleCode: actor?.primaryRole || null,
    closedByAction: "REFUND_CLOSE_LINKED_SUPPORT_CASE",
  })

  if (supportCase.source_ticket_id) {
    await prisma.$executeRaw`
      UPDATE support_tickets
      SET status = 'RESPONDED', updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${supportCase.source_ticket_id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor?.userId || null,
    actorRoleCode: actor?.primaryRole || null,
    actionType: "SUPPORT_CASE_CLOSE",
    targetType: "SUPPORT_CASE",
    targetPublicId: supportCase.public_id,
    summary: `Support case ${supportCase.subject} closed after refund ${refundPublicId}.`,
    severity: "MEDIUM",
    metadata: {
      refundPublicId,
      closureSource: "REFUND_WORKFLOW",
    },
  })

  if (Number(supportCase.user_id || 0) > 0) {
    await notifySupportUserCaseStatus({
      supportCase: {
        ...supportCase,
        status: "CLOSED",
      },
      title: "Support request closed",
      body: "Your linked refund review is complete, so this support case has been closed.",
      metadata: {
        supportStatus: "CLOSED",
        refundPublicId,
      },
    })
  }
}

async function resolveInternalUserOrThrow(userPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email
    FROM users
    WHERE public_id = ${userPublicId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw notFound("Internal user not found")
  return user
}

async function listActiveSupportAgents() {
  const rows = await prisma.$queryRaw`
    SELECT
      u.public_id,
      u.full_name,
      u.email
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
    INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
    WHERE u.is_active = 1
      AND ir.code = 'CUSTOMER_SUPPORT_AGENT'
    ORDER BY u.full_name ASC, u.id ASC
  `

  return normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    fullName: row.full_name,
    email: row.email || null,
  }))
}

async function listActiveRiskOfficers() {
  const rows = await prisma.$queryRaw`
    SELECT
      u.public_id,
      u.full_name,
      u.email
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
    INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
    WHERE u.is_active = 1
      AND ir.code = 'RISK_COMPLIANCE_OFFICER'
    ORDER BY u.full_name ASC, u.id ASC
  `

  return normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    fullName: row.full_name,
    email: row.email || null,
  }))
}

async function resolveDashboardAlertOrThrow(alertPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, station_id, user_id, title, summary, severity, status, entity_type, entity_public_id, owner_role_code, metadata
    FROM dashboard_alerts
    WHERE public_id = ${alertPublicId}
    LIMIT 1
  `
  const alert = rows?.[0]
  if (!alert?.id) throw notFound("Operational alert not found")
  return alert
}

async function resolveSystemHealthEventOrThrow(eventPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, service_key, environment_key, severity, status, summary, detail, source_key, created_at, resolved_at
    FROM system_health_events
    WHERE public_id = ${eventPublicId}
    LIMIT 1
  `
  const event = rows?.[0]
  if (!event?.id) throw notFound("System health event not found")
  return event
}

async function resolveSupportEscalationAlertOrThrow({ actor, alertPublicId }) {
  const normalizedPrimaryRole = String(actor?.primaryRole || "").toUpperCase()
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)
  const entityType = String(alert.entity_type || "").toUpperCase()
  const ownerRoleCode = String(alert.owner_role_code || "").toUpperCase()
  if (entityType !== "SUPPORT_CASE") throw badRequest("Alert is not a support escalation")
  if (!normalizedPrimaryRole || normalizedPrimaryRole !== ownerRoleCode) {
    throw badRequest("You are not allowed to access this escalated support case")
  }
  return alert
}

async function resolveOpenSupportEscalationAlerts(casePublicId, metadata = {}) {
  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'RESOLVED',
      updated_at = CURRENT_TIMESTAMP(3),
      metadata = JSON_MERGE_PATCH(COALESCE(metadata, JSON_OBJECT()), ${JSON.stringify(metadata || {})})
    WHERE entity_type = 'SUPPORT_CASE'
      AND entity_public_id = ${casePublicId}
      AND status = 'OPEN'
  `
}

async function resolveLatestSupportEscalationAlert(casePublicId, { ownerRoleCode = "", awaitingSupportDecision = null } = {}) {
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT public_id, owner_role_code, status, title, summary, metadata, created_at, updated_at
    FROM dashboard_alerts
    WHERE entity_type = 'SUPPORT_CASE'
      AND entity_public_id = ${casePublicId}
      AND status = 'OPEN'
    ORDER BY created_at DESC, id DESC
    LIMIT 12
  `, "dashboard_alerts")

  const scopedOwnerRoleCode = String(ownerRoleCode || "").trim().toUpperCase()
  for (const row of normalizeRows(rows)) {
    const metadata = parseJsonField(row.metadata, {})
    if (scopedOwnerRoleCode && String(row.owner_role_code || "").trim().toUpperCase() !== scopedOwnerRoleCode) continue
    if (awaitingSupportDecision !== null && Boolean(metadata.awaitingSupportDecision) !== Boolean(awaitingSupportDecision)) continue
    return {
      publicId: row.public_id,
      ownerRoleCode: row.owner_role_code || null,
      status: row.status,
      title: row.title,
      summary: row.summary,
      metadata,
      createdAt: normalizeDateTime(row.created_at),
      updatedAt: normalizeDateTime(row.updated_at),
    }
  }

  return null
}

async function resolveRefundRequestOrThrow(refundPublicId) {
  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT
        rr.id,
        rr.public_id,
        rr.station_id,
        rr.user_id,
        rr.support_case_id,
        rr.transaction_id,
        rr.amount_mwk,
        rr.priority,
        rr.status,
        rr.investigation_status,
        rr.review_stage,
        rr.reason,
        rr.refund_reason_code,
        rr.user_statement,
        rr.resolution_notes,
        rr.transaction_public_id,
        rr.wallet_transaction_reference,
        rr.requested_by_user_id,
        rr.reviewed_by_user_id,
        rr.support_reviewed_by_user_id,
        rr.finance_reviewed_by_user_id,
        rr.compliance_case_id,
        rr.requested_at,
        rr.reviewed_at,
        rr.final_decision_at,
        rr.credited_at,
        rr.created_at,
        rr.updated_at,
        support_case.public_id AS support_case_public_id,
        ticket.screenshot_url,
        customer.public_id AS user_public_id,
        customer.full_name AS user_name
      FROM refund_requests rr
      LEFT JOIN internal_support_cases support_case ON support_case.id = rr.support_case_id
      LEFT JOIN support_tickets ticket ON ticket.id = support_case.source_ticket_id
      LEFT JOIN users customer ON customer.id = rr.user_id
      WHERE rr.public_id = ${refundPublicId}
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error, "refund_requests")) {
      throw wrapMissingTableError(
        error,
        "Internal refund review storage is unavailable. Run SQL migration 027_internal_dashboard_expansion.sql."
      )
    }
    throw error
  }
  const refund = rows?.[0]
  if (!refund?.id) throw notFound("Refund request not found")
  refund.investigation_status =
    String(refund.investigation_status || "").trim().toUpperCase() ||
    mapLegacyRefundStatusToInvestigationStatus(refund.status)
  refund.review_stage =
    String(refund.review_stage || "").trim().toUpperCase() ||
    mapLegacyRefundStatusToReviewStage(refund.status)
  refund.requested_at = refund.requested_at || refund.created_at || null
  return refund
}

async function createRefundReviewRecord({
  refundId,
  reviewerUserId,
  reviewerRole,
  decision,
  notes = "",
}) {
  await prisma.$executeRaw`
    INSERT INTO refund_reviews (
      public_id,
      refund_request_id,
      reviewer_user_id,
      reviewer_role,
      decision,
      notes
    )
    VALUES (
      ${createPublicId()},
      ${refundId},
      ${reviewerUserId},
      ${reviewerRole || null},
      ${decision},
      ${String(notes || "").trim() || null}
    )
  `
}

async function upsertRefundEvidenceRecord({
  refundId,
  evidenceType,
  sourceType,
  sourceId = "",
  summary,
  confidenceWeight = null,
  attachedByUserId,
  metadata = null,
}) {
  const normalizedSourceId = String(sourceId || "").trim()
  await prisma.$executeRaw`
    INSERT INTO refund_evidence (
      public_id,
      refund_request_id,
      evidence_type,
      source_type,
      source_id,
      summary,
      confidence_weight,
      attached_by_user_id,
      metadata_json
    )
    VALUES (
      ${createPublicId()},
      ${refundId},
      ${evidenceType},
      ${sourceType},
      ${normalizedSourceId || null},
      ${summary},
      ${confidenceWeight},
      ${attachedByUserId},
      ${metadata ? JSON.stringify(metadata) : null}
    )
    ON DUPLICATE KEY UPDATE
      summary = VALUES(summary),
      confidence_weight = VALUES(confidence_weight),
      metadata_json = VALUES(metadata_json),
      updated_at = CURRENT_TIMESTAMP(3)
  `
}

async function listRefundEvidenceRows(refundId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      re.public_id,
      re.evidence_type,
      re.source_type,
      re.source_id,
      re.summary,
      re.confidence_weight,
      re.metadata_json,
      re.created_at,
      u.public_id AS attached_by_public_id,
      u.full_name AS attached_by_name
    FROM refund_evidence re
    INNER JOIN users u ON u.id = re.attached_by_user_id
    WHERE re.refund_request_id = ${refundId}
    ORDER BY re.created_at ASC, re.id ASC
  `, "refund_evidence")
}

async function listRefundReviewRows(refundId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      rrv.public_id,
      rrv.reviewer_role,
      rrv.decision,
      rrv.notes,
      rrv.created_at,
      u.public_id AS reviewer_public_id,
      u.full_name AS reviewer_name
    FROM refund_reviews rrv
    INNER JOIN users u ON u.id = rrv.reviewer_user_id
    WHERE rrv.refund_request_id = ${refundId}
    ORDER BY rrv.created_at ASC, rrv.id ASC
  `, "refund_reviews")
}

async function resolveTransactionRow({ transactionPublicId = "", transactionId = 0 }) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  const normalizedTransactionId = Number(transactionId || 0)
  const rows = await prisma.$queryRaw`
    SELECT
      tx.id,
      tx.public_id,
      tx.station_id,
      tx.user_id,
      tx.pump_id,
      tx.nozzle_id,
      tx.queue_entry_id,
      tx.reservation_public_id,
      tx.payment_reference,
      tx.total_amount,
      tx.requested_litres,
      tx.litres,
      tx.payment_method,
      tx.occurred_at,
      tx.authorized_at,
      tx.dispensed_at,
      tx.settled_at,
      tx.status,
      tx.settlement_impact_status,
      tx.workflow_reason_code,
      tx.workflow_note,
      tx.status_updated_at,
      tx.status_updated_by_role_code,
      tx.cancelled_at,
      st.public_id AS station_public_id,
      st.name AS station_name,
      ft.code AS fuel_type_code,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      qe.public_id AS queue_entry_public_id,
      qe.position AS queue_position,
      qe.status AS queue_status
    FROM transactions tx
    INNER JOIN stations st ON st.id = tx.station_id
    LEFT JOIN fuel_types ft ON ft.id = tx.fuel_type_id
    LEFT JOIN pumps p ON p.id = tx.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
    LEFT JOIN queue_entries qe ON qe.id = tx.queue_entry_id
    WHERE (
      (${scopedTransactionPublicId} <> '' AND tx.public_id = ${scopedTransactionPublicId})
      OR (${normalizedTransactionId} > 0 AND tx.id = ${normalizedTransactionId})
    )
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveTransactionOrThrow(transactionPublicId) {
  const transaction = await resolveTransactionRow({ transactionPublicId })
  if (!transaction?.id) throw notFound("Transaction not found")
  return transaction
}

async function resolveTransactionById(transactionId) {
  const transaction = await resolveTransactionRow({ transactionId })
  if (!transaction?.id) throw notFound("Transaction not found")
  return transaction
}

async function resolveQueueEntryContext(queueEntryId) {
  if (!Number(queueEntryId)) return null
  const rows = await prisma.$queryRaw`
    SELECT
      qe.id,
      qe.public_id,
      qe.position,
      qe.status,
      qe.joined_at,
      qe.called_at,
      qe.served_at,
      qe.metadata,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM queue_entries qe
    INNER JOIN stations st ON st.id = qe.station_id
    WHERE qe.id = ${queueEntryId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) return null
  const metadata = parseJsonField(row.metadata, {})
  return {
    publicId: row.public_id,
    position: toCount(row.position),
    status: row.status,
    joinedAt: normalizeDateTime(row.joined_at),
    calledAt: normalizeDateTime(row.called_at),
    servedAt: normalizeDateTime(row.served_at),
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    metadata,
    qrValidation: metadata?.lastPumpScan
      ? {
          type: "PUMP_QR_SCAN",
          pumpPublicId: String(metadata.lastPumpScan.pumpPublicId || "").trim() || null,
          pumpNumber: Number(metadata.lastPumpScan.pumpNumber || 0) || null,
          scannedAt: normalizeDateTime(metadata.lastPumpScan.scannedAt),
        }
      : null,
  }
}

async function resolveReservationContext(reservationPublicId) {
  const scopedReservationPublicId = String(reservationPublicId || "").trim()
  if (!scopedReservationPublicId) return null
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      ur.id,
      ur.public_id,
      ur.status,
      ur.requested_litres,
      ur.slot_start,
      ur.slot_end,
      ur.confirmed_at,
      ur.check_in_time,
      ur.fulfilled_at,
      ur.metadata,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM user_reservations ur
    INNER JOIN stations st ON st.id = ur.station_id
    WHERE ur.public_id = ${scopedReservationPublicId}
    LIMIT 1
  `, "user_reservations")
  const row = rows?.[0]
  if (!row?.id) return null
  const metadata = parseJsonField(row.metadata, {})
  return {
    publicId: row.public_id,
    status: row.status,
    requestedLitres: toNumber(row.requested_litres),
    slotStart: normalizeDateTime(row.slot_start),
    slotEnd: normalizeDateTime(row.slot_end),
    confirmedAt: normalizeDateTime(row.confirmed_at),
    checkInTime: normalizeDateTime(row.check_in_time),
    fulfilledAt: normalizeDateTime(row.fulfilled_at),
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    metadata,
    qrValidation: String(metadata?.checkInMethod || "").trim().toUpperCase() === "QR"
      ? {
          type: "RESERVATION_QR_CHECK_IN",
          checkedInAt: normalizeDateTime(metadata.checkInAt || row.check_in_time),
        }
      : null,
  }
}

async function resolveRefundPaymentRecord({ transactionPublicId, reservationPublicId = "" }) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  const scopedReservationPublicId = String(reservationPublicId || "").trim()
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      lt.id,
      lt.transaction_reference,
      lt.external_reference,
      lt.transaction_type,
      lt.transaction_status,
      lt.net_amount,
      lt.gross_amount,
      lt.description,
      lt.related_entity_type,
      lt.related_entity_id,
      lt.metadata_json,
      lt.created_at,
      lt.posted_at
    FROM ledger_transactions lt
    WHERE (
      (${scopedTransactionPublicId} <> '' AND lt.external_reference = ${scopedTransactionPublicId})
      OR (${scopedTransactionPublicId} <> '' AND JSON_UNQUOTE(JSON_EXTRACT(COALESCE(lt.metadata_json, JSON_OBJECT()), '$.transactionPublicId')) = ${scopedTransactionPublicId})
      OR (${scopedReservationPublicId} <> '' AND lt.related_entity_id = ${scopedReservationPublicId})
    )
    ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
    LIMIT 1
  `, "ledger_transactions")
  const row = rows?.[0]
  if (!row?.id) return null
  return {
    transactionReference: row.transaction_reference,
    externalReference: row.external_reference || null,
    transactionType: row.transaction_type,
    transactionStatus: row.transaction_status,
    netAmount: toNumber(row.net_amount),
    grossAmount: toNumber(row.gross_amount),
    description: row.description || null,
    relatedEntityType: row.related_entity_type || null,
    relatedEntityId: row.related_entity_id || null,
    metadata: parseJsonField(row.metadata_json, {}),
    createdAt: normalizeDateTime(row.created_at),
    postedAt: normalizeDateTime(row.posted_at),
  }
}

function inferRefundPaymentRecordFromTransaction(transaction) {
  if (!transaction) return null

  const paymentReference = String(transaction?.payment_reference || transaction?.paymentReference || "").trim()
  if (!paymentReference) return null

  const transactionStatus = String(transaction?.status || "").trim().toUpperCase()
  if (["CANCELLED", "REVERSED"].includes(transactionStatus)) return null

  const paymentMethod = String(transaction?.payment_method || transaction?.paymentMethod || "").trim().toUpperCase()
  const occurredAt =
    normalizeDateTime(transaction?.settled_at || transaction?.settledAt)
    || normalizeDateTime(transaction?.dispensed_at || transaction?.dispensedAt)
    || normalizeDateTime(transaction?.occurred_at || transaction?.occurredAt)
    || null

  return {
    transactionReference: paymentReference,
    externalReference: String(transaction?.public_id || transaction?.publicId || "").trim() || null,
    transactionType: "TRANSACTION_PAYMENT_REFERENCE",
    transactionStatus: "POSTED",
    netAmount: toNumber(transaction?.total_amount || transaction?.amountMwk),
    grossAmount: toNumber(transaction?.total_amount || transaction?.amountMwk),
    description: `Payment reference ${paymentReference} recorded on transaction ${transaction?.public_id || transaction?.publicId || ""}.`.trim(),
    relatedEntityType: "TRANSACTION",
    relatedEntityId: String(transaction?.public_id || transaction?.publicId || "").trim() || null,
    metadata: {
      inferredFromTransaction: true,
      paymentMethod: paymentMethod || null,
    },
    createdAt: occurredAt,
    postedAt: occurredAt,
  }
}

function resolveEffectiveRefundPaymentRecord({ transaction = null, paymentRecord = null }) {
  const normalizedPaymentStatus = String(paymentRecord?.transactionStatus || "").trim().toUpperCase()
  if (normalizedPaymentStatus === "POSTED") {
    return paymentRecord
  }

  const inferredRecord = inferRefundPaymentRecordFromTransaction(transaction)
  if (inferredRecord) {
    return inferredRecord
  }

  return paymentRecord
}

function mapPumpSessionRow(row) {
  if (!row?.id) return null
  return {
    id: row.id,
    publicId: row.public_id,
    sessionReference: row.session_reference,
    status: row.session_status,
    startTime: normalizeDateTime(row.start_time),
    endTime: normalizeDateTime(row.end_time),
    durationSeconds: Number(row.dispense_duration_seconds || 0) || null,
    dispensedLitres: toNumber(row.dispensed_litres),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    telemetryCorrelationId: row.telemetry_correlation_id || null,
    pumpPublicId: row.pump_public_id || null,
    pumpNumber: Number(row.pump_number || 0) || null,
    nozzlePublicId: row.nozzle_public_id || null,
    nozzleNumber: String(row.nozzle_number || "").trim() || null,
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
  }
}

async function resolvePumpSessionForTransaction({
  transactionId = 0,
  transaction = null,
  telemetryCorrelationId = "",
} = {}) {
  const normalizedTransactionId = Number(transactionId || transaction?.id || 0)
  const scopedTelemetryCorrelationId = String(
    telemetryCorrelationId || transaction?.telemetry_correlation_id || transaction?.telemetryCorrelationId || ""
  ).trim()
  const stationId = Number(transaction?.station_id || transaction?.stationId || 0)
  const pumpId = Number(transaction?.pump_id || transaction?.pumpId || 0)
  const nozzleId = Number(transaction?.nozzle_id || transaction?.nozzleId || 0)
  const sessionAnchorTime =
    transaction?.dispensed_at
    || transaction?.dispensedAt
    || transaction?.settled_at
    || transaction?.settledAt
    || transaction?.authorized_at
    || transaction?.authorizedAt
    || transaction?.occurred_at
    || transaction?.occurredAt
    || null

  if (!normalizedTransactionId && !scopedTelemetryCorrelationId && !stationId) return null
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispense_duration_seconds,
      ps.dispensed_litres,
      ps.error_code,
      ps.error_message,
      ps.telemetry_correlation_id,
      ps.created_at,
      ps.updated_at,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    WHERE (
      (${normalizedTransactionId} > 0 AND ps.transaction_id = ${normalizedTransactionId})
      OR (${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId})
      OR (
        ${stationId} > 0
        AND ps.station_id = ${stationId}
        AND (${pumpId} = 0 OR ps.pump_id = ${pumpId})
        AND (${nozzleId} = 0 OR ps.nozzle_id = ${nozzleId})
        AND (
          ${sessionAnchorTime} IS NULL
          OR COALESCE(ps.end_time, ps.updated_at, ps.created_at) >= DATE_SUB(${sessionAnchorTime}, INTERVAL 30 MINUTE)
        )
        AND (
          ${sessionAnchorTime} IS NULL
          OR COALESCE(ps.start_time, ps.created_at) <= DATE_ADD(${sessionAnchorTime}, INTERVAL 30 MINUTE)
        )
      )
    )
    ORDER BY
      CASE
        WHEN ${normalizedTransactionId} > 0 AND ps.transaction_id = ${normalizedTransactionId} THEN 0
        WHEN ${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId} THEN 1
        ELSE 2
      END,
      ps.created_at DESC,
      ps.id DESC
    LIMIT 1
  `, "pump_sessions")
  return mapPumpSessionRow(rows?.[0])
}

async function listPumpTelemetryTimeline({ pumpSession, transaction }) {
  if (!pumpSession && !transaction) return []
  const startTime = pumpSession?.startTime || transaction?.authorized_at || transaction?.occurred_at || transaction?.occurredAt || null
  const endTime = pumpSession?.endTime || transaction?.dispensed_at || transaction?.settled_at || transaction?.occurred_at || transaction?.occurredAt || null
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      ptl.public_id,
      ptl.event_type,
      ptl.severity,
      ptl.litres_value,
      ptl.flow_rate,
      ptl.raw_error_code,
      ptl.message,
      ptl.payload_json,
      ptl.source_type,
      ptl.happened_at,
      ptl.ingested_at
    FROM pump_telemetry_logs ptl
    WHERE (
      (${Number(pumpSession?.id || 0)} > 0 AND ptl.pump_session_id = ${Number(pumpSession?.id || 0)})
      OR (${String(pumpSession?.telemetryCorrelationId || "")} <> '' AND ptl.telemetry_correlation_id = ${String(pumpSession?.telemetryCorrelationId || "")})
      OR (
        ${Number(transaction?.station_id || transaction?.stationId || 0)} > 0
        AND ptl.station_id = ${Number(transaction?.station_id || transaction?.stationId || 0)}
        AND (${Number(transaction?.pump_id || transaction?.pumpId || 0)} = 0 OR ptl.pump_id = ${Number(transaction?.pump_id || transaction?.pumpId || 0)})
        AND (${Number(transaction?.nozzle_id || transaction?.nozzleId || 0)} = 0 OR ptl.nozzle_id = ${Number(transaction?.nozzle_id || transaction?.nozzleId || 0)})
        AND (${startTime} IS NULL OR ptl.happened_at >= DATE_SUB(${startTime}, INTERVAL 10 MINUTE))
        AND (${endTime} IS NULL OR ptl.happened_at <= DATE_ADD(${endTime}, INTERVAL 20 MINUTE))
      )
    )
    ORDER BY ptl.happened_at ASC, ptl.id ASC
  `, "pump_telemetry_logs")

  const items = normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    eventType: row.event_type,
    severity: row.severity,
    litresValue: row.litres_value === null ? null : toNumber(row.litres_value),
    flowRate: row.flow_rate === null ? null : toNumber(row.flow_rate),
    rawErrorCode: row.raw_error_code || null,
    message: row.message || null,
    payload: parseJsonField(row.payload_json, {}),
    sourceType: row.source_type || null,
    happenedAt: normalizeDateTime(row.happened_at),
    ingestedAt: normalizeDateTime(row.ingested_at),
  }))

  if (items.length) return items
  if (!startTime) return items

  return [
    {
      publicId: null,
      eventType: "TELEMETRY_MISSING",
      severity: "HIGH",
      litresValue: null,
      flowRate: null,
      rawErrorCode: null,
      message: "No telemetry events were ingested for the correlated pump session window.",
      payload: {},
      sourceType: "SYSTEM",
      happenedAt: normalizeDateTime(startTime),
      ingestedAt: normalizeDateTime(startTime),
    },
  ]
}

async function listRefundAuditTrail({ refundPublicId, transactionPublicId = "", complianceCasePublicId = "" }) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  const scopedComplianceCasePublicId = String(complianceCasePublicId || "").trim()
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      ial.public_id,
      ial.action_type,
      ial.target_type,
      ial.target_public_id,
      ial.summary,
      ial.severity,
      ial.metadata,
      ial.created_at,
      u.full_name AS actor_name
    FROM internal_audit_log ial
    LEFT JOIN users u ON u.id = ial.actor_user_id
    WHERE (ial.target_type = 'REFUND_REQUEST' AND ial.target_public_id = ${refundPublicId})
       OR (${scopedTransactionPublicId} <> '' AND ial.target_type = 'TRANSACTION' AND ial.target_public_id = ${scopedTransactionPublicId})
       OR (${scopedComplianceCasePublicId} <> '' AND ial.target_type = 'COMPLIANCE_CASE' AND ial.target_public_id = ${scopedComplianceCasePublicId})
    ORDER BY ial.created_at ASC, ial.id ASC
  `, "internal_audit_log")

  return normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    summary: row.summary,
    severity: row.severity,
    actorName: row.actor_name || null,
    metadata: parseJsonField(row.metadata, {}),
    createdAt: normalizeDateTime(row.created_at),
  }))
}

async function resolveRefundRiskSignals({ refund, transaction, telemetryTimeline }) {
  const [repeatRows, stationRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS count
      FROM refund_requests
      WHERE user_id = ${refund.user_id || 0}
        AND public_id <> ${refund.public_id}
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 DAY)
        AND status <> 'REJECTED'
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS count
      FROM refund_requests
      WHERE station_id = ${refund.station_id || transaction?.station_id || 0}
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
  ])

  const repeatedRefundAttempts = toCount(repeatRows?.[0]?.count)
  const stationRefundCount = toCount(stationRows?.[0]?.count)
  const telemetryErrorCount = telemetryTimeline.filter((item) => ["ERROR", "TIMEOUT", "TELEMETRY_MISSING"].includes(String(item.eventType || "").toUpperCase())).length
  const telemetryDispenseEventCount = telemetryTimeline.filter((item) =>
    ["DISPENSING_STARTED", "FLOW_READING", "DISPENSING_STOPPED"].includes(String(item.eventType || "").toUpperCase())
  ).length
  const telemetryMissing = telemetryTimeline.some((item) => String(item.eventType || "").toUpperCase() === "TELEMETRY_MISSING")
  const conflictingTelemetry =
    telemetryErrorCount > 0 &&
    (telemetryDispenseEventCount > 0 || telemetryTimeline.some((item) => toNumber(item.litresValue) > 0))

  return {
    repeatedRefundAttempts,
    stationRefundRateAbnormal: stationRefundCount >= 5,
    telemetryErrorCount,
    telemetryDispenseEventCount,
    telemetryMissing,
    conflictingTelemetry,
  }
}

async function syncDerivedRefundEvidence({ refund, actorUserId, transaction, paymentRecord, pumpSession, telemetryTimeline, queueContext, reservationContext, auditTrail }) {
  const derivedEvidence = []

  if (transaction?.public_id || transaction?.publicId) {
    derivedEvidence.push({
      evidenceType: "TRANSACTION_RECORD",
      sourceType: "TRANSACTION",
      sourceId: transaction.public_id || transaction.publicId,
      summary: `Transaction ${transaction.public_id || transaction.publicId} links the user, station, pump, and payment context.`,
      confidenceWeight: 1,
      metadata: { status: transaction.status || null },
    })
  }

  if (paymentRecord?.transactionReference) {
    derivedEvidence.push({
      evidenceType: "PAYMENT_RECORD",
      sourceType: paymentRecord?.metadata?.inferredFromTransaction ? "TRANSACTION" : "LEDGER_TRANSACTION",
      sourceId: paymentRecord.transactionReference,
      summary: `Payment record ${paymentRecord.transactionReference} confirms captured value for the refund claim.`,
      confidenceWeight: 0.95,
      metadata: { transactionStatus: paymentRecord.transactionStatus || null },
    })
  }

  if (pumpSession?.sessionReference) {
    derivedEvidence.push({
      evidenceType: "PUMP_SESSION",
      sourceType: "PUMP_SESSION",
      sourceId: pumpSession.sessionReference,
      summary: `Pump session ${pumpSession.sessionReference} summarizes the physical fueling outcome.`,
      confidenceWeight: 0.95,
      metadata: { sessionStatus: pumpSession.status || null, dispensedLitres: pumpSession.dispensedLitres },
    })
  }

  if (queueContext?.publicId) {
    derivedEvidence.push({
      evidenceType: "QUEUE_ADMISSION",
      sourceType: "QUEUE_ENTRY",
      sourceId: queueContext.publicId,
      summary: `Queue entry ${queueContext.publicId} proves the user was admitted to the station workflow.`,
      confidenceWeight: 0.75,
      metadata: { status: queueContext.status || null, position: queueContext.position },
    })
  }

  if (reservationContext?.publicId) {
    derivedEvidence.push({
      evidenceType: "RESERVATION_LINK",
      sourceType: "RESERVATION",
      sourceId: reservationContext.publicId,
      summary: `Reservation ${reservationContext.publicId} links the refund to a booked fueling slot.`,
      confidenceWeight: 0.75,
      metadata: { status: reservationContext.status || null, requestedLitres: reservationContext.requestedLitres },
    })
  }

  const qrValidation = queueContext?.qrValidation || reservationContext?.qrValidation || null
  if (qrValidation) {
    derivedEvidence.push({
      evidenceType: "QR_VALIDATION",
      sourceType: qrValidation.type,
      sourceId: qrValidation.pumpPublicId || reservationContext?.publicId || queueContext?.publicId || "",
      summary: "QR validation evidence confirms the user reached the authorized fueling step before the refund claim.",
      confidenceWeight: 0.7,
      metadata: qrValidation,
    })
  }

  const firstTelemetryError = telemetryTimeline.find((item) => ["ERROR", "TIMEOUT", "TELEMETRY_MISSING"].includes(String(item.eventType || "").toUpperCase()))
  if (firstTelemetryError) {
    derivedEvidence.push({
      evidenceType: "TELEMETRY_ERROR",
      sourceType: "PUMP_TELEMETRY",
      sourceId: firstTelemetryError.publicId || pumpSession?.sessionReference || refund.public_id,
      summary: firstTelemetryError.message || "Telemetry captured an error or missing-ingest condition during the session window.",
      confidenceWeight: 0.9,
      metadata: { eventType: firstTelemetryError.eventType, rawErrorCode: firstTelemetryError.rawErrorCode || null },
    })
  }

  const dispenseProof = telemetryTimeline.find((item) =>
    ["DISPENSING_STARTED", "FLOW_READING", "DISPENSING_STOPPED"].includes(String(item.eventType || "").toUpperCase())
  )
  if (dispenseProof) {
    derivedEvidence.push({
      evidenceType: "TELEMETRY_DISPENSE_PROOF",
      sourceType: "PUMP_TELEMETRY",
      sourceId: dispenseProof.publicId || pumpSession?.sessionReference || refund.public_id,
      summary: "Telemetry confirms dispensing activity occurred during the disputed session.",
      confidenceWeight: 0.95,
      metadata: { eventType: dispenseProof.eventType, litresValue: dispenseProof.litresValue },
    })
  }

  const firstAuditEvent = auditTrail[0]
  if (firstAuditEvent?.publicId) {
    derivedEvidence.push({
      evidenceType: "AUDIT_EVENT",
      sourceType: "INTERNAL_AUDIT",
      sourceId: firstAuditEvent.publicId,
      summary: `Audit trail includes ${auditTrail.length} refund-related workflow events.`,
      confidenceWeight: 0.6,
      metadata: { firstActionType: firstAuditEvent.actionType, eventCount: auditTrail.length },
    })
  }

  await Promise.all(
    derivedEvidence.map((item) =>
      upsertRefundEvidenceRecord({
        refundId: refund.id,
        evidenceType: item.evidenceType,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        summary: item.summary,
        confidenceWeight: item.confidenceWeight,
        attachedByUserId: actorUserId,
        metadata: item.metadata,
      })
    )
  )
}

async function buildRefundInvestigationBundle({ actor, refundPublicId }) {
  const refund = await resolveRefundRequestOrThrow(refundPublicId)
  const transaction = refund.transaction_public_id
    ? await resolveTransactionOrThrow(refund.transaction_public_id).catch(() => null)
    : Number(refund.transaction_id || 0) > 0
      ? await resolveTransactionById(refund.transaction_id).catch(() => null)
      : null
  const reservationPublicId = transaction?.reservation_public_id || refund.transaction_public_id || ""
  const [queueContext, reservationContext, paymentRecord, pumpSession] = await Promise.all([
    resolveQueueEntryContext(transaction?.queue_entry_id || 0),
    resolveReservationContext(transaction?.reservation_public_id || ""),
    resolveRefundPaymentRecord({
      transactionPublicId: transaction?.public_id || refund.transaction_public_id || "",
      reservationPublicId: transaction?.reservation_public_id || "",
    }),
    resolvePumpSessionForTransaction({
      transactionId: transaction?.id || refund.transaction_id || 0,
      transaction,
    }),
  ])
  const effectivePaymentRecord = resolveEffectiveRefundPaymentRecord({
    transaction,
    paymentRecord,
  })
  const telemetryTimeline = await listPumpTelemetryTimeline({ pumpSession, transaction })
  const riskSignals = await resolveRefundRiskSignals({ refund, transaction, telemetryTimeline })
  const assessment = evaluateRefundEvidence({
    paymentCaptured: String(effectivePaymentRecord?.transactionStatus || "").toUpperCase() === "POSTED",
    sessionStatus: pumpSession?.status || "",
    dispensedLitres: pumpSession?.dispensedLitres ?? transaction?.litres ?? 0,
    ...riskSignals,
  })

  const complianceCase = refund.compliance_case_id
    ? (await prisma.$queryRaw`
        SELECT public_id, status, action_taken
        FROM compliance_cases
        WHERE id = ${refund.compliance_case_id}
        LIMIT 1
      `)?.[0] || null
    : null
  const complianceCasePublicId = complianceCase?.public_id || null
  const auditTrail = await listRefundAuditTrail({
    refundPublicId,
    transactionPublicId: transaction?.public_id || refund.transaction_public_id || "",
    complianceCasePublicId,
  })
  const complianceMarkedFalsePositive =
    hasComplianceFalsePositiveDisposition(complianceCase)
    || hasComplianceFalsePositiveAuditEvent(auditTrail)

  await syncDerivedRefundEvidence({
    refund,
    actorUserId: actor.userId,
    transaction,
    paymentRecord: effectivePaymentRecord,
    pumpSession,
    telemetryTimeline,
    queueContext,
    reservationContext,
    auditTrail,
  })

  const [evidenceRows, reviewRows] = await Promise.all([
    listRefundEvidenceRows(refund.id),
    listRefundReviewRows(refund.id),
  ])

  return {
    refund: {
      publicId: refund.public_id,
      userPublicId: refund.user_public_id || null,
      userName: refund.user_name || null,
      legacyStatus: refund.status,
      investigationStatus: refund.investigation_status,
      reviewStage: refund.review_stage,
      amountMwk: toNumber(refund.amount_mwk),
      priority: refund.priority,
      reason: refund.reason,
      refundReasonCode: refund.refund_reason_code || null,
      userStatement: refund.user_statement || null,
      resolutionNotes: refund.resolution_notes || null,
      supportCasePublicId: refund.support_case_public_id || null,
      transactionPublicId: refund.transaction_public_id || null,
      walletTransactionReference: refund.wallet_transaction_reference || null,
      requestedAt: normalizeDateTime(refund.requested_at),
      reviewedAt: normalizeDateTime(refund.reviewed_at),
      finalDecisionAt: normalizeDateTime(refund.final_decision_at),
      creditedAt: normalizeDateTime(refund.credited_at),
      complianceCasePublicId,
      complianceCaseStatus: complianceCase?.status || null,
      complianceCaseActionTaken: complianceCase?.action_taken || null,
      complianceMarkedFalsePositive,
      recommendation: assessment.recommendation,
    },
    complianceCase: complianceCase
      ? {
          publicId: complianceCasePublicId,
          status: complianceCase.status || null,
          actionTaken: complianceCase.action_taken || null,
          markedFalsePositive: complianceMarkedFalsePositive,
        }
      : null,
    transaction: transaction
      ? {
          publicId: transaction.public_id,
          stationPublicId: transaction.station_public_id,
          stationName: transaction.station_name,
          amountMwk: toNumber(transaction.total_amount),
          paymentReference: transaction.payment_reference || null,
          paymentMethod: transaction.payment_method,
          fuelType: transaction.fuel_type_code || null,
          requestedLitres: toNumber(transaction.requested_litres),
          dispensedLitres: toNumber(transaction.litres),
          status: transaction.status,
          settlementImpactStatus: transaction.settlement_impact_status,
          reservationPublicId: transaction.reservation_public_id || null,
          queueEntryPublicId: transaction.queue_entry_public_id || null,
          pumpPublicId: transaction.pump_public_id || null,
          pumpNumber: Number(transaction.pump_number || 0) || null,
          nozzlePublicId: transaction.nozzle_public_id || null,
          nozzleNumber: String(transaction.nozzle_number || "").trim() || null,
          occurredAt: normalizeDateTime(transaction.occurred_at),
          authorizedAt: normalizeDateTime(transaction.authorized_at),
          dispensedAt: normalizeDateTime(transaction.dispensed_at),
          settledAt: normalizeDateTime(transaction.settled_at),
          workflowReasonCode: transaction.workflow_reason_code || null,
          workflowNote: transaction.workflow_note || null,
        }
      : null,
    paymentRecord: effectivePaymentRecord,
    pumpSession,
    telemetryTimeline,
    context: {
      queue: queueContext
        ? {
            publicId: queueContext.publicId,
            status: queueContext.status,
            position: queueContext.position,
            joinedAt: queueContext.joinedAt,
            calledAt: queueContext.calledAt,
            servedAt: queueContext.servedAt,
          }
        : null,
      reservation: reservationContext
        ? {
            publicId: reservationContext.publicId,
            status: reservationContext.status,
            requestedLitres: reservationContext.requestedLitres,
            slotStart: reservationContext.slotStart,
            slotEnd: reservationContext.slotEnd,
            checkInTime: reservationContext.checkInTime,
          }
        : null,
      qrValidation: queueContext?.qrValidation || reservationContext?.qrValidation || null,
    },
    evidenceBundle: normalizeRows(evidenceRows).map((row) => ({
      publicId: row.public_id,
      evidenceType: row.evidence_type,
      sourceType: row.source_type,
      sourceId: row.source_id || null,
      summary: row.summary,
      confidenceWeight: row.confidence_weight === null ? null : toNumber(row.confidence_weight),
      metadata: parseJsonField(row.metadata_json, {}),
      attachedByPublicId: row.attached_by_public_id,
      attachedByName: row.attached_by_name,
      createdAt: normalizeDateTime(row.created_at),
    })),
    reviews: normalizeRows(reviewRows).map((row) => ({
      publicId: row.public_id,
      reviewerPublicId: row.reviewer_public_id,
      reviewerName: row.reviewer_name,
      reviewerRole: row.reviewer_role,
      decision: row.decision,
      notes: row.notes || null,
      createdAt: normalizeDateTime(row.created_at),
    })),
    auditTrail,
    assessment,
  }
}

function requirePrimaryRole(actor, allowedRoleCodes, message) {
  const normalizedPrimaryRole = String(actor?.primaryRole || "").trim().toUpperCase()
  if (allowedRoleCodes.includes(normalizedPrimaryRole)) return normalizedPrimaryRole
  throw badRequest(message)
}

function normalizeTransactionEnum(value, allowedValues, fallback) {
  const normalizedValue = String(value || "").trim().toUpperCase()
  if (allowedValues.has(normalizedValue)) return normalizedValue
  return fallback
}

function requireTransactionReasonCode(value, allowedValues, fallback, message) {
  const normalizedValue = normalizeTransactionEnum(value, allowedValues, fallback)
  if (allowedValues.has(normalizedValue)) return normalizedValue
  throw badRequest(message)
}

function requireStrongConfirmation(transactionPublicId, confirmationText) {
  const normalizedConfirmation = String(confirmationText || "").trim()
  if (normalizedConfirmation === String(transactionPublicId || "").trim()) return
  throw badRequest(`Confirmation text must match transaction ${transactionPublicId}`)
}

async function resolveLatestTransactionComplianceCase(transactionPublicId) {
  const rows = await optionalRows(prisma.$queryRaw`
    SELECT
      cc.id,
      cc.public_id,
      cc.status,
      cc.severity,
      cc.summary,
      cc.action_taken,
      cc.assigned_user_id
    FROM internal_audit_log ial
    INNER JOIN compliance_cases cc
      ON cc.public_id = JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
    WHERE ial.target_type = 'TRANSACTION'
      AND ial.target_public_id = ${transactionPublicId}
      AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
    ORDER BY ial.created_at DESC
    LIMIT 1
  `, "internal_audit_log")

  return rows?.[0] || null
}

async function ensureTransactionComplianceCase({
  actor,
  transaction,
  severity = "HIGH",
  summary = "",
  noteEntry = "",
  nextStatus = "OPEN",
}) {
  const normalizedSeverity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(severity || "").toUpperCase())
    ? String(severity || "").toUpperCase()
    : "HIGH"
  const normalizedStatus = normalizeTransactionEnum(nextStatus, TRANSACTION_CASE_ALLOWED_STATUSES, "OPEN")
  const resolvedSummary = String(summary || "").trim() || `Transaction ${transaction.public_id} under compliance review.`
  const existingCase = await resolveLatestTransactionComplianceCase(transaction.public_id)

  if (existingCase?.public_id) {
    const nextActionTaken = noteEntry ? appendCaseAction(existingCase.action_taken, noteEntry) : String(existingCase.action_taken || "").trim() || null
    await prisma.$executeRaw`
      UPDATE compliance_cases
      SET
        status = ${normalizedStatus},
        assigned_user_id = COALESCE(assigned_user_id, ${actor.userId || null}),
        action_taken = ${nextActionTaken},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${existingCase.public_id}
    `

    return {
      publicId: existingCase.public_id,
      status: normalizedStatus,
      severity: existingCase.severity || normalizedSeverity,
      summary: existingCase.summary || resolvedSummary,
      actionTaken: nextActionTaken,
    }
  }

  const casePublicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO compliance_cases (
      public_id,
      station_id,
      category,
      severity,
      status,
      assigned_user_id,
      summary,
      action_taken
    )
    VALUES (
      ${casePublicId},
      ${transaction.station_id},
      'TRANSACTION_REVIEW',
      ${normalizedSeverity},
      ${normalizedStatus},
      ${actor.userId || null},
      ${resolvedSummary},
      ${noteEntry || null}
    )
  `

  return {
    publicId: casePublicId,
    status: normalizedStatus,
    severity: normalizedSeverity,
    summary: resolvedSummary,
    actionTaken: noteEntry || null,
  }
}

async function updateTransactionWorkflow({
  transaction,
  actor,
  status,
  settlementImpactStatus,
  reasonCode = "",
  note = "",
  cancelledAt,
}) {
  const normalizedStatus = normalizeTransactionEnum(status, TRANSACTION_WORKFLOW_STATUSES, String(transaction.status || "").toUpperCase() || "RECORDED")
  const normalizedSettlementImpactStatus = normalizeTransactionEnum(
    settlementImpactStatus,
    TRANSACTION_SETTLEMENT_IMPACT_STATUSES,
    String(transaction.settlement_impact_status || "").toUpperCase() || "UNCHANGED"
  )
  const nextNote = String(note || "").trim() || transaction.workflow_note || null
  const nextCancelledAt = cancelledAt === undefined ? transaction.cancelled_at || null : cancelledAt

  await prisma.$executeRaw`
    UPDATE transactions
    SET
      status = ${normalizedStatus},
      settlement_impact_status = ${normalizedSettlementImpactStatus},
      workflow_reason_code = ${String(reasonCode || "").trim() || null},
      workflow_note = ${nextNote},
      status_updated_at = CURRENT_TIMESTAMP(3),
      status_updated_by_role_code = ${actor.primaryRole || null},
      cancelled_at = ${nextCancelledAt}
    WHERE public_id = ${transaction.public_id}
  `

  return {
    transactionPublicId: transaction.public_id,
    status: normalizedStatus,
    settlementImpactStatus: normalizedSettlementImpactStatus,
    workflowReasonCode: String(reasonCode || "").trim() || null,
    workflowNote: nextNote,
    cancelledAt: normalizeDateTime(nextCancelledAt),
  }
}

async function resolveSettlementBatchOrThrow(batchPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      sb.id,
      sb.public_id,
      sb.station_id,
      sb.status,
      sb.batch_date,
      sb.gross_amount,
      sb.fee_amount,
      sb.net_amount,
      sb.metadata_json,
      sb.created_at,
      sb.approved_at,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM settlement_batches sb
    INNER JOIN stations st ON st.id = sb.station_id
    WHERE sb.public_id = ${batchPublicId}
    LIMIT 1
  `
  const batch = rows?.[0]
  if (!batch?.id) throw notFound("Settlement batch not found")
  return batch
}

async function resolveSubscriptionBillingAccountOrThrow(stationPublicId) {
  await syncOverdueStationSubscriptions()
  const station = await resolveStationOrThrow(stationPublicId)

  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT
        sss.station_id,
        st.public_id AS station_public_id,
        st.name AS station_name,
        sss.plan_code,
        sss.plan_name,
        sss.status,
        sss.monthly_fee_mwk,
        sss.renewal_date,
        sss.last_payment_at,
        sss.grace_expires_at
      FROM station_subscription_statuses sss
      INNER JOIN stations st ON st.id = sss.station_id
      WHERE sss.station_id = ${station.id}
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error, "station_subscription_statuses")) {
      throw wrapMissingTableError(
        error,
        "Subscription billing storage is unavailable. Run SQL migration 027_internal_dashboard_expansion.sql."
      )
    }
    throw error
  }

  const account = rows?.[0]
  if (!account?.station_id) {
    throw badRequest(`Subscription billing record not found for station ${station.public_id}`)
  }

  return {
    ...account,
    status: deriveEffectiveSubscriptionStatus(account.status, account.renewal_date),
  }
}

async function resolveFinanceReconciliationRunOrThrow(runPublicId) {
  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT id, public_id, status, notes, started_at, completed_at
      FROM finance_reconciliation_runs
      WHERE public_id = ${runPublicId}
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error, "finance_reconciliation_runs")) {
      throw wrapMissingTableError(
        error,
        "Finance reconciliation storage is unavailable. Run SQL migration 031_finance_workflows_extension.sql."
      )
    }
    throw error
  }

  const run = rows?.[0]
  if (!run?.id) throw notFound("Reconciliation run not found")
  return run
}

async function resolveWalletAdjustmentRequestOrThrow(requestPublicId) {
  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT war.id, war.public_id, war.station_id, war.amount_mwk, war.direction, war.status, war.reason, war.note,
             st.public_id AS station_public_id, st.name AS station_name
      FROM wallet_adjustment_requests war
      LEFT JOIN stations st ON st.id = war.station_id
      WHERE war.public_id = ${requestPublicId}
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error, "wallet_adjustment_requests")) {
      throw wrapMissingTableError(
        error,
        "Wallet adjustment storage is unavailable. Run SQL migration 031_finance_workflows_extension.sql."
      )
    }
    throw error
  }

  const request = rows?.[0]
  if (!request?.id) throw notFound("Wallet adjustment request not found")
  return request
}

async function resolveComplianceCaseOrThrow(casePublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      cc.id,
      cc.public_id,
      cc.station_id,
      cc.user_id,
      cc.assigned_user_id,
      cc.category,
      cc.severity,
      cc.summary,
      cc.status,
      cc.action_taken,
      st.public_id AS station_public_id,
      st.name AS station_name,
      target_user.public_id AS user_public_id,
      target_user.full_name AS user_name,
      assigned_user.public_id AS assigned_user_public_id,
      assigned_user.full_name AS assigned_user_name
    FROM compliance_cases cc
    LEFT JOIN stations st ON st.id = cc.station_id
    LEFT JOIN users target_user ON target_user.id = cc.user_id
    LEFT JOIN users assigned_user ON assigned_user.id = cc.assigned_user_id
    WHERE cc.public_id = ${casePublicId}
    LIMIT 1
  `
  const complianceCase = rows?.[0]
  if (!complianceCase?.id) throw notFound("Compliance case not found")
  return complianceCase
}

async function resolveInternalRoleOrThrow(roleCode) {
  const rows = await prisma.$queryRaw`
    SELECT id, code, name
    FROM internal_roles
    WHERE code = ${roleCode}
      AND is_active = 1
    LIMIT 1
  `
  const role = rows?.[0]
  if (!role?.id) throw notFound("Internal role not found")
  return role
}

async function resolveUserByPublicIdOrThrow(userPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email, is_active
    FROM users
    WHERE public_id = ${userPublicId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw notFound("User not found")
  return user
}

async function findUserByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, email, is_active
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function revokeInternalSessionsForUser(userId) {
  await prisma.$executeRaw`
    UPDATE internal_auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
  `
}

async function revokeStationSessionsForUser(userId) {
  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
  `
}

async function resolveStationStaffDeleteStrategy({ userId, stationStaffId }) {
  const [otherAssignmentRows, queueRows, reservationRows, transactionUserRows, walletRows, refundRows, internalRoleRows,
    internalSessionRows, onboardingRows, fieldVisitRows, supportCaseRows, settlementRows, complianceRows, settingsRows,
    inventoryRows, deliveryRows, transactionStaffRows, incidentRows, noteRows, auditRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM station_staff
      WHERE user_id = ${userId}
        AND id <> ${stationStaffId}
        AND is_active = 1
    `,
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM queue_entries
      WHERE user_id = ${userId}
      LIMIT 1
    `, "queue_entries"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM user_reservations
      WHERE user_id = ${userId}
      LIMIT 1
    `, "user_reservations"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM transactions
      WHERE user_id = ${userId}
      LIMIT 1
    `, "transactions"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM wallets
      WHERE user_id = ${userId}
      LIMIT 1
    `, "wallets"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM refund_requests
      WHERE user_id = ${userId}
         OR requested_by_user_id = ${userId}
         OR reviewed_by_user_id = ${userId}
      LIMIT 1
    `, "refund_requests"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM internal_user_roles
      WHERE user_id = ${userId}
      LIMIT 1
    `, "internal_user_roles"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM internal_auth_sessions
      WHERE user_id = ${userId}
      LIMIT 1
    `, "internal_auth_sessions"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM station_onboarding_records
      WHERE assigned_user_id = ${userId}
      LIMIT 1
    `, "station_onboarding_records"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM field_visits
      WHERE assigned_user_id = ${userId}
      LIMIT 1
    `, "field_visits"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM internal_support_cases
      WHERE user_id = ${userId}
         OR assigned_user_id = ${userId}
      LIMIT 1
    `, "internal_support_cases"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM settlement_batches
      WHERE approved_by_user_id = ${userId}
      LIMIT 1
    `, "settlement_batches"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM compliance_cases
      WHERE user_id = ${userId}
         OR assigned_user_id = ${userId}
      LIMIT 1
    `, "compliance_cases"),
    optionalRows(prisma.$queryRaw`
      SELECT setting_key
      FROM internal_settings
      WHERE updated_by_user_id = ${userId}
      LIMIT 1
    `, "internal_settings"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM inventory_readings
      WHERE recorded_by_staff_id = ${stationStaffId}
      LIMIT 1
    `, "inventory_readings"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM fuel_deliveries
      WHERE recorded_by_staff_id = ${stationStaffId}
      LIMIT 1
    `, "fuel_deliveries"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM transactions
      WHERE recorded_by_staff_id = ${stationStaffId}
      LIMIT 1
    `, "transactions"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM incidents
      WHERE created_by_staff_id = ${stationStaffId}
      LIMIT 1
    `, "incidents"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM report_notes
      WHERE created_by_staff_id = ${stationStaffId}
      LIMIT 1
    `, "report_notes"),
    optionalRows(prisma.$queryRaw`
      SELECT id
      FROM audit_log
      WHERE actor_staff_id = ${stationStaffId}
      LIMIT 1
    `, "audit_log"),
  ])

  const hasOtherAssignments = toCount(otherAssignmentRows?.[0]?.total) > 0
  const hasHistory = [
    queueRows,
    reservationRows,
    transactionUserRows,
    walletRows,
    refundRows,
    internalRoleRows,
    internalSessionRows,
    onboardingRows,
    fieldVisitRows,
    supportCaseRows,
    settlementRows,
    complianceRows,
    settingsRows,
    inventoryRows,
    deliveryRows,
    transactionStaffRows,
    incidentRows,
    noteRows,
    auditRows,
  ].some((rows) => Array.isArray(rows) && rows.length > 0)

  return hasOtherAssignments || hasHistory ? "UNASSIGN_ONLY" : "DELETE_USER"
}

async function deleteStationUserCompletely({ userId, stationStaffId }) {
  await optionalRows(prisma.$executeRaw`
    DELETE FROM user_push_subscriptions
    WHERE user_id = ${userId}
  `, "user_push_subscriptions")
  await optionalRows(prisma.$executeRaw`
    DELETE FROM user_preferences
    WHERE user_id = ${userId}
  `, "user_preferences")
  await optionalRows(prisma.$executeRaw`
    DELETE FROM user_alerts
    WHERE user_id = ${userId}
  `, "user_alerts")
  await optionalRows(prisma.$executeRaw`
    DELETE FROM user_alert_archives
    WHERE user_id = ${userId}
  `, "user_alert_archives")
  await optionalRows(prisma.$executeRaw`
    DELETE FROM auth_sessions
    WHERE user_id = ${userId}
  `, "auth_sessions")
  await prisma.$executeRaw`
    DELETE FROM station_staff
    WHERE id = ${stationStaffId}
  `
  await prisma.$executeRaw`
    DELETE FROM users
    WHERE id = ${userId}
  `
}

function generateTemporaryPassword() {
  return `SmartLink!${crypto.randomBytes(4).toString("hex").toUpperCase()}`
}

function normalizeStationApprovalEntityType(entityType) {
  const normalized = String(entityType || "").trim().toUpperCase()
  if (normalized === "STATION_DELETE_REQUEST") return normalized
  return "STATION_DEACTIVATION_REQUEST"
}

function normalizeStationApprovalRequestType(entityType, metadata = {}) {
  const requestType = String(metadata?.requestType || "").trim().toUpperCase()
  if (requestType) return requestType
  return normalizeStationApprovalEntityType(entityType) === "STATION_DELETE_REQUEST" ? "STATION_DELETE" : "STATION_DEACTIVATION"
}

function mapAlertRows(rows) {
  return normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    stationName: row.station_name || null,
    region: row.region || getOperationalRegion(row.city),
    title: row.title,
    summary: row.summary,
    entityType: row.entity_type || null,
    entityPublicId: row.entity_public_id || null,
    ownerRoleCode: row.owner_role_code || null,
    createdAt: normalizeDateTime(row.created_at),
    ageMinutes: minutesSince(row.created_at),
    metadata: parseJsonField(row.metadata, {}),
  }))
}

function buildNeedsAttention(alertRows = []) {
  return alertRows
    .map((row) => ({
      publicId: row.publicId,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      category: row.category,
      ownerRoleCode: row.ownerRoleCode,
      entityType: row.entityType,
      entityPublicId: row.entityPublicId,
      stationName: row.stationName,
      ageMinutes: row.ageMinutes,
      createdAt: row.createdAt,
    }))
    .sort(comparePriority)
}

export async function getOverviewSummary(auth) {
  await syncOverdueStationSubscriptions()
  const [
    stationCounts,
    queueCounts,
    pumpAlerts,
    txToday,
    supportCounts,
    settlementCounts,
    riskCounts,
    onboardingCounts,
    regionalRows,
    alertRows,
    auditRows,
    financeSnapshotRows,
    supportSnapshotRows,
    riskSnapshotRows,
    systemHealthRows,
    subscriptionRows,
    recentChangesRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS total_stations,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_stations,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS offline_stations
      FROM stations
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS active_queues,
        SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN status IN ('CALLED', 'LATE') THEN 1 ELSE 0 END) AS called_or_late_count
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS live_pump_alerts
      FROM (
        SELECT
          p.id,
          COALESCE(
            CASE
              WHEN p.status = 'OFFLINE' THEN 'OFFLINE'
              WHEN p.status = 'PAUSED' THEN 'PAUSED'
              WHEN COALESCE(ns.nozzle_count, 0) = 0 THEN 'OFFLINE'
              WHEN COALESCE(ns.offline_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'OFFLINE'
              WHEN COALESCE(ns.paused_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'PAUSED'
              WHEN COALESCE(ns.degraded_nozzle_count, 0) > 0 THEN 'DEGRADED'
              ELSE 'ACTIVE'
            END,
            p.status
          ) AS resolved_status
        FROM pumps p
        LEFT JOIN (
          SELECT
            pump_id,
            COUNT(*) AS nozzle_count,
            SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) AS offline_nozzle_count,
            SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) AS paused_nozzle_count,
            SUM(CASE WHEN status IN ('OFFLINE', 'PAUSED') THEN 1 ELSE 0 END) AS degraded_nozzle_count
          FROM pump_nozzles
          WHERE is_active = 1
          GROUP BY pump_id
        ) ns ON ns.pump_id = p.id
        WHERE p.is_active = 1
      ) pump_states
      WHERE resolved_status IN ('OFFLINE', 'PAUSED', 'DEGRADED')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS tx_count, COALESCE(SUM(total_amount), 0) AS tx_value
      FROM transactions
      WHERE DATE(occurred_at) = CURRENT_DATE()
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS open_support,
        SUM(CASE WHEN priority = 'CRITICAL' AND status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED') THEN 1 ELSE 0 END) AS critical_support,
        SUM(CASE WHEN status = 'ESCALATED' THEN 1 ELSE 0 END) AS escalated_support
      FROM internal_support_cases
    `,
    prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN status IN ('PENDING', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS pending_settlements,
        COALESCE(SUM(CASE WHEN status IN ('PENDING', 'UNDER_REVIEW') THEN net_amount ELSE 0 END), 0) AS pending_settlement_value,
        SUM(CASE WHEN status = 'HELD' THEN 1 ELSE 0 END) AS held_settlements
      FROM settlement_batches
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS high_risk,
        SUM(CASE WHEN status = 'FROZEN' THEN 1 ELSE 0 END) AS frozen_cases,
        SUM(CASE WHEN severity = 'CRITICAL' AND status IN ('OPEN', 'INVESTIGATING', 'FROZEN') THEN 1 ELSE 0 END) AS critical_cases
      FROM compliance_cases
    `,
    prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN status IN ('SUBMITTED', 'REVIEW', 'READY_FOR_ACTIVATION') THEN 1 ELSE 0 END) AS pending_activation,
        SUM(CASE WHEN status = 'READY_FOR_ACTIVATION' THEN 1 ELSE 0 END) AS activation_review,
        SUM(CASE WHEN status IN ('SUBMITTED', 'REVIEW') AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 48 HOUR) THEN 1 ELSE 0 END) AS delayed_onboarding
      FROM station_onboarding_records
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        COALESCE(st.city, 'Unknown') AS city,
        COUNT(DISTINCT st.id) AS station_count,
        SUM(CASE WHEN st.is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN st.is_active = 0 THEN 1 ELSE 0 END) AS offline_count,
        COUNT(DISTINCT CASE WHEN qe.status IN ('WAITING', 'CALLED', 'LATE') THEN qe.id ELSE NULL END) AS queue_depth,
        COUNT(DISTINCT CASE WHEN da.status = 'OPEN' THEN da.id ELSE NULL END) AS incident_count,
        COALESCE(SUM(CASE WHEN DATE(tx.occurred_at) = CURRENT_DATE() THEN tx.total_amount ELSE 0 END), 0) AS transaction_value
      FROM stations st
      LEFT JOIN queue_entries qe ON qe.station_id = st.id
      LEFT JOIN dashboard_alerts da ON da.station_id = st.id AND da.status = 'OPEN'
      LEFT JOIN transactions tx ON tx.station_id = st.id
      GROUP BY COALESCE(st.city, 'Unknown')
      ORDER BY station_count DESC, city ASC
    `, "dashboard_alerts"),
    optionalRows(prisma.$queryRaw`
      SELECT
        da.public_id,
        da.category,
        da.severity,
        da.status,
        da.title,
        da.summary,
        da.entity_type,
        da.entity_public_id,
        da.owner_role_code,
        da.metadata,
        da.created_at,
        st.name AS station_name,
        st.city
      FROM dashboard_alerts da
      LEFT JOIN stations st ON st.id = da.station_id
      WHERE da.status = 'OPEN'
      ORDER BY FIELD(da.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), da.created_at DESC
      LIMIT 24
    `, "dashboard_alerts"),
    prisma.$queryRaw`
      SELECT ial.public_id, ial.action_type, ial.summary, ial.severity, ial.target_type, ial.target_public_id, ial.created_at, u.full_name AS actor_name
      FROM internal_audit_log ial
      LEFT JOIN users u ON u.id = ial.actor_user_id
      ORDER BY ial.created_at DESC
      LIMIT 12
    `,
    optionalSingletonRow(prisma.$queryRaw`
      SELECT
        (SELECT COALESCE(SUM(fee_amount), 0) FROM settlement_batches WHERE batch_date = CURRENT_DATE()) AS today_revenue,
        (SELECT COALESCE(SUM(net_amount), 0) FROM settlement_batches WHERE status IN ('PENDING', 'UNDER_REVIEW')) AS unsettled_value,
        (SELECT COUNT(*) FROM settlement_batches WHERE status IN ('PENDING', 'UNDER_REVIEW')) AS payout_batches_pending,
        (SELECT COALESCE(SUM(amount_mwk), 0) FROM refund_requests WHERE status IN ('APPROVED', 'PAID') AND DATE(updated_at) = CURRENT_DATE()) AS refund_outflow_today
    `, "refund_requests"),
    optionalSingletonRow(prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM internal_support_cases WHERE status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED')) AS open_tickets,
        (SELECT COUNT(*) FROM internal_support_cases WHERE status = 'ESCALATED') AS escalated_disputes,
        (SELECT COUNT(*) FROM internal_support_cases WHERE category = 'PAYMENT_FAILURE' AND status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED')) AS failed_payment_issues,
        (SELECT COUNT(*) FROM internal_support_cases WHERE category = 'QUEUE_DISPUTE' AND status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED')) AS unresolved_queue_complaints,
        (SELECT COUNT(*) FROM refund_requests WHERE status IN ('PENDING_SUPPORT_REVIEW', 'PENDING_FINANCE_APPROVAL')) AS refunds_pending_approval
    `, "refund_requests"),
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS suspicious_transactions_count,
        SUM(CASE WHEN status = 'FROZEN' THEN 1 ELSE 0 END) AS frozen_accounts_or_stations,
        SUM(CASE WHEN status IN ('OPEN', 'INVESTIGATING', 'FROZEN') THEN 1 ELSE 0 END) AS unresolved_cases,
        SUM(CASE WHEN severity IN ('HIGH', 'CRITICAL') AND status IN ('OPEN', 'INVESTIGATING', 'FROZEN') THEN 1 ELSE 0 END) AS anomaly_alerts
      FROM compliance_cases
    `,
    optionalSingletonRow(prisma.$queryRaw`
      SELECT
        SUM(
          CASE
            WHEN status = 'OPEN'
              AND severity IN ('HIGH', 'CRITICAL')
            THEN 1
            WHEN status = 'OPEN'
              AND severity = 'WARNING'
              AND created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${SYSTEM_HEALTH_WARNING_PERSIST_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END
        ) AS degraded_services,
        MAX(CASE WHEN severity IN ('HIGH', 'CRITICAL') AND status = 'OPEN' THEN 1 ELSE 0 END) AS has_critical,
        MAX(
          CASE
            WHEN status = 'OPEN'
              AND severity = 'WARNING'
              AND created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${SYSTEM_HEALTH_WARNING_PERSIST_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END
        ) AS has_persistent_warning,
        MAX(created_at) AS latest_event_at
      FROM system_health_events
    `, "system_health_events"),
    optionalRows(prisma.$queryRaw`
      SELECT
        plan_name,
        status,
        COUNT(*) AS station_count,
        COALESCE(SUM(monthly_fee_mwk), 0) AS monthly_fee_total,
        SUM(CASE WHEN renewal_date >= CURRENT_DATE() THEN 1 ELSE 0 END) AS recent_renewals,
        SUM(CASE WHEN status IN ('OVERDUE', 'GRACE') THEN 1 ELSE 0 END) AS at_risk_accounts
      FROM station_subscription_statuses
      GROUP BY plan_name, status
      ORDER BY monthly_fee_total DESC, plan_name ASC
    `, "station_subscription_statuses"),
    prisma.$queryRaw`
      SELECT public_id, action_type, target_type, target_public_id, summary, severity, created_at
      FROM internal_audit_log
      ORDER BY created_at DESC
      LIMIT 20
    `,
  ])

  const stationRow = stationCounts?.[0] || {}
  const txRow = txToday?.[0] || {}
  const queueRow = queueCounts?.[0] || {}
  const supportRow = supportCounts?.[0] || {}
  const settlementRow = settlementCounts?.[0] || {}
  const riskRow = riskCounts?.[0] || {}
  const onboardingRow = onboardingCounts?.[0] || {}
  const financeRow = financeSnapshotRows || {}
  const supportSnapshotRow = supportSnapshotRows || {}
  const riskSnapshotRow = riskSnapshotRows?.[0] || {}
  const systemHealthRow = systemHealthRows || {}

  const mappedAlerts = mapAlertRows(alertRows)
  const needsAttention = buildNeedsAttention(mappedAlerts).slice(0, 8)
  const liveIncidents = mappedAlerts.slice(0, 8)

  const regionalSummary = normalizeRows(regionalRows).map((row) => ({
    region: getOperationalRegion(row.city),
    city: row.city,
    stationCount: toCount(row.station_count),
    activeCount: toCount(row.active_count),
    offlineCount: toCount(row.offline_count),
    queuePressure: toCount(row.queue_depth),
    incidentCount: toCount(row.incident_count),
    transactionValue: toNumber(row.transaction_value),
  }))

  const highestDemandRegion = [...regionalSummary].sort((a, b) => b.transactionValue - a.transactionValue)[0] || null

  const latestAuditActivity = normalizeRows(auditRows).map((row) => ({
    publicId: row.public_id,
    actorName: row.actor_name || "System",
    actionType: row.action_type,
    summary: row.summary,
    severity: row.severity,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    createdAt: normalizeDateTime(row.created_at),
  }))

  const pendingOnboarding = {
    summary: {
      awaitingVerification: toCount(onboardingRow.pending_activation),
      activationReview: toCount(onboardingRow.activation_review),
      delayedItems: toCount(onboardingRow.delayed_onboarding),
    },
    items: mappedAlerts.filter((item) => item.category === "ONBOARDING").slice(0, 5),
  }

  const supportSnapshot = {
    openTickets: toCount(supportSnapshotRow.open_tickets),
    escalatedDisputes: toCount(supportSnapshotRow.escalated_disputes),
    failedPaymentIssues: toCount(supportSnapshotRow.failed_payment_issues),
    unresolvedQueueComplaints: toCount(supportSnapshotRow.unresolved_queue_complaints),
    refundsPendingApproval: toCount(supportSnapshotRow.refunds_pending_approval),
  }

  const financeSnapshot = {
    todayRevenue: toNumber(financeRow.today_revenue),
    unsettledValue: toNumber(financeRow.unsettled_value || settlementRow.pending_settlement_value),
    payoutBatchesPending: toCount(financeRow.payout_batches_pending || settlementRow.pending_settlements),
    refundOutflowToday: toNumber(financeRow.refund_outflow_today),
    pendingSettlements: toCount(settlementRow.pending_settlements),
    pendingSettlementValue: toNumber(settlementRow.pending_settlement_value),
    heldSettlements: toCount(settlementRow.held_settlements),
  }

  const riskSnapshot = {
    suspiciousTransactionsCount: toCount(riskSnapshotRow.suspicious_transactions_count || riskRow.high_risk),
    frozenAccountsOrStations: toCount(riskSnapshotRow.frozen_accounts_or_stations || riskRow.frozen_cases),
    unresolvedComplianceCases: toCount(riskSnapshotRow.unresolved_cases),
    anomalyAlerts: toCount(riskSnapshotRow.anomaly_alerts),
    highRiskAlerts: toCount(riskRow.high_risk),
  }

  const degradedServices = toCount(systemHealthRow.degraded_services)
  const hasCriticalSystemIssue = toCount(systemHealthRow.has_critical) > 0
  const hasPersistentWarning = toCount(systemHealthRow.has_persistent_warning) > 0

  const systemHealthSummary = {
    status: hasCriticalSystemIssue ? "Degraded" : hasPersistentWarning ? "Warning" : "Operational",
    degradedServices,
    latestEventAt: normalizeDateTime(systemHealthRow.latest_event_at),
  }

  const groupedSubscriptions = normalizeRows(subscriptionRows).map((row) => ({
    planName: row.plan_name,
    status: row.status,
    stationCount: toCount(row.station_count),
    monthlyFeeTotal: toNumber(row.monthly_fee_total),
    recentRenewals: toCount(row.recent_renewals),
    atRiskAccounts: toCount(row.at_risk_accounts),
  }))

  const subscriptionCommercial = {
    activeSubscriptionsByPlan: groupedSubscriptions,
    overdueSubscriptions: groupedSubscriptions.filter((row) => ["OVERDUE", "GRACE"].includes(String(row.status || ""))),
    recentRenewals: groupedSubscriptions.reduce((sum, row) => sum + toCount(row.recentRenewals), 0),
    atRiskStationAccounts: groupedSubscriptions.reduce((sum, row) => sum + toCount(row.atRiskAccounts), 0),
  }

  const recentChanges = normalizeRows(recentChangesRows).map((row) => ({
    publicId: row.public_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    summary: row.summary,
    severity: row.severity,
    createdAt: normalizeDateTime(row.created_at),
  }))

  return {
    metrics: {
      totalStations: toCount(stationRow.total_stations),
      totalActiveStations: toCount(stationRow.active_stations),
      stationsPendingActivation: toCount(onboardingRow.pending_activation),
      stationsOffline: toCount(stationRow.offline_stations),
      activeQueues: toCount(queueRow.active_queues),
      livePumpAlerts: toCount(pumpAlerts?.[0]?.live_pump_alerts),
      todayTransactionCount: toCount(txRow.tx_count),
      todayTransactionValue: toNumber(txRow.tx_value),
      pendingSettlements: toCount(settlementRow.pending_settlements),
      pendingSettlementValue: toNumber(settlementRow.pending_settlement_value),
      highRiskAlerts: toCount(riskRow.high_risk),
      criticalSupportTickets: toCount(supportRow.critical_support),
      systemHealthStatus: systemHealthSummary.status,
      subscriptionRevenueSnapshot: groupedSubscriptions.reduce((sum, row) => sum + toNumber(row.monthlyFeeTotal), 0),
    },
    panelOrder: buildPanelOrder(auth?.primaryRole),
    needsAttention,
    regionalOperations: {
      highestDemandRegion: highestDemandRegion?.region || null,
      items: regionalSummary,
    },
    liveIncidents,
    pendingOnboarding,
    supportSnapshot,
    financeSnapshot,
    riskSnapshot,
    latestAuditActivity,
    systemHealthSummary,
    subscriptionCommercial,
    recentChanges,
  }
}

export async function getNetworkOperationsData() {
  const [stationRows, telemetryRows, incidentRows, queueRows, transactionRows, stationHistoryRows, offlinePumpRows, regionalIncidentRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        st.public_id,
        st.name,
        st.city,
        st.is_active,
        COALESCE(pump_stats.pump_count, 0) AS pump_count,
        COALESCE(pump_stats.pumps_offline, 0) AS pumps_offline,
        COALESCE(pump_stats.pumps_paused, 0) AS pumps_paused,
        COALESCE(queue_stats.queue_depth, 0) AS queue_depth,
        tx_stats.last_transaction_at
      FROM stations st
      LEFT JOIN (
        SELECT
          pump_states.station_id,
          COUNT(*) AS pump_count,
          SUM(CASE WHEN pump_states.resolved_status = 'OFFLINE' THEN 1 ELSE 0 END) AS pumps_offline,
          SUM(CASE WHEN pump_states.resolved_status = 'PAUSED' THEN 1 ELSE 0 END) AS pumps_paused
        FROM (
          SELECT
            p.id,
            p.station_id,
            COALESCE(
              CASE
                WHEN p.status = 'OFFLINE' THEN 'OFFLINE'
                WHEN p.status = 'PAUSED' THEN 'PAUSED'
                WHEN COALESCE(ns.nozzle_count, 0) = 0 THEN 'OFFLINE'
                WHEN COALESCE(ns.offline_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'OFFLINE'
                WHEN COALESCE(ns.paused_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'PAUSED'
                WHEN COALESCE(ns.degraded_nozzle_count, 0) > 0 THEN 'DEGRADED'
                ELSE 'ACTIVE'
              END,
              p.status
            ) AS resolved_status
          FROM pumps p
          LEFT JOIN (
            SELECT
              pump_id,
              COUNT(*) AS nozzle_count,
              SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) AS offline_nozzle_count,
              SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) AS paused_nozzle_count,
              SUM(CASE WHEN status IN ('OFFLINE', 'PAUSED') THEN 1 ELSE 0 END) AS degraded_nozzle_count
            FROM pump_nozzles
            WHERE is_active = 1
            GROUP BY pump_id
          ) ns ON ns.pump_id = p.id
          WHERE p.is_active = 1
        ) pump_states
        GROUP BY pump_states.station_id
      ) pump_stats ON pump_stats.station_id = st.id
      LEFT JOIN (
        SELECT
          station_id,
          COUNT(*) AS queue_depth
        FROM queue_entries
        WHERE status IN ('WAITING', 'CALLED', 'LATE')
        GROUP BY station_id
      ) queue_stats ON queue_stats.station_id = st.id
      LEFT JOIN (
        SELECT station_id, MAX(occurred_at) AS last_transaction_at
        FROM transactions
        GROUP BY station_id
      ) tx_stats ON tx_stats.station_id = st.id
      ORDER BY st.name ASC
    `,
    prisma.$queryRaw`
      SELECT
        pn.public_id AS nozzle_public_id,
        p.public_id AS pump_public_id,
        st.public_id AS station_public_id,
        st.name AS station_name,
        st.city,
        pn.status,
        pn.hardware_channel,
        pn.updated_at
      FROM pump_nozzles pn
      INNER JOIN pumps p ON p.id = pn.pump_id
      INNER JOIN stations st ON st.id = pn.station_id
      ORDER BY pn.updated_at DESC
      LIMIT 24
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        da.public_id,
        da.severity,
        da.status,
        da.owner_role_code,
        da.title,
        da.summary,
        da.metadata,
        da.created_at,
        da.updated_at,
        st.name AS station_name,
        st.city
      FROM dashboard_alerts da
      LEFT JOIN stations st ON st.id = da.station_id
      WHERE da.category IN ('OPERATIONS', 'SYSTEM')
      ORDER BY FIELD(da.status, 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'), FIELD(da.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), da.created_at DESC
      LIMIT 32
    `, "dashboard_alerts"),
    prisma.$queryRaw`
      SELECT
        st.city,
        COUNT(*) AS queue_sessions
      FROM queue_entries qe
      INNER JOIN stations st ON st.id = qe.station_id
      WHERE qe.status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY st.city
      ORDER BY queue_sessions DESC
    `,
    prisma.$queryRaw`
      SELECT
        tx.public_id,
        st.public_id AS station_public_id,
        st.name AS station_name,
        p.public_id AS pump_public_id,
        pn.public_id AS nozzle_public_id,
        tx.total_amount,
        tx.litres,
        tx.payment_method,
        tx.occurred_at
      FROM transactions tx
      INNER JOIN stations st ON st.id = tx.station_id
      LEFT JOIN pumps p ON p.id = tx.pump_id
      LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
      ORDER BY tx.occurred_at DESC
      LIMIT 40
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        da.public_id,
        st.public_id AS station_public_id,
        da.status,
        da.severity,
        da.title,
        da.summary,
        da.created_at,
        da.updated_at
      FROM dashboard_alerts da
      INNER JOIN stations st ON st.id = da.station_id
      WHERE da.category IN ('OPERATIONS', 'SYSTEM')
      ORDER BY da.updated_at DESC, da.created_at DESC
      LIMIT 120
    `, "dashboard_alerts"),
    prisma.$queryRaw`
      SELECT
        p.public_id,
        st.public_id AS station_public_id,
        st.name AS station_name,
        st.city,
        p.pump_number,
        COALESCE(
          CASE
            WHEN p.status = 'OFFLINE' THEN 'OFFLINE'
            WHEN p.status = 'PAUSED' THEN 'PAUSED'
            WHEN COALESCE(ns.nozzle_count, 0) = 0 THEN 'OFFLINE'
            WHEN COALESCE(ns.offline_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'OFFLINE'
            WHEN COALESCE(ns.paused_nozzle_count, 0) = COALESCE(ns.nozzle_count, 0) THEN 'PAUSED'
            WHEN COALESCE(ns.degraded_nozzle_count, 0) > 0 THEN 'DEGRADED'
            ELSE 'ACTIVE'
          END,
          p.status
        ) AS resolved_status
      FROM pumps p
      INNER JOIN stations st ON st.id = p.station_id
      LEFT JOIN (
        SELECT
          pump_id,
          COUNT(*) AS nozzle_count,
          SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) AS offline_nozzle_count,
          SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) AS paused_nozzle_count,
          SUM(CASE WHEN status IN ('OFFLINE', 'PAUSED') THEN 1 ELSE 0 END) AS degraded_nozzle_count
        FROM pump_nozzles
        WHERE is_active = 1
        GROUP BY pump_id
      ) ns ON ns.pump_id = p.id
      WHERE p.is_active = 1
      HAVING resolved_status = 'OFFLINE'
      ORDER BY st.name ASC, p.pump_number ASC
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        COALESCE(st.city, 'Unknown') AS city,
        COUNT(*) AS incident_count,
        SUM(CASE WHEN da.status = 'OPEN' THEN 1 ELSE 0 END) AS open_incidents,
        SUM(CASE WHEN da.severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_incidents
      FROM dashboard_alerts da
      LEFT JOIN stations st ON st.id = da.station_id
      WHERE da.category IN ('OPERATIONS', 'SYSTEM')
      GROUP BY COALESCE(st.city, 'Unknown')
      ORDER BY incident_count DESC, city ASC
    `, "dashboard_alerts"),
  ])

  const stationLiveStatus = normalizeRows(stationRows).map((row) => ({
    publicId: row.public_id,
    stationName: row.name,
    city: row.city,
    region: getOperationalRegion(row.city),
    isActive: Number(row.is_active) === 1,
    pumpCount: toCount(row.pump_count),
    pumpsOffline: toCount(row.pumps_offline),
    pumpsPaused: toCount(row.pumps_paused),
    queueDepth: toCount(row.queue_depth),
    lastTransactionAt: normalizeDateTime(row.last_transaction_at),
  }))

  const telemetry = normalizeRows(telemetryRows).map((row) => ({
    nozzlePublicId: row.nozzle_public_id,
    pumpPublicId: row.pump_public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    city: row.city,
    status: row.status,
    hardwareChannel: row.hardware_channel,
    updatedAt: normalizeDateTime(row.updated_at),
  }))

  const incidentQueue = normalizeRows(incidentRows).map((row) => ({
    publicId: row.public_id,
    severity: row.severity,
    status: row.status,
    ownerRoleCode: row.owner_role_code || null,
    title: row.title,
    summary: row.summary,
    stationName: row.station_name || null,
    region: getOperationalRegion(row.city),
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
    metadata: parseJsonField(row.metadata, {}),
  }))

  const operationalTransactions = normalizeRows(transactionRows).map((row) => ({
    publicId: row.public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    pumpPublicId: row.pump_public_id || null,
    nozzlePublicId: row.nozzle_public_id || null,
    totalAmount: toNumber(row.total_amount),
    litres: toNumber(row.litres),
    paymentMethod: row.payment_method,
    occurredAt: normalizeDateTime(row.occurred_at),
  }))

  const stationStatusHistory = normalizeRows(stationHistoryRows).map((row) => ({
    publicId: row.public_id,
    stationPublicId: row.station_public_id,
    status: row.status,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
  }))

  const offlinePumps = normalizeRows(offlinePumpRows).map((row) => ({
    publicId: row.public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    city: row.city,
    region: getOperationalRegion(row.city),
    pumpNumber: row.pump_number,
    status: row.resolved_status,
  }))

  const queueAlerts = stationLiveStatus
    .filter((row) => row.queueDepth >= 5)
    .sort((left, right) => right.queueDepth - left.queueDepth)

  const missingTelemetry = telemetry.filter((row) => !row.updatedAt || minutesSince(row.updatedAt) >= 45)

  const regionalIncidentSummary = normalizeRows(regionalIncidentRows).map((row) => ({
    city: row.city,
    region: getOperationalRegion(row.city),
    incidentCount: toCount(row.incident_count),
    openIncidents: toCount(row.open_incidents),
    criticalIncidents: toCount(row.critical_incidents),
  }))

  const summary = {
    activeStations: stationLiveStatus.filter((row) => row.isActive).length,
    offlineStations: stationLiveStatus.filter((row) => !row.isActive).length,
    queuePressureStations: stationLiveStatus.filter((row) => row.queueDepth >= 5).length,
    telemetryAlerts: telemetry.filter((row) => String(row.status || "").toUpperCase() !== "ACTIVE").length,
    offlinePumps: offlinePumps.length,
    missingTelemetry: missingTelemetry.length,
    openOperationalIncidents: incidentQueue.filter((row) => String(row.status || "").toUpperCase() === 'OPEN').length,
  }

  return {
    summary,
    stationLiveStatus,
    incidentQueue,
    telemetry,
    operationalTransactions,
    stationStatusHistory,
    offlinePumps,
    missingTelemetry,
    queueAlerts,
    regionalIncidentSummary,
    offlineTracking: stationLiveStatus.filter((row) => !row.isActive || row.pumpsOffline > 0),
    regionalQueuePressure: normalizeRows(queueRows).map((row) => ({
      city: row.city,
      region: getOperationalRegion(row.city),
      queueSessions: toCount(row.queue_sessions),
    })),
  }
}

export async function acknowledgeOperationalAlert({ actor, alertPublicId }) {
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'ACKNOWLEDGED',
      acknowledged_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_ALERT_ACKNOWLEDGE',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational alert acknowledged: ${alert.title}`,
    severity: 'HIGH',
  })

  return { alertPublicId, status: 'ACKNOWLEDGED' }
}

export async function markOperationalIncidentUnderReview({ actor, alertPublicId }) {
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)
  const nextMetadata = parseJsonField(alert.metadata, {})
  nextMetadata.workflowState = 'UNDER_REVIEW'
  nextMetadata.reviewedByUserId = actor.userId

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'ACKNOWLEDGED',
      metadata = ${JSON.stringify(nextMetadata)},
      acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3)),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_UNDER_REVIEW',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident marked under review: ${alert.title}`,
    severity: 'HIGH',
  })

  return { alertPublicId, status: 'ACKNOWLEDGED' }
}

export async function resolveOperationalIncident({ actor, alertPublicId }) {
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'RESOLVED',
      resolved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_RESOLVE',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident resolved: ${alert.title}`,
    severity: 'HIGH',
  })

  return { alertPublicId, status: 'RESOLVED' }
}

export async function reopenOperationalIncident({ actor, alertPublicId }) {
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'OPEN',
      resolved_at = NULL,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_REOPEN',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident reopened: ${alert.title}`,
    severity: 'HIGH',
  })

  return { alertPublicId, status: 'OPEN' }
}

export async function escalateOperationalIncident({ actor, alertPublicId }) {
  const alert = await resolveDashboardAlertOrThrow(alertPublicId)
  const currentSeverity = String(alert.severity || '').toUpperCase()
  const nextSeverity = currentSeverity === 'LOW'
    ? 'MEDIUM'
    : currentSeverity === 'MEDIUM'
      ? 'HIGH'
      : 'CRITICAL'
  const nextMetadata = parseJsonField(alert.metadata, {})
  nextMetadata.escalatedAt = new Date().toISOString()
  nextMetadata.escalatedByUserId = actor.userId

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      severity = ${nextSeverity},
      metadata = ${JSON.stringify(nextMetadata)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_ESCALATE',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident escalated: ${alert.title}`,
    severity: 'CRITICAL',
    metadata: { nextSeverity },
  })

  return { alertPublicId, severity: nextSeverity }
}

export async function assignOperationalIncident({ actor, alertPublicId, ownerRoleCode }) {
  const [alert, role] = await Promise.all([
    resolveDashboardAlertOrThrow(alertPublicId),
    resolveInternalRoleOrThrow(ownerRoleCode),
  ])

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      owner_role_code = ${role.code},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_ASSIGN',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident assigned to ${role.code}: ${alert.title}`,
    severity: 'HIGH',
    metadata: { ownerRoleCode: role.code },
  })

  return { alertPublicId, ownerRoleCode: role.code }
}

export async function addOperationalIncidentNote({ actor, alertPublicId, note }) {
  const trimmedNote = String(note || '').trim()
  if (!trimmedNote) throw badRequest('Note is required')

  const alert = await resolveDashboardAlertOrThrow(alertPublicId)
  const nextMetadata = parseJsonField(alert.metadata, {})
  const existingNotes = Array.isArray(nextMetadata.notes) ? nextMetadata.notes : []
  nextMetadata.notes = [
    ...existingNotes,
    {
      note: trimmedNote,
      actorUserId: actor.userId,
      actorRoleCode: actor.primaryRole,
      createdAt: new Date().toISOString(),
    },
  ]

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      metadata = ${JSON.stringify(nextMetadata)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'NETWORK_INCIDENT_NOTE',
    targetType: 'DASHBOARD_ALERT',
    targetPublicId: alertPublicId,
    summary: `Operational incident note added: ${alert.title}`,
    severity: 'MEDIUM',
  })

  return { alertPublicId, note: trimmedNote }
}

export async function markStationNeedsReview({ actor, stationPublicId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const alertPublicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO dashboard_alerts (
      public_id,
      category,
      severity,
      status,
      station_id,
      entity_type,
      entity_public_id,
      owner_role_code,
      title,
      summary,
      metadata
    )
    VALUES (
      ${alertPublicId},
      'OPERATIONS',
      'MEDIUM',
      'OPEN',
      ${station.id},
      'STATION',
      ${station.public_id},
      ${actor.primaryRole || 'NETWORK_OPERATIONS_MANAGER'},
      'Station Marked For Review',
      ${`${station.name} was marked for network operations review.`},
      ${JSON.stringify({ requestedByUserId: actor.userId })}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'STATION_NEEDS_REVIEW',
    targetType: 'STATION',
    targetPublicId: stationPublicId,
    summary: `${station.name} marked as needs review.`,
    severity: 'HIGH',
  })

  return { stationPublicId, alertPublicId }
}

export async function requestNetworkFieldVisit({ actor, stationPublicId, note = '' }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const visitPublicId = createPublicId()
  const summary = `Field visit requested by network operations for ${station.name}.`

  await prisma.$executeRaw`
    INSERT INTO field_visits (
      public_id,
      station_id,
      assigned_user_id,
      visit_type,
      status,
      scheduled_for,
      summary,
      notes
    )
    VALUES (
      ${visitPublicId},
      ${station.id},
      NULL,
      'INSPECTION',
      'SCHEDULED',
      DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY),
      ${summary},
      ${String(note || '').trim() || 'Network operations requested an inspection.'}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'FIELD_VISIT_REQUEST',
    targetType: 'STATION',
    targetPublicId: stationPublicId,
    summary,
    severity: 'HIGH',
    metadata: { visitPublicId },
  })

  return { stationPublicId, visitPublicId }
}

export async function requestTechnicalInvestigation({ actor, stationPublicId, note = '' }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const alertPublicId = createPublicId()
  const summary = `Technical investigation requested for ${station.name}.`

  await prisma.$executeRaw`
    INSERT INTO dashboard_alerts (
      public_id,
      category,
      severity,
      status,
      station_id,
      entity_type,
      entity_public_id,
      owner_role_code,
      title,
      summary,
      metadata
    )
    VALUES (
      ${alertPublicId},
      'SYSTEM',
      'HIGH',
      'OPEN',
      ${station.id},
      'STATION',
      ${station.public_id},
      'PLATFORM_INFRASTRUCTURE_ENGINEER',
      'Technical Investigation Requested',
      ${summary},
      ${JSON.stringify({ requestedByUserId: actor.userId, note: String(note || '').trim() || null })}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'TECHNICAL_INVESTIGATION_REQUEST',
    targetType: 'STATION',
    targetPublicId: stationPublicId,
    summary,
    severity: 'CRITICAL',
  })

  return { stationPublicId, alertPublicId }
}

export async function getStationsData() {
  await syncOverdueStationSubscriptions()
  const [rows, subscriptionRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        st.public_id,
        st.name,
        st.operator_name,
        st.city,
        st.address,
        st.is_active,
        COUNT(DISTINCT ss.id) AS assigned_managers,
        COUNT(DISTINCT p.id) AS pump_count,
        COUNT(DISTINCT CASE WHEN pn.status = 'ACTIVE' THEN pn.id ELSE NULL END) AS active_nozzles,
        COALESCE(sor.status, 'NOT_STARTED') AS onboarding_status,
        MAX(tx.occurred_at) AS last_transaction_at
      FROM stations st
      LEFT JOIN station_staff ss ON ss.station_id = st.id AND ss.is_active = 1
      LEFT JOIN pumps p ON p.station_id = st.id
      LEFT JOIN pump_nozzles pn ON pn.station_id = st.id
      LEFT JOIN station_onboarding_records sor ON sor.station_id = st.id
      LEFT JOIN transactions tx ON tx.station_id = st.id
      WHERE st.deleted_at IS NULL
      GROUP BY st.id, st.public_id, st.name, st.operator_name, st.city, st.address, st.is_active, sor.status
      ORDER BY st.name ASC
    `,
    optionalRows(prisma.$queryRaw`
      SELECT st.public_id AS station_public_id, sss.plan_name, sss.status AS subscription_status, sss.renewal_date
      FROM station_subscription_statuses sss
      INNER JOIN stations st ON st.id = sss.station_id
    `, "station_subscription_statuses"),
  ])

  const subscriptionsByStation = new Map(
    normalizeRows(subscriptionRows).map((row) => [row.station_public_id, row])
  )

  const items = normalizeRows(rows).map((row) => {
    const subscription = subscriptionsByStation.get(row.public_id)
    const subscriptionStatus = deriveEffectiveSubscriptionStatus(
      subscription?.subscription_status,
      subscription?.renewal_date
    )
    return {
      public_id: row.public_id,
      name: row.name,
      operator_name: row.operator_name,
      city: row.city,
      address: row.address,
      is_active: row.is_active,
      assigned_managers: row.assigned_managers,
      pump_count: row.pump_count,
      active_nozzles: row.active_nozzles,
      onboarding_status: row.onboarding_status,
      subscription_plan: subscription?.plan_name || "Unassigned",
      subscription_status: subscription ? subscriptionStatus : "NOT_CONFIGURED",
      renewal_date: subscription?.renewal_date || null,
      last_transaction_at: normalizeDateTime(row.last_transaction_at),
    }
  })

  return {
    summary: {
      totalStations: items.length,
      activeStations: items.filter((row) => Number(row.is_active) === 1).length,
      inactiveStations: items.filter((row) => Number(row.is_active) !== 1).length,
      overdueSubscriptions: items.filter((row) => ["OVERDUE", "GRACE"].includes(String(row.subscription_status || ""))).length,
    },
    items,
  }
}

async function resolveStaffRoleByCode(roleCode) {
  const rows = await prisma.$queryRaw`
    SELECT id, code, name
    FROM staff_roles
    WHERE code = ${roleCode}
    LIMIT 1
  `
  const role = rows?.[0]
  if (!role?.id) throw badRequest(`Unsupported station role: ${roleCode}`)
  return role
}

async function resolveExistingManagerUserOrThrow(userPublicId) {
  const normalizedUserPublicId = String(userPublicId || "").trim()
  if (!normalizedUserPublicId) throw badRequest("Existing manager user id is required")

  const rows = await prisma.$queryRaw`
    SELECT u.id, u.public_id, u.full_name, u.email, u.phone_e164, u.password_hash, u.is_active
    FROM users u
    WHERE u.public_id = ${normalizedUserPublicId}
      AND EXISTS (
        SELECT 1
        FROM station_staff ss
        INNER JOIN staff_roles sr ON sr.id = ss.role_id
        WHERE ss.user_id = u.id
          AND ss.is_active = 1
          AND sr.code = 'MANAGER'
      )
    LIMIT 1
  `

  const user = rows?.[0] || null
  if (!user?.id) {
    throw badRequest("Selected existing manager was not found")
  }

  return user
}

async function resolveOnboardingRecordByStationId(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, status, checklist_json, evidence_json, notes, created_at, updated_at
    FROM station_onboarding_records
    WHERE station_id = ${stationId}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function createBackfilledOnboardingRecordForStation(station) {
  const checklistJson = defaultOnboardingChecklist()
  const evidenceJson = []
  const checklistState = await evaluateOnboardingChecklistState({
    stationId: station.id,
    checklistJson,
    evidenceJson,
  })
  const status = deriveBackfilledOnboardingStatus({
    isActive: Boolean(Number(station?.is_active)),
    pendingChecklistItems: checklistState.pendingChecklistItems,
  })
  const note = status === "ACTIVATED"
    ? "Backfilled onboarding record for legacy active station."
    : "Backfilled onboarding record for legacy station."

  await prisma.$executeRaw`
    INSERT INTO station_onboarding_records (
      public_id,
      station_id,
      proposed_station_name,
      operator_name,
      city,
      status,
      checklist_json,
      evidence_json,
      notes
    )
    VALUES (
      ${createPublicId()},
      ${station.id},
      ${station.name},
      ${station.operator_name || null},
      ${station.city || null},
      ${status},
      ${JSON.stringify(checklistJson)},
      ${JSON.stringify(evidenceJson)},
      ${note}
    )
  `

  return resolveOnboardingRecordByStationId(station.id)
}

async function ensureOnboardingRecordForStation(station) {
  const onboardingRecord = await resolveOnboardingRecordByStationId(station.id)
  if (onboardingRecord?.id) return onboardingRecord
  return createBackfilledOnboardingRecordForStation(station)
}

function normalizeSubscriptionStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (["ACTIVE", "OVERDUE", "GRACE", "PAUSED", "TRIAL"].includes(normalized)) return normalized
  return "TRIAL"
}

function deriveEffectiveSubscriptionStatus(status, renewalDate, options = {}) {
  const normalizedStatus = normalizeSubscriptionStatus(status)
  const normalizedRenewalDate = normalizeDateOnly(renewalDate)
  const today = String(options.today || appTodayISO()).trim() || appTodayISO()
  if (
    normalizedRenewalDate &&
    normalizedRenewalDate < today &&
    !["PAUSED", "OVERDUE"].includes(normalizedStatus)
  ) {
    return "OVERDUE"
  }
  return normalizedStatus
}

async function syncOverdueStationSubscriptions() {
  try {
    const today = appTodayISO()
    await prisma.$executeRaw`
      UPDATE station_subscription_statuses
      SET
        status = 'OVERDUE',
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE renewal_date IS NOT NULL
        AND renewal_date < ${today}
        AND status IN ('ACTIVE', 'TRIAL', 'GRACE')
    `
  } catch (error) {
    if (isMissingTableError(error, "station_subscription_statuses")) return
    throw error
  }
}

export async function createStationSetup({ actor, payload }) {
  const name = String(payload?.name || "").trim()
  const city = String(payload?.city || "").trim()
  const timezone = String(payload?.timezone || "Africa/Blantyre").trim() || "Africa/Blantyre"
  const countryCode = String(payload?.countryCode || "MW").trim().toUpperCase() || "MW"
  if (!name) throw badRequest("Station name is required")
  if (!city) throw badRequest("Station city is required")

  const stationPublicId = await createStationPublicId({ countryCode, city })
  const open24h = Boolean(payload?.open24h)
  const openingTime = open24h ? "00:00:00" : (payload?.openingTime ? `${payload.openingTime}:00` : null)
  const closingTime = open24h ? "23:59:00" : (payload?.closingTime ? `${payload.closingTime}:00` : null)
  const onboardingStatus = payload?.submitForReview ? "SUBMITTED" : "REVIEW"
  const subscriptionStatus = deriveEffectiveSubscriptionStatus(
    payload?.subscriptionStatus || "TRIAL",
    payload?.renewalDate || null
  )

  await prisma.$executeRaw`
    INSERT INTO stations (
      public_id,
      name,
      operator_name,
      country_code,
      city,
      address,
      timezone,
      is_active,
      opening_time,
      closing_time,
      open_24h
    )
    VALUES (
      ${stationPublicId},
      ${name},
      ${payload?.operatorName || null},
      ${countryCode},
      ${city},
      ${payload?.address || null},
      ${timezone},
      0,
      ${openingTime},
      ${closingTime},
      ${open24h}
    )
  `

  const station = await resolveStationOrThrow(stationPublicId)

  await prisma.$executeRaw`
    INSERT INTO station_queue_settings (station_id)
    VALUES (${station.id})
  `

  await prisma.$executeRaw`
    INSERT INTO station_onboarding_records (
      public_id,
      station_id,
      proposed_station_name,
      operator_name,
      city,
      status,
      checklist_json,
      evidence_json,
      notes
    )
    VALUES (
      ${createPublicId()},
      ${station.id},
      ${name},
      ${payload?.operatorName || null},
      ${city},
      ${onboardingStatus},
      ${JSON.stringify(defaultOnboardingChecklist())},
      ${JSON.stringify([])},
      ${payload?.submitForReview ? "Submitted by station onboarding manager." : "Saved as draft by station onboarding manager."}
    )
  `

  await prisma.$executeRaw`
    INSERT INTO station_subscription_statuses (
      station_id,
      plan_code,
      plan_name,
      status,
      monthly_fee_mwk,
      renewal_date
    )
    VALUES (
      ${station.id},
      ${payload?.subscriptionPlanCode || "TRIAL"},
      ${payload?.subscriptionPlanName || "Trial Plan"},
      ${subscriptionStatus},
      ${toNumber(payload?.monthlyFeeMwk || 0)},
      ${payload?.renewalDate || null}
    )
    ON DUPLICATE KEY UPDATE
      plan_code = VALUES(plan_code),
      plan_name = VALUES(plan_name),
      status = VALUES(status),
      monthly_fee_mwk = VALUES(monthly_fee_mwk),
      renewal_date = VALUES(renewal_date),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_CREATE",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `Station ${name} created by onboarding workflow.`,
    severity: "MEDIUM",
    metadata: { onboardingStatus },
  })

  return getStationSetupData({ stationPublicId })
}

export async function createFieldStationSetupRequest({ actor, payload }) {
  const setup = await createStationSetup({
    actor,
    payload: {
      ...payload,
      submitForReview: false,
      subscriptionPlanCode: payload?.subscriptionPlanCode || "TRIAL",
      subscriptionPlanName: payload?.subscriptionPlanName || "Trial Plan",
      subscriptionStatus: payload?.subscriptionStatus || "TRIAL",
      monthlyFeeMwk: payload?.monthlyFeeMwk ?? 0,
    },
  })

  const stationPublicId = String(setup?.station?.public_id || "").trim()
  const station = await resolveStationOrThrow(stationPublicId)
  const onboardingRecord = await resolveOnboardingRecordByStationId(station.id)
  if (!onboardingRecord?.id) throw badRequest("Onboarding record was not created for the station setup request")

  const nextChecklist = normalizeOnboardingChecklistState(onboardingRecord.checklist_json)
  nextChecklist.STATION_PROFILE = true

  await prisma.$executeRaw`
    UPDATE station_onboarding_records
    SET
      assigned_user_id = ${actor.userId},
      checklist_json = ${JSON.stringify(nextChecklist)},
      notes = ${appendNoteEntry(onboardingRecord.notes, "Field agent created the station setup request and opened implementation workflow.")},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${onboardingRecord.id}
  `

  const visitPublicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO field_visits (
      public_id,
      station_id,
      onboarding_record_id,
      assigned_user_id,
      visit_type,
      status,
      scheduled_for,
      summary,
      notes
    )
    VALUES (
      ${visitPublicId},
      ${station.id},
      ${onboardingRecord.id},
      ${actor.userId},
      'INSTALLATION',
      'SCHEDULED',
      CURRENT_TIMESTAMP(3),
      ${`Field setup request created for ${station.name}.`},
      ${String(payload?.note || "").trim() || "Initial field visit scheduled by field agent."}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "FIELD_SETUP_REQUEST_CREATE",
    targetType: "STATION",
    targetPublicId: station.public_id,
    summary: `${station.name} setup request created by field operations.`,
    severity: "MEDIUM",
    metadata: { visitPublicId, onboardingPublicId: onboardingRecord.public_id },
  })

  return {
    stationPublicId: station.public_id,
    onboardingPublicId: onboardingRecord.public_id,
    visitPublicId,
    setup: await getStationSetupData({ stationPublicId: station.public_id }),
  }
}

export async function getStationSetupData({ stationPublicId }) {
  await syncOverdueStationSubscriptions()
  const station = await resolveStationOrThrow(stationPublicId)
  const [settings, subscriptionRow, onboardingRecord] = await Promise.all([
    getStationSettingsSnapshot(stationPublicId),
    optionalSingletonRow(prisma.$queryRaw`
      SELECT plan_code, plan_name, status, monthly_fee_mwk, renewal_date, last_payment_at, grace_expires_at, updated_at, created_at
      FROM station_subscription_statuses
      WHERE station_id = ${station.id}
      LIMIT 1
    `, "station_subscription_statuses", null),
    ensureOnboardingRecordForStation(station),
  ])

  const onboardingChecklistState = onboardingRecord
    ? await evaluateOnboardingChecklistState({
        stationId: station.id,
        checklistJson: onboardingRecord.checklist_json,
        evidenceJson: onboardingRecord.evidence_json,
      })
    : null

  return {
    ...settings,
    subscription: subscriptionRow
      ? {
          planCode: subscriptionRow.plan_code,
          planName: subscriptionRow.plan_name,
          status: deriveEffectiveSubscriptionStatus(subscriptionRow.status, subscriptionRow.renewal_date),
          monthlyFeeMwk: toNumber(subscriptionRow.monthly_fee_mwk),
          renewalDate: normalizeDateOnly(subscriptionRow.renewal_date),
          lastPaymentAt: normalizeDateTime(subscriptionRow.last_payment_at),
          graceExpiresAt: normalizeDateTime(subscriptionRow.grace_expires_at),
          updatedAt: normalizeDateTime(subscriptionRow.updated_at),
          createdAt: normalizeDateTime(subscriptionRow.created_at),
        }
      : null,
    onboarding: onboardingRecord
      ? {
          publicId: onboardingRecord.public_id,
          status: onboardingRecord.status,
          checklistItems: onboardingChecklistState?.checklist || {},
          pendingChecklistItems: onboardingChecklistState?.pendingChecklistItems || [],
          evidence: parseJsonField(onboardingRecord.evidence_json, []),
          notes: onboardingRecord.notes || "",
          createdAt: normalizeDateTime(onboardingRecord.created_at),
          updatedAt: normalizeDateTime(onboardingRecord.updated_at),
        }
      : null,
  }
}

export async function getFieldStationSetupData({ stationPublicId }) {
  const setup = await getStationSetupData({ stationPublicId })

  return {
    station: setup.station,
    staff: setup.staff,
    tanks: setup.tanks,
    pumps: setup.pumps,
    onboarding: setup.onboarding,
  }
}

export async function updateFieldVisitWorkflow({
  actor,
  fieldVisitPublicId,
  action,
  note = "",
  evidenceUrl = "",
  connectivityStatus = "",
}) {
  const visit = await resolveFieldVisitOrThrow(fieldVisitPublicId)
  const normalizedAction = String(action || "").trim().toUpperCase()
  const normalizedNote = String(note || "").trim()
  const normalizedEvidenceUrl = String(evidenceUrl || "").trim()
  const normalizedConnectivityStatus = String(connectivityStatus || "").trim().toUpperCase()

  let nextStatus = String(visit.status || "SCHEDULED").toUpperCase()
  let nextSummary = String(visit.summary || "").trim() || null
  let nextNotes = String(visit.notes || "").trim()
  let nextEvidenceUrl = normalizedEvidenceUrl || visit.evidence_url || null
  let nextCompletedAt = visit.completed_at || null
  let nextAssignedUserId = visit.assigned_user_id || actor.userId || null
  let nextChecklist = normalizeOnboardingChecklistState(visit.checklist_json)
  let nextOnboardingNotes = String(visit.onboarding_notes || "").trim()
  const nextEvidence = normalizeOnboardingEvidence(visit.evidence_json)

  let actionType = "FIELD_VISIT_UPDATE"
  let auditSummary = `${visit.station_name} field visit updated.`
  let followUpVisitPublicId = null
  let alertPublicId = null

  const appendVisitNote = (entry) => {
    nextNotes = appendNoteEntry(nextNotes, entry)
    nextOnboardingNotes = appendNoteEntry(nextOnboardingNotes, entry)
  }

  switch (normalizedAction) {
    case "START_VISIT":
      nextStatus = "IN_PROGRESS"
      nextAssignedUserId = actor.userId
      actionType = "FIELD_VISIT_START"
      auditSummary = `Field visit started for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Field visit started on site.")
      break
    case "SUBMIT_VISIT_REPORT":
      if (!normalizedNote && !normalizedEvidenceUrl) throw badRequest("Visit report details are required")
      if (nextStatus === "SCHEDULED") nextStatus = "IN_PROGRESS"
      actionType = "FIELD_VISIT_REPORT_SUBMIT"
      auditSummary = `Field visit report submitted for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Visit report submitted.")
      if (normalizedEvidenceUrl) {
        nextEvidenceUrl = normalizedEvidenceUrl
        nextEvidence.push({
          type: "VISIT_REPORT",
          url: normalizedEvidenceUrl,
          uploadedAt: new Date().toISOString(),
          uploadedByUserId: actor.userId,
          uploadedByRoleCode: actor.primaryRole,
        })
      }
      break
    case "UPLOAD_STATION_PHOTOS":
      if (!normalizedEvidenceUrl) throw badRequest("Station photo URL is required")
      nextEvidenceUrl = normalizedEvidenceUrl
      actionType = "FIELD_VISIT_PHOTOS_UPLOAD"
      auditSummary = `Station photos uploaded for ${visit.station_name}.`
      nextEvidence.push({
        type: "STATION_PHOTOS",
        url: normalizedEvidenceUrl,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: actor.userId,
        uploadedByRoleCode: actor.primaryRole,
      })
      appendVisitNote(normalizedNote || "Station photos uploaded from field visit.")
      break
    case "UPLOAD_VERIFICATION_EVIDENCE":
      if (!normalizedEvidenceUrl) throw badRequest("Verification evidence URL is required")
      nextEvidenceUrl = normalizedEvidenceUrl
      nextChecklist.VERIFICATION_REQUIREMENTS = true
      actionType = "FIELD_VISIT_EVIDENCE_UPLOAD"
      auditSummary = `Verification evidence uploaded for ${visit.station_name}.`
      nextEvidence.push({
        type: "VERIFICATION_EVIDENCE",
        url: normalizedEvidenceUrl,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: actor.userId,
        uploadedByRoleCode: actor.primaryRole,
      })
      appendVisitNote(normalizedNote || "Verification evidence uploaded.")
      break
    case "ADD_FIELD_NOTES":
      if (!normalizedNote) throw badRequest("Field notes are required")
      actionType = "FIELD_VISIT_NOTE_ADD"
      auditSummary = `Field notes added for ${visit.station_name}.`
      appendVisitNote(normalizedNote)
      break
    case "MARK_HARDWARE_INSTALLED":
      nextChecklist.PUMP_AND_NOZZLE_SETUP = true
      if (nextStatus === "SCHEDULED") nextStatus = "IN_PROGRESS"
      actionType = "FIELD_HARDWARE_INSTALLED"
      auditSummary = `Hardware marked installed for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Station hardware installed.")
      break
    case "MARK_HARDWARE_MISSING":
      nextChecklist.PUMP_AND_NOZZLE_SETUP = false
      nextStatus = "BLOCKED"
      actionType = "FIELD_HARDWARE_MISSING"
      auditSummary = `Hardware marked missing for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Required hardware is missing on site.")
      break
    case "MARK_TRAINING_COMPLETED":
      nextChecklist.STAFF_ASSIGNMENTS = true
      if (nextStatus === "SCHEDULED") nextStatus = "IN_PROGRESS"
      actionType = "FIELD_TRAINING_COMPLETED"
      auditSummary = `Training completed for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Station training completed.")
      break
    case "MARK_TRAINING_PENDING":
      nextChecklist.STAFF_ASSIGNMENTS = false
      actionType = "FIELD_TRAINING_PENDING"
      auditSummary = `Training marked pending for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Station training remains pending.")
      break
    case "RECORD_CONNECTIVITY_STATUS":
      if (!["GOOD", "LIMITED", "OFFLINE"].includes(normalizedConnectivityStatus)) {
        throw badRequest("Connectivity status must be GOOD, LIMITED, or OFFLINE")
      }
      actionType = "FIELD_CONNECTIVITY_STATUS"
      auditSummary = `Connectivity status recorded for ${visit.station_name}.`
      appendVisitNote(
        normalizedNote
          ? `Connectivity ${normalizedConnectivityStatus}. ${normalizedNote}`
          : `Connectivity status recorded as ${normalizedConnectivityStatus}.`
      )
      break
    case "MARK_VISIT_COMPLETED":
      nextStatus = "COMPLETED"
      nextCompletedAt = new Date()
      actionType = "FIELD_VISIT_COMPLETE"
      auditSummary = `Field visit completed for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Field visit marked complete.")
      break
    case "MARK_VISIT_FAILED":
      nextStatus = "BLOCKED"
      nextCompletedAt = null
      actionType = "FIELD_VISIT_FAILED"
      auditSummary = `Field visit failed for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Field visit failed and requires intervention.")
      break
    case "REQUEST_FOLLOW_UP_VISIT":
      followUpVisitPublicId = createPublicId()
      actionType = "FIELD_VISIT_FOLLOW_UP_REQUEST"
      auditSummary = `Follow-up visit requested for ${visit.station_name}.`
      appendVisitNote(normalizedNote || "Follow-up visit requested by field agent.")
      await prisma.$executeRaw`
        INSERT INTO field_visits (
          public_id,
          station_id,
          onboarding_record_id,
          assigned_user_id,
          visit_type,
          status,
          scheduled_for,
          summary,
          notes
        )
        VALUES (
          ${followUpVisitPublicId},
          ${visit.station_id || null},
          ${visit.onboarding_record_id || null},
          ${actor.userId},
          'FOLLOW_UP',
          'SCHEDULED',
          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY),
          ${`Follow-up field visit for ${visit.station_name}.`},
          ${normalizedNote || "Follow-up visit requested."}
        )
      `
      break
    case "ESCALATE_ONBOARDING_ISSUE":
      if (!normalizedNote) throw badRequest("Escalation note is required")
      alertPublicId = createPublicId()
      actionType = "FIELD_ONBOARDING_ESCALATE"
      auditSummary = `Onboarding issue escalated for ${visit.station_name}.`
      appendVisitNote(`Escalated onboarding issue: ${normalizedNote}`)
      await prisma.$executeRaw`
        INSERT INTO dashboard_alerts (
          public_id,
          category,
          severity,
          status,
          station_id,
          user_id,
          entity_type,
          entity_public_id,
          owner_role_code,
          title,
          summary,
          metadata
        )
        VALUES (
          ${alertPublicId},
          'OPERATIONS',
          'HIGH',
          'OPEN',
          ${visit.station_id || null},
          ${actor.userId},
          'ONBOARDING_RECORD',
          ${visit.onboarding_public_id || visit.station_public_id || fieldVisitPublicId},
          'STATION_ONBOARDING_MANAGER',
          'Field onboarding issue escalated',
          ${`${visit.station_name} has an onboarding issue requiring review.`},
          ${JSON.stringify({
            fieldVisitPublicId,
            stationPublicId: visit.station_public_id || null,
            onboardingPublicId: visit.onboarding_public_id || null,
            note: normalizedNote,
            requestedByRoleCode: actor.primaryRole,
          })}
        )
      `
      break
    default:
      throw badRequest("Unsupported field workflow action")
  }

  await prisma.$executeRaw`
    UPDATE field_visits
    SET
      assigned_user_id = ${nextAssignedUserId},
      status = ${nextStatus},
      summary = ${nextSummary},
      evidence_url = ${nextEvidenceUrl},
      notes = ${nextNotes || null},
      completed_at = ${nextCompletedAt ? nextCompletedAt : null},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${visit.id}
  `

  if (visit.onboarding_record_id) {
    await prisma.$executeRaw`
      UPDATE station_onboarding_records
      SET
        assigned_user_id = COALESCE(${nextAssignedUserId}, assigned_user_id),
        checklist_json = ${JSON.stringify(nextChecklist)},
        evidence_json = ${JSON.stringify(nextEvidence)},
        notes = ${nextOnboardingNotes || null},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${visit.onboarding_record_id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType,
    targetType: "FIELD_VISIT",
    targetPublicId: fieldVisitPublicId,
    summary: auditSummary,
    severity: nextStatus === "BLOCKED" ? "HIGH" : "MEDIUM",
    metadata: {
      stationPublicId: visit.station_public_id || null,
      onboardingPublicId: visit.onboarding_public_id || null,
      followUpVisitPublicId,
      alertPublicId,
      connectivityStatus: normalizedConnectivityStatus || null,
    },
  })

  return {
    fieldVisitPublicId,
    stationPublicId: visit.station_public_id || null,
    onboardingPublicId: visit.onboarding_public_id || null,
    status: nextStatus,
    followUpVisitPublicId,
    alertPublicId,
  }
}

export async function updateStationSetupProfile({ actor, stationPublicId, payload }) {
  const patch = {
    name: payload.name,
    operator_name: payload.operatorName ?? null,
    city: payload.city ?? null,
    address: payload.address ?? null,
    timezone: payload.timezone,
    country_code: payload.countryCode,
    opening_time: payload.open24h ? "00:00:00" : (payload.openingTime ? `${payload.openingTime}:00` : null),
    closing_time: payload.open24h ? "23:59:00" : (payload.closingTime ? `${payload.closingTime}:00` : null),
    open_24h: Boolean(payload.open24h),
  }

  await patchStationProfile({
    stationPublicId,
    userId: actor.userId,
    payload: patch,
  })

  return getStationSetupData({ stationPublicId })
}

export async function submitStationForReview({ actor, stationPublicId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const onboardingRecord = await ensureOnboardingRecordForStation(station)

  await prisma.$executeRaw`
    UPDATE station_onboarding_records
    SET
      status = 'SUBMITTED',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${onboardingRecord.id}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_SUBMIT_FOR_REVIEW",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `Station ${station.name} submitted for review.`,
    severity: "MEDIUM",
  })

  return getStationSetupData({ stationPublicId })
}

export async function updateStationSubscription({ actor, stationPublicId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const subscriptionStatus = deriveEffectiveSubscriptionStatus(payload.status, payload.renewalDate)

  await prisma.$executeRaw`
    INSERT INTO station_subscription_statuses (
      station_id,
      plan_code,
      plan_name,
      status,
      monthly_fee_mwk,
      renewal_date
    )
    VALUES (
      ${station.id},
      ${payload.planCode},
      ${payload.planName},
      ${subscriptionStatus},
      ${toNumber(payload.monthlyFeeMwk || 0)},
      ${payload.renewalDate || null}
    )
    ON DUPLICATE KEY UPDATE
      plan_code = VALUES(plan_code),
      plan_name = VALUES(plan_name),
      status = VALUES(status),
      monthly_fee_mwk = VALUES(monthly_fee_mwk),
      renewal_date = VALUES(renewal_date),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_SUBSCRIPTION_UPDATE",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `Subscription updated for station ${station.name}.`,
    severity: "LOW",
    metadata: { planCode: payload.planCode, status: subscriptionStatus },
  })

  return getStationSetupData({ stationPublicId })
}

export async function searchAssignableStationManagers({ stationPublicId, search = "", limit = 12 }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const normalizedSearch = String(search || "").trim().toLowerCase()
  const searchPattern = normalizedSearch ? `%${normalizedSearch}%` : null
  const searchPrefix = normalizedSearch ? `${normalizedSearch}%` : null
  const cappedLimit = Math.min(Math.max(toCount(limit) || 12, 1), 25)

  const candidateRows = await prisma.$queryRaw`
    SELECT
      u.id,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      u.is_active,
      EXISTS(
        SELECT 1
        FROM station_staff ss_current
        WHERE ss_current.station_id = ${station.id}
          AND ss_current.user_id = u.id
          AND ss_current.is_active = 1
      ) AS assigned_to_station
    FROM users u
    WHERE EXISTS (
      SELECT 1
      FROM station_staff ss
      INNER JOIN staff_roles sr ON sr.id = ss.role_id
      WHERE ss.user_id = u.id
        AND ss.is_active = 1
        AND sr.code = 'MANAGER'
    )
      AND (
        ${searchPattern} IS NULL
        OR LOWER(COALESCE(u.public_id, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(u.full_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(u.email, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(u.phone_e164, '')) LIKE ${searchPattern}
      )
    ORDER BY
      CASE
        WHEN ${normalizedSearch || null} IS NOT NULL AND LOWER(COALESCE(u.public_id, '')) = ${normalizedSearch || null} THEN 0
        WHEN ${searchPrefix} IS NOT NULL AND LOWER(COALESCE(u.public_id, '')) LIKE ${searchPrefix} THEN 1
        WHEN ${searchPrefix} IS NOT NULL AND LOWER(COALESCE(u.full_name, '')) LIKE ${searchPrefix} THEN 2
        ELSE 3
      END,
      u.full_name ASC,
      u.public_id ASC
    LIMIT ${cappedLimit}
  `

  const candidates = normalizeRows(candidateRows)
  const userIds = candidates.map((row) => row.id).filter(Boolean)
  if (!userIds.length) {
    return { items: [] }
  }

  const assignmentRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        ss.user_id,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM station_staff ss
      INNER JOIN staff_roles sr ON sr.id = ss.role_id
      INNER JOIN stations st ON st.id = ss.station_id
      WHERE ss.user_id IN (${Prisma.join(userIds)})
        AND ss.is_active = 1
        AND sr.code = 'MANAGER'
      ORDER BY st.name ASC, st.public_id ASC
    `
  )

  const assignmentsByUserId = new Map()
  normalizeRows(assignmentRows).forEach((row) => {
    const key = Number(row.user_id)
    const current = assignmentsByUserId.get(key) || []
    current.push({
      stationPublicId: row.station_public_id,
      stationName: row.station_name,
    })
    assignmentsByUserId.set(key, current)
  })

  return {
    items: candidates.map((row) => ({
      userPublicId: row.user_public_id,
      fullName: row.full_name || "",
      email: row.email || "",
      phone: row.phone_e164 || "",
      isActive: Boolean(Number(row.is_active)),
      alreadyAssignedToStation: Boolean(Number(row.assigned_to_station)),
      managerStations: assignmentsByUserId.get(Number(row.id)) || [],
    })),
  }
}

export async function assignStationStaffMember({ actor, stationPublicId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const role = await resolveStaffRoleByCode(payload.roleCode)
  const existingUserPublicId = String(payload.existingUserPublicId || "").trim()
  const email = String(payload.email || "").trim().toLowerCase()
  const phone = String(payload.phone || "").trim()
  const fullName = String(payload.fullName || "").trim()

  let user = null
  let temporaryPassword = null
  let userRows = []

  if (existingUserPublicId) {
    if (role.code !== "MANAGER") {
      throw badRequest("Existing user assignment is only available for station managers")
    }

    user = await resolveExistingManagerUserOrThrow(existingUserPublicId)
    const needsPasswordBootstrap = !String(user.password_hash || "").trim()
    if (needsPasswordBootstrap) {
      temporaryPassword = generateTemporaryPassword()
    }
    const nextPasswordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 10) : null
    await prisma.$executeRaw`
      UPDATE users
      SET
        is_active = 1,
        password_hash = COALESCE(${nextPasswordHash}, password_hash),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${user.id}
    `
    const refreshedRows = await prisma.$queryRaw`
      SELECT id, public_id, full_name, email, phone_e164, password_hash
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `
    user = refreshedRows?.[0] || user
  } else {
    if (!fullName) throw badRequest("Staff full name is required")
    if (!email && !phone) throw badRequest("Staff email or phone is required")

    userRows = await prisma.$queryRaw`
      SELECT id, public_id, full_name, email, phone_e164, password_hash
      FROM users
      WHERE (${email || null} IS NOT NULL AND LOWER(email) = ${email || null})
         OR (${phone || null} IS NOT NULL AND phone_e164 = ${phone || null})
      LIMIT 1
    `

    user = userRows?.[0] || null

    if (!user?.id) {
      const userPublicId = createPublicId()
      temporaryPassword = generateTemporaryPassword()
      const passwordHash = await bcrypt.hash(temporaryPassword, 10)
      await prisma.$executeRaw`
        INSERT INTO users (public_id, full_name, email, phone_e164, password_hash, is_active)
        VALUES (${userPublicId}, ${fullName}, ${email || null}, ${phone || null}, ${passwordHash}, 1)
      `
      const createdRows = await prisma.$queryRaw`
        SELECT id, public_id, full_name, email, phone_e164, password_hash
        FROM users
        WHERE public_id = ${userPublicId}
        LIMIT 1
      `
      user = createdRows?.[0] || null
    } else {
      const needsPasswordBootstrap = !String(user.password_hash || "").trim()
      if (needsPasswordBootstrap) {
        temporaryPassword = generateTemporaryPassword()
      }
      const nextPasswordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 10) : null
      await prisma.$executeRaw`
        UPDATE users
        SET
          full_name = ${fullName},
          email = COALESCE(${email || null}, email),
          phone_e164 = COALESCE(${phone || null}, phone_e164),
          password_hash = COALESCE(${nextPasswordHash}, password_hash),
          is_active = 1
        WHERE id = ${user.id}
      `
      const refreshedRows = await prisma.$queryRaw`
        SELECT id, public_id, full_name, email, phone_e164, password_hash
        FROM users
        WHERE id = ${user.id}
        LIMIT 1
      `
      user = refreshedRows?.[0] || user
    }
  }

  await prisma.$executeRaw`
    INSERT INTO station_staff (station_id, user_id, role_id, is_active)
    VALUES (${station.id}, ${user.id}, ${role.id}, 1)
    ON DUPLICATE KEY UPDATE
      role_id = VALUES(role_id),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_STAFF_ASSIGN",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `${role.name} assigned for station ${station.name}.`,
    severity: "LOW",
    metadata: { roleCode: role.code, userPublicId: user?.public_id || null, credentialsIssued: Boolean(temporaryPassword) },
  })

  const setup = await getStationSetupData({ stationPublicId })

  return {
    setup,
    credential: temporaryPassword
      ? {
          fullName: user?.full_name || fullName,
          roleCode: role.code,
          loginIdentifier: user?.email || user?.phone_e164 || email || phone || null,
          temporaryPassword,
        }
      : null,
  }
}

export async function updateStationStaffMember({ actor, stationPublicId, staffId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const staff = await resolveStationStaffAssignmentOrThrow({ stationId: station.id, staffId })
  const nextFullName = payload.fullName !== undefined ? String(payload.fullName || "").trim() : String(staff.full_name || "").trim()
  const nextEmail = payload.email !== undefined ? String(payload.email || "").trim().toLowerCase() : String(staff.email || "").trim().toLowerCase()
  const nextPhone = payload.phone !== undefined ? String(payload.phone || "").trim() : String(staff.phone_e164 || "").trim()
  const nextRoleCode = payload.roleCode !== undefined ? String(payload.roleCode || "").trim().toUpperCase() : String(staff.role_code || "").trim().toUpperCase()

  if (!nextFullName) throw badRequest("Staff full name is required")
  if (!nextEmail && !nextPhone) throw badRequest("Staff email or phone is required")

  const duplicateRows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE id <> ${staff.user_id}
      AND (
        (${nextEmail || null} IS NOT NULL AND LOWER(email) = ${nextEmail || null})
        OR (${nextPhone || null} IS NOT NULL AND phone_e164 = ${nextPhone || null})
      )
    LIMIT 1
  `
  if (duplicateRows?.[0]?.id) {
    throw badRequest("Another user already uses that email or phone")
  }

  await prisma.$executeRaw`
    UPDATE users
    SET
      full_name = ${nextFullName},
      email = ${nextEmail || null},
      phone_e164 = ${nextPhone || null},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${staff.user_id}
  `

  if (nextRoleCode && nextRoleCode !== String(staff.role_code || "").trim().toUpperCase()) {
    await patchStationStaffAssignment({
      stationPublicId,
      staffId,
      userId: actor.userId,
      payload: { role: nextRoleCode },
    })
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_STAFF_UPDATE",
    targetType: "USER",
    targetPublicId: staff.user_public_id,
    summary: `${nextFullName} updated for station ${station.name}.`,
    severity: "MEDIUM",
    metadata: {
      stationPublicId: station.public_id,
      stationStaffId: staffId,
      roleCode: nextRoleCode,
      email: nextEmail || null,
      phone: nextPhone || null,
    },
  })

  return getStationSetupData({ stationPublicId })
}

export async function deleteStationStaffMember({ actor, stationPublicId, staffId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const staff = await resolveStationStaffAssignmentOrThrow({ stationId: station.id, staffId })

  if (!Boolean(Number(staff.is_active))) {
    return getStationSetupData({ stationPublicId })
  }

  const deleteStrategy = await resolveStationStaffDeleteStrategy({
    userId: staff.user_id,
    stationStaffId: staff.id,
  })

  if (deleteStrategy === "DELETE_USER") {
    await deleteStationUserCompletely({
      userId: staff.user_id,
      stationStaffId: staff.id,
    })
  } else {
    await patchStationStaffAssignment({
      stationPublicId,
      staffId,
      userId: actor.userId,
      payload: { isActive: false },
    })
    await revokeStationSessionsForUser(staff.user_id)
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_STAFF_DELETE",
    targetType: "USER",
    targetPublicId: staff.user_public_id,
    summary: `${staff.full_name || staff.user_public_id} removed from station ${station.name}.`,
    severity: "HIGH",
    metadata: {
      stationPublicId: station.public_id,
      stationStaffId: staffId,
      roleCode: staff.role_code,
      sessionsRevoked: deleteStrategy !== "DELETE_USER",
      deleteStrategy,
    },
  })

  return {
    setup: await getStationSetupData({ stationPublicId }),
    deleteStrategy,
  }
}

export async function resetStationStaffAccess({ actor, stationPublicId, staffId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const staff = await resolveStationStaffAssignmentOrThrow({ stationId: station.id, staffId })
  if (!Boolean(Number(staff.is_active))) throw badRequest("Cannot reset access for an inactive station staff member")

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  await prisma.$executeRaw`
    UPDATE users
    SET
      password_hash = ${passwordHash},
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${staff.user_id}
  `
  await revokeStationSessionsForUser(staff.user_id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_STAFF_ACCESS_RESET",
    targetType: "USER",
    targetPublicId: staff.user_public_id,
    summary: `${staff.full_name || staff.user_public_id} station access reset for ${station.name}.`,
    severity: "HIGH",
    metadata: {
      stationPublicId: station.public_id,
      stationStaffId: staffId,
      roleCode: staff.role_code,
      sessionsRevoked: true,
    },
  })

  return {
    setup: await getStationSetupData({ stationPublicId }),
    credential: {
      title: "One-time password ready",
      subtitle: "Share these login details securely. The temporary password is only shown once here.",
      fullName: staff.full_name || "-",
      loginIdentifier: staff.email || staff.phone_e164 || "-",
      temporaryPassword,
      roleCode: staff.role_code,
    },
  }
}

export async function createInternalStationTank({ actor, stationPublicId, payload }) {
  await createStationTank({ stationPublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function patchInternalStationTank({ actor, stationPublicId, tankPublicId, payload }) {
  await patchStationTank({ stationPublicId, tankPublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function createInternalStationPump({ actor, stationPublicId, payload }) {
  await createStationPump({ stationPublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function patchInternalStationPump({ actor, stationPublicId, pumpPublicId, payload }) {
  await patchStationPump({ stationPublicId, pumpPublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function deleteInternalStationPump({ actor, stationPublicId, pumpPublicId }) {
  await deleteStationPump({ stationPublicId, pumpPublicId, userId: actor.userId })
  return getStationSetupData({ stationPublicId })
}

export async function createInternalStationNozzle({ actor, stationPublicId, pumpPublicId, payload }) {
  await createStationPumpNozzle({ stationPublicId, pumpPublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function patchInternalStationNozzle({ actor, stationPublicId, nozzlePublicId, payload }) {
  await patchStationPumpNozzle({ stationPublicId, nozzlePublicId, userId: actor.userId, payload })
  return getStationSetupData({ stationPublicId })
}

export async function deleteInternalStationNozzle({ actor, stationPublicId, nozzlePublicId }) {
  await deleteStationPumpNozzle({ stationPublicId, nozzlePublicId, userId: actor.userId })
  return getStationSetupData({ stationPublicId })
}

export async function updateStationActivation({ actor, stationPublicId, isActive }) {
  const station = await resolveStationOrThrow(stationPublicId)
  let onboardingRecord = null

  if (isActive) {
    onboardingRecord = await ensureOnboardingRecordForStation(station)
    if (!onboardingRecord?.id) {
      throw badRequest("Station activation requires an onboarding record with a completed checklist")
    }

    const checklistState = await evaluateOnboardingChecklistState({
      stationId: station.id,
      checklistJson: onboardingRecord.checklist_json,
      evidenceJson: onboardingRecord.evidence_json,
    })

    if (checklistState.pendingChecklistItems.length) {
      throw badRequest(buildOnboardingChecklistGateMessage(checklistState.pendingChecklistItems))
    }

    if (!canActivateCompletedOnboarding(onboardingRecord.status)) {
      throw badRequest("Station activation requires a submitted onboarding workflow before activation")
    }
  }

  if (!isActive && String(actor?.primaryRole || "").toUpperCase() === "STATION_ONBOARDING_MANAGER") {
    const existingRows = await prisma.$queryRaw`
      SELECT public_id
      FROM dashboard_alerts
      WHERE station_id = ${station.id}
        AND entity_type = 'STATION_DEACTIVATION_REQUEST'
        AND status = 'OPEN'
      ORDER BY created_at DESC
      LIMIT 1
    `

    const existingRequest = existingRows?.[0]
    if (existingRequest?.public_id) {
      return {
        stationPublicId,
        isActive: Boolean(Number(station.is_active)),
        approvalRequired: true,
        requestPublicId: existingRequest.public_id,
      }
    }

    const requestPublicId = createPublicId()

    await prisma.$executeRaw`
      INSERT INTO dashboard_alerts (
        public_id,
        category,
        severity,
        status,
        station_id,
        user_id,
        entity_type,
        entity_public_id,
        owner_role_code,
        title,
        summary,
        metadata
      )
      VALUES (
        ${requestPublicId},
        'OPERATIONS',
        'HIGH',
        'OPEN',
        ${station.id},
        ${actor.userId},
        'STATION_DEACTIVATION_REQUEST',
        ${station.public_id},
        'PLATFORM_OWNER',
        'Station Deactivation Approval Requested',
        ${`${station.name} deactivation requires Platform Owner approval.`},
        ${JSON.stringify({
          requestType: "STATION_DEACTIVATION",
          requestedByUserId: actor.userId,
          requestedByRoleCode: actor.primaryRole,
          stationName: station.name,
          stationPublicId: station.public_id,
        })}
      )
    `

    await createInternalAuditLog({
      actorUserId: actor.userId,
      actorRoleCode: actor.primaryRole,
      actionType: "STATION_DEACTIVATION_REQUEST",
      targetType: "STATION",
      targetPublicId: stationPublicId,
      summary: `${station.name} deactivation submitted for Platform Owner approval.`,
      severity: "HIGH",
      metadata: { requestPublicId },
    })

    return {
      stationPublicId,
      isActive: true,
      approvalRequired: true,
      requestPublicId,
    }
  }

  await prisma.$executeRaw`
    UPDATE stations
    SET is_active = ${isActive ? 1 : 0}
    WHERE id = ${station.id}
  `

  if (isActive && onboardingRecord?.id && normalizeOnboardingStatus(onboardingRecord.status) !== "ACTIVATED") {
    await prisma.$executeRaw`
      UPDATE station_onboarding_records
      SET
        status = 'ACTIVATED',
        notes = ${appendNoteEntry(onboardingRecord.notes, "Station activated from internal station controls.")},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${onboardingRecord.id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: isActive ? "STATION_ACTIVATE" : "STATION_DEACTIVATE",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `${station.name} marked ${isActive ? "active" : "inactive"} by internal staff.`,
    severity: "HIGH",
    metadata: { isActive },
  })

  return { stationPublicId, isActive }
}

export async function requestStationDeletion({ actor, stationPublicId }) {
  const normalizedPrimaryRole = String(actor?.primaryRole || "").toUpperCase()
  if (normalizedPrimaryRole !== "PLATFORM_OWNER") {
    throw badRequest("Only Platform Owner can request station deletion")
  }

  const station = await resolveStationOrThrow(stationPublicId)
  const existingRows = await prisma.$queryRaw`
    SELECT public_id
    FROM dashboard_alerts
    WHERE station_id = ${station.id}
      AND entity_type = 'STATION_DELETE_REQUEST'
      AND status = 'OPEN'
    ORDER BY created_at DESC
    LIMIT 1
  `

  const existingRequest = existingRows?.[0]
  if (existingRequest?.public_id) {
    return {
      stationPublicId: station.public_id,
      approvalRequired: true,
      requestPublicId: existingRequest.public_id,
    }
  }

  const requestPublicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO dashboard_alerts (
      public_id,
      category,
      severity,
      status,
      station_id,
      user_id,
      entity_type,
      entity_public_id,
      owner_role_code,
      title,
      summary,
      metadata
    )
    VALUES (
      ${requestPublicId},
      'OPERATIONS',
      'CRITICAL',
      'OPEN',
      ${station.id},
      ${actor.userId},
      'STATION_DELETE_REQUEST',
      ${station.public_id},
      'STATION_ONBOARDING_MANAGER',
      'Station Deletion Approval Requested',
      ${`${station.name} deletion requires Station Onboarding Manager approval.`},
      ${JSON.stringify({
        requestType: "STATION_DELETE",
        requestedByUserId: actor.userId,
        requestedByRoleCode: actor.primaryRole,
        stationName: station.name,
        stationPublicId: station.public_id,
      })}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "STATION_DELETE_REQUEST",
    targetType: "STATION",
    targetPublicId: stationPublicId,
    summary: `${station.name} deletion submitted for Station Onboarding Manager approval.`,
    severity: "CRITICAL",
    metadata: { requestPublicId },
  })

  return {
    stationPublicId: station.public_id,
    approvalRequired: true,
    requestPublicId,
  }
}

export async function listStationDeactivationRequests({ actor }) {
  const normalizedPrimaryRole = String(actor?.primaryRole || "").toUpperCase()
  const rows = await prisma.$queryRaw`
    SELECT
      da.public_id,
      da.severity,
      da.status,
      da.title,
      da.summary,
      da.created_at,
      da.updated_at,
      da.entity_public_id,
      da.entity_type,
      da.owner_role_code,
      da.metadata,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.city,
      requester.public_id AS requester_public_id,
      requester.full_name AS requester_name
    FROM dashboard_alerts da
    INNER JOIN stations st ON st.id = da.station_id
    LEFT JOIN users requester ON requester.id = da.user_id
    WHERE da.entity_type IN ('STATION_DEACTIVATION_REQUEST', 'STATION_DELETE_REQUEST')
      AND (
        (${normalizedPrimaryRole} = da.owner_role_code)
        OR da.user_id = ${actor.userId}
      )
    ORDER BY
      CASE WHEN da.status = 'OPEN' THEN 0 ELSE 1 END,
      da.created_at DESC
    LIMIT 30
  `

  return normalizeRows(rows).map((row) => {
    const metadata = parseJsonField(row.metadata, {})
    const requestType = normalizeStationApprovalRequestType(row.entity_type, metadata)
    return {
      publicId: row.public_id,
      severity: row.severity,
      status: row.status,
      title: row.title,
      summary: row.summary,
      requestType,
      entityType: normalizeStationApprovalEntityType(row.entity_type),
      stationPublicId: row.station_public_id || row.entity_public_id || null,
      stationName: row.station_name || metadata.stationName || "Unknown station",
      city: row.city || null,
      requesterName: row.requester_name || metadata.requestedByName || "Internal user",
      requesterPublicId: row.requester_public_id || null,
      requestedByRoleCode: metadata.requestedByRoleCode || null,
      ownerRoleCode: row.owner_role_code || null,
      decision: metadata.decision || null,
      decisionByRoleCode: metadata.decisionByRoleCode || null,
      decidedAt: metadata.decidedAt || null,
      createdAt: normalizeDateTime(row.created_at),
      updatedAt: normalizeDateTime(row.updated_at),
      canApprove: normalizedPrimaryRole === String(row.owner_role_code || "").toUpperCase() && row.status === "OPEN",
    }
  })
}

export async function decideStationDeactivationRequest({ actor, requestPublicId, decision }) {
  const alert = await resolveDashboardAlertOrThrow(requestPublicId)
  const entityType = normalizeStationApprovalEntityType(alert.entity_type)
  if (!["STATION_DEACTIVATION_REQUEST", "STATION_DELETE_REQUEST"].includes(entityType)) {
    throw badRequest("Alert is not a station approval request")
  }
  const normalizedPrimaryRole = String(actor?.primaryRole || "").toUpperCase()
  const ownerRoleCode = String(alert.owner_role_code || "").toUpperCase()
  if (normalizedPrimaryRole !== ownerRoleCode) {
    throw badRequest("You are not allowed to decide this station approval request")
  }
  if (String(alert.status || "").toUpperCase() !== "OPEN") {
    throw badRequest("Station approval request is no longer pending")
  }

  const metadata = parseJsonField(alert.metadata, {})
  const stationPublicId = String(metadata.stationPublicId || "").trim()
  const station = await resolveStationOrThrow(stationPublicId)
  const normalizedDecision = String(decision || "").trim().toUpperCase()
  const nextMetadata = {
    ...metadata,
    decision: normalizedDecision,
    decisionByUserId: actor.userId,
    decisionByRoleCode: actor.primaryRole,
    decidedAt: new Date().toISOString(),
  }

  if (normalizedDecision !== "APPROVE" && normalizedDecision !== "REJECT") {
    throw badRequest("Unsupported station approval decision")
  }

  if (normalizedDecision === "APPROVE") {
    if (entityType === "STATION_DELETE_REQUEST") {
      await prisma.$executeRaw`
        UPDATE stations
        SET
          is_active = 0,
          deleted_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${station.id}
      `
    } else {
      await prisma.$executeRaw`
        UPDATE stations
        SET is_active = 0
        WHERE id = ${station.id}
      `
    }
  }

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      status = 'RESOLVED',
      resolved_at = CURRENT_TIMESTAMP(3),
      metadata = ${JSON.stringify(nextMetadata)}
    WHERE public_id = ${requestPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType:
      entityType === "STATION_DELETE_REQUEST"
        ? normalizedDecision === "APPROVE"
          ? "STATION_DELETE_APPROVE"
          : "STATION_DELETE_REJECT"
        : normalizedDecision === "APPROVE"
          ? "STATION_DEACTIVATION_APPROVE"
          : "STATION_DEACTIVATION_REJECT",
    targetType: "STATION",
    targetPublicId: station.public_id,
    summary:
      entityType === "STATION_DELETE_REQUEST"
        ? normalizedDecision === "APPROVE"
          ? `${station.name} deletion approved by Station Onboarding Manager.`
          : `${station.name} deletion request rejected by Station Onboarding Manager.`
        : normalizedDecision === "APPROVE"
          ? `${station.name} deactivation approved by Platform Owner.`
          : `${station.name} deactivation request rejected by Platform Owner.`,
    severity: "HIGH",
    metadata: { requestPublicId },
  })

  return {
    requestPublicId,
    stationPublicId: station.public_id,
    requestType: normalizeStationApprovalRequestType(entityType, metadata),
    decision: normalizedDecision,
    isActive: normalizedDecision === "APPROVE" ? false : Boolean(Number(station.is_active)),
  }
}

export async function updateOnboardingWorkflow({ actor, onboardingPublicId, action }) {
  const record = await resolveOnboardingRecordOrThrow(onboardingPublicId)
  const normalizedAction = String(action || "").trim().toUpperCase()
  const checklistState = await evaluateOnboardingChecklistState({
    stationId: record.station_id || null,
    checklistJson: record.checklist_json,
    evidenceJson: record.evidence_json,
  })

  let nextStatus = record.status
  let actionType = "ONBOARDING_UPDATE"
  let summary = `${record.station_name} onboarding updated.`
  let severity = "MEDIUM"

  switch (normalizedAction) {
    case "APPROVE_READINESS":
      if (checklistState.pendingChecklistItems.length) {
        throw badRequest(buildOnboardingChecklistGateMessage(checklistState.pendingChecklistItems))
      }
      nextStatus = "READY_FOR_ACTIVATION"
      actionType = "ONBOARDING_READY_FOR_ACTIVATION"
      summary = `${record.station_name} approved for activation readiness.`
      severity = "HIGH"
      break
    case "RETURN_FOR_CORRECTION":
      nextStatus = "REVIEW"
      actionType = "ONBOARDING_RETURN_FOR_CORRECTION"
      summary = `${record.station_name} returned to field operations for correction.`
      severity = "HIGH"
      break
    case "MARK_INCOMPLETE":
      nextStatus = "SUBMITTED"
      actionType = "ONBOARDING_MARKED_INCOMPLETE"
      summary = `${record.station_name} marked incomplete and returned to submitted state.`
      severity = "MEDIUM"
      break
    case "MARK_VERIFICATION_PENDING":
      nextStatus = "REVIEW"
      actionType = "ONBOARDING_VERIFICATION_PENDING"
      summary = `${record.station_name} marked as verification pending.`
      severity = "MEDIUM"
      break
    case "ACTIVATE_STATION":
      if (!record.station_id || !record.station_public_id) {
        throw badRequest("Station activation requires a station linked to the onboarding record")
      }
      if (checklistState.pendingChecklistItems.length) {
        throw badRequest(buildOnboardingChecklistGateMessage(checklistState.pendingChecklistItems))
      }
      if (String(record.status || "").toUpperCase() !== "READY_FOR_ACTIVATION") {
        throw badRequest("Station must be marked ready for activation before activation")
      }
      nextStatus = "ACTIVATED"
      actionType = "ONBOARDING_ACTIVATE_STATION"
      summary = `${record.station_name} activated from onboarding workflow.`
      severity = "HIGH"
      break
    default:
      throw badRequest("Unsupported onboarding workflow action")
  }

  await prisma.$executeRaw`
    UPDATE station_onboarding_records
    SET status = ${nextStatus}
    WHERE id = ${record.id}
  `

  if (normalizedAction === "RETURN_FOR_CORRECTION") {
    await prisma.$executeRaw`
      INSERT INTO field_visits (
        public_id,
        station_id,
        onboarding_record_id,
        assigned_user_id,
        visit_type,
        status,
        scheduled_for,
        summary,
        notes
      )
      VALUES (
        ${createPublicId()},
        ${record.station_id || null},
        ${record.id},
        ${record.assigned_user_id || null},
        'FOLLOW_UP',
        'SCHEDULED',
        DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY),
        ${`Follow-up correction visit for ${record.station_name}`},
        ${'Returned by station onboarding manager for correction.'}
      )
    `
  }

  if (normalizedAction === "ACTIVATE_STATION") {
    await prisma.$executeRaw`
      UPDATE stations
      SET is_active = 1
      WHERE id = ${record.station_id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType,
    targetType: "ONBOARDING_RECORD",
    targetPublicId: onboardingPublicId,
    summary,
    severity,
    metadata: {
      action: normalizedAction,
      stationPublicId: record.station_public_id || null,
      nextStatus,
    },
  })

  return {
    onboardingPublicId,
    stationPublicId: record.station_public_id || null,
    status: nextStatus,
  }
}

export async function getOnboardingData() {
  const rows = await prisma.$queryRaw`
    SELECT
      sor.id,
      sor.public_id,
      sor.station_id,
      COALESCE(st.public_id, NULL) AS station_public_id,
      COALESCE(st.name, sor.proposed_station_name) AS station_name,
      sor.operator_name,
      sor.city,
      sor.status,
      sor.checklist_json,
      sor.evidence_json,
      sor.notes,
      sor.created_at,
      sor.updated_at,
      u.full_name AS assigned_user_name
    FROM station_onboarding_records sor
    LEFT JOIN stations st ON st.id = sor.station_id
    LEFT JOIN users u ON u.id = sor.assigned_user_id
    ORDER BY sor.updated_at DESC
  `

  const items = await Promise.all(
    normalizeRows(rows).map(async (row) => {
      const checklistState = await evaluateOnboardingChecklistState({
        stationId: row.station_id || null,
        checklistJson: row.checklist_json,
        evidenceJson: row.evidence_json,
      })
      const evidence = parseJsonField(row.evidence_json, [])
      return {
        publicId: row.public_id,
        stationPublicId: row.station_public_id,
        stationName: row.station_name,
        operatorName: row.operator_name,
        city: row.city,
        region: getOperationalRegion(row.city),
        status: row.status,
        assignedUserName: row.assigned_user_name || null,
        pendingChecklistItems: checklistState.pendingChecklistItems,
        checklistItems: checklistState.checklist,
        evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
        delayedHours: Math.round(minutesSince(row.updated_at) / 60),
        notes: row.notes || "",
        createdAt: normalizeDateTime(row.created_at),
        updatedAt: normalizeDateTime(row.updated_at),
      }
    })
  )

  return {
    summary: {
      total: items.length,
      readyForActivation: items.filter((row) => row.status === "READY_FOR_ACTIVATION").length,
      awaitingManagerAssignment: items.filter((row) => row.pendingChecklistItems.includes("STAFF_ASSIGNMENTS")).length,
      delayedItems: items.filter((row) => row.delayedHours >= 48 && ["SUBMITTED", "REVIEW"].includes(row.status)).length,
    },
    items,
    delayedItems: items.filter((row) => row.delayedHours >= 48 && row.status !== "ACTIVATED"),
  }
}

export async function getFieldOperationsData() {
  const rows = await prisma.$queryRaw`
    SELECT
      fv.public_id,
      fv.station_id,
      fv.onboarding_record_id,
      fv.visit_type,
      fv.status,
      fv.scheduled_for,
      fv.completed_at,
      fv.summary,
      fv.evidence_url,
      fv.notes,
      u.full_name AS assigned_agent,
      sor.public_id AS onboarding_public_id,
      sor.status AS onboarding_status,
      sor.checklist_json,
      sor.evidence_json,
      COALESCE(st.name, sor.proposed_station_name, 'Unassigned station') AS station_name,
      COALESCE(st.public_id, NULL) AS station_public_id,
      COALESCE(st.city, sor.city, 'Unknown') AS city
    FROM field_visits fv
    LEFT JOIN users u ON u.id = fv.assigned_user_id
    LEFT JOIN stations st ON st.id = fv.station_id
    LEFT JOIN station_onboarding_records sor ON sor.id = fv.onboarding_record_id
    ORDER BY COALESCE(fv.scheduled_for, fv.created_at) DESC
  `

  const items = await Promise.all(
    normalizeRows(rows).map(async (row) => {
      const checklistState = await evaluateOnboardingChecklistState({
        stationId: row.station_id || null,
        checklistJson: row.checklist_json,
        evidenceJson: row.evidence_json,
      })
      return {
        publicId: row.public_id,
        stationPublicId: row.station_public_id || null,
        onboardingPublicId: row.onboarding_public_id || null,
        visitType: row.visit_type,
        status: row.status,
        stationName: row.station_name,
        city: row.city,
        region: getOperationalRegion(row.city),
        assignedAgent: row.assigned_agent,
        summary: row.summary,
        evidenceUrl: row.evidence_url,
        notes: row.notes,
        onboardingStatus: row.onboarding_status || null,
        pendingChecklistItems: checklistState.pendingChecklistItems,
        scheduledFor: normalizeDateTime(row.scheduled_for),
        completedAt: normalizeDateTime(row.completed_at),
      }
    })
  )

  return {
    summary: {
      scheduled: items.filter((row) => row.status === "SCHEDULED").length,
      inProgress: items.filter((row) => row.status === "IN_PROGRESS").length,
      blocked: items.filter((row) => row.status === "BLOCKED").length,
      completed: items.filter((row) => row.status === "COMPLETED").length,
    },
    items,
    verificationUploads: items.filter((row) => row.evidenceUrl),
    delayedVisits: items.filter((row) => row.status !== "COMPLETED" && row.scheduledFor && minutesSince(row.scheduledFor) > 120),
  }
}

export async function getSupportData() {
  const [cases, inboundTickets, refundRows, supportAgents] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        isc.public_id,
        isc.source_ticket_id,
        isc.user_id,
        isc.assigned_user_id,
        isc.priority,
        isc.status,
        isc.category,
        isc.subject,
        isc.summary,
        isc.resolution_notes,
        isc.resolved_at,
        isc.created_at,
        isc.updated_at,
        u.full_name AS assigned_agent,
        u.public_id AS assigned_user_public_id,
        customer.public_id AS user_public_id,
        customer.full_name AS user_name,
        customer.email AS user_email,
        customer.phone_e164 AS user_phone,
        st.public_id AS station_public_id,
        st.name AS station_name,
        st.city AS station_city,
        ticket.status AS source_ticket_status
      FROM internal_support_cases isc
      LEFT JOIN users u ON u.id = isc.assigned_user_id
      LEFT JOIN users customer ON customer.id = isc.user_id
      LEFT JOIN stations st ON st.id = isc.station_id
      LEFT JOIN support_tickets ticket ON ticket.id = isc.source_ticket_id
      ORDER BY FIELD(isc.priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), isc.created_at DESC
    `,
    prisma.$queryRaw`
      SELECT id, category, severity, status, title, description, screenshot_url, created_at, updated_at
      FROM support_tickets
      ORDER BY created_at DESC
      LIMIT 20
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        rr.public_id,
        rr.amount_mwk,
        rr.priority,
        rr.status,
        rr.reason,
        rr.resolution_notes,
        rr.transaction_public_id,
        rr.created_at,
        rr.reviewed_at,
        support_case.public_id AS support_case_public_id,
        st.name AS station_name,
        st.public_id AS station_public_id,
        u.full_name AS reviewed_by_name
      FROM refund_requests rr
      LEFT JOIN internal_support_cases support_case ON support_case.id = rr.support_case_id
      LEFT JOIN stations st ON st.id = rr.station_id
      LEFT JOIN users u ON u.id = rr.reviewed_by_user_id
      ORDER BY FIELD(rr.priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), rr.created_at DESC
    `, "refund_requests"),
    listActiveSupportAgents(),
  ])

  const refundRequests = normalizeRows(refundRows).map((row) => ({
    publicId: row.public_id,
    amountMwk: toNumber(row.amount_mwk),
    priority: row.priority,
    status: row.status,
    reason: row.reason,
    resolutionNotes: row.resolution_notes || null,
    transactionPublicId: row.transaction_public_id || null,
    stationName: row.station_name || null,
    stationPublicId: row.station_public_id || null,
    supportCasePublicId: row.support_case_public_id || null,
    reviewedByName: row.reviewed_by_name || null,
    createdAt: normalizeDateTime(row.created_at),
    reviewedAt: normalizeDateTime(row.reviewed_at),
  }))

  const latestRefundBySupportCasePublicId = new Map()
  refundRequests.forEach((row) => {
    const supportCasePublicId = String(row.supportCasePublicId || "").trim()
    if (!supportCasePublicId || latestRefundBySupportCasePublicId.has(supportCasePublicId)) return
    latestRefundBySupportCasePublicId.set(supportCasePublicId, row)
  })

  return {
    summary: {
      openCases: normalizeRows(cases).filter((row) => ["OPEN", "IN_PROGRESS", "ESCALATED"].includes(String(row.status || ""))).length,
      escalatedDisputes: normalizeRows(cases).filter((row) => row.status === "ESCALATED").length,
      failedPaymentIssues: normalizeRows(cases).filter((row) => row.category === "PAYMENT_FAILURE" && row.status !== "RESOLVED").length,
      refundsPendingApproval: refundRequests.filter((row) => ["PENDING_SUPPORT_REVIEW", "PENDING_FINANCE_APPROVAL"].includes(row.status)).length,
    },
    cases: normalizeRows(cases).map((row) => ({
      ...row,
      linked_refund_public_id:
        latestRefundBySupportCasePublicId.get(String(row.public_id || "").trim())?.publicId || null,
      linked_refund_status:
        latestRefundBySupportCasePublicId.get(String(row.public_id || "").trim())?.status || null,
      linked_refund_amount_mwk:
        latestRefundBySupportCasePublicId.get(String(row.public_id || "").trim())?.amountMwk || null,
      linked_refund_reason:
        latestRefundBySupportCasePublicId.get(String(row.public_id || "").trim())?.reason || null,
      created_at: normalizeDateTime(row.created_at),
      updated_at: normalizeDateTime(row.updated_at),
      resolved_at: normalizeDateTime(row.resolved_at),
    })),
    inboundTickets: normalizeRows(inboundTickets).map((row) => ({
      ...row,
      screenshot_url: row.screenshot_url || null,
      created_at: normalizeDateTime(row.created_at),
      updated_at: normalizeDateTime(row.updated_at),
    })),
    refundRequests,
    supportAgents,
  }
}

export async function getSupportCaseContext({ casePublicId }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)

  const [caseRows, transactionRows, reservationRows, queueRows, supportHistoryRows, refundHistoryRows, escalationAlert, ticketMessageThread] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        isc.public_id,
        isc.source_ticket_id,
        isc.priority,
        isc.status,
        isc.category,
        isc.subject,
        isc.summary,
        isc.resolution_notes,
        isc.created_at,
        isc.updated_at,
        isc.resolved_at,
        customer.public_id AS user_public_id,
        customer.full_name AS user_name,
        customer.email AS user_email,
        customer.phone_e164 AS user_phone,
        st.public_id AS station_public_id,
        st.name AS station_name,
        st.city,
        st.address,
        st.operator_name,
        st.is_active
      FROM internal_support_cases isc
      LEFT JOIN users customer ON customer.id = isc.user_id
      LEFT JOIN stations st ON st.id = isc.station_id
      WHERE isc.public_id = ${casePublicId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        tx.public_id,
        tx.total_amount,
        tx.litres,
        tx.payment_method,
        tx.occurred_at,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM transactions tx
      INNER JOIN stations st ON st.id = tx.station_id
      LEFT JOIN queue_entries qe ON qe.id = tx.queue_entry_id
      WHERE (${supportCase.station_id || null} IS NOT NULL AND tx.station_id = ${supportCase.station_id || null})
         OR (${supportCase.user_id || null} IS NOT NULL AND qe.user_id = ${supportCase.user_id || null})
      ORDER BY tx.occurred_at DESC
      LIMIT 12
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        ur.public_id,
        ur.status,
        ur.requested_litres,
        ur.slot_start,
        ur.slot_end,
        ur.created_at,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM user_reservations ur
      INNER JOIN stations st ON st.id = ur.station_id
      WHERE ur.user_id = ${supportCase.user_id || null}
      ORDER BY ur.created_at DESC
      LIMIT 12
    `, "user_reservations"),
    prisma.$queryRaw`
      SELECT
        qe.public_id,
        qe.status,
        qe.position,
        qe.joined_at,
        qe.called_at,
        qe.served_at,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM queue_entries qe
      INNER JOIN stations st ON st.id = qe.station_id
      WHERE qe.user_id = ${supportCase.user_id || null}
      ORDER BY qe.joined_at DESC
      LIMIT 12
    `,
    prisma.$queryRaw`
      SELECT
        isc.public_id,
        isc.subject,
        isc.status,
        isc.priority,
        isc.created_at
      FROM internal_support_cases isc
      WHERE (${supportCase.station_id || null} IS NOT NULL AND isc.station_id = ${supportCase.station_id || null})
         OR (${supportCase.user_id || null} IS NOT NULL AND isc.user_id = ${supportCase.user_id || null})
      ORDER BY isc.created_at DESC
      LIMIT 12
    `,
    optionalRows(prisma.$queryRaw`
      SELECT
        rr.public_id,
        rr.amount_mwk,
        rr.priority,
        rr.status,
        rr.reason,
        rr.transaction_public_id,
        rr.created_at,
        rr.reviewed_at,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM refund_requests rr
      LEFT JOIN stations st ON st.id = rr.station_id
      WHERE (${supportCase.id || null} IS NOT NULL AND rr.support_case_id = ${supportCase.id || null})
         OR (
           (${supportCase.user_id || null} IS NOT NULL AND rr.user_id = ${supportCase.user_id || null})
           AND (${supportCase.station_id || null} IS NULL OR rr.station_id = ${supportCase.station_id || null})
         )
         OR (
           ${supportCase.user_id || null} IS NULL
           AND (${supportCase.station_id || null} IS NOT NULL AND rr.station_id = ${supportCase.station_id || null})
         )
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT 12
    `, "refund_requests"),
    resolveLatestSupportEscalationAlert(casePublicId),
    supportCase.source_ticket_id
      ? listSupportTicketMessages(supportCase.source_ticket_id).catch((error) => {
          if (isSupportTicketMessagesTableMissingError(error)) {
            return { ticket: null, messages: [] }
          }
          throw error
        })
      : Promise.resolve({ ticket: null, messages: [] }),
  ])

  const row = caseRows?.[0] || {}
  return {
    userProfile: row.user_public_id
      ? {
          publicId: row.user_public_id,
          fullName: row.user_name,
          email: row.user_email || null,
          phone: row.user_phone || null,
        }
      : null,
    stationProfile: row.station_public_id
      ? {
          publicId: row.station_public_id,
          name: row.station_name,
          city: row.city || null,
          address: row.address || null,
          operatorName: row.operator_name || null,
          isActive: Boolean(Number(row.is_active)),
        }
      : null,
    transactions: normalizeRows(transactionRows).map((item) => ({
      publicId: item.public_id,
      stationPublicId: item.station_public_id,
      stationName: item.station_name,
      totalAmount: toNumber(item.total_amount),
      litres: toNumber(item.litres),
      paymentMethod: item.payment_method,
      occurredAt: normalizeDateTime(item.occurred_at),
    })),
    reservationHistory: normalizeRows(reservationRows).map((item) => ({
      publicId: item.public_id,
      stationPublicId: item.station_public_id,
      stationName: item.station_name,
      status: item.status,
      requestedLitres: toNumber(item.requested_litres),
      slotStart: normalizeDateTime(item.slot_start),
      slotEnd: normalizeDateTime(item.slot_end),
      createdAt: normalizeDateTime(item.created_at),
    })),
    queueHistory: normalizeRows(queueRows).map((item) => ({
      publicId: item.public_id,
      stationPublicId: item.station_public_id,
      stationName: item.station_name,
      status: item.status,
      position: toCount(item.position),
      joinedAt: normalizeDateTime(item.joined_at),
      calledAt: normalizeDateTime(item.called_at),
      servedAt: normalizeDateTime(item.served_at),
    })),
    supportHistory: normalizeRows(supportHistoryRows).map((item) => ({
      publicId: item.public_id,
      subject: item.subject,
      status: item.status,
      priority: item.priority,
      createdAt: normalizeDateTime(item.created_at),
    })),
    refundHistory: normalizeRows(refundHistoryRows).map((item) => ({
      publicId: item.public_id,
      stationPublicId: item.station_public_id || null,
      stationName: item.station_name || null,
      amountMwk: toNumber(item.amount_mwk),
      priority: item.priority,
      status: item.status,
      reason: item.reason || null,
      transactionPublicId: item.transaction_public_id || null,
      createdAt: normalizeDateTime(item.created_at),
      reviewedAt: normalizeDateTime(item.reviewed_at),
    })),
    ticketMessages: Array.isArray(ticketMessageThread?.messages) ? ticketMessageThread.messages : [],
    escalationState: escalationAlert
      ? {
          alertPublicId: escalationAlert.publicId,
          ownerRoleCode: escalationAlert.ownerRoleCode,
          awaitingSupportDecision: Boolean(escalationAlert.metadata?.awaitingSupportDecision),
          responseMessage: String(escalationAlert.metadata?.responseMessage || "").trim() || null,
          respondedAt: normalizeDateTime(escalationAlert.metadata?.respondedAt || null),
          respondedByRoleCode: String(escalationAlert.metadata?.respondedByRoleCode || "").trim() || null,
          originalOwnerRoleCode: String(escalationAlert.metadata?.originalOwnerRoleCode || "").trim() || null,
          escalationNote: String(escalationAlert.metadata?.note || "").trim() || null,
          createdAt: escalationAlert.createdAt,
          updatedAt: escalationAlert.updatedAt,
        }
      : null,
  }
}

export async function createInternalSupportCase({ actor, payload }) {
  let stationId = null
  let userId = null
  let assignedUserId = actor.userId || null

  if (payload.stationPublicId) {
    const station = await resolveStationOrThrow(payload.stationPublicId)
    stationId = station.id
  }

  if (payload.userPublicId) {
    const user = await resolveInternalUserOrThrow(payload.userPublicId)
    userId = user.id
  }

  if (payload.assigneeUserPublicId) {
    const assignee = await resolveInternalUserOrThrow(payload.assigneeUserPublicId)
    assignedUserId = assignee.id
  }

  const category = payload.caseType === "DISPUTE" ? payload.category || "QUEUE_DISPUTE" : payload.category || "GENERAL"
  const publicId = await createSupportCasePublicId({
    typeCode: mapInternalSupportCaseTypeCode({
      actorRoleCode: actor.primaryRole,
      caseType: payload.caseType,
      category,
    }),
  })

  await prisma.$executeRaw`
    INSERT INTO internal_support_cases (
      public_id,
      station_id,
      user_id,
      category,
      priority,
      status,
      assigned_user_id,
      subject,
      summary
    )
    VALUES (
      ${publicId},
      ${stationId},
      ${userId},
      ${category},
      ${payload.priority},
      'OPEN',
      ${assignedUserId},
      ${payload.subject},
      ${payload.summary}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: payload.caseType === "DISPUTE" ? "DISPUTE_CASE_CREATE" : "SUPPORT_CASE_CREATE",
    targetType: "SUPPORT_CASE",
    targetPublicId: publicId,
    summary: `${payload.caseType === "DISPUTE" ? "Dispute" : "Support"} case ${payload.subject} created.`,
    severity: payload.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
  })

  if (userId) {
    await notifySupportUserCaseStatus({
      supportCase: {
        public_id: publicId,
        source_ticket_id: null,
        user_id: userId,
        station_id: stationId,
        status: "OPEN",
      },
      title: "Support request received",
      body: "Your support request has been logged and will be reviewed by our team.",
      metadata: {
        supportStatus: "OPEN",
      },
    })
  }

  return { publicId, status: "OPEN" }
}

export async function updateSupportCaseWorkflow({ actor, casePublicId, action, note = "", assigneeUserPublicId = "", escalationTarget = "" }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)
  const normalizedAction = String(action || "").trim().toUpperCase()
  const normalizedNote = String(note || "").trim()
  const normalizedEscalationTarget = String(escalationTarget || "").trim().toUpperCase()
  let nextStatus = String(supportCase.status || "OPEN").toUpperCase()
  let nextResolutionNotes = String(supportCase.resolution_notes || "").trim()
  let nextAssignedUserId = supportCase.assigned_user_id || actor.userId || null
  let nextResolvedAt = supportCase.status === "RESOLVED" ? new Date() : null
  let alertPublicId = null
  let actionType = "SUPPORT_CASE_UPDATE"
  let auditSummary = `Support case ${supportCase.subject} updated.`

  const appendSupportNote = (prefix, value) => {
    if (!value) return
    nextResolutionNotes = appendNoteEntry(nextResolutionNotes, `${prefix}: ${value}`)
  }

  switch (normalizedAction) {
    case "ASSIGN_TICKET":
    case "REASSIGN_TICKET": {
      const targetUserPublicId = assigneeUserPublicId || actor.userPublicId || ""
      if (!targetUserPublicId) throw badRequest("Assignee is required")
      const assignee = await resolveInternalUserOrThrow(targetUserPublicId)
      nextAssignedUserId = assignee.id
      actionType = normalizedAction
      auditSummary = `Support case ${supportCase.subject} assigned.`
      appendSupportNote("Assignment", normalizedNote || `Assigned to ${assignee.full_name}`)
      break
    }
    case "ADD_INTERNAL_NOTE":
      if (!normalizedNote) throw badRequest("Internal note is required")
      actionType = "SUPPORT_CASE_NOTE"
      auditSummary = `Internal note added for ${supportCase.subject}.`
      appendSupportNote("Internal note", normalizedNote)
      break
    case "MARK_IN_PROGRESS":
      nextStatus = "IN_PROGRESS"
      nextResolvedAt = null
      actionType = "SUPPORT_CASE_IN_PROGRESS"
      auditSummary = `Support case ${supportCase.subject} moved to in progress.`
      appendSupportNote("Workflow", normalizedNote || "Marked in progress.")
      break
    case "MARK_WAITING_ON_USER":
      nextStatus = "IN_PROGRESS"
      nextResolvedAt = null
      actionType = "SUPPORT_CASE_WAITING_ON_USER"
      auditSummary = `Support case ${supportCase.subject} is waiting on user response.`
      appendSupportNote("Waiting on user", normalizedNote || "Waiting for user response or more information.")
      if (supportCase.source_ticket_id) {
        await prisma.$executeRaw`
          UPDATE support_tickets
          SET status = 'WAITING_ON_USER', updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${supportCase.source_ticket_id}
        `
      }
      break
    case "REOPEN_TICKET":
      if (
        await hasClosedRefundLinkedToSupportCase(supportCase.id)
        && !canReopenRefundLinkedSupportCase(actor?.primaryRole)
      ) {
        throw badRequest("Closed refund-linked support cases can only be reopened by the CEO.")
      }
      nextStatus = "OPEN"
      nextResolvedAt = null
      actionType = "SUPPORT_CASE_REOPEN"
      auditSummary = `Support case ${supportCase.subject} reopened.`
      appendSupportNote("Workflow", normalizedNote || "Case reopened for further review.")
      if (supportCase.source_ticket_id) {
        await prisma.$executeRaw`
          UPDATE support_tickets
          SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${supportCase.source_ticket_id}
        `
      }
      break
    case "ESCALATE_TO_FINANCE":
    case "ESCALATE_TO_OPERATIONS": {
      nextStatus = "ESCALATED"
      nextResolvedAt = null
      actionType = normalizedAction
      auditSummary = `Support case ${supportCase.subject} escalated.`
      appendSupportNote(
        "Escalation",
        normalizedNote || `Escalated to ${normalizedAction === "ESCALATE_TO_FINANCE" ? "Finance" : "Operations"}`
      )
      alertPublicId = createPublicId()
      await prisma.$executeRaw`
        INSERT INTO dashboard_alerts (
          public_id,
          category,
          severity,
          status,
          station_id,
          user_id,
          entity_type,
          entity_public_id,
          owner_role_code,
          title,
          summary,
          metadata
        )
        VALUES (
          ${alertPublicId},
          'OPERATIONS',
          'HIGH',
          'OPEN',
          ${supportCase.station_id || null},
          ${actor.userId},
          'SUPPORT_CASE',
          ${casePublicId},
          ${normalizedAction === "ESCALATE_TO_FINANCE" ? "FINANCE_MANAGER" : "NETWORK_OPERATIONS_MANAGER"},
          'Support case escalation',
          ${`${supportCase.subject} requires ${normalizedAction === "ESCALATE_TO_FINANCE" ? "finance" : "operations"} review.`},
          ${JSON.stringify({
            casePublicId,
            note: normalizedNote || null,
            escalationTarget: normalizedEscalationTarget || normalizedAction,
            originalOwnerRoleCode: normalizedAction === "ESCALATE_TO_FINANCE" ? "FINANCE_MANAGER" : "NETWORK_OPERATIONS_MANAGER",
            awaitingSupportDecision: false,
          })}
        )
      `
      break
    }
    case "APPROVE_ESCALATION_RESPONSE": {
      const escalationAlert = await resolveLatestSupportEscalationAlert(casePublicId, {
        ownerRoleCode: INTERNAL_ROLE_CODES.CUSTOMER_SUPPORT_AGENT,
        awaitingSupportDecision: true,
      })
      if (!escalationAlert?.publicId) {
        throw badRequest("No department response is waiting for support approval.")
      }
      const responseMessage = String(escalationAlert.metadata?.responseMessage || "").trim()
      if (!responseMessage) {
        throw badRequest("The escalation response is missing a message to approve.")
      }
      await respondSupportCase({
        actor,
        casePublicId,
        message: responseMessage,
      })
      await resolveOpenSupportEscalationAlerts(casePublicId, {
        closedAt: new Date().toISOString(),
        closedByRoleCode: actor.primaryRole || null,
        closedByAction: normalizedAction,
        approvedEscalationResponseAt: new Date().toISOString(),
      })
      return {
        casePublicId,
        status: "RESOLVED",
        approvedEscalationResponse: true,
      }
    }
    case "REJECT_ESCALATION_RESPONSE": {
      const escalationAlert = await resolveLatestSupportEscalationAlert(casePublicId, {
        ownerRoleCode: INTERNAL_ROLE_CODES.CUSTOMER_SUPPORT_AGENT,
        awaitingSupportDecision: true,
      })
      if (!escalationAlert?.publicId) {
        throw badRequest("No department response is waiting for support rejection.")
      }
      const nextOwnerRoleCode = String(
        escalationAlert.metadata?.originalOwnerRoleCode
        || escalationAlert.metadata?.respondedByRoleCode
        || escalationAlert.metadata?.escalationDepartmentRoleCode
        || ""
      ).trim().toUpperCase()
      if (!nextOwnerRoleCode) {
        throw badRequest("The escalation response is missing the department role to send it back to.")
      }
      nextStatus = "ESCALATED"
      nextResolvedAt = null
      actionType = "SUPPORT_ESCALATION_RESPONSE_REJECT"
      auditSummary = `Escalation response rejected for support case ${supportCase.subject}.`
      appendSupportNote("Escalation response rejected", normalizedNote || "Support requested a revised department response.")
      await prisma.$executeRaw`
        UPDATE dashboard_alerts
        SET
          owner_role_code = ${nextOwnerRoleCode},
          title = 'Support case escalation requires follow-up',
          summary = ${`${supportCase.subject} needs an updated department response after support rejected the last escalation reply.`},
          updated_at = CURRENT_TIMESTAMP(3),
          metadata = JSON_MERGE_PATCH(
            COALESCE(metadata, JSON_OBJECT()),
            ${JSON.stringify({
              awaitingSupportDecision: false,
              supportRejectedResponseAt: new Date().toISOString(),
              supportRejectedByRoleCode: actor.primaryRole || null,
              supportRejectionNote: normalizedNote || null,
            })}
          )
        WHERE public_id = ${escalationAlert.publicId}
      `
      alertPublicId = escalationAlert.publicId
      break
    }
    case "CLOSE_DISPUTE":
      nextStatus = "CLOSED"
      nextResolvedAt = new Date()
      actionType = "DISPUTE_CASE_CLOSE"
      auditSummary = `Dispute case ${supportCase.subject} closed.`
      appendSupportNote("Workflow", normalizedNote || "Dispute closed.")
      break
    default:
      throw badRequest("Unsupported support workflow action")
  }

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET
      assigned_user_id = ${nextAssignedUserId},
      status = ${nextStatus},
      resolution_notes = ${nextResolutionNotes || null},
      resolved_at = ${nextResolvedAt},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  if (nextStatus !== "ESCALATED") {
    await resolveOpenSupportEscalationAlerts(casePublicId, {
      closedAt: new Date().toISOString(),
      closedByRoleCode: actor.primaryRole || null,
      closedByAction: normalizedAction,
    })
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType,
    targetType: "SUPPORT_CASE",
    targetPublicId: casePublicId,
    summary: auditSummary,
    severity: nextStatus === "ESCALATED" ? "HIGH" : "MEDIUM",
    metadata: { alertPublicId, escalationTarget: normalizedEscalationTarget || null },
  })

  let notificationTitle = ""
  let notificationBody = ""
  switch (normalizedAction) {
    case "ASSIGN_TICKET":
    case "REASSIGN_TICKET":
      notificationTitle = "Support request assigned"
      notificationBody = "A support agent has been assigned to your request."
      break
    case "MARK_IN_PROGRESS":
      notificationTitle = "Ongoing support request"
      notificationBody = "Your request is under active review."
      break
    case "MARK_WAITING_ON_USER":
      notificationTitle = "More information needed"
      notificationBody = "Support needs more information from you to continue the request."
      break
    case "REOPEN_TICKET":
      notificationTitle = "Support request reopened"
      notificationBody = "Your request has been reopened for further review."
      break
    case "ESCALATE_TO_FINANCE":
      notificationTitle = "Request escalated"
      notificationBody = "Your support request has been escalated for finance review."
      break
    case "ESCALATE_TO_OPERATIONS":
      notificationTitle = "Request escalated"
      notificationBody = "Your support request has been escalated for operations review."
      break
    case "CLOSE_DISPUTE":
      notificationTitle = "Dispute closed"
      notificationBody = "Your dispute case has been closed."
      break
    default:
      break
  }

  if (notificationTitle) {
    await notifySupportUserCaseStatus({
      supportCase: {
        ...supportCase,
        status: nextStatus,
      },
      title: notificationTitle,
      body: notificationBody,
      metadata: {
        supportStatus: nextStatus,
        escalationTarget: normalizedEscalationTarget || null,
      },
    })
  }

  return { casePublicId, status: nextStatus, alertPublicId }
}

export async function listSupportEscalationRequests({ actor }) {
  const normalizedPrimaryRole = String(actor?.primaryRole || "").toUpperCase()
  if (!normalizedPrimaryRole) return []

  const rows = await prisma.$queryRaw`
    SELECT
      da.public_id AS alert_public_id,
      da.severity,
      da.status AS alert_status,
      da.title,
      da.summary,
      da.created_at,
      da.updated_at,
      da.owner_role_code,
      da.metadata,
      isc.public_id AS case_public_id,
      isc.status AS case_status,
      isc.priority AS case_priority,
      isc.category,
      isc.subject,
      isc.summary AS case_summary,
      isc.resolution_notes,
      isc.source_ticket_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      customer.public_id AS user_public_id,
      customer.full_name AS user_name
    FROM dashboard_alerts da
    INNER JOIN internal_support_cases isc ON isc.public_id = da.entity_public_id
    LEFT JOIN stations st ON st.id = isc.station_id
    LEFT JOIN users customer ON customer.id = isc.user_id
    WHERE da.entity_type = 'SUPPORT_CASE'
      AND da.owner_role_code = ${normalizedPrimaryRole}
      AND da.status = 'OPEN'
    ORDER BY FIELD(isc.priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), da.created_at DESC
    LIMIT 30
  `

  return normalizeRows(rows).map((row) => {
    const metadata = parseJsonField(row.metadata, {})
    return {
      alertPublicId: row.alert_public_id,
      severity: row.severity,
      alertStatus: row.alert_status,
      title: row.title,
      summary: row.summary,
      ownerRoleCode: row.owner_role_code || null,
      casePublicId: row.case_public_id,
      caseStatus: row.case_status,
      casePriority: row.case_priority,
      category: row.category,
      subject: row.subject,
      caseSummary: row.case_summary,
      resolutionNotes: row.resolution_notes || null,
      sourceTicketId: row.source_ticket_id || null,
      stationPublicId: row.station_public_id || null,
      stationName: row.station_name || null,
      userPublicId: row.user_public_id || null,
      userName: row.user_name || null,
      escalationNote: String(metadata.note || "").trim() || null,
      escalationTarget: metadata.escalationTarget || null,
      awaitingSupportDecision: Boolean(metadata.awaitingSupportDecision),
      responseMessage: String(metadata.responseMessage || "").trim() || null,
      respondedAt: normalizeDateTime(metadata.respondedAt || null),
      respondedByRoleCode: String(metadata.respondedByRoleCode || "").trim() || null,
      originalOwnerRoleCode: String(metadata.originalOwnerRoleCode || "").trim() || null,
      createdAt: normalizeDateTime(row.created_at),
      updatedAt: normalizeDateTime(row.updated_at),
    }
  })
}

export async function respondToEscalatedSupportCase({ actor, alertPublicId, message }) {
  const alert = await resolveSupportEscalationAlertOrThrow({ actor, alertPublicId })
  const supportCase = await resolveSupportCaseOrThrow(alert.entity_public_id)
  const normalizedMessage = String(message || "").trim()
  if (!normalizedMessage) throw badRequest("Escalation response is required")

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET
      resolution_notes = ${appendNoteEntry(
        supportCase.resolution_notes,
        `${String(actor.primaryRole || "").replace(/_/g, " ")} response: ${normalizedMessage}`
      )},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${supportCase.public_id}
  `

  await prisma.$executeRaw`
    UPDATE dashboard_alerts
    SET
      owner_role_code = 'CUSTOMER_SUPPORT_AGENT',
      title = 'Escalation response ready',
      summary = ${`${supportCase.subject} has a department response waiting for support approval.`},
      updated_at = CURRENT_TIMESTAMP(3),
      metadata = JSON_MERGE_PATCH(
        COALESCE(metadata, JSON_OBJECT()),
        ${JSON.stringify({
          respondedAt: new Date().toISOString(),
          respondedByRoleCode: actor.primaryRole || null,
          respondedByUserId: actor.userId || null,
          responseMessage: normalizedMessage,
          awaitingSupportDecision: true,
          escalationDepartmentRoleCode: actor.primaryRole || null,
        })}
      )
    WHERE public_id = ${alertPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SUPPORT_ESCALATION_RESPONSE",
    targetType: "SUPPORT_CASE",
    targetPublicId: supportCase.public_id,
    summary: `Escalation response recorded for support case ${supportCase.subject}.`,
    severity: "MEDIUM",
    metadata: {
      alertPublicId,
      respondedByRoleCode: actor.primaryRole || null,
    },
  })

  return {
    casePublicId: supportCase.public_id,
    status: "PENDING_SUPPORT_DECISION",
    alertPublicId,
  }
}

export async function resolveSupportCase({ actor, casePublicId }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET
      status = 'RESOLVED',
      resolved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await resolveOpenSupportEscalationAlerts(casePublicId, {
    closedAt: new Date().toISOString(),
    closedByRoleCode: actor.primaryRole || null,
    closedByAction: "RESOLVE_SUPPORT_CASE",
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SUPPORT_CASE_RESOLVE",
    targetType: "SUPPORT_CASE",
    targetPublicId: casePublicId,
    summary: `Support case ${supportCase.subject} resolved.`,
    severity: "MEDIUM",
  })

  await notifySupportUserCaseStatus({
    supportCase: {
      ...supportCase,
      status: "RESOLVED",
    },
    title: "Support request resolved",
    body: "Your support request has been resolved.",
    metadata: {
      supportStatus: "RESOLVED",
    },
  })

  return { casePublicId, status: "RESOLVED" }
}

export async function sendSupportCaseMessage({ actor, casePublicId, message }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)
  if (!supportCase.source_ticket_id) {
    throw badRequest("Support case is not linked to a ticket conversation.")
  }
  if (!isSupportConversationOpen({
    status: "OPEN",
    support_case_status: supportCase.status,
  })) {
    throw badRequest("Only open support cases can receive conversation messages.")
  }

  const responseMessage = String(message || "").trim()
  if (!responseMessage) throw badRequest("Support message is required")

  const actorProfile = actor?.userPublicId ? await resolveInternalUserOrThrow(actor.userPublicId) : null

  try {
    await appendSupportTicketMessage({
      ticketId: supportCase.source_ticket_id,
      stationPublicId: null,
      supportCasePublicId: supportCase.public_id,
      senderScope: "SUPPORT",
      senderUserPublicId: actor?.userPublicId || null,
      senderRoleCode: actor?.primaryRole || null,
      senderName: actorProfile?.full_name || "Support",
      body: responseMessage,
      updateTicketStatus: "WAITING_ON_USER",
    })
  } catch (error) {
    if (isSupportTicketMessagesTableMissingError(error)) {
      throw badRequest("Support conversation storage is unavailable. Run SQL migration 042_create_support_ticket_messages.sql.")
    }
    throw error
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SUPPORT_CASE_MESSAGE",
    targetType: "SUPPORT_CASE",
    targetPublicId: casePublicId,
    summary: `Support message sent for case ${supportCase.subject}.`,
    severity: supportCase.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
    metadata: { sourceTicketId: supportCase.source_ticket_id || null },
  })

  await notifySupportUserCaseStatus({
    supportCase: {
      ...supportCase,
      status: "IN_PROGRESS",
    },
    title: "New support message",
    body: "Support sent a new message on your ticket. Open Inbox to reply.",
    metadata: {
      supportStatus: "WAITING_ON_USER",
      path: "/inbox",
      route: "/inbox",
    },
  })

  return { casePublicId, status: supportCase.status, sent: true }
}

export async function respondSupportCase({ actor, casePublicId, message }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)
  const responseMessage = String(message || "").trim()
  if (!responseMessage) throw badRequest("Support response message is required")

  if (supportCase.source_ticket_id) {
    const actorProfile = actor?.userPublicId ? await resolveInternalUserOrThrow(actor.userPublicId) : null

    try {
      await appendSupportTicketMessage({
        ticketId: supportCase.source_ticket_id,
        stationPublicId: null,
        supportCasePublicId: supportCase.public_id,
        senderScope: "SUPPORT",
        senderUserPublicId: actor?.userPublicId || null,
        senderRoleCode: actor?.primaryRole || null,
        senderName: actorProfile?.full_name || "Support",
        body: responseMessage,
        updateTicketStatus: "RESPONDED",
      })
    } catch (error) {
      if (isSupportTicketMessagesTableMissingError(error)) {
        throw badRequest("Support conversation storage is unavailable. Run SQL migration 042_create_support_ticket_messages.sql.")
      }
      throw error
    }
  }

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET
      status = 'RESOLVED',
      assigned_user_id = ${actor.userId || supportCase.assigned_user_id || null},
      resolution_notes = ${responseMessage},
      resolved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await resolveOpenSupportEscalationAlerts(casePublicId, {
    closedAt: new Date().toISOString(),
    closedByRoleCode: actor.primaryRole || null,
    closedByAction: "RESPOND_SUPPORT_CASE",
  })

  if (supportCase.source_ticket_id) {
    await prisma.$executeRaw`
      UPDATE support_tickets
      SET
        status = 'RESPONDED',
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${supportCase.source_ticket_id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SUPPORT_CASE_RESPOND",
    targetType: "SUPPORT_CASE",
    targetPublicId: casePublicId,
    summary: `Support response sent for case ${supportCase.subject}.`,
    severity: supportCase.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
    metadata: { sourceTicketId: supportCase.source_ticket_id || null },
  })

  await notifySupportUserCaseStatus({
    supportCase: {
      ...supportCase,
      status: "RESOLVED",
    },
    title: "Support replied to your request",
    body: "A support agent responded to your request. Open Inbox to read the update.",
    metadata: {
      supportStatus: "RESOLVED",
      path: "/inbox",
      route: "/inbox",
    },
  })

  return { casePublicId, status: "RESOLVED", responseMessage }
}

export async function escalateSupportCase({ actor, casePublicId }) {
  const supportCase = await resolveSupportCaseOrThrow(casePublicId)

  await prisma.$executeRaw`
    UPDATE internal_support_cases
    SET status = 'ESCALATED', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SUPPORT_CASE_ESCALATE",
    targetType: "SUPPORT_CASE",
    targetPublicId: casePublicId,
    summary: `Support case ${supportCase.subject} escalated for further review.`,
    severity: supportCase.priority === "CRITICAL" ? "CRITICAL" : "HIGH",
  })

  return { casePublicId, status: "ESCALATED" }
}

export async function getRefundInvestigation({ actor, refundPublicId }) {
  return buildRefundInvestigationBundle({ actor, refundPublicId })
}

export async function attachRefundEvidence({
  actor,
  refundPublicId,
  evidenceType,
  sourceType = "",
  sourceId = "",
  summary,
  confidenceWeight = null,
}) {
  const refund = await resolveRefundRequestOrThrow(refundPublicId)
  await upsertRefundEvidenceRecord({
    refundId: refund.id,
    evidenceType: String(evidenceType || "").trim().toUpperCase(),
    sourceType: String(sourceType || "").trim().toUpperCase() || "INTERNAL_NOTE",
    sourceId,
    summary: String(summary || "").trim(),
    confidenceWeight: confidenceWeight === null || confidenceWeight === undefined ? null : Number(confidenceWeight),
    attachedByUserId: actor.userId,
    metadata: { manual: true },
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "REFUND_EVIDENCE_ATTACH",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: `Evidence attached to refund ${refundPublicId}.`,
    severity: "MEDIUM",
    metadata: {
      evidenceType: String(evidenceType || "").trim().toUpperCase(),
      sourceType: String(sourceType || "").trim().toUpperCase() || "INTERNAL_NOTE",
      sourceId: String(sourceId || "").trim() || null,
    },
  })

  return { refundPublicId, attached: true }
}

export async function getPumpSessionByTransaction({ refundPublicId = "", transactionPublicId = "" }) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  const resolvedTransactionPublicId = scopedTransactionPublicId
    || (refundPublicId ? (await resolveRefundRequestOrThrow(refundPublicId)).transaction_public_id : "")
  if (!resolvedTransactionPublicId) throw badRequest("Transaction public ID is required")
  const transaction = await resolveTransactionOrThrow(resolvedTransactionPublicId)
  const pumpSession = await resolvePumpSessionForTransaction({
    transactionId: transaction.id,
    transaction,
  })
  if (!pumpSession) throw notFound("Pump session not found for transaction")
  return pumpSession
}

export async function getTelemetryTimelineBySession({ sessionReference = "", transactionPublicId = "" }) {
  const scopedSessionReference = String(sessionReference || "").trim()
  if (scopedSessionReference) {
    const rows = await optionalRows(prisma.$queryRaw`
      SELECT
        ps.id,
        ps.public_id,
        ps.session_reference,
        ps.session_status,
        ps.start_time,
        ps.end_time,
        ps.dispensed_litres,
        ps.error_code,
        ps.error_message,
        ps.telemetry_correlation_id
      FROM pump_sessions ps
      WHERE ps.session_reference = ${scopedSessionReference}
         OR ps.public_id = ${scopedSessionReference}
      LIMIT 1
    `, "pump_sessions")
    const row = rows?.[0]
    if (!row?.id) throw notFound("Pump session not found")
    return listPumpTelemetryTimeline({
      pumpSession: {
        id: row.id,
        publicId: row.public_id,
        sessionReference: row.session_reference,
        status: row.session_status,
        startTime: normalizeDateTime(row.start_time),
        endTime: normalizeDateTime(row.end_time),
        dispensedLitres: toNumber(row.dispensed_litres),
        errorCode: row.error_code || null,
        errorMessage: row.error_message || null,
        telemetryCorrelationId: row.telemetry_correlation_id || null,
      },
      transaction: null,
    })
  }

  const transaction = await resolveTransactionOrThrow(String(transactionPublicId || "").trim())
  const pumpSession = await resolvePumpSessionForTransaction({
    transactionId: transaction.id,
    transaction,
  })
  return listPumpTelemetryTimeline({ pumpSession, transaction })
}

export async function escalateRefundToCompliance({ actor, refundPublicId, note = "", severity = "HIGH" }) {
  const refund = await resolveRefundRequestOrThrow(refundPublicId)
  const bundle = await buildRefundInvestigationBundle({ actor, refundPublicId })

  if (refund.compliance_case_id) {
    const existingRows = await prisma.$queryRaw`
      SELECT public_id
      FROM compliance_cases
      WHERE id = ${refund.compliance_case_id}
      LIMIT 1
    `
    const casePublicId = existingRows?.[0]?.public_id || null
    if (casePublicId) {
      return { refundPublicId, status: refund.status, complianceCasePublicId: casePublicId }
    }
  }

  const transaction = bundle.transaction
  const caseResponse = await createComplianceCase({
    actor,
    category: "REFUND_INVESTIGATION",
    severity,
    summary: `Refund ${refundPublicId} requires compliance review.`,
    stationPublicId: transaction?.stationPublicId || "",
    userPublicId: bundle.refund?.userPublicId || "",
    note: String(note || "").trim() || `Refund ${refundPublicId} escalated after suspicious evidence correlation.`,
  })
  const caseRows = await prisma.$queryRaw`
    SELECT id
    FROM compliance_cases
    WHERE public_id = ${caseResponse.casePublicId}
    LIMIT 1
  `
  const complianceCaseId = caseRows?.[0]?.id || null
  const nextResolutionNotes = appendNoteEntry(
    refund.resolution_notes,
    String(note || "").trim() || "Escalated to compliance for suspicious or conflicting evidence."
  )

  await prisma.$executeRaw`
    UPDATE refund_requests
    SET
      investigation_status = ${REFUND_INVESTIGATION_STATUSES.ESCALATED},
      review_stage = ${REFUND_REVIEW_STAGES.COMPLIANCE},
      compliance_case_id = ${complianceCaseId},
      reviewed_by_user_id = ${actor.userId},
      reviewed_at = CURRENT_TIMESTAMP(3),
      resolution_notes = ${nextResolutionNotes},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${refundPublicId}
  `

  await createRefundReviewRecord({
    refundId: refund.id,
    reviewerUserId: actor.userId,
    reviewerRole: actor.primaryRole,
    decision: "ESCALATE_COMPLIANCE",
    notes: String(note || "").trim() || "Escalated to compliance for suspicious evidence chain.",
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "REFUND_ESCALATE_COMPLIANCE",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: `Refund request ${refundPublicId} escalated to compliance.`,
    severity: "HIGH",
    metadata: {
      complianceCasePublicId: caseResponse.casePublicId,
      recommendation: bundle.assessment.recommendation,
      flags: bundle.assessment.flags,
    },
  })

  return {
    refundPublicId,
    status: refund.status,
    complianceCasePublicId: caseResponse.casePublicId,
    investigationStatus: REFUND_INVESTIGATION_STATUSES.ESCALATED,
  }
}

export async function approveSupportRefund({ actor, refundPublicId }) {
  const [refund, threshold, bundle] = await Promise.all([
    resolveRefundRequestOrThrow(refundPublicId),
    getSupportRefundThreshold(),
    buildRefundInvestigationBundle({ actor, refundPublicId }),
  ])
  const complianceMarkedFalsePositive = Boolean(bundle?.refund?.complianceMarkedFalsePositive)
  const evidenceCoverage = deriveRefundEvidenceCoverage({
    evidenceBundle: bundle?.evidenceBundle,
  })
  assertRefundStatusIn(
    refund,
    [REFUND_STATUSES.PENDING_SUPPORT_REVIEW],
    "Only refunds pending support review can be approved by support."
  )
  if (bundle.assessment.shouldEscalateToCompliance && !complianceMarkedFalsePositive) {
    throw badRequest("This refund has suspicious signals and should be escalated to compliance.")
  }
  if (bundle.assessment.recommendation === REFUND_RECOMMENDATIONS.REJECT) {
    throw badRequest("Support cannot approve this refund because the evidence chain indicates fuel was dispensed.")
  }
  if (
    !bundle.assessment.allowsSupportApproval
    && bundle.assessment.recommendation !== REFUND_RECOMMENDATIONS.APPROVE
    && !evidenceCoverage.strong
  ) {
    throw badRequest("Support approval requires strong transaction, pump-session, and telemetry evidence.")
  }

  const shouldCreditWallet = Number(refund.user_id || 0) > 0
  const payout = shouldCreditWallet && toNumber(refund.amount_mwk) <= threshold
    ? await postWalletRefund({
        userId: Number(refund.user_id),
        amount: toNumber(refund.amount_mwk),
        refundPublicId,
        actorUserId: actor.userId,
        sourceTransactionPublicId: refund.transaction_public_id || "",
        note: `Refund ${refundPublicId} approved by support.`,
      })
    : null
  const approval = resolveSupportRefundApproval({
    amountMwk: refund.amount_mwk,
    threshold,
    walletTransactionReference: payout?.transaction?.reference || "",
  })
  const nextStatus = approval.status
  const resolutionNotes = appendNoteEntry(refund.resolution_notes, approval.resolutionNotes)
  const nextInvestigationStatus = approval.forwardedToFinance
    ? REFUND_INVESTIGATION_STATUSES.ESCALATED
    : approval.credited
      ? REFUND_INVESTIGATION_STATUSES.COMPLETED
      : REFUND_INVESTIGATION_STATUSES.APPROVED
  const nextReviewStage = approval.forwardedToFinance ? REFUND_REVIEW_STAGES.FINANCE : REFUND_REVIEW_STAGES.CLOSED

  await prisma.$executeRaw`
    UPDATE refund_requests
    SET
      status = ${nextStatus},
      investigation_status = ${nextInvestigationStatus},
      review_stage = ${nextReviewStage},
      reviewed_by_user_id = ${actor.userId},
      support_reviewed_by_user_id = ${actor.userId},
      reviewed_at = CURRENT_TIMESTAMP(3),
      final_decision_at = ${approval.forwardedToFinance ? null : new Date()},
      credited_at = ${approval.credited ? new Date() : null},
      updated_at = CURRENT_TIMESTAMP(3),
      wallet_transaction_reference = ${payout?.transaction?.reference || null},
      resolution_notes = ${resolutionNotes}
    WHERE public_id = ${refundPublicId}
  `

  await createRefundReviewRecord({
    refundId: refund.id,
    reviewerUserId: actor.userId,
    reviewerRole: actor.primaryRole,
    decision: approval.forwardedToFinance ? "ESCALATE_FINANCE" : "APPROVE",
    notes: approval.resolutionNotes,
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: approval.forwardedToFinance ? "REFUND_FORWARD_FINANCE" : "REFUND_APPROVE",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: approval.forwardedToFinance
      ? `Refund request ${refundPublicId} forwarded by support to finance approval.`
      : `Refund request ${refundPublicId} approved within support threshold.`,
    severity: approval.forwardedToFinance ? "MEDIUM" : "HIGH",
    metadata: {
      amountMwk: toNumber(refund.amount_mwk),
      approvalScope: approval.forwardedToFinance ? "support_forwarded" : "support",
      walletTransactionReference: payout?.transaction?.reference || null,
    },
  })

  if (approval.forwardedToFinance) {
    await notifyRefundRequestStatus({
      refund,
      title: "Refund under finance review",
      body: "Support verified your refund request and forwarded it to finance for final approval.",
      metadata: {
        refundStatus: nextStatus,
      },
    })
  } else {
    await notifyRefundRequestStatus({
      refund,
      title: "Refund approved",
      body: payout?.transaction?.reference
        ? `MWK ${toNumber(refund.amount_mwk).toLocaleString()} has been returned to your wallet.`
        : "Your refund request was approved.",
      metadata: {
        walletTransactionReference: payout?.transaction?.reference || null,
        refundStatus: nextStatus,
      },
    })
  }

  if (
    Number(refund.support_case_id || 0) > 0
    && shouldCloseLinkedSupportCaseForRefund({
      reviewStage: nextReviewStage,
      status: nextStatus,
    })
  ) {
    await closeLinkedSupportCaseForRefund({
      supportCaseId: refund.support_case_id,
      actor,
      refundPublicId,
      resolutionNote: `Closed after refund review reached ${nextStatus}.`,
    })
  }

  return {
    refundPublicId,
    status: nextStatus,
    investigationStatus: nextInvestigationStatus,
    walletTransactionReference: payout?.transaction?.reference || null,
  }
}

export async function createSupportRefundRequest({
  actor,
  supportCasePublicId = "",
  stationPublicId = "",
  userPublicId = "",
  amountMwk,
  priority = "MEDIUM",
  reason,
  mode = "SUBMIT_APPROVAL",
  transactionPublicId = "",
}) {
  const normalizedReason = String(reason || "").trim()
  if (!normalizedReason) throw badRequest("Refund reason is required")

  const threshold = await getSupportRefundThreshold()
  let stationId = null
  let userId = null
  let supportCaseId = null
  let transactionId = null
  let normalizedTransactionPublicId = String(transactionPublicId || "").trim()
  let linkedTransaction = null

  if (supportCasePublicId) {
    const supportCase = await resolveSupportCaseOrThrow(supportCasePublicId)
    supportCaseId = supportCase.id
    stationId = supportCase.station_id || stationId
    userId = supportCase.user_id || userId
  }

  if (stationPublicId) {
    const station = await resolveStationOrThrow(stationPublicId)
    stationId = station.id
  }

  if (userPublicId) {
    const user = await resolveInternalUserOrThrow(userPublicId)
    userId = user.id
  }

  if (!normalizedTransactionPublicId && (supportCaseId || stationId || userId)) {
    const inferredTransactionRows = await optionalRows(prisma.$queryRaw`
      SELECT
        rr.transaction_id,
        rr.transaction_public_id,
        rr.requested_at,
        rr.created_at
      FROM refund_requests rr
      WHERE rr.transaction_public_id IS NOT NULL
        AND (
          (${supportCaseId || null} IS NOT NULL AND rr.support_case_id = ${supportCaseId || null})
          OR (
            ${supportCaseId || null} IS NULL
            AND (${userId || null} IS NOT NULL AND rr.user_id = ${userId || null})
            AND (${stationId || null} IS NULL OR rr.station_id = ${stationId || null})
          )
        )
      ORDER BY COALESCE(rr.requested_at, rr.created_at) DESC, rr.id DESC
      LIMIT 12
    `, "refund_requests")

    const inferredTransaction = selectUnambiguousRefundTransactionLink(inferredTransactionRows)
    if (inferredTransaction?.transactionPublicId) {
      normalizedTransactionPublicId = inferredTransaction.transactionPublicId
    }
  }

  if (normalizedTransactionPublicId) {
    linkedTransaction = await resolveTransactionOrThrow(normalizedTransactionPublicId)
    transactionId = linkedTransaction.id
    stationId = linkedTransaction.station_id || stationId
    userId = linkedTransaction.user_id || userId
  }

  const normalizedMode = String(mode || "").trim().toUpperCase()
  const issueImmediately = normalizedMode === "ISSUE"
  if (issueImmediately && toNumber(amountMwk) > threshold) {
    throw badRequest("Refund exceeds support approval threshold and must be submitted for approval.")
  }
  if (issueImmediately && !transactionId) {
    throw badRequest("A linked transaction is required to issue a refund directly.")
  }
  if (issueImmediately && linkedTransaction) {
    const [queueContext, reservationContext, paymentRecord, pumpSession] = await Promise.all([
      resolveQueueEntryContext(linkedTransaction.queue_entry_id || 0),
      resolveReservationContext(linkedTransaction.reservation_public_id || ""),
      resolveRefundPaymentRecord({
        transactionPublicId: linkedTransaction.public_id,
        reservationPublicId: linkedTransaction.reservation_public_id || "",
      }),
      resolvePumpSessionForTransaction(linkedTransaction.id),
    ])
    const effectivePaymentRecord = resolveEffectiveRefundPaymentRecord({
      transaction: linkedTransaction,
      paymentRecord,
    })
    const telemetryTimeline = await listPumpTelemetryTimeline({ pumpSession, transaction: linkedTransaction })
    const riskSignals = await resolveRefundRiskSignals({
      refund: {
        public_id: "__support_issue_precheck__",
        station_id: stationId,
        user_id: userId,
      },
      transaction: linkedTransaction,
      telemetryTimeline,
    })
    const assessment = evaluateRefundEvidence({
      paymentCaptured: String(effectivePaymentRecord?.transactionStatus || "").toUpperCase() === "POSTED",
      sessionStatus: pumpSession?.status || "",
      dispensedLitres: pumpSession?.dispensedLitres ?? linkedTransaction.litres ?? 0,
      ...riskSignals,
    })
    if (!assessment.allowsSupportApproval) {
      throw badRequest("Support can only issue direct refunds when the evidence chain is strong.")
    }
  }

  const publicId = createPublicId()
  let nextStatus = initialSupportRefundStatus({
    mode: normalizedMode,
    amountMwk,
    threshold,
  })
  let nextInvestigationStatus = issueImmediately
    ? REFUND_INVESTIGATION_STATUSES.PROCESSING
    : nextStatus === REFUND_STATUSES.PENDING_FINANCE_APPROVAL
      ? REFUND_INVESTIGATION_STATUSES.ESCALATED
      : REFUND_INVESTIGATION_STATUSES.REQUESTED
  let nextReviewStage = issueImmediately
    ? REFUND_REVIEW_STAGES.CLOSED
    : nextStatus === REFUND_STATUSES.PENDING_FINANCE_APPROVAL
      ? REFUND_REVIEW_STAGES.FINANCE
      : REFUND_REVIEW_STAGES.SUPPORT

  await prisma.$executeRaw`
    INSERT INTO refund_requests (
      public_id,
      station_id,
      user_id,
      support_case_id,
      transaction_id,
      transaction_public_id,
      amount_mwk,
      priority,
      status,
      investigation_status,
      review_stage,
      requested_by_user_id,
      reviewed_by_user_id,
      support_reviewed_by_user_id,
      reason,
      refund_reason_code,
      user_statement,
      resolution_notes,
      requested_at,
      reviewed_at
    )
    VALUES (
      ${publicId},
      ${stationId},
      ${userId},
      ${supportCaseId},
      ${transactionId},
      ${normalizedTransactionPublicId || null},
      ${toNumber(amountMwk)},
      ${priority},
      ${nextStatus},
      ${nextInvestigationStatus},
      ${nextReviewStage},
      ${actor.userId},
      ${issueImmediately ? actor.userId : null},
      ${issueImmediately ? actor.userId : null},
      ${normalizedReason},
      ${supportCasePublicId ? "SUPPORT_CASE_REFUND" : "MANUAL_SUPPORT_REFUND"},
      ${normalizedReason},
      ${issueImmediately
        ? "Issued by support within threshold."
        : nextStatus === REFUND_STATUSES.PENDING_FINANCE_APPROVAL
          ? "Submitted by support for finance approval."
          : "Submitted by support for support review."},
      CURRENT_TIMESTAMP(3),
      ${issueImmediately ? new Date() : null}
    )
  `

  let walletTransactionReference = null
  if (issueImmediately && Number(userId || 0) > 0) {
    const payout = await postWalletRefund({
      userId: Number(userId),
      amount: toNumber(amountMwk),
      refundPublicId: publicId,
      actorUserId: actor.userId,
      sourceTransactionPublicId: transactionPublicId || "",
      note: `Refund ${publicId} issued by support.`,
    })
    walletTransactionReference = payout?.transaction?.reference || null
    if (walletTransactionReference) {
      nextStatus = "PAID"
      nextInvestigationStatus = REFUND_INVESTIGATION_STATUSES.COMPLETED
      await prisma.$executeRaw`
        UPDATE refund_requests
        SET
          status = 'PAID',
          investigation_status = ${REFUND_INVESTIGATION_STATUSES.COMPLETED},
          wallet_transaction_reference = ${walletTransactionReference},
          credited_at = CURRENT_TIMESTAMP(3),
          final_decision_at = CURRENT_TIMESTAMP(3),
          resolution_notes = 'Issued by support within threshold and credited to wallet.',
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE public_id = ${publicId}
      `
    } else {
      nextInvestigationStatus = REFUND_INVESTIGATION_STATUSES.APPROVED
      await prisma.$executeRaw`
        UPDATE refund_requests
        SET
          investigation_status = ${REFUND_INVESTIGATION_STATUSES.APPROVED},
          final_decision_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE public_id = ${publicId}
      `
    }
  }

  if (issueImmediately) {
    await createRefundReviewRecord({
      refundId: (await resolveRefundRequestOrThrow(publicId)).id,
      reviewerUserId: actor.userId,
      reviewerRole: actor.primaryRole,
      decision: "APPROVE",
      notes: walletTransactionReference
        ? "Support issued the refund and credited the wallet."
        : "Support issued the refund within threshold.",
    })
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: issueImmediately ? "REFUND_ISSUE" : "REFUND_SUBMIT_FOR_APPROVAL",
    targetType: "REFUND_REQUEST",
    targetPublicId: publicId,
    summary: issueImmediately ? `Refund ${publicId} issued by support.` : `Refund ${publicId} submitted for approval.`,
    severity: toNumber(amountMwk) > threshold ? "HIGH" : "MEDIUM",
    metadata: {
      amountMwk: toNumber(amountMwk),
      supportCasePublicId: supportCasePublicId || null,
      transactionPublicId: normalizedTransactionPublicId || null,
      walletTransactionReference,
    },
  })

  if (issueImmediately) {
    await notifyRefundRequestStatus({
      refund: {
        public_id: publicId,
        station_id: stationId,
        user_id: userId,
        transaction_public_id: transactionPublicId || null,
      },
      title: "Refund issued",
      body: walletTransactionReference
        ? `MWK ${toNumber(amountMwk).toLocaleString()} has been credited to your wallet.`
        : "Your refund has been issued.",
      metadata: {
        walletTransactionReference,
        refundStatus: nextStatus,
      },
    })
  }

  if (
    Number(supportCaseId || 0) > 0
    && shouldCloseLinkedSupportCaseForRefund({
      reviewStage: nextReviewStage,
      status: nextStatus,
    })
  ) {
    await closeLinkedSupportCaseForRefund({
      supportCaseId,
      actor,
      refundPublicId: publicId,
      resolutionNote: `Closed after refund review reached ${nextStatus}.`,
    })
  }

  return {
    refundPublicId: publicId,
    status: nextStatus,
    investigationStatus: nextInvestigationStatus,
    walletTransactionReference,
  }
}

export async function rejectSupportRefund({ actor, refundPublicId, reason = "" }) {
  const refund = await resolveRefundRequestOrThrow(refundPublicId)
  assertRefundStatusIn(
    refund,
    [REFUND_STATUSES.PENDING_SUPPORT_REVIEW],
    "Only refunds pending support review can be rejected by support."
  )
  const normalizedReason = String(reason || "").trim() || "Rejected by support review."

  await prisma.$executeRaw`
    UPDATE refund_requests
    SET
      status = 'REJECTED',
      investigation_status = ${REFUND_INVESTIGATION_STATUSES.REJECTED},
      review_stage = ${REFUND_REVIEW_STAGES.CLOSED},
      reviewed_by_user_id = ${actor.userId},
      support_reviewed_by_user_id = ${actor.userId},
      reviewed_at = CURRENT_TIMESTAMP(3),
      final_decision_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3),
      resolution_notes = ${appendNoteEntry(refund.resolution_notes, normalizedReason)}
    WHERE public_id = ${refundPublicId}
  `

  await createRefundReviewRecord({
    refundId: refund.id,
    reviewerUserId: actor.userId,
    reviewerRole: actor.primaryRole,
    decision: "REJECT",
    notes: normalizedReason,
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "REFUND_REJECT",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: `Refund request ${refundPublicId} rejected by support.`,
    severity: "MEDIUM",
    metadata: { amountMwk: toNumber(refund.amount_mwk) },
  })

  await notifyRefundRequestStatus({
    refund,
    title: "Refund request rejected",
    body: normalizedReason,
    metadata: {
      refundStatus: "REJECTED",
    },
  })

  if (
    Number(refund.support_case_id || 0) > 0
    && shouldCloseLinkedSupportCaseForRefund({
      reviewStage: REFUND_REVIEW_STAGES.CLOSED,
      status: "REJECTED",
    })
  ) {
    await closeLinkedSupportCaseForRefund({
      supportCaseId: refund.support_case_id,
      actor,
      refundPublicId,
      resolutionNote: "Closed after refund was rejected during support review.",
    })
  }

  return { refundPublicId, status: "REJECTED" }
}

export async function getFinanceData() {
  await syncOverdueStationSubscriptions()
  const [
    ledger,
    settlements,
    billing,
    refundRows,
    subscriptionRows,
    financeAuditRows,
    transactionReviewCaseRows,
    reconciliationRuns,
    reconciliationExceptions,
    walletAdjustmentRows,
    todaySettlementRevenueRow,
    settlementAlertRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT tx.public_id, tx.occurred_at, tx.total_amount, tx.litres, tx.payment_method, tx.station_id,
             tx.status, tx.settlement_impact_status, tx.workflow_reason_code, tx.workflow_note, tx.cancelled_at,
             st.public_id AS station_public_id, st.name AS station_name
      FROM transactions tx
      LEFT JOIN stations st ON st.id = tx.station_id
      ORDER BY occurred_at DESC
      LIMIT 40
    `,
    prisma.$queryRaw`
      SELECT
        sb.id,
        sb.public_id,
        sb.station_id,
        st.name AS station_name,
        st.public_id AS station_public_id,
        sb.batch_date,
        sb.gross_amount,
        sb.fee_amount,
        sb.net_amount,
        sb.status,
        sb.created_at,
        sb.approved_at,
        sb.related_entity_type,
        sb.related_entity_id,
        sb.source_transaction_reference,
        sb.metadata_json
      FROM settlement_batches sb
      INNER JOIN stations st ON st.id = sb.station_id
      ORDER BY sb.batch_date DESC, sb.created_at DESC
    `,
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(batch_date, '%Y-%m') AS billing_month,
        COUNT(*) AS settlement_count,
        COALESCE(SUM(net_amount), 0) AS net_settled,
        COALESCE(SUM(fee_amount), 0) AS platform_fees
      FROM settlement_batches
      GROUP BY DATE_FORMAT(batch_date, '%Y-%m')
      ORDER BY billing_month DESC
      LIMIT 6
    `,
    optionalRows(prisma.$queryRaw`
      SELECT rr.public_id, rr.amount_mwk, rr.priority, rr.status, rr.reason, rr.resolution_notes, rr.created_at, rr.reviewed_at,
             rr.transaction_public_id, support_case.public_id AS support_case_public_id, ticket.screenshot_url,
             st.public_id AS station_public_id, st.name AS station_name,
             cc.public_id AS compliance_case_public_id, cc.status AS compliance_case_status, cc.action_taken AS compliance_case_action_taken,
             EXISTS(
               SELECT 1
               FROM internal_audit_log ial
               WHERE ial.target_type = 'COMPLIANCE_CASE'
                 AND ial.target_public_id = cc.public_id
                 AND ial.action_type = 'COMPLIANCE_MARK_FALSE_POSITIVE'
             ) AS compliance_case_false_positive_audit
      FROM refund_requests rr
      LEFT JOIN internal_support_cases support_case ON support_case.id = rr.support_case_id
      LEFT JOIN support_tickets ticket ON ticket.id = support_case.source_ticket_id
      LEFT JOIN stations st ON st.id = rr.station_id
      LEFT JOIN compliance_cases cc ON cc.id = rr.compliance_case_id
      ORDER BY created_at DESC
    `, "refund_requests"),
    optionalRows(prisma.$queryRaw`
      SELECT
        st.public_id AS station_public_id,
        st.name AS station_name,
        sss.plan_code,
        sss.plan_name,
        sss.status,
        sss.monthly_fee_mwk,
        sss.renewal_date,
        sss.last_payment_at,
        sss.grace_expires_at,
        sss.updated_at
      FROM station_subscription_statuses sss
      INNER JOIN stations st ON st.id = sss.station_id
      ORDER BY FIELD(sss.status, 'OVERDUE', 'GRACE', 'PAUSED', 'ACTIVE', 'TRIAL'), sss.renewal_date ASC, st.name ASC
    `, "station_subscription_statuses"),
    optionalRows(prisma.$queryRaw`
      SELECT public_id, action_type, target_type, target_public_id, summary, severity, created_at
      FROM internal_audit_log
      WHERE action_type LIKE 'SETTLEMENT_%'
        OR action_type LIKE 'REFUND_%'
        OR action_type LIKE 'TRANSACTION_%'
        OR action_type LIKE '%RECONCILIATION%'
        OR action_type LIKE 'WALLET_%'
        OR action_type LIKE 'SUBSCRIPTION_%'
      ORDER BY created_at DESC
      LIMIT 12
    `, "internal_audit_log"),
    optionalRows(prisma.$queryRaw`
      SELECT
        ial.target_public_id AS transaction_public_id,
        JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId')) AS case_public_id,
        cc.status AS case_status,
        cc.severity AS case_severity,
        cc.summary AS case_summary,
        cc.action_taken AS case_action_taken,
        assigned_user.full_name AS assigned_user_name,
        ial.created_at
      FROM internal_audit_log ial
      LEFT JOIN compliance_cases cc
        ON cc.public_id = JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
      LEFT JOIN users assigned_user ON assigned_user.id = cc.assigned_user_id
      WHERE ial.target_type = 'TRANSACTION'
        AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
      ORDER BY ial.created_at DESC
      LIMIT 200
    `, "internal_audit_log"),
    optionalRows(prisma.$queryRaw`
      SELECT
        frr.public_id,
        frr.status,
        frr.notes,
        frr.started_at,
        frr.completed_at,
        starter.full_name AS started_by_name,
        completer.full_name AS completed_by_name,
        COUNT(fre.id) AS exception_count
      FROM finance_reconciliation_runs frr
      LEFT JOIN users starter ON starter.id = frr.started_by_user_id
      LEFT JOIN users completer ON completer.id = frr.completed_by_user_id
      LEFT JOIN finance_reconciliation_exceptions fre ON fre.run_id = frr.id AND fre.status = 'OPEN'
      GROUP BY frr.id, frr.public_id, frr.status, frr.notes, frr.started_at, frr.completed_at, starter.full_name, completer.full_name
      ORDER BY frr.started_at DESC
      LIMIT 12
    `, "finance_reconciliation_runs"),
    optionalRows(prisma.$queryRaw`
      SELECT
        fre.public_id,
        fre.exception_type,
        fre.severity,
        fre.status,
        fre.summary,
        fre.detail,
        fre.created_at,
        frr.public_id AS run_public_id
      FROM finance_reconciliation_exceptions fre
      INNER JOIN finance_reconciliation_runs frr ON frr.id = fre.run_id
      ORDER BY fre.created_at DESC
      LIMIT 20
    `, "finance_reconciliation_exceptions"),
    optionalRows(prisma.$queryRaw`
      SELECT
        war.public_id,
        war.amount_mwk,
        war.direction,
        war.status,
        war.reason,
        war.note,
        war.approved_at,
        war.created_at,
        st.public_id AS station_public_id,
        st.name AS station_name
      FROM wallet_adjustment_requests war
      LEFT JOIN stations st ON st.id = war.station_id
      ORDER BY war.created_at DESC
      LIMIT 20
    `, "wallet_adjustment_requests"),
    optionalSingletonRow(prisma.$queryRaw`
      SELECT COALESCE(SUM(fee_amount), 0) AS today_revenue
      FROM settlement_batches
      WHERE batch_date = CURRENT_DATE()
    `, "settlement_batches"),
    optionalRows(prisma.$queryRaw`
      SELECT
        da.public_id,
        da.severity,
        da.title,
        da.summary,
        da.entity_public_id,
        da.created_at,
        st.name AS station_name,
        st.public_id AS station_public_id
      FROM dashboard_alerts da
      LEFT JOIN stations st ON st.id = da.station_id
      WHERE da.status = 'OPEN'
        AND da.owner_role_code = ${SETTLEMENT_INTEGRITY_ALERT_OWNER_ROLE}
        AND da.entity_type = ${SETTLEMENT_INTEGRITY_ALERT_ENTITY_TYPE}
      ORDER BY da.created_at DESC
      LIMIT 12
    `, "dashboard_alerts"),
  ])

  const settlementItems = await Promise.all(
    normalizeRows(settlements).map(async (row) => {
      const metadata = parseJsonField(row.metadata_json, {})
      let integrityReview =
        metadata?.integrityReview && typeof metadata.integrityReview === "object"
          ? metadata.integrityReview
          : null

      if (String(row.status || "").toUpperCase() !== "PAID") {
        const liveReview = await evaluateSettlementBatchIntegrity(prisma, {
          stationId: row.station_id,
          batchDate: row.batch_date,
        })

        if (settlementIntegrityReviewChanged(integrityReview, liveReview)) {
          integrityReview = await syncSettlementBatchIntegrityState(prisma, {
            batch: {
              id: row.id,
              public_id: row.public_id,
              station_id: row.station_id,
              station_public_id: row.station_public_id,
              station_name: row.station_name,
              batch_date: row.batch_date,
              metadata_json: row.metadata_json,
            },
            actor: null,
            trigger: "FINANCE_DATA_REFRESH",
          })
          metadata.integrityReview = integrityReview
        }
      }

      return {
        publicId: row.public_id,
        stationPublicId: row.station_public_id || null,
        stationName: row.station_name,
        batchDate: row.batch_date,
        grossAmount: toNumber(row.gross_amount),
        feeAmount: toNumber(row.fee_amount),
        netAmount: toNumber(row.net_amount),
        status: row.status,
        relatedEntityType: row.related_entity_type || null,
        relatedEntityId: row.related_entity_id || null,
        sourceTransactionReference: row.source_transaction_reference || null,
        metadata,
        integrityReview,
        createdAt: normalizeDateTime(row.created_at),
        approvedAt: normalizeDateTime(row.approved_at),
      }
    })
  )

  const settlementAlertsMap = new Map()
  normalizeRows(settlementAlertRows).forEach((row) => {
    const batchPublicId = row.entity_public_id || row.public_id
    if (!batchPublicId) return
    settlementAlertsMap.set(batchPublicId, {
      publicId: row.public_id,
      severity: String(row.severity || "").toUpperCase() || "MEDIUM",
      title: row.title || SETTLEMENT_INTEGRITY_ALERT_TITLE,
      summary: row.summary || "",
      batchPublicId,
      stationName: row.station_name || null,
      stationPublicId: row.station_public_id || null,
      createdAt: normalizeDateTime(row.created_at),
    })
  })
  settlementItems.forEach((row) => {
    if (!row.integrityReview?.flagged) return
    settlementAlertsMap.set(row.publicId, {
      publicId: `settlement-integrity-${row.publicId}`,
      severity: String(row.integrityReview.severity || "").toUpperCase() || "MEDIUM",
      title: row.integrityReview.headline || SETTLEMENT_INTEGRITY_ALERT_TITLE,
      summary: row.integrityReview.summary || "Settlement batch requires integrity review.",
      batchPublicId: row.publicId,
      stationName: row.stationName || null,
      stationPublicId: row.stationPublicId || null,
      createdAt: row.integrityReview.checkedAt || row.createdAt || null,
    })
  })
  const settlementAlerts = [...settlementAlertsMap.values()].sort(
    (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
  )

  const refundRequests = normalizeRows(refundRows).map((row) => ({
    publicId: row.public_id,
    amountMwk: toNumber(row.amount_mwk),
    priority: row.priority,
    status: row.status,
    reason: row.reason,
    resolutionNotes: row.resolution_notes || null,
    transactionPublicId: row.transaction_public_id || null,
    supportCasePublicId: row.support_case_public_id || null,
    evidenceUrl: row.screenshot_url || null,
    stationPublicId: row.station_public_id || null,
    stationName: row.station_name || null,
    complianceCasePublicId: row.compliance_case_public_id || null,
    complianceCaseStatus: row.compliance_case_status || null,
    complianceMarkedFalsePositive:
      hasComplianceFalsePositiveDisposition({
        status: row.compliance_case_status,
        action_taken: row.compliance_case_action_taken,
      })
      || Boolean(Number(row.compliance_case_false_positive_audit || 0)),
    createdAt: normalizeDateTime(row.created_at),
    reviewedAt: normalizeDateTime(row.reviewed_at),
  }))

  const subscriptionBilling = normalizeRows(subscriptionRows).map((row) => ({
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    planCode: row.plan_code,
    planName: row.plan_name,
    status: deriveEffectiveSubscriptionStatus(row.status, row.renewal_date),
    monthlyFeeMwk: toNumber(row.monthly_fee_mwk),
    renewalDate: normalizeDateOnly(row.renewal_date),
    lastPaymentAt: normalizeDateTime(row.last_payment_at),
    graceExpiresAt: normalizeDateTime(row.grace_expires_at),
    updatedAt: normalizeDateTime(row.updated_at),
  }))

  const financeAudit = normalizeRows(financeAuditRows).map((row) => ({
    publicId: row.public_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    summary: row.summary,
    severity: row.severity,
    createdAt: normalizeDateTime(row.created_at),
  }))

  const latestTransactionReviewCaseByTransactionId = new Map()
  normalizeRows(transactionReviewCaseRows).forEach((row) => {
    const transactionPublicId = row.transaction_public_id
    if (!transactionPublicId || latestTransactionReviewCaseByTransactionId.has(transactionPublicId)) return
    latestTransactionReviewCaseByTransactionId.set(transactionPublicId, {
      publicId: row.case_public_id || null,
      status: row.case_status || null,
      severity: row.case_severity || null,
      summary: row.case_summary || null,
      assignedOfficer: row.assigned_user_name || null,
      actionTaken: row.case_action_taken || null,
      createdAt: normalizeDateTime(row.created_at),
    })
  })

  const reconciliationItems = normalizeRows(reconciliationRuns).map((row) => ({
    publicId: row.public_id,
    status: row.status,
    notes: row.notes || null,
    startedAt: normalizeDateTime(row.started_at),
    completedAt: normalizeDateTime(row.completed_at),
    startedByName: row.started_by_name || null,
    completedByName: row.completed_by_name || null,
    exceptionCount: toCount(row.exception_count),
  }))

  const reconciliationExceptionItems = normalizeRows(reconciliationExceptions).map((row) => ({
    publicId: row.public_id,
    runPublicId: row.run_public_id,
    exceptionType: row.exception_type,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    detail: row.detail || null,
    createdAt: normalizeDateTime(row.created_at),
  }))

  const walletAdjustments = normalizeRows(walletAdjustmentRows).map((row) => ({
    publicId: row.public_id,
    stationPublicId: row.station_public_id || null,
    stationName: row.station_name || "Platform",
    amountMwk: toNumber(row.amount_mwk),
    direction: row.direction,
    status: row.status,
    reason: row.reason,
    note: row.note || null,
    approvedAt: normalizeDateTime(row.approved_at),
    createdAt: normalizeDateTime(row.created_at),
  }))

  const walletLedger = [
    ...normalizeRows(ledger).map((row) => ({
      publicId: row.public_id,
      type: "CUSTOMER_PAYMENT",
      stationName: row.station_name || "Station",
      amountMwk: toNumber(row.total_amount),
      direction: "CREDIT",
      status: "RECORDED",
      detail: row.payment_method,
      occurredAt: normalizeDateTime(row.occurred_at),
    })),
    ...settlementItems
      .filter((row) => row.status === "PAID")
      .map((row) => ({
        publicId: row.publicId,
        type: "STATION_SETTLEMENT",
        stationName: row.stationName,
        amountMwk: toNumber(row.netAmount),
        direction: "DEBIT",
        status: row.status,
        detail: row.batchDate || "",
        occurredAt: row.approvedAt || row.createdAt,
      })),
    ...refundRequests
      .filter((row) => ["APPROVED", "PAID"].includes(String(row.status || "").toUpperCase()))
      .map((row) => ({
        publicId: row.publicId,
        type: "CUSTOMER_REFUND",
        stationName: row.stationName || "Station",
        amountMwk: toNumber(row.amountMwk),
        direction: "DEBIT",
        status: row.status,
        detail: row.reason || "",
        occurredAt: row.reviewedAt || row.createdAt,
      })),
    ...walletAdjustments
      .filter((row) => row.status === "APPROVED")
      .map((row) => ({
        publicId: row.publicId,
        type: "WALLET_ADJUSTMENT",
        stationName: row.stationName,
        amountMwk: toNumber(row.amountMwk),
        direction: row.direction,
        status: row.status,
        detail: row.reason,
        occurredAt: row.approvedAt || row.createdAt,
      })),
  ].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime())

  return {
    summary: {
      todayRevenue: toNumber(todaySettlementRevenueRow.today_revenue),
      unsettledValue: settlementItems
        .filter((row) => ["PENDING", "UNDER_REVIEW", "HELD"].includes(row.status))
        .reduce((sum, row) => sum + toNumber(row.netAmount), 0),
      payoutBatchesPending: settlementItems.filter((row) => ["PENDING", "UNDER_REVIEW"].includes(row.status)).length,
      flaggedSettlementBatches: settlementAlerts.length,
      refundRequestsPending: refundRequests.filter((row) => ["PENDING_SUPPORT_REVIEW", "PENDING_FINANCE_APPROVAL"].includes(row.status)).length,
      overdueAccounts: subscriptionBilling.filter((row) => ["OVERDUE", "GRACE"].includes(String(row.status || "").toUpperCase())).length,
      openReconciliationExceptions: reconciliationExceptionItems.filter((row) => row.status === "OPEN").length,
    },
    ledger: normalizeRows(ledger).map((row) => ({
      reviewCase: latestTransactionReviewCaseByTransactionId.get(row.public_id) || null,
      publicId: row.public_id,
      occurredAt: normalizeDateTime(row.occurred_at),
      totalAmount: toNumber(row.total_amount),
      litres: toNumber(row.litres),
      paymentMethod: row.payment_method,
      status: row.status || "RECORDED",
      settlementImpactStatus: row.settlement_impact_status || "UNCHANGED",
      workflowReasonCode: row.workflow_reason_code || null,
      workflowNote: row.workflow_note || null,
      cancelledAt: normalizeDateTime(row.cancelled_at),
      stationId: row.station_id,
      stationPublicId: row.station_public_id || null,
      stationName: row.station_name || null,
    })),
    settlements: settlementItems,
    settlementAlerts,
    billingOverview: normalizeRows(billing).map((row) => ({
      billingMonth: row.billing_month,
      settlementCount: toCount(row.settlement_count),
      netSettled: toNumber(row.net_settled),
      platformFees: toNumber(row.platform_fees),
    })),
    refundRequests,
    subscriptionBilling,
    financeAudit,
    walletLedger,
    reconciliationRuns: reconciliationItems,
    reconciliationExceptions: reconciliationExceptionItems,
    walletAdjustments,
  }
}

export async function createSettlementBatch({ actor, stationPublicId, batchDate, grossAmount, feeAmount = 0 }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const { grossAmount: normalizedGross, feeAmount: normalizedFee, netAmount } =
    calculateSettlementAmounts(grossAmount)

  if (normalizedGross <= 0) throw badRequest("Gross amount must be greater than zero")
  if (netAmount < 0) throw badRequest("Net amount cannot be negative")
  void feeAmount

  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO settlement_batches (
      public_id,
      station_id,
      batch_date,
      gross_amount,
      fee_amount,
      net_amount,
      status
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${batchDate},
      ${normalizedGross},
      ${normalizedFee},
      ${netAmount},
      'PENDING'
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SETTLEMENT_BATCH_CREATE",
    targetType: "SETTLEMENT_BATCH",
    targetPublicId: publicId,
    summary: `Settlement batch created for ${station.name}.`,
    severity: "HIGH",
    metadata: { stationPublicId, batchDate, grossAmount: normalizedGross, feeAmount: normalizedFee, netAmount },
  })

  const batch = await resolveSettlementBatchOrThrow(publicId)
  const integrityReview = await syncSettlementBatchIntegrityState(prisma, {
    batch,
    actor,
    trigger: "SETTLEMENT_BATCH_CREATE",
  })

  if (integrityReview.flagged) {
    await prisma.$executeRaw`
      UPDATE settlement_batches
      SET status = 'UNDER_REVIEW', updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${batch.id}
        AND status = 'PENDING'
    `
    return { batchPublicId: publicId, status: "UNDER_REVIEW", integrityReview }
  }

  return { batchPublicId: publicId, status: "PENDING", integrityReview }
}

export async function flagTransactionForReview({ actor, transactionPublicId, note = "", severity = "MEDIUM" }) {
  const transaction = await resolveTransactionOrThrow(transactionPublicId)
  const casePublicId = createPublicId()
  const normalizedNote = String(note || "").trim()
  const normalizedSeverity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(severity || "").toUpperCase())
    ? String(severity || "").toUpperCase()
    : "MEDIUM"

  await prisma.$executeRaw`
    INSERT INTO compliance_cases (
      public_id,
      station_id,
      category,
      severity,
      status,
      summary,
      action_taken
    )
    VALUES (
      ${casePublicId},
      ${transaction.station_id},
      'TRANSACTION_REVIEW',
      ${normalizedSeverity},
      'OPEN',
      ${`Transaction ${transaction.public_id} flagged for finance review.`},
      ${normalizedNote || null}
    )
  `

  await updateTransactionWorkflow({
    transaction,
    actor,
    status: "UNDER_REVIEW",
    settlementImpactStatus: transaction.settlement_impact_status,
    reasonCode: "FINANCE_FLAGGED_REVIEW",
    note: normalizedNote || "Transaction flagged for finance review.",
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "TRANSACTION_FLAG_REVIEW",
    targetType: "TRANSACTION",
    targetPublicId: transactionPublicId,
    summary: `Transaction ${transaction.public_id} flagged for review.`,
    severity: normalizedSeverity,
    metadata: { complianceCasePublicId: casePublicId, note: normalizedNote || null },
  })

  return { transactionPublicId, complianceCasePublicId: casePublicId, status: "OPEN" }
}

export async function requestTransactionCancellationReview({
  actor,
  transactionPublicId,
  action = "REQUEST_CANCELLATION_REVIEW",
  note = "",
  severity = "HIGH",
}) {
  requirePrimaryRole(
    actor,
    [INTERNAL_ROLE_CODES.FINANCE_MANAGER],
    "Only Finance Manager can request cancellation review from finance workflow"
  )

  const normalizedAction = normalizeTransactionEnum(action, FINANCE_CANCELLATION_REVIEW_ACTIONS, "REQUEST_CANCELLATION_REVIEW")
  const normalizedNote = String(note || "").trim()
  if (normalizedAction === "ATTACH_FINANCIAL_NOTE" && !normalizedNote) {
    throw badRequest("Financial note is required")
  }

  const transaction = await resolveTransactionOrThrow(transactionPublicId)
  let caseStatus = "OPEN"
  let transactionStatus = String(transaction.status || "").toUpperCase() || "RECORDED"
  let actionEntry = ""
  let auditActionType = "TRANSACTION_CANCELLATION_REVIEW_REQUEST"
  let auditSummary = `Cancellation review requested for transaction ${transaction.public_id}.`
  let auditSeverity = "HIGH"

  switch (normalizedAction) {
    case "ATTACH_FINANCIAL_NOTE":
      actionEntry = normalizedNote
      auditActionType = "TRANSACTION_FINANCIAL_NOTE_ADD"
      auditSummary = `Financial note added to transaction ${transaction.public_id}.`
      auditSeverity = "MEDIUM"
      break
    case "ESCALATE_TO_COMPLIANCE":
      caseStatus = "INVESTIGATING"
      transactionStatus = "UNDER_REVIEW"
      actionEntry = normalizedNote || "Escalated to compliance for cancellation decision."
      auditActionType = "TRANSACTION_ESCALATE_COMPLIANCE"
      auditSummary = `Transaction ${transaction.public_id} escalated from finance to compliance.`
      break
    default:
      caseStatus = "INVESTIGATING"
      transactionStatus = "UNDER_REVIEW"
      actionEntry = normalizedNote || "Finance requested cancellation review."
      break
  }

  const reviewCase = await ensureTransactionComplianceCase({
    actor,
    transaction,
    severity,
    nextStatus: caseStatus,
    summary: `Transaction ${transaction.public_id} requires finance/compliance review.`,
    noteEntry: actionEntry,
  })

  const workflow = await updateTransactionWorkflow({
    transaction,
    actor,
    status: transactionStatus,
    settlementImpactStatus: transaction.settlement_impact_status,
    reasonCode: normalizedAction,
    note: actionEntry,
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: auditActionType,
    targetType: "TRANSACTION",
    targetPublicId: transactionPublicId,
    summary: auditSummary,
    severity: auditSeverity,
    metadata: {
      complianceCasePublicId: reviewCase.publicId,
      action: normalizedAction,
      note: normalizedNote || null,
    },
  })

  return {
    ...workflow,
    complianceCasePublicId: reviewCase.publicId,
    complianceCaseStatus: reviewCase.status,
  }
}

export async function cancelTransactionFinancialError({
  actor,
  transactionPublicId,
  note = "",
  reasonCode = "",
}) {
  requirePrimaryRole(
    actor,
    [INTERNAL_ROLE_CODES.FINANCE_MANAGER],
    "Only Finance Manager can cancel a transaction for a financial processing error"
  )

  const transaction = await resolveTransactionOrThrow(transactionPublicId)
  const normalizedReasonCode = requireTransactionReasonCode(
    reasonCode,
    FINANCE_TRANSACTION_ERROR_REASON_CODES,
    "",
    "Unsupported financial error reason"
  )
  const normalizedNote = String(note || "").trim()
  const reviewCase = await resolveLatestTransactionComplianceCase(transactionPublicId)

  if (reviewCase?.public_id) {
    const caseNote = appendCaseAction(
      reviewCase.action_taken,
      normalizedNote || "Cancelled by finance due to a verified financial processing error."
    )
    await prisma.$executeRaw`
      UPDATE compliance_cases
      SET
        status = 'RESOLVED',
        action_taken = ${caseNote},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${reviewCase.public_id}
    `
  }

  const workflow = await updateTransactionWorkflow({
    transaction,
    actor,
    status: "CANCELLED",
    settlementImpactStatus: "ADJUSTED",
    reasonCode: normalizedReasonCode,
    note: normalizedNote || "Cancelled due to a confirmed financial processing error.",
    cancelledAt: new Date(),
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "TRANSACTION_CANCEL_FINANCIAL_ERROR",
    targetType: "TRANSACTION",
    targetPublicId: transactionPublicId,
    summary: `Transaction ${transaction.public_id} cancelled for financial error.`,
    severity: "HIGH",
    metadata: {
      complianceCasePublicId: reviewCase?.public_id || null,
      reasonCode: normalizedReasonCode,
      note: normalizedNote || null,
    },
  })

  return {
    ...workflow,
    complianceCasePublicId: reviewCase?.public_id || null,
    complianceCaseStatus: reviewCase?.public_id ? "RESOLVED" : null,
  }
}

export async function markSettlementProcessing({ actor, batchPublicId }) {
  const batch = await resolveSettlementBatchOrThrow(batchPublicId)

  if (batch.status === "PAID") {
    throw badRequest("Paid settlement batches cannot be moved back to processing")
  }

  await prisma.$executeRaw`
    UPDATE settlement_batches
    SET status = 'UNDER_REVIEW', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${batchPublicId}
  `

  const integrityReview = await syncSettlementBatchIntegrityState(prisma, {
    batch,
    actor,
    trigger: "SETTLEMENT_MARK_PROCESSING",
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SETTLEMENT_MARK_PROCESSING",
    targetType: "SETTLEMENT_BATCH",
    targetPublicId: batchPublicId,
    summary: `Settlement batch for ${batch.station_name} moved to processing.`,
    severity: "MEDIUM",
    metadata: {
      integrityFlagged: integrityReview.flagged,
      missingUserCount: integrityReview.missingUserCount,
      missingJourneyLinkCount: integrityReview.missingJourneyLinkCount,
    },
  })

  return { batchPublicId, status: "UNDER_REVIEW", integrityReview }
}

export async function approveSettlement({ actor, batchPublicId }) {
  const batch = await resolveSettlementBatchOrThrow(batchPublicId)
  const integrityReview = await syncSettlementBatchIntegrityState(prisma, {
    batch,
    actor,
    trigger: "SETTLEMENT_APPROVE",
  })

  if (integrityReview.flagged) {
    await prisma.$executeRaw`
      UPDATE settlement_batches
      SET status = 'UNDER_REVIEW', updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${batchPublicId}
    `

    await createInternalAuditLog({
      actorUserId: actor.userId,
      actorRoleCode: actor.primaryRole,
      actionType: "SETTLEMENT_APPROVE_BLOCKED_INTEGRITY",
      targetType: "SETTLEMENT_BATCH",
      targetPublicId: batchPublicId,
      summary: `Settlement batch for ${batch.station_name} requires integrity review before approval.`,
      severity: integrityReview.severity,
      metadata: {
        missingUserCount: integrityReview.missingUserCount,
        missingJourneyLinkCount: integrityReview.missingJourneyLinkCount,
        sampleTransactionPublicIds: integrityReview.sampleTransactionPublicIds,
      },
    })

    return { batchPublicId, status: "UNDER_REVIEW", integrityReview, approvalBlocked: true }
  }

  await prisma.$executeRaw`
    UPDATE settlement_batches
    SET
      status = 'APPROVED',
      approved_by_user_id = ${actor.userId},
      approved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${batchPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SETTLEMENT_APPROVE",
    targetType: "SETTLEMENT_BATCH",
    targetPublicId: batchPublicId,
    summary: `Settlement batch for ${batch.station_name} approved.`,
    severity: "HIGH",
  })

  return { batchPublicId, status: "APPROVED", integrityReview }
}

export async function markSettlementPaid({ actor, batchPublicId }) {
  const batch = await resolveSettlementBatchOrThrow(batchPublicId)

  if (batch.status !== "APPROVED") {
    throw badRequest("Only approved settlement batches can be marked as paid")
  }

  await prisma.$executeRaw`
    UPDATE settlement_batches
    SET status = 'PAID', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${batchPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SETTLEMENT_MARK_PAID",
    targetType: "SETTLEMENT_BATCH",
    targetPublicId: batchPublicId,
    summary: `Settlement batch for ${batch.station_name} marked as paid.`,
    severity: "HIGH",
  })

  return { batchPublicId, status: "PAID" }
}

export async function rejectSettlement({ actor, batchPublicId }) {
  const batch = await resolveSettlementBatchOrThrow(batchPublicId)

  await prisma.$executeRaw`
    UPDATE settlement_batches
    SET status = 'HELD', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${batchPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "SETTLEMENT_REJECT",
    targetType: "SETTLEMENT_BATCH",
    targetPublicId: batchPublicId,
    summary: `Settlement batch for ${batch.station_name} moved to held status.`,
    severity: "HIGH",
  })

  return { batchPublicId, status: "HELD" }
}

export async function rejectFinanceRefund({ actor, refundPublicId, note = "" }) {
  const [refund, bundle] = await Promise.all([
    resolveRefundRequestOrThrow(refundPublicId),
    buildRefundInvestigationBundle({ actor, refundPublicId }),
  ])
  assertRefundStatusIn(
    refund,
    [REFUND_STATUSES.PENDING_FINANCE_APPROVAL],
    "Only refunds pending finance approval can be rejected by finance."
  )
  const normalizedNote = String(note || "").trim()
  const resolutionNotes = normalizedNote || "Rejected during finance review."

  await prisma.$executeRaw`
    UPDATE refund_requests
    SET
      status = 'REJECTED',
      investigation_status = ${REFUND_INVESTIGATION_STATUSES.REJECTED},
      review_stage = ${REFUND_REVIEW_STAGES.CLOSED},
      reviewed_by_user_id = ${actor.userId},
      finance_reviewed_by_user_id = ${actor.userId},
      reviewed_at = CURRENT_TIMESTAMP(3),
      final_decision_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3),
      resolution_notes = ${appendNoteEntry(refund.resolution_notes, resolutionNotes)}
    WHERE public_id = ${refundPublicId}
  `

  await createRefundReviewRecord({
    refundId: refund.id,
    reviewerUserId: actor.userId,
    reviewerRole: actor.primaryRole,
    decision: "REJECT",
    notes: resolutionNotes,
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "REFUND_REJECT",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: `Refund request ${refundPublicId} rejected by finance.`,
    severity: "HIGH",
    metadata: {
      amountMwk: toNumber(refund.amount_mwk),
      note: normalizedNote || null,
      recommendation: bundle.assessment.recommendation,
    },
  })

  await notifyRefundRequestStatus({
    refund,
    title: "Refund request rejected",
    body: resolutionNotes,
    metadata: {
      refundStatus: "REJECTED",
    },
  })

  if (
    Number(refund.support_case_id || 0) > 0
    && shouldCloseLinkedSupportCaseForRefund({
      reviewStage: REFUND_REVIEW_STAGES.CLOSED,
      status: "REJECTED",
    })
  ) {
    await closeLinkedSupportCaseForRefund({
      supportCaseId: refund.support_case_id,
      actor,
      refundPublicId,
      resolutionNote: "Closed after refund was rejected during finance review.",
    })
  }

  return { refundPublicId, status: "REJECTED" }
}

export async function approveFinanceRefund({ actor, refundPublicId, note = "" }) {
  const [refund, bundle] = await Promise.all([
    resolveRefundRequestOrThrow(refundPublicId),
    buildRefundInvestigationBundle({ actor, refundPublicId }),
  ])
  const complianceMarkedFalsePositive = Boolean(bundle?.refund?.complianceMarkedFalsePositive)
  assertRefundStatusIn(
    refund,
    [REFUND_STATUSES.PENDING_FINANCE_APPROVAL],
    "Only refunds pending finance approval can be approved by finance."
  )
  if (
    !complianceMarkedFalsePositive
    && !bundle.assessment.allowsFinanceApproval
    && bundle.assessment.recommendation !== REFUND_RECOMMENDATIONS.APPROVE
  ) {
    if (bundle.assessment.shouldEscalateToCompliance && !complianceMarkedFalsePositive) {
      throw badRequest("This refund has suspicious signals and should be escalated to compliance.")
    }
    throw badRequest("Finance approval requires a stronger evidence chain.")
  }
  if (refund.compliance_case_id && !complianceMarkedFalsePositive) {
    throw badRequest("Finance can only approve this refund after compliance marks the linked case as a false positive.")
  }
  const normalizedNote = String(note || "").trim()
  const shouldCreditWallet = Number(refund.user_id || 0) > 0
  const payout = shouldCreditWallet
    ? await postWalletRefund({
        userId: Number(refund.user_id),
        amount: toNumber(refund.amount_mwk),
        refundPublicId,
        actorUserId: actor.userId,
        sourceTransactionPublicId: refund.transaction_public_id || "",
        note: normalizedNote || `Refund ${refundPublicId} approved by finance.`,
      })
    : null
  const nextStatus = payout?.transaction?.reference ? "PAID" : "APPROVED"
  const nextInvestigationStatus = payout?.transaction?.reference
    ? REFUND_INVESTIGATION_STATUSES.COMPLETED
    : REFUND_INVESTIGATION_STATUSES.APPROVED
  const resolutionNotes = normalizedNote || (
    payout?.transaction?.reference
      ? "Approved by finance review and credited to wallet."
      : "Approved by finance review."
  )

  await prisma.$executeRaw`
    UPDATE refund_requests
    SET
      status = ${nextStatus},
      investigation_status = ${nextInvestigationStatus},
      review_stage = ${REFUND_REVIEW_STAGES.CLOSED},
      reviewed_by_user_id = ${actor.userId},
      finance_reviewed_by_user_id = ${actor.userId},
      reviewed_at = CURRENT_TIMESTAMP(3),
      final_decision_at = CURRENT_TIMESTAMP(3),
      credited_at = ${payout?.transaction?.reference ? new Date() : null},
      updated_at = CURRENT_TIMESTAMP(3),
      wallet_transaction_reference = ${payout?.transaction?.reference || null},
      resolution_notes = ${appendNoteEntry(refund.resolution_notes, resolutionNotes)}
    WHERE public_id = ${refundPublicId}
  `

  await createRefundReviewRecord({
    refundId: refund.id,
    reviewerUserId: actor.userId,
    reviewerRole: actor.primaryRole,
    decision: "APPROVE",
    notes: resolutionNotes,
  })

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "REFUND_APPROVE",
    targetType: "REFUND_REQUEST",
    targetPublicId: refundPublicId,
    summary: `Refund request ${refundPublicId} approved by finance.`,
    severity: severityWeight(refund.priority) >= 3 ? "HIGH" : "MEDIUM",
    metadata: {
      amountMwk: toNumber(refund.amount_mwk),
      approvalScope: "finance",
      recommendation: bundle.assessment.recommendation,
      note: normalizedNote || null,
      walletTransactionReference: payout?.transaction?.reference || null,
    },
  })

  await notifyRefundRequestStatus({
    refund,
    title: "Refund approved",
    body: payout?.transaction?.reference
      ? `MWK ${toNumber(refund.amount_mwk).toLocaleString()} has been returned to your wallet.`
      : "Your refund request was approved.",
    metadata: {
      walletTransactionReference: payout?.transaction?.reference || null,
      refundStatus: nextStatus,
    },
  })

  if (
    Number(refund.support_case_id || 0) > 0
    && shouldCloseLinkedSupportCaseForRefund({
      reviewStage: REFUND_REVIEW_STAGES.CLOSED,
      status: nextStatus,
    })
  ) {
    await closeLinkedSupportCaseForRefund({
      supportCaseId: refund.support_case_id,
      actor,
      refundPublicId,
      resolutionNote: `Closed after refund review reached ${nextStatus}.`,
    })
  }

  return {
    refundPublicId,
    status: nextStatus,
    investigationStatus: nextInvestigationStatus,
    walletTransactionReference: payout?.transaction?.reference || null,
  }
}

export async function startFinanceReconciliation({ actor, note = "" }) {
  const publicId = createPublicId()
  const normalizedNote = String(note || "").trim()

  await prisma.$executeRaw`
    INSERT INTO finance_reconciliation_runs (
      public_id,
      status,
      notes,
      started_by_user_id
    )
    VALUES (
      ${publicId},
      'IN_PROGRESS',
      ${normalizedNote || null},
      ${actor.userId}
    )
  `

  const settlementIntegrityAlerts = await optionalRows(prisma.$queryRaw`
    SELECT
      da.entity_public_id,
      da.severity,
      da.summary,
      da.metadata,
      st.name AS station_name
    FROM dashboard_alerts da
    LEFT JOIN stations st ON st.id = da.station_id
    WHERE da.status = 'OPEN'
      AND da.owner_role_code = ${SETTLEMENT_INTEGRITY_ALERT_OWNER_ROLE}
      AND da.entity_type = ${SETTLEMENT_INTEGRITY_ALERT_ENTITY_TYPE}
    ORDER BY da.created_at DESC
  `, "dashboard_alerts")

  const automaticFindings = buildAutomaticFinanceReconciliationFindings({
    settlementAlerts: settlementIntegrityAlerts,
  })

  for (const finding of automaticFindings) {
    const exceptionPublicId = createPublicId()
    await prisma.$executeRaw`
      INSERT INTO finance_reconciliation_exceptions (
        public_id,
        run_id,
        exception_type,
        severity,
        status,
        summary,
        detail,
        created_by_user_id
      )
      VALUES (
        ${exceptionPublicId},
        (
          SELECT id
          FROM finance_reconciliation_runs
          WHERE public_id = ${publicId}
          LIMIT 1
        ),
        ${finding.exceptionType},
        ${finding.severity},
        'OPEN',
        ${finding.summary},
        ${finding.detail || null},
        ${actor.userId}
      )
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "RECONCILIATION_START",
    targetType: "RECONCILIATION_RUN",
    targetPublicId: publicId,
    summary: "Finance reconciliation started.",
    severity: "MEDIUM",
    metadata: {
      note: normalizedNote || null,
      autoExceptionCount: automaticFindings.length,
      autoExceptionTypes: [...new Set(automaticFindings.map((item) => item.exceptionType))],
    },
  })

  return {
    runPublicId: publicId,
    status: "IN_PROGRESS",
    autoExceptionCount: automaticFindings.length,
  }
}

export async function completeFinanceReconciliation({ actor, runPublicId, note = "" }) {
  const run = await resolveFinanceReconciliationRunOrThrow(runPublicId)
  const normalizedNote = String(note || "").trim()
  const nextNotes = [String(run.notes || "").trim(), normalizedNote].filter(Boolean).join("\n")

  await prisma.$executeRaw`
    UPDATE finance_reconciliation_runs
    SET
      status = 'COMPLETED',
      notes = ${nextNotes || null},
      completed_by_user_id = ${actor.userId},
      completed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${runPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "RECONCILIATION_COMPLETE",
    targetType: "RECONCILIATION_RUN",
    targetPublicId: runPublicId,
    summary: "Finance reconciliation marked complete.",
    severity: "MEDIUM",
    metadata: { note: normalizedNote || null },
  })

  return { runPublicId, status: "COMPLETED" }
}

export async function raiseFinanceReconciliationException({ actor, runPublicId, exceptionType, summary, detail = "", severity = "MEDIUM" }) {
  const run = await resolveFinanceReconciliationRunOrThrow(runPublicId)
  const publicId = createPublicId()
  const normalizedSeverity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(severity || "").toUpperCase())
    ? String(severity || "").toUpperCase()
    : "MEDIUM"

  await prisma.$executeRaw`
    INSERT INTO finance_reconciliation_exceptions (
      public_id,
      run_id,
      exception_type,
      severity,
      status,
      summary,
      detail,
      created_by_user_id
    )
    VALUES (
      ${publicId},
      ${run.id},
      ${exceptionType},
      ${normalizedSeverity},
      'OPEN',
      ${summary},
      ${String(detail || "").trim() || null},
      ${actor.userId}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "RECONCILIATION_EXCEPTION",
    targetType: "RECONCILIATION_RUN",
    targetPublicId: runPublicId,
    summary: `Reconciliation exception raised: ${summary}`,
    severity: normalizedSeverity,
    metadata: { exceptionPublicId: publicId, exceptionType },
  })

  return { runPublicId, exceptionPublicId: publicId, status: "OPEN" }
}

export async function createWalletAdjustmentRequest({ actor, stationPublicId = "", amountMwk, direction, reason, note = "" }) {
  const station = stationPublicId ? await resolveStationOrThrow(stationPublicId) : null
  const publicId = createPublicId()
  const normalizedAmount = toNumber(amountMwk)

  if (normalizedAmount <= 0) throw badRequest("Adjustment amount must be greater than zero")

  await prisma.$executeRaw`
    INSERT INTO wallet_adjustment_requests (
      public_id,
      station_id,
      amount_mwk,
      direction,
      status,
      reason,
      note,
      requested_by_user_id
    )
    VALUES (
      ${publicId},
      ${station?.id || null},
      ${normalizedAmount},
      ${direction},
      'PENDING',
      ${reason},
      ${String(note || "").trim() || null},
      ${actor.userId}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "WALLET_ADJUSTMENT_REQUEST",
    targetType: "WALLET_ADJUSTMENT",
    targetPublicId: publicId,
    summary: `Wallet adjustment request ${publicId} created.`,
    severity: normalizedAmount >= 50000 ? "HIGH" : "MEDIUM",
    metadata: { stationPublicId: stationPublicId || null, amountMwk: normalizedAmount, direction },
  })

  return { requestPublicId: publicId, status: "PENDING" }
}

export async function approveWalletAdjustmentRequest({ actor, requestPublicId, note = "" }) {
  const request = await resolveWalletAdjustmentRequestOrThrow(requestPublicId)
  const normalizedNote = String(note || "").trim()
  const nextNote = [String(request.note || "").trim(), normalizedNote].filter(Boolean).join("\n")

  await prisma.$executeRaw`
    UPDATE wallet_adjustment_requests
    SET
      status = 'APPROVED',
      note = ${nextNote || request.note || null},
      approved_by_user_id = ${actor.userId},
      approved_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${requestPublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "WALLET_ADJUSTMENT_APPROVE",
    targetType: "WALLET_ADJUSTMENT",
    targetPublicId: requestPublicId,
    summary: `Wallet adjustment request ${requestPublicId} approved.`,
    severity: toNumber(request.amount_mwk) >= 50000 ? "HIGH" : "MEDIUM",
    metadata: { stationPublicId: request.station_public_id || null, amountMwk: toNumber(request.amount_mwk), direction: request.direction, note: normalizedNote || null },
  })

  return { requestPublicId, status: "APPROVED" }
}

export async function updateSubscriptionBillingState({ actor, stationPublicId, action }) {
  const account = await resolveSubscriptionBillingAccountOrThrow(stationPublicId)
  const normalizedAction = String(action || "").trim().toUpperCase()

  if (!["MARK_INVOICE_PAID", "SUSPEND_SUBSCRIPTION", "RESUME_SUBSCRIPTION"].includes(normalizedAction)) {
    throw badRequest("Unsupported subscription billing action")
  }

  if (normalizedAction === "MARK_INVOICE_PAID") {
    await prisma.$executeRaw`
      UPDATE station_subscription_statuses
      SET
        status = 'ACTIVE',
        last_payment_at = CURRENT_TIMESTAMP(3),
        renewal_date = CASE
          WHEN renewal_date IS NULL OR renewal_date < CURRENT_DATE() THEN DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
          ELSE renewal_date
        END,
        grace_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE station_id = ${account.station_id}
    `
  } else if (normalizedAction === "SUSPEND_SUBSCRIPTION") {
    await prisma.$executeRaw`
      UPDATE station_subscription_statuses
      SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP(3)
      WHERE station_id = ${account.station_id}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE station_subscription_statuses
      SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP(3)
      WHERE station_id = ${account.station_id}
    `
  }

  const actionType =
    normalizedAction === "MARK_INVOICE_PAID"
      ? "SUBSCRIPTION_MARK_PAID"
      : normalizedAction === "SUSPEND_SUBSCRIPTION"
        ? "SUBSCRIPTION_SUSPEND"
        : "SUBSCRIPTION_RESUME"
  const summary =
    normalizedAction === "MARK_INVOICE_PAID"
      ? `${account.station_name} subscription invoice marked as paid.`
      : normalizedAction === "SUSPEND_SUBSCRIPTION"
        ? `${account.station_name} subscription suspended by finance.`
        : `${account.station_name} subscription resumed by finance.`

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType,
    targetType: "SUBSCRIPTION",
    targetPublicId: account.station_public_id,
    summary,
    severity: normalizedAction === "MARK_INVOICE_PAID" ? "MEDIUM" : "HIGH",
    metadata: {
      stationPublicId: account.station_public_id,
      planCode: account.plan_code,
      statusBefore: account.status,
      action: normalizedAction,
    },
  })

  return {
    stationPublicId: account.station_public_id,
    action: normalizedAction,
    status:
      normalizedAction === "MARK_INVOICE_PAID"
        ? "ACTIVE"
        : normalizedAction === "SUSPEND_SUBSCRIPTION"
          ? "PAUSED"
          : "ACTIVE",
  }
}

export async function getRiskData() {
  const [rows, alertRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        cc.public_id,
        cc.category,
        cc.severity,
        cc.status,
        cc.summary,
        cc.action_taken,
        st.public_id AS station_public_id,
        st.name AS station_name,
        target_user.public_id AS user_public_id,
        target_user.full_name AS user_name,
        assigned_user.public_id AS assigned_user_public_id,
        assigned_user.full_name AS assigned_officer,
        tx_link.transaction_public_id,
        tx.status AS transaction_status,
        tx.settlement_impact_status AS transaction_settlement_impact_status,
        tx.workflow_reason_code AS transaction_workflow_reason_code,
        cc.created_at
      FROM compliance_cases cc
      LEFT JOIN stations st ON st.id = cc.station_id
      LEFT JOIN users target_user ON target_user.id = cc.user_id
      LEFT JOIN users assigned_user ON assigned_user.id = cc.assigned_user_id
      LEFT JOIN (
        SELECT
          JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId')) AS case_public_id,
          MAX(ial.target_public_id) AS transaction_public_id
        FROM internal_audit_log ial
        WHERE ial.target_type = 'TRANSACTION'
          AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
        GROUP BY JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
      ) tx_link ON tx_link.case_public_id = cc.public_id
      LEFT JOIN transactions tx ON tx.public_id = tx_link.transaction_public_id
      ORDER BY FIELD(cc.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), cc.created_at DESC
    `,
    optionalRows(prisma.$queryRaw`
      SELECT da.public_id, da.title, da.summary, da.severity, da.status, da.created_at
      FROM dashboard_alerts da
      WHERE da.category = 'RISK'
      ORDER BY FIELD(da.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), da.created_at DESC
      LIMIT 12
    `, "dashboard_alerts"),
  ])

  const items = normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    actionTaken: row.action_taken || null,
    stationName: row.station_name || null,
    stationPublicId: row.station_public_id || null,
    userPublicId: row.user_public_id || null,
    userName: row.user_name || null,
    assignedUserPublicId: row.assigned_user_public_id || null,
    assignedOfficer: row.assigned_officer || null,
    transactionPublicId: row.transaction_public_id || null,
    transactionStatus: row.transaction_status || null,
    transactionSettlementImpactStatus: row.transaction_settlement_impact_status || null,
    transactionWorkflowReasonCode: row.transaction_workflow_reason_code || null,
    createdAt: normalizeDateTime(row.created_at),
  }))

  return {
    summary: {
      suspiciousTransactions: items.filter((row) => ["SUSPICIOUS_TRANSACTIONS", "SUSPICIOUS_TRANSACTION", "TRANSACTION_REVIEW"].includes(row.category) && row.status !== 'RESOLVED').length,
      frozenEntities: items.filter((row) => row.status === 'FROZEN').length,
      unresolvedCases: items.filter((row) => row.status !== 'RESOLVED').length,
      anomalyAlerts: normalizeRows(alertRows).filter((row) => row.status === 'OPEN').length,
    },
    items,
    riskOfficers: await listActiveRiskOfficers(),
    alertFeed: normalizeRows(alertRows).map((row) => ({
      publicId: row.public_id,
      title: row.title,
      summary: row.summary,
      severity: row.severity,
      status: row.status,
      createdAt: normalizeDateTime(row.created_at),
    })),
    frozenEntities: items.filter((row) => row.status === 'FROZEN'),
  }
}

function appendCaseAction(existingValue, entry) {
  const normalizedEntry = String(entry || "").trim()
  if (!normalizedEntry) return String(existingValue || "").trim()
  const timestamp = new Date().toISOString()
  const current = String(existingValue || "").trim()
  return current ? `${current}\n[${timestamp}] ${normalizedEntry}` : `[${timestamp}] ${normalizedEntry}`
}

export async function createComplianceCase({
  actor,
  category,
  severity = "MEDIUM",
  summary,
  stationPublicId = "",
  userPublicId = "",
  assigneeUserPublicId = "",
  note = "",
}) {
  let stationId = null
  let userId = null
  let assignedUserId = actor.userId || null

  if (stationPublicId) {
    const station = await resolveStationOrThrow(stationPublicId)
    stationId = station.id
  }

  if (userPublicId) {
    const user = await resolveUserByPublicIdOrThrow(userPublicId)
    userId = user.id
  }

  if (assigneeUserPublicId) {
    const assignee = await resolveInternalUserOrThrow(assigneeUserPublicId)
    assignedUserId = assignee.id
  }

  const publicId = createPublicId()
  const normalizedSeverity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(severity || "").toUpperCase())
    ? String(severity || "").toUpperCase()
    : "MEDIUM"
  const normalizedNote = String(note || "").trim()

  await prisma.$executeRaw`
    INSERT INTO compliance_cases (
      public_id,
      station_id,
      user_id,
      category,
      severity,
      status,
      assigned_user_id,
      summary,
      action_taken
    )
    VALUES (
      ${publicId},
      ${stationId},
      ${userId},
      ${category},
      ${normalizedSeverity},
      'OPEN',
      ${assignedUserId},
      ${summary},
      ${normalizedNote || null}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_CASE_CREATE",
    targetType: "COMPLIANCE_CASE",
    targetPublicId: publicId,
    summary: `Compliance case created: ${summary}`,
    severity: normalizedSeverity,
    metadata: { category, stationPublicId: stationPublicId || null, userPublicId: userPublicId || null },
  })

  return { casePublicId: publicId, status: "OPEN" }
}

export async function flagSuspiciousStation({ actor, stationPublicId, note = "", severity = "HIGH" }) {
  const station = await resolveStationOrThrow(stationPublicId)
  return createComplianceCase({
    actor,
    category: "SUSPICIOUS_STATION",
    severity,
    summary: `Station ${station.name} flagged as suspicious.`,
    stationPublicId,
    note,
  })
}

export async function updateComplianceCaseWorkflow({ actor, casePublicId, action, note = "", assigneeUserPublicId = "" }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  const normalizedAction = String(action || "").trim().toUpperCase()
  const normalizedNote = String(note || "").trim()
  let nextStatus = String(complianceCase.status || "").toUpperCase() || "OPEN"
  let assignedUserId = complianceCase.assigned_user_id || null
  let nextActionTaken = String(complianceCase.action_taken || "").trim()
  let auditSummary = `Compliance case updated: ${complianceCase.summary}`

  switch (normalizedAction) {
    case "ASSIGN_CASE": {
      if (!assigneeUserPublicId) throw badRequest("assigneeUserPublicId is required")
      const assignee = await resolveInternalUserOrThrow(assigneeUserPublicId)
      assignedUserId = assignee.id
      auditSummary = `Compliance case assigned: ${complianceCase.summary}`
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || `Assigned to ${assignee.full_name || assignee.public_id}.`)
      break
    }
    case "ADD_CASE_NOTE":
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || "Case note added.")
      auditSummary = `Compliance case note added: ${complianceCase.summary}`
      break
    case "ESCALATE_CASE":
      nextStatus = "INVESTIGATING"
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || "Escalated for deeper compliance review.")
      auditSummary = `Compliance case escalated: ${complianceCase.summary}`
      break
    case "RESOLVE_CASE":
      nextStatus = "RESOLVED"
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || "Resolved by compliance review.")
      auditSummary = `Compliance case resolved: ${complianceCase.summary}`
      break
    case "REOPEN_CASE":
      nextStatus = "OPEN"
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || "Case reopened.")
      auditSummary = `Compliance case reopened: ${complianceCase.summary}`
      break
    case "MARK_CONFIRMED":
      nextStatus = "FRAUD_CONFIRMED"
      nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote || "Marked as confirmed fraud.")
      auditSummary = `Compliance case confirmed: ${complianceCase.summary}`
      break
    case "MARK_FALSE_POSITIVE":
      nextStatus = "RESOLVED"
      nextActionTaken = appendCaseAction(nextActionTaken, "Marked as false positive.")
      if (normalizedNote) {
        nextActionTaken = appendCaseAction(nextActionTaken, normalizedNote)
      }
      auditSummary = `Compliance case marked false positive: ${complianceCase.summary}`
      break
    default:
      throw badRequest("Unsupported compliance workflow action")
  }

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = ${nextStatus},
      assigned_user_id = ${assignedUserId},
      action_taken = ${nextActionTaken || null},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: `COMPLIANCE_${normalizedAction}`,
    targetType: "COMPLIANCE_CASE",
    targetPublicId: casePublicId,
    summary: auditSummary,
    severity: normalizedAction === "ESCALATE_CASE" ? "HIGH" : "MEDIUM",
    metadata: { note: normalizedNote || null, assigneeUserPublicId: assigneeUserPublicId || null },
  })

  return { casePublicId, status: nextStatus }
}

export async function freezeComplianceAccount({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  if (!complianceCase.user_id || !complianceCase.user_public_id) {
    throw badRequest("Compliance case is not linked to a user account")
  }

  await prisma.$executeRaw`
    UPDATE users
    SET is_active = 0
    WHERE id = ${complianceCase.user_id}
  `

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = 'FROZEN',
      action_taken = ${appendCaseAction(complianceCase.action_taken, "Account frozen by risk/compliance.")},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_FREEZE_ACCOUNT",
    targetType: "USER_ACCOUNT",
    targetPublicId: complianceCase.user_public_id,
    summary: `Account frozen from compliance case: ${complianceCase.summary}`,
    severity: "CRITICAL",
    metadata: { casePublicId },
  })

  return { casePublicId, userPublicId: complianceCase.user_public_id, status: "FROZEN" }
}

export async function unfreezeComplianceAccount({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  if (!complianceCase.user_id || !complianceCase.user_public_id) {
    throw badRequest("Compliance case is not linked to a user account")
  }

  await prisma.$executeRaw`
    UPDATE users
    SET is_active = 1
    WHERE id = ${complianceCase.user_id}
  `

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = 'INVESTIGATING',
      action_taken = ${appendCaseAction(complianceCase.action_taken, "Account unfrozen by risk/compliance.")},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_UNFREEZE_ACCOUNT",
    targetType: "USER_ACCOUNT",
    targetPublicId: complianceCase.user_public_id,
    summary: `Account unfrozen from compliance case: ${complianceCase.summary}`,
    severity: "HIGH",
    metadata: { casePublicId },
  })

  return { casePublicId, userPublicId: complianceCase.user_public_id, status: "INVESTIGATING" }
}

export async function freezeComplianceStation({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  if (!complianceCase.station_id || !complianceCase.station_public_id) {
    throw badRequest("Compliance case is not linked to a station")
  }

  await prisma.$executeRaw`
    UPDATE stations
    SET is_active = 0
    WHERE id = ${complianceCase.station_id}
  `

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = 'FROZEN',
      action_taken = ${appendCaseAction(complianceCase.action_taken, "Station frozen by risk/compliance.")},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_FREEZE_STATION",
    targetType: "STATION",
    targetPublicId: complianceCase.station_public_id,
    summary: `Station frozen from compliance case: ${complianceCase.summary}`,
    severity: "CRITICAL",
    metadata: { casePublicId },
  })

  return { casePublicId, stationPublicId: complianceCase.station_public_id, status: "FROZEN" }
}

export async function unfreezeComplianceStation({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  if (!complianceCase.station_id || !complianceCase.station_public_id) {
    throw badRequest("Compliance case is not linked to a station")
  }

  await prisma.$executeRaw`
    UPDATE stations
    SET is_active = 1
    WHERE id = ${complianceCase.station_id}
  `

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = 'INVESTIGATING',
      action_taken = ${appendCaseAction(complianceCase.action_taken, "Station unfrozen by risk/compliance.")},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_UNFREEZE_STATION",
    targetType: "STATION",
    targetPublicId: complianceCase.station_public_id,
    summary: `Station unfrozen from compliance case: ${complianceCase.summary}`,
    severity: "HIGH",
    metadata: { casePublicId },
  })

  return { casePublicId, stationPublicId: complianceCase.station_public_id, status: "INVESTIGATING" }
}

export async function freezeComplianceCase({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET status = 'FROZEN', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_FREEZE",
    targetType: "COMPLIANCE_CASE",
    targetPublicId: casePublicId,
    summary: `Compliance case frozen: ${complianceCase.summary}`,
    severity: "CRITICAL",
  })

  return { casePublicId, status: "FROZEN" }
}

export async function unfreezeComplianceCase({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET status = 'INVESTIGATING', updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "COMPLIANCE_UNFREEZE",
    targetType: "COMPLIANCE_CASE",
    targetPublicId: casePublicId,
    summary: `Compliance case returned to investigating state: ${complianceCase.summary}`,
    severity: "HIGH",
  })

  return { casePublicId, status: "INVESTIGATING" }
}

export async function approveHighRiskOverride({ actor, casePublicId }) {
  const complianceCase = await resolveComplianceCaseOrThrow(casePublicId)
  if (!["OPEN", "INVESTIGATING", "FROZEN", "FRAUD_CONFIRMED"].includes(String(complianceCase.status || "").toUpperCase())) {
    throw badRequest("Only active high-risk cases can be approved for override")
  }

  await prisma.$executeRaw`
    UPDATE compliance_cases
    SET
      status = 'RESOLVED',
      action_taken = 'High-risk override approved by platform owner.',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${casePublicId}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "HIGH_RISK_OVERRIDE_APPROVE",
    targetType: "COMPLIANCE_CASE",
    targetPublicId: casePublicId,
    summary: `High-risk override approved for compliance case: ${complianceCase.summary}`,
    severity: "CRITICAL",
  })

  return { casePublicId, status: "RESOLVED" }
}

export async function handleRiskTransactionAction({
  actor,
  transactionPublicId,
  action,
  note = "",
  reasonCode = "",
  severity = "HIGH",
  confirmationText = "",
  overrideStatus = "",
}) {
  const normalizedAction = String(action || "").trim().toUpperCase()
  const normalizedNote = String(note || "").trim()
  const transaction = await resolveTransactionOrThrow(transactionPublicId)
  let reviewCase = await resolveLatestTransactionComplianceCase(transactionPublicId)
  let workflow = null
  let nextCaseStatus = reviewCase?.status || "OPEN"
  let caseNoteEntry = normalizedNote
  let auditActionType = `TRANSACTION_${normalizedAction}`
  let auditSummary = `Risk transaction action ${normalizedAction} executed for ${transaction.public_id}.`
  let auditSeverity = "HIGH"

  switch (normalizedAction) {
    case "OPEN_COMPLIANCE_CASE": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER, INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Risk & Compliance Officer or Platform Owner can open a compliance case for a transaction"
      )
      nextCaseStatus = "OPEN"
      caseNoteEntry = normalizedNote || "Compliance case opened from transaction review."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} opened for compliance review.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: transaction.status || "RECORDED",
        settlementImpactStatus: transaction.settlement_impact_status || "UNCHANGED",
        reasonCode: "OPEN_COMPLIANCE_CASE",
        note: caseNoteEntry,
      })
      break
    }
    case "ATTACH_COMPLIANCE_NOTES": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER, INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Risk & Compliance Officer or Platform Owner can attach compliance notes"
      )
      if (!normalizedNote) throw badRequest("Compliance note is required")
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: reviewCase?.status || "OPEN",
        summary: `Transaction ${transaction.public_id} under compliance review.`,
        noteEntry: normalizedNote,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: transaction.status || "RECORDED",
        settlementImpactStatus: transaction.settlement_impact_status || "UNCHANGED",
        reasonCode: "COMPLIANCE_NOTE_ADDED",
        note: normalizedNote,
      })
      auditActionType = "TRANSACTION_COMPLIANCE_NOTE_ADD"
      auditSeverity = "MEDIUM"
      auditSummary = `Compliance note added to transaction ${transaction.public_id}.`
      break
    }
    case "FREEZE_RELATED_TRANSACTIONS": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER, INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Risk & Compliance Officer or Platform Owner can freeze related transactions"
      )
      nextCaseStatus = "FROZEN"
      caseNoteEntry = normalizedNote || "Related transaction activity frozen pending compliance review."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} frozen for compliance investigation.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: "FROZEN",
        settlementImpactStatus: transaction.settlement_impact_status || "UNCHANGED",
        reasonCode: "RELATED_ACTIVITY_FROZEN",
        note: caseNoteEntry,
      })
      auditSummary = `Transaction ${transaction.public_id} frozen by risk/compliance.`
      break
    }
    case "MARK_TRANSACTION_FRAUDULENT": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER, INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Risk & Compliance Officer or Platform Owner can mark a transaction fraudulent"
      )
      const normalizedReasonCode = requireTransactionReasonCode(
        reasonCode,
        PRIMARY_RISK_REASON_CODES,
        "CONFIRMED_FRAUD",
        "Unsupported compliance fraud reason"
      )
      nextCaseStatus = "FRAUD_CONFIRMED"
      caseNoteEntry = normalizedNote || "Fraud confirmed by risk/compliance."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} confirmed as fraudulent.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: "UNDER_REVIEW",
        settlementImpactStatus: transaction.settlement_impact_status || "UNCHANGED",
        reasonCode: normalizedReasonCode,
        note: caseNoteEntry,
      })
      auditSummary = `Transaction ${transaction.public_id} marked fraudulent.`
      break
    }
    case "CANCEL_TRANSACTION": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER],
        "Only Risk & Compliance Officer can cancel a transaction"
      )
      const normalizedReasonCode = requireTransactionReasonCode(
        reasonCode,
        PRIMARY_RISK_REASON_CODES,
        "CONFIRMED_FRAUD",
        "Unsupported compliance cancellation reason"
      )
      nextCaseStatus = "FRAUD_CONFIRMED"
      caseNoteEntry = normalizedNote || "Transaction cancelled after compliance confirmation."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} cancelled by compliance.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: "CANCELLED",
        settlementImpactStatus: "ADJUSTED",
        reasonCode: normalizedReasonCode,
        note: caseNoteEntry,
        cancelledAt: new Date(),
      })
      auditSummary = `Transaction ${transaction.public_id} cancelled by risk/compliance.`
      break
    }
    case "REVERSE_TRANSACTION": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER],
        "Only Risk & Compliance Officer can reverse a transaction"
      )
      const normalizedReasonCode = requireTransactionReasonCode(
        reasonCode,
        PRIMARY_RISK_REASON_CODES,
        "DUPLICATE_SYSTEM_TRANSACTION",
        "Unsupported transaction reversal reason"
      )
      nextCaseStatus = reviewCase?.status || "INVESTIGATING"
      caseNoteEntry = normalizedNote || "Transaction reversed by compliance review."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity,
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} reversed by compliance.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: "REVERSED",
        settlementImpactStatus: "ADJUSTED",
        reasonCode: normalizedReasonCode,
        note: caseNoteEntry,
      })
      auditSummary = `Transaction ${transaction.public_id} reversed by risk/compliance.`
      break
    }
    case "FORCE_CANCEL_TRANSACTION": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Platform Owner can force-cancel a transaction"
      )
      requireStrongConfirmation(transaction.public_id, confirmationText)
      const normalizedReasonCode = requireTransactionReasonCode(
        reasonCode,
        PLATFORM_OWNER_OVERRIDE_REASON_CODES,
        "COMPLIANCE_ESCALATION",
        "Unsupported platform override reason"
      )
      nextCaseStatus = reviewCase?.status || "INVESTIGATING"
      caseNoteEntry = normalizedNote || "Force-cancelled by platform owner override."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity: "CRITICAL",
        nextStatus: nextCaseStatus,
        summary: `Transaction ${transaction.public_id} force-cancelled by platform owner.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: "CANCELLED",
        settlementImpactStatus: "ADJUSTED",
        reasonCode: normalizedReasonCode,
        note: caseNoteEntry,
        cancelledAt: new Date(),
      })
      auditSeverity = "CRITICAL"
      auditSummary = `Transaction ${transaction.public_id} force-cancelled by platform owner.`
      break
    }
    case "REVERSE_SETTLEMENT": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Platform Owner can reverse settlement impact on a transaction"
      )
      requireStrongConfirmation(transaction.public_id, confirmationText)
      const normalizedReasonCode = requireTransactionReasonCode(
        reasonCode,
        PLATFORM_OWNER_OVERRIDE_REASON_CODES,
        "CRITICAL_FINANCIAL_INCIDENT",
        "Unsupported settlement reversal reason"
      )
      nextCaseStatus = reviewCase?.status || "INVESTIGATING"
      caseNoteEntry = normalizedNote || "Settlement impact reversed by platform owner."
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity: "CRITICAL",
        nextStatus: nextCaseStatus,
        summary: `Settlement reversal opened for transaction ${transaction.public_id}.`,
        noteEntry: caseNoteEntry,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: transaction.status || "RECORDED",
        settlementImpactStatus: "REVERSED",
        reasonCode: normalizedReasonCode,
        note: caseNoteEntry,
      })
      auditSeverity = "CRITICAL"
      auditSummary = `Settlement impact reversed for transaction ${transaction.public_id}.`
      break
    }
    case "OVERRIDE_CASE_STATUS": {
      requirePrimaryRole(
        actor,
        [INTERNAL_ROLE_CODES.PLATFORM_OWNER],
        "Only Platform Owner can override case status"
      )
      requireStrongConfirmation(transaction.public_id, confirmationText)
      const normalizedOverrideStatus = normalizeTransactionEnum(overrideStatus, TRANSACTION_CASE_ALLOWED_STATUSES, "")
      if (!normalizedOverrideStatus) throw badRequest("Unsupported case override status")
      reviewCase = await ensureTransactionComplianceCase({
        actor,
        transaction,
        severity: "CRITICAL",
        nextStatus: normalizedOverrideStatus,
        summary: `Transaction ${transaction.public_id} compliance case under platform override.`,
        noteEntry: normalizedNote || `Case status overridden to ${normalizedOverrideStatus}.`,
      })
      workflow = await updateTransactionWorkflow({
        transaction,
        actor,
        status: transaction.status || "RECORDED",
        settlementImpactStatus: transaction.settlement_impact_status || "UNCHANGED",
        reasonCode: "CASE_STATUS_OVERRIDE",
        note: normalizedNote || `Case status overridden to ${normalizedOverrideStatus}.`,
      })
      auditSeverity = "CRITICAL"
      auditSummary = `Compliance case status overridden to ${normalizedOverrideStatus} for transaction ${transaction.public_id}.`
      break
    }
    default:
      throw badRequest("Unsupported risk transaction action")
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: auditActionType,
    targetType: "TRANSACTION",
    targetPublicId: transactionPublicId,
    summary: auditSummary,
    severity: auditSeverity,
    metadata: {
      complianceCasePublicId: reviewCase?.publicId || reviewCase?.public_id || null,
      note: normalizedNote || null,
      reasonCode: String(reasonCode || "").trim() || null,
      overrideStatus: String(overrideStatus || "").trim() || null,
    },
  })

  return {
    ...workflow,
    complianceCasePublicId: reviewCase?.publicId || reviewCase?.public_id || null,
    complianceCaseStatus: reviewCase?.status || null,
  }
}

export async function getAnalyticsData() {
  const [stationPerformance, demandTrend, regionalComparison, fuelBreakdown] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        st.public_id,
        st.name AS station_name,
        st.city,
        ft.code AS fuel_type,
        COUNT(tx.id) AS transaction_count,
        COALESCE(SUM(tx.total_amount), 0) AS transaction_value,
        COALESCE(SUM(tx.litres), 0) AS litres_sold
      FROM stations st
      LEFT JOIN transactions tx ON tx.station_id = st.id
        AND tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      LEFT JOIN fuel_types ft ON ft.id = tx.fuel_type_id
      GROUP BY st.id, st.public_id, st.name, st.city
             , ft.code
      ORDER BY transaction_value DESC, station_name ASC, ft.code ASC
    `,
    prisma.$queryRaw`
      SELECT
        DATE(occurred_at) AS activity_date,
        ft.code AS fuel_type,
        COALESCE(SUM(litres), 0) AS litres_sold,
        COALESCE(SUM(total_amount), 0) AS transaction_value,
        COUNT(*) AS transaction_count
      FROM transactions tx
      LEFT JOIN fuel_types ft ON ft.id = tx.fuel_type_id
      WHERE occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY DATE(occurred_at), ft.code
      ORDER BY activity_date ASC, ft.code ASC
    `,
    prisma.$queryRaw`
      SELECT
        st.city,
        ft.code AS fuel_type,
        COUNT(DISTINCT st.id) AS station_count,
        COALESCE(SUM(tx.total_amount), 0) AS transaction_value,
        COALESCE(SUM(tx.litres), 0) AS litres_sold
      FROM stations st
      LEFT JOIN transactions tx ON tx.station_id = st.id
        AND tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      LEFT JOIN fuel_types ft ON ft.id = tx.fuel_type_id
      GROUP BY st.city, ft.code
      ORDER BY transaction_value DESC, st.city ASC, ft.code ASC
    `,
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_type,
        COUNT(tx.id) AS transaction_count,
        COALESCE(SUM(tx.total_amount), 0) AS transaction_value,
        COALESCE(SUM(tx.litres), 0) AS litres_sold
      FROM fuel_types ft
      LEFT JOIN transactions tx ON tx.fuel_type_id = ft.id
        AND tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY ft.id, ft.code
      ORDER BY ft.code ASC
    `,
  ])

  const performance = normalizeRows(stationPerformance).map((row) => ({
    stationPublicId: row.public_id,
    stationName: row.station_name,
    city: row.city,
    region: getOperationalRegion(row.city),
    fuelType: String(row.fuel_type || "UNKNOWN").toUpperCase(),
    transactionCount: toCount(row.transaction_count),
    transactionValue: toNumber(row.transaction_value),
    litresSold: toNumber(row.litres_sold),
  }))

  const stationTotals = [...performance.reduce((accumulator, row) => {
    const key = String(row.stationPublicId || "").trim()
    if (!key) return accumulator
    const current = accumulator.get(key) || {
      stationPublicId: row.stationPublicId,
      stationName: row.stationName,
      city: row.city,
      region: row.region,
      transactionCount: 0,
      transactionValue: 0,
      litresSold: 0,
    }
    current.transactionCount += toCount(row.transactionCount)
    current.transactionValue += toNumber(row.transactionValue)
    current.litresSold += toNumber(row.litresSold)
    accumulator.set(key, current)
    return accumulator
  }, new Map()).values()]

  const regionalTotals = [...normalizeRows(regionalComparison).reduce((accumulator, row) => {
    const city = String(row.city || "").trim()
    if (!city) return accumulator
    const current = accumulator.get(city) || {
      city,
      transactionValue: 0,
    }
    current.transactionValue += toNumber(row.transaction_value)
    accumulator.set(city, current)
    return accumulator
  }, new Map()).values()]

  return {
    summary: {
      bestPerformingStation: stationTotals.sort((a, b) => b.transactionValue - a.transactionValue)[0]?.stationName || null,
      regionalLeader: regionalTotals.sort((a, b) => b.transactionValue - a.transactionValue)[0]?.city || null,
      totalLitres30d: performance.reduce((sum, row) => sum + toNumber(row.litresSold), 0),
      totalValue30d: performance.reduce((sum, row) => sum + toNumber(row.transactionValue), 0),
    },
    stationPerformance: performance,
    demandTrend: normalizeRows(demandTrend).map((row) => ({
      activityDate: row.activity_date,
      fuelType: String(row.fuel_type || "UNKNOWN").toUpperCase(),
      litresSold: toNumber(row.litres_sold),
      transactionValue: toNumber(row.transaction_value),
      transactionCount: toCount(row.transaction_count),
    })),
    regionalComparison: normalizeRows(regionalComparison).map((row) => ({
      city: row.city,
      region: getOperationalRegion(row.city),
      fuelType: String(row.fuel_type || "UNKNOWN").toUpperCase(),
      stationCount: toCount(row.station_count),
      transactionValue: toNumber(row.transaction_value),
      litresSold: toNumber(row.litres_sold),
    })),
    fuelBreakdown: normalizeRows(fuelBreakdown).map((row) => ({
      fuelType: String(row.fuel_type || "UNKNOWN").toUpperCase(),
      transactionCount: toCount(row.transaction_count),
      transactionValue: toNumber(row.transaction_value),
      litresSold: toNumber(row.litres_sold),
    })),
  }
}

function normalizeAnalyticsPeriodDays(value) {
  const normalized = Number(value || 30)
  return [7, 14, 30].includes(normalized) ? normalized : 30
}

function normalizeAnalyticsFilterValue(value, fallback = "ALL") {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized || fallback
}

function aggregateAnalyticsStationRows(items = [], region = "ALL", fuelType = "ALL") {
  return [...(items || []).filter((row) => {
    const regionMatches = region === "ALL" || row.region === region
    const fuelMatches = fuelType === "ALL" || row.fuelType === fuelType
    return regionMatches && fuelMatches
  }).reduce((accumulator, row) => {
    const key = row.stationPublicId || row.stationName
    const current = accumulator.get(key) || {
      stationPublicId: row.stationPublicId,
      stationName: row.stationName,
      city: row.city,
      region: row.region,
      transactionCount: 0,
      transactionValue: 0,
      litresSold: 0,
    }
    current.transactionCount += toCount(row.transactionCount)
    current.transactionValue += toNumber(row.transactionValue)
    current.litresSold += toNumber(row.litresSold)
    accumulator.set(key, current)
    return accumulator
  }, new Map()).values()].sort((a, b) => b.transactionValue - a.transactionValue || a.stationName.localeCompare(b.stationName))
}

function aggregateAnalyticsRegionalRows(items = [], region = "ALL", fuelType = "ALL") {
  return [...(items || []).filter((row) => {
    const regionMatches = region === "ALL" || row.region === region
    const fuelMatches = fuelType === "ALL" || row.fuelType === fuelType
    return regionMatches && fuelMatches
  }).reduce((accumulator, row) => {
    const key = `${row.city}:${row.region}`
    const current = accumulator.get(key) || {
      city: row.city,
      region: row.region,
      stationCount: 0,
      transactionValue: 0,
      litresSold: 0,
    }
    current.stationCount = Math.max(current.stationCount, toCount(row.stationCount))
    current.transactionValue += toNumber(row.transactionValue)
    current.litresSold += toNumber(row.litresSold)
    accumulator.set(key, current)
    return accumulator
  }, new Map()).values()].sort((a, b) => b.transactionValue - a.transactionValue || a.city.localeCompare(b.city))
}

function aggregateAnalyticsTrendRows(items = [], fuelType = "ALL", periodDays = 30) {
  return [...(items || [])
    .filter((row) => fuelType === "ALL" || row.fuelType === fuelType)
    .reduce((accumulator, row) => {
      const key = String(row.activityDate || "")
      const current = accumulator.get(key) || {
        activityDate: key,
        transactionCount: 0,
        transactionValue: 0,
        litresSold: 0,
      }
      current.transactionCount += toCount(row.transactionCount)
      current.transactionValue += toNumber(row.transactionValue)
      current.litresSold += toNumber(row.litresSold)
      accumulator.set(key, current)
      return accumulator
    }, new Map()).values()]
    .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())
    .slice(-periodDays)
}

function buildAnalyticsForecastRows(trendRows = []) {
  const seedRows = (trendRows || []).slice(-Math.min(7, trendRows.length))
  if (!seedRows.length) return []

  const averageValue = seedRows.reduce((sum, row) => sum + toNumber(row.transactionValue), 0) / seedRows.length
  const averageLitres = seedRows.reduce((sum, row) => sum + toNumber(row.litresSold), 0) / seedRows.length
  const averageTransactions = seedRows.reduce((sum, row) => sum + toCount(row.transactionCount), 0) / seedRows.length
  const trendLift = seedRows.length > 1
    ? (toNumber(seedRows.at(-1)?.transactionValue) - toNumber(seedRows[0]?.transactionValue)) / (seedRows.length - 1)
    : 0
  const lastDate = new Date(seedRows.at(-1)?.activityDate || new Date())

  return Array.from({ length: 7 }, (_, index) => {
    const nextDate = new Date(lastDate)
    nextDate.setDate(nextDate.getDate() + index + 1)
    return {
      activityDate: nextDate.toISOString().slice(0, 10),
      forecastValue: Math.max(0, averageValue + trendLift * (index + 1)),
      forecastLitres: Math.max(0, averageLitres),
      forecastTransactions: Math.max(0, averageTransactions),
    }
  })
}

export async function buildAnalyticsExportReport({ periodDays = 30, region = "ALL", fuelType = "ALL" } = {}) {
  const analytics = await getAnalyticsData()
  const normalizedPeriodDays = normalizeAnalyticsPeriodDays(periodDays)
  const normalizedRegion = normalizeAnalyticsFilterValue(region)
  const normalizedFuelType = normalizeAnalyticsFilterValue(fuelType)

  const stationRows = aggregateAnalyticsStationRows(
    analytics.stationPerformance,
    normalizedRegion,
    normalizedFuelType
  )
  const regionalRows = aggregateAnalyticsRegionalRows(
    analytics.regionalComparison,
    normalizedRegion,
    normalizedFuelType
  )
  const trendRows = aggregateAnalyticsTrendRows(
    analytics.demandTrend,
    normalizedFuelType,
    normalizedPeriodDays
  )
  const previousTrendRows = [...aggregateAnalyticsTrendRows(
    analytics.demandTrend,
    normalizedFuelType,
    normalizedPeriodDays * 2
  )].slice(0, normalizedPeriodDays)
  const forecastRows = buildAnalyticsForecastRows(trendRows)

  const totalValue = trendRows.reduce((sum, row) => sum + toNumber(row.transactionValue), 0)
  const totalLitres = trendRows.reduce((sum, row) => sum + toNumber(row.litresSold), 0)
  const transactionCount = trendRows.reduce((sum, row) => sum + toCount(row.transactionCount), 0)
  const previousValue = previousTrendRows.reduce((sum, row) => sum + toNumber(row.transactionValue), 0)

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      periodDays: normalizedPeriodDays,
      periodLabel: `${normalizedPeriodDays} days`,
      region: normalizedRegion,
      regionLabel: normalizedRegion === "ALL" ? "All regions" : normalizedRegion,
      fuelType: normalizedFuelType,
      fuelLabel: normalizedFuelType === "ALL" ? "All fuel types" : normalizedFuelType,
    },
    summary: {
      totalValue,
      totalLitres,
      transactionCount,
      previousValue,
      bestStation: stationRows[0]?.stationName || "-",
      regionalLeader: regionalRows[0]?.city || "-",
      periodDeltaPct: previousValue > 0 ? ((totalValue - previousValue) / previousValue) * 100 : 0,
    },
    stationRows,
    regionalRows,
    trendRows,
    forecastRows,
  }
}

export async function getAuditLogData() {
  const rows = await prisma.$queryRaw`
    SELECT
      ial.public_id,
      u.full_name AS actor_name,
      ial.actor_role_code,
      ial.action_type,
      ial.target_type,
      ial.target_public_id,
      ial.summary,
      ial.severity,
      ial.metadata,
      ial.created_at
    FROM internal_audit_log ial
    LEFT JOIN users u ON u.id = ial.actor_user_id
    ORDER BY ial.created_at DESC
    LIMIT 250
  `

  const items = normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    actorName: row.actor_name || 'System',
    actorRoleCode: row.actor_role_code,
    actionType: row.action_type,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    summary: row.summary,
    severity: row.severity,
    metadata: parseJsonField(row.metadata, {}),
    createdAt: normalizeDateTime(row.created_at),
  }))

  return {
    summary: {
      totalEvents: items.length,
      criticalEvents: items.filter((row) => row.severity === 'CRITICAL').length,
      highEvents: items.filter((row) => row.severity === 'HIGH').length,
    },
    items,
  }
}

export async function getInternalStaffData(permissionSet = null) {
  const [rows, roleRows, permissionMatrixRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        u.public_id,
        u.full_name,
        u.email,
        u.phone_e164,
        u.is_active,
        MAX(ias.last_seen_at) AS last_login_at,
        COUNT(DISTINCT CASE
          WHEN ias.revoked_at IS NULL AND ias.expires_at > CURRENT_TIMESTAMP(3)
          THEN ias.id
          ELSE NULL
        END) AS active_session_count,
        GROUP_CONCAT(DISTINCT ir.code ORDER BY ir.rank_order ASC SEPARATOR ', ') AS roles,
        GROUP_CONCAT(DISTINCT ir.department ORDER BY ir.rank_order ASC SEPARATOR ', ') AS departments
      FROM users u
      INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
      INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
      LEFT JOIN internal_auth_sessions ias ON ias.user_id = u.id
      GROUP BY u.id, u.public_id, u.full_name, u.email, u.phone_e164, u.is_active
      ORDER BY u.full_name ASC
    `,
    prisma.$queryRaw`
      SELECT code, name, department
      FROM internal_roles
      WHERE is_active = 1
      ORDER BY rank_order ASC
    `,
    prisma.$queryRaw`
      SELECT
        ir.code,
        ir.name,
        ir.department,
        ip.code AS permission_code
      FROM internal_roles ir
      LEFT JOIN internal_role_permissions irp ON irp.role_id = ir.id
      LEFT JOIN internal_permissions ip ON ip.id = irp.permission_id
      WHERE ir.is_active = 1
      ORDER BY ir.rank_order ASC, ip.code ASC
    `,
  ])

  const items = normalizeRows(rows).map((row) => ({
    publicId: row.public_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    status: Number(row.is_active) === 1 ? 'ACTIVE' : 'SUSPENDED',
    lastLoginAt: normalizeDateTime(row.last_login_at),
    activeSessionCount: toCount(row.active_session_count),
    roles: String(row.roles || ''),
    departments: String(row.departments || ''),
  }))

  const permissionMatrix = normalizeRows(permissionMatrixRows).reduce((accumulator, row) => {
    const key = String(row.code || "").trim()
    if (!key) return accumulator
    if (!accumulator[key]) {
      accumulator[key] = {
        code: key,
        name: row.name,
        department: row.department,
        permissionCodes: [],
      }
    }
    if (row.permission_code) accumulator[key].permissionCodes.push(String(row.permission_code))
    return accumulator
  }, {})

  const canViewPermissionMatrix = permissionSet instanceof Set && permissionSet.has('permissions:view_matrix')

  return {
    summary: {
      totalStaff: items.length,
      activeStaff: items.filter((row) => row.status === 'ACTIVE').length,
      suspendedStaff: items.filter((row) => row.status === 'SUSPENDED').length,
      departments: [...new Set(items.flatMap((row) => row.departments.split(',').map((item) => item.trim()).filter(Boolean)))],
    },
    items,
    roles: normalizeRows(roleRows).map((row) => ({ code: row.code, name: row.name, department: row.department })),
    permissionMatrix: canViewPermissionMatrix
      ? Object.values(permissionMatrix).map((row) => ({
          ...row,
          permissionCodes: normalizePermissionList(row.permissionCodes),
          permissionCount: normalizePermissionList(row.permissionCodes).length,
        }))
      : [],
  }
}

export async function assignInternalRole({ actor, userPublicId, roleCode }) {
  const [user, role] = await Promise.all([
    resolveUserByPublicIdOrThrow(userPublicId),
    resolveInternalRoleOrThrow(roleCode),
  ])

  await prisma.$executeRaw`
    INSERT INTO internal_user_roles (
      user_id,
      role_id,
      is_active,
      assigned_by_user_id
    )
    VALUES (
      ${user.id},
      ${role.id},
      1,
      ${actor.userId}
    )
    ON DUPLICATE KEY UPDATE
      is_active = 1,
      assigned_by_user_id = VALUES(assigned_by_user_id),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_ROLE_ASSIGN',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} assigned internal role ${role.code}.`,
    severity: 'HIGH',
    metadata: { roleCode },
  })

  return { userPublicId, roleCode }
}

export async function revokeInternalRole({ actor, userPublicId, roleCode }) {
  const [user, role] = await Promise.all([
    resolveUserByPublicIdOrThrow(userPublicId),
    resolveInternalRoleOrThrow(roleCode),
  ])

  await prisma.$executeRaw`
    UPDATE internal_user_roles
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${user.id}
      AND role_id = ${role.id}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_ROLE_REVOKE',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} revoked internal role ${role.code}.`,
    severity: 'HIGH',
    metadata: { roleCode },
  })

  return { userPublicId, roleCode, active: false }
}

export async function changeInternalRole({ actor, userPublicId, roleCode }) {
  const [user, role] = await Promise.all([
    resolveUserByPublicIdOrThrow(userPublicId),
    resolveInternalRoleOrThrow(roleCode),
  ])

  await prisma.$executeRaw`
    UPDATE internal_user_roles
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${user.id}
  `

  await prisma.$executeRaw`
    INSERT INTO internal_user_roles (
      user_id,
      role_id,
      is_active,
      assigned_by_user_id
    )
    VALUES (
      ${user.id},
      ${role.id},
      1,
      ${actor.userId}
    )
    ON DUPLICATE KEY UPDATE
      is_active = 1,
      assigned_by_user_id = VALUES(assigned_by_user_id),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await revokeInternalSessionsForUser(user.id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_ROLE_CHANGE',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} changed to internal role ${role.code}.`,
    severity: 'HIGH',
    metadata: { roleCode, resetSessions: true },
  })

  return { userPublicId, roleCode }
}

export async function createInternalUser({ actor, fullName, email, phone = null, roleCode, password = null }) {
  const normalizedFullName = String(fullName || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedPhone = String(phone || '').trim() || null

  if (!normalizedFullName) throw badRequest('Full name is required')
  if (!normalizedEmail) throw badRequest('Email is required')

  const [existingUser, role] = await Promise.all([
    findUserByEmail(normalizedEmail),
    resolveInternalRoleOrThrow(roleCode),
  ])

  if (existingUser?.id) throw badRequest('A user with that email already exists')

  const temporaryPassword = String(password || '').trim() || generateTemporaryPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)
  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO users (
      public_id,
      full_name,
      phone_e164,
      email,
      password_hash,
      is_active
    )
    VALUES (
      ${publicId},
      ${normalizedFullName},
      ${normalizedPhone},
      ${normalizedEmail},
      ${passwordHash},
      1
    )
  `

  const user = await resolveUserByPublicIdOrThrow(publicId)

  await prisma.$executeRaw`
    INSERT INTO internal_user_roles (
      user_id,
      role_id,
      is_active,
      assigned_by_user_id
    )
    VALUES (
      ${user.id},
      ${role.id},
      1,
      ${actor.userId}
    )
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_USER_CREATE',
    targetType: 'USER',
    targetPublicId: publicId,
    summary: `${normalizedFullName} created as internal user with role ${role.code}.`,
    severity: 'HIGH',
    metadata: { email: normalizedEmail, roleCode },
  })

  return {
    publicId,
    email: normalizedEmail,
    temporaryPassword,
    roleCode,
  }
}

export async function suspendInternalUser({ actor, userPublicId }) {
  const user = await resolveUserByPublicIdOrThrow(userPublicId)
  if (Number(user.id) === Number(actor.userId)) throw badRequest('You cannot suspend your own internal account')

  await prisma.$executeRaw`
    UPDATE users
    SET is_active = 0
    WHERE id = ${user.id}
  `
  await revokeInternalSessionsForUser(user.id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_USER_SUSPEND',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} suspended from internal access.`,
    severity: 'CRITICAL',
    metadata: { email: user.email || null },
  })

  return { userPublicId, status: 'SUSPENDED' }
}

export async function reactivateInternalUser({ actor, userPublicId }) {
  const user = await resolveUserByPublicIdOrThrow(userPublicId)

  await prisma.$executeRaw`
    UPDATE users
    SET is_active = 1
    WHERE id = ${user.id}
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_USER_REACTIVATE',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} reactivated for internal access.`,
    severity: 'HIGH',
    metadata: { email: user.email || null },
  })

  return { userPublicId, status: 'ACTIVE' }
}

export async function forceSignOutInternalUser({ actor, userPublicId }) {
  const user = await resolveUserByPublicIdOrThrow(userPublicId)
  await revokeInternalSessionsForUser(user.id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_USER_FORCE_SIGN_OUT',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} signed out from all internal sessions.`,
    severity: 'HIGH',
    metadata: { email: user.email || null },
  })

  return { userPublicId, sessionsRevoked: true }
}

export async function lockInternalAccount({ actor, userPublicId }) {
  const user = await resolveUserByPublicIdOrThrow(userPublicId)
  if (Number(user.id) === Number(actor.userId)) throw badRequest('You cannot lock your own internal account')

  await prisma.$executeRaw`
    UPDATE users
    SET is_active = 0
    WHERE id = ${user.id}
  `
  await revokeInternalSessionsForUser(user.id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_ACCOUNT_LOCK',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} locked from internal access.`,
    severity: 'CRITICAL',
    metadata: { email: user.email || null },
  })

  return { userPublicId, status: 'LOCKED' }
}

export async function resetInternalAccess({ actor, userPublicId }) {
  const user = await resolveUserByPublicIdOrThrow(userPublicId)
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  await prisma.$executeRaw`
    UPDATE users
    SET password_hash = ${passwordHash}, is_active = 1
    WHERE id = ${user.id}
  `
  await revokeInternalSessionsForUser(user.id)

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_ACCESS_RESET',
    targetType: 'USER',
    targetPublicId: userPublicId,
    summary: `${user.full_name || user.public_id} internal access reset.`,
    severity: 'CRITICAL',
    metadata: { email: user.email || null, sessionsRevoked: true },
  })

  return { userPublicId, temporaryPassword }
}

export async function getSystemHealthData() {
  const [syncCount, openSessions, deliveryLag, eventRows, settingRows, engineeringAuditRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS queued_events
      FROM ingested_events
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
    `.catch(() => [{ queued_events: 0 }]),
    prisma.$queryRaw`
      SELECT COUNT(*) AS active_internal_sessions
      FROM internal_auth_sessions
      WHERE revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
    `,
    prisma.$queryRaw`
      SELECT TIMESTAMPDIFF(MINUTE, MAX(created_at), CURRENT_TIMESTAMP(3)) AS lag_minutes
      FROM transactions
    `,
    optionalRows(prisma.$queryRaw`
      SELECT public_id, service_key, environment_key, severity, status, summary, detail, source_key, created_at, resolved_at
      FROM system_health_events
      ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'WARNING', 'INFO'), created_at DESC
      LIMIT 40
    `, "system_health_events"),
    optionalRows(prisma.$queryRaw`
      SELECT setting_key, setting_value
      FROM internal_settings
      WHERE setting_key IN ('allow_quick_tunnel_host', 'internal_access_policy', 'emergency_override_enabled')
      ORDER BY setting_key ASC
    `, "internal_settings"),
    optionalRows(prisma.$queryRaw`
      SELECT public_id, action_type, target_type, target_public_id, summary, severity, metadata, created_at
      FROM internal_audit_log
      WHERE target_type = 'SYSTEM_HEALTH_EVENT'
        OR action_type LIKE 'ENGINEERING_%'
      ORDER BY created_at DESC
      LIMIT 30
    `, "internal_audit_log"),
  ])

  const events = normalizeRows(eventRows).map((row) => ({
    publicId: row.public_id,
    serviceKey: row.service_key,
    environmentKey: row.environment_key,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    detail: row.detail,
    sourceKey: row.source_key,
    createdAt: normalizeDateTime(row.created_at),
    resolvedAt: normalizeDateTime(row.resolved_at),
  }))

  const engineeringAudit = normalizeRows(engineeringAuditRows).map((row) => ({
    publicId: row.public_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetPublicId: row.target_public_id,
    summary: row.summary,
    severity: row.severity,
    metadata: parseJsonField(row.metadata, {}),
    createdAt: normalizeDateTime(row.created_at),
  }))

  const settingsMap = new Map(
    normalizeRows(settingRows).map((row) => [String(row.setting_key || "").trim(), String(row.setting_value || "").trim()])
  )

  const ingestLagMinutes = toCount(deliveryLag?.[0]?.lag_minutes)
  const ingestStatus =
    ingestLagMinutes > SYSTEM_HEALTH_INGEST_DEGRADED_MINUTES
      ? "degraded"
      : ingestLagMinutes > SYSTEM_HEALTH_INGEST_WARNING_MINUTES
        ? "warning"
        : "healthy"
  const services = [
    { service: "api", status: "healthy", detail: "Internal API responding" },
    { service: "database", status: "healthy", detail: "Prisma query path available" },
    { service: "sync-ingest", status: ingestStatus, detail: `Lag: ${ingestLagMinutes} minutes` },
  ]

  const errorLogs = events.filter((row) => ["HIGH", "CRITICAL"].includes(String(row.severity || "").toUpperCase()))
  const requestLogs = events.filter((row) => {
    const haystack = `${row.serviceKey} ${row.sourceKey} ${row.summary}`.toLowerCase()
    return ["api", "gateway", "request", "sync", "webhook"].some((token) => haystack.includes(token))
  })
  const failedJobs = events.filter((row) => {
    const haystack = `${row.serviceKey} ${row.sourceKey} ${row.summary} ${row.detail}`.toLowerCase()
    return ["job", "queue", "worker", "batch", "retry"].some((token) => haystack.includes(token))
  })
  const linkedIncidentByEvent = new Map()
  engineeringAudit.forEach((row) => {
    const linkedIncidentPublicId = String(row.metadata?.incidentPublicId || "").trim()
    if (linkedIncidentPublicId && row.targetPublicId && !linkedIncidentByEvent.has(row.targetPublicId)) {
      linkedIncidentByEvent.set(row.targetPublicId, linkedIncidentPublicId)
    }
  })
  const bugNotesByEvent = engineeringAudit.reduce((accumulator, row) => {
    if (!row.targetPublicId) return accumulator
    if (!accumulator[row.targetPublicId]) accumulator[row.targetPublicId] = []
    accumulator[row.targetPublicId].push({
      publicId: row.publicId,
      summary: row.summary,
      note: row.metadata?.note || null,
      createdAt: row.createdAt,
      actionType: row.actionType,
    })
    return accumulator
  }, {})
  const deploymentHistory = [
    {
      environment: process.env.NODE_ENV || "development",
      version: process.env.APP_VERSION || process.env.COMMIT_SHA || "local",
      deployedAt: events[0]?.createdAt || new Date().toISOString(),
      apiHealth: services.find((row) => row.service === "api")?.status || "healthy",
    },
  ]
  const debugTools = {
    errorLogAccess: errorLogs.length,
    requestLogAccess: requestLogs.length,
    failedJobs: failedJobs.length,
    stackTraceAvailable: events.filter((row) => String(row.detail || "").trim()).length,
    apiHealth: services.find((row) => row.service === "api")?.status || "healthy",
  }
  const stagingTools = {
    quickTunnelHost: settingsMap.get("allow_quick_tunnel_host") === "1",
    internalAccessPolicy: settingsMap.get("internal_access_policy") || "STRICT",
    emergencyOverrideEnabled: settingsMap.get("emergency_override_enabled") === "1",
    environment: process.env.NODE_ENV || "development",
  }

  return {
    summary: {
      queuedEvents24h: toCount(syncCount?.[0]?.queued_events),
      activeInternalSessions: toCount(openSessions?.[0]?.active_internal_sessions),
      transactionIngestLagMinutes: ingestLagMinutes,
      degradedServices: services.filter((row) => row.status !== "healthy").length,
    },
    services,
    events: events.map((row) => ({
      ...row,
      linkedIncidentPublicId: linkedIncidentByEvent.get(row.publicId) || null,
      bugNotes: bugNotesByEvent[row.publicId] || [],
    })),
    errorLogs,
    requestLogs,
    failedJobs,
    engineeringAudit,
    deploymentHistory,
    debugTools,
    stagingTools,
    deployment: {
      environment: process.env.NODE_ENV || 'development',
      activeInternalSessions: toCount(openSessions?.[0]?.active_internal_sessions),
      transactionIngestLagMinutes: toCount(deliveryLag?.[0]?.lag_minutes),
    },
  }
}

export async function acknowledgeSystemHealthEvent({ actor, eventPublicId }) {
  const event = await resolveSystemHealthEventOrThrow(eventPublicId)
  if (String(event.status || "").toUpperCase() !== "RESOLVED") {
    await prisma.$executeRaw`
      UPDATE system_health_events
      SET status = 'ACKNOWLEDGED', updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${event.id}
    `
  }

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "ENGINEERING_BUG_ACKNOWLEDGED",
    targetType: "SYSTEM_HEALTH_EVENT",
    targetPublicId: eventPublicId,
    summary: `Engineering acknowledged system health event ${eventPublicId}.`,
    severity: event.severity || "MEDIUM",
  })

  return { eventPublicId, status: "ACKNOWLEDGED" }
}

export async function createSystemHealthBugNote({ actor, eventPublicId, note }) {
  const event = await resolveSystemHealthEventOrThrow(eventPublicId)
  const normalizedNote = String(note || "").trim()
  if (!normalizedNote) throw badRequest("Bug note is required")

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "ENGINEERING_BUG_NOTE",
    targetType: "SYSTEM_HEALTH_EVENT",
    targetPublicId: eventPublicId,
    summary: `Engineering bug note added for ${event.summary}.`,
    severity: event.severity || "MEDIUM",
    metadata: { note: normalizedNote },
  })

  return { eventPublicId, note: normalizedNote }
}

export async function linkIncidentToSystemHealthEvent({ actor, eventPublicId, incidentPublicId }) {
  const event = await resolveSystemHealthEventOrThrow(eventPublicId)
  const normalizedIncidentPublicId = String(incidentPublicId || "").trim()
  if (!normalizedIncidentPublicId) throw badRequest("Incident public ID is required")

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: "ENGINEERING_INCIDENT_LINK",
    targetType: "SYSTEM_HEALTH_EVENT",
    targetPublicId: eventPublicId,
    summary: `Incident ${normalizedIncidentPublicId} linked to ${event.summary}.`,
    severity: event.severity || "MEDIUM",
    metadata: { incidentPublicId: normalizedIncidentPublicId },
  })

  return { eventPublicId, incidentPublicId: normalizedIncidentPublicId }
}

export async function getSettingsData() {
  const rows = await prisma.$queryRaw`
    SELECT setting_key, setting_value, updated_at
    FROM internal_settings
    ORDER BY setting_key ASC
  `

  const items = normalizeRows(rows)
  const requiredDefaults = {
    support_refund_threshold_mwk: '15000',
    escalation_policy_window_minutes: '30',
    audit_retention_days: '365',
    internal_access_policy: 'STRICT',
    emergency_override_enabled: '0',
    allow_quick_tunnel_host: '0',
  }

  Object.entries(requiredDefaults).forEach(([settingKey, settingValue]) => {
    if (!items.some((row) => row.setting_key === settingKey)) {
      items.push({
        setting_key: settingKey,
        setting_value: settingValue,
        updated_at: null,
      })
    }
  })

  const normalizedItems = items
    .sort((left, right) => String(left.setting_key || '').localeCompare(String(right.setting_key || '')))
    .map((row) => ({
    settingKey: row.setting_key,
    settingValue: row.setting_value,
    updatedAt: normalizeDateTime(row.updated_at),
    category: row.setting_key.includes('refund')
      ? 'Finance'
      : row.setting_key.includes('audit')
        ? 'Governance'
        : row.setting_key.includes('escalation') || row.setting_key.includes('access_policy') || row.setting_key.includes('override')
          ? 'Security'
        : row.setting_key.includes('timezone')
          ? 'Operations'
          : 'Platform',
    }))

  return {
    summary: {
      editableSettings: normalizedItems.length,
      financeControls: normalizedItems.filter((row) => row.category === 'Finance').length,
      governanceControls: normalizedItems.filter((row) => row.category === 'Governance').length,
    },
    items: normalizedItems,
  }
}

export async function updateInternalSetting({ actor, settingKey, settingValue }) {
  const scopedKey = String(settingKey || '').trim()
  if (!scopedKey) throw badRequest('settingKey is required')

  await prisma.$executeRaw`
    INSERT INTO internal_settings (
      setting_key,
      setting_value,
      updated_by_user_id
    )
    VALUES (
      ${scopedKey},
      ${String(settingValue ?? '')},
      ${actor.userId}
    )
    ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      updated_by_user_id = VALUES(updated_by_user_id),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  await createInternalAuditLog({
    actorUserId: actor.userId,
    actorRoleCode: actor.primaryRole,
    actionType: 'INTERNAL_SETTING_UPDATE',
    targetType: 'SETTING',
    targetPublicId: scopedKey,
    summary: `Internal setting ${scopedKey} updated.`,
    severity: 'HIGH',
    metadata: { settingValue: String(settingValue ?? '') },
  })

  return { settingKey: scopedKey, settingValue: String(settingValue ?? '') }
}

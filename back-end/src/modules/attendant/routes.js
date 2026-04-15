import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok, notFound } from "../../utils/http.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import {
  createPublicId,
  writeAuditLog,
} from "../common/db.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import {
  extractRequestedLiters,
  isReservationsTableMissingError,
  parseReservationMetadata,
} from "../common/reservations.js"
import { listStationPumpsWithNozzles } from "../pumps/pumps.service.js"
import {
  collectAssignedNozzlePublicIds,
  resolveAssignableNozzle,
} from "../userQueue/service.js"
import {
  REFUND_INVESTIGATION_STATUSES,
  REFUND_REVIEW_STAGES,
  REFUND_STATUSES,
} from "../internal/refundWorkflow.js"
import { notifyUserOfCashbackAward } from "../promotions/transactionPricing.service.js"
import { getPromotionPricingPreview } from "../promotions/service.js"
import {
  completePumpSessionBinding,
  ensurePumpSessionBinding,
} from "../monitoring/monitoring.service.js"
import {
  createQueueServiceTransaction,
  finalizeQueueWalletSettlement,
  finalizeReservationSettlement,
  findEntryOrThrow,
  findReservationForSettlement,
  resolveQueueServiceLitres,
  resolveQueueServicePaymentReference,
  resolveQueueSettlementPaymentMethod,
  resolveStationContext,
  shouldCreateQueueServiceTransaction,
} from "../queue/routes.js"
import {
  clearHybridOrderFlow,
  commitHybridOrderToLane,
  completeHybridOrderFlow,
  markHybridOrderFueling,
  markHybridOrderReadyOnSite,
  validateHybridPilotPumpAssignment,
} from "../queue/hybrid/integration.service.js"
import {
  createQueuePrepayWalletHold,
  releaseQueuePrepayWalletHold,
  replaceQueuePrepayWalletPayment,
} from "../common/wallets.js"
import {
  buildSmartPayPrepayQuote,
} from "../userQueue/routes.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import {
  assertAttendantTransition,
  assessAttendantRefundRequest,
  ATTENDANT_EXCEPTION_REASON_CODES,
  ATTENDANT_ORDER_STATES,
  ATTENDANT_ORDER_TYPES,
  ATTENDANT_REJECTION_REASON_CODES,
  ATTENDANT_REFUND_REASON_CODES,
  deriveAttendantOrderState,
  deriveTelemetryStatus,
  normalizeAttendantOrderType,
  normalizeAttendantWorkflow,
  normalizeExceptionReasonCode,
  normalizeRejectionReasonCode,
  normalizeRefundReasonCode,
} from "./service.js"

const router = Router()
const attendantReadRole = requireRole(["MANAGER", "ATTENDANT", "VIEWER"])
const attendantWriteRole = requireRole(["MANAGER", "ATTENDANT"])
const ATTENDANT_SETTLEMENT_TRANSACTION_MAX_WAIT_MS = 10_000
const ATTENDANT_SETTLEMENT_TRANSACTION_TIMEOUT_MS = 20_000

router.use("/stations/:stationPublicId/attendant", requireStationScope)
router.use(
  "/stations/:stationPublicId/attendant",
  requireStationPlanFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
)

const orderParamsSchema = z.object({
  orderType: z.string().trim(),
  orderPublicId: z.string().trim().min(1).max(64),
})

const rejectBodySchema = z.object({
  reasonCode: z.string().trim(),
  note: z.string().trim().max(1000).optional(),
})

const customerArrivedBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
})

const assignPumpBodySchema = z.object({
  pumpPublicId: z.string().trim().min(1).max(64),
  nozzlePublicId: z.string().trim().max(64).optional(),
  note: z.string().trim().max(1000).optional(),
})

const startServiceBodySchema = z.object({
  manualMode: z.boolean().optional(),
  manualReason: z.string().trim().max(1000).optional(),
})

const completeServiceBodySchema = z.object({
  litres: z.number().positive().optional(),
  amount: z.number().positive().optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY", "CARD", "OTHER"]).optional(),
  note: z.string().trim().max(1000).optional(),
})

const updateServiceRequestBodySchema = z.object({
  fuelType: z.enum(["petrol", "diesel"]).optional(),
  requestedLitres: z.number().positive().optional(),
  amountMwk: z.number().positive().optional(),
  vehicleLabel: z.string().trim().max(120).optional(),
}).refine((body) => (
  body.fuelType !== undefined
  || body.requestedLitres !== undefined
  || body.amountMwk !== undefined
  || body.vehicleLabel !== undefined
), {
  message: "Provide at least one editable service-request field.",
}).refine((body) => !(body.requestedLitres !== undefined && body.amountMwk !== undefined), {
  message: "Send either requestedLitres or amountMwk, not both.",
})

const issueBodySchema = z.object({
  reasonCode: z.string().trim(),
  note: z.string().trim().min(4).max(4000),
  evidenceUrl: z.string().trim().max(1000).optional(),
})

const refundBodySchema = z.object({
  reasonCode: z.string().trim(),
  note: z.string().trim().min(4).max(4000),
  evidenceUrl: z.string().trim().max(1000).optional(),
  amountMwk: z.number().positive().optional(),
  manualLitres: z.number().positive().optional(),
})

function parseJsonString(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function parsePriceAmount(value) {
  if (value === null || value === undefined || value === "") return null
  const normalized = Number(String(value).replace(/[^0-9.-]/g, ""))
  return Number.isFinite(normalized) ? normalized : null
}

function resolveFuelPricePerLitre(pricesJson, fuelType) {
  const normalizedFuelType = String(fuelType || "").trim().toUpperCase()
  if (!normalizedFuelType) return null

  let items = []
  try {
    const parsed = JSON.parse(pricesJson || "[]")
    items = Array.isArray(parsed) ? parsed : []
  } catch {
    items = []
  }
  if (!items.length) return null

  const matchingItem = items.find((item) => {
    const label = String(item?.label || item?.name || item?.fuelType || item?.type || "")
      .trim()
      .toUpperCase()
    if (!label) return false
    return label === normalizedFuelType || label.startsWith(`${normalizedFuelType} `) || label.includes(normalizedFuelType)
  })

  const amount =
    parsePriceAmount(matchingItem?.pricePerLitre)
    ?? parsePriceAmount(matchingItem?.price_per_litre)
    ?? parsePriceAmount(matchingItem?.price)
    ?? parsePriceAmount(matchingItem?.amount)
    ?? parsePriceAmount(matchingItem?.value)

  if (!Number.isFinite(amount) || amount <= 0) return null
  return Number(amount.toFixed(2))
}

function resolveQueueServiceRequestPaymentMode(serviceRequest = {}, metadata = {}) {
  const normalizedMode = String(serviceRequest?.paymentMode || metadata?.paymentMode || "").trim().toUpperCase()
  if (serviceRequest?.prepaySelected === true || metadata?.prepaySelected === true || normalizedMode === "PREPAY") {
    return "PREPAY"
  }
  return "PAY_AT_PUMP"
}

function extractQueueServiceRequestLitres(serviceRequest = {}, metadata = {}) {
  return (
    toNumberOrNull(serviceRequest?.requestedLitres)
    ?? toNumberOrNull(serviceRequest?.requestedLiters)
    ?? toNumberOrNull(serviceRequest?.litres)
    ?? toNumberOrNull(serviceRequest?.liters)
    ?? toNumberOrNull(metadata?.requestedLitres)
    ?? toNumberOrNull(metadata?.requestedLiters)
    ?? toNumberOrNull(metadata?.requested_litres)
  )
}

function numbersRoughlyEqual(left, right, tolerance = 0.01) {
  if (left === null && right === null) return true
  if (left === null || right === null) return false
  return Math.abs(Number(left) - Number(right)) <= tolerance
}

export function deriveEditedQueueServiceRequestPricing({
  body = {},
  rawMetadata = {},
  rowFuelCode = "",
  stationPricesJson = null,
  smartPayPricing = null,
} = {}) {
  const existingServiceRequest =
    rawMetadata?.serviceRequest && typeof rawMetadata.serviceRequest === "object"
      ? rawMetadata.serviceRequest
      : {}
  const effectivePaymentMode = resolveQueueServiceRequestPaymentMode(existingServiceRequest, rawMetadata)
  const normalizedFuelCode =
    String(
      body?.fuelType
      || existingServiceRequest?.fuelType
      || rowFuelCode
      || ""
    )
      .trim()
      .toUpperCase()
  const basePricePerLitre = resolveFuelPricePerLitre(stationPricesJson, normalizedFuelCode)
  const currentRequestedLitres = extractQueueServiceRequestLitres(existingServiceRequest, rawMetadata)
  const currentEstimatedAmountMwk =
    toNumberOrNull(existingServiceRequest?.estimatedAmount)
    ?? toNumberOrNull(existingServiceRequest?.amountMwk)
    ?? toNumberOrNull(rawMetadata?.amountMwk)
  const currentRequestedAmountMwk =
    toNumberOrNull(existingServiceRequest?.requestedAmountMwk)
    ?? currentEstimatedAmountMwk
  const explicitRequestedLitres =
    body?.requestedLitres !== undefined
      ? Number(body.requestedLitres)
      : null
  const explicitAmountMwk =
    body?.amountMwk !== undefined
      ? Number(body.amountMwk)
      : null

  let requestedLitres =
    explicitRequestedLitres !== null
      ? explicitRequestedLitres
      : explicitAmountMwk !== null
        && basePricePerLitre !== null
        && basePricePerLitre > 0
        ? Number((explicitAmountMwk / basePricePerLitre).toFixed(2))
        : currentRequestedLitres

  if (
    requestedLitres === null
    && currentRequestedAmountMwk !== null
    && basePricePerLitre !== null
    && basePricePerLitre > 0
  ) {
    requestedLitres = Number((currentRequestedAmountMwk / basePricePerLitre).toFixed(2))
  }

  const requestedAmountMwk =
    explicitAmountMwk !== null
      ? explicitAmountMwk
      : requestedLitres !== null && basePricePerLitre !== null && basePricePerLitre > 0
        ? Math.round(requestedLitres * basePricePerLitre)
        : currentRequestedAmountMwk

  const quotedBaseAmountMwk =
    requestedLitres !== null && basePricePerLitre !== null && basePricePerLitre > 0
      ? Math.round(requestedLitres * basePricePerLitre)
      : requestedAmountMwk

  const smartPayQuote =
    effectivePaymentMode === "PREPAY" && requestedLitres !== null && basePricePerLitre !== null && basePricePerLitre > 0
      ? buildSmartPayPrepayQuote({
          pricing: smartPayPricing && typeof smartPayPricing === "object" ? smartPayPricing : {},
          basePricePerLitre,
          litres: requestedLitres,
        })
      : null

  const estimatedAmountMwk =
    effectivePaymentMode === "PREPAY"
      ? toNumberOrNull(smartPayQuote?.estimatedAmount) ?? quotedBaseAmountMwk
      : quotedBaseAmountMwk

  const displayPricePerLitre =
    effectivePaymentMode === "PREPAY"
      ? toNumberOrNull(smartPayQuote?.payablePricePerLitre) ?? basePricePerLitre
      : basePricePerLitre

  const currentFuelCode = String(existingServiceRequest?.fuelType || rowFuelCode || "").trim().toUpperCase()
  const hasPaymentImpactChange =
    currentFuelCode !== normalizedFuelCode
    || !numbersRoughlyEqual(currentRequestedLitres, requestedLitres, 0.01)
    || !numbersRoughlyEqual(currentEstimatedAmountMwk, estimatedAmountMwk, 0.5)

  return {
    effectivePaymentMode,
    normalizedFuelCode,
    basePricePerLitre,
    requestedLitres,
    requestedAmountMwk,
    quotedBaseAmountMwk,
    estimatedAmountMwk,
    displayPricePerLitre,
    smartPayQuote,
    currentFuelCode,
    currentRequestedLitres,
    currentEstimatedAmountMwk,
    hasPaymentImpactChange,
  }
}

async function resolveFuelTypeIdByCode(code) {
  const normalizedCode = String(code || "").trim().toUpperCase()
  if (!normalizedCode) return null

  const rows = await prisma.$queryRaw`
    SELECT id
    FROM fuel_types
    WHERE UPPER(code) = ${normalizedCode}
    LIMIT 1
  `

  return Number(rows?.[0]?.id || 0) || null
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes(String(tableName || "").toLowerCase())) return false
  return (
    message.includes("doesn't exist")
    || message.includes("does not exist")
    || message.includes("unknown table")
    || message.includes("unknown column")
  )
}

async function optionalRows(queryPromise, tableName) {
  try {
    return await queryPromise
  } catch (error) {
    if (tableName && isMissingTableError(error, tableName)) {
      return []
    }
    throw error
  }
}

async function optionalExecute(executor, tableName) {
  try {
    return await executor()
  } catch (error) {
    if (tableName && isMissingTableError(error, tableName)) {
      return null
    }
    throw error
  }
}

async function ensureRefundWorkflowStorageReady() {
  try {
    await prisma.$queryRaw`
      SELECT
        id,
        public_id,
        transaction_id,
        transaction_public_id,
        refund_reason_code,
        user_statement,
        investigation_status,
        review_stage
      FROM refund_requests
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, public_id, refund_request_id, evidence_type, source_type
      FROM refund_evidence
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error, "refund_requests") || isMissingTableError(error, "refund_evidence")) {
      throw badRequest(
        "Refund workflow storage is unavailable. Run SQL migrations 027_internal_dashboard_expansion.sql and 039_refund_investigation_architecture.sql."
      )
    }
    throw error
  }
}

function buildCustomerLabel({ userName, fallbackIdentifier, userPublicId }) {
  const name = String(userName || "").trim()
  if (name) return name

  const identifier = String(fallbackIdentifier || "").trim()
  if (identifier) {
    return identifier.length <= 8 ? identifier : `${identifier.slice(0, 2)}***${identifier.slice(-2)}`
  }

  const publicId = String(userPublicId || "").trim()
  return publicId ? `Customer ${publicId.slice(-6)}` : "Walk-in customer"
}

function normalizeRefundPriorityByAmount(amount) {
  const normalizedAmount = Number(amount || 0)
  if (normalizedAmount >= 50000) return "CRITICAL"
  if (normalizedAmount >= 25000) return "HIGH"
  if (normalizedAmount >= 10000) return "MEDIUM"
  return "LOW"
}

function buildOrderMatchKeys(orderType, orderPublicId, row = {}) {
  const normalizedType = normalizeAttendantOrderType(orderType)
  const scopedOrderPublicId = String(orderPublicId || "").trim()
  const keys = new Set()
  keys.add(`${normalizedType}:${scopedOrderPublicId}`)
  if (normalizedType === ATTENDANT_ORDER_TYPES.QUEUE) {
    keys.add(scopedOrderPublicId)
    if (row?.reservationPublicId) keys.add(String(row.reservationPublicId))
  }
  if (normalizedType === ATTENDANT_ORDER_TYPES.RESERVATION) {
    keys.add(scopedOrderPublicId)
    if (row?.sourceQueueEntryPublicId) keys.add(String(row.sourceQueueEntryPublicId))
  }
  return keys
}

async function resolveActorContext(stationId, userId, userPublicId = "") {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return {
      actorUserId: null,
      actorStaffId: null,
      actorPublicId: String(userPublicId || "").trim() || null,
      actorName: null,
    }
  }

  const rows = await prisma.$queryRaw`
    SELECT
      u.id AS user_id,
      u.public_id AS user_public_id,
      u.full_name,
      ss.id AS staff_id
    FROM users u
    LEFT JOIN station_staff ss
      ON ss.user_id = u.id
      AND ss.station_id = ${stationId}
      AND ss.is_active = 1
    WHERE u.id = ${normalizedUserId}
    LIMIT 1
  `

  const row = rows?.[0] || {}
  return {
    actorUserId: normalizedUserId,
    actorStaffId: Number(row.staff_id || 0) || null,
    actorPublicId: String(row.user_public_id || userPublicId || "").trim() || null,
    actorName: String(row.full_name || "").trim() || null,
  }
}

function updateMetadataWorkflow(rawMetadata, mutate) {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? { ...rawMetadata } : {}
  const workflow = normalizeAttendantWorkflow(metadata)
  const nextWorkflow = {
    ...workflow,
    exceptions: Array.isArray(workflow.exceptions) ? [...workflow.exceptions] : [],
  }
  mutate(nextWorkflow, metadata)
  metadata.attendantWorkflow = nextWorkflow
  return { metadata, workflow: nextWorkflow }
}

function deriveRejectStatus(orderType, reasonCode) {
  const normalizedType = normalizeAttendantOrderType(orderType)
  const normalizedReasonCode = normalizeRejectionReasonCode(reasonCode)
  const isAbsenceLike = ["customer_not_present", "reservation_expired"].includes(normalizedReasonCode)

  if (normalizedType === ATTENDANT_ORDER_TYPES.RESERVATION) {
    return isAbsenceLike ? "EXPIRED" : "CANCELLED"
  }

  return isAbsenceLike ? "NO_SHOW" : "CANCELLED"
}

function maybeUpdateLastManualEntry(workflow, actor, payload = {}) {
  const litres = toNumberOrNull(payload.litres)
  const amountMwk = toNumberOrNull(payload.amount)
  const paymentMethod = String(payload.paymentMethod || "").trim().toUpperCase() || null
  if (litres === null && amountMwk === null && !paymentMethod) return

  workflow.lastManualEntry = {
    litres,
    amountMwk,
    paymentMethod,
    enteredAt: new Date().toISOString(),
    enteredByUserId: actor.actorUserId,
    enteredByName: actor.actorName,
  }
}

function applyCompletedPumpState({
  nextMetadata,
  assignment,
  completionTime,
  completedDispensedLitres = null,
}) {
  if (!nextMetadata || typeof nextMetadata !== "object") return

  const normalizedCompletedAt = completionTime instanceof Date
    ? completionTime.toISOString()
    : String(completionTime || "").trim() || null
  const normalizedLitres = toNumberOrNull(completedDispensedLitres)

  if (assignment?.pumpPublicId || assignment?.nozzlePublicId) {
    nextMetadata.lastPumpScan = {
      ...(nextMetadata.lastPumpScan && typeof nextMetadata.lastPumpScan === "object"
        ? nextMetadata.lastPumpScan
        : {}),
      pumpPublicId: assignment?.pumpPublicId || nextMetadata?.lastPumpScan?.pumpPublicId || null,
      pumpNumber: assignment?.pumpNumber ?? nextMetadata?.lastPumpScan?.pumpNumber ?? null,
      pumpStatus: "ACTIVE",
      nozzlePublicId: assignment?.nozzlePublicId || nextMetadata?.lastPumpScan?.nozzlePublicId || null,
      nozzleNumber: assignment?.nozzleNumber || nextMetadata?.lastPumpScan?.nozzleNumber || null,
      nozzleStatus: "ACTIVE",
      fuelType: assignment?.fuelType || nextMetadata?.lastPumpScan?.fuelType || null,
      scannedAt:
        String(nextMetadata?.lastPumpScan?.scannedAt || "").trim()
        || normalizedCompletedAt,
    }
  }

  if (nextMetadata.serviceRequest && typeof nextMetadata.serviceRequest === "object") {
    nextMetadata.serviceRequest = {
      ...nextMetadata.serviceRequest,
      pumpPublicId: assignment?.pumpPublicId || nextMetadata.serviceRequest.pumpPublicId || null,
      nozzlePublicId: assignment?.nozzlePublicId || nextMetadata.serviceRequest.nozzlePublicId || null,
      fuelType: assignment?.fuelType || nextMetadata.serviceRequest.fuelType || null,
      pumpSessionStatus: "COMPLETED",
      dispensingCompletedAt: normalizedCompletedAt,
      completedDispensedLitres: normalizedLitres,
    }
  }
}

async function notifyUserOfAttendantRefundRequest({
  userId,
  station,
  refundPublicId,
  transactionPublicId = null,
  amountMwk = null,
  reasonCode = "",
  orderType = "",
  orderPublicId = "",
}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return null
  }

  const formattedAmount = Number.isFinite(Number(amountMwk))
    ? `MWK ${Number(amountMwk).toLocaleString()}`
    : "your requested amount"
  const alert = await createUserAlert({
    userId: normalizedUserId,
    stationId: station?.id || null,
    category: "SYSTEM",
    title: "Refund request submitted",
    body: `A station attendant submitted a refund request for ${formattedAmount}. Open Help to follow the review.`,
    metadata: {
      refundPublicId,
      transactionPublicId: String(transactionPublicId || "").trim() || null,
      reasonCode: String(reasonCode || "").trim() || null,
      orderType: String(orderType || "").trim() || null,
      orderPublicId: String(orderPublicId || "").trim() || null,
      stationPublicId: String(station?.public_id || "").trim() || null,
      stationName: String(station?.name || "").trim() || null,
      path: "/help",
      route: "/help",
    },
  })

  publishUserAlert({
    userId: normalizedUserId,
    eventType: "user_alert:new",
    data: alert,
  })

  await sendPushAlertToUser({
    userId: normalizedUserId,
    notification: {
      title: alert.title,
      body: alert.message,
      tag: alert.publicId || `refund-${refundPublicId}`,
      url: "/help",
      icon: "/smartlogo.png",
      badge: "/smartlogo.png",
    },
    data: {
      alertPublicId: alert.publicId || null,
      refundPublicId,
      transactionPublicId: String(transactionPublicId || "").trim() || null,
      path: "/help",
    },
  }).catch(() => {
    // Push delivery is best-effort.
  })

  return alert
}

async function notifyUserOfQueueServiceRequestUpdate({
  userId,
  station,
  queueJoinId,
  fuelType = "",
  requestedLitres = null,
  amountMwk = null,
}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return null
  }

  const normalizedFuelType = String(fuelType || "").trim().toUpperCase() || "fuel"
  const requestLabel =
    Number.isFinite(Number(requestedLitres)) && Number(requestedLitres) > 0
      ? `${Number(requestedLitres)} L`
      : Number.isFinite(Number(amountMwk)) && Number(amountMwk) > 0
        ? `MWK ${Number(amountMwk).toLocaleString()}`
        : "your fuel request"

  const queuePath = `/m/queue/${encodeURIComponent(String(queueJoinId || "").trim())}`
  const alert = await createUserAlert({
    userId: normalizedUserId,
    stationId: station?.id || null,
    category: "SYSTEM",
    title: "Fuel request updated",
    body: `The station attendant updated your ${normalizedFuelType} request to ${requestLabel}. Review the latest queue details in SmartLink.`,
    metadata: {
      event: "queue_service_request_updated",
      queueJoinId: String(queueJoinId || "").trim() || null,
      orderType: ATTENDANT_ORDER_TYPES.QUEUE,
      orderPublicId: String(queueJoinId || "").trim() || null,
      requestedLitres: Number.isFinite(Number(requestedLitres)) ? Number(requestedLitres) : null,
      amountMwk: Number.isFinite(Number(amountMwk)) ? Number(amountMwk) : null,
      fuelType: normalizedFuelType,
      stationPublicId: String(station?.public_id || "").trim() || null,
      stationName: String(station?.name || "").trim() || null,
      path: queuePath,
      route: queuePath,
    },
  })

  publishUserAlert({
    userId: normalizedUserId,
    eventType: "user_alert:new",
    data: alert,
  })

  return alert
}

async function listLiveQueueRows(stationId) {
  return prisma.$queryRaw`
    SELECT
      qe.id,
      qe.public_id,
      qe.user_id,
      qe.station_id,
      qe.fuel_type_id,
      qe.position,
      qe.status,
      qe.masked_plate,
      qe.called_at,
      qe.grace_expires_at,
      qe.joined_at,
      qe.served_at,
      qe.cancelled_at,
      qe.metadata,
      ft.code AS fuel_code,
      u.public_id AS user_public_id,
      u.full_name AS user_name
    FROM queue_entries qe
    LEFT JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    LEFT JOIN users u ON u.id = qe.user_id
    WHERE qe.station_id = ${stationId}
      AND qe.status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY qe.position ASC, qe.joined_at ASC, qe.id ASC
  `
}

async function listLiveReservationRows(stationId) {
  try {
    return await prisma.$queryRaw`
      SELECT
        ur.id,
        ur.public_id,
        ur.user_id,
        ur.station_id,
        ur.fuel_type_id,
        ur.source_queue_entry_id,
        ur.requested_litres,
        ur.identifier,
        ur.status,
        ur.slot_start,
        ur.slot_end,
        ur.confirmed_at,
        ur.fulfilled_at,
        ur.cancelled_at,
        ur.metadata,
        ft.code AS fuel_code,
        u.public_id AS user_public_id,
        u.full_name AS user_name,
        qe.public_id AS source_queue_entry_public_id
      FROM user_reservations ur
      LEFT JOIN fuel_types ft ON ft.id = ur.fuel_type_id
      LEFT JOIN users u ON u.id = ur.user_id
      LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
      WHERE ur.station_id = ${stationId}
        AND ur.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
      ORDER BY ur.slot_start ASC, ur.created_at ASC, ur.id ASC
    `
  } catch (error) {
    if (isReservationsTableMissingError(error)) return []
    throw error
  }
}

async function listRecentTransactions(stationId) {
  return prisma.$queryRaw`
    SELECT
      id,
      public_id,
      queue_entry_id,
      reservation_public_id,
      litres,
      total_amount,
      payment_method,
      pump_id,
      nozzle_id,
      occurred_at
    FROM transactions
    WHERE station_id = ${stationId}
    ORDER BY occurred_at DESC, id DESC
    LIMIT 500
  `
}

async function listActivePumpSessionRows(stationId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      ps.error_code,
      ps.error_message,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      ft.code AS fuel_code
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    WHERE ps.station_id = ${stationId}
      AND ps.session_status IN ('CREATED', 'STARTED', 'DISPENSING')
    ORDER BY ps.start_time DESC, ps.id DESC
    LIMIT 100
  `, "pump_sessions")
}

async function listRecentTelemetryRows(stationId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      ptl.id,
      ptl.pump_id,
      ptl.nozzle_id,
      ptl.telemetry_correlation_id,
      ptl.event_type,
      ptl.severity,
      ptl.litres_value,
      ptl.message,
      ptl.happened_at,
      p.public_id AS pump_public_id,
      pn.public_id AS nozzle_public_id
    FROM pump_telemetry_logs ptl
    LEFT JOIN pumps p ON p.id = ptl.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ptl.nozzle_id
    WHERE ptl.station_id = ${stationId}
      AND ptl.happened_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 4 HOUR)
    ORDER BY ptl.happened_at DESC, ptl.id DESC
    LIMIT 600
  `, "pump_telemetry_logs")
}

async function listRecentRefundRows(stationId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      rr.id,
      rr.public_id,
      rr.transaction_id,
      rr.transaction_public_id,
      rr.user_id,
      rr.amount_mwk,
      rr.priority,
      rr.status,
      rr.investigation_status,
      rr.review_stage,
      rr.refund_reason_code,
      rr.user_statement,
      rr.resolution_notes,
      rr.requested_by_user_id,
      rr.requested_at,
      rr.created_at,
      u.full_name AS requested_by_name
    FROM refund_requests rr
    LEFT JOIN users u ON u.id = rr.requested_by_user_id
    WHERE rr.station_id = ${stationId}
    ORDER BY COALESCE(rr.requested_at, rr.created_at) DESC, rr.id DESC
    LIMIT 60
  `, "refund_requests")
}

async function listRefundEvidenceRows(stationId) {
  return optionalRows(prisma.$queryRaw`
    SELECT
      rr.public_id AS refund_public_id,
      re.evidence_type,
      re.source_type,
      re.source_id,
      re.summary,
      re.metadata_json,
      re.created_at
    FROM refund_evidence re
    INNER JOIN refund_requests rr ON rr.id = re.refund_request_id
    WHERE rr.station_id = ${stationId}
    ORDER BY re.created_at DESC, re.id DESC
    LIMIT 300
  `, "refund_evidence")
}

function buildTransactionIndexes(rows) {
  const byQueueEntryId = new Map()
  const byReservationPublicId = new Map()

  for (const row of rows || []) {
    const transaction = {
      id: Number(row.id || 0) || null,
      publicId: String(row.public_id || "").trim() || null,
      queueEntryId: Number(row.queue_entry_id || 0) || null,
      reservationPublicId: String(row.reservation_public_id || "").trim() || null,
      litres: toNumberOrNull(row.litres),
      amountMwk: toNumberOrNull(row.total_amount),
      paymentMethod: String(row.payment_method || "").trim() || null,
      pumpId: Number(row.pump_id || 0) || null,
      nozzleId: Number(row.nozzle_id || 0) || null,
      occurredAt: toIsoOrNull(row.occurred_at),
    }

    if (transaction.queueEntryId && !byQueueEntryId.has(transaction.queueEntryId)) {
      byQueueEntryId.set(transaction.queueEntryId, transaction)
    }
    if (transaction.reservationPublicId && !byReservationPublicId.has(transaction.reservationPublicId)) {
      byReservationPublicId.set(transaction.reservationPublicId, transaction)
    }
  }

  return {
    byQueueEntryId,
    byReservationPublicId,
  }
}

function buildTelemetryIndexes(rows) {
  const byNozzlePublicId = new Map()
  const byPumpPublicId = new Map()
  const byNozzlePublicIdWithLitres = new Map()
  const byPumpPublicIdWithLitres = new Map()
  const stopSeenByNozzlePublicId = new Set()
  const stopSeenByPumpPublicId = new Set()

  for (const row of rows || []) {
    const item = {
      eventType: String(row.event_type || "").trim().toUpperCase() || null,
      severity: String(row.severity || "").trim().toUpperCase() || null,
      litresValue: toNumberOrNull(row.litres_value),
      message: String(row.message || "").trim() || null,
      happenedAt: toIsoOrNull(row.happened_at),
      telemetryCorrelationId: String(row.telemetry_correlation_id || "").trim() || null,
    }
    const nozzlePublicId = String(row.nozzle_public_id || "").trim()
    const pumpPublicId = String(row.pump_public_id || "").trim()

    if (nozzlePublicId && !byNozzlePublicId.has(nozzlePublicId)) {
      byNozzlePublicId.set(nozzlePublicId, item)
    }
    if (pumpPublicId && !byPumpPublicId.has(pumpPublicId)) {
      byPumpPublicId.set(pumpPublicId, item)
    }

    const isDispensingStopped = item.eventType === "DISPENSING_STOPPED"

    if (isDispensingStopped) {
      if (nozzlePublicId) stopSeenByNozzlePublicId.add(nozzlePublicId)
      if (pumpPublicId) stopSeenByPumpPublicId.add(pumpPublicId)
      continue
    }

    if (item.litresValue !== null) {
      if (
        nozzlePublicId
        && !stopSeenByNozzlePublicId.has(nozzlePublicId)
        && !byNozzlePublicIdWithLitres.has(nozzlePublicId)
      ) {
        byNozzlePublicIdWithLitres.set(nozzlePublicId, item)
      }
      if (
        pumpPublicId
        && !stopSeenByPumpPublicId.has(pumpPublicId)
        && !byPumpPublicIdWithLitres.has(pumpPublicId)
      ) {
        byPumpPublicIdWithLitres.set(pumpPublicId, item)
      }
    }
  }

  return {
    byNozzlePublicId,
    byPumpPublicId,
    byNozzlePublicIdWithLitres,
    byPumpPublicIdWithLitres,
  }
}

function buildPumpSessionIndex(rows) {
  const byNozzlePublicId = new Map()
  for (const row of rows || []) {
    const nozzlePublicId = String(row.nozzle_public_id || "").trim()
    if (!nozzlePublicId || byNozzlePublicId.has(nozzlePublicId)) continue
    byNozzlePublicId.set(nozzlePublicId, row)
  }
  return { byNozzlePublicId }
}

function buildRefundEvidenceMap(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const refundPublicId = String(row.refund_public_id || "").trim()
    if (!refundPublicId) continue
    if (!map.has(refundPublicId)) map.set(refundPublicId, [])
    map.get(refundPublicId).push({
      evidenceType: String(row.evidence_type || "").trim() || null,
      sourceType: String(row.source_type || "").trim() || null,
      sourceId: String(row.source_id || "").trim() || null,
      summary: String(row.summary || "").trim() || null,
      metadata: parseJsonString(row.metadata_json),
      createdAt: toIsoOrNull(row.created_at),
    })
  }
  return map
}

function resolveAssignmentFromMetadata(metadata = {}, fuelCode = "") {
  const workflow = normalizeAttendantWorkflow(metadata)
  if (workflow?.pumpAssignment?.pumpPublicId) {
    return workflow.pumpAssignment
  }

  const lastPumpScan =
    metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
      ? metadata.lastPumpScan
      : {}
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}

  const pumpPublicId = String(lastPumpScan?.pumpPublicId || serviceRequest?.pumpPublicId || "").trim()
  if (!pumpPublicId) return null

  return {
    pumpPublicId,
    pumpNumber: toNumberOrNull(lastPumpScan?.pumpNumber),
    nozzlePublicId: String(lastPumpScan?.nozzlePublicId || serviceRequest?.nozzlePublicId || "").trim() || null,
    nozzleNumber: String(lastPumpScan?.nozzleNumber || "").trim() || null,
    fuelType: String(lastPumpScan?.fuelType || fuelCode || "").trim().toUpperCase() || null,
    confirmedAt: String(lastPumpScan?.scannedAt || "").trim() || null,
    source: "USER_VERIFIED_PUMP",
  }
}

function resolveStoredPumpSessionIdentity(metadata = {}) {
  const workflow = normalizeAttendantWorkflow(metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}

  return {
    pumpSessionPublicId:
      String(serviceRequest.pumpSessionPublicId || workflow?.pumpSession?.publicId || "").trim() || null,
    sessionReference:
      String(serviceRequest.sessionReference || workflow?.pumpSession?.sessionReference || "").trim() || null,
    telemetryCorrelationId:
      String(serviceRequest.telemetryCorrelationId || workflow?.pumpSession?.telemetryCorrelationId || "").trim() || null,
  }
}

function buildAvailableActions({ state, workflow, telemetryStatus }) {
  const hasPumpAssignment =
    Boolean(workflow?.pumpAssignment?.pumpPublicId)
    || Boolean(workflow?.derivedPumpAssignment?.pumpPublicId)
  const actions = []
  if (assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.ACCEPTED)) actions.push("accept")
  if (assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.REJECTED)) actions.push("reject")
  if (assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED)) actions.push("mark_customer_arrived")
  if (assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.PUMP_ASSIGNED)) actions.push("assign_pump")
  if (hasPumpAssignment && assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.DISPENSING)) {
    actions.push("start_service")
  }
  if (hasPumpAssignment && assertsTransitionSafe(state, ATTENDANT_ORDER_STATES.COMPLETED)) {
    actions.push("complete_service")
  }
  if (state !== ATTENDANT_ORDER_STATES.REFUNDED) actions.push("raise_issue")
  if (![
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
    ATTENDANT_ORDER_STATES.REFUND_APPROVED,
    ATTENDANT_ORDER_STATES.REFUND_DENIED,
    ATTENDANT_ORDER_STATES.REFUNDED,
  ].includes(state)) {
    actions.push("create_refund_request")
  }
  if (telemetryStatus === "offline" || telemetryStatus === "delayed") {
    actions.push("manual_review_recommended")
  }
  return actions
}

function assertsTransitionSafe(currentState, nextState) {
  try {
    assertAttendantTransition(currentState, nextState)
    return true
  } catch {
    return false
  }
}

function buildOrderPayload({
  orderType,
  row,
  transaction = null,
  latestTelemetry = null,
  activePumpSession = null,
}) {
  const metadata = parseReservationMetadata(row.metadata)
  const workflow = normalizeAttendantWorkflow(metadata)
  const lastPumpScan =
    metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
      ? metadata.lastPumpScan
      : {}
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const baseStatus = String(row.status || "").trim().toUpperCase()
  const refundStatus = workflow?.refundRequest?.status || ""
  const attendantState = deriveAttendantOrderState({
    orderType,
    baseStatus,
    metadata,
    refundStatus,
  })

  const requestedLitres =
    orderType === ATTENDANT_ORDER_TYPES.RESERVATION
      ? toNumberOrNull(row.requested_litres)
      : extractRequestedLiters(metadata)

  const pumpAssignment = resolveAssignmentFromMetadata(metadata, row.fuel_code)
  const telemetryStatus = deriveTelemetryStatus({
    pumpStatus: lastPumpScan?.pumpStatus || "",
    nozzleStatus: lastPumpScan?.nozzleStatus || "",
    hasActivePumpSession: Boolean(activePumpSession?.id),
    manualMode: workflow.manualMode,
    telemetryUpdatedAt: latestTelemetry?.happenedAt || null,
  })

  const paymentStatus =
    transaction?.publicId
      ? "SETTLED"
      : metadata?.walletSettlement?.transactionReference
        ? "CAPTURED"
        : metadata?.serviceRequest?.paymentMode
          ? String(metadata.serviceRequest.paymentMode).trim().toUpperCase()
          : "PENDING"
  const servicePaymentMode =
    orderType === ATTENDANT_ORDER_TYPES.QUEUE
      ? resolveQueueServiceRequestPaymentMode(serviceRequest, metadata)
      : transaction?.paymentMethod
        ? String(transaction.paymentMethod).trim().toUpperCase()
        : null

  const customerIdentifier =
    orderType === ATTENDANT_ORDER_TYPES.QUEUE
      ? String(row.masked_plate || "").trim()
      : String(row.identifier || "").trim()

  const workflowWithDerivedAssignment = {
    ...workflow,
    derivedPumpAssignment: pumpAssignment,
  }

  return {
    orderType,
    orderPublicId: String(row.public_id || "").trim(),
    customerName: buildCustomerLabel({
      userName: row.user_name,
      fallbackIdentifier: customerIdentifier,
      userPublicId: row.user_public_id,
    }),
    vehicleLabel: String(serviceRequest?.vehicleLabel || row.masked_plate || "").trim() || null,
    customerPublicId: String(row.user_public_id || "").trim() || null,
    fuelType: String(row.fuel_code || "").trim().toUpperCase() || null,
    requestedLitres,
    amountMwk: transaction?.amountMwk ?? toNumberOrNull(workflow?.lastManualEntry?.amountMwk),
    paymentStatus,
    servicePaymentMode,
    queueStatus: baseStatus,
    reservationTimer:
      orderType === ATTENDANT_ORDER_TYPES.QUEUE
        ? toIsoOrNull(row.grace_expires_at)
        : toIsoOrNull(row.slot_end),
    selectedPump: pumpAssignment?.pumpPublicId
      ? {
          pumpPublicId: pumpAssignment.pumpPublicId,
          pumpNumber: pumpAssignment.pumpNumber,
          nozzlePublicId: pumpAssignment.nozzlePublicId,
          nozzleNumber: pumpAssignment.nozzleNumber,
          fuelType: pumpAssignment.fuelType,
        }
      : null,
    telemetryStatus,
    attendantAssignment: workflow.assignedAttendantPublicId
      ? {
          userPublicId: workflow.assignedAttendantPublicId,
          name: workflow.assignedAttendantName,
          acceptedAt: workflow.acceptedAt,
        }
      : null,
    state: attendantState,
    workflow: workflowWithDerivedAssignment,
    transaction,
    availableActions: buildAvailableActions({
      state: attendantState,
      workflow: workflowWithDerivedAssignment,
      telemetryStatus,
    }),
    lastUpdatedAt:
      workflow.serviceCompletedAt
      || workflow.serviceStartedAt
      || workflow.customerArrivedAt
      || workflow.acceptedAt
      || toIsoOrNull(row.confirmed_at)
      || toIsoOrNull(row.called_at)
      || toIsoOrNull(row.joined_at)
      || toIsoOrNull(row.slot_start)
      || new Date().toISOString(),
    sourceQueueEntryPublicId: String(row.source_queue_entry_public_id || "").trim() || null,
  }
}

function buildSyntheticPumpSessions({ pumps, orders, activePumpSessions, telemetryIndex }) {
  const rows = []
  const activeSessionKeys = new Set()
  const orderedCandidates = Array.isArray(orders) ? [...orders] : []
  orderedCandidates.sort((left, right) => {
    const leftPriority = left?.state === ATTENDANT_ORDER_STATES.DISPENSING ? 0 : 1
    const rightPriority = right?.state === ATTENDANT_ORDER_STATES.DISPENSING ? 0 : 1
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return Date.parse(String(right?.lastUpdatedAt || 0)) - Date.parse(String(left?.lastUpdatedAt || 0))
  })

  for (const session of activePumpSessions || []) {
    const key = `${session.pump_public_id || ""}:${session.nozzle_public_id || ""}`
    activeSessionKeys.add(key)
    const telemetry = telemetryIndex.byNozzlePublicId.get(String(session.nozzle_public_id || "").trim()) || null
    const telemetryWithLitres =
      telemetryIndex.byNozzlePublicIdWithLitres.get(String(session.nozzle_public_id || "").trim())
      || null
    const currentLiveLitres = Math.max(
      toNumberOrNull(session.dispensed_litres) ?? 0,
      toNumberOrNull(telemetryWithLitres?.litresValue) ?? 0,
    )
    const matchedOrder = orderedCandidates.find((order) => {
      const selectedPump = order?.selectedPump
      if (!selectedPump?.pumpPublicId) return false
      if (![ATTENDANT_ORDER_STATES.PUMP_ASSIGNED, ATTENDANT_ORDER_STATES.DISPENSING].includes(order?.state)) {
        return false
      }
      return (
        selectedPump.pumpPublicId === (String(session.pump_public_id || "").trim() || null)
        && String(selectedPump.nozzlePublicId || "").trim() === (String(session.nozzle_public_id || "").trim() || "")
      )
    }) || null
    rows.push({
      id: `SESSION:${session.public_id}`,
      pumpSessionPublicId: String(session.public_id || "").trim() || null,
      pumpSessionReference: String(session.session_reference || "").trim() || null,
      pumpPublicId: String(session.pump_public_id || "").trim() || null,
      pumpNumber: Number(session.pump_number || 0) || null,
      nozzlePublicId: String(session.nozzle_public_id || "").trim() || null,
      nozzleNumber: String(session.nozzle_number || "").trim() || null,
      fuelType: String(session.fuel_code || "").trim().toUpperCase() || null,
      linkedOrder: matchedOrder
        ? {
            orderType: matchedOrder.orderType,
            orderPublicId: matchedOrder.orderPublicId,
            customerName: matchedOrder.customerName,
          }
        : null,
      status:
        String(session.session_status || "").trim().toUpperCase() === "DISPENSING" || currentLiveLitres > 0
          ? "dispensing"
          : "reserved",
      currentLiveLitres: currentLiveLitres > 0 ? currentLiveLitres : null,
      elapsedTimeStartedAt: toIsoOrNull(session.start_time),
      telemetryStatus: deriveTelemetryStatus({
        hasActivePumpSession: true,
        telemetryUpdatedAt: telemetry?.happenedAt || null,
      }),
    })
  }

  for (const order of orders || []) {
    const pumpAssignment = order?.selectedPump
    if (!pumpAssignment?.pumpPublicId) continue
    if (![ATTENDANT_ORDER_STATES.PUMP_ASSIGNED, ATTENDANT_ORDER_STATES.DISPENSING].includes(order.state)) {
      continue
    }

    const key = `${pumpAssignment.pumpPublicId}:${pumpAssignment.nozzlePublicId || ""}`
    if (activeSessionKeys.has(key)) continue

    const pump = (pumps || []).find((item) => item.public_id === pumpAssignment.pumpPublicId)
    const nozzle = (pump?.nozzles || []).find((item) => item.public_id === pumpAssignment.nozzlePublicId)
    const telemetry = telemetryIndex.byNozzlePublicId.get(String(pumpAssignment.nozzlePublicId || "").trim()) || null
    const telemetryWithLitres =
      telemetryIndex.byNozzlePublicIdWithLitres.get(String(pumpAssignment.nozzlePublicId || "").trim())
      || null

    rows.push({
      id: `${order.orderType}:${order.orderPublicId}`,
      pumpSessionPublicId: String(order.workflow?.pumpSession?.publicId || "").trim() || null,
      pumpSessionReference: String(order.workflow?.pumpSession?.sessionReference || "").trim() || null,
      pumpPublicId: pumpAssignment.pumpPublicId,
      pumpNumber: pumpAssignment.pumpNumber || Number(pump?.pump_number || 0) || null,
      nozzlePublicId: pumpAssignment.nozzlePublicId,
      nozzleNumber: pumpAssignment.nozzleNumber || String(nozzle?.nozzle_number || "").trim() || null,
      fuelType: pumpAssignment.fuelType || String(nozzle?.fuel_code || "").trim().toUpperCase() || null,
      linkedOrder: {
        orderType: order.orderType,
        orderPublicId: order.orderPublicId,
        customerName: order.customerName,
      },
      status: order.state === ATTENDANT_ORDER_STATES.DISPENSING ? "dispensing" : "reserved",
      currentLiveLitres: telemetryWithLitres?.litresValue ?? order.workflow?.lastManualEntry?.litres ?? null,
      elapsedTimeStartedAt:
        order.workflow?.serviceStartedAt
        || order.workflow?.pumpAssignment?.confirmedAt
        || order.workflow?.acceptedAt
        || null,
      telemetryStatus: order.telemetryStatus,
    })
  }

  rows.sort((left, right) => String(left.pumpPublicId || "").localeCompare(String(right.pumpPublicId || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  }))

  return rows
}

function buildExceptionList(orders = []) {
  const exceptions = []
  for (const order of orders) {
    for (const exception of order.workflow?.exceptions || []) {
      exceptions.push({
        id: `${order.orderType}:${order.orderPublicId}:${exception.id}`,
        orderType: order.orderType,
        orderPublicId: order.orderPublicId,
        customerName: order.customerName,
        reasonCode: exception.reasonCode,
        note: exception.note,
        evidenceUrl: exception.evidenceUrl,
        createdAt: exception.createdAt,
        status: exception.status,
        supportTicketId: exception.supportTicketId || null,
      })
    }
  }

  exceptions.sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
  return exceptions
}

async function buildAttendantDashboardSnapshot(station, auth) {
  const stationId = Number(station?.id || 0)
  const [
    queueRows,
    reservationRows,
    transactionsRows,
    pumps,
    activePumpSessions,
    telemetryRows,
    refundRows,
    refundEvidenceRows,
  ] = await Promise.all([
    listLiveQueueRows(stationId),
    listLiveReservationRows(stationId),
    listRecentTransactions(stationId),
    listStationPumpsWithNozzles(stationId, { includeInactive: true }),
    listActivePumpSessionRows(stationId),
    listRecentTelemetryRows(stationId),
    listRecentRefundRows(stationId),
    listRefundEvidenceRows(stationId),
  ])

  const transactionIndex = buildTransactionIndexes(transactionsRows)
  const telemetryIndex = buildTelemetryIndexes(telemetryRows)
  const activeSessionIndex = buildPumpSessionIndex(activePumpSessions)

  const liveOrders = [
    ...(queueRows || []).map((row) =>
      {
        const metadata = parseReservationMetadata(row.metadata)
        const assignment = resolveAssignmentFromMetadata(metadata, row.fuel_code)
        const nozzlePublicId = String(assignment?.nozzlePublicId || "").trim()
        return buildOrderPayload({
          orderType: ATTENDANT_ORDER_TYPES.QUEUE,
          row,
          transaction: transactionIndex.byQueueEntryId.get(Number(row.id)) || null,
          latestTelemetry:
            telemetryIndex.byNozzlePublicId.get(nozzlePublicId)
            || telemetryIndex.byPumpPublicId.get(String(assignment?.pumpPublicId || "").trim())
            || null,
          activePumpSession:
            activeSessionIndex.byNozzlePublicId.get(nozzlePublicId)
            || null,
        })
      }
    ),
    ...(reservationRows || []).map((row) =>
      {
        const metadata = parseReservationMetadata(row.metadata)
        const assignment = resolveAssignmentFromMetadata(metadata, row.fuel_code)
        const nozzlePublicId = String(assignment?.nozzlePublicId || "").trim()
        return buildOrderPayload({
          orderType: ATTENDANT_ORDER_TYPES.RESERVATION,
          row,
          transaction: transactionIndex.byReservationPublicId.get(String(row.public_id || "").trim()) || null,
          latestTelemetry:
            telemetryIndex.byNozzlePublicId.get(nozzlePublicId)
            || telemetryIndex.byPumpPublicId.get(String(assignment?.pumpPublicId || "").trim())
            || null,
          activePumpSession:
            activeSessionIndex.byNozzlePublicId.get(nozzlePublicId)
            || null,
        })
      }
    ),
  ]

  liveOrders.sort((left, right) => Date.parse(left.reservationTimer || left.lastUpdatedAt || 0) - Date.parse(right.reservationTimer || right.lastUpdatedAt || 0))

  const refundEvidenceMap = buildRefundEvidenceMap(refundEvidenceRows)
  const refundRequests = (refundRows || []).map((row) => {
    const evidence = refundEvidenceMap.get(String(row.public_id || "").trim()) || []
    const orderReferenceEvidence = evidence.find((item) => item.sourceType === "ORDER_REFERENCE") || null
    return {
      publicId: String(row.public_id || "").trim(),
      transactionPublicId: String(row.transaction_public_id || "").trim() || null,
      amountMwk: toNumberOrNull(row.amount_mwk),
      priority: String(row.priority || "").trim() || null,
      status: String(row.status || "").trim() || null,
      investigationStatus: String(row.investigation_status || "").trim() || null,
      reviewStage: String(row.review_stage || "").trim() || null,
      refundReasonCode: String(row.refund_reason_code || "").trim() || null,
      userStatement: String(row.user_statement || "").trim() || null,
      requestedByName: String(row.requested_by_name || "").trim() || null,
      requestedByCurrentAttendant: Number(row.requested_by_user_id || 0) === Number(auth?.userId || 0),
      requestedAt: toIsoOrNull(row.requested_at || row.created_at),
      evidence,
      orderReference: orderReferenceEvidence?.sourceId || null,
    }
  })

  return {
    station: {
      publicId: station.public_id,
      name: station.name,
      timezone: station.timezone,
    },
    generatedAt: new Date().toISOString(),
    summary: {
      liveOrders: liveOrders.length,
      exceptions: buildExceptionList(liveOrders).length,
      refundRequests: refundRequests.length,
      dispensing: liveOrders.filter((item) => item.state === ATTENDANT_ORDER_STATES.DISPENSING).length,
    },
    liveOrders,
    activePumpSessions: buildSyntheticPumpSessions({
      pumps,
      orders: liveOrders,
      activePumpSessions,
      telemetryIndex,
    }),
    exceptions: buildExceptionList(liveOrders),
    refundRequests,
    pumps: (pumps || []).map((pump) => ({
      pumpPublicId: pump.public_id,
      pumpNumber: pump.pump_number,
      status: String(pump.status || "").trim().toLowerCase(),
      reason: String(pump.status_reason || "").trim() || null,
      fuelTypes:
        Array.isArray(pump.fuel_codes) && pump.fuel_codes.length
          ? pump.fuel_codes
          : (String(pump.legacy_fuel_code || "").trim() ? [String(pump.legacy_fuel_code).trim()] : []),
      legacyFuelType: String(pump.legacy_fuel_code || "").trim() || null,
      nozzles: (pump.nozzles || []).map((nozzle) => ({
        nozzlePublicId: nozzle.public_id,
        nozzleNumber: nozzle.nozzle_number,
        fuelType: nozzle.fuel_code,
        status: nozzle.status,
      })),
    })),
  }
}

async function loadAttendantOrder(stationId, orderType, orderPublicId) {
  const normalizedType = normalizeAttendantOrderType(orderType)
  if (!normalizedType) throw badRequest("Unsupported order type")

  if (normalizedType === ATTENDANT_ORDER_TYPES.QUEUE) {
    const row = await findEntryOrThrow(stationId, orderPublicId)
    const userRows = await prisma.$queryRaw`
      SELECT public_id, full_name
      FROM users
      WHERE id = ${Number(row.user_id || 0) || -1}
      LIMIT 1
    `
    const transactionRows = await prisma.$queryRaw`
      SELECT
        id,
        public_id,
        queue_entry_id,
        reservation_public_id,
        litres,
        total_amount,
        payment_method,
        pump_id,
        nozzle_id,
        occurred_at
      FROM transactions
      WHERE station_id = ${stationId}
        AND queue_entry_id = ${row.id}
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    `
    return {
      orderType: normalizedType,
      row: {
        ...row,
        user_public_id: userRows?.[0]?.public_id || null,
        user_name: userRows?.[0]?.full_name || null,
      },
      transaction: buildTransactionIndexes(transactionRows).byQueueEntryId.get(Number(row.id)) || null,
    }
  }

  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT
        ur.*,
        ft.code AS fuel_code,
        u.public_id AS user_public_id,
        u.full_name AS user_name,
        qe.public_id AS source_queue_entry_public_id
      FROM user_reservations ur
      LEFT JOIN fuel_types ft ON ft.id = ur.fuel_type_id
      LEFT JOIN users u ON u.id = ur.user_id
      LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
      WHERE ur.station_id = ${stationId}
        AND ur.public_id = ${orderPublicId}
      LIMIT 1
    `
  } catch (error) {
    if (isReservationsTableMissingError(error)) {
      throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
    }
    throw error
  }

  const row = rows?.[0]
  if (!row?.id) throw notFound(`Reservation not found: ${orderPublicId}`)

  const transactionRows = await prisma.$queryRaw`
    SELECT
      id,
      public_id,
      queue_entry_id,
      reservation_public_id,
      litres,
      total_amount,
      payment_method,
      pump_id,
      nozzle_id,
      occurred_at
    FROM transactions
    WHERE station_id = ${stationId}
      AND reservation_public_id = ${orderPublicId}
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
  `

  return {
    orderType: normalizedType,
    row,
    transaction: buildTransactionIndexes(transactionRows).byReservationPublicId.get(orderPublicId) || null,
  }
}

async function persistOrderUpdate({
  db = prisma,
  orderType,
  row,
  metadata,
  status = null,
  extraValues = {},
}) {
  const metadataJson = JSON.stringify(metadata)
  if (orderType === ATTENDANT_ORDER_TYPES.QUEUE) {
    const nextStatus = status || row.status
    await db.$executeRaw`
      UPDATE queue_entries
      SET
        status = ${nextStatus},
        fuel_type_id = ${extraValues.fuelTypeId === undefined ? row.fuel_type_id : extraValues.fuelTypeId},
        metadata = ${metadataJson},
        called_at = ${extraValues.calledAt === undefined ? row.called_at : extraValues.calledAt},
        served_at = ${extraValues.servedAt === undefined ? row.served_at : extraValues.servedAt},
        cancelled_at = ${extraValues.cancelledAt === undefined ? row.cancelled_at : extraValues.cancelledAt},
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${row.id}
    `
    return
  }

  const nextStatus = status || row.status
  await db.$executeRaw`
    UPDATE user_reservations
    SET
      status = ${nextStatus},
      metadata = ${metadataJson},
      confirmed_at = ${extraValues.confirmedAt === undefined ? row.confirmed_at : extraValues.confirmedAt},
      fulfilled_at = ${extraValues.fulfilledAt === undefined ? row.fulfilled_at : extraValues.fulfilledAt},
      cancelled_at = ${extraValues.cancelledAt === undefined ? row.cancelled_at : extraValues.cancelledAt},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${row.id}
  `
}

async function appendRefundEvidence({
  refundPublicId,
  evidenceType,
  sourceType,
  sourceId = null,
  summary,
  metadata = null,
  attachedByUserId = null,
}) {
  const refundRows = await prisma.$queryRaw`
    SELECT id
    FROM refund_requests
    WHERE public_id = ${refundPublicId}
    LIMIT 1
  `
  const refundId = Number(refundRows?.[0]?.id || 0) || null
  if (!refundId) return

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
      ${String(sourceId || "").trim() || null},
      ${summary},
      NULL,
      ${attachedByUserId},
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `
}

async function createSupportTicketForException({ station, auth, orderType, orderPublicId, reasonCode, note, evidenceUrl }) {
  return optionalExecute(
    async () => {
      const supportTicketId = createPublicId()
      const category = reasonCode.includes("fuel") ? "Pump" : reasonCode.includes("telemetry") ? "Network" : "Queue"
      const severity = reasonCode === "safety_issue" ? "Critical" : "Medium"
      await prisma.$executeRaw`
        INSERT INTO support_tickets (
          id,
          station_id,
          user_id,
          category,
          severity,
          title,
          description,
          screenshot_url,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${supportTicketId},
          ${station.public_id},
          ${auth.userPublicId},
          ${category},
          ${severity},
          ${`Attendant issue ${orderPublicId}`},
          ${`Order ${orderType}:${orderPublicId}\nReason: ${reasonCode}\n\n${note}`},
          ${evidenceUrl || null},
          ${"OPEN"},
          CURRENT_TIMESTAMP(3),
          CURRENT_TIMESTAMP(3)
        )
      `
      return supportTicketId
    },
    "support_tickets"
  )
}

async function refreshDashboardForWrite(req, station) {
  const snapshot = await buildAttendantDashboardSnapshot(station, req.auth || {})
  return snapshot
}

router.get(
  "/stations/:stationPublicId/attendant/dashboard",
  attendantReadRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const snapshot = await buildAttendantDashboardSnapshot(station, req.auth || {})
    return ok(res, snapshot)
  })
)

router.get(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/audit",
  attendantReadRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const orderKeys = buildOrderMatchKeys(order.orderType, orderPublicId, {
      reservationPublicId: order.orderType === ATTENDANT_ORDER_TYPES.QUEUE ? order.row?.reservation_public_id : null,
      sourceQueueEntryPublicId: order.row?.source_queue_entry_public_id,
    })

    const rows = await prisma.$queryRaw`
      SELECT id, action_type, payload, created_at
      FROM audit_log
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC, id DESC
      LIMIT 200
    `

    const items = (rows || [])
      .map((row) => {
        const payload = parseJsonString(row.payload)
        const candidates = [
          payload.orderPublicId,
          payload.entryPublicId,
          payload.reservationPublicId,
          payload.sourceQueueEntryPublicId,
        ].map((value) => String(value || "").trim()).filter(Boolean)
        const matches = candidates.some((value) => orderKeys.has(value))
        if (!matches) return null
        return {
          id: `AUD-${row.id}`,
          actionType: String(row.action_type || "").trim(),
          createdAt: toIsoOrNull(row.created_at),
          payload,
        }
      })
      .filter(Boolean)

    return ok(res, { items })
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/update-service-request",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = updateServiceRequestBodySchema.parse(req.body || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const existingAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })

    if (![ATTENDANT_ORDER_STATES.PENDING, ATTENDANT_ORDER_STATES.ACCEPTED, ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED].includes(currentState)) {
      throw badRequest("Only active queue customers awaiting service can be edited from the kiosk.")
    }

    if (order.orderType !== ATTENDANT_ORDER_TYPES.QUEUE) {
      throw badRequest("Kiosk editing is only available for queue orders.")
    }

    const existingServiceRequest =
      rawMetadata?.serviceRequest && typeof rawMetadata.serviceRequest === "object"
        ? rawMetadata.serviceRequest
        : {}
    const pricingPreviewBase = deriveEditedQueueServiceRequestPricing({
      body,
      rawMetadata,
      rowFuelCode: order.row.fuel_code,
      stationPricesJson: station?.prices_json,
    })
    let promotionPricing = null
    if (pricingPreviewBase.effectivePaymentMode === "PREPAY" && pricingPreviewBase.requestedLitres !== null) {
      const promotionPreview = await getPromotionPricingPreview({
        stationPublicId: String(station.public_id || "").trim(),
        fuelTypeCode: pricingPreviewBase.normalizedFuelCode,
        litres: pricingPreviewBase.requestedLitres,
        paymentMethod: "SMARTPAY",
        userId: Number(order.row?.user_id || 0) || null,
        now: new Date(),
        cashbackDestination: "WALLET",
      })
      promotionPricing = promotionPreview?.pricing || {}
    }
    const pricingPreview = deriveEditedQueueServiceRequestPricing({
      body,
      rawMetadata,
      rowFuelCode: order.row.fuel_code,
      stationPricesJson: station?.prices_json,
      smartPayPricing: promotionPricing,
    })
    const normalizedFuelCode = pricingPreview.normalizedFuelCode
    const fuelTypeId = body.fuelType ? await resolveFuelTypeIdByCode(normalizedFuelCode) : undefined
    if (body.fuelType && !fuelTypeId) {
      throw badRequest(`Fuel type is not configured: ${body.fuelType}`)
    }

    const normalizedVehicleLabel = body.vehicleLabel !== undefined
      ? String(body.vehicleLabel || "").trim()
      : undefined
    const normalizedRequestedLitres = pricingPreview.requestedLitres
    const normalizedEstimatedAmountMwk = pricingPreview.estimatedAmountMwk
    const normalizedRequestedAmountMwk = pricingPreview.requestedAmountMwk
    const hasEditableRequestChange =
      body.fuelType !== undefined
      || body.requestedLitres !== undefined
      || body.amountMwk !== undefined
    const effectivePaymentMode = pricingPreview.effectivePaymentMode
    const existingHoldReference = String(existingServiceRequest.holdReference || "").trim() || null
    const existingPaymentReference = String(existingServiceRequest.walletTransactionReference || "").trim() || null
    const hasLinkedPrepay =
      Boolean(existingHoldReference)
      || Boolean(existingPaymentReference)
      || Boolean(String(existingServiceRequest.settlementBatchPublicId || "").trim())
    const shouldReplaceHeldPrepay =
      hasEditableRequestChange
      && effectivePaymentMode === "PREPAY"
      && Boolean(existingHoldReference)
      && pricingPreview.hasPaymentImpactChange
    const shouldReplaceCapturedPrepay =
      hasEditableRequestChange
      && effectivePaymentMode === "PREPAY"
      && !existingHoldReference
      && hasLinkedPrepay
      && pricingPreview.hasPaymentImpactChange

    if (hasEditableRequestChange && normalizedRequestedLitres === null) {
      throw badRequest("The updated request could not be priced because litres could not be resolved.")
    }
    if (hasEditableRequestChange && pricingPreview.basePricePerLitre === null) {
      throw badRequest(`Fuel price is unavailable for ${normalizedFuelCode || "the selected fuel type"} at this station.`)
    }
    if (effectivePaymentMode === "PREPAY" && hasEditableRequestChange && (!Number.isFinite(Number(normalizedEstimatedAmountMwk)) || Number(normalizedEstimatedAmountMwk) <= 0)) {
      throw badRequest("The updated SmartPay quote could not be calculated for this queue request.")
    }

    let paymentReplacement = null
    let holdReplacement = null
    await prisma.$transaction(async (tx) => {
      if (shouldReplaceHeldPrepay) {
        await releaseQueuePrepayWalletHold(
          {
            queueJoinId: orderPublicId,
            actorUserId: actor.actorUserId || Number(order.row?.user_id || 0) || null,
            reason: "QUEUE_PREPAY_EDITED",
          },
          { tx }
        )
        holdReplacement = await createQueuePrepayWalletHold(
          {
            userId: Number(order.row?.user_id || 0),
            queueJoinId: orderPublicId,
            amount: normalizedEstimatedAmountMwk,
            actorUserId: actor.actorUserId || Number(order.row?.user_id || 0) || null,
          },
          { tx }
        )
      } else if (shouldReplaceCapturedPrepay) {
        paymentReplacement = await replaceQueuePrepayWalletPayment({
          userId: Number(order.row?.user_id || 0),
          stationId: station.id,
          queueJoinId: orderPublicId,
          nextAmount: normalizedEstimatedAmountMwk,
          previousPaymentReference: existingPaymentReference,
          actorUserId: actor.actorUserId || Number(order.row?.user_id || 0) || null,
          description: `Queue prepay updated for ${orderPublicId}`,
          idempotencyKey: [
            "wallet:queue:prepay:edit",
            orderPublicId,
            existingPaymentReference || "initial",
            normalizedFuelCode || "unknown",
            normalizedRequestedLitres ?? "none",
            normalizedEstimatedAmountMwk ?? "none",
          ].join(":"),
          paymentMetadata: {
            queueJoinId: orderPublicId,
            stationPublicId: station.public_id,
            pumpPublicId: String(rawMetadata?.lastPumpScan?.pumpPublicId || existingServiceRequest?.pumpPublicId || "").trim() || null,
            fuelType: normalizedFuelCode,
            requestedLiters: normalizedRequestedLitres,
            requestedAmountMwk: normalizedRequestedAmountMwk,
            pricePerLitre: pricingPreview.displayPricePerLitre,
            basePricePerLitre: pricingPreview.basePricePerLitre,
            estimatedAmount: normalizedEstimatedAmountMwk,
            subtotal: pricingPreview.smartPayQuote?.subtotal ?? pricingPreview.quotedBaseAmountMwk,
            totalDirectDiscount: pricingPreview.smartPayQuote?.totalDirectDiscount ?? 0,
            cashbackTotal: pricingPreview.smartPayQuote?.cashbackTotal ?? 0,
            promoLabelsApplied: pricingPreview.smartPayQuote?.promoLabelsApplied ?? [],
            source: "ATTENDANT_QUEUE_SERVICE_REQUEST_UPDATE",
          },
          settlementMetadata: {
            queueJoinId: orderPublicId,
            stationPublicId: station.public_id,
            pumpPublicId: String(rawMetadata?.lastPumpScan?.pumpPublicId || existingServiceRequest?.pumpPublicId || "").trim() || null,
            fuelType: normalizedFuelCode,
            requestedLiters: normalizedRequestedLitres,
            requestedAmountMwk: normalizedRequestedAmountMwk,
            pricePerLitre: pricingPreview.displayPricePerLitre,
            basePricePerLitre: pricingPreview.basePricePerLitre,
            estimatedAmount: normalizedEstimatedAmountMwk,
            subtotal: pricingPreview.smartPayQuote?.subtotal ?? pricingPreview.quotedBaseAmountMwk,
            totalDirectDiscount: pricingPreview.smartPayQuote?.totalDirectDiscount ?? 0,
            cashbackTotal: pricingPreview.smartPayQuote?.cashbackTotal ?? 0,
            promoLabelsApplied: pricingPreview.smartPayQuote?.promoLabelsApplied ?? [],
          },
        }, { tx })
      }

      const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow, nextMetadata) => {
        const currentServiceRequest =
          nextMetadata.serviceRequest && typeof nextMetadata.serviceRequest === "object"
            ? nextMetadata.serviceRequest
            : {}

        const nextServiceRequest = {
          ...currentServiceRequest,
          ...(body.fuelType !== undefined ? { fuelType: normalizedFuelCode } : {}),
          ...(normalizedRequestedLitres !== null
            ? {
                requestedLitres: normalizedRequestedLitres,
                requestedLiters: normalizedRequestedLitres,
                litres: normalizedRequestedLitres,
                liters: normalizedRequestedLitres,
              }
            : {}),
          ...(normalizedRequestedAmountMwk !== null
            ? {
                requestedAmountMwk: normalizedRequestedAmountMwk,
              }
            : {}),
          ...(normalizedEstimatedAmountMwk !== null
            ? {
                amountMwk: normalizedEstimatedAmountMwk,
                estimatedAmount: normalizedEstimatedAmountMwk,
              }
            : {}),
          ...(pricingPreview.displayPricePerLitre !== null
            ? {
                pricePerLitre: pricingPreview.displayPricePerLitre,
                basePricePerLitre: pricingPreview.basePricePerLitre,
                currencyCode: String(currentServiceRequest.currencyCode || "MWK").trim() || "MWK",
              }
            : {}),
          ...(pricingPreview.smartPayQuote
            ? {
                subtotal: pricingPreview.smartPayQuote.subtotal,
                totalDirectDiscount: pricingPreview.smartPayQuote.totalDirectDiscount,
                cashbackTotal: pricingPreview.smartPayQuote.cashbackTotal,
                effectiveNetCost: pricingPreview.smartPayQuote.effectiveNetCost,
                promoLabelsApplied: pricingPreview.smartPayQuote.promoLabelsApplied,
              }
            : {}),
          ...(normalizedVehicleLabel !== undefined ? { vehicleLabel: normalizedVehicleLabel || null } : {}),
        }

        if (holdReplacement?.hold?.reference) {
          nextServiceRequest.paymentStatus = "HELD"
          nextServiceRequest.holdReference = holdReplacement.hold.reference
          nextServiceRequest.walletTransactionReference = null
          nextServiceRequest.settlementBatchPublicId = null
          nextServiceRequest.walletAvailableBalanceAfterPayment = holdReplacement.walletAfterHold?.availableBalance ?? null
          nextServiceRequest.needsPaymentRecheck = false
          nextServiceRequest.paymentAdjustedAt = new Date().toISOString()
        } else if (paymentReplacement?.replacement?.transaction?.reference) {
          nextServiceRequest.paymentStatus = paymentReplacement.replacement.transaction.status || "POSTED"
          nextServiceRequest.holdReference = null
          nextServiceRequest.walletTransactionReference = paymentReplacement.replacement.transaction.reference
          nextServiceRequest.settlementBatchPublicId = paymentReplacement.replacement.settlement?.publicId || null
          nextServiceRequest.walletAvailableBalanceAfterPayment = paymentReplacement.replacement.walletAfterPayment?.availableBalance ?? null
          nextServiceRequest.needsPaymentRecheck = false
          nextServiceRequest.paymentAdjustedAt = new Date().toISOString()
        } else if (hasEditableRequestChange && hasLinkedPrepay && pricingPreview.hasPaymentImpactChange) {
          nextServiceRequest.needsPaymentRecheck = true
          nextServiceRequest.paymentStatus = "REQUIRES_REVIEW"
        }

        nextMetadata.serviceRequest = nextServiceRequest

        if (normalizedRequestedLitres !== null) {
          nextMetadata.requestedLitres = normalizedRequestedLitres
          nextMetadata.requestedLiters = normalizedRequestedLitres
          nextMetadata.requested_litres = normalizedRequestedLitres
          delete nextMetadata.amountMwk
        }

        if (normalizedEstimatedAmountMwk !== null) {
          nextMetadata.amountMwk = normalizedEstimatedAmountMwk
        } else if (body.amountMwk !== undefined) {
          delete nextMetadata.requestedLitres
          delete nextMetadata.requestedLiters
          delete nextMetadata.requested_litres
        }

        if (body.fuelType !== undefined) {
          if (workflow.pumpAssignment?.fuelType && workflow.pumpAssignment.fuelType !== normalizedFuelCode) {
            workflow.pumpAssignment = null
          }
          if (nextMetadata.lastPumpScan?.fuelType && String(nextMetadata.lastPumpScan.fuelType).trim().toUpperCase() !== normalizedFuelCode) {
            delete nextMetadata.lastPumpScan
          }
          delete nextMetadata.serviceRequest.pumpPublicId
          delete nextMetadata.serviceRequest.nozzlePublicId
        }

        maybeUpdateLastManualEntry(workflow, actor, {
          litres: body.requestedLitres,
          amount: body.amountMwk,
        })
      })

      await persistOrderUpdate({
        db: tx,
        orderType: order.orderType,
        row: order.row,
        metadata,
        extraValues: {
          fuelTypeId,
        },
      })
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_SERVICE_REQUEST_UPDATE",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        fuelType: body.fuelType || null,
        requestedLitres: normalizedRequestedLitres ?? null,
        amountMwk: normalizedEstimatedAmountMwk ?? null,
        requestedAmountMwk: normalizedRequestedAmountMwk ?? null,
        walletTransactionReference: paymentReplacement?.replacement?.transaction?.reference || null,
        settlementBatchPublicId: paymentReplacement?.replacement?.settlement?.publicId || null,
        vehicleLabel: normalizedVehicleLabel ?? null,
      },
    })

    await notifyUserOfQueueServiceRequestUpdate({
      userId: order.row?.user_id,
      station,
      queueJoinId: orderPublicId,
      fuelType: normalizedFuelCode,
      requestedLitres: normalizedRequestedLitres ?? null,
      amountMwk: normalizedEstimatedAmountMwk ?? null,
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/accept",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const existingAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)
    const existingPumpSession = resolveStoredPumpSessionIdentity(rawMetadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.ACCEPTED)

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow) => {
      workflow.state = nextState
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
      workflow.acceptedAt = new Date().toISOString()
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_ORDER_ACCEPT",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        attendantUserPublicId: actor.actorPublicId,
        attendantName: actor.actorName,
      },
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/reject",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = rejectBodySchema.parse(req.body || {})
    const normalizedReasonCode = normalizeRejectionReasonCode(body.reasonCode)
    if (!normalizedReasonCode || !ATTENDANT_REJECTION_REASON_CODES.includes(normalizedReasonCode)) {
      throw badRequest("Invalid rejection reason code")
    }

    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const existingAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.REJECTED)

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow) => {
      workflow.state = nextState
      workflow.rejection = {
        reasonCode: normalizedReasonCode,
        note: String(body.note || "").trim() || null,
        rejectedAt: new Date().toISOString(),
      }
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
    })

    const nextStatus = deriveRejectStatus(order.orderType, normalizedReasonCode)
    await prisma.$transaction(async (tx) => {
      await persistOrderUpdate({
        db: tx,
        orderType: order.orderType,
        row: order.row,
        metadata,
        status: nextStatus,
        extraValues: {
          cancelledAt: new Date(),
        },
      })

      if (order.orderType === ATTENDANT_ORDER_TYPES.QUEUE && ["CANCELLED", "NO_SHOW"].includes(String(nextStatus || "").trim().toUpperCase())) {
        await releaseQueuePrepayWalletHold(
          {
            queueJoinId: orderPublicId,
            actorUserId: actor.actorUserId || Number(order.row?.user_id || 0) || null,
            reason: "ATTENDANT_REJECTED_QUEUE_ORDER",
          },
          { tx }
        )
      }
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_ORDER_REJECT",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        reasonCode: normalizedReasonCode,
        note: String(body.note || "").trim() || null,
        rejectedStatus: nextStatus,
      },
    })

    await clearHybridOrderFlow({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      nextState: "CANCELLED",
      actorStaffId: actor.actorStaffId,
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/customer-arrived",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    customerArrivedBodySchema.parse(req.body || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED)

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow) => {
      workflow.state = nextState
      workflow.customerArrivedAt = new Date().toISOString()
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
      status: order.orderType === ATTENDANT_ORDER_TYPES.RESERVATION ? "CHECKED_IN" : order.row.status,
      extraValues: {
        confirmedAt: order.orderType === ATTENDANT_ORDER_TYPES.RESERVATION ? new Date() : undefined,
      },
    })

    await markHybridOrderReadyOnSite({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      signalType: "ATTENDANT_KIOSK",
      actorStaffId: actor.actorStaffId,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_CUSTOMER_ARRIVED",
      payload: {
        orderType: order.orderType,
        orderPublicId,
      },
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/assign-pump",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = assignPumpBodySchema.parse(req.body || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.PUMP_ASSIGNED)

    const fuelType = String(order.row.fuel_code || "").trim().toUpperCase()
    if (!fuelType) throw badRequest("Order fuel type is missing")

    const pumps = await listStationPumpsWithNozzles(station.id, { includeInactive: false })
    const pump = (pumps || []).find((item) => item.public_id === body.pumpPublicId)
    if (!pump) throw notFound(`Pump not found: ${body.pumpPublicId}`)

    const hybridAssignmentCheck = await validateHybridPilotPumpAssignment({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      pumpPublicId: pump.public_id,
    })
    if (!hybridAssignmentCheck.allowed) {
      throw badRequest(
        hybridAssignmentCheck.redirectMessage
          || "Pilot pump is reserved for the next ready SmartLink user."
      )
    }

    const allActiveRows = [
      ...(await listLiveQueueRows(station.id)),
      ...(await listLiveReservationRows(station.id)),
    ]
    const blockedNozzlePublicIds = collectAssignedNozzlePublicIds(allActiveRows, {
      pumpPublicId: pump.public_id,
      excludeQueueJoinId: orderPublicId,
    })
    const nozzle = resolveAssignableNozzle(pump.nozzles || [], fuelType, {
      preferredNozzlePublicId: body.nozzlePublicId || "",
      blockedNozzlePublicIds,
    })
    if (!nozzle?.public_id) {
      throw badRequest("No free active nozzle is available on that pump for this fuel type.")
    }

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow, nextMetadata) => {
      workflow.state = nextState
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
      workflow.pumpAssignment = {
        pumpPublicId: pump.public_id,
        pumpNumber: Number(pump.pump_number || 0) || null,
        nozzlePublicId: nozzle.public_id,
        nozzleNumber: String(nozzle.nozzle_number || "").trim() || null,
        fuelType,
        confirmedAt: new Date().toISOString(),
      }
      nextMetadata.lastPumpScan = {
        pumpPublicId: pump.public_id,
        pumpNumber: Number(pump.pump_number || 0) || null,
        pumpStatus: pump.status,
        nozzlePublicId: nozzle.public_id,
        nozzleNumber: String(nozzle.nozzle_number || "").trim() || null,
        nozzleStatus: nozzle.status,
        fuelType,
        scannedAt: new Date().toISOString(),
        source: "ATTENDANT_ASSIGNMENT",
      }
      nextMetadata.serviceRequest = {
        ...(nextMetadata.serviceRequest && typeof nextMetadata.serviceRequest === "object"
          ? nextMetadata.serviceRequest
          : {}),
        pumpPublicId: pump.public_id,
        nozzlePublicId: nozzle.public_id,
        fuelType,
      }
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
    })

    await commitHybridOrderToLane({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      pumpPublicId: pump.public_id,
      actorStaffId: actor.actorStaffId,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_PUMP_ASSIGN",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        pumpPublicId: pump.public_id,
        nozzlePublicId: nozzle.public_id,
        note: String(body.note || "").trim() || null,
      },
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/start-service",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = startServiceBodySchema.parse(req.body || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const existingAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)
    const existingPumpSession = resolveStoredPumpSessionIdentity(rawMetadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.DISPENSING)
    if (!existingAssignment?.pumpPublicId || !existingAssignment?.nozzlePublicId) {
      throw badRequest("Assign a pump and nozzle before starting service.")
    }

    const serviceStartedAt = new Date()
    const pumpSessionBinding = await ensurePumpSessionBinding({
      stationId: station.id,
      pumpPublicId: existingAssignment.pumpPublicId,
      nozzlePublicId: existingAssignment.nozzlePublicId,
      sessionPublicId: existingPumpSession.pumpSessionPublicId,
      sessionReference: existingPumpSession.sessionReference,
      telemetryCorrelationId: existingPumpSession.telemetryCorrelationId,
      startedAt: serviceStartedAt,
    })

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow, nextMetadata) => {
      if (!workflow.pumpAssignment?.pumpPublicId) {
        workflow.pumpAssignment = existingAssignment
      }
      workflow.state = nextState
      workflow.serviceStartedAt = serviceStartedAt.toISOString()
      workflow.pumpSession = {
        publicId: pumpSessionBinding.pumpSessionPublicId,
        sessionReference: pumpSessionBinding.sessionReference,
        telemetryCorrelationId: pumpSessionBinding.telemetryCorrelationId,
        boundAt: workflow.serviceStartedAt,
      }
      if (
        order.orderType === ATTENDANT_ORDER_TYPES.QUEUE
        && rawMetadata?.serviceRequest
        && typeof rawMetadata.serviceRequest === "object"
      ) {
        rawMetadata.serviceRequest.dispensingStartedAt = workflow.serviceStartedAt
      }
      nextMetadata.serviceRequest = {
        ...(nextMetadata.serviceRequest && typeof nextMetadata.serviceRequest === "object"
          ? nextMetadata.serviceRequest
          : {}),
        pumpPublicId: existingAssignment.pumpPublicId,
        nozzlePublicId: existingAssignment.nozzlePublicId,
        fuelType: existingAssignment.fuelType,
        dispensingStartedAt: workflow.serviceStartedAt,
        pumpSessionPublicId: pumpSessionBinding.pumpSessionPublicId,
        sessionReference: pumpSessionBinding.sessionReference,
        telemetryCorrelationId: pumpSessionBinding.telemetryCorrelationId,
      }
      nextMetadata.lastPumpScan = {
        ...(nextMetadata.lastPumpScan && typeof nextMetadata.lastPumpScan === "object"
          ? nextMetadata.lastPumpScan
          : {}),
        pumpPublicId: existingAssignment.pumpPublicId,
        pumpNumber: existingAssignment.pumpNumber,
        pumpStatus: "DISPENSING",
        nozzlePublicId: existingAssignment.nozzlePublicId,
        nozzleNumber: existingAssignment.nozzleNumber,
        nozzleStatus: "DISPENSING",
        fuelType: existingAssignment.fuelType,
        scannedAt:
          String(nextMetadata?.lastPumpScan?.scannedAt || "").trim()
          || String(existingAssignment.confirmedAt || "").trim()
          || workflow.serviceStartedAt,
      }
      workflow.manualMode = body.manualMode === true
      workflow.manualReason = workflow.manualMode
        ? String(body.manualReason || "").trim() || "manual_mode_started_by_attendant"
        : null
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
    })

    await prisma.$executeRaw`
      UPDATE pump_nozzles
      SET status = CASE
        WHEN public_id = ${existingAssignment.nozzlePublicId} THEN 'DISPENSING'
        WHEN pump_id = (
          SELECT id
          FROM pumps
          WHERE station_id = ${station.id}
            AND public_id = ${existingAssignment.pumpPublicId}
          LIMIT 1
        ) AND status = 'DISPENSING' THEN 'ACTIVE'
        ELSE status
      END
      WHERE station_id = ${station.id}
        AND (
          public_id = ${existingAssignment.nozzlePublicId}
          OR pump_id = (
            SELECT id
            FROM pumps
            WHERE station_id = ${station.id}
              AND public_id = ${existingAssignment.pumpPublicId}
            LIMIT 1
          )
        )
        AND is_active = 1
    `

    await markHybridOrderFueling({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      pumpPublicId: existingAssignment.pumpPublicId,
      actorStaffId: actor.actorStaffId,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_SERVICE_START",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        manualMode: body.manualMode === true,
        manualReason: String(body.manualReason || "").trim() || null,
      },
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/complete-service",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = completeServiceBodySchema.parse(req.body || {})
    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const existingAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.COMPLETED)

    let forecourtTransaction = null
    let settlementCapture = null
    const completionTime = new Date()
    const storedPumpSession = resolveStoredPumpSessionIdentity(rawMetadata)
    let completedDispensedLitres = body.litres ?? null

    if (order.orderType === ATTENDANT_ORDER_TYPES.RESERVATION) {
      await prisma.$transaction(
        async (tx) => {
          const reservation = await findReservationForSettlement(tx, station.id, orderPublicId)
          const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow) => {
            workflow.state = ATTENDANT_ORDER_STATES.COMPLETED
            workflow.serviceCompletedAt = completionTime.toISOString()
            maybeUpdateLastManualEntry(workflow, actor, body)
          })
          const finalized = await finalizeReservationSettlement(tx, {
            station,
            reservation,
            actorUserId: actor.actorUserId,
            litres: body.litres,
            amount: body.amount,
            paymentMethod: body.paymentMethod || null,
            description: `Reservation completed by attendant at ${station.name}.`,
          })
          settlementCapture = finalized.settlementCapture
          forecourtTransaction = finalized.forecourtTransaction
          completedDispensedLitres = forecourtTransaction?.litres ?? body.litres ?? completedDispensedLitres

          const nextMetadata = {
            ...metadata,
            walletSettlement: finalized.metadata?.walletSettlement || metadata.walletSettlement,
            serviceTransaction: finalized.metadata?.serviceTransaction || metadata.serviceTransaction,
          }
          applyCompletedPumpState({
            nextMetadata,
            assignment: existingAssignment,
            completionTime,
            completedDispensedLitres,
          })

          await tx.$executeRaw`
            UPDATE user_reservations
            SET
              status = 'FULFILLED',
              fulfilled_at = ${completionTime},
              updated_at = CURRENT_TIMESTAMP(3),
              metadata = ${JSON.stringify(nextMetadata)}
            WHERE id = ${order.row.id}
          `
        },
        {
          maxWait: ATTENDANT_SETTLEMENT_TRANSACTION_MAX_WAIT_MS,
          timeout: ATTENDANT_SETTLEMENT_TRANSACTION_TIMEOUT_MS,
        }
      )
    } else {
      let queueCompletionMetadata = null
      const queuePaymentMethod = resolveQueueSettlementPaymentMethod({
        paymentMethod: body.paymentMethod || null,
        queueEntry: order.row,
      })
      const resolvedQueueLitres = await resolveQueueServiceLitres(prisma, {
        stationId: station.id,
        queueEntry: order.row,
        fallbackLitres: body.litres,
        occurredAt: completionTime,
      })
      completedDispensedLitres = resolvedQueueLitres ?? body.litres ?? completedDispensedLitres
      const shouldCreate = shouldCreateQueueServiceTransaction({
        queueEntry: order.row,
        litres: resolvedQueueLitres,
        amount: body.amount,
        paymentMethod: queuePaymentMethod,
      })
      if (shouldCreate) {
        forecourtTransaction = await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`
              UPDATE queue_entries
              SET
                status = 'SERVED',
                served_at = ${completionTime},
                last_moved_at = CURRENT_TIMESTAMP(3)
              WHERE id = ${order.row.id}
            `

            const finalizedSettlement = await finalizeQueueWalletSettlement(tx, {
              station,
              queueEntry: order.row,
              actorUserId: actor.actorUserId,
              litres: resolvedQueueLitres,
              description: `Queue order ${orderPublicId} completed by attendant at ${station.name}.`,
            })
            settlementCapture = finalizedSettlement.settlementCapture
            const queuePaymentReference =
              finalizedSettlement.settlementCapture?.transaction?.reference
              || await resolveQueueServicePaymentReference(tx, order.row)

            const createdTransaction = await createQueueServiceTransaction(tx, {
              stationId: station.id,
              queueEntry: order.row,
              actorUserId: actor.actorUserId,
              litres: resolvedQueueLitres,
              amount: body.amount,
              paymentMethod: queuePaymentMethod,
              paymentReference: queuePaymentReference,
              note: `Queue order ${orderPublicId} completed by attendant at ${station.name}.`,
              occurredAt: completionTime,
            })

            const nextMetadata = {
              ...(finalizedSettlement.metadata || parseReservationMetadata(order.row.metadata)),
              ...(createdTransaction?.publicId
                ? {
                    serviceTransaction: {
                      publicId: createdTransaction.publicId,
                      litres: createdTransaction.litres,
                      amount: createdTransaction.amount,
                      paymentMethod: createdTransaction.paymentMethod,
                      paymentReference: createdTransaction.paymentReference || queuePaymentReference || null,
                      pumpPublicId: createdTransaction.pumpPublicId || null,
                      nozzlePublicId: createdTransaction.nozzlePublicId || null,
                      recordedAt: createdTransaction.occurredAt,
                    },
                  }
                : {}),
            }
            queueCompletionMetadata = nextMetadata

            return createdTransaction
          },
          {
            maxWait: ATTENDANT_SETTLEMENT_TRANSACTION_MAX_WAIT_MS,
            timeout: ATTENDANT_SETTLEMENT_TRANSACTION_TIMEOUT_MS,
          }
        )
        completedDispensedLitres = forecourtTransaction?.litres ?? resolvedQueueLitres ?? completedDispensedLitres
      } else {
        await prisma.$executeRaw`
          UPDATE queue_entries
          SET
            status = 'SERVED',
            served_at = ${completionTime},
            last_moved_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${order.row.id}
        `
      }

      const { metadata } = updateMetadataWorkflow(queueCompletionMetadata || rawMetadata, (workflow) => {
        workflow.state = ATTENDANT_ORDER_STATES.COMPLETED
        workflow.serviceCompletedAt = completionTime.toISOString()
        maybeUpdateLastManualEntry(workflow, actor, body)
        if (forecourtTransaction?.publicId) {
          workflow.manualMode = workflow.manualMode === true
        }
      })

      const nextMetadata = {
        ...metadata,
        ...(forecourtTransaction?.publicId
          ? {
              serviceTransaction: {
                publicId: forecourtTransaction.publicId,
                litres: forecourtTransaction.litres,
                amount: forecourtTransaction.amount,
                paymentMethod: forecourtTransaction.paymentMethod,
                paymentReference: forecourtTransaction.paymentReference || null,
                pumpPublicId: forecourtTransaction.pumpPublicId || null,
                nozzlePublicId: forecourtTransaction.nozzlePublicId || null,
                recordedAt: forecourtTransaction.occurredAt,
              },
            }
          : {}),
      }
      applyCompletedPumpState({
        nextMetadata,
        assignment: existingAssignment,
        completionTime,
        completedDispensedLitres,
      })

      await prisma.$executeRaw`
        UPDATE queue_entries
        SET metadata = ${JSON.stringify(nextMetadata)}
        WHERE id = ${order.row.id}
      `
    }

    if (existingAssignment?.pumpPublicId || existingAssignment?.nozzlePublicId) {
      await prisma.$executeRaw`
        UPDATE pump_nozzles
        SET status = CASE
          WHEN public_id = ${existingAssignment.nozzlePublicId} THEN 'ACTIVE'
          WHEN pump_id = (
            SELECT id
            FROM pumps
            WHERE station_id = ${station.id}
              AND public_id = ${existingAssignment.pumpPublicId}
            LIMIT 1
          ) AND status = 'DISPENSING' THEN 'ACTIVE'
          ELSE status
        END
        WHERE station_id = ${station.id}
          AND (
            public_id = ${existingAssignment.nozzlePublicId}
            OR pump_id = (
              SELECT id
              FROM pumps
              WHERE station_id = ${station.id}
                AND public_id = ${existingAssignment.pumpPublicId}
              LIMIT 1
            )
          )
          AND is_active = 1
      `
    }

    await completePumpSessionBinding({
      stationId: station.id,
      sessionPublicId: storedPumpSession.pumpSessionPublicId,
      sessionReference: storedPumpSession.sessionReference,
      telemetryCorrelationId: storedPumpSession.telemetryCorrelationId,
      dispensedLitres: completedDispensedLitres,
      endedAt: completionTime,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_SERVICE_COMPLETE",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        litres: body.litres ?? null,
        amount: body.amount ?? null,
        paymentMethod: body.paymentMethod || null,
        note: String(body.note || "").trim() || null,
        settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
        forecourtTransactionPublicId: forecourtTransaction?.publicId || null,
      },
    })

    await notifyUserOfCashbackAward({
      userId: Number(order.row.user_id || 0) || null,
      station,
      transaction: forecourtTransaction || null,
      pricing: forecourtTransaction?.pricing || null,
      reservationPublicId:
        order.orderType === ATTENDANT_ORDER_TYPES.RESERVATION
          ? orderPublicId
          : null,
    })

    await completeHybridOrderFlow({
      stationId: station.id,
      orderType: order.orderType,
      orderPublicId,
      actorStaffId: actor.actorStaffId,
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/issues",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = issueBodySchema.parse(req.body || {})
    const normalizedReasonCode = normalizeExceptionReasonCode(body.reasonCode)
    if (!normalizedReasonCode || !ATTENDANT_EXCEPTION_REASON_CODES.includes(normalizedReasonCode)) {
      throw badRequest("Invalid exception reason code")
    }

    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW)

    const supportTicketId = await createSupportTicketForException({
      station,
      auth: req.auth || {},
      orderType: order.orderType,
      orderPublicId,
      reasonCode: normalizedReasonCode,
      note: body.note,
      evidenceUrl: body.evidenceUrl,
    })

    const { metadata } = updateMetadataWorkflow(rawMetadata, (workflow) => {
      workflow.state = nextState
      workflow.exceptions.unshift({
        id: createPublicId(),
        reasonCode: normalizedReasonCode,
        note: body.note,
        evidenceUrl: String(body.evidenceUrl || "").trim() || null,
        createdAt: new Date().toISOString(),
        status: "open",
        supportTicketId,
      })
      workflow.assignedAttendantUserId = actor.actorUserId
      workflow.assignedAttendantPublicId = actor.actorPublicId
      workflow.assignedAttendantName = actor.actorName
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_ISSUE_CREATE",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        reasonCode: normalizedReasonCode,
        note: body.note,
        evidenceUrl: String(body.evidenceUrl || "").trim() || null,
        supportTicketId,
      },
    })

    return ok(res, await refreshDashboardForWrite(req, station))
  })
)

router.post(
  "/stations/:stationPublicId/attendant/orders/:orderType/:orderPublicId/refund-requests",
  attendantWriteRole,
  asyncHandler(async (req, res) => {
    await ensureRefundWorkflowStorageReady()

    const station = await resolveStationContext(req.params.stationPublicId)
    const { orderType, orderPublicId } = orderParamsSchema.parse(req.params || {})
    const body = refundBodySchema.parse(req.body || {})
    const normalizedReasonCode = normalizeRefundReasonCode(body.reasonCode)
    if (!normalizedReasonCode || !ATTENDANT_REFUND_REASON_CODES.includes(normalizedReasonCode)) {
      throw badRequest("Invalid refund reason code")
    }

    const actor = await resolveActorContext(station.id, req.auth?.userId, req.auth?.userPublicId)
    const order = await loadAttendantOrder(station.id, orderType, orderPublicId)
    const rawMetadata = parseReservationMetadata(order.row.metadata)
    const currentState = deriveAttendantOrderState({
      orderType: order.orderType,
      baseStatus: order.row.status,
      metadata: rawMetadata,
      refundStatus: normalizeAttendantWorkflow(rawMetadata).refundRequest?.status || "",
    })
    const nextState = assertAttendantTransition(currentState, ATTENDANT_ORDER_STATES.REFUND_REQUESTED)
    const workflow = normalizeAttendantWorkflow(rawMetadata)
    const effectiveAssignment = resolveAssignmentFromMetadata(rawMetadata, order.row.fuel_code)

    const nozzlePublicId = String(effectiveAssignment?.nozzlePublicId || "").trim()
    const telemetryRows = nozzlePublicId
      ? await optionalRows(prisma.$queryRaw`
          SELECT
            ptl.event_type,
            ptl.severity,
            ptl.litres_value,
            ptl.message,
            ptl.happened_at
          FROM pump_telemetry_logs ptl
          LEFT JOIN pump_nozzles pn ON pn.id = ptl.nozzle_id
          WHERE ptl.station_id = ${station.id}
            AND pn.public_id = ${nozzlePublicId}
          ORDER BY ptl.happened_at DESC, ptl.id DESC
          LIMIT 25
        `, "pump_telemetry_logs")
      : []

    const pumpRows = effectiveAssignment?.pumpPublicId
      ? await listStationPumpsWithNozzles(station.id, { includeInactive: true })
      : []
    const pump = (pumpRows || []).find((item) => item.public_id === effectiveAssignment?.pumpPublicId)
    const nozzle = (pump?.nozzles || []).find((item) => item.public_id === effectiveAssignment?.nozzlePublicId)

    const telemetryStatus = deriveTelemetryStatus({
      pumpStatus: pump?.status || rawMetadata?.lastPumpScan?.pumpStatus || "",
      nozzleStatus: nozzle?.status || rawMetadata?.lastPumpScan?.nozzleStatus || "",
      hasActivePumpSession: false,
      manualMode: workflow.manualMode,
      telemetryUpdatedAt: toIsoOrNull(telemetryRows?.[0]?.happened_at),
    })

    const requestedLitres =
      order.orderType === ATTENDANT_ORDER_TYPES.RESERVATION
        ? toNumberOrNull(order.row.requested_litres)
        : extractRequestedLiters(rawMetadata)
    const dispensedLitres =
      toNumberOrNull(body.manualLitres)
      ?? toNumberOrNull(order.transaction?.litres)
      ?? toNumberOrNull(workflow.lastManualEntry?.litres)
      ?? toNumberOrNull(telemetryRows?.find((item) => toNumberOrNull(item.litres_value) !== null)?.litres_value)
      ?? 0

    const telemetryDispenseEventCount = (telemetryRows || []).filter((item) => {
      const eventType = String(item.event_type || "").trim().toUpperCase()
      return eventType.includes("DISPENSE") || toNumberOrNull(item.litres_value) > 0
    }).length
    const telemetryErrorCount = (telemetryRows || []).filter((item) => {
      const eventType = String(item.event_type || "").trim().toUpperCase()
      return ["ERROR", "TIMEOUT", "TELEMETRY_MISSING"].includes(eventType)
    }).length
    const telemetryMissing = telemetryStatus === "offline" || telemetryStatus === "delayed"
    const conflictingTelemetry = workflow.manualMode && telemetryDispenseEventCount > 0

    const refundAssessment = assessAttendantRefundRequest({
      telemetryStatus,
      paymentCaptured: Boolean(order.transaction?.publicId || rawMetadata?.walletSettlement?.transactionReference),
      sessionStatus:
        currentState === ATTENDANT_ORDER_STATES.COMPLETED
          ? "COMPLETED"
          : currentState === ATTENDANT_ORDER_STATES.DISPENSING
            ? "DISPENSING"
            : "FAILED",
      dispensedLitres,
      telemetryDispenseEventCount,
      telemetryErrorCount,
      telemetryMissing,
      conflictingTelemetry,
      requestedLitres,
      totalAmountMwk: body.amountMwk ?? order.transaction?.amountMwk ?? workflow.lastManualEntry?.amountMwk ?? null,
    })

    if (refundAssessment.requiresEvidence) {
      const normalizedEvidenceUrl = String(body.evidenceUrl || "").trim()
      const normalizedNote = String(body.note || "").trim()
      if (!normalizedEvidenceUrl || normalizedNote.length < 16) {
        throw badRequest("Telemetry is absent or weak. Attach evidence and provide a detailed note before submitting a refund request.")
      }
    }

    const amountMwk =
      toNumberOrNull(body.amountMwk)
      ?? refundAssessment.suggestedAmountMwk
      ?? toNumberOrNull(order.transaction?.amountMwk)
      ?? toNumberOrNull(workflow.lastManualEntry?.amountMwk)
    if (amountMwk === null || amountMwk <= 0) {
      throw badRequest("Refund request amount could not be resolved. Enter the requested refund amount.")
    }

    const refundPublicId = createPublicId()
    const nextStatus = REFUND_STATUSES.PENDING_SUPPORT_REVIEW
    const nextInvestigationStatus =
      refundAssessment.riskLevel === "high"
        ? REFUND_INVESTIGATION_STATUSES.ESCALATED
        : REFUND_INVESTIGATION_STATUSES.REQUESTED
    const nextReviewStage =
      refundAssessment.riskLevel === "high"
        ? REFUND_REVIEW_STAGES.COMPLIANCE
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
        ${refundPublicId},
        ${station.id},
        ${Number(order.row.user_id || 0) || null},
        NULL,
        ${order.transaction?.id || null},
        ${order.transaction?.publicId || null},
        ${amountMwk},
        ${normalizeRefundPriorityByAmount(amountMwk)},
        ${nextStatus},
        ${nextInvestigationStatus},
        ${nextReviewStage},
        ${actor.actorUserId},
        NULL,
        NULL,
        ${`Attendant refund request for ${order.orderType}:${orderPublicId}`},
        ${normalizedReasonCode},
        ${body.note},
        ${refundAssessment.fullDispenseConfirmed
          ? "Telemetry indicates full dispense. Review required before any approval."
          : `Submitted by station attendant. Risk level ${refundAssessment.riskLevel}.`},
        ${new Date()},
        NULL
      )
    `

    await appendRefundEvidence({
      refundPublicId,
      evidenceType: "ORDER_REFERENCE",
      sourceType: "ORDER_REFERENCE",
      sourceId: `${order.orderType}:${orderPublicId}`,
      summary: `Refund linked to ${order.orderType}:${orderPublicId}`,
      attachedByUserId: actor.actorUserId,
      metadata: {
        orderType: order.orderType,
        orderPublicId,
      },
    })

    await appendRefundEvidence({
      refundPublicId,
      evidenceType: "ATTENDANT_NOTE",
      sourceType: "ATTENDANT_NOTE",
      sourceId: actor.actorPublicId,
      summary: body.note,
      attachedByUserId: actor.actorUserId,
      metadata: {
        riskLevel: refundAssessment.riskLevel,
        telemetryStatus,
      },
    })

    if (String(body.evidenceUrl || "").trim()) {
      await appendRefundEvidence({
        refundPublicId,
        evidenceType: "ATTACHMENT",
        sourceType: "ATTACHMENT_URL",
        sourceId: body.evidenceUrl,
        summary: "Attendant attached evidence for refund review.",
        attachedByUserId: actor.actorUserId,
        metadata: {
          evidenceUrl: body.evidenceUrl,
        },
      })
    }

    const { metadata } = updateMetadataWorkflow(rawMetadata, (nextWorkflow) => {
      nextWorkflow.state = nextState
      nextWorkflow.refundRequest = {
        publicId: refundPublicId,
        status: nextStatus,
        reasonCode: normalizedReasonCode,
        riskLevel: refundAssessment.riskLevel,
        requestedAt: new Date().toISOString(),
        amountMwk,
      }
      nextWorkflow.assignedAttendantUserId = actor.actorUserId
      nextWorkflow.assignedAttendantPublicId = actor.actorPublicId
      nextWorkflow.assignedAttendantName = actor.actorName
    })

    await persistOrderUpdate({
      orderType: order.orderType,
      row: order.row,
      metadata,
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId: actor.actorStaffId,
      actionType: "ATTENDANT_REFUND_REQUEST_CREATE",
      payload: {
        orderType: order.orderType,
        orderPublicId,
        refundPublicId,
        reasonCode: normalizedReasonCode,
        amountMwk,
        telemetryStatus,
        riskLevel: refundAssessment.riskLevel,
        fullDispenseConfirmed: refundAssessment.fullDispenseConfirmed,
      },
    })

    await notifyUserOfAttendantRefundRequest({
      userId: order.row.user_id,
      station,
      refundPublicId,
      transactionPublicId: order.transaction?.publicId || null,
      amountMwk,
      reasonCode: normalizedReasonCode,
      orderType: order.orderType,
      orderPublicId,
    })

    return ok(res, await refreshDashboardForWrite(req, station), 201)
  })
)

export default router

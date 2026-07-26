import { randomUUID } from "crypto"
import { HttpError } from "../utils/http.js"

export const OPPORTUNITY_STAGES = Object.freeze([
  "discovered",
  "researching",
  "qualified",
  "ready_for_outreach",
  "first_message_sent",
  "awaiting_response",
  "responded",
  "needs_assessment",
  "meeting_scheduled",
  "demo_scheduled",
  "demo_completed",
  "proposal_requested",
  "proposal_sent",
  "negotiation",
  "verbal_agreement",
  "contract_sent",
  "contract_signed",
  "deposit_pending",
  "closed_won",
  "closed_lost",
  "follow_up_later",
])

export const LATE_STAGE_START_INDEX = OPPORTUNITY_STAGES.indexOf("proposal_requested")

export const ONBOARDING_CHECKLIST = Object.freeze([
  ["school_profile_confirmed", "School profile confirmed"],
  ["academic_year_configured", "Academic year configured"],
  ["terms_configured", "Terms configured"],
  ["classes_configured", "Classes configured"],
  ["streams_configured", "Streams configured"],
  ["subjects_configured", "Subjects configured"],
  ["fee_structure_configured", "Fee structure configured"],
  ["roles_confirmed", "Roles confirmed"],
  ["teachers_imported", "Teachers imported"],
  ["students_imported", "Students imported"],
  ["guardians_imported", "Guardians imported"],
  ["opening_balances_imported", "Opening balances imported"],
  ["branding_applied", "Branding applied"],
  ["permissions_tested", "Permissions tested"],
  ["reports_tested", "Reports tested"],
  ["administrator_trained", "Administrator trained"],
  ["bursar_trained", "Bursar trained"],
  ["teachers_trained", "Teachers trained"],
  ["school_sign_off_received", "School sign-off received"],
])

export const REQUIRED_GO_LIVE_ITEMS = Object.freeze([
  "school_profile_confirmed",
  "academic_year_configured",
  "terms_configured",
  "classes_configured",
  "subjects_configured",
  "roles_confirmed",
  "permissions_tested",
  "reports_tested",
  "administrator_trained",
  "school_sign_off_received",
])

export function requiredText(value, label, maxLength = 1000) {
  const text = String(value || "").trim()
  if (!text) throw new HttpError(400, `${label} is required`, { code: "TEAM_VALIDATION_ERROR" })
  if (text.length > maxLength) throw new HttpError(400, `${label} is too long`, { code: "TEAM_VALIDATION_ERROR" })
  return text
}

export function optionalText(value, maxLength = 1000) {
  const text = String(value || "").trim()
  if (!text) return null
  if (text.length > maxLength) throw new HttpError(400, "A supplied value is too long", { code: "TEAM_VALIDATION_ERROR" })
  return text
}

export function numberInRange(value, label, minimum, maximum, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new HttpError(400, `${label} must be between ${minimum} and ${maximum}`, { code: "TEAM_VALIDATION_ERROR" })
  }
  return numeric
}

export function enumValue(value, allowed, label, fallback = null) {
  const normalized = String(value || fallback || "").trim().toLowerCase()
  if (!allowed.includes(normalized)) {
    throw new HttpError(400, `${label} is invalid`, { code: "TEAM_VALIDATION_ERROR", details: { allowed } })
  }
  return normalized
}

export function nullableDate(value, label) {
  if (value === undefined || value === null || value === "") return null
  const text = String(value).trim()
  const date = new Date(text)
  if (!text || Number.isNaN(date.valueOf())) throw new HttpError(400, `${label} is not a valid date`, { code: "TEAM_VALIDATION_ERROR" })
  return text
}

export function paginationFrom(query = {}, maximum = 100) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(maximum, Math.max(1, Math.floor(Number(query.page_size || query.pageSize) || 20)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

export function paginationMeta(total, { page, pageSize }) {
  const count = Number(total || 0)
  return { page, page_size: pageSize, total: count, total_pages: Math.max(1, Math.ceil(count / pageSize)) }
}

export function safeLike(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength).replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function teamEntityRef() {
  return randomUUID()
}

function safeJson(value) {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ serialization_error: true })
  }
}

export async function writeTeamAudit(connection, {
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  entityRef = null,
  schoolId = null,
  beforeValue = null,
  afterValue = null,
  reason = null,
  ipAddress = null,
  userAgent = null,
}) {
  await connection.query(
    `INSERT INTO team_audit_logs
       (public_ref,actor_user_id,action,entity_type,entity_id,entity_ref,school_id,before_value,after_value,reason,ip_address,user_agent)
     VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?)`,
    [actorUserId, requiredText(action, "Audit action", 120), requiredText(entityType, "Audit entity", 80), entityId, entityRef, schoolId, safeJson(beforeValue), safeJson(afterValue), optionalText(reason, 5000), ipAddress, userAgent],
  )
}

export async function createTeamNotification(connection, {
  recipientUserId,
  type,
  title,
  message,
  entityType = null,
  entityRef = null,
  actionPath = null,
}) {
  if (!recipientUserId) return
  await connection.query(
    `INSERT INTO team_notifications
       (public_ref,recipient_user_id,notification_type,title,message,entity_type,entity_ref,action_path)
     VALUES (UUID(),?,?,?,?,?,?,?)`,
    [recipientUserId, requiredText(type, "Notification type", 100), requiredText(title, "Notification title", 220), requiredText(message, "Notification message", 1000), entityType, entityRef, actionPath],
  )
}

export function validateOpportunityStage(stage) {
  return enumValue(stage, OPPORTUNITY_STAGES, "Opportunity stage")
}

export function validateCriticalStageInput(stage, input = {}, existing = {}) {
  if (stage === "closed_lost") {
    return { lossReason: requiredText(input.loss_reason || input.lossReason, "Loss reason", 80) }
  }
  if (stage === "contract_signed") {
    return {
      contractReference: requiredText(input.contract_reference || input.contractReference || existing.contract_reference, "Contract attachment or reference", 500),
      contractSignedAt: nullableDate(input.signing_date || input.contract_signed_at || existing.contract_signed_at, "Signing date") || requiredText(null, "Signing date"),
      finalPrice: numberInRange(input.final_price ?? existing.final_price, "Final price", 0, 999999999999, null) ?? requiredText(null, "Final price"),
      paymentSchedule: requiredText(input.payment_schedule || existing.payment_schedule, "Payment schedule", 5000),
      implementationOwnerRef: requiredText(input.implementation_owner_ref || input.implementationOwnerRef || existing.implementation_owner_ref, "Implementation owner", 36),
      plannedOnboardingDate: nullableDate(input.planned_onboarding_date || existing.planned_onboarding_date, "Planned onboarding date") || requiredText(null, "Planned onboarding date"),
    }
  }
  if (stage === "closed_won") {
    return {
      contractReference: requiredText(input.contract_reference || existing.contract_reference, "Signed-contract evidence", 500),
      finalPrice: numberInRange(input.final_agreement_value ?? input.final_price ?? existing.final_price, "Final agreement value", 0, 999999999999, null) ?? requiredText(null, "Final agreement value"),
      implementationOwnerRef: requiredText(input.implementation_owner_ref || input.implementationOwnerRef || existing.implementation_owner_ref, "Implementation owner", 36),
      expectedGoLiveDate: nullableDate(input.expected_go_live_date || existing.expected_go_live_date, "Expected go-live date") || requiredText(null, "Expected go-live date"),
    }
  }
  return {}
}

export async function insertOnboardingChecklist(connection, projectId) {
  for (const [index, [code, label]] of ONBOARDING_CHECKLIST.entries()) {
    await connection.query(
      `INSERT INTO team_onboarding_checklist_items
         (public_ref,project_id,item_code,label,sort_order,is_required)
       VALUES (UUID(),?,?,?,?,1)`,
      [projectId, code, label, index + 1],
    )
  }
}

export async function recalculateOnboardingProgress(connection, projectId) {
  const [[summary]] = await connection.query(
    `SELECT COUNT(*) total_items,SUM(is_complete=1) completed_items
     FROM team_onboarding_checklist_items WHERE project_id=?`,
    [projectId],
  )
  const total = Number(summary?.total_items || 0)
  const completed = Number(summary?.completed_items || 0)
  const percentage = total ? Math.round((completed / total) * 10000) / 100 : 0
  await connection.query("UPDATE team_onboarding_projects SET completion_percentage=? WHERE id=?", [percentage, projectId])
  return percentage
}

export function deriveSubscriptionStatus(subscription, now = new Date()) {
  if (["cancelled", "read_only"].includes(subscription?.status)) return subscription.status
  const expires = new Date(`${subscription.expires_on}T23:59:59`)
  if (Number.isNaN(expires.valueOf())) return subscription.status || "pending"
  const days = Math.ceil((expires.valueOf() - now.valueOf()) / 86400000)
  if (String(subscription.payment_status) === "overdue") return "payment_overdue"
  if (days < 0) return Number(subscription.grace_period_days || 0) > Math.abs(days) ? "grace_period" : "expired"
  if (days <= 30) return "renewal_approaching"
  return subscription.status === "pending" ? "pending" : "active"
}

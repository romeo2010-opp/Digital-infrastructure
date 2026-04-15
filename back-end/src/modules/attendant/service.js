import { badRequest } from "../../utils/http.js"
import {
  REFUND_INVESTIGATION_STATUSES,
  REFUND_STATUSES,
  evaluateRefundEvidence,
} from "../internal/refundWorkflow.js"

export const ATTENDANT_ORDER_TYPES = {
  QUEUE: "QUEUE",
  RESERVATION: "RESERVATION",
}

export const ATTENDANT_ORDER_STATES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  CUSTOMER_ARRIVED: "customer_arrived",
  PUMP_ASSIGNED: "pump_assigned",
  DISPENSING: "dispensing",
  COMPLETED: "completed",
  REJECTED: "rejected",
  EXCEPTION_REVIEW: "exception_review",
  REFUND_REQUESTED: "refund_requested",
  REFUND_APPROVED: "refund_approved",
  REFUND_DENIED: "refund_denied",
  REFUNDED: "refunded",
}

export const ATTENDANT_TELEMETRY_STATUSES = {
  ONLINE: "online",
  OFFLINE: "offline",
  DELAYED: "delayed",
  UNVERIFIED_MANUAL_MODE: "unverified_manual_mode",
}

export const ATTENDANT_REFUND_RISK_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
}

export const ATTENDANT_REJECTION_REASON_CODES = [
  "customer_not_present",
  "reservation_expired",
  "wrong_fuel_selected",
  "pump_unavailable",
  "fuel_unavailable",
  "duplicate_order",
  "safety_issue",
  "system_mismatch_requires_review",
]

export const ATTENDANT_REFUND_REASON_CODES = [
  "customer_not_present",
  "reservation_expired",
  "wrong_fuel_selected",
  "pump_unavailable",
  "fuel_unavailable",
  "telemetry_missing_no_service_started",
  "telemetry_mismatch",
  "duplicate_order",
  "payment_captured_no_dispense",
  "partial_dispense",
  "safety_issue",
  "other_requires_review",
]

export const ATTENDANT_EXCEPTION_REASON_CODES = [
  "telemetry_missing",
  "telemetry_mismatch",
  "payment_captured_no_dispense",
  "partial_dispense",
  "customer_dispute",
  "manual_review_required",
  "safety_issue",
  "other_requires_review",
]

const VALID_ORDER_TYPES = new Set(Object.values(ATTENDANT_ORDER_TYPES))
const VALID_ORDER_STATES = new Set(Object.values(ATTENDANT_ORDER_STATES))
const VALID_TELEMETRY_STATUSES = new Set(Object.values(ATTENDANT_TELEMETRY_STATUSES))
const VALID_REJECTION_REASON_CODES = new Set(ATTENDANT_REJECTION_REASON_CODES)
const VALID_REFUND_REASON_CODES = new Set(ATTENDANT_REFUND_REASON_CODES)
const VALID_EXCEPTION_REASON_CODES = new Set(ATTENDANT_EXCEPTION_REASON_CODES)

const STATE_TRANSITIONS = new Map([
  [ATTENDANT_ORDER_STATES.PENDING, new Set([
    ATTENDANT_ORDER_STATES.ACCEPTED,
    ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED,
    ATTENDANT_ORDER_STATES.PUMP_ASSIGNED,
    ATTENDANT_ORDER_STATES.REJECTED,
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.ACCEPTED, new Set([
    ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED,
    ATTENDANT_ORDER_STATES.PUMP_ASSIGNED,
    ATTENDANT_ORDER_STATES.REJECTED,
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED, new Set([
    ATTENDANT_ORDER_STATES.PUMP_ASSIGNED,
    ATTENDANT_ORDER_STATES.DISPENSING,
    ATTENDANT_ORDER_STATES.REJECTED,
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.PUMP_ASSIGNED, new Set([
    ATTENDANT_ORDER_STATES.DISPENSING,
    ATTENDANT_ORDER_STATES.COMPLETED,
    ATTENDANT_ORDER_STATES.REJECTED,
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.DISPENSING, new Set([
    ATTENDANT_ORDER_STATES.COMPLETED,
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW, new Set([
    ATTENDANT_ORDER_STATES.ACCEPTED,
    ATTENDANT_ORDER_STATES.CUSTOMER_ARRIVED,
    ATTENDANT_ORDER_STATES.PUMP_ASSIGNED,
    ATTENDANT_ORDER_STATES.DISPENSING,
    ATTENDANT_ORDER_STATES.REJECTED,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.REFUND_REQUESTED, new Set([])],
  [ATTENDANT_ORDER_STATES.COMPLETED, new Set([
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW,
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED,
  ])],
  [ATTENDANT_ORDER_STATES.REJECTED, new Set([])],
  [ATTENDANT_ORDER_STATES.REFUND_APPROVED, new Set([])],
  [ATTENDANT_ORDER_STATES.REFUND_DENIED, new Set([])],
  [ATTENDANT_ORDER_STATES.REFUNDED, new Set([])],
])

function normalizeLower(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase()
}

function toNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeAttendantOrderType(value) {
  const normalized = normalizeUpper(value)
  return VALID_ORDER_TYPES.has(normalized) ? normalized : ""
}

export function normalizeAttendantOrderState(value) {
  const normalized = normalizeLower(value)
  return VALID_ORDER_STATES.has(normalized) ? normalized : ""
}

export function normalizeAttendantTelemetryStatus(value) {
  const normalized = normalizeLower(value)
  return VALID_TELEMETRY_STATUSES.has(normalized) ? normalized : ""
}

export function normalizeRejectionReasonCode(value) {
  const normalized = normalizeLower(value)
  return VALID_REJECTION_REASON_CODES.has(normalized) ? normalized : ""
}

export function normalizeRefundReasonCode(value) {
  const normalized = normalizeLower(value)
  return VALID_REFUND_REASON_CODES.has(normalized) ? normalized : ""
}

export function normalizeExceptionReasonCode(value) {
  const normalized = normalizeLower(value)
  return VALID_EXCEPTION_REASON_CODES.has(normalized) ? normalized : ""
}

export function normalizeAttendantWorkflow(metadata = {}) {
  const rawWorkflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}

  return {
    state: normalizeAttendantOrderState(rawWorkflow.state) || null,
    assignedAttendantUserId: toNumberOrNull(rawWorkflow.assignedAttendantUserId),
    assignedAttendantPublicId: String(rawWorkflow.assignedAttendantPublicId || "").trim() || null,
    assignedAttendantName: String(rawWorkflow.assignedAttendantName || "").trim() || null,
    acceptedAt: String(rawWorkflow.acceptedAt || "").trim() || null,
    customerArrivedAt: String(rawWorkflow.customerArrivedAt || "").trim() || null,
    serviceStartedAt: String(rawWorkflow.serviceStartedAt || "").trim() || null,
    serviceCompletedAt: String(rawWorkflow.serviceCompletedAt || "").trim() || null,
    manualMode: rawWorkflow.manualMode === true,
    manualReason: String(rawWorkflow.manualReason || "").trim() || null,
    pumpAssignment:
      rawWorkflow?.pumpAssignment && typeof rawWorkflow.pumpAssignment === "object"
        ? {
            pumpPublicId: String(rawWorkflow.pumpAssignment.pumpPublicId || "").trim() || null,
            pumpNumber: toNumberOrNull(rawWorkflow.pumpAssignment.pumpNumber),
            nozzlePublicId: String(rawWorkflow.pumpAssignment.nozzlePublicId || "").trim() || null,
            nozzleNumber: String(rawWorkflow.pumpAssignment.nozzleNumber || "").trim() || null,
            fuelType: normalizeUpper(rawWorkflow.pumpAssignment.fuelType) || null,
            confirmedAt: String(rawWorkflow.pumpAssignment.confirmedAt || "").trim() || null,
          }
        : null,
    pumpSession:
      rawWorkflow?.pumpSession && typeof rawWorkflow.pumpSession === "object"
        ? {
            publicId: String(rawWorkflow.pumpSession.publicId || "").trim() || null,
            sessionReference: String(rawWorkflow.pumpSession.sessionReference || "").trim() || null,
            telemetryCorrelationId: String(rawWorkflow.pumpSession.telemetryCorrelationId || "").trim() || null,
            boundAt: String(rawWorkflow.pumpSession.boundAt || "").trim() || null,
          }
        : null,
    rejection:
      rawWorkflow?.rejection && typeof rawWorkflow.rejection === "object"
        ? {
            reasonCode: normalizeRejectionReasonCode(rawWorkflow.rejection.reasonCode) || null,
            note: String(rawWorkflow.rejection.note || "").trim() || null,
            rejectedAt: String(rawWorkflow.rejection.rejectedAt || "").trim() || null,
          }
        : null,
    refundRequest:
      rawWorkflow?.refundRequest && typeof rawWorkflow.refundRequest === "object"
        ? {
            publicId: String(rawWorkflow.refundRequest.publicId || "").trim() || null,
            status: normalizeUpper(rawWorkflow.refundRequest.status) || null,
            reasonCode: normalizeRefundReasonCode(rawWorkflow.refundRequest.reasonCode) || null,
            riskLevel: normalizeLower(rawWorkflow.refundRequest.riskLevel) || null,
            requestedAt: String(rawWorkflow.refundRequest.requestedAt || "").trim() || null,
            amountMwk: toNumberOrNull(rawWorkflow.refundRequest.amountMwk),
          }
        : null,
    exceptions: Array.isArray(rawWorkflow.exceptions)
      ? rawWorkflow.exceptions
          .map((item, index) => {
            if (!item || typeof item !== "object") return null
            return {
              id: String(item.id || `EXC-${index + 1}`).trim() || `EXC-${index + 1}`,
              reasonCode: normalizeExceptionReasonCode(item.reasonCode) || null,
              note: String(item.note || "").trim() || null,
              evidenceUrl: String(item.evidenceUrl || "").trim() || null,
              createdAt: String(item.createdAt || "").trim() || null,
              status: normalizeLower(item.status) || "open",
              supportTicketId: String(item.supportTicketId || "").trim() || null,
            }
          })
          .filter(Boolean)
      : [],
    lastManualEntry:
      rawWorkflow?.lastManualEntry && typeof rawWorkflow.lastManualEntry === "object"
        ? {
            litres: toNumberOrNull(rawWorkflow.lastManualEntry.litres),
            amountMwk: toNumberOrNull(rawWorkflow.lastManualEntry.amountMwk),
            paymentMethod: normalizeUpper(rawWorkflow.lastManualEntry.paymentMethod) || null,
            enteredAt: String(rawWorkflow.lastManualEntry.enteredAt || "").trim() || null,
            enteredByUserId: toNumberOrNull(rawWorkflow.lastManualEntry.enteredByUserId),
            enteredByName: String(rawWorkflow.lastManualEntry.enteredByName || "").trim() || null,
          }
        : null,
  }
}

export function deriveAttendantOrderState({
  orderType,
  baseStatus,
  metadata = {},
  refundStatus = "",
} = {}) {
  const normalizedOrderType = normalizeAttendantOrderType(orderType)
  const normalizedBaseStatus = normalizeUpper(baseStatus)
  const workflow = normalizeAttendantWorkflow(metadata)
  const normalizedRefundStatus = normalizeUpper(refundStatus)

  if (normalizedRefundStatus === REFUND_STATUSES.PAID) {
    return ATTENDANT_ORDER_STATES.REFUNDED
  }
  if (normalizedRefundStatus === REFUND_STATUSES.APPROVED) {
    return ATTENDANT_ORDER_STATES.REFUND_APPROVED
  }
  if (normalizedRefundStatus === REFUND_STATUSES.REJECTED) {
    return ATTENDANT_ORDER_STATES.REFUND_DENIED
  }
  if (
    normalizedRefundStatus === REFUND_STATUSES.PENDING_SUPPORT_REVIEW
    || normalizedRefundStatus === REFUND_STATUSES.PENDING_FINANCE_APPROVAL
  ) {
    return ATTENDANT_ORDER_STATES.REFUND_REQUESTED
  }

  if (normalizedOrderType === ATTENDANT_ORDER_TYPES.QUEUE) {
    if (normalizedBaseStatus === "SERVED") return ATTENDANT_ORDER_STATES.COMPLETED
    if (["NO_SHOW", "CANCELLED"].includes(normalizedBaseStatus)) return ATTENDANT_ORDER_STATES.REJECTED
  }

  if (normalizedOrderType === ATTENDANT_ORDER_TYPES.RESERVATION) {
    if (normalizedBaseStatus === "FULFILLED") return ATTENDANT_ORDER_STATES.COMPLETED
    if (["CANCELLED", "EXPIRED"].includes(normalizedBaseStatus)) return ATTENDANT_ORDER_STATES.REJECTED
  }

  if (workflow.state) return workflow.state
  return ATTENDANT_ORDER_STATES.PENDING
}

export function canTransitionAttendantOrder(currentState, nextState) {
  const normalizedCurrentState = normalizeAttendantOrderState(currentState)
  const normalizedNextState = normalizeAttendantOrderState(nextState)
  if (!normalizedCurrentState || !normalizedNextState) return false
  if (normalizedCurrentState === normalizedNextState) return true
  return Boolean(STATE_TRANSITIONS.get(normalizedCurrentState)?.has(normalizedNextState))
}

export function assertAttendantTransition(currentState, nextState, message = "") {
  if (canTransitionAttendantOrder(currentState, nextState)) {
    return normalizeAttendantOrderState(nextState)
  }

  throw badRequest(
    message || `Invalid attendant transition from ${currentState || "unknown"} to ${nextState || "unknown"}.`
  )
}

export function deriveTelemetryStatus({
  pumpStatus = "",
  nozzleStatus = "",
  hasActivePumpSession = false,
  manualMode = false,
  telemetryUpdatedAt = null,
} = {}) {
  if (manualMode) return ATTENDANT_TELEMETRY_STATUSES.UNVERIFIED_MANUAL_MODE

  const normalizedPumpStatus = normalizeUpper(pumpStatus)
  const normalizedNozzleStatus = normalizeUpper(nozzleStatus)
  if (normalizedPumpStatus === "OFFLINE" || normalizedNozzleStatus === "OFFLINE") {
    return ATTENDANT_TELEMETRY_STATUSES.OFFLINE
  }
  if (hasActivePumpSession) return ATTENDANT_TELEMETRY_STATUSES.ONLINE

  const updatedAtMs = Date.parse(String(telemetryUpdatedAt || ""))
  if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= 120000) {
    return ATTENDANT_TELEMETRY_STATUSES.ONLINE
  }

  return ATTENDANT_TELEMETRY_STATUSES.DELAYED
}

export function calculatePartialRefundAmount({
  requestedLitres = null,
  dispensedLitres = null,
  totalAmountMwk = null,
} = {}) {
  const requested = toNumberOrNull(requestedLitres)
  const dispensed = toNumberOrNull(dispensedLitres)
  const totalAmount = toNumberOrNull(totalAmountMwk)

  if (
    requested === null
    || dispensed === null
    || totalAmount === null
    || requested <= 0
    || dispensed < 0
    || totalAmount <= 0
    || dispensed >= requested
  ) {
    return null
  }

  const remainingRatio = (requested - dispensed) / requested
  return Number((totalAmount * remainingRatio).toFixed(2))
}

export function deriveRefundRiskLevel({
  telemetryStatus,
  assessment,
  fullDispenseConfirmed = false,
  requiresEvidence = false,
} = {}) {
  const normalizedTelemetryStatus = normalizeAttendantTelemetryStatus(telemetryStatus)

  if (fullDispenseConfirmed) return ATTENDANT_REFUND_RISK_LEVELS.HIGH
  if (assessment?.shouldEscalateToCompliance) return ATTENDANT_REFUND_RISK_LEVELS.HIGH
  if (normalizedTelemetryStatus === ATTENDANT_TELEMETRY_STATUSES.UNVERIFIED_MANUAL_MODE) {
    return ATTENDANT_REFUND_RISK_LEVELS.HIGH
  }
  if (normalizedTelemetryStatus === ATTENDANT_TELEMETRY_STATUSES.OFFLINE || requiresEvidence) {
    return ATTENDANT_REFUND_RISK_LEVELS.MEDIUM
  }
  return ATTENDANT_REFUND_RISK_LEVELS.LOW
}

export function assessAttendantRefundRequest({
  telemetryStatus,
  paymentCaptured = false,
  sessionStatus = "",
  dispensedLitres = 0,
  telemetryDispenseEventCount = 0,
  telemetryErrorCount = 0,
  telemetryMissing = false,
  conflictingTelemetry = false,
  requestedLitres = null,
  totalAmountMwk = null,
} = {}) {
  const normalizedTelemetryStatus = normalizeAttendantTelemetryStatus(telemetryStatus)
  const assessment = evaluateRefundEvidence({
    paymentCaptured,
    sessionStatus,
    dispensedLitres,
    telemetryErrorCount,
    telemetryDispenseEventCount,
    telemetryMissing,
    conflictingTelemetry,
  })
  const requested = toNumberOrNull(requestedLitres)
  const dispensed = toNumberOrNull(dispensedLitres) || 0
  const fullDispenseConfirmed =
    Number.isFinite(requested)
      ? requested > 0 && dispensed >= requested
      : assessment.recommendation === "REJECT" && dispensed > 0
  const suggestedAmountMwk =
    paymentCaptured && dispensed <= 0
      ? toNumberOrNull(totalAmountMwk)
      : calculatePartialRefundAmount({
          requestedLitres: requested,
          dispensedLitres: dispensed,
          totalAmountMwk,
        })

  const requiresEvidence =
    normalizedTelemetryStatus === ATTENDANT_TELEMETRY_STATUSES.OFFLINE
    || normalizedTelemetryStatus === ATTENDANT_TELEMETRY_STATUSES.UNVERIFIED_MANUAL_MODE
    || normalizedTelemetryStatus === ATTENDANT_TELEMETRY_STATUSES.DELAYED
    || assessment.recommendation === "ESCALATE_COMPLIANCE"

  return {
    assessment,
    fullDispenseConfirmed,
    suggestedAmountMwk,
    requiresEvidence,
    riskLevel: deriveRefundRiskLevel({
      telemetryStatus: normalizedTelemetryStatus,
      assessment,
      fullDispenseConfirmed,
      requiresEvidence,
    }),
  }
}

import { badRequest } from "../../utils/http.js"

export const REFUND_STATUSES = {
  PENDING_SUPPORT_REVIEW: "PENDING_SUPPORT_REVIEW",
  PENDING_FINANCE_APPROVAL: "PENDING_FINANCE_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAID: "PAID",
}

export const REFUND_INVESTIGATION_STATUSES = {
  REQUESTED: "REQUESTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  ESCALATED: "ESCALATED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
}

export const REFUND_REVIEW_STAGES = {
  SUPPORT: "SUPPORT",
  FINANCE: "FINANCE",
  COMPLIANCE: "COMPLIANCE",
  CLOSED: "CLOSED",
}

export const REFUND_RECOMMENDATIONS = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  ESCALATE_COMPLIANCE: "ESCALATE_COMPLIANCE",
  NEED_MORE_EVIDENCE: "NEED_MORE_EVIDENCE",
}

export function normalizeRefundStatus(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return Object.values(REFUND_STATUSES).includes(normalized) ? normalized : ""
}

export function assertRefundStatusIn(refund, allowedStatuses, message) {
  const currentStatus = normalizeRefundStatus(refund?.status)
  if (allowedStatuses.includes(currentStatus)) return currentStatus
  throw badRequest(message || `Refund request is ${currentStatus || "in an unsupported state"}.`)
}

export function initialSupportRefundStatus({ mode, amountMwk, threshold }) {
  const normalizedMode = String(mode || "").trim().toUpperCase()
  if (normalizedMode === "ISSUE") return REFUND_STATUSES.APPROVED

  const normalizedAmount = Number(amountMwk || 0)
  const normalizedThreshold = Number(threshold || 0)
  if (Number.isFinite(normalizedAmount) && Number.isFinite(normalizedThreshold) && normalizedAmount > normalizedThreshold) {
    return REFUND_STATUSES.PENDING_FINANCE_APPROVAL
  }
  return REFUND_STATUSES.PENDING_SUPPORT_REVIEW
}

export function initialUserRefundStatus() {
  return REFUND_STATUSES.PENDING_SUPPORT_REVIEW
}

export function isRefundReviewClosed(value) {
  return String(value || "").trim().toUpperCase() === REFUND_REVIEW_STAGES.CLOSED
}

export function isRefundTerminalStatus(value) {
  const normalized = normalizeRefundStatus(value)
  return [
    REFUND_STATUSES.APPROVED,
    REFUND_STATUSES.REJECTED,
    REFUND_STATUSES.PAID,
  ].includes(normalized)
}

export function shouldCloseLinkedSupportCaseForRefund({ reviewStage, status }) {
  return isRefundReviewClosed(reviewStage) || isRefundTerminalStatus(status)
}

export function canReopenRefundLinkedSupportCase(actorRoleCode) {
  return String(actorRoleCode || "").trim().toUpperCase() === "PLATFORM_OWNER"
}

export function mapLegacyRefundStatusToInvestigationStatus(value) {
  switch (normalizeRefundStatus(value)) {
    case REFUND_STATUSES.PENDING_FINANCE_APPROVAL:
      return REFUND_INVESTIGATION_STATUSES.ESCALATED
    case REFUND_STATUSES.APPROVED:
      return REFUND_INVESTIGATION_STATUSES.APPROVED
    case REFUND_STATUSES.REJECTED:
      return REFUND_INVESTIGATION_STATUSES.REJECTED
    case REFUND_STATUSES.PAID:
      return REFUND_INVESTIGATION_STATUSES.COMPLETED
    case REFUND_STATUSES.PENDING_SUPPORT_REVIEW:
    default:
      return REFUND_INVESTIGATION_STATUSES.REQUESTED
  }
}

export function mapLegacyRefundStatusToReviewStage(value) {
  switch (normalizeRefundStatus(value)) {
    case REFUND_STATUSES.PENDING_FINANCE_APPROVAL:
      return REFUND_REVIEW_STAGES.FINANCE
    case REFUND_STATUSES.APPROVED:
    case REFUND_STATUSES.REJECTED:
    case REFUND_STATUSES.PAID:
      return REFUND_REVIEW_STAGES.CLOSED
    case REFUND_STATUSES.PENDING_SUPPORT_REVIEW:
    default:
      return REFUND_REVIEW_STAGES.SUPPORT
  }
}

function confidenceLabel(score) {
  if (score >= 85) return "HIGH"
  if (score >= 60) return "MEDIUM"
  return "LOW"
}

export function evaluateRefundEvidence({
  paymentCaptured = false,
  sessionStatus = "",
  dispensedLitres = 0,
  telemetryErrorCount = 0,
  telemetryDispenseEventCount = 0,
  telemetryMissing = false,
  conflictingTelemetry = false,
  repeatedRefundAttempts = 0,
  stationRefundRateAbnormal = false,
} = {}) {
  const normalizedSessionStatus = String(sessionStatus || "").trim().toUpperCase()
  const litres = Number(dispensedLitres || 0)
  const errorCount = Number(telemetryErrorCount || 0)
  const dispenseEventCount = Number(telemetryDispenseEventCount || 0)
  const repeatedAttempts = Number(repeatedRefundAttempts || 0)
  const reasons = []
  const flags = []
  let recommendation = REFUND_RECOMMENDATIONS.NEED_MORE_EVIDENCE
  let score = 50
  let allowsSupportApproval = false
  let allowsFinanceApproval = false
  let shouldEscalateToCompliance = false

  if (paymentCaptured) {
    reasons.push("Payment record exists.")
    score += 10
  } else {
    reasons.push("No verified payment capture record was found.")
    score -= 15
  }

  if (["FAILED", "CANCELLED"].includes(normalizedSessionStatus) && litres <= 0) {
    reasons.push("Pump session ended without dispensing fuel.")
    score += 25
  }

  if (normalizedSessionStatus === "COMPLETED" && litres > 0) {
    reasons.push("Pump session completed with dispensed litres recorded.")
    score -= 35
  }

  if (errorCount > 0) {
    reasons.push("Telemetry contains pump error events.")
    score += 20
  }

  if (dispenseEventCount > 0 || litres > 0) {
    reasons.push("Telemetry or session summary shows dispensing activity.")
    score -= 20
  }

  if (telemetryMissing) {
    flags.push("Telemetry missing for the pump session window.")
    score -= 10
  }

  if (conflictingTelemetry) {
    flags.push("Telemetry is conflicting or inconsistent with the pump session summary.")
    score -= 20
    shouldEscalateToCompliance = true
  }

  if (repeatedAttempts >= 2) {
    flags.push("User has repeated refund attempts.")
    score -= 10
    shouldEscalateToCompliance = true
  }

  if (stationRefundRateAbnormal) {
    flags.push("Station refund rate is above the normal threshold.")
    score -= 10
    shouldEscalateToCompliance = true
  }

  score = Math.max(0, Math.min(100, score))

  if (shouldEscalateToCompliance || (telemetryMissing && !paymentCaptured)) {
    recommendation = REFUND_RECOMMENDATIONS.ESCALATE_COMPLIANCE
  } else if (
    paymentCaptured &&
    ["FAILED", "CANCELLED"].includes(normalizedSessionStatus) &&
    litres <= 0 &&
    errorCount > 0 &&
    dispenseEventCount === 0
  ) {
    recommendation = REFUND_RECOMMENDATIONS.APPROVE
    allowsSupportApproval = true
    allowsFinanceApproval = true
  } else if (
    paymentCaptured &&
    (normalizedSessionStatus === "COMPLETED" || litres > 0) &&
    dispenseEventCount > 0
  ) {
    recommendation = REFUND_RECOMMENDATIONS.REJECT
  }

  if (recommendation === REFUND_RECOMMENDATIONS.APPROVE && score >= 70) {
    allowsFinanceApproval = true
    allowsSupportApproval = score >= 80
  }

  return {
    recommendation,
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    reasons,
    flags,
    allowsSupportApproval,
    allowsFinanceApproval,
    shouldEscalateToCompliance,
  }
}

export function deriveRefundEvidenceCoverage({ evidenceBundle = [] } = {}) {
  const evidenceTypes = new Set(
    (Array.isArray(evidenceBundle) ? evidenceBundle : [])
      .map((item) => String(item?.evidenceType ?? item?.evidence_type ?? "").trim().toUpperCase())
      .filter(Boolean)
  )

  const hasTransactionEvidence =
    evidenceTypes.has("TRANSACTION_RECORD")
    || evidenceTypes.has("PAYMENT_RECORD")
  const hasPumpSessionEvidence = evidenceTypes.has("PUMP_SESSION")
  const hasTelemetryEvidence = [...evidenceTypes].some((type) => type.startsWith("TELEMETRY_"))

  return {
    hasTransactionEvidence,
    hasPumpSessionEvidence,
    hasTelemetryEvidence,
    strong: hasTransactionEvidence && hasPumpSessionEvidence && hasTelemetryEvidence,
  }
}

export function resolveSupportRefundApproval({ amountMwk, threshold, walletTransactionReference }) {
  const normalizedAmount = Number(amountMwk || 0)
  const normalizedThreshold = Number(threshold || 0)
  const scopedWalletTransactionReference = String(walletTransactionReference || "").trim()

  if (Number.isFinite(normalizedAmount) && Number.isFinite(normalizedThreshold) && normalizedAmount > normalizedThreshold) {
    return {
      status: REFUND_STATUSES.PENDING_FINANCE_APPROVAL,
      credited: false,
      forwardedToFinance: true,
      resolutionNotes: "Support verified the refund and forwarded it to finance approval because it exceeds the support threshold.",
    }
  }

  return {
    status: scopedWalletTransactionReference ? REFUND_STATUSES.PAID : REFUND_STATUSES.APPROVED,
    credited: Boolean(scopedWalletTransactionReference),
    forwardedToFinance: false,
    resolutionNotes: scopedWalletTransactionReference
      ? "Approved by support within threshold and credited to wallet."
      : "Approved by support within threshold.",
  }
}

export function hasComplianceFalsePositiveDisposition(complianceCase = {}) {
  const status = String(complianceCase?.status || "").trim().toUpperCase()
  const actionTaken = String(complianceCase?.actionTaken ?? complianceCase?.action_taken ?? "").trim().toLowerCase()
  return status === "RESOLVED" && actionTaken.includes("false positive")
}

export function hasComplianceFalsePositiveAuditEvent(auditTrail = []) {
  return (Array.isArray(auditTrail) ? auditTrail : []).some((item) => {
    const actionType = String(item?.actionType ?? item?.action_type ?? "").trim().toUpperCase()
    const summary = String(item?.summary || "").trim().toLowerCase()
    return actionType === "COMPLIANCE_MARK_FALSE_POSITIVE" || summary.includes("marked false positive")
  })
}

export function selectUnambiguousRefundTransactionLink(items = []) {
  const candidates = (Array.isArray(items) ? items : [])
    .map((item) => ({
      transactionId: Number(item?.transactionId ?? item?.transaction_id ?? 0) || null,
      transactionPublicId: String(
        item?.transactionPublicId
        ?? item?.transaction_public_id
        ?? ""
      ).trim(),
    }))
    .filter((item) => item.transactionPublicId)

  if (!candidates.length) return null

  const distinctTransactionPublicIds = new Set(candidates.map((item) => item.transactionPublicId))
  if (distinctTransactionPublicIds.size !== 1) return null

  return candidates[0]
}

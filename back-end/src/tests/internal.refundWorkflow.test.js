import test from "node:test"
import assert from "node:assert/strict"
import {
  canReopenRefundLinkedSupportCase,
  hasComplianceFalsePositiveAuditEvent,
  deriveRefundEvidenceCoverage,
  evaluateRefundEvidence,
  hasComplianceFalsePositiveDisposition,
  initialSupportRefundStatus,
  initialUserRefundStatus,
  isRefundReviewClosed,
  isRefundTerminalStatus,
  REFUND_INVESTIGATION_STATUSES,
  REFUND_RECOMMENDATIONS,
  REFUND_REVIEW_STAGES,
  REFUND_STATUSES,
  mapLegacyRefundStatusToInvestigationStatus,
  mapLegacyRefundStatusToReviewStage,
  resolveSupportRefundApproval,
  selectUnambiguousRefundTransactionLink,
  shouldCloseLinkedSupportCaseForRefund,
} from "../modules/internal/refundWorkflow.js"

test("user refund requests start in support review", () => {
  assert.equal(initialUserRefundStatus(), REFUND_STATUSES.PENDING_SUPPORT_REVIEW)
})

test("support refund submit below threshold stays in support review", () => {
  const status = initialSupportRefundStatus({
    mode: "SUBMIT_APPROVAL",
    amountMwk: 12000,
    threshold: 15000,
  })

  assert.equal(status, REFUND_STATUSES.PENDING_SUPPORT_REVIEW)
})

test("support refund submit above threshold goes to finance approval", () => {
  const status = initialSupportRefundStatus({
    mode: "SUBMIT_APPROVAL",
    amountMwk: 42000,
    threshold: 15000,
  })

  assert.equal(status, REFUND_STATUSES.PENDING_FINANCE_APPROVAL)
})

test("support approval forwards high value refunds to finance", () => {
  const decision = resolveSupportRefundApproval({
    amountMwk: 40000,
    threshold: 15000,
    walletTransactionReference: "",
  })

  assert.equal(decision.status, REFUND_STATUSES.PENDING_FINANCE_APPROVAL)
  assert.equal(decision.forwardedToFinance, true)
  assert.equal(decision.credited, false)
})

test("support approval marks credited refunds as paid", () => {
  const decision = resolveSupportRefundApproval({
    amountMwk: 8000,
    threshold: 15000,
    walletTransactionReference: "WRF-123",
  })

  assert.equal(decision.status, REFUND_STATUSES.PAID)
  assert.equal(decision.forwardedToFinance, false)
  assert.equal(decision.credited, true)
})

test("legacy statuses map to investigation statuses and review stages", () => {
  assert.equal(
    mapLegacyRefundStatusToInvestigationStatus(REFUND_STATUSES.PENDING_SUPPORT_REVIEW),
    REFUND_INVESTIGATION_STATUSES.REQUESTED
  )
  assert.equal(
    mapLegacyRefundStatusToInvestigationStatus(REFUND_STATUSES.PENDING_FINANCE_APPROVAL),
    REFUND_INVESTIGATION_STATUSES.ESCALATED
  )
  assert.equal(
    mapLegacyRefundStatusToReviewStage(REFUND_STATUSES.PENDING_FINANCE_APPROVAL),
    REFUND_REVIEW_STAGES.FINANCE
  )
  assert.equal(
    mapLegacyRefundStatusToReviewStage(REFUND_STATUSES.PAID),
    REFUND_REVIEW_STAGES.CLOSED
  )
})

test("terminal refund states close linked support cases", () => {
  assert.equal(
    shouldCloseLinkedSupportCaseForRefund({
      reviewStage: REFUND_REVIEW_STAGES.CLOSED,
      status: REFUND_STATUSES.REJECTED,
    }),
    true
  )
  assert.equal(isRefundReviewClosed(REFUND_REVIEW_STAGES.CLOSED), true)
  assert.equal(isRefundTerminalStatus(REFUND_STATUSES.PAID), true)
})

test("only the platform owner can reopen refund-linked closed cases", () => {
  assert.equal(canReopenRefundLinkedSupportCase("PLATFORM_OWNER"), true)
  assert.equal(canReopenRefundLinkedSupportCase("CUSTOMER_SUPPORT_AGENT"), false)
})

test("evidence evaluation recommends approval for failed zero-dispense sessions with telemetry error", () => {
  const assessment = evaluateRefundEvidence({
    paymentCaptured: true,
    sessionStatus: "FAILED",
    dispensedLitres: 0,
    telemetryErrorCount: 2,
    telemetryDispenseEventCount: 0,
  })

  assert.equal(assessment.recommendation, REFUND_RECOMMENDATIONS.APPROVE)
  assert.equal(assessment.allowsSupportApproval, true)
  assert.equal(assessment.allowsFinanceApproval, true)
  assert.equal(assessment.shouldEscalateToCompliance, false)
})

test("evidence evaluation recommends rejection for completed dispensing sessions", () => {
  const assessment = evaluateRefundEvidence({
    paymentCaptured: true,
    sessionStatus: "COMPLETED",
    dispensedLitres: 34.2,
    telemetryDispenseEventCount: 4,
  })

  assert.equal(assessment.recommendation, REFUND_RECOMMENDATIONS.REJECT)
  assert.equal(assessment.allowsSupportApproval, false)
})

test("evidence evaluation escalates suspicious claims to compliance", () => {
  const assessment = evaluateRefundEvidence({
    paymentCaptured: true,
    sessionStatus: "FAILED",
    dispensedLitres: 0,
    telemetryErrorCount: 1,
    conflictingTelemetry: true,
    repeatedRefundAttempts: 3,
  })

  assert.equal(assessment.recommendation, REFUND_RECOMMENDATIONS.ESCALATE_COMPLIANCE)
  assert.equal(assessment.shouldEscalateToCompliance, true)
  assert.equal(assessment.allowsSupportApproval, false)
})

test("evidence coverage is strong when transaction, pump-session, and telemetry records are present", () => {
  const coverage = deriveRefundEvidenceCoverage({
    evidenceBundle: [
      { evidenceType: "TRANSACTION_RECORD" },
      { evidenceType: "PUMP_SESSION" },
      { evidenceType: "TELEMETRY_ERROR" },
    ],
  })

  assert.equal(coverage.hasTransactionEvidence, true)
  assert.equal(coverage.hasPumpSessionEvidence, true)
  assert.equal(coverage.hasTelemetryEvidence, true)
  assert.equal(coverage.strong, true)
})

test("evidence coverage stays weak when telemetry evidence is missing", () => {
  const coverage = deriveRefundEvidenceCoverage({
    evidenceBundle: [
      { evidenceType: "TRANSACTION_RECORD" },
      { evidenceType: "PUMP_SESSION" },
    ],
  })

  assert.equal(coverage.hasTransactionEvidence, true)
  assert.equal(coverage.hasPumpSessionEvidence, true)
  assert.equal(coverage.hasTelemetryEvidence, false)
  assert.equal(coverage.strong, false)
})

test("unambiguous refund transaction link is selected when all candidates match", () => {
  const selected = selectUnambiguousRefundTransactionLink([
    { transaction_public_id: "TX-100", transaction_id: 12 },
    { transaction_public_id: "TX-100", transaction_id: 12 },
  ])

  assert.deepEqual(selected, {
    transactionId: 12,
    transactionPublicId: "TX-100",
  })
})

test("ambiguous refund transaction link returns null when candidates differ", () => {
  const selected = selectUnambiguousRefundTransactionLink([
    { transaction_public_id: "TX-100", transaction_id: 12 },
    { transaction_public_id: "TX-200", transaction_id: 18 },
  ])

  assert.equal(selected, null)
})

test("resolved compliance cases marked false positive unlock finance approval", () => {
  assert.equal(
    hasComplianceFalsePositiveDisposition({
      status: "RESOLVED",
      action_taken: "[2026-03-18T08:00:00.000Z] Marked as false positive.",
    }),
    true
  )
})

test("resolved compliance cases without false positive remain locked", () => {
  assert.equal(
    hasComplianceFalsePositiveDisposition({
      status: "RESOLVED",
      action_taken: "[2026-03-18T08:00:00.000Z] Resolved by compliance review.",
    }),
    false
  )
})

test("false positive audit event unlocks compliance even when case note is custom", () => {
  assert.equal(
    hasComplianceFalsePositiveAuditEvent([
      {
        actionType: "COMPLIANCE_MARK_FALSE_POSITIVE",
        summary: "Compliance case marked false positive: Refund investigation",
      },
    ]),
    true
  )
})

test("unrelated compliance audit event does not unlock false positive disposition", () => {
  assert.equal(
    hasComplianceFalsePositiveAuditEvent([
      {
        actionType: "COMPLIANCE_RESOLVE_CASE",
        summary: "Compliance case resolved: Refund investigation",
      },
    ]),
    false
  )
})

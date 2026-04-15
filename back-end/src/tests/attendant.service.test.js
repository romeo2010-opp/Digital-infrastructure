import test from "node:test"
import assert from "node:assert/strict"
import {
  assessAttendantRefundRequest,
  assertAttendantTransition,
  ATTENDANT_ORDER_STATES,
  ATTENDANT_ORDER_TYPES,
  ATTENDANT_REFUND_RISK_LEVELS,
  ATTENDANT_TELEMETRY_STATUSES,
  deriveAttendantOrderState,
  deriveTelemetryStatus,
  normalizeAttendantWorkflow,
} from "../modules/attendant/service.js"

test("completed orders can transition into exception review and refund requested", () => {
  assert.equal(
    assertAttendantTransition(ATTENDANT_ORDER_STATES.COMPLETED, ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW),
    ATTENDANT_ORDER_STATES.EXCEPTION_REVIEW
  )
  assert.equal(
    assertAttendantTransition(ATTENDANT_ORDER_STATES.COMPLETED, ATTENDANT_ORDER_STATES.REFUND_REQUESTED),
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED
  )
})

test("deriveAttendantOrderState prefers refund workflow outcomes over base status", () => {
  assert.equal(
    deriveAttendantOrderState({
      orderType: ATTENDANT_ORDER_TYPES.QUEUE,
      baseStatus: "SERVED",
      metadata: {
        attendantWorkflow: {
          state: ATTENDANT_ORDER_STATES.COMPLETED,
          refundRequest: {
            status: "PENDING_SUPPORT_REVIEW",
          },
        },
      },
      refundStatus: "PENDING_SUPPORT_REVIEW",
    }),
    ATTENDANT_ORDER_STATES.REFUND_REQUESTED
  )
})

test("deriveTelemetryStatus flags manual mode and stale telemetry correctly", () => {
  assert.equal(
    deriveTelemetryStatus({
      manualMode: true,
      telemetryUpdatedAt: new Date().toISOString(),
    }),
    ATTENDANT_TELEMETRY_STATUSES.UNVERIFIED_MANUAL_MODE
  )

  assert.equal(
    deriveTelemetryStatus({
      pumpStatus: "ACTIVE",
      nozzleStatus: "ACTIVE",
      hasActivePumpSession: false,
      telemetryUpdatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }),
    ATTENDANT_TELEMETRY_STATUSES.DELAYED
  )
})

test("assessAttendantRefundRequest escalates when telemetry is weak and payment exists", () => {
  const result = assessAttendantRefundRequest({
    telemetryStatus: ATTENDANT_TELEMETRY_STATUSES.OFFLINE,
    paymentCaptured: true,
    sessionStatus: "FAILED",
    dispensedLitres: 0,
    telemetryDispenseEventCount: 0,
    telemetryErrorCount: 1,
    telemetryMissing: true,
    conflictingTelemetry: false,
    requestedLitres: 40,
    totalAmountMwk: 96000,
  })

  assert.equal(result.requiresEvidence, true)
  assert.equal(result.riskLevel, ATTENDANT_REFUND_RISK_LEVELS.MEDIUM)
  assert.equal(result.suggestedAmountMwk, 96000)
})

test("assessAttendantRefundRequest marks full-dispense claims as high risk", () => {
  const result = assessAttendantRefundRequest({
    telemetryStatus: ATTENDANT_TELEMETRY_STATUSES.ONLINE,
    paymentCaptured: true,
    sessionStatus: "COMPLETED",
    dispensedLitres: 50,
    telemetryDispenseEventCount: 3,
    telemetryErrorCount: 0,
    telemetryMissing: false,
    conflictingTelemetry: false,
    requestedLitres: 40,
    totalAmountMwk: 100000,
  })

  assert.equal(result.fullDispenseConfirmed, true)
  assert.equal(result.riskLevel, ATTENDANT_REFUND_RISK_LEVELS.HIGH)
})

test("normalizeAttendantWorkflow preserves structured exception and pump data", () => {
  const workflow = normalizeAttendantWorkflow({
    attendantWorkflow: {
      state: "pump_assigned",
      pumpAssignment: {
        pumpPublicId: "PUMP-1",
        nozzlePublicId: "NOZZLE-2",
        nozzleNumber: "2",
        fuelType: "petrol",
      },
      pumpSession: {
        publicId: "PS-1",
        sessionReference: "PS-REF-1",
        telemetryCorrelationId: "TEL-1",
        boundAt: "2026-03-29T09:00:00.000Z",
      },
      exceptions: [
        {
          id: "EX-1",
          reasonCode: "telemetry_missing",
          note: "Telemetry feed dropped during fueling.",
          evidenceUrl: "https://example.test/evidence.jpg",
          status: "open",
        },
      ],
    },
  })

  assert.equal(workflow.state, ATTENDANT_ORDER_STATES.PUMP_ASSIGNED)
  assert.equal(workflow.pumpAssignment?.fuelType, "PETROL")
  assert.equal(workflow.pumpSession?.publicId, "PS-1")
  assert.equal(workflow.pumpSession?.telemetryCorrelationId, "TEL-1")
  assert.equal(workflow.exceptions.length, 1)
  assert.equal(workflow.exceptions[0]?.reasonCode, "telemetry_missing")
})

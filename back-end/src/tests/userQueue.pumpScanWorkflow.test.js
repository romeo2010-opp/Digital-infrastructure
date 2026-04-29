import test from "node:test"
import assert from "node:assert/strict"
import {
  applyQueueDispenseRequestToAttendantWorkflow,
  applyQueuePumpScanToAttendantWorkflow,
  assertQueuePumpScanSessionMatchesAuth,
} from "../modules/userQueue/routes.js"

test("pump QR scan promotes an arrived queue order to pump_assigned", () => {
  const scannedAt = "2026-04-09T08:30:00.000Z"
  const result = applyQueuePumpScanToAttendantWorkflow({
    queueStatus: "WAITING",
    scannedAt,
    metadata: {
      attendantWorkflow: {
        state: "customer_arrived",
        customerArrivedAt: "2026-04-09T08:20:00.000Z",
      },
    },
    pumpAssignment: {
      pumpPublicId: "ST-P01",
      pumpNumber: 1,
      nozzlePublicId: "ST-P01-N01",
      nozzleNumber: "1",
      fuelType: "petrol",
    },
  })

  assert.equal(result.currentState, "customer_arrived")
  assert.equal(result.nextState, "pump_assigned")
  assert.equal(result.metadata.attendantWorkflow.state, "pump_assigned")
  assert.equal(result.metadata.attendantWorkflow.customerArrivedAt, "2026-04-09T08:20:00.000Z")
  assert.equal(result.metadata.attendantWorkflow.pumpAssignment.pumpPublicId, "ST-P01")
  assert.equal(result.metadata.attendantWorkflow.pumpAssignment.nozzlePublicId, "ST-P01-N01")
  assert.equal(result.metadata.attendantWorkflow.pumpAssignment.fuelType, "PETROL")
  assert.equal(result.metadata.attendantWorkflow.pumpAssignment.confirmedAt, scannedAt)
})

test("pump QR scan backfills customer arrival and attaches pump details for accepted orders", () => {
  const scannedAt = "2026-04-09T08:45:00.000Z"
  const result = applyQueuePumpScanToAttendantWorkflow({
    queueStatus: "WAITING",
    scannedAt,
    metadata: {
      attendantWorkflow: {
        state: "accepted",
      },
      serviceRequest: {
        requestedLitres: 20,
      },
    },
    pumpAssignment: {
      pumpPublicId: "ST-P02",
      pumpNumber: 2,
      nozzlePublicId: "ST-P02-N02",
      nozzleNumber: "2",
      fuelType: "diesel",
    },
  })

  assert.equal(result.currentState, "accepted")
  assert.equal(result.nextState, "pump_assigned")
  assert.equal(result.metadata.attendantWorkflow.customerArrivedAt, scannedAt)
  assert.equal(result.metadata.attendantWorkflow.pumpAssignment.fuelType, "DIESEL")
  assert.equal(result.metadata.serviceRequest.pumpPublicId, "ST-P02")
  assert.equal(result.metadata.serviceRequest.nozzlePublicId, "ST-P02-N02")
  assert.equal(result.metadata.serviceRequest.fuelType, "DIESEL")
})

test("pump verification session guard allows the original authenticated session", () => {
  assert.doesNotThrow(() => {
    assertQueuePumpScanSessionMatchesAuth(
      {
        lastPumpScan: {
          scannedBySessionPublicId: "SESSION-001",
        },
      },
      {
        sessionPublicId: "SESSION-001",
      }
    )
  })
})

test("pump verification session guard rejects a different authenticated session", () => {
  assert.throws(
    () => {
      assertQueuePumpScanSessionMatchesAuth(
        {
          lastPumpScan: {
            scannedBySessionPublicId: "SESSION-001",
          },
        },
        {
          sessionPublicId: "SESSION-002",
        }
      )
    },
    /different active session/
  )
})

test("queue dispense request binds a pump session and promotes the workflow to dispensing", () => {
  const startedAt = "2026-04-09T09:00:00.000Z"
  const result = applyQueueDispenseRequestToAttendantWorkflow({
    queueStatus: "WAITING",
    startedAt,
    metadata: {
      lastPumpScan: {
        pumpPublicId: "ST-P03",
        pumpNumber: 3,
        nozzlePublicId: "ST-P03-N01",
        nozzleNumber: "1",
        fuelType: "PETROL",
        scannedAt: "2026-04-09T08:58:00.000Z",
      },
      serviceRequest: {
        liters: 25,
        paymentMode: "PAY_AT_PUMP",
        paymentStatus: "PENDING_AT_PUMP",
      },
    },
    pumpAssignment: {
      pumpPublicId: "ST-P03",
      pumpNumber: 3,
      nozzlePublicId: "ST-P03-N01",
      nozzleNumber: "1",
      fuelType: "petrol",
    },
    pumpSessionBinding: {
      pumpSessionPublicId: "PS-QUEUE-001",
      sessionReference: "PS-QUEUE-REF-001",
      telemetryCorrelationId: "TEL-QUEUE-001",
    },
  })

  assert.equal(result.currentState, "pending")
  assert.equal(result.nextState, "dispensing")
  assert.equal(result.metadata.attendantWorkflow.state, "dispensing")
  assert.equal(result.metadata.attendantWorkflow.serviceStartedAt, startedAt)
  assert.equal(result.metadata.attendantWorkflow.customerArrivedAt, "2026-04-09T08:58:00.000Z")
  assert.equal(result.metadata.attendantWorkflow.pumpSession.publicId, "PS-QUEUE-001")
  assert.equal(result.metadata.attendantWorkflow.pumpSession.sessionReference, "PS-QUEUE-REF-001")
  assert.equal(result.metadata.serviceRequest.paymentStatus, "DISPENSING")
  assert.equal(result.metadata.serviceRequest.dispensingStartedAt, startedAt)
  assert.equal(result.metadata.serviceRequest.pumpSessionPublicId, "PS-QUEUE-001")
  assert.equal(result.metadata.lastPumpScan.pumpStatus, "DISPENSING")
  assert.equal(result.metadata.lastPumpScan.nozzleStatus, "DISPENSING")
})

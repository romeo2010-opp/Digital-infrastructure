import test from "node:test"
import assert from "node:assert/strict"
import { applyQueuePumpScanToAttendantWorkflow } from "../modules/userQueue/routes.js"

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

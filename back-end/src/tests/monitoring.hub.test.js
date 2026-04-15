import test from "node:test"
import assert from "node:assert/strict"
import { publishMonitoringUpdate, subscribeMonitoringPump } from "../realtime/monitoringHub.js"

test("monitoring hub broadcasts updates only to matching pump subscribers", () => {
  const received = []
  const unsubscribe = subscribeMonitoringPump(7, "PUMP-123", (message) => {
    received.push(message)
  })

  publishMonitoringUpdate({
    stationId: 7,
    pumpPublicId: "PUMP-999",
    payload: { pumpId: "PUMP-999", nozzleId: "NZ-9", status: "IDLE" },
  })

  publishMonitoringUpdate({
    stationId: 7,
    pumpPublicId: "PUMP-123",
    payload: { pumpId: "PUMP-123", nozzleId: "NZ-1", status: "DISPENSING" },
  })

  assert.equal(received.length, 1)
  assert.equal(received[0].type, "monitoring:update")
  assert.equal(received[0].pumpId, "PUMP-123")
  assert.equal(received[0].status, "DISPENSING")

  unsubscribe()

  publishMonitoringUpdate({
    stationId: 7,
    pumpPublicId: "PUMP-123",
    payload: { pumpId: "PUMP-123", nozzleId: "NZ-2", status: "OFFLINE" },
  })

  assert.equal(received.length, 1)
})

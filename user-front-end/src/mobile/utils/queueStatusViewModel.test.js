import test from "node:test"
import assert from "node:assert/strict"
import {
  resolveServiceRequestPaymentMode,
  serviceRequestStatusLabel,
  shouldShowServiceRequestProgress,
} from "./queueStatusViewModel.js"

test("service request progress stays visible after a completed stop event", () => {
  const serviceRequest = {
    dispensingActive: false,
    dispensedLitres: 20,
    pumpSessionStatus: "COMPLETED",
    paymentStatus: "DISPENSING",
  }

  assert.equal(shouldShowServiceRequestProgress(serviceRequest), true)
  assert.equal(serviceRequestStatusLabel(serviceRequest), "COMPLETED")
})

test("service request progress stays live while dispensing is active", () => {
  const serviceRequest = {
    dispensingActive: true,
    dispensedLitres: 12.5,
    pumpSessionStatus: "DISPENSING",
    paymentStatus: "PENDING_AT_PUMP",
  }

  assert.equal(shouldShowServiceRequestProgress(serviceRequest), true)
  assert.equal(serviceRequestStatusLabel(serviceRequest), "DISPENSING")
})

test("service request payment mode stays on prepay when wallet evidence exists", () => {
  const serviceRequest = {
    paymentMode: null,
    prepaySelected: false,
    paymentStatus: "HELD",
    holdReference: "SPH-QUEUE-001",
    walletTransactionReference: null,
  }

  assert.equal(resolveServiceRequestPaymentMode(serviceRequest), "PREPAY")
})

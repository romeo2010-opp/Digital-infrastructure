import test from "node:test"
import assert from "node:assert/strict"
import {
  assertFuelOrderTransition,
  calculateManualOrderHoldAmount,
  canTransitionFuelOrder,
  FUEL_ORDER_STATUSES,
  shouldDeduplicatePresenceEvent,
} from "../modules/fuelOrders/service.js"
import {
  attachFuelOrderBodySchema,
  createManualWalletFuelOrderBodySchema,
  finalizeFuelOrderBodySchema,
  presenceEventBodySchema,
} from "../modules/fuelOrders/routes.js"

test("manual fuel order status machine allows the intended happy path", () => {
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.CREATED, FUEL_ORDER_STATUSES.AWAITING_STATION),
    true
  )
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.AWAITING_STATION, FUEL_ORDER_STATUSES.AT_STATION),
    true
  )
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.AT_STATION, FUEL_ORDER_STATUSES.NEAR_PUMP),
    true
  )
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.NEAR_PUMP, FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION),
    true
  )
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION, FUEL_ORDER_STATUSES.DISPENSING),
    true
  )
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.DISPENSING, FUEL_ORDER_STATUSES.COMPLETED),
    true
  )
})

test("manual fuel order status machine blocks backwards or scattered transitions", () => {
  assert.equal(
    canTransitionFuelOrder(FUEL_ORDER_STATUSES.NEAR_PUMP, FUEL_ORDER_STATUSES.AWAITING_STATION),
    false
  )

  assert.throws(
    () =>
      assertFuelOrderTransition(
        FUEL_ORDER_STATUSES.DISPENSING,
        FUEL_ORDER_STATUSES.AT_STATION
      ),
    /invalid fuel order transition/i
  )
})

test("manual fuel order hold amount prefers explicit MWK values and otherwise derives from litres and station pricing", () => {
  assert.equal(
    calculateManualOrderHoldAmount({
      requestedAmountMwk: 85000,
      requestedLitres: 25,
      stationPricePerLitre: 4700,
    }),
    85000
  )

  assert.equal(
    calculateManualOrderHoldAmount({
      requestedLitres: 20,
      stationPricePerLitre: 4600,
    }),
    92000
  )

  assert.throws(
    () =>
      calculateManualOrderHoldAmount({
        requestedLitres: 20,
      }),
    /manual wallet order needs either requestedamountmwk or requestedlitres priced at the station/i
  )
})

test("presence dedupe helper collapses repeated beacon evidence inside the configured debounce window", () => {
  assert.equal(
    shouldDeduplicatePresenceEvent(
      "2026-03-28T09:00:00.000Z",
      "2026-03-28T09:00:20.000Z",
      30
    ),
    true
  )
  assert.equal(
    shouldDeduplicatePresenceEvent(
      "2026-03-28T09:00:00.000Z",
      "2026-03-28T09:01:05.000Z",
      30
    ),
    false
  )
})

test("manual fuel order API schema requires an amount or litres", () => {
  const parsed = createManualWalletFuelOrderBodySchema.parse({
    stationPublicId: "SL-MW-BLNT-0001",
    fuelType: "PETROL",
    requestedAmountMwk: 60000,
  })
  assert.equal(parsed.requestedAmountMwk, 60000)

  assert.throws(
    () =>
      createManualWalletFuelOrderBodySchema.parse({
        stationPublicId: "SL-MW-BLNT-0001",
        fuelType: "PETROL",
      }),
    /requestedamountmwk or requestedlitres is required/i
  )
})

test("presence ingest schema accepts the secure gateway payload shape and rejects invalid proximity levels", () => {
  const parsed = presenceEventBodySchema.parse({
    userPublicId: "SLU-ABC123",
    proximityLevel: "pump",
    seenAt: "2026-03-28T10:12:00.000Z",
    metadata: {
      gatewayId: "gw-01",
    },
  })
  assert.equal(parsed.proximityLevel, "pump")

  assert.throws(
    () =>
      presenceEventBodySchema.parse({
        userPublicId: "SLU-ABC123",
        proximityLevel: "priority",
      }),
    /invalid enum value/i
  )
})

test("attach and finalize schemas keep station-side actions explicit and typed", () => {
  const attachPayload = attachFuelOrderBodySchema.parse({
    fuelOrderId: "01FUELORDERABC0000000000001",
    forceReattach: true,
    note: "Supervisor confirmed the switch.",
  })
  assert.equal(attachPayload.forceReattach, true)

  const finalizePayload = finalizeFuelOrderBodySchema.parse({
    dispensedLitres: 32.5,
    amountMwk: 149500,
    note: "Telemetry verified.",
  })
  assert.equal(finalizePayload.dispensedLitres, 32.5)
  assert.equal(finalizePayload.amountMwk, 149500)
})

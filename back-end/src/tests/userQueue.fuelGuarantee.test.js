import test from "node:test"
import assert from "node:assert/strict"
import { computeFuelGuarantee } from "../modules/userQueue/fuelGuarantee.js"

test("computeFuelGuarantee resolves SAFE / WARNING / CRITICAL / NONE boundaries", () => {
  const baseInput = {
    carsAhead: 10,
    avgLitersPerCar: 20,
    requestedLiters: 20,
    fuelLastUpdatedAt: "2026-02-26T10:00:00.000Z",
    now: "2026-02-26T10:01:00.000Z",
  }

  const safe = computeFuelGuarantee({ ...baseInput, fuelRemainingLiters: 1000 })
  assert.equal(safe.state, "safe")

  const warning = computeFuelGuarantee({ ...baseInput, fuelRemainingLiters: 370 })
  assert.equal(warning.state, "warning")

  const critical = computeFuelGuarantee({ ...baseInput, fuelRemainingLiters: 350 })
  assert.equal(critical.state, "critical")

  const none = computeFuelGuarantee({ ...baseInput, fuelRemainingLiters: 349 })
  assert.equal(none.state, "none")
})

test("computeFuelGuarantee applies staleness downgrade", () => {
  const input = {
    carsAhead: 10,
    avgLitersPerCar: 20,
    requestedLiters: 20,
    fuelRemainingLiters: 1000,
    fuelLastUpdatedAt: "2026-02-26T09:30:00.000Z",
    now: "2026-02-26T10:00:00.000Z",
  }

  const stale = computeFuelGuarantee(input, { stalenessSeconds: 120 })
  assert.equal(stale.state, "warning")
  assert.equal(stale.fuelDataStale, true)
  assert.equal(stale.notes.includes("fuel_data_stale_downgrade"), true)
})

test("computeFuelGuarantee returns conservative states when fuel data is missing", () => {
  const moderateUnknown = computeFuelGuarantee({
    carsAhead: 3,
    avgLitersPerCar: 25,
    requestedLiters: 25,
    fuelRemainingLiters: null,
    unknownSeverity: "moderate",
  })
  assert.equal(moderateUnknown.state, "warning")
  assert.equal(moderateUnknown.notes.includes("fuel_data_missing"), true)

  const veryUncertain = computeFuelGuarantee({
    carsAhead: 3,
    avgLitersPerCar: 25,
    requestedLiters: 25,
    fuelRemainingLiters: null,
    unknownSeverity: "very_uncertain",
  })
  assert.equal(veryUncertain.state, "none")
})

test("computeFuelGuarantee applies station ration cap when provided", () => {
  const uncapped = computeFuelGuarantee({
    carsAhead: 2,
    avgLitersPerCar: 50,
    requestedLiters: 80,
    fuelRemainingLiters: 250,
    fuelLastUpdatedAt: "2026-02-26T10:00:00.000Z",
    now: "2026-02-26T10:01:00.000Z",
  })
  assert.equal(uncapped.state, "critical")

  const capped = computeFuelGuarantee({
    carsAhead: 2,
    avgLitersPerCar: 50,
    requestedLiters: 80,
    maxLitersPerCarCap: 30,
    fuelRemainingLiters: 250,
    fuelLastUpdatedAt: "2026-02-26T10:00:00.000Z",
    now: "2026-02-26T10:01:00.000Z",
  })
  assert.equal(capped.state, "warning")
  assert.equal(capped.avgLitersPerCarUsed, 30)
  assert.equal(capped.requestedLitersUsed, 30)
  assert.equal(capped.notes.includes("ration_cap_applied"), true)
})

test("computeFuelGuarantee honors refill boost through effective fuel", () => {
  const boosted = computeFuelGuarantee({
    carsAhead: 2,
    avgLitersPerCar: 30,
    requestedLiters: 30,
    fuelRemainingLiters: 200,
    effectiveFuelLiters: 320,
    refillBoostApplied: true,
    fuelLastUpdatedAt: "2026-02-26T10:00:00.000Z",
    now: "2026-02-26T10:01:00.000Z",
    avgSource: "median_tx",
  })

  assert.equal(boosted.state, "safe")
  assert.equal(boosted.effectiveFuelLiters, 320)
  assert.equal(boosted.avgSource, "median_tx")
  assert.equal(boosted.notes.includes("refill_boost_applied"), true)
})

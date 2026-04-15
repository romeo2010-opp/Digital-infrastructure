import test from "node:test"
import assert from "node:assert/strict"
import { computeFuelTypeStatus, computeStationFuelStatuses } from "../modules/stations/fuelStatus.js"

test("computeFuelTypeStatus enforces unavailable and low boundaries", () => {
  assert.equal(
    computeFuelTypeStatus({
      enabled: false,
      remainingLiters: 1000,
      remainingPercent: 80,
      activeQueueCount: 0,
    }),
    "unavailable"
  )

  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: 0,
      remainingPercent: 0,
      activeQueueCount: 2,
    }),
    "unavailable"
  )

  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: 500,
      remainingPercent: 15,
      activeQueueCount: 0,
    }),
    "low"
  )

  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: 120,
      remainingPercent: 40,
      activeQueueCount: 0,
    }),
    "low"
  )
})

test("computeFuelTypeStatus returns in-use only when not low and queue is active", () => {
  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: 600,
      remainingPercent: 50,
      activeQueueCount: 4,
    }),
    "in-use"
  )

  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: 600,
      remainingPercent: 50,
      activeQueueCount: 0,
    }),
    "available"
  )
})

test("computeFuelTypeStatus is conservative when no telemetry is available", () => {
  assert.equal(
    computeFuelTypeStatus({
      enabled: true,
      remainingLiters: null,
      remainingPercent: null,
      activeQueueCount: 3,
    }),
    "unavailable"
  )
})

test("computeStationFuelStatuses includes defaults and consumes backend telemetry", () => {
  const statuses = computeStationFuelStatuses({
    settings: { petrol_enabled: 1, diesel_enabled: 1 },
    fuelRows: [
      { fuel_code: "PETROL", remaining_litres: 300, capacity_litres: 1000 },
      { fuel_code: "DIESEL", remaining_litres: 50, capacity_litres: 1000 },
      { fuel_code: "PREMIUM", remaining_litres: 600, capacity_litres: 1000 },
    ],
    queueRows: [
      { fuel_code: "PETROL", active_count: 3 },
      { fuel_code: "PREMIUM", active_count: 0 },
    ],
  })

  const byCode = new Map(statuses.map((item) => [item.code, item.status]))
  assert.equal(byCode.get("PETROL"), "in-use")
  assert.equal(byCode.get("DIESEL"), "low")
  assert.equal(byCode.get("PREMIUM"), "available")
})

test("computeStationFuelStatuses marks empty fuel as unavailable", () => {
  const statuses = computeStationFuelStatuses({
    settings: { petrol_enabled: 1, diesel_enabled: 1 },
    fuelRows: [
      { fuel_code: "PETROL", remaining_litres: 0, capacity_litres: 1000 },
      { fuel_code: "DIESEL", remaining_litres: 999, capacity_litres: 1000 },
    ],
    queueRows: [{ fuel_code: "PETROL", active_count: 5 }],
  })

  const byCode = new Map(statuses.map((item) => [item.code, item.status]))
  assert.equal(byCode.get("PETROL"), "unavailable")
  assert.equal(byCode.get("DIESEL"), "available")
})

test("computeStationFuelStatuses respects queue setting disablement", () => {
  const statuses = computeStationFuelStatuses({
    settings: { petrol_enabled: 0, diesel_enabled: 1 },
    fuelRows: [
      { fuel_code: "PETROL", remaining_litres: 999, capacity_litres: 1000 },
      { fuel_code: "DIESEL", remaining_litres: 999, capacity_litres: 1000 },
    ],
    queueRows: [],
  })

  const byCode = new Map(statuses.map((item) => [item.code, item.status]))
  assert.equal(byCode.get("PETROL"), "unavailable")
  assert.equal(byCode.get("DIESEL"), "available")
})

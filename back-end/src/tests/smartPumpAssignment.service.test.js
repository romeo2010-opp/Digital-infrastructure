import test from "node:test"
import assert from "node:assert/strict"
import {
  isFuelCompatible,
  isTankSideCompatible,
  scorePumpForVehicle,
} from "../modules/queue/smartPumpAssignmentService.js"

const vehicle = {
  vehicleType: "SUV",
  fuelType: "PETROL",
  tankSide: "DRIVER_SIDE",
}

function pump(overrides = {}) {
  return {
    id: "1",
    displayName: "SmartLink Pump 1",
    fuelTypesSupported: ["PETROL"],
    laneSideSupported: "DRIVER_SIDE",
    supportedVehicleTypes: ["SEDAN", "HATCHBACK", "SUV", "PICKUP"],
    maxVehicleSize: "LARGE",
    currentMode: "OPEN_WALKIN",
    isSmartlinkEnabled: true,
    isActive: true,
    activeQueueLoad: 0,
    etaMinutes: 0,
    ...overrides,
  }
}

test("scorePumpForVehicle prefers exact tank-side lanes over flexible lanes when load is equal", () => {
  const exact = scorePumpForVehicle(pump({ laneSideSupported: "DRIVER_SIDE" }), vehicle)
  const flexible = scorePumpForVehicle(pump({ laneSideSupported: "BOTH_SIDES" }), vehicle)

  assert.equal(exact.compatible, true)
  assert.equal(flexible.compatible, true)
  assert.ok(exact.score > flexible.score)
  assert.equal(exact.confidence, "HIGH")
})

test("scorePumpForVehicle treats unknown tank side as flexible/manual only", () => {
  const unknownSideVehicle = { ...vehicle, tankSide: "UNKNOWN" }

  assert.equal(isTankSideCompatible(pump({ laneSideSupported: "BOTH_SIDES" }), unknownSideVehicle), true)
  assert.equal(isTankSideCompatible(pump({ laneSideSupported: "MANUAL_ONLY" }), unknownSideVehicle), true)
  assert.equal(isTankSideCompatible(pump({ laneSideSupported: "DRIVER_SIDE" }), unknownSideVehicle), false)

  const driverOnlyScore = scorePumpForVehicle(pump({ laneSideSupported: "DRIVER_SIDE" }), unknownSideVehicle)
  assert.equal(driverOnlyScore.compatible, false)
  assert.ok(driverOnlyScore.reasons.includes("tank side incompatible"))
})

test("scorePumpForVehicle rejects incompatible fuel, vehicle size, and unavailable pump modes", () => {
  assert.equal(isFuelCompatible(pump({ fuelTypesSupported: ["DIESEL"] }), "PETROL"), false)
  assert.equal(scorePumpForVehicle(pump({ fuelTypesSupported: ["DIESEL"] }), vehicle).compatible, false)

  assert.equal(
    scorePumpForVehicle(pump({ maxVehicleSize: "MEDIUM" }), {
      ...vehicle,
      vehicleType: "TRUCK",
    }).compatible,
    false
  )

  assert.equal(scorePumpForVehicle(pump({ currentMode: "MAINTENANCE" }), vehicle).compatible, false)
  assert.equal(scorePumpForVehicle(pump({ isActive: false }), vehicle).compatible, false)
})

test("scorePumpForVehicle penalizes assigned queue load and ETA", () => {
  const lighter = scorePumpForVehicle(pump({ activeQueueLoad: 0, etaMinutes: 0 }), vehicle)
  const heavier = scorePumpForVehicle(pump({ activeQueueLoad: 3, etaMinutes: 15 }), vehicle)

  assert.equal(lighter.compatible, true)
  assert.equal(heavier.compatible, true)
  assert.ok(lighter.score > heavier.score)
})

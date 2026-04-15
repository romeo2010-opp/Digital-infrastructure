import test from "node:test"
import assert from "node:assert/strict"
import {
  nozzleCreateSchema,
  nozzlePatchSchema,
  pumpCreateSchema,
  stationPatchSchema,
  userPreferencesPatchSchema,
} from "../modules/settings/settings.schemas.js"

test("pumpCreateSchema accepts multiple nozzles for one dispenser", () => {
  const payload = {
    pumpNumber: 4,
    quickSetup: "MALAWI_4_NOZZLES",
    nozzles: [
      { nozzleNumber: 1, side: "A", fuelType: "PETROL", status: "ACTIVE" },
      { nozzleNumber: 2, side: "A", fuelType: "PETROL", status: "ACTIVE" },
      { nozzleNumber: 3, side: "B", fuelType: "DIESEL", status: "ACTIVE" },
      { nozzleNumber: 4, side: "B", fuelType: "DIESEL", status: "ACTIVE" },
    ],
  }
  const parsed = pumpCreateSchema.parse(payload)
  assert.equal(parsed.nozzles.length, 4)
  assert.equal(parsed.nozzles[3].fuelType, "DIESEL")
})

test("nozzleCreateSchema rejects missing fuel type", () => {
  assert.throws(() => {
    nozzleCreateSchema.parse({
      nozzleNumber: 1,
      side: "A",
    })
  })
})

test("nozzle schemas accept string nozzle numbers", () => {
  const created = nozzleCreateSchema.parse({
    nozzleNumber: "A-01",
    side: "A",
    fuelType: "PETROL",
  })
  assert.equal(created.nozzleNumber, "A-01")

  const patched = nozzlePatchSchema.parse({
    nozzleNumber: "PX-LEFT-2",
  })
  assert.equal(patched.nozzleNumber, "PX-LEFT-2")
})

test("stationPatchSchema accepts database-backed fuel prices", () => {
  const parsed = stationPatchSchema.parse({
    fuel_prices: [
      { label: "PETROL", pricePerLitre: 2680 },
      { label: "PREMIUM", pricePerLitre: 2760.5 },
    ],
  })

  assert.equal(parsed.fuel_prices.length, 2)
  assert.equal(parsed.fuel_prices[1].label, "PREMIUM")
})

test("userPreferencesPatchSchema accepts favorite station ids", () => {
  const parsed = userPreferencesPatchSchema.parse({
    favoriteStationPublicIds: ["SL-MW-BLNT-0001", "SL-MW-BLNT-0002"],
  })

  assert.equal(parsed.favoriteStationPublicIds.length, 2)
  assert.equal(parsed.favoriteStationPublicIds[0], "SL-MW-BLNT-0001")
})

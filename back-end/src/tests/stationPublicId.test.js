import test from "node:test"
import assert from "node:assert/strict"
import { createStationPublicIdValue, resolveStationCityCode } from "../modules/common/db.js"

test("resolveStationCityCode uses configured SmartLink city mappings", () => {
  assert.equal(resolveStationCityCode("Blantyre"), "BLNT")
  assert.equal(resolveStationCityCode("Lilongwe"), "LLWE")
  assert.equal(resolveStationCityCode("Mzuzu"), "MZZU")
  assert.equal(resolveStationCityCode("Zomba"), "ZMBA")
  assert.equal(resolveStationCityCode("Kasungu"), "KSGU")
  assert.equal(resolveStationCityCode("Lusaka"), "LSKA")
})

test("createStationPublicIdValue formats station public ids as SL-country-city-random", () => {
  const publicId = createStationPublicIdValue({
    countryCode: "MW",
    city: "Blantyre",
    randomDigits: "4821",
  })

  assert.equal(publicId, "SL-MW-BLNT-4821")
})


import test from "node:test"
import assert from "node:assert/strict"
import { normalizeVehiclePlate } from "../modules/vehicles/service.js"

test("normalizeVehiclePlate trims, collapses spaces, uppercases, and preserves safe separators", () => {
  assert.equal(normalizeVehiclePlate("  bt   1234-mw  "), "BT 1234-MW")
})

test("normalizeVehiclePlate rejects empty and unsafe plate values without enforcing one Malawi format", () => {
  assert.throws(
    () => normalizeVehiclePlate("   "),
    (error) => error?.status === 400 && error?.message === "Number plate is required."
  )

  assert.throws(
    () => normalizeVehiclePlate("BT/1234"),
    (error) =>
      error?.status === 400 &&
      error?.message === "Number plate can only contain letters, numbers, spaces, and hyphens."
  )
})

test("normalizeVehiclePlate caps long values at the stored plate length", () => {
  const normalized = normalizeVehiclePlate("AB 1234 CDEFGHIJKLMNOPQRSTUVWXYZ999999")

  assert.equal(normalized.length, 32)
  assert.equal(normalized, "AB 1234 CDEFGHIJKLMNOPQRSTUVWXYZ")
})

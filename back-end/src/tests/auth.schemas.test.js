import test from "node:test"
import assert from "node:assert/strict"
import { updateProfileSchema } from "../modules/auth/auth.schemas.js"

test("updateProfileSchema accepts partial identity updates", () => {
  const payload = updateProfileSchema.parse({
    fullName: "Jane Doe",
    email: "jane@example.com",
  })

  assert.equal(payload.fullName, "Jane Doe")
  assert.equal(payload.email, "jane@example.com")
})

test("updateProfileSchema requires at least one field", () => {
  assert.throws(() => {
    updateProfileSchema.parse({})
  }, /at least one profile field is required/i)
})

test("updateProfileSchema allows clearing optional contact fields", () => {
  const payload = updateProfileSchema.parse({
    phone: "",
    email: "",
  })

  assert.equal(payload.phone, "")
  assert.equal(payload.email, "")
})

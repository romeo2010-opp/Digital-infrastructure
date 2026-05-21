import test from "node:test"
import assert from "node:assert/strict"
import {
  generateMeraLoginCode,
  getMeraLoginCodeMaxAttempts,
  hashMeraLoginSecret,
  maskMeraEmail,
} from "../modules/mera/services/auth.service.js"
import { buildMeraLoginCodeEmail } from "../modules/mera/services/email.service.js"

test("MERA login code generation returns six numeric digits", () => {
  for (let index = 0; index < 20; index += 1) {
    assert.match(generateMeraLoginCode(), /^\d{6}$/)
  }
})

test("MERA login code hashing is stable and does not store the plain secret", () => {
  const hash = hashMeraLoginSecret("123456")

  assert.equal(hash, hashMeraLoginSecret("123456"))
  assert.notEqual(hash, "123456")
  assert.match(hash, /^[a-f0-9]{64}$/)
})

test("MERA email masking keeps addresses recognizable without revealing them", () => {
  assert.equal(maskMeraEmail("officer@example.com"), "of****@ex****.com")
  assert.equal(maskMeraEmail("a@mw.org"), "a*@m*.org")
  assert.equal(maskMeraEmail("not-an-email"), "your email address")
})

test("MERA login code max attempts defaults to five and honors env override", () => {
  const original = process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS

  try {
    delete process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS
    assert.equal(getMeraLoginCodeMaxAttempts(), 5)

    process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS = "3"
    assert.equal(getMeraLoginCodeMaxAttempts(), 3)

    process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS = "0"
    assert.equal(getMeraLoginCodeMaxAttempts(), 1)
  } finally {
    if (original === undefined) delete process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS
    else process.env.MERA_LOGIN_CODE_MAX_ATTEMPTS = original
  }
})

test("MERA login code email includes the code and stable subject", () => {
  const message = buildMeraLoginCodeEmail({
    code: "654321",
    expiresAt: new Date("2026-05-20T10:15:00Z"),
    fullName: "Regulator User",
  })

  assert.equal(message.subject, "Your MERA portal login code")
  assert.match(message.text, /654321/)
  assert.match(message.html, /654321/)
  assert.match(message.text, /Regulator User/)
})

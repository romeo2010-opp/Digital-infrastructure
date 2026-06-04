import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveMeraIpSubnet,
  generateMeraLoginCode,
  getMeraAuthLockoutPolicy,
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

test("MERA auth lockout policy defaults to failure-aware thresholds", () => {
  const original = {
    MERA_AUTH_MAX_FAILED_ATTEMPTS: process.env.MERA_AUTH_MAX_FAILED_ATTEMPTS,
    MERA_AUTH_IP_MAX_FAILED_ATTEMPTS: process.env.MERA_AUTH_IP_MAX_FAILED_ATTEMPTS,
    MERA_AUTH_SUBNET_FLAG_FAILED_ATTEMPTS: process.env.MERA_AUTH_SUBNET_FLAG_FAILED_ATTEMPTS,
    MERA_AUTH_FAILURE_WINDOW_MIN: process.env.MERA_AUTH_FAILURE_WINDOW_MIN,
    MERA_AUTH_LOCKOUT_MIN: process.env.MERA_AUTH_LOCKOUT_MIN,
  }

  try {
    delete process.env.MERA_AUTH_MAX_FAILED_ATTEMPTS
    delete process.env.MERA_AUTH_IP_MAX_FAILED_ATTEMPTS
    delete process.env.MERA_AUTH_SUBNET_FLAG_FAILED_ATTEMPTS
    delete process.env.MERA_AUTH_FAILURE_WINDOW_MIN
    delete process.env.MERA_AUTH_LOCKOUT_MIN
    assert.deepEqual(getMeraAuthLockoutPolicy(), {
      maxFailedAttempts: 5,
      ipMaxFailedAttempts: 10,
      subnetFlagFailedAttempts: 10,
      failureWindowMinutes: 15,
      lockoutMinutes: 15,
    })

    process.env.MERA_AUTH_MAX_FAILED_ATTEMPTS = "4"
    process.env.MERA_AUTH_IP_MAX_FAILED_ATTEMPTS = "8"
    process.env.MERA_AUTH_SUBNET_FLAG_FAILED_ATTEMPTS = "12"
    process.env.MERA_AUTH_FAILURE_WINDOW_MIN = "20"
    process.env.MERA_AUTH_LOCKOUT_MIN = "30"
    assert.deepEqual(getMeraAuthLockoutPolicy(), {
      maxFailedAttempts: 4,
      ipMaxFailedAttempts: 8,
      subnetFlagFailedAttempts: 12,
      failureWindowMinutes: 20,
      lockoutMinutes: 30,
    })
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test("MERA auth derives stable IP subnets for risk flagging", () => {
  assert.equal(deriveMeraIpSubnet("203.0.113.42"), "203.0.113.0/24")
  assert.equal(deriveMeraIpSubnet("::ffff:203.0.113.42"), "203.0.113.0/24")
  assert.equal(deriveMeraIpSubnet("2001:db8:abcd:1234::9"), "2001:0db8:abcd:1234::/64")
  assert.equal(deriveMeraIpSubnet("not-an-ip"), null)
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

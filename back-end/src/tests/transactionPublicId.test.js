import test from "node:test"
import assert from "node:assert/strict"
import { createTransactionPublicIdValue } from "../modules/common/db.js"

test("createTransactionPublicIdValue formats transaction ids as TXN-TYPE-TIMESTAMP-RANDOM", () => {
  const originalTimeZone = process.env.APP_TIME_ZONE
  process.env.APP_TIME_ZONE = "Africa/Blantyre"

  try {
  const publicId = createTransactionPublicIdValue({
    typeCode: "PAY",
    timestamp: new Date("2026-03-07T08:09:10.123Z"),
    randomSuffix: "Q2W5N9",
  })

  assert.equal(publicId, "TXN-PAY-20260307100910123-Q2W5N9")
  } finally {
    if (typeof originalTimeZone === "string") {
      process.env.APP_TIME_ZONE = originalTimeZone
    } else {
      delete process.env.APP_TIME_ZONE
    }
  }
})

test("createTransactionPublicIdValue accepts the supported transaction type codes", () => {
  const originalTimeZone = process.env.APP_TIME_ZONE
  process.env.APP_TIME_ZONE = "Africa/Blantyre"

  try {
    const supported = ["PAY", "TOP", "REF", "RES", "SUB", "SET", "ADJ"]
    for (const typeCode of supported) {
      const publicId = createTransactionPublicIdValue({
        typeCode,
        timestamp: new Date("2026-03-07T08:09:10.123Z"),
        randomSuffix: "A1B2C3",
      })
      assert.equal(publicId.startsWith(`TXN-${typeCode}-20260307100910123-`), true)
    }
  } finally {
    if (typeof originalTimeZone === "string") {
      process.env.APP_TIME_ZONE = originalTimeZone
    } else {
      delete process.env.APP_TIME_ZONE
    }
  }
})

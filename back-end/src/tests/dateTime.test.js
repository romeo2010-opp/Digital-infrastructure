import test from "node:test"
import assert from "node:assert/strict"
import { formatDateTimeSqlInTimeZone } from "../utils/dateTime.js"

test("formatDateTimeSqlInTimeZone uses 00 hour at midnight, never 24", () => {
  const originalTimeZone = process.env.APP_TIME_ZONE
  process.env.APP_TIME_ZONE = "Africa/Blantyre"

  try {
    const midnightUtc = new Date("2026-02-28T22:00:00.000Z")
    const formatted = formatDateTimeSqlInTimeZone(midnightUtc)
    assert.equal(formatted, "2026-03-01 00:00:00.000")
    assert.equal(formatted.includes(" 24:"), false)
  } finally {
    if (typeof originalTimeZone === "string") {
      process.env.APP_TIME_ZONE = originalTimeZone
    } else {
      delete process.env.APP_TIME_ZONE
    }
  }
})

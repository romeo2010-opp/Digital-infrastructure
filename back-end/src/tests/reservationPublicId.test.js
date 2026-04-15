import test from "node:test"
import assert from "node:assert/strict"
import { createReservationPublicIdValue } from "../modules/common/db.js"
import {
  isQueueShadowReservationPublicId,
  syncReservationFromQueueEntryById,
  syncReservationFromQueueEntryByPublicId,
} from "../modules/common/reservations.js"

test("createReservationPublicIdValue formats reservation ids as RSV-TYPE-TIMESTAMP-RANDOM", () => {
  const originalTimeZone = process.env.APP_TIME_ZONE
  process.env.APP_TIME_ZONE = "Africa/Blantyre"

  try {
    const publicId = createReservationPublicIdValue({
      typeCode: "SLT",
      timestamp: new Date("2026-03-07T12:30:22.000Z"),
      randomSuffix: "K4M9P2",
    })

    assert.equal(publicId, "RSV-SLT-20260307143022-K4M9P2")
  } finally {
    if (typeof originalTimeZone === "string") {
      process.env.APP_TIME_ZONE = originalTimeZone
    } else {
      delete process.env.APP_TIME_ZONE
    }
  }
})

test("createReservationPublicIdValue accepts supported reservation type codes", () => {
  const supported = ["QUE", "SLT", "PRE", "FLT"]
  for (const typeCode of supported) {
    const publicId = createReservationPublicIdValue({
      typeCode,
      timestamp: new Date("2026-03-07T07:15:44.000Z"),
      timeZone: "Africa/Blantyre",
      randomSuffix: "B7R3N1",
    })
    assert.equal(publicId.startsWith(`RSV-${typeCode}-20260307091544-`), true)
  }
})

test("isQueueShadowReservationPublicId matches queue-synced shadow reservations only", () => {
  assert.equal(isQueueShadowReservationPublicId("RSV-QUE-20260307091544-B7R3N1"), true)
  assert.equal(isQueueShadowReservationPublicId("RSV-SLT-20260307091544-B7R3N1"), false)
  assert.equal(isQueueShadowReservationPublicId(""), false)
})

test("queue sync helpers no longer create reservation shadows", async () => {
  assert.equal(await syncReservationFromQueueEntryById(44), null)
  assert.equal(await syncReservationFromQueueEntryByPublicId("01QUEUEPUBLICID000000000000"), null)
})

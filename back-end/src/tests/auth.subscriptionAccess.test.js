import test from "node:test"
import assert from "node:assert/strict"
import { evaluateStationSubscriptionAccess } from "../modules/auth/stationSubscriptionAccess.js"

test("evaluateStationSubscriptionAccess allows active subscriptions within renewal window", () => {
  const result = evaluateStationSubscriptionAccess(
    {
      station_name: "Limbe Station",
      timezone: "Africa/Blantyre",
      status: "ACTIVE",
      renewal_date: "2026-03-31",
    },
    {
      now: new Date("2026-03-10T08:00:00.000Z"),
    }
  )

  assert.equal(result.allowed, true)
  assert.equal(result.message, null)
})

test("evaluateStationSubscriptionAccess blocks expired renewal dates", () => {
  const result = evaluateStationSubscriptionAccess(
    {
      station_name: "Chichiri Station",
      timezone: "Africa/Blantyre",
      status: "ACTIVE",
      renewal_date: "2026-02-28",
    },
    {
      now: new Date("2026-03-10T08:00:00.000Z"),
    }
  )

  assert.equal(result.allowed, false)
  assert.match(result.message, /expired on 2026-02-28/i)
})

test("evaluateStationSubscriptionAccess blocks paused subscriptions even before renewal date", () => {
  const result = evaluateStationSubscriptionAccess(
    {
      station_name: "Mchesi Station",
      timezone: "Africa/Blantyre",
      status: "PAUSED",
      renewal_date: "2026-03-31",
    },
    {
      now: new Date("2026-03-10T08:00:00.000Z"),
    }
  )

  assert.equal(result.allowed, false)
  assert.match(result.message, /is paused/i)
})

test("evaluateStationSubscriptionAccess allows stations without configured subscription data", () => {
  const result = evaluateStationSubscriptionAccess({
    station_name: "New Station",
    timezone: "Africa/Blantyre",
    status: null,
    renewal_date: null,
  })

  assert.equal(result.allowed, false)
  assert.match(result.message, /not configured/i)
})

test("evaluateStationSubscriptionAccess blocks missing subscription rows", () => {
  const result = evaluateStationSubscriptionAccess(null)

  assert.equal(result.allowed, false)
  assert.match(result.message, /does not have an active subscription setup/i)
})

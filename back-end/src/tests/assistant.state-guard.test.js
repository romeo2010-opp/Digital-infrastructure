import test from "node:test"
import assert from "node:assert/strict"
import {
  looksLikeReservationIdentifier,
  shouldKeepAssistantStateForMessage,
} from "../modules/assistant/service.js"

test("state guard does not continue a reservation flow for simple greetings", () => {
  const shouldKeep = shouldKeepAssistantStateForMessage({
    state: {
      goal: "make_reservation",
      step: "select_slot",
      params: {},
    },
    parsedIntent: {
      intent: null,
      params: {
        fuelType: null,
        litres: null,
        bookingKind: null,
        requestedTime: null,
        wantsNow: false,
        wantsLater: false,
        isGreeting: true,
      },
    },
    text: "hey",
    resolvedStation: null,
  })

  assert.equal(shouldKeep, false)
})

test("reservation identifier guard rejects generic greetings and accepts plate-like values", () => {
  assert.equal(looksLikeReservationIdentifier("hey"), false)
  assert.equal(looksLikeReservationIdentifier("BP 1234"), true)
  assert.equal(looksLikeReservationIdentifier("MZ-A123"), true)
})

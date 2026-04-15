import test from "node:test"
import assert from "node:assert/strict"
import {
  getAssistantStarterPrompts,
  parseAssistantIntent,
} from "../modules/assistant/intent-parser.js"

test("assistant intent parser maps v1 starter prompts", () => {
  assert.equal(parseAssistantIntent("Find fuel near me").intent, "find_fuel_nearby")
  assert.equal(parseAssistantIntent("What is a digital queue?").intent, "explain_queue")
  assert.equal(parseAssistantIntent("Queue or reservation?").intent, "compare_queue_reservation")
  assert.equal(parseAssistantIntent("Join fastest queue").intent, "join_fastest_queue")
  assert.equal(parseAssistantIntent("Reserve fuel for later").intent, "make_reservation")
  assert.equal(parseAssistantIntent("Check my booking").intent, "check_booking")
  assert.equal(parseAssistantIntent("Check wallet").intent, "wallet_summary")
})

test("assistant intent parser extracts structured params from short user text", () => {
  const parsed = parseAssistantIntent("I need 20 litres of diesel near me")

  assert.equal(parsed.intent, "find_fuel_nearby")
  assert.equal(parsed.params.fuelType, "DIESEL")
  assert.equal(parsed.params.litres, 20)
})

test("assistant intent parser understands natural statements for queue and reservation flows", () => {
  assert.equal(
    parseAssistantIntent("I need diesel now").intent,
    "join_fastest_queue"
  )
  assert.equal(
    parseAssistantIntent("Book 30 litres of petrol for later").intent,
    "make_reservation"
  )
  assert.equal(
    parseAssistantIntent("Show my current reservation").intent,
    "check_booking"
  )
  assert.equal(
    parseAssistantIntent("Leave my queue").intent,
    "cancel_booking"
  )
})

test("assistant intent parser treats time-based fuel requests as planned reservation flows", () => {
  const parsed = parseAssistantIntent("I need to fuel at 15:30 pm which station should I go to?")

  assert.equal(parsed.intent, "make_reservation")
  assert.equal(parsed.params.requestedTime, "15:30")
  assert.equal(parsed.params.wantsLater, true)
})

test("assistant starter prompts stay aligned with the product entry chips", () => {
  assert.deepEqual(getAssistantStarterPrompts(), [
    "Find fuel near me",
    "What is a digital queue?",
    "Queue or reservation?",
    "Join fastest queue",
    "Reserve fuel for later",
    "Check my booking",
    "Check wallet",
  ])
})

test("assistant intent parser flags simple greetings without forcing a workflow intent", () => {
  const parsed = parseAssistantIntent("hey")

  assert.equal(parsed.intent, null)
  assert.equal(parsed.params.isGreeting, true)
})

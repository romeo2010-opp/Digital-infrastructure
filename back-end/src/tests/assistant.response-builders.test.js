import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAssistantResponse,
  buildConfirmAction,
  buildPromptAction,
  buildResetAction,
  buildRespondAction,
  buildWelcomeResponse,
} from "../modules/assistant/response-builders.js"

test("assistant response builder keeps the structured response contract stable", () => {
  const response = buildAssistantResponse({
    type: "confirmation",
    title: "Confirm Queue Join",
    message: "Before I join this queue, please confirm.",
    data: { queueJoinId: "01QUEUE" },
    cards: [{ kind: "confirmation" }],
    actions: [buildConfirmAction({ confirmationToken: "token-1" })],
    suggestions: [buildPromptAction("Check my booking")],
    requiresConfirmation: true,
    confirmationToken: "token-1",
    errorCode: "none",
  })

  assert.equal(response.type, "confirmation")
  assert.equal(response.title, "Confirm Queue Join")
  assert.equal(response.requiresConfirmation, true)
  assert.equal(response.confirmationToken, "token-1")
  assert.deepEqual(response.data, { queueJoinId: "01QUEUE" })
  assert.equal(response.cards.length, 1)
  assert.equal(response.actions[0].kind, "confirm")
  assert.equal(response.suggestions[0].kind, "prompt")
})

test("assistant action builders produce stable declarative action objects", () => {
  assert.deepEqual(buildRespondAction({
    id: "assistant.choose_fuel_type",
    label: "Petrol",
    payload: { fuelType: "PETROL" },
    tone: "primary",
  }), {
    id: "assistant.choose_fuel_type",
    label: "Petrol",
    kind: "respond",
    payload: { fuelType: "PETROL" },
    tone: "primary",
  })

  assert.deepEqual(buildResetAction("Cancel"), {
    id: "assistant.reset",
    label: "Cancel",
    kind: "respond",
    payload: {},
    tone: "secondary",
  })
})

test("welcome response exposes starter prompt suggestions for the frontend chips", () => {
  const response = buildWelcomeResponse()

  assert.equal(response.type, "question")
  assert.equal(response.title, "SmartLink Assistant")
  assert.equal(response.suggestions.length, 7)
  assert.equal(response.suggestions[0].kind, "prompt")
})

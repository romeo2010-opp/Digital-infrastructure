import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAssistantKnowledgeResponse,
  matchAssistantKnowledge,
} from "../modules/assistant/knowledge-base.js"

test("assistant knowledge matches curated SmartLink help content", () => {
  const greeting = matchAssistantKnowledge("hey")
  const about = matchAssistantKnowledge("what is smartlink")
  const founder = matchAssistantKnowledge("who is behind smartlink")

  assert.equal(greeting?.id, "greeting")
  assert.equal(about?.id, "about_smartlink")
  assert.equal(founder?.id, "founder")
})

test("assistant knowledge response keeps suggestions product-scoped", () => {
  const entry = matchAssistantKnowledge("what can you do")
  const response = buildAssistantKnowledgeResponse(entry, {
    currentState: {
      goal: "make_reservation",
    },
  })

  assert.equal(response.type, "explainer")
  assert.equal(response.actions[0].id, "assistant.continue")
  assert.equal(response.suggestions.length > 0, true)
})

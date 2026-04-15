import test from "node:test"
import assert from "node:assert/strict"
import jwt from "jsonwebtoken"
import { confirmAssistantAction } from "../modules/assistant/service.js"

function signAssistantConfirmationToken(payload) {
  process.env.JWT_ACCESS_SECRET = "assistant-test-secret"
  return jwt.sign(payload, `${process.env.JWT_ACCESS_SECRET}:assistant`, {
    expiresIn: "10m",
  })
}

test("assistant confirm returns a safe error response for unsupported actions", async () => {
  const confirmationToken = signAssistantConfirmationToken({
    typ: "assistant_confirm",
    uid: 41,
    sid: "sess-assistant-1",
    actionType: "unsupported_action",
    intent: "check_booking",
    params: {},
  })

  const payload = await confirmAssistantAction({
    auth: {
      userId: 41,
      sessionPublicId: "sess-assistant-1",
    },
    confirmationToken,
  })

  assert.equal(payload.session, null)
  assert.equal(payload.response.type, "error")
  assert.match(payload.response.message, /not supported/i)
})

test("assistant confirm rejects tokens that belong to another user", async () => {
  const confirmationToken = signAssistantConfirmationToken({
    typ: "assistant_confirm",
    uid: 77,
    sid: "sess-assistant-2",
    actionType: "unsupported_action",
    intent: "check_booking",
    params: {},
  })

  await assert.rejects(
    async () =>
      confirmAssistantAction({
        auth: {
          userId: 12,
          sessionPublicId: "sess-assistant-2",
        },
        confirmationToken,
      }),
    /does not belong to this user/i
  )
})

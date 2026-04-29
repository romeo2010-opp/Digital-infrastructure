import test from "node:test"
import assert from "node:assert/strict"
import {
  buildTwilioEventsWebhookUrl,
  buildTwilioTwimlWebhookUrl,
  isTwilioVoiceConfigured,
} from "../modules/assistant/twilio-voice.service.js"

test("twilio twiml webhook uses the public base url", () => {
  process.env.PUBLIC_BASE_URL = "https://api.smartlink.example"

  assert.equal(
    buildTwilioTwimlWebhookUrl("sub-live-1"),
    "https://api.smartlink.example/twilio/voice/live-queue/twiml?subscriptionPublicId=sub-live-1"
  )
})

test("twilio events webhook uses the public base url", () => {
  process.env.PUBLIC_BASE_URL = "https://api.smartlink.example"

  assert.equal(
    buildTwilioEventsWebhookUrl("sub-live-1"),
    "https://api.smartlink.example/twilio/voice/live-queue/events?subscriptionPublicId=sub-live-1"
  )
})

test("twilio voice configuration requires the sid auth token number and base url", () => {
  process.env.TWILIO_ACCOUNT_SID = "AC123"
  process.env.TWILIO_AUTH_TOKEN = "secret"
  process.env.TWILIO_PHONE_NUMBER = "+15550001111"
  process.env.PUBLIC_BASE_URL = "https://api.smartlink.example"

  assert.equal(isTwilioVoiceConfigured(), true)

  process.env.TWILIO_AUTH_TOKEN = ""
  assert.equal(isTwilioVoiceConfigured(), false)
})

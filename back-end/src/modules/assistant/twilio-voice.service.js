import twilio from "twilio"
import { badRequest } from "../../utils/http.js"
import { buildUserQueueStatusSnapshot } from "../userQueue/service.js"
import {
  buildVoiceUpdateScript,
  deactivateSubscriptionByPublicId,
  getQueueLiveUpdateSubscriptionByPublicId,
  normalizeLiveUpdateLanguage,
  recordQueueLiveUpdateProviderReference,
  updateQueueLiveUpdateSubscriptionLanguage,
} from "./live-updates.service.js"

let cachedClient = null

function env(name) {
  return String(process.env[name] || "").trim()
}

function buildAbsoluteUrl(pathname) {
  const baseUrl = env("PUBLIC_BASE_URL").replace(/\/+$/, "")
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`
}

function buildRequestValidationUrl(req) {
  return buildAbsoluteUrl(req.originalUrl || req.url || "")
}

function twilioVoiceId() {
  return env("TWILIO_VOICE") || "alice"
}

function holdMusicUrl() {
  return env("TWILIO_QUEUE_HOLD_MUSIC_URL") || ""
}

function normalizeDigits(value) {
  return String(value || "").replace(/\s+/g, "").trim()
}

function isWebhookValidationDisabled() {
  return String(process.env.TWILIO_VALIDATE_WEBHOOKS || "true").trim().toLowerCase() === "false"
}

function getTwilioClient() {
  if (cachedClient) return cachedClient
  const accountSid = env("TWILIO_ACCOUNT_SID")
  const authToken = env("TWILIO_AUTH_TOKEN")
  if (!accountSid || !authToken) {
    throw badRequest("Twilio voice is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first.")
  }
  cachedClient = twilio(accountSid, authToken)
  return cachedClient
}

function buildVoiceResponse() {
  return new twilio.twiml.VoiceResponse()
}

function appendSay(target, text) {
  target.say(
    {
      voice: twilioVoiceId(),
      language: "en-US",
    },
    text,
  )
}

async function buildLiveUpdateContext(subscriptionPublicId) {
  const subscription = await getQueueLiveUpdateSubscriptionByPublicId(subscriptionPublicId)
  if (!subscription?.publicId || !subscription.isActive) {
    throw badRequest("Live update subscription is no longer active.")
  }

  const snapshot = await buildUserQueueStatusSnapshot({
    queueJoinId: subscription.queueJoinId,
    auth: {
      userId: subscription.userId,
    },
  })

  return {
    subscription,
    snapshot,
  }
}

function resolveSubscriptionPublicId(req) {
  return String(req.query?.subscriptionPublicId || req.body?.subscriptionPublicId || "").trim()
}

function buildControlPrompt(languageCode) {
  if (normalizeLiveUpdateLanguage(languageCode) === "ny") {
    return "Dinani 1 kuti mubwereze uthenga. Dinani 2 pa English. Dinani 3 pa Chichewa. Dinani 9 kuti musiye live updates."
  }
  return "Press 1 to repeat this update. Press 2 for English. Press 3 for Chichewa. Press 9 to stop live updates."
}

function renderGatherResponse({ subscription, snapshot }) {
  const response = buildVoiceResponse()
  const gather = response.gather({
    action: buildTwilioEventsWebhookUrl(subscription.publicId),
    method: "POST",
    numDigits: 1,
    timeout: 5,
  })
  const script = buildVoiceUpdateScript({
    snapshot,
    previousPosition: subscription?.lastKnownPosition ?? null,
    languageCode: subscription?.languageCode || "en",
  })

  appendSay(gather, `${script.previewText} ${buildControlPrompt(subscription?.languageCode)}`)
  response.redirect(
    {
      method: "POST",
    },
    buildTwilioEventsWebhookUrl(subscription.publicId),
  )
  return response.toString()
}

function renderPlaybackThenHangupResponse(subscription) {
  const response = buildVoiceResponse()
  const musicUrl = holdMusicUrl()

  if (musicUrl && subscription?.playMusicBetweenUpdates) {
    response.play(musicUrl)
  }

  response.hangup()
  return response.toString()
}

export function buildTwilioTwimlWebhookUrl(subscriptionPublicId) {
  const params = new URLSearchParams({
    subscriptionPublicId,
  })
  return `${buildAbsoluteUrl("/twilio/voice/live-queue/twiml")}?${params.toString()}`
}

export function buildTwilioEventsWebhookUrl(subscriptionPublicId) {
  const params = new URLSearchParams({
    subscriptionPublicId,
  })
  return `${buildAbsoluteUrl("/twilio/voice/live-queue/events")}?${params.toString()}`
}

export function isTwilioVoiceConfigured() {
  return Boolean(
    env("TWILIO_ACCOUNT_SID") &&
    env("TWILIO_AUTH_TOKEN") &&
    env("TWILIO_PHONE_NUMBER") &&
    env("PUBLIC_BASE_URL")
  )
}

export function validateTwilioWebhookRequest(req) {
  if (isWebhookValidationDisabled()) return true

  const authToken = env("TWILIO_AUTH_TOKEN")
  const signature = String(req.headers["x-twilio-signature"] || "").trim()
  const url = buildRequestValidationUrl(req)
  const params = req.body || {}

  if (!authToken || !signature || !url) {
    throw badRequest("Invalid Twilio webhook signature.")
  }

  const isValid = twilio.validateRequest(authToken, signature, url, params)
  if (!isValid) {
    throw badRequest("Invalid Twilio webhook signature.")
  }

  return true
}

export async function placeTwilioLiveUpdateCall({ subscription, snapshot } = {}) {
  if (!isTwilioVoiceConfigured()) {
    throw badRequest(
      "Twilio voice is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and PUBLIC_BASE_URL."
    )
  }

  const response = await getTwilioClient().calls.create({
    to: subscription.phoneNumber,
    from: env("TWILIO_PHONE_NUMBER"),
    url: buildTwilioTwimlWebhookUrl(subscription.publicId),
    method: "POST",
  })

  const providerReference = String(response?.sid || "").trim() || null
  if (providerReference) {
    await recordQueueLiveUpdateProviderReference({
      subscriptionPublicId: subscription.publicId,
      providerReference,
    })
  }

  const script = buildVoiceUpdateScript({
    snapshot,
    previousPosition: subscription?.lastKnownPosition ?? null,
    languageCode: subscription?.languageCode || "en",
  })

  return {
    providerReference,
    previewText: script.previewText,
    shouldPlayMusic: Boolean(script.shouldPlayMusic && holdMusicUrl()),
    shouldCallToStation: script.shouldCallToStation,
  }
}

export async function buildTwilioVoiceResponse({ kind, req } = {}) {
  const subscriptionPublicId = resolveSubscriptionPublicId(req)
  if (!subscriptionPublicId) {
    throw badRequest("Missing live update subscription.")
  }

  const context = await buildLiveUpdateContext(subscriptionPublicId)

  if (kind === "twiml") {
    return renderGatherResponse(context)
  }

  const digits = normalizeDigits(req.body?.Digits || "")
  if (digits === "9") {
    await deactivateSubscriptionByPublicId(context.subscription.publicId)
    const response = buildVoiceResponse()
    appendSay(response, "Live queue updates have been stopped.")
    response.hangup()
    return response.toString()
  }

  if (digits === "2" || digits === "3") {
    const nextLanguageCode = digits === "3" ? "ny" : "en"
    const updatedSubscription = await updateQueueLiveUpdateSubscriptionLanguage({
      subscriptionPublicId: context.subscription.publicId,
      languageCode: nextLanguageCode,
    })
    const nextSnapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: updatedSubscription.queueJoinId,
      auth: {
        userId: updatedSubscription.userId,
      },
    })
    return renderGatherResponse({
      subscription: updatedSubscription,
      snapshot: nextSnapshot,
    })
  }

  if (digits === "1") {
    return renderGatherResponse(context)
  }

  return renderPlaybackThenHangupResponse(context.subscription)
}

import twilio from "twilio"
import { spawn } from "node:child_process"
import { badRequest } from "../../utils/http.js"
import { buildUserQueueStatusSnapshot } from "../userQueue/service.js"
import {
  buildVoiceUpdateScript,
  deactivateSubscriptionByPublicId,
  getQueueLiveUpdateSubscriptionByPublicId,
  normalizeLiveUpdateLanguage,
  recordQueueLiveUpdateProviderReference,
  updateQueueLiveUpdateSubscriptionMetadata,
  updateQueueLiveUpdateSubscriptionLanguage,
} from "./live-updates.service.js"

let cachedClient = null
const cachedAudioDurations = new Map()

function env(name) {
  return String(process.env[name] || "").trim()
}

function maskPhoneNumber(value) {
  const digits = String(value || "").replace(/\D+/g, "")
  if (!digits) return null
  if (digits.length <= 4) return digits
  return `***${digits.slice(-4)}`
}

function summarizeTwilioError(error) {
  if (!error) return { message: "Unknown Twilio error" }
  return {
    message: String(error.message || "Unknown Twilio error"),
    code: error.code ?? null,
    status: error.status ?? null,
    moreInfo: error.moreInfo ?? error.more_info ?? null,
    details: error.details ?? null,
  }
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

function twilioLanguageCode() {
  return env("TWILIO_TTS_LANGUAGE") || "en-US"
}

function holdMusicUrl() {
  return env("TWILIO_QUEUE_HOLD_MUSIC_URL") || ""
}

function resumeMusicEnabled() {
  return String(process.env.TWILIO_RESUME_MUSIC_ENABLED || "false").trim().toLowerCase() === "true"
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

function baseMusicPlaybackState(subscription) {
  return subscription?.metadata?.musicPlayback || {
    offsetSeconds: 0,
    startedAt: null,
    sourceUrl: holdMusicUrl() || null,
  }
}

function normalizeOffsetSeconds(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

function currentMusicOffsetSeconds(subscription, now = Date.now()) {
  const musicPlayback = baseMusicPlaybackState(subscription)
  const baseOffsetSeconds = normalizeOffsetSeconds(musicPlayback.offsetSeconds)
  const startedAtMs = musicPlayback.startedAt ? Date.parse(musicPlayback.startedAt) : Number.NaN
  if (!Number.isFinite(startedAtMs)) return baseOffsetSeconds
  const elapsedSeconds = Math.max(0, (now - startedAtMs) / 1000)
  return baseOffsetSeconds + elapsedSeconds
}

async function saveMusicPlaybackState(subscription, musicPlayback = {}) {
  if (!subscription?.publicId) return subscription
  const nextMetadata = {
    ...(subscription.metadata || {}),
    musicPlayback: {
      ...baseMusicPlaybackState(subscription),
      ...musicPlayback,
    },
  }
  const updated = await updateQueueLiveUpdateSubscriptionMetadata({
    subscriptionPublicId: subscription.publicId,
    metadata: nextMetadata,
  })
  if (updated?.metadata) {
    subscription.metadata = updated.metadata
  } else {
    subscription.metadata = nextMetadata
  }
  return updated || subscription
}

async function markMusicInterrupted(subscription) {
  if (!resumeMusicEnabled() || !subscription?.publicId) return subscription
  const sourceUrl = holdMusicUrl() || baseMusicPlaybackState(subscription).sourceUrl || null
  return saveMusicPlaybackState(subscription, {
    offsetSeconds: currentMusicOffsetSeconds(subscription),
    startedAt: null,
    sourceUrl,
  })
}

async function markMusicStarted(subscription, offsetSeconds) {
  if (!resumeMusicEnabled() || !subscription?.publicId) return subscription
  return saveMusicPlaybackState(subscription, {
    offsetSeconds: normalizeOffsetSeconds(offsetSeconds),
    startedAt: new Date().toISOString(),
    sourceUrl: holdMusicUrl() || baseMusicPlaybackState(subscription).sourceUrl || null,
  })
}

function buildTwilioMusicAudioUrl(subscription) {
  const params = new URLSearchParams({
    subscriptionPublicId: subscription.publicId,
  })
  return `${buildAbsoluteUrl("/twilio/voice/live-queue/music/audio")}?${params.toString()}`
}

function ffmpegPath() {
  return env("FFMPEG_PATH") || "ffmpeg"
}

function ffprobePath() {
  return env("FFPROBE_PATH") || "ffprobe"
}

async function probeAudioDurationSeconds(sourceUrl) {
  const cacheKey = String(sourceUrl || "").trim()
  if (!cacheKey) return null
  if (cachedAudioDurations.has(cacheKey)) return cachedAudioDurations.get(cacheKey)

  const durationPromise = new Promise((resolve) => {
    const probe = spawn(ffprobePath(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      cacheKey,
    ])

    let stdout = ""
    probe.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    probe.on("error", () => resolve(null))
    probe.on("close", (code) => {
      if (code !== 0) return resolve(null)
      const duration = Number.parseFloat(String(stdout || "").trim())
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null)
    })
  })

  cachedAudioDurations.set(cacheKey, durationPromise)
  return durationPromise
}

function appendSay(target, text) {
  target.say(
    {
      voice: twilioVoiceId(),
      language: twilioLanguageCode(),
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
  const script = buildVoiceUpdateScript({
    snapshot,
    previousPosition: subscription?.lastKnownPosition ?? null,
    languageCode: subscription?.languageCode || "en",
  })
  const response = buildVoiceResponse()

  if (script.shouldLoopMusic) {
    appendSay(response, script.previewText)
    response.redirect(
      {
        method: "POST",
      },
      buildTwilioMusicLoopWebhookUrl(subscription.publicId),
    )
    return response.toString()
  }

  const gather = response.gather({
    action: buildTwilioEventsWebhookUrl(subscription.publicId),
    method: "POST",
    numDigits: 1,
    timeout: 5,
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

async function renderMusicLoopResponse({ subscription }) {
  const response = buildVoiceResponse()
  const musicUrl = holdMusicUrl()

  if (!musicUrl || !subscription?.playMusicBetweenUpdates) {
    response.hangup()
    return response.toString()
  }

  if (resumeMusicEnabled()) {
    const offsetSeconds = normalizeOffsetSeconds(baseMusicPlaybackState(subscription).offsetSeconds)
    const playUrl = offsetSeconds > 0 ? buildTwilioMusicAudioUrl(subscription) : musicUrl
    await markMusicStarted(subscription, offsetSeconds)
    response.play(playUrl)
  } else {
    response.play(musicUrl)
  }
  response.redirect(
    {
      method: "POST",
    },
    buildTwilioMusicLoopWebhookUrl(subscription.publicId),
  )
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

export function buildTwilioMusicLoopWebhookUrl(subscriptionPublicId) {
  const params = new URLSearchParams({
    subscriptionPublicId,
  })
  return `${buildAbsoluteUrl("/twilio/voice/live-queue/music")}?${params.toString()}`
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
    // eslint-disable-next-line no-console
    console.error("[twilio-webhook] missing validation input", {
      hasAuthToken: Boolean(authToken),
      hasSignature: Boolean(signature),
      url,
      path: req.originalUrl || req.url || null,
    })
    throw badRequest("Invalid Twilio webhook signature.")
  }

  const isValid = twilio.validateRequest(authToken, signature, url, params)
  if (!isValid) {
    // eslint-disable-next-line no-console
    console.error("[twilio-webhook] signature validation failed", {
      url,
      path: req.originalUrl || req.url || null,
      method: req.method || "POST",
      host: req.headers?.host || null,
      forwardedHost: req.headers?.["x-forwarded-host"] || null,
      forwardedProto: req.headers?.["x-forwarded-proto"] || null,
      hasSignature: Boolean(signature),
    })
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

  const from = env("TWILIO_PHONE_NUMBER")
  const url = buildTwilioTwimlWebhookUrl(subscription.publicId)
  const target = {
    subscriptionPublicId: subscription?.publicId || null,
    queueJoinId: subscription?.queueJoinId || null,
    to: maskPhoneNumber(subscription?.phoneNumber),
    from: maskPhoneNumber(from),
    url,
    position: snapshot?.position ?? null,
    queueStatus: snapshot?.queueStatus || null,
  }

  // eslint-disable-next-line no-console
  console.info("[twilio-call] placing live update call", target)

  await markMusicInterrupted(subscription)

  let response
  try {
    if (subscription?.lastProviderReference) {
      response = await getTwilioClient().calls(subscription.lastProviderReference).update({
        url,
        method: "POST",
      })
      // eslint-disable-next-line no-console
      console.info("[twilio-call] updated active live update call", {
        ...target,
        providerReference: subscription.lastProviderReference,
        callStatus: response?.status || null,
      })
    } else {
      response = await getTwilioClient().calls.create({
        to: subscription.phoneNumber,
        from,
        url,
        method: "POST",
      })
    }
  } catch (error) {
    if (subscription?.lastProviderReference) {
      // eslint-disable-next-line no-console
      console.warn("[twilio-call] failed to update active call, creating a new one", {
        ...target,
        providerReference: subscription.lastProviderReference,
        error: summarizeTwilioError(error),
      })
      try {
        response = await getTwilioClient().calls.create({
          to: subscription.phoneNumber,
          from,
          url,
          method: "POST",
        })
      } catch (createError) {
        // eslint-disable-next-line no-console
        console.error("[twilio-call] failed to place live update call", {
          ...target,
          error: summarizeTwilioError(createError),
        })
        throw createError
      }
    } else {
      // eslint-disable-next-line no-console
      console.error("[twilio-call] failed to place live update call", {
        ...target,
        error: summarizeTwilioError(error),
      })
      throw error
    }
  }

  const providerReference = String(response?.sid || "").trim() || null
  // eslint-disable-next-line no-console
  console.info("[twilio-call] live update call accepted by Twilio", {
    ...target,
    providerReference,
    callStatus: response?.status || null,
  })
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

  // eslint-disable-next-line no-console
  console.info("[twilio-webhook] incoming request", {
    kind,
    subscriptionPublicId,
    path: req.originalUrl || req.url || null,
    method: req.method || "POST",
    host: req.headers?.host || null,
    forwardedHost: req.headers?.["x-forwarded-host"] || null,
    forwardedProto: req.headers?.["x-forwarded-proto"] || null,
    callSid: req.body?.CallSid || req.query?.CallSid || null,
    callStatus: req.body?.CallStatus || req.query?.CallStatus || null,
    digits: req.body?.Digits || null,
  })

  const context = await buildLiveUpdateContext(subscriptionPublicId)

  if (kind === "twiml") {
    return renderGatherResponse(context)
  }

  if (kind === "music") {
    const script = buildVoiceUpdateScript({
      snapshot: context.snapshot,
      previousPosition: context.subscription?.lastKnownPosition ?? null,
      languageCode: context.subscription?.languageCode || "en",
    })
    if (!script.shouldLoopMusic) {
      const response = buildVoiceResponse()
      response.hangup()
      return response.toString()
    }
    return renderMusicLoopResponse(context)
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

export async function streamTwilioLiveUpdateMusicAudio({ req, res } = {}) {
  const subscriptionPublicId = resolveSubscriptionPublicId(req)
  if (!subscriptionPublicId) {
    throw badRequest("Missing live update subscription.")
  }

  const subscription = await getQueueLiveUpdateSubscriptionByPublicId(subscriptionPublicId)
  if (!subscription?.publicId || !subscription.isActive) {
    throw badRequest("Live update subscription is no longer active.")
  }

  const sourceUrl = holdMusicUrl() || baseMusicPlaybackState(subscription).sourceUrl || null
  if (!sourceUrl || !subscription.playMusicBetweenUpdates) {
    throw badRequest("Queue hold music is not configured.")
  }

  const durationSeconds = await probeAudioDurationSeconds(sourceUrl)
  const rawOffsetSeconds = currentMusicOffsetSeconds(subscription)
  const effectiveOffsetSeconds = durationSeconds && durationSeconds > 0
    ? rawOffsetSeconds % durationSeconds
    : rawOffsetSeconds

  if (effectiveOffsetSeconds <= 0.05) {
    return res.redirect(302, sourceUrl)
  }

  // eslint-disable-next-line no-console
  console.info("[twilio-music] streaming resumed audio", {
    subscriptionPublicId,
    requestedOffsetSeconds: rawOffsetSeconds,
    effectiveOffsetSeconds,
    durationSeconds,
    sourceUrl,
  })

  const ffmpeg = spawn(ffmpegPath(), [
    "-loglevel",
    "error",
    "-ss",
    effectiveOffsetSeconds.toFixed(3),
    "-i",
    sourceUrl,
    "-vn",
    "-acodec",
    "copy",
    "-f",
    "mp3",
    "-",
  ])

  let hasStartedStreaming = false
  let stderr = ""

  ffmpeg.stdout.once("data", () => {
    hasStartedStreaming = true
  })

  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  ffmpeg.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("[twilio-music] ffmpeg failed to start", {
      subscriptionPublicId,
      errorMessage: error?.message || "Unknown ffmpeg start error",
    })
    if (!res.headersSent) {
      res.redirect(302, sourceUrl)
    }
  })

  res.type("audio/mpeg")
  ffmpeg.stdout.pipe(res)

  const cleanup = () => {
    if (!ffmpeg.killed) ffmpeg.kill("SIGTERM")
  }
  req.on("close", cleanup)
  res.on("close", cleanup)

  ffmpeg.on("close", (code) => {
    req.off?.("close", cleanup)
    res.off?.("close", cleanup)

    if (!hasStartedStreaming && !res.headersSent) {
      return res.redirect(302, sourceUrl)
    }

    if (code !== 0 && code !== 255) {
      // eslint-disable-next-line no-console
      console.error("[twilio-music] ffmpeg stream exited with error", {
        subscriptionPublicId,
        code,
        stderr: stderr.trim() || null,
      })
    }
  })
}

import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { confirmAssistantAction, respondToAssistant, handleUssdRequest } from "./service.js"
import {
  buildTwilioVoiceResponse,
  validateTwilioWebhookRequest,
} from "./twilio-voice.service.js"

export const publicAssistantRouter = Router()
const router = Router()

/**
 * USSD Entry point
 * Standard format for Africa's Talking and similar gateways.
 */
async function ussdCallbackHandler(req, res) {
  const { sessionId, phoneNumber, text, serviceCode, networkCode } = req.body || {}
  const response = await handleUssdRequest({
    sessionId,
    phoneNumber,
    text,
    serviceCode,
    networkCode,
  })
  res.set("Content-Type", "text/plain")
  return res.send(response)
}

publicAssistantRouter.post("/ussd", asyncHandler(ussdCallbackHandler))
publicAssistantRouter.post("/api/v1/ussd", asyncHandler(ussdCallbackHandler))

publicAssistantRouter.post(
  "/twilio/voice/live-queue/twiml",
  asyncHandler(async (req, res) => {
    try {
      validateTwilioWebhookRequest(req)
      const responseXml = await buildTwilioVoiceResponse({
        kind: "twiml",
        req,
      })
      res.type("text/xml")
      return res.status(200).send(responseXml)
    } catch (error) {
      if (Number(error?.status || 0) === 400) {
        return res.status(403).json({ ok: false, error: error.message || "Invalid Twilio signature" })
      }
      throw error
    }
  })
)

publicAssistantRouter.post(
  "/twilio/voice/live-queue/events",
  asyncHandler(async (req, res) => {
    try {
      validateTwilioWebhookRequest(req)
      const responseXml = await buildTwilioVoiceResponse({
        kind: "event",
        req,
      })
      res.type("text/xml")
      return res.status(200).send(responseXml)
    } catch (error) {
      if (Number(error?.status || 0) === 400) {
        return res.status(403).json({ ok: false, error: error.message || "Invalid Twilio signature" })
      }
      throw error
    }
  })
)

const respondBodySchema = z.object({
  message: z.string().trim().max(1000).optional(),
  sessionToken: z.string().trim().max(4096).optional(),
  actionId: z.string().trim().max(128).optional(),
  actionPayload: z.record(z.any()).optional(),
  currentLocation: z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }).nullable().optional(),
})

const confirmBodySchema = z.object({
  confirmationToken: z.string().trim().min(1).max(4096),
})

router.post(
  "/user/assistant/respond",
  asyncHandler(async (req, res) => {
    const body = respondBodySchema.parse(req.body || {})
    const payload = await respondToAssistant({
      auth: req.auth,
      message: body.message || "",
      sessionToken: body.sessionToken || "",
      actionId: body.actionId || "",
      actionPayload: body.actionPayload || {},
      currentLocation: body.currentLocation || null,
    })
    return ok(res, payload)
  })
)

router.post(
  "/user/assistant/confirm",
  asyncHandler(async (req, res) => {
    const body = confirmBodySchema.parse(req.body || {})
    const payload = await confirmAssistantAction({
      auth: req.auth,
      confirmationToken: body.confirmationToken,
    })
    return ok(res, payload)
  })
)

export default router

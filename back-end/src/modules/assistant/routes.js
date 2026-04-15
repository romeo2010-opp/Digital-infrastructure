import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { confirmAssistantAction, respondToAssistant } from "./service.js"

const router = Router()

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

import { Router } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import * as internalAuthService from "./auth.service.js"
import { requireInternalAuth } from "./middleware.js"

const router = Router()

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(120),
})

const patchMeSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(24).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required",
  })

const internalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many internal login attempts. Try again later.",
  },
})

router.post(
  "/login",
  internalLoginLimiter,
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body || {})
    return ok(res, await internalAuthService.login({ payload, req }))
  })
)

router.get(
  "/me",
  requireInternalAuth,
  asyncHandler(async (req, res) => ok(res, await internalAuthService.me(req.internalAuth)))
)

router.patch(
  "/me",
  requireInternalAuth,
  asyncHandler(async (req, res) => {
    const payload = patchMeSchema.parse(req.body || {})
    return ok(res, await internalAuthService.updateMe(req.internalAuth, payload))
  })
)

router.post(
  "/logout",
  requireInternalAuth,
  asyncHandler(async (req, res) => {
    await internalAuthService.logout(req.internalAuth)
    return ok(res, { loggedOut: true })
  })
)

export default router

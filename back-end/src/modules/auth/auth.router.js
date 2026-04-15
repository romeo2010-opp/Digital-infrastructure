import { Router } from "express"
import rateLimit from "express-rate-limit"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireAuth } from "../../middleware/requireAuth.js"
import {
  loginSchema,
  passkeyLoginOptionsSchema,
  passkeyLoginVerifySchema,
  passkeyPublicIdParamsSchema,
  passkeyRegistrationOptionsSchema,
  passkeyRegistrationVerifySchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schemas.js"
import * as authController from "./auth.controller.js"

const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many login attempts. Try again later.",
  },
})

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    req.body = loginSchema.parse(req.body || {})
    return authController.login(req, res)
  })
)

router.post(
  "/register",
  loginLimiter,
  asyncHandler(async (req, res) => {
    req.body = registerSchema.parse(req.body || {})
    return authController.register(req, res)
  })
)

router.post(
  "/passkeys/register/options",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.body = passkeyRegistrationOptionsSchema.parse(req.body || {})
    return authController.beginPasskeyRegistration(req, res)
  })
)

router.post(
  "/passkeys/register/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.body = passkeyRegistrationVerifySchema.parse(req.body || {})
    return authController.completePasskeyRegistration(req, res)
  })
)

router.post(
  "/passkeys/login/options",
  loginLimiter,
  asyncHandler(async (req, res) => {
    req.body = passkeyLoginOptionsSchema.parse(req.body || {})
    return authController.beginPasskeyLogin(req, res)
  })
)

router.post(
  "/passkeys/login/verify",
  loginLimiter,
  asyncHandler(async (req, res) => {
    req.body = passkeyLoginVerifySchema.parse(req.body || {})
    return authController.completePasskeyLogin(req, res)
  })
)

router.get(
  "/passkeys",
  requireAuth,
  asyncHandler(async (req, res) => authController.listPasskeys(req, res))
)

router.delete(
  "/passkeys/:passkeyPublicId",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.params = passkeyPublicIdParamsSchema.parse(req.params || {})
    return authController.removePasskey(req, res)
  })
)

router.post(
  "/refresh",
  asyncHandler(async (req, res) => authController.refresh(req, res))
)

router.post(
  "/logout",
  asyncHandler(async (req, res) => authController.logout(req, res))
)

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => authController.me(req, res))
)

router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.body = updateProfileSchema.parse(req.body || {})
    return authController.updateProfile(req, res)
  })
)

export default router

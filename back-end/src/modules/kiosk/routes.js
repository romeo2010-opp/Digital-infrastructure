import { Router } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { requireAuth } from "../../middleware/requireAuth.js"
import {
  challengeParamsSchema,
  createChallengeSchema,
  createRegistrationChallengeSchema,
  registrationChallengeParamsSchema,
  sessionParamsSchema,
} from "./kiosk.schemas.js"
import * as kioskService from "./kiosk.service.js"

const router = Router()

const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many kiosk challenge requests. Try again shortly.",
  },
})

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many kiosk polling requests. Try again shortly.",
  },
})

const approvalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many kiosk approval attempts. Try again shortly.",
  },
})

const pumpModeSchema = z.object({
  mode: z.enum(["OPEN_WALKIN", "CLEARING_FOR_SMARTLINK", "SMARTLINK_ONLY", "PAUSED", "MAINTENANCE"]),
  reason: z.string().trim().max(255).optional(),
})

const ticketActionParamsSchema = z.object({
  ticketId: z.string().trim().min(1).max(64),
  action: z.enum(["mark-arrived", "start-fueling", "complete", "no-show", "skip", "dispute", "blocked-lane"]),
})

const ticketActionBodySchema = z.object({
  reason: z.string().trim().max(255).optional(),
  note: z.string().trim().max(255).optional(),
})

router.post(
  "/registration/challenge",
  challengeLimiter,
  asyncHandler(async (req, res) => {
    req.body = createRegistrationChallengeSchema.parse(req.body || {})
    const data = await kioskService.createKioskRegistrationChallenge({
      payload: req.body,
      req,
    })
    return ok(res, data, 201)
  })
)

router.get(
  "/registration/challenge/:challengeId/status",
  statusLimiter,
  asyncHandler(async (req, res) => {
    req.params = registrationChallengeParamsSchema.parse(req.params || {})
    const data = await kioskService.getRegistrationChallengeStatus({
      challengeId: req.params.challengeId,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/auth/challenge",
  challengeLimiter,
  asyncHandler(async (req, res) => {
    req.body = createChallengeSchema.parse(req.body || {})
    const data = await kioskService.createKioskChallenge({
      payload: req.body,
      req,
    })
    return ok(res, data, 201)
  })
)

router.get(
  "/auth/challenge/:challengeId/status",
  statusLimiter,
  asyncHandler(async (req, res) => {
    req.params = challengeParamsSchema.parse(req.params || {})
    const data = await kioskService.getChallengeStatus({
      challengeId: req.params.challengeId,
      req,
    })
    return ok(res, data)
  })
)

router.get(
  "/auth/challenge/:challengeId",
  requireAuth,
  approvalLimiter,
  asyncHandler(async (req, res) => {
    req.params = challengeParamsSchema.parse(req.params || {})
    const data = await kioskService.getChallengeForApproval({
      challengeId: req.params.challengeId,
      auth: req.auth,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/auth/challenge/:challengeId/approve",
  requireAuth,
  approvalLimiter,
  asyncHandler(async (req, res) => {
    req.params = challengeParamsSchema.parse(req.params || {})
    const data = await kioskService.approveChallenge({
      challengeId: req.params.challengeId,
      auth: req.auth,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/auth/challenge/:challengeId/deny",
  requireAuth,
  approvalLimiter,
  asyncHandler(async (req, res) => {
    req.params = challengeParamsSchema.parse(req.params || {})
    const data = await kioskService.denyChallenge({
      challengeId: req.params.challengeId,
      auth: req.auth,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/session/:sessionId/heartbeat",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.params = sessionParamsSchema.parse(req.params || {})
    const data = await kioskService.heartbeatSession({
      sessionId: req.params.sessionId,
      auth: req.auth,
    })
    return ok(res, data)
  })
)

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await kioskService.getKioskMe({ auth: req.auth })
    return ok(res, data)
  })
)

router.get(
  "/queue",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await kioskService.getKioskQueue({ auth: req.auth })
    return ok(res, data)
  })
)

router.get(
  "/pump-home",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await kioskService.getKioskPumpHome({ auth: req.auth })
    return ok(res, data)
  })
)

router.patch(
  "/pump-mode",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = pumpModeSchema.parse(req.body || {})
    const data = await kioskService.updateKioskPumpMode({
      auth: req.auth,
      mode: body.mode,
      reason: body.reason || null,
    })
    return ok(res, data)
  })
)

router.post(
  "/tickets/:ticketId/:action",
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = ticketActionParamsSchema.parse(req.params || {})
    const body = ticketActionBodySchema.parse(req.body || {})
    const data = await kioskService.performKioskTicketAction({
      auth: req.auth,
      ticketId: params.ticketId,
      action: params.action,
      payload: body,
    })
    return ok(res, data)
  })
)

router.post(
  "/session/:sessionId/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.params = sessionParamsSchema.parse(req.params || {})
    const data = await kioskService.revokeSession({
      sessionId: req.params.sessionId,
      auth: req.auth,
      req,
    })
    return ok(res, data)
  })
)

router.get(
  "/sessions/active",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await kioskService.listActiveSessions({
      auth: req.auth,
    })
    return ok(res, data)
  })
)

export default router

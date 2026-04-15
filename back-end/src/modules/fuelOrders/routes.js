import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { requireApiKey } from "../../middleware/requireApiKey.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import {
  attachManualOrderToPumpSession,
  cancelFuelOrder,
  createManualWalletFuelOrder,
  finalizeFuelOrderFromPumpSession,
  getFuelOrderForUser,
  getStationOperationsKioskData,
  listNearbyWalletOrdersForStation,
  markFuelOrderDispensing,
  recordPresenceEvent,
} from "./service.js"

const router = Router()
export const fuelOrderGatewayRoutes = Router()

const stationReadRole = requireRole(["MANAGER", "ATTENDANT", "VIEWER"])
const stationWriteRole = requireRole(["MANAGER", "ATTENDANT"])

export const createManualWalletFuelOrderBodySchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  fuelType: z.enum(["PETROL", "DIESEL"]),
  requestedAmountMwk: z.number().positive().max(10000000).optional(),
  requestedLitres: z.number().positive().max(5000).optional(),
}).refine((body) => body.requestedAmountMwk || body.requestedLitres, {
  message: "requestedAmountMwk or requestedLitres is required",
})

export const cancelFuelOrderBodySchema = z.object({
  reason: z.string().trim().max(255).optional(),
})

export const presenceEventBodySchema = z.object({
  userPublicId: z.string().trim().min(1).max(64),
  fuelOrderId: z.string().trim().min(1).max(64).optional(),
  beaconId: z.string().trim().max(64).optional(),
  proximityLevel: z.enum(["station", "lane", "pump"]),
  seenAt: z.string().trim().datetime().optional(),
  metadata: z.record(z.any()).optional(),
})

export const attachFuelOrderBodySchema = z.object({
  fuelOrderId: z.string().trim().min(1).max(64),
  forceReattach: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
})

export const finalizeFuelOrderBodySchema = z.object({
  dispensedLitres: z.number().positive().optional(),
  amountMwk: z.number().positive().optional(),
  note: z.string().trim().max(1000).optional(),
})

router.use("/stations/:stationPublicId/nearby-wallet-orders", requireStationScope)
router.use("/stations/:stationPublicId/operations/kiosk-data", requireStationScope)

router.post(
  "/fuel-orders/manual-wallet",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    const body = createManualWalletFuelOrderBodySchema.parse(req.body || {})
    const fuelOrder = await createManualWalletFuelOrder({
      userId: authUserId,
      stationPublicId: body.stationPublicId,
      fuelType: body.fuelType,
      requestedAmountMwk: body.requestedAmountMwk ?? null,
      requestedLitres: body.requestedLitres ?? null,
      source: "mobile_app",
    })
    return ok(res, fuelOrder, 201)
  })
)

router.get(
  "/fuel-orders/:fuelOrderId",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    const payload = await getFuelOrderForUser({
      fuelOrderId: req.params.fuelOrderId,
      userId: authUserId,
    })
    return ok(res, payload)
  })
)

router.post(
  "/fuel-orders/:fuelOrderId/cancel",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    const body = cancelFuelOrderBodySchema.parse(req.body || {})
    const payload = await cancelFuelOrder({
      fuelOrderId: req.params.fuelOrderId,
      userId: authUserId,
      actorUserId: authUserId,
      reason: body.reason || "",
      source: "mobile_app",
    })
    return ok(res, payload)
  })
)

fuelOrderGatewayRoutes.post(
  "/api/stations/:stationPublicId/presence-events",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const body = presenceEventBodySchema.parse(req.body || {})
    const payload = await recordPresenceEvent({
      stationPublicId: req.params.stationPublicId,
      userPublicId: body.userPublicId,
      fuelOrderId: body.fuelOrderId || null,
      beaconId: body.beaconId || null,
      proximityLevel: body.proximityLevel,
      seenAt: body.seenAt || null,
      metadata: body.metadata || null,
      source: "telemetry",
    })
    return ok(res, payload, 201)
  })
)

router.get(
  "/stations/:stationPublicId/nearby-wallet-orders",
  stationReadRole,
  asyncHandler(async (req, res) => {
    const payload = await listNearbyWalletOrdersForStation({
      stationPublicId: req.params.stationPublicId,
    })
    return ok(res, payload)
  })
)

router.get(
  "/stations/:stationPublicId/operations/kiosk-data",
  stationReadRole,
  asyncHandler(async (req, res) => {
    const payload = await getStationOperationsKioskData({
      stationPublicId: req.params.stationPublicId,
    })
    return ok(res, payload)
  })
)

router.post(
  "/pump-sessions/:sessionId/attach-fuel-order",
  stationWriteRole,
  asyncHandler(async (req, res) => {
    const body = attachFuelOrderBodySchema.parse(req.body || {})
    const payload = await attachManualOrderToPumpSession({
      stationPublicId: String(req.auth?.stationPublicId || "").trim(),
      fuelOrderId: body.fuelOrderId,
      sessionId: req.params.sessionId,
      actorUserId: Number(req.auth?.userId || 0) || null,
      forceReattach: Boolean(body.forceReattach),
      note: body.note || "",
      source: "attendant",
    })
    return ok(res, payload)
  })
)

router.post(
  "/pump-sessions/:sessionId/start-dispensing",
  stationWriteRole,
  asyncHandler(async (req, res) => {
    const payload = await markFuelOrderDispensing({
      stationPublicId: String(req.auth?.stationPublicId || "").trim(),
      sessionId: req.params.sessionId,
      actorUserId: Number(req.auth?.userId || 0) || null,
      source: "attendant",
    })
    return ok(res, payload)
  })
)

router.post(
  "/pump-sessions/:sessionId/finalize-fuel-order",
  stationWriteRole,
  asyncHandler(async (req, res) => {
    const body = finalizeFuelOrderBodySchema.parse(req.body || {})
    const payload = await finalizeFuelOrderFromPumpSession({
      stationPublicId: String(req.auth?.stationPublicId || "").trim(),
      sessionId: req.params.sessionId,
      actorUserId: Number(req.auth?.userId || 0) || null,
      dispensedLitres: body.dispensedLitres ?? null,
      amountMwk: body.amountMwk ?? null,
      note: body.note || "",
      source: "attendant",
    })
    return ok(res, payload)
  })
)

export default router

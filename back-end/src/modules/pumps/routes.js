import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { prisma } from "../../db/prisma.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { resolveStationOrThrow } from "../common/db.js"
import {
  createNozzleForPump,
  createPumpGroup,
  getNozzleByPublicId,
  getPumpWithNozzlesByPublicId,
  listStationPumpsWithNozzles,
  patchNozzleByPublicId,
  patchPumpGroup,
} from "./pumps.service.js"

const router = Router()

const nozzleNumberSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => value.length > 0, {
    message: "Nozzle number is required",
  })

const pumpStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "IDLE"]),
  reason: z.string().max(120).optional(),
})

const pumpCreateSchema = z.object({
  pumpNumber: z.number().int().positive(),
  fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
  tankPublicId: z.string().min(8).max(64).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "IDLE"]).optional(),
  statusReason: z.string().max(120).optional(),
  isActive: z.boolean().optional(),
  quickSetup: z.enum(["MALAWI_2_NOZZLES", "MALAWI_4_NOZZLES"]).optional(),
  nozzles: z.array(
    z.object({
      nozzleNumber: nozzleNumberSchema,
      side: z.string().max(8).optional(),
      fuelType: z.enum(["PETROL", "DIESEL"]),
      tankPublicId: z.string().min(8).max(64).nullable().optional(),
      status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"]).optional(),
      hardwareChannel: z.string().max(64).optional(),
      isActive: z.boolean().optional(),
    })
  ).max(8).optional(),
})

const pumpPatchSchema = z
  .object({
    pumpNumber: z.number().int().positive().optional(),
    fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
    tankPublicId: z.string().min(8).max(64).nullable().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "IDLE"]).optional(),
    statusReason: z.string().max(120).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one pump field is required",
  })

const nozzleCreateSchema = z.object({
  nozzleNumber: nozzleNumberSchema,
  side: z.string().max(8).optional(),
  fuelType: z.enum(["PETROL", "DIESEL"]),
  tankPublicId: z.string().min(8).max(64).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"]).optional(),
  hardwareChannel: z.string().max(64).optional(),
  isActive: z.boolean().optional(),
})

const nozzlePatchSchema = z
  .object({
    nozzleNumber: nozzleNumberSchema.optional(),
    side: z.string().max(8).nullable().optional(),
    fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
    tankPublicId: z.string().min(8).max(64).nullable().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"]).optional(),
    hardwareChannel: z.string().max(64).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one nozzle field is required",
  })

async function resolveActorStaffId(stationId, userId) {
  if (!userId) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM station_staff
    WHERE station_id = ${stationId}
      AND user_id = ${userId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0]?.id || null
}

async function resolveStationFromRequest(req, stationPublicId = null) {
  if (stationPublicId) {
    return resolveStationOrThrow(stationPublicId)
  }

  if (req.auth?.stationId && req.auth?.stationPublicId) {
    return {
      id: Number(req.auth.stationId),
      public_id: req.auth.stationPublicId,
    }
  }

  const queryStationPublicId = String(req.query?.stationPublicId || "").trim()
  if (req.auth?.bypass && queryStationPublicId) {
    return resolveStationOrThrow(queryStationPublicId)
  }

  throw badRequest("Station scope is required (use station-scoped route or stationPublicId query)")
}

router.get(
  "/stations/:stationPublicId/pumps",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const includeInactive = String(req.query.includeInactive || "true").toLowerCase() !== "false"
    const rows = await listStationPumpsWithNozzles(station.id, { includeInactive })
    return ok(res, rows)
  })
)

router.post(
  "/stations/:stationPublicId/pumps",
  requireStationScope,
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const payload = pumpCreateSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const created = await createPumpGroup({
      stationId: station.id,
      payload,
      actorStaffId,
      auditActionType: "PUMP_GROUP_CREATE",
    })
    return ok(res, created, 201)
  })
)

router.get(
  "/pumps/:pumpPublicId",
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationFromRequest(req)
    const pump = await getPumpWithNozzlesByPublicId(station.id, req.params.pumpPublicId)
    return ok(res, pump)
  })
)

router.patch(
  "/pumps/:pumpPublicId",
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationFromRequest(req)
    const payload = pumpPatchSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const updated = await patchPumpGroup({
      stationId: station.id,
      pumpPublicId: req.params.pumpPublicId,
      payload,
      actorStaffId,
      auditActionType: "PUMP_GROUP_UPDATE",
    })
    return ok(res, updated)
  })
)

router.post(
  "/pumps/:pumpPublicId/nozzles",
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationFromRequest(req)
    const payload = nozzleCreateSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const created = await createNozzleForPump({
      stationId: station.id,
      pumpPublicId: req.params.pumpPublicId,
      payload,
      actorStaffId,
      auditActionType: "PUMP_NOZZLE_CREATE",
    })
    return ok(res, created, 201)
  })
)

router.get(
  "/nozzles/:nozzlePublicId",
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationFromRequest(req)
    const nozzle = await getNozzleByPublicId(station.id, req.params.nozzlePublicId)
    return ok(res, nozzle)
  })
)

router.patch(
  "/nozzles/:nozzlePublicId",
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationFromRequest(req)
    const payload = nozzlePatchSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const updated = await patchNozzleByPublicId({
      stationId: station.id,
      nozzlePublicId: req.params.nozzlePublicId,
      payload,
      actorStaffId,
      auditActionType: "PUMP_NOZZLE_UPDATE",
    })
    return ok(res, updated)
  })
)

router.patch(
  "/stations/:stationPublicId/pumps/:pumpPublicId/status",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = pumpStatusSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)

    const updated = await patchPumpGroup({
      stationId: station.id,
      pumpPublicId: req.params.pumpPublicId,
      payload: {
        status: body.status,
        statusReason: body.reason || null,
      },
      actorStaffId,
      auditActionType: "PUMP_STATUS_UPDATE",
    })

    return ok(res, updated)
  })
)

export default router

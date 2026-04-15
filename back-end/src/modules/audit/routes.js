import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"

const router = Router()

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actionType: z.string().max(64).optional(),
})

const appendSchema = z.object({
  actionType: z.string().min(1).max(64),
  payload: z.any().optional(),
})

router.get(
  "/stations/:stationPublicId/audit",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = querySchema.parse(req.query)
    const from = `${query.from || "1970-01-01"} 00:00:00`
    const to = `${query.to || "2999-12-31"} 23:59:59`

    const rows = await prisma.$queryRaw`
      SELECT id, action_type, payload, created_at, actor_staff_id
      FROM audit_log
      WHERE station_id = ${station.id}
        AND created_at BETWEEN ${from} AND ${to}
        AND (${query.actionType || null} IS NULL OR action_type = ${query.actionType || null})
      ORDER BY created_at DESC
      LIMIT 500
    `

    return ok(res, rows)
  })
)

router.post(
  "/stations/:stationPublicId/audit",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = appendSchema.parse(req.body || {})

    await writeAuditLog({
      stationId: station.id,
      actionType: body.actionType,
      payload: body.payload || {},
    })

    return ok(res, { saved: true }, 201)
  })
)

export default router

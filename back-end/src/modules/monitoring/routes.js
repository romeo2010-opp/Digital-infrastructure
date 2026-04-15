import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, notFound, ok } from "../../utils/http.js"
import { requireApiKey } from "../../middleware/requireApiKey.js"
import { requireRole } from "../../middleware/requireAuth.js"
import { resolveStationOrThrow } from "../common/db.js"
import {
  edgeTelemetryEventBodySchema,
  pumpParamsSchema,
  simulateBodySchema,
  telemetryEventBodySchema,
} from "./monitoring.schemas.js"
import {
  applyMonitoringUpdate,
  getPumpMonitoringSnapshot,
  ingestPumpTelemetryEvent,
  listStationEdgeBindings,
} from "./monitoring.service.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"

const router = Router()
export const monitoringGatewayRoutes = Router()
const readRole = requireRole(["MANAGER", "ATTENDANT", "VIEWER"])
const writeRole = requireRole(["MANAGER", "ATTENDANT"])

async function resolveStationIdFromRequest(req) {
  const scopedStationId = Number(req.auth?.stationId || 0)
  if (Number.isFinite(scopedStationId) && scopedStationId > 0) {
    return scopedStationId
  }

  if (req.auth?.bypass) {
    const stationPublicId = String(req.query?.stationPublicId || "").trim()
    if (!stationPublicId) {
      throw badRequest("stationPublicId query is required when using API key bypass")
    }
    const station = await resolveStationOrThrow(stationPublicId)
    return Number(station.id)
  }

  throw badRequest("Station scope is required")
}

function ensureDevMode() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw notFound("Route not found")
  }
}

router.get(
  "/monitoring/pumps/:pumpId",
  requireStationPlanFeature(STATION_PLAN_FEATURES.MONITORING),
  readRole,
  asyncHandler(async (req, res) => {
    const { pumpId } = pumpParamsSchema.parse(req.params || {})
    const stationId = await resolveStationIdFromRequest(req)
    const snapshot = await getPumpMonitoringSnapshot({
      stationId,
      pumpPublicId: pumpId,
    })
    return ok(res, snapshot)
  })
)

router.get(
  "/monitoring/pumps/:pumpId/nozzles",
  requireStationPlanFeature(STATION_PLAN_FEATURES.MONITORING),
  readRole,
  asyncHandler(async (req, res) => {
    const { pumpId } = pumpParamsSchema.parse(req.params || {})
    const stationId = await resolveStationIdFromRequest(req)
    const snapshot = await getPumpMonitoringSnapshot({
      stationId,
      pumpPublicId: pumpId,
    })
    return ok(res, {
      pumpId: snapshot.pumpId,
      lastUpdateAt: snapshot.lastUpdateAt,
      nozzles: snapshot.nozzles,
    })
  })
)

router.post(
  "/monitoring/telemetry/events",
  requireStationPlanFeature(STATION_PLAN_FEATURES.MONITORING),
  writeRole,
  asyncHandler(async (req, res) => {
    const stationId = await resolveStationIdFromRequest(req)
    const body = telemetryEventBodySchema.parse(req.body || {})

    return ok(
      res,
      await ingestPumpTelemetryEvent({
        stationId,
        actorUserId: Number(req.auth?.userId || 0) || null,
        eventId: body.eventId,
        transactionPublicId: body.transactionPublicId,
        sessionPublicId: body.sessionPublicId,
        sessionReference: body.sessionReference,
        telemetryCorrelationId: body.telemetryCorrelationId,
        pumpPublicId: body.pumpId,
        nozzlePublicId: body.nozzleId,
        eventType: body.eventType,
        severity: body.severity,
        litresValue: body.litresValue ?? body.dispensedLitres,
        flowRate: body.flowRate,
        rawErrorCode: body.rawErrorCode,
        message: body.message,
        sourceType: body.sourceType,
        happenedAt: body.happenedAt,
        payload: body.payload,
      })
    )
  })
)

monitoringGatewayRoutes.get(
  "/api/edge/health",
  requireApiKey,
  asyncHandler(async (_req, res) => {
    return ok(res, {
      status: "ok",
      gateway: "monitoring-edge",
      checkedAt: new Date().toISOString(),
    })
  })
)

monitoringGatewayRoutes.get(
  "/api/stations/:stationPublicId/edge/pump-session-bindings",
  requireApiKey,
  asyncHandler(async (req, res) => {
    return ok(
      res,
      await listStationEdgeBindings({
        stationPublicId: req.params.stationPublicId,
      })
    )
  })
)

monitoringGatewayRoutes.post(
  "/api/stations/:stationPublicId/edge/telemetry/events",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const body = edgeTelemetryEventBodySchema.parse(req.body || {})
    const station = await resolveStationOrThrow(req.params.stationPublicId)

    return ok(
      res,
      await ingestPumpTelemetryEvent({
        stationId: Number(station.id),
        actorUserId: null,
        eventId: body.eventId,
        transactionPublicId: body.transactionPublicId,
        sessionPublicId: body.sessionPublicId,
        sessionReference: body.sessionReference,
        telemetryCorrelationId: body.telemetryCorrelationId,
        pumpPublicId: body.pumpId,
        nozzlePublicId: body.nozzleId,
        eventType: body.eventType,
        severity: body.severity,
        litresValue: body.litresValue ?? body.dispensedLitres,
        flowRate: body.flowRate,
        rawErrorCode: body.rawErrorCode,
        message: body.message,
        sourceType: body.sourceType || "STATION_EDGE",
        happenedAt: body.happenedAt,
        payload: body.payload,
      }),
      201
    )
  })
)

router.post(
  "/dev/monitoring/simulate",
  requireStationPlanFeature(STATION_PLAN_FEATURES.MONITORING),
  writeRole,
  asyncHandler(async (req, res) => {
    ensureDevMode()
    const stationId = await resolveStationIdFromRequest(req)
    const body = simulateBodySchema.parse(req.body || {})

    const payload = await applyMonitoringUpdate({
      stationId,
      pumpPublicId: body.pumpId,
      nozzlePublicId: body.nozzleId,
      status: body.status,
      litres: body.litres,
    })

    return ok(res, payload)
  })
)

export default router

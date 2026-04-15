import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { appTodayISO, formatDateTimeSqlInTimeZone, toUtcMysqlDateTime, zonedDateTimeToUtcMs } from "../../utils/dateTime.js"
import { createPublicId, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { notifyUsersOfScheduledStationRestock } from "../common/favoriteStationNotifications.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import { contentDispositionAttachment, safeFilenamePart } from "./reports.export.service.js"
import { streamInsightsPdf } from "./insights.export.pdf.js"
import {
  getDemandAnomalyMetrics,
  listDemandAnomalyEvents,
} from "./demandAnomaly.service.js"
import {
  getInsightsAlerts,
  getInsightsDemandForecast,
  getInsightsInventoryPrediction,
  getInsightsPumpUtilization,
  getInsightsQueuePrediction,
  getInsightsSalesVelocity,
  getInsightsSummary,
} from "./stationInsights.service.js"

const router = Router()

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fuelType: z.enum(["PETROL", "DIESEL", "ALL"]).optional(),
  shift: z.enum(["MORNING", "AFTERNOON", "NIGHT", "ALL"]).optional(),
  // Some environments use 24-char or custom public IDs for pumps.
  pumpPublicId: z.string().min(8).max(64).optional(),
})

const demandMetricsQuerySchema = z.object({
  window: z.enum(["15m", "1h", "6h"]).optional(),
})

const demandAnomalyEventsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

const insightsSummaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const insightsVelocityQuerySchema = z.object({
  window: z.enum(["1h", "6h", "24h"]).optional(),
})

const insightsForecastQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24).optional(),
})

const deliverySchema = z.object({
  rowId: z.string().optional(),
  tankPublicId: z.string().length(26).optional(),
  deliveredLitres: z.number().positive(),
  supplierName: z.string().max(120).optional(),
  arrivalTime: z.string().min(1).max(64).optional(),
  referenceCode: z.string().max(64).optional(),
  note: z.string().max(255).optional(),
})

const readingsSchema = z.object({
  rowId: z.string().optional(),
  tankPublicId: z.string().length(26).optional(),
  opening: z.union([z.number().positive(), z.string().min(1)]).optional(),
  closing: z.union([z.number().positive(), z.string().min(1)]).optional(),
})

const varianceSchema = z.object({
  rowId: z.string().optional(),
  reason: z.string().min(1).max(255),
  note: z.string().max(255).optional(),
})

const incidentSchema = z.object({
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  category: z.enum(["VARIANCE", "PUMP", "QUEUE", "PAYMENT", "OTHER"]).default("VARIANCE"),
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
})

const noteSchema = z.object({
  text: z.string().min(1).max(4000),
})

const runSchema = z.object({
  reportRunId: z.string().max(80).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const varianceAlertRowSchema = z.object({
  tankPublicId: z.string().min(1).max(64).optional(),
  tankName: z.string().min(1).max(80),
  fuelType: z.string().min(1).max(16),
  variancePct: z.coerce.number(),
  varianceLitres: z.coerce.number(),
  bookSales: z.coerce.number().nonnegative(),
  recordedSales: z.coerce.number().nonnegative(),
})

const varianceAlertsSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  thresholdPct: z.coerce.number().positive().max(100).default(0.5),
  rows: z.array(varianceAlertRowSchema).max(30),
})

async function resolveStationContext(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  return rows?.[0] || { ...station, timezone: "Africa/Blantyre" }
}

function parseDeliveryArrivalTime(value) {
  if (value === undefined || value === null || value === "") return new Date()
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid arrivalTime timestamp")
  }
  return parsed
}

async function getTankFuelType(stationId, tankId) {
  const rows = await prisma.$queryRaw`
    SELECT ft.code AS fuel_type
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.id = ${tankId}
    LIMIT 1
  `

  return String(rows?.[0]?.fuel_type || "").trim() || null
}

function toDateRange(query, stationTimeZone = "Africa/Blantyre") {
  const from = query.from || appTodayISO() || "1970-01-01"
  const to = query.to || from
  const fromUtcMs = zonedDateTimeToUtcMs(from, "00:00:00", stationTimeZone)
  const toUtcMs = zonedDateTimeToUtcMs(to, "23:59:59", stationTimeZone)
  const fromDt = toUtcMysqlDateTime(fromUtcMs) || `${from} 00:00:00`
  const toDt = toUtcMysqlDateTime(toUtcMs) || `${to} 23:59:59`
  return { from, to, fromDt, toDt }
}

function serializeStationLocalDates(value, timeZone) {
  if (value instanceof Date) {
    return formatDateTimeSqlInTimeZone(value, timeZone) || value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeStationLocalDates(item, timeZone))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeStationLocalDates(item, timeZone)])
    )
  }

  return value
}

async function getReportRunState(stationId, fromDate, toDate) {
  const rows = await prisma.$queryRaw`
    SELECT action_type, payload, created_at
    FROM audit_log
    WHERE station_id = ${stationId}
      AND action_type IN ('REPORT_FINALIZE', 'REPORT_UNFINALIZE')
    ORDER BY created_at DESC
    LIMIT 500
  `

  const matched = (rows || []).find((row) => {
    try {
      const payload = row.payload ? JSON.parse(row.payload) : {}
      return payload?.fromDate === fromDate && payload?.toDate === toDate
    } catch (_error) {
      return false
    }
  })

  if (!matched) {
    return {
      id: `RUN-${fromDate}-to-${toDate}`,
      createdAt: `${fromDate}T00:00:00.000Z`,
      status: "DRAFT",
    }
  }

  let parsed = {}
  try {
    parsed = matched.payload ? JSON.parse(matched.payload) : {}
  } catch (_error) {
    parsed = {}
  }

  return {
    id: parsed.id || `RUN-${fromDate}-to-${toDate}`,
    createdAt: matched.created_at,
    status: matched.action_type === "REPORT_FINALIZE" ? "FINAL" : "DRAFT",
  }
}

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

async function resolveTankId(stationId, body) {
  if (body.tankPublicId) {
    const rows = await prisma.$queryRaw`
      SELECT id
      FROM tanks
      WHERE station_id = ${stationId}
        AND public_id = ${body.tankPublicId}
      LIMIT 1
    `
    if (!rows?.[0]?.id) throw badRequest("Tank not found for provided tankPublicId")
    return Number(rows[0].id)
  }

  if (body.rowId && body.rowId.startsWith("REC-")) {
    const tankId = Number(body.rowId.replace("REC-", ""))
    if (Number.isFinite(tankId) && tankId > 0) {
      const rows = await prisma.$queryRaw`
        SELECT id
        FROM tanks
        WHERE station_id = ${stationId}
          AND id = ${tankId}
        LIMIT 1
      `
      if (rows?.[0]?.id) return tankId
    }
  }

  throw badRequest("Missing tank reference (tankPublicId or valid rowId)")
}

router.get(
  "/stations/:stationPublicId/reports/snapshot",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const query = querySchema.parse(req.query)
    const range = toDateRange(query, station.timezone)
    const fuelFilter = query.fuelType && query.fuelType !== "ALL" ? query.fuelType : null
    const selectedPump = query.pumpPublicId
      ? (
          await prisma.$queryRaw`
            SELECT id, tank_id
            FROM pumps
            WHERE station_id = ${station.id}
              AND public_id = ${query.pumpPublicId}
            LIMIT 1
          `
        )?.[0]
      : null

    if (query.pumpPublicId && !selectedPump) {
      throw badRequest("Pump not found for provided pumpPublicId")
    }

    const pumpIdFilter = selectedPump?.id || null
    const [fuelTypeSummary, salesDaily, queueDaily, reconciliation, incidents, auditSummaries, pumpMetrics, queueHourly, queueSettings, auditRows, notesRows, salesByPayment, salesByHour, recentTransactions, settlementRows, settlementSummaryRows, inspectedTransactions, inspectedTransactionCountRows, queueSummary, inventoryReadings, pumpRollup, nozzleBreakdown, offlineNozzles, missingNozzleRows, voidsAndOverrides, demandMetrics, demandEvents] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          ft.code AS fuel_code,
          COALESCE(SUM(t.litres), 0) AS litres,
          COALESCE(SUM(t.total_amount), 0) AS revenue,
          COUNT(t.id) AS tx_count,
          COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS avg_price_per_litre
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
          AND (${pumpIdFilter} IS NULL OR t.pump_id = ${pumpIdFilter})
        GROUP BY ft.code
        ORDER BY ft.code ASC
      `,
      prisma.$queryRaw`
        SELECT
          DATE(t.occurred_at) AS sale_date,
          t.fuel_type_id,
          SUM(t.litres) AS litres_sold,
          SUM(t.total_amount) AS revenue,
          COUNT(*) AS tx_count
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
          AND (${pumpIdFilter} IS NULL OR t.pump_id = ${pumpIdFilter})
        GROUP BY DATE(t.occurred_at), t.fuel_type_id
        ORDER BY sale_date ASC
      `,
      prisma.$queryRaw`
        SELECT q_date, served_count, no_show_count, cancelled_count, total_joined
        FROM v_queue_daily
        WHERE station_id = ${station.id}
          AND q_date BETWEEN ${range.from} AND ${range.to}
        ORDER BY q_date ASC
      `,
      prisma.$queryRaw`
        SELECT
          t.id AS tank_id,
          t.public_id AS tank_public_id,
          t.name AS tank_name,
          t.capacity_litres AS capacity_litres,
          ft.code AS fuel_code,
          CASE
            WHEN opening.opening_time IS NOT NULL THEN 'OPENING_READING'
            WHEN fallback_opening.fallback_opening_time IS NOT NULL THEN 'PREVIOUS_CLOSING'
            ELSE 'MISSING'
          END AS opening_source,
          COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) AS opening_litres,
          COALESCE(opening.opening_time, fallback_opening.fallback_opening_time) AS opening_time,
          COALESCE(del.delivery_litres, 0) AS delivered_litres,
          closing.closing_litres AS closing_litres,
          closing.closing_time AS closing_time,
          COALESCE(tx.recorded_litres, 0) AS recorded_litres,
          COALESCE(tx.recorded_revenue, 0) AS recorded_revenue,
          COALESCE(tx.tx_count, 0) AS tx_count,
          COALESCE(excluded_tx.excluded_tx_count, 0) AS excluded_tx_count,
          COALESCE(excluded_tx.excluded_litres, 0) AS excluded_litres,
          COALESCE(excluded_tx.excluded_revenue, 0) AS excluded_revenue
        FROM tanks t
        INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
        LEFT JOIN (
          SELECT ir.tank_id, ir.litres AS opening_litres, ir.reading_time AS opening_time
          FROM inventory_readings ir
          INNER JOIN (
            SELECT tank_id, MIN(reading_time) AS reading_time
            FROM inventory_readings
            WHERE station_id = ${station.id}
              AND reading_type = 'OPENING'
              AND reading_time BETWEEN ${range.fromDt} AND ${range.toDt}
            GROUP BY tank_id
          ) first_opening
            ON first_opening.tank_id = ir.tank_id
           AND first_opening.reading_time = ir.reading_time
          WHERE ir.station_id = ${station.id}
            AND ir.reading_type = 'OPENING'
        ) opening ON opening.tank_id = t.id
        LEFT JOIN (
          SELECT ir.tank_id, ir.litres AS fallback_opening_litres, ir.reading_time AS fallback_opening_time
          FROM inventory_readings ir
          INNER JOIN (
            SELECT tank_id, MAX(reading_time) AS reading_time
            FROM inventory_readings
            WHERE station_id = ${station.id}
              AND reading_type = 'CLOSING'
              AND reading_time < ${range.fromDt}
            GROUP BY tank_id
          ) previous_closing
            ON previous_closing.tank_id = ir.tank_id
           AND previous_closing.reading_time = ir.reading_time
          WHERE ir.station_id = ${station.id}
            AND ir.reading_type = 'CLOSING'
        ) fallback_opening ON fallback_opening.tank_id = t.id
        LEFT JOIN (
          SELECT tank_id, SUM(litres) AS delivery_litres
          FROM fuel_deliveries
          WHERE station_id = ${station.id}
            AND delivered_time BETWEEN ${range.fromDt} AND ${range.toDt}
          GROUP BY tank_id
        ) del ON del.tank_id = t.id
        LEFT JOIN (
          SELECT ir.tank_id, ir.litres AS closing_litres, ir.reading_time AS closing_time
          FROM inventory_readings ir
          INNER JOIN (
            SELECT tank_id, MAX(reading_time) AS reading_time
            FROM inventory_readings
            WHERE station_id = ${station.id}
              AND reading_type = 'CLOSING'
              AND reading_time BETWEEN ${range.fromDt} AND ${range.toDt}
            GROUP BY tank_id
          ) last_closing
            ON last_closing.tank_id = ir.tank_id
           AND last_closing.reading_time = ir.reading_time
          WHERE ir.station_id = ${station.id}
            AND ir.reading_type = 'CLOSING'
        ) closing ON closing.tank_id = t.id
        LEFT JOIN (
          SELECT
            COALESCE(pn.tank_id, p.tank_id) AS tank_id,
            SUM(tx.litres) AS recorded_litres,
            SUM(tx.total_amount) AS recorded_revenue,
            COUNT(tx.id) AS tx_count
          FROM transactions tx
          LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
          LEFT JOIN pumps p ON p.id = tx.pump_id
          LEFT JOIN fuel_types ftx ON ftx.id = tx.fuel_type_id
          WHERE tx.station_id = ${station.id}
            AND tx.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(tx.status, 'RECORDED') = 'RECORDED'
            AND (${pumpIdFilter} IS NULL OR tx.pump_id = ${pumpIdFilter})
            AND (${fuelFilter} IS NULL OR ftx.code = ${fuelFilter})
          GROUP BY COALESCE(pn.tank_id, p.tank_id)
        ) tx ON tx.tank_id = t.id
        LEFT JOIN (
          SELECT
            COALESCE(pn.tank_id, p.tank_id) AS tank_id,
            COUNT(tx.id) AS excluded_tx_count,
            COALESCE(SUM(tx.litres), 0) AS excluded_litres,
            COALESCE(SUM(tx.total_amount), 0) AS excluded_revenue
          FROM transactions tx
          LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
          LEFT JOIN pumps p ON p.id = tx.pump_id
          LEFT JOIN fuel_types ftx ON ftx.id = tx.fuel_type_id
          WHERE tx.station_id = ${station.id}
            AND tx.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(tx.status, 'RECORDED') <> 'RECORDED'
            AND (${pumpIdFilter} IS NULL OR tx.pump_id = ${pumpIdFilter})
            AND (${fuelFilter} IS NULL OR ftx.code = ${fuelFilter})
          GROUP BY COALESCE(pn.tank_id, p.tank_id)
        ) excluded_tx ON excluded_tx.tank_id = t.id
        WHERE t.station_id = ${station.id}
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        ORDER BY ft.code ASC, t.name ASC
      `,
      prisma.$queryRaw`
        SELECT public_id, severity, category, title, status, created_at
        FROM incidents
        WHERE station_id = ${station.id}
          AND status = 'OPEN'
          AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
        ORDER BY created_at DESC
        LIMIT 100
      `,
      prisma.$queryRaw`
        SELECT action_type, COUNT(*) AS action_count
        FROM audit_log
        WHERE station_id = ${station.id}
          AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
        GROUP BY action_type
        ORDER BY action_count DESC
        LIMIT 50
      `,
      prisma.$queryRaw`
        SELECT
          p.public_id AS pump_public_id,
          p.pump_number,
          COALESCE(
            CASE
              WHEN p.status = 'OFFLINE' THEN 'OFFLINE'
              WHEN p.status = 'PAUSED' THEN 'PAUSED'
              WHEN p.status = 'IDLE' THEN 'IDLE'
              WHEN SUM(CASE WHEN pn.status = 'DISPENSING' THEN 1 ELSE 0 END) > 0 THEN 'DISPENSING'
              WHEN COUNT(pn.id) = 0 THEN 'OFFLINE'
              WHEN COUNT(pn.id) > 0 AND SUM(CASE WHEN pn.status = 'OFFLINE' THEN 1 ELSE 0 END) = COUNT(pn.id) THEN 'OFFLINE'
              WHEN COUNT(pn.id) > 0 AND SUM(CASE WHEN pn.status = 'PAUSED' THEN 1 ELSE 0 END) = COUNT(pn.id) THEN 'PAUSED'
              WHEN SUM(CASE WHEN pn.status IN ('OFFLINE', 'PAUSED') THEN 1 ELSE 0 END) > 0 THEN 'DEGRADED'
              ELSE 'ACTIVE'
            END,
            p.status
          ) AS status,
          CASE
            WHEN COUNT(DISTINCT nft.code) = 0 THEN NULL
            WHEN COUNT(DISTINCT nft.code) = 1 THEN MAX(nft.code)
            ELSE 'MIXED'
          END AS fuel_code,
          ROUND(CASE WHEN COUNT(t.id) = 0 THEN 0 ELSE 100 END, 2) AS uptime_pct,
          COUNT(t.id) AS tx_count,
          COALESCE(SUM(t.litres), 0) AS litres_dispensed,
          COALESCE(SUM(t.total_amount), 0) AS revenue,
          COALESCE(AVG(TIMESTAMPDIFF(SECOND, t.occurred_at, t.created_at)), 0) AS avg_transaction_time_sec,
          (
            SELECT tx_last.total_amount
            FROM transactions tx_last
            WHERE tx_last.station_id = ${station.id}
              AND tx_last.pump_id = p.id
              AND COALESCE(tx_last.status, 'RECORDED') <> 'CANCELLED'
            ORDER BY tx_last.occurred_at DESC, tx_last.id DESC
            LIMIT 1
          ) AS last_sale_amount,
          (
            SELECT tx_last.occurred_at
            FROM transactions tx_last
            WHERE tx_last.station_id = ${station.id}
              AND tx_last.pump_id = p.id
              AND COALESCE(tx_last.status, 'RECORDED') <> 'CANCELLED'
            ORDER BY tx_last.occurred_at DESC, tx_last.id DESC
            LIMIT 1
          ) AS last_sale_at,
          (
            SELECT COUNT(*)
            FROM audit_log al
            WHERE al.station_id = ${station.id}
              AND al.action_type = 'PUMP_STATUS_UPDATE'
              AND al.created_at BETWEEN ${range.fromDt} AND ${range.toDt}
              AND al.payload LIKE CONCAT('%\"pumpPublicId\":\"', p.public_id, '\"%')
          ) AS status_change_count
        FROM pumps p
        LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id AND pn.station_id = p.station_id
        LEFT JOIN fuel_types nft ON nft.id = pn.fuel_type_id
        LEFT JOIN transactions t
          ON t.pump_id = p.id
         AND t.station_id = ${station.id}
         AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
         AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
         AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        LEFT JOIN fuel_types tft ON tft.id = t.fuel_type_id
        WHERE p.station_id = ${station.id}
          AND (${pumpIdFilter} IS NULL OR p.id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR tft.code = ${fuelFilter} OR nft.code = ${fuelFilter})
        GROUP BY p.id, p.public_id, p.pump_number, p.status
        ORDER BY p.pump_number ASC
      `,
      prisma.$queryRaw`
        SELECT
          DATE_FORMAT(joined_at, '%H:00') AS hour_bucket,
          COUNT(*) AS joined_count,
          SUM(status = 'SERVED') AS served_count,
          SUM(status = 'NO_SHOW') AS no_show_count,
          COALESCE(AVG(TIMESTAMPDIFF(MINUTE, joined_at, served_at)), 0) AS avg_wait_min
        FROM queue_entries
        WHERE station_id = ${station.id}
          AND joined_at BETWEEN ${range.fromDt} AND ${range.toDt}
        GROUP BY DATE_FORMAT(joined_at, '%H:00')
        ORDER BY hour_bucket ASC
      `,
      prisma.$queryRaw`
        SELECT is_queue_enabled
        FROM station_queue_settings
        WHERE station_id = ${station.id}
        LIMIT 1
      `,
      prisma.$queryRaw`
        SELECT id, action_type, payload, created_at
        FROM audit_log
        WHERE station_id = ${station.id}
          AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
        ORDER BY created_at DESC
        LIMIT 200
      `,
      prisma.$queryRaw`
        SELECT rn.id, rn.note_date, rn.note_text, rn.created_at, u.full_name
        FROM report_notes rn
        LEFT JOIN station_staff ss ON ss.id = rn.created_by_staff_id
        LEFT JOIN users u ON u.id = ss.user_id
        WHERE rn.station_id = ${station.id}
          AND rn.note_date BETWEEN ${range.from} AND ${range.to}
        ORDER BY rn.note_date DESC, rn.created_at DESC
        LIMIT 50
      `,
      prisma.$queryRaw`
        SELECT t.payment_method, SUM(t.litres) AS litres, SUM(t.total_amount) AS revenue, COUNT(*) AS tx_count
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
          AND (${pumpIdFilter} IS NULL OR t.pump_id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        GROUP BY t.payment_method
        ORDER BY tx_count DESC
      `,
      prisma.$queryRaw`
        SELECT DATE_FORMAT(t.occurred_at, '%H:00') AS hour_bucket, SUM(t.litres) AS litres, SUM(t.total_amount) AS revenue, COUNT(*) AS tx_count
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
          AND (${pumpIdFilter} IS NULL OR t.pump_id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        GROUP BY DATE_FORMAT(t.occurred_at, '%H:00')
        ORDER BY hour_bucket ASC
      `,
      prisma.$queryRaw`
        SELECT
          t.public_id,
          t.occurred_at,
          t.litres,
          t.total_amount,
          t.payment_method,
          t.status,
          t.settlement_impact_status,
          t.workflow_reason_code,
          t.workflow_note,
          tx_case.case_public_id AS compliance_case_public_id,
          tx_case.case_status AS compliance_case_status
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        LEFT JOIN (
          SELECT
            ial.target_public_id AS transaction_public_id,
            JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId')) AS case_public_id,
            cc.status AS case_status,
            ROW_NUMBER() OVER (
              PARTITION BY ial.target_public_id
              ORDER BY ial.created_at DESC
            ) AS row_num
          FROM internal_audit_log ial
          LEFT JOIN compliance_cases cc
            ON cc.public_id = JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
          WHERE ial.target_type = 'TRANSACTION'
            AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
        ) tx_case
          ON tx_case.transaction_public_id = t.public_id
         AND tx_case.row_num = 1
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND (${pumpIdFilter} IS NULL OR t.pump_id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        ORDER BY t.occurred_at DESC
        LIMIT 200
      `,
      prisma.$queryRaw`
        SELECT
          sb.public_id,
          sb.source_reference,
          sb.batch_date,
          sb.gross_amount,
          sb.fee_amount,
          sb.net_amount,
          sb.status,
          sb.related_entity_type,
          sb.related_entity_id,
          sb.source_transaction_reference,
          ur.public_id AS reservation_public_id,
          qe.public_id AS queue_entry_public_id,
          sb.created_at,
          COALESCE(ur.user_id, qe.user_id) AS user_id,
          u.public_id AS user_public_id,
          u.full_name AS user_full_name,
          u.phone_e164 AS user_phone,
          COALESCE(
            ur.requested_litres,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.liters')) AS DECIMAL(12,3)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.requestedLiters')) AS DECIMAL(12,3))
          ) AS requested_litres,
          ft.code AS fuel_code,
          (
            SELECT t.public_id
            FROM transactions t
            WHERE t.station_id = sb.station_id
              AND (
                t.reservation_public_id = sb.related_entity_id
                OR (COALESCE(ur.source_queue_entry_id, qe.id) IS NOT NULL AND t.queue_entry_id = COALESCE(ur.source_queue_entry_id, qe.id))
              )
            ORDER BY t.occurred_at DESC, t.id DESC
            LIMIT 1
          ) AS forecourt_transaction_public_id,
          (
            SELECT t.payment_method
            FROM transactions t
            WHERE t.station_id = sb.station_id
              AND (
                t.reservation_public_id = sb.related_entity_id
                OR (COALESCE(ur.source_queue_entry_id, qe.id) IS NOT NULL AND t.queue_entry_id = COALESCE(ur.source_queue_entry_id, qe.id))
              )
            ORDER BY t.occurred_at DESC, t.id DESC
            LIMIT 1
          ) AS forecourt_payment_method,
          (
            SELECT t.litres
            FROM transactions t
            WHERE t.station_id = sb.station_id
              AND (
                t.reservation_public_id = sb.related_entity_id
                OR (COALESCE(ur.source_queue_entry_id, qe.id) IS NOT NULL AND t.queue_entry_id = COALESCE(ur.source_queue_entry_id, qe.id))
              )
            ORDER BY t.occurred_at DESC, t.id DESC
            LIMIT 1
          ) AS forecourt_litres,
          (
            SELECT t.occurred_at
            FROM transactions t
            WHERE t.station_id = sb.station_id
              AND (
                t.reservation_public_id = sb.related_entity_id
                OR (COALESCE(ur.source_queue_entry_id, qe.id) IS NOT NULL AND t.queue_entry_id = COALESCE(ur.source_queue_entry_id, qe.id))
              )
            ORDER BY t.occurred_at DESC, t.id DESC
            LIMIT 1
          ) AS forecourt_occurred_at
        FROM settlement_batches sb
        LEFT JOIN user_reservations ur
          ON sb.related_entity_type = 'RESERVATION'
         AND ur.public_id = sb.related_entity_id
        LEFT JOIN queue_entries qe
          ON (sb.related_entity_type = 'QUEUE' AND qe.public_id = sb.related_entity_id)
          OR (ur.source_queue_entry_id IS NOT NULL AND qe.id = ur.source_queue_entry_id)
        LEFT JOIN users u ON u.id = COALESCE(ur.user_id, qe.user_id)
        LEFT JOIN fuel_types ft ON ft.id = COALESCE(ur.fuel_type_id, qe.fuel_type_id)
        WHERE sb.station_id = ${station.id}
          AND sb.batch_date BETWEEN ${range.from} AND ${range.to}
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        ORDER BY sb.batch_date DESC, sb.created_at DESC, sb.id DESC
        LIMIT 200
      `,
      prisma.$queryRaw`
        SELECT
          COUNT(*) AS settlement_count,
          COALESCE(SUM(sb.net_amount), 0) AS settlement_value,
          SUM(CASE WHEN sb.status IN ('PENDING', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS pending_count,
          COALESCE(SUM(CASE WHEN sb.status IN ('PENDING', 'UNDER_REVIEW') THEN sb.net_amount ELSE 0 END), 0) AS pending_value,
          SUM(CASE WHEN sb.status = 'PAID' THEN 1 ELSE 0 END) AS paid_count
        FROM settlement_batches sb
        LEFT JOIN user_reservations ur
          ON sb.related_entity_type = 'RESERVATION'
         AND ur.public_id = sb.related_entity_id
        LEFT JOIN queue_entries qe
          ON (sb.related_entity_type = 'QUEUE' AND qe.public_id = sb.related_entity_id)
          OR (ur.source_queue_entry_id IS NOT NULL AND qe.id = ur.source_queue_entry_id)
        LEFT JOIN fuel_types ft ON ft.id = COALESCE(ur.fuel_type_id, qe.fuel_type_id)
        WHERE sb.station_id = ${station.id}
          AND sb.batch_date BETWEEN ${range.from} AND ${range.to}
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
      `,
      prisma.$queryRaw`
        SELECT
          t.public_id,
          t.occurred_at,
          ft.code AS fuel_code,
          p.public_id AS pump_public_id,
          p.pump_number,
          pn.public_id AS nozzle_public_id,
          pn.nozzle_number,
          pn.side AS nozzle_side,
          t.litres,
          t.payment_method,
          t.status,
          t.settlement_impact_status,
          t.workflow_reason_code,
          t.workflow_note,
          t.total_amount,
          tx_case.case_public_id AS compliance_case_public_id,
          tx_case.case_status AS compliance_case_status,
          tx_case.case_action_taken AS compliance_case_action_taken
        FROM transactions t
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        LEFT JOIN pumps p ON p.id = t.pump_id
        LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
        LEFT JOIN (
          SELECT
            ial.target_public_id AS transaction_public_id,
            JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId')) AS case_public_id,
            cc.status AS case_status,
            cc.action_taken AS case_action_taken,
            ROW_NUMBER() OVER (
              PARTITION BY ial.target_public_id
              ORDER BY ial.created_at DESC
            ) AS row_num
          FROM internal_audit_log ial
          LEFT JOIN compliance_cases cc
            ON cc.public_id = JSON_UNQUOTE(JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId'))
          WHERE ial.target_type = 'TRANSACTION'
            AND JSON_EXTRACT(ial.metadata, '$.complianceCasePublicId') IS NOT NULL
        ) tx_case
          ON tx_case.transaction_public_id = t.public_id
         AND tx_case.row_num = 1
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'RECORDED'
        ORDER BY t.occurred_at DESC
        LIMIT 25
      `,
      prisma.$queryRaw`
        SELECT COUNT(*) AS inspected_tx_count
        FROM transactions t
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(t.status, 'RECORDED') <> 'RECORDED'
      `,
      prisma.$queryRaw`
        SELECT
          COALESCE(AVG(TIMESTAMPDIFF(MINUTE, joined_at, served_at)), 0) AS avg_wait_min,
          COALESCE(100 * SUM(status = 'NO_SHOW') / NULLIF(COUNT(*), 0), 0) AS no_show_rate
        FROM queue_entries
        WHERE station_id = ${station.id}
          AND joined_at BETWEEN ${range.fromDt} AND ${range.toDt}
      `,
      prisma.$queryRaw`
        SELECT
          ir.id,
          ir.station_id,
          ir.tank_id,
          t.public_id AS tank_public_id,
          t.name AS tank_name,
          ft.code AS fuel_code,
          ir.reading_type,
          ir.reading_time,
          ir.litres,
          ir.recorded_by_staff_id,
          ir.note,
          ir.created_at
        FROM inventory_readings ir
        INNER JOIN tanks t ON t.id = ir.tank_id
        INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE ir.station_id = ${station.id}
          AND ir.reading_time BETWEEN ${range.fromDt} AND ${range.toDt}
        ORDER BY ir.reading_time DESC, ir.id DESC
      `,
      prisma.$queryRaw`
        SELECT
          p.public_id AS pump_public_id,
          p.pump_number,
          ft.code AS fuel_code,
          COUNT(t.id) AS tx_count,
          COALESCE(SUM(t.litres), 0) AS litres_dispensed,
          COALESCE(SUM(t.total_amount), 0) AS revenue,
          COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS avg_price_per_litre
        FROM pumps p
        LEFT JOIN transactions t
          ON t.pump_id = p.id
         AND t.station_id = ${station.id}
         AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
        WHERE p.station_id = ${station.id}
          AND (${pumpIdFilter} IS NULL OR p.id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        GROUP BY p.id, p.public_id, p.pump_number, ft.code
        ORDER BY p.pump_number ASC, ft.code ASC
      `,
      prisma.$queryRaw`
        SELECT
          p.public_id AS pump_public_id,
          p.pump_number,
          pn.public_id AS nozzle_public_id,
          pn.nozzle_number,
          pn.side,
          pn.status,
          ft.code AS fuel_code,
          COUNT(t.id) AS tx_count,
          COALESCE(SUM(t.litres), 0) AS litres_dispensed,
          COALESCE(SUM(t.total_amount), 0) AS revenue,
          COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS avg_price_per_litre
        FROM pump_nozzles pn
        INNER JOIN pumps p ON p.id = pn.pump_id
        LEFT JOIN transactions t
          ON t.nozzle_id = pn.id
         AND t.station_id = ${station.id}
         AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
         AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
        WHERE pn.station_id = ${station.id}
          AND (${pumpIdFilter} IS NULL OR pn.pump_id = ${pumpIdFilter})
          AND (${fuelFilter} IS NULL OR ft.code = ${fuelFilter})
        GROUP BY pn.id, p.public_id, p.pump_number, pn.public_id, pn.nozzle_number, pn.side, pn.status, ft.code
        ORDER BY p.pump_number ASC, pn.nozzle_number ASC
      `,
      prisma.$queryRaw`
        SELECT
          p.public_id AS pump_public_id,
          p.pump_number,
          pn.public_id AS nozzle_public_id,
          pn.nozzle_number,
          pn.side,
          ft.code AS fuel_code,
          pn.status
        FROM pump_nozzles pn
        INNER JOIN pumps p ON p.id = pn.pump_id
        LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
        WHERE pn.station_id = ${station.id}
          AND pn.status = 'OFFLINE'
        ORDER BY p.pump_number ASC, pn.nozzle_number ASC
      `,
      prisma.$queryRaw`
        SELECT COUNT(*) AS missing_count
        FROM transactions t
        WHERE t.station_id = ${station.id}
          AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND t.pump_id IS NOT NULL
          AND t.nozzle_id IS NULL
      `,
      prisma.$queryRaw`
        SELECT
          SUM(action_type = 'TRANSACTION_VOID') AS void_count,
          SUM(action_type = 'TRANSACTION_OVERRIDE') AS override_count
        FROM audit_log
        WHERE station_id = ${station.id}
          AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
      `,
      getDemandAnomalyMetrics({
        stationId: station.id,
        stationPublicId: station.public_id,
        window: "15m",
      }),
      listDemandAnomalyEvents({
        stationId: station.id,
        from: new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString(),
        to: new Date().toISOString(),
      }),
    ])

    const kpi = fuelTypeSummary.reduce(
      (acc, row) => {
        const litres = Number(row.litres || 0)
        const revenue = Number(row.revenue || 0)
        const txCount = Number(row.tx_count || 0)
        acc.total_litres += litres
        acc.revenue += revenue
        acc.transactions += txCount
        return acc
      },
      { total_litres: 0, revenue: 0, transactions: 0 }
    )
    kpi.avg_price_per_litre = kpi.total_litres > 0 ? kpi.revenue / kpi.total_litres : 0
    kpi.queue_no_show_rate = Number(queueSummary?.[0]?.no_show_rate || 0)

    const totals = reconciliation.reduce(
      (acc, row) => {
        const hasOpening =
          row.opening_litres !== null &&
          row.opening_litres !== undefined &&
          row.opening_time !== null &&
          row.opening_time !== undefined
        const hasClosing =
          row.closing_litres !== null &&
          row.closing_litres !== undefined &&
          row.closing_time !== null &&
          row.closing_time !== undefined
        const delivered = Number(row.delivered_litres || 0)
        if (!hasOpening || !hasClosing) {
          return acc
        }
        const opening = Number(row.opening_litres || 0)
        const closing = Number(row.closing_litres || 0)
        const bookSales = opening + delivered - closing
        const recorded = Number(row.recorded_litres || 0)
        acc.bookSales += bookSales
        acc.recordedSales += recorded
        acc.eligibleCount += 1
        return acc
      },
      { bookSales: 0, recordedSales: 0, eligibleCount: 0 }
    )

    const hasComputableVarianceRows = totals.eligibleCount > 0
    const varianceLitres = hasComputableVarianceRows
      ? totals.bookSales - totals.recordedSales
      : null
    const variancePct = !hasComputableVarianceRows
      ? null
      : totals.bookSales > 0
        ? (varianceLitres / totals.bookSales) * 100
        : 0

    const reportRun = await getReportRunState(station.id, range.from, range.to)
    const missingNozzleCount = Number(missingNozzleRows?.[0]?.missing_count || 0)
    const voidCount = Number(voidsAndOverrides?.[0]?.void_count || 0)
    const overrideCount = Number(voidsAndOverrides?.[0]?.override_count || 0)
    const inspectedTransactionCount = Number(inspectedTransactionCountRows?.[0]?.inspected_tx_count || 0)

    const data = {
      reportRun,
      filters: query,
      kpis: {
        totalLitres: Number(kpi.total_litres || 0),
        revenue: Number(kpi.revenue || 0),
        transactions: Number(kpi.transactions || 0),
        avgPricePerLitre: Number(kpi.avg_price_per_litre || 0),
        bookSales: hasComputableVarianceRows ? totals.bookSales : null,
        recordedSales: hasComputableVarianceRows ? totals.recordedSales : null,
        varianceLitres,
        variancePct,
        queueNoShowRate: Number(queueSummary?.[0]?.no_show_rate || kpi.queue_no_show_rate || 0),
        queueAvgWaitMin: Number(queueSummary?.[0]?.avg_wait_min || 0),
      },
      salesDaily,
      salesByPayment,
      salesByHour,
      recentTransactions,
      settlements: settlementRows,
      settlementSummary: settlementSummaryRows?.[0] || null,
      queueDaily,
      pumpMetrics,
      fuelTypeSummary,
      pumpRollup,
      nozzleBreakdown,
      exceptions: {
        offlineNozzles,
        missingNozzleTxCount: missingNozzleCount,
        voidCount,
        overrideCount,
        transactionInspectionCount: inspectedTransactionCount,
        transactionInspectionItems: inspectedTransactions,
        warnings: [
          ...(missingNozzleCount > 0
            ? [`${missingNozzleCount} transactions are missing nozzle mapping in selected range`]
            : []),
          ...(offlineNozzles.length > 0
            ? [`${offlineNozzles.length} ${offlineNozzles.length === 1 ? "nozzle" : "nozzles"} ${offlineNozzles.length === 1 ? "is" : "are"} currently OFFLINE`]
            : []),
          ...(inspectedTransactionCount > 0
            ? [`${inspectedTransactionCount} ${inspectedTransactionCount === 1 ? "transaction is" : "transactions are"} under review or cancelled and excluded from reconciliation`]
            : []),
        ],
      },
      queueHourly,
      queueEnabled: Boolean(Number(queueSettings?.[0]?.is_queue_enabled ?? 1)),
      demandAnomaly: {
        ...demandMetrics,
        events: demandEvents,
      },
      reconciliation,
      incidents,
      auditSummaries,
      auditRows,
      notesRows,
      inventoryReadings,
    }

    return ok(res, serializeStationLocalDates(data, station.timezone || "Africa/Blantyre"))
  })
)

router.get(
  "/stations/:stationPublicId/insights/summary",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = insightsSummaryQuerySchema.parse(req.query || {})
    const data = await getInsightsSummary({
      stationId: station.id,
      date: query.date,
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/sales-velocity",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = insightsVelocityQuerySchema.parse(req.query || {})
    const data = await getInsightsSalesVelocity({
      stationId: station.id,
      window: query.window || "1h",
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/pump-utilization",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = insightsVelocityQuerySchema.parse(req.query || {})
    const data = await getInsightsPumpUtilization({
      stationId: station.id,
      window: query.window || "6h",
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/inventory-prediction",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const data = await getInsightsInventoryPrediction({
      stationId: station.id,
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/queue-prediction",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const data = await getInsightsQueuePrediction({
      stationId: station.id,
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/demand-forecast",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = insightsForecastQuerySchema.parse(req.query || {})
    const data = await getInsightsDemandForecast({
      stationId: station.id,
      hours: query.hours || 6,
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/alerts",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const data = await getInsightsAlerts({
      stationId: station.id,
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/export/pdf",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const query = insightsSummaryQuerySchema.parse(req.query || {})
    const targetDate = query.date || appTodayISO()
    const generatedBy = req.auth?.userPublicId || "Station Staff"

    const [summary, salesVelocity, pumpUtilization, inventoryPrediction, queuePrediction, demandForecast, operationalAlerts] =
      await Promise.all([
        getInsightsSummary({ stationId: station.id, date: targetDate }),
        getInsightsSalesVelocity({ stationId: station.id, window: "1h" }),
        getInsightsPumpUtilization({ stationId: station.id, window: "6h" }),
        getInsightsInventoryPrediction({ stationId: station.id }),
        getInsightsQueuePrediction({ stationId: station.id }),
        getInsightsDemandForecast({ stationId: station.id, hours: 6 }),
        getInsightsAlerts({ stationId: station.id }),
      ])

    const filename = `smartlink_${safeFilenamePart(station.name || station.public_id)}_insights_${targetDate}.pdf`

    res.status(200)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename))
    res.setHeader("Cache-Control", "no-store")

    await streamInsightsPdf({
      res,
      station,
      generatedBy,
      targetDate,
      snapshot: {
        summary,
        salesVelocity,
        pumpUtilization,
        inventoryPrediction,
        queuePrediction,
        demandForecast,
        operationalAlerts,
      },
    })

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "INSIGHTS_EXPORT_PDF",
      payload: {
        date: targetDate,
        filename,
      },
    })
  })
)

router.get(
  "/stations/:stationPublicId/insights/demand-metrics",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = demandMetricsQuerySchema.parse(req.query || {})
    const data = await getDemandAnomalyMetrics({
      stationId: station.id,
      stationPublicId: station.public_id,
      window: query.window || "15m",
    })
    return ok(res, data)
  })
)

router.get(
  "/stations/:stationPublicId/insights/demand-anomalies",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.INSIGHTS),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = demandAnomalyEventsQuerySchema.parse(req.query || {})
    const data = await listDemandAnomalyEvents({
      stationId: station.id,
      from: query.from,
      to: query.to,
    })
    return ok(res, {
      from: query.from || null,
      to: query.to || null,
      items: data,
    })
  })
)

router.post(
  "/stations/:stationPublicId/reports/generate",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const reportRun = {
      id: `RUN-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: "DRAFT",
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_GENERATE",
      payload: reportRun,
    })

    return ok(res, reportRun, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/export/csv",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const section = String(req.body?.section || "report")
    const placeholderUrl = `mock://reports/${station.public_id}/${section}-${Date.now()}.csv`

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_EXPORT_CSV",
      payload: { section, placeholderUrl },
    })

    return ok(res, { url: placeholderUrl })
  })
)

router.post(
  "/stations/:stationPublicId/reports/export/pdf",
  requireStationScope,
  requireStationPlanFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT),
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const placeholderUrl = `mock://reports/${station.public_id}/report-${Date.now()}.pdf`

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_EXPORT_PDF",
      payload: { placeholderUrl },
    })

    return ok(res, { url: placeholderUrl })
  })
)

router.post(
  "/stations/:stationPublicId/reports/deliveries",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = deliverySchema.parse(req.body || {})
    const tankId = await resolveTankId(station.id, body)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const deliveredLitres = Number(body.deliveredLitres)
    const arrivalTime = parseDeliveryArrivalTime(body.arrivalTime)
    const fuelType = await getTankFuelType(station.id, tankId)

    const existingRows = await prisma.$queryRaw`
      SELECT id
      FROM fuel_deliveries
      WHERE station_id = ${station.id}
        AND tank_id = ${tankId}
        AND DATE(delivered_time) = DATE(${arrivalTime})
      ORDER BY delivered_time DESC, id DESC
      LIMIT 1
    `

    const existing = existingRows?.[0]
    let deliveryOp = "inserted"
    if (existing?.id) {
      await prisma.$executeRaw`
        UPDATE fuel_deliveries
        SET
          delivered_time = ${arrivalTime},
          litres = ${deliveredLitres},
          supplier_name = ${body.supplierName || null},
          reference_code = ${body.referenceCode || null},
          recorded_by_staff_id = ${actorStaffId},
          note = ${body.note || "Updated from reports UI"}
        WHERE id = ${existing.id}
      `
      deliveryOp = "updated"
    } else {
      await prisma.$executeRaw`
        INSERT INTO fuel_deliveries (
          station_id, tank_id, delivered_time, litres, supplier_name, reference_code, recorded_by_staff_id, note
        )
        VALUES (
          ${station.id},
          ${tankId},
          ${arrivalTime},
          ${deliveredLitres},
          ${body.supplierName || null},
          ${body.referenceCode || null},
          ${actorStaffId},
          ${body.note || "Entered from reports UI"}
        )
      `
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_ADD_DELIVERY",
      payload: {
        ...body,
        arrivalTime: arrivalTime.toISOString(),
        deliveryOp,
      },
    })

    await notifyUsersOfScheduledStationRestock({
      station,
      fuelType,
      arrivalTime,
      deliveredLitres,
      supplierName: body.supplierName || null,
    }).catch(() => {})

    return ok(res, { saved: true, deliveryOp }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/readings",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = readingsSchema.parse(req.body || {})
    const tankId = await resolveTankId(station.id, body)
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)

    async function upsertReadingForToday(readingType, litresValue) {
      const existingRows = await prisma.$queryRaw`
        SELECT id
        FROM inventory_readings
        WHERE station_id = ${station.id}
          AND tank_id = ${tankId}
          AND reading_type = ${readingType}
          AND DATE(reading_time) = CURRENT_DATE()
        ORDER BY reading_time DESC, id DESC
        LIMIT 1
      `

      const existing = existingRows?.[0]
      if (existing?.id) {
        await prisma.$executeRaw`
          UPDATE inventory_readings
          SET
            litres = ${Number(litresValue)},
            recorded_by_staff_id = ${actorStaffId},
            note = ${"Updated from reports UI"},
            reading_time = CURRENT_TIMESTAMP(3)
          WHERE id = ${existing.id}
        `
        return "updated"
      }

      await prisma.$executeRaw`
        INSERT INTO inventory_readings (
          station_id, tank_id, reading_type, reading_time, litres, recorded_by_staff_id, note
        )
        VALUES (
          ${station.id},
          ${tankId},
          ${readingType},
          CURRENT_TIMESTAMP(3),
          ${Number(litresValue)},
          ${actorStaffId},
          ${"Entered from reports UI"}
        )
      `
      return "inserted"
    }

    const readingOps = {}
    if (body.opening !== undefined && body.opening !== "") {
      readingOps.opening = await upsertReadingForToday("OPENING", body.opening)
    }

    if (body.closing !== undefined && body.closing !== "") {
      readingOps.closing = await upsertReadingForToday("CLOSING", body.closing)
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_ADD_READING",
      payload: { ...body, readingOps },
    })

    return ok(res, { saved: true, readingOps }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/variance",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = varianceSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_EXPLAIN_VARIANCE",
      payload: body,
    })

    return ok(res, { saved: true }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/variance-alerts",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = varianceAlertsSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    let created = 0
    let updated = 0
    let resolved = 0
    const processedKeys = new Set()

    for (const row of body.rows) {
      const absVariancePct = Math.abs(Number(row.variancePct || 0))
      if (absVariancePct < body.thresholdPct) continue
      const normalizedFuel = String(row.fuelType || "").trim().toUpperCase()
      const normalizedTank = String(row.tankPublicId || row.tankName || "")
        .trim()
        .toLowerCase()
      const varianceKey = `${normalizedFuel}|${normalizedTank}|${body.fromDate}|${body.toDate}`
      if (processedKeys.has(varianceKey)) continue
      processedKeys.add(varianceKey)

      const title = `High variance ${row.fuelType} ${row.tankName} ${body.fromDate}`
      const description =
        `Variance ${row.varianceLitres.toFixed(3)}L (${row.variancePct.toFixed(3)}%). ` +
        `Book Sales ${row.bookSales.toFixed(3)}L vs Recorded ${row.recordedSales.toFixed(3)}L. ` +
        `Range ${body.fromDate} to ${body.toDate}. [key:${varianceKey}]`

      const existingRows = await prisma.$queryRaw`
        SELECT id, public_id
        FROM incidents
        WHERE station_id = ${station.id}
          AND category = 'VARIANCE'
          AND (
            title = ${title}
            OR description LIKE CONCAT('%[key:', ${varianceKey}, ']%')
          )
        ORDER BY updated_at DESC
        LIMIT 1
      `
      const existing = existingRows?.[0]

      if (existing) {
        await prisma.$executeRaw`
          UPDATE incidents
          SET severity = ${absVariancePct >= 1 ? "HIGH" : "MEDIUM"},
              title = ${title},
              description = ${description},
              status = 'OPEN'
          WHERE id = ${existing.id}
        `
        updated += 1
      } else {
        await prisma.$executeRaw`
          INSERT INTO incidents (
            station_id, public_id, severity, category, title, description, status, created_by_staff_id
          )
          VALUES (
            ${station.id},
            ${createPublicId()},
            ${absVariancePct >= 1 ? "HIGH" : "MEDIUM"},
            'VARIANCE',
            ${title},
            ${description},
            'OPEN',
            ${actorStaffId}
          )
        `
        created += 1
      }
    }

    const openVarianceRows = await prisma.$queryRaw`
      SELECT id, description
      FROM incidents
      WHERE station_id = ${station.id}
        AND category = 'VARIANCE'
        AND status = 'OPEN'
        AND description LIKE CONCAT('%|', ${body.fromDate}, '|', ${body.toDate}, ']%')
      ORDER BY updated_at DESC
      LIMIT 500
    `

    for (const incident of openVarianceRows || []) {
      const description = String(incident.description || "")
      const keyMatch = description.match(/\[key:([^\]]+)\]/)
      const varianceKey = keyMatch?.[1] || null
      if (!varianceKey) continue
      if (processedKeys.has(varianceKey)) continue

      await prisma.$executeRaw`
        UPDATE incidents
        SET status = 'RESOLVED'
        WHERE id = ${incident.id}
      `
      resolved += 1
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_VARIANCE_ALERTS_SYNC",
      payload: {
        fromDate: body.fromDate,
        toDate: body.toDate,
        thresholdPct: body.thresholdPct,
        totalRows: body.rows.length,
        created,
        updated,
        resolved,
      },
    })

    return ok(res, { created, updated, resolved })
  })
)

router.post(
  "/stations/:stationPublicId/reports/incidents",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = incidentSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const incidentPublicId = createPublicId()

    await prisma.$executeRaw`
      INSERT INTO incidents (
        station_id, public_id, severity, category, title, description, status, created_by_staff_id
      )
      VALUES (
        ${station.id},
        ${incidentPublicId},
        ${body.severity},
        ${body.category},
        ${body.title},
        ${body.description || null},
        'OPEN',
        ${actorStaffId}
      )
    `

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_CREATE_INCIDENT",
      payload: { ...body, incidentPublicId },
    })

    return ok(res, { publicId: incidentPublicId }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/notes",
  requireStationScope,
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = noteSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)

    await prisma.$executeRaw`
      INSERT INTO report_notes (station_id, note_date, note_text, created_by_staff_id)
      VALUES (${station.id}, UTC_DATE(), ${body.text}, ${actorStaffId})
      ON DUPLICATE KEY UPDATE
        note_text = VALUES(note_text),
        created_by_staff_id = VALUES(created_by_staff_id)
    `

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_ADD_NOTE",
      payload: body,
    })

    return ok(res, { saved: true }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reports/finalize",
  requireStationScope,
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = runSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const fromDate = body.fromDate || appTodayISO() || "1970-01-01"
    const toDate = body.toDate || fromDate
    const fromDt = `${fromDate} 00:00:00`
    const toDt = `${toDate} 23:59:59`

    const missingClosingRows = await prisma.$queryRaw`
      SELECT t.public_id, t.name
      FROM tanks t
      WHERE t.station_id = ${station.id}
        AND t.is_active = 1
        AND NOT EXISTS (
          SELECT 1
          FROM inventory_readings ir
          WHERE ir.station_id = ${station.id}
            AND ir.tank_id = t.id
            AND ir.reading_type = 'CLOSING'
            AND ir.reading_time BETWEEN ${fromDt} AND ${toDt}
        )
      ORDER BY t.name ASC
    `

    if ((missingClosingRows || []).length > 0) {
      const missingTanks = missingClosingRows.map((row) => row.name || row.public_id)
      throw badRequest(
        `Cannot finalize report: missing closing reading for ${missingTanks.join(", ")}.`
      )
    }

    const finalizedRun = {
      id: body.reportRunId || `RUN-${fromDate}-to-${toDate}`,
      fromDate,
      toDate,
      status: "FINAL",
      finalizedAt: new Date().toISOString(),
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_FINALIZE",
      payload: finalizedRun,
    })

    return ok(res, finalizedRun)
  })
)

router.post(
  "/stations/:stationPublicId/reports/unfinalize",
  requireStationScope,
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const body = runSchema.parse(req.body || {})
    const actorStaffId = await resolveActorStaffId(station.id, req.auth?.userId)
    const fromDate = body.fromDate || appTodayISO() || "1970-01-01"
    const toDate = body.toDate || fromDate
    const reopenedRun = {
      id: body.reportRunId || `RUN-${fromDate}-to-${toDate}`,
      fromDate,
      toDate,
      status: "DRAFT",
      reopenedAt: new Date().toISOString(),
    }

    await writeAuditLog({
      stationId: station.id,
      actorStaffId,
      actionType: "REPORT_UNFINALIZE",
      payload: reopenedRun,
    })

    return ok(res, reopenedRun)
  })
)

export default router

import { prisma } from "../../db/prisma.js"
import { formatDateTimeSqlInTimeZone } from "../../utils/dateTime.js"

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "LATE"]
const DEFAULT_ML_SERVICE_URL = "http://localhost:8001"
const DEFAULT_ML_TIMEOUT_MS = 2500

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback
  if (typeof value === "bigint") {
    const cast = Number(value)
    return Number.isFinite(cast) ? cast : fallback
  }
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function upstreamError(message, status = 502) {
  const error = new Error(message)
  error.status = status
  return error
}

export function normalizeFuelType(value) {
  const normalized = String(value || "PETROL").trim().toUpperCase()
  return normalized === "DIESEL" ? "DIESEL" : "PETROL"
}

export function buildMlServiceUrl(path = "/predict") {
  const base = String(process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL).trim() || DEFAULT_ML_SERVICE_URL
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${base.replace(/\/+$/, "")}${normalizedPath}`
}

function getMlTimeoutMs() {
  const parsed = Number(process.env.ML_SERVICE_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ML_TIMEOUT_MS
}

export async function callMlPrediction(payload, { fetchImpl = globalThis.fetch, timeoutMs = getMlTimeoutMs() } = {}) {
  if (typeof fetchImpl !== "function") {
    throw upstreamError("ML service fetch runtime is not available.")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(buildMlServiceUrl("/predict"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    let body = null
    try {
      body = await response.json()
    } catch (_error) {
      body = null
    }

    if (!response.ok) {
      const detail = body?.detail || body?.message || response.statusText || "ML service request failed"
      throw upstreamError(`ML service request failed: ${detail}`, response.status >= 500 ? 502 : response.status)
    }

    return body
  } catch (error) {
    if (error?.name === "AbortError") {
      throw upstreamError(`ML service request timed out after ${timeoutMs}ms.`)
    }
    if (error?.status) throw error
    throw upstreamError(`ML service is unavailable: ${error?.message || "request failed"}`)
  } finally {
    clearTimeout(timer)
  }
}

function getStationLocalParts(now, timeZone) {
  const local = formatDateTimeSqlInTimeZone(now, timeZone || "Africa/Blantyre")
  const [datePart = "", timePart = "00:00:00"] = String(local || "").split(" ")
  const hour = Number(timePart.slice(0, 2))
  const day = Number(datePart.slice(8, 10))
  const weekday = new Date(`${datePart || "1970-01-01"}T00:00:00Z`).getUTCDay()
  const dayOfWeek = (weekday + 6) % 7

  return {
    hourOfDay: Number.isFinite(hour) ? hour : 0,
    dayOfWeek,
    isWeekend: dayOfWeek === 5 || dayOfWeek === 6,
    isPaydayWeek: Number.isFinite(day) && (day >= 25 || day <= 3),
  }
}

function pressureFromNearbyRows(rows, fuelType) {
  if (!rows?.length) return 0.3

  const scores = rows.map((row) => {
    const fuelStatus = String(
      fuelType === "DIESEL" ? row.diesel_status : row.petrol_status
    ).toUpperCase()
    const fuelLevel = String(row.fuel_level || "").toUpperCase()
    const availability = String(row.availability_status || "").toUpperCase()

    if (fuelStatus === "DRY") return 1
    if (fuelStatus === "LIMITED") return 0.7
    if (fuelLevel === "LOW") return 0.8
    if (availability === "IN_USE") return 0.45
    if (fuelLevel === "MEDIUM") return 0.35
    return 0.15
  })

  return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length, 0, 1)
}

function roundNonNegative(value) {
  return Math.max(0, Math.round(toFiniteNumber(value, 0)))
}

export async function buildOpsPredictionPayload({ station, fuelType, now = new Date() }) {
  const normalizedFuelType = normalizeFuelType(fuelType)
  const stationRows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, timezone, fuel_level, availability_status
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  const stationRow = stationRows?.[0] || station
  const fuelRows = await prisma.$queryRaw`
    SELECT id
    FROM fuel_types
    WHERE code = ${normalizedFuelType}
    LIMIT 1
  `
  const fuelTypeId = fuelRows?.[0]?.id
  if (!fuelTypeId) {
    throw upstreamError(`Fuel type is not configured: ${normalizedFuelType}`, 400)
  }

  const [
    queueRows,
    reservationRows,
    capacityRows,
    stockRows,
    movementRows,
    deliveryRows,
    walkInRows,
    complaintRows,
    overrideRows,
    incidentRows,
    nearbyRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        SUM(status IN (${ACTIVE_QUEUE_STATUSES[0]}, ${ACTIVE_QUEUE_STATUSES[1]}, ${ACTIVE_QUEUE_STATUSES[2]})) AS current_queue_length,
        SUM(joined_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)) AS arrivals_last_15m,
        SUM(status = 'SERVED' AND served_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE)) AS departures_last_15m,
        AVG(
          CASE
            WHEN status = 'SERVED'
             AND served_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
             AND COALESCE(called_at, joined_at) IS NOT NULL
            THEN TIMESTAMPDIFF(SECOND, COALESCE(called_at, joined_at), served_at)
            ELSE NULL
          END
        ) AS avg_service_time_sec_15m
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND fuel_type_id = ${fuelTypeId}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS reservations_next_30m
      FROM user_reservations
      WHERE station_id = ${station.id}
        AND fuel_type_id = ${fuelTypeId}
        AND status IN ('PENDING', 'CONFIRMED')
        AND (
          slot_start BETWEEN CURRENT_TIMESTAMP(3) AND DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE)
          OR (slot_start IS NULL AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE))
        )
    `,
    prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN p.is_active = 1 AND p.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_pumps_all,
        SUM(CASE WHEN p.is_active = 1 AND p.status = 'ACTIVE' AND p.fuel_type_id = ${fuelTypeId} THEN 1 ELSE 0 END) AS active_pumps_fuel,
        (
          SELECT COUNT(*)
          FROM pump_nozzles pn
          WHERE pn.station_id = ${station.id}
            AND pn.is_active = 1
            AND pn.status = 'ACTIVE'
        ) AS active_nozzles_all,
        (
          SELECT COUNT(*)
          FROM pump_nozzles pn
          WHERE pn.station_id = ${station.id}
            AND pn.is_active = 1
            AND pn.status = 'ACTIVE'
            AND pn.fuel_type_id = ${fuelTypeId}
        ) AS active_nozzles_fuel,
        SUM(CASE WHEN p.is_active = 1 AND p.status <> 'ACTIVE' THEN 1 ELSE 0 END) AS inactive_pumps
      FROM pumps p
      WHERE p.station_id = ${station.id}
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(t.capacity_litres), 0) AS capacity_litres,
        COALESCE(SUM(latest.latest_litres), 0) AS latest_litres
      FROM tanks t
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS latest_litres
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${station.id}
          GROUP BY tank_id
        ) latest_reading
          ON latest_reading.tank_id = ir.tank_id
         AND latest_reading.reading_time = ir.reading_time
        WHERE ir.station_id = ${station.id}
      ) latest ON latest.tank_id = t.id
      WHERE t.station_id = ${station.id}
        AND t.fuel_type_id = ${fuelTypeId}
        AND t.is_active = 1
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE((
          SELECT SUM(fd.litres)
          FROM fuel_deliveries fd
          INNER JOIN tanks dt ON dt.id = fd.tank_id
          WHERE fd.station_id = ${station.id}
            AND dt.fuel_type_id = ${fuelTypeId}
            AND fd.delivered_time >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
        ), 0) AS delivered_last_24h,
        COALESCE((
          SELECT SUM(tx.litres)
          FROM transactions tx
          WHERE tx.station_id = ${station.id}
            AND tx.fuel_type_id = ${fuelTypeId}
            AND tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
            AND COALESCE(tx.status, 'RECORDED') <> 'CANCELLED'
        ), 0) AS sold_last_24h
    `,
    prisma.$queryRaw`
      SELECT MIN(TIMESTAMPDIFF(MINUTE, CURRENT_TIMESTAMP(3), delivered_time)) AS delivery_eta_minutes
      FROM fuel_deliveries fd
      INNER JOIN tanks t ON t.id = fd.tank_id
      WHERE fd.station_id = ${station.id}
        AND t.fuel_type_id = ${fuelTypeId}
        AND fd.delivered_time > CURRENT_TIMESTAMP(3)
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS total_count,
        SUM(COALESCE(metadata, '') LIKE '%walk_in%') AS walk_in_count
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND fuel_type_id = ${fuelTypeId}
        AND joined_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS complaints_last_24h
      FROM public_complaints
      WHERE station_id = ${station.id}
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS manual_overrides_last_24h
      FROM audit_log
      WHERE station_id = ${station.id}
        AND action_type = 'TRANSACTION_OVERRIDE'
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS pump_incidents_last_24h
      FROM incidents
      WHERE station_id = ${station.id}
        AND category = 'PUMP'
        AND status = 'OPEN'
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT
        s.fuel_level,
        s.availability_status,
        status_log.petrol_status,
        status_log.diesel_status
      FROM stations s
      LEFT JOIN station_status_logs status_log
        ON status_log.id = (
          SELECT latest_status_log.id
          FROM station_status_logs latest_status_log
          WHERE latest_status_log.station_id = s.id
          ORDER BY latest_status_log.created_at DESC
          LIMIT 1
        )
      WHERE s.id <> ${station.id}
        AND s.is_active = 1
        AND COALESCE(s.city, '') = COALESCE(${stationRow.city || ""}, '')
      LIMIT 25
    `,
  ])

  const localParts = getStationLocalParts(now, stationRow.timezone || "Africa/Blantyre")
  const queue = queueRows?.[0] || {}
  const reservations = reservationRows?.[0] || {}
  const capacity = capacityRows?.[0] || {}
  const stock = stockRows?.[0] || {}
  const movement = movementRows?.[0] || {}
  const delivery = deliveryRows?.[0] || {}
  const walkIn = walkInRows?.[0] || {}
  const complaints = complaintRows?.[0] || {}
  const overrides = overrideRows?.[0] || {}
  const incidents = incidentRows?.[0] || {}

  const activePumpsFuel = roundNonNegative(capacity.active_pumps_fuel)
  const activePumpsAll = roundNonNegative(capacity.active_pumps_all)
  const activeNozzlesFuel = roundNonNegative(capacity.active_nozzles_fuel)
  const activeNozzlesAll = roundNonNegative(capacity.active_nozzles_all)
  const totalQueueSamples = toFiniteNumber(walkIn.total_count, 0)
  const capacityLitres = toFiniteNumber(stock.capacity_litres, 0)
  const latestLitres = toFiniteNumber(stock.latest_litres, 0)
  const deliveredLast24h = toFiniteNumber(movement.delivered_last_24h, 0)
  const soldLast24h = toFiniteNumber(movement.sold_last_24h, 0)
  const inferredStock = latestLitres > 0
    ? latestLitres + deliveredLast24h - soldLast24h
    : capacityLitres * 0.55
  const stockLitres = Math.max(0, inferredStock)
  const stockPct = capacityLitres > 0 ? stockLitres / capacityLitres : 0.5
  const deliveryEta = toFiniteNumber(delivery.delivery_eta_minutes, stockPct < 0.2 ? 180 : 420)

  return {
    station_id: String(stationRow.public_id || station.public_id),
    district: String(stationRow.city || "Unknown"),
    fuel_type: normalizedFuelType,
    hour_of_day: localParts.hourOfDay,
    day_of_week: localParts.dayOfWeek,
    is_weekend: localParts.isWeekend,
    is_payday_week: localParts.isPaydayWeek,
    is_rainy: false,
    nearby_shortage_index: Number(pressureFromNearbyRows(nearbyRows || [], normalizedFuelType).toFixed(3)),
    current_queue_length: roundNonNegative(queue.current_queue_length),
    active_pumps: activePumpsFuel || activePumpsAll,
    active_nozzles: activeNozzlesFuel || activeNozzlesAll,
    avg_service_time_sec_15m: Math.max(1, Number(toFiniteNumber(queue.avg_service_time_sec_15m, 220).toFixed(1))),
    arrivals_last_15m: roundNonNegative(queue.arrivals_last_15m),
    departures_last_15m: roundNonNegative(queue.departures_last_15m),
    reservations_next_30m: roundNonNegative(reservations.reservations_next_30m),
    walk_in_ratio: totalQueueSamples > 0
      ? Number(clamp(toFiniteNumber(walkIn.walk_in_count, 0) / totalQueueSamples, 0, 1).toFixed(3))
      : 0.7,
    stock_litres: Number(stockLitres.toFixed(1)),
    delivery_eta_minutes: Number(Math.max(0, deliveryEta).toFixed(1)),
    pump_fault_count: roundNonNegative(capacity.inactive_pumps) + roundNonNegative(incidents.pump_incidents_last_24h),
    complaints_last_24h: roundNonNegative(complaints.complaints_last_24h),
    manual_overrides_last_24h: roundNonNegative(overrides.manual_overrides_last_24h),
  }
}

export async function getSmartlinkOpsPrediction({ station, fuelType, now = new Date(), fetchImpl } = {}) {
  const featurePayload = await buildOpsPredictionPayload({ station, fuelType, now })
  const prediction = await callMlPrediction(featurePayload, { fetchImpl })
  return {
    generatedAt: now.toISOString(),
    stationPublicId: featurePayload.station_id,
    fuelType: featurePayload.fuel_type,
    featurePayload,
    prediction,
  }
}

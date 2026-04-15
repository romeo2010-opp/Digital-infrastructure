import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok, notFound } from "../../utils/http.js"
import { requireStationScope } from "../../middleware/requireAuth.js"
import { appTodayISO } from "../../utils/dateTime.js"
import { resolveStationOrThrow } from "../common/db.js"
import { getStationChangeToken } from "../../realtime/stationChangeToken.js"
import { computeStationFuelStatuses } from "./fuelStatus.js"
import { hasStationPlanFeature, STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"

const router = Router()
const changeWaitQuerySchema = z.object({
  since: z.string().max(4096).optional(),
  timeoutMs: z.coerce.number().int().min(2000).max(60000).optional(),
})

const LOCATION_DEFAULTS = {
  blantyre: { lat: -15.7861, lng: 35.0058 },
  lilongwe: { lat: -13.9626, lng: 33.7741 },
  mzuzu: { lat: -11.4656, lng: 34.0207 },
  zomba: { lat: -15.385, lng: 35.3188 },
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toNumberOrNull(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return null
  return normalized
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeClock(value) {
  if (!value) return ""
  if (value instanceof Date) {
    return value.toISOString().slice(11, 16)
  }

  const raw = String(value).trim()
  const match = raw.match(/(\d{2}:\d{2})/)
  return match ? match[1] : ""
}

function resolveCityBase(city) {
  const normalized = String(city || "").toLowerCase()
  if (!normalized) return LOCATION_DEFAULTS.blantyre
  if (normalized.includes("lilongwe")) return LOCATION_DEFAULTS.lilongwe
  if (normalized.includes("mzuzu")) return LOCATION_DEFAULTS.mzuzu
  if (normalized.includes("zomba")) return LOCATION_DEFAULTS.zomba
  if (normalized.includes("blantyre")) return LOCATION_DEFAULTS.blantyre
  return LOCATION_DEFAULTS.blantyre
}

function fallbackCoordinates(city, index) {
  const base = resolveCityBase(city)
  const step = 0.0032
  const row = Math.floor(index / 3) - 1
  const col = (index % 3) - 1

  return {
    lat: Number((base.lat + row * step).toFixed(7)),
    lng: Number((base.lng + col * step).toFixed(7)),
  }
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineKm(origin, destination) {
  const earthRadiusKm = 6371
  const deltaLat = toRadians(destination.lat - origin.lat)
  const deltaLng = toRadians(destination.lng - origin.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) *
      Math.cos(toRadians(destination.lat)) *
      Math.sin(deltaLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function normalizeStatus(rawAvailability, joinsPaused, activeQueueCount) {
  const scopedAvailability = String(rawAvailability || "").trim().toUpperCase()
  if (scopedAvailability === "IN_USE") return "In Use"
  if (scopedAvailability === "AVAILABLE") return "Available"
  if (Number(joinsPaused || 0)) return "In Use"
  if (Number(activeQueueCount || 0) > 0) return "In Use"
  return "Available"
}

function normalizeFuelLevel(rawFuelLevel, status) {
  const scopedFuelLevel = String(rawFuelLevel || "").trim().toLowerCase()
  if (scopedFuelLevel === "low" || scopedFuelLevel === "medium" || scopedFuelLevel === "high") {
    return scopedFuelLevel
  }
  return status === "In Use" ? "medium" : "high"
}

function normalizeHours({ open24h, openingTime, closingTime }) {
  if (open24h) {
    return {
      hoursLabel: "Open 24h",
      openingTime: "00:00",
      closingTime: "23:59",
      workingHours: "Mon - Sun 00:00 - 23:59",
    }
  }

  const openClock = normalizeClock(openingTime)
  const closeClock = normalizeClock(closingTime)
  if (openClock && closeClock) {
    return {
      hoursLabel: `Until ${closeClock}`,
      openingTime: openClock,
      closingTime: closeClock,
      workingHours: `Mon - Sun ${openClock} - ${closeClock}`,
    }
  }

  return {
    hoursLabel: "Hours unavailable",
    openingTime: "",
    closingTime: "",
    workingHours: "Hours unavailable",
  }
}

function normalizeStationRows(rows) {
  return (rows || []).map((row, index) => {
    const fallback = fallbackCoordinates(row.city, index)
    const lat = toNumberOrNull(row.latitude) ?? fallback.lat
    const lng = toNumberOrNull(row.longitude) ?? fallback.lng
    const status = normalizeStatus(row.availability_status, row.joins_paused, row.active_queue_count)
    const fuelLevel = normalizeFuelLevel(row.fuel_level, status)
    const hours = normalizeHours({
      open24h: Number(row.open_24h || 0) === 1,
      openingTime: row.opening_time,
      closingTime: row.closing_time,
    })
    const reference = resolveCityBase(row.city)
    const distanceKm = Number(haversineKm(reference, { lat, lng }).toFixed(1))
    const etaMin = Math.max(4, Math.round((distanceKm / 28) * 60))
    const rating = toNumberOrNull(row.rating)
    const reviewsCount = Number(row.reviews_count || 0)
    const subscriptionPlanCode = String(row.subscription_plan_code || "").trim().toUpperCase() || null
    const queuePlanEnabled = hasStationPlanFeature(subscriptionPlanCode, STATION_PLAN_FEATURES.DIGITAL_QUEUE)
    const reservationPlanEnabled = hasStationPlanFeature(subscriptionPlanCode, STATION_PLAN_FEATURES.RESERVATIONS)

    return {
      id: row.public_id,
      publicId: row.public_id,
      name: row.name,
      chipLabel: row.name,
      address: [row.address, row.city].filter(Boolean).join(", ") || row.name,
      city: row.city || null,
      operatorName: row.operator_name || null,
      countryCode: row.country_code || null,
      timezone: row.timezone || "Africa/Blantyre",
      lat,
      lng,
      status,
      fuelLevel,
      rating: rating ?? 4.2,
      reviewsCount: Number.isFinite(reviewsCount) ? reviewsCount : 0,
      hoursLabel: hours.hoursLabel,
      openingTime: hours.openingTime,
      closingTime: hours.closingTime,
      workingHours: hours.workingHours,
      distanceKm,
      etaMin,
      phone: row.phone_e164 || null,
      heroImage: row.hero_image_url || null,
      facilities: parseJsonArray(row.facilities_json),
      prices: parseJsonArray(row.prices_json),
      queueActiveCount: Number(row.active_queue_count || 0),
      subscriptionPlanCode,
      queuePlanEnabled,
      reservationPlanEnabled,
    }
  })
}

async function listStationFuelStatuses(stationId) {
  const today = appTodayISO() || "1970-01-01"
  const rangeFromDt = `${today} 00:00:00`
  const rangeToDt = `${today} 23:59:59`

  const [settingsRows, fuelRows, queueRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT petrol_enabled, diesel_enabled
      FROM station_queue_settings
      WHERE station_id = ${stationId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        SUM(t.capacity_litres) AS capacity_litres,
        SUM(
          CASE
            WHEN COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) IS NOT NULL
              THEN GREATEST(
                0,
                COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres)
                + COALESCE(del.delivery_litres, 0)
                - COALESCE(tx.recorded_litres, 0)
              )
            WHEN closing.closing_litres IS NOT NULL
              THEN GREATEST(0, closing.closing_litres)
            ELSE NULL
          END
        ) AS remaining_litres
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS opening_litres,
          ir.reading_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MIN(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'OPENING'
            AND reading_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
          GROUP BY tank_id
        ) latest
          ON latest.tank_id = ir.tank_id
         AND latest.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'OPENING'
      ) opening ON opening.tank_id = t.id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS fallback_opening_litres,
          ir.reading_time AS fallback_opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time < ${rangeFromDt}
          GROUP BY tank_id
        ) previous_closing
          ON previous_closing.tank_id = ir.tank_id
         AND previous_closing.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'CLOSING'
      ) fallback_opening ON fallback_opening.tank_id = t.id
      LEFT JOIN (
        SELECT tank_id, SUM(litres) AS delivery_litres
        FROM fuel_deliveries
        WHERE station_id = ${stationId}
          AND delivered_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
        GROUP BY tank_id
      ) del ON del.tank_id = t.id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS closing_litres
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
          GROUP BY tank_id
        ) last_closing
          ON last_closing.tank_id = ir.tank_id
         AND last_closing.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'CLOSING'
      ) closing ON closing.tank_id = t.id
      LEFT JOIN (
        SELECT
          COALESCE(pn.tank_id, p.tank_id) AS tank_id,
          SUM(tx.litres) AS recorded_litres
        FROM transactions tx
        LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
        LEFT JOIN pumps p ON p.id = tx.pump_id
        WHERE tx.station_id = ${stationId}
          AND tx.occurred_at BETWEEN ${rangeFromDt} AND ${rangeToDt}
        GROUP BY COALESCE(pn.tank_id, p.tank_id)
      ) tx ON tx.tank_id = t.id
      WHERE t.station_id = ${stationId}
        AND t.is_active = 1
      GROUP BY ft.code
    `,
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        COUNT(*) AS active_count
      FROM queue_entries qe
      INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
      WHERE qe.station_id = ${stationId}
        AND qe.status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY ft.code
    `,
  ])

  const settings = settingsRows?.[0] || {}
  return computeStationFuelStatuses({
    fuelRows,
    queueRows,
    settings,
  })
}

async function listUserStationsRows() {
  const enhancedQuery = prisma.$queryRaw`
    SELECT
      st.public_id,
      st.name,
      st.operator_name,
      st.country_code,
      st.city,
      st.address,
      st.timezone,
      st.phone_e164,
      st.latitude,
      st.longitude,
      st.opening_time,
      st.closing_time,
      st.open_24h,
      st.rating,
      st.reviews_count,
      st.hero_image_url,
      st.fuel_level,
      st.availability_status,
      st.facilities_json,
      st.prices_json,
      sss.plan_code AS subscription_plan_code,
      COALESCE(sqs.joins_paused, 0) AS joins_paused,
      COALESCE(active_queue.active_count, 0) AS active_queue_count
    FROM stations st
    LEFT JOIN station_subscription_statuses sss
      ON sss.station_id = st.id
    LEFT JOIN station_queue_settings sqs
      ON sqs.station_id = st.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS active_count
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY station_id
    ) active_queue
      ON active_queue.station_id = st.id
    WHERE st.is_active = 1
      AND st.deleted_at IS NULL
    ORDER BY st.name ASC
  `

  try {
    return await enhancedQuery
  } catch (error) {
    const message = String(error?.message || "")
    if (!message.includes("Unknown column") && !message.includes("doesn't exist")) throw error

    return prisma.$queryRaw`
      SELECT
        st.public_id,
        st.name,
        st.operator_name,
        st.country_code,
        st.city,
        st.address,
        st.timezone,
        NULL AS phone_e164,
        NULL AS latitude,
        NULL AS longitude,
        NULL AS opening_time,
        NULL AS closing_time,
        0 AS open_24h,
        NULL AS rating,
        0 AS reviews_count,
        NULL AS hero_image_url,
        NULL AS fuel_level,
        NULL AS availability_status,
        NULL AS facilities_json,
        NULL AS prices_json,
        NULL AS subscription_plan_code,
        COALESCE(sqs.joins_paused, 0) AS joins_paused,
        COALESCE(active_queue.active_count, 0) AS active_queue_count
      FROM stations st
      LEFT JOIN station_queue_settings sqs
        ON sqs.station_id = st.id
      LEFT JOIN (
        SELECT station_id, COUNT(*) AS active_count
        FROM queue_entries
        WHERE status IN ('WAITING', 'CALLED', 'LATE')
        GROUP BY station_id
      ) active_queue
        ON active_queue.station_id = st.id
      WHERE st.is_active = 1
        AND st.deleted_at IS NULL
      ORDER BY st.name ASC
    `
  }
}

router.get(
  "/user/stations/:stationPublicId/fuel-status",
  asyncHandler(async (req, res) => {
    const stationPublicId = String(req.params.stationPublicId || "").trim()
    const station = await resolveStationOrThrow(stationPublicId)
    const statuses = await listStationFuelStatuses(station.id)
    return ok(res, {
      stationPublicId,
      statuses,
      updatedAt: new Date().toISOString(),
    })
  })
)

router.get(
  "/user/stations",
  asyncHandler(async (_req, res) => {
    const rows = await listUserStationsRows()
    return ok(res, normalizeStationRows(rows))
  })
)

router.get(
  "/stations",
  asyncHandler(async (_req, res) => {
    const auth = _req.auth
    const rows = auth?.bypass
      ? await prisma.$queryRaw`
          SELECT public_id, name, operator_name, country_code, city, address, timezone, is_active
          FROM stations
          WHERE deleted_at IS NULL
          ORDER BY name ASC
        `
      : await prisma.$queryRaw`
          SELECT public_id, name, operator_name, country_code, city, address, timezone, is_active
          FROM stations
          WHERE public_id = ${auth.stationPublicId}
            AND deleted_at IS NULL
          ORDER BY name ASC
        `
    return ok(res, rows)
  })
)

router.get(
  "/stations/:stationPublicId",
  requireStationScope,
  asyncHandler(async (req, res) => {
    const { stationPublicId } = req.params
    const rows = await prisma.$queryRaw`
      SELECT public_id, name, operator_name, country_code, city, address, timezone, is_active
      FROM stations
      WHERE public_id = ${stationPublicId}
        AND deleted_at IS NULL
      LIMIT 1
    `

    const row = rows?.[0]
    if (!row) throw notFound(`Station not found: ${stationPublicId}`)
    return ok(res, row)
  })
)

router.get(
  "/stations/:stationPublicId/changes/token",
  requireStationScope,
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const token = await getStationChangeToken(station.id)
    return ok(res, { token })
  })
)

router.get(
  "/stations/:stationPublicId/changes/wait",
  requireStationScope,
  asyncHandler(async (req, res) => {
    const station = await resolveStationOrThrow(req.params.stationPublicId)
    const query = changeWaitQuerySchema.parse(req.query || {})
    const since = query.since ? String(query.since) : null
    const timeoutMs = query.timeoutMs || 25000
    const startedAt = Date.now()

    let latest = await getStationChangeToken(station.id)
    if (since === null || latest !== since) {
      return ok(res, {
        changed: since === null ? false : latest !== since,
        token: latest,
        waitedMs: Date.now() - startedAt,
      })
    }

    while (Date.now() - startedAt < timeoutMs) {
      if (req.aborted) return undefined
      await sleep(1000)
      latest = await getStationChangeToken(station.id)
      if (latest !== since) {
        return ok(res, {
          changed: true,
          token: latest,
          waitedMs: Date.now() - startedAt,
        })
      }
    }

    return ok(res, {
      changed: false,
      token: latest,
      waitedMs: Date.now() - startedAt,
    })
  })
)

export default router

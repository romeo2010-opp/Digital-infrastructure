import { prisma } from "../../db/prisma.js"
import { createPublicId } from "../common/db.js"
import { publishStationChange } from "../../realtime/stationChangesHub.js"
import {
  computeDemandAnomalySignal,
  DEFAULT_DEMAND_ANOMALY_CONFIG,
} from "./demandAnomaly.compute.js"

const WINDOW_TO_MINUTES = Object.freeze({
  "15m": 15,
  "1h": 60,
  "6h": 360,
})

const inMemoryCache = new Map()
const pendingAnomalies = new Map()

function isMissingDemandTableError(error) {
  const message = String(error?.message || "")
  return message.includes("demand_anomaly_events")
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === "bigint") {
    const converted = Number(value)
    return Number.isFinite(converted) ? converted : fallback
  }
  const normalized =
    typeof value === "string"
      ? value
      : typeof value?.toString === "function"
        ? value.toString()
        : value
  const numeric = Number.parseFloat(String(normalized))
  return Number.isFinite(numeric) ? numeric : fallback
}

function toPositiveNumber(value, fallback) {
  const numeric = toFiniteNumber(value, fallback)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return numeric
}

function parseBoolean(value, fallback = false) {
  if (value === null || value === undefined) return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value > 0
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function normalizeWindow(windowValue) {
  const scoped = String(windowValue || "15m").toLowerCase()
  return WINDOW_TO_MINUTES[scoped] ? scoped : "15m"
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function toMs(value) {
  if (!value) return NaN
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.getTime() : NaN
}

function mapByFuel(rows = []) {
  const map = new Map()
  for (const row of rows || []) {
    const fuelType = String(row.fuel_code || "").toUpperCase()
    if (!fuelType) continue
    map.set(fuelType, row)
  }
  return map
}

function computeMean(values = []) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sortByTimeAsc(rows = []) {
  return [...rows].sort((a, b) => {
    const aMs = toMs(a.bucket_time)
    const bMs = toMs(b.bucket_time)
    return aMs - bMs
  })
}

function formatMetricOutput(metric) {
  const round = (value, decimals = 3) => {
    const numeric = toFiniteNumber(value, null)
    if (numeric === null) return 0
    return Number(numeric.toFixed(decimals))
  }
  const roundOrNull = (value, decimals = 3) => {
    const numeric = toFiniteNumber(value, null)
    if (numeric === null) return null
    return Number(numeric.toFixed(decimals))
  }

  return {
    fuelType: metric.fuelType,
    salesVelocityLph: round(metric.salesVelocityLph, 3),
    txRateTph: round(metric.txRateTph, 3),
    expectedMeanLph: round(metric.expectedMeanLph, 3),
    expectedStdLph: round(metric.expectedStdLph, 3),
    expectedMeanTph: round(metric.expectedMeanTph, 3),
    expectedStdTph: round(metric.expectedStdTph, 3),
    zScore: round(metric.zScore, 4),
    txZScore: round(metric.txZScore, 4),
    ewmaValue: round(metric.ewmaValue, 3),
    ewmaBaseline: roundOrNull(metric.ewmaBaseline, 3),
    ewmaShiftScore: round(metric.ewmaShiftScore, 4),
    cusumValue: roundOrNull(metric.cusumValue, 4),
    cusumScore: round(metric.cusumScore, 4),
    severity: metric.severity,
    detectionScore: round(metric.detectionScore, 4),
    baselineSource: metric.baselineSource,
    baselineCount: Math.max(0, Number(toFiniteNumber(metric.baselineCount, 0))),
    rulesTriggered: metric.rulesTriggered,
    persistencePending: Boolean(metric.persistencePending),
    pendingSince: metric.pendingSince,
    activeEventId: metric.activeEventId || null,
    lastObservedAt: metric.lastObservedAt,
    txHistoryMeanTph: round(metric.txHistoryMeanTph, 3),
  }
}

async function ensureQueueSettingsRow(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM station_queue_settings
    WHERE station_id = ${stationId}
    LIMIT 1
  `
  if (rows?.[0]) return rows[0]

  await prisma.$executeRaw`
    INSERT INTO station_queue_settings (station_id)
    VALUES (${stationId})
  `
  const inserted = await prisma.$queryRaw`
    SELECT *
    FROM station_queue_settings
    WHERE station_id = ${stationId}
    LIMIT 1
  `
  return inserted?.[0] || {}
}

async function getStationFuelTypes(stationId) {
  const [tankFuelRows, txFuelRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT DISTINCT ft.code AS fuel_code
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      WHERE t.station_id = ${stationId}
      ORDER BY ft.code ASC
    `,
    prisma.$queryRaw`
      SELECT DISTINCT ft.code AS fuel_code
      FROM transactions t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      WHERE t.station_id = ${stationId}
        AND t.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      ORDER BY ft.code ASC
    `,
  ])

  const codes = new Set(
    [...(tankFuelRows || []), ...(txFuelRows || [])]
      .map((row) => String(row.fuel_code || "").toUpperCase())
      .filter(Boolean)
  )

  if (!codes.size) {
    codes.add("PETROL")
    codes.add("DIESEL")
  }

  return [...codes]
}

async function getCurrentWindowAggregates(stationId, fromDt, toDt) {
  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_code,
      COALESCE(SUM(t.litres), 0) AS litres,
      COUNT(t.id) AS tx_count
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at BETWEEN ${fromDt} AND ${toDt}
    GROUP BY ft.code
  `
  return mapByFuel(rows)
}

async function getHourlyAggregates(stationId, fromDt, toDt) {
  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_code,
      DATE(t.occurred_at) AS day_bucket,
      HOUR(t.occurred_at) AS hour_bucket,
      STR_TO_DATE(
        CONCAT(DATE(t.occurred_at), ' ', LPAD(HOUR(t.occurred_at), 2, '0'), ':00:00'),
        '%Y-%m-%d %H:%i:%s'
      ) AS bucket_time,
      COALESCE(SUM(t.litres), 0) AS litres,
      COUNT(t.id) AS tx_count
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at BETWEEN ${fromDt} AND ${toDt}
    GROUP BY ft.code, DATE(t.occurred_at), HOUR(t.occurred_at)
    ORDER BY DATE(t.occurred_at) ASC, HOUR(t.occurred_at) ASC
  `

  const grouped = new Map()
  for (const row of rows || []) {
    const fuelType = String(row.fuel_code || "").toUpperCase()
    if (!fuelType) continue
    if (!grouped.has(fuelType)) grouped.set(fuelType, [])
    grouped.get(fuelType).push({
      fuelType,
      day_bucket: row.day_bucket,
      hour_bucket: Number(row.hour_bucket),
      bucket_time: row.bucket_time,
      litres: toFiniteNumber(row.litres, 0),
      tx_count: toFiniteNumber(row.tx_count, 0),
    })
  }

  return grouped
}

function pickBaselines({
  hourlyRows,
  now,
  currentWindowStart,
}) {
  const nowHour = now.getUTCHours()
  const nowMs = now.getTime()
  const windowStartMs = currentWindowStart.getTime()
  const twentyFourHoursAgo = nowMs - (24 * 60 * 60 * 1000)

  const orderedRows = sortByTimeAsc(hourlyRows)
  const hourOfDayRows = orderedRows.filter((row) => {
    const rowMs = toMs(row.bucket_time)
    return Number.isFinite(rowMs) && rowMs < windowStartMs && Number(row.hour_bucket) === nowHour
  })

  let baselineRows = hourOfDayRows
  let baselineSource = "7d_hourly"

  if (baselineRows.length < 4) {
    baselineRows = orderedRows.filter((row) => {
      const rowMs = toMs(row.bucket_time)
      return Number.isFinite(rowMs) && rowMs >= twentyFourHoursAgo && rowMs < windowStartMs
    })
    baselineSource = "24h_rolling"
  }

  const ewmaRows = orderedRows.filter((row) => {
    const rowMs = toMs(row.bucket_time)
    return Number.isFinite(rowMs) && rowMs >= twentyFourHoursAgo && rowMs < windowStartMs
  })

  return {
    baselineRows,
    baselineSource,
    ewmaRows,
  }
}

function readAnomalyConfig(settingsRow = {}) {
  const warningZ = toPositiveNumber(
    settingsRow.anomaly_warning_z,
    toPositiveNumber(process.env.DEMAND_ANOMALY_WARNING_Z, DEFAULT_DEMAND_ANOMALY_CONFIG.warningZ)
  )
  const criticalZ = Math.max(
    warningZ,
    toPositiveNumber(
      settingsRow.anomaly_critical_z,
      toPositiveNumber(process.env.DEMAND_ANOMALY_CRITICAL_Z, DEFAULT_DEMAND_ANOMALY_CONFIG.criticalZ)
    )
  )
  const ewmaAlpha = Math.min(
    0.95,
    Math.max(
      0.01,
      toFiniteNumber(
        settingsRow.anomaly_ewma_alpha,
        toFiniteNumber(process.env.DEMAND_ANOMALY_EWMA_ALPHA, DEFAULT_DEMAND_ANOMALY_CONFIG.ewmaAlpha)
      )
    )
  )
  const persistenceMinutes = toPositiveNumber(
    settingsRow.anomaly_persistence_minutes,
    toPositiveNumber(process.env.DEMAND_ANOMALY_PERSISTENCE_MINUTES, 10)
  )
  const cacheTtlSeconds = toPositiveNumber(
    process.env.DEMAND_ANOMALY_CACHE_TTL_SECONDS,
    45
  )

  const envCusumEnabled = parseBoolean(process.env.ENABLE_CUSUM, false)
  const enableCusum = parseBoolean(
    settingsRow.anomaly_enable_cusum,
    envCusumEnabled
  )
  const cusumThreshold = toPositiveNumber(
    settingsRow.anomaly_cusum_threshold,
    toPositiveNumber(process.env.DEMAND_ANOMALY_CUSUM_THRESHOLD, DEFAULT_DEMAND_ANOMALY_CONFIG.cusumThreshold)
  )

  return {
    warningZ,
    criticalZ,
    ewmaAlpha,
    persistenceMinutes,
    cacheTtlMs: cacheTtlSeconds * 1000,
    enableCusum,
    cusumThreshold,
    cusumDriftK: DEFAULT_DEMAND_ANOMALY_CONFIG.cusumDriftK,
  }
}

async function getOpenEventsByFuel(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT id, fuel_type, severity, start_time
    FROM demand_anomaly_events
    WHERE station_id = ${stationId}
      AND end_time IS NULL
    ORDER BY id DESC
  `
  const map = new Map()
  for (const row of rows || []) {
    const fuel = String(row.fuel_type || "").toUpperCase()
    if (!fuel || map.has(fuel)) continue
    map.set(fuel, row)
  }
  return map
}

async function createOrUpdateCriticalIncident({ stationId, fuelType, isCritical, metric }) {
  const title = `Demand anomaly (${fuelType})`
  const keyTag = `demand_anomaly:${fuelType}`

  const rows = await prisma.$queryRaw`
    SELECT id, status
    FROM incidents
    WHERE station_id = ${stationId}
      AND title = ${title}
      AND description LIKE CONCAT('%', ${keyTag}, '%')
    ORDER BY id DESC
    LIMIT 1
  `
  const existing = rows?.[0]

  if (!isCritical) {
    if (existing?.id && String(existing.status || "").toUpperCase() === "OPEN") {
      await prisma.$executeRaw`
        UPDATE incidents
        SET status = 'RESOLVED'
        WHERE id = ${existing.id}
      `
      return true
    }
    return false
  }

  const summary = [
    `Critical demand anomaly detected for ${fuelType}.`,
    `Velocity ${Number(metric.salesVelocityLph).toFixed(2)} L/h`,
    `Expected ${Number(metric.expectedMeanLph).toFixed(2)} L/h`,
    `z-score ${Number(metric.zScore).toFixed(2)}`,
    `[${keyTag}]`,
  ].join(" ")

  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE incidents
      SET severity = 'HIGH',
          status = 'OPEN',
          description = ${summary}
      WHERE id = ${existing.id}
    `
    return true
  }

  await prisma.$executeRaw`
    INSERT INTO incidents (
      station_id,
      public_id,
      severity,
      category,
      title,
      description,
      status,
      created_by_staff_id
    )
    VALUES (
      ${stationId},
      ${createPublicId()},
      'HIGH',
      'QUEUE',
      ${title},
      ${summary},
      'OPEN',
      NULL
    )
  `
  return true
}

async function persistAnomalyEvents({
  stationId,
  stationPublicId,
  metrics,
  config,
  now,
}) {
  const nowMs = now.getTime()
  const openEventsByFuel = await getOpenEventsByFuel(stationId)
  let changed = false

  for (const metric of metrics) {
    const key = `${stationId}:${metric.fuelType}`
    const severity = String(metric.severity || "NONE").toUpperCase()
    const openEvent = openEventsByFuel.get(metric.fuelType)

    if (severity === "NONE") {
      pendingAnomalies.delete(key)
      metric.persistencePending = false
      metric.pendingSince = null

      if (openEvent?.id) {
        await prisma.$executeRaw`
          UPDATE demand_anomaly_events
          SET end_time = ${now}
          WHERE id = ${openEvent.id}
            AND end_time IS NULL
        `
        await createOrUpdateCriticalIncident({
          stationId,
          fuelType: metric.fuelType,
          isCritical: false,
          metric,
        })
        changed = true
      }
      continue
    }

    let pending = pendingAnomalies.get(key)
    if (!pending) {
      pending = { sinceMs: nowMs }
      pendingAnomalies.set(key, pending)
    }

    const pendingSinceMs = pending.sinceMs
    const pendingElapsedMs = nowMs - pendingSinceMs
    const pendingReached = pendingElapsedMs >= config.persistenceMinutes * 60 * 1000
    metric.persistencePending = !pendingReached && !openEvent
    metric.pendingSince = new Date(pendingSinceMs).toISOString()

    if (!pendingReached && !openEvent) {
      continue
    }

    if (!openEvent?.id) {
      await prisma.$executeRaw`
        INSERT INTO demand_anomaly_events (
          station_id,
          fuel_type,
          severity,
          start_time,
          end_time,
          current_velocity,
          expected_mean,
          expected_std,
          z_score,
          ewma_value,
          cusum_value,
          rules_triggered_json,
          created_at
        )
        VALUES (
          ${stationId},
          ${metric.fuelType},
          ${severity},
          ${new Date(pendingSinceMs)},
          NULL,
          ${metric.salesVelocityLph},
          ${metric.expectedMeanLph},
          ${metric.expectedStdLph},
          ${metric.zScore},
          ${metric.ewmaValue},
          ${metric.cusumValue},
          ${JSON.stringify(metric.rulesTriggered || [])},
          CURRENT_TIMESTAMP(3)
        )
      `
      changed = true
    } else if (String(openEvent.severity || "").toUpperCase() !== severity) {
      await prisma.$executeRaw`
        UPDATE demand_anomaly_events
        SET
          severity = ${severity},
          current_velocity = ${metric.salesVelocityLph},
          expected_mean = ${metric.expectedMeanLph},
          expected_std = ${metric.expectedStdLph},
          z_score = ${metric.zScore},
          ewma_value = ${metric.ewmaValue},
          cusum_value = ${metric.cusumValue},
          rules_triggered_json = ${JSON.stringify(metric.rulesTriggered || [])}
        WHERE id = ${openEvent.id}
          AND end_time IS NULL
      `
      changed = true
    }

    metric.activeEventId = openEvent?.id || metric.activeEventId

    const incidentChanged = await createOrUpdateCriticalIncident({
      stationId,
      fuelType: metric.fuelType,
      isCritical: severity === "CRITICAL",
      metric,
    })
    changed = changed || incidentChanged
  }

  if (changed) {
    publishStationChange({
      stationId,
      actionType: "DEMAND_ANOMALY_EVENT",
      payload: {
        stationPublicId,
      },
    })
  }
}

export async function getDemandAnomalyMetrics({
  stationId,
  stationPublicId,
  window = "15m",
  forceRefresh = false,
}) {
  const normalizedWindow = normalizeWindow(window)
  const cacheKey = `${stationId}:${normalizedWindow}`
  const cached = inMemoryCache.get(cacheKey)
  if (
    !forceRefresh &&
    cached &&
    cached.expiresAtMs > Date.now()
  ) {
    return cached.data
  }

  const settingsRow = await ensureQueueSettingsRow(stationId)
  const config = readAnomalyConfig(settingsRow)
  const now = new Date()
  const windowMinutes = WINDOW_TO_MINUTES[normalizedWindow]
  const currentWindowStart = new Date(now.getTime() - (windowMinutes * 60 * 1000))
  const baselineStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))

  const [fuelTypes, currentRowsMap, hourlyRowsByFuel] = await Promise.all([
    getStationFuelTypes(stationId),
    getCurrentWindowAggregates(stationId, currentWindowStart, now),
    getHourlyAggregates(stationId, baselineStart, now),
  ])

  const metrics = fuelTypes.map((fuelType) => {
    const current = currentRowsMap.get(fuelType)
    const currentLitres = toFiniteNumber(current?.litres, 0)
    const currentTxCount = toFiniteNumber(current?.tx_count, 0)

    const salesVelocityLph = currentLitres * (60 / windowMinutes)
    const txRateTph = currentTxCount * (60 / windowMinutes)
    const hourlyRows = hourlyRowsByFuel.get(fuelType) || []
    const { baselineRows, baselineSource, ewmaRows } = pickBaselines({
      hourlyRows,
      now,
      currentWindowStart,
    })

    const baselineVelocitySeries = baselineRows.map((row) => Number(row.litres))
    const baselineTxSeries = baselineRows.map((row) => Number(row.tx_count))
    const ewmaVelocitySeries = ewmaRows.map((row) => Number(row.litres))

    const signal = computeDemandAnomalySignal(
      {
        currentVelocityLph: salesVelocityLph,
        currentTxRateTph: txRateTph,
        baselineVelocitySeries,
        baselineTxSeries,
        ewmaVelocitySeries,
        cusumVelocitySeries: ewmaVelocitySeries,
      },
      {
        warningZ: config.warningZ,
        criticalZ: config.criticalZ,
        ewmaAlpha: config.ewmaAlpha,
        enableCusum: config.enableCusum,
        cusumThreshold: config.cusumThreshold,
        cusumDriftK: config.cusumDriftK,
      }
    )

    return {
      fuelType,
      salesVelocityLph,
      txRateTph,
      expectedMeanLph: signal.expectedMeanLph,
      expectedStdLph: signal.expectedStdLph,
      expectedMeanTph: signal.expectedMeanTph,
      expectedStdTph: signal.expectedStdTph,
      zScore: signal.zScore,
      txZScore: signal.txZScore,
      ewmaValue: signal.ewmaValue,
      ewmaBaseline: signal.ewmaBaseline,
      ewmaShiftScore: signal.ewmaShiftScore,
      cusumValue: signal.cusumValue,
      cusumScore: signal.cusumScore,
      severity: signal.severity,
      detectionScore: signal.detectionScore,
      baselineSource,
      baselineCount: signal.baselineCount,
      rulesTriggered: signal.rulesTriggered,
      txHistoryMeanTph: computeMean(baselineTxSeries),
      activeEventId: null,
      persistencePending: false,
      pendingSince: null,
      lastObservedAt: now.toISOString(),
    }
  })

  await persistAnomalyEvents({
    stationId,
    stationPublicId,
    metrics,
    config,
    now,
  }).catch((error) => {
    if (!isMissingDemandTableError(error)) throw error
  })

  const formattedMetrics = metrics.map(formatMetricOutput)
  const payload = {
    generatedAt: now.toISOString(),
    window: normalizedWindow,
    methods: {
      warningZ: config.warningZ,
      criticalZ: config.criticalZ,
      ewmaAlpha: config.ewmaAlpha,
      cusumEnabled: config.enableCusum,
      cusumThreshold: config.cusumThreshold,
      persistenceMinutes: config.persistenceMinutes,
      baseline: "hour_of_day_7d_with_24h_fallback",
    },
    metrics: formattedMetrics,
  }

  inMemoryCache.set(cacheKey, {
    expiresAtMs: Date.now() + config.cacheTtlMs,
    data: payload,
  })

  return payload
}

function parseRulesJson(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function listDemandAnomalyEvents({
  stationId,
  from,
  to,
}) {
  const parsedFrom = from ? new Date(from) : null
  const parsedTo = to ? new Date(to) : null
  const fromValue = Number.isFinite(parsedFrom?.getTime())
    ? parsedFrom
    : new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))
  const toValue = Number.isFinite(parsedTo?.getTime())
    ? parsedTo
    : new Date()

  let rows = []
  try {
    rows = await prisma.$queryRaw`
      SELECT
        id,
        fuel_type,
        severity,
        start_time,
        end_time,
        current_velocity,
        expected_mean,
        expected_std,
        z_score,
        ewma_value,
        cusum_value,
        rules_triggered_json,
        created_at
      FROM demand_anomaly_events
      WHERE station_id = ${stationId}
        AND COALESCE(end_time, CURRENT_TIMESTAMP(3)) >= ${fromValue}
        AND start_time <= ${toValue}
      ORDER BY start_time DESC
      LIMIT 300
    `
  } catch (error) {
    if (!isMissingDemandTableError(error)) throw error
    rows = []
  }

  return (rows || []).map((row) => ({
    id: Number(row.id),
    fuelType: String(row.fuel_type || "").toUpperCase(),
    severity: String(row.severity || "WARNING").toUpperCase(),
    startTime: toIsoOrNull(row.start_time),
    endTime: toIsoOrNull(row.end_time),
    currentVelocity: toFiniteNumber(row.current_velocity, 0),
    expectedMean: toFiniteNumber(row.expected_mean, 0),
    expectedStd: toFiniteNumber(row.expected_std, 0),
    zScore: toFiniteNumber(row.z_score, 0),
    ewmaValue: toFiniteNumber(row.ewma_value, 0),
    cusumValue: row.cusum_value === null ? null : toFiniteNumber(row.cusum_value, 0),
    rulesTriggered: parseRulesJson(row.rules_triggered_json),
    createdAt: toIsoOrNull(row.created_at),
  }))
}

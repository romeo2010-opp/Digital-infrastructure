import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prisma } from "../../db/prisma.js"
import { generateBriefing, validateInput } from "../../services/briefingEngine.js"
import { notFound } from "../../utils/http.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../../../../")
const PYTHON_ENGINE_PATH = path.join(REPO_ROOT, "src/engine/insight_engine.py")
const PYTHON_ENGINE_CWD = path.dirname(PYTHON_ENGINE_PATH)
const REPO_VENV_PYTHON = path.join(REPO_ROOT, ".venv/bin/python")
const PYTHON_ENGINE_TIMEOUT_MS = Number(process.env.SMARTLINK_INSIGHT_ENGINE_TIMEOUT_MS || 45000)

function toNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toIso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizePumpStatus(value) {
  const status = String(value || "").trim().toLowerCase()
  return status || "active"
}

function snakeCaseStationSnapshot(raw, stationName) {
  return {
    station_id: raw.stationId,
    station_name: stationName,
    last_login_at: raw.lastLoginAt,
    tanks: raw.tanks.map((tank) => ({
      id: tank.id,
      fuel_type: tank.fuelType,
      capacity_litres: tank.capacityLitres,
      current_litres: tank.currentLitres,
      resupply_scheduled_at: tank.resupplyScheduledAt,
    })),
    pumps: raw.pumps.map((pump) => ({
      id: pump.id,
      label: pump.label,
      status: pump.status,
      fault_events: pump.faultEventsCount,
      last_fault_at: pump.lastFaultAt,
    })),
    sales: {
      total_revenue_mwk: raw.sales.totalRevenueMWK,
      total_litres: raw.sales.totalLitres,
      transaction_count: raw.sales.transactionCount,
      previous_day_revenue_mwk: raw.sales.previousDayRevenueMWK,
      previous_day_litres: raw.sales.previousDayLitres,
      by_fuel_type: raw.sales.byFuelType.map((row) => ({
        fuel_type: row.fuelType,
        litres: row.litres,
        revenue_mwk: row.revenueMWK ?? null,
      })),
    },
    queue: {
      drivers_served: raw.queue.driversServed,
      avg_wait_minutes: raw.queue.avgWaitMinutes,
      target_wait_minutes: raw.queue.targetWaitMinutes,
      drop_offs: raw.queue.dropOffs,
      peak_hours: raw.queue.peakHours.map((row) => ({
        hour: row.hour,
        vehicle_count: row.vehicleCount,
      })),
    },
    deliveries: raw.deliveries.map((delivery) => ({
      fuel_type: delivery.fuelType,
      scheduled_at: delivery.scheduledAt,
      estimated_litres: delivery.estimatedLitres,
      status: delivery.status,
    })),
  }
}

function runPythonInsightEngine(stationSnapshotPath) {
  const pythonBin = String(
    process.env.SMARTLINK_PYTHON_BIN || (existsSync(REPO_VENV_PYTHON) ? REPO_VENV_PYTHON : "python3")
  ).trim() || "python3"

  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonBin,
      ["-B", PYTHON_ENGINE_PATH, "--station-data", stationSnapshotPath],
      {
        cwd: PYTHON_ENGINE_CWD,
        env: {
          ...process.env,
          SMARTLINK_MARKET_SEARCH_BUDGET_SECONDS: process.env.SMARTLINK_MARKET_SEARCH_BUDGET_SECONDS || "12",
          SMARTLINK_DUCKDUCKGO_TIMEOUT_SECONDS: process.env.SMARTLINK_DUCKDUCKGO_TIMEOUT_SECONDS || "3",
          SMARTLINK_GROQ_TIMEOUT_SECONDS: process.env.SMARTLINK_GROQ_TIMEOUT_SECONDS || "10",
          SMARTLINK_MAX_FUEL_NEWS_SEARCHES: process.env.SMARTLINK_MAX_FUEL_NEWS_SEARCHES || "5",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )

    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(new Error(`Python insight engine timed out after ${PYTHON_ENGINE_TIMEOUT_MS}ms`))
    }, PYTHON_ENGINE_TIMEOUT_MS)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (stderr.trim()) {
        // eslint-disable-next-line no-console
        console.warn("[briefing] Python insight engine stderr:", stderr.trim())
      }
      if (code !== 0) {
        reject(new Error(`Python insight engine exited with code ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`Python insight engine returned invalid JSON: ${error.message}`))
      }
    })
  })
}

async function generatePythonBriefing(raw, stationName) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "smartlink-insight-"))
  const snapshotPath = path.join(tempDir, "station_snapshot.json")
  try {
    await writeFile(snapshotPath, JSON.stringify(snakeCaseStationSnapshot(raw, stationName)), "utf8")
    return await runPythonInsightEngine(snapshotPath)
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

async function generateBriefingWithFallback(raw, stationName) {
  try {
    return await generatePythonBriefing(raw, stationName)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[briefing] Falling back to JS briefing engine:", error.message)
    return generateBriefing(raw)
  }
}

async function resolveStation(stationPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone
    FROM stations
    WHERE public_id = ${stationPublicId}
      AND is_active = 1
    LIMIT 1
  `
  const station = rows?.[0] || null
  if (!station) throw notFound("Station not found")
  return station
}

async function getSessionWindow({ stationId, userId, sessionPublicId }) {
  const rows = await prisma.$queryRaw`
    SELECT
      current_session.created_at AS current_login_at,
      COALESCE(
        (
          SELECT MAX(previous_session.created_at)
          FROM auth_sessions previous_session
          WHERE previous_session.user_id = current_session.user_id
            AND previous_session.station_id <=> current_session.station_id
            AND previous_session.public_id <> current_session.public_id
            AND previous_session.created_at < current_session.created_at
        ),
        current_session.created_at
      ) AS last_login_at
    FROM auth_sessions current_session
    WHERE current_session.public_id = ${sessionPublicId}
      AND current_session.user_id = ${userId}
      AND current_session.station_id <=> ${stationId}
    LIMIT 1
  `
  const row = rows?.[0] || {}
  const now = new Date()
  return {
    lastLoginAt: toIso(row.last_login_at) || now.toISOString(),
    briefingAt: now.toISOString(),
    currentLoginAt: toIso(row.current_login_at) || now.toISOString(),
  }
}

async function getTanks(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      t.public_id,
      t.name,
      ft.code AS fuel_type,
      COALESCE(t.capacity_litres, 1) AS capacity_litres,
      COALESCE(latest_reading.litres, t.capacity_litres, 0) AS current_litres,
      next_delivery.delivered_time AS resupply_scheduled_at
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN (
      SELECT ir.tank_id, ir.litres
      FROM inventory_readings ir
      INNER JOIN (
        SELECT tank_id, MAX(reading_time) AS reading_time
        FROM inventory_readings
        WHERE station_id = ${stationId}
        GROUP BY tank_id
      ) latest
        ON latest.tank_id = ir.tank_id
       AND latest.reading_time = ir.reading_time
      WHERE ir.station_id = ${stationId}
    ) latest_reading ON latest_reading.tank_id = t.id
    LEFT JOIN (
      SELECT fd.tank_id, MIN(fd.delivered_time) AS delivered_time
      FROM fuel_deliveries fd
      WHERE fd.station_id = ${stationId}
        AND fd.delivered_time >= CURRENT_TIMESTAMP(3)
      GROUP BY fd.tank_id
    ) next_delivery ON next_delivery.tank_id = t.id
    WHERE t.station_id = ${stationId}
      AND t.is_active = 1
    ORDER BY ft.code ASC, t.name ASC
  `

  return (rows || []).map((row) => ({
    id: String(row.public_id || row.name || "tank"),
    fuelType: String(row.fuel_type || "UNKNOWN"),
    capacityLitres: Math.max(toNumber(row.capacity_litres, 1), Number.MIN_VALUE),
    currentLitres: Math.max(0, toNumber(row.current_litres, 0)),
    resupplyScheduledAt: toIso(row.resupply_scheduled_at),
  }))
}

async function getPumps({ stationId, since }) {
  const rows = await prisma.$queryRaw`
    SELECT
      p.public_id,
      p.pump_number,
      p.status,
      COUNT(i.id) AS fault_events_count,
      MAX(i.created_at) AS last_fault_at
    FROM pumps p
    LEFT JOIN incidents i
      ON i.station_id = p.station_id
     AND i.category = 'PUMP'
     AND i.created_at >= ${since}
    WHERE p.station_id = ${stationId}
      AND p.is_active = 1
    GROUP BY p.id, p.public_id, p.pump_number, p.status
    ORDER BY p.pump_number ASC
  `

  return (rows || []).map((row) => ({
    id: String(row.public_id || row.pump_number || "pump"),
    label: `Pump ${row.pump_number || row.public_id || ""}`.trim(),
    faultEventsCount: toNumber(row.fault_events_count, 0),
    lastFaultAt: toIso(row.last_fault_at),
    status: normalizePumpStatus(row.status),
  }))
}

async function getSales(stationId) {
  const [summaryRows, fuelRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN DATE(occurred_at) = CURRENT_DATE() THEN total_amount ELSE 0 END), 0) AS total_revenue_mwk,
        COALESCE(SUM(CASE WHEN DATE(occurred_at) = CURRENT_DATE() THEN litres ELSE 0 END), 0) AS total_litres,
        COALESCE(SUM(CASE WHEN DATE(occurred_at) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS transaction_count,
        COALESCE(SUM(CASE WHEN DATE(occurred_at) = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN total_amount ELSE 0 END), 0) AS previous_day_revenue_mwk,
        COALESCE(SUM(CASE WHEN DATE(occurred_at) = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) THEN litres ELSE 0 END), 0) AS previous_day_litres
      FROM transactions
      WHERE station_id = ${stationId}
        AND status = 'RECORDED'
        AND occurred_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
        AND occurred_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
    `,
    prisma.$queryRaw`
      SELECT ft.code AS fuel_type, COALESCE(SUM(t.litres), 0) AS litres
      FROM transactions t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      WHERE t.station_id = ${stationId}
        AND t.status = 'RECORDED'
        AND DATE(t.occurred_at) = CURRENT_DATE()
      GROUP BY ft.code
      ORDER BY ft.code ASC
    `,
  ])

  const summary = summaryRows?.[0] || {}
  return {
    totalRevenueMWK: toNumber(summary.total_revenue_mwk, 0),
    totalLitres: toNumber(summary.total_litres, 0),
    transactionCount: toNumber(summary.transaction_count, 0),
    previousDayRevenueMWK: toNumber(summary.previous_day_revenue_mwk, 0),
    previousDayLitres: toNumber(summary.previous_day_litres, 0),
    byFuelType: (fuelRows || []).map((row) => ({
      fuelType: String(row.fuel_type || "UNKNOWN"),
      litres: toNumber(row.litres, 0),
    })),
  }
}

async function getQueue(stationId) {
  const [summaryRows, peakRows, settingsRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(status = 'SERVED'), 0) AS drivers_served,
        COALESCE(AVG(
          CASE
            WHEN status = 'SERVED' AND served_at IS NOT NULL
            THEN TIMESTAMPDIFF(SECOND, joined_at, served_at) / 60
            ELSE NULL
          END
        ), 0) AS avg_wait_minutes,
        COALESCE(SUM(status IN ('NO_SHOW', 'CANCELLED')), 0) AS drop_offs
      FROM queue_entries
      WHERE station_id = ${stationId}
        AND DATE(joined_at) = CURRENT_DATE()
    `,
    prisma.$queryRaw`
      SELECT HOUR(joined_at) AS hour, COUNT(*) AS vehicle_count
      FROM queue_entries
      WHERE station_id = ${stationId}
        AND DATE(joined_at) = CURRENT_DATE()
      GROUP BY HOUR(joined_at)
      ORDER BY vehicle_count DESC, hour ASC
      LIMIT 6
    `,
    prisma.$queryRaw`
      SELECT grace_minutes
      FROM station_queue_settings
      WHERE station_id = ${stationId}
      LIMIT 1
    `,
  ])

  const summary = summaryRows?.[0] || {}
  const settings = settingsRows?.[0] || {}
  return {
    driversServed: toNumber(summary.drivers_served, 0),
    avgWaitMinutes: Math.round(toNumber(summary.avg_wait_minutes, 0) * 100) / 100,
    targetWaitMinutes: toNumber(settings.grace_minutes, 10) || 10,
    dropOffs: toNumber(summary.drop_offs, 0),
    peakHours: (peakRows || []).map((row) => ({
      hour: toNumber(row.hour, 0),
      vehicleCount: toNumber(row.vehicle_count, 0),
    })),
  }
}

async function getDeliveries(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_type,
      fd.delivered_time,
      fd.litres
    FROM fuel_deliveries fd
    INNER JOIN tanks t ON t.id = fd.tank_id
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE fd.station_id = ${stationId}
      AND fd.delivered_time >= CURRENT_TIMESTAMP(3)
      AND fd.delivered_time <= DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    ORDER BY fd.delivered_time ASC
    LIMIT 12
  `

  return (rows || []).map((row) => ({
    fuelType: String(row.fuel_type || "UNKNOWN"),
    scheduledAt: toIso(row.delivered_time) || new Date().toISOString(),
    estimatedLitres: toNumber(row.litres, 0),
    status: "confirmed",
  }))
}

export async function generateStationBriefing({ stationPublicId, auth }) {
  const station = await resolveStation(stationPublicId)
  const sessionWindow = await getSessionWindow({
    stationId: station.id,
    userId: auth?.userId,
    sessionPublicId: auth?.sessionPublicId,
  })

  const [tanks, pumps, sales, queue, deliveries] = await Promise.all([
    getTanks(station.id),
    getPumps({ stationId: station.id, since: sessionWindow.lastLoginAt }),
    getSales(station.id),
    getQueue(station.id),
    getDeliveries(station.id),
  ])

  const raw = {
    stationId: station.public_id,
    stationName: station.name,
    lastLoginAt: sessionWindow.lastLoginAt,
    briefingAt: sessionWindow.briefingAt,
    tanks,
    pumps,
    sales,
    queue,
    deliveries,
  }

  validateInput(raw)

  return {
    station: {
      publicId: station.public_id,
      name: station.name,
      timezone: station.timezone,
    },
    generatedAt: sessionWindow.briefingAt,
    sourceWindow: {
      lastLoginAt: sessionWindow.lastLoginAt,
      currentLoginAt: sessionWindow.currentLoginAt,
    },
    briefing: await generateBriefingWithFallback(raw, station.name),
  }
}

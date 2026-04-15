import { prisma } from "../../db/prisma.js"
import { appTodayISO } from "../../utils/dateTime.js"
import {
  buildDemandLevelThresholds,
  classifyDemandLevel,
  classifyInventoryAlert,
  computeCarsPerHour,
  computeEstimatedWaitMinutes,
  computePumpUtilizationPercent,
  computeSalesVelocityLitresPerHour,
  computeTimeUntilEmptyHours,
} from "./stationInsights.calc.js"

const WINDOW_HOURS_MAP = Object.freeze({
  "1h": 1,
  "6h": 6,
  "24h": 24,
})

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "LATE"]

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback
  if (typeof value === "bigint") {
    const cast = Number(value)
    return Number.isFinite(cast) ? cast : fallback
  }
  const stringValue = typeof value?.toString === "function" ? value.toString() : value
  const parsed = Number.parseFloat(String(stringValue))
  return Number.isFinite(parsed) ? parsed : fallback
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function toSqlDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function parseWindow(windowValue, fallback = "1h") {
  const normalized = String(windowValue || fallback).toLowerCase()
  return WINDOW_HOURS_MAP[normalized] ? normalized : fallback
}

function getWindowHours(windowKey) {
  return WINDOW_HOURS_MAP[windowKey] || WINDOW_HOURS_MAP["1h"]
}

function formatHourLabel(date) {
  const hour = date.getHours()
  return `${String(hour).padStart(2, "0")}:00`
}

function formatStockoutEstimate(hours) {
  if (!Number.isFinite(hours) || hours < 0) return "Unavailable"
  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} min`
  }
  if (hours < 24) {
    return `${hours.toFixed(1)} hrs`
  }
  return `${(hours / 24).toFixed(1)} days`
}

function mapByFuel(rows = []) {
  const map = new Map()
  for (const row of rows || []) {
    const fuelCode = String(row.fuel_code || "").toUpperCase()
    if (!fuelCode) continue
    map.set(fuelCode, row)
  }
  return map
}

function dedupeFuelCodes(list) {
  const normalized = new Set((list || []).map((item) => String(item || "").toUpperCase()).filter(Boolean))
  return [...normalized]
}

async function getStationFuelCodes(stationId) {
  const [tankRows, txRows] = await Promise.all([
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

  return dedupeFuelCodes([
    ...(tankRows || []).map((row) => row.fuel_code),
    ...(txRows || []).map((row) => row.fuel_code),
  ])
}

async function getSalesWindowRows(stationId, windowHours) {
  const fromDate = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  const fromDt = toSqlDateTime(fromDate)

  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_code,
      COALESCE(SUM(t.litres), 0) AS litres,
      COUNT(t.id) AS tx_count,
      COALESCE(SUM(t.total_amount), 0) AS revenue
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at BETWEEN ${fromDt} AND CURRENT_TIMESTAMP(3)
    GROUP BY ft.code
  `

  return rows || []
}

async function getAverageLitresPerCarByFuel(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_code,
      COALESCE(SUM(t.litres) / NULLIF(COUNT(t.id), 0), NULL) AS avg_litres
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
    GROUP BY ft.code
  `

  const map = new Map()
  for (const row of rows || []) {
    const fuelCode = String(row.fuel_code || "").toUpperCase()
    if (!fuelCode) continue
    const computed = toFiniteNumber(row.avg_litres, null)
    if (!Number.isFinite(computed) || computed <= 0) continue
    map.set(fuelCode, computed)
  }

  return map
}

async function getDailyTransactionSummary(stationId, dateIso) {
  const fromDt = `${dateIso} 00:00:00`
  const toDt = `${dateIso} 23:59:59`

  const rows = await prisma.$queryRaw`
    SELECT
      ft.code AS fuel_code,
      COALESCE(SUM(t.litres), 0) AS litres,
      COALESCE(SUM(t.total_amount), 0) AS revenue,
      COUNT(t.id) AS tx_count
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at BETWEEN ${fromDt} AND ${toDt}
    GROUP BY ft.code
  `

  return rows || []
}

async function buildPumpUtilizationSnapshot({ stationId, windowKey = "6h" }) {
  const parsedWindow = parseWindow(windowKey, "6h")
  const windowHours = getWindowHours(parsedWindow)
  const windowSeconds = windowHours * 60 * 60
  const fromDt = toSqlDateTime(new Date(Date.now() - windowHours * 60 * 60 * 1000))

  const [pumps, dispenseRows, txRows, telemetryRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        p.id AS pump_id,
        p.public_id AS pump_public_id,
        p.pump_number,
        p.status,
        ft.code AS fuel_code
      FROM pumps p
      LEFT JOIN fuel_types ft ON ft.id = p.fuel_type_id
      WHERE p.station_id = ${stationId}
        AND p.is_active = 1
      ORDER BY p.pump_number ASC
    `,
    prisma.$queryRaw`
      SELECT
        e.pump_id,
        COALESCE(SUM(
          GREATEST(
            0,
            TIMESTAMPDIFF(
              SECOND,
              GREATEST(e.started_at, ${fromDt}),
              LEAST(COALESCE(e.ended_at, CURRENT_TIMESTAMP(3)), CURRENT_TIMESTAMP(3))
            )
          )
        ), 0) AS dispensing_seconds,
        COALESCE(SUM(COALESCE(e.litres, 0)), 0) AS event_litres
      FROM pump_dispense_events e
      WHERE e.station_id = ${stationId}
        AND e.started_at <= CURRENT_TIMESTAMP(3)
        AND COALESCE(e.ended_at, CURRENT_TIMESTAMP(3)) >= ${fromDt}
      GROUP BY e.pump_id
    `,
    prisma.$queryRaw`
      SELECT
        t.pump_id,
        COALESCE(SUM(t.litres), 0) AS litres_sold
      FROM transactions t
      WHERE t.station_id = ${stationId}
        AND t.occurred_at BETWEEN ${fromDt} AND CURRENT_TIMESTAMP(3)
      GROUP BY t.pump_id
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS event_count
      FROM pump_dispense_events
      WHERE station_id = ${stationId}
        AND started_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
  ])

  const hasTelemetry = toFiniteNumber(telemetryRows?.[0]?.event_count, 0) > 0
  const dispenseByPump = new Map((dispenseRows || []).map((row) => [Number(row.pump_id), row]))
  const txByPump = new Map((txRows || []).map((row) => [Number(row.pump_id), row]))

  const rows = (pumps || []).map((pump) => {
    const pumpId = Number(pump.pump_id)
    const dispense = dispenseByPump.get(pumpId)
    const tx = txByPump.get(pumpId)
    const dispensingSeconds = toFiniteNumber(dispense?.dispensing_seconds, 0)
    const utilizationPercent = hasTelemetry
      ? computePumpUtilizationPercent(dispensingSeconds, windowSeconds)
      : null
    const txLitres = toFiniteNumber(tx?.litres_sold, 0)
    const eventLitres = toFiniteNumber(dispense?.event_litres, 0)

    return {
      pumpPublicId: pump.pump_public_id,
      pumpNumber: Number(pump.pump_number),
      fuelType: String(pump.fuel_code || "UNKNOWN").toUpperCase(),
      status: String(pump.status || "UNKNOWN").toUpperCase(),
      utilizationPercent,
      litresSold: txLitres > 0 ? txLitres : eventLitres,
      dispensingSeconds,
      telemetryAvailable: hasTelemetry,
    }
  })

  const rowsWithUtilization = rows.filter((row) => Number.isFinite(row.utilizationPercent))
  let insights = ["Pump telemetry is unavailable. Utilization values are marked N/A."]

  if (rowsWithUtilization.length) {
    const highest = rowsWithUtilization.reduce((best, row) =>
      row.utilizationPercent > best.utilizationPercent ? row : best
    )
    const lowest = rowsWithUtilization.reduce((best, row) =>
      row.utilizationPercent < best.utilizationPercent ? row : best
    )
    insights = [
      `Pump ${highest.pumpNumber} has the highest utilization at ${highest.utilizationPercent.toFixed(1)}%.`,
      `Pump ${lowest.pumpNumber} has the lowest utilization at ${lowest.utilizationPercent.toFixed(1)}%.`,
    ]
  }

  return {
    window: parsedWindow,
    windowHours,
    rows,
    insights,
  }
}

async function buildInventoryPredictionSnapshot(stationId) {
  const [tankRows, velocitySnapshot] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        t.id AS tank_id,
        t.public_id AS tank_public_id,
        t.name AS tank_name,
        t.capacity_litres,
        ft.code AS fuel_code,
        latest.reading_time,
        latest.litres AS remaining_litres
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT ir.tank_id, ir.reading_time, ir.litres
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS max_reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
          GROUP BY tank_id
        ) max_reading
          ON max_reading.tank_id = ir.tank_id
         AND max_reading.max_reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
      ) latest ON latest.tank_id = t.id
      WHERE t.station_id = ${stationId}
      ORDER BY t.name ASC
    `,
    getInsightsSalesVelocity({ stationId, window: "6h" }),
  ])

  const velocityByFuel = new Map(
    (velocitySnapshot.rows || []).map((row) => [String(row.fuelType || "").toUpperCase(), toFiniteNumber(row.salesVelocityLph, 0)])
  )

  const rows = (tankRows || []).map((tank) => {
    const fuelType = String(tank.fuel_code || "UNKNOWN").toUpperCase()
    const remainingLitres =
      tank.remaining_litres === null || tank.remaining_litres === undefined
        ? null
        : toFiniteNumber(tank.remaining_litres, null)
    const velocityLph = velocityByFuel.get(fuelType) || 0
    const timeUntilEmptyHours =
      remainingLitres === null ? null : computeTimeUntilEmptyHours(remainingLitres, velocityLph)
    const alertLevel = classifyInventoryAlert(timeUntilEmptyHours)

    return {
      tankPublicId: tank.tank_public_id,
      tankName: tank.tank_name,
      fuelType,
      remainingLitres,
      velocityLph,
      timeUntilEmptyHours,
      stockoutEstimate: formatStockoutEstimate(timeUntilEmptyHours),
      capacityLitres: toFiniteNumber(tank.capacity_litres, null),
      readingTime: toIsoOrNull(tank.reading_time),
      alertLevel,
    }
  })

  const reorderRows = rows
    .filter((row) => row.remainingLitres !== null)
    .map((row) => ({
      fuelType: row.fuelType,
      remainingLitres: row.remainingLitres,
      estimatedEmpty: row.stockoutEstimate,
      recommendedReorder:
        row.alertLevel === "CRITICAL"
          ? "Immediate reorder"
          : row.alertLevel === "WARNING"
            ? "Reorder within 2 hours"
            : "Monitor demand",
    }))

  const criticalFuel = rows.find((row) => row.alertLevel === "CRITICAL")
  const warningFuel = rows.find((row) => row.alertLevel === "WARNING")
  const reorderReason = criticalFuel
    ? `${criticalFuel.fuelType} demand is increasing rapidly. Delayed reorder may cause shortages.`
    : warningFuel
      ? `${warningFuel.fuelType} stock is trending low. Plan delivery soon to avoid queue disruption.`
      : "Current stock levels are stable. Continue monitoring demand trends."

  return {
    rows,
    alertLevels: [
      { level: "NORMAL", criteria: ">12 hours" },
      { level: "WARNING", criteria: "6-12 hours" },
      { level: "CRITICAL", criteria: "<6 hours" },
    ],
    reorderRows,
    reorderReason,
  }
}

async function buildQueuePredictionSnapshot(stationId) {
  const [salesVelocity, avgLitresMap, queueRows] = await Promise.all([
    getInsightsSalesVelocity({ stationId, window: "1h" }),
    getAverageLitresPerCarByFuel(stationId),
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        COUNT(q.id) AS queue_count
      FROM queue_entries q
      INNER JOIN fuel_types ft ON ft.id = q.fuel_type_id
      WHERE q.station_id = ${stationId}
        AND q.status IN (${ACTIVE_QUEUE_STATUSES[0]}, ${ACTIVE_QUEUE_STATUSES[1]}, ${ACTIVE_QUEUE_STATUSES[2]})
      GROUP BY ft.code
    `,
  ])

  const queueByFuel = new Map((queueRows || []).map((row) => [String(row.fuel_code || "").toUpperCase(), toFiniteNumber(row.queue_count, 0)]))

  const fuelRows = (salesVelocity.rows || []).map((velocityRow) => {
    const fuelType = String(velocityRow.fuelType || "").toUpperCase()
    const queueCount = queueByFuel.get(fuelType) || 0
    const avgLitresPerCar = avgLitresMap.get(fuelType) || null
    const carsPerHour = computeCarsPerHour(velocityRow.salesVelocityLph, avgLitresPerCar)
    const estimatedWaitMinutes = computeEstimatedWaitMinutes(queueCount, carsPerHour)

    return {
      fuelType,
      queueCount,
      salesVelocityLph: toFiniteNumber(velocityRow.salesVelocityLph, 0),
      avgLitresPerCar,
      carsPerHour: Number.isFinite(carsPerHour) && carsPerHour > 0 ? carsPerHour : null,
      estimatedWaitMinutes: Number.isFinite(estimatedWaitMinutes) ? estimatedWaitMinutes : null,
    }
  })

  const totalQueueVehicles = fuelRows.reduce((sum, row) => sum + row.queueCount, 0)
  const totalCarsPerHour = fuelRows.reduce((sum, row) => sum + (row.carsPerHour || 0), 0)
  const totalEstimatedWait = computeEstimatedWaitMinutes(totalQueueVehicles, totalCarsPerHour)
  const queueExamples =
    totalQueueVehicles > 0 && Number.isFinite(totalEstimatedWait)
      ? [
          {
            vehiclesInQueue: totalQueueVehicles,
            estimatedWaitMinutes: totalEstimatedWait,
          },
        ]
      : []

  const primaryFuel = fuelRows.find((row) => row.queueCount > 0 && row.avgLitresPerCar) || null
  const isExample = !primaryFuel

  return {
    formula: "Cars Per Hour = Sales Velocity / Average Litres Per Car",
    exampleCalculation: {
      fuelType: primaryFuel?.fuelType || null,
      salesVelocityLph: primaryFuel?.salesVelocityLph ?? null,
      avgLitresPerCar: primaryFuel?.avgLitresPerCar ?? null,
      carsPerHour: primaryFuel?.carsPerHour ?? null,
      isExample,
      note: isExample
        ? "Live throughput data is currently unavailable."
        : "Live values are calculated from current sales velocity and recent average litres per vehicle.",
    },
    fuelRows,
    queueExamples,
  }
}

function buildRecommendationFromForecast(rows) {
  const highRows = (rows || []).filter((row) => row.demandLevel === "High" || row.demandLevel === "Very High")
  if (!highRows.length) {
    return "No forecast recommendation available."
  }

  const start = highRows[0]?.time || ""
  const end = highRows[highRows.length - 1]?.time || start
  return `Prepare for increased demand between ${start} and ${end}.`
}

async function buildDemandForecastSnapshot(stationId, hours = 6) {
  const lookAheadHours = Math.min(24, Math.max(1, Number(hours) || 6))

  const rows = await prisma.$queryRaw`
    SELECT
      DATE(t.occurred_at) AS day_bucket,
      HOUR(t.occurred_at) AS hour_bucket,
      COALESCE(SUM(t.litres), 0) AS litres
    FROM transactions t
    WHERE t.station_id = ${stationId}
      AND t.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
    GROUP BY DATE(t.occurred_at), HOUR(t.occurred_at)
  `

  const byHour = new Map()
  for (const row of rows || []) {
    const hour = Number(row.hour_bucket)
    const litres = toFiniteNumber(row.litres, 0)
    if (!byHour.has(hour)) byHour.set(hour, [])
    byHour.get(hour).push(litres)
  }

  const meanByHour = new Map()
  const allMeans = []
  for (let hour = 0; hour < 24; hour += 1) {
    const samples = byHour.get(hour) || []
    if (!samples.length) continue
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    meanByHour.set(hour, mean)
    allMeans.push(mean)
  }

  const thresholds = buildDemandLevelThresholds(allMeans)
  const demandLevelFor = (litres) =>
    Number.isFinite(Number(litres))
      ? classifyDemandLevel(litres, thresholds)
      : "Unknown"
  const now = new Date()

  const forecastRows = []
  for (let index = 1; index <= lookAheadHours; index += 1) {
    const timePoint = new Date(now.getTime() + index * 60 * 60 * 1000)
    const hour = timePoint.getHours()
    const expectedLitres = meanByHour.get(hour)
    forecastRows.push({
      time: formatHourLabel(timePoint),
      expectedLitres: Number.isFinite(Number(expectedLitres)) ? expectedLitres : null,
      demandLevel: demandLevelFor(expectedLitres),
    })
  }

  const heatmapHours = [6, 8, 12, 17, 21]
  const heatmap = heatmapHours.map((hour) => {
    const expectedLitres = meanByHour.get(hour)
    return {
      time: `${String(hour).padStart(2, "0")}:00`,
      demandLevel: demandLevelFor(expectedLitres),
      expectedLitres: Number.isFinite(Number(expectedLitres)) ? expectedLitres : null,
    }
  })

  return {
    rows: forecastRows,
    recommendation: buildRecommendationFromForecast(forecastRows),
    heatmap,
  }
}

export async function getInsightsSummary({ stationId, date }) {
  const targetDate = String(date || appTodayISO() || "").trim() || appTodayISO()

  const [dailyRows, activePumpsRows, queueRows, stationRows] = await Promise.all([
    getDailyTransactionSummary(stationId, targetDate),
    prisma.$queryRaw`
      SELECT COUNT(*) AS active_pumps
      FROM pumps
      WHERE station_id = ${stationId}
        AND is_active = 1
        AND status = 'ACTIVE'
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS queue_count
      FROM queue_entries
      WHERE station_id = ${stationId}
        AND status IN (${ACTIVE_QUEUE_STATUSES[0]}, ${ACTIVE_QUEUE_STATUSES[1]}, ${ACTIVE_QUEUE_STATUSES[2]})
    `,
    prisma.$queryRaw`
      SELECT name, city, address
      FROM stations
      WHERE id = ${stationId}
      LIMIT 1
    `,
  ])

  const dailyByFuel = mapByFuel(dailyRows)
  const petrol = dailyByFuel.get("PETROL")
  const diesel = dailyByFuel.get("DIESEL")

  const totalFuelSold = (dailyRows || []).reduce((sum, row) => sum + toFiniteNumber(row.litres, 0), 0)
  const totalRevenue = (dailyRows || []).reduce((sum, row) => sum + toFiniteNumber(row.revenue, 0), 0)
  const totalTransactions = (dailyRows || []).reduce((sum, row) => sum + toFiniteNumber(row.tx_count, 0), 0)

  return {
    date: targetDate,
    station: {
      name: stationRows?.[0]?.name || null,
      city: stationRows?.[0]?.city || null,
      address: stationRows?.[0]?.address || null,
    },
    keyMetrics: {
      petrolSoldTodayLitres: toFiniteNumber(petrol?.litres, 0),
      dieselSoldTodayLitres: toFiniteNumber(diesel?.litres, 0),
      totalRevenue,
      activePumps: toFiniteNumber(activePumpsRows?.[0]?.active_pumps, 0),
      currentQueue: toFiniteNumber(queueRows?.[0]?.queue_count, 0),
    },
    salesPerformance: {
      totalFuelSoldLitres: totalFuelSold,
      petrolTransactions: toFiniteNumber(petrol?.tx_count, 0),
      dieselTransactions: toFiniteNumber(diesel?.tx_count, 0),
      averageFuelPerVehicleLitres:
        totalTransactions > 0 ? totalFuelSold / totalTransactions : 0,
      totalTransactions,
    },
  }
}

export async function getInsightsSalesVelocity({ stationId, window = "1h" }) {
  const parsedWindow = parseWindow(window, "1h")
  const windowHours = getWindowHours(parsedWindow)
  const [salesRows, fuelCodes] = await Promise.all([
    getSalesWindowRows(stationId, windowHours),
    getStationFuelCodes(stationId),
  ])

  const salesByFuel = mapByFuel(salesRows)
  const observedFuelCodes = [
    ...fuelCodes,
    ...(salesRows || []).map((row) => row.fuel_code),
  ]
  const rows = dedupeFuelCodes(observedFuelCodes).map((fuelType) => {
    const salesRow = salesByFuel.get(fuelType)
    const totalLitres = toFiniteNumber(salesRow?.litres, 0)
    return {
      fuelType,
      totalLitresSold: totalLitres,
      windowHours,
      salesVelocityLph: computeSalesVelocityLitresPerHour(totalLitres, windowHours),
      unit: "L/hour",
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    window: parsedWindow,
    formula: "Sales Velocity = Total Litres Sold / Time Period",
    rows,
  }
}

export async function getInsightsPumpUtilization({ stationId, window = "6h" }) {
  const snapshot = await buildPumpUtilizationSnapshot({ stationId, windowKey: window })

  return {
    generatedAt: new Date().toISOString(),
    window: snapshot.window,
    formula: "Pump Utilization = Dispensing Time / Total Time",
    rows: snapshot.rows,
    insights: snapshot.insights,
  }
}

export async function getInsightsInventoryPrediction({ stationId }) {
  const snapshot = await buildInventoryPredictionSnapshot(stationId)

  return {
    generatedAt: new Date().toISOString(),
    formula: "Time Until Empty = Tank Remaining / Sales Velocity",
    rows: snapshot.rows,
    alertLevels: snapshot.alertLevels,
    reorder: {
      rows: snapshot.reorderRows,
      reason: snapshot.reorderReason,
    },
  }
}

export async function getInsightsQueuePrediction({ stationId }) {
  const snapshot = await buildQueuePredictionSnapshot(stationId)

  return {
    generatedAt: new Date().toISOString(),
    formula: snapshot.formula,
    exampleCalculation: snapshot.exampleCalculation,
    fuelRows: snapshot.fuelRows,
    queueExamples: snapshot.queueExamples,
  }
}

export async function getInsightsDemandForecast({ stationId, hours = 6 }) {
  const forecast = await buildDemandForecastSnapshot(stationId, hours)

  return {
    generatedAt: new Date().toISOString(),
    hours: Math.min(24, Math.max(1, Number(hours) || 6)),
    rows: forecast.rows,
    recommendation: forecast.recommendation,
    heatmap: {
      rows: forecast.heatmap,
      purpose: "Helps managers schedule attendants and prepare for peak fueling periods.",
    },
  }
}

export async function getInsightsAlerts({ stationId }) {
  const [salesVelocity, inventoryPrediction, pumpUtilization] = await Promise.all([
    getInsightsSalesVelocity({ stationId, window: "1h" }),
    getInsightsInventoryPrediction({ stationId }),
    getInsightsPumpUtilization({ stationId, window: "6h" }),
  ])

  const baselineVelocity = await getInsightsSalesVelocity({ stationId, window: "6h" })
  const baselineByFuel = new Map((baselineVelocity.rows || []).map((row) => [row.fuelType, row.salesVelocityLph]))

  const alerts = []

  for (const row of salesVelocity.rows || []) {
    const baseline = toFiniteNumber(baselineByFuel.get(row.fuelType), 0)
    if (baseline <= 0 || row.salesVelocityLph <= baseline) continue
    const pctIncrease = ((row.salesVelocityLph - baseline) / baseline) * 100
    if (pctIncrease < 20) continue
    alerts.push({
      id: `high-demand-${row.fuelType}`,
      type: "HIGH_DEMAND_ALERT",
      severity: pctIncrease >= 40 ? "CRITICAL" : "WARNING",
      title: "High Demand Alert",
      message: `${row.fuelType} demand increased by ${pctIncrease.toFixed(1)}% over baseline.`,
      value: pctIncrease,
      unit: "%",
    })
  }

  for (const row of inventoryPrediction.rows || []) {
    if (!row.alertLevel || row.alertLevel === "NORMAL" || row.alertLevel === "UNKNOWN") continue
    alerts.push({
      id: `low-inventory-${row.tankPublicId}`,
      type: "LOW_INVENTORY_ALERT",
      severity: row.alertLevel === "CRITICAL" ? "CRITICAL" : "WARNING",
      title: "Low Inventory Alert",
      message: `${row.tankName} (${row.fuelType}) has ${row.stockoutEstimate} remaining at current demand.`,
      value: row.timeUntilEmptyHours,
      unit: "hours",
    })
  }

  const utilRows = (pumpUtilization.rows || []).filter((row) => Number.isFinite(row.utilizationPercent))
  if (utilRows.length >= 2) {
    const highest = utilRows.reduce((best, row) =>
      row.utilizationPercent > best.utilizationPercent ? row : best
    )
    const lowest = utilRows.reduce((best, row) =>
      row.utilizationPercent < best.utilizationPercent ? row : best
    )
    const delta = highest.utilizationPercent - lowest.utilizationPercent
    if (delta >= 20) {
      alerts.push({
        id: "pump-imbalance",
        type: "PUMP_IMBALANCE_ALERT",
        severity: delta >= 35 ? "CRITICAL" : "WARNING",
        title: "Pump Imbalance Alert",
        message: `Pump ${highest.pumpNumber} is ${delta.toFixed(1)}% more utilized than Pump ${lowest.pumpNumber}.`,
        value: delta,
        unit: "%",
      })
    }
  }

  const criticalInventory = (inventoryPrediction.rows || []).find((row) => row.alertLevel === "CRITICAL")
  const keyInsight = criticalInventory
    ? {
        headline: `${criticalInventory.fuelType} demand is increasing rapidly.`,
        detail: `Fuel stock may run out within ${formatStockoutEstimate(criticalInventory.timeUntilEmptyHours)}.`,
        action: "Schedule a fuel delivery immediately.",
      }
    : {
        headline: "Demand and inventory are currently within expected ranges.",
        detail: "Continue monitoring alerts for early reorder signals.",
        action: "Maintain current operational plan.",
      }

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    keyInsight,
  }
}

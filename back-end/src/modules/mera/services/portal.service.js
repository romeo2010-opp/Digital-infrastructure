import bcrypt from "bcryptjs"
import { prisma } from "../../../db/prisma.js"
import { badRequest, notFound } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"
import { getSmartlinkOpsPrediction } from "../../reports/mlOpsPrediction.service.js"
import { MERA_ROLE_SET } from "../permissions.js"
import { logMeraAudit } from "./audit.service.js"

function toInteger(value, fallback = 0) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) ? normalized : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizePagination({ page = 1, limit = 20 } = {}) {
  const normalizedPage = clamp(toInteger(page, 1), 1, 500)
  const normalizedLimit = clamp(toInteger(limit, 20), 1, 100)
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  }
}

function normalizePublicId(value, label) {
  const scoped = String(value || "").trim()
  if (!scoped) throw badRequest(`${label} is required`)
  return scoped
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeOpsLimit(value, fallback = 6) {
  return clamp(toInteger(value, fallback), 1, 12)
}

function normalizeOpsState(value) {
  return String(value || "").trim().toUpperCase()
}

function normalizeOpsFuelType(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (scoped === "PETROL" || scoped === "DIESEL") return scoped
  return ""
}

function startOfCurrentLocalWeek() {
  const now = new Date()
  const day = now.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toNumber(value, fallback = 0) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function pickMeraOpsFuelType(row, requestedFuelType) {
  const requested = normalizeOpsFuelType(requestedFuelType)
  if (requested) return requested

  const petrolState = normalizeOpsState(row?.petrol_status)
  const dieselState = normalizeOpsState(row?.diesel_status)
  const pressureStates = new Set(["DRY", "OUT_OF_STOCK", "LIMITED", "LOW"])
  if (pressureStates.has(dieselState) && !pressureStates.has(petrolState)) return "DIESEL"
  return "PETROL"
}

function normalizeRole(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (!MERA_ROLE_SET.has(scoped)) throw badRequest("Invalid MERA role")
  return scoped
}

function normalizeAccountStatus(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (!["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"].includes(scoped)) {
    throw badRequest("Invalid MERA account status")
  }
  return scoped
}

function districtFilterValue(auth) {
  return String(auth?.districtScope || "").trim()
}

function hasDistrictScope(auth) {
  return Boolean(districtFilterValue(auth))
}

function isFieldOfficer(auth) {
  return String(auth?.role || "").trim().toUpperCase() === "FIELD_COMPLIANCE_OFFICER"
}

function actorAuditContext(actor = null, overrides = {}) {
  return {
    actorId: actor?.userId || null,
    actorName: actor?.fullName || null,
    actorRole: actor?.role || null,
    permissionUsed: actor?.permissionUsed || null,
    ipAddress: actor?.ipAddress || null,
    deviceInfo: actor?.deviceInfo || null,
    ...overrides,
  }
}

function ensureDistrictAccess(auth, district, label = "record") {
  if (!hasDistrictScope(auth)) return
  const actorDistrict = districtFilterValue(auth).toLowerCase()
  const targetDistrict = String(district || "").trim().toLowerCase()
  if (!targetDistrict || actorDistrict !== targetDistrict) {
    throw badRequest(`You do not have access to this ${label}`)
  }
}

async function resolveStationId(stationPublicId) {
  const scopedPublicId = normalizePublicId(stationPublicId, "stationPublicId")
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address
    FROM stations
    WHERE public_id = ${scopedPublicId}
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  return station
}

async function resolveUserIdByPublicId(userPublicId) {
  if (!String(userPublicId || "").trim()) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE public_id = ${String(userPublicId).trim()}
    LIMIT 1
  `
  return rows?.[0]?.id ? Number(rows[0].id) : null
}

async function resolveMeraUserByPublicId(meraUserPublicId) {
  const scopedPublicId = normalizePublicId(meraUserPublicId, "meraUserPublicId")
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.district_scope,
      mr.code AS role_code,
      mr.display_name AS role_display_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.public_id = ${scopedPublicId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw notFound("MERA user not found")
  return user
}

async function resolveComplaintByPublicId(complaintPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pc.id,
      pc.public_id,
      pc.station_id,
      pc.complaint_status,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE pc.public_id = ${normalizePublicId(complaintPublicId, "complaintPublicId")}
    LIMIT 1
  `
  const complaint = rows?.[0]
  if (!complaint?.id) throw notFound("Complaint not found")
  return complaint
}

async function getLatestInventoryByStationRows(db = prisma) {
  const rows = await db.$queryRaw`
    SELECT
      tank_live.station_id,
      tank_live.district,
      tank_live.fuel_level,
      tank_live.station_availability_status,
      tank_live.fuel_code,
      SUM(
        CASE
          WHEN tank_live.baseline_time IS NULL THEN 0
          ELSE GREATEST(0, tank_live.baseline_litres + tank_live.delivered_litres - tank_live.recorded_litres)
        END
      ) AS remaining_litres,
      SUM(COALESCE(tank_live.capacity_litres, 0)) AS capacity_litres,
      SUM(COALESCE(tank_live.delivered_litres, 0)) AS delivered_litres_since_baseline,
      MAX(tank_live.latest_delivery_time) AS latest_delivery_time,
      SUM(CASE WHEN tank_live.baseline_time IS NULL THEN 0 ELSE 1 END) AS known_tank_count,
      COUNT(tank_live.tank_id) AS tank_count
    FROM (
      SELECT
        s.id AS station_id,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        s.fuel_level,
        s.availability_status AS station_availability_status,
        t.id AS tank_id,
        ft.code AS fuel_code,
        COALESCE(t.capacity_litres, 0) AS capacity_litres,
        COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) AS baseline_litres,
        COALESCE(opening.opening_time, fallback_opening.fallback_opening_time) AS baseline_time,
        COALESCE((
          SELECT SUM(fd.litres)
          FROM fuel_deliveries fd
          WHERE fd.tank_id = t.id
            AND fd.delivered_time >= COALESCE(opening.opening_time, fallback_opening.fallback_opening_time)
            AND fd.delivered_time <= CURRENT_TIMESTAMP(3)
        ), 0) AS delivered_litres,
        (
          SELECT MAX(fd.delivered_time)
          FROM fuel_deliveries fd
          WHERE fd.tank_id = t.id
            AND fd.delivered_time >= COALESCE(opening.opening_time, fallback_opening.fallback_opening_time)
            AND fd.delivered_time <= CURRENT_TIMESTAMP(3)
        ) AS latest_delivery_time,
        COALESCE((
          SELECT SUM(tx.litres)
          FROM transactions tx
          LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
          LEFT JOIN pumps p ON p.id = tx.pump_id
          WHERE tx.station_id = s.id
            AND COALESCE(pn.tank_id, p.tank_id) = t.id
            AND tx.occurred_at >= COALESCE(opening.opening_time, fallback_opening.fallback_opening_time)
            AND tx.occurred_at <= CURRENT_TIMESTAMP(3)
            AND tx.status NOT IN ('CANCELLED', 'REVERSED')
            AND tx.settlement_impact_status <> 'REVERSED'
        ), 0) AS recorded_litres
      FROM stations s
      LEFT JOIN tanks t ON t.station_id = s.id AND t.is_active = 1
      LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS opening_litres, ir.reading_time AS opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MIN(reading_time) AS reading_time
          FROM inventory_readings
          WHERE reading_type = 'OPENING'
            AND reading_time >= CURRENT_DATE()
            AND reading_time < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
          GROUP BY tank_id
        ) first_opening
          ON first_opening.tank_id = ir.tank_id
         AND first_opening.reading_time = ir.reading_time
        WHERE ir.reading_type = 'OPENING'
      ) opening ON opening.tank_id = t.id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS fallback_opening_litres, ir.reading_time AS fallback_opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE reading_type = 'CLOSING'
            AND reading_time < CURRENT_DATE()
          GROUP BY tank_id
        ) previous_closing
          ON previous_closing.tank_id = ir.tank_id
         AND previous_closing.reading_time = ir.reading_time
        WHERE ir.reading_type = 'CLOSING'
      ) fallback_opening ON fallback_opening.tank_id = t.id
      WHERE s.is_active = 1
        AND s.deleted_at IS NULL
    ) tank_live
    GROUP BY tank_live.station_id, tank_live.district, tank_live.fuel_level, tank_live.station_availability_status, tank_live.fuel_code
  `
  return Array.isArray(rows) ? rows : []
}

function buildInventorySnapshot(rows) {
  const stations = new Map()

  for (const row of rows || []) {
    const stationId = Number(row?.station_id || 0)
    if (!stationId) continue

    if (!stations.has(stationId)) {
      stations.set(stationId, {
        stationId,
        district: String(row?.district || 'Unknown'),
        fuelLevel: String(row?.fuel_level || 'MEDIUM').toUpperCase(),
        stationAvailabilityStatus: String(row?.station_availability_status || '').toUpperCase(),
        fuelRemaining: {},
        fuelCapacity: {},
        fuelKnown: {},
        fuelTankCount: {},
        fuelDeliveredSinceBaseline: {},
        fuelLatestDeliveryTime: {},
        totalRemainingLitres: 0,
        totalCapacityLitres: 0,
        deliveredLitresSinceBaseline: 0,
        latestDeliveryTime: null,
      })
    }

    const station = stations.get(stationId)
    const fuelCode = String(row?.fuel_code || '').trim().toUpperCase()
    const remainingLitres = Number(row?.remaining_litres || 0)
    const capacityLitres = Number(row?.capacity_litres || 0)
    const deliveredLitresSinceBaseline = Number(row?.delivered_litres_since_baseline || 0)
    const latestDeliveryTime = row?.latest_delivery_time || null
    const knownTankCount = Number(row?.known_tank_count || 0)
    const tankCount = Number(row?.tank_count || 0)

    if (fuelCode) {
      station.fuelRemaining[fuelCode] = remainingLitres
      station.fuelCapacity[fuelCode] = capacityLitres
      station.fuelKnown[fuelCode] = knownTankCount > 0
      station.fuelTankCount[fuelCode] = tankCount
      station.fuelDeliveredSinceBaseline[fuelCode] = deliveredLitresSinceBaseline
      station.fuelLatestDeliveryTime[fuelCode] = latestDeliveryTime
    }
    station.totalRemainingLitres += remainingLitres
    station.totalCapacityLitres += capacityLitres
    station.deliveredLitresSinceBaseline += deliveredLitresSinceBaseline
    if (latestDeliveryTime) {
      const latestDate = new Date(latestDeliveryTime)
      const currentLatestDate = station.latestDeliveryTime ? new Date(station.latestDeliveryTime) : null
      if (!currentLatestDate || latestDate.getTime() > currentLatestDate.getTime()) {
        station.latestDeliveryTime = latestDeliveryTime
      }
    }
  }

  const stationList = Array.from(stations.values()).map((station) => {
    const knownFuels = Object.keys(station.fuelKnown).filter((fuelCode) => station.fuelKnown[fuelCode])
    const positiveFuels = knownFuels.filter((fuelCode) => Number(station.fuelRemaining[fuelCode] || 0) > 0)
    const outOfStock = knownFuels.length > 0 && positiveFuels.length === 0
    const partialOutage = knownFuels.length > 1 && positiveFuels.length > 0 && positiveFuels.length < knownFuels.length

    return {
      ...station,
      outOfStock,
      partialOutage,
    }
  })

  return {
    stations: stationList,
    byStationId: new Map(stationList.map((station) => [station.stationId, station])),
  }
}

function fuelStatusFromInventory(station, fuelCode) {
  const remainingLitres = Number(station?.fuelRemaining?.[fuelCode] || 0)
  const capacityLitres = Number(station?.fuelCapacity?.[fuelCode] || 0)
  const fuelLevel = String(station?.fuelLevel || "").toUpperCase()

  if (!station?.fuelKnown?.[fuelCode]) return "UNKNOWN"
  if (remainingLitres <= 0) return "DRY"
  if (fuelLevel === "LOW") return "LIMITED"
  if (capacityLitres > 0 && remainingLitres / capacityLitres <= 0.15) return "LIMITED"
  if (remainingLitres <= 120) return "LIMITED"
  return "AVAILABLE"
}

function fuelHasDeliveryEvidence(station, fuelCode, fuelStatus) {
  if (!["AVAILABLE", "LIMITED"].includes(normalizeStationState(fuelStatus))) return false
  return Number(station?.fuelDeliveredSinceBaseline?.[fuelCode] || 0) > 0
}

function stationHasDeliveryVerifiedFuel(station) {
  return Object.keys(station?.fuelKnown || {}).some((fuelCode) => (
    station.fuelKnown[fuelCode] && fuelHasDeliveryEvidence(station, fuelCode, fuelStatusFromInventory(station, fuelCode))
  ))
}

function deriveStationStatusFromInventory(station) {
  const petrolStatus = fuelStatusFromInventory(station, "PETROL")
  const dieselStatus = fuelStatusFromInventory(station, "DIESEL")
  const statuses = Object.keys(station?.fuelKnown || {}).map((fuelCode) => fuelStatusFromInventory(station, fuelCode))
  const knownStatuses = statuses.filter((status) => status !== "UNKNOWN")

  let availabilityStatus = "UNKNOWN"
  if (knownStatuses.length > 0) {
    availabilityStatus = knownStatuses.every((status) => status === "DRY")
      ? "DRY"
      : knownStatuses.some((status) => status === "DRY" || status === "LIMITED")
        ? "LIMITED"
        : "AVAILABLE"
  } else if (normalizeStationState(station?.stationAvailabilityStatus) === "AVAILABLE") {
    availabilityStatus = "AVAILABLE"
  }

  return {
    availabilityStatus,
    petrolStatus: availabilityStatus === "AVAILABLE" && petrolStatus === "UNKNOWN" ? "AVAILABLE" : petrolStatus,
    dieselStatus: availabilityStatus === "AVAILABLE" && dieselStatus === "UNKNOWN" ? "AVAILABLE" : dieselStatus,
  }
}

function stationHasKnownInventory(station) {
  return Object.values(station?.fuelKnown || {}).some(Boolean)
}

function statusFromManualCurrentRow(current, station) {
  if (stationHasKnownInventory(station)) return null

  const source = String(current?.reported_source || "").trim().toUpperCase()
  if (!["MERA_INSPECTION", "STATION", "USER"].includes(source)) return null

  const allowed = new Set(["AVAILABLE", "LIMITED", "DRY", "UNKNOWN"])
  const availabilityStatus = normalizeStationState(current?.availability_status)
  const petrolStatus = normalizeStationState(current?.petrol_status)
  const dieselStatus = normalizeStationState(current?.diesel_status)
  if (!allowed.has(availabilityStatus)) return null

  return {
    availabilityStatus,
    petrolStatus: allowed.has(petrolStatus) ? petrolStatus : availabilityStatus,
    dieselStatus: allowed.has(dieselStatus) ? dieselStatus : availabilityStatus,
  }
}

function statusLogDiffers(row, nextStatus) {
  return (
    normalizeStationState(row?.availability_status) !== nextStatus.availabilityStatus ||
    normalizeStationState(row?.petrol_status) !== nextStatus.petrolStatus ||
    normalizeStationState(row?.diesel_status) !== nextStatus.dieselStatus
  )
}

function currentStatusPayloadForStation(station, nextStatus, now) {
  return {
    stationId: Number(station.stationId),
    availabilityStatus: nextStatus.availabilityStatus,
    petrolStatus: nextStatus.petrolStatus,
    dieselStatus: nextStatus.dieselStatus,
    petrolLiveLitres: station.fuelKnown?.PETROL ? Number(station.fuelRemaining?.PETROL || 0) : null,
    dieselLiveLitres: station.fuelKnown?.DIESEL ? Number(station.fuelRemaining?.DIESEL || 0) : null,
    totalLiveLitres: Number(station.totalRemainingLitres || 0),
    totalCapacityLitres: Number(station.totalCapacityLitres || 0),
    knownFuelCount: Object.values(station.fuelKnown || {}).filter(Boolean).length,
    tankCount: Object.values(station.fuelTankCount || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    deliveryVerified: stationHasDeliveryVerifiedFuel(station),
    petrolDeliveryVerified: fuelHasDeliveryEvidence(station, "PETROL", nextStatus.petrolStatus),
    dieselDeliveryVerified: fuelHasDeliveryEvidence(station, "DIESEL", nextStatus.dieselStatus),
    deliveredLitresSinceBaseline: Number(station.deliveredLitresSinceBaseline || 0),
    petrolDeliveredLitresSinceBaseline: station.fuelKnown?.PETROL ? Number(station.fuelDeliveredSinceBaseline?.PETROL || 0) : null,
    dieselDeliveredLitresSinceBaseline: station.fuelKnown?.DIESEL ? Number(station.fuelDeliveredSinceBaseline?.DIESEL || 0) : null,
    latestDeliveryTime: station.latestDeliveryTime || null,
    lastDerivedAt: now,
  }
}

function bucketStartFor(date, bucketMinutes) {
  const bucketMs = bucketMinutes * 60 * 1000
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs)
}

function aggregateStatusRowsForRollups(statusRows) {
  const groups = new Map()

  const touch = (districtKey, districtLabel) => {
    if (!groups.has(districtKey)) {
      groups.set(districtKey, {
        districtKey,
        districtLabel,
        availableCount: 0,
        limitedCount: 0,
        dryCount: 0,
        unknownCount: 0,
        totalStations: 0,
        stationsWithFuel: 0,
        deliveryVerifiedStationsWithFuel: 0,
      })
    }
    return groups.get(districtKey)
  }

  for (const row of statusRows) {
    const district = String(row.district || "Unknown").trim() || "Unknown"
    for (const group of [touch("__NATIONAL__", null), touch(district, district)]) {
      const availability = normalizeStationState(row.availabilityStatus)
      group.totalStations += 1
      if (availability === "AVAILABLE") group.availableCount += 1
      else if (availability === "LIMITED") group.limitedCount += 1
      else if (availability === "DRY" || availability === "OUT_OF_STOCK") group.dryCount += 1
      else group.unknownCount += 1
      if (isFuelAvailableState({
        availability_status: row.availabilityStatus,
        petrol_status: row.petrolStatus,
        diesel_status: row.dieselStatus,
      })) {
        group.stationsWithFuel += 1
        if (row.deliveryVerified) group.deliveryVerifiedStationsWithFuel += 1
      }
    }
  }

  return [...groups.values()]
}

async function writeStationStatusRollups(statusRows, now, db = prisma) {
  const bucketMinutesList = [1, 5, 30, 120, 1440]
  const groups = aggregateStatusRowsForRollups(statusRows)
  let upserted = 0

  for (const bucketMinutes of bucketMinutesList) {
    const bucketStart = bucketStartFor(now, bucketMinutes)
    for (const group of groups) {
      await db.$executeRaw`
        INSERT INTO station_status_rollups (
          bucket_start,
          bucket_minutes,
          district_key,
          district_label,
          available_count,
          limited_count,
          dry_count,
          unknown_count,
          total_stations,
          stations_with_fuel,
          delivery_verified_stations_with_fuel
        )
        VALUES (
          ${bucketStart},
          ${bucketMinutes},
          ${group.districtKey},
          ${group.districtLabel},
          ${group.availableCount},
          ${group.limitedCount},
          ${group.dryCount},
          ${group.unknownCount},
          ${group.totalStations},
          ${group.stationsWithFuel},
          ${group.deliveryVerifiedStationsWithFuel}
        )
        ON DUPLICATE KEY UPDATE
          district_label = VALUES(district_label),
          available_count = VALUES(available_count),
          limited_count = VALUES(limited_count),
          dry_count = VALUES(dry_count),
          unknown_count = VALUES(unknown_count),
          total_stations = VALUES(total_stations),
          stations_with_fuel = VALUES(stations_with_fuel),
          delivery_verified_stations_with_fuel = VALUES(delivery_verified_stations_with_fuel),
          updated_at = CURRENT_TIMESTAMP(3)
      `
      upserted += 1
    }
  }

  return upserted
}

async function pruneGeneratedStationStatusLogs(retentionDays, db = prisma) {
  const normalizedRetentionDays = Math.max(1, Number(retentionDays || 90))
  await db.$executeRaw`
    DELETE status_log
    FROM station_status_logs status_log
    WHERE status_log.reported_source = 'SYSTEM'
      AND status_log.created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${normalizedRetentionDays} DAY)
      AND EXISTS (
        SELECT 1
        FROM station_status_rollups rollup
        WHERE rollup.bucket_minutes = 1440
          AND DATE(rollup.bucket_start) = DATE(status_log.created_at)
      )
  `
}

export async function syncInventoryDerivedStationStatusLogs({ heartbeatMinutes = 60, retentionDays = 90, db = prisma } = {}) {
  const inventoryRows = await getLatestInventoryByStationRows(db)
  const inventorySnapshot = buildInventorySnapshot(inventoryRows)
  const stations = inventorySnapshot.stations

  if (!stations.length) return { inserted: 0, scanned: 0, currentStatuses: 0, rollups: 0 }

  const clockRows = await db.$queryRaw`
    SELECT CURRENT_TIMESTAMP(3) AS database_now
  `
  const currentRows = await db.$queryRaw`
    SELECT
      station_id,
      availability_status,
      petrol_status,
      diesel_status,
      reported_source,
      last_logged_at
    FROM station_current_status
  `
  const latestRows = await db.$queryRaw`
    SELECT
      status_log.station_id,
      status_log.availability_status,
      status_log.petrol_status,
      status_log.diesel_status,
      status_log.created_at
    FROM station_status_logs AS status_log
    INNER JOIN (
      SELECT station_id, MAX(created_at) AS latest_created_at
      FROM station_status_logs
      GROUP BY station_id
    ) AS latest
      ON latest.station_id = status_log.station_id
     AND latest.latest_created_at = status_log.created_at
  `

  const now = clockRows?.[0]?.database_now ? new Date(clockRows[0].database_now) : new Date()
  const heartbeatMs = Math.max(1, Number(heartbeatMinutes || 60)) * 60 * 1000
  const currentByStation = new Map(normalizeRows(currentRows).map((row) => [Number(row.station_id), row]))
  const latestByStation = new Map(normalizeRows(latestRows).map((row) => [Number(row.station_id), row]))
  const statusRowsForRollups = []
  let inserted = 0
  let upsertedCurrent = 0

  for (const station of stations) {
    const latest = latestByStation.get(Number(station.stationId))
    const current = currentByStation.get(Number(station.stationId))
    const nextStatus = statusFromManualCurrentRow(current, station) || deriveStationStatusFromInventory(station)
    const lastLoggedAt = latest?.created_at ? new Date(latest.created_at) : current?.last_logged_at ? new Date(current.last_logged_at) : null
    const heartbeatDue = !lastLoggedAt || now.getTime() - lastLoggedAt.getTime() >= heartbeatMs
    const shouldLog = !latest || statusLogDiffers(latest, nextStatus) || heartbeatDue
    const currentPayload = currentStatusPayloadForStation(station, nextStatus, now)
    const nextLastLoggedAt = shouldLog ? now : lastLoggedAt

    statusRowsForRollups.push({
      district: station.district,
      availabilityStatus: nextStatus.availabilityStatus,
      petrolStatus: nextStatus.petrolStatus,
      dieselStatus: nextStatus.dieselStatus,
      deliveryVerified: currentPayload.deliveryVerified,
    })

    await db.$executeRaw`
      INSERT INTO station_current_status (
        station_id,
        availability_status,
        diesel_status,
        petrol_status,
        petrol_live_litres,
        diesel_live_litres,
        total_live_litres,
        total_capacity_litres,
        known_fuel_count,
        tank_count,
        delivery_verified,
        petrol_delivery_verified,
        diesel_delivery_verified,
        delivered_litres_since_baseline,
        petrol_delivered_litres_since_baseline,
        diesel_delivered_litres_since_baseline,
        latest_delivery_time,
        last_derived_at,
        last_logged_at
      )
      VALUES (
        ${currentPayload.stationId},
        ${currentPayload.availabilityStatus},
        ${currentPayload.dieselStatus},
        ${currentPayload.petrolStatus},
        ${currentPayload.petrolLiveLitres},
        ${currentPayload.dieselLiveLitres},
        ${currentPayload.totalLiveLitres},
        ${currentPayload.totalCapacityLitres},
        ${currentPayload.knownFuelCount},
        ${currentPayload.tankCount},
        ${currentPayload.deliveryVerified},
        ${currentPayload.petrolDeliveryVerified},
        ${currentPayload.dieselDeliveryVerified},
        ${currentPayload.deliveredLitresSinceBaseline},
        ${currentPayload.petrolDeliveredLitresSinceBaseline},
        ${currentPayload.dieselDeliveredLitresSinceBaseline},
        ${currentPayload.latestDeliveryTime},
        ${currentPayload.lastDerivedAt},
        ${nextLastLoggedAt}
      )
      ON DUPLICATE KEY UPDATE
        availability_status = VALUES(availability_status),
        diesel_status = VALUES(diesel_status),
        petrol_status = VALUES(petrol_status),
        petrol_live_litres = VALUES(petrol_live_litres),
        diesel_live_litres = VALUES(diesel_live_litres),
        total_live_litres = VALUES(total_live_litres),
        total_capacity_litres = VALUES(total_capacity_litres),
        known_fuel_count = VALUES(known_fuel_count),
        tank_count = VALUES(tank_count),
        delivery_verified = VALUES(delivery_verified),
        petrol_delivery_verified = VALUES(petrol_delivery_verified),
        diesel_delivery_verified = VALUES(diesel_delivery_verified),
        delivered_litres_since_baseline = VALUES(delivered_litres_since_baseline),
        petrol_delivered_litres_since_baseline = VALUES(petrol_delivered_litres_since_baseline),
        diesel_delivered_litres_since_baseline = VALUES(diesel_delivered_litres_since_baseline),
        latest_delivery_time = VALUES(latest_delivery_time),
        last_derived_at = VALUES(last_derived_at),
        last_logged_at = VALUES(last_logged_at),
        updated_at = CURRENT_TIMESTAMP(3)
    `
    upsertedCurrent += 1

    if (!shouldLog) continue

    await db.$executeRaw`
      INSERT INTO station_status_logs (
        station_id,
        reported_source,
        availability_status,
        diesel_status,
        petrol_status,
        updated_by
      )
      VALUES (
        ${station.stationId},
        'SYSTEM',
        ${nextStatus.availabilityStatus},
        ${nextStatus.dieselStatus},
        ${nextStatus.petrolStatus},
        NULL
      )
    `
    inserted += 1
  }

  const rollups = await writeStationStatusRollups(statusRowsForRollups, now, db)
  await pruneGeneratedStationStatusLogs(retentionDays, db)

  return { inserted, scanned: stations.length, currentStatuses: upsertedCurrent, rollups }
}

async function resolveInspectionByPublicId(inspectionPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      i.id,
      i.public_id,
      i.station_id,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    WHERE public_id = ${normalizePublicId(inspectionPublicId, "inspectionPublicId")}
    LIMIT 1
  `
  const inspection = rows?.[0]
  if (!inspection?.id) throw notFound("Inspection not found")
  return inspection
}

async function resolveFlagByPublicId(flagPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      cf.id,
      cf.public_id,
      cf.station_id,
      cf.resolved_status,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    WHERE public_id = ${normalizePublicId(flagPublicId, "flagPublicId")}
    LIMIT 1
  `
  const flag = rows?.[0]
  if (!flag?.id) throw notFound("Compliance flag not found")
  return flag
}

async function syncAvailabilityAuditRecord({
  stationId,
  petrolAvailable,
  dieselAvailable,
  activePumps = null,
  reportedBy = null,
  createdAt = null,
}) {
  await prisma.$executeRaw`
    INSERT INTO station_availability_reports (
      station_id,
      petrol_available,
      diesel_available,
      active_pumps,
      reported_by,
      created_at
    )
    VALUES (
      ${stationId},
      ${petrolAvailable},
      ${dieselAvailable},
      ${activePumps},
      ${reportedBy},
      COALESCE(${createdAt}, CURRENT_TIMESTAMP(3))
    )
  `
}

export async function createComplianceFlagRecord({
  stationId,
  flagType,
  severity = "MEDIUM",
  generatedReason,
  sourceReference = null,
  actor = null,
}) {
  const recentRows = await prisma.$queryRaw`
    SELECT id, public_id
    FROM compliance_flags
    WHERE station_id = ${stationId}
      AND flag_type = ${flagType}
      AND resolved_status IN ('OPEN', 'UNDER_REVIEW')
      AND (${String(sourceReference || "").trim() === ""} = TRUE OR source_reference = ${sourceReference})
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (recentRows?.[0]?.id) {
    return {
      created: false,
      flagPublicId: recentRows[0].public_id,
    }
  }

  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO compliance_flags (
      public_id,
      station_id,
      flag_type,
      severity,
      generated_reason,
      source_reference
    )
    VALUES (
      ${publicId},
      ${stationId},
      ${flagType},
      ${severity},
      ${generatedReason},
      ${sourceReference}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FLAG_CREATED",
    actionDescription: `Compliance flag ${flagType} created for station ${stationId}.`,
    affectedEntity: publicId,
  })

  return {
    created: true,
    flagPublicId: publicId,
  }
}

export async function listPublicStations({ query = "", limit = 20 } = {}) {
  const scopedQuery = `%${String(query || "").trim()}%`
  const scopedLimit = clamp(toInteger(limit, 20), 1, 100)
  const rows = await prisma.$queryRaw`
    SELECT public_id, name, city, address
    FROM stations
    WHERE is_active = 1
      AND (
        ${String(query || "").trim() === ""} = TRUE
        OR name LIKE ${scopedQuery}
        OR city LIKE ${scopedQuery}
        OR address LIKE ${scopedQuery}
      )
    ORDER BY name ASC
    LIMIT ${scopedLimit}
  `
  return (rows || []).map((row) => ({
    publicId: row.public_id,
    name: row.name,
    city: row.city || null,
    address: row.address || null,
  }))
}

export async function createPublicComplaint({
  stationPublicId,
  complaintType,
  complaintDescription,
  mediaUrl = null,
  geoLat = null,
  geoLng = null,
  userPublicId = null,
}) {
  const station = await resolveStationId(stationPublicId)
  const userId = await resolveUserIdByPublicId(userPublicId)
  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO public_complaints (
      public_id,
      user_id,
      station_id,
      complaint_type,
      complaint_description,
      media_url,
      geo_lat,
      geo_lng
    )
    VALUES (
      ${publicId},
      ${userId},
      ${station.id},
      ${complaintType},
      ${complaintDescription},
      ${mediaUrl},
      ${geoLat},
      ${geoLng}
    )
  `

  await logMeraAudit({
    actorName: "Public Portal",
    actorRole: "PUBLIC_PORTAL",
    permissionUsed: "PUBLIC_COMPLAINT_CREATE",
    actionType: "PUBLIC_COMPLAINT_CREATED",
    actionDescription: `Public complaint ${publicId} created against ${station.name}.`,
    affectedEntity: publicId,
  })

  return {
    complaintPublicId: publicId,
    station: {
      publicId: station.public_id,
      name: station.name,
      city: station.city || null,
    },
    complaintType,
    complaintStatus: "NEW",
  }
}

export async function listComplaints(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const complaintTypeFilter = String(filters.complaintType || "").trim().toUpperCase()
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      pc.public_id,
      pc.complaint_type,
      pc.complaint_description,
      pc.media_url,
      pc.geo_lat,
      pc.geo_lng,
      pc.complaint_status,
      pc.created_at,
      pc.updated_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name,
      u.public_id AS user_public_id,
      u.full_name AS user_name
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    LEFT JOIN mera_users mu ON mu.id = pc.assigned_officer_id
    LEFT JOIN users u ON u.id = pc.user_id
    WHERE (${statusFilter === ""} = TRUE OR pc.complaint_status = ${statusFilter})
      AND (${complaintTypeFilter === ""} = TRUE OR pc.complaint_type = ${complaintTypeFilter})
      AND (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY pc.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      complaintType: row.complaint_type,
      description: row.complaint_description,
      mediaUrl: row.media_url || null,
      geoLat: row.geo_lat,
      geoLng: row.geo_lng,
      complaintStatus: row.complaint_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      assignedOfficer: row.officer_public_id
        ? {
            publicId: row.officer_public_id,
            fullName: row.officer_name,
          }
        : null,
      complainant: row.user_public_id
        ? {
            publicId: row.user_public_id,
            fullName: row.user_name || null,
          }
        : null,
    })),
  }
}

export async function assignComplaint({ complaintPublicId, officerPublicId, actor }) {
  const complaint = await resolveComplaintByPublicId(complaintPublicId)
  const officer = await resolveMeraUserByPublicId(officerPublicId)
  ensureDistrictAccess(actor, complaint.district, "complaint")
  if (hasDistrictScope(actor)) {
    ensureDistrictAccess(actor, officer.district_scope, "officer")
  }

  await prisma.$executeRaw`
    UPDATE public_complaints
    SET
      assigned_officer_id = ${officer.id},
      complaint_status = 'ASSIGNED',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_COMPLAINT_ASSIGNED",
    actionDescription: `Complaint ${complaint.public_id} assigned to ${officer.full_name}.`,
    affectedEntity: complaint.public_id,
  })

  return {
    complaintPublicId: complaint.public_id,
    assignedOfficer: {
      publicId: officer.public_id,
      fullName: officer.full_name,
      role: officer.role_code,
    },
    complaintStatus: "ASSIGNED",
  }
}

export async function updateComplaintStatus({ complaintPublicId, complaintStatus, actor }) {
  const complaint = await resolveComplaintByPublicId(complaintPublicId)
  ensureDistrictAccess(actor, complaint.district, "complaint")
  await prisma.$executeRaw`
    UPDATE public_complaints
    SET complaint_status = ${complaintStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_COMPLAINT_STATUS_UPDATED",
    actionDescription: `Complaint ${complaint.public_id} moved to ${complaintStatus}.`,
    affectedEntity: complaint.public_id,
  })

  return {
    complaintPublicId: complaint.public_id,
    complaintStatus,
  }
}

export async function createInspection(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  let officerId = actor.userId
  if (String(payload.officerPublicId || "").trim()) {
    const officer = await resolveMeraUserByPublicId(payload.officerPublicId)
    if (hasDistrictScope(actor)) {
      ensureDistrictAccess(actor, officer.district_scope, "officer")
    }
    officerId = Number(officer.id)
  }
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO inspections (
      public_id,
      station_id,
      officer_id,
      inspection_type,
      queue_length,
      stock_visible,
      pumps_active,
      displayed_price,
      illegal_vending_detected,
      geotag_lat,
      geotag_lng,
      officer_notes,
      inspection_status
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${officerId},
      ${payload.inspectionType},
      ${payload.queueLength},
      ${payload.stockVisible},
      ${payload.pumpsActive},
      ${payload.displayedPrice},
      ${payload.illegalVendingDetected},
      ${payload.geotagLat},
      ${payload.geotagLng},
      ${payload.officerNotes},
      ${payload.inspectionStatus}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_INSPECTION_CREATED",
    actionDescription: `Inspection ${publicId} created for ${station.name}.`,
    affectedEntity: publicId,
  })

  return {
    inspectionPublicId: publicId,
    stationPublicId: station.public_id,
    inspectionStatus: payload.inspectionStatus,
  }
}

export async function attachInspectionEvidence({ inspectionPublicId, fileUrl, fileType, actor }) {
  const inspection = await resolveInspectionByPublicId(inspectionPublicId)
  ensureDistrictAccess(actor, inspection.district, "inspection")
  await prisma.$executeRaw`
    INSERT INTO inspection_evidence (inspection_id, file_url, file_type)
    VALUES (${inspection.id}, ${fileUrl}, ${fileType})
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_INSPECTION_EVIDENCE_UPLOADED",
    actionDescription: `Evidence uploaded for inspection ${inspection.public_id}.`,
    affectedEntity: inspection.public_id,
  })

  return {
    inspectionPublicId: inspection.public_id,
    fileUrl,
    fileType,
  }
}

export async function listInspections(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      i.public_id,
      i.inspection_type,
      i.queue_length,
      i.stock_visible,
      i.pumps_active,
      i.displayed_price,
      i.illegal_vending_detected,
      i.geotag_lat,
      i.geotag_lng,
      i.officer_notes,
      CASE
        WHEN rt.status = 'COMPLETED' THEN 'CLOSED'
        WHEN rt.status IN ('CANCELLED', 'REJECTED') THEN 'CLOSED'
        WHEN rt.status = 'ESCALATED' THEN 'ESCALATED'
        WHEN rt.status IN ('ACKNOWLEDGED', 'IN_PROGRESS', 'NEEDS_MORE_INFO') THEN 'OPEN'
        ELSE i.inspection_status
      END AS inspection_status,
      i.inspection_status AS stored_inspection_status,
      i.created_at,
      rt.task_number,
      rt.title AS task_title,
      rt.description AS task_description,
      rt.type AS task_type,
      rt.priority AS task_priority,
      rt.status AS task_status,
      rt.due_at AS task_due_at,
      rt.completed_at AS task_completed_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    INNER JOIN mera_users mu ON mu.id = i.officer_id
    LEFT JOIN regulator_tasks rt
      ON rt.id = (
        SELECT linked_task.id
        FROM regulator_tasks linked_task
        WHERE linked_task.linked_entity_type = 'INSPECTION'
          AND linked_task.linked_entity_id = i.public_id
          AND linked_task.deleted_at IS NULL
        ORDER BY linked_task.created_at DESC
        LIMIT 1
      )
    WHERE (
        ${statusFilter === ""} = TRUE
        OR i.inspection_status = ${statusFilter}
        OR (${statusFilter} = 'CLOSED' AND rt.status IN ('COMPLETED', 'CANCELLED', 'REJECTED'))
        OR (${statusFilter} = 'ESCALATED' AND rt.status = 'ESCALATED')
        OR (${statusFilter} = 'OPEN' AND rt.status IN ('ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'NEEDS_MORE_INFO'))
      )
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      AND (${isFieldOfficer(auth) === false} = TRUE OR i.officer_id = ${auth?.userId || 0})
    ORDER BY i.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      inspectionType: row.inspection_type,
      queueLength: row.queue_length,
      stockVisible: Number(row.stock_visible) === 1,
      pumpsActive: row.pumps_active,
      displayedPrice: row.displayed_price,
      illegalVendingDetected: Number(row.illegal_vending_detected) === 1,
      geotagLat: row.geotag_lat,
      geotagLng: row.geotag_lng,
      officerNotes: row.officer_notes || null,
      inspectionStatus: row.inspection_status,
      storedInspectionStatus: row.stored_inspection_status,
      createdAt: row.created_at,
      task: row.task_number ? {
        taskNumber: row.task_number,
        title: row.task_title,
        description: row.task_description,
        type: row.task_type,
        priority: row.task_priority,
        status: row.task_status,
        dueAt: row.task_due_at,
        completedAt: row.task_completed_at,
      } : null,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      officer: {
        publicId: row.officer_public_id,
        fullName: row.officer_name,
      },
    })),
  }
}

export async function getStationInspectionHistory(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const rows = await prisma.$queryRaw`
    SELECT
      i.public_id,
      i.inspection_type,
      i.inspection_status,
      i.queue_length,
      i.stock_visible,
      i.pumps_active,
      i.displayed_price,
      i.illegal_vending_detected,
      i.officer_notes,
      i.created_at,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN mera_users mu ON mu.id = i.officer_id
    WHERE i.station_id = ${station.id}
    ORDER BY i.created_at DESC
  `
  return {
    station: {
      publicId: station.public_id,
      name: station.name,
    },
    items: rows || [],
  }
}

export async function createManualFlag(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  const result = await createComplianceFlagRecord({
    stationId: Number(station.id),
    flagType: payload.flagType,
    severity: payload.severity,
    generatedReason: payload.generatedReason,
    sourceReference: payload.sourceReference,
    actor,
  })
  return {
    stationPublicId: station.public_id,
    ...result,
  }
}

export async function listFlags(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const severityFilter = String(filters.severity || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      cf.public_id,
      cf.flag_type,
      cf.severity,
      cf.generated_reason,
      cf.source_reference,
      cf.resolved_status,
      cf.created_at,
      cf.resolved_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS resolved_by_public_id,
      mu.full_name AS resolved_by_name
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    LEFT JOIN mera_users mu ON mu.id = cf.resolved_by
    WHERE (${statusFilter === ""} = TRUE OR cf.resolved_status = ${statusFilter})
      AND (${severityFilter === ""} = TRUE OR cf.severity = ${severityFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY cf.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      flagType: row.flag_type,
      severity: row.severity,
      generatedReason: row.generated_reason,
      sourceReference: row.source_reference || null,
      resolvedStatus: row.resolved_status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      resolvedBy: row.resolved_by_public_id
        ? {
            publicId: row.resolved_by_public_id,
            fullName: row.resolved_by_name,
          }
        : null,
    })),
  }
}

export async function resolveFlag({ flagPublicId, resolvedStatus, actor }) {
  const flag = await resolveFlagByPublicId(flagPublicId)
  ensureDistrictAccess(actor, flag.district, "flag")
  await prisma.$executeRaw`
    UPDATE compliance_flags
    SET
      resolved_status = ${resolvedStatus},
      resolved_at = CURRENT_TIMESTAMP(3),
      resolved_by = ${actor.userId}
    WHERE id = ${flag.id}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FLAG_RESOLVED",
    actionDescription: `Flag ${flag.public_id} marked ${resolvedStatus}.`,
    affectedEntity: flag.public_id,
  })
  return {
    flagPublicId: flag.public_id,
    resolvedStatus,
  }
}

export async function createEnforcementAction(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  let relatedFlagId = null
  if (String(payload.relatedFlagPublicId || "").trim()) {
    const flag = await resolveFlagByPublicId(payload.relatedFlagPublicId)
    ensureDistrictAccess(actor, flag.district, "flag")
    relatedFlagId = Number(flag.id)
  }
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO enforcement_actions (
      public_id,
      station_id,
      initiated_by,
      related_flag_id,
      action_type,
      action_notes,
      action_status
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${actor.userId},
      ${relatedFlagId},
      ${payload.actionType},
      ${payload.actionNotes},
      ${payload.actionStatus}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_ENFORCEMENT_CREATED",
    actionDescription: `Enforcement action ${publicId} created for ${station.name}.`,
    affectedEntity: publicId,
  })
  return {
    enforcementPublicId: publicId,
    stationPublicId: station.public_id,
    actionStatus: payload.actionStatus,
  }
}

export async function getStationEnforcementHistory(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const rows = await prisma.$queryRaw`
    SELECT
      ea.public_id,
      ea.action_type,
      ea.action_notes,
      ea.action_status,
      ea.issued_at,
      ea.resolved_at,
      mu.public_id AS actor_public_id,
      mu.full_name AS actor_name,
      cf.public_id AS flag_public_id,
      cf.flag_type AS flag_type,
      cf.severity AS flag_severity,
      cf.generated_reason AS flag_reason,
      cf.source_reference AS flag_source_reference,
      cf.resolved_status AS flag_status
    FROM enforcement_actions ea
    INNER JOIN mera_users mu ON mu.id = ea.initiated_by
    LEFT JOIN compliance_flags cf ON cf.id = ea.related_flag_id
    WHERE ea.station_id = ${station.id}
    ORDER BY ea.issued_at DESC
  `
  return {
    station: {
      publicId: station.public_id,
      name: station.name,
    },
    items: rows || [],
  }
}

export async function listEnforcementActions(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      ea.public_id,
      ea.action_type,
      ea.action_notes,
      ea.action_status,
      ea.issued_at,
      ea.resolved_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS actor_public_id,
      mu.full_name AS actor_name,
      cf.public_id AS flag_public_id
    FROM enforcement_actions ea
    INNER JOIN stations s ON s.id = ea.station_id
    INNER JOIN mera_users mu ON mu.id = ea.initiated_by
    LEFT JOIN compliance_flags cf ON cf.id = ea.related_flag_id
    WHERE (${statusFilter === ""} = TRUE OR ea.action_status = ${statusFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY ea.issued_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      actionType: row.action_type,
      actionNotes: row.action_notes || null,
      actionStatus: row.action_status,
      issuedAt: row.issued_at,
      resolvedAt: row.resolved_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      actor: {
        publicId: row.actor_public_id,
        fullName: row.actor_name,
      },
      relatedFlagPublicId: row.flag_public_id || null,
      relatedFlag: row.flag_public_id
        ? {
            publicId: row.flag_public_id,
            flagType: row.flag_type,
            severity: row.flag_severity,
            generatedReason: row.flag_reason,
            sourceReference: row.flag_source_reference,
            resolvedStatus: row.flag_status,
          }
        : null,
    })),
  }
}

export async function attachLicense(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_station_licenses (
      station_id,
      license_number,
      issue_date,
      expiry_date,
      license_status,
      compliance_conditions
    )
    VALUES (
      ${station.id},
      ${payload.licenseNumber},
      ${payload.issueDate},
      ${payload.expiryDate},
      ${payload.licenseStatus},
      ${payload.complianceConditions}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_LICENSE_ATTACHED",
    actionDescription: `License ${payload.licenseNumber} attached to ${station.name}.`,
    affectedEntity: payload.licenseNumber,
  })
  return {
    stationPublicId: station.public_id,
    licenseNumber: payload.licenseNumber,
    licenseStatus: payload.licenseStatus,
  }
}

export async function updateLicense({ licenseId, payload, actor }) {
  const licenseRows = await prisma.$queryRaw`
    SELECT COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE fsl.id = ${toInteger(licenseId)}
    LIMIT 1
  `
  ensureDistrictAccess(actor, licenseRows?.[0]?.district, "license")
  await prisma.$executeRaw`
    UPDATE fuel_station_licenses
    SET
      issue_date = ${payload.issueDate},
      expiry_date = ${payload.expiryDate},
      license_status = ${payload.licenseStatus},
      compliance_conditions = ${payload.complianceConditions},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${toInteger(licenseId)}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_LICENSE_UPDATED",
    actionDescription: `License record ${licenseId} updated.`,
    affectedEntity: `LICENSE:${licenseId}`,
  })
  return {
    licenseId: toInteger(licenseId),
    ...payload,
  }
}

export async function getLicenseExpiryAlerts({ days = 60 } = {}, auth = null) {
  const scopedDays = clamp(toInteger(days, 60), 1, 365)
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.license_number,
      fsl.issue_date,
      fsl.expiry_date,
      fsl.license_status,
      s.public_id AS station_public_id,
      s.name AS station_name
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE fsl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ${scopedDays} DAY)
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fsl.expiry_date ASC
  `
  return rows || []
}

export async function listLicenseRegistry(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.license_number,
      fsl.issue_date,
      fsl.expiry_date,
      fsl.license_status,
      fsl.compliance_conditions,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      s.operator_name
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE (${statusFilter === ""} = TRUE OR fsl.license_status = ${statusFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fsl.expiry_date ASC, s.name ASC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      id: Number(row.id),
      licenseNumber: row.license_number,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      licenseStatus: row.license_status,
      complianceConditions: row.compliance_conditions || null,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
        operatorName: row.operator_name || null,
      },
    })),
  }
}

export async function createStationStatusLog(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO station_status_logs (
      station_id,
      reported_source,
      availability_status,
      diesel_status,
      petrol_status,
      updated_by
    )
    VALUES (
      ${station.id},
      ${payload.reportedSource},
      ${payload.availabilityStatus},
      ${payload.dieselStatus},
      ${payload.petrolStatus},
      ${actor?.userId || null}
    )
  `
  await syncAvailabilityAuditRecord({
    stationId: Number(station.id),
    petrolAvailable: ["AVAILABLE", "LIMITED"].includes(String(payload.petrolStatus || "").toUpperCase()) ? 1 : 0,
    dieselAvailable: ["AVAILABLE", "LIMITED"].includes(String(payload.dieselStatus || "").toUpperCase()) ? 1 : 0,
    activePumps: null,
    reportedBy: actor?.role ? `${actor.role}:${actor.userId || "SYSTEM"}` : payload.reportedSource,
  })
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_STATION_STATUS_LOG_CREATED",
    actionDescription: `Station status log created for ${station.name}.`,
    affectedEntity: station.public_id,
  })
  return {
    stationPublicId: station.public_id,
    availabilityStatus: payload.availabilityStatus,
  }
}

export async function createAvailabilityReport(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  const petrolAvailable = payload.petrolAvailable ? 1 : 0
  const dieselAvailable = payload.dieselAvailable ? 1 : 0
  const activePumps = payload.activePumps ?? null
  const overallAvailability =
    petrolAvailable === 0 && dieselAvailable === 0
      ? "DRY"
      : petrolAvailable === 1 && dieselAvailable === 1
        ? "AVAILABLE"
        : "LIMITED"

  await prisma.$executeRaw`
    INSERT INTO station_status_logs (
      station_id,
      reported_source,
      availability_status,
      diesel_status,
      petrol_status,
      updated_by
    )
    VALUES (
      ${station.id},
      'MERA_INSPECTION',
      ${overallAvailability},
      ${dieselAvailable ? "AVAILABLE" : "DRY"},
      ${petrolAvailable ? "AVAILABLE" : "DRY"},
      ${actor?.userId || null}
    )
  `

  await syncAvailabilityAuditRecord({
    stationId: Number(station.id),
    petrolAvailable,
    dieselAvailable,
    activePumps,
    reportedBy: payload.reportedBy || `${actor?.role || "SYSTEM"}:${actor?.userId || "NA"}`,
  })

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_AVAILABILITY_REPORT_CREATED",
    actionDescription: `Availability report recorded for ${station.name}.`,
    affectedEntity: station.public_id,
  })

  return {
    stationPublicId: station.public_id,
    petrolAvailable: Boolean(petrolAvailable),
    dieselAvailable: Boolean(dieselAvailable),
    activePumps,
    availabilityStatus: overallAvailability,
  }
}

export async function listAvailabilityReports(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      sar.id,
      sar.petrol_available,
      sar.diesel_available,
      sar.active_pumps,
      sar.reported_by,
      sar.created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      (
        SELECT COUNT(*)
        FROM public_complaints pc
        WHERE pc.station_id = sar.station_id
          AND pc.created_at BETWEEN DATE_SUB(sar.created_at, INTERVAL 12 HOUR) AND DATE_ADD(sar.created_at, INTERVAL 12 HOUR)
          AND pc.complaint_type IN ('REFUSAL_TO_SELL', 'HOARDING')
      ) AS mismatch_total
    FROM station_availability_reports sar
    INNER JOIN stations s ON s.id = sar.station_id
    WHERE (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.station || "").trim() === ""} = TRUE OR s.name LIKE ${stationFilter} OR s.public_id LIKE ${stationFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY sar.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      recordId: `SAR-${row.id}`,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.district,
      },
      petrolAvailable: Number(row.petrol_available) === 1,
      dieselAvailable: Number(row.diesel_available) === 1,
      activePumps: row.active_pumps,
      reportedBy: row.reported_by,
      createdAt: row.created_at,
      mismatchIndicator: Number(row.mismatch_total || 0) > 0 ? "CONFLICT" : "CLEAR",
      mismatchTotal: Number(row.mismatch_total || 0),
    })),
  }
}

export async function createFuelDeliveryLog(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_delivery_logs (
      station_id,
      delivery_time,
      fuel_type,
      estimated_volume,
      source_type,
      reported_by
    )
    VALUES (
      ${station.id},
      ${payload.deliveryTime},
      ${payload.fuelType},
      ${payload.estimatedVolume},
      ${payload.sourceType},
      ${payload.reportedBy || `${actor?.role || "SYSTEM"}:${actor?.userId || "NA"}`}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FUEL_DELIVERY_LOG_CREATED",
    actionDescription: `Fuel delivery log created for ${station.name}.`,
    affectedEntity: station.public_id,
  })

  return {
    stationPublicId: station.public_id,
    fuelType: payload.fuelType,
    deliveryTime: payload.deliveryTime,
    estimatedVolume: payload.estimatedVolume,
  }
}

export async function listFuelDeliveryLogs(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      fdl.id,
      fdl.delivery_time,
      fdl.fuel_type,
      fdl.estimated_volume,
      fdl.source_type,
      fdl.reported_by,
      fdl.created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM fuel_delivery_logs fdl
    INNER JOIN stations s ON s.id = fdl.station_id
    WHERE (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.station || "").trim() === ""} = TRUE OR s.name LIKE ${stationFilter} OR s.public_id LIKE ${stationFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fdl.delivery_time DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      id: row.id,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.district,
      },
      fuelType: row.fuel_type,
      deliveryTime: row.delivery_time,
      estimatedVolume: row.estimated_volume,
      sourceType: row.source_type,
      reportedBy: row.reported_by,
      verificationStatus: "PENDING_REVIEW",
      createdAt: row.created_at,
    })),
  }
}

export async function createFuelPriceReport(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by)
    VALUES (${station.id}, ${payload.petrolPrice}, ${payload.dieselPrice}, ${actor?.userId || null})
  `
  await flagFuelPriceReportAnomalies({ station, payload, actor })
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FUEL_PRICE_REPORT_CREATED",
    actionDescription: `Fuel price report recorded for ${station.name}.`,
    affectedEntity: station.public_id,
  })
  return {
    stationPublicId: station.public_id,
    petrolPrice: payload.petrolPrice,
    dieselPrice: payload.dieselPrice,
  }
}

function priceAnomalyForProduct({ fuelType, officialPrice, reportedPrice }) {
  const official = Number(officialPrice || 0)
  const reported = Number(reportedPrice || 0)
  if (!official || !reported) return null
  const mismatchAmount = reported - official
  const mismatchPercent = mismatchAmount / official
  const isHigh = mismatchAmount > 0
  const tolerance = isHigh ? 0 : Math.max(50, official * 0.02)
  if (Math.abs(mismatchAmount) <= tolerance) return null

  const absPercent = Math.abs(mismatchPercent)
  let severity = "LOW"
  if (isHigh && absPercent >= 0.08) severity = "CRITICAL"
  else if (isHigh && absPercent >= 0.04) severity = "HIGH"

  return {
    fuelType,
    official,
    reported,
    mismatchAmount,
    direction: isHigh ? "ABOVE_OFFICIAL" : "BELOW_OFFICIAL",
    severity,
  }
}

async function flagFuelPriceReportAnomalies({ station, payload, actor }) {
  const officialRows = await prisma.$queryRaw`
    SELECT fuel_type, price_per_litre
    FROM mera_official_prices mop
    WHERE mop.status = 'active'
      AND mop.id = (
        SELECT latest.id
        FROM mera_official_prices latest
        WHERE UPPER(latest.fuel_type) = UPPER(mop.fuel_type)
          AND latest.status = 'active'
          AND latest.effective_date <= CURRENT_DATE()
        ORDER BY latest.effective_date DESC, latest.created_at DESC
        LIMIT 1
      )
  `
  const official = new Map((officialRows || []).map((row) => [String(row.fuel_type || "").trim().toUpperCase(), Number(row.price_per_litre || 0)]))
  const anomalies = [
    priceAnomalyForProduct({ fuelType: "PETROL", officialPrice: official.get("PETROL"), reportedPrice: payload.petrolPrice }),
    priceAnomalyForProduct({ fuelType: "DIESEL", officialPrice: official.get("DIESEL"), reportedPrice: payload.dieselPrice }),
  ].filter(Boolean)

  await Promise.all(anomalies.map((item) => createComplianceFlagRecord({
    stationId: station.id,
    flagType: "PRICE_ANOMALY",
    severity: item.severity,
    generatedReason: `${item.fuelType} price ${item.direction === "ABOVE_OFFICIAL" ? "above" : "below"} official MERA price at ${station.name}: reported MWK ${item.reported.toFixed(2)} versus official MWK ${item.official.toFixed(2)} (${item.mismatchAmount > 0 ? "+" : ""}${item.mismatchAmount.toFixed(2)}).`,
    sourceReference: `PRICE_REPORT:${item.fuelType}:${item.direction}`,
    actor,
  })))
}

export async function getDashboardOverview(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [stationsRows, inventoryRows, currentStatusRows, complaintsRows, flagsRows, actionsRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalStations,
        SUM(CASE WHEN fuel_level = 'LOW' THEN 1 ELSE 0 END) AS lowStockStations,
        SUM(CASE WHEN fuel_level = 'MEDIUM' THEN 1 ELSE 0 END) AS mediumStockStations,
        SUM(CASE WHEN fuel_level = 'HIGH' THEN 1 ELSE 0 END) AS highStockStations
      FROM stations
      WHERE is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR city = ${scopedDistrict})
    `,
    getLatestInventoryByStationRows(),
    prisma.$queryRaw`
      SELECT
        scs.station_id,
        scs.availability_status,
        scs.petrol_status,
        scs.diesel_status
      FROM station_current_status scs
      INNER JOIN stations s ON s.id = scs.station_id
      WHERE s.is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR EXISTS (
          SELECT 1
          FROM stations scoped_station
          WHERE scoped_station.id = scs.station_id
            AND scoped_station.city = ${scopedDistrict}
        ))
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalComplaints,
        SUM(CASE WHEN complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION') THEN 1 ELSE 0 END) AS openComplaints
      FROM public_complaints
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
      ))
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalFlags,
        SUM(CASE WHEN resolved_status IN ('OPEN', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS openFlags
      FROM compliance_flags
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = compliance_flags.station_id AND s.city = ${scopedDistrict}
      ))
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalActions,
        SUM(CASE WHEN action_status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED') THEN 1 ELSE 0 END) AS activeActions
      FROM enforcement_actions
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = enforcement_actions.station_id AND s.city = ${scopedDistrict}
      ))
    `,
  ])

  const inventorySummaryRows = normalizeRows(inventoryRows).filter((row) => (
    scopedDistrict === "" || String(row?.district || "").toLowerCase() === scopedDistrict.toLowerCase()
  ))
  const stationsTotal = Number(stationsRows?.[0]?.totalStations || 0)
  const inventorySnapshot = buildInventorySnapshot(inventorySummaryRows)
  const currentStatuses = normalizeRows(currentStatusRows)
  const fuelAvailabilityBuckets = {
    PETROL: new Set(),
    DIESEL: new Set(),
    KEROSENE: new Set(),
  }

  let outOfStockStations = 0
  let partialOutageStations = 0
  let liveLowStockStations = 0

  if (currentStatuses.length) {
    currentStatuses.forEach((row) => {
      const stationId = Number(row.station_id)
      const availability = normalizeStationState(row.availability_status)
      const petrol = normalizeStationState(row.petrol_status)
      const diesel = normalizeStationState(row.diesel_status)
      if (["AVAILABLE", "LIMITED"].includes(petrol)) fuelAvailabilityBuckets.PETROL.add(stationId)
      if (["AVAILABLE", "LIMITED"].includes(diesel)) fuelAvailabilityBuckets.DIESEL.add(stationId)
      if (availability === "DRY") outOfStockStations += 1
      if (availability === "LIMITED") liveLowStockStations += 1
      if ([petrol, diesel].includes("DRY") && [petrol, diesel].some((status) => ["AVAILABLE", "LIMITED"].includes(status))) {
        partialOutageStations += 1
      }
    })
  } else {
    inventorySnapshot.stations.forEach((station) => {
      const nextStatus = deriveStationStatusFromInventory(station)
      Object.entries(fuelAvailabilityBuckets).forEach(([fuelCode, bucket]) => {
        if (["AVAILABLE", "LIMITED"].includes(fuelStatusFromInventory(station, fuelCode))) {
          bucket.add(station.stationId)
        }
      })
      if (nextStatus.availabilityStatus === "DRY") outOfStockStations += 1
      if (nextStatus.availabilityStatus === "LIMITED") liveLowStockStations += 1
      if (station.partialOutage) partialOutageStations += 1
    })
  }

  const fuelAvailabilityByType = [
    { label: "Petrol", code: "PETROL", value: fuelAvailabilityBuckets.PETROL.size, total: stationsTotal },
    { label: "Diesel", code: "DIESEL", value: fuelAvailabilityBuckets.DIESEL.size, total: stationsTotal },
    { label: "Kerosene", code: "KEROSENE", value: fuelAvailabilityBuckets.KEROSENE.size, total: stationsTotal },
    { label: "Out of Stock", code: "OUT_OF_STOCK", value: outOfStockStations, total: stationsTotal },
  ]

  return {
    totalStations: stationsTotal,
    lowStockStations: liveLowStockStations,
    mediumStockStations: Number(stationsRows?.[0]?.mediumStockStations || 0),
    highStockStations: Number(stationsRows?.[0]?.highStockStations || 0),
    outOfStockStations,
    partialOutageStations,
    fuelAvailabilityByType,
    totalComplaints: Number(complaintsRows?.[0]?.totalComplaints || 0),
    openComplaints: Number(complaintsRows?.[0]?.openComplaints || 0),
    totalFlags: Number(flagsRows?.[0]?.totalFlags || 0),
    openFlags: Number(flagsRows?.[0]?.openFlags || 0),
    totalEnforcementActions: Number(actionsRows?.[0]?.totalActions || 0),
    activeEnforcementActions: Number(actionsRows?.[0]?.activeActions || 0),
  }
}

export async function getMeraOpsPredictions(auth = null, options = {}) {
  const scopedDistrict = districtFilterValue(auth)
  const limit = normalizeOpsLimit(options?.limit, 6)
  const requestedFuelType = normalizeOpsFuelType(options?.fuelType)
  const rows = await prisma.$queryRaw`
    SELECT
      s.id,
      s.public_id,
      s.name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      s.city,
      s.timezone,
      s.fuel_level,
      s.availability_status,
      COALESCE(scs.petrol_status, status_log.petrol_status, 'UNKNOWN') AS petrol_status,
      COALESCE(scs.diesel_status, status_log.diesel_status, 'UNKNOWN') AS diesel_status,
      COALESCE(active_queue.active_count, 0) AS active_queue_count
    FROM stations s
    LEFT JOIN station_current_status scs ON scs.station_id = s.id
    LEFT JOIN station_status_logs status_log
      ON status_log.id = (
        SELECT latest_status_log.id
        FROM station_status_logs latest_status_log
        WHERE latest_status_log.station_id = s.id
        ORDER BY latest_status_log.created_at DESC
        LIMIT 1
      )
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS active_count
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY station_id
    ) active_queue ON active_queue.station_id = s.id
    WHERE s.is_active = 1
      AND s.deleted_at IS NULL
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY
      active_queue_count DESC,
      FIELD(UPPER(COALESCE(scs.availability_status, s.availability_status, 'UNKNOWN')), 'DRY', 'OUT_OF_STOCK', 'LIMITED', 'LOW', 'UNKNOWN', 'AVAILABLE') ASC,
      s.name ASC
    LIMIT ${limit}
  `

  const stationRows = normalizeRows(rows)
  const settled = await Promise.all(
    stationRows.map(async (row) => {
      const fuelType = pickMeraOpsFuelType(row, requestedFuelType)
      try {
        const data = await getSmartlinkOpsPrediction({
          station: {
            id: Number(row.id),
            public_id: row.public_id,
            name: row.name,
            city: row.city || row.district,
            timezone: row.timezone || "Africa/Blantyre",
          },
          fuelType,
        })

        return {
          stationPublicId: data.stationPublicId || row.public_id,
          stationName: row.name || "Unknown station",
          district: row.district || row.city || "Unknown",
          fuelType: data.fuelType || fuelType,
          generatedAt: data.generatedAt,
          inputSummary: {
            currentQueueLength: data.featurePayload?.current_queue_length ?? null,
            activePumps: data.featurePayload?.active_pumps ?? null,
            activeNozzles: data.featurePayload?.active_nozzles ?? null,
            stockLitres: data.featurePayload?.stock_litres ?? null,
            nearbyShortageIndex: data.featurePayload?.nearby_shortage_index ?? null,
          },
          prediction: data.prediction,
        }
      } catch (error) {
        return {
          error: {
            stationPublicId: row.public_id,
            stationName: row.name || "Unknown station",
            district: row.district || row.city || "Unknown",
            fuelType,
            message: error?.message || "ML prediction unavailable",
          },
        }
      }
    })
  )

  const items = settled.filter((item) => item && !item.error)
  const errors = settled.filter((item) => item?.error).map((item) => item.error)

  return {
    generatedAt: new Date().toISOString(),
    modelAvailable: items.length > 0,
    items,
    errors,
  }
}

export async function getDemandForecastSummary(auth = null) {
  const [overview, inventoryRows, districtShortagesRows, transactionRows, queueRows, complaintRows, deliveryRows, flagRows, opsPredictions] = await Promise.all([
    getDashboardOverview(auth),
    getLatestInventoryByStationRows(),
    getDistrictShortageSummaries(auth),
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        HOUR(tx.occurred_at) AS hour_bucket,
        SUM(tx.litres) AS litres
      FROM transactions tx
      INNER JOIN stations s ON s.id = tx.station_id
      WHERE tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown'), HOUR(tx.occurred_at)
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS active_queue_count,
        AVG(TIMESTAMPDIFF(MINUTE, qe.joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait_minutes
      FROM queue_entries qe
      INNER JOIN stations s ON s.id = qe.station_id
      WHERE qe.status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS open_complaints
      FROM public_complaints pc
      INNER JOIN stations s ON s.id = pc.station_id
      WHERE pc.complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        MAX(fd.delivered_time) AS last_delivery_time,
        SUM(CASE WHEN fd.delivered_time >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 48 HOUR) THEN COALESCE(fd.litres, 0) ELSE 0 END) AS recent_delivery_litres
      FROM fuel_deliveries fd
      INNER JOIN stations s ON s.id = fd.station_id
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS active_flags
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    getMeraOpsPredictions(auth, { limit: 6 }).catch((error) => ({
      generatedAt: new Date().toISOString(),
      modelAvailable: false,
      items: [],
      errors: [{ message: error?.message || "ML predictions unavailable" }],
    })),
  ])

  const inventorySnapshot = buildInventorySnapshot(inventoryRows)
  const shortageMap = new Map(normalizeRows(districtShortagesRows).map((row) => [String(row.district || 'Unknown'), row]))
  const queueMap = new Map(normalizeRows(queueRows).map((row) => [String(row.district || 'Unknown'), row]))
  const complaintMap = new Map(normalizeRows(complaintRows).map((row) => [String(row.district || 'Unknown'), row]))
  const deliveryMap = new Map(normalizeRows(deliveryRows).map((row) => [String(row.district || 'Unknown'), row]))
  const flagMap = new Map(normalizeRows(flagRows).map((row) => [String(row.district || 'Unknown'), row]))

  const hourlyByDistrict = new Map()
  for (const row of normalizeRows(transactionRows)) {
    const district = String(row.district || 'Unknown')
    const hour = Number(row.hour_bucket || 0)
    const litres = Number(row.litres || 0)
    if (!hourlyByDistrict.has(district)) hourlyByDistrict.set(district, new Map())
    const districtHours = hourlyByDistrict.get(district)
    districtHours.set(hour, [...(districtHours.get(hour) || []), litres])
  }

  const districtStations = new Map()
  inventorySnapshot.stations.forEach((station) => {
    const district = String(station.district || 'Unknown')
    if (!districtStations.has(district)) districtStations.set(district, [])
    districtStations.get(district).push(station)
  })

  const now = new Date()
  const forecastRows = Array.from(districtStations.entries()).map(([district, stations]) => {
    const shortage = shortageMap.get(district) || {}
    const queue = queueMap.get(district) || {}
    const complaints = complaintMap.get(district) || {}
    const deliveries = deliveryMap.get(district) || {}
    const flags = flagMap.get(district) || {}
    const hourMap = hourlyByDistrict.get(district) || new Map()

    const projectedDemandLitres = Array.from({ length: 6 }).reduce((sum, _value, index) => {
      const hour = new Date(now.getTime() + (index + 1) * 60 * 60 * 1000).getHours()
      const samples = hourMap.get(hour) || []
      if (!samples.length) return sum
      return sum + samples.reduce((acc, sample) => acc + sample, 0) / samples.length
    }, 0)

    const inventoryLitres = stations.reduce((sum, station) => sum + Number(station.totalRemainingLitres || 0), 0)
    const outOfStockCount = stations.filter((station) => station.outOfStock).length
    const partialCount = stations.filter((station) => station.partialOutage).length
    const totalStations = Number(shortage.total_stations || stations.length || 0)
    const shortageStations = Number(shortage.shortage_stations || 0)
    const avgWaitMinutes = Math.round(Number(queue.avg_wait_minutes || 0))
    const openComplaints = Number(complaints.open_complaints || 0)
    const activeFlags = Number(flags.active_flags || 0)
    const recentDeliveries = Number(deliveries.recent_delivery_litres || 0)
    const coverageHours = projectedDemandLitres > 0 ? inventoryLitres / (projectedDemandLitres / 6) : null
    const shortageRatio = totalStations > 0 ? shortageStations / totalStations : 0
    const outageRatio = stations.length > 0 ? outOfStockCount / stations.length : 0
    const partialRatio = stations.length > 0 ? partialCount / stations.length : 0
    const queueFactor = clampNumber(avgWaitMinutes / 30, 0, 1)
    const complaintFactor = clampNumber(openComplaints / 6, 0, 1)
    const flagFactor = clampNumber(activeFlags / 4, 0, 1)
    const deliveryReliefFactor = recentDeliveries > 0 ? 0.12 : 0
    const coverageRisk = coverageHours === null ? 0.5 : clampNumber((12 - coverageHours) / 12, 0, 1)

    const pressureScore = Math.round(
      (
        shortageRatio * 0.28 +
        outageRatio * 0.26 +
        partialRatio * 0.12 +
        queueFactor * 0.12 +
        complaintFactor * 0.08 +
        flagFactor * 0.08 +
        coverageRisk * 0.18 -
        deliveryReliefFactor
      ) * 100
    )

    const outlook =
      pressureScore >= 75 ? 'Critical' : pressureScore >= 55 ? 'Elevated' : pressureScore >= 35 ? 'Watch' : 'Stable'

    const recommendation =
      pressureScore >= 75
        ? 'Pre-position supply and escalate field oversight immediately.'
        : pressureScore >= 55
          ? 'Coordinate deliveries and monitor queue growth closely.'
          : pressureScore >= 35
            ? 'Maintain observation and verify next delivery timing.'
            : 'Demand posture remains stable.'

    return {
      district,
      totalStations,
      shortageStations,
      outOfStockStations: outOfStockCount,
      partialOutageStations: partialCount,
      projectedDemandLitres: Math.round(projectedDemandLitres),
      inventoryLitres: Math.round(inventoryLitres),
      coverageHours: coverageHours === null ? null : Math.round(coverageHours * 10) / 10,
      avgWaitMinutes,
      openComplaints,
      activeFlags,
      pressureScore: clampNumber(pressureScore, 0, 100),
      outlook,
      recommendation,
      nextDelivery: deliveries.last_delivery_time || null,
    }
  }).sort((a, b) => b.pressureScore - a.pressureScore)

  const nationalSignal = forecastRows.length
    ? Math.round(forecastRows.reduce((sum, row) => sum + row.pressureScore, 0) / forecastRows.length)
    : 0

  const summary = {
    nationalSignal,
    criticalDistricts: forecastRows.filter((row) => row.outlook === 'Critical').length,
    elevatedDistricts: forecastRows.filter((row) => row.outlook === 'Elevated').length,
    constrainedStations: forecastRows.reduce((sum, row) => sum + row.outOfStockStations + row.partialOutageStations, 0),
    totalProjectedDemandLitres: forecastRows.reduce((sum, row) => sum + row.projectedDemandLitres, 0),
    explanation:
      "Forecast scores blend live shortages, full and partial outages, projected hourly demand, queue waits, open complaints, active flags, and recent delivery relief.",
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    rows: forecastRows,
    opsPredictions,
  }
}

function normalizeRows(items) {
  return Array.isArray(items) ? items : []
}

const OUT_OF_STOCK_STATES = new Set(["DRY", "OUT_OF_STOCK"])

function normalizeStationState(value) {
  return String(value || "").trim().toUpperCase()
}

function isOutOfStockHeatmapRow(row) {
  const availability = normalizeStationState(row?.availability_status)
  const petrol = normalizeStationState(row?.petrol_status)
  const diesel = normalizeStationState(row?.diesel_status)

  if (OUT_OF_STOCK_STATES.has(availability)) return true
  return OUT_OF_STOCK_STATES.has(petrol) && OUT_OF_STOCK_STATES.has(diesel)
}

function isLiveReportingHeatmapRow(row) {
  return !["", "UNKNOWN", "OFFLINE"].includes(normalizeStationState(row?.availability_status))
}

function heatmapSeverity(row) {
  const availability = normalizeStationState(row?.availability_status)
  const petrol = normalizeStationState(row?.petrol_status)
  const diesel = normalizeStationState(row?.diesel_status)

  if (availability === "DRY" || availability === "OUT_OF_STOCK") {
    return { level: "critical", score: 95 }
  }
  if (petrol === "DRY" && diesel === "DRY") {
    return { level: "critical", score: 90 }
  }
  if (availability === "LIMITED") {
    return { level: "high", score: 70 }
  }
  if (petrol === "LOW" || diesel === "LOW" || petrol === "DRY" || diesel === "DRY") {
    return { level: "low", score: 48 }
  }
  if (availability === "UNKNOWN" || availability === "OFFLINE" || availability === "") {
    return { level: "no_data", score: 12 }
  }
  return { level: "normal", score: 18 }
}

function normalizeDashboardNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildSparkline(seed, current, previous = current, length = 18) {
  const normalizedCurrent = Math.max(0, normalizeDashboardNumber(current, 0))
  const normalizedPrevious = Math.max(0, normalizeDashboardNumber(previous, normalizedCurrent))
  const baseline = Math.max(normalizedCurrent, normalizedPrevious, 1)
  const swing = Math.abs(normalizedCurrent - normalizedPrevious)

  return Array.from({ length }, (_value, index) => {
    const progress = index / Math.max(1, length - 1)
    const wave = Math.sin((index + 1) * 0.82 + seed) * Math.max(baseline * 0.055, swing * 0.18, 1)
    const value = normalizedPrevious + (normalizedCurrent - normalizedPrevious) * progress + wave
    if (index === length - 1) return Math.max(0, Math.round(normalizedCurrent))
    return Math.max(0, Math.round(value))
  })
}

function trendDirection(current, previous) {
  const currentValue = normalizeDashboardNumber(current, 0)
  const previousValue = normalizeDashboardNumber(previous, currentValue)
  if (currentValue > previousValue) return "up"
  if (currentValue < previousValue) return "down"
  return "flat"
}

function normalizeTrendRows(rows, valueKey, labelKey = "label") {
  return normalizeRows(rows).map((row) => ({
    label: String(row?.[labelKey] || ""),
    value: normalizeDashboardNumber(row?.[valueKey], 0),
  }))
}

const AVAILABILITY_INTERVALS = {
  "15m": { minutes: 15, bucketMinutes: 1 },
  "1h": { minutes: 60, bucketMinutes: 5 },
  "6h": { minutes: 360, bucketMinutes: 30 },
  "24h": { minutes: 1440, bucketMinutes: 120 },
  "7d": { minutes: 10080, bucketMinutes: 1440 },
  "today": { bucketMinutes: 30 },
}
// MySQL returns CAT-local dashboard timestamps to Prisma as UTC Date objects.
// Formatting them in UTC preserves the actual local clock shown by the database.
const MERA_DASHBOARD_TIME_ZONE = "UTC"

function normalizeAvailabilityInterval(value) {
  const normalized = String(value || "1h").trim().toLowerCase()
  return AVAILABILITY_INTERVALS[normalized] ? normalized : "1h"
}

function getZonedDateParts(date, timeZone = MERA_DASHBOARD_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const hour = Number(mapped.hour || 0)

  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(mapped.minute || 0),
    second: Number(mapped.second || 0),
  }
}

function getTimeZoneOffsetMs(date, timeZone = MERA_DASHBOARD_TIME_ZONE) {
  const parts = getZonedDateParts(date, timeZone)
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return zonedAsUtc - date.getTime()
}

function startOfDayInDashboardTimeZone(date, timeZone = MERA_DASHBOARD_TIME_ZONE) {
  const parts = getZonedDateParts(date, timeZone)
  const zonedMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
  const offset = getTimeZoneOffsetMs(new Date(zonedMidnightAsUtc), timeZone)
  return new Date(zonedMidnightAsUtc - offset)
}

function getAvailabilityIntervalConfig(interval, now) {
  const config = AVAILABILITY_INTERVALS[interval] || AVAILABILITY_INTERVALS["1h"]
  if (interval === "today") {
    const start = startOfDayInDashboardTimeZone(now)
    const minutes = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 60000))
    return { ...config, minutes, start }
  }

  return {
    ...config,
    start: new Date(now.getTime() - config.minutes * 60 * 1000),
  }
}

function isFuelAvailableState(row) {
  const availability = normalizeStationState(row?.availability_status)
  const petrol = normalizeStationState(row?.petrol_status)
  const diesel = normalizeStationState(row?.diesel_status)
  return (
    ["AVAILABLE", "LIMITED"].includes(availability) ||
    ["AVAILABLE", "LIMITED"].includes(petrol) ||
    ["AVAILABLE", "LIMITED"].includes(diesel)
  )
}

function formatAvailabilityBucketLabel(date, interval) {
  if (interval === "7d") {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: MERA_DASHBOARD_TIME_ZONE })
  }
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: MERA_DASHBOARD_TIME_ZONE })
}

function floorDateToBucket(date, bucketMs) {
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs)
}

function buildAvailabilityBuckets({ start, now, interval, bucketMinutes }) {
  const bucketMs = bucketMinutes * 60 * 1000
  const buckets = []
  let bucketTime = floorDateToBucket(start, bucketMs)
  const endTime = floorDateToBucket(now, bucketMs)

  while (bucketTime.getTime() <= endTime.getTime() && buckets.length < 500) {
    buckets.push(bucketTime)
    bucketTime = new Date(bucketTime.getTime() + bucketMs)
  }

  if (!buckets.length) {
    buckets.push(endTime)
  }
  if (now.getTime() - buckets[buckets.length - 1].getTime() > Math.min(60000, bucketMs / 4)) {
    buckets.push(now)
  }

  return buckets.map((bucketDate) => ({
    timestamp: bucketDate.toISOString(),
    label: formatAvailabilityBucketLabel(bucketDate, interval),
    bucketTime: bucketDate,
    stationsWithFuel: 0,
    totalStations: 0,
  }))
}

async function getRollupFuelAvailabilityHistory({ auth = null, interval, config, now, start, buckets }) {
  const scopedDistrict = districtFilterValue(auth)
  const districtKey = scopedDistrict || "__NATIONAL__"
  const rollupLookbackStart = new Date(start.getTime() - config.bucketMinutes * 2 * 60 * 1000)
  const rows = await prisma.$queryRaw`
    SELECT
      bucket_start,
      stations_with_fuel,
      delivery_verified_stations_with_fuel,
      total_stations
    FROM station_status_rollups
    WHERE bucket_minutes = ${config.bucketMinutes}
      AND district_key = ${districtKey}
      AND bucket_start >= ${rollupLookbackStart}
      AND bucket_start <= ${now}
    ORDER BY bucket_start ASC
  `
  const rollups = normalizeRows(rows)
  if (!rollups.length) return null
  const firstBucketTime = buckets[0]?.bucketTime?.getTime?.()
  const hasBaselineRollup = Number.isFinite(firstBucketTime)
    ? rollups.some((row) => new Date(row.bucket_start).getTime() <= firstBucketTime)
    : true
  if (!hasBaselineRollup) return null

  let rollupIndex = 0
  let currentRollup = null

  return {
    interval,
    generatedAt: now.toISOString(),
    source: "rollup",
    points: buckets.map((bucket) => {
      while (
        rollupIndex < rollups.length &&
        new Date(rollups[rollupIndex].bucket_start).getTime() <= bucket.bucketTime.getTime()
      ) {
        currentRollup = rollups[rollupIndex]
        rollupIndex += 1
      }

      return {
        timestamp: bucket.timestamp,
        label: bucket.label,
        stationsWithFuel: normalizeDashboardNumber(currentRollup?.stations_with_fuel, 0),
        deliveryVerifiedStationsWithFuel: normalizeDashboardNumber(currentRollup?.delivery_verified_stations_with_fuel, 0),
        totalStations: normalizeDashboardNumber(currentRollup?.total_stations, 0),
      }
    }),
  }
}

async function getFuelAvailabilityHistory(auth = null, intervalValue = "1h") {
  const interval = normalizeAvailabilityInterval(intervalValue)
  const scopedDistrict = districtFilterValue(auth)
  const databaseClockRows = await prisma.$queryRaw`
    SELECT CURRENT_TIMESTAMP(3) AS database_now
  `
  const now = databaseClockRows?.[0]?.database_now ? new Date(databaseClockRows[0].database_now) : new Date()
  const config = getAvailabilityIntervalConfig(interval, now)
  const start = config.start
  const buckets = buildAvailabilityBuckets({ start, now, interval, bucketMinutes: config.bucketMinutes })

  const rollupHistory = await getRollupFuelAvailabilityHistory({ auth, interval, config, now, start, buckets })
  if (rollupHistory) return rollupHistory

  const [stationRows, initialStatusRows, statusRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        s.id,
        s.created_at,
        COALESCE(scs.delivery_verified, 0) AS delivery_verified
      FROM stations s
      LEFT JOIN station_current_status scs ON scs.station_id = s.id
      WHERE s.is_active = 1
        AND s.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY s.id ASC
    `,
    prisma.$queryRaw`
      SELECT
        status_log.station_id,
        status_log.availability_status,
        status_log.petrol_status,
        status_log.diesel_status,
        status_log.created_at
      FROM station_status_logs AS status_log
      INNER JOIN stations AS station ON station.id = status_log.station_id
      INNER JOIN (
        SELECT station_id, MAX(created_at) AS latest_created_at
        FROM station_status_logs
        WHERE created_at < ${start}
        GROUP BY station_id
      ) AS latest
        ON latest.station_id = status_log.station_id
       AND latest.latest_created_at = status_log.created_at
      WHERE station.is_active = 1
        AND station.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR station.city = ${scopedDistrict})
      ORDER BY status_log.created_at ASC
    `,
    prisma.$queryRaw`
      SELECT
        status_log.station_id,
        status_log.availability_status,
        status_log.petrol_status,
        status_log.diesel_status,
        status_log.created_at
      FROM station_status_logs AS status_log
      INNER JOIN stations AS station ON station.id = status_log.station_id
      WHERE status_log.created_at >= ${start}
        AND status_log.created_at <= ${now}
        AND station.is_active = 1
        AND station.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR station.city = ${scopedDistrict})
      ORDER BY status_log.created_at ASC
    `,
  ])

  const stations = normalizeRows(stationRows).map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at ? new Date(row.created_at) : start,
    deliveryVerified: Boolean(row.delivery_verified),
  }))
  const stationState = new Map()
  normalizeRows(initialStatusRows).forEach((row) => {
    stationState.set(Number(row.station_id), row)
  })

  const inWindowRows = normalizeRows(statusRows)
  let statusIndex = 0

  return {
    interval,
    generatedAt: now.toISOString(),
    points: buckets.map((bucket) => {
      while (
        statusIndex < inWindowRows.length &&
        new Date(inWindowRows[statusIndex].created_at).getTime() <= bucket.bucketTime.getTime()
      ) {
        stationState.set(Number(inWindowRows[statusIndex].station_id), inWindowRows[statusIndex])
        statusIndex += 1
      }

      const activeStations = stations.filter((station) => station.createdAt.getTime() <= bucket.bucketTime.getTime())
      const stationsWithFuel = activeStations.filter((station) => isFuelAvailableState(stationState.get(station.id))).length
      const deliveryVerifiedStationsWithFuel = activeStations.filter((station) => (
        station.deliveryVerified && isFuelAvailableState(stationState.get(station.id))
      )).length

      return {
        timestamp: bucket.timestamp,
        label: bucket.label,
        stationsWithFuel,
        deliveryVerifiedStationsWithFuel,
        totalStations: activeStations.length,
      }
    }),
  }
}

let dashboardMetricSnapshotTableReady = false

async function ensureDashboardMetricSnapshotTable() {
  if (dashboardMetricSnapshotTableReady) return
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS mera_dashboard_metric_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      scope_key VARCHAR(96) NOT NULL DEFAULT '__NATIONAL__',
      metric_key VARCHAR(96) NOT NULL,
      metric_value DECIMAL(18,4) NOT NULL DEFAULT 0,
      captured_date DATE NOT NULL,
      captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_mera_dashboard_metric_scope_day (scope_key, metric_key, captured_date),
      KEY idx_mera_dashboard_metric_lookup (scope_key, metric_key, captured_date)
    )
  `
  dashboardMetricSnapshotTableReady = true
}

async function recordDashboardMetricSnapshots(scopeKey, metrics = {}) {
  await ensureDashboardMetricSnapshotTable()
  const normalizedScope = String(scopeKey || "__NATIONAL__").trim() || "__NATIONAL__"
  const entries = Object.entries(metrics).filter(([key, value]) => key && Number.isFinite(Number(value)))

  for (const [metricKey, metricValue] of entries) {
    await prisma.$executeRaw`
      INSERT INTO mera_dashboard_metric_snapshots (
        scope_key,
        metric_key,
        metric_value,
        captured_date
      )
      VALUES (
        ${normalizedScope},
        ${metricKey},
        ${Number(metricValue)},
        CURRENT_DATE
      )
      ON DUPLICATE KEY UPDATE
        metric_value = VALUES(metric_value),
        updated_at = CURRENT_TIMESTAMP(3)
    `
  }

  const comparisons = {}
  for (const [metricKey, metricValue] of entries) {
    const previousRows = await prisma.$queryRaw`
      SELECT metric_value, captured_date
      FROM mera_dashboard_metric_snapshots
      WHERE scope_key = ${normalizedScope}
        AND metric_key = ${metricKey}
        AND captured_date < CURRENT_DATE
      ORDER BY captured_date DESC
      LIMIT 1
    `
    const previous = previousRows?.[0]
    const currentValue = Number(metricValue)
    const previousValue = previous ? Number(previous.metric_value || 0) : currentValue
    comparisons[metricKey] = {
      currentValue,
      previousValue,
      delta: currentValue - previousValue,
      previousDate: previous?.captured_date || null,
    }
  }

  return comparisons
}

export async function getSidebarStats(auth = null) {
  const [
    overview,
    heatmapRows,
    queueWaitRows,
    complaintsRows,
    flagsRows,
    inspectionsRows,
    enforcementRows,
  ] = await Promise.all([
    getDashboardOverview(auth),
    getShortageHeatmapData(auth),
    prisma.$queryRaw`
      SELECT AVG(TIMESTAMPDIFF(MINUTE, joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints
      WHERE complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN', 'UNDER_REVIEW')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM inspections
      WHERE inspection_status IN ('OPEN', 'ESCALATED')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM enforcement_actions
      WHERE action_status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED')
    `,
  ])

  const heatmap = Array.isArray(heatmapRows) ? heatmapRows : []
  const stationsTotal = Number(overview?.totalStations || heatmap.length || 0)
  const stationsOnline = heatmap.filter((row) => isLiveReportingHeatmapRow(row)).length
  const outOfStock = Number(overview?.outOfStockStations || 0)
  const lowStock = Number(overview?.lowStockStations || 0)
  const avgQueueWait = Math.round(Number(queueWaitRows?.[0]?.avg_wait || 0))
  const openComplaints = Number(complaintsRows?.[0]?.total || 0)
  const activeFlags = Number(flagsRows?.[0]?.total || 0)
  const activeInspections = Number(inspectionsRows?.[0]?.total || 0)
  const pendingEnforcement = Number(enforcementRows?.[0]?.total || 0)
  const shortageDistricts = new Set(
    heatmap
      .filter((row) => isOutOfStockHeatmapRow(row) || normalizeStationState(row?.availability_status) === "LIMITED")
      .map((row) => String(row?.city || 'Unknown').trim() || 'Unknown'),
  ).size

  let nationalSituation = "STABLE"
  let situationDetail = "Supply stable · national network normal"

  if (stationsTotal > 0 && outOfStock >= Math.ceil(stationsTotal * 0.35)) {
    nationalSituation = "NATIONAL_OUTAGE"
    situationDetail = `National outage · ${outOfStock} dry stations`
  } else if (shortageDistricts >= 4) {
    nationalSituation = "REGIONAL_SHORTAGE"
    situationDetail = `Regional shortage · ${shortageDistricts} districts`
  } else if (activeFlags >= 5 || pendingEnforcement >= 3) {
    nationalSituation = "PRICE_SPIKE"
    situationDetail = `Price spike watch · ${activeFlags} active flags`
  } else if (lowStock > 0 || avgQueueWait > 15 || openComplaints > 0) {
    nationalSituation = "MONITORING"
    situationDetail = `Monitoring supply · ${lowStock} low stock`
  }

  return {
    stationsOnline,
    stationsTotal,
    outOfStock,
    lowStock,
    avgQueueWait,
    openComplaints,
    activeFlags,
    activeInspections,
    pendingEnforcement,
    nationalSituation,
    situationDetail,
    lastSync: new Date().toISOString(),
  }
}

export async function getNationalOperationsDashboard(auth = null, options = {}) {
  const scopedDistrict = districtFilterValue(auth)
  const availabilityInterval = normalizeAvailabilityInterval(options?.availabilityInterval)
  const [
    overview,
    sidebarStats,
    heatmapRows,
    demandForecast,
    queueRows,
    queueTrendRows,
    demandIndexRows,
    fuelAvailabilityHistory,
    previousStationRows,
    previousStatusRows,
    previousCriticalFlagRows,
    complaintRows,
    flagRows,
    inspectionRows,
    deliveryRows,
    auditRows,
  ] = await Promise.all([
    getDashboardOverview(auth),
    getSidebarStats(auth),
    getShortageHeatmapData(auth),
    getDemandForecastSummary(auth).catch(() => ({ rows: [], summary: null })),
    prisma.$queryRaw`
      SELECT
        s.public_id,
        s.name,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(qe.id) AS queue_count,
        AVG(TIMESTAMPDIFF(MINUTE, qe.joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait_minutes
      FROM queue_entries qe
      INNER JOIN stations s ON s.id = qe.station_id
      WHERE qe.status IN ('WAITING', 'CALLED', 'LATE')
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      GROUP BY s.id, s.public_id, s.name, COALESCE(NULLIF(s.city, ''), 'Unknown')
      ORDER BY avg_wait_minutes DESC, queue_count DESC, s.name ASC
      LIMIT 6
    `,
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(joined_at, '%H:00') AS hour_label,
        AVG(TIMESTAMPDIFF(MINUTE, joined_at, COALESCE(served_at, called_at, CURRENT_TIMESTAMP(3)))) AS avg_wait_minutes
      FROM queue_entries
      WHERE joined_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
        AND (${scopedDistrict === ""} = TRUE OR EXISTS (
          SELECT 1 FROM stations s WHERE s.id = queue_entries.station_id AND s.city = ${scopedDistrict}
        ))
      GROUP BY DATE_FORMAT(joined_at, '%H:00')
      ORDER BY MIN(joined_at) ASC
    `,
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(tx.occurred_at, '%b %e') AS day_label,
        ft.code AS fuel_code,
        SUM(tx.litres) AS litres
      FROM transactions tx
      INNER JOIN fuel_types ft ON ft.id = tx.fuel_type_id
      INNER JOIN stations s ON s.id = tx.station_id
      WHERE tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      GROUP BY DATE(tx.occurred_at), DATE_FORMAT(tx.occurred_at, '%b %e'), ft.code
      ORDER BY DATE(tx.occurred_at) ASC
    `,
    getFuelAvailabilityHistory(auth, availabilityInterval),
    prisma.$queryRaw`
      SELECT COUNT(*) AS total_before
      FROM stations s
      WHERE s.is_active = 1
        AND s.created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    `,
    prisma.$queryRaw`
      SELECT
        s.public_id,
        s.name,
        s.city,
        COALESCE((
          SELECT status_log.availability_status
          FROM station_status_logs status_log
          WHERE status_log.station_id = s.id
            AND status_log.created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
          ORDER BY status_log.created_at DESC
          LIMIT 1
        ), 'UNKNOWN') AS availability_status,
        COALESCE((
          SELECT status_log.petrol_status
          FROM station_status_logs status_log
          WHERE status_log.station_id = s.id
            AND status_log.created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
          ORDER BY status_log.created_at DESC
          LIMIT 1
        ), 'UNKNOWN') AS petrol_status,
        COALESCE((
          SELECT status_log.diesel_status
          FROM station_status_logs status_log
          WHERE status_log.station_id = s.id
            AND status_log.created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
          ORDER BY status_log.created_at DESC
          LIMIT 1
        ), 'UNKNOWN') AS diesel_status
      FROM stations s
      WHERE s.is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY s.name ASC
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
        AND cf.severity = 'CRITICAL'
        AND cf.created_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    `,
    prisma.$queryRaw`
      SELECT
        pc.public_id,
        pc.complaint_type,
        pc.complaint_status,
        pc.created_at,
        s.name AS station_name,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM public_complaints pc
      INNER JOIN stations s ON s.id = pc.station_id
      WHERE pc.complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION', 'ESCALATED')
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY pc.created_at DESC
      LIMIT 8
    `,
    prisma.$queryRaw`
      SELECT
        cf.public_id,
        cf.flag_type,
        cf.severity,
        cf.created_at,
        s.name AS station_name,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY FIELD(cf.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), cf.created_at DESC
      LIMIT 8
    `,
    prisma.$queryRaw`
      SELECT
        inspection_status,
        COUNT(*) AS total
      FROM inspections
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = inspections.station_id AND s.city = ${scopedDistrict}
      ))
      GROUP BY inspection_status
    `,
    prisma.$queryRaw`
      SELECT
        fd.delivered_time,
        fd.litres,
        s.name AS station_name,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM fuel_deliveries fd
      INNER JOIN stations s ON s.id = fd.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY fd.delivered_time DESC
      LIMIT 8
    `,
    prisma.$queryRaw`
      SELECT action_type, action_description, created_at
      FROM audit_logs_mera
      ORDER BY created_at DESC
      LIMIT 8
    `.catch(() => []),
  ])

  const heatmap = normalizeRows(heatmapRows).map((row) => {
    const severity = heatmapSeverity(row)
    return {
      ...row,
      latitude: row?.latitude === null || row?.latitude === undefined ? null : normalizeDashboardNumber(row.latitude, null),
      longitude: row?.longitude === null || row?.longitude === undefined ? null : normalizeDashboardNumber(row.longitude, null),
      severity: severity.level,
      severityScore: severity.score,
    }
  })

  const stationsTotal = normalizeDashboardNumber(sidebarStats?.stationsTotal || overview?.totalStations, 0)
  const stationsOnline = normalizeDashboardNumber(sidebarStats?.stationsOnline, 0)
  const outOfStock = normalizeDashboardNumber(sidebarStats?.outOfStock || overview?.outOfStockStations, 0)
  const lowStock = normalizeDashboardNumber(sidebarStats?.lowStock || overview?.lowStockStations, 0)
  const avgQueueWait = normalizeDashboardNumber(sidebarStats?.avgQueueWait, 0)
  const criticalHeatmap = heatmap.filter((row) => row.severity === "critical")
  const criticalFlags = normalizeRows(flagRows).filter((row) => String(row?.severity || "").toUpperCase() === "CRITICAL")
  const previousHeatmap = normalizeRows(previousStatusRows).map((row) => ({
    ...row,
    severity: heatmapSeverity(row).level,
  }))
  const previousStationsTotal = normalizeDashboardNumber(previousStationRows?.[0]?.total_before, stationsTotal)
  const previousStationsOnline = previousHeatmap.filter((row) => isLiveReportingHeatmapRow(row)).length
  const previousOutOfStock = previousHeatmap.filter((row) => row.severity === "critical").length
  const previousLowStock = previousHeatmap.filter((row) => row.severity === "low" || row.severity === "high").length
  const previousCriticalAlerts = previousOutOfStock + normalizeDashboardNumber(previousCriticalFlagRows?.[0]?.total, criticalFlags.length)
  const queueSparklineValues = normalizeRows(queueTrendRows).map((row) => Math.round(normalizeDashboardNumber(row.avg_wait_minutes, 0)))
  const previousAvgQueueWait =
    queueSparklineValues.length > 1
      ? queueSparklineValues[0]
      : avgQueueWait

  const mlOpsItems = normalizeRows(demandForecast?.opsPredictions?.items)
  const criticalMlOps = mlOpsItems.filter((row) => {
    const prediction = row?.prediction || {}
    return (
      String(prediction.congestion_level || "").toUpperCase() === "CRITICAL" ||
      String(prediction.stockout_risk || "").toUpperCase() === "CRITICAL" ||
      Number(prediction.wait_time_minutes || 0) >= 60
    )
  })
  const criticalAlerts = criticalHeatmap.length + criticalFlags.length + criticalMlOps.length
  const topQueues = normalizeRows(queueRows).map((row) => ({
    station: row.name || "Unknown station",
    district: row.district || "Unknown",
    queue: normalizeDashboardNumber(row.queue_count, 0),
    avgWaitMinutes: Math.round(normalizeDashboardNumber(row.avg_wait_minutes, 0)),
  }))

  const liveAlerts = [
    ...criticalHeatmap.slice(0, 3).map((row) => ({
      severity: "critical",
      title: `${row.city || "Unknown"} — Critical Shortage`,
      description: `${row.name || "Station"} is reporting ${String(row.availability_status || "critical").toLowerCase()} fuel availability`,
      timestamp: row.latest_status_at || row.updated_at || row.created_at || null,
    })),
    ...topQueues.filter((row) => row.avgWaitMinutes >= 25).slice(0, 2).map((row) => ({
      severity: "warning",
      title: `${row.district} — Long Queues`,
      description: `${row.station} average wait is ${row.avgWaitMinutes} minutes`,
      timestamp: null,
    })),
    ...criticalMlOps.slice(0, 2).map((row) => ({
      severity: "critical",
      title: `${row.district || "Station"} — ML Operations Pressure`,
      description: row.prediction?.mera_summary || `${row.stationName || "Station"} has elevated predicted queue or stockout pressure`,
      timestamp: row.generatedAt || null,
    })),
    ...normalizeRows(flagRows).slice(0, 3).map((row) => ({
      severity: String(row.severity || "").toUpperCase() === "CRITICAL" ? "critical" : "warning",
      title: `${row.district || "Station"} — ${String(row.flag_type || "Compliance flag").replaceAll("_", " ")}`,
      description: `${row.station_name || "Station"} requires compliance review`,
      timestamp: row.created_at || null,
    })),
    ...normalizeRows(complaintRows).slice(0, 2).map((row) => ({
      severity: "info",
      title: `${row.district || "Station"} — Complaint Received`,
      description: `${row.station_name || "Station"}: ${String(row.complaint_type || "Complaint").replaceAll("_", " ")}`,
      timestamp: row.created_at || null,
    })),
  ].slice(0, 6)

  const inspectionTotal = normalizeRows(inspectionRows).reduce((sum, row) => sum + normalizeDashboardNumber(row.total, 0), 0)
  const compliant = normalizeRows(inspectionRows)
    .filter((row) => ["PASSED", "CLOSED"].includes(String(row.inspection_status || "").toUpperCase()))
    .reduce((sum, row) => sum + normalizeDashboardNumber(row.total, 0), 0)
  const violations = normalizeRows(inspectionRows)
    .filter((row) => ["FAILED", "ESCALATED"].includes(String(row.inspection_status || "").toUpperCase()))
    .reduce((sum, row) => sum + normalizeDashboardNumber(row.total, 0), 0)
  const warnings = Math.max(0, inspectionTotal - compliant - violations)
  const latestAvailabilityPoint = normalizeRows(fuelAvailabilityHistory?.points).slice(-1)[0] || {}
  const dashboardMetricValues = {
    activeStations: stationsOnline || normalizeDashboardNumber(latestAvailabilityPoint.stationsWithFuel, 0) || stationsTotal,
    nationalFuelReserve: 0,
    activeDriverQueues: topQueues.reduce((sum, row) => sum + normalizeDashboardNumber(row.queue, 0), 0),
    avgWaitTime: avgQueueWait,
    complianceViolations: violations,
    activeEnforcementActions: normalizeDashboardNumber(overview?.activeEnforcementActions, 0),
  }
  const kpiComparisons = await recordDashboardMetricSnapshots(scopedDistrict || "__NATIONAL__", dashboardMetricValues).catch(() => ({}))

  const demandByDay = new Map()
  for (const row of normalizeRows(demandIndexRows)) {
    const label = String(row.day_label || "")
    if (!demandByDay.has(label)) demandByDay.set(label, { label, petrol: 0, diesel: 0, kerosene: 0 })
    const item = demandByDay.get(label)
    const fuel = String(row.fuel_code || "").toUpperCase()
    if (fuel === "PETROL") item.petrol += normalizeDashboardNumber(row.litres, 0)
    else if (fuel === "DIESEL") item.diesel += normalizeDashboardNumber(row.litres, 0)
    else item.kerosene += normalizeDashboardNumber(row.litres, 0)
  }

  const recentActivity = [
    ...normalizeRows(deliveryRows).map((row) => ({
      tone: "success",
      text: `Fuel delivery received: ${row.station_name || "Station"} ${Math.round(normalizeDashboardNumber(row.litres, 0)).toLocaleString()}L`,
      timestamp: row.delivered_time || null,
    })),
    ...normalizeRows(complaintRows).map((row) => ({
      tone: "warning",
      text: `Complaint submitted: ${row.district || row.station_name || "Station"}`,
      timestamp: row.created_at || null,
    })),
    ...normalizeRows(auditRows).map((row) => ({
      tone: "info",
      text: row.action_description || row.action_type || "MERA portal activity",
      timestamp: row.created_at || null,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 10)

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalStations: {
        value: stationsTotal,
        subtitle: "Across Malawi",
        trendDirection: trendDirection(stationsTotal, previousStationsTotal),
        sparkline: buildSparkline(1, stationsTotal, previousStationsTotal),
      },
      stationsOnline: {
        value: stationsOnline,
        percent: stationsTotal ? Math.round((stationsOnline / stationsTotal) * 100) : 0,
        subtitle: "Live & reporting",
        trendDirection: trendDirection(stationsOnline, previousStationsOnline),
        sparkline: buildSparkline(2, stationsOnline, previousStationsOnline),
      },
      outOfStock: {
        value: outOfStock,
        percent: stationsTotal ? Math.round((outOfStock / stationsTotal) * 1000) / 10 : 0,
        subtitle: "Stations",
        trendDirection: trendDirection(outOfStock, previousOutOfStock),
        sparkline: buildSparkline(3, outOfStock, previousOutOfStock),
      },
      lowStock: {
        value: lowStock,
        percent: stationsTotal ? Math.round((lowStock / stationsTotal) * 1000) / 10 : 0,
        subtitle: "Stations",
        trendDirection: trendDirection(lowStock, previousLowStock),
        sparkline: buildSparkline(4, lowStock, previousLowStock),
      },
      avgQueueTime: {
        value: avgQueueWait,
        subtitle: "National average",
        trendDirection: trendDirection(avgQueueWait, previousAvgQueueWait),
        sparkline: queueSparklineValues.length > 1 ? queueSparklineValues : buildSparkline(5, avgQueueWait, previousAvgQueueWait),
      },
      nationalFuelReserve: {
        value: dashboardMetricValues.nationalFuelReserve,
        subtitle: "Days",
        trendDirection: trendDirection(dashboardMetricValues.nationalFuelReserve, kpiComparisons?.nationalFuelReserve?.previousValue ?? dashboardMetricValues.nationalFuelReserve),
        sparkline: buildSparkline(7, dashboardMetricValues.nationalFuelReserve, kpiComparisons?.nationalFuelReserve?.previousValue ?? dashboardMetricValues.nationalFuelReserve),
      },
      activeDriverQueues: {
        value: dashboardMetricValues.activeDriverQueues,
        subtitle: "Active queues",
        trendDirection: trendDirection(dashboardMetricValues.activeDriverQueues, kpiComparisons?.activeDriverQueues?.previousValue ?? dashboardMetricValues.activeDriverQueues),
        sparkline: buildSparkline(8, dashboardMetricValues.activeDriverQueues, kpiComparisons?.activeDriverQueues?.previousValue ?? dashboardMetricValues.activeDriverQueues),
      },
      avgWaitTime: {
        value: dashboardMetricValues.avgWaitTime,
        subtitle: "Average minutes",
        trendDirection: trendDirection(dashboardMetricValues.avgWaitTime, kpiComparisons?.avgWaitTime?.previousValue ?? dashboardMetricValues.avgWaitTime),
        sparkline: queueSparklineValues.length > 1 ? queueSparklineValues : buildSparkline(9, dashboardMetricValues.avgWaitTime, kpiComparisons?.avgWaitTime?.previousValue ?? dashboardMetricValues.avgWaitTime),
      },
      criticalAlerts: {
        value: criticalAlerts,
        subtitle: "Active alerts",
        trendDirection: trendDirection(criticalAlerts, previousCriticalAlerts),
        sparkline: buildSparkline(6, criticalAlerts, previousCriticalAlerts),
      },
    },
    heatmap,
    liveAlerts,
    topQueues,
    fuelAvailability: overview?.fuelAvailabilityByType || [],
    fuelAvailabilityHistory,
    kpiComparisons,
    queueTrend: normalizeTrendRows(queueTrendRows, "avg_wait_minutes", "hour_label"),
    fuelDemandIndex: Array.from(demandByDay.values()),
    complianceSummary: {
      inspections: inspectionTotal,
      compliant,
      warnings,
      violations,
    },
    recentActivity,
    demandForecast,
    opsPredictions: demandForecast?.opsPredictions || { generatedAt: new Date().toISOString(), modelAvailable: false, items: [], errors: [] },
    lastSync: sidebarStats?.lastSync || new Date().toISOString(),
  }
}

export async function getFlaggedStations(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(cf.id) AS open_flags,
      MAX(cf.severity) AS max_severity
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY open_flags DESC, s.name ASC
  `
  return rows || []
}

export async function getShortageHeatmapData(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COALESCE(NULLIF(s.operator_name, ''), 'Unknown OMC') AS operator_name,
      s.latitude,
      s.longitude,
      COALESCE(scs.availability_status, (
        SELECT status_log.availability_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS availability_status,
      COALESCE(scs.petrol_status, (
        SELECT status_log.petrol_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS petrol_status,
      COALESCE(scs.diesel_status, (
        SELECT status_log.diesel_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS diesel_status,
      COALESCE(scs.last_derived_at, (
        SELECT status_log.created_at
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      )) AS latest_status_at,
      COALESCE(active_queue.queue_count, 0) AS active_queue_count,
      COALESCE(active_queue.avg_wait_minutes, 0) AS avg_wait_minutes,
      COALESCE(open_complaints.open_cases, 0) AS open_cases,
      COALESCE(open_flags.open_flags, 0) AS open_flags,
      open_flags.max_flag_severity,
      scs.latest_delivery_time,
      scs.delivery_verified,
      scs.delivered_litres_since_baseline,
      scs.total_live_litres,
      scs.total_capacity_litres,
      s.created_at,
      s.updated_at
    FROM stations s
    LEFT JOIN station_current_status scs ON scs.station_id = s.id
    LEFT JOIN (
      SELECT
        station_id,
        COUNT(*) AS queue_count,
        AVG(TIMESTAMPDIFF(MINUTE, joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait_minutes
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY station_id
    ) active_queue ON active_queue.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS open_cases
      FROM public_complaints
      WHERE complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION', 'ESCALATED')
      GROUP BY station_id
    ) open_complaints ON open_complaints.station_id = s.id
    LEFT JOIN (
      SELECT
        station_id,
        COUNT(*) AS open_flags,
        MAX(severity) AS max_flag_severity
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN', 'UNDER_REVIEW')
      GROUP BY station_id
    ) open_flags ON open_flags.station_id = s.id
    WHERE s.is_active = 1
      AND s.deleted_at IS NULL
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getComplaintMetrics(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [summaryRows, typeRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS bucket,
        COUNT(*) AS total
      FROM public_complaints
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 6 MONTH)
        AND (${scopedDistrict === ""} = TRUE OR EXISTS (
          SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
        ))
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY bucket ASC
    `,
    prisma.$queryRaw`
      SELECT complaint_type, COUNT(*) AS total
      FROM public_complaints
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
      ))
      GROUP BY complaint_type
      ORDER BY total DESC, complaint_type ASC
    `,
  ])
  return {
    monthly: summaryRows || [],
    byType: typeRows || [],
  }
}

export async function getInspectionMetrics(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [statusRows, officerRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT inspection_status, COUNT(*) AS total
      FROM inspections
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = inspections.station_id AND s.city = ${scopedDistrict}
      ))
      GROUP BY inspection_status
      ORDER BY total DESC, inspection_status ASC
    `,
    prisma.$queryRaw`
      SELECT
        mu.public_id,
        mu.full_name,
        COUNT(i.id) AS inspections_count
      FROM inspections i
      INNER JOIN mera_users mu ON mu.id = i.officer_id
      INNER JOIN stations s ON s.id = i.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      GROUP BY mu.id, mu.public_id, mu.full_name
      ORDER BY inspections_count DESC, mu.full_name ASC
      LIMIT 10
    `,
  ])
  return {
    byStatus: statusRows || [],
    topInspectors: officerRows || [],
  }
}

export async function getNationalConsumption(auth = null, options = {}) {
  const range = String(options?.range || "7d").trim().toLowerCase()
  if (range && range !== "7d") throw badRequest("Only range=7d is supported")

  const scopedDistrict = districtFilterValue(auth)
  const weekStart = startOfCurrentLocalWeek()
  const weekEnd = addDays(weekStart, 7)
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => {
    const date = addDays(weekStart, index)
    return {
      day,
      date: formatLocalDate(date),
      petrol: 0,
      diesel: 0,
      paraffin: 0,
      total: 0,
      source: "empty",
    }
  })
  const byDate = new Map(days.map((row) => [row.date, row]))

  const rows = await prisma.$queryRaw`
    SELECT
      DATE(tx.occurred_at) AS sale_date,
      SUM(CASE WHEN UPPER(ft.code) = 'PETROL' THEN tx.litres ELSE 0 END) AS petrol,
      SUM(CASE WHEN UPPER(ft.code) = 'DIESEL' THEN tx.litres ELSE 0 END) AS diesel,
      SUM(CASE WHEN UPPER(ft.code) IN ('PARAFFIN', 'KEROSENE') THEN tx.litres ELSE 0 END) AS paraffin
    FROM transactions tx
    INNER JOIN fuel_types ft ON ft.id = tx.fuel_type_id
    INNER JOIN stations s ON s.id = tx.station_id
    WHERE tx.occurred_at >= ${weekStart}
      AND tx.occurred_at < ${weekEnd}
      AND tx.status NOT IN ('CANCELLED', 'REVERSED')
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY DATE(tx.occurred_at)
    ORDER BY DATE(tx.occurred_at) ASC
  `

  rows.forEach((row) => {
    const date = formatLocalDate(new Date(row.sale_date))
    const target = byDate.get(date)
    if (!target) return
    const petrol = toNumber(row.petrol)
    const diesel = toNumber(row.diesel)
    const paraffin = toNumber(row.paraffin)
    target.petrol = petrol
    target.diesel = diesel
    target.paraffin = paraffin
    target.total = petrol + diesel + paraffin
    target.source = target.total > 0 ? "actual" : "empty"
  })

  return days.map((row) => ({
    ...row,
    petrol: Number(row.petrol.toFixed(2)),
    diesel: Number(row.diesel.toFixed(2)),
    paraffin: Number(row.paraffin.toFixed(2)),
    total: Number((row.petrol + row.diesel + row.paraffin).toFixed(2)),
  }))
}

export async function getTopComplaintStations(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(pc.id) AS complaints_count
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY complaints_count DESC, s.name ASC
    LIMIT 10
  `
  return rows || []
}

export async function getDistrictShortageSummaries(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      COUNT(*) AS total_stations,
      SUM(
        CASE
          WHEN COALESCE(scs.availability_status, (
            SELECT status_log.availability_status
            FROM station_status_logs status_log
            WHERE status_log.station_id = s.id
            ORDER BY status_log.created_at DESC
            LIMIT 1
          ), 'UNKNOWN') IN ('DRY', 'LIMITED')
            THEN 1
          ELSE 0
        END
      ) AS shortage_stations
    FROM stations s
    LEFT JOIN station_current_status scs ON scs.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    ORDER BY shortage_stations DESC, district ASC
  `
  return rows || []
}

export async function getRepeatedOffenders(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(cf.id) AS flag_count,
      COUNT(ea.id) AS enforcement_count
    FROM stations s
    LEFT JOIN compliance_flags cf ON cf.station_id = s.id
    LEFT JOIN enforcement_actions ea ON ea.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    HAVING flag_count >= 2 OR enforcement_count >= 1
    ORDER BY flag_count DESC, enforcement_count DESC, s.name ASC
  `
  return rows || []
}

export async function getMonthlyRegulatoryReports(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      DATE_FORMAT(pc.created_at, '%Y-%m') AS month_bucket,
      COUNT(DISTINCT pc.id) AS complaints_count,
      COUNT(DISTINCT i.id) AS inspections_count,
      COUNT(DISTINCT cf.id) AS flags_count,
      COUNT(DISTINCT ea.id) AS enforcement_count
    FROM public_complaints pc
    LEFT JOIN inspections i ON DATE_FORMAT(i.created_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    LEFT JOIN compliance_flags cf ON DATE_FORMAT(cf.created_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    LEFT JOIN enforcement_actions ea ON DATE_FORMAT(ea.issued_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    WHERE pc.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 MONTH)
      AND (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = pc.station_id AND s.city = ${scopedDistrict}
      ))
    GROUP BY DATE_FORMAT(pc.created_at, '%Y-%m')
    ORDER BY month_bucket ASC
  `
  return rows || []
}

export async function listMeraUsers(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district_scope,
      mu.region_scope,
      mu.account_status,
      mu.created_at,
      (
        SELECT MAX(mas.last_seen_at)
        FROM mera_auth_sessions mas
        WHERE mas.mera_user_id = mu.id
      ) AS last_login_at,
      mr.code AS role_code,
      mr.display_name AS role_display_name,
      mr.description AS role_description,
      (
        SELECT COUNT(*)
        FROM public_complaints pc
        WHERE pc.assigned_officer_id = mu.id
          AND pc.complaint_status IN ('NEW', 'REVIEWING', 'VERIFIED', 'ESCALATED', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
      ) AS active_cases
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
    ORDER BY mu.created_at DESC
  `
  const permissionRows = await prisma.$queryRaw`
    SELECT
      mu.public_id AS user_public_id,
      mp.code AS permission_code
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    INNER JOIN mera_role_permissions mrp ON mrp.role_id = mr.id
    INNER JOIN mera_permissions mp ON mp.id = mrp.permission_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
  `
  const permissionMap = new Map()
  for (const row of permissionRows || []) {
    const userPublicId = String(row.user_public_id || "").trim()
    if (!permissionMap.has(userPublicId)) permissionMap.set(userPublicId, [])
    permissionMap.get(userPublicId).push(String(row.permission_code || "").trim())
  }

  return (rows || []).map((row) => ({
    ...row,
    permissions: permissionMap.get(String(row.public_id || "").trim()) || [],
  }))
}

export async function createMeraUser(payload, actor) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM mera_roles
    WHERE code = ${normalizeRole(payload.roleName)}
    LIMIT 1
  `
  const roleId = rows?.[0]?.id
  if (!roleId) throw badRequest("MERA role is not configured")

  const passwordHash = await bcrypt.hash(String(payload.password || ""), 10)
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_users (
      public_id,
      full_name,
      email,
      phone,
      password_hash,
      role_id,
      district_scope,
      region_scope,
      account_status
    )
    VALUES (
      ${publicId},
      ${payload.fullName},
      ${String(payload.email || "").trim().toLowerCase()},
      ${payload.phone || null},
      ${passwordHash},
      ${roleId},
      ${payload.districtScope || null},
      ${payload.regionScope || null},
      ${normalizeAccountStatus(payload.accountStatus || "ACTIVE")}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_CREATED",
    actionDescription: `MERA user ${payload.fullName} created with role ${payload.roleName}.`,
    affectedEntity: publicId,
  })
  return {
    publicId,
    fullName: payload.fullName,
    email: String(payload.email || "").trim().toLowerCase(),
    roleName: normalizeRole(payload.roleName),
  }
}

export async function updateMeraUserStatus({ meraUserPublicId, accountStatus, actor }) {
  const user = await resolveMeraUserByPublicId(meraUserPublicId)
  ensureDistrictAccess(actor, user.district_scope, "user")
  const normalizedStatus = normalizeAccountStatus(accountStatus)
  await prisma.$executeRaw`
    UPDATE mera_users
    SET account_status = ${normalizedStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${user.id}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_STATUS_UPDATED",
    actionDescription: `MERA user ${user.full_name} moved to ${normalizedStatus}.`,
    affectedEntity: user.public_id,
  })
  return {
    publicId: user.public_id,
    accountStatus: normalizedStatus,
  }
}

export async function updateMeraUserPermissions({ meraUserPublicId, updates = {}, actor }) {
  const user = await resolveMeraUserByPublicId(meraUserPublicId)
  ensureDistrictAccess(actor, user.district_scope, "user")

  const fields = []
  const values = []
  let nextRole = user.role_code
  if (updates.roleName !== undefined) {
    nextRole = normalizeRole(updates.roleName)
    const roleRows = await prisma.$queryRaw`
      SELECT id
      FROM mera_roles
      WHERE code = ${nextRole}
      LIMIT 1
    `
    const roleId = roleRows?.[0]?.id
    if (!roleId) throw badRequest("MERA role is not configured")
    fields.push("role_id = ?")
    values.push(roleId)
  }
  if (updates.districtScope !== undefined) {
    fields.push("district_scope = ?")
    values.push(String(updates.districtScope || "").trim() || null)
  }
  if (updates.regionScope !== undefined) {
    fields.push("region_scope = ?")
    values.push(String(updates.regionScope || "").trim() || null)
  }
  if (updates.accountStatus !== undefined) {
    fields.push("account_status = ?")
    values.push(normalizeAccountStatus(updates.accountStatus))
  }

  if (fields.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE mera_users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      ...values,
      user.id
    )
  }

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_PERMISSIONS_UPDATED",
    actionDescription: `MERA user ${user.full_name} access updated to role ${nextRole}.`,
    affectedEntity: user.public_id,
  })
  return {
    publicId: user.public_id,
    roleName: nextRole,
    updated: true,
  }
}

export async function revokeMeraUserSessions({ meraUserPublicId, actor }) {
  const user = await resolveMeraUserByPublicId(meraUserPublicId)
  ensureDistrictAccess(actor, user.district_scope, "user")
  const revokedCount = await prisma.$executeRaw`
    UPDATE mera_auth_sessions
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3))
    WHERE mera_user_id = ${user.id}
      AND revoked_at IS NULL
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_SESSIONS_REVOKED",
    actionDescription: `Active sessions revoked for MERA user ${user.full_name}.`,
    affectedEntity: user.public_id,
  })
  return {
    publicId: user.public_id,
    revokedCount: Number(revokedCount || 0),
  }
}

export async function listMeraAuditLogs({ page = 1, limit = 50 } = {}, auth = null) {
  const pagination = normalizePagination({ page, limit })
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      alm.id,
      alm.actor_role,
      alm.permission_code,
      alm.action_type,
      alm.action_description,
      alm.affected_entity,
      alm.ip_address,
      alm.device_info,
      alm.created_at,
      mu.public_id AS actor_public_id,
      COALESCE(mu.full_name, alm.actor_name) AS actor_name
    FROM audit_logs_mera alm
    INNER JOIN mera_users mu ON mu.id = alm.actor_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
      AND (
        UPPER(alm.action_type) LIKE '%ENFORC%'
        OR UPPER(alm.action_type) LIKE '%ESCALAT%'
        OR UPPER(alm.action_type) LIKE '%RESOLV%'
        OR UPPER(alm.action_type) LIKE '%CLOSE%'
        OR UPPER(alm.action_type) LIKE '%SUSPEND%'
        OR UPPER(alm.action_type) LIKE '%DISMISS%'
        OR UPPER(alm.action_type) LIKE '%ASSIGN%'
        OR UPPER(alm.action_type) LIKE '%STATUS%'
        OR UPPER(alm.action_type) LIKE '%PERMISSION%'
        OR UPPER(alm.action_type) LIKE '%SESSIONS_REVOKED%'
        OR UPPER(alm.action_description) LIKE '%WARNING%'
        OR UPPER(alm.action_description) LIKE '%FINE%'
        OR UPPER(alm.action_description) LIKE '%CLOSURE%'
        OR UPPER(alm.action_description) LIKE '%COMPLIANCE%'
        OR UPPER(alm.action_description) LIKE '%VIOLATION%'
      )
    ORDER BY alm.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return {
    page: pagination.page,
    limit: pagination.limit,
    items: rows || [],
  }
}

export async function listStationRegulatoryProfiles(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      s.address,
      latest_license.license_number,
      latest_license.license_status,
      latest_license.expiry_date,
      COALESCE(flags.open_flags, 0) AS open_flags,
      COALESCE(complaints.complaint_count, 0) AS complaint_count
    FROM stations s
    LEFT JOIN fuel_station_licenses latest_license ON latest_license.id = (
      SELECT inner_license.id
      FROM fuel_station_licenses inner_license
      WHERE inner_license.station_id = s.id
      ORDER BY inner_license.expiry_date DESC, inner_license.id DESC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS open_flags
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN', 'UNDER_REVIEW')
      GROUP BY station_id
    ) flags ON flags.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS complaint_count
      FROM public_complaints
      GROUP BY station_id
    ) complaints ON complaints.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getStationRegulatoryProfile(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const [licenseRows, complaintRows, flagRows, enforcementRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, license_number, issue_date, expiry_date, license_status, compliance_conditions
      FROM fuel_station_licenses
      WHERE station_id = ${station.id}
      ORDER BY expiry_date DESC, id DESC
    `,
    prisma.$queryRaw`
      SELECT complaint_type, complaint_status, created_at
      FROM public_complaints
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT public_id, flag_type, severity, resolved_status, created_at
      FROM compliance_flags
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT public_id, action_type, action_status, issued_at, resolved_at
      FROM enforcement_actions
      WHERE station_id = ${station.id}
      ORDER BY issued_at DESC
      LIMIT 50
    `,
  ])

  return {
    station,
    licenses: licenseRows || [],
    complaints: complaintRows || [],
    flags: flagRows || [],
    enforcementActions: enforcementRows || [],
  }
}

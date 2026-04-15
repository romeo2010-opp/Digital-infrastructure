import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { formatDateTimeSqlInTimeZone } from "../../utils/dateTime.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import {
  createNozzleForPump,
  createPumpGroup,
  deleteNozzleByPublicId,
  deletePumpGroup,
  listStationPumpsWithNozzles,
  patchNozzleByPublicId,
  patchPumpGroup,
} from "../pumps/pumps.service.js"
import {
  getStationHybridQueueSettings,
  patchStationHybridQueueSettings,
} from "../queue/hybrid/integration.service.js"

const DEFAULT_FUEL_PRICE_CURRENCY = "MWK"

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePriceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(2))
  }
  const raw = String(value || "").trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, "")
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function normalizeFuelTypeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16)
}

function normalizeStationFuelPrices(value) {
  const rows = Array.isArray(value) ? value : parseJsonArray(value)
  return rows.reduce((items, row) => {
    const label = String(row?.label || row?.name || row?.fuelType || row?.type || "").trim()
    const pricePerLitre =
      parsePriceNumber(row?.pricePerLitre)
      ?? parsePriceNumber(row?.price_per_litre)
      ?? parsePriceNumber(row?.price)
      ?? parsePriceNumber(row?.amount)
      ?? parsePriceNumber(row?.value)
    if (!label || !Number.isFinite(pricePerLitre) || pricePerLitre <= 0) {
      return items
    }

    const currencyCode =
      String(row?.currencyCode || row?.currency_code || DEFAULT_FUEL_PRICE_CURRENCY).trim().toUpperCase()
      || DEFAULT_FUEL_PRICE_CURRENCY
    const fuelType = normalizeFuelTypeCode(row?.fuelType || row?.code || label) || normalizeFuelTypeCode(label)

    items.push({
      label,
      fuelType,
      pricePerLitre,
      currencyCode,
      value: `${currencyCode} ${pricePerLitre.toLocaleString()} /L`,
    })
    return items
  }, [])
}

function normalizeFavoriteStationPublicIds(value) {
  const rows = Array.isArray(value) ? value : parseJsonArray(value)
  const seen = new Set()

  return rows.reduce((items, row) => {
    const stationPublicId = String(row || "").trim()
    if (!stationPublicId || seen.has(stationPublicId)) {
      return items
    }
    seen.add(stationPublicId)
    items.push(stationPublicId)
    return items
  }, [])
}

function buildFuelPriceComparisonKey(entry) {
  const fuelType = String(entry?.fuelType || entry?.fuel_type || "").trim().toUpperCase()
  if (fuelType) return fuelType
  return String(entry?.label || "").trim().toUpperCase()
}

function formatFuelPricePercentChange(previousPrice, nextPrice) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(nextPrice) || previousPrice <= 0 || nextPrice === previousPrice) {
    return ""
  }
  const percent = (Math.abs(nextPrice - previousPrice) / previousPrice) * 100
  if (!Number.isFinite(percent) || percent <= 0) return ""
  return percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1).replace(/\.0$/, "")}%`
}

function collectFuelPriceChanges(previousPrices, nextPrices) {
  const previousByKey = new Map(
    normalizeStationFuelPrices(previousPrices).map((entry) => [buildFuelPriceComparisonKey(entry), entry])
  )

  return normalizeStationFuelPrices(nextPrices)
    .map((entry) => {
      const previousEntry = previousByKey.get(buildFuelPriceComparisonKey(entry))
      if (!previousEntry) return null

      const previousPrice = Number(previousEntry.pricePerLitre)
      const nextPrice = Number(entry.pricePerLitre)
      if (!Number.isFinite(previousPrice) || !Number.isFinite(nextPrice) || nextPrice === previousPrice) {
        return null
      }

      return {
        label: String(entry.label || previousEntry.label || "Fuel").trim() || "Fuel",
        previousPrice,
        nextPrice,
        direction: nextPrice > previousPrice ? "increase" : "decrease",
        percentChange: formatFuelPricePercentChange(previousPrice, nextPrice),
        displayValue: String(
          entry.value || `${entry.currencyCode || DEFAULT_FUEL_PRICE_CURRENCY} ${nextPrice.toLocaleString()} /L`
        ).trim(),
      }
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.nextPrice - right.previousPrice) - Math.abs(left.nextPrice - left.previousPrice))
}

function buildFuelPriceChangeAlertCopy({ stationName, priceChanges }) {
  const leadChange = Array.isArray(priceChanges) ? priceChanges[0] : null
  if (!leadChange) return null

  const extraChangeCount = Math.max(0, priceChanges.length - 1)
  const actionLabel = leadChange.direction === "increase" ? "went up" : "dropped"
  return {
    title: `Price Change at ${String(stationName || "Station").trim() || "Station"}`,
    body: `${leadChange.label} just ${actionLabel} ${leadChange.percentChange} to ${leadChange.displayValue}.${extraChangeCount ? ` ${extraChangeCount} other price${extraChangeCount === 1 ? "" : "s"} also changed.` : ""}`,
  }
}

async function listFavoriteStationAlertRecipients(stationPublicId) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  if (!scopedStationPublicId) return []

  const rows = await prisma.$queryRaw`
    SELECT user_id, favorite_station_public_ids_json, notify_in_app
    FROM user_preferences
    WHERE notify_in_app = 1
  `

  return (rows || [])
    .filter((row) => normalizeFavoriteStationPublicIds(row.favorite_station_public_ids_json).includes(scopedStationPublicId))
    .map((row) => Number(row.user_id || 0))
    .filter((userId) => Number.isFinite(userId) && userId > 0)
}

async function notifyUsersOfStationPriceChange({ station, previousPrices, nextPrices }) {
  const priceChanges = collectFuelPriceChanges(previousPrices, nextPrices)
  if (!priceChanges.length) return []

  const recipients = await listFavoriteStationAlertRecipients(station?.public_id)
  if (!recipients.length) return []

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return []
  }

  const alertCopy = buildFuelPriceChangeAlertCopy({
    stationName: station?.name,
    priceChanges,
  })
  if (!alertCopy) return []

  const alerts = []

  for (const userId of recipients) {
    try {
      const alert = await createUserAlert({
        userId,
        stationId: Number(station?.id || 0) || null,
        category: "SYSTEM",
        title: alertCopy.title,
        body: alertCopy.body,
        metadata: {
          event: "station_price_change",
          stationPublicId: station?.public_id || null,
          stationName: station?.name || null,
          path: station?.public_id ? `/m/stations/${station.public_id}` : "/m/alerts",
          priceChanges: priceChanges.map((item) => ({
            label: item.label,
            previousPrice: item.previousPrice,
            nextPrice: item.nextPrice,
            direction: item.direction,
            percentChange: item.percentChange,
            value: item.displayValue,
          })),
        },
      })

      publishUserAlert({
        userId,
        eventType: "user_alert:new",
        data: alert,
      })

      await sendPushAlertToUser({
        userId,
        notification: {
          title: alert.title,
          body: alert.message,
          tag: alert.publicId || `station-price-${station?.public_id || Date.now()}`,
          url: station?.public_id ? `/m/stations/${station.public_id}` : "/m/alerts",
          icon: "/smartlogo.png",
          badge: "/smartlogo.png",
        },
        data: {
          alertPublicId: alert.publicId || null,
          stationPublicId: station?.public_id || null,
          path: station?.public_id ? `/m/stations/${station.public_id}` : "/m/alerts",
          priceChanges: priceChanges.map((item) => ({
            label: item.label,
            previousPrice: item.previousPrice,
            nextPrice: item.nextPrice,
            direction: item.direction,
            percentChange: item.percentChange,
            value: item.displayValue,
          })),
        },
      }).catch(() => {})

      alerts.push(alert)
    } catch {
      // Best-effort delivery should not block station updates.
    }
  }

  return alerts
}

async function getFuelTypeByCode(code) {
  const rows = await prisma.$queryRaw`
    SELECT id, code
    FROM fuel_types
    WHERE code = ${code}
    LIMIT 1
  `
  const fuelType = rows?.[0]
  if (!fuelType) throw badRequest(`Unsupported fuel type: ${code}`)
  return fuelType
}

async function getRoleByCode(code) {
  const rows = await prisma.$queryRaw`
    SELECT id, code
    FROM staff_roles
    WHERE code = ${code}
    LIMIT 1
  `
  const role = rows?.[0]
  if (!role) throw badRequest(`Unsupported role: ${code}`)
  return role
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

async function resolveStationTimeZone(stationId) {
  if (!stationId) return "Africa/Blantyre"
  const rows = await prisma.$queryRaw`
    SELECT timezone
    FROM stations
    WHERE id = ${stationId}
    LIMIT 1
  `
  return String(rows?.[0]?.timezone || "").trim() || "Africa/Blantyre"
}

function serializeDatesForTimeZone(value, timeZone) {
  if (value instanceof Date) {
    return formatDateTimeSqlInTimeZone(value, timeZone) || value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDatesForTimeZone(item, timeZone))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeDatesForTimeZone(item, timeZone)])
    )
  }
  return value
}

async function ensureQueueSettings(stationId) {
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
  const created = await prisma.$queryRaw`
    SELECT *
    FROM station_queue_settings
    WHERE station_id = ${stationId}
    LIMIT 1
  `
  return created?.[0] || null
}

async function getTanks(stationId) {
  return prisma.$queryRaw`
    SELECT
      t.public_id,
      t.name,
      t.capacity_litres,
      t.is_active,
      ft.code AS fuel_code
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
    ORDER BY ft.code ASC, t.name ASC
  `
}

async function getPumps(stationId) {
  return listStationPumpsWithNozzles(stationId, { includeInactive: true })
}

async function getStaff(stationId) {
  return prisma.$queryRaw`
    SELECT
      ss.id,
      ss.is_active,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      sr.code AS role,
      sr.code AS role_code,
      sr.name AS role_name
    FROM station_staff ss
    INNER JOIN users u ON u.id = ss.user_id
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    WHERE ss.station_id = ${stationId}
      AND ss.is_active = 1
    ORDER BY ss.id ASC
  `
}

export async function getSettingsSnapshot(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const [stationRows, queue, hybridQueue, tanks, pumps, staff] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        public_id,
        name,
        operator_name,
        country_code,
        city,
        address,
      timezone,
      prices_json,
      opening_time,
      closing_time,
      open_24h,
        is_active,
        updated_at
      FROM stations
      WHERE id = ${station.id}
      LIMIT 1
    `,
    ensureQueueSettings(station.id),
    getStationHybridQueueSettings(station.id),
    getTanks(station.id),
    getPumps(station.id),
    getStaff(station.id),
  ])

  const stationRow = stationRows?.[0] || station
  return {
    station: {
      ...stationRow,
      fuel_prices: normalizeStationFuelPrices(stationRow?.prices_json),
    },
    queue_settings: {
      ...queue,
      hybrid_pilot_enabled: Boolean(Number(hybridQueue?.is_enabled || 0)),
      pilot_pump_public_id: hybridQueue?.pilot_pump_public_id || null,
      digital_hold_timeout_seconds:
        Number(hybridQueue?.digital_hold_timeout_seconds || 0) || null,
      kiosk_walkin_redirect_message:
        hybridQueue?.kiosk_walkin_redirect_message || null,
    },
    tanks,
    pumps,
    staff,
  }
}

export async function patchStation({ stationPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  const currentStationRows = await prisma.$queryRaw`
    SELECT id, public_id, name, prices_json
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  const currentStation = currentStationRows?.[0] || station

  const patch = { ...payload }
  if (Object.prototype.hasOwnProperty.call(patch, "fuel_prices")) {
    patch.prices_json = JSON.stringify(normalizeStationFuelPrices(patch.fuel_prices))
    delete patch.fuel_prices
  }

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  await prisma.$executeRawUnsafe(
    `UPDATE stations SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
    station.id
  )

  await writeAuditLog({
    stationId: station.id,
    actorStaffId,
    actionType: "SETTINGS_STATION_UPDATE",
    payload: {
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(payload, "fuel_prices")
        ? { fuel_prices: normalizeStationFuelPrices(payload.fuel_prices) }
        : {}),
    },
  })

  const rows = await prisma.$queryRaw`
    SELECT public_id, name, operator_name, city, address, timezone, prices_json, is_active, updated_at
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  const updatedStation = rows?.[0] || null
  if (!updatedStation) return null

  if (Object.prototype.hasOwnProperty.call(payload, "fuel_prices")) {
    await notifyUsersOfStationPriceChange({
      station: updatedStation,
      previousPrices: currentStation?.prices_json,
      nextPrices: updatedStation?.prices_json,
    })
  }

  return {
    ...updatedStation,
    fuel_prices: normalizeStationFuelPrices(updatedStation.prices_json),
  }
}

export async function listTanks(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  return getTanks(station.id)
}

export async function createTank({ stationPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  const fuelType = await getFuelTypeByCode(payload.fuelType)
  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO tanks (
      station_id, public_id, fuel_type_id, name, capacity_litres, is_active
    )
    VALUES (
      ${station.id},
      ${publicId},
      ${fuelType.id},
      ${payload.name},
      ${payload.capacityLitres},
      ${payload.isActive ?? true}
    )
  `

  await writeAuditLog({
    stationId: station.id,
    actorStaffId,
    actionType: "SETTINGS_TANK_CREATE",
    payload,
  })

  const rows = await prisma.$queryRaw`
    SELECT
      t.public_id,
      t.name,
      t.capacity_litres,
      t.is_active,
      ft.code AS fuel_code
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${station.id}
      AND t.public_id = ${publicId}
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function patchTank({ stationPublicId, tankPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM tanks
    WHERE station_id = ${station.id}
      AND public_id = ${tankPublicId}
    LIMIT 1
  `
  const tank = rows?.[0]
  if (!tank) throw notFound(`Tank not found: ${tankPublicId}`)

  const patch = {}
  if (payload.name !== undefined) patch.name = payload.name
  if (payload.capacityLitres !== undefined) patch.capacity_litres = payload.capacityLitres
  if (payload.isActive !== undefined) patch.is_active = payload.isActive

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  await prisma.$executeRawUnsafe(
    `UPDATE tanks SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
    tank.id
  )

  await writeAuditLog({
    stationId: station.id,
    actorStaffId,
    actionType: "SETTINGS_TANK_UPDATE",
    payload: { tankPublicId, ...payload },
  })

  const updated = await prisma.$queryRaw`
    SELECT
      t.public_id,
      t.name,
      t.capacity_litres,
      t.is_active,
      ft.code AS fuel_code
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.id = ${tank.id}
    LIMIT 1
  `
  return updated?.[0] || null
}

export async function listPumps(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  return getPumps(station.id)
}

export async function createPump({ stationPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return createPumpGroup({
    stationId: station.id,
    payload,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_CREATE",
  })
}

export async function patchPump({ stationPublicId, pumpPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return patchPumpGroup({
    stationId: station.id,
    pumpPublicId,
    payload,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_UPDATE",
  })
}

export async function deletePump({ stationPublicId, pumpPublicId, userId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return deletePumpGroup({
    stationId: station.id,
    pumpPublicId,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_DELETE",
  })
}

export async function createPumpNozzle({ stationPublicId, pumpPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return createNozzleForPump({
    stationId: station.id,
    pumpPublicId,
    payload,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_NOZZLE_CREATE",
  })
}

export async function patchPumpNozzle({ stationPublicId, nozzlePublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return patchNozzleByPublicId({
    stationId: station.id,
    nozzlePublicId,
    payload,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_NOZZLE_UPDATE",
  })
}

export async function deletePumpNozzle({ stationPublicId, nozzlePublicId, userId }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  return deleteNozzleByPublicId({
    stationId: station.id,
    nozzlePublicId,
    actorStaffId,
    auditActionType: "SETTINGS_PUMP_NOZZLE_DELETE",
  })
}

export async function listStaff(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  return getStaff(station.id)
}

export async function patchStaff({ stationPublicId, staffId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  const rows = await prisma.$queryRaw`
    SELECT ss.id, ss.role_id, ss.is_active, sr.code AS role_code
    FROM station_staff ss
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    WHERE ss.station_id = ${station.id}
      AND ss.id = ${staffId}
    LIMIT 1
  `
  const staff = rows?.[0]
  if (!staff) throw notFound(`Staff assignment not found: ${staffId}`)

  const nextRoleCode = payload.role || staff.role_code
  const nextIsActive = payload.isActive ?? Boolean(staff.is_active)
  if (String(staff.role_code) === "MANAGER" && (!nextIsActive || nextRoleCode !== "MANAGER")) {
    const countRows = await prisma.$queryRaw`
      SELECT COUNT(*) AS manager_count
      FROM station_staff ss
      INNER JOIN staff_roles sr ON sr.id = ss.role_id
      WHERE ss.station_id = ${station.id}
        AND ss.is_active = 1
        AND sr.code = 'MANAGER'
    `
    const managerCount = Number(countRows?.[0]?.manager_count || 0)
    if (managerCount <= 1) {
      throw badRequest("Cannot demote/deactivate the last active manager")
    }
  }

  const patch = {}
  if (payload.role !== undefined) {
    const role = await getRoleByCode(payload.role)
    patch.role_id = role.id
  }
  if (payload.isActive !== undefined) patch.is_active = payload.isActive

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  await prisma.$executeRawUnsafe(
    `UPDATE station_staff SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
    staff.id
  )

  await writeAuditLog({
    stationId: station.id,
    actorStaffId,
    actionType: "SETTINGS_STAFF_UPDATE",
    payload: { staffId, ...payload },
  })

  const updated = await prisma.$queryRaw`
    SELECT
      ss.id,
      ss.is_active,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      sr.code AS role
    FROM station_staff ss
    INNER JOIN users u ON u.id = ss.user_id
    INNER JOIN staff_roles sr ON sr.id = ss.role_id
    WHERE ss.id = ${staff.id}
    LIMIT 1
  `
  return updated?.[0] || null
}

export async function patchMe({ userId, auth, payload }) {
  if (!userId) throw badRequest("Missing authenticated user")
  await prisma.$executeRaw`
    UPDATE users
    SET full_name = ${payload.fullName}
    WHERE id = ${userId}
  `

  let stationId = auth?.stationId || null
  if (!stationId) {
    const rows = await prisma.$queryRaw`
      SELECT station_id
      FROM station_staff
      WHERE user_id = ${userId}
      ORDER BY id ASC
      LIMIT 1
    `
    stationId = rows?.[0]?.station_id || null
  }

  const actorStaffId = stationId ? await resolveActorStaffId(stationId, userId) : null
  const timeZone = await resolveStationTimeZone(stationId)
  if (stationId) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: "USER_PROFILE_UPDATE",
      payload,
    })
  }

  const rows = await prisma.$queryRaw`
    SELECT public_id, full_name, email, phone_e164, updated_at
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `
  const row = rows?.[0] || null
  if (!row) return null
  return {
    publicId: row.public_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    updatedAt: serializeDatesForTimeZone(row.updated_at, timeZone),
  }
}

export async function getMe({ userId, auth }) {
  if (!userId) throw badRequest("Missing authenticated user")
  const timeZone = await resolveStationTimeZone(auth?.stationId || null)
  const rows = await prisma.$queryRaw`
    SELECT
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.phone_e164 AS user_phone,
      u.updated_at AS user_updated_at,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM users u
    LEFT JOIN stations st ON st.id = ${auth?.stationId || null}
    WHERE u.id = ${userId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row) throw notFound("Authenticated user profile not found")
  return {
    user: {
      publicId: row.user_public_id,
      fullName: row.user_full_name,
      email: row.user_email,
      phone: row.user_phone,
      updatedAt: serializeDatesForTimeZone(row.user_updated_at, timeZone),
    },
    station: row.station_public_id
      ? {
          publicId: row.station_public_id,
          name: row.station_name,
        }
      : null,
    role: auth?.role || null,
  }
}

async function ensureUserPreferences(userId) {
  const existingRows = await prisma.$queryRaw`
    SELECT
      user_id,
      theme,
      default_report_range,
      default_fuel_type,
      notify_in_app,
      notify_email,
      completed_welcome_tour,
      favorite_station_public_ids_json,
      updated_at
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `
  if (existingRows?.[0]) return existingRows[0]

  await prisma.$executeRaw`
    INSERT INTO user_preferences (
      user_id,
      theme,
      default_report_range,
      default_fuel_type,
      notify_in_app,
      notify_email,
      completed_welcome_tour,
      favorite_station_public_ids_json
    )
    VALUES (
      ${userId},
      'SYSTEM',
      'LAST_7_DAYS',
      'ALL',
      1,
      0,
      0,
      '[]'
    )
  `

  const createdRows = await prisma.$queryRaw`
    SELECT
      user_id,
      theme,
      default_report_range,
      default_fuel_type,
      notify_in_app,
      notify_email,
      completed_welcome_tour,
      favorite_station_public_ids_json,
      updated_at
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `
  return createdRows?.[0] || null
}

function toPreferencesResponse(row, timeZone = "Africa/Blantyre") {
  if (!row) return null
  return {
    theme: row.theme,
    defaultReportRange: row.default_report_range,
    defaultFuelType: row.default_fuel_type,
    notifyInApp: Boolean(row.notify_in_app),
    notifyEmail: Boolean(row.notify_email),
    completedWelcomeTour: Boolean(row.completed_welcome_tour),
    favoriteStationPublicIds: normalizeFavoriteStationPublicIds(row.favorite_station_public_ids_json),
    updatedAt: serializeDatesForTimeZone(row.updated_at, timeZone),
  }
}

export async function getMyPreferences({ userId }) {
  if (!userId) throw badRequest("Missing authenticated user")
  const row = await ensureUserPreferences(userId)
  return toPreferencesResponse(row)
}

export async function patchMyPreferences({ userId, auth, payload }) {
  if (!userId) throw badRequest("Missing authenticated user")
  const current = await ensureUserPreferences(userId)
  if (!current) throw notFound("User preferences not found")

  const patch = {}
  if (payload.theme !== undefined) patch.theme = payload.theme
  if (payload.defaultReportRange !== undefined) patch.default_report_range = payload.defaultReportRange
  if (payload.defaultFuelType !== undefined) patch.default_fuel_type = payload.defaultFuelType
  if (payload.notifyInApp !== undefined) patch.notify_in_app = payload.notifyInApp
  if (payload.notifyEmail !== undefined) patch.notify_email = payload.notifyEmail
  if (payload.completedWelcomeTour !== undefined) patch.completed_welcome_tour = payload.completedWelcomeTour
  if (payload.favoriteStationPublicIds !== undefined) {
    patch.favorite_station_public_ids_json = JSON.stringify(
      normalizeFavoriteStationPublicIds(payload.favoriteStationPublicIds)
    )
  }

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  await prisma.$executeRawUnsafe(
    `UPDATE user_preferences SET ${fields.join(", ")} WHERE user_id = ?`,
    ...values,
    userId
  )

  if (auth?.stationId) {
    const actorStaffId = await resolveActorStaffId(auth.stationId, userId)
    await writeAuditLog({
      stationId: auth.stationId,
      actorStaffId,
      actionType: "USER_PREFERENCES_UPDATE",
      payload,
    })
  }

  const rows = await prisma.$queryRaw`
    SELECT
      user_id,
      theme,
      default_report_range,
      default_fuel_type,
      notify_in_app,
      notify_email,
      completed_welcome_tour,
      favorite_station_public_ids_json,
      updated_at
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `
  const timeZone = await resolveStationTimeZone(auth?.stationId || null)
  return toPreferencesResponse(rows?.[0] || null, timeZone)
}

export async function exportMyData({ userId, auth }) {
  if (!userId) throw badRequest("Missing authenticated user")
  const timeZone = await resolveStationTimeZone(auth?.stationId || null)
  const [userRows, staffRows, sessionRows, preferences] = await Promise.all([
    prisma.$queryRaw`
      SELECT public_id, full_name, email, phone_e164, created_at, updated_at
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        ss.id,
        ss.is_active,
        sr.code AS role,
        st.public_id AS station_public_id,
        st.name AS station_name,
        ss.created_at,
        ss.updated_at
      FROM station_staff ss
      INNER JOIN staff_roles sr ON sr.id = ss.role_id
      INNER JOIN stations st ON st.id = ss.station_id
      WHERE ss.user_id = ${userId}
      ORDER BY ss.created_at DESC
    `,
    prisma.$queryRaw`
      SELECT
        public_id,
        station_id,
        role_id,
        user_agent,
        ip_address,
        expires_at,
        created_at,
        updated_at
      FROM auth_sessions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `,
    ensureUserPreferences(userId),
  ])

  if (auth?.stationId) {
    const actorStaffId = await resolveActorStaffId(auth.stationId, userId)
    await writeAuditLog({
      stationId: auth.stationId,
      actorStaffId,
      actionType: "USER_DATA_EXPORT",
      payload: { userPublicId: userRows?.[0]?.public_id || null },
    })
  }

  return {
    exportedAt: new Date().toISOString(),
    profile: serializeDatesForTimeZone(userRows?.[0] || null, timeZone),
    stationAssignments: serializeDatesForTimeZone(staffRows || [], timeZone),
    preferences: toPreferencesResponse(preferences, timeZone),
    sessions: serializeDatesForTimeZone(sessionRows || [], timeZone),
  }
}

export async function requestDeleteMyAccount({ userId, auth, payload }) {
  if (!userId) throw badRequest("Missing authenticated user")

  let stationId = auth?.stationId || null
  if (!stationId) {
    const rows = await prisma.$queryRaw`
      SELECT station_id
      FROM station_staff
      WHERE user_id = ${userId}
      ORDER BY id ASC
      LIMIT 1
    `
    stationId = rows?.[0]?.station_id || null
  }

  if (!stationId) throw badRequest("No station assignment found for account deletion request")
  const actorStaffId = await resolveActorStaffId(stationId, userId)
  await writeAuditLog({
    stationId,
    actorStaffId,
    actionType: "USER_DELETE_REQUEST",
    payload: {
      reason: payload?.reason || null,
    },
  })

  return {
    requested: true,
    message: "Account deletion request submitted to support.",
  }
}

export async function patchQueue({ stationPublicId, userId, payload }) {
  const station = await resolveStationOrThrow(stationPublicId)
  const actorStaffId = await resolveActorStaffId(station.id, userId)
  await ensureQueueSettings(station.id)

  const baseQueuePatch = { ...payload }
  const hybridQueuePatch = {
    is_enabled: payload.hybrid_pilot_enabled,
    pilot_pump_public_id: payload.pilot_pump_public_id,
    digital_hold_timeout_seconds: payload.digital_hold_timeout_seconds,
    kiosk_walkin_redirect_message: payload.kiosk_walkin_redirect_message,
  }

  delete baseQueuePatch.hybrid_pilot_enabled
  delete baseQueuePatch.pilot_pump_public_id
  delete baseQueuePatch.digital_hold_timeout_seconds
  delete baseQueuePatch.kiosk_walkin_redirect_message

  const fields = []
  const values = []
  Object.entries(baseQueuePatch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  if (fields.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE station_queue_settings SET ${fields.join(", ")} WHERE station_id = ?`,
      ...values,
      station.id
    )
  }

  if (Object.values(hybridQueuePatch).some((value) => value !== undefined)) {
    await patchStationHybridQueueSettings({
      stationId: station.id,
      payload: hybridQueuePatch,
      actorStaffId,
    })
  }

  await writeAuditLog({
    stationId: station.id,
    actorStaffId,
    actionType: "SETTINGS_QUEUE_UPDATE",
    payload,
  })

  const [rows, hybridRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT *
      FROM station_queue_settings
      WHERE station_id = ${station.id}
      LIMIT 1
    `,
    getStationHybridQueueSettings(station.id),
  ])
  return {
    ...(rows?.[0] || null),
    hybrid_pilot_enabled: Boolean(Number(hybridRows?.is_enabled || 0)),
    pilot_pump_public_id: hybridRows?.pilot_pump_public_id || null,
    digital_hold_timeout_seconds:
      Number(hybridRows?.digital_hold_timeout_seconds || 0) || null,
    kiosk_walkin_redirect_message:
      hybridRows?.kiosk_walkin_redirect_message || null,
  }
}

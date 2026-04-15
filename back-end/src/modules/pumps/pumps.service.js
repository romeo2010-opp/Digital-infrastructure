import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId, writeAuditLog } from "../common/db.js"

const NOZZLE_STATUS_VALUES = new Set(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"])
const NUMERIC_DATA_TYPES = new Set([
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
  "decimal",
  "numeric",
  "float",
  "double",
  "real",
  "bit",
])

let nozzleSideColumnMetaPromise = null

function formatOrdinalId(value) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw badRequest("Pump and nozzle numbers must be positive integers")
  }
  return String(numeric).padStart(2, "0")
}

export function buildPumpPublicId(stationPublicId, pumpNumber) {
  const stationId = String(stationPublicId || "").trim()
  if (!stationId) throw badRequest("stationPublicId is required for pump id generation")
  return `${stationId}-P${formatOrdinalId(pumpNumber)}`
}

export function buildPumpQrPayload(stationPublicId, pumpPublicId) {
  const normalizedStationPublicId = String(stationPublicId || "").trim()
  const normalizedPumpPublicId = String(pumpPublicId || "").trim()
  if (!normalizedStationPublicId) throw badRequest("stationPublicId is required for pump QR generation")
  if (!normalizedPumpPublicId) throw badRequest("pumpPublicId is required for pump QR generation")
  return `smartlink:pump:${normalizedStationPublicId}:${normalizedPumpPublicId}`
}

export async function renderPumpQrPngDataUrl(stationPublicId, pumpPublicId) {
  try {
    const qrModule = await import("qrcode")
    const qrEncoder = qrModule?.toDataURL ? qrModule : qrModule?.default
    if (!qrEncoder?.toDataURL) return null
    return qrEncoder.toDataURL(buildPumpQrPayload(stationPublicId, pumpPublicId), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: {
        dark: "#111111",
        light: "#FFFFFF",
      },
    })
  } catch {
    return null
  }
}

export function buildNozzlePublicId(pumpPublicId, nozzleNumber) {
  const basePumpPublicId = String(pumpPublicId || "").trim()
  if (!basePumpPublicId) throw badRequest("pumpPublicId is required for nozzle id generation")
  return `${basePumpPublicId}-N${formatOrdinalId(nozzleNumber)}`
}

function canDeriveNozzlePublicIdFromNumber(value) {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized)) return false
  const numeric = Number(normalized)
  return Number.isInteger(numeric) && numeric > 0
}

function createNozzlePublicId(pumpPublicId, nozzleNumber) {
  if (canDeriveNozzlePublicIdFromNumber(nozzleNumber)) {
    return buildNozzlePublicId(pumpPublicId, nozzleNumber)
  }
  return createPublicId()
}

async function getStationPublicId(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM stations
    WHERE id = ${stationId}
    LIMIT 1
  `
  const stationPublicId = rows?.[0]?.public_id
  if (!stationPublicId) throw notFound(`Station not found: ${stationId}`)
  return stationPublicId
}

function normalizeSideIntent(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (!normalized) return null
  if (["A", "LEFT", "L", "1", "SIDE_A"].includes(normalized)) return "A"
  if (["B", "RIGHT", "R", "2", "SIDE_B"].includes(normalized)) return "B"
  return normalized
}

function parseEnumOptions(columnType) {
  const text = String(columnType || "")
  if (!text.toLowerCase().startsWith("enum(") || !text.endsWith(")")) return []
  const body = text.slice(text.indexOf("(") + 1, -1)
  return body
    .split(",")
    .map((item) => item.trim().replace(/^'/, "").replace(/'$/, "").replace(/\\'/g, "'"))
    .filter(Boolean)
}

async function getNozzleSideColumnMeta() {
  if (!nozzleSideColumnMetaPromise) {
    nozzleSideColumnMetaPromise = prisma.$queryRaw`
      SELECT
        DATA_TYPE AS data_type,
        COLUMN_TYPE AS column_type,
        CHARACTER_MAXIMUM_LENGTH AS max_len,
        IS_NULLABLE AS is_nullable
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pump_nozzles'
        AND COLUMN_NAME = 'side'
      LIMIT 1
    `
      .then((rows) => rows?.[0] || null)
      .catch(() => null)
  }
  return nozzleSideColumnMetaPromise
}

async function normalizeNozzleSideForStorage(value) {
  if (value === null || value === undefined || value === "") return null
  const original = String(value).trim()
  const intent = normalizeSideIntent(original)
  if (!intent) return null

  const meta = await getNozzleSideColumnMeta()
  if (!meta) return intent === "A" || intent === "B" ? intent : original.toUpperCase()

  const dataType = String(meta.data_type || "").toLowerCase()
  const maxLen = Number.isFinite(Number(meta.max_len)) ? Number(meta.max_len) : null

  if (dataType === "enum") {
    const options = parseEnumOptions(meta.column_type)
    if (!options.length) return intent === "A" || intent === "B" ? intent : original.toUpperCase()

    const candidates =
      intent === "A"
        ? ["A", "LEFT", "L", "1", "SIDE_A"]
        : intent === "B"
          ? ["B", "RIGHT", "R", "2", "SIDE_B"]
          : [intent]

    for (const candidate of candidates) {
      const match = options.find((option) => String(option).toUpperCase() === candidate)
      if (match) return match
    }
    throw badRequest(`Unsupported nozzle side '${original}' for current database schema`)
  }

  if (NUMERIC_DATA_TYPES.has(dataType)) {
    if (intent === "A") return 1
    if (intent === "B") return 2
    const numeric = Number(intent)
    if (Number.isFinite(numeric)) return numeric
    throw badRequest(`Unsupported nozzle side '${original}' for numeric side column`)
  }

  const asText = intent === "A" || intent === "B" ? intent : original.toUpperCase()
  if (maxLen && asText.length > maxLen) {
    throw badRequest(`Nozzle side '${original}' exceeds max length ${maxLen}`)
  }
  return asText
}

function inferDefaultNozzleSide(nozzleNumber) {
  const normalized = String(nozzleNumber ?? "").trim()
  if (/^\d+$/.test(normalized)) {
    return Number(normalized) % 2 === 0 ? "B" : "A"
  }
  return "A"
}

async function resolveCreateNozzleSide({ side, nozzleNumber }) {
  if (side !== null && side !== undefined && side !== "") {
    return normalizeNozzleSideForStorage(side)
  }
  return normalizeNozzleSideForStorage(inferDefaultNozzleSide(nozzleNumber))
}

function normalizeNozzleStatus(status, fallback = "ACTIVE") {
  const normalized = String(status || "").trim().toUpperCase()
  return NOZZLE_STATUS_VALUES.has(normalized) ? normalized : fallback
}

function normalizePumpStatus(status, fallback = "ACTIVE") {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "ACTIVE" || normalized === "PAUSED" || normalized === "OFFLINE" || normalized === "IDLE") return normalized
  return fallback
}

function normalizeNozzleNumberInput(value) {
  const normalized = String(value ?? "").trim()
  if (!normalized) {
    throw badRequest("nozzle_number/nozzleNumber must be a non-empty string")
  }
  return normalized
}

function toNozzleNumberOutput(value) {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

export function derivePumpStatusFromNozzles(nozzles = [], fallbackStatus = "ACTIVE") {
  const normalizedFallback = normalizePumpStatus(fallbackStatus, "OFFLINE")
  if (normalizedFallback === "OFFLINE" || normalizedFallback === "PAUSED" || normalizedFallback === "IDLE") {
    return normalizedFallback
  }

  if (!Array.isArray(nozzles) || nozzles.length === 0) {
    return normalizedFallback === "PAUSED" ? "PAUSED" : "OFFLINE"
  }

  const statuses = nozzles.map((item) => normalizeNozzleStatus(item?.status, "ACTIVE"))
  if (statuses.some((status) => status === "DISPENSING")) return "DISPENSING"

  const offlineCount = statuses.filter((status) => status === "OFFLINE").length
  if (offlineCount === statuses.length) return "OFFLINE"
  if (offlineCount > 0) return "DEGRADED"

  const pausedCount = statuses.filter((status) => status === "PAUSED").length
  if (pausedCount === statuses.length) return "PAUSED"
  if (pausedCount > 0) return "DEGRADED"

  return "ACTIVE"
}

async function getFuelTypeByCodeOrId(value) {
  if (value === null || value === undefined || value === "") return null
  const normalizedCode = String(value).trim().toUpperCase()
  const numericId = Number(value)

  const rows = await prisma.$queryRaw`
    SELECT id, code, name
    FROM fuel_types
    WHERE code = ${normalizedCode}
       OR id = ${Number.isFinite(numericId) ? numericId : -1}
    ORDER BY code = ${normalizedCode} DESC
    LIMIT 1
  `

  return rows?.[0] || null
}

async function getTankByPublicIdOrId(stationId, value) {
  if (value === null || value === undefined || value === "") return null
  const numericId = Number(value)
  const normalizedPublicId = String(value).trim()
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, fuel_type_id, name
    FROM tanks
    WHERE station_id = ${stationId}
      AND (
        public_id = ${normalizedPublicId}
        OR id = ${Number.isFinite(numericId) ? numericId : -1}
      )
    LIMIT 1
  `
  return rows?.[0] || null
}

async function validateNozzleFuelTank({ stationId, fuelTypeId, tankId = null }) {
  if (!fuelTypeId) throw badRequest("Nozzle fuel type is required")
  if (!tankId) return null

  const rows = await prisma.$queryRaw`
    SELECT id, fuel_type_id
    FROM tanks
    WHERE station_id = ${stationId}
      AND id = ${tankId}
    LIMIT 1
  `
  const tank = rows?.[0]
  if (!tank) throw badRequest("Tank not found for nozzle mapping")
  if (Number(tank.fuel_type_id) !== Number(fuelTypeId)) {
    throw badRequest("Tank fuel type must match nozzle fuel type")
  }
  return tank
}

export async function resolvePumpByPublicId(stationId, pumpPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, station_id, public_id, pump_number, fuel_type_id, tank_id, status, status_reason, is_active
    FROM pumps
    WHERE station_id = ${stationId}
      AND public_id = ${pumpPublicId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function ensureUniquePumpNumber(stationId, pumpNumber, ignorePumpId = null) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM pumps
    WHERE station_id = ${stationId}
      AND pump_number = ${pumpNumber}
      AND (${ignorePumpId} IS NULL OR id <> ${ignorePumpId})
    LIMIT 1
  `
  if (rows?.[0]) {
    throw badRequest(`Pump number ${pumpNumber} already exists for this station`)
  }
}

async function ensureUniqueNozzleNumber(stationId, pumpId, nozzleNumber, ignoreNozzleId = null) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND pump_id = ${pumpId}
      AND nozzle_number = ${nozzleNumber}
      AND (${ignoreNozzleId} IS NULL OR id <> ${ignoreNozzleId})
    LIMIT 1
  `
  if (rows?.[0]) {
    throw badRequest(`Nozzle number ${nozzleNumber} already exists for this pump`)
  }
}

function toNozzleDisplay(row) {
  return {
    public_id: row.public_id,
    nozzle_number: toNozzleNumberOutput(row.nozzle_number),
    side: row.side || null,
    status: normalizeNozzleStatus(row.status, "ACTIVE"),
    hardware_channel: row.hardware_channel || null,
    is_active: Boolean(Number(row.is_active ?? 1)),
    fuel_code: row.fuel_code || null,
    fuel_name: row.fuel_name || null,
    tank_public_id: row.tank_public_id || null,
    tank_name: row.tank_name || null,
  }
}

async function listNozzlesForPump(stationId, pumpId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.nozzle_number,
      pn.side,
      pn.status,
      pn.hardware_channel,
      pn.is_active,
      ft.code AS fuel_code,
      ft.name AS fuel_name,
      t.public_id AS tank_public_id,
      t.name AS tank_name
    FROM pump_nozzles pn
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    LEFT JOIN tanks t ON t.id = pn.tank_id
    WHERE pn.station_id = ${stationId}
      AND pn.pump_id = ${pumpId}
    ORDER BY pn.nozzle_number ASC
  `
  return (rows || []).map(toNozzleDisplay)
}

export async function ensurePrimaryNozzleForPump(stationId, pumpId) {
  const existingRows = await prisma.$queryRaw`
    SELECT id
    FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND pump_id = ${pumpId}
    LIMIT 1
  `
  if (existingRows?.[0]?.id) return existingRows[0]

  const pumpRows = await prisma.$queryRaw`
    SELECT p.id, p.public_id, p.pump_number, p.fuel_type_id, p.tank_id, p.status, t.fuel_type_id AS tank_fuel_type_id
    FROM pumps p
    LEFT JOIN tanks t ON t.id = p.tank_id
    WHERE p.station_id = ${stationId}
      AND p.id = ${pumpId}
    LIMIT 1
  `
  const pump = pumpRows?.[0]
  if (!pump) return null

  const derivedFuelTypeId = Number(pump.fuel_type_id || pump.tank_fuel_type_id || 0)
  if (!derivedFuelTypeId) return null

  const tankId = pump.tank_id ? Number(pump.tank_id) : null
  if (tankId) {
    await validateNozzleFuelTank({ stationId, fuelTypeId: derivedFuelTypeId, tankId })
  }

  const normalizedSide = await normalizeNozzleSideForStorage("A")

  await prisma.$executeRaw`
    INSERT INTO pump_nozzles (
      station_id, pump_id, public_id, nozzle_number, side, fuel_type_id, tank_id, status, hardware_channel, is_active
    )
    VALUES (
      ${stationId},
      ${pump.id},
      ${createNozzlePublicId(pump.public_id, 1)},
      ${"1"},
      ${normalizedSide},
      ${derivedFuelTypeId},
      ${tankId},
      ${normalizeNozzleStatus(pump.status, "ACTIVE")},
      ${`legacy-${pump.pump_number || pump.id}-1`},
      ${true}
    )
  `

  return { created: true }
}

export async function ensureStationLegacyNozzles(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT p.id
    FROM pumps p
    LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id
    WHERE p.station_id = ${stationId}
    GROUP BY p.id
    HAVING COUNT(pn.id) = 0
  `

  for (const row of rows || []) {
    await ensurePrimaryNozzleForPump(stationId, Number(row.id))
  }
}

function buildPumpWarnings(pump, nozzles) {
  const warnings = []
  if (!nozzles.length) warnings.push("No nozzles configured")
  for (const nozzle of nozzles) {
    if (!nozzle.fuel_code) warnings.push(`Nozzle #${nozzle.nozzle_number} has no fuel type`)
    if (!nozzle.tank_public_id) warnings.push(`Nozzle #${nozzle.nozzle_number} has no tank mapping`)
  }
  return warnings
}

export async function listStationPumpsWithNozzles(stationId, { includeInactive = true } = {}) {
  const pumpRows = await prisma.$queryRaw`
    SELECT
      p.id,
      p.public_id,
      p.pump_number,
      p.status,
      p.status_reason,
      p.is_active,
      st.public_id AS station_public_id,
      ft.code AS legacy_fuel_code,
      t.public_id AS legacy_tank_public_id
    FROM pumps p
    INNER JOIN stations st ON st.id = p.station_id
    LEFT JOIN fuel_types ft ON ft.id = p.fuel_type_id
    LEFT JOIN tanks t ON t.id = p.tank_id
    WHERE p.station_id = ${stationId}
      AND (${includeInactive ? null : 1} IS NULL OR p.is_active = 1)
    ORDER BY p.pump_number ASC, p.id ASC
  `

  const results = []
  for (const pump of pumpRows || []) {
    const nozzles = await listNozzlesForPump(stationId, Number(pump.id))
    const normalizedStoredStatus = normalizePumpStatus(pump.status)
    const nozzlelessStoredStatus = normalizedStoredStatus === "PAUSED" ? "PAUSED" : "OFFLINE"
    if (!nozzles.length && normalizedStoredStatus !== nozzlelessStoredStatus) {
      await prisma.$executeRaw`
        UPDATE pumps
        SET status = ${nozzlelessStoredStatus}
        WHERE id = ${pump.id}
      `
      pump.status = nozzlelessStoredStatus
    }
    const derivedStatus = derivePumpStatusFromNozzles(nozzles, pump.status)
    const fuelCodes = [...new Set(nozzles.map((item) => item.fuel_code).filter(Boolean))]
    const warnings = buildPumpWarnings(pump, nozzles)
    results.push({
      public_id: pump.public_id,
      pump_number: Number(pump.pump_number),
      status: derivedStatus,
      status_reason: pump.status_reason || "",
      is_active: Boolean(Number(pump.is_active ?? 1)),
      qr_payload: buildPumpQrPayload(pump.station_public_id, pump.public_id),
      nozzle_count: nozzles.length,
      fuel_codes: fuelCodes,
      legacy_fuel_code: pump.legacy_fuel_code || null,
      legacy_tank_public_id: pump.legacy_tank_public_id || null,
      warnings,
      nozzles,
    })
  }
  return results
}

export async function getPumpWithNozzlesByPublicId(stationId, pumpPublicId) {
  const rows = await listStationPumpsWithNozzles(stationId, { includeInactive: true })
  const pump = rows.find((item) => item.public_id === pumpPublicId)
  if (!pump) throw notFound(`Pump not found: ${pumpPublicId}`)
  return pump
}

async function resolveNozzleCreateInput(stationId, payload) {
  const fuel = await getFuelTypeByCodeOrId(payload.fuelType || payload.fuel_type_id)
  if (!fuel?.id) throw badRequest("Nozzle fuel_type_id/fuelType is required")

  const tank = payload.tankPublicId || payload.tank_id
    ? await getTankByPublicIdOrId(stationId, payload.tankPublicId || payload.tank_id)
    : null
  if ((payload.tankPublicId || payload.tank_id) && !tank?.id) {
    throw badRequest("Tank not found for nozzle mapping")
  }
  if (tank?.id) {
    await validateNozzleFuelTank({ stationId, fuelTypeId: fuel.id, tankId: tank.id })
  }

  const nozzleNumber = normalizeNozzleNumberInput(payload.nozzleNumber ?? payload.nozzle_number)

  return {
    nozzleNumber,
    side: payload.side,
    fuelTypeId: Number(fuel.id),
    tankId: tank?.id ? Number(tank.id) : null,
    status: normalizeNozzleStatus(payload.status, "ACTIVE"),
    hardwareChannel: payload.hardwareChannel || payload.hardware_channel || null,
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
  }
}

export async function createNozzleForPump({
  stationId,
  pumpPublicId,
  payload,
  actorStaffId = null,
  auditActionType = null,
}) {
  const pump = await resolvePumpByPublicId(stationId, pumpPublicId)
  if (!pump) throw notFound(`Pump not found: ${pumpPublicId}`)
  const input = await resolveNozzleCreateInput(stationId, payload)
  input.side = await resolveCreateNozzleSide({
    side: input.side,
    nozzleNumber: input.nozzleNumber,
  })
  await ensureUniqueNozzleNumber(stationId, pump.id, input.nozzleNumber)

  const nozzlePublicId = createNozzlePublicId(pump.public_id, input.nozzleNumber)
  await prisma.$executeRaw`
    INSERT INTO pump_nozzles (
      station_id, pump_id, public_id, nozzle_number, side, fuel_type_id, tank_id, status, hardware_channel, is_active
    )
    VALUES (
      ${stationId},
      ${pump.id},
      ${nozzlePublicId},
      ${input.nozzleNumber},
      ${input.side},
      ${input.fuelTypeId},
      ${input.tankId},
      ${input.status},
      ${input.hardwareChannel},
      ${input.isActive}
    )
  `

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: { pumpPublicId, ...payload, nozzlePublicId },
    })
  }

  return getNozzleByPublicId(stationId, nozzlePublicId)
}

export async function getNozzleByPublicId(stationId, nozzlePublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.nozzle_number,
      pn.side,
      pn.status,
      pn.hardware_channel,
      pn.is_active,
      p.public_id AS pump_public_id,
      p.pump_number,
      ft.code AS fuel_code,
      t.public_id AS tank_public_id,
      t.name AS tank_name
    FROM pump_nozzles pn
    INNER JOIN pumps p ON p.id = pn.pump_id
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    LEFT JOIN tanks t ON t.id = pn.tank_id
    WHERE pn.station_id = ${stationId}
      AND pn.public_id = ${nozzlePublicId}
    LIMIT 1
  `
  const nozzle = rows?.[0]
  if (!nozzle) throw notFound(`Nozzle not found: ${nozzlePublicId}`)
  return {
    public_id: nozzle.public_id,
    nozzle_number: toNozzleNumberOutput(nozzle.nozzle_number),
    side: nozzle.side || null,
    status: normalizeNozzleStatus(nozzle.status, "ACTIVE"),
    hardware_channel: nozzle.hardware_channel || null,
    is_active: Boolean(Number(nozzle.is_active ?? 1)),
    pump_public_id: nozzle.pump_public_id,
    pump_number: Number(nozzle.pump_number),
    fuel_code: nozzle.fuel_code || null,
    tank_public_id: nozzle.tank_public_id || null,
    tank_name: nozzle.tank_name || null,
  }
}

export async function patchNozzleByPublicId({
  stationId,
  nozzlePublicId,
  payload,
  actorStaffId = null,
  auditActionType = null,
}) {
  const existingRows = await prisma.$queryRaw`
    SELECT id, pump_id, fuel_type_id, tank_id, nozzle_number
    FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND public_id = ${nozzlePublicId}
    LIMIT 1
  `
  const nozzle = existingRows?.[0]
  if (!nozzle) throw notFound(`Nozzle not found: ${nozzlePublicId}`)

  let fuelTypeId = Number(nozzle.fuel_type_id || 0)
  if (payload.fuelType !== undefined || payload.fuel_type_id !== undefined) {
    const fuel = await getFuelTypeByCodeOrId(payload.fuelType ?? payload.fuel_type_id)
    if (!fuel?.id) throw badRequest("Nozzle fuel_type_id/fuelType is required")
    fuelTypeId = Number(fuel.id)
  }

  let tankId = payload.tankPublicId === null || payload.tank_id === null
    ? null
    : nozzle.tank_id ? Number(nozzle.tank_id) : null

  if (payload.tankPublicId !== undefined || payload.tank_id !== undefined) {
    if (payload.tankPublicId || payload.tank_id) {
      const tank = await getTankByPublicIdOrId(stationId, payload.tankPublicId || payload.tank_id)
      if (!tank?.id) throw badRequest("Tank not found for nozzle mapping")
      tankId = Number(tank.id)
    } else {
      tankId = null
    }
  }

  if (tankId) {
    await validateNozzleFuelTank({ stationId, fuelTypeId, tankId })
  }

  const patch = {}
  if (payload.nozzleNumber !== undefined || payload.nozzle_number !== undefined) {
    const nextNozzleNumber = normalizeNozzleNumberInput(payload.nozzleNumber ?? payload.nozzle_number)
    const currentNozzleNumber = normalizeNozzleNumberInput(nozzle.nozzle_number)
    if (nextNozzleNumber !== currentNozzleNumber) {
      await ensureUniqueNozzleNumber(stationId, nozzle.pump_id, nextNozzleNumber, nozzle.id)
      patch.nozzle_number = nextNozzleNumber
    }
  }
  if (payload.side !== undefined) patch.side = await normalizeNozzleSideForStorage(payload.side)
  if (payload.status !== undefined) patch.status = normalizeNozzleStatus(payload.status)
  if (payload.hardwareChannel !== undefined || payload.hardware_channel !== undefined) {
    patch.hardware_channel = payload.hardwareChannel ?? payload.hardware_channel ?? null
  }
  if (payload.isActive !== undefined) patch.is_active = Boolean(payload.isActive)
  if (payload.fuelType !== undefined || payload.fuel_type_id !== undefined) patch.fuel_type_id = fuelTypeId
  if (payload.tankPublicId !== undefined || payload.tank_id !== undefined) patch.tank_id = tankId

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })

  if (!fields.length) throw badRequest("At least one nozzle field is required")

  await prisma.$executeRawUnsafe(
    `UPDATE pump_nozzles SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
    nozzle.id
  )

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: { nozzlePublicId, ...payload },
    })
  }

  return getNozzleByPublicId(stationId, nozzlePublicId)
}

export async function deleteNozzleByPublicId({
  stationId,
  nozzlePublicId,
  actorStaffId = null,
  auditActionType = null,
}) {
  const nozzleRows = await prisma.$queryRaw`
    SELECT id, pump_id, nozzle_number
    FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND public_id = ${nozzlePublicId}
    LIMIT 1
  `
  const nozzle = nozzleRows?.[0]
  if (!nozzle) throw notFound(`Nozzle not found: ${nozzlePublicId}`)

  const siblingRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS nozzle_count
    FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND pump_id = ${nozzle.pump_id}
  `
  const nozzleCount = Number(siblingRows?.[0]?.nozzle_count || 0)
  if (nozzleCount <= 1) {
    throw badRequest("Cannot delete the last nozzle on a pump. Delete the pump or add another nozzle first.")
  }

  const txCountRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM transactions
    WHERE station_id = ${stationId}
      AND nozzle_id = ${nozzle.id}
  `
  const dispenseCountRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM pump_dispense_events
    WHERE station_id = ${stationId}
      AND nozzle_id = ${nozzle.id}
  `
  const txCount = Number(txCountRows?.[0]?.count || 0)
  const dispenseCount = Number(dispenseCountRows?.[0]?.count || 0)
  if (txCount > 0 || dispenseCount > 0) {
    throw badRequest("Cannot delete nozzle with historical activity. Set it inactive instead.")
  }

  await prisma.$executeRaw`
    DELETE FROM pump_nozzles
    WHERE id = ${nozzle.id}
  `

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: {
        nozzlePublicId,
        nozzleNumber: toNozzleNumberOutput(nozzle.nozzle_number),
      },
    })
  }

  return { deleted: true, nozzlePublicId }
}

function buildQuickSetupNozzles(quickSetup) {
  const normalized = String(quickSetup || "").toUpperCase()
  if (normalized === "MALAWI_2_NOZZLES") {
    return [
      { nozzleNumber: "1", side: "A", fuelType: "PETROL" },
      { nozzleNumber: "2", side: "B", fuelType: "DIESEL" },
    ]
  }
  if (normalized === "MALAWI_4_NOZZLES") {
    return [
      { nozzleNumber: "1", side: "A", fuelType: "PETROL" },
      { nozzleNumber: "2", side: "A", fuelType: "PETROL" },
      { nozzleNumber: "3", side: "B", fuelType: "DIESEL" },
      { nozzleNumber: "4", side: "B", fuelType: "DIESEL" },
    ]
  }
  return []
}

export async function createPumpGroup({
  stationId,
  payload,
  actorStaffId = null,
  auditActionType = null,
}) {
  await ensureUniquePumpNumber(stationId, Number(payload.pumpNumber))
  const stationPublicId = await getStationPublicId(stationId)
  const pumpPublicId = buildPumpPublicId(stationPublicId, Number(payload.pumpNumber))
  const legacyFuel = payload.fuelType ? await getFuelTypeByCodeOrId(payload.fuelType) : null
  const legacyTank = payload.tankPublicId ? await getTankByPublicIdOrId(stationId, payload.tankPublicId) : null

  await prisma.$executeRaw`
    INSERT INTO pumps (
      station_id, public_id, pump_number, fuel_type_id, tank_id, status, status_reason, is_active
    )
    VALUES (
      ${stationId},
      ${pumpPublicId},
      ${Number(payload.pumpNumber)},
      ${legacyFuel?.id || null},
      ${legacyTank?.id || null},
      ${normalizePumpStatus(payload.status, "ACTIVE")},
      ${payload.statusReason || null},
      ${payload.isActive === undefined ? true : Boolean(payload.isActive)}
    )
  `

  const pump = await resolvePumpByPublicId(stationId, pumpPublicId)
  if (!pump) throw badRequest("Failed to create pump")

  const quickSetupNozzles = buildQuickSetupNozzles(payload.quickSetup)
  const explicitNozzles = Array.isArray(payload.nozzles) ? payload.nozzles : []
  const legacyNozzle =
    payload.fuelType && explicitNozzles.length === 0 && quickSetupNozzles.length === 0
      ? [{
          nozzleNumber: "1",
          side: "A",
          fuelType: payload.fuelType,
          tankPublicId: payload.tankPublicId || null,
          status: payload.status || "ACTIVE",
        }]
      : []
  const nozzlesToCreate = explicitNozzles.length ? explicitNozzles : [...quickSetupNozzles, ...legacyNozzle]

  for (const nozzlePayload of nozzlesToCreate) {
    await createNozzleForPump({
      stationId,
      pumpPublicId,
      payload: nozzlePayload,
    })
  }

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: { ...payload, pumpPublicId },
    })
  }

  return getPumpWithNozzlesByPublicId(stationId, pumpPublicId)
}

export async function patchPumpGroup({
  stationId,
  pumpPublicId,
  payload,
  actorStaffId = null,
  auditActionType = null,
}) {
  const pump = await resolvePumpByPublicId(stationId, pumpPublicId)
  if (!pump) throw notFound(`Pump not found: ${pumpPublicId}`)

  const patch = {}
  let nextPumpPublicId = pumpPublicId
  if (payload.pumpNumber !== undefined) {
    const nextPumpNumber = Number(payload.pumpNumber)
    const currentPumpNumber = Number(pump.pump_number)
    if (nextPumpNumber !== currentPumpNumber) {
      await ensureUniquePumpNumber(stationId, nextPumpNumber, pump.id)
      patch.pump_number = nextPumpNumber
      nextPumpPublicId = buildPumpPublicId(await getStationPublicId(stationId), nextPumpNumber)
      patch.public_id = nextPumpPublicId
    }
  }
  if (payload.status !== undefined) {
    const nextStatus = normalizePumpStatus(payload.status)
    const currentStatus = normalizePumpStatus(pump.status)
    if (nextStatus !== currentStatus) {
      const nozzles = await listNozzlesForPump(stationId, Number(pump.id))
      if (!nozzles.length) {
        throw badRequest("Cannot change pump status: no nozzles are configured for this pump.")
      }
    }
    patch.status = nextStatus
  }
  if (payload.statusReason !== undefined) patch.status_reason = payload.statusReason || null
  if (payload.isActive !== undefined) patch.is_active = Boolean(payload.isActive)

  if (payload.fuelType !== undefined) {
    const fuel = payload.fuelType ? await getFuelTypeByCodeOrId(payload.fuelType) : null
    patch.fuel_type_id = fuel?.id || null
  }
  if (payload.tankPublicId !== undefined) {
    if (payload.tankPublicId === null || payload.tankPublicId === "") {
      patch.tank_id = null
    } else {
      const tank = await getTankByPublicIdOrId(stationId, payload.tankPublicId)
      if (!tank?.id) throw badRequest("Tank not found for pump")
      patch.tank_id = Number(tank.id)
    }
  }

  const fields = []
  const values = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    values.push(value)
  })
  if (!fields.length) throw badRequest("At least one pump field is required")

  await prisma.$executeRawUnsafe(
    `UPDATE pumps SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
    pump.id
  )

  if (payload.status !== undefined) {
    await prisma.$executeRaw`
      UPDATE pump_nozzles
      SET status = ${normalizeNozzleStatus(payload.status)}
      WHERE station_id = ${stationId}
        AND pump_id = ${pump.id}
    `
  }

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: { pumpPublicId, ...payload },
    })
  }

  return getPumpWithNozzlesByPublicId(stationId, nextPumpPublicId)
}

export async function deletePumpGroup({
  stationId,
  pumpPublicId,
  actorStaffId = null,
  auditActionType = null,
}) {
  const pump = await resolvePumpByPublicId(stationId, pumpPublicId)
  if (!pump) throw notFound(`Pump not found: ${pumpPublicId}`)

  const transactionCountRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM transactions
    WHERE station_id = ${stationId}
      AND (
        pump_id = ${pump.id}
        OR nozzle_id IN (
          SELECT id FROM pump_nozzles WHERE station_id = ${stationId} AND pump_id = ${pump.id}
        )
      )
  `
  const dispenseCountRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM pump_dispense_events
    WHERE station_id = ${stationId}
      AND (
        pump_id = ${pump.id}
        OR nozzle_id IN (
          SELECT id FROM pump_nozzles WHERE station_id = ${stationId} AND pump_id = ${pump.id}
        )
      )
  `
  const transactionCount = Number(transactionCountRows?.[0]?.count || 0)
  const dispenseCount = Number(dispenseCountRows?.[0]?.count || 0)
  if (transactionCount > 0 || dispenseCount > 0) {
    throw badRequest("Cannot delete pump with historical activity. Set it inactive instead.")
  }

  await prisma.$executeRaw`
    DELETE FROM pump_nozzles
    WHERE station_id = ${stationId}
      AND pump_id = ${pump.id}
  `
  await prisma.$executeRaw`
    DELETE FROM pumps
    WHERE id = ${pump.id}
  `

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: { pumpPublicId, pumpNumber: Number(pump.pump_number) },
    })
  }

  return { deleted: true, pumpPublicId }
}

export async function resolveNozzleForTransaction({
  stationId,
  nozzlePublicId = null,
  pumpPublicId = null,
}) {
  if (!nozzlePublicId) throw badRequest("nozzlePublicId is required for transactions")

  const rows = await prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.pump_id,
      pn.nozzle_number,
      pn.side,
      pn.status,
      pn.fuel_type_id,
      pn.tank_id,
      p.public_id AS pump_public_id,
      p.pump_number,
      ft.code AS fuel_code
    FROM pump_nozzles pn
    INNER JOIN pumps p ON p.id = pn.pump_id
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    WHERE pn.station_id = ${stationId}
      AND pn.public_id = ${nozzlePublicId}
    LIMIT 1
  `
  const nozzle = rows?.[0]
  if (!nozzle) throw notFound(`Nozzle not found: ${nozzlePublicId}`)
  if (pumpPublicId && nozzle.pump_public_id !== pumpPublicId) {
    throw badRequest("Nozzle does not belong to supplied pump")
  }

  return { nozzle }
}

export async function findAvailableNozzleForFuelType(stationId, fuelTypeId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.pump_id,
      pn.nozzle_number,
      pn.side,
      pn.status,
      pn.fuel_type_id,
      pn.tank_id,
      p.public_id AS pump_public_id,
      p.pump_number,
      ft.code AS fuel_code
    FROM pump_nozzles pn
    INNER JOIN pumps p ON p.id = pn.pump_id
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    WHERE pn.station_id = ${stationId}
      AND pn.fuel_type_id = ${fuelTypeId}
      AND p.is_active = 1
      AND pn.is_active = 1
      AND p.status <> 'OFFLINE'
      AND pn.status IN ('ACTIVE', 'DISPENSING')
    ORDER BY p.pump_number ASC, pn.nozzle_number ASC
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function runNozzleIntegrityCheck(stationId = null) {
  const pumpsWithoutNozzles = stationId
    ? await prisma.$queryRaw`
        SELECT p.station_id, p.public_id AS pump_public_id, p.pump_number
        FROM pumps p
        LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id
        WHERE p.station_id = ${stationId}
        GROUP BY p.id, p.station_id, p.public_id, p.pump_number
        HAVING COUNT(pn.id) = 0
      `
    : await prisma.$queryRaw`
        SELECT p.station_id, p.public_id AS pump_public_id, p.pump_number
        FROM pumps p
        LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id
        GROUP BY p.id, p.station_id, p.public_id, p.pump_number
        HAVING COUNT(pn.id) = 0
      `

  const nozzlesWithoutTank = await prisma.$queryRaw`
    SELECT
      pn.station_id,
      p.public_id AS pump_public_id,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number
    FROM pump_nozzles pn
    INNER JOIN pumps p ON p.id = pn.pump_id
    WHERE (${stationId} IS NULL OR pn.station_id = ${stationId})
      AND pn.tank_id IS NULL
  `

  const missingNozzleTxRows = await prisma.$queryRaw`
    SELECT id, station_id, pump_id
    FROM transactions
    WHERE (${stationId} IS NULL OR station_id = ${stationId})
      AND pump_id IS NOT NULL
      AND nozzle_id IS NULL
    ORDER BY id ASC
    LIMIT 5000
  `

  return {
    pumpsWithoutNozzles,
    nozzlesWithoutTank,
    missingNozzleTransactions: (missingNozzleTxRows || []).length,
    backfilledTransactions: 0,
  }
}

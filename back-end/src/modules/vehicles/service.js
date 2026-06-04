import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"
import { writeOperationalAudit } from "../common/operationalAudit.js"

export const VEHICLE_TYPES = Object.freeze([
  "SEDAN",
  "HATCHBACK",
  "SUV",
  "PICKUP",
  "MINIBUS",
  "TRUCK",
  "MOTORCYCLE",
  "OTHER",
])

export const VEHICLE_USAGE_TYPES = Object.freeze([
  "PRIVATE",
  "TAXI",
  "FLEET",
  "COMPANY",
  "PUBLIC_TRANSPORT",
  "OTHER",
])

export const VEHICLE_FUEL_TYPES = Object.freeze(["PETROL", "DIESEL", "PARAFFIN_KEROSENE", "OTHER"])
export const TANK_SIDES = Object.freeze(["DRIVER_SIDE", "PASSENGER_SIDE", "UNKNOWN", "BOTH_OR_CENTER"])
export const TANK_SIDE_SOURCES = Object.freeze([
  "USER_CONFIRMED",
  "SYSTEM_SUGGESTED",
  "ATTENDANT_CONFIRMED",
  "FLEET_MANAGER_CONFIRMED",
])
export const TANK_SIDE_CONFIDENCES = Object.freeze(["LOW", "MEDIUM", "HIGH", "VERIFIED"])

function toId(value) {
  if (value === null || value === undefined || value === "") return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function normalizeEnum(value, allowed, fallback = null) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (allowed.includes(normalized)) return normalized
  return fallback
}

function nullableText(value, max = 120) {
  const text = String(value || "").trim().replace(/\s+/g, " ")
  return text ? text.slice(0, max) : null
}

export function normalizeVehiclePlate(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .slice(0, 32)

  if (!normalized) throw badRequest("Number plate is required.")
  if (/[^A-Z0-9 -]/.test(normalized)) {
    throw badRequest("Number plate can only contain letters, numbers, spaces, and hyphens.")
  }
  return normalized
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1900 || numeric > 2100) {
    throw badRequest("Vehicle year is not valid.")
  }
  return numeric
}

function normalizeCapacity(value) {
  if (value === null || value === undefined || value === "") return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 5000) {
    throw badRequest("Tank capacity must be a positive litre value.")
  }
  return Number(numeric.toFixed(2))
}

function mapVehicle(row) {
  if (!row) return null
  return {
    id: String(row.public_id || ""),
    internalId: row.id ? String(row.id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    nickname: row.nickname || null,
    vehicleType: row.vehicle_type || "OTHER",
    usageType: row.usage_type || null,
    make: row.make || "",
    model: row.model || "",
    year: row.year === null || row.year === undefined ? null : Number(row.year),
    numberPlate: row.number_plate || "",
    fuelType: row.fuel_type || "PETROL",
    tankCapacityLitres:
      row.tank_capacity_litres === null || row.tank_capacity_litres === undefined
        ? null
        : Number(row.tank_capacity_litres),
    isFullTank: Boolean(row.is_full_tank),
    tankSide: row.tank_side || "UNKNOWN",
    tankSideSource: row.tank_side_source || "USER_CONFIRMED",
    tankSideConfidence: row.tank_side_confidence || "LOW",
    visualMockupKey: row.visual_mockup_key || null,
    isDefault: Boolean(row.is_default),
    verificationStatus: row.verification_status || "UNVERIFIED",
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function normalizeVehicleInput(payload, { partial = false } = {}) {
  const input = payload || {}
  const output = {}

  if (!partial || input.vehicleType !== undefined) {
    const value = normalizeEnum(input.vehicleType, VEHICLE_TYPES, partial ? undefined : "OTHER")
    if (!value) throw badRequest("Vehicle type is not valid.")
    output.vehicleType = value
  }
  if (input.usageType !== undefined) {
    output.usageType = input.usageType === null ? null : normalizeEnum(input.usageType, VEHICLE_USAGE_TYPES, "OTHER")
  } else if (!partial) {
    output.usageType = null
  }
  if (!partial || input.make !== undefined) {
    const value = nullableText(input.make, 80)
    if (!value) throw badRequest("Vehicle make is required.")
    output.make = value
  }
  if (!partial || input.model !== undefined) {
    const value = nullableText(input.model, 120)
    if (!value) throw badRequest("Vehicle model is required.")
    output.model = value
  }
  if (!partial || input.numberPlate !== undefined) {
    output.numberPlate = normalizeVehiclePlate(input.numberPlate)
  }
  if (input.nickname !== undefined || !partial) {
    output.nickname = nullableText(input.nickname, 120)
  }
  if (input.year !== undefined || !partial) {
    output.year = normalizeYear(input.year)
  }
  if (!partial || input.fuelType !== undefined) {
    const value = normalizeEnum(input.fuelType, VEHICLE_FUEL_TYPES, partial ? undefined : "PETROL")
    if (!value) throw badRequest("Fuel type is not supported.")
    output.fuelType = value
  }
  if (input.tankCapacityLitres !== undefined || !partial) {
    output.tankCapacityLitres = normalizeCapacity(input.tankCapacityLitres)
  }
  if (input.isFullTank !== undefined || !partial) {
    output.isFullTank = Boolean(input.isFullTank)
  }
  if (!partial || input.tankSide !== undefined) {
    const value = normalizeEnum(input.tankSide, TANK_SIDES, partial ? undefined : "UNKNOWN")
    if (!value) throw badRequest("Tank side is not valid.")
    output.tankSide = value
  }
  if (!partial || input.tankSideSource !== undefined) {
    output.tankSideSource = normalizeEnum(
      input.tankSideSource,
      TANK_SIDE_SOURCES,
      partial ? undefined : "USER_CONFIRMED"
    )
    if (!output.tankSideSource) throw badRequest("Tank side source is not valid.")
  }
  if (!partial || input.tankSideConfidence !== undefined) {
    output.tankSideConfidence = normalizeEnum(input.tankSideConfidence, TANK_SIDE_CONFIDENCES, partial ? undefined : "LOW")
    if (!output.tankSideConfidence) throw badRequest("Tank side confidence is not valid.")
  }
  if (input.visualMockupKey !== undefined || !partial) {
    output.visualMockupKey = nullableText(input.visualMockupKey, 96)
  }
  if (input.isDefault !== undefined || !partial) {
    output.isDefault = Boolean(input.isDefault)
  }

  return output
}

async function countActiveUserVehicles(tx, userId) {
  const rows = await tx.$queryRaw`
    SELECT COUNT(*) AS count
    FROM vehicles
    WHERE user_id = ${userId}
      AND archived_at IS NULL
  `
  return Number(rows?.[0]?.count || 0)
}

async function assertPlateAvailable(tx, { userId, numberPlate, excludeVehicleId = null }) {
  const rows = await tx.$queryRaw`
    SELECT id
    FROM vehicles
    WHERE user_id = ${userId}
      AND number_plate = ${numberPlate}
      AND archived_at IS NULL
      AND (${excludeVehicleId} IS NULL OR id <> ${excludeVehicleId})
    LIMIT 1
  `
  if (rows?.[0]) throw badRequest("You already have an active vehicle with this number plate.")
}

async function findVehicleRowForUser(tx, { userId, vehicleId, includeArchived = false }) {
  const rows = await tx.$queryRaw`
    SELECT *
    FROM vehicles
    WHERE public_id = ${vehicleId}
      AND user_id = ${userId}
      AND (${includeArchived ? 1 : 0} = 1 OR archived_at IS NULL)
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function listVehicles({ auth }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM vehicles
    WHERE user_id = ${userId}
      AND archived_at IS NULL
    ORDER BY is_default DESC, updated_at DESC, id DESC
  `
  return rows.map(mapVehicle)
}

export async function getVehicle({ auth, vehicleId }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const row = await findVehicleRowForUser(prisma, { userId, vehicleId })
  if (!row) throw notFound("Vehicle not found.")
  return mapVehicle(row)
}

export async function getUserVehicleForQueue({ auth, vehicleId }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const row = await findVehicleRowForUser(prisma, { userId, vehicleId })
  if (!row) throw notFound("Vehicle not found.")
  return mapVehicle(row)
}

export async function createVehicle({ auth, payload }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const normalized = normalizeVehicleInput(payload)

  const created = await prisma.$transaction(async (tx) => {
    await assertPlateAvailable(tx, { userId, numberPlate: normalized.numberPlate })
    const existingCount = await countActiveUserVehicles(tx, userId)
    const shouldSetDefault = normalized.isDefault || existingCount === 0

    if (shouldSetDefault) {
      await tx.$executeRaw`
        UPDATE vehicles
        SET is_default = 0,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = ${userId}
          AND archived_at IS NULL
      `
    }

    const publicId = createPublicId()
    await tx.$executeRaw`
      INSERT INTO vehicles (
        public_id,
        user_id,
        nickname,
        vehicle_type,
        usage_type,
        make,
        model,
        year,
        number_plate,
        fuel_type,
        tank_capacity_litres,
        is_full_tank,
        tank_side,
        tank_side_source,
        tank_side_confidence,
        visual_mockup_key,
        is_default,
        verification_status
      )
      VALUES (
        ${publicId},
        ${userId},
        ${normalized.nickname},
        ${normalized.vehicleType},
        ${normalized.usageType},
        ${normalized.make},
        ${normalized.model},
        ${normalized.year},
        ${normalized.numberPlate},
        ${normalized.fuelType},
        ${normalized.tankCapacityLitres},
        ${normalized.isFullTank ? 1 : 0},
        ${normalized.tankSide},
        ${normalized.tankSideSource},
        ${normalized.tankSideConfidence},
        ${normalized.visualMockupKey},
        ${shouldSetDefault ? 1 : 0},
        'UNVERIFIED'
      )
    `
    return findVehicleRowForUser(tx, { userId, vehicleId: publicId })
  })

  await writeOperationalAudit({
    actorType: "USER",
    actorId: userId,
    vehicleId: created?.id,
    action: "VEHICLE_CREATED",
    reason: "User created a vehicle profile.",
    metadata: { vehiclePublicId: created?.public_id, numberPlate: created?.number_plate, tankSide: created?.tank_side },
    mirrorStationAudit: false,
  })

  return mapVehicle(created)
}

export async function updateVehicle({ auth, vehicleId, payload }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const normalized = normalizeVehicleInput(payload, { partial: true })

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await findVehicleRowForUser(tx, { userId, vehicleId })
    if (!existing) throw notFound("Vehicle not found.")
    if (normalized.numberPlate) {
      await assertPlateAvailable(tx, {
        userId,
        numberPlate: normalized.numberPlate,
        excludeVehicleId: existing.id,
      })
    }

    if (normalized.isDefault) {
      await tx.$executeRaw`
        UPDATE vehicles
        SET is_default = 0,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = ${userId}
          AND archived_at IS NULL
      `
    }

    await tx.$executeRaw`
      UPDATE vehicles
      SET
        nickname = COALESCE(${Object.prototype.hasOwnProperty.call(normalized, "nickname") ? normalized.nickname : null}, nickname),
        vehicle_type = COALESCE(${normalized.vehicleType || null}, vehicle_type),
        usage_type = ${Object.prototype.hasOwnProperty.call(normalized, "usageType") ? normalized.usageType : existing.usage_type},
        make = COALESCE(${normalized.make || null}, make),
        model = COALESCE(${normalized.model || null}, model),
        year = ${Object.prototype.hasOwnProperty.call(normalized, "year") ? normalized.year : existing.year},
        number_plate = COALESCE(${normalized.numberPlate || null}, number_plate),
        fuel_type = COALESCE(${normalized.fuelType || null}, fuel_type),
        tank_capacity_litres = ${Object.prototype.hasOwnProperty.call(normalized, "tankCapacityLitres") ? normalized.tankCapacityLitres : existing.tank_capacity_litres},
        is_full_tank = ${Object.prototype.hasOwnProperty.call(normalized, "isFullTank") ? (normalized.isFullTank ? 1 : 0) : existing.is_full_tank},
        tank_side = COALESCE(${normalized.tankSide || null}, tank_side),
        tank_side_source = COALESCE(${normalized.tankSideSource || null}, tank_side_source),
        tank_side_confidence = COALESCE(${normalized.tankSideConfidence || null}, tank_side_confidence),
        visual_mockup_key = ${Object.prototype.hasOwnProperty.call(normalized, "visualMockupKey") ? normalized.visualMockupKey : existing.visual_mockup_key},
        is_default = ${normalized.isDefault ? 1 : existing.is_default},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
    return findVehicleRowForUser(tx, { userId, vehicleId })
  })

  await writeOperationalAudit({
    actorType: "USER",
    actorId: userId,
    vehicleId: updated?.id,
    action: "VEHICLE_UPDATED",
    reason: "User updated a vehicle profile.",
    metadata: { vehiclePublicId: updated?.public_id, tankSide: updated?.tank_side },
    mirrorStationAudit: false,
  })

  return mapVehicle(updated)
}

export async function archiveVehicle({ auth, vehicleId }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const archived = await prisma.$transaction(async (tx) => {
    const existing = await findVehicleRowForUser(tx, { userId, vehicleId })
    if (!existing) throw notFound("Vehicle not found.")
    await tx.$executeRaw`
      UPDATE vehicles
      SET archived_at = CURRENT_TIMESTAMP(3),
          is_default = 0,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
    const fallbackRows = await tx.$queryRaw`
      SELECT id
      FROM vehicles
      WHERE user_id = ${userId}
        AND archived_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `
    const fallback = fallbackRows?.[0]
    if (fallback) {
      await tx.$executeRaw`
        UPDATE vehicles
        SET is_default = 1,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${fallback.id}
      `
    }
    return existing
  })

  await writeOperationalAudit({
    actorType: "USER",
    actorId: userId,
    vehicleId: archived?.id,
    action: "VEHICLE_ARCHIVED",
    reason: "User archived a vehicle profile.",
    metadata: { vehiclePublicId: archived?.public_id, numberPlate: archived?.number_plate },
    mirrorStationAudit: false,
  })

  return { archived: true }
}

export async function setDefaultVehicle({ auth, vehicleId }) {
  const userId = toId(auth?.userId)
  if (!userId) throw badRequest("User session is required.")
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await findVehicleRowForUser(tx, { userId, vehicleId })
    if (!existing) throw notFound("Vehicle not found.")
    await tx.$executeRaw`
      UPDATE vehicles
      SET is_default = 0,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ${userId}
        AND archived_at IS NULL
    `
    await tx.$executeRaw`
      UPDATE vehicles
      SET is_default = 1,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
    return findVehicleRowForUser(tx, { userId, vehicleId })
  })

  await writeOperationalAudit({
    actorType: "USER",
    actorId: userId,
    vehicleId: updated?.id,
    action: "VEHICLE_DEFAULT_SET",
    reason: "User set a default vehicle.",
    metadata: { vehiclePublicId: updated?.public_id },
    mirrorStationAudit: false,
  })

  return mapVehicle(updated)
}

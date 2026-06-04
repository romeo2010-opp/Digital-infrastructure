import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { writeOperationalAudit } from "../common/operationalAudit.js"

export const ACTIVE_PUMP_QUEUE_STATUSES = Object.freeze(["WAITING", "CALLED", "LATE"])
export const DEFAULT_SERVICE_MINUTES = 5

const SIZE_RANK = Object.freeze({
  SMALL: 1,
  MEDIUM: 2,
  LARGE: 3,
  EXTRA_LARGE: 4,
})

const VEHICLE_SIZE = Object.freeze({
  MOTORCYCLE: "SMALL",
  HATCHBACK: "SMALL",
  SEDAN: "SMALL",
  SUV: "MEDIUM",
  PICKUP: "MEDIUM",
  MINIBUS: "LARGE",
  TRUCK: "EXTRA_LARGE",
  OTHER: "MEDIUM",
})

function toId(value) {
  if (value === null || value === undefined || value === "") return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean) : []
  } catch {
    return []
  }
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value || {})
  } catch {
    return "{}"
  }
}

function normalizeFuel(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (normalized === "PARAFFIN") return "PARAFFIN_KEROSENE"
  if (normalized === "KEROSENE") return "PARAFFIN_KEROSENE"
  return normalized || "PETROL"
}

function normalizeTankSide(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["DRIVER_SIDE", "PASSENGER_SIDE", "UNKNOWN", "BOTH_OR_CENTER"].includes(normalized)) return normalized
  return "UNKNOWN"
}

function normalizeMode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["OPEN_WALKIN", "CLEARING_FOR_SMARTLINK", "SMARTLINK_ONLY", "PAUSED", "MAINTENANCE"].includes(normalized)) {
    return normalized
  }
  return "OPEN_WALKIN"
}

function getVehicleSize(vehicle) {
  return VEHICLE_SIZE[String(vehicle?.vehicleType || vehicle?.vehicle_type || "OTHER").trim().toUpperCase()] || "MEDIUM"
}

function sizeSupported(maxVehicleSize, vehicle) {
  const maxRank = SIZE_RANK[String(maxVehicleSize || "LARGE").trim().toUpperCase()] || SIZE_RANK.LARGE
  const vehicleRank = SIZE_RANK[getVehicleSize(vehicle)] || SIZE_RANK.MEDIUM
  return vehicleRank <= maxRank
}

function mapPump(row) {
  const supportedFuelTypes = parseJsonArray(row.fuel_types_supported_json)
  const fallbackFuel = normalizeFuel(row.pump_fuel_type)
  return {
    id: row.id ? String(row.id) : null,
    internalId: row.id ? BigInt(row.id) : null,
    publicId: row.public_id || null,
    stationId: row.station_id ? String(row.station_id) : null,
    pumpNumber: row.pump_number === null || row.pump_number === undefined ? null : Number(row.pump_number),
    displayName: row.display_name || `Pump ${row.pump_number || ""}`.trim(),
    fuelTypesSupported: supportedFuelTypes.length ? supportedFuelTypes : [fallbackFuel],
    laneSideSupported: row.lane_side_supported || "BOTH_SIDES",
    supportedVehicleTypes: parseJsonArray(row.supported_vehicle_types_json),
    maxVehicleSize: row.max_vehicle_size || "LARGE",
    entryDirection: row.entry_direction || null,
    exitDirection: row.exit_direction || null,
    isSmartlinkEnabled: Boolean(row.is_smartlink_enabled),
    isActive: Boolean(row.is_active),
    acceptsWalkinsWhenIdle: Boolean(row.accepts_walkins_when_idle),
    maxStandbyWalkins: Number(row.max_standby_walkins || 1),
    clearLaneBufferMinutes: Number(row.clear_lane_buffer_minutes || 7),
    currentMode: normalizeMode(row.current_mode),
    assignedKioskId: row.config_kiosk_id ? String(row.config_kiosk_id) : row.assigned_kiosk_id ? String(row.assigned_kiosk_id) : null,
    assignedKioskInternalId: row.config_kiosk_id || row.assigned_kiosk_id || null,
    activeQueueLoad: 0,
    etaMinutes: 0,
  }
}

function mapTicket(row) {
  return {
    id: row.id ? String(row.id) : null,
    internalId: row.id || null,
    publicId: row.public_id || null,
    stationId: row.station_id || null,
    userId: row.user_id || null,
    status: row.status || "WAITING",
    fuelType: normalizeFuel(row.fuel_type || row.vehicle_fuel_type),
    metadata: parseJsonObject(row.metadata),
    vehicle: row.vehicle_id
      ? {
          id: row.vehicle_id ? String(row.vehicle_id) : null,
          publicId: row.vehicle_public_id || null,
          vehicleType: row.vehicle_type || "OTHER",
          usageType: row.usage_type || null,
          make: row.make || "",
          model: row.model || "",
          numberPlate: row.number_plate || row.masked_plate || "",
          fuelType: normalizeFuel(row.vehicle_fuel_type || row.fuel_type),
          tankSide: normalizeTankSide(row.tank_side),
          tankSideSource: row.tank_side_source || "USER_CONFIRMED",
          tankSideConfidence: row.tank_side_confidence || "LOW",
          visualMockupKey: row.visual_mockup_key || null,
        }
      : null,
    assignedPumpId: row.assigned_pump_id || null,
    assignedKioskId: row.assigned_kiosk_id || null,
    assignmentStatus: row.pump_assignment_status || "PENDING",
    assignmentLockedAt: row.assignment_locked_at || null,
  }
}

function activeStatusSqlList() {
  return ACTIVE_PUMP_QUEUE_STATUSES
}

export function isFuelCompatible(pump, fuelType) {
  const fuel = normalizeFuel(fuelType)
  return (pump.fuelTypesSupported || []).map(normalizeFuel).includes(fuel)
}

export function isTankSideCompatible(pump, vehicle) {
  const tankSide = normalizeTankSide(vehicle?.tankSide || vehicle?.tank_side)
  const supportedSide = String(pump?.laneSideSupported || "BOTH_SIDES").trim().toUpperCase()

  if (tankSide === "UNKNOWN") {
    return supportedSide === "BOTH_SIDES" || supportedSide === "MANUAL_ONLY"
  }

  if (tankSide === "BOTH_OR_CENTER") {
    return supportedSide === "BOTH_SIDES" || supportedSide === "MANUAL_ONLY"
  }

  return supportedSide === tankSide || supportedSide === "BOTH_SIDES" || supportedSide === "MANUAL_ONLY"
}

export function isVehicleTypeSupported(pump, vehicle) {
  const supported = Array.isArray(pump.supportedVehicleTypes) ? pump.supportedVehicleTypes : []
  if (!supported.length) return true
  const vehicleType = String(vehicle?.vehicleType || vehicle?.vehicle_type || "OTHER").trim().toUpperCase()
  return supported.includes(vehicleType)
}

export function scorePumpForVehicle(pump, vehicle, queueLoad = 0, fuelType = vehicle?.fuelType || vehicle?.fuel_type) {
  const reasons = []
  let score = 0
  const mode = normalizeMode(pump?.currentMode)
  const tankSide = normalizeTankSide(vehicle?.tankSide || vehicle?.tank_side)
  const supportedSide = String(pump?.laneSideSupported || "BOTH_SIDES").trim().toUpperCase()
  const vehicleTypeSupported = isVehicleTypeSupported(pump, vehicle)
  const vehicleSizeSupported = sizeSupported(pump?.maxVehicleSize, vehicle)

  if (!pump?.isActive || mode === "PAUSED" || mode === "MAINTENANCE") {
    score -= 1000
    reasons.push("pump unavailable")
  }

  if (isFuelCompatible(pump, fuelType)) {
    score += 100
    reasons.push("fuel type match")
  } else {
    score -= 1000
    reasons.push("fuel type incompatible")
  }

  if (isTankSideCompatible(pump, vehicle)) {
    if (supportedSide === tankSide) {
      score += 80
      reasons.push("exact tank-side match")
    } else if (supportedSide === "BOTH_SIDES") {
      score += 60
      reasons.push("flexible both-side lane")
    } else if (supportedSide === "MANUAL_ONLY") {
      score += 25
      reasons.push("manual lane supported")
    } else {
      score += 40
      reasons.push("tank-side supported")
    }
  } else {
    score -= 1000
    reasons.push("tank side incompatible")
  }

  if (vehicleTypeSupported && vehicleSizeSupported) {
    score += 30
    reasons.push("vehicle size supported")
  } else {
    score -= 80
    reasons.push("vehicle size unsupported")
  }

  if (mode === "CLEARING_FOR_SMARTLINK") score -= 30
  if (pump?.isSmartlinkEnabled) score += 20

  const load = Number(queueLoad || pump?.activeQueueLoad || 0)
  score -= load * 15
  const etaMinutes = Number(pump?.etaMinutes || load * DEFAULT_SERVICE_MINUTES)
  score -= Math.min(etaMinutes, 60) * 0.5

  return {
    score,
    confidence: score >= 180 ? "HIGH" : score >= 120 ? "MEDIUM" : "LOW",
    reasons,
    compatible: score > -500 && isFuelCompatible(pump, fuelType) && isTankSideCompatible(pump, vehicle) && vehicleTypeSupported && vehicleSizeSupported,
  }
}

async function getQueueTicket(ticketId) {
  const scopedTicketId = String(ticketId || "").trim()
  const rows = await prisma.$queryRaw`
    SELECT
      qe.*,
      ft.code AS fuel_type,
      v.public_id AS vehicle_public_id,
      v.vehicle_type,
      v.usage_type,
      v.make,
      v.model,
      v.number_plate,
      v.fuel_type AS vehicle_fuel_type,
      v.tank_side,
      v.tank_side_source,
      v.tank_side_confidence,
      v.visual_mockup_key
    FROM queue_entries qe
    LEFT JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    LEFT JOIN vehicles v ON v.id = qe.vehicle_id
    WHERE qe.public_id = ${scopedTicketId}
       OR CAST(qe.id AS CHAR) = ${scopedTicketId}
    LIMIT 1
  `
  const ticket = mapTicket(rows?.[0])
  if (!ticket) throw notFound("Queue ticket not found.")
  return ticket
}

async function loadQueueLoads(stationId) {
  const statuses = activeStatusSqlList()
  const rows = await prisma.$queryRaw`
    SELECT assigned_pump_id, COUNT(*) AS count
    FROM queue_entries
    WHERE station_id = ${stationId}
      AND assigned_pump_id IS NOT NULL
      AND status IN (${statuses[0]}, ${statuses[1]}, ${statuses[2]})
      AND pump_assignment_status IN ('ASSIGNED', 'LOCKED', 'REASSIGNED')
    GROUP BY assigned_pump_id
  `
  return new Map((rows || []).map((row) => [String(row.assigned_pump_id), Number(row.count || 0)]))
}

export async function findCompatiblePumps(stationId, vehicle, fuelType = vehicle?.fuelType) {
  const scopedStationId = toId(stationId)
  if (!scopedStationId) return []

  const rows = await prisma.$queryRaw`
    SELECT
      p.id,
      p.public_id,
      p.station_id,
      p.pump_number,
      p.status,
      p.is_active AS pump_is_active,
      ft.code AS pump_fuel_type,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS display_name,
      pc.fuel_types_supported_json,
      COALESCE(pc.lane_side_supported, 'BOTH_SIDES') AS lane_side_supported,
      pc.supported_vehicle_types_json,
      COALESCE(pc.max_vehicle_size, 'LARGE') AS max_vehicle_size,
      pc.entry_direction,
      pc.exit_direction,
      COALESCE(pc.is_smartlink_enabled, 0) AS is_smartlink_enabled,
      COALESCE(pc.is_active, p.is_active) AS is_active,
      COALESCE(pc.accepts_walkins_when_idle, 1) AS accepts_walkins_when_idle,
      COALESCE(pc.max_standby_walkins, 1) AS max_standby_walkins,
      COALESCE(pc.clear_lane_buffer_minutes, 7) AS clear_lane_buffer_minutes,
      COALESCE(pc.current_mode, 'OPEN_WALKIN') AS current_mode,
      pc.kiosk_id AS config_kiosk_id,
      kd.id AS assigned_kiosk_id
    FROM pumps p
    LEFT JOIN fuel_types ft ON ft.id = p.fuel_type_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    LEFT JOIN kiosk_devices kd ON kd.assigned_pump_id = p.id AND kd.station_id = p.station_id AND kd.status = 'ACTIVE'
    WHERE p.station_id = ${scopedStationId}
      AND p.is_active = 1
      AND p.status <> 'OFFLINE'
    ORDER BY p.pump_number ASC, kd.id ASC
  `

  const loads = await loadQueueLoads(scopedStationId)
  return (rows || [])
    .map(mapPump)
    .map((pump) => {
      const load = loads.get(String(pump.internalId || pump.id)) || 0
      return {
        ...pump,
        activeQueueLoad: load,
        etaMinutes: load * DEFAULT_SERVICE_MINUTES,
      }
    })
    .filter((pump) => {
      const score = scorePumpForVehicle(pump, vehicle, pump.activeQueueLoad, fuelType)
      return score.compatible
    })
}

function buildAssignmentReason({ pump, vehicle, score }) {
  const fuel = normalizeFuel(vehicle?.fuelType || vehicle?.fuel_type)
  const vehicleType = String(vehicle?.vehicleType || vehicle?.vehicle_type || "vehicle").replace(/_/g, " ")
  const tankSide = normalizeTankSide(vehicle?.tankSide || vehicle?.tank_side).replace(/_/g, " ").toLowerCase()
  const loadText = pump.activeQueueLoad === 0 ? "no active pump queue" : `${pump.activeQueueLoad} active queue item${pump.activeQueueLoad === 1 ? "" : "s"}`
  const reasonBits = [
    `supports ${fuel}`,
    `supports ${tankSide}`,
    `fits ${vehicleType.toLowerCase()}`,
    `has ${loadText}`,
  ]
  return `Assigned to ${pump.displayName} because it ${reasonBits.join(", ")}.`
}

async function updateTicketMetadata(ticket, updates) {
  const metadata = {
    ...(ticket.metadata || {}),
    smartPumpAssignment: {
      ...(ticket.metadata?.smartPumpAssignment || {}),
      ...updates,
      updatedAt: new Date().toISOString(),
    },
  }
  await prisma.$executeRaw`
    UPDATE queue_entries
    SET metadata = ${stringifyJson(metadata)}
    WHERE id = ${ticket.internalId}
  `
}

async function markManualReview(ticket, reason, metadata = {}) {
  await prisma.$executeRaw`
    UPDATE queue_entries
    SET assigned_pump_id = NULL,
        assigned_kiosk_id = NULL,
        pump_assignment_status = 'MANUAL_REVIEW_REQUIRED',
        assignment_reason = ${reason},
        assignment_confidence = 'LOW',
        assignment_created_at = COALESCE(assignment_created_at, CURRENT_TIMESTAMP(3)),
        assignment_updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${ticket.internalId}
      AND assignment_locked_at IS NULL
  `
  await updateTicketMetadata(ticket, {
    status: "MANUAL_REVIEW_REQUIRED",
    reason,
    ...metadata,
  })
  await writeOperationalAudit({
    actorType: "SYSTEM",
    stationId: ticket.stationId,
    queueTicketId: ticket.internalId,
    vehicleId: ticket.vehicle?.id,
    action: "MANUAL_REVIEW_REQUIRED",
    reason,
    metadata: { queuePublicId: ticket.publicId, vehicle: ticket.vehicle },
  })
  return { status: "MANUAL_REVIEW_REQUIRED", reason, confidence: "LOW", pump: null }
}

export async function assignPumpForQueueTicket(ticketId) {
  const ticket = await getQueueTicket(ticketId)
  if (ticket.assignmentLockedAt) {
    return explainAssignment(ticket.publicId)
  }
  if (!ticket.vehicle) {
    return markManualReview(ticket, "Manual review required because no vehicle profile is attached to this queue ticket.")
  }

  const candidatePumps = await findCompatiblePumps(ticket.stationId, ticket.vehicle, ticket.vehicle.fuelType || ticket.fuelType)
  if (!candidatePumps.length) {
    const unknownSide = normalizeTankSide(ticket.vehicle.tankSide) === "UNKNOWN"
    const reason = unknownSide
      ? "Manual review required because vehicle tank side is unknown and no flexible/manual pump is available."
      : "Manual review required because no compatible active pump is available for this vehicle."
    return markManualReview(ticket, reason, { candidateCount: 0 })
  }

  const ranked = candidatePumps
    .map((pump) => ({
      pump,
      result: scorePumpForVehicle(pump, ticket.vehicle, pump.activeQueueLoad, ticket.vehicle.fuelType || ticket.fuelType),
    }))
    .sort((left, right) => right.result.score - left.result.score)

  const winner = ranked[0]
  const reason = buildAssignmentReason({ pump: winner.pump, vehicle: ticket.vehicle, score: winner.result })
  const status = ticket.assignedPumpId && String(ticket.assignedPumpId) !== String(winner.pump.internalId) ? "REASSIGNED" : "ASSIGNED"

  await prisma.$executeRaw`
    UPDATE queue_entries
    SET assigned_pump_id = ${winner.pump.internalId},
        assigned_kiosk_id = ${winner.pump.assignedKioskInternalId},
        pump_assignment_status = ${status},
        assignment_reason = ${reason},
        assignment_confidence = ${winner.result.confidence},
        assignment_created_at = COALESCE(assignment_created_at, CURRENT_TIMESTAMP(3)),
        assignment_updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${ticket.internalId}
      AND assignment_locked_at IS NULL
  `
  await updateTicketMetadata(ticket, {
    status,
    pumpId: winner.pump.id,
    pumpPublicId: winner.pump.publicId,
    pumpDisplayName: winner.pump.displayName,
    reason,
    confidence: winner.result.confidence,
    score: winner.result.score,
  })
  await writeOperationalAudit({
    actorType: "SYSTEM",
    stationId: ticket.stationId,
    pumpId: winner.pump.internalId,
    kioskId: winner.pump.assignedKioskInternalId,
    queueTicketId: ticket.internalId,
    vehicleId: ticket.vehicle.id,
    action: status === "REASSIGNED" ? "PUMP_REASSIGNED" : "PUMP_ASSIGNED",
    reason,
    metadata: {
      queuePublicId: ticket.publicId,
      pumpPublicId: winner.pump.publicId,
      score: winner.result.score,
      confidence: winner.result.confidence,
      rankedPumpCount: ranked.length,
    },
  })

  return {
    status,
    pump: winner.pump,
    reason,
    confidence: winner.result.confidence,
    score: winner.result.score,
  }
}

export async function lockPumpAssignment(ticketId) {
  const ticket = await getQueueTicket(ticketId)
  if (!ticket.assignedPumpId) {
    await assignPumpForQueueTicket(ticket.publicId)
  }
  const latest = await getQueueTicket(ticket.publicId)
  if (!latest.assignedPumpId) {
    return markManualReview(latest, latest.assignmentReason || "Manual review required before assignment can be locked.")
  }
  await prisma.$executeRaw`
    UPDATE queue_entries
    SET pump_assignment_status = 'LOCKED',
        assignment_locked_at = COALESCE(assignment_locked_at, CURRENT_TIMESTAMP(3)),
        assignment_updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${latest.internalId}
  `
  await writeOperationalAudit({
    actorType: "SYSTEM",
    stationId: latest.stationId,
    pumpId: latest.assignedPumpId,
    kioskId: latest.assignedKioskId,
    queueTicketId: latest.internalId,
    vehicleId: latest.vehicle?.id,
    action: "PUMP_ASSIGNMENT_LOCKED",
    reason: "Pump assignment locked before user approach instructions.",
    metadata: { queuePublicId: latest.publicId },
  })
  return explainAssignment(latest.publicId)
}

export async function reassignPump(ticketId, reason = "Pump assignment rerun before lock.") {
  const ticket = await getQueueTicket(ticketId)
  if (ticket.assignmentLockedAt || ticket.assignmentStatus === "LOCKED") {
    throw badRequest("Pump assignment is locked and cannot be changed without manager intervention.")
  }
  await prisma.$executeRaw`
    UPDATE queue_entries
    SET assigned_pump_id = NULL,
        assigned_kiosk_id = NULL,
        pump_assignment_status = 'PENDING',
        assignment_reason = ${reason},
        assignment_confidence = NULL,
        assignment_updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${ticket.internalId}
      AND assignment_locked_at IS NULL
  `
  await writeOperationalAudit({
    actorType: "SYSTEM",
    stationId: ticket.stationId,
    queueTicketId: ticket.internalId,
    vehicleId: ticket.vehicle?.id,
    action: "PUMP_REASSIGNMENT_REQUESTED",
    reason,
    metadata: { queuePublicId: ticket.publicId },
  })
  return assignPumpForQueueTicket(ticket.publicId)
}

export async function explainAssignment(ticketId) {
  const rows = await prisma.$queryRaw`
    SELECT
      qe.public_id,
      qe.pump_assignment_status,
      qe.assignment_reason,
      qe.assignment_confidence,
      qe.assignment_created_at,
      qe.assignment_updated_at,
      qe.assignment_locked_at,
      p.public_id AS pump_public_id,
      p.pump_number,
      COALESCE(pc.display_name, CONCAT('Pump ', p.pump_number)) AS display_name,
      pc.entry_direction,
      pc.exit_direction,
      pc.current_mode
    FROM queue_entries qe
    LEFT JOIN pumps p ON p.id = qe.assigned_pump_id
    LEFT JOIN pump_configurations pc ON pc.pump_id = p.id
    WHERE qe.public_id = ${String(ticketId || "").trim()}
       OR CAST(qe.id AS CHAR) = ${String(ticketId || "").trim()}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row) throw notFound("Queue ticket not found.")
  return {
    status: row.pump_assignment_status || "PENDING",
    reason: row.assignment_reason || null,
    confidence: row.assignment_confidence || null,
    createdAt: row.assignment_created_at ? new Date(row.assignment_created_at).toISOString() : null,
    updatedAt: row.assignment_updated_at ? new Date(row.assignment_updated_at).toISOString() : null,
    lockedAt: row.assignment_locked_at ? new Date(row.assignment_locked_at).toISOString() : null,
    pump: row.pump_public_id
      ? {
          id: row.pump_public_id,
          pumpNumber: row.pump_number === null || row.pump_number === undefined ? null : Number(row.pump_number),
          displayName: row.display_name || `Pump ${row.pump_number}`,
          entryDirection: row.entry_direction || null,
          exitDirection: row.exit_direction || null,
          currentMode: row.current_mode || "OPEN_WALKIN",
        }
      : null,
  }
}

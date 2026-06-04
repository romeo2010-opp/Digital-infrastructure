import { prisma } from "../../db/prisma.js"
import { writeAuditLog } from "./db.js"

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {})
  } catch {
    return JSON.stringify({ serializationError: true })
  }
}

function normalizeActorType(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (["USER", "KIOSK", "ATTENDANT", "MANAGER", "SYSTEM"].includes(normalized)) return normalized
  return "SYSTEM"
}

function mirrorAction(action) {
  return String(action || "SMARTLINK_OPERATION")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "SMARTLINK_OPERATION"
}

export async function writeOperationalAudit({
  actorType = "SYSTEM",
  actorId = null,
  stationId = null,
  pumpId = null,
  kioskId = null,
  queueTicketId = null,
  vehicleId = null,
  action,
  reason = null,
  metadata = null,
  mirrorStationAudit = true,
} = {}) {
  const normalizedAction = mirrorAction(action)
  const metadataJson = safeJson(metadata)
  const scopedStationId = toBigIntOrNull(stationId)

  try {
    await prisma.$executeRaw`
      INSERT INTO smartlink_operational_audit_logs (
        actor_type,
        actor_id,
        station_id,
        pump_id,
        kiosk_id,
        queue_ticket_id,
        vehicle_id,
        action,
        reason,
        metadata_json
      )
      VALUES (
        ${normalizeActorType(actorType)},
        ${toBigIntOrNull(actorId)},
        ${scopedStationId},
        ${toBigIntOrNull(pumpId)},
        ${toBigIntOrNull(kioskId)},
        ${toBigIntOrNull(queueTicketId)},
        ${toBigIntOrNull(vehicleId)},
        ${normalizedAction},
        ${reason ? String(reason).slice(0, 500) : null},
        ${metadataJson}
      )
    `
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn("[operational-audit] failed to write smartlink audit", error?.message || error)
    }
  }

  if (!mirrorStationAudit || !scopedStationId) return
  try {
    await writeAuditLog({
      stationId: scopedStationId,
      actionType: normalizedAction,
      payload: {
        actorType: normalizeActorType(actorType),
        actorId: actorId ? String(actorId) : null,
        pumpId: pumpId ? String(pumpId) : null,
        kioskId: kioskId ? String(kioskId) : null,
        queueTicketId: queueTicketId ? String(queueTicketId) : null,
        vehicleId: vehicleId ? String(vehicleId) : null,
        reason: reason || null,
        ...(metadata && typeof metadata === "object" ? metadata : {}),
      },
    })
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn("[operational-audit] failed to mirror station audit", error?.message || error)
    }
  }
}

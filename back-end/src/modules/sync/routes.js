import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { createPublicId, createTransactionPublicIdValue, resolveStationOrThrow } from "../common/db.js"
import { notifyUsersOfScheduledStationRestock } from "../common/favoriteStationNotifications.js"
import { requireRole } from "../../middleware/requireAuth.js"
import { publishStationChange } from "../../realtime/stationChangesHub.js"

const router = Router()

const syncEventSchema = z.object({
  eventId: z.string().min(8).max(128),
  stationId: z.string().min(1).max(64).optional(),
  deviceId: z.string().min(1).max(255).optional(),
  actorUserId: z.string().min(1).max(255).optional(),
  type: z.string().min(1).max(64),
  payload: z.any(),
  occurredAt: z.string().datetime().optional(),
})

const syncPayloadSchema = z.object({
  stationId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(255),
  events: z.array(syncEventSchema).max(50),
})

async function resolveActorStaffId(tx, stationId, userId) {
  if (!userId) return null
  const rows = await tx.$queryRaw`
    SELECT id
    FROM station_staff
    WHERE station_id = ${stationId}
      AND user_id = ${userId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0]?.id || null
}

function parseOccurredAt(occurredAt) {
  if (!occurredAt) return new Date()
  const parsed = new Date(occurredAt)
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid occurredAt timestamp")
  }
  return parsed
}

async function resolveTankId(tx, stationId, payload) {
  if (payload?.tankPublicId) {
    const rows = await tx.$queryRaw`
      SELECT id
      FROM tanks
      WHERE station_id = ${stationId}
        AND public_id = ${payload.tankPublicId}
      LIMIT 1
    `
    if (!rows?.[0]?.id) throw badRequest("Tank not found for provided tankPublicId")
    return Number(rows[0].id)
  }

  if (payload?.rowId && String(payload.rowId).startsWith("REC-")) {
    const tankId = Number(String(payload.rowId).replace("REC-", ""))
    if (Number.isFinite(tankId) && tankId > 0) {
      const rows = await tx.$queryRaw`
        SELECT id
        FROM tanks
        WHERE station_id = ${stationId}
          AND id = ${tankId}
        LIMIT 1
      `
      if (rows?.[0]?.id) return tankId
    }
  }

  throw badRequest("Missing tank reference (tankPublicId or valid rowId)")
}

function parseDeliveryArrivalTime(value, fallback = null) {
  const candidate = value === undefined || value === null || value === "" ? fallback : value
  if (!candidate) return new Date()
  const parsed = candidate instanceof Date ? candidate : new Date(candidate)
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid arrivalTime timestamp")
  }
  return parsed
}

async function getTankFuelType(tx, stationId, tankId) {
  const rows = await tx.$queryRaw`
    SELECT ft.code AS fuel_type
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    WHERE t.station_id = ${stationId}
      AND t.id = ${tankId}
    LIMIT 1
  `

  return String(rows?.[0]?.fuel_type || "").trim() || null
}

async function appendAuditLog(tx, stationId, actorStaffId, actionType, payload) {
  await tx.$executeRaw`
    INSERT INTO audit_log (station_id, actor_staff_id, action_type, payload)
    VALUES (${stationId}, ${actorStaffId}, ${actionType}, ${JSON.stringify(payload || {})})
  `
  publishStationChange({
    stationId,
    actionType,
    payload: payload || {},
  })
}

function isDuplicateKeyError(error) {
  const code = String(error?.code || "")
  if (code === "P2002") return true
  if (code === "P2010") {
    const dbCode = String(error?.meta?.code || "")
    if (dbCode === "1062") return true
  }
  const message = String(error?.message || "")
  return message.includes("Duplicate entry")
}

async function insertIngestedEvent(tx, body, req, event) {
  await tx.$executeRaw`
    INSERT INTO ingested_events (
      id,
      event_id,
      station_id,
      device_id,
      actor_user_id,
      type,
      payload,
      occurred_at,
      received_at
    )
    VALUES (
      ${createPublicId()},
      ${event.eventId},
      ${body.stationId},
      ${body.deviceId || event.deviceId || "UNKNOWN_DEVICE"},
      ${event.actorUserId || req.auth?.userPublicId || "UNKNOWN_USER"},
      ${event.type},
      ${JSON.stringify(event.payload || {})},
      ${parseOccurredAt(event.occurredAt)},
      CURRENT_TIMESTAMP(3)
    )
  `
}

async function applySaleCreate(tx, station, actorStaffId, event) {
  const payload = event.payload || {}
  const litres = Number(payload.totalVolume)
  const amount = Number(payload.amount)

  if (!Number.isFinite(litres) || litres <= 0) {
    throw badRequest("Total volume must be greater than 0")
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest("Amount must be greater than 0")
  }

  if (!payload.nozzlePublicId) {
    throw badRequest("nozzlePublicId is required for sale events")
  }

  const nozzleRows = await tx.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.pump_id,
      pn.fuel_type_id,
      p.public_id AS pump_public_id
    FROM pump_nozzles pn
    INNER JOIN pumps p ON p.id = pn.pump_id
    WHERE pn.station_id = ${station.id}
      AND pn.public_id = ${payload.nozzlePublicId}
    LIMIT 1
  `
  const nozzle = nozzleRows?.[0]
  if (!nozzle?.id) throw badRequest("Unable to resolve nozzle for transaction")
  if (!Number(nozzle.fuel_type_id)) throw badRequest("Resolved nozzle has no fuel type")
  if (payload.pumpPublicId && nozzle.pump_public_id !== payload.pumpPublicId) {
    throw badRequest("Nozzle does not belong to supplied pump")
  }

  const occurredAt = parseOccurredAt(event.occurredAt)
  const paymentMethod = payload.paymentMethod || "CASH"
  const pricePerLitre = amount / litres

  await tx.$executeRaw`
    INSERT INTO transactions (
      station_id,
      public_id,
      pump_id,
      nozzle_id,
      fuel_type_id,
      occurred_at,
      litres,
      price_per_litre,
      total_amount,
      payment_method,
      recorded_by_staff_id,
      note
    )
    VALUES (
      ${station.id},
      ${createTransactionPublicIdValue({ typeCode: "PAY", timestamp: occurredAt })},
      ${Number(nozzle.pump_id)},
      ${Number(nozzle.id)},
      ${Number(nozzle.fuel_type_id)},
      ${occurredAt},
      ${litres},
      ${pricePerLitre},
      ${amount},
      ${paymentMethod},
      ${actorStaffId},
      ${payload.note || null}
    )
  `

  await appendAuditLog(tx, station.id, actorStaffId, "TRANSACTION_CREATE", {
    pumpPublicId: payload.pumpPublicId || nozzle.pump_public_id || null,
    nozzlePublicId: payload.nozzlePublicId || nozzle.public_id || null,
    totalVolume: litres,
    amount,
    paymentMethod,
    sourceEventId: event.eventId,
  })
}

async function applyDeliveryCreate(tx, station, actorStaffId, event) {
  const payload = event.payload || {}
  const deliveredLitres = Number(payload.deliveredLitres)
  if (!Number.isFinite(deliveredLitres) || deliveredLitres <= 0) {
    throw badRequest("deliveredLitres must be greater than 0")
  }

  const tankId = await resolveTankId(tx, station.id, payload)
  const arrivalTime = parseDeliveryArrivalTime(payload.arrivalTime, event.occurredAt)
  const fuelType = await getTankFuelType(tx, station.id, tankId)
  const existingRows = await tx.$queryRaw`
    SELECT id
    FROM fuel_deliveries
    WHERE station_id = ${station.id}
      AND tank_id = ${tankId}
      AND DATE(delivered_time) = DATE(${arrivalTime})
    ORDER BY delivered_time DESC, id DESC
    LIMIT 1
  `

  const existing = existingRows?.[0]
  let deliveryOp = "inserted"
  if (existing?.id) {
    await tx.$executeRaw`
      UPDATE fuel_deliveries
      SET
        delivered_time = ${arrivalTime},
        litres = ${deliveredLitres},
        supplier_name = ${payload.supplierName || null},
        reference_code = ${payload.referenceCode || null},
        recorded_by_staff_id = ${actorStaffId},
        note = ${payload.note || "Updated from reports UI"}
      WHERE id = ${existing.id}
    `
    deliveryOp = "updated"
  } else {
    await tx.$executeRaw`
      INSERT INTO fuel_deliveries (
        station_id, tank_id, delivered_time, litres, supplier_name, reference_code, recorded_by_staff_id, note
      )
      VALUES (
        ${station.id},
        ${tankId},
        ${arrivalTime},
        ${deliveredLitres},
        ${payload.supplierName || null},
        ${payload.referenceCode || null},
        ${actorStaffId},
        ${payload.note || "Entered from reports UI"}
      )
    `
  }

  await appendAuditLog(tx, station.id, actorStaffId, "REPORT_ADD_DELIVERY", {
    ...payload,
    arrivalTime: arrivalTime.toISOString(),
    deliveryOp,
    sourceEventId: event.eventId,
  })

  return {
    notifyRestock: {
      station,
      fuelType,
      arrivalTime,
      deliveredLitres,
      supplierName: payload.supplierName || null,
    },
  }
}

async function applyShiftReading(tx, station, actorStaffId, event, readingType) {
  const payload = event.payload || {}
  const litresValue = Number(
    readingType === "OPENING" ? payload.opening ?? payload.litres : payload.closing ?? payload.litres
  )
  if (!Number.isFinite(litresValue) || litresValue <= 0) {
    throw badRequest(`${readingType.toLowerCase()} litres must be greater than 0`)
  }

  const tankId = await resolveTankId(tx, station.id, payload)
  const occurredAt = parseOccurredAt(event.occurredAt)

  const existingRows = await tx.$queryRaw`
    SELECT id
    FROM inventory_readings
    WHERE station_id = ${station.id}
      AND tank_id = ${tankId}
      AND reading_type = ${readingType}
      AND DATE(reading_time) = DATE(${occurredAt})
    ORDER BY reading_time DESC, id DESC
    LIMIT 1
  `

  let readingOp = "inserted"
  if (existingRows?.[0]?.id) {
    await tx.$executeRaw`
      UPDATE inventory_readings
      SET
        litres = ${litresValue},
        recorded_by_staff_id = ${actorStaffId},
        note = ${payload.note || "Updated from reports UI"},
        reading_time = ${occurredAt}
      WHERE id = ${existingRows[0].id}
    `
    readingOp = "updated"
  } else {
    await tx.$executeRaw`
      INSERT INTO inventory_readings (
        station_id, tank_id, reading_type, reading_time, litres, recorded_by_staff_id, note
      )
      VALUES (
        ${station.id},
        ${tankId},
        ${readingType},
        ${occurredAt},
        ${litresValue},
        ${actorStaffId},
        ${payload.note || "Entered from reports UI"}
      )
    `
  }

  await appendAuditLog(tx, station.id, actorStaffId, "REPORT_ADD_READING", {
    ...payload,
    readingOps: {
      [readingType === "OPENING" ? "opening" : "closing"]: readingOp,
    },
    sourceEventId: event.eventId,
  })
}

async function applyEvent(tx, station, actorStaffId, event) {
  switch (event.type) {
    case "SALE_CREATE":
      return applySaleCreate(tx, station, actorStaffId, event)
    case "DELIVERY_CREATE":
      return applyDeliveryCreate(tx, station, actorStaffId, event)
    case "SHIFT_OPEN":
      return applyShiftReading(tx, station, actorStaffId, event, "OPENING")
    case "SHIFT_CLOSE":
      return applyShiftReading(tx, station, actorStaffId, event, "CLOSING")
    default:
      throw badRequest(`Unsupported sync event type: ${event.type}`)
  }
}

router.post(
  "/sync/events",
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const body = syncPayloadSchema.parse(req.body || {})

    if (req.auth?.stationPublicId && req.auth.stationPublicId !== body.stationId) {
      throw badRequest("Station scope mismatch")
    }

    const station = await resolveStationOrThrow(body.stationId)
    const actorStaffId = await resolveActorStaffId(prisma, station.id, req.auth?.userId)
    const acked = []
    const failed = []

    for (const rawEvent of body.events) {
      const event = syncEventSchema.parse(rawEvent)

      if (event.stationId && event.stationId !== body.stationId) {
        failed.push({
          eventId: event.eventId,
          error: "Event stationId does not match request stationId",
        })
        continue
      }

      try {
        let postCommitEffect = null
        await prisma.$transaction(async (tx) => {
          await insertIngestedEvent(tx, body, req, event)
          postCommitEffect = await applyEvent(tx, station, actorStaffId, event)
        })

        if (postCommitEffect?.notifyRestock) {
          await notifyUsersOfScheduledStationRestock(postCommitEffect.notifyRestock).catch(() => {})
        }

        acked.push({ eventId: event.eventId })
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          acked.push({ eventId: event.eventId })
          continue
        }
        failed.push({
          eventId: event.eventId,
          error: error?.message || "Failed to apply event",
        })
      }
    }

    return ok(res, { acked, failed })
  })
)

export default router

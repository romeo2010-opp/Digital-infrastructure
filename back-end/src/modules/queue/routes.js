import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok, notFound } from "../../utils/http.js"
import {
  appTodayISO,
  formatDateISOInTimeZone,
  utcIsoToZonedSqlDateTime,
  zonedSqlDateTimeToUtcIso,
} from "../../utils/dateTime.js"
import {
  createPublicId,
  createReservationPublicIdValue,
  resolveStationOrThrow,
  writeAuditLog,
} from "../common/db.js"
import { requireRole, requireStationScope } from "../../middleware/requireAuth.js"
import { requireStationPlanFeature } from "../subscriptions/middleware.js"
import { STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import {
  extractRequestedLiters,
  isReservationsTableMissingError,
  parseReservationMetadata,
  reservationStatusToManagerLabel,
} from "../common/reservations.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import {
  captureQueuePrepayWalletPayment,
  captureReservationWalletPayment,
  releaseQueuePrepayWalletHold,
} from "../common/wallets.js"
import {
  createPromotionAwareTransaction,
  notifyUserOfCashbackAward,
  previewPromotionAwarePricing,
} from "../promotions/transactionPricing.service.js"
import {
  buildPumpQrPayload,
  listStationPumpsWithNozzles,
  renderPumpQrPngDataUrl,
  resolveNozzleForTransaction,
} from "../pumps/pumps.service.js"
import {
  getHybridQueueSnapshot,
  patchStationHybridQueueSettings,
} from "./hybrid/integration.service.js"
import { PumpQueueState } from "./hybrid/index.js"

const router = Router()
const queueOperatorRole = requireRole(["MANAGER", "ATTENDANT"])
const stationStaffReadRole = requireRole(["MANAGER", "ATTENDANT", "VIEWER"])

router.use("/stations/:stationPublicId/queue", requireStationScope)
router.use("/stations/:stationPublicId/reservations", requireStationScope)
router.use(
  "/stations/:stationPublicId/queue",
  requireStationPlanFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
)
router.use(
  "/stations/:stationPublicId/reservations",
  requireStationPlanFeature(STATION_PLAN_FEATURES.RESERVATIONS)
)

const joinBodySchema = z.object({
  fuelType: z.enum(["PETROL", "DIESEL"]),
  maskedPlate: z.string().max(32).optional(),
  userPublicId: z
    .string()
    .trim()
    .regex(/^(SLU-[A-Z0-9]{6}|[0-9A-HJKMNP-TV-Z]{26})$/i, "Invalid user public id")
    .optional(),
})

const recallBodySchema = z.object({
  entryPublicId: z.string().length(26),
})

const callPositionBodySchema = z.object({
  position: z.number().int().positive(),
  reason: z.string().min(1).max(255),
})

const noShowBodySchema = z.object({
  behavior: z.enum(["move_to_end", "remove"]),
  reason: z.string().max(255).optional(),
})

const servedBodySchema = z.object({
  litres: z.number().positive().optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY", "CARD", "OTHER"]).optional(),
  amount: z.number().positive().optional(),
})

const FORECOURT_LITRES_PROOF_LOOKBACK_MINUTES = 180

const settingsBodySchema = z
  .object({
    is_queue_enabled: z.boolean().optional(),
    grace_minutes: z.number().int().positive().max(180).optional(),
    capacity: z.number().int().positive().max(10000).optional(),
    joins_paused: z.boolean().optional(),
    priority_mode: z.enum(["OFF", "ON", "HYBRID"]).optional(),
    hybrid_queue_n: z.number().int().positive().optional(),
    hybrid_walkin_n: z.number().int().positive().optional(),
    petrol_enabled: z.boolean().optional(),
    diesel_enabled: z.boolean().optional(),
    hybrid_pilot_enabled: z.boolean().optional(),
    pilot_pump_public_id: z.string().trim().max(64).nullable().optional(),
    digital_hold_timeout_seconds: z.number().int().positive().max(3600).optional(),
    kiosk_walkin_redirect_message: z.string().trim().max(255).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one settings field is required",
  })

const reservationListQuerySchema = z.object({
  status: z.string().trim().max(32).optional(),
  q: z.string().trim().max(120).optional(),
})

const reservationUserLookupQuerySchema = z.object({
  userPublicId: z
    .string()
    .trim()
    .regex(/^(SLU-[A-Z0-9]{6}|[0-9A-HJKMNP-TV-Z]{26})$/i, "Invalid user public id"),
})

const reservationCreateBodySchema = z.object({
  userPublicId: z
    .string()
    .trim()
    .regex(/^(SLU-[A-Z0-9]{6}|[0-9A-HJKMNP-TV-Z]{26})$/i, "Invalid user public id")
    .optional(),
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(3).max(24),
  identifier: z.string().trim().max(64).optional(),
  fuelType: z.enum(["PETROL", "DIESEL"]),
  requestedLitres: z.number().positive().max(500).optional(),
  slotStart: z.string().trim().optional(),
  slotEnd: z.string().trim().optional(),
  status: z
    .enum(["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED", "EXPIRED"])
    .optional(),
  notes: z.string().trim().max(255).optional(),
})

function parseIsoDateTime(value) {
  const text = String(value || "").trim()
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function toPositiveNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePriceAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value)
  const raw = String(value || "").trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, "")
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const amount = Number(match[1])
  return Number.isFinite(amount) ? amount : null
}

function resolveFuelPricePerLitre(pricesJson, fuelType) {
  const normalizedFuelType = String(fuelType || "").trim().toUpperCase()
  if (!normalizedFuelType) return null

  const items = parseJsonArray(pricesJson)
  if (!items.length) return null

  const matchingItem = items.find((item) => {
    const label = String(item?.label || item?.name || item?.fuelType || item?.type || "")
      .trim()
      .toUpperCase()
    if (!label) return false
    return (
      label === normalizedFuelType
      || label.startsWith(`${normalizedFuelType} `)
      || label.includes(normalizedFuelType)
    )
  })
  if (!matchingItem) return null

  const amount =
    parsePriceAmount(matchingItem?.pricePerLitre)
    ?? parsePriceAmount(matchingItem?.price_per_litre)
    ?? parsePriceAmount(matchingItem?.price)
    ?? parsePriceAmount(matchingItem?.amount)
    ?? parsePriceAmount(matchingItem?.value)

  if (!Number.isFinite(amount) || amount <= 0) return null
  return Number(amount.toFixed(2))
}

function resolveReservationFuelCode(reservation) {
  const explicitCode = String(reservation?.fuel_code || "").trim().toUpperCase()
  if (explicitCode) return explicitCode
  const fuelTypeId = Number(reservation?.fuel_type_id || 0)
  if (fuelTypeId === 2) return "DIESEL"
  if (fuelTypeId === 1) return "PETROL"
  return ""
}

export async function resolveStationContext(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone, is_active, prices_json
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  return rows?.[0] || { ...station, timezone: "Africa/Blantyre", is_active: true, prices_json: null }
}

function reservationStatusFilterToEnum(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (!normalized || normalized === "ALL") return null
  if (normalized === "PENDING") return "PENDING"
  if (normalized === "CONFIRMED") return "CONFIRMED"
  if (normalized === "COMPLETED" || normalized === "FULFILLED") return "FULFILLED"
  if (normalized === "CANCELLED") return "CANCELLED"
  if (normalized === "EXPIRED") return "EXPIRED"
  return null
}

function buildSlotLabel(slotStart, slotEnd) {
  if (!slotStart) return "No slot"
  const start = new Date(slotStart)
  if (Number.isNaN(start.getTime())) return "No slot"
  const end = slotEnd ? new Date(slotEnd) : new Date(start.getTime() + 30 * 60 * 1000)
  const options = { hour: "2-digit", minute: "2-digit", hour12: true }
  return `${start.toLocaleTimeString([], options)} - ${end.toLocaleTimeString([], options)}`
}

function resolveQueueEntryEffectiveStatus(item) {
  const metadata = parseReservationMetadata(item?.metadata)
  const hybridState = String(metadata?.hybridQueue?.state || "").trim().toUpperCase()
  if (hybridState) return hybridState

  const workflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}
  const rowStatus = String(item?.status || "").trim().toUpperCase()

  if (workflow.serviceStartedAt || metadata?.serviceRequest?.dispensingStartedAt) {
    return "FUELING"
  }
  if (workflow.customerArrivedAt || metadata?.hybridQueue?.readyAt) {
    return "READY_ON_SITE"
  }
  if (metadata?.hybridQueue?.isCommittedToLane) {
    return "ASSIGNED"
  }
  if (rowStatus === "NO_SHOW") return "MISSED_CALL"
  if (rowStatus === "SERVED") return "COMPLETED"
  return rowStatus || "WAITING"
}

function mapReservationRowToManagerPayload(row, timeZone = "Africa/Blantyre") {
  const metadata = parseReservationMetadata(row.metadata)
  const status = String(row.reservation_status || "").toUpperCase() || "PENDING"
  const customerName = String(metadata.customerName || row.user_name || "").trim() || "Queue Customer"
  const phone = String(metadata.phone || row.user_phone || "").trim() || "N/A"
  const identifier = String(row.identifier || metadata.plate || "").trim() || "N/A"
  const requestedLitres =
    row.requested_litres !== null && row.requested_litres !== undefined
      ? Number(row.requested_litres)
      : null

  return {
    publicId: row.reservation_public_id,
    sourceQueueJoinId: row.queue_join_public_id || null,
    customerName,
    phone,
    identifier,
    fuelType: String(row.fuel_type || "").toUpperCase() || "PETROL",
    fuelTypeLabel:
      String(row.fuel_type || "").toUpperCase() === "DIESEL" ? "Diesel" : "Unleaded",
    requestedLitres,
    slotStart: zonedSqlDateTimeToUtcIso(row.slot_start_local || row.slot_start, timeZone),
    slotEnd: zonedSqlDateTimeToUtcIso(row.slot_end_local || row.slot_end, timeZone),
    slotLabel: String(row.slot_label_local || "").trim() || buildSlotLabel(row.slot_start, row.slot_end),
    slotDateLabel: String(row.slot_date_label_local || "").trim() || null,
    status,
    statusLabel: reservationStatusToManagerLabel(status),
    notified: Boolean(metadata.notified),
    notes: String(metadata.notes || row.notes || "").trim(),
    createdAt: zonedSqlDateTimeToUtcIso(row.created_at_local || row.created_at, timeZone),
    updatedAt: zonedSqlDateTimeToUtcIso(row.updated_at_local || row.updated_at, timeZone),
  }
}

async function getFuelTypeId(code) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM fuel_types WHERE code = ${code} LIMIT 1
  `
  const fuel = rows?.[0]
  if (!fuel) throw badRequest(`Unsupported fuel type: ${code}`)
  return Number(fuel.id)
}

async function findUserByPublicId(userPublicId) {
  const scopedUserPublicId = String(userPublicId || "").trim()
  if (!scopedUserPublicId) return null

  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, phone_e164
    FROM users
    WHERE public_id = ${scopedUserPublicId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function getSettings(stationId) {
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

  return inserted[0]
}

async function normalizeQueuePositions(stationId) {
  const activeRows = await prisma.$queryRaw`
    SELECT id
    FROM queue_entries
    WHERE station_id = ${stationId}
      AND status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY position ASC, joined_at ASC, id ASC
  `

  for (let index = 0; index < activeRows.length; index += 1) {
    const row = activeRows[index]
    await prisma.$executeRaw`
      UPDATE queue_entries
      SET position = ${index + 1}
      WHERE id = ${row.id}
    `
  }
}

async function getReservationsFromTable(stationId, timeZone = "Africa/Blantyre") {
  const rows = await prisma.$queryRaw`
    SELECT
      ur.id,
      ur.public_id AS reservation_public_id,
      ur.status AS reservation_status,
      ur.user_id,
      ur.identifier,
      ur.requested_litres,
      ur.slot_start,
      ur.slot_end,
      DATE_FORMAT(ur.slot_start, '%Y-%m-%d %H:%i:%s') AS slot_start_local,
      DATE_FORMAT(ur.slot_end, '%Y-%m-%d %H:%i:%s') AS slot_end_local,
      DATE_FORMAT(ur.slot_start, '%b %e, %Y') AS slot_date_label_local,
      CASE
        WHEN ur.slot_start IS NULL THEN NULL
        ELSE CONCAT(
          DATE_FORMAT(ur.slot_start, '%h:%i %p'),
          ' - ',
          DATE_FORMAT(COALESCE(ur.slot_end, DATE_ADD(ur.slot_start, INTERVAL 30 MINUTE)), '%h:%i %p')
        )
      END AS slot_label_local,
      ur.notes,
      ur.metadata,
      ur.created_at,
      ur.updated_at,
      DATE_FORMAT(ur.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_local,
      DATE_FORMAT(ur.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at_local,
      ft.code AS fuel_type,
      u.full_name AS user_name,
      u.phone_e164 AS user_phone,
      qe.public_id AS queue_join_public_id
    FROM user_reservations ur
    INNER JOIN fuel_types ft ON ft.id = ur.fuel_type_id
    LEFT JOIN users u ON u.id = ur.user_id
    LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
    WHERE ur.station_id = ${stationId}
      AND ur.status IN ('PENDING', 'CONFIRMED')
    ORDER BY ur.created_at DESC, ur.id DESC
    LIMIT 300
  `

  return (rows || []).map((row) => mapReservationRowToManagerPayload(row, timeZone))
}

export async function getQueueSnapshot(station) {
  const stationId = Number(station?.id || 0)
  const timeZone = String(station?.timezone || "").trim() || "Africa/Blantyre"
  const [settingsRows, entriesRows, movementRows, stationRows, pumps, auditRows, hybridSnapshot] = await Promise.all([
    prisma.$queryRaw`
      SELECT *
      FROM station_queue_settings
      WHERE station_id = ${stationId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        qe.public_id,
        qe.masked_plate,
        qe.position,
        qe.status,
        qe.joined_at,
        DATE_FORMAT(qe.joined_at, '%Y-%m-%d %H:%i:%s') AS joined_at_local,
        qe.called_at,
        DATE_FORMAT(qe.called_at, '%Y-%m-%d %H:%i:%s') AS called_at_local,
        qe.grace_expires_at,
        DATE_FORMAT(qe.grace_expires_at, '%Y-%m-%d %H:%i:%s') AS grace_expires_at_local,
        qe.last_moved_at,
        DATE_FORMAT(qe.last_moved_at, '%Y-%m-%d %H:%i:%s') AS last_moved_at_local,
        qe.metadata,
        ft.code AS fuel_type
      FROM queue_entries qe
      INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
      WHERE qe.station_id = ${stationId}
        AND qe.status <> 'SERVED'
      ORDER BY qe.position ASC, qe.joined_at ASC
    `,
    prisma.$queryRaw`
      SELECT
        MAX(last_moved_at) AS last_movement_time,
        DATE_FORMAT(MAX(last_moved_at), '%Y-%m-%d %H:%i:%s') AS last_movement_time_local
      FROM queue_entries
      WHERE station_id = ${stationId}
    `,
    prisma.$queryRaw`
      SELECT public_id, name, timezone, is_active
      FROM stations
      WHERE id = ${stationId}
      LIMIT 1
    `,
    listStationPumpsWithNozzles(stationId, { includeInactive: true }),
    prisma.$queryRaw`
      SELECT
        id,
        action_type,
        payload,
        created_at,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_local
      FROM audit_log
      WHERE station_id = ${stationId}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    getHybridQueueSnapshot(stationId),
  ])

  const settings = settingsRows?.[0] || null
  const stationDetails = stationRows?.[0] || null
  const entries = (entriesRows || []).map((item) => ({
    effectiveStatus: resolveQueueEntryEffectiveStatus(item),
    hybrid: (() => {
      const metadata = parseReservationMetadata(item?.metadata)
      const hybrid = metadata?.hybridQueue && typeof metadata.hybridQueue === "object"
        ? metadata.hybridQueue
        : {}
      return {
        state: hybrid.state || null,
        assignedPumpId: hybrid.assignedPumpId || null,
        isCommittedToLane: Boolean(hybrid.isCommittedToLane),
        priorityScore: Number(hybrid.priorityScore || 0),
        missCount: Number(hybrid.missCount || 0),
      }
    })(),
    entryPublicId: item.public_id,
    maskedPlate: item.masked_plate,
    position: Number(item.position),
    status: item.status,
    fuelType: item.fuel_type,
    joinedAt: zonedSqlDateTimeToUtcIso(item.joined_at_local || item.joined_at, timeZone),
    calledAt: zonedSqlDateTimeToUtcIso(item.called_at_local || item.called_at, timeZone),
    graceExpiresAt: zonedSqlDateTimeToUtcIso(item.grace_expires_at_local || item.grace_expires_at, timeZone),
    lastMovedAt: zonedSqlDateTimeToUtcIso(item.last_moved_at_local || item.last_moved_at, timeZone),
  }))

  const currentCall = entries.find((item) => item.effectiveStatus === "CALLED") || null
  const queuePumps = await Promise.all((pumps || []).map(async (pump) => {
    const pumpPublicId = String(pump.public_id || "").trim()
    const stationPublicId = String(stationDetails?.public_id || station?.public_id || "").trim()
    const qrPayload =
      pumpPublicId && stationPublicId
        ? buildPumpQrPayload(stationPublicId, pumpPublicId)
        : null
    const qrImageDataUrl =
      pumpPublicId && stationPublicId
        ? await renderPumpQrPngDataUrl(stationPublicId, pumpPublicId)
        : null

    return {
      id: pump.public_id,
      label: `Pump ${pump.pump_number}`,
      isPilotPump: String(hybridSnapshot?.pilotPumpPublicId || "").trim() === pumpPublicId,
      hybridQueueState:
        String(hybridSnapshot?.pilotPumpPublicId || "").trim() === pumpPublicId
          ? hybridSnapshot?.queueState || PumpQueueState.OPEN_TO_WALKINS
          : null,
      status:
        pump.status === "ACTIVE"
          ? "Active"
          : pump.status === "DISPENSING"
            ? "Dispensing"
            : pump.status === "DEGRADED"
              ? "Degraded"
              : pump.status === "PAUSED"
                ? "Paused"
                : pump.status === "IDLE"
                  ? "Idle"
                  : "Offline",
      fuelType: String((pump.fuel_codes || [])[0] || pump.legacy_fuel_code || "").toLowerCase(),
      reason: pump.status_reason || "",
      qrPayload,
      qrImageDataUrl,
      nozzles: (pump.nozzles || []).map((nozzle) => ({
        publicId: nozzle.public_id,
        nozzleNumber: nozzle.nozzle_number,
        side: nozzle.side,
        fuelType: nozzle.fuel_code,
        status: nozzle.status,
      })),
    }
  }))

  const auditLogs = (auditRows || []).map((row) => {
    let parsedPayload = {}
    try {
      parsedPayload = row.payload ? JSON.parse(row.payload) : {}
    } catch (_error) {
      parsedPayload = {}
    }
    return {
      id: `AUD-${row.id}`,
      timestamp: zonedSqlDateTimeToUtcIso(row.created_at_local || row.created_at, timeZone),
      actor: "Manager",
      actionType: row.action_type,
      summary: row.action_type,
      payload: parsedPayload,
    }
  })

  return {
    stationName: stationDetails?.name || station?.name || "Station",
    stationStatus: stationDetails?.is_active ? "Online" : "Offline",
    stationTimezone: timeZone,
    lastUpdatedAt: new Date().toISOString(),
    settings: {
      ...(settings || {}),
      hybrid_pilot_enabled: Boolean(Number(hybridSnapshot?.settings?.is_enabled || 0)),
      pilot_pump_public_id: hybridSnapshot?.settings?.pilot_pump_public_id || null,
      digital_hold_timeout_seconds:
        Number(hybridSnapshot?.settings?.digital_hold_timeout_seconds || 0) || null,
      kiosk_walkin_redirect_message:
        hybridSnapshot?.settings?.kiosk_walkin_redirect_message || null,
    },
    currentCall,
    queueLength: entries.filter((item) => ["WAITING", "CALLED", "LATE", "READY_ON_SITE"].includes(item.effectiveStatus || item.status)).length,
    lastMovementTime: zonedSqlDateTimeToUtcIso(
      movementRows?.[0]?.last_movement_time_local || movementRows?.[0]?.last_movement_time || null,
      timeZone
    ),
    entries,
    pumps: queuePumps,
    auditLogs,
    hybridPilotQueue: hybridSnapshot,
  }
}

export async function findEntryOrThrow(stationId, entryPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      qe.*,
      ft.code AS fuel_code
    FROM queue_entries qe
    LEFT JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    WHERE qe.station_id = ${stationId}
      AND qe.public_id = ${entryPublicId}
    LIMIT 1
  `
  const entry = rows?.[0]
  if (!entry) throw notFound(`Queue entry not found: ${entryPublicId}`)
  return entry
}

async function resolveActorStaffId(db, stationId, userId) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  const rows = await db.$queryRaw`
    SELECT id
    FROM station_staff
    WHERE station_id = ${stationId}
      AND user_id = ${normalizedUserId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0]?.id || null
}

export async function findReservationForSettlement(db, stationId, reservationPublicId) {
  const scopedReservationPublicId = String(reservationPublicId || "").trim()
  if (!scopedReservationPublicId) return null

  const rows = await db.$queryRaw`
    SELECT
      user_reservations.id,
      user_reservations.public_id,
      user_reservations.user_id,
      user_reservations.station_id,
      user_reservations.fuel_type_id,
      user_reservations.source_queue_entry_id,
      user_reservations.requested_litres,
      user_reservations.status,
      user_reservations.metadata,
      user_reservations.fulfilled_at,
      ft.code AS fuel_code
    FROM user_reservations
    LEFT JOIN fuel_types ft ON ft.id = user_reservations.fuel_type_id
    WHERE user_reservations.station_id = ${stationId}
      AND user_reservations.public_id = ${scopedReservationPublicId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function findActiveReservationHold(db, reservationPublicId) {
  const scopedReservationPublicId = String(reservationPublicId || "").trim()
  if (!scopedReservationPublicId) return null

  const rows = await db.$queryRaw`
    SELECT id, reference, amount, currency_code
    FROM wallet_reservation_holds
    WHERE related_entity_type = 'RESERVATION'
      AND related_entity_id = ${scopedReservationPublicId}
      AND status = 'ACTIVE'
    ORDER BY id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function findLinkedTransaction(db, stationId, { reservationPublicId = null, queueEntryId = null } = {}) {
  if (!reservationPublicId && !queueEntryId) return null

  const rows = await db.$queryRaw`
    SELECT
      id,
      public_id,
      occurred_at,
      litres,
      total_amount,
      payment_method,
      payment_reference
    FROM transactions
    WHERE station_id = ${stationId}
      AND (
        (${reservationPublicId} IS NOT NULL AND reservation_public_id = ${reservationPublicId})
        OR (${queueEntryId} IS NOT NULL AND queue_entry_id = ${queueEntryId})
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function syncLinkedTransactionPaymentReference(db, { transactionId = null, paymentReference = null } = {}) {
  const normalizedTransactionId = Number(transactionId || 0)
  const normalizedPaymentReference = String(paymentReference || "").trim()
  if (normalizedTransactionId <= 0 || !normalizedPaymentReference) return

  await db.$executeRaw`
    UPDATE transactions
    SET payment_reference = ${normalizedPaymentReference}
    WHERE id = ${normalizedTransactionId}
      AND (
        payment_reference IS NULL
        OR TRIM(payment_reference) = ''
      )
  `
}

async function resolveQueueWalletPaymentReference(db, queueJoinId) {
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  if (!scopedQueueJoinId) return null

  const rows = await db.$queryRaw`
    SELECT transaction_reference
    FROM ledger_transactions
    WHERE related_entity_type = 'QUEUE'
      AND related_entity_id = ${scopedQueueJoinId}
      AND transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
      AND transaction_status = 'POSTED'
    ORDER BY COALESCE(posted_at, created_at) DESC, id DESC
    LIMIT 1
  `

  return String(rows?.[0]?.transaction_reference || "").trim() || null
}

export async function resolvePostedWalletPaymentAmount(db, { paymentReference = null } = {}) {
  const scopedPaymentReference = String(paymentReference || "").trim()
  if (!scopedPaymentReference) return null

  const rows = await db.$queryRaw`
    SELECT net_amount, gross_amount
    FROM ledger_transactions
    WHERE transaction_reference = ${scopedPaymentReference}
      AND transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
      AND transaction_status = 'POSTED'
    ORDER BY COALESCE(posted_at, created_at) DESC, id DESC
    LIMIT 1
  `

  const amount = Number(rows?.[0]?.net_amount ?? rows?.[0]?.gross_amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Number(amount.toFixed(2))
}

async function resolveStationFuelBasePricePerLitre(db, stationId, fuelTypeCode) {
  const normalizedStationId = Number(stationId || 0) || null
  const normalizedFuelTypeCode = String(fuelTypeCode || "").trim().toUpperCase()
  if (!normalizedStationId || !normalizedFuelTypeCode) return null

  const rows = await db.$queryRaw`
    SELECT prices_json
    FROM stations
    WHERE id = ${normalizedStationId}
    LIMIT 1
  `

  return resolveFuelPricePerLitre(rows?.[0]?.prices_json, normalizedFuelTypeCode)
}

function resolveQueueFuelCode(queueEntry = null) {
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const lastPumpScan =
    metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
      ? metadata.lastPumpScan
      : {}

  return (
    String(queueEntry?.fuel_code || "").trim().toUpperCase()
    || String(lastPumpScan.fuelType || "").trim().toUpperCase()
    || String(serviceRequest.fuelType || "").trim().toUpperCase()
    || ""
  )
}

export async function resolvePromotionAwareServiceAmount(
  db,
  {
    stationId,
    fuelTypeCode,
    litres,
    paymentMethod = "CASH",
    userId = null,
  } = {}
) {
  const normalizedLitres = toPositiveNumberOrNull(litres)
  const normalizedFuelTypeCode = String(fuelTypeCode || "").trim().toUpperCase()
  if (!normalizedLitres || !normalizedFuelTypeCode) return null

  try {
    const preview = await previewPromotionAwarePricing(db, {
      stationId,
      fuelTypeCode: normalizedFuelTypeCode,
      litres: normalizedLitres,
      paymentMethod,
      userId,
      cashbackDestination: "WALLET",
    })
    return toPositiveNumberOrNull(preview?.pricing?.finalPayable)
  } catch {
    return null
  }
}

export function deriveQueueWalletSettledLitres({
  settledAmount = null,
  basePricePerLitre = null,
  requestedLitres = null,
  fallbackLitres = null,
} = {}) {
  const normalizedSettledAmount = toPositiveNumberOrNull(settledAmount)
  const normalizedBasePrice = toPositiveNumberOrNull(basePricePerLitre)
  if (normalizedSettledAmount === null || normalizedBasePrice === null) return null

  const derivedLitres = Number((normalizedSettledAmount / normalizedBasePrice).toFixed(3))
  if (!Number.isFinite(derivedLitres) || derivedLitres <= 0) return null

  const normalizedRequestedLitres = toPositiveNumberOrNull(requestedLitres)
  if (normalizedRequestedLitres !== null && Math.abs(derivedLitres - normalizedRequestedLitres) <= 0.5) {
    return derivedLitres
  }

  const normalizedFallbackLitres = toPositiveNumberOrNull(fallbackLitres)
  if (normalizedFallbackLitres !== null && Math.abs(derivedLitres - normalizedFallbackLitres) <= 0.5) {
    return derivedLitres
  }

  return null
}

export async function resolveQueueServicePaymentReference(db, queueEntry) {
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const walletSettlement =
    metadata?.walletSettlement && typeof metadata.walletSettlement === "object"
      ? metadata.walletSettlement
      : {}
  const metadataPaymentReference =
    String(
      serviceRequest.walletTransactionReference
      || walletSettlement.transactionReference
      || ""
    ).trim() || null

  if (metadataPaymentReference) return metadataPaymentReference
  return resolveQueueWalletPaymentReference(db, queueEntry?.public_id)
}

export async function resolveReservationServiceHardware(stationId, reservation) {
  const metadata = parseReservationMetadata(reservation?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const lastPumpScan =
    metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
      ? metadata.lastPumpScan
      : {}

  const nozzlePublicId =
    String(serviceRequest.nozzlePublicId || lastPumpScan.nozzlePublicId || "").trim() || null
  const pumpPublicId =
    String(lastPumpScan.pumpPublicId || serviceRequest.pumpPublicId || "").trim() || null

  if (!nozzlePublicId) {
    return {
      pumpId: null,
      nozzleId: null,
      pumpPublicId,
      nozzlePublicId: null,
    }
  }

  const { nozzle } = await resolveNozzleForTransaction({
    stationId,
    nozzlePublicId,
    pumpPublicId,
  })

  return {
    pumpId: Number(nozzle?.pump_id || 0) || null,
    nozzleId: Number(nozzle?.id || 0) || null,
    pumpPublicId: String(nozzle?.pump_public_id || pumpPublicId || "").trim() || null,
    nozzlePublicId: String(nozzle?.public_id || nozzlePublicId || "").trim() || null,
  }
}

export async function resolveQueueServiceHardware(stationId, queueEntry) {
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const lastPumpScan =
    metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
      ? metadata.lastPumpScan
      : {}

  const nozzlePublicId =
    String(serviceRequest.nozzlePublicId || lastPumpScan.nozzlePublicId || "").trim() || null
  const pumpPublicId =
    String(lastPumpScan.pumpPublicId || serviceRequest.pumpPublicId || "").trim() || null

  if (!nozzlePublicId) {
    return {
      pumpId: null,
      nozzleId: null,
      pumpPublicId,
      nozzlePublicId: null,
    }
  }

  const { nozzle } = await resolveNozzleForTransaction({
    stationId,
    nozzlePublicId,
    pumpPublicId,
  })

  return {
    pumpId: Number(nozzle?.pump_id || 0) || null,
    nozzleId: Number(nozzle?.id || 0) || null,
    pumpPublicId: String(nozzle?.pump_public_id || pumpPublicId || "").trim() || null,
    nozzlePublicId: String(nozzle?.public_id || nozzlePublicId || "").trim() || null,
  }
}

function resolveStoredPumpSessionBinding(metadata = {}) {
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const attendantWorkflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}
  const pumpSession =
    attendantWorkflow?.pumpSession && typeof attendantWorkflow.pumpSession === "object"
      ? attendantWorkflow.pumpSession
      : {}

  return {
    pumpSessionPublicId:
      String(serviceRequest.pumpSessionPublicId || pumpSession.publicId || "").trim() || null,
    sessionReference:
      String(serviceRequest.sessionReference || pumpSession.sessionReference || "").trim() || null,
    telemetryCorrelationId:
      String(serviceRequest.telemetryCorrelationId || pumpSession.telemetryCorrelationId || "").trim() || null,
  }
}

async function resolveForecourtDispensedLitres(
  db,
  {
    stationId,
    pumpId = null,
    nozzleId = null,
    occurredAt = new Date(),
  } = {}
) {
  const normalizedStationId = Number(stationId || 0) || null
  const normalizedPumpId = Number(pumpId || 0) || null
  const normalizedNozzleId = Number(nozzleId || 0) || null
  const anchorTime =
    occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt : new Date()

  if (!normalizedStationId || (!normalizedPumpId && !normalizedNozzleId)) return null

  const pumpSessionRows = await db.$queryRaw`
    SELECT ps.dispensed_litres
    FROM pump_sessions ps
    WHERE ps.station_id = ${normalizedStationId}
      AND (${normalizedPumpId} IS NULL OR ps.pump_id = ${normalizedPumpId})
      AND (${normalizedNozzleId} IS NULL OR ps.nozzle_id = ${normalizedNozzleId})
      AND ps.dispensed_litres IS NOT NULL
      AND ps.dispensed_litres > 0
      AND COALESCE(ps.end_time, ps.updated_at, ps.created_at) >= DATE_SUB(${anchorTime}, INTERVAL ${FORECOURT_LITRES_PROOF_LOOKBACK_MINUTES} MINUTE)
      AND COALESCE(ps.start_time, ps.created_at) <= DATE_ADD(${anchorTime}, INTERVAL 30 MINUTE)
    ORDER BY COALESCE(ps.end_time, ps.updated_at, ps.created_at) DESC, ps.id DESC
    LIMIT 1
  `
  const pumpSessionLitres = toPositiveNumberOrNull(pumpSessionRows?.[0]?.dispensed_litres)
  if (pumpSessionLitres !== null) return pumpSessionLitres

  const telemetryRows = await db.$queryRaw`
    SELECT ptl.litres_value
    FROM pump_telemetry_logs ptl
    WHERE ptl.station_id = ${normalizedStationId}
      AND (${normalizedPumpId} IS NULL OR ptl.pump_id = ${normalizedPumpId})
      AND (${normalizedNozzleId} IS NULL OR ptl.nozzle_id = ${normalizedNozzleId})
      AND ptl.litres_value IS NOT NULL
      AND ptl.litres_value > 0
      AND ptl.happened_at >= DATE_SUB(${anchorTime}, INTERVAL ${FORECOURT_LITRES_PROOF_LOOKBACK_MINUTES} MINUTE)
      AND ptl.happened_at <= DATE_ADD(${anchorTime}, INTERVAL 30 MINUTE)
    ORDER BY ptl.happened_at DESC, ptl.id DESC
    LIMIT 1
  `
  return toPositiveNumberOrNull(telemetryRows?.[0]?.litres_value)
}

export async function resolveQueueServiceLitres(
  db,
  {
    stationId,
    queueEntry,
    fallbackLitres = null,
    occurredAt = new Date(),
    hardware = null,
  } = {}
) {
  const resolvedHardware =
    hardware?.nozzleId || hardware?.pumpId
      ? hardware
      : await resolveQueueServiceHardware(stationId, queueEntry)
  const forecourtLitres = await resolveForecourtDispensedLitres(db, {
    stationId,
    pumpId: resolvedHardware?.pumpId || null,
    nozzleId: resolvedHardware?.nozzleId || null,
    occurredAt,
  })

  if (forecourtLitres !== null) return forecourtLitres
  return toPositiveNumberOrNull(fallbackLitres)
}

export async function createReservationServiceTransaction(
  db,
  {
    stationId,
    reservation,
    actorUserId = null,
    litres,
    amount,
    paymentMethod,
    paymentReference = null,
    note,
    occurredAt = null,
  }
) {
  const reservationPublicId = String(reservation?.public_id || "").trim()
  const queueEntryId = Number(reservation?.source_queue_entry_id || 0) || null
  const reservationMetadata = parseReservationMetadata(reservation?.metadata)
  const existingPaymentReference =
    String(reservationMetadata?.walletSettlement?.transactionReference || "").trim() || null
  const effectivePaymentReference =
    String(paymentReference || existingPaymentReference || "").trim() || null
  const existing = await findLinkedTransaction(db, stationId, {
    reservationPublicId: reservationPublicId || null,
    queueEntryId,
  })
  if (existing?.public_id) {
    await syncLinkedTransactionPaymentReference(db, {
      transactionId: existing.id,
      paymentReference: effectivePaymentReference,
    })
    return {
      publicId: String(existing.public_id).trim(),
      occurredAt: existing.occurred_at ? new Date(existing.occurred_at).toISOString() : null,
      litres: Number(existing.litres || 0),
      amount: Number(existing.total_amount || 0),
      paymentMethod: String(existing.payment_method || "").trim() || null,
      existing: true,
    }
  }

  const normalizedPaymentMethod = String(paymentMethod || "OTHER").trim().toUpperCase() || "OTHER"
  const walletSettledAmount =
    normalizedPaymentMethod === "SMARTPAY" && effectivePaymentReference
      ? await resolvePostedWalletPaymentAmount(db, {
          paymentReference: effectivePaymentReference,
        })
      : null
  const normalizedLitres = Number(litres)
  const normalizedAmount = Number(walletSettledAmount ?? amount)
  if (!Number.isFinite(normalizedLitres) || normalizedLitres <= 0) {
    throw badRequest("Reservation service transaction requires served litres before completion.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw badRequest("Reservation service transaction requires a settled or explicit amount before completion.")
  }

  const actorStaffId = await resolveActorStaffId(db, stationId, actorUserId)
  // Always use server "now" for occurred_at to avoid timezone drift from DB fulfilled_at.
  const normalizedOccurredAt = new Date()
  const hardware = await resolveReservationServiceHardware(stationId, reservation)
  const storedPumpSession = resolveStoredPumpSessionBinding(reservationMetadata)
  const created = await createPromotionAwareTransaction(db, {
    stationId,
    fuelTypeCode: resolveReservationFuelCode(reservation),
    litres: normalizedLitres,
    paymentMethod: normalizedPaymentMethod,
    amount: normalizedAmount,
    userId: Number(reservation?.user_id || 0) || null,
    actorStaffId,
    actorUserId,
    pumpId: hardware.pumpId,
    nozzleId: hardware.nozzleId,
    pumpSessionPublicId: storedPumpSession.pumpSessionPublicId,
    pumpSessionReference: storedPumpSession.sessionReference,
    queueEntryId,
    reservationPublicId: reservationPublicId || null,
    note: note || null,
    occurredAt: normalizedOccurredAt,
    paymentReference: effectivePaymentReference,
    requestedLitres: Number(reservation?.requested_litres || 0) || null,
    cashbackDestination: "WALLET",
    allowLegacyAmountMismatch: true,
  })
  await syncLinkedTransactionPaymentReference(db, {
    transactionId: created?.transaction?.id,
    paymentReference: effectivePaymentReference,
  })

  return {
    publicId: created?.transaction?.publicId || null,
    occurredAt: created?.transaction?.occurredAt || normalizedOccurredAt.toISOString(),
    litres: created?.transaction?.litres ?? normalizedLitres,
    amount: created?.transaction?.totalAmount ?? normalizedAmount,
    paymentMethod: normalizedPaymentMethod,
    userId: Number(reservation?.user_id || 0) || null,
    pumpPublicId: hardware.pumpPublicId,
    nozzlePublicId: hardware.nozzlePublicId,
    receiptVerificationRef: created?.transaction?.receiptVerificationRef || null,
    cashbackStatus: created?.transaction?.cashbackStatus || "NONE",
    cashbackDestination: created?.transaction?.cashbackDestination || "NONE",
    cashbackCreditedAt: created?.transaction?.cashbackCreditedAt || null,
    cashbackWalletTransactionReference: created?.transaction?.cashbackWalletTransactionReference || null,
    pricing: created?.pricing || null,
    existing: false,
  }
}

export async function createQueueServiceTransaction(
  db,
  {
    stationId,
    queueEntry,
    actorUserId = null,
    litres,
    amount,
    paymentMethod,
    paymentReference = null,
    note,
    occurredAt = null,
  }
) {
  const queueEntryId = Number(queueEntry?.id || 0) || null
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const needsPaymentRecheck = serviceRequest?.needsPaymentRecheck === true
  const linkedPaymentReference =
    String(paymentReference || "").trim()
    || await resolveQueueServicePaymentReference(db, queueEntry)
  const effectivePaymentReference = needsPaymentRecheck ? null : linkedPaymentReference
  const normalizedPaymentMethod = resolveQueueSettlementPaymentMethod({
    paymentMethod,
    queueEntry,
    paymentReference: effectivePaymentReference,
  })
  if (normalizedPaymentMethod === "SMARTPAY" && !effectivePaymentReference) {
    throw badRequest("Queue SmartPay transaction requires a captured wallet payment reference before completion.")
  }
  const existing = await findLinkedTransaction(db, stationId, {
    queueEntryId,
  })
  if (existing?.public_id) {
    await syncLinkedTransactionPaymentReference(db, {
      transactionId: existing.id,
      paymentReference: effectivePaymentReference,
    })
    return {
      publicId: String(existing.public_id).trim(),
      occurredAt: existing.occurred_at ? new Date(existing.occurred_at).toISOString() : null,
      litres: Number(existing.litres || 0),
      amount: Number(existing.total_amount || 0),
      paymentMethod: String(existing.payment_method || "").trim() || null,
      paymentReference: String(existing.payment_reference || effectivePaymentReference || "").trim() || null,
      existing: true,
    }
  }

  const requestedLitres =
    Number(
      serviceRequest.liters
      || serviceRequest.litres
      || serviceRequest.requestedLiters
      || serviceRequest.requestedLitres
      || metadata?.requestedLiters
      || metadata?.requestedLitres
      || 0
    ) || null
  const fuelTypeCode = resolveQueueFuelCode(queueEntry) || null
  const quotedAmount =
    toPositiveNumberOrNull(serviceRequest.estimatedAmount)
    ?? toPositiveNumberOrNull(serviceRequest.amountMwk)
    ?? toPositiveNumberOrNull(metadata?.amountMwk)
  const walletSettledAmount =
    normalizedPaymentMethod === "SMARTPAY" && effectivePaymentReference && !needsPaymentRecheck
      ? await resolvePostedWalletPaymentAmount(db, {
          paymentReference: effectivePaymentReference,
        })
      : null
  const walletDerivedLitres =
    normalizedPaymentMethod === "SMARTPAY" && walletSettledAmount && fuelTypeCode
      ? deriveQueueWalletSettledLitres({
          settledAmount: walletSettledAmount,
          basePricePerLitre: await resolveStationFuelBasePricePerLitre(db, stationId, fuelTypeCode),
          requestedLitres,
          fallbackLitres: litres,
        })
      : null
  const normalizedOccurredAt =
    occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt : new Date()
  const hardware = await resolveQueueServiceHardware(stationId, queueEntry)
  const storedPumpSession = resolveStoredPumpSessionBinding(metadata)
  const resolvedLitres = await resolveQueueServiceLitres(db, {
    stationId,
    queueEntry,
    fallbackLitres: walletDerivedLitres ?? litres,
    occurredAt: normalizedOccurredAt,
    hardware,
  })
  const normalizedLitres = Number(resolvedLitres)

  if (!fuelTypeCode) {
    throw badRequest("Queue service transaction requires a fuel type from the queue entry or verified pump scan.")
  }
  if (!Number.isFinite(normalizedLitres) || normalizedLitres <= 0) {
    throw badRequest("Queue service transaction requires served litres before completion.")
  }
  const pricedAmount = await resolvePromotionAwareServiceAmount(db, {
    stationId,
    fuelTypeCode,
    litres: normalizedLitres,
    paymentMethod: normalizedPaymentMethod,
    userId: Number(queueEntry?.user_id || 0) || null,
  })
  const explicitAmount = toPositiveNumberOrNull(amount)
  const normalizedAmount = Number(
    needsPaymentRecheck
      ? explicitAmount ?? pricedAmount ?? quotedAmount
      : explicitAmount ?? walletSettledAmount ?? pricedAmount ?? quotedAmount
  )
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw badRequest(
      normalizedPaymentMethod === "SMARTPAY"
        ? "Queue service transaction requires a posted wallet payment or an explicit amount before completion."
        : "Queue service transaction requires a valid amount before completion."
    )
  }

  const actorStaffId = await resolveActorStaffId(db, stationId, actorUserId)
  const created = await createPromotionAwareTransaction(db, {
    stationId,
    fuelTypeCode,
    litres: normalizedLitres,
    paymentMethod: normalizedPaymentMethod,
    amount: normalizedAmount,
    userId: Number(queueEntry?.user_id || 0) || null,
    actorStaffId,
    actorUserId,
    pumpId: hardware.pumpId,
    nozzleId: hardware.nozzleId,
    pumpSessionPublicId: storedPumpSession.pumpSessionPublicId,
    pumpSessionReference: storedPumpSession.sessionReference,
    queueEntryId,
    reservationPublicId: null,
    note: note || null,
    occurredAt: normalizedOccurredAt,
    paymentReference: effectivePaymentReference,
    requestedLitres,
    cashbackDestination: "WALLET",
    allowLegacyAmountMismatch: true,
  })
  await syncLinkedTransactionPaymentReference(db, {
    transactionId: created?.transaction?.id,
    paymentReference: effectivePaymentReference,
  })

  return {
    publicId: created?.transaction?.publicId || null,
    occurredAt: created?.transaction?.occurredAt || normalizedOccurredAt.toISOString(),
    litres: created?.transaction?.litres ?? normalizedLitres,
    amount: created?.transaction?.totalAmount ?? normalizedAmount,
    paymentMethod: normalizedPaymentMethod,
    paymentReference: String(created?.transaction?.paymentReference || effectivePaymentReference || "").trim() || null,
    userId: Number(queueEntry?.user_id || 0) || null,
    pumpPublicId: hardware.pumpPublicId,
    nozzlePublicId: hardware.nozzlePublicId,
    receiptVerificationRef: created?.transaction?.receiptVerificationRef || null,
    cashbackStatus: created?.transaction?.cashbackStatus || "NONE",
    cashbackDestination: created?.transaction?.cashbackDestination || "NONE",
    cashbackCreditedAt: created?.transaction?.cashbackCreditedAt || null,
    cashbackWalletTransactionReference: created?.transaction?.cashbackWalletTransactionReference || null,
    pricing: created?.pricing || null,
    existing: false,
  }
}

export function resolveReservationServiceLitres(reservation, fallbackLitres = null) {
  const normalizedFallback = Number(fallbackLitres)
  if (Number.isFinite(normalizedFallback) && normalizedFallback > 0) {
    return normalizedFallback
  }
  return null
}

export async function resolveReservationServiceLitresFromForecourt(
  db,
  {
    stationId,
    reservation,
    fallbackLitres = null,
    occurredAt = new Date(),
    hardware = null,
  } = {}
) {
  const resolvedHardware =
    hardware?.nozzleId || hardware?.pumpId
      ? hardware
      : await resolveReservationServiceHardware(stationId, reservation)
  const forecourtLitres = await resolveForecourtDispensedLitres(db, {
    stationId,
    pumpId: resolvedHardware?.pumpId || null,
    nozzleId: resolvedHardware?.nozzleId || null,
    occurredAt,
  })

  if (forecourtLitres !== null) return forecourtLitres
  return resolveReservationServiceLitres(reservation, fallbackLitres)
}

export function resolveReservationServiceAmount(
  station,
  reservation,
  {
    litres = null,
    fallbackAmount = null,
    settlementAmount = null,
  } = {}
) {
  const settledAmount = Number(settlementAmount)
  if (Number.isFinite(settledAmount) && settledAmount > 0) {
    return Number(settledAmount.toFixed(2))
  }

  const explicitAmount = Number(fallbackAmount)
  if (Number.isFinite(explicitAmount) && explicitAmount > 0) {
    return Number(explicitAmount.toFixed(2))
  }

  return null
}

export function resolveReservationSettlementPaymentMethod({
  paymentMethod = null,
  settlementCapture = null,
} = {}) {
  if (settlementCapture?.transaction) return "SMARTPAY"

  const normalizedPaymentMethod = String(paymentMethod || "").trim().toUpperCase()
  if (["CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"].includes(normalizedPaymentMethod)) {
    return normalizedPaymentMethod
  }

  return "OTHER"
}

export function resolveQueueSettlementPaymentMethod({
  paymentMethod = null,
  queueEntry = null,
  paymentReference = null,
} = {}) {
  const normalizedPaymentMethod = String(paymentMethod || "").trim().toUpperCase()
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const walletSettlement =
    metadata?.walletSettlement && typeof metadata.walletSettlement === "object"
      ? metadata.walletSettlement
      : {}
  const needsPaymentRecheck = serviceRequest?.needsPaymentRecheck === true
  const resolvedPaymentMode = String(serviceRequest.paymentMode || "").trim().toUpperCase()
  const resolvedPaymentStatus = String(serviceRequest.paymentStatus || "").trim().toUpperCase()
  const resolvedPaymentReference =
    String(
      paymentReference
      || serviceRequest.walletTransactionReference
      || walletSettlement.transactionReference
      || ""
    ).trim()

  const isSmartPaySettlement =
    !needsPaymentRecheck
    && (
      resolvedPaymentMode === "PREPAY"
      || serviceRequest.prepaySelected === true
      || Boolean(String(serviceRequest.holdReference || walletSettlement.holdReference || "").trim())
      || Boolean(resolvedPaymentReference)
      || Boolean(
        String(
          serviceRequest.settlementBatchPublicId
          || walletSettlement.settlementBatchPublicId
          || ""
        ).trim()
      )
      || ["HELD", "POSTED", "CAPTURED", "SETTLED"].includes(resolvedPaymentStatus)
    )

  if (isSmartPaySettlement) return "SMARTPAY"
  if (["CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"].includes(normalizedPaymentMethod)) {
    return normalizedPaymentMethod
  }

  return "OTHER"
}

function hasQueuePrepayIntent(queueEntry = null) {
  const metadata = parseReservationMetadata(queueEntry?.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const resolvedPaymentMode = String(
    serviceRequest.paymentMode || metadata?.paymentMode || ""
  ).trim().toUpperCase()

  return resolvedPaymentMode === "PREPAY"
    || serviceRequest.prepaySelected === true
    || metadata?.prepaySelected === true
}

export function shouldCreateQueueServiceTransaction({
  queueEntry = null,
  litres = null,
  amount = null,
  paymentMethod = null,
} = {}) {
  const normalizedLitres = Number(litres)
  const hasActualLitres = Number.isFinite(normalizedLitres) && normalizedLitres > 0
  if (!hasActualLitres) return false

  const normalizedPaymentMethod = resolveQueueSettlementPaymentMethod({
    paymentMethod,
    queueEntry,
  })
  if (normalizedPaymentMethod === "SMARTPAY") return true
  if (hasQueuePrepayIntent(queueEntry)) return true

  const normalizedAmount = Number(amount)
  return Number.isFinite(normalizedAmount) && normalizedAmount > 0
}

export async function finalizeReservationSettlement(
  tx,
  {
    station,
    reservation,
    actorUserId = null,
    litres = null,
    amount = null,
    paymentMethod = null,
    description = "",
  }
) {
  if (!reservation?.id) {
    return { settlementCapture: null, forecourtTransaction: null, metadata: {} }
  }

  const metadata = parseReservationMetadata(reservation.metadata)
  const sourceQueueEntryId = Number(reservation?.source_queue_entry_id || 0) || null
  const sourceQueueEntry =
    sourceQueueEntryId
      ? (
          await tx.$queryRaw`
            SELECT id, public_id, metadata
            FROM queue_entries
            WHERE id = ${sourceQueueEntryId}
            LIMIT 1
          `
        )?.[0] || null
      : null
  const queueDerivedPaymentReference =
    String(metadata?.serviceRequest?.walletTransactionReference || "").trim()
    || await resolveQueueServicePaymentReference(tx, sourceQueueEntry)
  const fallbackWalletSettlementAmount =
    queueDerivedPaymentReference
      ? await resolvePostedWalletPaymentAmount(tx, {
          paymentReference: queueDerivedPaymentReference,
        })
      : null
  const reservationServedAt = new Date()
  const hardware = await resolveReservationServiceHardware(station.id, reservation)
  const resolvedLitres = await resolveReservationServiceLitresFromForecourt(tx, {
    stationId: station.id,
    reservation,
    fallbackLitres: litres,
    occurredAt: reservationServedAt,
    hardware,
  })
  const activeHold = await findActiveReservationHold(tx, reservation.public_id)
  const tentativePaymentMethod =
    sourceQueueEntry
      ? resolveQueueSettlementPaymentMethod({
          paymentMethod,
          queueEntry: sourceQueueEntry,
        })
      : activeHold?.id || (Number.isFinite(Number(fallbackWalletSettlementAmount || 0)) && Number(fallbackWalletSettlementAmount || 0) > 0)
        ? "SMARTPAY"
        : resolveReservationSettlementPaymentMethod({
            paymentMethod,
            settlementCapture: null,
          })
  const pricedAmount = await resolvePromotionAwareServiceAmount(tx, {
    stationId: station.id,
    fuelTypeCode: resolveReservationFuelCode(reservation),
    litres: resolvedLitres,
    paymentMethod: tentativePaymentMethod,
    userId: Number(reservation?.user_id || 0) || null,
  })
  let settlementCapture = null
  if (activeHold?.id) {
    settlementCapture = await captureReservationWalletPayment(
      {
        reservationPublicId: reservation.public_id,
        stationId: station.id,
        actorUserId: Number(actorUserId || 0) || null,
        amount: pricedAmount,
        description: description || `Reservation served at ${station.name}.`,
      },
      { tx }
    )

    metadata.walletSettlement = {
      holdReference: settlementCapture?.hold?.reference || null,
      transactionReference: settlementCapture?.transaction?.reference || null,
      settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
      settledAmount: settlementCapture?.transaction?.amount || null,
      currencyCode: settlementCapture?.transaction?.currencyCode || null,
      capturedAt: settlementCapture?.hold?.capturedAt || new Date().toISOString(),
    }
  } else if (queueDerivedPaymentReference && Number.isFinite(Number(fallbackWalletSettlementAmount || 0)) && Number(fallbackWalletSettlementAmount || 0) > 0) {
    metadata.walletSettlement = {
      ...(metadata.walletSettlement && typeof metadata.walletSettlement === "object" ? metadata.walletSettlement : {}),
      transactionReference: String(metadata?.walletSettlement?.transactionReference || queueDerivedPaymentReference).trim() || queueDerivedPaymentReference,
      settledAmount: Number(metadata?.walletSettlement?.settledAmount || fallbackWalletSettlementAmount),
      capturedAt: metadata?.walletSettlement?.capturedAt || new Date().toISOString(),
    }
  }
  const resolvedAmount = resolveReservationServiceAmount(station, reservation, {
    litres: resolvedLitres,
    fallbackAmount: pricedAmount ?? amount,
    settlementAmount:
      Number(settlementCapture?.transaction?.amount)
      || Number(metadata?.walletSettlement?.settledAmount)
      || Number(fallbackWalletSettlementAmount)
      || null,
  })
  const resolvedPaymentMethod =
    sourceQueueEntry
      ? resolveQueueSettlementPaymentMethod({
          paymentMethod,
          queueEntry: sourceQueueEntry,
        })
      : resolveReservationSettlementPaymentMethod({
          paymentMethod,
          settlementCapture,
        })

  const forecourtTransaction = await createReservationServiceTransaction(tx, {
    stationId: station.id,
    reservation,
    actorUserId,
    litres: resolvedLitres,
    amount: resolvedAmount,
    paymentMethod: resolvedPaymentMethod,
    paymentReference:
      String(
        settlementCapture?.transaction?.reference
        || metadata?.walletSettlement?.transactionReference
        || queueDerivedPaymentReference
        || ""
      ).trim() || null,
    note:
      settlementCapture?.transaction?.reference
        ? `Reservation ${reservation.public_id} settled via ${settlementCapture.transaction.reference}`
        : `Reservation ${reservation.public_id} served`,
    occurredAt: reservationServedAt,
  })

  if (forecourtTransaction?.publicId) {
    metadata.serviceTransaction = {
      publicId: forecourtTransaction.publicId,
      litres: forecourtTransaction.litres,
      amount: forecourtTransaction.amount,
      paymentMethod: forecourtTransaction.paymentMethod,
      pumpPublicId: forecourtTransaction.pumpPublicId || null,
      nozzlePublicId: forecourtTransaction.nozzlePublicId || null,
      recordedAt: forecourtTransaction.occurredAt,
    }
  }

  return {
    settlementCapture,
    forecourtTransaction,
    metadata,
  }
}

export async function finalizeQueueWalletSettlement(
  tx,
  {
    station,
    queueEntry,
    actorUserId = null,
    litres = null,
    description = "",
  }
) {
  if (!queueEntry?.id) {
    return { settlementCapture: null, metadata: {} }
  }

  const metadata = parseReservationMetadata(queueEntry.metadata)
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const queueJoinId = String(queueEntry.public_id || "").trim()
  const pricedAmount = await resolvePromotionAwareServiceAmount(tx, {
    stationId: station.id,
    fuelTypeCode: resolveQueueFuelCode(queueEntry),
    litres,
    paymentMethod: "SMARTPAY",
    userId: Number(queueEntry?.user_id || 0) || null,
  })

  let settlementCapture = null
  try {
    settlementCapture = await captureQueuePrepayWalletPayment(
      {
        queueJoinId,
        stationId: station.id,
        actorUserId: Number(actorUserId || 0) || null,
        amount: pricedAmount,
        description: description || `Queue entry served at ${station.name}.`,
      },
      { tx }
    )
  } catch (error) {
    const message = String(error?.message || "").toLowerCase()
    if (!message.includes("active queue prepay wallet hold not found")) {
      throw error
    }
  }

  if (settlementCapture?.transaction?.reference) {
    metadata.walletSettlement = {
      holdReference: settlementCapture?.hold?.reference || null,
      transactionReference: settlementCapture?.transaction?.reference || null,
      settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
      settledAmount: settlementCapture?.transaction?.amount || null,
      currencyCode: settlementCapture?.transaction?.currencyCode || null,
      capturedAt: settlementCapture?.hold?.capturedAt || new Date().toISOString(),
    }
    metadata.serviceRequest = {
      ...serviceRequest,
      paymentStatus: settlementCapture?.transaction?.status || "POSTED",
      holdReference: settlementCapture?.hold?.reference || null,
      walletTransactionReference: settlementCapture?.transaction?.reference || null,
      settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
      walletAvailableBalanceAfterPayment: settlementCapture?.wallet?.availableBalance ?? serviceRequest.walletAvailableBalanceAfterPayment ?? null,
    }
    return { settlementCapture, metadata }
  }

  const queueDerivedPaymentReference =
    String(serviceRequest.walletTransactionReference || "").trim()
    || await resolveQueueServicePaymentReference(tx, queueEntry)
  const fallbackWalletSettlementAmount =
    queueDerivedPaymentReference
      ? await resolvePostedWalletPaymentAmount(tx, {
          paymentReference: queueDerivedPaymentReference,
        })
      : null

  if (queueDerivedPaymentReference && Number.isFinite(Number(fallbackWalletSettlementAmount || 0)) && Number(fallbackWalletSettlementAmount || 0) > 0) {
    metadata.walletSettlement = {
      ...(metadata.walletSettlement && typeof metadata.walletSettlement === "object" ? metadata.walletSettlement : {}),
      transactionReference: String(metadata?.walletSettlement?.transactionReference || queueDerivedPaymentReference).trim() || queueDerivedPaymentReference,
      settledAmount: Number(metadata?.walletSettlement?.settledAmount || fallbackWalletSettlementAmount),
      capturedAt: metadata?.walletSettlement?.capturedAt || new Date().toISOString(),
    }
  }

  return { settlementCapture: null, metadata }
}

router.get(
  "/stations/:stationPublicId/reservations/user-lookup",
  stationStaffReadRole,
  asyncHandler(async (req, res) => {
    await resolveStationContext(req.params.stationPublicId)
    const query = reservationUserLookupQuerySchema.parse(req.query || {})
    const user = await findUserByPublicId(query.userPublicId)
    if (!user?.id) throw notFound(`User not found: ${query.userPublicId}`)

    return ok(res, {
      publicId: String(user.public_id || "").trim(),
      fullName: String(user.full_name || "").trim() || "Unnamed user",
      phone: String(user.phone_e164 || "").trim() || null,
    })
  })
)

router.get(
  "/stations/:stationPublicId/reservations",
  stationStaffReadRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const query = reservationListQuerySchema.parse(req.query || {})
    const statusFilter = reservationStatusFilterToEnum(query.status)
    const searchQuery = String(query.q || "").trim().toLowerCase()

    let reservations = []
    try {
      reservations = await getReservationsFromTable(station.id, station.timezone)
    } catch (error) {
      if (isReservationsTableMissingError(error)) {
        throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
      }
      throw error
    }

    const filtered = reservations.filter((item) => {
      const matchStatus = !statusFilter || item.status === statusFilter
      if (!matchStatus) return false
      if (!searchQuery) return true

      return (
        String(item.publicId || "").toLowerCase().includes(searchQuery) ||
        String(item.customerName || "").toLowerCase().includes(searchQuery) ||
        String(item.phone || "").toLowerCase().includes(searchQuery) ||
        String(item.identifier || "").toLowerCase().includes(searchQuery) ||
        String(item.fuelTypeLabel || "").toLowerCase().includes(searchQuery)
      )
    })

    const stats = {
      total: filtered.length,
      pending: filtered.filter((item) => item.status === "PENDING").length,
      notified: filtered.filter((item) => item.notified).length,
    }

    return ok(res, {
      items: filtered,
      stats,
    })
  })
)

router.post(
  "/stations/:stationPublicId/reservations",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = reservationCreateBodySchema.parse(req.body || {})
    const fuelTypeId = await getFuelTypeId(body.fuelType)
    const reservationPublicId = createReservationPublicIdValue({
      typeCode: "SLT",
      timestamp: new Date(),
      timeZone: station.timezone,
    })

    const slotStart = parseIsoDateTime(body.slotStart)
    const slotEndInput = parseIsoDateTime(body.slotEnd)
    const slotEnd = slotStart
      ? slotEndInput || new Date(slotStart.getTime() + 30 * 60 * 1000)
      : null
    const slotStartSql =
      slotStart
        ? utcIsoToZonedSqlDateTime(slotStart, station.timezone) ||
          slotStart.toISOString().slice(0, 19).replace("T", " ") + ".000"
        : null
    const slotEndSql =
      slotEnd
        ? utcIsoToZonedSqlDateTime(slotEnd, station.timezone) ||
          slotEnd.toISOString().slice(0, 19).replace("T", " ") + ".000"
        : null
    const reservationDate = slotStart
      ? formatDateISOInTimeZone(slotStart, station.timezone) || appTodayISO() || slotStart.toISOString().slice(0, 10)
      : formatDateISOInTimeZone(new Date(), station.timezone) || appTodayISO() || new Date().toISOString().slice(0, 10)
    const requestedLitres = Number(body.requestedLitres)
    const hasRequestedLitres = Number.isFinite(requestedLitres) && requestedLitres > 0

    let matchedUser = null
    if (body.userPublicId) {
      matchedUser = await findUserByPublicId(body.userPublicId)
      if (!matchedUser?.id) {
        throw badRequest("Selected user ID was not found.")
      }
    } else {
      const matchedUserRows = await prisma.$queryRaw`
        SELECT id, public_id, full_name, phone_e164
        FROM users
        WHERE phone_e164 = ${body.phone}
        LIMIT 1
      `
      matchedUser = matchedUserRows?.[0] || null
    }
    const matchedUserId = Number(matchedUser?.id || 0)
    const userId = Number.isFinite(matchedUserId) && matchedUserId > 0 ? matchedUserId : null

    const metadata = JSON.stringify({
      customerName:
        String(matchedUser?.full_name || "").trim() || body.customerName,
      phone:
        String(matchedUser?.phone_e164 || "").trim() || body.phone,
      userPublicId: String(body.userPublicId || matchedUser?.public_id || "").trim() || null,
      notes: body.notes || "",
      notified: false,
      source: "manager_manual",
    })

    try {
      await prisma.$executeRaw`
        INSERT INTO user_reservations (
          public_id,
          user_id,
          station_id,
          fuel_type_id,
          reservation_date,
          slot_start,
          slot_end,
          requested_litres,
          identifier,
          status,
          notes,
          metadata
        )
        VALUES (
          ${reservationPublicId},
          ${userId},
          ${station.id},
          ${fuelTypeId},
          ${reservationDate},
          ${slotStartSql},
          ${slotEndSql},
          ${hasRequestedLitres ? requestedLitres : null},
          ${body.identifier || null},
          ${body.status || "PENDING"},
          ${body.notes || null},
          ${metadata}
        )
      `
    } catch (error) {
      if (isReservationsTableMissingError(error)) {
        throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
      }
      throw error
    }

    await writeAuditLog({
      stationId: station.id,
      actionType: "RESERVATION_CREATE",
      payload: {
        reservationPublicId,
        userPublicId: String(body.userPublicId || matchedUser?.public_id || "").trim() || null,
        fuelType: body.fuelType,
        requestedLitres: hasRequestedLitres ? requestedLitres : null,
      },
    })

    return ok(res, { reservationPublicId }, 201)
  })
)

router.post(
  "/stations/:stationPublicId/reservations/:reservationPublicId/notify",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const reservationPublicId = String(req.params.reservationPublicId || "").trim()
    if (!reservationPublicId) throw badRequest("reservationPublicId is required")

    let reservation
    try {
      const rows = await prisma.$queryRaw`
        SELECT
          id,
          status,
          metadata,
          confirmed_at,
          user_id,
          requested_litres,
          slot_start,
          slot_end,
          DATE_FORMAT(slot_start, '%Y-%m-%d %H:%i:%s') AS slot_start_local,
          DATE_FORMAT(slot_end, '%Y-%m-%d %H:%i:%s') AS slot_end_local,
          CASE
            WHEN slot_start IS NULL THEN NULL
            ELSE CONCAT(
              DATE_FORMAT(slot_start, '%h:%i %p'),
              ' - ',
              DATE_FORMAT(COALESCE(slot_end, DATE_ADD(slot_start, INTERVAL 30 MINUTE)), '%h:%i %p')
            )
          END AS slot_label_local
        FROM user_reservations
        WHERE station_id = ${station.id}
          AND public_id = ${reservationPublicId}
        LIMIT 1
      `
      reservation = rows?.[0] || null
    } catch (error) {
      if (isReservationsTableMissingError(error)) {
        throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
      }
      throw error
    }

    if (!reservation?.id) throw notFound(`Reservation not found: ${reservationPublicId}`)

    const metadata = parseReservationMetadata(reservation.metadata)
    metadata.notified = true
    metadata.notifiedAt = new Date().toISOString()

    const currentStatus = String(reservation.status || "").toUpperCase()
    const nextStatus = currentStatus === "PENDING" ? "CONFIRMED" : currentStatus
    const confirmedAt =
      nextStatus === "CONFIRMED" ? reservation.confirmed_at || new Date() : reservation.confirmed_at

    await prisma.$executeRaw`
      UPDATE user_reservations
      SET
        status = ${nextStatus},
        metadata = ${JSON.stringify(metadata)},
        confirmed_at = ${confirmedAt},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${reservation.id}
    `

    await writeAuditLog({
      stationId: station.id,
      actionType: "RESERVATION_NOTIFY",
      payload: { reservationPublicId },
    })

    let alert = null
    const reservationUserId = Number(reservation.user_id || 0)
    if (Number.isFinite(reservationUserId) && reservationUserId > 0) {
      try {
        await ensureUserAlertsTableReady()
      } catch (error) {
        throw badRequest(error?.message || "User alerts storage is unavailable.")
      }

      const slotLabel = String(reservation.slot_label_local || "").trim() || buildSlotLabel(reservation.slot_start, reservation.slot_end)
      alert = await createUserAlert({
        userId: reservationUserId,
        stationId: Number(station.id),
        reservationPublicId,
        category: "RESERVATION",
        title: "Proceed to station",
        body:
          slotLabel && slotLabel !== "No slot"
            ? `${station.name} is ready for you. Reservation slot ${slotLabel}.`
            : `${station.name} is ready for you. Please proceed to the station.`,
        metadata: {
          event: "manager_notify",
          stationPublicId: station.public_id,
          stationName: station.name,
          reservationStatus: nextStatus,
          requestedLitres:
            reservation.requested_litres !== null && reservation.requested_litres !== undefined
              ? Number(reservation.requested_litres)
              : null,
          slotStart: zonedSqlDateTimeToUtcIso(reservation.slot_start_local || reservation.slot_start, station.timezone),
          slotEnd: zonedSqlDateTimeToUtcIso(reservation.slot_end_local || reservation.slot_end, station.timezone),
        },
      })
      publishUserAlert({
        userId: reservationUserId,
        eventType: "user_alert:new",
        data: alert,
      })

      await sendPushAlertToUser({
        userId: reservationUserId,
        notification: {
          title: alert.title,
          body: alert.message,
          tag: alert.publicId || reservationPublicId,
          url: "/m/alerts",
          icon: "/smartlogo.png",
          badge: "/smartlogo.png",
        },
        data: {
          alertPublicId: alert.publicId || null,
          reservationPublicId,
          stationPublicId: station.public_id,
        },
      }).catch(() => {
        // Push is best-effort and should never block reservation notify.
      })
    }

    return ok(res, {
      reservationPublicId,
      status: nextStatus,
      notified: true,
      alertCreated: Boolean(alert?.publicId),
      alert,
    })
  })
)

router.post(
  "/stations/:stationPublicId/reservations/:reservationPublicId/complete",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = servedBodySchema.parse(req.body || {})
    const reservationPublicId = String(req.params.reservationPublicId || "").trim()
    if (!reservationPublicId) throw badRequest("reservationPublicId is required")

    let reservation
    try {
      const rows = await prisma.$queryRaw`
        SELECT
          user_reservations.id,
          user_reservations.public_id,
          user_reservations.user_id,
          user_reservations.station_id,
          user_reservations.fuel_type_id,
          user_reservations.source_queue_entry_id,
          user_reservations.requested_litres,
          user_reservations.status,
          user_reservations.metadata,
          user_reservations.fulfilled_at,
          ft.code AS fuel_code
        FROM user_reservations
        LEFT JOIN fuel_types ft ON ft.id = user_reservations.fuel_type_id
        WHERE user_reservations.station_id = ${station.id}
          AND user_reservations.public_id = ${reservationPublicId}
        LIMIT 1
      `
      reservation = rows?.[0] || null
    } catch (error) {
      if (isReservationsTableMissingError(error)) {
        throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
      }
      throw error
    }

    if (!reservation?.id) throw notFound(`Reservation not found: ${reservationPublicId}`)

    const currentStatus = String(reservation.status || "").toUpperCase()
    if (currentStatus === "FULFILLED") {
      return ok(res, { reservationPublicId, status: "FULFILLED", completed: true })
    }
    if (["CANCELLED", "EXPIRED"].includes(currentStatus)) {
      throw badRequest("Only active reservations can be marked as completed.")
    }

    let settlementCapture = null
    let forecourtTransaction = null
    await prisma.$transaction(async (tx) => {
      const finalized = await finalizeReservationSettlement(tx, {
        station,
        reservation,
        actorUserId: Number(req.auth?.userId || 0) || null,
        litres: body.litres,
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        description: `Reservation served at ${station.name}.`,
      })
      settlementCapture = finalized.settlementCapture
      forecourtTransaction = finalized.forecourtTransaction

      await tx.$executeRaw`
        UPDATE user_reservations
        SET
          status = 'FULFILLED',
          fulfilled_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3),
          metadata = ${JSON.stringify(finalized.metadata)}
        WHERE id = ${reservation.id}
      `
    })

    await writeAuditLog({
      stationId: station.id,
      actionType: "RESERVATION_COMPLETE",
      payload: {
        reservationPublicId,
        settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
        walletTransactionReference: settlementCapture?.transaction?.reference || null,
        forecourtTransactionPublicId: forecourtTransaction?.publicId || null,
      },
    })

    await notifyUserOfCashbackAward({
      userId: Number(reservation.user_id || 0) || null,
      station,
      transaction: forecourtTransaction || null,
      pricing: forecourtTransaction?.pricing || null,
      reservationPublicId,
    })

    return ok(res, {
      reservationPublicId,
      status: "FULFILLED",
      completed: true,
      walletPayment: settlementCapture?.transaction || null,
      settlement: settlementCapture?.settlement || null,
      forecourtTransaction,
    })
  })
)

router.delete(
  "/stations/:stationPublicId/reservations/:reservationPublicId",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const reservationPublicId = String(req.params.reservationPublicId || "").trim()
    if (!reservationPublicId) throw badRequest("reservationPublicId is required")

    let reservation
    try {
      const rows = await prisma.$queryRaw`
        SELECT id
        FROM user_reservations
        WHERE station_id = ${station.id}
          AND public_id = ${reservationPublicId}
        LIMIT 1
      `
      reservation = rows?.[0] || null
    } catch (error) {
      if (isReservationsTableMissingError(error)) {
        throw badRequest("Reservations storage is unavailable. Run migration 015_create_user_reservations.sql.")
      }
      throw error
    }

    if (!reservation?.id) throw notFound(`Reservation not found: ${reservationPublicId}`)

    await prisma.$executeRaw`
      UPDATE user_reservations
      SET
        status = 'CANCELLED',
        cancelled_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${reservation.id}
    `

    await writeAuditLog({
      stationId: station.id,
      actionType: "RESERVATION_CANCEL",
      payload: { reservationPublicId },
    })

    return ok(res, { reservationPublicId, cancelled: true })
  })
)

router.get(
  "/stations/:stationPublicId/queue/snapshot",
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    await getSettings(station.id)
    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/join",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = joinBodySchema.parse(req.body)
    const settings = await getSettings(station.id)

    if (!Number(settings.is_queue_enabled)) throw badRequest("Queue is disabled")
    if (Number(settings.joins_paused)) throw badRequest("Queue joins are currently paused")
    if (body.fuelType === "PETROL" && !Number(settings.petrol_enabled)) throw badRequest("Petrol queue is disabled")
    if (body.fuelType === "DIESEL" && !Number(settings.diesel_enabled)) throw badRequest("Diesel queue is disabled")

    const countRows = await prisma.$queryRaw`
      SELECT COUNT(*) AS active_count
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
    `
    const activeCount = Number(countRows?.[0]?.active_count || 0)
    if (activeCount >= Number(settings.capacity)) {
      throw badRequest("Queue capacity reached")
    }

    const fuelTypeId = await getFuelTypeId(body.fuelType)
    const userId = body.userPublicId
      ? (
          await prisma.$queryRaw`
            SELECT id FROM users WHERE public_id = ${body.userPublicId} LIMIT 1
          `
        )?.[0]?.id || null
      : null

    const posRows = await prisma.$queryRaw`
      SELECT COALESCE(MAX(position), 0) AS max_position
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
    `
    const nextPosition = Number(posRows?.[0]?.max_position || 0) + 1

    const newPublicId = createPublicId()
    await prisma.$executeRaw`
      INSERT INTO queue_entries (
        station_id, public_id, user_id, masked_plate, fuel_type_id, position, status, last_moved_at
      )
      VALUES (
        ${station.id}, ${newPublicId}, ${userId}, ${body.maskedPlate || null}, ${fuelTypeId},
        ${nextPosition}, 'WAITING', CURRENT_TIMESTAMP(3)
      )
    `
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_JOIN",
      payload: body,
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot, 201)
  })
)

router.post(
  "/stations/:stationPublicId/queue/call-next",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const settings = await getSettings(station.id)
    const rows = await prisma.$queryRaw`
      SELECT id, public_id
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND status IN ('WAITING', 'LATE')
      ORDER BY position ASC, joined_at ASC
      LIMIT 1
    `

    const target = rows?.[0]
    if (!target) throw badRequest("No queue entry available to call")

    await prisma.$executeRaw`
      UPDATE queue_entries
      SET
        status = 'CALLED',
        called_at = CURRENT_TIMESTAMP(3),
        grace_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${Number(settings.grace_minutes)} MINUTE),
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${target.id}
    `
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_CALL_NEXT",
      payload: { entryPublicId: target.public_id },
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/recall",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = recallBodySchema.parse(req.body)
    const settings = await getSettings(station.id)
    const entry = await findEntryOrThrow(station.id, body.entryPublicId)

    await prisma.$executeRaw`
      UPDATE queue_entries
      SET
        status = 'CALLED',
        called_at = CURRENT_TIMESTAMP(3),
        grace_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${Number(settings.grace_minutes)} MINUTE),
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${entry.id}
    `
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_RECALL",
      payload: body,
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/call-position",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = callPositionBodySchema.parse(req.body)
    const settings = await getSettings(station.id)
    const rows = await prisma.$queryRaw`
      SELECT id, public_id
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND position = ${body.position}
        AND status IN ('WAITING', 'LATE', 'CALLED')
      LIMIT 1
    `

    const target = rows?.[0]
    if (!target) throw notFound(`No queue entry at position ${body.position}`)

    await prisma.$executeRaw`
      UPDATE queue_entries
      SET
        status = 'CALLED',
        called_at = CURRENT_TIMESTAMP(3),
        grace_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${Number(settings.grace_minutes)} MINUTE),
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${target.id}
    `
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_CALL_POSITION",
      payload: body,
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/:entryPublicId/no-show",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = noShowBodySchema.parse(req.body)
    const entry = await findEntryOrThrow(station.id, req.params.entryPublicId)

    if (body.behavior === "remove") {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE queue_entries
          SET
            status = 'NO_SHOW',
            last_moved_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${entry.id}
        `

        await releaseQueuePrepayWalletHold(
          {
            queueJoinId: String(entry.public_id || "").trim(),
            actorUserId: Number(req.auth?.userId || 0) || null,
            reason: "QUEUE_NO_SHOW_REMOVED",
          },
          { tx }
        )
      })
    } else {
      const posRows = await prisma.$queryRaw`
        SELECT COALESCE(MAX(position), 0) AS max_position
        FROM queue_entries
        WHERE station_id = ${station.id}
          AND status IN ('WAITING', 'CALLED', 'LATE')
      `
      const maxPosition = Number(posRows?.[0]?.max_position || 0)
      await prisma.$executeRaw`
        UPDATE queue_entries
        SET
          status = 'WAITING',
          position = ${maxPosition + 1},
          called_at = NULL,
          grace_expires_at = NULL,
          last_moved_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${entry.id}
      `
    }

    await normalizeQueuePositions(station.id)
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_NO_SHOW",
      payload: { ...body, entryPublicId: req.params.entryPublicId },
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/:entryPublicId/late",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const entry = await findEntryOrThrow(station.id, req.params.entryPublicId)

    await prisma.$executeRaw`
      UPDATE queue_entries
      SET status = 'LATE', last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${entry.id}
    `
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_MARK_LATE",
      payload: { entryPublicId: req.params.entryPublicId },
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.post(
  "/stations/:stationPublicId/queue/:entryPublicId/served",
  queueOperatorRole,
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = servedBodySchema.parse(req.body || {})
    const entry = await findEntryOrThrow(station.id, req.params.entryPublicId)

    let settlementCapture = null
    let forecourtTransaction = null
    const queuePaymentMethod = resolveQueueSettlementPaymentMethod({
      paymentMethod: body.paymentMethod || null,
      queueEntry: entry,
    })
    const servedAt = new Date()
    const queuePaymentReference = await resolveQueueServicePaymentReference(prisma, entry)
    const queueMetadata = parseReservationMetadata(entry.metadata)
    const resolvedQueueLitres = await resolveQueueServiceLitres(prisma, {
      stationId: station.id,
      queueEntry: entry,
      fallbackLitres: body.litres,
      occurredAt: servedAt,
    })
    const shouldCreateQueueTransaction = shouldCreateQueueServiceTransaction({
      queueEntry: entry,
      litres: resolvedQueueLitres,
      amount: body.amount,
      paymentMethod: queuePaymentMethod,
    })

    if (shouldCreateQueueTransaction) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE queue_entries
          SET
            status = 'SERVED',
            served_at = CURRENT_TIMESTAMP(3),
            last_moved_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${entry.id}
        `

        const finalizedSettlement = await finalizeQueueWalletSettlement(tx, {
          station,
          queueEntry: entry,
          actorUserId: Number(req.auth?.userId || 0) || null,
          litres: resolvedQueueLitres,
          description: `Queue entry ${entry.public_id} served at ${station.name}.`,
        })
        settlementCapture = finalizedSettlement.settlementCapture
        const nextMetadata = finalizedSettlement.metadata || queueMetadata

        forecourtTransaction = await createQueueServiceTransaction(tx, {
          stationId: station.id,
          queueEntry: entry,
          actorUserId: Number(req.auth?.userId || 0) || null,
          litres: resolvedQueueLitres,
          amount: body.amount,
          paymentMethod: queuePaymentMethod,
          paymentReference: queuePaymentReference,
          note: `Queue entry ${entry.public_id} served at ${station.name}.`,
          occurredAt: servedAt,
        })

        if (forecourtTransaction?.publicId) {
          const persistedMetadata = {
            ...nextMetadata,
            serviceTransaction: {
              publicId: forecourtTransaction.publicId,
              litres: forecourtTransaction.litres,
              amount: forecourtTransaction.amount,
              paymentMethod: forecourtTransaction.paymentMethod,
              paymentReference: forecourtTransaction.paymentReference || queuePaymentReference || null,
              pumpPublicId: forecourtTransaction.pumpPublicId || null,
              nozzlePublicId: forecourtTransaction.nozzlePublicId || null,
              recordedAt: forecourtTransaction.occurredAt,
            },
          }

          await tx.$executeRaw`
            UPDATE queue_entries
            SET metadata = ${JSON.stringify(persistedMetadata)}
            WHERE id = ${entry.id}
          `
        }
      })
    } else {
      await prisma.$executeRaw`
        UPDATE queue_entries
        SET
          status = 'SERVED',
          served_at = CURRENT_TIMESTAMP(3),
          last_moved_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${entry.id}
      `
    }
    await normalizeQueuePositions(station.id)
    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_MARK_SERVED",
      payload: {
        entryPublicId: req.params.entryPublicId,
        reservationPublicId: null,
        settlementBatchPublicId: settlementCapture?.settlement?.publicId || null,
        forecourtTransactionPublicId: forecourtTransaction?.publicId || null,
        ...body,
      },
    })

    await notifyUserOfCashbackAward({
      userId: Number(forecourtTransaction?.pricing?.userId || 0) || Number(forecourtTransaction?.userId || 0) || null,
      station,
      transaction: forecourtTransaction || null,
      pricing: forecourtTransaction?.pricing || null,
      reservationPublicId: null,
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

router.patch(
  "/stations/:stationPublicId/queue/settings",
  requireRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const station = await resolveStationContext(req.params.stationPublicId)
    const body = settingsBodySchema.parse(req.body || {})
    await getSettings(station.id)

    const baseQueuePatch = { ...body }
    const hybridQueuePatch = {
      is_enabled: body.hybrid_pilot_enabled,
      pilot_pump_public_id: body.pilot_pump_public_id,
      digital_hold_timeout_seconds: body.digital_hold_timeout_seconds,
      kiosk_walkin_redirect_message: body.kiosk_walkin_redirect_message,
    }
    delete baseQueuePatch.hybrid_pilot_enabled
    delete baseQueuePatch.pilot_pump_public_id
    delete baseQueuePatch.digital_hold_timeout_seconds
    delete baseQueuePatch.kiosk_walkin_redirect_message

    const fields = []
    const values = []
    Object.entries(baseQueuePatch).forEach(([key, value]) => {
      if (value === undefined) return
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
      })
    }

    await writeAuditLog({
      stationId: station.id,
      actionType: "QUEUE_SETTINGS_UPDATE",
      payload: body,
    })

    const snapshot = await getQueueSnapshot(station)
    return ok(res, snapshot)
  })
)

export default router

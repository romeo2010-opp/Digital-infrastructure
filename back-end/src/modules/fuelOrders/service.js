import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import {
  createWalletPayment,
  ensureUserWallet,
  ensureWalletTablesReady,
  recalculateWalletBalance,
} from "../common/wallets.js"
import { createPromotionAwareTransaction } from "../promotions/transactionPricing.service.js"
import { getQueueSnapshot } from "../queue/routes.js"
import {
  applyHybridReadySignalForUserPresence,
  getHybridQueueSnapshot,
} from "../queue/hybrid/integration.service.js"

const DEFAULT_MANUAL_ORDER_EXPIRY_MINUTES = Math.max(
  5,
  Number(process.env.MANUAL_FUEL_ORDER_EXPIRY_MINUTES || 45)
)
const DEFAULT_PRESENCE_EXPIRY_MINUTES = Math.max(
  1,
  Number(process.env.MANUAL_WALLET_PRESENCE_EXPIRY_MINUTES || 12)
)
const DEFAULT_PRESENCE_DEBOUNCE_SECONDS = Math.max(
  5,
  Number(process.env.MANUAL_WALLET_PRESENCE_DEBOUNCE_SECONDS || 30)
)
const TERMINAL_FUEL_ORDER_STATUSES = new Set(["completed", "expired", "cancelled", "failed"])
const ACTIVE_NEARBY_FUEL_ORDER_STATUSES = new Set(["at_station", "near_pump"])
const ACTIVE_ATTACHABLE_FUEL_ORDER_STATUSES = new Set(["awaiting_station", "at_station", "near_pump", "attached_to_session"])
const ACTIVE_PUMP_SESSION_STATUSES = new Set(["CREATED", "STARTED", "DISPENSING"])

export const FUEL_ORDER_ACCESS_MODES = Object.freeze({
  RESERVATION: "reservation",
  QUEUE: "queue",
  MANUAL: "manual",
})

export const FUEL_ORDER_SOURCES = Object.freeze({
  MOBILE_APP: "mobile_app",
  KIOSK: "kiosk",
  ATTENDANT: "attendant",
  TELEMETRY: "telemetry",
})

export const FUEL_ORDER_STATUSES = Object.freeze({
  CREATED: "created",
  AWAITING_STATION: "awaiting_station",
  AT_STATION: "at_station",
  NEAR_PUMP: "near_pump",
  ATTACHED_TO_SESSION: "attached_to_session",
  DISPENSING: "dispensing",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FAILED: "failed",
})

export const PAYMENT_METHODS = Object.freeze({
  WALLET: "wallet",
  CASH: "cash",
  POS: "pos",
})

export const PAYMENT_INTENT_STATUSES = Object.freeze({
  PENDING: "pending",
  HELD: "held",
  CAPTURED: "captured",
  RELEASED: "released",
  FAILED: "failed",
  CANCELLED: "cancelled",
})

export const PRESENCE_PROXIMITY_LEVELS = Object.freeze({
  STATION: "station",
  LANE: "lane",
  PUMP: "pump",
})

const FUEL_ORDER_TRANSITIONS = new Map([
  [FUEL_ORDER_STATUSES.CREATED, new Set([
    FUEL_ORDER_STATUSES.AWAITING_STATION,
    FUEL_ORDER_STATUSES.CANCELLED,
    FUEL_ORDER_STATUSES.EXPIRED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.AWAITING_STATION, new Set([
    FUEL_ORDER_STATUSES.AT_STATION,
    FUEL_ORDER_STATUSES.NEAR_PUMP,
    FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION,
    FUEL_ORDER_STATUSES.CANCELLED,
    FUEL_ORDER_STATUSES.EXPIRED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.AT_STATION, new Set([
    FUEL_ORDER_STATUSES.NEAR_PUMP,
    FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION,
    FUEL_ORDER_STATUSES.CANCELLED,
    FUEL_ORDER_STATUSES.EXPIRED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.NEAR_PUMP, new Set([
    FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION,
    FUEL_ORDER_STATUSES.CANCELLED,
    FUEL_ORDER_STATUSES.EXPIRED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION, new Set([
    FUEL_ORDER_STATUSES.DISPENSING,
    FUEL_ORDER_STATUSES.COMPLETED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.DISPENSING, new Set([
    FUEL_ORDER_STATUSES.COMPLETED,
    FUEL_ORDER_STATUSES.FAILED,
  ])],
  [FUEL_ORDER_STATUSES.COMPLETED, new Set([])],
  [FUEL_ORDER_STATUSES.EXPIRED, new Set([])],
  [FUEL_ORDER_STATUSES.CANCELLED, new Set([])],
  [FUEL_ORDER_STATUSES.FAILED, new Set([])],
])

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toPositiveNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0
}

function normalizeFuelCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "PETROL" || normalized === "DIESEL") return normalized
  throw badRequest("fuelType must be PETROL or DIESEL.")
}

function normalizeFuelOrderStatus(value) {
  const normalized = String(value || "").trim().toLowerCase()
  return Object.values(FUEL_ORDER_STATUSES).includes(normalized) ? normalized : ""
}

function normalizePaymentIntentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase()
  return Object.values(PAYMENT_INTENT_STATUSES).includes(normalized) ? normalized : ""
}

function normalizeProximityLevel(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === PRESENCE_PROXIMITY_LEVELS.STATION) return PRESENCE_PROXIMITY_LEVELS.STATION
  if (normalized === PRESENCE_PROXIMITY_LEVELS.LANE) return PRESENCE_PROXIMITY_LEVELS.LANE
  if (normalized === PRESENCE_PROXIMITY_LEVELS.PUMP) return PRESENCE_PROXIMITY_LEVELS.PUMP
  throw badRequest("proximityLevel must be station, lane, or pump.")
}

function normalizeSource(value, fallback = FUEL_ORDER_SOURCES.MOBILE_APP) {
  const normalized = String(value || fallback).trim().toLowerCase()
  return Object.values(FUEL_ORDER_SOURCES).includes(normalized) ? normalized : fallback
}

function normalizePaymentMethod(value, fallback = PAYMENT_METHODS.WALLET) {
  const normalized = String(value || fallback).trim().toLowerCase()
  if (normalized === PAYMENT_METHODS.WALLET) return PAYMENT_METHODS.WALLET
  if (normalized === PAYMENT_METHODS.CASH) return PAYMENT_METHODS.CASH
  if (normalized === PAYMENT_METHODS.POS) return PAYMENT_METHODS.POS
  return fallback
}

function buildDisplayCode(publicId) {
  const scoped = String(publicId || "").trim().toUpperCase()
  return `MFO-${scoped.slice(0, 4)}-${scoped.slice(-4)}`
}

function buildWalletHoldReference() {
  return `WRH-${createPublicId()}`
}

function parsePriceAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value)
  const raw = String(value || "").trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, "")
  const matched = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!matched?.[1]) return null
  const amount = Number(matched[1])
  return Number.isFinite(amount) ? amount : null
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

function resolveFuelPricePerLitre(pricesJson, fuelTypeCode) {
  const normalizedFuelType = String(fuelTypeCode || "").trim().toUpperCase()
  const items = parseJsonArray(pricesJson)
  const matchingItem = items.find((item) => {
    const label = String(item?.label || item?.name || item?.fuelType || item?.type || "")
      .trim()
      .toUpperCase()
    return label === normalizedFuelType || label.includes(normalizedFuelType)
  })
  if (!matchingItem) return null

  const amount =
    parsePriceAmount(matchingItem?.pricePerLitre)
    ?? parsePriceAmount(matchingItem?.price_per_litre)
    ?? parsePriceAmount(matchingItem?.price)
    ?? parsePriceAmount(matchingItem?.amount)
    ?? parsePriceAmount(matchingItem?.value)

  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null
}

function buildStationFuelPrices(pricesJson) {
  return {
    petrol: resolveFuelPricePerLitre(pricesJson, "PETROL"),
    diesel: resolveFuelPricePerLitre(pricesJson, "DIESEL"),
  }
}

function derivePresenceBadge(level) {
  const normalized = normalizeFuelOrderStatus(level) || String(level || "").trim().toLowerCase()
  if (normalized === PRESENCE_PROXIMITY_LEVELS.PUMP) return "Near Pump"
  if (normalized === PRESENCE_PROXIMITY_LEVELS.LANE) return "At Station"
  if (normalized === PRESENCE_PROXIMITY_LEVELS.STATION) return "At Station"
  return "Awaiting station"
}

function deriveFuelOrderStatusLabel(status) {
  switch (normalizeFuelOrderStatus(status)) {
    case FUEL_ORDER_STATUSES.AWAITING_STATION:
      return "Awaiting station"
    case FUEL_ORDER_STATUSES.AT_STATION:
      return "At station"
    case FUEL_ORDER_STATUSES.NEAR_PUMP:
      return "Near pump"
    case FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION:
      return "Attached to pump"
    case FUEL_ORDER_STATUSES.DISPENSING:
      return "Dispensing"
    case FUEL_ORDER_STATUSES.COMPLETED:
      return "Completed"
    case FUEL_ORDER_STATUSES.EXPIRED:
      return "Expired"
    case FUEL_ORDER_STATUSES.CANCELLED:
      return "Cancelled"
    case FUEL_ORDER_STATUSES.FAILED:
      return "Failed"
    default:
      return "Created"
  }
}

export function shouldDeduplicatePresenceEvent(previousSeenAt, nextSeenAt, debounceSeconds = DEFAULT_PRESENCE_DEBOUNCE_SECONDS) {
  const previousMs = Date.parse(String(previousSeenAt || ""))
  const nextMs = Date.parse(String(nextSeenAt || ""))
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return false
  return Math.abs(nextMs - previousMs) <= Math.max(1, Number(debounceSeconds || 0)) * 1000
}

export function canTransitionFuelOrder(currentStatus, nextStatus) {
  const current = normalizeFuelOrderStatus(currentStatus)
  const next = normalizeFuelOrderStatus(nextStatus)
  if (!current || !next) return false
  if (current === next) return true
  return Boolean(FUEL_ORDER_TRANSITIONS.get(current)?.has(next))
}

export function assertFuelOrderTransition(currentStatus, nextStatus, message = "") {
  const current = normalizeFuelOrderStatus(currentStatus)
  const next = normalizeFuelOrderStatus(nextStatus)
  if (canTransitionFuelOrder(current, next)) return next
  throw badRequest(message || `Invalid fuel order transition from ${current || "unknown"} to ${next || "unknown"}.`)
}

export function calculateManualOrderHoldAmount({
  requestedAmountMwk = null,
  requestedLitres = null,
  stationPricePerLitre = null,
} = {}) {
  const directAmount = toPositiveNumberOrNull(requestedAmountMwk)
  if (directAmount !== null) return Number(directAmount.toFixed(2))

  const litres = toPositiveNumberOrNull(requestedLitres)
  const pricePerLitre = toPositiveNumberOrNull(stationPricePerLitre)
  if (litres === null || pricePerLitre === null) {
    throw badRequest("A manual wallet order needs either requestedAmountMwk or requestedLitres priced at the station.")
  }
  return Number((litres * pricePerLitre).toFixed(2))
}

function derivePresenceDrivenStatus(level) {
  const proximity = normalizeProximityLevel(level)
  return proximity === PRESENCE_PROXIMITY_LEVELS.PUMP
    ? FUEL_ORDER_STATUSES.NEAR_PUMP
    : FUEL_ORDER_STATUSES.AT_STATION
}

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase()
  const mentionsFuelOrderTables =
    message.includes("fuel_orders") ||
    message.includes("payment_intents") ||
    message.includes("presence_events") ||
    message.includes("fuel_order_id")

  if (!mentionsFuelOrderTables) return false
  return (
    message.includes("doesn't exist")
    || message.includes("does not exist")
    || message.includes("unknown table")
    || message.includes("unknown column")
  )
}

export async function ensureFuelOrderTablesReady(db = prisma) {
  try {
    await db.$queryRaw`
      SELECT id, public_id, display_code, status
      FROM fuel_orders
      LIMIT 1
    `
    await db.$queryRaw`
      SELECT id, public_id, fuel_order_id, payment_status
      FROM payment_intents
      LIMIT 1
    `
    await db.$queryRaw`
      SELECT id, public_id, station_id, proximity_level
      FROM presence_events
      LIMIT 1
    `
    await db.$queryRaw`
      SELECT id, fuel_order_id
      FROM pump_sessions
      LIMIT 1
    `
    await db.$queryRaw`
      SELECT id, fuel_order_id
      FROM transactions
      LIMIT 1
    `
  } catch (error) {
    if (isMissingTableError(error)) {
      throw badRequest(
        "Manual fuel order storage is unavailable. Run SQL migration 054_manual_wallet_fuel_orders.sql."
      )
    }
    throw error
  }
}

async function resolveStationContext(stationIdentifier) {
  const numericId = Number(stationIdentifier || 0)
  if (Number.isFinite(numericId) && numericId > 0) {
    const rows = await prisma.$queryRaw`
      SELECT id, public_id, name, timezone, prices_json
      FROM stations
      WHERE id = ${numericId}
      LIMIT 1
    `
    const row = rows?.[0] || null
    if (!row?.id) throw notFound(`Station not found: ${stationIdentifier}`)
    return row
  }

  const station = await resolveStationOrThrow(stationIdentifier)
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, timezone, prices_json
    FROM stations
    WHERE id = ${station.id}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveFuelTypeByCode(db, fuelTypeCode) {
  const normalizedFuelType = normalizeFuelCode(fuelTypeCode)
  const rows = await db.$queryRaw`
    SELECT id, code, name
    FROM fuel_types
    WHERE code = ${normalizedFuelType}
    LIMIT 1
  `
  const row = rows?.[0] || null
  if (!row?.id) throw badRequest(`Unsupported fuel type: ${normalizedFuelType}`)
  return row
}

async function resolveUserByPublicId(db, userPublicId) {
  const scopedUserPublicId = String(userPublicId || "").trim()
  const rows = await db.$queryRaw`
    SELECT id, public_id, full_name
    FROM users
    WHERE public_id = ${scopedUserPublicId}
    LIMIT 1
  `
  const row = rows?.[0] || null
  if (!row?.id) throw notFound(`User not found: ${scopedUserPublicId}`)
  return row
}

async function resolveWalletRowForUser(db, userId, { forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT id, user_id, wallet_public_id, wallet_number, currency_code, status
    FROM wallets
    WHERE user_id = ${userId}
      AND currency_code = 'MWK'
    LIMIT 1
    ${lockingClause}
  `
  const row = rows?.[0] || null
  if (!row?.id) throw badRequest("Wallet not found for the user.")
  return row
}

async function loadWalletBalanceSnapshot(db, walletId, currencyCode = "MWK") {
  const rows = await db.$queryRaw`
    SELECT
      wb.id,
      wb.pending_inflow,
      wb.pending_outflow,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN le.entry_side = 'CREDIT' THEN le.amount
            ELSE (0 - le.amount)
          END
        )
        FROM ledger_entries le
        INNER JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
        INNER JOIN ledger_accounts la ON la.id = le.ledger_account_id
        WHERE la.wallet_id = ${walletId}
          AND lt.currency_code = ${currencyCode}
          AND lt.transaction_status = 'POSTED'
      ), 0.00) AS computed_ledger_balance,
      COALESCE((
        SELECT SUM(wrh.amount)
        FROM wallet_reservation_holds wrh
        WHERE wrh.wallet_id = ${walletId}
          AND wrh.currency_code = ${currencyCode}
          AND wrh.status = 'ACTIVE'
      ), 0.00) AS active_hold_amount,
      COALESCE((
        SELECT SUM(wsl.amount_mwk_remaining)
        FROM wallet_station_locks wsl
        WHERE wsl.wallet_id = ${walletId}
          AND wsl.currency_code = ${currencyCode}
          AND wsl.status = 'ACTIVE'
      ), 0.00) AS active_locked_amount
    FROM wallet_balances wb
    WHERE wb.wallet_id = ${walletId}
    LIMIT 1
    FOR UPDATE
  `

  const row = rows?.[0] || null
  const pendingInflow = toMoneyNumber(row?.pending_inflow)
  const pendingOutflow = toMoneyNumber(row?.pending_outflow)
  const ledgerBalance = toMoneyNumber(row?.computed_ledger_balance)
  const activeHoldAmount = toMoneyNumber(row?.active_hold_amount)
  const lockedBalance = toMoneyNumber(row?.active_locked_amount)
  const availableBalance = Math.max(
    0,
    Number((ledgerBalance - activeHoldAmount - lockedBalance - pendingOutflow + pendingInflow).toFixed(2))
  )

  return {
    ledgerBalance,
    availableBalance,
    activeHoldAmount,
    lockedBalance,
    pendingInflow,
    pendingOutflow,
  }
}

async function resolveLatestPresenceRow(db, { fuelOrderId = null, userId = null, stationId = null } = {}) {
  const rows = await db.$queryRaw`
    SELECT
      pe.id,
      pe.public_id,
      pe.user_id,
      pe.station_id,
      pe.fuel_order_id,
      pe.beacon_id,
      pe.proximity_level,
      pe.seen_at,
      pe.metadata_json
    FROM presence_events pe
    WHERE (${fuelOrderId} IS NULL OR pe.fuel_order_id = ${fuelOrderId})
      AND (${userId} IS NULL OR pe.user_id = ${userId})
      AND (${stationId} IS NULL OR pe.station_id = ${stationId})
    ORDER BY pe.seen_at DESC, pe.id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveLatestPumpSessionForFuelOrder(db, fuelOrderId) {
  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.transaction_id,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    WHERE ps.fuel_order_id = ${fuelOrderId}
    ORDER BY COALESCE(ps.updated_at, ps.start_time, ps.created_at) DESC, ps.id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveFuelOrderTransaction(db, fuelOrderId) {
  const rows = await db.$queryRaw`
    SELECT
      t.id,
      t.public_id,
      t.payment_reference,
      t.receipt_verification_ref,
      t.litres,
      t.total_amount,
      t.final_amount_paid,
      t.occurred_at,
      t.payment_method
    FROM transactions t
    WHERE t.fuel_order_id = ${fuelOrderId}
    ORDER BY t.occurred_at DESC, t.id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolvePaymentIntentRow(db, fuelOrderId, { forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      pi.id,
      pi.public_id,
      pi.fuel_order_id,
      pi.payment_method,
      pi.hold_amount_mwk,
      pi.captured_amount_mwk,
      pi.payment_status,
      pi.hold_reference,
      pi.payment_reference,
      pi.metadata_json,
      pi.created_at,
      pi.updated_at
    FROM payment_intents pi
    WHERE pi.fuel_order_id = ${fuelOrderId}
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function resolveActiveHoldRow(db, fuelOrderPublicId, { forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      wrh.id,
      wrh.wallet_id,
      wrh.reference,
      wrh.amount,
      wrh.status,
      wrh.expires_at,
      wrh.created_at,
      wrh.released_at,
      wrh.captured_at
    FROM wallet_reservation_holds wrh
    WHERE wrh.related_entity_type = 'FUEL_ORDER'
      AND wrh.related_entity_id = ${fuelOrderPublicId}
      AND wrh.status = 'ACTIVE'
    ORDER BY wrh.id DESC
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function resolveFuelOrderRow(db, identifier, { userId = null, stationId = null, forUpdate = false } = {}) {
  const scopedIdentifier = String(identifier || "").trim()
  if (!scopedIdentifier) throw badRequest("fuelOrderId is required.")
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      fo.id,
      fo.public_id,
      fo.display_code,
      fo.user_id,
      fo.station_id,
      fo.access_mode,
      fo.fuel_type_id,
      fo.requested_amount_mwk,
      fo.requested_litres,
      fo.status,
      fo.source,
      fo.expires_at,
      fo.attached_at,
      fo.dispensed_at,
      fo.completed_at,
      fo.cancelled_at,
      fo.failed_at,
      fo.metadata_json,
      fo.created_at,
      fo.updated_at,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      ft.code AS fuel_code
    FROM fuel_orders fo
    INNER JOIN users u ON u.id = fo.user_id
    INNER JOIN stations st ON st.id = fo.station_id
    INNER JOIN fuel_types ft ON ft.id = fo.fuel_type_id
    WHERE (fo.public_id = ${scopedIdentifier} OR fo.display_code = ${scopedIdentifier})
      AND (${userId} IS NULL OR fo.user_id = ${userId})
      AND (${stationId} IS NULL OR fo.station_id = ${stationId})
    LIMIT 1
    ${lockingClause}
  `
  const row = rows?.[0] || null
  if (!row?.id) throw notFound(`Fuel order not found: ${scopedIdentifier}`)
  return row
}

async function resolveActiveManualFuelOrderForUser(db, { userId, stationId = null, forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      fo.id,
      fo.public_id,
      fo.display_code,
      fo.user_id,
      fo.station_id,
      fo.access_mode,
      fo.fuel_type_id,
      fo.requested_amount_mwk,
      fo.requested_litres,
      fo.status,
      fo.source,
      fo.expires_at,
      fo.attached_at,
      fo.dispensed_at,
      fo.completed_at,
      fo.cancelled_at,
      fo.failed_at,
      fo.metadata_json,
      fo.created_at,
      fo.updated_at,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      ft.code AS fuel_code
    FROM fuel_orders fo
    INNER JOIN users u ON u.id = fo.user_id
    INNER JOIN stations st ON st.id = fo.station_id
    INNER JOIN fuel_types ft ON ft.id = fo.fuel_type_id
    WHERE fo.user_id = ${userId}
      AND fo.access_mode = 'manual'
      AND fo.status NOT IN ('completed', 'expired', 'cancelled', 'failed')
      AND (${stationId} IS NULL OR fo.station_id = ${stationId})
    ORDER BY fo.created_at DESC, fo.id DESC
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function resolvePumpSessionRow(db, sessionIdentifier, { stationId = null, forUpdate = false } = {}) {
  const scopedIdentifier = String(sessionIdentifier || "").trim()
  if (!scopedIdentifier) throw badRequest("sessionId is required.")
  const numericId = Number(scopedIdentifier)
  const sessionId = Number.isFinite(numericId) && numericId > 0 ? numericId : null
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.fuel_order_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    WHERE (
      (${sessionId} IS NOT NULL AND ps.id = ${sessionId})
      OR ps.public_id = ${scopedIdentifier}
      OR ps.session_reference = ${scopedIdentifier}
    )
      AND (${stationId} IS NULL OR ps.station_id = ${stationId})
    LIMIT 1
    ${lockingClause}
  `
  const row = rows?.[0] || null
  if (!row?.id) throw notFound(`Pump session not found: ${scopedIdentifier}`)
  return row
}

async function resolveTelemetryDispensedLitres(db, session) {
  const sessionId = Number(session?.id || 0) || null
  const stationId = Number(session?.station_id || 0) || null
  if (!sessionId || !stationId) return null

  const rows = await db.$queryRaw`
    SELECT
      COALESCE(MAX(ptl.litres_value), 0.000) AS dispensed_litres
    FROM pump_telemetry_logs ptl
    WHERE ptl.station_id = ${stationId}
      AND (
        ptl.pump_session_id = ${sessionId}
        OR (${String(session?.telemetry_correlation_id || "")} <> '' AND ptl.telemetry_correlation_id = ${String(session?.telemetry_correlation_id || "")})
      )
  `

  return toPositiveNumberOrNull(rows?.[0]?.dispensed_litres)
}

function mapPaymentIntentRow(row) {
  if (!row?.id) return null
  return {
    publicId: String(row.public_id || "").trim() || null,
    paymentMethod: normalizePaymentMethod(row.payment_method),
    holdAmountMwk: toPositiveNumberOrNull(row.hold_amount_mwk),
    capturedAmountMwk: toPositiveNumberOrNull(row.captured_amount_mwk),
    paymentStatus: normalizePaymentIntentStatus(row.payment_status) || PAYMENT_INTENT_STATUSES.PENDING,
    holdReference: String(row.hold_reference || "").trim() || null,
    paymentReference: String(row.payment_reference || "").trim() || null,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapPresenceRow(row) {
  if (!row?.id) return null
  const proximityLevel = normalizeProximityLevel(row.proximity_level)
  return {
    publicId: String(row.public_id || "").trim() || null,
    beaconId: String(row.beacon_id || "").trim() || null,
    proximityLevel,
    presenceBadge: derivePresenceBadge(proximityLevel),
    seenAt: toIsoOrNull(row.seen_at),
    metadata: parseJsonObject(row.metadata_json),
  }
}

function mapPumpSessionRow(row) {
  if (!row?.id) return null
  return {
    id: Number(row.id),
    publicId: String(row.public_id || "").trim() || null,
    sessionReference: String(row.session_reference || "").trim() || null,
    status: String(row.session_status || "").trim().toUpperCase() || "CREATED",
    pumpPublicId: String(row.pump_public_id || "").trim() || null,
    pumpNumber: Number(row.pump_number || 0) || null,
    nozzlePublicId: String(row.nozzle_public_id || "").trim() || null,
    nozzleNumber: String(row.nozzle_number || "").trim() || null,
    dispensedLitres: toPositiveNumberOrNull(row.dispensed_litres) ?? 0,
    telemetryCorrelationId: String(row.telemetry_correlation_id || "").trim() || null,
    startTime: toIsoOrNull(row.start_time),
    endTime: toIsoOrNull(row.end_time),
  }
}

function mapTransactionRow(row) {
  if (!row?.id) return null
  return {
    publicId: String(row.public_id || "").trim() || null,
    paymentReference: String(row.payment_reference || "").trim() || null,
    receiptVerificationRef: String(row.receipt_verification_ref || "").trim() || null,
    litres: toPositiveNumberOrNull(row.litres),
    totalAmount: toPositiveNumberOrNull(row.total_amount) ?? toPositiveNumberOrNull(row.final_amount_paid),
    finalAmountPaid: toPositiveNumberOrNull(row.final_amount_paid),
    occurredAt: toIsoOrNull(row.occurred_at),
    paymentMethod: String(row.payment_method || "").trim().toUpperCase() || "OTHER",
  }
}

async function buildFuelOrderPayload(db, row) {
  const [paymentIntent, latestPresence, transaction, pumpSession] = await Promise.all([
    resolvePaymentIntentRow(db, row.id),
    resolveLatestPresenceRow(db, {
      fuelOrderId: row.id,
      userId: row.user_id,
      stationId: row.station_id,
    }),
    resolveFuelOrderTransaction(db, row.id),
    resolveLatestPumpSessionForFuelOrder(db, row.id),
  ])

  return {
    publicId: String(row.public_id || "").trim(),
    displayCode: String(row.display_code || "").trim() || buildDisplayCode(row.public_id),
    userPublicId: String(row.user_public_id || "").trim() || null,
    customerName: String(row.user_full_name || "").trim() || `Customer ${String(row.public_id || "").slice(-6)}`,
    stationPublicId: String(row.station_public_id || "").trim() || null,
    stationName: String(row.station_name || "").trim() || "Station",
    accessMode: String(row.access_mode || "").trim().toLowerCase() || FUEL_ORDER_ACCESS_MODES.MANUAL,
    fuelType: String(row.fuel_code || "").trim().toUpperCase() || "PETROL",
    requestedAmountMwk: toPositiveNumberOrNull(row.requested_amount_mwk),
    requestedLitres: toPositiveNumberOrNull(row.requested_litres),
    status: normalizeFuelOrderStatus(row.status) || FUEL_ORDER_STATUSES.CREATED,
    statusLabel: deriveFuelOrderStatusLabel(row.status),
    source: normalizeSource(row.source),
    expiresAt: toIsoOrNull(row.expires_at),
    attachedAt: toIsoOrNull(row.attached_at),
    dispensedAt: toIsoOrNull(row.dispensed_at),
    completedAt: toIsoOrNull(row.completed_at),
    cancelledAt: toIsoOrNull(row.cancelled_at),
    failedAt: toIsoOrNull(row.failed_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    metadata: parseJsonObject(row.metadata_json),
    paymentIntent: mapPaymentIntentRow(paymentIntent),
    latestPresence: mapPresenceRow(latestPresence),
    pumpSession: mapPumpSessionRow(pumpSession),
    transaction: mapTransactionRow(transaction),
  }
}

async function releaseFuelOrderHold(db, {
  fuelOrderPublicId,
  paymentIntentId = null,
  paymentStatus = PAYMENT_INTENT_STATUSES.RELEASED,
  note = "",
} = {}) {
  const holdRow = await resolveActiveHoldRow(db, fuelOrderPublicId, { forUpdate: true })
  if (!holdRow?.id) {
    if (paymentIntentId) {
      await db.$executeRaw`
        UPDATE payment_intents
        SET
          payment_status = ${paymentStatus},
          updated_at = CURRENT_TIMESTAMP(3),
          metadata_json = ${JSON.stringify({
            note: String(note || "").trim() || null,
            releasedAt: new Date().toISOString(),
          })}
        WHERE id = ${paymentIntentId}
      `
    }
    return { holdReleased: false, walletId: null }
  }

  await db.$executeRaw`
    UPDATE wallet_reservation_holds
    SET
      status = 'RELEASED',
      released_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${holdRow.id}
  `

  if (paymentIntentId) {
    await db.$executeRaw`
      UPDATE payment_intents
      SET
        payment_status = ${paymentStatus},
        updated_at = CURRENT_TIMESTAMP(3),
        metadata_json = ${JSON.stringify({
          note: String(note || "").trim() || null,
          releasedAt: new Date().toISOString(),
          holdReference: String(holdRow.reference || "").trim() || null,
        })}
      WHERE id = ${paymentIntentId}
    `
  }

  return {
    holdReleased: true,
    walletId: Number(holdRow.wallet_id || 0) || null,
  }
}

async function applyFuelOrderStatusUpdate(db, fuelOrderRow, nextStatus, {
  attachedAt = false,
  dispensedAt = false,
  completedAt = false,
  cancelledAt = false,
  failedAt = false,
  metadataPatch = null,
} = {}) {
  const currentStatus = normalizeFuelOrderStatus(fuelOrderRow?.status)
  const targetStatus = assertFuelOrderTransition(currentStatus, nextStatus)
  const nextMetadata = {
    ...parseJsonObject(fuelOrderRow?.metadata_json),
    ...(metadataPatch && typeof metadataPatch === "object" ? metadataPatch : {}),
  }

  await db.$executeRaw`
    UPDATE fuel_orders
    SET
      status = ${targetStatus},
      attached_at = ${attachedAt ? new Date() : fuelOrderRow?.attached_at || null},
      dispensed_at = ${dispensedAt ? new Date() : fuelOrderRow?.dispensed_at || null},
      completed_at = ${completedAt ? new Date() : fuelOrderRow?.completed_at || null},
      cancelled_at = ${cancelledAt ? new Date() : fuelOrderRow?.cancelled_at || null},
      failed_at = ${failedAt ? new Date() : fuelOrderRow?.failed_at || null},
      metadata_json = ${JSON.stringify(nextMetadata)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${fuelOrderRow.id}
  `

  return resolveFuelOrderRow(db, fuelOrderRow.public_id, {
    userId: fuelOrderRow.user_id,
    stationId: fuelOrderRow.station_id,
    forUpdate: true,
  })
}

async function findNearbyWalletOrderRows(db, stationId, { presenceExpiryMinutes = DEFAULT_PRESENCE_EXPIRY_MINUTES } = {}) {
  return db.$queryRaw`
    SELECT
      fo.id,
      fo.public_id,
      fo.display_code,
      fo.user_id,
      fo.station_id,
      fo.access_mode,
      fo.fuel_type_id,
      fo.requested_amount_mwk,
      fo.requested_litres,
      fo.status,
      fo.source,
      fo.expires_at,
      fo.attached_at,
      fo.dispensed_at,
      fo.completed_at,
      fo.cancelled_at,
      fo.failed_at,
      fo.metadata_json,
      fo.created_at,
      fo.updated_at,
      u.public_id AS user_public_id,
      u.full_name AS user_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name,
      ft.code AS fuel_code
    FROM fuel_orders fo
    INNER JOIN users u ON u.id = fo.user_id
    INNER JOIN stations st ON st.id = fo.station_id
    INNER JOIN fuel_types ft ON ft.id = fo.fuel_type_id
    INNER JOIN payment_intents pi ON pi.fuel_order_id = fo.id
    INNER JOIN (
      SELECT
        pe.fuel_order_id,
        MAX(pe.seen_at) AS latest_seen_at
      FROM presence_events pe
      WHERE pe.station_id = ${stationId}
      GROUP BY pe.fuel_order_id
    ) latest_presence ON latest_presence.fuel_order_id = fo.id
    WHERE fo.station_id = ${stationId}
      AND fo.access_mode = 'manual'
      AND fo.status IN ('at_station', 'near_pump')
      AND pi.payment_method = 'wallet'
      AND pi.payment_status IN ('held', 'pending')
      AND latest_presence.latest_seen_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${presenceExpiryMinutes} MINUTE)
    ORDER BY
      CASE fo.status
        WHEN 'near_pump' THEN 0
        WHEN 'at_station' THEN 1
        ELSE 2
      END,
      fo.created_at ASC,
      fo.id ASC
  `
}

export async function createManualWalletFuelOrder({
  userId,
  stationPublicId,
  fuelType,
  requestedAmountMwk = null,
  requestedLitres = null,
  source = FUEL_ORDER_SOURCES.MOBILE_APP,
} = {}) {
  await ensureFuelOrderTablesReady()
  await ensureWalletTablesReady()

  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw badRequest("Authenticated user context is required.")
  }

  const normalizedRequestedAmount = toPositiveNumberOrNull(requestedAmountMwk)
  const normalizedRequestedLitres = toPositiveNumberOrNull(requestedLitres)
  if (normalizedRequestedAmount === null && normalizedRequestedLitres === null) {
    throw badRequest("Manual wallet orders require requestedAmountMwk or requestedLitres.")
  }

  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)
  const fuelTypeRow = await resolveFuelTypeByCode(prisma, fuelType)
  const stationPricePerLitre = resolveFuelPricePerLitre(station.prices_json, fuelTypeRow.code)
  const holdAmountMwk = calculateManualOrderHoldAmount({
    requestedAmountMwk: normalizedRequestedAmount,
    requestedLitres: normalizedRequestedLitres,
    stationPricePerLitre,
  })
  const ensuredWallet = await ensureUserWallet(normalizedUserId)
  const walletId = Number(ensuredWallet?.wallet?.id || 0) || null
  if (!walletId) throw badRequest("Wallet is unavailable for the user.")

  const createdOrder = await prisma.$transaction(async (tx) => {
    const existingOrder = await resolveActiveManualFuelOrderForUser(tx, {
      userId: normalizedUserId,
      forUpdate: true,
    })
    if (existingOrder?.id) {
      throw badRequest(`An active manual fuel order already exists (${existingOrder.display_code || existingOrder.public_id}).`)
    }

    const walletRow = await resolveWalletRowForUser(tx, normalizedUserId, { forUpdate: true })
    if (String(walletRow.status || "").trim().toUpperCase() !== "ACTIVE") {
      throw badRequest("Wallet is not active. Manual wallet orders are unavailable.")
    }

    const walletBalance = await loadWalletBalanceSnapshot(tx, walletRow.id, walletRow.currency_code)
    if (walletBalance.availableBalance < holdAmountMwk) {
      throw badRequest(
        `Insufficient wallet balance. This order requires MWK ${holdAmountMwk.toLocaleString()} but only MWK ${walletBalance.availableBalance.toLocaleString()} is available.`
      )
    }

    const publicId = createPublicId()
    const displayCode = buildDisplayCode(publicId)
    const paymentIntentPublicId = createPublicId()
    const holdReference = buildWalletHoldReference()
    const metadataJson = JSON.stringify({
      stationPricePerLitre,
      source: normalizeSource(source),
      estimatedHoldAmountMwk: holdAmountMwk,
    })

    await tx.$executeRaw`
      INSERT INTO fuel_orders (
        public_id,
        display_code,
        user_id,
        station_id,
        access_mode,
        fuel_type_id,
        requested_amount_mwk,
        requested_litres,
        status,
        source,
        metadata_json
      )
      VALUES (
        ${publicId},
        ${displayCode},
        ${normalizedUserId},
        ${station.id},
        'manual',
        ${fuelTypeRow.id},
        ${normalizedRequestedAmount},
        ${normalizedRequestedLitres},
        'awaiting_station',
        ${normalizeSource(source)},
        ${metadataJson}
      )
    `

    const fuelOrder = await resolveFuelOrderRow(tx, publicId, {
      userId: normalizedUserId,
      stationId: station.id,
      forUpdate: true,
    })

    await tx.$executeRawUnsafe(
      `
        UPDATE fuel_orders
        SET
          expires_at = DATE_ADD(created_at, INTERVAL ? MINUTE),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      DEFAULT_MANUAL_ORDER_EXPIRY_MINUTES,
      fuelOrder.id
    )

    const anchoredFuelOrder = await resolveFuelOrderRow(tx, publicId, {
      userId: normalizedUserId,
      stationId: station.id,
      forUpdate: true,
    })

    await tx.$executeRaw`
      INSERT INTO wallet_reservation_holds (
        wallet_id,
        ledger_transaction_id,
        reference,
        hold_type,
        status,
        amount,
        currency_code,
        related_entity_type,
        related_entity_id,
        expires_at
      )
      VALUES (
        ${walletRow.id},
        NULL,
        ${holdReference},
        'MANUAL_HOLD',
        'ACTIVE',
        ${holdAmountMwk},
        ${walletRow.currency_code},
        'FUEL_ORDER',
        ${publicId},
        ${anchoredFuelOrder.expires_at}
      )
    `

    await tx.$executeRaw`
      INSERT INTO payment_intents (
        public_id,
        fuel_order_id,
        payment_method,
        hold_amount_mwk,
        captured_amount_mwk,
        payment_status,
        hold_reference,
        payment_reference,
        metadata_json
      )
      VALUES (
        ${paymentIntentPublicId},
        ${fuelOrder.id},
        'wallet',
        ${holdAmountMwk},
        NULL,
        'held',
        ${holdReference},
        NULL,
        ${metadataJson}
      )
    `

    return anchoredFuelOrder
  })

  if (walletId) await recalculateWalletBalance(walletId)

  await writeAuditLog({
    stationId: station.id,
    actionType: "FUEL_ORDER_MANUAL_CREATE",
    payload: {
      fuelOrderPublicId: createdOrder.public_id,
      displayCode: createdOrder.display_code,
      userId: normalizedUserId,
      userPublicId: createdOrder.user_public_id,
      fuelType: fuelTypeRow.code,
      requestedAmountMwk: normalizedRequestedAmount,
      requestedLitres: normalizedRequestedLitres,
      holdAmountMwk,
      source: normalizeSource(source),
    },
  })

  const refreshed = await resolveFuelOrderRow(prisma, createdOrder.public_id, {
    userId: normalizedUserId,
    stationId: station.id,
  })
  return buildFuelOrderPayload(prisma, refreshed)
}

export async function expireStaleManualOrders({
  stationId = null,
  userId = null,
} = {}) {
  await ensureFuelOrderTablesReady()
  const walletIds = new Set()

  const expiredOrders = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT
        fo.id,
        fo.public_id,
        fo.user_id,
        fo.station_id,
        fo.status
      FROM fuel_orders fo
      WHERE fo.access_mode = 'manual'
        AND fo.status NOT IN ('completed', 'expired', 'cancelled', 'failed')
        AND fo.expires_at IS NOT NULL
        AND fo.expires_at <= CURRENT_TIMESTAMP(3)
        AND (${stationId} IS NULL OR fo.station_id = ${stationId})
        AND (${userId} IS NULL OR fo.user_id = ${userId})
      FOR UPDATE
    `

    const results = []
    for (const row of rows || []) {
      const paymentIntent = await resolvePaymentIntentRow(tx, row.id, { forUpdate: true })
      const released = await releaseFuelOrderHold(tx, {
        fuelOrderPublicId: row.public_id,
        paymentIntentId: paymentIntent?.id || null,
        paymentStatus: PAYMENT_INTENT_STATUSES.RELEASED,
        note: "Fuel order expired before attachment.",
      })
      if (released.walletId) walletIds.add(released.walletId)

      await tx.$executeRaw`
        UPDATE fuel_orders
        SET
          status = 'expired',
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${row.id}
      `

      results.push({
        publicId: String(row.public_id || "").trim(),
        stationId: Number(row.station_id || 0) || null,
      })
    }

    return results
  })

  for (const stationOrder of expiredOrders) {
    await writeAuditLog({
      stationId: stationOrder.stationId,
      actionType: "FUEL_ORDER_EXPIRED",
      payload: {
        fuelOrderPublicId: stationOrder.publicId,
      },
    })
  }

  for (const walletId of walletIds) {
    if (!walletId) continue
    await recalculateWalletBalance(walletId)
  }

  return {
    expiredCount: expiredOrders.length,
    items: expiredOrders,
  }
}

export async function recordPresenceEvent({
  stationPublicId,
  userPublicId,
  fuelOrderId = null,
  beaconId = null,
  proximityLevel,
  seenAt = null,
  metadata = null,
  source = FUEL_ORDER_SOURCES.TELEMETRY,
} = {}) {
  await ensureFuelOrderTablesReady()

  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)
  const user = await resolveUserByPublicId(prisma, userPublicId)
  const normalizedProximityLevel = normalizeProximityLevel(proximityLevel)
  const scopedSeenAt = seenAt ? new Date(seenAt) : new Date()
  if (Number.isNaN(scopedSeenAt.getTime())) {
    throw badRequest("seenAt must be a valid ISO datetime.")
  }

  await expireStaleManualOrders({
    stationId: station.id,
    userId: user.id,
  })

  const result = await prisma.$transaction(async (tx) => {
    let order = fuelOrderId
      ? await resolveFuelOrderRow(tx, fuelOrderId, {
          userId: user.id,
          stationId: station.id,
          forUpdate: true,
        })
      : await resolveActiveManualFuelOrderForUser(tx, {
          userId: user.id,
          stationId: station.id,
          forUpdate: true,
        })

    const recentRows = await tx.$queryRaw`
      SELECT id, public_id, seen_at, proximity_level
      FROM presence_events
      WHERE user_id = ${user.id}
        AND station_id = ${station.id}
        AND COALESCE(beacon_id, '') = ${String(beaconId || "").trim()}
        AND proximity_level = ${normalizedProximityLevel}
      ORDER BY seen_at DESC, id DESC
      LIMIT 1
    `
    const recentRow = recentRows?.[0] || null
    const recentSeenAtMs = Date.parse(String(recentRow?.seen_at || ""))
    const shouldDeduplicate =
      Number.isFinite(recentSeenAtMs)
      && shouldDeduplicatePresenceEvent(recentRow?.seen_at, scopedSeenAt, DEFAULT_PRESENCE_DEBOUNCE_SECONDS)

    let presencePublicId = String(recentRow?.public_id || "").trim() || null
    if (!shouldDeduplicate) {
      presencePublicId = createPublicId()
      await tx.$executeRaw`
        INSERT INTO presence_events (
          public_id,
          user_id,
          station_id,
          fuel_order_id,
          beacon_id,
          proximity_level,
          seen_at,
          metadata_json
        )
        VALUES (
          ${presencePublicId},
          ${user.id},
          ${station.id},
          ${order?.id || null},
          ${String(beaconId || "").trim() || null},
          ${normalizedProximityLevel},
          ${scopedSeenAt},
          ${JSON.stringify({
            ...(metadata && typeof metadata === "object" ? metadata : {}),
            source: normalizeSource(source),
          })}
        )
      `
    }

    if (order?.id && !TERMINAL_FUEL_ORDER_STATUSES.has(normalizeFuelOrderStatus(order.status))) {
      const nextStatus = derivePresenceDrivenStatus(normalizedProximityLevel)
      if (nextStatus !== normalizeFuelOrderStatus(order.status) && canTransitionFuelOrder(order.status, nextStatus)) {
        order = await applyFuelOrderStatusUpdate(tx, order, nextStatus, {
          metadataPatch: {
            lastPresenceAt: scopedSeenAt.toISOString(),
            lastPresenceLevel: normalizedProximityLevel,
          },
        })
      }
    }

    const presenceRow = shouldDeduplicate
      ? {
          ...recentRow,
          public_id: presencePublicId,
          station_id: station.id,
          user_id: user.id,
          fuel_order_id: order?.id || null,
          beacon_id: beaconId,
          proximity_level: normalizedProximityLevel,
          seen_at: scopedSeenAt,
          metadata_json: JSON.stringify(metadata || {}),
        }
      : await resolveLatestPresenceRow(tx, {
          fuelOrderId: order?.id || null,
          userId: user.id,
          stationId: station.id,
        })

    return {
      order,
      presence: presenceRow,
      deduplicated: shouldDeduplicate,
    }
  })

  await writeAuditLog({
    stationId: station.id,
    actionType: "FUEL_ORDER_PRESENCE_INGEST",
    payload: {
      fuelOrderPublicId: result.order?.public_id || null,
      userPublicId: user.public_id,
      beaconId: String(beaconId || "").trim() || null,
      proximityLevel: normalizedProximityLevel,
      deduplicated: result.deduplicated,
      seenAt: scopedSeenAt.toISOString(),
    },
  })

  if (normalizedProximityLevel === PRESENCE_PROXIMITY_LEVELS.STATION || normalizedProximityLevel === PRESENCE_PROXIMITY_LEVELS.LANE || normalizedProximityLevel === PRESENCE_PROXIMITY_LEVELS.PUMP) {
    await applyHybridReadySignalForUserPresence({
      stationId: station.id,
      userPublicId: user.public_id,
      occurredAt: scopedSeenAt,
      signalType:
        normalizedProximityLevel === PRESENCE_PROXIMITY_LEVELS.PUMP
          ? "BLE_NFC"
          : "GEOFENCE",
    })
  }

  return {
    presenceEvent: mapPresenceRow(result.presence),
    deduplicated: result.deduplicated,
    fuelOrder: result.order ? await buildFuelOrderPayload(prisma, await resolveFuelOrderRow(prisma, result.order.public_id, {
      userId: user.id,
      stationId: station.id,
    })) : null,
  }
}

export async function listNearbyWalletOrdersForStation({
  stationPublicId,
} = {}) {
  await ensureFuelOrderTablesReady()
  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)

  await expireStaleManualOrders({ stationId: station.id })
  const rows = await findNearbyWalletOrderRows(prisma, station.id)
  const items = []
  for (const row of rows || []) {
    items.push(await buildFuelOrderPayload(prisma, row))
  }
  return {
    stationPublicId: station.public_id,
    stationName: station.name,
    items,
    updatedAt: new Date().toISOString(),
  }
}

export async function getFuelOrderForUser({
  fuelOrderId,
  userId,
} = {}) {
  await ensureFuelOrderTablesReady()
  await expireStaleManualOrders({ userId })
  const row = await resolveFuelOrderRow(prisma, fuelOrderId, {
    userId: Number(userId || 0),
  })
  return buildFuelOrderPayload(prisma, row)
}

export async function cancelFuelOrder({
  fuelOrderId,
  userId,
  actorUserId = null,
  reason = "",
  source = FUEL_ORDER_SOURCES.MOBILE_APP,
} = {}) {
  await ensureFuelOrderTablesReady()
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw badRequest("Authenticated user context is required.")
  }

  const walletIds = new Set()
  const cancelled = await prisma.$transaction(async (tx) => {
    const order = await resolveFuelOrderRow(tx, fuelOrderId, {
      userId: normalizedUserId,
      forUpdate: true,
    })
    const currentStatus = normalizeFuelOrderStatus(order.status)
    if (!["created", "awaiting_station", "at_station", "near_pump"].includes(currentStatus)) {
      throw badRequest("Fuel order can only be cancelled before attachment or dispensing.")
    }

    const paymentIntent = await resolvePaymentIntentRow(tx, order.id, { forUpdate: true })
    const released = await releaseFuelOrderHold(tx, {
      fuelOrderPublicId: order.public_id,
      paymentIntentId: paymentIntent?.id || null,
      paymentStatus: PAYMENT_INTENT_STATUSES.CANCELLED,
      note: String(reason || "").trim() || "Fuel order cancelled by user.",
    })
    if (released.walletId) walletIds.add(released.walletId)

    await tx.$executeRaw`
      UPDATE fuel_orders
      SET
        status = 'cancelled',
        cancelled_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3),
        metadata_json = ${JSON.stringify({
          ...parseJsonObject(order.metadata_json),
          cancellationReason: String(reason || "").trim() || null,
          cancelledBySource: normalizeSource(source),
        })}
      WHERE id = ${order.id}
    `

    return {
      publicId: order.public_id,
      stationId: Number(order.station_id || 0) || null,
    }
  })

  for (const walletId of walletIds) {
    if (!walletId) continue
    await recalculateWalletBalance(walletId)
  }

  await writeAuditLog({
    stationId: cancelled.stationId,
    actionType: "FUEL_ORDER_CANCELLED",
    payload: {
      fuelOrderPublicId: cancelled.publicId,
      actorUserId: Number(actorUserId || normalizedUserId || 0) || null,
      source: normalizeSource(source),
      reason: String(reason || "").trim() || null,
    },
  })

  return getFuelOrderForUser({
    fuelOrderId: cancelled.publicId,
    userId: normalizedUserId,
  })
}

export async function attachManualOrderToPumpSession({
  stationPublicId,
  fuelOrderId,
  sessionId,
  actorUserId = null,
  forceReattach = false,
  note = "",
  source = FUEL_ORDER_SOURCES.ATTENDANT,
} = {}) {
  await ensureFuelOrderTablesReady()
  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)
  await expireStaleManualOrders({ stationId: station.id })

  const attached = await prisma.$transaction(async (tx) => {
    const order = await resolveFuelOrderRow(tx, fuelOrderId, {
      stationId: station.id,
      forUpdate: true,
    })
    if (String(order.access_mode || "").trim().toLowerCase() !== FUEL_ORDER_ACCESS_MODES.MANUAL) {
      throw badRequest("Only manual fuel orders can be attached with this flow.")
    }
    if (!ACTIVE_ATTACHABLE_FUEL_ORDER_STATUSES.has(normalizeFuelOrderStatus(order.status))) {
      throw badRequest("Fuel order is no longer attachable.")
    }

    const session = await resolvePumpSessionRow(tx, sessionId, {
      stationId: station.id,
      forUpdate: true,
    })
    if (!ACTIVE_PUMP_SESSION_STATUSES.has(String(session.session_status || "").trim().toUpperCase())) {
      throw badRequest("Pump session is not active and cannot accept a manual fuel order.")
    }
    if (Number(session.transaction_id || 0) > 0) {
      throw badRequest("Pump session is already linked to a completed transaction.")
    }

    if (Number(session.fuel_order_id || 0) > 0 && Number(session.fuel_order_id) !== Number(order.id)) {
      if (!forceReattach) {
        throw badRequest("Pump session is already attached to a different fuel order.")
      }
      const currentAttachedOrder = await tx.$queryRaw`
        SELECT
          fo.id,
          fo.public_id,
          fo.user_id,
          fo.station_id,
          fo.status,
          fo.metadata_json
        FROM fuel_orders fo
        WHERE fo.id = ${Number(session.fuel_order_id)}
        LIMIT 1
        FOR UPDATE
      `
      const attachedOrder = currentAttachedOrder?.[0] || null
      if (normalizeFuelOrderStatus(attachedOrder?.status) === FUEL_ORDER_STATUSES.DISPENSING) {
        throw badRequest("A dispensing fuel order cannot be detached from this session.")
      }
      if (attachedOrder?.id) {
        await tx.$executeRaw`
          UPDATE fuel_orders
          SET
            status = 'near_pump',
            attached_at = NULL,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${attachedOrder.id}
        `
      }
    }

    const previouslyAttachedSession = await resolveLatestPumpSessionForFuelOrder(tx, order.id)
    if (previouslyAttachedSession?.id && Number(previouslyAttachedSession.id) !== Number(session.id)) {
      const previousStatus = String(previouslyAttachedSession.session_status || "").trim().toUpperCase()
      if (!forceReattach) {
        throw badRequest("Fuel order is already attached to a different session. Use supervised reattach before dispensing.")
      }
      if (previousStatus === "DISPENSING") {
        throw badRequest("Fuel order is already attached to an active dispensing session.")
      }
      await tx.$executeRaw`
        UPDATE pump_sessions
        SET fuel_order_id = NULL
        WHERE id = ${previouslyAttachedSession.id}
      `
    }

    await tx.$executeRaw`
      UPDATE pump_sessions
      SET fuel_order_id = ${order.id}
      WHERE id = ${session.id}
    `

    if (normalizeFuelOrderStatus(order.status) !== FUEL_ORDER_STATUSES.ATTACHED_TO_SESSION) {
      await tx.$executeRaw`
        UPDATE fuel_orders
        SET
          status = 'attached_to_session',
          attached_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3),
          metadata_json = ${JSON.stringify({
            ...parseJsonObject(order.metadata_json),
            attachedSessionPublicId: String(session.public_id || "").trim() || null,
            attachedSessionReference: String(session.session_reference || "").trim() || null,
            attachNote: String(note || "").trim() || null,
            attachedBySource: normalizeSource(source),
          })}
        WHERE id = ${order.id}
      `
    }

    return order.public_id
  })

  await writeAuditLog({
    stationId: station.id,
    actionType: "FUEL_ORDER_ATTACHED_TO_SESSION",
    payload: {
      fuelOrderPublicId: attached,
      sessionId: String(sessionId || "").trim(),
      actorUserId: Number(actorUserId || 0) || null,
      forceReattach: Boolean(forceReattach),
      note: String(note || "").trim() || null,
      source: normalizeSource(source),
    },
  })

  return buildFuelOrderPayload(prisma, await resolveFuelOrderRow(prisma, attached, {
    stationId: station.id,
  }))
}

export async function markFuelOrderDispensing({
  stationPublicId,
  sessionId,
  actorUserId = null,
  source = FUEL_ORDER_SOURCES.ATTENDANT,
} = {}) {
  await ensureFuelOrderTablesReady()
  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)

  const fuelOrderPublicId = await prisma.$transaction(async (tx) => {
    const session = await resolvePumpSessionRow(tx, sessionId, {
      stationId: station.id,
      forUpdate: true,
    })
    if (!Number(session.fuel_order_id || 0)) {
      throw badRequest("Pump session is not attached to a manual fuel order.")
    }
    const order = await tx.$queryRaw`
      SELECT
        fo.id,
        fo.public_id,
        fo.user_id,
        fo.station_id,
        fo.status,
        fo.metadata_json
      FROM fuel_orders fo
      WHERE fo.id = ${Number(session.fuel_order_id)}
      LIMIT 1
      FOR UPDATE
    `
    const fuelOrder = order?.[0] || null
    if (!fuelOrder?.id) throw badRequest("Attached manual fuel order could not be found.")
    if (normalizeFuelOrderStatus(fuelOrder.status) === FUEL_ORDER_STATUSES.DISPENSING) {
      return fuelOrder.public_id
    }

    await applyFuelOrderStatusUpdate(tx, fuelOrder, FUEL_ORDER_STATUSES.DISPENSING, {
      metadataPatch: {
        dispensingStartedAt: new Date().toISOString(),
        dispensingSource: normalizeSource(source),
      },
    })

    return fuelOrder.public_id
  })

  await writeAuditLog({
    stationId: station.id,
    actionType: "FUEL_ORDER_DISPENSING_START",
    payload: {
      fuelOrderPublicId,
      sessionId: String(sessionId || "").trim(),
      actorUserId: Number(actorUserId || 0) || null,
      source: normalizeSource(source),
    },
  })

  return buildFuelOrderPayload(prisma, await resolveFuelOrderRow(prisma, fuelOrderPublicId, {
    stationId: station.id,
  }))
}

export async function finalizeFuelOrderFromPumpSession({
  stationPublicId,
  sessionId,
  actorUserId = null,
  dispensedLitres = null,
  amountMwk = null,
  note = "",
  source = FUEL_ORDER_SOURCES.ATTENDANT,
} = {}) {
  await ensureFuelOrderTablesReady()
  await ensureWalletTablesReady()

  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)
  const walletIdsToTouch = new Set()

  const finalized = await prisma.$transaction(async (tx) => {
    const session = await resolvePumpSessionRow(tx, sessionId, {
      stationId: station.id,
      forUpdate: true,
    })
    if (!Number(session.fuel_order_id || 0)) {
      throw badRequest("Pump session is not attached to a manual fuel order.")
    }

    const order = await tx.$queryRaw`
      SELECT
        fo.id,
        fo.public_id,
        fo.display_code,
        fo.user_id,
        fo.station_id,
        fo.access_mode,
        fo.fuel_type_id,
        fo.requested_amount_mwk,
        fo.requested_litres,
        fo.status,
        fo.source,
        fo.expires_at,
        fo.attached_at,
        fo.dispensed_at,
        fo.completed_at,
        fo.cancelled_at,
        fo.failed_at,
        fo.metadata_json,
        fo.created_at,
        fo.updated_at,
        u.public_id AS user_public_id,
        u.full_name AS user_full_name,
        st.public_id AS station_public_id,
        st.name AS station_name,
        ft.code AS fuel_code
      FROM fuel_orders fo
      INNER JOIN users u ON u.id = fo.user_id
      INNER JOIN stations st ON st.id = fo.station_id
      INNER JOIN fuel_types ft ON ft.id = fo.fuel_type_id
      WHERE fo.id = ${Number(session.fuel_order_id)}
      LIMIT 1
      FOR UPDATE
    `
    const fuelOrder = order?.[0] || null
    if (!fuelOrder?.id) throw badRequest("Attached manual fuel order could not be found.")

    const existingTransaction = await resolveFuelOrderTransaction(tx, fuelOrder.id)
    if (normalizeFuelOrderStatus(fuelOrder.status) === FUEL_ORDER_STATUSES.COMPLETED && existingTransaction?.id) {
      return fuelOrder.public_id
    }

    const paymentIntent = await resolvePaymentIntentRow(tx, fuelOrder.id, { forUpdate: true })
    const actualLitres =
      toPositiveNumberOrNull(dispensedLitres)
      ?? toPositiveNumberOrNull(session.dispensed_litres)
      ?? await resolveTelemetryDispensedLitres(tx, session)

    if (actualLitres === null) {
      throw badRequest("Finalization requires actual dispensed litres from the pump session or telemetry.")
    }

    if (actualLitres <= 0) {
      const released = await releaseFuelOrderHold(tx, {
        fuelOrderPublicId: fuelOrder.public_id,
        paymentIntentId: paymentIntent?.id || null,
        paymentStatus: PAYMENT_INTENT_STATUSES.RELEASED,
        note: "Pump session completed without recorded dispense volume.",
      })
      if (released.walletId) walletIdsToTouch.add(released.walletId)

      await tx.$executeRaw`
        UPDATE fuel_orders
        SET
          status = 'failed',
          failed_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3),
          metadata_json = ${JSON.stringify({
            ...parseJsonObject(fuelOrder.metadata_json),
            finalizeSource: normalizeSource(source),
            failureReason: "no_dispense_recorded",
          })}
        WHERE id = ${fuelOrder.id}
      `

      return fuelOrder.public_id
    }

    const transitionBase =
      normalizeFuelOrderStatus(fuelOrder.status) === FUEL_ORDER_STATUSES.DISPENSING
        ? fuelOrder
        : await applyFuelOrderStatusUpdate(tx, fuelOrder, FUEL_ORDER_STATUSES.DISPENSING, {
            metadataPatch: {
              dispensingStartedAt: new Date().toISOString(),
              dispensingSource: normalizeSource(source),
            },
          })

    const createdTransaction = existingTransaction?.id
      ? {
          id: Number(existingTransaction.id),
          publicId: String(existingTransaction.public_id || "").trim() || null,
          totalAmount:
            toPositiveNumberOrNull(existingTransaction.total_amount)
            ?? toPositiveNumberOrNull(existingTransaction.final_amount_paid),
          finalAmountPaid: toPositiveNumberOrNull(existingTransaction.final_amount_paid),
        }
      : (await createPromotionAwareTransaction(tx, {
          stationId: station.id,
          fuelTypeCode: String(transitionBase.fuel_code || "").trim().toUpperCase(),
          litres: actualLitres,
          paymentMethod: "SMARTPAY",
          amount: toPositiveNumberOrNull(amountMwk),
          userId: Number(transitionBase.user_id || 0) || null,
          actorUserId: Number(actorUserId || 0) || null,
          pumpId: Number(session.pump_id || 0) || null,
          nozzleId: Number(session.nozzle_id || 0) || null,
          pumpSessionPublicId: String(session.public_id || "").trim() || null,
          pumpSessionReference: String(session.session_reference || "").trim() || null,
          note:
            String(note || "").trim()
            || `Manual wallet fuel order ${transitionBase.display_code || transitionBase.public_id} finalized at ${station.name}.`,
          occurredAt: session.end_time || new Date(),
          paymentReference: null,
          requestedLitres: toPositiveNumberOrNull(transitionBase.requested_litres),
          cashbackDestination: "WALLET",
          allowLegacyAmountMismatch: Boolean(toPositiveNumberOrNull(amountMwk)),
        }))?.transaction

    if (!createdTransaction?.publicId) {
      throw badRequest("Fuel order transaction could not be created.")
    }

    const createdTransactionId = Number(createdTransaction.id || 0) > 0
      ? Number(createdTransaction.id)
      : Number(
          (
            await tx.$queryRaw`
              SELECT id
              FROM transactions
              WHERE public_id = ${createdTransaction.publicId}
              LIMIT 1
            `
          )?.[0]?.id || 0
        ) || null

    if (!createdTransactionId) {
      throw badRequest("Fuel order transaction could not be resolved after creation.")
    }

    await tx.$executeRaw`
      UPDATE transactions
      SET fuel_order_id = ${transitionBase.id}
      WHERE public_id = ${createdTransaction.publicId}
    `

    await tx.$executeRaw`
      UPDATE pump_sessions
      SET transaction_id = ${createdTransactionId}
      WHERE id = ${Number(session.id)}
    `

    const actualAmount = toMoneyNumber(
      createdTransaction.totalAmount
      ?? createdTransaction.finalAmountPaid
      ?? amountMwk
    )
    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      throw badRequest("Finalized fuel order amount could not be determined.")
    }

    const activeHold = await resolveActiveHoldRow(tx, transitionBase.public_id, { forUpdate: true })
    if (activeHold?.id) {
      const walletBalance = await loadWalletBalanceSnapshot(tx, activeHold.wallet_id, "MWK")
      const releasableAmount = toMoneyNumber(activeHold.amount)
      const totalSpendAfterRelease = toMoneyNumber(walletBalance.availableBalance + releasableAmount)
      if (totalSpendAfterRelease < actualAmount) {
        throw badRequest(
          `Wallet capture requires MWK ${actualAmount.toLocaleString()} but only MWK ${totalSpendAfterRelease.toLocaleString()} is currently available after releasing the existing hold.`
        )
      }

      await tx.$executeRaw`
        UPDATE wallet_reservation_holds
        SET
          status = 'RELEASED',
          released_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${activeHold.id}
      `
      walletIdsToTouch.add(Number(activeHold.wallet_id || 0) || null)
    }

    const capture = await createWalletPayment({
      userId: Number(transitionBase.user_id || 0),
      amount: actualAmount,
      actorUserId: Number(actorUserId || 0) || null,
      description: `Manual wallet fuel order ${transitionBase.display_code || transitionBase.public_id} captured at ${station.name}.`,
      relatedEntityType: "FUEL_ORDER",
      relatedEntityId: transitionBase.public_id,
      idempotencyKey: `fuel-order:${transitionBase.public_id}:capture`,
      metadata: {
        fuelOrderPublicId: transitionBase.public_id,
        displayCode: transitionBase.display_code,
        transactionPublicId: createdTransaction.publicId,
        source: normalizeSource(source),
      },
      settlementContext: {
        stationId: station.id,
        relatedEntityType: "FUEL_ORDER",
        relatedEntityId: transitionBase.public_id,
        source: "FUEL_ORDER_CAPTURE",
        metadata: {
          fuelOrderPublicId: transitionBase.public_id,
          transactionPublicId: createdTransaction.publicId,
        },
      },
    }, { tx })

    const paymentReference = String(capture?.transaction?.reference || "").trim() || null
    await tx.$executeRaw`
      UPDATE payment_intents
      SET
        captured_amount_mwk = ${actualAmount},
        payment_status = 'captured',
        payment_reference = ${paymentReference},
        updated_at = CURRENT_TIMESTAMP(3),
        metadata_json = ${JSON.stringify({
          ...(paymentIntent?.metadata_json ? parseJsonObject(paymentIntent.metadata_json) : {}),
          transactionPublicId: createdTransaction.publicId,
          settlementBatchPublicId: capture?.settlement?.publicId || null,
          finalizedAt: new Date().toISOString(),
          source: normalizeSource(source),
        })}
      WHERE fuel_order_id = ${transitionBase.id}
    `

    await tx.$executeRaw`
      UPDATE transactions
      SET
        payment_reference = ${paymentReference},
        payment_method = 'SMARTPAY'
      WHERE public_id = ${createdTransaction.publicId}
    `

    await tx.$executeRaw`
      UPDATE fuel_orders
      SET
        status = 'completed',
        dispensed_at = CURRENT_TIMESTAMP(3),
        completed_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3),
        metadata_json = ${JSON.stringify({
          ...parseJsonObject(transitionBase.metadata_json),
          finalizeSource: normalizeSource(source),
          transactionPublicId: createdTransaction.publicId,
          paymentReference,
          finalAmountMwk: actualAmount,
          dispensedLitres: actualLitres,
        })}
      WHERE id = ${transitionBase.id}
    `

    return transitionBase.public_id
  })

  for (const walletId of walletIdsToTouch) {
    if (!walletId) continue
    await recalculateWalletBalance(walletId)
  }

  const order = await resolveFuelOrderRow(prisma, finalized, {
    stationId: station.id,
  })

  await writeAuditLog({
    stationId: station.id,
    actionType: normalizeFuelOrderStatus(order.status) === FUEL_ORDER_STATUSES.COMPLETED
      ? "FUEL_ORDER_FINALIZED"
      : "FUEL_ORDER_FINALIZATION_FAILED",
    payload: {
      fuelOrderPublicId: order.public_id,
      sessionId: String(sessionId || "").trim(),
      actorUserId: Number(actorUserId || 0) || null,
      source: normalizeSource(source),
      finalStatus: normalizeFuelOrderStatus(order.status),
      note: String(note || "").trim() || null,
    },
  })

  return buildFuelOrderPayload(prisma, order)
}

async function loadCurrentActiveSessionSummary(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      fo.public_id AS fuel_order_public_id,
      fo.display_code AS fuel_order_display_code,
      fo.status AS fuel_order_status,
      ft.code AS fuel_code,
      u.full_name AS user_full_name
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    LEFT JOIN fuel_orders fo ON fo.id = ps.fuel_order_id
    LEFT JOIN fuel_types ft ON ft.id = fo.fuel_type_id
    LEFT JOIN users u ON u.id = fo.user_id
    WHERE ps.station_id = ${stationId}
      AND ps.session_status IN ('CREATED', 'STARTED', 'DISPENSING')
    ORDER BY
      CASE ps.session_status
        WHEN 'DISPENSING' THEN 0
        WHEN 'STARTED' THEN 1
        ELSE 2
      END,
      COALESCE(ps.end_time, ps.start_time, ps.updated_at, ps.created_at) DESC,
      ps.id DESC
    LIMIT 1
  `

  const row = rows?.[0] || null
  if (!row?.id) return null
  const fuelOrder =
    String(row.fuel_order_public_id || "").trim()
      ? await buildFuelOrderPayload(prisma, await resolveFuelOrderRow(prisma, row.fuel_order_public_id, {
          stationId,
        }))
      : null
  return {
    publicId: String(row.public_id || "").trim() || null,
    sessionReference: String(row.session_reference || "").trim() || null,
    status: String(row.session_status || "").trim().toUpperCase() || "CREATED",
    pumpPublicId: String(row.pump_public_id || "").trim() || null,
    pumpNumber: Number(row.pump_number || 0) || null,
    nozzlePublicId: String(row.nozzle_public_id || "").trim() || null,
    nozzleNumber: String(row.nozzle_number || "").trim() || null,
    dispensedLitres: toPositiveNumberOrNull(row.dispensed_litres) ?? 0,
    fuelOrderPublicId: String(row.fuel_order_public_id || "").trim() || null,
    fuelOrderDisplayCode: String(row.fuel_order_display_code || "").trim() || null,
    fuelOrderStatus: normalizeFuelOrderStatus(row.fuel_order_status) || null,
    fuelType: String(row.fuel_code || "").trim().toUpperCase() || null,
    customerName: String(row.user_full_name || "").trim() || null,
    startTime: toIsoOrNull(row.start_time),
    endTime: toIsoOrNull(row.end_time),
    fuelOrder,
  }
}

export async function getStationOperationsKioskData({
  stationPublicId,
} = {}) {
  await ensureFuelOrderTablesReady()
  const station = await resolveStationContext(stationPublicId)
  if (!station?.id) throw notFound(`Station not found: ${stationPublicId}`)

  const [queueSnapshot, nearbyWalletOrders, activeSession, hybridPilotQueue] = await Promise.all([
    getQueueSnapshot(station),
    listNearbyWalletOrdersForStation({ stationPublicId }),
    loadCurrentActiveSessionSummary(station.id),
    getHybridQueueSnapshot(station.id),
  ])

  return {
    stationPublicId: station.public_id,
    stationName: station.name,
    stationTimezone: String(station.timezone || "").trim() || "Africa/Blantyre",
    fuelPrices: buildStationFuelPrices(station.prices_json),
    updatedAt: new Date().toISOString(),
    mainQueue: queueSnapshot,
    hybridPilotQueue,
    nearbyWalletOrders: nearbyWalletOrders.items,
    currentActiveSession: activeSession,
  }
}

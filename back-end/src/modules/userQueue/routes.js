import { Router } from "express"
import rateLimit from "express-rate-limit"
import crypto from "node:crypto"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import {
  appTodayISO,
  formatDateISOInTimeZone,
  formatDateTimeSqlInTimeZone,
  toUtcMysqlDateTime,
  zonedDateTimeToUtcMs,
} from "../../utils/dateTime.js"
import { contentDispositionAttachment, safeFilenamePart } from "../reports/reports.export.service.js"
import {
  createPublicId,
  createReservationPublicIdValue,
  createSupportCasePublicId,
  resolveStationOrThrow,
  writeAuditLog,
} from "../common/db.js"
import {
  extractRequestedLiters,
  isReservationsTableMissingError,
  parseReservationMetadata,
  reservationStatusToUserLabel,
} from "../common/reservations.js"
import {
  archiveUserAlert,
  ensureUserAlertArchivesTableReady,
  ensureUserAlertsTableReady,
  listUserAlertArchivesByUserId,
  listUserAlertsByUserId,
  markUserAlertRead,
  isUserAlertArchivesTableMissingError,
  isUserAlertsTableMissingError,
  createUserAlert,
} from "../common/userAlerts.js"
import {
  buildStationPlanUpgradeMessage,
  getStationSubscriptionSummary,
  hasStationPlanFeature,
  STATION_PLAN_FEATURES,
} from "../subscriptions/planCatalog.js"
import { computeStationFuelStatuses } from "../stations/fuelStatus.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { getPushPublicKeyConfig, sendPushAlertToUser } from "../common/pushNotifications.js"
import {
  deactivatePushSubscriptionForUser,
  deactivatePushSubscriptionsByUserId,
  ensureUserPushSubscriptionsTableReady,
  isUserPushSubscriptionsTableMissingError,
  upsertUserPushSubscription,
} from "../common/userPushSubscriptions.js"
import {
  createQueuePrepayWalletHold,
  createWalletUserTransfer,
  createReservationWalletHold,
  createPrototypeWalletTopup,
  ensureWalletTablesReady,
  getUserWalletStationLockedBalances,
  getUserWalletHolds,
  getUserWalletTransferHistory,
  getWalletTransferRecipientQr,
  getUserWalletSummary,
  getUserWalletTransactions,
  isWalletFoundationTableMissingError,
  previewWalletUserTransfer,
  releaseQueuePrepayWalletHold,
  releaseReservationWalletHold,
} from "../common/wallets.js"
import {
  ACTIVE_QUEUE_STATUSES,
  buildUserQueueStatusSnapshot,
  collectAssignedNozzlePublicIds,
  getFuelTypeId,
  parsePumpQrPayload,
  getQueueSettings,
  normalizeQueuePositions,
  resolveAssignableNozzle,
} from "./service.js"
import { initialUserRefundStatus } from "../internal/refundWorkflow.js"
import { streamSmartPayReceiptPdf } from "./receipt.export.pdf.js"
import { getUserTransactionReceiptPayloadByLink } from "../transactions/receipt.service.js"
import { getPromotionPricingPreview } from "../promotions/service.js"
import {
  ATTENDANT_ORDER_STATES,
  ATTENDANT_ORDER_TYPES,
  canTransitionAttendantOrder,
  deriveAttendantOrderState,
  normalizeAttendantWorkflow,
} from "../attendant/service.js"
import { markHybridOrderReadyOnSite } from "../queue/hybrid/integration.service.js"
import { ReadinessSignalType } from "../queue/hybrid/domain.js"

const router = Router()

const RESERVATION_SLOT_MINUTES = 15
const RESERVATION_GRACE_MINUTES = 5
const RESERVATION_LATE_MOVE_MINUTES = 5
const RESERVATION_LATE_CANCEL_MINUTES = 10
const RESERVATION_MIN_LITERS = 10
const RESERVATION_MAX_LITERS = 40
const RESERVATION_MIN_DEPOSIT = 3000
const RESERVATION_MAX_DEPOSIT = 10000
const RESERVATION_SLOT_EFFICIENCY_FACTOR = Number(process.env.RESERVATION_SLOT_EFFICIENCY_FACTOR || 2)
const RESERVATION_DEFAULT_SLOT_LOOKAHEAD = 8
const RESERVATION_ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"]
const REFUND_REQUEST_WINDOW_HOURS = 24
const walletTransferPreviewLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many wallet transfer previews. Try again later.",
  },
})
const walletTransferCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many wallet transfer attempts. Try again later.",
  },
})

function formatWalletTransferAmountLabel(amount, currencyCode = "MWK") {
  const normalizedAmount = Number(amount || 0)
  const safeAmount = Number.isFinite(normalizedAmount) ? normalizedAmount : 0
  const isWhole = Math.abs(safeAmount % 1) < 0.001

  return `${String(currencyCode || "MWK").trim() || "MWK"} ${safeAmount.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export async function listStationFuelStatusesForQueueJoin(stationId, settings = {}) {
  const today = appTodayISO() || "1970-01-01"
  const rangeFromDt = `${today} 00:00:00`
  const rangeToDt = `${today} 23:59:59`

  const [fuelRows, queueRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        SUM(t.capacity_litres) AS capacity_litres,
        SUM(
          CASE
            WHEN COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) IS NOT NULL
              THEN GREATEST(
                0,
                COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres)
                + COALESCE(del.delivery_litres, 0)
                - COALESCE(tx.recorded_litres, 0)
              )
            WHEN closing.closing_litres IS NOT NULL
              THEN GREATEST(0, closing.closing_litres)
            ELSE NULL
          END
        ) AS remaining_litres
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS opening_litres,
          ir.reading_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MIN(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'OPENING'
            AND reading_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
          GROUP BY tank_id
        ) latest
          ON latest.tank_id = ir.tank_id
         AND latest.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'OPENING'
      ) opening ON opening.tank_id = t.id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS fallback_opening_litres,
          ir.reading_time AS fallback_opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time < ${rangeFromDt}
          GROUP BY tank_id
        ) previous_closing
          ON previous_closing.tank_id = ir.tank_id
         AND previous_closing.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'CLOSING'
      ) fallback_opening ON fallback_opening.tank_id = t.id
      LEFT JOIN (
        SELECT tank_id, SUM(litres) AS delivery_litres
        FROM fuel_deliveries
        WHERE station_id = ${stationId}
          AND delivered_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
        GROUP BY tank_id
      ) del ON del.tank_id = t.id
      LEFT JOIN (
        SELECT
          ir.tank_id,
          ir.litres AS closing_litres
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
          GROUP BY tank_id
        ) last_closing
          ON last_closing.tank_id = ir.tank_id
         AND last_closing.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'CLOSING'
      ) closing ON closing.tank_id = t.id
      LEFT JOIN (
        SELECT
          COALESCE(pn.tank_id, p.tank_id) AS tank_id,
          SUM(tx.litres) AS recorded_litres
        FROM transactions tx
        LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
        LEFT JOIN pumps p ON p.id = tx.pump_id
        WHERE tx.station_id = ${stationId}
          AND tx.occurred_at BETWEEN ${rangeFromDt} AND ${rangeToDt}
        GROUP BY COALESCE(pn.tank_id, p.tank_id)
      ) tx ON tx.tank_id = t.id
      WHERE t.station_id = ${stationId}
        AND t.is_active = 1
      GROUP BY ft.code
    `,
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        COUNT(*) AS active_count
      FROM queue_entries qe
      INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
      WHERE qe.station_id = ${stationId}
        AND qe.status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY ft.code
    `,
  ])

  return computeStationFuelStatuses({
    fuelRows,
    queueRows,
    settings,
  })
}

const reservationSlotsQuerySchema = z.object({
  fuelType: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PETROL", "DIESEL"]))
    .default("PETROL"),
  lookAhead: z.coerce.number().int().min(1).max(24).optional(),
})

const createReservationBodySchema = z.object({
  fuelType: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PETROL", "DIESEL"]))
    .default("PETROL"),
  expectedLiters: z.number().positive().max(500),
  slotStart: z.string().trim().min(8),
  slotEnd: z.string().trim().optional(),
  identifier: z.string().trim().min(3).max(64),
  depositAmount: z.number().positive().max(100000),
  userLat: z.number().min(-90).max(90).optional(),
  userLng: z.number().min(-180).max(180).optional(),
})

const cancelReservationBodySchema = z.object({
  reason: z.string().trim().max(255).optional(),
})

const checkInReservationBodySchema = z.object({
  method: z.enum(["GPS", "QR"]).default("GPS"),
  qrToken: z.string().trim().max(200).optional(),
  userLat: z.number().min(-90).max(90).optional(),
  userLng: z.number().min(-180).max(180).optional(),
})

const joinBodySchema = z.object({
  fuelType: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PETROL", "DIESEL"]))
    .default("PETROL"),
  maskedPlate: z.string().trim().max(32).optional(),
  requestedLiters: z.number().positive().max(500).optional(),
  prepay: z.boolean().optional(),
})

const leaveBodySchema = z.object({
  reason: z.string().trim().max(255).optional(),
})

const queuePumpScanBodySchema = z.object({
  qrToken: z.string().trim().min(1).max(600),
})

const queueDispenseRequestBodySchema = z.object({
  liters: z.number().positive().max(500),
  prepay: z.boolean().optional(),
})

const reportIssueSchema = z.object({
  issueType: z.enum([
    "WAIT_TIME",
    "QR_SCAN",
    "ATTENDANT",
    "STATION_ACCESS",
    "FUEL_AVAILABILITY",
    "OTHER",
  ]),
  message: z.string().trim().max(1200).optional(),
})

function mapQueueIssueToSupportCategory(issueType) {
  const normalized = String(issueType || "").trim().toUpperCase()
  if (["WAIT_TIME", "ATTENDANT", "STATION_ACCESS"].includes(normalized)) return "Queue"
  if (normalized === "FUEL_AVAILABILITY") return "Reservation"
  return "Other"
}

function mapQueueIssueToSupportSeverity(issueType) {
  const normalized = String(issueType || "").trim().toUpperCase()
  if (["STATION_ACCESS", "ATTENDANT"].includes(normalized)) return "Critical"
  if (["WAIT_TIME", "FUEL_AVAILABILITY"].includes(normalized)) return "Medium"
  return "Low"
}

function mapQueueIssueToInternalCategory(issueType) {
  const normalized = String(issueType || "").trim().toUpperCase()
  if (["WAIT_TIME", "STATION_ACCESS", "FUEL_AVAILABILITY"].includes(normalized)) return "QUEUE_DISPUTE"
  if (normalized === "ATTENDANT") return "STATION_COMPLAINT"
  return "GENERAL"
}

function mapQueueIssueTitle(issueType) {
  switch (String(issueType || "").trim().toUpperCase()) {
    case "WAIT_TIME":
      return "Queue wait time issue"
    case "QR_SCAN":
      return "Queue QR issue"
    case "ATTENDANT":
      return "Attendant interaction issue"
    case "STATION_ACCESS":
      return "Station access issue"
    case "FUEL_AVAILABILITY":
      return "Fuel availability issue"
    default:
      return "Queue support issue"
  }
}

function mapQueueIssueToSupportCaseTypeCode(issueType) {
  const normalized = String(issueType || "").trim().toUpperCase()
  if (normalized === "QR_SCAN") return "RSV"
  return "DRV"
}

async function resolveInternalSupportAgentUserId() {
  const rows = await prisma.$queryRaw`
    SELECT u.id
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
    INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
    WHERE u.is_active = 1
      AND ir.code = 'CUSTOMER_SUPPORT_AGENT'
    ORDER BY ir.rank_order ASC, u.id ASC
    LIMIT 1
  `

  return rows?.[0]?.id ? Number(rows[0].id) : null
}

const pushSubscribeBodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().trim().min(1).max(1200),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().trim().min(1).max(300),
      auth: z.string().trim().min(1).max(300),
    }),
  }),
})

const pushUnsubscribeBodySchema = z.object({
  endpoint: z.string().trim().max(1200).optional(),
})

const walletTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z.enum([
        "TOPUP",
        "PAYMENT",
        "REFUND",
        "REVERSAL",
        "ADJUSTMENT",
        "HOLD",
        "RELEASE",
        "RESERVATION_PAYMENT",
        "QUEUE_FEE",
        "TRANSFER",
      ])
    )
    .optional(),
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PENDING", "POSTED", "FAILED", "REVERSED", "CANCELLED"]))
    .optional(),
})

const walletHoldsQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["ACTIVE", "RELEASED", "CAPTURED", "EXPIRED", "CANCELLED"]))
    .default("ACTIVE"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const walletTopupBodySchema = z.object({
  amount: z.coerce.number().positive().max(1000000),
  note: z.string().trim().max(255).optional(),
})

const walletRefundCreateBodySchema = z.object({
  transactionPublicId: z.string().trim().min(8).max(64),
  amount: z.coerce.number().positive().max(1000000).optional(),
  reason: z.string().trim().min(5).max(255),
})

const walletTransferBodyBaseSchema = z.object({
  recipientUserId: z
    .string()
    .trim()
    .regex(/^(SLU-[A-Z0-9]{6}|[0-9A-HJKMNP-TV-Z]{26})$/i, "Invalid recipient user id")
    .optional(),
  recipientQrPayload: z.string().trim().min(16).max(5000).optional(),
  amountMwk: z.coerce.number().int().positive().max(1000000),
  transferMode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["NORMAL", "STATION_LOCKED"]))
    .default("NORMAL"),
  stationPublicId: z.string().trim().max(64).optional(),
  stationId: z.union([z.number().int().positive(), z.string().trim().min(1).max(64)]).optional(),
})

function validateWalletTransferRequestBody(value, ctx) {
  const hasRecipientUserId = Boolean(String(value.recipientUserId || "").trim())
  const hasRecipientQrPayload = Boolean(String(value.recipientQrPayload || "").trim())

  if (!hasRecipientUserId && !hasRecipientQrPayload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A recipient user ID or recipient QR payload is required.",
      path: ["recipientUserId"],
    })
  }
  if (hasRecipientUserId && hasRecipientQrPayload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either a recipient user ID or a recipient QR payload, not both.",
      path: ["recipientQrPayload"],
    })
  }
  if (value.transferMode === "STATION_LOCKED" && !value.stationPublicId && value.stationId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A station is required for station-locked transfers.",
      path: ["stationPublicId"],
    })
  }
}

const walletTransferPreviewBodySchema = walletTransferBodyBaseSchema.superRefine(validateWalletTransferRequestBody)

const walletTransferCreateBodySchema = walletTransferBodyBaseSchema.extend({
  note: z.string().trim().max(255).optional(),
  idempotencyKey: z.string().trim().min(4).max(128).optional(),
}).superRefine(validateWalletTransferRequestBody)

const walletTransferHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const historyQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function ensureStationScope(req, stationPublicId) {
  // User-facing endpoints are intentionally multi-station. Some accounts may carry a
  // station-scoped token (for example staff accounts), but queue/reservation user flows
  // must still work across stations in this route group.
  // Keep this helper as a no-op for backward compatibility with existing call sites.
  void req
  void stationPublicId
}

async function ensureWalletStorageReadyOrThrow() {
  try {
    await ensureWalletTablesReady()
  } catch (error) {
    if (isWalletFoundationTableMissingError(error) || String(error?.message || "").includes("migration")) {
      throw badRequest(
        "Wallet storage is unavailable. Run SQL migrations 034_wallet_ledger_foundation.sql and 052_wallet_user_transfers_station_locks.sql."
      )
    }
    throw error
  }
}

function toNumberOrNull(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return null
  return normalized
}

function toUtcQueryDateBoundary(datePart, timePart) {
  const utcMs = zonedDateTimeToUtcMs(datePart, timePart)
  if (!Number.isFinite(utcMs)) return null
  return toUtcMysqlDateTime(new Date(utcMs))
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

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function applyQueuePumpScanToAttendantWorkflow({
  metadata = {},
  queueStatus = "",
  scannedAt = "",
  pumpAssignment = {},
} = {}) {
  const nextMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {}
  const nextScannedAt = String(scannedAt || "").trim() || new Date().toISOString()
  const existingWorkflow =
    nextMetadata.attendantWorkflow && typeof nextMetadata.attendantWorkflow === "object"
      ? { ...nextMetadata.attendantWorkflow }
      : {}
  const currentWorkflow = normalizeAttendantWorkflow(nextMetadata)
  const currentState = deriveAttendantOrderState({
    orderType: ATTENDANT_ORDER_TYPES.QUEUE,
    baseStatus: queueStatus,
    metadata: nextMetadata,
    refundStatus: currentWorkflow.refundRequest?.status || "",
  })

  const nextPumpAssignment = {
    ...(existingWorkflow.pumpAssignment && typeof existingWorkflow.pumpAssignment === "object"
      ? existingWorkflow.pumpAssignment
      : {}),
    pumpPublicId: String(pumpAssignment.pumpPublicId || "").trim() || null,
    pumpNumber: Number.isFinite(Number(pumpAssignment.pumpNumber))
      ? Number(pumpAssignment.pumpNumber)
      : null,
    nozzlePublicId: String(pumpAssignment.nozzlePublicId || "").trim() || null,
    nozzleNumber: String(pumpAssignment.nozzleNumber || "").trim() || null,
    fuelType: String(pumpAssignment.fuelType || "").trim().toUpperCase() || null,
    confirmedAt: nextScannedAt,
  }

  const nextState =
    currentState === ATTENDANT_ORDER_STATES.PUMP_ASSIGNED
    || canTransitionAttendantOrder(currentState, ATTENDANT_ORDER_STATES.PUMP_ASSIGNED)
      ? ATTENDANT_ORDER_STATES.PUMP_ASSIGNED
      : currentState

  nextMetadata.attendantWorkflow = {
    ...existingWorkflow,
    state: nextState,
    pumpAssignment: nextPumpAssignment,
    customerArrivedAt: String(existingWorkflow.customerArrivedAt || "").trim() || nextScannedAt,
  }

  if (nextMetadata.serviceRequest && typeof nextMetadata.serviceRequest === "object") {
    nextMetadata.serviceRequest = {
      ...nextMetadata.serviceRequest,
      pumpPublicId: nextPumpAssignment.pumpPublicId,
      nozzlePublicId: nextPumpAssignment.nozzlePublicId,
      fuelType: nextPumpAssignment.fuelType,
    }
  }

  return {
    metadata: nextMetadata,
    currentState,
    nextState,
  }
}

export function assertQueuePumpScanSessionMatchesAuth(metadata = {}, auth = null) {
  const scannedBySessionPublicId = String(metadata?.lastPumpScan?.scannedBySessionPublicId || "").trim()
  if (!scannedBySessionPublicId) return

  const authSessionPublicId = String(auth?.sessionPublicId || "").trim()
  if (!authSessionPublicId) {
    throw badRequest("Authenticated session context is required to continue this pump session.")
  }

  if (scannedBySessionPublicId !== authSessionPublicId) {
    throw badRequest("This pump verification belongs to a different active session. Scan the pump QR again from this device.")
  }
}

function normalizeQueuePaymentMode(value, fallback = "PAY_AT_PUMP") {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "PREPAY") return "PREPAY"
  if (normalized === "PAY_AT_PUMP") return "PAY_AT_PUMP"
  return fallback
}

function deriveQueuePaymentMode(metadata, fallback = "PAY_AT_PUMP") {
  if (metadata?.prepaySelected === true) return "PREPAY"
  if (metadata?.prepaySelected === false) return "PAY_AT_PUMP"
  return normalizeQueuePaymentMode(metadata?.paymentMode, fallback)
}

function normalizeCurrencyCode(value, fallback = "MWK") {
  return String(value || fallback).trim().toUpperCase() || fallback
}

function buildMetadataNozzleLabel(metadata = {}) {
  const nozzleNumber = String(
    metadata?.lastPumpScan?.nozzleNumber
    || metadata?.serviceRequest?.nozzleNumber
    || ""
  ).trim()
  const nozzleSide = String(metadata?.lastPumpScan?.nozzleSide || "").trim()
  if (!nozzleNumber) return "-"
  return nozzleSide ? `${nozzleNumber} (${nozzleSide})` : nozzleNumber
}

export function buildSmartPayPrepayQuote({
  pricing = {},
  basePricePerLitre = null,
  litres = null,
} = {}) {
  const normalizedLitres = toNumberOrNull(litres)
  const normalizedBasePricePerLitre = toNumberOrNull(basePricePerLitre)
  const subtotal =
    toNumberOrNull(pricing?.subtotal)
    ?? (
      normalizedLitres !== null &&
      normalizedBasePricePerLitre !== null
        ? Number((normalizedLitres * normalizedBasePricePerLitre).toFixed(2))
        : null
    )
  const totalDirectDiscount = toNumberOrNull(pricing?.totalDirectDiscount) ?? 0
  const cashbackTotal = toNumberOrNull(pricing?.cashback) ?? 0
  const estimatedAmount = toNumberOrNull(pricing?.finalPayable) ?? subtotal
  const payablePricePerLitre =
    toNumberOrNull(pricing?.directPricePerLitre)
    ?? (
      normalizedLitres && estimatedAmount !== null
        ? Number((estimatedAmount / normalizedLitres).toFixed(4))
        : normalizedBasePricePerLitre
    )

  return {
    basePricePerLitre: normalizedBasePricePerLitre,
    payablePricePerLitre,
    subtotal,
    totalDirectDiscount,
    cashbackTotal,
    estimatedAmount,
    effectiveNetCost: toNumberOrNull(pricing?.effectiveNetCost) ?? estimatedAmount,
    effectivePricePerLitre: toNumberOrNull(pricing?.effectivePricePerLitre) ?? payablePricePerLitre,
    promoLabelsApplied: Array.isArray(pricing?.promoLabelsApplied) ? pricing.promoLabelsApplied : [],
  }
}

export function assertWalletEligibleForQueuePrepay(walletSummary = {}) {
  const walletStatus = String(walletSummary?.status || "").trim().toUpperCase()
  if (!walletStatus || walletStatus === "ACTIVE") return true

  if (walletStatus === "SUSPENDED") {
    throw badRequest("Wallet is frozen. Queue prepay with wallet is unavailable until the wallet is unfrozen.")
  }

  if (walletStatus === "CLOSED") {
    throw badRequest("Wallet is closed. Queue prepay with wallet is unavailable.")
  }

  throw badRequest("Wallet is not active. Queue prepay with wallet is unavailable.")
}

function extractReservationReceiptDetails(metadata, row = {}) {
  const pricing = metadata?.pricing && typeof metadata.pricing === "object" ? metadata.pricing : {}
  const walletHold = metadata?.walletHold && typeof metadata.walletHold === "object" ? metadata.walletHold : {}

  return {
    paymentMode: walletHold.reference ? "PREPAY" : "PAY_AT_PUMP",
    pricePerLitre:
      toNumberOrNull(row?.base_price_per_litre)
      ?? toNumberOrNull(row?.price_per_litre)
      ?? toNumberOrNull(row?.effective_price_per_litre)
      ?? toNumberOrNull(pricing.payablePricePerLitre ?? pricing.pricePerLitre),
    totalAmount:
      toNumberOrNull(row?.wallet_total_amount)
      ?? toNumberOrNull(row?.final_amount_paid)
      ?? toNumberOrNull(row?.total_amount)
      ?? toNumberOrNull(pricing.estimatedFuelCost),
    currencyCode: normalizeCurrencyCode(pricing.currencyCode || walletHold.currencyCode),
    transactionReference: String(row?.transaction_public_id || row?.payment_reference || walletHold.reference || "").trim() || null,
    paymentStatus: String(walletHold.status || "").trim().toUpperCase() || null,
    pumpNumber: toNumberOrNull(metadata?.lastPumpScan?.pumpNumber),
    nozzleLabel: buildMetadataNozzleLabel(metadata),
  }
}

function extractQueueReceiptDetails(metadata, row = {}) {
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}

  return {
    paymentMode: deriveQueuePaymentMode(
      {
        paymentMode: serviceRequest.paymentMode ?? metadata?.paymentMode,
        prepaySelected: serviceRequest.prepaySelected ?? metadata?.prepaySelected,
      },
      "PAY_AT_PUMP"
    ),
    pricePerLitre:
      toNumberOrNull(row?.base_price_per_litre)
      ?? toNumberOrNull(row?.price_per_litre)
      ?? toNumberOrNull(row?.effective_price_per_litre)
      ?? toNumberOrNull(serviceRequest.pricePerLitre),
    totalAmount:
      toNumberOrNull(row?.wallet_total_amount)
      ?? toNumberOrNull(row?.final_amount_paid)
      ?? toNumberOrNull(row?.total_amount)
      ?? toNumberOrNull(serviceRequest.estimatedAmount),
    currencyCode: normalizeCurrencyCode(serviceRequest.currencyCode),
    transactionReference: String(row?.transaction_public_id || row?.payment_reference || serviceRequest.walletTransactionReference || "").trim() || null,
    paymentStatus: String(serviceRequest.paymentStatus || "").trim().toUpperCase() || null,
    pumpNumber: toNumberOrNull(metadata?.lastPumpScan?.pumpNumber),
    nozzleLabel: buildMetadataNozzleLabel(metadata),
  }
}

function buildReceiptTransactionId(prefix, reference, completedAt) {
  const normalizedPrefix = String(prefix || "SP").trim().toUpperCase() || "SP"
  const normalizedReference = String(reference || "RECEIPT")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(-12) || "RECEIPT"
  const timestamp = String(completedAt || "")
    .replace(/\D+/g, "")
    .slice(0, 14) || "00000000000000"
  return `${normalizedPrefix}-${normalizedReference}-${timestamp}`
}

function buildPromotionReceiptDetailsFromMetadata(metadata = {}, { preferServiceRequest = false } = {}) {
  const pricing =
    metadata?.pricing && typeof metadata.pricing === "object"
      ? metadata.pricing
      : {}
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const source = preferServiceRequest ? serviceRequest : pricing
  const promoLabelsApplied = Array.isArray(source?.promoLabelsApplied)
    ? source.promoLabelsApplied
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : []
  const totalDirectDiscount = toNumberOrNull(source?.totalDirectDiscount) ?? 0
  const cashbackTotal = toNumberOrNull(source?.cashbackTotal ?? source?.cashback) ?? 0
  const primaryLabel = promoLabelsApplied.length ? promoLabelsApplied.join(", ") : "-"

  return {
    basePricePerLitre: toNumberOrNull(source?.basePricePerLitre),
    subtotal: toNumberOrNull(source?.subtotal),
    finalAmountPaid: toNumberOrNull(source?.estimatedAmount ?? source?.estimatedFuelCost),
    effectivePricePerLitre:
      toNumberOrNull(source?.effectivePricePerLitre)
      ?? toNumberOrNull(source?.pricePerLitre)
      ?? toNumberOrNull(source?.payablePricePerLitre),
    discountLines:
      totalDirectDiscount > 0
        ? [{
            label: primaryLabel,
            amount: totalDirectDiscount,
            fundingSource: null,
            promotionKind: "-",
            promotionValueLabel: "-",
          }]
        : [],
    totalDirectDiscount,
    promoLabelsApplied,
    cashbackLines:
      cashbackTotal > 0
        ? [{
            label: primaryLabel,
            amount: cashbackTotal,
            promotionKind: "Cashback",
            promotionValueLabel: "-",
            status: "EARNED",
          }]
        : [],
    cashbackTotal,
  }
}

function buildPromotionReceiptDetailsFromTransactionRow(row = {}) {
  const promoLabelsApplied = parseJsonArray(row?.promo_labels_applied)
  const totalDirectDiscount = toNumberOrNull(row?.total_direct_discount) ?? 0
  const cashbackTotal = toNumberOrNull(row?.cashback_total) ?? 0
  const primaryLabel = promoLabelsApplied.length ? promoLabelsApplied.join(", ") : "-"

  return {
    basePricePerLitre:
      toNumberOrNull(row?.base_price_per_litre)
      ?? toNumberOrNull(row?.price_per_litre),
    subtotal: toNumberOrNull(row?.subtotal),
    finalAmountPaid:
      toNumberOrNull(row?.wallet_total_amount)
      ?? toNumberOrNull(row?.final_amount_paid)
      ?? toNumberOrNull(row?.total_amount),
    effectivePricePerLitre:
      toNumberOrNull(row?.effective_price_per_litre)
      ?? toNumberOrNull(row?.price_per_litre),
    discountLines:
      totalDirectDiscount > 0
        ? [{
            label: primaryLabel,
            amount: totalDirectDiscount,
            fundingSource: null,
            promotionKind: "-",
            promotionValueLabel: "-",
          }]
        : [],
    totalDirectDiscount,
    promoLabelsApplied,
    cashbackLines:
      cashbackTotal > 0
        ? [{
            label: primaryLabel,
            amount: cashbackTotal,
            promotionKind: "Cashback",
            promotionValueLabel: "-",
            status: "EARNED",
          }]
        : [],
    cashbackTotal,
  }
}

function mergePromotionReceiptDetails(primary = {}, fallback = {}) {
  const primaryPromoLabels = Array.isArray(primary?.promoLabelsApplied) ? primary.promoLabelsApplied : []
  const fallbackPromoLabels = Array.isArray(fallback?.promoLabelsApplied) ? fallback.promoLabelsApplied : []
  const primaryDiscountLines = Array.isArray(primary?.discountLines) ? primary.discountLines : []
  const fallbackDiscountLines = Array.isArray(fallback?.discountLines) ? fallback.discountLines : []
  const primaryCashbackLines = Array.isArray(primary?.cashbackLines) ? primary.cashbackLines : []
  const fallbackCashbackLines = Array.isArray(fallback?.cashbackLines) ? fallback.cashbackLines : []

  return {
    basePricePerLitre: primary?.basePricePerLitre ?? fallback?.basePricePerLitre ?? null,
    subtotal: primary?.subtotal ?? fallback?.subtotal ?? null,
    finalAmountPaid: primary?.finalAmountPaid ?? fallback?.finalAmountPaid ?? null,
    effectivePricePerLitre: primary?.effectivePricePerLitre ?? fallback?.effectivePricePerLitre ?? null,
    discountLines: primaryDiscountLines.length ? primaryDiscountLines : fallbackDiscountLines,
    totalDirectDiscount: primary?.totalDirectDiscount ?? fallback?.totalDirectDiscount ?? 0,
    promoLabelsApplied: primaryPromoLabels.length ? primaryPromoLabels : fallbackPromoLabels,
    cashbackLines: primaryCashbackLines.length ? primaryCashbackLines : fallbackCashbackLines,
    cashbackTotal: primary?.cashbackTotal ?? fallback?.cashbackTotal ?? 0,
  }
}

export function buildQueueReceiptPayload(row) {
  const item = userQueueHistoryResponseFromRow(row)
  if (item.paymentMode !== "PREPAY") {
    throw badRequest("Receipt is available only for SmartPay queue payments.")
  }
  if (!["SERVED", "COMPLETED"].includes(String(item.queueStatus || "").trim().toUpperCase())) {
    throw badRequest("Receipt is available only after the digital queue is served.")
  }

  const completedAt = item.servedAt || item.lastMovementAt || item.joinedAt
  const metadata = parseJsonObject(row?.metadata)
  const promotionReceiptDetails = mergePromotionReceiptDetails(
    buildPromotionReceiptDetailsFromTransactionRow(row),
    buildPromotionReceiptDetailsFromMetadata(metadata, {
      preferServiceRequest: true,
    })
  )
  const databaseUnitPrice =
    toNumberOrNull(row?.base_price_per_litre)
    ?? toNumberOrNull(row?.price_per_litre)
    ?? item.pricePerLitre
  const databaseEffectivePrice =
    toNumberOrNull(row?.effective_price_per_litre)
    ?? toNumberOrNull(row?.price_per_litre)
    ?? item.pricePerLitre
  const databaseFinalAmount =
    toNumberOrNull(row?.wallet_total_amount)
    ?? toNumberOrNull(row?.final_amount_paid)
    ?? toNumberOrNull(row?.total_amount)
    ?? item.totalAmount
  const databaseLitres =
    toNumberOrNull(row?.litres)
    ?? item.requestedLiters

  return {
    title: "Fuel Receipt",
    subtitle: "SmartLink verified queue transaction",
    systemName: "SmartLink",
    transactionId:
      String(row?.transaction_public_id || "").trim()
      || item.transactionReference
      || buildReceiptTransactionId("SPQ", item.reference, completedAt),
    reference: item.reference,
    paymentMethod: item.paymentMode === "PREPAY" ? "SMARTPAY" : "PAY_AT_PUMP",
    paymentStatus: item.paymentStatus || "PAID",
    stationName: item.station?.name || "Station",
    stationLocation: item.station?.area || "-",
    occurredAt: completedAt,
    pumpNumber: item.pumpNumber ?? null,
    nozzleLabel: item.nozzleLabel || "-",
    fuelType: String(item.fuelType || "").trim() || "-",
    litres: databaseLitres ?? null,
    unitPrice: databaseUnitPrice ?? promotionReceiptDetails.basePricePerLitre ?? item.pricePerLitre,
    baseSubtotal: promotionReceiptDetails.subtotal ?? databaseFinalAmount ?? item.totalAmount,
    discountLines: promotionReceiptDetails.discountLines,
    totalDirectDiscount: promotionReceiptDetails.totalDirectDiscount,
    promoLabelsApplied: promotionReceiptDetails.promoLabelsApplied,
    cashbackLines: promotionReceiptDetails.cashbackLines,
    cashbackTotal: promotionReceiptDetails.cashbackTotal,
    finalAmountPaid: databaseFinalAmount ?? promotionReceiptDetails.finalAmountPaid ?? item.totalAmount,
    effectivePricePerLitre: databaseEffectivePrice ?? promotionReceiptDetails.effectivePricePerLitre ?? item.pricePerLitre,
    queueJoinId: item.reference,
    reservationId: null,
    verificationReference: String(row?.receipt_verification_ref || "").trim() || item.reference,
    verificationUrl: null,
    paymentReference: String(row?.payment_reference || "").trim() || item.transactionReference || null,
  }
}

export function buildReservationReceiptPayload(row) {
  const item = userReservationResponseFromRow(row)
  if (item.paymentMode !== "PREPAY") {
    throw badRequest("Receipt is available only for SmartPay reservation payments.")
  }
  if (!["FULFILLED", "COMPLETED"].includes(String(item.reservationStatus || "").trim().toUpperCase())) {
    throw badRequest("Receipt is available only after the reservation is completed.")
  }

  const completedAt = item.servedAt || item.slotEnd || item.joinedAt
  const metadata = parseReservationMetadata(row?.metadata)
  const promotionReceiptDetails = mergePromotionReceiptDetails(
    buildPromotionReceiptDetailsFromTransactionRow(row),
    buildPromotionReceiptDetailsFromMetadata(metadata)
  )
  const databaseUnitPrice =
    toNumberOrNull(row?.base_price_per_litre)
    ?? toNumberOrNull(row?.price_per_litre)
    ?? item.pricePerLitre
  const databaseEffectivePrice =
    toNumberOrNull(row?.effective_price_per_litre)
    ?? toNumberOrNull(row?.price_per_litre)
    ?? item.pricePerLitre
  const databaseFinalAmount =
    toNumberOrNull(row?.wallet_total_amount)
    ?? toNumberOrNull(row?.final_amount_paid)
    ?? toNumberOrNull(row?.total_amount)
    ?? item.totalAmount
    ?? item.depositAmount
  const databaseLitres =
    toNumberOrNull(row?.litres)
    ?? item.litersReserved

  return {
    title: "Fuel Receipt",
    subtitle: "SmartLink verified reservation transaction",
    systemName: "SmartLink",
    transactionId:
      String(row?.transaction_public_id || "").trim()
      || item.transactionReference
      || buildReceiptTransactionId("SPR", item.reference, completedAt),
    reference: item.reference,
    paymentMethod: item.paymentMode === "PREPAY" ? "SMARTPAY" : "PAY_AT_PUMP",
    paymentStatus: item.paymentStatus || "PAID",
    stationName: item.station?.name || "Station",
    stationLocation: item.station?.area || "-",
    occurredAt: completedAt,
    pumpNumber: item.pumpNumber ?? null,
    nozzleLabel: item.nozzleLabel || "-",
    fuelType: String(item.fuelType || "").trim() || "-",
    litres: databaseLitres ?? null,
    unitPrice: databaseUnitPrice ?? promotionReceiptDetails.basePricePerLitre ?? item.pricePerLitre,
    baseSubtotal: promotionReceiptDetails.subtotal ?? databaseFinalAmount ?? item.totalAmount ?? item.depositAmount,
    discountLines: promotionReceiptDetails.discountLines,
    totalDirectDiscount: promotionReceiptDetails.totalDirectDiscount,
    promoLabelsApplied: promotionReceiptDetails.promoLabelsApplied,
    cashbackLines: promotionReceiptDetails.cashbackLines,
    cashbackTotal: promotionReceiptDetails.cashbackTotal,
    finalAmountPaid: databaseFinalAmount ?? promotionReceiptDetails.finalAmountPaid ?? item.totalAmount ?? item.depositAmount,
    effectivePricePerLitre: databaseEffectivePrice ?? promotionReceiptDetails.effectivePricePerLitre ?? item.pricePerLitre,
    queueJoinId: item.queueJoinId || null,
    reservationId: item.reference,
    verificationReference: String(row?.receipt_verification_ref || "").trim() || item.reference,
    verificationUrl: null,
    paymentReference: String(row?.payment_reference || "").trim() || item.transactionReference || null,
  }
}

async function listPumpFuelNozzles({ stationId, pumpId, fuelTypeCode }) {
  return prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.nozzle_number,
      pn.status,
      ft.code AS fuel_code
    FROM pump_nozzles pn
    INNER JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    WHERE pn.station_id = ${stationId}
      AND pn.pump_id = ${pumpId}
      AND pn.is_active = 1
    ORDER BY
      CASE WHEN ft.code = ${fuelTypeCode} THEN 0 ELSE 1 END,
      CASE WHEN pn.status = 'ACTIVE' THEN 0 ELSE 1 END,
      pn.nozzle_number ASC,
      pn.id ASC
  `
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
    return label === normalizedFuelType || label.startsWith(`${normalizedFuelType} `) || label.includes(normalizedFuelType)
  })

  const priceSource = matchingItem || null
  if (!priceSource) return null

  const amount =
    parsePriceAmount(priceSource?.pricePerLitre) ??
    parsePriceAmount(priceSource?.price_per_litre) ??
    parsePriceAmount(priceSource?.price) ??
    parsePriceAmount(priceSource?.amount) ??
    parsePriceAmount(priceSource?.value)

  if (!Number.isFinite(amount) || amount <= 0) return null
  return Number(amount.toFixed(2))
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function isRefundRequestWindowExpired(occurredAt, now = new Date()) {
  const transactionTime = occurredAt instanceof Date ? occurredAt : new Date(occurredAt)
  if (Number.isNaN(transactionTime.getTime())) return true
  const elapsedMs = now.getTime() - transactionTime.getTime()
  if (elapsedMs < 0) return false
  return elapsedMs > REFUND_REQUEST_WINDOW_HOURS * 60 * 60 * 1000
}

function roundToNextReservationSlot(fromDate = new Date()) {
  const date = new Date(fromDate)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCSeconds(0, 0)
  const minutes = date.getUTCMinutes()
  const remainder = minutes % RESERVATION_SLOT_MINUTES
  if (remainder > 0) {
    date.setUTCMinutes(minutes + (RESERVATION_SLOT_MINUTES - remainder))
  }
  return date
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function parseIsoOrThrow(value, fieldName) {
  const parsed = new Date(String(value || "").trim())
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldName} must be a valid ISO datetime`)
  }
  return parsed
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineKm(origin, destination) {
  const radiusKm = 6371
  const deltaLat = toRadians(destination.lat - origin.lat)
  const deltaLng = toRadians(destination.lng - origin.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) * Math.sin(deltaLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return radiusKm * c
}

function mapReservationStatusToQueueStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CONFIRMED" || normalized === "CHECKED_IN") return "CALLED"
  if (normalized === "FULFILLED") return "SERVED"
  if (normalized === "CANCELLED") return "CANCELLED"
  if (normalized === "EXPIRED") return "NO_SHOW"
  return "WAITING"
}

function queueStatusToUserLabel(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "WAITING") return "Waiting"
  if (normalized === "CALLED") return "Called"
  if (normalized === "LATE") return "Late"
  if (normalized === "NO_SHOW") return "No Show"
  if (normalized === "SERVED") return "Served"
  if (normalized === "CANCELLED") return "Cancelled"
  return "Joined"
}

function buildReservationQrToken({ reservationId, stationPublicId, userId }) {
  const digest = crypto
    .createHash("sha256")
    .update(`${reservationId}|${stationPublicId}|${userId}|${Date.now()}`)
    .digest("hex")
  return `smartlink-res:${reservationId}:${digest.slice(0, 24)}`
}

function buildSlotLabel(slotStart, slotEnd) {
  if (!slotStart) return "No slot"
  const start = new Date(slotStart)
  if (Number.isNaN(start.getTime())) return "No slot"
  const end = slotEnd ? new Date(slotEnd) : new Date(start.getTime() + 30 * 60 * 1000)
  const options = { hour: "2-digit", minute: "2-digit", hour12: true }
  return `${start.toLocaleTimeString([], options)} - ${end.toLocaleTimeString([], options)}`
}

function buildDateLabel(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
}

function buildTimeLabel(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function userReservationResponseFromRow(row) {
  const metadata = parseReservationMetadata(row.metadata)
  const receiptDetails = extractReservationReceiptDetails(metadata, row)
  const queueJoinId = row.queue_join_public_id || row.reservation_public_id
  const queueStatus = mapReservationStatusToQueueStatus(row.reservation_status)
  const joinedAt = row.created_at
  const slotDateLabel = String(row.slot_date_label_local || "").trim() || buildDateLabel(row.slot_start)
  const slotLabel = String(row.slot_label_local || "").trim() || buildSlotLabel(row.slot_start, row.slot_end)
  const expiresTimeLabel = String(row.expires_time_label_local || "").trim() || buildTimeLabel(row.expires_at)

  return {
    id: row.reservation_public_id,
    reference: row.reservation_public_id,
    queueJoinId,
    queueStatus,
    status: reservationStatusToUserLabel(row.reservation_status),
    reservationStatus: String(row.reservation_status || "").toUpperCase() || "PENDING",
    station: {
      publicId: row.station_public_id,
      name: row.station_name,
      area: row.station_area || null,
    },
    fuelType: String(row.fuel_type || "").toUpperCase() || "PETROL",
    litersReserved:
      row.requested_litres !== null && row.requested_litres !== undefined
        ? Number(row.requested_litres)
        : extractRequestedLiters(metadata),
    depositAmount:
      row.deposit_amount !== null && row.deposit_amount !== undefined
        ? Number(row.deposit_amount)
        : toNumberOrNull(metadata.depositAmount),
    maskedPlate: row.identifier || null,
    joinedAt: toIsoOrNull(joinedAt),
    slotStart: toIsoOrNull(row.slot_start),
    slotEnd: toIsoOrNull(row.slot_end),
    slotLabel,
    slotDateLabel,
    checkInTime: toIsoOrNull(row.check_in_time),
    expiresAt: toIsoOrNull(row.expires_at),
    expiresTimeLabel,
    calledAt: row.confirmed_at ? toIsoOrNull(row.confirmed_at) : null,
    servedAt: row.fulfilled_at ? toIsoOrNull(row.fulfilled_at) : null,
    cancelledAt: row.cancelled_at ? toIsoOrNull(row.cancelled_at) : null,
    checkInMethod: String(metadata.checkInMethod || "").toUpperCase() || null,
    policy: metadata.policy || null,
    paymentMode: receiptDetails.paymentMode,
    pricePerLitre: receiptDetails.pricePerLitre,
    totalAmount: receiptDetails.totalAmount,
    currencyCode: receiptDetails.currencyCode,
    transactionReference: receiptDetails.transactionReference,
    paymentStatus: receiptDetails.paymentStatus,
    pumpNumber: receiptDetails.pumpNumber,
    nozzleLabel: receiptDetails.nozzleLabel,
  }
}

function userQueueHistoryResponseFromRow(row) {
  const metadata = parseJsonObject(row.metadata)
  const receiptDetails = extractQueueReceiptDetails(metadata, row)
  const queueStatus = String(row.queue_status || row.status || "").trim().toUpperCase() || "WAITING"

  return {
    id: row.queue_join_public_id,
    reference: row.queue_join_public_id,
    queueJoinId: row.queue_join_public_id,
    queueStatus,
    status: queueStatusToUserLabel(queueStatus),
    station: {
      publicId: row.station_public_id,
      name: row.station_name,
      area: row.station_area || null,
    },
    fuelType: String(row.fuel_type || "").trim().toUpperCase() || "PETROL",
    requestedLiters:
      row.requested_litres !== null && row.requested_litres !== undefined
        ? Number(row.requested_litres)
        : toNumberOrNull(metadata.requestedLiters),
    maskedPlate: row.masked_plate || null,
    joinedAt: toIsoOrNull(row.joined_at),
    calledAt: toIsoOrNull(row.called_at),
    servedAt: toIsoOrNull(row.served_at),
    cancelledAt: toIsoOrNull(row.cancelled_at),
    lastMovementAt: toIsoOrNull(row.last_moved_at),
    paymentMode: receiptDetails.paymentMode,
    pricePerLitre: receiptDetails.pricePerLitre,
    totalAmount: receiptDetails.totalAmount,
    currencyCode: receiptDetails.currencyCode,
    transactionReference: receiptDetails.transactionReference,
    paymentStatus: receiptDetails.paymentStatus,
    pumpNumber: receiptDetails.pumpNumber,
    nozzleLabel: receiptDetails.nozzleLabel,
  }
}

export async function ensureReservationsTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, deposit_amount, check_in_time, expires_at
      FROM user_reservations
      LIMIT 1
    `
  } catch (error) {
    const message = String(error?.message || "").toLowerCase()
    if (isReservationsTableMissingError(error) || message.includes("unknown column")) {
      throw badRequest(
        "Reservations storage is unavailable. Run SQL migrations 015_create_user_reservations.sql, 016_user_reservations_user_nullable.sql, and 017_user_reservations_rules.sql."
      )
    }
    throw error
  }
}

function isRefundRequestsStorageError(error) {
  const message = String(error?.message || "").toLowerCase()
  return (
    (message.includes("refund_requests") && (
      message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("unknown table") ||
      message.includes("unknown column")
    )) ||
    message.includes("wallet_transaction_reference") ||
    message.includes("credited_at")
  )
}

async function ensureRefundRequestsTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, public_id, transaction_public_id, wallet_transaction_reference, credited_at
      FROM refund_requests
      LIMIT 1
    `
  } catch (error) {
    if (isRefundRequestsStorageError(error)) {
      throw badRequest(
        "Refund request storage is unavailable. Run SQL migrations 027_internal_dashboard_expansion.sql and 037_refund_request_wallet_payout_links.sql."
      )
    }
    throw error
  }
}

function mapRefundPriorityByAmount(amount) {
  const normalizedAmount = Number(amount || 0)
  if (normalizedAmount >= 50000) return "CRITICAL"
  if (normalizedAmount >= 25000) return "HIGH"
  if (normalizedAmount >= 10000) return "MEDIUM"
  return "LOW"
}

function buildWalletRefundSupportCaseSubject(transactionPublicId) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  return scopedTransactionPublicId
    ? `Wallet refund request ${scopedTransactionPublicId}`
    : "Wallet refund request"
}

function buildWalletRefundSupportCaseSummary({
  transactionPublicId,
  walletTransactionReference,
  amountMwk,
  reason,
}) {
  const transactionLabel = String(transactionPublicId || "").trim() || "unknown transaction"
  const walletReferenceLabel = String(walletTransactionReference || "").trim()
  const amountLabel = Number(amountMwk || 0).toLocaleString()
  const normalizedReason = String(reason || "").trim()

  return [
    `User submitted a wallet refund request for transaction ${transactionLabel}.`,
    `Requested amount: MWK ${amountLabel}.`,
    walletReferenceLabel ? `Wallet reference: ${walletReferenceLabel}.` : null,
    normalizedReason ? `Reason: ${normalizedReason}` : null,
  ]
    .filter(Boolean)
    .join(" ")
}

async function resolveRefundableWalletTransactionForUser({ userId, transactionPublicId }) {
  const normalizedUserId = Number(userId || 0)
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !scopedTransactionPublicId) {
    return null
  }

  const rows = await prisma.$queryRaw`
    SELECT
      tx.public_id,
      tx.station_id,
      tx.user_id,
      tx.reservation_public_id,
      qe.public_id AS queue_entry_public_id,
      tx.total_amount,
      COALESCE(tx.occurred_at, tx.dispensed_at, tx.settled_at, tx.authorized_at, tx.created_at) AS transaction_occurred_at,
      wallet_tx.transaction_reference AS wallet_transaction_reference,
      wallet_tx.net_amount AS wallet_amount
    FROM transactions tx
    LEFT JOIN queue_entries qe
      ON qe.id = tx.queue_entry_id
    LEFT JOIN ledger_transactions wallet_tx
      ON (
        wallet_tx.external_reference = tx.public_id
        OR (
          wallet_tx.related_entity_type = 'RESERVATION'
          AND wallet_tx.related_entity_id = tx.reservation_public_id
        )
        OR (
          wallet_tx.related_entity_type = 'QUEUE'
          AND qe.public_id IS NOT NULL
          AND wallet_tx.related_entity_id = qe.public_id
        )
      )
     AND wallet_tx.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
     AND wallet_tx.transaction_status = 'POSTED'
    WHERE tx.public_id = ${scopedTransactionPublicId}
      AND tx.user_id = ${normalizedUserId}
    ORDER BY wallet_tx.id DESC
    LIMIT 1
  `

  const row = rows?.[0] || null
  if (!row?.public_id || !row?.wallet_transaction_reference) return null

  return {
    transactionPublicId: String(row.public_id).trim(),
    stationId: Number(row.station_id || 0) || null,
    reservationPublicId: String(row.reservation_public_id || "").trim() || null,
    queueJoinId: String(row.queue_entry_public_id || "").trim() || null,
    walletTransactionReference: String(row.wallet_transaction_reference || "").trim() || null,
    sourceAmount: Number(row.wallet_amount || row.total_amount || 0),
    occurredAt: toIsoOrNull(row.transaction_occurred_at),
  }
}

async function expireOverdueReservations({ userId = null, stationId = null } = {}) {
  const whereParts = []
  const values = []
  const scopedUserId = Number(userId || 0)
  const scopedStationId = Number(stationId || 0)

  if (Number.isFinite(scopedUserId) && scopedUserId > 0) {
    whereParts.push("user_id = ?")
    values.push(scopedUserId)
  }
  if (Number.isFinite(scopedStationId) && scopedStationId > 0) {
    whereParts.push("station_id = ?")
    values.push(scopedStationId)
  }

  const whereClause = whereParts.length ? ` AND ${whereParts.join(" AND ")}` : ""
  const expiredRows = await prisma.$queryRawUnsafe(
    `
      SELECT public_id
      FROM user_reservations
      WHERE status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
        AND COALESCE(expires_at, DATE_ADD(slot_end, INTERVAL ${RESERVATION_LATE_CANCEL_MINUTES} MINUTE)) < CURRENT_TIMESTAMP(3)
        ${whereClause}
    `,
    ...values
  )

  const reservationPublicIds = Array.isArray(expiredRows)
    ? expiredRows
        .map((row) => String(row?.public_id || "").trim())
        .filter(Boolean)
    : []
  if (!reservationPublicIds.length) return 0

  const sql = `
    UPDATE user_reservations
    SET
      status = 'EXPIRED',
      cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP(3)),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
      AND COALESCE(expires_at, DATE_ADD(slot_end, INTERVAL ${RESERVATION_LATE_CANCEL_MINUTES} MINUTE)) < CURRENT_TIMESTAMP(3)
      ${whereClause}
  `

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(sql, ...values)
    for (const reservationPublicId of reservationPublicIds) {
      await releaseReservationWalletHold(
        {
          reservationPublicId,
          actorUserId: null,
          reason: "RESERVATION_EXPIRED",
        },
        { tx }
      )
    }
  })

  return reservationPublicIds.length
}

export async function getActiveReservationForUser(userId) {
  const rows = await prisma.$queryRaw`
    SELECT public_id, station_id, status, slot_start, slot_end
    FROM user_reservations
    WHERE user_id = ${userId}
      AND status IN ('PENDING', 'CONFIRMED')
      AND COALESCE(expires_at, DATE_ADD(slot_end, INTERVAL ${RESERVATION_LATE_CANCEL_MINUTES} MINUTE)) >= CURRENT_TIMESTAMP(3)
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function resolveStationReservationContext(stationPublicId) {
  const station = await resolveStationOrThrow(stationPublicId)
  const settings = await getQueueSettings(station.id)
  const pumpRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS active_pumps
    FROM pumps
    WHERE station_id = ${station.id}
      AND is_active = 1
  `

  let stationProfile = null
  try {
    const profileRows = await prisma.$queryRaw`
      SELECT
        id,
        public_id,
        name,
        city,
        address,
        timezone,
        latitude,
        longitude,
        prices_json
      FROM stations
      WHERE id = ${station.id}
      LIMIT 1
    `
    stationProfile = profileRows?.[0] || null
  } catch {
    const profileRows = await prisma.$queryRaw`
      SELECT
        id,
        public_id,
        name,
        city,
        address,
        timezone,
        prices_json
      FROM stations
      WHERE id = ${station.id}
      LIMIT 1
    `
    stationProfile = profileRows?.[0] || null
  }

  const activePumps = Math.max(0, Number(pumpRows?.[0]?.active_pumps || 0))
  const computedSlotCapacity = Math.max(1, activePumps * Math.max(1, RESERVATION_SLOT_EFFICIENCY_FACTOR))
  const overrideSlotCapacity = Number(settings?.reservation_slot_capacity || 0)
  const slotCapacity =
    Number.isFinite(overrideSlotCapacity) && overrideSlotCapacity > 0
      ? Math.round(overrideSlotCapacity)
      : computedSlotCapacity
  const geoLockKm = Number(settings?.reservation_geo_lock_km || 15)

  return {
    station: stationProfile || station,
    settings,
    slotCapacity: Math.max(1, slotCapacity),
    geoLockKm: Number.isFinite(geoLockKm) && geoLockKm > 0 ? geoLockKm : 15,
  }
}

function reservationsEnabledForStationSettings(settings = {}) {
  if (settings?.reservations_enabled === undefined || settings?.reservations_enabled === null) return true
  return Boolean(Number(settings.reservations_enabled || 0))
}

async function assertUserStationPlanFeature(stationId, featureKey) {
  const scopedStationId = Number(stationId || 0)
  if (!Number.isFinite(scopedStationId) || scopedStationId <= 0) {
    throw badRequest("Valid station context is required")
  }

  const subscription = await getStationSubscriptionSummary(scopedStationId)
  if (hasStationPlanFeature(subscription?.planCode, featureKey)) {
    return subscription
  }

  const error = new Error(buildStationPlanUpgradeMessage(featureKey, subscription))
  error.status = 403
  throw error
}

export async function executeQueueJoinAction({
  stationPublicId,
  auth,
  body,
  source = "user_app",
} = {}) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  if (!scopedStationPublicId) throw badRequest("stationPublicId is required")

  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) {
    throw badRequest("Authenticated user context is required")
  }

  const parsedBody = joinBodySchema.parse(body || {})
  const station = await resolveStationOrThrow(scopedStationPublicId)

  if (parsedBody.prepay === true) {
    await ensureWalletTablesReady()
    const walletSummary = await getUserWalletSummary(authUserId)
    assertWalletEligibleForQueuePrepay(walletSummary)
  }

  const existingEntryRows = await prisma.$queryRaw`
    SELECT public_id
    FROM queue_entries
    WHERE station_id = ${station.id}
      AND user_id = ${authUserId}
      AND status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY joined_at ASC
    LIMIT 1
  `

  const existingEntry = existingEntryRows?.[0]
  if (existingEntry?.public_id) {
    const snapshot = await buildUserQueueStatusSnapshot({
      queueJoinId: existingEntry.public_id,
      auth,
    })
    return {
      httpStatus: 200,
      queueJoinId: existingEntry.public_id,
      reusedExisting: true,
      status: snapshot,
    }
  }

  await assertUserStationPlanFeature(station.id, STATION_PLAN_FEATURES.DIGITAL_QUEUE)

  const [settings, activeCountRows] = await Promise.all([
    getQueueSettings(station.id),
    prisma.$queryRaw`
      SELECT COUNT(*) AS active_count
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
    `,
  ])

  if (!Number(settings?.is_queue_enabled || 0)) throw badRequest("Queue is disabled")
  if (Number(settings?.joins_paused || 0)) throw badRequest("Queue joins are currently paused")
  if (parsedBody.fuelType === "PETROL" && !Number(settings?.petrol_enabled || 0)) {
    throw badRequest("Petrol queue is disabled")
  }
  if (parsedBody.fuelType === "DIESEL" && !Number(settings?.diesel_enabled || 0)) {
    throw badRequest("Diesel queue is disabled")
  }

  const fuelStatuses = await listStationFuelStatusesForQueueJoin(station.id, settings)
  const selectedFuelStatus = (fuelStatuses || []).find(
    (item) => String(item?.code || "").trim().toUpperCase() === parsedBody.fuelType
  )
  if (String(selectedFuelStatus?.status || "").trim().toLowerCase() === "unavailable") {
    throw badRequest(`${selectedFuelStatus?.label || parsedBody.fuelType} is unavailable at this station right now`)
  }

  const activeCount = Number(activeCountRows?.[0]?.active_count || 0)
  if (activeCount >= Number(settings?.capacity || 100)) {
    throw badRequest("Queue capacity reached")
  }

  const [fuelTypeId, maxPositionRows] = await Promise.all([
    getFuelTypeId(parsedBody.fuelType),
    prisma.$queryRaw`
      SELECT COALESCE(MAX(position), 0) AS max_position
      FROM queue_entries
      WHERE station_id = ${station.id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
    `,
  ])

  const nextPosition = Number(maxPositionRows?.[0]?.max_position || 0) + 1
  const queueJoinId = createPublicId()
  const metadataPayload = {
    paymentMode: parsedBody.prepay ? "PREPAY" : "PAY_AT_PUMP",
    prepaySelected: Boolean(parsedBody.prepay),
    source,
  }
  if (parsedBody.requestedLiters) {
    metadataPayload.requestedLiters = Number(parsedBody.requestedLiters)
  }
  const metadata = JSON.stringify(metadataPayload)

  await prisma.$executeRaw`
    INSERT INTO queue_entries (
      station_id,
      public_id,
      user_id,
      masked_plate,
      fuel_type_id,
      position,
      status,
      last_moved_at,
      metadata
    )
    VALUES (
      ${station.id},
      ${queueJoinId},
      ${authUserId},
      ${parsedBody.maskedPlate || null},
      ${fuelTypeId},
      ${nextPosition},
      'WAITING',
      CURRENT_TIMESTAMP(3),
      ${metadata}
    )
  `

  await writeAuditLog({
    stationId: station.id,
    actionType: "QUEUE_USER_JOIN",
    payload: {
      queueJoinId,
      fuelType: parsedBody.fuelType,
      userPublicId: auth?.userPublicId || null,
      source,
    },
  })

  const status = await buildUserQueueStatusSnapshot({
    queueJoinId,
    auth,
  })

  return {
    httpStatus: 201,
    queueJoinId,
    reusedExisting: false,
    status,
  }
}

export async function listReservationSlotsForUser({
  stationPublicId,
  auth,
  query,
} = {}) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  if (!scopedStationPublicId) throw badRequest("stationPublicId is required")

  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) {
    throw badRequest("Authenticated user context is required")
  }

  await ensureReservationsTableReady()
  const parsedQuery = reservationSlotsQuerySchema.parse(query || {})
  const context = await resolveStationReservationContext(scopedStationPublicId)
  const settings = context.settings || {}

  await assertUserStationPlanFeature(context.station?.id, STATION_PLAN_FEATURES.RESERVATIONS)

  if (!reservationsEnabledForStationSettings(settings)) {
    throw badRequest("Reservations are currently paused for this station.")
  }
  if (parsedQuery.fuelType === "PETROL" && !Number(settings?.petrol_enabled ?? 1)) {
    throw badRequest("Petrol reservations are currently disabled at this station.")
  }
  if (parsedQuery.fuelType === "DIESEL" && !Number(settings?.diesel_enabled ?? 1)) {
    throw badRequest("Diesel reservations are currently disabled at this station.")
  }

  await expireOverdueReservations({ stationId: Number(context.station?.id || 0) })

  const lookAhead = Number(parsedQuery.lookAhead || RESERVATION_DEFAULT_SLOT_LOOKAHEAD)
  const firstSlotStart = roundToNextReservationSlot(addMinutes(new Date(), 1))
  if (!firstSlotStart) throw badRequest("Unable to compute reservation slots")

  const slots = Array.from({ length: lookAhead }).map((_, index) => {
    const slotStart = addMinutes(firstSlotStart, index * RESERVATION_SLOT_MINUTES)
    const slotEnd = addMinutes(slotStart, RESERVATION_SLOT_MINUTES)
    return { slotStart, slotEnd }
  })
  const reservedCountsBySlot = await Promise.all(
    slots.map(async (slot) => {
      const slotStartSql =
        formatDateTimeSqlInTimeZone(slot.slotStart, context.station?.timezone) ||
        slot.slotStart.toISOString().slice(0, 19).replace("T", " ") + ".000"
      const slotEndSql =
        formatDateTimeSqlInTimeZone(slot.slotEnd, context.station?.timezone) ||
        slot.slotEnd.toISOString().slice(0, 19).replace("T", " ") + ".000"

      const rows = await prisma.$queryRaw`
        SELECT COUNT(*) AS reserved_count
        FROM user_reservations
        WHERE station_id = ${context.station.id}
          AND status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
          AND slot_start < ${slotEndSql}
          AND slot_end > ${slotStartSql}
      `
      return Number(rows?.[0]?.reserved_count || 0)
    })
  )

  const responseSlots = slots.map((slot, index) => {
    const reserved = reservedCountsBySlot[index] || 0
    const availableSpots = Math.max(0, context.slotCapacity - reserved)
    const isFull = availableSpots <= 0

    return {
      slotStart: slot.slotStart.toISOString(),
      slotEnd: slot.slotEnd.toISOString(),
      slotLabel: buildSlotLabel(slot.slotStart, slot.slotEnd),
      slotDateLabel: buildDateLabel(slot.slotStart),
      reservedCount: reserved,
      capacity: context.slotCapacity,
      availableSpots,
      isFull,
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    stationPublicId: scopedStationPublicId,
    fuelType: parsedQuery.fuelType,
    rules: {
      oneActiveReservationOnly: true,
      disallowQueueAndReservationTogether: false,
      slotMinutes: RESERVATION_SLOT_MINUTES,
      graceMinutes: RESERVATION_GRACE_MINUTES,
      lateMoveMinutes: RESERVATION_LATE_MOVE_MINUTES,
      lateCancelMinutes: RESERVATION_LATE_CANCEL_MINUTES,
      minLiters: RESERVATION_MIN_LITERS,
      maxLiters: RESERVATION_MAX_LITERS,
      minDepositAmount: RESERVATION_MIN_DEPOSIT,
      maxDepositAmount: RESERVATION_MAX_DEPOSIT,
      slotCapacity: context.slotCapacity,
      geoLockKm: context.geoLockKm,
    },
    slots: responseSlots,
  }
}

export async function executeCreateReservationAction({
  stationPublicId,
  auth,
  body,
  source = "user_app",
} = {}) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  if (!scopedStationPublicId) throw badRequest("stationPublicId is required")

  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) {
    throw badRequest("Authenticated user context is required")
  }

  await ensureReservationsTableReady()
  const parsedBody = createReservationBodySchema.parse(body || {})
  const context = await resolveStationReservationContext(scopedStationPublicId)
  const settings = context.settings || {}

  await assertUserStationPlanFeature(context.station?.id, STATION_PLAN_FEATURES.RESERVATIONS)

  if (!reservationsEnabledForStationSettings(settings)) {
    throw badRequest("Reservations are currently paused for this station.")
  }
  if (Number(settings?.joins_paused || 0)) {
    throw badRequest("Reservations are temporarily paused by station management.")
  }
  if (parsedBody.fuelType === "PETROL" && !Number(settings?.petrol_enabled ?? 1)) {
    throw badRequest("Petrol reservations are currently disabled at this station.")
  }
  if (parsedBody.fuelType === "DIESEL" && !Number(settings?.diesel_enabled ?? 1)) {
    throw badRequest("Diesel reservations are currently disabled at this station.")
  }

  await expireOverdueReservations({ userId: authUserId, stationId: Number(context.station?.id || 0) })
  const activeReservation = await getActiveReservationForUser(authUserId)
  if (activeReservation?.public_id) {
    throw badRequest("You already have an active reservation. Only one reservation is allowed at a time.")
  }

  const expectedLiters = Number(parsedBody.expectedLiters)
  if (expectedLiters < RESERVATION_MIN_LITERS || expectedLiters > RESERVATION_MAX_LITERS) {
    throw badRequest(
      `Expected litres must be between ${RESERVATION_MIN_LITERS}L and ${RESERVATION_MAX_LITERS}L.`
    )
  }

  const fuelPricePerLitre = resolveFuelPricePerLitre(context.station?.prices_json, parsedBody.fuelType)
  if (!Number.isFinite(fuelPricePerLitre) || fuelPricePerLitre <= 0) {
    throw badRequest("Fuel price is unavailable for this station. Reservation cannot be created right now.")
  }

  const promotionPreview = await getPromotionPricingPreview({
    stationPublicId: scopedStationPublicId,
    fuelTypeCode: parsedBody.fuelType,
    litres: expectedLiters,
    paymentMethod: "SMARTPAY",
    userId: authUserId,
    now: new Date(),
    cashbackDestination: "WALLET",
  })
  const smartPayQuote = buildSmartPayPrepayQuote({
    pricing: promotionPreview?.pricing || {},
    basePricePerLitre: fuelPricePerLitre,
    litres: expectedLiters,
  })
  const estimatedFuelCost = Number(smartPayQuote.estimatedAmount)
  await ensureWalletStorageReadyOrThrow()

  const depositAmount = Number(parsedBody.depositAmount)
  if (depositAmount < RESERVATION_MIN_DEPOSIT || depositAmount > RESERVATION_MAX_DEPOSIT) {
    throw badRequest(
      `Deposit must be between MWK ${RESERVATION_MIN_DEPOSIT.toLocaleString()} and MWK ${RESERVATION_MAX_DEPOSIT.toLocaleString()}.`
    )
  }

  const slotStart = parseIsoOrThrow(parsedBody.slotStart, "slotStart")
  const slotEnd = parsedBody.slotEnd
    ? parseIsoOrThrow(parsedBody.slotEnd, "slotEnd")
    : addMinutes(slotStart, RESERVATION_SLOT_MINUTES)
  const slotStartSql =
    formatDateTimeSqlInTimeZone(slotStart, context.station?.timezone) ||
    slotStart.toISOString().slice(0, 19).replace("T", " ") + ".000"
  const slotEndSql =
    formatDateTimeSqlInTimeZone(slotEnd, context.station?.timezone) ||
    slotEnd.toISOString().slice(0, 19).replace("T", " ") + ".000"
  const slotDurationMinutes = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60000)
  if (slotDurationMinutes !== RESERVATION_SLOT_MINUTES) {
    throw badRequest(`Reservation slot must be exactly ${RESERVATION_SLOT_MINUTES} minutes.`)
  }
  if (slotStart.getUTCMinutes() % RESERVATION_SLOT_MINUTES !== 0) {
    throw badRequest("Reservation slot must align to 15-minute boundaries.")
  }
  if (slotEnd <= new Date()) {
    throw badRequest("Reservation slot has already passed.")
  }

  let reservedCountAfterInsert = 0

  const stationLat = toNumberOrNull(context.station?.latitude)
  const stationLng = toNumberOrNull(context.station?.longitude)
  const userLat = toNumberOrNull(parsedBody.userLat)
  const userLng = toNumberOrNull(parsedBody.userLng)
  let distanceKm = null

  if (
    stationLat !== null &&
    stationLng !== null &&
    userLat !== null &&
    userLng !== null
  ) {
    distanceKm = haversineKm(
      { lat: userLat, lng: userLng },
      { lat: stationLat, lng: stationLng }
    )
  }

  const fuelTypeId = await getFuelTypeId(parsedBody.fuelType)
  const reservationId = createReservationPublicIdValue({
    typeCode: "SLT",
    timestamp: slotStart,
    timeZone: context.station?.timezone,
  })
  const reservationDate =
    formatDateISOInTimeZone(slotStart, context.station?.timezone) ||
    appTodayISO() ||
    slotStart.toISOString().slice(0, 10)
  const expiresAt = addMinutes(slotEnd, RESERVATION_LATE_CANCEL_MINUTES)
  const expiresAtSql =
    formatDateTimeSqlInTimeZone(expiresAt, context.station?.timezone) ||
    expiresAt.toISOString().slice(0, 19).replace("T", " ") + ".000"
  const qrToken = buildReservationQrToken({
    reservationId,
    stationPublicId: scopedStationPublicId,
    userId: authUserId,
  })
  let reservationHold = null
  let walletAfterHold = null

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT station_id
      FROM station_queue_settings
      WHERE station_id = ${context.station.id}
      FOR UPDATE
    `

    const overlapRows = await tx.$queryRaw`
      SELECT COUNT(*) AS reserved_count
      FROM user_reservations
      WHERE station_id = ${context.station.id}
        AND status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
        AND slot_start < ${slotEndSql}
        AND slot_end > ${slotStartSql}
    `
    const reservedCount = Number(overlapRows?.[0]?.reserved_count || 0)
    if (reservedCount >= context.slotCapacity) {
      throw badRequest("Selected reservation slot is full. Please choose a different time.")
    }

    const holdResult = await createReservationWalletHold(
      {
        userId: authUserId,
        reservationPublicId: reservationId,
        amount: estimatedFuelCost,
        expiresAt,
        actorUserId: authUserId,
      },
      { tx }
    )

    reservationHold = holdResult?.hold || null
    walletAfterHold = holdResult?.walletAfterHold || null

    const metadata = {
      qrToken,
      policy: {
        slotMinutes: RESERVATION_SLOT_MINUTES,
        graceMinutes: RESERVATION_GRACE_MINUTES,
        lateMoveMinutes: RESERVATION_LATE_MOVE_MINUTES,
        lateCancelMinutes: RESERVATION_LATE_CANCEL_MINUTES,
        minLiters: RESERVATION_MIN_LITERS,
        maxLiters: RESERVATION_MAX_LITERS,
        minDepositAmount: RESERVATION_MIN_DEPOSIT,
        maxDepositAmount: RESERVATION_MAX_DEPOSIT,
        cancellation: {
          fullRefundBeforeMinutes: 30,
          partialRefundPctWithinMinutes: 50,
          noShowForfeitPct: 100,
        },
      },
      distanceKm: distanceKm !== null ? Number(distanceKm.toFixed(2)) : null,
      geoLockBypassed: true,
      source,
      pricing: {
        currencyCode: String(walletAfterHold?.currencyCode || "MWK").trim() || "MWK",
        basePricePerLitre: smartPayQuote.basePricePerLitre,
        pricePerLitre: fuelPricePerLitre,
        payablePricePerLitre: smartPayQuote.payablePricePerLitre,
        subtotal: smartPayQuote.subtotal,
        totalDirectDiscount: smartPayQuote.totalDirectDiscount,
        cashbackTotal: smartPayQuote.cashbackTotal,
        estimatedFuelCost,
        effectiveNetCost: smartPayQuote.effectiveNetCost,
        effectivePricePerLitre: smartPayQuote.effectivePricePerLitre,
        promoLabelsApplied: smartPayQuote.promoLabelsApplied,
        walletAvailableBalanceBeforeReservation: Number(
          Number(holdResult?.walletBeforeHold?.availableBalance || 0).toFixed(2)
        ),
        walletAvailableBalanceAfterHold: Number(
          Number(walletAfterHold?.availableBalance || 0).toFixed(2)
        ),
      },
      walletHold: reservationHold
        ? {
            reference: reservationHold.reference,
            amount: reservationHold.amount,
            currencyCode: reservationHold.currencyCode,
            status: reservationHold.status,
            expiresAt: reservationHold.expiresAt,
          }
        : null,
    }

    await tx.$executeRaw`
      INSERT INTO user_reservations (
        public_id,
        user_id,
        station_id,
        fuel_type_id,
        reservation_date,
        slot_start,
        slot_end,
        expires_at,
        requested_litres,
        deposit_amount,
        identifier,
        status,
        metadata,
        created_at,
        confirmed_at
      )
      VALUES (
        ${reservationId},
        ${authUserId},
        ${context.station.id},
        ${fuelTypeId},
        ${reservationDate},
        ${slotStartSql},
        ${slotEndSql},
        ${expiresAtSql},
        ${expectedLiters},
        ${depositAmount},
        ${parsedBody.identifier},
        'CONFIRMED',
        ${JSON.stringify(metadata)},
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      )
    `

    reservedCountAfterInsert = reservedCount + 1
  })

  await writeAuditLog({
    stationId: context.station.id,
    actionType: "RESERVATION_USER_CREATE",
    payload: {
      reservationPublicId: reservationId,
      userPublicId: auth?.userPublicId || null,
      fuelType: parsedBody.fuelType,
      expectedLiters,
      estimatedFuelCost,
      fuelPricePerLitre,
      totalDirectDiscount: smartPayQuote.totalDirectDiscount,
      cashbackTotal: smartPayQuote.cashbackTotal,
      promoLabelsApplied: smartPayQuote.promoLabelsApplied,
      walletHoldReference: reservationHold?.reference || null,
      depositAmount,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      remainingSpots: Math.max(0, context.slotCapacity - reservedCountAfterInsert),
      source,
    },
  })

  return {
    httpStatus: 201,
    reservationId,
    reservation: {
      id: reservationId,
      reference: reservationId,
      status: "Confirmed",
      reservationStatus: "CONFIRMED",
      queueStatus: "CALLED",
      station: {
        publicId: scopedStationPublicId,
        name: context.station?.name || "Station",
        area: context.station?.city || context.station?.address || null,
      },
      fuelType: parsedBody.fuelType,
      litersReserved: expectedLiters,
      estimatedFuelCost,
      pricePerLitre: smartPayQuote.payablePricePerLitre,
      basePricePerLitre: smartPayQuote.basePricePerLitre,
      subtotal: smartPayQuote.subtotal,
      totalDirectDiscount: smartPayQuote.totalDirectDiscount,
      cashbackTotal: smartPayQuote.cashbackTotal,
      promoLabelsApplied: smartPayQuote.promoLabelsApplied,
      walletHoldReference: reservationHold?.reference || null,
      walletAvailableBalance: walletAfterHold?.availableBalance ?? null,
      depositAmount,
      maskedPlate: parsedBody.identifier,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      slotLabel: buildSlotLabel(slotStart, slotEnd),
      slotDateLabel: buildDateLabel(slotStart),
      expiresAt: expiresAt.toISOString(),
      isFull: reservedCountAfterInsert >= context.slotCapacity,
    },
  }
}

export async function executeCancelReservationAction({
  reservationPublicId,
  auth,
  body,
  source = "user_app",
} = {}) {
  const scopedReservationPublicId = String(reservationPublicId || "").trim()
  if (!scopedReservationPublicId) throw badRequest("reservationPublicId is required")

  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) {
    throw badRequest("Authenticated user context is required")
  }

  await ensureReservationsTableReady()
  const parsedBody = cancelReservationBodySchema.parse(body || {})
  await expireOverdueReservations({ userId: authUserId })

  const reservationRows = await prisma.$queryRaw`
    SELECT
      ur.id,
      ur.public_id,
      ur.station_id,
      ur.status,
      ur.slot_start,
      ur.deposit_amount,
      ur.metadata
    FROM user_reservations ur
    WHERE ur.public_id = ${scopedReservationPublicId}
      AND ur.user_id = ${authUserId}
    LIMIT 1
  `
  const reservation = reservationRows?.[0]
  if (!reservation?.id) throw badRequest("Reservation not found")

  const status = String(reservation.status || "").toUpperCase()
  if (["CANCELLED", "EXPIRED", "FULFILLED"].includes(status)) {
    return {
      httpStatus: 200,
      cancelled: false,
      reservationId: scopedReservationPublicId,
      status,
      message: "Reservation is already closed.",
    }
  }

  const slotStart = reservation.slot_start ? new Date(reservation.slot_start) : null
  const minutesToSlot = slotStart
    ? Math.floor((slotStart.getTime() - Date.now()) / 60000)
    : Number.POSITIVE_INFINITY
  const refundPct = minutesToSlot >= 30 ? 100 : minutesToSlot > 0 ? 50 : 0
  const depositAmount = Number(reservation.deposit_amount || 0)
  const refundAmount = Number(((depositAmount * refundPct) / 100).toFixed(2))
  const forfeitedAmount = Number((depositAmount - refundAmount).toFixed(2))

  const metadata = parseReservationMetadata(reservation.metadata)
  metadata.cancellation = {
    reason: parsedBody.reason || null,
    cancelledAt: new Date().toISOString(),
    refundPct,
    refundAmount,
    forfeitedAmount,
    source,
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE user_reservations
      SET
        status = 'CANCELLED',
        cancelled_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3),
        metadata = ${JSON.stringify(metadata)}
      WHERE id = ${reservation.id}
    `

    await releaseReservationWalletHold(
      {
        reservationPublicId: scopedReservationPublicId,
        actorUserId: authUserId,
        reason: "RESERVATION_CANCELLED",
      },
      { tx }
    )
  })

  await writeAuditLog({
    stationId: reservation.station_id,
    actionType: "RESERVATION_USER_CANCEL",
    payload: {
      reservationPublicId: scopedReservationPublicId,
      userPublicId: auth?.userPublicId || null,
      reason: parsedBody.reason || null,
      refundPct,
      refundAmount,
      source,
    },
  })

  return {
    httpStatus: 200,
    cancelled: true,
    reservationId: scopedReservationPublicId,
    refundPct,
    refundAmount,
    forfeitedAmount,
  }
}

export async function executeLeaveQueueAction({
  queueJoinId,
  auth,
  body,
  source = "user_app",
} = {}) {
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  if (!scopedQueueJoinId) throw badRequest("queueJoinId is required")

  const parsedBody = leaveBodySchema.parse(body || {})
  const currentStatus = await buildUserQueueStatusSnapshot({
    queueJoinId: scopedQueueJoinId,
    auth,
  })

  const queueStatus = String(currentStatus.queueStatus || "").toUpperCase()
  if (!ACTIVE_QUEUE_STATUSES.includes(queueStatus)) {
    return {
      httpStatus: 200,
      left: false,
      queueJoinId: scopedQueueJoinId,
      status: currentStatus,
      message: "Queue entry is already closed",
    }
  }

  const entryRows = await prisma.$queryRaw`
    SELECT id, station_id
    FROM queue_entries
    WHERE public_id = ${scopedQueueJoinId}
    LIMIT 1
  `
  const entry = entryRows?.[0]
  if (!entry?.id) throw badRequest("Queue entry not found")

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE queue_entries
      SET
        status = 'CANCELLED',
        cancelled_at = CURRENT_TIMESTAMP(3),
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${entry.id}
    `

    await releaseQueuePrepayWalletHold(
      {
        queueJoinId: scopedQueueJoinId,
        actorUserId: Number(auth?.userId || 0) || null,
        reason: "QUEUE_CANCELLED",
      },
      { tx }
    )
  })

  await normalizeQueuePositions(entry.station_id)

  await writeAuditLog({
    stationId: entry.station_id,
    actionType: "QUEUE_USER_LEAVE",
    payload: {
      queueJoinId: scopedQueueJoinId,
      reason: parsedBody.reason || null,
      userPublicId: auth?.userPublicId || null,
      source,
    },
  })

  const status = await buildUserQueueStatusSnapshot({
    queueJoinId: scopedQueueJoinId,
    auth,
  })

  return {
    httpStatus: 200,
    left: true,
    queueJoinId: scopedQueueJoinId,
    status,
  }
}

router.post(
  "/user/stations/:stationPublicId/queue/join",
  asyncHandler(async (req, res) => {
    const stationPublicId = String(req.params.stationPublicId || "").trim()
    ensureStationScope(req, stationPublicId)
    const result = await executeQueueJoinAction({
      stationPublicId,
      auth: req.auth,
      body: req.body,
      source: "user_app",
    })
    const { httpStatus = 200, ...payload } = result
    return ok(res, payload, httpStatus)
  })
)

router.get(
  "/user/history",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }
    const query = historyQuerySchema.parse(req.query || {})
    if (query.from && query.to && query.to < query.from) {
      throw badRequest("End date cannot be earlier than start date.")
    }

    const fromDateTime = query.from ? toUtcQueryDateBoundary(query.from, "00:00:00") : null
    const toDateTime = query.to ? toUtcQueryDateBoundary(query.to, "23:59:59") : null

    await ensureReservationsTableReady()
    await expireOverdueReservations({ userId: authUserId })

    const [reservationRows, queueRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          ur.public_id AS reservation_public_id,
          ur.status AS reservation_status,
          ur.requested_litres,
          ur.deposit_amount,
          ur.identifier,
          ur.slot_start,
          ur.slot_end,
          ur.expires_at,
          DATE_FORMAT(ur.slot_start, '%Y-%m-%d %H:%i:%s') AS slot_start_local,
          DATE_FORMAT(ur.slot_end, '%Y-%m-%d %H:%i:%s') AS slot_end_local,
          DATE_FORMAT(ur.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at_local,
          DATE_FORMAT(ur.slot_start, '%b %e, %Y') AS slot_date_label_local,
          CASE
            WHEN ur.slot_start IS NULL THEN NULL
            ELSE CONCAT(
              DATE_FORMAT(ur.slot_start, '%h:%i %p'),
              ' - ',
              DATE_FORMAT(COALESCE(ur.slot_end, DATE_ADD(ur.slot_start, INTERVAL 30 MINUTE)), '%h:%i %p')
            )
          END AS slot_label_local,
          DATE_FORMAT(ur.expires_at, '%h:%i %p') AS expires_time_label_local,
          ur.check_in_time,
          ur.created_at,
          ur.confirmed_at,
          ur.fulfilled_at,
          ur.cancelled_at,
          ur.metadata,
          ft.code AS fuel_type,
          st.public_id AS station_public_id,
          st.name AS station_name,
          COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
          qe.public_id AS queue_join_public_id,
          tx.public_id AS transaction_public_id,
          tx.receipt_verification_ref,
          tx.payment_reference,
          tx.litres,
          tx.price_per_litre,
          tx.base_price_per_litre,
          tx.effective_price_per_litre,
          tx.subtotal,
          tx.total_direct_discount,
          tx.cashback_total,
          tx.promo_labels_applied,
          tx.total_amount,
          tx.final_amount_paid,
          (
            SELECT lt.net_amount
            FROM ledger_transactions lt
            WHERE lt.transaction_status = 'POSTED'
              AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
              AND (
                (tx.public_id IS NOT NULL AND lt.external_reference = tx.public_id)
                OR (ur.public_id IS NOT NULL AND lt.related_entity_type = 'RESERVATION' AND lt.related_entity_id = ur.public_id)
                OR (qe.public_id IS NOT NULL AND lt.related_entity_type = 'QUEUE' AND lt.related_entity_id = qe.public_id)
                OR (tx.payment_reference IS NOT NULL AND tx.payment_reference <> '' AND lt.transaction_reference = tx.payment_reference)
              )
            ORDER BY lt.id DESC
            LIMIT 1
          ) AS wallet_total_amount
        FROM user_reservations ur
        INNER JOIN stations st ON st.id = ur.station_id
        INNER JOIN fuel_types ft ON ft.id = ur.fuel_type_id
        LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
        LEFT JOIN transactions tx
          ON tx.id = (
            SELECT tx_match.id
            FROM transactions tx_match
            WHERE tx_match.reservation_public_id = ur.public_id
            ORDER BY COALESCE(
              tx_match.occurred_at,
              tx_match.dispensed_at,
              tx_match.settled_at,
              tx_match.authorized_at,
              tx_match.created_at
            ) DESC, tx_match.id DESC
            LIMIT 1
          )
        WHERE ur.user_id = ${authUserId}
          AND (${fromDateTime} IS NULL OR COALESCE(ur.slot_start, ur.created_at) >= ${fromDateTime})
          AND (${toDateTime} IS NULL OR COALESCE(ur.slot_start, ur.created_at) <= ${toDateTime})
        ORDER BY ur.created_at DESC, ur.id DESC
        LIMIT 500
      `,
      prisma.$queryRaw`
        SELECT
          qe.public_id AS queue_join_public_id,
          qe.status AS queue_status,
          qe.masked_plate,
          qe.joined_at,
          qe.called_at,
          qe.served_at,
          qe.cancelled_at,
          qe.last_moved_at,
          qe.metadata,
          ft.code AS fuel_type,
          st.public_id AS station_public_id,
          st.name AS station_name,
          COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
          tx.public_id AS transaction_public_id,
          tx.receipt_verification_ref,
          tx.payment_reference,
          tx.litres,
          tx.price_per_litre,
          tx.base_price_per_litre,
          tx.effective_price_per_litre,
          tx.subtotal,
          tx.total_direct_discount,
          tx.cashback_total,
          tx.promo_labels_applied,
          tx.total_amount,
          tx.final_amount_paid,
          (
            SELECT lt.net_amount
            FROM ledger_transactions lt
            WHERE lt.transaction_status = 'POSTED'
              AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
              AND (
                (tx.public_id IS NOT NULL AND lt.external_reference = tx.public_id)
                OR (qe.public_id IS NOT NULL AND lt.related_entity_type = 'QUEUE' AND lt.related_entity_id = qe.public_id)
                OR (tx.payment_reference IS NOT NULL AND tx.payment_reference <> '' AND lt.transaction_reference = tx.payment_reference)
              )
            ORDER BY lt.id DESC
            LIMIT 1
          ) AS wallet_total_amount
        FROM queue_entries qe
        INNER JOIN stations st ON st.id = qe.station_id
        INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
        LEFT JOIN transactions tx
          ON tx.id = (
            SELECT tx_match.id
            FROM transactions tx_match
            WHERE tx_match.queue_entry_id = qe.id
            ORDER BY COALESCE(
              tx_match.occurred_at,
              tx_match.dispensed_at,
              tx_match.settled_at,
              tx_match.authorized_at,
              tx_match.created_at
            ) DESC, tx_match.id DESC
            LIMIT 1
          )
        WHERE qe.user_id = ${authUserId}
          AND (${fromDateTime} IS NULL OR qe.joined_at >= ${fromDateTime})
          AND (${toDateTime} IS NULL OR qe.joined_at <= ${toDateTime})
        ORDER BY qe.joined_at DESC, qe.id DESC
        LIMIT 500
      `,
    ])

    return ok(res, {
      reservations: (reservationRows || []).map(userReservationResponseFromRow),
      queues: (queueRows || []).map(userQueueHistoryResponseFromRow),
    })
  })
)

router.get(
  "/user/receipts/:receiptType/:reference/download",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const receiptType = String(req.params.receiptType || "").trim().toLowerCase()
    const reference = String(req.params.reference || "").trim()
    if (!reference) {
      throw badRequest("Receipt reference is required.")
    }

    let receipt = null

    if (receiptType === "queue") {
      const linkedTransactionReceipt = await getUserTransactionReceiptPayloadByLink({
        userId: authUserId,
        receiptType,
        reference,
      })
      if (linkedTransactionReceipt) {
        receipt = linkedTransactionReceipt
      } else {
      const queueRows = await prisma.$queryRaw`
        SELECT
          qe.public_id AS queue_join_public_id,
          qe.status AS queue_status,
          qe.masked_plate,
          qe.joined_at,
          qe.called_at,
          qe.served_at,
          qe.cancelled_at,
          qe.last_moved_at,
          qe.metadata,
          ft.code AS fuel_type,
          st.public_id AS station_public_id,
          st.name AS station_name,
          COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
          tx.public_id AS transaction_public_id,
          tx.receipt_verification_ref,
          tx.payment_reference,
          tx.litres,
          tx.price_per_litre,
          tx.base_price_per_litre,
          tx.effective_price_per_litre,
          tx.subtotal,
          tx.total_direct_discount,
          tx.cashback_total,
          tx.promo_labels_applied,
          tx.total_amount,
          tx.final_amount_paid,
          (
            SELECT lt.net_amount
            FROM ledger_transactions lt
            WHERE lt.transaction_status = 'POSTED'
              AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
              AND (
                (tx.public_id IS NOT NULL AND lt.external_reference = tx.public_id)
                OR (qe.public_id IS NOT NULL AND lt.related_entity_type = 'QUEUE' AND lt.related_entity_id = qe.public_id)
                OR (tx.payment_reference IS NOT NULL AND tx.payment_reference <> '' AND lt.transaction_reference = tx.payment_reference)
              )
            ORDER BY lt.id DESC
            LIMIT 1
          ) AS wallet_total_amount
        FROM queue_entries qe
        INNER JOIN stations st ON st.id = qe.station_id
        INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
        LEFT JOIN transactions tx
          ON tx.id = (
            SELECT tx_match.id
            FROM transactions tx_match
            WHERE tx_match.queue_entry_id = qe.id
            ORDER BY COALESCE(
              tx_match.occurred_at,
              tx_match.dispensed_at,
              tx_match.settled_at,
              tx_match.authorized_at,
              tx_match.created_at
            ) DESC, tx_match.id DESC
            LIMIT 1
          )
        WHERE qe.user_id = ${authUserId}
          AND qe.public_id = ${reference}
        LIMIT 1
      `
      const row = queueRows?.[0]
      if (!row?.queue_join_public_id) {
        throw badRequest("Queue receipt not found.")
      }
      receipt = buildQueueReceiptPayload(row)
      }
    } else if (receiptType === "reservation") {
      const linkedTransactionReceipt = await getUserTransactionReceiptPayloadByLink({
        userId: authUserId,
        receiptType,
        reference,
      })
      if (linkedTransactionReceipt) {
        receipt = linkedTransactionReceipt
      } else {
      await ensureReservationsTableReady()

      const reservationRows = await prisma.$queryRaw`
        SELECT
          ur.public_id AS reservation_public_id,
          ur.status AS reservation_status,
          ur.requested_litres,
          ur.deposit_amount,
          ur.identifier,
          ur.slot_start,
          ur.slot_end,
          ur.expires_at,
          DATE_FORMAT(ur.slot_start, '%Y-%m-%d %H:%i:%s') AS slot_start_local,
          DATE_FORMAT(ur.slot_end, '%Y-%m-%d %H:%i:%s') AS slot_end_local,
          DATE_FORMAT(ur.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at_local,
          DATE_FORMAT(ur.slot_start, '%b %e, %Y') AS slot_date_label_local,
          CASE
            WHEN ur.slot_start IS NULL THEN NULL
            ELSE CONCAT(
              DATE_FORMAT(ur.slot_start, '%h:%i %p'),
              ' - ',
              DATE_FORMAT(COALESCE(ur.slot_end, DATE_ADD(ur.slot_start, INTERVAL 30 MINUTE)), '%h:%i %p')
            )
          END AS slot_label_local,
          DATE_FORMAT(ur.expires_at, '%h:%i %p') AS expires_time_label_local,
          ur.check_in_time,
          ur.created_at,
          ur.confirmed_at,
          ur.fulfilled_at,
          ur.cancelled_at,
          ur.metadata,
          ft.code AS fuel_type,
          st.public_id AS station_public_id,
          st.name AS station_name,
          COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
          qe.public_id AS queue_join_public_id,
          tx.public_id AS transaction_public_id,
          tx.receipt_verification_ref,
          tx.payment_reference,
          tx.litres,
          tx.price_per_litre,
          tx.base_price_per_litre,
          tx.effective_price_per_litre,
          tx.subtotal,
          tx.total_direct_discount,
          tx.cashback_total,
          tx.promo_labels_applied,
          tx.total_amount,
          tx.final_amount_paid,
          (
            SELECT lt.net_amount
            FROM ledger_transactions lt
            WHERE lt.transaction_status = 'POSTED'
              AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
              AND (
                (tx.public_id IS NOT NULL AND lt.external_reference = tx.public_id)
                OR (ur.public_id IS NOT NULL AND lt.related_entity_type = 'RESERVATION' AND lt.related_entity_id = ur.public_id)
                OR (qe.public_id IS NOT NULL AND lt.related_entity_type = 'QUEUE' AND lt.related_entity_id = qe.public_id)
                OR (tx.payment_reference IS NOT NULL AND tx.payment_reference <> '' AND lt.transaction_reference = tx.payment_reference)
              )
            ORDER BY lt.id DESC
            LIMIT 1
          ) AS wallet_total_amount
        FROM user_reservations ur
        INNER JOIN stations st ON st.id = ur.station_id
        INNER JOIN fuel_types ft ON ft.id = ur.fuel_type_id
        LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
        LEFT JOIN transactions tx
          ON tx.id = (
            SELECT tx_match.id
            FROM transactions tx_match
            WHERE tx_match.reservation_public_id = ur.public_id
            ORDER BY COALESCE(
              tx_match.occurred_at,
              tx_match.dispensed_at,
              tx_match.settled_at,
              tx_match.authorized_at,
              tx_match.created_at
            ) DESC, tx_match.id DESC
            LIMIT 1
          )
        WHERE ur.user_id = ${authUserId}
          AND ur.public_id = ${reference}
        LIMIT 1
      `
      const row = reservationRows?.[0]
      if (!row?.reservation_public_id) {
        throw badRequest("Reservation receipt not found.")
      }
      receipt = buildReservationReceiptPayload(row)
      }
    } else {
      throw badRequest("receiptType must be either queue or reservation.")
    }

    const fileName = `smartpay_${safeFilenamePart(receipt.reference || reference)}_receipt.pdf`
    res.status(200)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", contentDispositionAttachment(fileName))
    res.setHeader("Cache-Control", "no-store")

    await streamSmartPayReceiptPdf({
      res,
      receipt,
    })
  })
)

router.get(
  "/user/reservations",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }
    await ensureReservationsTableReady()
    const reservationRows = await prisma.$queryRaw`
      SELECT
        ur.public_id AS reservation_public_id,
        ur.status AS reservation_status,
        ur.requested_litres,
        ur.deposit_amount,
        ur.identifier,
        ur.slot_start,
        ur.slot_end,
        ur.expires_at,
        DATE_FORMAT(ur.slot_start, '%Y-%m-%d %H:%i:%s') AS slot_start_local,
        DATE_FORMAT(ur.slot_end, '%Y-%m-%d %H:%i:%s') AS slot_end_local,
        DATE_FORMAT(ur.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at_local,
        DATE_FORMAT(ur.slot_start, '%b %e, %Y') AS slot_date_label_local,
        CASE
          WHEN ur.slot_start IS NULL THEN NULL
          ELSE CONCAT(
            DATE_FORMAT(ur.slot_start, '%h:%i %p'),
            ' - ',
            DATE_FORMAT(COALESCE(ur.slot_end, DATE_ADD(ur.slot_start, INTERVAL 30 MINUTE)), '%h:%i %p')
          )
        END AS slot_label_local,
        DATE_FORMAT(ur.expires_at, '%h:%i %p') AS expires_time_label_local,
        ur.check_in_time,
        ur.created_at,
        ur.confirmed_at,
        ur.fulfilled_at,
        ur.cancelled_at,
        ur.metadata,
        ft.code AS fuel_type,
        st.public_id AS station_public_id,
        st.name AS station_name,
        COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
        qe.public_id AS queue_join_public_id
      FROM user_reservations ur
      INNER JOIN stations st ON st.id = ur.station_id
      INNER JOIN fuel_types ft ON ft.id = ur.fuel_type_id
      LEFT JOIN queue_entries qe ON qe.id = ur.source_queue_entry_id
      WHERE ur.user_id = ${authUserId}
        AND ur.status IN ('PENDING', 'CONFIRMED')
      ORDER BY ur.created_at DESC, ur.id DESC
      LIMIT 200
    `

    return ok(res, (reservationRows || []).map(userReservationResponseFromRow))
  })
)

router.get(
  "/user/alerts",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    try {
      await ensureUserAlertsTableReady()
    } catch (error) {
      if (isUserAlertsTableMissingError(error) || String(error?.message || "").includes("migration")) {
        throw badRequest("User alerts storage is unavailable. Run SQL migration 018_create_user_alerts.sql.")
      }
      throw error
    }

    const rawLimit = Number(req.query?.limit || 100)
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 100
    const alerts = await listUserAlertsByUserId(authUserId, { limit })
    const unreadCount = alerts.reduce((sum, item) => sum + (item.isRead ? 0 : 1), 0)

    return ok(res, {
      items: alerts,
      unreadCount,
      total: alerts.length,
    })
  })
)

router.get(
  "/user/alerts/archived",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    try {
      await ensureUserAlertsTableReady()
      await ensureUserAlertArchivesTableReady()
    } catch (error) {
      if (
        isUserAlertsTableMissingError(error)
        || isUserAlertArchivesTableMissingError(error)
        || String(error?.message || "").includes("migration")
      ) {
        throw badRequest(
          "User alert archive storage is unavailable. Run SQL migrations 018_create_user_alerts.sql and 033_archive_user_alerts.sql."
        )
      }
      throw error
    }

    const rawLimit = Number(req.query?.limit || 100)
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100
    const alerts = await listUserAlertArchivesByUserId(authUserId, { limit })

    return ok(res, {
      items: alerts,
      total: alerts.length,
    })
  })
)

router.get(
  "/user/push/public-key",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const config = getPushPublicKeyConfig()
    return ok(res, {
      enabled: Boolean(config.enabled),
      publicKey: config.publicKey,
    })
  })
)

router.post(
  "/user/push/subscribe",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const payload = pushSubscribeBodySchema.parse(req.body || {})
    try {
      await ensureUserPushSubscriptionsTableReady()
    } catch (error) {
      if (isUserPushSubscriptionsTableMissingError(error) || String(error?.message || "").includes("migration")) {
        throw badRequest(
          "Push subscription storage is unavailable. Run SQL migration 019_create_user_push_subscriptions.sql."
        )
      }
      throw error
    }

    const subscription = payload.subscription || {}
    const endpoint = String(subscription.endpoint || "").trim()
    const p256dh = String(subscription?.keys?.p256dh || "").trim()
    const auth = String(subscription?.keys?.auth || "").trim()

    await upsertUserPushSubscription({
      userId: authUserId,
      endpoint,
      p256dh,
      auth,
      userAgent: req.get("user-agent") || null,
      metadata: {
        expirationTime:
          subscription.expirationTime !== undefined ? subscription.expirationTime : null,
      },
    })

    return ok(res, {
      subscribed: true,
      endpoint,
    })
  })
)

router.post(
  "/user/push/unsubscribe",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const body = pushUnsubscribeBodySchema.parse(req.body || {})
    try {
      await ensureUserPushSubscriptionsTableReady()
    } catch (error) {
      if (isUserPushSubscriptionsTableMissingError(error) || String(error?.message || "").includes("migration")) {
        throw badRequest(
          "Push subscription storage is unavailable. Run SQL migration 019_create_user_push_subscriptions.sql."
        )
      }
      throw error
    }

    const endpoint = String(body.endpoint || "").trim()
    if (endpoint) {
      await deactivatePushSubscriptionForUser({
        userId: authUserId,
        endpoint,
      })
    } else {
      await deactivatePushSubscriptionsByUserId(authUserId)
    }

    return ok(res, {
      unsubscribed: true,
      endpoint: endpoint || null,
    })
  })
)

router.post(
  "/user/alerts/:alertPublicId/read",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const alertPublicId = String(req.params.alertPublicId || "").trim()
    if (!alertPublicId) {
      throw badRequest("alertPublicId is required")
    }

    try {
      await ensureUserAlertsTableReady()
    } catch (error) {
      if (isUserAlertsTableMissingError(error) || String(error?.message || "").includes("migration")) {
        throw badRequest("User alerts storage is unavailable. Run SQL migration 018_create_user_alerts.sql.")
      }
      throw error
    }

    const alert = await markUserAlertRead({
      userId: authUserId,
      alertPublicId,
    })
    if (!alert?.publicId) {
      throw badRequest("Alert not found.")
    }

    publishUserAlert({
      userId: authUserId,
      eventType: "user_alert:read",
      data: {
        publicId: alert.publicId,
        readAt: alert.readAt,
      },
    })

    return ok(res, {
      alert,
    })
  })
)

router.post(
  "/user/alerts/:alertPublicId/archive",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const alertPublicId = String(req.params.alertPublicId || "").trim()
    if (!alertPublicId) {
      throw badRequest("alertPublicId is required")
    }

    try {
      await ensureUserAlertsTableReady()
      await ensureUserAlertArchivesTableReady()
    } catch (error) {
      if (
        isUserAlertsTableMissingError(error)
        || isUserAlertArchivesTableMissingError(error)
        || String(error?.message || "").includes("migration")
      ) {
        throw badRequest(
          "User alert archive storage is unavailable. Run SQL migrations 018_create_user_alerts.sql and 033_archive_user_alerts.sql."
        )
      }
      throw error
    }

    const alert = await archiveUserAlert({
      userId: authUserId,
      alertPublicId,
      reason: "USER_ACTION",
    })
    if (!alert?.publicId) {
      throw badRequest("Alert not found.")
    }

    publishUserAlert({
      userId: authUserId,
      eventType: "user_alert:archived",
      data: {
        publicId: alert.publicId,
        archivedAt: alert.archivedAt,
      },
    })

    return ok(res, {
      alert,
    })
  })
)

router.get(
  "/user/wallet/me",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const wallet = await getUserWalletSummary(authUserId)

    return ok(res, {
      wallet,
    })
  })
)

router.get(
  "/user/wallet/me/transactions",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const query = walletTransactionsQuerySchema.parse(req.query || {})
    const transactions = await getUserWalletTransactions(authUserId, {
      page: query.page,
      limit: query.limit,
      transactionType: query.type || null,
      transactionStatus: query.status || null,
    })

    return ok(res, transactions)
  })
)

router.get(
  "/user/wallet/me/holds",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const query = walletHoldsQuerySchema.parse(req.query || {})
    const holds = await getUserWalletHolds(authUserId, {
      status: query.status,
      limit: query.limit,
    })

    return ok(res, holds)
  })
)

router.get(
  "/user/wallet/me/transfers/recipient-qr",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const qr = await getWalletTransferRecipientQr(authUserId)
    return ok(res, qr)
  })
)

router.post(
  "/user/wallet/me/transfers/preview",
  walletTransferPreviewLimiter,
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const body = walletTransferPreviewBodySchema.parse(req.body || {})
    const preview = await previewWalletUserTransfer({
      senderUserId: authUserId,
      recipientUserId: body.recipientUserId || null,
      recipientQrPayload: body.recipientQrPayload || null,
      amountMwk: body.amountMwk,
      transferMode: body.transferMode,
      stationPublicId: body.stationPublicId || null,
      stationId: body.stationId ?? null,
    })

    return ok(res, preview)
  })
)

router.post(
  "/user/wallet/me/transfers",
  walletTransferCreateLimiter,
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const body = walletTransferCreateBodySchema.parse(req.body || {})
    const result = await createWalletUserTransfer({
      senderUserId: authUserId,
      recipientUserId: body.recipientUserId || null,
      recipientQrPayload: body.recipientQrPayload || null,
      amountMwk: body.amountMwk,
      transferMode: body.transferMode,
      stationPublicId: body.stationPublicId || null,
      stationId: body.stationId ?? null,
      note: body.note || "",
      idempotencyKey: body.idempotencyKey || null,
    })

    if (result?.created) {
      const recipientUserId = Number(result?.transfer?.receiver?.userId || 0)
      const senderName =
        String(result?.transfer?.sender?.fullName || req.auth?.fullName || "SmartLink user").trim()
        || "SmartLink user"
      const senderPublicId =
        String(result?.transfer?.sender?.publicId || req.auth?.userPublicId || "").trim() || null
      const transferAmountLabel = formatWalletTransferAmountLabel(
        result?.transfer?.amountMwk,
        result?.transfer?.currencyCode
      )
      const stationName = String(result?.transfer?.station?.name || "").trim() || null
      const transferMode = String(result?.transfer?.transferMode || "").trim().toUpperCase()
      const transferSummary =
        transferMode === "STATION_LOCKED" && stationName
          ? `${transferAmountLabel} locked to ${stationName}`
          : transferAmountLabel

      if (Number.isFinite(recipientUserId) && recipientUserId > 0 && recipientUserId !== authUserId) {
        try {
          await ensureUserAlertsTableReady()
          const alert = await createUserAlert({
            userId: recipientUserId,
            category: "WALLET",
            title: "Funds received",
            body: `You received ${transferSummary} from ${senderName}${senderPublicId ? ` (${senderPublicId})` : ""}.`,
            metadata: {
              transferPublicId: result?.transfer?.publicId || null,
              transferMode,
              senderName,
              senderUserPublicId: senderPublicId,
              amountMwk: Number(result?.transfer?.amountMwk || 0) || 0,
              currencyCode: String(result?.transfer?.currencyCode || "MWK").trim() || "MWK",
              stationPublicId: result?.transfer?.station?.publicId || null,
              stationName,
              path: "/m/wallet",
            },
          })

          publishUserAlert({
            userId: recipientUserId,
            eventType: "user_alert:new",
            data: alert,
          })

          await sendPushAlertToUser({
            userId: recipientUserId,
            notification: {
              title: alert.title,
              body: alert.message,
              tag: alert.publicId || result?.transfer?.publicId || `wallet-transfer-${Date.now()}`,
              url: "/m/wallet",
              icon: "/smartlogo.png",
              badge: "/smartlogo.png",
            },
            data: {
              alertPublicId: alert.publicId || null,
              transferPublicId: result?.transfer?.publicId || null,
              senderUserPublicId: senderPublicId,
            },
          }).catch(() => {})
        } catch {
          // Keep transfer success independent from alert delivery.
        }
      }
    }

    return ok(res, result, result.created ? 201 : 200)
  })
)

router.get(
  "/user/wallet/me/transfers/history",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const query = walletTransferHistoryQuerySchema.parse(req.query || {})
    const history = await getUserWalletTransferHistory(authUserId, {
      page: query.page,
      limit: query.limit,
    })

    return ok(res, history)
  })
)

router.get(
  "/user/wallet/me/station-locked-balances",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const balances = await getUserWalletStationLockedBalances(authUserId)
    return ok(res, balances)
  })
)

router.post(
  "/user/wallet/me/topups",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    const body = walletTopupBodySchema.parse(req.body || {})
    const result = await createPrototypeWalletTopup(authUserId, {
      amount: body.amount,
      note: body.note || "",
      actorUserId: authUserId,
    })

    return ok(
      res,
      {
        wallet: result.wallet,
        transaction: result.transaction,
      },
      201
    )
  })
)

router.get(
  "/user/wallet/me/refunds",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureRefundRequestsTableReady()
    const rows = await prisma.$queryRaw`
      SELECT
        rr.public_id,
        rr.transaction_public_id,
        rr.wallet_transaction_reference,
        rr.amount_mwk,
        rr.priority,
        rr.status,
        rr.reason,
        rr.resolution_notes,
        rr.created_at,
        rr.reviewed_at,
        rr.credited_at,
        support_case.public_id AS support_case_public_id
      FROM refund_requests rr
      LEFT JOIN internal_support_cases support_case ON support_case.id = rr.support_case_id
      WHERE rr.user_id = ${authUserId}
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT 50
    `

    return ok(res, {
      items: (rows || []).map((row) => ({
        publicId: row.public_id,
        transactionPublicId: row.transaction_public_id || null,
        walletTransactionReference: row.wallet_transaction_reference || null,
        supportCasePublicId: row.support_case_public_id || null,
        amountMwk: Number(row.amount_mwk || 0),
        priority: row.priority,
        status: row.status,
        reason: row.reason,
        resolutionNotes: row.resolution_notes || null,
        createdAt: toIsoOrNull(row.created_at),
        reviewedAt: toIsoOrNull(row.reviewed_at),
        creditedAt: toIsoOrNull(row.credited_at),
      })),
    })
  })
)

router.post(
  "/user/wallet/me/refunds",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureWalletStorageReadyOrThrow()
    await ensureRefundRequestsTableReady()
    const body = walletRefundCreateBodySchema.parse(req.body || {})
    const sourceTransaction = await resolveRefundableWalletTransactionForUser({
      userId: authUserId,
      transactionPublicId: body.transactionPublicId,
    })

    if (!sourceTransaction?.walletTransactionReference) {
      throw badRequest("Only wallet-backed reservation transactions can be refunded to the wallet.")
    }
    if (!sourceTransaction?.occurredAt || isRefundRequestWindowExpired(sourceTransaction.occurredAt)) {
      throw badRequest(
        `Refund requests must be submitted within ${REFUND_REQUEST_WINDOW_HOURS} hours of the transaction.`
      )
    }

    const existingRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(amount_mwk), 0.00) AS requested_amount
      FROM refund_requests
      WHERE user_id = ${authUserId}
        AND transaction_public_id = ${sourceTransaction.transactionPublicId}
        AND status IN ('PENDING_SUPPORT_REVIEW', 'PENDING_FINANCE_APPROVAL', 'APPROVED', 'PAID')
    `
    const alreadyRequestedAmount = Number(existingRows?.[0]?.requested_amount || 0)
    const sourceAmount = Number(sourceTransaction.sourceAmount || 0)
    const remainingAmount = Number((sourceAmount - alreadyRequestedAmount).toFixed(2))
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      throw badRequest("This transaction already has a full refund request in progress or completed.")
    }

    const requestedAmount = body.amount ? Number(Number(body.amount).toFixed(2)) : remainingAmount
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw badRequest("Refund amount must be greater than zero.")
    }
    if (requestedAmount > remainingAmount) {
      throw badRequest(`Refund amount exceeds the remaining refundable balance of MWK ${remainingAmount.toLocaleString()}.`)
    }

    const refundPublicId = createPublicId()
    const priority = mapRefundPriorityByAmount(requestedAmount)
    const initialStatus = initialUserRefundStatus()
    const supportCasePublicId = await createSupportCasePublicId({ typeCode: "PAY" })
    const supportAgentUserId = await resolveInternalSupportAgentUserId()
    let supportCaseId = null

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO internal_support_cases (
          public_id,
          source_ticket_id,
          station_id,
          user_id,
          category,
          priority,
          status,
          assigned_user_id,
          subject,
          summary
        )
        VALUES (
          ${supportCasePublicId},
          NULL,
          ${sourceTransaction.stationId},
          ${authUserId},
          ${"PAYMENT_FAILURE"},
          ${priority},
          'OPEN',
          ${supportAgentUserId},
          ${buildWalletRefundSupportCaseSubject(sourceTransaction.transactionPublicId)},
          ${buildWalletRefundSupportCaseSummary({
            transactionPublicId: sourceTransaction.transactionPublicId,
            walletTransactionReference: sourceTransaction.walletTransactionReference,
            amountMwk: requestedAmount,
            reason: body.reason,
          })}
        )
      `

      const supportCaseRows = await tx.$queryRaw`
        SELECT id
        FROM internal_support_cases
        WHERE public_id = ${supportCasePublicId}
        LIMIT 1
      `
      supportCaseId = Number(supportCaseRows?.[0]?.id || 0) || null
      if (!supportCaseId) {
        throw badRequest("Unable to create the linked refund support case.")
      }

      await tx.$executeRaw`
        INSERT INTO refund_requests (
          public_id,
          station_id,
          user_id,
          support_case_id,
          transaction_public_id,
          amount_mwk,
          priority,
          status,
          requested_by_user_id,
          reviewed_by_user_id,
          reason,
          resolution_notes,
          reviewed_at,
          wallet_transaction_reference,
          credited_at
        )
        VALUES (
          ${refundPublicId},
          ${sourceTransaction.stationId},
          ${authUserId},
          ${supportCaseId},
          ${sourceTransaction.transactionPublicId},
          ${requestedAmount},
          ${priority},
          ${initialStatus},
          ${authUserId},
          NULL,
          ${body.reason},
          ${"Submitted by user for support review."},
          NULL,
          NULL,
          NULL
        )
      `
    })

    if (Number.isFinite(Number(sourceTransaction.stationId || 0)) && Number(sourceTransaction.stationId || 0) > 0) {
      await writeAuditLog({
        stationId: Number(sourceTransaction.stationId),
        actionType: "REFUND_REQUEST_CREATE",
        payload: {
          refundPublicId,
          supportCasePublicId,
          transactionPublicId: sourceTransaction.transactionPublicId,
          walletTransactionReference: sourceTransaction.walletTransactionReference,
          amountMwk: requestedAmount,
          reason: body.reason,
          userPublicId: req.auth?.userPublicId || null,
        },
      })
    }

    return ok(
      res,
      {
        refundPublicId,
        supportCasePublicId,
        transactionPublicId: sourceTransaction.transactionPublicId,
        amountMwk: requestedAmount,
        priority,
        status: initialStatus,
      },
      201
    )
  })
)

router.get(
  "/user/stations/:stationPublicId/reservations/slots",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.set("Pragma", "no-cache")
    res.set("Expires", "0")
    const stationPublicId = String(req.params.stationPublicId || "").trim()
    ensureStationScope(req, stationPublicId)
    const payload = await listReservationSlotsForUser({
      stationPublicId,
      auth: req.auth,
      query: req.query,
    })
    return ok(res, payload)
  })
)

router.post(
  "/user/stations/:stationPublicId/reservations",
  asyncHandler(async (req, res) => {
    const stationPublicId = String(req.params.stationPublicId || "").trim()
    ensureStationScope(req, stationPublicId)
    const result = await executeCreateReservationAction({
      stationPublicId,
      auth: req.auth,
      body: req.body,
      source: "user_app",
    })
    const { httpStatus = 200, ...payload } = result
    return ok(res, payload, httpStatus)
  })
)

router.post(
  "/user/reservations/:reservationPublicId/cancel",
  asyncHandler(async (req, res) => {
    const reservationPublicId = String(req.params.reservationPublicId || "").trim()
    const result = await executeCancelReservationAction({
      reservationPublicId,
      auth: req.auth,
      body: req.body,
      source: "user_app",
    })
    const { httpStatus = 200, ...payload } = result
    return ok(res, payload, httpStatus)
  })
)

router.post(
  "/user/reservations/:reservationPublicId/check-in",
  asyncHandler(async (req, res) => {
    const reservationPublicId = String(req.params.reservationPublicId || "").trim()
    if (!reservationPublicId) throw badRequest("reservationPublicId is required")

    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    await ensureReservationsTableReady()
    const body = checkInReservationBodySchema.parse(req.body || {})
    await expireOverdueReservations({ userId: authUserId })

    let rows = []
    try {
      rows = await prisma.$queryRaw`
        SELECT
          ur.id,
          ur.public_id,
          ur.station_id,
          ur.status,
          ur.slot_start,
          ur.slot_end,
          CASE
            WHEN ur.slot_start IS NOT NULL AND CURRENT_TIMESTAMP(3) < ur.slot_start THEN 1
            ELSE 0
          END AS before_slot_start,
          CASE
            WHEN ur.slot_end IS NOT NULL
              AND CURRENT_TIMESTAMP(3) > DATE_ADD(ur.slot_end, INTERVAL ${RESERVATION_LATE_MOVE_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END AS beyond_soft_late,
          CASE
            WHEN ur.slot_end IS NOT NULL
              AND CURRENT_TIMESTAMP(3) > DATE_ADD(ur.slot_end, INTERVAL ${RESERVATION_LATE_CANCEL_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END AS beyond_hard_late,
          DATE_FORMAT(ur.slot_start, '%h:%i %p') AS slot_start_time_label_local,
          ur.metadata,
          st.latitude,
          st.longitude
        FROM user_reservations ur
        INNER JOIN stations st ON st.id = ur.station_id
        WHERE ur.public_id = ${reservationPublicId}
          AND ur.user_id = ${authUserId}
        LIMIT 1
      `
    } catch {
      rows = await prisma.$queryRaw`
        SELECT
          ur.id,
          ur.public_id,
          ur.station_id,
          ur.status,
          ur.slot_start,
          ur.slot_end,
          CASE
            WHEN ur.slot_start IS NOT NULL AND CURRENT_TIMESTAMP(3) < ur.slot_start THEN 1
            ELSE 0
          END AS before_slot_start,
          CASE
            WHEN ur.slot_end IS NOT NULL
              AND CURRENT_TIMESTAMP(3) > DATE_ADD(ur.slot_end, INTERVAL ${RESERVATION_LATE_MOVE_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END AS beyond_soft_late,
          CASE
            WHEN ur.slot_end IS NOT NULL
              AND CURRENT_TIMESTAMP(3) > DATE_ADD(ur.slot_end, INTERVAL ${RESERVATION_LATE_CANCEL_MINUTES} MINUTE)
            THEN 1
            ELSE 0
          END AS beyond_hard_late,
          DATE_FORMAT(ur.slot_start, '%h:%i %p') AS slot_start_time_label_local,
          ur.metadata,
          NULL AS latitude,
          NULL AS longitude
        FROM user_reservations ur
        WHERE ur.public_id = ${reservationPublicId}
          AND ur.user_id = ${authUserId}
        LIMIT 1
      `
    }
    const reservation = rows?.[0]
    if (!reservation?.id) throw badRequest("Reservation not found")

    const currentStatus = String(reservation.status || "").toUpperCase()
    if (!["PENDING", "CONFIRMED", "CHECKED_IN"].includes(currentStatus)) {
      throw badRequest("Reservation is not eligible for check-in.")
    }
    if (currentStatus === "CHECKED_IN") {
      return ok(res, {
        checkedIn: true,
        reservationId: reservationPublicId,
        status: "CHECKED_IN",
        message: "Already checked in.",
      })
    }

    const beforeSlotStart = Number(reservation.before_slot_start || 0) > 0
    if (beforeSlotStart) {
      const slotStartLabel = String(reservation.slot_start_time_label_local || "").trim()
      throw badRequest(
        slotStartLabel
          ? `Check-in is not open yet. Your slot starts at ${slotStartLabel}.`
          : "Check-in is not open yet. Please wait until your slot start time."
      )
    }

    const now = new Date()

    const metadata = parseReservationMetadata(reservation.metadata)
    const beyondHardLate = Number(reservation.beyond_hard_late || 0) > 0
    if (beyondHardLate) {
      metadata.expiredReason = "late_arrival"
      metadata.expiredAt = now.toISOString()
      metadata.noShowForfeitPct = 100
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE user_reservations
          SET
            status = 'EXPIRED',
            cancelled_at = CURRENT_TIMESTAMP(3),
            updated_at = CURRENT_TIMESTAMP(3),
            metadata = ${JSON.stringify(metadata)}
          WHERE id = ${reservation.id}
        `

        await releaseReservationWalletHold(
          {
            reservationPublicId,
            actorUserId: authUserId,
            reason: "RESERVATION_EXPIRED_LATE_ARRIVAL",
          },
          { tx }
        )
      })
      throw badRequest("Reservation expired due to late arrival.")
    }

    let distanceKm = null
    if (body.method === "QR") {
      const expectedToken = String(metadata.qrToken || "").trim()
      const providedToken = String(body.qrToken || "").trim()
      if (!expectedToken || !providedToken || expectedToken !== providedToken) {
        throw badRequest("QR check-in failed. Invalid reservation QR token.")
      }
    } else {
      const userLat = toNumberOrNull(body.userLat)
      const userLng = toNumberOrNull(body.userLng)
      const stationLat = toNumberOrNull(reservation.latitude)
      const stationLng = toNumberOrNull(reservation.longitude)
      if (
        userLat !== null &&
        userLng !== null &&
        stationLat !== null &&
        stationLng !== null
      ) {
        distanceKm = haversineKm(
          { lat: userLat, lng: userLng },
          { lat: stationLat, lng: stationLng }
        )
      }
    }

    const beyondSoftLate = Number(reservation.beyond_soft_late || 0) > 0
    const lateHandling = beyondSoftLate ? "MOVE_TO_END" : "ON_TIME"
    metadata.checkInMethod = body.method
    metadata.checkInAt = now.toISOString()
    metadata.checkInDistanceKm = distanceKm !== null ? Number(distanceKm.toFixed(3)) : null
    metadata.lateHandling = lateHandling

    await prisma.$executeRaw`
      UPDATE user_reservations
      SET
        status = 'CHECKED_IN',
        check_in_time = CURRENT_TIMESTAMP(3),
        confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP(3)),
        updated_at = CURRENT_TIMESTAMP(3),
        metadata = ${JSON.stringify(metadata)}
      WHERE id = ${reservation.id}
    `

    await writeAuditLog({
      stationId: reservation.station_id,
      actionType: "RESERVATION_USER_CHECK_IN",
      payload: {
        reservationPublicId,
        userPublicId: req.auth?.userPublicId || null,
        method: body.method,
        lateHandling,
      },
    })

    return ok(res, {
      checkedIn: true,
      reservationId: reservationPublicId,
      status: "CHECKED_IN",
      lateHandling,
      message:
        lateHandling === "MOVE_TO_END"
          ? "Checked in late. You may be moved to the end of the reserved queue."
          : "Check-in complete. Proceed to station instructions.",
    })
  })
)

router.get(
  "/user/queue/active",
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const rows = await prisma.$queryRaw`
      SELECT public_id
      FROM queue_entries
      WHERE user_id = ${authUserId}
        AND status IN ('WAITING', 'CALLED', 'LATE')
      ORDER BY joined_at ASC
      LIMIT 1
    `

    const activeEntry = rows?.[0]
    if (!activeEntry?.public_id) {
      return ok(res, {
        queueJoinId: null,
        status: null,
      })
    }

    const status = await buildUserQueueStatusSnapshot({
      queueJoinId: activeEntry.public_id,
      auth: req.auth,
    })

    return ok(res, {
      queueJoinId: activeEntry.public_id,
      status,
    })
  })
)

router.get(
  "/user/queue/:queueJoinId/status",
  asyncHandler(async (req, res) => {
    const queueJoinId = String(req.params.queueJoinId || "").trim()
    if (!queueJoinId) throw badRequest("queueJoinId is required")

    const status = await buildUserQueueStatusSnapshot({
      queueJoinId,
      auth: req.auth,
    })

    return ok(res, status)
  })
)

router.post(
  "/user/queue/:queueJoinId/pump-scan",
  asyncHandler(async (req, res) => {
    const queueJoinId = String(req.params.queueJoinId || "").trim()
    if (!queueJoinId) throw badRequest("queueJoinId is required")

    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const body = queuePumpScanBodySchema.parse(req.body || {})
    const queueRows = await prisma.$queryRaw`
      SELECT
        qe.id,
        qe.public_id,
        qe.station_id,
        qe.user_id,
        qe.status,
        qe.metadata,
        st.public_id AS station_public_id,
        ft.code AS fuel_type_code
      FROM queue_entries qe
      INNER JOIN stations st ON st.id = qe.station_id
      INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
      WHERE qe.public_id = ${queueJoinId}
        AND qe.user_id = ${authUserId}
      LIMIT 1
    `

    const queueEntry = queueRows?.[0]
    if (!queueEntry?.id) throw badRequest("Queue entry not found")

    const queueStatus = String(queueEntry.status || "").trim().toUpperCase()
    if (!ACTIVE_QUEUE_STATUSES.includes(queueStatus)) {
      throw badRequest("Pump scan is only available for active queue entries.")
    }

    const parsedScan = parsePumpQrPayload(body.qrToken)
    const pumpPublicId = String(parsedScan.pumpPublicId || "").trim()
    if (!pumpPublicId) {
      throw badRequest("Pump QR scan failed. Invalid pump QR code.")
    }

    const stationPublicId = String(queueEntry.station_public_id || "").trim()
    if (parsedScan.stationPublicId && parsedScan.stationPublicId !== stationPublicId) {
      throw badRequest("Pump QR does not belong to this station.")
    }

    const pumpRows = await prisma.$queryRaw`
      SELECT
        p.id,
        p.public_id,
        p.pump_number,
        p.status
      FROM pumps p
      WHERE p.station_id = ${queueEntry.station_id}
        AND p.public_id = ${pumpPublicId}
        AND p.is_active = 1
      LIMIT 1
    `

    const pump = pumpRows?.[0]
    if (!pump?.public_id) {
      throw badRequest("Pump QR does not match an active pump at this station.")
    }

    const nozzleRows = await listPumpFuelNozzles({
      stationId: queueEntry.station_id,
      pumpId: Number(pump.id || 0),
      fuelTypeCode: String(queueEntry.fuel_type_code || "").trim().toUpperCase(),
    })
    const metadata = parseJsonObject(queueEntry.metadata)
    const currentAssignedNozzlePublicId = String(metadata?.lastPumpScan?.nozzlePublicId || "").trim()
    const activeQueueAssignmentRows = await prisma.$queryRaw`
      SELECT public_id, metadata
      FROM queue_entries
      WHERE station_id = ${queueEntry.station_id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
        AND public_id <> ${queueJoinId}
    `
    const blockedNozzlePublicIds = collectAssignedNozzlePublicIds(activeQueueAssignmentRows, {
      pumpPublicId: String(pump.public_id || "").trim(),
      excludeQueueJoinId: queueJoinId,
    })
    const assignedNozzle = resolveAssignableNozzle(
      nozzleRows,
      String(queueEntry.fuel_type_code || "").trim().toUpperCase(),
      {
        preferredNozzlePublicId: currentAssignedNozzlePublicId,
        blockedNozzlePublicIds,
      }
    )
    if (!assignedNozzle?.id) {
      throw badRequest("No free nozzle on this pump matches your selected fuel type.")
    }

    const scannedAt = new Date().toISOString()
    metadata.lastPumpScan = {
      pumpPublicId: String(pump.public_id || "").trim(),
      pumpNumber: Number.isFinite(Number(pump.pump_number)) ? Number(pump.pump_number) : null,
      pumpStatus: String(pump.status || "").trim().toUpperCase() || null,
      nozzlePublicId: String(assignedNozzle.public_id || "").trim() || null,
      nozzleNumber: String(assignedNozzle.nozzle_number || "").trim() || null,
      nozzleStatus: String(assignedNozzle.status || "").trim().toUpperCase() || null,
      fuelType: String(assignedNozzle.fuel_code || queueEntry.fuel_type_code || "").trim().toUpperCase() || null,
      scannedAt,
      rawToken: parsedScan.rawValue,
      scannedByUserPublicId: String(req.auth?.userPublicId || "").trim() || null,
      scannedBySessionPublicId: String(req.auth?.sessionPublicId || "").trim() || null,
    }

    const attendantWorkflowSync = applyQueuePumpScanToAttendantWorkflow({
      metadata,
      queueStatus,
      scannedAt,
      pumpAssignment: metadata.lastPumpScan,
    })

    await prisma.$executeRaw`
      UPDATE queue_entries
      SET metadata = ${JSON.stringify(attendantWorkflowSync.metadata)}
      WHERE id = ${queueEntry.id}
    `

    await markHybridOrderReadyOnSite({
      stationId: queueEntry.station_id,
      orderType: ATTENDANT_ORDER_TYPES.QUEUE,
      orderPublicId: queueJoinId,
      signalType: ReadinessSignalType.QR_SCAN,
      occurredAt: scannedAt,
      signalMetadata: {
        userPublicId: req.auth?.userPublicId || null,
        pumpPublicId: String(pump.public_id || "").trim(),
        nozzlePublicId: String(assignedNozzle.public_id || "").trim() || null,
      },
    }).catch(() => null)

    await writeAuditLog({
      stationId: queueEntry.station_id,
      actionType: "QUEUE_PUMP_QR_SCAN",
      payload: {
        queueJoinId,
        pumpPublicId: pump.public_id,
        pumpNumber: Number(pump.pump_number || 0) || null,
        nozzlePublicId: String(assignedNozzle.public_id || "").trim() || null,
        nozzleNumber: String(assignedNozzle.nozzle_number || "").trim() || null,
        userPublicId: req.auth?.userPublicId || null,
      },
    })

    const status = await buildUserQueueStatusSnapshot({
      queueJoinId,
      auth: req.auth,
    })

    return ok(res, {
      scanned: true,
      queueJoinId,
      pump: {
        pumpPublicId: String(pump.public_id || "").trim(),
        pumpNumber: Number.isFinite(Number(pump.pump_number)) ? Number(pump.pump_number) : null,
        status: String(pump.status || "").trim().toUpperCase() || null,
        nozzlePublicId: String(assignedNozzle.public_id || "").trim() || null,
        nozzleNumber: String(assignedNozzle.nozzle_number || "").trim() || null,
        nozzleStatus: String(assignedNozzle.status || "").trim().toUpperCase() || null,
        fuelType: String(assignedNozzle.fuel_code || queueEntry.fuel_type_code || "").trim().toUpperCase() || null,
      },
      status,
      message: `Pump ${Number.isFinite(Number(pump.pump_number)) ? pump.pump_number : pump.public_id} verified. Nozzle ${String(assignedNozzle.nozzle_number || assignedNozzle.public_id || '').trim()} assigned.`,
    })
  })
)

router.post(
  "/user/queue/:queueJoinId/dispense-request",
  asyncHandler(async (req, res) => {
    const queueJoinId = String(req.params.queueJoinId || "").trim()
    if (!queueJoinId) throw badRequest("queueJoinId is required")

    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Authenticated user context is required")
    }

    const body = queueDispenseRequestBodySchema.parse(req.body || {})
    const queueRows = await prisma.$queryRaw`
      SELECT
        qe.id,
        qe.public_id,
        qe.station_id,
        qe.user_id,
        qe.status,
        qe.metadata,
        st.public_id AS station_public_id,
        st.prices_json,
        ft.code AS fuel_type_code
      FROM queue_entries qe
      INNER JOIN stations st ON st.id = qe.station_id
      INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
      WHERE qe.public_id = ${queueJoinId}
        AND qe.user_id = ${authUserId}
      LIMIT 1
    `

    const queueEntry = queueRows?.[0]
    if (!queueEntry?.id) throw badRequest("Queue entry not found")

    const queueStatus = String(queueEntry.status || "").trim().toUpperCase()
    if (!ACTIVE_QUEUE_STATUSES.includes(queueStatus)) {
      throw badRequest("Fuel request is only available for active queue entries.")
    }

    const metadata = parseJsonObject(queueEntry.metadata)
    assertQueuePumpScanSessionMatchesAuth(metadata, req.auth)
    const verifiedPumpPublicId = String(metadata?.lastPumpScan?.pumpPublicId || "").trim()
    if (!verifiedPumpPublicId) {
      throw badRequest("Verify the assigned pump QR before sending fuel details.")
    }
    const assignedNozzlePublicId = String(metadata?.lastPumpScan?.nozzlePublicId || "").trim()

    const requestedLiters = Number(body.liters)
    if (!Number.isFinite(requestedLiters) || requestedLiters <= 0) {
      throw badRequest("Fuel request liters must be greater than zero.")
    }

    const effectivePaymentMode = body.prepay === true
      ? "PREPAY"
      : body.prepay === false
        ? "PAY_AT_PUMP"
        : deriveQueuePaymentMode(metadata)

    const pumpRows = await prisma.$queryRaw`
      SELECT
        p.id,
        p.public_id,
        p.pump_number,
        p.status
      FROM pumps p
      WHERE p.station_id = ${queueEntry.station_id}
        AND p.public_id = ${verifiedPumpPublicId}
        AND p.is_active = 1
      LIMIT 1
    `
    const pump = pumpRows?.[0]
    if (!pump?.id) {
      throw badRequest("Verified pump is no longer available at this station.")
    }

    const normalizedPumpStatus = String(pump.status || "").trim().toUpperCase()
    if (["OFFLINE", "PAUSED"].includes(normalizedPumpStatus)) {
      throw badRequest("Verified pump is currently unavailable.")
    }

    const nozzleRows = await listPumpFuelNozzles({
      stationId: queueEntry.station_id,
      pumpId: Number(pump.id || 0),
      fuelTypeCode: String(queueEntry.fuel_type_code || "").trim().toUpperCase(),
    })
    const activeQueueAssignmentRows = await prisma.$queryRaw`
      SELECT public_id, metadata
      FROM queue_entries
      WHERE station_id = ${queueEntry.station_id}
        AND status IN ('WAITING', 'CALLED', 'LATE')
        AND public_id <> ${queueJoinId}
    `
    const blockedNozzlePublicIds = collectAssignedNozzlePublicIds(activeQueueAssignmentRows, {
      pumpPublicId: String(pump.public_id || "").trim(),
      excludeQueueJoinId: queueJoinId,
    })
    if (assignedNozzlePublicId && blockedNozzlePublicIds.has(assignedNozzlePublicId)) {
      throw badRequest("Assigned nozzle is no longer free. Scan the pump again to get a new nozzle.")
    }
    const nozzle = resolveAssignableNozzle(
      nozzleRows,
      String(queueEntry.fuel_type_code || "").trim().toUpperCase(),
      {
        preferredNozzlePublicId: assignedNozzlePublicId,
      }
    )
    if (!nozzle?.id) {
      throw badRequest("Assigned nozzle is no longer free. Scan the pump again to get a new nozzle.")
    }

    if (metadata?.serviceRequest?.submittedAt) {
      const status = await buildUserQueueStatusSnapshot({
        queueJoinId,
        auth: req.auth,
      })
      return ok(res, {
        submitted: false,
        alreadySubmitted: true,
        queueJoinId,
        status,
        message: "Fuel request already submitted for this queue entry.",
      })
    }

    const pricePerLitre = resolveFuelPricePerLitre(queueEntry.prices_json, queueEntry.fuel_type_code)
    let smartPayQuote = buildSmartPayPrepayQuote({
      pricing: {},
      basePricePerLitre: pricePerLitre,
      litres: requestedLiters,
    })

    if (effectivePaymentMode === "PREPAY") {
      const promotionPreview = await getPromotionPricingPreview({
        stationPublicId: String(queueEntry.station_public_id || "").trim(),
        fuelTypeCode: String(queueEntry.fuel_type_code || "").trim().toUpperCase(),
        litres: requestedLiters,
        paymentMethod: "SMARTPAY",
        userId: authUserId,
        now: new Date(),
        cashbackDestination: "WALLET",
      })
      smartPayQuote = buildSmartPayPrepayQuote({
        pricing: promotionPreview?.pricing || {},
        basePricePerLitre: pricePerLitre,
        litres: requestedLiters,
      })
    }

    const estimatedAmount = smartPayQuote.estimatedAmount

    if (effectivePaymentMode === "PREPAY") {
      if (!Number.isFinite(estimatedAmount) || estimatedAmount <= 0) {
        throw badRequest("Fuel price is unavailable for wallet prepay on this station.")
      }
      await ensureWalletStorageReadyOrThrow()
      const walletSummary = await getUserWalletSummary(authUserId)
      assertWalletEligibleForQueuePrepay(walletSummary)
    }

    let walletHold = null
    await prisma.$transaction(async (tx) => {
      if (effectivePaymentMode === "PREPAY") {
        walletHold = await createQueuePrepayWalletHold(
          {
            userId: authUserId,
            queueJoinId,
            amount: estimatedAmount,
            actorUserId: authUserId,
          },
          { tx }
        )
      }

      metadata.requestedLiters = requestedLiters
      metadata.paymentMode = effectivePaymentMode
      metadata.prepaySelected = effectivePaymentMode === "PREPAY"
      metadata.lastPumpScan = {
        ...(metadata.lastPumpScan && typeof metadata.lastPumpScan === "object" ? metadata.lastPumpScan : {}),
        pumpPublicId: verifiedPumpPublicId,
        pumpNumber: Number.isFinite(Number(pump.pump_number)) ? Number(pump.pump_number) : null,
        pumpStatus: String(pump.status || "").trim().toUpperCase() || null,
        nozzlePublicId: String(nozzle.public_id || "").trim() || null,
        nozzleNumber: String(nozzle.nozzle_number || "").trim() || null,
        nozzleStatus: String(nozzle.status || "").trim().toUpperCase() || null,
        fuelType: String(nozzle.fuel_code || queueEntry.fuel_type_code || "").trim().toUpperCase() || null,
        scannedAt: metadata?.lastPumpScan?.scannedAt || new Date().toISOString(),
        scannedByUserPublicId:
          String(metadata?.lastPumpScan?.scannedByUserPublicId || req.auth?.userPublicId || "").trim() || null,
        scannedBySessionPublicId:
          String(metadata?.lastPumpScan?.scannedBySessionPublicId || req.auth?.sessionPublicId || "").trim() || null,
      }
      metadata.serviceRequest = {
        liters: requestedLiters,
        paymentMode: effectivePaymentMode,
        prepaySelected: effectivePaymentMode === "PREPAY",
        submittedAt: new Date().toISOString(),
        nozzlePublicId: String(nozzle.public_id || "").trim() || null,
        pricePerLitre: smartPayQuote.payablePricePerLitre,
        basePricePerLitre: smartPayQuote.basePricePerLitre,
        estimatedAmount,
        subtotal: smartPayQuote.subtotal,
        totalDirectDiscount: smartPayQuote.totalDirectDiscount,
        cashbackTotal: smartPayQuote.cashbackTotal,
        promoLabelsApplied: smartPayQuote.promoLabelsApplied,
        currencyCode: "MWK",
        paymentStatus: effectivePaymentMode === "PREPAY"
          ? "HELD"
          : "PENDING_AT_PUMP",
        holdReference: walletHold?.hold?.reference || null,
        walletTransactionReference: null,
        settlementBatchPublicId: null,
        walletAvailableBalanceAfterPayment: walletHold?.walletAfterHold?.availableBalance ?? null,
        dispensingStartedAt: null,
        userSessionPublicId: String(req.auth?.sessionPublicId || "").trim() || null,
      }

      await tx.$executeRaw`
        UPDATE queue_entries
        SET metadata = ${JSON.stringify(metadata)}
        WHERE id = ${queueEntry.id}
      `
    })

    await writeAuditLog({
      stationId: queueEntry.station_id,
      actionType: "QUEUE_USER_DISPENSE_REQUEST",
      payload: {
        queueJoinId,
        userPublicId: req.auth?.userPublicId || null,
        pumpPublicId: verifiedPumpPublicId,
        nozzlePublicId: String(nozzle.public_id || "").trim() || null,
        requestedLiters,
        paymentMode: effectivePaymentMode,
        holdReference: walletHold?.hold?.reference || null,
        walletTransactionReference: null,
        settlementBatchPublicId: null,
        estimatedAmount,
      },
    })

    const status = await buildUserQueueStatusSnapshot({
      queueJoinId,
      auth: req.auth,
    })

    return ok(res, {
      submitted: true,
      queueJoinId,
      status,
      payment: walletHold
        ? {
            hold: walletHold.hold,
            wallet: walletHold.walletAfterHold,
            settlement: null,
          }
        : null,
      message: effectivePaymentMode === "PREPAY"
        ? "Fuel request submitted and wallet amount held. SmartLink captures payment only after you are served."
        : "Fuel request submitted. Pump is now dispensing.",
    })
  })
)

router.post(
  "/user/queue/:queueJoinId/leave",
  asyncHandler(async (req, res) => {
    const queueJoinId = String(req.params.queueJoinId || "").trim()
    const result = await executeLeaveQueueAction({
      queueJoinId,
      auth: req.auth,
      body: req.body,
      source: "user_app",
    })
    const { httpStatus = 200, ...payload } = result
    return ok(res, payload, httpStatus)
  })
)

router.post(
  "/user/queue/:queueJoinId/report-issue",
  asyncHandler(async (req, res) => {
    const queueJoinId = String(req.params.queueJoinId || "").trim()
    if (!queueJoinId) throw badRequest("queueJoinId is required")
    const body = reportIssueSchema.parse(req.body || {})

    const status = await buildUserQueueStatusSnapshot({
      queueJoinId,
      auth: req.auth,
    })

    const referenceId = createPublicId()
    const stationRows = await prisma.$queryRaw`
      SELECT qe.station_id, st.public_id AS station_public_id, st.name AS station_name
      FROM queue_entries qe
      INNER JOIN stations st ON st.id = qe.station_id
      WHERE qe.public_id = ${queueJoinId}
      LIMIT 1
    `
    const stationId = Number(stationRows?.[0]?.station_id || 0)
    const stationPublicId = String(stationRows?.[0]?.station_public_id || "").trim()
    const stationName = String(stationRows?.[0]?.station_name || "").trim() || "the station"
    if (!Number.isFinite(stationId) || stationId <= 0) {
      throw badRequest("Queue entry not found")
    }

    const ticketId = createPublicId()
    const casePublicId = await createSupportCasePublicId({
      typeCode: mapQueueIssueToSupportCaseTypeCode(body.issueType),
    })
    const supportAgentUserId = await resolveInternalSupportAgentUserId()
    const issueTitle = mapQueueIssueTitle(body.issueType)
    const issueDescription = String(body.message || "").trim() || `${issueTitle} reported from queue ${queueJoinId}.`

    await prisma.$executeRaw`
      INSERT INTO support_tickets (
        id,
        station_id,
        user_id,
        category,
        severity,
        title,
        description,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${ticketId},
        ${stationPublicId},
        ${req.auth?.userPublicId || null},
        ${mapQueueIssueToSupportCategory(body.issueType)},
        ${mapQueueIssueToSupportSeverity(body.issueType)},
        ${issueTitle},
        ${issueDescription},
        'OPEN',
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      )
    `

    await prisma.$executeRaw`
      INSERT INTO internal_support_cases (
        public_id,
        source_ticket_id,
        station_id,
        user_id,
        category,
        priority,
        status,
        assigned_user_id,
        subject,
        summary
      )
      VALUES (
        ${casePublicId},
        ${ticketId},
        ${stationId},
        ${req.auth?.userId || null},
        ${mapQueueIssueToInternalCategory(body.issueType)},
        ${body.issueType === "STATION_ACCESS" ? "HIGH" : "MEDIUM"},
        'OPEN',
        ${supportAgentUserId},
        ${issueTitle},
        ${issueDescription}
      )
    `

    await writeAuditLog({
      stationId,
      actionType: "QUEUE_USER_REPORT_ISSUE",
      payload: {
        referenceId,
        queueJoinId,
        issueType: body.issueType,
        message: body.message || null,
        userPublicId: req.auth?.userPublicId || null,
        supportTicketId: ticketId,
        supportCasePublicId: casePublicId,
      },
    })

    let alert = null
    try {
      await ensureUserAlertsTableReady()
      alert = await createUserAlert({
        userId: req.auth?.userId,
        stationId,
        category: "SYSTEM",
        title: "Support request received",
        body: `${stationName} issue received. Your request is now under review.`,
        metadata: {
          supportTicketId: ticketId,
          supportCasePublicId: casePublicId,
          supportStatus: "OPEN",
          queueJoinId,
          issueType: body.issueType,
          path: "/m/help",
        },
      })
      publishUserAlert({
        userId: req.auth?.userId,
        eventType: "user_alert:new",
        data: alert,
      })
      await sendPushAlertToUser({
        userId: req.auth?.userId,
        notification: {
          title: alert.title,
          body: alert.message,
          tag: alert.publicId || ticketId,
          url: "/m/help",
          icon: "/smartlogo.png",
          badge: "/smartlogo.png",
        },
        data: {
          alertPublicId: alert.publicId || null,
          supportTicketId: ticketId,
          supportCasePublicId: casePublicId,
        },
      }).catch(() => {})
    } catch {
      alert = null
    }

    return ok(
      res,
      {
        reported: true,
        referenceId,
        supportTicketId: ticketId,
        supportCasePublicId: casePublicId,
        queueJoinId,
        issueType: body.issueType,
        acknowledgedAt: new Date().toISOString(),
        status,
        alertCreated: Boolean(alert?.publicId),
      },
      201
    )
  })
)

export default router

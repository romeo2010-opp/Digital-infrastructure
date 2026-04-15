import crypto from "node:crypto"
import { prisma } from "../../db/prisma.js"
import { notFound } from "../../utils/http.js"
import { appTodayISO } from "../../utils/dateTime.js"
import { listStationPumpsWithNozzles } from "../pumps/pumps.service.js"
import { derivePumpSessionStatusFromTelemetryEvent } from "../monitoring/monitoring.service.js"
import {
  computeFuelGuarantee,
  DEFAULT_FUEL_GUARANTEE_CONFIG,
} from "./fuelGuarantee.js"

export const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "LATE"]
const DEFAULT_AVERAGE_SERVICE_MINUTES = 4
const RECENT_TX_MEDIAN_LIMIT = 30
const REFILL_CONFIDENCE = 0.8

const FUEL_GUARANTEE_CONFIG = {
  defaultAvgLitersPerCarPetrol: Number(
    process.env.QUEUE_GUARANTEE_DEFAULT_AVG_PETROL
      || DEFAULT_FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarPetrol
  ),
  defaultAvgLitersPerCarDiesel: Number(
    process.env.QUEUE_GUARANTEE_DEFAULT_AVG_DIESEL
      || DEFAULT_FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarDiesel
  ),
  safetyBufferMinLiters: Number(
    process.env.QUEUE_GUARANTEE_SAFETY_BUFFER_MIN_LITERS
      || DEFAULT_FUEL_GUARANTEE_CONFIG.safetyBufferMinLiters
  ),
  safetyBufferPct: Number(
    process.env.QUEUE_GUARANTEE_SAFETY_BUFFER_PCT
      || DEFAULT_FUEL_GUARANTEE_CONFIG.safetyBufferPct
  ),
  safeExtraMarginPct: Number(
    process.env.QUEUE_GUARANTEE_SAFE_EXTRA_MARGIN_PCT
      || DEFAULT_FUEL_GUARANTEE_CONFIG.safeExtraMarginPct
  ),
  stalenessSeconds: Number(
    process.env.QUEUE_GUARANTEE_STALENESS_SECONDS
      || DEFAULT_FUEL_GUARANTEE_CONFIG.stalenessSeconds
  ),
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toTimeMs(value) {
  if (!value) return NaN
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  return Number.isFinite(ms) ? ms : NaN
}

function parseJson(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return null
  return normalized
}

function toPositiveNumberOrNull(value) {
  const numeric = toNumberOrNull(value)
  if (numeric === null || numeric <= 0) return null
  return numeric
}

function pushUniqueNote(notes, note) {
  if (!note) return
  if (!notes.includes(note)) {
    notes.push(note)
  }
}

function toQueueMovementState({ joinsPaused, pauseReason, lastMovementAt }) {
  if (joinsPaused) return "paused"
  if (pauseReason) return "paused"
  if (!lastMovementAt) return "normal"

  const lastMoved = new Date(lastMovementAt)
  if (Number.isNaN(lastMoved.getTime())) return "normal"
  const idleSeconds = Math.floor((Date.now() - lastMoved.getTime()) / 1000)
  if (idleSeconds >= 1200) return "paused"
  if (idleSeconds >= 420) return "slow"
  return "normal"
}

function buildQrPayload(queueJoinId, stationPublicId, fuelType) {
  const today = appTodayISO() || "1970-01-01"
  const hash = crypto
    .createHash("sha256")
    .update(`${queueJoinId}|${stationPublicId}|${fuelType}|${today}`)
    .digest("hex")
    .slice(0, 24)

  return `smartlink:${stationPublicId}:${queueJoinId}:${hash}`
}

export function parsePumpQrPayload(value) {
  const rawValue = String(value || "").trim()
  if (!rawValue) {
    return {
      rawValue: "",
      pumpPublicId: null,
      stationPublicId: null,
    }
  }

  const smartlinkPumpMatch = rawValue.match(/^smartlink:(?:pump:)?([^:]+):([^:]+)$/i)
  if (smartlinkPumpMatch) {
    return {
      rawValue,
      stationPublicId: String(smartlinkPumpMatch[1] || "").trim() || null,
      pumpPublicId: String(smartlinkPumpMatch[2] || "").trim() || null,
    }
  }

  try {
    const parsedUrl = new URL(rawValue)
    const pumpPublicId = String(
      parsedUrl.searchParams.get("pumpPublicId")
        || parsedUrl.searchParams.get("pumpId")
        || parsedUrl.searchParams.get("pump")
        || ""
    ).trim()
    const stationPublicId = String(
      parsedUrl.searchParams.get("stationPublicId")
        || parsedUrl.searchParams.get("stationId")
        || ""
    ).trim()
    if (pumpPublicId) {
      return {
        rawValue,
        pumpPublicId,
        stationPublicId: stationPublicId || null,
      }
    }

    const pathnameMatch = parsedUrl.pathname.match(/([^/]+-P\d{2,})$/i)
    if (pathnameMatch) {
      return {
        rawValue,
        pumpPublicId: String(pathnameMatch[1] || "").trim() || null,
        stationPublicId,
      }
    }
  } catch {
    // Ignore URL parsing errors and fall through to plain pump ID handling.
  }

  return {
    rawValue,
    pumpPublicId: rawValue,
    stationPublicId: null,
  }
}

export function collectAssignedNozzlePublicIds(
  queueRows,
  { pumpPublicId, excludeQueueJoinId = "" } = {}
) {
  const scopedPumpPublicId = String(pumpPublicId || "").trim()
  const scopedExcludedQueueJoinId = String(excludeQueueJoinId || "").trim()
  const assignedNozzlePublicIds = new Set()
  if (!scopedPumpPublicId) return assignedNozzlePublicIds

  for (const row of queueRows || []) {
    const rowQueueJoinId = String(row?.public_id || row?.queueJoinId || "").trim()
    if (scopedExcludedQueueJoinId && rowQueueJoinId === scopedExcludedQueueJoinId) {
      continue
    }

    const metadata = parseJson(row?.metadata)
    const lastPumpScan =
      metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
        ? metadata.lastPumpScan
        : {}
    const serviceRequest =
      metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
        ? metadata.serviceRequest
        : {}

    const assignedPumpPublicId = String(
      lastPumpScan.pumpPublicId || serviceRequest.pumpPublicId || ""
    ).trim()
    if (!assignedPumpPublicId || assignedPumpPublicId !== scopedPumpPublicId) {
      continue
    }

    const assignedNozzlePublicId = String(
      serviceRequest.nozzlePublicId || lastPumpScan.nozzlePublicId || ""
    ).trim()
    if (assignedNozzlePublicId) {
      assignedNozzlePublicIds.add(assignedNozzlePublicId)
    }
  }

  return assignedNozzlePublicIds
}

export function resolveAssignableNozzle(
  nozzleRows,
  fuelTypeCode,
  { preferredNozzlePublicId = "", blockedNozzlePublicIds = [] } = {}
) {
  const scopedPreferredNozzleId = String(preferredNozzlePublicId || "").trim()
  const scopedFuelTypeCode = String(fuelTypeCode || "").trim().toUpperCase()
  const blockedNozzleIds = new Set(
    Array.from(blockedNozzlePublicIds || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )

  const activeRows = (nozzleRows || []).filter((item) => {
    const nozzlePublicId = String(item?.public_id || "").trim()
    return (
      String(item?.status || "").trim().toUpperCase() === "ACTIVE"
      && String(item?.fuel_code || "").trim().toUpperCase() === scopedFuelTypeCode
      && !blockedNozzleIds.has(nozzlePublicId)
    )
  })

  if (!activeRows.length) return null
  if (!scopedPreferredNozzleId) return activeRows[0]
  return (
    activeRows.find((item) => String(item?.public_id || "").trim() === scopedPreferredNozzleId)
    || activeRows[0]
  )
}

function ensureQueueEntryAccess(entry, auth) {
  if (!entry) throw notFound("Queue entry not found")
  if (auth?.bypass) return

  const scopedStationId = Number(auth?.stationId || 0)
  if (Number.isFinite(scopedStationId) && scopedStationId > 0 && Number(entry.station_id) !== scopedStationId) {
    throw notFound("Queue entry not found")
  }

  const entryUserId = Number(entry.user_id || 0)
  const authUserId = Number(auth?.userId || 0)
  if (entryUserId > 0 && authUserId !== entryUserId) {
    throw notFound("Queue entry not found")
  }
}

export async function getQueueSettings(stationId) {
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

  return inserted?.[0] || null
}

export async function getFuelTypeId(code) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM fuel_types
    WHERE code = ${code}
    LIMIT 1
  `

  const row = rows?.[0]
  if (!row?.id) throw notFound(`Fuel type not found: ${code}`)
  return Number(row.id)
}

export async function normalizeQueuePositions(stationId) {
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

export async function getAverageServiceMinutes(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(AVG(TIMESTAMPDIFF(MINUTE, called_at, served_at)), 0) AS avg_called_service_minutes
    FROM (
      SELECT called_at, served_at
      FROM queue_entries
      WHERE station_id = ${stationId}
        AND status = 'SERVED'
        AND called_at IS NOT NULL
        AND served_at IS NOT NULL
      ORDER BY served_at DESC
      LIMIT 80
    ) recent
  `

  const avg = Number(rows?.[0]?.avg_called_service_minutes || 0)
  if (!Number.isFinite(avg) || avg <= 0) return DEFAULT_AVERAGE_SERVICE_MINUTES
  return Math.min(10, Math.max(2, avg))
}

async function getStationStatusBreakdown(stationId) {
  const pumps = await listStationPumpsWithNozzles(stationId, { includeInactive: false })
  if (!Array.isArray(pumps) || !pumps.length) return null

  let active = 0
  let dispensing = 0
  let idle = 0
  let offline = 0

  for (const pump of pumps) {
    const pumpStatus = String(pump?.status || "").toUpperCase()
    const nozzles = Array.isArray(pump?.nozzles) ? pump.nozzles : []
    const hasDispensingNozzle = nozzles.some((nozzle) => String(nozzle?.status || "").toUpperCase() === "DISPENSING")

    if (pumpStatus === "OFFLINE") {
      offline += 1
      continue
    }

    if (hasDispensingNozzle || pumpStatus === "DISPENSING") {
      dispensing += 1
      continue
    }

    if (pumpStatus === "PAUSED" || pumpStatus === "DEGRADED" || pumpStatus === "IDLE") {
      idle += 1
      continue
    }

    active += 1
  }

  return {
    active,
    dispensing,
    idle,
    offline,
  }
}

function defaultAvgByFuelType(fuelType) {
  return String(fuelType || "").toUpperCase() === "DIESEL"
    ? FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarDiesel
    : FUEL_GUARANTEE_CONFIG.defaultAvgLitersPerCarPetrol
}

function computeMedian(numbers = []) {
  const values = numbers
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b)

  if (!values.length) return null
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[middle]
  return (values[middle - 1] + values[middle]) / 2
}

function readStationAvgFromSettings(settings, fuelType) {
  const normalizedFuel = String(fuelType || "").toUpperCase()
  const petrolKeys = [
    "avg_liters_per_car_petrol",
    "avg_litres_per_car_petrol",
    "petrol_avg_liters_per_car",
    "petrol_avg_litres_per_car",
  ]
  const dieselKeys = [
    "avg_liters_per_car_diesel",
    "avg_litres_per_car_diesel",
    "diesel_avg_liters_per_car",
    "diesel_avg_litres_per_car",
  ]
  const commonKeys = ["avg_liters_per_car", "avg_litres_per_car"]
  const keys = normalizedFuel === "DIESEL"
    ? [...dieselKeys, ...commonKeys]
    : [...petrolKeys, ...commonKeys]

  for (const key of keys) {
    const value = toPositiveNumberOrNull(settings?.[key])
    if (value !== null) return value
  }
  return null
}

function readRationCapFromSettings(settings, fuelType) {
  const normalizedFuel = String(fuelType || "").toUpperCase()
  const petrolKeys = [
    "max_liters_per_car_petrol",
    "max_litres_per_car_petrol",
    "petrol_max_liters_per_car",
    "petrol_max_litres_per_car",
  ]
  const dieselKeys = [
    "max_liters_per_car_diesel",
    "max_litres_per_car_diesel",
    "diesel_max_liters_per_car",
    "diesel_max_litres_per_car",
  ]
  const commonKeys = ["max_liters_per_car", "max_litres_per_car"]
  const keys = normalizedFuel === "DIESEL"
    ? [...dieselKeys, ...commonKeys]
    : [...petrolKeys, ...commonKeys]

  for (const key of keys) {
    const value = toPositiveNumberOrNull(settings?.[key])
    if (value !== null) return value
  }
  return null
}

function extractRequestedLiters(metadata) {
  if (!metadata || typeof metadata !== "object") return null
  const possibleKeys = [
    "requestedLiters",
    "requestedLitres",
    "litresRequested",
    "litersRequested",
    "requested_liters",
    "requested_litres",
  ]
  for (const key of possibleKeys) {
    const value = toPositiveNumberOrNull(metadata?.[key])
    if (value !== null) return value
  }
  return null
}

function extractQueuePaymentMode(metadata) {
  if (!metadata || typeof metadata !== "object") return "PAY_AT_PUMP"
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const walletSettlement =
    metadata?.walletSettlement && typeof metadata.walletSettlement === "object"
      ? metadata.walletSettlement
      : {}
  const serviceRequestPaymentMode = String(serviceRequest.paymentMode || "").trim().toUpperCase()
  const metadataPaymentMode = String(metadata.paymentMode || "").trim().toUpperCase()
  const serviceRequestPaymentStatus = String(serviceRequest.paymentStatus || "").trim().toUpperCase()
  const hasWalletPrepayEvidence =
    serviceRequest.prepaySelected === true
    || metadata.prepaySelected === true
    || serviceRequestPaymentMode === "PREPAY"
    || metadataPaymentMode === "PREPAY"
    || Boolean(String(serviceRequest.holdReference || "").trim())
    || Boolean(String(serviceRequest.walletTransactionReference || "").trim())
    || Boolean(String(serviceRequest.settlementBatchPublicId || "").trim())
    || Boolean(String(walletSettlement.holdReference || "").trim())
    || Boolean(String(walletSettlement.transactionReference || "").trim())
    || Boolean(String(walletSettlement.settlementBatchPublicId || "").trim())
    || ["HELD", "POSTED", "CAPTURED", "SETTLED"].includes(serviceRequestPaymentStatus)

  if (hasWalletPrepayEvidence) return "PREPAY"

  if (serviceRequest.prepaySelected === false || metadata.prepaySelected === false) {
    return "PAY_AT_PUMP"
  }
  if (serviceRequestPaymentMode === "PAY_AT_PUMP" || metadataPaymentMode === "PAY_AT_PUMP") {
    return "PAY_AT_PUMP"
  }

  return "PAY_AT_PUMP"
}

function extractAttendantWorkflow(metadata) {
  return metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
    ? metadata.attendantWorkflow
    : {}
}

function extractLastPumpScan(metadata) {
  if (!metadata?.lastPumpScan || typeof metadata.lastPumpScan !== "object") return null
  return {
    pumpPublicId: String(metadata.lastPumpScan.pumpPublicId || "").trim() || null,
    pumpNumber: Number.isFinite(Number(metadata.lastPumpScan.pumpNumber))
      ? Number(metadata.lastPumpScan.pumpNumber)
      : null,
    nozzlePublicId: String(metadata.lastPumpScan.nozzlePublicId || "").trim() || null,
    nozzleNumber: String(metadata.lastPumpScan.nozzleNumber || "").trim() || null,
    fuelType: String(metadata.lastPumpScan.fuelType || "").trim().toUpperCase() || null,
    scannedAt: toIsoOrNull(metadata.lastPumpScan.scannedAt),
  }
}

function extractPumpAssignment(metadata) {
  const attendantWorkflow = extractAttendantWorkflow(metadata)
  const workflowAssignment =
    attendantWorkflow?.pumpAssignment && typeof attendantWorkflow.pumpAssignment === "object"
      ? attendantWorkflow.pumpAssignment
      : null
  if (workflowAssignment?.pumpPublicId || workflowAssignment?.nozzlePublicId) {
    return {
      pumpPublicId: String(workflowAssignment.pumpPublicId || "").trim() || null,
      nozzlePublicId: String(workflowAssignment.nozzlePublicId || "").trim() || null,
      fuelType: String(workflowAssignment.fuelType || "").trim().toUpperCase() || null,
      confirmedAt: toIsoOrNull(workflowAssignment.confirmedAt),
    }
  }

  const lastPumpScan = extractLastPumpScan(metadata)
  if (!lastPumpScan?.pumpPublicId && !lastPumpScan?.nozzlePublicId) return null

  return {
    pumpPublicId: lastPumpScan?.pumpPublicId || null,
    nozzlePublicId: lastPumpScan?.nozzlePublicId || null,
    fuelType: lastPumpScan?.fuelType || null,
    confirmedAt: lastPumpScan?.scannedAt || null,
  }
}

function buildDerivedServiceRequest(metadata) {
  const attendantWorkflow = extractAttendantWorkflow(metadata)
  const workflowState = String(attendantWorkflow?.state || "").trim().toUpperCase()
  const dispensingStartedAt = toIsoOrNull(attendantWorkflow?.serviceStartedAt)
  if (!dispensingStartedAt && workflowState !== "DISPENSING") {
    return null
  }

  const pumpAssignment = extractPumpAssignment(metadata)
  if (!pumpAssignment?.pumpPublicId && !pumpAssignment?.nozzlePublicId) {
    return null
  }

  const paymentMode = extractQueuePaymentMode(metadata)
  return {
    liters: extractRequestedLiters(metadata),
    paymentMode,
    prepaySelected: paymentMode === "PREPAY",
    submittedAt: dispensingStartedAt || toIsoOrNull(pumpAssignment.confirmedAt),
    pumpSessionPublicId: String(attendantWorkflow?.pumpSession?.publicId || "").trim() || null,
    sessionReference: String(attendantWorkflow?.pumpSession?.sessionReference || "").trim() || null,
    telemetryCorrelationId: String(attendantWorkflow?.pumpSession?.telemetryCorrelationId || "").trim() || null,
    pumpPublicId: pumpAssignment.pumpPublicId,
    nozzlePublicId: pumpAssignment.nozzlePublicId,
    pricePerLitre: null,
    estimatedAmount: null,
    currencyCode: "MWK",
    paymentStatus: workflowState || "SUBMITTED",
    holdReference: null,
    walletTransactionReference: null,
    settlementBatchPublicId: null,
    walletAvailableBalanceAfterPayment: null,
    dispensingStartedAt,
    fuelType: pumpAssignment.fuelType,
    needsPaymentRecheck: false,
  }
}

function extractServiceRequest(metadata) {
  if (!metadata?.serviceRequest || typeof metadata.serviceRequest !== "object") {
    return buildDerivedServiceRequest(metadata)
  }
  const attendantWorkflow = extractAttendantWorkflow(metadata)
  const paymentMode = extractQueuePaymentMode(metadata)
  const liters =
    toPositiveNumberOrNull(metadata.serviceRequest.liters)
    ?? toPositiveNumberOrNull(metadata.serviceRequest.litres)
    ?? toPositiveNumberOrNull(metadata.serviceRequest.requestedLiters)
    ?? toPositiveNumberOrNull(metadata.serviceRequest.requestedLitres)
    ?? toPositiveNumberOrNull(metadata.requestedLiters)
    ?? toPositiveNumberOrNull(metadata.requestedLitres)
  return {
    liters,
    paymentMode,
    prepaySelected: paymentMode === "PREPAY",
    submittedAt: toIsoOrNull(metadata.serviceRequest.submittedAt),
    pumpSessionPublicId:
      String(metadata.serviceRequest.pumpSessionPublicId || attendantWorkflow?.pumpSession?.publicId || "").trim() || null,
    sessionReference:
      String(metadata.serviceRequest.sessionReference || attendantWorkflow?.pumpSession?.sessionReference || "").trim() || null,
    telemetryCorrelationId:
      String(metadata.serviceRequest.telemetryCorrelationId || attendantWorkflow?.pumpSession?.telemetryCorrelationId || "").trim() || null,
    pumpPublicId: String(metadata.serviceRequest.pumpPublicId || metadata.lastPumpScan?.pumpPublicId || "").trim() || null,
    nozzlePublicId: String(metadata.serviceRequest.nozzlePublicId || "").trim() || null,
    pricePerLitre: toPositiveNumberOrNull(metadata.serviceRequest.pricePerLitre),
    estimatedAmount:
      toPositiveNumberOrNull(metadata.serviceRequest.estimatedAmount)
      ?? toPositiveNumberOrNull(metadata.serviceRequest.amountMwk),
    currencyCode: String(metadata.serviceRequest.currencyCode || "MWK").trim() || "MWK",
    paymentStatus: String(metadata.serviceRequest.paymentStatus || "").trim().toUpperCase() || null,
    holdReference: String(metadata.serviceRequest.holdReference || "").trim() || null,
    walletTransactionReference: String(metadata.serviceRequest.walletTransactionReference || "").trim() || null,
    settlementBatchPublicId: String(metadata.serviceRequest.settlementBatchPublicId || "").trim() || null,
    walletAvailableBalanceAfterPayment: toNumberOrNull(metadata.serviceRequest.walletAvailableBalanceAfterPayment),
    dispensingStartedAt:
      toIsoOrNull(metadata.serviceRequest.dispensingStartedAt)
      || toIsoOrNull(attendantWorkflow.serviceStartedAt),
    fuelType: String(metadata.serviceRequest.fuelType || "").trim().toUpperCase() || null,
    needsPaymentRecheck: metadata.serviceRequest.needsPaymentRecheck === true,
  }
}

async function getLiveDispensingProgress({ stationId, serviceRequest, lastPumpScan }) {
  if (!serviceRequest) return null
  if (!serviceRequest.dispensingStartedAt) return null

  const pumpSessionPublicId = String(serviceRequest.pumpSessionPublicId || "").trim()
  const sessionReference = String(serviceRequest.sessionReference || "").trim()
  const scopedTelemetryCorrelationId = String(serviceRequest.telemetryCorrelationId || "").trim()
  const nozzlePublicId =
    String(serviceRequest.nozzlePublicId || "").trim()
    || String(lastPumpScan?.nozzlePublicId || "").trim()
    || ""
  const pumpPublicId =
    String(serviceRequest.pumpPublicId || "").trim()
    || String(lastPumpScan?.pumpPublicId || "").trim()
    || ""

  if (!nozzlePublicId && !pumpPublicId) return null

  const dispensingStartedAtMs = toTimeMs(serviceRequest.dispensingStartedAt)
  const timeFloor = Number.isFinite(dispensingStartedAtMs)
    ? new Date(dispensingStartedAtMs)
    : new Date(Date.now() - 12 * 60 * 60 * 1000)

  const exactSessionRows =
    pumpSessionPublicId || sessionReference || scopedTelemetryCorrelationId
      ? await prisma.$queryRaw`
          SELECT
            ps.id,
            ps.session_status,
            ps.dispensed_litres,
            ps.session_reference,
            ps.telemetry_correlation_id,
            ps.start_time,
            ps.end_time,
            ps.updated_at
          FROM pump_sessions ps
          WHERE ps.station_id = ${stationId}
            AND (
              (${pumpSessionPublicId} <> '' AND ps.public_id = ${pumpSessionPublicId})
              OR (${sessionReference} <> '' AND ps.session_reference = ${sessionReference})
              OR (${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId})
            )
          ORDER BY
            CASE
              WHEN ${pumpSessionPublicId} <> '' AND ps.public_id = ${pumpSessionPublicId} THEN 0
              WHEN ${sessionReference} <> '' AND ps.session_reference = ${sessionReference} THEN 1
              WHEN ${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId} THEN 2
              ELSE 3
            END,
            COALESCE(ps.updated_at, ps.end_time, ps.start_time, ps.created_at) DESC,
            ps.id DESC
          LIMIT 1
        `
      : []

  const sessionRows = exactSessionRows?.[0]?.id
    ? exactSessionRows
    : await prisma.$queryRaw`
        SELECT
          ps.id,
          ps.session_status,
          ps.dispensed_litres,
          ps.session_reference,
          ps.telemetry_correlation_id,
          ps.start_time,
          ps.end_time,
          ps.updated_at
        FROM pump_sessions ps
        LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
        LEFT JOIN pumps p ON p.id = ps.pump_id
        WHERE ps.station_id = ${stationId}
          AND (
            (${nozzlePublicId} <> '' AND pn.public_id = ${nozzlePublicId})
            OR (${pumpPublicId} <> '' AND p.public_id = ${pumpPublicId})
          )
          AND ps.session_status IN ('STARTED', 'DISPENSING')
          AND COALESCE(ps.start_time, ps.updated_at, ps.created_at) >= ${timeFloor}
        ORDER BY
          CASE ps.session_status
            WHEN 'DISPENSING' THEN 0
            WHEN 'STARTED' THEN 1
            ELSE 4
          END,
          COALESCE(ps.updated_at, ps.end_time, ps.start_time, ps.created_at) DESC,
          ps.id DESC
        LIMIT 1
      `

  const session = sessionRows?.[0] || null
  const sessionId = Number(session?.id || 0) || 0
  const telemetryCorrelationId = String(session?.telemetry_correlation_id || "").trim()
  const telemetryFloor =
    toIsoOrNull(session?.start_time)
      ? new Date(String(session.start_time))
      : timeFloor

  const stopRows = await prisma.$queryRaw`
    SELECT
      ptl.litres_value,
      JSON_UNQUOTE(JSON_EXTRACT(ptl.payload_json, '$.litresValue')) AS payload_litres_value,
      JSON_UNQUOTE(JSON_EXTRACT(ptl.payload_json, '$.litersValue')) AS payload_liters_value,
      JSON_UNQUOTE(JSON_EXTRACT(ptl.payload_json, '$.dispensedLitres')) AS payload_dispensed_litres,
      JSON_UNQUOTE(JSON_EXTRACT(ptl.payload_json, '$.dispensed_litres')) AS payload_dispensed_litres_snake,
      ptl.happened_at
    FROM pump_telemetry_logs ptl
    LEFT JOIN pump_nozzles pn ON pn.id = ptl.nozzle_id
    LEFT JOIN pumps p ON p.id = ptl.pump_id
    WHERE ptl.station_id = ${stationId}
      AND (
        (${sessionId} > 0 AND ptl.pump_session_id = ${sessionId})
        OR (${telemetryCorrelationId} <> '' AND ptl.telemetry_correlation_id = ${telemetryCorrelationId})
        OR (
          ${sessionId} <= 0
          AND ${telemetryCorrelationId} = ''
          AND (
            (${nozzlePublicId} <> '' AND pn.public_id = ${nozzlePublicId})
            OR (${pumpPublicId} <> '' AND p.public_id = ${pumpPublicId})
          )
        )
      )
      AND UPPER(COALESCE(ptl.event_type, '')) = 'DISPENSING_STOPPED'
      AND ptl.happened_at >= ${telemetryFloor}
    ORDER BY ptl.happened_at DESC, ptl.id DESC
    LIMIT 1
  `
  const stopEvent = stopRows?.[0] || null
  const rawSessionStatus = String(session?.session_status || "").trim().toUpperCase() || null
  const hasActiveSession = ["STARTED", "DISPENSING"].includes(rawSessionStatus || "")
  const stopBoundaryAt = stopEvent?.happened_at ? new Date(String(stopEvent.happened_at)) : null
  const effectiveTelemetryFloor =
    !hasActiveSession && stopBoundaryAt && stopBoundaryAt.getTime() > telemetryFloor.getTime()
      ? stopBoundaryAt
      : telemetryFloor

  const telemetryRows = await prisma.$queryRaw`
    SELECT
      ptl.litres_value,
      ptl.happened_at
    FROM pump_telemetry_logs ptl
    LEFT JOIN pump_nozzles pn ON pn.id = ptl.nozzle_id
    LEFT JOIN pumps p ON p.id = ptl.pump_id
    WHERE ptl.station_id = ${stationId}
      AND ptl.litres_value IS NOT NULL
      AND (
        (${sessionId} > 0 AND ptl.pump_session_id = ${sessionId})
        OR (${telemetryCorrelationId} <> '' AND ptl.telemetry_correlation_id = ${telemetryCorrelationId})
        OR (
          ${sessionId} <= 0
          AND ${telemetryCorrelationId} = ''
          AND (
            (${nozzlePublicId} <> '' AND pn.public_id = ${nozzlePublicId})
            OR (${pumpPublicId} <> '' AND p.public_id = ${pumpPublicId})
          )
        )
      )
      AND ptl.happened_at > ${effectiveTelemetryFloor}
    ORDER BY ptl.happened_at DESC, ptl.id DESC
    LIMIT 1
  `

  const telemetry = telemetryRows?.[0] || null
  const sessionStatus =
    rawSessionStatus === "DISPENSING_STOPPED"
      ? "COMPLETED"
      : rawSessionStatus || (stopEvent ? derivePumpSessionStatusFromTelemetryEvent("DISPENSING_STOPPED") : null)
  const sessionDispensedLitres = toPositiveNumberOrNull(session?.dispensed_litres) ?? 0
  const stopDispensedLitres =
    toPositiveNumberOrNull(stopEvent?.litres_value)
    ?? toPositiveNumberOrNull(stopEvent?.payload_litres_value)
    ?? toPositiveNumberOrNull(stopEvent?.payload_liters_value)
    ?? toPositiveNumberOrNull(stopEvent?.payload_dispensed_litres)
    ?? toPositiveNumberOrNull(stopEvent?.payload_dispensed_litres_snake)
  const telemetryDispensedLitres = toPositiveNumberOrNull(telemetry?.litres_value)
  const dispensedLitres = stopDispensedLitres ?? telemetryDispensedLitres ?? sessionDispensedLitres ?? 0
  const isTerminalSession = ["COMPLETED", "FAILED", "CANCELLED"].includes(sessionStatus || "")

  return {
    dispensedLitres,
    sessionStatus,
    sessionReference: String(session?.session_reference || "").trim() || null,
    updatedAt: toIsoOrNull(
      stopEvent?.happened_at
      || telemetry?.happened_at
      || session?.end_time
      || session?.updated_at
      || session?.start_time
    ),
    isDispensing:
      !isTerminalSession
      && (
        hasActiveSession
        || (!stopEvent && dispensedLitres > 0 && Boolean(serviceRequest.dispensingStartedAt))
      ),
  }
}

async function getAverageLitersPerCar({ stationId, fuelType, settings }) {
  const rows = await prisma.$queryRaw`
    SELECT litres
    FROM transactions tx
    INNER JOIN fuel_types ft ON ft.id = tx.fuel_type_id
    WHERE tx.station_id = ${stationId}
      AND ft.code = ${fuelType}
      AND tx.litres > 0
    ORDER BY tx.occurred_at DESC, tx.id DESC
    LIMIT ${RECENT_TX_MEDIAN_LIMIT}
  `

  const median = computeMedian((rows || []).map((row) => row.litres))
  if (median !== null) {
    return { value: median, source: "median_tx" }
  }

  const stationConfigured = readStationAvgFromSettings(settings, fuelType)
  if (stationConfigured !== null) {
    return { value: stationConfigured, source: "station_config" }
  }

  return { value: defaultAvgByFuelType(fuelType), source: "default" }
}

async function getFuelTelemetryForQueueGuarantee({ stationId, fuelType, etaMinutes }) {
  const notes = []
  const today = appTodayISO() || "1970-01-01"
  const rangeFromDt = `${today} 00:00:00`
  const rangeToDt = `${today} 23:59:59`

  // Use the same data source pattern as manager reports reconciliation (today window).
  const tankRows = await prisma.$queryRaw`
    SELECT
      t.id AS tank_id,
      t.capacity_litres AS capacity_litres,
      COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) AS opening_litres,
      COALESCE(opening.opening_time, fallback_opening.fallback_opening_time) AS opening_time,
      COALESCE(del.delivery_litres, 0) AS delivered_litres,
      del.last_delivery_at AS last_delivery_at,
      closing.closing_litres AS closing_litres,
      closing.closing_time AS closing_time,
      COALESCE(tx.recorded_litres, 0) AS recorded_litres,
      tx.last_tx_at AS last_tx_at
    FROM tanks t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN (
      SELECT ir.tank_id, ir.litres AS opening_litres, ir.reading_time AS opening_time
      FROM inventory_readings ir
      INNER JOIN (
        SELECT tank_id, MIN(reading_time) AS reading_time
        FROM inventory_readings
        WHERE station_id = ${stationId}
          AND reading_type = 'OPENING'
          AND reading_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
        GROUP BY tank_id
      ) first_opening
        ON first_opening.tank_id = ir.tank_id
       AND first_opening.reading_time = ir.reading_time
      WHERE ir.station_id = ${stationId}
        AND ir.reading_type = 'OPENING'
    ) opening ON opening.tank_id = t.id
    LEFT JOIN (
      SELECT ir.tank_id, ir.litres AS fallback_opening_litres, ir.reading_time AS fallback_opening_time
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
      SELECT tank_id, SUM(litres) AS delivery_litres, MAX(delivered_time) AS last_delivery_at
      FROM fuel_deliveries
      WHERE station_id = ${stationId}
        AND delivered_time BETWEEN ${rangeFromDt} AND ${rangeToDt}
      GROUP BY tank_id
    ) del ON del.tank_id = t.id
    LEFT JOIN (
      SELECT ir.tank_id, ir.litres AS closing_litres, ir.reading_time AS closing_time
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
        SUM(tx.litres) AS recorded_litres,
        MAX(tx.occurred_at) AS last_tx_at
      FROM transactions tx
      LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
      LEFT JOIN pumps p ON p.id = tx.pump_id
      LEFT JOIN fuel_types ftx ON ftx.id = tx.fuel_type_id
      WHERE tx.station_id = ${stationId}
        AND tx.occurred_at BETWEEN ${rangeFromDt} AND ${rangeToDt}
        AND ftx.code = ${fuelType}
      GROUP BY COALESCE(pn.tank_id, p.tank_id)
    ) tx ON tx.tank_id = t.id
    WHERE t.station_id = ${stationId}
      AND t.is_active = 1
      AND ft.code = ${fuelType}
    ORDER BY t.id ASC
  `

  const totalActiveTanks = Number(tankRows?.length || 0)
  const totalFuelCapacityLiters = (tankRows || []).reduce((sum, row) => {
    const capacity = toPositiveNumberOrNull(row.capacity_litres)
    if (capacity === null) return sum
    return sum + capacity
  }, 0)
  if (totalActiveTanks <= 0) {
    pushUniqueNote(notes, "fuel_data_missing")
    return {
      fuelRemainingLiters: null,
      effectiveFuelLiters: null,
      fuelCapacityLiters: null,
      fuelRemainingPercent: null,
      effectiveFuelPercent: null,
      fuelLastUpdatedAt: null,
      unknownSeverity: "very_uncertain",
      notes,
      refillBoostApplied: false,
      refillConfidence: null,
    }
  }

  const normalizedRows = (tankRows || [])
    .map((row) => {
      const tankId = Number(row.tank_id || 0)
      const openingLiters = toNumberOrNull(row.opening_litres)
      const closingLiters = toNumberOrNull(row.closing_litres)
      const deliveredLitres = toNumberOrNull(row.delivered_litres) || 0
      const recordedLitres = toNumberOrNull(row.recorded_litres) || 0
      const liveTankLevelLitres = openingLiters !== null
        ? Math.max(0, openingLiters + deliveredLitres - recordedLitres)
        : null
      const tankLevelLiters = liveTankLevelLitres !== null
        ? liveTankLevelLitres
        : (closingLiters !== null ? Math.max(0, closingLiters) : null)

      return {
        tankId,
        tankLevelLiters,
        openingTime: toIsoOrNull(row.opening_time),
        closingTime: toIsoOrNull(row.closing_time),
        lastDeliveryAt: toIsoOrNull(row.last_delivery_at),
        lastTxAt: toIsoOrNull(row.last_tx_at),
      }
    })
    .filter((row) => Number.isFinite(row.tankId) && row.tankId > 0)

  const rowsWithFuelLevel = normalizedRows.filter((row) => row.tankLevelLiters !== null)
  if (!rowsWithFuelLevel.length) {
    pushUniqueNote(notes, "fuel_data_missing")
    return {
      fuelRemainingLiters: null,
      effectiveFuelLiters: null,
      fuelCapacityLiters: totalFuelCapacityLiters > 0 ? Number(totalFuelCapacityLiters.toFixed(3)) : null,
      fuelRemainingPercent: null,
      effectiveFuelPercent: null,
      fuelLastUpdatedAt: null,
      unknownSeverity: "very_uncertain",
      notes,
      refillBoostApplied: false,
      refillConfidence: null,
    }
  }

  if (rowsWithFuelLevel.length < totalActiveTanks) {
    pushUniqueNote(notes, "fuel_data_partial")
  }

  let totalRemaining = rowsWithFuelLevel.reduce((sum, row) => sum + Number(row.tankLevelLiters || 0), 0)
  let lastUpdatedMs = NaN

  for (const row of rowsWithFuelLevel) {
    lastUpdatedMs = Math.max(
      lastUpdatedMs,
      toTimeMs(row.openingTime),
      toTimeMs(row.closingTime),
      toTimeMs(row.lastDeliveryAt),
      toTimeMs(row.lastTxAt),
    )
  }

  const fuelRemainingLiters = Math.max(0, Number(totalRemaining.toFixed(3)))
  let effectiveFuelLiters = fuelRemainingLiters
  let refillBoostApplied = false
  let refillConfidence = null
  const fuelCapacityLiters = totalFuelCapacityLiters > 0 ? Number(totalFuelCapacityLiters.toFixed(3)) : null

  const eta = Math.max(0, Math.round(Number(etaMinutes || 0)))
  const refillWindowMinutes = eta + 10
  if (refillWindowMinutes > 0) {
    const refillRows = await prisma.$queryRaw`
      SELECT
        MIN(fd.delivered_time) AS next_refill_eta,
        COALESCE(SUM(fd.litres), 0) AS incoming_litres
      FROM fuel_deliveries fd
      INNER JOIN tanks t ON t.id = fd.tank_id
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      WHERE fd.station_id = ${stationId}
        AND ft.code = ${fuelType}
        AND fd.delivered_time >= CURRENT_TIMESTAMP(3)
        AND fd.delivered_time <= DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${refillWindowMinutes} MINUTE)
    `

    const incomingLitres = toNumberOrNull(refillRows?.[0]?.incoming_litres) || 0
    if (incomingLitres > 0) {
      refillBoostApplied = true
      refillConfidence = REFILL_CONFIDENCE
      effectiveFuelLiters = Number((fuelRemainingLiters + incomingLitres * REFILL_CONFIDENCE).toFixed(3))
      pushUniqueNote(notes, "refill_boost_applied")
      lastUpdatedMs = Math.max(lastUpdatedMs, toTimeMs(refillRows?.[0]?.next_refill_eta))
    }
  }

  const fuelRemainingPercent =
    fuelCapacityLiters && fuelCapacityLiters > 0
      ? Math.max(0, Math.min(100, Number(((fuelRemainingLiters / fuelCapacityLiters) * 100).toFixed(1))))
      : null
  const effectiveFuelPercent =
    fuelCapacityLiters && fuelCapacityLiters > 0
      ? Math.max(0, Math.min(100, Number(((effectiveFuelLiters / fuelCapacityLiters) * 100).toFixed(1))))
      : null

  return {
    fuelRemainingLiters,
    effectiveFuelLiters,
    fuelCapacityLiters,
    fuelRemainingPercent,
    effectiveFuelPercent,
    fuelLastUpdatedAt: Number.isFinite(lastUpdatedMs) ? new Date(lastUpdatedMs).toISOString() : null,
    unknownSeverity: rowsWithFuelLevel.length < totalActiveTanks ? "moderate" : "very_uncertain",
    notes,
    refillBoostApplied,
    refillConfidence,
  }
}

async function getQueueEntryOrThrow(queueJoinId) {
  const rows = await prisma.$queryRaw`
    SELECT
      qe.id,
      qe.public_id,
      qe.station_id,
      qe.user_id,
      qe.position,
      qe.status,
      qe.joined_at,
      qe.called_at,
      qe.last_moved_at,
      qe.metadata,
      ft.code AS fuel_type,
      st.public_id AS station_public_id,
      st.name AS station_name,
      st.operator_name AS station_brand,
      COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
    FROM queue_entries qe
    INNER JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    INNER JOIN stations st ON st.id = qe.station_id
    WHERE qe.public_id = ${queueJoinId}
    LIMIT 1
  `

  const row = rows?.[0]
  if (!row) throw notFound("Queue entry not found")
  return row
}

export async function buildUserQueueStatusSnapshot({ queueJoinId, auth = null }) {
  const entry = await getQueueEntryOrThrow(queueJoinId)
  ensureQueueEntryAccess(entry, auth)

  const [summaryRows, settings, averageServiceMinutes, stationStatus] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(status IN ('WAITING', 'CALLED', 'LATE')), 0) AS total_queued,
        COALESCE(SUM((status IN ('WAITING', 'CALLED', 'LATE')) AND position < ${entry.position}), 0) AS cars_ahead,
        MIN(CASE WHEN status = 'CALLED' THEN position END) AS now_serving,
        MAX(last_moved_at) AS last_movement_at
      FROM queue_entries
      WHERE station_id = ${entry.station_id}
    `,
    getQueueSettings(entry.station_id),
    getAverageServiceMinutes(entry.station_id),
    getStationStatusBreakdown(entry.station_id),
  ])

  const summary = summaryRows?.[0] || {}
  const metadata = parseJson(entry.metadata)
  const queueIsActive = ACTIVE_QUEUE_STATUSES.includes(String(entry.status || "").toUpperCase())
  const carsAhead = queueIsActive ? Number(summary.cars_ahead || 0) : 0
  const totalQueued = Number(summary.total_queued || 0)
  const nowServing = summary.now_serving === null || summary.now_serving === undefined
    ? null
    : Number(summary.now_serving)
  const lastMovementAt = toIsoOrNull(summary.last_movement_at || entry.last_moved_at || entry.joined_at)
  const pauseReason = typeof metadata.pauseReason === "string" && metadata.pauseReason.trim()
    ? metadata.pauseReason.trim()
    : Number(settings?.joins_paused || 0)
      ? "Queue joins are temporarily paused."
      : null
  const expectedResumeAt = toIsoOrNull(metadata.expectedResumeAt)
  const movementState = toQueueMovementState({
    joinsPaused: Boolean(Number(settings?.joins_paused || 0)),
    pauseReason,
    lastMovementAt,
  })

  let etaMinutes = 0
  if (queueIsActive) {
    const queueSteps = carsAhead + (String(entry.status || "").toUpperCase() === "CALLED" ? 0 : 1)
    const adjustment = movementState === "paused" ? 1.8 : movementState === "slow" ? 1.3 : 1
    etaMinutes = Math.max(1, Math.round(queueSteps * averageServiceMinutes * adjustment))
  }

  const qrPayload = typeof metadata.qrPayload === "string" && metadata.qrPayload.trim()
    ? metadata.qrPayload.trim()
    : buildQrPayload(entry.public_id, entry.station_public_id, entry.fuel_type)
  const verifiedPump = metadata?.lastPumpScan && typeof metadata.lastPumpScan === "object"
    ? {
      pumpPublicId: String(metadata.lastPumpScan.pumpPublicId || "").trim() || null,
      pumpNumber: Number.isFinite(Number(metadata.lastPumpScan.pumpNumber))
        ? Number(metadata.lastPumpScan.pumpNumber)
        : null,
      pumpStatus: String(metadata.lastPumpScan.pumpStatus || "").trim().toUpperCase() || null,
      nozzlePublicId: String(metadata.lastPumpScan.nozzlePublicId || "").trim() || null,
      nozzleNumber: String(metadata.lastPumpScan.nozzleNumber || "").trim() || null,
      nozzleStatus: String(metadata.lastPumpScan.nozzleStatus || "").trim().toUpperCase() || null,
      fuelType: String(metadata.lastPumpScan.fuelType || "").trim().toUpperCase() || null,
      scannedAt: toIsoOrNull(metadata.lastPumpScan.scannedAt),
    }
    : null

  const requestedLiters = extractRequestedLiters(metadata)
  const paymentMode = extractQueuePaymentMode(metadata)
  const serviceRequest = extractServiceRequest(metadata)
  const lastPumpScan = extractLastPumpScan(metadata)
  const [avgLiters, fuelTelemetry, liveDispensingProgress] = await Promise.all([
    getAverageLitersPerCar({
      stationId: entry.station_id,
      fuelType: entry.fuel_type,
      settings,
    }),
    getFuelTelemetryForQueueGuarantee({
      stationId: entry.station_id,
      fuelType: entry.fuel_type,
      etaMinutes,
    }),
    getLiveDispensingProgress({
      stationId: entry.station_id,
      serviceRequest,
      lastPumpScan,
    }),
  ])

  const guarantee = {
    ...computeFuelGuarantee(
      {
        carsAhead,
        avgLitersPerCar: avgLiters.value,
        requestedLiters,
        fuelRemainingLiters: fuelTelemetry.fuelRemainingLiters,
        effectiveFuelLiters: fuelTelemetry.effectiveFuelLiters,
        fuelLastUpdatedAt: fuelTelemetry.fuelLastUpdatedAt,
        avgSource: avgLiters.source,
        notes: fuelTelemetry.notes,
        unknownSeverity: fuelTelemetry.unknownSeverity,
        maxLitersPerCarCap: readRationCapFromSettings(settings, entry.fuel_type),
        refillBoostApplied: fuelTelemetry.refillBoostApplied,
      },
      FUEL_GUARANTEE_CONFIG
    ),
    fuelCapacityLiters: fuelTelemetry.fuelCapacityLiters ?? null,
    fuelRemainingPercent: fuelTelemetry.fuelRemainingPercent ?? null,
    effectiveFuelPercent: fuelTelemetry.effectiveFuelPercent ?? null,
    refillBoostApplied: Boolean(fuelTelemetry.refillBoostApplied),
    refillConfidence: fuelTelemetry.refillBoostApplied
      ? Number(fuelTelemetry.refillConfidence || REFILL_CONFIDENCE)
      : null,
  }

  return {
    queueJoinId: entry.public_id,
    queueStatus: entry.status,
    station: {
      id: entry.station_public_id,
      name: entry.station_name,
      area: entry.station_area || "Station Area",
      brand: entry.station_brand || null,
    },
    fuelType: entry.fuel_type,
    position: queueIsActive ? Number(entry.position) : null,
    carsAhead,
    totalQueued,
    etaMinutes,
    nowServing,
    lastMovementAt,
    movementState,
    pauseReason,
    expectedResumeAt,
    guaranteeState: guarantee.state,
    fuelRemainingLiters: guarantee.fuelRemainingLiters,
    fuelRemainingPercent: guarantee.fuelRemainingPercent,
    guarantee,
    qrPayload,
    verifiedPump,
    stationStatus,
    requestedLiters,
    paymentMode,
    serviceRequest: serviceRequest
      ? {
        ...serviceRequest,
        dispensedLitres: liveDispensingProgress?.dispensedLitres ?? 0,
        dispensedAmount:
          liveDispensingProgress?.dispensedLitres && serviceRequest.pricePerLitre
            ? Number((liveDispensingProgress.dispensedLitres * serviceRequest.pricePerLitre).toFixed(2))
            : 0,
        dispensingActive: liveDispensingProgress?.isDispensing === true,
        dispensingProgressPercent:
          liveDispensingProgress?.dispensedLitres && serviceRequest.liters
            ? Math.max(
              0,
              Math.min(100, Math.round((liveDispensingProgress.dispensedLitres / serviceRequest.liters) * 100))
            )
            : 0,
        liveUpdatedAt: liveDispensingProgress?.updatedAt || null,
        pumpSessionStatus: liveDispensingProgress?.sessionStatus || null,
        pumpSessionReference: liveDispensingProgress?.sessionReference || null,
      }
      : null,
  }
}

export function toQueueRealtimeEvents(snapshot) {
  return [
    {
      type: "queue:update",
      data: {
        queueJoinId: snapshot.queueJoinId,
        queueStatus: snapshot.queueStatus,
        position: snapshot.position,
        carsAhead: snapshot.carsAhead,
        totalQueued: snapshot.totalQueued,
        etaMinutes: snapshot.etaMinutes,
      },
    },
    {
      type: "queue:movement",
      data: {
        nowServing: snapshot.nowServing,
        lastMovementAt: snapshot.lastMovementAt,
        movementState: snapshot.movementState,
        pauseReason: snapshot.pauseReason,
        expectedResumeAt: snapshot.expectedResumeAt,
      },
    },
    {
      type: "station:status",
      data: snapshot.stationStatus || null,
    },
    {
      type: "queue:fuel",
      data: {
        fuelRemainingLiters: snapshot.fuelRemainingLiters,
        fuelRemainingPercent: snapshot.fuelRemainingPercent ?? null,
        guaranteeState: snapshot.guaranteeState,
        guarantee: snapshot.guarantee || null,
      },
    },
  ]
}

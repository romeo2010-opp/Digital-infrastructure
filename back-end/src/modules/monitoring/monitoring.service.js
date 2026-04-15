import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { publishMonitoringUpdate } from "../../realtime/monitoringHub.js"
import { publishStationChange } from "../../realtime/stationChangesHub.js"
import { zonedSqlDateTimeToUtcIso } from "../../utils/dateTime.js"
import { createPublicId, createTransactionPublicIdValue, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { linkTransactionToPumpSession } from "./pumpSessionLink.service.js"

const IDLE_AFTER_MS = Math.max(
  5000,
  Number(process.env.MONITORING_IDLE_AFTER_MS || process.env.MONITORING_OFFLINE_AFTER_MS || 45000)
)
const SWEEP_INTERVAL_MS = Math.max(1000, Number(process.env.MONITORING_SWEEP_INTERVAL_MS || 5000))
const DB_REFRESH_INTERVAL_MS = Math.max(2000, Number(process.env.MONITORING_DB_REFRESH_MS || 15000))
const NOZZLE_DB_STATUS_VALUES = new Set(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"])
const PUMP_DB_STATUS_VALUES = new Set(["ACTIVE", "PAUSED", "OFFLINE"])
const TELEMETRY_SEVERITY_VALUES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
const TERMINAL_PUMP_SESSION_STATUSES = new Set(["FAILED", "COMPLETED", "CANCELLED"])
const PUMP_SESSION_STATUS_RANK = Object.freeze({
  CREATED: 0,
  STARTED: 1,
  DISPENSING: 2,
  COMPLETED: 3,
  FAILED: 3,
  CANCELLED: 3,
})

const stateByPumpKey = new Map()

function toPumpKey(stationId, pumpPublicId) {
  const stationKey = String(stationId || "").trim()
  const pumpKey = String(pumpPublicId || "").trim()
  if (!stationKey || !pumpKey) return null
  return `${stationKey}:${pumpKey}`
}

function parseFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === "object") {
    if (Array.isArray(value?.d) && value.d.length) {
      const parsed = Number(value.d[0])
      return Number.isFinite(parsed) ? parsed : null
    }
    if (typeof value?.value === "number" || typeof value?.value === "string") {
      const parsed = Number(value.value)
      return Number.isFinite(parsed) ? parsed : null
    }
    if (typeof value?.toString === "function") {
      const parsed = Number(value.toString())
      return Number.isFinite(parsed) ? parsed : null
    }
  }
  return null
}

export function resolveTelemetryLitresValue({
  litresValue = null,
  dispensedLitres = null,
  payload = null,
} = {}) {
  const directLitresValue = parseFiniteNumber(litresValue)
  if (directLitresValue !== null) return directLitresValue

  const directDispensedLitres = parseFiniteNumber(dispensedLitres)
  if (directDispensedLitres !== null) return directDispensedLitres

  if (!payload || typeof payload !== "object") return null

  const payloadCandidates = [
    payload.litresValue,
    payload.litersValue,
    payload.dispensedLitres,
    payload.dispensed_litres,
    payload.totalLitres,
    payload.total_litres,
  ]
  for (const candidate of payloadCandidates) {
    const parsed = parseFiniteNumber(candidate)
    if (parsed !== null) return parsed
  }

  return null
}

export function normalizeMonitoringStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "DISPENSING") return "DISPENSING"
  if (normalized === "OFFLINE") return "OFFLINE"
  if (["IDLE", "ACTIVE", "PAUSED"].includes(normalized)) return "IDLE"
  return "IDLE"
}

function normalizeNozzleDbStatus(status, fallback = "ACTIVE") {
  const normalized = String(status || "").trim().toUpperCase()
  if (NOZZLE_DB_STATUS_VALUES.has(normalized)) return normalized
  return fallback
}

function normalizePumpDbStatus(status, fallback = "ACTIVE") {
  const normalized = String(status || "").trim().toUpperCase()
  if (PUMP_DB_STATUS_VALUES.has(normalized)) return normalized
  return fallback
}

export function monitoringStatusToNozzleDbStatus(status) {
  if (status === "DISPENSING") return "DISPENSING"
  if (status === "OFFLINE") return "OFFLINE"
  return "ACTIVE"
}

export function normalizeMonitoringLitres(status, litres) {
  if (status !== "DISPENSING") return null
  const parsed = parseFiniteNumber(litres)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function normalizeTelemetryEventType(eventType) {
  const normalized = String(eventType || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized || "STATUS_UPDATE"
}

export function normalizeTelemetrySeverity(severity) {
  const normalized = String(severity || "").trim().toUpperCase()
  if (normalized === "MEDIUM") return "MEDIUM"
  if (TELEMETRY_SEVERITY_VALUES.has(normalized)) return normalized
  return "INFO"
}

export function normalizeTelemetrySourceType(sourceType) {
  const normalized = String(sourceType || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized || "PUMP_CONTROLLER"
}

export function derivePumpSessionStatusFromTelemetryEvent(eventType) {
  const normalized = normalizeTelemetryEventType(eventType)
  if (["DISPENSING_STOPPED", "DISPENSE_COMPLETED", "SESSION_COMPLETED", "NOZZLE_REPLACED"].includes(normalized)) {
    return "COMPLETED"
  }
  if (["ERROR", "TIMEOUT", "SESSION_FAILED", "ABORTED", "FLOW_TIMEOUT", "CONTROLLER_ERROR"].includes(normalized)) {
    return "FAILED"
  }
  if (normalized.includes("DISPENS") || normalized === "FLOW_READING") {
    return "DISPENSING"
  }
  if (["NOZZLE_LIFTED", "AUTHORIZED", "SESSION_STARTED", "READY"].includes(normalized)) {
    return "STARTED"
  }
  return "CREATED"
}

function choosePumpSessionStatus(currentStatus, nextStatus) {
  const current = String(currentStatus || "").trim().toUpperCase() || "CREATED"
  const next = String(nextStatus || "").trim().toUpperCase() || "CREATED"
  if (TERMINAL_PUMP_SESSION_STATUSES.has(current)) return current

  const currentRank = PUMP_SESSION_STATUS_RANK[current] ?? 0
  const nextRank = PUMP_SESSION_STATUS_RANK[next] ?? 0
  return nextRank >= currentRank ? next : current
}

function parseTelemetryTimestamp(value) {
  if (!value) return new Date()
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid telemetry happenedAt timestamp")
  }
  return parsed
}

function buildTelemetryMessage(eventType, message) {
  const scopedMessage = String(message || "").trim()
  if (scopedMessage) return scopedMessage
  return `${normalizeTelemetryEventType(eventType).replaceAll("_", " ")} event ingested.`
}

export function resolvePumpSessionTelemetryCorrelationId({
  sessionTelemetryCorrelationId = "",
  telemetryCorrelationId = "",
} = {}) {
  const existing = String(sessionTelemetryCorrelationId || "").trim()
  if (existing) return existing

  const incoming = String(telemetryCorrelationId || "").trim()
  if (incoming) return incoming

  return `TEL-${createPublicId()}`
}

export function canFallbackToScopedPumpSessionLookup({
  sessionPublicId = "",
  sessionReference = "",
} = {}) {
  return !String(sessionPublicId || "").trim() && !String(sessionReference || "").trim()
}

function toJsonString(value) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return "{}"
  }
}

export function shouldCreateDispensingTransaction({ previousStatus, nextStatus, litres }) {
  if (nextStatus !== "DISPENSING") return false
  if (previousStatus === "DISPENSING") return false
  const parsedLitres = parseFiniteNumber(litres)
  return Number.isFinite(parsedLitres) && parsedLitres > 0
}

export function derivePumpMonitoringStatus(nozzles = []) {
  if (!Array.isArray(nozzles) || nozzles.length === 0) return "OFFLINE"
  if (nozzles.some((nozzle) => nozzle?.status === "DISPENSING")) return "DISPENSING"
  if (nozzles.every((nozzle) => nozzle?.status === "OFFLINE")) return "OFFLINE"
  return "IDLE"
}

export function derivePumpDbStatusFromNozzles(nozzles = []) {
  if (!Array.isArray(nozzles) || nozzles.length === 0) return "OFFLINE"
  if (nozzles.every((nozzle) => nozzle?.status === "OFFLINE")) return "OFFLINE"
  return "ACTIVE"
}

function sortNozzles(a, b) {
  return String(a.nozzleLabel || "").localeCompare(String(b.nozzleLabel || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function buildNozzleState(row, fallbackUpdatedAt, stationTimeZone) {
  const updatedAt =
    zonedSqlDateTimeToUtcIso(row?.updated_at_local || row?.updated_at, stationTimeZone) || fallbackUpdatedAt
  const status = normalizeMonitoringStatus(row?.status)
  return {
    nozzleId: row.public_id,
    nozzleLabel: String(row.nozzle_number || row.public_id || "-"),
    product: row.fuel_code || row.fuel_name || null,
    status,
    litres: normalizeMonitoringLitres(status, null),
    updatedAt,
    _dbStatus: normalizeNozzleDbStatus(row?.status),
  }
}

function toPublicNozzle(nozzleState) {
  return {
    nozzleId: nozzleState.nozzleId,
    nozzleLabel: nozzleState.nozzleLabel,
    product: nozzleState.product,
    status: nozzleState.status,
    litres: nozzleState.litres,
    updatedAt: nozzleState.updatedAt,
  }
}

function newestTimestamp(nozzles = []) {
  let newest = 0
  for (const nozzle of nozzles) {
    const ts = Date.parse(nozzle?.updatedAt || "")
    if (Number.isFinite(ts) && ts > newest) newest = ts
  }
  return newest ? new Date(newest).toISOString() : new Date().toISOString()
}

function toSnapshot(state) {
  const nozzles = [...state.nozzles.values()].sort(sortNozzles).map(toPublicNozzle)
  return {
    pumpId: state.pumpId,
    pumpLabel: state.pumpLabel,
    pumpNumber: state.pumpNumber,
    status: derivePumpMonitoringStatus(nozzles),
    lastUpdateAt: newestTimestamp(nozzles),
    nozzles,
  }
}

function buildUpdatePayload(state, nozzleState) {
  const snapshot = toSnapshot(state)
  return {
    pumpId: state.pumpId,
    nozzleId: nozzleState.nozzleId,
    nozzleLabel: nozzleState.nozzleLabel,
    product: nozzleState.product,
    status: nozzleState.status,
    litres: nozzleState.litres,
    updatedAt: nozzleState.updatedAt,
    pumpStatus: snapshot.status,
    lastUpdateAt: snapshot.lastUpdateAt,
  }
}

function applyIdleFallbackTransitions(state) {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const changedNozzles = []

  for (const nozzleState of state.nozzles.values()) {
    const updatedMs = Date.parse(nozzleState.updatedAt || "")
    const stale = !Number.isFinite(updatedMs) || nowMs - updatedMs > IDLE_AFTER_MS
    if (!stale) continue
    if (nozzleState.status === "IDLE") continue

    nozzleState.status = "IDLE"
    nozzleState.litres = null
    nozzleState.updatedAt = nowIso
    changedNozzles.push(nozzleState)
  }
  return changedNozzles
}

async function fetchPumpRow(stationId, pumpPublicId) {
  const pumpRows = await prisma.$queryRaw`
    SELECT
      p.id,
      p.public_id,
      p.pump_number,
      p.status
    FROM pumps p
    WHERE p.station_id = ${stationId}
      AND p.public_id = ${pumpPublicId}
    LIMIT 1
  `

  const pump = pumpRows?.[0]
  if (!pump) throw notFound(`Pump not found: ${pumpPublicId}`)
  return pump
}

async function fetchStationTimeZone(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT timezone
    FROM stations
    WHERE id = ${stationId}
    LIMIT 1
  `
  return String(rows?.[0]?.timezone || "").trim() || "Africa/Blantyre"
}

async function fetchNozzleRows(stationId, pumpId) {
  return prisma.$queryRaw`
    SELECT
      pn.id,
      pn.public_id,
      pn.nozzle_number,
      pn.status,
      pn.updated_at,
      DATE_FORMAT(pn.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at_local,
      pn.fuel_type_id,
      ft.code AS fuel_code,
      ft.name AS fuel_name
    FROM pump_nozzles pn
    LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
    WHERE pn.station_id = ${stationId}
      AND pn.pump_id = ${pumpId}
      AND pn.is_active = 1
    ORDER BY pn.nozzle_number ASC
  `
}

async function fetchTransactionRow(stationId, transactionPublicId) {
  if (!transactionPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT id, station_id, pump_id, nozzle_id, occurred_at
    FROM transactions
    WHERE public_id = ${transactionPublicId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) {
    throw notFound(`Transaction not found: ${transactionPublicId}`)
  }
  if (Number(row.station_id || 0) !== Number(stationId || 0)) {
    throw badRequest("Transaction does not belong to this station")
  }
  return row
}

async function fetchPumpSessionRow({
  stationId,
  sessionPublicId = "",
  sessionReference = "",
  transactionId = 0,
  telemetryCorrelationId = "",
  pumpId = 0,
  nozzleId = 0,
  happenedAt = null,
}) {
  const scopedSessionPublicId = String(sessionPublicId || "").trim()
  const scopedSessionReference = String(sessionReference || "").trim()
  const scopedTelemetryCorrelationId = String(telemetryCorrelationId || "").trim()
  const scopedTransactionId = Number(transactionId || 0)
  const scopedPumpId = Number(pumpId || 0)
  const scopedNozzleId = Number(nozzleId || 0)
  const scopedHappenedAt = parseTelemetryTimestamp(happenedAt)

  const exactRows = await prisma.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      p.public_id AS pump_public_id,
      pn.public_id AS nozzle_public_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispense_duration_seconds,
      CAST(ps.dispensed_litres AS CHAR) AS dispensed_litres,
      ps.error_code,
      ps.error_message,
      ps.telemetry_correlation_id
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id AND p.station_id = ${stationId}
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id AND pn.station_id = ${stationId}
    WHERE ps.station_id = ${stationId}
      AND (
        (${scopedSessionPublicId} <> '' AND ps.public_id = ${scopedSessionPublicId})
        OR (${scopedSessionReference} <> '' AND ps.session_reference = ${scopedSessionReference})
        OR (${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId})
        OR (${scopedTransactionId} > 0 AND ps.transaction_id = ${scopedTransactionId})
      )
    ORDER BY
      CASE
        WHEN ${scopedSessionPublicId} <> '' AND ps.public_id = ${scopedSessionPublicId} THEN 0
        WHEN ${scopedSessionReference} <> '' AND ps.session_reference = ${scopedSessionReference} THEN 1
        WHEN ${scopedTelemetryCorrelationId} <> '' AND ps.telemetry_correlation_id = ${scopedTelemetryCorrelationId} THEN 2
        WHEN ${scopedTransactionId} > 0 AND ps.transaction_id = ${scopedTransactionId} THEN 3
        ELSE 4
      END,
      COALESCE(ps.updated_at, ps.end_time, ps.start_time, ps.created_at) DESC,
      ps.id DESC
    LIMIT 1
  `
  const exactRow = exactRows?.[0]
  if (exactRow?.id) {
    return {
      id: Number(exactRow.id),
      publicId: String(exactRow.public_id || "").trim() || null,
      transactionId: Number(exactRow.transaction_id || 0) || null,
      pumpId: Number(exactRow.pump_id || 0) || null,
      nozzleId: Number(exactRow.nozzle_id || 0) || null,
      pumpPublicId: String(exactRow.pump_public_id || "").trim() || null,
      nozzlePublicId: String(exactRow.nozzle_public_id || "").trim() || null,
      sessionReference: String(exactRow.session_reference || "").trim() || null,
      status: String(exactRow.session_status || "").trim().toUpperCase() || "CREATED",
      startTime: exactRow.start_time ? new Date(exactRow.start_time) : null,
      endTime: exactRow.end_time ? new Date(exactRow.end_time) : null,
      durationSeconds: Number(exactRow.dispense_duration_seconds || 0) || null,
      dispensedLitres: parseFiniteNumber(exactRow.dispensed_litres) ?? 0,
      errorCode: String(exactRow.error_code || "").trim() || null,
      errorMessage: String(exactRow.error_message || "").trim() || null,
      telemetryCorrelationId: String(exactRow.telemetry_correlation_id || "").trim() || null,
    }
  }

  if (
    (!scopedTransactionId && !scopedPumpId)
    || !canFallbackToScopedPumpSessionLookup({
      sessionPublicId: scopedSessionPublicId,
      sessionReference: scopedSessionReference,
    })
  ) {
    return null
  }

  const rows = await prisma.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      p.public_id AS pump_public_id,
      pn.public_id AS nozzle_public_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispense_duration_seconds,
      CAST(ps.dispensed_litres AS CHAR) AS dispensed_litres,
      ps.error_code,
      ps.error_message,
      ps.telemetry_correlation_id
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id AND p.station_id = ${stationId}
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id AND pn.station_id = ${stationId}
    WHERE ps.station_id = ${stationId}
      AND ${scopedPumpId} > 0
      AND ${scopedNozzleId} > 0
      AND ps.pump_id = ${scopedPumpId}
      AND ps.nozzle_id = ${scopedNozzleId}
      AND ps.session_status IN ('CREATED', 'STARTED', 'DISPENSING')
      AND COALESCE(ps.end_time, ps.updated_at, ps.created_at) >= DATE_SUB(${scopedHappenedAt}, INTERVAL 12 HOUR)
    ORDER BY
      CASE ps.session_status
        WHEN 'DISPENSING' THEN 0
        WHEN 'STARTED' THEN 1
        ELSE 2
      END,
      COALESCE(ps.updated_at, ps.end_time, ps.start_time, ps.created_at) DESC,
      ps.id DESC
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) return null
  return {
    id: Number(row.id),
    publicId: String(row.public_id || "").trim() || null,
    transactionId: Number(row.transaction_id || 0) || null,
    pumpId: Number(row.pump_id || 0) || null,
    nozzleId: Number(row.nozzle_id || 0) || null,
    pumpPublicId: String(row.pump_public_id || "").trim() || null,
    nozzlePublicId: String(row.nozzle_public_id || "").trim() || null,
    sessionReference: String(row.session_reference || "").trim() || null,
    status: String(row.session_status || "").trim().toUpperCase() || "CREATED",
    startTime: row.start_time ? new Date(row.start_time) : null,
    endTime: row.end_time ? new Date(row.end_time) : null,
    durationSeconds: Number(row.dispense_duration_seconds || 0) || null,
    dispensedLitres: parseFiniteNumber(row.dispensed_litres) ?? 0,
    errorCode: String(row.error_code || "").trim() || null,
    errorMessage: String(row.error_message || "").trim() || null,
    telemetryCorrelationId: String(row.telemetry_correlation_id || "").trim() || null,
  }
}

function mapPumpSessionBinding(session) {
  if (!session?.publicId) return null
  return {
    pumpSessionPublicId: session.publicId,
    sessionReference: session.sessionReference,
    telemetryCorrelationId: session.telemetryCorrelationId,
    status: session.status,
    startTime: session.startTime instanceof Date ? session.startTime.toISOString() : null,
    endTime: session.endTime instanceof Date ? session.endTime.toISOString() : null,
    dispensedLitres: parseFiniteNumber(session.dispensedLitres) ?? 0,
  }
}

export async function ensurePumpSessionBinding({
  stationId,
  pumpPublicId,
  nozzlePublicId,
  sessionPublicId = "",
  sessionReference = "",
  telemetryCorrelationId = "",
  startedAt = new Date(),
} = {}) {
  const pumpRow = await fetchPumpRow(stationId, pumpPublicId)
  const nozzleRows = await fetchNozzleRows(stationId, Number(pumpRow.id))
  const nozzleRow = (nozzleRows || []).find((row) => String(row.public_id || "").trim() === String(nozzlePublicId || "").trim())
  if (!nozzleRow?.id) {
    throw badRequest(`Nozzle does not belong to pump: ${nozzlePublicId}`)
  }

  const scopedStartedAt = parseTelemetryTimestamp(startedAt)
  const hasExactIdentity =
    Boolean(String(sessionPublicId || "").trim())
    || Boolean(String(sessionReference || "").trim())
    || Boolean(String(telemetryCorrelationId || "").trim())
  let session = hasExactIdentity
    ? await fetchPumpSessionRow({
        stationId,
        sessionPublicId,
        sessionReference,
        telemetryCorrelationId,
        pumpId: Number(pumpRow.id || 0),
        nozzleId: Number(nozzleRow.id || 0),
        happenedAt: scopedStartedAt,
      })
    : null

  if (session && TERMINAL_PUMP_SESSION_STATUSES.has(String(session.status || "").trim().toUpperCase())) {
    session = null
  }

  if (!session) {
    const created = await createPumpTelemetrySession({
      stationId,
      transactionId: null,
      pumpId: Number(pumpRow.id),
      nozzleId: Number(nozzleRow.id),
      sessionReference: String(sessionReference || "").trim(),
      telemetryCorrelationId: String(telemetryCorrelationId || "").trim(),
      eventType: "AUTHORIZED",
      litresValue: null,
      rawErrorCode: null,
      message: "Pump session authorized and bound for edge telemetry.",
      happenedAt: scopedStartedAt,
    })
    session = await fetchPumpSessionRow({
      stationId,
      sessionPublicId: created.publicId,
      sessionReference: created.sessionReference,
      telemetryCorrelationId: created.telemetryCorrelationId,
      pumpId: Number(pumpRow.id || 0),
      nozzleId: Number(nozzleRow.id || 0),
      happenedAt: scopedStartedAt,
    })
  }

  if (!session) {
    throw badRequest("Pump session could not be created for this binding.")
  }

  return mapPumpSessionBinding(session)
}

export async function completePumpSessionBinding({
  stationId,
  sessionPublicId = "",
  sessionReference = "",
  telemetryCorrelationId = "",
  dispensedLitres = null,
  endedAt = new Date(),
} = {}) {
  const session = await fetchPumpSessionRow({
    stationId,
    sessionPublicId,
    sessionReference,
    telemetryCorrelationId,
    happenedAt: endedAt,
  })
  if (!session?.id) return null

  const scopedEndedAt = parseTelemetryTimestamp(endedAt)
  const nextDispensedLitres = Math.max(
    parseFiniteNumber(session.dispensedLitres) ?? 0,
    parseFiniteNumber(dispensedLitres) ?? 0
  )
  const startAt = session.startTime instanceof Date ? session.startTime : scopedEndedAt
  const durationSeconds = Math.max(0, Math.round((scopedEndedAt.getTime() - startAt.getTime()) / 1000))

  await prisma.$executeRaw`
    UPDATE pump_sessions
    SET
      session_status = ${"COMPLETED"},
      end_time = ${scopedEndedAt},
      dispense_duration_seconds = ${durationSeconds},
      dispensed_litres = ${nextDispensedLitres}
    WHERE id = ${session.id}
  `

  if (session.pumpPublicId && session.nozzlePublicId) {
    await applyMonitoringUpdate({
      stationId,
      pumpPublicId: session.pumpPublicId,
      nozzlePublicId: session.nozzlePublicId,
      status: "IDLE",
    })
  }

  const refreshed = await fetchPumpSessionRow({
    stationId,
    sessionPublicId: session.publicId,
    sessionReference: session.sessionReference,
    telemetryCorrelationId: session.telemetryCorrelationId,
    happenedAt: scopedEndedAt,
  })

  return mapPumpSessionBinding(refreshed)
}

export async function listStationEdgeBindings({ stationPublicId } = {}) {
  const station = await resolveStationOrThrow(stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT
      ps.public_id,
      ps.session_reference,
      ps.telemetry_correlation_id,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.updated_at,
      ps.dispensed_litres,
      p.public_id AS pump_public_id,
      p.pump_number,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      ps.fuel_order_id,
      fo.public_id AS fuel_order_public_id,
      fo.status AS fuel_order_status,
      CAST(fo.requested_litres AS CHAR) AS fuel_order_requested_litres,
      qe.public_id AS queue_public_id,
      CAST(
        COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.liters')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.litres')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.requestedLiters')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.requestedLitres')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.requestedLiters')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.requestedLitres')),
          JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.requested_litres'))
        ) AS CHAR
      ) AS queue_requested_litres,
      ur.public_id AS reservation_public_id,
      CAST(ur.requested_litres AS CHAR) AS reservation_requested_litres
    FROM pump_sessions ps
    LEFT JOIN pumps p ON p.id = ps.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ps.nozzle_id
    LEFT JOIN fuel_orders fo ON fo.id = ps.fuel_order_id
    LEFT JOIN queue_entries qe
      ON qe.station_id = ps.station_id
      AND qe.status IN ('WAITING', 'CALLED', 'LATE')
      AND (
        JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.pumpSessionPublicId')) = ps.public_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.sessionReference')) = ps.session_reference
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.serviceRequest.telemetryCorrelationId')) = ps.telemetry_correlation_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.publicId')) = ps.public_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.sessionReference')) = ps.session_reference
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(qe.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.telemetryCorrelationId')) = ps.telemetry_correlation_id
      )
    LEFT JOIN user_reservations ur
      ON ur.station_id = ps.station_id
      AND ur.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
      AND (
        JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.serviceRequest.pumpSessionPublicId')) = ps.public_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.serviceRequest.sessionReference')) = ps.session_reference
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.serviceRequest.telemetryCorrelationId')) = ps.telemetry_correlation_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.publicId')) = ps.public_id
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.sessionReference')) = ps.session_reference
        OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(ur.metadata, JSON_OBJECT()), '$.attendantWorkflow.pumpSession.telemetryCorrelationId')) = ps.telemetry_correlation_id
      )
    WHERE ps.station_id = ${station.id}
      AND ps.session_status IN ('CREATED', 'STARTED', 'DISPENSING')
      AND p.public_id IS NOT NULL
      AND pn.public_id IS NOT NULL
    ORDER BY
      CASE ps.session_status
        WHEN 'DISPENSING' THEN 0
        WHEN 'STARTED' THEN 1
        ELSE 2
      END,
      COALESCE(ps.updated_at, ps.start_time, ps.created_at) DESC,
      ps.id DESC
  `

  return {
    stationPublicId: station.public_id,
    stationName: station.name,
    generatedAt: new Date().toISOString(),
    bindings: (rows || []).map((row) => ({
      pumpSessionPublicId: String(row.public_id || "").trim() || null,
      sessionReference: String(row.session_reference || "").trim() || null,
      telemetryCorrelationId: String(row.telemetry_correlation_id || "").trim() || null,
      status: String(row.session_status || "").trim().toUpperCase() || "CREATED",
      pumpPublicId: String(row.pump_public_id || "").trim() || null,
      pumpNumber: Number(row.pump_number || 0) || null,
      nozzlePublicId: String(row.nozzle_public_id || "").trim() || null,
      nozzleNumber: String(row.nozzle_number || "").trim() || null,
      dispensedLitres: parseFiniteNumber(row.dispensed_litres) ?? 0,
      requestedLitres:
        parseFiniteNumber(row.fuel_order_requested_litres)
        ?? parseFiniteNumber(row.queue_requested_litres)
        ?? parseFiniteNumber(row.reservation_requested_litres),
      startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
      endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
      lastUpdatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      fuelOrderLinked: Number(row.fuel_order_id || 0) > 0,
      fuelOrderPublicId: String(row.fuel_order_public_id || "").trim() || null,
      fuelOrderStatus: String(row.fuel_order_status || "").trim().toLowerCase() || null,
      queuePublicId: String(row.queue_public_id || "").trim() || null,
      reservationPublicId: String(row.reservation_public_id || "").trim() || null,
    })),
  }
}

async function createPumpTelemetrySession({
  stationId,
  transactionId = null,
  pumpId,
  nozzleId = null,
  sessionReference = "",
  telemetryCorrelationId = "",
  eventType,
  litresValue = null,
  rawErrorCode = null,
  message = "",
  happenedAt,
}) {
  const publicId = createPublicId()
  const derivedStatus = derivePumpSessionStatusFromTelemetryEvent(eventType)
  const nextSessionReference = String(sessionReference || "").trim() || `PS-${createPublicId()}`
  const nextCorrelationId = resolvePumpSessionTelemetryCorrelationId({
    telemetryCorrelationId,
  })
  const dispensedLitres = parseFiniteNumber(litresValue) ?? 0
  const isTerminal = TERMINAL_PUMP_SESSION_STATUSES.has(derivedStatus)
  const durationSeconds = isTerminal ? 0 : null

  await prisma.$executeRaw`
    INSERT INTO pump_sessions (
      public_id,
      transaction_id,
      station_id,
      pump_id,
      nozzle_id,
      session_reference,
      session_status,
      start_time,
      end_time,
      dispense_duration_seconds,
      dispensed_litres,
      error_code,
      error_message,
      telemetry_correlation_id
    )
    VALUES (
      ${publicId},
      ${transactionId || null},
      ${stationId},
      ${pumpId},
      ${nozzleId || null},
      ${nextSessionReference},
      ${derivedStatus},
      ${happenedAt},
      ${isTerminal ? happenedAt : null},
      ${durationSeconds},
      ${dispensedLitres},
      ${derivedStatus === "FAILED" ? rawErrorCode : null},
      ${derivedStatus === "FAILED" ? buildTelemetryMessage(eventType, message) : null},
      ${nextCorrelationId}
    )
  `

  return {
    id: null,
    publicId,
    transactionId: transactionId || null,
    pumpId,
    nozzleId: nozzleId || null,
    sessionReference: nextSessionReference,
    status: derivedStatus,
    startTime: happenedAt,
    endTime: isTerminal ? happenedAt : null,
    durationSeconds,
    dispensedLitres,
    errorCode: derivedStatus === "FAILED" ? rawErrorCode : null,
    errorMessage: derivedStatus === "FAILED" ? buildTelemetryMessage(eventType, message) : null,
    telemetryCorrelationId: nextCorrelationId,
  }
}

async function updatePumpTelemetrySession({
  session,
  eventType,
  litresValue = null,
  rawErrorCode = null,
  message = "",
  telemetryCorrelationId = "",
  happenedAt,
}) {
  const nextStatus = choosePumpSessionStatus(session?.status, derivePumpSessionStatusFromTelemetryEvent(eventType))
  const nextDispensedLitres = Math.max(parseFiniteNumber(session?.dispensedLitres) ?? 0, parseFiniteNumber(litresValue) ?? 0)
  const nextEndTime = TERMINAL_PUMP_SESSION_STATUSES.has(nextStatus) ? happenedAt : session?.endTime || null
  const nextCorrelationId = resolvePumpSessionTelemetryCorrelationId({
    sessionTelemetryCorrelationId: session?.telemetryCorrelationId,
    telemetryCorrelationId,
  })
  const nextErrorCode =
    nextStatus === "FAILED"
      ? String(rawErrorCode || "").trim() || session?.errorCode || null
      : session?.errorCode || null
  const nextErrorMessage =
    nextStatus === "FAILED"
      ? buildTelemetryMessage(eventType, message)
      : session?.errorMessage || null
  const startAt = session?.startTime instanceof Date ? session.startTime : happenedAt
  const durationSeconds =
    nextEndTime instanceof Date
      ? Math.max(0, Math.round((nextEndTime.getTime() - startAt.getTime()) / 1000))
      : session?.durationSeconds || null

  await prisma.$executeRaw`
    UPDATE pump_sessions
    SET
      session_status = ${nextStatus},
      end_time = ${nextEndTime},
      dispense_duration_seconds = ${durationSeconds},
      dispensed_litres = ${nextDispensedLitres},
      error_code = ${nextErrorCode},
      error_message = ${nextErrorMessage},
      telemetry_correlation_id = ${nextCorrelationId}
    WHERE id = ${session.id}
  `

  return {
    ...session,
    status: nextStatus,
    endTime: nextEndTime,
    durationSeconds,
    dispensedLitres: nextDispensedLitres,
    errorCode: nextErrorCode,
    errorMessage: nextErrorMessage,
    telemetryCorrelationId: nextCorrelationId,
  }
}

export async function ingestPumpTelemetryEvent({
  stationId,
  actorUserId = null,
  pumpPublicId,
  nozzlePublicId,
  eventId = "",
  transactionPublicId = "",
  sessionPublicId = "",
  sessionReference = "",
  telemetryCorrelationId = "",
  eventType,
  severity = "INFO",
  litresValue = null,
  dispensedLitres = null,
  flowRate = null,
  rawErrorCode = null,
  message = "",
  sourceType = "PUMP_CONTROLLER",
  happenedAt = null,
  payload = {},
}) {
  const pumpRow = await fetchPumpRow(stationId, pumpPublicId)
  const nozzleRows = await fetchNozzleRows(stationId, Number(pumpRow.id))
  const nozzleRow = (nozzleRows || []).find((row) => String(row.public_id || "").trim() === String(nozzlePublicId || "").trim())
  if (!nozzleRow?.id) {
    throw badRequest(`Nozzle does not belong to pump: ${nozzlePublicId}`)
  }

  const normalizedEventType = normalizeTelemetryEventType(eventType)
  const normalizedSeverity = normalizeTelemetrySeverity(severity)
  const normalizedSourceType = normalizeTelemetrySourceType(sourceType)
  const scopedHappenedAt = parseTelemetryTimestamp(happenedAt)
  const scopedLitresValue = resolveTelemetryLitresValue({
    litresValue,
    dispensedLitres,
    payload,
  })
  const scopedFlowRate = parseFiniteNumber(flowRate)
  const scopedMessage = buildTelemetryMessage(normalizedEventType, message)
  const scopedRawErrorCode = String(rawErrorCode || "").trim() || null
  const transaction = await fetchTransactionRow(stationId, String(transactionPublicId || "").trim())

  let session = await fetchPumpSessionRow({
    stationId,
    sessionPublicId: String(sessionPublicId || "").trim(),
    sessionReference: String(sessionReference || "").trim(),
    transactionId: Number(transaction?.id || 0),
    telemetryCorrelationId: String(telemetryCorrelationId || "").trim(),
    pumpId: Number(pumpRow.id || 0),
    nozzleId: Number(nozzleRow.id || 0),
    happenedAt: scopedHappenedAt,
  })

  if (!session) {
    session = await createPumpTelemetrySession({
      stationId,
      transactionId: Number(transaction?.id || 0) || null,
      pumpId: Number(pumpRow.id),
      nozzleId: Number(nozzleRow.id),
      sessionReference: String(sessionReference || "").trim(),
      telemetryCorrelationId: String(telemetryCorrelationId || "").trim(),
      eventType: normalizedEventType,
      litresValue: scopedLitresValue,
      rawErrorCode: scopedRawErrorCode,
      message: scopedMessage,
      happenedAt: scopedHappenedAt,
    })
    session = await fetchPumpSessionRow({
      stationId,
      sessionPublicId: session.publicId,
      sessionReference: session.sessionReference,
      transactionId: Number(transaction?.id || 0),
      telemetryCorrelationId: session.telemetryCorrelationId,
      pumpId: Number(pumpRow.id || 0),
      nozzleId: Number(nozzleRow.id || 0),
    })
  } else {
    session = await updatePumpTelemetrySession({
      session,
      eventType: normalizedEventType,
      litresValue: scopedLitresValue,
      rawErrorCode: scopedRawErrorCode,
      message: scopedMessage,
      telemetryCorrelationId: String(telemetryCorrelationId || "").trim(),
      happenedAt: scopedHappenedAt,
    })
  }

  if (transaction?.id && session?.id) {
    session = await linkTransactionToPumpSession(prisma, {
      stationId,
      transactionId: Number(transaction.id),
      pumpId: Number(pumpRow.id || 0) || null,
      nozzleId: Number(nozzleRow.id || 0) || null,
      sessionId: Number(session.id),
      occurredAt: transaction?.occurred_at || scopedHappenedAt,
    })
  }

  const telemetryPayload = {
    ...(payload && typeof payload === "object" ? payload : {}),
    ...(eventId ? { eventId: String(eventId).trim() } : {}),
    ...(sessionPublicId ? { sessionPublicId: String(sessionPublicId).trim() } : {}),
    ...(sessionReference ? { sessionReference: String(sessionReference).trim() } : {}),
    ...(transactionPublicId ? { transactionPublicId: String(transactionPublicId).trim() } : {}),
  }

  const telemetryPublicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO pump_telemetry_logs (
      public_id,
      station_id,
      pump_id,
      nozzle_id,
      pump_session_id,
      telemetry_correlation_id,
      event_type,
      severity,
      litres_value,
      flow_rate,
      raw_error_code,
      message,
      payload_json,
      source_type,
      happened_at
    )
    VALUES (
      ${telemetryPublicId},
      ${stationId},
      ${Number(pumpRow.id)},
      ${Number(nozzleRow.id)},
      ${session?.id || null},
      ${session?.telemetryCorrelationId || String(telemetryCorrelationId || "").trim() || null},
      ${normalizedEventType},
      ${normalizedSeverity},
      ${scopedLitresValue},
      ${scopedFlowRate},
      ${scopedRawErrorCode},
      ${scopedMessage},
      ${toJsonString(telemetryPayload)},
      ${normalizedSourceType},
      ${scopedHappenedAt}
    )
  `

  await writeAuditLog({
    stationId,
    actionType: "MONITORING_TELEMETRY_EVENT_INGEST",
    payload: {
      actorUserId,
      pumpPublicId,
      nozzlePublicId,
      eventType: normalizedEventType,
      severity: normalizedSeverity,
      litresValue: scopedLitresValue,
      flowRate: scopedFlowRate,
      sessionPublicId: session?.publicId || String(sessionPublicId || "").trim() || null,
      sessionReference: session?.sessionReference || null,
      transactionPublicId: transactionPublicId || null,
      telemetryCorrelationId: session?.telemetryCorrelationId || telemetryCorrelationId || null,
      sourceType: normalizedSourceType,
      happenedAt: scopedHappenedAt.toISOString(),
    },
  })

  publishStationChange({
    stationId,
    actionType: "PUMP_TELEMETRY_EVENT",
    payload: {
      pumpPublicId,
      nozzlePublicId,
      eventType: normalizedEventType,
      sessionPublicId: session?.publicId || String(sessionPublicId || "").trim() || null,
      sessionReference: session?.sessionReference || null,
      telemetryPublicId,
      litresValue: scopedLitresValue,
      happenedAt: scopedHappenedAt.toISOString(),
      source: "monitoring_telemetry",
    },
  })

  let fuelOrderFlow = null
  if (session?.id && (session.status === "DISPENSING" || session.status === "COMPLETED")) {
    try {
      const fuelOrderModule = await import("../fuelOrders/service.js")
      if (session.status === "DISPENSING") {
        fuelOrderFlow = await fuelOrderModule.markFuelOrderDispensing({
          stationPublicId: String(stationId),
          sessionId: String(session.id),
          actorUserId,
          source: "telemetry",
        })
      } else if (session.status === "COMPLETED") {
        fuelOrderFlow = await fuelOrderModule.finalizeFuelOrderFromPumpSession({
          stationPublicId: String(stationId),
          sessionId: String(session.id),
          actorUserId,
          dispensedLitres: scopedLitresValue ?? session.dispensedLitres ?? null,
          source: "telemetry",
        })
      }
    } catch (fuelOrderError) {
      // Keep telemetry ingest non-blocking when settlement follow-up is needed.
      fuelOrderFlow = {
        error: String(fuelOrderError?.message || "Manual fuel order follow-up is required."),
      }
    }
  }

  return {
    event: {
      publicId: telemetryPublicId,
      eventType: normalizedEventType,
      severity: normalizedSeverity,
      litresValue: scopedLitresValue,
      flowRate: scopedFlowRate,
      rawErrorCode: scopedRawErrorCode,
      message: scopedMessage,
      sourceType: normalizedSourceType,
      happenedAt: scopedHappenedAt.toISOString(),
      telemetryCorrelationId: session?.telemetryCorrelationId || telemetryCorrelationId || null,
    },
    pump: {
      pumpId: String(pumpRow.public_id || "").trim() || pumpPublicId,
      pumpNumber: Number(pumpRow.pump_number || 0) || null,
      nozzleId: String(nozzleRow.public_id || "").trim() || nozzlePublicId,
      nozzleNumber: String(nozzleRow.nozzle_number || "").trim() || null,
    },
    session: session
      ? {
          publicId: session.publicId,
          sessionReference: session.sessionReference,
          status: session.status,
          dispensedLitres: session.dispensedLitres,
          telemetryCorrelationId: session.telemetryCorrelationId,
          transactionPublicId: transactionPublicId || null,
        }
      : null,
    fuelOrderFlow,
  }
}

function hydrateStateFromRows({ stationId, pumpPublicId, pumpRow, nozzleRows, existingState = null, stationTimeZone }) {
  const nowIso = new Date().toISOString()
  const nextState = {
    stationId,
    pumpId: pumpPublicId,
    pumpDbId: Number(pumpRow.id),
    pumpDbStatus: normalizePumpDbStatus(pumpRow.status),
    pumpLabel: `Pump ${pumpRow.pump_number}`,
    pumpNumber: Number(pumpRow.pump_number),
    nozzles: new Map(),
    hydratedAtMs: Date.now(),
  }

  for (const row of nozzleRows || []) {
    const previous = existingState?.nozzles?.get(row.public_id)
    const dbStatus = normalizeNozzleDbStatus(row.status, previous?._dbStatus || "ACTIVE")
    const monitoringStatus = normalizeMonitoringStatus(dbStatus)
    const rowUpdatedAt =
      zonedSqlDateTimeToUtcIso(row?.updated_at_local || row?.updated_at, stationTimeZone) ||
      previous?.updatedAt ||
      nowIso
    const nextLitres = normalizeMonitoringLitres(monitoringStatus, previous?.litres ?? null)
    const nozzleDbId = Number(row?.id || previous?._dbNozzleId || 0)
    const fuelTypeId = Number(row?.fuel_type_id || previous?._fuelTypeId || 0)

    if (previous) {
      nextState.nozzles.set(row.public_id, {
        ...previous,
        nozzleLabel: String(row.nozzle_number || previous.nozzleLabel || row.public_id),
        product: row.fuel_code || row.fuel_name || previous.product || null,
        status: monitoringStatus,
        litres: nextLitres,
        updatedAt: rowUpdatedAt,
        _dbStatus: dbStatus,
        _dbNozzleId: nozzleDbId > 0 ? nozzleDbId : previous?._dbNozzleId || null,
        _fuelTypeId: fuelTypeId > 0 ? fuelTypeId : previous?._fuelTypeId || null,
      })
      continue
    }

    nextState.nozzles.set(row.public_id, {
      nozzleId: row.public_id,
      nozzleLabel: String(row.nozzle_number || row.public_id || "-"),
      product: row.fuel_code || row.fuel_name || null,
      status: monitoringStatus,
      litres: nextLitres,
      updatedAt: rowUpdatedAt,
      _dbStatus: dbStatus,
      _dbNozzleId: nozzleDbId > 0 ? nozzleDbId : null,
      _fuelTypeId: fuelTypeId > 0 ? fuelTypeId : null,
    })
  }

  return nextState
}

async function resolvePricePerLitre({ stationId, nozzleDbId, fuelTypeId }) {
  const recentRows = await prisma.$queryRaw`
    SELECT
      CAST(t.price_per_litre AS CHAR) AS price_per_litre
    FROM transactions t
    WHERE t.station_id = ${stationId}
      AND (
        (${nozzleDbId} IS NOT NULL AND t.nozzle_id = ${nozzleDbId})
        OR (${fuelTypeId} IS NOT NULL AND t.fuel_type_id = ${fuelTypeId})
      )
    ORDER BY t.occurred_at DESC, t.id DESC
    LIMIT 1
  `
  const parsed = parseFiniteNumber(recentRows?.[0]?.price_per_litre)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

async function createDispensingTransaction({
  stationId,
  pumpDbId,
  pumpPublicId,
  nozzleState,
  litres,
}) {
  const nozzleDbId = Number(nozzleState?._dbNozzleId || 0)
  const fuelTypeId = Number(nozzleState?._fuelTypeId || 0)
  if (nozzleDbId <= 0 || fuelTypeId <= 0) return null

  const litresValue = parseFiniteNumber(litres)
  if (!Number.isFinite(litresValue) || litresValue <= 0) return null

  const pricePerLitre = await resolvePricePerLitre({
    stationId,
    nozzleDbId,
    fuelTypeId,
  })
  const totalAmount = Number((litresValue * pricePerLitre).toFixed(2))
  const txPublicId = createTransactionPublicIdValue({ typeCode: "PAY" })
  const note = "Auto-created from live monitoring dispensing event"

  await prisma.$executeRaw`
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
      ${stationId},
      ${txPublicId},
      ${pumpDbId || null},
      ${nozzleDbId},
      ${fuelTypeId},
      CURRENT_TIMESTAMP(3),
      ${litresValue},
      ${pricePerLitre},
      ${totalAmount},
      ${"CASH"},
      ${null},
      ${note}
    )
  `

  const transactionRows = await prisma.$queryRaw`
    SELECT id
    FROM transactions
    WHERE public_id = ${txPublicId}
    LIMIT 1
  `
  const transactionId = Number(transactionRows?.[0]?.id || 0)
  if (transactionId > 0) {
    await linkTransactionToPumpSession(prisma, {
      stationId,
      transactionId,
      pumpId: pumpDbId,
      nozzleId: nozzleDbId,
      occurredAt: new Date(),
    })
  }

  await writeAuditLog({
    stationId,
    actorStaffId: null,
    actionType: "TRANSACTION_CREATE",
    payload: {
      source: "live_monitoring",
      pumpPublicId,
      nozzlePublicId: nozzleState.nozzleId,
      litres: litresValue,
      totalAmount,
      paymentMethod: "CASH",
    },
  })

  return {
    publicId: txPublicId,
    litres: litresValue,
    totalAmount,
  }
}

async function persistMonitoringState(state, changedNozzles = []) {
  for (const nozzleState of changedNozzles) {
    const nextNozzleDbStatus = monitoringStatusToNozzleDbStatus(nozzleState.status)
    if (nextNozzleDbStatus === nozzleState._dbStatus) continue

    await prisma.$executeRaw`
      UPDATE pump_nozzles
      SET status = ${nextNozzleDbStatus}
      WHERE station_id = ${state.stationId}
        AND pump_id = ${state.pumpDbId}
        AND public_id = ${nozzleState.nozzleId}
    `
    nozzleState._dbStatus = nextNozzleDbStatus
  }

  const nextPumpDbStatus = derivePumpDbStatusFromNozzles([...state.nozzles.values()])
  if (nextPumpDbStatus !== state.pumpDbStatus) {
    await prisma.$executeRaw`
      UPDATE pumps
      SET status = ${nextPumpDbStatus}
      WHERE station_id = ${state.stationId}
        AND id = ${state.pumpDbId}
    `
    state.pumpDbStatus = nextPumpDbStatus
  }
}

async function refreshPumpState(stationId, pumpPublicId, { force = false } = {}) {
  const key = toPumpKey(stationId, pumpPublicId)
  if (!key) throw badRequest("Pump scope is required")

  const existingState = stateByPumpKey.get(key)
  const isFresh =
    existingState &&
    !force &&
    Number.isFinite(existingState.hydratedAtMs) &&
    Date.now() - existingState.hydratedAtMs < DB_REFRESH_INTERVAL_MS

  if (isFresh) {
    const staleNozzles = applyIdleFallbackTransitions(existingState)
    if (staleNozzles.length) {
      await persistMonitoringState(existingState, staleNozzles)
    }
    return existingState
  }

  const pumpRow = await fetchPumpRow(stationId, pumpPublicId)
  const stationTimeZone = await fetchStationTimeZone(stationId)
  const nozzleRows = await fetchNozzleRows(stationId, Number(pumpRow.id))
  const nextState = hydrateStateFromRows({
    stationId,
    pumpPublicId,
    pumpRow,
    nozzleRows,
    existingState,
    stationTimeZone,
  })

  const staleNozzles = applyIdleFallbackTransitions(nextState)
  if (staleNozzles.length) {
    await persistMonitoringState(nextState, staleNozzles)
  }
  stateByPumpKey.set(key, nextState)
  return nextState
}

export async function getPumpMonitoringSnapshot({ stationId, pumpPublicId }) {
  // Snapshot endpoints should always reflect latest persisted DB status.
  const state = await refreshPumpState(stationId, pumpPublicId, { force: true })
  return toSnapshot(state)
}

export async function applyMonitoringUpdate({
  stationId,
  pumpPublicId,
  nozzlePublicId,
  status,
  litres = null,
}) {
  const state = await refreshPumpState(stationId, pumpPublicId)
  const nozzleState = state.nozzles.get(nozzlePublicId)

  if (!nozzleState) {
    await refreshPumpState(stationId, pumpPublicId, { force: true })
    const refreshed = stateByPumpKey.get(toPumpKey(stationId, pumpPublicId))
    const refreshedNozzle = refreshed?.nozzles?.get(nozzlePublicId)
    if (!refreshedNozzle) {
      throw badRequest(`Nozzle does not belong to pump: ${nozzlePublicId}`)
    }

    const previousStatus = refreshedNozzle.status
    const nextStatus = normalizeMonitoringStatus(status)
    refreshedNozzle.status = nextStatus
    refreshedNozzle.litres = normalizeMonitoringLitres(nextStatus, litres)
    refreshedNozzle.updatedAt = new Date().toISOString()
    await persistMonitoringState(refreshed, [refreshedNozzle])
    if (shouldCreateDispensingTransaction({ previousStatus, nextStatus, litres })) {
      await createDispensingTransaction({
        stationId,
        pumpDbId: refreshed.pumpDbId,
        pumpPublicId,
        nozzleState: refreshedNozzle,
        litres,
      })
    }

    const payload = buildUpdatePayload(refreshed, refreshedNozzle)
    publishMonitoringUpdate({ stationId, pumpPublicId, payload })
    return payload
  }

  const previousStatus = nozzleState.status
  const nextStatus = normalizeMonitoringStatus(status)
  nozzleState.status = nextStatus
  nozzleState.litres = normalizeMonitoringLitres(nextStatus, litres)
  nozzleState.updatedAt = new Date().toISOString()
  await persistMonitoringState(state, [nozzleState])
  if (shouldCreateDispensingTransaction({ previousStatus, nextStatus, litres })) {
    await createDispensingTransaction({
      stationId,
      pumpDbId: state.pumpDbId,
      pumpPublicId,
      nozzleState,
      litres,
    })
  }

  const payload = buildUpdatePayload(state, nozzleState)
  publishMonitoringUpdate({ stationId, pumpPublicId, payload })
  return payload
}

export function startMonitoringStateWatcher() {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      for (const state of stateByPumpKey.values()) {
        const staleNozzles = applyIdleFallbackTransitions(state)
        if (!staleNozzles.length) continue
        await persistMonitoringState(state, staleNozzles)
        for (const nozzleState of staleNozzles) {
          publishMonitoringUpdate({
            stationId: state.stationId,
            pumpPublicId: state.pumpId,
            payload: buildUpdatePayload(state, nozzleState),
          })
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[monitoring] failed to sweep stale nozzle idle fallback", error?.message || error)
    } finally {
      running = false
    }
  }

  const intervalId = setInterval(() => {
    tick()
  }, SWEEP_INTERVAL_MS)

  return () => {
    clearInterval(intervalId)
  }
}

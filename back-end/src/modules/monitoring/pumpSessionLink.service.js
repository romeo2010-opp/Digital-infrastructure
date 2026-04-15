
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"

const ACTIVE_PUMP_SESSION_STATUSES = ["CREATED", "STARTED", "DISPENSING"]
const RECENT_SESSION_ATTACH_WINDOW_MINUTES = 120

function toPositiveInteger(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function normalizeDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function mapPumpSessionRow(row) {
  if (!row?.id) return null
  return {
    id: Number(row.id),
    publicId: String(row.public_id || "").trim() || null,
    transactionId: toPositiveInteger(row.transaction_id),
    stationId: toPositiveInteger(row.station_id),
    pumpId: toPositiveInteger(row.pump_id),
    nozzleId: toPositiveInteger(row.nozzle_id),
    sessionReference: String(row.session_reference || "").trim() || null,
    status: String(row.session_status || "").trim().toUpperCase() || "CREATED",
    startTime: row.start_time ? new Date(row.start_time) : null,
    endTime: row.end_time ? new Date(row.end_time) : null,
    dispensedLitres: Number(row.dispensed_litres || 0) || 0,
    telemetryCorrelationId: String(row.telemetry_correlation_id || "").trim() || null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }
}

function assertPumpSessionMatchesScope(session, { stationId, pumpId = null, nozzleId = null, transactionId }) {
  if (!session?.id) throw notFound("Pump session not found.")
  if (Number(session.stationId || 0) !== Number(stationId || 0)) {
    throw badRequest("Pump session does not belong to this station.")
  }
  if (Number(pumpId || 0) > 0 && Number(session.pumpId || 0) > 0 && Number(session.pumpId) !== Number(pumpId)) {
    throw badRequest("Pump session does not belong to the selected pump.")
  }
  if (Number(nozzleId || 0) > 0 && Number(session.nozzleId || 0) > 0 && Number(session.nozzleId) !== Number(nozzleId)) {
    throw badRequest("Pump session does not belong to the selected nozzle.")
  }
  if (Number(session.transactionId || 0) > 0 && Number(session.transactionId) !== Number(transactionId || 0)) {
    throw badRequest("Pump session is already linked to a different transaction.")
  }
}

async function fetchPumpSessionByTransactionId(db, transactionId) {
  const normalizedTransactionId = toPositiveInteger(transactionId)
  if (!normalizedTransactionId) return null

  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      ps.created_at,
      ps.updated_at
    FROM pump_sessions ps
    WHERE ps.transaction_id = ${normalizedTransactionId}
    LIMIT 1
  `

  return mapPumpSessionRow(rows?.[0])
}

async function fetchPumpSessionById(db, { stationId, sessionId }) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedSessionId = toPositiveInteger(sessionId)
  if (!normalizedStationId || !normalizedSessionId) return null

  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      ps.created_at,
      ps.updated_at
    FROM pump_sessions ps
    WHERE ps.station_id = ${normalizedStationId}
      AND ps.id = ${normalizedSessionId}
    LIMIT 1
  `

  return mapPumpSessionRow(rows?.[0])
}

async function fetchPumpSessionByPublicIdentity(
  db,
  {
    stationId,
    sessionPublicId = null,
    sessionReference = null,
  }
) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedSessionPublicId = String(sessionPublicId || "").trim()
  const normalizedSessionReference = String(sessionReference || "").trim()
  if (!normalizedStationId || (!normalizedSessionPublicId && !normalizedSessionReference)) return null

  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      ps.created_at,
      ps.updated_at
    FROM pump_sessions ps
    WHERE ps.station_id = ${normalizedStationId}
      AND (
        (${normalizedSessionPublicId} <> '' AND ps.public_id = ${normalizedSessionPublicId})
        OR (${normalizedSessionReference} <> '' AND ps.session_reference = ${normalizedSessionReference})
      )
    ORDER BY
      CASE
        WHEN ${normalizedSessionPublicId} <> '' AND ps.public_id = ${normalizedSessionPublicId} THEN 0
        WHEN ${normalizedSessionReference} <> '' AND ps.session_reference = ${normalizedSessionReference} THEN 1
        ELSE 2
      END,
      ps.id DESC
    LIMIT 1
  `

  return mapPumpSessionRow(rows?.[0])
}

function assertPumpSessionIdentityMatches(
  session,
  {
    sessionId = null,
    sessionPublicId = null,
    sessionReference = null,
  } = {}
) {
  if (!session?.id) throw notFound("Pump session not found.")

  const normalizedSessionId = toPositiveInteger(sessionId)
  const normalizedSessionPublicId = String(sessionPublicId || "").trim()
  const normalizedSessionReference = String(sessionReference || "").trim()

  if (normalizedSessionId && Number(session.id) !== normalizedSessionId) {
    throw badRequest("Transaction is already linked to a different pump session.")
  }
  if (normalizedSessionPublicId && String(session.publicId || "").trim() !== normalizedSessionPublicId) {
    throw badRequest("Transaction is already linked to a different pump session.")
  }
  if (normalizedSessionReference && String(session.sessionReference || "").trim() !== normalizedSessionReference) {
    throw badRequest("Transaction is already linked to a different pump session.")
  }
}

async function findAttachablePumpSession(db, { stationId, pumpId, nozzleId = null, transactionId, occurredAt }) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedPumpId = toPositiveInteger(pumpId)
  const normalizedNozzleId = toPositiveInteger(nozzleId)
  const normalizedTransactionId = toPositiveInteger(transactionId)
  if (!normalizedStationId || !normalizedPumpId || !normalizedTransactionId) return null

  const anchorTime = normalizeDate(occurredAt)
  const rows = await db.$queryRaw`
    SELECT
      ps.id,
      ps.public_id,
      ps.transaction_id,
      ps.station_id,
      ps.pump_id,
      ps.nozzle_id,
      ps.session_reference,
      ps.session_status,
      ps.start_time,
      ps.end_time,
      ps.dispensed_litres,
      ps.telemetry_correlation_id,
      ps.created_at,
      ps.updated_at
    FROM pump_sessions ps
    WHERE ps.station_id = ${normalizedStationId}
      AND ps.pump_id = ${normalizedPumpId}
      AND (${normalizedNozzleId} IS NULL OR ps.nozzle_id = ${normalizedNozzleId})
      AND (
        ps.transaction_id = ${normalizedTransactionId}
        OR (
          ps.transaction_id IS NULL
          AND (
            ps.session_status IN (${ACTIVE_PUMP_SESSION_STATUSES[0]}, ${ACTIVE_PUMP_SESSION_STATUSES[1]}, ${ACTIVE_PUMP_SESSION_STATUSES[2]})
            OR (
              COALESCE(ps.end_time, ps.updated_at, ps.created_at) >= DATE_SUB(${anchorTime}, INTERVAL ${RECENT_SESSION_ATTACH_WINDOW_MINUTES} MINUTE)
              AND COALESCE(ps.start_time, ps.created_at) <= DATE_ADD(${anchorTime}, INTERVAL ${RECENT_SESSION_ATTACH_WINDOW_MINUTES} MINUTE)
            )
          )
        )
      )
    ORDER BY
      CASE
        WHEN ps.transaction_id = ${normalizedTransactionId} THEN 0
        WHEN ps.session_status IN (${ACTIVE_PUMP_SESSION_STATUSES[0]}, ${ACTIVE_PUMP_SESSION_STATUSES[1]}, ${ACTIVE_PUMP_SESSION_STATUSES[2]}) THEN 1
        ELSE 2
      END,
      ps.created_at DESC,
      ps.id DESC
    LIMIT 1
  `

  return mapPumpSessionRow(rows?.[0])
}

async function persistTransactionLink(db, { stationId, sessionId, transactionId }) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedSessionId = toPositiveInteger(sessionId)
  const normalizedTransactionId = toPositiveInteger(transactionId)
  if (!normalizedStationId || !normalizedSessionId || !normalizedTransactionId) {
    throw badRequest("Pump session link requires station, session, and transaction IDs.")
  }

  await db.$executeRaw`
    UPDATE pump_sessions
    SET transaction_id = ${normalizedTransactionId}
    WHERE station_id = ${normalizedStationId}
      AND id = ${normalizedSessionId}
      AND (transaction_id IS NULL OR transaction_id = ${normalizedTransactionId})
  `

  return fetchPumpSessionById(db, {
    stationId: normalizedStationId,
    sessionId: normalizedSessionId,
  })
}

async function createTransactionLinkedPumpSession(
  db,
  {
    stationId,
    transactionId,
    pumpId,
    nozzleId = null,
    occurredAt,
  }
) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedTransactionId = toPositiveInteger(transactionId)
  const normalizedPumpId = toPositiveInteger(pumpId)
  const normalizedNozzleId = toPositiveInteger(nozzleId)
  if (!normalizedStationId || !normalizedTransactionId || !normalizedPumpId) return null

  const happenedAt = normalizeDate(occurredAt)
  const publicId = createPublicId()
  const sessionReference = `PS-${createPublicId()}`

  await db.$executeRaw`
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
      ${normalizedTransactionId},
      ${normalizedStationId},
      ${normalizedPumpId},
      ${normalizedNozzleId},
      ${sessionReference},
      ${"CREATED"},
      ${happenedAt},
      ${null},
      ${null},
      ${0},
      ${null},
      ${null},
      ${null}
    )
  `

  return fetchPumpSessionByTransactionId(db, normalizedTransactionId)
}

export async function linkTransactionToPumpSession(
  db,
  {
    stationId,
    transactionId,
    pumpId = null,
    nozzleId = null,
    sessionId = null,
    sessionPublicId = null,
    sessionReference = null,
    occurredAt = new Date(),
  }
) {
  const normalizedStationId = toPositiveInteger(stationId)
  const normalizedTransactionId = toPositiveInteger(transactionId)
  const normalizedPumpId = toPositiveInteger(pumpId)
  const normalizedNozzleId = toPositiveInteger(nozzleId)
  const normalizedSessionId = toPositiveInteger(sessionId)
  const normalizedSessionPublicId = String(sessionPublicId || "").trim() || null
  const normalizedSessionReference = String(sessionReference || "").trim() || null

  if (!normalizedStationId || !normalizedTransactionId) {
    throw badRequest("Transaction-to-pump-session linking requires station and transaction IDs.")
  }
  if (!normalizedPumpId && !normalizedSessionId && !normalizedSessionPublicId && !normalizedSessionReference) return null

  const existingLinkedSession = await fetchPumpSessionByTransactionId(db, normalizedTransactionId)
  if (existingLinkedSession) {
    assertPumpSessionMatchesScope(existingLinkedSession, {
      stationId: normalizedStationId,
      pumpId: normalizedPumpId,
      nozzleId: normalizedNozzleId,
      transactionId: normalizedTransactionId,
    })
    assertPumpSessionIdentityMatches(existingLinkedSession, {
      sessionId: normalizedSessionId,
      sessionPublicId: normalizedSessionPublicId,
      sessionReference: normalizedSessionReference,
    })
    return existingLinkedSession
  }

  if (normalizedSessionId || normalizedSessionPublicId || normalizedSessionReference) {
    const scopedSession = normalizedSessionId
      ? await fetchPumpSessionById(db, {
          stationId: normalizedStationId,
          sessionId: normalizedSessionId,
        })
      : await fetchPumpSessionByPublicIdentity(db, {
          stationId: normalizedStationId,
          sessionPublicId: normalizedSessionPublicId,
          sessionReference: normalizedSessionReference,
        })
    assertPumpSessionMatchesScope(scopedSession, {
      stationId: normalizedStationId,
      pumpId: normalizedPumpId,
      nozzleId: normalizedNozzleId,
      transactionId: normalizedTransactionId,
    })
    assertPumpSessionIdentityMatches(scopedSession, {
      sessionId: normalizedSessionId,
      sessionPublicId: normalizedSessionPublicId,
      sessionReference: normalizedSessionReference,
    })
    return persistTransactionLink(db, {
      stationId: normalizedStationId,
      sessionId: scopedSession.id,
      transactionId: normalizedTransactionId,
    })
  }

  const candidate = await findAttachablePumpSession(db, {
    stationId: normalizedStationId,
    transactionId: normalizedTransactionId,
    pumpId: normalizedPumpId,
    nozzleId: normalizedNozzleId,
    occurredAt,
  })

  if (candidate) {
    assertPumpSessionMatchesScope(candidate, {
      stationId: normalizedStationId,
      pumpId: normalizedPumpId,
      nozzleId: normalizedNozzleId,
      transactionId: normalizedTransactionId,
    })
    return persistTransactionLink(db, {
      stationId: normalizedStationId,
      sessionId: candidate.id,
      transactionId: normalizedTransactionId,
    })
  }

  return createTransactionLinkedPumpSession(db, {
    stationId: normalizedStationId,
    transactionId: normalizedTransactionId,
    pumpId: normalizedPumpId,
    nozzleId: normalizedNozzleId,
    occurredAt,
  })
}

import { Prisma } from "@prisma/client"
import { prisma } from "../../../db/prisma.js"
import { badRequest } from "../../../utils/http.js"
import { createPublicId, writeAuditLog } from "../../common/db.js"
import { isReservationsTableMissingError, parseReservationMetadata } from "../../common/reservations.js"
import { listStationPumpsWithNozzles } from "../../pumps/pumps.service.js"
import {
  PaymentStatus,
  PumpMode,
  PumpQueueState,
  PumpState,
  QueueEngine,
  QueueJobSource,
  QueueJobState,
  ReadinessSignalType,
} from "./index.js"

const HYBRID_ORDER_TYPES = Object.freeze({
  QUEUE: "QUEUE",
  RESERVATION: "RESERVATION",
})

const HYBRID_JOB_STATE_VALUES = new Set(Object.values(QueueJobState))
const HYBRID_READY_SIGNAL_VALUES = new Set(Object.values(ReadinessSignalType))
const ACTIVE_QUEUE_ENTRY_STATUSES = ["WAITING", "CALLED", "LATE", "NO_SHOW"]
const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"]

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

function toNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeHybridJobState(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return HYBRID_JOB_STATE_VALUES.has(normalized) ? normalized : null
}

function buildHybridJobId(orderType, orderPublicId) {
  return `${String(orderType || "").trim().toUpperCase()}:${String(orderPublicId || "").trim()}`
}

function splitHybridJobId(jobId) {
  const [orderType, ...rest] = String(jobId || "").split(":")
  return {
    orderType: String(orderType || "").trim().toUpperCase(),
    orderPublicId: rest.join(":").trim(),
  }
}

export function resolveHybridPaymentStatus(metadata = {}) {
  const serviceRequest =
    metadata?.serviceRequest && typeof metadata.serviceRequest === "object"
      ? metadata.serviceRequest
      : {}
  const normalizedPaymentStatus = String(
    serviceRequest.paymentStatus || metadata.paymentStatus || ""
  ).trim().toUpperCase()
  if (normalizedPaymentStatus === PaymentStatus.PAID) return PaymentStatus.PAID
  if (
    normalizedPaymentStatus === "HELD"
    || normalizedPaymentStatus === PaymentStatus.PREAUTHORIZED
    || String(serviceRequest.holdReference || "").trim()
  ) {
    return PaymentStatus.PREAUTHORIZED
  }
  if (
    normalizedPaymentStatus === "POSTED"
    || String(serviceRequest.walletTransactionReference || "").trim()
  ) {
    return PaymentStatus.PAID
  }
  return PaymentStatus.UNPAID
}

function resolveHybridSourceForQueueRow(row) {
  return Number(row?.user_id || 0) > 0
    ? QueueJobSource.DIGITAL_QUEUE
    : QueueJobSource.WALK_IN
}

function resolveHybridSourceForReservationRow() {
  return QueueJobSource.RESERVATION
}

export function resolveQueueBaseState(row, metadata = {}) {
  const hybridState = normalizeHybridJobState(metadata?.hybridQueue?.state)
  if (hybridState) return hybridState

  const workflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}
  const rowStatus = String(row?.status || "").trim().toUpperCase()
  if (rowStatus === "SERVED") return QueueJobState.COMPLETED
  if (rowStatus === "CANCELLED") return QueueJobState.CANCELLED
  if (rowStatus === "NO_SHOW") return QueueJobState.MISSED_CALL
  if (workflow.serviceStartedAt || metadata?.serviceRequest?.dispensingStartedAt) {
    return QueueJobState.FUELING
  }
  if (workflow.customerArrivedAt || metadata?.hybridQueue?.readyAt) {
    return QueueJobState.READY_ON_SITE
  }
  if (metadata?.hybridQueue?.isCommittedToLane) {
    return QueueJobState.ASSIGNED
  }
  if (rowStatus === "CALLED") return QueueJobState.CALLED
  return QueueJobState.WAITING
}

export function resolveReservationBaseState(row, metadata = {}) {
  const hybridState = normalizeHybridJobState(metadata?.hybridQueue?.state)
  if (hybridState) return hybridState

  const workflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}
  const rowStatus = String(row?.status || "").trim().toUpperCase()
  if (["FULFILLED"].includes(rowStatus)) return QueueJobState.COMPLETED
  if (["CANCELLED", "EXPIRED"].includes(rowStatus)) return QueueJobState.CANCELLED
  if (workflow.serviceStartedAt || metadata?.serviceRequest?.dispensingStartedAt) {
    return QueueJobState.FUELING
  }
  if (rowStatus === "CHECKED_IN" || workflow.customerArrivedAt || metadata?.hybridQueue?.readyAt) {
    return QueueJobState.READY_ON_SITE
  }
  if (metadata?.hybridQueue?.isCommittedToLane) {
    return QueueJobState.ASSIGNED
  }
  return QueueJobState.WAITING
}

function resolveAssignedPumpId(metadata = {}) {
  const workflow =
    metadata?.attendantWorkflow && typeof metadata.attendantWorkflow === "object"
      ? metadata.attendantWorkflow
      : {}
  return String(
    metadata?.hybridQueue?.assignedPumpId
    || metadata?.serviceRequest?.pumpPublicId
    || workflow?.pumpAssignment?.pumpPublicId
    || ""
  ).trim() || null
}

function resolveRequestedVolume(metadata = {}, row = {}) {
  return (
    toNumberOrNull(metadata?.serviceRequest?.requestedLitres)
    ?? toNumberOrNull(metadata?.requestedLitres)
    ?? toNumberOrNull(row?.requested_litres)
    ?? null
  )
}

export function toEnginePump(pump, hybridSettings, queueJobs, laneCommitments) {
  const rawStatus = String(pump?.status || "").trim().toUpperCase()
  const currentAssignmentId = String(hybridSettings?.current_assignment_public_id || "").trim() || null
  const committedVehicleCount = laneCommitments.filter(
    (item) => item.pumpId === pump.public_id && item.status === "COMMITTED"
  ).length

  let state = PumpState.IDLE
  if (rawStatus === "OFFLINE" || rawStatus === "PAUSED") {
    state = PumpState.OFFLINE
  } else if (rawStatus === "DISPENSING") {
    state = PumpState.FUELING
  } else if (
    currentAssignmentId
    || committedVehicleCount > 0
    || queueJobs.some(
      (job) =>
        job.assignedPumpId === pump.public_id
        && [QueueJobState.CALLED, QueueJobState.ASSIGNED].includes(job.state)
    )
  ) {
    state = PumpState.RESERVED
  }

  return {
    id: pump.public_id,
    name: `Pump ${pump.pump_number}`,
    fuelTypesSupported: Array.isArray(pump?.fuel_codes) ? pump.fuel_codes : [],
    mode: PumpMode.DIGITAL_PRIORITY,
    state,
    queueState:
      String(hybridSettings?.queue_state || "").trim() === PumpQueueState.DIGITAL_HOLD
        ? PumpQueueState.DIGITAL_HOLD
        : PumpQueueState.OPEN_TO_WALKINS,
    committedVehicleCount,
    currentAssignmentId,
    holdStartedAt: toIsoOrNull(hybridSettings?.hold_started_at),
    holdExpiresAt: toIsoOrNull(hybridSettings?.hold_expires_at),
  }
}

export function buildQueueJobFromQueueRow(row, laneCommitments = []) {
  const metadata = parseReservationMetadata(row?.metadata)
  const source = resolveHybridSourceForQueueRow(row)
  const state = resolveQueueBaseState(row, metadata)
  const publicId = String(row?.public_id || "").trim()
  const jobId = buildHybridJobId(HYBRID_ORDER_TYPES.QUEUE, publicId)
  const assignedPumpId = resolveAssignedPumpId(metadata)
  const isCommittedToLane =
    Boolean(metadata?.hybridQueue?.isCommittedToLane)
    || laneCommitments.some(
      (item) =>
        item.orderType === HYBRID_ORDER_TYPES.QUEUE
        && item.orderPublicId === publicId
        && item.status === "COMMITTED"
    )

  return {
    id: jobId,
    source,
    state,
    customerId: row?.user_public_id || null,
    fuelType: String(row?.fuel_code || "").trim().toUpperCase(),
    requestedVolumeLitres: resolveRequestedVolume(metadata, row),
    paymentStatus: resolveHybridPaymentStatus(metadata),
    joinedAt: toIsoOrNull(row?.joined_at) || new Date().toISOString(),
    calledAt: toIsoOrNull(row?.called_at),
    readyAt: toIsoOrNull(metadata?.hybridQueue?.readyAt || metadata?.attendantWorkflow?.customerArrivedAt),
    assignedPumpId,
    isCommittedToLane,
    priorityScore: Number(metadata?.hybridQueue?.priorityScore || 0),
    missCount: Number(metadata?.hybridQueue?.missCount || 0),
    _orderType: HYBRID_ORDER_TYPES.QUEUE,
    _orderPublicId: publicId,
    _rowId: Number(row?.id || 0) || null,
    _rowStatus: String(row?.status || "").trim().toUpperCase(),
    _metadata: metadata,
  }
}

export function buildQueueJobFromReservationRow(row, laneCommitments = []) {
  const metadata = parseReservationMetadata(row?.metadata)
  const publicId = String(row?.public_id || "").trim()
  const jobId = buildHybridJobId(HYBRID_ORDER_TYPES.RESERVATION, publicId)
  const assignedPumpId = resolveAssignedPumpId(metadata)
  const isCommittedToLane =
    Boolean(metadata?.hybridQueue?.isCommittedToLane)
    || laneCommitments.some(
      (item) =>
        item.orderType === HYBRID_ORDER_TYPES.RESERVATION
        && item.orderPublicId === publicId
        && item.status === "COMMITTED"
    )

  return {
    id: jobId,
    source: resolveHybridSourceForReservationRow(),
    state: resolveReservationBaseState(row, metadata),
    customerId: row?.user_public_id || null,
    fuelType: String(row?.fuel_code || "").trim().toUpperCase(),
    requestedVolumeLitres: resolveRequestedVolume(metadata, row),
    paymentStatus: resolveHybridPaymentStatus(metadata),
    joinedAt: toIsoOrNull(row?.created_at || row?.confirmed_at || row?.slot_start) || new Date().toISOString(),
    calledAt: toIsoOrNull(metadata?.hybridQueue?.calledAt),
    readyAt: toIsoOrNull(metadata?.hybridQueue?.readyAt || metadata?.attendantWorkflow?.customerArrivedAt || row?.confirmed_at),
    assignedPumpId,
    isCommittedToLane,
    priorityScore: Number(metadata?.hybridQueue?.priorityScore || 0),
    missCount: Number(metadata?.hybridQueue?.missCount || 0),
    _orderType: HYBRID_ORDER_TYPES.RESERVATION,
    _orderPublicId: publicId,
    _rowId: Number(row?.id || 0) || null,
    _rowStatus: String(row?.status || "").trim().toUpperCase(),
    _metadata: metadata,
  }
}

function buildLaneCommitment(row) {
  return {
    id: String(row?.public_id || row?.id || "").trim(),
    pumpId: String(row?.pump_public_id || "").trim(),
    queueJobId: buildHybridJobId(row?.order_type, row?.order_public_id),
    committedAt: toIsoOrNull(row?.committed_at) || new Date().toISOString(),
    status: String(row?.status || "").trim().toUpperCase() === "CLEARED" ? "CLEARED" : "COMMITTED",
    _rowId: Number(row?.id || 0) || null,
    _orderType: String(row?.order_type || "").trim().toUpperCase(),
    _orderPublicId: String(row?.order_public_id || "").trim(),
  }
}

function serializeHybridMetadata(job) {
  const hybridMetadata = {
    source: job.source,
    state: job.state,
    readyAt: job.readyAt || null,
    calledAt: job.calledAt || null,
    assignedPumpId: job.assignedPumpId || null,
    isCommittedToLane: Boolean(job.isCommittedToLane),
    priorityScore: Number(job.priorityScore || 0),
    missCount: Number(job.missCount || 0),
    paymentStatus: job.paymentStatus || PaymentStatus.UNPAID,
    updatedAt: new Date().toISOString(),
  }
  return hybridMetadata
}

function determineQueueRowStatus(job) {
  if (job.state === QueueJobState.MISSED_CALL) return "NO_SHOW"
  if (job.state === QueueJobState.CANCELLED) return "CANCELLED"
  if (job.state === QueueJobState.COMPLETED) return "SERVED"
  if (job.state === QueueJobState.CALLED) return "CALLED"
  return "WAITING"
}

function determineReservationRowStatus(job, currentStatus) {
  if (job.state === QueueJobState.COMPLETED) return "FULFILLED"
  if (job.state === QueueJobState.CANCELLED) return "CANCELLED"
  if (job.state === QueueJobState.READY_ON_SITE || job.state === QueueJobState.ASSIGNED || job.state === QueueJobState.FUELING) {
    return currentStatus === "CHECKED_IN" ? "CHECKED_IN" : currentStatus
  }
  return currentStatus
}

async function loadHybridReservationRows(stationId) {
  try {
    return await prisma.$queryRaw`
      SELECT
        ur.id,
        ur.public_id,
        ur.user_id,
        ur.status,
        ur.requested_litres,
        ur.confirmed_at,
        ur.fulfilled_at,
        ur.cancelled_at,
        ur.created_at,
        ur.metadata,
        u.public_id AS user_public_id,
        ft.code AS fuel_code
      FROM user_reservations ur
      LEFT JOIN users u ON u.id = ur.user_id
      LEFT JOIN fuel_types ft ON ft.id = ur.fuel_type_id
      WHERE ur.station_id = ${stationId}
        AND ur.status IN (${Prisma.join(ACTIVE_RESERVATION_STATUSES)})
    `
  } catch (error) {
    if (isReservationsTableMissingError(error)) return []
    throw error
  }
}

export async function ensureHybridQueueTablesReady(db = prisma) {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS station_hybrid_queue_settings (
      station_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      is_enabled TINYINT(1) NOT NULL DEFAULT 0,
      pilot_pump_public_id VARCHAR(64) NULL,
      queue_state VARCHAR(32) NOT NULL DEFAULT 'OPEN_TO_WALKINS',
      current_assignment_public_id VARCHAR(96) NULL,
      hold_started_at TIMESTAMP(3) NULL DEFAULT NULL,
      hold_expires_at TIMESTAMP(3) NULL DEFAULT NULL,
      digital_hold_timeout_seconds INT UNSIGNED NOT NULL DEFAULT 120,
      kiosk_walkin_redirect_message VARCHAR(255) NULL,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_station_hybrid_queue_station
        FOREIGN KEY (station_id) REFERENCES stations(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
    )
  `)

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS hybrid_lane_commitments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      public_id CHAR(26) NOT NULL,
      station_id BIGINT UNSIGNED NOT NULL,
      pump_public_id VARCHAR(64) NOT NULL,
      order_type VARCHAR(16) NOT NULL,
      order_public_id VARCHAR(64) NOT NULL,
      committed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      cleared_at TIMESTAMP(3) NULL DEFAULT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'COMMITTED',
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_hybrid_lane_commitments_public_id (public_id),
      KEY idx_hybrid_lane_station_pump_status (station_id, pump_public_id, status, committed_at),
      KEY idx_hybrid_lane_station_order_status (station_id, order_type, order_public_id, status),
      CONSTRAINT fk_hybrid_lane_station
        FOREIGN KEY (station_id) REFERENCES stations(id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE
    )
  `)
}

export async function ensureStationHybridQueueSettings(stationId, db = prisma) {
  await ensureHybridQueueTablesReady(db)
  await db.$executeRaw`
    INSERT INTO station_hybrid_queue_settings (station_id)
    VALUES (${stationId})
    ON DUPLICATE KEY UPDATE station_id = station_id
  `
  const rows = await db.$queryRaw`
    SELECT *
    FROM station_hybrid_queue_settings
    WHERE station_id = ${stationId}
    LIMIT 1
  `
  return rows?.[0] || null
}

export async function getStationHybridQueueSettings(stationId, db = prisma) {
  return ensureStationHybridQueueSettings(stationId, db)
}

async function listHybridLaneCommitmentRows(stationId, db = prisma) {
  await ensureHybridQueueTablesReady(db)
  return db.$queryRaw`
    SELECT
      id,
      public_id,
      station_id,
      pump_public_id,
      order_type,
      order_public_id,
      committed_at,
      cleared_at,
      status
    FROM hybrid_lane_commitments
    WHERE station_id = ${stationId}
      AND status = 'COMMITTED'
    ORDER BY committed_at ASC, id ASC
  `
}

async function listHybridQueueRows(stationId) {
  return prisma.$queryRaw`
    SELECT
      qe.id,
      qe.public_id,
      qe.user_id,
      qe.status,
      qe.joined_at,
      qe.called_at,
      qe.served_at,
      qe.cancelled_at,
      qe.metadata,
      u.public_id AS user_public_id,
      ft.code AS fuel_code
    FROM queue_entries qe
    LEFT JOIN users u ON u.id = qe.user_id
    LEFT JOIN fuel_types ft ON ft.id = qe.fuel_type_id
    WHERE qe.station_id = ${stationId}
      AND qe.status IN (${Prisma.join(ACTIVE_QUEUE_ENTRY_STATUSES)})
    ORDER BY qe.position ASC, qe.joined_at ASC
  `
}

async function loadHybridRuntimeSnapshot(stationId) {
  const [hybridSettings, pumps, queueRows, reservationRows, laneCommitmentRows] = await Promise.all([
    getStationHybridQueueSettings(stationId),
    listStationPumpsWithNozzles(stationId, { includeInactive: true }),
    listHybridQueueRows(stationId),
    loadHybridReservationRows(stationId),
    listHybridLaneCommitmentRows(stationId),
  ])

  const laneCommitments = (laneCommitmentRows || []).map(buildLaneCommitment)
  const queueJobs = [
    ...(queueRows || []).map((row) => buildQueueJobFromQueueRow(row, laneCommitments)),
    ...(reservationRows || []).map((row) => buildQueueJobFromReservationRow(row, laneCommitments)),
  ]

  const pilotPumpRow = (pumps || []).find(
    (pump) => String(pump?.public_id || "").trim() === String(hybridSettings?.pilot_pump_public_id || "").trim()
  ) || null

  const pilotPump = pilotPumpRow
    ? toEnginePump(pilotPumpRow, hybridSettings, queueJobs, laneCommitments)
    : null

  return {
    hybridSettings,
    pumps,
    pilotPumpRow,
    pilotPump,
    queueJobs,
    laneCommitments,
  }
}

function buildHybridQueueEngine(hybridSettings) {
  return new QueueEngine({
    digitalHoldTimeoutMs: Math.max(15, Number(hybridSettings?.digital_hold_timeout_seconds || 120)) * 1000,
    kioskWalkInRedirectMessage:
      String(hybridSettings?.kiosk_walkin_redirect_message || "").trim()
      || "Pilot pump reserved for next ready SmartLink user. Please use another pump.",
  })
}

async function persistHybridSettings(stationId, pump) {
  await prisma.$executeRaw`
    UPDATE station_hybrid_queue_settings
    SET
      queue_state = ${pump.queueState},
      current_assignment_public_id = ${pump.currentAssignmentId || null},
      hold_started_at = ${pump.holdStartedAt ? new Date(pump.holdStartedAt) : null},
      hold_expires_at = ${pump.holdExpiresAt ? new Date(pump.holdExpiresAt) : null}
    WHERE station_id = ${stationId}
  `
}

async function persistHybridJob(job) {
  const metadata = {
    ...(job._metadata || {}),
    hybridQueue: serializeHybridMetadata(job),
  }

  if (job._orderType === HYBRID_ORDER_TYPES.QUEUE) {
    await prisma.$executeRaw`
      UPDATE queue_entries
      SET
        status = ${determineQueueRowStatus(job)},
        called_at = ${job.state === QueueJobState.CALLED && job.calledAt ? new Date(job.calledAt) : null},
        metadata = ${JSON.stringify(metadata)},
        last_moved_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${job._rowId}
    `
    return
  }

  await prisma.$executeRaw`
    UPDATE user_reservations
    SET
      status = ${determineReservationRowStatus(job, job._rowStatus)},
      metadata = ${JSON.stringify(metadata)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${job._rowId}
  `
}

async function persistHybridJobs(queueJobs = []) {
  for (const job of queueJobs) {
    await persistHybridJob(job)
  }
}

export async function reconcileHybridQueueStation({
  stationId,
  now = new Date(),
  actorStaffId = null,
  auditActionType = "",
} = {}) {
  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const hybridSettings = runtime.hybridSettings || {}
  const isEnabled =
    Boolean(Number(hybridSettings?.is_enabled || 0))
    && runtime.pilotPump

  if (!isEnabled) {
    return {
      enabled: false,
      pilotPumpPublicId: String(hybridSettings?.pilot_pump_public_id || "").trim() || null,
      queueState: String(hybridSettings?.queue_state || "").trim() || PumpQueueState.OPEN_TO_WALKINS,
      kioskState: null,
      settings: hybridSettings,
    }
  }

  const engine = buildHybridQueueEngine(hybridSettings)
  let currentPump = runtime.pilotPump
  let currentJobs = engine.scoreJobs(runtime.queueJobs)
  let currentLaneCommitments = runtime.laneCommitments
  let lastDecision = null

  if (currentPump.state === PumpState.OFFLINE) {
    const offline = engine.handlePumpOffline({
      pilotPump: currentPump,
      queueJobs: currentJobs,
      laneCommitments: currentLaneCommitments,
      now,
    })
    currentPump = offline.pump
    currentJobs = offline.queueJobs
    currentLaneCommitments = offline.laneCommitments
    lastDecision = offline.decision
  } else {
    const timeoutResult = engine.processTimeouts({
      pilotPump: currentPump,
      queueJobs: currentJobs,
      laneCommitments: currentLaneCommitments,
      now,
    })
    currentPump = timeoutResult.pump
    currentJobs = timeoutResult.queueJobs
    currentLaneCommitments = timeoutResult.laneCommitments
    lastDecision = timeoutResult.decision

    const dispatchResult = engine.dispatchPilotPump({
      pilotPump: currentPump,
      queueJobs: currentJobs,
      laneCommitments: currentLaneCommitments,
      now,
    })
    currentPump = dispatchResult.pump
    currentJobs = dispatchResult.queueJobs
    currentLaneCommitments = dispatchResult.laneCommitments
    lastDecision = dispatchResult.decision
  }

  await persistHybridSettings(stationId, currentPump)
  await persistHybridJobs(currentJobs)

  if (auditActionType) {
    await writeAuditLog({
      stationId,
      actorStaffId,
      actionType: auditActionType,
      payload: {
        pilotPumpPublicId: currentPump.id,
        queueState: currentPump.queueState,
        currentAssignmentId: currentPump.currentAssignmentId,
        decision: lastDecision,
      },
    })
  }

  return {
    enabled: true,
    pilotPumpPublicId: currentPump.id,
    queueState: currentPump.queueState,
    kioskState: engine.buildKioskState({
      pilotPump: currentPump,
      queueJobs: currentJobs,
      laneCommitments: currentLaneCommitments,
    }),
    settings: hybridSettings,
  }
}

function findHybridJobByOrder(queueJobs, orderType, orderPublicId) {
  return queueJobs.find(
    (job) => job._orderType === orderType && job._orderPublicId === orderPublicId
  ) || null
}

export async function markHybridOrderReadyOnSite({
  stationId,
  orderType,
  orderPublicId,
  signalType = ReadinessSignalType.ATTENDANT_KIOSK,
  occurredAt = new Date(),
  actorStaffId = null,
  signalMetadata = null,
} = {}) {
  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const engine = buildHybridQueueEngine(runtime.hybridSettings)
  const job = findHybridJobByOrder(
    runtime.queueJobs,
    String(orderType || "").trim().toUpperCase(),
    String(orderPublicId || "").trim()
  )
  if (!job) return null

  const normalizedSignalType = String(signalType || "").trim().toUpperCase()
  if (!HYBRID_READY_SIGNAL_VALUES.has(normalizedSignalType)) {
    throw badRequest(`Unsupported readiness signal: ${signalType}`)
  }

  const signaled = engine.applyReadinessSignal({
    queueJobs: runtime.queueJobs,
    jobId: job.id,
    signalType: normalizedSignalType,
    occurredAt,
    metadata: signalMetadata || {},
  })

  await persistHybridJobs(signaled.queueJobs)
  await reconcileHybridQueueStation({
    stationId,
    now: occurredAt,
    actorStaffId,
    auditActionType: "HYBRID_QUEUE_READY_SIGNAL",
  })

  return signaled.updatedJob
}

export async function validateHybridPilotPumpAssignment({
  stationId,
  orderType,
  orderPublicId,
  pumpPublicId,
} = {}) {
  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const hybridSettings = runtime.hybridSettings || {}
  const normalizedPumpPublicId = String(pumpPublicId || "").trim()
  if (!normalizedPumpPublicId) return { allowed: true, redirectMessage: null, hybridState: null }

  const isPilotPump = normalizedPumpPublicId === String(hybridSettings?.pilot_pump_public_id || "").trim()
  if (!isPilotPump) {
    return { allowed: true, redirectMessage: null, hybridState: null }
  }

  const hybridState = await reconcileHybridQueueStation({ stationId })
  const job = findHybridJobByOrder(
    runtime.queueJobs,
    String(orderType || "").trim().toUpperCase(),
    String(orderPublicId || "").trim()
  )
  if (!job) return { allowed: true, redirectMessage: null, hybridState }

  const isWalkIn = job.source === QueueJobSource.WALK_IN
  const holdActive = hybridState?.kioskState?.digitalHoldActive === true
  if (isWalkIn && holdActive) {
    return {
      allowed: false,
      redirectMessage:
        hybridState?.kioskState?.walkInRedirectMessage
        || String(hybridSettings?.kiosk_walkin_redirect_message || "").trim()
        || "Pilot pump reserved for next ready SmartLink user. Please use another pump.",
      hybridState,
    }
  }

  return { allowed: true, redirectMessage: null, hybridState }
}

async function clearExistingLaneCommitments(stationId, orderType, orderPublicId) {
  await prisma.$executeRaw`
    UPDATE hybrid_lane_commitments
    SET
      status = 'CLEARED',
      cleared_at = CURRENT_TIMESTAMP(3)
    WHERE station_id = ${stationId}
      AND order_type = ${orderType}
      AND order_public_id = ${orderPublicId}
      AND status = 'COMMITTED'
  `
}

export async function commitHybridOrderToLane({
  stationId,
  orderType,
  orderPublicId,
  pumpPublicId,
  occurredAt = new Date(),
  actorStaffId = null,
} = {}) {
  const normalizedOrderType = String(orderType || "").trim().toUpperCase()
  const normalizedOrderPublicId = String(orderPublicId || "").trim()
  const normalizedPumpPublicId = String(pumpPublicId || "").trim()
  if (!normalizedOrderType || !normalizedOrderPublicId || !normalizedPumpPublicId) return null

  await clearExistingLaneCommitments(stationId, normalizedOrderType, normalizedOrderPublicId)
  const hybridSettings = await ensureStationHybridQueueSettings(stationId)
  const isPilotPump =
    normalizedPumpPublicId === String(hybridSettings?.pilot_pump_public_id || "").trim()

  const runtimeBeforeCommit = await loadHybridRuntimeSnapshot(stationId)
  const existingJob = findHybridJobByOrder(
    runtimeBeforeCommit.queueJobs,
    normalizedOrderType,
    normalizedOrderPublicId
  )
  if (existingJob) {
    existingJob.assignedPumpId = normalizedPumpPublicId
    existingJob.isCommittedToLane = isPilotPump
    existingJob.state = isPilotPump ? QueueJobState.ASSIGNED : existingJob.state
    await persistHybridJob(existingJob)
  }

  if (!isPilotPump) {
    return reconcileHybridQueueStation({
      stationId,
      now: occurredAt,
      actorStaffId,
      auditActionType: "HYBRID_QUEUE_ASSIGN_NON_PILOT",
    })
  }

  await ensureHybridQueueTablesReady()
  await prisma.$executeRaw`
    INSERT INTO hybrid_lane_commitments (
      public_id,
      station_id,
      pump_public_id,
      order_type,
      order_public_id,
      committed_at,
      status
    )
    VALUES (
      ${createPublicId()},
      ${stationId},
      ${normalizedPumpPublicId},
      ${normalizedOrderType},
      ${normalizedOrderPublicId},
      ${new Date(occurredAt)},
      'COMMITTED'
    )
  `

  return reconcileHybridQueueStation({
    stationId,
    now: occurredAt,
    actorStaffId,
    auditActionType: "HYBRID_QUEUE_LANE_COMMIT",
  })
}

export async function markHybridOrderFueling({
  stationId,
  orderType,
  orderPublicId,
  pumpPublicId,
  occurredAt = new Date(),
  actorStaffId = null,
} = {}) {
  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const normalizedOrderType = String(orderType || "").trim().toUpperCase()
  const normalizedOrderPublicId = String(orderPublicId || "").trim()
  const job = findHybridJobByOrder(runtime.queueJobs, normalizedOrderType, normalizedOrderPublicId)
  if (!job) return null

  job.state = QueueJobState.FUELING
  job.assignedPumpId = String(pumpPublicId || "").trim() || job.assignedPumpId
  job.isCommittedToLane = true
  await persistHybridJob(job)

  return reconcileHybridQueueStation({
    stationId,
    now: occurredAt,
    actorStaffId,
    auditActionType: "HYBRID_QUEUE_FUELING_START",
  })
}

export async function completeHybridOrderFlow({
  stationId,
  orderType,
  orderPublicId,
  occurredAt = new Date(),
  actorStaffId = null,
} = {}) {
  const normalizedOrderType = String(orderType || "").trim().toUpperCase()
  const normalizedOrderPublicId = String(orderPublicId || "").trim()
  await clearExistingLaneCommitments(stationId, normalizedOrderType, normalizedOrderPublicId)

  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const job = findHybridJobByOrder(runtime.queueJobs, normalizedOrderType, normalizedOrderPublicId)
  if (job) {
    job.state = QueueJobState.COMPLETED
    job.isCommittedToLane = false
    await persistHybridJob(job)
  }

  return reconcileHybridQueueStation({
    stationId,
    now: occurredAt,
    actorStaffId,
    auditActionType: "HYBRID_QUEUE_ORDER_COMPLETE",
  })
}

export async function clearHybridOrderFlow({
  stationId,
  orderType,
  orderPublicId,
  nextState = QueueJobState.CANCELLED,
  occurredAt = new Date(),
  actorStaffId = null,
} = {}) {
  const normalizedOrderType = String(orderType || "").trim().toUpperCase()
  const normalizedOrderPublicId = String(orderPublicId || "").trim()
  await clearExistingLaneCommitments(stationId, normalizedOrderType, normalizedOrderPublicId)

  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const job = findHybridJobByOrder(runtime.queueJobs, normalizedOrderType, normalizedOrderPublicId)
  if (job) {
    job.state = nextState
    job.isCommittedToLane = false
    job.assignedPumpId = null
    await persistHybridJob(job)
  }

  return reconcileHybridQueueStation({
    stationId,
    now: occurredAt,
    actorStaffId,
    auditActionType: "HYBRID_QUEUE_ORDER_CLEAR",
  })
}

export async function patchStationHybridQueueSettings({
  stationId,
  payload,
  actorStaffId = null,
} = {}) {
  const current = await ensureStationHybridQueueSettings(stationId)
  const patch = { ...payload }
  const fields = []
  const values = []

  if (patch.is_enabled !== undefined) {
    fields.push("is_enabled = ?")
    values.push(Boolean(patch.is_enabled))
  }
  if (patch.pilot_pump_public_id !== undefined) {
    fields.push("pilot_pump_public_id = ?")
    values.push(String(patch.pilot_pump_public_id || "").trim() || null)
  }
  if (patch.digital_hold_timeout_seconds !== undefined) {
    fields.push("digital_hold_timeout_seconds = ?")
    values.push(Math.max(15, Number(patch.digital_hold_timeout_seconds || 0)))
  }
  if (patch.kiosk_walkin_redirect_message !== undefined) {
    fields.push("kiosk_walkin_redirect_message = ?")
    values.push(String(patch.kiosk_walkin_redirect_message || "").trim() || null)
  }

  if (!fields.length) return current

  await prisma.$executeRawUnsafe(
    `UPDATE station_hybrid_queue_settings SET ${fields.join(", ")} WHERE station_id = ?`,
    ...values,
    stationId
  )

  await writeAuditLog({
    stationId,
    actorStaffId,
    actionType: "HYBRID_QUEUE_SETTINGS_UPDATE",
    payload: patch,
  })

  return ensureStationHybridQueueSettings(stationId)
}

export async function getHybridQueueSnapshot(stationId) {
  return reconcileHybridQueueStation({ stationId })
}

export async function applyHybridReadySignalForUserPresence({
  stationId,
  userPublicId,
  occurredAt = new Date(),
  signalType = ReadinessSignalType.GEOFENCE,
  actorStaffId = null,
} = {}) {
  const normalizedUserPublicId = String(userPublicId || "").trim()
  if (!normalizedUserPublicId) return null

  const runtime = await loadHybridRuntimeSnapshot(stationId)
  const candidate = runtime.queueJobs.find(
    (job) =>
      String(job.customerId || "").trim() === normalizedUserPublicId
      && [QueueJobSource.DIGITAL_QUEUE, QueueJobSource.RESERVATION].includes(job.source)
      && ![QueueJobState.COMPLETED, QueueJobState.CANCELLED, QueueJobState.MISSED_CALL].includes(job.state)
  ) || null

  if (!candidate) return null

  return markHybridOrderReadyOnSite({
    stationId,
    orderType: candidate._orderType,
    orderPublicId: candidate._orderPublicId,
    signalType,
    occurredAt,
    actorStaffId,
    signalMetadata: {
      source: "presence_event",
    },
  })
}

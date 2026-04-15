export const PumpMode = Object.freeze({
  NORMAL: "NORMAL",
  DIGITAL_PRIORITY: "DIGITAL_PRIORITY",
})

export const PumpState = Object.freeze({
  IDLE: "IDLE",
  RESERVED: "RESERVED",
  FUELING: "FUELING",
  OFFLINE: "OFFLINE",
})

export const PumpQueueState = Object.freeze({
  OPEN_TO_WALKINS: "OPEN_TO_WALKINS",
  DIGITAL_HOLD: "DIGITAL_HOLD",
})

export const QueueJobSource = Object.freeze({
  WALK_IN: "WALK_IN",
  DIGITAL_QUEUE: "DIGITAL_QUEUE",
  RESERVATION: "RESERVATION",
  READY_NOW_APP: "READY_NOW_APP",
})

export const QueueJobState = Object.freeze({
  WAITING: "WAITING",
  CALLED: "CALLED",
  READY_ON_SITE: "READY_ON_SITE",
  ASSIGNED: "ASSIGNED",
  FUELING: "FUELING",
  COMPLETED: "COMPLETED",
  MISSED_CALL: "MISSED_CALL",
  CANCELLED: "CANCELLED",
})

export const PaymentStatus = Object.freeze({
  UNPAID: "UNPAID",
  PREAUTHORIZED: "PREAUTHORIZED",
  PAID: "PAID",
})

export const LaneCommitmentStatus = Object.freeze({
  COMMITTED: "COMMITTED",
  CLEARED: "CLEARED",
})

export const ReadinessSignalType = Object.freeze({
  ATTENDANT_KIOSK: "ATTENDANT_KIOSK",
  QR_SCAN: "QR_SCAN",
  BLE_NFC: "BLE_NFC",
  GEOFENCE: "GEOFENCE",
})

export const DIGITAL_SOURCES = new Set([
  QueueJobSource.DIGITAL_QUEUE,
  QueueJobSource.RESERVATION,
  QueueJobSource.READY_NOW_APP,
])

export const TERMINAL_QUEUE_JOB_STATES = new Set([
  QueueJobState.COMPLETED,
  QueueJobState.CANCELLED,
  QueueJobState.MISSED_CALL,
])

/**
 * @typedef {object} Pump
 * @property {string} id
 * @property {string} name
 * @property {string[]} fuelTypesSupported
 * @property {"NORMAL"|"DIGITAL_PRIORITY"} mode
 * @property {"IDLE"|"RESERVED"|"FUELING"|"OFFLINE"} state
 * @property {"OPEN_TO_WALKINS"|"DIGITAL_HOLD"} queueState
 * @property {number} committedVehicleCount
 * @property {string|null} currentAssignmentId
 * @property {string|null} holdStartedAt
 * @property {string|null} holdExpiresAt
 */

/**
 * @typedef {object} QueueJob
 * @property {string} id
 * @property {"WALK_IN"|"DIGITAL_QUEUE"|"RESERVATION"|"READY_NOW_APP"} source
 * @property {"WAITING"|"CALLED"|"READY_ON_SITE"|"ASSIGNED"|"FUELING"|"COMPLETED"|"MISSED_CALL"|"CANCELLED"} state
 * @property {string|null} customerId
 * @property {string} fuelType
 * @property {number|null} requestedVolumeLitres
 * @property {"UNPAID"|"PREAUTHORIZED"|"PAID"} paymentStatus
 * @property {string} joinedAt
 * @property {string|null} calledAt
 * @property {string|null} readyAt
 * @property {string|null} assignedPumpId
 * @property {boolean} isCommittedToLane
 * @property {number} priorityScore
 * @property {number} missCount
 */

/**
 * @typedef {object} LaneCommitment
 * @property {string} id
 * @property {string} pumpId
 * @property {string} queueJobId
 * @property {string} committedAt
 * @property {"COMMITTED"|"CLEARED"} status
 */

function toTimeMs(value, fallback = Number.POSITIVE_INFINITY) {
  if (!value) return fallback
  const parsed = new Date(value)
  const time = parsed.getTime()
  return Number.isFinite(time) ? time : fallback
}

export function toIsoString(value = new Date()) {
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
  }
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function addMs(isoValue, ms) {
  return new Date(toTimeMs(isoValue, Date.now()) + ms).toISOString()
}

export function isDigitalSource(source) {
  return DIGITAL_SOURCES.has(String(source || "").trim().toUpperCase())
}

export function isTerminalQueueJobState(state) {
  return TERMINAL_QUEUE_JOB_STATES.has(String(state || "").trim().toUpperCase())
}

export function isCompatibleFuel(pump, fuelType) {
  const normalizedFuelType = String(fuelType || "").trim().toUpperCase()
  if (!normalizedFuelType) return false
  const supportedFuelTypes = Array.isArray(pump?.fuelTypesSupported) ? pump.fuelTypesSupported : []
  return supportedFuelTypes.some(
    (item) => String(item || "").trim().toUpperCase() === normalizedFuelType
  )
}

export function clonePump(pump) {
  return {
    ...pump,
    fuelTypesSupported: Array.isArray(pump?.fuelTypesSupported) ? [...pump.fuelTypesSupported] : [],
  }
}

export function cloneQueueJob(job) {
  return {
    ...job,
  }
}

export function cloneLaneCommitment(commitment) {
  return {
    ...commitment,
  }
}

export function buildJobMap(queueJobs = []) {
  return new Map(queueJobs.map((job) => [job.id, job]))
}

export function compareJobsByPriority(left, right) {
  const leftScore = Number(left?.priorityScore || 0)
  const rightScore = Number(right?.priorityScore || 0)
  if (leftScore !== rightScore) return rightScore - leftScore

  const leftReadyTime = toTimeMs(left?.readyAt)
  const rightReadyTime = toTimeMs(right?.readyAt)
  if (leftReadyTime !== rightReadyTime) return leftReadyTime - rightReadyTime

  const leftJoinedTime = toTimeMs(left?.joinedAt)
  const rightJoinedTime = toTimeMs(right?.joinedAt)
  if (leftJoinedTime !== rightJoinedTime) return leftJoinedTime - rightJoinedTime

  const leftMissCount = Number(left?.missCount || 0)
  const rightMissCount = Number(right?.missCount || 0)
  if (leftMissCount !== rightMissCount) return leftMissCount - rightMissCount

  return String(left?.id || "").localeCompare(String(right?.id || ""))
}

export function getActiveLaneCommitmentsForPump(pumpId, laneCommitments = [], queueJobs = []) {
  const jobsById = buildJobMap(queueJobs)
  return laneCommitments
    .filter((commitment) => {
      if (commitment?.pumpId !== pumpId) return false
      if (commitment?.status !== LaneCommitmentStatus.COMMITTED) return false
      const job = jobsById.get(commitment.queueJobId)
      return job && !isTerminalQueueJobState(job.state)
    })
    .sort((left, right) => toTimeMs(left?.committedAt) - toTimeMs(right?.committedAt))
}

export function recalculateCommittedVehicleCount(pump, laneCommitments = [], queueJobs = []) {
  return getActiveLaneCommitmentsForPump(pump.id, laneCommitments, queueJobs).length
}

export function findQueueJob(queueJobs = [], jobId) {
  return queueJobs.find((job) => job.id === jobId) || null
}

export function findAssignedDigitalCall(queueJobs = [], pumpId) {
  return (
    queueJobs.find((job) => {
      if (job?.assignedPumpId !== pumpId) return false
      if (!isDigitalSource(job?.source)) return false
      if (job?.isCommittedToLane) return false
      return job?.state === QueueJobState.CALLED
    })
    || null
  )
}

export function buildLaneCommitmentId(pumpId, queueJobId, now) {
  const timestamp = String(toTimeMs(now, Date.now()))
  return `LC-${pumpId}-${queueJobId}-${timestamp}`
}

export function mapDigitalUserStatus(job) {
  if (!job) return "waiting"
  if (job.state === QueueJobState.MISSED_CALL) return "missed"
  if (job.state === QueueJobState.CALLED || job.state === QueueJobState.ASSIGNED) return "called"
  if (job.state === QueueJobState.READY_ON_SITE || job.state === QueueJobState.FUELING) return "ready"
  return "waiting"
}

export function resolveCommittedCarsAheadForTarget(targetJob, laneCommitments = [], queueJobs = []) {
  if (!targetJob) return 0
  const activeCommitments = getActiveLaneCommitmentsForPump(
    targetJob.assignedPumpId,
    laneCommitments,
    queueJobs
  )

  if (!targetJob.isCommittedToLane) {
    return activeCommitments.length
  }

  const index = activeCommitments.findIndex((commitment) => commitment.queueJobId === targetJob.id)
  return index > 0 ? index : 0
}

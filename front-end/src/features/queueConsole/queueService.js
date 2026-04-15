/**
 * Mock in-memory queue service.
 * TODO: Replace internals with HTTP calls + websocket updates when backend is ready.
 */
import { formatTime } from "../../utils/dateTime"

const ACTION_ACTOR = "Manager"
const NETWORK_DELAY_MS = 120

const now = () => new Date()
const toIso = (date) => date.toISOString()
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000)

function wait() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, NETWORK_DELAY_MS)
  })
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function maskPlate(plate) {
  if (!plate || plate.length < 4) return plate
  return `${plate.slice(0, 2)}***${plate.slice(-2)}`
}

const seedEntries = [
  { id: "Q-3001", plate: "BT7077", joinedAt: addMinutes(now(), -18), status: "Waiting", etaMinutes: 7 },
  { id: "Q-3002", plate: "MC892C", joinedAt: addMinutes(now(), -12), status: "Waiting", etaMinutes: 10 },
  { id: "Q-3003", plate: "ZR4421", joinedAt: addMinutes(now(), -9), status: "Called", etaMinutes: 4 },
  { id: "Q-3004", plate: "LN132A", joinedAt: addMinutes(now(), -4), status: "Waiting", etaMinutes: 13 },
]

const seedPumps = [
  { id: "P1", label: "Pump 1", status: "Active", fuelType: "petrol", reason: "" },
  { id: "P2", label: "Pump 2", status: "Paused", fuelType: "diesel", reason: "Calibration" },
  { id: "P3", label: "Pump 3", status: "Offline", fuelType: "petrol", reason: "Sensor fault" },
]

const store = {
  stationId: "station-central-1",
  stationName: "Central Station",
  stationStatus: "Online",
  lastUpdatedAt: toIso(now()),
  lastMovementAt: toIso(now()),
  settings: {
    graceMinutes: 3,
    capacity: 30,
    joinsPaused: false,
    fuelTypes: { petrol: true, diesel: true },
  },
  priorityMode: "HYBRID",
  hybridRatio: 2,
  currentCall: null,
  entriesById: {},
  queueOrder: [],
  pumpsById: {},
  pumpOrder: [],
  auditLogs: [],
}

for (const entry of seedEntries) {
  store.entriesById[entry.id] = {
    ...entry,
    joinedAt: toIso(entry.joinedAt),
    joinTime: formatTime(entry.joinedAt, { hour: "2-digit", minute: "2-digit" }),
    calledAt: null,
    graceExpiresAt: null,
    maskedIdentifier: maskPlate(entry.plate),
  }
  store.queueOrder.push(entry.id)
}

for (const pump of seedPumps) {
  store.pumpsById[pump.id] = { ...pump }
  store.pumpOrder.push(pump.id)
}

const activeCalled = store.entriesById["Q-3003"]
if (activeCalled) {
  const calledAt = now()
  const graceExpiresAt = addMinutes(calledAt, store.settings.graceMinutes)
  activeCalled.calledAt = toIso(calledAt)
  activeCalled.graceExpiresAt = toIso(graceExpiresAt)
  store.currentCall = {
    entryId: activeCalled.id,
    calledAt: activeCalled.calledAt,
    graceExpiresAt: activeCalled.graceExpiresAt,
    recallCount: 0,
  }
}

function touch(isMovement = false) {
  store.lastUpdatedAt = toIso(now())
  if (isMovement) {
    store.lastMovementAt = store.lastUpdatedAt
  }
}

function appendAuditInternal(actionType, payload = {}, summary = "") {
  const entry = {
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    timestamp: toIso(now()),
    actor: ACTION_ACTOR,
    actionType,
    summary: summary || actionType,
    payload,
  }
  store.auditLogs.unshift(entry)
  if (store.auditLogs.length > 120) {
    store.auditLogs = store.auditLogs.slice(0, 120)
  }
}

function activeQueueIds() {
  return store.queueOrder.filter((id) => {
    const status = store.entriesById[id]?.status
    return status === "Waiting" || status === "Called" || status === "Late"
  })
}

function sanitizeCurrentCall() {
  if (!store.currentCall) return
  const entry = store.entriesById[store.currentCall.entryId]
  if (!entry || (entry.status !== "Called" && entry.status !== "Late")) {
    store.currentCall = null
  }
}

function snapshot() {
  sanitizeCurrentCall()
  const orderedIds = [...store.queueOrder]
  const orderedEntries = orderedIds.map((id) => store.entriesById[id]).filter(Boolean)
  const entriesNotInOrder = Object.values(store.entriesById).filter((entry) => !orderedIds.includes(entry.id))

  return clone({
    stationId: store.stationId,
    stationName: store.stationName,
    stationStatus: store.stationStatus,
    lastUpdatedAt: store.lastUpdatedAt,
    lastMovementAt: store.lastMovementAt,
    settings: store.settings,
    priorityMode: store.priorityMode,
    hybridRatio: store.hybridRatio,
    currentCall: store.currentCall,
    entries: [...orderedEntries, ...entriesNotInOrder],
    pumps: store.pumpOrder.map((id) => store.pumpsById[id]).filter(Boolean),
    auditLogs: store.auditLogs,
  })
}

function moveToEnd(entryId) {
  store.queueOrder = store.queueOrder.filter((id) => id !== entryId)
  store.queueOrder.push(entryId)
}

function removeFromOrder(entryId) {
  store.queueOrder = store.queueOrder.filter((id) => id !== entryId)
}

function callEntry(entryId, source = "call_next", reason = "") {
  const entry = store.entriesById[entryId]
  if (!entry) return

  const calledAt = now()
  const graceExpiresAt = addMinutes(calledAt, store.settings.graceMinutes)
  entry.status = "Called"
  entry.calledAt = toIso(calledAt)
  entry.graceExpiresAt = toIso(graceExpiresAt)

  const previousRecallCount =
    store.currentCall?.entryId === entryId ? Number(store.currentCall.recallCount || 0) : 0

  store.currentCall = {
    entryId,
    calledAt: entry.calledAt,
    graceExpiresAt: entry.graceExpiresAt,
    recallCount: source === "recall" ? previousRecallCount + 1 : previousRecallCount,
  }

  touch(true)
  appendAuditInternal("CALL_ENTRY", { entryId, source, reason }, `${entry.plate} called (${source})`)
}

export const queueService = {
  async getSnapshot() {
    await wait()
    touch(false)
    return snapshot()
  },

  async callNext() {
    await wait()
    const nextId = activeQueueIds().find((id) => {
      const status = store.entriesById[id]?.status
      return status === "Waiting" || status === "Late"
    })

    if (!nextId) {
      appendAuditInternal("CALL_NEXT_NOOP", {}, "Call next attempted with no waiting entries")
      touch(false)
      return snapshot()
    }

    callEntry(nextId, "call_next")
    return snapshot()
  },

  async recall() {
    await wait()
    const active = store.currentCall
    if (!active) {
      appendAuditInternal("RECALL_NOOP", {}, "Re-call attempted with no active call")
      touch(false)
      return snapshot()
    }
    callEntry(active.entryId, "recall")
    return snapshot()
  },

  async callPosition(position, reason = "") {
    await wait()
    const target = activeQueueIds()[Math.max(0, Number(position) - 1)]
    if (!target) {
      appendAuditInternal("CALL_POSITION_NOOP", { position, reason }, "Invalid call position")
      touch(false)
      return snapshot()
    }
    callEntry(target, "call_position", reason)
    return snapshot()
  },

  async markLate(entryId) {
    await wait()
    const entry = store.entriesById[entryId]
    if (!entry) return snapshot()
    entry.status = "Late"
    touch(true)
    appendAuditInternal("MARK_LATE", { entryId }, `${entry.plate} marked late`)
    return snapshot()
  },

  async markNoShow(entryId, behavior = "move_to_end") {
    await wait()
    const entry = store.entriesById[entryId]
    if (!entry) return snapshot()

    if (behavior === "remove") {
      entry.status = "No-show"
      removeFromOrder(entryId)
    } else {
      entry.status = "Waiting"
      moveToEnd(entryId)
    }

    if (store.currentCall?.entryId === entryId) {
      store.currentCall = null
    }

    touch(true)
    appendAuditInternal(
      "MARK_NO_SHOW",
      { entryId, behavior },
      `${entry.plate} marked no-show (${behavior})`
    )
    return snapshot()
  },

  async markServed(entryId, servedMeta = {}) {
    await wait()
    const entry = store.entriesById[entryId]
    if (!entry) return snapshot()

    entry.status = "Served"
    entry.servedMeta = { ...servedMeta, servedAt: toIso(now()) }
    removeFromOrder(entryId)

    if (store.currentCall?.entryId === entryId) {
      store.currentCall = null
    }

    touch(true)
    appendAuditInternal("MARK_SERVED", { entryId, servedMeta }, `${entry.plate} marked served`)
    return snapshot()
  },

  async updatePumpStatus(pumpId, status, reason = "") {
    await wait()
    const pump = store.pumpsById[pumpId]
    if (!pump) return snapshot()
    pump.status = status
    pump.reason = reason
    touch(false)
    appendAuditInternal("UPDATE_PUMP_STATUS", { pumpId, status, reason }, `${pump.label} set to ${status}`)
    return snapshot()
  },

  async updateSettings(partialSettings) {
    await wait()
    store.settings = {
      ...store.settings,
      ...partialSettings,
      fuelTypes: {
        ...store.settings.fuelTypes,
        ...(partialSettings?.fuelTypes || {}),
      },
    }
    touch(false)
    appendAuditInternal("UPDATE_SETTINGS", { partialSettings }, "Queue settings updated")
    return snapshot()
  },

  async setPriorityMode(mode, hybridRatio = store.hybridRatio) {
    await wait()
    store.priorityMode = mode
    store.hybridRatio = Number(hybridRatio) > 0 ? Number(hybridRatio) : 1
    touch(false)
    appendAuditInternal(
      "SET_PRIORITY_MODE",
      { mode, hybridRatio: store.hybridRatio },
      `Priority mode set to ${mode}`
    )
    return snapshot()
  },

  async pauseJoins() {
    await wait()
    store.settings.joinsPaused = true
    touch(false)
    appendAuditInternal("PAUSE_JOINS", {}, "Queue joins paused")
    return snapshot()
  },

  async resumeJoins() {
    await wait()
    store.settings.joinsPaused = false
    touch(false)
    appendAuditInternal("RESUME_JOINS", {}, "Queue joins resumed")
    return snapshot()
  },

  async appendAudit(actionType, payload = {}) {
    await wait()
    appendAuditInternal(actionType, payload, actionType)
    touch(false)
    return snapshot()
  },
}

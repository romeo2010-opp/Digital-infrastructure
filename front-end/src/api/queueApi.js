import { httpClient } from "./httpClient"
import { getRoleCode, getStationPublicId } from "../auth/authSession"
import { formatTime } from "../utils/dateTime"

const QUEUE_WRITE_ROLES = new Set(["MANAGER", "ATTENDANT"])

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function assertQueueWriteAccess() {
  const role = getRoleCode()
  if (!QUEUE_WRITE_ROLES.has(role)) {
    throw new Error("Forbidden: your role cannot perform queue operator actions.")
  }
}

function mapSnapshot(snapshot, stationPublicId) {
  const settings = snapshot.settings || {}
  const toQueueStatusLabel = (value) =>
    String(value || "")
      .replace("READY_ON_SITE", "Ready on site")
      .replace("MISSED_CALL", "Missed call")
      .replace("NO_SHOW", "No-show")
      .replace("WAITING", "Waiting")
      .replace("CALLED", "Called")
      .replace("LATE", "Late")
      .replace("ASSIGNED", "Assigned")
      .replace("FUELING", "Fueling")
      .replace("SERVED", "Served")
      .replace("COMPLETED", "Completed")
      .replace("CANCELLED", "Cancelled")

  return {
    stationId: stationPublicId,
    stationName: snapshot.stationName || "Station",
    stationStatus: snapshot.stationStatus || "Online",
    lastUpdatedAt: snapshot.lastUpdatedAt || new Date().toISOString(),
    lastMovementAt: snapshot.lastMovementTime || new Date().toISOString(),
    settings: {
      graceMinutes: Number(settings.grace_minutes || 10),
      capacity: Number(settings.capacity || 100),
      joinsPaused: Boolean(Number(settings.joins_paused || 0)),
      fuelTypes: {
        petrol: Boolean(Number(settings.petrol_enabled || 1)),
        diesel: Boolean(Number(settings.diesel_enabled || 1)),
      },
    },
    priorityMode: settings.priority_mode || "ON",
    hybridRatio: Number(settings.hybrid_queue_n || 2),
    currentCall: snapshot.currentCall
      ? {
          entryId: snapshot.currentCall.entryPublicId,
          calledAt: snapshot.currentCall.calledAt,
          graceExpiresAt: snapshot.currentCall.graceExpiresAt,
          recallCount: 0,
        }
      : null,
    entries: (snapshot.entries || []).map((entry) => ({
      id: entry.entryPublicId,
      plate: entry.maskedPlate || "UNKNOWN",
      maskedIdentifier: entry.maskedPlate || "UNKNOWN",
      joinTime: formatTime(entry.joinedAt, { hour: "2-digit", minute: "2-digit" }),
      joinedAt: entry.joinedAt,
      status: toQueueStatusLabel(entry.effectiveStatus || entry.status),
      baseStatus: toQueueStatusLabel(entry.status),
      etaMinutes: 5,
      calledAt: entry.calledAt,
      graceExpiresAt: entry.graceExpiresAt,
    })),
    pumps: snapshot.pumps || [],
    auditLogs: snapshot.auditLogs || [],
  }
}

export const queueApi = {
  async getSnapshot() {
    const stationPublicId = stationPublicIdOrThrow()
    const data = await httpClient.get(`/api/stations/${stationPublicId}/queue/snapshot`)
    return mapSnapshot(data, stationPublicId)
  },
  async callNext() {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.post(`/api/stations/${stationPublicId}/queue/call-next`, {})
    return this.getSnapshot()
  },
  async recall() {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    const snapshot = await this.getSnapshot()
    if (!snapshot.currentCall?.entryId) return snapshot
    await httpClient.post(`/api/stations/${stationPublicId}/queue/recall`, {
      entryPublicId: snapshot.currentCall.entryId,
    })
    return this.getSnapshot()
  },
  async callPosition(position, reason) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.post(`/api/stations/${stationPublicId}/queue/call-position`, { position, reason })
    return this.getSnapshot()
  },
  async markLate(entryId) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.post(`/api/stations/${stationPublicId}/queue/${entryId}/late`, {})
    return this.getSnapshot()
  },
  async markNoShow(entryId, behavior = "move_to_end") {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.post(`/api/stations/${stationPublicId}/queue/${entryId}/no-show`, { behavior })
    return this.getSnapshot()
  },
  async markServed(entryId, servedMeta = {}) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.post(`/api/stations/${stationPublicId}/queue/${entryId}/served`, {
      litres: servedMeta.liters,
      amount: servedMeta.amount,
      paymentMethod: servedMeta.paymentMethod,
    })
    return this.getSnapshot()
  },
  async updateSettings(partialSettings) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    const payload = {
      grace_minutes: partialSettings.graceMinutes,
      capacity: partialSettings.capacity,
      joins_paused: partialSettings.joinsPaused,
      petrol_enabled: partialSettings?.fuelTypes?.petrol,
      diesel_enabled: partialSettings?.fuelTypes?.diesel,
    }
    await httpClient.patch(`/api/stations/${stationPublicId}/queue/settings`, payload)
    return this.getSnapshot()
  },
  async setPriorityMode(mode, hybridRatio) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.patch(`/api/stations/${stationPublicId}/queue/settings`, {
      priority_mode: mode,
      hybrid_queue_n: hybridRatio || 2,
      hybrid_walkin_n: 1,
    })
    return this.getSnapshot()
  },
  async pauseJoins() {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.patch(`/api/stations/${stationPublicId}/queue/settings`, { joins_paused: true })
    return this.getSnapshot()
  },
  async resumeJoins() {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    await httpClient.patch(`/api/stations/${stationPublicId}/queue/settings`, { joins_paused: false })
    return this.getSnapshot()
  },
  async appendAudit(actionType, payload = {}) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/audit`, { actionType, payload })
  },
  async updatePumpStatus(pumpPublicId, status, reason) {
    assertQueueWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    const normalized = String(status || "").trim().toUpperCase()
    const backendStatus = ["ACTIVE", "PAUSED", "OFFLINE", "IDLE"].includes(normalized)
      ? normalized
      : "ACTIVE"
    await httpClient.patch(`/api/stations/${stationPublicId}/pumps/${pumpPublicId}/status`, {
      status: backendStatus,
      reason,
    })
    return this.getSnapshot()
  },
}

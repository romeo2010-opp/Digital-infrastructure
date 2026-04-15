import { getSessionMeta, getStationPublicId } from "../auth/authSession"
import { getOrCreateDeviceId, putOutboxEvent } from "./db"
import { isBrowserOnline } from "./network"
import { refreshOfflinePendingCount, syncNow } from "./sync"

function nowIso() {
  return new Date().toISOString()
}

function createEventId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function stationIdOrThrow() {
  const stationId = getStationPublicId()
  if (!stationId) throw new Error("No active station scope in auth session")
  return stationId
}

function actorUserIdOrFallback() {
  const session = getSessionMeta()
  return session?.user?.publicId || "UNKNOWN_USER"
}

export async function recordAction(type, payload, options = {}) {
  const stationId = options.stationId || stationIdOrThrow()
  const deviceId = options.deviceId || (await getOrCreateDeviceId())
  const occurredAt = options.occurredAt || nowIso()
  const createdAtLocal = nowIso()

  const event = await putOutboxEvent({
    eventId: createEventId(),
    stationId,
    deviceId,
    actorUserId: options.actorUserId || actorUserIdOrFallback(),
    type,
    payload: payload || {},
    occurredAt,
    createdAtLocal,
    status: "PENDING",
    attempts: 0,
    nextRetryAt: createdAtLocal,
    lastError: null,
  })

  await refreshOfflinePendingCount()

  if (!isBrowserOnline()) {
    return { event, queued: true, synced: false }
  }

  const result = await syncNow().catch(() => ({ ackedEventIds: [] }))
  const synced = (result?.ackedEventIds || []).includes(event.eventId)
  return {
    event,
    queued: !synced,
    synced,
  }
}

export async function recordActions(actionSpecs = []) {
  const events = []
  for (const spec of actionSpecs) {
    if (!spec?.type) continue
    const stationId = spec.stationId || stationIdOrThrow()
    const deviceId = spec.deviceId || (await getOrCreateDeviceId())
    const createdAtLocal = nowIso()
    events.push(
      await putOutboxEvent({
        eventId: createEventId(),
        stationId,
        deviceId,
        actorUserId: spec.actorUserId || actorUserIdOrFallback(),
        type: spec.type,
        payload: spec.payload || {},
        occurredAt: spec.occurredAt || createdAtLocal,
        createdAtLocal,
        status: "PENDING",
        attempts: 0,
        nextRetryAt: createdAtLocal,
        lastError: null,
      })
    )
  }

  await refreshOfflinePendingCount()

  if (!events.length || !isBrowserOnline()) {
    return { events, queued: true, syncedEventIds: [] }
  }

  const result = await syncNow().catch(() => ({ ackedEventIds: [] }))
  const syncedEventIds = result?.ackedEventIds || []
  return {
    events,
    queued: syncedEventIds.length !== events.length,
    syncedEventIds,
  }
}

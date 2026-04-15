import { getAccessToken, getRoleCode, getStationPublicId } from "../auth/authSession"
import {
  getOrCreateDeviceId,
  getPendingCount,
  getPendingEvents,
  markOutboxEventsAcked,
  patchOutboxEvent,
  schedulePendingEventsNow,
} from "./db"
import {
  initOfflineNetworkState,
  isBrowserOnline,
  setOfflineLastSyncAt,
  setOfflineNetworkState,
  setOfflinePendingCount,
  setOfflineSyncState,
} from "./network"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""
const HEALTH_PATH = "/api/health"
const SYNC_PATH = "/api/sync/events"
const POLL_INTERVAL_MS = 15_000
const BATCH_SIZE = 50
const FORCE_SCHEDULE_LIMIT = 5000
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]
const SYNC_WRITE_ROLES = new Set(["MANAGER", "ATTENDANT"])

let started = false
let running = false
let intervalId = null
let onlineListenerBound = false

function retryDelayByAttempt(attempts) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(attempts || 1) - 1))
  return RETRY_DELAYS_MS[index]
}

function authHeaders() {
  const accessToken = getAccessToken()
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

async function markEventsForRetry(events, defaultError = "Sync failed", failureById = {}) {
  const now = Date.now()
  const patchedAtIso = new Date(now).toISOString()

  for (const event of events) {
    const attempts = Number(event.attempts || 0) + 1
    const delayMs = retryDelayByAttempt(attempts)
    const retryAtIso = new Date(now + delayMs).toISOString()
    const error = failureById[event.eventId] || defaultError

    await patchOutboxEvent(event.eventId, {
      status: "PENDING",
      attempts,
      nextRetryAt: retryAtIso,
      lastError: String(error || defaultError).slice(0, 500),
      lastAttemptAt: patchedAtIso,
    })
  }
}

async function pingHealth() {
  if (!isBrowserOnline()) {
    setOfflineNetworkState(false)
    return false
  }

  try {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      method: "GET",
      credentials: "include",
    })
    const reachable = response.ok
    setOfflineNetworkState(reachable)
    return reachable
  } catch {
    setOfflineNetworkState(false)
    return false
  }
}

async function postEventsBatch(stationId, deviceId, events) {
  const response = await fetch(`${baseUrl}${SYNC_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      stationId,
      deviceId,
      events,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Sync failed: ${response.status}`)
  }
  return payload.data || payload
}

function normalizeAcked(acked = []) {
  return (acked || [])
    .map((item) => (typeof item === "string" ? item : item?.eventId))
    .filter(Boolean)
}

function normalizeFailed(failed = []) {
  const result = []
  for (const item of failed || []) {
    if (!item) continue
    if (typeof item === "string") {
      result.push({ eventId: item, error: "Failed on server" })
      continue
    }
    if (item.eventId) {
      result.push({
        eventId: item.eventId,
        error: item.error || "Failed on server",
      })
    }
  }
  return result
}

export async function refreshOfflinePendingCount() {
  try {
    const count = await getPendingCount()
    setOfflinePendingCount(count)
    return count
  } catch {
    return 0
  }
}

export async function syncNow(options = {}) {
  if (running) return { ackedEventIds: [], skipped: true, failedCount: 0, attemptedCount: 0 }
  running = true
  setOfflineSyncState("SYNCING")
  const force = options?.force === true
  let ackedEventIds = []
  let failedCount = 0
  let attemptedCount = 0
  let lastError = null

  try {
    const healthy = await pingHealth()
    if (!healthy) {
      return { ackedEventIds, healthy: false, failedCount, attemptedCount, lastError }
    }

    const stationId = getStationPublicId()
    if (!stationId) {
      return { ackedEventIds, skipped: true, failedCount, attemptedCount, lastError }
    }
    if (!SYNC_WRITE_ROLES.has(getRoleCode())) {
      return { ackedEventIds, skipped: true, failedCount, attemptedCount, lastError }
    }

    const deviceId = await getOrCreateDeviceId()
    if (force) {
      await schedulePendingEventsNow(FORCE_SCHEDULE_LIMIT)
    }

    while (true) {
      const events = await getPendingEvents(BATCH_SIZE)
      if (!events.length) break
      attemptedCount += events.length

      try {
        const result = await postEventsBatch(stationId, deviceId, events)
        const acked = normalizeAcked(result?.acked)
        const failed = normalizeFailed(result?.failed)
        const failedMap = Object.fromEntries(failed.map((item) => [item.eventId, item.error]))

        if (acked.length) {
          await markOutboxEventsAcked(acked)
          ackedEventIds.push(...acked)
        }

        const failedEvents = events.filter((event) => failedMap[event.eventId])
        if (failedEvents.length) {
          failedCount += failedEvents.length
          if (!lastError) {
            const firstFailed = failedEvents[0]
            lastError = failedMap[firstFailed.eventId] || "Server rejected event"
          }
          await markEventsForRetry(failedEvents, "Server rejected event", failedMap)
        }

        const accounted = new Set([
          ...acked,
          ...failedEvents.map((item) => item.eventId),
        ])
        const unresolved = events.filter((event) => !accounted.has(event.eventId))
        if (unresolved.length) {
          failedCount += unresolved.length
          if (!lastError) {
            lastError = "Event not acknowledged by server"
          }
          await markEventsForRetry(unresolved, "Event not acknowledged by server")
        }
      } catch (error) {
        failedCount += events.length
        if (!lastError) {
          lastError = error?.message || "Sync failed"
        }
        await markEventsForRetry(events, error?.message || "Sync failed")
        break
      }
    }

    setOfflineLastSyncAt(new Date().toISOString())
    return { ackedEventIds, healthy: true, failedCount, attemptedCount, lastError }
  } finally {
    running = false
    setOfflineSyncState("IDLE")
    await refreshOfflinePendingCount()
  }
}

function bindOnlineListener() {
  if (onlineListenerBound || typeof window === "undefined") return
  onlineListenerBound = true
  window.addEventListener("online", () => {
    syncNow().catch(() => {})
  })
}

export function startSyncEngine() {
  if (started) return
  started = true
  initOfflineNetworkState()
  bindOnlineListener()
  refreshOfflinePendingCount().catch(() => {})
  syncNow().catch(() => {})
  intervalId = window.setInterval(() => {
    syncNow().catch(() => {})
  }, POLL_INTERVAL_MS)
}

export function stopSyncEngine() {
  if (!started) return
  started = false
  if (intervalId) {
    window.clearInterval(intervalId)
    intervalId = null
  }
}

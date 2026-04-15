const OFFLINE_STATE = {
  network: typeof navigator !== "undefined" && navigator.onLine ? "ONLINE" : "OFFLINE",
  sync: "IDLE",
  pendingCount: 0,
  lastSyncAt: null,
}

const listeners = new Set()
let initialized = false

function emitState() {
  const snapshot = { ...OFFLINE_STATE }
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch {
      // Ignore listener errors to keep state fan-out resilient.
    }
  }
}

export function initOfflineNetworkState() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  window.addEventListener("online", () => {
    OFFLINE_STATE.network = "ONLINE"
    emitState()
  })
  window.addEventListener("offline", () => {
    OFFLINE_STATE.network = "OFFLINE"
    emitState()
  })
}

export function subscribeOfflineState(listener) {
  initOfflineNetworkState()
  listeners.add(listener)
  listener({ ...OFFLINE_STATE })
  return () => listeners.delete(listener)
}

export function getOfflineState() {
  return { ...OFFLINE_STATE }
}

export function setOfflineNetworkState(isOnline) {
  OFFLINE_STATE.network = isOnline ? "ONLINE" : "OFFLINE"
  emitState()
}

export function setOfflineSyncState(syncState) {
  OFFLINE_STATE.sync = syncState
  emitState()
}

export function setOfflinePendingCount(count) {
  OFFLINE_STATE.pendingCount = Number(count || 0)
  emitState()
}

export function setOfflineLastSyncAt(isoTime) {
  OFFLINE_STATE.lastSyncAt = isoTime || null
  emitState()
}

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return false
  return navigator.onLine !== false
}

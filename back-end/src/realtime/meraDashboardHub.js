const listeners = new Set()

export function subscribeMeraDashboard(listener) {
  if (typeof listener !== "function") return () => {}
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishMeraDashboardUpdate(payload = {}) {
  const keys = Array.isArray(payload.keys) && payload.keys.length
    ? payload.keys
    : ["nationalOperations"]
  const message = {
    type: "mera_portal_invalidate",
    at: new Date().toISOString(),
    ...payload,
    keys,
  }

  for (const listener of listeners) {
    try {
      listener(message)
    } catch {
      // Keep one broken socket listener from blocking the realtime fan-out.
    }
  }
}

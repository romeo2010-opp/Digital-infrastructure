const listeners = new Set()

export function subscribeMeraDashboard(listener) {
  if (typeof listener !== "function") return () => {}
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishMeraDashboardUpdate(payload = {}) {
  const message = {
    type: "mera_dashboard_refresh",
    at: new Date().toISOString(),
    ...payload,
  }

  for (const listener of listeners) {
    try {
      listener(message)
    } catch {
      // Keep one broken socket listener from blocking the realtime fan-out.
    }
  }
}

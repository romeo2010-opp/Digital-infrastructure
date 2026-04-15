const listenersByPump = new Map()

function toPumpKey(stationId, pumpPublicId) {
  const stationKey = String(stationId || "").trim()
  const pumpKey = String(pumpPublicId || "").trim()
  if (!stationKey || !pumpKey) return null
  return `${stationKey}:${pumpKey}`
}

export function subscribeMonitoringPump(stationId, pumpPublicId, listener) {
  const key = toPumpKey(stationId, pumpPublicId)
  if (!key || typeof listener !== "function") {
    return () => {}
  }

  let listeners = listenersByPump.get(key)
  if (!listeners) {
    listeners = new Set()
    listenersByPump.set(key, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = listenersByPump.get(key)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listenersByPump.delete(key)
    }
  }
}

export function publishMonitoringUpdate({ stationId, pumpPublicId, payload }) {
  const key = toPumpKey(stationId, pumpPublicId)
  if (!key) return

  const listeners = listenersByPump.get(key)
  if (!listeners?.size) return

  const message = {
    type: "monitoring:update",
    ...payload,
  }

  for (const listener of [...listeners]) {
    try {
      listener(message)
    } catch {
      // Ignore listener errors so one client cannot break fan-out.
    }
  }
}

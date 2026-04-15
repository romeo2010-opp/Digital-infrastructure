const listenersByStation = new Map()

function toStationKey(stationId) {
  const normalized = String(stationId || "").trim()
  return normalized || null
}

export function subscribeStationChanges(stationId, listener) {
  const key = toStationKey(stationId)
  if (!key || typeof listener !== "function") {
    return () => {}
  }

  let listeners = listenersByStation.get(key)
  if (!listeners) {
    listeners = new Set()
    listenersByStation.set(key, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = listenersByStation.get(key)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listenersByStation.delete(key)
    }
  }
}

export function publishStationChange({ stationId, actionType, payload = {} }) {
  const key = toStationKey(stationId)
  if (!key) return

  const listeners = listenersByStation.get(key)
  if (!listeners?.size) return

  const message = {
    type: "station_change",
    stationId: key,
    actionType: actionType || "UNKNOWN",
    payload,
    at: new Date().toISOString(),
  }

  for (const listener of [...listeners]) {
    try {
      listener(message)
    } catch {
      // Ignore listener errors so one client cannot break fan-out.
    }
  }
}


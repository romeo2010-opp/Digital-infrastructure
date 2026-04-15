const STORAGE_KEY = "smartlink.systemAlerts.v1"
const MAX_ALERTS = 60

let state = loadFromStorage()
const listeners = new Set()

function nowIso() {
  return new Date().toISOString()
}

function loadFromStorage() {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (_error) {
    return []
  }
}

function persist(next) {
  state = next
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (_error) {
      // Ignore storage failures (private mode, quota, etc.)
    }
  }
  listeners.forEach((listener) => listener(state))
}

function normalizeAlert(alert, defaultSource = "SYSTEM") {
  if (!alert) return null
  if (typeof alert === "string") {
    return {
      id: `sys-${hash(`INFO|${alert}`)}`,
      type: "INFO",
      title: "Message",
      body: alert,
      meta: "",
      source: defaultSource,
      createdAt: nowIso(),
      occurrences: 1,
    }
  }

  const type = String(alert.type || "INFO").toUpperCase()
  const title = String(alert.title || (type === "ERROR" ? "System Error" : "System Message")).trim()
  const body = String(alert.body || alert.message || "").trim()
  if (!body) return null
  const source = String(alert.source || defaultSource || "SYSTEM").trim().toUpperCase()
  const key = `${type}|${title}|${body}|${source}`
  return {
    id: alert.id || `sys-${hash(key)}`,
    type,
    title,
    body,
    meta: alert.meta || alert.timestamp || "",
    source,
    createdAt: alert.createdAt || nowIso(),
    occurrences: Number(alert.occurrences || 1),
  }
}

function hash(input) {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

function alertKey(item) {
  return `${item.type}|${item.title}|${item.body}|${item.source}`
}

export function getSystemAlerts() {
  return state
}

export function subscribeSystemAlerts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearSystemAlerts() {
  persist([])
}

export function pushSystemAlert(alert, options = {}) {
  const normalized = normalizeAlert(alert, options.source || "SYSTEM")
  if (!normalized) return null

  const next = [...state]
  const key = alertKey(normalized)
  const existingIndex = next.findIndex((item) => alertKey(item) === key)

  if (existingIndex >= 0) {
    const existing = next[existingIndex]
    if (options.incrementOnRepeat === false) {
      next[existingIndex] = {
        ...existing,
        meta: normalized.meta || existing.meta || "",
      }
    } else {
      next[existingIndex] = {
        ...existing,
        meta: normalized.meta || existing.meta || "",
        createdAt: nowIso(),
        occurrences: Number(existing.occurrences || 1) + 1,
      }
      const [item] = next.splice(existingIndex, 1)
      next.unshift(item)
    }
  } else {
    next.unshift(normalized)
  }

  persist(next.slice(0, MAX_ALERTS))
  return normalized
}

export function pushSystemAlerts(alerts, options = {}) {
  if (!Array.isArray(alerts)) return
  alerts.forEach((alert) => {
    pushSystemAlert(alert, options)
  })
}

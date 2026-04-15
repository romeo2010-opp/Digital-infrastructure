const STORAGE_KEY = "smartlink.internal.session"

export function readSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeSession(value) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function clearSession() {
  window.localStorage.removeItem(STORAGE_KEY)
}

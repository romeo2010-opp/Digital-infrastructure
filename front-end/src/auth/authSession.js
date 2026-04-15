let accessToken = null
let sessionMeta = {
  user: null,
  station: null,
  role: null,
  stationMemberships: [],
}

const DEFAULT_APP_TIME_ZONE = import.meta.env.VITE_APP_TIME_ZONE || "Africa/Blantyre"

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
    const json = atob(padded)
    return JSON.parse(json)
  } catch (_error) {
    return null
  }
}

export function setAccessToken(token) {
  accessToken = token || null
}

export function getAccessToken() {
  return accessToken
}

export function setSessionMeta(meta) {
  sessionMeta = {
    user: meta?.user || null,
    station: meta?.station || null,
    role: meta?.role || null,
    stationMemberships: Array.isArray(meta?.stationMemberships) ? meta.stationMemberships : [],
  }
}

export function getSessionMeta() {
  return sessionMeta
}

export function getRoleCode() {
  return String(sessionMeta?.role || "").trim().toUpperCase()
}

export function clearAuthSession() {
  accessToken = null
  sessionMeta = {
    user: null,
    station: null,
    role: null,
    stationMemberships: [],
  }
}

export function getTokenClaims() {
  if (!accessToken) return null
  return decodeJwtPayload(accessToken)
}

export function getStationPublicId() {
  if (sessionMeta?.station?.publicId) return sessionMeta.station.publicId
  const claims = getTokenClaims()
  return claims?.stationPublicId || null
}

export function getStationTimeZone() {
  const scoped = String(sessionMeta?.station?.timezone || "").trim()
  return scoped || DEFAULT_APP_TIME_ZONE
}

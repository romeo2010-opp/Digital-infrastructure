let accessToken: string | null = null
let sessionMeta = {
  user: null as null | { publicId?: string | null; fullName?: string | null; email?: string | null; phone?: string | null },
  station: null as null | { publicId?: string | null; name?: string | null; timezone?: string | null },
  role: null as null | string,
  kiosk: null as null | {
    sessionId?: string | null
    kioskName?: string | null
    locationLabel?: string | null
    permissions?: string[]
    expiresAt?: string | null
  },
  stationMemberships: [] as Array<{
    station?: { publicId?: string | null; name?: string | null; timezone?: string | null } | null
    role?: string | null
    isCurrent?: boolean
  }>,
}

function decodeJwtPayload(token: string) {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token || null
}

export function getAccessToken() {
  return accessToken
}

export function setSessionMeta(meta: typeof sessionMeta) {
  sessionMeta = {
    user: meta?.user || null,
    station: meta?.station || null,
    role: meta?.role || null,
    kiosk: meta?.kiosk || null,
    stationMemberships: Array.isArray(meta?.stationMemberships) ? meta.stationMemberships : [],
  }
}

export function getSessionMeta() {
  return sessionMeta
}

export function clearAuthSession() {
  accessToken = null
  sessionMeta = {
    user: null,
    station: null,
    role: null,
    kiosk: null,
    stationMemberships: [],
  }
}

export function getTokenClaims() {
  if (!accessToken) return null
  return decodeJwtPayload(accessToken)
}

export function getRoleCode() {
  return String(sessionMeta?.role || "").trim().toUpperCase()
}

export function getKioskSessionId() {
  return String(sessionMeta?.kiosk?.sessionId || "").trim() || null
}

export function getKioskPermissions() {
  return Array.isArray(sessionMeta?.kiosk?.permissions) ? sessionMeta.kiosk.permissions : []
}

export function getStationPublicId() {
  if (sessionMeta?.station?.publicId) return sessionMeta.station.publicId
  const claims = getTokenClaims()
  return claims?.stationPublicId || null
}

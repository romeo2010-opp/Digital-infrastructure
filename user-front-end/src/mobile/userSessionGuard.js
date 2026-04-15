function decodeBase64Url(segment) {
  const normalized = String(segment || '').trim()
  if (!normalized) return ''

  const padded = normalized.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = padded.length % 4
  const withPadding = remainder ? padded.padEnd(padded.length + (4 - remainder), '=') : padded

  try {
    return window.atob(withPadding)
  } catch {
    return ''
  }
}

export function normalizeRole(role) {
  return String(role || '').trim().toUpperCase()
}

export function buildUserAppRoleError({ role, stationPublicId } = {}) {
  const normalizedRole = normalizeRole(role)
  const scopedStationPublicId = String(stationPublicId || '').trim()
  const roleLabel = normalizedRole || 'STAFF'
  const stationSuffix = scopedStationPublicId ? ` for station ${scopedStationPublicId}` : ''
  return `This account is signed in as ${roleLabel}${stationSuffix}. Use the station staff app instead of the user app.`
}

export function decodeAccessTokenPayload(token) {
  const scopedToken = String(token || '').trim()
  if (!scopedToken) return null

  const [, payloadSegment = ''] = scopedToken.split('.')
  if (!payloadSegment) return null

  try {
    return JSON.parse(decodeBase64Url(payloadSegment))
  } catch {
    return null
  }
}

export function assertUserAppAccessToken(token) {
  const payload = decodeAccessTokenPayload(token)
  const role = normalizeRole(payload?.role)
  if (!role || role === 'USER') return payload

  throw new Error(
    buildUserAppRoleError({
      role,
      stationPublicId: payload?.stationPublicId,
    })
  )
}

export function assertUserAppSessionMeta(session) {
  if (!session || typeof session !== 'object') return session

  const role = normalizeRole(session.role)
  if (!role || role === 'USER') return session

  throw new Error(
    buildUserAppRoleError({
      role,
      stationPublicId: session?.station?.publicId,
    })
  )
}

export function getRealtimeCloseMeta(event) {
  const code = Number(event?.code || 0)
  const reason = String(event?.reason || '').trim()
  return {
    code,
    reason,
    normalizedReason: reason.toLowerCase(),
  }
}

export function isRealtimeAuthClose(event) {
  const { code, normalizedReason } = getRealtimeCloseMeta(event)
  if (code !== 4401) return false
  return (
    normalizedReason.includes('invalid token') ||
    normalizedReason.includes('missing access token') ||
    normalizedReason.includes('invalid session scope') ||
    normalizedReason.includes('session revoked or expired')
  )
}

export function isQueueRealtimeScopeClose(event) {
  const { code, normalizedReason } = getRealtimeCloseMeta(event)
  if (code !== 4401) return false
  return normalizedReason.includes('queue scope mismatch') || normalizedReason.includes('queue entry not found')
}

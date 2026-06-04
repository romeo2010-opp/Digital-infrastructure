import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { assertUserAppAccessToken } from '../userSessionGuard'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  return window.location.origin
}

function isAuthFailure(response, payload) {
  if (response.status === 401) return true
  const message = String(payload?.error || '').toLowerCase()
  return (
    message.includes('invalid or expired token') ||
    message.includes('missing access token') ||
    message.includes('missing bearer token') ||
    message.includes('session revoked or expired')
  )
}

async function refreshAccessToken() {
  const response = await fetch(`${resolveApiOrigin()}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Refresh failed (${response.status})`)
  }
  const token = String(payload?.data?.accessToken || '').trim()
  if (!token) throw new Error('Refresh did not return access token')
  assertUserAppAccessToken(token)
  setStoredAccessToken(token)
  return token
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let token = String(getStoredAccessToken() || '').trim()
  if (!token) {
    token = await refreshAccessToken()
  }
  assertUserAppAccessToken(token)

  const execute = (accessToken) =>
    fetch(`${resolveApiOrigin()}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })

  let response = await execute(token)
  let payload = await response.json().catch(() => ({}))

  if (isAuthFailure(response, payload)) {
    token = await refreshAccessToken()
    response = await execute(token)
    payload = await response.json().catch(() => ({}))
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`)
  }

  return payload.data
}

export const vehiclesApi = {
  list(options = {}) {
    return request('/api/vehicles', { signal: options.signal })
  },
  create(payload, options = {}) {
    return request('/api/vehicles', { method: 'POST', body: payload, signal: options.signal })
  },
  get(vehicleId, options = {}) {
    return request(`/api/vehicles/${encodeURIComponent(vehicleId)}`, { signal: options.signal })
  },
  update(vehicleId, payload, options = {}) {
    return request(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'PATCH',
      body: payload,
      signal: options.signal,
    })
  },
  archive(vehicleId, options = {}) {
    return request(`/api/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'DELETE',
      signal: options.signal,
    })
  },
  setDefault(vehicleId, options = {}) {
    return request(`/api/vehicles/${encodeURIComponent(vehicleId)}/set-default`, {
      method: 'POST',
      body: {},
      signal: options.signal,
    })
  },
}

import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { assertUserAppAccessToken } from '../userSessionGuard'
import { userAuthApi } from './userAuthApi'

const dataSourceMode = (import.meta.env.VITE_DATA_SOURCE || 'api').toLowerCase()
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const envAccessToken = import.meta.env.VITE_USER_ACCESS_TOKEN || ''
const allowEnvTokenFallback =
  String(import.meta.env.VITE_ALLOW_ENV_USER_TOKEN_FALLBACK || 'false').toLowerCase() === 'true'

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  return window.location.origin
}

function getAccessToken() {
  const runtimeToken = getStoredAccessToken()
  if (runtimeToken) {
    assertUserAppAccessToken(runtimeToken)
    return runtimeToken
  }

  if (allowEnvTokenFallback && envAccessToken) {
    assertUserAppAccessToken(envAccessToken)
    return envAccessToken
  }

  return ''
}

function ensureApiMode() {
  if (dataSourceMode !== 'api') {
    throw new Error('SmartLink Assistant is available only when live API mode is enabled.')
  }
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

async function request(pathname, { body, signal } = {}) {
  ensureApiMode()

  let accessToken = getAccessToken()
  if (!accessToken) {
    accessToken = await userAuthApi.refresh()
    setStoredAccessToken(accessToken)
  }
  assertUserAppAccessToken(accessToken)

  const execute = (token) =>
    fetch(`${resolveApiOrigin()}${pathname}`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
      signal,
    })

  let response = await execute(accessToken)
  let payload = await response.json().catch(() => ({}))

  if (isAuthFailure(response, payload)) {
    accessToken = await userAuthApi.refresh()
    setStoredAccessToken(accessToken)
    assertUserAppAccessToken(accessToken)
    response = await execute(accessToken)
    payload = await response.json().catch(() => ({}))
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`)
  }

  return payload.data
}

export const assistantApi = {
  isApiMode() {
    return dataSourceMode === 'api'
  },

  async respond({ message = '', sessionToken = '', actionId = '', actionPayload = {}, currentLocation = null, signal } = {}) {
    return request('/api/user/assistant/respond', {
      body: {
        message,
        sessionToken,
        actionId,
        actionPayload,
        currentLocation,
      },
      signal,
    })
  },

  async confirm({ confirmationToken, signal } = {}) {
    const normalizedToken = String(confirmationToken || '').trim()
    if (!normalizedToken) throw new Error('Confirmation token is required.')

    return request('/api/user/assistant/confirm', {
      body: {
        confirmationToken: normalizedToken,
      },
      signal,
    })
  },
}

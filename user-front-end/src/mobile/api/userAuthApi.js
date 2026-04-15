import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { assertUserAppAccessToken } from '../userSessionGuard'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  return window.location.origin
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  return payload.data
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

async function requestWithAuth(pathname, { method = 'GET', body, token = '' } = {}) {
  let accessToken = String(token || getStoredAccessToken() || '').trim()
  if (!accessToken) {
    accessToken = await userAuthApi.refresh()
    setStoredAccessToken(accessToken)
  }
  assertUserAppAccessToken(accessToken)

  const execute = (nextToken) =>
    fetch(`${resolveApiOrigin()}${pathname}`, {
      method,
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${nextToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return payload.data
}

export const userAuthApi = {
  async register({ fullName, email, phone, password }) {
    const body = { password: String(password || '') }

    const normalizedFullName = String(fullName || '').trim()
    const normalizedEmail = String(email || '').trim()
    const normalizedPhone = String(phone || '').trim()

    if (normalizedFullName) {
      body.fullName = normalizedFullName
    }
    if (!normalizedPhone) throw new Error('Phone number is required')
    body.phone = normalizedPhone
    if (normalizedEmail) {
      body.email = normalizedEmail
    }

    const response = await fetch(`${resolveApiOrigin()}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    return parseResponse(response)
  },

  async login({ email, phone, password }) {
    const body = {
      password: String(password || ''),
    }

    const normalizedEmail = String(email || '').trim()
    const normalizedPhone = String(phone || '').trim()
    if (normalizedEmail) {
      body.email = normalizedEmail
    } else if (normalizedPhone) {
      body.phone = normalizedPhone
    } else {
      throw new Error('Enter email or phone')
    }

    const response = await fetch(`${resolveApiOrigin()}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    return parseResponse(response)
  },

  async beginPasskeyRegistration(token = '') {
    return requestWithAuth('/auth/passkeys/register/options', {
      method: 'POST',
      body: {},
      token,
    })
  },

  async completePasskeyRegistration(payload, token = '') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Passkey registration payload is required')
    }

    return requestWithAuth('/auth/passkeys/register/verify', {
      method: 'POST',
      body: payload,
      token,
    })
  },

  async listPasskeys(token = '') {
    return requestWithAuth('/auth/passkeys', {
      method: 'GET',
      token,
    })
  },

  async removePasskey(passkeyPublicId, token = '') {
    const normalizedPublicId = String(passkeyPublicId || '').trim()
    if (!normalizedPublicId) {
      throw new Error('Passkey id is required')
    }

    return requestWithAuth(`/auth/passkeys/${encodeURIComponent(normalizedPublicId)}`, {
      method: 'DELETE',
      token,
    })
  },

  async beginPasskeyLogin() {
    const response = await fetch(`${resolveApiOrigin()}/auth/passkeys/login/options`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    return parseResponse(response)
  },

  async completePasskeyLogin(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Passkey sign-in payload is required')
    }

    const response = await fetch(`${resolveApiOrigin()}/auth/passkeys/login/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    return parseResponse(response)
  },

  async me(token = '') {
    return requestWithAuth('/auth/me', {
      method: 'GET',
      token,
    })
  },

  async refresh() {
    const response = await fetch(`${resolveApiOrigin()}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })

    const data = await parseResponse(response)
    const accessToken = String(data?.accessToken || '').trim()
    if (!accessToken) {
      throw new Error('Refresh did not return access token')
    }
    assertUserAppAccessToken(accessToken)
    return accessToken
  },

  async logout(token = '') {
    const accessToken = String(token || getStoredAccessToken() || '').trim()
    const headers = accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined

    const response = await fetch(`${resolveApiOrigin()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })

    return parseResponse(response)
  },

  async updateProfile(payload, token = '') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Profile payload is required')
    }

    return requestWithAuth('/auth/me', {
      method: 'PATCH',
      body: {
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone,
      },
      token,
    })
  },

  async getPreferences(token = '') {
    return requestWithAuth('/api/users/me/preferences', {
      method: 'GET',
      token,
    })
  },

  async updatePreferences(payload, token = '') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Preferences payload is required')
    }

    return requestWithAuth('/api/users/me/preferences', {
      method: 'PATCH',
      body: payload,
      token,
    })
  },
}

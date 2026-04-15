import { clearAuthSession, getAccessToken, setAccessToken } from "../auth/authSession"
import { getSnapshot, setSnapshot } from "../offline/db"
import { isBrowserOnline } from "../offline/network"
import { pushSystemAlert } from "../utils/systemAlerts"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""
const AUTH_EXPIRED_EVENT = "smartlink:auth-expired"

let refreshPromise = null

function isGetRequest(method) {
  return String(method || "").toUpperCase() === "GET"
}

function cacheKey(path) {
  return `http:get:${path}`
}

async function readCachedGet(path) {
  try {
    const cached = await getSnapshot(cacheKey(path))
    return cached?.data
  } catch {
    return null
  }
}

async function writeCachedGet(path, data) {
  try {
    await setSnapshot(cacheKey(path), {
      data,
      cachedAt: new Date().toISOString(),
    })
  } catch {
    // Cache writes are best-effort.
  }
}

async function request(method, path, body) {
  return requestWithRefresh(method, path, body, { attemptedRefresh: false })
}

async function requestWithRefresh(method, path, body, options) {
  const getRequest = isGetRequest(method)
  const isAuthEndpoint = String(path || "").startsWith("/auth/")

  if (getRequest && !isBrowserOnline()) {
    const cached = await readCachedGet(path)
    if (cached !== null && cached !== undefined) return cached
    throw new Error("Offline and no cached data available")
  }

  let accessToken = getAccessToken()
  if (!accessToken && !isAuthEndpoint) {
    accessToken = await tryRefreshAccessToken().catch(() => null)
  }

  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if (getRequest) {
      const cached = await readCachedGet(path)
      if (cached !== null && cached !== undefined) {
        return cached
      }
    }
    const message = "Network request failed"
    pushSystemAlert({
      type: "ERROR",
      title: "Network Error",
      body: message,
      meta: `${method} ${path}`,
    })
    throw error instanceof Error ? error : new Error(message)
  }

  const payload = await response.json().catch(() => ({}))

  if (shouldRetryAfterRefresh(response, payload, options?.attemptedRefresh, isAuthEndpoint)) {
    const refreshedToken = await tryRefreshAccessToken().catch(() => null)
    if (refreshedToken) {
      return requestWithRefresh(method, path, body, { attemptedRefresh: true })
    }
  }

  if (isUnauthorized(payload, response) && !isAuthEndpoint) {
    clearAuthSession()
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
    }
  }

  if (!response.ok || payload.ok === false) {
    const message = payload.error || `Request failed: ${response.status}`
    pushSystemAlert({
      type: "ERROR",
      title: "System Error",
      body: message,
      meta: `${method} ${path}`,
    })
    throw new Error(message)
  }

  if (getRequest) {
    await writeCachedGet(path, payload.data)
  }

  return payload.data
}

function isUnauthorized(payload, response) {
  if (response.status === 401) return true
  const message = String(payload?.error || "").toLowerCase()
  return message.includes("missing bearer token") || message.includes("invalid or expired token")
}

function shouldRetryAfterRefresh(response, payload, attemptedRefresh, isAuthEndpoint) {
  if (attemptedRefresh || isAuthEndpoint) return false
  return isUnauthorized(payload, response)
}

async function tryRefreshAccessToken() {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Auth request failed: ${response.status}`)
    }
    const token = payload?.data?.accessToken
    if (!token) {
      throw new Error("Access token missing in refresh response")
    }
    setAccessToken(token)
    return token
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export const httpClient = {
  get(path) {
    return request("GET", path)
  },
  post(path, body) {
    return request("POST", path, body)
  },
  patch(path, body) {
    return request("PATCH", path, body)
  },
  delete(path) {
    return request("DELETE", path)
  },
}

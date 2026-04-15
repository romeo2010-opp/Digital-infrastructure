import { clearAuthSession, getAccessToken, setAccessToken } from "../auth/authSession"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""
export const AUTH_EXPIRED_EVENT = "smartlink:kiosk-auth-expired"

let refreshPromise: Promise<string> | null = null

async function requestWithRefresh(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  attemptedRefresh = false
) {
  const isAuthEndpoint = path.startsWith("/auth/")
  let accessToken = getAccessToken()

  if (!accessToken && !isAuthEndpoint) {
    accessToken = await tryRefreshAccessToken().catch(() => null)
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  if (!attemptedRefresh && !isAuthEndpoint && isUnauthorized(response, payload)) {
    const refreshed = await tryRefreshAccessToken().catch(() => null)
    if (refreshed) {
      return requestWithRefresh(method, path, body, true)
    }
  }

  if (isUnauthorized(response, payload) && !isAuthEndpoint) {
    clearAuthSession()
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
    }
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }

  return payload.data
}

function isUnauthorized(response: Response, payload: Record<string, unknown>) {
  if (response.status === 401) return true
  const message = String(payload?.error || "").toLowerCase()
  return message.includes("missing bearer token") || message.includes("invalid or expired token")
}

async function tryRefreshAccessToken() {
  if (refreshPromise) return refreshPromise

  refreshPromise = fetch(`${baseUrl}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Auth request failed: ${response.status}`)
      }
      const token = String(payload?.data?.accessToken || "").trim()
      if (!token) {
        throw new Error("Access token missing in refresh response")
      }
      setAccessToken(token)
      return token
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

export const httpClient = {
  get(path: string) {
    return requestWithRefresh("GET", path)
  },
  post(path: string, body?: Record<string, unknown>) {
    return requestWithRefresh("POST", path, body)
  },
}

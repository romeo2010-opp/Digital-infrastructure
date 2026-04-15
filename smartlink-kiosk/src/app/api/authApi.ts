import { getAccessToken } from "../auth/authSession"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

async function authRequest(path: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Auth request failed: ${response.status}`)
  }
  return payload.data
}

export const authApi = {
  login(body: { email?: string; phone?: string; password: string }) {
    return authRequest("/auth/login", "POST", body)
  },
  refresh() {
    return authRequest("/auth/refresh", "POST")
  },
  logout() {
    return authRequest("/auth/logout", "POST")
  },
  switchStation(body: { stationPublicId: string }) {
    const accessToken = getAccessToken()
    return fetch(`${baseUrl}/api/auth/stations/switch`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body || {}),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Auth request failed: ${response.status}`)
      }
      return payload.data
    })
  },
  me(accessToken: string) {
    return fetch(`${baseUrl}/auth/me`, {
      method: "GET",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Auth request failed: ${response.status}`)
      }
      return payload.data
    })
  },
}

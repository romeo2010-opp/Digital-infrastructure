import { getAccessToken } from "../auth/authSession"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Kiosk auth request failed: ${response.status}`)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }
  return payload.data
}

function authHeaders() {
  const accessToken = getAccessToken()
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

export const kioskAuthApi = {
  createRegistrationChallenge(body: { deviceFingerprint: string }) {
    return fetch(`${baseUrl}/api/kiosk/registration/challenge`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    }).then(readJson)
  },
  getRegistrationChallengeStatus(challengeId: string, challengeSecret: string) {
    return fetch(`${baseUrl}/api/kiosk/registration/challenge/${encodeURIComponent(challengeId)}/status`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Kiosk-Registration-Secret": challengeSecret,
      },
    }).then(readJson)
  },
  createChallenge(body: {
    deviceFingerprint: string
    kioskId?: string
    requestedAccessLevel?: string
  }) {
    return fetch(`${baseUrl}/api/kiosk/auth/challenge`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    }).then(readJson)
  },
  getChallengeStatus(challengeId: string, challengeSecret: string) {
    return fetch(`${baseUrl}/api/kiosk/auth/challenge/${encodeURIComponent(challengeId)}/status`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Kiosk-Challenge-Secret": challengeSecret,
      },
    }).then(readJson)
  },
  heartbeat(sessionId: string) {
    return fetch(`${baseUrl}/api/kiosk/session/${encodeURIComponent(sessionId)}/heartbeat`, {
      method: "POST",
      credentials: "include",
      headers: authHeaders(),
      body: JSON.stringify({}),
    }).then(readJson)
  },
  revoke(sessionId: string) {
    return fetch(`${baseUrl}/api/kiosk/session/${encodeURIComponent(sessionId)}/revoke`, {
      method: "POST",
      credentials: "include",
      headers: authHeaders(),
      body: JSON.stringify({}),
    }).then(readJson)
  },
}

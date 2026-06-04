import { httpClient } from "./httpClient"

export const kioskApi = {
  getChallenge(challengeId) {
    return httpClient.get(`/api/kiosk/auth/challenge/${encodeURIComponent(challengeId)}`)
  },
  approveChallenge(challengeId) {
    return httpClient.post(`/api/kiosk/auth/challenge/${encodeURIComponent(challengeId)}/approve`, {})
  },
  denyChallenge(challengeId) {
    return httpClient.post(`/api/kiosk/auth/challenge/${encodeURIComponent(challengeId)}/deny`, {})
  },
  listActiveSessions() {
    return httpClient.get("/api/kiosk/sessions/active")
  },
  revokeSession(sessionId) {
    return httpClient.post(`/api/kiosk/session/${encodeURIComponent(sessionId)}/revoke`, {})
  },
}

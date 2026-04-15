import { httpClient } from "./httpClient"

export const accountApi = {
  getMe() {
    return httpClient.get("/api/users/me")
  },
  updateProfile(payload) {
    return httpClient.patch("/api/users/me", payload)
  },
  changePassword(payload) {
    return httpClient.post("/api/auth/change-password", payload)
  },
  listSessions() {
    return httpClient.get("/api/auth/sessions")
  },
  logout() {
    return httpClient.post("/api/auth/logout")
  },
  logoutOthers() {
    return httpClient.post("/api/auth/logout-others")
  },
  getPreferences() {
    return httpClient.get("/api/users/me/preferences")
  },
  updatePreferences(payload) {
    return httpClient.patch("/api/users/me/preferences", payload)
  },
  exportMyData() {
    return httpClient.get("/api/users/me/export")
  },
  requestDelete(payload) {
    return httpClient.post("/api/users/me/delete-request", payload)
  },
}

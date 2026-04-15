import { httpClient } from "./httpClient"

export const authApi = {
  login(payload) {
    return httpClient.post("/api/internal/auth/login", payload)
  },
  me() {
    return httpClient.get("/api/internal/auth/me")
  },
  updateMe(payload) {
    return httpClient.patch("/api/internal/auth/me", payload)
  },
  logout() {
    return httpClient.post("/api/internal/auth/logout", {})
  },
}

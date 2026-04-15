import { httpClient } from "./httpClient"
import { getStationPublicId } from "../auth/authSession"

function toBackendStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  return ["ACTIVE", "PAUSED", "OFFLINE", "IDLE"].includes(normalized) ? normalized : "ACTIVE"
}

export const pumpsApi = {
  async updatePumpStatus(pumpPublicId, status, reason) {
    const stationPublicId = getStationPublicId()
    if (!stationPublicId) {
      throw new Error("No active station scope in auth session")
    }
    const backendStatus = toBackendStatus(status)
    return httpClient.patch(`/api/stations/${stationPublicId}/pumps/${pumpPublicId}/status`, {
      status: backendStatus,
      reason,
    })
  },
}

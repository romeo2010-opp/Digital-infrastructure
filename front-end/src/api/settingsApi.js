import { httpClient } from "./httpClient"
import { getStationPublicId } from "../auth/authSession"

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

export const settingsApi = {
  getSettings() {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/settings`)
  },
  patchStation(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/station`, payload)
  },
  createTank(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/settings/tanks`, payload)
  },
  patchTank(tankPublicId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/tanks/${tankPublicId}`, payload)
  },
  createPump(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/settings/pumps`, payload)
  },
  patchPump(pumpPublicId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/pumps/${pumpPublicId}`, payload)
  },
  createPumpNozzle(pumpPublicId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/settings/pumps/${pumpPublicId}/nozzles`, payload)
  },
  patchPumpNozzle(nozzlePublicId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/nozzles/${nozzlePublicId}`, payload)
  },
  deletePumpNozzle(nozzlePublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.delete(`/api/stations/${stationPublicId}/settings/nozzles/${nozzlePublicId}`)
  },
  deletePump(pumpPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.delete(`/api/stations/${stationPublicId}/settings/pumps/${pumpPublicId}`)
  },
  patchStaff(staffId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/staff/${staffId}`, payload)
  },
  patchQueue(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/settings/queue`, payload)
  },
  patchMe(payload) {
    return httpClient.patch("/api/users/me", payload)
  },
}

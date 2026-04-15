import { httpClient } from "./httpClient"
import { getStationPublicId } from "../auth/authSession"

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

export const promotionsApi = {
  list() {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/promotions`)
  },
  create(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/promotions`, payload)
  },
  update(campaignPublicId, payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.patch(`/api/stations/${stationPublicId}/promotions/${campaignPublicId}`, payload)
  },
  activate(campaignPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/promotions/${campaignPublicId}/activate`)
  },
  deactivate(campaignPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/promotions/${campaignPublicId}/deactivate`)
  },
  archive(campaignPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.delete(`/api/stations/${stationPublicId}/promotions/${campaignPublicId}`)
  },
  preview(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/promotions/preview`, payload)
  },
}

import { httpClient } from "./httpClient"

export const briefingApi = {
  getStationBriefing(stationPublicId) {
    return httpClient.get(`/api/stations/${encodeURIComponent(stationPublicId)}/briefing`)
  },
}

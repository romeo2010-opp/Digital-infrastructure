import { getAccessToken, getStationPublicId } from "../auth/authSession"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

function stationPublicIdOrThrow(stationPublicId) {
  const resolved = stationPublicId || getStationPublicId()
  if (!resolved) throw new Error("No active station scope in auth session")
  return resolved
}

async function request(path, { signal } = {}) {
  const accessToken = getAccessToken()
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    signal,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }
  return payload.data
}

export const stationChangesApi = {
  async getToken(stationPublicId, options = {}) {
    const scopedStationPublicId = stationPublicIdOrThrow(stationPublicId)
    return request(`/api/stations/${scopedStationPublicId}/changes/token`, options)
  },
  async waitForChange({ stationPublicId, since = null, timeoutMs = 25000, signal } = {}) {
    const scopedStationPublicId = stationPublicIdOrThrow(stationPublicId)
    const query = new URLSearchParams()
    if (since !== null && since !== undefined && String(since).trim() !== "") {
      query.set("since", String(since).trim())
    }
    query.set("timeoutMs", String(timeoutMs))
    return request(`/api/stations/${scopedStationPublicId}/changes/wait?${query.toString()}`, { signal })
  },
}

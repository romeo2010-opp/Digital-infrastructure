const apiBaseUrl =
  import.meta.env.VITE_MERA_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  return window.location.origin
}

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  return payload.data
}

export const meraApi = {
  async listStations({ query = '', limit = 20, signal } = {}) {
    const url = new URL(`${resolveApiOrigin()}/api/mera/public/stations`)
    if (query) url.searchParams.set('query', query)
    url.searchParams.set('limit', String(limit))
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
    return parseJson(response)
  },

  async submitComplaint({
    stationPublicId,
    complaintType,
    complaintDescription,
    geoLat = null,
    geoLng = null,
    userPublicId = null,
    mediaFile = null,
  }) {
    const formData = new FormData()
    formData.set('stationPublicId', stationPublicId)
    formData.set('complaintType', complaintType)
    formData.set('complaintDescription', complaintDescription)
    if (userPublicId) formData.set('userPublicId', userPublicId)
    if (geoLat !== null && geoLat !== undefined) formData.set('geoLat', String(geoLat))
    if (geoLng !== null && geoLng !== undefined) formData.set('geoLng', String(geoLng))
    if (mediaFile) formData.set('media', mediaFile)

    const response = await fetch(`${resolveApiOrigin()}/api/mera/complaints`, {
      method: 'POST',
      body: formData,
    })
    return parseJson(response)
  },
}

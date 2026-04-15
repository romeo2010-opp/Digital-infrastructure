import { httpClient } from "./httpClient"
import { getAccessToken } from "../auth/authSession"
import { pushSystemAlert } from "../utils/systemAlerts"
import { getStationPublicId } from "../auth/authSession"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function buildQuery(params) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return
    query.set(key, String(value))
  })
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ""
}

function readFilenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1])
  const asciiMatch = disposition.match(/filename=\"?([^\";]+)\"?/i)
  if (asciiMatch?.[1]) return asciiMatch[1]
  return fallback
}

async function downloadExport(path, fallbackFilename) {
  const accessToken = getAccessToken()
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    credentials: "include",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const message = payload.error || `Export failed: ${response.status}`
    pushSystemAlert({
      type: "ERROR",
      title: "Export Error",
      body: message,
      meta: path,
    })
    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get("content-disposition")
  const filename = readFilenameFromDisposition(disposition, fallbackFilename)
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return filename
}

export const insightsApi = {
  getSummary({ date } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/summary${buildQuery({ date })}`)
  },

  getSalesVelocity({ window = "1h" } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/sales-velocity${buildQuery({ window })}`)
  },

  getPumpUtilization({ window = "6h" } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/pump-utilization${buildQuery({ window })}`)
  },

  getInventoryPrediction() {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/inventory-prediction`)
  },

  getQueuePrediction() {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/queue-prediction`)
  },

  getDemandForecast({ hours = 6 } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/demand-forecast${buildQuery({ hours })}`)
  },

  getAlerts() {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/insights/alerts`)
  },

  exportPdf({ date } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const query = buildQuery({ date })
    return downloadExport(
      `/api/stations/${stationPublicId}/insights/export/pdf${query}`,
      `smartlink_insights_${date || "today"}.pdf`
    )
  },
}

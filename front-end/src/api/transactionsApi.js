import { httpClient } from "./httpClient"
import { getAccessToken, getStationPublicId } from "../auth/authSession"
import { recordAction } from "../offline/recordAction"
import { getSnapshot, setSnapshot } from "../offline/db"
import { isBrowserOnline } from "../offline/network"

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function cacheKey(stationPublicId, kind) {
  return `transactions:${kind}:${stationPublicId}`
}

function readFilenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1])
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (asciiMatch?.[1]) return asciiMatch[1]
  return fallback
}

function buildTransactionParams(filters = {}) {
  const params = new URLSearchParams()
  if (filters.page) params.set("page", String(filters.page))
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize))
  if (filters.search) params.set("search", filters.search)
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.paymentMethod && filters.paymentMethod !== "ALL") {
    params.set("paymentMethod", filters.paymentMethod)
  }
  if (filters.scope) params.set("scope", filters.scope)
  return params
}

function normalizeListResponse(payload, filters = {}) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      total: payload.length,
      page: Number(filters.page || 1),
      pageSize: Number(filters.pageSize || payload.length || 10),
      totalPages: 1,
    }
  }

  const items = Array.isArray(payload?.items) ? payload.items : []
  return {
    items,
    total: Number(payload?.total || items.length),
    page: Number(payload?.page || filters.page || 1),
    pageSize: Number(payload?.pageSize || filters.pageSize || 10),
    totalPages: Math.max(1, Number(payload?.totalPages || 1)),
  }
}

async function getCachedSnapshot(key, fallback) {
  try {
    const cached = await getSnapshot(key)
    return cached ?? fallback
  } catch {
    return fallback
  }
}

async function saveCachedSnapshot(key, value) {
  try {
    await setSnapshot(key, value)
  } catch {
    // Ignore cache write failures; network data remains source of truth.
  }
}

export const transactionsApi = {
  async getPumps() {
    const stationPublicId = stationPublicIdOrThrow()
    const key = cacheKey(stationPublicId, "pumps")
    if (!isBrowserOnline()) {
      return getCachedSnapshot(key, [])
    }
    try {
      const rows = await httpClient.get(`/api/stations/${stationPublicId}/transactions/pumps`)
      await saveCachedSnapshot(key, rows || [])
      return rows || []
    } catch (error) {
      const cached = await getCachedSnapshot(key, null)
      if (cached) return cached
      throw error
    }
  },
  async listRecent() {
    const result = await this.list({ page: 1, pageSize: 50 })
    return result.items
  },
  async list(filters = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const params = buildTransactionParams(filters)
    const key = cacheKey(stationPublicId, `list:${params.toString() || "default"}`)
    if (!isBrowserOnline()) {
      return getCachedSnapshot(key, normalizeListResponse([], filters))
    }
    try {
      const payload = await httpClient.get(`/api/stations/${stationPublicId}/transactions?${params.toString()}`)
      const normalized = normalizeListResponse(payload, filters)
      await saveCachedSnapshot(key, normalized)
      return normalized
    } catch (error) {
      const cached = await getCachedSnapshot(key, null)
      if (cached) return cached
      throw error
    }
  },
  async create(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    if (isBrowserOnline()) {
      try {
        const created = await httpClient.post(`/api/stations/${stationPublicId}/transactions`, payload)
        return {
          queued: false,
          synced: true,
          data: created,
        }
      } catch (error) {
        const message = String(error?.message || "")
        const shouldQueueOffline = !isBrowserOnline() || message === "Network request failed"
        if (!shouldQueueOffline) {
          throw error
        }
      }
    }

    const result = await recordAction("SALE_CREATE", payload, { stationId: stationPublicId })
    return {
      ...result,
      optimisticRow: {
        public_id: result.event.eventId,
        occurred_at: result.event.occurredAt,
        litres: Number(payload?.totalVolume || 0),
        total_amount: Number(payload?.amount || 0),
        payment_method: payload?.paymentMethod || "CASH",
        status: "RECORDED",
        settlement_impact_status: "UNCHANGED",
        workflow_reason_code: null,
        workflow_reason_label: "",
        workflow_note: null,
        compliance_case_public_id: null,
        compliance_case_status: null,
        pump_public_id: payload?.pumpPublicId || null,
        nozzle_public_id: payload?.nozzlePublicId || null,
        fuel_code: "PENDING",
      },
    }
  },
  async getReceipt(transactionPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/transactions/${transactionPublicId}/receipt`)
  },
  async downloadReceipt(transactionPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ""
    const accessToken = getAccessToken()
    const response = await fetch(
      `${baseUrl}/api/stations/${stationPublicId}/transactions/${transactionPublicId}/receipt/download`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      }
    )
    if (!response.ok) {
      throw new Error("Failed to download receipt")
    }
    return {
      blob: await response.blob(),
      filename: `smartlink-${transactionPublicId}-receipt.pdf`,
    }
  },
  async exportCsv(filters = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ""
    const accessToken = getAccessToken()
    const params = buildTransactionParams(filters)
    const response = await fetch(
      `${baseUrl}/api/stations/${stationPublicId}/transactions/export/csv?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      }
    )
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || "Failed to export transactions")
    }

    const blob = await response.blob()
    const filename = readFilenameFromDisposition(
      response.headers.get("content-disposition"),
      "smartlink_transactions.csv"
    )
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
    return filename
  },
}

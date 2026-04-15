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
    const stationPublicId = stationPublicIdOrThrow()
    const key = cacheKey(stationPublicId, "recent")
    if (!isBrowserOnline()) {
      return getCachedSnapshot(key, [])
    }
    try {
      const rows = await httpClient.get(`/api/stations/${stationPublicId}/transactions`)
      await saveCachedSnapshot(key, rows || [])
      return rows || []
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
}

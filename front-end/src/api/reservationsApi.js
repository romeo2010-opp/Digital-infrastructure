import { httpClient } from "./httpClient"
import { getStationPublicId } from "../auth/authSession"

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function statusLabelFromCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "FULFILLED") return "Completed"
  if (normalized === "CONFIRMED") return "Confirmed"
  if (normalized === "CANCELLED") return "Cancelled"
  if (normalized === "EXPIRED") return "Expired"
  return "Pending"
}

function statusCodeFromLabel(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "COMPLETED" || normalized === "FULFILLED") return "FULFILLED"
  if (normalized === "CONFIRMED") return "CONFIRMED"
  if (normalized === "CANCELLED") return "CANCELLED"
  if (normalized === "EXPIRED") return "EXPIRED"
  return "PENDING"
}

function mapReservation(row) {
  const fuelType = String(row?.fuelType || "").toUpperCase()
  const statusCode = String(row?.status || "").toUpperCase()
  const statusLabel = row?.statusLabel || statusLabelFromCode(statusCode)
  const requestedLitres = Number(row?.requestedLitres)
  const volume = Number.isFinite(requestedLitres) && requestedLitres > 0 ? requestedLitres : 0

  return {
    id: row?.publicId || row?.id || "",
    publicId: row?.publicId || row?.id || "",
    customer: row?.customerName || "Queue Customer",
    phone: row?.phone || "N/A",
    plate: row?.identifier || "N/A",
    product: fuelType === "DIESEL" ? "Diesel" : "Unleaded",
    volume,
    slot: row?.slotLabel || "No slot",
    status: statusLabel,
    statusCode: statusCode || "PENDING",
    notified: Boolean(row?.notified),
    notes: row?.notes || "",
    createdAt: row?.createdAt || null,
    sourceQueueJoinId: row?.sourceQueueJoinId || null,
  }
}

function normalizeListResponse(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const mappedItems = items.map(mapReservation)
  const stats = payload?.stats || {
    total: mappedItems.length,
    pending: mappedItems.filter((item) => item.statusCode === "PENDING").length,
    notified: mappedItems.filter((item) => item.notified).length,
  }
  return {
    items: mappedItems,
    stats: {
      total: Number(stats.total || 0),
      pending: Number(stats.pending || 0),
      notified: Number(stats.notified || 0),
    },
  }
}

export const reservationsApi = {
  async getList(params = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const query = new URLSearchParams()
    if (params?.status && params.status !== "All") {
      query.set("status", statusCodeFromLabel(params.status))
    }
    if (params?.q) {
      query.set("q", String(params.q).trim())
    }
    const suffix = query.toString() ? `?${query.toString()}` : ""
    const payload = await httpClient.get(`/api/stations/${stationPublicId}/reservations${suffix}`)
    return normalizeListResponse(payload)
  },

  async create(payload = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const body = {
      userPublicId: payload.userPublicId || undefined,
      customerName: payload.customerName,
      phone: payload.phone,
      identifier: payload.identifier,
      fuelType: String(payload.fuelType || "PETROL").toUpperCase(),
      requestedLitres:
        Number.isFinite(Number(payload.requestedLitres)) && Number(payload.requestedLitres) > 0
          ? Number(payload.requestedLitres)
          : undefined,
      slotStart: payload.slotStart || undefined,
      slotEnd: payload.slotEnd || undefined,
      status: statusCodeFromLabel(payload.status),
      notes: payload.notes || "",
    }
    return httpClient.post(`/api/stations/${stationPublicId}/reservations`, body)
  },

  async lookupUser(userPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    const query = new URLSearchParams({
      userPublicId: String(userPublicId || "").trim(),
    })
    return httpClient.get(`/api/stations/${stationPublicId}/reservations/user-lookup?${query.toString()}`)
  },

  async notify(reservationPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(
      `/api/stations/${stationPublicId}/reservations/${reservationPublicId}/notify`,
      {}
    )
  },

  async complete(reservationPublicId, payload = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const litres = Number(payload?.litres)
    const amount = Number(payload?.amount)
    const paymentMethod = String(payload?.paymentMethod || "").trim().toUpperCase()
    return httpClient.post(
      `/api/stations/${stationPublicId}/reservations/${reservationPublicId}/complete`,
      {
        litres: Number.isFinite(litres) && litres > 0 ? litres : undefined,
        amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        paymentMethod:
          paymentMethod && ["CASH", "MOBILE_MONEY", "CARD", "OTHER"].includes(paymentMethod)
            ? paymentMethod
            : undefined,
      }
    )
  },

  async cancel(reservationPublicId) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.delete(`/api/stations/${stationPublicId}/reservations/${reservationPublicId}`)
  },
}

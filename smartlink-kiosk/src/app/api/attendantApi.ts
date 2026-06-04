import { getKioskPermissions, getRoleCode, getStationPublicId } from "../auth/authSession"
import { httpClient } from "./httpClient"

const ATTENDANT_READ_ROLES = new Set(["MANAGER", "ATTENDANT", "VIEWER"])
const ATTENDANT_WRITE_ROLES = new Set(["MANAGER", "ATTENDANT"])

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function assertReadAccess() {
  const role = getRoleCode()
  if (!ATTENDANT_READ_ROLES.has(role)) {
    throw new Error("Forbidden: your role cannot access attendant operations.")
  }
}

function assertWriteAccess() {
  const role = getRoleCode()
  if (!ATTENDANT_WRITE_ROLES.has(role)) {
    throw new Error("Forbidden: your role cannot perform attendant operations.")
  }
}

function assertKioskPermission(permission: string) {
  const permissions = getKioskPermissions()
  if (permissions.length > 0 && !permissions.includes(permission)) {
    throw new Error("Forbidden: this kiosk session does not allow that action.")
  }
}

function orderPath(stationPublicId: string, orderType: string, orderPublicId: string) {
  return `/api/stations/${stationPublicId}/attendant/orders/${encodeURIComponent(orderType)}/${encodeURIComponent(orderPublicId)}`
}

export const attendantApi = {
  getDashboard() {
    assertReadAccess()
    assertKioskPermission("VIEW_QUEUE")
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/attendant/dashboard`)
  },
  resolveScanAndGo(code: string) {
    assertReadAccess()
    assertKioskPermission("VIEW_QUEUE")
    const scopedCode = String(code || "").trim()
    if (!scopedCode) {
      throw new Error("Scan & Go code is required.")
    }
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(
      `/api/stations/${stationPublicId}/attendant/scan-and-go/resolve?code=${encodeURIComponent(scopedCode)}`,
    )
  },
  acceptOrder(orderType: string, orderPublicId: string) {
    assertWriteAccess()
    assertKioskPermission("CONFIRM_CUSTOMER")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/accept`, {})
  },
  markCustomerArrived(orderType: string, orderPublicId: string) {
    assertWriteAccess()
    assertKioskPermission("CONFIRM_CUSTOMER")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/customer-arrived`, {})
  },
  updateServiceRequest(orderType: string, orderPublicId: string, payload: {
    fuelType?: "petrol" | "diesel"
    requestedLitres?: number
    amountMwk?: number
    vehicleLabel?: string
  }) {
    assertWriteAccess()
    assertKioskPermission("START_SERVICE")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/update-service-request`, payload)
  },
  assignPump(orderType: string, orderPublicId: string, payload: {
    pumpPublicId: string
    nozzlePublicId?: string | null
    note?: string
  }) {
    assertWriteAccess()
    assertKioskPermission("START_SERVICE")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/assign-pump`, payload)
  },
  startService(orderType: string, orderPublicId: string, payload: { manualMode?: boolean; manualReason?: string } = {}) {
    assertWriteAccess()
    assertKioskPermission("START_SERVICE")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/start-service`, payload)
  },
  completeService(orderType: string, orderPublicId: string, payload: {
    litres?: number
    amount?: number
    paymentMethod?: "SMARTPAY" | "CASH" | "MOBILE_MONEY" | "CARD" | "OTHER"
    note?: string
  }) {
    assertWriteAccess()
    assertKioskPermission("START_SERVICE")
    return httpClient.post(`${orderPath(stationPublicIdOrThrow(), orderType, orderPublicId)}/complete-service`, payload)
  },
}

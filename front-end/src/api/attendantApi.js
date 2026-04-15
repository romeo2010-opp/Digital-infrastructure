import { httpClient } from "./httpClient"
import { getRoleCode, getStationPublicId } from "../auth/authSession"

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

function orderPath(stationPublicId, orderType, orderPublicId) {
  return `/api/stations/${stationPublicId}/attendant/orders/${encodeURIComponent(orderType)}/${encodeURIComponent(orderPublicId)}`
}

export const attendantApi = {
  async getDashboard() {
    assertReadAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`/api/stations/${stationPublicId}/attendant/dashboard`)
  },
  async getOrderAudit(orderType, orderPublicId) {
    assertReadAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.get(`${orderPath(stationPublicId, orderType, orderPublicId)}/audit`)
  },
  async acceptOrder(orderType, orderPublicId) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/accept`, {})
  },
  async rejectOrder(orderType, orderPublicId, payload) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/reject`, payload)
  },
  async markCustomerArrived(orderType, orderPublicId, payload = {}) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/customer-arrived`, payload)
  },
  async assignPump(orderType, orderPublicId, payload) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/assign-pump`, payload)
  },
  async startService(orderType, orderPublicId, payload = {}) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/start-service`, payload)
  },
  async completeService(orderType, orderPublicId, payload = {}) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/complete-service`, payload)
  },
  async raiseIssue(orderType, orderPublicId, payload) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/issues`, payload)
  },
  async createRefundRequest(orderType, orderPublicId, payload) {
    assertWriteAccess()
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`${orderPath(stationPublicId, orderType, orderPublicId)}/refund-requests`, payload)
  },
}

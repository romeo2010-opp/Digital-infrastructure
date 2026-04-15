import { getRoleCode, getStationPublicId } from "../auth/authSession"
import { httpClient } from "./httpClient"

const STATION_READ_ROLES = new Set(["MANAGER", "ATTENDANT", "VIEWER"])
const STATION_WRITE_ROLES = new Set(["MANAGER", "ATTENDANT"])

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function assertReadAccess() {
  const role = getRoleCode()
  if (!STATION_READ_ROLES.has(role)) {
    throw new Error("Forbidden: your role cannot access kiosk station data.")
  }
}

function assertWriteAccess() {
  const role = getRoleCode()
  if (!STATION_WRITE_ROLES.has(role)) {
    throw new Error("Forbidden: your role cannot perform kiosk station actions.")
  }
}

export const kioskApi = {
  getOperationsKioskData() {
    assertReadAccess()
    return httpClient.get(`/api/stations/${stationPublicIdOrThrow()}/operations/kiosk-data`)
  },
  joinQueue(payload: { fuelType: "PETROL" | "DIESEL"; maskedPlate?: string; userPublicId?: string }) {
    assertWriteAccess()
    return httpClient.post(`/api/stations/${stationPublicIdOrThrow()}/queue/join`, payload)
  },
  attachFuelOrderToPumpSession(sessionId: string, payload: { fuelOrderId: string; forceReattach?: boolean; note?: string }) {
    assertWriteAccess()
    return httpClient.post(`/api/pump-sessions/${encodeURIComponent(sessionId)}/attach-fuel-order`, payload)
  },
  startFuelOrderDispensing(sessionId: string) {
    assertWriteAccess()
    return httpClient.post(`/api/pump-sessions/${encodeURIComponent(sessionId)}/start-dispensing`, {})
  },
  finalizeFuelOrder(sessionId: string, payload: { dispensedLitres?: number; amountMwk?: number; note?: string }) {
    assertWriteAccess()
    return httpClient.post(`/api/pump-sessions/${encodeURIComponent(sessionId)}/finalize-fuel-order`, payload)
  },
}

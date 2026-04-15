export function parseReservationMetadata(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function extractRequestedLiters(metadata) {
  const candidateKeys = [
    "requestedLiters",
    "requested_liters",
    "requestedLitres",
    "requested_litres",
  ]
  for (const key of candidateKeys) {
    const value = Number(metadata?.[key])
    if (Number.isFinite(value) && value > 0) {
      return Number(value.toFixed(1))
    }
  }
  return null
}

export function isQueueShadowReservationPublicId(value) {
  return String(value || "").trim().toUpperCase().startsWith("RSV-QUE-")
}

export function reservationStatusToUserLabel(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "FULFILLED") return "Completed"
  if (normalized === "CHECKED_IN") return "Checked In"
  if (normalized === "CONFIRMED") return "Confirmed"
  if (normalized === "CANCELLED") return "Cancelled"
  if (normalized === "EXPIRED") return "Expired"
  return "Pending"
}

export function reservationStatusToManagerLabel(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "FULFILLED") return "Completed"
  if (normalized === "CHECKED_IN") return "Checked In"
  if (normalized === "CONFIRMED") return "Confirmed"
  if (normalized === "CANCELLED") return "Cancelled"
  if (normalized === "EXPIRED") return "Expired"
  return "Pending"
}

export function isReservationsTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("user_reservations")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table")
  )
}

export async function syncReservationFromQueueEntryById(queueEntryId) {
  void queueEntryId
  return null
}

export async function syncReservationFromQueueEntryByPublicId(queueEntryPublicId) {
  void queueEntryPublicId
  return null
}

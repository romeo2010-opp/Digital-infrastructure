const LOW_REMAINING_PERCENT = 15
const LOW_REMAINING_LITERS = 120

function toFiniteNumberOrNull(value) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function normalizeFuelCode(value) {
  return String(value || "").trim().toUpperCase()
}

export function fuelTypeLabel(code) {
  const normalized = normalizeFuelCode(code)
  if (normalized === "PETROL") return "Petrol"
  if (normalized === "DIESEL") return "Diesel"
  return normalized
}

export function computeFuelTypeStatus({
  enabled,
  remainingLiters,
  remainingPercent,
  activeQueueCount,
}) {
  if (!enabled) return "unavailable"
  if (remainingPercent === null && remainingLiters === null) return "unavailable"
  if ((remainingPercent !== null && remainingPercent <= 0) || (remainingLiters !== null && remainingLiters <= 0)) {
    return "unavailable"
  }
  if (remainingPercent !== null && remainingPercent <= LOW_REMAINING_PERCENT) return "low"
  if (remainingLiters !== null && remainingLiters <= LOW_REMAINING_LITERS) return "low"
  if (Number(activeQueueCount || 0) > 0) return "in-use"
  return "available"
}

export function computeStationFuelStatuses({ fuelRows = [], queueRows = [], settings = {} }) {
  const fuelByCode = new Map(
    (fuelRows || []).map((row) => [normalizeFuelCode(row.fuel_code), row])
  )
  const queueByCode = new Map(
    (queueRows || []).map((row) => [normalizeFuelCode(row.fuel_code), Number(row.active_count || 0)])
  )

  const discoveredFuelCodes = new Set(["PETROL", "DIESEL"])
  fuelByCode.forEach((_value, key) => {
    if (key) discoveredFuelCodes.add(key)
  })
  queueByCode.forEach((_value, key) => {
    if (key) discoveredFuelCodes.add(key)
  })

  return Array.from(discoveredFuelCodes)
    .filter(Boolean)
    .map((code) => {
      const normalizedCode = normalizeFuelCode(code)
      const telemetry = fuelByCode.get(normalizedCode) || {}

      const remainingLiters = toFiniteNumberOrNull(telemetry.remaining_litres)
      const capacityLiters = toFiniteNumberOrNull(telemetry.capacity_litres)
      const remainingPercent =
        capacityLiters && capacityLiters > 0 && remainingLiters !== null
          ? Number(((remainingLiters / capacityLiters) * 100).toFixed(1))
          : null
      const activeQueueCount = Number(queueByCode.get(normalizedCode) || 0)

      const enabled =
        normalizedCode === "PETROL"
          ? Number(settings.petrol_enabled ?? 1) === 1
          : normalizedCode === "DIESEL"
            ? Number(settings.diesel_enabled ?? 1) === 1
            : true

      return {
        code: normalizedCode,
        label: fuelTypeLabel(normalizedCode),
        status: computeFuelTypeStatus({
          enabled,
          remainingLiters,
          remainingPercent,
          activeQueueCount,
        }),
      }
    })
}

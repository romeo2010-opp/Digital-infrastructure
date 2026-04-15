export function computeSalesVelocityLitresPerHour(totalLitres, windowHours) {
  const litres = Number(totalLitres)
  const hours = Number(windowHours)
  if (!Number.isFinite(litres) || !Number.isFinite(hours) || hours <= 0) return 0
  return litres / hours
}

export function computePumpUtilizationPercent(dispensingSeconds, windowSeconds) {
  const usedSeconds = Number(dispensingSeconds)
  const totalSeconds = Number(windowSeconds)
  if (!Number.isFinite(usedSeconds) || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return null
  return Math.max(0, Math.min(100, (usedSeconds / totalSeconds) * 100))
}

export function computeTimeUntilEmptyHours(remainingLitres, salesVelocityLph) {
  const remaining = Number(remainingLitres)
  const velocity = Number(salesVelocityLph)
  if (!Number.isFinite(remaining) || remaining < 0) return null
  if (!Number.isFinite(velocity) || velocity <= 0) return null
  return remaining / velocity
}

export function computeCarsPerHour(salesVelocityLph, avgLitresPerCar) {
  const velocity = Number(salesVelocityLph)
  const average = Number(avgLitresPerCar)
  if (!Number.isFinite(velocity) || velocity <= 0) return 0
  if (!Number.isFinite(average) || average <= 0) return 0
  return velocity / average
}

export function computeEstimatedWaitMinutes(vehiclesInQueue, carsPerHour) {
  const vehicles = Number(vehiclesInQueue)
  const throughput = Number(carsPerHour)
  if (!Number.isFinite(vehicles) || vehicles < 0) return null
  if (!Number.isFinite(throughput) || throughput <= 0) return null
  return (vehicles / throughput) * 60
}

export function classifyInventoryAlert(hoursUntilEmpty) {
  const hours = Number(hoursUntilEmpty)
  if (!Number.isFinite(hours)) return "UNKNOWN"
  if (hours < 6) return "CRITICAL"
  if (hours < 12) return "WARNING"
  return "NORMAL"
}

export function buildDemandLevelThresholds(values = []) {
  const sorted = (values || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)

  if (!sorted.length) {
    return { low: 0, medium: 0, high: 0 }
  }

  const at = (percentile) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)))
    return sorted[index]
  }

  return {
    low: at(0.25),
    medium: at(0.5),
    high: at(0.75),
  }
}

export function classifyDemandLevel(value, thresholds) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return "Low"
  if (numeric <= thresholds.low) return "Low"
  if (numeric <= thresholds.medium) return "Medium"
  if (numeric <= thresholds.high) return "High"
  return "Very High"
}

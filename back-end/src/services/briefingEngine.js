const SEVERITIES = new Set(["critical", "warning", "info", "success"])
const MS_PER_HOUR = 60 * 60 * 1000

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isValidIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false
  const time = Date.parse(value)
  return Number.isFinite(time)
}

function parseTime(value) {
  if (!isValidIsoTimestamp(value)) return null
  return Date.parse(value)
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object`)
  }
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`)
  }
}

function assertNumber(value, path, { min = 0 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  if (value < min) {
    throw new Error(`${path} must be greater than or equal to ${min}`)
  }
}

function assertString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`)
  }
}

function assertOptionalIso(value, path) {
  if (value === null || value === undefined || value === "") return
  if (!isValidIsoTimestamp(value)) {
    throw new Error(`${path} must be a valid ISO timestamp when provided`)
  }
}

function assertIso(value, path) {
  if (!isValidIsoTimestamp(value)) {
    throw new Error(`${path} must be a valid ISO timestamp`)
  }
}

function round2(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function percentChange(current, previous) {
  if (previous === 0) {
    if (current === 0) return 0
    return current > 0 ? 100 : -100
  }
  return round2(((current - previous) / previous) * 100)
}

function tankLevelPct(tank) {
  return (tank.currentLitres / tank.capacityLitres) * 100
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeFuelType(value) {
  return String(value || "").trim().toUpperCase()
}

function getReferenceTime(stationData) {
  return parseTime(stationData.briefingAt) ?? parseTime(stationData.lastLoginAt)
}

function isWithinNextHours(timestamp, referenceTime, hours) {
  const value = parseTime(timestamp)
  if (value === null) return false
  const delta = value - referenceTime
  return delta >= 0 && delta <= hours * MS_PER_HOUR
}

function makeAlert(severity, category, title, description) {
  if (!SEVERITIES.has(severity)) {
    throw new Error(`Unsupported alert severity: ${severity}`)
  }
  return { severity, category, title, description }
}

function buildAlerts(stationData, referenceTime, salesSummary, queueSummary) {
  const alerts = []

  stationData.tanks.forEach((tank) => {
    const pct = tankLevelPct(tank)
    const hasResupplyWithin6Hours = isWithinNextHours(tank.resupplyScheduledAt, referenceTime, 6)
    if (pct < 15 && !hasResupplyWithin6Hours) {
      alerts.push(
        makeAlert(
          "critical",
          "tanks",
          `${normalizeFuelType(tank.fuelType)} tank needs urgent resupply`,
          `Tank ${tank.id} is at ${round2(pct)}% capacity with no resupply within 6 hours.`
        )
      )
    }
  })

  stationData.tanks.forEach((tank) => {
    const pct = tankLevelPct(tank)
    if (pct < 10) {
      alerts.push(
        makeAlert(
          "critical",
          "tanks",
          `${normalizeFuelType(tank.fuelType)} tank is critically low`,
          `Tank ${tank.id} is below 10% capacity at ${round2(pct)}%.`
        )
      )
    }
  })

  stationData.pumps.forEach((pump) => {
    if (normalizeStatus(pump.status) === "offline") {
      alerts.push(
        makeAlert(
          "critical",
          "pumps",
          `${pump.label || pump.id} is offline`,
          `Pump ${pump.id} is offline and should be restored or isolated.`
        )
      )
    }
  })

  stationData.tanks.forEach((tank) => {
    const pct = tankLevelPct(tank)
    if (pct < 25) {
      alerts.push(
        makeAlert(
          "warning",
          "tanks",
          `${normalizeFuelType(tank.fuelType)} tank is running low`,
          `Tank ${tank.id} is below 25% capacity at ${round2(pct)}%.`
        )
      )
    }
  })

  stationData.pumps.forEach((pump) => {
    if (pump.faultEventsCount >= 3) {
      alerts.push(
        makeAlert(
          "warning",
          "pumps",
          `${pump.label || pump.id} has repeated faults`,
          `Pump ${pump.id} recorded ${pump.faultEventsCount} fault events in the session window.`
        )
      )
    }
  })

  if (stationData.queue.dropOffs > 10) {
    alerts.push(
      makeAlert(
        "warning",
        "queue",
        "Queue drop-offs are elevated",
        `${stationData.queue.dropOffs} drivers dropped off before service.`
      )
    )
  }

  if (queueSummary.waitDeltaMinutes > 5) {
    alerts.push(
      makeAlert(
        "warning",
        "queue",
        "Queue wait time is above target",
        `Average wait time is ${round2(queueSummary.waitDeltaMinutes)} minutes above target.`
      )
    )
  }

  stationData.deliveries.forEach((delivery) => {
    if (isWithinNextHours(delivery.scheduledAt, referenceTime, 12)) {
      alerts.push(
        makeAlert(
          "info",
          "deliveries",
          `${normalizeFuelType(delivery.fuelType)} delivery is scheduled soon`,
          `${delivery.estimatedLitres} litres are scheduled within 12 hours.`
        )
      )
    }
  })

  if (salesSummary.revenueChangePct > 5) {
    alerts.push(
      makeAlert(
        "success",
        "sales",
        "Revenue is up versus previous day",
        `Revenue increased by ${salesSummary.revenueChangePct}% versus the previous day.`
      )
    )
  }

  stationData.deliveries.forEach((delivery) => {
    if (normalizeStatus(delivery.status) === "confirmed") {
      alerts.push(
        makeAlert(
          "success",
          "deliveries",
          `${normalizeFuelType(delivery.fuelType)} delivery confirmed`,
          `A confirmed delivery of ${delivery.estimatedLitres} litres is scheduled.`
        )
      )
    }
  })

  return alerts
}

function buildInsight(alerts, queueSummary) {
  const critical = alerts.find((alert) => alert.severity === "critical")
  const nonQueueWarning = alerts.find((alert) => alert.severity === "warning" && alert.category !== "queue")
  const queueWarning = alerts.find((alert) => alert.severity === "warning" && alert.category === "queue")
  const positive = alerts.find((alert) => alert.severity === "success") || alerts.find((alert) => alert.severity === "info")

  let priority = "Keep monitoring station operations and maintain the current service rhythm."
  if (critical) {
    priority = `Act now: ${critical.title.toLowerCase()}.`
  } else if (nonQueueWarning) {
    priority = `Address warning: ${nonQueueWarning.title.toLowerCase()}.`
  } else if (queueWarning) {
    priority = `Reduce queue pressure: ${queueWarning.title.toLowerCase()}.`
  } else if (positive) {
    priority = `Maintain momentum: ${positive.title.toLowerCase()}.`
  }

  let note = "No secondary operational issue stands out from the supplied data."
  if (queueSummary.waitDeltaMinutes > 0) {
    note = `Queue waits are ${round2(queueSummary.waitDeltaMinutes)} minutes above target.`
  } else if (queueSummary.driversServed > 0) {
    note = `${queueSummary.driversServed} drivers were served with wait time at or below target.`
  } else if (positive) {
    note = positive.description
  }

  return { priority, note }
}

export function validateInput(stationData) {
  assertPlainObject(stationData, "stationData")
  assertIso(stationData.lastLoginAt, "lastLoginAt")
  assertOptionalIso(stationData.briefingAt, "briefingAt")

  assertArray(stationData.tanks, "tanks")
  stationData.tanks.forEach((tank, index) => {
    const path = `tanks[${index}]`
    assertPlainObject(tank, path)
    assertString(tank.id, `${path}.id`)
    assertString(tank.fuelType, `${path}.fuelType`)
    assertNumber(tank.capacityLitres, `${path}.capacityLitres`, { min: Number.MIN_VALUE })
    assertNumber(tank.currentLitres, `${path}.currentLitres`)
    assertOptionalIso(tank.resupplyScheduledAt, `${path}.resupplyScheduledAt`)
  })

  assertArray(stationData.pumps, "pumps")
  stationData.pumps.forEach((pump, index) => {
    const path = `pumps[${index}]`
    assertPlainObject(pump, path)
    assertString(pump.id, `${path}.id`)
    assertString(pump.label, `${path}.label`)
    assertNumber(pump.faultEventsCount, `${path}.faultEventsCount`)
    assertOptionalIso(pump.lastFaultAt, `${path}.lastFaultAt`)
    assertString(pump.status, `${path}.status`)
  })

  assertPlainObject(stationData.sales, "sales")
  assertNumber(stationData.sales.totalRevenueMWK, "sales.totalRevenueMWK")
  assertNumber(stationData.sales.totalLitres, "sales.totalLitres")
  assertNumber(stationData.sales.transactionCount, "sales.transactionCount")
  assertNumber(stationData.sales.previousDayRevenueMWK, "sales.previousDayRevenueMWK")
  assertNumber(stationData.sales.previousDayLitres, "sales.previousDayLitres")
  assertArray(stationData.sales.byFuelType, "sales.byFuelType")
  stationData.sales.byFuelType.forEach((row, index) => {
    const path = `sales.byFuelType[${index}]`
    assertPlainObject(row, path)
    assertString(row.fuelType, `${path}.fuelType`)
    assertNumber(row.litres, `${path}.litres`)
  })

  assertPlainObject(stationData.queue, "queue")
  assertNumber(stationData.queue.driversServed, "queue.driversServed")
  assertNumber(stationData.queue.avgWaitMinutes, "queue.avgWaitMinutes")
  assertNumber(stationData.queue.targetWaitMinutes, "queue.targetWaitMinutes")
  assertNumber(stationData.queue.dropOffs, "queue.dropOffs")
  assertArray(stationData.queue.peakHours, "queue.peakHours")
  stationData.queue.peakHours.forEach((row, index) => {
    const path = `queue.peakHours[${index}]`
    assertPlainObject(row, path)
    assertString(row.hour, `${path}.hour`)
    assertNumber(row.vehicleCount, `${path}.vehicleCount`)
  })

  assertArray(stationData.deliveries, "deliveries")
  stationData.deliveries.forEach((delivery, index) => {
    const path = `deliveries[${index}]`
    assertPlainObject(delivery, path)
    assertString(delivery.fuelType, `${path}.fuelType`)
    assertIso(delivery.scheduledAt, `${path}.scheduledAt`)
    assertNumber(delivery.estimatedLitres, `${path}.estimatedLitres`)
    assertString(delivery.status, `${path}.status`)
  })
}

export function generateBriefing(stationData) {
  validateInput(stationData)

  const referenceTime = getReferenceTime(stationData)
  const lastLoginTime = parseTime(stationData.lastLoginAt)
  const absenceHours = round2(Math.max(0, (referenceTime - lastLoginTime) / MS_PER_HOUR))

  const sales = {
    totalRevenueMWK: stationData.sales.totalRevenueMWK,
    totalLitres: stationData.sales.totalLitres,
    transactionCount: stationData.sales.transactionCount,
    revenueChangePct: percentChange(stationData.sales.totalRevenueMWK, stationData.sales.previousDayRevenueMWK),
    litresChangePct: percentChange(stationData.sales.totalLitres, stationData.sales.previousDayLitres),
    byFuelType: stationData.sales.byFuelType.map((row) => ({ ...row })),
  }

  const queue = {
    driversServed: stationData.queue.driversServed,
    avgWaitMinutes: stationData.queue.avgWaitMinutes,
    targetWaitMinutes: stationData.queue.targetWaitMinutes,
    dropOffs: stationData.queue.dropOffs,
    waitDeltaMinutes: round2(stationData.queue.avgWaitMinutes - stationData.queue.targetWaitMinutes),
    peakHours: stationData.queue.peakHours.map((row) => ({ ...row })),
  }

  const alerts = buildAlerts(stationData, referenceTime, sales, queue)

  return {
    absenceHours,
    alerts,
    sales,
    queue,
    insight: buildInsight(alerts, queue),
  }
}

/**
 * @typedef {"ALL" | "PETROL" | "DIESEL"} FuelType
 */

/**
 * @typedef {"ALL" | "MORNING" | "AFTERNOON" | "NIGHT"} Shift
 */

/**
 * @typedef {"OFF" | "ON" | "HYBRID"} PriorityMode
 */

/**
 * @typedef {"SALES" | "INVENTORY" | "PUMPS" | "QUEUE" | "SETTLEMENTS" | "DEMAND" | "EXCEPTIONS"} ReportTab
 */

/**
 * @typedef {Object} ReportFilters
 * @property {string} preset
 * @property {string} fromDate
 * @property {string} toDate
 * @property {Shift} shift
 * @property {FuelType} fuelType
 * @property {string} pumpId
 */

/**
 * @typedef {Object} ReportRun
 * @property {string} id
 * @property {string} createdAt
 * @property {"DRAFT" | "FINAL"} status
 */

/**
 * @typedef {Object} KpiMetrics
 * @property {number} totalLitres
 * @property {number} revenue
 * @property {number} transactions
 * @property {number} avgPricePerLitre
 * @property {number} variancePct
 * @property {number} queueNoShowRate
 */

/**
 * @typedef {Object} SalesPoint
 * @property {string} label
 * @property {number} value
 */

/**
 * @typedef {Object} SalesBreakdownRow
 * @property {string} fuelType
 * @property {number} litres
 * @property {number} revenue
 * @property {number} transactions
 */

/**
 * @typedef {Object} ReconciliationRow
 * @property {string} id
 * @property {string} tank
 * @property {number} opening
 * @property {number} deliveries
 * @property {number} closing
 * @property {number} expected
 * @property {number} actual
 * @property {number} variance
 * @property {string} varianceReason
 * @property {string} varianceNote
 */

/**
 * @typedef {Object} PumpMetricsRow
 * @property {string} pumpId
 * @property {string} fuelType
 * @property {number} uptimePct
 * @property {number} litresDispensed
 * @property {number} revenue
 * @property {number} avgTransactionTimeSec
 */

/**
 * @typedef {Object} QueueMetricsRow
 * @property {string} hour
 * @property {number} joined
 * @property {number} served
 * @property {number} noShow
 * @property {number} avgWaitMin
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} timestamp
 * @property {string} actor
 * @property {string} actionType
 * @property {string} summary
 */

/**
 * @typedef {Object} Incident
 * @property {string} id
 * @property {string} createdAt
 * @property {string} severity
 * @property {string} title
 * @property {string} status
 */

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} text
 * @property {string} createdAt
 * @property {string} author
 */

export const FuelTypeEnum = Object.freeze({
  ALL: "ALL",
  PETROL: "PETROL",
  DIESEL: "DIESEL",
})

export const ShiftEnum = Object.freeze({
  ALL: "ALL",
  MORNING: "MORNING",
  AFTERNOON: "AFTERNOON",
  NIGHT: "NIGHT",
})

export const ReportTabEnum = Object.freeze({
  SALES: "SALES",
  INVENTORY: "INVENTORY",
  PUMPS: "PUMPS",
  QUEUE: "QUEUE",
  SETTLEMENTS: "SETTLEMENTS",
  DEMAND: "DEMAND",
  EXCEPTIONS: "EXCEPTIONS",
})

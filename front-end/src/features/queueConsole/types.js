/**
 * @typedef {"OFF" | "ON" | "HYBRID"} PriorityMode
 */

/**
 * @typedef {"Waiting" | "Called" | "Late" | "No-show" | "Served" | "Cancelled"} QueueStatus
 */

/**
 * @typedef {Object} QueueEntry
 * @property {string} id
 * @property {string} plate
 * @property {string} maskedIdentifier
 * @property {string} joinTime
 * @property {string} joinedAt
 * @property {QueueStatus} status
 * @property {number} etaMinutes
 * @property {string | null} calledAt
 * @property {string | null} graceExpiresAt
 * @property {Record<string, unknown>=} servedMeta
 */

/**
 * @typedef {"Active" | "Paused" | "Offline"} PumpStatus
 */

/**
 * @typedef {Object} Pump
 * @property {string} id
 * @property {string} label
 * @property {PumpStatus} status
 * @property {string} fuelType
 * @property {string} reason
 */

/**
 * @typedef {Object} StationQueueSettings
 * @property {number} graceMinutes
 * @property {number} capacity
 * @property {boolean} joinsPaused
 * @property {{ petrol: boolean, diesel: boolean }} fuelTypes
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} timestamp
 * @property {string} actor
 * @property {string} actionType
 * @property {string} summary
 * @property {Record<string, unknown>} payload
 */

export {}

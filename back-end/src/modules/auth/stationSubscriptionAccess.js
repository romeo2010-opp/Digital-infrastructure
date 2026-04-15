import { prisma } from "../../db/prisma.js"
import { unauthorized } from "../../utils/http.js"

const ALLOWED_SUBSCRIPTION_STATUSES = new Set(["ACTIVE", "TRIAL"])
const STATION_STAFF_ROLES = new Set(["MANAGER", "ATTENDANT", "VIEWER"])

function normalizeOptional(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

function normalizeDateOnly(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getUTCFullYear()
    const month = String(value.getUTCMonth() + 1).padStart(2, "0")
    const day = String(value.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const scoped = String(value).trim()
  if (!scoped) return null
  return scoped.slice(0, 10)
}

function dateOnlyInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeOptional(timeZone) || "Africa/Blantyre",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value || "0000"
  const month = parts.find((part) => part.type === "month")?.value || "01"
  const day = parts.find((part) => part.type === "day")?.value || "01"
  return `${year}-${month}-${day}`
}

function formatRole(roleCode) {
  return String(roleCode || "")
    .trim()
    .toUpperCase()
}

function formatStatus(status) {
  return String(status || "")
    .trim()
    .toUpperCase()
}

export function isStationStaffRole(roleCode) {
  return STATION_STAFF_ROLES.has(formatRole(roleCode))
}

export function evaluateStationSubscriptionAccess(subscription, options = {}) {
  if (!subscription) {
    return {
      allowed: false,
      reason: "subscription_not_configured",
      message: "This station does not have an active subscription setup yet. Configure the subscription before signing in.",
    }
  }

  const status = formatStatus(subscription.status)
  const renewalDate = normalizeDateOnly(subscription.renewalDate || subscription.renewal_date)
  const stationName = normalizeOptional(subscription.stationName || subscription.station_name) || "this station"
  const timeZone = normalizeOptional(subscription.timezone) || "Africa/Blantyre"
  const today = dateOnlyInTimeZone(options.now instanceof Date ? options.now : new Date(), timeZone)

  if (!status && !renewalDate) {
    return {
      allowed: false,
      reason: "subscription_not_configured",
      message: `The subscription for ${stationName} is not configured yet. Configure it before signing in.`,
    }
  }

  if (status && !ALLOWED_SUBSCRIPTION_STATUSES.has(status)) {
    return {
      allowed: false,
      reason: "status_blocked",
      message: `The subscription for ${stationName} is ${status.toLowerCase()}. Renew or reactivate it before signing in again.`,
    }
  }

  if (renewalDate && renewalDate < today) {
    return {
      allowed: false,
      reason: "renewal_expired",
      message: `The subscription for ${stationName} expired on ${renewalDate}. Renew it before signing in again.`,
    }
  }

  return {
    allowed: true,
    reason: null,
    message: null,
  }
}

export async function getStationSubscriptionAccess(stationId) {
  if (!stationId) {
    return {
      allowed: true,
      reason: null,
      message: null,
    }
  }

  const rows = await prisma.$queryRaw`
    SELECT
      st.name AS station_name,
      st.timezone,
      sss.status,
      sss.renewal_date
    FROM stations st
    LEFT JOIN station_subscription_statuses sss ON sss.station_id = st.id
    WHERE st.id = ${stationId}
      AND st.deleted_at IS NULL
    LIMIT 1
  `

  return evaluateStationSubscriptionAccess(rows?.[0] || null)
}

export async function assertStationSubscriptionAccess({ stationId, roleCode }) {
  if (!stationId || !isStationStaffRole(roleCode)) return

  const access = await getStationSubscriptionAccess(stationId)
  if (!access.allowed) {
    throw unauthorized(access.message || "Station subscription access is blocked")
  }
}

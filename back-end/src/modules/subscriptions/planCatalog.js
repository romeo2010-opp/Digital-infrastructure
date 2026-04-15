import { prisma } from "../../db/prisma.js"

export const STATION_PLAN_CODES = Object.freeze({
  TRIAL: "TRIAL",
  ESSENTIAL: "ESSENTIAL",
  GROWTH: "GROWTH",
  ENTERPRISE: "ENTERPRISE",
})

export const STATION_PLAN_FEATURES = Object.freeze({
  SETTINGS_CORE: "SETTINGS_CORE",
  DIGITAL_QUEUE: "DIGITAL_QUEUE",
  RESERVATIONS: "RESERVATIONS",
  TRANSACTIONS_VIEW: "TRANSACTIONS_VIEW",
  TRANSACTIONS_RECORD: "TRANSACTIONS_RECORD",
  MONITORING: "MONITORING",
  REPORTS_EXPORT: "REPORTS_EXPORT",
  INSIGHTS: "INSIGHTS",
})

const PLAN_CATALOG = Object.freeze({
  [STATION_PLAN_CODES.TRIAL]: {
    code: STATION_PLAN_CODES.TRIAL,
    name: "Trial Plan",
    monthlyFeeMwk: 0,
    features: [],
  },
  [STATION_PLAN_CODES.ESSENTIAL]: {
    code: STATION_PLAN_CODES.ESSENTIAL,
    name: "Essential Station",
    monthlyFeeMwk: 150000,
    features: [
      STATION_PLAN_FEATURES.SETTINGS_CORE,
      STATION_PLAN_FEATURES.TRANSACTIONS_VIEW,
    ],
  },
  [STATION_PLAN_CODES.GROWTH]: {
    code: STATION_PLAN_CODES.GROWTH,
    name: "Growth Operations",
    monthlyFeeMwk: 200000,
    features: [
      STATION_PLAN_FEATURES.SETTINGS_CORE,
      STATION_PLAN_FEATURES.DIGITAL_QUEUE,
      STATION_PLAN_FEATURES.RESERVATIONS,
      STATION_PLAN_FEATURES.TRANSACTIONS_VIEW,
      STATION_PLAN_FEATURES.TRANSACTIONS_RECORD,
      STATION_PLAN_FEATURES.MONITORING,
    ],
  },
  [STATION_PLAN_CODES.ENTERPRISE]: {
    code: STATION_PLAN_CODES.ENTERPRISE,
    name: "Enterprise Network",
    monthlyFeeMwk: 250000,
    features: [
      STATION_PLAN_FEATURES.SETTINGS_CORE,
      STATION_PLAN_FEATURES.DIGITAL_QUEUE,
      STATION_PLAN_FEATURES.RESERVATIONS,
      STATION_PLAN_FEATURES.TRANSACTIONS_VIEW,
      STATION_PLAN_FEATURES.TRANSACTIONS_RECORD,
      STATION_PLAN_FEATURES.MONITORING,
      STATION_PLAN_FEATURES.REPORTS_EXPORT,
      STATION_PLAN_FEATURES.INSIGHTS,
    ],
  },
})

const FEATURE_REQUIREMENTS = Object.freeze({
  [STATION_PLAN_FEATURES.SETTINGS_CORE]: STATION_PLAN_CODES.ESSENTIAL,
  [STATION_PLAN_FEATURES.DIGITAL_QUEUE]: STATION_PLAN_CODES.GROWTH,
  [STATION_PLAN_FEATURES.RESERVATIONS]: STATION_PLAN_CODES.GROWTH,
  [STATION_PLAN_FEATURES.TRANSACTIONS_VIEW]: STATION_PLAN_CODES.ESSENTIAL,
  [STATION_PLAN_FEATURES.TRANSACTIONS_RECORD]: STATION_PLAN_CODES.GROWTH,
  [STATION_PLAN_FEATURES.MONITORING]: STATION_PLAN_CODES.GROWTH,
  [STATION_PLAN_FEATURES.REPORTS_EXPORT]: STATION_PLAN_CODES.ENTERPRISE,
  [STATION_PLAN_FEATURES.INSIGHTS]: STATION_PLAN_CODES.ENTERPRISE,
})

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
  return String(value).trim().slice(0, 10) || null
}

export function normalizeStationPlanCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (PLAN_CATALOG[normalized]) return normalized
  return STATION_PLAN_CODES.TRIAL
}

export function getStationPlanDefinition(planCode) {
  return PLAN_CATALOG[normalizeStationPlanCode(planCode)]
}

export function hasStationPlanFeature(planCode, featureKey) {
  const plan = getStationPlanDefinition(planCode)
  return plan.features.includes(featureKey)
}

export function getStationPlanFeatureRequirement(featureKey) {
  const planCode = FEATURE_REQUIREMENTS[featureKey] || STATION_PLAN_CODES.TRIAL
  return getStationPlanDefinition(planCode)
}

export function toStationSubscriptionSummary(row) {
  if (!row) return null

  const planCode = normalizeStationPlanCode(row.plan_code || row.planCode)
  const plan = getStationPlanDefinition(planCode)
  const monthlyFeeRaw = Number(row.monthly_fee_mwk ?? row.monthlyFeeMwk)
  const monthlyFeeMwk = Number.isFinite(monthlyFeeRaw) ? monthlyFeeRaw : plan.monthlyFeeMwk

  return {
    planCode,
    planName: normalizeOptional(row.plan_name || row.planName) || plan.name,
    monthlyFeeMwk,
    status: normalizeOptional(row.status) || null,
    renewalDate: normalizeDateOnly(row.renewal_date || row.renewalDate),
  }
}

export async function getStationSubscriptionSummary(stationId) {
  if (!stationId) return null

  const rows = await prisma.$queryRaw`
    SELECT plan_code, plan_name, monthly_fee_mwk, status, renewal_date
    FROM station_subscription_statuses
    WHERE station_id = ${stationId}
    LIMIT 1
  `

  return toStationSubscriptionSummary(rows?.[0] || null)
}

export function buildStationPlanUpgradeMessage(featureKey, subscription) {
  const requirement = getStationPlanFeatureRequirement(featureKey)
  const currentPlan = getStationPlanDefinition(subscription?.planCode)
  const featureLabel =
    featureKey === STATION_PLAN_FEATURES.DIGITAL_QUEUE
      ? "Digital Queue"
      : featureKey === STATION_PLAN_FEATURES.RESERVATIONS
        ? "Reservations"
        : featureKey === STATION_PLAN_FEATURES.INSIGHTS
          ? "SmartLink Insights"
          : featureKey === STATION_PLAN_FEATURES.REPORTS_EXPORT
            ? "report exports"
            : featureKey === STATION_PLAN_FEATURES.MONITORING
              ? "live monitoring"
              : featureKey === STATION_PLAN_FEATURES.TRANSACTIONS_RECORD
                ? "transaction recording"
                : featureKey === STATION_PLAN_FEATURES.TRANSACTIONS_VIEW
                  ? "transaction visibility"
                  : "this feature"

  return `${featureLabel} is not available on ${currentPlan.name}. Upgrade to ${requirement.name} to unlock it.`
}

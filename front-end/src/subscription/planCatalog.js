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

export function normalizeStationPlanCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return PLAN_CATALOG[normalized] ? normalized : STATION_PLAN_CODES.TRIAL
}

export function getStationPlanDefinition(planCode) {
  return PLAN_CATALOG[normalizeStationPlanCode(planCode)]
}

export function getFeatureRequirement(featureKey) {
  return getStationPlanDefinition(FEATURE_REQUIREMENTS[featureKey] || STATION_PLAN_CODES.TRIAL)
}

export function hasStationPlanFeature(planCode, featureKey) {
  return getStationPlanDefinition(planCode).features.includes(featureKey)
}

export function getSessionStationPlan(session) {
  const subscription = session?.station?.subscription || null
  const planCode = normalizeStationPlanCode(subscription?.planCode)
  const plan = getStationPlanDefinition(planCode)

  return {
    ...plan,
    planCode,
    planName: subscription?.planName || plan.name,
    monthlyFeeMwk:
      Number.isFinite(Number(subscription?.monthlyFeeMwk)) ? Number(subscription.monthlyFeeMwk) : plan.monthlyFeeMwk,
    status: subscription?.status || null,
    renewalDate: subscription?.renewalDate || null,
  }
}

export function formatPlanPrice(monthlyFeeMwk) {
  if (!Number.isFinite(Number(monthlyFeeMwk)) || Number(monthlyFeeMwk) <= 0) return "Free"
  return `MWK ${Number(monthlyFeeMwk).toLocaleString()}/month`
}

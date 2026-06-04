import { badRequest, notFound } from "../../../utils/http.js"
import { hasMeraPermission, MERA_PERMISSIONS } from "../permissions.js"
import * as portalService from "./portal.service.js"
import * as taskService from "./task.service.js"
import * as commandService from "./commandCentre.service.js"
import { listHoardingWatchlist as listHoardingWatchlistService } from "./hoarding.service.js"

export const MERA_PACKET_DEFAULTS = {
  overview: null,
  flaggedStations: [],
  heatmap: [],
  complaintMetrics: null,
  inspectionMetrics: null,
  demandForecastSummary: null,
  nationalOperations: null,
  opsPredictions: { items: [], errors: [] },
  tasks: { items: [] },
  myTasks: { items: [], counts: { byStatus: {}, byPriority: {} } },
  taskStats: null,
  assignableUsers: [],
  notifications: { unreadCount: 0, items: [] },
  hoardingWatchlist: { items: [] },
  fuelDeliveryLogs: { items: [] },
  availabilityReports: { items: [] },
  complaints: { items: [] },
  flags: { items: [] },
  inspections: { items: [] },
  enforcementActions: { items: [] },
  profiles: [],
  licenseRegistry: { items: [] },
  expiryAlerts: [],
  topComplaintStations: [],
  districtShortages: [],
  repeatedOffenders: [],
  monthlyReports: [],
  users: [],
  auditLogs: { items: [] },
  reports: { items: [] },
  publicNotices: { items: [] },
  priceCompliance: { official: { items: [] }, compliance: { items: [] }, violations: { items: [] } },
  analytics: { stress: null, districts: null, stations: null, trends: null },
}

function canAny(auth, permissions = []) {
  return permissions.filter(Boolean).some((permission) => hasMeraPermission(auth, permission))
}

function forbiddenError(key) {
  const error = new Error(`Forbidden MERA packet: ${key}`)
  error.status = 403
  return error
}

function normalizeLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback
}

const PACKET_DEFINITIONS = {
  overview: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_COMMAND_CENTRE]),
    load: ({ auth }) => portalService.getDashboardOverview(auth),
  },
  flaggedStations: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.FLAGS_VIEW),
    load: ({ auth }) => portalService.getFlaggedStations(auth),
  },
  heatmap: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.HEATMAP_VIEW, MERA_PERMISSIONS.VIEW_MAP]),
    load: ({ auth }) => portalService.getShortageHeatmapData(auth),
  },
  complaintMetrics: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.COMPLAINTS_VIEW),
    load: ({ auth }) => portalService.getComplaintMetrics(auth),
  },
  inspectionMetrics: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.INSPECTIONS_VIEW),
    load: ({ auth }) => portalService.getInspectionMetrics(auth),
  },
  demandForecastSummary: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth }) => portalService.getDemandForecastSummary(auth),
  },
  opsPredictions: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth, params }) => portalService.getMeraOpsPredictions(auth, params || {}),
  },
  nationalOperations: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_COMMAND_CENTRE]),
    load: ({ auth, params }) => portalService.getNationalOperationsDashboard(auth, {
      availabilityInterval: params?.availabilityInterval,
    }),
  },
  tasks: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]),
    load: ({ auth, params }) => taskService.listTasks({ ...(params || {}), limit: normalizeLimit(params?.limit, 75) }, auth),
  },
  myTasks: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK]),
    load: ({ auth, params }) => taskService.listMyTasks({ ...(params || {}), limit: normalizeLimit(params?.limit, 50) }, auth),
  },
  taskStats: {
    canLoad: (auth) => canAny(auth, [
      MERA_PERMISSIONS.TASKS_STATS_VIEW,
      MERA_PERMISSIONS.TASKS_VIEW_ALL,
      MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
      MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
    ]),
    load: ({ auth }) => taskService.getTaskStatsOverview(auth),
  },
  assignableUsers: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_MANAGE]),
    load: ({ auth }) => taskService.listAssignableUsers(auth),
  },
  notifications: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]),
    load: ({ auth, params }) => taskService.listNotifications({ limit: normalizeLimit(params?.limit, 12) }, auth),
  },
  hoardingWatchlist: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT, MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.ALERTS_VIEW]),
    load: ({ auth, params }) => listHoardingWatchlistService(params || {}, auth),
  },
  fuelDeliveryLogs: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.DELIVERIES_VIEW),
    load: ({ auth, params }) => portalService.listFuelDeliveryLogs(params || {}, auth),
  },
  availabilityReports: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
    load: ({ auth, params }) => portalService.listAvailabilityReports(params || {}, auth),
  },
  complaints: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.COMPLAINTS_VIEW),
    load: ({ auth, params }) => portalService.listComplaints(params || {}, auth),
  },
  flags: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.FLAGS_VIEW),
    load: ({ auth, params }) => portalService.listFlags(params || {}, auth),
  },
  inspections: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.INSPECTIONS_VIEW, MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.COMPLETE_INSPECTIONS]),
    load: ({ auth, params }) => portalService.listInspections(params || {}, auth),
  },
  enforcementActions: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.ENFORCEMENT_VIEW),
    load: ({ auth, params }) => portalService.listEnforcementActions(params || {}, auth),
  },
  profiles: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_STATION_PROFILE]),
    load: ({ auth }) => portalService.listStationRegulatoryProfiles(auth),
  },
  licenseRegistry: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.LICENSES_VIEW),
    load: ({ auth, params }) => portalService.listLicenseRegistry(params || {}, auth),
  },
  expiryAlerts: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW]),
    load: ({ auth, params }) => portalService.getLicenseExpiryAlerts(params || {}, auth),
  },
  topComplaintStations: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth }) => portalService.getTopComplaintStations(auth),
  },
  districtShortages: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth }) => portalService.getDistrictShortageSummaries(auth),
  },
  repeatedOffenders: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth }) => portalService.getRepeatedOffenders(auth),
  },
  monthlyReports: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth }) => portalService.getMonthlyRegulatoryReports(auth),
  },
  users: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.USERS_VIEW),
    load: ({ auth }) => portalService.listMeraUsers(auth),
  },
  auditLogs: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.AUDIT_VIEW, MERA_PERMISSIONS.VIEW_AUDIT_LOGS]),
    load: ({ auth, params }) => portalService.listMeraAuditLogs(params || {}, auth),
  },
  reports: {
    canLoad: (auth) => hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW),
    load: ({ auth, params }) => commandService.listReports(params || {}, auth),
  },
  publicNotices: {
    canLoad: (auth) => canAny(auth, [
      MERA_PERMISSIONS.PUBLIC_NOTICES_VIEW,
      MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE,
      MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE,
      MERA_PERMISSIONS.PUBLISH_PUBLIC_NOTICE,
    ]),
    load: ({ auth, params }) => commandService.listPublicNotices(params || {}, auth),
  },
  priceCompliance: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW]),
    load: async ({ auth, params }) => {
      const [official, compliance, violations] = await Promise.all([
        commandService.listOfficialPrices(params || {}),
        commandService.listPriceCompliance(params || {}, auth),
        commandService.listPriceViolations(params || {}, auth),
      ])
      return { official, compliance, violations }
    },
  },
  analytics: {
    canLoad: (auth) => canAny(auth, [MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]),
    load: async ({ auth }) => {
      const [stress, districts, stations, trends] = await Promise.all([
        commandService.getFuelStressAnalytics(auth),
        commandService.getDistrictAnalytics(auth),
        commandService.getStationAnalytics(auth),
        commandService.getTrendAnalytics(auth),
      ])
      return { stress, districts, stations, trends }
    },
  },
}

export const MERA_PACKET_KEYS = Object.freeze(Object.keys(PACKET_DEFINITIONS))

export function normalizeMeraPacketKeys(keys) {
  const requested = Array.isArray(keys) ? keys : String(keys || "").split(",")
  const normalized = requested
    .map((key) => String(key || "").trim())
    .filter(Boolean)

  return [...new Set(normalized)]
}

export function getMeraPacketDefinition(key) {
  return PACKET_DEFINITIONS[String(key || "").trim()] || null
}

export async function loadMeraPacket(key, auth, params = {}) {
  const normalizedKey = String(key || "").trim()
  const definition = getMeraPacketDefinition(normalizedKey)
  if (!definition) throw notFound(`Unknown MERA packet: ${normalizedKey}`)
  if (!definition.canLoad(auth)) throw forbiddenError(normalizedKey)
  return definition.load({ auth, params: params || {} })
}

export async function loadMeraPacketResult(key, auth, params = {}) {
  try {
    const data = await loadMeraPacket(key, auth, params)
    return { key, status: "ready", data }
  } catch (error) {
    return {
      key,
      status: Number(error?.status) === 403 ? "forbidden" : "error",
      error: error?.message || "Unable to load MERA packet",
    }
  }
}

export async function buildMeraLegacySnapshot(auth) {
  const snapshot = { ...MERA_PACKET_DEFAULTS }
  const errors = []
  const keys = Object.keys(MERA_PACKET_DEFAULTS).filter((key) => key in PACKET_DEFINITIONS)
  const settled = await Promise.all(keys.map((key) => loadMeraPacketResult(key, auth)))

  settled.forEach((result) => {
    if (result.status === "ready") {
      snapshot[result.key] = result.data
      return
    }
    if (result.status !== "forbidden") {
      errors.push({ key: result.key, message: result.error || "request failed" })
    }
  })

  return { ...snapshot, _errors: errors }
}

export function assertKnownMeraPacketKey(key) {
  const normalizedKey = String(key || "").trim()
  if (!normalizedKey) throw badRequest("MERA packet key is required")
  if (!getMeraPacketDefinition(normalizedKey)) throw notFound(`Unknown MERA packet: ${normalizedKey}`)
  return normalizedKey
}

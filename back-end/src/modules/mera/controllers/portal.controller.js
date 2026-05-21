import { ok } from "../../../utils/http.js"
import * as portalService from "../services/portal.service.js"
import * as taskService from "../services/task.service.js"
import {
  evaluateComplaintDrivenFlags,
  evaluateDryStatusFlags,
  evaluateInspectionDrivenFlags,
} from "../services/flagging.service.js"
import {
  calculateStationHoardingRisk,
  getHoardingWatchlistDetail as getHoardingWatchlistDetailService,
  listHoardingWatchlist as listHoardingWatchlistService,
} from "../services/hoarding.service.js"
import { hasMeraPermission, MERA_PERMISSIONS } from "../permissions.js"

const snapshotDefaults = {
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
}

function canAny(auth, permissions = []) {
  return permissions.some((permission) => hasMeraPermission(auth, permission))
}

async function buildSnapshot(auth) {
  const requests = [
    [
      "overview",
      canAny(auth, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
      () => portalService.getDashboardOverview(auth),
    ],
    ["flaggedStations", hasMeraPermission(auth, MERA_PERMISSIONS.FLAGS_VIEW), () => portalService.getFlaggedStations(auth)],
    ["heatmap", hasMeraPermission(auth, MERA_PERMISSIONS.HEATMAP_VIEW), () => portalService.getShortageHeatmapData(auth)],
    ["complaintMetrics", hasMeraPermission(auth, MERA_PERMISSIONS.COMPLAINTS_VIEW), () => portalService.getComplaintMetrics(auth)],
    ["inspectionMetrics", hasMeraPermission(auth, MERA_PERMISSIONS.INSPECTIONS_VIEW), () => portalService.getInspectionMetrics(auth)],
    ["demandForecastSummary", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getDemandForecastSummary(auth)],
    ["opsPredictions", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getMeraOpsPredictions(auth)],
    [
      "nationalOperations",
      canAny(auth, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
      () => portalService.getNationalOperationsDashboard(auth),
    ],
    [
      "tasks",
      canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]),
      () => taskService.listTasks({ limit: 75 }, auth),
    ],
    [
      "myTasks",
      canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK]),
      () => taskService.listMyTasks({ limit: 50 }, auth),
    ],
    [
      "taskStats",
      canAny(auth, [
        MERA_PERMISSIONS.TASKS_STATS_VIEW,
        MERA_PERMISSIONS.TASKS_VIEW_ALL,
        MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
        MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
      ]),
      () => taskService.getTaskStatsOverview(auth),
    ],
    [
      "assignableUsers",
      canAny(auth, [MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_MANAGE]),
      () => taskService.listAssignableUsers(auth),
    ],
    [
      "notifications",
      canAny(auth, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]),
      () => taskService.listNotifications({ limit: 12 }, auth),
    ],
    [
      "hoardingWatchlist",
      canAny(auth, [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
      () => listHoardingWatchlistService({}, auth),
    ],
    ["fuelDeliveryLogs", hasMeraPermission(auth, MERA_PERMISSIONS.DELIVERIES_VIEW), () => portalService.listFuelDeliveryLogs({}, auth)],
    [
      "availabilityReports",
      canAny(auth, [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
      () => portalService.listAvailabilityReports({}, auth),
    ],
    ["complaints", hasMeraPermission(auth, MERA_PERMISSIONS.COMPLAINTS_VIEW), () => portalService.listComplaints({}, auth)],
    ["flags", hasMeraPermission(auth, MERA_PERMISSIONS.FLAGS_VIEW), () => portalService.listFlags({}, auth)],
    ["inspections", hasMeraPermission(auth, MERA_PERMISSIONS.INSPECTIONS_VIEW), () => portalService.listInspections({}, auth)],
    ["enforcementActions", hasMeraPermission(auth, MERA_PERMISSIONS.ENFORCEMENT_VIEW), () => portalService.listEnforcementActions({}, auth)],
    [
      "profiles",
      canAny(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]),
      () => portalService.listStationRegulatoryProfiles(auth),
    ],
    ["licenseRegistry", hasMeraPermission(auth, MERA_PERMISSIONS.LICENSES_VIEW), () => portalService.listLicenseRegistry({}, auth)],
    [
      "expiryAlerts",
      canAny(auth, [MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW]),
      () => portalService.getLicenseExpiryAlerts({}, auth),
    ],
    ["topComplaintStations", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getTopComplaintStations(auth)],
    ["districtShortages", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getDistrictShortageSummaries(auth)],
    ["repeatedOffenders", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getRepeatedOffenders(auth)],
    ["monthlyReports", hasMeraPermission(auth, MERA_PERMISSIONS.REPORTS_VIEW), () => portalService.getMonthlyRegulatoryReports(auth)],
    ["users", hasMeraPermission(auth, MERA_PERMISSIONS.USERS_VIEW), () => portalService.listMeraUsers(auth)],
    ["auditLogs", hasMeraPermission(auth, MERA_PERMISSIONS.AUDIT_VIEW), () => portalService.listMeraAuditLogs({}, auth)],
  ]

  const settled = await Promise.allSettled(
    requests.map(([key, allowed, request]) => (allowed ? request() : Promise.resolve(snapshotDefaults[key]))),
  )
  const snapshot = { ...snapshotDefaults }
  const errors = []

  requests.forEach(([key, allowed], index) => {
    const result = settled[index]
    if (!allowed) {
      snapshot[key] = snapshotDefaults[key]
      return
    }
    if (result.status === "fulfilled") {
      snapshot[key] = result.value
    } else {
      snapshot[key] = snapshotDefaults[key]
      errors.push({ key, message: result.reason?.message || "request failed" })
    }
  })

  return { ...snapshot, _errors: errors }
}

export async function snapshot(req, res) {
  return ok(res, await buildSnapshot(req.meraAuth))
}

export async function listPublicStations(req, res) {
  return ok(res, await portalService.listPublicStations(req.query))
}

export async function createComplaint(req, res) {
  const data = await portalService.createPublicComplaint({
    ...req.body,
    mediaUrl: req.uploadedFileUrl || null,
  })
  const station = await portalService.getStationRegulatoryProfile(req.body.stationPublicId).catch(() => null)
  if (station?.station?.id) {
    await evaluateComplaintDrivenFlags({ stationId: Number(station.station.id) })
    await calculateStationHoardingRisk(Number(station.station.id), { actor: req.meraAuth || null })
  }
  return ok(res, data, 201)
}

export async function listComplaints(req, res) {
  return ok(res, await portalService.listComplaints(req.query, req.meraAuth))
}

export async function assignComplaint(req, res) {
  return ok(
    res,
    await portalService.assignComplaint({
      complaintPublicId: req.params.publicId,
      officerPublicId: req.body.officerPublicId,
      actor: req.meraAuth,
    })
  )
}

export async function updateComplaintStatus(req, res) {
  return ok(
    res,
    await portalService.updateComplaintStatus({
      complaintPublicId: req.params.publicId,
      complaintStatus: req.body.complaintStatus,
      actor: req.meraAuth,
    })
  )
}

export async function createInspection(req, res) {
  const payload = await portalService.createInspection(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateInspectionDrivenFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, payload, 201)
}

export async function uploadInspectionEvidence(req, res) {
  return ok(
    res,
    await portalService.attachInspectionEvidence({
      inspectionPublicId: req.params.publicId,
      fileUrl: req.uploadedFileUrl,
      fileType: req.uploadedFileType,
      actor: req.meraAuth,
    }),
    201
  )
}

export async function listInspections(req, res) {
  return ok(res, await portalService.listInspections(req.query, req.meraAuth))
}

export async function stationInspectionHistory(req, res) {
  return ok(res, await portalService.getStationInspectionHistory(req.params.publicId, req.meraAuth))
}

export async function createFlag(req, res) {
  return ok(res, await portalService.createManualFlag(req.body, req.meraAuth), 201)
}

export async function listFlags(req, res) {
  return ok(res, await portalService.listFlags(req.query, req.meraAuth))
}

export async function resolveFlag(req, res) {
  return ok(
    res,
    await portalService.resolveFlag({
      flagPublicId: req.params.publicId,
      resolvedStatus: req.body.resolvedStatus,
      actor: req.meraAuth,
    })
  )
}

export async function createEnforcementAction(req, res) {
  const data = await portalService.createEnforcementAction(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, data, 201)
}

export async function listEnforcementActions(req, res) {
  return ok(res, await portalService.listEnforcementActions(req.query, req.meraAuth))
}

export async function stationEnforcementHistory(req, res) {
  return ok(res, await portalService.getStationEnforcementHistory(req.params.publicId, req.meraAuth))
}

export async function attachLicense(req, res) {
  return ok(res, await portalService.attachLicense(req.body, req.meraAuth), 201)
}

export async function listLicenses(req, res) {
  return ok(res, await portalService.listLicenseRegistry(req.query, req.meraAuth))
}

export async function updateLicense(req, res) {
  return ok(
    res,
    await portalService.updateLicense({
      licenseId: req.params.licenseId,
      payload: req.body,
      actor: req.meraAuth,
    })
  )
}

export async function getExpiryAlerts(req, res) {
  return ok(res, await portalService.getLicenseExpiryAlerts(req.query, req.meraAuth))
}

export async function createStationStatusLog(req, res) {
  const data = await portalService.createStationStatusLog(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateDryStatusFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, data, 201)
}

export async function createAvailabilityReport(req, res) {
  const data = await portalService.createAvailabilityReport(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateDryStatusFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, data, 201)
}

export async function listAvailabilityReports(req, res) {
  return ok(res, await portalService.listAvailabilityReports(req.query, req.meraAuth))
}

export async function createFuelDeliveryLog(req, res) {
  const data = await portalService.createFuelDeliveryLog(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, data, 201)
}

export async function listFuelDeliveryLogs(req, res) {
  return ok(res, await portalService.listFuelDeliveryLogs(req.query, req.meraAuth))
}

export async function listHoardingWatchlist(req, res) {
  return ok(res, await listHoardingWatchlistService(req.query, req.meraAuth))
}

export async function getHoardingWatchlistDetail(req, res) {
  return ok(res, await getHoardingWatchlistDetailService(req.params.publicId, req.meraAuth))
}

export async function createFuelPriceReport(req, res) {
  return ok(res, await portalService.createFuelPriceReport(req.body, req.meraAuth), 201)
}

export async function dashboardOverview(req, res) {
  return ok(res, await portalService.getDashboardOverview(req.meraAuth))
}

export async function flaggedStations(req, res) {
  return ok(res, await portalService.getFlaggedStations(req.meraAuth))
}

export async function shortageHeatmap(req, res) {
  return ok(res, await portalService.getShortageHeatmapData(req.meraAuth))
}

export async function complaintMetrics(req, res) {
  return ok(res, await portalService.getComplaintMetrics(req.meraAuth))
}

export async function inspectionMetrics(req, res) {
  return ok(res, await portalService.getInspectionMetrics(req.meraAuth))
}

export async function sidebarStats(req, res) {
  return ok(res, await portalService.getSidebarStats(req.meraAuth))
}

export async function demandForecastSummary(req, res) {
  return ok(res, await portalService.getDemandForecastSummary(req.meraAuth))
}

export async function opsPredictions(req, res) {
  return ok(res, await portalService.getMeraOpsPredictions(req.meraAuth, req.query || {}))
}

export async function nationalOperationsDashboard(req, res) {
  return ok(
    res,
    await portalService.getNationalOperationsDashboard(req.meraAuth, {
      availabilityInterval: req.query?.availabilityInterval,
    })
  )
}

export async function topComplaintStations(req, res) {
  return ok(res, await portalService.getTopComplaintStations(req.meraAuth))
}

export async function districtShortageSummaries(req, res) {
  return ok(res, await portalService.getDistrictShortageSummaries(req.meraAuth))
}

export async function repeatedOffenders(req, res) {
  return ok(res, await portalService.getRepeatedOffenders(req.meraAuth))
}

export async function monthlyReports(req, res) {
  return ok(res, await portalService.getMonthlyRegulatoryReports(req.meraAuth))
}

export async function listUsers(req, res) {
  return ok(res, await portalService.listMeraUsers(req.meraAuth))
}

export async function createUser(req, res) {
  return ok(res, await portalService.createMeraUser(req.body, req.meraAuth), 201)
}

export async function updateUserStatus(req, res) {
  return ok(
    res,
    await portalService.updateMeraUserStatus({
      meraUserPublicId: req.params.publicId,
      accountStatus: req.body.accountStatus,
      actor: req.meraAuth,
    })
  )
}

export async function listAuditLogs(req, res) {
  return ok(res, await portalService.listMeraAuditLogs(req.query, req.meraAuth))
}

export async function listRegulatoryProfiles(req, res) {
  return ok(res, await portalService.listStationRegulatoryProfiles(req.meraAuth))
}

export async function getRegulatoryProfile(req, res) {
  return ok(res, await portalService.getStationRegulatoryProfile(req.params.publicId, req.meraAuth))
}

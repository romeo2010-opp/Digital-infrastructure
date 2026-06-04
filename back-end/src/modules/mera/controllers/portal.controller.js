import { ok } from "../../../utils/http.js"
import { publishMeraDashboardUpdate } from "../../../realtime/meraDashboardHub.js"
import * as portalService from "../services/portal.service.js"
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
import { buildMeraLegacySnapshot, loadMeraPacket } from "../services/packetRegistry.service.js"

function publishPackets(keys, source = "mera_portal_write") {
  publishMeraDashboardUpdate({ source, keys })
}

export async function snapshot(req, res) {
  return ok(res, await buildMeraLegacySnapshot(req.meraAuth))
}

export async function packet(req, res) {
  return ok(res, await loadMeraPacket(req.params.key, req.meraAuth, req.query || {}))
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
  publishPackets(["complaints", "complaintMetrics", "flags", "hoardingWatchlist", "nationalOperations"], "mera_complaint_created")
  return ok(res, data, 201)
}

export async function listComplaints(req, res) {
  return ok(res, await portalService.listComplaints(req.query, req.meraAuth))
}

export async function assignComplaint(req, res) {
  const data = await portalService.assignComplaint({
      complaintPublicId: req.params.publicId,
      officerPublicId: req.body.officerPublicId,
      actor: req.meraAuth,
    })
  publishPackets(["complaints", "notifications", "tasks"], "mera_complaint_assigned")
  return ok(res, data)
}

export async function updateComplaintStatus(req, res) {
  const data = await portalService.updateComplaintStatus({
      complaintPublicId: req.params.publicId,
      complaintStatus: req.body.complaintStatus,
      actor: req.meraAuth,
    })
  publishPackets(["complaints", "complaintMetrics", "flags", "nationalOperations"], "mera_complaint_status_updated")
  return ok(res, data)
}

export async function createInspection(req, res) {
  const payload = await portalService.createInspection(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateInspectionDrivenFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  publishPackets(["inspections", "inspectionMetrics", "flags", "hoardingWatchlist", "nationalOperations", "notifications"], "mera_inspection_created")
  return ok(res, payload, 201)
}

export async function uploadInspectionEvidence(req, res) {
  const data = await portalService.attachInspectionEvidence({
      inspectionPublicId: req.params.publicId,
      fileUrl: req.uploadedFileUrl,
      fileType: req.uploadedFileType,
      actor: req.meraAuth,
    })
  publishPackets(["inspections", "inspectionMetrics", "notifications"], "mera_inspection_evidence_uploaded")
  return ok(res, data, 201)
}

export async function listInspections(req, res) {
  return ok(res, await portalService.listInspections(req.query, req.meraAuth))
}

export async function stationInspectionHistory(req, res) {
  return ok(res, await portalService.getStationInspectionHistory(req.params.publicId, req.meraAuth))
}

export async function createFlag(req, res) {
  const data = await portalService.createManualFlag(req.body, req.meraAuth)
  publishPackets(["flags", "flaggedStations", "hoardingWatchlist", "nationalOperations"], "mera_flag_created")
  return ok(res, data, 201)
}

export async function listFlags(req, res) {
  return ok(res, await portalService.listFlags(req.query, req.meraAuth))
}

export async function resolveFlag(req, res) {
  const data = await portalService.resolveFlag({
      flagPublicId: req.params.publicId,
      resolvedStatus: req.body.resolvedStatus,
      actor: req.meraAuth,
    })
  publishPackets(["flags", "flaggedStations", "hoardingWatchlist", "nationalOperations"], "mera_flag_resolved")
  return ok(res, data)
}

export async function createEnforcementAction(req, res) {
  const data = await portalService.createEnforcementAction(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  publishPackets(["enforcementActions", "flags", "hoardingWatchlist", "nationalOperations"], "mera_enforcement_created")
  return ok(res, data, 201)
}

export async function listEnforcementActions(req, res) {
  return ok(res, await portalService.listEnforcementActions(req.query, req.meraAuth))
}

export async function stationEnforcementHistory(req, res) {
  return ok(res, await portalService.getStationEnforcementHistory(req.params.publicId, req.meraAuth))
}

export async function attachLicense(req, res) {
  const data = await portalService.attachLicense(req.body, req.meraAuth)
  publishPackets(["licenseRegistry", "expiryAlerts", "profiles"], "mera_license_attached")
  return ok(res, data, 201)
}

export async function listLicenses(req, res) {
  return ok(res, await portalService.listLicenseRegistry(req.query, req.meraAuth))
}

export async function updateLicense(req, res) {
  const data = await portalService.updateLicense({
      licenseId: req.params.licenseId,
      payload: req.body,
      actor: req.meraAuth,
    })
  publishPackets(["licenseRegistry", "expiryAlerts", "profiles"], "mera_license_updated")
  return ok(res, data)
}

export async function getExpiryAlerts(req, res) {
  return ok(res, await portalService.getLicenseExpiryAlerts(req.query, req.meraAuth))
}

export async function createStationStatusLog(req, res) {
  const data = await portalService.createStationStatusLog(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateDryStatusFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  publishPackets(["availabilityReports", "heatmap", "overview", "nationalOperations", "hoardingWatchlist", "flags"], "mera_station_status_logged")
  return ok(res, data, 201)
}

export async function createAvailabilityReport(req, res) {
  const data = await portalService.createAvailabilityReport(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await evaluateDryStatusFlags({ stationId: Number(stationProfile.station.id), actor: req.meraAuth })
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  publishPackets(["availabilityReports", "heatmap", "overview", "nationalOperations", "hoardingWatchlist", "flags"], "mera_availability_report_created")
  return ok(res, data, 201)
}

export async function listAvailabilityReports(req, res) {
  return ok(res, await portalService.listAvailabilityReports(req.query, req.meraAuth))
}

export async function createFuelDeliveryLog(req, res) {
  const data = await portalService.createFuelDeliveryLog(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  publishPackets(["fuelDeliveryLogs", "heatmap", "overview", "nationalOperations", "hoardingWatchlist"], "mera_fuel_delivery_logged")
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
  const data = await portalService.createFuelPriceReport(req.body, req.meraAuth)
  publishPackets(["priceCompliance", "flags", "flaggedStations", "nationalOperations", "reports", "monthlyReports"], "mera_fuel_price_report_created")
  return ok(res, data, 201)
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

export async function nationalConsumption(req, res) {
  return ok(res, await portalService.getNationalConsumption(req.meraAuth, req.query || {}))
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
  const data = await portalService.createMeraUser(req.body, req.meraAuth)
  publishPackets(["users", "auditLogs"], "mera_user_created")
  return ok(res, data, 201)
}

export async function updateUserStatus(req, res) {
  const data = await portalService.updateMeraUserStatus({
      meraUserPublicId: req.params.publicId,
      accountStatus: req.body.accountStatus,
      actor: req.meraAuth,
    })
  publishPackets(["users", "auditLogs"], "mera_user_status_updated")
  return ok(res, data)
}

export async function updateUserPermissions(req, res) {
  const data = await portalService.updateMeraUserPermissions({
    meraUserPublicId: req.params.publicId,
    updates: req.body,
    actor: req.meraAuth,
  })
  publishPackets(["users", "auditLogs"], "mera_user_permissions_updated")
  return ok(res, data)
}

export async function revokeUserSessions(req, res) {
  const data = await portalService.revokeMeraUserSessions({
    meraUserPublicId: req.params.publicId,
    actor: req.meraAuth,
  })
  publishPackets(["users", "auditLogs"], "mera_user_sessions_revoked")
  return ok(res, data)
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

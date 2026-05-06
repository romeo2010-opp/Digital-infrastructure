import { ok } from "../../../utils/http.js"
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
  return ok(res, await portalService.listComplaints(req.query))
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
  return ok(res, await portalService.listInspections(req.query))
}

export async function stationInspectionHistory(req, res) {
  return ok(res, await portalService.getStationInspectionHistory(req.params.publicId))
}

export async function createFlag(req, res) {
  return ok(res, await portalService.createManualFlag(req.body, req.meraAuth), 201)
}

export async function listFlags(req, res) {
  return ok(res, await portalService.listFlags(req.query))
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
  return ok(res, await portalService.listEnforcementActions(req.query))
}

export async function stationEnforcementHistory(req, res) {
  return ok(res, await portalService.getStationEnforcementHistory(req.params.publicId))
}

export async function attachLicense(req, res) {
  return ok(res, await portalService.attachLicense(req.body, req.meraAuth), 201)
}

export async function listLicenses(req, res) {
  return ok(res, await portalService.listLicenseRegistry(req.query))
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
  return ok(res, await portalService.getLicenseExpiryAlerts(req.query))
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
  return ok(res, await portalService.listAvailabilityReports(req.query))
}

export async function createFuelDeliveryLog(req, res) {
  const data = await portalService.createFuelDeliveryLog(req.body, req.meraAuth)
  const stationProfile = await portalService.getStationRegulatoryProfile(req.body.stationPublicId)
  await calculateStationHoardingRisk(Number(stationProfile.station.id), { actor: req.meraAuth })
  return ok(res, data, 201)
}

export async function listFuelDeliveryLogs(req, res) {
  return ok(res, await portalService.listFuelDeliveryLogs(req.query))
}

export async function listHoardingWatchlist(req, res) {
  return ok(res, await listHoardingWatchlistService(req.query))
}

export async function getHoardingWatchlistDetail(req, res) {
  return ok(res, await getHoardingWatchlistDetailService(req.params.publicId))
}

export async function createFuelPriceReport(req, res) {
  return ok(res, await portalService.createFuelPriceReport(req.body, req.meraAuth), 201)
}

export async function dashboardOverview(req, res) {
  return ok(res, await portalService.getDashboardOverview())
}

export async function flaggedStations(req, res) {
  return ok(res, await portalService.getFlaggedStations())
}

export async function shortageHeatmap(req, res) {
  return ok(res, await portalService.getShortageHeatmapData())
}

export async function complaintMetrics(req, res) {
  return ok(res, await portalService.getComplaintMetrics())
}

export async function inspectionMetrics(req, res) {
  return ok(res, await portalService.getInspectionMetrics())
}

export async function sidebarStats(req, res) {
  return ok(res, await portalService.getSidebarStats())
}

export async function topComplaintStations(req, res) {
  return ok(res, await portalService.getTopComplaintStations())
}

export async function districtShortageSummaries(req, res) {
  return ok(res, await portalService.getDistrictShortageSummaries())
}

export async function repeatedOffenders(req, res) {
  return ok(res, await portalService.getRepeatedOffenders())
}

export async function monthlyReports(req, res) {
  return ok(res, await portalService.getMonthlyRegulatoryReports())
}

export async function listUsers(req, res) {
  return ok(res, await portalService.listMeraUsers())
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
  return ok(res, await portalService.listMeraAuditLogs(req.query))
}

export async function listRegulatoryProfiles(req, res) {
  return ok(res, await portalService.listStationRegulatoryProfiles())
}

export async function getRegulatoryProfile(req, res) {
  return ok(res, await portalService.getStationRegulatoryProfile(req.params.publicId))
}

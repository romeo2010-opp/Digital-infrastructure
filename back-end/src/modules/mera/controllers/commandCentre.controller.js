import { ok } from "../../../utils/http.js"
import { publishMeraDashboardUpdate } from "../../../realtime/meraDashboardHub.js"
import * as commandService from "../services/commandCentre.service.js"

function publishPackets(keys, source = "mera_command_write") {
  publishMeraDashboardUpdate({ source, keys })
}

export async function riskSummary(req, res) {
  return ok(res, await commandService.getRiskSummary(req.meraAuth))
}

export async function riskStations(req, res) {
  return ok(res, await commandService.listRiskStations(req.query, req.meraAuth))
}

export async function riskStation(req, res) {
  return ok(res, await commandService.getRiskStation(req.params.stationId, req.meraAuth))
}

export async function recalculateRisk(req, res) {
  const data = await commandService.recalculateRisk(req.meraAuth)
  publishPackets(["hoardingWatchlist", "flags", "flaggedStations", "nationalOperations", "analytics"], "mera_risk_recalculated")
  return ok(res, data)
}

export async function riskWatchlist(req, res) {
  return ok(res, await commandService.getRiskWatchlist(req.query, req.meraAuth))
}

export async function listAlerts(req, res) {
  return ok(res, await commandService.listAlerts(req.query, req.meraAuth))
}

export async function getAlert(req, res) {
  const alerts = await commandService.listAlerts({ limit: 100 }, req.meraAuth)
  return ok(res, alerts.items.find((item) => item.id === req.params.id || item.sourceKey === req.params.id) || null)
}

export async function acknowledgeAlert(req, res) {
  const data = await commandService.acknowledgeAlert(req.params.id, req.meraAuth)
  publishPackets(["hoardingWatchlist", "flags", "notifications", "nationalOperations"], "mera_alert_acknowledged")
  return ok(res, data)
}

export async function dismissAlert(req, res) {
  const data = await commandService.dismissAlert(req.params.id, req.body, req.meraAuth)
  publishPackets(["hoardingWatchlist", "flags", "notifications", "nationalOperations"], "mera_alert_dismissed")
  return ok(res, data)
}

export async function openCaseFromAlert(req, res) {
  const data = await commandService.openCaseFromAlert(req.params.id, req.meraAuth)
  publishPackets(["flags", "hoardingWatchlist", "tasks", "notifications", "nationalOperations"], "mera_case_opened_from_alert")
  return ok(res, data, 201)
}

export async function assignInspectionFromAlert(req, res) {
  const data = await commandService.assignInspectionFromAlert(req.params.id, req.body, req.meraAuth)
  publishPackets(["inspections", "inspectionMetrics", "tasks", "notifications", "nationalOperations"], "mera_inspection_assigned_from_alert")
  return ok(res, data, 201)
}

export async function listCases(req, res) {
  return ok(res, await commandService.listCases(req.query, req.meraAuth))
}

export async function createCase(req, res) {
  const data = await commandService.createCase(req.body, req.meraAuth)
  publishPackets(["flags", "tasks", "notifications", "nationalOperations"], "mera_case_created")
  return ok(res, data, 201)
}

export async function patchCase(req, res) {
  const data = await commandService.patchCase(req.params.caseId, req.body, req.meraAuth)
  publishPackets(["flags", "tasks", "notifications", "nationalOperations"], "mera_case_updated")
  return ok(res, data)
}

export async function addCaseNote(req, res) {
  const data = await commandService.addCaseNote(req.params.caseId, req.body, req.meraAuth)
  publishPackets(["flags", "auditLogs"], "mera_case_note_added")
  return ok(res, data, 201)
}

export async function addCaseEvidence(req, res) {
  const data = await commandService.addCaseEvidence(req.params.caseId, req.body, req.meraAuth)
  publishPackets(["flags", "auditLogs"], "mera_case_evidence_added")
  return ok(res, data, 201)
}

export async function escalateCase(req, res) {
  const data = await commandService.escalateCase(req.params.caseId, req.body, req.meraAuth)
  publishPackets(["flags", "tasks", "notifications", "nationalOperations"], "mera_case_escalated")
  return ok(res, data)
}

export async function closeCase(req, res) {
  const data = await commandService.closeCase(req.params.caseId, req.body, req.meraAuth)
  publishPackets(["flags", "tasks", "notifications", "nationalOperations"], "mera_case_closed")
  return ok(res, data)
}

export async function exportCaseEvidencePack(req, res) {
  return ok(res, await commandService.exportCaseEvidencePack(req.params.caseId, req.meraAuth))
}

export async function getInspection(req, res) {
  return ok(res, await commandService.getInspection(req.params.id, req.meraAuth))
}

export async function patchInspection(req, res) {
  const data = await commandService.patchInspection(req.params.id, req.body, req.meraAuth)
  publishPackets(["inspections", "inspectionMetrics", "tasks", "notifications", "nationalOperations"], "mera_inspection_updated")
  return ok(res, data)
}

export async function completeInspection(req, res) {
  const data = await commandService.completeInspection(req.params.id, req.body, req.meraAuth)
  publishPackets(["inspections", "inspectionMetrics", "flags", "hoardingWatchlist", "nationalOperations"], "mera_inspection_completed")
  return ok(res, data)
}

export async function recommendedInspections(req, res) {
  return ok(res, await commandService.recommendedInspections(req.query, req.meraAuth))
}

export async function complaintClusters(req, res) {
  return ok(res, await commandService.listComplaintClusters(req.query, req.meraAuth))
}

export async function complaintTrends(req, res) {
  return ok(res, await commandService.getComplaintTrends(req.query, req.meraAuth))
}

export async function linkComplaintCase(req, res) {
  return ok(res, await commandService.linkComplaintToCase(req.params.publicId, req.body, req.meraAuth))
}

export async function fuelSupplyDeliveries(req, res) {
  return ok(res, await commandService.listFuelSupplyDeliveries(req.query, req.meraAuth))
}

export async function fuelSupplyTimeline(req, res) {
  return ok(res, await commandService.getFuelSupplyTimeline(req.query, req.meraAuth))
}

export async function stationFuelSupply(req, res) {
  return ok(res, await commandService.getStationFuelSupply(req.params.stationId, req.meraAuth))
}

export async function createFuelSupplyDelivery(req, res) {
  const data = await commandService.createFuelSupplyDelivery(req.body, req.meraAuth)
  publishPackets(["fuelDeliveryLogs", "nationalOperations", "heatmap", "overview"], "mera_fuel_supply_delivery_created")
  return ok(res, data, 201)
}

export async function patchFuelSupplyDelivery(req, res) {
  const data = await commandService.patchFuelSupplyDelivery(req.params.id, req.body, req.meraAuth)
  publishPackets(["fuelDeliveryLogs", "nationalOperations", "heatmap", "overview"], "mera_fuel_supply_delivery_updated")
  return ok(res, data)
}

export async function officialPrices(req, res) {
  return ok(res, await commandService.listOfficialPrices(req.query))
}

export async function createOfficialPrice(req, res) {
  const data = await commandService.createOfficialPrice(req.body, req.meraAuth)
  publishPackets(["priceCompliance", "reports", "nationalOperations"], "mera_official_price_created")
  return ok(res, data, 201)
}

export async function priceCompliance(req, res) {
  return ok(res, await commandService.listPriceCompliance(req.query, req.meraAuth))
}

export async function priceViolations(req, res) {
  return ok(res, await commandService.listPriceViolations(req.query, req.meraAuth))
}

export async function reportTypes(req, res) {
  return ok(res, await commandService.listReportTypes())
}

export async function generateReport(req, res) {
  const data = await commandService.generateReport(req.body, req.meraAuth)
  publishPackets(["reports", "monthlyReports"], "mera_report_generated")
  return ok(res, data, 201)
}

export async function listReports(req, res) {
  return ok(res, await commandService.listReports(req.query, req.meraAuth))
}

export async function getReport(req, res) {
  return ok(res, await commandService.getReport(req.params.id, req.meraAuth))
}

export async function downloadReport(req, res) {
  return ok(res, await commandService.downloadReport(req.params.id, req.meraAuth))
}

export async function listPublicNotices(req, res) {
  return ok(res, await commandService.listPublicNotices(req.query, req.meraAuth))
}

export async function createPublicNotice(req, res) {
  const data = await commandService.createPublicNotice(req.body, req.meraAuth)
  publishPackets(["publicNotices", "auditLogs"], "mera_public_notice_created")
  return ok(res, data, 201)
}

export async function patchPublicNotice(req, res) {
  const data = await commandService.patchPublicNotice(req.params.id, req.body, req.meraAuth)
  publishPackets(["publicNotices", "auditLogs"], "mera_public_notice_updated")
  return ok(res, data)
}

export async function submitPublicNotice(req, res) {
  const data = await commandService.submitPublicNotice(req.params.id, req.meraAuth)
  publishPackets(["publicNotices", "notifications", "auditLogs"], "mera_public_notice_submitted")
  return ok(res, data)
}

export async function approvePublicNotice(req, res) {
  const data = await commandService.approvePublicNotice(req.params.id, req.body, req.meraAuth)
  publishPackets(["publicNotices", "notifications", "auditLogs"], "mera_public_notice_approved")
  return ok(res, data)
}

export async function rejectPublicNotice(req, res) {
  const data = await commandService.rejectPublicNotice(req.params.id, req.body, req.meraAuth)
  publishPackets(["publicNotices", "notifications", "auditLogs"], "mera_public_notice_rejected")
  return ok(res, data)
}

export async function publishPublicNotice(req, res) {
  const data = await commandService.publishPublicNotice(req.params.id, req.meraAuth)
  publishPackets(["publicNotices", "notifications", "auditLogs"], "mera_public_notice_published")
  return ok(res, data)
}

export async function publicNoticeHistory(req, res) {
  return ok(res, await commandService.listPublicNoticeHistory(req.params.id, req.meraAuth))
}

export async function fuelStressAnalytics(req, res) {
  return ok(res, await commandService.getFuelStressAnalytics(req.meraAuth))
}

export async function districtAnalytics(req, res) {
  return ok(res, await commandService.getDistrictAnalytics(req.meraAuth))
}

export async function stationAnalytics(req, res) {
  return ok(res, await commandService.getStationAnalytics(req.meraAuth))
}

export async function trendAnalytics(req, res) {
  return ok(res, await commandService.getTrendAnalytics(req.meraAuth))
}

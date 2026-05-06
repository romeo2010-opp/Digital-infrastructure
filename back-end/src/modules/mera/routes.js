import { Router } from "express"
import rateLimit from "express-rate-limit"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireMeraAuth, requireMeraRole } from "./middleware/auth.js"
import {
  buildUploadedFileUrl,
  complaintMediaUpload,
  inferUploadedFileType,
  inspectionEvidenceUpload,
} from "./middleware/upload.js"
import * as authController from "./controllers/auth.controller.js"
import * as portalController from "./controllers/portal.controller.js"
import {
  complaintAssignSchema,
  complaintListQuerySchema,
  complaintStatusSchema,
  createComplaintSchema,
  enforcementCreateSchema,
  enforcementListQuerySchema,
  expiryAlertQuerySchema,
  flagCreateSchema,
  flagListQuerySchema,
  flagResolveSchema,
  fuelDeliveryListQuerySchema,
  fuelDeliveryLogSchema,
  fuelPriceReportSchema,
  availabilityReportCreateSchema,
  availabilityReportListQuerySchema,
  hoardingWatchlistQuerySchema,
  inspectionCreateSchema,
  inspectionListQuerySchema,
  licenseCreateSchema,
  licenseIdParamSchema,
  licenseListQuerySchema,
  licenseUpdateSchema,
  meraLoginSchema,
  meraUserCreateSchema,
  meraUserStatusSchema,
  paginationQuerySchema,
  publicIdParamSchema,
  publicStationsQuerySchema,
  stationStatusLogSchema,
  verifyRoleQuerySchema,
} from "./schemas.js"

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many MERA login attempts. Try again later.",
  },
})

function rememberUploadedFile(req, _res, next) {
  req.uploadedFileUrl = buildUploadedFileUrl(req.file)
  req.uploadedFileType = inferUploadedFileType(req.file)
  next()
}

export const meraPublicRouter = Router()
export const meraProtectedRouter = Router()

meraPublicRouter.get(
  "/api/mera/public/stations",
  asyncHandler(async (req, res) => {
    req.query = publicStationsQuerySchema.parse(req.query || {})
    return portalController.listPublicStations(req, res)
  })
)

meraPublicRouter.post(
  "/api/mera/auth/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    req.body = meraLoginSchema.parse(req.body || {})
    return authController.login(req, res)
  })
)

meraPublicRouter.post(
  "/api/mera/complaints",
  complaintMediaUpload,
  rememberUploadedFile,
  asyncHandler(async (req, res) => {
    req.body = createComplaintSchema.parse(req.body || {})
    return portalController.createComplaint(req, res)
  })
)

meraProtectedRouter.use(requireMeraAuth)

meraProtectedRouter.get("/auth/me", asyncHandler(authController.me))
meraProtectedRouter.post("/auth/logout", asyncHandler(authController.logout))
meraProtectedRouter.get(
  "/auth/verify-role",
  asyncHandler(async (req, res) => {
    req.query = verifyRoleQuerySchema.parse(req.query || {})
    return authController.verifyRole(req, res)
  })
)

meraProtectedRouter.get("/dashboard/overview", asyncHandler(portalController.dashboardOverview))
meraProtectedRouter.get("/dashboard/flagged-stations", asyncHandler(portalController.flaggedStations))
meraProtectedRouter.get("/dashboard/shortage-heatmap", asyncHandler(portalController.shortageHeatmap))
meraProtectedRouter.get("/dashboard/complaint-metrics", asyncHandler(portalController.complaintMetrics))
meraProtectedRouter.get("/dashboard/inspection-metrics", asyncHandler(portalController.inspectionMetrics))
meraProtectedRouter.get("/dashboard/sidebar-stats", asyncHandler(portalController.sidebarStats))

meraProtectedRouter.get(
  "/hoarding-watchlist",
  asyncHandler(async (req, res) => {
    req.query = hoardingWatchlistQuerySchema.parse(req.query || {})
    return portalController.listHoardingWatchlist(req, res)
  })
)
meraProtectedRouter.get(
  "/hoarding-watchlist/:publicId",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.getHoardingWatchlistDetail(req, res)
  })
)

meraProtectedRouter.get(
  "/complaints",
  asyncHandler(async (req, res) => {
    req.query = complaintListQuerySchema.parse(req.query || {})
    return portalController.listComplaints(req, res)
  })
)
meraProtectedRouter.patch(
  "/complaints/:publicId/assign",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = complaintAssignSchema.parse(req.body || {})
    return portalController.assignComplaint(req, res)
  })
)
meraProtectedRouter.patch(
  "/complaints/:publicId/status",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = complaintStatusSchema.parse(req.body || {})
    return portalController.updateComplaintStatus(req, res)
  })
)

meraProtectedRouter.post(
  "/inspections",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER"]),
  asyncHandler(async (req, res) => {
    req.body = inspectionCreateSchema.parse(req.body || {})
    return portalController.createInspection(req, res)
  })
)
meraProtectedRouter.post(
  "/inspections/:publicId/evidence",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER"]),
  inspectionEvidenceUpload,
  rememberUploadedFile,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.uploadInspectionEvidence(req, res)
  })
)
meraProtectedRouter.get(
  "/inspections",
  asyncHandler(async (req, res) => {
    req.query = inspectionListQuerySchema.parse(req.query || {})
    return portalController.listInspections(req, res)
  })
)
meraProtectedRouter.get(
  "/stations/:publicId/inspections",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.stationInspectionHistory(req, res)
  })
)

meraProtectedRouter.post(
  "/flags",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "PUBLIC_COMPLAINT_ANALYST", "MARKET_ANALYST"]),
  asyncHandler(async (req, res) => {
    req.body = flagCreateSchema.parse(req.body || {})
    return portalController.createFlag(req, res)
  })
)
meraProtectedRouter.get(
  "/flags",
  asyncHandler(async (req, res) => {
    req.query = flagListQuerySchema.parse(req.query || {})
    return portalController.listFlags(req, res)
  })
)
meraProtectedRouter.patch(
  "/flags/:publicId/resolve",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "LEGAL_ENFORCEMENT"]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = flagResolveSchema.parse(req.body || {})
    return portalController.resolveFlag(req, res)
  })
)

meraProtectedRouter.post(
  "/enforcement-actions",
  requireMeraRole(["SUPER_ADMIN", "LEGAL_ENFORCEMENT"]),
  asyncHandler(async (req, res) => {
    req.body = enforcementCreateSchema.parse(req.body || {})
    return portalController.createEnforcementAction(req, res)
  })
)
meraProtectedRouter.get(
  "/enforcement-actions",
  asyncHandler(async (req, res) => {
    req.query = enforcementListQuerySchema.parse(req.query || {})
    return portalController.listEnforcementActions(req, res)
  })
)
meraProtectedRouter.get(
  "/stations/:publicId/enforcement-actions",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.stationEnforcementHistory(req, res)
  })
)

meraProtectedRouter.post(
  "/licenses",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "LEGAL_ENFORCEMENT"]),
  asyncHandler(async (req, res) => {
    req.body = licenseCreateSchema.parse(req.body || {})
    return portalController.attachLicense(req, res)
  })
)
meraProtectedRouter.get(
  "/licenses",
  asyncHandler(async (req, res) => {
    req.query = licenseListQuerySchema.parse(req.query || {})
    return portalController.listLicenses(req, res)
  })
)
meraProtectedRouter.patch(
  "/licenses/:licenseId",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "LEGAL_ENFORCEMENT"]),
  asyncHandler(async (req, res) => {
    req.params = licenseIdParamSchema.parse(req.params || {})
    req.body = licenseUpdateSchema.parse(req.body || {})
    return portalController.updateLicense(req, res)
  })
)
meraProtectedRouter.get(
  "/licenses/expiry-alerts",
  asyncHandler(async (req, res) => {
    req.query = expiryAlertQuerySchema.parse(req.query || {})
    return portalController.getExpiryAlerts(req, res)
  })
)

meraProtectedRouter.post(
  "/station-status-logs",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "MARKET_ANALYST"]),
  asyncHandler(async (req, res) => {
    req.body = stationStatusLogSchema.parse(req.body || {})
    return portalController.createStationStatusLog(req, res)
  })
)
meraProtectedRouter.post(
  "/fuel-delivery-logs",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "MARKET_ANALYST"]),
  asyncHandler(async (req, res) => {
    req.body = fuelDeliveryLogSchema.parse(req.body || {})
    return portalController.createFuelDeliveryLog(req, res)
  })
)
meraProtectedRouter.get(
  "/fuel-delivery-logs",
  asyncHandler(async (req, res) => {
    req.query = fuelDeliveryListQuerySchema.parse(req.query || {})
    return portalController.listFuelDeliveryLogs(req, res)
  })
)

meraProtectedRouter.post(
  "/availability-reports",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "MARKET_ANALYST"]),
  asyncHandler(async (req, res) => {
    req.body = availabilityReportCreateSchema.parse(req.body || {})
    return portalController.createAvailabilityReport(req, res)
  })
)
meraProtectedRouter.get(
  "/availability-reports",
  asyncHandler(async (req, res) => {
    req.query = availabilityReportListQuerySchema.parse(req.query || {})
    return portalController.listAvailabilityReports(req, res)
  })
)

meraProtectedRouter.post(
  "/fuel-price-reports",
  requireMeraRole(["SUPER_ADMIN", "COMPLIANCE_OFFICER", "MARKET_ANALYST"]),
  asyncHandler(async (req, res) => {
    req.body = fuelPriceReportSchema.parse(req.body || {})
    return portalController.createFuelPriceReport(req, res)
  })
)

meraProtectedRouter.get("/analytics/top-complaint-stations", asyncHandler(portalController.topComplaintStations))
meraProtectedRouter.get(
  "/analytics/district-shortage-summaries",
  asyncHandler(portalController.districtShortageSummaries)
)
meraProtectedRouter.get("/analytics/repeated-offenders", asyncHandler(portalController.repeatedOffenders))
meraProtectedRouter.get("/analytics/monthly-reports", asyncHandler(portalController.monthlyReports))

meraProtectedRouter.get("/stations/regulatory-profiles", asyncHandler(portalController.listRegulatoryProfiles))
meraProtectedRouter.get(
  "/stations/:publicId/regulatory-profile",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.getRegulatoryProfile(req, res)
  })
)

meraProtectedRouter.get("/users", asyncHandler(portalController.listUsers))
meraProtectedRouter.post(
  "/users",
  requireMeraRole(["SUPER_ADMIN"]),
  asyncHandler(async (req, res) => {
    req.body = meraUserCreateSchema.parse(req.body || {})
    return portalController.createUser(req, res)
  })
)
meraProtectedRouter.patch(
  "/users/:publicId/status",
  requireMeraRole(["SUPER_ADMIN"]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = meraUserStatusSchema.parse(req.body || {})
    return portalController.updateUserStatus(req, res)
  })
)

meraProtectedRouter.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    req.query = paginationQuerySchema.parse(req.query || {})
    return portalController.listAuditLogs(req, res)
  })
)

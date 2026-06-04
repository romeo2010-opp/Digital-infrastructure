import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireDistrictScope, requireMeraAuth, requireMeraPermission } from "./middleware/auth.js"
import {
  buildUploadedFileUrl,
  complaintMediaUpload,
  inferUploadedFileType,
  inspectionEvidenceUpload,
} from "./middleware/upload.js"
import * as authController from "./controllers/auth.controller.js"
import * as commandCentreController from "./controllers/commandCentre.controller.js"
import * as portalController from "./controllers/portal.controller.js"
import * as searchController from "./controllers/search.controller.js"
import * as taskController from "./controllers/task.controller.js"
import {
  caseIdParamSchema,
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
  fullSearchQuerySchema,
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
  meraChangePasswordSchema,
  meraLoginCodeResendSchema,
  meraLoginCodeVerifySchema,
  meraLoginSchema,
  meraPreferencesPatchSchema,
  meraProfilePatchSchema,
  meraUserCreateSchema,
  meraUserPermissionPatchSchema,
  meraUserStatusSchema,
  paginationQuerySchema,
  publicIdParamSchema,
  publicStationsQuerySchema,
  searchQuerySchema,
  stationStatusLogSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskEscalateSchema,
  taskEvidenceSchema,
  taskListQuerySchema,
  taskNoteSchema,
  taskNumberParamSchema,
  taskStatusSchema,
  taskUpdateSchema,
  verifyRoleQuerySchema,
} from "./schemas.js"
import { MERA_PERMISSIONS } from "./permissions.js"

function rememberUploadedFile(req, _res, next) {
  req.uploadedFileUrl = buildUploadedFileUrl(req.file, req)
  req.uploadedFileType = inferUploadedFileType(req.file)
  next()
}

function requireComplaintStatusPermission(req, res, next) {
  const status = String(req.body?.complaintStatus || "").trim().toUpperCase()
  const permission =
    status === "ESCALATED"
      ? MERA_PERMISSIONS.COMPLAINTS_ESCALATE
      : ["RESOLVED", "REJECTED", "DISMISSED", "CLOSED"].includes(status)
        ? MERA_PERMISSIONS.COMPLAINTS_CLOSE
        : MERA_PERMISSIONS.COMPLAINTS_TRIAGE

  return requireMeraPermission(permission)(req, res, next)
}

function requireInspectionWritePermission(req, res, next) {
  const requestedOfficer = String(req.body?.officerPublicId || "").trim()
  const actorPublicId = String(req.meraAuth?.userPublicId || "").trim()
  const permission =
    requestedOfficer && requestedOfficer !== actorPublicId
      ? MERA_PERMISSIONS.INSPECTIONS_ASSIGN
      : MERA_PERMISSIONS.INSPECTIONS_CREATE

  return requireMeraPermission(permission)(req, res, next)
}

function requireEnforcementCreatePermission(req, res, next) {
  const actionType = String(req.body?.actionType || "").trim().toUpperCase()
  const permission =
    actionType === "FINE"
      ? MERA_PERMISSIONS.ENFORCEMENT_CREATE_FINE
      : actionType === "SUSPENSION"
        ? MERA_PERMISSIONS.ENFORCEMENT_CREATE_SUSPENSION
        : MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING

  return requireMeraPermission(permission)(req, res, next)
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
  asyncHandler(async (req, res) => {
    req.body = meraLoginSchema.parse(req.body || {})
    return authController.login(req, res)
  })
)

meraPublicRouter.post(
  "/api/mera/auth/login/verify",
  asyncHandler(async (req, res) => {
    req.body = meraLoginCodeVerifySchema.parse(req.body || {})
    return authController.verifyLoginCode(req, res)
  })
)

meraPublicRouter.post(
  "/api/mera/auth/login/resend",
  asyncHandler(async (req, res) => {
    req.body = meraLoginCodeResendSchema.parse(req.body || {})
    return authController.resendLoginCode(req, res)
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
meraProtectedRouter.patch(
  "/auth/me",
  asyncHandler(async (req, res) => {
    req.body = meraProfilePatchSchema.parse(req.body || {})
    return authController.patchMe(req, res)
  })
)
meraProtectedRouter.post("/auth/logout", asyncHandler(authController.logout))
meraProtectedRouter.patch(
  "/auth/password",
  asyncHandler(async (req, res) => {
    req.body = meraChangePasswordSchema.parse(req.body || {})
    return authController.changePassword(req, res)
  })
)
meraProtectedRouter.get("/auth/preferences", asyncHandler(authController.getMyPreferences))
meraProtectedRouter.patch(
  "/auth/preferences",
  asyncHandler(async (req, res) => {
    req.body = meraPreferencesPatchSchema.parse(req.body || {})
    return authController.patchMyPreferences(req, res)
  })
)
meraProtectedRouter.get("/auth/sessions", asyncHandler(authController.listSessions))
meraProtectedRouter.post("/auth/sessions/revoke-others", asyncHandler(authController.revokeOtherSessions))
meraProtectedRouter.post(
  "/auth/sessions/:publicId/revoke",
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return authController.revokeSession(req, res)
  })
)
meraProtectedRouter.get(
  "/auth/verify-role",
  asyncHandler(async (req, res) => {
    req.query = verifyRoleQuerySchema.parse(req.query || {})
    return authController.verifyRole(req, res)
  })
)

meraProtectedRouter.get("/snapshot", asyncHandler(portalController.snapshot))
meraProtectedRouter.get(
  "/packets/:key",
  asyncHandler(portalController.packet)
)

meraProtectedRouter.get(
  "/search/suggestions",
  asyncHandler(async (req, res) => {
    req.query = searchQuerySchema.parse(req.query || {})
    return searchController.suggestions(req, res)
  })
)
meraProtectedRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    req.query = searchQuerySchema.parse(req.query || {})
    return searchController.quickSearch(req, res)
  })
)
meraProtectedRouter.get(
  "/search/full",
  asyncHandler(async (req, res) => {
    req.query = fullSearchQuerySchema.parse(req.query || {})
    return searchController.fullSearch(req, res)
  })
)
meraProtectedRouter.get(
  "/station-managers/:publicId",
  requireMeraPermission([MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return searchController.getStationManagerDetail(req, res)
  })
)
meraProtectedRouter.get(
  "/cases/:caseId",
  requireMeraPermission([MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.ENFORCEMENT_VIEW, MERA_PERMISSIONS.MANAGE_CASES]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return searchController.getCaseDetail(req, res)
  })
)
meraProtectedRouter.get(
  "/cases",
  requireMeraPermission([MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.ENFORCEMENT_VIEW, MERA_PERMISSIONS.MANAGE_CASES]),
  requireDistrictScope,
  asyncHandler(commandCentreController.listCases)
)
meraProtectedRouter.post(
  "/cases",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_CREATE, MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING]),
  requireDistrictScope,
  asyncHandler(commandCentreController.createCase)
)
meraProtectedRouter.patch(
  "/cases/:caseId",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_RESOLVE, MERA_PERMISSIONS.ENFORCEMENT_UPDATE_STATUS]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.patchCase(req, res)
  })
)
meraProtectedRouter.post(
  "/cases/:caseId/notes",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.ENFORCEMENT_VIEW]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.addCaseNote(req, res)
  })
)
meraProtectedRouter.post(
  "/cases/:caseId/evidence",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.EVIDENCE_UPLOAD]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.addCaseEvidence(req, res)
  })
)
meraProtectedRouter.post(
  "/cases/:caseId/escalate",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_ESCALATE, MERA_PERMISSIONS.ENFORCEMENT_UPDATE_STATUS]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.escalateCase(req, res)
  })
)
meraProtectedRouter.post(
  "/cases/:caseId/close",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.ENFORCEMENT_UPDATE_STATUS]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.closeCase(req, res)
  })
)
meraProtectedRouter.get(
  "/cases/:caseId/evidence-pack",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.REPORTS_EXPORT, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = caseIdParamSchema.parse(req.params || {})
    return commandCentreController.exportCaseEvidencePack(req, res)
  })
)
meraProtectedRouter.get(
  "/documents/task-evidence/:evidenceId",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => searchController.getTaskEvidenceDetail(req, res))
)
meraProtectedRouter.get(
  "/documents/complaint-media/:publicId",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return searchController.getComplaintMediaDetail(req, res)
  })
)

meraProtectedRouter.get(
  "/tasks/stats/overview",
  requireMeraPermission([
    MERA_PERMISSIONS.TASKS_STATS_VIEW,
    MERA_PERMISSIONS.TASKS_VIEW_ALL,
    MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
    MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
  ]),
  requireDistrictScope,
  asyncHandler(taskController.taskStatsOverview)
)
meraProtectedRouter.get(
  "/tasks/my",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = taskListQuerySchema.parse(req.query || {})
    return taskController.listMyTasks(req, res)
  })
)
meraProtectedRouter.get(
  "/tasks",
  requireMeraPermission([
    MERA_PERMISSIONS.TASKS_VIEW_ALL,
    MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
    MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
  ]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = taskListQuerySchema.parse(req.query || {})
    return taskController.listTasks(req, res)
  })
)
meraProtectedRouter.post(
  "/tasks",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_MANAGE]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.body = taskCreateSchema.parse(req.body || {})
    return taskController.createTask(req, res)
  })
)
meraProtectedRouter.get(
  "/tasks/:taskNumber",
  requireMeraPermission([
    MERA_PERMISSIONS.TASKS_VIEW_ALL,
    MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
    MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
    MERA_PERMISSIONS.TASKS_WORK,
  ]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    return taskController.getTask(req, res)
  })
)
meraProtectedRouter.patch(
  "/tasks/:taskNumber",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskUpdateSchema.parse(req.body || {})
    return taskController.updateTask(req, res)
  })
)
meraProtectedRouter.patch(
  "/tasks/:taskNumber/status",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskStatusSchema.parse(req.body || {})
    return taskController.changeTaskStatus(req, res)
  })
)
meraProtectedRouter.post(
  "/tasks/:taskNumber/notes",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskNoteSchema.parse(req.body || {})
    return taskController.addTaskNote(req, res)
  })
)
meraProtectedRouter.post(
  "/tasks/:taskNumber/evidence",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_ADD_EVIDENCE, MERA_PERMISSIONS.TASKS_MANAGE]),
  requireDistrictScope,
  inspectionEvidenceUpload,
  rememberUploadedFile,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskEvidenceSchema.parse(req.body || {})
    return taskController.addTaskEvidence(req, res)
  })
)
meraProtectedRouter.post(
  "/tasks/:taskNumber/escalate",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskEscalateSchema.parse(req.body || {})
    return taskController.escalateTask(req, res)
  })
)
meraProtectedRouter.post(
  "/tasks/:taskNumber/complete",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_WORK]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = taskNumberParamSchema.parse(req.params || {})
    req.body = taskCompleteSchema.parse(req.body || {})
    return taskController.completeTask(req, res)
  })
)
meraProtectedRouter.get(
  "/users/assignable",
  requireMeraPermission([MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_MANAGE]),
  requireDistrictScope,
  asyncHandler(taskController.listAssignableUsers)
)
meraProtectedRouter.get(
  "/notifications",
  requireMeraPermission([
    MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
    MERA_PERMISSIONS.TASKS_VIEW_ALL,
    MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
  ]),
  asyncHandler(async (req, res) => {
    req.query = paginationQuerySchema.parse(req.query || {})
    return taskController.listNotifications(req, res)
  })
)
meraProtectedRouter.patch(
  "/notifications/:publicId/read",
  requireMeraPermission([
    MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
    MERA_PERMISSIONS.TASKS_VIEW_ALL,
    MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
  ]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return taskController.markNotificationRead(req, res)
  })
)

meraProtectedRouter.get(
  "/dashboard/overview",
  requireMeraPermission([MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(portalController.dashboardOverview)
)
meraProtectedRouter.get(
  "/dashboard/flagged-stations",
  requireMeraPermission(MERA_PERMISSIONS.FLAGS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.flaggedStations)
)
meraProtectedRouter.get(
  "/dashboard/shortage-heatmap",
  requireMeraPermission(MERA_PERMISSIONS.HEATMAP_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.shortageHeatmap)
)
meraProtectedRouter.get(
  "/dashboard/complaint-metrics",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.complaintMetrics)
)
meraProtectedRouter.get(
  "/dashboard/inspection-metrics",
  requireMeraPermission(MERA_PERMISSIONS.INSPECTIONS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.inspectionMetrics)
)
meraProtectedRouter.get(
  "/dashboard/sidebar-stats",
  requireMeraPermission([MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(portalController.sidebarStats)
)
meraProtectedRouter.get(
  "/dashboard/demand-forecast",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.demandForecastSummary)
)
meraProtectedRouter.get(
  "/dashboard/ops-predictions",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.opsPredictions)
)
meraProtectedRouter.get(
  "/dashboard/national-operations",
  requireMeraPermission([MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(portalController.nationalOperationsDashboard)
)
meraProtectedRouter.get(
  "/national-consumption",
  requireMeraPermission([MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(portalController.nationalConsumption)
)

meraProtectedRouter.get(
  "/risk/summary",
  requireMeraPermission([MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(commandCentreController.riskSummary)
)
meraProtectedRouter.get(
  "/risk/watchlist",
  requireMeraPermission([MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(commandCentreController.riskWatchlist)
)
meraProtectedRouter.get(
  "/risk/stations/:stationId",
  requireMeraPermission([MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(commandCentreController.riskStation)
)
meraProtectedRouter.get(
  "/risk/stations",
  requireMeraPermission([MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(commandCentreController.riskStations)
)
meraProtectedRouter.post(
  "/risk/recalculate",
  requireMeraPermission([MERA_PERMISSIONS.RISK_RECALCULATE, MERA_PERMISSIONS.FLAGS_ESCALATE, MERA_PERMISSIONS.REPORTS_GENERATE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.recalculateRisk)
)
meraProtectedRouter.get(
  "/alerts",
  requireMeraPermission([MERA_PERMISSIONS.ALERTS_VIEW, MERA_PERMISSIONS.FLAGS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.listAlerts)
)
meraProtectedRouter.get(
  "/alerts/:id",
  requireMeraPermission([MERA_PERMISSIONS.ALERTS_VIEW, MERA_PERMISSIONS.FLAGS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.getAlert)
)
meraProtectedRouter.post(
  "/alerts/:id/acknowledge",
  requireMeraPermission([MERA_PERMISSIONS.ALERTS_MANAGE, MERA_PERMISSIONS.FLAGS_ASSIGN, MERA_PERMISSIONS.FLAGS_RESOLVE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.acknowledgeAlert)
)
meraProtectedRouter.post(
  "/alerts/:id/dismiss",
  requireMeraPermission([MERA_PERMISSIONS.ALERTS_MANAGE, MERA_PERMISSIONS.FLAGS_RESOLVE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.dismissAlert)
)
meraProtectedRouter.post(
  "/alerts/:id/open-case",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_CREATE, MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING]),
  requireDistrictScope,
  asyncHandler(commandCentreController.openCaseFromAlert)
)
meraProtectedRouter.post(
  "/alerts/:id/assign-inspection",
  requireMeraPermission([MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.INSPECTIONS_ASSIGN, MERA_PERMISSIONS.INSPECTIONS_CREATE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.assignInspectionFromAlert)
)

meraProtectedRouter.get(
  "/hoarding-watchlist",
  requireMeraPermission([MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = hoardingWatchlistQuerySchema.parse(req.query || {})
    return portalController.listHoardingWatchlist(req, res)
  })
)
meraProtectedRouter.get(
  "/hoarding-watchlist/:publicId",
  requireMeraPermission([MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.getHoardingWatchlistDetail(req, res)
  })
)

meraProtectedRouter.get(
  "/complaints",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = complaintListQuerySchema.parse(req.query || {})
    return portalController.listComplaints(req, res)
  })
)
meraProtectedRouter.get(
  "/complaints/clusters",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.complaintClusters)
)
meraProtectedRouter.get(
  "/complaints/trends",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.complaintTrends)
)
meraProtectedRouter.post(
  "/complaints/:publicId/link-case",
  requireMeraPermission([MERA_PERMISSIONS.COMPLAINTS_ESCALATE, MERA_PERMISSIONS.MANAGE_CASES, MERA_PERMISSIONS.FLAGS_CREATE]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return commandCentreController.linkComplaintCase(req, res)
  })
)
meraProtectedRouter.get(
  "/complaints/:publicId",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return searchController.getComplaintDetail(req, res)
  })
)
meraProtectedRouter.patch(
  "/complaints/:publicId/assign",
  requireMeraPermission(MERA_PERMISSIONS.COMPLAINTS_ASSIGN),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = complaintAssignSchema.parse(req.body || {})
    return portalController.assignComplaint(req, res)
  })
)
meraProtectedRouter.patch(
  "/complaints/:publicId/status",
  asyncHandler(async (req, _res, next) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = complaintStatusSchema.parse(req.body || {})
    next()
  }),
  requireDistrictScope,
  requireComplaintStatusPermission,
  asyncHandler(portalController.updateComplaintStatus)
)

meraProtectedRouter.post(
  "/inspections",
  asyncHandler(async (req, _res, next) => {
    req.body = inspectionCreateSchema.parse(req.body || {})
    next()
  }),
  requireDistrictScope,
  requireInspectionWritePermission,
  asyncHandler(portalController.createInspection)
)
meraProtectedRouter.post(
  "/inspections/:publicId/evidence",
  requireMeraPermission(MERA_PERMISSIONS.EVIDENCE_UPLOAD),
  requireDistrictScope,
  inspectionEvidenceUpload,
  rememberUploadedFile,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.uploadInspectionEvidence(req, res)
  })
)
meraProtectedRouter.get(
  "/inspections",
  requireMeraPermission(MERA_PERMISSIONS.INSPECTIONS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = inspectionListQuerySchema.parse(req.query || {})
    return portalController.listInspections(req, res)
  })
)
meraProtectedRouter.get(
  "/inspections/recommended",
  requireMeraPermission([MERA_PERMISSIONS.INSPECTIONS_VIEW, MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.INSPECTIONS_ASSIGN]),
  requireDistrictScope,
  asyncHandler(commandCentreController.recommendedInspections)
)
meraProtectedRouter.get(
  "/inspections/:id",
  requireMeraPermission(MERA_PERMISSIONS.INSPECTIONS_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.getInspection)
)
meraProtectedRouter.patch(
  "/inspections/:id",
  requireMeraPermission([MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.INSPECTIONS_ASSIGN, MERA_PERMISSIONS.INSPECTIONS_REVIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.patchInspection)
)
meraProtectedRouter.post(
  "/inspections/:id/complete",
  requireMeraPermission([MERA_PERMISSIONS.COMPLETE_INSPECTIONS, MERA_PERMISSIONS.INSPECTIONS_CREATE, MERA_PERMISSIONS.INSPECTIONS_REVIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.completeInspection)
)
meraProtectedRouter.get(
  "/stations/:publicId/inspections",
  requireMeraPermission(MERA_PERMISSIONS.INSPECTIONS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.stationInspectionHistory(req, res)
  })
)

meraProtectedRouter.post(
  "/flags",
  requireMeraPermission(MERA_PERMISSIONS.FLAGS_CREATE),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.body = flagCreateSchema.parse(req.body || {})
    return portalController.createFlag(req, res)
  })
)
meraProtectedRouter.get(
  "/flags",
  requireMeraPermission(MERA_PERMISSIONS.FLAGS_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = flagListQuerySchema.parse(req.query || {})
    return portalController.listFlags(req, res)
  })
)
meraProtectedRouter.patch(
  "/flags/:publicId/resolve",
  requireMeraPermission(MERA_PERMISSIONS.FLAGS_RESOLVE),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = flagResolveSchema.parse(req.body || {})
    return portalController.resolveFlag(req, res)
  })
)

meraProtectedRouter.post(
  "/enforcement-actions",
  asyncHandler(async (req, _res, next) => {
    req.body = enforcementCreateSchema.parse(req.body || {})
    next()
  }),
  requireDistrictScope,
  requireEnforcementCreatePermission,
  asyncHandler(portalController.createEnforcementAction)
)
meraProtectedRouter.get(
  "/enforcement-actions",
  requireMeraPermission(MERA_PERMISSIONS.ENFORCEMENT_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = enforcementListQuerySchema.parse(req.query || {})
    return portalController.listEnforcementActions(req, res)
  })
)
meraProtectedRouter.get(
  "/stations/:publicId/enforcement-actions",
  requireMeraPermission(MERA_PERMISSIONS.ENFORCEMENT_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.stationEnforcementHistory(req, res)
  })
)

meraProtectedRouter.post(
  "/licenses",
  requireMeraPermission(MERA_PERMISSIONS.LICENSES_CREATE),
  asyncHandler(async (req, res) => {
    req.body = licenseCreateSchema.parse(req.body || {})
    return portalController.attachLicense(req, res)
  })
)
meraProtectedRouter.get(
  "/licenses",
  requireMeraPermission(MERA_PERMISSIONS.LICENSES_VIEW),
  asyncHandler(async (req, res) => {
    req.query = licenseListQuerySchema.parse(req.query || {})
    return portalController.listLicenses(req, res)
  })
)
meraProtectedRouter.patch(
  "/licenses/:licenseId",
  requireMeraPermission(MERA_PERMISSIONS.LICENSES_UPDATE),
  asyncHandler(async (req, res) => {
    req.params = licenseIdParamSchema.parse(req.params || {})
    req.body = licenseUpdateSchema.parse(req.body || {})
    return portalController.updateLicense(req, res)
  })
)
meraProtectedRouter.get(
  "/licenses/expiry-alerts",
  requireMeraPermission([MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW]),
  asyncHandler(async (req, res) => {
    req.query = expiryAlertQuerySchema.parse(req.query || {})
    return portalController.getExpiryAlerts(req, res)
  })
)
meraProtectedRouter.get(
  "/licenses/:licenseId",
  requireMeraPermission(MERA_PERMISSIONS.LICENSES_VIEW),
  asyncHandler(async (req, res) => {
    req.params = licenseIdParamSchema.parse(req.params || {})
    return searchController.getLicenseDetail(req, res)
  })
)

meraProtectedRouter.post(
  "/station-status-logs",
  requireMeraPermission(MERA_PERMISSIONS.AVAILABILITY_AUDIT),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.body = stationStatusLogSchema.parse(req.body || {})
    return portalController.createStationStatusLog(req, res)
  })
)
meraProtectedRouter.post(
  "/fuel-delivery-logs",
  requireMeraPermission(MERA_PERMISSIONS.DELIVERIES_CREATE),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.body = fuelDeliveryLogSchema.parse(req.body || {})
    return portalController.createFuelDeliveryLog(req, res)
  })
)
meraProtectedRouter.get(
  "/fuel-delivery-logs",
  requireMeraPermission(MERA_PERMISSIONS.DELIVERIES_VIEW),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = fuelDeliveryListQuerySchema.parse(req.query || {})
    return portalController.listFuelDeliveryLogs(req, res)
  })
)
meraProtectedRouter.get(
  "/fuel-supply/deliveries",
  requireMeraPermission(MERA_PERMISSIONS.DELIVERIES_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.fuelSupplyDeliveries)
)
meraProtectedRouter.post(
  "/fuel-supply/deliveries",
  requireMeraPermission([MERA_PERMISSIONS.DELIVERIES_CREATE, MERA_PERMISSIONS.DELIVERIES_VERIFY]),
  requireDistrictScope,
  asyncHandler(commandCentreController.createFuelSupplyDelivery)
)
meraProtectedRouter.patch(
  "/fuel-supply/deliveries/:id",
  requireMeraPermission([MERA_PERMISSIONS.DELIVERIES_VERIFY, MERA_PERMISSIONS.DELIVERIES_CREATE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.patchFuelSupplyDelivery)
)
meraProtectedRouter.get(
  "/fuel-supply/timeline",
  requireMeraPermission(MERA_PERMISSIONS.DELIVERIES_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.fuelSupplyTimeline)
)
meraProtectedRouter.get(
  "/fuel-supply/stations/:stationId",
  requireMeraPermission(MERA_PERMISSIONS.DELIVERIES_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.stationFuelSupply)
)

meraProtectedRouter.post(
  "/availability-reports",
  requireMeraPermission(MERA_PERMISSIONS.AVAILABILITY_LOG),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.body = availabilityReportCreateSchema.parse(req.body || {})
    return portalController.createAvailabilityReport(req, res)
  })
)
meraProtectedRouter.get(
  "/availability-reports",
  requireMeraPermission([MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.query = availabilityReportListQuerySchema.parse(req.query || {})
    return portalController.listAvailabilityReports(req, res)
  })
)

meraProtectedRouter.post(
  "/fuel-price-reports",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_GENERATE),
  asyncHandler(async (req, res) => {
    req.body = fuelPriceReportSchema.parse(req.body || {})
    return portalController.createFuelPriceReport(req, res)
  })
)

meraProtectedRouter.get(
  "/prices/official",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.officialPrices)
)
meraProtectedRouter.post(
  "/prices/official",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_GENERATE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.createOfficialPrice)
)
meraProtectedRouter.get(
  "/prices/compliance",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.priceCompliance)
)
meraProtectedRouter.get(
  "/prices/violations",
  requireMeraPermission([MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.priceViolations)
)
meraProtectedRouter.get(
  "/reports/types",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  asyncHandler(commandCentreController.reportTypes)
)
meraProtectedRouter.post(
  "/reports/generate",
  requireMeraPermission([MERA_PERMISSIONS.GENERATE_REPORTS, MERA_PERMISSIONS.REPORTS_GENERATE]),
  requireDistrictScope,
  asyncHandler(commandCentreController.generateReport)
)
meraProtectedRouter.get(
  "/reports",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.listReports)
)
meraProtectedRouter.get(
  "/reports/:id/download",
  requireMeraPermission([MERA_PERMISSIONS.REPORTS_EXPORT, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.downloadReport)
)
meraProtectedRouter.get(
  "/reports/:id",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(commandCentreController.getReport)
)
meraProtectedRouter.get(
  "/public-notices",
  requireMeraPermission([MERA_PERMISSIONS.PUBLIC_NOTICES_VIEW, MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE, MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE, MERA_PERMISSIONS.PUBLISH_PUBLIC_NOTICE]),
  asyncHandler(commandCentreController.listPublicNotices)
)
meraProtectedRouter.post(
  "/public-notices",
  requireMeraPermission(MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE),
  asyncHandler(commandCentreController.createPublicNotice)
)
meraProtectedRouter.patch(
  "/public-notices/:id",
  requireMeraPermission([MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE, MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE]),
  asyncHandler(commandCentreController.patchPublicNotice)
)
meraProtectedRouter.post(
  "/public-notices/:id/submit",
  requireMeraPermission(MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE),
  asyncHandler(commandCentreController.submitPublicNotice)
)
meraProtectedRouter.post(
  "/public-notices/:id/approve",
  requireMeraPermission(MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE),
  asyncHandler(commandCentreController.approvePublicNotice)
)
meraProtectedRouter.post(
  "/public-notices/:id/reject",
  requireMeraPermission(MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE),
  asyncHandler(commandCentreController.rejectPublicNotice)
)
meraProtectedRouter.post(
  "/public-notices/:id/publish",
  requireMeraPermission(MERA_PERMISSIONS.PUBLISH_PUBLIC_NOTICE),
  asyncHandler(commandCentreController.publishPublicNotice)
)
meraProtectedRouter.get(
  "/public-notices/:id/history",
  requireMeraPermission([MERA_PERMISSIONS.PUBLIC_NOTICES_VIEW, MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE, MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE]),
  asyncHandler(commandCentreController.publicNoticeHistory)
)
meraProtectedRouter.get(
  "/analytics/fuel-stress",
  requireMeraPermission([MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.fuelStressAnalytics)
)
meraProtectedRouter.get(
  "/analytics/districts",
  requireMeraPermission([MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.districtAnalytics)
)
meraProtectedRouter.get(
  "/analytics/stations",
  requireMeraPermission([MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.stationAnalytics)
)
meraProtectedRouter.get(
  "/analytics/trends",
  requireMeraPermission([MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]),
  requireDistrictScope,
  asyncHandler(commandCentreController.trendAnalytics)
)

meraProtectedRouter.get(
  "/analytics/top-complaint-stations",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.topComplaintStations)
)
meraProtectedRouter.get(
  "/analytics/district-shortage-summaries",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.districtShortageSummaries)
)
meraProtectedRouter.get(
  "/analytics/repeated-offenders",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.repeatedOffenders)
)
meraProtectedRouter.get(
  "/analytics/monthly-reports",
  requireMeraPermission(MERA_PERMISSIONS.REPORTS_VIEW),
  requireDistrictScope,
  asyncHandler(portalController.monthlyReports)
)

meraProtectedRouter.get(
  "/stations/regulatory-profiles",
  requireMeraPermission([MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(portalController.listRegulatoryProfiles)
)
meraProtectedRouter.get(
  "/stations/:publicId/regulatory-profile",
  requireMeraPermission([MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.getRegulatoryProfile(req, res)
  })
)
meraProtectedRouter.get(
  "/stations/:publicId",
  requireMeraPermission([MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]),
  requireDistrictScope,
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return searchController.getStationDetail(req, res)
  })
)

meraProtectedRouter.get("/users", requireMeraPermission(MERA_PERMISSIONS.USERS_VIEW), asyncHandler(portalController.listUsers))
meraProtectedRouter.get(
  "/users/:publicId",
  requireMeraPermission(MERA_PERMISSIONS.USERS_VIEW),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return searchController.getUserDetail(req, res)
  })
)
meraProtectedRouter.post(
  "/users",
  requireMeraPermission(MERA_PERMISSIONS.USERS_CREATE),
  asyncHandler(async (req, res) => {
    req.body = meraUserCreateSchema.parse(req.body || {})
    return portalController.createUser(req, res)
  })
)
meraProtectedRouter.patch(
  "/users/:publicId/status",
  requireMeraPermission([MERA_PERMISSIONS.USERS_UPDATE, MERA_PERMISSIONS.USERS_DISABLE]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = meraUserStatusSchema.parse(req.body || {})
    return portalController.updateUserStatus(req, res)
  })
)
meraProtectedRouter.patch(
  "/users/:publicId/permissions",
  requireMeraPermission([MERA_PERMISSIONS.USERS_UPDATE, MERA_PERMISSIONS.MANAGE_USERS]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    req.body = meraUserPermissionPatchSchema.parse(req.body || {})
    return portalController.updateUserPermissions(req, res)
  })
)
meraProtectedRouter.post(
  "/users/:publicId/sessions/revoke",
  requireMeraPermission([MERA_PERMISSIONS.USERS_UPDATE, MERA_PERMISSIONS.USERS_DISABLE, MERA_PERMISSIONS.MANAGE_USERS]),
  asyncHandler(async (req, res) => {
    req.params = publicIdParamSchema.parse(req.params || {})
    return portalController.revokeUserSessions(req, res)
  })
)

meraProtectedRouter.get(
  "/audit-logs",
  requireMeraPermission(MERA_PERMISSIONS.AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    req.query = paginationQuerySchema.parse(req.query || {})
    return portalController.listAuditLogs(req, res)
  })
)

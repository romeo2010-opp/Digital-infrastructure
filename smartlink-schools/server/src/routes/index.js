import { Router } from "express"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import authRoutes from "./auth.routes.js"
import { getDashboard } from "../controllers/dashboardController.js"
import { listStudents, getStudent, createStudent, updateStudent, uploadStudentPhoto } from "../controllers/studentsController.js"
import {
  applyFeeStructure,
  createDiscount,
  createExpense,
  createFeeStructure,
  createPaymentPlan,
  generateInvoices,
  getBursarDashboard,
  getFeeAccount,
  getFinanceReports,
  getPaymentReceipt,
  getPaymentReceiptPdf,
  importBankTransactions,
  listArrears,
  listDiscounts,
  listExpenses,
  listFeeAccounts,
  listFeeStructures,
  listFinanceAuditLogs,
  listInvoices,
  listPaymentPlans,
  listPayments,
  listReconciliation,
  matchBankTransaction,
  recordPayment,
  reversePayment,
  syncFeeAccounts,
  transitionBankTransaction,
  transitionDiscount,
  transitionExpense,
} from "../controllers/feesController.js"
import { listAttendance, markAttendance } from "../controllers/attendanceController.js"
import { listHomework, createHomework } from "../controllers/homeworkController.js"
import { listMessages, createMessage, uploadMessageImage } from "../controllers/messagesController.js"
import { getStudentPortal, reactToAnnouncement, voteAnnouncementPoll } from "../controllers/studentPortalController.js"
import {
  createAssessment,
  deleteAssessment,
  exportAssessmentPdf,
  getAssessment,
  getAssessmentBuilderSetup,
  listAssessments,
  saveAssessmentDraft,
  topicInsights,
  transitionAssessmentStatus,
  uploadAssessmentMedia,
} from "../controllers/assessmentController.js"
import {
  applyImportTemplateMatch,
  applyTemplate,
  approveTemplate,
  archiveTemplate,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  extractImportCoverTemplate,
  getTemplate,
  getTemplateSettings,
  importTemplateCandidates,
  listTemplates,
  matchImportCoverTemplate,
  patchTemplateSettings,
  setDefaultTemplate,
  templatePreview,
  updateTemplate,
} from "../controllers/assessmentTemplateController.js"
import {
  createExamPaper,
  createBulkExamPapers,
  createExamSession,
  createTimetableEntry,
  deleteTimetableEntry,
  getExamSession,
  getReportCard,
  getReportCardPdf,
  listExamSessions,
  transitionExamPaper,
  transitionExamSession,
  updateExamSession,
} from "../controllers/examController.js"
import {
  archiveTerm,
  approveTermProgressionClass,
  closeTerm,
  createAcademicYear,
  getAcademicSessionSummary,
  getAcademicTermDetail,
  getCurrentAcademicSession,
  getProgressionPolicy,
  getProgressionPreview,
  getTermCloseChecks,
  getTermProgressionPreview,
  getTermResultView,
  listClassProgressionRules,
  moveTermToMarking,
  openTerm,
  progressAcademicYear,
  reopenTerm,
  saveClassProgressionRule,
  saveProgressionPolicy,
  startPromotion,
} from "../controllers/academicSessionController.js"
import { listDrills } from "../controllers/drillsController.js"
import {
  answerDrillQuestion,
  generateDrillsForClass,
  generateDrillForStudent,
  getDrillSession,
  getDrillHistory,
  getGuardianDrillSummary,
  getTeacherDrillInsights,
  getTodayDrill,
  submitDrill,
} from "../controllers/drillsController.js"
import {
  cancelLessonLog,
  createLessonLog,
  finalizeLessonLog,
  getAcademicCoverage,
  getClassLessonHistory,
  getClassSubjectCoverage,
  getLessonLog,
  getLessonLogSuggestionsController,
  getTeacherToday,
  listLessonLogs,
  reopenLessonLog,
  updateLessonLog,
} from "../controllers/lessonLogsController.js"
import { listForecasts } from "../controllers/forecastController.js"
import { getAiStatusController, getAiUsageSummaryController, testAiController, updateAiSettingsController } from "../controllers/aiController.js"
import { getReportPdfSettingsController, updateReportPdfSettingsController } from "../controllers/reportSettingsController.js"
import { getMyPreferences, updateMyPreferences } from "../controllers/preferencesController.js"
import { cancelTask, completeTask, createTask, dailyClosure, deleteTask, dismissNotification, escalate, executeReminderEngine, feeReminder, getDirectorMappedPage, getDirectorOverview, getDirectorPage, getTask, listTasks, markDailyClosureReviewed, notifications, patchDirectorSettings, patchPaymentPromise, patchTask, patchWhatsappSettings, paymentPromise, readNotification, recordAttendance, remind, staffAttendanceToday, teacherSelfCheckIn, unreadNotifications, whatsappSettings } from "../controllers/directorController.js"
import {
  cancelStudentWithdrawal,
  createStudentWithdrawal,
  getStudentWithdrawalStatus,
  listDirectorWithdrawals,
  listStudentWithdrawalHistory,
} from "../controllers/studentWithdrawalsController.js"
import {
  approveExtractedItem,
  approveExtractedItems,
  approveManualSyllabusEntry,
  createSyllabusTopic,
  createSyllabusUpload,
  createManualSyllabusEntry,
  deleteManualSyllabusEntry,
  deleteSyllabusUpload,
  getManualSyllabusEntry,
  getSyllabusReview,
  getSyllabusSetup,
  listManualSyllabusEntries,
  listSyllabusTopics,
  listSyllabusUploads,
  mergeExtractedItem,
  processSyllabusUpload,
  rejectExtractedItem,
  rejectManualSyllabusEntry,
  updateManualSyllabusEntry,
  updateExtractedItem,
  updateSyllabusTopic,
} from "../controllers/syllabusController.js"
import {
  approveQuestion,
  createQuestion,
  generateDraftQuestionBatch,
  getQuestionBatchReview,
  listQuestions,
  rejectQuestion,
  sourceAssessmentQuestions,
  updateQuestion,
} from "../controllers/questionsController.js"
import { adaptQuestionExplanation, flagQuestionExplanation, synthesizeQuestionExplanationSpeech } from "../controllers/explanationsController.js"
import { getSchoolFeaturesController, updateSchoolFeaturesController } from "../controllers/schoolFeaturesController.js"
import {
  acceptExamLabCandidate,
  archiveExamLabQuestion,
  archiveExamLabTopicEntity,
  createExamLabManualQuestion,
  createExamLabMarkScheme,
  generateExamLabPredictionReport,
  getExamLabCoverage,
  getExamLabDashboard,
  getExamLabPaperReview,
  getExamLabTopicMap,
  listExamLabBacktests,
  listExamLabPredictionReports,
  listExamLabQuestions,
  runExamLabBacktest,
  saveExamLabSkill,
  saveExamLabSubtopic,
  saveExamLabTopic,
  startExamLabExtraction,
  suggestExamLabQuestionTags,
  updateExamLabCandidate,
  updateExamLabCoverageNote,
  updateExamLabQuestion,
  uploadExamLabPaper,
} from "../controllers/examLabController.js"
import {
  applyWeeklyActivitiesToVersionController,
  archiveBellScheduleController,
  archiveCurriculumRequirementController,
  archiveFacilityController,
  archiveStreamSchedulingRuleController,
  archiveSubjectFocusAssignmentController,
  archiveSubjectFocusCategoryController,
  archiveSubjectFocusRuleController,
  archiveWeeklyActivityController,
  assignEquipmentController,
  calculateExamAvailabilityWindowsController,
  createBellScheduleController,
  createBellScheduleSlotController,
  createCurriculumRequirementController,
  createEquipmentController,
  createFacilityController,
  createStreamSchedulingRuleController,
  createSubjectFocusAssignmentController,
  createSubjectFocusCategoryController,
  createSubjectFocusRuleController,
  createWeeklyActivityController,
  deleteBellScheduleSlotController,
  duplicateFacilityController,
  duplicateWeeklyActivityController,
  getFacilityController,
  getWeeklyActivityController,
  listBellSchedulesController,
  listBellSlotTagsController,
  listCurriculumRequirementsController,
  listEquipmentController,
  listFacilitiesController,
  listOccupancyController,
  listStreamSchedulingRulesController,
  listSubjectFocusAssignmentsController,
  listSubjectFocusCategoriesController,
  listSubjectFocusRulesController,
  listTimetableDayTemplatesController,
  listWeeklyActivitiesController,
  setBellScheduleSlotTagsController,
  setFacilityAvailabilityController,
  setFacilitySubjectEligibilityController,
  setTimetableDayTemplateController,
  updateBellScheduleController,
  updateBellScheduleSlotController,
  updateCurriculumRequirementController,
  updateFacilityController,
  updateStreamSchedulingRuleController,
  updateSubjectFocusAssignmentController,
  updateSubjectFocusCategoryController,
  updateSubjectFocusRuleController,
  updateWeeklyActivityController,
  validateFacilityUseController,
  validateWeeklyActivityController,
} from "../modules/timetabling/schedulingFoundation.controller.js"
import {
  allocateExamRoomsController,
  allocateInvigilatorsController,
  approveTimetableVersionController,
  archiveTimetableController,
  cancelTimetableGenerationJobController,
  cloneTimetableVersionController,
  completeTimetableWithSolverController,
  createTimetableController,
  createTimetableEntryController,
  createTimetableVersionController,
  findTimetableAlternativesController,
  generateExamTimetableController,
  getTimetableFocusReportController,
  getTimetableController,
  getTimetableGenerationJobController,
  getTimetableReadinessController,
  getTimetableSetupOptionsController,
  getTimetableStreamRuleReportController,
  getTimetableVersionController,
  listTimetableAuditController,
  listTimetableConflictsController,
  listTimetablesController,
  listTimetableVersionsController,
  publishTimetableVersionController,
  requestTimetableChangesController,
  startTimetableGenerationController,
  submitTimetableReviewController,
  timetableSolverHealthController,
  updateTimetableSetupController,
  validateTimetableEntryController,
} from "../modules/timetabling/timetabling.controller.js"
import {
  getSchoolTodayAlertsController,
  getSchoolTodayClassController,
  getSchoolTodayController,
  getSchoolTodayExamsController,
  getSchoolTodayFacilityController,
  getSchoolTodayTeacherController,
  recalculateSchoolTodayController,
} from "../modules/timetabling/schoolToday.controller.js"
import {
  createRecurringAssessmentTemplate,
  createSchoolEvent,
  generateRecurringAssessmentInstances,
  getAssessmentInstance,
  getSchoolCalendar,
  saveAssessmentInstanceResults,
  updateSchoolEvent,
  updateTermTimeline,
} from "../controllers/calendarController.js"
import {
  createTeacherAssignment,
  deactivateTeacherAssignment,
  listTeacherAssignments,
  updateTeacherAssignment,
} from "../controllers/teacherAssignmentsController.js"
import { createTeacher, getTeacher, listTeachers } from "../controllers/teachersController.js"
import { savePublicSchoolSetupDraft } from "../controllers/publicSetupController.js"
import {
  approveResultBatch,
  getClassResultSheet,
  getResultSheet,
  listResultBatches,
  listResultsSetup,
  returnResultBatch,
  saveResultDraft,
  submitResults,
} from "../controllers/resultsController.js"
import {
  createClass,
  createSchoolUser,
  createSubject,
  deleteSubject,
  getClass,
  getUserPermissions,
  listClasses,
  listParents,
  listReports,
  listResults,
  listSubjects,
  listUsers,
  linkParentGuardian,
  quickSearch,
  updateUserPermissions,
  updateSubject,
} from "../controllers/schoolDataController.js"
import { requireAuth, requireExactRole, requirePasswordReady, requireRole } from "../middleware/auth.js"
import { requireSchoolPermission, SCHOOL_PERMISSIONS } from "../services/authorizationService.js"
import {
  cancelMyLeave,
  createMyLeave,
  createLeave,
  createRun,
  generateItems,
  hrSettings,
  leaveDashboard,
  leaveRequest,
  leaveTransition,
  myLeaveDashboard,
  patchHrSettings,
  patchLeave,
  patchLeaveBalance,
  patchPayrollItem,
  payrollDashboard,
  payrollRun,
  payrollTransition,
  saveProfile,
} from "../controllers/hrOperationsController.js"
import { approveImport, assetPreview, cancelImport, createImport, deleteImage, extractImages, getImport, linkAnswer, listImages, listImports, pagePreview, reviewImport, startImport, updateImage, updateImportMarking, updateImportQuestion } from "../controllers/assessmentImportController.js"
import { portalMutationInvalidationMiddleware } from "../realtime/portalInvalidationMiddleware.js"
import { asyncHandler } from "../utils/http.js"
import {
  academicCommandCentre,
  academicAiExplain,
  academicOverview,
  academicClasses,
  academicClassDetail,
  academicSubjects,
  academicSubjectDetail,
  academicTopicDetail,
  academicEvidence,
  academicRisks,
  academicInsights,
  academicPositiveSignals,
  academicMeaningfulChanges,
  academicEvidenceGaps,
  academicReadiness,
  academicHistory,
  academicExplanation,
  academicRecalculate,
  academicAuthoringSetup,
  assessmentBlueprints,
  academicEngineConfiguration,
  curriculumDependencyGraph,
  patchCurriculumLifecycle,
  patchParentAcademicInsight,
  postIntervention,
  postParentAcademicInsight,
  postAssessmentBlueprint,
  postRemediationPack,
  remediationPacks,
  parentPortalAcademicInsights,
  studentAcademicIntelligence,
  updateAcademicEngineConfiguration,
  updateIntervention,
  updateRemediationPack,
} from "../controllers/academicIntelligenceController.js"
import {
  academicAuthoringTopics,
  academicMarkSheet,
  assessmentOperationalIntelligence,
  patchQuestionPermission,
  postAcademicMarkSheetDraft,
  postAcademicMarkSheetPublish,
  postAcademicMarkSheetReopen,
  postTargetedAssessment,
  postTargetedAssessmentApproval,
  postTargetedAssessmentGenerate,
  postTargetedAssessmentPublish,
  postTargetedAssessmentReplacement,
  postTargetedLearnerConfirmation,
  putQuestionMappings,
  putTargetedAssessmentReview,
  targetedAssessment,
  targetedAssessments,
  validateTargetedAssessment,
} from "../controllers/academicOperationsController.js"
import {
  escalationPolicy,
  learnerSupport,
  postAcademicReviewRequest,
  postCaseTargetedAssessment,
  postGuardianSummaryDraft,
  postSupportAcknowledgement,
  postSupportAssignmentCompletion,
  postSupportAssignment,
  postSupportCarryForward,
  postSupportEscalation,
  postSupportEscalationRecommendation,
  postSupportIntervention,
  postSupportNote,
  postSupportOutcome,
  postSupportOwnershipAcceptance,
  postSupportReassessment,
  postSupportReassignmentRequest,
  postSupportResolution,
  postSupportSession,
  supportCase,
  supportCases,
  supportEvidence,
  supportInterventions,
  supportTimeline,
  teacherSupportSummary,
} from "../controllers/academicSupportController.js"
import {
  archiveBrowser,
  classroomAttendance,
  classroomHistory,
  classroomResource,
  classroomSession,
  classroomSetup,
  completeClassroomSession,
  downloadTeachingResource,
  librarianDashboard,
  libraryComputers,
  libraryLoans,
  patchClassroomSession,
  patchLibraryComputer,
  patchPrintRequest,
  patchTeachingResourceRequest,
  patchTeachingResourceStatus,
  physicalLibraryResources,
  postClassroomSession,
  postLibraryComputer,
  postLibraryLoan,
  postLibraryReturn,
  postPhysicalLibraryResource,
  postPrintRequest,
  postTeachingResource,
  postTeachingResourceRequest,
  postTeachingResourceVersion,
  postTeachingResourceReview,
  printRequests,
  teachingResource,
  teachingResourceRequests,
  teachingResources,
} from "../controllers/libraryClassroomController.js"

const router = Router()

router.param("id", async (req, _res, next, value) => {
  try {
    if (!String(req.path || "").includes("timetables") || /^\d+$/.test(String(value))) return next()
    const schoolId = Number(req.user?.schoolId || req.user?.school_id || 0)
    const [[row]] = await pool.query("SELECT id FROM timetables WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, value])
    if (!row) return next(new HttpError(404, "Timetable reference was not found."))
    req.params.id = String(row.id)
    next()
  } catch (error) { next(error) }
})

router.param("versionId", async (req, _res, next, value) => {
  try {
    if (!String(req.path || "").includes("timetables") || /^\d+$/.test(String(value))) return next()
    const schoolId = Number(req.user?.schoolId || req.user?.school_id || 0)
    const [[row]] = await pool.query("SELECT tv.id FROM timetable_versions tv JOIN timetables tt ON tt.id=tv.timetable_id WHERE tt.school_id=? AND tv.public_ref=? LIMIT 1", [schoolId, value])
    if (!row) return next(new HttpError(404, "Timetable version reference was not found."))
    req.params.versionId = String(row.id)
    next()
  } catch (error) { next(error) }
})

const requireDirectorAccess = requireRole("school_owner", "headteacher")

function directorPage(section) {
  return asyncHandler((req, res, next) => {
    req.directorSection = section
    return getDirectorMappedPage(req, res, next)
  })
}

router.use("/auth", authRoutes)
router.post("/public/school-setup-drafts", asyncHandler(savePublicSchoolSetupDraft))
router.use(requireAuth)
router.use(requirePasswordReady)
router.use(portalMutationInvalidationMiddleware)

router.get("/dashboard", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getDashboard))
router.get("/director/overview", requireDirectorAccess, asyncHandler(getDirectorOverview))
router.get("/director/pages/:section", requireDirectorAccess, asyncHandler(getDirectorPage))
router.get("/director/finance/fee-collection", requireDirectorAccess, directorPage("finance-fee-collection"))
router.get("/director/finance/outstanding-balances", requireDirectorAccess, directorPage("finance-outstanding-balances"))
router.get("/director/finance/discounts-bursaries", requireDirectorAccess, directorPage("finance-discounts-bursaries"))
router.get("/director/finance/expenses", requireDirectorAccess, directorPage("finance-expenses"))
router.get("/director/finance/financial-reports", requireDirectorAccess, directorPage("finance-financial-reports"))

router.get("/director/finance/payroll", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_VIEW), asyncHandler(payrollDashboard))
router.post("/director/finance/payroll/runs", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), asyncHandler(createRun))
router.get("/director/finance/payroll/runs/:runRef", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_VIEW), asyncHandler(payrollRun))
router.post("/director/finance/payroll/runs/:runRef/generate-items", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), asyncHandler(generateItems))
router.post("/director/finance/payroll/runs/:runRef/submit", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), (req,_res,next)=>{req.params.action="submit";next()}, asyncHandler(payrollTransition))
router.post("/director/finance/payroll/runs/:runRef/:action(approve|pay|cancel)", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_APPROVE), asyncHandler(payrollTransition))
router.patch("/director/finance/payroll/items/:itemRef", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), asyncHandler(patchPayrollItem))
router.post("/director/finance/payroll/salary-profiles", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), asyncHandler(saveProfile))
router.patch("/director/finance/payroll/salary-profiles/:profileRef", requireSchoolPermission(SCHOOL_PERMISSIONS.PAYROLL_MANAGE), asyncHandler(saveProfile))
router.get("/staff/leave/me", requireRole("school_owner", "director", "owner", "headteacher", "teacher", "bursar", "librarian"), asyncHandler(myLeaveDashboard))
router.post("/staff/leave/me", requireRole("school_owner", "director", "owner", "headteacher", "teacher", "bursar", "librarian"), asyncHandler(createMyLeave))
router.post("/staff/leave/me/:leaveRef/cancel", requireRole("school_owner", "director", "owner", "headteacher", "teacher", "bursar", "librarian"), asyncHandler(cancelMyLeave))
router.get("/director/staff/leave", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_VIEW), asyncHandler(leaveDashboard))
router.post("/director/staff/leave", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_MANAGE), asyncHandler(createLeave))
router.get("/director/staff/leave/:leaveRef", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_VIEW), asyncHandler(leaveRequest))
router.patch("/director/staff/leave/:leaveRef", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_MANAGE), asyncHandler(patchLeave))
router.post("/director/staff/leave/:leaveRef/:action(approve|reject|cancel|complete)", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_APPROVE), asyncHandler(leaveTransition))
router.patch("/director/staff/leave-balances/:balanceRef", requireSchoolPermission(SCHOOL_PERMISSIONS.LEAVE_APPROVE), asyncHandler(patchLeaveBalance))
router.get("/director/hr-settings", requireRole("school_owner"), asyncHandler(hrSettings))
router.patch("/director/hr-settings", requireRole("school_owner"), asyncHandler(patchHrSettings))
router.get("/director/admissions/enrollment-pipeline", requireDirectorAccess, directorPage("admissions-enrollment-pipeline"))
router.get("/director/admissions/class-capacity", requireDirectorAccess, directorPage("admissions-class-capacity"))
router.get("/director/admissions/class-capacity/:classId", requireDirectorAccess, directorPage("admissions-class-capacity"))
router.get("/director/admissions/withdrawals", requireDirectorAccess, directorPage("admissions-withdrawals"))
router.get("/director/admissions/withdrawals/:withdrawalId", requireDirectorAccess, directorPage("admissions-withdrawals"))
router.get("/director/academics/performance-overview", requireDirectorAccess, directorPage("academics-performance-overview"))
router.get("/director/academics/at-risk-students", requireDirectorAccess, directorPage("academics-at-risk-students"))
router.get("/director/academics/at-risk-students/:studentId", requireDirectorAccess, directorPage("academics-at-risk-students"))
router.get("/director/academics/subject-trends", requireDirectorAccess, directorPage("academics-subject-trends"))
router.get("/director/academics/subject-trends/:subjectId", requireDirectorAccess, directorPage("academics-subject-trends"))
router.get("/director/academics/marks-submission", requireDirectorAccess, directorPage("academics-marks-submission"))
router.get("/director/academics/marks-submission/:batchId", requireDirectorAccess, directorPage("academics-marks-submission"))
router.get("/director/staff/teacher-compliance", requireDirectorAccess, directorPage("staff-teacher-compliance"))
router.get("/director/staff/teacher-compliance/:teacherId", requireDirectorAccess, directorPage("staff-teacher-compliance"))
router.get("/director/staff/attendance", requireDirectorAccess, directorPage("staff-attendance"))
router.get("/director/staff/workload", requireDirectorAccess, directorPage("staff-workload"))
router.get("/director/operations/incidents", requireDirectorAccess, directorPage("operations-incidents"))
router.get("/director/operations/complaints", requireDirectorAccess, directorPage("operations-complaints"))
router.get("/director/operations/approvals", requireDirectorAccess, directorPage("operations-approvals"))
router.get("/director/reports/director-report", requireDirectorAccess, directorPage("reports-director-report"))
router.get("/director/reports/term-report", requireDirectorAccess, directorPage("reports-term-report"))
router.get("/director/reports/export-center", requireDirectorAccess, directorPage("reports-export-center"))
router.get("/director/audit-security", requireDirectorAccess, directorPage("audit-security"))
router.get("/director/settings", requireDirectorAccess, directorPage("settings"))
router.patch("/director/settings", requireDirectorAccess, asyncHandler(patchDirectorSettings))
router.get("/director/tasks", asyncHandler(listTasks))
router.post("/director/tasks", requireDirectorAccess, asyncHandler(createTask))
router.get("/director/tasks/:taskId", asyncHandler(getTask))
router.patch("/director/tasks/:taskId", asyncHandler(patchTask))
router.patch("/director/tasks/:taskId/complete", asyncHandler(completeTask))
router.patch("/director/tasks/:taskId/cancel", asyncHandler(cancelTask))
router.delete("/director/tasks/:taskId", asyncHandler(deleteTask))
router.get("/director/daily-closure", requireDirectorAccess, asyncHandler(dailyClosure))
router.patch("/director/daily-closure", requireDirectorAccess, asyncHandler(markDailyClosureReviewed))
router.get("/notifications", asyncHandler(notifications))
router.get("/notifications/unread-count", asyncHandler(unreadNotifications))
router.patch("/notifications/:notificationId/read", asyncHandler(readNotification))
router.patch("/notifications/:notificationId/dismiss", asyncHandler(dismissNotification))

router.get("/academic-intelligence/command-centre", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicCommandCentre))
router.get("/academic-intelligence/overview", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicOverview))
router.get("/academic-intelligence/classes", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicClasses))
router.get("/academic-intelligence/classes/:classRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicClassDetail))
router.get("/academic-intelligence/subjects", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicSubjects))
router.get("/academic-intelligence/subjects/:subjectRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicSubjectDetail))
router.get("/academic-intelligence/topics/:topicRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicTopicDetail))
router.get("/academic-intelligence/evidence", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicEvidence))
router.get("/academic-intelligence/risks", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicRisks))
router.get("/academic-intelligence/insights", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicInsights))
router.get("/academic-intelligence/positive-signals", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicPositiveSignals))
router.get("/academic-intelligence/meaningful-changes", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicMeaningfulChanges))
router.get("/academic-intelligence/evidence-gaps", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicEvidenceGaps))
router.get("/academic-intelligence/readiness", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicReadiness))
router.get("/academic-intelligence/history", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicHistory))
router.get("/academic-intelligence/explanations/:findingId", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicExplanation))
router.post("/academic-intelligence/recalculate", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(academicRecalculate))
router.post("/academic-intelligence/ai/explain", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicAiExplain))
router.get("/academic-intelligence/authoring-setup", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicAuthoringSetup))
router.get("/academic-intelligence/students/:studentRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(studentAcademicIntelligence))
router.get("/academic-intelligence/dependencies", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(curriculumDependencyGraph))
router.get("/academic-intelligence/config", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicEngineConfiguration))
router.patch("/academic-intelligence/config", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(updateAcademicEngineConfiguration))
router.patch("/academic-intelligence/curriculum/:recordRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(patchCurriculumLifecycle))
router.post("/academic-intelligence/interventions", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postIntervention))
router.patch("/academic-intelligence/interventions/:interventionRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(updateIntervention))
router.post("/academic-intelligence/parent-insights", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postParentAcademicInsight))
router.patch("/academic-intelligence/parent-insights/:insightRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(patchParentAcademicInsight))
router.get("/parent-portal/academic-insights", requireExactRole("parent"), asyncHandler(parentPortalAcademicInsights))
router.get("/academic-intelligence/assessment-blueprints", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(assessmentBlueprints))
router.post("/academic-intelligence/assessment-blueprints", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(postAssessmentBlueprint))
router.get("/academic-intelligence/remediation-packs", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(remediationPacks))
router.post("/academic-intelligence/remediation-packs", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postRemediationPack))
router.patch("/academic-intelligence/remediation-packs/:packRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(updateRemediationPack))

// Canonical academic operations loop. These routes extend the existing
// assessment and evidence domains; they are not a second intelligence API.
router.get("/academic-intelligence/authoring-topics", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicAuthoringTopics))
router.put("/assessments/:assessmentId/questions/:questionId/mappings", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(putQuestionMappings))
router.get("/assessments/:assessmentId/operational-intelligence", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(assessmentOperationalIntelligence))
router.get("/assessments/:assessmentId/academic-mark-sheet", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(academicMarkSheet))
router.post("/assessments/:assessmentId/academic-mark-sheet/draft", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(postAcademicMarkSheetDraft))
router.post("/assessments/:assessmentId/academic-mark-sheet/publish", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(postAcademicMarkSheetPublish))
router.post("/assessments/:assessmentId/academic-mark-sheet/reopen", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(postAcademicMarkSheetReopen))
router.patch("/question-library/:questionRef/source-permission", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMICS_MANAGE), asyncHandler(patchQuestionPermission))
router.get("/academic-intelligence/targeted-assessments", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(targetedAssessments))
router.post("/academic-intelligence/targeted-assessments", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedAssessment))
router.get("/academic-intelligence/targeted-assessments/:generatedRef", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(targetedAssessment))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/generate", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedAssessmentGenerate))
router.put("/academic-intelligence/targeted-assessments/:generatedRef/review", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(putTargetedAssessmentReview))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/replace-question", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedAssessmentReplacement))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/confirm-learners", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedLearnerConfirmation))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/validate", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(validateTargetedAssessment))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/approve", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedAssessmentApproval))
router.post("/academic-intelligence/targeted-assessments/:generatedRef/publish", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postTargetedAssessmentPublish))

// Persistent learner-support lifecycle. Read access follows the academic
// intelligence permission and teacher assignment scope inside the service.
router.get("/academic-support/cases", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(supportCases))
router.get("/academic-support/summary", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(teacherSupportSummary))
router.get("/academic-support/learners/:learnerId", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(learnerSupport))
router.get("/academic-support/escalation-policy", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(escalationPolicy))
router.get("/academic-support/cases/:caseId", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(supportCase))
router.get("/academic-support/cases/:caseId/timeline", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(supportTimeline))
router.get("/academic-support/cases/:caseId/evidence", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(supportEvidence))
router.get("/academic-support/cases/:caseId/interventions", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW), asyncHandler(supportInterventions))
router.post("/academic-support/cases/:caseId/assign", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportAssignment))
router.post("/academic-support/cases/:caseId/acknowledge", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportAcknowledgement))
router.post("/academic-support/cases/:caseId/complete-assignment", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportAssignmentCompletion))
router.post("/academic-support/cases/:caseId/accept-ownership", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportOwnershipAcceptance))
router.post("/academic-support/cases/:caseId/request-reassignment", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportReassignmentRequest))
router.post("/academic-support/cases/:caseId/add-note", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportNote))
router.post("/academic-support/cases/:caseId/create-targeted-assessment", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postCaseTargetedAssessment))
router.post("/academic-support/cases/:caseId/create-intervention", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportIntervention))
router.post("/academic-support/cases/:caseId/record-session", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportSession))
router.post("/academic-support/cases/:caseId/schedule-reassessment", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportReassessment))
router.post("/academic-support/cases/:caseId/review-outcome", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportOutcome))
router.post("/academic-support/cases/:caseId/escalate", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(postSupportEscalation))
router.post("/academic-support/cases/:caseId/resolve", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportResolution))
router.post("/academic-support/cases/:caseId/carry-forward", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(postSupportCarryForward))
router.post("/academic-support/cases/:caseId/request-academic-review", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postAcademicReviewRequest))
router.post("/academic-support/cases/:caseId/recommend-escalation", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE), asyncHandler(postSupportEscalationRecommendation))
router.post("/academic-support/cases/:caseId/draft-guardian-summary", requireSchoolPermission(SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE), asyncHandler(postGuardianSummaryDraft))

router.get("/library/dashboard", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_DASHBOARD_VIEW), asyncHandler(librarianDashboard))
router.get("/library/catalogue", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_BOOK_VIEW), asyncHandler(physicalLibraryResources))
router.post("/library/catalogue", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_BOOK_CREATE), asyncHandler(postPhysicalLibraryResource))
router.get("/library/loans", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_LOAN_VIEW), asyncHandler(libraryLoans))
router.post("/library/loans", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_LOAN_CREATE), asyncHandler(postLibraryLoan))
router.post("/library/loans/:loanRef/return", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_LOAN_RETURN), asyncHandler(postLibraryReturn))
router.get("/library/computers", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_COMPUTER_VIEW), asyncHandler(libraryComputers))
router.post("/library/computers", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_COMPUTER_MANAGE), asyncHandler(postLibraryComputer))
router.patch("/library/computers/:computerRef", requireSchoolPermission(SCHOOL_PERMISSIONS.LIBRARY_COMPUTER_MANAGE), asyncHandler(patchLibraryComputer))
router.get("/teaching-resources", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_VIEW), asyncHandler(teachingResources))
router.post("/teaching-resources", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_CREATE), asyncHandler(postTeachingResource))
router.get("/teaching-resource-requests", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_VIEW), asyncHandler(teachingResourceRequests))
router.post("/teaching-resource-requests", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_VIEW), asyncHandler(postTeachingResourceRequest))
router.patch("/teaching-resource-requests/:requestRef", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_REVIEW), asyncHandler(patchTeachingResourceRequest))
router.post("/teaching-resources/:resourceRef/versions", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_UPDATE), asyncHandler(postTeachingResourceVersion))
router.get("/teaching-resources/:resourceRef", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_VIEW), asyncHandler(teachingResource))
router.get("/teaching-resources/:resourceRef/download", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_DOWNLOAD), asyncHandler(downloadTeachingResource))
router.patch("/teaching-resources/:resourceRef/status", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_UPDATE), asyncHandler(patchTeachingResourceStatus))
router.post("/teaching-resources/:resourceRef/reviews", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_REVIEW), asyncHandler(postTeachingResourceReview))
router.get("/print-requests", requireSchoolPermission(SCHOOL_PERMISSIONS.PRINT_REQUEST_VIEW), asyncHandler(printRequests))
router.post("/print-requests", requireSchoolPermission(SCHOOL_PERMISSIONS.TEACHING_RESOURCE_PRINT), asyncHandler(postPrintRequest))
router.patch("/print-requests/:requestRef", requireSchoolPermission(SCHOOL_PERMISSIONS.PRINT_REQUEST_PROCESS), asyncHandler(patchPrintRequest))
router.get("/institutional-archive", requireSchoolPermission(SCHOOL_PERMISSIONS.ARCHIVED_TERM_VIEW), asyncHandler(archiveBrowser))
router.get("/classroom-mode/setup", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(classroomSetup))
router.get("/classroom-mode/history", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(classroomHistory))
router.post("/classroom-mode/sessions", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(postClassroomSession))
router.get("/classroom-mode/sessions/:sessionRef", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(classroomSession))
router.patch("/classroom-mode/sessions/:sessionRef", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(patchClassroomSession))
router.post("/classroom-mode/sessions/:sessionRef/attendance", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(classroomAttendance))
router.post("/classroom-mode/sessions/:sessionRef/resources", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(classroomResource))
router.post("/classroom-mode/sessions/:sessionRef/complete", requireExactRole("teacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE), asyncHandler(completeClassroomSession))
router.post("/director/reminders", requireDirectorAccess, asyncHandler(remind))
router.post("/director/escalations", requireDirectorAccess, asyncHandler(escalate))
router.get("/staff/attendance/today", requireRole("school_owner","headteacher","teacher"), asyncHandler(staffAttendanceToday))
router.post("/staff/attendance", requireRole("school_owner","headteacher"), asyncHandler(recordAttendance))
router.post("/staff/attendance/self-check-in", requireRole("teacher","headteacher"), asyncHandler(teacherSelfCheckIn))
router.post("/director/finance/fee-reminders", requireDirectorAccess, asyncHandler(feeReminder))
router.post("/director/finance/payment-promises", requireDirectorAccess, asyncHandler(paymentPromise))
router.patch("/director/finance/payment-promises/:promiseId", requireDirectorAccess, asyncHandler(patchPaymentPromise))
router.get("/director/settings/whatsapp", requireDirectorAccess, asyncHandler(whatsappSettings))
router.patch("/director/settings/whatsapp", requireDirectorAccess, asyncHandler(patchWhatsappSettings))
router.post("/system/run-reminder-engine", requireDirectorAccess, asyncHandler(executeReminderEngine))
router.get("/director/withdrawals", requireDirectorAccess, asyncHandler(listDirectorWithdrawals))
router.get("/student-portal", requireRole("student", "parent"), asyncHandler(getStudentPortal))
router.post("/student-portal/announcements/:id/reaction", requireRole("student"), asyncHandler(reactToAnnouncement))
router.post("/student-portal/announcements/:id/vote", requireRole("student"), asyncHandler(voteAnnouncementPoll))
router.get("/timetables", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTimetablesController))
router.post("/timetables", requireRole("school_owner", "headteacher"), asyncHandler(createTimetableController))
router.get("/timetables/setup-options", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableSetupOptionsController))
router.get("/timetables/generation-jobs/:jobId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableGenerationJobController))
router.post("/timetables/generation-jobs/:jobId/cancel", requireRole("school_owner", "headteacher"), asyncHandler(cancelTimetableGenerationJobController))
router.get("/timetables/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableController))
router.patch("/timetables/:id/setup", requireRole("school_owner", "headteacher"), asyncHandler(updateTimetableSetupController))
router.post("/timetables/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveTimetableController))
router.get("/timetables/:id/audit", requireRole("school_owner", "headteacher"), asyncHandler(listTimetableAuditController))
router.get("/timetables/:id/versions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTimetableVersionsController))
router.post("/timetables/:id/versions", requireRole("school_owner", "headteacher"), asyncHandler(createTimetableVersionController))
router.get("/timetables/:id/versions/:versionId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableVersionController))
router.post("/timetables/:id/versions/:versionId/clone", requireRole("school_owner", "headteacher"), asyncHandler(cloneTimetableVersionController))
router.post("/timetables/:id/versions/:versionId/generate", requireRole("school_owner", "headteacher"), asyncHandler(startTimetableGenerationController))
router.post("/timetables/:id/versions/:versionId/complete-with-solver", requireRole("school_owner", "headteacher"), asyncHandler(completeTimetableWithSolverController))
router.post("/timetables/:id/versions/:versionId/find-alternatives", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(findTimetableAlternativesController))
router.post("/timetables/:id/versions/:versionId/apply-weekly-activities", requireRole("school_owner", "headteacher"), asyncHandler(applyWeeklyActivitiesToVersionController))
router.get("/timetables/:id/versions/:versionId/readiness", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableReadinessController))
router.get("/timetables/:id/versions/:versionId/focus-report", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableFocusReportController))
router.get("/timetables/:id/versions/:versionId/stream-rule-report", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableStreamRuleReportController))
router.get("/timetables/:id/versions/:versionId/conflicts", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTimetableConflictsController))
router.post("/timetables/:id/versions/:versionId/validate-entry", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(validateTimetableEntryController))
router.post("/timetables/:id/versions/:versionId/entries", requireRole("school_owner", "headteacher"), asyncHandler(createTimetableEntryController))
router.post("/timetables/:id/versions/:versionId/submit-review", requireRole("school_owner", "headteacher"), asyncHandler(submitTimetableReviewController))
router.post("/timetables/:id/versions/:versionId/request-changes", requireRole("school_owner", "headteacher"), asyncHandler(requestTimetableChangesController))
router.post("/timetables/:id/versions/:versionId/approve", requireRole("school_owner", "headteacher"), asyncHandler(approveTimetableVersionController))
router.post("/timetables/:id/versions/:versionId/publish", requireRole("school_owner", "headteacher"), asyncHandler(publishTimetableVersionController))
router.get("/system/timetable-solver/health", requireRole("school_owner", "headteacher"), asyncHandler(timetableSolverHealthController))
router.post("/exam-timetables/:id/versions/:versionId/generate", requireRole("school_owner", "headteacher"), asyncHandler(generateExamTimetableController))
router.post("/exam-timetables/:id/versions/:versionId/generate-for-scope", requireRole("school_owner", "headteacher"), asyncHandler(generateExamTimetableController))
router.post("/exam-timetables/:id/versions/:versionId/allocate-rooms", requireRole("school_owner", "headteacher"), asyncHandler(allocateExamRoomsController))
router.post("/exam-timetables/:id/versions/:versionId/allocate-invigilators", requireRole("school_owner", "headteacher"), asyncHandler(allocateInvigilatorsController))
router.get("/exam-timetables/generation-jobs/:jobId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTimetableGenerationJobController))
router.post("/exam-timetables/generation-jobs/:jobId/cancel", requireRole("school_owner", "headteacher"), asyncHandler(cancelTimetableGenerationJobController))
router.get("/ai/status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAiStatusController))
router.post("/ai/test", requireRole("school_owner", "headteacher"), asyncHandler(testAiController))
router.get("/ai/usage-summary", requireRole("school_owner", "headteacher"), asyncHandler(getAiUsageSummaryController))
router.patch("/ai/settings", requireRole("school_owner", "headteacher"), asyncHandler(updateAiSettingsController))
router.get("/school/features", requireRole("school_owner", "headteacher", "teacher", "bursar", "parent", "student"), asyncHandler(getSchoolFeaturesController))
router.patch("/school/features", requireRole("school_owner", "headteacher"), asyncHandler(updateSchoolFeaturesController))
router.get("/preferences/me", requireRole("school_owner", "headteacher", "teacher", "bursar", "parent", "student"), asyncHandler(getMyPreferences))
router.patch("/preferences/me", requireRole("school_owner", "headteacher", "teacher", "bursar", "parent", "student"), asyncHandler(updateMyPreferences))
router.get("/school/report-settings", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getReportPdfSettingsController))
router.patch("/school/report-settings", requireRole("school_owner", "headteacher"), asyncHandler(updateReportPdfSettingsController))
router.get("/school/today", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(getSchoolTodayController))
router.get("/school/today/classes/:classId", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(getSchoolTodayClassController))
router.get("/school/today/teachers/:teacherId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSchoolTodayTeacherController))
router.get("/school/today/facilities/:facilityId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSchoolTodayFacilityController))
router.get("/school/today/exams", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(getSchoolTodayExamsController))
router.get("/school/today/alerts", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSchoolTodayAlertsController))
router.post("/school/today/recalculate", requireRole("school_owner", "headteacher"), asyncHandler(recalculateSchoolTodayController))
router.get("/scheduling/bell-schedules", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listBellSchedulesController))
router.get("/scheduling/bell-slot-tags", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listBellSlotTagsController))
router.get("/scheduling/timetables/:timetableId/day-templates", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTimetableDayTemplatesController))
router.patch("/scheduling/timetables/:timetableId/day-templates/:cycleDayId", requireRole("school_owner", "headteacher"), asyncHandler(setTimetableDayTemplateController))
router.post("/scheduling/bell-schedules", requireRole("school_owner", "headteacher"), asyncHandler(createBellScheduleController))
router.patch("/scheduling/bell-schedules/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateBellScheduleController))
router.post("/scheduling/bell-schedules/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveBellScheduleController))
router.put("/scheduling/bell-schedules/:id/slot-tags", requireRole("school_owner", "headteacher"), asyncHandler(setBellScheduleSlotTagsController))
router.post("/scheduling/bell-schedules/:id/slots", requireRole("school_owner", "headteacher"), asyncHandler(createBellScheduleSlotController))
router.patch("/scheduling/bell-schedule-slots/:slotId", requireRole("school_owner", "headteacher"), asyncHandler(updateBellScheduleSlotController))
router.delete("/scheduling/bell-schedule-slots/:slotId", requireRole("school_owner", "headteacher"), asyncHandler(deleteBellScheduleSlotController))
router.get("/scheduling/curriculum-requirements", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listCurriculumRequirementsController))
router.post("/scheduling/curriculum-requirements", requireRole("school_owner", "headteacher"), asyncHandler(createCurriculumRequirementController))
router.patch("/scheduling/curriculum-requirements/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateCurriculumRequirementController))
router.post("/scheduling/curriculum-requirements/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveCurriculumRequirementController))
router.get("/scheduling/subject-focus-categories", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSubjectFocusCategoriesController))
router.post("/scheduling/subject-focus-categories", requireRole("school_owner", "headteacher"), asyncHandler(createSubjectFocusCategoryController))
router.patch("/scheduling/subject-focus-categories/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateSubjectFocusCategoryController))
router.post("/scheduling/subject-focus-categories/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveSubjectFocusCategoryController))
router.get("/scheduling/subject-focus-assignments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSubjectFocusAssignmentsController))
router.post("/scheduling/subject-focus-assignments", requireRole("school_owner", "headteacher"), asyncHandler(createSubjectFocusAssignmentController))
router.patch("/scheduling/subject-focus-assignments/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateSubjectFocusAssignmentController))
router.post("/scheduling/subject-focus-assignments/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveSubjectFocusAssignmentController))
router.get("/scheduling/subject-focus-rules", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSubjectFocusRulesController))
router.post("/scheduling/subject-focus-rules", requireRole("school_owner", "headteacher"), asyncHandler(createSubjectFocusRuleController))
router.patch("/scheduling/subject-focus-rules/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateSubjectFocusRuleController))
router.post("/scheduling/subject-focus-rules/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveSubjectFocusRuleController))
router.get("/scheduling/stream-scheduling-rules", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listStreamSchedulingRulesController))
router.post("/scheduling/stream-scheduling-rules", requireRole("school_owner", "headteacher"), asyncHandler(createStreamSchedulingRuleController))
router.patch("/scheduling/stream-scheduling-rules/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateStreamSchedulingRuleController))
router.post("/scheduling/stream-scheduling-rules/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveStreamSchedulingRuleController))
router.get("/scheduling/facilities", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listFacilitiesController))
router.post("/scheduling/facilities", requireRole("school_owner", "headteacher"), asyncHandler(createFacilityController))
router.get("/scheduling/facilities/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getFacilityController))
router.patch("/scheduling/facilities/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateFacilityController))
router.post("/scheduling/facilities/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveFacilityController))
router.post("/scheduling/facilities/:id/duplicate", requireRole("school_owner", "headteacher"), asyncHandler(duplicateFacilityController))
router.post("/scheduling/facilities/:id/equipment", requireRole("school_owner", "headteacher"), asyncHandler(assignEquipmentController))
router.post("/scheduling/facilities/:id/subjects", requireRole("school_owner", "headteacher"), asyncHandler(setFacilitySubjectEligibilityController))
router.post("/scheduling/facilities/:id/availability", requireRole("school_owner", "headteacher"), asyncHandler(setFacilityAvailabilityController))
router.post("/scheduling/facilities/validate-use", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(validateFacilityUseController))
router.get("/scheduling/equipment", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listEquipmentController))
router.post("/scheduling/equipment", requireRole("school_owner", "headteacher"), asyncHandler(createEquipmentController))
router.get("/scheduling/weekly-activities", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listWeeklyActivitiesController))
router.post("/scheduling/weekly-activities", requireRole("school_owner", "headteacher"), asyncHandler(createWeeklyActivityController))
router.post("/scheduling/weekly-activities/validate", requireRole("school_owner", "headteacher"), asyncHandler(validateWeeklyActivityController))
router.get("/scheduling/weekly-activities/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getWeeklyActivityController))
router.patch("/scheduling/weekly-activities/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateWeeklyActivityController))
router.post("/scheduling/weekly-activities/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveWeeklyActivityController))
router.post("/scheduling/weekly-activities/:id/duplicate", requireRole("school_owner", "headteacher"), asyncHandler(duplicateWeeklyActivityController))
router.get("/scheduling/occupancy", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listOccupancyController))
router.get("/scheduling/exam-availability-windows", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(calculateExamAvailabilityWindowsController))
router.get("/classes", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listClasses))
router.post("/classes", requireRole("school_owner", "headteacher"), asyncHandler(createClass))
router.get("/classes/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getClass))
router.get("/academic-sessions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAcademicSessionSummary))
router.get("/academic-session/current", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(getCurrentAcademicSession))
router.get("/academic-sessions/current", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(getCurrentAcademicSession))
router.get("/calendar", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSchoolCalendar))
router.post("/calendar/events", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createSchoolEvent))
router.patch("/calendar/events/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateSchoolEvent))
router.patch("/calendar/term-timeline", requireRole("school_owner", "headteacher"), asyncHandler(updateTermTimeline))
router.post("/calendar/recurring-assessments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createRecurringAssessmentTemplate))
router.post("/calendar/recurring-assessments/:id/generate", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(generateRecurringAssessmentInstances))
router.get("/calendar/assessment-instances/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAssessmentInstance))
router.post("/calendar/assessment-instances/:id/results", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(saveAssessmentInstanceResults))
router.post("/academic-years", requireRole("school_owner", "headteacher"), asyncHandler(createAcademicYear))
router.get("/academic-years/:id/progression-preview", requireRole("school_owner", "headteacher"), asyncHandler(getProgressionPreview))
router.post("/academic-years/:id/progress", requireRole("school_owner", "headteacher"), asyncHandler(progressAcademicYear))
router.post("/terms/open", requireRole("school_owner", "headteacher"), asyncHandler(openTerm))
router.get("/terms/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAcademicTermDetail))
router.get("/terms/:id/results", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTermResultView))
router.get("/terms/:id/close-checks", requireRole("school_owner", "headteacher"), asyncHandler(getTermCloseChecks))
router.get("/terms/:id/progression-preview", requireRole("school_owner", "headteacher"), asyncHandler(getTermProgressionPreview))
router.post("/terms/:id/progression/classes/:classId/approve", requireRole("school_owner", "headteacher"), asyncHandler(approveTermProgressionClass))
router.post("/terms/:id/marking", requireRole("school_owner", "headteacher"), asyncHandler(moveTermToMarking))
router.post("/terms/:id/close", requireRole("school_owner", "headteacher"), asyncHandler(closeTerm))
router.post("/terms/:id/reopen", requireRole("school_owner", "headteacher"), asyncHandler(reopenTerm))
router.post("/terms/:id/archive", requireRole("school_owner", "headteacher"), asyncHandler(archiveTerm))
router.get("/class-progression-rules", requireRole("school_owner", "headteacher"), asyncHandler(listClassProgressionRules))
router.post("/class-progression-rules", requireRole("school_owner", "headteacher"), asyncHandler(saveClassProgressionRule))
router.get("/progression-policy", requireRole("school_owner", "headteacher"), asyncHandler(getProgressionPolicy))
router.patch("/progression-policy", requireRole("school_owner", "headteacher"), asyncHandler(saveProgressionPolicy))
router.post("/promotions/start", requireRole("school_owner", "headteacher"), asyncHandler(startPromotion))
router.get("/exam-sessions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listExamSessions))
router.post("/exam-sessions", requireRole("school_owner", "headteacher"), asyncHandler(createExamSession))
router.get("/exam-sessions/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getExamSession))
router.patch("/exam-sessions/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateExamSession))
router.post("/exam-sessions/:id/status", requireRole("school_owner", "headteacher"), asyncHandler(transitionExamSession))
router.post("/exam-sessions/:id/papers", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createExamPaper))
router.post("/exam-sessions/:id/papers/bulk", requireRole("school_owner", "headteacher"), asyncHandler(createBulkExamPapers))
router.post("/exam-sessions/:id/papers/:paperId/status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(transitionExamPaper))
router.post("/exam-sessions/:id/timetable", requireRole("school_owner", "headteacher"), asyncHandler(createTimetableEntry))
router.delete("/exam-sessions/:id/timetable/:entryId", requireRole("school_owner", "headteacher"), asyncHandler(deleteTimetableEntry))
router.get("/report-cards/:id/pdf", requireRole("school_owner", "headteacher", "teacher", "student", "parent"), asyncHandler(getReportCardPdf))
router.get("/report-cards/:id", requireRole("school_owner", "headteacher", "teacher", "student", "parent"), asyncHandler(getReportCard))
router.get("/subjects", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSubjects))
router.post("/subjects", requireRole("school_owner", "headteacher"), asyncHandler(createSubject))
router.patch("/subjects/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateSubject))
router.delete("/subjects/:id", requireRole("school_owner", "headteacher"), asyncHandler(deleteSubject))
router.get("/parents", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listParents))
router.get("/results", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listResults))
router.get("/results/setup", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listResultsSetup))
router.get("/results/batches", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listResultBatches))
router.get("/results/class-sheet", requireRole("school_owner", "headteacher"), asyncHandler(getClassResultSheet))
router.get("/results/sheet", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getResultSheet))
router.post("/results/draft", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(saveResultDraft))
router.post("/results/submit", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(submitResults))
router.post("/results/batches/:id/approve", requireRole("school_owner", "headteacher"), asyncHandler(approveResultBatch))
router.post("/results/batches/:id/return", requireRole("school_owner", "headteacher"), asyncHandler(returnResultBatch))
router.get("/reports", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listReports))
router.get("/users", requireRole("school_owner", "headteacher"), asyncHandler(listUsers))
router.post("/users", requireRole("school_owner", "headteacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.USERS_MANAGE), asyncHandler(createSchoolUser))
router.post("/users/:userRef/guardian-links", requireRole("school_owner", "headteacher"), requireSchoolPermission(SCHOOL_PERMISSIONS.USERS_MANAGE), asyncHandler(linkParentGuardian))
router.get("/users/:userRef/permissions", requireRole("school_owner"), asyncHandler(getUserPermissions))
router.put("/users/:userRef/permissions", requireRole("school_owner"), asyncHandler(updateUserPermissions))
router.get("/teachers", requireRole("school_owner", "headteacher"), asyncHandler(listTeachers))
router.post("/teachers", requireRole("school_owner", "headteacher"), asyncHandler(createTeacher))
router.get("/teachers/:id", requireRole("school_owner", "headteacher"), asyncHandler(getTeacher))
router.get("/search", requireRole("school_owner", "headteacher", "teacher", "bursar", "librarian"), requireSchoolPermission(SCHOOL_PERMISSIONS.AWARE_SEARCH), asyncHandler(quickSearch))
router.get("/teacher-assignments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTeacherAssignments))
router.post("/teacher-assignments", requireRole("school_owner", "headteacher"), asyncHandler(createTeacherAssignment))
router.patch("/teacher-assignments/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateTeacherAssignment))
router.delete("/teacher-assignments/:id", requireRole("school_owner", "headteacher"), asyncHandler(deactivateTeacherAssignment))
router.get("/teacher/today", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTeacherToday))
router.get("/teacher/today/lessons", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listLessonLogs))
router.get("/lesson-logs/suggestions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getLessonLogSuggestionsController))
router.get("/lesson-logs", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listLessonLogs))
router.post("/lesson-logs", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createLessonLog))
router.get("/lesson-logs/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getLessonLog))
router.patch("/lesson-logs/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateLessonLog))
router.post("/lesson-logs/:id/finalize", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(finalizeLessonLog))
router.post("/lesson-logs/:id/reopen", requireRole("school_owner", "headteacher"), asyncHandler(reopenLessonLog))
router.post("/lesson-logs/:id/cancel", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(cancelLessonLog))
router.get("/classes/:classId/subjects/:subjectId/lesson-history", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getClassLessonHistory))
router.get("/classes/:classId/subjects/:subjectId/coverage", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getClassSubjectCoverage))
router.get("/admin/academic/coverage", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAcademicCoverage))
router.get("/students", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listStudents))
router.get("/students/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getStudent))
router.get("/students/:studentId/withdrawals", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listStudentWithdrawalHistory))
router.post("/students/:studentId/withdrawals", requireRole("school_owner", "headteacher"), asyncHandler(createStudentWithdrawal))
router.patch("/students/:studentId/withdrawals/:withdrawalId/cancel", requireRole("school_owner", "headteacher"), asyncHandler(cancelStudentWithdrawal))
router.get("/students/:studentId/withdrawal-status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getStudentWithdrawalStatus))
router.patch("/students/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateStudent))
router.post("/students/photo", requireRole("school_owner", "headteacher"), asyncHandler(uploadStudentPhoto))
router.post("/students", requireRole("school_owner", "headteacher"), asyncHandler(createStudent))
router.get("/fees/dashboard", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(getBursarDashboard))
router.get("/fees", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listFeeAccounts))
router.get("/fees/accounts", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listFeeAccounts))
router.post("/fees/accounts/sync", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(syncFeeAccounts))
router.get("/fees/accounts/:id", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(getFeeAccount))
router.get("/fees/structures", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listFeeStructures))
router.post("/fees/structures", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(createFeeStructure))
router.post("/fees/structures/:id/apply", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(applyFeeStructure))
router.get("/fees/invoices", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listInvoices))
router.post("/fees/invoices/generate", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(generateInvoices))
router.get("/fees/payments", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listPayments))
router.post("/fees/payments", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(recordPayment))
router.get("/fees/payments/:id/receipt", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(getPaymentReceipt))
router.get("/fees/payments/:id/receipt.pdf", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(getPaymentReceiptPdf))
router.post("/fees/payments/:id/reverse", requireRole("school_owner", "headteacher"), asyncHandler(reversePayment))
router.get("/fees/arrears", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listArrears))
router.get("/fees/payment-plans", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listPaymentPlans))
router.post("/fees/payment-plans", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(createPaymentPlan))
router.get("/fees/discounts", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listDiscounts))
router.post("/fees/discounts", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(createDiscount))
router.post("/fees/discounts/:id/:action(approve|reject)", requireRole("school_owner", "headteacher"), asyncHandler(transitionDiscount))
router.get("/fees/expenses", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listExpenses))
router.post("/fees/expenses", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(createExpense))
router.post("/fees/expenses/:id/:action(approve|reject|pay)", requireRole("school_owner", "headteacher"), asyncHandler(transitionExpense))
router.get("/fees/reconciliation", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listReconciliation))
router.post("/fees/reconciliation/import", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(importBankTransactions))
router.post("/fees/reconciliation/:id/match", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(matchBankTransaction))
router.post("/fees/reconciliation/:id/:action(unmatch|ignore)", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(transitionBankTransaction))
router.get("/fees/reports", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(getFinanceReports))
router.get("/fees/audit", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listFinanceAuditLogs))
router.get("/attendance", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listAttendance))
router.post("/attendance", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(markAttendance))
router.get("/homework", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(listHomework))
router.post("/homework", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createHomework))
router.get("/messages", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listMessages))
router.post("/messages/image", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(uploadMessageImage))
router.post("/messages", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createMessage))
router.get("/assessments/setup", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAssessmentBuilderSetup))
router.get("/assessments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listAssessments))
router.post("/assessments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createAssessment))
router.get("/assessments/:id/export/pdf", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(exportAssessmentPdf))
router.get("/assessments/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAssessment))
router.put("/assessments/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(saveAssessmentDraft))
router.delete("/assessments/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(deleteAssessment))
router.post("/assessments/:id/media", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(uploadAssessmentMedia))
router.post("/assessments/:id/status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(transitionAssessmentStatus))
router.get("/assessment-insights", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(topicInsights))
router.get("/daily-drills", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(listDrills))
router.post("/drills/generate/class/:classId", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(generateDrillsForClass))
router.post("/drills/generate/:studentId?", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(generateDrillForStudent))
router.get("/drills/today/:studentId?", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(getTodayDrill))
router.post("/drills/:id/answer", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(answerDrillQuestion))
router.post("/drills/:id/submit", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(submitDrill))
router.get("/drills/history/:studentId?", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(getDrillHistory))
router.get("/drills/:id", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(getDrillSession))
router.post("/explanations/question/:questionId/adapt", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(adaptQuestionExplanation))
router.post("/explanations/question/:questionId/flag", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(flagQuestionExplanation))
router.post("/explanations/speech", requireRole("school_owner", "headteacher", "teacher", "student"), asyncHandler(synthesizeQuestionExplanationSpeech))
router.get("/teacher/classes/:classId/drill-insights", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getTeacherDrillInsights))
router.get("/guardian/students/:studentId/drill-summary", requireRole("school_owner", "headteacher", "teacher", "parent"), asyncHandler(getGuardianDrillSummary))
router.get("/exam-forecast", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listForecasts))

router.get("/internal/exam-lab/dashboard", requireRole("super_admin"), asyncHandler(getExamLabDashboard))
router.get("/internal/exam-lab/coverage", requireRole("super_admin"), asyncHandler(getExamLabCoverage))
router.patch("/internal/exam-lab/coverage", requireRole("super_admin"), asyncHandler(updateExamLabCoverageNote))
router.post("/internal/exam-lab/papers", requireRole("super_admin"), asyncHandler(uploadExamLabPaper))
router.post("/internal/exam-lab/papers/:paperId/extract", requireRole("super_admin"), asyncHandler(startExamLabExtraction))
router.get("/internal/exam-lab/papers/:paperId/review", requireRole("super_admin"), asyncHandler(getExamLabPaperReview))
router.patch("/internal/exam-lab/candidates/:candidateId", requireRole("super_admin"), asyncHandler(updateExamLabCandidate))
router.post("/internal/exam-lab/candidates/:candidateId/accept", requireRole("super_admin"), asyncHandler(acceptExamLabCandidate))
router.get("/internal/exam-lab/questions", requireRole("super_admin"), asyncHandler(listExamLabQuestions))
router.post("/internal/exam-lab/questions", requireRole("super_admin"), asyncHandler(createExamLabManualQuestion))
router.patch("/internal/exam-lab/questions/:questionId", requireRole("super_admin"), asyncHandler(updateExamLabQuestion))
router.post("/internal/exam-lab/questions/:questionId/archive", requireRole("super_admin"), asyncHandler(archiveExamLabQuestion))
router.get("/internal/exam-lab/topic-map", requireRole("super_admin"), asyncHandler(getExamLabTopicMap))
router.post("/internal/exam-lab/topics", requireRole("super_admin"), asyncHandler(saveExamLabTopic))
router.patch("/internal/exam-lab/topics/:id", requireRole("super_admin"), asyncHandler(saveExamLabTopic))
router.post("/internal/exam-lab/subtopics", requireRole("super_admin"), asyncHandler(saveExamLabSubtopic))
router.patch("/internal/exam-lab/subtopics/:id", requireRole("super_admin"), asyncHandler(saveExamLabSubtopic))
router.post("/internal/exam-lab/skills", requireRole("super_admin"), asyncHandler(saveExamLabSkill))
router.patch("/internal/exam-lab/skills/:id", requireRole("super_admin"), asyncHandler(saveExamLabSkill))
router.post("/internal/exam-lab/topic-map/:entityType/:id/archive", requireRole("super_admin"), asyncHandler(archiveExamLabTopicEntity))
router.post("/internal/exam-lab/mark-schemes", requireRole("super_admin"), asyncHandler(createExamLabMarkScheme))
router.get("/internal/exam-lab/backtests", requireRole("super_admin"), asyncHandler(listExamLabBacktests))
router.post("/internal/exam-lab/backtests", requireRole("super_admin"), asyncHandler(runExamLabBacktest))
router.get("/internal/exam-lab/reports", requireRole("super_admin"), asyncHandler(listExamLabPredictionReports))
router.post("/internal/exam-lab/reports", requireRole("super_admin"), asyncHandler(generateExamLabPredictionReport))
router.post("/internal/exam-lab/ai/suggest-tags", requireRole("super_admin"), asyncHandler(suggestExamLabQuestionTags))

router.get("/syllabus/setup", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(getSyllabusSetup))
router.get("/syllabus/uploads", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(listSyllabusUploads))
router.post("/syllabus/uploads", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(createSyllabusUpload))
router.delete("/syllabus/uploads/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(deleteSyllabusUpload))
router.post("/syllabus/uploads/:id/process", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(processSyllabusUpload))
router.get("/syllabus/uploads/:id/review", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(getSyllabusReview))
router.patch("/syllabus/extracted-items/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(updateExtractedItem))
router.post("/syllabus/extracted-items/approve-bulk", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(approveExtractedItems))
router.post("/syllabus/extracted-items/:id/approve", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(approveExtractedItem))
router.post("/syllabus/extracted-items/:id/reject", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(rejectExtractedItem))
router.post("/syllabus/extracted-items/:id/merge", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(mergeExtractedItem))
router.get("/syllabus/manual-entries", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(listManualSyllabusEntries))
router.get("/syllabus/manual-entries/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(getManualSyllabusEntry))
router.post("/syllabus/manual-entries", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(createManualSyllabusEntry))
router.patch("/syllabus/manual-entries/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(updateManualSyllabusEntry))
router.delete("/syllabus/manual-entries/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(deleteManualSyllabusEntry))
router.post("/syllabus/manual-entries/:id/approve", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(approveManualSyllabusEntry))
router.post("/syllabus/manual-entries/:id/reject", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(rejectManualSyllabusEntry))
router.get("/syllabus/topics", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(listSyllabusTopics))
router.post("/syllabus/topics", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(createSyllabusTopic))
router.patch("/syllabus/topics/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(updateSyllabusTopic))

router.get("/questions", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(listQuestions))
router.get("/assessment-templates", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(listTemplates))
router.post("/assessment-templates", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(createTemplate))
router.get("/assessment-templates/:templateRef", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(getTemplate))
router.patch("/assessment-templates/:templateRef", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(updateTemplate))
router.delete("/assessment-templates/:templateRef", requireRole("school_owner", "headteacher", "admin"), asyncHandler(deleteTemplate))
router.post("/assessment-templates/:templateRef/approve", requireRole("school_owner", "headteacher", "admin"), asyncHandler(approveTemplate))
router.post("/assessment-templates/:templateRef/archive", requireRole("school_owner", "headteacher", "admin"), asyncHandler(archiveTemplate))
router.post("/assessment-templates/:templateRef/set-default", requireRole("school_owner", "headteacher", "admin"), asyncHandler(setDefaultTemplate))
router.post("/assessment-templates/:templateRef/duplicate", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(duplicateTemplate))
router.post("/assessment-templates/:templateRef/apply-to-assessment", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(applyTemplate))
router.get("/assessment-templates/:templateRef/preview", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(templatePreview))
router.get("/assessment-template-settings", requireRole("school_owner", "headteacher", "teacher", "admin"), asyncHandler(getTemplateSettings))
router.patch("/assessment-template-settings", requireRole("school_owner", "headteacher", "admin"), asyncHandler(patchTemplateSettings))
router.post("/assessment-imports", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(createImport))
router.get("/assessment-imports", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(listImports))
router.get("/assessment-imports/:importRef", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(getImport))
router.post("/assessment-imports/:importRef/start", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(startImport))
router.get("/assessment-imports/:importRef/review", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(reviewImport))
router.patch("/assessment-imports/:importRef/questions/:questionRef", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(updateImportQuestion))
router.patch("/assessment-imports/:importRef/marking-items/:markingRef", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(updateImportMarking))
router.post("/assessment-imports/:importRef/link-answer", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(linkAnswer))
router.post("/assessment-imports/:importRef/approve", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(approveImport))
router.post("/assessment-imports/:importRef/cancel", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(cancelImport))
router.post("/assessment-imports/:importRef/extract-cover-template", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(extractImportCoverTemplate))
router.get("/assessment-imports/:importRef/template-candidates", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(importTemplateCandidates))
router.post("/assessment-imports/:importRef/match-cover-template", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(matchImportCoverTemplate))
router.post("/assessment-imports/:importRef/apply-template-match", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(applyImportTemplateMatch))
router.get("/assessment-imports/:importRef/pages/:documentType/:pageNumber/preview", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(pagePreview))
router.get("/assessment-imports/:importRef/assets/:assetRef/preview", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(assetPreview))
router.post("/assessment-imports/:importRef/extract-images", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(extractImages))
router.get("/assessment-imports/:importRef/images", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(listImages))
router.patch("/assessment-imports/:importRef/images/:assetRef", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(updateImage))
router.delete("/assessment-imports/:importRef/images/:assetRef", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher", "admin"), asyncHandler(deleteImage))
router.post("/questions", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(createQuestion))
router.post("/questions/source-assessments", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(sourceAssessmentQuestions))
router.post("/questions/generate-draft", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(generateDraftQuestionBatch))
router.get("/questions/batches/:id/review", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(getQuestionBatchReview))
router.patch("/questions/:id", requireRole("super_admin", "school_owner", "owner", "director", "headteacher", "teacher"), asyncHandler(updateQuestion))
router.post("/questions/:id/approve", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(approveQuestion))
router.post("/questions/:id/reject", requireRole("super_admin", "school_owner", "owner", "director", "headteacher"), asyncHandler(rejectQuestion))

export default router

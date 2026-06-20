import { Router } from "express"
import authRoutes from "./auth.routes.js"
import { getDashboard } from "../controllers/dashboardController.js"
import { listStudents, getStudent, createStudent, uploadStudentPhoto } from "../controllers/studentsController.js"
import { listFeeAccounts, recordPayment } from "../controllers/feesController.js"
import { listAttendance, markAttendance } from "../controllers/attendanceController.js"
import { listHomework, createHomework } from "../controllers/homeworkController.js"
import { listMessages, createMessage, uploadMessageImage } from "../controllers/messagesController.js"
import { getStudentPortal, reactToAnnouncement, voteAnnouncementPoll } from "../controllers/studentPortalController.js"
import {
  createAssessment,
  getAssessment,
  getAssessmentBuilderSetup,
  listAssessments,
  saveAssessmentDraft,
  topicInsights,
  transitionAssessmentStatus,
  uploadAssessmentMedia,
} from "../controllers/assessmentController.js"
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
  generateDrillForStudent,
  getDrillSession,
  getDrillHistory,
  getGuardianDrillSummary,
  getTeacherDrillInsights,
  getTodayDrill,
  submitDrill,
} from "../controllers/drillsController.js"
import { listForecasts } from "../controllers/forecastController.js"
import { getAiStatusController, getAiUsageSummaryController, testAiController, updateAiSettingsController } from "../controllers/aiController.js"
import {
  approveExtractedItem,
  approveManualSyllabusEntry,
  createSyllabusTopic,
  createSyllabusUpload,
  createManualSyllabusEntry,
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
  updateQuestion,
} from "../controllers/questionsController.js"
import { adaptQuestionExplanation, flagQuestionExplanation, synthesizeQuestionExplanationSpeech } from "../controllers/explanationsController.js"
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
  createSubject,
  deleteSubject,
  getClass,
  listClasses,
  listParents,
  listReports,
  listResults,
  listSubjects,
  listUsers,
  quickSearch,
  updateSubject,
} from "../controllers/schoolDataController.js"
import { requireAuth, requirePasswordReady, requireRole } from "../middleware/auth.js"
import { asyncHandler } from "../utils/http.js"

const router = Router()

router.use("/auth", authRoutes)
router.use(requireAuth)
router.use(requirePasswordReady)

router.get("/dashboard", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(getDashboard))
router.get("/student-portal", requireRole("student"), asyncHandler(getStudentPortal))
router.post("/student-portal/announcements/:id/reaction", requireRole("student"), asyncHandler(reactToAnnouncement))
router.post("/student-portal/announcements/:id/vote", requireRole("student"), asyncHandler(voteAnnouncementPoll))
router.get("/ai/status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAiStatusController))
router.post("/ai/test", requireRole("school_owner", "headteacher"), asyncHandler(testAiController))
router.get("/ai/usage-summary", requireRole("school_owner", "headteacher"), asyncHandler(getAiUsageSummaryController))
router.patch("/ai/settings", requireRole("school_owner", "headteacher"), asyncHandler(updateAiSettingsController))
router.get("/classes", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(listClasses))
router.post("/classes", requireRole("school_owner", "headteacher"), asyncHandler(createClass))
router.get("/classes/:id", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(getClass))
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
router.get("/report-cards/:id/pdf", requireRole("school_owner", "headteacher", "teacher", "bursar", "student"), asyncHandler(getReportCardPdf))
router.get("/report-cards/:id", requireRole("school_owner", "headteacher", "teacher", "bursar", "student"), asyncHandler(getReportCard))
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
router.get("/reports", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(listReports))
router.get("/users", requireRole("school_owner", "headteacher"), asyncHandler(listUsers))
router.get("/teachers", requireRole("school_owner", "headteacher"), asyncHandler(listTeachers))
router.post("/teachers", requireRole("school_owner", "headteacher"), asyncHandler(createTeacher))
router.get("/teachers/:id", requireRole("school_owner", "headteacher"), asyncHandler(getTeacher))
router.get("/search", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(quickSearch))
router.get("/teacher-assignments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listTeacherAssignments))
router.post("/teacher-assignments", requireRole("school_owner", "headteacher"), asyncHandler(createTeacherAssignment))
router.patch("/teacher-assignments/:id", requireRole("school_owner", "headteacher"), asyncHandler(updateTeacherAssignment))
router.delete("/teacher-assignments/:id", requireRole("school_owner", "headteacher"), asyncHandler(deactivateTeacherAssignment))
router.get("/students", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(listStudents))
router.get("/students/:id", requireRole("school_owner", "headteacher", "teacher", "bursar"), asyncHandler(getStudent))
router.post("/students/photo", requireRole("school_owner", "headteacher"), asyncHandler(uploadStudentPhoto))
router.post("/students", requireRole("school_owner", "headteacher"), asyncHandler(createStudent))
router.get("/fees", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(listFeeAccounts))
router.post("/fees/payments", requireRole("school_owner", "headteacher", "bursar"), asyncHandler(recordPayment))
router.get("/attendance", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listAttendance))
router.post("/attendance", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(markAttendance))
router.get("/homework", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(listHomework))
router.post("/homework", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createHomework))
router.get("/messages", requireRole("school_owner", "headteacher", "bursar", "teacher"), asyncHandler(listMessages))
router.post("/messages/image", requireRole("school_owner", "headteacher", "bursar", "teacher"), asyncHandler(uploadMessageImage))
router.post("/messages", requireRole("school_owner", "headteacher", "bursar", "teacher"), asyncHandler(createMessage))
router.get("/assessments/setup", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAssessmentBuilderSetup))
router.get("/assessments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listAssessments))
router.post("/assessments", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createAssessment))
router.get("/assessments/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getAssessment))
router.put("/assessments/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(saveAssessmentDraft))
router.post("/assessments/:id/media", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(uploadAssessmentMedia))
router.post("/assessments/:id/status", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(transitionAssessmentStatus))
router.get("/assessment-insights", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(topicInsights))
router.get("/daily-drills", requireRole("school_owner", "headteacher", "teacher", "parent", "student"), asyncHandler(listDrills))
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

router.get("/syllabus/setup", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSyllabusSetup))
router.get("/syllabus/uploads", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSyllabusUploads))
router.post("/syllabus/uploads", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createSyllabusUpload))
router.post("/syllabus/uploads/:id/process", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(processSyllabusUpload))
router.get("/syllabus/uploads/:id/review", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getSyllabusReview))
router.patch("/syllabus/extracted-items/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateExtractedItem))
router.post("/syllabus/extracted-items/:id/approve", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(approveExtractedItem))
router.post("/syllabus/extracted-items/:id/reject", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(rejectExtractedItem))
router.post("/syllabus/extracted-items/:id/merge", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(mergeExtractedItem))
router.get("/syllabus/manual-entries", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listManualSyllabusEntries))
router.get("/syllabus/manual-entries/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getManualSyllabusEntry))
router.post("/syllabus/manual-entries", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createManualSyllabusEntry))
router.patch("/syllabus/manual-entries/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateManualSyllabusEntry))
router.post("/syllabus/manual-entries/:id/approve", requireRole("school_owner", "headteacher"), asyncHandler(approveManualSyllabusEntry))
router.post("/syllabus/manual-entries/:id/reject", requireRole("school_owner", "headteacher"), asyncHandler(rejectManualSyllabusEntry))
router.get("/syllabus/topics", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listSyllabusTopics))
router.post("/syllabus/topics", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createSyllabusTopic))
router.patch("/syllabus/topics/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateSyllabusTopic))

router.get("/questions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(listQuestions))
router.post("/questions", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(createQuestion))
router.post("/questions/generate-draft", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(generateDraftQuestionBatch))
router.get("/questions/batches/:id/review", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(getQuestionBatchReview))
router.patch("/questions/:id", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(updateQuestion))
router.post("/questions/:id/approve", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(approveQuestion))
router.post("/questions/:id/reject", requireRole("school_owner", "headteacher", "teacher"), asyncHandler(rejectQuestion))

export default router

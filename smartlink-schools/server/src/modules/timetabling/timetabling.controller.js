import {
  approveVersion,
  archiveTimetable,
  createEntry,
  createTimetable,
  createVersion,
  getAudit,
  getFocusReport,
  getGenerationJob,
  getReadiness,
  getStreamRuleReport,
  getTimetableById,
  getTimetableSetupOptions,
  getVersionById,
  listConflicts,
  listTimetables,
  listVersions,
  publishVersion,
  requestChanges,
  submitForReview,
  updateTimetableSetup,
  validateEntry,
} from "./timetabling.service.js"
import {
  allocateExamRoomsWithSolver,
  allocateInvigilatorsWithSolver,
  cancelGenerationJob,
  completeWithSolver,
  findSolverAlternatives,
  generateExamTimetable,
  getSolverHealth,
  startSolverGeneration,
} from "./solverGeneration.service.js"

async function send(res, payload, status = 200) {
  res.status(status).json(payload)
}

export async function listTimetablesController(req, res) {
  return send(res, await listTimetables(req))
}

export async function getTimetableSetupOptionsController(req, res) {
  return send(res, await getTimetableSetupOptions(req))
}

export async function createTimetableController(req, res) {
  return send(res, await createTimetable(req), 201)
}

export async function getTimetableController(req, res) {
  return send(res, await getTimetableById(req))
}

export async function updateTimetableSetupController(req, res) {
  return send(res, await updateTimetableSetup(req))
}

export async function archiveTimetableController(req, res) {
  return send(res, await archiveTimetable(req))
}

export async function listTimetableVersionsController(req, res) {
  return send(res, await listVersions(req))
}

export async function createTimetableVersionController(req, res) {
  return send(res, await createVersion(req), 201)
}

export async function cloneTimetableVersionController(req, res) {
  req.body = { ...(req.body || {}), parent_version_id: req.params.versionId, creation_method: "CLONED" }
  return send(res, await createVersion(req), 201)
}

export async function getTimetableVersionController(req, res) {
  return send(res, await getVersionById(req))
}

export async function getTimetableReadinessController(req, res) {
  return send(res, await getReadiness(req))
}

export async function getTimetableFocusReportController(req, res) {
  return send(res, await getFocusReport(req))
}

export async function getTimetableStreamRuleReportController(req, res) {
  return send(res, await getStreamRuleReport(req))
}

export async function validateTimetableEntryController(req, res) {
  return send(res, await validateEntry(req))
}

export async function createTimetableEntryController(req, res) {
  return send(res, await createEntry(req), 201)
}

export async function listTimetableConflictsController(req, res) {
  return send(res, await listConflicts(req))
}

export async function submitTimetableReviewController(req, res) {
  return send(res, await submitForReview(req))
}

export async function requestTimetableChangesController(req, res) {
  return send(res, await requestChanges(req))
}

export async function approveTimetableVersionController(req, res) {
  return send(res, await approveVersion(req))
}

export async function publishTimetableVersionController(req, res) {
  return send(res, await publishVersion(req))
}

export async function startTimetableGenerationController(req, res) {
  return send(res, await startSolverGeneration(req), 202)
}

export async function completeTimetableWithSolverController(req, res) {
  return send(res, await completeWithSolver(req), 202)
}

export async function generateExamTimetableController(req, res) {
  return send(res, await generateExamTimetable(req), 202)
}

export async function allocateExamRoomsController(req, res) {
  return send(res, await allocateExamRoomsWithSolver(req))
}

export async function allocateInvigilatorsController(req, res) {
  return send(res, await allocateInvigilatorsWithSolver(req))
}

export async function findTimetableAlternativesController(req, res) {
  return send(res, await findSolverAlternatives(req))
}

export async function cancelTimetableGenerationJobController(req, res) {
  return send(res, await cancelGenerationJob(req))
}

export async function timetableSolverHealthController(_req, res) {
  return send(res, await getSolverHealth())
}

export async function getTimetableGenerationJobController(req, res) {
  return send(res, await getGenerationJob(req))
}

export async function listTimetableAuditController(req, res) {
  return send(res, await getAudit(req))
}

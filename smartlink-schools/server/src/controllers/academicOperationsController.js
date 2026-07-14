import { getScopedSchoolId } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import {
  approveTargetedAssessment,
  confirmTargetedLearners,
  createTargetedAssessmentDraft,
  generateTargetedAssessment,
  getAcademicMarkSheet,
  getAssessmentOperationalIntelligence,
  getTargetedAssessment,
  listAuthoringTopics,
  listTargetedAssessments,
  publishAcademicMarkSheet,
  reopenAcademicMarkSheet,
  publishTargetedAssessment,
  replaceTargetedAssessmentQuestion,
  saveAcademicMarkSheetDraft,
  saveQuestionMappings,
  saveTargetedAssessmentReview,
  updateQuestionSourcePermission,
  validateGeneratedAssessmentDraft,
} from "../services/academicOperationsService.js"

const assessmentId = (req) => {
  const id = Number(req.params.assessmentId || req.params.id || 0)
  if (!id) throw new HttpError(400, "Assessment id is required.")
  return id
}

export async function academicAuthoringTopics(req, res) {
  res.json(await listAuthoringTopics(getScopedSchoolId(req), req.query))
}

export async function putQuestionMappings(req, res) {
  res.json(await saveQuestionMappings(getScopedSchoolId(req), assessmentId(req), Number(req.params.questionId || 0), req.user, req.body || {}))
}

export async function academicMarkSheet(req, res) {
  res.json(await getAcademicMarkSheet(getScopedSchoolId(req), assessmentId(req), req.query, req.user))
}

export async function postAcademicMarkSheetDraft(req, res) {
  res.json(await saveAcademicMarkSheetDraft(getScopedSchoolId(req), assessmentId(req), req.user, req.body || {}))
}

export async function postAcademicMarkSheetPublish(req, res) {
  res.json(await publishAcademicMarkSheet(getScopedSchoolId(req), assessmentId(req), req.user, req.body || {}))
}

export async function postAcademicMarkSheetReopen(req, res) {
  res.json(await reopenAcademicMarkSheet(getScopedSchoolId(req), assessmentId(req), req.user, req.body || {}))
}

export async function assessmentOperationalIntelligence(req, res) {
  res.json(await getAssessmentOperationalIntelligence(getScopedSchoolId(req), assessmentId(req), req.user))
}

export async function targetedAssessments(req, res) {
  res.json(await listTargetedAssessments(getScopedSchoolId(req), req.query, req.user))
}

export async function postTargetedAssessment(req, res) {
  res.status(201).json(await createTargetedAssessmentDraft(getScopedSchoolId(req), req.user, req.body || {}))
}

export async function targetedAssessment(req, res) {
  res.json(await getTargetedAssessment(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user))
}

export async function postTargetedAssessmentGenerate(req, res) {
  res.json(await generateTargetedAssessment(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user, req.body || {}))
}

export async function putTargetedAssessmentReview(req, res) {
  res.json(await saveTargetedAssessmentReview(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user, req.body || {}))
}

export async function postTargetedAssessmentReplacement(req, res) {
  res.json(await replaceTargetedAssessmentQuestion(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user, req.body || {}))
}

export async function postTargetedLearnerConfirmation(req, res) {
  res.json(await confirmTargetedLearners(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user, req.body || {}))
}

export async function validateTargetedAssessment(req, res) {
  const record = await getTargetedAssessment(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user)
  const validation = validateGeneratedAssessmentDraft(record.version?.paper || {}, { totalMarks: record.assessment.total_marks })
  res.status(validation.valid ? 200 : 409).json({ validation })
}

export async function postTargetedAssessmentApproval(req, res) {
  res.json(await approveTargetedAssessment(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user))
}

export async function postTargetedAssessmentPublish(req, res) {
  res.json(await publishTargetedAssessment(getScopedSchoolId(req), String(req.params.generatedRef || ""), req.user))
}

export async function patchQuestionPermission(req, res) {
  res.json(await updateQuestionSourcePermission(getScopedSchoolId(req), String(req.params.questionRef || ""), req.user, req.body || {}))
}


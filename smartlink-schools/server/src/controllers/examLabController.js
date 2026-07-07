import {
  acceptCandidate,
  aiPlaceholder,
  archiveQuestion,
  archiveTopicEntity,
  createManualQuestion,
  createMarkScheme,
  createPaperUpload,
  generatePredictionReport,
  getCoverage,
  getDashboard,
  getPaperReview,
  listBacktests,
  listPredictionReports,
  listQuestions,
  listTopicMap,
  runBacktest,
  runExtraction,
  saveSkill,
  saveSubtopic,
  saveTopic,
  updateCandidate,
  updateCoverageNote,
  updateQuestion,
} from "../services/examLab/examLabService.js"

function scopeFromRequest(req) {
  return {
    exam_board: req.query.exam_board || req.query.examBoard || req.body?.exam_board || req.body?.examBoard,
    exam_level: req.query.exam_level || req.query.examLevel || req.body?.exam_level || req.body?.examLevel,
    subject: req.query.subject || req.body?.subject,
  }
}

export async function getExamLabDashboard(req, res) {
  const payload = await getDashboard(scopeFromRequest(req), req.query)
  res.json(payload)
}

export async function getExamLabCoverage(req, res) {
  const payload = await getCoverage(scopeFromRequest(req), req.query)
  res.json(payload)
}

export async function updateExamLabCoverageNote(req, res) {
  const payload = await updateCoverageNote(req.user.id, req.body)
  res.json(payload)
}

export async function uploadExamLabPaper(req, res) {
  const payload = await createPaperUpload(req.user.id, req.body)
  res.status(201).json(payload)
}

export async function startExamLabExtraction(req, res) {
  const payload = await runExtraction(req.user.id, Number(req.params.paperId || req.params.paper_id || 0), req.body)
  res.json(payload)
}

export async function getExamLabPaperReview(req, res) {
  const payload = await getPaperReview(Number(req.params.paperId || req.params.paper_id || 0))
  res.json(payload)
}

export async function updateExamLabCandidate(req, res) {
  const payload = await updateCandidate(req.user.id, Number(req.params.candidateId || req.params.candidate_id || 0), req.body)
  res.json(payload)
}

export async function acceptExamLabCandidate(req, res) {
  const payload = await acceptCandidate(req.user.id, Number(req.params.candidateId || req.params.candidate_id || 0), req.body)
  res.json(payload)
}

export async function listExamLabQuestions(req, res) {
  const payload = await listQuestions({ ...req.query, ...scopeFromRequest(req) })
  res.json(payload)
}

export async function createExamLabManualQuestion(req, res) {
  const payload = await createManualQuestion(req.user.id, req.body)
  res.status(201).json(payload)
}

export async function updateExamLabQuestion(req, res) {
  const payload = await updateQuestion(req.user.id, Number(req.params.questionId || req.params.question_id || 0), req.body)
  res.json(payload)
}

export async function archiveExamLabQuestion(req, res) {
  const payload = await archiveQuestion(req.user.id, Number(req.params.questionId || req.params.question_id || 0))
  res.json(payload)
}

export async function getExamLabTopicMap(req, res) {
  const payload = await listTopicMap(scopeFromRequest(req))
  res.json(payload)
}

export async function saveExamLabTopic(req, res) {
  const payload = await saveTopic(req.user.id, { ...req.body, id: req.params.id || req.body?.id })
  res.status(req.params.id || req.body?.id || req.body?.topic_id ? 200 : 201).json(payload)
}

export async function saveExamLabSubtopic(req, res) {
  const payload = await saveSubtopic({ ...req.body, id: req.params.id || req.body?.id })
  res.status(req.params.id || req.body?.id || req.body?.subtopic_id ? 200 : 201).json(payload)
}

export async function saveExamLabSkill(req, res) {
  const payload = await saveSkill({ ...req.body, id: req.params.id || req.body?.id })
  res.status(req.params.id || req.body?.id || req.body?.skill_id ? 200 : 201).json(payload)
}

export async function archiveExamLabTopicEntity(req, res) {
  const payload = await archiveTopicEntity(req.user.id, req.params.entityType, Number(req.params.id || 0))
  res.json(payload)
}

export async function createExamLabMarkScheme(req, res) {
  const payload = await createMarkScheme(req.user.id, req.body)
  res.status(201).json(payload)
}

export async function listExamLabBacktests(req, res) {
  const payload = await listBacktests(scopeFromRequest(req))
  res.json(payload)
}

export async function runExamLabBacktest(req, res) {
  const payload = await runBacktest(req.user.id, req.body)
  res.status(201).json(payload)
}

export async function listExamLabPredictionReports(req, res) {
  const payload = await listPredictionReports(scopeFromRequest(req))
  res.json(payload)
}

export async function generateExamLabPredictionReport(req, res) {
  const payload = await generatePredictionReport(req.user.id, req.body)
  res.status(201).json(payload)
}

export async function suggestExamLabQuestionTags(_req, res) {
  res.json(aiPlaceholder())
}

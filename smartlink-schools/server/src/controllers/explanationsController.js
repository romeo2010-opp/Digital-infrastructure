import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { adaptExplanation, normalizeExplanationMode } from "../services/explanations/explanationService.js"
import { synthesizeExplanationSpeech } from "../services/explanations/ttsService.js"

export async function adaptQuestionExplanation(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionId = Number(req.params.id || req.params.questionId || 0)
  if (!questionId) throw new HttpError(400, "Question is required")
  const [[question]] = await pool.query(
    `SELECT q.*, qe.explanation_text AS approved_explanation, gl.name AS grade_name, st.topic_name
     FROM question_bank q
     LEFT JOIN question_explanations qe ON qe.question_id = q.id AND qe.approval_status = 'approved'
     LEFT JOIN grade_levels gl ON gl.id = q.grade_id AND gl.school_id = q.school_id
     LEFT JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
     WHERE q.school_id = ? AND q.id = ? AND q.approval_status = 'approved'
     ORDER BY FIELD(qe.explanation_type, 'basic', 'simple', 'step_by_step') LIMIT 1`,
    [schoolId, questionId],
  )
  if (!question) throw new HttpError(404, "Approved question was not found")
  const mode = normalizeExplanationMode(req.body.mode || "simple")
  const result = await adaptExplanation({
    question,
    studentAnswer: req.body.student_answer || "",
    mode,
    masteryLabel: req.body.mastery_label || "developing",
    schoolId,
    userId: req.user.role === "student" ? null : req.user.id,
  })
  const [logResult] = await pool.query(
    `INSERT INTO ai_explanation_logs (
      school_id, student_id, question_id, drill_session_id, ai_model_used, prompt_context_json, ai_response
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      req.user.role === "student" ? Number(req.user.studentId || req.user.id) : req.body.student_id || null,
      questionId,
      req.body.drill_session_id || null,
      result.model || null,
      JSON.stringify({ mode, grounded_question_id: questionId, grade: question.grade_name || null, topic: question.topic_name || null }),
      result.data.explanation_text,
    ],
  )
  res.json({
    approved_explanation: question.approved_explanation || question.explanation || "",
    explanation: result.data,
    log_id: Number(logResult.insertId || 0),
    ai: { ok: result.ok, message: result.message || null, model: result.model || null },
  })
}

export async function flagQuestionExplanation(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionId = Number(req.params.id || req.params.questionId || 0)
  const logId = Number(req.body.log_id || req.body.logId || 0)
  const feedback = ["helpful", "not_helpful", "flagged"].includes(String(req.body.feedback))
    ? String(req.body.feedback)
    : "flagged"
  const params = logId
    ? [feedback, schoolId, questionId, logId]
    : [feedback, schoolId, questionId]
  const [result] = await pool.query(
    `UPDATE ai_explanation_logs
     SET user_feedback = ?
     WHERE school_id = ? AND question_id = ?
      ${logId ? "AND id = ?" : ""}
     ORDER BY id DESC
     LIMIT 1`,
    params,
  )
  if (!result.affectedRows) throw new HttpError(404, "AI explanation log was not found")
  res.json({ ok: true })
}

export async function synthesizeQuestionExplanationSpeech(req, res) {
  const schoolId = getScopedSchoolId(req)
  const text = String(req.body.text || req.body.explanation_text || req.body.explanationText || "").trim()
  if (!text) throw new HttpError(400, "Explanation text is required")
  const result = await synthesizeExplanationSpeech({
    text,
    schoolId,
    userId: req.user.role === "student" ? null : req.user.id,
    gradeName: req.body.grade_name || req.body.gradeName || "",
  })
  if (!result.ok) {
    throw new HttpError(result.blocked ? 429 : 503, result.message || "Neural text to speech is unavailable")
  }
  res.json(result)
}

import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { generateDraftQuestions } from "../services/questions/questionDraftingService.js"

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

function normalizeJsonArray(value) {
  if (!value) return null
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === "string") {
    const parsed = parseJson(value, null)
    if (Array.isArray(parsed)) return JSON.stringify(parsed)
    return JSON.stringify(value.split(/\n|,/).map((row) => row.trim()).filter(Boolean))
  }
  return JSON.stringify([])
}

async function loadApprovedSyllabusContext(connection, schoolId, { gradeId, subjectId, topicId, subtopicId }) {
  const topicIds = [topicId, subtopicId].filter(Boolean)
  const [topics] = topicIds.length
    ? await connection.query(
        `SELECT st.id, st.topic_name, st.description, st.term, parent.topic_name AS parent_topic_name
         FROM syllabus_topics st
         LEFT JOIN syllabus_topics parent ON parent.id = st.parent_topic_id AND parent.school_id = st.school_id
         WHERE st.school_id = ? AND st.subject_id = ? AND st.is_active = 1
          AND st.id IN (${topicIds.map(() => "?").join(",")})
         ORDER BY FIELD(st.id, ${topicIds.map(() => "?").join(",")})`,
        [schoolId, subjectId, ...topicIds, ...topicIds],
      )
    : [[]]

  const [objectives] = topicIds.length
    ? await connection.query(
        `SELECT lo.topic_id, lo.objective_text, lo.skill_type, lo.exam_relevance
         FROM learning_objectives lo
         JOIN syllabus_topics st ON st.id = lo.topic_id AND st.school_id = ?
         WHERE lo.topic_id IN (${topicIds.map(() => "?").join(",")})
         ORDER BY lo.id
         LIMIT 30`,
        [schoolId, ...topicIds],
      )
    : [[]]

  const [chunks] = await connection.query(
    `SELECT DISTINCT sdc.chunk_index, sdc.chunk_text, sdc.source_filename
     FROM syllabus_document_chunks sdc
     JOIN syllabus_uploads su ON su.id = sdc.upload_id AND su.school_id = sdc.school_id
     WHERE sdc.school_id = ?
       AND sdc.subject_id = ?
       AND (sdc.grade_id <=> ? OR sdc.grade_id IS NULL)
       AND EXISTS (
        SELECT 1
        FROM syllabus_extracted_items sei
        WHERE sei.school_id = sdc.school_id
          AND sei.upload_id = sdc.upload_id
          AND sei.status IN ('approved', 'merged')
          AND sei.merged_into_topic_id IN (${topicIds.length ? topicIds.map(() => "?").join(",") : "NULL"})
       )
     ORDER BY sdc.chunk_index
     LIMIT 6`,
    [schoolId, subjectId, gradeId || null, ...topicIds],
  )

  return {
    approved_topics: topics,
    approved_objectives: objectives,
    approved_chunks: chunks.map((chunk) => ({
      chunk_index: Number(chunk.chunk_index),
      source_filename: chunk.source_filename,
      chunk_text: String(chunk.chunk_text || "").slice(0, 4500),
    })),
  }
}

async function validateQuestionApproval(connection, schoolId, questionId) {
  const [[question]] = await connection.query(
    `SELECT q.*, COUNT(qe.id) AS approved_explanations
     FROM question_bank q
     LEFT JOIN question_explanations qe ON qe.question_id = q.id AND qe.approval_status = 'approved'
     WHERE q.school_id = ? AND q.id = ?
     GROUP BY q.id
     LIMIT 1`,
    [schoolId, questionId],
  )
  if (!question) throw new HttpError(404, "Question was not found")
  const missing = []
  if (!question.correct_answer) missing.push("correct answer")
  if (!question.explanation && Number(question.approved_explanations || 0) === 0) missing.push("explanation")
  if (!question.topic_id) missing.push("topic")
  if (!question.grade_id) missing.push("grade")
  if (!question.subject_id) missing.push("subject")
  if (missing.length) throw new HttpError(400, `Question cannot be approved yet. Missing: ${missing.join(", ")}.`)
  return question
}

export async function listQuestions(req, res) {
  const schoolId = getScopedSchoolId(req)
  const filters = []
  const params = [schoolId]
  if (req.query.grade_id) { filters.push("q.grade_id = ?"); params.push(Number(req.query.grade_id)) }
  if (req.query.subject_id) { filters.push("q.subject_id = ?"); params.push(Number(req.query.subject_id)) }
  if (req.query.topic_id) { filters.push("q.topic_id = ?"); params.push(Number(req.query.topic_id)) }
  if (req.query.approval_status) { filters.push("q.approval_status = ?"); params.push(String(req.query.approval_status)) }
  const [questions] = await pool.query(
    `SELECT q.*, subj.name AS subject_name, gl.name AS grade_name, st.topic_name, sub.topic_name AS subtopic_name,
      gqbi.batch_id
     FROM question_bank q
     JOIN subjects subj ON subj.id = q.subject_id AND subj.school_id = q.school_id
     LEFT JOIN grade_levels gl ON gl.id = q.grade_id AND gl.school_id = q.school_id
     LEFT JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
     LEFT JOIN syllabus_topics sub ON sub.id = q.subtopic_id AND sub.school_id = q.school_id
     LEFT JOIN generated_question_batch_items gqbi ON gqbi.question_id = q.id
     WHERE q.school_id = ?${filters.length ? ` AND ${filters.join(" AND ")}` : ""}
     ORDER BY q.updated_at DESC
     LIMIT 250`,
    params,
  )
  res.json({
    questions: questions.map((row) => ({
      ...row,
      options_json: parseJson(row.options_json, []),
      accepted_answers_json: parseJson(row.accepted_answers_json, []),
    })),
  })
}

export async function createQuestion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionText = cleanText(req.body.question_text)
  const subjectId = Number(req.body.subject_id || 0)
  const topicId = Number(req.body.topic_id || 0)
  if (!questionText || !subjectId || !topicId) throw new HttpError(400, "Question text, subject and topic are required")
  const [result] = await pool.query(
    `INSERT INTO question_bank (
      school_id, curriculum_id, grade_id, subject_id, topic_id, subtopic_id, question_type, question_text,
      options_json, correct_answer, accepted_answers_json, explanation, difficulty, skill_type, marks,
      common_mistake, confidence, source_type, approval_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      req.body.curriculum_id || null,
      req.body.grade_id || null,
      subjectId,
      topicId,
      req.body.subtopic_id || null,
      req.body.question_type || "multiple_choice",
      questionText,
      req.body.options_json ? JSON.stringify(req.body.options_json) : normalizeJsonArray(req.body.options),
      cleanText(req.body.correct_answer) || null,
      normalizeJsonArray(req.body.accepted_answers || req.body.accepted_answers_json),
      cleanText(req.body.explanation) || null,
      req.body.difficulty || "easy",
      cleanText(req.body.skill_type) || null,
      Number(req.body.marks || 1),
      cleanText(req.body.common_mistake) || null,
      req.body.confidence === undefined ? null : Number(req.body.confidence || 0),
      req.body.source_type || "teacher_created",
      req.body.approval_status || "draft",
      req.user.id,
    ],
  )
  res.status(201).json({ question_id: Number(result.insertId), ok: true })
}

export async function generateDraftQuestionBatch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const topicId = Number(req.body.topic_id || 0)
  const subjectId = Number(req.body.subject_id || 0)
  if (!topicId || !subjectId) throw new HttpError(400, "Subject and topic are required")
  const [[topic]] = await pool.query(
    `SELECT st.*, subj.name AS subject_name, gl.name AS grade_name, c.name AS curriculum_name
     FROM syllabus_topics st
     JOIN subjects subj ON subj.id = st.subject_id AND subj.school_id = st.school_id
     LEFT JOIN grade_levels gl ON gl.id = st.grade_id AND gl.school_id = st.school_id
     LEFT JOIN curricula c ON c.id = st.curriculum_id AND c.school_id = st.school_id
     WHERE st.school_id = ? AND st.id = ?
     LIMIT 1`,
    [schoolId, topicId],
  )
  if (!topic) throw new HttpError(404, "Topic was not found")
  const numberRequested = Math.max(1, Math.min(20, Number(req.body.number_of_questions || req.body.number_requested || 5)))
  const context = {
    curriculum: req.body.curriculum || topic.curriculum_name || "Cambridge Primary Curriculum",
    gradeName: topic.grade_name,
    subjectName: topic.subject_name,
    topicName: topic.topic_name,
    subtopicName: "",
    difficulty: req.body.difficulty || "easy",
    questionType: req.body.question_type || "multiple_choice",
    numberOfQuestions: numberRequested,
    examTrack: req.body.exam_track || "",
    languageLevel: req.body.language_level || "",
    includeExplanations: req.body.include_explanations !== false,
    schoolId,
    userId: req.user.id,
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    context.approvedSyllabusContext = await loadApprovedSyllabusContext(connection, schoolId, {
      gradeId: req.body.grade_id || topic.grade_id || null,
      subjectId,
      topicId,
      subtopicId: req.body.subtopic_id || null,
    })
    if (req.body.subtopic_id) {
      const subtopic = context.approvedSyllabusContext.approved_topics.find((row) => Number(row.id) === Number(req.body.subtopic_id))
      context.subtopicName = subtopic?.topic_name || ""
    }
    const [batchResult] = await connection.query(
      `INSERT INTO generated_question_batches (
        school_id, teacher_id, grade_id, subject_id, topic_id, subtopic_id, number_requested,
        difficulty, question_type, status, generation_prompt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?)`,
      [
        schoolId,
        req.user.id,
        req.body.grade_id || topic.grade_id || null,
        subjectId,
        topicId,
        req.body.subtopic_id || null,
        numberRequested,
        context.difficulty,
        context.questionType,
        JSON.stringify(context),
      ],
    )
    const batchId = Number(batchResult.insertId)
    const generated = await generateDraftQuestions(context)
    if (generated.blocked) throw new HttpError(429, generated.message)
    if (generated.unavailable || !generated.ok) {
      throw new HttpError(409, generated.message || "AI assistance is not configured yet. Upload, review, and manual approval features are still available.")
    }
    for (const question of generated.data.questions || []) {
      const [questionResult] = await connection.query(
        `INSERT INTO question_bank (
          school_id, curriculum_id, grade_id, subject_id, topic_id, subtopic_id, question_type,
          question_text, options_json, correct_answer, accepted_answers_json, explanation,
          common_mistake, difficulty, skill_type, marks, confidence, source_type, approval_status, created_by, ai_model_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 'pending_review', ?, ?)`,
        [
          schoolId,
          topic.curriculum_id || null,
          req.body.grade_id || topic.grade_id || null,
          subjectId,
          topicId,
          req.body.subtopic_id || null,
          question.question_type,
          question.question_text,
          JSON.stringify(question.options || []),
          question.correct_answer,
          JSON.stringify(question.accepted_answers || []),
          question.explanation,
          question.common_mistake || null,
          question.difficulty,
          question.skill_type || null,
          Number(question.marks || 1),
          question.confidence ?? null,
          req.user.id,
          generated.model || null,
        ],
      )
      await connection.query(
        "INSERT INTO generated_question_batch_items (batch_id, question_id) VALUES (?, ?)",
        [batchId, Number(questionResult.insertId)],
      )
      await connection.query(
        `INSERT INTO question_explanations (question_id, explanation_type, explanation_text, approval_status, created_by_ai)
         VALUES (?, 'basic', ?, 'pending_review', 1)`,
        [Number(questionResult.insertId), question.explanation],
      )
    }
    await connection.query(
      `UPDATE generated_question_batches
       SET status = 'pending_review', ai_model_used = ?, raw_response_json = ?, error_message = ?
       WHERE id = ? AND school_id = ?`,
      [generated.model || null, JSON.stringify({ raw: generated.raw || "", data: generated.data }), generated.ok ? null : generated.message || null, batchId, schoolId],
    )
    await connection.commit()
    res.status(201).json({ batch_id: batchId, questions_created: generated.data.questions.length, ai: { ok: generated.ok, message: generated.message || null, model: generated.model || null } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getQuestionBatchReview(req, res) {
  const schoolId = getScopedSchoolId(req)
  const batchId = Number(req.params.id || 0)
  const [[batch]] = await pool.query(
    `SELECT gqb.*, subj.name AS subject_name, gl.name AS grade_name, st.topic_name
     FROM generated_question_batches gqb
     JOIN subjects subj ON subj.id = gqb.subject_id AND subj.school_id = gqb.school_id
     LEFT JOIN grade_levels gl ON gl.id = gqb.grade_id AND gl.school_id = gqb.school_id
     JOIN syllabus_topics st ON st.id = gqb.topic_id AND st.school_id = gqb.school_id
     WHERE gqb.school_id = ? AND gqb.id = ?
     LIMIT 1`,
    [schoolId, batchId],
  )
  if (!batch) throw new HttpError(404, "Question batch was not found")
  const [questions] = await pool.query(
    `SELECT q.*
     FROM generated_question_batch_items item
     JOIN question_bank q ON q.id = item.question_id
     WHERE q.school_id = ? AND item.batch_id = ?
     ORDER BY item.id`,
    [schoolId, batchId],
  )
  res.json({
    batch: { ...batch, raw_response_json: parseJson(batch.raw_response_json, null) },
    questions: questions.map((row) => ({ ...row, options_json: parseJson(row.options_json, []), accepted_answers_json: parseJson(row.accepted_answers_json, []) })),
  })
}

export async function updateQuestion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionId = Number(req.params.id || 0)
  const [result] = await pool.query(
    `UPDATE question_bank
     SET question_text = COALESCE(?, question_text),
       question_type = COALESCE(?, question_type),
       options_json = COALESCE(?, options_json),
       correct_answer = COALESCE(?, correct_answer),
       accepted_answers_json = COALESCE(?, accepted_answers_json),
       explanation = COALESCE(?, explanation),
       difficulty = COALESCE(?, difficulty),
       skill_type = COALESCE(?, skill_type),
       marks = COALESCE(?, marks),
       common_mistake = COALESCE(?, common_mistake),
       confidence = COALESCE(?, confidence),
       topic_id = COALESCE(?, topic_id),
       subtopic_id = COALESCE(?, subtopic_id)
     WHERE school_id = ? AND id = ?`,
    [
      req.body.question_text === undefined ? null : cleanText(req.body.question_text),
      req.body.question_type === undefined ? null : cleanText(req.body.question_type),
      req.body.options === undefined && req.body.options_json === undefined ? null : JSON.stringify(req.body.options_json || req.body.options || []),
      req.body.correct_answer === undefined ? null : cleanText(req.body.correct_answer),
      req.body.accepted_answers === undefined && req.body.accepted_answers_json === undefined ? null : normalizeJsonArray(req.body.accepted_answers || req.body.accepted_answers_json),
      req.body.explanation === undefined ? null : cleanText(req.body.explanation),
      req.body.difficulty === undefined ? null : cleanText(req.body.difficulty),
      req.body.skill_type === undefined ? null : cleanText(req.body.skill_type),
      req.body.marks === undefined ? null : Number(req.body.marks || 1),
      req.body.common_mistake === undefined ? null : cleanText(req.body.common_mistake),
      req.body.confidence === undefined ? null : Number(req.body.confidence || 0),
      req.body.topic_id === undefined ? null : Number(req.body.topic_id || 0),
      req.body.subtopic_id === undefined ? null : Number(req.body.subtopic_id || 0) || null,
      schoolId,
      questionId,
    ],
  )
  if (!result.affectedRows) throw new HttpError(404, "Question was not found")
  res.json({ ok: true })
}

export async function approveQuestion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const question = await validateQuestionApproval(connection, schoolId, questionId)
    await connection.query(
      `UPDATE question_bank
       SET approval_status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP
       WHERE school_id = ? AND id = ?`,
      [req.user.id, schoolId, questionId],
    )
    await connection.query(
      `INSERT INTO question_explanations (question_id, explanation_type, explanation_text, approval_status, created_by_ai, approved_by)
       VALUES (?, 'basic', ?, 'approved', 0, ?)
       ON DUPLICATE KEY UPDATE explanation_text = VALUES(explanation_text), approval_status = 'approved', approved_by = VALUES(approved_by)`,
      [questionId, question.explanation, req.user.id],
    )
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function rejectQuestion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const questionId = Number(req.params.id || 0)
  const [result] = await pool.query(
    "UPDATE question_bank SET approval_status = 'rejected' WHERE school_id = ? AND id = ?",
    [schoolId, questionId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Question was not found")
  res.json({ ok: true })
}

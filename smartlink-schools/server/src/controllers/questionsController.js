import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId, getTeacherClassSubjectPairs, isTeacher } from "../utils/tenantScope.js"
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

function parseJsonArray(value) {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function cleanQuestionTextForBank(value) {
  return cleanText(value)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/^(?:question\s*)?\d+\s*[\).:-]\s*/i, "")
    .replace(/\s*(?:\(|\[)?\d+(?:\.\d+)?\s*marks?(?:\)|\])?\s*$/i, "")
    .trim()
}

function cleanMarkingText(value) {
  return cleanText(value)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

function questionBankType(value) {
  const type = cleanText(value || "short_answer")
  if (["multiple_choice", "true_false", "short_answer", "structured", "essay"].includes(type)) return type
  if (type === "calculation") return "structured"
  if (type === "fill_blank") return "short_answer"
  return "short_answer"
}

function normalizeDifficulty(value) {
  const difficulty = cleanText(value || "medium").toLowerCase()
  return ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium"
}

function normalizeSkillType(value) {
  const skill = cleanText(value)
  if (!skill) return null
  return skill.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80)
}

function normalizeOptionsForBank(options = []) {
  if (!Array.isArray(options)) return []
  return options
    .map((option, index) => ({
      label: cleanText(option.option_label || option.label || String.fromCharCode(65 + index)).slice(0, 8),
      text: cleanMarkingText(option.option_text || option.text || option.value),
      is_correct: Boolean(option.is_correct),
    }))
    .filter((option) => option.text)
}

function uniqueTextRows(rows = []) {
  const seen = new Set()
  return rows.filter((row) => {
    const text = cleanMarkingText(row)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function assessmentMarkingKey(question, options = []) {
  const correctOptionRows = options
    .filter((option) => option.is_correct)
    .map((option) => [cleanText(option.label), cleanMarkingText(option.text)].filter(Boolean).join(". "))
  const correctAnswer = cleanMarkingText(question.correct_answer) || correctOptionRows.join("\n")
  const markingScheme = cleanMarkingText(question.marking_scheme)
  if (!correctAnswer && !markingScheme) return null
  const explanationRows = uniqueTextRows([markingScheme, question.explanation])
  return {
    correctAnswer: correctAnswer || markingScheme,
    acceptedAnswers: uniqueTextRows([correctAnswer, ...correctOptionRows]),
    explanation: explanationRows.join("\n\n") || null,
  }
}

async function resolveQuestionBankTopic(connection, schoolId, question) {
  if (question.topic_id) {
    const [[topic]] = await connection.query(
      `SELECT id, curriculum_id, grade_id, subject_id
       FROM syllabus_topics
       WHERE school_id = ? AND id = ? AND subject_id = ? AND is_active = 1
       LIMIT 1`,
      [schoolId, question.topic_id, question.subject_id],
    )
    if (topic) return topic
  }
  const topicText = cleanText(question.topic_text)
  if (!topicText) return null
  const [[topic]] = await connection.query(
    `SELECT id, curriculum_id, grade_id, subject_id
     FROM syllabus_topics
     WHERE school_id = ? AND subject_id = ? AND LOWER(topic_name) = LOWER(?) AND is_active = 1
     ORDER BY parent_topic_id IS NULL DESC, order_number, id
     LIMIT 1`,
    [schoolId, question.subject_id, topicText],
  )
  return topic || null
}

async function resolveQuestionBankSubtopic(connection, schoolId, question, topicId) {
  if (question.subtopic_id) {
    const [[subtopic]] = await connection.query(
      `SELECT id
       FROM syllabus_topics
       WHERE school_id = ? AND id = ? AND subject_id = ? AND is_active = 1
       LIMIT 1`,
      [schoolId, question.subtopic_id, question.subject_id],
    )
    if (subtopic) return Number(subtopic.id)
  }
  const subtopicText = cleanText(question.subtopic_text)
  if (!subtopicText || !topicId) return null
  const [[subtopic]] = await connection.query(
    `SELECT id
     FROM syllabus_topics
     WHERE school_id = ? AND subject_id = ? AND parent_topic_id = ? AND LOWER(topic_name) = LOWER(?) AND is_active = 1
     ORDER BY order_number, id
     LIMIT 1`,
    [schoolId, question.subject_id, topicId, subtopicText],
  )
  return subtopic ? Number(subtopic.id) : null
}

async function loadApprovedSyllabusContext(connection, schoolId, { gradeId, subjectId, topicId, subtopicId }) {
  const seedIds = [topicId, subtopicId].filter(Boolean).map(Number)
  const [topics] = seedIds.length
    ? await connection.query(
        `SELECT st.id, st.topic_name, st.description, st.term, st.parent_topic_id,
          parent.topic_name AS parent_topic_name
         FROM syllabus_topics st
         LEFT JOIN syllabus_topics parent ON parent.id = st.parent_topic_id AND parent.school_id = st.school_id
         WHERE st.school_id = ? AND st.subject_id = ? AND st.is_active = 1
          AND (
            st.id IN (${seedIds.map(() => "?").join(",")})
            OR st.parent_topic_id IN (${seedIds.map(() => "?").join(",")})
            OR st.parent_topic_id IN (
              SELECT child.id
              FROM syllabus_topics child
              WHERE child.school_id = ? AND child.subject_id = ? AND child.parent_topic_id IN (${seedIds.map(() => "?").join(",")})
            )
          )
         ORDER BY COALESCE(parent.topic_name, st.topic_name), st.parent_topic_id IS NOT NULL, st.order_number, st.topic_name`,
        [schoolId, subjectId, ...seedIds, ...seedIds, schoolId, subjectId, ...seedIds],
      )
    : [[]]
  const topicIds = topics.map((row) => Number(row.id)).filter(Boolean)

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
    approved_success_criteria: objectives.map((objective) => ({
      topic_id: Number(objective.topic_id),
      action_tag: objective.skill_type || "",
      text: objective.objective_text,
      exam_relevance: objective.exam_relevance || null,
    })),
    approved_chunks: chunks.map((chunk) => ({
      chunk_index: Number(chunk.chunk_index),
      source_filename: chunk.source_filename,
      chunk_text: String(chunk.chunk_text || "").slice(0, 4500),
    })),
  }
}

async function loadAssessmentQuestionHistory(connection, schoolId, { subjectId, topicIds = [], topicNames = [] }) {
  const ids = topicIds.map(Number).filter(Boolean)
  const names = topicNames.map((name) => cleanText(name)).filter(Boolean).slice(0, 8)
  const clauses = []
  const params = [schoolId, subjectId]
  if (ids.length) {
    clauses.push(`(aq.topic_id IN (${ids.map(() => "?").join(",")}) OR aq.subtopic_id IN (${ids.map(() => "?").join(",")}))`)
    params.push(...ids, ...ids)
  }
  for (const name of names) {
    clauses.push("(LOWER(aq.topic_text) LIKE ? OR LOWER(aq.subtopic_text) LIKE ?)")
    params.push(`%${name.toLowerCase()}%`, `%${name.toLowerCase()}%`)
  }
  if (!clauses.length) return []
  const [rows] = await connection.query(
    `SELECT aq.question_text, aq.question_type, aq.marks, aq.topic_text, aq.subtopic_text,
      aq.difficulty, aq.cognitive_skill, aq.correct_answer, aq.marking_scheme, aq.explanation,
      a.name AS assessment_name, a.assessment_type, a.term_name
     FROM assessment_questions aq
     JOIN assessments a ON a.id = aq.assessment_id AND a.school_id = aq.school_id
     WHERE aq.school_id = ? AND a.subject_id = ? AND (${clauses.join(" OR ")})
     ORDER BY a.created_at DESC, aq.sort_order, aq.id
     LIMIT 12`,
    params,
  )
  return rows.map((row) => ({
    assessment_name: row.assessment_name,
    assessment_type: row.assessment_type,
    term_name: row.term_name,
    question_type: row.question_type,
    question_text: String(row.question_text || "").slice(0, 700),
    marks: Number(row.marks || 1),
    topic_text: row.topic_text || "",
    subtopic_text: row.subtopic_text || "",
    cognitive_skill: row.cognitive_skill || "",
    marking_focus: String(row.marking_scheme || row.correct_answer || row.explanation || "").slice(0, 500),
  }))
}

async function loadTeacherQuestionStyleExamples(connection, schoolId, { gradeId, subjectId, topicIds = [], teacherId }) {
  const ids = topicIds.map(Number).filter(Boolean)
  const filters = [
    "q.school_id = ?",
    "q.subject_id = ?",
    "q.source_type = 'teacher_created'",
    "q.approval_status <> 'rejected'",
  ]
  const params = [schoolId, subjectId]
  if (gradeId !== undefined) {
    filters.push("q.grade_id <=> ?")
    params.push(gradeId || null)
  }
  if (ids.length) {
    filters.push(`(q.topic_id IN (${ids.map(() => "?").join(",")}) OR q.subtopic_id IN (${ids.map(() => "?").join(",")}))`)
    params.push(...ids, ...ids)
  }
  const [rows] = await connection.query(
    `SELECT q.question_text, q.question_type, q.options_json, q.correct_answer, q.accepted_answers_json,
      q.explanation, q.common_mistake, q.difficulty, q.skill_type, q.marks, q.approval_status,
      q.created_by, st.topic_name, sub.topic_name AS subtopic_name
     FROM question_bank q
     LEFT JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
     LEFT JOIN syllabus_topics sub ON sub.id = q.subtopic_id AND sub.school_id = q.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY CASE WHEN q.created_by = ? THEN 0 ELSE 1 END,
       FIELD(q.approval_status, 'approved', 'pending_review', 'draft'),
       q.updated_at DESC
     LIMIT 12`,
    [...params, teacherId || 0],
  )
  return rows.map((row) => ({
    source: Number(row.created_by) === Number(teacherId) ? "this_teacher_manual_question" : "school_manual_question",
    topic_name: row.topic_name || "",
    subtopic_name: row.subtopic_name || "",
    question_type: row.question_type,
    question_text: String(row.question_text || "").slice(0, 700),
    options_json: parseJsonArray(row.options_json).slice(0, 6),
    answer_style: String(row.correct_answer || "").slice(0, 500),
    accepted_answer_style: parseJsonArray(row.accepted_answers_json).slice(0, 8),
    explanation_style: String(row.explanation || "").slice(0, 500),
    common_mistake_style: String(row.common_mistake || "").slice(0, 350),
    difficulty: row.difficulty,
    skill_type: row.skill_type || "",
    marks: Number(row.marks || 1),
  }))
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
  const showAll = String(req.query.all || "").toLowerCase() === "1" || String(req.query.all || "").toLowerCase() === "true"
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 250)))
  if (req.query.grade_id) { filters.push("q.grade_id = ?"); params.push(Number(req.query.grade_id)) }
  if (req.query.subject_id) { filters.push("q.subject_id = ?"); params.push(Number(req.query.subject_id)) }
  if (req.query.topic_id) { filters.push("q.topic_id = ?"); params.push(Number(req.query.topic_id)) }
  if (req.query.approval_status) { filters.push("q.approval_status = ?"); params.push(String(req.query.approval_status)) }
  if (!showAll) params.push(limit)
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
     ${showAll ? "" : "LIMIT ?"}`,
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
  const questionText = cleanQuestionTextForBank(req.body.question_text)
  const subjectId = Number(req.body.subject_id || 0)
  const topicId = Number(req.body.topic_id || 0)
  if (!questionText || !subjectId || !topicId) throw new HttpError(400, "Question text, subject and topic are required")
  const correctAnswer = cleanMarkingText(req.body.correct_answer)
  const explanation = cleanMarkingText(req.body.explanation)
  if (!correctAnswer && !explanation) throw new HttpError(400, "Add an answer or marking key before saving this question")
  if (isTeacher(req)) {
    const pairs = await getTeacherClassSubjectPairs(req, schoolId)
    if (!pairs?.some((pair) => Number(pair.subjectId) === subjectId)) {
      throw new HttpError(403, "Teachers can only add questions for subjects they teach")
    }
  }
  const requestedStatus = cleanText(req.body.approval_status || "pending_review") || "pending_review"
  const approvalStatus = isTeacher(req) && requestedStatus === "approved" ? "pending_review" : requestedStatus
  const [result] = await pool.query(
    `INSERT INTO question_bank (
      public_ref, school_id, curriculum_id, grade_id, subject_id, topic_id, subtopic_id, question_type, question_text,
      options_json, correct_answer, accepted_answers_json, explanation, difficulty, skill_type, marks,
      common_mistake, confidence, source_type, approval_status, created_by
    ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      req.body.curriculum_id || null,
      req.body.grade_id || null,
      subjectId,
      topicId,
      req.body.subtopic_id || null,
      questionBankType(req.body.question_type || "multiple_choice"),
      questionText,
      req.body.options_json ? JSON.stringify(req.body.options_json) : normalizeJsonArray(req.body.options),
      correctAnswer || null,
      normalizeJsonArray(req.body.accepted_answers || req.body.accepted_answers_json),
      explanation || null,
      normalizeDifficulty(req.body.difficulty || "medium"),
      cleanText(req.body.skill_type) || null,
      Number(req.body.marks || 1),
      cleanText(req.body.common_mistake) || null,
      req.body.confidence === undefined ? null : Number(req.body.confidence || 0),
      req.body.source_type || "teacher_created",
      approvalStatus,
      req.user.id,
    ],
  )
  res.status(201).json({ question_id: Number(result.insertId), ok: true })
}

export async function sourceAssessmentQuestions(req, res) {
  const schoolId = getScopedSchoolId(req)
  const limit = Math.max(1, Math.min(200, Number(req.body.limit || req.query.limit || 75)))
  const subjectId = Number(req.body.subject_id || req.query.subject_id || 0)
  const assessmentId = Number(req.body.assessment_id || req.query.assessment_id || 0)
  const clauses = [
    "aq.school_id = ?",
    `(TRIM(COALESCE(aq.correct_answer, '')) <> ''
      OR TRIM(COALESCE(aq.marking_scheme, '')) <> ''
      OR EXISTS (
        SELECT 1
        FROM assessment_question_options opt
        WHERE opt.school_id = aq.school_id AND opt.question_id = aq.id AND opt.is_correct = 1
      ))`,
  ]
  const params = [schoolId]
  if (subjectId) {
    clauses.push("a.subject_id = ?")
    params.push(subjectId)
  }
  if (assessmentId) {
    clauses.push("a.id = ?")
    params.push(assessmentId)
  }
  if (req.body.topic_id || req.query.topic_id) {
    clauses.push("aq.topic_id = ?")
    params.push(Number(req.body.topic_id || req.query.topic_id))
  }
  if (isTeacher(req)) {
    const pairs = await getTeacherClassSubjectPairs(req, schoolId)
    if (!pairs?.length) {
      res.json({ ok: true, imported: 0, scanned: 0, skipped: { no_teacher_scope: 1 }, questions: [] })
      return
    }
    const pairClause = pairs.map(() => "(a.class_id = ? AND a.subject_id = ?)").join(" OR ")
    clauses.push(`(a.teacher_id = ? OR a.created_by = ? OR ${pairClause})`)
    params.push(req.user.id, req.user.id, ...pairs.flatMap((pair) => [pair.classId, pair.subjectId]))
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [assessmentQuestions] = await connection.query(
      `SELECT aq.*, a.subject_id AS assessment_subject_id, a.class_id, a.teacher_id, a.created_by AS assessment_created_by,
        a.name AS assessment_name, subj.name AS subject_name
       FROM assessment_questions aq
       JOIN assessments a ON a.id = aq.assessment_id AND a.school_id = aq.school_id
       JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.updated_at DESC, aq.sort_order, aq.question_number, aq.id
       LIMIT ?`,
      [...params, limit],
    )
    const questionIds = assessmentQuestions.map((question) => Number(question.id)).filter(Boolean)
    const [optionRows] = questionIds.length
      ? await connection.query(
          `SELECT *
           FROM assessment_question_options
           WHERE school_id = ? AND question_id IN (${questionIds.map(() => "?").join(",")})
           ORDER BY question_id, sort_order, option_label, id`,
          [schoolId, ...questionIds],
        )
      : [[]]
    const optionMap = new Map()
    optionRows.forEach((option) => {
      const rows = optionMap.get(Number(option.question_id)) || []
      rows.push(option)
      optionMap.set(Number(option.question_id), rows)
    })

    const skipped = { no_marking_key: 0, no_topic: 0, duplicate: 0, empty_question: 0 }
    const imported = []
    for (const row of assessmentQuestions) {
      const cleanQuestion = cleanQuestionTextForBank(row.question_text)
      if (!cleanQuestion) {
        skipped.empty_question += 1
        continue
      }
      const options = normalizeOptionsForBank(optionMap.get(Number(row.id)) || [])
      const key = assessmentMarkingKey(row, options)
      if (!key) {
        skipped.no_marking_key += 1
        continue
      }
      const question = {
        ...row,
        subject_id: Number(row.assessment_subject_id || row.subject_id),
      }
      const topic = await resolveQuestionBankTopic(connection, schoolId, question)
      if (!topic) {
        skipped.no_topic += 1
        continue
      }
      const subtopicId = await resolveQuestionBankSubtopic(connection, schoolId, question, Number(topic.id))
      const [[duplicate]] = await connection.query(
        `SELECT id
         FROM question_bank
         WHERE school_id = ? AND subject_id = ? AND LOWER(TRIM(question_text)) = LOWER(TRIM(?))
         LIMIT 1`,
        [schoolId, question.subject_id, cleanQuestion],
      )
      if (duplicate) {
        skipped.duplicate += 1
        continue
      }

      const [result] = await connection.query(
        `INSERT INTO question_bank (
          public_ref, school_id, curriculum_id, grade_id, subject_id, topic_id, subtopic_id, question_type,
          question_text, options_json, correct_answer, accepted_answers_json, explanation,
          difficulty, skill_type, marks, source_type, approval_status, created_by
        ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'teacher_created', 'pending_review', ?)`,
        [
          schoolId,
          topic.curriculum_id || null,
          topic.grade_id || null,
          question.subject_id,
          Number(topic.id),
          subtopicId,
          questionBankType(row.question_type),
          cleanQuestion,
          JSON.stringify(options.map((option) => ({ label: option.label, text: option.text }))),
          key.correctAnswer,
          JSON.stringify(key.acceptedAnswers),
          key.explanation,
          normalizeDifficulty(row.difficulty),
          normalizeSkillType(row.cognitive_skill),
          Math.max(1, Math.round(Number(row.marks || 1))),
          req.user.id,
        ],
      )
      imported.push({
        question_id: Number(result.insertId),
        source_assessment: row.assessment_name,
        question_text: cleanQuestion.slice(0, 160),
      })
    }
    await connection.commit()
    res.status(201).json({
      ok: true,
      scanned: assessmentQuestions.length,
      imported: imported.length,
      skipped,
      questions: imported,
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function generateDraftQuestionBatch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const topicId = Number(req.body.topic_id || 0)
  const requestedSubjectId = Number(req.body.subject_id || 0)
  if (!topicId || !requestedSubjectId) throw new HttpError(400, "Subject and topic are required")
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
  const subjectId = Number(topic.subject_id || requestedSubjectId)
  const effectiveGradeId = topic.grade_id || req.body.grade_id || null
  const numberRequested = Math.max(1, Math.min(20, Number(req.body.number_of_questions || req.body.number_requested || 5)))
  const requestedQuestionType = cleanText(req.body.question_type || req.body.questionType || "mixed") || "mixed"
  const context = {
    curriculum: req.body.curriculum || topic.curriculum_name || "Cambridge Primary Curriculum",
    gradeName: topic.grade_name,
    subjectName: topic.subject_name,
    topicName: topic.topic_name,
    subtopicName: "",
    difficulty: req.body.difficulty || "easy",
    questionType: requestedQuestionType,
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
      gradeId: effectiveGradeId,
      subjectId,
      topicId,
      subtopicId: req.body.subtopic_id || null,
    })
    if (req.body.subtopic_id) {
      const subtopic = context.approvedSyllabusContext.approved_topics.find((row) => Number(row.id) === Number(req.body.subtopic_id))
      context.subtopicName = subtopic?.topic_name || ""
    }
    context.assessmentQuestionHistory = await loadAssessmentQuestionHistory(connection, schoolId, {
      subjectId,
      topicIds: context.approvedSyllabusContext.approved_topics.map((row) => Number(row.id)),
      topicNames: context.approvedSyllabusContext.approved_topics.map((row) => row.topic_name),
    })
    context.teacherQuestionStyleExamples = await loadTeacherQuestionStyleExamples(connection, schoolId, {
      gradeId: effectiveGradeId,
      subjectId,
      topicIds: context.approvedSyllabusContext.approved_topics.map((row) => Number(row.id)),
      teacherId: req.user.id,
    })
    const batchQuestionType = ["multiple_choice", "true_false", "short_answer", "structured", "essay"].includes(context.questionType)
      ? context.questionType
      : "structured"
    const [batchResult] = await connection.query(
      `INSERT INTO generated_question_batches (
        school_id, teacher_id, grade_id, subject_id, topic_id, subtopic_id, number_requested,
        difficulty, question_type, status, generation_prompt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?)`,
      [
        schoolId,
        req.user.id,
        effectiveGradeId,
        subjectId,
        topicId,
        req.body.subtopic_id || null,
        numberRequested,
        context.difficulty,
        batchQuestionType,
        JSON.stringify(context),
      ],
    )
    const batchId = Number(batchResult.insertId)
    const generated = await generateDraftQuestions(context)
    if (generated.blocked) throw new HttpError(429, generated.message)
    if (generated.unavailable || !generated.ok) {
      throw new HttpError(409, generated.message || "AI assistance is not configured yet. Upload, review, and manual approval features are still available.")
    }
    const generatedQuestions = Array.isArray(generated.data?.questions) ? generated.data.questions : []
    for (const question of generatedQuestions) {
      const [questionResult] = await connection.query(
        `INSERT INTO question_bank (
          public_ref, school_id, curriculum_id, grade_id, subject_id, topic_id, subtopic_id, question_type,
          question_text, options_json, correct_answer, accepted_answers_json, explanation,
          common_mistake, difficulty, skill_type, marks, confidence, source_type, approval_status, created_by, ai_model_used
        ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 'pending_review', ?, ?)`,
        [
          schoolId,
          topic.curriculum_id || null,
          effectiveGradeId,
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
    res.status(201).json({ batch_id: batchId, questions_created: generatedQuestions.length, ai: { ok: generated.ok, message: generated.message || null, model: generated.model || null } })
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

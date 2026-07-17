import { pool } from "../config/db.js"
import fs from "fs/promises"
import path from "path"
import { HttpError } from "../utils/http.js"
import { buildTopicRecommendation, classifyDifficulty } from "../services/recommendationService.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { assessmentExportFilename, buildAssessmentPdf, normalizeAssessmentExportVariant } from "../services/assessmentExportService.js"
import { getScopedSchoolId, getTeacherClassIds, isTeacher, scopedInClause } from "../utils/tenantScope.js"

const ASSESSMENT_TYPES = new Set(["class_test", "quiz", "assignment", "mid_term", "end_of_term_exam", "mock_exam", "final_exam"])
const FORMAL_TYPES = new Set(["mid_term", "end_of_term_exam", "mock_exam", "final_exam"])
const EXAM_SESSION_REQUIRED_TYPES = new Set(["end_of_term_exam", "mock_exam", "final_exam"])
const QUESTION_TYPES = new Set(["multiple_choice", "true_false", "short_answer", "structured", "essay", "calculation", "fill_blank"])
const DIFFICULTIES = new Set(["easy", "medium", "hard"])
const COGNITIVE_SKILLS = new Set(["recall", "understanding", "application", "analysis"])
const TEACHER_EDITABLE_STATUSES = new Set(["draft", "open", "returned"])
const BLOCK_TYPES = new Set([
  "cover_field",
  "heading",
  "paragraph",
  "instructions",
  "section",
  "question",
  "sub_question",
  "mcq_options",
  "answer_space",
  "image",
  "shape",
  "table",
  "equation",
  "page_break",
  "text_box",
  "marking_scheme",
  "teacher_note",
])
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"])

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function safePathPart(value, fallback = "item") {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || fallback
}

function assessmentMediaFolderName(assessment, assessmentId) {
  return `${safePathPart(assessment?.name, "assessment")}-${assessmentId}`
}

function plainTextFromContentParts(parts = []) {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (part?.type === "image") return cleanText(part.caption || part.alt_text || part.altText) ? `[Image: ${cleanText(part.caption || part.alt_text || part.altText)}]` : "[Image]"
      if (part?.type === "table") {
        const rows = Array.isArray(part.cells) ? part.cells : Array.isArray(part.rows) ? part.rows : []
        const tableText = rows
          .filter(Array.isArray)
          .map((row) => row.map((cell) => cleanText(cell?.text ?? cell?.value ?? cell)).join(" | "))
          .filter(Boolean)
        return [cleanText(part.caption), ...tableText].filter(Boolean).join("\n")
      }
      return cleanText(part?.text)
    })
    .filter(Boolean)
    .join("\n\n")
}

function idValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

function positiveNumber(value, label, required = true) {
  if ((value === undefined || value === null || value === "") && !required) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, `${label} must be greater than 0`)
  return number
}

function normalizeAssessmentType(value) {
  const type = cleanText(value || "class_test")
  if (!ASSESSMENT_TYPES.has(type)) throw new HttpError(400, "Assessment type is invalid")
  return type
}

function normalizeQuestionType(value) {
  const type = cleanText(value || "short_answer")
  if (!QUESTION_TYPES.has(type)) throw new HttpError(400, "Question type is invalid")
  return type
}

function normalizeDifficulty(value) {
  const difficulty = cleanText(value || "medium").toLowerCase()
  if (!DIFFICULTIES.has(difficulty)) throw new HttpError(400, "Question difficulty is invalid")
  return difficulty
}

function normalizeExpectedDifficulty(value) {
  const difficulty = cleanText(value || "Medium")
  const normalized = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase()
  return ["Easy", "Medium", "Hard"].includes(normalized) ? normalized : "Medium"
}

function normalizeCognitiveSkill(value) {
  const skill = cleanText(value || "")
  if (!skill) return null
  if (!COGNITIVE_SKILLS.has(skill)) throw new HttpError(400, "Cognitive skill is invalid")
  return skill
}

function questionDifficultyToExpected(value) {
  return normalizeExpectedDifficulty(value)
}

function isLeadership(req) {
  return ["school_owner", "headteacher", "super_admin"].includes(String(req.user?.role || ""))
}

function rowToAssessment(row) {
  return {
    id: Number(row.id),
    school_id: Number(row.school_id),
    exam_session_id: row.exam_session_id ? Number(row.exam_session_id) : null,
    exam_session_name: row.exam_session_name || null,
    academic_year_id: row.academic_year_id ? Number(row.academic_year_id) : null,
    academic_year_name: row.academic_year_name || null,
    term_id: row.term_id ? Number(row.term_id) : null,
    term_name: row.term_name,
    class_id: Number(row.class_id),
    class_name: row.class_name,
    stream_section: row.stream_section || "",
    subject_id: Number(row.subject_id),
    subject_name: row.subject_name,
    teacher_id: row.teacher_id ? Number(row.teacher_id) : null,
    teacher_name: row.teacher_name || null,
    name: row.name,
    assessment_type: row.assessment_type,
    total_marks: Number(row.total_marks || 0),
    duration_minutes: row.duration_minutes ? Number(row.duration_minutes) : null,
    instructions: row.instructions || "",
    expected_difficulty: row.expected_difficulty || "Medium",
    status: row.status,
    return_reason: row.return_reason || "",
    returned_by: row.returned_by ? Number(row.returned_by) : null,
    returned_by_name: row.returned_by_name || null,
    returned_at: row.returned_at || null,
    approved_by: row.approved_by ? Number(row.approved_by) : null,
    approved_by_name: row.approved_by_name || null,
    approved_at: row.approved_at || null,
    created_by: Number(row.created_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
    question_count: Number(row.question_count || 0),
    question_marks: Number(row.question_marks || 0),
  }
}

function parseJsonColumn(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function safeJson(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  return typeof value === "object" ? value : fallback
}

function normalizeBlockInput(rawBlocks = []) {
  if (!Array.isArray(rawBlocks)) return []
  return rawBlocks.map((raw, index) => {
    const blockType = cleanText(raw.block_type || raw.blockType || raw.type || "paragraph")
    if (!BLOCK_TYPES.has(blockType)) throw new HttpError(400, `Block ${index + 1} type is invalid`)
    return {
      id: idValue(raw.id),
      parent_block_id: idValue(raw.parent_block_id || raw.parentBlockId),
      block_type: blockType,
      content_json: safeJson(raw.content_json || raw.content || {}, {}),
      style_json: safeJson(raw.style_json || raw.style || {}, {}),
      metadata_json: safeJson(raw.metadata_json || raw.metadata || {}, {}),
      sort_order: Number(raw.sort_order || raw.sortOrder || index + 1),
      is_printable: raw.is_printable === undefined && raw.isPrintable === undefined
        ? !["marking_scheme", "teacher_note"].includes(blockType)
        : Boolean(raw.is_printable ?? raw.isPrintable),
    }
  })
}

function blockQuestionToQuestion(block, index) {
  const content = block.content_json || {}
  const metadata = block.metadata_json || {}
  const questionType = content.question_type || metadata.question_type || "short_answer"
  const contentParts = Array.isArray(content.content_parts) ? content.content_parts : []
  const question = {
    question_number: index + 1,
    display_number: cleanText(content.question_number || metadata.original_question_number || index + 1).slice(0, 80),
    question_text: content.question_text || content.text || plainTextFromContentParts(contentParts),
    question_type: questionType,
    marks: content.marks || metadata.marks || "",
    topic_text: metadata.topic_text || content.topic_text || "",
    subtopic_text: metadata.subtopic_text || "",
    difficulty: metadata.difficulty || "medium",
    cognitive_skill: metadata.cognitive_skill || "",
    question_instructions: content.question_instructions || "",
    correct_answer: metadata.correct_answer || "",
    marking_scheme: metadata.marking_scheme || "",
    explanation: metadata.explanation || "",
    options: Array.isArray(content.options) ? content.options : [],
    content_parts: contentParts,
    sort_order: block.sort_order || index + 1,
  }
  return question
}

function questionsFromBlocks(blocks = []) {
  return blocks
    .filter((block) => ["question", "sub_question"].includes(block.block_type))
    .map(blockQuestionToQuestion)
}

function buildBlocksFromQuestions(assessment = {}, questions = []) {
  const blocks = [
    {
      block_type: "cover_field",
      content_json: { field: "school_name", label: "School Name", value: "" },
      style_json: { align: "center", size: "small" },
      metadata_json: { auto: true },
      sort_order: 1,
      is_printable: true,
    },
    {
      block_type: "cover_field",
      content_json: { field: "title", label: "Exam Title", value: assessment.name || "" },
      style_json: { align: "center", size: "title" },
      metadata_json: { auto: true },
      sort_order: 2,
      is_printable: true,
    },
    {
      block_type: "instructions",
      content_json: { text: assessment.instructions || "Answer all questions. Show all working where applicable." },
      style_json: {},
      metadata_json: {},
      sort_order: 3,
      is_printable: true,
    },
  ]
  questions.forEach((question, index) => {
    blocks.push({
      block_type: "question",
      content_json: {
        question_number: question.display_number || question.question_number || index + 1,
        question_text: question.question_text || "",
        content_parts: Array.isArray(question.content_parts) ? question.content_parts : [],
        question_type: question.question_type || "short_answer",
        marks: question.marks || "",
        question_instructions: question.question_instructions || "",
        options: question.options || [],
      },
      style_json: { spacing: "normal" },
      metadata_json: {
        topic_text: question.topic_text || "",
        subtopic_text: question.subtopic_text || "",
        difficulty: question.difficulty || "medium",
        cognitive_skill: question.cognitive_skill || "",
        correct_answer: question.correct_answer || "",
        marking_scheme: question.marking_scheme || "",
        explanation: question.explanation || "",
      },
      sort_order: 10 + index,
      is_printable: true,
    })
  })
  return blocks
}

function buildReviewChecks(assessment, questions) {
  const totalMarks = Number(assessment.total_marks || 0)
  const questionTotal = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
  const missingText = questions.filter((question) => !cleanText(question.question_text)).length
  const missingMarks = questions.filter((question) => Number(question.marks || 0) <= 0).length
  const missingSchemes = questions.filter((question) => FORMAL_TYPES.has(assessment.assessment_type) && !cleanText(question.marking_scheme)).length
  const missingTopics = questions.filter((question) => !cleanText(question.topic_text)).length
  const missingDifficulty = questions.filter((question) => !cleanText(question.difficulty)).length
  const missingSkill = questions.filter((question) => !cleanText(question.cognitive_skill)).length
  const mcqIssues = questions.filter((question) => {
    if (question.question_type !== "multiple_choice") return false
    const options = (question.options || []).filter((option) => cleanText(option.option_text))
    return options.length < 2 || options.filter((option) => option.is_correct).length !== 1
  }).length
  const ready = Boolean(
    cleanText(assessment.name)
    && assessment.assessment_type
    && assessment.academic_year_id
    && assessment.term_id
    && assessment.class_id
    && assessment.subject_id
    && assessment.teacher_id
    && totalMarks > 0
    && Number(assessment.duration_minutes || 0) > 0
    && questions.length
    && !missingText
    && !missingMarks
    && !missingSchemes
    && !mcqIssues
    && Math.abs(questionTotal - totalMarks) <= 0.001
  )
  return {
    total_marks: totalMarks,
    question_marks: questionTotal,
    missing_text: missingText,
    missing_marks: missingMarks,
    missing_marking_schemes: missingSchemes,
    missing_topics: missingTopics,
    missing_difficulty: missingDifficulty,
    missing_cognitive_skill: missingSkill,
    mcq_issues: mcqIssues,
    exam_session_missing: EXAM_SESSION_REQUIRED_TYPES.has(assessment.assessment_type) && !assessment.exam_session_id,
    ready,
  }
}

async function loadAssessmentBase(connection, schoolId, assessmentId) {
  const [[assessment]] = await connection.query(
    `SELECT a.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
       es.name AS exam_session_name, ay.name AS academic_year_name,
       returned.full_name AS returned_by_name, approved.full_name AS approved_by_name,
       COUNT(DISTINCT q.id) AS question_count,
       COALESCE(SUM(q.marks), 0) AS question_marks
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN users teacher ON teacher.id = a.teacher_id AND teacher.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN users returned ON returned.id = a.returned_by AND returned.school_id = a.school_id
     LEFT JOIN users approved ON approved.id = a.approved_by AND approved.school_id = a.school_id
     LEFT JOIN assessment_questions q ON q.assessment_id = a.id AND q.school_id = a.school_id
     WHERE a.id = ? AND a.school_id = ?
     GROUP BY a.id
     LIMIT 1`,
    [assessmentId, schoolId],
  )
  if (!assessment) throw new HttpError(404, "Assessment paper was not found")
  return assessment
}

async function assertTeacherProfile(connection, req, schoolId) {
  if (!isTeacher(req)) return
  const [[teacher]] = await connection.query(
    "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND is_active = 1 LIMIT 1",
    [req.user.id, schoolId],
  )
  if (!teacher) throw new HttpError(403, "No teacher profile linked to this account.")
}

async function assertTeacherAssigned(connection, req, schoolId, classId, subjectId, academicYearId, termId) {
  if (!isTeacher(req)) return
  await assertTeacherProfile(connection, req, schoolId)
  const params = [schoolId, req.user.id, classId, subjectId]
  let sessionClause = ""
  if (academicYearId) {
    sessionClause += " AND (academic_year_id = ? OR academic_year_id IS NULL)"
    params.push(academicYearId)
  }
  if (termId) {
    sessionClause += " AND (term_id = ? OR term_id IS NULL)"
    params.push(termId)
  }
  const [rows] = await connection.query(
    `SELECT id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND class_id = ? AND subject_id = ?
       AND role = 'subject_teacher' AND is_active = 1${sessionClause}
     LIMIT 1`,
    params,
  )
  if (!rows.length) throw new HttpError(403, "You are not assigned to teach this subject in this class.")
}

async function assertAssessmentReadable(connection, req, schoolId, assessment) {
  if (!isTeacher(req)) return
  await assertTeacherAssigned(
    connection,
    req,
    schoolId,
    Number(assessment.class_id),
    Number(assessment.subject_id),
    assessment.academic_year_id ? Number(assessment.academic_year_id) : null,
    assessment.term_id ? Number(assessment.term_id) : null,
  )
}

async function assertAssessmentEditable(connection, req, schoolId, assessment) {
  await assertAssessmentReadable(connection, req, schoolId, assessment)
  if (["locked", "archived"].includes(String(assessment.status || ""))) throw new HttpError(409, "This paper is locked.")
  if (isTeacher(req) && !TEACHER_EDITABLE_STATUSES.has(String(assessment.status || ""))) {
    throw new HttpError(403, "You do not have permission to edit this paper.")
  }
}

async function validateSchoolScope(connection, schoolId, values) {
  const [[classRow]] = await connection.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [values.classId, schoolId])
  if (!classRow) throw new HttpError(400, "Select a class from this school")

  const [[subject]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [values.subjectId, schoolId])
  if (!subject) throw new HttpError(400, "Select a subject from this school")

  const [[year]] = await connection.query("SELECT id, name FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1", [values.academicYearId, schoolId])
  if (!year) throw new HttpError(400, "Select an academic year from this school")

  const [[term]] = await connection.query("SELECT id, name FROM terms WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1", [values.termId, schoolId, values.academicYearId])
  if (!term) throw new HttpError(400, "Select a term from this school")

  return { year, term }
}

async function resolveSessionContext(connection, schoolId, payload, assessmentType) {
  const activeSession = await getActiveAcademicSession(schoolId, connection)
  if (activeSession.setupRequired) throw new HttpError(409, "No active academic term found.")

  const examSessionId = idValue(payload.exam_session_id || payload.examSessionId)
  if (EXAM_SESSION_REQUIRED_TYPES.has(assessmentType) && !examSessionId) {
    throw new HttpError(400, "End-of-term, mock, and final exam papers must be linked to an exam session")
  }

  if (examSessionId) {
    const [[examSession]] = await connection.query(
      `SELECT es.*, t.name AS term_name, ay.name AS academic_year_name
       FROM exam_sessions es
       JOIN terms t ON t.id = es.term_id AND t.school_id = es.school_id
       JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.school_id = es.school_id
       WHERE es.id = ? AND es.school_id = ? AND es.status NOT IN ('locked', 'archived')
       LIMIT 1`,
      [examSessionId, schoolId],
    )
    if (!examSession) throw new HttpError(400, "Select an editable exam session from this school")
    return {
      examSessionId: Number(examSession.id),
      academicYearId: Number(examSession.academic_year_id),
      termId: Number(examSession.term_id),
      termName: examSession.term_name,
      academicYearName: examSession.academic_year_name,
    }
  }

  const academicYearId = idValue(payload.academic_year_id || payload.academicYearId) || activeSession.academicYearId
  const termId = idValue(payload.term_id || payload.termId) || activeSession.termId
  if (Number(academicYearId) !== Number(activeSession.academicYearId) || Number(termId) !== Number(activeSession.termId)) {
    throw new HttpError(400, "Assessments are created in the current active academic session by default")
  }
  return {
    examSessionId: null,
    academicYearId,
    termId,
    termName: activeSession.term.name,
    academicYearName: activeSession.academicYear.name,
  }
}

async function resolveAssignedTeacher(connection, req, schoolId, classId, subjectId, academicYearId, termId, requestedTeacherId) {
  if (isTeacher(req)) {
    await assertTeacherAssigned(connection, req, schoolId, classId, subjectId, academicYearId, termId)
    const [[teacher]] = await connection.query("SELECT id, full_name FROM users WHERE id = ? AND school_id = ? LIMIT 1", [req.user.id, schoolId])
    return { id: Number(req.user.id), name: teacher?.full_name || req.user.fullName || null }
  }

  const params = [schoolId, classId, subjectId, academicYearId, termId]
  const teacherClause = requestedTeacherId ? " AND a.teacher_id = ?" : ""
  if (requestedTeacherId) params.push(requestedTeacherId)
  const [[assignment]] = await connection.query(
    `SELECT a.teacher_id, u.full_name AS teacher_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.class_id = ? AND a.subject_id = ?
       AND (a.academic_year_id = ? OR a.academic_year_id IS NULL)
       AND (a.term_id = ? OR a.term_id IS NULL)
       AND a.role = 'subject_teacher' AND a.is_active = 1
       AND u.role = 'teacher' AND u.is_active = 1${teacherClause}
     ORDER BY (a.academic_year_id = ?) DESC, (a.term_id = ?) DESC, a.updated_at DESC, a.id DESC
     LIMIT 1`,
    [...params, academicYearId, termId],
  )
  if (!assignment) {
    throw new HttpError(400, requestedTeacherId
      ? "The selected teacher is not assigned to teach this subject in this class."
      : "Assign an active subject teacher to this class and subject before creating the paper")
  }
  return { id: Number(assignment.teacher_id), name: assignment.teacher_name }
}

function normalizeQuestionInput(rawQuestions = [], mode = "draft") {
  if (!Array.isArray(rawQuestions)) return []
  return rawQuestions.map((raw, index) => {
    const contentParts = Array.isArray(raw.content_parts || raw.contentParts) ? (raw.content_parts || raw.contentParts) : []
    const questionText = cleanText(raw.question_text || raw.questionText || raw.text || plainTextFromContentParts(contentParts))
    const hasAnyValue = questionText
      || cleanText(raw.correct_answer || raw.correctAnswer)
      || cleanText(raw.marking_scheme || raw.markingScheme)
      || cleanText(raw.topic_text || raw.topicText)
      || cleanText(raw.marks)
    if (!hasAnyValue) return null

    if (!questionText) throw new HttpError(400, `Question ${index + 1} needs question text`)
    const marks = positiveNumber(raw.marks, `Question ${index + 1} marks`)
    const questionType = normalizeQuestionType(raw.question_type || raw.questionType)
    const options = Array.isArray(raw.options)
      ? raw.options
        .map((option, optionIndex) => ({
          option_label: cleanText(option.option_label || option.optionLabel || option.label || String.fromCharCode(65 + optionIndex)).slice(0, 8),
          option_text: cleanText(option.option_text || option.optionText || option.text),
          is_correct: Boolean(option.is_correct || option.isCorrect),
          sort_order: optionIndex + 1,
        }))
        .filter((option) => option.option_text)
      : []

    if (mode === "submit" && questionType === "multiple_choice") {
      if (options.length < 2) throw new HttpError(400, `Question ${index + 1} needs at least two multiple-choice options`)
      if (options.filter((option) => option.is_correct).length !== 1) throw new HttpError(400, `Question ${index + 1} needs exactly one correct option`)
    }

    return {
      question_number: index + 1,
      display_number: cleanText(raw.display_number || raw.displayNumber || raw.question_number || raw.questionNumber || index + 1).slice(0, 80),
      question_text: questionText,
      question_type: questionType,
      marks,
      topic_id: idValue(raw.topic_id || raw.topicId),
      topic_text: cleanText(raw.topic_text || raw.topicText || raw.topic_name || raw.topicName) || null,
      subtopic_id: idValue(raw.subtopic_id || raw.subtopicId),
      subtopic_text: cleanText(raw.subtopic_text || raw.subtopicText) || null,
      difficulty: normalizeDifficulty(raw.difficulty),
      cognitive_skill: normalizeCognitiveSkill(raw.cognitive_skill || raw.cognitiveSkill),
      question_instructions: cleanText(raw.question_instructions || raw.questionInstructions) || null,
      attachment_url: cleanText(raw.attachment_url || raw.attachmentUrl) || null,
      correct_answer: cleanText(raw.correct_answer || raw.correctAnswer) || null,
      marking_scheme: cleanText(raw.marking_scheme || raw.markingScheme) || null,
      explanation: cleanText(raw.explanation) || null,
      content_parts: contentParts,
      sort_order: Number(raw.sort_order || raw.sortOrder || index + 1),
      options,
    }
  }).filter(Boolean)
}

async function saveQuestions(connection, schoolId, assessmentId, questions, topicFallback = []) {
  // The paper editor historically replaces question rows on every save. Keep
  // canonical curriculum mappings by stable display number before that
  // replacement so a later wording/layout edit cannot silently erase evidence
  // precision.
  const [[assessmentOwner]] = await connection.query("SELECT created_by FROM assessments WHERE school_id=? AND id=? LIMIT 1", [schoolId, assessmentId])
  const mappingActorId = Number(assessmentOwner?.created_by || 0)
  const [previousMappings] = await connection.query(
    `SELECT aq.display_number,qtm.topic_id,qtm.allocation_type,qtm.allocated_marks,qtm.allocated_percentage,qtm.is_primary
     FROM assessment_questions aq
     JOIN question_topic_mappings qtm ON qtm.assessment_question_id=aq.id AND qtm.school_id=aq.school_id
     WHERE aq.school_id=? AND aq.assessment_id=?`,
    [schoolId, assessmentId],
  ).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return [[]]
    throw error
  })
  const [previousObjectives] = await connection.query(
    `SELECT aq.display_number,qom.learning_objective_id,qom.mapping_role
     FROM assessment_questions aq
     JOIN question_objective_mappings qom ON qom.assessment_question_id=aq.id AND qom.school_id=aq.school_id
     WHERE aq.school_id=? AND aq.assessment_id=?`,
    [schoolId, assessmentId],
  ).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return [[]]
    throw error
  })
  await connection.query(
    `DELETE qo
     FROM assessment_question_options qo
     JOIN assessment_questions q ON q.id = qo.question_id AND q.school_id = qo.school_id
     WHERE q.school_id = ? AND q.assessment_id = ?`,
    [schoolId, assessmentId],
  )
  await connection.query("DELETE FROM assessment_questions WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])

  for (const [index, question] of questions.entries()) {
    const [result] = await connection.query(
      `INSERT INTO assessment_questions (
        school_id, assessment_id, question_number, display_number, question_text, question_type, marks,
        topic_id, topic_text, subtopic_id, subtopic_text, difficulty, cognitive_skill,
        question_instructions, attachment_url, correct_answer, marking_scheme, explanation, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        assessmentId,
        question.question_number || index + 1,
        question.display_number || String(question.question_number || index + 1),
        question.question_text,
        question.question_type,
        question.marks,
        question.topic_id,
        question.topic_text,
        question.subtopic_id,
        question.subtopic_text,
        question.difficulty,
        question.cognitive_skill,
        question.question_instructions,
        question.attachment_url,
        question.correct_answer,
        question.marking_scheme,
        question.explanation,
        question.sort_order || index + 1,
      ],
    )

    if (question.options.length) {
      await connection.query(
        `INSERT INTO assessment_question_options (school_id, question_id, option_label, option_text, is_correct, sort_order)
         VALUES ?`,
        [question.options.map((option) => [schoolId, result.insertId, option.option_label, option.option_text, option.is_correct ? 1 : 0, option.sort_order])],
      )
    }
    const displayNumber = String(question.display_number || question.question_number || index + 1)
    const retainedTopics = previousMappings.filter((mapping) => String(mapping.display_number) === displayNumber)
    const retainedObjectives = previousObjectives.filter((mapping) => String(mapping.display_number) === displayNumber)
    if (retainedTopics.length) {
      for (const mapping of retainedTopics) await connection.query(
        `INSERT INTO question_topic_mappings (public_ref,school_id,assessment_question_id,topic_id,allocation_type,allocated_marks,allocated_percentage,is_primary,created_by,updated_by)
         VALUES (UUID(),?,?,?,?,?,?,?,?,?)`,
        [schoolId,result.insertId,mapping.topic_id,mapping.allocation_type,mapping.allocated_marks,mapping.allocated_percentage,mapping.is_primary,mappingActorId,mappingActorId],
      )
      await connection.query("UPDATE assessment_questions SET mapping_status='mapped' WHERE school_id=? AND id=?", [schoolId, result.insertId])
    }
    if (retainedObjectives.length) for (const mapping of retainedObjectives) await connection.query(
      `INSERT INTO question_objective_mappings (public_ref,school_id,assessment_question_id,learning_objective_id,mapping_role,created_by,updated_by)
       VALUES (UUID(),?,?,?,?,?,?)`,
      [schoolId,result.insertId,mapping.learning_objective_id,mapping.mapping_role,mappingActorId,mappingActorId],
    )
  }

  await connection.query("DELETE FROM assessment_topics WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
  const topicMap = new Map()
  questions.forEach((question) => {
    if (!question.topic_text) return
    const key = question.topic_text.toLowerCase()
    const current = topicMap.get(key) || { topic_name: question.topic_text, marks_allocated: 0, expected_difficulty: questionDifficultyToExpected(question.difficulty) }
    current.marks_allocated += Number(question.marks || 0)
    topicMap.set(key, current)
  })
  ;(Array.isArray(topicFallback) ? topicFallback : []).forEach((topic) => {
    const topicName = cleanText(topic.topic_name || topic.topicName)
    if (!topicName) return
    const key = topicName.toLowerCase()
    if (!topicMap.has(key)) {
      topicMap.set(key, {
        topic_name: topicName,
        marks_allocated: positiveNumber(topic.marks_allocated || topic.marksAllocated || 1, "Topic marks"),
        expected_difficulty: normalizeExpectedDifficulty(topic.expected_difficulty || topic.expectedDifficulty),
      })
    }
  })
  const topics = [...topicMap.values()]
  if (topics.length) {
    await connection.query(
      `INSERT INTO assessment_topics (school_id, assessment_id, topic_name, marks_allocated, expected_difficulty)
       VALUES ?`,
      [topics.map((topic) => [schoolId, assessmentId, topic.topic_name, topic.marks_allocated, topic.expected_difficulty])],
    )
  }
}

async function loadQuestions(connection, schoolId, assessmentId) {
  const [questions] = await connection.query(
    `SELECT *
     FROM assessment_questions
     WHERE school_id = ? AND assessment_id = ?
     ORDER BY sort_order, question_number, id`,
    [schoolId, assessmentId],
  )
  if (!questions.length) return []
  const [options] = await connection.query(
    `SELECT *
     FROM assessment_question_options
     WHERE school_id = ? AND question_id IN (${questions.map(() => "?").join(", ")})
     ORDER BY sort_order, option_label, id`,
    [schoolId, ...questions.map((question) => question.id)],
  )
  const questionIds = questions.map((question) => Number(question.id))
  const placeholders = questionIds.map(() => "?").join(",")
  const [topicMappings] = await connection.query(
    `SELECT qtm.assessment_question_id,qtm.allocation_type,qtm.allocated_marks,qtm.allocated_percentage,qtm.is_primary,
       st.public_ref topic_ref,st.topic_name
     FROM question_topic_mappings qtm
     JOIN syllabus_topics st ON st.id=qtm.topic_id AND st.school_id=qtm.school_id
     WHERE qtm.school_id=? AND qtm.assessment_question_id IN (${placeholders})
     ORDER BY qtm.is_primary DESC,qtm.id`,
    [schoolId, ...questionIds],
  ).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return [[]]
    throw error
  })
  const [objectiveMappings] = await connection.query(
    `SELECT qom.assessment_question_id,qom.mapping_role,lo.public_ref objective_ref,lo.objective_text
     FROM question_objective_mappings qom
     JOIN learning_objectives lo ON lo.id=qom.learning_objective_id AND lo.school_id=qom.school_id
     WHERE qom.school_id=? AND qom.assessment_question_id IN (${placeholders})
     ORDER BY qom.mapping_role,qom.id`,
    [schoolId, ...questionIds],
  ).catch((error) => {
    if (error?.code === "ER_NO_SUCH_TABLE") return [[]]
    throw error
  })
  const optionMap = new Map()
  options.forEach((option) => {
    const key = Number(option.question_id)
    const rows = optionMap.get(key) || []
    rows.push({
      id: Number(option.id),
      option_label: option.option_label,
      option_text: option.option_text,
      is_correct: Boolean(option.is_correct),
      sort_order: Number(option.sort_order || 0),
    })
    optionMap.set(key, rows)
  })
  return questions.map((question) => ({
    id: Number(question.id),
    question_number: Number(question.question_number),
    display_number: question.display_number || String(question.question_number),
    question_text: question.question_text,
    question_type: question.question_type,
    marks: Number(question.marks || 0),
    topic_id: question.topic_id ? Number(question.topic_id) : null,
    topic_text: question.topic_text || "",
    subtopic_id: question.subtopic_id ? Number(question.subtopic_id) : null,
    subtopic_text: question.subtopic_text || "",
    difficulty: question.difficulty,
    cognitive_skill: question.cognitive_skill || "",
    question_instructions: question.question_instructions || "",
    mapping_status: question.mapping_status || (question.topic_id ? "mapped" : "unmapped"),
    syllabus_strand: question.syllabus_strand || "",
    marking_points: safeJson(question.marking_points_json, []),
    topic_mappings: topicMappings.filter((mapping) => Number(mapping.assessment_question_id) === Number(question.id)).map((mapping) => ({
      topic_ref: mapping.topic_ref,
      topic_name: mapping.topic_name,
      allocation_type: mapping.allocation_type,
      allocated_marks: mapping.allocated_marks === null ? null : Number(mapping.allocated_marks),
      allocated_percentage: mapping.allocated_percentage === null ? null : Number(mapping.allocated_percentage),
      is_primary: Boolean(mapping.is_primary),
    })),
    objective_mappings: objectiveMappings.filter((mapping) => Number(mapping.assessment_question_id) === Number(question.id)).map((mapping) => ({
      objective_ref: mapping.objective_ref,
      objective_text: mapping.objective_text,
      mapping_role: mapping.mapping_role,
    })),
    attachment_url: question.attachment_url || "",
    correct_answer: question.correct_answer || "",
    marking_scheme: question.marking_scheme || "",
    explanation: question.explanation || "",
    sort_order: Number(question.sort_order || 0),
    options: optionMap.get(Number(question.id)) || [],
  }))
}

async function saveBlocks(connection, schoolId, assessmentId, blocks) {
  await connection.query("DELETE FROM assessment_blocks WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
  if (!blocks.length) return
  for (const [index, block] of blocks.entries()) {
    await connection.query(
      `INSERT INTO assessment_blocks (
        school_id, assessment_id, parent_block_id, block_type, content_json, style_json,
        metadata_json, sort_order, is_printable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        assessmentId,
        block.parent_block_id || null,
        block.block_type,
        JSON.stringify(block.content_json || {}),
        JSON.stringify(block.style_json || {}),
        JSON.stringify(block.metadata_json || {}),
        block.sort_order || index + 1,
        block.is_printable ? 1 : 0,
      ],
    )
  }
}

async function loadBlocks(connection, schoolId, assessmentId, assessment = {}, questions = []) {
  const [rows] = await connection.query(
    `SELECT *
     FROM assessment_blocks
     WHERE school_id = ? AND assessment_id = ?
     ORDER BY sort_order, id`,
    [schoolId, assessmentId],
  )
  if (!rows.length) return buildBlocksFromQuestions(assessment, questions)
  return rows.map((row) => ({
    id: Number(row.id),
    parent_block_id: row.parent_block_id ? Number(row.parent_block_id) : null,
    block_type: row.block_type,
    content_json: parseJsonColumn(row.content_json, {}),
    style_json: parseJsonColumn(row.style_json, {}),
    metadata_json: parseJsonColumn(row.metadata_json, {}),
    sort_order: Number(row.sort_order || 0),
    is_printable: Boolean(row.is_printable),
  }))
}

async function loadMedia(connection, schoolId, assessmentId) {
  const [rows] = await connection.query(
    `SELECT id, file_name, file_type, file_size, storage_path, alt_text, created_at, updated_at
     FROM assessment_media
     WHERE school_id = ? AND assessment_id = ?
     ORDER BY created_at DESC, id DESC`,
    [schoolId, assessmentId],
  )
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    file_size: Number(row.file_size || 0),
  }))
}

function validateReadyForReview(assessment, questions) {
  if (!cleanText(assessment.name)) throw new HttpError(400, "Assessment title is required")
  if (!assessment.academic_year_id || !assessment.term_id) throw new HttpError(400, "Academic year and term are required")
  if (!assessment.class_id || !assessment.subject_id) throw new HttpError(400, "Class and subject are required")
  if (!assessment.teacher_id) throw new HttpError(400, "Assigned teacher is required")
  if (Number(assessment.total_marks || 0) <= 0) throw new HttpError(400, "Total marks must be greater than 0")
  if (Number(assessment.duration_minutes || 0) <= 0) throw new HttpError(400, "Duration must be greater than 0")
  if (EXAM_SESSION_REQUIRED_TYPES.has(assessment.assessment_type) && !assessment.exam_session_id) {
    throw new HttpError(400, "End-of-term, mock, and final exam papers must be linked to an exam session")
  }
  if (!questions.length) throw new HttpError(400, "Add at least one question before submitting for review")

  const totalQuestionMarks = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
  if (Math.abs(totalQuestionMarks - Number(assessment.total_marks || 0)) > 0.001) {
    throw new HttpError(400, "Question marks must match the paper total marks before review")
  }

  questions.forEach((question, index) => {
    if (!question.question_text) throw new HttpError(400, `Question ${index + 1} needs question text`)
    if (Number(question.marks || 0) <= 0) throw new HttpError(400, `Question ${index + 1} marks must be greater than 0`)
    if (question.question_type === "multiple_choice") {
      const options = question.options || []
      if (options.length < 2) throw new HttpError(400, `Question ${index + 1} needs at least two multiple-choice options`)
      if (options.filter((option) => option.is_correct).length !== 1) throw new HttpError(400, `Question ${index + 1} needs exactly one correct option`)
    }
    if (FORMAL_TYPES.has(assessment.assessment_type) && !cleanText(question.marking_scheme)) {
      throw new HttpError(400, `Question ${index + 1} needs a marking scheme before review`)
    }
  })
}

export async function getAssessmentBuilderSetup(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const sessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]

  const [years] = await pool.query("SELECT * FROM academic_years WHERE school_id = ? AND status <> 'archived' ORDER BY start_date DESC, id DESC", [schoolId])
  const [terms] = await pool.query(
    `SELECT t.*, ay.name AS academic_year_name
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.school_id = ? AND t.status <> 'archived'
     ORDER BY ay.start_date DESC, t.term_number DESC, t.id DESC`,
    [schoolId],
  )

  const [assignmentRows] = await pool.query(
    `SELECT a.*, u.full_name AS teacher_name, c.name AS class_name, subj.name AS subject_name,
       ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND a.role = 'subject_teacher' AND a.subject_id IS NOT NULL AND a.is_active = 1
       ${isTeacher(req) ? "AND a.teacher_id = ?" : ""}${sessionClause}
     ORDER BY c.name, subj.name, u.full_name`,
    [schoolId, ...(isTeacher(req) ? [req.user.id] : []), ...sessionParams],
  )

  let classes = []
  let subjects = []
  if (isTeacher(req)) {
    const classMap = new Map()
    const subjectMap = new Map()
    assignmentRows.forEach((row) => {
      classMap.set(Number(row.class_id), { id: Number(row.class_id), name: row.class_name })
      subjectMap.set(Number(row.subject_id), { id: Number(row.subject_id), name: row.subject_name })
    })
    classes = [...classMap.values()].sort((a, b) => a.name.localeCompare(b.name))
    subjects = [...subjectMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  } else {
    const [[classRows], [subjectRows]] = await Promise.all([
      pool.query("SELECT id, name, grade_level FROM classes WHERE school_id = ? ORDER BY name", [schoolId]),
      pool.query("SELECT id, name, code FROM subjects WHERE school_id = ? ORDER BY name", [schoolId]),
    ])
    classes = classRows
    subjects = subjectRows
  }

  const [teachers] = isTeacher(req)
    ? [[{ id: req.user.id, full_name: req.user.fullName || req.user.email }]]
    : await pool.query("SELECT id, full_name, email FROM users WHERE school_id = ? AND role = 'teacher' AND is_active = 1 ORDER BY full_name", [schoolId])

  const examSessionParams = isTeacher(req) && !session.setupRequired ? [schoolId, session.academicYearId, session.termId] : [schoolId]
  const [examSessions] = await pool.query(
    `SELECT es.*, ay.name AS academic_year_name, t.name AS term_name
     FROM exam_sessions es
     JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.school_id = es.school_id
     JOIN terms t ON t.id = es.term_id AND t.school_id = es.school_id
     WHERE es.school_id = ? AND es.status NOT IN ('locked', 'archived')
       ${isTeacher(req) && !session.setupRequired ? "AND es.academic_year_id = ? AND es.term_id = ?" : ""}
     ORDER BY es.start_date DESC, es.id DESC`,
    examSessionParams,
  )

  let curricula = []
  let examTracks = []
  try {
    const [rows] = await pool.query(
      "SELECT id, name, country, is_active FROM curricula WHERE school_id = ? AND is_active = 1 ORDER BY name",
      [schoolId],
    )
    curricula = rows
  } catch {
    curricula = []
  }
  try {
    const [rows] = await pool.query(
      `SELECT et.id, et.name, et.track_type, et.grade_id, et.curriculum_id, et.is_active,
        c.name AS curriculum_name, c.country AS curriculum_country
       FROM exam_tracks et
       LEFT JOIN curricula c ON c.id = et.curriculum_id AND c.school_id = et.school_id
       WHERE et.school_id = ? AND et.is_active = 1
       ORDER BY c.name, et.name`,
      [schoolId],
    )
    examTracks = rows
  } catch {
    examTracks = []
  }

  res.json({
    session: sessionPayload(session),
    setup_required: session.setupRequired,
    years,
    terms,
    classes,
    subjects,
    teachers,
    assignments: assignmentRows.map((row) => ({
      id: Number(row.id),
      teacher_id: Number(row.teacher_id),
      teacher_name: row.teacher_name,
      class_id: Number(row.class_id),
      class_name: row.class_name,
      subject_id: Number(row.subject_id),
      subject_name: row.subject_name,
      academic_year_id: row.academic_year_id ? Number(row.academic_year_id) : null,
      term_id: row.term_id ? Number(row.term_id) : null,
      role: row.role,
      is_active: Boolean(row.is_active),
    })),
    exam_sessions: examSessions,
    curricula,
    exam_tracks: examTracks,
  })
}

export async function listAssessments(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const includeHistory = String(req.query.include_history || req.query.includeHistory || "").toLowerCase() === "true"
  const includeArchived = String(req.query.include_archived || req.query.includeArchived || "").toLowerCase() === "true"
  const clauses = ["a.school_id = ?"]
  const params = [schoolId]

  if (!includeArchived) clauses.push("a.status <> 'archived'")

  const academicYearId = idValue(req.query.academic_year_id || req.query.academicYearId)
  const termId = idValue(req.query.term_id || req.query.termId)
  if (academicYearId) {
    clauses.push("a.academic_year_id = ?")
    params.push(academicYearId)
  } else if (!includeHistory && !session.setupRequired) {
    clauses.push("a.academic_year_id = ?")
    params.push(session.academicYearId)
  }
  if (termId) {
    clauses.push("a.term_id = ?")
    params.push(termId)
  } else if (!includeHistory && !session.setupRequired) {
    clauses.push("a.term_id = ?")
    params.push(session.termId)
  }

  const filters = {
    class_id: idValue(req.query.class_id || req.query.classId),
    subject_id: idValue(req.query.subject_id || req.query.subjectId),
    exam_session_id: idValue(req.query.exam_session_id || req.query.examSessionId),
    teacher_id: idValue(req.query.teacher_id || req.query.teacherId),
  }
  Object.entries(filters).forEach(([key, value]) => {
    if (!value) return
    if (key === "teacher_id" && isTeacher(req)) return
    clauses.push(`a.${key} = ?`)
    params.push(value)
  })

  const status = cleanText(req.query.status)
  if (status) {
    clauses.push("a.status = ?")
    params.push(status)
  }
  const assessmentType = cleanText(req.query.assessment_type || req.query.assessmentType)
  if (assessmentType) {
    clauses.push("a.assessment_type = ?")
    params.push(assessmentType)
  }
  const search = cleanText(req.query.q || req.query.search)
  if (search) {
    clauses.push("(a.name LIKE ? OR c.name LIKE ? OR subj.name LIKE ? OR teacher.full_name LIKE ? OR es.name LIKE ?)")
    params.push(...Array(5).fill(`%${search}%`))
  }
  if (isTeacher(req)) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM teacher_class_subject_assignments ta
        WHERE ta.school_id = a.school_id AND ta.teacher_id = ? AND ta.class_id = a.class_id AND ta.subject_id = a.subject_id
          AND ta.role = 'subject_teacher' AND ta.is_active = 1
          AND (ta.academic_year_id = a.academic_year_id OR ta.academic_year_id IS NULL)
          AND (ta.term_id = a.term_id OR ta.term_id IS NULL)
      )`,
    )
    params.push(req.user.id)
  }

  const [rows] = await pool.query(
    `SELECT a.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
       es.name AS exam_session_name, ay.name AS academic_year_name,
       returned.full_name AS returned_by_name, approved.full_name AS approved_by_name,
       COUNT(DISTINCT q.id) AS question_count,
       COALESCE(SUM(q.marks), 0) AS question_marks
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN users teacher ON teacher.id = a.teacher_id AND teacher.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN users returned ON returned.id = a.returned_by AND returned.school_id = a.school_id
     LEFT JOIN users approved ON approved.id = a.approved_by AND approved.school_id = a.school_id
     LEFT JOIN assessment_questions q ON q.assessment_id = a.id AND q.school_id = a.school_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY a.id
     ORDER BY a.updated_at DESC, a.id DESC`,
    params,
  )
  res.json({ assessments: rows.map(rowToAssessment), session: sessionPayload(session), setup_required: session.setupRequired })
}

export async function getAssessment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id)
  if (!assessmentId) throw new HttpError(400, "Assessment id is required")
  const connection = pool
  const assessment = await loadAssessmentBase(connection, schoolId, assessmentId)
  await assertAssessmentReadable(connection, req, schoolId, assessment)
  const questions = await loadQuestions(connection, schoolId, assessmentId)
  const normalizedAssessment = rowToAssessment(assessment)
  const blocks = await loadBlocks(connection, schoolId, assessmentId, normalizedAssessment, questions)
  const media = await loadMedia(connection, schoolId, assessmentId)
  res.json({ assessment: normalizedAssessment, questions, blocks, media, review: buildReviewChecks(normalizedAssessment, questions) })
}

export async function saveAssessmentDraft(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id || req.body.id)
  const payload = req.body || {}
  const assessmentType = normalizeAssessmentType(payload.assessment_type || payload.assessmentType)
  const name = cleanText(payload.name || payload.title)
  const classId = idValue(payload.class_id || payload.classId)
  const subjectId = idValue(payload.subject_id || payload.subjectId)
  const streamSection = cleanText(payload.stream_section || payload.streamSection) || null
  const totalMarks = positiveNumber(payload.total_marks || payload.totalMarks, "Total marks")
  const durationMinutes = positiveNumber(payload.duration_minutes || payload.durationMinutes, "Duration", false)
  if (!name) throw new HttpError(400, "Assessment title is required")
  if (!classId || !subjectId) throw new HttpError(400, "Class and subject are required")

  const blocks = normalizeBlockInput(payload.blocks || [])
  const questionSource = Array.isArray(payload.questions) && payload.questions.length ? payload.questions : questionsFromBlocks(blocks)
  const questions = normalizeQuestionInput(questionSource || [], "draft")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const existing = assessmentId ? await loadAssessmentBase(connection, schoolId, assessmentId) : null
    if (existing) await assertAssessmentEditable(connection, req, schoolId, existing)

    const sessionContext = await resolveSessionContext(connection, schoolId, payload, assessmentType)
    await validateSchoolScope(connection, schoolId, { classId, subjectId, academicYearId: sessionContext.academicYearId, termId: sessionContext.termId })
    const requestedTeacherId = idValue(payload.teacher_id || payload.teacherId)
    const assignedTeacher = await resolveAssignedTeacher(connection, req, schoolId, classId, subjectId, sessionContext.academicYearId, sessionContext.termId, requestedTeacherId)

    let savedId = assessmentId
    if (existing) {
      await connection.query(
        `UPDATE assessments
         SET exam_session_id = ?, class_id = ?, stream_section = ?, subject_id = ?, academic_year_id = ?, term_id = ?,
          teacher_id = ?, name = ?, assessment_type = ?, term_name = ?, total_marks = ?, duration_minutes = ?,
          instructions = ?, expected_difficulty = ?
         WHERE id = ? AND school_id = ?`,
        [
          sessionContext.examSessionId,
          classId,
          streamSection,
          subjectId,
          sessionContext.academicYearId,
          sessionContext.termId,
          assignedTeacher.id,
          name,
          assessmentType,
          sessionContext.termName,
          totalMarks,
          durationMinutes,
          cleanText(payload.instructions) || null,
          normalizeExpectedDifficulty(payload.expected_difficulty || payload.expectedDifficulty),
          assessmentId,
          schoolId,
        ],
      )
    } else {
      const [result] = await connection.query(
        `INSERT INTO assessments (
          school_id, exam_session_id, class_id, stream_section, subject_id, academic_year_id, term_id, teacher_id,
          name, assessment_type, term_name, total_marks, duration_minutes, instructions, expected_difficulty, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [
          schoolId,
          sessionContext.examSessionId,
          classId,
          streamSection,
          subjectId,
          sessionContext.academicYearId,
          sessionContext.termId,
          assignedTeacher.id,
          name,
          assessmentType,
          sessionContext.termName,
          totalMarks,
          durationMinutes,
          cleanText(payload.instructions) || null,
          normalizeExpectedDifficulty(payload.expected_difficulty || payload.expectedDifficulty),
          req.user.id,
        ],
      )
      savedId = Number(result.insertId)
    }

    await saveQuestions(connection, schoolId, savedId, questions, payload.topics || [])
    const blocksToSave = blocks.length
      ? blocks
      : buildBlocksFromQuestions({
        name,
        instructions: cleanText(payload.instructions) || null,
      }, questions)
    await saveBlocks(connection, schoolId, savedId, blocksToSave)
    await connection.commit()
    const assessment = await loadAssessmentBase(pool, schoolId, savedId)
    const savedQuestions = await loadQuestions(pool, schoolId, savedId)
    const normalizedAssessment = rowToAssessment(assessment)
    const savedBlocks = await loadBlocks(pool, schoolId, savedId, normalizedAssessment, savedQuestions)
    const media = await loadMedia(pool, schoolId, savedId)
    res.status(existing ? 200 : 201).json({
      assessment: normalizedAssessment,
      questions: savedQuestions,
      blocks: savedBlocks,
      media,
      review: buildReviewChecks(normalizedAssessment, savedQuestions),
      message: "Assessment draft saved.",
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createAssessment(req, res) {
  return saveAssessmentDraft(req, res)
}

export async function uploadAssessmentMedia(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id)
  if (!assessmentId) throw new HttpError(400, "Assessment id is required")

  const connection = await pool.getConnection()
  try {
    const assessment = await loadAssessmentBase(connection, schoolId, assessmentId)
    await assertAssessmentEditable(connection, req, schoolId, assessment)

    const fileName = cleanText(req.body.file_name || req.body.fileName || "assessment-image")
    const fileType = cleanText(req.body.file_type || req.body.fileType)
    const dataUrl = cleanText(req.body.data_url || req.body.dataUrl)
    const altText = cleanText(req.body.alt_text || req.body.altText) || null
    if (!IMAGE_TYPES.has(fileType)) throw new HttpError(400, "Only PNG, JPEG, WebP, GIF, and SVG images are supported")
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new HttpError(400, "Image upload payload is invalid")
    if (match[1] !== fileType) throw new HttpError(400, "Image type does not match the upload payload")

    const buffer = Buffer.from(match[2], "base64")
    if (!buffer.length) throw new HttpError(400, "Image file is empty")
    if (buffer.length > 5 * 1024 * 1024) throw new HttpError(400, "Image file must be 5MB or smaller")

    const extensionMap = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
    }
    const extension = extensionMap[fileType] || "img"
    const safeName = safePathPart(fileName.replace(/\.[^.]+$/, ""), "assessment-image").slice(0, 80)
    const assessmentFolder = assessmentMediaFolderName(assessment, assessmentId)
    const folder = path.resolve(process.cwd(), "uploads", "assessment-media", String(schoolId), assessmentFolder)
    await fs.mkdir(folder, { recursive: true })
    const storedName = `${Date.now()}-${safeName}.${extension}`
    const storagePath = path.join(folder, storedName)
    await fs.writeFile(storagePath, buffer)
    const publicPath = `/uploads/assessment-media/${schoolId}/${assessmentFolder}/${storedName}`

    const [result] = await connection.query(
      `INSERT INTO assessment_media (
        school_id, assessment_id, uploaded_by, file_name, file_type, file_size, storage_path, alt_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, assessmentId, req.user.id, fileName, fileType, buffer.length, publicPath, altText],
    )
    res.status(201).json({
      media: {
        id: Number(result.insertId),
        file_name: fileName,
        file_type: fileType,
        file_size: buffer.length,
        storage_path: publicPath,
        alt_text: altText,
      },
      message: "Image uploaded.",
    })
  } finally {
    connection.release()
  }
}

export async function exportAssessmentPdf(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id)
  if (!assessmentId) throw new HttpError(400, "Assessment id is required")

  const assessment = await loadAssessmentBase(pool, schoolId, assessmentId)
  await assertAssessmentReadable(pool, req, schoolId, assessment)
  const normalizedAssessment = rowToAssessment(assessment)
  const [questions, media, [schoolRows]] = await Promise.all([
    loadQuestions(pool, schoolId, assessmentId),
    loadMedia(pool, schoolId, assessmentId),
    pool.query("SELECT name FROM schools WHERE id = ? LIMIT 1", [schoolId]),
  ])
  const blocks = await loadBlocks(pool, schoolId, assessmentId, normalizedAssessment, questions)
  const variant = normalizeAssessmentExportVariant(req.query.variant)
  const pdf = await buildAssessmentPdf({
    assessment: normalizedAssessment,
    questions,
    blocks,
    media,
    schoolName: schoolRows?.[0]?.name || "",
    variant,
  })
  const filename = assessmentExportFilename(normalizedAssessment, variant)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  res.setHeader("Content-Length", String(pdf.length))
  res.send(pdf)
}

export async function transitionAssessmentStatus(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id)
  const status = cleanText(req.body.status)
  if (!assessmentId) throw new HttpError(400, "Assessment id is required")
  if (!status) throw new HttpError(400, "Status is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await loadAssessmentBase(connection, schoolId, assessmentId)
    await assertAssessmentReadable(connection, req, schoolId, assessment)
    if (["locked", "archived"].includes(String(assessment.status || "")) && status !== "archived") {
      throw new HttpError(409, "This paper is locked.")
    }
    const questions = await loadQuestions(connection, schoolId, assessmentId)

    if (isTeacher(req)) {
      if (status !== "ready_for_review") throw new HttpError(403, "Teachers can only submit papers for review")
      if (!TEACHER_EDITABLE_STATUSES.has(String(assessment.status || ""))) throw new HttpError(403, "You do not have permission to edit this paper.")
      validateReadyForReview(assessment, questions)
      await connection.query(
        "UPDATE assessments SET status = 'ready_for_review', return_reason = NULL, returned_by = NULL, returned_at = NULL WHERE id = ? AND school_id = ?",
        [assessmentId, schoolId],
      )
    } else if (isLeadership(req)) {
      if (!["approved", "returned", "scheduled", "locked", "archived", "draft"].includes(status)) throw new HttpError(400, "Status transition is invalid")
      if (status === "approved") {
        validateReadyForReview(assessment, questions)
        await connection.query(
          "UPDATE assessments SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, return_reason = NULL, returned_by = NULL, returned_at = NULL WHERE id = ? AND school_id = ?",
          [req.user.id, assessmentId, schoolId],
        )
      } else if (status === "returned") {
        const returnReason = cleanText(req.body.return_reason || req.body.returnReason)
        if (!returnReason) throw new HttpError(400, "Return reason is required")
        await connection.query(
          "UPDATE assessments SET status = 'returned', return_reason = ?, returned_by = ?, returned_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?",
          [returnReason, req.user.id, assessmentId, schoolId],
        )
      } else if (status === "scheduled") {
        if (!["approved", "scheduled"].includes(String(assessment.status || ""))) throw new HttpError(400, "Only approved papers can be scheduled")
        await connection.query("UPDATE assessments SET status = 'scheduled' WHERE id = ? AND school_id = ?", [assessmentId, schoolId])
      } else if (status === "locked") {
        await connection.query("UPDATE assessments SET status = 'locked' WHERE id = ? AND school_id = ?", [assessmentId, schoolId])
      } else if (status === "archived") {
        await connection.query("UPDATE assessments SET status = 'archived' WHERE id = ? AND school_id = ?", [assessmentId, schoolId])
      } else {
        await connection.query("UPDATE assessments SET status = 'draft' WHERE id = ? AND school_id = ?", [assessmentId, schoolId])
      }
    } else {
      throw new HttpError(403, "You do not have permission to edit this paper.")
    }

    await connection.commit()
    const nextAssessment = await loadAssessmentBase(pool, schoolId, assessmentId)
    const nextQuestions = await loadQuestions(pool, schoolId, assessmentId)
    const normalizedAssessment = rowToAssessment(nextAssessment)
    res.json({
      assessment: normalizedAssessment,
      questions: nextQuestions,
      blocks: await loadBlocks(pool, schoolId, assessmentId, normalizedAssessment, nextQuestions),
      media: await loadMedia(pool, schoolId, assessmentId),
      review: buildReviewChecks(normalizedAssessment, nextQuestions),
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteAssessment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = idValue(req.params.id)
  if (!assessmentId) throw new HttpError(400, "Assessment id is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await loadAssessmentBase(connection, schoolId, assessmentId)
    await assertAssessmentReadable(connection, req, schoolId, assessment)

    if (String(assessment.status || "") !== "draft") {
      throw new HttpError(409, "Only draft papers can be deleted.")
    }

    const [[links]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM exam_timetable_entries WHERE school_id = ? AND assessment_id = ?) AS timetable_count,
        (SELECT COUNT(*) FROM timetable_entries WHERE school_id = ? AND assessment_id = ?) AS weekly_timetable_count,
        (SELECT COUNT(*) FROM result_batches WHERE school_id = ? AND assessment_id = ?) AS result_batch_count,
        (SELECT COUNT(*) FROM subject_results WHERE school_id = ? AND assessment_id = ?) AS subject_result_count`,
      [schoolId, assessmentId, schoolId, assessmentId, schoolId, assessmentId, schoolId, assessmentId],
    )
    if (Number(links?.timetable_count || 0) || Number(links?.weekly_timetable_count || 0) || Number(links?.result_batch_count || 0) || Number(links?.subject_result_count || 0)) {
      throw new HttpError(409, "This draft is already linked to a timetable or student results. Remove those links before deleting the paper.", {
        code: "ASSESSMENT_IN_USE",
        details: {
          exam_timetable_entries: Number(links?.timetable_count || 0),
          timetable_entries: Number(links?.weekly_timetable_count || 0),
          result_batches: Number(links?.result_batch_count || 0),
          student_results: Number(links?.subject_result_count || 0),
        },
      })
    }

    const [mediaRows] = await connection.query(
      "SELECT storage_path FROM assessment_media WHERE school_id = ? AND assessment_id = ?",
      [schoolId, assessmentId],
    )

    await connection.query(
      `DELETE atm FROM assessment_topic_marks atm
       JOIN assessment_topics at ON at.id = atm.assessment_topic_id AND at.school_id = atm.school_id
       WHERE at.school_id = ? AND at.assessment_id = ?`,
      [schoolId, assessmentId],
    )
    await connection.query(
      `DELETE qo FROM assessment_question_options qo
       JOIN assessment_questions q ON q.id = qo.question_id AND q.school_id = qo.school_id
       WHERE q.school_id = ? AND q.assessment_id = ?`,
      [schoolId, assessmentId],
    )
    await connection.query("UPDATE assessment_blocks SET parent_block_id = NULL WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("DELETE FROM assessment_blocks WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("DELETE FROM assessment_media WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("DELETE FROM assessment_questions WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("DELETE FROM assessment_topics WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("UPDATE assessment_import_jobs SET assessment_id = NULL WHERE school_id = ? AND assessment_id = ?", [schoolId, assessmentId])
    await connection.query("DELETE FROM assessments WHERE school_id = ? AND id = ?", [schoolId, assessmentId])

    await connection.commit()

    const uploadFolders = new Set([
      path.resolve(process.cwd(), "uploads", "assessment-media", String(schoolId), String(assessmentId)),
      path.resolve(process.cwd(), "uploads", "assessment-media", String(schoolId), assessmentMediaFolderName(assessment, assessmentId)),
    ])
    mediaRows.forEach((row) => {
      if (!row.storage_path) return
      uploadFolders.add(path.dirname(path.resolve(process.cwd(), String(row.storage_path).replace(/^\/+/, ""))))
    })
    ;[...uploadFolders].forEach((folder) => {
      fs.rm(folder, { recursive: true, force: true }).catch(() => {})
    })

    res.json({ ok: true, id: assessmentId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function topicInsights(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ topics: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "a.class_id")
  const [rows] = await pool.query(
    `SELECT subj.name AS subject_name, at.topic_name,
       ROUND(AVG((atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100), 1) AS average_score,
       SUM(CASE WHEN (atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100 < 50 THEN 1 ELSE 0 END) AS students_needing_support
     FROM assessment_topics at
     JOIN assessments a ON a.id = at.assessment_id AND a.school_id = at.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN assessment_topic_marks atm ON atm.assessment_topic_id = at.id AND atm.school_id = at.school_id
     WHERE at.school_id = ? AND a.academic_year_id = ? AND a.term_id = ?${classScope.clause}
     GROUP BY subj.name, at.topic_name
     ORDER BY average_score ASC`,
    [schoolId, session.academicYearId, session.termId, ...classScope.params],
  )

  res.json({
    topics: rows.map((row) => ({
      ...row,
      difficulty: classifyDifficulty(row.average_score),
      recommendation: buildTopicRecommendation(row),
    })),
    session: sessionPayload(session),
    setup_required: false,
  })
}

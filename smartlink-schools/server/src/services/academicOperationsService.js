import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import {
  evaluateInterventionEffectiveness,
  getAcademicEngineConfig,
  recalculateClassMastery,
  recalculateStudentMastery,
  recordAcademicIntelligenceSnapshot,
} from "./academicIntelligenceEngine.js"
import {
  evaluateInterventionDelivery,
  getInterventionDeliveryMetrics,
  recordSupportCaseEvent,
  syncSupportCasesFromPublishedAssessment,
} from "./academicSupportService.js"
import { generateDraftQuestions } from "./questions/questionDraftingService.js"

const EPSILON = 0.01
const ENTRY_MODES = new Set(["question", "topic", "overall"])
const PARTICIPATION_STATES = new Set(["pending", "present", "absent", "incomplete", "excused"])
const GENERATED_PURPOSES = new Set([
  "diagnostic", "prerequisite_check", "intervention_baseline", "intervention_reassessment",
  "mastery_confirmation", "catch_up_test", "exam_preparation", "misconception_check",
])

export const ACADEMIC_EVIDENCE_LEVELS = Object.freeze({
  QUESTION: { level: 1, key: "question", label: "Question-level", potentialConfidence: "high", topicClaimsAllowed: true },
  SECTION: { level: 2, key: "section", label: "Section-level", potentialConfidence: "medium", topicClaimsAllowed: true },
  TOPIC: { level: 3, key: "topic", label: "Topic-total", potentialConfidence: "medium_or_low", topicClaimsAllowed: true },
  OVERALL: { level: 4, key: "overall", label: "Overall total", potentialConfidence: "low", topicClaimsAllowed: false },
})

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits))
const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Number(value || 0)))
const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value)) } catch { return fallback }
}
const masteryState = (percentage, config = {}) => {
  if (percentage === null || percentage === undefined) return "not_assessed"
  const secure = Number(config.mastery_threshold ?? config.masteryThreshold ?? 70)
  const intervention = Number(config.intervention_threshold ?? config.interventionThreshold ?? 45)
  const advanced = Number(config.advanced_threshold ?? Math.min(100, secure + 15))
  return percentage >= advanced ? "advanced" : percentage >= secure ? "secure" : percentage >= intervention ? "developing" : "emerging"
}

export function sourcePermissionAllowsReuse(permission = {}, { transform = false } = {}) {
  const status = String(permission.permission_status || permission.status || "unknown_permission")
  const permittedStatus = new Set(["school_owned", "teacher_authored", "public_domain", "licensed", "internal_use_only", "attribution_required"])
  if (!permittedStatus.has(status)) return false
  if (!Number(permission.reuse_allowed ?? 0)) return false
  if (transform && !Number(permission.transformation_allowed ?? 0)) return false
  return true
}

export function validateQuestionTopicMappings(question = {}, rawMappings = []) {
  const questionMarks = Number(question.marks || question.maximum_marks || 0)
  const mappings = (Array.isArray(rawMappings) ? rawMappings : []).map((mapping) => ({
    ...mapping,
    topic_id: Number(mapping.topic_id || 0),
    allocation_type: String(mapping.allocation_type || (mapping.allocated_percentage !== undefined ? "percentage" : "marks")),
    allocated_marks: mapping.allocated_marks === null || mapping.allocated_marks === undefined || mapping.allocated_marks === "" ? null : Number(mapping.allocated_marks),
    allocated_percentage: mapping.allocated_percentage === null || mapping.allocated_percentage === undefined || mapping.allocated_percentage === "" ? null : Number(mapping.allocated_percentage),
    is_primary: Boolean(mapping.is_primary || mapping.allocation_type === "primary"),
  }))
  const errors = []
  if (!Number.isFinite(questionMarks) || questionMarks <= 0) errors.push("Question marks must be greater than zero.")
  if (!mappings.length) errors.push("Every question or subquestion must map to at least one valid topic.")
  if (mappings.some((mapping) => !mapping.topic_id)) errors.push("Every topic mapping needs a valid topic.")
  if (new Set(mappings.map((mapping) => mapping.topic_id)).size !== mappings.length) errors.push("A topic can only be mapped once per question.")

  let normalized = mappings
  if (mappings.length === 1 && mappings[0]) {
    normalized = [{ ...mappings[0], allocation_type: "marks", allocated_marks: questionMarks, allocated_percentage: 100, is_primary: true }]
  } else if (mappings.length > 1) {
    const modes = new Set(mappings.map((mapping) => mapping.allocation_type))
    const primaryTagMode = [...modes].every((mode) => ["primary", "secondary"].includes(mode))
    if (primaryTagMode) {
      const primary = mappings.filter((mapping) => mapping.allocation_type === "primary" || mapping.is_primary)
      if (primary.length !== 1) errors.push("Primary-plus-secondary mapping requires exactly one primary topic.")
      normalized = mappings.map((mapping) => ({
        ...mapping,
        is_primary: primary.includes(mapping),
        allocated_marks: primary.includes(mapping) ? questionMarks : 0,
        allocated_percentage: primary.includes(mapping) ? 100 : 0,
      }))
    } else if ([...modes].every((mode) => mode === "marks")) {
      if (mappings.some((mapping) => !Number.isFinite(mapping.allocated_marks) || mapping.allocated_marks < 0)) errors.push("Every mapped topic needs a non-negative mark allocation.")
      const allocated = mappings.reduce((sum, mapping) => sum + Number(mapping.allocated_marks || 0), 0)
      if (Math.abs(allocated - questionMarks) > EPSILON) errors.push(`Mapped topic marks must equal the question's ${questionMarks} available marks.`)
      normalized = mappings.map((mapping, index) => ({ ...mapping, allocated_percentage: questionMarks ? round(Number(mapping.allocated_marks || 0) / questionMarks * 100) : 0, is_primary: mapping.is_primary || index === 0 }))
    } else if ([...modes].every((mode) => mode === "percentage")) {
      if (mappings.some((mapping) => !Number.isFinite(mapping.allocated_percentage) || mapping.allocated_percentage < 0)) errors.push("Every mapped topic needs a non-negative percentage allocation.")
      const allocated = mappings.reduce((sum, mapping) => sum + Number(mapping.allocated_percentage || 0), 0)
      if (Math.abs(allocated - 100) > EPSILON) errors.push("Mapped topic percentages must total 100%.")
      normalized = mappings.map((mapping, index) => ({ ...mapping, allocated_marks: round(questionMarks * Number(mapping.allocated_percentage || 0) / 100), is_primary: mapping.is_primary || index === 0 }))
    } else {
      errors.push("Multi-topic mappings must consistently use marks, percentages, or one primary topic with secondary tags.")
    }
  }
  return { valid: errors.length === 0, errors, mappings: normalized }
}

export function confidenceForEvidenceLevel(level, { mappedMarks = 0, questionCount = 0, mappingCoverage = 100 } = {}) {
  const coverage = clamp(mappingCoverage) / 100
  if (level === "question") return round(clamp(55 + Math.min(20, Number(mappedMarks)) + Math.min(15, Number(questionCount) * 3)) * coverage)
  if (level === "section") return round((45 + Math.min(25, Number(mappedMarks))) * coverage)
  if (level === "topic") return round((35 + Math.min(25, Number(mappedMarks))) * coverage)
  return round(20 * coverage)
}

export function aggregateQuestionEvidence({ questions = [], marks = {}, config = {} } = {}) {
  const topics = new Map()
  let totalAwarded = 0
  let totalAvailable = 0
  let markedQuestions = 0
  let mappedQuestions = 0
  for (const question of questions) {
    const key = String(question.id ?? question.question_id ?? question.public_ref)
    const raw = marks[key]
    if (raw === null || raw === undefined || raw === "") continue
    const awarded = Number(raw)
    const available = Number(question.marks || question.marks_available || 0)
    if (!Number.isFinite(awarded) || awarded < 0 || awarded > available + EPSILON) throw new Error(`${question.display_number || `Question ${key}`} must be between 0 and ${available}.`)
    totalAwarded += awarded
    totalAvailable += available
    markedQuestions += 1
    const validation = validateQuestionTopicMappings(question, question.topic_mappings || [])
    if (!validation.valid) continue
    mappedQuestions += 1
    for (const mapping of validation.mappings) {
      const mappedAvailable = Number(mapping.allocated_marks || 0)
      if (mappedAvailable <= 0) continue
      const topicKey = String(mapping.topic_id)
      const current = topics.get(topicKey) || { topic_id: Number(mapping.topic_id), topic_ref: mapping.topic_ref || null, topic_name: mapping.topic_name || null, marks_awarded: 0, marks_available: 0, source_question_ids: [] }
      current.marks_available += mappedAvailable
      current.marks_awarded += available ? awarded * mappedAvailable / available : 0
      current.source_question_ids.push(question.id ?? question.question_id ?? question.public_ref)
      topics.set(topicKey, current)
    }
  }
  const mappingCoverage = markedQuestions ? mappedQuestions / markedQuestions * 100 : 0
  return {
    total_awarded: round(totalAwarded),
    total_available: round(totalAvailable),
    percentage: totalAvailable ? round(totalAwarded / totalAvailable * 100) : null,
    marked_questions: markedQuestions,
    mapped_questions: mappedQuestions,
    mapping_coverage: round(mappingCoverage),
    confidence_score: confidenceForEvidenceLevel("question", { mappedMarks: totalAvailable, questionCount: markedQuestions, mappingCoverage }),
    topics: [...topics.values()].map((topic) => ({ ...topic, marks_awarded: round(topic.marks_awarded), marks_available: round(topic.marks_available), percentage: topic.marks_available ? round(topic.marks_awarded / topic.marks_available * 100) : null, mastery_state: masteryState(topic.marks_available ? topic.marks_awarded / topic.marks_available * 100 : null, config) })),
  }
}

export function validateMarkSheetPayload({ mode, entries = [], questions = [], topics = [], totalMarks = 0 } = {}) {
  const errors = []
  if (!ENTRY_MODES.has(String(mode))) errors.push("Entry mode must be question, topic, or overall.")
  if (!Array.isArray(entries) || !entries.length) errors.push("At least one learner entry is required.")
  const questionMap = new Map(questions.map((question) => [String(question.id ?? question.question_id), Number(question.marks || 0)]))
  const topicMap = new Map(topics.map((topic) => [String(topic.topic_id ?? topic.id), Number(topic.marks_available ?? topic.marks ?? 0)]))
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const label = entry.student_name || `Learner ${index + 1}`
    if (!Number(entry.student_id || 0)) errors.push(`${label} needs a valid learner.`)
    const participation = String(entry.participation_status || "present")
    if (!PARTICIPATION_STATES.has(participation)) errors.push(`${label} has an invalid participation status.`)
    if (["absent", "excused"].includes(participation)) continue
    if (mode === "question") for (const [questionId, value] of Object.entries(entry.question_marks || {})) {
      if (!questionMap.has(String(questionId))) errors.push(`${label} contains an unknown question.`)
      else if (value !== "" && value !== null && value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > questionMap.get(String(questionId)) + EPSILON)) errors.push(`${label}'s mark for question ${questionId} must be between 0 and ${questionMap.get(String(questionId))}.`)
    }
    if (mode === "topic") for (const [topicId, value] of Object.entries(entry.topic_marks || {})) {
      if (!topicMap.has(String(topicId))) errors.push(`${label} contains an unknown topic.`)
      else if (value !== "" && value !== null && value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > topicMap.get(String(topicId)) + EPSILON)) errors.push(`${label}'s mark for topic ${topicId} must be between 0 and ${topicMap.get(String(topicId))}.`)
    }
    if (mode === "overall" && entry.overall_marks !== "" && entry.overall_marks !== null && entry.overall_marks !== undefined && (!Number.isFinite(Number(entry.overall_marks)) || Number(entry.overall_marks) < 0 || Number(entry.overall_marks) > Number(totalMarks) + EPSILON)) errors.push(`${label}'s total must be between 0 and ${Number(totalMarks)}.`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateGeneratedAssessmentDraft(paper = {}, options = {}) {
  const errors = []
  const warnings = []
  const questions = Array.isArray(paper.questions) ? paper.questions : (paper.sections || []).flatMap((section) => section.questions || [])
  const total = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
  if (!questions.length) errors.push("The assessment needs at least one question.")
  if (questions.some((question) => !String(question.question_text || question.questionText || "").trim())) errors.push("Every generated question needs wording.")
  if (questions.some((question) => !String(question.correct_answer || question.expected_answer || question.expectedAnswer || "").trim())) errors.push("Every generated question needs an answer or marking key.")
  if (questions.some((question) => !Number.isFinite(Number(question.marks)) || Number(question.marks) <= 0)) errors.push("Every generated question needs valid marks.")
  if (questions.some((question) => question.question_type === "multiple_choice" && (!Array.isArray(question.options) || question.options.length < 2))) errors.push("Every generated multiple-choice question needs at least two answer options.")
  if (Math.abs(total - Number(options.totalMarks ?? paper.total_marks ?? paper.totalMarks ?? total)) > EPSILON) errors.push("Question marks must equal the assessment total.")
  if (new Set(questions.map((question) => String(question.question_text || question.questionText).trim().toLowerCase())).size !== questions.length) errors.push("Duplicate questions must be replaced before approval.")
  if (questions.some((question) => !question.topic_id && !question.topicId)) errors.push("Every generated question needs a valid topic mapping.")
  if (questions.some((question) => {
    const response = question.response_layout || question.responseLayout || question.style_json || {}
    return !response.answer_space_type || response.answer_space_type === "none" || Number(response.answer_height || 0) <= 0
  })) errors.push("Every generated question needs a printable learner answer space.")
  if (questions.some((question) => question.source_permission && !sourcePermissionAllowsReuse(question.source_permission, { transform: Boolean(question.transformation_type && question.transformation_type !== "verbatim") }))) errors.push("One or more source questions do not permit the requested reuse.")
  if (questions.length < 3) warnings.push("Very short assessments provide limited diagnostic confidence.")
  return { valid: errors.length === 0, errors, warnings, total_marks: round(total), question_count: questions.length }
}

export function buildGeneratedResponseLayout(question = {}) {
  const marks = Math.max(1, Number(question.marks || 1))
  const type = String(question.question_type || question.questionType || "structured")
  if (["multiple_choice", "true_false", "fill_blank"].includes(type)) {
    return { answer_space_type: "blank_box", answer_lines: 0, answer_height: 56, show_border: true }
  }
  if (type === "calculation") {
    return { answer_space_type: "blank_box", answer_lines: 0, answer_height: Math.min(320, Math.max(120, Math.round(marks * 34))), show_border: true }
  }
  const lineMultiplier = type === "essay" ? 2 : 1
  const answerLines = Math.min(24, Math.max(2, Math.ceil(marks * lineMultiplier)))
  return { answer_space_type: "ruled_lines", answer_lines: answerLines, answer_height: Math.max(84, answerLines * 28), show_border: false }
}

export function normalizeGeneratedOptions(question = {}) {
  const rawOptions = parseJson(question.options_json, question.options || [])
  if (!Array.isArray(rawOptions)) return []
  const correctAnswer = String(question.correct_answer || question.expected_answer || "").trim().toLowerCase()
  return rawOptions.map((option, index) => {
    const label = String(option.option_label || option.label || String.fromCharCode(65 + index)).trim().slice(0, 8)
    const text = String(option.option_text || option.text || "").trim()
    return { option_label: label, option_text: text, is_correct: Boolean(option.is_correct || option.isCorrect || label.toLowerCase() === correctAnswer || text.toLowerCase() === correctAnswer), sort_order: index + 1 }
  }).filter((option) => option.option_text)
}

export function dedupeTargetedLearners(learners = []) {
  const unique = new Map()
  for (const learner of Array.isArray(learners) ? learners : []) {
    const key = learner.student_id ? `id:${Number(learner.student_id)}` : learner.student_ref ? `ref:${String(learner.student_ref)}` : null
    if (key && !unique.has(key)) unique.set(key, learner)
  }
  return [...unique.values()]
}

async function audit(connection, schoolId, actor, action, entityType, entityId, afterValue) {
  await connection.query(`INSERT INTO audit_logs (school_id,actor_user_id,actor_role,action,entity_type,entity_id,after_value) VALUES (?,?,?,?,?,?,?)`, [schoolId, actor?.id || null, actor?.role || null, action, entityType, entityId || null, JSON.stringify(afterValue || {})])
}

async function assessmentContext(connection, schoolId, assessmentId, lock = false) {
  const [[assessment]] = await connection.query(`SELECT a.*,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,sch.name school_name FROM assessments a JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id JOIN schools sch ON sch.id=a.school_id WHERE a.school_id=? AND a.id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [schoolId, Number(assessmentId)])
  if (!assessment) throw new HttpError(404, "Assessment was not found.")
  return assessment
}

async function assertTeacherAssessmentAccess(connection, schoolId, assessment, actor) {
  if (String(actor?.role || "").toLowerCase() !== "teacher") return
  const [[assignment]] = await connection.query(`SELECT id FROM teacher_class_subject_assignments
    WHERE school_id=? AND teacher_id=? AND class_id=? AND subject_id=? AND role='subject_teacher' AND is_active=1
      AND (academic_year_id IS NULL OR academic_year_id=?) AND (term_id IS NULL OR term_id=?) LIMIT 1`,
  [schoolId, actor.id, assessment.class_id, assessment.subject_id, assessment.academic_year_id, assessment.term_id])
  if (!assignment) throw new HttpError(403, "Teachers can only access marks and evidence for assigned subjects.")
}

async function loadMappedQuestions(connection, schoolId, assessmentId) {
  const [questions] = await connection.query(`SELECT aq.id,aq.display_number,aq.question_number,aq.question_text,aq.question_type,aq.marks,aq.difficulty,aq.cognitive_skill,aq.correct_answer,aq.marking_scheme,aq.marking_points_json,aq.mapping_status,aq.parent_question_id,sec.public_ref section_ref,sec.title section_title FROM assessment_questions aq LEFT JOIN assessment_sections sec ON sec.id=aq.section_id AND sec.school_id=aq.school_id WHERE aq.school_id=? AND aq.assessment_id=? ORDER BY aq.sort_order,aq.question_number,aq.id`, [schoolId, assessmentId])
  if (!questions.length) return []
  const ids = questions.map((question) => question.id)
  const marks = ids.map(() => "?").join(",")
  const [topicMappings] = await connection.query(`SELECT qtm.assessment_question_id,qtm.topic_id,qtm.allocation_type,qtm.allocated_marks,qtm.allocated_percentage,qtm.is_primary,st.public_ref topic_ref,st.topic_name FROM question_topic_mappings qtm JOIN syllabus_topics st ON st.id=qtm.topic_id AND st.school_id=qtm.school_id WHERE qtm.school_id=? AND qtm.assessment_question_id IN (${marks}) ORDER BY qtm.is_primary DESC,qtm.id`, [schoolId, ...ids])
  const [objectiveMappings] = await connection.query(`SELECT qom.assessment_question_id,qom.learning_objective_id,qom.mapping_role,lo.public_ref objective_ref,lo.objective_text FROM question_objective_mappings qom JOIN learning_objectives lo ON lo.id=qom.learning_objective_id AND lo.school_id=qom.school_id WHERE qom.school_id=? AND qom.assessment_question_id IN (${marks}) ORDER BY qom.mapping_role,qom.id`, [schoolId, ...ids])
  return questions.map((question) => ({
    ...question,
    marks: Number(question.marks),
    marking_points: parseJson(question.marking_points_json, []),
    topic_mappings: topicMappings.filter((mapping) => Number(mapping.assessment_question_id) === Number(question.id)).map(({ assessment_question_id, ...mapping }) => ({ ...mapping, allocated_marks: mapping.allocated_marks === null ? null : Number(mapping.allocated_marks), allocated_percentage: mapping.allocated_percentage === null ? null : Number(mapping.allocated_percentage), is_primary: Boolean(mapping.is_primary) })),
    objective_mappings: objectiveMappings.filter((mapping) => Number(mapping.assessment_question_id) === Number(question.id)).map(({ assessment_question_id, ...mapping }) => mapping),
  }))
}

function topicsFromQuestions(questions = []) {
  const topics = new Map()
  for (const question of questions) for (const mapping of question.topic_mappings || []) {
    if (Number(mapping.allocated_marks || 0) <= 0) continue
    const current = topics.get(Number(mapping.topic_id)) || { topic_id: Number(mapping.topic_id), topic_ref: mapping.topic_ref, topic_name: mapping.topic_name, marks_available: 0 }
    current.marks_available += Number(mapping.allocated_marks || 0)
    topics.set(Number(mapping.topic_id), current)
  }
  return [...topics.values()].map((topic) => ({ ...topic, marks_available: round(topic.marks_available) }))
}

export async function listAuthoringTopics(schoolId, filters = {}) {
  const params = [schoolId]
  const clauses = ["st.is_active=1"]
  if (filters.subject_ref) { clauses.push("s.public_ref=?"); params.push(String(filters.subject_ref)) }
  if (filters.subject_id) { clauses.push("s.id=?"); params.push(Number(filters.subject_id)) }
  if (filters.class_ref) { clauses.push("(st.grade_id IS NULL OR gl.name=(SELECT grade_level FROM classes WHERE school_id=? AND public_ref=? LIMIT 1))"); params.push(schoolId, String(filters.class_ref)) }
  if (filters.class_id) { clauses.push("(st.grade_id IS NULL OR gl.name=(SELECT grade_level FROM classes WHERE school_id=? AND id=? LIMIT 1))"); params.push(schoolId, Number(filters.class_id)) }
  if (filters.term_id) { clauses.push("(st.term IS NULL OR st.term='' OR st.term=(SELECT name FROM terms WHERE school_id=? AND id=? LIMIT 1))"); params.push(schoolId, Number(filters.term_id)) }
  if (filters.search) { clauses.push("(st.topic_name LIKE ? OR parent.topic_name LIKE ? OR lo.objective_text LIKE ?)"); const term = `%${String(filters.search).trim()}%`; params.push(term, term, term) }
  const [rows] = await pool.query(`SELECT DISTINCT st.id,st.public_ref,st.topic_name,st.description,st.term,st.order_number,parent.public_ref parent_ref,parent.topic_name parent_name,s.public_ref subject_ref,s.name subject_name,gl.name grade_name FROM syllabus_topics st JOIN subjects s ON s.id=st.subject_id AND s.school_id=st.school_id LEFT JOIN syllabus_topics parent ON parent.id=st.parent_topic_id AND parent.school_id=st.school_id LEFT JOIN grade_levels gl ON gl.id=st.grade_id AND gl.school_id=st.school_id LEFT JOIN learning_objectives lo ON lo.topic_id=st.id AND lo.school_id=st.school_id WHERE st.school_id=? AND ${clauses.join(" AND ")} ORDER BY s.name,COALESCE(parent.order_number,st.order_number,999999),st.order_number,st.topic_name LIMIT 250`, params)
  const ids = rows.map((row) => Number(row.id))
  const [objectives] = ids.length ? await pool.query(`SELECT topic_id,public_ref,objective_text,skill_type,expected_difficulty FROM learning_objectives WHERE school_id=? AND is_active=1 AND topic_id IN (${ids.map(() => "?").join(",")}) ORDER BY curriculum_order,id`, [schoolId, ...ids]) : [[]]
  return { topics: rows.map(({ id, ...row }) => ({ ...row, hierarchy_label: [row.parent_name, row.topic_name].filter(Boolean).join(" → "), objectives: objectives.filter((objective) => Number(objective.topic_id) === Number(id)).map(({ topic_id, ...objective }) => objective) })) }
}

export async function saveQuestionMappings(schoolId, assessmentId, questionId, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await assessmentContext(connection, schoolId, assessmentId, true)
    const [[question]] = await connection.query("SELECT * FROM assessment_questions WHERE school_id=? AND assessment_id=? AND id=? LIMIT 1 FOR UPDATE", [schoolId, assessment.id, Number(questionId)])
    if (!question) throw new HttpError(404, "Assessment question was not found.")
    const rawMappings = Array.isArray(body.topic_mappings) ? body.topic_mappings : []
    const topicRefs = [...new Set(rawMappings.flatMap((mapping) => [mapping.topic_ref, mapping.broad_topic_ref, mapping.subtopic_ref]).filter(Boolean))]
    const refMap = new Map()
    if (topicRefs.length) {
      const [rows] = await connection.query(`SELECT id,public_ref FROM syllabus_topics WHERE school_id=? AND subject_id=? AND public_ref IN (${topicRefs.map(() => "?").join(",")})`, [schoolId, assessment.subject_id, ...topicRefs])
      rows.forEach((row) => refMap.set(row.public_ref, Number(row.id)))
    }
    const mappings = rawMappings.map((mapping) => ({ ...mapping, topic_id: Number(mapping.topic_id || refMap.get(mapping.topic_ref) || 0) }))
    const validation = validateQuestionTopicMappings(question, mappings)
    if (!validation.valid) throw new HttpError(400, "Question mapping is invalid.", { details: { errors: validation.errors } })
    const topicIds = validation.mappings.map((mapping) => mapping.topic_id)
    const [validTopics] = await connection.query(`SELECT id,public_ref,topic_name,parent_topic_id FROM syllabus_topics WHERE school_id=? AND subject_id=? AND id IN (${topicIds.map(() => "?").join(",")})`, [schoolId, assessment.subject_id, ...topicIds])
    if (validTopics.length !== new Set(topicIds).size) throw new HttpError(400, "Every mapped topic must belong to the assessment subject and school.")
    await connection.query("DELETE FROM question_topic_mappings WHERE school_id=? AND assessment_question_id=?", [schoolId, question.id])
    for (const mapping of validation.mappings) await connection.query(`INSERT INTO question_topic_mappings (public_ref,school_id,assessment_question_id,topic_id,allocation_type,allocated_marks,allocated_percentage,is_primary,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), schoolId, question.id, mapping.topic_id, mapping.allocation_type, mapping.allocated_marks, mapping.allocated_percentage, mapping.is_primary ? 1 : 0, actor.id, actor.id])
    const objectiveRefs = (body.objective_mappings || []).map((mapping) => mapping.objective_ref).filter(Boolean)
    const objectiveRefMap = new Map()
    if (objectiveRefs.length) {
      const [rows] = await connection.query(`SELECT lo.id,lo.public_ref FROM learning_objectives lo JOIN syllabus_topics st ON st.id=lo.topic_id AND st.school_id=lo.school_id WHERE lo.school_id=? AND st.subject_id=? AND lo.public_ref IN (${objectiveRefs.map(() => "?").join(",")})`, [schoolId, assessment.subject_id, ...objectiveRefs])
      rows.forEach((row) => objectiveRefMap.set(row.public_ref, Number(row.id)))
    }
    const objectives = (body.objective_mappings || []).map((mapping) => ({ ...mapping, learning_objective_id: Number(mapping.learning_objective_id || objectiveRefMap.get(mapping.objective_ref) || 0) }))
    if (objectives.some((objective) => !objective.learning_objective_id)) throw new HttpError(400, "One or more learning-objective mappings are invalid.")
    await connection.query("DELETE FROM question_objective_mappings WHERE school_id=? AND assessment_question_id=?", [schoolId, question.id])
    for (const [index, objective] of objectives.entries()) await connection.query(`INSERT INTO question_objective_mappings (public_ref,school_id,assessment_question_id,learning_objective_id,mapping_role,created_by,updated_by) VALUES (?,?,?,?,?,?,?)`, [randomUUID(), schoolId, question.id, objective.learning_objective_id, objective.mapping_role || (index ? "secondary" : "primary"), actor.id, actor.id])
    const primaryMapping = validation.mappings.find((mapping) => mapping.is_primary) || validation.mappings[0]
    const primaryTopic = validTopics.find((topic) => Number(topic.id) === Number(primaryMapping.topic_id))
    const requestedBroadId = Number(refMap.get(primaryMapping.broad_topic_ref) || 0)
    const requestedSubtopicId = Number(refMap.get(primaryMapping.subtopic_ref) || 0)
    const broadTopicId = Number(primaryTopic?.parent_topic_id || requestedBroadId || primaryTopic?.id || 0)
    const subtopicId = Number(primaryTopic?.parent_topic_id ? primaryTopic.id : requestedSubtopicId || 0) || null
    if (subtopicId) {
      const [[subtopic]] = await connection.query("SELECT id,topic_name,parent_topic_id FROM syllabus_topics WHERE school_id=? AND subject_id=? AND id=? AND is_active=1 LIMIT 1", [schoolId, assessment.subject_id, subtopicId])
      if (!subtopic || Number(subtopic.parent_topic_id) !== broadTopicId) throw new HttpError(400, "The selected subtopic must belong to the selected syllabus topic.")
    }
    const [[broadTopic]] = await connection.query("SELECT topic_name FROM syllabus_topics WHERE school_id=? AND subject_id=? AND id=? AND is_active=1 LIMIT 1", [schoolId, assessment.subject_id, broadTopicId])
    const [[subtopic]] = subtopicId ? await connection.query("SELECT topic_name FROM syllabus_topics WHERE school_id=? AND subject_id=? AND id=? AND is_active=1 LIMIT 1", [schoolId, assessment.subject_id, subtopicId]) : [[]]
    await connection.query(`UPDATE assessment_questions SET mapping_status='mapped',topic_id=?,topic_text=?,subtopic_id=?,subtopic_text=?,learning_objective_id=?,syllabus_strand=COALESCE(?,syllabus_strand),marking_points_json=COALESCE(?,marking_points_json) WHERE school_id=? AND id=?`, [broadTopicId, broadTopic?.topic_name || primaryTopic?.topic_name || null, subtopicId, subtopic?.topic_name || null, objectives.find((objective) => objective.mapping_role === "primary")?.learning_objective_id || objectives[0]?.learning_objective_id || null, body.syllabus_strand || null, body.marking_points ? JSON.stringify(body.marking_points) : null, schoolId, question.id])
    await audit(connection, schoolId, actor, "ASSESSMENT_QUESTION_MAPPED", "assessment_question", question.id, { assessment_id: assessment.id, topic_mappings: validation.mappings, objective_count: objectives.length })
    await connection.commit()
    return { question_id: question.id, mapping_status: "mapped", topic_id: broadTopicId, topic_text: broadTopic?.topic_name || primaryTopic?.topic_name || null, subtopic_id: subtopicId, subtopic_text: subtopic?.topic_name || null, topic_mappings: validation.mappings, objective_mappings: objectives }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

async function loadLearners(connection, schoolId, assessment) {
  const [[targeted]] = await connection.query("SELECT id FROM generated_assessments WHERE school_id=? AND assessment_id=? LIMIT 1", [schoolId, assessment.id])
  const targetedJoin = targeted ? "JOIN generated_assessment_learners gal ON gal.school_id=se.school_id AND gal.student_id=se.student_id AND gal.generated_assessment_id=? AND gal.confirmed_at IS NOT NULL" : ""
  const params = targeted
    ? [targeted.id, schoolId, assessment.class_id, assessment.academic_year_id, assessment.academic_year_id, assessment.term_id, assessment.term_id]
    : [schoolId, assessment.class_id, assessment.academic_year_id, assessment.academic_year_id, assessment.term_id, assessment.term_id]
  const [rows] = await connection.query(`SELECT DISTINCT s.id student_id,s.public_ref student_ref,CONCAT(s.first_name,' ',s.last_name) student_name,se.id enrollment_id FROM student_enrollments se JOIN students s ON s.id=se.student_id AND s.school_id=se.school_id ${targetedJoin} WHERE se.school_id=? AND se.class_id=? AND (? IS NULL OR se.academic_year_id=?) AND (? IS NULL OR se.term_id=?) AND se.enrollment_status='active' ORDER BY s.last_name,s.first_name,s.id`, params)
  return rows
}

export async function getAcademicMarkSheet(schoolId, assessmentId, filters = {}, actor = null) {
  const assessment = await assessmentContext(pool, schoolId, assessmentId)
  await assertTeacherAssessmentAccess(pool, schoolId, assessment, actor)
  const mode = ENTRY_MODES.has(String(filters.mode)) ? String(filters.mode) : "question"
  const [questions, learners] = await Promise.all([loadMappedQuestions(pool, schoolId, assessment.id), loadLearners(pool, schoolId, assessment)])
  const topics = topicsFromQuestions(questions)
  const [[sheet]] = await pool.query("SELECT * FROM academic_mark_sheets WHERE school_id=? AND assessment_id=? AND entry_mode=? LIMIT 1", [schoolId, assessment.id, mode])
  let entries = []
  if (sheet) {
    const [entryRows] = await pool.query("SELECT * FROM learner_assessment_entries WHERE school_id=? AND mark_sheet_id=?", [schoolId, sheet.id])
    const [questionRows] = mode === "question" ? await pool.query("SELECT student_id,assessment_question_id,marks_awarded,response_status FROM learner_question_marks WHERE school_id=? AND mark_sheet_id=?", [schoolId, sheet.id]) : [[]]
    const [topicRows] = mode !== "overall" ? await pool.query("SELECT student_id,topic_id,marks_awarded FROM learner_topic_results WHERE school_id=? AND mark_sheet_id=?", [schoolId, sheet.id]) : [[]]
    entries = learners.map((learner) => {
      const entry = entryRows.find((row) => Number(row.student_id) === Number(learner.student_id))
      return { ...learner, participation_status: entry?.participation_status || "pending", overall_marks: entry?.overall_marks === null || entry?.overall_marks === undefined ? "" : Number(entry.overall_marks), percentage: entry?.percentage === null || entry?.percentage === undefined ? null : Number(entry.percentage), mastery_state: entry?.mastery_state || "not_assessed", evidence_confidence: Number(entry?.evidence_confidence || 0), teacher_comment: entry?.teacher_comment || "", question_marks: Object.fromEntries(questionRows.filter((row) => Number(row.student_id) === Number(learner.student_id)).map((row) => [row.assessment_question_id, row.marks_awarded === null ? "" : Number(row.marks_awarded)])), topic_marks: Object.fromEntries(topicRows.filter((row) => Number(row.student_id) === Number(learner.student_id)).map((row) => [row.topic_id, row.marks_awarded === null ? "" : Number(row.marks_awarded)])) }
    })
  } else entries = learners.map((learner) => ({ ...learner, participation_status: "pending", overall_marks: "", percentage: null, mastery_state: "not_assessed", evidence_confidence: 0, teacher_comment: "", question_marks: {}, topic_marks: {} }))
  const mappedQuestionCount = questions.filter((question) => validateQuestionTopicMappings(question, question.topic_mappings).valid).length
  const completionPercentage = Number(sheet?.completion_percentage || 0)
  return { assessment: { id: assessment.id, name: assessment.name, school_name: assessment.school_name, class_ref: assessment.class_ref, class_name: assessment.class_name, subject_ref: assessment.subject_ref, subject_name: assessment.subject_name, total_marks: Number(assessment.total_marks), status: assessment.status }, mark_sheet: sheet ? { public_ref: sheet.public_ref, entry_mode: sheet.entry_mode, evidence_level: sheet.evidence_level, status: sheet.status, completion_percentage: completionPercentage, version_number: sheet.version_number, updated_at: sheet.updated_at } : null, mode, questions, topics, entries, overall_ready: completionPercentage === 100 && entries.length > 0, mapping_coverage: questions.length ? round(mappedQuestionCount / questions.length * 100) : 0, evidence_notice: mode === "overall" ? "Overall results are derived from completed academic evidence and cannot be entered separately." : mode === "topic" ? "Topic totals provide medium-precision evidence. Question and objective diagnostics will be unavailable." : "Question-level marks are the source of truth. Topic totals and overall results are derived automatically." }
}

async function ensureMarkSheet(connection, schoolId, assessment, mode, actor, idempotencyKey = null) {
  const evidenceLevel = mode === "question" ? "question" : mode === "topic" ? "topic" : "overall"
  await connection.query(`INSERT INTO academic_mark_sheets (public_ref,school_id,assessment_id,academic_year_id,term_id,class_id,subject_id,entry_mode,evidence_level,idempotency_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_by=VALUES(updated_by),version_number=version_number+1,idempotency_key=COALESCE(idempotency_key,VALUES(idempotency_key))`, [randomUUID(), schoolId, assessment.id, assessment.academic_year_id, assessment.term_id, assessment.class_id, assessment.subject_id, mode, evidenceLevel, idempotencyKey || null, actor.id, actor.id])
  const [[sheet]] = await connection.query("SELECT * FROM academic_mark_sheets WHERE school_id=? AND assessment_id=? AND entry_mode=? LIMIT 1 FOR UPDATE", [schoolId, assessment.id, mode])
  if (["published", "locked"].includes(sheet.status)) throw new HttpError(409, "Published mark sheets cannot be overwritten as drafts.")
  return sheet
}

function legacyGrade(score, totalMarks) {
  if (score === null || score === undefined) return null
  const percentage = Number(score) / Math.max(1, Number(totalMarks || 0)) * 100
  return percentage >= 80 ? "A" : percentage >= 70 ? "B" : percentage >= 60 ? "C" : percentage >= 50 ? "D" : "E"
}

async function syncDerivedOverallResults(connection, schoolId, assessment, actor, entries) {
  const teacherId = String(actor?.role || "").toLowerCase() === "teacher"
    ? Number(actor.id)
    : Number(assessment.teacher_id || assessment.created_by || actor?.id || 0)
  if (!teacherId) return null
  const [[existing]] = await connection.query(`SELECT * FROM result_batches WHERE school_id=? AND assessment_id=? AND class_id=? AND subject_id=? AND teacher_id=? AND term_id=? LIMIT 1 FOR UPDATE`, [schoolId, assessment.id, assessment.class_id, assessment.subject_id, teacherId, assessment.term_id])
  if (["submitted", "approved", "locked"].includes(String(existing?.status || ""))) throw new HttpError(409, "The overall result sheet has already been submitted and cannot be changed unless it is returned.")
  let batch = existing
  if (!batch) {
    const [created] = await connection.query(`INSERT INTO result_batches (school_id,exam_session_id,assessment_id,academic_year_id,term_id,class_id,stream_section,subject_id,teacher_id,status) VALUES (?,?,?,?,?,?,?,?,?,'draft')`, [schoolId, assessment.exam_session_id || null, assessment.id, assessment.academic_year_id, assessment.term_id, assessment.class_id, assessment.stream_section || null, assessment.subject_id, teacherId])
    batch = { id: Number(created.insertId), status: "draft" }
  }
  for (const entry of entries) {
    const absent = ["absent", "excused"].includes(String(entry.participation_status || ""))
    const score = absent || entry.overall_marks === null || entry.overall_marks === undefined ? null : Number(entry.overall_marks)
    await connection.query(`INSERT INTO result_entries (school_id,result_batch_id,student_id,enrollment_id,score,grade,comment,status,last_saved_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE enrollment_id=VALUES(enrollment_id),score=VALUES(score),grade=VALUES(grade),comment=VALUES(comment),status=VALUES(status),last_saved_at=CURRENT_TIMESTAMP`,
    [schoolId, batch.id, entry.student_id, entry.enrollment_id || null, score, absent ? null : legacyGrade(score, assessment.total_marks), entry.teacher_comment || null, absent ? "absent" : "draft"])
  }
  await connection.query("UPDATE result_batches SET status='draft',return_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE school_id=? AND id=?", [schoolId, batch.id])
  return batch.id
}

export async function saveAcademicMarkSheetDraft(schoolId, assessmentId, actor, body = {}) {
  const mode = String(body.mode || body.entry_mode || "question")
  if (!ENTRY_MODES.has(mode)) throw new HttpError(400, "Entry mode must be question, topic or overall.")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await assessmentContext(connection, schoolId, assessmentId, true)
    await assertTeacherAssessmentAccess(connection, schoolId, assessment, actor)
    const config = await getAcademicEngineConfig(schoolId, connection)
    const questions = await loadMappedQuestions(connection, schoolId, assessment.id)
    const topics = topicsFromQuestions(questions)
    if (mode === "question" && !questions.length) throw new HttpError(409, "Question-by-question entry requires authored assessment questions.")
    if (mode !== "overall" && !topics.length) throw new HttpError(409, "Map assessment questions to syllabus topics before using question or topic evidence entry.")
    const entries = Array.isArray(body.entries) ? body.entries : []
    const validation = validateMarkSheetPayload({ mode, entries, questions, topics, totalMarks: assessment.total_marks })
    if (!validation.valid) throw new HttpError(400, "Mark sheet contains invalid evidence.", { details: { errors: validation.errors } })
    const sheet = await ensureMarkSheet(connection, schoolId, assessment, mode, actor, body.idempotency_key)
    const allowedLearners = new Set((await loadLearners(connection, schoolId, assessment)).map((learner) => Number(learner.student_id)))
    let completed = 0
    const derivedOverallEntries = []
    for (const input of entries) {
      const studentId = Number(input.student_id)
      if (!allowedLearners.has(studentId)) throw new HttpError(403, "One learner does not belong to this assessment class and session.")
      const participation = String(input.participation_status || "present")
      let aggregate = { total_awarded: null, total_available: Number(assessment.total_marks), percentage: null, confidence_score: 0, topics: [] }
      if (!["absent", "excused"].includes(participation)) {
        if (mode === "question") aggregate = aggregateQuestionEvidence({ questions, marks: input.question_marks || {}, config })
        if (mode === "topic") {
          const scored = topics.filter((topic) => input.topic_marks?.[topic.topic_id] !== "" && input.topic_marks?.[topic.topic_id] !== null && input.topic_marks?.[topic.topic_id] !== undefined).map((topic) => ({ ...topic, marks_awarded: Number(input.topic_marks[topic.topic_id]), percentage: topic.marks_available ? round(Number(input.topic_marks[topic.topic_id]) / topic.marks_available * 100) : null, mastery_state: masteryState(topic.marks_available ? Number(input.topic_marks[topic.topic_id]) / topic.marks_available * 100 : null, config) }))
          const available = scored.reduce((sum, topic) => sum + topic.marks_available, 0); const awarded = scored.reduce((sum, topic) => sum + topic.marks_awarded, 0)
          aggregate = { total_awarded: round(awarded), total_available: round(available), percentage: available ? round(awarded / available * 100) : null, confidence_score: confidenceForEvidenceLevel("topic", { mappedMarks: available, mappingCoverage: topics.length ? scored.length / topics.length * 100 : 0 }), topics: scored }
        }
        if (mode === "overall" && input.overall_marks !== "" && input.overall_marks !== null && input.overall_marks !== undefined) aggregate = { total_awarded: Number(input.overall_marks), total_available: Number(assessment.total_marks), percentage: round(Number(input.overall_marks) / Math.max(1, Number(assessment.total_marks)) * 100), confidence_score: confidenceForEvidenceLevel("overall"), topics: [] }
      }
      const expectedItems = mode === "question" ? questions.length : mode === "topic" ? topics.length : 1
      const actualItems = mode === "question" ? aggregate.marked_questions || 0 : mode === "topic" ? aggregate.topics.length : aggregate.percentage === null ? 0 : 1
      const derivedParticipation = ["absent", "excused"].includes(participation) ? participation : actualItems === 0 ? "pending" : actualItems < expectedItems || participation === "incomplete" ? "incomplete" : "present"
      if (["present", "absent", "excused"].includes(derivedParticipation)) completed += 1
      await connection.query(`INSERT INTO learner_assessment_entries (public_ref,school_id,mark_sheet_id,student_id,participation_status,overall_marks,percentage,mastery_state,evidence_confidence,is_official,teacher_comment,last_saved_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,0,?,CURRENT_TIMESTAMP,?,?) ON DUPLICATE KEY UPDATE participation_status=VALUES(participation_status),overall_marks=VALUES(overall_marks),percentage=VALUES(percentage),mastery_state=VALUES(mastery_state),evidence_confidence=VALUES(evidence_confidence),teacher_comment=VALUES(teacher_comment),last_saved_at=CURRENT_TIMESTAMP,updated_by=VALUES(updated_by)`, [randomUUID(), schoolId, sheet.id, studentId, derivedParticipation, aggregate.total_awarded, aggregate.percentage, masteryState(aggregate.percentage, config), aggregate.confidence_score, input.teacher_comment || null, actor.id, actor.id])
      const [[entry]] = await connection.query("SELECT id FROM learner_assessment_entries WHERE school_id=? AND mark_sheet_id=? AND student_id=? LIMIT 1", [schoolId, sheet.id, studentId])
      if (mode === "question") {
        await connection.query("DELETE FROM learner_question_marks WHERE school_id=? AND mark_sheet_id=? AND student_id=?", [schoolId, sheet.id, studentId])
        for (const question of questions) {
          const value = input.question_marks?.[question.id]
          const marked = !["absent", "excused"].includes(derivedParticipation) && value !== "" && value !== null && value !== undefined
          await connection.query(`INSERT INTO learner_question_marks (public_ref,school_id,mark_sheet_id,learner_entry_id,student_id,assessment_question_id,marks_awarded,marks_available,response_status,is_official,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`, [randomUUID(), schoolId, sheet.id, entry.id, studentId, question.id, marked ? Number(value) : null, question.marks, marked ? "marked" : "unmarked", actor.id, actor.id])
        }
      }
      if (mode !== "overall") {
        await connection.query("DELETE FROM learner_topic_results WHERE school_id=? AND mark_sheet_id=? AND student_id=?", [schoolId, sheet.id, studentId])
        for (const topic of aggregate.topics) await connection.query(`INSERT INTO learner_topic_results (public_ref,school_id,mark_sheet_id,learner_entry_id,student_id,topic_id,marks_awarded,marks_available,percentage,mastery_state,evidence_level,confidence_score,is_official,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`, [randomUUID(), schoolId, sheet.id, entry.id, studentId, topic.topic_id, topic.marks_awarded, topic.marks_available, topic.percentage, topic.mastery_state, mode === "question" ? "question" : "topic", aggregate.confidence_score, actor.id, actor.id])
      }
      derivedOverallEntries.push({ student_id: studentId, enrollment_id: input.enrollment_id || null, participation_status: derivedParticipation, overall_marks: aggregate.total_awarded, teacher_comment: input.teacher_comment || null })
    }
    const learnerCount = allowedLearners.size
    const completion = learnerCount ? round(completed / learnerCount * 100) : 0
    await connection.query("UPDATE academic_mark_sheets SET completion_percentage=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?", [completion, actor.id, sheet.id, schoolId])
    const resultBatchId = await syncDerivedOverallResults(connection, schoolId, assessment, actor, derivedOverallEntries)
    await audit(connection, schoolId, actor, "ACADEMIC_MARK_SHEET_DRAFT_SAVED", "academic_mark_sheet", sheet.id, { assessment_id: assessment.id, mode, entries: entries.length, completion_percentage: completion })
    await connection.commit()
    return { public_ref: sheet.public_ref, status: "draft", entry_mode: mode, completion_percentage: completion, overall_ready: completion === 100, result_batch_id: resultBatchId, provisional: true, official_evidence_created: false }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

async function upsertMasteryEvidence(connection, values) {
  const [[existing]] = await connection.query(`SELECT id FROM mastery_evidence WHERE school_id=? AND student_id=? AND source_entity_type=? AND source_entity_id=? AND topic_id <=> ? AND learning_objective_id <=> ? LIMIT 1`, [values.schoolId, values.studentId, values.sourceType, values.sourceId, values.topicId || null, values.objectiveId || null])
  const metadata = JSON.stringify(values.metadata || {})
  if (existing) await connection.query(`UPDATE mastery_evidence SET academic_year_id=?,term_id=?,class_id=?,subject_id=?,topic_id=?,learning_objective_id=?,evidence_type=?,assessment_id=?,question_id=?,score_percentage=?,marks_awarded=?,marks_available=?,assessment_weight=?,evidence_granularity=?,evidence_precision=?,publication_state='published',evidence_status='valid',evidence_at=CURRENT_TIMESTAMP,recorded_at=CURRENT_TIMESTAMP,metadata_json=? WHERE school_id=? AND id=?`, [values.academicYearId, values.termId, values.classId, values.subjectId, values.topicId || null, values.objectiveId || null, values.evidenceType, values.assessmentId || null, values.questionId || null, values.percentage, values.awarded, values.available, values.weight, values.granularity, values.precision || "limited", metadata, values.schoolId, existing.id])
  else await connection.query(`INSERT INTO mastery_evidence (public_ref,school_id,academic_year_id,term_id,student_id,class_id,subject_id,topic_id,learning_objective_id,evidence_type,source_entity_type,source_entity_id,assessment_id,question_id,score_percentage,marks_awarded,marks_available,assessment_weight,evidence_granularity,evidence_precision,publication_state,evidence_status,evidence_at,recorded_at,metadata_json) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published','valid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)`, [values.schoolId, values.academicYearId, values.termId, values.studentId, values.classId, values.subjectId, values.topicId || null, values.objectiveId || null, values.evidenceType, values.sourceType, values.sourceId, values.assessmentId || null, values.questionId || null, values.percentage, values.awarded, values.available, values.weight, values.granularity, values.precision || "limited", metadata])
}

async function reconcileTopicFinding(connection, schoolId, assessment, sheet, topic, config, actor) {
  const [rows] = await connection.query(`SELECT ltr.student_id,ltr.percentage,ltr.confidence_score FROM learner_topic_results ltr JOIN learner_assessment_entries lae ON lae.id=ltr.learner_entry_id AND lae.school_id=ltr.school_id WHERE ltr.school_id=? AND ltr.mark_sheet_id=? AND ltr.topic_id=? AND ltr.is_official=1 AND lae.participation_status='present'`, [schoolId, sheet.id, topic.topic_id])
  if (!rows.length) return null
  const average = round(rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / rows.length)
  const below = rows.filter((row) => Number(row.percentage) < Number(config.mastery_threshold || 70))
  const confidence = round(rows.reduce((sum, row) => sum + Number(row.confidence_score || 0), 0) / rows.length)
  const ruleKey = `topic_mastery:${assessment.class_id}:${assessment.subject_id}:${topic.topic_id}`
  const [[existing]] = await connection.query("SELECT * FROM academic_alerts WHERE school_id=? AND rule_key=? AND (term_id=? OR term_id IS NULL) ORDER BY id DESC LIMIT 1", [schoolId, ruleKey, assessment.term_id])
  if (!below.length || average >= Number(config.mastery_threshold || 70)) {
    if (existing && existing.status !== "resolved") await connection.query("UPDATE academic_alerts SET status='resolved',resolved_by=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?", [actor.id, existing.id, schoolId])
    return { state: "positive", average, affected_learner_count: below.length, resolved_alert_ref: existing?.public_ref || null }
  }
  const severity = average < Number(config.intervention_threshold || 45) ? "high" : below.length / rows.length >= .35 ? "high" : "medium"
  const message = `${below.length} of ${rows.length} learners are below the secure threshold in ${topic.topic_name}. Mapped ${sheet.evidence_level}-level evidence averages ${average}%.`
  const evidence = JSON.stringify({ findingType: "TOPIC_MASTERY_GAP", affectedLearnerCount: below.length, totalLearners: rows.length, topicSuccessRate: average, threshold: Number(config.mastery_threshold || 70), mappedMarks: topic.marks_available, confidence, evidenceIds: rows.map((row) => row.student_id), evidenceLevel: sheet.evidence_level })
  if (existing) await connection.query("UPDATE academic_alerts SET term_id=?,severity=?,title=?,message=?,evidence_json=?,status='open',assigned_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?", [assessment.term_id, severity, `${topic.topic_name} requires targeted attention`, message, evidence, assessment.teacher_id || actor.id, existing.id, schoolId])
  else {
    const [alertResult] = await connection.query(`INSERT INTO academic_alerts (public_ref,school_id,alert_type,severity,class_id,subject_id,topic_id,term_id,title,message,evidence_json,assigned_user_id,rule_key,dedupe_window) VALUES (UUID(),?,'topic_mastery_gap',?,?,?,?,?,?,?,?,?,?,'current_term')`, [schoolId, severity, assessment.class_id, assessment.subject_id, topic.topic_id, assessment.term_id, `${topic.topic_name} requires targeted attention`, message, evidence, assessment.teacher_id || actor.id, ruleKey])
    const recipient = assessment.teacher_id || actor.id
    if (recipient) await connection.query(`INSERT IGNORE INTO notifications (public_ref,school_id,recipient_user_id,title,message,category,priority,channel,status,linked_entity_type,linked_entity_id,created_by,sent_at,rule_key,dedupe_window) VALUES (UUID(),?,?,?,?,'academics',?,'in_app','sent','academic_alert',?,?,CURRENT_TIMESTAMP,?,'current_term')`, [schoolId, recipient, `${topic.topic_name} requires targeted attention`, message, severity === 'urgent' ? 'urgent' : severity === 'high' ? 'high' : 'medium', alertResult.insertId, actor.id || null, ruleKey])
  }
  return { state: "risk", average, affected_learner_count: below.length, total_learners: rows.length, severity, confidence }
}

async function evaluateLinkedReassessment(connection, schoolId, sheet, actor) {
  const [[link]] = await connection.query(`SELECT air.*,ai.public_ref intervention_ref,ga.topic_id FROM academic_intervention_reassessments air JOIN generated_assessments ga ON ga.id=air.generated_assessment_id AND ga.school_id=air.school_id JOIN academic_interventions ai ON ai.id=air.intervention_id AND ai.school_id=air.school_id WHERE air.school_id=? AND ga.assessment_id=? AND air.outcome='pending' LIMIT 1`, [schoolId, sheet.assessment_id])
  if (!link || !link.baseline_mark_sheet_id) return null
  const [baseline] = await connection.query(`SELECT ltr.student_id,ltr.marks_awarded,ltr.marks_available,'published' status,'baseline_assessment' evidence_type FROM learner_topic_results ltr JOIN generated_assessment_learners gal ON gal.school_id=ltr.school_id AND gal.student_id=ltr.student_id AND gal.generated_assessment_id=? AND gal.confirmed_at IS NOT NULL WHERE ltr.school_id=? AND ltr.mark_sheet_id=? AND ltr.topic_id=? AND ltr.is_official=1`, [link.generated_assessment_id, schoolId, link.baseline_mark_sheet_id, link.topic_id])
  const [reassessment] = await connection.query(`SELECT ltr.student_id,ltr.marks_awarded,ltr.marks_available,'published' status,'reassessment' evidence_type FROM learner_topic_results ltr JOIN generated_assessment_learners gal ON gal.school_id=ltr.school_id AND gal.student_id=ltr.student_id AND gal.generated_assessment_id=? AND gal.confirmed_at IS NOT NULL WHERE ltr.school_id=? AND ltr.mark_sheet_id=? AND ltr.topic_id=? AND ltr.is_official=1`, [link.generated_assessment_id, schoolId, sheet.id, link.topic_id])
  const criterion = parseJson(link.success_criterion_json, {})
  const result = evaluateInterventionEffectiveness({ baseline, reassessment, successThreshold: Number(criterion.success_threshold || 60), minimumChange: Number(criterion.minimum_change || 5) })
  const percentageByStudent = (rows) => {
    const grouped = new Map()
    for (const row of rows) { const current = grouped.get(Number(row.student_id)) || { awarded: 0, available: 0 }; current.awarded += Number(row.marks_awarded || 0); current.available += Number(row.marks_available || 0); grouped.set(Number(row.student_id), current) }
    return new Map([...grouped].map(([studentId, value]) => [studentId, value.available ? round(value.awarded / value.available * 100) : null]))
  }
  const beforeByStudent = percentageByStudent(baseline); const afterByStudent = percentageByStudent(reassessment)
  const comparable = [...afterByStudent].filter(([studentId, score]) => score !== null && beforeByStudent.get(studentId) !== null && beforeByStudent.get(studentId) !== undefined)
  const learnerOutcome = { targeted_learners: afterByStudent.size, comparable_learners: comparable.length, improved_learners: comparable.filter(([studentId, score]) => score > beforeByStudent.get(studentId) + EPSILON).length, reached_success_criterion: [...afterByStudent.values()].filter((score) => score !== null && score >= Number(criterion.success_threshold || 60)).length, remaining_below_criterion: [...afterByStudent.values()].filter((score) => score === null || score < Number(criterion.success_threshold || 60)).length }
  const outcomeSummary = { ...result, ...learnerOutcome }
  const outcome = result.outcome === "EFFECTIVE" ? "effective" : result.outcome === "PARTIALLY_EFFECTIVE" ? "partially_effective" : result.outcome === "INEFFECTIVE" ? "ineffective" : "inconclusive"
  await connection.query("UPDATE academic_intervention_reassessments SET reassessment_mark_sheet_id=?,outcome=?,outcome_summary_json=?,evaluated_at=CURRENT_TIMESTAMP,evaluated_by=? WHERE id=? AND school_id=?", [sheet.id, outcome, JSON.stringify(outcomeSummary), actor.id, link.id, schoolId])
  await connection.query("UPDATE academic_interventions SET outcome=?,status=?,reassessment_summary_json=?,completed_by=CASE WHEN ?='completed' THEN ? ELSE completed_by END,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND school_id=?", [outcome === "effective" || outcome === "partially_effective" ? "improved" : outcome === "ineffective" ? "unchanged" : "inconclusive", outcome === "effective" ? "completed" : "review_due", JSON.stringify(outcomeSummary), outcome === "effective" ? "completed" : "review_due", actor.id, outcome === "effective" ? "completed" : "review_due", link.intervention_id, schoolId])
  let canonicalOutcome = null
  if (link.support_case_id && link.intervention_cycle_id) {
    const [[supportCase], [cycleRows]] = await Promise.all([
      connection.query("SELECT * FROM learner_support_cases WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE", [schoolId, link.support_case_id]).then(([rows]) => rows),
      connection.query("SELECT * FROM intervention_cycles WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE", [schoolId, link.intervention_cycle_id]),
    ])
    const cycle = cycleRows[0]
    if (supportCase && cycle) {
      const delivery = await getInterventionDeliveryMetrics(connection, schoolId, cycle.id)
      const comparable = result.baseline_score !== null && result.reassessment_score !== null
      canonicalOutcome = evaluateInterventionDelivery({
        plannedSessions: cycle.planned_session_count,
        completedSessions: delivery.deliveredSessions,
        attendanceEligible: delivery.attendanceEligible,
        attendedSessions: delivery.attendedSessions,
        reassessmentPublished: true,
        reassessmentComparable: comparable,
        baselineScore: result.baseline_score,
        reassessmentScore: result.reassessment_score,
        successCriterion: Number(criterion.mastery_threshold || criterion.success_threshold || 60),
        minimumMeaningfulChange: Number(criterion.minimum_meaningful_change || criterion.minimum_change || 5),
      }, { minimumSupportDeliveryRate: cycle.delivery_threshold, minimumSupportAttendanceRate: cycle.attendance_threshold })
      const cycleStatus = canonicalOutcome.outcome === "awaiting_reassessment" ? "awaiting_reassessment" : ["incomplete_delivery", "insufficient_participation", "inconclusive"].includes(canonicalOutcome.outcome) ? canonicalOutcome.outcome : "completed"
      const cycleOutcome = ["effective", "partially_effective", "ineffective", "inconclusive"].includes(canonicalOutcome.outcome) ? canonicalOutcome.outcome : "not_classified"
      const improved = canonicalOutcome.outcome === "effective"
      const unsuccessful = ["partially_effective", "ineffective"].includes(canonicalOutcome.outcome)
      const caseStatus = improved ? "continued_support" : unsuccessful ? "strategy_review" : canonicalOutcome.outcome === "awaiting_reassessment" ? "reassessment_pending" : "intervention_active"
      await connection.query("UPDATE intervention_cycles SET status=?,outcome=?,diagnostic_json=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [cycleStatus, cycleOutcome, JSON.stringify({ ...canonicalOutcome, ...learnerOutcome }), actor.id, schoolId, cycle.id])
      await connection.query("UPDATE learner_support_cases SET status=?,successful_cycle_count=successful_cycle_count+?,unsuccessful_cycle_count=unsuccessful_cycle_count+?,last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=DATE_ADD(CURRENT_DATE,INTERVAL 5 DAY),current_summary=CONCAT(current_summary,' Published reassessment outcome: ',?),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [caseStatus, improved ? 1 : 0, unsuccessful ? 1 : 0, canonicalOutcome.outcome.replaceAll("_", " "), actor.id, schoolId, supportCase.id])
      await recordSupportCaseEvent(connection, schoolId, supportCase, actor, "reassessment_outcome_evaluated", `Published reassessment evidence classified the intervention outcome as ${canonicalOutcome.outcome.replaceAll("_", " ")}.`, { idempotencyKey: `published-reassessment:${link.id}:${sheet.id}`, linkedType: "academic_mark_sheet", linkedRef: sheet.public_ref, status: caseStatus, evidence: { ...canonicalOutcome, ...learnerOutcome } })
    }
  }
  return { intervention_ref: link.intervention_ref, support_case_ref: canonicalOutcome ? link.support_case_id : null, canonical_outcome: canonicalOutcome, ...outcomeSummary }
}

export async function publishAcademicMarkSheet(schoolId, assessmentId, actor, body = {}) {
  const mode = String(body.mode || body.entry_mode || "question")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await assessmentContext(connection, schoolId, assessmentId, true)
    await assertTeacherAssessmentAccess(connection, schoolId, assessment, actor)
    const [[sheet]] = await connection.query("SELECT * FROM academic_mark_sheets WHERE school_id=? AND assessment_id=? AND entry_mode=? LIMIT 1 FOR UPDATE", [schoolId, assessment.id, mode])
    if (!sheet) throw new HttpError(409, "Save the mark sheet draft before publishing.")
    if (["published", "locked"].includes(sheet.status)) { await connection.commit(); return { public_ref: sheet.public_ref, status: sheet.status, duplicate: true } }
    const [entries] = await connection.query("SELECT * FROM learner_assessment_entries WHERE school_id=? AND mark_sheet_id=?", [schoolId, sheet.id])
    const present = entries.filter((entry) => entry.participation_status === "present")
    if (!present.length) throw new HttpError(409, "At least one complete learner script is required before publication.")
    const questions = await loadMappedQuestions(connection, schoolId, assessment.id)
    const topics = topicsFromQuestions(questions)
    if (mode === "question") {
      if (questions.some((question) => !validateQuestionTopicMappings(question, question.topic_mappings).valid)) throw new HttpError(409, "Every published question must have a valid topic mapping.")
      const [[missing]] = await connection.query(`SELECT COUNT(*) missing FROM learner_question_marks lqm JOIN learner_assessment_entries lae ON lae.id=lqm.learner_entry_id AND lae.school_id=lqm.school_id WHERE lqm.school_id=? AND lqm.mark_sheet_id=? AND lae.participation_status='present' AND lqm.marks_awarded IS NULL`, [schoolId, sheet.id])
      if (Number(missing.missing)) throw new HttpError(409, "Complete every present learner's question marks or mark the script incomplete.")
    }
    await connection.query("UPDATE academic_mark_sheets SET status='published',published_by=?,published_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=? AND school_id=?", [actor.id, actor.id, sheet.id, schoolId])
    await connection.query("UPDATE learner_assessment_entries SET is_official=IF(participation_status='present',1,0),updated_by=? WHERE school_id=? AND mark_sheet_id=?", [actor.id, schoolId, sheet.id])
    await connection.query("UPDATE learner_question_marks lqm JOIN learner_assessment_entries lae ON lae.id=lqm.learner_entry_id SET lqm.is_official=IF(lae.participation_status='present',1,0),lqm.updated_by=? WHERE lqm.school_id=? AND lqm.mark_sheet_id=?", [actor.id, schoolId, sheet.id])
    await connection.query("UPDATE learner_topic_results ltr JOIN learner_assessment_entries lae ON lae.id=ltr.learner_entry_id SET ltr.is_official=IF(lae.participation_status='present',1,0),ltr.updated_by=? WHERE ltr.school_id=? AND ltr.mark_sheet_id=?", [actor.id, schoolId, sheet.id])
    const evidenceType = await connection.query("SELECT purpose FROM generated_assessments WHERE school_id=? AND assessment_id=? LIMIT 1", [schoolId, assessment.id]).then(([rows]) => rows[0]?.purpose === "intervention_reassessment" ? "reassessment" : "assessment_question")
    for (const entry of present) {
      if (mode === "question") {
        const [questionMarks] = await connection.query("SELECT * FROM learner_question_marks WHERE school_id=? AND mark_sheet_id=? AND student_id=? AND marks_awarded IS NOT NULL", [schoolId, sheet.id, entry.student_id])
        for (const mark of questionMarks) {
          const question = questions.find((item) => Number(item.id) === Number(mark.assessment_question_id))
          const mappingValidation = validateQuestionTopicMappings(question, question.topic_mappings)
          for (const mapping of mappingValidation.mappings.filter((item) => Number(item.allocated_marks) > 0)) {
            const available = Number(mapping.allocated_marks); const awarded = Number(mark.marks_available) ? Number(mark.marks_awarded) * available / Number(mark.marks_available) : 0
            const primaryObjective = question.objective_mappings?.find((objective) => objective.mapping_role === "primary") || question.objective_mappings?.[0]
            await upsertMasteryEvidence(connection, { schoolId, academicYearId: assessment.academic_year_id, termId: assessment.term_id, studentId: entry.student_id, classId: assessment.class_id, subjectId: assessment.subject_id, topicId: mapping.topic_id, objectiveId: primaryObjective?.learning_objective_id || null, evidenceType, sourceType: "learner_question_mark", sourceId: mark.id, assessmentId: assessment.id, questionId: question.id, precision: "question", percentage: round(awarded / available * 100), awarded: round(awarded), available, weight: evidenceType === "reassessment" ? .85 : .9, granularity: primaryObjective ? "objective" : "topic", metadata: { assessment_id: assessment.id, assessment_name: assessment.name, question_id: question.id, question_number: question.display_number, mark_sheet_ref: sheet.public_ref, evidence_level: "question" } })
            await recalculateStudentMastery(schoolId, entry.student_id, assessment.subject_id, { academic_year_id: assessment.academic_year_id, term_id: assessment.term_id, topic_id: mapping.topic_id, learning_objective_id: primaryObjective?.learning_objective_id || null }, connection)
          }
        }
      } else if (mode === "topic") {
        const [topicResults] = await connection.query("SELECT * FROM learner_topic_results WHERE school_id=? AND mark_sheet_id=? AND student_id=? AND marks_awarded IS NOT NULL", [schoolId, sheet.id, entry.student_id])
        for (const result of topicResults) {
          await upsertMasteryEvidence(connection, { schoolId, academicYearId: assessment.academic_year_id, termId: assessment.term_id, studentId: entry.student_id, classId: assessment.class_id, subjectId: assessment.subject_id, topicId: result.topic_id, objectiveId: null, evidenceType, sourceType: "learner_topic_result", sourceId: result.id, assessmentId: assessment.id, precision: "topic", percentage: Number(result.percentage), awarded: Number(result.marks_awarded), available: Number(result.marks_available), weight: evidenceType === "reassessment" ? .8 : .7, granularity: "topic", metadata: { assessment_id: assessment.id, assessment_name: assessment.name, mark_sheet_ref: sheet.public_ref, evidence_level: "topic" } })
          await recalculateStudentMastery(schoolId, entry.student_id, assessment.subject_id, { academic_year_id: assessment.academic_year_id, term_id: assessment.term_id, topic_id: result.topic_id }, connection)
        }
      } else {
        await upsertMasteryEvidence(connection, { schoolId, academicYearId: assessment.academic_year_id, termId: assessment.term_id, studentId: entry.student_id, classId: assessment.class_id, subjectId: assessment.subject_id, topicId: null, objectiveId: null, evidenceType: "assessment_total", sourceType: "learner_assessment_entry", sourceId: entry.id, assessmentId: assessment.id, precision: "overall", percentage: Number(entry.percentage), awarded: Number(entry.overall_marks), available: Number(assessment.total_marks), weight: .8, granularity: "limited", metadata: { assessment_id: assessment.id, assessment_name: assessment.name, mark_sheet_ref: sheet.public_ref, limitation: "Overall total only; exact topic diagnosis is unavailable." } })
      }
      await recalculateStudentMastery(schoolId, entry.student_id, assessment.subject_id, { academic_year_id: assessment.academic_year_id, term_id: assessment.term_id }, connection)
    }
    const classMastery = await recalculateClassMastery(schoolId, { classId: assessment.class_id, subjectId: assessment.subject_id, academicYearId: assessment.academic_year_id, termId: assessment.term_id }, connection)
    const config = await getAcademicEngineConfig(schoolId, connection)
    const findings = []
    if (mode !== "overall") for (const topic of topics) findings.push(await reconcileTopicFinding(connection, schoolId, assessment, { ...sheet, evidence_level: mode }, topic, config, actor))
    const supportCases = mode === "overall"
      ? { cases_touched: [], weak_evidence_count: 0 }
      : await syncSupportCasesFromPublishedAssessment(connection, schoolId, assessment, actor)
    const interventionOutcome = await evaluateLinkedReassessment(connection, schoolId, sheet, actor)
    await audit(connection, schoolId, actor, "ACADEMIC_MARK_SHEET_PUBLISHED", "academic_mark_sheet", sheet.id, { assessment_id: assessment.id, mode, learners: present.length, scoped_topics: mode === "overall" ? 0 : topics.length, intervention_outcome: interventionOutcome, support_cases: supportCases })
    await connection.commit()
    await recordAcademicIntelligenceSnapshot({ schoolId, academicYearId: assessment.academic_year_id, termId: assessment.term_id, scopeType: "class", scopeRef: assessment.class_ref, metricKey: "mapped_assessment_published", metricValue: classMastery.average_mastery, confidenceScore: findings.filter(Boolean).length ? round(findings.filter(Boolean).reduce((sum, finding) => sum + Number(finding.confidence || 0), 0) / findings.filter(Boolean).length) : 20, evidenceState: mode === "overall" ? "limited" : "sufficient", reason: mode === "overall" ? "Overall totals published; no topic claim was created." : "Mapped marks published and scoped intelligence recalculated.", evidenceSummary: { assessment_id: assessment.id, mode, topics: topics.map((topic) => topic.topic_ref), intervention_outcome: interventionOutcome }, formulaVersion: "academic-operations-v1" })
    return { public_ref: sheet.public_ref, status: "published", evidence_level: mode, learners_published: present.length, topics_recalculated: mode === "overall" ? 0 : topics.length, class_mastery: classMastery, findings: findings.filter(Boolean), support_cases: supportCases, intervention_outcome: interventionOutcome, limitations: mode === "overall" ? ["Topic-level intelligence is unavailable because only final totals were recorded."] : [] }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function reopenAcademicMarkSheet(schoolId, assessmentId, actor, body = {}) {
  const mode = String(body.mode || body.entry_mode || 'question')
  if (!ENTRY_MODES.has(mode)) throw new HttpError(400, 'Entry mode must be question, topic or overall.')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const assessment = await assessmentContext(connection, schoolId, assessmentId, true)
    await assertTeacherAssessmentAccess(connection, schoolId, assessment, actor)
    const [[sheet]] = await connection.query('SELECT * FROM academic_mark_sheets WHERE school_id=? AND assessment_id=? AND entry_mode=? LIMIT 1 FOR UPDATE', [schoolId, assessment.id, mode])
    if (!sheet) throw new HttpError(404, 'Academic mark sheet was not found.')
    if (!['published', 'locked'].includes(String(sheet.status))) {
      await connection.commit()
      return { public_ref: sheet.public_ref, status: sheet.status, duplicate: true }
    }
    const [[finalBatch]] = await connection.query(`SELECT id,status FROM result_batches WHERE school_id=? AND assessment_id=? AND status IN ('submitted','approved','locked') LIMIT 1`, [schoolId, assessment.id])
    if (finalBatch) throw new HttpError(409, 'Return the submitted overall results for correction before reopening academic evidence.')
    await connection.query(`UPDATE learner_support_case_evidence ce
      JOIN mastery_evidence me ON me.id=ce.mastery_evidence_id AND me.school_id=ce.school_id
      SET ce.evidence_status='invalidated',ce.updated_by=?
      WHERE ce.school_id=? AND me.assessment_id=? AND ce.evidence_status='valid'`, [actor.id, schoolId, assessment.id])
    await connection.query(`UPDATE mastery_evidence SET publication_state='invalidated',evidence_status='invalidated' WHERE school_id=? AND assessment_id=? AND publication_state IN ('published','locked')`, [schoolId, assessment.id])
    await connection.query('UPDATE learner_assessment_entries SET is_official=0,updated_by=? WHERE school_id=? AND mark_sheet_id=?', [actor.id, schoolId, sheet.id])
    await connection.query('UPDATE learner_question_marks SET is_official=0,updated_by=? WHERE school_id=? AND mark_sheet_id=?', [actor.id, schoolId, sheet.id])
    await connection.query('UPDATE learner_topic_results SET is_official=0,updated_by=? WHERE school_id=? AND mark_sheet_id=?', [actor.id, schoolId, sheet.id])
    await connection.query(`UPDATE academic_mark_sheets SET status='draft',published_by=NULL,published_at=NULL,updated_by=?,version_number=version_number+1,updated_at=CURRENT_TIMESTAMP WHERE school_id=? AND id=?`, [actor.id, schoolId, sheet.id])
    const [learners] = await connection.query('SELECT DISTINCT student_id FROM learner_assessment_entries WHERE school_id=? AND mark_sheet_id=?', [schoolId, sheet.id])
    const [topics] = await connection.query('SELECT DISTINCT topic_id FROM learner_topic_results WHERE school_id=? AND mark_sheet_id=? AND topic_id IS NOT NULL', [schoolId, sheet.id])
    for (const learner of learners) {
      await recalculateStudentMastery(schoolId, learner.student_id, assessment.subject_id, { academic_year_id: assessment.academic_year_id, term_id: assessment.term_id }, connection)
      for (const topic of topics) await recalculateStudentMastery(schoolId, learner.student_id, assessment.subject_id, { academic_year_id: assessment.academic_year_id, term_id: assessment.term_id, topic_id: topic.topic_id }, connection)
    }
    await recalculateClassMastery(schoolId, { classId: assessment.class_id, subjectId: assessment.subject_id, academicYearId: assessment.academic_year_id, termId: assessment.term_id }, connection)
    await audit(connection, schoolId, actor, 'ACADEMIC_MARK_SHEET_REOPENED', 'academic_mark_sheet', sheet.id, { assessment_id: assessment.id, mode, invalidated_official_evidence: true })
    await connection.commit()
    return { public_ref: sheet.public_ref, status: 'draft', entry_mode: mode, version_number: Number(sheet.version_number || 1) + 1 }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function resolveRef(connection, table, schoolId, ref, numeric = null) {
  if (numeric) return Number(numeric)
  if (!ref) return null
  const [[row]] = await connection.query(`SELECT id FROM ${table} WHERE school_id=? AND public_ref=? LIMIT 1`, [schoolId, String(ref)])
  return row ? Number(row.id) : null
}

export async function createTargetedAssessmentDraft(schoolId, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const classId = await resolveRef(connection, "classes", schoolId, body.class_ref, body.class_id)
    const subjectId = await resolveRef(connection, "subjects", schoolId, body.subject_ref, body.subject_id)
    const topicId = await resolveRef(connection, "syllabus_topics", schoolId, body.topic_ref, body.topic_id)
    const requestedSubtopicId = body.subtopic_ref || body.subtopic_id ? await resolveRef(connection, "syllabus_topics", schoolId, body.subtopic_ref, body.subtopic_id) : null
    if (!classId || !subjectId || !topicId) throw new HttpError(400, "Class, subject and target topic are required.")
    const [[topic]] = await connection.query("SELECT id,subject_id,parent_topic_id FROM syllabus_topics WHERE school_id=? AND id=? AND is_active=1 LIMIT 1", [schoolId, topicId])
    if (!topic || Number(topic.subject_id) !== Number(subjectId)) throw new HttpError(400, "The selected topic must belong to the selected subject syllabus.")
    if (requestedSubtopicId) {
      const [[subtopic]] = await connection.query("SELECT id,subject_id,parent_topic_id FROM syllabus_topics WHERE school_id=? AND id=? AND is_active=1 LIMIT 1", [schoolId, requestedSubtopicId])
      if (!subtopic || Number(subtopic.subject_id) !== Number(subjectId) || Number(subtopic.parent_topic_id) !== Number(topicId)) throw new HttpError(400, "The selected subtopic must belong to the selected syllabus topic.")
    }
    const targetTopicId = Number(requestedSubtopicId || topicId)
    const purpose = String(body.purpose || "diagnostic")
    if (!GENERATED_PURPOSES.has(purpose)) throw new HttpError(400, "Targeted assessment purpose is invalid.")
    const totalMarks = Math.max(1, Number(body.total_marks || 20)); const questionCount = Math.max(1, Math.min(30, Number(body.question_count || 5))); const duration = Math.max(5, Number(body.duration_minutes || 20))
    const ref = randomUUID()
    await connection.query(`INSERT INTO generated_assessments (public_ref,school_id,source_finding_ref,intervention_id,academic_year_id,term_id,class_id,subject_id,topic_id,purpose,title,duration_minutes,total_marks,question_count,difficulty_distribution_json,target_objectives_json,prerequisite_topics_json,baseline_evidence_json,status,generation_source,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`, [ref, schoolId, body.finding_ref || null, body.intervention_id || null, body.academic_year_id || null, body.term_id || null, classId, subjectId, targetTopicId, purpose, String(body.title || "Targeted diagnostic assessment").trim(), duration, totalMarks, questionCount, JSON.stringify(body.difficulty_distribution || { easy: 30, medium: 50, challenging: 20 }), JSON.stringify(body.target_objectives || []), JSON.stringify(body.prerequisite_topics || []), JSON.stringify(body.previous_evidence || {}), body.use_ai ? "ai_draft" : "deterministic", actor.id, actor.id])
    const [[generated]] = await connection.query("SELECT id FROM generated_assessments WHERE school_id=? AND public_ref=?", [schoolId, ref])
    let learners = Array.isArray(body.learners) ? body.learners : []
    if (!learners.length && (body.auto_select_below_threshold || body.finding_ref)) {
      const config = await getAcademicEngineConfig(schoolId, connection)
      const [suggested] = await connection.query(
        `SELECT DISTINCT s.id student_id,s.public_ref student_ref,amr.mastery_score,amr.confidence_score,amr.mastery_status
         FROM student_enrollments se
         JOIN students s ON s.id=se.student_id AND s.school_id=se.school_id
         LEFT JOIN academic_mastery_records amr ON amr.id=(
           SELECT recent.id FROM academic_mastery_records recent
           WHERE recent.school_id=se.school_id AND recent.student_id=se.student_id
             AND recent.subject_id=? AND recent.topic_id=? AND recent.mastery_level='topic'
           ORDER BY recent.last_recalculated_at DESC,recent.updated_at DESC,recent.id DESC LIMIT 1
         )
         WHERE se.school_id=? AND se.class_id=? AND se.enrollment_status='active'
           AND (? IS NULL OR se.academic_year_id=?) AND (? IS NULL OR se.term_id=?)
           AND (amr.mastery_score IS NULL OR amr.mastery_score<?)
         ORDER BY amr.mastery_score IS NULL,amr.mastery_score,s.last_name,s.first_name LIMIT 60`,
        [subjectId,targetTopicId,schoolId,classId,body.academic_year_id || null,body.academic_year_id || null,body.term_id || null,body.term_id || null,Number(config.mastery_threshold || 70)],
      )
      learners = suggested.map((learner) => ({ student_id: learner.student_id, student_ref: learner.student_ref, reason: learner.mastery_score === null ? "Valid recent topic evidence is missing" : `Topic mastery is ${Number(learner.mastery_score).toFixed(1)}%, below the secure threshold`, confidence: learner.confidence_score, evidence: { mastery_score: learner.mastery_score, mastery_status: learner.mastery_status, source: "academic_mastery_record" } }))
    }
    learners = dedupeTargetedLearners(learners)
    for (const learner of learners) {
      const studentId = await resolveRef(connection, "students", schoolId, learner.student_ref, learner.student_id)
      if (!studentId) throw new HttpError(400, "One selected learner is invalid.")
      const [[eligible]] = await connection.query("SELECT id FROM student_enrollments WHERE school_id=? AND student_id=? AND class_id=? AND enrollment_status='active' AND (? IS NULL OR academic_year_id=?) AND (? IS NULL OR term_id=?) LIMIT 1", [schoolId, studentId, classId, body.academic_year_id || null, body.academic_year_id || null, body.term_id || null, body.term_id || null])
      if (!eligible) throw new HttpError(400, "Every selected learner must be actively enrolled in the selected class.")
      await connection.query(`INSERT INTO generated_assessment_learners (public_ref,school_id,generated_assessment_id,student_id,selection_reason,evidence_json,confidence_score,confirmed_by,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?)`, [randomUUID(), schoolId, generated.id, studentId, String(learner.reason || "Teacher-selected for targeted evidence review"), JSON.stringify(learner.evidence || {}), learner.confidence ?? null, body.confirm_learners ? actor.id : null, body.confirm_learners ? new Date() : null])
    }
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_DRAFT_CREATED", "generated_assessment", generated.id, { public_ref: ref, purpose, learner_count: learners.length, status: "draft" })
    await connection.commit()
    return { public_ref: ref, status: "draft", learner_count: learners.length, learners_confirmed: Boolean(body.confirm_learners), automatically_proposed: !Array.isArray(body.learners) || !body.learners.length, teacher_review_required: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

async function generatedContext(connection, schoolId, ref, lock = false) {
  const [[row]] = await connection.query(`SELECT ga.*,c.name class_name,c.grade_level,s.name subject_name,
    t.id target_topic_id,t.public_ref target_topic_ref,t.topic_name target_topic_name,
    COALESCE(parent.id,t.id) broad_topic_id,COALESCE(parent.public_ref,t.public_ref) topic_ref,COALESCE(parent.topic_name,t.topic_name) topic_name,
    IF(parent.id IS NULL,NULL,t.id) subtopic_id,IF(parent.id IS NULL,NULL,t.public_ref) subtopic_ref,IF(parent.id IS NULL,NULL,t.topic_name) subtopic_name
    FROM generated_assessments ga
    JOIN classes c ON c.id=ga.class_id AND c.school_id=ga.school_id
    JOIN subjects s ON s.id=ga.subject_id AND s.school_id=ga.school_id
    LEFT JOIN syllabus_topics t ON t.id=ga.topic_id AND t.school_id=ga.school_id
    LEFT JOIN syllabus_topics parent ON parent.id=t.parent_topic_id AND parent.school_id=t.school_id
    WHERE ga.school_id=? AND ga.public_ref=? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [schoolId, String(ref)])
  if (!row) throw new HttpError(404, "Targeted assessment was not found.")
  return row
}

function distributeMarks(total, count) {
  const base = Math.floor(total / count); let remainder = total - base * count
  return Array.from({ length: count }, () => { const value = base + (remainder > 0 ? 1 : 0); remainder -= remainder > 0 ? 1 : 0; return value })
}

export async function generateTargetedAssessment(schoolId, ref, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generatedContext(connection, schoolId, ref, true)
    if (["approved", "published", "archived"].includes(generated.status)) throw new HttpError(409, "Approved targeted assessments cannot be regenerated.")
    const count = Number(generated.question_count); const allocations = distributeMarks(Number(generated.total_marks), count)
    const [library] = await connection.query(`SELECT q.id,q.public_ref,q.question_text,q.question_type,q.options_json,q.correct_answer,q.explanation,q.difficulty,q.cognitive_level,q.skill_type,q.marks,q.learning_objective_id,q.topic_id,q.subtopic_id,p.permission_status,p.reuse_allowed,p.transformation_allowed,p.attribution_text FROM question_bank q JOIN question_source_permissions p ON p.question_bank_id=q.id AND p.school_id=q.school_id WHERE q.school_id=? AND q.subject_id=? AND ((? IS NOT NULL AND (q.subtopic_id=? OR q.topic_id=?)) OR (? IS NULL AND q.topic_id=?)) AND q.approval_status='approved' AND q.archived_at IS NULL AND p.reuse_allowed=1 AND p.permission_status NOT IN ('unknown_permission','prohibited_reuse') ORDER BY (q.subtopic_id=?) DESC,q.times_attempted ASC,q.updated_at DESC LIMIT ?`, [schoolId, generated.subject_id, generated.subtopic_id, generated.subtopic_id, generated.target_topic_id, generated.subtopic_id, generated.broad_topic_id, generated.subtopic_id, count])
    let questions = library.map((question, index) => {
      const responseLayout = buildGeneratedResponseLayout({ question_type: question.question_type, marks: allocations[index] })
      return { question_text: question.question_text, question_type: question.question_type, options: normalizeGeneratedOptions(question), marks: allocations[index], topic_id: generated.broad_topic_id, topic_ref: generated.topic_ref, topic_name: generated.topic_name, subtopic_id: generated.subtopic_id, subtopic_ref: generated.subtopic_ref, subtopic_name: generated.subtopic_name, mapping_topic_id: generated.target_topic_id, mapping_topic_ref: generated.target_topic_ref, objective_id: question.learning_objective_id, difficulty: question.difficulty, cognitive_level: question.cognitive_level || question.skill_type || "application", source_question_id: question.id, source_question_ref: question.public_ref, source_permission: { permission_status: question.permission_status, reuse_allowed: question.reuse_allowed, transformation_allowed: question.transformation_allowed }, transformation_type: "verbatim", expected_answer: question.correct_answer, marking_points: [question.explanation || question.correct_answer].filter(Boolean), attribution: question.attribution_text || null, response_layout: responseLayout, style_json: responseLayout }
    })
    let generationSource = "deterministic"; let provider = null; let model = null
    if (body.use_ai || generated.generation_source === "ai_draft") {
      const [objectives] = await connection.query("SELECT id,public_ref,objective_text,topic_id FROM learning_objectives WHERE school_id=? AND topic_id IN (?,?) AND is_active=1 ORDER BY (topic_id=?) DESC,curriculum_order,id", [schoolId, generated.target_topic_id, generated.broad_topic_id, generated.target_topic_id])
      const ai = await generateDraftQuestions({ schoolId, userId: actor.id, curriculum: "school-approved syllabus", gradeName: generated.grade_level, subjectName: generated.subject_name, topicName: [generated.topic_name, generated.subtopic_name].filter(Boolean).join(" — "), difficulty: "mixed", questionType: "mixed", numberOfQuestions: count, includeExplanations: true, approvedSyllabusContext: { approved_topics: [{ id: generated.topic_ref, topic_name: generated.topic_name, approved_subtopic: generated.subtopic_name || null, approved_success_criteria: objectives.map((objective) => ({ id: objective.public_ref, text: objective.objective_text })) }] }, assessmentQuestionHistory: [], teacherQuestionStyleExamples: [] })
      if (ai.ok && ai.data?.questions?.length) {
        questions = ai.data.questions.slice(0, count).map((question, index) => {
          const responseLayout = buildGeneratedResponseLayout({ question_type: question.question_type, marks: allocations[index] })
          const objective = objectives[index % Math.max(1, objectives.length)] || null
          return { question_text: question.question_text, question_type: question.question_type, options: normalizeGeneratedOptions(question), marks: allocations[index], topic_id: generated.broad_topic_id, topic_ref: generated.topic_ref, topic_name: generated.topic_name, subtopic_id: generated.subtopic_id, subtopic_ref: generated.subtopic_ref, subtopic_name: generated.subtopic_name, mapping_topic_id: generated.target_topic_id, mapping_topic_ref: generated.target_topic_ref, objective_id: objective?.id || null, objective_ref: objective?.public_ref || null, difficulty: question.difficulty, cognitive_level: question.skill_type, source_question_id: null, source_question_ref: null, transformation_type: "ai_generated", expected_answer: question.correct_answer, marking_points: [question.explanation, ...(question.accepted_answers || [])].filter(Boolean), response_layout: responseLayout, style_json: responseLayout }
        })
        generationSource = "ai_draft"; provider = ai.provider || null; model = ai.model || null
      }
    }
    if (questions.length < count) throw new HttpError(409, `Only ${questions.length} approved, reusable questions are available for this topic. Approve more source questions or enable the reviewed AI composer.`)
    const paper = { title: generated.title, instructions: ["Answer every question in the space provided.", "Show working where appropriate."], purpose: generated.purpose, topic: { public_ref: generated.topic_ref, name: generated.topic_name }, subtopic: generated.subtopic_ref ? { public_ref: generated.subtopic_ref, name: generated.subtopic_name } : null, selected_learner_count: Number((await connection.query("SELECT COUNT(*) total FROM generated_assessment_learners WHERE school_id=? AND generated_assessment_id=?", [schoolId, generated.id]))[0][0].total), questions }
    const validation = validateGeneratedAssessmentDraft(paper, { totalMarks: generated.total_marks })
    const [[last]] = await connection.query("SELECT COALESCE(MAX(version_number),0) version FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=?", [schoolId, generated.id])
    await connection.query(`INSERT INTO generated_assessment_versions (public_ref,school_id,generated_assessment_id,version_number,paper_json,validation_json,change_summary,approval_status,created_by) VALUES (?,?,?,?,?,?,?,'review_required',?)`, [randomUUID(), schoolId, generated.id, Number(last.version) + 1, JSON.stringify(paper), JSON.stringify(validation), body.replace_question_index !== undefined ? `Replaced question ${Number(body.replace_question_index) + 1}` : "Initial generated draft", actor.id])
    await connection.query("UPDATE generated_assessments SET status='review_required',generation_source=?,provider=?,model=?,prompt_version=?,updated_by=? WHERE id=? AND school_id=?", [generationSource, provider, model, generationSource === "ai_draft" ? "targeted-assessment-v1" : null, actor.id, generated.id, schoolId])
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_GENERATED", "generated_assessment", generated.id, { version: Number(last.version) + 1, validation, generation_source: generationSource })
    await connection.commit()
    return { public_ref: generated.public_ref, status: "review_required", version: Number(last.version) + 1, paper, validation, generation_source: generationSource, teacher_review_required: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function saveTargetedAssessmentReview(schoolId, ref, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generatedContext(connection, schoolId, ref, true)
    if (["approved", "published", "archived"].includes(generated.status)) throw new HttpError(409, "Approved targeted assessments cannot be edited.")
    const paper = body.paper
    if (!paper || typeof paper !== "object") throw new HttpError(400, "A reviewed paper is required.")
    const validation = validateGeneratedAssessmentDraft(paper, { totalMarks: generated.total_marks })
    const [[last]] = await connection.query("SELECT COALESCE(MAX(version_number),0) version FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=?", [schoolId, generated.id])
    await connection.query(`INSERT INTO generated_assessment_versions (public_ref,school_id,generated_assessment_id,version_number,paper_json,validation_json,change_summary,approval_status,created_by) VALUES (?,?,?,?,?,?,?,'review_required',?)`, [randomUUID(), schoolId, generated.id, Number(last.version) + 1, JSON.stringify(paper), JSON.stringify(validation), String(body.change_summary || "Teacher review edits").slice(0, 500), actor.id])
    await connection.query("UPDATE generated_assessments SET status='review_required',updated_by=? WHERE id=? AND school_id=?", [actor.id, generated.id, schoolId])
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_REVIEW_SAVED", "generated_assessment", generated.id, { version: Number(last.version) + 1, validation })
    await connection.commit()
    return { public_ref: ref, status: "review_required", version: Number(last.version) + 1, validation }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function replaceTargetedAssessmentQuestion(schoolId, ref, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generatedContext(connection, schoolId, ref, true)
    if (["approved", "published", "archived"].includes(generated.status)) throw new HttpError(409, "Approved targeted assessments cannot be edited.")
    const [[version]] = await connection.query("SELECT * FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=? ORDER BY version_number DESC LIMIT 1 FOR UPDATE", [schoolId, generated.id])
    if (!version) throw new HttpError(409, "Generate the assessment before replacing a question.")
    const paper = parseJson(version.paper_json, {})
    const questions = Array.isArray(paper.questions) ? [...paper.questions] : []
    const index = Number(body.question_index)
    if (!Number.isInteger(index) || index < 0 || index >= questions.length) throw new HttpError(400, "A valid question index is required.")
    const excluded = questions.map((question) => Number(question.source_question_id || 0)).filter(Boolean)
    const params = [schoolId, generated.subject_id, generated.subtopic_id, generated.subtopic_id, generated.target_topic_id, generated.subtopic_id, generated.broad_topic_id]
    const exclusion = excluded.length ? ` AND q.id NOT IN (${excluded.map(() => "?").join(",")})` : ""
    params.push(...excluded)
    const [[source]] = await connection.query(`SELECT q.id,q.public_ref,q.question_text,q.question_type,q.options_json,q.correct_answer,q.explanation,q.difficulty,q.cognitive_level,q.skill_type,q.learning_objective_id,p.permission_status,p.reuse_allowed,p.transformation_allowed,p.attribution_text FROM question_bank q JOIN question_source_permissions p ON p.question_bank_id=q.id AND p.school_id=q.school_id WHERE q.school_id=? AND q.subject_id=? AND ((? IS NOT NULL AND (q.subtopic_id=? OR q.topic_id=?)) OR (? IS NULL AND q.topic_id=?)) AND q.approval_status='approved' AND q.archived_at IS NULL AND p.reuse_allowed=1 AND p.permission_status NOT IN ('unknown_permission','prohibited_reuse')${exclusion} ORDER BY (q.subtopic_id=?) DESC,q.times_attempted ASC,q.updated_at DESC LIMIT 1`, [...params, generated.subtopic_id])
    if (!source) throw new HttpError(409, "No different approved, reusable source question is available for this topic.")
    const originalMarks = Number(questions[index].marks)
    const responseLayout = buildGeneratedResponseLayout({ question_type: source.question_type, marks: originalMarks })
    questions[index] = { question_text: source.question_text, question_type: source.question_type, options: normalizeGeneratedOptions(source), marks: originalMarks, topic_id: generated.broad_topic_id, topic_ref: generated.topic_ref, topic_name: generated.topic_name, subtopic_id: generated.subtopic_id, subtopic_ref: generated.subtopic_ref, subtopic_name: generated.subtopic_name, mapping_topic_id: generated.target_topic_id, mapping_topic_ref: generated.target_topic_ref, objective_id: source.learning_objective_id, difficulty: source.difficulty, cognitive_level: source.cognitive_level || source.skill_type || "application", source_question_id: source.id, source_question_ref: source.public_ref, source_permission: { permission_status: source.permission_status, reuse_allowed: source.reuse_allowed, transformation_allowed: source.transformation_allowed }, transformation_type: "verbatim", expected_answer: source.correct_answer, marking_points: [source.explanation || source.correct_answer].filter(Boolean), attribution: source.attribution_text || null, response_layout: responseLayout, style_json: responseLayout }
    const nextPaper = { ...paper, questions }
    const validation = validateGeneratedAssessmentDraft(nextPaper, { totalMarks: generated.total_marks })
    await connection.query(`INSERT INTO generated_assessment_versions (public_ref,school_id,generated_assessment_id,version_number,paper_json,validation_json,change_summary,approval_status,created_by) VALUES (?,?,?,?,?,?,?,'review_required',?)`, [randomUUID(), schoolId, generated.id, Number(version.version_number) + 1, JSON.stringify(nextPaper), JSON.stringify(validation), `Replaced question ${index + 1}`, actor.id])
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_QUESTION_REPLACED", "generated_assessment", generated.id, { version: Number(version.version_number) + 1, question_index: index })
    await connection.commit()
    return { public_ref: ref, status: "review_required", version: Number(version.version_number) + 1, paper: nextPaper, validation }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function getTargetedAssessment(schoolId, ref, actor = null) {
  const generated = await generatedContext(pool, schoolId, ref)
  await assertTeacherAssessmentAccess(pool, schoolId, generated, actor)
  const [[version]] = await pool.query("SELECT public_ref,version_number,paper_json,validation_json,approval_status,change_summary,created_at FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=? ORDER BY version_number DESC LIMIT 1", [schoolId, generated.id])
  const [learners] = await pool.query(`SELECT gal.public_ref,s.public_ref student_ref,CONCAT(s.first_name,' ',s.last_name) student_name,gal.selection_reason,gal.evidence_json,gal.confidence_score,gal.confirmed_at FROM generated_assessment_learners gal JOIN students s ON s.id=gal.student_id AND s.school_id=gal.school_id WHERE gal.school_id=? AND gal.generated_assessment_id=? ORDER BY s.last_name,s.first_name`, [schoolId, generated.id])
  return { assessment: { public_ref: generated.public_ref, source_finding_ref: generated.source_finding_ref, class_name: generated.class_name, subject_name: generated.subject_name, topic_ref: generated.topic_ref, topic_name: generated.topic_name, subtopic_ref: generated.subtopic_ref, subtopic_name: generated.subtopic_name, purpose: generated.purpose, title: generated.title, duration_minutes: generated.duration_minutes, total_marks: Number(generated.total_marks), question_count: generated.question_count, status: generated.status, generation_source: generated.generation_source, provider: generated.provider, model: generated.model, published_assessment_id: generated.assessment_id }, version: version ? { ...version, paper: parseJson(version.paper_json, {}), validation: parseJson(version.validation_json, {}), paper_json: undefined, validation_json: undefined } : null, learners: learners.map((learner) => ({ ...learner, evidence: parseJson(learner.evidence_json, {}), evidence_json: undefined, confirmed: Boolean(learner.confirmed_at) })) }
}

export async function confirmTargetedLearners(schoolId, ref, actor, body = {}) {
  const generated = await generatedContext(pool, schoolId, ref)
  const refs = Array.isArray(body.student_refs) ? body.student_refs : []
  if (!refs.length) throw new HttpError(400, "Select at least one learner to confirm.")
  const [result] = await pool.query(`UPDATE generated_assessment_learners gal JOIN students s ON s.id=gal.student_id AND s.school_id=gal.school_id SET gal.confirmed_by=?,gal.confirmed_at=CURRENT_TIMESTAMP WHERE gal.school_id=? AND gal.generated_assessment_id=? AND s.public_ref IN (${refs.map(() => "?").join(",")})`, [actor.id, schoolId, generated.id, ...refs])
  return { confirmed: Number(result.affectedRows || 0) }
}

export async function approveTargetedAssessment(schoolId, ref, actor) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generatedContext(connection, schoolId, ref, true)
    const [[version]] = await connection.query("SELECT * FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=? ORDER BY version_number DESC LIMIT 1 FOR UPDATE", [schoolId, generated.id])
    if (!version) throw new HttpError(409, "Generate the targeted assessment before approval.")
    const paper = parseJson(version.paper_json, {})
    const validation = validateGeneratedAssessmentDraft(paper, { totalMarks: generated.total_marks })
    if (!validation.valid) throw new HttpError(409, "Resolve generated assessment validation issues before approval.", { details: { errors: validation.errors } })
    const [[learners]] = await connection.query("SELECT COUNT(*) total,SUM(confirmed_at IS NOT NULL) confirmed FROM generated_assessment_learners WHERE school_id=? AND generated_assessment_id=?", [schoolId, generated.id])
    if (!Number(learners.total) || Number(learners.confirmed) !== Number(learners.total)) throw new HttpError(409, "The teacher must confirm every targeted learner before approval.")
    await connection.query("UPDATE generated_assessment_versions SET approval_status='approved' WHERE id=? AND school_id=?", [version.id, schoolId])
    await connection.query("UPDATE generated_assessments SET status='approved',reviewer_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=? AND school_id=?", [actor.id, actor.id, generated.id, schoolId])
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_APPROVED", "generated_assessment", generated.id, { version: version.version_number, learners: Number(learners.total) })
    await connection.commit()
    return { public_ref: generated.public_ref, status: "approved", validation }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function publishTargetedAssessment(schoolId, ref, actor) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generatedContext(connection, schoolId, ref, true)
    if (generated.status === "published" && generated.assessment_id) { await connection.commit(); return { public_ref: ref, status: "published", assessment_id: generated.assessment_id, duplicate: true } }
    if (generated.status !== "approved") throw new HttpError(409, "Teacher approval is required before publication.")
    const [[version]] = await connection.query("SELECT * FROM generated_assessment_versions WHERE school_id=? AND generated_assessment_id=? AND approval_status='approved' ORDER BY version_number DESC LIMIT 1", [schoolId, generated.id])
    if (!version) throw new HttpError(409, "An approved assessment version is required.")
    const paper = parseJson(version.paper_json, {})
    const [[term]] = generated.term_id ? await connection.query("SELECT name FROM terms WHERE school_id=? AND id=? LIMIT 1", [schoolId, generated.term_id]) : [[]]
    const [assessmentResult] = await connection.query(`INSERT INTO assessments (school_id,class_id,subject_id,academic_year_id,term_id,teacher_id,name,assessment_type,term_name,total_marks,duration_minutes,instructions,expected_difficulty,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`, [schoolId, generated.class_id, generated.subject_id, generated.academic_year_id, generated.term_id, actor.id, generated.title, "class_test", term?.name || "Targeted intervention", generated.total_marks, generated.duration_minutes, (paper.instructions || []).join("\n"), "Medium", actor.id])
    for (const [index, question] of (paper.questions || []).entries()) {
      const questionType = ["multiple_choice","true_false","short_answer","structured","essay","calculation","fill_blank"].includes(question.question_type) ? question.question_type : "structured"
      const topicId = Number(question.topic_id || generated.broad_topic_id)
      const subtopicId = Number(question.subtopic_id || generated.subtopic_id || 0) || null
      const mappingTopicId = Number(question.mapping_topic_id || subtopicId || topicId)
      const objectiveId = Number(question.objective_id) || null
      const responseLayout = { ...buildGeneratedResponseLayout({ question_type: questionType, marks: question.marks }), ...(question.response_layout || question.style_json || {}) }
      const [questionResult] = await connection.query(`INSERT INTO assessment_questions (school_id,assessment_id,question_number,display_number,question_text,question_type,marks,topic_id,topic_text,subtopic_id,subtopic_text,learning_objective_id,difficulty,cognitive_skill,correct_answer,marking_scheme,marking_points_json,mapping_status,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [schoolId, assessmentResult.insertId, index + 1, String(index + 1), question.question_text, questionType, question.marks, topicId, question.topic_name || generated.topic_name, subtopicId, question.subtopic_name || generated.subtopic_name || null, objectiveId, ["easy","medium","hard"].includes(question.difficulty) ? question.difficulty : "medium", ["recall","understanding","application","analysis"].includes(question.cognitive_level) ? question.cognitive_level : "application", question.expected_answer, (question.marking_points || []).join("\n"), JSON.stringify(question.marking_points || []), "mapped", index + 1])
      const options = normalizeGeneratedOptions(question)
      if (options.length) await connection.query(`INSERT INTO assessment_question_options (school_id,question_id,option_label,option_text,is_correct,sort_order) VALUES ?`, [options.map((option) => [schoolId, questionResult.insertId, option.option_label, option.option_text, option.is_correct ? 1 : 0, option.sort_order])])
      await connection.query(`INSERT INTO question_topic_mappings (public_ref,school_id,assessment_question_id,topic_id,allocation_type,allocated_marks,allocated_percentage,is_primary,created_by,updated_by) VALUES (UUID(),?,?,?,'marks',?,100,1,?,?)`, [schoolId, questionResult.insertId, mappingTopicId, question.marks, actor.id, actor.id])
      if (objectiveId) await connection.query(`INSERT INTO question_objective_mappings (public_ref,school_id,assessment_question_id,learning_objective_id,mapping_role,created_by,updated_by) VALUES (UUID(),?,?,?,'primary',?,?)`, [schoolId, questionResult.insertId, objectiveId, actor.id, actor.id])
      await connection.query(`INSERT INTO assessment_blocks (school_id,assessment_id,block_type,content_json,style_json,metadata_json,sort_order,is_printable) VALUES (?,?,'question',?,?,?,?,1)`, [schoolId, assessmentResult.insertId, JSON.stringify({ question_number: String(index + 1), question_text: question.question_text, question_type: questionType, marks: Number(question.marks), options: question.options || [] }), JSON.stringify({ spacing: "normal", z_index: 0, offset_x: 0, offset_y: 0, ...responseLayout }), JSON.stringify({ generated_assessment_ref: generated.public_ref, topic_ref: question.topic_ref || generated.topic_ref, subtopic_ref: question.subtopic_ref || generated.subtopic_ref || null }), 100 + index])
      if (question.source_question_id) await connection.query(`INSERT INTO question_source_lineage (public_ref,school_id,assessment_question_id,source_question_bank_id,transformation_type,provider,model,prompt_version,created_by) VALUES (UUID(),?,?,?,?,?,?,?,?)`, [schoolId, questionResult.insertId, question.source_question_id, question.transformation_type || "verbatim", generated.provider, generated.model, generated.prompt_version, actor.id])
    }
    await connection.query("UPDATE generated_assessments SET assessment_id=?,status='published',updated_by=? WHERE id=? AND school_id=?", [assessmentResult.insertId, actor.id, generated.id, schoolId])
    const publishedAssessment = { ...generated, id: assessmentResult.insertId, academic_year_id: generated.academic_year_id, term_id: generated.term_id, class_id: generated.class_id, subject_id: generated.subject_id }
    const markSheet = await ensureMarkSheet(connection, schoolId, publishedAssessment, "question", actor, `targeted-assessment:${generated.public_ref}`)
    if (generated.intervention_id && generated.purpose === "intervention_reassessment") {
      const [[baseline]] = await connection.query(`SELECT ams.id FROM academic_mark_sheets ams JOIN learner_topic_results ltr ON ltr.mark_sheet_id=ams.id AND ltr.school_id=ams.school_id AND ltr.topic_id=? AND ltr.is_official=1 WHERE ams.school_id=? AND ams.class_id=? AND ams.subject_id=? AND ams.status IN ('published','locked') GROUP BY ams.id,ams.published_at ORDER BY ams.published_at DESC LIMIT 1`, [generated.topic_id, schoolId, generated.class_id, generated.subject_id])
      await connection.query(`INSERT INTO academic_intervention_reassessments (public_ref,school_id,intervention_id,generated_assessment_id,baseline_mark_sheet_id,success_criterion_json) VALUES (UUID(),?,?,?,?,?)`, [schoolId, generated.intervention_id, generated.id, baseline?.id || null, JSON.stringify({ success_threshold: 60, minimum_change: 5 })]).catch((error) => { if (error.code !== "ER_DUP_ENTRY") throw error })
    }
    await audit(connection, schoolId, actor, "TARGETED_ASSESSMENT_PUBLISHED", "generated_assessment", generated.id, { assessment_id: assessmentResult.insertId, mark_sheet_ref: markSheet.public_ref, version: version.version_number })
    await connection.commit()
    return { public_ref: ref, status: "published", assessment_id: Number(assessmentResult.insertId), mark_sheet_ref: markSheet.public_ref, mark_sheet_path: `/results/${assessmentResult.insertId}?mode=question`, teacher_reviewed: true }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function listTargetedAssessments(schoolId, filters = {}, actor = null) {
  const params = [schoolId]; const clauses = []
  if (String(actor?.role || '').toLowerCase() === 'teacher') { clauses.push("EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=ga.school_id AND tcsa.teacher_id=? AND tcsa.class_id=ga.class_id AND tcsa.subject_id=ga.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)"); params.push(Number(actor.id)) }
  if (filters.status) { clauses.push("ga.status=?"); params.push(String(filters.status)) }
  if (filters.class_ref) { clauses.push("c.public_ref=?"); params.push(String(filters.class_ref)) }
  const [rows] = await pool.query(`SELECT ga.public_ref,ga.source_finding_ref,ga.title,ga.purpose,ga.duration_minutes,ga.total_marks,ga.question_count,ga.status,ga.generation_source,ga.assessment_id,ga.created_at,ga.updated_at,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,COALESCE(parent.public_ref,t.public_ref) topic_ref,COALESCE(parent.topic_name,t.topic_name) topic_name,IF(parent.id IS NULL,NULL,t.public_ref) subtopic_ref,IF(parent.id IS NULL,NULL,t.topic_name) subtopic_name,(SELECT COUNT(*) FROM generated_assessment_learners gal WHERE gal.school_id=ga.school_id AND gal.generated_assessment_id=ga.id) learner_count,(SELECT COUNT(*) FROM generated_assessment_learners gal WHERE gal.school_id=ga.school_id AND gal.generated_assessment_id=ga.id AND gal.confirmed_at IS NOT NULL) confirmed_learner_count FROM generated_assessments ga JOIN classes c ON c.id=ga.class_id AND c.school_id=ga.school_id JOIN subjects s ON s.id=ga.subject_id AND s.school_id=ga.school_id LEFT JOIN syllabus_topics t ON t.id=ga.topic_id AND t.school_id=ga.school_id LEFT JOIN syllabus_topics parent ON parent.id=t.parent_topic_id AND parent.school_id=t.school_id WHERE ga.school_id=?${clauses.length ? ` AND ${clauses.join(" AND ")}` : ""} ORDER BY ga.updated_at DESC LIMIT 100`, params)
  return { targeted_assessments: rows.map((row) => ({ ...row, total_marks: Number(row.total_marks), learner_count: Number(row.learner_count), confirmed_learner_count: Number(row.confirmed_learner_count) })) }
}

export async function updateQuestionSourcePermission(schoolId, questionRef, actor, body = {}) {
  const allowed = new Set(["school_owned", "teacher_authored", "public_domain", "licensed", "internal_use_only", "attribution_required", "unknown_permission", "prohibited_reuse"])
  const status = String(body.permission_status || "")
  if (!allowed.has(status)) throw new HttpError(400, "Question source permission status is invalid.")
  const [[question]] = await pool.query("SELECT id FROM question_bank WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, String(questionRef)])
  if (!question) throw new HttpError(404, "Question source was not found.")
  const reuseAllowed = ["unknown_permission", "prohibited_reuse"].includes(status) ? 0 : body.reuse_allowed ? 1 : 0
  const transformationAllowed = reuseAllowed && body.transformation_allowed ? 1 : 0
  await pool.query(`INSERT INTO question_source_permissions (public_ref,school_id,question_bank_id,permission_status,attribution_text,licence_reference,reuse_allowed,transformation_allowed,reviewed_by,reviewed_at,created_by,updated_by) VALUES (UUID(),?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?) ON DUPLICATE KEY UPDATE permission_status=VALUES(permission_status),attribution_text=VALUES(attribution_text),licence_reference=VALUES(licence_reference),reuse_allowed=VALUES(reuse_allowed),transformation_allowed=VALUES(transformation_allowed),reviewed_by=VALUES(reviewed_by),reviewed_at=CURRENT_TIMESTAMP,updated_by=VALUES(updated_by)`, [schoolId, question.id, status, body.attribution_text || null, body.licence_reference || null, reuseAllowed, transformationAllowed, actor.id, actor.id, actor.id])
  await audit(pool, schoolId, actor, "QUESTION_SOURCE_PERMISSION_UPDATED", "question_bank", question.id, { permission_status: status, reuse_allowed: Boolean(reuseAllowed), transformation_allowed: Boolean(transformationAllowed) })
  return { question_ref: questionRef, permission_status: status, reuse_allowed: Boolean(reuseAllowed), transformation_allowed: Boolean(transformationAllowed) }
}

export async function getAssessmentOperationalIntelligence(schoolId, assessmentId, actor = null) {
  const assessment = await assessmentContext(pool, schoolId, assessmentId)
  await assertTeacherAssessmentAccess(pool, schoolId, assessment, actor)
  const questions = await loadMappedQuestions(pool, schoolId, assessment.id)
  const [questionStats] = await pool.query(`SELECT aq.id,aq.display_number,aq.question_text,aq.marks,COUNT(lqm.id) attempts,ROUND(AVG(lqm.marks_awarded),2) average_mark,ROUND(AVG(lqm.marks_awarded/NULLIF(lqm.marks_available,0)*100),2) success_rate,ROUND(SUM(lqm.marks_awarded=0)/NULLIF(COUNT(lqm.id),0)*100,2) zero_mark_rate,ROUND(SUM(lqm.marks_awarded=lqm.marks_available)/NULLIF(COUNT(lqm.id),0)*100,2) full_mark_rate,ROUND(SUM(lqm.response_status='omitted')/NULLIF(COUNT(lqm.id),0)*100,2) omission_rate FROM assessment_questions aq LEFT JOIN learner_question_marks lqm ON lqm.assessment_question_id=aq.id AND lqm.school_id=aq.school_id AND lqm.is_official=1 WHERE aq.school_id=? AND aq.assessment_id=? GROUP BY aq.id ORDER BY aq.sort_order,aq.id`, [schoolId, assessment.id])
  const [entries] = await pool.query(`SELECT lae.overall_marks,lae.percentage,lae.participation_status FROM learner_assessment_entries lae JOIN academic_mark_sheets ams ON ams.id=lae.mark_sheet_id AND ams.school_id=lae.school_id WHERE lae.school_id=? AND ams.assessment_id=? AND lae.is_official=1`, [schoolId, assessment.id])
  const scores = entries.map((entry) => Number(entry.percentage)).filter(Number.isFinite).sort((a, b) => a - b)
  const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : null
  const mapped = questions.filter((question) => validateQuestionTopicMappings(question, question.topic_mappings).valid).length
  return { assessment: { id: assessment.id, name: assessment.name, class_name: assessment.class_name, subject_name: assessment.subject_name, status: assessment.status, total_marks: Number(assessment.total_marks) }, completion: { official_scripts: entries.length, absent: entries.filter((entry) => entry.participation_status === "absent").length, incomplete: entries.filter((entry) => entry.participation_status === "incomplete").length }, distribution: { average: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null, median: median === null ? null : round(median), highest: scores.length ? scores[scores.length - 1] : null, lowest: scores.length ? scores[0] : null }, mapping: { mapped_questions: mapped, total_questions: questions.length, coverage_percentage: questions.length ? round(mapped / questions.length * 100) : 0, evidence_quality: !questions.length || !mapped ? "overall_only" : mapped === questions.length ? "question_level" : "partial_question_level" }, question_analytics: questionStats.map((row) => ({ ...row, attempts: Number(row.attempts), confidence: Number(row.attempts) >= 10 ? "supported" : "insufficient_sample", psychometric_claims_available: Number(row.attempts) >= 10 })) }
}

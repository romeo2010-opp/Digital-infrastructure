import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { createInAppNotification } from "./operationalCommunicationService.js"
import { validateSyllabusTopicScope } from "./curriculumScopeService.js"
import { requireActiveAcademicSession } from "./academicSessionService.js"

const DAY_MS = 86_400_000

// These are deliberately conservative defaults. Schools can override the
// numeric weights in academic_engine_config, but the source hierarchy remains
// explicit and auditable in every calculation explanation.
export const ASSESSMENT_SOURCE_WEIGHTS = Object.freeze({
  end_of_term_examination: 1,
  end_of_term_exam: 1,
  examination: 1,
  mid_term_examination: 0.9,
  mid_term_exam: 0.9,
  baseline_assessment: 0.75,
  practical_assessment: 0.8,
  project: 0.7,
  weekly_quiz: 0.6,
  quiz: 0.6,
  class_exercise: 0.4,
  homework: 0.3,
  teacher_observation: 0.2,
  daily_drill: 0.5,
  reassessment: 0.85,
  assessment_total: 0.8,
})

const EVIDENCE_STATUS_AUTHORITY = Object.freeze({
  published: 1,
  approved: 1,
  locked: 1,
  moderated: 1,
  submitted: 0.75,
  draft: 0.25,
  unverified: 0.25,
  invalidated: 0,
  absent: 0,
  excused: 0,
})

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Number((Number(value) * factor / factor).toFixed(digits))
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function median(values = []) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!ordered.length) return null
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function percentile(values = [], fraction = 0.5) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!ordered.length) return null
  const position = Math.min(ordered.length - 1, Math.max(0, (ordered.length - 1) * fraction))
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return ordered[lower]
  return ordered[lower] + ((ordered[upper] - ordered[lower]) * (position - lower))
}

export function assessmentSourceWeight(sourceType, overrides = {}) {
  const key = String(sourceType || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  const override = finiteOrNull(overrides[key])
  return Math.max(0, override ?? ASSESSMENT_SOURCE_WEIGHTS[key] ?? 0.5)
}

/**
 * Convert a source row into the canonical evidence shape used by every
 * academic calculation. This does not copy the source record; source_ref is
 * retained so a reviewer can trace the conclusion back to the source table.
 */
export function normalizeEvidenceRecord(record = {}, options = {}) {
  const awarded = finiteOrNull(record.marks_awarded ?? record.score)
  const maximum = finiteOrNull(record.marks_available ?? record.maximumValue ?? record.total_marks)
  const explicitPercentage = finiteOrNull(record.score_percentage ?? record.percentage)
  const percentage = explicitPercentage !== null
    ? clamp(explicitPercentage)
    : awarded !== null && maximum !== null && maximum > 0
      ? clamp((awarded / maximum) * 100)
      : null
  const status = String(record.verification_status || record.status || 'published').toLowerCase()
  const sourceType = String(record.evidence_type || record.source_type || record.assessment_type || 'unknown').toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  const participation = String(record.participation_status || '').toLowerCase()
  const isAbsent = ['absent', 'excused'].includes(status) || ['absent', 'excused'].includes(participation)
  const evidenceAt = record.evidence_at || record.observed_at || record.attempted_at || record.recorded_at || null
  const ageDays = evidenceAt && options.now ? Math.max(0, (dateMs(options.now) - (dateMs(evidenceAt) || dateMs(options.now))) / DAY_MS) : null
  const authority = EVIDENCE_STATUS_AUTHORITY[status] ?? 0.75
  const mappingQuality = record.learning_objective_id
    ? 'objective'
    : record.subtopic_id
      ? 'subtopic'
      : record.topic_id
        ? 'topic'
        : record.evidence_granularity || 'limited'
  // Draft/unverified rows remain visible as limitations but do not contribute
  // to official performance, mastery or readiness calculations.
  const valid = !isAbsent && authority >= 0.75 && percentage !== null && maximum !== null && maximum > 0
  return {
    school_id: record.school_id ?? options.schoolId ?? null,
    academic_year_id: record.academic_year_id ?? options.academicYearId ?? null,
    term_id: record.term_id ?? options.termId ?? null,
    class_id: record.class_id ?? null,
    stream_id: record.stream_id ?? record.stream_section ?? null,
    subject_id: record.subject_id ?? null,
    student_id: record.student_id ?? null,
    teacher_id: record.teacher_id ?? null,
    assessment_id: record.assessment_id ?? null,
    question_id: record.question_id ?? null,
    topic_id: record.topic_id ?? null,
    learning_objective_id: record.learning_objective_id ?? null,
    source_type: sourceType,
    source_ref: record.public_ref || record.source_id || record.source_entity_id || null,
    source_entity_type: record.source_entity_type || null,
    observed_at: record.observed_at || evidenceAt,
    recorded_at: record.recorded_at || record.created_at || null,
    evidence_at: evidenceAt,
    value: awarded,
    maximum_value: maximum,
    score_percentage: percentage,
    verification_status: status,
    evidence_quality: record.evidence_quality || (valid ? 'sufficient' : isAbsent ? 'absent' : 'incomplete'),
    mapping_quality: mappingQuality,
    recency_days: ageDays === null ? null : round(ageDays, 1),
    reliability: authority,
    confidence_weight: Math.max(0, authority * assessmentSourceWeight(sourceType, options.sourceWeights)),
    valid,
    metadata: jsonValue(record.metadata_json ?? record.metadata, {}),
  }
}

/**
 * Evidence quality is intentionally separate from achievement. A high mark
 * can still be low-confidence when it comes from one unmapped, draft item.
 */
export function assessEvidenceQuality(records = [], options = {}) {
  const now = options.now || new Date()
  const normalized = records.map((record) => normalizeEvidenceRecord(record, { ...options, now }))
  const valid = normalized.filter((record) => record.valid)
  const minimumAttempts = Math.max(1, Number(options.minimumAttempts ?? options.minimum_evidence_count ?? 3))
  const minimumCoverage = clamp(Number(options.minimumCoverage ?? 60))
  const recentDays = Math.max(1, Number(options.recentDays ?? 45))
  const volume = clamp((valid.length / minimumAttempts) * 100)
  const mapped = valid.filter((record) => ['objective', 'subtopic', 'topic'].includes(record.mapping_quality)).length
  const mapping = valid.length ? clamp((mapped / valid.length) * 100) : 0
  const recent = valid.filter((record) => record.recency_days === null || record.recency_days <= recentDays).length
  const recency = valid.length ? clamp((recent / valid.length) * 100) : 0
  const reliability = valid.length ? clamp((valid.reduce((sum, record) => sum + record.reliability, 0) / valid.length) * 100) : 0
  const scores = valid.map((record) => record.score_percentage).filter(Number.isFinite)
  const scoreMedian = median(scores)
  const deviations = scoreMedian === null ? [] : scores.map((score) => Math.abs(score - scoreMedian))
  const consistency = scores.length > 1 ? clamp(100 - ((median(deviations) || 0) * 2)) : (scores.length ? 50 : 0)
  const learnerIds = new Set(valid.map((record) => record.student_id).filter(Boolean))
  const assessedLearners = Math.max(0, Number(options.assessedLearners ?? learnerIds.size))
  const cohortCoverage = options.cohortSize ? clamp((assessedLearners / Number(options.cohortSize)) * 100) : null
  const components = {
    volume: round(volume),
    coverage: cohortCoverage === null ? round(mapping) : round((cohortCoverage + mapping) / 2),
    recency: round(recency),
    reliability: round(reliability),
    consistency: round(consistency),
    mapping: round(mapping),
  }
  const confidence = round(
    (components.volume * 0.2) +
    (components.coverage * 0.2) +
    (components.recency * 0.15) +
    (components.reliability * 0.2) +
    (components.consistency * 0.1) +
    (components.mapping * 0.15),
  )
  const stale = valid.length > 0 && recency === 0
  const unmapped = valid.length > 0 && mapping === 0
  const contradictory = scores.length >= 3 && (Math.max(...scores) - Math.min(...scores)) >= 55 && consistency < 30
  const state = !valid.length
    ? 'insufficient'
    : contradictory
      ? 'contradictory'
      : stale
        ? 'stale'
        : unmapped
          ? 'unmapped'
          : valid.length < minimumAttempts || (cohortCoverage !== null && cohortCoverage < minimumCoverage)
            ? 'limited'
            : 'sufficient'
  return {
    state,
    confidence_score: confidence,
    components,
    valid_count: valid.length,
    invalid_count: normalized.length - valid.length,
    assessed_learners: assessedLearners,
    cohort_coverage: cohortCoverage === null ? null : round(cohortCoverage),
    limitations: [
      ...(valid.length < minimumAttempts ? [`At least ${minimumAttempts} valid observations are recommended.`] : []),
      ...(cohortCoverage !== null && cohortCoverage < minimumCoverage ? [`Only ${round(cohortCoverage)}% of the cohort is represented.`] : []),
      ...(unmapped ? ['No valid curriculum mapping is available.'] : []),
      ...(stale ? [`No valid evidence was recorded in the last ${recentDays} days.`] : []),
      ...(contradictory ? ['Evidence is internally inconsistent and needs review.'] : []),
    ],
    records: normalized,
  }
}

export function calculatePerformanceScore(records = [], options = {}) {
  const quality = assessEvidenceQuality(records, options)
  const now = dateMs(options.now) || Date.now()
  let numerator = 0
  let denominator = 0
  for (const record of quality.records.filter((item) => item.valid && Number.isFinite(item.score_percentage))) {
    const ageDays = record.evidence_at ? Math.max(0, (now - (dateMs(record.evidence_at) || now)) / DAY_MS) : 0
    const halfLife = Math.max(1, Number(options.recencyHalfLifeDays || 60))
    const recency = Math.pow(0.5, ageDays / halfLife)
    const weight = Math.max(0.01, record.confidence_weight || assessmentSourceWeight(record.source_type, options.sourceWeights)) * recency
    numerator += record.score_percentage * weight
    denominator += weight
  }
  const score = denominator ? round(numerator / denominator) : null
  return {
    score,
    evidence_state: score === null ? 'insufficient' : quality.state,
    confidence_score: quality.confidence_score,
    evidence_quality: quality,
    explanation: {
      metric: 'weighted student performance score',
      formula: 'Σ(score × sourceWeight × reliability × recency) / Σ(weights)',
      weights: ASSESSMENT_SOURCE_WEIGHTS,
      missing_evidence: quality.limitations,
    },
  }
}

export function analyzeTrend(observations = [], options = {}) {
  const points = observations
    .map((point, index) => ({
      x: finiteOrNull(point.x ?? point.observed_at ?? point.evidence_at) ?? index,
      y: finiteOrNull(point.y ?? point.score_percentage ?? point.value),
      ref: point.public_ref || point.source_ref || null,
    }))
    .filter((point) => point.y !== null)
    .sort((a, b) => a.x - b.x)
  const minimum = Math.max(3, Number(options.minimumObservations || 4))
  if (points.length < minimum) return { state: 'INSUFFICIENT_HISTORY', label: 'INSUFFICIENT_HISTORY', slope: null, change: null, confidence_score: round((points.length / minimum) * 35), observations: points.length, evidence: points.map((point) => point.ref).filter(Boolean) }
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + ((point.x - xMean) ** 2), 0)
  const slope = denominator ? points.reduce((sum, point) => sum + ((point.x - xMean) * (point.y - yMean)), 0) / denominator : 0
  const first = points.slice(0, Math.ceil(points.length / 2)).map((point) => point.y)
  const last = points.slice(-Math.ceil(points.length / 2)).map((point) => point.y)
  const change = median(last) - median(first)
  const volatility = percentile(points.map((point) => point.y), 0.75) - percentile(points.map((point) => point.y), 0.25)
  const threshold = Number(options.changeThreshold ?? 5)
  const state = change >= threshold ? 'IMPROVING' : change <= -threshold ? 'DECLINING' : volatility > Number(options.volatilityThreshold ?? 20) ? 'VOLATILE' : 'STABLE'
  return { state, label: state, slope: round(slope, 4), change: round(change), volatility: round(volatility), confidence_score: round(Math.min(100, 45 + points.length * 8)), observations: points.length, evidence: points.map((point) => point.ref).filter(Boolean) }
}

export function detectAcademicAnomalies(records = [], options = {}) {
  const normalized = records.map((record) => normalizeEvidenceRecord(record, options))
  const flags = []
  for (const record of normalized) {
    if (record.value !== null && record.maximum_value !== null && (record.value < 0 || record.value > record.maximum_value)) flags.push({ type: 'impossible_mark', severity: 'high', evidence_ref: record.source_ref })
  }
  const valid = normalized.filter((record) => record.valid && record.score_percentage !== null)
  const minimum = Math.max(5, Number(options.minimumSampleSize || 10))
  if (valid.length >= minimum) {
    const scores = valid.map((record) => record.score_percentage)
    const centre = median(scores)
    const mad = median(scores.map((score) => Math.abs(score - centre))) || 0
    const threshold = Math.max(15, (mad || 1) * 3)
    valid.filter((record) => Math.abs(record.score_percentage - centre) > threshold).forEach((record) => flags.push({ type: 'outlier_score', severity: 'medium', evidence_ref: record.source_ref, score: record.score_percentage, median: round(centre) }))
    const distinct = new Set(scores.map((score) => round(score, 1)))
    if (distinct.size === 1 && valid.length >= minimum) flags.push({ type: 'identical_score_distribution', severity: 'medium', evidence_ref: null, count: valid.length })
  }
  return { flags, sample_size: valid.length, psychometric_available: valid.length >= minimum, limitations: valid.length < minimum ? [`Psychometric checks require at least ${minimum} valid observations.`] : [] }
}

export function consolidateAcademicFindings(findings = [], options = {}) {
  const groups = new Map()
  for (const finding of findings) {
    const scope = finding.scope || {}
    const key = finding.root_cause_key || finding.rule_key || [finding.category, scope.class_id || scope.class_ref || '', scope.subject_id || scope.subject_ref || '', scope.topic_id || scope.topic_ref || '', finding.recommended_action || ''].join('|')
    const current = groups.get(key) || { ...finding, finding_id: finding.finding_id || randomUUID(), affected_learners: [], evidence_ids: [], occurrences: 0 }
    current.occurrences += 1
    if (finding.affected_learner_id || finding.student_id) current.affected_learners.push(finding.affected_learner_id || finding.student_id)
    if (Array.isArray(finding.affected_learners)) current.affected_learners.push(...finding.affected_learners)
    if (finding.evidence_id || finding.public_ref) current.evidence_ids.push(finding.evidence_id || finding.public_ref)
    if (Array.isArray(finding.evidence_ids)) current.evidence_ids.push(...finding.evidence_ids)
    current.priority_score = Math.max(Number(current.priority_score || 0), Number(finding.priority_score || 0))
    groups.set(key, current)
  }
  return [...groups.values()].map((finding) => ({ ...finding, affected_learners: [...new Set(finding.affected_learners)], evidence_ids: [...new Set(finding.evidence_ids)], affected_learner_count: new Set(finding.affected_learners).size })).sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)).slice(0, Number(options.limit || 100))
}

export function analyzeCohort(records = [], options = {}) {
  const threshold = Number(options.threshold ?? 60)
  const values = records.map((record) => finiteOrNull(record.score_percentage ?? record.score ?? record.value)).filter((value) => value !== null)
  if (!values.length) return { state: 'insufficient', count: 0, average: null, median: null, variance: null, below_threshold: 0, distribution: {}, trend: 'INSUFFICIENT_HISTORY' }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const centre = median(values)
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length
  const distribution = {
    critical: values.filter((value) => value < 40).length,
    developing: values.filter((value) => value >= 40 && value < threshold).length,
    secure: values.filter((value) => value >= threshold && value < 80).length,
    advanced: values.filter((value) => value >= 80).length,
  }
  const trend = analyzeTrend(records.map((record, index) => ({ x: record.x ?? record.evidence_at ?? index, y: record.score_percentage ?? record.score ?? record.value, source_ref: record.public_ref })), options)
  return {
    state: 'sufficient',
    count: values.length,
    average: round(average),
    median: round(centre),
    variance: round(variance),
    standard_deviation: round(Math.sqrt(variance)),
    below_threshold: distribution.critical + distribution.developing,
    below_threshold_percentage: round(((distribution.critical + distribution.developing) / values.length) * 100),
    distribution,
    trend,
    confidence_score: round(Math.min(100, 35 + values.length * 3)),
  }
}

export function classifyAcademicRisk({ magnitude = 0, affectedLearners = 0, durationDays = 0, examProximityDays = null, prerequisiteImpact = 0, confidence = 0, interventionActive = false } = {}) {
  const score = (Number(magnitude) * 0.35) + (Math.min(100, Number(affectedLearners) * 5) * 0.2) + (Math.min(100, Number(durationDays) * 2) * 0.15) + (examProximityDays === null ? 0 : Math.max(0, 100 - Number(examProximityDays) * 5) * 0.1) + (Number(prerequisiteImpact) * 0.1) + (Number(confidence) * 0.1) - (interventionActive ? 8 : 0)
  const severity = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : score >= 15 ? 'low' : 'informational'
  return { score: round(Math.max(0, score)), severity, formula: '0.35 magnitude + 0.20 affected learners + 0.15 duration + 0.10 exam proximity + 0.10 prerequisite impact + 0.10 confidence − active intervention adjustment' }
}

export function buildAcademicRecommendation({ finding = '', evidence = [], scope = {}, ownerRole = 'teacher', deadlineDays = 7, action = '', successCriteria = '', reassessment = '', confidence = null } = {}) {
  return {
    problem: String(finding || 'Validated academic finding'),
    evidence: Array.isArray(evidence) ? evidence : [],
    affected_scope: scope,
    recommended_action: String(action || 'Review the linked evidence and record a teacher-owned next step.'),
    expected_outcome: String(successCriteria || 'A measurable change is recorded on comparable reassessment evidence.'),
    owner_role: ownerRole,
    suggested_deadline_days: Math.max(0, Math.min(90, Number(deadlineDays) || 0)),
    reassessment_method: String(reassessment || 'Use comparable mapped evidence.'),
    success_criteria: String(successCriteria || 'Outcome is reviewed against the baseline.'),
    confidence: finiteOrNull(confidence),
  }
}

export function evaluateInterventionEffectiveness({ baseline = [], reassessment = [], successThreshold = 60, minimumChange = 5 } = {}) {
  const before = calculatePerformanceScore(baseline)
  const after = calculatePerformanceScore(reassessment)
  if (before.score === null || after.score === null) return { outcome: 'INCONCLUSIVE', baseline_score: before.score, reassessment_score: after.score, change: null, confidence_score: Math.min(before.confidence_score, after.confidence_score), explanation: 'A comparable baseline and reassessment are required.' }
  const change = round(after.score - before.score)
  const outcome = after.score >= successThreshold && change >= minimumChange ? 'EFFECTIVE' : change >= minimumChange ? 'PARTIALLY_EFFECTIVE' : change <= -minimumChange ? 'INEFFECTIVE' : 'INCONCLUSIVE'
  return { outcome, baseline_score: before.score, reassessment_score: after.score, change, baseline_confidence: before.confidence_score, reassessment_confidence: after.confidence_score, confidence_score: Math.min(before.confidence_score, after.confidence_score), explanation: `Change is ${change >= 0 ? '+' : ''}${change} percentage points across comparable evidence.` }
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function dateMs(value) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function jsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

async function scopedIdByRef(table, schoolId, publicRef, connection = pool) {
  const allowed = new Set(["classes", "subjects", "syllabus_topics", "students"])
  if (!allowed.has(table) || !publicRef) return null
  const [[row]] = await connection.query(`SELECT id FROM ${table} WHERE school_id=? AND public_ref=? LIMIT 1`, [schoolId, String(publicRef)])
  return row?.id || null
}

function suppliedScopeId(value, label, { required = false } = {}) {
  const supplied = value !== undefined && value !== null && value !== ""
  if (!supplied) {
    if (required) throw new HttpError(400, `${label} is required.`)
    return null
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${label} is invalid.`)
  return id
}

async function firstScopeRow(db, sql, params) {
  const [rows] = await db.query(sql, params)
  return rows[0] || null
}

async function validateAcademicWriteEntityScope(db, {
  schoolId,
  subjectId,
  classId = null,
  studentId = null,
  topicId = null,
  termId = null,
  teacherId = null,
} = {}) {
  const school = suppliedScopeId(schoolId, "School", { required: true })
  const subject = suppliedScopeId(subjectId, "Subject", { required: true })
  const [subjectRow, classRow, studentRow, termRow, teacherRow] = await Promise.all([
    firstScopeRow(db, "SELECT id FROM subjects WHERE school_id=? AND id=? LIMIT 1", [school, subject]),
    classId ? firstScopeRow(db, "SELECT id,grade_level FROM classes WHERE school_id=? AND id=? LIMIT 1", [school, classId]) : null,
    studentId ? firstScopeRow(db, "SELECT id,class_id,status FROM students WHERE school_id=? AND id=? LIMIT 1", [school, studentId]) : null,
    termId ? firstScopeRow(db, "SELECT id,academic_year_id,status FROM terms WHERE school_id=? AND id=? LIMIT 1", [school, termId]) : null,
    teacherId ? firstScopeRow(db, "SELECT id,role,is_active,employment_status FROM users WHERE school_id=? AND id=? AND role='teacher' AND is_active=1 AND employment_status='active' LIMIT 1", [school, teacherId]) : null,
  ])
  if (!subjectRow) throw new HttpError(400, "The selected subject does not belong to this school.")
  if (classId && !classRow) throw new HttpError(400, "The selected class does not belong to this school.")
  if (studentId && !studentRow) throw new HttpError(400, "The selected learner does not belong to this school.")
  if (studentRow && String(studentRow.status || "").toLowerCase() !== "active") {
    throw new HttpError(400, "The selected learner is not active in this school.")
  }
  if (termId && !termRow) throw new HttpError(400, "The selected term does not belong to this school.")
  if (teacherId && !teacherRow) throw new HttpError(400, "The assigned teacher is not an active user in this school.")

  const topicScope = topicId
    ? await validateSyllabusTopicScope(db, { schoolId: school, subjectId: subject, topicId, requireTopic: true })
    : { topicId: null, topic: null }

  if (classRow && topicScope.topic?.grade_id) {
    const gradeMatch = await firstScopeRow(db, `SELECT id FROM grade_levels
      WHERE school_id=? AND id=? AND name=? LIMIT 1`,
    [school, topicScope.topic.grade_id, classRow.grade_level])
    if (!gradeMatch) throw new HttpError(400, "The selected topic does not belong to the selected class year level.")
  }

  if (studentId) {
    const enrollment = await firstScopeRow(db, `SELECT id,class_id,term_id,academic_year_id FROM student_enrollments
      WHERE school_id=? AND student_id=? AND enrollment_status='active'
        AND (? IS NULL OR class_id=?) AND (? IS NULL OR term_id=?)
        AND (? IS NULL OR academic_year_id=?)
      ORDER BY id DESC LIMIT 1`,
    [school, studentId, classId, classId, termId, termId, termRow?.academic_year_id || null, termRow?.academic_year_id || null])
    if (!enrollment) throw new HttpError(400, classId || termId
      ? "The selected learner is not actively enrolled in the selected class and term."
      : "The selected learner does not have an active enrollment.")
  }

  if (teacherId) {
    const assignment = await firstScopeRow(db, `SELECT id FROM teacher_class_subject_assignments
      WHERE school_id=? AND teacher_id=? AND subject_id=? AND role='subject_teacher' AND is_active=1
        AND (? IS NULL OR class_id=?)
        AND (? IS NULL OR academic_year_id=?)
        AND (? IS NULL OR term_id=?) LIMIT 1`,
    [school, teacherId, subject, classId, classId, termRow?.academic_year_id || null, termRow?.academic_year_id || null, termId, termId])
    if (!assignment) throw new HttpError(400, "The assigned teacher is not assigned to the selected class, subject and term.")
  }

  return {
    schoolId: school,
    subjectId: subject,
    classId,
    studentId,
    topicId: topicScope.topicId,
    termId,
    teacherId,
    subject: subjectRow,
    class: classRow,
    student: studentRow,
    topic: topicScope.topic,
    term: termRow,
    teacher: teacherRow,
  }
}

export async function assertAcademicActorWriteScope(db, schoolId, actor, scope = {}) {
  if (String(actor?.role || "").toLowerCase() !== "teacher") {
    return { assignedTeacherId: scope.teacherId || null }
  }
  const actorId = suppliedScopeId(actor?.id, "Teacher", { required: true })
  if (!scope.classId || !scope.subjectId) {
    throw new HttpError(403, "Teachers must select one of their assigned classes and subjects.")
  }
  if (scope.teacherId && Number(scope.teacherId) !== actorId) {
    throw new HttpError(403, "Teachers cannot assign an academic intervention to another teacher.")
  }
  const activeSession = await firstScopeRow(db, `SELECT academic_year.id academic_year_id,term.id term_id
    FROM academic_years academic_year
    JOIN terms term ON term.school_id=academic_year.school_id AND term.academic_year_id=academic_year.id
      AND term.status IN ('open','marking')
    WHERE academic_year.school_id=? AND academic_year.is_active=1 AND academic_year.status<>'archived'
    ORDER BY academic_year.status='active' DESC,term.start_date DESC LIMIT 1`, [schoolId])
  let academicYearId = scope.term?.academic_year_id || scope.academicYearId || activeSession?.academic_year_id || null
  let termId = scope.termId || activeSession?.term_id || null
  if (!academicYearId || !termId) throw new HttpError(409, "Open an academic term before managing academic support.")
  if (Number(academicYearId) !== Number(activeSession?.academic_year_id)
    || Number(termId) !== Number(activeSession?.term_id)) {
    throw new HttpError(403, "Teachers can only manage academic support in the current open academic session.")
  }
  const assignment = await firstScopeRow(db, `SELECT id FROM teacher_class_subject_assignments
    WHERE school_id=? AND teacher_id=? AND class_id=? AND subject_id=?
      AND role='subject_teacher' AND is_active=1
      AND academic_year_id=? AND term_id=?
    LIMIT 1`,
  [schoolId, actorId, scope.classId, scope.subjectId, academicYearId, termId])
  if (!assignment) throw new HttpError(403, "Teachers can only manage academic support for their assigned class and subject.")
  return { assignedTeacherId: actorId, academicYearId: Number(academicYearId), termId: Number(termId) }
}

export async function validateAcademicInterventionScope(db, schoolId, body = {}) {
  return validateAcademicWriteEntityScope(db, {
    schoolId,
    subjectId: suppliedScopeId(body.subject_id, "Subject", { required: true }),
    classId: suppliedScopeId(body.class_id, "Class"),
    studentId: suppliedScopeId(body.student_id, "Learner"),
    topicId: suppliedScopeId(body.topic_id, "Topic"),
    termId: suppliedScopeId(body.term_id, "Term"),
    teacherId: suppliedScopeId(body.assigned_teacher_id, "Assigned teacher"),
  })
}

function relatedScopeId(field, label, explicitId, sources) {
  const linked = [...new Set(sources.map((source) => Number(source?.[field] || 0)).filter(Boolean))]
  if (linked.length > 1) throw new HttpError(400, `The selected recommendation and intervention do not share the same ${label}.`)
  if (explicitId && linked.length && Number(explicitId) !== linked[0]) {
    throw new HttpError(400, `The selected ${label} does not match the linked recommendation or intervention.`)
  }
  return explicitId || linked[0] || null
}

export async function validateRemediationPackScope(db, schoolId, body = {}) {
  const recommendationId = suppliedScopeId(body.recommendation_id, "Recommendation")
  const interventionId = suppliedScopeId(body.intervention_id, "Intervention")
  const [recommendation, intervention] = await Promise.all([
    recommendationId ? firstScopeRow(db, `SELECT id,student_id,class_id,subject_id,topic_id,term_id
      FROM academic_recommendations WHERE school_id=? AND id=? LIMIT 1`, [schoolId, recommendationId]) : null,
    interventionId ? firstScopeRow(db, `SELECT id,student_id,class_id,subject_id,topic_id,term_id,assigned_teacher_id
      FROM academic_interventions WHERE school_id=? AND id=? LIMIT 1`, [schoolId, interventionId]) : null,
  ])
  if (recommendationId && !recommendation) throw new HttpError(400, "The selected recommendation does not belong to this school.")
  if (interventionId && !intervention) throw new HttpError(400, "The selected intervention does not belong to this school.")

  const sources = [recommendation, intervention].filter(Boolean)
  const subjectId = relatedScopeId("subject_id", "subject", suppliedScopeId(body.subject_id, "Subject"), sources)
  const classId = relatedScopeId("class_id", "class", suppliedScopeId(body.class_id, "Class"), sources)
  const studentId = relatedScopeId("student_id", "learner", suppliedScopeId(body.student_id, "Learner"), sources)
  const topicId = relatedScopeId("topic_id", "topic", suppliedScopeId(body.topic_id, "Topic"), sources)
  const termId = relatedScopeId("term_id", "term", suppliedScopeId(body.term_id, "Term"), sources)
  const teacherId = relatedScopeId("assigned_teacher_id", "assigned teacher", suppliedScopeId(body.assigned_teacher_id, "Assigned teacher"), [intervention].filter(Boolean))
  const scope = await validateAcademicWriteEntityScope(db, { schoolId, subjectId, classId, studentId, topicId, termId, teacherId })
  return { ...scope, recommendationId, interventionId, recommendation, intervention }
}

function masteryStatus(score, confidence, evidenceCount, config = {}) {
  const minimumEvidence = Number(config.minimum_evidence_count || 3)
  const interventionThreshold = Number(config.intervention_threshold || 45)
  const masteryThreshold = Number(config.mastery_threshold || 70)
  if (!evidenceCount) return "NOT_ASSESSED"
  if (evidenceCount < minimumEvidence || confidence < 35) return "INSUFFICIENT_EVIDENCE"
  if (score < interventionThreshold) return "REQUIRES_INTERVENTION"
  if (score < 50) return "EMERGING"
  if (score < 60) return "DEVELOPING"
  if (score < masteryThreshold) return "PARTIALLY_MASTERED"
  if (score < 85) return "MASTERED"
  return "ADVANCED"
}

function trendFromEvidence(evidence = []) {
  const ordered = [...evidence]
    .filter((item) => Number.isFinite(Number(item.score_percentage)))
    .sort((a, b) => (dateMs(a.evidence_at) || 0) - (dateMs(b.evidence_at) || 0))
  if (ordered.length < 4) return "UNKNOWN"
  const split = Math.max(2, Math.floor(ordered.length / 2))
  const average = (rows) => rows.reduce((sum, item) => sum + Number(item.score_percentage), 0) / rows.length
  const previous = average(ordered.slice(0, split))
  const recent = average(ordered.slice(-split))
  const change = recent - previous
  if (change >= 5) return "IMPROVING"
  if (change <= -5) return "DECLINING"
  return "STEADY"
}

export function calculateMastery(evidence = [], config = {}, now = new Date()) {
  // Keep the source fields needed for the mastery weighting formula, but use
  // the canonical adapter to exclude absent, invalidated, draft and
  // incomplete observations. Draft rows remain visible in evidence quality,
  // never in an official mastery total.
  const normalized = evidence.map((item) => normalizeEvidenceRecord(item, { ...config, now }))
  const valid = evidence
    .map((item, index) => ({ source: item, canonical: normalized[index] }))
    .filter(({ canonical }) => canonical.valid)
    .map(({ source, canonical }) => ({
      ...source,
      ...canonical,
      public_ref: source.public_ref || canonical.source_ref,
      evidence_type: source.evidence_type || canonical.source_type,
      score_percentage: canonical.score_percentage,
      marks_available: source.marks_available ?? canonical.maximum_value,
    }))
  if (!valid.length) {
    return {
      mastery_score: null,
      confidence_score: 0,
      mastery_status: "NOT_ASSESSED",
      trend: "UNKNOWN",
      evidence_count: 0,
      evidence_state: "insufficient",
      evidence_quality: assessEvidenceQuality(evidence, { ...config, now }),
      explanation: { message: "No assessment evidence is available.", evidence: [] },
    }
  }

  const halfLife = Math.max(1, Number(config.recency_half_life_days || 60))
  const nowValue = dateMs(now) || Date.now()
  let weightedScore = 0
  let totalWeight = 0
  const components = []
  for (const item of valid) {
    const ageDays = Math.max(0, (nowValue - (dateMs(item.evidence_at) || nowValue)) / DAY_MS)
    const recencyWeight = Math.pow(0.5, ageDays / halfLife)
    const marksWeight = Math.max(0.25, Math.sqrt(Math.max(1, Number(item.marks_available || 1))))
    const difficultyWeight = Math.max(0.25, Number(item.difficulty_weight || 1))
    const assessmentWeight = Math.max(0.1, Number(item.assessment_weight || 1))
    const independenceWeight = Math.max(0.1, Number(item.independence_weight || 1))
    const weight = recencyWeight * marksWeight * difficultyWeight * assessmentWeight * independenceWeight
    weightedScore += clamp(item.score_percentage) * weight
    totalWeight += weight
    components.push({
      evidence_ref: item.public_ref || null,
      type: item.evidence_type,
      score: clamp(item.score_percentage),
      age_days: Number(ageDays.toFixed(1)),
      weight: Number(weight.toFixed(4)),
      granularity: item.evidence_granularity || "limited",
    })
  }

  const score = totalWeight ? clamp(weightedScore / totalWeight) : 0
  const evidenceBreadth = clamp((valid.length / Math.max(1, Number(config.minimum_evidence_count || 3))) * 55)
  const recencyConfidence = clamp(
    valid.reduce((sum, item) => {
      const ageDays = Math.max(0, (nowValue - (dateMs(item.evidence_at) || nowValue)) / DAY_MS)
      return sum + Math.pow(0.5, ageDays / halfLife)
    }, 0) / valid.length * 30,
  )
  const objectiveEvidence = valid.filter((item) => item.evidence_granularity === "objective").length
  const granularityConfidence = clamp((objectiveEvidence / valid.length) * 15)
  const confidence = clamp(evidenceBreadth + recencyConfidence + granularityConfidence)
  const trend = trendFromEvidence(valid)
  let status = masteryStatus(score, confidence, valid.length, config)
  if (trend === "DECLINING" && status === "MASTERED") status = "DECLINING"

  return {
    mastery_score: Number(score.toFixed(2)),
    confidence_score: Number(confidence.toFixed(2)),
    mastery_status: status,
    trend,
    evidence_count: valid.length,
    evidence_state: valid.length < Number(config.minimum_evidence_count || 3) ? "limited" : "sufficient",
    evidence_quality: assessEvidenceQuality(evidence, { ...config, now }),
    last_evidence_at: valid.reduce((latest, item) => {
      const timestamp = dateMs(item.evidence_at) || 0
      return timestamp > (dateMs(latest) || 0) ? item.evidence_at : latest
    }, null),
    explanation: {
      formula: "recency × marks × difficulty × assessment type × independence",
      thresholds: {
        minimum_evidence: Number(config.minimum_evidence_count || 3),
        intervention: Number(config.intervention_threshold || 45),
        mastery: Number(config.mastery_threshold || 70),
      },
      missing_evidence: objectiveEvidence ? [] : ["No objective-level evidence is available; confidence is reduced."],
      evidence: components,
    },
  }
}

export function calculatePacing({ totalTopics = 0, planned = 0, taught = 0, assessed = 0, mastered = 0, elapsedTeachingDays = 0, totalTeachingDays = 0, remainingTeachingDays = 0 } = {}) {
  const total = Math.max(0, Number(totalTopics || 0))
  const percentage = (value) => total ? Number(clamp((Number(value || 0) / total) * 100).toFixed(2)) : 0
  const plannedPercentage = percentage(planned)
  const taughtPercentage = percentage(taught)
  const assessedPercentage = percentage(assessed)
  const masteredPercentage = percentage(mastered)
  const expectedTaught = totalTeachingDays > 0 ? clamp((elapsedTeachingDays / totalTeachingDays) * 100) : plannedPercentage
  const teachingDaysVariance = totalTeachingDays > 0
    ? Math.round(((taughtPercentage - expectedTaught) / 100) * totalTeachingDays)
    : 0
  const remainingTopics = Math.max(0, total - Number(taught || 0))
  const weeksRemaining = Math.max(remainingTeachingDays / 5, 0.2)
  return {
    planned_percentage: plannedPercentage,
    taught_percentage: taughtPercentage,
    assessed_percentage: assessedPercentage,
    mastered_percentage: masteredPercentage,
    teaching_days_variance: teachingDaysVariance,
    required_topics_per_week: Number((remainingTopics / weeksRemaining).toFixed(2)),
    risk: remainingTopics > 0 && remainingTeachingDays <= 0
      ? "critical"
      : teachingDaysVariance < -5
        ? "high"
        : taughtPercentage > masteredPercentage + 25
          ? "consolidation"
          : "on_track",
  }
}

export function calculateExamReadiness(factors = {}) {
  const weights = factors.weights || {
    syllabus_completion: 0.2,
    assessed_coverage: 0.15,
    topic_mastery: 0.25,
    recent_performance: 0.2,
    prerequisite_security: 0.1,
    attendance: 0.05,
    intervention_resolution: 0.05,
    // Kept as an explicit legacy input so older snapshots remain explainable.
    consistency: 0,
    difficulty_coverage: 0,
  }
  const aliases = {
    syllabus_completion: ['syllabus_completion', 'delivery_progress'],
    assessed_coverage: ['assessed_coverage', 'assessed_curriculum_coverage'],
    topic_mastery: ['topic_mastery', 'mastery_coverage'],
    recent_performance: ['recent_performance', 'performance'],
    prerequisite_security: ['prerequisite_security'],
    attendance: ['attendance', 'attendance_stability'],
    intervention_resolution: ['intervention_resolution', 'intervention_effectiveness'],
    consistency: ['consistency'],
    difficulty_coverage: ['difficulty_coverage'],
  }
  let score = 0
  let availableWeight = 0
  const contributing = {}
  const missing = []
  const contributions = {}
  for (const [key, weightValue] of Object.entries(weights)) {
    const weight = Number(weightValue)
    if (!Number.isFinite(weight) || weight <= 0) continue
    const sourceKey = aliases[key]?.find((candidate) => Number.isFinite(Number(factors[candidate]))) || key
    const value = Number(factors[sourceKey])
    if (!Number.isFinite(value)) {
      missing.push(key)
      continue
    }
    contributing[key] = clamp(value)
    score += clamp(value) * weight
    availableWeight += weight
    contributions[key] = {
      input: clamp(value),
      weight,
      contribution: round(clamp(value) * weight),
      source: sourceKey,
      evidence_state: factors[`${sourceKey}_evidence_state`] || factors.evidence_state || 'available',
    }
  }
  // Keep the legacy explanation honest for callers that still expect the
  // consistency input to be reported even when its configured weight is zero.
  if (!Number.isFinite(Number(factors.consistency)) && !missing.includes('consistency')) missing.push('consistency')
  const prerequisitePenalty = clamp(Number(factors.weak_prerequisite_count || 0) * 2, 0, 15)
  const untaughtPenalty = clamp(Number(factors.untaught_mandatory_topics || 0) * 3, 0, 20)
  const normalized = availableWeight ? score / availableWeight : null
  const readiness = normalized === null ? null : clamp(normalized - prerequisitePenalty - untaughtPenalty)
  const confidence = clamp((availableWeight / Math.max(0.01, Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)) * 100) - missing.length * 3 - Number(factors.confidence_penalty || 0))
  const range = readiness === null ? null : {
    lower: round(clamp(readiness - ((100 - confidence) * 0.15))),
    upper: round(clamp(readiness + ((100 - confidence) * 0.15))),
  }
  return {
    readiness_score: readiness === null ? null : Number(readiness.toFixed(2)),
    readiness_range: range,
    confidence_score: Number(confidence.toFixed(2)),
    contributing_factors: contributing,
    contributions,
    penalties: { prerequisite_gap: prerequisitePenalty, untaught_topics: untaughtPenalty },
    missing_data: missing,
    evidence_state: readiness === null ? 'insufficient' : missing.length ? 'limited' : 'sufficient',
    formula_version: 'readiness-v2',
    label: readiness === null ? "insufficient_evidence" : readiness >= 80 ? "strong" : readiness >= 65 ? "developing" : readiness >= 45 ? "at_risk" : "high_risk",
  }
}

// Public names used by the API documentation. Keep the legacy function name
// above for existing callers and snapshots.
export const calculateReadiness = calculateExamReadiness

export function calculateEvidenceConfidence(records = [], options = {}) {
  const quality = assessEvidenceQuality(records, options)
  return {
    score: quality.confidence_score,
    state: quality.state,
    components: quality.components,
    limitations: quality.limitations,
    evidence_count: quality.valid_count,
  }
}

export function validateDependencyGraph(edges = []) {
  const graph = new Map()
  edges.forEach((edge) => {
    const source = String(edge.from ?? edge.learning_objective_id ?? edge.topic_id)
    const target = String(edge.to ?? edge.prerequisite_objective_id ?? edge.prerequisite_topic_id)
    if (!graph.has(source)) graph.set(source, [])
    graph.get(source).push(target)
    if (!graph.has(target)) graph.set(target, [])
  })
  const visiting = new Set()
  const visited = new Set()
  const cycles = []
  function walk(node, path) {
    if (visiting.has(node)) {
      const index = path.indexOf(node)
      cycles.push([...path.slice(index), node])
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    for (const next of graph.get(node) || []) walk(next, [...path, node])
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of graph.keys()) walk(node, [])
  return { valid: cycles.length === 0, cycles }
}

export function validateAssessmentBlueprintInput(input = {}) {
  const totalMarks=Number(input.total_marks||0)
  const duration=Number(input.duration_minutes||0)
  const topics=Array.isArray(input.topics)?input.topics:[]
  const difficulty=input.difficulty_distribution||{}
  const cognitive=input.cognitive_distribution||{}
  const warnings=[]
  const errors=[]
  const topicMarks=topics.reduce((sum,item)=>sum+Number(item.marks||0),0)
  const distributionTotal=(distribution)=>Object.values(distribution||{}).reduce((sum,value)=>sum+Number(value||0),0)
  if(!(totalMarks>0))errors.push('Total marks must be greater than zero.')
  if(!(duration>0))errors.push('Duration must be greater than zero.')
  if(!topics.length)errors.push('Add at least one topic or learning objective.')
  if(Math.abs(topicMarks-totalMarks)>.01)errors.push(`Topic allocation is ${topicMarks} marks but the assessment total is ${totalMarks}.`)
  if(Math.abs(distributionTotal(difficulty)-100)>.01)errors.push('Difficulty distribution must total 100%.')
  if(Math.abs(distributionTotal(cognitive)-100)>.01)errors.push('Cognitive-level distribution must total 100%.')
  if(totalMarks/duration>2)warnings.push('More than two marks per minute may be difficult to complete.')
  const topicIds=topics.map((item)=>Number(item.topic_id||0)).filter(Boolean)
  if(new Set(topicIds).size!==topicIds.length)warnings.push('A topic appears more than once in the blueprint.')
  if(Number(difficulty.hard||0)>40)warnings.push('Hard questions exceed 40% of the assessment.')
  return {valid:errors.length===0,errors,warnings,summary:{total_marks:totalMarks,duration_minutes:duration,topic_marks:topicMarks,difficulty_total:distributionTotal(difficulty),cognitive_total:distributionTotal(cognitive)}}
}

export function summarizeQuestionAnalytics(stats = {}, minimumAttempts = 10) {
  const attempts = Number(stats.total_attempts || 0)
  const successRate = stats.success_rate === null || stats.success_rate === undefined ? null : clamp(Number(stats.success_rate))
  const flags = []
  if (attempts < minimumAttempts) flags.push("insufficient_attempts")
  if (attempts >= minimumAttempts && successRate !== null) {
    if (successRate >= 95) flags.push("nearly_everyone_correct")
    if (successRate <= 15) flags.push("nearly_everyone_incorrect")
  }
  return {
    attempts,
    success_rate: successRate,
    measured_difficulty: successRate === null ? null : Number((100 - successRate).toFixed(2)),
    confidence_score: clamp((attempts / Math.max(1, minimumAttempts * 2)) * 100),
    flags,
  }
}

export function calculateQuestionAnalytics(stats = {}, options = {}) {
  const minimumAttempts = Math.max(5, Number(options.minimumAttempts || 10))
  const summary = summarizeQuestionAnalytics(stats, minimumAttempts)
  return {
    ...summary,
    median_score: finiteOrNull(stats.median_score),
    zero_mark_rate: finiteOrNull(stats.zero_mark_rate),
    full_mark_rate: finiteOrNull(stats.full_mark_rate),
    omission_rate: finiteOrNull(stats.omission_rate),
    discrimination_index: summary.attempts >= minimumAttempts ? finiteOrNull(stats.discrimination_index) : null,
    psychometric_state: summary.attempts >= minimumAttempts ? 'available' : 'insufficient_sample',
    limitations: summary.attempts < minimumAttempts ? [`Psychometric indicators require at least ${minimumAttempts} valid attempts.`] : [],
  }
}

export function validateParentInsightTransition(previousStatus, nextStatus) {
  const allowed = {
    draft: new Set(["draft", "approved", "withdrawn"]),
    approved: new Set(["approved", "published", "withdrawn"]),
    published: new Set(["published", "withdrawn"]),
    withdrawn: new Set(["withdrawn"]),
  }
  return Boolean(allowed[String(previousStatus || "")]?.has(String(nextStatus || "")))
}

export async function getAcademicEngineConfig(schoolId, connection = pool) {
  await connection.query("INSERT IGNORE INTO academic_engine_config (school_id) VALUES (?)", [schoolId])
  const [[row]] = await connection.query("SELECT * FROM academic_engine_config WHERE school_id=? LIMIT 1", [schoolId])
  return row
}

/**
 * Read the canonical evidence adapter. Source records stay in their original
 * tables; this endpoint gives the analytical layer one tenant-scoped shape
 * and never returns internal database identifiers to callers.
 */
export async function getCanonicalAcademicEvidence(schoolId, filters = {}, actor = null) {
  const params = [schoolId]
  const clauses = []
  const teacherId = String(actor?.role || '').toLowerCase() === 'teacher' ? Number(actor.id) : null
  if (teacherId) {
    const activeSession = await requireActiveAcademicSession(schoolId, pool)
    clauses.push(`me.academic_year_id=? AND me.term_id=? AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=me.school_id AND tcsa.teacher_id=? AND tcsa.class_id=me.class_id AND tcsa.subject_id=me.subject_id AND tcsa.academic_year_id=me.academic_year_id AND tcsa.term_id=me.term_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)`)
    params.push(activeSession.academicYearId, activeSession.termId, teacherId)
  }
  const addRefFilter = async (table, column, queryKey) => {
    if (!filters[queryKey]) return
    const id = await scopedIdByRef(table, schoolId, filters[queryKey])
    if (!id) throw new HttpError(404, `Academic ${queryKey.replace('_ref', '')} was not found.`)
    clauses.push(`me.${column}=?`)
    params.push(id)
  }
  await addRefFilter('students', 'student_id', 'student_ref')
  await addRefFilter('classes', 'class_id', 'class_ref')
  await addRefFilter('subjects', 'subject_id', 'subject_ref')
  await addRefFilter('syllabus_topics', 'topic_id', 'topic_ref')
  if (filters.academic_year_ref) {
    const [[year]] = await pool.query("SELECT id FROM academic_years WHERE school_id=? AND SHA2(CONCAT('academic-year:',school_id,':',id),256)=? LIMIT 1", [schoolId, String(filters.academic_year_ref)])
    if (!year) throw new HttpError(404, 'Academic year was not found.')
    clauses.push('me.academic_year_id=?'); params.push(year.id)
  }
  if (filters.term_ref) {
    const [[term]] = await pool.query("SELECT id FROM terms WHERE school_id=? AND SHA2(CONCAT('term:',school_id,':',id),256)=? LIMIT 1", [schoolId, String(filters.term_ref)])
    if (!term) throw new HttpError(404, 'Academic term was not found.')
    clauses.push('me.term_id=?'); params.push(term.id)
  }
  if (filters.academic_year_id) { clauses.push('me.academic_year_id=?'); params.push(Number(filters.academic_year_id)) }
  if (filters.term_id) { clauses.push('me.term_id=?'); params.push(Number(filters.term_id)) }
  const limit = Math.min(500, Math.max(1, Number(filters.limit || 100)))
  const [rows] = await pool.query(`
    SELECT me.public_ref,me.evidence_type,me.source_entity_type,me.score_percentage,
      me.marks_awarded,me.marks_available,me.evidence_granularity,me.evidence_at,
      me.metadata_json,st.public_ref student_ref,c.public_ref class_ref,
      subj.public_ref subject_ref,t.public_ref topic_ref,t.topic_name,
      CASE WHEN me.academic_year_id IS NULL THEN NULL ELSE SHA2(CONCAT('academic-year:',me.school_id,':',me.academic_year_id),256) END academic_year_ref,
      CASE WHEN me.term_id IS NULL THEN NULL ELSE SHA2(CONCAT('term:',me.school_id,':',me.term_id),256) END term_ref,
      lo.public_ref objective_ref,lo.objective_text
    FROM mastery_evidence me
    LEFT JOIN students st ON st.id=me.student_id AND st.school_id=me.school_id
    LEFT JOIN classes c ON c.id=me.class_id AND c.school_id=me.school_id
    LEFT JOIN subjects subj ON subj.id=me.subject_id AND subj.school_id=me.school_id
    LEFT JOIN syllabus_topics t ON t.id=me.topic_id AND t.school_id=me.school_id
    LEFT JOIN learning_objectives lo ON lo.id=me.learning_objective_id AND lo.school_id=me.school_id
    WHERE me.school_id=?${clauses.length ? ` AND ${clauses.join(' AND ')}` : ''}
    ORDER BY me.evidence_at DESC LIMIT ${limit}`,
  params)
  const evidence = rows.map((row) => {
    const canonical = normalizeEvidenceRecord({
      ...row,
      school_id: schoolId,
      source_id: row.public_ref,
      verification_status: 'published',
      metadata: jsonValue(row.metadata_json, {}),
    })
    return {
      public_ref: row.public_ref,
      student_ref: row.student_ref,
      class_ref: row.class_ref,
      subject_ref: row.subject_ref,
      academic_year_ref: row.academic_year_ref,
      term_ref: row.term_ref,
      topic_ref: row.topic_ref,
      topic_name: row.topic_name,
      objective_ref: row.objective_ref,
      objective_text: row.objective_text,
      source_type: canonical.source_type,
      source_entity_type: row.source_entity_type,
      evidence_at: row.evidence_at,
      score_percentage: canonical.score_percentage,
      marks_awarded: canonical.value,
      marks_available: canonical.maximum_value,
      mapping_quality: canonical.mapping_quality,
      evidence_quality: canonical.evidence_quality,
      valid: canonical.valid,
    }
  })
  const quality = assessEvidenceQuality(rows.map((row) => ({
    ...row,
    school_id: schoolId,
    source_id: row.public_ref,
    verification_status: 'published',
    metadata: jsonValue(row.metadata_json, {}),
  })), filters)
  return { evidence, evidence_quality: { state: quality.state, confidence_score: quality.confidence_score, components: quality.components, limitations: quality.limitations } }
}

async function audit(connection, schoolId, actor, action, entityType, entityId, beforeValue, afterValue) {
  await connection.query(
    `INSERT INTO audit_logs (school_id,actor_user_id,actor_role,action,entity_type,entity_id,before_value,after_value)
     VALUES (?,?,?,?,?,?,?,?)`,
    [schoolId, actor?.id || null, actor?.role || null, action, entityType, entityId || null, beforeValue ? JSON.stringify(beforeValue) : null, afterValue ? JSON.stringify(afterValue) : null],
  ).catch((error) => { if (!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code)) throw error })
}

function masteryScopeWhere(scope) {
  if (scope.learning_objective_id) return { level: "objective", clause: "learning_objective_id=?", params: [scope.learning_objective_id] }
  if (scope.subtopic_id) return { level: "subtopic", clause: "subtopic_id=? AND learning_objective_id IS NULL", params: [scope.subtopic_id] }
  if (scope.topic_id) return { level: "topic", clause: "topic_id=? AND subtopic_id IS NULL AND learning_objective_id IS NULL", params: [scope.topic_id] }
  return { level: "subject", clause: "topic_id IS NULL AND subtopic_id IS NULL AND learning_objective_id IS NULL", params: [] }
}

export async function recalculateStudentMastery(schoolId, studentId, subjectId, scope = {}, connection = pool) {
  const config = await getAcademicEngineConfig(schoolId, connection)
  const selected = masteryScopeWhere(scope)
  let academicYearId = scope.academic_year_id === undefined ? null : scope.academic_year_id
  let termId = scope.term_id === undefined ? null : scope.term_id
  if (scope.academic_year_id === undefined || scope.term_id === undefined) {
    const [[latestScope]] = await connection.query(
      `SELECT academic_year_id,term_id FROM mastery_evidence
       WHERE school_id=? AND student_id=? AND subject_id=? AND ${selected.clause}
       ORDER BY evidence_at DESC,id DESC LIMIT 1`,
      [schoolId, studentId, subjectId, ...selected.params],
    )
    if (scope.academic_year_id === undefined) academicYearId = latestScope?.academic_year_id ?? null
    if (scope.term_id === undefined) termId = latestScope?.term_id ?? null
  }
  const [evidence] = await connection.query(
    `SELECT * FROM mastery_evidence
     WHERE school_id=? AND student_id=? AND subject_id=? AND ${selected.clause}
       AND academic_year_id <=> ? AND term_id <=> ?
       AND publication_state IN ('published','locked') AND evidence_status='valid'
     ORDER BY evidence_at`,
    [schoolId, studentId, subjectId, ...selected.params, academicYearId, termId],
  )
  const calculated = calculateMastery(evidence, config)
  const ref = randomUUID()
  const scopeKey = `${selected.level}:${scope.topic_id||0}:${scope.subtopic_id||0}:${scope.learning_objective_id||0}`
  const sessionScopeKey = `${academicYearId||0}:${termId||0}:${scopeKey}`
  await connection.query(
    `INSERT INTO academic_mastery_records (
      public_ref,school_id,academic_year_id,term_id,student_id,subject_id,topic_id,subtopic_id,learning_objective_id,mastery_level,scope_key,session_scope_key,
      mastery_score,confidence_score,mastery_status,trend,evidence_count,calculation_explanation_json,last_evidence_at,last_recalculated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE mastery_score=VALUES(mastery_score),confidence_score=VALUES(confidence_score),
      mastery_status=IF(manually_overridden=1,mastery_status,VALUES(mastery_status)),trend=VALUES(trend),
      evidence_count=VALUES(evidence_count),calculation_explanation_json=VALUES(calculation_explanation_json),
      last_evidence_at=VALUES(last_evidence_at),last_recalculated_at=CURRENT_TIMESTAMP`,
    [ref, schoolId, academicYearId, termId, studentId, subjectId, scope.topic_id || null, scope.subtopic_id || null, scope.learning_objective_id || null,
      selected.level, scopeKey, sessionScopeKey, calculated.mastery_score, calculated.confidence_score, calculated.mastery_status, calculated.trend,
      calculated.evidence_count, JSON.stringify(calculated.explanation), calculated.last_evidence_at],
  )
  return { ...calculated, academic_year_id: academicYearId, term_id: termId }
}

export async function recalculateQuestionAnalytics(schoolId,questionId,connection=pool){
  const [[stats]]=await connection.query(`SELECT COUNT(*) total_attempts,SUM(response_status='correct') correct_attempts,SUM(response_status='partially_correct') partially_correct_attempts,SUM(response_status='incorrect') incorrect_attempts,SUM(response_status='omitted') omitted_attempts,ROUND(AVG(CASE WHEN marks_available>0 THEN marks_awarded/marks_available*100 END),2) success_rate,ROUND(AVG(marks_awarded),2) average_marks,ROUND(AVG(completion_seconds),2) average_completion_seconds FROM question_attempts WHERE school_id=? AND question_id=? AND response_status<>'unmarked'`,[schoolId,questionId])
  const summary=summarizeQuestionAnalytics(stats,10)
  const attempts=summary.attempts,success=summary.success_rate,flags=summary.flags,confidence=summary.confidence_score
  await connection.query(`INSERT INTO question_attempt_analytics (public_ref,school_id,question_id,total_attempts,correct_attempts,partially_correct_attempts,incorrect_attempts,omitted_attempts,success_rate,average_marks,average_completion_seconds,confidence_score,flags_json,last_calculated_at) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE total_attempts=VALUES(total_attempts),correct_attempts=VALUES(correct_attempts),partially_correct_attempts=VALUES(partially_correct_attempts),incorrect_attempts=VALUES(incorrect_attempts),omitted_attempts=VALUES(omitted_attempts),success_rate=VALUES(success_rate),average_marks=VALUES(average_marks),average_completion_seconds=VALUES(average_completion_seconds),confidence_score=VALUES(confidence_score),flags_json=VALUES(flags_json),last_calculated_at=CURRENT_TIMESTAMP`,[schoolId,questionId,attempts,Number(stats?.correct_attempts||0),Number(stats?.partially_correct_attempts||0),Number(stats?.incorrect_attempts||0),Number(stats?.omitted_attempts||0),success,stats?.average_marks,stats?.average_completion_seconds,confidence,JSON.stringify(flags)])
  await connection.query("UPDATE question_bank SET measured_difficulty=?,times_attempted=?,percent_correct=? WHERE school_id=? AND id=?",[summary.measured_difficulty,attempts,success,schoolId,questionId])
  return {attempts,success_rate:success,confidence_score:confidence,flags}
}

export async function recalculateClassMastery(schoolId,{classId,subjectId,academicYearId=null,termId=null},connection=pool){
  const config=await getAcademicEngineConfig(schoolId,connection)
  const params=[schoolId,classId,subjectId]
  let enrollmentClause=''
  if(academicYearId){enrollmentClause+=' AND se.academic_year_id=?';params.push(academicYearId)}
  if(termId){enrollmentClause+=' AND se.term_id=?';params.push(termId)}
  const [rows]=await connection.query(`SELECT amr.mastery_score,amr.confidence_score,amr.mastery_status FROM student_enrollments se JOIN academic_mastery_records amr ON amr.school_id=se.school_id AND amr.student_id=se.student_id AND amr.subject_id=? AND amr.mastery_level='subject' AND amr.scope_key='subject:0:0:0' AND amr.academic_year_id <=> ? AND amr.term_id <=> ? WHERE se.school_id=? AND se.class_id=? AND se.enrollment_status='active'${enrollmentClause}`,[subjectId,academicYearId,termId,schoolId,classId,...params.slice(3)])
  const scores=rows.map((row)=>Number(row.mastery_score)).filter(Number.isFinite).sort((a,b)=>a-b)
  const average=scores.length?scores.reduce((sum,value)=>sum+value,0)/scores.length:null
  const median=scores.length?(scores.length%2?scores[(scores.length-1)/2]:(scores[scores.length/2-1]+scores[scores.length/2])/2):null
  const below=rows.filter((row)=>Number(row.mastery_score)<Number(config.mastery_threshold||70)&&Number(row.confidence_score)>=35).length
  const insufficient=rows.filter((row)=>['NOT_ASSESSED','INSUFFICIENT_EVIDENCE'].includes(row.mastery_status)).length
  const distribution={emerging:rows.filter((row)=>['EMERGING','REQUIRES_INTERVENTION'].includes(row.mastery_status)).length,developing:rows.filter((row)=>['DEVELOPING','PARTIALLY_MASTERED'].includes(row.mastery_status)).length,mastered:rows.filter((row)=>['MASTERED','ADVANCED'].includes(row.mastery_status)).length,insufficient}
  await connection.query(`INSERT INTO class_mastery_snapshots (public_ref,school_id,academic_year_id,term_id,class_id,subject_id,average_mastery,median_mastery,confidence_score,students_assessed,students_below_threshold,students_with_insufficient_evidence,distribution_json,trend) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,'UNKNOWN')`,[schoolId,academicYearId,termId,classId,subjectId,average===null?null:Number(average.toFixed(2)),median===null?null:Number(median.toFixed(2)),rows.length?Number((rows.reduce((sum,row)=>sum+Number(row.confidence_score||0),0)/rows.length).toFixed(2)):0,scores.length,below,insufficient,JSON.stringify(distribution)])
  return {average_mastery:average===null?null:Number(average.toFixed(2)),median_mastery:median===null?null:Number(median.toFixed(2)),students_assessed:scores.length,students_below_threshold:below,students_with_insufficient_evidence:insufficient,distribution}
}

export async function ingestApprovedResultBatch(schoolId, batchId, actor = null) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[batch]] = await connection.query(
      `SELECT rb.*,a.total_marks,a.assessment_type,a.name assessment_name
       FROM result_batches rb JOIN assessments a ON a.id=rb.assessment_id AND a.school_id=rb.school_id
       WHERE rb.school_id=? AND rb.id=? LIMIT 1`,
      [schoolId, batchId],
    )
    if (!batch) throw new HttpError(404, "Result batch was not found")
    if (!['approved','locked'].includes(String(batch.status || ''))) {
      throw new HttpError(409, "Only approved or locked result batches can create official academic evidence")
    }
    const [entries] = await connection.query(
      `SELECT re.student_id,re.score,re.status FROM result_entries re
       WHERE re.school_id=? AND re.result_batch_id=? AND re.status IN ('approved','locked') AND re.score IS NOT NULL`,
      [schoolId, batchId],
    )
    const assessmentWeight = /exam|final|end_of_term/i.test(String(batch.assessment_type || "")) ? 1.2 : 0.8
    for (const entry of entries) {
      const percentage = clamp((Number(entry.score) / Math.max(1, Number(batch.total_marks))) * 100)
      // The legacy unique key contains nullable topic/objective columns, so a
      // normal ON DUPLICATE KEY clause does not de-duplicate subject-level
      // result evidence (NULL values compare as distinct in MySQL/MariaDB).
      // Resolve the source row explicitly to keep repeated approvals idempotent.
      const [[existingEvidence]] = await connection.query(
        `SELECT id FROM mastery_evidence
         WHERE school_id=? AND student_id=? AND source_entity_type='result_batch'
           AND source_entity_id=? AND evidence_type='assessment_total'
         ORDER BY id LIMIT 1`,
        [schoolId, entry.student_id, batchId],
      )
      const metadata = JSON.stringify({ assessment_name: batch.assessment_name, limitation: "Final score only; topic mastery was not inferred." })
      if (existingEvidence) {
        await connection.query(
          `UPDATE mastery_evidence SET academic_year_id=?,term_id=?,score_percentage=?,marks_awarded=?,marks_available=?,assessment_weight=?,evidence_at=CURRENT_TIMESTAMP,metadata_json=? WHERE id=? AND school_id=?`,
          [batch.academic_year_id,batch.term_id,percentage, entry.score, batch.total_marks, assessmentWeight, metadata, existingEvidence.id, schoolId],
        )
      } else {
        await connection.query(
          `INSERT INTO mastery_evidence (
            public_ref,school_id,academic_year_id,term_id,student_id,class_id,subject_id,evidence_type,source_entity_type,source_entity_id,
            score_percentage,marks_awarded,marks_available,assessment_weight,evidence_granularity,evidence_at,metadata_json
          ) VALUES (UUID(),?,?,?,?,?,?,?,'result_batch',?,?,?,?,?,'limited',CURRENT_TIMESTAMP,?)`,
          [schoolId, batch.academic_year_id, batch.term_id, entry.student_id, batch.class_id, batch.subject_id, "assessment_total", batchId, percentage, entry.score,
            batch.total_marks, assessmentWeight, metadata],
        )
      }
      await recalculateStudentMastery(schoolId, entry.student_id, batch.subject_id, { academic_year_id: batch.academic_year_id, term_id: batch.term_id }, connection)
    }
    const classMastery=await recalculateClassMastery(schoolId,{classId:batch.class_id,subjectId:batch.subject_id,academicYearId:batch.academic_year_id,termId:batch.term_id},connection)
    const config = await getAcademicEngineConfig(schoolId, connection)
    const assessedScores = entries.filter((entry) => Number.isFinite(Number(entry.score)))
    const classAverage = assessedScores.length
      ? assessedScores.reduce((sum, entry) => sum + (Number(entry.score) / Math.max(1, Number(batch.total_marks))) * 100, 0) / assessedScores.length
      : null
    const [coverageResult,attendanceResult]=await Promise.all([
      connection.query(`SELECT COUNT(*) total,SUM(lifecycle_status IN ('TAUGHT','ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION')) taught,SUM(assessed_status=1 OR lifecycle_status IN ('ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION')) assessed,SUM(lifecycle_status='MASTERED') mastered,SUM(lifecycle_status='NOT_STARTED') untaught FROM curriculum_delivery_records WHERE school_id=? AND academic_year_id=? AND term_id=? AND class_id=? AND subject_id=?`,[schoolId,batch.academic_year_id,batch.term_id,batch.class_id,batch.subject_id]),
      connection.query(`SELECT COUNT(*) total,SUM(ar.status IN ('present','late')) attended FROM attendance_records ar WHERE ar.school_id=? AND ar.class_id=? AND ar.attendance_date BETWEEN (SELECT start_date FROM terms WHERE school_id=? AND id=?) AND (SELECT end_date FROM terms WHERE school_id=? AND id=?)`,[schoolId,batch.class_id,schoolId,batch.term_id,schoolId,batch.term_id]),
    ])
    const coverage=coverageResult[0][0]||{}
    const attendanceStats=attendanceResult[0][0]||{}
    const readiness=calculateExamReadiness({syllabus_completion:Number(coverage?.total||0)?Number(coverage.taught||0)/Number(coverage.total)*100:undefined,assessed_coverage:Number(coverage?.total||0)?Number(coverage.assessed||0)/Number(coverage.total)*100:undefined,topic_mastery:classMastery.average_mastery??undefined,recent_performance:classAverage??undefined,attendance:Number(attendanceStats?.total||0)?Number(attendanceStats.attended||0)/Number(attendanceStats.total)*100:undefined,weak_prerequisite_count:0,untaught_mandatory_topics:Number(coverage?.untaught||0)})
    await connection.query(`INSERT INTO exam_readiness_snapshots (public_ref,school_id,academic_year_id,term_id,class_id,subject_id,scope_type,readiness_score,confidence_score,factors_json,risks_json,missing_data_json,recommendations_json) VALUES (UUID(),?,?,?,?,?,'class',?,?,?,?,?,?)`,[schoolId,batch.academic_year_id,batch.term_id,batch.class_id,batch.subject_id,readiness.readiness_score,readiness.confidence_score,JSON.stringify(readiness.contributing_factors),JSON.stringify(Object.entries(readiness.penalties).filter(([,value])=>value>0).map(([key,value])=>({key,value}))),JSON.stringify(readiness.missing_data),JSON.stringify(readiness.label.includes('risk')?['Review weak evidence areas and protect revision time.']:[])])
    const [[scopeRefs]] = await connection.query(`SELECT c.public_ref class_ref,s.public_ref subject_ref FROM classes c JOIN subjects s ON s.id=? AND s.school_id=c.school_id WHERE c.school_id=? AND c.id=? LIMIT 1`,[batch.subject_id,schoolId,batch.class_id])
    await recordAcademicIntelligenceSnapshot({schoolId,academicYearId:batch.academic_year_id,termId:batch.term_id,scopeType:'class',scopeRef:scopeRefs?.class_ref||null,metricKey:'readiness',metricValue:readiness.readiness_score,confidenceScore:readiness.confidence_score,evidenceState:readiness.evidence_state,reason:'Assessment evidence recalculated readiness.',evidenceSummary:{class_ref:scopeRefs?.class_ref||null,subject_ref:scopeRefs?.subject_ref||null,missing_data:readiness.missing_data},formulaVersion:readiness.formula_version})
    if (classAverage !== null && classAverage < Number(config.mastery_threshold || 70)) {
      const [[context]] = await connection.query(
        `SELECT c.name class_name,s.name subject_name,u.id teacher_id
         FROM classes c JOIN subjects s ON s.id=? AND s.school_id=c.school_id
         LEFT JOIN users u ON u.id=? AND u.school_id=c.school_id
         WHERE c.school_id=? AND c.id=? LIMIT 1`,
        [batch.subject_id,batch.teacher_id,schoolId,batch.class_id],
      )
      const priority = classAverage < Number(config.intervention_threshold || 45) ? 'high' : 'medium'
      const assignedTeacherId=context?.teacher_id||batch.teacher_id
      const recommendationTitle=`Review ${context?.class_name||'class'} ${context?.subject_name||'subject'} performance`
      const recommendationReason=`The class average for ${batch.assessment_name} is ${classAverage.toFixed(1)}%. Final-score evidence cannot identify a topic weakness until questions or sections are mapped.`
      const recommendationEvidence=JSON.stringify({source:'result_batch',assessment:batch.assessment_name,class_average:Number(classAverage.toFixed(1)),students:assessedScores.length,granularity:'limited'})
      const recommendationAction='Review the assessment, map question or section evidence where available, then plan a short paper-based diagnostic before remediation.'
      // As with mastery evidence, nullable columns in the legacy dedupe key
      // make ON DUPLICATE KEY unreliable. Resolve this class/subject rule
      // explicitly so repeated result approvals update one recommendation.
      const [[existingRecommendation]]=await connection.query(
        `SELECT id FROM academic_recommendations
         WHERE school_id=? AND rule_key='assessment_class_average' AND dedupe_window=DATE_FORMAT(CURDATE(),'%Y-%m-%d')
           AND assigned_user_id=? AND class_id=? AND subject_id=? AND (term_id=? OR term_id IS NULL) AND student_id IS NULL AND topic_id IS NULL
         ORDER BY id LIMIT 1`,
        [schoolId,assignedTeacherId,batch.class_id,batch.subject_id,batch.term_id],
      )
      if(existingRecommendation){
        await connection.query(
          `UPDATE academic_recommendations SET term_id=?,title=?,reason=?,evidence_json=?,suggested_action=?,priority=?,confidence_score=?,status='NEW',updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?`,
          [batch.term_id,recommendationTitle,recommendationReason,recommendationEvidence,recommendationAction,priority,Math.min(70,35+assessedScores.length*2),existingRecommendation.id,schoolId],
        )
      }else{
        await connection.query(
          `INSERT INTO academic_recommendations (
            public_ref,school_id,recommendation_type,audience_role,assigned_user_id,class_id,subject_id,term_id,title,reason,
            evidence_json,suggested_action,priority,confidence_score,rule_key,dedupe_window,created_by
          ) VALUES (UUID(),?,'assessment_follow_up','teacher',?,?,?,?,?,?,?,?,?,?,'assessment_class_average',DATE_FORMAT(CURDATE(),'%Y-%m-%d'),?)`,
          [schoolId,assignedTeacherId,batch.class_id,batch.subject_id,batch.term_id,recommendationTitle,recommendationReason,recommendationEvidence,
            recommendationAction,priority,Math.min(70,35+assessedScores.length*2),actor?.id||batch.teacher_id],
        )
      }
      const alertTitle=`Academic follow-up · ${context?.class_name||'Class'}`
      const alertMessage=`${context?.subject_name||'Subject'} performance needs review after ${batch.assessment_name}.`
      const alertEvidence=JSON.stringify({class_average:Number(classAverage.toFixed(1)),students:assessedScores.length,granularity:'limited'})
      const alertTeacherId=context?.teacher_id||batch.teacher_id
      const [[existingAlert]]=await connection.query(
        `SELECT id FROM academic_alerts
         WHERE school_id=? AND rule_key='assessment_class_average' AND dedupe_window=DATE_FORMAT(CURDATE(),'%Y-%m-%d')
           AND class_id=? AND subject_id=? AND (term_id=? OR term_id IS NULL) AND student_id IS NULL AND topic_id IS NULL
         ORDER BY id LIMIT 1`,
        [schoolId,batch.class_id,batch.subject_id,batch.term_id],
      )
      if(existingAlert){
        await connection.query(
          `UPDATE academic_alerts SET term_id=?,severity=?,title=?,message=?,evidence_json=?,assigned_user_id=?,status='open',updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?`,
          [batch.term_id,priority,alertTitle,alertMessage,alertEvidence,alertTeacherId,existingAlert.id,schoolId],
        )
      }else{
        await connection.query(
          `INSERT INTO academic_alerts (public_ref,school_id,alert_type,severity,class_id,subject_id,term_id,title,message,evidence_json,assigned_user_id,rule_key,dedupe_window)
           VALUES (UUID(),?,'class_mastery_below_threshold',?,?,?,?,?,?,?,?,'assessment_class_average',DATE_FORMAT(CURDATE(),'%Y-%m-%d'))`,
          [schoolId,priority,batch.class_id,batch.subject_id,batch.term_id,alertTitle,alertMessage,alertEvidence,alertTeacherId],
        )
      }
    }
    await audit(connection, schoolId, actor, "ACADEMIC_EVIDENCE_INGESTED", "result_batch", batchId, null, { students: entries.length, granularity: "limited" })
    await connection.commit()
    return { students_processed: entries.length, evidence_granularity: "limited", class_average: classAverage===null?null:Number(classAverage.toFixed(1)), class_mastery: classMastery, exam_readiness: readiness }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function syncCurriculumFromLesson(schoolId, lessonLogId, actor = null) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[lesson]] = await connection.query(
      `SELECT l.*,tlt.syllabus_topic_id,tlt.syllabus_subtopic_id
       FROM teacher_lesson_logs l
       LEFT JOIN teacher_lesson_log_topics tlt ON tlt.lesson_log_id=l.id AND tlt.topic_role='main'
       WHERE l.school_id=? AND l.id=? LIMIT 1`,
      [schoolId, lessonLogId],
    )
    if (!lesson) throw new HttpError(404, "Lesson log was not found")
    const topicId = Number(lesson.syllabus_topic_id || lesson.main_topic_id || 0)
    if (!topicId || lesson.coverage_status === "postponed") {
      await connection.commit()
      return { updated: false, reason: "No delivered topic" }
    }
    const lifecycle = lesson.coverage_status === "assessed"
      ? "ASSESSED"
      : lesson.coverage_status === "fully_taught"
        ? "TAUGHT"
        : lesson.coverage_status === "revised"
          ? "REQUIRES_REVISION"
          : "IN_PROGRESS"
    await connection.query(
      `INSERT INTO curriculum_delivery_records (
        public_ref,school_id,academic_year_id,term_id,class_id,subject_id,teacher_id,topic_id,subtopic_id,
        actual_start_date,actual_completion_date,completed_lesson_count,periods_spent,lifecycle_status,
        teacher_confidence,teacher_notes,assessed_status,revision_required,evidence_source,last_recalculated_at
      ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE actual_start_date=COALESCE(actual_start_date,VALUES(actual_start_date)),
        actual_completion_date=CASE WHEN VALUES(lifecycle_status) IN ('TAUGHT','ASSESSED') THEN VALUES(actual_completion_date) ELSE actual_completion_date END,
        completed_lesson_count=completed_lesson_count+1,periods_spent=periods_spent+1,
        lifecycle_status=IF(manually_overridden=1,lifecycle_status,VALUES(lifecycle_status)),teacher_id=VALUES(teacher_id),
        teacher_confidence=VALUES(teacher_confidence),teacher_notes=VALUES(teacher_notes),
        assessed_status=GREATEST(assessed_status,VALUES(assessed_status)),revision_required=VALUES(revision_required),
        evidence_source='teacher_lesson_log',last_recalculated_at=CURRENT_TIMESTAMP`,
      [schoolId, lesson.academic_year_id, lesson.term_id, lesson.class_id, lesson.subject_id, lesson.teacher_id, topicId,
        lesson.syllabus_subtopic_id || null, lesson.lesson_date, ["TAUGHT","ASSESSED"].includes(lifecycle) ? lesson.lesson_date : null,
        lifecycle, lesson.lesson_outcome === "students_understood" ? "high" : lesson.lesson_outcome === "students_struggled" ? "low" : "medium",
        lesson.lesson_notes || null, lifecycle === "ASSESSED" ? 1 : 0,
        ["students_struggled","mixed_understanding"].includes(lesson.lesson_outcome) ? 1 : 0, "teacher_lesson_log"],
    )
    await audit(connection, schoolId, actor, "CURRICULUM_DELIVERY_SYNCED", "teacher_lesson_log", lessonLogId, null, { lifecycle_status: lifecycle, topic_id: topicId })
    await connection.commit()
    return { updated: true, lifecycle_status: lifecycle }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getStudentAcademicIntelligence(schoolId, studentRef, actor = null) {
  const [[student]] = await pool.query(
    `SELECT s.id,s.public_ref,s.first_name,s.last_name,c.name class_name
     FROM students s LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id
     WHERE s.school_id=? AND s.public_ref=? LIMIT 1`,
    [schoolId, studentRef],
  )
  if (!student) throw new HttpError(404, "Student was not found")
  let teacherReadScope = null
  let availableSubjects = []
  if (String(actor?.role || '').toLowerCase() === 'teacher') {
    const activeSession = await requireActiveAcademicSession(schoolId, pool)
    const [assigned] = await pool.query(`SELECT DISTINCT subj.id subject_id,subj.public_ref subject_ref,subj.name subject_name FROM student_enrollments se
      JOIN academic_years current_year ON current_year.id=se.academic_year_id AND current_year.school_id=se.school_id AND current_year.id=? AND current_year.is_active=1 AND current_year.status<>'archived'
      JOIN terms current_term ON current_term.id=se.term_id AND current_term.school_id=se.school_id AND current_term.academic_year_id=current_year.id AND current_term.id=? AND current_term.status IN ('open','marking')
      JOIN teacher_class_subject_assignments tcsa ON tcsa.school_id=se.school_id AND tcsa.class_id=se.class_id AND tcsa.teacher_id=? AND tcsa.subject_id IS NOT NULL AND tcsa.role='subject_teacher' AND tcsa.is_active=1
        AND tcsa.academic_year_id=se.academic_year_id AND tcsa.term_id=se.term_id
      JOIN subjects subj ON subj.id=tcsa.subject_id AND subj.school_id=tcsa.school_id
      WHERE se.school_id=? AND se.student_id=? AND se.enrollment_status='active'`, [activeSession.academicYearId, activeSession.termId, actor.id, schoolId, student.id])
    if (!assigned.length) throw new HttpError(403, 'Teachers can only view learner intelligence for their assigned class subjects.')
    teacherReadScope = {
      academicYearId: Number(activeSession.academicYearId),
      termId: Number(activeSession.termId),
      subjectIds: assigned.map((row) => Number(row.subject_id)),
    }
    availableSubjects = assigned.map((row) => ({ public_ref: row.subject_ref, name: row.subject_name }))
  }
  const subjectPlaceholders = teacherReadScope?.subjectIds.map(() => '?').join(',') || ''
  const masteryTeacherClause = teacherReadScope ? ` AND amr.academic_year_id=? AND amr.term_id=? AND amr.subject_id IN (${subjectPlaceholders})` : ''
  const evidenceTeacherClause = teacherReadScope ? ` AND me.academic_year_id=? AND me.term_id=? AND me.subject_id IN (${subjectPlaceholders})` : ''
  const interventionTeacherClause = teacherReadScope ? ` AND ai.term_id=? AND ai.subject_id IN (${subjectPlaceholders})` : ''
  const recommendationTeacherClause = teacherReadScope ? ` AND ar.term_id=? AND ar.subject_id IN (${subjectPlaceholders})` : ''
  const readinessTeacherClause = teacherReadScope ? ` AND ers.academic_year_id=? AND ers.term_id=? AND ers.subject_id IN (${subjectPlaceholders})` : ''
  const parentInsightTeacherClause = teacherReadScope ? ` AND pai.subject_id IN (${subjectPlaceholders})` : ''
  const teacherParams = (includeYear, includeTerm) => teacherReadScope
    ? [
        ...(includeYear ? [teacherReadScope.academicYearId] : []),
        ...(includeTerm ? [teacherReadScope.termId] : []),
        ...teacherReadScope.subjectIds,
      ]
    : []
  const [mastery, evidence, interventions, recommendations, readiness, parentInsights] = await Promise.all([
    pool.query(
      `SELECT amr.public_ref,amr.mastery_level,amr.mastery_score,amr.confidence_score,amr.mastery_status,amr.trend,
        amr.evidence_count,amr.last_evidence_at,subj.public_ref subject_ref,subj.name subject_name,t.topic_name,su.topic_name subtopic_name,
        lo.objective_text,amr.calculation_explanation_json
       FROM academic_mastery_records amr
       JOIN subjects subj ON subj.id=amr.subject_id AND subj.school_id=amr.school_id
       LEFT JOIN syllabus_topics t ON t.id=amr.topic_id AND t.school_id=amr.school_id
       LEFT JOIN syllabus_topics su ON su.id=amr.subtopic_id AND su.school_id=amr.school_id
       LEFT JOIN learning_objectives lo ON lo.id=amr.learning_objective_id AND lo.school_id=amr.school_id
       WHERE amr.school_id=? AND amr.student_id=?${masteryTeacherClause} ORDER BY subj.name,FIELD(amr.mastery_level,'subject','topic','subtopic','objective'),t.order_number`,
      [schoolId, student.id, ...teacherParams(true, true)],
    ),
    pool.query(
      `SELECT me.public_ref,me.evidence_type,me.score_percentage,me.evidence_granularity,me.evidence_at,
        subj.public_ref subject_ref,subj.name subject_name,t.topic_name,lo.objective_text,me.metadata_json
       FROM mastery_evidence me JOIN subjects subj ON subj.id=me.subject_id AND subj.school_id=me.school_id
       LEFT JOIN syllabus_topics t ON t.id=me.topic_id AND t.school_id=me.school_id
       LEFT JOIN learning_objectives lo ON lo.id=me.learning_objective_id AND lo.school_id=me.school_id
       WHERE me.school_id=? AND me.student_id=?${evidenceTeacherClause} ORDER BY me.evidence_at DESC LIMIT 80`,
      [schoolId, student.id, ...teacherParams(true, true)],
    ),
    pool.query(
      `SELECT ai.public_ref,ai.intervention_type,ai.issue,ai.priority,ai.start_date,ai.review_date,ai.outcome,ai.status,
        subj.public_ref subject_ref,subj.name subject_name,t.topic_name
       FROM academic_interventions ai JOIN subjects subj ON subj.id=ai.subject_id AND subj.school_id=ai.school_id
       LEFT JOIN syllabus_topics t ON t.id=ai.topic_id AND t.school_id=ai.school_id
       WHERE ai.school_id=? AND ai.student_id=?${interventionTeacherClause} ORDER BY ai.created_at DESC`,
      [schoolId, student.id, ...teacherParams(false, true)],
    ),
    pool.query(
      `SELECT ar.public_ref,ar.title,ar.reason,ar.suggested_action,ar.priority,ar.confidence_score,ar.status,ar.due_at,subj.public_ref subject_ref,subj.name subject_name
       FROM academic_recommendations ar LEFT JOIN subjects subj ON subj.id=ar.subject_id AND subj.school_id=ar.school_id WHERE ar.school_id=? AND ar.student_id=?${recommendationTeacherClause} ORDER BY FIELD(ar.status,'NEW','ACCEPTED','IN_PROGRESS','COMPLETED','DISMISSED'),ar.created_at DESC LIMIT 30`,
      [schoolId, student.id, ...teacherParams(false, true)],
    ),
    pool.query(
      `SELECT ers.public_ref,ers.readiness_score,ers.confidence_score,ers.factors_json,ers.risks_json,
        ers.missing_data_json,ers.recommendations_json,ers.calculated_at,subj.public_ref subject_ref,subj.name subject_name
       FROM exam_readiness_snapshots ers LEFT JOIN subjects subj ON subj.id=ers.subject_id AND subj.school_id=ers.school_id
        WHERE ers.school_id=? AND ers.student_id=?${readinessTeacherClause} ORDER BY ers.calculated_at DESC LIMIT 20`,
      [schoolId, student.id, ...teacherParams(true, true)],
    ),
    pool.query(`SELECT pai.public_ref,pai.reporting_period,pai.headline,pai.summary_text,pai.strengths_json,pai.focus_areas_json,
      pai.attendance_effect_text,pai.home_support_json,pai.completed_interventions_json,pai.status,pai.created_at,pai.published_at,
      subj.public_ref subject_ref,subj.name subject_name
      FROM parent_academic_insights pai LEFT JOIN subjects subj ON subj.id=pai.subject_id AND subj.school_id=pai.school_id
      WHERE pai.school_id=? AND pai.student_id=?${parentInsightTeacherClause} ORDER BY pai.created_at DESC LIMIT 30`,[schoolId,student.id,...teacherParams(false,false)]),
  ])
  return {
    student: { public_ref: student.public_ref, name: `${student.first_name} ${student.last_name}`, class_name: student.class_name },
    available_subjects: availableSubjects,
    mastery: mastery[0].map((row) => ({ ...row, calculation_explanation: jsonValue(row.calculation_explanation_json, {}) })),
    evidence: evidence[0].map((row) => ({ ...row, metadata: jsonValue(row.metadata_json, {}) })),
    interventions: interventions[0],
    recommendations: recommendations[0],
    exam_readiness: readiness[0].map((row) => ({ ...row, factors: jsonValue(row.factors_json, {}), risks: jsonValue(row.risks_json, []), missing_data: jsonValue(row.missing_data_json, []), recommendations: jsonValue(row.recommendations_json, []) })),
    parent_insights: parentInsights[0].map((row)=>({...row,strengths:jsonValue(row.strengths_json,[]),focus_areas:jsonValue(row.focus_areas_json,[]),home_support:jsonValue(row.home_support_json,[]),completed_interventions:jsonValue(row.completed_interventions_json,[]),strengths_json:undefined,focus_areas_json:undefined,home_support_json:undefined,completed_interventions_json:undefined})),
  }
}

export async function createParentAcademicInsight(schoolId,actor,body={}) {
  const studentRef=String(body.student_ref||'')
  if(String(actor?.role||'').toLowerCase()==='teacher'&&!String(body.subject_ref||'').trim())throw new HttpError(400,'Select one of your assigned subjects before preparing a parent update.')
  const intelligence=await getStudentAcademicIntelligence(schoolId,studentRef,actor)
  const [[student]]=await pool.query(`SELECT student.id,student.first_name,student.last_name,
    COALESCE(CASE WHEN current_term.id IS NOT NULL THEN enrollment.class_id END,student.class_id) class_id,
    CASE WHEN current_term.id IS NOT NULL THEN enrollment.academic_year_id END academic_year_id,
    CASE WHEN current_term.id IS NOT NULL THEN enrollment.term_id END term_id
    FROM students student
    LEFT JOIN student_enrollments enrollment ON enrollment.school_id=student.school_id AND enrollment.student_id=student.id
      AND enrollment.enrollment_status='active'
    LEFT JOIN academic_years current_year ON current_year.school_id=enrollment.school_id
      AND current_year.id=enrollment.academic_year_id AND current_year.is_active=1 AND current_year.status<>'archived'
    LEFT JOIN terms current_term ON current_term.school_id=enrollment.school_id AND current_term.id=enrollment.term_id
      AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking')
    WHERE student.school_id=? AND student.public_ref=? AND student.status='active'
    ORDER BY current_term.id IS NULL,enrollment.id DESC LIMIT 1`,[schoolId,studentRef])
  if(!student)throw new HttpError(404,'Student was not found.')
  let subjectId=null
  let subjectRef=null
  if(body.subject_ref){
    const [[subject]]=await pool.query("SELECT id,public_ref FROM subjects WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,String(body.subject_ref)])
    if(!subject)throw new HttpError(400,'The selected subject was not found.')
    subjectId=subject.id
    subjectRef=subject.public_ref
    await assertAcademicActorWriteScope(pool,schoolId,actor,{classId:student.class_id,subjectId,academicYearId:student.academic_year_id,termId:student.term_id,teacherId:null})
  }
  const mastery=(intelligence.mastery||[]).filter((row)=>!subjectRef||row.subject_ref===subjectRef)
  const strengths=mastery.filter((row)=>['MASTERED','ADVANCED'].includes(row.mastery_status)).slice(0,4).map((row)=>row.objective_text||row.subtopic_name||row.topic_name||row.subject_name).filter(Boolean)
  const focusAreas=mastery.filter((row)=>['REQUIRES_INTERVENTION','EMERGING','DEVELOPING','PARTIALLY_MASTERED'].includes(row.mastery_status)).slice(0,4).map((row)=>row.objective_text||row.subtopic_name||row.topic_name||row.subject_name).filter(Boolean)
  const improving=mastery.some((row)=>row.trend==='IMPROVING')
  const declining=mastery.some((row)=>row.trend==='DECLINING')
  const [[attendance]]=await pool.query(`SELECT COUNT(*) marked,SUM(status IN ('present','late')) attended
    FROM attendance_records WHERE school_id=? AND student_id=? AND attendance_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)`,[schoolId,student.id])
  const attendanceRate=Number(attendance?.marked||0)?Math.round(Number(attendance.attended||0)*100/Number(attendance.marked)):null
  const completed=(intelligence.interventions||[]).filter((row)=>row.status==='completed'&&(!subjectRef||row.subject_ref===subjectRef)).map((row)=>row.issue).slice(0,4)
  const firstName=student.first_name
  const progressText=improving?`${firstName} is improving in the recent learning evidence.`:declining?`${firstName}'s recent work shows a decline that the teacher is monitoring.`:`${firstName}'s progress is being monitored using recent schoolwork and assessments.`
  const focusText=focusAreas.length?` The main area for practice is ${focusAreas.slice(0,2).join(' and ')}.`:' No specific weak topic has enough evidence to report yet.'
  const headline=String(body.headline||`${firstName}'s learning progress`).trim().slice(0,240)
  const summaryText=String(body.summary_text||`${progressText}${focusText}`).trim()
  const homeSupport=Array.isArray(body.home_support)&&body.home_support.length?body.home_support:(focusAreas.length?[`Practise ${focusAreas[0]} for 15 minutes, three times this week.`,`Ask ${firstName} to explain one example in their own words.`]:['Keep a regular, short study routine and ask what was learned at school.'])
  const attendanceEffect=body.attendance_effect_text||(attendanceRate===null?'There is not enough recent attendance data to explain an effect on learning.':attendanceRate<85?`Attendance was ${attendanceRate}% over the recent period and may be affecting continuity of learning.`:`Recent attendance was ${attendanceRate}%, which supports consistent learning.`)
  const config=await getAcademicEngineConfig(schoolId)
  const ref=randomUUID()
  const [insert]=await pool.query(`INSERT INTO parent_academic_insights (public_ref,school_id,student_id,subject_id,reporting_period,headline,summary_text,strengths_json,focus_areas_json,attendance_effect_text,home_support_json,completed_interventions_json,evidence_summary_json,visibility_json,status,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,[ref,schoolId,student.id,subjectId,body.reporting_period||'Current academic period',headline,summaryText,JSON.stringify(body.strengths||strengths),JSON.stringify(body.focus_areas||focusAreas),attendanceEffect,JSON.stringify(homeSupport),JSON.stringify(completed),JSON.stringify({mastery_records:mastery.length,attendance_records:Number(attendance?.marked||0),source:'academic_intelligence_engine'}),config.parent_visibility_json?JSON.stringify(jsonValue(config.parent_visibility_json,{})):null,actor.id])
  await audit(pool,schoolId,actor,'PARENT_ACADEMIC_INSIGHT_CREATED','parent_academic_insight',insert.insertId,null,{public_ref:ref,student_ref:studentRef,status:'draft'})
  return {public_ref:ref,status:'draft',headline,summary_text:summaryText,strengths:body.strengths||strengths,focus_areas:body.focus_areas||focusAreas,attendance_effect_text:attendanceEffect,home_support:homeSupport,completed_interventions:completed}
}

export async function updateParentAcademicInsight(schoolId,ref,actor,body={}) {
  const [[before]]=await pool.query("SELECT * FROM parent_academic_insights WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,ref])
  if(!before)throw new HttpError(404,'Parent academic insight was not found.')
  const status=body.status||before.status
  if(!['draft','approved','published','withdrawn'].includes(status))throw new HttpError(400,'Parent insight status is invalid.')
  if(status==='published'&&!['approved','published'].includes(before.status))throw new HttpError(409,'Approve the parent insight before publishing it.')
  if(!validateParentInsightTransition(before.status,status))throw new HttpError(409,`A ${before.status} parent update cannot move to ${status}.`)
  if(String(actor?.role||'').toLowerCase()==='teacher'){
    if(Number(before.created_by)!==Number(actor.id))throw new HttpError(403,'Teachers can only edit parent updates they drafted themselves.')
    if(before.status!=='draft'||status!=='draft')throw new HttpError(403,'Parent updates must be approved and published by academic leadership.')
    const [[studentScope]]=await pool.query(`SELECT COALESCE(CASE WHEN current_term.id IS NOT NULL THEN enrollment.class_id END,student.class_id) class_id,
      CASE WHEN current_term.id IS NOT NULL THEN enrollment.academic_year_id END academic_year_id,
      CASE WHEN current_term.id IS NOT NULL THEN enrollment.term_id END term_id
      FROM students student
      LEFT JOIN student_enrollments enrollment ON enrollment.school_id=student.school_id AND enrollment.student_id=student.id
        AND enrollment.enrollment_status='active'
      LEFT JOIN academic_years current_year ON current_year.school_id=enrollment.school_id
        AND current_year.id=enrollment.academic_year_id AND current_year.is_active=1 AND current_year.status<>'archived'
      LEFT JOIN terms current_term ON current_term.school_id=enrollment.school_id AND current_term.id=enrollment.term_id
        AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking')
      WHERE student.school_id=? AND student.id=? AND student.status='active'
      ORDER BY current_term.id IS NULL,enrollment.id DESC LIMIT 1`,[schoolId,before.student_id])
    if(!studentScope)throw new HttpError(409,'The learner is no longer active in this school.')
    if(before.subject_id)await assertAcademicActorWriteScope(pool,schoolId,actor,{classId:studentScope.class_id,subjectId:before.subject_id,academicYearId:studentScope.academic_year_id,termId:studentScope.term_id,teacherId:null})
    else {
      const [[assignment]]=await pool.query(`SELECT assignment.id FROM teacher_class_subject_assignments assignment
        WHERE assignment.school_id=? AND assignment.teacher_id=? AND assignment.class_id=?
          AND assignment.subject_id IS NOT NULL AND assignment.role='subject_teacher' AND assignment.is_active=1
          AND assignment.academic_year_id=? AND assignment.term_id=? LIMIT 1`,
      [schoolId,actor.id,studentScope.class_id,studentScope.academic_year_id,studentScope.term_id])
      if(!assignment)throw new HttpError(403,'Teachers can only edit parent updates for learners they currently teach.')
    }
  }
  await pool.query(`UPDATE parent_academic_insights SET headline=COALESCE(?,headline),summary_text=COALESCE(?,summary_text),strengths_json=COALESCE(?,strengths_json),focus_areas_json=COALESCE(?,focus_areas_json),attendance_effect_text=COALESCE(?,attendance_effect_text),home_support_json=COALESCE(?,home_support_json),status=?,approved_by=CASE WHEN ?='approved' THEN ? ELSE approved_by END,approved_at=CASE WHEN ?='approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,published_by=CASE WHEN ?='published' THEN ? ELSE published_by END,published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE published_at END WHERE school_id=? AND public_ref=?`,[body.headline||null,body.summary_text||null,body.strengths?JSON.stringify(body.strengths):null,body.focus_areas?JSON.stringify(body.focus_areas):null,body.attendance_effect_text||null,body.home_support?JSON.stringify(body.home_support):null,status,status,actor.id,status,status,actor.id,status,schoolId,ref])
  await audit(pool,schoolId,actor,'PARENT_ACADEMIC_INSIGHT_UPDATED','parent_academic_insight',before.id,{status:before.status},{status})
  const becameParentVisible=['approved','published'].includes(status)&&!['approved','published'].includes(before.status)
  if(becameParentVisible){
    const [guardians]=await pool.query("SELECT DISTINCT user_id FROM student_guardians WHERE school_id=? AND student_id=? AND user_id IS NOT NULL",[schoolId,before.student_id])
    for(const guardian of guardians)await createInAppNotification({schoolId,recipientUserId:guardian.user_id,title:'New academic progress update',message:body.summary_text||before.summary_text,category:'academics',priority:'medium',linkedEntityType:'parent_academic_insight',linkedEntityId:before.id,createdBy:actor.id})
  }
  return {public_ref:ref,status}
}

export async function getParentPortalAcademicInsights(schoolId,actor,filters={}) {
  const requestedStudentRef=String(filters.student_ref||filters.studentRef||'').trim()
  const linkParams=[schoolId,actor.id]
  const requestedClause=requestedStudentRef?' AND s.public_ref=?':''
  if(requestedStudentRef)linkParams.push(requestedStudentRef)
  const [links]=await pool.query(`SELECT DISTINCT s.id,s.public_ref,s.first_name,s.last_name,c.name class_name
    FROM student_guardians sg JOIN students s ON s.id=sg.student_id AND s.school_id=sg.school_id
    LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id
    WHERE sg.school_id=? AND sg.user_id=? AND s.status='active'${requestedClause}
    ORDER BY s.first_name,s.last_name`,linkParams)
  if(!links.length)return {students:[]}

  const placeholders=links.map(()=>'?').join(',')
  const [insights]=await pool.query(`SELECT pai.student_id,pai.public_ref,pai.reporting_period,pai.headline,pai.summary_text,
      pai.strengths_json,pai.focus_areas_json,pai.attendance_effect_text,pai.home_support_json,
      pai.completed_interventions_json,pai.status,pai.approved_at,pai.published_at,subj.name subject_name
    FROM parent_academic_insights pai
    LEFT JOIN subjects subj ON subj.id=pai.subject_id AND subj.school_id=pai.school_id
    WHERE pai.school_id=? AND pai.student_id IN (${placeholders}) AND pai.status IN ('approved','published')
    ORDER BY COALESCE(pai.published_at,pai.approved_at) DESC,pai.id DESC
    LIMIT 200`,[schoolId,...links.map((student)=>student.id)])

  const linkById=new Map(links.map((student)=>[Number(student.id),student]))
  const insightsByStudent=new Map(links.map((student)=>[Number(student.id),[]]))
  for(const row of insights){
    const student=linkById.get(Number(row.student_id))
    if(!student)continue
    insightsByStudent.get(Number(row.student_id)).push({
      public_ref:row.public_ref,
      reporting_period:row.reporting_period,
      headline:row.headline,
      summary_text:row.summary_text,
      strengths:jsonValue(row.strengths_json,[]),
      focus_areas:jsonValue(row.focus_areas_json,[]),
      attendance_effect_text:row.attendance_effect_text,
      home_support:jsonValue(row.home_support_json,[]),
      completed_interventions:jsonValue(row.completed_interventions_json,[]),
      subject_name:row.subject_name,
      status:row.status,
      published_at:row.published_at||row.approved_at,
    })
  }
  await Promise.all(insights.map((insight)=>{
    const student=linkById.get(Number(insight.student_id))
    return audit(pool,schoolId,actor,'PARENT_ACADEMIC_INSIGHT_VIEWED','parent_academic_insight',null,null,{public_ref:insight.public_ref,student_ref:student?.public_ref||null})
  }))
  return {students:links.map((student)=>({
    student:{public_ref:student.public_ref,name:`${student.first_name} ${student.last_name}`,class_name:student.class_name},
    insights:(insightsByStudent.get(Number(student.id))||[]).slice(0,20),
  }))}
}

export async function getAcademicCommandCentre(schoolId, filters = {}, actor = null) {
  const teacherId = String(actor?.role || "").toLowerCase() === "teacher" ? Number(actor.id) : null
  const teacherScopePredicate = (columns = {}) => {
    if (!teacherId || !columns.school_id || !columns.subject_id) return ""
    const classScope = columns.class_id ? ` AND tcsa.class_id=${columns.class_id}` : ""
    const yearScope = columns.academic_year_id ? ` AND ${columns.academic_year_id}=current_year.id` : ""
    const termScope = columns.term_id ? ` AND ${columns.term_id}=current_term.id` : ""
    const gradeJoins = columns.grade_id ? `
      JOIN classes assigned_class ON assigned_class.school_id=tcsa.school_id AND assigned_class.id=tcsa.class_id
      LEFT JOIN grade_levels assigned_grade ON assigned_grade.school_id=assigned_class.school_id
        AND LOWER(TRIM(assigned_grade.name))=LOWER(TRIM(assigned_class.grade_level))` : ""
    const gradeScope = columns.grade_id ? ` AND (${columns.grade_id} IS NULL OR ${columns.grade_id}=assigned_grade.id)` : ""
    return `EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa
      JOIN academic_years current_year ON current_year.school_id=tcsa.school_id
        AND current_year.is_active=1 AND current_year.status<>'archived'
      JOIN terms current_term ON current_term.school_id=current_year.school_id
        AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking')${gradeJoins}
      WHERE tcsa.school_id=${columns.school_id} AND tcsa.teacher_id=?${classScope}
        AND tcsa.subject_id=${columns.subject_id} AND tcsa.role='subject_teacher' AND tcsa.is_active=1
        AND tcsa.academic_year_id=current_year.id AND tcsa.term_id=current_term.id${yearScope}${termScope}${gradeScope})`
  }
  const params = [schoolId]
  let clause = ""
  if (filters.term_id) { clause += " AND cdr.term_id=?"; params.push(Number(filters.term_id)) }
  if (filters.class_id) { clause += " AND cdr.class_id=?"; params.push(Number(filters.class_id)) }
  if (filters.subject_id) { clause += " AND cdr.subject_id=?"; params.push(Number(filters.subject_id)) }
  if (teacherId) {
    clause += ` AND ${teacherScopePredicate({ school_id: "cdr.school_id", academic_year_id: "cdr.academic_year_id", term_id: "cdr.term_id", class_id: "cdr.class_id", subject_id: "cdr.subject_id" })}`
    params.push(teacherId)
  }
  const scopedFilter = (columns) => {
    const values = [schoolId]
    let sql = ''
    if (filters.term_id && columns.term_id) { sql += ` AND ${columns.term_id}=?`; values.push(Number(filters.term_id)) }
    if (filters.class_id && columns.class_id) { sql += ` AND ${columns.class_id}=?`; values.push(Number(filters.class_id)) }
    if (filters.subject_id && columns.subject_id) { sql += ` AND ${columns.subject_id}=?`; values.push(Number(filters.subject_id)) }
    if (teacherId && columns.class_id && columns.subject_id) {
      sql += ` AND ${teacherScopePredicate({ school_id: columns.school_id, academic_year_id: columns.academic_year_id, term_id: columns.term_id, class_id: columns.class_id, subject_id: columns.subject_id })}`
      values.push(teacherId)
    }
    return { sql, values }
  }
  const alertScope = scopedFilter({ school_id: 'aa.school_id', term_id: 'aa.term_id', class_id: 'aa.class_id', subject_id: 'aa.subject_id' })
  const recommendationScope = scopedFilter({ school_id: 'ar.school_id', term_id: 'ar.term_id', class_id: 'ar.class_id', subject_id: 'ar.subject_id' })
  const interventionScope = scopedFilter({ school_id: 'ai.school_id', term_id: 'ai.term_id', class_id: 'ai.class_id', subject_id: 'ai.subject_id' })
  const readinessScope = scopedFilter({ school_id: 'ers.school_id', academic_year_id: 'ers.academic_year_id', term_id: 'ers.term_id', class_id: 'ers.class_id', subject_id: 'ers.subject_id' })
  const [coverage, alerts, recommendations, interventions, readiness, migrationReports, questionAnalytics, meaningfulChanges, positiveSignals] = await Promise.all([
    pool.query(
      `SELECT c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,
        COUNT(*) total_records,
        ROUND(AVG(CASE WHEN cdr.lifecycle_status IN ('TAUGHT','ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION') THEN 100 ELSE 0 END),1) taught_percentage,
        ROUND(AVG(CASE WHEN cdr.assessed_status=1 OR cdr.lifecycle_status IN ('ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION') THEN 100 ELSE 0 END),1) assessed_percentage,
        ROUND(AVG(CASE WHEN cdr.students_assessed > 0 THEN CASE WHEN cdr.lifecycle_status='MASTERED' THEN 100 ELSE 0 END ELSE NULL END),1) mastered_percentage,
        ROUND(AVG(cdr.class_mastery_score),1) class_mastery_score,
        SUM(cdr.students_below_threshold) students_below_threshold,
        SUM(CASE WHEN cdr.lifecycle_status='DELAYED' THEN 1 ELSE 0 END) delayed_topics,
        SUM(CASE WHEN cdr.revision_required=1 THEN 1 ELSE 0 END) revision_topics
       FROM curriculum_delivery_records cdr JOIN classes c ON c.id=cdr.class_id AND c.school_id=cdr.school_id
       JOIN subjects s ON s.id=cdr.subject_id AND s.school_id=cdr.school_id
       WHERE cdr.school_id=?${clause}
       GROUP BY cdr.class_id,c.public_ref,c.name,cdr.subject_id,s.public_ref,s.name ORDER BY revision_topics DESC,delayed_topics DESC,c.name,s.name`,
      params,
    ),
    pool.query(`SELECT aa.public_ref,aa.alert_type,aa.severity,aa.title,aa.message,aa.status,aa.evidence_json,aa.created_at,
      c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,t.public_ref topic_ref,t.topic_name,
      u.public_ref owner_ref,u.full_name owner_name
      FROM academic_alerts aa
      LEFT JOIN classes c ON c.id=aa.class_id AND c.school_id=aa.school_id
      LEFT JOIN subjects s ON s.id=aa.subject_id AND s.school_id=aa.school_id
      LEFT JOIN syllabus_topics t ON t.id=aa.topic_id AND t.school_id=aa.school_id
      LEFT JOIN users u ON u.id=aa.assigned_user_id AND u.school_id=aa.school_id
      WHERE aa.school_id=? AND aa.status IN ('open','acknowledged')${alertScope.sql}
      ORDER BY FIELD(aa.severity,'urgent','high','medium','low'),aa.created_at DESC LIMIT 30`, alertScope.values),
    pool.query(`SELECT ar.public_ref,ar.title,ar.reason,ar.suggested_action,ar.priority,ar.status,ar.evidence_json,ar.confidence_score,ar.due_at,
      c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,t.public_ref topic_ref,t.topic_name,
      u.public_ref owner_ref,u.full_name owner_name
      FROM academic_recommendations ar
      LEFT JOIN classes c ON c.id=ar.class_id AND c.school_id=ar.school_id
      LEFT JOIN subjects s ON s.id=ar.subject_id AND s.school_id=ar.school_id
      LEFT JOIN syllabus_topics t ON t.id=ar.topic_id AND t.school_id=ar.school_id
      LEFT JOIN users u ON u.id=ar.assigned_user_id AND u.school_id=ar.school_id
      WHERE ar.school_id=? AND ar.status IN ('NEW','ACCEPTED','IN_PROGRESS')${recommendationScope.sql}
      ORDER BY FIELD(ar.priority,'urgent','high','medium','low'),ar.created_at DESC LIMIT 30`, recommendationScope.values),
    pool.query(`SELECT ai.public_ref,ai.intervention_type,ai.issue,ai.priority,ai.status,ai.review_date,ai.outcome,
      c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,t.public_ref topic_ref,t.topic_name,u.full_name owner_name
      FROM academic_interventions ai
      LEFT JOIN classes c ON c.id=ai.class_id AND c.school_id=ai.school_id
      JOIN subjects s ON s.id=ai.subject_id AND s.school_id=ai.school_id
      LEFT JOIN syllabus_topics t ON t.id=ai.topic_id AND t.school_id=ai.school_id
      LEFT JOIN users u ON u.id=ai.assigned_teacher_id AND u.school_id=ai.school_id
      WHERE ai.school_id=? AND ai.status IN ('active','review_due')${interventionScope.sql}
      ORDER BY ai.review_date,FIELD(ai.priority,'urgent','high','medium','low') LIMIT 30`, interventionScope.values),
    pool.query(`SELECT ers.public_ref,ers.scope_type,ers.readiness_score,ers.confidence_score,ers.factors_json,ers.risks_json,ers.missing_data_json,ers.calculated_at FROM exam_readiness_snapshots ers WHERE ers.school_id=?${readinessScope.sql} ORDER BY ers.calculated_at DESC LIMIT 30`, readinessScope.values),
    pool.query("SELECT public_ref,migration_key,source_system,migrated_records,partially_migrated_records,skipped_records,manual_review_records,detail_json,generated_at FROM academic_migration_reports WHERE school_id=? ORDER BY generated_at DESC LIMIT 20",[schoolId]),
    pool.query(`SELECT qa.public_ref,q.public_ref question_ref,LEFT(q.question_text,180) question_text,
      s.name subject_name,t.topic_name,qa.total_attempts,qa.success_rate,qa.confidence_score,
      qa.flags_json,qa.last_calculated_at
      FROM question_attempt_analytics qa
      JOIN question_bank q ON q.id=qa.question_id AND q.school_id=qa.school_id
      JOIN subjects s ON s.id=q.subject_id AND s.school_id=q.school_id
      LEFT JOIN syllabus_topics t ON t.id=q.topic_id AND t.school_id=q.school_id
      WHERE qa.school_id=?${teacherId ? ` AND ${teacherScopePredicate({ school_id: "qa.school_id", subject_id: "q.subject_id", grade_id: "q.grade_id" })}` : ""} ORDER BY JSON_LENGTH(COALESCE(qa.flags_json,JSON_ARRAY())) DESC,qa.total_attempts DESC LIMIT 50`,teacherId?[schoolId,teacherId]:[schoolId]),
    pool.query(`SELECT public_ref,scope_type,scope_ref,metric_key,metric_value,confidence_score,evidence_state,reason,evidence_summary_json,created_at
      FROM academic_intelligence_snapshots WHERE school_id=? ORDER BY created_at DESC LIMIT 30`,[schoolId]),
    pool.query(`SELECT 'intervention' signal_type,ai.public_ref,CONCAT('Support succeeded: ',ai.issue) title,
      JSON_OBJECT('outcome',ai.outcome,'completed_at',ai.completed_at) evidence,ai.completed_at changed_at
      FROM academic_interventions ai WHERE ai.school_id=? AND ai.status='completed' AND ai.outcome='improved'${teacherId ? ` AND ${teacherScopePredicate({ school_id: "ai.school_id", term_id: "ai.term_id", class_id: "ai.class_id", subject_id: "ai.subject_id" })}` : ""}
      UNION ALL
      SELECT 'resolved_risk',aa.public_ref,CONCAT('Risk resolved: ',aa.title),aa.evidence_json,aa.resolved_at
      FROM academic_alerts aa WHERE aa.school_id=? AND aa.status='resolved'${teacherId ? ` AND ${teacherScopePredicate({ school_id: "aa.school_id", term_id: "aa.term_id", class_id: "aa.class_id", subject_id: "aa.subject_id" })}` : ""}
      ORDER BY changed_at DESC LIMIT 20`,teacherId?[schoolId,teacherId,schoolId,teacherId]:[schoolId,schoolId]),
  ])
  const alertRows=alerts[0].map((row)=>({...row,evidence:jsonValue(row.evidence_json,{}),evidence_json:undefined}))
  const recommendationRows=recommendations[0].map((row)=>({...row,evidence:jsonValue(row.evidence_json,{}),evidence_json:undefined}))
  const readinessRows=readiness[0].map((row)=>({...row,factors:jsonValue(row.factors_json,{}),risks:jsonValue(row.risks_json,[]),missing_data:jsonValue(row.missing_data_json,[]),factors_json:undefined,risks_json:undefined,missing_data_json:undefined}))
  const priorityScopes=[...new Set(alertRows.filter((row)=>['urgent','high'].includes(row.severity)).map((row)=>[row.class_name,row.subject_name].filter(Boolean).join(' ')).filter(Boolean))]
  const incomplete=coverage[0].filter((row)=>row.class_mastery_score===null||Number(row.assessed_percentage||0)<50)
  const academicPosition=priorityScopes.length
    ? `${priorityScopes.slice(0,3).join(', ')} ${priorityScopes.length===1?'requires':'require'} targeted attention. ${incomplete.length?`Evidence remains incomplete in ${incomplete.length} class-subject scope${incomplete.length===1?'':'s'}, so readiness there should not yet be treated as reliable.`:'Current evidence coverage is sufficient for scoped follow-up.'}`
    : incomplete.length
      ? `No high academic risk is currently validated, although evidence remains incomplete in ${incomplete.length} class-subject scope${incomplete.length===1?'':'s'}.`
      : 'Current validated evidence shows stable academic operations with no high-priority risk requiring escalation.'
  return {
    academic_position_today: academicPosition,
    coverage: coverage[0],
    class_health: coverage[0],
    alerts: alertRows,
    recommendations: recommendationRows,
    interventions: interventions[0],
    readiness: readinessRows,
    positive_signals: positiveSignals[0].map((row)=>({...row,evidence:jsonValue(row.evidence,{}),changed_at:row.changed_at})),
    meaningful_changes: teacherId ? [] : meaningfulChanges[0].map((row)=>({...row,evidence_summary:jsonValue(row.evidence_summary_json,{}),evidence_summary_json:undefined})),
    operational_counts:{classes_needing_action:new Set(alertRows.map((row)=>row.class_ref).filter(Boolean)).size,active_interventions:interventions[0].length,overdue_actions:recommendationRows.filter((row)=>row.due_at&&new Date(row.due_at)<new Date()).length,positive_signals:positiveSignals[0].length,evidence_gaps:incomplete.length},
    migration_reports:teacherId ? [] : migrationReports[0].map((row)=>({...row,detail:jsonValue(row.detail_json,{}),detail_json:undefined})),
    question_analytics:questionAnalytics[0].map((row)=>({...row,flags:jsonValue(row.flags_json,[]),flags_json:undefined})),
  }
}

export async function getAcademicIntelligenceHistory(schoolId, filters = {}) {
  const params = [schoolId]
  let clause = ''
  if (filters.calculation_type) { clause += ' AND calculation_type=?'; params.push(String(filters.calculation_type)) }
  if (filters.status) { clause += ' AND status=?'; params.push(String(filters.status)) }
  const [runs] = await pool.query(
    `SELECT public_ref,calculation_type,trigger_type,trigger_entity_type,status,input_summary_json,output_summary_json,error_message,started_at,completed_at,created_at
     FROM academic_calculation_runs WHERE school_id=?${clause} ORDER BY created_at DESC LIMIT 100`,
    params,
  )
  return { history: runs.map((row) => ({ ...row, input_summary: jsonValue(row.input_summary_json, {}), output_summary: jsonValue(row.output_summary_json, {}), input_summary_json: undefined, output_summary_json: undefined })) }
}

export async function getAcademicFindingExplanation(schoolId, findingRef, actor = null) {
  const ref = String(findingRef || '')
  if (String(actor?.role || '').toLowerCase() === 'teacher') {
    const scopeTables = [
      ['academic_mastery_records', 'academic_year_id', 'term_id'],
      ['academic_alerts', null, 'term_id'],
      ['academic_recommendations', null, 'term_id'],
      ['exam_readiness_snapshots', 'academic_year_id', 'term_id'],
    ]
    let scope = null
    for (const [table, yearColumn, termColumn] of scopeTables) {
      const [[row]] = await pool.query(`SELECT class_id,subject_id,
        ${yearColumn || 'NULL'} academic_year_id,${termColumn || 'NULL'} term_id
        FROM ${table} WHERE school_id=? AND public_ref=? LIMIT 1`, [schoolId, ref])
      if (row) { scope = row; break }
    }
    if (!scope?.class_id || !scope?.subject_id) throw new HttpError(404, 'Academic finding was not found.')
    const [[assignment]] = await pool.query(`SELECT assignment.id FROM teacher_class_subject_assignments assignment
      JOIN academic_years current_year ON current_year.school_id=assignment.school_id
        AND current_year.is_active=1 AND current_year.status<>'archived'
      JOIN terms current_term ON current_term.school_id=current_year.school_id
        AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking')
      WHERE assignment.school_id=? AND assignment.teacher_id=? AND assignment.class_id=? AND assignment.subject_id=?
        AND assignment.role='subject_teacher' AND assignment.is_active=1
        AND assignment.academic_year_id=current_year.id AND assignment.term_id=current_term.id
        AND (? IS NULL OR ?=current_year.id) AND (? IS NULL OR ?=current_term.id)
      LIMIT 1`, [schoolId, actor.id, scope.class_id, scope.subject_id,
      scope.academic_year_id, scope.academic_year_id, scope.term_id, scope.term_id])
    if (!assignment) throw new HttpError(404, 'Academic finding was not found.')
  }
  const queries = [
    ['mastery', `SELECT public_ref,mastery_score,confidence_score,mastery_status,trend,evidence_count,calculation_explanation_json,last_evidence_at,last_recalculated_at FROM academic_mastery_records WHERE school_id=? AND public_ref=? LIMIT 1`],
    ['alert', `SELECT public_ref,alert_type,severity,title,message,evidence_json,status,created_at,updated_at FROM academic_alerts WHERE school_id=? AND public_ref=? LIMIT 1`],
    ['recommendation', `SELECT public_ref,title,reason,evidence_json,suggested_action,priority,confidence_score,status,due_at,created_at,updated_at FROM academic_recommendations WHERE school_id=? AND public_ref=? LIMIT 1`],
    ['readiness', `SELECT public_ref,readiness_score,confidence_score,factors_json,risks_json,missing_data_json,recommendations_json,calculated_at FROM exam_readiness_snapshots WHERE school_id=? AND public_ref=? LIMIT 1`],
  ]
  for (const [type, sql] of queries) {
    const [[row]] = await pool.query(sql, [schoolId, ref])
    if (!row) continue
    const parsed = {
      ...row,
      calculation_explanation: jsonValue(row.calculation_explanation_json, null),
      evidence: jsonValue(row.evidence_json, null),
      factors: jsonValue(row.factors_json, null),
      risks: jsonValue(row.risks_json, null),
      missing_data: jsonValue(row.missing_data_json, null),
      recommendations: jsonValue(row.recommendations_json, null),
    }
    for (const key of ['calculation_explanation_json', 'evidence_json', 'factors_json', 'risks_json', 'missing_data_json', 'recommendations_json']) delete parsed[key]
    return {
      finding: { type, ...parsed },
      explanation: {
        metric_definition: type === 'mastery' ? 'Evidence-weighted achievement on the selected mastery scope.' : type === 'readiness' ? 'Configured decision-support readiness signal, not a predicted examination mark.' : 'Validated academic workflow finding.',
        labels: ['Calculated', type === 'alert' || type === 'recommendation' ? 'Rule-based' : 'Evidence-based'],
        formula_version: parsed.calculation_explanation?.formula_version || parsed.calculation_explanation?.formula || 'academic-intelligence-v1',
        generated_at: parsed.last_recalculated_at || parsed.calculated_at || parsed.created_at,
        ai_involvement: 'AI does not calculate or mutate this finding. It may only explain it after validation.',
      },
    }
  }
  throw new HttpError(404, 'Academic finding was not found.')
}

export async function queueAcademicRecalculation(schoolId, actor, body = {}) {
  const calculationType = String(body.calculation_type || body.type || 'reconciliation')
  const allowed = new Set(['mastery', 'class_mastery', 'pacing', 'readiness', 'question_analytics', 'recommendations', 'reconciliation'])
  if (!allowed.has(calculationType)) throw new HttpError(400, 'Unsupported academic calculation type.')
  const triggerType = String(body.trigger_type || 'manual')
  const entityType = body.entity_type ? String(body.entity_type) : null
  const inputSummary = { scope: body.scope || {}, entity_ref: body.entity_ref || null, requested_by: actor?.id || null }
  const [[existing]] = await pool.query(
    `SELECT public_ref,status FROM academic_calculation_runs
     WHERE school_id=? AND calculation_type=? AND trigger_type=? AND status IN ('queued','running')
       AND JSON_UNQUOTE(JSON_EXTRACT(input_summary_json,'$.entity_ref')) <=> ?
     ORDER BY id DESC LIMIT 1`,
    [schoolId, calculationType, triggerType, body.entity_ref ? String(body.entity_ref) : null],
  )
  if (existing) return { queued: false, duplicate: true, run: existing }
  const ref = randomUUID()
  await pool.query(
    `INSERT INTO academic_calculation_runs (public_ref,school_id,calculation_type,trigger_type,trigger_entity_type,status,input_summary_json)
     VALUES (?,?,?,?,?,'queued',?)`,
    [ref, schoolId, calculationType, triggerType, entityType, JSON.stringify(inputSummary)],
  )
  await audit(pool, schoolId, actor, 'ACADEMIC_RECALCULATION_QUEUED', 'academic_calculation_run', null, null, { public_ref: ref, calculation_type: calculationType, trigger_type: triggerType, scope: inputSummary.scope })
  return { queued: true, duplicate: false, run: { public_ref: ref, calculation_type: calculationType, trigger_type: triggerType, status: 'queued' } }
}

export async function recordAcademicIntelligenceSnapshot({ schoolId, academicYearId = null, termId = null, scopeType = 'school', scopeRef = null, metricKey, metricValue = null, confidenceScore = null, evidenceState = 'insufficient', reason = null, evidenceSummary = {}, formulaVersion = 'academic-intelligence-v1' } = {}) {
  if (!schoolId || !metricKey) return { recorded: false, reason: 'scope_and_metric_required' }
  const [[previous]] = await pool.query(
    `SELECT metric_value,evidence_state,confidence_score FROM academic_intelligence_snapshots
     WHERE school_id=? AND scope_type=? AND scope_ref <=> ? AND metric_key=? ORDER BY created_at DESC LIMIT 1`,
    [schoolId, scopeType, scopeRef, metricKey],
  )
  const changedBy = previous && metricValue !== null && previous.metric_value !== null ? Math.abs(Number(metricValue) - Number(previous.metric_value)) >= 3 : true
  const stateChanged = !previous || String(previous.evidence_state) !== String(evidenceState)
  if (!changedBy && !stateChanged) return { recorded: false, reason: 'not_meaningful_change' }
  const ref = randomUUID()
  await pool.query(
    `INSERT INTO academic_intelligence_snapshots (public_ref,school_id,academic_year_id,term_id,scope_type,scope_ref,metric_key,metric_value,confidence_score,evidence_state,reason,evidence_summary_json,formula_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ref, schoolId, academicYearId, termId, scopeType, scopeRef, metricKey, metricValue, confidenceScore, evidenceState, reason, JSON.stringify(evidenceSummary || {}), formulaVersion],
  )
  return { recorded: true, public_ref: ref }
}

export async function updateCurriculumLifecycle(schoolId, publicRef, actor, body = {}) {
  const allowed = new Set(['NOT_STARTED','PLANNED','IN_PROGRESS','TAUGHT','ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION','DELAYED','SKIPPED'])
  const nextStatus = String(body.lifecycle_status || '').toUpperCase()
  if (!allowed.has(nextStatus)) throw new HttpError(400, "Curriculum lifecycle status is invalid")
  if (nextStatus === 'MASTERED' && !body.override_reason) {
    const [[record]] = await pool.query("SELECT class_mastery_score,mastery_confidence_score FROM curriculum_delivery_records WHERE school_id=? AND public_ref=?", [schoolId, publicRef])
    const config = await getAcademicEngineConfig(schoolId)
    if (!record || Number(record.class_mastery_score || 0) < Number(config.mastery_threshold) || Number(record.mastery_confidence_score || 0) < 35) {
      throw new HttpError(409, "Mastery needs sufficient assessment evidence. Add an authorised override reason to continue.")
    }
  }
  const [[before]] = await pool.query("SELECT * FROM curriculum_delivery_records WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, publicRef])
  if (!before) throw new HttpError(404, "Curriculum delivery record was not found")
  await pool.query(
    `UPDATE curriculum_delivery_records SET lifecycle_status=?,revision_required=?,delay_reason=?,skipped_reason=?,
      manually_overridden=?,override_author_id=?,override_reason=?,last_recalculated_at=CURRENT_TIMESTAMP
     WHERE school_id=? AND public_ref=?`,
    [nextStatus, body.revision_required ? 1 : 0, body.delay_reason || null, body.skipped_reason || null,
      body.override_reason ? 1 : 0, body.override_reason ? actor.id : null, body.override_reason || null, schoolId, publicRef],
  )
  await audit(pool, schoolId, actor, "CURRICULUM_LIFECYCLE_UPDATED", "curriculum_delivery_record", before.id, { lifecycle_status: before.lifecycle_status }, { lifecycle_status: nextStatus, override_reason: body.override_reason || null })
  return { public_ref: publicRef, lifecycle_status: nextStatus }
}

export async function createIntervention(schoolId, actor, body = {}) {
  if (!String(body.issue || '').trim() || !String(body.action_plan || '').trim()) throw new HttpError(400, "Subject, issue and action plan are required")
  const activeSession = await requireActiveAcademicSession(schoolId, pool)
  const requestedTermId = suppliedScopeId(body.term_id, 'Term') || activeSession.termId
  if (Number(requestedTermId) !== Number(activeSession.termId)) throw new HttpError(409, 'Academic interventions can only be created in the current open term.')
  const scope = await validateAcademicInterventionScope(pool, schoolId, { ...body, term_id: requestedTermId })
  const actorScope = await assertAcademicActorWriteScope(pool, schoolId, actor, scope)
  const interventionType = body.intervention_type || 'individual_remediation'
  const priority = body.priority || 'medium'
  const parentNotificationStatus = body.parent_notification_status || 'not_required'
  const status = body.status || 'draft'
  if (!['individual_remediation','small_group_support','whole_class_revision','attendance_intervention','prerequisite_recovery','enrichment','teacher_coaching','assessment_correction'].includes(interventionType)) throw new HttpError(400, "Intervention type is invalid")
  if (!['low','medium','high','urgent'].includes(priority)) throw new HttpError(400, "Intervention priority is invalid")
  if (!['not_required','pending','approved','sent'].includes(parentNotificationStatus)) throw new HttpError(400, "Parent notification status is invalid")
  if (!['draft','active','review_due','completed','cancelled'].includes(status)) throw new HttpError(400, "Intervention status is invalid")
  const ref = randomUUID()
  await pool.query(
    `INSERT INTO academic_interventions (public_ref,school_id,student_id,class_id,subject_id,topic_id,term_id,intervention_type,
      issue,evidence_json,assigned_teacher_id,priority,start_date,review_date,action_plan,parent_notification_status,status,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ref, schoolId, scope.studentId, scope.classId, scope.subjectId, scope.topicId,
      scope.termId,
      interventionType, String(body.issue).trim(), JSON.stringify(body.evidence || {}),
      actorScope.assignedTeacherId, priority, body.start_date || new Date().toISOString().slice(0,10),
      body.review_date || null, String(body.action_plan).trim(), parentNotificationStatus, status, actor.id],
  )
  const [[row]] = await pool.query("SELECT id,public_ref,intervention_type,issue,priority,status,start_date,review_date FROM academic_interventions WHERE school_id=? AND public_ref=?", [schoolId, ref])
  await audit(pool, schoolId, actor, "ACADEMIC_INTERVENTION_CREATED", "academic_intervention", row.id, null, row)
  delete row.id
  return row
}

export async function patchIntervention(schoolId, publicRef, actor, body = {}) {
  const [[before]] = await pool.query("SELECT * FROM academic_interventions WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, publicRef])
  if (!before) throw new HttpError(404, "Intervention was not found")
  await assertAcademicActorWriteScope(pool, schoolId, actor, {
    classId: before.class_id,
    subjectId: before.subject_id,
    termId: before.term_id,
    teacherId: null,
  })
  const status = body.status || before.status
  const outcome = body.outcome || before.outcome
  if (!['draft','active','review_due','completed','cancelled'].includes(status)) throw new HttpError(400, "Intervention status is invalid")
  if (!['pending','improved','unchanged','declined','inconclusive'].includes(outcome)) throw new HttpError(400, "Intervention outcome is invalid")
  await pool.query(
    `UPDATE academic_interventions SET status=?,outcome=?,review_date=COALESCE(?,review_date),action_plan=COALESCE(?,action_plan),
      reassessment_summary_json=COALESCE(?,reassessment_summary_json),completed_by=CASE WHEN ?='completed' THEN ? ELSE completed_by END,
      completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE school_id=? AND public_ref=?`,
    [status, outcome, body.review_date || null, body.action_plan || null, body.reassessment_summary ? JSON.stringify(body.reassessment_summary) : null,
      status, actor.id, status, schoolId, publicRef],
  )
  if (body.note) await pool.query(
    "INSERT INTO academic_intervention_updates (public_ref,school_id,intervention_id,update_type,note,evidence_json,created_by) VALUES (UUID(),?,?,?,?,?,?)",
    [schoolId, before.id, body.update_type || 'note', String(body.note), body.evidence ? JSON.stringify(body.evidence) : null, actor.id],
  )
  await audit(pool, schoolId, actor, "ACADEMIC_INTERVENTION_UPDATED", "academic_intervention", before.id, { status: before.status, outcome: before.outcome }, { status, outcome })
  return { public_ref: publicRef, status, outcome }
}

export async function getAcademicAuthoringSetup(schoolId, actor) {
  const teacher = String(actor?.role || '').toLowerCase() === 'teacher'
  const assignmentJoin = teacher ? `JOIN teacher_class_subject_assignments a ON a.school_id=c.school_id AND a.class_id=c.id AND a.subject_id=s.id AND a.teacher_id=? AND a.role='subject_teacher' AND a.is_active=1
    JOIN academic_years current_year ON current_year.school_id=a.school_id AND current_year.is_active=1 AND current_year.status<>'archived' AND a.academic_year_id=current_year.id
    JOIN terms current_term ON current_term.school_id=current_year.school_id AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking') AND a.term_id=current_term.id` : ""
  const params = teacher ? [actor.id, schoolId] : [schoolId]
  const [pairs] = await pool.query(`SELECT DISTINCT c.public_ref class_ref,c.name class_name,c.grade_level,s.public_ref subject_ref,s.name subject_name
    FROM classes c JOIN subjects s ON s.school_id=c.school_id ${assignmentJoin}
    WHERE c.school_id=? ORDER BY c.name,s.name`, params)
  const [topics] = await pool.query(`SELECT st.public_ref,st.topic_name,st.description,st.order_number,
      parent.public_ref parent_ref,parent.topic_name parent_name,s.public_ref subject_ref,gl.name grade_name
    FROM syllabus_topics st JOIN subjects s ON s.id=st.subject_id AND s.school_id=st.school_id
    LEFT JOIN syllabus_topics parent ON parent.id=st.parent_topic_id AND parent.school_id=st.school_id
    LEFT JOIN grade_levels gl ON gl.id=st.grade_id AND gl.school_id=st.school_id
    WHERE st.school_id=? AND st.is_active=1 ORDER BY s.name,COALESCE(st.order_number,999999),st.topic_name`,[schoolId])
  const topicMap=new Map()
  for(const topic of topics){const key=`${topic.subject_ref}:${topic.grade_name||'*'}`;const list=topicMap.get(key)||[];list.push({public_ref:topic.public_ref,name:topic.topic_name,description:topic.description,parent_ref:topic.parent_ref||null,parent_name:topic.parent_name||null,order_number:topic.order_number});topicMap.set(key,list)}
  const classMap=new Map()
  for(const pair of pairs){
    const current=classMap.get(pair.class_ref)||{public_ref:pair.class_ref,name:pair.class_name,subjects:[]}
    if(!current.subjects.some((item)=>item.public_ref===pair.subject_ref)){
      const exact=topicMap.get(`${pair.subject_ref}:${pair.grade_level}`)||[]
      const generic=topicMap.get(`${pair.subject_ref}:*`)||[]
      const available=[...new Map([...exact,...generic].map((topic)=>[topic.public_ref,topic])).values()]
      const availableByRef=new Map(available.map((topic)=>[topic.public_ref,topic]))
      const childrenByParent=new Map()
      for(const topic of available){if(!topic.parent_ref||!availableByRef.has(topic.parent_ref))continue;const children=childrenByParent.get(topic.parent_ref)||[];children.push(topic);childrenByParent.set(topic.parent_ref,children)}
      const buildTopic=(topic)=>({...topic,subtopics:(childrenByParent.get(topic.public_ref)||[]).map(buildTopic)})
      const roots=available.filter((topic)=>!topic.parent_ref||!availableByRef.has(topic.parent_ref)).map(buildTopic)
      current.subjects.push({public_ref:pair.subject_ref,name:pair.subject_name,topics:roots})
    }
    classMap.set(pair.class_ref,current)
  }
  return {classes:[...classMap.values()]}
}

export async function createAssessmentBlueprint(schoolId,actor,body={}){
  let classId=Number(body.class_id||0),subjectId=Number(body.subject_id||0)
  if(!classId&&body.class_ref)classId=Number(await scopedIdByRef('classes',schoolId,body.class_ref)||0)
  if(!subjectId&&body.subject_ref)subjectId=Number(await scopedIdByRef('subjects',schoolId,body.subject_ref)||0)
  if(!classId||!subjectId)throw new HttpError(400,'Class and subject are required.')
  const activeSession=await requireActiveAcademicSession(schoolId,pool)
  const requestedTermId=suppliedScopeId(body.term_id,'Term')||activeSession.termId
  const scope=await validateAcademicInterventionScope(pool,schoolId,{class_id:classId,subject_id:subjectId,term_id:requestedTermId})
  const academicYearId=suppliedScopeId(body.academic_year_id,'Academic year')||scope.term?.academic_year_id||activeSession.academicYearId
  if(Number(academicYearId)!==Number(activeSession.academicYearId)||Number(scope.termId)!==Number(activeSession.termId))throw new HttpError(409,'Assessment blueprints can only be created in the current open academic session.')
  if(academicYearId){const academicYear=await firstScopeRow(pool,"SELECT id FROM academic_years WHERE school_id=? AND id=? LIMIT 1",[schoolId,academicYearId]);if(!academicYear)throw new HttpError(400,'The selected academic year does not belong to this school.');if(scope.term?.academic_year_id&&Number(scope.term.academic_year_id)!==academicYearId)throw new HttpError(400,'The selected term does not belong to the selected academic year.')}
  await assertAcademicActorWriteScope(pool,schoolId,actor,{...scope,academicYearId,teacherId:null})
  const inputTopics=Array.isArray(body.topics)?body.topics:[]
  const topics=[]
  for(const item of inputTopics){let topicId=Number(item.topic_id||0);if(!topicId&&item.topic_ref)topicId=Number(await scopedIdByRef('syllabus_topics',schoolId,item.topic_ref)||0);if(!topicId)throw new HttpError(400,'One blueprint topic reference is invalid.');topics.push({...item,topic_id:topicId})}
  const normalized={...body,class_id:classId,subject_id:subjectId,topics}
  const validation=validateAssessmentBlueprintInput(normalized)
  if(!validation.valid)throw new HttpError(400,'Assessment blueprint is not valid.',{details:{errors:validation.errors,warnings:validation.warnings}})
  const topicIds=topics.map((item)=>Number(item.topic_id||0)).filter(Boolean)
  if(topicIds.length){const [rows]=await pool.query(`SELECT topic.id FROM syllabus_topics topic LEFT JOIN grade_levels grade ON grade.school_id=topic.school_id AND grade.id=topic.grade_id WHERE topic.school_id=? AND topic.subject_id=? AND topic.id IN (${topicIds.map(()=>'?').join(',')}) AND (topic.grade_id IS NULL OR LOWER(TRIM(grade.name))=LOWER(TRIM(?)))`,[schoolId,subjectId,...topicIds,scope.class?.grade_level||'']);if(rows.length!==new Set(topicIds).size)throw new HttpError(400,'One or more blueprint topics do not belong to this school, subject and class year level.')}
  if(body.taught_topic_restriction!==false&&topicIds.length){const [untaught]=await pool.query(`SELECT st.topic_name FROM syllabus_topics st LEFT JOIN curriculum_delivery_records cdr ON cdr.school_id=st.school_id AND cdr.topic_id=st.id AND cdr.class_id=? AND cdr.subject_id=? AND cdr.lifecycle_status IN ('TAUGHT','ASSESSED','PARTIALLY_MASTERED','MASTERED','REQUIRES_REVISION') WHERE st.school_id=? AND st.id IN (${topicIds.map(()=>'?').join(',')}) AND cdr.id IS NULL`,[classId,subjectId,schoolId,...topicIds]);if(untaught.length)validation.warnings.push(`Untaught topics included: ${untaught.map((row)=>row.topic_name).join(', ')}.`)}
  const ref=randomUUID();await pool.query(`INSERT INTO assessment_blueprints (public_ref,school_id,academic_year_id,term_id,class_id,stream_section,subject_id,title,total_marks,duration_minutes,topics_json,difficulty_distribution_json,cognitive_distribution_json,question_types_json,section_configuration_json,taught_topic_restriction,mastery_focused,examination_board_style,validation_warnings_json,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[ref,schoolId,academicYearId,scope.termId,classId,body.stream_section||null,subjectId,String(body.title||'Assessment blueprint').trim(),validation.summary.total_marks,validation.summary.duration_minutes,JSON.stringify(topics),JSON.stringify(body.difficulty_distribution||{}),JSON.stringify(body.cognitive_distribution||{}),JSON.stringify(body.question_types||[]),JSON.stringify(body.section_configuration||{}),body.taught_topic_restriction===false?0:1,body.mastery_focused?1:0,body.examination_board_style||null,JSON.stringify(validation.warnings),'validated',actor.id]);const [[row]]=await pool.query("SELECT id,public_ref,title,total_marks,duration_minutes,status,validation_warnings_json,created_at FROM assessment_blueprints WHERE school_id=? AND public_ref=?",[schoolId,ref]);await audit(pool,schoolId,actor,'ASSESSMENT_BLUEPRINT_CREATED','assessment_blueprint',row.id,null,{public_ref:ref,title:row.title,warnings:validation.warnings});delete row.id;return {...row,validation_warnings:jsonValue(row.validation_warnings_json,[]),validation_warnings_json:undefined}
}

export async function listAssessmentBlueprints(schoolId,actor,query={}){const params=[schoolId];let clause='';if(String(actor?.role||'').toLowerCase()==='teacher'){clause+=` AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa JOIN academic_years current_year ON current_year.school_id=tcsa.school_id AND current_year.is_active=1 AND current_year.status<>'archived' JOIN terms current_term ON current_term.school_id=current_year.school_id AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking') WHERE tcsa.school_id=ab.school_id AND tcsa.teacher_id=? AND tcsa.class_id=ab.class_id AND tcsa.subject_id=ab.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1 AND tcsa.academic_year_id=current_year.id AND tcsa.term_id=current_term.id AND ab.academic_year_id=current_year.id AND ab.term_id=current_term.id)`;params.push(Number(actor.id))}if(query.class_id){clause+=' AND ab.class_id=?';params.push(Number(query.class_id))}if(query.subject_id){clause+=' AND ab.subject_id=?';params.push(Number(query.subject_id))}const [rows]=await pool.query(`SELECT ab.public_ref,ab.title,ab.total_marks,ab.duration_minutes,ab.mastery_focused,ab.examination_board_style,ab.validation_warnings_json,ab.status,ab.created_at,c.name class_name,s.name subject_name,u.full_name created_by_name FROM assessment_blueprints ab JOIN classes c ON c.id=ab.class_id AND c.school_id=ab.school_id JOIN subjects s ON s.id=ab.subject_id AND s.school_id=ab.school_id JOIN users u ON u.id=ab.created_by AND u.school_id=ab.school_id WHERE ab.school_id=?${clause} ORDER BY ab.created_at DESC LIMIT 100`,params);return {blueprints:rows.map((row)=>({...row,validation_warnings:jsonValue(row.validation_warnings_json,[]),validation_warnings_json:undefined}))}}

export async function createRemediationPack(schoolId,actor,body={}){
  const title=String(body.title||'Remediation pack').trim()
  const generationSource=body.generation_source||'teacher'
  if(generationSource==='ai_draft'&&!body.ai_metadata)throw new HttpError(400,'AI-generated drafts must record model, prompt version, generation date and source evidence.')
  const scope=await validateRemediationPackScope(pool,schoolId,body)
  await assertAcademicActorWriteScope(pool,schoolId,actor,{...scope,teacherId:null})
  const ref=randomUUID()
  const approvalStatus=generationSource==='ai_draft'?'pending_teacher_review':body.approval_status||'draft'
  await pool.query(`INSERT INTO remediation_packs (public_ref,school_id,recommendation_id,intervention_id,student_id,class_id,subject_id,topic_id,title,prerequisite_review_json,explanation_text,worked_examples_json,guided_practice_json,independent_practice_json,exit_ticket_json,marking_guide_json,teacher_strategy,parent_summary,generation_source,ai_metadata_json,approval_status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[ref,schoolId,scope.recommendationId,scope.interventionId,scope.studentId,scope.classId,scope.subjectId,scope.topicId,title,JSON.stringify(body.prerequisite_review||[]),body.explanation_text||null,JSON.stringify(body.worked_examples||[]),JSON.stringify(body.guided_practice||[]),JSON.stringify(body.independent_practice||[]),JSON.stringify(body.exit_ticket||[]),JSON.stringify(body.marking_guide||[]),body.teacher_strategy||null,body.parent_summary||null,generationSource,body.ai_metadata?JSON.stringify(body.ai_metadata):null,approvalStatus,actor.id])
  const [[row]]=await pool.query("SELECT id,public_ref,title,generation_source,approval_status,created_at FROM remediation_packs WHERE school_id=? AND public_ref=?",[schoolId,ref])
  await audit(pool,schoolId,actor,'REMEDIATION_PACK_CREATED','remediation_pack',row.id,null,row)
  delete row.id
  return row
}

export async function listRemediationPacks(schoolId,actor,query={}){const params=[schoolId];let clause='';if(String(actor?.role||'').toLowerCase()==='teacher'){clause+=` AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa JOIN academic_years current_year ON current_year.school_id=tcsa.school_id AND current_year.is_active=1 AND current_year.status<>'archived' JOIN terms current_term ON current_term.school_id=current_year.school_id AND current_term.academic_year_id=current_year.id AND current_term.status IN ('open','marking') WHERE tcsa.school_id=rp.school_id AND tcsa.teacher_id=? AND tcsa.class_id=rp.class_id AND tcsa.subject_id=rp.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1 AND tcsa.academic_year_id=current_year.id AND tcsa.term_id=current_term.id)`;params.push(Number(actor.id))}if(query.student_id){clause+=' AND rp.student_id=?';params.push(Number(query.student_id))}if(query.class_id){clause+=' AND rp.class_id=?';params.push(Number(query.class_id))}if(query.status){clause+=' AND rp.approval_status=?';params.push(query.status)}const [rows]=await pool.query(`SELECT rp.public_ref,rp.title,rp.generation_source,rp.approval_status,rp.created_at,s.name subject_name,t.topic_name,c.name class_name,CONCAT(st.first_name,' ',st.last_name) student_name,u.full_name created_by_name FROM remediation_packs rp JOIN subjects s ON s.id=rp.subject_id AND s.school_id=rp.school_id LEFT JOIN syllabus_topics t ON t.id=rp.topic_id AND t.school_id=rp.school_id LEFT JOIN classes c ON c.id=rp.class_id AND c.school_id=rp.school_id LEFT JOIN students st ON st.id=rp.student_id AND st.school_id=rp.school_id JOIN users u ON u.id=rp.created_by AND u.school_id=rp.school_id WHERE rp.school_id=?${clause} ORDER BY rp.created_at DESC LIMIT 100`,params);return {remediation_packs:rows}}

export async function patchRemediationPack(schoolId,ref,actor,body={}){const [[pack]]=await pool.query("SELECT * FROM remediation_packs WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,ref]);if(!pack)throw new HttpError(404,'Remediation pack was not found.');await assertAcademicActorWriteScope(pool,schoolId,actor,{classId:pack.class_id,subjectId:pack.subject_id,teacherId:null});const status=body.approval_status||pack.approval_status;if(!['draft','pending_teacher_review','approved','rejected','archived'].includes(status))throw new HttpError(400,'Remediation approval status is invalid.');await pool.query(`UPDATE remediation_packs SET title=COALESCE(?,title),explanation_text=COALESCE(?,explanation_text),worked_examples_json=COALESCE(?,worked_examples_json),guided_practice_json=COALESCE(?,guided_practice_json),independent_practice_json=COALESCE(?,independent_practice_json),exit_ticket_json=COALESCE(?,exit_ticket_json),marking_guide_json=COALESCE(?,marking_guide_json),teacher_strategy=COALESCE(?,teacher_strategy),parent_summary=COALESCE(?,parent_summary),approval_status=?,reviewed_by=CASE WHEN ? IN ('approved','rejected') THEN ? ELSE reviewed_by END,reviewed_at=CASE WHEN ? IN ('approved','rejected') THEN CURRENT_TIMESTAMP ELSE reviewed_at END WHERE school_id=? AND public_ref=?`,[body.title||null,body.explanation_text||null,body.worked_examples?JSON.stringify(body.worked_examples):null,body.guided_practice?JSON.stringify(body.guided_practice):null,body.independent_practice?JSON.stringify(body.independent_practice):null,body.exit_ticket?JSON.stringify(body.exit_ticket):null,body.marking_guide?JSON.stringify(body.marking_guide):null,body.teacher_strategy||null,body.parent_summary||null,status,status,actor.id,status,schoolId,ref]);await audit(pool,schoolId,actor,'REMEDIATION_PACK_UPDATED','remediation_pack',pack.id,{status:pack.approval_status},{status});return {public_ref:ref,approval_status:status}}

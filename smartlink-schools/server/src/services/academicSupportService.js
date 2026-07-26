import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { createInAppNotification } from "./operationalCommunicationService.js"
import { createTargetedAssessmentDraft } from "./academicOperationsService.js"
import { validateSyllabusTopicScope } from "./curriculumScopeService.js"

export const DEFAULT_ESCALATION_POLICY = Object.freeze({
  firstWeakEvidenceAction: "teacher_follow_up",
  comparableFailureCountForIntervention: 2,
  unsuccessfulCyclesForStrategyReview: 1,
  unsuccessfulCyclesForAcademicReview: 2,
  minimumConfidenceForEscalation: 65,
  minimumSupportDeliveryRate: 80,
  minimumSupportAttendanceRate: 70,
  reviewWithinSchoolDays: 5,
  masteryThreshold: 70,
  minimumMappedMarks: 5,
  maximumComparableEvidenceDays: 120,
  reassessmentRequired: true,
  wholeClassAffectedRate: 60,
  subgroupAffectedRate: 20,
  resolutionComparableEvidenceCount: 2,
  sustainedResolutionDays: 14,
})

const ACTIVE_CASE_STATUSES = new Set([
  "detected", "teacher_follow_up", "intervention_active", "reassessment_pending",
  "strategy_review", "academic_team_review", "guardian_review", "continued_support",
])
const LEARNER_SUPPORT_LEADERSHIP_ROLES = new Set(["super_admin", "school_owner", "owner", "director", "headteacher"])
const PRECISION_FAMILY = Object.freeze({ question: "mapped", section: "mapped", topic: "mapped", overall: "overall", limited: "limited" })
const STRATEGY_SEQUENCE = Object.freeze([
  "guided_practice", "visual_concrete_materials", "prerequisite_reteaching", "small_group_instruction",
  "worked_examples", "oral_diagnostic", "untimed_practice", "spaced_retrieval", "peer_supported_practice",
  "practical_task", "timed_practice", "written_diagnostic", "direct_reteaching", "homework_reinforcement",
])

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
let supportSchemaCache = null
let supportSchemaCheckedAt = 0
async function supportSchemaCapabilities(db = pool) {
  if (supportSchemaCache && Date.now() - supportSchemaCheckedAt < 30_000) return supportSchemaCache
  const [columns] = await db.query(`SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name FROM information_schema.columns
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('learner_support_case_assignments','learner_support_case_notes','intervention_sessions','academic_intervention_reassessments')`)
  const available = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`))
  const hasColumns = (table, required) => required.every((column) => available.has(`${table}.${column}`))
  supportSchemaCache = {
    assignments: hasColumns("learner_support_case_assignments", ["id", "school_id", "case_id", "assigned_user_id", "assignment_type", "assignment_status", "action_label", "due_at", "acknowledged_at", "completed_at", "assigned_by", "created_at"]),
    notes: hasColumns("learner_support_case_notes", ["id", "school_id", "case_id", "term_id", "author_user_id", "visibility", "note_text", "status", "created_at"]),
    sessionDetails: hasColumns("intervention_sessions", ["duration_minutes", "delivery_method", "target_topic_id", "target_objective_id", "teacher_observation", "next_action"]),
    reassessmentDueAt: available.has("academic_intervention_reassessments.due_at"),
  }
  supportSchemaCheckedAt = Date.now()
  return supportSchemaCache
}
const SUPPORT_SCHEMA_CAPABILITY_LABELS = Object.freeze({
  assignments: "case assignments",
  notes: "academic case notes",
  sessionDetails: "detailed support sessions",
  reassessmentDueAt: "scheduled reassessments",
})
async function requireSupportSchemaCapability(db, capability) {
  const capabilities = await supportSchemaCapabilities(db)
  if (capabilities[capability]) return capabilities
  throw new HttpError(503, `Learner-support ${SUPPORT_SCHEMA_CAPABILITY_LABELS[capability] || "features"} are temporarily unavailable while this school's database upgrade is completed.`, {
    code: "LEARNER_SUPPORT_SCHEMA_UPGRADE_REQUIRED",
    details: { required_migration: "062_teacher_learner_support_access.sql", capability },
    expose: true,
  })
}
async function optionalRows(db, sql, params = []) {
  try { return (await db.query(sql, params))[0] }
  catch (error) { if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return []; throw error }
}
const json = (value, fallback = {}) => {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value)) } catch { return fallback }
}
const dateOnly = (value = new Date()) => new Date(value).toISOString().slice(0, 10)
const addDays = (days) => dateOnly(Date.now() + number(days, 5) * 86_400_000)
const evidenceConfidence = (item = {}) => {
  const precision = String(item.evidence_precision || "limited")
  const base = precision === "question" ? 78 : precision === "section" ? 72 : precision === "topic" ? 62 : precision === "overall" ? 25 : 20
  const markBonus = Math.min(17, Math.max(0, number(item.marks_available)) / 2)
  return Math.min(95, Number((base + markBonus).toFixed(2)))
}

export function normalizeEscalationPolicy(value = {}) {
  const supplied = json(value, {})
  const policy = { ...DEFAULT_ESCALATION_POLICY, ...supplied }
  for (const key of Object.keys(DEFAULT_ESCALATION_POLICY)) {
    if (typeof DEFAULT_ESCALATION_POLICY[key] === "number") policy[key] = number(policy[key], DEFAULT_ESCALATION_POLICY[key])
  }
  policy.reassessmentRequired = policy.reassessmentRequired !== false
  return policy
}

export function compareAcademicEvidence(baseline = {}, candidate = {}, policyInput = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  const reasons = []
  const validStatus = (item) => String(item.evidence_status || item.status || "valid") === "valid"
  const published = (item) => ["published", "locked", "approved", "moderated"].includes(String(item.publication_state || "published"))
  if (!validStatus(baseline) || !validStatus(candidate)) reasons.push("evidence_status")
  if (!published(baseline) || !published(candidate)) reasons.push("publication_state")
  if (!baseline.topic_id || number(baseline.topic_id) !== number(candidate.topic_id)) reasons.push("topic")
  if (baseline.objective_id && candidate.objective_id && number(baseline.objective_id) !== number(candidate.objective_id)) reasons.push("objective")
  const basePrecision = String(baseline.evidence_precision || "limited")
  const nextPrecision = String(candidate.evidence_precision || "limited")
  if (PRECISION_FAMILY[basePrecision] !== PRECISION_FAMILY[nextPrecision] || PRECISION_FAMILY[basePrecision] !== "mapped") reasons.push("precision")
  if (number(baseline.marks_available) < policy.minimumMappedMarks || number(candidate.marks_available) < policy.minimumMappedMarks) reasons.push("mapped_marks")
  const baseDifficulty = baseline.difficulty === null || baseline.difficulty === undefined ? null : number(baseline.difficulty)
  const nextDifficulty = candidate.difficulty === null || candidate.difficulty === undefined ? null : number(candidate.difficulty)
  if (baseDifficulty !== null && nextDifficulty !== null && Math.abs(baseDifficulty - nextDifficulty) > 1) reasons.push("difficulty")
  const baseFormat = String(baseline.assessment_format || baseline.format || "").trim()
  const nextFormat = String(candidate.assessment_format || candidate.format || "").trim()
  if (baseFormat && nextFormat && baseFormat !== nextFormat) reasons.push("format")
  const baseAt = new Date(baseline.observed_at || baseline.recorded_at || baseline.evidence_at || 0).getTime()
  const nextAt = new Date(candidate.observed_at || candidate.recorded_at || candidate.evidence_at || 0).getTime()
  const intervalDays = baseAt && nextAt ? Math.abs(nextAt - baseAt) / 86_400_000 : null
  if (baseAt && nextAt && nextAt <= baseAt) reasons.push("chronology")
  if (intervalDays !== null && intervalDays > policy.maximumComparableEvidenceDays) reasons.push("interval")
  return { comparable: reasons.length === 0, reasons, interval_days: intervalDays === null ? null : Number(intervalDays.toFixed(1)) }
}

export function deriveSupportEvidenceReconciliation(caseRecord = {}, evidenceSummary = {}, policyInput = {}, options = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  const validEvidenceCount = Math.max(0, number(evidenceSummary.validEvidenceCount))
  const failureCount = Math.max(0, number(evidenceSummary.failureCount))
  const confidence = Math.max(0, number(evidenceSummary.confidence))
  const currentStatus = String(caseRecord.status || "detected")
  const immutableTerminal = ["resolved", "transferred"].includes(currentStatus)
  if (!validEvidenceCount) {
    if (immutableTerminal) {
      return { status: currentStatus, level: number(caseRecord.escalation_level), failureCount: 0, confidence: 0, closeCase: false, reopenCase: false }
    }
    return { status: "closed_inconclusive", level: 0, failureCount: 0, confidence: 0, closeCase: true, reopenCase: false }
  }

  const firstEvidenceStatus = confidence >= policy.minimumConfidenceForEscalation
    ? String(policy.firstWeakEvidenceAction || "teacher_follow_up")
    : "detected"
  const fallbackStatus = failureCount >= policy.comparableFailureCountForIntervention ? "teacher_follow_up" : firstEvidenceStatus
  const fallbackLevel = failureCount >= policy.comparableFailureCountForIntervention ? 2 : fallbackStatus === "detected" ? 0 : 1
  const previous = options.previousCaseState || {}
  let status = currentStatus
  let level = number(caseRecord.escalation_level)

  if (currentStatus === "closed_inconclusive") {
    const previousStatus = String(previous.status || "")
    status = ACTIVE_CASE_STATUSES.has(previousStatus) ? previousStatus : fallbackStatus
    level = ACTIVE_CASE_STATUSES.has(previousStatus) ? number(previous.escalationLevel, fallbackLevel) : fallbackLevel
  } else if (!number(caseRecord.intervention_cycle_count) && ["detected", "teacher_follow_up"].includes(currentStatus)) {
    status = fallbackStatus
    level = fallbackLevel
  }
  return { status, level, failureCount, confidence, closeCase: false, reopenCase: ACTIVE_CASE_STATUSES.has(status) }
}

export function classifySupportScope(affectedLearners, classSize, policyInput = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  const affected = Math.max(0, number(affectedLearners))
  const total = Math.max(0, number(classSize))
  const affectedRate = total ? affected / total * 100 : 0
  if (total && affectedRate >= policy.wholeClassAffectedRate) return { scope_type: "class", affected_rate: affectedRate }
  if (affected > 1 && total && affectedRate >= policy.subgroupAffectedRate) return { scope_type: "group", affected_rate: affectedRate }
  return { scope_type: "learner", affected_rate: affectedRate }
}

export function recommendAlternativeStrategy(history = [], available = STRATEGY_SEQUENCE) {
  const used = new Set(history.map((item) => String(item.strategy_code || item)).filter(Boolean))
  const next = available.find((code) => !used.has(code)) || available.find((code) => code !== String(history.at(-1)?.strategy_code || history.at(-1))) || available[0]
  return { strategy_code: next, strategy_repeated: used.has(next), rationale: used.size ? "Try a materially different support approach and review the result." : "Begin with guided, observable support and review the result." }
}

export function evaluateInterventionDelivery(input = {}, policyInput = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  const planned = number(input.plannedSessions)
  const completed = number(input.completedSessions)
  const deliveryRate = planned ? completed / planned * 100 : 0
  const attendanceEligible = number(input.attendanceEligible, completed)
  const attended = number(input.attendedSessions)
  const attendanceRate = attendanceEligible ? attended / attendanceEligible * 100 : 0
  const common = { supportDeliveryRate: Number(deliveryRate.toFixed(2)), learnerAttendanceRate: Number(attendanceRate.toFixed(2)), reassessmentComparable: Boolean(input.reassessmentComparable), strategyRepeated: Boolean(input.strategyRepeated) }
  if (deliveryRate < policy.minimumSupportDeliveryRate) return { ...common, outcome: "incomplete_delivery", classifyLearnerResponse: false, recommendedEscalation: "operational_follow_up" }
  if (attendanceRate < policy.minimumSupportAttendanceRate) return { ...common, outcome: "insufficient_participation", classifyLearnerResponse: false, recommendedEscalation: "participation_follow_up" }
  if (!input.reassessmentPublished) return { ...common, outcome: "awaiting_reassessment", classifyLearnerResponse: false, recommendedEscalation: "schedule_reassessment" }
  if (!input.reassessmentComparable) return { ...common, outcome: "inconclusive", classifyLearnerResponse: false, recommendedEscalation: "comparable_reassessment" }
  const baseline = number(input.baselineScore)
  const reassessment = number(input.reassessmentScore)
  const criterion = number(input.successCriterion, policy.masteryThreshold)
  const improvement = reassessment - baseline
  const improvedComponents = Array.isArray(input.improvedComponents) ? input.improvedComponents : []
  const unchangedComponents = Array.isArray(input.unchangedComponents) ? input.unchangedComponents : []
  if (reassessment >= criterion) return { ...common, outcome: "effective", classifyLearnerResponse: true, improvement: Number(improvement.toFixed(2)), improvedComponents, unchangedComponents, recommendedEscalation: "monitor_resolution" }
  if (improvement >= number(input.minimumMeaningfulChange, 5) || improvedComponents.length) return { ...common, outcome: "partially_effective", classifyLearnerResponse: true, improvement: Number(improvement.toFixed(2)), improvedComponents, unchangedComponents, recommendedEscalation: input.strategyRepeated ? "strategy_review" : "continued_support" }
  return { ...common, outcome: "ineffective", classifyLearnerResponse: true, improvement: Number(improvement.toFixed(2)), improvedComponents, unchangedComponents, recommendedEscalation: "strategy_review" }
}

export function deriveSupportCaseOutcomeTransition(caseRecord = {}, diagnostic = {}, policyInput = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  let status = String(caseRecord.status || "intervention_active")
  let level = number(caseRecord.escalation_level)
  let successfulCycles = number(caseRecord.successful_cycle_count)
  let unsuccessfulCycles = number(caseRecord.unsuccessful_cycle_count)
  const outcome = String(diagnostic.outcome || "inconclusive")

  if (outcome === "effective") {
    successfulCycles += 1
    status = "continued_support"
    level = Math.max(1, level - 1)
  } else if (outcome === "partially_effective") {
    // A partially-effective first strategy is progress that warrants continued
    // support. Repeating that strategy after an earlier weak result is the
    // condition that makes the evaluator recommend a strategy review.
    if (diagnostic.recommendedEscalation === "strategy_review" || diagnostic.strategyRepeated) {
      unsuccessfulCycles += 1
      status = unsuccessfulCycles >= policy.unsuccessfulCyclesForAcademicReview ? "academic_team_review" : "strategy_review"
      level = unsuccessfulCycles >= policy.unsuccessfulCyclesForAcademicReview ? 4 : 3
    } else {
      status = "continued_support"
      level = Math.max(1, level)
    }
  } else if (outcome === "ineffective") {
    unsuccessfulCycles += 1
    status = unsuccessfulCycles >= policy.unsuccessfulCyclesForAcademicReview ? "academic_team_review" : "strategy_review"
    level = unsuccessfulCycles >= policy.unsuccessfulCyclesForAcademicReview ? 4 : 3
  } else if (outcome === "awaiting_reassessment") {
    status = "reassessment_pending"
  }

  return { status, level, successfulCycles, unsuccessfulCycles }
}

export function summarizeOfficialReassessmentEvidence(input = {}, policyInput = {}) {
  const expectedLearnerIds = [...new Set((input.expectedLearnerIds || []).map(number).filter(Boolean))]
  const byLearner = (rows = []) => new Map(rows.map((row) => [number(row.student_id), row]).filter(([studentId]) => studentId))
  const baselineByLearner = byLearner(input.baselineRows)
  const reassessmentByLearner = byLearner(input.reassessmentRows)
  const learners = expectedLearnerIds.length
    ? expectedLearnerIds
    : [...new Set([...baselineByLearner.keys(), ...reassessmentByLearner.keys()])]
  const comparisons = []
  let baselineAwarded = 0; let baselineAvailable = 0
  let reassessmentAwarded = 0; let reassessmentAvailable = 0
  const improvedComponents = []; const unchangedComponents = []
  const minimumMeaningfulChange = number(input.minimumMeaningfulChange, 5)

  for (const studentId of learners) {
    const baseline = baselineByLearner.get(studentId)
    const candidate = reassessmentByLearner.get(studentId)
    if (!baseline || !candidate) {
      comparisons.push({ student_id: studentId, comparable: false, reasons: [!baseline ? "baseline_missing" : "reassessment_missing"] })
      continue
    }
    const comparison = compareAcademicEvidence(baseline, candidate, policyInput)
    const baselineScore = baseline.score_percentage === null || baseline.score_percentage === undefined ? null : Number(baseline.score_percentage)
    const reassessmentScore = candidate.score_percentage === null || candidate.score_percentage === undefined ? null : Number(candidate.score_percentage)
    if (!Number.isFinite(baselineScore) || !Number.isFinite(reassessmentScore)) {
      comparison.comparable = false
      comparison.reasons = [...new Set([...(comparison.reasons || []), "score_missing"])]
    }
    comparisons.push({ student_id: studentId, observed_at: candidate.observed_at || null, ...comparison })
    if (!comparison.comparable) continue
    baselineAwarded += number(baseline.marks_awarded)
    baselineAvailable += number(baseline.marks_available)
    reassessmentAwarded += number(candidate.marks_awarded)
    reassessmentAvailable += number(candidate.marks_available)
    const change = reassessmentScore - baselineScore
    const component = `learner:${studentId}`
    if (change >= minimumMeaningfulChange) improvedComponents.push(component)
    else unchangedComponents.push(component)
  }

  const reassessmentPublished = learners.length > 0 && learners.every((studentId) => {
    const row = reassessmentByLearner.get(studentId)
    return row && ["published", "locked"].includes(String(row.publication_state || "")) && String(row.evidence_status || "") === "valid"
  })
  const reassessmentComparable = learners.length > 0 && comparisons.length === learners.length && comparisons.every((item) => item.comparable)
  return {
    reassessmentPublished,
    reassessmentComparable,
    baselineScore: baselineAvailable ? Number((baselineAwarded / baselineAvailable * 100).toFixed(2)) : null,
    reassessmentScore: reassessmentAvailable ? Number((reassessmentAwarded / reassessmentAvailable * 100).toFixed(2)) : null,
    improvedComponents,
    unchangedComponents,
    expectedLearnerCount: learners.length,
    comparableLearnerCount: comparisons.filter((item) => item.comparable).length,
    comparisons,
  }
}

export function buildCaseNarrative(caseRecord = {}, context = {}) {
  const learner = context.learnerName || "The learner"
  const topic = context.topicName || "the mapped topic"
  const failures = number(caseRecord.comparable_failure_count)
  const confidence = number(caseRecord.evidence_confidence)
  if (caseRecord.scope_type === "class") return `${number(context.affectedLearners)} of ${number(context.classSize)} learners are below the configured threshold for ${topic}. A whole-class teaching or assessment review is recommended.`
  if (caseRecord.case_type === "multi_subject_decline") return `Performance has declined across ${number(context.subjectCount)} subjects over recent valid assessments. A broader academic review is recommended; no cause has been inferred.`
  if (failures >= 2) return `${learner} has a second comparable mapped result below the secure threshold in ${topic}. A structured support plan is recommended rather than another isolated follow-up.`
  return `Recent mapped evidence suggests that ${learner} has not yet demonstrated secure understanding of ${topic}. This conclusion currently carries ${confidence >= 75 ? "high" : confidence >= 45 ? "medium" : "low"} confidence.`
}

async function activePolicy(schoolId, db = pool) {
  const [[row]] = await db.query("SELECT * FROM escalation_policies WHERE school_id=? AND status='active' AND effective_from<=CURDATE() AND (effective_to IS NULL OR effective_to>=CURDATE()) ORDER BY effective_from DESC,version_number DESC LIMIT 1", [schoolId])
  return { row: row || null, policy: normalizeEscalationPolicy(row?.policy_json) }
}

export async function getActiveSupportPolicy(db, schoolId) {
  return activePolicy(schoolId, db)
}

const SUPPORT_ACTIONS = Object.freeze({
  view: "view", acknowledge: "acknowledge", completeAssignment: "complete_assignment", acceptOwnership: "accept_ownership", requestReassignment: "request_reassignment",
  createIntervention: "create_intervention", recordSession: "record_session", addNote: "add_note", createAssessment: "create_assessment",
  scheduleReassessment: "schedule_reassessment", reviewOutcome: "review_outcome", requestReview: "request_review",
  recommendEscalation: "recommend_escalation", assign: "assign", escalate: "escalate", resolve: "resolve",
  carryForward: "carry_forward", guardianSummary: "guardian_summary",
})

export const LEARNER_SUPPORT_ACTION_MATRIX = Object.freeze({
  teacher: [SUPPORT_ACTIONS.view, SUPPORT_ACTIONS.acknowledge, SUPPORT_ACTIONS.acceptOwnership, SUPPORT_ACTIONS.requestReassignment, SUPPORT_ACTIONS.createIntervention, SUPPORT_ACTIONS.recordSession, SUPPORT_ACTIONS.addNote, SUPPORT_ACTIONS.createAssessment, SUPPORT_ACTIONS.scheduleReassessment, SUPPORT_ACTIONS.requestReview, SUPPORT_ACTIONS.recommendEscalation],
  support_teacher: [SUPPORT_ACTIONS.view, SUPPORT_ACTIONS.acknowledge, SUPPORT_ACTIONS.requestReassignment, SUPPORT_ACTIONS.createIntervention, SUPPORT_ACTIONS.recordSession, SUPPORT_ACTIONS.addNote, SUPPORT_ACTIONS.createAssessment, SUPPORT_ACTIONS.scheduleReassessment, SUPPORT_ACTIONS.requestReview, SUPPORT_ACTIONS.recommendEscalation],
  coordinator: Object.values(SUPPORT_ACTIONS).filter((action) => action !== SUPPORT_ACTIONS.guardianSummary),
  headteacher: Object.values(SUPPORT_ACTIONS),
})

function activeAssignmentClause(assignmentAlias, caseAlias) {
  return `${assignmentAlias}.is_active=1 AND ${caseAlias}.academic_year_id IS NOT NULL AND ${caseAlias}.current_term_id IS NOT NULL AND ${assignmentAlias}.academic_year_id=${caseAlias}.academic_year_id AND ${assignmentAlias}.term_id=${caseAlias}.current_term_id`
}

function learnerSupportScopeSql(actor, alias = "c", capabilities = { assignments: true }) {
  const role = String(actor?.role || "").toLowerCase()
  if (LEARNER_SUPPORT_LEADERSHIP_ROLES.has(role)) return { sql: "", params: [] }
  const userId = number(actor?.id)
  if (!userId) return { sql: " AND 1=0", params: [] }
  const activeSubject = activeAssignmentClause("support_subject_assignment", alias)
  const activeClass = activeAssignmentClause("support_class_assignment", alias)
  const clauses = [
    `${alias}.owner_user_id=?`,
    `EXISTS (SELECT 1 FROM intervention_cycles support_owned_cycle WHERE support_owned_cycle.school_id=${alias}.school_id AND support_owned_cycle.case_id=${alias}.id AND support_owned_cycle.owner_user_id=?)`,
  ]
  const params = [userId, userId]
  if (capabilities.assignments) {
    clauses.push(`EXISTS (SELECT 1 FROM learner_support_case_assignments support_explicit_assignment WHERE support_explicit_assignment.school_id=${alias}.school_id AND support_explicit_assignment.case_id=${alias}.id AND support_explicit_assignment.assigned_user_id=? AND support_explicit_assignment.assignment_status<>'removed')`)
    params.push(userId)
  }
  clauses.push(
    `EXISTS (SELECT 1 FROM users support_actor WHERE support_actor.school_id=${alias}.school_id AND support_actor.id=? AND support_actor.role='teacher' AND support_actor.role_type IN ('deputy_headteacher','admin_teacher') AND support_actor.is_active=1)`,
    `EXISTS (SELECT 1 FROM teacher_class_subject_assignments support_subject_assignment WHERE support_subject_assignment.school_id=${alias}.school_id AND support_subject_assignment.teacher_id=? AND support_subject_assignment.class_id=${alias}.class_id AND support_subject_assignment.subject_id=${alias}.subject_id AND support_subject_assignment.role='subject_teacher' AND ${activeSubject})`,
    `EXISTS (SELECT 1 FROM teacher_class_subject_assignments support_class_assignment WHERE support_class_assignment.school_id=${alias}.school_id AND support_class_assignment.teacher_id=? AND support_class_assignment.class_id=${alias}.class_id AND support_class_assignment.role='class_teacher' AND ${activeClass})`,
  )
  params.push(userId, userId, userId)
  return { sql: ` AND (${clauses.join(" OR ")})`, params }
}

export function learnerSupportActionAllowed(access = {}, requestedAction = SUPPORT_ACTIONS.view, caseRecord = {}) {
  if (!access.relationships?.length) return false
  const relationship = new Set(access.relationships)
  if (access.isHeadteacher) return LEARNER_SUPPORT_ACTION_MATRIX.headteacher.includes(requestedAction)
  if (access.isCoordinator) return LEARNER_SUPPORT_ACTION_MATRIX.coordinator.includes(requestedAction)
  if (requestedAction === SUPPORT_ACTIONS.view) return true
  if ([SUPPORT_ACTIONS.assign, SUPPORT_ACTIONS.escalate, SUPPORT_ACTIONS.resolve, SUPPORT_ACTIONS.carryForward, SUPPORT_ACTIONS.guardianSummary].includes(requestedAction)) return false
  if (requestedAction === SUPPORT_ACTIONS.reviewOutcome) return relationship.has("owner") || relationship.has("support_teacher")
  if (requestedAction === SUPPORT_ACTIONS.acknowledge) return relationship.has("owner") || relationship.has("support_teacher") || relationship.has("action_assignee")
  if (requestedAction === SUPPORT_ACTIONS.completeAssignment) return Boolean(access.hasOpenAssignment)
  if (requestedAction === SUPPORT_ACTIONS.acceptOwnership) return ["detected", "teacher_follow_up", "intervention_active"].includes(String(caseRecord.status)) && ["subject_teacher", "class_teacher", "support_teacher"].some((item) => relationship.has(item))
  return ["owner", "support_teacher", "subject_teacher", "class_teacher", "action_assignee"].some((item) => relationship.has(item))
}

export async function canAccessLearnerSupportCase({ userId, schoolId, caseId, requestedAction = SUPPORT_ACTIONS.view, actorRole = null, db = pool, lock = false }) {
  const [[record]] = await db.query(`SELECT c.* FROM learner_support_cases c WHERE c.school_id=? AND (c.public_ref=? OR c.id=?) LIMIT 1${lock ? " FOR UPDATE" : ""}`, [schoolId, String(caseId), number(caseId)])
  if (!record) return { allowed: false, reason: "not_found", relationships: [], case: null }
  const role = String(actorRole || "").toLowerCase()
  if (role === "super_admin") return { allowed: true, relationships: ["headteacher"], isHeadteacher: true, isCoordinator: true, case: record }
  const [[actor]] = await db.query("SELECT id,role,role_type,is_active,employment_status FROM users WHERE school_id=? AND id=? LIMIT 1", [schoolId, number(userId)])
  if (!actor?.is_active || actor.employment_status === "suspended" || actor.employment_status === "left") return { allowed: false, reason: "inactive_user", relationships: [], case: record }
  const relationships = []
  const isHeadteacher = LEARNER_SUPPORT_LEADERSHIP_ROLES.has(String(actor.role || "").toLowerCase()) || actor.role_type === "headteacher"
  const isCoordinator = isHeadteacher || (actor.role === "teacher" && ["deputy_headteacher", "admin_teacher"].includes(actor.role_type))
  if (isHeadteacher) relationships.push("headteacher")
  else if (isCoordinator) relationships.push("coordinator")
  if (number(record.owner_user_id) === number(userId)) relationships.push("owner")
  const [cycleOwnerRows, explicitRows, subjectRows, classRows] = await Promise.all([
    db.query("SELECT 1 FROM intervention_cycles WHERE school_id=? AND case_id=? AND owner_user_id=? LIMIT 1", [schoolId, record.id, userId]).then(([rows]) => rows),
    optionalRows(db, "SELECT assignment_type,assignment_status FROM learner_support_case_assignments WHERE school_id=? AND case_id=? AND assigned_user_id=? AND assignment_status<>'removed'", [schoolId, record.id, userId]),
    db.query("SELECT 1 FROM teacher_class_subject_assignments WHERE school_id=? AND teacher_id=? AND class_id=? AND subject_id=? AND role='subject_teacher' AND is_active=1 AND academic_year_id IS NOT NULL AND term_id IS NOT NULL AND academic_year_id=? AND term_id=? LIMIT 1", [schoolId, userId, record.class_id, record.subject_id, record.academic_year_id, record.current_term_id]).then(([rows]) => rows),
    db.query("SELECT 1 FROM teacher_class_subject_assignments WHERE school_id=? AND teacher_id=? AND class_id=? AND role='class_teacher' AND is_active=1 AND academic_year_id IS NOT NULL AND term_id IS NOT NULL AND academic_year_id=? AND term_id=? LIMIT 1", [schoolId, userId, record.class_id, record.academic_year_id, record.current_term_id]).then(([rows]) => rows),
  ])
  if (cycleOwnerRows.length && !relationships.includes("owner")) relationships.push("owner")
  for (const assignment of explicitRows) relationships.push(assignment.assignment_type === "support_teacher" ? "support_teacher" : assignment.assignment_type === "action" ? "action_assignee" : "owner")
  if (subjectRows.length) relationships.push("subject_teacher")
  if (classRows.length) relationships.push("class_teacher")
  const access = { relationships: [...new Set(relationships)], hasOpenAssignment: explicitRows.some((assignment) => ["assigned", "acknowledged", "reassignment_requested"].includes(assignment.assignment_status)), isHeadteacher, isCoordinator, actorRole: actor.role, roleType: actor.role_type }
  return { ...access, allowed: learnerSupportActionAllowed(access, requestedAction, record), case: record }
}

async function lockedCase(db, schoolId, caseId, actor, requestedAction) {
  const access = await canAccessLearnerSupportCase({ userId: actor?.id, schoolId, caseId, requestedAction, actorRole: actor?.role, db, lock: true })
  if (!access.case) throw new HttpError(404, "Learner support case was not found.")
  if (!access.allowed) throw new HttpError(403, "You are not authorised to perform this learner-support action.")
  return { record: access.case, access }
}

export async function validateSupportCaseOwner(db, schoolId, record, ownerUserId) {
  const ownerId = number(ownerUserId)
  const [[owner]] = await db.query(`SELECT id,role,role_type FROM users
    WHERE school_id=? AND id=? AND role IN ('school_owner','director','owner','headteacher','teacher')
      AND employment_status='active' AND is_active=1 LIMIT 1`, [schoolId, ownerId])
  if (!owner) throw new HttpError(400, "Select an active academic staff member from this school.")
  if (owner.role !== "teacher" || ["headteacher", "deputy_headteacher", "admin_teacher"].includes(String(owner.role_type || ""))) {
    return owner
  }
  if (!record?.class_id) throw new HttpError(400, "A class-scoped academic staff member is required for this support case.")
  const [assignmentResult] = await db.query(`SELECT id FROM teacher_class_subject_assignments
    WHERE school_id=? AND teacher_id=? AND class_id=? AND is_active=1
      AND ((role='subject_teacher' AND ? IS NOT NULL AND subject_id=?) OR role='class_teacher')
      AND academic_year_id IS NOT NULL AND term_id IS NOT NULL
      AND academic_year_id=? AND term_id=?
    LIMIT 1`, [schoolId, owner.id, record.class_id, record.subject_id || null, record.subject_id || null,
    record.academic_year_id || null, record.current_term_id || null])
  const assignment = assignmentResult[0]
  if (!assignment) {
    throw new HttpError(400, "The selected teacher is not assigned to this learner-support class and subject.")
  }
  return owner
}

function assertVersion(record, body = {}) {
  if (body.version_number !== undefined && number(body.version_number) !== number(record.version_number)) throw new HttpError(409, "This support case changed after it was opened. Refresh and try again.", { code: "STALE_SUPPORT_CASE" })
}

async function event(db, schoolId, caseRecord, actor, type, summary, options = {}) {
  const key = options.idempotencyKey || null
  await db.query(`INSERT INTO learner_support_case_events (public_ref,school_id,case_id,term_id,event_type,summary,evidence_json,status,responsible_user_id,linked_entity_type,linked_entity_ref,idempotency_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [randomUUID(), schoolId, caseRecord.id, options.termId || caseRecord.current_term_id || null, type, summary, JSON.stringify(options.evidence || {}), options.status || caseRecord.status, actor?.id || null, options.linkedType || null, options.linkedRef || null, key, actor?.id || null, actor?.id || null])
}

export async function recordSupportCaseEvent(db, schoolId, caseRecord, actor, type, summary, options = {}) {
  return event(db, schoolId, caseRecord, actor, type, summary, options)
}

export async function getInterventionDeliveryMetrics(db, schoolId, cycleId) {
  const [[delivery], [attendanceRows]] = await Promise.all([
    db.query("SELECT COUNT(*) recorded,SUM(status='completed') completed,SUM(status='partially_completed') partially_completed FROM intervention_sessions WHERE school_id=? AND cycle_id=?", [schoolId, cycleId]).then(([rows]) => rows),
    db.query("SELECT COUNT(*) eligible,SUM(attendance_status IN ('present','late')) attended FROM intervention_session_attendance attendance JOIN intervention_sessions session ON session.id=attendance.session_id AND session.school_id=attendance.school_id WHERE attendance.school_id=? AND session.cycle_id=? AND session.status IN ('completed','partially_completed')", [schoolId, cycleId]),
  ])
  const attendance = attendanceRows[0] || {}
  return {
    recordedSessions: number(delivery?.recorded),
    completedSessions: number(delivery?.completed),
    partiallyCompletedSessions: number(delivery?.partially_completed),
    deliveredSessions: number(delivery?.completed) + number(delivery?.partially_completed) * 0.5,
    attendanceEligible: number(attendance.eligible),
    attendedSessions: number(attendance.attended),
  }
}

export async function supportStrategyWasRepeated(db, schoolId, cycle = {}) {
  if (!number(cycle.id) || !number(cycle.case_id) || !number(cycle.cycle_number) || !number(cycle.strategy_type_id)) return false
  const [[previous]] = await db.query(`SELECT strategy_type_id,outcome
    FROM intervention_cycles
    WHERE school_id=? AND case_id=? AND cycle_number<?
    ORDER BY cycle_number DESC LIMIT 1`, [schoolId, cycle.case_id, cycle.cycle_number])
  return Boolean(previous
    && number(previous.strategy_type_id) === number(cycle.strategy_type_id)
    && ["partially_effective", "ineffective"].includes(String(previous.outcome || "")))
}

async function duplicateMutation(db, schoolId, caseRecord, key) {
  if (!key) return null
  const [[existing]] = await db.query("SELECT public_ref,event_type,status,linked_entity_type,linked_entity_ref FROM learner_support_case_events WHERE school_id=? AND case_id=? AND idempotency_key=? LIMIT 1", [schoolId, caseRecord.id, String(key)])
  if (existing) return { duplicate: true, case_ref: caseRecord.public_ref, case_status: caseRecord.status, case_version_number: caseRecord.version_number, prior_event: existing }
  const [[decision]] = await db.query("SELECT public_ref,decision_type,to_level,approval_status,status FROM escalation_decisions WHERE school_id=? AND case_id=? AND idempotency_key=? LIMIT 1", [schoolId, caseRecord.id, String(key)])
  return decision ? { duplicate: true, case_ref: caseRecord.public_ref, case_status: caseRecord.status, case_version_number: caseRecord.version_number, prior_decision: decision } : null
}

async function inTransaction(work) {
  const db = await pool.getConnection()
  try { await db.beginTransaction(); const result = await work(db); await db.commit(); return result }
  catch (error) { await db.rollback(); throw error }
  finally { db.release() }
}

export async function getEscalationPolicy(schoolId) {
  const { row, policy } = await activePolicy(schoolId)
  return { public_ref: row?.public_ref || null, name: row?.policy_name || "Built-in safe default", version_number: row?.version_number || 0, policy }
}

export async function listSupportCases(schoolId, actor, filters = {}) {
  const capabilities = await supportSchemaCapabilities()
  const page = Math.max(1, number(filters.page, 1)); const limit = Math.min(100, Math.max(1, number(filters.limit, 25))); const offset = (page - 1) * limit
  const where = ["c.school_id=?"]; const params = [schoolId]
  if (filters.status) { where.push("c.status=?"); params.push(String(filters.status)) }
  if (filters.owner_user_id) { where.push("c.owner_user_id=?"); params.push(number(filters.owner_user_id)) }
  if (filters.learner_id) { where.push("(c.learner_id=? OR EXISTS (SELECT 1 FROM learner_support_case_members cm WHERE cm.school_id=c.school_id AND cm.case_id=c.id AND cm.learner_id=? AND cm.membership_status='active'))"); params.push(number(filters.learner_id), number(filters.learner_id)) }
  if (filters.term_id) { where.push("c.current_term_id=?"); params.push(number(filters.term_id)) }
  const termScope = String(filters.term_scope || "current")
  if (!filters.term_id && termScope === "current") where.push("(c.current_term_id IS NULL OR EXISTS (SELECT 1 FROM terms support_term WHERE support_term.school_id=c.school_id AND support_term.id=c.current_term_id AND support_term.status IN ('open','marking')))")
  if (!filters.term_id && termScope === "previous") where.push("EXISTS (SELECT 1 FROM terms support_term WHERE support_term.school_id=c.school_id AND support_term.id=c.current_term_id AND support_term.status IN ('closed','archived'))")
  if (filters.overdue === "true" || filters.overdue === true) where.push("c.next_review_at<CURRENT_TIMESTAMP")
  if (filters.scope_type) { where.push("c.scope_type=?"); params.push(String(filters.scope_type)) }
  if (filters.priority === "high") where.push("c.severity IN ('high','urgent')")
  if (filters.queue === "assigned") {
    where.push(capabilities.assignments ? "(c.owner_user_id=? OR EXISTS (SELECT 1 FROM learner_support_case_assignments queue_assignment WHERE queue_assignment.school_id=c.school_id AND queue_assignment.case_id=c.id AND queue_assignment.assigned_user_id=? AND queue_assignment.assignment_status<>'removed'))" : "c.owner_user_id=?")
    params.push(actor.id)
    if (capabilities.assignments) params.push(actor.id)
  }
  if (filters.queue === "classes") { where.push("EXISTS (SELECT 1 FROM teacher_class_subject_assignments queue_class WHERE queue_class.school_id=c.school_id AND queue_class.teacher_id=? AND queue_class.class_id=c.class_id AND queue_class.role='class_teacher' AND queue_class.is_active=1)"); params.push(actor.id) }
  if (filters.queue === "subjects") { where.push("EXISTS (SELECT 1 FROM teacher_class_subject_assignments queue_subject WHERE queue_subject.school_id=c.school_id AND queue_subject.teacher_id=? AND queue_subject.class_id=c.class_id AND queue_subject.subject_id=c.subject_id AND queue_subject.role='subject_teacher' AND queue_subject.is_active=1)"); params.push(actor.id) }
  if (filters.queue === "awaiting_action") {
    where.push(capabilities.assignments ? "EXISTS (SELECT 1 FROM learner_support_case_assignments awaiting_assignment WHERE awaiting_assignment.school_id=c.school_id AND awaiting_assignment.case_id=c.id AND awaiting_assignment.assigned_user_id=? AND awaiting_assignment.assignment_status='assigned')" : "1=0")
    if (capabilities.assignments) params.push(actor.id)
  }
  if (filters.queue === "needs_attention") where.push("c.status NOT IN ('resolved','closed_inconclusive','transferred') AND (c.next_review_at IS NULL OR c.next_review_at<=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 DAY))")
  if (filters.queue === "recently_improved") where.push("c.successful_cycle_count>0 AND c.updated_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 DAY)")
  if (filters.queue === "reassessment") where.push("c.status='reassessment_pending'")
  if (filters.queue === "strategy_review") where.push("c.status='strategy_review'")
  if (filters.queue === "resolved") where.push("c.status IN ('resolved','closed_inconclusive')")
  const search = String(filters.search || "").trim()
  if (search) {
    where.push("(c.public_ref LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_no LIKE ? OR cl.name LIKE ? OR sub.name LIKE ? OR st.topic_name LIKE ? OR EXISTS (SELECT 1 FROM learner_support_case_members search_member JOIN students search_student ON search_student.school_id=search_member.school_id AND search_student.id=search_member.learner_id WHERE search_member.school_id=c.school_id AND search_member.case_id=c.id AND CONCAT(search_student.first_name,' ',search_student.last_name,' ',search_student.admission_no) LIKE ?))")
    const pattern = `%${search}%`; params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
  }
  const scope = learnerSupportScopeSql(actor, "c", capabilities); where.push(`1=1${scope.sql}`); params.push(...scope.params)
  const base = `FROM learner_support_cases c LEFT JOIN students s ON s.school_id=c.school_id AND s.id=c.learner_id LEFT JOIN subjects sub ON sub.school_id=c.school_id AND sub.id=c.subject_id LEFT JOIN syllabus_topics st ON st.school_id=c.school_id AND st.id=c.primary_topic_id LEFT JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id WHERE ${where.join(" AND ")}`
  const [[count]] = await pool.query(`SELECT COUNT(*) total ${base}`, params)
  const [rows] = await pool.query(`SELECT c.public_ref,c.scope_type,c.case_type,c.severity,c.status,c.escalation_level,c.current_summary,c.evidence_confidence,c.comparable_failure_count,c.intervention_cycle_count,c.next_review_at,c.version_number,c.updated_at,CONCAT(s.first_name,' ',s.last_name) learner_name,s.admission_no,sub.name subject_name,st.topic_name,cl.name class_name,
    (SELECT COUNT(*) FROM learner_support_case_members member_count WHERE member_count.school_id=c.school_id AND member_count.case_id=c.id AND member_count.membership_status='active') member_count,
    (SELECT COUNT(*) FROM intervention_sessions session_count JOIN intervention_cycles session_cycle ON session_cycle.school_id=session_count.school_id AND session_cycle.id=session_count.cycle_id WHERE session_count.school_id=c.school_id AND session_cycle.case_id=c.id AND session_count.status='completed') completed_sessions,
    (SELECT SUM(cycle_count.planned_session_count) FROM intervention_cycles cycle_count WHERE cycle_count.school_id=c.school_id AND cycle_count.case_id=c.id) planned_sessions,
    (SELECT MIN(due_session.scheduled_at) FROM intervention_sessions due_session JOIN intervention_cycles due_cycle ON due_cycle.school_id=due_session.school_id AND due_cycle.id=due_session.cycle_id WHERE due_session.school_id=c.school_id AND due_cycle.case_id=c.id AND due_session.status='planned') next_session_at,
    ${capabilities.assignments ? "EXISTS (SELECT 1 FROM learner_support_case_assignments own_assignment WHERE own_assignment.school_id=c.school_id AND own_assignment.case_id=c.id AND own_assignment.assigned_user_id=? AND own_assignment.assignment_status='assigned')" : "0"} awaiting_acknowledgement
    ${base} ORDER BY FIELD(c.severity,'urgent','high','medium','low'),c.next_review_at IS NULL,c.next_review_at,c.updated_at DESC LIMIT ? OFFSET ?`, [...(capabilities.assignments ? [actor.id] : []), ...params, limit, offset])
  return { cases: rows, pagination: { page, limit, total: number(count.total), pages: Math.ceil(number(count.total) / limit) }, schema_status: capabilities.assignments && capabilities.notes && capabilities.sessionDetails && capabilities.reassessmentDueAt ? "current" : "compatibility_read_only" }
}

export async function getSupportCase(schoolId, caseId, actor) {
  const access = await canAccessLearnerSupportCase({ userId: actor?.id, schoolId, caseId, requestedAction: SUPPORT_ACTIONS.view, actorRole: actor?.role })
  if (!access.allowed || !access.case) throw new HttpError(404, "Learner support case was not found or is outside your assignment.")
  const capabilities = await supportSchemaCapabilities()
  const [[record]] = await pool.query(`SELECT c.*,CONCAT(s.first_name,' ',s.last_name) learner_name,s.public_ref learner_ref,s.admission_no,sub.public_ref subject_ref,sub.name subject_name,st.public_ref topic_ref,st.topic_name,lo.public_ref objective_ref,lo.objective_text,cl.public_ref class_ref,cl.name class_name,CONCAT(u.first_name,' ',u.last_name) owner_name FROM learner_support_cases c LEFT JOIN students s ON s.school_id=c.school_id AND s.id=c.learner_id LEFT JOIN subjects sub ON sub.school_id=c.school_id AND sub.id=c.subject_id LEFT JOIN syllabus_topics st ON st.school_id=c.school_id AND st.id=c.primary_topic_id LEFT JOIN learning_objectives lo ON lo.school_id=c.school_id AND lo.id=c.primary_objective_id LEFT JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id LEFT JOIN users u ON u.school_id=c.school_id AND u.id=c.owner_user_id WHERE c.school_id=? AND c.id=? LIMIT 1`, [schoolId, access.case.id])
  const noteVisibility = access.isHeadteacher ? ["teacher_academic", "support_team", "coordinator_only", "headteacher_only", "guardian_meeting", "administrative_restricted"] : access.isCoordinator ? ["teacher_academic", "support_team", "coordinator_only", "guardian_meeting"] : access.relationships.includes("support_teacher") || access.relationships.includes("owner") ? ["teacher_academic", "support_team"] : ["teacher_academic"]
  const sessionSql = capabilities.sessionDetails
    ? `SELECT sess.public_ref,sess.session_number,sess.scheduled_at,sess.completed_at,sess.duration_minutes,sess.delivery_method,sess.status,sess.resources_json,sess.activities_json,sess.teacher_notes,sess.teacher_observation,sess.practice_assigned,sess.next_action,sess.review_status,cycle.public_ref cycle_ref,topic.topic_name target_topic,objective.objective_text target_objective,NULL attendance
      FROM intervention_sessions sess JOIN intervention_cycles cycle ON cycle.school_id=sess.school_id AND cycle.id=sess.cycle_id LEFT JOIN syllabus_topics topic ON topic.school_id=sess.school_id AND topic.id=sess.target_topic_id LEFT JOIN learning_objectives objective ON objective.school_id=sess.school_id AND objective.id=sess.target_objective_id WHERE sess.school_id=? AND cycle.case_id=? ORDER BY sess.scheduled_at DESC,sess.session_number DESC`
    : `SELECT sess.public_ref,sess.session_number,sess.scheduled_at,sess.completed_at,NULL duration_minutes,NULL delivery_method,sess.status,sess.resources_json,sess.activities_json,sess.teacher_notes,NULL teacher_observation,sess.practice_assigned,NULL next_action,sess.review_status,cycle.public_ref cycle_ref,NULL target_topic,NULL target_objective,NULL attendance
      FROM intervention_sessions sess JOIN intervention_cycles cycle ON cycle.school_id=sess.school_id AND cycle.id=sess.cycle_id WHERE sess.school_id=? AND cycle.case_id=? ORDER BY sess.scheduled_at DESC,sess.session_number DESC`
  const reassessmentSql = `SELECT reassessment.public_ref,reassessment.outcome,reassessment.success_criterion_json,reassessment.comparability_json,reassessment.outcome_summary_json,${capabilities.reassessmentDueAt ? "reassessment.due_at" : "NULL"} due_at,reassessment.evaluated_at,generated_assessment.public_ref assessment_ref,generated_assessment.title assessment_title,generated_assessment.status assessment_status,generated_assessment.assessment_id FROM academic_intervention_reassessments reassessment LEFT JOIN generated_assessments generated_assessment ON generated_assessment.school_id=reassessment.school_id AND generated_assessment.id=reassessment.generated_assessment_id WHERE reassessment.school_id=? AND reassessment.support_case_id=? ORDER BY reassessment.created_at DESC`
  const [members, topics, cycles, sessions, notes, reassessments, assignments] = await Promise.all([
    pool.query("SELECT cm.public_ref,cm.membership_status,cm.baseline_summary_json,cm.outcome_summary_json,s.public_ref learner_ref,s.admission_no,CONCAT(s.first_name,' ',s.last_name) learner_name FROM learner_support_case_members cm JOIN students s ON s.school_id=cm.school_id AND s.id=cm.learner_id WHERE cm.school_id=? AND cm.case_id=? ORDER BY s.last_name,s.first_name", [schoolId, record.id]).then(([rows]) => rows),
    pool.query("SELECT ct.public_ref,ct.topic_role,ct.current_mastery,ct.previous_mastery,ct.status,sub.name subject_name,st.topic_name,lo.objective_text FROM learner_support_case_topics ct JOIN subjects sub ON sub.school_id=ct.school_id AND sub.id=ct.subject_id JOIN syllabus_topics st ON st.school_id=ct.school_id AND st.id=ct.topic_id LEFT JOIN learning_objectives lo ON lo.school_id=ct.school_id AND lo.id=ct.objective_id WHERE ct.school_id=? AND ct.case_id=?", [schoolId, record.id]).then(([rows]) => rows),
    pool.query("SELECT ic.public_ref,ic.cycle_number,ist.strategy_code,ist.label strategy_label,ic.planned_session_count,ic.status,ic.outcome,ic.start_date,ic.review_date,ic.success_criterion_json,ic.diagnostic_json,ic.version_number FROM intervention_cycles ic JOIN intervention_strategy_types ist ON ist.school_id=ic.school_id AND ist.id=ic.strategy_type_id WHERE ic.school_id=? AND ic.case_id=? ORDER BY ic.cycle_number DESC", [schoolId, record.id]).then(([rows]) => rows),
    pool.query(sessionSql, [schoolId, record.id]).then(([rows]) => rows),
    capabilities.notes ? optionalRows(pool, `SELECT note.public_ref,note.visibility,note.note_text,note.created_at,CONCAT(author.first_name,' ',author.last_name) author_name FROM learner_support_case_notes note JOIN users author ON author.school_id=note.school_id AND author.id=note.author_user_id WHERE note.school_id=? AND note.case_id=? AND note.status='active' AND note.visibility IN (${noteVisibility.map(() => "?").join(",")}) ORDER BY note.created_at DESC`, [schoolId, record.id, ...noteVisibility]) : Promise.resolve([]),
    pool.query(reassessmentSql, [schoolId, record.id]).then(([rows]) => rows),
    capabilities.assignments ? optionalRows(pool, "SELECT case_assignment.public_ref,case_assignment.assignment_type,case_assignment.assignment_status,case_assignment.action_label,case_assignment.due_at,case_assignment.acknowledged_at,case_assignment.completed_at,support_user.public_ref user_ref,CONCAT(support_user.first_name,' ',support_user.last_name) user_name FROM learner_support_case_assignments case_assignment JOIN users support_user ON support_user.school_id=case_assignment.school_id AND support_user.id=case_assignment.assigned_user_id WHERE case_assignment.school_id=? AND case_assignment.case_id=? AND case_assignment.assignment_status<>'removed' ORDER BY case_assignment.created_at", [schoolId, record.id]) : Promise.resolve([]),
  ])
  const attendanceRows = await optionalRows(pool, `SELECT session.public_ref session_ref,student.public_ref learner_ref,CONCAT(student.first_name,' ',student.last_name) learner_name,attendance.attendance_status status,attendance.note
    FROM intervention_session_attendance attendance
    JOIN intervention_sessions session ON session.school_id=attendance.school_id AND session.id=attendance.session_id
    JOIN intervention_cycles cycle ON cycle.school_id=session.school_id AND cycle.id=session.cycle_id
    JOIN students student ON student.school_id=attendance.school_id AND student.id=attendance.learner_id
    WHERE attendance.school_id=? AND cycle.case_id=? ORDER BY session.session_number,student.last_name,student.first_name`, [schoolId, record.id])
  const attendanceBySession = new Map()
  for (const attendance of attendanceRows) {
    const current = attendanceBySession.get(attendance.session_ref) || []
    current.push({ learner_ref: attendance.learner_ref, learner_name: attendance.learner_name, status: attendance.status, note: attendance.note })
    attendanceBySession.set(attendance.session_ref, current)
  }
  for (const session of sessions) session.attendance = attendanceBySession.get(session.public_ref) || []
  const assignmentActions = new Set([SUPPORT_ACTIONS.assign, SUPPORT_ACTIONS.acknowledge, SUPPORT_ACTIONS.completeAssignment, SUPPORT_ACTIONS.acceptOwnership, SUPPORT_ACTIONS.requestReassignment])
  const actions = Object.values(SUPPORT_ACTIONS).filter((action) => {
    if (!learnerSupportActionAllowed(access, action, access.case)) return false
    if (!capabilities.assignments && assignmentActions.has(action)) return false
    if (!capabilities.notes && action === SUPPORT_ACTIONS.addNote) return false
    if (!capabilities.sessionDetails && action === SUPPORT_ACTIONS.recordSession) return false
    if (!capabilities.reassessmentDueAt && action === SUPPORT_ACTIONS.scheduleReassessment) return false
    if (action === SUPPORT_ACTIONS.createAssessment && (record.case_type === "multi_subject_decline" || !record.class_id || !record.subject_id || !record.primary_topic_id)) return false
    return true
  })
  delete record.id
  return { case: record, members, topics, intervention_cycles: cycles, sessions, notes, reassessments, assignments, schema_status: capabilities.assignments && capabilities.notes && capabilities.sessionDetails && capabilities.reassessmentDueAt ? "current" : "compatibility_read_only", access: { relationships: access.relationships, is_coordinator: access.isCoordinator, is_headteacher: access.isHeadteacher, actions } }
}

export async function getLearnerSupport(schoolId, learnerId, actor) {
  const [[learner]] = await pool.query("SELECT id,public_ref,CONCAT(first_name,' ',last_name) learner_name FROM students WHERE school_id=? AND (public_ref=? OR id=?) LIMIT 1", [schoolId, String(learnerId), number(learnerId)])
  if (!learner) throw new HttpError(404, "Learner was not found.")
  const result = await listSupportCases(schoolId, actor, { learner_id: learner.id, term_scope: "all", limit: 100 })
  return { learner: { public_ref: learner.public_ref, learner_name: learner.learner_name }, ...result }
}

async function caseChildRows(schoolId, caseId, actor, selectSql, params = []) {
  const access = await canAccessLearnerSupportCase({ userId: actor?.id, schoolId, caseId, requestedAction: SUPPORT_ACTIONS.view, actorRole: actor?.role })
  if (!access.allowed || !access.case) throw new HttpError(404, "Learner support case was not found or is outside your assignment.")
  const [rows] = await pool.query(selectSql, [schoolId, access.case.public_ref, ...params])
  return rows
}

export async function getSupportTimeline(schoolId, caseId, actor, filters = {}) {
  const limit = Math.min(100, Math.max(1, number(filters.limit, 50)))
  const rows = await caseChildRows(schoolId, caseId, actor, `WITH target_case AS (
    SELECT id,school_id FROM learner_support_cases WHERE school_id=? AND public_ref=?
  ), case_assessments AS (
    SELECT ce.case_id,GROUP_CONCAT(DISTINCT a.name ORDER BY a.name SEPARATOR ' · ') assessment_names
    FROM learner_support_case_evidence ce
    JOIN target_case tc ON tc.school_id=ce.school_id AND tc.id=ce.case_id
    JOIN assessments a ON a.school_id=ce.school_id AND a.id=ce.assessment_id
    WHERE ce.evidence_status='valid'
    GROUP BY ce.case_id
  )
  SELECT e.public_ref,e.occurred_at,e.event_type,e.summary,e.evidence_json,e.status,e.linked_entity_type,e.linked_entity_ref,
    CONCAT(u.first_name,' ',u.last_name) responsible_user,
    CASE WHEN e.event_type='multi_subject_review_detected' THEN ca.assessment_names ELSE COALESCE(a.name,ca.assessment_names) END assessment_name
  FROM learner_support_case_events e
  JOIN target_case tc ON tc.school_id=e.school_id AND tc.id=e.case_id
  LEFT JOIN users u ON u.school_id=e.school_id AND u.id=e.responsible_user_id
  LEFT JOIN assessments a ON a.school_id=e.school_id AND e.linked_entity_type='assessment' AND a.id=CAST(e.linked_entity_ref AS UNSIGNED)
  LEFT JOIN case_assessments ca ON ca.case_id=e.case_id
  ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`, [limit])
  return { timeline: rows }
}

export async function getSupportEvidence(schoolId, caseId, actor) {
  const rows = await caseChildRows(schoolId, caseId, actor, `WITH target_case AS (
    SELECT id,school_id,evidence_confidence FROM learner_support_cases WHERE school_id=? AND public_ref=?
  ), case_assessments AS (
    SELECT ce.case_id,GROUP_CONCAT(DISTINCT a.name ORDER BY a.name SEPARATOR ' · ') assessment_names
    FROM learner_support_case_evidence ce
    JOIN target_case tc ON tc.school_id=ce.school_id AND tc.id=ce.case_id
    JOIN assessments a ON a.school_id=ce.school_id AND a.id=ce.assessment_id
    WHERE ce.evidence_status='valid'
    GROUP BY ce.case_id
  )
  SELECT ce.public_ref,ce.evidence_role,ce.evidence_precision,ce.score_percentage,ce.marks_awarded,ce.marks_available,
    ce.confidence_score,ce.comparable,ce.comparability_json,ce.evidence_status,ce.observed_at,a.name assessment_name,
    st.topic_name,lo.objective_text,question.display_number question_number,question.question_text,question.difficulty,
    CASE WHEN ce.evidence_status='valid' THEN 'official_published' WHEN ce.evidence_status='incomplete' THEN 'draft_or_incomplete' ELSE ce.evidence_status END evidence_state,
    NULL event_type,NULL summary,'assessment' evidence_kind
  FROM learner_support_case_evidence ce
  JOIN target_case tc ON tc.school_id=ce.school_id AND tc.id=ce.case_id
  LEFT JOIN assessments a ON a.school_id=ce.school_id AND a.id=ce.assessment_id
  LEFT JOIN syllabus_topics st ON st.school_id=ce.school_id AND st.id=ce.topic_id
  LEFT JOIN learning_objectives lo ON lo.school_id=ce.school_id AND lo.id=ce.objective_id
  LEFT JOIN assessment_questions question ON question.school_id=ce.school_id AND question.id=ce.question_id
  UNION ALL
  SELECT e.public_ref,'detection' evidence_role,'limited' evidence_precision,NULL score_percentage,NULL marks_awarded,NULL marks_available,
    tc.evidence_confidence confidence_score,0 comparable,e.evidence_json comparability_json,'valid' evidence_status,e.occurred_at observed_at,
    CASE WHEN e.event_type='multi_subject_review_detected' THEN ca.assessment_names ELSE COALESCE(a.name,ca.assessment_names) END assessment_name,
    NULL topic_name,NULL objective_text,NULL question_number,NULL question_text,NULL difficulty,'historical_detection' evidence_state,e.event_type,e.summary,'case_event' evidence_kind
  FROM learner_support_case_events e
  JOIN target_case tc ON tc.school_id=e.school_id AND tc.id=e.case_id
  LEFT JOIN assessments a ON a.school_id=e.school_id AND e.linked_entity_type='assessment' AND a.id=CAST(e.linked_entity_ref AS UNSIGNED)
  LEFT JOIN case_assessments ca ON ca.case_id=e.case_id
  WHERE e.event_type IN ('case_detected','multi_subject_review_detected','class_issue_detected','format_pattern_detected')
  ORDER BY observed_at DESC,public_ref DESC`)
  return { evidence: rows }
}

export async function getSupportInterventions(schoolId, caseId, actor) {
  const rows = await caseChildRows(schoolId, caseId, actor, `SELECT ic.public_ref,ic.cycle_number,ist.strategy_code,ist.label strategy_label,ic.planned_session_count,ic.status,ic.outcome,ic.start_date,ic.review_date,ic.diagnostic_json,COUNT(sess.id) recorded_sessions,SUM(sess.status='completed') completed_sessions FROM intervention_cycles ic JOIN learner_support_cases c ON c.school_id=ic.school_id AND c.id=ic.case_id JOIN intervention_strategy_types ist ON ist.school_id=ic.school_id AND ist.id=ic.strategy_type_id LEFT JOIN intervention_sessions sess ON sess.school_id=ic.school_id AND sess.cycle_id=ic.id WHERE ic.school_id=? AND c.public_ref=? GROUP BY ic.id ORDER BY ic.cycle_number DESC`)
  return { intervention_cycles: rows }
}

export async function getTeacherSupportSummary(schoolId, actor) {
  const capabilities = await supportSchemaCapabilities()
  const scope = learnerSupportScopeSql(actor, "c", capabilities)
  const activeTerm = "(c.current_term_id IS NULL OR EXISTS (SELECT 1 FROM terms summary_term WHERE summary_term.school_id=c.school_id AND summary_term.id=c.current_term_id AND summary_term.status IN ('open','marking')))"
  const accessibleWhere = `c.school_id=? AND ${activeTerm}${scope.sql}`
  const params = [schoolId, ...scope.params]
  const [counts, todayWork, improved] = await Promise.all([
    pool.query(`SELECT
      SUM(c.status NOT IN ('resolved','closed_inconclusive','transferred') AND (c.next_review_at IS NULL OR c.next_review_at<=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 DAY))) needs_attention,
      SUM(EXISTS (SELECT 1 FROM intervention_sessions sess JOIN intervention_cycles cycle ON cycle.school_id=sess.school_id AND cycle.id=sess.cycle_id WHERE sess.school_id=c.school_id AND cycle.case_id=c.id AND sess.status='planned' AND sess.scheduled_at BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE,INTERVAL 7 DAY))) sessions_due_week,
      SUM(c.status='reassessment_pending' OR EXISTS (SELECT 1 FROM academic_intervention_reassessments reassessment WHERE reassessment.school_id=c.school_id AND reassessment.support_case_id=c.id AND reassessment.outcome='pending'${capabilities.reassessmentDueAt ? " AND reassessment.due_at<=DATE_ADD(CURRENT_DATE,INTERVAL 7 DAY)" : ""})) reassessments_due,
      ${capabilities.assignments ? "SUM(EXISTS (SELECT 1 FROM learner_support_case_assignments assignment WHERE assignment.school_id=c.school_id AND assignment.case_id=c.id AND assignment.assigned_user_id=? AND assignment.assignment_status='assigned'))" : "0"} unacknowledged_assignments,
      SUM(c.successful_cycle_count>0 AND c.updated_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 DAY)) recently_improved,
      SUM(c.status IN ('resolved','closed_inconclusive')) completed_support,
      SUM(c.status NOT IN ('resolved','closed_inconclusive','transferred')) active_cases
      FROM learner_support_cases c WHERE ${accessibleWhere}`, [...(capabilities.assignments ? [actor.id] : []), ...params]).then(([rows]) => rows[0] || {}),
    pool.query(`SELECT c.public_ref,c.scope_type,c.status,c.severity,c.next_review_at,CONCAT(student.first_name,' ',student.last_name) learner_name,class.name class_name,subject.name subject_name,topic.topic_name,
      session.public_ref session_ref,session.scheduled_at,session.status session_status,
      CASE WHEN session.public_ref IS NOT NULL THEN 'record_session' WHEN c.status='reassessment_pending' THEN 'open_reassessment' ELSE 'review_case' END primary_action
      FROM learner_support_cases c
      LEFT JOIN students student ON student.school_id=c.school_id AND student.id=c.learner_id
      LEFT JOIN classes class ON class.school_id=c.school_id AND class.id=c.class_id
      LEFT JOIN subjects subject ON subject.school_id=c.school_id AND subject.id=c.subject_id
      LEFT JOIN syllabus_topics topic ON topic.school_id=c.school_id AND topic.id=c.primary_topic_id
      LEFT JOIN intervention_sessions session ON session.id=(SELECT next_session.id FROM intervention_sessions next_session JOIN intervention_cycles next_cycle ON next_cycle.school_id=next_session.school_id AND next_cycle.id=next_session.cycle_id WHERE next_session.school_id=c.school_id AND next_cycle.case_id=c.id AND next_session.status='planned' ORDER BY next_session.scheduled_at,next_session.id LIMIT 1)
      WHERE ${accessibleWhere} AND c.status NOT IN ('resolved','closed_inconclusive','transferred') AND (DATE(session.scheduled_at)=CURRENT_DATE OR c.next_review_at<=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 DAY))
      ORDER BY session.scheduled_at IS NULL,session.scheduled_at,c.next_review_at LIMIT 12`, params).then(([rows]) => rows),
    pool.query(`SELECT c.public_ref,c.scope_type,c.status,c.current_summary,c.successful_cycle_count,CONCAT(student.first_name,' ',student.last_name) learner_name,class.name class_name,subject.name subject_name,topic.topic_name,c.updated_at
      FROM learner_support_cases c
      LEFT JOIN students student ON student.school_id=c.school_id AND student.id=c.learner_id
      LEFT JOIN classes class ON class.school_id=c.school_id AND class.id=c.class_id
      LEFT JOIN subjects subject ON subject.school_id=c.school_id AND subject.id=c.subject_id
      LEFT JOIN syllabus_topics topic ON topic.school_id=c.school_id AND topic.id=c.primary_topic_id
      WHERE ${accessibleWhere} AND c.successful_cycle_count>0 AND c.updated_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 DAY)
      ORDER BY c.updated_at DESC LIMIT 8`, params).then(([rows]) => rows),
  ])
  return {
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, number(value)])),
    today_work: todayWork,
    recently_improved: improved,
    schema_status: capabilities.assignments && capabilities.notes && capabilities.sessionDetails && capabilities.reassessmentDueAt ? "current" : "compatibility_read_only",
  }
}

export async function listLearnerSupportIndicators(schoolId, actor, classId) {
  const capabilities = await supportSchemaCapabilities()
  const scope = learnerSupportScopeSql(actor, "c", capabilities)
  const [rows] = await pool.query(`SELECT DISTINCT c.public_ref case_ref,learner.public_ref learner_ref,c.status,c.severity,c.updated_at,
    CASE WHEN c.status='reassessment_pending' THEN 'reassessment_due' WHEN c.status='strategy_review' THEN 'review_required' WHEN c.successful_cycle_count>0 THEN 'improving' ELSE 'support_active' END support_state
    FROM learner_support_cases c
    JOIN students learner ON learner.school_id=c.school_id AND learner.id=c.learner_id
    WHERE c.school_id=? AND c.class_id=? AND c.status NOT IN ('resolved','closed_inconclusive','transferred')${scope.sql}
    UNION ALL
    SELECT DISTINCT c.public_ref case_ref,learner.public_ref learner_ref,c.status,c.severity,c.updated_at,
    CASE WHEN c.status='reassessment_pending' THEN 'reassessment_due' WHEN c.status='strategy_review' THEN 'review_required' WHEN c.successful_cycle_count>0 THEN 'improving' ELSE 'support_active' END support_state
    FROM learner_support_cases c
    JOIN learner_support_case_members case_member ON case_member.school_id=c.school_id AND case_member.case_id=c.id AND case_member.membership_status='active'
    JOIN students learner ON learner.school_id=case_member.school_id AND learner.id=case_member.learner_id
    WHERE c.school_id=? AND c.class_id=? AND c.status NOT IN ('resolved','closed_inconclusive','transferred')${scope.sql}
    ORDER BY FIELD(severity,'urgent','high','medium','low'),updated_at DESC`, [schoolId, classId, ...scope.params, schoolId, classId, ...scope.params])
  const byLearner = new Map()
  for (const row of rows) if (!byLearner.has(row.learner_ref)) byLearner.set(row.learner_ref, row)
  return [...byLearner.values()]
}

export async function acknowledgeSupportCase(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "assignments")
    const { record, access } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.acknowledge)
    await db.query(`INSERT INTO learner_support_case_assignments (public_ref,school_id,case_id,assigned_user_id,assignment_type,assignment_status,action_label,due_at,acknowledged_at,assigned_by) VALUES (UUID(),?,?,?,?,'acknowledged',?,?,CURRENT_TIMESTAMP,?) ON DUPLICATE KEY UPDATE assignment_status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP`, [schoolId, record.id, actor.id, access.relationships.includes("owner") ? "owner" : access.relationships.includes("support_teacher") ? "support_teacher" : "action", body.action_label || "Learner-support follow-up", body.due_at || record.next_review_at, record.created_by || actor.id])
    await event(db, schoolId, record, actor, "case_assignment_acknowledged", "The assigned teacher acknowledged the learner-support case.", { idempotencyKey: body.idempotency_key || `acknowledge:${record.id}:${actor.id}` })
    return { case_ref: record.public_ref, acknowledged: true }
  })
}

export async function completeSupportAssignment(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "assignments")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.completeAssignment)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    const [result] = await db.query("UPDATE learner_support_case_assignments SET assignment_status='completed',completed_at=CURRENT_TIMESTAMP WHERE school_id=? AND case_id=? AND assigned_user_id=? AND assignment_status IN ('assigned','acknowledged','reassignment_requested')", [schoolId, record.id, actor.id])
    if (!result.affectedRows) throw new HttpError(409, "There is no open learner-support assignment to complete.")
    await event(db, schoolId, record, actor, "case_assignment_completed", "The assigned teacher marked their learner-support action complete.", { idempotencyKey: body.idempotency_key || `assignment-complete:${record.id}:${actor.id}:${record.version_number}` })
    return { case_ref: record.public_ref, assignment_status: "completed" }
  })
}

export async function acceptSupportOwnership(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "assignments")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.acceptOwnership)
    assertVersion(record, body)
    await db.query("UPDATE learner_support_cases SET owner_user_id=?,owner_role=?,status=IF(status='detected','teacher_follow_up',status),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [actor.id, actor.role, actor.id, schoolId, record.id])
    await db.query(`INSERT INTO learner_support_case_assignments (public_ref,school_id,case_id,assigned_user_id,assignment_type,assignment_status,action_label,due_at,acknowledged_at,assigned_by) VALUES (UUID(),?,?,?,'owner','acknowledged','Own and coordinate learner support',?,CURRENT_TIMESTAMP,?) ON DUPLICATE KEY UPDATE assignment_status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP`, [schoolId, record.id, actor.id, record.next_review_at, actor.id])
    await event(db, schoolId, record, actor, "case_ownership_accepted", "An authorised teacher accepted ownership of the learner-support case.", { idempotencyKey: body.idempotency_key || `accept-owner:${record.id}:${actor.id}:${record.version_number}` })
    return { case_ref: record.public_ref, owner_user_id: actor.id, version_number: number(record.version_number) + 1 }
  })
}

export async function requestSupportReassignment(schoolId, caseId, actor, body = {}) {
  const result = await inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "assignments")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.requestReassignment)
    const explanation = String(body.explanation || body.reason || "").trim()
    if (!explanation) throw new HttpError(400, "Explain why reassignment is needed.")
    await db.query("UPDATE learner_support_case_assignments SET assignment_status='reassignment_requested' WHERE school_id=? AND case_id=? AND assigned_user_id=? AND assignment_status<>'removed'", [schoolId, record.id, actor.id])
    await event(db, schoolId, record, actor, "case_reassignment_requested", `The assigned teacher requested reassignment: ${explanation.slice(0, 360)}`, { idempotencyKey: body.idempotency_key || `reassign-request:${record.id}:${actor.id}:${record.version_number}`, evidence: { requested_owner_user_id: body.requested_owner_user_id || null } })
    return { record, response: { case_ref: record.public_ref, status: "reassignment_requested" } }
  })
  const [reviewers] = await pool.query("SELECT id FROM users WHERE school_id=? AND is_active=1 AND (role='headteacher' OR (role='teacher' AND role_type IN ('deputy_headteacher','admin_teacher'))) ORDER BY id", [schoolId])
  for (const reviewer of reviewers) await createInAppNotification({ schoolId, recipientUserId: reviewer.id, title: "Learner-support reassignment requested", message: "A teacher requested reassignment of a learner-support case.", category: "academics", priority: "high", linkedEntityType: "learner_support_case", linkedEntityId: result.record.id, createdBy: actor.id, ruleKey: `support_reassignment:${result.record.id}:${reviewer.id}`, dedupeWindow: String(result.record.version_number) })
  return result.response
}

export async function addSupportNote(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "notes")
    const { record, access } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.addNote)
    const noteText = String(body.note_text || body.note || "").trim()
    if (!noteText) throw new HttpError(400, "Academic note text is required.")
    let visibility = String(body.visibility || "teacher_academic")
    const allowed = access.isHeadteacher ? ["teacher_academic", "support_team", "coordinator_only", "headteacher_only", "guardian_meeting", "administrative_restricted"] : access.isCoordinator ? ["teacher_academic", "support_team", "coordinator_only", "guardian_meeting"] : access.relationships.includes("support_teacher") || access.relationships.includes("owner") ? ["teacher_academic", "support_team"] : ["teacher_academic"]
    if (!allowed.includes(visibility)) throw new HttpError(403, "You cannot create a note with that visibility.")
    const ref = randomUUID()
    await db.query("INSERT INTO learner_support_case_notes (public_ref,school_id,case_id,term_id,author_user_id,visibility,note_text) VALUES (?,?,?,?,?,?,?)", [ref, schoolId, record.id, record.current_term_id, actor.id, visibility, noteText])
    await event(db, schoolId, record, actor, "academic_note_added", "An authorised academic note was added to the support case.", { idempotencyKey: body.idempotency_key || `note:${ref}`, linkedType: "learner_support_case_note", linkedRef: ref, evidence: { visibility } })
    return { public_ref: ref, visibility, created: true }
  })
}

export async function createCaseTargetedAssessment(schoolId, caseId, actor, body = {}) {
  const access = await canAccessLearnerSupportCase({ userId: actor?.id, schoolId, caseId, requestedAction: SUPPORT_ACTIONS.createAssessment, actorRole: actor?.role })
  if (!access.allowed || !access.case) throw new HttpError(403, "You are not authorised to create an assessment for this case.")
  const record = access.case
  if (record.case_type === "multi_subject_decline" || !record.class_id || !record.subject_id || !record.primary_topic_id) {
    throw new HttpError(409, "A cross-subject support case cannot create one targeted assessment. Open a subject-specific support case first.", { code: "SUBJECT_SPECIFIC_SUPPORT_CASE_REQUIRED" })
  }
  const [memberRows, [cycleRows]] = await Promise.all([
    pool.query("SELECT student.public_ref student_ref FROM learner_support_case_members case_member JOIN students student ON student.school_id=case_member.school_id AND student.id=case_member.learner_id WHERE case_member.school_id=? AND case_member.case_id=? AND case_member.membership_status='active'", [schoolId, record.id]).then(([rows]) => rows),
    pool.query("SELECT legacy_intervention_id,success_criterion_json FROM intervention_cycles WHERE school_id=? AND case_id=? ORDER BY cycle_number DESC LIMIT 1", [schoolId, record.id]),
  ])
  const learnerRefs = [...new Set([...(record.learner_id ? (await pool.query("SELECT public_ref FROM students WHERE school_id=? AND id=?", [schoolId, record.learner_id]))[0].map((row) => row.public_ref) : []), ...memberRows.map((row) => row.student_ref)])]
  const latestCycle = cycleRows[0]
  return createTargetedAssessmentDraft(schoolId, actor, {
    ...body,
    class_id: record.class_id,
    subject_id: record.subject_id,
    topic_id: record.primary_topic_id,
    academic_year_id: record.academic_year_id,
    term_id: record.current_term_id,
    intervention_id: latestCycle?.legacy_intervention_id || null,
    purpose: body.purpose || (latestCycle ? "intervention_reassessment" : "intervention_baseline"),
    title: body.title || `${body.topic_name || "Learner support"} targeted assessment`,
    target_objectives: record.primary_objective_id ? [record.primary_objective_id] : [],
    previous_evidence: { support_case_ref: record.public_ref, evidence_confidence: record.evidence_confidence, current_summary: record.current_summary },
    learners: learnerRefs.map((student_ref) => ({ student_ref, reason: "Included in the authorised learner-support case", evidence: { support_case_ref: record.public_ref }, confidence: record.evidence_confidence })),
  })
}

export async function assignSupportCase(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "assignments")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.assign)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const ownerId = number(body.owner_user_id)
    const owner = await validateSupportCaseOwner(db, schoolId, record, ownerId)
    await db.query("UPDATE learner_support_cases SET owner_user_id=?,owner_role=?,status=IF(status='detected','teacher_follow_up',status),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [owner.id, owner.role, actor.id, schoolId, record.id])
    await db.query(`INSERT INTO learner_support_case_assignments (public_ref,school_id,case_id,assigned_user_id,assignment_type,assignment_status,action_label,due_at,assigned_by) VALUES (UUID(),?,?,?,'owner','assigned',?,?,?) ON DUPLICATE KEY UPDATE assignment_status='assigned',action_label=VALUES(action_label),due_at=VALUES(due_at),acknowledged_at=NULL,completed_at=NULL,assigned_by=VALUES(assigned_by)`, [schoolId, record.id, owner.id, body.action_label || "Own and coordinate learner support", body.due_at || record.next_review_at, actor.id])
    await event(db, schoolId, record, actor, "case_assigned", "The learner support case was assigned for follow-up.", { idempotencyKey: body.idempotency_key || `assign:${record.id}:${owner.id}:${record.version_number}`, evidence: { owner_user_id: owner.id, owner_role: owner.role } })
    await createInAppNotification({ schoolId, recipientUserId: owner.id, title: "New learner-support case assigned", message: body.notification_message || "A learner-support case now requires your acknowledgement and follow-up.", category: "academics", priority: record.severity === "urgent" ? "urgent" : "high", linkedEntityType: "learner_support_case", linkedEntityId: record.id, createdBy: actor.id, ruleKey: `support_case_assignment:${record.id}:${owner.id}`, dedupeWindow: String(record.version_number) })
    return { public_ref: record.public_ref, owner_user_id: owner.id, status: record.status === "detected" ? "teacher_follow_up" : record.status, version_number: number(record.version_number) + 1 }
  })
}

async function strategyByCode(db, schoolId, requested, prior = []) {
  const recommendation = recommendAlternativeStrategy(prior)
  const code = String(requested || recommendation.strategy_code)
  const [[strategy]] = await db.query("SELECT * FROM intervention_strategy_types WHERE school_id=? AND strategy_code=? AND status='active' LIMIT 1", [schoolId, code])
  if (!strategy) throw new HttpError(400, "Intervention strategy is not configured for this school.")
  return strategy
}

export async function createSupportIntervention(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.createIntervention)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    if (!ACTIVE_CASE_STATUSES.has(record.status)) throw new HttpError(409, "A closed case cannot start another intervention cycle.")
    const { policy } = await activePolicy(schoolId, db)
    const [prior] = await db.query("SELECT ist.strategy_code,ic.outcome FROM intervention_cycles ic JOIN intervention_strategy_types ist ON ist.id=ic.strategy_type_id AND ist.school_id=ic.school_id WHERE ic.school_id=? AND ic.case_id=? ORDER BY ic.cycle_number", [schoolId, record.id])
    const strategy = await strategyByCode(db, schoolId, body.strategy_code, prior)
    const last = prior.at(-1)
    if (last && last.strategy_code === strategy.strategy_code && ["ineffective", "partially_effective"].includes(last.outcome) && !body.authorised_repeat_reason) throw new HttpError(409, "The last support cycle used this strategy without sufficient improvement. Select a different strategy or record an authorised reason.")
    const cycleNumber = number(record.intervention_cycle_count) + 1
    const plannedDates = Array.isArray(body.session_dates) ? body.session_dates.filter(Boolean) : []
    const plannedCount = Math.max(plannedDates.length, number(body.planned_session_count, plannedDates.length || 1))
    const ownerId = number(body.owner_user_id || record.owner_user_id || actor.id)
    const owner = await validateSupportCaseOwner(db, schoolId, record, ownerId)
    const interventionRef = randomUUID()
    const interventionType = record.scope_type === "class" ? "whole_class_revision" : record.scope_type === "group" ? "small_group_support" : "individual_remediation"
    const [legacyResult] = await db.query(`INSERT INTO academic_interventions (public_ref,school_id,student_id,class_id,subject_id,topic_id,term_id,intervention_type,issue,evidence_json,assigned_teacher_id,priority,start_date,review_date,action_plan,parent_notification_status,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [interventionRef, schoolId, record.learner_id, record.class_id, record.subject_id, record.primary_topic_id, record.current_term_id, interventionType, record.current_summary, JSON.stringify({ support_case_ref: record.public_ref }), ownerId, record.severity, body.start_date || dateOnly(), body.review_date || addDays(14), String(body.action_plan || `${strategy.label}: ${strategy.description || "structured support"}`), "not_required", "active", actor.id])
    const cycleRef = randomUUID()
    await db.query(`INSERT INTO intervention_cycles (public_ref,school_id,case_id,term_id,legacy_intervention_id,cycle_number,strategy_type_id,owner_user_id,planned_session_count,success_criterion_json,delivery_threshold,attendance_threshold,start_date,review_date,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [cycleRef, schoolId, record.id, record.current_term_id, legacyResult.insertId, cycleNumber, strategy.id, ownerId, plannedCount, JSON.stringify(body.success_criterion || { mastery_threshold: number(body.mastery_threshold, policy.masteryThreshold), minimum_meaningful_change: number(body.minimum_meaningful_change, 5) }), number(body.delivery_threshold, policy.minimumSupportDeliveryRate), number(body.attendance_threshold, policy.minimumSupportAttendanceRate), body.start_date || dateOnly(), body.review_date || addDays(policy.reviewWithinSchoolDays), "active", actor.id, actor.id])
    const [[cycle]] = await db.query("SELECT id FROM intervention_cycles WHERE school_id=? AND public_ref=?", [schoolId, cycleRef])
    for (let index = 0; index < plannedDates.length; index += 1) await db.query("INSERT INTO intervention_sessions (public_ref,school_id,term_id,cycle_id,session_number,scheduled_at,status,created_by,updated_by) VALUES (?,?,?,?,?,?,'planned',?,?)", [randomUUID(), schoolId, record.current_term_id, cycle.id, index + 1, plannedDates[index], actor.id, actor.id])
    await db.query("UPDATE learner_support_cases SET status='intervention_active',escalation_level=GREATEST(escalation_level,2),intervention_cycle_count=?,owner_user_id=?,owner_role=?,next_review_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [cycleNumber, ownerId, owner.role, body.review_date || addDays(14), actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "intervention_cycle_created", `Support cycle ${cycleNumber} was created using ${strategy.label}.`, { idempotencyKey: body.idempotency_key || `cycle:${record.id}:${cycleNumber}`, linkedType: "intervention_cycle", linkedRef: cycleRef, evidence: { strategy_code: strategy.strategy_code, planned_session_count: plannedCount } })
    return { public_ref: cycleRef, legacy_intervention_ref: interventionRef, cycle_number: cycleNumber, strategy_code: strategy.strategy_code, status: "active", case_version_number: number(record.version_number) + 1 }
  })
}

export async function recordSupportSession(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "sessionDetails")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.recordSession)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const [[cycle]] = await db.query("SELECT * FROM intervention_cycles WHERE school_id=? AND case_id=? AND (public_ref=? OR id=?) ORDER BY cycle_number DESC LIMIT 1 FOR UPDATE", [schoolId, record.id, String(body.cycle_ref || ""), number(body.cycle_id)])
    if (!cycle) throw new HttpError(404, "Intervention cycle was not found.")
    let session
    if (body.session_ref || body.session_id) {
      const [sessions] = await db.query("SELECT * FROM intervention_sessions WHERE school_id=? AND cycle_id=? AND (public_ref=? OR id=?) LIMIT 1 FOR UPDATE", [schoolId, cycle.id, String(body.session_ref || ""), number(body.session_id)])
      session = sessions[0]
    }
    if (!session) {
      const [plannedSessions] = await db.query("SELECT * FROM intervention_sessions WHERE school_id=? AND cycle_id=? AND status='planned' ORDER BY session_number LIMIT 1 FOR UPDATE", [schoolId, cycle.id])
      session = plannedSessions[0]
      if (!session) {
        const [[seq]] = await db.query("SELECT COALESCE(MAX(session_number),0)+1 next_number FROM intervention_sessions WHERE school_id=? AND cycle_id=?", [schoolId, cycle.id])
        const ref = randomUUID()
        await db.query("INSERT INTO intervention_sessions (public_ref,school_id,term_id,cycle_id,session_number,scheduled_at,status,created_by,updated_by) VALUES (?,?,?,?,?,?, 'planned',?,?)", [ref, schoolId, record.current_term_id, cycle.id, seq.next_number, body.scheduled_at || new Date(), actor.id, actor.id])
        const [createdSessions] = await db.query("SELECT * FROM intervention_sessions WHERE school_id=? AND public_ref=?", [schoolId, ref])
        session = createdSessions[0]
      }
    }
    const status = String(body.status || "completed")
    if (!["completed", "partially_completed", "cancelled", "learner_absent", "teacher_absent", "rescheduled", "planned", "missed"].includes(status)) throw new HttpError(400, "Session status is invalid.")
    const delivered = ["completed", "partially_completed"].includes(status)
    const targetTopicId = number(body.target_topic_id || record.primary_topic_id) || null
    const targetObjectiveId = number(body.target_objective_id || record.primary_objective_id) || null
    if (targetTopicId) await validateSyllabusTopicScope(db, { schoolId, subjectId: record.subject_id, topicId: targetTopicId, requireTopic: true })
    if (targetObjectiveId) {
      const [[objective]] = await db.query("SELECT id FROM learning_objectives WHERE school_id=? AND subject_id=? AND id=? AND (? IS NULL OR topic_id=?) AND is_active=1 LIMIT 1", [schoolId, record.subject_id, targetObjectiveId, targetTopicId, targetTopicId])
      if (!objective) throw new HttpError(400, "The selected learning objective does not belong to this support topic.")
    }
    await db.query(`UPDATE intervention_sessions SET status=?,scheduled_at=COALESCE(?,scheduled_at),completed_at=IF(?,COALESCE(?,CURRENT_TIMESTAMP),NULL),duration_minutes=?,delivery_method=?,target_topic_id=COALESCE(?,target_topic_id),target_objective_id=COALESCE(?,target_objective_id),teacher_attended=?,target_taught=?,prerequisite_addressed=?,resources_json=?,activities_json=?,teacher_notes=?,teacher_observation=?,practice_assigned=?,next_action=?,review_status=?,updated_by=? WHERE school_id=? AND id=?`, [status, body.scheduled_at || null, delivered, body.completed_at || null, body.duration_minutes || null, body.delivery_method || null, targetTopicId, targetObjectiveId, status === "teacher_absent" ? false : body.teacher_attended === undefined ? null : Boolean(body.teacher_attended), body.target_taught === undefined ? null : Boolean(body.target_taught), body.prerequisite_addressed === undefined ? null : Boolean(body.prerequisite_addressed), JSON.stringify(body.resources || []), JSON.stringify(body.activities || []), body.teacher_notes || null, body.teacher_observation || null, body.practice_assigned || null, body.next_action || null, body.review_status || "pending", actor.id, schoolId, session.id])
    for (const attendance of Array.isArray(body.attendance) ? body.attendance : []) {
      let learnerId = number(attendance.learner_id)
      if (!learnerId && attendance.learner_ref) {
        const [[learner]] = await db.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, String(attendance.learner_ref)])
        learnerId = number(learner?.id)
      }
      if (!learnerId) throw new HttpError(400, "Every support-attendance record must identify a learner in this case.")
      const attendanceStatus = String(attendance.status || "not_recorded")
      if (!["present", "absent", "late", "excused", "not_recorded"].includes(attendanceStatus)) throw new HttpError(400, "Support attendance status is invalid.")
      const [[member]] = await db.query("SELECT id FROM learner_support_case_members WHERE school_id=? AND case_id=? AND learner_id=? AND membership_status='active' LIMIT 1", [schoolId, record.id, learnerId])
      if (!member && number(record.learner_id) !== learnerId) throw new HttpError(400, "Session attendance contains a learner outside this support case.")
      await db.query(`INSERT INTO intervention_session_attendance (public_ref,school_id,session_id,learner_id,attendance_status,note,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE attendance_status=VALUES(attendance_status),note=VALUES(note),updated_by=VALUES(updated_by)`, [randomUUID(), schoolId, session.id, learnerId, attendanceStatus, attendance.note || null, actor.id, actor.id])
    }
    await event(db, schoolId, record, actor, "support_session_recorded", `Support session ${session.session_number} was recorded as ${status}.`, { idempotencyKey: body.idempotency_key || `session:${session.id}:${status}:${body.completed_at || dateOnly()}`, linkedType: "intervention_session", linkedRef: session.public_ref, evidence: { target_taught: body.target_taught, prerequisite_addressed: body.prerequisite_addressed } })
    return { public_ref: session.public_ref, status, cycle_ref: cycle.public_ref }
  })
}

export async function validateSupportReassessmentEvidence(db, schoolId, record, body = {}) {
  if (!body.generated_assessment_id && !body.generated_assessment_ref) {
    throw new HttpError(400, "An approved targeted assessment is required.")
  }
  const [[generated]] = await db.query(`SELECT generated.id,generated.public_ref,generated.status,generated.assessment_id,generated.intervention_id,generated.baseline_evidence_json
    FROM generated_assessments generated
    WHERE generated.school_id=? AND (generated.id=? OR generated.public_ref=?)
      AND generated.status IN ('approved','published')
      AND generated.class_id=? AND generated.subject_id=?
      AND generated.academic_year_id=? AND generated.term_id=?
      AND (? IS NULL OR generated.topic_id=?)
      AND (generated.assessment_id IS NULL OR EXISTS (
        SELECT 1 FROM assessments assessment
        WHERE assessment.school_id=generated.school_id AND assessment.id=generated.assessment_id
          AND assessment.class_id=generated.class_id AND assessment.subject_id=generated.subject_id
          AND assessment.academic_year_id=generated.academic_year_id AND assessment.term_id=generated.term_id
      ))
    LIMIT 1`, [schoolId, number(body.generated_assessment_id), String(body.generated_assessment_ref || ""),
    record.class_id, record.subject_id, record.academic_year_id, record.current_term_id,
    record.primary_topic_id || null, record.primary_topic_id || null])
  if (!generated) {
    throw new HttpError(400, "The targeted assessment must match this support case's class, subject, topic and academic session.")
  }

  const learnerIds = await supportCaseLearnerIds(db, schoolId, record)
  if (!learnerIds.length) throw new HttpError(400, "The support case has no active learners to compare against a baseline marksheet.")
  const suppliedBaseline = body.baseline_mark_sheet_id !== undefined && body.baseline_mark_sheet_id !== null && body.baseline_mark_sheet_id !== ""
    ? number(body.baseline_mark_sheet_id)
    : null
  if (body.baseline_mark_sheet_id !== undefined && body.baseline_mark_sheet_id !== null && body.baseline_mark_sheet_id !== "" && !suppliedBaseline) {
    throw new HttpError(400, "The baseline marksheet reference is invalid.")
  }
  const [[baseline]] = await db.query(`SELECT marksheet.id
    FROM academic_mark_sheets marksheet
    JOIN assessments assessment ON assessment.school_id=marksheet.school_id AND assessment.id=marksheet.assessment_id
    JOIN learner_assessment_entries learner_entry ON learner_entry.school_id=marksheet.school_id AND learner_entry.mark_sheet_id=marksheet.id
      AND learner_entry.is_official=1 AND learner_entry.participation_status='present'
      AND learner_entry.student_id IN (${learnerIds.map(() => "?").join(",")})
    JOIN learner_topic_results topic_result ON topic_result.school_id=learner_entry.school_id AND topic_result.mark_sheet_id=learner_entry.mark_sheet_id
      AND topic_result.learner_entry_id=learner_entry.id AND topic_result.student_id=learner_entry.student_id
      AND topic_result.topic_id=? AND topic_result.is_official=1
    WHERE marksheet.school_id=? AND marksheet.status IN ('published','locked')
      AND marksheet.class_id=? AND marksheet.subject_id=? AND marksheet.academic_year_id=? AND marksheet.term_id=?
      AND (? IS NULL OR marksheet.assessment_id<>?)
      AND assessment.class_id=marksheet.class_id AND assessment.subject_id=marksheet.subject_id
      AND assessment.academic_year_id=marksheet.academic_year_id AND assessment.term_id=marksheet.term_id
      ${suppliedBaseline ? "AND marksheet.id=?" : ""}
    GROUP BY marksheet.id,marksheet.published_at,marksheet.updated_at
    HAVING COUNT(DISTINCT learner_entry.student_id)=?
    ORDER BY COALESCE(marksheet.published_at,marksheet.updated_at) DESC,marksheet.id DESC LIMIT 1`,
  [...learnerIds, record.primary_topic_id, schoolId, record.class_id, record.subject_id, record.academic_year_id, record.current_term_id,
    generated.assessment_id || null, generated.assessment_id || null,
    ...(suppliedBaseline ? [suppliedBaseline] : []), learnerIds.length])
  if (!baseline) throw new HttpError(409, "Publish mapped baseline evidence for every learner in this support case before scheduling reassessment.")
  const baselineMarkSheetId = number(baseline.id)
  const [[targetCoverage]] = await db.query(`SELECT COUNT(DISTINCT student_id) matched_learners
    FROM generated_assessment_learners
    WHERE school_id=? AND generated_assessment_id=? AND confirmed_at IS NOT NULL
      AND student_id IN (${learnerIds.map(() => "?").join(",")})`, [schoolId, generated.id, ...learnerIds])
  if (number(targetCoverage?.matched_learners) !== learnerIds.length) {
    throw new HttpError(409, "The approved reassessment must target every active learner in this support case.")
  }
  return { generated, baselineMarkSheetId }
}

export async function scheduleSupportReassessment(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    await requireSupportSchemaCapability(db, "reassessmentDueAt")
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.scheduleReassessment)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const [[cycle]] = await db.query("SELECT * FROM intervention_cycles WHERE school_id=? AND case_id=? AND (public_ref=? OR id=? OR ?='') ORDER BY cycle_number DESC LIMIT 1 FOR UPDATE", [schoolId, record.id, String(body.cycle_ref || ""), number(body.cycle_id), String(body.cycle_ref || "")])
    if (!cycle) throw new HttpError(409, "Create an intervention cycle before scheduling reassessment.")
    const { generated, baselineMarkSheetId } = await validateSupportReassessmentEvidence(db, schoolId, record, body)
    const [[existingLink]] = await db.query(`SELECT id,public_ref,support_case_id,intervention_id,intervention_cycle_id,baseline_mark_sheet_id,outcome,reassessment_mark_sheet_id
      FROM academic_intervention_reassessments WHERE school_id=? AND generated_assessment_id=? LIMIT 1 FOR UPDATE`, [schoolId, generated.id])
    if (existingLink) {
      const generatedSupportCaseRef = String(json(generated.baseline_evidence_json).support_case_ref || "")
      const unlinkedLegacyRow = !number(existingLink.support_case_id) && !number(existingLink.intervention_cycle_id)
      const canClaimLegacyRow = unlinkedLegacyRow
        && generatedSupportCaseRef === String(record.public_ref)
        && number(generated.intervention_id) === number(cycle.legacy_intervention_id)
        && number(existingLink.intervention_id) === number(cycle.legacy_intervention_id)
        && number(existingLink.baseline_mark_sheet_id) === number(baselineMarkSheetId)
        && existingLink.outcome === "pending" && !existingLink.reassessment_mark_sheet_id
      if (canClaimLegacyRow) {
        const [claim] = await db.query(`UPDATE academic_intervention_reassessments
          SET support_case_id=?,intervention_cycle_id=?,success_criterion_json=?,comparability_json=?,due_at=?
          WHERE school_id=? AND id=? AND support_case_id IS NULL AND intervention_cycle_id IS NULL AND outcome='pending' AND reassessment_mark_sheet_id IS NULL`, [record.id, cycle.id, JSON.stringify(json(cycle.success_criterion_json)), JSON.stringify({ status: "pending_server_evaluation" }), body.due_date || addDays(5), schoolId, existingLink.id])
        if (!claim.affectedRows) throw new HttpError(409, "This targeted reassessment link changed while it was being scheduled. Refresh and try again.", { code: "STALE_SUPPORT_REASSESSMENT_LINK" })
      } else {
      const sameLink = number(existingLink.support_case_id) === number(record.id)
        && number(existingLink.intervention_cycle_id) === number(cycle.id)
        && number(existingLink.intervention_id) === number(cycle.legacy_intervention_id)
        && number(existingLink.baseline_mark_sheet_id) === number(baselineMarkSheetId)
      if (!sameLink) throw new HttpError(409, "This targeted reassessment is already linked to a different support case, cycle or baseline. Create a separate reassessment for this cycle.", { code: "SUPPORT_REASSESSMENT_ALREADY_LINKED" })
      if (existingLink.outcome !== "pending" || existingLink.reassessment_mark_sheet_id) throw new HttpError(409, "This reassessment link has already been evaluated. Reopen its marksheet for correction or create a new reassessment.")
      return { case_ref: record.public_ref, cycle_ref: cycle.public_ref, status: "reassessment_pending", duplicate: true, reassessment_ref: existingLink.public_ref }
      }
    } else {
      await db.query(`INSERT INTO academic_intervention_reassessments (public_ref,school_id,support_case_id,intervention_id,intervention_cycle_id,generated_assessment_id,baseline_mark_sheet_id,success_criterion_json,comparability_json,due_at,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`, [randomUUID(), schoolId, record.id, cycle.legacy_intervention_id, cycle.id, generated.id, baselineMarkSheetId, JSON.stringify(json(cycle.success_criterion_json)), JSON.stringify({ status: "pending_server_evaluation" }), body.due_date || addDays(5)])
    }
    await db.query("UPDATE intervention_cycles SET status='awaiting_reassessment',version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [actor.id, schoolId, cycle.id])
    await db.query("UPDATE learner_support_cases SET status='reassessment_pending',next_review_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [body.due_date || addDays(5), actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "reassessment_scheduled", "A targeted reassessment was linked to this support cycle.", { idempotencyKey: body.idempotency_key || `reassessment:${record.id}:${generated.public_ref}`, linkedType: "generated_assessment", linkedRef: generated.public_ref })
    return { case_ref: record.public_ref, cycle_ref: cycle.public_ref, status: "reassessment_pending" }
  })
}

async function supportCaseLearnerIds(db, schoolId, record) {
  const [members] = await db.query("SELECT learner_id FROM learner_support_case_members WHERE school_id=? AND case_id=? AND membership_status='active'", [schoolId, record.id])
  let learnerIds = [...new Set([record.learner_id, ...members.map((row) => row.learner_id)].map(number).filter(Boolean))]
  if (!learnerIds.length && record.class_id) {
    const [enrollments] = await db.query(`SELECT student_id learner_id FROM student_enrollments
      WHERE school_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND enrollment_status='active'`,
    [schoolId, record.class_id, record.academic_year_id, record.current_term_id])
    learnerIds = [...new Set(enrollments.map((row) => number(row.learner_id)).filter(Boolean))]
  }
  return learnerIds
}

async function officialTopicEvidenceRows(db, schoolId, markSheetId, topicId) {
  if (!number(markSheetId) || !number(topicId)) return []
  const [rows] = await db.query(`SELECT topic_result.student_id,topic_result.topic_id,NULL objective_id,
      topic_result.evidence_level evidence_precision,'valid' evidence_status,marksheet.status publication_state,
      topic_result.marks_awarded,topic_result.marks_available,
      COALESCE(topic_result.percentage,topic_result.marks_awarded/NULLIF(topic_result.marks_available,0)*100) score_percentage,
      CASE LOWER(assessment.expected_difficulty) WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 ELSE NULL END difficulty,
      assessment.assessment_type assessment_format,COALESCE(marksheet.published_at,marksheet.updated_at) observed_at
    FROM academic_mark_sheets marksheet
    JOIN assessments assessment ON assessment.school_id=marksheet.school_id AND assessment.id=marksheet.assessment_id
    JOIN learner_assessment_entries learner_entry ON learner_entry.school_id=marksheet.school_id AND learner_entry.mark_sheet_id=marksheet.id
      AND learner_entry.is_official=1 AND learner_entry.participation_status='present'
    JOIN learner_topic_results topic_result ON topic_result.school_id=learner_entry.school_id AND topic_result.mark_sheet_id=learner_entry.mark_sheet_id
      AND topic_result.learner_entry_id=learner_entry.id AND topic_result.student_id=learner_entry.student_id
      AND topic_result.topic_id=? AND topic_result.is_official=1
    JOIN syllabus_topics topic ON topic.school_id=topic_result.school_id AND topic.id=topic_result.topic_id AND topic.subject_id=marksheet.subject_id
    WHERE marksheet.school_id=? AND marksheet.id=? AND marksheet.status IN ('published','locked')
      AND assessment.class_id=marksheet.class_id AND assessment.subject_id=marksheet.subject_id
      AND assessment.academic_year_id<=>marksheet.academic_year_id AND assessment.term_id<=>marksheet.term_id`, [topicId, schoolId, markSheetId])
  return rows
}

function markSheetMatchesSupportCase(link, prefix, record) {
  const id = number(link?.[`${prefix}_mark_sheet_id`])
  if (!id || !["published", "locked"].includes(String(link?.[`${prefix}_status`] || ""))) return false
  const same = (left, right) => number(left) === number(right)
  return same(link[`${prefix}_class_id`], record.class_id)
    && same(link[`${prefix}_subject_id`], record.subject_id)
    && same(link[`${prefix}_academic_year_id`], record.academic_year_id)
    && same(link[`${prefix}_term_id`], record.current_term_id)
}

async function persistedReassessmentContext(db, schoolId, record, selector = {}, policyInput = {}) {
  const where = ["reassessment.school_id=?", "reassessment.support_case_id=?"]
  const params = [schoolId, record.id]
  if (selector.reassessmentId) { where.push("reassessment.id=?"); params.push(number(selector.reassessmentId)) }
  if (selector.cycleId) { where.push("reassessment.intervention_cycle_id=?"); params.push(number(selector.cycleId)) }
  const [[link]] = await db.query(`SELECT reassessment.id reassessment_id,reassessment.public_ref reassessment_ref,
      reassessment.intervention_id,reassessment.intervention_cycle_id,reassessment.generated_assessment_id generated_assessment_record_id,
      reassessment.baseline_mark_sheet_id,reassessment.reassessment_mark_sheet_id,reassessment.success_criterion_json,
      reassessment.comparability_json,reassessment.outcome persisted_outcome,reassessment.evaluated_at,
      linked_cycle.id linked_cycle_id,linked_cycle.success_criterion_json cycle_success_criterion_json,
      generated_assessment.topic_id generated_topic_id,generated_assessment.assessment_id generated_published_assessment_id,
      generated_assessment.class_id generated_class_id,generated_assessment.subject_id generated_subject_id,
      generated_assessment.academic_year_id generated_academic_year_id,generated_assessment.term_id generated_term_id,
      baseline_sheet.status baseline_status,baseline_sheet.class_id baseline_class_id,baseline_sheet.subject_id baseline_subject_id,
      baseline_sheet.academic_year_id baseline_academic_year_id,baseline_sheet.term_id baseline_term_id,
      reassessment_sheet.status reassessment_status,reassessment_sheet.class_id reassessment_class_id,
      reassessment_sheet.subject_id reassessment_subject_id,reassessment_sheet.academic_year_id reassessment_academic_year_id,
      reassessment_sheet.term_id reassessment_term_id,reassessment_sheet.assessment_id reassessment_assessment_id
    FROM academic_intervention_reassessments reassessment
    LEFT JOIN intervention_cycles linked_cycle ON linked_cycle.school_id=reassessment.school_id AND linked_cycle.id=reassessment.intervention_cycle_id AND linked_cycle.case_id=reassessment.support_case_id
    LEFT JOIN generated_assessments generated_assessment ON generated_assessment.school_id=reassessment.school_id AND generated_assessment.id=reassessment.generated_assessment_id
    LEFT JOIN academic_mark_sheets baseline_sheet ON baseline_sheet.school_id=reassessment.school_id AND baseline_sheet.id=reassessment.baseline_mark_sheet_id
    LEFT JOIN academic_mark_sheets reassessment_sheet ON reassessment_sheet.school_id=reassessment.school_id AND reassessment_sheet.id=reassessment.reassessment_mark_sheet_id
    WHERE ${where.join(" AND ")}
    ORDER BY reassessment.created_at DESC,reassessment.id DESC LIMIT 1`, params)
  if (!link) return null
  if (!number(link.linked_cycle_id)) return null
  const topicId = number(record.primary_topic_id || link.generated_topic_id)
  const expectedLearnerIds = await supportCaseLearnerIds(db, schoolId, record)
  const [targetRows] = await db.query(`SELECT student_id FROM generated_assessment_learners
    WHERE school_id=? AND generated_assessment_id=? AND confirmed_at IS NOT NULL`, [schoolId, link.generated_assessment_record_id])
  const targetedLearners = new Set(targetRows.map((row) => number(row.student_id)).filter(Boolean))
  const targetedLearnerCoverage = expectedLearnerIds.length > 0 && expectedLearnerIds.every((studentId) => targetedLearners.has(studentId))
  const generatedMatches = number(link.generated_class_id) === number(record.class_id)
    && number(link.generated_subject_id) === number(record.subject_id)
    && number(link.generated_academic_year_id) === number(record.academic_year_id)
    && number(link.generated_term_id) === number(record.current_term_id)
    && number(link.generated_topic_id) === topicId
  const baselineMatches = markSheetMatchesSupportCase(link, "baseline", record)
  const reassessmentMatches = generatedMatches && targetedLearnerCoverage && markSheetMatchesSupportCase(link, "reassessment", record)
    && number(link.reassessment_assessment_id) === number(link.generated_published_assessment_id)
  const [baselineRows, reassessmentRows] = await Promise.all([
    baselineMatches ? officialTopicEvidenceRows(db, schoolId, link.baseline_mark_sheet_id, topicId) : [],
    reassessmentMatches ? officialTopicEvidenceRows(db, schoolId, link.reassessment_mark_sheet_id, topicId) : [],
  ])
  const criterion = { ...json(link.success_criterion_json), ...json(link.cycle_success_criterion_json), ...json(selector.cycleSuccessCriterion) }
  const minimumMeaningfulChange = number(criterion.minimum_meaningful_change ?? criterion.minimum_change, 5)
  const evidence = summarizeOfficialReassessmentEvidence({ expectedLearnerIds, baselineRows, reassessmentRows, minimumMeaningfulChange }, policyInput)
  return {
    link,
    criterion,
    evidence: {
      ...evidence,
      baselineMarkSheetId: baselineMatches ? number(link.baseline_mark_sheet_id) : null,
      reassessmentMarkSheetId: reassessmentMatches ? number(link.reassessment_mark_sheet_id) : null,
      targetedLearnerCoverage,
      evidenceSource: "published_official_topic_marksheets",
    },
  }
}

export async function derivePersistedSupportCycleOutcome(db, schoolId, record, cycle, policyInput = {}, options = {}) {
  const policy = normalizeEscalationPolicy(policyInput)
  const delivery = await getInterventionDeliveryMetrics(db, schoolId, cycle.id)
  const persisted = await persistedReassessmentContext(db, schoolId, record, { reassessmentId: options.reassessmentId, cycleId: cycle.id, cycleSuccessCriterion: cycle.success_criterion_json }, policy)
  const evidence = persisted?.evidence || {
    reassessmentPublished: false, reassessmentComparable: false, baselineScore: null, reassessmentScore: null,
    improvedComponents: [], unchangedComponents: [], expectedLearnerCount: 0, comparableLearnerCount: 0,
    comparisons: [], targetedLearnerCoverage: false, evidenceSource: "published_official_topic_marksheets",
  }
  const criterion = persisted?.criterion || json(cycle.success_criterion_json)
  const strategyRepeated = await supportStrategyWasRepeated(db, schoolId, cycle)
  const evaluated = evaluateInterventionDelivery({
    plannedSessions: cycle.planned_session_count,
    completedSessions: delivery.deliveredSessions,
    attendanceEligible: delivery.attendanceEligible,
    attendedSessions: delivery.attendedSessions,
    reassessmentPublished: evidence.reassessmentPublished,
    reassessmentComparable: evidence.reassessmentComparable,
    baselineScore: evidence.baselineScore,
    reassessmentScore: evidence.reassessmentScore,
    successCriterion: number(criterion.mastery_threshold ?? criterion.success_threshold, policy.masteryThreshold),
    minimumMeaningfulChange: number(criterion.minimum_meaningful_change ?? criterion.minimum_change, 5),
    improvedComponents: evidence.improvedComponents,
    unchangedComponents: evidence.unchangedComponents,
    strategyRepeated,
  }, {
    ...policy,
    minimumSupportDeliveryRate: number(cycle.delivery_threshold, policy.minimumSupportDeliveryRate),
    minimumSupportAttendanceRate: number(cycle.attendance_threshold, policy.minimumSupportAttendanceRate),
  })
  const diagnostic = { ...evaluated, persistedEvidence: evidence, reassessmentRef: persisted?.link.reassessment_ref || null }
  let cycleStatus = "completed"; let cycleOutcome = diagnostic.outcome
  if (["incomplete_delivery", "insufficient_participation", "inconclusive"].includes(diagnostic.outcome)) {
    cycleStatus = diagnostic.outcome
    cycleOutcome = diagnostic.outcome === "inconclusive" ? "inconclusive" : "not_classified"
  }
  if (diagnostic.outcome === "awaiting_reassessment") { cycleStatus = "awaiting_reassessment"; cycleOutcome = "pending" }
  const outcomeWasAlreadyApplied = Boolean(persisted?.link.evaluated_at
    && ["effective", "partially_effective", "ineffective", "inconclusive"].includes(String(cycle.outcome || ""))
    && String(cycle.outcome) === String(cycleOutcome))
  const transition = outcomeWasAlreadyApplied
    ? { status: record.status, level: number(record.escalation_level), unsuccessfulCycles: number(record.unsuccessful_cycle_count), successfulCycles: number(record.successful_cycle_count) }
    : deriveSupportCaseOutcomeTransition(record, diagnostic, policy)
  return { persisted, evidence, criterion, diagnostic, cycleStatus, cycleOutcome, transition, outcomeWasAlreadyApplied }
}

async function derivePersistedResolutionEvidence(db, schoolId, record, policy) {
  const [rows] = await db.query(`SELECT id,intervention_cycle_id FROM academic_intervention_reassessments
    WHERE school_id=? AND support_case_id=? AND baseline_mark_sheet_id IS NOT NULL AND reassessment_mark_sheet_id IS NOT NULL
    ORDER BY evaluated_at DESC,created_at DESC,id DESC`, [schoolId, record.id])
  const seenMarkSheets = new Set(); const successful = []; const published = []
  for (const row of rows) {
    const context = await persistedReassessmentContext(db, schoolId, record, { reassessmentId: row.id }, policy)
    if (!context?.evidence.reassessmentPublished || !context.evidence.reassessmentMarkSheetId) continue
    if (seenMarkSheets.has(context.evidence.reassessmentMarkSheetId)) continue
    seenMarkSheets.add(context.evidence.reassessmentMarkSheetId)
    published.push(context)
    const successCriterion = number(context.criterion.mastery_threshold ?? context.criterion.success_threshold, policy.masteryThreshold)
    if (context.evidence.reassessmentComparable && context.evidence.reassessmentScore !== null && context.evidence.reassessmentScore >= successCriterion) successful.push(context)
  }
  const latestSuccessfulAt = successful
    .flatMap((context) => context.evidence.comparisons || [])
    .map((comparison) => comparison.observed_at)
    .filter(Boolean)
    .reduce((latest, value) => !latest || new Date(value).getTime() > new Date(latest).getTime() ? value : latest, null)
  const [[outcomeReview], [completedMeeting]] = await Promise.all([
    db.query(`SELECT occurred_at reviewed_at FROM learner_support_case_events
      WHERE school_id=? AND case_id=? AND event_type='intervention_outcome_reviewed'
      ORDER BY occurred_at DESC,id DESC LIMIT 1`, [schoolId, record.id]).then(([reviewRows]) => reviewRows),
    db.query(`SELECT updated_at reviewed_at FROM academic_review_meetings
      WHERE school_id=? AND case_id=? AND status='completed' AND approved_by IS NOT NULL
      ORDER BY updated_at DESC,id DESC LIMIT 1`, [schoolId, record.id]).then(([meetingRows]) => meetingRows),
  ])
  const reviewedAt = [outcomeReview?.reviewed_at, completedMeeting?.reviewed_at].filter(Boolean)
    .reduce((latest, value) => !latest || new Date(value).getTime() > new Date(latest).getTime() ? value : latest, null)
  const teacherReviewCompleted = Boolean(reviewedAt && (!latestSuccessfulAt || new Date(reviewedAt).getTime() >= new Date(latestSuccessfulAt).getTime()))
  return {
    reassessmentPublished: published.length > 0,
    publishedReassessmentCount: published.length,
    comparableSuccessCount: successful.length,
    teacherReviewCompleted,
    reviewedAt,
    requiredComparableSuccessCount: policy.resolutionComparableEvidenceCount,
    reassessmentRefs: published.map((context) => context.link.reassessment_ref),
  }
}

export async function reviewSupportOutcome(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.reviewOutcome)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const { row: policyRow, policy } = await activePolicy(schoolId, db)
    const [[cycle]] = await db.query("SELECT ic.*,ist.strategy_code FROM intervention_cycles ic JOIN intervention_strategy_types ist ON ist.id=ic.strategy_type_id AND ist.school_id=ic.school_id WHERE ic.school_id=? AND ic.case_id=? AND (ic.public_ref=? OR ic.id=? OR ?='') ORDER BY ic.cycle_number DESC LIMIT 1 FOR UPDATE", [schoolId, record.id, String(body.cycle_ref || ""), number(body.cycle_id), String(body.cycle_ref || "")])
    if (!cycle) throw new HttpError(404, "Intervention cycle was not found.")
    const { persisted, evidence, diagnostic, cycleStatus, cycleOutcome, transition } = await derivePersistedSupportCycleOutcome(db, schoolId, record, cycle, policy)
    const nextStatus = transition.status; const nextLevel = transition.level
    const unsuccessful = transition.unsuccessfulCycles; const successful = transition.successfulCycles
    await db.query("UPDATE intervention_cycles SET status=?,outcome=?,diagnostic_json=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [cycleStatus, cycleOutcome, JSON.stringify(diagnostic), actor.id, schoolId, cycle.id])
    await db.query("UPDATE academic_interventions SET status=?,outcome=?,reassessment_summary_json=?,completed_by=IF(?='completed',?,completed_by),completed_at=IF(?='completed',CURRENT_TIMESTAMP,completed_at) WHERE school_id=? AND id=?", [cycleStatus === "completed" ? "completed" : "review_due", ["effective", "partially_effective"].includes(diagnostic.outcome) ? "improved" : diagnostic.outcome === "ineffective" ? "unchanged" : "inconclusive", JSON.stringify(diagnostic), cycleStatus, actor.id, cycleStatus, schoolId, cycle.legacy_intervention_id])
    if (persisted?.link.reassessment_id) {
      const persistedOutcome = ["effective", "partially_effective", "ineffective", "inconclusive"].includes(diagnostic.outcome) ? diagnostic.outcome : diagnostic.outcome === "awaiting_reassessment" ? "pending" : "inconclusive"
      await db.query(`UPDATE academic_intervention_reassessments SET outcome=?,comparability_json=?,outcome_summary_json=?,
        evaluated_at=IF(?='pending',evaluated_at,CURRENT_TIMESTAMP),evaluated_by=IF(?='pending',evaluated_by,?)
        WHERE school_id=? AND id=?`, [persistedOutcome, JSON.stringify({ comparable: evidence.reassessmentComparable, comparisons: evidence.comparisons, evidence_source: evidence.evidenceSource }), JSON.stringify(diagnostic), persistedOutcome, persistedOutcome, actor.id, schoolId, persisted.link.reassessment_id])
    }
    await db.query("UPDATE learner_support_cases SET status=?,escalation_level=?,unsuccessful_cycle_count=?,successful_cycle_count=?,last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=?,current_summary=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [nextStatus, nextLevel, unsuccessful, successful, addDays(policy.reviewWithinSchoolDays), `${record.current_summary} Latest support-cycle outcome: ${diagnostic.outcome.replaceAll("_", " ")}.`, actor.id, schoolId, record.id])
    await db.query(`INSERT INTO escalation_decisions (public_ref,school_id,term_id,case_id,cycle_id,policy_id,from_level,to_level,decision_type,trigger_json,diagnostic_json,human_approval_required,approval_status,idempotency_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [randomUUID(), schoolId, record.current_term_id, record.id, cycle.id, policyRow?.id, record.escalation_level, nextLevel, nextLevel > record.escalation_level ? "escalate" : diagnostic.outcome === "effective" ? "deescalate" : "continue", JSON.stringify({ outcome: diagnostic.outcome, unsuccessful_cycles: unsuccessful }), JSON.stringify(diagnostic), nextLevel >= 5 ? 1 : 0, nextLevel >= 5 ? "pending" : "not_required", body.idempotency_key || `review:${record.id}:${cycle.id}:${cycle.version_number}`, actor.id, actor.id])
    await event(db, schoolId, record, actor, "intervention_outcome_reviewed", `Support cycle ${cycle.cycle_number} was classified as ${diagnostic.outcome.replaceAll("_", " ")}.`, { idempotencyKey: body.idempotency_key ? `${body.idempotency_key}:event` : `review-event:${record.id}:${cycle.id}:${cycle.version_number}`, linkedType: "intervention_cycle", linkedRef: cycle.public_ref, evidence: diagnostic, status: nextStatus })
    return { case_ref: record.public_ref, cycle_ref: cycle.public_ref, status: nextStatus, escalation_level: nextLevel, diagnostic, next_strategy: recommendAlternativeStrategy([{ strategy_code: cycle.strategy_code }]) }
  })
}

async function simpleCaseTransition(schoolId, caseId, actor, body, options) {
  return inTransaction(async (db) => {
    const { record } = await lockedCase(db, schoolId, caseId, actor, options.requestedAction)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    if (options.allowed && !options.allowed.includes(record.status)) throw new HttpError(409, options.invalidMessage || "This case cannot make that transition.")
    const next = typeof options.next === "function" ? await options.next(record, body, db) : options.next
    await db.query(`UPDATE learner_support_cases SET status=?,escalation_level=?,last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=?,closed_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?`, [next.status, next.level, next.nextReview || null, next.closed ? new Date() : null, actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, options.eventType, options.summary(record, body), { idempotencyKey: body.idempotency_key || `${options.eventType}:${record.id}:${record.version_number}`, evidence: next.evidence || body.evidence || {}, status: next.status })
    return { public_ref: record.public_ref, status: next.status, escalation_level: next.level, version_number: number(record.version_number) + 1 }
  })
}

export const escalateSupportCase = (schoolId, caseId, actor, body = {}) => simpleCaseTransition(schoolId, caseId, actor, body, { requestedAction: SUPPORT_ACTIONS.escalate, next: (record) => ({ status: number(record.escalation_level) >= 4 ? "guardian_review" : number(record.escalation_level) >= 3 ? "academic_team_review" : "strategy_review", level: Math.min(6, number(record.escalation_level) + 1), nextReview: addDays(5) }), eventType: "case_escalated", summary: (_record, input) => `The case was escalated after authorised review${input.reason ? `: ${input.reason}` : "."}` })

export const resolveSupportCase = (schoolId, caseId, actor, body = {}) => simpleCaseTransition(schoolId, caseId, actor, body, { requestedAction: SUPPORT_ACTIONS.resolve, allowed: ["continued_support", "teacher_follow_up", "strategy_review"], next: async (record, input, db) => {
  const { policy } = await activePolicy(schoolId, db)
  const resolutionEvidence = await derivePersistedResolutionEvidence(db, schoolId, record, policy)
  if (!resolutionEvidence.reassessmentPublished || resolutionEvidence.comparableSuccessCount < policy.resolutionComparableEvidenceCount || !resolutionEvidence.teacherReviewCompleted) throw new HttpError(409, "Resolution requires a published reassessment, sufficient comparable successful evidence and completed teacher review.", { details: resolutionEvidence })
  return { status: "resolved", level: 0, closed: true, evidence: resolutionEvidence }
}, eventType: "case_resolved", summary: () => "The case met the configured evidence and human-review requirements for resolution." })

export async function carryForwardSupportCase(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.carryForward)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    if (!body.to_term_id) throw new HttpError(400, "Destination term is required.")
    const transferRef = randomUUID()
    await db.query("INSERT INTO support_case_term_transfers (public_ref,school_id,case_id,from_term_id,to_term_id,from_class_id,to_class_id,from_owner_user_id,to_owner_user_id,transfer_reason,evidence_summary_json,approval_status,approved_by,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [transferRef, schoolId, record.id, record.current_term_id, number(body.to_term_id), record.class_id, body.to_class_id || record.class_id, record.owner_user_id, body.to_owner_user_id || record.owner_user_id, String(body.transfer_reason || "Active support continues into the next term."), JSON.stringify(body.evidence_summary || {}), body.approved ? "approved" : "pending", body.approved ? actor.id : null, actor.id, actor.id])
    if (body.approved) await db.query("UPDATE learner_support_cases SET current_term_id=?,class_id=?,owner_user_id=?,status='transferred',version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [number(body.to_term_id), body.to_class_id || record.class_id, body.to_owner_user_id || record.owner_user_id, actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "term_carry_forward_requested", body.approved ? "The active case was carried into the next term with its full history." : "Cross-term carry-forward is awaiting approval.", { idempotencyKey: body.idempotency_key || `transfer:${record.id}:${body.to_term_id}`, linkedType: "support_case_term_transfer", linkedRef: transferRef, evidence: { approved: Boolean(body.approved) } })
    return { public_ref: transferRef, approval_status: body.approved ? "approved" : "pending" }
  })
}

export async function requestAcademicReview(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const { record, access } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.requestReview)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const ref = randomUUID(); const type = access.isCoordinator || access.isHeadteacher ? body.meeting_type || "academic_team_review" : "strategy_review"
    await db.query("INSERT INTO academic_review_meetings (public_ref,school_id,term_id,case_id,scheduled_at,meeting_type,attendee_user_ids_json,evidence_summary_json,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [ref, schoolId, record.current_term_id, record.id, body.scheduled_at || new Date(Date.now() + 5 * 86_400_000), type, JSON.stringify(body.attendee_user_ids || []), JSON.stringify(body.evidence_summary || { case_summary: record.current_summary }), body.scheduled_at ? "scheduled" : "requested", actor.id, actor.id])
    const nextStatus = type === "strategy_review" ? "strategy_review" : "academic_team_review"
    const nextLevel = type === "strategy_review" ? 3 : 4
    await db.query("UPDATE learner_support_cases SET status=?,escalation_level=GREATEST(escalation_level,?),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [nextStatus, nextLevel, actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "academic_review_requested", "An academic team review was requested with an evidence summary.", { idempotencyKey: body.idempotency_key || `academic-review:${record.id}:${record.version_number}`, linkedType: "academic_review_meeting", linkedRef: ref })
    return { public_ref: ref, status: body.scheduled_at ? "scheduled" : "requested" }
  })
}

export async function draftGuardianSummary(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const { record } = await lockedCase(db, schoolId, caseId, actor, SUPPORT_ACTIONS.guardianSummary)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const [[topic]] = await db.query("SELECT topic_name FROM syllabus_topics WHERE school_id=? AND id=?", [schoolId, record.primary_topic_id])
    if (body.guardian_id) {
      const [[guardian]] = await db.query(`SELECT sg.id FROM student_guardians sg WHERE sg.school_id=? AND sg.id=? AND (sg.student_id=? OR EXISTS (SELECT 1 FROM learner_support_case_members cm WHERE cm.school_id=sg.school_id AND cm.case_id=? AND cm.learner_id=sg.student_id)) LIMIT 1`, [schoolId, number(body.guardian_id), record.learner_id || 0, record.id])
      if (!guardian) throw new HttpError(400, "The selected guardian is not linked to a learner in this support case.")
    }
    const summary = String(body.safe_summary || `School evidence identifies ${topic?.topic_name || "a learning area"} as an area for continued support. The school has recorded structured support actions and will review progress against published reassessment evidence.`)
    if (/diagnos|disabil|lazy|intelligen|home problem|mental/i.test(summary)) throw new HttpError(400, "Guardian-facing drafts must not diagnose, label or speculate about causes.")
    const ref = randomUUID()
    await db.query("INSERT INTO guardian_review_records (public_ref,school_id,term_id,case_id,guardian_id,safe_summary,proposed_next_steps_json,approval_status,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,'draft','active',?,?)", [ref, schoolId, record.current_term_id, record.id, body.guardian_id || null, summary, JSON.stringify(body.proposed_next_steps || []), actor.id, actor.id])
    await event(db, schoolId, record, actor, "guardian_summary_drafted", "A guardian-safe summary was drafted and requires human approval before sharing.", { idempotencyKey: body.idempotency_key || `guardian-draft:${record.id}:${record.version_number}`, linkedType: "guardian_review_record", linkedRef: ref })
    return { public_ref: ref, safe_summary: summary, approval_status: "draft", sharing_blocked_until_approval: true }
  })
}

export async function reconcileSupportCasesForAssessmentEvidence(db, schoolId, assessment, actor, options = {}) {
  const assessmentId = number(assessment?.id || assessment)
  if (!assessmentId) return { cases_reconciled: [], cases_closed: [], cases_reopened: [] }
  const phase = String(options.phase || "published")
  const { policy } = options.policy ? { policy: normalizeEscalationPolicy(options.policy) } : await activePolicy(schoolId, db)
  const [linkedCases] = await db.query(`SELECT DISTINCT case_id FROM learner_support_case_evidence
    WHERE school_id=? AND assessment_id=?`, [schoolId, assessmentId])
  const reconciled = []; const closed = []; const reopened = []

  for (const linked of linkedCases) {
    const [[caseRecord]] = await db.query("SELECT * FROM learner_support_cases WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE", [schoolId, linked.case_id])
    if (!caseRecord) continue
    const [validEvidence] = await db.query(`SELECT case_evidence.*,mastery.publication_state,mastery.recorded_at mastery_recorded_at
      FROM learner_support_case_evidence case_evidence
      JOIN mastery_evidence mastery ON mastery.school_id=case_evidence.school_id AND mastery.id=case_evidence.mastery_evidence_id
      WHERE case_evidence.school_id=? AND case_evidence.case_id=? AND case_evidence.evidence_status='valid'
        AND mastery.evidence_status='valid' AND mastery.publication_state IN ('published','locked')
      ORDER BY case_evidence.learner_id,case_evidence.topic_id,case_evidence.observed_at,case_evidence.id`, [schoolId, caseRecord.id])

    const latestByLearnerTopic = new Map()
    const comparableAssessmentIds = new Set()
    const assessmentIds = new Set()
    for (const evidence of validEvidence) {
      const scopeKey = `${number(evidence.learner_id)}:${number(evidence.topic_id)}`
      const prior = latestByLearnerTopic.get(scopeKey)
      const comparison = prior
        ? compareAcademicEvidence(prior, evidence, policy)
        : { comparable: false, reasons: ["first_evidence"], interval_days: null }
      await db.query("UPDATE learner_support_case_evidence SET comparable=?,comparability_json=?,updated_by=? WHERE school_id=? AND id=?", [comparison.comparable ? 1 : 0, JSON.stringify({ ...comparison, reconciled_after_assessment_change: true }), actor?.id || null, schoolId, evidence.id])
      const evidenceAssessmentId = number(evidence.assessment_id)
      if (evidenceAssessmentId) assessmentIds.add(evidenceAssessmentId)
      if (comparison.comparable && evidenceAssessmentId) comparableAssessmentIds.add(evidenceAssessmentId)
      latestByLearnerTopic.set(scopeKey, evidence)
    }

    const failureCount = validEvidence.length
      ? Math.min(assessmentIds.size, 1 + comparableAssessmentIds.size)
      : 0
    const confidence = validEvidence.length ? Math.max(...validEvidence.map((item) => number(item.confidence_score))) : 0
    let previousCaseState = null
    let correctionRetractionFound = false
    if (phase === "published" && options.markSheetRef) {
      const [[retractionEvent]] = await db.query(`SELECT evidence_json FROM learner_support_case_events
        WHERE school_id=? AND case_id=? AND event_type='case_evidence_retracted_for_correction'
          AND linked_entity_type='academic_mark_sheet' AND linked_entity_ref=?
        ORDER BY occurred_at DESC,id DESC LIMIT 1`, [schoolId, caseRecord.id, String(options.markSheetRef)])
      correctionRetractionFound = Boolean(retractionEvent)
      previousCaseState = json(retractionEvent?.evidence_json, {}).previousCaseState || null
    }
    const state = deriveSupportEvidenceReconciliation(caseRecord, {
      validEvidenceCount: validEvidence.length,
      failureCount,
      confidence,
    }, policy, { previousCaseState })
    const correctionFlow = phase === "retracted" || correctionRetractionFound
    const summary = validEvidence.length
      ? correctionFlow
        ? `${state.failureCount} valid published mapped assessment evidence point${state.failureCount === 1 ? "" : "s"} currently support this case at ${Number(state.confidence).toFixed(2)}% confidence after correction reconciliation.`
        : caseRecord.current_summary
      : state.status === "closed_inconclusive"
        ? "The mapped assessment evidence that supported this case is no longer valid. The case is closed as inconclusive unless corrected published evidence again meets the support threshold."
        : "No current valid mapped assessment evidence remains; the case's completed historical state has been retained."
    await db.query(`UPDATE learner_support_cases SET comparable_failure_count=?,evidence_confidence=?,current_summary=?,status=?,escalation_level=?,
      last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=CASE WHEN ? THEN NULL WHEN ? THEN COALESCE(next_review_at,?) ELSE next_review_at END,
      closed_at=CASE WHEN ? THEN COALESCE(closed_at,CURRENT_TIMESTAMP) WHEN ? THEN NULL ELSE closed_at END,
      version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?`, [state.failureCount, state.confidence, summary, state.status, state.level,
    state.closeCase ? 1 : 0, state.reopenCase ? 1 : 0, addDays(policy.reviewWithinSchoolDays),
    state.closeCase ? 1 : 0, state.reopenCase ? 1 : 0, actor?.id || null, schoolId, caseRecord.id])
    if (phase === "retracted" || correctionRetractionFound) {
      const eventType = phase === "retracted" ? "case_evidence_retracted_for_correction" : "case_evidence_reconciled_after_correction"
      const eventSummary = phase === "retracted"
        ? "Published mapped evidence was withdrawn while its marksheet is corrected, and the case evidence state was recalculated."
        : "Corrected published mapped evidence was reconciled against the case and its evidence state was recalculated."
      await event(db, schoolId, caseRecord, actor, eventType, eventSummary, {
        idempotencyKey: `case-evidence:${phase}:${caseRecord.id}:${assessmentId}:${options.markSheetVersion || "na"}`,
        linkedType: options.markSheetRef ? "academic_mark_sheet" : "assessment",
        linkedRef: options.markSheetRef || String(assessmentId),
        status: state.status,
        evidence: {
          assessmentId,
          phase,
          validEvidenceCount: validEvidence.length,
          failureCount: state.failureCount,
          confidence: state.confidence,
          previousCaseState: {
            status: caseRecord.status,
            escalationLevel: number(caseRecord.escalation_level),
            comparableFailureCount: number(caseRecord.comparable_failure_count),
            evidenceConfidence: number(caseRecord.evidence_confidence),
          },
          reconciledCaseState: { status: state.status, escalationLevel: state.level },
        },
      })
    }
    reconciled.push(caseRecord.public_ref)
    if (state.closeCase) closed.push(caseRecord.public_ref)
    if (caseRecord.status === "closed_inconclusive" && state.reopenCase) reopened.push(caseRecord.public_ref)
  }
  return { cases_reconciled: reconciled, cases_closed: closed, cases_reopened: reopened }
}

export async function syncSupportCasesFromPublishedAssessment(db, schoolId, assessment, actor, options = {}) {
  const { policy } = await activePolicy(schoolId, db)
  const [classCountRows] = await db.query("SELECT COUNT(DISTINCT se.student_id) class_size FROM student_enrollments se WHERE se.school_id=? AND se.class_id=? AND (? IS NULL OR se.academic_year_id=?) AND (? IS NULL OR se.term_id=?) AND se.enrollment_status='active'", [schoolId, assessment.class_id, assessment.academic_year_id, assessment.academic_year_id, assessment.term_id, assessment.term_id])
  const classSize = number(classCountRows[0]?.class_size)
  const [weak] = await db.query(`SELECT me.*,CONCAT(s.first_name,' ',s.last_name) learner_name,st.topic_name FROM mastery_evidence me JOIN students s ON s.school_id=me.school_id AND s.id=me.student_id JOIN syllabus_topics st ON st.school_id=me.school_id AND st.id=me.topic_id WHERE me.school_id=? AND me.assessment_id=? AND me.topic_id IS NOT NULL AND me.publication_state IN ('published','locked') AND me.evidence_status='valid' AND me.score_percentage<? ORDER BY me.topic_id,me.student_id,me.recorded_at DESC`, [schoolId, assessment.id, policy.masteryThreshold])
  const byTopic = new Map()
  for (const evidence of weak) { const rows = byTopic.get(number(evidence.topic_id)) || []; if (!rows.some((row) => number(row.student_id) === number(evidence.student_id))) rows.push(evidence); byTopic.set(number(evidence.topic_id), rows) }
  const touched = []
  for (const [topicId, affected] of byTopic) {
    const scope = classifySupportScope(affected.length, classSize, policy)
    const groups = scope.scope_type === "learner" ? affected.map((item) => [item]) : [affected]
    for (const members of groups) {
      const learner = scope.scope_type === "learner" ? members[0] : null
      const baseIdentity = scope.scope_type === "learner" ? `learner:${learner.student_id}:${assessment.subject_id}:${topicId}` : `${scope.scope_type}:${assessment.class_id}:${assessment.subject_id}:${topicId}`
      const identity = `${baseIdentity}:academic-year:${assessment.academic_year_id ?? "none"}:term:${assessment.term_id ?? "none"}`
      const [existingCases] = await db.query(`SELECT * FROM learner_support_cases
        WHERE school_id=? AND academic_year_id<=>? AND current_term_id<=>?
          AND class_id<=>? AND learner_id<=>? AND subject_id<=>? AND primary_topic_id<=>?
          AND scope_type=? AND case_type='topic_mastery'
        ORDER BY id DESC LIMIT 1 FOR UPDATE`, [schoolId, assessment.academic_year_id || null, assessment.term_id || null,
      assessment.class_id || null, learner?.student_id || null, assessment.subject_id || null, topicId || null, scope.scope_type])
      let caseRecord = existingCases[0]
      const confidence = Math.max(...members.map((item) => number(item.confidence_score || item.evidence_confidence, evidenceConfidence(item)) || evidenceConfidence(item)))
      if (!caseRecord) {
        const ref = randomUUID(); const status = confidence >= policy.minimumConfidenceForEscalation ? String(policy.firstWeakEvidenceAction || "teacher_follow_up") : "detected"
        const narrative = buildCaseNarrative({ scope_type: scope.scope_type, comparable_failure_count: 1, evidence_confidence: confidence }, { learnerName: learner?.learner_name, topicName: members[0].topic_name, affectedLearners: members.length, classSize })
        await db.query(`INSERT INTO learner_support_cases (public_ref,school_id,academic_year_id,current_term_id,class_id,learner_id,subject_id,primary_topic_id,primary_objective_id,scope_type,case_type,severity,status,owner_user_id,owner_role,comparable_failure_count,evidence_confidence,current_summary,escalation_level,identity_key,created_by,updated_by,next_review_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [ref, schoolId, assessment.academic_year_id, assessment.term_id, assessment.class_id, learner?.student_id || null, assessment.subject_id, topicId, learner?.learning_objective_id || null, scope.scope_type, "topic_mastery", confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low", status, actor?.id || null, actor?.role || null, 1, confidence, narrative, status === "detected" ? 0 : 1, identity, actor?.id || null, actor?.id || null, addDays(policy.reviewWithinSchoolDays)])
        const [createdCases] = await db.query("SELECT * FROM learner_support_cases WHERE school_id=? AND public_ref=?", [schoolId, ref])
        caseRecord = createdCases[0]
        await db.query("INSERT INTO learner_support_case_topics (public_ref,school_id,case_id,subject_id,topic_id,objective_id,topic_role,current_mastery,status,created_by,updated_by) VALUES (?,?,?,?,?,?, 'primary',?,'active',?,?)", [randomUUID(), schoolId, caseRecord.id, assessment.subject_id, topicId, learner?.learning_objective_id || null, number(learner?.score_percentage), actor?.id || null, actor?.id || null])
        await event(db, schoolId, caseRecord, actor, "case_detected", narrative, { idempotencyKey: `detect:${caseRecord.id}:${assessment.id}`, linkedType: "assessment", linkedRef: String(assessment.id), evidence: { scope_type: scope.scope_type, affected_rate: scope.affected_rate } })
      }
      for (const member of members) {
        await db.query("INSERT INTO learner_support_case_members (public_ref,school_id,case_id,learner_id,membership_status,baseline_summary_json,created_by,updated_by) VALUES (?,?,?,?, 'active',?,?,?) ON DUPLICATE KEY UPDATE membership_status='active',baseline_summary_json=VALUES(baseline_summary_json),updated_by=VALUES(updated_by)", [randomUUID(), schoolId, caseRecord.id, member.student_id, JSON.stringify({ score_percentage: member.score_percentage, assessment_id: assessment.id }), actor?.id || null, actor?.id || null])
        const [[prior]] = await db.query("SELECT * FROM learner_support_case_evidence WHERE school_id=? AND case_id=? AND learner_id=? AND topic_id=? AND evidence_status='valid' ORDER BY observed_at DESC,id DESC LIMIT 1", [schoolId, caseRecord.id, member.student_id, topicId])
        const comparison = prior ? compareAcademicEvidence(prior, { ...member, objective_id: member.learning_objective_id, observed_at: member.recorded_at }, policy) : { comparable: false, reasons: ["first_evidence"] }
        await db.query(`INSERT INTO learner_support_case_evidence (public_ref,school_id,case_id,academic_year_id,term_id,learner_id,subject_id,topic_id,objective_id,assessment_id,question_id,mastery_evidence_id,evidence_role,evidence_precision,score_percentage,marks_awarded,marks_available,confidence_score,comparable,comparability_json,evidence_status,observed_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE academic_year_id=VALUES(academic_year_id),term_id=VALUES(term_id),learner_id=VALUES(learner_id),subject_id=VALUES(subject_id),topic_id=VALUES(topic_id),objective_id=VALUES(objective_id),assessment_id=VALUES(assessment_id),question_id=VALUES(question_id),evidence_precision=VALUES(evidence_precision),score_percentage=VALUES(score_percentage),marks_awarded=VALUES(marks_awarded),marks_available=VALUES(marks_available),confidence_score=VALUES(confidence_score),comparable=VALUES(comparable),comparability_json=VALUES(comparability_json),evidence_status='valid',observed_at=VALUES(observed_at),updated_by=VALUES(updated_by)`, [randomUUID(), schoolId, caseRecord.id, assessment.academic_year_id, assessment.term_id, member.student_id, assessment.subject_id, topicId, member.learning_objective_id, assessment.id, member.question_id, member.id, prior ? "comparison" : "detection", member.evidence_precision || "limited", member.score_percentage, member.marks_awarded, member.marks_available, number(member.confidence_score, evidenceConfidence(member)) || evidenceConfidence(member), comparison.comparable ? 1 : 0, JSON.stringify(comparison), "valid", member.recorded_at || new Date(), actor?.id || null, actor?.id || null])
      }
      const [[stats]] = await db.query("SELECT 1+COUNT(DISTINCT CASE WHEN comparable=1 THEN assessment_id END) failure_count,MAX(confidence_score) confidence FROM learner_support_case_evidence WHERE school_id=? AND case_id=? AND evidence_status='valid'", [schoolId, caseRecord.id])
      const failureCount = number(stats.failure_count, 1)
      const nextLevel = failureCount >= policy.comparableFailureCountForIntervention ? 2 : number(caseRecord.escalation_level)
      const nextStatus = failureCount >= policy.comparableFailureCountForIntervention && caseRecord.status === "detected" ? "teacher_follow_up" : caseRecord.status
      const narrative = buildCaseNarrative({ ...caseRecord, comparable_failure_count: failureCount, evidence_confidence: stats.confidence }, { learnerName: learner?.learner_name, topicName: members[0].topic_name, affectedLearners: members.length, classSize })
      await db.query("UPDATE learner_support_cases SET comparable_failure_count=?,evidence_confidence=?,current_summary=?,status=?,escalation_level=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [failureCount, number(stats.confidence), narrative, nextStatus, nextLevel, actor?.id || null, schoolId, caseRecord.id])
      if (nextLevel >= 2) await event(db, schoolId, caseRecord, actor, "formal_intervention_recommended", "Repeated comparable evidence reached the school's formal-intervention threshold. A different, structured strategy should now be selected.", { idempotencyKey: `formal-recommendation:${caseRecord.id}:${failureCount}`, linkedType: "assessment", linkedRef: String(assessment.id), evidence: { comparable_failure_count: failureCount } })
      touched.push(caseRecord.public_ref)
    }
  }
  const reconciliation = await reconcileSupportCasesForAssessmentEvidence(db, schoolId, assessment, actor, {
    ...options,
    phase: "published",
    policy,
  })
  return {
    cases_touched: [...new Set([...touched, ...reconciliation.cases_reconciled])],
    weak_evidence_count: weak.length,
    evidence_reconciliation: reconciliation,
  }
}

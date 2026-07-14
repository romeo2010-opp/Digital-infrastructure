import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

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
const PRECISION_FAMILY = Object.freeze({ question: "mapped", section: "mapped", topic: "mapped", overall: "overall", limited: "limited" })
const STRATEGY_SEQUENCE = Object.freeze([
  "guided_practice", "visual_concrete_materials", "prerequisite_reteaching", "small_group_instruction",
  "worked_examples", "oral_diagnostic", "untimed_practice", "spaced_retrieval", "peer_supported_practice",
  "practical_task", "timed_practice", "written_diagnostic", "direct_reteaching", "homework_reinforcement",
])

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
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
  if (intervalDays !== null && intervalDays > policy.maximumComparableEvidenceDays) reasons.push("interval")
  return { comparable: reasons.length === 0, reasons, interval_days: intervalDays === null ? null : Number(intervalDays.toFixed(1)) }
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

function teacherScopeSql(actor, alias = "c") {
  if (String(actor?.role || "").toLowerCase() !== "teacher") return { sql: "", params: [] }
  return {
    sql: ` AND (${alias}.owner_user_id=? OR EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=${alias}.school_id AND tcsa.teacher_id=? AND tcsa.class_id=${alias}.class_id AND tcsa.subject_id=${alias}.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1))`,
    params: [actor.id, actor.id],
  }
}

async function lockedCase(db, schoolId, caseId, actor) {
  const scope = teacherScopeSql(actor)
  const [[record]] = await db.query(`SELECT c.* FROM learner_support_cases c WHERE c.school_id=? AND (c.public_ref=? OR c.id=?)${scope.sql} LIMIT 1 FOR UPDATE`, [schoolId, String(caseId), number(caseId), ...scope.params])
  if (!record) throw new HttpError(404, "Learner support case was not found or is outside your assignment.")
  return record
}

function assertVersion(record, body = {}) {
  if (body.version_number !== undefined && number(body.version_number) !== number(record.version_number)) throw new HttpError(409, "This support case changed after it was opened. Refresh and try again.", { code: "STALE_SUPPORT_CASE" })
}

async function event(db, schoolId, caseRecord, actor, type, summary, options = {}) {
  const key = options.idempotencyKey || null
  await db.query(`INSERT INTO learner_support_case_events (public_ref,school_id,case_id,term_id,event_type,summary,evidence_json,status,responsible_user_id,linked_entity_type,linked_entity_ref,idempotency_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [randomUUID(), schoolId, caseRecord.id, options.termId || caseRecord.current_term_id || null, type, summary, JSON.stringify(options.evidence || {}), options.status || caseRecord.status, actor?.id || null, options.linkedType || null, options.linkedRef || null, key, actor?.id || null, actor?.id || null])
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
  const page = Math.max(1, number(filters.page, 1)); const limit = Math.min(100, Math.max(1, number(filters.limit, 25))); const offset = (page - 1) * limit
  const where = ["c.school_id=?"]; const params = [schoolId]
  if (filters.status) { where.push("c.status=?"); params.push(String(filters.status)) }
  if (filters.owner_user_id) { where.push("c.owner_user_id=?"); params.push(number(filters.owner_user_id)) }
  if (filters.learner_id) { where.push("(c.learner_id=? OR EXISTS (SELECT 1 FROM learner_support_case_members cm WHERE cm.school_id=c.school_id AND cm.case_id=c.id AND cm.learner_id=? AND cm.membership_status='active'))"); params.push(number(filters.learner_id), number(filters.learner_id)) }
  if (filters.term_id) { where.push("c.current_term_id=?"); params.push(number(filters.term_id)) }
  if (filters.overdue === "true" || filters.overdue === true) where.push("c.next_review_at<CURRENT_TIMESTAMP")
  const scope = teacherScopeSql(actor); where.push(`1=1${scope.sql}`); params.push(...scope.params)
  const base = `FROM learner_support_cases c LEFT JOIN students s ON s.school_id=c.school_id AND s.id=c.learner_id LEFT JOIN subjects sub ON sub.school_id=c.school_id AND sub.id=c.subject_id LEFT JOIN syllabus_topics st ON st.school_id=c.school_id AND st.id=c.primary_topic_id LEFT JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id WHERE ${where.join(" AND ")}`
  const [[count]] = await pool.query(`SELECT COUNT(*) total ${base}`, params)
  const [rows] = await pool.query(`SELECT c.public_ref,c.scope_type,c.case_type,c.severity,c.status,c.escalation_level,c.current_summary,c.evidence_confidence,c.comparable_failure_count,c.intervention_cycle_count,c.next_review_at,c.version_number,c.updated_at,CONCAT(s.first_name,' ',s.last_name) learner_name,sub.name subject_name,st.topic_name,cl.name class_name ${base} ORDER BY FIELD(c.severity,'urgent','high','medium','low'),c.next_review_at IS NULL,c.next_review_at,c.updated_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
  return { cases: rows, pagination: { page, limit, total: number(count.total), pages: Math.ceil(number(count.total) / limit) } }
}

export async function getSupportCase(schoolId, caseId, actor) {
  const scope = teacherScopeSql(actor)
  const [[record]] = await pool.query(`SELECT c.*,CONCAT(s.first_name,' ',s.last_name) learner_name,sub.name subject_name,st.topic_name,cl.name class_name,CONCAT(u.first_name,' ',u.last_name) owner_name FROM learner_support_cases c LEFT JOIN students s ON s.school_id=c.school_id AND s.id=c.learner_id LEFT JOIN subjects sub ON sub.school_id=c.school_id AND sub.id=c.subject_id LEFT JOIN syllabus_topics st ON st.school_id=c.school_id AND st.id=c.primary_topic_id LEFT JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id LEFT JOIN users u ON u.school_id=c.school_id AND u.id=c.owner_user_id WHERE c.school_id=? AND (c.public_ref=? OR c.id=?)${scope.sql} LIMIT 1`, [schoolId, String(caseId), number(caseId), ...scope.params])
  if (!record) throw new HttpError(404, "Learner support case was not found or is outside your assignment.")
  const [members, topics, cycles] = await Promise.all([
    pool.query("SELECT cm.public_ref,cm.membership_status,cm.baseline_summary_json,cm.outcome_summary_json,s.public_ref learner_ref,CONCAT(s.first_name,' ',s.last_name) learner_name FROM learner_support_case_members cm JOIN students s ON s.school_id=cm.school_id AND s.id=cm.learner_id WHERE cm.school_id=? AND cm.case_id=? ORDER BY s.last_name,s.first_name", [schoolId, record.id]).then(([rows]) => rows),
    pool.query("SELECT ct.public_ref,ct.topic_role,ct.current_mastery,ct.previous_mastery,ct.status,sub.name subject_name,st.topic_name,lo.objective_text FROM learner_support_case_topics ct JOIN subjects sub ON sub.school_id=ct.school_id AND sub.id=ct.subject_id JOIN syllabus_topics st ON st.school_id=ct.school_id AND st.id=ct.topic_id LEFT JOIN learning_objectives lo ON lo.school_id=ct.school_id AND lo.id=ct.objective_id WHERE ct.school_id=? AND ct.case_id=?", [schoolId, record.id]).then(([rows]) => rows),
    pool.query("SELECT ic.public_ref,ic.cycle_number,ist.strategy_code,ist.label strategy_label,ic.planned_session_count,ic.status,ic.outcome,ic.start_date,ic.review_date,ic.diagnostic_json,ic.version_number FROM intervention_cycles ic JOIN intervention_strategy_types ist ON ist.school_id=ic.school_id AND ist.id=ic.strategy_type_id WHERE ic.school_id=? AND ic.case_id=? ORDER BY ic.cycle_number DESC", [schoolId, record.id]).then(([rows]) => rows),
  ])
  delete record.id
  return { case: record, members, topics, intervention_cycles: cycles }
}

export async function getLearnerSupport(schoolId, learnerId, actor) {
  const [[learner]] = await pool.query("SELECT id,public_ref,CONCAT(first_name,' ',last_name) learner_name FROM students WHERE school_id=? AND (public_ref=? OR id=?) LIMIT 1", [schoolId, String(learnerId), number(learnerId)])
  if (!learner) throw new HttpError(404, "Learner was not found.")
  const result = await listSupportCases(schoolId, actor, { learner_id: learner.id, limit: 100 })
  return { learner: { public_ref: learner.public_ref, learner_name: learner.learner_name }, ...result }
}

async function caseChildRows(schoolId, caseId, actor, selectSql, params = []) {
  const record = await getSupportCase(schoolId, caseId, actor)
  const [rows] = await pool.query(selectSql, [schoolId, record.case.public_ref, ...params])
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
    st.topic_name,lo.objective_text,NULL event_type,NULL summary,'assessment' evidence_kind
  FROM learner_support_case_evidence ce
  JOIN target_case tc ON tc.school_id=ce.school_id AND tc.id=ce.case_id
  LEFT JOIN assessments a ON a.school_id=ce.school_id AND a.id=ce.assessment_id
  LEFT JOIN syllabus_topics st ON st.school_id=ce.school_id AND st.id=ce.topic_id
  LEFT JOIN learning_objectives lo ON lo.school_id=ce.school_id AND lo.id=ce.objective_id
  UNION ALL
  SELECT e.public_ref,'detection' evidence_role,'limited' evidence_precision,NULL score_percentage,NULL marks_awarded,NULL marks_available,
    tc.evidence_confidence confidence_score,0 comparable,e.evidence_json comparability_json,'valid' evidence_status,e.occurred_at observed_at,
    CASE WHEN e.event_type='multi_subject_review_detected' THEN ca.assessment_names ELSE COALESCE(a.name,ca.assessment_names) END assessment_name,
    NULL topic_name,NULL objective_text,e.event_type,e.summary,'case_event' evidence_kind
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

export async function assignSupportCase(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const ownerId = number(body.owner_user_id)
    const [[owner]] = await db.query("SELECT id,role FROM users WHERE school_id=? AND id=? AND employment_status='active' AND is_active=1 LIMIT 1", [schoolId, ownerId])
    if (!owner) throw new HttpError(400, "The selected case owner is not an active user in this school.")
    await db.query("UPDATE learner_support_cases SET owner_user_id=?,owner_role=?,status=IF(status='detected','teacher_follow_up',status),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [owner.id, owner.role, actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "case_assigned", "The learner support case was assigned for follow-up.", { idempotencyKey: body.idempotency_key || `assign:${record.id}:${owner.id}:${record.version_number}`, evidence: { owner_user_id: owner.id, owner_role: owner.role } })
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
    const record = await lockedCase(db, schoolId, caseId, actor)
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
    const interventionRef = randomUUID()
    const interventionType = record.scope_type === "class" ? "whole_class_revision" : record.scope_type === "group" ? "small_group_support" : "individual_remediation"
    const [legacyResult] = await db.query(`INSERT INTO academic_interventions (public_ref,school_id,student_id,class_id,subject_id,topic_id,term_id,intervention_type,issue,evidence_json,assigned_teacher_id,priority,start_date,review_date,action_plan,parent_notification_status,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [interventionRef, schoolId, record.learner_id, record.class_id, record.subject_id, record.primary_topic_id, record.current_term_id, interventionType, record.current_summary, JSON.stringify({ support_case_ref: record.public_ref }), ownerId, record.severity, body.start_date || dateOnly(), body.review_date || addDays(14), String(body.action_plan || `${strategy.label}: ${strategy.description || "structured support"}`), "not_required", "active", actor.id])
    const cycleRef = randomUUID()
    await db.query(`INSERT INTO intervention_cycles (public_ref,school_id,case_id,term_id,legacy_intervention_id,cycle_number,strategy_type_id,owner_user_id,planned_session_count,success_criterion_json,delivery_threshold,attendance_threshold,start_date,review_date,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [cycleRef, schoolId, record.id, record.current_term_id, legacyResult.insertId, cycleNumber, strategy.id, ownerId, plannedCount, JSON.stringify(body.success_criterion || { mastery_threshold: number(body.mastery_threshold, policy.masteryThreshold), minimum_meaningful_change: number(body.minimum_meaningful_change, 5) }), number(body.delivery_threshold, policy.minimumSupportDeliveryRate), number(body.attendance_threshold, policy.minimumSupportAttendanceRate), body.start_date || dateOnly(), body.review_date || addDays(policy.reviewWithinSchoolDays), "active", actor.id, actor.id])
    const [[cycle]] = await db.query("SELECT id FROM intervention_cycles WHERE school_id=? AND public_ref=?", [schoolId, cycleRef])
    for (let index = 0; index < plannedDates.length; index += 1) await db.query("INSERT INTO intervention_sessions (public_ref,school_id,term_id,cycle_id,session_number,scheduled_at,status,created_by,updated_by) VALUES (?,?,?,?,?,?,'planned',?,?)", [randomUUID(), schoolId, record.current_term_id, cycle.id, index + 1, plannedDates[index], actor.id, actor.id])
    await db.query("UPDATE learner_support_cases SET status='intervention_active',escalation_level=GREATEST(escalation_level,2),intervention_cycle_count=?,owner_user_id=?,owner_role=COALESCE(owner_role,?),next_review_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [cycleNumber, ownerId, actor.role, body.review_date || addDays(14), actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "intervention_cycle_created", `Support cycle ${cycleNumber} was created using ${strategy.label}.`, { idempotencyKey: body.idempotency_key || `cycle:${record.id}:${cycleNumber}`, linkedType: "intervention_cycle", linkedRef: cycleRef, evidence: { strategy_code: strategy.strategy_code, planned_session_count: plannedCount } })
    return { public_ref: cycleRef, legacy_intervention_ref: interventionRef, cycle_number: cycleNumber, strategy_code: strategy.strategy_code, status: "active", case_version_number: number(record.version_number) + 1 }
  })
}

export async function recordSupportSession(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
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
    if (!["completed", "cancelled", "missed", "rescheduled", "planned"].includes(status)) throw new HttpError(400, "Session status is invalid.")
    await db.query(`UPDATE intervention_sessions SET status=?,scheduled_at=COALESCE(?,scheduled_at),completed_at=IF(?='completed',COALESCE(?,CURRENT_TIMESTAMP),NULL),teacher_attended=?,target_taught=?,prerequisite_addressed=?,resources_json=?,activities_json=?,teacher_notes=?,practice_assigned=?,review_status=?,updated_by=? WHERE school_id=? AND id=?`, [status, body.scheduled_at || null, status, body.completed_at || null, body.teacher_attended === undefined ? null : Boolean(body.teacher_attended), body.target_taught === undefined ? null : Boolean(body.target_taught), body.prerequisite_addressed === undefined ? null : Boolean(body.prerequisite_addressed), JSON.stringify(body.resources || []), JSON.stringify(body.activities || []), body.teacher_notes || null, body.practice_assigned || null, body.review_status || "pending", actor.id, schoolId, session.id])
    for (const attendance of Array.isArray(body.attendance) ? body.attendance : []) {
      const learnerId = number(attendance.learner_id)
      const [[member]] = await db.query("SELECT id FROM learner_support_case_members WHERE school_id=? AND case_id=? AND learner_id=? AND membership_status='active' LIMIT 1", [schoolId, record.id, learnerId])
      if (!member && number(record.learner_id) !== learnerId) throw new HttpError(400, "Session attendance contains a learner outside this support case.")
      await db.query(`INSERT INTO intervention_session_attendance (public_ref,school_id,session_id,learner_id,attendance_status,note,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE attendance_status=VALUES(attendance_status),note=VALUES(note),updated_by=VALUES(updated_by)`, [randomUUID(), schoolId, session.id, learnerId, attendance.status || "not_recorded", attendance.note || null, actor.id, actor.id])
    }
    await event(db, schoolId, record, actor, "support_session_recorded", `Support session ${session.session_number} was recorded as ${status}.`, { idempotencyKey: body.idempotency_key || `session:${session.id}:${status}:${body.completed_at || dateOnly()}`, linkedType: "intervention_session", linkedRef: session.public_ref, evidence: { target_taught: body.target_taught, prerequisite_addressed: body.prerequisite_addressed } })
    return { public_ref: session.public_ref, status, cycle_ref: cycle.public_ref }
  })
}

export async function scheduleSupportReassessment(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const [[cycle]] = await db.query("SELECT * FROM intervention_cycles WHERE school_id=? AND case_id=? AND (public_ref=? OR id=? OR ?='') ORDER BY cycle_number DESC LIMIT 1 FOR UPDATE", [schoolId, record.id, String(body.cycle_ref || ""), number(body.cycle_id), String(body.cycle_ref || "")])
    if (!cycle) throw new HttpError(409, "Create an intervention cycle before scheduling reassessment.")
    if (!body.generated_assessment_id) throw new HttpError(400, "An approved targeted assessment id is required.")
    const [[generated]] = await db.query("SELECT id,status FROM generated_assessments WHERE school_id=? AND id=? AND status IN ('approved','published') LIMIT 1", [schoolId, number(body.generated_assessment_id)])
    if (!generated) throw new HttpError(400, "The targeted assessment must belong to this school and be approved or published.")
    await db.query(`INSERT INTO academic_intervention_reassessments (public_ref,school_id,support_case_id,intervention_id,intervention_cycle_id,generated_assessment_id,baseline_mark_sheet_id,success_criterion_json,comparability_json,outcome) VALUES (?,?,?,?,?,?,?,?,?,'pending') ON DUPLICATE KEY UPDATE support_case_id=VALUES(support_case_id),intervention_cycle_id=VALUES(intervention_cycle_id),success_criterion_json=VALUES(success_criterion_json),comparability_json=VALUES(comparability_json)`, [randomUUID(), schoolId, record.id, cycle.legacy_intervention_id, cycle.id, generated.id, body.baseline_mark_sheet_id || null, JSON.stringify(body.success_criterion || json(cycle.success_criterion_json)), JSON.stringify(body.comparability || {})])
    await db.query("UPDATE intervention_cycles SET status='awaiting_reassessment',version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [actor.id, schoolId, cycle.id])
    await db.query("UPDATE learner_support_cases SET status='reassessment_pending',next_review_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [body.due_date || addDays(5), actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "reassessment_scheduled", "A targeted reassessment was linked to this support cycle.", { idempotencyKey: body.idempotency_key || `reassessment:${record.id}:${body.generated_assessment_id}`, linkedType: "generated_assessment", linkedRef: String(body.generated_assessment_id) })
    return { case_ref: record.public_ref, cycle_ref: cycle.public_ref, status: "reassessment_pending" }
  })
}

export async function reviewSupportOutcome(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const { row: policyRow, policy } = await activePolicy(schoolId, db)
    const [[cycle]] = await db.query("SELECT ic.*,ist.strategy_code FROM intervention_cycles ic JOIN intervention_strategy_types ist ON ist.id=ic.strategy_type_id AND ist.school_id=ic.school_id WHERE ic.school_id=? AND ic.case_id=? AND (ic.public_ref=? OR ic.id=? OR ?='') ORDER BY ic.cycle_number DESC LIMIT 1 FOR UPDATE", [schoolId, record.id, String(body.cycle_ref || ""), number(body.cycle_id), String(body.cycle_ref || "")])
    if (!cycle) throw new HttpError(404, "Intervention cycle was not found.")
    const [[delivery]] = await db.query("SELECT COUNT(*) recorded,SUM(status='completed') completed FROM intervention_sessions WHERE school_id=? AND cycle_id=?", [schoolId, cycle.id])
    const [[attendance]] = await db.query("SELECT COUNT(*) eligible,SUM(attendance_status IN ('present','late')) attended FROM intervention_session_attendance isa JOIN intervention_sessions sess ON sess.id=isa.session_id AND sess.school_id=isa.school_id WHERE isa.school_id=? AND sess.cycle_id=? AND sess.status='completed'", [schoolId, cycle.id])
    const diagnostic = evaluateInterventionDelivery({ plannedSessions: cycle.planned_session_count, completedSessions: delivery.completed, attendanceEligible: attendance.eligible, attendedSessions: attendance.attended, reassessmentPublished: body.reassessment_published, reassessmentComparable: body.reassessment_comparable, baselineScore: body.baseline_score, reassessmentScore: body.reassessment_score, successCriterion: body.success_criterion || json(cycle.success_criterion_json).mastery_threshold, minimumMeaningfulChange: body.minimum_meaningful_change || json(cycle.success_criterion_json).minimum_meaningful_change, improvedComponents: body.improved_components, unchangedComponents: body.unchanged_components, strategyRepeated: body.strategy_repeated }, policy)
    let cycleStatus = "completed"; let cycleOutcome = diagnostic.outcome
    if (["incomplete_delivery", "insufficient_participation", "inconclusive"].includes(diagnostic.outcome)) { cycleStatus = diagnostic.outcome; cycleOutcome = diagnostic.outcome === "inconclusive" ? "inconclusive" : "not_classified" }
    if (diagnostic.outcome === "awaiting_reassessment") { cycleStatus = "awaiting_reassessment"; cycleOutcome = "pending" }
    let nextStatus = record.status; let nextLevel = number(record.escalation_level); let unsuccessful = number(record.unsuccessful_cycle_count); let successful = number(record.successful_cycle_count)
    if (diagnostic.outcome === "effective") { successful += 1; nextStatus = "continued_support"; nextLevel = Math.max(1, nextLevel - 1) }
    else if (["ineffective", "partially_effective"].includes(diagnostic.outcome)) { unsuccessful += 1; nextStatus = unsuccessful >= policy.unsuccessfulCyclesForAcademicReview ? "academic_team_review" : "strategy_review"; nextLevel = unsuccessful >= policy.unsuccessfulCyclesForAcademicReview ? 4 : 3 }
    else if (diagnostic.outcome === "awaiting_reassessment") nextStatus = "reassessment_pending"
    await db.query("UPDATE intervention_cycles SET status=?,outcome=?,diagnostic_json=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [cycleStatus, cycleOutcome, JSON.stringify(diagnostic), actor.id, schoolId, cycle.id])
    await db.query("UPDATE academic_interventions SET status=?,outcome=?,reassessment_summary_json=?,completed_by=IF(?='completed',?,completed_by),completed_at=IF(?='completed',CURRENT_TIMESTAMP,completed_at) WHERE school_id=? AND id=?", [cycleStatus === "completed" ? "completed" : "review_due", diagnostic.outcome === "effective" ? "improved" : diagnostic.outcome === "ineffective" ? "unchanged" : "inconclusive", JSON.stringify(diagnostic), cycleStatus, actor.id, cycleStatus, schoolId, cycle.legacy_intervention_id])
    await db.query("UPDATE learner_support_cases SET status=?,escalation_level=?,unsuccessful_cycle_count=?,successful_cycle_count=?,last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=?,current_summary=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [nextStatus, nextLevel, unsuccessful, successful, addDays(policy.reviewWithinSchoolDays), `${record.current_summary} Latest support-cycle outcome: ${diagnostic.outcome.replaceAll("_", " ")}.`, actor.id, schoolId, record.id])
    await db.query(`INSERT INTO escalation_decisions (public_ref,school_id,term_id,case_id,cycle_id,policy_id,from_level,to_level,decision_type,trigger_json,diagnostic_json,human_approval_required,approval_status,idempotency_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [randomUUID(), schoolId, record.current_term_id, record.id, cycle.id, policyRow?.id, record.escalation_level, nextLevel, nextLevel > record.escalation_level ? "escalate" : diagnostic.outcome === "effective" ? "deescalate" : "continue", JSON.stringify({ outcome: diagnostic.outcome, unsuccessful_cycles: unsuccessful }), JSON.stringify(diagnostic), nextLevel >= 5 ? 1 : 0, nextLevel >= 5 ? "pending" : "not_required", body.idempotency_key || `review:${record.id}:${cycle.id}:${cycle.version_number}`, actor.id, actor.id])
    await event(db, schoolId, record, actor, "intervention_outcome_reviewed", `Support cycle ${cycle.cycle_number} was classified as ${diagnostic.outcome.replaceAll("_", " ")}.`, { idempotencyKey: body.idempotency_key ? `${body.idempotency_key}:event` : `review-event:${record.id}:${cycle.id}:${cycle.version_number}`, linkedType: "intervention_cycle", linkedRef: cycle.public_ref, evidence: diagnostic, status: nextStatus })
    return { case_ref: record.public_ref, cycle_ref: cycle.public_ref, status: nextStatus, escalation_level: nextLevel, diagnostic, next_strategy: recommendAlternativeStrategy([{ strategy_code: cycle.strategy_code }]) }
  })
}

async function simpleCaseTransition(schoolId, caseId, actor, body, options) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    if (options.allowed && !options.allowed.includes(record.status)) throw new HttpError(409, options.invalidMessage || "This case cannot make that transition.")
    const next = typeof options.next === "function" ? await options.next(record, body, db) : options.next
    await db.query(`UPDATE learner_support_cases SET status=?,escalation_level=?,last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=?,closed_at=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?`, [next.status, next.level, next.nextReview || null, next.closed ? new Date() : null, actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, options.eventType, options.summary(record, body), { idempotencyKey: body.idempotency_key || `${options.eventType}:${record.id}:${record.version_number}`, evidence: body.evidence || {}, status: next.status })
    return { public_ref: record.public_ref, status: next.status, escalation_level: next.level, version_number: number(record.version_number) + 1 }
  })
}

export const escalateSupportCase = (schoolId, caseId, actor, body = {}) => simpleCaseTransition(schoolId, caseId, actor, body, { next: (record) => ({ status: number(record.escalation_level) >= 4 ? "guardian_review" : number(record.escalation_level) >= 3 ? "academic_team_review" : "strategy_review", level: Math.min(6, number(record.escalation_level) + 1), nextReview: addDays(5) }), eventType: "case_escalated", summary: (_record, input) => `The case was escalated after authorised review${input.reason ? `: ${input.reason}` : "."}` })

export const resolveSupportCase = (schoolId, caseId, actor, body = {}) => simpleCaseTransition(schoolId, caseId, actor, body, { allowed: ["continued_support", "teacher_follow_up", "strategy_review"], next: async (record, input, db) => {
  const { policy } = await activePolicy(schoolId, db)
  if (!input.reassessment_published || number(input.comparable_success_count) < policy.resolutionComparableEvidenceCount || !input.teacher_review_completed) throw new HttpError(409, "Resolution requires a published reassessment, sufficient comparable successful evidence and completed teacher review.")
  return { status: "resolved", level: 0, closed: true }
}, eventType: "case_resolved", summary: () => "The case met the configured evidence and human-review requirements for resolution." })

export async function carryForwardSupportCase(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
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
    const record = await lockedCase(db, schoolId, caseId, actor)
    const duplicate = await duplicateMutation(db, schoolId, record, body.idempotency_key); if (duplicate) return duplicate
    assertVersion(record, body)
    const ref = randomUUID(); const type = body.meeting_type || "academic_team_review"
    await db.query("INSERT INTO academic_review_meetings (public_ref,school_id,term_id,case_id,scheduled_at,meeting_type,attendee_user_ids_json,evidence_summary_json,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [ref, schoolId, record.current_term_id, record.id, body.scheduled_at || new Date(Date.now() + 5 * 86_400_000), type, JSON.stringify(body.attendee_user_ids || []), JSON.stringify(body.evidence_summary || { case_summary: record.current_summary }), body.scheduled_at ? "scheduled" : "requested", actor.id, actor.id])
    await db.query("UPDATE learner_support_cases SET status='academic_team_review',escalation_level=GREATEST(escalation_level,4),version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [actor.id, schoolId, record.id])
    await event(db, schoolId, record, actor, "academic_review_requested", "An academic team review was requested with an evidence summary.", { idempotencyKey: body.idempotency_key || `academic-review:${record.id}:${record.version_number}`, linkedType: "academic_review_meeting", linkedRef: ref })
    return { public_ref: ref, status: body.scheduled_at ? "scheduled" : "requested" }
  })
}

export async function draftGuardianSummary(schoolId, caseId, actor, body = {}) {
  return inTransaction(async (db) => {
    const record = await lockedCase(db, schoolId, caseId, actor)
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

export async function syncSupportCasesFromPublishedAssessment(db, schoolId, assessment, actor) {
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
      const identity = scope.scope_type === "learner" ? `learner:${learner.student_id}:${assessment.subject_id}:${topicId}` : `${scope.scope_type}:${assessment.class_id}:${assessment.subject_id}:${topicId}`
      const [existingCases] = await db.query("SELECT * FROM learner_support_cases WHERE school_id=? AND identity_key=? LIMIT 1 FOR UPDATE", [schoolId, identity])
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
        await db.query("INSERT INTO learner_support_case_members (public_ref,school_id,case_id,learner_id,membership_status,baseline_summary_json,created_by,updated_by) VALUES (?,?,?,?, 'active',?,?,?) ON DUPLICATE KEY UPDATE membership_status='active',updated_by=VALUES(updated_by)", [randomUUID(), schoolId, caseRecord.id, member.student_id, JSON.stringify({ score_percentage: member.score_percentage, assessment_id: assessment.id }), actor?.id || null, actor?.id || null])
        const [[prior]] = await db.query("SELECT * FROM learner_support_case_evidence WHERE school_id=? AND case_id=? AND learner_id=? AND topic_id=? AND evidence_status='valid' ORDER BY observed_at DESC,id DESC LIMIT 1", [schoolId, caseRecord.id, member.student_id, topicId])
        const comparison = prior ? compareAcademicEvidence(prior, { ...member, objective_id: member.learning_objective_id, observed_at: member.recorded_at }, policy) : { comparable: false, reasons: ["first_evidence"] }
        await db.query(`INSERT INTO learner_support_case_evidence (public_ref,school_id,case_id,academic_year_id,term_id,learner_id,subject_id,topic_id,objective_id,assessment_id,question_id,mastery_evidence_id,evidence_role,evidence_precision,score_percentage,marks_awarded,marks_available,confidence_score,comparable,comparability_json,evidence_status,observed_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE score_percentage=VALUES(score_percentage),confidence_score=VALUES(confidence_score),comparability_json=VALUES(comparability_json),updated_by=VALUES(updated_by)`, [randomUUID(), schoolId, caseRecord.id, assessment.academic_year_id, assessment.term_id, member.student_id, assessment.subject_id, topicId, member.learning_objective_id, assessment.id, member.question_id, member.id, prior ? "comparison" : "detection", member.evidence_precision || "limited", member.score_percentage, member.marks_awarded, member.marks_available, number(member.confidence_score, evidenceConfidence(member)) || evidenceConfidence(member), comparison.comparable ? 1 : 0, JSON.stringify(comparison), "valid", member.recorded_at || new Date(), actor?.id || null, actor?.id || null])
      }
      const [[stats]] = await db.query("SELECT 1+COUNT(DISTINCT CASE WHEN comparable=1 THEN assessment_id END) failure_count,MAX(confidence_score) confidence FROM learner_support_case_evidence WHERE school_id=? AND case_id=? AND evidence_status='valid'", [schoolId, caseRecord.id])
      const failureCount = number(stats.failure_count, 1)
      const nextLevel = failureCount >= policy.comparableFailureCountForIntervention ? 2 : number(caseRecord.escalation_level)
      const nextStatus = failureCount >= policy.comparableFailureCountForIntervention && caseRecord.status === "detected" ? "teacher_follow_up" : caseRecord.status
      const narrative = buildCaseNarrative({ ...caseRecord, comparable_failure_count: failureCount, evidence_confidence: stats.confidence }, { learnerName: learner?.learner_name, topicName: members[0].topic_name, affectedLearners: members.length, classSize })
      await db.query("UPDATE learner_support_cases SET comparable_failure_count=?,evidence_confidence=?,current_summary=?,status=?,escalation_level=?,current_term_id=?,academic_year_id=?,version_number=version_number+1,updated_by=? WHERE school_id=? AND id=?", [failureCount, number(stats.confidence), narrative, nextStatus, nextLevel, assessment.term_id, assessment.academic_year_id, actor?.id || null, schoolId, caseRecord.id])
      if (nextLevel >= 2) await event(db, schoolId, caseRecord, actor, "formal_intervention_recommended", "Repeated comparable evidence reached the school's formal-intervention threshold. A different, structured strategy should now be selected.", { idempotencyKey: `formal-recommendation:${caseRecord.id}:${failureCount}`, linkedType: "assessment", linkedRef: String(assessment.id), evidence: { comparable_failure_count: failureCount } })
      touched.push(caseRecord.public_ref)
    }
  }
  return { cases_touched: [...new Set(touched)], weak_evidence_count: weak.length }
}

import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCaseNarrative,
  classifySupportScope,
  compareAcademicEvidence,
  evaluateInterventionDelivery,
  normalizeEscalationPolicy,
  recommendAlternativeStrategy,
} from "../src/services/academicSupportService.js"

const evidence = (overrides = {}) => ({
  topic_id: 10,
  objective_id: 20,
  evidence_precision: "question",
  evidence_status: "valid",
  publication_state: "published",
  marks_available: 10,
  difficulty: 2,
  assessment_format: "timed_written",
  observed_at: "2026-01-10T08:00:00Z",
  ...overrides,
})

test("escalation policy keeps safe defaults while accepting school overrides", () => {
  const policy = normalizeEscalationPolicy({ comparableFailureCountForIntervention: 3 })
  assert.equal(policy.comparableFailureCountForIntervention, 3)
  assert.equal(policy.minimumSupportAttendanceRate, 70)
  assert.equal(policy.reassessmentRequired, true)
})

test("same mapped topic evidence is comparable", () => {
  const result = compareAcademicEvidence(evidence(), evidence({ observed_at: "2026-02-01T08:00:00Z", score_percentage: 52 }))
  assert.equal(result.comparable, true)
  assert.deepEqual(result.reasons, [])
})

test("overall totals cannot be counted as repeated topic failure", () => {
  const result = compareAcademicEvidence(evidence(), evidence({ evidence_precision: "overall", topic_id: null }))
  assert.equal(result.comparable, false)
  assert.ok(result.reasons.includes("topic"))
  assert.ok(result.reasons.includes("precision"))
})

test("absent, draft, tiny and stale evidence is not comparable", () => {
  const result = compareAcademicEvidence(evidence(), evidence({ evidence_status: "absent", publication_state: "draft", marks_available: 2, observed_at: "2027-01-10T08:00:00Z" }))
  assert.equal(result.comparable, false)
  assert.ok(result.reasons.includes("evidence_status"))
  assert.ok(result.reasons.includes("publication_state"))
  assert.ok(result.reasons.includes("mapped_marks"))
  assert.ok(result.reasons.includes("interval"))
})

test("widespread failure becomes one class issue", () => {
  assert.equal(classifySupportScope(17, 24).scope_type, "class")
})

test("a meaningful cluster becomes a group issue", () => {
  assert.equal(classifySupportScope(5, 24).scope_type, "group")
})

test("one learner remains an individual issue", () => {
  assert.equal(classifySupportScope(1, 24).scope_type, "learner")
})

test("incomplete delivery is operational follow-up, not ineffective learning", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 5, completedSessions: 2, attendanceEligible: 2, attendedSessions: 2 })
  assert.equal(outcome.outcome, "incomplete_delivery")
  assert.equal(outcome.classifyLearnerResponse, false)
})

test("low learner attendance is insufficient participation, not failed intervention", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 2 })
  assert.equal(outcome.outcome, "insufficient_participation")
  assert.equal(outcome.classifyLearnerResponse, false)
})

test("a missing reassessment remains pending", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: false })
  assert.equal(outcome.outcome, "awaiting_reassessment")
})

test("a non-comparable reassessment is inconclusive", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: true, reassessmentComparable: false })
  assert.equal(outcome.outcome, "inconclusive")
})

test("completed support with criterion met is effective", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: true, reassessmentComparable: true, baselineScore: 40, reassessmentScore: 74, successCriterion: 70 })
  assert.equal(outcome.outcome, "effective")
  assert.equal(outcome.recommendedEscalation, "monitor_resolution")
})

test("completed support with no progress triggers strategy review", () => {
  const outcome = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: true, reassessmentComparable: true, baselineScore: 40, reassessmentScore: 42, successCriterion: 70 })
  assert.equal(outcome.outcome, "ineffective")
  assert.equal(outcome.recommendedEscalation, "strategy_review")
})

test("strategy recommendation does not repeat a used strategy when alternatives exist", () => {
  const next = recommendAlternativeStrategy([{ strategy_code: "guided_practice" }, { strategy_code: "visual_concrete_materials" }])
  assert.notEqual(next.strategy_code, "guided_practice")
  assert.notEqual(next.strategy_code, "visual_concrete_materials")
})

test("cross-subject narrative is neutral and does not diagnose", () => {
  const narrative = buildCaseNarrative({ case_type: "multi_subject_decline" }, { subjectCount: 3 })
  assert.match(narrative, /broader academic review/i)
  assert.doesNotMatch(narrative, /diagnos|lazy|disabil|anxiety|intelligence/i)
})

test("class narrative states population evidence instead of blaming learners", () => {
  const narrative = buildCaseNarrative({ scope_type: "class" }, { affectedLearners: 17, classSize: 24, topicName: "Equivalent fractions" })
  assert.match(narrative, /17 of 24/)
  assert.match(narrative, /whole-class/i)
})

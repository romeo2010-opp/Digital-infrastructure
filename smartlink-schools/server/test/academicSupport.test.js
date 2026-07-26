import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCaseNarrative,
  classifySupportScope,
  compareAcademicEvidence,
  deriveSupportEvidenceReconciliation,
  deriveSupportCaseOutcomeTransition,
  evaluateInterventionDelivery,
  normalizeEscalationPolicy,
  recommendAlternativeStrategy,
  summarizeOfficialReassessmentEvidence,
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

test("a reassessment cannot predate or equal its baseline", () => {
  const result = compareAcademicEvidence(evidence(), evidence({ observed_at: "2026-01-09T08:00:00Z" }))
  assert.equal(result.comparable, false)
  assert.ok(result.reasons.includes("chronology"))
})

test("withdrawing the only valid trigger closes an active support case as inconclusive", () => {
  const state = deriveSupportEvidenceReconciliation({ status: "teacher_follow_up", escalation_level: 1 }, { validEvidenceCount: 0, failureCount: 0, confidence: 0 })
  assert.equal(state.status, "closed_inconclusive")
  assert.equal(state.failureCount, 0)
  assert.equal(state.closeCase, true)
})

test("corrected weak evidence reopens the case to its pre-correction workflow", () => {
  const state = deriveSupportEvidenceReconciliation(
    { status: "closed_inconclusive", escalation_level: 0, intervention_cycle_count: 1 },
    { validEvidenceCount: 2, failureCount: 1, confidence: 78 },
    {},
    { previousCaseState: { status: "intervention_active", escalationLevel: 2 } },
  )
  assert.equal(state.status, "intervention_active")
  assert.equal(state.level, 2)
  assert.equal(state.reopenCase, true)
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

test("partially-effective support continues when the strategy was not repeated", () => {
  const diagnostic = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: true, reassessmentComparable: true, baselineScore: 40, reassessmentScore: 48, successCriterion: 70, minimumMeaningfulChange: 5, strategyRepeated: false })
  const transition = deriveSupportCaseOutcomeTransition({ status: "reassessment_pending", escalation_level: 2, successful_cycle_count: 0, unsuccessful_cycle_count: 0 }, diagnostic)
  assert.equal(diagnostic.outcome, "partially_effective")
  assert.equal(diagnostic.recommendedEscalation, "continued_support")
  assert.equal(transition.status, "continued_support")
  assert.equal(transition.unsuccessfulCycles, 0)
})

test("a repeated partially-effective strategy persists the evaluator's strategy review", () => {
  const diagnostic = evaluateInterventionDelivery({ plannedSessions: 4, completedSessions: 4, attendanceEligible: 4, attendedSessions: 4, reassessmentPublished: true, reassessmentComparable: true, baselineScore: 40, reassessmentScore: 48, successCriterion: 70, minimumMeaningfulChange: 5, strategyRepeated: true })
  const transition = deriveSupportCaseOutcomeTransition({ status: "reassessment_pending", escalation_level: 2, successful_cycle_count: 0, unsuccessful_cycle_count: 0 }, diagnostic)
  assert.equal(diagnostic.outcome, "partially_effective")
  assert.equal(diagnostic.recommendedEscalation, "strategy_review")
  assert.equal(transition.status, "strategy_review")
  assert.equal(transition.unsuccessfulCycles, 1)
})

test("official persisted learner-topic evidence derives scores and comparability", () => {
  const baselineRows = [evidence({ student_id: 1, marks_awarded: 4, marks_available: 10, score_percentage: 40 })]
  const reassessmentRows = [evidence({ student_id: 1, marks_awarded: 7, marks_available: 10, score_percentage: 70, observed_at: "2026-02-01T08:00:00Z" })]
  const result = summarizeOfficialReassessmentEvidence({ expectedLearnerIds: [1], baselineRows, reassessmentRows, minimumMeaningfulChange: 5 })
  assert.equal(result.reassessmentPublished, true)
  assert.equal(result.reassessmentComparable, true)
  assert.equal(result.baselineScore, 40)
  assert.equal(result.reassessmentScore, 70)
  assert.deepEqual(result.improvedComponents, ["learner:1"])
})

test("missing or draft persisted learner evidence cannot be claimed as comparable", () => {
  const baselineRows = [evidence({ student_id: 1, marks_awarded: 4, marks_available: 10, score_percentage: 40 })]
  const reassessmentRows = [evidence({ student_id: 1, publication_state: "draft", marks_awarded: 9, marks_available: 10, score_percentage: 90 })]
  const result = summarizeOfficialReassessmentEvidence({ expectedLearnerIds: [1, 2], baselineRows, reassessmentRows })
  assert.equal(result.reassessmentPublished, false)
  assert.equal(result.reassessmentComparable, false)
  assert.ok(result.comparisons.some((item) => item.student_id === 2 && item.reasons.includes("baseline_missing")))
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

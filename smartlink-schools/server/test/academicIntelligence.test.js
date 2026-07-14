import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateExamReadiness,
  calculateMastery,
  calculatePacing,
  assessEvidenceQuality,
  calculatePerformanceScore,
  analyzeTrend,
  detectAcademicAnomalies,
  consolidateAcademicFindings,
  evaluateInterventionEffectiveness,
  analyzeCohort,
  classifyAcademicRisk,
  buildAcademicRecommendation,
  normalizeEvidenceRecord,
  assessmentSourceWeight,
  summarizeQuestionAnalytics,
  validateAssessmentBlueprintInput,
  validateDependencyGraph,
  validateParentInsightTransition,
} from '../src/services/academicIntelligenceEngine.js'
import { buildNarratorInput, deterministicAcademicNarration, validateAcademicNarration } from '../src/services/academicIntelligenceNarrator.js'
import { defaultPermissionsForRole } from '../src/services/authorizationService.js'
import { requireExactRole } from '../src/middleware/auth.js'

test('mastery distinguishes no evidence and insufficient evidence', () => {
  assert.equal(calculateMastery([]).mastery_status, 'NOT_ASSESSED')
  const result = calculateMastery([{score_percentage:90,evidence_at:'2026-07-10',marks_available:10,evidence_type:'assessment_question',evidence_granularity:'objective'}],{minimum_evidence_count:3},new Date('2026-07-12'))
  assert.equal(result.mastery_status, 'INSUFFICIENT_EVIDENCE')
  assert.equal(result.evidence_count, 1)
})

test('mastery weights recent independent assessment evidence and remains explainable', () => {
  const evidence = [
    {public_ref:'old',score_percentage:40,evidence_at:'2025-01-01',marks_available:5,difficulty_weight:1,assessment_weight:.5,independence_weight:1,evidence_type:'daily_drill',evidence_granularity:'objective'},
    {public_ref:'a',score_percentage:78,evidence_at:'2026-07-08',marks_available:20,difficulty_weight:1.1,assessment_weight:1,independence_weight:1,evidence_type:'assessment_question',evidence_granularity:'objective'},
    {public_ref:'b',score_percentage:82,evidence_at:'2026-07-10',marks_available:20,difficulty_weight:1.2,assessment_weight:1,independence_weight:1,evidence_type:'assessment_question',evidence_granularity:'objective'},
    {public_ref:'c',score_percentage:86,evidence_at:'2026-07-12',marks_available:10,difficulty_weight:1.2,assessment_weight:1,independence_weight:1,evidence_type:'reassessment',evidence_granularity:'objective'},
  ]
  const result = calculateMastery(evidence,{minimum_evidence_count:3,mastery_threshold:70,intervention_threshold:45,recency_half_life_days:60},new Date('2026-07-12'))
  assert.ok(result.mastery_score > 75)
  assert.ok(result.confidence_score >= 80)
  assert.match(result.explanation.formula,/recency/)
  assert.equal(result.mastery_status,'MASTERED')
})

test('pacing reports consolidation risk when teaching is far ahead of mastery', () => {
  const result=calculatePacing({totalTopics:20,planned:15,taught:15,assessed:10,mastered:7,elapsedTeachingDays:50,totalTeachingDays:80,remainingTeachingDays:30})
  assert.equal(result.taught_percentage,75)
  assert.equal(result.mastered_percentage,35)
  assert.equal(result.risk,'consolidation')
  assert.ok(result.required_topics_per_week>0)
})

test('exam readiness exposes missing data and prerequisite penalties', () => {
  const result=calculateExamReadiness({syllabus_completion:80,assessed_coverage:70,topic_mastery:65,recent_performance:68,attendance:90,weak_prerequisite_count:3,untaught_mandatory_topics:2})
  assert.ok(result.readiness_score<70)
  assert.ok(result.missing_data.includes('consistency'))
  assert.equal(result.penalties.prerequisite_gap,6)
})

test('dependency validation rejects cycles', () => {
  assert.deepEqual(validateDependencyGraph([{from:'fractions',to:'arithmetic'},{from:'algebra',to:'fractions'}]).valid,true)
  const cyclic=validateDependencyGraph([{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'a'}])
  assert.equal(cyclic.valid,false)
  assert.ok(cyclic.cycles.length)
})

test('assessment blueprints reject uncovered marks and missing curriculum mapping', () => {
  const valid = validateAssessmentBlueprintInput({
    total_marks: 50,
    duration_minutes: 60,
    topics: [
      { topic_id: 10, marks: 20 },
      { topic_id: 11, marks: 30 },
    ],
    difficulty_distribution: { easy: 20, medium: 60, hard: 20 },
    cognitive_distribution: { recall: 30, application: 50, analysis: 20 },
  })
  assert.equal(valid.valid, true)
  assert.equal(valid.summary.topic_marks, 50)

  const invalid = validateAssessmentBlueprintInput({ total_marks: 50, duration_minutes: 60, topics: [], difficulty_distribution: {}, cognitive_distribution: {} })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some((message) => /marks/i.test(message)))
  assert.ok(invalid.errors.some((message) => /topic|objective/i.test(message)))
})

test('question analytics preserve estimated difficulty and flag measured extremes only after enough attempts', () => {
  const early = summarizeQuestionAnalytics({ total_attempts: 4, success_rate: 100 })
  assert.deepEqual(early.flags, ['insufficient_attempts'])
  assert.equal(early.measured_difficulty, 0)
  assert.ok(early.confidence_score < 35)

  const mature = summarizeQuestionAnalytics({ total_attempts: 30, success_rate: 12 })
  assert.ok(mature.flags.includes('nearly_everyone_incorrect'))
  assert.equal(mature.measured_difficulty, 88)
  assert.equal(mature.confidence_score, 100)
})

test('parent academic updates require approval before publication and cannot move backwards', () => {
  assert.equal(validateParentInsightTransition('draft', 'published'), false)
  assert.equal(validateParentInsightTransition('draft', 'approved'), true)
  assert.equal(validateParentInsightTransition('approved', 'published'), true)
  assert.equal(validateParentInsightTransition('published', 'draft'), false)
  assert.equal(validateParentInsightTransition('published', 'withdrawn'), true)
})

test('Classroom Mode is a teacher capability, not a librarian capability', () => {
  assert.ok(defaultPermissionsForRole('teacher').includes('CLASSROOM_MODE_USE'))
  assert.equal(defaultPermissionsForRole('librarian').includes('CLASSROOM_MODE_USE'), false)
  assert.equal(defaultPermissionsForRole('librarian').includes('ARCHIVED_NAMED_RESULTS_VIEW'), false)
  assert.equal(defaultPermissionsForRole('librarian').includes('HISTORICAL_RESULT_MODIFY'), false)
  let passed = false
  requireExactRole('teacher')({ user: { role: 'teacher' } }, {}, () => { passed = true })
  assert.equal(passed, true)
  assert.throws(() => requireExactRole('teacher')({ user: { role: 'librarian' } }, {}, () => {}), /restricted to the assigned role/i)
  assert.throws(() => requireExactRole('teacher')({ user: { role: 'super_admin' } }, {}, () => {}), /restricted to the assigned role/i)
})

test('canonical evidence distinguishes draft, absent, mapped and valid observations', () => {
  const rows = [
    { public_ref: 'published', evidence_type: 'mid_term_examination', marks_awarded: 16, marks_available: 20, topic_id: 4, status: 'published', evidence_at: '2026-07-10' },
    { public_ref: 'draft', evidence_type: 'quiz', marks_awarded: 20, marks_available: 20, status: 'draft', evidence_at: '2026-07-10' },
    { public_ref: 'absent', evidence_type: 'quiz', status: 'absent', participation_status: 'absent', evidence_at: '2026-07-10' },
  ]
  const quality = assessEvidenceQuality(rows, { now: '2026-07-12', minimumAttempts: 2 })
  assert.equal(normalizeEvidenceRecord(rows[0], { now: '2026-07-12' }).score_percentage, 80)
  assert.equal(quality.valid_count, 1)
  assert.equal(quality.invalid_count, 2)
  assert.equal(quality.state, 'limited')
  assert.equal(assessmentSourceWeight('mid-term examination'), 0.9)
})

test('performance score returns null when evidence is missing and explains weights', () => {
  const empty = calculatePerformanceScore([])
  assert.equal(empty.score, null)
  assert.equal(empty.evidence_state, 'insufficient')
  const score = calculatePerformanceScore([
    { evidence_type: 'homework', marks_awarded: 8, marks_available: 10, status: 'published', evidence_at: '2026-07-10' },
    { evidence_type: 'end_of_term_examination', marks_awarded: 70, marks_available: 100, status: 'published', evidence_at: '2026-07-10' },
  ], { now: '2026-07-12' })
  assert.ok(score.score > 65 && score.score < 75)
  assert.match(score.explanation.formula, /sourceWeight/)
})

test('trend and anomaly analysis require enough observations and remain review-oriented', () => {
  assert.equal(analyzeTrend([{ y: 40 }, { y: 42 }]).state, 'INSUFFICIENT_HISTORY')
  const trend = analyzeTrend([{ x: 1, y: 40 }, { x: 2, y: 45 }, { x: 3, y: 55 }, { x: 4, y: 60 }])
  assert.equal(trend.state, 'IMPROVING')
  const anomalies = detectAcademicAnomalies([
    ...Array.from({ length: 10 }, (_, index) => ({ public_ref: `a-${index}`, marks_awarded: 8, marks_available: 10, status: 'published' })),
    { public_ref: 'impossible', marks_awarded: 18, marks_available: 10, status: 'published' },
  ])
  assert.ok(anomalies.flags.some((flag) => flag.type === 'impossible_mark'))
  assert.equal(anomalies.psychometric_available, true)
})

test('related findings consolidate without losing evidence references', () => {
  const rows = consolidateAcademicFindings([
    { rule_key: 'fractions', category: 'mastery', title: 'Fractions', priority_score: 70, student_id: 's1', public_ref: 'e1' },
    { rule_key: 'fractions', category: 'mastery', title: 'Fractions', priority_score: 80, student_id: 's2', public_ref: 'e2' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].affected_learner_count, 2)
  assert.deepEqual(rows[0].evidence_ids.sort(), ['e1', 'e2'])
  assert.equal(rows[0].priority_score, 80)
})

test('intervention effectiveness requires comparable evidence', () => {
  assert.equal(evaluateInterventionEffectiveness({ baseline: [], reassessment: [] }).outcome, 'INCONCLUSIVE')
  const result = evaluateInterventionEffectiveness({
    baseline: [{ marks_awarded: 4, marks_available: 10, evidence_type: 'baseline_assessment', status: 'published' }],
    reassessment: [{ marks_awarded: 8, marks_available: 10, evidence_type: 'reassessment', status: 'published' }],
  })
  assert.equal(result.outcome, 'EFFECTIVE')
  assert.equal(result.change, 40)
})

test('cohort analysis and risk prioritisation remain explainable', () => {
  const cohort = analyzeCohort([{ score: 35 }, { score: 55 }, { score: 75 }, { score: 90 }], { minimumObservations: 4 })
  assert.equal(cohort.below_threshold, 2)
  assert.equal(cohort.distribution.advanced, 1)
  const risk = classifyAcademicRisk({ magnitude: 100, affectedLearners: 24, durationDays: 30, examProximityDays: 0, prerequisiteImpact: 100, confidence: 100 })
  assert.equal(risk.severity, 'critical')
  const recommendation = buildAcademicRecommendation({ finding: 'Equivalent fractions', evidence: ['evidence-ref'], action: 'Run a diagnostic', successCriteria: '5 mapped questions improve' })
  assert.deepEqual(recommendation.evidence, ['evidence-ref'])
})

test('academic narrator only accepts supplied finding IDs and evidence numbers', () => {
  const input = buildNarratorInput({ findings: [{ findingId: 'f-1', title: 'Fractions', evidence: 'Two mapped assessments show 38% mastery.', metrics: { mastery: 38 } }] })
  const fallback = deterministicAcademicNarration(input)
  assert.equal(fallback.priorities[0].findingId, 'f-1')
  assert.throws(() => validateAcademicNarration({ executiveSummary: 'Invented 99%', priorities: [{ findingId: 'unknown', headline: 'x', explanation: 'x', operationalImpact: 'x', recommendedAction: 'x', ownerRole: 'x', reassessmentMethod: 'x', confidenceLanguage: 'x' }], positiveSignals: [], limitations: [] }, input), /unknown finding|unsupported number/i)
  assert.doesNotThrow(() => validateAcademicNarration(fallback, input))
})

test('deterministic narration varies safely while retaining supplied facts and role language', () => {
  const first = deterministicAcademicNarration({ role: 'teacher', findings: [{ findingId: 'finding-alpha', title: 'Equivalent fractions', evidence: 'Mapped responses show a recurring representation gap.', confidence: 84 }] })
  const second = deterministicAcademicNarration({ role: 'director', findings: [{ findingId: 'finding-bravo', title: 'Equivalent fractions', evidence: 'Mapped responses show a recurring representation gap.', confidence: 84 }] })
  assert.notEqual(first.priorities[0].recommendedAction, second.priorities[0].recommendedAction)
  assert.equal(first.priorities[0].confidenceLanguage.includes('84'), true)
  assert.equal(second.priorities[0].confidenceLanguage.includes('84'), true)
  assert.equal(first.priorities[0].ownerRole, 'teacher')
  assert.equal(second.priorities[0].ownerRole, 'academic leadership')
})

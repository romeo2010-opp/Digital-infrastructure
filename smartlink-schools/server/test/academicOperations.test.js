import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACADEMIC_EVIDENCE_LEVELS,
  aggregateQuestionEvidence,
  buildGeneratedResponseLayout,
  confidenceForEvidenceLevel,
  dedupeTargetedLearners,
  sourcePermissionAllowsReuse,
  validateGeneratedAssessmentDraft,
  validateMarkSheetPayload,
  validateQuestionTopicMappings,
} from '../src/services/academicOperationsService.js'
import { createAnthropicProvider } from '../src/services/ai/providers/anthropicProvider.js'

test('academic evidence hierarchy prevents exact topic claims from overall totals', () => {
  assert.equal(ACADEMIC_EVIDENCE_LEVELS.QUESTION.level, 1)
  assert.equal(ACADEMIC_EVIDENCE_LEVELS.OVERALL.level, 4)
  assert.equal(ACADEMIC_EVIDENCE_LEVELS.OVERALL.topicClaimsAllowed, false)
  assert.ok(confidenceForEvidenceLevel('question', { mappedMarks: 20, questionCount: 5 }) > confidenceForEvidenceLevel('overall'))
})

test('multi-topic question mappings require exact allocated marks or percentages', () => {
  const validMarks = validateQuestionTopicMappings({ marks: 10 }, [
    { topic_id: 1, allocation_type: 'marks', allocated_marks: 6 },
    { topic_id: 2, allocation_type: 'marks', allocated_marks: 4 },
  ])
  assert.equal(validMarks.valid, true)
  assert.equal(validMarks.mappings.reduce((sum, row) => sum + row.allocated_marks, 0), 10)

  const validPercent = validateQuestionTopicMappings({ marks: 10 }, [
    { topic_id: 1, allocation_type: 'percentage', allocated_percentage: 60 },
    { topic_id: 2, allocation_type: 'percentage', allocated_percentage: 40 },
  ])
  assert.equal(validPercent.valid, true)
  assert.deepEqual(validPercent.mappings.map((row) => row.allocated_marks), [6, 4])

  const vague = validateQuestionTopicMappings({ marks: 10 }, [
    { topic_id: 1, allocation_type: 'marks', allocated_marks: 5 },
    { topic_id: 2, allocation_type: 'marks', allocated_marks: 3 },
  ])
  assert.equal(vague.valid, false)
  assert.match(vague.errors.join(' '), /must equal/i)
})

test('subquestions aggregate question marks into derived topic totals', () => {
  const result = aggregateQuestionEvidence({
    questions: [
      { id: 1, display_number: 'Q1', marks: 5, topic_mappings: [{ topic_id: 10, allocated_marks: 5 }] },
      { id: 2, display_number: 'Q3(a)', parent_question_id: 30, marks: 6, topic_mappings: [{ topic_id: 20, allocated_marks: 6 }] },
      { id: 3, display_number: 'Q3(b)', parent_question_id: 30, marks: 4, topic_mappings: [{ topic_id: 20, allocated_marks: 4 }] },
    ],
    marks: { 1: 4, 2: 2, 3: 1 },
  })
  assert.equal(result.total_awarded, 7)
  assert.equal(result.total_available, 15)
  assert.equal(result.topics.find((row) => row.topic_id === 20).marks_awarded, 3)
  assert.equal(result.topics.find((row) => row.topic_id === 20).marks_available, 10)
  assert.equal(result.mapping_coverage, 100)
})

test('mark validation keeps absence and incompleteness distinct from zero', () => {
  const questions = [{ id: 1, marks: 5 }]
  const result = validateMarkSheetPayload({ mode: 'question', questions, entries: [
    { student_id: 1, participation_status: 'absent', question_marks: { 1: '' } },
    { student_id: 2, participation_status: 'incomplete', question_marks: { 1: '' } },
    { student_id: 3, participation_status: 'present', question_marks: { 1: 0 } },
  ] })
  assert.equal(result.valid, true)
  const impossible = validateMarkSheetPayload({ mode: 'question', questions, entries: [{ student_id: 3, participation_status: 'present', question_marks: { 1: 6 } }] })
  assert.equal(impossible.valid, false)
  assert.match(impossible.errors.join(' '), /between 0 and 5/i)
})

test('question-source permissions block unknown and prohibited reuse', () => {
  assert.equal(sourcePermissionAllowsReuse({ permission_status: 'school_owned', reuse_allowed: 1 }), true)
  assert.equal(sourcePermissionAllowsReuse({ permission_status: 'unknown_permission', reuse_allowed: 1 }), false)
  assert.equal(sourcePermissionAllowsReuse({ permission_status: 'prohibited_reuse', reuse_allowed: 1 }), false)
  assert.equal(sourcePermissionAllowsReuse({ permission_status: 'licensed', reuse_allowed: 1, transformation_allowed: 0 }, { transform: true }), false)
})

test('generated assessments require answers, mapped topics, unique questions and exact marks', () => {
  const valid = validateGeneratedAssessmentDraft({ questions: [
    { question_text: 'Show one equivalent fraction for one half.', expected_answer: 'Two quarters', marks: 4, topicId: 'fractions', response_layout: buildGeneratedResponseLayout({ question_type: 'structured', marks: 4 }) },
    { question_text: 'Simplify four eighths.', expectedAnswer: 'One half', marks: 4, topicId: 'fractions', response_layout: buildGeneratedResponseLayout({ question_type: 'calculation', marks: 4 }) },
    { question_text: 'Compare two thirds and one half.', expectedAnswer: 'Two thirds is greater', marks: 2, topicId: 'fractions', response_layout: buildGeneratedResponseLayout({ question_type: 'short_answer', marks: 2 }) },
  ] }, { totalMarks: 10 })
  assert.equal(valid.valid, true)
  const invalid = validateGeneratedAssessmentDraft({ questions: [
    { question_text: 'Repeated', expectedAnswer: '', marks: 3, topicId: 'fractions' },
    { question_text: 'Repeated', expectedAnswer: 'Answer', marks: 3, topicId: 'fractions' },
  ] }, { totalMarks: 10 })
  assert.equal(invalid.valid, false)
  assert.match(invalid.errors.join(' '), /answer|marks|duplicate/i)
})

test('targeted learner proposals are unique even with duplicate enrollment evidence rows', () => {
  const learners = dedupeTargetedLearners([
    { student_id: 7, student_ref: 'learner-7', reason: 'first evidence row' },
    { student_id: 7, student_ref: 'learner-7', reason: 'duplicate enrollment row' },
    { student_id: 8, student_ref: 'learner-8', reason: 'different learner' },
  ])
  assert.equal(learners.length, 2)
  assert.deepEqual(learners.map((learner) => learner.student_id), [7, 8])
})

test('generated response layouts create printable answer space for every question type', () => {
  const shortAnswer = buildGeneratedResponseLayout({ question_type: 'short_answer', marks: 3 })
  const calculation = buildGeneratedResponseLayout({ question_type: 'calculation', marks: 5 })
  const multipleChoice = buildGeneratedResponseLayout({ question_type: 'multiple_choice', marks: 1 })
  assert.equal(shortAnswer.answer_space_type, 'ruled_lines')
  assert.ok(shortAnswer.answer_lines >= 3)
  assert.equal(calculation.answer_space_type, 'blank_box')
  assert.ok(calculation.answer_height >= 120)
  assert.ok(multipleChoice.answer_height > 0)
})

test('Anthropic provider remains unavailable without an environment credential', async () => {
  const provider = createAnthropicProvider({ model: 'claude-sonnet-4-20250514', apiKey: '' })
  const status = await provider.status()
  assert.equal(status.provider, 'anthropic')
  assert.equal(status.available, false)
  await assert.rejects(() => provider.generateJson({ prompt: 'Return JSON', schemaHint: '{}' }), /ANTHROPIC_API_KEY/i)
})

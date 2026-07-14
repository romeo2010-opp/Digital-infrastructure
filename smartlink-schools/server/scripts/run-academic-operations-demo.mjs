import dotenv from 'dotenv'
import { pool } from '../src/config/db.js'
import {
  approveTargetedAssessment,
  confirmTargetedLearners,
  createTargetedAssessmentDraft,
  generateTargetedAssessment,
  getAcademicMarkSheet,
  getTargetedAssessment,
  publishAcademicMarkSheet,
  publishTargetedAssessment,
  saveAcademicMarkSheetDraft,
  saveTargetedAssessmentReview,
} from '../src/services/academicOperationsService.js'

dotenv.config()
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_DATA_TOOLS !== 'true') throw new Error('Greenfield academic operations demo is disabled in production.')

const [[scope]] = await pool.query(`SELECT sch.id school_id,c.id class_id,c.public_ref class_ref,s.id subject_id,s.public_ref subject_ref,st.id topic_id,st.public_ref topic_ref,
  ay.id academic_year_id,t.id term_id,u.id actor_id,u.role actor_role,ai.id intervention_id,ai.public_ref intervention_ref
  FROM schools sch JOIN classes c ON c.school_id=sch.id AND c.name='Year 5'
  JOIN subjects s ON s.school_id=sch.id AND s.name='Mathematics'
  JOIN syllabus_topics st ON st.school_id=sch.id AND st.subject_id=s.id AND st.topic_name='Fractions and equivalent fractions' AND st.grade_id=(SELECT id FROM grade_levels WHERE school_id=sch.id AND name='Year 5' LIMIT 1)
  JOIN academic_years ay ON ay.school_id=sch.id AND ay.is_active=1 JOIN terms t ON t.school_id=sch.id AND t.academic_year_id=ay.id AND t.name='Term 2'
  JOIN users u ON u.school_id=sch.id AND u.role='school_owner' AND u.is_active=1
  JOIN academic_interventions ai ON ai.school_id=sch.id AND ai.class_id=c.id AND ai.subject_id=s.id AND ai.topic_id=st.id AND ai.intervention_type='prerequisite_recovery'
  WHERE sch.code='GFA' ORDER BY u.id,ai.id LIMIT 1`)
if (!scope) throw new Error('Greenfield Year 5 Mathematics scenario is missing. Seed the Greenfield demo first.')
const actor = { id: Number(scope.actor_id), role: scope.actor_role }

const [[baselineAssessment]] = await pool.query(`SELECT a.id,a.name FROM assessments a
  WHERE a.school_id=? AND a.class_id=? AND a.subject_id=? AND a.name LIKE 'Term 2 Mid-Term Examinations%'
    AND EXISTS(SELECT 1 FROM assessment_questions aq JOIN question_topic_mappings qtm ON qtm.assessment_question_id=aq.id AND qtm.school_id=aq.school_id WHERE aq.school_id=a.school_id AND aq.assessment_id=a.id)
  ORDER BY a.id LIMIT 1`, [scope.school_id, scope.class_id, scope.subject_id])
if (!baselineAssessment) throw new Error('A mapped Year 5 Mathematics baseline assessment was not found.')

const existingBaseline = await getAcademicMarkSheet(scope.school_id, baselineAssessment.id, { mode: 'question' })
if (!['published', 'locked'].includes(existingBaseline.mark_sheet?.status)) {
  const fractionQuestionIds = new Set(existingBaseline.questions.filter((question) => question.topic_mappings?.some((mapping) => Number(mapping.topic_id) === Number(scope.topic_id))).map((question) => Number(question.id)))
  const multiplicationQuestionIds = new Set(existingBaseline.questions.filter((question) => question.topic_mappings?.some((mapping) => /multiplication|division/i.test(mapping.topic_name || ''))).map((question) => Number(question.id)))
  const entries = existingBaseline.entries.map((learner, learnerIndex) => ({
    student_id: learner.student_id,
    participation_status: 'present',
    question_marks: Object.fromEntries(existingBaseline.questions.map((question) => {
      let ratio = .8
      if (learnerIndex < 10 && fractionQuestionIds.has(Number(question.id))) ratio = .2
      if (learnerIndex < 7 && multiplicationQuestionIds.has(Number(question.id))) ratio = .3
      return [question.id, Number((Number(question.marks) * ratio).toFixed(2))]
    })),
  }))
  await saveAcademicMarkSheetDraft(scope.school_id, baselineAssessment.id, actor, { mode: 'question', idempotency_key: 'greenfield-year5-fractions-baseline', entries })
  await publishAcademicMarkSheet(scope.school_id, baselineAssessment.id, actor, { mode: 'question' })
}

const [[baselineSheet]] = await pool.query(`SELECT id,public_ref FROM academic_mark_sheets WHERE school_id=? AND assessment_id=? AND entry_mode='question' AND status IN ('published','locked') LIMIT 1`, [scope.school_id, baselineAssessment.id])
const [affected] = await pool.query(`SELECT ltr.student_id,s.public_ref student_ref,ROUND(ltr.percentage,1) baseline_percentage
  FROM learner_topic_results ltr JOIN students s ON s.id=ltr.student_id AND s.school_id=ltr.school_id
  WHERE ltr.school_id=? AND ltr.mark_sheet_id=? AND ltr.topic_id=? AND ltr.is_official=1 AND ltr.percentage<70
  ORDER BY s.last_name,s.first_name LIMIT 10`, [scope.school_id, baselineSheet.id, scope.topic_id])
if (affected.length !== 10) throw new Error(`Expected exactly 10 affected Year 5 learners; found ${affected.length}.`)
const [[beforeAlert]] = await pool.query(`SELECT public_ref,severity,message,evidence_json FROM academic_alerts WHERE school_id=? AND class_id=? AND subject_id=? AND topic_id=? AND status='open' ORDER BY id DESC LIMIT 1`, [scope.school_id, scope.class_id, scope.subject_id, scope.topic_id])

const draft = await createTargetedAssessmentDraft(scope.school_id, actor, {
  finding_ref: beforeAlert?.public_ref || null,
  intervention_id: scope.intervention_id,
  academic_year_id: scope.academic_year_id,
  term_id: scope.term_id,
  class_ref: scope.class_ref,
  subject_ref: scope.subject_ref,
  topic_ref: scope.topic_ref,
  purpose: 'intervention_reassessment',
  title: 'Year 5 Equivalent Fractions Support Reassessment',
  duration_minutes: 20,
  total_marks: 20,
  question_count: 5,
  difficulty_distribution: { easy: 30, medium: 50, challenging: 20 },
  previous_evidence: { baseline_mark_sheet_ref: baselineSheet.public_ref, affected_learners: 10, prerequisite: 'Multiplication and division strategies' },
  learners: affected.map((learner) => ({ student_id: learner.student_id, reason: `Equivalent fractions baseline is ${learner.baseline_percentage}%, below secure mastery.`, confidence: 84, evidence: { baseline_percentage: learner.baseline_percentage, baseline_mark_sheet_ref: baselineSheet.public_ref } })),
})
await confirmTargetedLearners(scope.school_id, draft.public_ref, actor, { student_refs: affected.map((learner) => learner.student_ref) })
await generateTargetedAssessment(scope.school_id, draft.public_ref, actor, { use_ai: false })
const generated = await getTargetedAssessment(scope.school_id, draft.public_ref)
await saveTargetedAssessmentReview(scope.school_id, draft.public_ref, actor, { paper: generated.version.paper, change_summary: 'Teacher checked wording, topic alignment, answers and marking points.' })
await approveTargetedAssessment(scope.school_id, draft.public_ref, actor)
const published = await publishTargetedAssessment(scope.school_id, draft.public_ref, actor)

const reassessmentSheet = await getAcademicMarkSheet(scope.school_id, published.assessment_id, { mode: 'question' })
if (reassessmentSheet.entries.length !== 10) throw new Error(`Generated mark sheet must contain only 10 confirmed learners; found ${reassessmentSheet.entries.length}.`)
const reassessmentEntries = reassessmentSheet.entries.map((learner, learnerIndex) => ({
  student_id: learner.student_id,
  participation_status: 'present',
  question_marks: Object.fromEntries(reassessmentSheet.questions.map((question) => [question.id, Number((Number(question.marks) * (learnerIndex < 7 ? .75 : .2)).toFixed(2))])),
}))
await saveAcademicMarkSheetDraft(scope.school_id, published.assessment_id, actor, { mode: 'question', idempotency_key: `greenfield-year5-fractions-reassessment:${draft.public_ref}`, entries: reassessmentEntries })
const publication = await publishAcademicMarkSheet(scope.school_id, published.assessment_id, actor, { mode: 'question' })
const [[outcome]] = await pool.query(`SELECT air.outcome,air.outcome_summary_json,ai.status intervention_status,ai.outcome intervention_outcome FROM academic_intervention_reassessments air JOIN academic_interventions ai ON ai.id=air.intervention_id AND ai.school_id=air.school_id WHERE air.school_id=? AND air.generated_assessment_id=(SELECT id FROM generated_assessments WHERE school_id=? AND public_ref=?) LIMIT 1`, [scope.school_id, scope.school_id, draft.public_ref])
const [[afterAlert]] = await pool.query(`SELECT public_ref,severity,status,message,evidence_json FROM academic_alerts WHERE school_id=? AND class_id=? AND subject_id=? AND topic_id=? ORDER BY id DESC LIMIT 1`, [scope.school_id, scope.class_id, scope.subject_id, scope.topic_id])

console.log(JSON.stringify({
  ok: true,
  scenario: 'Year 5 Mathematics equivalent fractions operations loop',
  baseline: { assessment: baselineAssessment.name, mark_sheet_ref: baselineSheet.public_ref, affected_learners: affected.length, risk: beforeAlert ? { public_ref: beforeAlert.public_ref, severity: beforeAlert.severity, message: beforeAlert.message } : null },
  generated_assessment: { public_ref: draft.public_ref, assessment_id: published.assessment_id, title: generated.assessment.title, learner_count: reassessmentSheet.entries.length, question_count: reassessmentSheet.questions.length, total_marks: generated.assessment.total_marks, marking_scheme_items: generated.version.paper.questions.reduce((sum, question) => sum + (question.marking_points || []).length, 0), teacher_reviewed: true, mark_sheet_path: published.mark_sheet_path },
  reassessment: { publication, intervention_ref: scope.intervention_ref, outcome: outcome ? { ...outcome, outcome_summary: typeof outcome.outcome_summary_json === 'string' ? JSON.parse(outcome.outcome_summary_json) : outcome.outcome_summary_json, outcome_summary_json: undefined } : null, risk_after: afterAlert },
}, null, 2))
await pool.end()

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FilePlus2, RefreshCw, Send, Sparkles, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SectionCard } from './SectionCard'
import { usePortal } from '../lib/portalContext'

const selectClass = 'h-8 rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[11px] text-[#111827]'

export function TargetedAssessmentWorkflow({ setup, finding, supportCase, rows = [], onRefresh }: { setup: any; finding?: any; supportCase?: any; rows?: any[]; onRefresh?: () => void }) {
  const { token, api } = usePortal()
  const [form, setForm] = useState<any>({ class_ref: '', subject_ref: '', topic_ref: '', subtopic_ref: '', title: 'Targeted diagnostic assessment', purpose: 'diagnostic', duration_minutes: 20, total_marks: 20, question_count: 5, use_ai: false })
  const [activeRef, setActiveRef] = useState('')
  const [record, setRecord] = useState<any>(null)
  const [paper, setPaper] = useState<any>(null)
  const [working, setWorking] = useState(false)
  const selectedClass = (setup?.classes || []).find((item: any) => item.public_ref === form.class_ref)
  const selectedSubject = selectedClass?.subjects?.find((item: any) => item.public_ref === form.subject_ref)
  const selectedTopic = selectedSubject?.topics?.find((item: any) => item.public_ref === form.topic_ref)
  const subtopics = selectedTopic?.subtopics || []

  useEffect(() => {
    if (!finding) return
    const classRow = (setup?.classes || []).find((item: any) => item.public_ref === finding.class_ref)
    const subjectRow = classRow?.subjects?.find((item: any) => item.public_ref === finding.subject_ref)
    const directTopic = subjectRow?.topics?.find((item: any) => item.public_ref === finding.topic_ref)
    const parentTopic = subjectRow?.topics?.find((item: any) => (item.subtopics || []).some((subtopic: any) => subtopic.public_ref === finding.topic_ref))
    const selectedSubtopic = parentTopic?.subtopics?.find((item: any) => item.public_ref === finding.topic_ref)
    setForm((current: any) => ({ ...current, class_ref: classRow?.public_ref || current.class_ref, subject_ref: subjectRow?.public_ref || current.subject_ref, topic_ref: directTopic?.public_ref || parentTopic?.public_ref || current.topic_ref, subtopic_ref: selectedSubtopic?.public_ref || '', title: finding.topic_name ? `${finding.topic_name} targeted diagnostic` : current.title }))
  }, [finding, setup])

  useEffect(() => {
    if (!supportCase) return
    const classRow = (setup?.classes || []).find((item: any) => item.public_ref === supportCase.class_ref)
    const subjectRow = classRow?.subjects?.find((item: any) => item.public_ref === supportCase.subject_ref)
    const directTopic = subjectRow?.topics?.find((item: any) => item.public_ref === supportCase.topic_ref)
    const parentTopic = subjectRow?.topics?.find((item: any) => (item.subtopics || []).some((subtopic: any) => subtopic.public_ref === supportCase.topic_ref))
    const selectedSubtopic = parentTopic?.subtopics?.find((item: any) => item.public_ref === supportCase.topic_ref)
    setForm((current: any) => ({ ...current, class_ref: classRow?.public_ref || supportCase.class_ref || current.class_ref, subject_ref: subjectRow?.public_ref || supportCase.subject_ref || current.subject_ref, topic_ref: directTopic?.public_ref || parentTopic?.public_ref || supportCase.topic_ref || current.topic_ref, subtopic_ref: selectedSubtopic?.public_ref || '', title: supportCase.topic_name ? `${supportCase.topic_name} support reassessment` : current.title, purpose: 'intervention_reassessment' }))
  }, [setup, supportCase])

  const loadRecord = async (ref = activeRef) => {
    if (!ref) return
    const response = await api.getTargetedAssessment(token, ref)
    setRecord(response)
    setPaper(response.version?.paper || null)
  }
  useEffect(() => { if (activeRef) void loadRecord(activeRef) }, [activeRef])

  const run = async (task: () => Promise<any>, success: string) => {
    setWorking(true)
    try {
      const response = await task()
      toast.success(success)
      if (response.public_ref) setActiveRef(response.public_ref)
      await loadRecord(response.public_ref || activeRef)
      onRefresh?.()
      return response
    } catch (error: any) { toast.error(error.message || 'Unable to continue the assessment workflow.'); return null } finally { setWorking(false) }
  }
  const create = () => run(() => supportCase?.public_ref
    ? api.createCaseTargetedAssessment(token, supportCase.public_ref, { ...form, difficulty_distribution: { easy: 30, medium: 50, challenging: 20 } })
    : api.createTargetedAssessment(token, { ...form, finding_ref: finding?.public_ref || null, auto_select_below_threshold: true, difficulty_distribution: { easy: 30, medium: 50, challenging: 20 } }), 'Targeted assessment draft created with a proposed learner group.')
  const confirmLearners = () => run(() => api.confirmTargetedAssessmentLearners(token, activeRef, { student_refs: (record?.learners || []).map((learner: any) => learner.student_ref) }), 'Targeted learner list confirmed.')
  const generate = () => run(() => api.generateTargetedAssessment(token, activeRef, { use_ai: form.use_ai }), 'Question paper and marking scheme generated for teacher review.')
  const saveReview = () => run(() => api.saveTargetedAssessmentReview(token, activeRef, { paper, change_summary: 'Teacher-reviewed wording, answers and marking points' }), 'Teacher review saved as a new version.')
  const approve = () => run(() => api.approveTargetedAssessment(token, activeRef), 'Targeted assessment approved.')
  const publish = () => run(() => api.publishTargetedAssessment(token, activeRef), 'Targeted assessment published with a linked mark sheet.')
  const replace = (questionIndex: number) => run(() => api.replaceTargetedAssessmentQuestion(token, activeRef, { question_index: questionIndex }), `Question ${questionIndex + 1} replaced without regenerating the paper.`)
  const updateQuestion = (index: number, patch: any) => setPaper((current: any) => ({ ...current, questions: (current?.questions || []).map((question: any, questionIndex: number) => questionIndex === index ? { ...question, ...patch } : question) }))
  const confirmed = (record?.learners || []).filter((learner: any) => learner.confirmed).length
  const validation = record?.version?.validation
  const canApprove = Boolean(validation?.valid && confirmed && confirmed === (record?.learners || []).length)
  const selectedExisting = useMemo(() => rows.find((row) => row.public_ref === activeRef), [activeRef, rows])

  return <SectionCard title="Targeted assessment operations" subtitle="Create a focused diagnostic from a validated finding, confirm learners, review every question, then publish a linked mark sheet.">
    <div className="grid gap-4 p-4 xl:grid-cols-[360px_1fr]">
      <div className="grid content-start gap-3">
        <div className="grid gap-2 rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] p-3">
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Assessment title<Input className="h-8 bg-white text-[11px] font-normal normal-case tracking-normal" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Assessment title" /></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Class<select className={selectClass} value={form.class_ref} onChange={(event) => setForm({ ...form, class_ref: event.target.value, subject_ref: '', topic_ref: '', subtopic_ref: '' })}><option value="">Select class</option>{(setup?.classes || []).map((item: any) => <option key={item.public_ref} value={item.public_ref}>{item.name}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Subject<select className={selectClass} value={form.subject_ref} onChange={(event) => setForm({ ...form, subject_ref: event.target.value, topic_ref: '', subtopic_ref: '' })}><option value="">Select subject</option>{(selectedClass?.subjects || []).map((item: any) => <option key={item.public_ref} value={item.public_ref}>{item.name}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Syllabus topic<select className={selectClass} value={form.topic_ref} onChange={(event) => setForm({ ...form, topic_ref: event.target.value, subtopic_ref: '' })}><option value="">Select topic</option>{(selectedSubject?.topics || []).map((item: any) => <option key={item.public_ref} value={item.public_ref}>{item.name}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Syllabus subtopic<select className={selectClass} disabled={!form.topic_ref || !subtopics.length} value={form.subtopic_ref} onChange={(event) => setForm({ ...form, subtopic_ref: event.target.value })}><option value="">{subtopics.length ? 'Select subtopic' : 'No subtopics for this topic'}</option>{subtopics.map((item: any) => <option key={item.public_ref} value={item.public_ref}>{item.name}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Assessment purpose<select className={selectClass} value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })}><option value="diagnostic">Diagnostic</option><option value="prerequisite_check">Prerequisite check</option><option value="intervention_baseline">Intervention baseline</option><option value="intervention_reassessment">Intervention reassessment</option><option value="mastery_confirmation">Mastery confirmation</option><option value="catch_up_test">Catch-up test</option><option value="exam_preparation">Exam preparation</option><option value="misconception_check">Misconception check</option></select></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-[#64748b]">Duration (min)<Input className="font-normal normal-case" type="number" min={5} value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: Number(event.target.value) })} /></label>
            <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-[#64748b]">Total marks<Input className="font-normal normal-case" type="number" min={1} value={form.total_marks} onChange={(event) => setForm({ ...form, total_marks: Number(event.target.value) })} /></label>
            <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-[#64748b]">Questions<Input className="font-normal normal-case" type="number" min={1} max={30} value={form.question_count} onChange={(event) => setForm({ ...form, question_count: Number(event.target.value) })} /></label>
          </div>
          <label className="flex items-center gap-2 text-[10px] font-semibold text-[#475569]"><input type="checkbox" checked={form.use_ai} onChange={(event) => setForm({ ...form, use_ai: event.target.checked })} />Use optional reviewed AI composer when available</label>
          <Button disabled={working || !form.class_ref || !form.subject_ref || !form.topic_ref || (subtopics.length > 0 && !form.subtopic_ref)} className="h-8 text-[11px]" onClick={create}><FilePlus2 className="size-3.5" />Create targeted assessment</Button>
        </div>
        <div className="max-h-64 divide-y overflow-auto rounded-[7px] border border-[#e2e8f0] bg-white">
          {rows.map((row) => <button key={row.public_ref} type="button" onClick={() => setActiveRef(row.public_ref)} className={`grid w-full gap-1 px-3 py-2 text-left ${row.public_ref === activeRef ? 'bg-indigo-50' : 'hover:bg-[#f8fafc]'}`}><span className="text-[11px] font-semibold text-[#111827]">{row.title}</span><span className="text-[9px] uppercase text-[#64748b]">{row.class_name} · {row.topic_name}{row.subtopic_name ? ` → ${row.subtopic_name}` : ''} · {row.status} · {row.learner_count} learners</span></button>)}
          {!rows.length ? <div className="p-4 text-center text-[11px] text-[#64748b]">No targeted assessments have been created yet.</div> : null}
        </div>
      </div>

      <div className="min-w-0">
        {!record ? <div className="grid min-h-72 place-items-center rounded-[7px] border border-dashed border-[#cbd5e1] p-8 text-center text-[12px] leading-5 text-[#64748b]">Select a draft or create one from an immediate priority. SmartLink will propose learners from validated mastery evidence; the teacher must confirm the list.</div> : <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-[7px] border border-[#dbeafe] bg-[#eff6ff] p-3"><div><div className="text-[13px] font-semibold text-[#172554]">{record.assessment.title}</div><div className="mt-1 text-[10px] uppercase text-[#475569]">{record.assessment.class_name} · {record.assessment.subject_name} · {record.assessment.topic_name}{record.assessment.subtopic_name ? ` → ${record.assessment.subtopic_name}` : ''} · {record.assessment.status}</div></div><div className="flex flex-wrap gap-1.5"><Button variant="outline" className="h-8 bg-white text-[10px]" disabled={working || !record.learners.length || confirmed === record.learners.length} onClick={confirmLearners}><Users className="size-3" />Confirm {record.learners.length} learners</Button><Button variant="outline" className="h-8 bg-white text-[10px]" disabled={working || record.assessment.status === 'published'} onClick={generate}><Sparkles className="size-3" />Generate</Button><Button variant="outline" className="h-8 bg-white text-[10px]" disabled={working || !paper || record.assessment.status === 'published'} onClick={saveReview}><CheckCircle2 className="size-3" />Save review</Button><Button className="h-8 text-[10px]" disabled={working || !canApprove || !['review_required', 'generated'].includes(record.assessment.status)} onClick={approve}>Approve</Button><Button className="h-8 bg-emerald-600 text-[10px] hover:bg-emerald-700" disabled={working || record.assessment.status !== 'approved'} onClick={publish}><Send className="size-3" />Publish</Button></div></div>
          <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-[6px] border p-2 text-[10px]"><strong className="block text-[16px] text-[#111827]">{record.learners.length}</strong>proposed learners</div><div className="rounded-[6px] border p-2 text-[10px]"><strong className="block text-[16px] text-[#111827]">{confirmed}</strong>teacher confirmed</div><div className="rounded-[6px] border p-2 text-[10px]"><strong className="block text-[16px] text-[#111827]">{validation?.valid ? 'Valid' : validation ? 'Review' : 'Not generated'}</strong>paper validation</div></div>
          {record.learners.length ? <details className="rounded-[6px] border bg-white p-2"><summary className="cursor-pointer text-[10px] font-semibold text-[#334155]">Learner selection evidence</summary><div className="mt-2 divide-y">{record.learners.map((learner: any) => <div key={learner.student_ref} className="flex justify-between gap-3 py-2 text-[10px]"><span><strong className="block text-[#111827]">{learner.student_name}</strong>{learner.selection_reason}</span><span className="shrink-0 text-[#64748b]">{learner.confidence_score === null ? 'limited confidence' : `${learner.confidence_score}% confidence`}</span></div>)}</div></details> : null}
          {paper?.questions?.length ? <div className="grid gap-2">{paper.questions.map((question: any, index: number) => <article key={index} className="grid gap-2 rounded-[7px] border border-[#e2e8f0] bg-white p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase text-[#64748b]">Question {index + 1} · {question.marks} marks · {question.difficulty}</span><Button variant="outline" className="h-7 text-[9px]" disabled={working} onClick={() => replace(index)}><RefreshCw className="size-3" />Replace only this question</Button></div><Input className="h-8 text-[11px]" value={question.question_text || ''} onChange={(event) => updateQuestion(index, { question_text: event.target.value })} />{question.options?.length ? <div className="grid gap-1 rounded-[5px] bg-[#f8fafc] p-2 text-[10px] text-[#334155]">{question.options.map((option: any, optionIndex: number) => <span key={`${option.option_label || option.label}-${optionIndex}`}><strong>{option.option_label || option.label}.</strong> {option.option_text || option.text}</span>)}</div> : null}<Input className="h-8 text-[11px]" value={question.expected_answer || ''} onChange={(event) => updateQuestion(index, { expected_answer: event.target.value })} placeholder="Expected answer" /><div className="grid gap-1 text-[9px] text-[#64748b]"><span>Syllabus: {question.topic_name}{question.subtopic_name ? ` → ${question.subtopic_name}` : ''}</span><span>Answer space: {String(question.response_layout?.answer_space_type || '').replace(/_/g, ' ')} · {question.response_layout?.answer_lines ? `${question.response_layout.answer_lines} lines` : `${question.response_layout?.answer_height || 0}px high`}</span><span>Source: {question.source_question_ref ? `${question.source_question_ref} · ${question.transformation_type}` : question.transformation_type || 'original'}</span></div></article>)}</div> : null}
          {validation?.errors?.length ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-3 text-[10px] leading-5 text-red-800">{validation.errors.join(' ')}</div> : null}
          {selectedExisting?.assessment_id ? <a className="inline-flex w-fit rounded-[5px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-800" href={`/results/${selectedExisting.assessment_id}`}>Open generated mark sheet</a> : null}
        </div>}
      </div>
    </div>
  </SectionCard>
}

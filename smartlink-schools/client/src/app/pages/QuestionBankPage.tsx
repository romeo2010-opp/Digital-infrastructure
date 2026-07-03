import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, DatabaseZap, FilePenLine, Loader2, Plus, RefreshCcw, Save, Search, SlidersHorizontal, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { usePortal } from '../lib/portalContext'

const emptyQuestionForm = {
  grade_id: '',
  subject_id: '',
  topic_id: '',
  subtopic_id: '',
  question_type: 'short_answer',
  question_text: '',
  options_text: '',
  correct_answer: '',
  explanation: '',
  difficulty: 'medium',
  skill_type: '',
  marks: '1',
}

const bankQuestionTypes = [
  ['multiple_choice', 'Multiple Choice'],
  ['true_false', 'True / False'],
  ['short_answer', 'Short Answer'],
  ['structured', 'Structured'],
  ['essay', 'Essay'],
]

const addQuestionLabelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]'
const addQuestionSelectClass = 'h-10 w-full rounded-[7px] border border-[#d7deea] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none transition focus:border-[#2563eb] disabled:bg-[#f1f5f9] disabled:text-[#94a3b8]'

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusTone(value: any) {
  const status = String(value || '').toLowerCase()
  if (status === 'approved') return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
  if (status === 'rejected') return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
  if (status === 'draft') return 'border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]'
  return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
}

function listItems(value: any) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      const label = String(item?.label || '').trim()
      const text = String(item?.text || item?.answer || item?.value || '').trim()
      return [label ? `${label}.` : '', text].filter(Boolean).join(' ').trim()
    })
    .filter(Boolean)
}

function uniqueBy<T>(rows: T[], keyFor: (row: T) => string) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = keyFor(row)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseOptionLines(value: any) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line, index) => {
      const text = line.trim()
      if (!text) return null
      const match = text.match(/^([A-Z0-9]{1,3})[\).:-]\s*(.+)$/i)
      return {
        label: (match?.[1] || String.fromCharCode(65 + index)).toUpperCase(),
        text: (match?.[2] || text).trim(),
      }
    })
    .filter(Boolean)
}

export function QuestionBankPage() {
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [questions, setQuestions] = useState<any[]>([])
  const [setup, setSetup] = useState<any>({ curricula: [], grades: [], subjects: [] })
  const [topics, setTopics] = useState<any[]>([])
  const [questionForm, setQuestionForm] = useState<any>(emptyQuestionForm)
  const [loading, setLoading] = useState(true)
  const [savingQuestion, setSavingQuestion] = useState(false)
  const [sourcingAssessments, setSourcingAssessments] = useState(false)
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [subjectId, setSubjectId] = useState('')

  const loadSetup = async () => {
    if (!token) return
    try {
      const [setupPayload, topicsPayload] = await Promise.all([
        api.getSyllabusSetup(token),
        api.listSyllabusTopics(token),
      ])
      setSetup(setupPayload || { curricula: [], grades: [], subjects: [] })
      setTopics(topicsPayload?.topics || [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load question setup.')
    }
  }

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const payload = await api.listQuestionBank(token, { all: 1 })
      setQuestions(payload?.questions || [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load the question bank.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    loadSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const gradeOptions = useMemo(() => uniqueBy(questions, (row) => String(row.grade_id || '')).filter((row) => row.grade_id), [questions])
  const subjectOptions = useMemo(() => uniqueBy(questions, (row) => String(row.subject_id || '')).filter((row) => row.subject_id), [questions])
  const setupSubjects = useMemo(() => setup.subjects || [], [setup.subjects])
  const setupGrades = useMemo(() => setup.grades || setup.grade_levels || [], [setup.grade_levels, setup.grades])
  const addQuestionTopics = useMemo(() => (topics || []).filter((topic: any) => {
    if (topic.parent_topic_id) return false
    if (questionForm.subject_id && String(topic.subject_id || '') !== String(questionForm.subject_id)) return false
    if (questionForm.grade_id && String(topic.grade_id || '') !== String(questionForm.grade_id)) return false
    return true
  }), [questionForm.grade_id, questionForm.subject_id, topics])
  const addQuestionSubtopics = useMemo(() => (topics || []).filter((topic: any) => String(topic.parent_topic_id || '') === String(questionForm.topic_id || '')), [questionForm.topic_id, topics])
  const selectedAddTopic = useMemo(() => topics.find((topic: any) => String(topic.id) === String(questionForm.topic_id)) || null, [questionForm.topic_id, topics])

  const filteredQuestions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return questions.filter((question) => {
      if (status && String(question.approval_status || '') !== status) return false
      if (gradeId && String(question.grade_id || '') !== gradeId) return false
      if (subjectId && String(question.subject_id || '') !== subjectId) return false
      if (!query) return true
      return [
        question.question_text,
        question.correct_answer,
        question.explanation,
        question.subject_name,
        question.grade_name,
        question.topic_name,
        question.subtopic_name,
        question.skill_type,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [gradeId, questions, search, status, subjectId])

  const approvedCount = questions.filter((question) => question.approval_status === 'approved').length
  const pendingCount = questions.filter((question) => question.approval_status === 'pending_review').length
  const coverageScore = questions.length ? Math.round((approvedCount / questions.length) * 100) : 0
  const visibleApprovedCount = filteredQuestions.filter((question) => question.approval_status === 'approved').length

  const saveQuestion = async () => {
    if (!token || savingQuestion) return
    if (!questionForm.subject_id || !questionForm.topic_id || !questionForm.question_text.trim()) {
      toast.error('Choose a subject/topic and write the question first.')
      return
    }
    if (!questionForm.correct_answer.trim() && !questionForm.explanation.trim()) {
      toast.error('Add an answer or marking key before saving.')
      return
    }
    const options = parseOptionLines(questionForm.options_text)
    setSavingQuestion(true)
    try {
      await api.createQuestion(token, {
        curriculum_id: selectedAddTopic?.curriculum_id || '',
        grade_id: selectedAddTopic?.grade_id || questionForm.grade_id || '',
        subject_id: questionForm.subject_id,
        topic_id: questionForm.topic_id,
        subtopic_id: questionForm.subtopic_id || '',
        question_type: questionForm.question_type,
        question_text: questionForm.question_text,
        options_json: options,
        correct_answer: questionForm.correct_answer,
        accepted_answers_json: questionForm.correct_answer ? [questionForm.correct_answer] : [],
        explanation: questionForm.explanation,
        difficulty: questionForm.difficulty,
        skill_type: questionForm.skill_type,
        marks: questionForm.marks,
        approval_status: 'pending_review',
      })
      toast.success('Question added to the bank for review.')
      setQuestionForm((current: any) => ({
        ...emptyQuestionForm,
        grade_id: current.grade_id,
        subject_id: current.subject_id,
        topic_id: current.topic_id,
      }))
      setShowAddQuestionModal(false)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to add question.')
    } finally {
      setSavingQuestion(false)
    }
  }

  const sourceAssessmentQuestions = async () => {
    if (!token || sourcingAssessments) return
    setSourcingAssessments(true)
    try {
      const result = await api.sourceAssessmentQuestions(token, {
        subject_id: subjectId || questionForm.subject_id || '',
        limit: 100,
      })
      const skipped = result?.skipped || {}
      const details = [
        skipped.no_marking_key ? `${skipped.no_marking_key} without marking key` : '',
        skipped.no_topic ? `${skipped.no_topic} without topic` : '',
        skipped.duplicate ? `${skipped.duplicate} duplicates` : '',
      ].filter(Boolean).join(', ')
      toast.success(`Sourced ${result?.imported || 0} assessment questions${details ? ` (${details} skipped)` : ''}.`)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to source assessment questions.')
    } finally {
      setSourcingAssessments(false)
    }
  }

  const renderAddQuestionModal = () => showAddQuestionModal ? (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0f172a]/45 px-4 py-5 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label="Add question" className="flex max-h-[calc(100vh-40px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[10px] border border-[#d7deea] bg-white shadow-[0_28px_80px_-38px_rgba(15,23,42,0.9)]">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e2e8f0] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[18px] font-bold text-[#0f172a]">
              <Plus className="size-4 text-[#2563eb]" />
              Add Question
            </div>
            <div className="mt-1 text-[12px] font-medium text-[#64748b]">Choose a syllabus topic, add the marking key, then send it into review.</div>
          </div>
          <button type="button" className="grid size-9 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#475569] transition hover:border-[#2563eb] hover:text-[#2563eb]" onClick={() => setShowAddQuestionModal(false)} aria-label="Close add question">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-6">
            <section className="grid gap-3 border-b border-[#e2e8f0] pb-5">
              <div>
                <div className="text-[12px] font-bold text-[#0f172a]">Scope</div>
                <div className="mt-0.5 text-[12px] font-medium text-[#64748b]">Tag the question to the syllabus before adding the learner-facing text.</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className={addQuestionLabelClass}>
                  Year
                  <select className={addQuestionSelectClass} value={questionForm.grade_id} onChange={(event) => setQuestionForm({ ...questionForm, grade_id: event.target.value, topic_id: '', subtopic_id: '' })}>
                    <option value="">Any year</option>
                    {setupGrades.map((row: any) => <option key={row.id} value={row.id}>{row.name || row.grade_name}</option>)}
                  </select>
                </label>
                <label className={addQuestionLabelClass}>
                  Subject
                  <select className={addQuestionSelectClass} value={questionForm.subject_id} onChange={(event) => setQuestionForm({ ...questionForm, subject_id: event.target.value, topic_id: '', subtopic_id: '' })}>
                    <option value="">Select subject</option>
                    {setupSubjects.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label className={addQuestionLabelClass}>
                  Topic
                  <select className={addQuestionSelectClass} value={questionForm.topic_id} onChange={(event) => setQuestionForm({ ...questionForm, topic_id: event.target.value, subtopic_id: '' })}>
                    <option value="">Select topic</option>
                    {addQuestionTopics.map((row: any) => <option key={row.id} value={row.id}>{row.topic_name}</option>)}
                  </select>
                </label>
                <label className={addQuestionLabelClass}>
                  Subtopic
                  <select className={addQuestionSelectClass} value={questionForm.subtopic_id} disabled={!addQuestionSubtopics.length} onChange={(event) => setQuestionForm({ ...questionForm, subtopic_id: event.target.value })}>
                    <option value="">No subtopic</option>
                    {addQuestionSubtopics.map((row: any) => <option key={row.id} value={row.id}>{row.topic_name}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="grid gap-3 border-b border-[#e2e8f0] pb-5">
              <div>
                <div className="text-[12px] font-bold text-[#0f172a]">Question Settings</div>
                <div className="mt-0.5 text-[12px] font-medium text-[#64748b]">Set the type, marks, skill and difficulty used for review.</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_120px_minmax(0,1fr)_140px]">
                <label className={addQuestionLabelClass}>
                  Type
                  <select className={addQuestionSelectClass} value={questionForm.question_type} onChange={(event) => setQuestionForm({ ...questionForm, question_type: event.target.value })}>
                    {bankQuestionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className={addQuestionLabelClass}>
                  Marks
                  <Input className="h-10 rounded-[7px] text-[13px]" type="number" min="1" value={questionForm.marks} onChange={(event) => setQuestionForm({ ...questionForm, marks: event.target.value })} />
                </label>
                <label className={addQuestionLabelClass}>
                  Skill
                  <Input className="h-10 rounded-[7px] text-[13px]" value={questionForm.skill_type} onChange={(event) => setQuestionForm({ ...questionForm, skill_type: event.target.value })} placeholder="Optional skill" />
                </label>
                <label className={addQuestionLabelClass}>
                  Difficulty
                  <select className={addQuestionSelectClass} value={questionForm.difficulty} onChange={(event) => setQuestionForm({ ...questionForm, difficulty: event.target.value })}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="grid gap-4">
              <label className={addQuestionLabelClass}>
                Question
                <Textarea className="min-h-[172px] resize-y rounded-[7px] text-[14px] leading-6" value={questionForm.question_text} onChange={(event) => setQuestionForm({ ...questionForm, question_text: event.target.value })} placeholder="Write the question exactly as learners should see it." />
              </label>
              {questionForm.question_type === 'multiple_choice' ? (
                <label className={addQuestionLabelClass}>
                  Options
                  <Textarea className="min-h-[112px] resize-y rounded-[7px] text-[13px] leading-6" value={questionForm.options_text} onChange={(event) => setQuestionForm({ ...questionForm, options_text: event.target.value })} placeholder={'A. First option\nB. Second option\nC. Third option\nD. Fourth option'} />
                </label>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#166534]">
                  Answer / Marking Key
                  <Textarea className="min-h-[150px] resize-y rounded-[7px] border-[#bbf7d0] bg-[#f0fdf4] text-[13px] leading-6 text-[#14532d]" value={questionForm.correct_answer} onChange={(event) => setQuestionForm({ ...questionForm, correct_answer: event.target.value })} placeholder="Correct answer or marking key" />
                </label>
                <label className={addQuestionLabelClass}>
                  Explanation / Notes
                  <Textarea className="min-h-[150px] resize-y rounded-[7px] text-[13px] leading-6" value={questionForm.explanation} onChange={(event) => setQuestionForm({ ...questionForm, explanation: event.target.value })} placeholder="Optional explanation or marking notes" />
                </label>
              </div>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-4">
          <div className="text-[12px] font-medium text-[#64748b]">Questions saved here are added as pending review.</div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-9 rounded-[7px] text-[12px]" onClick={() => setShowAddQuestionModal(false)}>Cancel</Button>
            <Button type="button" className="h-9 rounded-[7px] text-[12px]" disabled={savingQuestion} onClick={saveQuestion}>
              {savingQuestion ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Question
            </Button>
          </div>
        </div>
      </section>
    </div>
  ) : null

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb] text-[#0f172a]">
      <header className="flex min-h-[92px] shrink-0 items-center justify-between gap-5 border-b border-[#dde5f0] bg-white/95 px-7 shadow-[0_10px_34px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/syllabus')}
            className="grid size-10 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#334155] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]"
            aria-label="Back to syllabus"
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[22px] font-bold leading-7 text-[#0f172a]">SmartLink Question Bank</div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[12px] font-medium text-[#64748b]">
              <span>{filteredQuestions.length} of {questions.length} questions visible</span>
              <span className="size-1 rounded-full bg-[#cbd5e1]" />
              <span>{visibleApprovedCount} approved in view</span>
              <span className="rounded-[5px] border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-0.5 text-[11px] font-bold text-[#2563eb]">{subjectOptions.length} subjects</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#bfdbfe] bg-white px-4 text-[13px] text-[#1d4ed8] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={sourcingAssessments} onClick={sourceAssessmentQuestions}>
            {sourcingAssessments ? <Loader2 className="size-3.5 animate-spin" /> : <DatabaseZap className="size-3.5" />}
            Source Assessments
          </Button>
          <Button type="button" className="h-10 rounded-[7px] px-5 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" onClick={() => setShowAddQuestionModal(true)}>
            <Plus className="size-3.5" />
            Add Question
          </Button>
          <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#d7deea] bg-white px-5 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={loading} onClick={load}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden h-full w-[clamp(310px,23vw,380px)] shrink-0 flex-col border-r border-[#dde5f0] bg-white shadow-[inset_-1px_0_0_rgba(226,232,240,0.75)] md:flex">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-bold text-[#0f172a]">Question Filters</h2>
              <button type="button" className="grid size-9 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#475569] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]" title="Filters" aria-label="Filters">
                <SlidersHorizontal className="size-3.5" />
              </button>
            </div>
            <div className="mb-4 flex h-10 items-center gap-2 rounded-[7px] border border-[#d7deea] bg-white px-3 shadow-sm">
              <Search className="size-3.5 shrink-0 text-[#64748b]" />
              <Input
                className="h-9 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search questions..."
              />
            </div>
            <div className="rounded-[8px] border border-[#dde5f0] bg-white p-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.55)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-[#0f172a]">Approval Progress</div>
                <div className="text-[16px] font-bold text-[#2563eb]">{coverageScore}%</div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]">
                <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${coverageScore}%` }} />
              </div>
              <div className="mt-2 text-[11px] font-medium text-[#64748b]">{approvedCount} of {questions.length} questions approved</div>
            </div>

            <div className="my-4 flex flex-wrap items-center gap-2">
              {[
                { id: '', label: 'All', count: questions.length },
                { id: 'approved', label: 'Approved', count: approvedCount },
                { id: 'pending_review', label: 'Pending', count: pendingCount },
              ].map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  onClick={() => setStatus(filter.id)}
                  className={`h-8 rounded-full border px-3 text-[12px] font-bold shadow-sm transition ${status === filter.id ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[#d7deea] bg-white text-[#475569] hover:border-[#bfdbfe] hover:text-[#2563eb]'}`}
                >
                  {filter.label} <span className={status === filter.id ? 'text-[#2563eb]' : 'text-[#64748b]'}>{filter.count}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                Status
                <select className="h-9 rounded-[7px] border border-[#d7deea] bg-white px-2.5 text-[12px] font-medium text-[#111827] outline-none focus:border-[#2563eb]" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">All statuses</option>
                  {['approved', 'pending_review', 'draft', 'rejected'].map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                Year
                <select className="h-9 rounded-[7px] border border-[#d7deea] bg-white px-2.5 text-[12px] font-medium text-[#111827] outline-none focus:border-[#2563eb]" value={gradeId} onChange={(event) => setGradeId(event.target.value)}>
                  <option value="">All years</option>
                  {gradeOptions.map((row) => <option key={row.grade_id} value={row.grade_id}>{row.grade_name || `Grade ${row.grade_id}`}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                Subject
                <select className="h-9 rounded-[7px] border border-[#d7deea] bg-white px-2.5 text-[12px] font-medium text-[#111827] outline-none focus:border-[#2563eb]" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                  <option value="">All subjects</option>
                  {subjectOptions.map((row) => <option key={row.subject_id} value={row.subject_id}>{row.subject_name || `Subject ${row.subject_id}`}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ['Total', questions.length, '#0f172a'],
                ['Approved', approvedCount, '#166534'],
                ['Pending', pendingCount, '#9a3412'],
                ['Subjects', subjectOptions.length, '#2563eb'],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="rounded-[8px] border border-[#dde5f0] bg-white p-3 shadow-sm">
                  <div className="text-[18px] font-bold" style={{ color: String(color) }}>{String(value)}</div>
                  <div className="text-[11px] font-medium text-[#64748b]">{String(label)}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-[#f6f8fb]">
          <div className="mx-auto grid w-full max-w-[1010px] gap-4 px-6 py-5">
            <section className="rounded-[9px] border border-[#dde5f0] bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)] md:hidden">
              <div className="flex items-center gap-2">
                <Search className="size-3.5 text-[#64748b]" />
                <Input className="h-9 text-[13px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions" />
              </div>
            </section>

            {loading ? (
              <SmartLinkLoadingState label="Loading question bank" detail="Preparing questions, answers and marking guides." />
            ) : filteredQuestions.length ? filteredQuestions.map((question, index) => {
            const options = listItems(question.options_json)
            const acceptedAnswers = listItems(question.accepted_answers_json)
            return (
              <section key={question.id} className="rounded-[9px] border border-[#dde5f0] bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-5 py-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-[#0f172a]">{question.grade_name || '-'} / {question.subject_name || '-'}</div>
                      <div className="truncate text-[11px] text-[#64748b]">{question.topic_name || '-'}{question.subtopic_name ? ` / ${question.subtopic_name}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1 text-[11px] font-bold text-[#475569]">{valueLabel(question.question_type)}</span>
                    <span className="rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1 text-[11px] font-bold text-[#475569]">{Number(question.marks || 1)} mark{Number(question.marks || 1) === 1 ? '' : 's'}</span>
                    <span className={`rounded-[4px] border px-2 py-1 text-[11px] font-bold ${statusTone(question.approval_status)}`}>{valueLabel(question.approval_status)}</span>
                  </div>
                </div>
                <div className="grid gap-4 p-5">
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#2563eb]"><FilePenLine className="size-3.5" /> Question</div>
                    <div className="rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] leading-6 text-[#111827]">{question.question_text || '-'}</div>
                  </div>
                  {options.length ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Options</div>
                      <div className="grid gap-1 rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2">
                        {options.map((option) => <div key={option} className="text-[12px] leading-5 text-[#334155]">{option}</div>)}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]"><CheckCircle2 className="size-3.5 text-[#16a34a]" /> Answer / Marking Guide</div>
                      <div className="min-h-20 rounded-[7px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] leading-5 text-[#14532d]">{question.correct_answer || '-'}</div>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Accepted Answers</div>
                      <div className="min-h-20 rounded-[7px] border border-[#e2e8f0] bg-white px-3 py-2">
                        {acceptedAnswers.length ? acceptedAnswers.map((answer) => <div key={answer} className="text-[12px] leading-5 text-[#334155]">{answer}</div>) : <span className="text-[12px] text-[#64748b]">-</span>}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Explanation</div>
                    <div className="rounded-[7px] border border-[#e2e8f0] bg-white px-3 py-2 text-[12px] leading-5 text-[#334155]">{question.explanation || '-'}</div>
                  </div>
                  {question.common_mistake ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Common Mistake</div>
                      <div className="rounded-[7px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] leading-5 text-[#9a3412]">{question.common_mistake}</div>
                    </div>
                  ) : null}
                </div>
              </section>
            )
          }) : (
            <div className="rounded-[9px] border border-[#dde5f0] bg-white p-6 text-[12px] font-semibold text-[#64748b] shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]">No questions match the current filters.</div>
          )}
          </div>
        </main>
      </div>
      {renderAddQuestionModal()}
    </div>
  )
}

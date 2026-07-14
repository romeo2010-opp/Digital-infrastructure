import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Save, XCircle } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { PageBackButton } from '../components/PageBackButton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { usePortal } from '../lib/portalContext'

function selectClassName() {
  return 'h-8 rounded-[5px] border border-[#cbd5e1] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]'
}

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusTone(value: any) {
  const status = String(value || '').toLowerCase()
  if (status === 'approved') return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
  if (status === 'rejected') return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
  return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
}

function jsonLines(value: any) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => typeof item === 'string' ? item : `${item.label || ''}. ${item.text || ''}`.trim()).filter(Boolean).join('\n')
}

function parseLines(value: string) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function QuestionBatchEditorPage() {
  const { batchId } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [payload, setPayload] = useState<any>(null)
  const [questions, setQuestions] = useState<any[]>([])
  const [activeId, setActiveId] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')

  const activeQuestion = useMemo(() => questions.find((question) => String(question.id) === String(activeId)) || questions[0] || null, [activeId, questions])

  const load = async () => {
    if (!token || !batchId) return
    setLoading(true)
    try {
      const data = await api.getQuestionBatchReview(token, batchId)
      setPayload(data)
      setQuestions((data?.questions || []).map((question: any) => ({
        ...question,
        options_text: jsonLines(question.options_json || []),
        accepted_answers_text: jsonLines(question.accepted_answers_json || []),
      })))
      setActiveId(data?.questions?.[0]?.id || null)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load question batch.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, token])

  const updateQuestion = (id: any, patch: any) => {
    setQuestions((current) => current.map((question) => String(question.id) === String(id) ? { ...question, ...patch } : question))
  }

  const saveQuestion = async (question: any) => {
    if (!token) return
    const key = `save-${question.id}`
    setBusyKey(key)
    try {
      await api.updateQuestion(token, question.id, {
        question_text: question.question_text,
        question_type: question.question_type,
        options_json: parseLines(question.options_text).map((line, index) => {
          const match = line.match(/^([A-Z])\.?\s+(.+)$/i)
          return { label: (match?.[1] || String.fromCharCode(65 + index)).toUpperCase(), text: match?.[2] || line }
        }),
        correct_answer: question.correct_answer,
        accepted_answers_json: parseLines(question.accepted_answers_text),
        explanation: question.explanation,
        difficulty: question.difficulty,
        skill_type: question.skill_type,
        marks: question.marks,
        common_mistake: question.common_mistake,
        confidence: question.confidence,
      })
      toast.success('Question saved.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save question.')
    } finally {
      setBusyKey('')
    }
  }

  const transitionQuestion = async (question: any, action: 'approve' | 'reject') => {
    if (!token) return
    const key = `${action}-${question.id}`
    setBusyKey(key)
    try {
      if (action === 'approve') await api.approveQuestion(token, question.id)
      else await api.rejectQuestion(token, question.id)
      toast.success(action === 'approve' ? 'Question approved.' : 'Question rejected.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || `Unable to ${action} question.`)
    } finally {
      setBusyKey('')
    }
  }

  const batch = payload?.batch || {}

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f7f4] text-[#111827]">
      <aside className="hidden h-full w-[292px] shrink-0 flex-col border-r border-[#d7dde5] bg-[#fbfcf8] md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-[#d7dde5] px-4">
          <PageBackButton fallback="/syllabus" label="Back to syllabus" iconOnly />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">Question Batch</div>
            <div className="text-[11px] font-medium text-[#64748b]">{valueLabel(batch.status)}</div>
          </div>
        </div>
        <div className="border-b border-[#e2e8f0] p-4 text-[12px] leading-5 text-[#475569]">
          <div className="font-semibold text-[#111827]">{batch.grade_name || 'Year'} / {batch.subject_name || 'Subject'}</div>
          <div>{batch.topic_name || 'Topic'} / {questions.length} question{questions.length === 1 ? '' : 's'}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {questions.map((question, index) => {
            const active = String(activeQuestion?.id) === String(question.id)
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => setActiveId(question.id)}
                className={`mb-2 w-full rounded-[7px] border px-3 py-2 text-left transition ${active ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#e2e8f0] bg-white text-[#334155]'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-[#111827]' : 'bg-[#e2e8f0] text-[#475569]'}`}>{index + 1}</span>
                  <span className="truncate text-[12px] font-semibold">{valueLabel(question.question_type)}</span>
                </div>
                <div className={`mt-1 line-clamp-2 text-[11px] ${active ? 'text-white/75' : 'text-[#64748b]'}`}>{question.question_text}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-[#d7dde5] bg-white/95 px-4 backdrop-blur">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[#111827]">{batch.topic_name || 'AI Draft Batch'}</div>
            <div className="text-[11px] font-medium text-[#64748b]">{batch.grade_name || '-'} / {batch.subject_name || '-'}</div>
          </div>
          <PageBackButton fallback="/syllabus" label="Back to syllabus" />
        </header>

        <div className="mx-auto grid w-full max-w-[1040px] gap-4 px-4 py-5 lg:px-8">
          {loading ? (
            <SmartLinkLoadingState label="Loading draft batch" detail="Preparing generated questions for review." />
          ) : questions.length ? questions.map((question, index) => (
            <section key={question.id} className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{index + 1}</span>
                  <div>
                    <div className="text-[13px] font-semibold text-[#111827]">{valueLabel(question.question_type)}</div>
                    <div className="text-[11px] text-[#64748b]">{Number(question.marks || 1)} mark{Number(question.marks || 1) === 1 ? '' : 's'} / {valueLabel(question.difficulty)}</div>
                  </div>
                </div>
                <span className={`rounded-[4px] border px-2 py-1 text-[11px] font-bold ${statusTone(question.approval_status)}`}>{valueLabel(question.approval_status)}</span>
              </div>
              <div className="grid gap-3 p-4">
                <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                  Question Text
                  <Textarea className="min-h-24 text-[13px] normal-case leading-6 tracking-normal text-[#111827]" value={question.question_text || ''} onFocus={() => setActiveId(question.id)} onChange={(event) => updateQuestion(question.id, { question_text: event.target.value })} />
                </label>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Question Type
                    <select className={selectClassName()} value={question.question_type || 'short_answer'} onChange={(event) => updateQuestion(question.id, { question_type: event.target.value })}>
                      {['multiple_choice', 'true_false', 'short_answer', 'structured', 'essay'].map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Difficulty
                    <select className={selectClassName()} value={question.difficulty || 'easy'} onChange={(event) => updateQuestion(question.id, { difficulty: event.target.value })}>
                      {['easy', 'medium', 'hard'].map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Marks
                    <Input className="h-8 text-[12px] normal-case tracking-normal text-[#111827]" type="number" min={1} value={question.marks || 1} onChange={(event) => updateQuestion(question.id, { marks: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Skill Tag
                    <Input className="h-8 text-[12px] normal-case tracking-normal text-[#111827]" value={question.skill_type || ''} onChange={(event) => updateQuestion(question.id, { skill_type: event.target.value })} placeholder="define, list, explain..." />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Options
                    <Textarea className="min-h-20 text-[12px] normal-case tracking-normal text-[#111827]" value={question.options_text || ''} onChange={(event) => updateQuestion(question.id, { options_text: event.target.value })} placeholder="One option per line" />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Accepted Answers
                    <Textarea className="min-h-20 text-[12px] normal-case tracking-normal text-[#111827]" value={question.accepted_answers_text || ''} onChange={(event) => updateQuestion(question.id, { accepted_answers_text: event.target.value })} placeholder="One accepted answer per line" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                  Correct Answer / Marking Guide
                  <Textarea className="min-h-20 text-[12px] normal-case tracking-normal text-[#111827]" value={question.correct_answer || ''} onChange={(event) => updateQuestion(question.id, { correct_answer: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                  Explanation
                  <Textarea className="min-h-20 text-[12px] normal-case tracking-normal text-[#111827]" value={question.explanation || ''} onChange={(event) => updateQuestion(question.id, { explanation: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                  Common Mistake
                  <Textarea className="min-h-16 text-[12px] normal-case tracking-normal text-[#111827]" value={question.common_mistake || ''} onChange={(event) => updateQuestion(question.id, { common_mistake: event.target.value })} />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={Boolean(busyKey)} onClick={() => saveQuestion(question)}>
                    {busyKey === `save-${question.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Save
                  </Button>
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={Boolean(busyKey)} onClick={() => transitionQuestion(question, 'reject')}>
                    {busyKey === `reject-${question.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
                    Reject
                  </Button>
                  <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={Boolean(busyKey)} onClick={() => transitionQuestion(question, 'approve')}>
                    {busyKey === `approve-${question.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Approve
                  </Button>
                </div>
              </div>
            </section>
          )) : (
            <div className="rounded-[8px] border border-[#d7dde5] bg-white p-6 text-[12px] font-semibold text-[#64748b]">No questions were generated in this batch.</div>
          )}
        </div>
      </main>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpenText, CheckCircle2, ChevronRight, Clock3, Loader2, Plus, Save, Send, Trash2, Undo2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { usePortal } from '../lib/portalContext'

type Criterion = {
  id: string
  actions: string[]
  detail: string
}

type Subtopic = {
  id: string
  title: string
  notes: string
  criteria: Criterion[]
}

const actionOptions = [
  { value: 'define', label: 'Define' },
  { value: 'list', label: 'List' },
  { value: 'explain', label: 'Explain' },
  { value: 'describe', label: 'Describe' },
  { value: 'identify', label: 'Identify' },
  { value: 'compare', label: 'Compare' },
  { value: 'calculate', label: 'Calculate' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' },
]

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const localDraftPrefix = 'smartlink-syllabus-composer-draft'

function blankCriterion(actions: string[] = ['define']): Criterion {
  return { id: newId(), actions, detail: '' }
}

function blankSubtopic(): Subtopic {
  return { id: newId(), title: '', notes: '', criteria: [blankCriterion()] }
}

function selectClassName(extra = '') {
  return `h-9 rounded-[5px] border border-[#cbd5e1] bg-white px-2.5 text-[12px] font-medium text-[#111827] outline-none transition focus:border-[#111827] disabled:bg-[#f8fafc] disabled:text-[#94a3b8] ${extra}`
}

function actionLabel(action: string) {
  return actionOptions.find((option) => option.value === action)?.label || action.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function criterionText(criterion: Criterion) {
  const detail = criterion.detail.trim()
  const labels = criterion.actions.length ? criterion.actions.map(actionLabel) : ['Criterion']
  return detail ? labels.map((label) => `${label} ${detail}`).join(' / ') : labels.join(', ')
}

function roleCanReview(user: any) {
  return ['school_owner', 'headteacher', 'super_admin'].includes(String(user?.role || '').toLowerCase())
}

function normalizeCriterion(row: any): Criterion {
  const actions = Array.isArray(row?.actions) && row.actions.length
    ? row.actions
    : row?.action
      ? [row.action]
      : ['define']
  return {
    id: newId(),
    actions: [...new Set(actions.map((action: any) => String(action || '').trim()).filter(Boolean))],
    detail: String(row?.detail || row?.target || row?.value || '').trim(),
  }
}

function normalizeSubtopic(row: any): Subtopic {
  const criteria = Array.isArray(row?.criteria) ? row.criteria.map(normalizeCriterion) : []
  return {
    id: newId(),
    title: String(row?.title || row?.name || '').trim(),
    notes: String(row?.notes || row?.description || '').trim(),
    criteria: criteria.length ? criteria : [blankCriterion()],
  }
}

function statusLabel(status?: string) {
  if (!status) return 'Draft'
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function setupName(rows: any[] = [], id: any) {
  return rows.find((row) => String(row.id) === String(id))?.name || ''
}

function suggestedDocumentTitle(form: any, setup: any) {
  const gradeName = setupName(setup.grades, form.grade_id)
  const subjectName = setupName(setup.subjects, form.subject_id)
  return [gradeName, subjectName, 'Syllabus'].filter(Boolean).join(' ')
}

function formatSavedAt(value: Date | null) {
  if (!value) return 'Not saved yet'
  return `Saved ${value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function SyllabusComposerPage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const { entryId: routeEntryId } = useParams()
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const saveInFlightRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const [entryId, setEntryId] = useState(routeEntryId || '')
  const [entry, setEntry] = useState<any>(null)
  const [setup, setSetup] = useState<any>({ curricula: [], grades: [], subjects: [], terms: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [activeSubtopicId, setActiveSubtopicId] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [form, setForm] = useState<any>({
    curriculum_id: '',
    grade_id: '',
    subject_id: '',
    topic_name: '',
    description: '',
  })
  const [subtopics, setSubtopics] = useState<Subtopic[]>([blankSubtopic()])

  const canReview = roleCanReview(user)
  const readOnly = false
  const canApprove = canReview && entryId && entry?.status === 'pending_review'
  const autoDraftAllowed = !readOnly && (!entry || ['draft', 'revision_requested'].includes(entry.status))

  const overview = useMemo(() => {
    const namedSubtopics = subtopics.filter((subtopic) => subtopic.title.trim())
    const criteriaCount = subtopics.reduce((total, subtopic) => total + subtopic.criteria.filter((criterion) => criterion.detail.trim()).length, 0)
    const tagCount = subtopics.reduce((total, subtopic) => total + subtopic.criteria.filter((criterion) => criterion.detail.trim()).reduce((inner, criterion) => inner + criterion.actions.length, 0), 0)
    return { namedSubtopics, criteriaCount, tagCount }
  }, [subtopics])

  const hasMeaningfulDraft = useMemo(() => {
    if (form.topic_name.trim() || form.description.trim()) return true
    return subtopics.some((subtopic) => subtopic.title.trim() || subtopic.notes.trim() || subtopic.criteria.some((criterion) => criterion.detail.trim()))
  }, [form.description, form.topic_name, subtopics])

  function currentPayload(status: 'draft' | 'pending_review') {
    return {
      ...form,
      term: '',
      suggested_week: '',
      status,
      topic_name: form.topic_name.trim() || suggestedDocumentTitle(form, setup),
      description: form.description.trim(),
      objectives: {
        flat_objectives: [],
        subtopics: subtopics.map((subtopic) => ({
          title: subtopic.title.trim(),
          notes: subtopic.notes.trim(),
          criteria: subtopic.criteria.map((criterion) => ({
            actions: criterion.actions,
            detail: criterion.detail.trim(),
          })),
        })),
      },
    }
  }

  useEffect(() => {
    setEntryId(routeEntryId || '')
  }, [routeEntryId])

  useEffect(() => {
    const load = async () => {
      if (!token) return
      setLoading(true)
      try {
        const [setupPayload, entryPayload] = await Promise.all([
          api.getSyllabusSetup(token),
          routeEntryId ? api.getManualSyllabusEntry(token, routeEntryId) : Promise.resolve(null),
        ])
        setSetup(setupPayload)
        const localDraftKey = `${localDraftPrefix}:new`
        const localDraft = !routeEntryId && typeof window !== 'undefined' ? window.localStorage.getItem(localDraftKey) : null
        let parsedLocalDraft: any = null
        try {
          parsedLocalDraft = localDraft ? JSON.parse(localDraft) : null
        } catch {
          parsedLocalDraft = null
        }
        const loadedEntry = entryPayload?.entry || null
        if (loadedEntry) {
          setEntry(loadedEntry)
          setReviewNotes(loadedEntry.review_notes || '')
          setForm({
            curriculum_id: String(loadedEntry.curriculum_id || ''),
            grade_id: String(loadedEntry.grade_id || ''),
            subject_id: String(loadedEntry.subject_id || ''),
            topic_name: loadedEntry.topic_name || '',
            description: loadedEntry.description || '',
          })
          const loadedSubtopics = (loadedEntry.syllabus_map?.subtopics || []).map(normalizeSubtopic)
          setSubtopics(loadedSubtopics.length ? loadedSubtopics : [blankSubtopic()])
          setLastSavedAt(loadedEntry.updated_at ? new Date(loadedEntry.updated_at) : null)
          lastSavedSnapshotRef.current = ''
        } else if (parsedLocalDraft?.form || parsedLocalDraft?.subtopics) {
          setEntry(null)
          setForm({
            curriculum_id: parsedLocalDraft.form?.curriculum_id || String(setupPayload?.curricula?.[0]?.id || ''),
            grade_id: parsedLocalDraft.form?.grade_id || String(setupPayload?.grades?.[0]?.id || ''),
            subject_id: parsedLocalDraft.form?.subject_id || String(setupPayload?.subjects?.[0]?.id || ''),
            topic_name: parsedLocalDraft.form?.topic_name || '',
            description: parsedLocalDraft.form?.description || '',
          })
          setSubtopics(Array.isArray(parsedLocalDraft.subtopics) && parsedLocalDraft.subtopics.length ? parsedLocalDraft.subtopics : [blankSubtopic()])
        } else {
          setEntry(null)
          setForm((current: any) => ({
            ...current,
            curriculum_id: current.curriculum_id || String(setupPayload?.curricula?.[0]?.id || ''),
            grade_id: current.grade_id || String(setupPayload?.grades?.[0]?.id || ''),
            subject_id: current.subject_id || String(setupPayload?.subjects?.[0]?.id || ''),
          }))
        }
      } catch (err: any) {
        toast.error(err?.message || 'Unable to load syllabus entry.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [api, routeEntryId, token])

  useEffect(() => {
    if (!activeSubtopicId && subtopics[0]?.id) setActiveSubtopicId(subtopics[0].id)
  }, [activeSubtopicId, subtopics])

  async function persistEntry(status: 'draft' | 'pending_review', options: { auto?: boolean; silent?: boolean } = {}) {
    if (!token || saveInFlightRef.current || readOnly) return null
    if (!form.subject_id) {
      if (!options.silent) toast.error('Select a subject first.')
      return null
    }
    const payload = currentPayload(status)
    const snapshot = JSON.stringify(payload)
    if (options.auto && snapshot === lastSavedSnapshotRef.current) return entryId || null
    saveInFlightRef.current = true
    if (options.auto) setAutosaveState('saving')
    else setBusy(true)
    try {
      let nextEntryId = entryId
      if (entryId) {
        await api.updateManualSyllabusEntry(token, entryId, payload)
      } else {
        const created = await api.createManualSyllabusEntry(token, payload)
        nextEntryId = String(created?.entry_id || '')
        setEntryId(nextEntryId)
        if (nextEntryId) navigate(`/syllabus/create/${nextEntryId}`, { replace: true })
      }
      setEntry((current: any) => ({ ...(current || {}), id: nextEntryId, status }))
      setLastSavedAt(new Date())
      setAutosaveState('saved')
      lastSavedSnapshotRef.current = snapshot
      if (status === 'pending_review' && typeof window !== 'undefined') {
        window.localStorage.removeItem(`${localDraftPrefix}:new`)
      }
      if (!options.silent) toast.success(status === 'draft' ? 'Draft saved.' : 'Syllabus document submitted for review.')
      return nextEntryId
    } catch (err: any) {
      setAutosaveState('error')
      if (!options.silent) toast.error(err?.message || 'Unable to save syllabus entry.')
      return null
    } finally {
      saveInFlightRef.current = false
      if (!options.auto) setBusy(false)
    }
  }

  useEffect(() => {
    if (readOnly || loading) return
    const localKey = `${localDraftPrefix}:${entryId || 'new'}`
    try {
      window.localStorage.setItem(localKey, JSON.stringify({ form, subtopics, savedAt: new Date().toISOString() }))
    } catch {
      // Local draft storage is best-effort only.
    }
  }, [entryId, form, loading, readOnly, subtopics])

  useEffect(() => {
    if (!autoDraftAllowed || !hasMeaningfulDraft || !form.subject_id || loading) return undefined
    const timer = window.setTimeout(() => {
      persistEntry('draft', { auto: true, silent: true })
    }, 3000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraftAllowed, form, hasMeaningfulDraft, loading, subtopics])

  const updateSubtopic = (id: string, patch: Partial<Subtopic>) => {
    if (readOnly) return
    setSubtopics((current) => current.map((subtopic) => (subtopic.id === id ? { ...subtopic, ...patch } : subtopic)))
  }

  const addSubtopic = () => {
    if (readOnly) return
    const next = blankSubtopic()
    setSubtopics((current) => [...current, next])
    setActiveSubtopicId(next.id)
    setTimeout(() => sectionRefs.current[next.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const removeSubtopic = (id: string) => {
    if (readOnly) return
    setSubtopics((current) => {
      if (current.length === 1) return current
      const next = current.filter((subtopic) => subtopic.id !== id)
      if (activeSubtopicId === id) setActiveSubtopicId(next[0]?.id || '')
      return next
    })
  }

  const addCriterion = (subtopicId: string) => {
    if (readOnly) return
    setSubtopics((current) => current.map((subtopic) => (
      subtopic.id === subtopicId
        ? { ...subtopic, criteria: [...subtopic.criteria, blankCriterion(subtopic.criteria.at(-1)?.actions || ['define'])] }
        : subtopic
    )))
  }

  const updateCriterion = (subtopicId: string, criterionId: string, patch: Partial<Criterion>) => {
    if (readOnly) return
    setSubtopics((current) => current.map((subtopic) => (
      subtopic.id === subtopicId
        ? {
          ...subtopic,
          criteria: subtopic.criteria.map((criterion) => (criterion.id === criterionId ? { ...criterion, ...patch } : criterion)),
        }
        : subtopic
    )))
  }

  const toggleCriterionAction = (subtopicId: string, criterion: Criterion, action: string) => {
    const hasAction = criterion.actions.includes(action)
    const nextActions = hasAction ? criterion.actions.filter((item) => item !== action) : [...criterion.actions, action]
    updateCriterion(subtopicId, criterion.id, { actions: nextActions.length ? nextActions : [action] })
  }

  const removeCriterion = (subtopicId: string, criterionId: string) => {
    if (readOnly) return
    setSubtopics((current) => current.map((subtopic) => (
      subtopic.id === subtopicId && subtopic.criteria.length > 1
        ? { ...subtopic, criteria: subtopic.criteria.filter((criterion) => criterion.id !== criterionId) }
        : subtopic
    )))
  }

  const jumpToSubtopic = (id: string) => {
    setActiveSubtopicId(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const submitForReview = async () => {
    const cleanedSubtopics = subtopics
      .map((subtopic) => ({
        title: subtopic.title.trim(),
        criteria: subtopic.criteria.filter((criterion) => criterion.detail.trim() && criterion.actions.length),
      }))
      .filter((subtopic) => subtopic.title)

    if (!form.subject_id || !(form.topic_name.trim() || suggestedDocumentTitle(form, setup))) {
      toast.error('Select a subject and enter a syllabus title.')
      return
    }
    if (!cleanedSubtopics.length) {
      toast.error('Add at least one topic or subtopic.')
      return
    }
    if (cleanedSubtopics.some((subtopic) => !subtopic.criteria.length)) {
      toast.error('Each topic or subtopic needs at least one tagged success criteria.')
      return
    }
    const savedId = await persistEntry('pending_review')
    if (savedId) navigate('/syllabus')
  }

  const approveEntry = async () => {
    if (!token || !entryId) return
    setBusy(true)
    try {
      await api.approveManualSyllabusEntry(token, entryId, { review_notes: reviewNotes })
      toast.success('Syllabus document approved.')
      navigate('/syllabus')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to approve syllabus entry.')
    } finally {
      setBusy(false)
    }
  }

  const returnEntry = async () => {
    if (!token || !entryId) return
    setBusy(true)
    try {
      await api.rejectManualSyllabusEntry(token, entryId, { status: 'revision_requested', review_notes: reviewNotes })
      toast.success('Syllabus document returned.')
      navigate('/syllabus')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to return syllabus entry.')
    } finally {
      setBusy(false)
    }
  }

  const setFormValue = (patch: any) => {
    if (readOnly) return
    setForm((current: any) => ({ ...current, ...patch }))
  }

  const saveText = autosaveState === 'saving' ? 'Saving draft...' : autosaveState === 'error' ? 'Autosave failed' : formatSavedAt(lastSavedAt)

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f7f4] text-[#111827]">
      <aside className="hidden h-full w-[304px] shrink-0 flex-col border-r border-[#d7dde5] bg-[#fbfcf8] md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[#d7dde5] px-4">
          <button
            type="button"
            onClick={() => navigate('/syllabus')}
            className="grid size-8 place-items-center rounded-[5px] border border-[#d1d5db] bg-white text-[#4b5563] transition hover:border-[#111827] hover:text-[#111827]"
            aria-label="Back to syllabus"
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#111827]">Syllabus Composer</div>
            <div className="text-[11px] font-medium text-[#64748b]">{statusLabel(entry?.status)}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="rounded-[8px] border border-[#d7dde5] bg-white p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#64748b]">
              <BookOpenText className="size-3.5" />
              Syllabus
            </div>
            <div className="mt-2 text-[15px] font-semibold leading-5 text-[#111827]">
              {form.topic_name.trim() || suggestedDocumentTitle(form, setup) || 'Untitled syllabus'}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold text-[#64748b]">
              <span className="rounded-[5px] border border-[#e2e8f0] px-2 py-1.5">{overview.namedSubtopics.length} topics</span>
              <span className="rounded-[5px] border border-[#e2e8f0] px-2 py-1.5">{overview.criteriaCount} criteria</span>
              <span className="rounded-[5px] border border-[#e2e8f0] px-2 py-1.5">{overview.tagCount} tags</span>
            </div>
          </div>

          <div className="mt-4 grid gap-1.5">
            {subtopics.map((subtopic, index) => {
              const active = activeSubtopicId === subtopic.id
              const criteria = subtopic.criteria.filter((criterion) => criterion.detail.trim())
              return (
                <button
                  key={subtopic.id}
                  type="button"
                  onClick={() => jumpToSubtopic(subtopic.id)}
                  className={`group rounded-[7px] border px-3 py-2 text-left transition ${
                    active ? 'border-[#111827] bg-[#111827] text-white' : 'border-transparent text-[#334155] hover:border-[#cbd5e1] hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-[#111827]' : 'bg-[#e2e8f0] text-[#475569]'}`}>{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{subtopic.title.trim() || 'Untitled topic'}</span>
                    <ChevronRight className={`size-3.5 ${active ? 'text-white' : 'text-[#94a3b8]'}`} />
                  </div>
                  {criteria.length ? (
                    <div className={`ml-7 mt-1 grid gap-1 text-[11px] ${active ? 'text-white/75' : 'text-[#64748b]'}`}>
                      {criteria.slice(0, 2).map((criterion) => <span key={criterion.id} className="truncate">{criterionText(criterion)}</span>)}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-[#d7dde5] bg-white/95 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/syllabus')}
              className="grid size-8 place-items-center rounded-[5px] border border-[#d1d5db] bg-white text-[#4b5563] md:hidden"
              aria-label="Back to syllabus"
              title="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <Clock3 className={`size-4 ${autosaveState === 'error' ? 'text-[#dc2626]' : autosaveState === 'saving' ? 'text-[#ca8a04]' : 'text-[#16a34a]'}`} />
              <span className="truncate text-[12px] font-semibold text-[#64748b]">{loading ? 'Loading setup' : saveText}</span>
            </div>
            <span className="truncate text-[13px] font-semibold text-[#111827] md:hidden">Syllabus Composer</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={busy || loading || readOnly} onClick={addSubtopic}>
              <Plus className="size-3.5" />
              Topic
            </Button>
            {canApprove ? (
              <>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={busy || loading} onClick={returnEntry}>
                  <Undo2 className="size-3.5" />
                  Return
                </Button>
                <Button type="button" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={busy || loading} onClick={approveEntry}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  Approve
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={busy || loading || readOnly} onClick={() => persistEntry('draft')}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Draft
                </Button>
                <Button type="button" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={busy || loading || readOnly} onClick={submitForReview}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Submit
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-[1040px] gap-5 px-4 py-5 lg:px-8">
          <section className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
            <div className="grid gap-3 border-b border-[#e2e8f0] p-4 sm:grid-cols-2 lg:grid-cols-3">
              <select className={selectClassName()} value={form.curriculum_id} disabled={readOnly} onChange={(event) => setFormValue({ curriculum_id: event.target.value })}>
                <option value="">Curriculum</option>
                {setup.curricula?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <select className={selectClassName()} value={form.grade_id} disabled={readOnly} onChange={(event) => setFormValue({ grade_id: event.target.value })}>
                <option value="">Year level</option>
                {setup.grades?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <select className={selectClassName()} value={form.subject_id} disabled={readOnly} onChange={(event) => setFormValue({ subject_id: event.target.value })}>
                <option value="">Subject</option>
                {setup.subjects?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
            <div className="grid gap-4 p-5">
              <label className="grid gap-2">
                <span className="text-[12px] font-bold uppercase text-[#64748b]">Syllabus document title</span>
                <Input
                  className="h-12 rounded-[6px] border-[#cbd5e1] text-[24px] font-semibold tracking-[0]"
                  placeholder={suggestedDocumentTitle(form, setup) || 'Grade 3 Agriculture Syllabus'}
                  value={form.topic_name}
                  disabled={readOnly}
                  onChange={(event) => setFormValue({ topic_name: event.target.value })}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-[12px] font-bold uppercase text-[#64748b]">Document notes</span>
                <Textarea
                  className="min-h-[96px] rounded-[6px] border-[#cbd5e1] bg-white text-[14px] leading-6"
                  value={form.description}
                  disabled={readOnly}
                  onChange={(event) => setFormValue({ description: event.target.value })}
                />
              </label>
            </div>
          </section>

          <div className="grid gap-4">
            {subtopics.map((subtopic, index) => (
              <section
                key={subtopic.id}
                ref={(node) => { sectionRefs.current[subtopic.id] = node }}
                className={`rounded-[8px] border bg-white shadow-sm transition ${activeSubtopicId === subtopic.id ? 'border-[#111827]' : 'border-[#d7dde5]'}`}
                onFocus={() => setActiveSubtopicId(subtopic.id)}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{index + 1}</span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[14px] font-semibold text-[#111827]">{subtopic.title.trim() || 'Untitled topic'}</h2>
                      <p className="text-[11px] font-medium text-[#64748b]">{subtopic.criteria.filter((criterion) => criterion.detail.trim()).length} success criteria</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-[5px] border border-[#fee2e2] bg-[#fef2f2] text-[#b91c1c] transition hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => removeSubtopic(subtopic.id)}
                    disabled={subtopics.length === 1 || readOnly}
                    aria-label="Remove subtopic"
                    title="Remove"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="grid gap-4 p-4">
                  <label className="grid gap-2">
                    <span className="text-[12px] font-bold uppercase text-[#64748b]">Topic / subtopic</span>
                    <Input
                      className="h-10 rounded-[5px] border-[#cbd5e1] text-[15px] font-semibold"
                      value={subtopic.title}
                      disabled={readOnly}
                      onChange={(event) => updateSubtopic(subtopic.id, { title: event.target.value })}
                      placeholder="Enter topic or subtopic"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-[12px] font-bold uppercase text-[#64748b]">Notes</span>
                    <Textarea
                      className="min-h-[72px] rounded-[6px] border-[#cbd5e1] bg-white text-[13px] leading-6"
                      value={subtopic.notes}
                      disabled={readOnly}
                      onChange={(event) => updateSubtopic(subtopic.id, { notes: event.target.value })}
                    />
                  </label>

                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[12px] font-bold uppercase text-[#64748b]">Success criteria</h3>
                      <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" disabled={readOnly} onClick={() => addCriterion(subtopic.id)}>
                        <Plus className="size-3.5" />
                        Criterion
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {subtopic.criteria.map((criterion) => (
                        <div key={criterion.id} className="grid gap-2 rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] p-3">
                          <div className="flex flex-wrap gap-1.5">
                            {actionOptions.map((option) => {
                              const active = criterion.actions.includes(option.value)
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={readOnly}
                                  onClick={() => toggleCriterionAction(subtopic.id, criterion, option.value)}
                                  className={`h-7 rounded-[5px] border px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                    active ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#111827] hover:text-[#111827]'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              )
                            })}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_36px]">
                            <Input
                              className="h-9 rounded-[5px] border-[#cbd5e1] bg-white text-[13px]"
                              value={criterion.detail}
                              disabled={readOnly}
                              onChange={(event) => updateCriterion(subtopic.id, criterion.id, { detail: event.target.value })}
                              placeholder="Success criteria"
                            />
                            <button
                              type="button"
                              className="grid size-9 place-items-center rounded-[5px] border border-[#e2e8f0] bg-white text-[#64748b] transition hover:border-[#fecaca] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-45"
                              onClick={() => removeCriterion(subtopic.id, criterion.id)}
                              disabled={subtopic.criteria.length === 1 || readOnly}
                              aria-label="Remove criterion"
                              title="Remove"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <div className="min-h-5 text-[12px] font-medium text-[#475569]">{criterionText(criterion)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>

          {canApprove ? (
            <section className="rounded-[8px] border border-[#d7dde5] bg-white p-4 shadow-sm">
              <label className="grid gap-2">
                <span className="text-[12px] font-bold uppercase text-[#64748b]">Review notes</span>
                <Textarea
                  className="min-h-[86px] rounded-[6px] border-[#cbd5e1] bg-white text-[13px] leading-6"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                />
              </label>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}

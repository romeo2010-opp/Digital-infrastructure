import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  Eye,
  FilePenLine,
  GripVertical,
  LayoutList,
  Loader2,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
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
  { value: 'apply', label: 'Apply' },
  { value: 'explain', label: 'Explain' },
  { value: 'describe', label: 'Describe' },
  { value: 'identify', label: 'Identify' },
  { value: 'compare', label: 'Compare' },
  { value: 'calculate', label: 'Calculate' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' },
]

const criterionActionVerbs: Record<string, string[]> = {
  define: ['define', 'state', 'name', 'recall', 'recognise', 'recognize', 'give meaning', 'give the meaning'],
  list: ['list', 'enumerate'],
  apply: ['apply', 'use', 'implement', 'teach', 'conduct', 'perform', 'demonstrate', 'practice', 'practise', 'carry out', 'execute'],
  explain: ['explain', 'justify', 'discuss', 'interpret', 'understand', 'tell why', 'show why'],
  describe: ['describe', 'outline', 'summarise', 'summarize', 'tell about'],
  identify: ['identify', 'locate', 'select', 'find', 'label', 'point out'],
  compare: ['compare', 'contrast', 'differentiate', 'distinguish', 'classify', 'sort', 'match'],
  calculate: ['calculate', 'solve', 'compute', 'estimate', 'measure', 'draw', 'graph'],
  analyse: ['analyse', 'analyze', 'examine', 'investigate', 'infer', 'collect', 'organise', 'organize'],
  evaluate: ['evaluate', 'assess', 'critique', 'judge', 'review', 'reflect'],
  create: ['create', 'design', 'develop', 'construct', 'produce', 'compose', 'plan', 'prepare', 'formulate', 'write', 'build'],
}

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function criterionTextWithoutLearnerLead(value: any) {
  return String(value || '')
    .trim()
    .replace(/^(learners?|students?|pupils?|children)\s+(can|will|should|should be able to|are able to|must|need to)\s+/i, '')
    .replace(/^by the end of (the )?(topic|lesson|unit|module|term|week)[^,.:;]*[,.:;]\s*/i, '')
    .replace(/^to\s+/i, '')
    .trim()
}

function inferCriterionActions(value: any, limit = 3) {
  const text = criterionTextWithoutLearnerLead(value).toLowerCase()
  if (!text) return []
  const matches: Array<{ action: string; index: number }> = []
  Object.entries(criterionActionVerbs).forEach(([action, verbs]) => {
    verbs.some((verb) => {
      const pattern = new RegExp(`\\b${escapeRegExp(verb)}(?:s|ed|ing)?\\b`, 'i')
      const match = text.match(pattern)
      if (match?.index !== undefined) {
        matches.push({ action, index: match.index })
        return true
      }
      return false
    })
  })
  return [...new Map(matches.sort((a, b) => a.index - b.index).map((match) => [match.action, match.action])).values()].slice(0, limit)
}

function stripCriterionActionLead(value: any) {
  const text = criterionTextWithoutLearnerLead(value)
  if (!text) return ''
  const verbPattern = Object.values(criterionActionVerbs).flat().sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
  return text
    .replace(new RegExp(`^(?:${verbPattern})(?:\\s+and\\s+(?:${verbPattern}))?\\s+`, 'i'), '')
    .replace(/^[:;,\-\s]+/, '')
    .trim() || text
}

function normalizeActionsForCriterion(actions: any, text: any) {
  const raw = Array.isArray(actions) ? actions : actions ? [actions] : []
  const provided = [...new Set(raw.map((action) => String(action || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).filter(Boolean))]
  const inferred = inferCriterionActions(text)
  if (!provided.length) return inferred.length ? inferred : ['define']
  if (provided.length === 1 && provided[0] === 'define' && inferred.length && inferred[0] !== 'define') return inferred
  return provided
}

function criterionText(criterion: Criterion) {
  const detail = criterion.detail.trim()
  const labels = criterion.actions.length ? criterion.actions.map(actionLabel) : ['Criterion']
  return detail ? labels.map((label) => `${label} ${detail}`).join(' / ') : labels.join(', ')
}

function actionChipClass(action: string) {
  if (['define', 'list', 'identify'].includes(action)) return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
  if (['apply', 'calculate', 'create'].includes(action)) return 'border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]'
  if (['analyse', 'evaluate', 'compare'].includes(action)) return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  return 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
}

function roleCanReview(user: any) {
  return ['school_owner', 'headteacher', 'super_admin'].includes(String(user?.role || '').toLowerCase())
}

function normalizeCriterion(row: any): Criterion {
  const sourceText = String(row?.detail || row?.target || row?.value || row?.text || row?.objective || row?.title || '').trim()
  const actions = normalizeActionsForCriterion(Array.isArray(row?.actions) && row.actions.length ? row.actions : row?.action, sourceText)
  return {
    id: newId(),
    actions: [...new Set(actions.map((action: any) => String(action || '').trim()).filter(Boolean))],
    detail: String(row?.detail || row?.target || row?.value || '').trim() || stripCriterionActionLead(sourceText),
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

function editableSectionsFromSyllabusMap(map: any): Subtopic[] {
  if (Array.isArray(map?.subtopics) && map.subtopics.length) return map.subtopics.map(normalizeSubtopic)
  if (!Array.isArray(map?.topics)) return []
  return map.topics.flatMap((topic: any) => {
    const topicTitle = String(topic?.title || topic?.name || '').trim()
    const ownCriteria = Array.isArray(topic?.criteria) ? topic.criteria : []
    const sections: Subtopic[] = []
    if (topicTitle && ownCriteria.length) sections.push(normalizeSubtopic({ title: topicTitle, notes: topic?.notes || topic?.description, criteria: ownCriteria }))
    if (Array.isArray(topic?.subtopics)) {
      topic.subtopics.forEach((subtopic: any) => {
        const subtopicTitle = String(subtopic?.title || subtopic?.name || '').trim()
        sections.push(normalizeSubtopic({
          ...subtopic,
          title: topicTitle && subtopicTitle ? `${topicTitle} / ${subtopicTitle}` : subtopicTitle || topicTitle,
        }))
      })
    }
    return sections
  })
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
  const [outlineSearch, setOutlineSearch] = useState('')
  const [outlineFilter, setOutlineFilter] = useState<'all' | 'draft' | 'complete'>('all')
  const [activeCriterionId, setActiveCriterionId] = useState('')

  const canReview = roleCanReview(user)
  const readOnly = false
  const canApprove = canReview && entryId && entry?.status === 'pending_review'
  const canDeleteEntry = Boolean(entryId) && (canReview || (Number(entry?.submitted_by) === Number(user?.id) && entry?.status !== 'approved'))
  const autoDraftAllowed = !readOnly && (!entry || ['draft', 'revision_requested'].includes(entry.status))

  const overview = useMemo(() => {
    const namedSubtopics = subtopics.filter((subtopic) => subtopic.title.trim())
    const criteriaCount = subtopics.reduce((total, subtopic) => total + subtopic.criteria.filter((criterion) => criterion.detail.trim()).length, 0)
    const tagCount = subtopics.reduce((total, subtopic) => total + subtopic.criteria.filter((criterion) => criterion.detail.trim()).reduce((inner, criterion) => inner + criterion.actions.length, 0), 0)
    return { namedSubtopics, criteriaCount, tagCount }
  }, [subtopics])

  const topicIsComplete = (subtopic: Subtopic) => Boolean(subtopic.title.trim() && subtopic.criteria.some((criterion) => criterion.detail.trim()))
  const completeTopics = subtopics.filter(topicIsComplete)
  const activeSubtopic = subtopics.find((subtopic) => subtopic.id === activeSubtopicId) || subtopics[0]
  const activeSubtopicIndex = Math.max(0, subtopics.findIndex((subtopic) => subtopic.id === activeSubtopic?.id))
  const activeCriteria = activeSubtopic?.criteria || []
  const activeNamedCriteria = activeCriteria.filter((criterion) => criterion.detail.trim())
  const currentCurriculumName = setupName(setup.curricula, form.curriculum_id) || 'Curriculum'
  const currentGradeName = setupName(setup.grades, form.grade_id) || 'Year level'
  const currentSubjectName = setupName(setup.subjects, form.subject_id) || 'Subject'
  const coverageScore = subtopics.length ? Math.round(((completeTopics.length / subtopics.length) * 55) + (Math.min(overview.criteriaCount / Math.max(subtopics.length * 3, 1), 1) * 45)) : 0
  const duplicateCriteriaCount = useMemo(() => {
    const seen = new Set<string>()
    let duplicates = 0
    for (const subtopic of subtopics) {
      for (const criterion of subtopic.criteria) {
        const key = criterion.detail.trim().toLowerCase()
        if (!key) continue
        if (seen.has(key)) duplicates += 1
        seen.add(key)
      }
    }
    return duplicates
  }, [subtopics])
  const issueCards = [
    { label: 'Learning outcome gaps', count: subtopics.filter((subtopic) => !subtopic.criteria.some((criterion) => criterion.detail.trim())).length },
    { label: 'Assessment misalignment', count: subtopics.filter((subtopic) => subtopic.criteria.some((criterion) => !criterion.actions.length)).length },
    { label: 'Duplicate criteria', count: duplicateCriteriaCount },
  ].filter((issue) => issue.count > 0)
  const suggestionCards = [
    { label: 'Align assessment tasks', count: Math.max(1, issueCards.length) },
    { label: 'Add real-world contexts', count: Math.max(1, subtopics.filter((subtopic) => !/example|context|practical|real/i.test(`${subtopic.notes} ${subtopic.title}`)).length) },
    { label: 'Improve differentiation', count: Math.max(1, Math.ceil(Math.max(overview.criteriaCount, 1) / 4)) },
  ]
  const filteredSubtopics = useMemo(() => {
    const term = outlineSearch.trim().toLowerCase()
    return subtopics.filter((subtopic) => {
      if (outlineFilter === 'complete' && !topicIsComplete(subtopic)) return false
      if (outlineFilter === 'draft' && topicIsComplete(subtopic)) return false
      if (!term) return true
      return `${subtopic.title} ${subtopic.notes} ${subtopic.criteria.map((criterion) => criterion.detail).join(' ')}`.toLowerCase().includes(term)
    })
  }, [outlineFilter, outlineSearch, subtopics])

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
          const loadedSubtopics = editableSectionsFromSyllabusMap(loadedEntry.syllabus_map)
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
    const next = blankCriterion(subtopics.find((subtopic) => subtopic.id === subtopicId)?.criteria.at(-1)?.actions || ['define'])
    setSubtopics((current) => current.map((subtopic) => (
      subtopic.id === subtopicId
        ? { ...subtopic, criteria: [...subtopic.criteria, next] }
        : subtopic
    )))
    setActiveCriterionId(next.id)
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

  const deleteEntry = async () => {
    if (!token || !entryId) return
    const confirmed = window.confirm(`Delete "${form.topic_name || 'this syllabus document'}" entirely?`)
    if (!confirmed) return
    setBusy(true)
    try {
      await api.deleteManualSyllabusEntry(token, entryId)
      toast.success('Syllabus document deleted.')
      navigate('/syllabus')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to delete syllabus document.')
    } finally {
      setBusy(false)
    }
  }

  const setFormValue = (patch: any) => {
    if (readOnly) return
    setForm((current: any) => ({ ...current, ...patch }))
  }

  const generateTeacherNotes = () => {
    if (!activeSubtopic || readOnly) return
    const criteria = activeNamedCriteria.slice(0, 3).map(criterionText).join('; ')
    const nextNotes = [
      activeSubtopic.title ? `This section helps teachers plan focused instruction for ${activeSubtopic.title}.` : '',
      criteria ? `Key success evidence: ${criteria}.` : '',
      'Review examples, learner practice, and assessment checks before publishing.',
    ].filter(Boolean).join(' ')
    updateSubtopic(activeSubtopic.id, { notes: nextNotes })
    toast.success('Teacher notes generated.')
  }

  const previewDocument = () => {
    toast.message(`${overview.namedSubtopics.length} topic${overview.namedSubtopics.length === 1 ? '' : 's'} and ${overview.criteriaCount} success criteria are ready in this syllabus.`)
  }

  const runSmartReview = () => {
    if (!issueCards.length) {
      toast.success('AI review found no obvious syllabus structure issues.')
      return
    }
    toast.message(`${issueCards.reduce((total, issue) => total + issue.count, 0)} syllabus issue${issueCards.length === 1 ? '' : 's'} need review.`)
  }

  const findDuplicates = () => {
    if (!duplicateCriteriaCount) {
      toast.success('No duplicate success criteria found.')
      return
    }
    toast.message(`${duplicateCriteriaCount} duplicate success ${duplicateCriteriaCount === 1 ? 'criterion' : 'criteria'} found.`)
  }

  const createLessonSequence = () => {
    const sequence = subtopics.filter((subtopic) => subtopic.title.trim()).slice(0, 5).map((subtopic, index) => `${index + 1}. ${subtopic.title.trim()}`).join(' ')
    toast.message(sequence || 'Add topics before creating a lesson sequence.')
  }

  const createExamBlueprint = () => {
    const highValueCriteria = subtopics.reduce((total, subtopic) => total + subtopic.criteria.filter((criterion) => criterion.detail.trim() && criterion.actions.some((action) => ['analyse', 'evaluate', 'create', 'apply'].includes(action))).length, 0)
    toast.message(`${highValueCriteria || overview.criteriaCount} criteria can feed an exam blueprint.`)
  }

  const saveText = autosaveState === 'saving' ? 'Saving draft...' : autosaveState === 'error' ? 'Autosave failed' : formatSavedAt(lastSavedAt)

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
            <div className="truncate text-[22px] font-bold leading-7 text-[#0f172a]">SmartLink Syllabus Studio</div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[12px] font-medium text-[#64748b]">
              <span>{currentGradeName} {currentSubjectName}</span>
              <span>•</span>
              <span className="truncate">{currentCurriculumName}</span>
              <span className="rounded-[5px] border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-0.5 text-[11px] font-bold text-[#166534]">{statusLabel(entry?.status)}</span>
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 items-center gap-2 xl:flex">
          <Cloud className={`size-4 ${autosaveState === 'error' ? 'text-[#dc2626]' : autosaveState === 'saving' ? 'text-[#ca8a04]' : 'text-[#16a34a]'}`} />
          <span className="truncate text-[12px] font-semibold text-[#64748b]">{loading ? 'Loading setup' : `${saveText} today`}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#d7deea] bg-white px-5 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={loading} onClick={previewDocument}>
            <Eye className="size-3.5" />
            Preview
          </Button>
          <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#d7deea] bg-white px-5 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={loading} onClick={runSmartReview}>
            <Sparkles className="size-3.5" />
            AI Review
          </Button>
          {canDeleteEntry ? (
            <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#fecaca] bg-white px-4 text-[13px] text-[#b91c1c] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={busy || loading} onClick={deleteEntry}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          ) : null}
          {canApprove ? (
            <>
              <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#d7deea] bg-white px-4 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={busy || loading} onClick={returnEntry}>
                <Undo2 className="size-3.5" />
                Return
              </Button>
              <Button type="button" className="h-10 rounded-[7px] border-[#2563eb] bg-[#2563eb] px-5 text-[13px] text-white shadow-[0_14px_28px_-18px_rgba(37,99,235,0.95)] hover:border-[#1d4ed8] hover:bg-[#1d4ed8]" disabled={busy || loading} onClick={approveEntry}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                Approve
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="h-10 rounded-[7px] border-[#d7deea] bg-white px-5 text-[13px] shadow-[0_7px_20px_-18px_rgba(15,23,42,0.8)]" disabled={busy || loading || readOnly} onClick={() => persistEntry('draft')}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save Draft
              </Button>
              <Button type="button" className="h-10 rounded-[7px] border-[#2563eb] bg-[#2563eb] px-5 text-[13px] text-white shadow-[0_14px_28px_-18px_rgba(37,99,235,0.95)] hover:border-[#1d4ed8] hover:bg-[#1d4ed8]" disabled={busy || loading || readOnly} onClick={submitForReview}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Submit for Approval
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden h-full w-[clamp(310px,23vw,380px)] shrink-0 flex-col border-r border-[#dde5f0] bg-white shadow-[inset_-1px_0_0_rgba(226,232,240,0.75)] md:flex">

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-[#0f172a]">Syllabus Outline</h2>
            <button type="button" className="grid size-9 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#475569] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]" title="Filters" aria-label="Filters">
              <SlidersHorizontal className="size-3.5" />
            </button>
          </div>
          <div className="mb-4 flex h-10 items-center gap-2 rounded-[7px] border border-[#d7deea] bg-white px-3 shadow-sm">
            <Search className="size-3.5 shrink-0 text-[#64748b]" />
            <Input
              className="h-9 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
              value={outlineSearch}
              onChange={(event) => setOutlineSearch(event.target.value)}
              placeholder="Search topics..."
            />
          </div>
          <div className="rounded-[8px] border border-[#dde5f0] bg-white p-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.55)]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-bold text-[#0f172a]">Syllabus Progress</div>
              <div className="text-[16px] font-bold text-[#2563eb]">{coverageScore}%</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]">
              <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${coverageScore}%` }} />
            </div>
            <div className="mt-2 text-[11px] font-medium text-[#64748b]">{completeTopics.length} of {subtopics.length} topics completed</div>
          </div>

          <div className="my-4 flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'All', count: subtopics.length },
              { id: 'draft', label: 'Draft', count: subtopics.length - completeTopics.length },
              { id: 'complete', label: 'Complete', count: completeTopics.length },
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setOutlineFilter(filter.id as 'all' | 'draft' | 'complete')}
                className={`h-8 rounded-full border px-3 text-[12px] font-bold shadow-sm transition ${outlineFilter === filter.id ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[#d7deea] bg-white text-[#475569] hover:border-[#bfdbfe] hover:text-[#2563eb]'}`}
              >
                {filter.label} <span className={outlineFilter === filter.id ? 'text-[#2563eb]' : 'text-[#64748b]'}>{filter.count}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            {filteredSubtopics.map((subtopic) => {
              const index = subtopics.findIndex((row) => row.id === subtopic.id)
              const active = activeSubtopicId === subtopic.id
              const criteria = subtopic.criteria.filter((criterion) => criterion.detail.trim())
              return (
                <button
                  key={subtopic.id}
                  type="button"
                  onClick={() => jumpToSubtopic(subtopic.id)}
                  className={`group rounded-[8px] border px-3 py-3 text-left transition ${
                    active ? 'border-[#93c5fd] bg-[#f8fbff] shadow-[0_14px_28px_-24px_rgba(37,99,235,0.95)] ring-1 ring-[#bfdbfe]' : 'border-transparent text-[#334155] hover:border-[#d7deea] hover:bg-[#f8fafc]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${active ? 'bg-[#2563eb] text-white' : 'bg-[#e2e8f0] text-[#475569]'}`}>{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[#0f172a]">{subtopic.title.trim() || 'Untitled topic'}</span>
                    {topicIsComplete(subtopic) ? <CheckCircle2 className="size-3.5 text-[#16a34a]" /> : <span className="size-3.5 rounded-full border border-[#64748b]" />}
                    <ChevronRight className="size-3.5 text-[#64748b]" />
                  </div>
                  <div className="ml-9 mt-1 text-[11px] font-medium text-[#64748b]">{criteria.length} success criteria</div>
                  {criteria.length ? (
                    <div className="ml-9 mt-1 grid gap-1 text-[11px] text-[#64748b]">
                      {criteria.slice(0, 2).map((criterion) => <span key={criterion.id} className="truncate">{criterionText(criterion)}</span>)}
                    </div>
                  ) : null}
                </button>
              )
            })}
            {!filteredSubtopics.length ? (
              <div className="rounded-[7px] border border-dashed border-[#d7dde5] bg-white p-4 text-center text-[12px] font-semibold text-[#64748b]">No topics match the current filter.</div>
            ) : null}
          </div>

          <div className="sticky bottom-0 mt-4 border-t border-[#e2e8f0] bg-white pt-4">
            <Button type="button" variant="outline" className="h-10 w-full rounded-[7px] border-[#bfdbfe] bg-white px-3 text-[13px] font-bold text-[#2563eb] shadow-sm" disabled={busy || loading || readOnly} onClick={addSubtopic}>
              <Plus className="size-3.5" />
              Add New Topic
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[#f6f8fb]">
        <div className="mx-auto grid w-full max-w-[1010px] gap-4 px-6 py-5">
          <section className="rounded-[9px] border border-[#dde5f0] bg-white p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0] text-[#2563eb]">Topic</div>
                {activeSubtopic ? (
                  <Input
                    className="mt-2 h-auto min-h-[34px] w-full border-0 bg-transparent p-0 text-[24px] font-bold leading-8 tracking-[0] text-[#0f172a] shadow-none focus-visible:ring-0"
                    value={activeSubtopic.title}
                    disabled={readOnly}
                    onChange={(event) => updateSubtopic(activeSubtopic.id, { title: event.target.value })}
                    placeholder="Untitled topic"
                  />
                ) : (
                  <div className="mt-2 text-[24px] font-bold leading-8 text-[#0f172a]">Untitled topic</div>
                )}
                <div className="mt-3 inline-flex rounded-[5px] border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-bold text-[#2563eb]">{activeNamedCriteria.length} success criteria</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="grid size-10 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#475569] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]" title="Bookmark" aria-label="Bookmark">
                  <Bookmark className="size-4" />
                </button>
                <button type="button" className="grid size-10 place-items-center rounded-[7px] border border-[#d7deea] bg-white text-[#475569] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]" title="More actions" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[9px] border border-[#dde5f0] bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]">
            <div className="flex items-center gap-2 border-b border-[#e2e8f0] px-5 py-4">
              <span className="grid size-6 place-items-center rounded-[5px] bg-[#eff6ff] text-[#2563eb]"><BookOpenText className="size-4" /></span>
              <h2 className="text-[15px] font-bold text-[#0f172a]">Topic Identity</h2>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Curriculum', currentCurriculumName],
                ['Year Level', currentGradeName],
                ['Subject', currentSubjectName],
                ['Status', statusLabel(entry?.status)],
              ].map(([label, value], index) => (
                <div key={label} className={`min-w-0 ${index ? 'lg:border-l lg:border-[#e2e8f0] lg:pl-4' : ''}`}>
                  <div className="text-[11px] font-bold text-[#64748b]">{label}</div>
                  <div className={`mt-1 truncate text-[13px] font-bold ${label === 'Status' ? 'text-[#166534]' : 'text-[#0f172a]'}`}>{value}</div>
                </div>
              ))}
            </div>
          </section>

          {activeSubtopic ? (
            <section className="rounded-[9px] border border-[#dde5f0] bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-5 py-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-[5px] bg-[#f5f3ff] text-[#7c3aed]"><FilePenLine className="size-4" /></span>
                  <h2 className="truncate text-[15px] font-bold text-[#0f172a]">Teacher Notes</h2>
                </div>
                <Button type="button" variant="outline" className="h-9 rounded-[7px] border-[#d7deea] bg-white px-4 text-[12px] shadow-sm" onClick={generateTeacherNotes}>
                  <Sparkles className="size-3.5" />
                  Generate with AI
                </Button>
              </div>
              <div className="p-5">
                <Textarea
                  className="min-h-[72px] rounded-[7px] border-[#d7deea] bg-white text-[13px] leading-6 shadow-none"
                  value={activeSubtopic.notes}
                  disabled={readOnly}
                  onChange={(event) => updateSubtopic(activeSubtopic.id, { notes: event.target.value })}
                  placeholder="Add notes for teachers using this topic."
                />
              </div>
            </section>
          ) : null}

          <div className="grid gap-4">
            {activeSubtopic ? [activeSubtopic].map((subtopic) => {
              const index = activeSubtopicIndex
              return (
              <section
                key={subtopic.id}
                ref={(node) => { sectionRefs.current[subtopic.id] = node }}
                className="rounded-[9px] border border-[#dde5f0] bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.7)]"
                onFocus={() => setActiveSubtopicId(subtopic.id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-5 py-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-[#dcfce7] text-[#16a34a]"><CheckCircle2 className="size-4" /></span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-bold text-[#0f172a]">Success Criteria</h2>
                      <p className="text-[11px] font-medium text-[#64748b]">These define what success looks like for this topic.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-9 rounded-[7px] border-[#d7deea] bg-white px-4 text-[12px] shadow-sm" disabled={readOnly} onClick={() => addCriterion(subtopic.id)}>
                      <Plus className="size-3.5" />
                      Add Criteria
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-[7px] border-[#d7deea] bg-white px-4 text-[12px] shadow-sm" disabled={readOnly}>
                      <GripVertical className="size-3.5" />
                      Reorder
                    </Button>
                  </div>
                </div>

                <div className="p-5">
                  <div className="overflow-hidden rounded-[7px] border border-[#e2e8f0]">
                    {subtopic.criteria.map((criterion, criterionIndex) => (
                      <div key={criterion.id} className="grid min-h-[54px] grid-cols-[22px_30px_minmax(0,1fr)_minmax(130px,auto)_76px] items-center gap-3 border-b border-[#e2e8f0] bg-white px-3 last:border-b-0 hover:bg-[#f8fafc]">
                        <GripVertical className="size-3.5 text-[#94a3b8]" />
                        <span className="grid size-6 place-items-center rounded-full bg-[#dcfce7] text-[11px] font-bold text-[#166534]">{criterionIndex + 1}</span>
                        <Input
                          className="h-9 border-0 bg-transparent px-0 text-[13px] font-medium text-[#334155] shadow-none focus-visible:ring-0"
                          value={criterion.detail}
                          disabled={readOnly}
                          onFocus={() => setActiveCriterionId(criterion.id)}
                          onChange={(event) => updateCriterion(subtopic.id, criterion.id, { detail: event.target.value })}
                          placeholder="Success criteria"
                        />
                        <div className="flex flex-wrap justify-end gap-1">
                          {(criterion.actions.length ? criterion.actions : ['define']).slice(0, 3).map((action) => (
                            <span key={action} className={`rounded-[5px] border px-2 py-1 text-[10px] font-bold ${actionChipClass(action)}`}>{actionLabel(action)}</span>
                          ))}
                        </div>
                        <div className="flex justify-end gap-1">
                          <button type="button" className="grid size-8 place-items-center rounded-[6px] border border-[#e2e8f0] bg-white text-[#475569] shadow-sm transition hover:border-[#2563eb] hover:text-[#2563eb]" onClick={() => setActiveCriterionId(activeCriterionId === criterion.id ? '' : criterion.id)} aria-label="Edit tags" title="Edit tags">
                            <FilePenLine className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="grid size-8 place-items-center rounded-[6px] border border-[#e2e8f0] bg-white text-[#64748b] transition hover:border-[#fecaca] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-45"
                            onClick={() => removeCriterion(subtopic.id, criterion.id)}
                            disabled={subtopic.criteria.length === 1 || readOnly}
                            aria-label="Remove criterion"
                            title="Remove"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        {activeCriterionId === criterion.id ? (
                          <div className="col-span-5 flex flex-wrap gap-1.5 border-t border-[#e2e8f0] bg-[#f8fafc] px-1 py-3">
                            {actionOptions.map((option) => {
                              const active = criterion.actions.includes(option.value)
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={readOnly}
                                  onClick={() => toggleCriterionAction(subtopic.id, criterion, option.value)}
                                  className={`h-7 rounded-[5px] border px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                    active ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#2563eb] hover:text-[#2563eb]'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}) : null}
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

      <aside className="hidden h-full w-[clamp(300px,21vw,340px)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#dde5f0] bg-white p-5 shadow-[inset_1px_0_0_rgba(226,232,240,0.75)] xl:flex">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold text-[#0f172a]">Syllabus Intelligence</h2>
          <Sparkles className="size-4 text-[#2563eb]" />
        </div>

        <section className="rounded-[8px] border border-[#dde5f0] bg-white p-4 shadow-[0_14px_30px_-25px_rgba(15,23,42,0.7)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-bold text-[#0f172a]">Coverage Score</div>
            <div className={`flex items-center gap-1.5 text-[11px] font-bold ${coverageScore >= 80 ? 'text-[#166534]' : coverageScore >= 50 ? 'text-[#9a3412]' : 'text-[#b91c1c]'}`}>
              {coverageScore >= 80 ? 'Good' : coverageScore >= 50 ? 'Review' : 'Low'}
              <span className={`size-2 rounded-full ${coverageScore >= 80 ? 'bg-[#22c55e]' : coverageScore >= 50 ? 'bg-[#f59e0b]' : 'bg-[#ef4444]'}`} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid size-20 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#22c55e ${coverageScore * 3.6}deg, #e2e8f0 0deg)` }}>
              <div className="grid size-14 place-items-center rounded-full bg-white text-[20px] font-bold text-[#0f172a]">{coverageScore}%</div>
            </div>
            <div className="text-[12px] leading-5 text-[#475569]">Your syllabus covers {coverageScore}% of the expected topic and success criteria structure.</div>
          </div>
          <Button type="button" variant="outline" className="mt-4 h-9 w-full justify-between rounded-[7px] border-[#d7deea] bg-white px-3 text-[12px]" onClick={previewDocument}>
            View Coverage Details
            <ChevronRight className="size-3.5" />
          </Button>
        </section>

        <section className="rounded-[8px] border border-[#dde5f0] bg-white p-4 shadow-[0_14px_30px_-25px_rgba(15,23,42,0.7)]">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-[#0f172a]">
            <AlertTriangle className="size-4 text-[#b91c1c]" />
            Detected Issues
          </div>
          <div className="grid gap-2">
            {(issueCards.length ? issueCards : [{ label: 'No major structure issues', count: 0 }]).map((issue, index) => (
              <button key={issue.label} type="button" className="flex h-9 items-center justify-between gap-2 rounded-[5px] px-1 text-left text-[12px] font-medium text-[#475569]" onClick={runSmartReview}>
                <span className="flex items-center gap-2">
                  <span className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${index === 0 ? 'bg-[#fef2f2] text-[#b91c1c]' : index === 1 ? 'bg-[#fff7ed] text-[#9a3412]' : 'bg-[#f8fafc] text-[#475569]'}`}>{issue.count}</span>
                  {issue.label}
                </span>
                <ChevronRight className="size-3.5 text-[#64748b]" />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[8px] border border-[#dde5f0] bg-white p-4 shadow-[0_14px_30px_-25px_rgba(15,23,42,0.7)]">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-[#0f172a]">
            <Sparkles className="size-4 text-[#2563eb]" />
            AI Suggestions
          </div>
          <div className="grid gap-2">
            {suggestionCards.map((suggestion) => (
              <button key={suggestion.label} type="button" className="flex h-8 items-center justify-between gap-2 rounded-[5px] text-left text-[12px] font-medium text-[#475569]" onClick={runSmartReview}>
                <span>{suggestion.label}</span>
                <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2 py-0.5 text-[11px] font-bold text-[#2563eb]">{suggestion.count}</span>
              </button>
            ))}
            <button type="button" className="mt-1 flex h-8 items-center justify-between rounded-[5px] text-left text-[12px] font-bold text-[#2563eb]" onClick={runSmartReview}>
              View all suggestions
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </section>

        <section className="grid gap-2">
          <h2 className="text-[13px] font-bold text-[#0f172a]">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-16 flex-col whitespace-normal rounded-[7px] border-[#dde5f0] bg-white px-2 text-center text-[10px] font-bold leading-tight text-[#0f172a] shadow-sm" onClick={generateTeacherNotes}>
              <FilePenLine className="size-4 text-[#2563eb]" />
              Generate teacher notes
            </Button>
            <Button type="button" variant="outline" className="h-16 flex-col whitespace-normal rounded-[7px] border-[#dde5f0] bg-white px-2 text-center text-[10px] font-bold leading-tight text-[#0f172a] shadow-sm" onClick={findDuplicates}>
              <Copy className="size-4 text-[#2563eb]" />
              Find duplicates
            </Button>
            <Button type="button" variant="outline" className="h-16 flex-col whitespace-normal rounded-[7px] border-[#dde5f0] bg-white px-2 text-center text-[10px] font-bold leading-tight text-[#0f172a] shadow-sm" onClick={createLessonSequence}>
              <LayoutList className="size-4 text-[#2563eb]" />
              Create lesson sequence
            </Button>
            <Button type="button" variant="outline" className="h-16 flex-col whitespace-normal rounded-[7px] border-[#dde5f0] bg-white px-2 text-center text-[10px] font-bold leading-tight text-[#0f172a] shadow-sm" onClick={createExamBlueprint}>
              <BookOpenText className="size-4 text-[#2563eb]" />
              Exam blueprint
            </Button>
          </div>
        </section>
      </aside>
      </div>
    </div>
  )
}

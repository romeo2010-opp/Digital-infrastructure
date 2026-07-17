import { useEffect, useMemo, useState } from 'react'
import { Award, BookOpenText, Check, ClipboardCheck, FileText, Loader2, Plus, RotateCcw, Save, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Users, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { ModalShell } from '../components/ModalShell'
import { usePortal } from '../lib/portalContext'

type TabKey = 'uploads' | 'topics' | 'questions' | 'generator' | 'drills' | 'insights'

const tabs: Array<{ id: TabKey; label: string }> = [
  { id: 'uploads', label: 'Documents' },
  { id: 'topics', label: 'Topic Map' },
  { id: 'questions', label: 'Question Bank' },
  { id: 'generator', label: 'AI Drafts' },
  { id: 'drills', label: 'Daily Drills' },
  { id: 'insights', label: 'Insights' },
]

const AI_NOT_CONFIGURED_MESSAGE = 'AI assistance is not configured yet. Teacher entry, review, and manual approval features are still available.'
const supportedSyllabusTypes = '.txt,.csv,.pdf,.docx,.xlsx'
const materialTypes = [
  'full_syllabus',
  'scheme_of_work',
  'teacher_notes',
  'exam_outline',
  'topic_list',
  'marking_scheme',
  'past_internal_paper',
  'other',
]

function fileToDataUrl(file: File, mimeType = file.type || 'text/plain') {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;]*;/, `data:${mimeType};`))
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}

function syllabusMimeType(file: File) {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (name.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusChip(value: any) {
  const status = String(value || '').toLowerCase()
  const color = status.includes('approved') || status === 'complete'
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : status.includes('reject') || status.includes('failed')
      ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
      : 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  return <span className={`rounded-[4px] border px-2 py-1 text-[11px] font-bold ${color}`}>{valueLabel(value)}</span>
}

function selectClassName() {
  return 'h-8 rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] text-[#111827] outline-none focus:border-[#111827]'
}

function roleCanReview(user: any) {
  return ['school_owner', 'headteacher', 'super_admin'].includes(String(user?.role || '').toLowerCase())
}

function canDeleteSyllabusDocument(user: any, row: any) {
  if (roleCanReview(user)) return true
  if (Number(row?.submitted_by) !== Number(user?.id)) return false
  return row?.status !== 'approved'
}

function canDeleteSyllabusUpload(user: any, row: any) {
  if (roleCanReview(user)) return true
  if (Number(row?.uploaded_by) !== Number(user?.id)) return false
  return row?.processing_status !== 'approved'
}

function reviewUploadWithCounts(payload: any) {
  if (!payload?.upload) return null
  const items = payload?.items || []
  return {
    ...payload.upload,
    extracted_items: items.length,
    pending_items: items.filter((item: any) => item.status === 'pending_review').length,
    approved_items: items.filter((item: any) => item.status === 'approved').length,
  }
}

function isCompletedSyllabusExtractionUpload(upload: any) {
  if (!upload) return false
  const status = String(upload.processing_status || '').toLowerCase()
  const pendingItems = Number(upload.pending_items || 0)
  const approvedItems = Number(upload.approved_items || 0)
  return status === 'approved' || (pendingItems === 0 && approvedItems > 0)
}

function needsSyllabusExtractionAttention(upload: any) {
  return Boolean(upload) && !isCompletedSyllabusExtractionUpload(upload)
}

export function SyllabusIntelligencePage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const canReviewManualEntries = roleCanReview(user)
  const [activeTab, setActiveTab] = useState<TabKey>('uploads')
  const [setup, setSetup] = useState<any>({ curricula: [], grades: [], subjects: [], academic_years: [], terms: [] })
  const [ai, setAi] = useState<any>(null)
  const [uploads, setUploads] = useState<any[]>([])
  const [manualEntries, setManualEntries] = useState<any[]>([])
  const [topics, setTopics] = useState<any[]>([])
  const [questions, setQuestions] = useState<any[]>([])
  const [drillSessions, setDrillSessions] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [review, setReview] = useState<any>(null)
  const [batch, setBatch] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draftForm, setDraftForm] = useState<any>({ grade_id: '', subject_id: '', topic_id: '', difficulty: 'easy', question_type: 'mixed', number_of_questions: 5 })
  const [drillForm, setDrillForm] = useState<any>({ target_type: 'student', student_id: '', class_id: '', subject_id: '', topic_id: '' })
  const [insightClassId, setInsightClassId] = useState('')
  const [insights, setInsights] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadText, setUploadText] = useState('')
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false)
  const [drillModalOpen, setDrillModalOpen] = useState(false)
  const [uploadForm, setUploadForm] = useState<any>({
    curriculum_id: '',
    grade_id: '',
    subject_id: '',
    academic_year_id: '',
    term_id: '',
    material_type: 'full_syllabus',
  })
  const [editingItem, setEditingItem] = useState<any>(null)
  const [itemForm, setItemForm] = useState<any>({ title: '', description: '', suggested_week: '', exam_relevance: 'medium', keywords: '' })
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([])

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [setupPayload, aiPayload, uploadPayload, manualPayload, topicPayload, questionPayload, studentPayload, classPayload, drillPayload] = await Promise.all([
        api.getSyllabusSetup(token),
        api.getAiStatus(token),
        api.listSyllabusUploads(token),
        api.listManualSyllabusEntries(token),
        api.listSyllabusTopics(token),
        api.listQuestionBank(token),
        api.listStudents(token),
        api.listClasses(token),
        api.listDrills(token).catch(() => ({ drills: [] })),
      ])
      setSetup(setupPayload)
      setAi(aiPayload?.ai || null)
      setUploads(uploadPayload?.uploads || [])
      setManualEntries(manualPayload?.entries || [])
      setTopics(topicPayload?.topics || [])
      setQuestions(questionPayload?.questions || [])
      setDrillSessions(drillPayload?.drills || [])
      setStudents(studentPayload?.students || [])
      setClasses(classPayload?.classes || [])
      if (!draftForm.grade_id && setupPayload?.grades?.[0]) setDraftForm((current: any) => ({ ...current, grade_id: String(setupPayload.grades[0].id) }))
      if (!drillForm.student_id && studentPayload?.students?.[0]) setDrillForm((current: any) => ({ ...current, student_id: String(studentPayload.students[0].id) }))
      if (!drillForm.class_id && classPayload?.classes?.[0]) setDrillForm((current: any) => ({ ...current, class_id: String(classPayload.classes[0].id) }))
      if (!insightClassId && classPayload?.classes?.[0]) setInsightClassId(String(classPayload.classes[0].id))
      setUploadForm((current: any) => ({
        ...current,
        curriculum_id: current.curriculum_id || String(setupPayload?.curricula?.[0]?.id || ''),
        grade_id: current.grade_id || String(setupPayload?.grades?.[0]?.id || ''),
        subject_id: current.subject_id || String(setupPayload?.subjects?.[0]?.id || ''),
        academic_year_id: current.academic_year_id || String(setupPayload?.academic_years?.[0]?.id || ''),
        term_id: current.term_id || String(setupPayload?.terms?.[0]?.id || ''),
      }))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load syllabus intelligence.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const filteredTopics = useMemo(() => {
    const term = search.toLowerCase()
    return topics.filter((topic) => !term || `${topic.topic_name} ${topic.subject_name} ${topic.grade_name}`.toLowerCase().includes(term))
  }, [topics, search])
  const filteredQuestions = useMemo(() => {
    const term = search.toLowerCase()
    return questions.filter((question) => !term || `${question.question_text} ${question.topic_name} ${question.subject_name}`.toLowerCase().includes(term))
  }, [questions, search])
  const generatorTopics = topics.filter((topic) => {
    if (draftForm.grade_id && String(topic.grade_id || '') !== String(draftForm.grade_id)) return false
    if (draftForm.subject_id && String(topic.subject_id || '') !== String(draftForm.subject_id)) return false
    return true
  })
  const reviewItems = review?.items || []
  const pendingReviewItems = reviewItems.filter((item: any) => item.status === 'pending_review')
  const selectedReviewItems = reviewItems.filter((item: any) => selectedReviewIds.includes(String(item.id)) && item.status === 'pending_review')
  const reviewUpload = reviewUploadWithCounts(review)
  const activeUpload = needsSyllabusExtractionAttention(reviewUpload)
    ? reviewUpload
    : uploads.find(needsSyllabusExtractionAttention) || null
  const completedExtractionCount = uploads.filter(isCompletedSyllabusExtractionUpload).length
  const idlePipelineDetail = completedExtractionCount ? 'Ready for next material' : 'Awaiting material'
  const activeExtractionSummary = activeUpload?.extraction_summary_json || {}
  const activePipelineSteps = [
    {
      id: 'upload',
      label: 'Upload',
      detail: activeUpload ? activeUpload.original_filename : idlePipelineDetail,
      state: activeUpload ? 'complete' : 'waiting',
    },
    {
      id: 'extract',
      label: 'Extraction Pipeline',
      detail: activeUpload ? `${Number(activeUpload.extracted_items || review?.items?.length || 0)} structured item${Number(activeUpload.extracted_items || review?.items?.length || 0) === 1 ? '' : 's'}` : 'LLM parse to JSON',
      state: activeUpload?.processing_status === 'failed' ? 'failed' : activeUpload ? 'complete' : 'waiting',
    },
    {
      id: 'review',
      label: 'Teacher Review',
      detail: activeUpload ? `${Number(activeUpload.pending_items || 0)} pending / ${Number(activeUpload.approved_items || 0)} approved` : 'Edit before publish',
      state: activeUpload && Number(activeUpload.pending_items || 0) === 0 && Number(activeUpload.approved_items || 0) > 0 ? 'complete' : activeUpload ? 'active' : 'waiting',
    },
    {
      id: 'publish',
      label: 'Publish',
      detail: activeUpload && Number(activeUpload.approved_items || 0) > 0 ? 'Approved topic map' : 'Approve topics',
      state: activeUpload && Number(activeUpload.approved_items || 0) > 0 ? 'complete' : 'waiting',
    },
  ]
  const documentForUpload = (upload: any) => {
    if (!upload?.subject_id) return null
    return manualEntries.find((entry) => (
      String(entry.subject_id || '') === String(upload.subject_id || '')
      && String(entry.grade_id || '') === String(upload.grade_id || '')
      && entry.status !== 'rejected'
    )) || null
  }
  const activeReviewDocument = review?.upload ? documentForUpload(review.upload) : null

  const resetExtractionSection = () => {
    setReview(null)
    setSelectedReviewIds([])
    setPipelineModalOpen(false)
    setUploadFile(null)
    setUploadText('')
  }

  const resetExtractionSectionIfComplete = (payload: any) => {
    const upload = reviewUploadWithCounts(payload)
    if (!isCompletedSyllabusExtractionUpload(upload)) return false
    resetExtractionSection()
    return true
  }

  const openReview = async (uploadId: any) => {
    if (!token) return
    setBusy(true)
    try {
      const payload = await api.getSyllabusReview(token, uploadId)
      setReview(payload)
      setSelectedReviewIds([])
      setActiveTab('uploads')
      return payload
    } catch (err: any) {
      toast.error(err?.message || 'Unable to open review.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const toggleReviewSelection = (item: any) => {
    if (item.status !== 'pending_review') return
    const id = String(item.id)
    setSelectedReviewIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  const selectPendingReviewItems = () => {
    setSelectedReviewIds(pendingReviewItems.map((item: any) => String(item.id)))
  }

  const approveSelectedItems = async () => {
    if (!token || !review?.upload?.id) return
    const ids = selectedReviewItems.map((item: any) => item.id)
    if (!ids.length) {
      toast.message('Select at least one pending extracted item.')
      return
    }
    setBusy(true)
    try {
      const response = await api.approveExtractedSyllabusItems(token, ids)
      toast.success(`${response?.approved_items || ids.length} selected item${ids.length === 1 ? '' : 's'} approved and added to the syllabus document.`)
      setSelectedReviewIds([])
      const nextReview = await openReview(review.upload.id)
      await load()
      resetExtractionSectionIfComplete(nextReview)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to approve selected items.')
    } finally {
      setBusy(false)
    }
  }

  const deleteSyllabusDocument = async (entry: any) => {
    if (!token || !entry?.id) return
    const confirmed = window.confirm(`Delete "${entry.topic_name || 'this syllabus document'}" entirely?`)
    if (!confirmed) return
    setBusy(true)
    try {
      await api.deleteManualSyllabusEntry(token, entry.id)
      toast.success('Syllabus document deleted.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to delete syllabus document.')
    } finally {
      setBusy(false)
    }
  }

  const deleteSyllabusUpload = async (upload: any) => {
    if (!token || !upload?.id) return
    const confirmed = window.confirm(`Delete "${upload.original_filename || 'this uploaded material'}" and its extracted review items?`)
    if (!confirmed) return
    setBusy(true)
    try {
      await api.deleteSyllabusUpload(token, upload.id)
      if (String(review?.upload?.id || '') === String(upload.id)) {
        setReview(null)
        setSelectedReviewIds([])
      }
      toast.success('Uploaded material deleted.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to delete uploaded material.')
    } finally {
      setBusy(false)
    }
  }

  const uploadMaterial = async () => {
    if (!token) return
    if (!uploadForm.subject_id) {
      toast.error('Select the subject before extracting.')
      return
    }
    if (!uploadFile && !uploadText.trim()) {
      toast.error('Choose a syllabus file or paste syllabus text.')
      return
    }
    setBusy(true)
    try {
      const payload: any = {
        ...uploadForm,
        material_type: uploadForm.material_type || 'full_syllabus',
      }
      if (uploadFile) {
        const fileType = syllabusMimeType(uploadFile)
        payload.file_name = uploadFile.name
        payload.file_type = fileType
        payload.data_url = await fileToDataUrl(uploadFile, fileType)
      } else {
        payload.file_name = `pasted-syllabus-${Date.now()}.txt`
        payload.file_type = 'text/plain'
        payload.text_content = uploadText
      }
      const response = await api.uploadSyllabus(token, payload)
      const uploadId = response?.upload_id || response?.upload?.id
      toast.success('Syllabus material uploaded and extracted.')
      setUploadFile(null)
      setUploadText('')
      await load()
      if (uploadId) await openReview(uploadId)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to extract syllabus material.')
    } finally {
      setBusy(false)
    }
  }

  const startEditingItem = (item: any) => {
    setEditingItem(item)
    setItemForm({
      title: item.title || '',
      description: item.description || '',
      suggested_week: item.suggested_week || '',
      exam_relevance: item.exam_relevance || 'medium',
      keywords: Array.isArray(item.keywords_json) ? item.keywords_json.join(', ') : '',
    })
  }

  const saveItemEdit = async () => {
    if (!token || !editingItem) return
    setBusy(true)
    try {
      await api.updateExtractedSyllabusItem(token, editingItem.id, {
        title: itemForm.title,
        description: itemForm.description,
        suggested_week: itemForm.suggested_week || null,
        exam_relevance: itemForm.exam_relevance || null,
        keywords: String(itemForm.keywords || '').split(',').map((value) => value.trim()).filter(Boolean),
      })
      toast.success('Extracted item updated.')
      const uploadId = editingItem.upload_id
      setEditingItem(null)
      if (uploadId) await openReview(uploadId)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to update extracted item.')
    } finally {
      setBusy(false)
    }
  }

  const approveItem = async (item: any) => {
    if (!token) return
    setBusy(true)
    try {
      await api.approveExtractedSyllabusItem(token, item.id)
      toast.success(`${valueLabel(item.item_type)} approved.`)
      const nextReview = await openReview(item.upload_id)
      await load()
      resetExtractionSectionIfComplete(nextReview)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to approve item.')
    } finally {
      setBusy(false)
    }
  }

  const rejectItem = async (item: any) => {
    if (!token) return
    setBusy(true)
    try {
      await api.rejectExtractedSyllabusItem(token, item.id)
      toast.success('Extracted item rejected.')
      await openReview(item.upload_id)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to reject item.')
    } finally {
      setBusy(false)
    }
  }

  const approveHighConfidence = async () => {
    if (!review?.items?.length) return
    const rows = review.items.filter((item: any) => Number(item.confidence || 0) >= 0.75 && item.status === 'pending_review' && ['topic', 'subtopic'].includes(item.item_type))
    if (!rows.length) {
      toast.message('No high-confidence topic items are pending.')
      return
    }
    setBusy(true)
    try {
      await api.approveExtractedSyllabusItems(token, rows.map((row: any) => row.id))
      toast.success(`${rows.length} high-confidence items approved.`)
      setSelectedReviewIds([])
      const nextReview = await openReview(review.upload.id)
      await load()
      resetExtractionSectionIfComplete(nextReview)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to approve high-confidence items.')
    } finally {
      setBusy(false)
    }
  }

  const generateDrafts = async () => {
    if (!token || !draftForm.subject_id || !draftForm.topic_id) {
      toast.error('Select a subject and topic.')
      return
    }
    setBusy(true)
    try {
      const payload = await api.generateDraftQuestions(token, draftForm)
      toast.success(`${payload.questions_created || 0} draft questions created.`)
      if (payload.batch_id) setBatch(await api.getQuestionBatchReview(token, payload.batch_id))
      await load()
      setActiveTab('generator')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to generate draft questions.')
    } finally {
      setBusy(false)
    }
  }

  const approveQuestion = async (question: any) => {
    if (!token) return
    setBusy(true)
    try {
      await api.approveQuestion(token, question.id)
      toast.success('Question approved for Daily Drills.')
      await load()
      if (batch?.batch?.id) setBatch(await api.getQuestionBatchReview(token, batch.batch.id))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to approve question.')
    } finally {
      setBusy(false)
    }
  }

  const rejectQuestion = async (question: any) => {
    if (!token) return
    setBusy(true)
    try {
      await api.rejectQuestion(token, question.id)
      toast.success('Question rejected.')
      await load()
      if (batch?.batch?.id) setBatch(await api.getQuestionBatchReview(token, batch.batch.id))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to reject question.')
    } finally {
      setBusy(false)
    }
  }

  const generateDrill = async () => {
    if (!token) return
    const targetType = drillForm.target_type || 'student'
    if (targetType === 'class' && !drillForm.class_id) {
      toast.error('Select a class.')
      return
    }
    if (targetType !== 'class' && !drillForm.student_id) {
      toast.error('Select a student.')
      return
    }
    setBusy(true)
    try {
      if (targetType === 'class') {
        const result = await api.generateClassDrills(token, drillForm.class_id, drillForm)
        const generated = Number(result?.generated || 0)
        const skipped = Number(result?.skipped || 0)
        const failed = Number(result?.failed || 0) + Number(result?.insufficient_questions || 0)
        const details = [
          skipped ? `${skipped} skipped` : '',
          failed ? `${failed} failed` : '',
        ].filter(Boolean).join(', ')
        toast.success(`Generated ${generated} class drill${generated === 1 ? '' : 's'}${details ? ` (${details})` : ''}.`)
      } else {
        await api.generateDrill(token, drillForm.student_id, drillForm)
        toast.success('Daily Drill generated.')
      }
      setDrillModalOpen(false)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to generate drill.')
    } finally {
      setBusy(false)
    }
  }

  const loadInsights = async () => {
    if (!token || !insightClassId) return
    setBusy(true)
    try {
      setInsights(await api.getTeacherDrillInsights(token, insightClassId))
      toast.success('Drill insights refreshed.')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load drill insights.')
    } finally {
      setBusy(false)
    }
  }

  const renderUploads = () => (
    <div className="grid gap-3">
      <SectionCard
        title="Syllabus Extraction"
        subtitle="Upload material, extract structured JSON, review, then publish approved topics."
        actions={(
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={() => setPipelineModalOpen(true)}>
            <Upload className="size-3.5" />
            Open pipeline
          </Button>
        )}
      >
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid gap-2 sm:grid-cols-4">
            {activePipelineSteps.map((step, index) => (
              <div key={step.id} className="flex items-center gap-2">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${step.state === 'complete' ? 'border-[#16a34a] bg-[#16a34a] text-white' : step.state === 'active' ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]' : step.state === 'failed' ? 'border-[#dc2626] bg-[#fef2f2] text-[#b91c1c]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                  {step.state === 'complete' ? <Check className="size-3.5" /> : step.state === 'failed' ? <X className="size-3.5" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[#111827]">{step.label}</div>
                  <div className="truncate text-[11px] font-medium text-[#64748b]">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-semibold text-[#475569]">
            {activeUpload
              ? `${activeUpload.original_filename || 'Latest upload'} / ${valueLabel(activeUpload.processing_status)}`
              : completedExtractionCount
                ? `${completedExtractionCount} completed extraction${completedExtractionCount === 1 ? '' : 's'}. Ready for next material.`
                : 'No material uploaded yet.'}
          </div>
          {activeExtractionSummary?.warnings?.length ? (
            <div className="rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#9a3412] lg:col-span-2">
              {activeExtractionSummary.warnings.slice(0, 2).join(' ')}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <ModalShell
        open={pipelineModalOpen}
        onOpenChange={setPipelineModalOpen}
        title="Syllabus Extraction Pipeline"
        description="Move material from upload to structured review and approved topic maps."
        className="max-w-4xl"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setPipelineModalOpen(false)} disabled={busy} className="h-8 rounded-[5px] text-[12px]">Close</Button>
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={uploadMaterial}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Extract to Review
            </Button>
          </>
        )}
      >
        <div className="grid max-h-[74vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-4">
            {activePipelineSteps.map((step, index) => (
              <div key={step.id} className="relative">
                {index < activePipelineSteps.length - 1 ? <span className={`absolute left-[2rem] right-[-0.75rem] top-5 hidden h-0.5 md:block ${step.state === 'complete' ? 'bg-[#16a34a]' : 'bg-[#dbe3ee]'}`} /> : null}
                <div className="relative grid gap-2 rounded-[8px] border border-[#e2e8f0] bg-white p-3">
                  <span className={`grid size-10 place-items-center rounded-full border text-[12px] font-bold ${step.state === 'complete' ? 'border-[#16a34a] bg-[#16a34a] text-white' : step.state === 'active' ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]' : step.state === 'failed' ? 'border-[#dc2626] bg-[#fef2f2] text-[#b91c1c]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                    {step.state === 'complete' ? <Check className="size-4" /> : step.state === 'failed' ? <X className="size-4" /> : index + 1}
                  </span>
                  <div>
                    <div className="text-[12px] font-bold text-[#111827]">{step.label}</div>
                    <div className="mt-1 min-h-[34px] text-[11px] leading-5 text-[#64748b]">{step.detail}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="grid gap-3 rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] p-4">
              <div className="flex items-center gap-2 text-[12px] font-bold text-[#111827]">
                <Upload className="size-4" />
                Upload Material
              </div>
              <select className={selectClassName()} value={uploadForm.curriculum_id} onChange={(event) => setUploadForm({ ...uploadForm, curriculum_id: event.target.value })}>
                <option value="">Curriculum</option>
                {setup.curricula?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={selectClassName()} value={uploadForm.grade_id} onChange={(event) => setUploadForm({ ...uploadForm, grade_id: event.target.value })}>
                  <option value="">Year level</option>
                  {setup.grades?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <select className={selectClassName()} value={uploadForm.subject_id} onChange={(event) => setUploadForm({ ...uploadForm, subject_id: event.target.value })}>
                  <option value="">Subject</option>
                  {setup.subjects?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={selectClassName()} value={uploadForm.academic_year_id} onChange={(event) => setUploadForm({ ...uploadForm, academic_year_id: event.target.value })}>
                  <option value="">Academic year</option>
                  {setup.academic_years?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <select className={selectClassName()} value={uploadForm.term_id} onChange={(event) => setUploadForm({ ...uploadForm, term_id: event.target.value })}>
                  <option value="">Term</option>
                  {setup.terms?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </div>
              <select className={selectClassName()} value={uploadForm.material_type} onChange={(event) => setUploadForm({ ...uploadForm, material_type: event.target.value })}>
                {materialTypes.map((row) => <option key={row} value={row}>{valueLabel(row)}</option>)}
              </select>
              <input
                type="file"
                accept={supportedSyllabusTypes}
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                className="block w-full text-[12px] font-medium text-[#475569] file:mr-3 file:h-8 file:rounded-[5px] file:border-0 file:bg-[#111827] file:px-3 file:text-[12px] file:font-bold file:text-white"
              />
              <textarea
                value={uploadText}
                onChange={(event) => setUploadText(event.target.value)}
                placeholder="Paste syllabus text when a file is not available."
                className="min-h-[110px] rounded-[5px] border border-[#d9dce3] bg-white px-3 py-2 text-[12px] leading-5 text-[#111827] outline-none focus:border-[#111827]"
              />
            </div>

            <div className="grid content-start gap-3">
              <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
                <div className="flex items-center gap-2 text-[12px] font-bold text-[#111827]">
                  <FileText className="size-4 text-[#2563eb]" />
                  Current Material
                </div>
                <div className="mt-3 text-[13px] font-semibold leading-5 text-[#111827]">{activeUpload?.original_filename || (completedExtractionCount ? 'Ready for next upload' : 'Awaiting upload')}</div>
                <div className="mt-2 text-[11px] font-medium leading-5 text-[#64748b]">
                  {activeUpload ? `${Number(activeUpload.extracted_items || review?.items?.length || 0)} extracted item${Number(activeUpload.extracted_items || review?.items?.length || 0) === 1 ? '' : 's'} / ${Number(activeUpload.pending_items || 0)} pending review` : 'Choose a file or paste text to begin extraction.'}
                </div>
              </div>
              {activeExtractionSummary?.warnings?.length ? (
                <div className="rounded-[8px] border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] font-semibold leading-5 text-[#9a3412]">
                  {activeExtractionSummary.warnings.slice(0, 3).join(' ')}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </ModalShell>

      <SectionCard title="Uploaded Material" subtitle="Every uploaded file stays in review until a teacher or leader approves the extracted syllabus items.">
        <PortalTable
          rows={uploads}
          columns={[
            { key: 'original_filename', label: 'Material' },
            { key: 'material_type', label: 'Type', render: (row) => valueLabel(row.material_type) },
            { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
            { key: 'grade_name', label: 'Year', render: (row) => row.grade_name || '-' },
            { key: 'processing_status', label: 'Pipeline', render: (row) => statusChip(row.processing_status) },
            { key: 'items', label: 'Items', render: (row) => `${Number(row.extracted_items || 0)} total / ${Number(row.pending_items || 0)} pending` },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <div className="flex gap-2">
                  <button type="button" className="text-[11px] font-bold text-[#2563eb]" onClick={(event) => { event.stopPropagation(); openReview(row.id) }}>Review</button>
                  {documentForUpload(row) ? (
                    <button type="button" className="text-[11px] font-bold text-[#166534]" onClick={(event) => { event.stopPropagation(); navigate(`/syllabus/create/${documentForUpload(row)?.id}`) }}>Open document</button>
                  ) : null}
                  <button type="button" className="text-[11px] font-bold text-[#475569]" onClick={(event) => { event.stopPropagation(); api.processSyllabusUpload(token, row.id).then(() => openReview(row.id)).then(load).catch((err: any) => toast.error(err?.message || 'Unable to reprocess material.')) }}>Reprocess</button>
                  {canDeleteSyllabusUpload(user, row) ? (
                    <button type="button" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b91c1c]" disabled={busy} onClick={(event) => { event.stopPropagation(); deleteSyllabusUpload(row) }}>
                      <Trash2 className="size-3" />
                      Delete
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
          emptyMessage="No uploaded material has been extracted yet."
        />
      </SectionCard>

      <SectionCard
        title="Syllabus Documents"
        subtitle="Create a blank syllabus document from scratch or build one from an import. Uploading material is optional."
        actions={(
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/syllabus/create')}>
            <Plus className="size-3.5" />
            New blank document
          </Button>
        )}
      >
        <PortalTable
          rows={manualEntries}
          columns={[
            { key: 'topic_name', label: 'Syllabus Document' },
            { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
            { key: 'grade_name', label: 'Year', render: (row) => row.grade_name || '-' },
            {
              key: 'structure',
              label: 'Structure',
              render: (row) => `${(row.syllabus_map?.topics?.length || row.syllabus_map?.subtopics?.length || 0)} topics / ${row.success_criteria_count || 0} criteria / ${row.success_criteria_tag_count || row.success_criteria_count || 0} tags`,
            },
            { key: 'submitted_by_name', label: 'Owner', render: (row) => row.submitted_by_name || '-' },
            { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-[11px] font-bold text-[#2563eb]"
                    onClick={(event) => { event.stopPropagation(); navigate(`/syllabus/create/${row.id}`) }}
                  >
                    {canReviewManualEntries && row.status === 'pending_review' ? 'Review' : 'Open'}
                  </button>
                  {canDeleteSyllabusDocument(user, row) ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b91c1c]"
                      disabled={busy}
                      onClick={(event) => { event.stopPropagation(); deleteSyllabusDocument(row) }}
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
          emptyMessage={loading ? 'Loading syllabus documents...' : 'No syllabus documents yet. Create a blank document without importing a file.'}
        />
        {manualEntries.length ? (
          <div className="grid gap-2 border-t border-[#e2e8f0] p-4">
            {manualEntries.slice(0, 3).map((entry) => (
              <div key={entry.id} className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] font-bold text-[#111827]">{entry.topic_name}</div>
                  <div className="text-[11px] font-semibold text-[#64748b]">{entry.subject_name} / {entry.grade_name}</div>
                </div>
                <div className="mt-2 grid gap-1">
                  {(entry.syllabus_map?.topics?.length ? entry.syllabus_map.topics : entry.syllabus_map?.subtopics || []).slice(0, 4).map((topic: any) => (
                    <div key={topic.title} className="text-[12px] text-[#475569]">
                      <span className="font-semibold text-[#111827]">{topic.title}</span>
                      {topic.subtopics?.length ? <span> / {topic.subtopics.slice(0, 2).map((subtopic: any) => subtopic.title).join(', ')}</span> : null}
                      {!topic.subtopics?.length && topic.criteria?.length ? <span> / {topic.criteria.slice(0, 2).map((criterion: any) => criterion.text).join(', ')}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      {review ? (
        <SectionCard title={`Review: ${review.upload?.original_filename}`} subtitle={review.upload?.error_message || 'Approve, edit, reject, or merge extracted syllabus items.'}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] p-3">
            <div>
              <div className="text-[12px] font-semibold text-[#64748b]">{review.items?.length || 0} extracted items</div>
              {selectedReviewItems.length ? (
                <div className="mt-0.5 text-[11px] font-bold text-[#111827]">{selectedReviewItems.length} selected for approval</div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeReviewDocument ? (
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate(`/syllabus/create/${activeReviewDocument.id}`)}>
                  <BookOpenText className="size-3.5" />
                  Open Document
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={busy || !pendingReviewItems.length} onClick={selectPendingReviewItems}>
                Select Reviewable
              </Button>
              {selectedReviewItems.length ? (
                <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={approveSelectedItems}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  Approve Selected
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => api.processSyllabusUpload(token, review.upload.id).then(() => openReview(review.upload.id))}><RotateCcw className="size-3.5" /> Reprocess</Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={approveHighConfidence}><Check className="size-3.5" /> Approve High Confidence</Button>
            </div>
          </div>
          {editingItem ? (
            <div className="grid gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold text-[#111827]">Edit extracted {valueLabel(editingItem.item_type)}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-[#64748b]">Changes are saved before approval and publish.</div>
                </div>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setEditingItem(null)}>
                  <X className="size-3.5" />
                  Cancel
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_150px]">
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Title
                  <Input className="h-8 text-[12px]" value={itemForm.title} onChange={(event) => setItemForm({ ...itemForm, title: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Week
                  <Input className="h-8 text-[12px]" type="number" min={1} value={itemForm.suggested_week} onChange={(event) => setItemForm({ ...itemForm, suggested_week: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Exam relevance
                  <select className={selectClassName()} value={itemForm.exam_relevance} onChange={(event) => setItemForm({ ...itemForm, exam_relevance: event.target.value })}>
                    <option value="">Not set</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                Description
                <textarea className="min-h-[70px] rounded-[5px] border border-[#d9dce3] bg-white px-3 py-2 text-[12px] leading-5 text-[#111827] outline-none focus:border-[#111827]" value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                Keywords
                <Input className="h-8 text-[12px]" value={itemForm.keywords} onChange={(event) => setItemForm({ ...itemForm, keywords: event.target.value })} placeholder="comma separated" />
              </label>
              <Button type="button" className="h-8 justify-self-start rounded-[5px] px-3 text-[12px]" disabled={busy || !itemForm.title.trim()} onClick={saveItemEdit}>
                <Save className="size-3.5" />
                Save edits
              </Button>
            </div>
          ) : null}
          <PortalTable
            rows={review.items || []}
            columns={[
              {
                key: 'select',
                label: 'Select',
                className: 'w-12',
                render: (row) => (
                  <input
                    type="checkbox"
                    className="size-4 rounded border-[#cbd5e1] accent-[#111827]"
                    checked={selectedReviewIds.includes(String(row.id))}
                    disabled={row.status !== 'pending_review'}
                    aria-label={`Select ${row.title || valueLabel(row.item_type)}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleReviewSelection(row)}
                  />
                ),
              },
              { key: 'item_type', label: 'Type', render: (row) => valueLabel(row.item_type) },
              { key: 'title', label: 'Title' },
              { key: 'confidence', label: 'Confidence', render: (row) => <span className={row.low_confidence ? 'rounded-[4px] bg-[#fff7ed] px-2 py-1 text-[11px] font-bold text-[#9a3412]' : 'text-[12px] font-semibold text-[#166534]'}>{Math.round(Number(row.confidence || 0) * 100)}%</span> },
              { key: 'suggested_week', label: 'Week', render: (row) => row.suggested_week || '-' },
              { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
              {
                key: 'actions',
                label: 'Actions',
                render: (row) => (
                  <div className="flex gap-2">
                    <button type="button" className="text-[11px] font-bold text-[#2563eb]" disabled={row.status !== 'pending_review'} onClick={(event) => { event.stopPropagation(); startEditingItem(row) }}>Edit</button>
                    <button type="button" className="text-[11px] font-bold text-[#166534]" disabled={row.status !== 'pending_review'} onClick={(event) => { event.stopPropagation(); approveItem(row) }}>Approve</button>
                    <button type="button" className="text-[11px] font-bold text-[#b91c1c]" disabled={row.status !== 'pending_review'} onClick={(event) => { event.stopPropagation(); rejectItem(row) }}>Reject</button>
                  </div>
                ),
              },
            ]}
            emptyMessage="No extracted items found."
          />
        </SectionCard>
      ) : null}
    </div>
  )

  const renderTopics = () => (
    <SectionCard title="Approved Topic Map" subtitle="Only approved topics and approved questions can feed Daily Drills.">
      <div className="flex items-center gap-2 border-b border-[#e2e8f0] p-3">
        <Search className="size-3.5 text-[#94a3b8]" />
        <Input className="h-8 max-w-sm text-[12px]" placeholder="Search topic map" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <PortalTable
        rows={filteredTopics}
        columns={[
          { key: 'grade_name', label: 'Grade' },
          { key: 'subject_name', label: 'Subject' },
          { key: 'topic_name', label: 'Topic' },
          { key: 'parent_topic_name', label: 'Parent', render: (row) => row.parent_topic_name || '-' },
          { key: 'approved_question_count', label: 'Approved Qs', render: (row) => row.approved_question_count || 0 },
          { key: 'source_type', label: 'Source', render: (row) => valueLabel(row.source_type) },
        ]}
        emptyMessage="No approved syllabus topics yet."
      />
    </SectionCard>
  )

  const renderQuestions = () => (
    <SectionCard title="Question Bank" subtitle="A question must be approved, tagged, answered, and explained before students can use it.">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] p-3">
        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <Search className="size-3.5 text-[#94a3b8]" />
          <Input className="h-8 max-w-sm text-[12px]" placeholder="Search questions" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/questions/bank')}>
          <BookOpenText className="size-3.5" />
          View Question Bank
        </Button>
      </div>
      <PortalTable
        rows={filteredQuestions}
        columns={[
          { key: 'question_text', label: 'Question' },
          { key: 'grade_name', label: 'Grade' },
          { key: 'subject_name', label: 'Subject' },
          { key: 'topic_name', label: 'Topic' },
          { key: 'difficulty', label: 'Difficulty', render: (row) => valueLabel(row.difficulty) },
          { key: 'approval_status', label: 'Status', render: (row) => statusChip(row.approval_status) },
          {
            key: 'actions',
            label: 'Actions',
            render: (row) => (
              <div className="flex gap-2">
                <button type="button" className="text-[11px] font-bold text-[#166534]" onClick={(event) => { event.stopPropagation(); approveQuestion(row) }}>Approve</button>
                <button type="button" className="text-[11px] font-bold text-[#b91c1c]" onClick={(event) => { event.stopPropagation(); rejectQuestion(row) }}>Reject</button>
              </div>
            ),
          },
        ]}
        emptyMessage="No questions found."
      />
    </SectionCard>
  )

  const renderGenerator = () => (
    <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
      <SectionCard title="Generate Draft Questions" subtitle={ai?.available ? `${ai.provider} / ${ai.model}` : ai?.message || AI_NOT_CONFIGURED_MESSAGE}>
        <div className="grid gap-3 p-4">
          <select className={selectClassName()} value={draftForm.grade_id} onChange={(event) => setDraftForm({ ...draftForm, grade_id: event.target.value, topic_id: '' })}>
            <option value="">Grade/Form</option>
            {setup.grades?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className={selectClassName()} value={draftForm.subject_id} onChange={(event) => setDraftForm({ ...draftForm, subject_id: event.target.value, topic_id: '' })}>
            <option value="">Subject</option>
            {setup.subjects?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className={selectClassName()} value={draftForm.topic_id} onChange={(event) => setDraftForm({ ...draftForm, topic_id: event.target.value })}>
            <option value="">Approved topic</option>
            {generatorTopics.map((row: any) => <option key={row.id} value={row.id}>{row.topic_name}</option>)}
          </select>
          <select className={selectClassName()} value={draftForm.question_type} onChange={(event) => setDraftForm({ ...draftForm, question_type: event.target.value })}>
            {['mixed', 'multiple_choice', 'true_false', 'short_answer', 'structured', 'essay'].map((row) => <option key={row} value={row}>{valueLabel(row)}</option>)}
          </select>
          <select className={selectClassName()} value={draftForm.difficulty} onChange={(event) => setDraftForm({ ...draftForm, difficulty: event.target.value })}>
            {['easy', 'medium', 'hard'].map((row) => <option key={row} value={row}>{valueLabel(row)}</option>)}
          </select>
          <Input type="number" min={1} max={20} className="h-8 text-[12px]" value={draftForm.number_of_questions} onChange={(event) => setDraftForm({ ...draftForm, number_of_questions: event.target.value })} />
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={generateDrafts}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Generate Pending Drafts
          </Button>
        </div>
      </SectionCard>
      <SectionCard title="Draft Review" subtitle="AI drafts stay pending until a teacher approves them.">
        {batch?.batch?.id ? (
          <div className="flex items-center justify-between gap-2 border-b border-[#e2e8f0] p-3">
            <div className="min-w-0">
              <div className="text-[12px] font-bold text-[#111827]">{batch.batch.topic_name || 'Generated batch'}</div>
              <div className="text-[11px] font-medium text-[#64748b]">{batch.questions?.length || 0} draft question{Number(batch.questions?.length || 0) === 1 ? '' : 's'} ready for document review</div>
            </div>
            <Button type="button" variant="outline" className="h-8 shrink-0 rounded-[5px] text-[12px]" onClick={() => navigate(`/questions/batches/${batch.batch.id}`)}>
              <BookOpenText className="size-3.5" />
              View Batch
            </Button>
          </div>
        ) : null}
        <PortalTable
          rows={batch?.questions || questions.filter((row) => row.approval_status === 'pending_review').slice(0, 50)}
          columns={[
            { key: 'question_text', label: 'Question' },
            { key: 'question_type', label: 'Type', render: (row) => valueLabel(row.question_type) },
            { key: 'difficulty', label: 'Difficulty', render: (row) => valueLabel(row.difficulty) },
            { key: 'approval_status', label: 'Status', render: (row) => statusChip(row.approval_status) },
            { key: 'actions', label: 'Actions', render: (row) => <div className="flex gap-2"><button type="button" className="text-[11px] font-bold text-[#166534]" onClick={(event) => { event.stopPropagation(); approveQuestion(row) }}>Approve</button><button type="button" className="text-[11px] font-bold text-[#b91c1c]" onClick={(event) => { event.stopPropagation(); rejectQuestion(row) }}>Reject</button></div> },
          ]}
          emptyMessage="No draft questions are waiting for review."
        />
      </SectionCard>
    </div>
  )

  const renderDrillModal = () => {
    if (!drillModalOpen) return null
    const targetType = drillForm.target_type || 'student'
    const selectedStudent = students.find((student: any) => String(student.id) === String(drillForm.student_id))
    const selectedClass = classes.find((classRow: any) => String(classRow.id) === String(drillForm.class_id))
    const selectedSubject = setup.subjects?.find((subject: any) => String(subject.id) === String(drillForm.subject_id))
    const selectedTopic = topics.find((topic: any) => String(topic.id) === String(drillForm.topic_id))
    const drillTopics = topics.filter((topic) => !drillForm.subject_id || String(topic.subject_id) === String(drillForm.subject_id))
    const selectedClassStudentCount = selectedClass ? students.filter((student: any) => (
      String(student.class_id || '') === String(selectedClass.id)
      || String(student.class_name || '') === String(selectedClass.name || selectedClass.class_name || '')
    )).length : 0
    const modalSelectClass = 'h-10 w-full rounded-[6px] border border-[#d9dce3] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/5'
    const submitLabel = targetType === 'class' ? 'Create class drills' : 'Create student drill'
    const targetReady = targetType === 'class' ? Boolean(drillForm.class_id) : Boolean(drillForm.student_id)
    const targetLabel = targetType === 'class'
      ? selectedClass?.name || selectedClass?.class_name || 'No class selected'
      : selectedStudent ? `${selectedStudent.first_name || ''} ${selectedStudent.last_name || ''}`.trim() : 'No student selected'
    const targetContext = targetType === 'class'
      ? selectedClass ? `${selectedClassStudentCount || 'All active'} learner${selectedClassStudentCount === 1 ? '' : 's'}` : 'Select a class to continue'
      : selectedStudent?.class_name || 'Select a student to continue'

    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/55 px-4 py-5">
        <section role="dialog" aria-modal="true" aria-labelledby="daily-drill-dialog-title" aria-describedby="daily-drill-dialog-description" className="flex max-h-[calc(100vh-40px)] w-full max-w-[800px] flex-col overflow-hidden rounded-[8px] border border-[#d9dce3] bg-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.85)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e5e7eb] px-6 py-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[7px] border border-[#d9dce3] bg-[#f8fafc] text-[#334155]">
                <ClipboardCheck className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#64748b]">Assessment workflow</div>
                <h2 id="daily-drill-dialog-title" className="mt-1 text-[20px] font-semibold tracking-[-0.025em] text-[#111827]">Create daily drill</h2>
                <p id="daily-drill-dialog-description" className="mt-1 text-[12px] leading-5 text-[#64748b]">Define the audience and curriculum scope. Only approved question-bank items will be used.</p>
              </div>
            </div>
            <button type="button" className="grid size-8 shrink-0 place-items-center rounded-[6px] text-[#64748b] transition hover:bg-[#f3f4f6] hover:text-[#111827]" onClick={() => setDrillModalOpen(false)} aria-label="Close drill setup">
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_250px]">
              <div className="grid content-start gap-6">
                <section className="grid gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#64748b]">01 · Audience</div>
                    <p className="mt-1 text-[12px] text-[#64748b]">Choose who will receive this drill.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Drill audience">
                  {[
                    { id: 'student', label: 'Individual student', detail: 'One drill assigned to a selected learner.', icon: UserRound },
                    { id: 'class', label: 'Entire class', detail: 'A drill for every active learner in a class.', icon: Users },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={targetType === option.id}
                      className={`flex min-h-[86px] items-start gap-3 rounded-[7px] border p-3 text-left transition ${targetType === option.id ? 'border-[#111827] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)]' : 'border-[#d9dce3] bg-[#fafafa] hover:border-[#aeb4be] hover:bg-white'}`}
                      onClick={() => setDrillForm({ ...drillForm, target_type: option.id })}
                    >
                      <span className={`grid size-8 shrink-0 place-items-center rounded-[6px] border ${targetType === option.id ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#d9dce3] bg-white text-[#64748b]'}`}><option.icon className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[#111827]">{option.label}<span className={`grid size-4 place-items-center rounded-full border ${targetType === option.id ? 'border-[#111827]' : 'border-[#cbd5e1]'}`}>{targetType === option.id ? <span className="size-2 rounded-full bg-[#111827]" /> : null}</span></span><span className="mt-1 block text-[11px] leading-4 text-[#64748b]">{option.detail}</span></span>
                    </button>
                  ))}
                  </div>

                  {targetType === 'class' ? (
                    <label className="grid gap-1.5 text-[12px] font-semibold text-[#334155]">
                      Class
                      <select className={modalSelectClass} value={drillForm.class_id} onChange={(event) => setDrillForm({ ...drillForm, class_id: event.target.value })}>
                        <option value="">Select class</option>
                        {classes.map((row: any) => <option key={row.id} value={row.id}>{row.name || row.class_name || `Class ${row.id}`}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="grid gap-1.5 text-[12px] font-semibold text-[#334155]">
                      Student
                      <select className={modalSelectClass} value={drillForm.student_id} onChange={(event) => setDrillForm({ ...drillForm, student_id: event.target.value })}>
                        <option value="">Select student</option>
                        {students.map((row: any) => (
                          <option key={row.id} value={row.id}>
                            {`${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Student'}{row.class_name ? ` - ${row.class_name}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </section>

                <section className="grid gap-3 border-t border-[#e5e7eb] pt-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#64748b]">02 · Curriculum scope</div>
                    <p className="mt-1 text-[12px] text-[#64748b]">Leave either field on automatic to use current learning evidence.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-[12px] font-semibold text-[#334155]">
                      Subject
                      <select className={modalSelectClass} value={drillForm.subject_id} onChange={(event) => setDrillForm({ ...drillForm, subject_id: event.target.value, topic_id: '' })}>
                        <option value="">Automatic selection</option>
                        {setup.subjects?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-[12px] font-semibold text-[#334155]">
                      Topic
                      <select className={modalSelectClass} value={drillForm.topic_id} onChange={(event) => setDrillForm({ ...drillForm, topic_id: event.target.value })}>
                        <option value="">Automatic selection</option>
                        {drillTopics.map((row: any) => <option key={row.id} value={row.id}>{row.topic_name}</option>)}
                      </select>
                    </label>
                  </div>
                </section>
              </div>

              <aside className="self-start overflow-hidden rounded-[7px] border border-[#d9dce3] bg-[#fafafa]">
                <div className="border-b border-[#e5e7eb] bg-white px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#64748b]">Drill brief</div>
                  <p className="mt-1 text-[12px] leading-5 text-[#64748b]">Review the assignment before creating it.</p>
                </div>
                <dl className="grid gap-0 px-4 py-1 text-[12px]">
                  <div className="border-b border-[#e5e7eb] py-3"><dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#94a3b8]">Audience</dt><dd className="mt-1 font-semibold text-[#111827]">{targetType === 'class' ? 'Entire class' : 'Individual student'}</dd><dd className="mt-0.5 leading-4 text-[#64748b]">{targetLabel} · {targetContext}</dd></div>
                  <div className="border-b border-[#e5e7eb] py-3"><dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#94a3b8]">Subject</dt><dd className="mt-1 font-semibold text-[#111827]">{selectedSubject?.name || 'Selected automatically'}</dd></div>
                  <div className="border-b border-[#e5e7eb] py-3"><dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#94a3b8]">Topic</dt><dd className="mt-1 font-semibold text-[#111827]">{selectedTopic?.topic_name || 'Selected automatically'}</dd></div>
                  <div className="py-3"><dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#94a3b8]">Question source</dt><dd className="mt-1 flex items-center gap-1.5 font-semibold text-[#166534]"><ShieldCheck className="size-3.5" />Approved bank only</dd></div>
                </dl>
              </aside>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#fafafa] px-6 py-4">
            <div className="flex items-center gap-2 text-[11px] text-[#64748b]"><ShieldCheck className="size-3.5 text-[#475569]" />Draft and unapproved questions are excluded.</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-[6px] px-4 text-[12px]" disabled={busy} onClick={() => setDrillModalOpen(false)}>Cancel</Button>
              <Button type="button" className="h-9 rounded-[6px] border-[#111827] bg-[#111827] px-4 text-[12px] text-white hover:border-[#1f2937] hover:bg-[#1f2937]" disabled={busy || !targetReady} onClick={generateDrill}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}
                {busy ? 'Creating drill…' : submitLabel}
              </Button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const renderDrills = () => (
    <div className="grid gap-3">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#dbe1ea] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.6)]">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-[#111827]">Daily Drill Planning</div>
          <div className="mt-1 text-[12px] font-medium text-[#64748b]">{students.length} student{students.length === 1 ? '' : 's'} available / {questions.filter((row) => row.approval_status === 'approved').length} approved question{questions.filter((row) => row.approval_status === 'approved').length === 1 ? '' : 's'}</div>
        </div>
        <Button type="button" className="h-9 rounded-[7px] text-[12px]" disabled={busy} onClick={() => setDrillModalOpen(true)}>
          <ClipboardCheck className="size-3.5" />
          Create Drill
        </Button>
      </section>

      <SectionCard title="Recent Drill Sessions" subtitle="Student attempts and marking roll into topic mastery.">
        <PortalTable
          rows={drillSessions}
          columns={[
            { key: 'student', label: 'Student', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '-' },
            { key: 'class_name', label: 'Class', render: (row) => row.class_name || '-' },
            { key: 'topic_name', label: 'Topic', render: (row) => row.topic_name || '-' },
            { key: 'scheduled_date', label: 'Date', render: (row) => row.scheduled_date || '-' },
            { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
            { key: 'percentage', label: 'Score', render: (row) => row.percentage === null || row.percentage === undefined ? '-' : `${Number(row.percentage || 0).toFixed(1)}%` },
          ]}
          emptyMessage="Generate a drill to begin."
        />
      </SectionCard>
      {renderDrillModal()}
    </div>
  )

  const renderInsights = () => (
    <div className="grid gap-3">
      <SectionCard title="Teacher Drill Insights" subtitle={insights?.insight || 'Select a class and refresh insights.'}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] p-3">
          <select className={`${selectClassName()} w-56`} value={insightClassId} onChange={(event) => setInsightClassId(event.target.value)}>
            {classes.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={loadInsights}><RotateCcw className="size-3.5" /> Refresh</Button>
        </div>
        {insights ? (
          <div className="grid gap-3 p-4">
            <SectionKpiStrip items={[
              { label: 'Sessions', value: insights.summary?.sessions || 0, helper: 'drills', delta: 'visible class' },
              { label: 'Completion', value: `${insights.summary?.completion_rate || 0}%`, helper: 'completed', delta: 'weekly pattern' },
              { label: 'Average', value: insights.summary?.average_score === null ? '-' : `${insights.summary?.average_score}%`, helper: 'score', delta: 'objective marks' },
              { label: 'Weak Topics', value: insights.weak_topics?.length || 0, helper: 'topics', delta: 'reteach queue', tone: insights.weak_topics?.length ? 'warn' : 'good' },
            ]} />
            <PortalTable
              rows={insights.weak_topics || []}
              columns={[
                { key: 'subject_name', label: 'Subject' },
                { key: 'topic_name', label: 'Topic' },
                { key: 'weak_students', label: 'Students' },
                { key: 'average_mastery', label: 'Mastery', render: (row) => `${Number(row.average_mastery || 0).toFixed(1)}%` },
              ]}
              emptyMessage="No weak topics detected yet."
            />
            {insights.improvement_awards?.length ? (
              <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] p-3">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#166534]">
                  <Award className="size-4" />
                  Improvement Awards
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {insights.improvement_awards.map((row: any) => (
                    <div key={row.student_id} className="rounded-[5px] border border-[#dcfce7] bg-white px-3 py-2">
                      <div className="text-[12px] font-bold text-[#111827]">{row.student_name}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-[#166534]">{row.award} · +{Number(row.improvement_points || 0).toFixed(1)} points</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <PortalTable
              rows={insights.learner_profiles || []}
              columns={[
                { key: 'student_name', label: 'Student' },
                {
                  key: 'profile_label',
                  label: 'AI Pattern',
                  render: (row) => (
                    <span className={`rounded-[4px] border px-2 py-1 text-[11px] font-bold ${
                      row.profile_tone === 'good'
                        ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
                        : row.profile_tone === 'bad'
                          ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
                          : row.profile_tone === 'warn'
                            ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
                            : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
                    }`}>{row.profile_label}</span>
                  ),
                },
                { key: 'average_score', label: 'Average', render: (row) => row.average_score === null ? '-' : `${Number(row.average_score || 0).toFixed(1)}%` },
                { key: 'improvement_points', label: 'Improvement', render: (row) => row.improvement_points === null ? '-' : `${Number(row.improvement_points || 0) > 0 ? '+' : ''}${Number(row.improvement_points || 0).toFixed(1)}` },
                { key: 'evidence_summary', label: 'Evidence' },
                { key: 'recommended_teacher_action', label: 'Teacher Action' },
              ]}
              emptyMessage="Learner profiles appear after students complete Daily Drills."
            />
          </div>
        ) : null}
      </SectionCard>
    </div>
  )

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Daily Drills + Syllabus Intelligence</h1>
            <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{ai?.available ? `AI ready: ${ai.provider} / ${ai.model}` : ai?.message || AI_NOT_CONFIGURED_MESSAGE}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/syllabus/create')}>
              <Plus className="size-3.5" />
              New Syllabus Document
            </Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={loading || busy} onClick={load}><RotateCcw className="size-3.5" /> Refresh</Button>
          </div>
        </div>
      </section>

      <SectionKpiStrip items={[
        { label: 'Syllabus Docs', value: manualEntries.length, helper: 'grade-subject documents', delta: `${manualEntries.filter((row) => row.status === 'pending_review').length} pending` },
        { label: 'Pending Review', value: manualEntries.filter((row) => row.status === 'pending_review').length, helper: 'documents', delta: 'leadership queue' },
        { label: 'Approved Topics', value: topics.length, helper: 'topic map', delta: 'drill ready' },
        { label: 'Approved Questions', value: questions.filter((row) => row.approval_status === 'approved').length, helper: 'question bank', delta: `${questions.filter((row) => row.approval_status === 'pending_review').length} pending` },
        { label: 'AI Mode', value: ai?.available ? 'Ready' : 'Manual', helper: ai?.provider || 'none', delta: ai?.model || 'fallback', tone: ai?.available ? 'good' : 'warn' },
      ]} />

      <div className="flex gap-1 overflow-x-auto border-b border-[#e2e8f0]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`h-9 whitespace-nowrap border-b-2 px-3 text-[12px] font-semibold ${activeTab === tab.id ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#64748b]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <SmartLinkLoadingState label="Loading syllabus module" detail="Preparing documents, topic maps and question drafts." /> : null}
      {activeTab === 'uploads' ? renderUploads() : null}
      {activeTab === 'topics' ? renderTopics() : null}
      {activeTab === 'questions' ? renderQuestions() : null}
      {activeTab === 'generator' ? renderGenerator() : null}
      {activeTab === 'drills' ? renderDrills() : null}
      {activeTab === 'insights' ? renderInsights() : null}
    </div>
  )
}

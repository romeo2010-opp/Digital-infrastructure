import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  Archive,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  FlaskConical,
  ListChecks,
  Loader2,
  Play,
  Plus,
  Save,
  Search,
  ShieldAlert,
  Tags,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { usePortal } from '../lib/portalContext'

type LabSection = 'dashboard' | 'coverage' | 'upload' | 'questions' | 'tagging' | 'topic-map' | 'backtesting' | 'reports' | 'review'

const labTabs: Array<{ id: Exclude<LabSection, 'review'>; label: string; path: string; icon: any }> = [
  { id: 'dashboard', label: 'Dashboard', path: '/internal/exam-lab', icon: BarChart3 },
  { id: 'coverage', label: 'Coverage', path: '/internal/exam-lab/coverage', icon: ListChecks },
  { id: 'upload', label: 'Upload', path: '/internal/exam-lab/upload', icon: Upload },
  { id: 'questions', label: 'Questions', path: '/internal/exam-lab/questions', icon: FileSearch },
  { id: 'tagging', label: 'Tagging', path: '/internal/exam-lab/tagging', icon: Tags },
  { id: 'topic-map', label: 'Topic Map', path: '/internal/exam-lab/topic-map', icon: Database },
  { id: 'backtesting', label: 'Backtesting', path: '/internal/exam-lab/backtesting', icon: FlaskConical },
  { id: 'reports', label: 'Reports', path: '/internal/exam-lab/reports', icon: FileText },
]

const documentTypes = ['Question Paper', 'Mark Scheme', 'Syllabus', 'Examiner Report', 'Other']
const sourceQualities = ['Original PDF', 'Scanned PDF', 'Image', 'Manual']
const papers = ['Paper 1', 'Paper 2']
const difficulties = ['unknown', 'easy', 'medium', 'hard']
const questionTypes = ['structured', 'short_answer', 'calculation', 'proof', 'graph', 'construction', 'word_problem']

function sectionFromPath(pathname: string): LabSection {
  if (/\/papers\/[^/]+\/review$/.test(pathname)) return 'review'
  if (pathname.endsWith('/coverage')) return 'coverage'
  if (pathname.endsWith('/upload')) return 'upload'
  if (pathname.endsWith('/questions')) return 'questions'
  if (pathname.endsWith('/tagging')) return 'tagging'
  if (pathname.endsWith('/topic-map')) return 'topic-map'
  if (pathname.endsWith('/backtesting')) return 'backtesting'
  if (pathname.endsWith('/reports')) return 'reports'
  return 'dashboard'
}

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusChip(value: any) {
  const status = String(value || 'Missing')
  const tone = status === 'Verified' || status === 'Tagged' || status === 'Extracted' || status === 'extracted' || status === 'accepted'
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : status === 'Failed' || status === 'failed' || status === 'rejected'
      ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
      : status === 'Missing'
        ? 'border-[#e5e7eb] bg-[#f9fafb] text-[#6b7280]'
        : 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  return <span className={`inline-flex h-6 items-center rounded-[4px] border px-2 text-[11px] font-bold ${tone}`}>{valueLabel(status)}</span>
}

function selectClassName() {
  return 'h-9 rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] text-[#111827] outline-none focus:border-[#111827]'
}

function checkboxClassName() {
  return 'size-4 rounded border-[#d1d5db] text-[#111827]'
}

function fileToDataUrl(file: File, mimeType = file.type || 'text/plain') {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;]*;/, `data:${mimeType};`))
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}

function examMimeType(file: File) {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}

function numberValue(value: any, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function latestYear() {
  return new Date().getFullYear()
}

function LabField({ label, children }: { label: string; children: any }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
      {label}
      {children}
    </label>
  )
}

function Kpi({ label, value, detail }: { label: string; value: any; detail?: string }) {
  return (
    <div className="min-h-[96px] rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">{label}</div>
      <div className="mt-2 text-[26px] font-semibold tracking-[0] text-[#111827]">{value ?? '-'}</div>
      {detail ? <div className="mt-1 text-[12px] leading-5 text-[#64748b]">{detail}</div> : null}
    </div>
  )
}

function useQueryDefaults(setUploadForm: (updater: any) => void) {
  const location = useLocation()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (!params.toString()) return
    setUploadForm((current: any) => ({
      ...current,
      year: params.get('year') || current.year,
      paper: params.get('paper') || current.paper,
      document_type: params.get('document_type') || current.document_type,
    }))
  }, [location.search, setUploadForm])
}

export function ExamIntelligenceLabPage() {
  const { token, api, portalSyncEvent } = usePortal()
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const section = sectionFromPath(location.pathname)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dashboard, setDashboard] = useState<any>(null)
  const [coverage, setCoverage] = useState<any>({ rows: [] })
  const [topicMap, setTopicMap] = useState<any>({ topics: [], subtopics: [], skills: [] })
  const [questions, setQuestions] = useState<any[]>([])
  const [backtests, setBacktests] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [review, setReview] = useState<any>(null)
  const [questionSearch, setQuestionSearch] = useState('')
  const [selectedQuestionId, setSelectedQuestionId] = useState<any>(null)
  const [questionForm, setQuestionForm] = useState<any>({})
  const [topicForm, setTopicForm] = useState<any>({ name: '', description: '', syllabus_weight: 1, order_number: 0 })
  const [subtopicForm, setSubtopicForm] = useState<any>({ topic_id: '', name: '' })
  const [skillForm, setSkillForm] = useState<any>({ topic_id: '', subtopic_id: '', name: '' })
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [uploadForm, setUploadForm] = useState<any>({
    exam_board: 'MANEB',
    exam_level: 'MSCE',
    subject: 'Mathematics',
    paper: 'Paper 1',
    year: latestYear(),
    document_type: 'Question Paper',
    source_quality: 'Original PDF',
    notes: '',
    is_replacement: false,
    use_for_training: true,
    text_content: '',
  })
  const [manualForm, setManualForm] = useState<any>({
    exam_board: 'MANEB',
    exam_level: 'MSCE',
    subject: 'Mathematics',
    paper: 'Paper 1',
    year: latestYear(),
    question_number: '',
    question_text: '',
    marks: 0,
    difficulty: 'unknown',
  })
  const [backtestForm, setBacktestForm] = useState<any>({
    exam_board: 'MANEB',
    exam_level: 'MSCE',
    subject: 'Mathematics',
    paper: 'Paper 1',
    training_start_year: 2000,
    training_end_year: Math.max(2000, latestYear() - 2),
    test_year: Math.max(2001, latestYear() - 1),
    predicted_topic_count: 10,
    prediction_method: 'recency_frequency_marks',
    include_subtopics: true,
    include_mark_weight: true,
  })
  const [reportForm, setReportForm] = useState<any>({
    exam_board: 'MANEB',
    exam_level: 'MSCE',
    subject: 'Mathematics',
    paper: 'Paper 1',
    target_year: latestYear(),
  })

  useQueryDefaults(setUploadForm)

  const selectedQuestion = useMemo(
    () => questions.find((question) => String(question.id) === String(selectedQuestionId)) || questions[0] || null,
    [questions, selectedQuestionId],
  )

  const subtopicsForTopic = useMemo(
    () => topicMap.subtopics.filter((subtopic: any) => String(subtopic.topic_id) === String(questionForm.topic_id || selectedQuestion?.topic_id || '')),
    [questionForm.topic_id, selectedQuestion?.topic_id, topicMap.subtopics],
  )

  const skillsForSelection = useMemo(
    () => topicMap.skills.filter((skill: any) => {
      if (questionForm.topic_id && String(skill.topic_id) !== String(questionForm.topic_id)) return false
      if (questionForm.subtopic_id && skill.subtopic_id && String(skill.subtopic_id) !== String(questionForm.subtopic_id)) return false
      return true
    }),
    [questionForm.topic_id, questionForm.subtopic_id, topicMap.skills],
  )

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [dashboardPayload, coveragePayload, topicPayload, questionPayload, backtestPayload, reportPayload] = await Promise.all([
        api.getExamLabDashboard(token),
        api.getExamLabCoverage(token),
        api.getExamLabTopicMap(token),
        api.listExamLabQuestions(token, questionSearch ? { search: questionSearch } : {}),
        api.listExamLabBacktests(token),
        api.listExamLabPredictionReports(token),
      ])
      setDashboard(dashboardPayload)
      setCoverage(coveragePayload)
      setTopicMap(topicPayload)
      setQuestions(questionPayload?.questions || [])
      setBacktests(backtestPayload?.backtests || [])
      setReports(reportPayload?.reports || [])
      if (section === 'review' && params.paperId) {
        setReview(await api.getExamLabPaperReview(token, params.paperId))
      }
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load Exam Intelligence Lab.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, section, params.paperId])

  useEffect(() => {
    if (!selectedQuestion) return
    setQuestionForm({
      question_text: selectedQuestion.question_text || '',
      marks: selectedQuestion.marks || 0,
      topic_id: selectedQuestion.topic_id || '',
      subtopic_id: selectedQuestion.subtopic_id || '',
      skill_id: selectedQuestion.skill_id || '',
      difficulty: selectedQuestion.difficulty || 'unknown',
      question_type: selectedQuestion.question_type || 'structured',
      command_word: selectedQuestion.command_word || '',
      has_diagram: Boolean(selectedQuestion.has_diagram),
      has_graph: Boolean(selectedQuestion.has_graph),
      has_table: Boolean(selectedQuestion.has_table),
      notes: selectedQuestion.notes || '',
      tagging_confidence: selectedQuestion.tagging_confidence || 0.7,
      verified: Boolean(selectedQuestion.verified),
    })
  }, [selectedQuestion])

  const refreshLight = async () => {
    if (!token) return
    const [dashboardPayload, coveragePayload, questionPayload, topicPayload] = await Promise.all([
      api.getExamLabDashboard(token),
      api.getExamLabCoverage(token),
      api.listExamLabQuestions(token, questionSearch ? { search: questionSearch } : {}),
      api.getExamLabTopicMap(token),
    ])
    setDashboard(dashboardPayload)
    setCoverage(coveragePayload)
    setQuestions(questionPayload?.questions || [])
    setTopicMap(topicPayload)
  }

  useEffect(() => {
    if (!token || !portalSyncEvent?.pulse || !portalSyncEvent.resources?.includes('examLab')) return
    const refreshSyncedLab = async () => {
      try {
        await refreshLight()
        if (section === 'review' && params.paperId) {
          setReview(await api.getExamLabPaperReview(token, params.paperId))
        }
      } catch {
        // Keep the current lab view in place if a background sync misses.
      }
    }
    refreshSyncedLab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSyncEvent?.pulse])

  const submitUpload = async () => {
    if (!token) return
    if (!uploadFile && !String(uploadForm.text_content || '').trim()) {
      toast.error('Choose a file or paste manual text.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        ...uploadForm,
        exam_year: numberValue(uploadForm.year),
        file_name: uploadFile?.name || `manual-${uploadForm.year}-${uploadForm.paper}.txt`,
        file_type: uploadFile ? examMimeType(uploadFile) : 'text/plain',
        data_url: uploadFile ? await fileToDataUrl(uploadFile, examMimeType(uploadFile)) : undefined,
        text_content: uploadFile ? undefined : uploadForm.text_content,
      }
      const result = await api.uploadExamLabPaper(token, payload)
      setUploadResult(result)
      toast.success('Paper version uploaded.')
      await refreshLight()
    } catch (error: any) {
      toast.error(error?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const startExtraction = async (paperId: any, versionId?: any) => {
    if (!token || !paperId) return
    setBusy(true)
    try {
      const result = await api.startExamLabExtraction(token, paperId, versionId ? { version_id: versionId } : {})
      toast[result?.ok === false ? 'warning' : 'success'](result?.message || `Extraction ${result?.extraction_status || 'completed'}.`)
      navigate(`/internal/exam-lab/papers/${paperId}/review`)
      await load()
    } catch (error: any) {
      toast.error(error?.message || 'Extraction failed.')
    } finally {
      setBusy(false)
    }
  }

  const candidateAction = async (candidate: any, action: string) => {
    if (!token) return
    setBusy(true)
    try {
      if (action === 'accept') await api.acceptExamLabCandidate(token, candidate.id)
      else await api.updateExamLabCandidate(token, candidate.id, { action })
      toast.success(action === 'accept' ? 'Question accepted into the bank.' : 'Candidate updated.')
    } catch (error: any) {
      toast.error(error?.message || 'Candidate update failed.')
      setBusy(false)
      return
    }
    try {
      if (params.paperId) setReview(await api.getExamLabPaperReview(token, params.paperId))
      await refreshLight()
    } catch {
      toast.warning('Saved, but the refreshed data is still catching up.')
    } finally {
      setBusy(false)
    }
  }

  const saveQuestion = async (extra: any = {}) => {
    if (!token || !selectedQuestion) return
    setBusy(true)
    try {
      await api.updateExamLabQuestion(token, selectedQuestion.id, { ...questionForm, ...extra, confirm_verified_replace: true })
      toast.success(extra.verified ? 'Question verified.' : 'Question saved.')
    } catch (error: any) {
      toast.error(error?.message || 'Question save failed.')
      setBusy(false)
      return
    }
    try {
      await refreshLight()
    } catch {
      toast.warning('Saved, but the refreshed data is still catching up.')
    } finally {
      setBusy(false)
    }
  }

  const saveAndNext = async () => {
    await saveQuestion()
    const index = questions.findIndex((question) => String(question.id) === String(selectedQuestion?.id))
    const next = questions[index + 1] || questions[0]
    if (next) setSelectedQuestionId(next.id)
  }

  const submitManualQuestion = async () => {
    if (!token) return
    setBusy(true)
    try {
      await api.createExamLabQuestion(token, { ...manualForm, exam_year: numberValue(manualForm.year) })
      toast.success('Manual question created.')
      setManualForm((current: any) => ({ ...current, question_number: '', question_text: '', marks: 0 }))
      await refreshLight()
    } catch (error: any) {
      toast.error(error?.message || 'Manual question could not be created.')
    } finally {
      setBusy(false)
    }
  }

  const saveTopicMapItem = async (type: 'topic' | 'subtopic' | 'skill') => {
    if (!token) return
    setBusy(true)
    try {
      if (type === 'topic') {
        await api.saveExamLabTopic(token, topicForm)
        setTopicForm({ name: '', description: '', syllabus_weight: 1, order_number: 0 })
      }
      if (type === 'subtopic') {
        await api.saveExamLabSubtopic(token, subtopicForm)
        setSubtopicForm({ topic_id: subtopicForm.topic_id, name: '' })
      }
      if (type === 'skill') {
        await api.saveExamLabSkill(token, skillForm)
        setSkillForm({ topic_id: skillForm.topic_id, subtopic_id: skillForm.subtopic_id, name: '' })
      }
      toast.success('Topic map saved.')
      setTopicMap(await api.getExamLabTopicMap(token))
    } catch (error: any) {
      toast.error(error?.message || 'Topic map save failed.')
    } finally {
      setBusy(false)
    }
  }

  const runBacktest = async () => {
    if (!token) return
    setBusy(true)
    try {
      const result = await api.runExamLabBacktest(token, backtestForm)
      toast.success(`Backtest complete: ${result?.result?.marks_coverage || 0}% marks coverage.`)
      setBacktests((await api.listExamLabBacktests(token))?.backtests || [])
      setDashboard(await api.getExamLabDashboard(token))
    } catch (error: any) {
      toast.error(error?.message || 'Backtest failed.')
    } finally {
      setBusy(false)
    }
  }

  const generateReport = async () => {
    if (!token) return
    setBusy(true)
    try {
      const result = await api.generateExamLabPredictionReport(token, reportForm)
      toast.success(result?.report?.title || 'Prediction report generated.')
      setReports((await api.listExamLabPredictionReports(token))?.reports || [])
    } catch (error: any) {
      toast.error(error?.message || 'Report generation failed.')
    } finally {
      setBusy(false)
    }
  }

  const markCoverageUnavailable = async (row: any) => {
    if (!token) return
    const notes = window.prompt(`Notes for ${row.year}`, row.notes || 'Paper unavailable or still being searched for.')
    if (notes === null) return
    setBusy(true)
    try {
      await api.updateExamLabCoverageNote(token, { year: row.year, status: 'unavailable', notes })
      toast.success('Coverage note saved.')
      setCoverage(await api.getExamLabCoverage(token))
    } catch (error: any) {
      toast.error(error?.message || 'Coverage note failed.')
    } finally {
      setBusy(false)
    }
  }

  const renderHeader = () => (
    <div className="border-b border-[#dbe3ee] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
              <span>Internal SmartLink Research Tool</span>
              <span className="rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-2 py-1 text-[#b91c1c]">Super Admin</span>
            </div>
            <h1 className="mt-2 text-[28px] font-semibold tracking-[0] text-[#0f172a]">SmartLink Exam Intelligence Lab</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-6 text-[#64748b]">
              Build a clean MANEB Mathematics dataset from past papers, review extraction failures, tag topics, protect quality, and backtest revision-priority forecasts.
            </p>
          </div>
          <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={load} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
            Sync Lab
          </Button>
        </div>
        <div className="mt-5 flex gap-1 overflow-x-auto">
          {labTabs.map((tab) => {
            const Icon = tab.icon
            const active = section === tab.id || (section === 'review' && tab.id === 'questions')
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.path)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[5px] px-3 text-[12px] font-semibold transition ${
                  active ? 'bg-[#111827] text-white' : 'bg-[#f3f4f6] text-[#4b5563] hover:bg-[#e5e7eb] hover:text-[#111827]'
                }`}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  const renderDashboard = () => {
    const cards = dashboard?.cards || {}
    const readiness = dashboard?.readiness || {}
    const kpis = [
      ['Total papers uploaded', cards.total_papers_uploaded],
      ['Paper 1 uploaded', cards.paper_1_papers_uploaded],
      ['Paper 2 uploaded', cards.paper_2_papers_uploaded],
      ['Mark schemes', cards.mark_schemes_uploaded],
      ['Questions extracted', cards.total_questions_extracted],
      ['Questions accepted', cards.total_questions_accepted],
      ['Questions tagged', cards.total_questions_tagged],
      ['Questions verified', cards.total_questions_verified],
      ['Untagged questions', cards.untagged_questions],
      ['Failed extraction sections', cards.failed_extraction_sections],
      ['Available years', cards.available_years],
      ['Missing years', cards.missing_years],
      ['Completeness', `${cards.dataset_completeness_percentage || 0}%`],
      ['Quality score', `${cards.dataset_quality_score || 0}/100`],
    ]
    return (
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(([label, value]) => <Kpi key={label} label={String(label)} value={value} />)}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <SectionCard title={`Dataset Status: ${readiness.label || 'Incomplete'}`} subtitle="Readiness is calculated from uploaded papers, extracted papers, tagged questions, verified questions, mark schemes, recent coverage, paper balance and topic map completeness.">
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Kpi label="Completeness" value={`${readiness.dataset_completeness_percentage || 0}%`} />
                <Kpi label="Quality" value={`${readiness.dataset_quality_score || 0}/100`} />
                <Kpi label="Tagged" value={`${readiness.tagged_percentage || 0}%`} />
                <Kpi label="Verified" value={`${readiness.verified_percentage || 0}%`} />
              </div>
              <div className="rounded-[8px] border border-[#e5e7eb] bg-[#f8fafc] p-4">
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Reason</div>
                <div className="mt-2 grid gap-1.5">
                  {(readiness.reasons || []).map((reason: string) => (
                    <div key={reason} className="flex gap-2 text-[13px] leading-5 text-[#334155]">
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#94a3b8]" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Full Dataset Actions" subtitle="Advanced workflows unlock when coverage and labelling quality become strong enough.">
            <div className="grid gap-2 p-4">
              {(readiness.available_actions || []).map((action: string) => (
                <div key={action} className={`flex items-center gap-2 rounded-[6px] border px-3 py-2 text-[12px] font-semibold ${
                  readiness.advanced_actions_unlocked ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : 'border-[#e5e7eb] bg-[#f9fafb] text-[#64748b]'
                }`}>
                  {readiness.advanced_actions_unlocked ? <Check className="size-4" /> : <Archive className="size-4" />}
                  {action}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Questions by Topic" subtitle="Tagged accepted questions grouped by syllabus topic.">
            <PortalTable
              rows={dashboard?.charts?.questions_by_topic || []}
              columns={[
                { key: 'topic', label: 'Topic' },
                { key: 'questions', label: 'Questions' },
              ]}
              emptyMessage="No tagged questions yet."
            />
          </SectionCard>
          <SectionCard title="Missing Paper Tracker" subtitle="Years with no uploaded question paper in the target range.">
            <div className="flex flex-wrap gap-2 p-4">
              {(dashboard?.charts?.missing_paper_tracker || []).length ? dashboard.charts.missing_paper_tracker.map((year: number) => (
                <button key={year} type="button" onClick={() => navigate(`/internal/exam-lab/upload?year=${year}`)} className="rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-bold text-[#9a3412]">
                  {year}
                </button>
              )) : <span className="text-[13px] text-[#64748b]">No missing years detected in the selected range.</span>}
            </div>
          </SectionCard>
        </div>
      </div>
    )
  }

  const renderCoverage = () => (
    <SectionCard title="Paper Coverage Tracker" subtitle="Default target range is 1990 to the current year. Every year shows missing uploads, extraction state, tagging progress, verification progress and notes.">
      <PortalTable
        rows={coverage.rows || []}
        columns={[
          { key: 'year', label: 'Year' },
          { key: 'paper_1', label: 'Paper 1', render: (row) => statusChip(row.paper_1) },
          { key: 'paper_2', label: 'Paper 2', render: (row) => statusChip(row.paper_2) },
          { key: 'paper_1_mark_scheme', label: 'P1 Mark Scheme', render: (row) => statusChip(row.paper_1_mark_scheme) },
          { key: 'paper_2_mark_scheme', label: 'P2 Mark Scheme', render: (row) => statusChip(row.paper_2_mark_scheme) },
          { key: 'extracted', label: 'Extracted', render: (row) => statusChip(row.extracted) },
          { key: 'tagged', label: 'Tagged', render: (row) => statusChip(row.tagged) },
          { key: 'verified', label: 'Verified', render: (row) => statusChip(row.verified) },
          { key: 'notes', label: 'Notes', render: (row) => row.notes || '-' },
          {
            key: 'actions',
            label: 'Actions',
            render: (row) => (
              <div className="flex gap-1">
                <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => navigate(`/internal/exam-lab/upload?year=${row.year}&paper=Paper%201&document_type=Question%20Paper`)}>
                  P1
                </Button>
                <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => navigate(`/internal/exam-lab/upload?year=${row.year}&paper=Paper%202&document_type=Question%20Paper`)}>
                  P2
                </Button>
                <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => markCoverageUnavailable(row)}>
                  Note
                </Button>
              </div>
            ),
          },
        ]}
      />
    </SectionCard>
  )

  const renderUpload = () => (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard title="Upload Past Paper or Support Document" subtitle="Multiple versions are preserved. Mark a cleaner version as replacement to demote an older trusted primary without destroying reviewed questions.">
        <div className="grid gap-4 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <LabField label="Exam board">
              <select className={selectClassName()} value={uploadForm.exam_board} onChange={(event) => setUploadForm({ ...uploadForm, exam_board: event.target.value })}>
                {['MANEB', 'Cambridge', 'Other'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </LabField>
            <LabField label="Exam level">
              <select className={selectClassName()} value={uploadForm.exam_level} onChange={(event) => setUploadForm({ ...uploadForm, exam_level: event.target.value })}>
                {['MSCE', 'JCE', 'Cambridge Checkpoint', 'Other'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </LabField>
            <LabField label="Subject">
              <Input value={uploadForm.subject} onChange={(event) => setUploadForm({ ...uploadForm, subject: event.target.value })} className="h-9 text-[12px]" />
            </LabField>
            <LabField label="Paper">
              <select className={selectClassName()} value={uploadForm.paper} onChange={(event) => setUploadForm({ ...uploadForm, paper: event.target.value })}>
                {papers.map((item) => <option key={item}>{item}</option>)}
              </select>
            </LabField>
            <LabField label="Year">
              <Input type="number" value={uploadForm.year} onChange={(event) => setUploadForm({ ...uploadForm, year: event.target.value })} className="h-9 text-[12px]" />
            </LabField>
            <LabField label="Document type">
              <select className={selectClassName()} value={uploadForm.document_type} onChange={(event) => setUploadForm({ ...uploadForm, document_type: event.target.value })}>
                {documentTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </LabField>
            <LabField label="Source quality">
              <select className={selectClassName()} value={uploadForm.source_quality} onChange={(event) => setUploadForm({ ...uploadForm, source_quality: event.target.value })}>
                {sourceQualities.map((item) => <option key={item}>{item}</option>)}
              </select>
            </LabField>
            <LabField label="File">
              <Input type="file" accept=".pdf,.txt,.csv,image/png,image/jpeg,image/webp" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} className="h-9 text-[12px]" />
            </LabField>
            <LabField label="Training/backtesting">
              <label className="flex h-9 items-center gap-2 rounded-[5px] border border-[#d9dce3] px-2 text-[12px] normal-case tracking-[0] text-[#111827]">
                <input type="checkbox" checked={uploadForm.use_for_training} onChange={(event) => setUploadForm({ ...uploadForm, use_for_training: event.target.checked })} className={checkboxClassName()} />
                Use this file
              </label>
            </LabField>
          </div>
          <LabField label="Manual text fallback">
            <Textarea value={uploadForm.text_content} onChange={(event) => setUploadForm({ ...uploadForm, text_content: event.target.value })} placeholder="Paste text only when a file is not available or OCR is not configured." className="min-h-[120px] text-[12px]" />
          </LabField>
          <LabField label="Notes">
            <Textarea value={uploadForm.notes} onChange={(event) => setUploadForm({ ...uploadForm, notes: event.target.value })} className="min-h-[76px] text-[12px]" />
          </LabField>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] font-semibold text-[#334155]">
              <input type="checkbox" checked={uploadForm.is_replacement} onChange={(event) => setUploadForm({ ...uploadForm, is_replacement: event.target.checked })} className={checkboxClassName()} />
              Replacement/version of existing paper
            </label>
            <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={submitUpload} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Upload
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="After Upload" subtitle="Uploads stay versioned. Extraction starts only when you choose it.">
        <div className="grid gap-3 p-4">
          {uploadResult ? (
            <>
              <div className="rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] p-3 text-[13px] font-semibold text-[#166534]">
                Uploaded {uploadResult.version?.original_filename || 'paper version'}.
              </div>
              <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={() => startExtraction(uploadResult.paper?.id, uploadResult.version?.id)} disabled={busy || uploadResult.version?.document_type !== 'Question Paper'}>
                <Play className="size-4" />
                Start Extraction
              </Button>
              <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={() => navigate('/internal/exam-lab/coverage')}>
                <ListChecks className="size-4" />
                Go to Coverage
              </Button>
              <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={() => navigate(`/internal/exam-lab/papers/${uploadResult.paper?.id}/review`)}>
                <FileSearch className="size-4" />
                Review Extraction
              </Button>
            </>
          ) : (
            <div className="text-[13px] leading-6 text-[#64748b]">
              Duplicate trusted primary papers are blocked unless you upload as a replacement version. Old versions remain archived for extraction-quality comparison.
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )

  const renderQuestions = () => (
    <div className="grid gap-4">
      <SectionCard title="Question Bank" subtitle="Search, filter, tag, verify, inspect source, find similar later, or archive without hard deletion." actions={
        <div className="flex gap-2">
          <Input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Search questions" className="h-8 w-56 text-[12px]" />
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={refreshLight}>
            <Search className="size-4" />
          </Button>
        </div>
      }>
        <PortalTable
          rows={questions}
          onRowClick={(row) => {
            setSelectedQuestionId(row.id)
            navigate('/internal/exam-lab/tagging')
          }}
          columns={[
            { key: 'exam_year', label: 'Year' },
            { key: 'paper', label: 'Paper' },
            { key: 'question_number', label: 'No.' },
            { key: 'question_text', label: 'Question Preview', render: (row) => <span className="block max-w-[420px] truncate">{row.question_text}</span> },
            { key: 'marks', label: 'Marks' },
            { key: 'topic_name', label: 'Topic', render: (row) => row.topic_name || statusChip('Missing') },
            { key: 'subtopic_name', label: 'Subtopic', render: (row) => row.subtopic_name || '-' },
            { key: 'difficulty', label: 'Difficulty', render: (row) => valueLabel(row.difficulty) },
            { key: 'question_type', label: 'Type', render: (row) => valueLabel(row.question_type) },
            { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
            { key: 'verified', label: 'Verified', render: (row) => row.verified ? statusChip('Verified') : statusChip('Needs Review') },
          ]}
          emptyMessage="No accepted questions yet."
        />
      </SectionCard>

      <SectionCard title="Create Question Manually" subtitle="Use this when extraction misses a page or you are entering a paper by hand.">
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <LabField label="Year"><Input type="number" value={manualForm.year} onChange={(event) => setManualForm({ ...manualForm, year: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Paper"><select className={selectClassName()} value={manualForm.paper} onChange={(event) => setManualForm({ ...manualForm, paper: event.target.value })}>{papers.map((item) => <option key={item}>{item}</option>)}</select></LabField>
          <LabField label="Question no."><Input value={manualForm.question_number} onChange={(event) => setManualForm({ ...manualForm, question_number: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Marks"><Input type="number" value={manualForm.marks} onChange={(event) => setManualForm({ ...manualForm, marks: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <div className="md:col-span-4">
            <LabField label="Question text"><Textarea value={manualForm.question_text} onChange={(event) => setManualForm({ ...manualForm, question_text: event.target.value })} className="min-h-[110px] text-[12px]" /></LabField>
          </div>
          <div className="md:col-span-4">
            <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={submitManualQuestion} disabled={busy}>
              <Plus className="size-4" />
              Create Question Manually
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )

  const renderTagging = () => (
    <div className="grid min-h-[640px] gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
      <SectionCard title="Queue" subtitle={`${questions.length} accepted questions`}>
        <div className="max-h-[680px] overflow-y-auto p-2">
          {questions.map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => setSelectedQuestionId(question.id)}
              className={`mb-2 w-full rounded-[6px] border p-3 text-left transition ${
                String(selectedQuestion?.id) === String(question.id) ? 'border-[#111827] bg-[#f8fafc]' : 'border-[#e5e7eb] bg-white hover:bg-[#f9fafb]'
              }`}
            >
              <div className="text-[12px] font-bold text-[#111827]">{question.exam_year} {question.paper} Q{question.question_number || question.id}</div>
              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#64748b]">{question.question_text}</div>
              <div className="mt-2 flex gap-1">{question.topic_id ? statusChip('Tagged') : statusChip('Missing')}{question.verified ? statusChip('Verified') : null}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Question" subtitle={selectedQuestion ? `${selectedQuestion.exam_year} ${selectedQuestion.paper} / ${selectedQuestion.marks || 0} marks` : 'Select a question'}>
        <div className="grid gap-3 p-4">
          <Textarea value={questionForm.question_text || ''} onChange={(event) => setQuestionForm({ ...questionForm, question_text: event.target.value })} className="min-h-[360px] text-[14px] leading-7" />
          <div className="grid gap-3 md:grid-cols-3">
            <LabField label="Marks"><Input type="number" value={questionForm.marks || 0} onChange={(event) => setQuestionForm({ ...questionForm, marks: event.target.value })} className="h-9 text-[12px]" /></LabField>
            <LabField label="Command word"><Input value={questionForm.command_word || ''} onChange={(event) => setQuestionForm({ ...questionForm, command_word: event.target.value })} className="h-9 text-[12px]" /></LabField>
            <LabField label="Confidence"><Input type="number" min="0" max="1" step="0.05" value={questionForm.tagging_confidence || 0} onChange={(event) => setQuestionForm({ ...questionForm, tagging_confidence: event.target.value })} className="h-9 text-[12px]" /></LabField>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Tagging Form" subtitle="Fast supervised labelling for future analytics and backtesting.">
        <div className="grid gap-3 p-4">
          <LabField label="Topic">
            <select className={selectClassName()} value={questionForm.topic_id || ''} onChange={(event) => setQuestionForm({ ...questionForm, topic_id: event.target.value, subtopic_id: '', skill_id: '' })}>
              <option value="">Untagged</option>
              {topicMap.topics.map((topic: any) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
            </select>
          </LabField>
          <LabField label="Subtopic">
            <select className={selectClassName()} value={questionForm.subtopic_id || ''} onChange={(event) => setQuestionForm({ ...questionForm, subtopic_id: event.target.value, skill_id: '' })}>
              <option value="">No subtopic</option>
              {subtopicsForTopic.map((subtopic: any) => <option key={subtopic.id} value={subtopic.id}>{subtopic.name}</option>)}
            </select>
          </LabField>
          <LabField label="Skill">
            <select className={selectClassName()} value={questionForm.skill_id || ''} onChange={(event) => setQuestionForm({ ...questionForm, skill_id: event.target.value })}>
              <option value="">No skill</option>
              {skillsForSelection.map((skill: any) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </LabField>
          <LabField label="Difficulty">
            <select className={selectClassName()} value={questionForm.difficulty || 'unknown'} onChange={(event) => setQuestionForm({ ...questionForm, difficulty: event.target.value })}>
              {difficulties.map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}
            </select>
          </LabField>
          <LabField label="Question type">
            <select className={selectClassName()} value={questionForm.question_type || 'structured'} onChange={(event) => setQuestionForm({ ...questionForm, question_type: event.target.value })}>
              {questionTypes.map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}
            </select>
          </LabField>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['has_diagram', 'Diagram'],
              ['has_graph', 'Graph'],
              ['has_table', 'Table'],
            ].map(([key, label]) => (
              <label key={key} className="flex h-9 items-center gap-2 rounded-[5px] border border-[#d9dce3] px-2 text-[12px] font-semibold text-[#334155]">
                <input type="checkbox" checked={Boolean(questionForm[key])} onChange={(event) => setQuestionForm({ ...questionForm, [key]: event.target.checked })} className={checkboxClassName()} />
                {label}
              </label>
            ))}
          </div>
          <LabField label="Notes"><Textarea value={questionForm.notes || ''} onChange={(event) => setQuestionForm({ ...questionForm, notes: event.target.value })} className="min-h-[76px] text-[12px]" /></LabField>
          <div className="grid gap-2">
            <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={() => saveQuestion()} disabled={busy || !selectedQuestion}>
              <Save className="size-4" />
              Save
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={saveAndNext} disabled={busy || !selectedQuestion}>
              <ChevronRight className="size-4" />
              Save and Next
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={() => saveQuestion({ verified: true })} disabled={busy || !selectedQuestion}>
              <ClipboardCheck className="size-4" />
              Mark Verified
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={async () => toast.info((await api.suggestExamLabQuestionTags(token, { question_text: questionForm.question_text })).message)}>
              <WandSparkles className="size-4" />
              Suggest Tags
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )

  const renderTopicMap = () => (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard title="Editable Mathematics Topic Map" subtitle="Stored in the database so MANEB topic and subtopic labels can evolve as the dataset becomes cleaner.">
        <PortalTable
          rows={topicMap.topics}
          columns={[
            { key: 'name', label: 'Topic' },
            { key: 'subtopic_count', label: 'Subtopics' },
            { key: 'skill_count', label: 'Skills' },
            { key: 'question_count', label: 'Questions' },
            { key: 'syllabus_weight', label: 'Weight' },
          ]}
          emptyMessage="No topic map yet."
        />
        <div className="border-t border-[#e5e7eb] p-4">
          <h3 className="text-[13px] font-semibold text-[#111827]">Subtopics</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {topicMap.subtopics.map((subtopic: any) => {
              const topic = topicMap.topics.find((item: any) => item.id === subtopic.topic_id)
              return <span key={subtopic.id} className="rounded-[5px] border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5 text-[12px] font-semibold text-[#475569]">{topic?.name}: {subtopic.name}</span>
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Topic Map Builder" subtitle="Add topics, subtopics and skills. Archive and merge support is represented in the data model for later refinement.">
        <div className="grid gap-4 p-4">
          <div className="grid gap-2">
            <LabField label="Topic name"><Input value={topicForm.name} onChange={(event) => setTopicForm({ ...topicForm, name: event.target.value })} className="h-9 text-[12px]" /></LabField>
            <LabField label="Description"><Textarea value={topicForm.description} onChange={(event) => setTopicForm({ ...topicForm, description: event.target.value })} className="min-h-[64px] text-[12px]" /></LabField>
            <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={() => saveTopicMapItem('topic')} disabled={busy}>
              <Plus className="size-4" />
              Add Topic
            </Button>
          </div>
          <div className="border-t border-[#e5e7eb] pt-4">
            <LabField label="Parent topic"><select className={selectClassName()} value={subtopicForm.topic_id} onChange={(event) => setSubtopicForm({ ...subtopicForm, topic_id: event.target.value })}><option value="">Choose topic</option>{topicMap.topics.map((topic: any) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></LabField>
            <div className="mt-2"><LabField label="Subtopic"><Input value={subtopicForm.name} onChange={(event) => setSubtopicForm({ ...subtopicForm, name: event.target.value })} className="h-9 text-[12px]" /></LabField></div>
            <Button type="button" variant="outline" className="mt-3 h-9 rounded-[5px] text-[12px]" onClick={() => saveTopicMapItem('subtopic')} disabled={busy}>
              <Plus className="size-4" />
              Add Subtopic
            </Button>
          </div>
          <div className="border-t border-[#e5e7eb] pt-4">
            <LabField label="Topic"><select className={selectClassName()} value={skillForm.topic_id} onChange={(event) => setSkillForm({ ...skillForm, topic_id: event.target.value, subtopic_id: '' })}><option value="">Choose topic</option>{topicMap.topics.map((topic: any) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></LabField>
            <div className="mt-2"><LabField label="Subtopic"><select className={selectClassName()} value={skillForm.subtopic_id} onChange={(event) => setSkillForm({ ...skillForm, subtopic_id: event.target.value })}><option value="">Optional</option>{topicMap.subtopics.filter((subtopic: any) => String(subtopic.topic_id) === String(skillForm.topic_id)).map((subtopic: any) => <option key={subtopic.id} value={subtopic.id}>{subtopic.name}</option>)}</select></LabField></div>
            <div className="mt-2"><LabField label="Skill"><Input value={skillForm.name} onChange={(event) => setSkillForm({ ...skillForm, name: event.target.value })} className="h-9 text-[12px]" /></LabField></div>
            <Button type="button" variant="outline" className="mt-3 h-9 rounded-[5px] text-[12px]" onClick={() => saveTopicMapItem('skill')} disabled={busy}>
              <Plus className="size-4" />
              Add Skill
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )

  const renderReview = () => {
    const paper = review?.paper
    const activeVersion = review?.active_version
    return (
      <div className="grid gap-4">
        <SectionCard title={paper ? `${paper.exam_year} ${paper.subject} ${paper.paper} Review` : 'Paper Review'} subtitle={activeVersion ? `${activeVersion.original_filename} / ${valueLabel(activeVersion.extraction_status)} / ${activeVersion.extraction_quality_score || 0}% quality` : 'Upload a question paper version first.'} actions={
          activeVersion ? <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => startExtraction(paper.id, activeVersion.id)} disabled={busy}><Play className="size-4" /> Reprocess</Button> : null
        }>
          <div className="grid gap-4 p-4 lg:grid-cols-4">
            <Kpi label="Pages processed" value={review?.pages?.length || 0} />
            <Kpi label="Questions detected" value={review?.candidates?.length || 0} />
            <Kpi label="Low confidence" value={(review?.candidates || []).filter((item: any) => Number(item.confidence || 0) < 0.62).length} />
            <Kpi label="Failed pages" value={(review?.pages || []).filter((item: any) => item.status === 'failed').length} />
            <Kpi label="Extraction method" value={valueLabel(activeVersion?.extraction_summary_json?.extraction_method || 'Pending')} />
            <Kpi label="Formula count" value={activeVersion?.extraction_summary_json?.formula_count || 0} />
            <Kpi label="Image diagrams" value={activeVersion?.extraction_summary_json?.image_diagrams_detected || 0} />
            <Kpi label="Diagram signals" value={activeVersion?.extraction_summary_json?.diagram_signal_count ?? review?.diagrams?.length ?? 0} />
            <Kpi label="Duplicate diagrams" value={activeVersion?.extraction_summary_json?.duplicate_diagram_count || 0} />
            <Kpi label="AI model" value={activeVersion?.extraction_summary_json?.ai_model || '-'} />
            <Kpi label="AI warnings" value={(activeVersion?.extraction_summary_json?.ai_warnings || []).length} />
          </div>
          {activeVersion?.extraction_summary_json?.ai_message ? (
            <div className="mx-4 mb-4 rounded-[8px] border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] leading-5 text-[#9a3412]">
              {activeVersion.extraction_summary_json.ai_message}
            </div>
          ) : null}
        </SectionCard>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <SectionCard title="Question Candidates" subtitle="Accept clean questions, reject non-question content, mark duplicates, or flag manual fixes.">
            <PortalTable
              rows={review?.candidates || []}
              columns={[
                { key: 'detected_question_number', label: 'No.' },
                { key: 'question_text', label: 'Extracted Text', render: (row) => <span className="block max-w-[520px] truncate">{row.question_text}</span> },
                { key: 'detected_marks', label: 'Marks' },
                { key: 'source_page_start', label: 'Page' },
                { key: 'confidence', label: 'Confidence', render: (row) => `${Math.round(Number(row.confidence || 0) * 100)}%` },
                {
                  key: 'signals',
                  label: 'Signals',
                  render: (row) => {
                    const raw = row.raw_json || {}
                    const signals = [
                      raw.extraction_method ? valueLabel(raw.extraction_method) : '',
                      raw.formula_count ? `${raw.formula_count} formula${Number(raw.formula_count) === 1 ? '' : 's'}` : '',
                      raw.has_diagram ? 'Diagram' : '',
                      raw.has_graph ? 'Graph' : '',
                      raw.has_table ? 'Table' : '',
                    ].filter(Boolean)
                    return signals.length ? signals.join(' / ') : '-'
                  },
                },
                { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (row) => (
                    <div className="flex gap-1">
                      <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => candidateAction(row, 'accept')}><Check className="size-3.5" /></Button>
                      <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => candidateAction(row, 'reject')}><X className="size-3.5" /></Button>
                      <Button type="button" variant="outline" className="h-7 rounded-[5px] px-2 text-[11px]" onClick={() => candidateAction(row, 'needs_manual_fix')}>Fix</Button>
                    </div>
                  ),
                },
              ]}
              emptyMessage="No candidates detected yet."
            />
          </SectionCard>

          <SectionCard title="Failed Pages and Logs" subtitle="Failed extraction sections stay visible for manual correction.">
            <div className="grid max-h-[580px] gap-3 overflow-y-auto p-4">
              {(review?.pages || []).filter((page: any) => page.status === 'failed').map((page: any) => (
                <div key={page.id} className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] p-3">
                  <div className="text-[12px] font-bold text-[#991b1b]">Page {page.page_number}</div>
                  <div className="mt-1 text-[12px] leading-5 text-[#7f1d1d]">{page.error_reason}</div>
                  <Button type="button" variant="outline" className="mt-3 h-8 rounded-[5px] text-[12px]" onClick={() => {
                    setManualForm((current: any) => ({ ...current, year: paper?.exam_year || current.year, paper: paper?.paper || current.paper }))
                    navigate('/internal/exam-lab/questions')
                  }}>
                    Create Question Manually
                  </Button>
                </div>
              ))}
              {(review?.logs || []).map((log: any) => (
                <div key={log.id} className="rounded-[6px] border border-[#e5e7eb] bg-[#f9fafb] p-3 text-[12px] leading-5 text-[#475569]">
                  <span className="font-bold text-[#111827]">{valueLabel(log.log_level)}:</span> {log.message}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Raw Extracted Text" subtitle="Original page text is preserved for review and correction.">
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {(review?.pages || []).slice(0, 8).map((page: any) => (
              <div key={page.id} className="rounded-[8px] border border-[#e5e7eb] bg-[#f8fafc] p-3">
                <div className="mb-2 text-[12px] font-bold text-[#111827]">Page {page.page_number} / {valueLabel(page.status)}</div>
                <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[#475569]">{page.raw_text || page.cleaned_text || page.error_reason}</pre>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    )
  }

  const renderBacktesting = () => (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <SectionCard title="Run Backtest" subtitle="Training data must end before the test year. Untagged test years are refused.">
        <div className="grid gap-3 p-4">
          <LabField label="Paper"><select className={selectClassName()} value={backtestForm.paper} onChange={(event) => setBacktestForm({ ...backtestForm, paper: event.target.value })}>{papers.map((item) => <option key={item}>{item}</option>)}</select></LabField>
          <LabField label="Training start"><Input type="number" value={backtestForm.training_start_year} onChange={(event) => setBacktestForm({ ...backtestForm, training_start_year: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Training end"><Input type="number" value={backtestForm.training_end_year} onChange={(event) => setBacktestForm({ ...backtestForm, training_end_year: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Test year"><Input type="number" value={backtestForm.test_year} onChange={(event) => setBacktestForm({ ...backtestForm, test_year: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Predicted topics"><Input type="number" value={backtestForm.predicted_topic_count} onChange={(event) => setBacktestForm({ ...backtestForm, predicted_topic_count: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <LabField label="Method"><select className={selectClassName()} value={backtestForm.prediction_method} onChange={(event) => setBacktestForm({ ...backtestForm, prediction_method: event.target.value })}>{['frequency_only', 'recent_weighted', 'recency_frequency_marks'].map((item) => <option key={item} value={item}>{valueLabel(item)}</option>)}</select></LabField>
          <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={runBacktest} disabled={busy}>
            <Play className="size-4" />
            Run Backtest
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Backtest Results" subtitle="Marks Coverage = marks from correctly predicted topics / total marks in the test paper.">
        <PortalTable
          rows={backtests}
          columns={[
            { key: 'test_year', label: 'Test Year' },
            { key: 'paper', label: 'Paper' },
            { key: 'training_start_year', label: 'Train Start' },
            { key: 'training_end_year', label: 'Train End' },
            { key: 'marks_coverage', label: 'Marks Coverage', render: (row) => `${row.marks_coverage}%` },
            { key: 'top5_hit_rate', label: 'Top 5 Hit', render: (row) => `${row.top5_hit_rate}%` },
            { key: 'top10_hit_rate', label: 'Top 10 Hit', render: (row) => `${row.top10_hit_rate}%` },
            { key: 'diagram_hit_rate', label: 'Diagram Hit', render: (row) => `${row.result_json?.diagram_recurrence_hit_rate ?? 0}%` },
            { key: 'confidence_level', label: 'Confidence', render: (row) => statusChip(row.confidence_level) },
          ]}
          emptyMessage="No backtests yet."
        />
      </SectionCard>
    </div>
  )

  const renderReports = () => (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <SectionCard title="Generate Prediction Report" subtitle="Reports forecast revision priority, topic likelihood, marks ranges and dataset limitations.">
        <div className="grid gap-3 p-4">
          <LabField label="Paper"><select className={selectClassName()} value={reportForm.paper} onChange={(event) => setReportForm({ ...reportForm, paper: event.target.value })}>{papers.map((item) => <option key={item}>{item}</option>)}</select></LabField>
          <LabField label="Target year"><Input type="number" value={reportForm.target_year} onChange={(event) => setReportForm({ ...reportForm, target_year: event.target.value })} className="h-9 text-[12px]" /></LabField>
          <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={generateReport} disabled={busy}>
            <FileText className="size-4" />
            Generate Report
          </Button>
          <div className="rounded-[8px] border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] leading-5 text-[#9a3412]">
            This report predicts revision priority and topic likelihood, not exact exam questions.
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Prediction Reports" subtitle="Stored internal reports include dataset warnings and confidence levels.">
        <div className="grid gap-3 p-4">
          {reports.length ? reports.map((report) => {
            const data = report.report_json || {}
            return (
              <div key={report.id} className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#111827]">{data.title || report.report_title}</h3>
                    <p className="mt-1 text-[12px] text-[#64748b]">Confidence: {valueLabel(report.confidence_level)} / Target: {report.target_year}</p>
                  </div>
                  {statusChip(report.confidence_level)}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {[
                    ['High Priority', data.high_priority_topics || []],
                    ['Medium Priority', data.medium_priority_topics || []],
                    ['Low Priority', data.low_priority_topics || []],
                  ].map(([label, rows]: any) => (
                    <div key={label} className="rounded-[6px] border border-[#e5e7eb] bg-[#f8fafc] p-3">
                      <div className="text-[12px] font-bold text-[#111827]">{label}</div>
                      <div className="mt-2 grid gap-1">
                        {rows.slice(0, 5).map((topic: any) => (
                          <div key={`${topic.topic_id}-${topic.topic}`} className="text-[12px] leading-5 text-[#475569]">{topic.topic} - {topic.priority_score}%</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {(data.dataset_limitations || []).length ? <div className="mt-3 rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] leading-5 text-[#9a3412]">{data.dataset_limitations.join(' ')}</div> : null}
              </div>
            )
          }) : <div className="text-[13px] text-[#64748b]">No reports generated yet.</div>}
        </div>
      </SectionCard>
    </div>
  )

  const renderBody = () => {
    if (loading) return <SmartLinkLoadingState label="Loading Exam Intelligence Lab" detail="Preparing coverage, topic map, questions and backtest data." />
    if (section === 'coverage') return renderCoverage()
    if (section === 'upload') return renderUpload()
    if (section === 'questions') return renderQuestions()
    if (section === 'tagging') return renderTagging()
    if (section === 'topic-map') return renderTopicMap()
    if (section === 'backtesting') return renderBacktesting()
    if (section === 'reports') return renderReports()
    if (section === 'review') return renderReview()
    return renderDashboard()
  }

  return (
    <div className="min-h-full bg-[#eef1f5] text-[#111827]">
      {renderHeader()}
      <main className="mx-auto max-w-7xl px-4 py-5">
        {renderBody()}
      </main>
    </div>
  )
}

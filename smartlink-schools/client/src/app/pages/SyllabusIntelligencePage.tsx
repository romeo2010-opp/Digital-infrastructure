import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Play, Plus, RotateCcw, Search, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
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
  const [students, setStudents] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [review, setReview] = useState<any>(null)
  const [batch, setBatch] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draftForm, setDraftForm] = useState<any>({ grade_id: '', subject_id: '', topic_id: '', difficulty: 'easy', question_type: 'multiple_choice', number_of_questions: 5 })
  const [drillForm, setDrillForm] = useState<any>({ student_id: '', subject_id: '', topic_id: '' })
  const [insightClassId, setInsightClassId] = useState('')
  const [insights, setInsights] = useState<any>(null)
  const [search, setSearch] = useState('')

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [setupPayload, aiPayload, uploadPayload, manualPayload, topicPayload, questionPayload, studentPayload, classPayload] = await Promise.all([
        api.getSyllabusSetup(token),
        api.getAiStatus(token),
        api.listSyllabusUploads(token),
        api.listManualSyllabusEntries(token),
        api.listSyllabusTopics(token),
        api.listQuestionBank(token),
        api.listStudents(token),
        api.listClasses(token),
      ])
      setSetup(setupPayload)
      setAi(aiPayload?.ai || null)
      setUploads(uploadPayload?.uploads || [])
      setManualEntries(manualPayload?.entries || [])
      setTopics(topicPayload?.topics || [])
      setQuestions(questionPayload?.questions || [])
      setStudents(studentPayload?.students || [])
      setClasses(classPayload?.classes || [])
      if (!draftForm.grade_id && setupPayload?.grades?.[0]) setDraftForm((current: any) => ({ ...current, grade_id: String(setupPayload.grades[0].id) }))
      if (!drillForm.student_id && studentPayload?.students?.[0]) setDrillForm((current: any) => ({ ...current, student_id: String(studentPayload.students[0].id) }))
      if (!insightClassId && classPayload?.classes?.[0]) setInsightClassId(String(classPayload.classes[0].id))
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
  const generatorTopics = topics.filter((topic) => !draftForm.subject_id || String(topic.subject_id) === String(draftForm.subject_id))

  const openReview = async (uploadId: any) => {
    if (!token) return
    setBusy(true)
    try {
      setReview(await api.getSyllabusReview(token, uploadId))
      setActiveTab('uploads')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to open review.')
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
      await openReview(item.upload_id)
      await load()
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
      for (const row of rows) await api.approveExtractedSyllabusItem(token, row.id)
      toast.success(`${rows.length} high-confidence items approved.`)
      await openReview(review.upload.id)
      await load()
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
    if (!token || !drillForm.student_id) {
      toast.error('Select a student.')
      return
    }
    setBusy(true)
    try {
      await api.generateDrill(token, drillForm.student_id, drillForm)
      toast.success('Daily Drill generated.')
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
      <SectionCard title="Documents" subtitle="Reviewed syllabus documents stay here for reference.">
        <PortalTable
          rows={uploads}
          columns={[
            { key: 'original_filename', label: 'Document' },
            { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
            { key: 'grade_name', label: 'Grade', render: (row) => row.grade_name || '-' },
            { key: 'processing_status', label: 'Status', render: (row) => statusChip(row.processing_status) },
            { key: 'pending_items', label: 'Pending', render: (row) => row.pending_items || 0 },
            { key: 'actions', label: 'Review', render: (row) => <button type="button" className="text-[11px] font-bold text-[#2563eb]" onClick={(event) => { event.stopPropagation(); openReview(row.id) }}>Open</button> },
          ]}
          emptyMessage={loading ? 'Loading uploads...' : 'No syllabus uploads yet.'}
        />
      </SectionCard>

      <SectionCard title="Teacher Entries" subtitle="Teacher-created syllabus topics waiting for school leadership review.">
        <PortalTable
          rows={manualEntries}
          columns={[
            { key: 'topic_name', label: 'Topic' },
            { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
            { key: 'grade_name', label: 'Year', render: (row) => row.grade_name || '-' },
            {
              key: 'structure',
              label: 'Structure',
              render: (row) => `${row.syllabus_map?.subtopics?.length || 0} subtopics / ${row.success_criteria_count || 0} criteria / ${row.success_criteria_tag_count || row.success_criteria_count || 0} tags`,
            },
            { key: 'submitted_by_name', label: 'Teacher', render: (row) => row.submitted_by_name || '-' },
            { key: 'status', label: 'Status', render: (row) => statusChip(row.status) },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <button
                  type="button"
                  className="text-[11px] font-bold text-[#2563eb]"
                  onClick={(event) => { event.stopPropagation(); navigate(`/syllabus/create/${row.id}`) }}
                >
                  {canReviewManualEntries && row.status === 'pending_review' ? 'Review' : 'Open'}
                </button>
              ),
            },
          ]}
          emptyMessage={loading ? 'Loading teacher entries...' : 'No teacher syllabus entries yet.'}
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
                  {(entry.syllabus_map?.subtopics || []).slice(0, 4).map((subtopic: any) => (
                    <div key={subtopic.title} className="text-[12px] text-[#475569]">
                      <span className="font-semibold text-[#111827]">{subtopic.title}</span>
                      {subtopic.criteria?.length ? <span> / {subtopic.criteria.slice(0, 2).map((criterion: any) => criterion.text).join(', ')}</span> : null}
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
            <div className="text-[12px] font-semibold text-[#64748b]">{review.items?.length || 0} extracted items</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => api.processSyllabusUpload(token, review.upload.id).then(() => openReview(review.upload.id))}><RotateCcw className="size-3.5" /> Reprocess</Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={approveHighConfidence}><Check className="size-3.5" /> Approve High Confidence</Button>
            </div>
          </div>
          <PortalTable
            rows={review.items || []}
            columns={[
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
          { key: 'term', label: 'Term', render: (row) => row.term || '-' },
          { key: 'approved_question_count', label: 'Approved Qs', render: (row) => row.approved_question_count || 0 },
          { key: 'source_type', label: 'Source', render: (row) => valueLabel(row.source_type) },
        ]}
        emptyMessage="No approved syllabus topics yet."
      />
    </SectionCard>
  )

  const renderQuestions = () => (
    <SectionCard title="Question Bank" subtitle="A question must be approved, tagged, answered, and explained before students can use it.">
      <div className="flex items-center gap-2 border-b border-[#e2e8f0] p-3">
        <Search className="size-3.5 text-[#94a3b8]" />
        <Input className="h-8 max-w-sm text-[12px]" placeholder="Search questions" value={search} onChange={(event) => setSearch(event.target.value)} />
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
          <select className={selectClassName()} value={draftForm.grade_id} onChange={(event) => setDraftForm({ ...draftForm, grade_id: event.target.value })}>
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
            {['multiple_choice', 'true_false', 'short_answer', 'structured', 'essay'].map((row) => <option key={row} value={row}>{valueLabel(row)}</option>)}
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
        <PortalTable
          rows={batch?.questions || questions.filter((row) => row.approval_status === 'pending_review').slice(0, 50)}
          columns={[
            { key: 'question_text', label: 'Question' },
            { key: 'difficulty', label: 'Difficulty', render: (row) => valueLabel(row.difficulty) },
            { key: 'correct_answer', label: 'Answer' },
            { key: 'approval_status', label: 'Status', render: (row) => statusChip(row.approval_status) },
            { key: 'actions', label: 'Actions', render: (row) => <div className="flex gap-2"><button type="button" className="text-[11px] font-bold text-[#166534]" onClick={(event) => { event.stopPropagation(); approveQuestion(row) }}>Approve</button><button type="button" className="text-[11px] font-bold text-[#b91c1c]" onClick={(event) => { event.stopPropagation(); rejectQuestion(row) }}>Reject</button></div> },
          ]}
          emptyMessage="No draft questions are waiting for review."
        />
      </SectionCard>
    </div>
  )

  const renderDrills = () => (
    <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
      <SectionCard title="Generate Daily Drill" subtitle="Approved questions only.">
        <div className="grid gap-3 p-4">
          <select className={selectClassName()} value={drillForm.student_id} onChange={(event) => setDrillForm({ ...drillForm, student_id: event.target.value })}>
            <option value="">Student</option>
            {students.map((row: any) => <option key={row.id} value={row.id}>{`${row.first_name} ${row.last_name}`} - {row.class_name}</option>)}
          </select>
          <select className={selectClassName()} value={drillForm.subject_id} onChange={(event) => setDrillForm({ ...drillForm, subject_id: event.target.value, topic_id: '' })}>
            <option value="">Auto subject</option>
            {setup.subjects?.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className={selectClassName()} value={drillForm.topic_id} onChange={(event) => setDrillForm({ ...drillForm, topic_id: event.target.value })}>
            <option value="">Auto topic</option>
            {topics.filter((topic) => !drillForm.subject_id || String(topic.subject_id) === String(drillForm.subject_id)).map((row: any) => <option key={row.id} value={row.id}>{row.topic_name}</option>)}
          </select>
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={generateDrill}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Generate Drill
          </Button>
        </div>
      </SectionCard>
      <SectionCard title="Recent Drill Sessions" subtitle="Student attempts and marking roll into topic mastery.">
        <PortalTable
          rows={[]}
          columns={[
            { key: 'student', label: 'Student' },
            { key: 'subject', label: 'Subject' },
            { key: 'status', label: 'Status' },
          ]}
          emptyMessage="Use the dashboard drill list or generate a drill to begin."
        />
      </SectionCard>
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
              Create
            </Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={loading || busy} onClick={load}><RotateCcw className="size-3.5" /> Refresh</Button>
          </div>
        </div>
      </section>

      <SectionKpiStrip items={[
        { label: 'Documents', value: uploads.length, helper: 'library', delta: `${uploads.filter((row) => row.processing_status === 'pending_review').length} pending` },
        { label: 'Teacher Entries', value: manualEntries.length, helper: 'manual topics', delta: `${manualEntries.filter((row) => row.status === 'pending_review').length} pending` },
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

      {loading ? <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-4 text-[12px] font-semibold text-[#64748b]">Loading module...</div> : null}
      {activeTab === 'uploads' ? renderUploads() : null}
      {activeTab === 'topics' ? renderTopics() : null}
      {activeTab === 'questions' ? renderQuestions() : null}
      {activeTab === 'generator' ? renderGenerator() : null}
      {activeTab === 'drills' ? renderDrills() : null}
      {activeTab === 'insights' ? renderInsights() : null}
    </div>
  )
}

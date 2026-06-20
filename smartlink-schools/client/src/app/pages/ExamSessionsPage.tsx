import { useEffect, useMemo, useState } from 'react'
import { Archive, CheckCircle2, ClipboardCheck, Lock, Plus, Printer, RotateCcw, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-medium text-[#333333]'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateLabel(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

function StatusPill({ value }: { value: any }) {
  const status = String(value || 'draft')
  const tone = ['approved', 'results_approved', 'locked', 'generated'].includes(status)
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : ['draft', 'returned', 'ready_for_review'].includes(status)
      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
      : 'border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{valueLabel(status)}</span>
}

function MetricTile({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-[8px] border border-[#dddddd] bg-white p-3 shadow-[var(--mera-shadow-card)]">
      <p className="text-[11px] font-medium text-[#8b8b8b]">{label}</p>
      <strong className="mt-1 block text-[20px] font-medium text-[#171717]">{value}</strong>
    </div>
  )
}

export function ExamSessionsPage() {
  const { token, api, user } = usePortal()
  const role = String(user?.role || '').toLowerCase()
  const canManage = ['school_owner', 'headteacher'].includes(role)
  const [sessions, setSessions] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [setup, setSetup] = useState<any>({ years: [], terms: [], classes: [], subjects: [], teachers: [], assignments: [] })
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [reportCard, setReportCard] = useState<any>(null)
  const [sessionForm, setSessionForm] = useState<any>({
    name: 'End of Term Exam',
    academic_year_id: '',
    term_id: '',
    exam_type: 'end_of_term',
    start_date: today(),
    end_date: today(),
    notes: '',
    allow_additional: false,
  })
  const [paperForm, setPaperForm] = useState<any>({
    name: '',
    class_id: '',
    subject_id: '',
    teacher_id: '',
    assessment_type: 'end_of_term_exam',
    total_marks: '100',
    duration_minutes: '120',
    instructions: '',
    administering_teacher_id: '',
  })
  const [bulkPaperForm, setBulkPaperForm] = useState<any>({
    total_marks: '100',
    duration_minutes: '120',
    instructions: '',
    administering_teacher_id: '',
  })
  const [timetableForm, setTimetableForm] = useState<any>({
    assessment_id: '',
    exam_date: today(),
    start_time: '08:00',
    end_time: '10:00',
    room: '',
    invigilator_teacher_id: '',
  })

  const refresh = async (preferredSessionId = selectedSessionId) => {
    if (!token) return
    setError('')
    const [sessionPayload, academicPayload, classPayload, subjectPayload, teacherPayload, assignmentPayload] = await Promise.all([
      api.listExamSessions(token),
      api.getAcademicSession(token).catch(() => ({ years: [], terms: [], current: {} })),
      api.listClasses(token).catch(() => ({ classes: [] })),
      api.listSubjects(token).catch(() => ({ subjects: [] })),
      api.listTeachers(token).catch(() => ({ teachers: [] })),
      api.listTeacherAssignments(token).catch(() => ({ assignments: [] })),
    ])
    const nextSessions = sessionPayload?.sessions || []
    setSessions(nextSessions)
    setSetup({
      years: academicPayload?.years || [],
      terms: academicPayload?.terms || [],
      classes: classPayload?.classes || [],
      subjects: subjectPayload?.subjects || [],
      teachers: teacherPayload?.teachers || [],
      assignments: assignmentPayload?.assignments || [],
    })
    const activeYearId = academicPayload?.current?.academic_year?.id || sessionPayload?.session?.academic_year_id
    const activeTermId = academicPayload?.current?.term?.id || sessionPayload?.session?.term_id
    setSessionForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYearId || ''),
      term_id: current.term_id || String(activeTermId || ''),
    }))
    const nextSelectedId = preferredSessionId || String(nextSessions[0]?.id || '')
    setSelectedSessionId(nextSelectedId)
    if (nextSelectedId) {
      const nextDetail = await api.getExamSession(token, nextSelectedId)
      setDetail(nextDetail)
    } else {
      setDetail(null)
    }
  }

  useEffect(() => {
    refresh().catch((err: any) => setError(err?.message || 'Unable to load exam sessions.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const selectedSession = detail?.exam_session || sessions.find((row) => String(row.id) === String(selectedSessionId))
  const papers = detail?.papers || []
  const timetable = detail?.timetable || []
  const batches = detail?.batches || []
  const reportCards = detail?.report_cards || []
  const issues = detail?.issues || {}
  const assignedSubjectTeacher = useMemo(() => {
    if (!paperForm.class_id || !paperForm.subject_id) return null
    return (setup.assignments || []).find((row: any) =>
      row.is_active &&
      row.role === 'subject_teacher' &&
      String(row.class_id) === String(paperForm.class_id) &&
      String(row.subject_id) === String(paperForm.subject_id)
    ) || null
  }, [paperForm.class_id, paperForm.subject_id, setup.assignments])
  const bulkAssignableCount = useMemo(() => {
    const keys = new Set(
      (setup.assignments || [])
        .filter((row: any) => row.is_active && row.role === 'subject_teacher' && row.subject_id)
        .map((row: any) => `${row.class_id}:${row.subject_id}`),
    )
    return keys.size
  }, [setup.assignments])

  const kpis = useMemo(() => [
    { label: 'Exam Sessions', value: sessions.length, helper: 'current operational view', delta: 'school scoped' },
    { label: 'Papers', value: papers.length, helper: selectedSession?.name || 'select a session', delta: `${papers.filter((row: any) => ['approved', 'scheduled', 'marking', 'results_submitted', 'results_approved', 'locked'].includes(row.status)).length} active` },
    { label: 'Submitted Batches', value: batches.filter((row: any) => row.status === 'submitted').length, helper: 'awaiting approval', delta: 'headteacher queue' },
    { label: 'Report Cards', value: reportCards.length, helper: 'approved result data', delta: 'print ready' },
  ], [batches, papers, reportCards.length, selectedSession?.name, sessions.length])

  const run = async (action: () => Promise<any>, success: string | ((result: any) => string)) => {
    setError('')
    setMessage('')
    try {
      const result = await action()
      const successText = typeof success === 'function' ? success(result) : success
      setMessage(successText)
      toast.success(successText)
      await refresh(selectedSessionId || String(result?.exam_session?.id || ''))
      return result
    } catch (err: any) {
      const nextError = err?.message || 'Action failed.'
      setError(nextError)
      toast.error(nextError)
      return null
    }
  }

  const createSession = () => run(async () => {
    const result = await api.createExamSession(token, sessionForm)
    setSessionForm((current: any) => ({ ...current, name: 'End of Term Exam', notes: '', allow_additional: false }))
    setSelectedSessionId(String(result?.exam_session?.id || ''))
    return result
  }, 'Exam session created.')

  const changeSessionStatus = (status: string) => run(() => api.updateExamSessionStatus(token, selectedSessionId, status), `Exam session moved to ${valueLabel(status)}.`)

  const createPaper = () => run(async () => {
    await api.createExamPaper(token, selectedSessionId, {
      ...paperForm,
      teacher_id: assignedSubjectTeacher?.teacher_id || '',
    })
    setPaperForm((current: any) => ({ ...current, name: '', instructions: '', administering_teacher_id: '' }))
  }, 'Exam paper created.')

  const createBulkPapers = () => run(async () => {
    const result = await api.createBulkExamPapers(token, selectedSessionId, {
      ...bulkPaperForm,
      assessment_type: selectedSession?.exam_type === 'mid_term' ? 'mid_term' : selectedSession?.exam_type === 'mock' ? 'mock_exam' : selectedSession?.exam_type === 'final' ? 'final_exam' : 'end_of_term_exam',
    })
    const skipped = Number(result?.skipped_count || 0)
    if (skipped) toast.message(`${skipped} paper${skipped === 1 ? '' : 's'} already existed and were skipped.`)
    setBulkPaperForm((current: any) => ({ ...current, instructions: '', administering_teacher_id: '' }))
    return result
  }, (result) => `${Number(result?.created_count || 0)} whole-school exam paper${Number(result?.created_count || 0) === 1 ? '' : 's'} created.`)

  const changePaperStatus = (paper: any, status: string) => run(() => api.updateExamPaperStatus(token, selectedSessionId, paper.id, status), `Paper moved to ${valueLabel(status)}.`)

  const createTimetable = () => run(async () => {
    const result = await api.createExamTimetableEntry(token, selectedSessionId, timetableForm)
    const warnings = result?.warnings || []
    if (warnings.length) {
      const warningText = `Timetable entry saved. ${warnings.join(' ')}`
      setMessage(warningText)
      toast.warning(warningText)
    }
    setTimetableForm((current: any) => ({ ...current, room: '' }))
  }, 'Timetable entry saved.')

  const removeTimetable = (entry: any) => run(() => api.deleteExamTimetableEntry(token, selectedSessionId, entry.id), 'Timetable entry removed.')

  const approveBatch = (batch: any) => run(() => api.approveResultBatch(token, batch.id), 'Result batch approved and report card data generated.')

  const returnBatch = (batch: any) => {
    if (!returnReason.trim()) {
      setError('Return reason is required.')
      toast.error('Return reason is required.')
      return
    }
    run(async () => {
      await api.returnResultBatch(token, batch.id, { reason: returnReason })
      setReturnReason('')
    }, 'Result batch returned for correction.')
  }

  const loadReportCard = async (card: any) => {
    if (!token) return
    setError('')
    try {
      const payload = await api.getReportCard(token, card.id)
      setReportCard(payload?.report_card || null)
      setActiveTab('report-cards')
    } catch (err: any) {
      const nextError = err?.message || 'Unable to load report card.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const selectSession = async (row: any) => {
    const id = String(row.id)
    setSelectedSessionId(id)
    setReportCard(null)
    setActiveTab('overview')
    await refresh(id)
  }

  const tabs = [
    ['overview', 'Overview'],
    ['papers', 'Exam Papers'],
    ['timetable', 'Timetable'],
    ['batches', 'Result Batches'],
    ['report-cards', 'Report Cards'],
    ['issues', 'Issues'],
  ]

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[8px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-medium text-[var(--mera-panel-text)]">Exam Sessions</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">
              Formal end-of-term exam cycles, paper approval, timetables, result batches and report cards.
            </p>
          </div>
          {selectedSession ? <StatusPill value={selectedSession.status} /> : null}
        </div>
      </section>

      <SectionKpiStrip items={kpis} />

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-medium text-[#b91c1c]">{error}</div> : null}
      {message ? <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] font-medium text-[#166534]">{message}</div> : null}

      <div className="grid gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          {canManage ? (
            <SectionCard title="Create Exam Session" subtitle="Use the active academic year and term unless you are creating history intentionally.">
              <div className="grid gap-3 p-4">
                <Field label="Name"><Input className="h-8 text-[12px]" value={sessionForm.name} onChange={(event) => setSessionForm({ ...sessionForm, name: event.target.value })} /></Field>
                <Field label="Academic Year">
                  <select className={selectClassName} value={sessionForm.academic_year_id} onChange={(event) => setSessionForm({ ...sessionForm, academic_year_id: event.target.value })}>
                    <option value="">Select year</option>
                    {setup.years.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </Field>
                <Field label="Term">
                  <select className={selectClassName} value={sessionForm.term_id} onChange={(event) => setSessionForm({ ...sessionForm, term_id: event.target.value })}>
                    <option value="">Select term</option>
                    {setup.terms.map((row: any) => <option key={row.id} value={row.id}>{row.academic_year_name} · {row.name}</option>)}
                  </select>
                </Field>
                <Field label="Exam Type">
                  <select className={selectClassName} value={sessionForm.exam_type} onChange={(event) => setSessionForm({ ...sessionForm, exam_type: event.target.value })}>
                    <option value="end_of_term">End of Term</option>
                    <option value="mid_term">Mid Term</option>
                    <option value="mock">Mock</option>
                    <option value="final">Final</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Start"><Input type="date" className="h-8 text-[12px]" value={sessionForm.start_date} onChange={(event) => setSessionForm({ ...sessionForm, start_date: event.target.value })} /></Field>
                  <Field label="End"><Input type="date" className="h-8 text-[12px]" value={sessionForm.end_date} onChange={(event) => setSessionForm({ ...sessionForm, end_date: event.target.value })} /></Field>
                </div>
                <Field label="Notes"><Textarea className="min-h-16 text-[12px]" value={sessionForm.notes} onChange={(event) => setSessionForm({ ...sessionForm, notes: event.target.value })} /></Field>
                <label className="flex items-center gap-2 text-[12px] font-medium text-[#333333]">
                  <input type="checkbox" checked={sessionForm.allow_additional} onChange={(event) => setSessionForm({ ...sessionForm, allow_additional: event.target.checked })} />
                  Intentionally create another end-of-term session for this term
                </label>
                <Button disabled={!sessionForm.name || !sessionForm.academic_year_id || !sessionForm.term_id} type="button" className="h-8 rounded-[5px] text-[12px]" onClick={createSession}>
                  <Plus className="size-3.5" />
                  Create Exam Session
                </Button>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Sessions" subtitle="Archived sessions are hidden from the current view.">
            <PortalTable
              columns={[
                { key: 'name', label: 'Session' },
                { key: 'term_name', label: 'Term' },
                { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                { key: 'paper_count', label: 'Papers' },
              ]}
              rows={sessions}
              onRowClick={selectSession}
              emptyMessage="No exam sessions have been created for the current term."
            />
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-3">
          {!selectedSession ? (
            <SectionCard title="Select an Exam Session" subtitle="Create or select a session to manage the exam cycle.">
              <div className="p-6 text-[13px] text-[#8b8b8b]">No exam session is selected.</div>
            </SectionCard>
          ) : (
            <>
              <SectionCard title={selectedSession.name} subtitle={`${selectedSession.academic_year_name || ''} · ${selectedSession.term_name || ''} · ${dateLabel(selectedSession.start_date)} to ${dateLabel(selectedSession.end_date)}`}>
                <div className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#dddddd] pb-3">
                    {tabs.map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setActiveTab(id)} className={`h-8 rounded-[5px] px-3 text-[12px] font-medium transition ${activeTab === id ? 'bg-[#111111] text-white' : 'bg-[#f7f7f7] text-[#333333] hover:bg-[#eeeeee]'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'overview' ? (
                    <div className="grid gap-3">
                      <div className="grid gap-3 md:grid-cols-4">
                        <MetricTile label="Exam Type" value={valueLabel(selectedSession.exam_type)} />
                        <MetricTile label="Papers" value={papers.length} />
                        <MetricTile label="Batches" value={batches.length} />
                        <MetricTile label="Cards" value={reportCards.length} />
                      </div>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => changeSessionStatus('scheduled')}>Schedule Session</Button>
                          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => changeSessionStatus('marking')}>Move to Marking</Button>
                          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => changeSessionStatus('results_approved')}>Results Approved</Button>
                          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => changeSessionStatus('locked')}><Lock className="size-3.5" /> Lock Session</Button>
                          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => changeSessionStatus('archived')}><Archive className="size-3.5" /> Archive</Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab === 'papers' ? (
                    <div className="grid gap-3">
                      <div className="grid gap-3 rounded-[8px] border border-[#dddddd] bg-[#fafafa] p-3 md:grid-cols-3">
                        <Field label="Paper Name"><Input className="h-8 text-[12px]" value={paperForm.name} onChange={(event) => setPaperForm({ ...paperForm, name: event.target.value })} /></Field>
                        <Field label="Class">
                          <select className={selectClassName} value={paperForm.class_id} onChange={(event) => setPaperForm({ ...paperForm, class_id: event.target.value })}>
                            <option value="">Select class</option>
                            {setup.classes.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Subject">
                          <select className={selectClassName} value={paperForm.subject_id} onChange={(event) => setPaperForm({ ...paperForm, subject_id: event.target.value })}>
                            <option value="">Select subject</option>
                            {setup.subjects.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Subject Teacher"><Input className="h-8 text-[12px]" value={assignedSubjectTeacher?.teacher_name || ''} placeholder="No subject teacher assigned" readOnly /></Field>
                        {canManage ? (
                          <Field label="Administering Exception">
                            <select className={selectClassName} value={paperForm.administering_teacher_id} onChange={(event) => setPaperForm({ ...paperForm, administering_teacher_id: event.target.value })}>
                              <option value="">No exception</option>
                              {setup.teachers.map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
                            </select>
                          </Field>
                        ) : null}
                        <Field label="Total Marks"><Input className="h-8 text-[12px]" type="number" value={paperForm.total_marks} onChange={(event) => setPaperForm({ ...paperForm, total_marks: event.target.value })} /></Field>
                        <Field label="Duration Minutes"><Input className="h-8 text-[12px]" type="number" value={paperForm.duration_minutes} onChange={(event) => setPaperForm({ ...paperForm, duration_minutes: event.target.value })} /></Field>
                        <Field label="Instructions"><Textarea className="min-h-16 text-[12px] md:col-span-3" value={paperForm.instructions} onChange={(event) => setPaperForm({ ...paperForm, instructions: event.target.value })} /></Field>
                        <Button type="button" disabled={!selectedSessionId || !paperForm.name || !paperForm.class_id || !paperForm.subject_id || !assignedSubjectTeacher} className="h-8 rounded-[5px] text-[12px] md:col-span-3" onClick={createPaper}>
                          <Plus className="size-3.5" />
                          Create Exam Paper
                        </Button>
                      </div>
                      {canManage ? (
                        <div className="grid gap-3 rounded-[8px] border border-[#dbeafe] bg-[#eff6ff] p-3 md:grid-cols-4">
                          <Field label="Total Marks"><Input className="h-8 text-[12px]" type="number" value={bulkPaperForm.total_marks} onChange={(event) => setBulkPaperForm({ ...bulkPaperForm, total_marks: event.target.value })} /></Field>
                          <Field label="Duration Minutes"><Input className="h-8 text-[12px]" type="number" value={bulkPaperForm.duration_minutes} onChange={(event) => setBulkPaperForm({ ...bulkPaperForm, duration_minutes: event.target.value })} /></Field>
                          <Field label="Administering Exception">
                            <select className={selectClassName} value={bulkPaperForm.administering_teacher_id} onChange={(event) => setBulkPaperForm({ ...bulkPaperForm, administering_teacher_id: event.target.value })}>
                              <option value="">No exception</option>
                              {setup.teachers.map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
                            </select>
                          </Field>
                          <Field label="Ready Assignments"><Input className="h-8 text-[12px]" value={`${bulkAssignableCount}`} readOnly /></Field>
                          <Field label="Instructions"><Textarea className="min-h-16 text-[12px] md:col-span-4" value={bulkPaperForm.instructions} onChange={(event) => setBulkPaperForm({ ...bulkPaperForm, instructions: event.target.value })} /></Field>
                          <Button type="button" disabled={!selectedSessionId || !bulkAssignableCount} className="h-8 rounded-[5px] text-[12px] md:col-span-4" onClick={createBulkPapers}>
                            <ClipboardCheck className="size-3.5" />
                            Create Whole-School Papers
                          </Button>
                        </div>
                      ) : null}
                      <PortalTable
                        columns={[
                          { key: 'name', label: 'Paper' },
                          { key: 'class_name', label: 'Class' },
                          { key: 'subject_name', label: 'Subject' },
                          { key: 'teacher_name', label: 'Subject Teacher' },
                          { key: 'administering_teacher_name', label: 'Administered By', render: (row) => row.administering_teacher_name || '-' },
                          { key: 'total_marks', label: 'Marks' },
                          { key: 'duration_minutes', label: 'Minutes' },
                          { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                          {
                            key: 'actions',
                            label: 'Actions',
                            render: (row) => (
                              <span className="inline-flex flex-wrap gap-1">
                                {role === 'teacher' ? (
                                  <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#dbeafe] px-2 text-[11px] font-medium text-[#1d4ed8]" onClick={(event) => { event.stopPropagation(); changePaperStatus(row, 'ready_for_review') }}><Send className="size-3" /> Review</button>
                                ) : (
                                  <>
                                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#bbf7d0] px-2 text-[11px] font-medium text-[#166534]" onClick={(event) => { event.stopPropagation(); changePaperStatus(row, 'approved') }}><CheckCircle2 className="size-3" /> Approve</button>
                                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#fed7aa] px-2 text-[11px] font-medium text-[#c2410c]" onClick={(event) => { event.stopPropagation(); changePaperStatus(row, 'returned') }}><RotateCcw className="size-3" /> Return</button>
                                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#dddddd] px-2 text-[11px] font-medium text-[#333333]" onClick={(event) => { event.stopPropagation(); changePaperStatus(row, 'locked') }}><Lock className="size-3" /> Lock</button>
                                  </>
                                )}
                              </span>
                            ),
                          },
                        ]}
                        rows={papers}
                        emptyMessage="No papers have been created for this exam session."
                      />
                    </div>
                  ) : null}

                  {activeTab === 'timetable' ? (
                    <div className="grid gap-3">
                      {canManage ? (
                        <div className="grid gap-3 rounded-[8px] border border-[#dddddd] bg-[#fafafa] p-3 md:grid-cols-3">
                          <Field label="Paper">
                            <select className={selectClassName} value={timetableForm.assessment_id} onChange={(event) => setTimetableForm({ ...timetableForm, assessment_id: event.target.value })}>
                              <option value="">Select approved paper</option>
                              {papers.map((row: any) => <option key={row.id} value={row.id}>{row.class_name} · {row.subject_name} · {row.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Date"><Input type="date" className="h-8 text-[12px]" value={timetableForm.exam_date} onChange={(event) => setTimetableForm({ ...timetableForm, exam_date: event.target.value })} /></Field>
                          <Field label="Room"><Input className="h-8 text-[12px]" value={timetableForm.room} onChange={(event) => setTimetableForm({ ...timetableForm, room: event.target.value })} /></Field>
                          <Field label="Start"><Input type="time" className="h-8 text-[12px]" value={timetableForm.start_time} onChange={(event) => setTimetableForm({ ...timetableForm, start_time: event.target.value })} /></Field>
                          <Field label="End"><Input type="time" className="h-8 text-[12px]" value={timetableForm.end_time} onChange={(event) => setTimetableForm({ ...timetableForm, end_time: event.target.value })} /></Field>
                          <Field label="Invigilator">
                            <select className={selectClassName} value={timetableForm.invigilator_teacher_id} onChange={(event) => setTimetableForm({ ...timetableForm, invigilator_teacher_id: event.target.value })}>
                              <option value="">Not assigned</option>
                              {setup.teachers.map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
                            </select>
                          </Field>
                          <Button type="button" disabled={!timetableForm.assessment_id} className="h-8 rounded-[5px] text-[12px] md:col-span-3" onClick={createTimetable}>
                            <Save className="size-3.5" />
                            Add Timetable Entry
                          </Button>
                        </div>
                      ) : null}
                      <PortalTable
                        columns={[
                          { key: 'exam_date', label: 'Date', render: (row) => dateLabel(row.exam_date) },
                          { key: 'time', label: 'Time', render: (row) => `${String(row.start_time || '').slice(0, 5)} - ${String(row.end_time || '').slice(0, 5)}` },
                          { key: 'class_name', label: 'Class' },
                          { key: 'subject_name', label: 'Subject' },
                          { key: 'room', label: 'Room' },
                          { key: 'invigilator_name', label: 'Invigilator' },
                          { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                          { key: 'actions', label: 'Actions', render: (row) => canManage ? <button type="button" className="text-[11px] font-medium text-[#b91c1c]" onClick={(event) => { event.stopPropagation(); removeTimetable(row) }}>Remove</button> : '-' },
                        ]}
                        rows={timetable}
                        emptyMessage="No timetable entries have been scheduled yet."
                      />
                    </div>
                  ) : null}

                  {activeTab === 'batches' ? (
                    <div className="grid gap-3">
                      {canManage ? <Input className="h-8 max-w-md text-[12px]" placeholder="Return reason for correction" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /> : null}
                      <PortalTable
                        columns={[
                          { key: 'assessment_name', label: 'Paper' },
                          { key: 'class_name', label: 'Class' },
                          { key: 'subject_name', label: 'Subject' },
                          { key: 'teacher_name', label: 'Teacher' },
                          { key: 'saved_marks', label: 'Saved' },
                          { key: 'missing_marks', label: 'Missing' },
                          { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                          {
                            key: 'actions',
                            label: 'Actions',
                            render: (row) => canManage ? (
                              <span className="inline-flex gap-1">
                                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#bbf7d0] px-2 text-[11px] font-medium text-[#166534]" onClick={(event) => { event.stopPropagation(); approveBatch(row) }}><CheckCircle2 className="size-3" /> Approve</button>
                                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#fed7aa] px-2 text-[11px] font-medium text-[#c2410c]" onClick={(event) => { event.stopPropagation(); returnBatch(row) }}><RotateCcw className="size-3" /> Return</button>
                              </span>
                            ) : '-',
                          },
                        ]}
                        rows={batches}
                        emptyMessage="No result batches have been saved for this exam session."
                      />
                    </div>
                  ) : null}

                  {activeTab === 'report-cards' ? (
                    <div className="grid gap-3">
                      <PortalTable
                        columns={[
                          { key: 'student_code', label: 'Student ID' },
                          { key: 'student', label: 'Student', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() },
                          { key: 'class_name', label: 'Class' },
                          { key: 'average_score', label: 'Average', render: (row) => row.average_score === null || row.average_score === undefined ? '-' : `${Number(row.average_score).toFixed(1)}%` },
                          { key: 'grade', label: 'Grade' },
                          { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                          { key: 'actions', label: 'Actions', render: (row) => <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#dddddd] px-2 text-[11px] font-medium text-[#333333]" onClick={(event) => { event.stopPropagation(); loadReportCard(row) }}><Printer className="size-3" /> View</button> },
                        ]}
                        rows={reportCards}
                        emptyMessage="Report cards appear after submitted result batches are approved."
                      />
                      {reportCard ? (
                        <div className="rounded-[8px] border border-[#dddddd] bg-white p-4 shadow-[var(--mera-shadow-card)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h2 className="text-[18px] font-medium text-[#171717]">{reportCard.school_name}</h2>
                              <p className="mt-1 text-[12px] text-[#8b8b8b]">{reportCard.exam_session_name || 'Term Report'} · {reportCard.academic_year_name} · {reportCard.term_name}</p>
                              <p className="mt-3 text-[13px] font-medium text-[#171717]">{reportCard.first_name} {reportCard.last_name} · {reportCard.student_code}</p>
                            </div>
                            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
                          </div>
                          <PortalTable
                            columns={[
                              { key: 'subject_name', label: 'Subject' },
                              { key: 'assessment_name', label: 'Paper' },
                              { key: 'score', label: 'Score', render: (row) => `${Number(row.score || 0).toFixed(1)}%` },
                              { key: 'grade', label: 'Grade' },
                              { key: 'comment', label: 'Comment' },
                            ]}
                            rows={reportCard.subjects || []}
                            emptyMessage="No approved subject results found."
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab === 'issues' ? (
                    <div className="grid gap-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <MetricTile label="Draft / Returned Papers" value={(issues.draft_papers || []).length} />
                        <MetricTile label="Pending Batches" value={(issues.pending_batches || []).length} />
                        <MetricTile label="Missing Mark Sheets" value={(issues.missing_marks || []).length} />
                      </div>
                      <PortalTable
                        columns={[
                          { key: 'class_name', label: 'Class' },
                          { key: 'subject_name', label: 'Subject' },
                          { key: 'name', label: 'Paper' },
                          { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                        ]}
                        rows={issues.draft_papers || []}
                        emptyMessage="No draft or returned exam papers."
                      />
                      <PortalTable
                        columns={[
                          { key: 'class_name', label: 'Class' },
                          { key: 'subject_name', label: 'Subject' },
                          { key: 'name', label: 'Paper' },
                          { key: 'missing_marks', label: 'Missing Marks' },
                        ]}
                        rows={issues.missing_marks || []}
                        emptyMessage="No missing marks detected for active sitting lists."
                      />
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

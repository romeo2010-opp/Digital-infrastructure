import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, RotateCcw, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

function statusLabel(value: any) {
  return String(value || 'draft').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function ResultsEntryPage() {
  const { token, api, user } = usePortal()
  const [setup, setSetup] = useState<any>({})
  const [filters, setFilters] = useState<any>({ academic_year_id: '', term_id: '', exam_session_id: '', class_id: '', subject_id: '' })
  const [selectedAssessmentId, setSelectedAssessmentId] = useState('')
  const [sheet, setSheet] = useState<any>(null)
  const [classSheet, setClassSheet] = useState<any>(null)
  const [classSheetLoading, setClassSheetLoading] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [unsaved, setUnsaved] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  const role = String(user?.role || '').toLowerCase()
  const canApprove = ['school_owner', 'headteacher'].includes(role)
  const filteredAssessments = useMemo(() => {
    return (setup.assessments || []).filter((row: any) => {
      if (filters.academic_year_id && String(row.academic_year_id) !== String(filters.academic_year_id)) return false
      if (filters.term_id && String(row.term_id) !== String(filters.term_id)) return false
      if (filters.exam_session_id && String(row.exam_session_id || '') !== String(filters.exam_session_id)) return false
      if (filters.class_id && String(row.class_id) !== String(filters.class_id)) return false
      if (filters.subject_id && String(row.subject_id) !== String(filters.subject_id)) return false
      return true
    })
  }, [filters, setup.assessments])
  const selectedAssessment = useMemo(() => filteredAssessments.find((row: any) => String(row.id) === selectedAssessmentId), [filteredAssessments, selectedAssessmentId])
  const batch = sheet?.batch
  const teacherLocked = role === 'teacher' && ['submitted', 'approved', 'locked'].includes(String(batch?.status || ''))

  const refreshSetup = async () => {
    if (!token) return
    const payload = await api.listResultsSetup(token)
    setSetup(payload)
    setFilters((current: any) => ({
      academic_year_id: current.academic_year_id || String(payload?.session?.academic_year_id || payload?.years?.[0]?.id || ''),
      term_id: current.term_id || String(payload?.session?.term_id || payload?.terms?.[0]?.id || ''),
      exam_session_id: current.exam_session_id || String(payload?.exam_sessions?.[0]?.id || ''),
      class_id: current.class_id || (canApprove ? String(payload?.classes?.[0]?.id || '') : ''),
      subject_id: current.subject_id,
    }))
    if (!canApprove && !selectedAssessmentId && payload.assessments?.[0]) setSelectedAssessmentId(String(payload.assessments[0].id))
  }

  const loadSheet = async (assessmentId = selectedAssessmentId) => {
    if (!token || !assessmentId) return
    const payload = await api.getResultSheet(token, { assessment_id: assessmentId })
    setSheet(payload)
    setRows(payload?.rows || [])
    setUnsaved(false)
  }

  const loadClassSheet = async (nextFilters = filters) => {
    if (!token || !nextFilters.academic_year_id || !nextFilters.term_id || !nextFilters.class_id) return
    setClassSheetLoading(true)
    setError('')
    try {
      const payload = await api.getClassResultSheet(token, {
        academic_year_id: nextFilters.academic_year_id,
        term_id: nextFilters.term_id,
        exam_session_id: nextFilters.exam_session_id,
        class_id: nextFilters.class_id,
      })
      setClassSheet(payload)
    } catch (err: any) {
      setClassSheet(null)
      setError(err?.message || 'Unable to load class result sheet.')
    } finally {
      setClassSheetLoading(false)
    }
  }

  useEffect(() => {
    refreshSetup().catch((err: any) => setError(err?.message || 'Unable to load results setup.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!canApprove && selectedAssessmentId) loadSheet(selectedAssessmentId).catch((err: any) => setError(err?.message || 'Unable to load result sheet.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssessmentId, canApprove])

  useEffect(() => {
    if (!canApprove) return
    if (!filters.academic_year_id || !filters.term_id || !filters.class_id) return
    loadClassSheet().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApprove, filters.academic_year_id, filters.term_id, filters.exam_session_id, filters.class_id])

  useEffect(() => {
    if (canApprove) return
    if (!filteredAssessments.length) {
      if (selectedAssessmentId) setSelectedAssessmentId('')
      return
    }
    if (!filteredAssessments.some((row: any) => String(row.id) === String(selectedAssessmentId))) {
      setSelectedAssessmentId(String(filteredAssessments[0].id))
    }
  }, [canApprove, filteredAssessments, selectedAssessmentId])

  const updateRow = (studentId: any, patch: any) => {
    setRows((current) => current.map((row) => Number(row.id) === Number(studentId) ? { ...row, ...patch } : row))
    setUnsaved(true)
  }

  const saveDraft = async () => {
    if (!token || !selectedAssessmentId) return
    setError('')
    setMessage('')
    try {
      await api.saveResultDraft(token, { assessment_id: selectedAssessmentId, entries: rows.map((row) => ({ student_id: row.id, enrollment_id: row.enrollment_id, score: row.score, comment: row.comment })) })
      setMessage('Draft results saved.')
      toast.success('Draft results saved.')
      await loadSheet()
      await refreshSetup()
    } catch (err: any) {
      const nextError = err?.message || 'Unable to save draft results.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const submitFinal = async () => {
    if (!token || !selectedAssessmentId) return
    if (!window.confirm('Submit final results? You may not be able to edit after submission.')) return
    setError('')
    setMessage('')
    try {
      await api.submitResults(token, { assessment_id: selectedAssessmentId, entries: rows.map((row) => ({ student_id: row.id, enrollment_id: row.enrollment_id, score: row.score, comment: row.comment })) })
      setMessage('Results submitted for approval.')
      toast.success('Results submitted for approval.')
      await loadSheet()
      await refreshSetup()
    } catch (err: any) {
      const nextError = err?.message || 'Unable to submit final results.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const approveBatch = async (row: any) => {
    if (!token) return
    setError('')
    setMessage('')
    try {
      await api.approveResultBatch(token, row.id)
      setMessage('Result batch approved.')
      toast.success('Result batch approved.')
      await refreshSetup()
      if (canApprove) await loadClassSheet()
      else await loadSheet()
    } catch (err: any) {
      const nextError = err?.message || 'Unable to approve result batch.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const returnBatch = async (row: any) => {
    if (!token) return
    if (!returnReason.trim()) {
      toast.error('Return reason is required.')
      return
    }
    setError('')
    setMessage('')
    try {
      await api.returnResultBatch(token, row.id, { reason: returnReason })
      setReturnReason('')
      setMessage('Result batch returned for correction.')
      toast.success('Result batch returned for correction.')
      await refreshSetup()
      if (canApprove) await loadClassSheet()
      else await loadSheet()
    } catch (err: any) {
      const nextError = err?.message || 'Unable to return result batch.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const completed = rows.filter((row) => row.score !== '' && row.score !== null && row.score !== undefined).length
  const totalMarks = Number(selectedAssessment?.total_marks || sheet?.assessment?.total_marks || 0)
  const sheetAssessment = selectedAssessment || sheet?.assessment || {}
  const subjectName = sheetAssessment?.subject_name || sheet?.assessment?.subject_name || '-'
  const className = sheetAssessment?.class_name || sheet?.assessment?.class_name || '-'
  const paperName = sheetAssessment?.name || sheetAssessment?.assessment_name || sheet?.assessment?.name || '-'
  const examSessionName = sheetAssessment?.exam_session_name || sheet?.assessment?.exam_session_name || ''
  const termName = sheetAssessment?.term_label || sheetAssessment?.term_name || sheet?.assessment?.term_name || '-'
  const assessmentType = sheetAssessment?.assessment_type ? statusLabel(sheetAssessment.assessment_type) : 'Assessment'
  const marksHeader = subjectName && subjectName !== '-' ? `${subjectName} Score / ${totalMarks || '-'}` : `Score / ${totalMarks || '-'}`
  const classPapers = classSheet?.papers || []
  const classRows = classSheet?.rows || []
  const classSummary = classSheet?.summary || {}
  const selectedClassName = classSheet?.class?.name || (setup.classes || []).find((row: any) => String(row.id) === String(filters.class_id))?.name || '-'
  const selectedExamName = classSheet?.exam_session?.name || (setup.exam_sessions || []).find((row: any) => String(row.id) === String(filters.exam_session_id))?.name || 'All assessments'
  const kpiItems = canApprove
    ? [
      { label: 'Class', value: selectedClassName, helper: selectedExamName, delta: classSheetLoading ? 'loading' : 'loaded' },
      { label: 'Students', value: classSummary.students || classRows.length || 0, helper: 'active enrollment', delta: 'current term' },
      { label: 'Subjects / Papers', value: classSummary.papers || classPapers.length || 0, helper: 'visible columns', delta: 'class sheet' },
      { label: 'Complete Students', value: classSummary.complete_students || 0, helper: 'all marks entered', delta: `${classSummary.missing_marks || 0} missing marks` },
    ]
    : [
      { label: 'Assessments', value: filteredAssessments.length || 0, helper: role === 'teacher' ? 'assigned only' : 'whole school', delta: 'filtered' },
      { label: 'Subject', value: subjectName, helper: className, delta: assessmentType },
      { label: 'Paper', value: paperName, helper: examSessionName || termName, delta: statusLabel(batch?.status) },
      { label: 'Completed Marks', value: `${completed}/${rows.length}`, helper: 'current sheet', delta: rows.length ? `${Math.round((completed / rows.length) * 100)}%` : '0%' },
      { label: 'Sheet Status', value: statusLabel(batch?.status), helper: selectedAssessment?.status ? statusLabel(selectedAssessment.status) : 'workflow', delta: teacherLocked ? 'locked' : 'editable' },
    ]

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Results</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">Excel-like marks entry with draft save, final submission and headteacher approval.</p>
          </div>
          {unsaved ? <span className="rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#c2410c]">Unsaved changes</span> : null}
        </div>
      </section>

      <SectionKpiStrip items={kpiItems} />

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {message ? <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] font-semibold text-[#166534]">{message}</div> : null}

      {canApprove ? (
        <>
          <SectionCard title="Class Results Setup" subtitle="Headteacher view shows every subject and grade for the selected class.">
            <div className="grid gap-3 p-4 md:grid-cols-4">
              <Field label="Academic Year">
                <select className={selectClassName} value={filters.academic_year_id} onChange={(event) => setFilters({ ...filters, academic_year_id: event.target.value })}>
                  <option value="">Select year</option>
                  {(setup.years || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select className={selectClassName} value={filters.term_id} onChange={(event) => setFilters({ ...filters, term_id: event.target.value })}>
                  <option value="">Select term</option>
                  {(setup.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.academic_year_name || ''} {row.name}</option>)}
                </select>
              </Field>
              <Field label="Exam Session">
                <select className={selectClassName} value={filters.exam_session_id} onChange={(event) => setFilters({ ...filters, exam_session_id: event.target.value })}>
                  <option value="">All assessments</option>
                  {(setup.exam_sessions || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Class">
                <select className={selectClassName} value={filters.class_id} onChange={(event) => setFilters({ ...filters, class_id: event.target.value })}>
                  <option value="">Select class</option>
                  {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title={`${selectedClassName} Class Results Sheet`} subtitle="Each subject column shows score, grade and current result status.">
            <div className="overflow-hidden">
              <div className="grid gap-2 border-b border-[#e2e8f0] bg-[#fafafa] p-3 md:grid-cols-4">
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Class</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{selectedClassName}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Exam Session</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{selectedExamName}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Papers</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{classPapers.length}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Missing Marks</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{classSummary.missing_marks || 0}</p>
                </div>
              </div>
              <div className="max-h-[66vh] overflow-auto">
                <table className="w-full min-w-[980px] text-left text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[#111827] text-white">
                    <tr>
                      <th className="sticky left-0 z-20 min-w-[120px] bg-[#111827] px-3 py-2">Student ID</th>
                      <th className="sticky left-[120px] z-20 min-w-[190px] bg-[#111827] px-3 py-2">Student Name</th>
                      <th className="px-3 py-2">Stream</th>
                      {classPapers.map((paper: any) => (
                        <th key={paper.id} className="min-w-[150px] px-3 py-2">
                          <span className="block text-[12px] font-semibold">{paper.subject_name}</span>
                          <span className="block text-[10px] font-medium text-white/70">{paper.assessment_name} / {paper.total_marks}</span>
                        </th>
                      ))}
                      <th className="px-3 py-2">Average</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classRows.length ? classRows.map((row: any, index: number) => (
                      <tr key={row.id} className={`${index % 2 === 0 ? 'bg-[#f3f4f6]' : 'bg-[#d1d5db]'} border-b border-white/70 text-[#111827]`}>
                        <td className={`sticky left-0 z-10 px-3 py-2 font-semibold ${index % 2 === 0 ? 'bg-[#f3f4f6]' : 'bg-[#d1d5db]'}`}>{row.student_id || row.admission_no}</td>
                        <td className={`sticky left-[120px] z-10 px-3 py-2 font-semibold ${index % 2 === 0 ? 'bg-[#f3f4f6]' : 'bg-[#d1d5db]'}`}>{row.last_name}, {row.first_name}</td>
                        <td className="px-3 py-2">{row.stream_section || '-'}</td>
                        {classPapers.map((paper: any) => {
                          const result = row.results?.[paper.id]
                          return (
                            <td key={`${row.id}-${paper.id}`} className="px-3 py-2">
                              {result ? (
                                <div className="grid gap-0.5">
                                  <span className="font-semibold">{result.score ?? '-'} / {paper.total_marks}</span>
                                  <span className="text-[11px] text-[#374151]">{result.grade || '-'} · {statusLabel(result.status)}</span>
                                </div>
                              ) : (
                                <span className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-2 py-0.5 text-[11px] font-semibold text-[#b91c1c]">Missing</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 font-semibold">{row.average_score === null || row.average_score === undefined ? '-' : `${row.average_score}%`}</td>
                        <td className="px-3 py-2 font-semibold">{row.average_grade || '-'}</td>
                        <td className="px-3 py-2">{row.missing_subjects || 0}</td>
                      </tr>
                    )) : (
                      <tr><td className="px-3 py-8 text-center text-[#6b7280]" colSpan={Math.max(7, classPapers.length + 6)}>{classSheetLoading ? 'Loading class results...' : 'Select a class to view all subject results.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>
        </>
      ) : (
        <>
          <SectionCard title="Sheet Setup" subtitle="Teachers only see assigned classes, subjects and assessments">
            <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
              <Field label="Academic Year">
                <select className={selectClassName} value={filters.academic_year_id} onChange={(event) => setFilters({ ...filters, academic_year_id: event.target.value })}>
                  <option value="">All years</option>
                  {(setup.years || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select className={selectClassName} value={filters.term_id} onChange={(event) => setFilters({ ...filters, term_id: event.target.value })}>
                  <option value="">All terms</option>
                  {(setup.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.academic_year_name || ''} {row.name}</option>)}
                </select>
              </Field>
              <Field label="Exam Session">
                <select className={selectClassName} value={filters.exam_session_id} onChange={(event) => setFilters({ ...filters, exam_session_id: event.target.value })}>
                  <option value="">All assessments</option>
                  {(setup.exam_sessions || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Class">
                <select className={selectClassName} value={filters.class_id} onChange={(event) => setFilters({ ...filters, class_id: event.target.value })}>
                  <option value="">All classes</option>
                  {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Subject">
                <select className={selectClassName} value={filters.subject_id} onChange={(event) => setFilters({ ...filters, subject_id: event.target.value })}>
                  <option value="">All subjects</option>
                  {(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Assessment">
                <select className={selectClassName} value={selectedAssessmentId} onChange={(event) => setSelectedAssessmentId(event.target.value)}>
                  <option value="">Select assessment</option>
                  {filteredAssessments.map((row: any) => (
                    <option key={row.id} value={row.id}>{row.exam_session_name ? `${row.exam_session_name} · ` : ''}{row.class_name} · {row.subject_name} · {row.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title={subjectName && subjectName !== '-' ? `${subjectName} Mark Sheet` : 'Marks Entry Sheet'} subtitle="Rows are sorted alphabetically by student last name">
            <div className="overflow-hidden">
              <div className="grid gap-2 border-b border-[#e2e8f0] bg-[#fafafa] p-3 md:grid-cols-4">
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Subject</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{subjectName}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Paper</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{paperName}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Exam Session</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{examSessionName || '-'}</p>
                </div>
                <div className="rounded-[6px] border border-[#dddddd] bg-white px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#8b8b8b]">Class / Term</p>
                  <p className="mt-1 truncate text-[14px] font-medium text-[#171717]">{className} · {termName}</p>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[760px] text-left text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[#111827] text-white">
                    <tr>
                      <th className="px-3 py-2">Student ID</th>
                      <th className="px-3 py-2">Student Name</th>
                      <th className="px-3 py-2">Class</th>
                      <th className="px-3 py-2">Stream</th>
                      <th className="px-3 py-2">Enrollment</th>
                      <th className="px-3 py-2">{marksHeader}</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2">Comment</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? rows.map((row, index) => {
                      const score = row.score === '' ? '' : Number(row.score)
                      const invalid = score !== '' && (score < 0 || score > totalMarks)
                      return (
                        <tr key={row.id} className={`${index % 2 === 0 ? 'bg-[#f3f4f6]' : 'bg-[#d1d5db]'} border-b border-white/70 text-[#111827]`}>
                          <td className="px-3 py-2 font-semibold">{row.student_id || row.admission_no}</td>
                          <td className="px-3 py-2 font-semibold">{row.last_name}, {row.first_name}</td>
                          <td className="px-3 py-2">{row.class_name}</td>
                          <td className="px-3 py-2">{row.stream_section || '-'}</td>
                          <td className="px-3 py-2">{statusLabel(row.enrollment_status)}</td>
                          <td className="px-3 py-2">
                            <Input
                              disabled={teacherLocked}
                              type="number"
                              min="0"
                              max={totalMarks || undefined}
                              className={`h-8 w-24 bg-white text-[12px] ${invalid ? 'border-[#dc2626] text-[#dc2626]' : ''}`}
                              value={row.score ?? ''}
                              onChange={(event) => updateRow(row.id, { score: event.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2 font-semibold">{row.grade || '-'}</td>
                          <td className="px-3 py-2"><Input disabled={teacherLocked} className="h-8 bg-white text-[12px]" value={row.comment || ''} onChange={(event) => updateRow(row.id, { comment: event.target.value })} /></td>
                          <td className="px-3 py-2">{statusLabel(row.status)}</td>
                          <td className="px-3 py-2">{row.last_saved_at ? new Date(row.last_saved_at).toLocaleString() : '-'}</td>
                        </tr>
                      )
                    }) : (
                      <tr><td className="px-3 py-8 text-center text-[#6b7280]" colSpan={10}>Select an assessment to load students.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] p-3">
                <span className="text-[12px] font-medium text-[#6b7280]">{teacherLocked ? 'This sheet is locked for teacher editing.' : 'Drafts persist until final submission.'}</span>
                <div className="flex gap-2">
                  <Button disabled={!rows.length || teacherLocked} type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={saveDraft}><Save className="size-3.5" /> Save Draft</Button>
                  <Button disabled={!rows.length || teacherLocked} type="button" className="h-8 rounded-[5px] text-[12px]" onClick={submitFinal}><Send className="size-3.5" /> Submit Final</Button>
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {canApprove ? (
        <SectionCard title="Headteacher Results Overview" subtitle="Submitted batches can be approved or returned for correction">
          <div className="grid gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Input className="h-8 max-w-sm text-[12px]" placeholder="Return reason" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
            </div>
            <PortalTable
              columns={[
                { key: 'assessment_name', label: 'Assessment' },
                { key: 'class_name', label: 'Class' },
                { key: 'subject_name', label: 'Subject' },
                { key: 'teacher_name', label: 'Teacher' },
                { key: 'status', label: 'Status', render: (row) => statusLabel(row.status) },
                { key: 'completed_marks', label: 'Saved Marks' },
                { key: 'actions', label: 'Actions', render: (row) => (
                  <span className="inline-flex gap-1">
                    <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#bbf7d0] text-[#15803d]" onClick={(event) => { event.stopPropagation(); approveBatch(row) }} aria-label="Approve batch"><CheckCircle2 className="size-3.5" /></button>
                    <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fed7aa] text-[#c2410c]" onClick={(event) => { event.stopPropagation(); returnBatch(row) }} aria-label="Return batch"><RotateCcw className="size-3.5" /></button>
                  </span>
                ) },
              ]}
              rows={setup.batches || []}
              emptyMessage="No result batches have been saved yet."
            />
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}

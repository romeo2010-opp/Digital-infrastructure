import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, Archive, CheckCircle2, ChevronDown, ChevronRight, Download, Eye, FileSpreadsheet, GraduationCap, Loader2, Lock, Play, Plus, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { PageBackButton } from '../components/PageBackButton'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { usePortal } from '../lib/portalContext'

function today() {
  return new Date().toISOString().slice(0, 10)
}

const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

function fmtDate(value: any) {
  return value ? String(value).slice(0, 10) : '-'
}

function statusLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function resultStatusLabel(value: any) {
  const labels: Record<string, string> = {
    complete: 'Complete',
    pending_results: 'Pending Results',
    no_results: 'No Results',
  }
  return labels[String(value || '')] || statusLabel(value)
}

function percent(value: any) {
  if (value === null || value === undefined || value === '') return '-'
  return `${Number(value).toFixed(1)}%`
}

function actionText(value: any) {
  return statusLabel(value || 'pending')
}

function LoadingPanel({ label = 'Loading...' }: { label?: string }) {
  return <SmartLinkLoadingState label={label} detail="Preparing academic records for this workspace." />
}

function StatusTile({ label, value }: { label: string; value: any }) {
  const hasWarning = Number(value || 0) > 0
  return (
    <div className={`rounded-[6px] border px-3 py-2 ${hasWarning ? 'border-[#fed7aa] bg-[#fff7ed]' : 'border-[#bbf7d0] bg-[#f0fdf4]'}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${hasWarning ? 'text-[#c2410c]' : 'text-[#15803d]'}`}>{label}</div>
      <div className="mt-1 text-[22px] font-bold tracking-[-0.04em] text-[#111827]">{value}</div>
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#020617]/45 p-4">
      <section className="w-full max-w-xl rounded-[8px] border border-[#d9dce3] bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-[#e5e7eb] px-4 py-3">
          <h2 className="text-[15px] font-semibold text-[#111827]">{title}</h2>
          <button type="button" className="rounded-[4px] px-2 py-1 text-[12px] font-semibold text-[#64748b] hover:bg-[#f8fafc]" onClick={onClose}>Close</button>
        </header>
        {children}
      </section>
    </div>
  )
}

function csvEscape(value: any) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(name: string, rows: any[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function AcademicSessionPage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<any>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({})
  const [showYearModal, setShowYearModal] = useState(false)
  const [yearForm, setYearForm] = useState({ name: String(new Date().getFullYear()), start_date: `${new Date().getFullYear()}-01-01`, end_date: `${new Date().getFullYear()}-12-31`, is_active: true })
  const [termForm, setTermForm] = useState({ academic_year_id: '', name: 'Term 1', term_number: '1', start_date: today(), end_date: today() })
  const [reopenReason, setReopenReason] = useState('')
  const canManage = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())

  const refresh = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const sessionPayload = await api.getAcademicSession(token)
      setPayload(sessionPayload)
      const activeYearId = sessionPayload?.current?.academic_year?.id
      setTermForm((current) => ({ ...current, academic_year_id: current.academic_year_id || String(activeYearId || '') }))
    } catch (err: any) {
      setError(err?.message || 'Unable to load academic sessions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const current = payload?.current || {}
  const warnings = payload?.closure_warnings || {}
  const yearRows = payload?.years || []
  const termRows = payload?.terms || []

  const run = async (label: string, action: () => Promise<any>, success: string) => {
    setBusy(label)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      toast.success(success)
      await refresh()
    } catch (err: any) {
      const nextError = err?.message || 'Action failed.'
      setError(nextError)
      toast.error(nextError)
    } finally {
      setBusy('')
    }
  }

  const createYear = () => run('Creating academic year...', () => api.createAcademicYear(token, yearForm), 'Academic year created.')
    .then(() => setShowYearModal(false))
  const openTerm = () => run('Opening term...', () => api.openTerm(token, termForm), 'Term opened; students and teacher assignments carried forward.')
  const moveToMarking = () => current.term?.id && run('Moving term to marking...', () => api.moveTermToMarking(token, current.term.id), 'Term moved to marking.')
  const reopenTerm = () => current.term?.id && run('Reopening term...', () => api.reopenTerm(token, current.term.id, { reason: reopenReason }), 'Term reopened for correction.')
  const archiveTerm = (term: any) => run('Archiving term...', () => api.archiveTerm(token, term.id), `${term.name} archived.`)

  if (loading) return <div className="p-4"><LoadingPanel label="Loading academic sessions..." /></div>

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Academic Session Manager</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">Open terms, close marking periods, preserve enrollment history and prepare progression.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-[5px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-semibold text-[#111827]">
              {current.academic_year?.name || 'No active year'} / {current.term?.name || 'No open term'}
            </div>
            {canManage ? (
              <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={() => setShowYearModal(true)}>
                <Plus className="size-3.5" />
                Create Academic Year
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <SectionKpiStrip items={[
        { label: 'Academic Year', value: current.academic_year?.name || '-', helper: current.academic_year?.status || 'not configured', delta: current.academic_year?.is_active ? 'active' : 'inactive' },
        { label: 'Current Term', value: current.term?.name || '-', helper: current.term?.status || 'not open', delta: current.term?.end_date?.slice?.(0, 10) || 'no date' },
        { label: 'Active Students', value: payload?.metrics?.active_students || 0, helper: 'current school', delta: 'enrollment source' },
        { label: 'Pending Results', value: payload?.metrics?.pending_results || 0, helper: 'draft/submitted/returned', delta: 'term close check', tone: Number(payload?.metrics?.pending_results || 0) ? 'warn' as const : 'good' as const },
      ]} />

      {busy ? <div className="inline-flex items-center gap-2 rounded-[6px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-semibold text-[#1d4ed8]"><Loader2 className="size-3.5 animate-spin" /> {busy}</div> : null}
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {message ? <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] font-semibold text-[#166534]">{message}</div> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <SectionCard title="Academic Years" subtitle="Expand a year to see pass rate, terms and term actions.">
          <div className="overflow-x-auto p-3">
            <div className="grid min-w-[900px] gap-2">
            <div className="hidden grid-cols-[36px_minmax(180px,1fr)_120px_120px_110px_100px_110px] gap-2 rounded-[5px] bg-[#f8fafc] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b] md:grid">
              <span />
              <span>Academic Year</span>
              <span>Start</span>
              <span>End</span>
              <span>Length</span>
              <span>Pass Rate</span>
              <span>Status</span>
            </div>
            {yearRows.map((year: any) => {
              const yearTerms = termRows.filter((term: any) => Number(term.academic_year_id) === Number(year.id))
              const expanded = Boolean(expandedYears[year.id])
              return (
                <div key={year.id} className="overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white">
                  <button
                    type="button"
                    className="grid w-full items-center gap-2 px-3 py-3 text-left text-[13px] font-semibold text-[#111827] md:grid-cols-[36px_minmax(180px,1fr)_120px_120px_110px_100px_110px]"
                    onClick={() => setExpandedYears((current) => ({ ...current, [year.id]: !expanded }))}
                  >
                    <span className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#475569]">{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
                    <span>{year.name}</span>
                    <span className="text-[#64748b]">{fmtDate(year.start_date)}</span>
                    <span className="text-[#64748b]">{fmtDate(year.end_date)}</span>
                    <span className="text-[#64748b]">{year.length_weeks ? `${year.length_weeks} weeks` : '-'}</span>
                    <span className={Number(year.pass_rate || 0) < Number(year.minimum_average || 50) && year.pass_rate !== null ? 'text-[#b91c1c]' : 'text-[#047857]'}>{year.pass_rate === null ? '-' : percent(year.pass_rate)}</span>
                    <span className="text-[#64748b]">{statusLabel(year.status)}{year.is_active ? ' / Active' : ''}</span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-[#e2e8f0] bg-[#fbfcfe] p-3">
                      <div className="mb-3 grid gap-2 sm:grid-cols-4">
                        <StatusTile label="Terms" value={year.term_count || yearTerms.length} />
                        <StatusTile label="Students" value={year.enrolled_students || 0} />
                        <StatusTile label="Passed" value={year.passed_count || 0} />
                        <StatusTile label="Pass Rate" value={year.pass_rate === null ? '-' : percent(year.pass_rate)} />
                      </div>
                      <PortalTable
                        columns={[
                          { key: 'name', label: 'Term' },
                          { key: 'term_number', label: 'No.' },
                          { key: 'status', label: 'Status', render: (row) => statusLabel(row.status) },
                          { key: 'start_date', label: 'Start', render: (row) => fmtDate(row.start_date) },
                          { key: 'end_date', label: 'End', render: (row) => fmtDate(row.end_date) },
                          {
                            key: 'actions',
                            label: 'Actions',
                            render: (row) => (
                              <div className="flex items-center gap-2">
                                <Button type="button" variant="outline" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={(event) => { event.stopPropagation(); navigate(`/academic-sessions/terms/${row.id}`) }}>
                                  <Eye className="size-3" />
                                  View
                                </Button>
                                {row.status === 'closed' && canManage ? (
                                  <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[#e2e8f0] bg-white px-2 text-[11px] font-semibold text-[#374151]" onClick={(event) => { event.stopPropagation(); archiveTerm(row) }}>
                                    <Archive className="size-3" />
                                    Archive
                                  </button>
                                ) : null}
                              </div>
                            ),
                          },
                        ]}
                        rows={yearTerms}
                        emptyMessage="No terms have been opened for this academic year."
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Term Actions" subtitle="Open, mark, close or reopen the current working term.">
          <div className="grid gap-3 p-4">
            {canManage ? (
              <>
                <div className="grid gap-3">
                  <Field label="Academic Year"><select className={selectClassName} value={termForm.academic_year_id} onChange={(event) => setTermForm({ ...termForm, academic_year_id: event.target.value })}><option value="">Select year</option>{yearRows.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Term Number"><Input className="h-8 text-[12px]" value={termForm.term_number} onChange={(event) => setTermForm({ ...termForm, term_number: event.target.value })} /></Field>
                    <Field label="Term Name"><Input className="h-8 text-[12px]" value={termForm.name} onChange={(event) => setTermForm({ ...termForm, name: event.target.value })} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start Date"><Input type="date" className="h-8 text-[12px]" value={termForm.start_date} onChange={(event) => setTermForm({ ...termForm, start_date: event.target.value })} /></Field>
                    <Field label="End Date"><Input type="date" className="h-8 text-[12px]" value={termForm.end_date} onChange={(event) => setTermForm({ ...termForm, end_date: event.target.value })} /></Field>
                  </div>
                  <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={Boolean(busy)} onClick={openTerm}><Play className="size-3.5" /> Open Term</Button>
                </div>
                <div className="border-t border-[#e5e7eb] pt-3">
                  <div className="mb-2 text-[12px] font-semibold text-[#475569]">Current term: {current.term?.name || '-'}</div>
                  <div className="grid gap-2">
                    <Button disabled={!current.term?.id || current.term?.status !== 'open' || Boolean(busy)} type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={moveToMarking}>Move Term to Marking</Button>
                    <Button disabled={!current.term?.id || Boolean(busy)} type="button" className="h-8 rounded-[5px] bg-[#111827] text-[12px]" onClick={() => navigate(`/academic-sessions/terms/${current.term.id}/close`)}><Lock className="size-3.5" /> Close Term</Button>
                    <Input className="h-8 text-[12px]" placeholder="Reason to reopen closed term" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
                    <Button disabled={!current.term?.id || !reopenReason.trim() || Boolean(busy)} type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={reopenTerm}><RotateCcw className="size-3.5" /> Reopen Term</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3 text-[12px] font-semibold text-[#64748b]">Term management is available to school owners and headteachers.</div>
            )}
            <div className="grid gap-2 border-t border-[#e5e7eb] pt-3">
              <StatusTile label="Draft batches" value={warnings.draft_batches || 0} />
              <StatusTile label="Submitted" value={warnings.submitted_unapproved_batches || 0} />
              <StatusTile label="Missing marks" value={warnings.missing_exam_marks || 0} />
            </div>
          </div>
        </SectionCard>
      </div>

      {showYearModal ? (
        <Modal title="Create Academic Year" onClose={() => setShowYearModal(false)}>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Year Name"><Input className="h-8 text-[12px]" value={yearForm.name} onChange={(event) => setYearForm({ ...yearForm, name: event.target.value })} /></Field>
            <Field label="Active"><select className={selectClassName} value={yearForm.is_active ? 'yes' : 'no'} onChange={(event) => setYearForm({ ...yearForm, is_active: event.target.value === 'yes' })}><option value="yes">Activate now</option><option value="no">Upcoming</option></select></Field>
            <Field label="Start Date"><Input type="date" className="h-8 text-[12px]" value={yearForm.start_date} onChange={(event) => setYearForm({ ...yearForm, start_date: event.target.value })} /></Field>
            <Field label="End Date"><Input type="date" className="h-8 text-[12px]" value={yearForm.end_date} onChange={(event) => setYearForm({ ...yearForm, end_date: event.target.value })} /></Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setShowYearModal(false)}>Cancel</Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={Boolean(busy)} onClick={createYear}><CheckCircle2 className="size-3.5" /> Create</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export function AcademicTermDetailPage() {
  const { termId } = useParams()
  const navigate = useNavigate()
  const { token, api, user } = usePortal()
  const canManage = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())
  const [payload, setPayload] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !termId) return
    setLoading(true)
    api.getAcademicTerm(token, termId)
      .then(setPayload)
      .catch((err: any) => setError(err?.message || 'Unable to load term.'))
      .finally(() => setLoading(false))
  }, [api, termId, token])

  if (loading) return <div className="p-4"><LoadingPanel label="Loading term..." /></div>
  const term = payload?.term || {}
  const assessments = payload?.assessments || []
  const eventRows = [...(payload?.events || []), ...(payload?.assessment_instances || []).map((row: any) => ({ ...row, title: row.title, event_type: 'assessment_instance', start_datetime: row.instance_date, source: 'assessment_instance' }))]

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PageBackButton fallback="/academic-sessions" label="Back to academic sessions" iconOnly />
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{term.name || 'Term'}</h1>
              <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{term.academic_year_name || '-'} / {statusLabel(term.status)} / {fmtDate(term.start_date)} to {fmtDate(term.end_date)}</p>
            </div>
          </div>
          {canManage ? <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate(`/academic-sessions/terms/${term.id}/close`)}><Lock className="size-3.5" /> Close Term</Button> : null}
        </div>
      </section>
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      <SectionKpiStrip items={[
        { label: 'Assessments', value: payload?.summary?.assessments || 0, helper: 'teacher and exam papers', delta: 'term scope' },
        { label: 'Exam Sessions', value: payload?.summary?.exam_sessions || 0, helper: 'school-wide sessions', delta: 'term scope' },
        { label: 'Events', value: payload?.summary?.events || 0, helper: 'calendar + recurring', delta: 'term scope' },
        { label: 'Completed Results', value: payload?.summary?.completed_results || 0, helper: 'approved or locked batches', delta: 'marksheets' },
      ]} />
      <SectionCard title="Assessments & Exams" subtitle="Teacher-only assessments and school-wide exam papers for this term.">
        <div className="p-4">
          <PortalTable
            columns={[
              { key: 'name', label: 'Assessment' },
              { key: 'class_name', label: 'Class' },
              { key: 'subject_name', label: 'Subject' },
              { key: 'assessment_type', label: 'Type', render: (row) => statusLabel(row.assessment_type) },
              { key: 'exam_session_name', label: 'Exam Session', render: (row) => row.exam_session_name || 'Teacher assessment' },
              { key: 'status', label: 'Status', render: (row) => statusLabel(row.status) },
              { key: 'saved_marks', label: 'Marks', render: (row) => row.saved_marks || 0 },
              {
                key: 'actions',
                label: 'Actions',
                render: (row) => (
                  <Button type="button" variant="outline" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={(event) => { event.stopPropagation(); navigate(`/academic-sessions/terms/${term.id}/results?assessment_id=${row.id}`) }}>
                    <FileSpreadsheet className="size-3" />
                    View Results
                  </Button>
                ),
              },
            ]}
            rows={assessments}
            emptyMessage="No assessments have been created for this term."
          />
        </div>
      </SectionCard>
      <SectionCard title="Events" subtitle="Events and recurring assessment instances attached to this term.">
        <div className="p-4">
          <PortalTable
            columns={[
              { key: 'title', label: 'Event' },
              { key: 'event_type', label: 'Type', render: (row) => statusLabel(row.event_type) },
              { key: 'start_datetime', label: 'Date', render: (row) => fmtDate(row.start_datetime) },
              { key: 'class_name', label: 'Class', render: (row) => row.class_name || '-' },
              { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
              { key: 'status', label: 'Status', render: (row) => statusLabel(row.status) },
            ]}
            rows={eventRows}
            emptyMessage="No events are attached to this term."
          />
        </div>
      </SectionCard>
    </div>
  )
}

export function AcademicTermResultsPage() {
  const { termId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token, api } = usePortal()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<any>(null)
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [classId, setClassId] = useState(searchParams.get('class_id') || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const assessmentId = searchParams.get('assessment_id') || ''

  const load = async () => {
    if (!token || !termId) return
    setLoading(true)
    setError('')
    try {
      const data = await api.getTermResults(token, termId, { assessment_id: assessmentId, class_id: classId, search })
      setPayload(data)
      if (!classId && data?.class?.id) setClassId(String(data.class.id))
    } catch (err: any) {
      setError(err?.message || 'Unable to load term results.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, termId, assessmentId, classId])

  const rows = payload?.rows || []
  const papers = payload?.papers || []
  const exportRows = () => {
    const header = ['Student ID', 'Student', 'Class', ...papers.map((paper: any) => paper.assessment_name), 'Average']
    const body = rows.map((row: any) => [
      row.student_id,
      `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      row.class_name,
      ...papers.map((paper: any) => row.results?.[paper.id]?.score ?? ''),
      row.average_score ?? '',
    ])
    downloadCsv(`term-${termId}-results.csv`, [header, ...body])
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PageBackButton fallback={`/academic-sessions/terms/${termId}`} label="Back to term" iconOnly />
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Results Marksheet</h1>
              <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{payload?.term?.name || 'Term'} / {payload?.assessment?.name || payload?.class?.name || 'Class results'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-[#94a3b8]" />
              <Input className="h-8 w-56 pl-8 text-[12px]" placeholder="Search students" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current)
                    if (search) next.set('search', search)
                    else next.delete('search')
                    if (classId) next.set('class_id', classId)
                    return next
                  })
                  load()
                }
              }} />
            </div>
            <select className={`${selectClassName} w-44`} value={classId} onChange={(event) => {
              const nextClass = event.target.value
              setClassId(nextClass)
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                if (nextClass) next.set('class_id', nextClass)
                else next.delete('class_id')
                return next
              })
            }}>
              {(payload?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={exportRows}><Download className="size-3.5" /> Export</Button>
          </div>
        </div>
      </section>
      {loading ? <LoadingPanel label="Loading results..." /> : null}
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {!loading ? (
        <SectionCard title="Marksheet" subtitle={`${payload?.summary?.students || 0} students / ${payload?.summary?.papers || 0} assessments / ${payload?.summary?.missing_marks || 0} missing marks`}>
          <div className="p-4">
            <PortalTable
              columns={[
                { key: 'student_id', label: 'Student ID' },
                { key: 'student_name', label: 'Student', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() },
                { key: 'class_name', label: 'Class' },
                ...papers.map((paper: any) => ({
                  key: `paper_${paper.id}`,
                  label: paper.assessment_name,
                  render: (row: any) => {
                    const result = row.results?.[paper.id]
                    return result ? `${result.score ?? '-'} / ${paper.total_marks} (${resultStatusLabel(result.status)})` : '-'
                  },
                })),
                { key: 'average_score', label: 'Average', render: (row) => row.average_score === null ? '-' : percent(row.average_score) },
              ]}
              rows={rows}
              emptyMessage="No marksheet rows found."
            />
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}

export function TermCloseChecksPage() {
  const { termId } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [payload, setPayload] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!token || !termId) return
    setLoading(true)
    setError('')
    try {
      setPayload(await api.getTermCloseChecks(token, termId))
    } catch (err: any) {
      setError(err?.message || 'Unable to run term closing checks.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, termId])

  const proceed = async () => {
    if (!token || !termId || !payload?.can_proceed) return
    setBusy(true)
    setError('')
    try {
      if (payload.term?.status !== 'closed') {
        await api.closeTerm(token, termId, { confirm_exceptions: false })
        toast.success('Term closed and locked.')
      }
      navigate(`/academic-sessions/terms/${termId}/progression`)
    } catch (err: any) {
      const message = err?.message || 'Unable to close term.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const warnings = payload?.warnings || {}
  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PageBackButton fallback={`/academic-sessions/terms/${termId}`} label="Back to term" iconOnly />
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Term Closing Checks</h1>
              <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{payload?.term?.name || 'Term'} must pass without exceptions before progression.</p>
            </div>
          </div>
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={loading || busy} onClick={load}><RotateCcw className="size-3.5" /> Run Checks</Button>
        </div>
      </section>
      {loading ? <LoadingPanel label="Running closing checks..." /> : null}
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {!loading ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusTile label="Draft batches" value={warnings.draft_batches || 0} />
            <StatusTile label="Submitted unapproved" value={warnings.submitted_unapproved_batches || 0} />
            <StatusTile label="Returned batches" value={warnings.returned_batches || 0} />
            <StatusTile label="Missing batches" value={warnings.missing_result_batches || 0} />
            <StatusTile label="Draft exam papers" value={warnings.draft_exam_papers || 0} />
            <StatusTile label="Missing exam marks" value={warnings.missing_exam_marks || 0} />
          </div>
          <SectionCard title="Missing Result Batches" subtitle="These must be fixed before closing without exceptions.">
            <div className="p-4">
              <PortalTable
                columns={[
                  { key: 'class_name', label: 'Class' },
                  { key: 'subject_name', label: 'Subject' },
                  { key: 'name', label: 'Assessment' },
                ]}
                rows={warnings.missing_result_examples || []}
                emptyMessage="No missing result batches detected."
              />
            </div>
          </SectionCard>
          <SectionCard title="Missing Exam Marks" subtitle="Formal exams must be fully marked.">
            <div className="p-4">
              <PortalTable
                columns={[
                  { key: 'class_name', label: 'Class' },
                  { key: 'subject_name', label: 'Subject' },
                  { key: 'name', label: 'Exam Paper' },
                  { key: 'missing_marks', label: 'Missing Marks' },
                ]}
                rows={warnings.missing_exam_mark_examples || []}
                emptyMessage="No missing formal exam marks detected."
              />
            </div>
          </SectionCard>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-[8px] border border-[#d9dce3] bg-white p-3 shadow-lg">
            <div className={`text-[12px] font-semibold ${payload?.can_proceed ? 'text-[#166534]' : 'text-[#b91c1c]'}`}>
              {payload?.can_proceed ? 'All checks passed. You can close the term and continue to progression.' : 'Resolve all exceptions before proceeding.'}
            </div>
            <Button type="button" className="h-9 rounded-[5px] text-[12px]" disabled={!payload?.can_proceed || busy} onClick={proceed}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Proceed
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function TermProgressionPage() {
  const { termId } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [payload, setPayload] = useState<any>(null)
  const [selectedClassId, setSelectedClassId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = async (classId = selectedClassId) => {
    if (!token || !termId) return
    setLoading(true)
    setError('')
    try {
      const data = await api.getTermProgressionPreview(token, termId, classId ? { class_id: classId } : {})
      setPayload(data)
      if (!classId && data?.selected_class_id) setSelectedClassId(String(data.selected_class_id))
    } catch (err: any) {
      setError(err?.message || 'Unable to load progression preview.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, termId])

  const rows = payload?.rows || []
  const readyRows = rows.filter((row: any) => row.result_status === 'complete' && row.progression_flag !== 'below_threshold')
  const flaggedRows = rows.filter((row: any) => row.progression_flag === 'below_threshold' || row.result_status !== 'complete')
  const classes = payload?.classes || []
  const currentClass = classes.find((row: any) => String(row.id) === String(selectedClassId))

  const approveClass = async () => {
    if (!token || !termId || !selectedClassId) return
    setBusy(true)
    setError('')
    try {
      await api.approveTermProgressionClass(token, termId, selectedClassId)
      toast.success(`${currentClass?.name || 'Class'} progression approved.`)
      const nextClass = classes.find((row: any) => String(row.id) !== String(selectedClassId) && Number(row.approved || 0) < Number(row.total || 0))
      const nextId = nextClass ? String(nextClass.id) : selectedClassId
      setSelectedClassId(nextId)
      setConfirmOpen(false)
      await load(nextId)
    } catch (err: any) {
      const message = err?.message || 'Unable to approve progression.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PageBackButton fallback={`/academic-sessions/terms/${termId}`} label="Back to term" iconOnly />
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Progression Preview</h1>
              <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{payload?.source_term?.name || 'Source term'} / {payload?.target_term?.name ? `target: ${payload.target_term.name}` : 'approve first, then open the next academic year term'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className={`${selectClassName} w-48`} value={selectedClassId} onChange={(event) => {
              const next = event.target.value
              setSelectedClassId(next)
              load(next)
            }}>
              {classes.map((row: any) => <option key={row.id} value={row.id}>{row.name} ({row.approved}/{row.total} approved)</option>)}
            </select>
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={!payload?.ready || busy || loading || !rows.length || rows.every((row: any) => row.approved_decision)} onClick={() => setConfirmOpen(true)}>
              <GraduationCap className="size-3.5" />
              Approve Class
            </Button>
          </div>
        </div>
      </section>
      {loading ? <LoadingPanel label="Loading progression preview..." /> : null}
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {!loading && payload?.message ? <div className="rounded-[6px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-semibold text-[#1d4ed8]">{payload.message}</div> : null}
      {!loading && !payload?.ready ? <div className="rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#9a3412]">Progression is not ready.</div> : null}
      {!loading && payload?.ready ? (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            {classes.map((row: any) => {
              const complete = Number(row.approved || 0) >= Number(row.total || 0) && Number(row.total || 0) > 0
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`rounded-[6px] border px-3 py-2 text-left ${String(row.id) === String(selectedClassId) ? 'border-[#111827] bg-[#f8fafc]' : complete ? 'border-[#bbf7d0] bg-[#f0fdf4]' : 'border-[#e2e8f0] bg-white'}`}
                  onClick={() => { setSelectedClassId(String(row.id)); load(String(row.id)) }}
                >
                  <div className="text-[12px] font-bold text-[#111827]">{row.name}</div>
                  <div className="mt-1 text-[11px] font-semibold text-[#64748b]">{row.approved}/{row.total} approved / {row.flagged} flagged</div>
                </button>
              )
            })}
          </div>
          <SectionCard title="Ready For Progression" subtitle="Learners above the school threshold or terminal rules with complete results.">
            <div className="p-4">
              <PortalTable
                columns={[
                  { key: 'student_code', label: 'Student ID' },
                  { key: 'student', label: 'Student', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() },
                  { key: 'average_score', label: 'Average', render: (row) => percent(row.average_score) },
                  { key: 'suggested_decision', label: 'Decision', render: (row) => actionText(row.approved_decision || row.suggested_decision) },
                  { key: 'to_class_name', label: 'Next Class', render: (row) => row.approved_to_class_name || row.to_class_name || '-' },
                  { key: 'approval_status', label: 'Status', render: (row) => row.approved_decision ? 'Approved' : 'Pending' },
                ]}
                rows={readyRows}
                emptyMessage="No ready learners in this class."
              />
            </div>
          </SectionCard>
          <SectionCard title="Flagged By System" subtitle="Learners below the school threshold or blocked by incomplete results.">
            <div className="p-4">
              <PortalTable
                columns={[
                  { key: 'student_code', label: 'Student ID' },
                  { key: 'student', label: 'Student', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() },
                  { key: 'average_score', label: 'Average', render: (row) => row.average_score === null ? '-' : <span className="font-bold text-[#b91c1c]">{percent(row.average_score)}</span> },
                  { key: 'result_status', label: 'Results', render: (row) => resultStatusLabel(row.result_status) },
                  { key: 'suggested_decision', label: 'Decision', render: (row) => actionText(row.approved_decision || row.suggested_decision) },
                  { key: 'reason', label: 'Reason' },
                  { key: 'approval_status', label: 'Status', render: (row) => row.approved_decision ? 'Approved' : 'Pending' },
                ]}
                rows={flaggedRows}
                emptyMessage="No learners were flagged by the system."
              />
            </div>
          </SectionCard>
        </>
      ) : null}
      {confirmOpen ? (
        <Modal title="Approve Class Progression" onClose={() => setConfirmOpen(false)}>
          <div className="grid gap-3 p-4">
            <div className="rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] p-3 text-[12px] font-semibold leading-5 text-[#9a3412]">
              This will approve progression decisions for {currentClass?.name || 'this class'}. Enrollments will be carried into the next academic year when the next term is opened.
            </div>
            <div className="grid gap-2 text-[12px] font-semibold text-[#475569]">
              <span>{readyRows.length} ready learners</span>
              <span>{flaggedRows.length} flagged learners</span>
              <span>{rows.filter((row: any) => row.approved_decision).length} already approved</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={busy} onClick={approveClass}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                Approve
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

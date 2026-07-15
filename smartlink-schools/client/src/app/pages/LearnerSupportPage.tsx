import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  ArrowLeft, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck,
  FilePlus2, HeartHandshake, RefreshCw, Search, ShieldAlert, Sparkles, UserCheck, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { TargetedAssessmentWorkflow } from '../components/TargetedAssessmentWorkflow'
import { usePortal } from '../lib/portalContext'

const ACTIVE_STATUSES = ['detected', 'teacher_follow_up', 'intervention_active', 'reassessment_pending', 'strategy_review', 'academic_team_review', 'guardian_review', 'continued_support']
const CASE_TABS = ['overview', 'evidence', 'support plan', 'sessions', 'reassessment', 'timeline', 'notes']
const SESSION_STATUSES = ['completed', 'partially_completed', 'learner_absent', 'teacher_absent', 'cancelled', 'rescheduled', 'planned']
const selectClass = 'h-9 rounded-[6px] border border-[#d9dce3] bg-white px-2.5 text-[11px] text-[#111827]'

const label = (value: any) => String(value || 'not available').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const date = (value: any, includeTime = false) => value ? new Date(value).toLocaleString([], includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : 'Not scheduled'
const percent = (value: any) => value === null || value === undefined ? 'Not measured' : `${Number(value).toFixed(0)}%`
const idempotency = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`

function Badge({ value }: { value: any }) {
  const normalized = String(value || '').toLowerCase()
  const tone = normalized.includes('urgent') || normalized.includes('overdue') || normalized.includes('ineffective')
    ? 'border-red-200 bg-red-50 text-red-700'
    : normalized.includes('improv') || normalized.includes('effective') || normalized.includes('resolved') || normalized.includes('completed')
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : normalized.includes('pending') || normalized.includes('review') || normalized.includes('partial')
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${tone}`}>{label(value)}</span>
}

function SupportCaseList() {
  const navigate = useNavigate()
  const { token, api, user } = usePortal()
  const [summary, setSummary] = useState<any>({ counts: {}, today_work: [], recently_improved: [] })
  const [cases, setCases] = useState<any[]>([])
  const [pagination, setPagination] = useState<any>({ page: 1, pages: 1, total: 0 })
  const [filters, setFilters] = useState<any>({ queue: 'needs_attention', status: '', scope_type: '', priority: '', term_scope: 'current', search: '', page: 1, limit: 20 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const [summaryPayload, casePayload] = await Promise.all([api.getTeacherSupportSummary(token), api.listSupportCases(token, filters)])
      setSummary(summaryPayload || { counts: {}, today_work: [], recently_improved: [] })
      setCases(casePayload?.cases || [])
      setPagination(casePayload?.pagination || { page: 1, pages: 1, total: 0 })
    } catch (err: any) { setError(err?.message || 'Unable to load authorised learner-support work.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [token, filters.queue, filters.status, filters.scope_type, filters.priority, filters.term_scope, filters.search, filters.page])

  const counts = summary.counts || {}
  const queueCards = [
    { label: 'Needs attention', value: counts.needs_attention || 0, queue: 'needs_attention', helper: 'due or approaching review' },
    { label: 'Sessions due this week', value: counts.sessions_due_week || 0, queue: '', helper: 'planned support delivery' },
    { label: 'Reassessments due', value: counts.reassessments_due || 0, queue: 'reassessment', helper: 'outcome evidence required' },
    { label: 'Awaiting my action', value: counts.unacknowledged_assignments || 0, queue: 'awaiting_action', helper: 'assignments to acknowledge' },
    { label: 'Recently improved', value: counts.recently_improved || 0, queue: 'recently_improved', helper: 'positive support signals' },
  ]

  return <main className="grid gap-3 p-4">
    <section className="overflow-hidden rounded-[8px] border border-[#dbe3ee] bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e2e8f0] p-5">
        <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase text-emerald-700"><HeartHandshake className="size-4"/>Teacher Portal</div><h1 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[#111827]">Learner Support</h1><p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#64748b]">Cases shown here are limited to learners you teach, your class-teacher scope, or support work assigned to you.</p></div>
        <Button variant="outline" className="h-9" onClick={load} disabled={loading}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</Button>
      </div>
      <div className="grid gap-2 bg-[#f8fafc] p-3 sm:grid-cols-2 xl:grid-cols-5">{queueCards.map((item) => <button type="button" key={item.label} onClick={() => setFilters((current: any) => ({ ...current, queue: item.queue, page: 1 }))} className="rounded-[7px] border border-[#dbe3ee] bg-white p-3 text-left hover:border-[#94a3b8]"><div className="text-[10px] font-semibold text-[#64748b]">{item.label}</div><div className="mt-1 text-[24px] font-bold text-[#111827]">{item.value}</div><div className="mt-1 text-[9px] text-[#64748b]">{item.helper}</div></button>)}</div>
    </section>

    {error ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</div> : null}
    {summary.schema_status === 'compatibility_read_only' ? <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium text-amber-900">Learner Support is open in database compatibility mode. Existing cases and evidence remain available; assignment, note, detailed-session and reassessment scheduling actions will appear after the pending support-access migration is safely applied.</div> : null}

    {(summary.today_work || []).length ? <SectionCard title="Today’s support work" subtitle="Scheduled delivery and actions that now need attention"><div className="divide-y divide-[#edf0f4]">{summary.today_work.map((item: any) => <button key={`${item.public_ref}-${item.session_ref || 'case'}`} onClick={() => navigate(`/learner-support/${item.public_ref}`)} className="grid w-full gap-3 p-4 text-left hover:bg-[#f8fafc] md:grid-cols-[1fr_160px_120px]"><div><div className="flex gap-2"><Badge value={item.session_status || item.status}/><Badge value={item.severity}/></div><div className="mt-2 text-[12px] font-semibold text-[#111827]">{item.learner_name || item.class_name || 'Support group'} · {item.subject_name || 'Cross-subject'}</div><div className="mt-1 text-[10px] text-[#64748b]">{item.topic_name || 'Multiple learning areas'}</div></div><div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Due</strong>{date(item.scheduled_at || item.next_review_at, true)}</div><div className="self-center text-[10px] font-semibold text-emerald-700">{label(item.primary_action)} →</div></button>)}</div></SectionCard> : null}

    <SectionCard title="My authorised cases" subtitle={`${pagination.total || 0} cases available to ${label(user?.role)} within relationship and term scope`}>
      <div className="grid gap-2 border-b border-[#e2e8f0] bg-[#f8fafc] p-3 lg:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(130px,auto))]">
        <label className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-[#94a3b8]"/><Input className="h-9 bg-white pl-8 text-[11px]" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 1 })} placeholder="Learner, admission no., class, subject, topic or case ID"/></label>
        <select className={selectClass} value={filters.queue} onChange={(event) => setFilters({ ...filters, queue: event.target.value, page: 1 })}><option value="needs_attention">Needs attention</option><option value="assigned">My assigned cases</option><option value="classes">My classes</option><option value="subjects">My subjects</option><option value="awaiting_action">Awaiting my action</option><option value="reassessment">Reassessment pending</option><option value="strategy_review">Strategy review</option><option value="recently_improved">Recently improved</option><option value="resolved">Completed support</option><option value="">All authorised cases</option></select>
        <select className={selectClass} value={filters.scope_type} onChange={(event) => setFilters({ ...filters, scope_type: event.target.value, page: 1 })}><option value="">All case scopes</option><option value="learner">Individual learner</option><option value="group">Learner group</option><option value="class">Whole class</option><option value="cross_subject">Cross-subject</option></select>
        <select className={selectClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}><option value="">All statuses</option>{[...ACTIVE_STATUSES, 'resolved', 'closed_inconclusive', 'transferred'].map((item) => <option value={item} key={item}>{label(item)}</option>)}</select>
        <select className={selectClass} value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value, page: 1 })}><option value="">All priorities</option><option value="high">High and urgent</option></select>
        <select className={selectClass} value={filters.term_scope} onChange={(event) => setFilters({ ...filters, term_scope: event.target.value, page: 1 })}><option value="current">Current term</option><option value="previous">Previous terms</option><option value="all">All terms</option></select>
      </div>
      {loading ? <div className="grid min-h-48 place-items-center text-[12px] text-[#64748b]"><RefreshCw className="size-5 animate-spin"/></div> : <div className="divide-y divide-[#edf0f4]">{cases.map((item: any) => {
        const progress = item.planned_sessions ? Math.min(100, Math.round(Number(item.completed_sessions || 0) / Number(item.planned_sessions) * 100)) : 0
        return <button key={item.public_ref} onClick={() => navigate(`/learner-support/${item.public_ref}`)} className="grid w-full gap-3 p-4 text-left hover:bg-[#f8fafc] xl:grid-cols-[minmax(280px,1fr)_160px_150px_160px]">
          <div><div className="flex flex-wrap items-center gap-2"><Badge value={item.severity}/><Badge value={item.status}/><span className="text-[9px] font-semibold uppercase text-[#64748b]">{label(item.scope_type)} · level {item.escalation_level}</span>{item.awaiting_acknowledgement ? <Badge value="awaiting acknowledgement"/> : null}</div><h2 className="mt-2 text-[13px] font-semibold text-[#111827]">{item.learner_name || item.class_name || `${item.member_count || 0} learner support group`} · {item.subject_name || 'Cross-subject review'}</h2><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#64748b]">{item.current_summary}</p></div>
          <div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Topic</strong>{item.topic_name || 'Multiple areas'}<span className="mt-1 block">{item.class_name}</span></div>
          <div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Evidence</strong>{percent(item.evidence_confidence)} confidence<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]"><span className="block h-full bg-emerald-600" style={{ width: `${progress}%` }}/></div><span>{item.completed_sessions || 0} of {item.planned_sessions || 0} sessions</span></div>
          <div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Next action</strong>{item.next_session_at ? `Support session ${date(item.next_session_at, true)}` : `Review ${date(item.next_review_at)}`}</div>
        </button>})}{!cases.length ? <div className="p-10 text-center text-[12px] text-[#64748b]">No authorised support case matches these filters.</div> : null}</div>}
      <div className="flex items-center justify-between border-t border-[#e2e8f0] p-3 text-[10px] text-[#64748b]"><span>Page {pagination.page || 1} of {Math.max(1, pagination.pages || 1)}</span><div className="flex gap-2"><Button variant="outline" className="h-8" disabled={(pagination.page || 1) <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}><ChevronLeft className="size-3.5"/>Previous</Button><Button variant="outline" className="h-8" disabled={(pagination.page || 1) >= (pagination.pages || 1)} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next<ChevronRight className="size-3.5"/></Button></div></div>
    </SectionCard>

    {(summary.recently_improved || []).length ? <SectionCard title="Recently improved" subtitle="Positive learner-support signals from structured outcomes"><div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">{summary.recently_improved.map((item: any) => <button key={item.public_ref} onClick={() => navigate(`/learner-support/${item.public_ref}`)} className="rounded-[7px] border border-emerald-200 bg-emerald-50 p-3 text-left"><div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-800"><Sparkles className="size-3.5"/>{item.learner_name || item.class_name || 'Support group'}</div><div className="mt-2 text-[11px] font-semibold text-[#111827]">{item.subject_name} · {item.topic_name}</div><div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#475569]">{item.current_summary}</div></button>)}</div></SectionCard> : null}
  </main>
}

function SupportCaseDetail({ caseRef }: { caseRef: string }) {
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [data, setData] = useState<any>(null)
  const [timeline, setTimeline] = useState<any[]>([])
  const [evidence, setEvidence] = useState<any[]>([])
  const [setup, setSetup] = useState<any>({ classes: [] })
  const [assessments, setAssessments] = useState<any[]>([])
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sessionForm, setSessionForm] = useState<any>({ status: 'completed', scheduled_at: new Date().toISOString().slice(0, 16), duration_minutes: 30, delivery_method: 'small_group', resources: '', activities: '', teacher_observation: '', practice_assigned: '', next_action: '', attendance: {} })
  const [noteForm, setNoteForm] = useState({ visibility: 'teacher_academic', note_text: '' })
  const [reviewExplanation, setReviewExplanation] = useState('')
  const [reassignmentReason, setReassignmentReason] = useState('')

  const load = async () => {
    if (!token) return
    setError('')
    try {
      const [casePayload, timelinePayload, evidencePayload, setupPayload, assessmentPayload] = await Promise.all([
        api.getSupportCase(token, caseRef), api.getSupportTimeline(token, caseRef), api.getSupportEvidence(token, caseRef),
        api.getAcademicAuthoringSetup(token).catch(() => ({ classes: [] })), api.listTargetedAssessments(token, {}).catch(() => ({ assessments: [] })),
      ])
      setData(casePayload); setTimeline(timelinePayload?.timeline || []); setEvidence(evidencePayload?.evidence || []); setSetup(setupPayload || { classes: [] }); setAssessments(assessmentPayload?.assessments || [])
    } catch (err: any) { setError(err?.message || 'Unable to load this learner-support case.') }
  }
  useEffect(() => { void load() }, [token, caseRef])

  const actions = useMemo(() => new Set(data?.access?.actions || []), [data?.access?.actions])
  const record = data?.case || {}
  const latestCycle = data?.intervention_cycles?.[0]
  const members = record.learner_ref ? [{ learner_ref: record.learner_ref, learner_name: record.learner_name, admission_no: record.admission_no }, ...(data?.members || []).filter((item: any) => item.learner_ref !== record.learner_ref)] : data?.members || []
  const caseAssessments = assessments.filter((item: any) => item.class_ref === record.class_ref && item.subject_ref === record.subject_ref && (item.topic_ref === record.topic_ref || item.subtopic_ref === record.topic_ref))

  const mutate = async (name: string, task: () => Promise<any>) => {
    setBusy(name); setError('')
    try { await task(); toast.success(`${name} saved.`); await load() }
    catch (err: any) { setError(err?.message || `Unable to save ${name.toLowerCase()}.`) }
    finally { setBusy('') }
  }

  const saveSession = () => {
    if (!latestCycle) return
    const attendance = members.map((member: any) => ({ learner_ref: member.learner_ref, status: sessionForm.attendance[member.learner_ref] || (sessionForm.status === 'learner_absent' ? 'absent' : 'present') }))
    return mutate('Support session', () => api.recordSupportSession(token, caseRef, { ...sessionForm, resources: sessionForm.resources.split('\n').map((item: string) => item.trim()).filter(Boolean), activities: sessionForm.activities.split('\n').map((item: string) => item.trim()).filter(Boolean), cycle_ref: latestCycle.public_ref, attendance, version_number: record.version_number, idempotency_key: idempotency() }))
  }

  if (!data) return <main className="grid min-h-80 place-items-center p-4">{error ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-4 text-[12px] text-red-700">{error}<Button variant="outline" className="ml-3" onClick={() => navigate('/learner-support')}>Back</Button></div> : <RefreshCw className="size-6 animate-spin text-[#64748b]"/>}</main>

  return <main className="grid gap-3 p-4">
    <section className="rounded-[8px] border border-[#dbe3ee] bg-white p-5 shadow-sm">
      <Button variant="ghost" className="mb-3 h-8 px-0" onClick={() => navigate('/learner-support')}><ArrowLeft className="size-4"/>Learner Support</Button>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge value={record.severity}/><Badge value={record.status}/><Badge value={record.scope_type}/></div><h1 className="mt-3 text-[21px] font-semibold text-[#111827]">{record.learner_name || record.class_name || `${members.length} learner support group`}</h1><p className="mt-1 text-[12px] text-[#64748b]">{record.class_name} · {record.subject_name || 'Cross-subject'} · {record.topic_name || 'Multiple learning areas'}</p><p className="mt-3 max-w-3xl text-[11px] leading-5 text-[#475569]">{record.current_summary}</p></div><div className="flex flex-wrap gap-2">{actions.has('acknowledge') ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Acknowledgement', () => api.acknowledgeSupportCase(token, caseRef, { idempotency_key: idempotency() }))}><UserCheck className="size-4"/>Acknowledge</Button> : null}{actions.has('complete_assignment') ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Assigned action', () => api.completeSupportAssignment(token, caseRef, { idempotency_key: idempotency() }))}><CheckCircle2 className="size-4"/>Complete my action</Button> : null}{actions.has('accept_ownership') ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Ownership', () => api.acceptSupportOwnership(token, caseRef, { version_number: record.version_number, idempotency_key: idempotency() }))}><Users className="size-4"/>Accept ownership</Button> : null}</div></div>
    </section>
    {error ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</div> : null}
    {data.schema_status === 'compatibility_read_only' ? <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium text-amber-900">This case is open in database compatibility mode. Controls that require unavailable support-access columns are hidden to prevent failed or partial writes.</div> : null}
    <SectionKpiStrip items={[
      { label: 'Support stage', value: label(record.status), helper: `Level ${record.escalation_level}`, delta: label(record.severity) },
      { label: 'Evidence confidence', value: percent(record.evidence_confidence), helper: `${record.comparable_failure_count || 0} comparable findings`, delta: 'structured evidence' },
      { label: 'Session progress', value: `${(data.sessions || []).filter((item: any) => item.status === 'completed').length}/${latestCycle?.planned_session_count || 0}`, helper: 'fully completed', delta: label(latestCycle?.outcome || 'pending') },
      { label: 'Next review', value: date(record.next_review_at), helper: record.owner_name || 'Owner not assigned', delta: label(record.status) },
    ]}/>
    <div className="flex gap-1 overflow-x-auto rounded-[7px] border border-[#dbe3ee] bg-white p-1">{CASE_TABS.map((item) => <button type="button" key={item} onClick={() => setTab(item)} className={`h-8 whitespace-nowrap rounded-[5px] px-3 text-[10px] font-semibold ${tab === item ? 'bg-[#111827] text-white' : 'text-[#475569] hover:bg-[#f1f5f9]'}`}>{label(item)}</button>)}</div>

    {tab === 'overview' ? <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
      <div className="grid gap-3"><SectionCard title="Case overview" subtitle="Identity, objective, current stage and recommended next action"><div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{[
        ['Case identifier', record.public_ref], ['Learner / group', record.learner_name || `${members.length} learners`], ['Class', record.class_name], ['Subject', record.subject_name], ['Primary topic', record.topic_name], ['Affected objective', record.objective_text], ['First detected', date(record.first_detected_at)], ['Current owner', record.owner_name || 'Unassigned'], ['Recent trend', latestCycle?.outcome ? label(latestCycle.outcome) : 'Awaiting measured outcome'],
      ].map(([name, value]) => <div key={name} className="rounded-[6px] border border-[#e2e8f0] p-3 text-[10px]"><span className="block font-semibold text-[#64748b]">{name}</span><strong className="mt-1 block text-[#111827]">{value || 'Not recorded'}</strong></div>)}</div></SectionCard>
      <SectionCard title={record.scope_type === 'learner' ? 'Learner' : 'Affected learners'} subtitle="Membership and learner-specific outcome records"><div className="divide-y divide-[#edf0f4]">{members.map((member: any) => <div key={member.learner_ref} className="flex items-center justify-between gap-3 p-3 text-[11px]"><span><strong className="block text-[#111827]">{member.learner_name}</strong><span className="text-[#64748b]">{member.admission_no || member.learner_ref}</span></span><Badge value={member.membership_status || 'active'}/></div>)}</div></SectionCard><SectionCard title="Resolution safeguards" subtitle="Completion alone never closes a support case"><div className="grid gap-2 p-4 text-[10px] text-[#475569]"><span>Published comparable reassessment evidence is required.</span><span>The configured sustained-success count must be met.</span><span>An authorised human review must confirm resolution.</span></div></SectionCard></div>
      <div className="grid content-start gap-3"><SectionCard title="My relationship" subtitle="Backend-evaluated access to this case"><div className="flex flex-wrap gap-2 p-4">{(data.access?.relationships || []).map((item: string) => <Badge value={item} key={item}/>)}</div></SectionCard>{actions.has('request_reassignment') ? <SectionCard title="Request reassignment" subtitle="A coordinator or headteacher will review the request"><div className="grid gap-2 p-4"><Textarea value={reassignmentReason} onChange={(event) => setReassignmentReason(event.target.value)} placeholder="Why should this case be reassigned?"/><Button variant="outline" disabled={!reassignmentReason.trim() || Boolean(busy)} onClick={() => mutate('Reassignment request', () => api.requestSupportReassignment(token, caseRef, { explanation: reassignmentReason, idempotency_key: idempotency() }))}>Request reassignment</Button></div></SectionCard> : null}</div>
    </div> : null}

    {tab === 'evidence' ? <SectionCard title="Evidence" subtitle="Official, historical, incomplete and low-confidence evidence are kept distinct"><div className="overflow-x-auto"><table className="w-full text-left text-[10px]"><thead className="border-b bg-[#f8fafc] text-[#64748b]"><tr><th className="p-3">Date</th><th>Source</th><th>Question / mapping</th><th>Score</th><th>Precision</th><th>Confidence</th><th>State</th></tr></thead><tbody>{evidence.map((item: any) => <tr key={item.public_ref} className="border-b align-top last:border-0"><td className="p-3 whitespace-nowrap">{date(item.observed_at)}</td><td className="min-w-48 py-3 pr-3">{item.assessment_name ? <strong className="text-[#111827]">Assessments: {item.assessment_name}</strong> : <strong className="text-[#111827]">{label(item.event_type || item.evidence_role)}</strong>}{item.summary ? <p className="mt-1 max-w-sm text-[#64748b]">{item.summary}</p> : null}</td><td className="min-w-64 py-3 pr-3"><strong>{item.question_number ? `Question ${item.question_number}` : item.topic_name || 'Detection record'}</strong>{item.question_text ? <details className="mt-1"><summary className="cursor-pointer text-emerald-700">Inspect question performance</summary><p className="mt-1 text-[#475569]">{item.question_text}</p><p className="mt-1">{item.marks_awarded ?? '—'} of {item.marks_available ?? '—'} marks · {item.objective_text || 'Objective not mapped'}</p></details> : null}</td><td className="py-3 pr-3">{item.score_percentage === null ? '—' : `${Number(item.score_percentage).toFixed(1)}%`}</td><td className="py-3 pr-3"><Badge value={item.evidence_precision}/></td><td className="py-3 pr-3">{percent(item.confidence_score)}</td><td className="py-3 pr-3"><Badge value={item.evidence_state || item.evidence_status}/>{!item.comparable && item.evidence_kind === 'assessment' ? <div className="mt-1 text-[#64748b]">Not comparable</div> : null}</td></tr>)}</tbody></table>{!evidence.length ? <div className="p-8 text-center text-[11px] text-[#64748b]">No permitted evidence is linked to this case.</div> : null}</div></SectionCard> : null}

    {tab === 'support plan' ? <div className="grid gap-3 xl:grid-cols-[1fr_360px]"><SectionCard title="Intervention cycles" subtitle="Planned delivery, strategy and measured outcomes"><div className="divide-y divide-[#edf0f4]">{(data.intervention_cycles || []).map((cycle: any) => <article key={cycle.public_ref} className="grid gap-3 p-4 md:grid-cols-[1fr_160px_160px]"><div><div className="flex gap-2"><Badge value={cycle.status}/><Badge value={cycle.outcome}/></div><h3 className="mt-2 text-[12px] font-semibold">Cycle {cycle.cycle_number} · {cycle.strategy_label}</h3></div><div className="text-[10px]"><strong className="block">Delivery</strong>{(data.sessions || []).filter((item: any) => item.cycle_ref === cycle.public_ref && item.status === 'completed').length} of {cycle.planned_session_count} completed</div><div className="text-[10px]"><strong className="block">Review date</strong>{date(cycle.review_date)}</div></article>)}{!data.intervention_cycles?.length ? <div className="p-8 text-center text-[11px] text-[#64748b]">No formal intervention cycle has been created.</div> : null}</div></SectionCard><SectionCard title="Plan action" subtitle="Create a structured cycle only when support is authorised"><div className="grid gap-2 p-4">{actions.has('create_intervention') ? <Button disabled={Boolean(busy)} onClick={() => mutate('Intervention cycle', () => api.createSupportIntervention(token, caseRef, { strategy_code: 'guided_practice', planned_session_count: 3, version_number: record.version_number, idempotency_key: idempotency() }))}><Users className="size-4"/>Create three-session cycle</Button> : <p className="text-[10px] text-[#64748b]">You have read-only access to this support plan.</p>}</div></SectionCard></div> : null}

    {tab === 'sessions' ? <div className="grid gap-3 xl:grid-cols-[1fr_420px]"><SectionCard title="Support sessions" subtitle="Planned sessions are not counted as delivered"><div className="divide-y divide-[#edf0f4]">{(data.sessions || []).map((session: any) => <article key={session.public_ref} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><Badge value={session.status}/><span className="text-[10px] font-semibold">Session {session.session_number}</span></div><span className="text-[10px] text-[#64748b]">{date(session.scheduled_at, true)}</span></div><div className="mt-3 grid gap-2 text-[10px] text-[#475569] sm:grid-cols-3"><span><strong className="block text-[#111827]">Delivery</strong>{session.delivery_method ? label(session.delivery_method) : 'Not recorded'} · {session.duration_minutes || '—'} min</span><span><strong className="block text-[#111827]">Observation</strong>{session.teacher_observation || session.teacher_notes || 'Not recorded'}</span><span><strong className="block text-[#111827]">Next action</strong>{session.next_action || 'Not recorded'}</span></div>{session.attendance?.length ? <div className="mt-3 flex flex-wrap gap-2">{session.attendance.map((item: any) => <span key={item.learner_ref} className="text-[9px] text-[#64748b]">{item.learner_name}: <Badge value={item.status}/></span>)}</div> : null}</article>)}{!data.sessions?.length ? <div className="p-8 text-center text-[11px] text-[#64748b]">No support sessions have been recorded.</div> : null}</div></SectionCard>
      {actions.has('record_session') && latestCycle ? <SectionCard title="Record support session" subtitle="Attendance and delivery details persist in the intervention record"><div className="grid gap-3 p-4"><div className="grid grid-cols-2 gap-2"><select className={selectClass} value={sessionForm.status} onChange={(event) => setSessionForm({ ...sessionForm, status: event.target.value })}>{SESSION_STATUSES.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><Input type="datetime-local" className="h-9 text-[11px]" value={sessionForm.scheduled_at} onChange={(event) => setSessionForm({ ...sessionForm, scheduled_at: event.target.value })}/><Input type="number" min={1} className="h-9 text-[11px]" value={sessionForm.duration_minutes} onChange={(event) => setSessionForm({ ...sessionForm, duration_minutes: Number(event.target.value) })}/><select className={selectClass} value={sessionForm.delivery_method} onChange={(event) => setSessionForm({ ...sessionForm, delivery_method: event.target.value })}><option value="individual">Individual</option><option value="small_group">Small group</option><option value="whole_class">Whole class</option><option value="online">Online</option><option value="home_practice_review">Home practice review</option></select></div><div className="rounded-[6px] border p-2"><div className="mb-2 text-[10px] font-semibold text-[#475569]">Learner attendance</div>{members.map((member: any) => <label key={member.learner_ref} className="flex items-center justify-between gap-2 border-t py-2 text-[10px]"><span>{member.learner_name}</span><select className="h-7 rounded border px-2" value={sessionForm.attendance[member.learner_ref] || 'present'} onChange={(event) => setSessionForm({ ...sessionForm, attendance: { ...sessionForm.attendance, [member.learner_ref]: event.target.value } })}><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></label>)}</div><Textarea value={sessionForm.resources} onChange={(event) => setSessionForm({ ...sessionForm, resources: event.target.value })} placeholder="Resources used, one per line"/><Textarea value={sessionForm.activities} onChange={(event) => setSessionForm({ ...sessionForm, activities: event.target.value })} placeholder="Activities completed, one per line"/><Textarea value={sessionForm.teacher_observation} onChange={(event) => setSessionForm({ ...sessionForm, teacher_observation: event.target.value })} placeholder="Academic observation"/><Input value={sessionForm.practice_assigned} onChange={(event) => setSessionForm({ ...sessionForm, practice_assigned: event.target.value })} placeholder="Homework or practice assigned"/><Input value={sessionForm.next_action} onChange={(event) => setSessionForm({ ...sessionForm, next_action: event.target.value })} placeholder="Next action"/><Button disabled={Boolean(busy)} onClick={saveSession}><ClipboardCheck className="size-4"/>Save session</Button></div></SectionCard> : null}</div> : null}

    {tab === 'reassessment' ? <div className="grid gap-3"><SectionCard title="Reassessment state" subtitle="A published result triggers the canonical intervention outcome evaluation"><div className="divide-y divide-[#edf0f4]">{(data.reassessments || []).map((item: any) => <article key={item.public_ref} className="grid gap-3 p-4 md:grid-cols-[1fr_140px_180px]"><div><div className="flex gap-2"><Badge value={item.outcome}/><Badge value={item.assessment_status}/></div><h3 className="mt-2 text-[12px] font-semibold">{item.assessment_title || 'Targeted reassessment'}</h3></div><div className="text-[10px]"><strong className="block">Due</strong>{date(item.due_at)}</div><div>{item.assessment_id ? <Button variant="outline" className="h-8" onClick={() => navigate(`/results/${item.assessment_id}`)}>Open linked mark sheet</Button> : <span className="text-[10px] text-[#64748b]">Publish the assessment to create its mark sheet.</span>}</div></article>)}{!data.reassessments?.length ? <div className="p-6 text-center text-[11px] text-[#64748b]">No reassessment has been linked yet.</div> : null}</div></SectionCard>
      {actions.has('create_assessment') ? <TargetedAssessmentWorkflow setup={setup} supportCase={record} rows={caseAssessments} onRefresh={load}/> : null}
      {actions.has('schedule_reassessment') && latestCycle && caseAssessments.some((item: any) => ['approved', 'published'].includes(item.status)) ? <SectionCard title="Link approved reassessment" subtitle="Link the reviewed assessment to this intervention cycle"><div className="flex flex-wrap gap-2 p-4"><select id="support-reassessment-select" className={selectClass}>{caseAssessments.filter((item: any) => ['approved', 'published'].includes(item.status)).map((item: any) => <option value={item.public_ref} key={item.public_ref}>{item.title} · {label(item.status)}</option>)}</select><Button onClick={() => { const ref = (document.getElementById('support-reassessment-select') as HTMLSelectElement)?.value; return mutate('Reassessment schedule', () => api.scheduleSupportReassessment(token, caseRef, { generated_assessment_ref: ref, cycle_ref: latestCycle.public_ref, due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), version_number: record.version_number, idempotency_key: idempotency() })) }}><CalendarClock className="size-4"/>Schedule reassessment</Button></div></SectionCard> : null}</div> : null}

    {tab === 'timeline' ? <SectionCard title="Case timeline" subtitle="Auditable support, evidence, assignment and review events"><div className="grid gap-0 p-4">{timeline.map((item: any) => <article key={item.public_ref} className="relative border-l-2 border-[#cbd5e1] pb-5 pl-4 last:pb-0"><span className="absolute -left-[5px] top-1 size-2 rounded-full bg-emerald-600"/><div className="flex flex-wrap justify-between gap-2"><strong className="text-[11px]">{label(item.event_type)}</strong><time className="text-[9px] text-[#64748b]">{date(item.occurred_at, true)}</time></div><p className="mt-1 text-[10px] leading-4 text-[#64748b]">{item.summary}</p><div className="mt-1 flex gap-2"><Badge value={item.status}/>{item.responsible_user ? <span className="text-[9px] text-[#64748b]">{item.responsible_user}</span> : null}</div></article>)}{!timeline.length ? <p className="text-[11px] text-[#64748b]">No timeline events recorded.</p> : null}</div></SectionCard> : null}

    {tab === 'notes' ? <div className="grid gap-3 xl:grid-cols-[1fr_420px]"><SectionCard title="Permitted notes" subtitle="Restricted note categories are removed by the backend before this response"><div className="divide-y divide-[#edf0f4]">{(data.notes || []).map((item: any) => <article key={item.public_ref} className="p-4"><div className="flex justify-between gap-2"><Badge value={item.visibility}/><span className="text-[9px] text-[#64748b]">{date(item.created_at, true)}</span></div><p className="mt-2 text-[11px] leading-5 text-[#334155]">{item.note_text}</p><p className="mt-1 text-[9px] text-[#64748b]">{item.author_name}</p></article>)}{!data.notes?.length ? <div className="p-8 text-center text-[11px] text-[#64748b]">No notes are visible within your role and case relationship.</div> : null}</div></SectionCard>{actions.has('add_note') ? <SectionCard title="Add academic note" subtitle="Choose the narrowest appropriate visibility"><div className="grid gap-3 p-4"><select className={selectClass} value={noteForm.visibility} onChange={(event) => setNoteForm({ ...noteForm, visibility: event.target.value })}><option value="teacher_academic">Teacher academic</option>{(data.access?.relationships || []).some((item: string) => ['owner', 'support_teacher'].includes(item)) ? <option value="support_team">Support team</option> : null}{data.access?.is_coordinator ? <option value="coordinator_only">Coordinator only</option> : null}{data.access?.is_headteacher ? <option value="headteacher_only">Headteacher only</option> : null}</select><Textarea className="min-h-32" value={noteForm.note_text} onChange={(event) => setNoteForm({ ...noteForm, note_text: event.target.value })} placeholder="Grounded academic observation; do not speculate about causes."/><Button disabled={!noteForm.note_text.trim() || Boolean(busy)} onClick={() => mutate('Academic note', () => api.addSupportNote(token, caseRef, { ...noteForm, idempotency_key: idempotency() }))}>Save academic note</Button></div></SectionCard> : null}</div> : null}

    {actions.has('request_review') || actions.has('recommend_escalation') ? <SectionCard title="Strategy review" subtitle="Teachers request review; restricted escalation decisions remain with authorised academic leaders"><div className="grid gap-2 p-4 md:grid-cols-[1fr_auto_auto]"><Textarea value={reviewExplanation} onChange={(event) => setReviewExplanation(event.target.value)} placeholder="Explain completed sessions, strategy, evidence, reassessment outcome, alternative and urgency."/>{actions.has('request_review') ? <Button variant="outline" disabled={!reviewExplanation.trim() || Boolean(busy)} onClick={() => mutate('Strategy review request', () => api.requestAcademicSupportReview(token, caseRef, { evidence_summary: { teacher_explanation: reviewExplanation }, version_number: record.version_number, idempotency_key: idempotency() }))}><CalendarClock className="size-4"/>Request review</Button> : null}{actions.has('recommend_escalation') ? <Button variant="outline" disabled={!reviewExplanation.trim() || Boolean(busy)} onClick={() => mutate('Escalation recommendation', () => api.recommendSupportEscalation(token, caseRef, { evidence_summary: { teacher_explanation: reviewExplanation }, version_number: record.version_number, idempotency_key: idempotency() }))}><ShieldAlert className="size-4"/>Recommend escalation</Button> : null}</div></SectionCard> : null}
  </main>
}

export function LearnerSupportPage() {
  const { caseId } = useParams()
  return caseId ? <SupportCaseDetail caseRef={caseId}/> : <SupportCaseList/>
}

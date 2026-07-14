import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { usePortal } from '../lib/portalContext'
import { Button } from '../components/ui/button'
import { SectionCard } from '../components/SectionCard'

const label = (value: any) => String(value || 'not set').replaceAll('_', ' ')
const date = (value: any) => value ? new Date(value).toLocaleDateString() : 'Not scheduled'
const tone = (value: any) => /urgent|high|overdue|ineffective|review/i.test(String(value)) ? 'border-red-200 bg-red-50 text-red-700' : /resolved|effective|completed/i.test(String(value)) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'

function Badge({ value }: { value: any }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] ${tone(value)}`}>{label(value)}</span>
}

function Metric({ title, value, detail }: { title: string; value: any; detail: string }) {
  return <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-[.08em] text-[#64748b]">{title}</p><p className="mt-1 text-[20px] font-semibold text-[#111827]">{value}</p><p className="mt-1 text-[10px] text-[#64748b]">{detail}</p></div>
}

function SupportCaseList() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<any>({ cases: [] })
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    try { setPayload(await api.listSupportCases(token, { status, overdue: overdue || undefined, limit: 100 })) }
    catch (error: any) { toast.error(error.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [status, overdue])
  const cases = payload.cases || []
  const counts = useMemo(() => ({ active: cases.filter((item: any) => !['resolved', 'closed_inconclusive'].includes(item.status)).length, strategy: cases.filter((item: any) => item.status === 'strategy_review').length, academic: cases.filter((item: any) => item.status === 'academic_team_review').length, overdue: cases.filter((item: any) => item.next_review_at && new Date(item.next_review_at) < new Date()).length }), [cases])
  return <main className="grid gap-3 p-4">
    <section className="rounded-[12px] border border-[#dbe3f0] bg-[linear-gradient(120deg,#111827,#172554_55%,#3730a3)] p-5 text-white"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-indigo-200">Persistent academic support</p><h1 className="mt-2 text-[24px] font-semibold tracking-[-.04em]">Learner Support Centre</h1><p className="mt-2 max-w-3xl text-[11px] leading-5 text-indigo-100">Cases retain mapped evidence, delivery, attendance, reassessment and strategy decisions across intervention cycles and terms.</p></div><Button className="bg-white text-[#172554] hover:bg-indigo-50" onClick={load}><RefreshCw className="size-4" />Refresh</Button></div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Active cases" value={counts.active} detail="Visible in your authorised scope"/><Metric title="Strategy review" value={counts.strategy} detail="A different approach is due"/><Metric title="Academic review" value={counts.academic} detail="Team review required"/><Metric title="Overdue" value={counts.overdue} detail="Past the next review date"/></div>
    <SectionCard title="Support queue" subtitle={`${label(user?.role)} view · school and teacher-assignment scoped`}><div className="flex flex-wrap gap-2 border-b border-[#e2e8f0] p-3"><select className="h-8 rounded-[6px] border border-[#cbd5e1] bg-white px-2 text-[11px]" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All active and historical states</option>{['detected','teacher_follow_up','intervention_active','reassessment_pending','strategy_review','academic_team_review','guardian_review','continued_support','resolved'].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><label className="flex items-center gap-2 text-[11px] text-[#475569]"><input type="checkbox" checked={overdue} onChange={(event) => setOverdue(event.target.checked)}/>Overdue only</label></div>{loading ? <div className="grid min-h-40 place-items-center text-[12px] text-[#64748b]"><RefreshCw className="size-5 animate-spin"/></div> : <div className="divide-y divide-[#edf0f4]">{cases.map((item: any) => <button key={item.public_ref} className="grid w-full gap-3 p-4 text-left hover:bg-[#f8fafc] lg:grid-cols-[minmax(0,1fr)_130px_130px_130px]" onClick={() => navigate(`/learner-support/${item.public_ref}`)}><div><div className="flex flex-wrap gap-2"><Badge value={item.severity}/><Badge value={item.status}/><span className="text-[9px] font-semibold uppercase text-[#64748b]">Level {item.escalation_level} · {label(item.scope_type)}</span></div><h2 className="mt-2 text-[13px] font-semibold text-[#111827]">{item.learner_name || item.class_name || 'Learner group'} · {item.subject_name || 'Cross-subject review'}</h2><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#64748b]">{item.current_summary}</p></div><div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Topic</strong>{item.topic_name || 'Multiple areas'}</div><div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Confidence</strong>{Number(item.evidence_confidence || 0).toFixed(0)}% · {item.comparable_failure_count} comparable</div><div className="text-[10px] text-[#64748b]"><strong className="block text-[#111827]">Next review</strong>{date(item.next_review_at)}</div></button>)}{!cases.length ? <div className="p-8 text-center text-[12px] text-[#64748b]">No support case matches this queue.</div> : null}</div>}</SectionCard>
  </main>
}

function SupportCaseDetail({ caseRef }: { caseRef: string }) {
  const { token, api } = usePortal()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [strategy, setStrategy] = useState('guided_practice')
  const [plannedSessions, setPlannedSessions] = useState(3)
  const load = async () => {
    setLoading(true)
    try {
      const [record, timeline, evidence, interventions, policy] = await Promise.all([api.getSupportCase(token, caseRef), api.getSupportTimeline(token, caseRef), api.getSupportEvidence(token, caseRef), api.getSupportInterventions(token, caseRef), api.getEscalationPolicy(token)])
      setData({ ...record, ...timeline, ...evidence, ...interventions, policy })
    } catch (error: any) { toast.error(error.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [caseRef])
  const mutate = async (name: string, action: () => Promise<any>) => { setBusy(name); try { await action(); toast.success(`${name} recorded`); await load() } catch (error: any) { toast.error(error.message) } finally { setBusy('') } }
  if (loading) return <div className="grid min-h-[420px] place-items-center text-[#64748b]"><RefreshCw className="size-6 animate-spin"/></div>
  if (!data?.case) return <div className="p-6">Support case was not found.</div>
  const record = data.case
  const latestCycle = data.intervention_cycles?.[0]
  return <main className="grid gap-3 p-4">
    <div><Button variant="outline" className="h-8 text-[10px]" onClick={() => navigate('/learner-support')}><ArrowLeft className="size-3.5"/>Support queue</Button></div>
    <section className="rounded-[12px] border border-[#dbe3f0] bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge value={record.severity}/><Badge value={record.status}/><span className="text-[9px] font-bold uppercase text-indigo-700">Escalation level {record.escalation_level}</span></div><h1 className="mt-2 text-[22px] font-semibold tracking-[-.035em] text-[#111827]">{record.learner_name || record.class_name || 'Support group'} · {record.subject_name || 'Cross-subject'}</h1><p className="mt-2 max-w-4xl text-[12px] leading-6 text-[#475569]">{record.current_summary}</p></div><Button variant="outline" onClick={load}><RefreshCw className="size-4"/>Refresh</Button></div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric title="Evidence confidence" value={`${Number(record.evidence_confidence || 0).toFixed(0)}%`} detail={`${record.comparable_failure_count} comparable failures`}/><Metric title="Affected topic" value={record.topic_name || 'Multiple'} detail={record.subject_name || 'Cross-subject'}/><Metric title="Support cycles" value={record.intervention_cycle_count} detail={`${record.unsuccessful_cycle_count} unsuccessful`}/><Metric title="Owner" value={record.owner_name || 'Unassigned'} detail={record.owner_role || 'Ownership required'}/><Metric title="Next review" value={date(record.next_review_at)} detail={record.next_review_at && new Date(record.next_review_at) < new Date() ? 'Overdue' : 'Scheduled review'}/></div>
    <div className="grid gap-3 xl:grid-cols-[1.25fr_.75fr]">
      <div className="grid gap-3">
        <SectionCard title="Case timeline" subtitle="Evidence and human decisions remain attached across terms"><div className="space-y-0 p-4">{(data.timeline || []).map((item: any) => <article key={item.public_ref} className="relative border-l-2 border-[#cbd5e1] pb-5 pl-4 last:pb-0"><span className="absolute -left-[5px] top-1 size-2 rounded-full bg-indigo-600"/><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[11px] font-semibold capitalize text-[#111827]">{label(item.event_type)}</h3><time className="text-[9px] text-[#64748b]">{new Date(item.occurred_at).toLocaleString()}</time></div><p className="mt-1 text-[10px] leading-5 text-[#64748b]">{item.summary}</p><div className="mt-1 flex gap-2"><Badge value={item.status}/>{item.responsible_user ? <span className="text-[9px] text-[#64748b]">{item.responsible_user}</span> : null}</div></article>)}{!data.timeline?.length ? <p className="text-[11px] text-[#64748b]">No timeline events have been recorded.</p> : null}</div></SectionCard>
        <SectionCard title="Evidence history" subtitle="Only published, status-valid evidence can drive escalation"><div className="overflow-x-auto"><table className="w-full text-left text-[10px]"><thead className="border-b bg-[#f8fafc] text-[#64748b]"><tr><th className="p-3">Date</th><th>Assessment</th><th>Topic</th><th>Precision</th><th>Score</th><th>Confidence</th><th>Comparable</th></tr></thead><tbody>{(data.evidence || []).map((item: any) => <tr key={item.public_ref} className="border-b last:border-0"><td className="p-3">{date(item.observed_at)}</td><td>{item.assessment_name || 'Mapped evidence'}</td><td>{item.topic_name || 'Limited'}</td><td><Badge value={item.evidence_precision}/></td><td>{item.score_percentage === null ? '—' : `${Number(item.score_percentage).toFixed(1)}%`}</td><td>{Number(item.confidence_score).toFixed(0)}%</td><td><Badge value={item.comparable ? 'comparable' : 'not comparable'}/></td></tr>)}</tbody></table></div></SectionCard>
        <SectionCard title="Intervention cycles" subtitle="Delivery and participation are checked before learner response"><div className="divide-y divide-[#edf0f4]">{(data.intervention_cycles || []).map((cycle: any) => <article key={cycle.public_ref} className="grid gap-3 p-4 md:grid-cols-[1fr_120px_120px]"><div><div className="flex gap-2"><Badge value={cycle.status}/><Badge value={cycle.outcome}/></div><h3 className="mt-2 text-[12px] font-semibold text-[#111827]">Cycle {cycle.cycle_number} · {cycle.strategy_label}</h3><p className="mt-1 text-[10px] text-[#64748b]">{cycle.completed_sessions || 0} completed of {cycle.planned_session_count} planned sessions</p></div><div className="text-[10px]"><strong className="block">Review</strong>{date(cycle.review_date)}</div><div className="text-[10px]"><strong className="block">Recorded</strong>{cycle.recorded_sessions || 0} sessions</div></article>)}{!data.intervention_cycles?.length ? <div className="p-6 text-center text-[11px] text-[#64748b]">No formal intervention cycle has been created.</div> : null}</div></SectionCard>
      </div>
      <div className="grid content-start gap-3">
        <SectionCard title="Next support action" subtitle="Actions create auditable timeline events"><div className="grid gap-3 p-4"><label className="grid gap-1 text-[10px] font-semibold text-[#475569]">Strategy<select className="h-8 rounded border px-2 font-normal" value={strategy} onChange={(event) => setStrategy(event.target.value)}>{['guided_practice','visual_concrete_materials','prerequisite_reteaching','small_group_instruction','worked_examples','oral_diagnostic','untimed_practice','spaced_retrieval','peer_supported_practice','practical_task','timed_practice','written_diagnostic','direct_reteaching','homework_reinforcement'].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label><label className="grid gap-1 text-[10px] font-semibold text-[#475569]">Planned sessions<input className="h-8 rounded border px-2 font-normal" type="number" min="1" value={plannedSessions} onChange={(event) => setPlannedSessions(Number(event.target.value))}/></label><Button disabled={Boolean(busy)} onClick={() => mutate('Intervention cycle', () => api.createSupportIntervention(token, caseRef, { strategy_code: strategy, planned_session_count: plannedSessions, version_number: record.version_number }))}><Users className="size-4"/>Create intervention cycle</Button>{latestCycle ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Support session', () => api.recordSupportSession(token, caseRef, { cycle_ref: latestCycle.public_ref, status: 'completed', teacher_attended: true, target_taught: true, version_number: record.version_number }))}><ClipboardCheck className="size-4"/>Record completed session</Button> : null}<Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Escalation', () => api.escalateSupportCase(token, caseRef, { reason: 'Authorised staff review', version_number: record.version_number }))}><ShieldAlert className="size-4"/>Escalate after review</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Academic review', () => api.requestAcademicSupportReview(token, caseRef, { version_number: record.version_number }))}><CalendarClock className="size-4"/>Request academic review</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => mutate('Guardian-safe draft', () => api.draftGuardianSupportSummary(token, caseRef, { version_number: record.version_number }))}>Draft guardian summary</Button></div></SectionCard>
        <SectionCard title="Escalation policy" subtitle={`School policy version ${data.policy?.version_number || 0}`}><dl className="grid gap-2 p-4 text-[10px]">{Object.entries(data.policy?.policy || {}).map(([key, value]) => <div key={key} className="flex justify-between gap-3 border-b border-[#edf0f4] pb-2"><dt className="text-[#64748b]">{label(key)}</dt><dd className="font-semibold text-[#111827]">{String(value)}</dd></div>)}</dl></SectionCard>
        <SectionCard title="Resolution safeguards" subtitle="Completion alone never closes a case"><div className="p-4 text-[10px] leading-5 text-[#64748b]"><p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600"/>Published comparable reassessment evidence</p><p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600"/>Configured sustained-success count</p><p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600"/>Completed human teacher review</p></div></SectionCard>
      </div>
    </div>
  </main>
}

export function LearnerSupportPage() {
  const { caseId } = useParams()
  return caseId ? <SupportCaseDetail caseRef={caseId}/> : <SupportCaseList/>
}

import { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Sparkles, Users } from 'lucide-react'
import { toast } from 'sonner'
import { usePortal } from '../lib/portalContext'
import { Button } from '../components/ui/button'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { TargetedAssessmentWorkflow } from '../components/TargetedAssessmentWorkflow'

function Status({ value }: { value: any }) {
  const text = String(value || '—').replaceAll('_', ' ')
  const bad = /urgent|high|risk|revision|delayed|declining|overdue/i.test(text)
  const good = /mastered|completed|strong|stable|improving|resolved|effective/i.test(text)
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase ${bad ? 'border-red-200 bg-red-50 text-red-700' : good ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{text}</span>
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: any; detail: string; icon: any }) {
  return <article className="rounded-[8px] border border-[#e2e8f0] bg-white p-3"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">{label}</span><Icon className="size-3.5 text-[#6366f1]" /></div><div className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[#111827]">{value}</div><p className="mt-0.5 text-[10px] leading-4 text-[#64748b]">{detail}</p></article>
}

function EngineBadge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn'; children: any }) {
  const styles = tone === 'good' ? 'border-emerald-300/40 bg-emerald-400/15 text-emerald-100' : tone === 'warn' ? 'border-amber-300/40 bg-amber-400/15 text-amber-100' : 'border-white/20 bg-white/10 text-indigo-100'
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${styles}`}><span className={`size-1.5 rounded-full ${tone === 'good' ? 'bg-emerald-300' : tone === 'warn' ? 'bg-amber-300' : 'bg-indigo-200'}`} />{children}</span>
}

function PriorityRow({ row, onTarget }: { row: any; onTarget: (row: any) => void }) {
  const severity = String(row.severity || row.priority || 'informational').toLowerCase()
  const evidence = row.evidence || {}
  const confidence = row.confidence_score ?? evidence.confidence_score ?? evidence.confidence ?? null
  const scope = [row.class_name, row.subject_name, row.topic_name].filter(Boolean).join(' · ') || 'School academic scope'
  const canTarget = Boolean(row.class_ref && row.subject_ref && row.topic_ref)
  return <article className="grid gap-3 border-b border-[#edf0f4] p-4 last:border-b-0">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><Status value={severity} /><span className="text-[9px] font-semibold uppercase text-[#64748b]">{scope}</span></div><h3 className="mt-1.5 text-[13px] font-semibold leading-5 text-[#111827]">{row.title || row.message || 'Academic review required'}</h3></div><span className="text-[10px] font-semibold text-[#475569]">{confidence === null ? 'Confidence limited' : `${Number(confidence).toFixed(0)}% confidence`}</span></div>
    <p className="text-[11px] leading-5 text-[#64748b]">{row.reason || row.message || 'Available evidence suggests this scope needs staff review.'}</p>
    <div className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-2.5 text-[10px] leading-4 text-[#475569] sm:grid-cols-3"><span><strong className="block text-[#111827]">Recommended action</strong>{row.suggested_action || 'Review the linked evidence and record a next step.'}</span><span><strong className="block text-[#111827]">Owner and deadline</strong>{row.owner_name || 'Unassigned'} · {row.due_at ? new Date(row.due_at).toLocaleDateString() : 'No deadline set'}</span><span><strong className="block text-[#111827]">Reassessment</strong>{evidence.reassessment_method || 'Short mapped diagnostic after support'}</span></div>
    <div className="flex flex-wrap gap-2"><Button className="h-7 text-[10px]" disabled={!canTarget} onClick={() => onTarget(row)}>Create targeted assessment</Button>{row.class_ref ? <a className="inline-flex h-7 items-center rounded-[5px] border border-[#d9dce3] bg-white px-3 text-[10px] font-semibold text-[#334155]" href={`/classes/${row.class_ref}`}>Open class</a> : null}{!canTarget ? <span className="self-center text-[9px] text-amber-700">Map this finding to a class, subject and topic before generating an assessment.</span> : null}</div>
  </article>
}

export function AcademicIntelligencePage() {
  const { token, api } = usePortal()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFinding, setSelectedFinding] = useState<any>(null)
  const [narration, setNarration] = useState<any>(null)
  const [narrating, setNarrating] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const [command, authoring, evidenceGaps, history, targeted] = await Promise.all([
        api.getAcademicCommandCentre(token),
        api.getAcademicAuthoringSetup(token),
        api.getAcademicEvidenceGaps(token).catch(() => ({ evidence_gaps: [] })),
        api.getAcademicHistory(token, { status: 'completed' }).catch(() => ({ history: [] })),
        api.listTargetedAssessments(token).catch(() => ({ targeted_assessments: [] })),
      ])
      setData({ ...command, authoring, evidence_gaps: evidenceGaps.evidence_gaps || [], history: history.history || [], targeted_assessments: targeted.targeted_assessments || [] })
    } catch (error: any) { toast.error(error.message); setData({}) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const priorities = useMemo(() => [...(data?.recommendations || []), ...(data?.alerts || [])].sort((a: any, b: any) => ({ urgent: 4, critical: 4, high: 3, medium: 2, low: 1 }[String(b.severity || b.priority || '').toLowerCase()] || 0) - ({ urgent: 4, critical: 4, high: 3, medium: 2, low: 1 }[String(a.severity || a.priority || '').toLowerCase()] || 0)).slice(0, 5), [data?.recommendations, data?.alerts])
  const readiness = useMemo(() => {
    const rows = (data?.readiness || []).filter((row: any) => Number.isFinite(Number(row.readiness_score)))
    return rows.length ? { score: Math.round(rows.reduce((sum: number, row: any) => sum + Number(row.readiness_score), 0) / rows.length), confidence: Math.round(rows.reduce((sum: number, row: any) => sum + Number(row.confidence_score || 0), 0) / rows.length) } : { score: null, confidence: null }
  }, [data?.readiness])
  const classRows = useMemo(() => {
    const groups = new Map<string, any>()
    for (const row of data?.class_health || []) {
      const current = groups.get(row.class_ref) || { class_ref: row.class_ref, class_name: row.class_name, subjects: 0, taught: [], assessed: [], mastery: [], below: 0, revision: 0 }
      current.subjects += 1; current.taught.push(Number(row.taught_percentage)); current.assessed.push(Number(row.assessed_percentage)); if (row.class_mastery_score !== null) current.mastery.push(Number(row.class_mastery_score)); current.below += Number(row.students_below_threshold || 0); current.revision += Number(row.revision_topics || 0); groups.set(row.class_ref, current)
    }
    const mean = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
    return [...groups.values()].map((row) => ({ ...row, taught: mean(row.taught), assessed: mean(row.assessed), mastery: mean(row.mastery), state: row.revision || row.below ? 'action required' : row.mastery === null ? 'insufficient evidence' : 'stable' }))
  }, [data?.class_health])
  const explainValidatedFindings = async () => {
    const findings = priorities.map((row: any) => ({ findingId: row.public_ref, category: row.alert_type || row.recommendation_type || 'academic', severity: row.severity || row.priority || 'informational', title: row.title, reason: row.reason || row.message, confidence_score: row.confidence_score, evidence_summary: row.evidence || {}, allowed_actions: ['Review linked evidence', 'Create a teacher-owned targeted assessment'] }))
    if (!findings.length) return toast.info('There are no validated findings to explain yet.')
    setNarrating(true)
    try { setNarration(await api.explainAcademicFindings(token, { findings, metrics: { open_findings: findings.length }, evidenceLimitations: ['AI may explain validated facts but cannot calculate marks or mastery.'] })) } catch (error: any) { toast.error(error.message) } finally { setNarrating(false) }
  }
  if (loading) return <div className="grid min-h-[380px] place-items-center text-[13px] text-[#64748b]"><span><RefreshCw className="mx-auto mb-2 size-5 animate-spin" />Calculating operational academic view…</span></div>
  const counts = data?.operational_counts || {}
  return <div className="grid gap-3 p-4">
    <section className="overflow-hidden rounded-[12px] border border-[#dbe3f0] bg-[linear-gradient(120deg,#111827_0%,#172554_54%,#3730a3_100%)] p-5 text-white shadow-[0_18px_45px_rgba(30,41,59,.16)]"><div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-200">Academic Position Today</span><EngineBadge tone="good">Deterministic evidence active</EngineBadge><EngineBadge>AI explanation on demand</EngineBadge></div><h1 className="mt-2 max-w-4xl text-[21px] font-semibold leading-8 tracking-[-0.035em]">{data?.academic_position_today || 'No validated academic position is available yet.'}</h1><p className="mt-2 max-w-3xl text-[11px] leading-5 text-indigo-100">Draft marks remain provisional. Published, mapped evidence drives scoped learner, topic, class and intervention updates.</p></div><div className="flex flex-wrap gap-2"><Button className="border border-white/20 bg-white text-[#172554] hover:bg-indigo-50" onClick={explainValidatedFindings} disabled={narrating}>{narrating ? 'Interpreting…' : 'Explain findings'}</Button><Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/15" onClick={load}><RefreshCw className="size-4" />Refresh</Button></div></div></section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Readiness" value={readiness.score === null ? '—' : `${readiness.score}%`} detail="Signal, not predicted mark" icon={Activity} /><Metric label="Evidence confidence" value={readiness.confidence === null ? '—' : `${readiness.confidence}%`} detail="Visible when sufficient" icon={CheckCircle2} /><Metric label="Classes needing action" value={counts.classes_needing_action || 0} detail="Validated open risks" icon={ShieldAlert} /><Metric label="Active interventions" value={counts.active_interventions || 0} detail="Support under review" icon={Users} /><Metric label="Overdue actions" value={counts.overdue_actions || 0} detail="Needs ownership" icon={Clock3} /><Metric label="Positive signals" value={counts.positive_signals || 0} detail="Improvement and resolution" icon={Sparkles} /></div>

    <div className="grid gap-3 xl:grid-cols-[1.2fr_.8fr]"><SectionCard title="Immediate Priorities" subtitle="At most five consolidated findings, with evidence, ownership, deadline and a measurable next step."><div className="overflow-hidden rounded-[8px] border border-[#e2e8f0] bg-white">{priorities.length ? priorities.map((row: any) => <PriorityRow key={row.public_ref} row={row} onTarget={(finding) => { setSelectedFinding(finding); document.getElementById('targeted-assessment-workflow')?.scrollIntoView({ behavior: 'smooth' }) }} />) : <div className="p-6 text-center text-[12px] text-[#64748b]">No validated priority currently requires action.</div>}</div></SectionCard><SectionCard title="Positive Signals" subtitle="Successful support and resolved risks are visible alongside problems."><div className="divide-y divide-[#edf0f4]">{(data?.positive_signals || []).map((row: any) => <article key={`${row.signal_type}-${row.public_ref}`} className="p-4"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><div><h3 className="text-[12px] font-semibold text-[#111827]">{row.title}</h3><p className="mt-1 text-[10px] text-[#64748b]">{row.changed_at ? new Date(row.changed_at).toLocaleDateString() : 'Recently confirmed'}</p></div></div></article>)}{!(data?.positive_signals || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">Positive signals will appear when an intervention succeeds or a risk is resolved.</div> : null}</div></SectionCard></div>

    <SectionCard title="Class Health Overview" subtitle="One operational row per class; subject and topic evidence remains available through drill-down."><PortalTable rows={classRows} columns={[{ key: 'class_name', label: 'Class', render: (row: any) => <a className="font-semibold text-indigo-700 hover:underline" href={`/classes/${row.class_ref}`}>{row.class_name}</a> }, { key: 'state', label: 'State', render: (row: any) => <Status value={row.state} /> }, { key: 'subjects', label: 'Subjects' }, { key: 'taught', label: 'Taught', render: (row: any) => row.taught === null ? '—' : `${row.taught}%` }, { key: 'assessed', label: 'Assessed', render: (row: any) => row.assessed === null ? '—' : `${row.assessed}%` }, { key: 'mastery', label: 'Mastery', render: (row: any) => row.mastery === null ? 'Insufficient evidence' : `${row.mastery}%` }, { key: 'below', label: 'Below secure' }, { key: 'revision', label: 'Topics needing revision' }]} /></SectionCard>

    <div className="grid gap-3 xl:grid-cols-2"><SectionCard title="Evidence Gaps" subtitle="Totals-only evidence and missing mappings are never promoted into invented topic claims."><div className="divide-y divide-[#edf0f4]">{(data?.evidence_gaps || []).slice(0, 20).map((row: any, index: number) => <article key={`${row.gap_type}-${row.entity_ref || 'gap'}-${index}`} className="flex items-start justify-between gap-3 p-3"><div><div className="text-[9px] font-bold uppercase text-amber-700">{String(row.gap_type || 'limited_evidence').replaceAll('_', ' ')}</div><h3 className="mt-1 text-[11px] font-semibold text-[#111827]">{[row.class_name, row.subject_name, row.assessment_name, row.topic_name].filter(Boolean).join(' · ') || 'Academic evidence'}</h3><p className="mt-1 text-[10px] leading-4 text-[#64748b]">{row.reason}</p></div><Status value={row.action || 'review'} /></article>)}{!(data?.evidence_gaps || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No current evidence gap was detected.</div> : null}</div></SectionCard><SectionCard title="Recent Meaningful Changes" subtitle="Only material score, confidence, severity and outcome changes are retained."><div className="divide-y divide-[#edf0f4]">{(data?.meaningful_changes || []).slice(0, 20).map((row: any) => <article key={row.public_ref} className="p-3"><div className="flex items-start justify-between gap-2"><div><h3 className="text-[11px] font-semibold text-[#111827]">{String(row.metric_key || 'Academic state').replaceAll('_', ' ')}</h3><p className="mt-1 text-[10px] leading-4 text-[#64748b]">{row.reason || `${row.scope_type} evidence changed materially.`}</p></div><span className="font-mono text-[10px] font-semibold text-[#475569]">{row.metric_value === null ? row.evidence_state : Number(row.metric_value).toFixed(1)}</span></div></article>)}{!(data?.meaningful_changes || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No material academic change has been recorded yet.</div> : null}</div></SectionCard></div>

    {narration ? <SectionCard title="Role-aware Academic Explanation" subtitle={`Source: ${narration.source === 'ai_explained' ? 'validated AI narration' : 'deterministic fallback'} · facts remain tied to finding IDs.`}><div className="grid gap-3 p-4"><p className="text-[12px] leading-5 text-[#334155]">{narration.data?.executiveSummary}</p>{(narration.data?.priorities || []).map((item: any) => <article key={item.findingId} className="rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] p-3"><div className="text-[11px] font-semibold text-[#111827]">{item.headline}</div><p className="mt-1 text-[10px] leading-4 text-[#64748b]">{item.explanation}</p><p className="mt-2 text-[10px] font-medium text-[#334155]">Next: {item.recommendedAction}</p></article>)}</div></SectionCard> : null}

    <div id="targeted-assessment-workflow"><TargetedAssessmentWorkflow setup={data?.authoring} finding={selectedFinding} rows={data?.targeted_assessments || []} onRefresh={load} /></div>

    <SectionCard title="Intervention Oversight" subtitle="Support remains open until a linked reassessment supplies an outcome."><PortalTable rows={data?.interventions || []} columns={[{ key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' }, { key: 'topic_name', label: 'Topic' }, { key: 'issue', label: 'Issue' }, { key: 'owner_name', label: 'Owner', render: (row: any) => row.owner_name || 'Unassigned' }, { key: 'review_date', label: 'Review' }, { key: 'status', label: 'Status', render: (row: any) => <Status value={row.status} /> }, { key: 'outcome', label: 'Outcome', render: (row: any) => <Status value={row.outcome || 'pending'} /> }]} /></SectionCard>
  </div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BookOpenCheck, Check, CheckCircle2, Clock3, Cloud, CloudOff, Play, RefreshCw, Users } from 'lucide-react'
import { toast } from 'sonner'
import { usePortal } from '../lib/portalContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'

const DRAFT_KEY = 'smartlink.classroom-mode.draft.'

function Select({ value, onChange, children }: { value: any; onChange: (value: string) => void; children: any }) {
  return <select className="h-9 rounded-[6px] border border-[#d9dee7] bg-white px-3 text-[12px]" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
}

function periodTime(value: any) {
  return value ? String(value).slice(0, 5) : '—'
}

function LessonCountdown({ session }: { session: any }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const range = useMemo(() => {
    const date = String(session.lesson_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
    if (session.scheduled_start_time && session.scheduled_end_time) {
      return {
        start: new Date(`${date}T${String(session.scheduled_start_time).slice(0, 8)}`).getTime(),
        end: new Date(`${date}T${String(session.scheduled_end_time).slice(0, 8)}`).getTime(),
      }
    }
    const start = new Date(session.started_at || now).getTime()
    return { start, end: start + (40 * 60 * 1000) }
  }, [session])
  const remaining = Math.max(0, range.end - now)
  const progress = Math.max(0, Math.min(100, ((now - range.start) / Math.max(1, range.end - range.start)) * 100))
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return (
    <div className="min-w-[210px] rounded-[12px] border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-100"><span>Time remaining</span><Clock3 className="size-3.5" /></div>
      <div className="mt-1 font-mono text-[28px] font-semibold tracking-[-0.04em] text-white">{minutes}:{String(seconds).padStart(2, '0')}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-[#fbbf24] transition-[width]" style={{ width: `${progress}%` }} /></div>
    </div>
  )
}

function Launcher() {
  const { token, api } = usePortal()
  const navigate = useNavigate()
  const [setup, setSetup] = useState<any>({ classes: [] })
  const [history, setHistory] = useState<any[]>([])
  const [classRef, setClassRef] = useState('')
  const [subjectRef, setSubjectRef] = useState('')
  const [topicRef, setTopicRef] = useState('')
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    Promise.all([api.getClassroomSetup(token), api.listClassroomHistory(token)])
      .then(([payload, recent]: any[]) => { setSetup({ classes: payload.classes || [] }); setHistory(recent.sessions || []) })
      .catch((error: any) => toast.error(error.message))
  }, [api, token])
  const selectedClass = setup.classes.find((row: any) => row.public_ref === classRef)
  const selectedSubject = selectedClass?.subjects?.find((row: any) => row.public_ref === subjectRef)
  const start = async () => {
    if (!classRef || !subjectRef) return
    setStarting(true)
    try {
      const response = await api.startClassroomSession(token, { class_ref: classRef, subject_ref: subjectRef, topic_ref: topicRef || undefined, offline_client_id: crypto.randomUUID() })
      navigate(`/classroom/${response.session.public_ref}`)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setStarting(false)
    }
  }
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#c4b5fd_0,transparent_34%),radial-gradient(circle_at_bottom_right,#67e8f9_0,transparent_32%),linear-gradient(135deg,#eef2ff,#f8fafc_48%,#ecfeff)] p-4 md:p-8">
      <button onClick={() => navigate('/dashboard')} className="mb-4 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-[12px] font-semibold text-[#4338ca] shadow-sm backdrop-blur hover:bg-white">← Return to dashboard</button>
      <div className="mx-auto grid max-w-6xl gap-4">
        <section className="overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-[0_28px_80px_rgba(79,70,229,.18)] backdrop-blur">
          <div className="bg-gradient-to-r from-[#4338ca] via-[#6d28d9] to-[#0e7490] p-7 text-white">
            <span className="grid size-11 place-items-center rounded-[12px] bg-white/15"><Play className="size-5" /></span>
            <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-100">Teacher-operated Classroom Mode</div>
            <h1 className="mt-2 max-w-3xl text-[32px] font-semibold tracking-[-0.05em]">A clean teaching canvas for the lesson in front of you</h1>
            <p className="mt-3 max-w-3xl text-[13px] leading-6 text-indigo-100">Students keep using books, paper and verbal responses. SmartLink stays focused on attendance, lesson delivery, classroom judgement and the next academic action.</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Select value={classRef} onChange={(value) => { setClassRef(value); setSubjectRef(''); setTopicRef('') }}><option value="">Select assigned class</option>{setup.classes.map((row: any) => <option key={row.public_ref} value={row.public_ref}>{row.name}</option>)}</Select>
            <Select value={subjectRef} onChange={(value) => { setSubjectRef(value); setTopicRef('') }}><option value="">Select assigned subject</option>{(selectedClass?.subjects || []).map((row: any) => <option key={row.public_ref} value={row.public_ref}>{row.name}</option>)}</Select>
            <Select value={topicRef} onChange={setTopicRef}><option value="">Topic can be selected later</option>{(selectedSubject?.topics || []).map((row: any) => <option key={row.public_ref} value={row.public_ref}>{row.name}</option>)}</Select>
            <Button className="bg-[#4338ca] hover:bg-[#3730a3]" disabled={!classRef || !subjectRef || starting} onClick={start}><Play className="size-4" />{starting ? 'Starting…' : 'Start lesson'}</Button>
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-3">
          {[['Attendance', 'Mark all present, then edit only the exceptions.'], ['Paper activities', 'Use worksheets, oral questions, exit tickets and exercise books.'], ['Safe progress', 'Taught and observed never silently become mastered.']].map(([title, detail], index) => (
            <article key={title} className={`rounded-[14px] border border-white/70 p-4 shadow-sm backdrop-blur ${index === 0 ? 'bg-amber-50/90' : index === 1 ? 'bg-cyan-50/90' : 'bg-violet-50/90'}`}><div className="text-[13px] font-semibold text-[#111827]">{title}</div><div className="mt-1 text-[11px] leading-5 text-[#64748b]">{detail}</div></article>
          ))}
        </section>
        <section className="overflow-hidden rounded-[16px] border border-white/70 bg-white/80 shadow-sm backdrop-blur">
          <div className="border-b border-[#e2e8f0] px-5 py-4"><h2 className="text-[14px] font-semibold text-[#111827]">Recent lessons</h2><p className="mt-1 text-[11px] text-[#64748b]">Resume an active lesson or review what was recorded previously.</p></div>
          <div className="divide-y divide-[#e2e8f0]">{history.slice(0, 6).map((row: any) => <button type="button" key={row.public_ref} onClick={() => navigate(`/classroom/${row.public_ref}`)} className="grid w-full gap-2 px-5 py-3 text-left hover:bg-white sm:grid-cols-[1fr_1fr_auto]"><span className="text-[12px] font-semibold text-[#111827]">{row.class_name} · {row.subject_name}</span><span className="text-[11px] text-[#64748b]">{row.topic_name || 'Topic not recorded'} · {String(row.lesson_date || '').slice(0, 10)}</span><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6366f1]">{String(row.status || '').replaceAll('_', ' ')}</span></button>)}{!history.length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No Classroom Mode lessons have been recorded yet.</div> : null}</div>
        </section>
      </div>
    </div>
  )
}

export function ClassroomModePage() {
  const { sessionRef } = useParams()
  const { token, api } = usePortal()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [draft, setDraft] = useState<any>({})
  const [sync, setSync] = useState<'saved' | 'saving' | 'offline'>('saved')
  const [attendance, setAttendance] = useState<any[]>([])
  const [resourceNeed, setResourceNeed] = useState('')
  const saveTimer = useRef<any>(null)
  const ref = String(sessionRef || '')

  useEffect(() => {
    if (!ref) return
    api.getClassroomSession(token, ref).then((response: any) => {
      setData(response)
      setAttendance(response.attendance || [])
      const local = localStorage.getItem(`${DRAFT_KEY}${ref}`)
      const sessionDraft = { ...response.session, formative_summary: response.session.formative_summary || {}, objectives: (response.objectives || []).map((row: any) => ({ objective_ref: row.public_ref, achievement_status: row.achievement_status || 'not_assessed' })) }
      setDraft(local ? { ...sessionDraft, ...JSON.parse(local) } : sessionDraft)
    }).catch((error: any) => toast.error(error.message))
  }, [api, ref, token])

  useEffect(() => {
    if (!ref || !Object.keys(draft).length || data?.session?.status === 'completed') return
    localStorage.setItem(`${DRAFT_KEY}${ref}`, JSON.stringify(draft))
    setSync('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveClassroomSession(token, ref, { ...draft, offline_retry: true })
        setSync('saved')
      } catch {
        setSync('offline')
      }
    }, 900)
    return () => clearTimeout(saveTimer.current)
  }, [api, data?.session?.status, draft, ref, token])

  if (!sessionRef) return <Launcher />
  if (!data) return <div className="grid min-h-screen place-items-center bg-gradient-to-br from-indigo-100 via-white to-cyan-100 text-[13px] text-[#64748b]"><span><RefreshCw className="mx-auto mb-2 size-5 animate-spin" />Opening teaching canvas…</span></div>

  const saveAttendance = async () => {
    try {
      await api.saveClassroomAttendance(token, ref, { records: attendance.map((row) => ({ student_ref: row.student_ref, status: row.status, note: row.note })) })
      toast.success('Attendance saved.')
    } catch (error: any) { toast.error(error.message) }
  }
  const attach = async (resourceRef: string) => {
    try {
      setData(await api.attachClassroomResource(token, ref, { resource_ref: resourceRef }))
      toast.success('Resource attached to lesson log.')
    } catch (error: any) { toast.error(error.message) }
  }
  const requestPrint = async (resourceRef: string) => {
    try {
      await api.createPrintRequest(token, { resource_ref: resourceRef, copies: 1, class_ref: data.session.class_ref, notes: `Requested from Classroom Mode for ${data.session.class_name}.` })
      toast.success('Print request sent to the librarian.')
    } catch (error: any) { toast.error(error.message) }
  }
  const requestResource = async () => {
    if (!resourceNeed.trim()) return
    try {
      await api.createTeachingResourceRequest(token, { request_text: resourceNeed, class_ref: data.session.class_ref, subject_ref: data.session.subject_ref, topic_ref: data.session.topic_ref, priority: 'medium' })
      setResourceNeed('')
      toast.success('Resource request sent to the librarian.')
    } catch (error: any) { toast.error(error.message) }
  }
  const close = async () => {
    try {
      const response = await api.completeClassroomSession(token, ref, {
        ...draft,
        coverage_status: draft.coverage_status || 'partially_taught',
        coverage_percentage: Number(draft.coverage_percentage || 0),
        follow_up_required: draft.understanding_estimate === 'WEAK',
        follow_up_description: draft.understanding_estimate === 'WEAK' ? 'Review this topic before advancing.' : '',
      })
      localStorage.removeItem(`${DRAFT_KEY}${ref}`)
      setData(response)
      toast.success('Lesson closed and curriculum progress updated safely.')
    } catch (error: any) { toast.error(error.message) }
  }
  const statusIcon = sync === 'saved' ? <Cloud className="size-3.5" /> : sync === 'saving' ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudOff className="size-3.5" />
  const next = data.schedule?.next_period

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ddd6fe_0,transparent_30%),radial-gradient(circle_at_bottom_right,#a5f3fc_0,transparent_28%),linear-gradient(135deg,#eef2ff,#f8fafc_48%,#ecfeff)] p-3 md:p-5">
      <div className="mx-auto grid max-w-[1500px] gap-3">
        <header className="sticky top-3 z-20 overflow-hidden rounded-[16px] bg-gradient-to-r from-[#3730a3] via-[#6d28d9] to-[#0e7490] p-4 text-white shadow-[0_18px_50px_rgba(67,56,202,.25)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <button onClick={() => navigate('/dashboard')} className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/20">← Return to dashboard</button>
              <div className="h-7 w-px bg-white/20" />
              <div><div className="text-[18px] font-semibold tracking-[-0.035em]">{data.session.class_name} · {data.session.subject_name}</div><div className="mt-0.5 text-[11px] text-indigo-100">{data.session.topic_name || 'Select the lesson topic'} · started {periodTime(data.session.lesson_started_at)}</div></div>
            </div>
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="min-w-[190px] rounded-[12px] border border-white/20 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">Next period</div><div className="mt-1 truncate text-[13px] font-semibold">{next ? (next.subject_name || next.title || next.entry_type) : 'No later period'}</div><div className="mt-1 text-[11px] text-cyan-100">{next ? `${periodTime(next.start_time)} · ${next.class_name || 'School activity'}` : 'Today’s schedule is clear'}</div></div>
              <LessonCountdown session={data.session} />
              <div className={`flex items-center gap-1.5 rounded-[12px] border border-white/20 bg-white/10 px-3 text-[11px] font-medium ${sync === 'offline' ? 'text-amber-200' : 'text-indigo-100'}`}>{statusIcon}{sync === 'saved' ? 'Synced' : sync === 'saving' ? 'Saving' : 'Saved locally'}</div>
            </div>
          </div>
        </header>

        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-3">
            <SectionCard title="1. Fast attendance" subtitle="Mark all present, then edit exceptions in the existing attendance register." actions={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setAttendance(attendance.map((row) => ({ ...row, status: 'present' }))) }><Users className="size-4" />All present</Button><Button size="sm" onClick={saveAttendance}><Check className="size-4" />Save</Button></div>}>
              <div className="max-h-[320px] divide-y overflow-y-auto">{attendance.map((row, index) => <div key={row.student_ref} className="grid grid-cols-[1fr_130px] items-center gap-3 px-4 py-2"><span className="text-[12px] font-medium text-[#111827]">{row.first_name} {row.last_name}</span><Select value={row.status} onChange={(status) => setAttendance((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item))}>{['present', 'absent', 'late', 'sick', 'excused', 'left_early'].map((value) => <option key={value}>{value}</option>)}</Select></div>)}</div>
            </SectionCard>
            <SectionCard title="2. Topic and delivery" subtitle="Delivery status is separate from demonstrated mastery.">
              <div className="grid gap-3 p-4 sm:grid-cols-2"><label className="grid gap-1 text-[11px] font-semibold text-[#475569]">Coverage status<Select value={draft.coverage_status || 'introduced'} onChange={(coverage_status) => setDraft({ ...draft, coverage_status })}>{['introduced', 'partially_taught', 'fully_taught', 'revised', 'assessed', 'postponed'].map((value) => <option key={value}>{value.replaceAll('_', ' ')}</option>)}</Select></label><label className="grid gap-1 text-[11px] font-semibold text-[#475569]">Coverage estimate<Input type="number" min={0} max={100} value={draft.coverage_percentage || 0} onChange={(event) => setDraft({ ...draft, coverage_percentage: event.target.value })} /></label><label className="grid gap-1 text-[11px] font-semibold text-[#475569] sm:col-span-2">Lesson notes<textarea className="min-h-20 rounded-[6px] border border-[#d9dee7] bg-white p-3 text-[12px]" value={draft.lesson_notes || ''} onChange={(event) => setDraft({ ...draft, lesson_notes: event.target.value })} placeholder="Optional short teaching note" /></label></div>
            </SectionCard>
            <SectionCard title="3. Lesson objectives" subtitle="Record what was completed; this remains delivery evidence, not automatic mastery.">
              <div className="divide-y divide-[#e2e8f0]">{(data.objectives || []).map((row: any) => { const selected = (draft.objectives || []).find((item: any) => item.objective_ref === row.public_ref)?.achievement_status || 'not_assessed'; return <div key={row.public_ref} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_170px]"><span className="text-[12px] leading-5 text-[#334155]">{row.objective_text}</span><Select value={selected} onChange={(achievement_status) => setDraft({ ...draft, objectives: (draft.objectives || []).map((item: any) => item.objective_ref === row.public_ref ? { ...item, achievement_status } : item) })}>{['not_assessed', 'not_started', 'partially_achieved', 'achieved'].map((value) => <option key={value}>{value.replaceAll('_', ' ')}</option>)}</Select></div> })}{!(data.objectives || []).length ? <div className="p-5 text-center text-[12px] text-[#64748b]">Select a syllabus topic when starting the lesson to load its objectives.</div> : null}</div>
            </SectionCard>
            <SectionCard title="4. Approved teaching resources" subtitle="Restricted assessment files are not surfaced automatically.">
              <div className="divide-y divide-[#e2e8f0]">{(data.recommended_resources || []).map((row: any) => <div key={row.public_ref} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><div className="text-[12px] font-semibold text-[#111827]">{row.title}</div><div className="mt-1 text-[11px] text-[#64748b]">{row.resource_type} · {row.topic_name || 'School approved'}</div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => requestPrint(row.public_ref)}>Print request</Button><Button size="sm" variant="outline" onClick={() => attach(row.public_ref)}><BookOpenCheck className="size-4" />Attach</Button></div></div>)}{!(data.recommended_resources || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No approved resource matches this lesson yet.</div> : null}<div className="grid gap-2 bg-[#f8fafc] p-4 sm:grid-cols-[1fr_auto]"><Input value={resourceNeed} onChange={(event) => setResourceNeed(event.target.value)} placeholder="Ask the librarian for a resource you cannot find" /><Button variant="outline" disabled={!resourceNeed.trim()} onClick={requestResource}>Send resource request</Button></div></div>
            </SectionCard>
          </div>
          <div className="grid content-start gap-3">
            <SectionCard title="5. Teacher observation" subtitle="A low-weight observational signal, not proof of mastery."><div className="grid gap-3 p-4"><label className="grid gap-1 text-[11px] font-semibold text-[#475569]">How well did the class appear to understand?<Select value={draft.understanding_estimate || 'NOT_ASSESSED'} onChange={(understanding_estimate) => setDraft({ ...draft, understanding_estimate })}>{['STRONG', 'SATISFACTORY', 'MIXED', 'WEAK', 'NOT_ASSESSED'].map((value) => <option key={value}>{value.replaceAll('_', ' ')}</option>)}</Select></label><label className="grid gap-1 text-[11px] font-semibold text-[#475569]">Observation<textarea className="min-h-20 rounded-[6px] border border-[#d9dee7] bg-white p-3 text-[12px]" value={draft.observation_note || ''} onChange={(event) => setDraft({ ...draft, observation_note: event.target.value })} placeholder="Optional supporting note" /></label></div></SectionCard>
            <SectionCard title="6. Paper-based formative activity" subtitle="Students respond verbally, in exercise books or on paper."><div className="grid gap-3 p-4"><Select value={draft.formative_activity_type || 'none'} onChange={(formative_activity_type) => setDraft({ ...draft, formative_activity_type })}>{['none', 'oral_questions', 'written_class_exercise', 'exercise_book', 'printed_worksheet', 'exit_ticket', 'homework', 'board_work', 'paper_quiz'].map((value) => <option key={value}>{value.replaceAll('_', ' ')}</option>)}</Select>{draft.formative_activity_type === 'exit_ticket' ? <div className="grid gap-2 rounded-[8px] border border-cyan-200 bg-cyan-50 p-3"><Input value={draft.formative_summary?.exit_ticket_prompt || ''} onChange={(event) => setDraft({ ...draft, formative_summary: { ...(draft.formative_summary || {}), exit_ticket_prompt: event.target.value } })} placeholder="One short question students answer on paper" /><Input value={draft.formative_summary?.success_criteria || ''} onChange={(event) => setDraft({ ...draft, formative_summary: { ...(draft.formative_summary || {}), success_criteria: event.target.value } })} placeholder="What would show understanding?" /></div> : null}<label className="flex items-center gap-2 text-[12px] text-[#475569]"><input type="checkbox" checked={Boolean(draft.formal_check_used)} onChange={(event) => setDraft({ ...draft, formal_check_used: event.target.checked })} />A formal check was used</label></div></SectionCard>
            <SectionCard title="7. End lesson" subtitle="Closing updates delivery but never marks a topic mastered automatically."><div className="grid gap-3 p-4"><Input value={draft.homework_assigned || ''} onChange={(event) => setDraft({ ...draft, homework_assigned: event.target.value })} placeholder="Homework assigned (optional)" /><Input value={draft.next_lesson_action || ''} onChange={(event) => setDraft({ ...draft, next_lesson_action: event.target.value })} placeholder="Next lesson recommendation" /><Button disabled={data.session.status === 'completed'} onClick={close}><CheckCircle2 className="size-4" />{data.session.status === 'completed' ? 'Lesson completed' : 'Close lesson safely'}</Button></div></SectionCard>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, BookOpenCheck, CheckCircle2, Clock3, Gauge, Loader2, Play, RefreshCcw, Save, Search } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { usePortal } from '../lib/portalContext'

const draftKey = 'smartlink.schools.lessonLogDraft'

const coverageOptions = [
  ['introduced', 'Introduced'],
  ['partially_taught', 'Partially taught'],
  ['fully_taught', 'Fully taught'],
  ['revised', 'Revised'],
  ['assessed', 'Assessed'],
  ['postponed', 'Postponed'],
]

const outcomeOptions = [
  ['students_understood', 'Students understood'],
  ['mixed_understanding', 'Mixed understanding'],
  ['students_struggled', 'Students struggled'],
  ['not_assessed', 'Not assessed'],
]

const difficultyOptions = [
  ['none', 'None'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function statusLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusTone(value: any) {
  const status = String(value || '').toLowerCase()
  if (['finalized', 'fully_taught', 'assessed', 'revised', 'ready'].includes(status)) return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
  if (['draft', 'introduced', 'planned'].includes(status)) return 'border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]'
  if (['reopened', 'partially_taught', 'mixed_understanding', 'needs_questions', 'delayed'].includes(status)) return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  if (['cancelled', 'postponed', 'students_struggled'].includes(status)) return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
  return 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
}

function Chip({ value }: { value: any }) {
  return <span className={`inline-flex rounded-[4px] border px-2 py-1 text-[11px] font-bold ${statusTone(value)}`}>{statusLabel(value)}</span>
}

function selectClassName() {
  return 'h-9 rounded-[5px] border border-[#cbd5e1] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]'
}

function emptyForm() {
  return {
    lesson_date: todayIso(),
    class_id: '',
    subject_id: '',
    main_topic_id: '',
    subtopic_ids: [] as string[],
    objective_ids: [] as string[],
    coverage_status: 'introduced',
    coverage_percentage: 25,
    lesson_outcome: 'not_assessed',
    difficulty_observed: 'none',
    drill_priority_override: 'normal',
    lesson_notes: '',
    misconceptions_observed: '',
    homework_assigned: '',
    recommended_drill_focus: '',
    next_lesson_action: '',
  }
}

export function TeacherLessonLogPage() {
  const { lessonLogId, classId, subjectId } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const [form, setForm] = useState<any>(() => {
    try {
      return { ...emptyForm(), ...JSON.parse(window.localStorage.getItem(draftKey) || '{}') }
    } catch {
      return emptyForm()
    }
  })
  const [today, setToday] = useState<any>(null)
  const [suggestions, setSuggestions] = useState<any>(null)
  const [lessonLogs, setLessonLogs] = useState<any[]>([])
  const [coverage, setCoverage] = useState<any>(null)
  const [activeLog, setActiveLog] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [topicSearch, setTopicSearch] = useState('')

  const loadSuggestions = async (patch: any = {}) => {
    if (!token) return null
    const nextForm = { ...form, ...patch }
    const payload = await api.getLessonLogSuggestions(token, {
      lesson_date: nextForm.lesson_date,
      class_id: nextForm.class_id,
      subject_id: nextForm.subject_id,
    })
    setSuggestions(payload?.suggestions || null)
    const suggested = payload?.suggestions
    if (!nextForm.class_id && suggested?.class_id) nextForm.class_id = String(suggested.class_id)
    if (!nextForm.subject_id && suggested?.subject_id) nextForm.subject_id = String(suggested.subject_id)
    if (!nextForm.main_topic_id && suggested?.suggested?.main_topic_id) nextForm.main_topic_id = String(suggested.suggested.main_topic_id)
    if (suggested?.suggested?.coverage_status && !form.coverage_status) nextForm.coverage_status = suggested.suggested.coverage_status
    setForm(nextForm)
    return suggested
  }

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [todayPayload, logsPayload] = await Promise.all([
        api.getTeacherToday(token),
        api.listLessonLogs(token, { limit: 30 }),
      ])
      setToday(todayPayload)
      setLessonLogs(logsPayload?.lesson_logs || [])
      const routePatch = {
        ...(classId ? { class_id: String(classId) } : {}),
        ...(subjectId ? { subject_id: String(subjectId) } : {}),
      }
      if (classId || subjectId) setForm((current: any) => ({ ...current, ...routePatch }))
      const suggested = await loadSuggestions(routePatch)
      if (lessonLogId) {
        const payload = await api.getLessonLog(token, lessonLogId)
        const log = payload?.lesson_log
        setActiveLog(log)
        const logForm = {
          ...emptyForm(),
          lesson_date: String(log.lesson_date || todayIso()).slice(0, 10),
          class_id: String(log.class_id || ''),
          subject_id: String(log.subject_id || ''),
          main_topic_id: String(log.main_topic_id || ''),
          subtopic_ids: (log.topics || []).map((row: any) => row.syllabus_subtopic_id).filter(Boolean).map(String),
          objective_ids: (log.objectives || []).map((row: any) => String(row.learning_objective_id)),
          coverage_status: log.coverage_status || 'introduced',
          coverage_percentage: Number(log.coverage_percentage || 0),
          lesson_outcome: log.lesson_outcome || 'not_assessed',
          difficulty_observed: log.difficulty_observed || 'none',
          drill_priority_override: log.topics?.find((row: any) => row.topic_role === 'main')?.drill_priority_override || 'normal',
          lesson_notes: log.lesson_notes || '',
          misconceptions_observed: log.misconceptions_observed || '',
          homework_assigned: log.homework_assigned || '',
          recommended_drill_focus: log.recommended_drill_focus || '',
          next_lesson_action: log.next_lesson_action || '',
        }
        setForm(logForm)
        await loadSuggestions(logForm)
        await loadCoverage(log.class_id, log.subject_id)
      } else if (suggested?.class_id && suggested?.subject_id) {
        await loadCoverage(suggested.class_id, suggested.subject_id)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load lesson logs.')
    } finally {
      setLoading(false)
    }
  }

  const loadCoverage = async (classId = form.class_id, subjectId = form.subject_id) => {
    if (!token || !classId || !subjectId) return
    try {
      const payload = await api.getClassSubjectCoverage(token, classId, subjectId)
      setCoverage(payload?.coverage || null)
    } catch {
      setCoverage(null)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, lessonLogId, classId, subjectId])

  useEffect(() => {
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(form))
    } catch {
      // Draft autosave is best-effort browser storage.
    }
  }, [form])

  useEffect(() => {
    if (form.class_id && form.subject_id) loadCoverage(form.class_id, form.subject_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.class_id, form.subject_id])

  const assignments = suggestions?.assignments || []
  const topicRows = suggestions?.syllabus_topics || []
  const selectedTopic = topicRows.find((topic: any) => String(topic.id) === String(form.main_topic_id))
  const subtopics = topicRows.filter((topic: any) => String(topic.parent_topic_id || '') === String(form.main_topic_id || ''))
  const objectives = [
    ...(selectedTopic?.objectives || []),
    ...subtopics.filter((topic: any) => form.subtopic_ids.includes(String(topic.id))).flatMap((topic: any) => topic.objectives || []),
  ]

  const filteredTopics = useMemo(() => {
    const query = topicSearch.trim().toLowerCase()
    return topicRows
      .filter((topic: any) => !topic.parent_topic_id)
      .filter((topic: any) => !query || `${topic.topic_name} ${topic.description || ''}`.toLowerCase().includes(query))
      .slice(0, 80)
  }, [topicRows, topicSearch])

  const setField = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }))

  const chooseAssignment = async (assignmentKey: string) => {
    const [classId, subjectId] = assignmentKey.split(':')
    const patch = { class_id: classId, subject_id: subjectId, main_topic_id: '', subtopic_ids: [], objective_ids: [] }
    setForm((current: any) => ({ ...current, ...patch }))
    try {
      await loadSuggestions(patch)
      await loadCoverage(classId, subjectId)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load suggestions for this class.')
    }
  }

  const save = async (mode: 'draft' | 'finalize' | 'generate') => {
    if (!token) return
    if (!form.class_id || !form.subject_id) {
      toast.error('Select a class and subject.')
      return
    }
    if (form.coverage_status !== 'postponed' && !form.main_topic_id) {
      toast.error('Select the approved syllabus topic taught.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        ...form,
        main_topic_id: form.main_topic_id || null,
        subtopic_ids: form.subtopic_ids,
        objective_ids: form.objective_ids,
        topics: [
          ...(form.main_topic_id ? [{
            syllabus_topic_id: form.main_topic_id,
            topic_role: 'main',
            coverage_percentage: form.coverage_percentage,
            difficulty_observed: form.difficulty_observed,
            drill_priority_override: form.drill_priority_override,
          }] : []),
          ...form.subtopic_ids.map((id: any) => ({
            syllabus_topic_id: form.main_topic_id || id,
            syllabus_subtopic_id: id,
            topic_role: 'supporting',
            coverage_percentage: form.coverage_percentage,
            difficulty_observed: form.difficulty_observed,
            drill_priority_override: 'normal',
          })),
        ],
        objectives: form.objective_ids.map((id: any) => ({ learning_objective_id: id, achievement_status: 'not_assessed' })),
      }
      const saved = activeLog?.id
        ? await api.updateLessonLog(token, activeLog.id, payload)
        : await api.createLessonLog(token, payload)
      let log = saved?.lesson_log
      if (mode === 'finalize' || mode === 'generate') {
        const finalized = await api.finalizeLessonLog(token, log.id)
        log = finalized?.lesson_log
        toast.success('Lesson log finalized.')
      } else {
        toast.success('Draft lesson log saved.')
      }
      if (mode === 'generate') {
        const result = await api.generateClassDrills(token, form.class_id, { subject_id: form.subject_id })
        toast.success(`${result.generated || 0} drills generated, ${result.insufficient_questions || 0} need more approved questions.`)
      }
      setActiveLog(log)
      try {
        window.localStorage.removeItem(draftKey)
      } catch {
        // Local autosave cleanup is best effort.
      }
      navigate(`/teacher/lesson-log/${log.id}`, { replace: true })
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save lesson log.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[70vh] place-items-center bg-[#f6f7f4]">
        <SmartLinkLoadingState variant="inline" label="Loading lesson log workspace" detail="Preparing classes, subjects and recent coverage." />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f6f7f4] text-[#111827]">
      <div className="mx-auto grid w-full max-w-[1360px] gap-4 px-4 py-5 lg:px-6">
        <section className="rounded-[8px] border border-[#d7dde5] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em]">
                <BookOpenCheck className="size-5" />
                Log what I taught today
              </div>
              <p className="mt-1 text-[12px] font-medium text-[#64748b]">
                Drafts stay private to teachers. Only finalized logs feed Daily Drills.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={load} disabled={busy}>
                <RefreshCcw className="size-3.5" />
                Refresh
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/teacher/lesson-log/new')}>
                New log
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {[
              ['Scheduled', today?.summary?.scheduled || 0, Clock3],
              ['Logged', today?.summary?.logged || 0, CheckCircle2],
              ['Missing', today?.summary?.missing || 0, AlertCircle],
              ['Drafts', today?.summary?.drafts || 0, Save],
              ['Drills today', today?.summary?.drills_generated || 0, Play],
            ].map(([label, value, Icon]: any) => (
              <div key={label} className="rounded-[6px] border border-[#e2e8f0] bg-[#fbfcf8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase text-[#64748b]">{label}</span>
                  <Icon className="size-4 text-[#64748b]" />
                </div>
                <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">{value}</div>
              </div>
            ))}
          </div>
        </section>

        {today?.reminders?.length ? (
          <div className="rounded-[8px] border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-[12px] font-semibold leading-5 text-[#9a3412]">
            {today.reminders.join(' ')}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="grid gap-4">
            <section className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
              <div className="border-b border-[#e2e8f0] px-4 py-3">
                <div className="text-[14px] font-semibold">Quick Log</div>
                <div className="text-[11px] font-medium text-[#64748b]">{suggestions?.suggested?.message || 'Confirm the class, subject and topic taught.'}</div>
              </div>
              <div className="grid gap-4 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Lesson date
                    <Input type="date" className="h-9 text-[12px]" value={form.lesson_date} onChange={(event) => setField('lesson_date', event.target.value)} />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Class and subject
                    <select className={selectClassName()} value={`${form.class_id}:${form.subject_id}`} onChange={(event) => chooseAssignment(event.target.value)}>
                      <option value=":">Select class and subject</option>
                      {assignments.map((item: any) => (
                        <option key={`${item.class_id}:${item.subject_id}`} value={`${item.class_id}:${item.subject_id}`}>
                          {item.class_name} / {item.subject_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Drill priority
                    <select className={selectClassName()} value={form.drill_priority_override} onChange={(event) => setField('drill_priority_override', event.target.value)}>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="rounded-[6px] border border-[#e2e8f0] bg-[#fbfcf8] p-3">
                    <div className="flex items-center gap-2">
                      <Search className="size-4 text-[#64748b]" />
                      <Input className="h-8 text-[12px]" placeholder="Search approved syllabus topics" value={topicSearch} onChange={(event) => setTopicSearch(event.target.value)} />
                    </div>
                    <div className="mt-3 max-h-[360px] overflow-y-auto pr-1 [scrollbar-width:thin]">
                      {filteredTopics.length ? filteredTopics.map((topic: any) => {
                        const active = String(topic.id) === String(form.main_topic_id)
                        return (
                          <button
                            key={topic.id}
                            type="button"
                            className={`mb-1 w-full rounded-[5px] border px-3 py-2 text-left text-[12px] transition ${active ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#e2e8f0] bg-white text-[#111827] hover:border-[#94a3b8]'}`}
                            onClick={() => setForm((current: any) => ({ ...current, main_topic_id: String(topic.id), subtopic_ids: [], objective_ids: [] }))}
                          >
                            <span className="block font-semibold">{topic.topic_name}</span>
                            {topic.description ? <span className={`mt-0.5 block text-[11px] ${active ? 'text-white/70' : 'text-[#64748b]'}`}>{topic.description}</span> : null}
                          </button>
                        )
                      }) : (
                        <div className="rounded-[6px] border border-dashed border-[#cbd5e1] bg-white p-4 text-[12px] font-medium text-[#64748b]">
                          No approved topics found for this class and subject.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                      <div className="mb-2 text-[11px] font-bold uppercase text-[#64748b]">Selected topic</div>
                      {selectedTopic ? (
                        <div>
                          <div className="text-[14px] font-semibold">{selectedTopic.topic_name}</div>
                          {selectedTopic.description ? <div className="mt-1 text-[12px] leading-5 text-[#64748b]">{selectedTopic.description}</div> : null}
                        </div>
                      ) : (
                        <div className="text-[12px] font-medium text-[#64748b]">Select the approved syllabus topic taught.</div>
                      )}
                    </div>

                    <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                      <div className="mb-2 text-[11px] font-bold uppercase text-[#64748b]">Subtopics taught</div>
                      {subtopics.length ? (
                        <div className="grid gap-1.5">
                          {subtopics.map((topic: any) => (
                            <label key={topic.id} className="flex items-start gap-2 rounded-[5px] border border-[#e2e8f0] px-3 py-2 text-[12px] font-medium">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={form.subtopic_ids.includes(String(topic.id))}
                                onChange={(event) => {
                                  setForm((current: any) => ({
                                    ...current,
                                    subtopic_ids: event.target.checked
                                      ? [...current.subtopic_ids, String(topic.id)]
                                      : current.subtopic_ids.filter((id: string) => id !== String(topic.id)),
                                  }))
                                }}
                              />
                              <span>{topic.topic_name}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[12px] font-medium text-[#64748b]">No subtopics are mapped under this topic yet.</div>
                      )}
                    </div>

                    <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                      <div className="mb-2 text-[11px] font-bold uppercase text-[#64748b]">Learning objectives</div>
                      {objectives.length ? (
                        <div className="grid gap-1.5">
                          {objectives.map((objective: any) => (
                            <label key={objective.id} className="flex items-start gap-2 rounded-[5px] border border-[#e2e8f0] px-3 py-2 text-[12px]">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={form.objective_ids.includes(String(objective.id))}
                                onChange={(event) => setForm((current: any) => ({
                                  ...current,
                                  objective_ids: event.target.checked
                                    ? [...current.objective_ids, String(objective.id)]
                                    : current.objective_ids.filter((id: string) => id !== String(objective.id)),
                                }))}
                              />
                              <span>{objective.objective_text}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[12px] font-medium text-[#64748b]">Objectives are optional for this quick log.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Coverage
                    <select className={selectClassName()} value={form.coverage_status} onChange={(event) => setField('coverage_status', event.target.value)}>
                      {coverageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Percentage
                    <Input type="number" min={0} max={100} className="h-9 text-[12px]" value={form.coverage_percentage} onChange={(event) => setField('coverage_percentage', Number(event.target.value))} />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Outcome
                    <select className={selectClassName()} value={form.lesson_outcome} onChange={(event) => setField('lesson_outcome', event.target.value)}>
                      {outcomeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                    Difficulty
                    <select className={selectClassName()} value={form.difficulty_observed} onChange={(event) => setField('difficulty_observed', event.target.value)}>
                      {difficultyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ['lesson_notes', 'Lesson notes'],
                    ['misconceptions_observed', 'Misconceptions observed'],
                    ['homework_assigned', 'Homework assigned'],
                    ['recommended_drill_focus', 'Recommended drill focus'],
                    ['next_lesson_action', 'Next lesson action'],
                  ].map(([key, label]) => (
                    <label key={key} className="grid gap-1.5 text-[11px] font-bold uppercase text-[#64748b]">
                      {label}
                      <textarea
                        className="min-h-20 rounded-[6px] border border-[#cbd5e1] bg-white px-3 py-2 text-[12px] font-medium leading-5 text-[#111827] outline-none focus:border-[#111827]"
                        value={form[key] || ''}
                        onChange={(event) => setField(key, event.target.value)}
                      />
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[#e2e8f0] pt-4">
                  <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" disabled={busy} onClick={() => save('draft')}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Save draft
                  </Button>
                  <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" disabled={busy} onClick={() => save('generate')}>
                    <Play className="size-3.5" />
                    Save and generate drills
                  </Button>
                  <Button type="button" className="h-9 rounded-[5px] text-[12px]" disabled={busy} onClick={() => save('finalize')}>
                    <CheckCircle2 className="size-3.5" />
                    Finalize lesson log
                  </Button>
                </div>
              </div>
            </section>
          </main>

          <aside className="grid content-start gap-4">
            <section className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
              <div className="border-b border-[#e2e8f0] px-4 py-3 text-[13px] font-semibold">Today’s assigned lessons</div>
              <div className="grid gap-2 p-3">
                {today?.scheduled_lessons?.length ? today.scheduled_lessons.map((lesson: any) => (
                  <button
                    key={`${lesson.class_id}:${lesson.subject_id}`}
                    type="button"
                    className="rounded-[6px] border border-[#e2e8f0] bg-[#fbfcf8] p-3 text-left hover:border-[#94a3b8]"
                    onClick={() => chooseAssignment(`${lesson.class_id}:${lesson.subject_id}`)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-semibold">{lesson.class_name}</div>
                      <Chip value={lesson.log_status} />
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-[#64748b]">{lesson.subject_name}</div>
                  </button>
                )) : (
                  <div className="rounded-[6px] border border-dashed border-[#cbd5e1] p-4 text-[12px] font-medium text-[#64748b]">No assigned lesson was found for today.</div>
                )}
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
                <div className="text-[13px] font-semibold">Coverage</div>
                <Gauge className="size-4 text-[#64748b]" />
              </div>
              <div className="grid gap-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[6px] border border-[#e2e8f0] bg-[#fbfcf8] p-3">
                    <div className="text-[18px] font-semibold">{coverage?.summary?.term_syllabus_covered_percentage || 0}%</div>
                    <div className="text-[11px] font-medium text-[#64748b]">Planned covered</div>
                  </div>
                  <div className="rounded-[6px] border border-[#e2e8f0] bg-[#fbfcf8] p-3">
                    <div className="text-[18px] font-semibold">{coverage?.summary?.finalized_lessons || 0}</div>
                    <div className="text-[11px] font-medium text-[#64748b]">Finalized logs</div>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto [scrollbar-width:thin]">
                  {coverage?.timeline?.length ? coverage.timeline.slice(0, 8).map((row: any) => (
                    <div key={row.plan_id} className="mb-2 rounded-[6px] border border-[#e2e8f0] p-3">
                      <div className="text-[12px] font-semibold">{row.topic_name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip value={row.actual_coverage_status} />
                        <span className="text-[11px] font-medium text-[#64748b]">{row.actual_coverage_percentage || 0}%</span>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[6px] border border-dashed border-[#cbd5e1] p-4 text-[12px] font-medium text-[#64748b]">Select a class and subject to see planned-versus-actual coverage.</div>
                  )}
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="rounded-[8px] border border-[#d7dde5] bg-white shadow-sm">
          <div className="border-b border-[#e2e8f0] px-4 py-3 text-[13px] font-semibold">Recent lesson logs</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="bg-[#f8fafc] text-[11px] uppercase text-[#64748b]">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Class</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">Topic</th>
                  <th className="px-4 py-2">Coverage</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {lessonLogs.length ? lessonLogs.map((log) => (
                  <tr key={log.id} className="border-t border-[#e2e8f0]">
                    <td className="px-4 py-2 font-medium">{String(log.lesson_date || '').slice(0, 10)}</td>
                    <td className="px-4 py-2">{log.class_name}</td>
                    <td className="px-4 py-2">{log.subject_name}</td>
                    <td className="max-w-[280px] truncate px-4 py-2">{log.main_topic_name || '-'}</td>
                    <td className="px-4 py-2"><Chip value={log.coverage_status} /></td>
                    <td className="px-4 py-2"><Chip value={log.status} /></td>
                    <td className="px-4 py-2 text-right">
                      <Button type="button" variant="outline" className="h-7 rounded-[5px] text-[11px]" onClick={() => navigate(`/teacher/lesson-log/${log.id}`)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[12px] font-medium text-[#64748b]">No lesson logs yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

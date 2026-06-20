import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarDays, CalendarRange, CheckCircle2, Clock, FileText, LayoutGrid, List, Plus, RotateCcw, Save, Search, SlidersHorizontal, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { Toolbar } from '../components/Toolbar'
import { usePortal } from '../lib/portalContext'

const eventTypes = [
  ['school_event', 'School Event'],
  ['academic_deadline', 'Academic Deadline'],
  ['holiday', 'Holiday'],
  ['closure', 'Closure'],
  ['meeting', 'Meeting'],
  ['sports', 'Sports'],
  ['exam_session', 'Exam Session'],
  ['exam_paper', 'Exam Paper'],
  ['recurring_assessment', 'Recurring Assessment'],
  ['weekly_test', 'Weekly Test'],
  ['revision_week', 'Revision Week'],
  ['exam_week', 'Exam Week'],
  ['marking_week', 'Marking Week'],
  ['term_closing_week', 'Term Closing Week'],
  ['custom', 'Custom'],
]

const assessmentTypes = [
  ['weekly_spelling_test', 'Weekly Spelling Test'],
  ['weekly_test', 'Weekly Test'],
  ['quiz', 'Quiz'],
  ['reading_check', 'Reading Check'],
  ['mental_maths', 'Mental Maths'],
  ['vocabulary_test', 'Vocabulary Test'],
  ['custom', 'Custom'],
]

const dayOptions = [
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
  ['0', 'Sunday'],
]

const emptyEventForm = {
  title: '',
  event_type: 'school_event',
  date: '',
  start_time: '08:00',
  end_time: '',
  all_day: true,
  class_id: '',
  subject_id: '',
  teacher_id: '',
  visibility: 'whole_school',
  description: '',
}

const emptyRecurringForm = {
  title: 'Weekly Spelling Test',
  assessment_type: 'weekly_spelling_test',
  class_id: '',
  subject_id: '',
  teacher_id: '',
  total_marks: '20',
  frequency: 'weekly',
  day_of_week: '5',
  start_date: '',
  end_date: '',
  default_start_time: '08:00',
  default_duration_minutes: '30',
  description: '',
}

function labelize(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function dateKey(value: any) {
  return String(value || '').slice(0, 10)
}

function displayDate(value: any) {
  const key = dateKey(value)
  if (!key) return '-'
  const date = new Date(`${key}T00:00:00`)
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function displayTime(value: any) {
  const text = String(value || '')
  const time = text.includes(' ') ? text.split(' ')[1] : text
  return time ? time.slice(0, 5) : ''
}

function orderedDateRange(startValue: any, endValue: any) {
  const start = dateKey(startValue)
  const end = dateKey(endValue || startValue)
  if (!start || !end) return { start, end }
  return start <= end ? { start, end } : { start: end, end: start }
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
      {label}
      {children}
    </label>
  )
}

function TypePill({ type }: { type: string }) {
  const palette: Record<string, string> = {
    exam_week: 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]',
    exam_session: 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]',
    exam_paper: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    weekly_test: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#047857]',
    recurring_assessment: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#047857]',
    closure: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]',
    holiday: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]',
  }
  return <span className={`inline-flex h-5 items-center rounded-[4px] border px-2 text-[10px] font-bold ${palette[type] || 'border-[#e2e8f0] bg-[#f8fafc] text-[#4b5563]'}`}>{labelize(type)}</span>
}

function buildMonthDays(anchorValue: string) {
  const anchor = anchorValue ? new Date(`${anchorValue}T00:00:00`) : new Date()
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      key: date.toISOString().slice(0, 10),
      day: date.getDate(),
      muted: date.getMonth() !== anchor.getMonth(),
    }
  })
}

function weekDays(anchorValue: string) {
  const anchor = anchorValue ? new Date(`${anchorValue}T00:00:00`) : new Date()
  const offset = (anchor.getDay() + 6) % 7
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - offset)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString(undefined, { weekday: 'short' }), day: date.getDate() }
  })
}

export function SchoolCalendarPage() {
  const navigate = useNavigate()
  const { token, api, user } = usePortal()
  const role = String(user?.role || '').toLowerCase()
  const canManageSchool = ['school_owner', 'headteacher', 'super_admin'].includes(role)
  const [payload, setPayload] = useState<any>({ events: [], timeline: [], setup: {}, summary: {}, term: null, templates: [] })
  const [filters, setFilters] = useState<any>({ q: '', event_type: '', class_id: '', subject_id: '', teacher_id: '', academic_year_id: '', term_id: '', include_archived: false })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [view, setView] = useState<'month' | 'week' | 'list' | 'timeline'>('month')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [eventForm, setEventForm] = useState<any>(emptyEventForm)
  const [recurringForm, setRecurringForm] = useState<any>(emptyRecurringForm)
  const [marksSheet, setMarksSheet] = useState<any>(null)
  const [marksRows, setMarksRows] = useState<any[]>([])
  const [wordText, setWordText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async (nextFilters = filters) => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const data = await api.getSchoolCalendar(token, nextFilters)
      setPayload(data || {})
      const range = orderedDateRange(data?.term?.start_date, data?.term?.end_date)
      const termStart = range.start
      if (!selectedDate && termStart) setSelectedDate(termStart)
      if (termStart) {
        setEventForm((current: any) => ({ ...current, date: current.date || termStart }))
        setRecurringForm((current: any) => ({ ...current, start_date: current.start_date || termStart, end_date: current.end_date || range.end }))
      }
    } catch (err: any) {
      const message = err?.message || 'Unable to load school calendar.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const events = payload.events || []
  const setup = payload.setup || {}
  const summary = payload.summary || {}
  const term = payload.term || {}
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    events.forEach((event: any) => {
      const key = dateKey(event.start_datetime)
      if (!key) return
      map[key] = [...(map[key] || []), event]
    })
    return map
  }, [events])
  const monthDays = useMemo(() => buildMonthDays(selectedDate || dateKey(term.start_date)), [selectedDate, term.start_date])
  const currentWeekDays = useMemo(() => weekDays(selectedDate || dateKey(term.start_date)), [selectedDate, term.start_date])

  const updateFilter = (key: string, value: any) => {
    setFilters((current: any) => ({ ...current, [key]: value }))
  }

  const resetFilters = () => {
    const next = { q: '', event_type: '', class_id: '', subject_id: '', teacher_id: '', academic_year_id: '', term_id: '', include_archived: false }
    setFilters(next)
    load(next)
  }

  const createEvent = async () => {
    if (!token) return
    setSaving(true)
    try {
      await api.createSchoolCalendarEvent(token, eventForm)
      toast.success('Calendar event created.')
      setEventForm({ ...emptyEventForm, date: dateKey(term.start_date) })
      setShowEventForm(false)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to create event.')
    } finally {
      setSaving(false)
    }
  }

  const createRecurring = async () => {
    if (!token) return
    setSaving(true)
    try {
      const result = await api.createRecurringAssessmentTemplate(token, recurringForm)
      toast.success(`Recurring assessment created. ${result?.generated_instances || 0} instances generated.`)
      const range = orderedDateRange(term.start_date, term.end_date)
      setRecurringForm({ ...emptyRecurringForm, start_date: range.start, end_date: range.end })
      setShowRecurringForm(false)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to create recurring assessment.')
    } finally {
      setSaving(false)
    }
  }

  const openMarksSheet = async (event: any) => {
    if (!token) return
    setSelectedEvent(event)
    setSaving(true)
    try {
      const data = await api.getAssessmentInstance(token, event.source_id)
      setMarksSheet(data)
      setMarksRows((data.students || []).map((row: any) => ({ ...row, score: row.score ?? '', comment: row.comment || '' })))
      setWordText((data.items || []).map((item: any) => item.item_text).join('\n'))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to open marks sheet.')
    } finally {
      setSaving(false)
    }
  }

  const saveMarks = async (status = 'draft') => {
    if (!token || !marksSheet?.instance) return
    setSaving(true)
    try {
      const items = wordText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((item_text, index) => ({ item_text, item_type: 'word', sort_order: index + 1 }))
      const result = await api.saveAssessmentInstanceResults(token, marksSheet.instance.id, { status, items, results: marksRows })
      setMarksSheet(result)
      setMarksRows((result.students || []).map((row: any) => ({ ...row, score: row.score ?? '', comment: row.comment || '' })))
      toast.success(status === 'completed' ? 'Assessment results completed.' : 'Assessment results saved as draft.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save marks.')
    } finally {
      setSaving(false)
    }
  }

  const renderCompactEvent = (event: any) => (
    <button
      key={event.id}
      type="button"
      className="grid w-full gap-1 rounded-[4px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-left transition hover:border-[#111827]/30"
      onClick={() => setSelectedEvent(event)}
    >
      <div className="truncate text-[11px] font-bold text-[#111827]">{event.title}</div>
      <div className="flex items-center justify-between gap-2">
        <TypePill type={event.type} />
        <span className="text-[10px] font-semibold text-[#6b7280]">{displayTime(event.start_datetime)}</span>
      </div>
    </button>
  )

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">School Calendar</h1>
            <p className="mt-1 text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">
              {term?.academic_year_name || payload.session?.academic_year?.name || 'Academic year'} - {term?.name || payload.session?.term?.name || 'Current term'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setShowRecurringForm((open) => !open)}>
              <CalendarRange className="size-3.5" />
              Recurring Assessment
            </Button>
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => setShowEventForm((open) => !open)}>
              <Plus className="size-3.5" />
              Event
            </Button>
          </div>
        </div>
      </section>

      {error || payload.setup_required ? (
        <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">
          {error || payload.message || 'No active academic term found. Open a term to use the calendar.'}
        </div>
      ) : null}

      <SectionKpiStrip items={[
        { label: 'Current Term', value: term?.name || '-', helper: term?.academic_year_name || 'academic year', delta: labelize(term?.status) },
        { label: 'Current Week', value: summary.current_week ? `Week ${summary.current_week}` : '-', helper: summary.total_weeks ? `of ${summary.total_weeks}` : 'term weeks', delta: `${summary.progress_percent || 0}% complete` },
        { label: 'This Week', value: `${summary.this_week_assessments || 0}`, helper: 'assessments', delta: `${summary.this_week_events || 0} events` },
        { label: 'Exam Week', value: summary.exam_start_date ? displayDate(summary.exam_start_date) : '-', helper: 'starts', delta: summary.exam_starts_in_days === null || summary.exam_starts_in_days === undefined ? 'not configured' : `${summary.exam_starts_in_days} days` },
      ]} />

      <Toolbar>
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
          <Input value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} className="h-8 pl-9 text-[12px]" placeholder="Search calendar..." />
        </div>
        <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal className="size-3.5" />
          Filters
        </Button>
        <div className="flex rounded-[5px] border border-[#d9dce3] bg-white p-0.5">
          {[
            ['month', LayoutGrid],
            ['week', CalendarDays],
            ['list', List],
            ['timeline', Clock],
          ].map(([id, Icon]: any) => (
            <button
              key={id}
              type="button"
              className={`grid size-7 place-items-center rounded-[4px] ${view === id ? 'bg-[#111827] text-white' : 'text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]'}`}
              onClick={() => setView(id)}
              aria-label={`${id} view`}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </Toolbar>

      {filtersOpen ? (
        <section className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3 md:grid-cols-3 xl:grid-cols-7">
          <select className={selectClassName()} value={filters.event_type} onChange={(event) => updateFilter('event_type', event.target.value)}>
            <option value="">All types</option>
            {eventTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className={selectClassName()} value={filters.class_id} onChange={(event) => updateFilter('class_id', event.target.value)}>
            <option value="">All classes</option>
            {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className={selectClassName()} value={filters.subject_id} onChange={(event) => updateFilter('subject_id', event.target.value)}>
            <option value="">All subjects</option>
            {(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          {canManageSchool ? (
            <select className={selectClassName()} value={filters.teacher_id} onChange={(event) => updateFilter('teacher_id', event.target.value)}>
              <option value="">All teachers</option>
              {(setup.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
            </select>
          ) : null}
          <select className={selectClassName()} value={filters.academic_year_id} onChange={(event) => updateFilter('academic_year_id', event.target.value)}>
            <option value="">Active year</option>
            {(setup.years || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className={selectClassName()} value={filters.term_id} onChange={(event) => updateFilter('term_id', event.target.value)}>
            <option value="">Active term</option>
            {(setup.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.academic_year_name} - {row.name}</option>)}
          </select>
          <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
            <input type="checkbox" checked={filters.include_archived} onChange={(event) => updateFilter('include_archived', event.target.checked)} />
            Archived
          </label>
          <div className="flex gap-2 md:col-span-3 xl:col-span-7">
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => load()}>Apply Filters</Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={resetFilters}><RotateCcw className="size-3.5" /> Reset</Button>
          </div>
        </section>
      ) : null}

      {showEventForm ? (
        <SectionCard title="Create School Event" subtitle="School-wide, staff, class or teacher-specific calendar item">
          <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Title"><Input className="h-8 text-[12px]" value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} /></Field>
            <Field label="Type"><select className={selectClassName()} value={eventForm.event_type} onChange={(event) => setEventForm({ ...eventForm, event_type: event.target.value })}>{eventTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Date"><Input type="date" className="h-8 text-[12px]" value={eventForm.date} onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })} /></Field>
            <Field label="Start"><Input type="time" className="h-8 text-[12px]" value={eventForm.start_time} onChange={(event) => setEventForm({ ...eventForm, start_time: event.target.value })} /></Field>
            <Field label="End"><Input type="time" className="h-8 text-[12px]" value={eventForm.end_time} onChange={(event) => setEventForm({ ...eventForm, end_time: event.target.value })} /></Field>
            <Field label="Visibility"><select className={selectClassName()} value={eventForm.visibility} onChange={(event) => setEventForm({ ...eventForm, visibility: event.target.value })}><option value="whole_school">Whole School</option><option value="teachers_only">Teachers Only</option><option value="staff_only">Staff Only</option><option value="class_only">Class Only</option><option value="students">Students</option><option value="parents">Parents</option></select></Field>
            <Field label="Class"><select className={selectClassName()} value={eventForm.class_id} onChange={(event) => setEventForm({ ...eventForm, class_id: event.target.value })}><option value="">School-wide</option>{(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Subject"><select className={selectClassName()} value={eventForm.subject_id} onChange={(event) => setEventForm({ ...eventForm, subject_id: event.target.value })}><option value="">None</option>{(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            {canManageSchool ? <Field label="Teacher"><select className={selectClassName()} value={eventForm.teacher_id} onChange={(event) => setEventForm({ ...eventForm, teacher_id: event.target.value })}><option value="">None</option>{(setup.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}</select></Field> : null}
            <label className="flex h-8 items-center gap-2 self-end text-[12px] font-semibold text-[#374151]"><input type="checkbox" checked={eventForm.all_day} onChange={(event) => setEventForm({ ...eventForm, all_day: event.target.checked })} /> All day</label>
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] md:col-span-3 xl:col-span-6">
              Description
              <Textarea className="min-h-20 text-[12px]" value={eventForm.description} onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })} />
            </label>
            <div className="flex gap-2 md:col-span-3 xl:col-span-6">
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={saving || !eventForm.title || !eventForm.date} onClick={createEvent}><Save className="size-3.5" /> Save Event</Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setShowEventForm(false)}>Cancel</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {showRecurringForm ? (
        <SectionCard title="Create Recurring Assessment" subtitle="Weekly spelling tests, mental maths, Friday quizzes and drills">
          <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Title"><Input className="h-8 text-[12px]" value={recurringForm.title} onChange={(event) => setRecurringForm({ ...recurringForm, title: event.target.value })} /></Field>
            <Field label="Type"><select className={selectClassName()} value={recurringForm.assessment_type} onChange={(event) => setRecurringForm({ ...recurringForm, assessment_type: event.target.value })}>{assessmentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Class"><select className={selectClassName()} value={recurringForm.class_id} onChange={(event) => setRecurringForm({ ...recurringForm, class_id: event.target.value })}><option value="">Select class</option>{(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Subject"><select className={selectClassName()} value={recurringForm.subject_id} onChange={(event) => setRecurringForm({ ...recurringForm, subject_id: event.target.value })}><option value="">Select subject</option>{(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            {canManageSchool ? <Field label="Teacher"><select className={selectClassName()} value={recurringForm.teacher_id} onChange={(event) => setRecurringForm({ ...recurringForm, teacher_id: event.target.value })}><option value="">Assigned subject teacher</option>{(setup.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}</select></Field> : null}
            <Field label="Marks"><Input type="number" className="h-8 text-[12px]" value={recurringForm.total_marks} onChange={(event) => setRecurringForm({ ...recurringForm, total_marks: event.target.value })} /></Field>
            <Field label="Frequency"><select className={selectClassName()} value={recurringForm.frequency} onChange={(event) => setRecurringForm({ ...recurringForm, frequency: event.target.value })}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></Field>
            <Field label="Day"><select className={selectClassName()} value={recurringForm.day_of_week} onChange={(event) => setRecurringForm({ ...recurringForm, day_of_week: event.target.value })}>{dayOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Start Date"><Input type="date" className="h-8 text-[12px]" value={recurringForm.start_date} onChange={(event) => setRecurringForm({ ...recurringForm, start_date: event.target.value })} /></Field>
            <Field label="End Date"><Input type="date" className="h-8 text-[12px]" value={recurringForm.end_date} onChange={(event) => setRecurringForm({ ...recurringForm, end_date: event.target.value })} /></Field>
            <Field label="Time"><Input type="time" className="h-8 text-[12px]" value={recurringForm.default_start_time} onChange={(event) => setRecurringForm({ ...recurringForm, default_start_time: event.target.value })} /></Field>
            <Field label="Minutes"><Input type="number" className="h-8 text-[12px]" value={recurringForm.default_duration_minutes} onChange={(event) => setRecurringForm({ ...recurringForm, default_duration_minutes: event.target.value })} /></Field>
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] md:col-span-3 xl:col-span-6">
              Description
              <Textarea className="min-h-16 text-[12px]" value={recurringForm.description} onChange={(event) => setRecurringForm({ ...recurringForm, description: event.target.value })} />
            </label>
            <div className="flex gap-2 md:col-span-3 xl:col-span-6">
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={saving || !recurringForm.title || !recurringForm.class_id || !recurringForm.subject_id} onClick={createRecurring}><Save className="size-3.5" /> Save Recurrence</Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setShowRecurringForm(false)}>Cancel</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title={view === 'timeline' ? 'Term Timeline' : view === 'list' ? 'Calendar List' : view === 'week' ? 'Week View' : 'Month View'} subtitle={loading ? 'Loading calendar...' : `${events.length} visible items`}>
          <div className="p-4">
            {view === 'month' ? (
              <div className="grid grid-cols-7 overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="border-b border-[#e2e8f0] bg-[#f8fafc] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">{day}</div>)}
                {monthDays.map((day) => (
                  <button key={day.key} type="button" className={`min-h-[118px] border-b border-r border-[#e2e8f0] p-2 text-left ${day.muted ? 'bg-[#f8fafc] text-[#9ca3af]' : 'bg-white text-[#111827]'} ${selectedDate === day.key ? 'ring-2 ring-inset ring-[#111827]' : ''}`} onClick={() => setSelectedDate(day.key)}>
                    <div className="text-[12px] font-bold">{day.day}</div>
                    <div className="mt-2 grid gap-1">{(eventsByDate[day.key] || []).slice(0, 3).map(renderCompactEvent)}</div>
                    {(eventsByDate[day.key] || []).length > 3 ? <div className="mt-1 text-[10px] font-semibold text-[#6b7280]">+{eventsByDate[day.key].length - 3} more</div> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {view === 'week' ? (
              <div className="grid gap-2 md:grid-cols-7">
                {currentWeekDays.map((day) => (
                  <article key={day.key} className="min-h-[260px] rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                    <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">{day.label}</span>
                      <span className="text-[16px] font-bold text-[#111827]">{day.day}</span>
                    </div>
                    <div className="mt-3 grid gap-2">{(eventsByDate[day.key] || []).map(renderCompactEvent)}</div>
                  </article>
                ))}
              </div>
            ) : null}

            {view === 'list' ? (
              <PortalTable
                rows={events}
                onRowClick={setSelectedEvent}
                emptyMessage={loading ? 'Loading calendar items...' : 'No calendar items found.'}
                columns={[
                  { key: 'title', label: 'Title' },
                  { key: 'type', label: 'Type', render: (row) => <TypePill type={row.type} /> },
                  { key: 'start_datetime', label: 'Date', render: (row) => displayDate(row.start_datetime) },
                  { key: 'time', label: 'Time', render: (row) => row.all_day ? 'All day' : `${displayTime(row.start_datetime)}${row.end_datetime ? ` - ${displayTime(row.end_datetime)}` : ''}` },
                  { key: 'class_name', label: 'Class', render: (row) => row.class_name || '-' },
                  { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
                  { key: 'teacher_name', label: 'Teacher', render: (row) => row.teacher_name || '-' },
                  { key: 'status', label: 'Status', render: (row) => labelize(row.status) },
                ]}
              />
            ) : null}

            {view === 'timeline' ? (
              <div className="grid gap-2">
                {(payload.timeline || []).map((segment: any) => (
                  <article key={segment.id} className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-white p-3 md:grid-cols-[190px_minmax(0,1fr)_220px]">
                    <div>
                      <div className="text-[13px] font-bold text-[#111827]">{segment.title}</div>
                      <div className="mt-1 text-[11px] font-semibold text-[#6b7280]">{displayDate(segment.start_date)} - {displayDate(segment.end_date)}</div>
                    </div>
                    <div className="flex items-center"><TypePill type={segment.marker_type === 'closing_week' ? 'term_closing_week' : segment.marker_type} /></div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-[#4b5563]">
                      <span className="rounded-[4px] bg-[#f8fafc] px-2 py-1">{segment.events_count} events</span>
                      <span className="rounded-[4px] bg-[#f8fafc] px-2 py-1">{segment.assessments_count} tests</span>
                      <span className="rounded-[4px] bg-[#f8fafc] px-2 py-1">{segment.exam_count} exams</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="grid content-start gap-3">
          <SectionCard title="Upcoming" subtitle="Next visible school items">
            <div className="grid gap-2 p-4">
              {(summary.upcoming_events || []).length ? summary.upcoming_events.map((event: any) => (
                <button key={event.id} type="button" className="rounded-[5px] border border-[#e2e8f0] bg-white p-3 text-left hover:border-[#111827]/30" onClick={() => setSelectedEvent(event)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12px] font-bold text-[#111827]">{event.title}</span>
                    <TypePill type={event.type} />
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[#6b7280]">{displayDate(event.start_datetime)} {event.all_day ? '' : displayTime(event.start_datetime)}</div>
                </button>
              )) : <div className="text-[12px] font-semibold text-[#6b7280]">No upcoming items.</div>}
            </div>
          </SectionCard>

          {selectedEvent ? (
            <SectionCard title="Calendar Item" subtitle={labelize(selectedEvent.type)}>
              <div className="grid gap-3 p-4">
                <div>
                  <div className="text-[16px] font-bold text-[#111827]">{selectedEvent.title}</div>
                  <div className="mt-1 text-[12px] font-semibold text-[#6b7280]">{displayDate(selectedEvent.start_datetime)} {selectedEvent.all_day ? 'All day' : displayTime(selectedEvent.start_datetime)}</div>
                </div>
                <TypePill type={selectedEvent.type} />
                <div className="grid gap-1 text-[12px] font-medium text-[#374151]">
                  <div>Class: {selectedEvent.class_name || '-'}</div>
                  <div>Subject: {selectedEvent.subject_name || '-'}</div>
                  <div>Teacher: {selectedEvent.teacher_name || '-'}</div>
                  <div>Status: {labelize(selectedEvent.status)}</div>
                  {selectedEvent.recurrence ? <div>Recurs: {selectedEvent.recurrence}</div> : null}
                </div>
                {selectedEvent.description ? <div className="rounded-[5px] bg-[#f8fafc] p-3 text-[12px] leading-5 text-[#4b5563]">{selectedEvent.description}</div> : null}
                <div className="grid gap-2">
                  {selectedEvent.can_open_marks ? <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => openMarksSheet(selectedEvent)}><FileText className="size-3.5" /> Open Marks Sheet</Button> : null}
                  {selectedEvent.can_open_exam_paper && selectedEvent.assessment_id ? <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate(`/exam-builder/${selectedEvent.assessment_id}`)}>View Exam Paper</Button> : null}
                  {selectedEvent.can_open_exam_session ? <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/exam-sessions')}>View Exam Session</Button> : null}
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setSelectedEvent(null)}>Close</Button>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>

      {marksSheet?.instance ? (
        <SectionCard title={marksSheet.instance.title} subtitle={`${marksSheet.instance.class_name} - ${marksSheet.instance.subject_name}`}>
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Weekly Spelling Words / Items
                <Textarea className="min-h-44 text-[12px]" value={wordText} onChange={(event) => setWordText(event.target.value)} placeholder="One word or item per line" />
              </label>
              <div className="overflow-x-auto rounded-[6px] border border-[#e2e8f0]">
                <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="bg-[#111827] text-white">
                      <th className="px-3 py-2 font-bold">Student ID</th>
                      <th className="px-3 py-2 font-bold">Student Name</th>
                      <th className="px-3 py-2 font-bold">Score / {Number(marksSheet.instance.total_marks || 0)}</th>
                      <th className="px-3 py-2 font-bold">Comment</th>
                      <th className="px-3 py-2 font-bold">Status</th>
                      <th className="px-3 py-2 font-bold">Last Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marksRows.map((row, index) => {
                      const invalid = row.score !== '' && Number(row.score) > Number(marksSheet.instance.total_marks || 0)
                      return (
                        <tr key={row.student_id} className={index % 2 ? 'bg-[#eef1f5]' : 'bg-[#f8fafc]'}>
                          <td className="px-3 py-2 font-semibold text-[#374151]">{row.student_number}</td>
                          <td className="px-3 py-2 font-semibold text-[#111827]">{row.student_name}</td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              max={marksSheet.instance.total_marks}
                              className={`h-8 text-[12px] ${invalid ? 'border-[#ef4444] bg-[#fef2f2]' : ''}`}
                              value={row.score}
                              onChange={(event) => setMarksRows((rows) => rows.map((item) => item.student_id === row.student_id ? { ...item, score: event.target.value } : item))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input className="h-8 text-[12px]" value={row.comment} onChange={(event) => setMarksRows((rows) => rows.map((item) => item.student_id === row.student_id ? { ...item, comment: event.target.value } : item))} />
                          </td>
                          <td className="px-3 py-2 font-semibold text-[#4b5563]">{labelize(row.status || 'draft')}</td>
                          <td className="px-3 py-2 text-[#6b7280]">{row.last_saved_at ? displayDate(row.last_saved_at) : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={saving} onClick={() => saveMarks('draft')}><Save className="size-3.5" /> Save Draft</Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || marksRows.some((row) => row.score !== '' && Number(row.score) > Number(marksSheet.instance.total_marks || 0))} onClick={() => saveMarks('completed')}><CheckCircle2 className="size-3.5" /> Complete</Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setMarksSheet(null)}><XCircle className="size-3.5" /> Close</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}

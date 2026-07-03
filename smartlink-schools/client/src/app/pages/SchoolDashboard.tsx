import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Activity, AlertTriangle, ArrowRight, BookOpen, BookOpenCheck, CalendarCheck, Clock3, FlaskConical, GraduationCap, MessageSquare, ReceiptText, School, Sparkles, UsersRound } from 'lucide-react'
import { PortalTable } from '../components/PortalTable'
import { SchoolActionModal, type SchoolActionKind } from '../components/SchoolActionModal'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip, type SectionKpiItem } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

type DashboardViewKey = 'my-view' | 'school-overview' | 'finance' | 'attendance' | 'learning'

const studentColumns = [
  { key: 'student', label: 'Student' },
  { key: 'className', label: 'Class' },
  { key: 'balance', label: 'Fee Balance' },
  { key: 'attendance', label: 'Attendance' },
]

const insightColumns = [
  { key: 'subject', label: 'Subject' },
  { key: 'topic', label: 'Topic' },
  { key: 'average', label: 'Average' },
  { key: 'recommendation', label: 'Recommendation' },
]

const homeworkColumns = [
  { key: 'assignment', label: 'Assignment' },
  { key: 'className', label: 'Class' },
  { key: 'subject', label: 'Subject' },
  { key: 'due', label: 'Due' },
  { key: 'status', label: 'Status' },
]

const feeColumns = [
  { key: 'student', label: 'Student' },
  { key: 'className', label: 'Class' },
  { key: 'termName', label: 'Term' },
  { key: 'balance', label: 'Balance' },
  { key: 'status', label: 'Status' },
]

const attendanceColumns = [
  { key: 'student', label: 'Student' },
  { key: 'className', label: 'Class' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
]

const resultColumns = [
  { key: 'assessment', label: 'Assessment' },
  { key: 'className', label: 'Class' },
  { key: 'subject', label: 'Subject' },
  { key: 'average', label: 'Average' },
  { key: 'markedStudents', label: 'Marked' },
]

const forecastColumns = [
  { key: 'track', label: 'Track' },
  { key: 'subject', label: 'Subject' },
  { key: 'topic', label: 'Topic' },
  { key: 'score', label: 'Priority' },
  { key: 'action', label: 'Action' },
]

const viewMeta: Record<DashboardViewKey, { eyebrow: string; title: string; description: string; action: string }> = {
  'my-view': {
    eyebrow: 'SmartLink Schools',
    title: 'School command centre',
    description: 'Students, fees, attendance, homework, assessment insight and parent communication in one school operations workspace.',
    action: 'AI insights',
  },
  'school-overview': {
    eyebrow: 'School Overview',
    title: 'Whole-school operating view',
    description: 'A compact view for leadership to scan enrolment, attendance, homework, balances and student risk signals.',
    action: 'Create report',
  },
  finance: {
    eyebrow: 'Finance',
    title: 'Fee collection view',
    description: 'Collections, outstanding balances, receipts and reminder queues for the bursar and school leadership.',
    action: 'Record payment',
  },
  attendance: {
    eyebrow: 'Attendance',
    title: 'Daily register view',
    description: 'Today’s present, late, absent and unmarked class signals with parent follow-up actions.',
    action: 'Save register',
  },
  learning: {
    eyebrow: 'Teaching & Learning',
    title: 'Academic support view',
    description: 'Weak topics, homework, results and daily drill signals for teachers and academic leadership.',
    action: 'Generate support',
  },
}

function normalizeView(value: string | null): DashboardViewKey {
  if (value === 'school-overview' || value === 'finance' || value === 'attendance' || value === 'learning') return value
  return 'my-view'
}

function money(value: any) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function percent(value: any) {
  const number = Number(value || 0)
  return `${Number.isFinite(number) ? number.toFixed(1) : '0.0'}%`
}

function pretty(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function shortTime(value: any) {
  return value ? String(value).slice(0, 5) : '-'
}

function lessonStartTime(lesson: any) {
  return lesson?.startTime || lesson?.start_time
}

function lessonEndTime(lesson: any) {
  return lesson?.endTime || lesson?.end_time
}

function lessonTimeRange(lesson: any) {
  return `${shortTime(lessonStartTime(lesson))}-${shortTime(lessonEndTime(lesson))}`
}

function timeToMinutes(value: any) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function lessonProgress(lesson: any) {
  const start = timeToMinutes(lessonStartTime(lesson))
  const end = timeToMinutes(lessonEndTime(lesson))
  if (start === null || end === null || end <= start) return 0
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  return clampPercent(((current - start) / (end - start)) * 100)
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function lessonClassKey(lesson: any) {
  return String(lesson?.classId || lesson?.className || lesson?.id || '')
}

function preferredActiveLesson(current: any, candidate: any) {
  const currentStart = timeToMinutes(lessonStartTime(current)) ?? -1
  const candidateStart = timeToMinutes(lessonStartTime(candidate)) ?? -1
  if (candidateStart !== currentStart) return candidateStart > currentStart ? candidate : current
  const currentEnd = timeToMinutes(lessonEndTime(current)) ?? -1
  const candidateEnd = timeToMinutes(lessonEndTime(candidate)) ?? -1
  if (candidateEnd !== currentEnd) return candidateEnd > currentEnd ? candidate : current
  return Number(candidate?.id || 0) > Number(current?.id || 0) ? candidate : current
}

function collapseLessonsByClass(lessons: any[]) {
  const byClass = new Map<string, any>()
  const conflicts: Array<{ className: string; hidden: any; shown: any }> = []

  lessons.forEach((lesson) => {
    const key = lessonClassKey(lesson)
    if (!key) return
    const current = byClass.get(key)
    if (!current) {
      byClass.set(key, lesson)
      return
    }

    const shown = preferredActiveLesson(current, lesson)
    const hidden = shown === current ? lesson : current
    byClass.set(key, shown)
    conflicts.push({
      className: shown?.className || hidden?.className || 'Class',
      hidden,
      shown,
    })
  })

  return { lessons: Array.from(byClass.values()), conflicts }
}

function normalizeDate(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

function name(row: any) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || row.full_name || row.title || '-'
}

function actionForView(view: DashboardViewKey): SchoolActionKind {
  if (view === 'finance') return 'payment'
  if (view === 'attendance') return 'attendance'
  if (view === 'school-overview') return 'report'
  return 'insights'
}

function DashboardHero({ view, onAction }: { view: DashboardViewKey; onAction: () => void }) {
  const meta = viewMeta[view]
  return (
    <section className="rounded-[8px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-5 shadow-[var(--mera-shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[var(--mera-panel-text-muted)]">{meta.eyebrow}</div>
          <h1 className="mt-1 text-[24px] font-medium tracking-[0] text-[var(--mera-panel-text)]">{meta.title}</h1>
          <p className="mt-1 max-w-3xl text-[13px] font-normal leading-5 text-[var(--mera-panel-text-muted)]">{meta.description}</p>
        </div>
        <button type="button" onClick={onAction} className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#6bdd9e] px-4 text-[13px] font-medium text-[#111111] transition hover:bg-[#5dd38f]">
          <Sparkles className="size-3.5" />
          {meta.action}
        </button>
      </div>
    </section>
  )
}

function mapDashboardRows(payloads: any) {
  const students = (payloads.students?.students || []).slice(0, 6).map((row: any) => ({
    id: row.id,
    student: name(row),
    className: row.class_name || '-',
    balance: money(row.fee_balance),
    attendance: row.status || 'active',
  }))

  const fees = (payloads.fees?.feeAccounts || []).map((row: any) => ({
    id: row.id,
    student: name(row),
    className: row.class_name || '-',
    termName: row.term_name,
    balance: money(row.balance),
    rawBalance: Number(row.balance || 0),
    status: row.status,
  }))

  const attendance = (payloads.attendance?.attendance || []).map((row: any) => ({
    id: `${row.student_id}-${row.attendance_date || 'today'}`,
    student: name(row),
    className: row.class_name || '-',
    date: normalizeDate(row.attendance_date),
    status: row.status,
  }))

  const homework = (payloads.homework?.homework || []).slice(0, 6).map((row: any) => ({
    id: row.id,
    assignment: row.title,
    className: row.class_name,
    subject: row.subject_name,
    due: normalizeDate(row.due_date),
    status: row.status,
  }))

  const insights = (payloads.insights?.topics || []).slice(0, 6).map((row: any) => ({
    id: `${row.subject_name}-${row.topic_name}`,
    subject: row.subject_name,
    topic: row.topic_name,
    average: percent(row.average_score),
    rawAverage: Number(row.average_score || 0),
    recommendation: row.recommendation,
  }))

  const results = (payloads.results?.results || []).slice(0, 6).map((row: any) => ({
    id: row.id,
    assessment: row.assessment_name,
    className: row.class_name,
    subject: row.subject_name,
    average: percent(row.average_score),
    markedStudents: row.marked_students,
  }))

  const forecasts = (payloads.forecasts?.forecasts || []).slice(0, 6).map((row: any) => ({
    id: `${row.exam_track}-${row.subject_name}-${row.topic_name}`,
    track: row.exam_track,
    subject: row.subject_name,
    topic: row.topic_name,
    score: Number(row.priority_score || 0).toFixed(1),
    action: Number(row.priority_score || 0) >= 70 ? 'Revise first' : 'Practice set',
  }))

  return { students, fees, attendance, homework, insights, results, forecasts }
}

function buildKpis(dashboard: any, rows: ReturnType<typeof mapDashboardRows>, showFees: boolean): SectionKpiItem[] {
  const rate = Number(dashboard?.attendance?.rate || 0)
  const items: SectionKpiItem[] = [
    { label: 'Students', value: Number(dashboard?.totalStudents || 0).toLocaleString(), helper: 'active learners', delta: 'database', rows: rows.students },
    { label: 'Attendance', value: percent(rate), helper: 'marked today', delta: rate >= 90 ? 'strong' : 'review', tone: rate >= 90 ? 'good' : 'warn', rows: rows.attendance },
    { label: 'Homework Due', value: Number(dashboard?.pendingHomework || 0), helper: 'open assignments', delta: 'teacher queue', rows: rows.homework },
    { label: 'Weak Topics', value: rows.insights.filter((row: any) => Number(row.rawAverage || 0) < 50).length, helper: 'below 50%', delta: 'support plan', rows: rows.insights },
  ]
  if (!showFees) return items
  return [
    items[0],
    { label: 'Fees Collected', value: money(dashboard?.fees?.collected), helper: 'current term', delta: `${Number(dashboard?.fees?.studentsWithBalance || 0)} balances`, rows: rows.fees },
    ...items.slice(1, 3),
  ]
}

function financeKpis(dashboard: any, rows: ReturnType<typeof mapDashboardRows>): SectionKpiItem[] {
  const outstanding = Number(dashboard?.fees?.outstanding || 0)
  return [
    { label: 'Collected', value: money(dashboard?.fees?.collected), helper: 'posted payments', delta: 'database', rows: rows.fees, tone: 'good' },
    { label: 'Outstanding', value: money(outstanding), helper: 'fee balance', delta: outstanding > 0 ? 'follow up' : 'clear', tone: outstanding > 0 ? 'warn' : 'good', rows: rows.fees },
    { label: 'Accounts', value: rows.fees.length, helper: 'fee accounts', delta: 'visible scope', rows: rows.fees },
    { label: 'With Balances', value: Number(dashboard?.fees?.studentsWithBalance || 0), helper: 'students', delta: 'reminder queue', tone: 'warn', rows: rows.fees.filter((row: any) => row.rawBalance > 0) },
  ]
}

function attendanceKpis(dashboard: any, rows: ReturnType<typeof mapDashboardRows>): SectionKpiItem[] {
  return [
    { label: 'Attendance Rate', value: percent(dashboard?.attendance?.rate), helper: 'today', delta: 'live register', rows: rows.attendance },
    { label: 'Present', value: Number(dashboard?.attendance?.present || 0), helper: 'learners', delta: 'today', tone: 'good', rows: rows.attendance.filter((row: any) => row.status === 'present') },
    { label: 'Late', value: Number(dashboard?.attendance?.late || 0), helper: 'learners', delta: 'review', tone: 'warn', rows: rows.attendance.filter((row: any) => row.status === 'late') },
    { label: 'Absent', value: Number(dashboard?.attendance?.absent || 0), helper: 'learners', delta: 'alert', tone: 'bad', rows: rows.attendance.filter((row: any) => row.status === 'absent') },
  ]
}

function learningKpis(rows: ReturnType<typeof mapDashboardRows>): SectionKpiItem[] {
  const weakTopics = rows.insights.filter((row: any) => Number(row.rawAverage || 0) < 50)
  return [
    { label: 'Weak Topics', value: weakTopics.length, helper: 'below 50%', delta: 'support plan', tone: weakTopics.length ? 'warn' : 'good', rows: weakTopics },
    { label: 'Homework', value: rows.homework.length, helper: 'assignments', delta: 'visible scope', rows: rows.homework },
    { label: 'Assessments', value: rows.results.length, helper: 'results', delta: 'database', rows: rows.results },
    { label: 'Forecasts', value: rows.forecasts.length, helper: 'priority topics', delta: 'revision', rows: rows.forecasts },
  ]
}

function FeeSnapshotCard({ dashboard }: { dashboard: any }) {
  const collected = Number(dashboard?.fees?.collected || 0)
  const outstanding = Number(dashboard?.fees?.outstanding || 0)
  const total = Math.max(1, collected + outstanding)
  const collectedWidth = Math.max(0, Math.min(100, (collected / total) * 100))
  const outstandingWidth = Math.max(0, Math.min(100, (outstanding / total) * 100))

  return (
    <SectionCard title="Fee Collection Snapshot" subtitle="Current term database totals">
      <div className="grid gap-4 p-4">
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#111827]">
            <span>Collected</span>
            <span>{money(collected)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-[4px] bg-[#edf2f7]">
            <div className="h-full rounded-[4px] bg-[#1557dc]" style={{ width: `${collectedWidth}%` }} />
          </div>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#111827]">
            <span>Outstanding</span>
            <span>{money(outstanding)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-[4px] bg-[#edf2f7]">
            <div className="h-full rounded-[4px] bg-[#f59e0b]" style={{ width: `${outstandingWidth}%` }} />
          </div>
        </div>
        <div className="rounded-[5px] border border-[#e2e8f0] bg-[#f8fafc] p-3 text-[12px] leading-5 text-[#374151]">
          {Number(dashboard?.fees?.studentsWithBalance || 0).toLocaleString()} learners currently have balances in the visible school scope.
        </div>
      </div>
    </SectionCard>
  )
}

function AttendanceRateCard({ dashboard }: { dashboard: any }) {
  const rate = Math.max(0, Math.min(100, Number(dashboard?.attendance?.rate || 0)))
  const present = Number(dashboard?.attendance?.present || 0)
  const late = Number(dashboard?.attendance?.late || 0)
  const absent = Number(dashboard?.attendance?.absent || 0)
  const lateStop = Math.min(100, rate + Math.max(0, late ? 5 : 0))

  return (
    <SectionCard title="Attendance Rate" subtitle="Today from attendance records">
      <div className="grid gap-4 p-4 md:grid-cols-[150px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[150px_minmax(0,1fr)]">
        <div className="grid size-36 place-items-center rounded-full" style={{ background: `conic-gradient(#1557dc 0 ${rate}%, #f59e0b ${rate}% ${lateStop}%, #ef4444 ${lateStop}% 100%)` }}>
          <div className="grid size-24 place-items-center rounded-full bg-white text-center">
            <div>
              <strong className="block text-[26px] font-bold tracking-[-0.04em] text-[#111827]">{percent(rate)}</strong>
              <span className="text-[11px] font-bold text-[#1557dc]">{rate >= 90 ? 'Excellent' : 'Review'}</span>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-3 text-[12px]">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#111827]">Present</span><span className="text-[#6b7280]">{present.toLocaleString()}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#111827]">Late</span><span className="text-[#6b7280]">{late.toLocaleString()}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#111827]">Absent</span><span className="text-[#6b7280]">{absent.toLocaleString()}</span></div>
        </div>
      </div>
    </SectionCard>
  )
}

function InsightsCard({ rows }: { rows: any[] }) {
  return (
    <SectionCard title="Assessment Insights" subtitle="Weakest subjects and support plan">
      <PortalTable columns={insightColumns} rows={rows} emptyMessage="No assessment insights found." />
    </SectionCard>
  )
}

function RecentStudentsCard({ rows }: { rows: any[] }) {
  return (
    <SectionCard title="Recent Students" subtitle="Latest learner records and risk signals">
      <PortalTable columns={studentColumns} rows={rows} emptyMessage="No students found." />
    </SectionCard>
  )
}

function HomeworkCard({ rows }: { rows: any[] }) {
  return (
    <SectionCard title="Homework Reminders" subtitle="Assignments due soon">
      <PortalTable columns={homeworkColumns} rows={rows} emptyMessage="No homework found." />
    </SectionCard>
  )
}

function PromptListCard({ title, subtitle, items }: { title: string; subtitle: string; items: Array<{ label: string; value: string; detail: string }> }) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="grid gap-2 p-4">
        {items.map((item) => (
          <article key={item.label} className="rounded-[5px] border border-[#e2e8f0] bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#111827]">{item.label}</span>
              <strong className="text-[12px] text-[#111827]">{item.value}</strong>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[#6b7280]">{item.detail}</p>
          </article>
        ))}
      </div>
    </SectionCard>
  )
}

function ShortcutsCard({ onAction }: { onAction: (action: SchoolActionKind) => void }) {
  const shortcuts: Array<[any, string, string, SchoolActionKind]> = [
    [GraduationCap, 'Add learner', 'Create a student profile with class details.', 'student'],
    [ReceiptText, 'Record payment', 'Post fees and receipt records.', 'payment'],
    [CalendarCheck, 'Mark attendance', 'Update today’s class register.', 'attendance'],
    [BookOpenCheck, 'Create homework', 'Publish work and notify parents.', 'homework'],
    [MessageSquare, 'Compose message', 'Send announcement or reminder.', 'message'],
  ]

  return (
    <SectionCard
      title="Operations Shortcuts"
      subtitle="Common school workflows"
      actions={<button type="button" onClick={() => onAction('filters')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1557dc]">Open tools <ArrowRight className="size-3" /></button>}
    >
      <div className="grid gap-2 p-4 text-[12px]">
        {shortcuts.map(([Icon, title, detail, action]) => {
          const TypedIcon = Icon as any
          return (
            <button key={String(title)} type="button" onClick={() => onAction(action)} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-[5px] border border-[#e2e8f0] bg-white p-2 text-left hover:bg-[#f8fafc]">
              <span className="grid size-7 place-items-center rounded-[5px] bg-[#f3f4f6] text-[#111827]"><TypedIcon className="size-3.5" /></span>
              <span>
                <strong className="block text-[12px] text-[#111827]">{title as string}</strong>
                <span className="mt-0.5 block text-[11px] text-[#6b7280]">{detail as string}</span>
              </span>
            </button>
          )
        })}
      </div>
    </SectionCard>
  )
}

function lessonTitle(lesson: any) {
  if (!lesson) return '-'
  return [lesson.className, lesson.subjectName || lesson.title].filter(Boolean).join(' - ') || lesson.title || 'Lesson'
}

function statusTone(status: any) {
  const value = String(status || '').toUpperCase()
  if (value.includes('CLOSED') || value.includes('EMERGENCY')) return 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
  if (value.includes('EXAM') || value.includes('EVENT')) return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
}

function TodayIntelligenceCard({ todayPayload, user }: { todayPayload: any; user?: any }) {
  const today = todayPayload?.today || {}
  const alerts = Array.isArray(today.alerts) ? today.alerts : []
  const exams = Array.isArray(today.examSessionsToday) ? today.examSessionsToday : []
  const classesWriting = Array.isArray(today.classesWritingExams) ? today.classesWritingExams : []
  const classesContinuing = Array.isArray(today.classesContinuingNormalLessons) ? today.classesContinuingNormalLessons : []
  const rawClassesLearningNow = Array.isArray(today.classesLearningNow) ? today.classesLearningNow : Array.isArray(today.activeLessonsNow) ? today.activeLessonsNow : []
  const { lessons: classesLearningNow, conflicts: lessonConflicts } = collapseLessonsByClass(rawClassesLearningNow)
  const upcomingLessons = Array.isArray(today.upcomingLessons) ? today.upcomingLessons : []
  const labsNow = Array.isArray(today.laboratoriesInUseNow) ? today.laboratoriesInUseNow : []
  const teacherId = user?.id ? String(user.id) : ''
  const isTeacher = String(user?.role || '').toLowerCase() === 'teacher'
  const teacherActiveLesson = teacherId ? (today.currentLessonsByTeacher?.[teacherId]?.[0] || today.activeLessonNow || null) : null
  const teacherUpcomingLesson = teacherId ? (today.nextLessonsByTeacher?.[teacherId] || today.upcomingLesson || null) : null
  const status = pretty(today.schoolStatus || 'NORMAL_SCHOOL_DAY')
  const operatingMode = pretty(today.operatingMode || 'NORMAL_TIMETABLE')
  const nextLesson = upcomingLessons[0]
  const dayFlowLessons = upcomingLessons.length ? upcomingLessons.slice(0, 3) : classesLearningNow.slice(0, 3)
  const publishedLessonCount = Math.max(classesContinuing.length, classesLearningNow.length, 1)
  const activeLoad = clampPercent((classesLearningNow.length / publishedLessonCount) * 100)
  const overlapCount = Math.max(0, rawClassesLearningNow.length - classesLearningNow.length)
  const overlapClassNames = [...new Set(lessonConflicts.map((item) => item.className).filter(Boolean))].slice(0, 4)
  const overlapDetail = overlapClassNames.length ? overlapClassNames.join(', ') : 'the timetable'
  const metrics = [
    {
      label: 'Learning now',
      value: classesLearningNow.length,
      detail: overlapCount ? `${countLabel(classesLearningNow.length, 'class', 'classes')} active / ${countLabel(overlapCount, 'overlap')}` : countLabel(classesLearningNow.length, 'class', 'classes'),
      icon: BookOpen,
      progress: activeLoad,
      barClass: 'bg-[#2fbd83]',
      iconClass: 'text-[#047857]',
    },
    {
      label: 'Exams today',
      value: exams.length,
      detail: countLabel(exams.length, 'session'),
      icon: CalendarCheck,
      progress: clampPercent((exams.length / Math.max(exams.length + classesContinuing.length, 1)) * 100),
      barClass: 'bg-[#d97706]',
      iconClass: 'text-[#b45309]',
    },
    {
      label: 'Writing exams',
      value: classesWriting.length,
      detail: countLabel(classesWriting.length, 'class', 'classes'),
      icon: GraduationCap,
      progress: clampPercent((classesWriting.length / Math.max(classesWriting.length + classesLearningNow.length, 1)) * 100),
      barClass: 'bg-[#111111]',
      iconClass: 'text-[#111111]',
    },
    {
      label: 'Labs active',
      value: labsNow.length,
      detail: countLabel(labsNow.length, 'specialist room'),
      icon: FlaskConical,
      progress: clampPercent((labsNow.length / Math.max(labsNow.length + classesLearningNow.length, 1)) * 100),
      barClass: 'bg-[#8b5cf6]',
      iconClass: 'text-[#6d28d9]',
    },
  ]
  return (
    <SectionCard
      title="School Operations Now"
      subtitle="Live timetable state, next lessons, alerts and operating mode"
      actions={<span className={`rounded-[5px] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ${statusTone(today.schoolStatus)}`}>{status}</span>}
    >
      <div className="border-b border-[#ded8cd] bg-[#f6f4ef] px-4 py-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
          <div className="overflow-hidden rounded-[8px] border border-[#202020] bg-[#111111] text-white shadow-[0_16px_30px_rgba(17,17,17,0.16)]">
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#c9c2b6]">
                  <Activity className="size-3.5 text-[#6bdd9e]" />
                  Current operating mode
                </div>
                <div className="mt-2 text-[24px] font-black leading-tight tracking-[0] text-white">{operatingMode}</div>
                <div className="mt-2 max-w-2xl text-[12px] font-medium leading-5 text-[#ded8cd]">
                  {classesLearningNow.length ? `${countLabel(classesLearningNow.length, 'class', 'classes')} active now across the published timetable.${overlapCount ? ` ${countLabel(overlapCount, 'overlapping entry', 'overlapping entries')} collapsed.` : ''}` : 'No class lesson is active at this exact time.'}
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-[#ded8cd]">
                    <span>Live timetable load</span>
                    <span className="text-[#6bdd9e]">{activeLoad}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                    <span className="block h-full rounded-full bg-[#6bdd9e]" style={{ width: `${activeLoad}%` }} />
                  </div>
                </div>
              </div>
              <div className="rounded-[7px] border border-white/10 bg-white/10 p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#c9c2b6]">Next lesson</div>
                <div className="mt-2 truncate text-[14px] font-bold text-white">
                  {nextLesson ? `${shortTime(lessonStartTime(nextLesson))} / ${nextLesson.className || 'Class'}` : 'None left'}
                </div>
                <div className="mt-1 truncate text-[11px] font-medium text-[#ded8cd]">
                  {nextLesson ? `${nextLesson.subjectName || nextLesson.title || 'Lesson'}${nextLesson.teacherName ? ` with ${nextLesson.teacherName}` : ''}` : 'The published timetable has no remaining blocks today.'}
                </div>
                <div className="mt-4 rounded-[6px] border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#c9c2b6]">Classes active</div>
                  <div className="mt-1 text-[20px] font-black leading-none text-[#6bdd9e]">{classesLearningNow.length}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-2 border-t border-white/10 bg-white/[0.04] p-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.label} className="rounded-[7px] border border-[#ded8cd] bg-white p-3 shadow-[0_1px_0_rgba(17,17,17,0.04)]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">{item.label}</span>
                      <Icon className={`size-3.5 ${item.iconClass}`} />
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="text-[24px] font-black leading-none text-[#111111]">{item.value}</span>
                      <span className="pb-0.5 text-[10px] font-semibold text-[#6f6758]">{item.detail}</span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eee9df]">
                      <span className={`block h-full rounded-full ${item.barClass}`} style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="rounded-[8px] border border-[#ded8cd] bg-white p-4 shadow-[0_1px_0_rgba(17,17,17,0.04)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
                <Clock3 className="size-3.5 text-[#111111]" />
                Day flow
              </div>
              <span className="rounded-full border border-[#ded8cd] bg-[#f6f4ef] px-2.5 py-1 text-[10px] font-bold text-[#6f6758]">
                {upcomingLessons.length ? 'Next blocks' : classesLearningNow.length ? 'Live blocks' : 'Clear'}
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {dayFlowLessons.map((lesson: any, index: number) => {
                const isLive = !upcomingLessons.length && classesLearningNow.length > 0
                const progress = isLive ? Math.max(8, lessonProgress(lesson)) : 0
                return (
                  <div key={`${lesson.id || index}-${lesson.classId || lesson.className || 'class'}`} className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3 rounded-[7px] border border-[#e7e0d4] bg-[#fcfbf8] px-3 py-2.5">
                    <div className="grid gap-1">
                      <div className="text-[11px] font-black text-[#111111]">{shortTime(lessonStartTime(lesson))}</div>
                      <div className={`h-1 rounded-full ${isLive ? 'bg-[#6bdd9e]' : 'bg-[#d8d0c2]'}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-[12px] font-bold text-[#111111]">{lessonTitle(lesson)}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${isLive ? 'bg-[#eafff4] text-[#047857]' : 'bg-[#f0ede6] text-[#6f6758]'}`}>
                          {isLive ? 'Live' : 'Next'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] font-medium text-[#6f6758]">{lesson.teacherName || 'Unassigned teacher'}{lesson.facilityName ? ` / ${lesson.facilityName}` : ''}</div>
                      {isLive ? (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#eee9df]">
                          <span className="block h-full rounded-full bg-[#6bdd9e]" style={{ width: `${progress}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {!upcomingLessons.length && !classesLearningNow.length ? (
                <div className="rounded-[7px] border border-dashed border-[#d8d0c2] bg-[#fcfbf8] px-3 py-4 text-[12px] font-semibold text-[#6f6758]">No remaining timetable lessons for today.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {isTeacher ? (
        <div className="grid gap-3 border-b border-[#ded8cd] bg-[#f6f4ef] p-4 md:grid-cols-2">
          <div className="rounded-[8px] border border-[#ded8cd] bg-white px-4 py-3 shadow-[0_1px_0_rgba(17,17,17,0.04)]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
              <BookOpenCheck className="size-3.5" />
              Your active lesson
            </div>
            {teacherActiveLesson ? (
              <div className="mt-2">
                <div className="text-[15px] font-bold text-[#111111]">{lessonTitle(teacherActiveLesson)}</div>
                <div className="mt-1 text-[12px] font-medium text-[#6f6758]">{lessonTimeRange(teacherActiveLesson)}{teacherActiveLesson.facilityName ? ` / ${teacherActiveLesson.facilityName}` : ''}</div>
              </div>
            ) : (
              <div className="mt-2 text-[12px] font-medium text-[#6f6758]">No active lesson for you right now.</div>
            )}
          </div>
          <div className="rounded-[8px] border border-[#ded8cd] bg-white px-4 py-3 shadow-[0_1px_0_rgba(17,17,17,0.04)]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
              <ArrowRight className="size-3.5" />
              Up next
            </div>
            {teacherUpcomingLesson ? (
              <div className="mt-2">
                <div className="text-[15px] font-bold text-[#111111]">{lessonTitle(teacherUpcomingLesson)}</div>
                <div className="mt-1 text-[12px] font-medium text-[#6f6758]">{lessonTimeRange(teacherUpcomingLesson)}{teacherUpcomingLesson.facilityName ? ` / ${teacherUpcomingLesson.facilityName}` : ''}</div>
              </div>
            ) : (
              <div className="mt-2 text-[12px] font-medium text-[#6f6758]">No upcoming lesson left in today’s published timetable.</div>
            )}
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
            <UsersRound className="size-3.5 text-[#111111]" />
            Classes learning now
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {overlapCount ? (
              <div className="rounded-full border border-[#f4d4aa] bg-[#fff7ed] px-2.5 py-1 text-[11px] font-bold text-[#92400e]">{countLabel(overlapCount, 'overlap')}</div>
            ) : null}
            <div className="rounded-full border border-[#ded8cd] bg-[#f6f4ef] px-2.5 py-1 text-[11px] font-bold text-[#6f6758]">
              {classesContinuing.length ? `${classesLearningNow.length}/${classesContinuing.length} classes active` : `${classesLearningNow.length} active classes`}
            </div>
          </div>
        </div>
        {overlapCount ? (
          <div className="rounded-[8px] border border-[#f4d4aa] bg-[#fffaf0] px-3 py-2 text-[12px] font-semibold text-[#92400e]">
            {countLabel(overlapCount, 'overlapping timetable entry', 'overlapping timetable entries')} found for {overlapDetail}. Showing the latest active block for each class.
          </div>
        ) : null}
        {classesLearningNow.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {classesLearningNow.slice(0, 9).map((lesson: any) => {
              const progress = Math.max(8, lessonProgress(lesson))
              return (
                <div key={`${lesson.id || lesson.classId || lesson.className}-${lesson.subjectName || lesson.title || 'lesson'}`} className="overflow-hidden rounded-[8px] border border-[#ded8cd] bg-white shadow-[0_1px_0_rgba(17,17,17,0.04)]">
                  <div className="h-1 bg-[#111111]" />
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-[#111111]">{lesson.className || 'Class'}</div>
                        <div className="mt-1 truncate text-[12px] font-semibold text-[#5b554b]">{lesson.subjectName || lesson.title || 'Lesson'}</div>
                      </div>
                      <div className="rounded-full border border-[#ded8cd] bg-[#f6f4ef] px-2 py-1 text-[11px] font-black text-[#111111]">{lessonTimeRange(lesson)}</div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-[#6f6758]">
                      <School className="size-3.5" />
                      <span className="truncate">{lesson.teacherName || 'Unassigned teacher'}{lesson.facilityName ? ` / ${lesson.facilityName}` : ''}</span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eee9df]">
                      <span className="block h-full rounded-full bg-[#6bdd9e]" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold text-[#6f6758]">
                      <span>{progress}% complete</span>
                      <span>Live</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-[8px] border border-dashed border-[#d8d0c2] bg-[#f6f4ef] px-4 py-4 text-[12px] font-semibold text-[#6f6758]">
            No class is inside a published lesson at this exact time. {nextLesson ? `Next lesson starts at ${shortTime(lessonStartTime(nextLesson))} for ${nextLesson.className || 'a class'}.` : 'No upcoming lessons remain today.'}
          </div>
        )}
      </div>
      <div className="grid gap-3 border-t border-[#ded8cd] bg-[#f6f4ef] p-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
            <AlertTriangle className="size-3.5 text-[#92400e]" />
            Alerts
          </div>
          {alerts.length ? alerts.slice(0, 3).map((item: any) => (
            <div key={`${item.code}-${item.message}`} className="rounded-[7px] border border-[#f4d4aa] bg-white px-3 py-2 text-[12px] font-semibold text-[#92400e]">
              {item.message}
            </div>
          )) : <div className="rounded-[7px] border border-[#ded8cd] bg-white px-3 py-2 text-[12px] font-semibold text-[#6f6758]">No operational alerts for the current snapshot.</div>}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f6758]">
            <MessageSquare className="size-3.5 text-[#111111]" />
            Recommendations
          </div>
          {(today.recommendations || []).length ? today.recommendations.slice(0, 3).map((item: string) => (
            <div key={item} className="rounded-[7px] border border-[#ded8cd] bg-white px-3 py-2 text-[12px] font-semibold text-[#33302b]">{item}</div>
          )) : <div className="rounded-[7px] border border-[#ded8cd] bg-white px-3 py-2 text-[12px] font-semibold text-[#6f6758]">No recommended action right now.</div>}
        </div>
      </div>
    </SectionCard>
  )
}

function dashboardPrompts(dashboard: any) {
  return [
    { label: 'Attendance', value: percent(dashboard?.attendance?.rate), detail: 'Today’s register is calculated from attendance records.' },
    { label: 'Outstanding Fees', value: money(dashboard?.fees?.outstanding), detail: 'Balances come from fee accounts in the database.' },
    { label: 'Homework Due', value: String(Number(dashboard?.pendingHomework || 0)), detail: 'Open assignments in the visible class scope.' },
  ]
}

async function safeLoad(fn: () => Promise<any>, fallback: any) {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export function SchoolDashboard() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { token, api, user, data } = usePortal()
  const requestedView = normalizeView(searchParams.get('view'))
  const view = user?.role === 'teacher' && requestedView === 'finance' ? 'my-view' : requestedView
  const [payloads, setPayloads] = useState<any>({
    dashboard: {},
    students: { students: [] },
    fees: { feeAccounts: [] },
    attendance: { attendance: [] },
    homework: { homework: [] },
    insights: { topics: [] },
    results: { results: [] },
    forecasts: { forecasts: [] },
    today: { today: {} },
  })
  const [error, setError] = useState('')
  const [action, setAction] = useState<SchoolActionKind>('insights')
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = async () => {
    if (!token) return
    setError('')
    const [dashboard, students, fees, attendance, homework, insights, results, forecasts, today] = await Promise.all([
      safeLoad(() => api.getSchoolDashboard(token), {}),
      safeLoad(() => api.listStudents(token), { students: [] }),
      safeLoad(() => api.listFeeAccounts(token), { feeAccounts: [] }),
      safeLoad(() => api.listAttendance(token), { attendance: [] }),
      safeLoad(() => api.listHomework(token), { homework: [] }),
      safeLoad(() => api.listAssessmentInsights(token), { topics: [] }),
      safeLoad(() => api.listResults(token), { results: [] }),
      safeLoad(() => api.listForecasts(token), { forecasts: [] }),
      safeLoad(() => api.getSchoolToday(token), { today: {} }),
    ])
    setPayloads({ dashboard, students, fees, attendance, homework, insights, results, forecasts, today })
  }

  useEffect(() => {
    refresh().catch((err: any) => setError(err?.message || 'Unable to load dashboard data.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (data?.schoolDashboard) {
      setPayloads((current: any) => ({
        ...current,
        ...data.schoolDashboard,
        today: data.schoolDashboard.today || current.today || { today: {} },
      }))
    }
  }, [data?.schoolDashboard])

  const rows = useMemo(() => mapDashboardRows(payloads), [payloads])
  const dashboard = payloads.dashboard || {}
  const role = String(user?.role || '').toLowerCase()
  const showFees = ['super_admin', 'school_owner', 'headteacher', 'bursar'].includes(role)
  const kpis = useMemo(() => buildKpis(dashboard, rows, showFees), [dashboard, rows, showFees])

  const openAction = (nextAction: SchoolActionKind) => {
    setAction(nextAction)
    setModalOpen(true)
  }

  return (
    <div className="grid gap-3 p-4">
      <DashboardHero view={view} onAction={() => openAction(actionForView(view))} />
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      {view === 'finance' ? (
        <>
          <SectionKpiStrip items={financeKpis(dashboard, rows)} />
          <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
            <SectionCard title="Fees Register" subtitle="Balances, receipts and payment state">
              <PortalTable columns={feeColumns} rows={rows.fees} emptyMessage="No fee accounts available for this role." />
            </SectionCard>
            <PromptListCard title="Reminder Queue" subtitle="Fee follow-ups ready for review" items={dashboardPrompts(dashboard)} />
          </div>
        </>
      ) : null}

      {view === 'attendance' ? (
        <>
          <SectionKpiStrip items={attendanceKpis(dashboard, rows)} />
          <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
            <AttendanceRateCard dashboard={dashboard} />
            <SectionCard title="Attendance Register" subtitle="Today’s marked learner states">
              <PortalTable columns={attendanceColumns} rows={rows.attendance} emptyMessage="No attendance records available." />
            </SectionCard>
          </div>
          <PromptListCard title="Attendance Actions" subtitle="Follow-up queues for class teachers" items={dashboardPrompts(dashboard)} />
        </>
      ) : null}

      {view === 'learning' ? (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#d7dde5] bg-white p-4 shadow-sm">
            <div>
              <div className="text-[14px] font-semibold text-[#111827]">Log what I taught today</div>
              <div className="mt-1 text-[12px] font-medium text-[#64748b]">Finalize today’s actual topic before generating Daily Drills.</div>
            </div>
            <button type="button" onClick={() => navigate('/teacher/lesson-log/new')} className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-[#111827] px-4 text-[12px] font-semibold text-white hover:bg-[#1f2937]">
              <BookOpenCheck className="size-3.5" />
              Log lesson
            </button>
          </section>
          <SectionKpiStrip items={learningKpis(rows)} />
          <div className="grid gap-3 xl:grid-cols-2">
            <InsightsCard rows={rows.insights} />
            <HomeworkCard rows={rows.homework} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <SectionCard title="Results Review" subtitle="Classes that need academic review">
              <PortalTable columns={resultColumns} rows={rows.results} emptyMessage="No assessment results found." />
            </SectionCard>
            <SectionCard title="Exam Forecast" subtitle="Priority topics for revision planning">
              <PortalTable columns={forecastColumns} rows={rows.forecasts} emptyMessage="No forecast records found." />
            </SectionCard>
          </div>
        </>
      ) : null}

      {view === 'school-overview' ? (
        <>
          <TodayIntelligenceCard todayPayload={payloads.today} user={user} />
          <SectionKpiStrip items={kpis} />
          <div className="grid gap-3 xl:grid-cols-[0.85fr_1fr]">
            <AttendanceRateCard dashboard={dashboard} />
            <RecentStudentsCard rows={rows.students} />
          </div>
          <div className="grid gap-3 xl:grid-cols-[1fr_0.85fr]">
            <HomeworkCard rows={rows.homework} />
            <ShortcutsCard onAction={openAction} />
          </div>
        </>
      ) : null}

      {view === 'my-view' ? (
        <>
          <TodayIntelligenceCard todayPayload={payloads.today} user={user} />
          <SectionKpiStrip items={kpis} />
          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
            {showFees ? <FeeSnapshotCard dashboard={dashboard} /> : <RecentStudentsCard rows={rows.students} />}
            <AttendanceRateCard dashboard={dashboard} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <InsightsCard rows={rows.insights} />
            {showFees ? <RecentStudentsCard rows={rows.students} /> : <HomeworkCard rows={rows.homework} />}
          </div>
          <div className="grid gap-3 xl:grid-cols-[1fr_0.85fr]">
            <HomeworkCard rows={rows.homework} />
            <ShortcutsCard onAction={openAction} />
          </div>
        </>
      ) : null}

      <SchoolActionModal open={modalOpen} action={action} onOpenChange={setModalOpen} onSaved={refresh} />
    </div>
  )
}

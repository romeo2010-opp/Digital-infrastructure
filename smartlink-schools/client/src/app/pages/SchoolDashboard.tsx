import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowRight, BookOpenCheck, CalendarCheck, GraduationCap, MessageSquare, ReceiptText, Sparkles } from 'lucide-react'
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
  const { token, api, user } = usePortal()
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
  })
  const [error, setError] = useState('')
  const [action, setAction] = useState<SchoolActionKind>('insights')
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = async () => {
    if (!token) return
    setError('')
    const [dashboard, students, fees, attendance, homework, insights, results, forecasts] = await Promise.all([
      safeLoad(() => api.getSchoolDashboard(token), {}),
      safeLoad(() => api.listStudents(token), { students: [] }),
      safeLoad(() => api.listFeeAccounts(token), { feeAccounts: [] }),
      safeLoad(() => api.listAttendance(token), { attendance: [] }),
      safeLoad(() => api.listHomework(token), { homework: [] }),
      safeLoad(() => api.listAssessmentInsights(token), { topics: [] }),
      safeLoad(() => api.listResults(token), { results: [] }),
      safeLoad(() => api.listForecasts(token), { forecasts: [] }),
    ])
    setPayloads({ dashboard, students, fees, attendance, homework, insights, results, forecasts })
  }

  useEffect(() => {
    refresh().catch((err: any) => setError(err?.message || 'Unable to load dashboard data.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

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

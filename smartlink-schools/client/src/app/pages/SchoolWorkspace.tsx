import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SchoolActionModal, type SchoolActionKind } from '../components/SchoolActionModal'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { TeacherAssignmentsPanel } from '../components/TeacherAssignmentsPanel'
import { Toolbar } from '../components/Toolbar'
import { usePortal } from '../lib/portalContext'
import { schoolPages, type SchoolPageKey } from '../data/schoolPageConfig'

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

function statusLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function name(row: any) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || row.full_name || '-'
}

function actionForPage(pageKey: SchoolPageKey): SchoolActionKind {
  if (pageKey === 'classes') return 'class'
  if (pageKey === 'students') return 'student'
  if (pageKey === 'fees') return 'payment'
  if (pageKey === 'attendance') return 'attendance'
  if (pageKey === 'homework') return 'homework'
  if (pageKey === 'messages') return 'message'
  if (pageKey === 'examBuilder' || pageKey === 'results') return 'assessment'
  if (pageKey === 'assessmentInsights' || pageKey === 'dailyDrill' || pageKey === 'examForecast') return 'insights'
  return 'report'
}

function buildKpis(pageKey: SchoolPageKey, rows: any[]) {
  if (pageKey === 'classes') {
    const studentTotal = rows.reduce((sum, row) => sum + Number(row.rawStudentCount || 0), 0)
    return [
      { label: 'Classes', value: rows.length, helper: 'active setup', delta: 'database rows' },
      { label: 'Learners', value: studentTotal, helper: 'inside classes', delta: 'visible scope', tone: 'good' as const },
      { label: 'Assigned Teachers', value: rows.filter((row) => row.teacher !== 'Unassigned').length, helper: 'classes', delta: 'staff scope' },
      { label: 'Empty Classes', value: rows.filter((row) => Number(row.rawStudentCount || 0) === 0).length, helper: 'classes', delta: 'review' },
    ]
  }
  if (pageKey === 'fees') {
    const outstanding = rows.reduce((sum, row) => sum + Number(row.rawBalance || 0), 0)
    return [
      { label: 'Accounts', value: rows.length, helper: 'fee accounts', delta: 'live rows' },
      { label: 'Outstanding', value: money(outstanding), helper: 'database total', delta: 'review queue', tone: outstanding > 0 ? 'warn' as const : 'good' as const },
      { label: 'Paid', value: rows.filter((row) => row.status === 'paid').length, helper: 'accounts', delta: 'complete', tone: 'good' as const },
      { label: 'Partial', value: rows.filter((row) => row.status !== 'paid').length, helper: 'accounts', delta: 'follow up', tone: 'warn' as const },
    ]
  }
  if (pageKey === 'attendance') {
    const present = rows.filter((row) => row.status === 'present').length
    const marked = rows.filter((row) => row.status !== 'unmarked').length
    return [
      { label: 'Learners', value: rows.length, helper: 'visible scope', delta: 'live rows' },
      { label: 'Present', value: present, helper: 'today', delta: marked ? percent((present / marked) * 100) : '0.0%', tone: 'good' as const },
      { label: 'Late', value: rows.filter((row) => row.status === 'late').length, helper: 'today', delta: 'review', tone: 'warn' as const },
      { label: 'Absent', value: rows.filter((row) => row.status === 'absent').length, helper: 'today', delta: 'alert', tone: 'bad' as const },
    ]
  }
  if (pageKey === 'assessmentInsights') {
    return [
      { label: 'Topics', value: rows.length, helper: 'assessed topics', delta: 'live rows' },
      { label: 'Below 50%', value: rows.filter((row) => Number(row.rawAverage || 0) < 50).length, helper: 'topics', delta: 'support', tone: 'warn' as const },
      { label: 'Strong Topics', value: rows.filter((row) => Number(row.rawAverage || 0) >= 70).length, helper: 'topics', delta: 'maintain', tone: 'good' as const },
      { label: 'Support Learners', value: rows.reduce((sum, row) => sum + Number(row.rawSupport || 0), 0), helper: 'learners', delta: 'teacher queue' },
    ]
  }
  return [
    { label: 'Records', value: rows.length, helper: 'database rows', delta: 'live data' },
    { label: 'Visible Scope', value: rows.length ? 'Active' : 'Empty', helper: 'role based', delta: 'database' },
  ]
}

function mapRows(pageKey: SchoolPageKey, payload: any) {
  if (pageKey === 'classes') {
    return (payload?.classes || []).map((row: any) => ({
      id: row.id,
      className: row.name,
      gradeLevel: row.grade_level || '-',
      teacher: row.teacher_name || 'Unassigned',
      classTeacher: row.class_teacher || row.teacher_name || 'Unassigned',
      subjectTeachers: row.subject_assignment_summary || 'No subject teachers assigned',
      studentCount: Number(row.student_count || 0).toLocaleString(),
      rawStudentCount: Number(row.student_count || 0),
      students: row.student_names || (row.students || []).map((student: any) => [student.first_name, student.last_name].filter(Boolean).join(' ')).join(', ') || 'No students yet',
    }))
  }
  if (pageKey === 'students') {
    return (payload?.students || []).map((row: any) => ({
      id: row.id,
      student: name(row),
      className: row.class_name || '-',
      streamSection: row.stream_section || '-',
      admissionNo: row.admission_no,
      guardianPhone: row.guardian_phone || '-',
      feeBalance: money(row.fee_balance),
      status: row.status,
    }))
  }
  if (pageKey === 'fees') {
    return (payload?.feeAccounts || []).map((row: any) => ({
      id: row.id,
      student: name(row),
      className: row.class_name || '-',
      termName: row.term_name,
      balance: money(row.balance),
      rawBalance: Number(row.balance || 0),
      status: row.status,
    }))
  }
  if (pageKey === 'attendance') {
    return (payload?.attendance || []).map((row: any) => ({
      id: `${row.student_id}-${row.attendance_date || 'today'}`,
      student: name(row),
      className: row.class_name || '-',
      date: normalizeDate(row.attendance_date),
      status: row.status,
      note: row.note || '-',
    }))
  }
  if (pageKey === 'homework') {
    return (payload?.homework || []).map((row: any) => ({
      id: row.id,
      assignment: row.title,
      className: row.class_name,
      subject: row.subject_name,
      due: normalizeDate(row.due_date),
      status: row.status,
    }))
  }
  if (pageKey === 'messages') {
    return (payload?.messages || []).map((row: any) => ({
      id: row.id,
      subject: row.subject,
      type: row.message_type,
      audience: row.audience_label || (row.recipient_scope?.type === 'school' ? 'Whole school' : 'Selected classes'),
      responsible: row.recipient_scope?.responsible_teacher_name || '-',
      channel: row.channel,
      status: row.delivery_status,
      time: normalizeDate(row.created_at),
    }))
  }
  if (pageKey === 'parents') {
    return (payload?.parents || []).map((row: any) => ({
      id: row.id,
      parent: row.parent_name,
      student: [row.first_name, row.last_name].filter(Boolean).join(' '),
      className: row.class_name,
      phone: row.phone || row.email,
      relationship: row.relationship,
    }))
  }
  if (pageKey === 'results' || pageKey === 'examBuilder') {
    return (payload?.results || []).map((row: any) => ({
      id: row.id,
      assessment: row.assessment_name,
      examSession: row.exam_session_name || (row.assessment_type ? statusLabel(row.assessment_type) : '-'),
      className: row.class_name,
      subject: row.subject_name,
      termName: row.term_name,
      totalMarks: row.total_marks,
      average: percent(row.average_score),
      markedStudents: row.marked_students,
    }))
  }
  if (pageKey === 'assessmentInsights') {
    return (payload?.topics || []).map((row: any) => ({
      id: `${row.subject_name}-${row.topic_name}`,
      subject: row.subject_name,
      topic: row.topic_name,
      average: percent(row.average_score),
      rawAverage: Number(row.average_score || 0),
      support: row.students_needing_support,
      rawSupport: Number(row.students_needing_support || 0),
      recommendation: row.recommendation,
    }))
  }
  if (pageKey === 'dailyDrill') {
    return (payload?.drills || []).map((row: any) => ({
      id: row.id,
      student: name(row),
      className: row.class_name || '-',
      topic: row.topic_name,
      drill: row.prompt,
      status: row.status,
    }))
  }
  if (pageKey === 'examForecast') {
    return (payload?.forecasts || []).map((row: any) => ({
      id: `${row.exam_track}-${row.subject_name}-${row.topic_name}`,
      track: row.exam_track,
      subject: row.subject_name,
      topic: row.topic_name,
      score: Number(row.priority_score || 0).toFixed(1),
      action: Number(row.priority_score || 0) >= 70 ? 'Revise first' : 'Practice set',
    }))
  }
  if (pageKey === 'reports') {
    return (payload?.reports || []).map((row: any) => ({
      id: row.id,
      report: row.report,
      scope: row.scope,
      value: typeof row.value === 'number' ? row.value.toLocaleString() : row.value,
      status: row.status,
    }))
  }
  return []
}

function mapSearchRows(payload: any) {
  return (payload?.groups || []).flatMap((group: any) =>
    (group.results || []).map((row: any) => ({
      id: `${group.type}-${row.id}`,
      type: group.label || row.resultType || 'Result',
      title: row.title,
      detail: row.subtitle || row.matchedField || '-',
      className: row.className || '-',
      status: row.status || '-',
      route: row.route,
    })),
  )
}

async function loadPage(api: any, token: string, pageKey: SchoolPageKey) {
  if (pageKey === 'classes') return api.listClasses(token)
  if (pageKey === 'students') return api.listStudents(token)
  if (pageKey === 'fees') return api.listFeeAccounts(token)
  if (pageKey === 'attendance') return api.listAttendance(token)
  if (pageKey === 'homework') return api.listHomework(token)
  if (pageKey === 'messages') return api.listMessages(token)
  if (pageKey === 'parents') return api.listParents(token)
  if (pageKey === 'results' || pageKey === 'examBuilder') return api.listResults(token)
  if (pageKey === 'assessmentInsights') return api.listAssessmentInsights(token)
  if (pageKey === 'dailyDrill') return api.listDrills(token)
  if (pageKey === 'examForecast') return api.listForecasts(token)
  if (pageKey === 'reports') return api.listReports(token)
  return {}
}

export function SchoolWorkspace({ pageKey }: { pageKey: SchoolPageKey | 'search' }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const initialSearchQuery = searchParams.get('q') || ''
  const { token, api, user } = usePortal()
  const page = pageKey === 'search' ? null : schoolPages[pageKey]
  const [rows, setRows] = useState<any[]>([])
  const [searchRows, setSearchRows] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<SchoolActionKind>('filters')
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = async () => {
    if (!token || !page) return
    setLoading(true)
    setError('')
    try {
      const payload = await loadPage(api, token, pageKey as SchoolPageKey)
      setRows(mapRows(pageKey as SchoolPageKey, payload))
      if (payload?.setup_required) {
        setError(payload?.message || payload?.session?.message || 'Set up an active academic year and term to view current records.')
      }
    } catch (err: any) {
      setRows([])
      setError(err?.message || 'Unable to load school records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pageKey])

  useEffect(() => {
    if (pageKey !== 'search') return
    setQuery(initialSearchQuery)
  }, [initialSearchQuery, pageKey])

  useEffect(() => {
    if (pageKey !== 'search' || !token) return
    const value = query.trim()
    if (value.length < 2) {
      setSearchRows([])
      return
    }
    const controller = new AbortController()
    setSearchLoading(true)
    api.quickSearch(token, value, 20, controller.signal)
      .then((payload: any) => setSearchRows(mapSearchRows(payload)))
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setSearchRows([])
      })
      .finally(() => setSearchLoading(false))
    return () => controller.abort()
  }, [api, pageKey, query, token])

  const visibleRows = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return rows
    return rows.filter((row) => Object.values(row).some((field) => String(field || '').toLowerCase().includes(value)))
  }, [query, rows])

  const openAction = (nextAction: SchoolActionKind) => {
    setAction(nextAction)
    setModalOpen(true)
  }

  const openRow = (row: any) => {
    if (pageKey === 'students' && row.id) navigate(`/students/${row.id}`)
    else if (pageKey === 'classes' && row.id) navigate(`/classes/${row.id}`)
    else if (pageKey === 'search' && row.route) navigate(row.route, { state: { fromSearch: true, search: location.search } })
  }

  if (!page) {
    return (
      <div className="grid gap-3 p-4">
        <SectionCard title="School Search" subtitle="Search students, parents, classes, homework, results and messages">
          <div className="grid gap-3 p-4">
            <Toolbar>
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-9 text-[12px]" placeholder="Search school records..." />
              </div>
              <button type="button" onClick={() => openAction('filters')} className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[12px] font-semibold text-[#374151]">
                <SlidersHorizontal className="size-3.5" />
                Filters
              </button>
            </Toolbar>
            <PortalTable
              columns={[
                { key: 'type', label: 'Type' },
                { key: 'title', label: 'Record' },
                { key: 'detail', label: 'Detail' },
                { key: 'className', label: 'Class' },
                { key: 'status', label: 'Status' },
              ]}
              rows={searchRows}
              onRowClick={openRow}
              emptyMessage={query.trim().length < 2 ? 'Type at least two characters to search school records.' : searchLoading ? 'Searching database records...' : 'No matching school records found.'}
            />
          </div>
        </SectionCard>
        <SchoolActionModal open={modalOpen} action={action} onOpenChange={setModalOpen} />
      </div>
    )
  }

  const pageAction = actionForPage(pageKey as SchoolPageKey)
  const canUsePrimaryAction =
    pageKey !== 'classes' || ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{page.title}</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">{page.subtitle}</p>
          </div>
          {canUsePrimaryAction ? (
            <button type="button" onClick={() => openAction(pageAction)} className="inline-flex h-8 items-center gap-2 rounded-[5px] bg-[#111827] px-3 text-[12px] font-semibold text-white">
              <Plus className="size-3.5" />
              {page.action}
            </button>
          ) : null}
        </div>
      </section>

      <SectionKpiStrip items={buildKpis(pageKey as SchoolPageKey, rows)} />

      <Toolbar>
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder={`Search ${page.title.toLowerCase()}...`} />
        </div>
        <button type="button" onClick={() => openAction('filters')} className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[12px] font-semibold text-[#374151]">
          <SlidersHorizontal className="size-3.5" />
          Filters
        </button>
      </Toolbar>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard title={`${page.title} Register`} subtitle={loading ? 'Loading database records...' : `${visibleRows.length} database records represented`}>
          <PortalTable columns={page.columns} rows={visibleRows} onRowClick={pageKey === 'students' || pageKey === 'classes' ? openRow : undefined} emptyMessage={loading ? 'Loading records...' : 'No database records available.'} />
        </SectionCard>

        <SectionCard title={page.sideTitle} subtitle="School-only operational prompts">
          <div className="grid gap-2 p-4">
            {page.sideItems.map((item) => (
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
      </div>

      {pageKey === 'classes' ? <TeacherAssignmentsPanel onChanged={refresh} /> : null}

      <SchoolActionModal open={modalOpen} action={action} onOpenChange={setModalOpen} onSaved={refresh} />
    </div>
  )
}

import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { BookOpenCheck, CalendarCheck, GraduationCap, KeyRound, LayoutDashboard, RefreshCcw, ReceiptText } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PageHeader } from './components/PageHeader'
import { LoginScreen } from './components/LoginScreen'
import { ActionLoadingOverlay } from './components/ActionLoadingOverlay'
import { SmartLinkLoadingState } from './components/SmartLinkLoadingState'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Toaster } from './components/ui/sonner'
import { canAccessPath, firstAccessiblePath } from './lib/access'
import { PortalProvider, usePortal } from './lib/portalContext'
import { routePacketKeys } from './lib/packetRegistry'
import { SchoolDashboard } from './pages/SchoolDashboard'
import { SchoolWorkspace } from './pages/SchoolWorkspace'
import { SettingsCenter } from './pages/SettingsCenter'
import { StudentPortalPage } from './pages/StudentPortalPage'
import { StudentProfilePage } from './pages/StudentProfilePage'
import { AcademicSessionPage, AcademicTermDetailPage, AcademicTermResultsPage, TermCloseChecksPage, TermProgressionPage } from './pages/AcademicSessionPage'
import { ClassDetailPage } from './pages/ClassDetailPage'
import { ExamSessionsPage } from './pages/ExamSessionsPage'
import { ExamPaperDocumentPage } from './pages/ExamPaperDocumentPage'
import { ExamPaperStudioPage } from './pages/ExamPaperStudioPage'
import { SchoolCalendarPage } from './pages/SchoolCalendarPage'
import { ResultsEntryPage } from './pages/ResultsEntryPage'
import { SearchResultsPage } from './pages/SearchResults'
import { TeacherProfilePage } from './pages/TeacherProfilePage'
import { TeachersPage } from './pages/TeachersPage'
import { SyllabusIntelligencePage } from './pages/SyllabusIntelligencePage'
import { SyllabusComposerPage } from './pages/SyllabusComposerPage'
import { QuestionBatchEditorPage } from './pages/QuestionBatchEditorPage'
import { QuestionBankPage } from './pages/QuestionBankPage'
import { TeacherLessonLogPage } from './pages/TeacherLessonLogPage'
import { TimetablingPage } from './pages/TimetablingPage'
import { SchedulingSettingsPage } from './pages/SchedulingSettingsPage'
import { PublicLandingPage } from './pages/PublicLandingPage'

const routeMeta = [
  { path: '/dashboard', title: 'School Dashboard', subtitle: 'Students, fees, attendance and academic progress' },
  { path: '/student-portal', title: 'Student Portal', subtitle: 'Results, fees, timetable, homework, attendance and notices' },
  { path: '/search', title: 'School Search', subtitle: 'Search students, parents, classes, homework and results' },
  { path: '/academic-sessions', title: 'Academic Sessions', subtitle: 'Academic years, terms, closures and progression' },
  { path: '/teachers', title: 'Teachers', subtitle: 'Teacher profiles, workload and class-subject assignments' },
  { path: '/teachers/', title: 'Teacher Profile', subtitle: 'Teacher identity, profile and workload' },
  { path: '/classes', title: 'Classes', subtitle: 'Class setup, teachers and students inside each class' },
  { path: '/classes/', title: 'Class Detail', subtitle: 'Class teacher, subject teachers and students' },
  { path: '/students', title: 'Students', subtitle: 'Student registry, guardians and learner support' },
  { path: '/students/', title: 'Student Profile', subtitle: 'Student identity, guardians, class and fee profile' },
  { path: '/parents', title: 'Parents', subtitle: 'Guardian contacts and communication preferences' },
  { path: '/calendar', title: 'School Calendar', subtitle: 'Events, recurring assessments and term timeline' },
  { path: '/fees', title: 'Fees', subtitle: 'Payments, balances, receipts and reminders' },
  { path: '/attendance', title: 'Attendance', subtitle: 'Daily registers, absence alerts and class trends' },
  { path: '/homework', title: 'Homework', subtitle: 'Assignments, due dates and reminders' },
  { path: '/exam-sessions', title: 'Exam Sessions', subtitle: 'End-of-term exam sessions, papers, timetables and report cards' },
  { path: '/timetables', title: 'Timetables', subtitle: 'School timetable setup, versions, conflicts and publication' },
  { path: '/exam-timetables', title: 'Exam Timetables', subtitle: 'Exam scheduling, rooms, invigilation and publication' },
  { path: '/my-timetable', title: 'My Timetable', subtitle: 'Published lessons and changes' },
  { path: '/my-exams', title: 'My Exams', subtitle: 'Published examination schedule' },
  { path: '/my-invigilation', title: 'My Invigilation', subtitle: 'Assigned invigilation duties' },
  { path: '/results', title: 'Results', subtitle: 'Marks entry, report cards and academic review' },
  { path: '/assessment-insights', title: 'Assessment Insights', subtitle: 'Weak-topic analysis and learner support' },
  { path: '/teacher/lesson-log', title: 'Teacher Lesson Log', subtitle: 'Actual teaching coverage, drafts and Daily Drill generation' },
  { path: '/syllabus', title: 'Syllabus Intelligence', subtitle: 'Uploads, topic maps, question bank and drills' },
  { path: '/questions/bank', title: 'Question Bank', subtitle: 'Questions, answers and explanations' },
  { path: '/questions/batches/', title: 'AI Draft Batch', subtitle: 'Review generated questions and explanations' },
  { path: '/exam-builder', title: 'Assessment Builder', subtitle: 'Exam topics, marks and difficulty review' },
  { path: '/daily-drill', title: 'Daily Drill', subtitle: 'Personalized practice from weak topics' },
  { path: '/exam-forecast', title: 'Exam Forecast', subtitle: 'Topic priority for exam preparation' },
  { path: '/messages', title: 'Messages', subtitle: 'Parent and staff communication' },
  { path: '/reports', title: 'Reports', subtitle: 'Academic, attendance and finance summaries' },
  { path: '/settings/features', title: 'Feature Assignment', subtitle: 'Enable timetable modules for this school' },
  { path: '/settings/academic-configuration', title: 'Academic Configuration', subtitle: 'Years, terms, teaching days and bell schedules' },
  { path: '/settings/facilities', title: 'Facilities and Resources', subtitle: 'Rooms, shared equipment and reservable school spaces' },
  { path: '/settings/laboratories', title: 'Laboratories', subtitle: 'Practical rooms, subject support and exam readiness' },
  { path: '/settings/weekly-activities', title: 'Weekly Activities', subtitle: 'Assembly, chapel, clubs, tests and recurring school events' },
  { path: '/settings/timetable-rules', title: 'Timetable Rules', subtitle: 'Scheduling rules, occupancy and exam resource controls' },
  { path: '/settings', title: 'Settings', subtitle: 'School workspace preferences and controls' },
] as const

function resolveMeta(pathname: string) {
  return (
    routeMeta
      .slice()
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => pathname.startsWith(item.path)) || { title: 'SmartLink Schools', subtitle: '' }
  )
}

function NoAccessState({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--mera-panel-muted)] p-6">
      <div className="w-full max-w-xl rounded-[8px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-8 shadow-sm">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--mera-panel-text)]">School access is not ready yet</h1>
        <p className="mt-3 text-[13px] leading-6 text-[var(--mera-panel-text-muted)]">
          This account is signed in, but no SmartLink Schools workspace was found for it. Sign out and use a school administrator account, or ask the system administrator to link this user to a school.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex h-9 items-center rounded-[5px] bg-[var(--primary)] px-4 text-[12px] font-semibold text-[var(--primary-foreground)] hover:opacity-90"
          onClick={onLogout}
        >
          Sign out
        </button>
      </div>
    </main>
  )
}

function ForcePasswordChange({
  user,
  loading,
  error,
  onChangePassword,
  onLogout,
}: {
  user: any
  loading: boolean
  error: string
  onChangePassword: (payload: { current_password: string; new_password: string; confirm_password: string }) => Promise<any> | void
  onLogout: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    if (newPassword !== confirmPassword) {
      setLocalError('New passwords do not match.')
      return
    }
    try {
      await onChangePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
    } catch {
      // The shared login error state renders the API message in this form.
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f4f6] px-4 py-8 text-[#111827]">
      <section className="w-full max-w-[420px] rounded-[8px] border border-[#d9dce3] bg-white p-6 shadow-sm">
        <div className="grid gap-3">
          <span className="grid size-10 place-items-center rounded-[7px] bg-[#111827] text-white">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.04em] text-[#111827]">Change temporary password</h1>
            <p className="mt-1 text-[12px] font-medium leading-5 text-[#6b7280]">
              {user?.fullName || user?.email || 'This account'} must set a private password before opening SmartLink Schools.
            </p>
          </div>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Temporary password
            <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="h-9 text-[13px]" required />
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            New password
            <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="h-9 text-[13px]" required />
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Confirm new password
            <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-9 text-[13px]" required />
          </label>

          <div className="rounded-[6px] border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-[11px] leading-5 text-[#4b5563]">
            Use at least 8 characters with uppercase, lowercase, a number and a symbol.
          </div>

          {localError || error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{localError || error}</div> : null}

          <Button type="submit" disabled={loading || !currentPassword || !newPassword || !confirmPassword} className="h-9 rounded-[5px] text-[12px]">
            {loading ? 'Changing password...' : 'Change password'}
          </Button>
          <button type="button" onClick={onLogout} className="justify-self-center text-[12px] font-semibold text-[#6b7280] hover:text-[#111827]">
            Sign out
          </button>
        </form>
      </section>
    </main>
  )
}

const dashboardTabs = [
  { id: 'my-view', label: 'My View', icon: LayoutDashboard },
  { id: 'school-overview', label: 'School Overview', icon: GraduationCap },
  { id: 'finance', label: 'Finance', icon: ReceiptText },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'learning', label: 'Learning', icon: BookOpenCheck },
]

function dashboardSyncLabel(value?: string) {
  if (!value) return 'Local school data'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Updated now'
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'Updated now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.round(hours / 24)}d ago`
}

function DashboardViewStrip() {
  const { refreshVisibleModules, user } = usePortal()
  const location = useLocation()
  const navigate = useNavigate()
  const activeView = new URLSearchParams(location.search).get('view') || 'my-view'
  const visibleTabs = dashboardTabs.filter((tab) => tab.id !== 'finance' || canAccessPath(user, '/fees'))

  const openView = (viewId: string) => {
    const params = new URLSearchParams(location.search)
    if (viewId === 'my-view') params.delete('view')
    else params.set('view', viewId)
    navigate({ pathname: '/dashboard', search: params.toString() ? `?${params.toString()}` : '' }, { replace: true })
  }

  return (
    <div className="flex h-11 min-h-11 w-full shrink-0 items-center overflow-hidden border-b border-[#dbe3ee] bg-white text-[#111827]">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <div className="flex min-w-max items-stretch gap-1 px-4">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon
            const active = activeView === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => openView(tab.id)}
                className={`relative flex h-11 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-3.5 text-[13px] font-semibold transition ${
                  active
                    ? 'border-[#111827] bg-[#f3f4f6] text-[#030712]'
                    : 'border-transparent text-[#4b5563] hover:bg-[#f9fafb] hover:text-[#111827]'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1.5 bg-white px-3">
        <span className="hidden items-center gap-1 text-[11px] font-medium text-[#9ca3af] lg:inline-flex">
          <span className="size-1.5 rounded-full bg-[#10b981]" />
          {dashboardSyncLabel()}
        </span>
        <button
          type="button"
          onClick={() => refreshVisibleModules({ force: true, preferHttp: true, timeoutMs: 4500, reason: 'school-dashboard-sync' })}
          className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]"
          aria-label="Refresh school dashboard"
        >
          <RefreshCcw className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function SchoolRoutes({ landingPath }: { landingPath: string }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={landingPath} replace />} />
      <Route path="/student-portal" element={<StudentPortalPage />} />
      <Route path="/dashboard" element={<SchoolDashboard />} />
      <Route path="/search" element={<SearchResultsPage />} />
      <Route path="/academic-sessions" element={<AcademicSessionPage />} />
      <Route path="/academic-sessions/terms/:termId" element={<AcademicTermDetailPage />} />
      <Route path="/academic-sessions/terms/:termId/results" element={<AcademicTermResultsPage />} />
      <Route path="/academic-sessions/terms/:termId/close" element={<TermCloseChecksPage />} />
      <Route path="/academic-sessions/terms/:termId/progression" element={<TermProgressionPage />} />
      <Route path="/teachers" element={<TeachersPage />} />
      <Route path="/teachers/:teacherId" element={<TeacherProfilePage />} />
      <Route path="/classes" element={<SchoolWorkspace pageKey="classes" />} />
      <Route path="/classes/:classId" element={<ClassDetailPage />} />
      <Route path="/students" element={<SchoolWorkspace pageKey="students" />} />
      <Route path="/students/:studentId" element={<StudentProfilePage />} />
      <Route path="/parents" element={<SchoolWorkspace pageKey="parents" />} />
      <Route path="/calendar" element={<SchoolCalendarPage />} />
      <Route path="/fees" element={<SchoolWorkspace pageKey="fees" />} />
      <Route path="/attendance" element={<SchoolWorkspace pageKey="attendance" />} />
      <Route path="/homework" element={<SchoolWorkspace pageKey="homework" />} />
      <Route path="/exam-sessions" element={<ExamSessionsPage />} />
      <Route path="/timetables" element={<TimetablingPage />} />
      <Route path="/timetables/new" element={<TimetablingPage />} />
      <Route path="/timetables/:id/setup" element={<TimetablingPage />} />
      <Route path="/timetables/:id/versions" element={<TimetablingPage />} />
      <Route path="/timetables/:id/versions/:versionId" element={<TimetablingPage />} />
      <Route path="/timetables/:id/versions/:versionId/edit" element={<TimetablingPage />} />
      <Route path="/exam-timetables" element={<TimetablingPage />} />
      <Route path="/exam-timetables/new" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/setup" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/clashes" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/versions" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/versions/:versionId" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/versions/:versionId/edit" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/rooms" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/invigilators" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/seating" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/review" element={<TimetablingPage />} />
      <Route path="/exam-timetables/:id/reports" element={<TimetablingPage />} />
      <Route path="/my-timetable" element={<TimetablingPage personal />} />
      <Route path="/my-exams" element={<TimetablingPage personal />} />
      <Route path="/my-invigilation" element={<TimetablingPage personal />} />
      <Route path="/results" element={<ResultsEntryPage />} />
      <Route path="/results/:assessmentId" element={<ResultsEntryPage />} />
      <Route path="/assessment-insights" element={<SchoolWorkspace pageKey="assessmentInsights" />} />
      <Route path="/teacher/lesson-log" element={<TeacherLessonLogPage />} />
      <Route path="/teacher/lesson-log/new" element={<TeacherLessonLogPage />} />
      <Route path="/teacher/lesson-log/:lessonLogId" element={<TeacherLessonLogPage />} />
      <Route path="/teacher/lesson-log/:lessonLogId/edit" element={<TeacherLessonLogPage />} />
      <Route path="/teacher/classes/:classId/lesson-history" element={<TeacherLessonLogPage />} />
      <Route path="/teacher/classes/:classId/subjects/:subjectId/coverage" element={<TeacherLessonLogPage />} />
      <Route path="/syllabus" element={<SyllabusIntelligencePage />} />
      <Route path="/syllabus/create" element={<SyllabusComposerPage />} />
      <Route path="/syllabus/create/:entryId" element={<SyllabusComposerPage />} />
      <Route path="/questions/bank" element={<QuestionBankPage />} />
      <Route path="/questions/batches/:batchId" element={<QuestionBatchEditorPage />} />
      <Route path="/exam-builder" element={<ExamPaperStudioPage />} />
      <Route path="/exam-builder/new" element={<ExamPaperDocumentPage />} />
      <Route path="/exam-builder/:assessmentId" element={<ExamPaperDocumentPage />} />
      <Route path="/daily-drill" element={<SyllabusIntelligencePage />} />
      <Route path="/exam-forecast" element={<SchoolWorkspace pageKey="examForecast" />} />
      <Route path="/messages" element={<SchoolWorkspace pageKey="messages" />} />
      <Route path="/reports" element={<SchoolWorkspace pageKey="reports" />} />
      <Route path="/settings" element={<Navigate to="/settings/preferences" replace />} />
      <Route path="/settings/preferences" element={<SettingsCenter section="preferences" />} />
      <Route path="/settings/notifications" element={<SettingsCenter section="notifications" />} />
      <Route path="/settings/security" element={<SettingsCenter section="security" />} />
      <Route path="/settings/profile" element={<SettingsCenter section="profile" />} />
      <Route path="/settings/users" element={<SettingsCenter section="users" />} />
      <Route path="/settings/audit" element={<SettingsCenter section="audit" />} />
      <Route path="/settings/organization" element={<SettingsCenter section="organization" />} />
      <Route path="/settings/features" element={<SettingsCenter section="features" />} />
      <Route path="/settings/academic-configuration" element={<SchedulingSettingsPage section="academic-configuration" />} />
      <Route path="/settings/facilities" element={<SchedulingSettingsPage section="facilities" />} />
      <Route path="/settings/laboratories" element={<SchedulingSettingsPage section="laboratories" />} />
      <Route path="/settings/weekly-activities" element={<SchedulingSettingsPage section="weekly-activities" />} />
      <Route path="/settings/timetable-rules" element={<SchedulingSettingsPage section="timetable-rules" />} />
      <Route path="/settings/integrations" element={<SettingsCenter section="integrations" />} />
      <Route path="/settings/data" element={<SettingsCenter section="data" />} />

      <Route path="*" element={<Navigate to={landingPath} replace />} />
    </Routes>
  )
}

function routePacketLoading(pathname: string, data: any, packetStatus: Record<string, string>) {
  const keys = routePacketKeys(pathname)
  const missing = keys.some((key) => packetStatus[key] === 'loading' && !Object.prototype.hasOwnProperty.call(data || {}, key))
  const refreshing = keys.some((key) => packetStatus[key] === 'loading')
  return { missing, refreshing }
}

function RouteDataActivity({ active }: { active: boolean }) {
  return (
    <div
      className={`absolute inset-0 z-30 grid place-items-center bg-white/75 p-4 backdrop-blur-[1px] transition-all duration-300 ease-out ${
        active ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
      }`}
    >
      <SmartLinkLoadingState variant="inline" label="Loading page data" detail="Preparing the latest school records." />
    </div>
  )
}

function PortalShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    session,
    user,
    login,
    verifyLoginCode,
    resendLoginCode,
    cancelLoginChallenge,
    pendingLoginChallenge,
    loginSuccessGate,
    loginPreloadSettled,
    finishLoginSuccessGate,
    logout,
    changePassword,
    bootLoading,
    loginError,
    loading,
    actionLoading,
    actionLabel,
    requestRoutePackets,
    packetStatus,
    data,
    preferences,
  } = usePortal()
  const activeMeta = resolveMeta(location.pathname)
  const landingPreferencePaths: Record<string, string> = {
    dashboard: '/dashboard',
    schoolOverview: '/dashboard',
    students: '/students',
    parents: '/parents',
    classes: '/classes',
    teachers: '/teachers',
    academicSessions: '/academic-sessions',
    calendar: '/calendar',
    fees: '/fees',
    attendance: '/attendance',
    homework: '/homework',
    examSessions: '/exam-sessions',
    results: '/results',
    assessmentInsights: '/assessment-insights',
    reports: '/reports',
    users: '/settings/users',
    profile: '/settings/profile',
  }
  const preferredLandingPath = landingPreferencePaths[String(preferences?.landingPage || 'dashboard')] || '/dashboard'
  const landingPath = canAccessPath(user, preferredLandingPath) ? preferredLandingPath : (firstAccessiblePath(user) || '/dashboard')
  const routeLoading = routePacketLoading(location.pathname, data, packetStatus)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const density = String(preferences?.density || 'comfortable') === 'compact' ? 'compact' : 'comfortable'
    document.documentElement.dataset.meraDensity = density
  }, [preferences?.density])

  useEffect(() => {
    if (!session?.accessToken || loginSuccessGate || user?.mustChangePassword) return
    requestRoutePackets(location.pathname, { reason: 'school-route-visible-packets' })
  }, [location.pathname, loginSuccessGate, requestRoutePackets, session?.accessToken, user?.mustChangePassword])

  if (!session?.accessToken || loginSuccessGate) {
    return (
      <LoginScreen
        onLogin={login}
        onVerifyCode={verifyLoginCode}
        onResendCode={resendLoginCode}
        onCancelCode={cancelLoginChallenge}
        pendingChallenge={pendingLoginChallenge}
        successGate={loginSuccessGate}
        successLoading={!loginPreloadSettled}
        onSuccessAnimationComplete={() => {
          finishLoginSuccessGate()
          navigate(landingPath, { replace: true })
        }}
        loading={loginSuccessGate ? !loginPreloadSettled : bootLoading}
        error={loginError}
      />
    )
  }

  if (user?.mustChangePassword) {
    return (
      <ForcePasswordChange
        user={user}
        loading={bootLoading}
        error={loginError}
        onChangePassword={changePassword}
        onLogout={logout}
      />
    )
  }

  if (!landingPath) {
    return <NoAccessState onLogout={logout} />
  }

  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to={landingPath} replace />
  }

  const isStudentApp = String(user?.role || '').toLowerCase() === 'student'
  if (isStudentApp) {
    return (
      <div className="h-screen overflow-hidden bg-[#F4F5F2] text-[#20201d]">
        <ActionLoadingOverlay visible={actionLoading} label={actionLabel} />
        <main className="h-full overflow-y-auto overscroll-contain">
          <SchoolRoutes landingPath={landingPath} />
        </main>
      </div>
    )
  }

  const isDashboardRoute = location.pathname === '/dashboard'
  const isExamPaperDocumentRoute = /^\/exam-builder\/(new|[^/]+)$/.test(location.pathname)
  const isSyllabusComposerRoute = /^\/syllabus\/create(\/[^/]+)?$/.test(location.pathname)
  const isQuestionBatchEditorRoute = /^\/questions\/batches\/[^/]+$/.test(location.pathname)
  const isQuestionBankRoute = location.pathname === '/questions/bank'
  const isResultsSheetRoute = /^\/results\/[^/]+$/.test(location.pathname)
  const syncCurrentPage = () => requestRoutePackets(location.pathname, { force: true, primaryOnly: true, preferHttp: true, timeoutMs: 4500, reason: 'school-topbar-sync' })

  if (isExamPaperDocumentRoute || isSyllabusComposerRoute || isQuestionBatchEditorRoute || isQuestionBankRoute || isResultsSheetRoute) {
    return (
      <div className={`h-screen bg-[#eef1f5] text-[#111827] ${isResultsSheetRoute ? 'overflow-y-auto overflow-x-hidden overscroll-contain' : 'overflow-hidden'}`}>
        <ActionLoadingOverlay visible={actionLoading} label={actionLabel} />
        <SchoolRoutes landingPath={landingPath} />
      </div>
    )
  }

  return (
    <div className="mera-app-root flex h-screen flex-col overflow-hidden text-[var(--mera-text)]">
      <ActionLoadingOverlay visible={actionLoading} label={actionLabel} />
      <PageHeader
        title={activeMeta.title}
        subtitle={activeMeta.subtitle}
        user={user}
        loading={loading}
        showSync={!isDashboardRoute}
        syncLoading={routeLoading.missing || routeLoading.refreshing}
        onSync={syncCurrentPage}
        onLogout={logout}
      />
      {isDashboardRoute ? <DashboardViewStrip /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
        <Sidebar user={user} />
        <main className="smartlink-shell-scroll relative min-w-0 flex-1 overflow-y-scroll overflow-x-hidden">
          <RouteDataActivity active={routeLoading.missing} />
          <div className={`min-h-full transition-[opacity,transform] duration-300 ease-out ${routeLoading.missing ? 'opacity-[0.96]' : 'opacity-100'}`}>
            <SchoolRoutes landingPath={landingPath} />
          </div>
        </main>
      </div>
    </div>
  )
}

function publicPortalUrl() {
  if (typeof window === 'undefined') return 'https://portal.publicurl.com'
  const protocol = window.location.protocol || 'https:'
  const hostname = window.location.hostname.toLowerCase()
  if (hostname === 'publicurl.com' || hostname === 'www.publicurl.com') return `${protocol}//portal.publicurl.com`
  if (hostname === 'portal.publicurl.com') return `${protocol}//portal.publicurl.com`
  return '/'
}

function shouldRenderPublicSite() {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname.toLowerCase()
  const publicHosts = new Set(['publicurl.com', 'www.publicurl.com'])
  const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0'])
  if (publicHosts.has(hostname)) return true
  return localHosts.has(hostname) && window.location.pathname.startsWith('/public')
}

export default function App() {
  if (shouldRenderPublicSite()) {
    return (
      <>
        <PublicLandingPage portalUrl={publicPortalUrl()} />
        <Toaster />
      </>
    )
  }

  return (
    <PortalProvider>
      <BrowserRouter>
        <PortalShell />
        <Toaster />
      </BrowserRouter>
    </PortalProvider>
  )
}

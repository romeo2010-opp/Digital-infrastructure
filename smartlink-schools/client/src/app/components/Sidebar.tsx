import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Banknote,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarCheck,
  CalendarRange,
  FlaskConical,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBarChart,
  FileText,
  Globe2,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  Landmark,
  Lock,
  MessageSquare,
  Palette,
  PlugZap,
  Printer,
  ReceiptText,
  ScrollText,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { canAccessPath } from '../lib/access'
import { usePortal } from '../lib/portalContext'

const sidebarStorageKey = 'schoolsSidebarCollapsed'

const dashboardItem = {
  label: 'Dashboard',
  path: '/dashboard',
  icon: LayoutDashboard,
}

const studentPortalItem = {
  label: 'My Portal',
  path: '/student-portal',
  icon: GraduationCap,
}

const parentProgressItem = {
  label: 'Child Progress',
  path: '/parent-insights',
  icon: HeartHandshake,
}

const financeItem = {
  label: 'Finance',
  path: '/fees/dashboard',
  icon: ReceiptText,
}

const bursarGroups = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/fees/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Student Accounts', path: '/fees/accounts', icon: WalletCards },
      { label: 'Invoices', path: '/fees/invoices', icon: FileText },
      { label: 'Payments', path: '/fees/payments', icon: Banknote },
      { label: 'Receipts', path: '/fees/receipts', icon: ReceiptText },
      { label: 'Arrears', path: '/fees/arrears', icon: AlertTriangle },
      { label: 'Payment Plans', path: '/fees/payment-plans', icon: CalendarClock },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Fee Structures', path: '/fees/fee-structures', icon: Database },
      { label: 'Discounts & Waivers', path: '/fees/discounts', icon: ShieldCheck },
      { label: 'Expenses', path: '/fees/expenses', icon: Banknote },
      { label: 'Suppliers', path: '/fees/suppliers', icon: Users },
    ],
  },
  {
    label: 'Reconciliation',
    items: [
      { label: 'Bank Reconciliation', path: '/fees/reconciliation', icon: Landmark },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Reports', path: '/fees/reports', icon: FileBarChart },
      { label: 'Finance Settings', path: '/fees/settings', icon: Settings },
    ],
  },
] as const

const directorOverviewItem = {
  label: 'Overview',
  path: '/overview',
  icon: LayoutDashboard,
}

const directorGroups = [
  {
    label: 'Finance',
    icon: ReceiptText,
    items: [
      { label: 'Fee Collection', path: '/finance/fee-collection', icon: Banknote },
      { label: 'Outstanding Balances', path: '/finance/outstanding-balances', icon: AlertTriangle },
      { label: 'Discounts & Bursaries', path: '/finance/discounts-bursaries', icon: ShieldCheck },
      { label: 'Expenses', path: '/finance/expenses', icon: Banknote },
      { label: 'Payroll', path: '/finance/payroll', icon: WalletCards },
      { label: 'Financial Reports', path: '/finance/financial-reports', icon: FileBarChart },
    ],
  },
  {
    label: 'Admissions',
    icon: Users,
    items: [
      { label: 'Enrollment Pipeline', path: '/admissions/enrollment-pipeline', icon: GraduationCap },
      { label: 'Class Capacity', path: '/admissions/class-capacity', icon: Users },
      { label: 'Withdrawals', path: '/admissions/withdrawals', icon: UserCircle2 },
    ],
  },
  {
    label: 'Academics',
    icon: BookOpenCheck,
    items: [
      { label: 'Performance Overview', path: '/academics/performance-overview', icon: BarChart3 },
      { label: 'At-Risk Students', path: '/academics/at-risk-students', icon: AlertTriangle },
      { label: 'Subject Trends', path: '/academics/subject-trends', icon: FileBarChart },
      { label: 'Marks Submission', path: '/academics/marks-submission', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Staff',
    icon: UserRound,
    items: [
      { label: 'Teacher Compliance', path: '/staff/teacher-compliance', icon: ShieldCheck },
      { label: 'Attendance', path: '/staff/attendance', icon: CalendarCheck },
      { label: 'Workload', path: '/staff/workload', icon: ClipboardList },
      { label: 'Leave', path: '/staff/leave', icon: CalendarRange },
    ],
  },
  {
    label: 'Operations',
    icon: ClipboardList,
    items: [
      { label: 'Incidents', path: '/operations/incidents', icon: AlertTriangle },
      { label: 'Complaints', path: '/operations/complaints', icon: MessageSquare },
      { label: 'Approvals', path: '/operations/approvals', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Reports',
    icon: FileBarChart,
    items: [
      { label: 'Director Report', path: '/reports/director-report', icon: FileText },
      { label: 'Term Report', path: '/reports/term-report', icon: ScrollText },
      { label: 'Export Center', path: '/reports/export-center', icon: Database },
    ],
  },
] as const

const groups = [
  {
    label: 'School Operations',
    items: [
      { label: 'My Follow-Ups', path: '/tasks', icon: ClipboardList },
      { label: 'Classes', path: '/classes', icon: Users },
      { label: 'Students', path: '/students', icon: GraduationCap },
      { label: 'Teachers', path: '/teachers', icon: UserRound },
      { label: 'Parents', path: '/parents', icon: Users },
      { label: 'Academic Sessions', path: '/academic-sessions', icon: CalendarClock },
      { label: 'School Calendar', path: '/calendar', icon: CalendarDays },
      { label: 'Attendance', path: '/attendance', icon: CalendarCheck },
      { label: 'Fees', path: '/fees', icon: ReceiptText },
    ],
  },
  {
    label: 'Teaching & Learning',
    items: [
      { label: 'Classroom Mode', path: '/classroom', icon: BookOpenCheck },
      { label: 'Academic Intelligence', path: '/academic-intelligence', icon: Sparkles, badge: 'Live' },
      { label: 'Homework', path: '/homework', icon: BookOpenCheck },
      { label: 'Lesson Log', path: '/teacher/lesson-log', icon: ClipboardList },
      { label: 'Timetables', path: '/timetables', icon: CalendarRange },
      { label: 'Exam Timetables', path: '/exam-timetables', icon: CalendarDays },
      { label: 'Exam Sessions', path: '/exam-sessions', icon: ClipboardList },
      { label: 'Results', path: '/results', icon: ClipboardCheck },
      { label: 'Assessment Insights', path: '/assessment-insights', icon: Sparkles, badge: 'AI' },
      { label: 'Syllabus Intelligence', path: '/syllabus', icon: Sparkles, badge: 'AI' },
      { label: 'Assessment Builder', path: '/exam-builder', icon: ClipboardCheck },
      { label: 'Daily Drill', path: '/daily-drill', icon: BookOpenCheck },
      { label: 'Exam Forecast', path: '/exam-forecast', icon: BarChart3 },
      { label: 'Exam Intelligence', path: '/exam-intelligence', icon: FlaskConical, badge: 'Soon' },
    ],
  },
  {
    label: 'Library & Resources',
    items: [
      { label: 'Library Dashboard', path: '/library/dashboard', icon: LayoutDashboard },
      { label: 'Physical Catalogue', path: '/library/catalogue', icon: BookOpenCheck },
      { label: 'Loans & Returns', path: '/library/loans', icon: ClipboardCheck },
      { label: 'Library Computers', path: '/library/computers', icon: Database },
      { label: 'Teaching Resources', path: '/library/resources', icon: FileText },
      { label: 'Resource Review', path: '/library/resources/review', icon: ShieldCheck },
      { label: 'Resource Requests', path: '/library/resource-requests', icon: ClipboardCheck },
      { label: 'Institutional Archive', path: '/library/archive', icon: Database },
      { label: 'Print Requests', path: '/library/print-requests', icon: Printer },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Messages', path: '/messages', icon: MessageSquare },
      { label: 'Reports', path: '/reports', icon: FileBarChart },
    ],
  },
] as const

const settingsGroups = [
  {
    label: 'My Account',
    items: [
      { label: 'Profile', path: '/settings/profile', icon: UserCircle2 },
      { label: 'Preferences', path: '/settings/preferences', icon: Palette },
      { label: 'Personalized', path: '/settings/personalized', icon: Palette },
      { label: 'Notifications', path: '/settings/notifications', icon: Bell },
    ],
  },
  {
    label: 'School Security',
    items: [
      { label: 'Security', path: '/settings/security', icon: Lock },
      { label: 'Audit Logs', path: '/settings/audit', icon: ScrollText },
    ],
  },
  {
    label: 'School Team',
    items: [
      { label: 'Users & Roles', path: '/settings/users', icon: Users },
    ],
  },
  {
    label: 'School Setup',
    items: [
      { label: 'School Profile', path: '/settings/organization', icon: Globe2 },
      { label: 'Features', path: '/settings/features', icon: CalendarRange },
      { label: 'Academic Config', path: '/settings/academic-configuration', icon: CalendarClock },
      { label: 'Facilities', path: '/settings/facilities', icon: Building2 },
      { label: 'Laboratories', path: '/settings/laboratories', icon: FlaskConical },
      { label: 'Weekly Activities', path: '/settings/weekly-activities', icon: ClipboardList },
      { label: 'Timetable Rules', path: '/settings/timetable-rules', icon: Settings2 },
      { label: 'Integrations', path: '/settings/integrations', icon: PlugZap },
      { label: 'Data Controls', path: '/settings/data', icon: Database },
    ],
  },
] as const

function Badge({ value, collapsed }: { value: string; collapsed?: boolean }) {
  return (
    <span
      className={
        collapsed
          ? 'absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7c3aed] px-1 text-[8px] font-bold leading-none text-white'
          : 'ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7c3aed] px-1.5 text-[9px] font-bold leading-none text-white'
      }
    >
      {value}
    </span>
  )
}

function initialsFor(user: any) {
  const name = user?.fullName || user?.full_name || user?.email || 'School Administrator'
  return String(name)
    .split(/[.@_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function displayNameFor(user: any) {
  return user?.fullName || user?.full_name || user?.name || user?.email || 'Mr. Banda'
}

function roleNameFor(user: any) {
  return user?.roleDisplayName || user?.role_display_name || user?.roleName || user?.role_name || user?.role || user?.role_code || 'School Administrator'
}

export function Sidebar({ user }: { user?: any; theme?: 'default' | 'light' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { requestRoutePackets } = usePortal()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(sidebarStorageKey) === 'true'
  })
  const [directorExpanded, setDirectorExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(directorGroups.map((group) => [group.label, true])))
  const userInitials = initialsFor(user)
  const displayName = displayNameFor(user)
  const roleName = roleNameFor(user)
  const primaryItem = canAccessPath(user, dashboardItem.path)
    ? dashboardItem
    : canAccessPath(user, studentPortalItem.path)
      ? studentPortalItem
      : canAccessPath(user, parentProgressItem.path)
        ? parentProgressItem
        : canAccessPath(user, financeItem.path)
          ? financeItem
          : dashboardItem
  const PrimaryIcon = primaryItem.icon
  const settingsMode = location.pathname.startsWith('/settings')

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard'
    return location.pathname.startsWith(path)
  }

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(sidebarStorageKey, String(next))
      } catch {
        // Local storage can be unavailable in private contexts.
      }
      return next
    })
  }

  const openPath = (path: string) => {
    requestRoutePackets?.(path, { reason: 'school-sidebar-navigation' })
    navigate(path)
  }

  const allowedItems = (items: readonly any[]) => items.filter((item) => canAccessPath(user, item.path))

  const navItemClass = (active: boolean) =>
    `relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] transition ${
      collapsed ? 'justify-center px-0' : 'px-3'
    } max-md:justify-center max-md:px-0 ${
      active ? 'bg-[#111111] text-white shadow-[0_6px_14px_rgba(0,0,0,0.12)]' : 'text-[#6b7280] hover:bg-[#f7f8fa] hover:text-[#111827]'
    }`
  const labelClass = `${collapsed ? 'hidden' : 'block'} min-w-0 truncate max-md:hidden`
  const isBursarPortal = String(user?.role || '').toLowerCase() === 'bursar' && !settingsMode
  const userRole = String(user?.role || '').toLowerCase()
  const isDirectorPortal = ['school_owner', 'director', 'owner'].includes(userRole) && !settingsMode

  const toggleDirectorGroup = (label: string) => {
    setDirectorExpanded((current) => ({ ...current, [label]: !current[label] }))
  }

  if (isDirectorPortal) {
    const directorNavItemClass = (active: boolean) =>
      `relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] transition ${
        collapsed ? 'justify-center px-0' : 'px-3'
      } max-md:justify-center max-md:px-0 ${
        active
          ? 'bg-[#111111] text-white shadow-[0_6px_14px_rgba(0,0,0,0.12)]'
          : 'text-[#6b7280] hover:bg-[#f7f8fa] hover:text-[#111827]'
      }`

    return (
      <aside
        className={`z-20 flex h-full min-h-0 flex-col overflow-hidden border-r border-[#e2e8f0] bg-white text-[#6b7280] transition-[width,min-width,max-width] duration-200 ${
          collapsed ? 'w-14 min-w-14 max-w-14' : 'w-[276px] min-w-[276px] max-w-[276px]'
        } max-md:w-14 max-md:min-w-14 max-md:max-w-14`}
      >
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin] [scrollbar-color:#cbd5e0_transparent]">
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={() => openPath(directorOverviewItem.path)}
              title={directorOverviewItem.label}
              aria-label={directorOverviewItem.label}
              className={directorNavItemClass(location.pathname === '/overview')}
            >
              <LayoutDashboard className="size-4 shrink-0" />
              <span className={labelClass}>{directorOverviewItem.label}</span>
            </button>

            {directorGroups.map((group) => {
              const items = allowedItems(group.items)
              if (!items.length) return null
              const GroupIcon = group.icon
              const expanded = directorExpanded[group.label] !== false
              const groupActive = items.some((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
              return (
                <section key={group.label} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleDirectorGroup(group.label)}
                    title={group.label}
                    aria-label={group.label}
                    className={`relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-semibold tracking-[-0.012em] transition ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    } max-md:justify-center max-md:px-0 ${
                      groupActive ? 'text-[#111827]' : 'text-[#6b7280] hover:bg-[#f7f8fa] hover:text-[#111827]'
                    }`}
                  >
                    <GroupIcon className="size-4 shrink-0" />
                    <span className={labelClass}>{group.label}</span>
                    {!collapsed ? <ChevronDown className={`ml-auto size-3.5 transition ${expanded ? '' : '-rotate-90'} max-md:hidden`} /> : null}
                  </button>
                  {expanded ? (
                    <div className={`mt-0.5 grid gap-0.5 ${collapsed ? '' : 'pl-2'} max-md:pl-0`}>
                      {items.map((item) => {
                        const Icon = item.icon
                        const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                        return (
                          <button
                            key={`${item.path}-${item.label}`}
                            type="button"
                            onClick={() => openPath(item.path)}
                            title={item.label}
                            aria-label={item.label}
                            className={directorNavItemClass(active)}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className={labelClass}>{item.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}

            <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'mx-3 my-1 h-px bg-[#e2e8f0]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0]`} />
            <button type="button" onClick={() => openPath('/audit-security')} title="Audit & Security" aria-label="Audit & Security" className={directorNavItemClass(isActive('/audit-security'))}>
              <ScrollText className="size-4 shrink-0" />
              <span className={labelClass}>Audit & Security</span>
            </button>
            <button type="button" onClick={() => openPath('/leadership-settings')} title="Settings" aria-label="Settings" className={directorNavItemClass(isActive('/leadership-settings'))}>
              <Settings className="size-4 shrink-0" />
              <span className={labelClass}>Settings</span>
            </button>
          </div>
        </nav>

        <div className="grid shrink-0 gap-1.5 border-t border-[#e2e8f0] px-2 py-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] text-[#6b7280] transition hover:bg-[#f7f8fa] hover:text-[#111827] ${
              collapsed ? 'justify-center px-0' : 'px-3'
            } max-md:hidden`}
          >
            {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronLeft className="size-4 shrink-0" />}
            <span className={labelClass}>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
          <button
            type="button"
            onClick={() => openPath('/settings/preferences')}
            className={`flex h-10 items-center gap-2 rounded-[5px] text-left transition hover:bg-[#f7f8fa] ${collapsed ? 'justify-center px-0' : 'px-2'} max-md:justify-center max-md:px-0`}
            title={displayName}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{userInitials || 'D'}</span>
            <span className={`${collapsed ? 'hidden' : 'min-w-0 flex-1'} max-md:hidden`}>
              <span className="block truncate text-[13px] font-semibold text-[#111827]">{displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-[#9ca3af]">{roleName}</span>
            </span>
          </button>
        </div>
      </aside>
    )
  }

  if (isBursarPortal) {
    const bursarNavItemClass = (active: boolean) =>
      `relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] transition ${
        collapsed ? 'justify-center px-0' : 'px-3'
      } max-md:justify-center max-md:px-0 ${
        active
          ? 'bg-[#111111] text-white shadow-[0_6px_14px_rgba(0,0,0,0.12)]'
          : 'text-[#6b7280] hover:bg-[#f7f8fa] hover:text-[#111827]'
      }`

    return (
      <aside
        className={`z-20 flex h-full min-h-0 flex-col overflow-hidden border-r border-[#e2e8f0] bg-white text-[#6b7280] transition-[width,min-width,max-width] duration-200 ${
          collapsed ? 'w-14 min-w-14 max-w-14' : 'w-[256px] min-w-[256px] max-w-[256px]'
        } max-md:w-14 max-md:min-w-14 max-md:max-w-14`}
      >
        <div className={`shrink-0 border-b border-[#e2e8f0] px-3 py-3 ${collapsed ? 'grid place-items-center' : ''} max-md:grid max-md:place-items-center`}>
          <button
            type="button"
            onClick={() => openPath('/fees/dashboard')}
            title="Bursar workspace"
            aria-label="Bursar workspace"
            className={`flex min-w-0 items-center gap-3 rounded-[8px] text-left ${collapsed ? 'justify-center' : 'w-full'} max-md:justify-center`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-[#111827] text-white">
              <ReceiptText className="size-4" />
            </span>
            <span className={`${collapsed ? 'hidden' : 'min-w-0'} max-md:hidden`}>
              <span className="block truncate text-[14px] font-semibold tracking-[-0.03em] text-[#111827]">Bursar Workspace</span>
              <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[#9ca3af]">SmartLink Schools</span>
            </span>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin] [scrollbar-color:#cbd5e0_transparent]">
          <div className="grid gap-2">
            {bursarGroups.map((group) => {
              const items = allowedItems(group.items)
              if (!items.length) return null
              return (
                <section key={group.label} className="min-w-0">
                  <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-2.5 pb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
                    <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>{group.label}</span>
                  </div>
                  <div className="grid gap-0.5">
                    {items.map((item) => {
                      const Icon = item.icon
                      const active = item.path === '/fees/dashboard'
                        ? location.pathname === '/fees' || location.pathname === '/fees/dashboard'
                        : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                      return (
                        <button
                          key={`${item.path}-${item.label}`}
                          type="button"
                          onClick={() => openPath(item.path)}
                          title={item.label}
                          aria-label={item.label}
                          className={bursarNavItemClass(active)}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className={labelClass}>{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </nav>

        <div className="grid shrink-0 gap-1.5 border-t border-[#e2e8f0] px-2 py-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] text-[#6b7280] transition hover:bg-[#f7f8fa] hover:text-[#111827] ${
              collapsed ? 'justify-center px-0' : 'px-3'
            } max-md:hidden`}
          >
            {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronLeft className="size-4 shrink-0" />}
            <span className={labelClass}>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
          <button
            type="button"
            onClick={() => openPath('/settings/profile')}
            className={`flex h-10 items-center gap-2 rounded-[5px] text-left transition hover:bg-[#f7f8fa] ${collapsed ? 'justify-center px-0' : 'px-2'} max-md:justify-center max-md:px-0`}
            title={displayName}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{userInitials || 'B'}</span>
            <span className={`${collapsed ? 'hidden' : 'min-w-0 flex-1'} max-md:hidden`}>
              <span className="block truncate text-[13px] font-semibold text-[#111827]">{displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-[#9ca3af]">{roleName}</span>
            </span>
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`z-20 flex h-full min-h-0 flex-col overflow-hidden border-r border-[#e2e8f0] bg-white text-[#6b7280] transition-[width,min-width,max-width] duration-200 ${
        collapsed ? 'w-14 min-w-14 max-w-14' : 'w-[256px] min-w-[256px] max-w-[256px]'
      } max-md:w-14 max-md:min-w-14 max-md:max-w-14`}
    >
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin] [scrollbar-color:#cbd5e0_transparent]">
        {settingsMode ? (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => openPath(primaryItem.path)}
              title={`Back to ${primaryItem.label.toLowerCase()}`}
              aria-label={`Back to ${primaryItem.label.toLowerCase()}`}
              className={`relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] text-[#111827] transition hover:bg-[#f7f8fa] ${
                collapsed ? 'justify-center px-0' : 'px-3'
              } max-md:justify-center max-md:px-0`}
            >
              <ArrowLeft className="size-4 shrink-0" />
              <span className={labelClass}>Back</span>
            </button>
            <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-3 text-[12px] font-semibold tracking-[-0.014em] text-[#111827]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0`}>
              <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>Settings</span>
            </div>
            <div className="grid gap-1.5">
              {settingsGroups.map((group) => {
                const items = allowedItems(group.items)
                if (!items.length) return null
                return (
                <section key={group.label} className="min-w-0">
                  <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-2.5 pb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
                    <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>{group.label}</span>
                  </div>
                  <div className="grid gap-0.5">
                    {items.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={`${item.path}-${item.label}`}
                          type="button"
                          onClick={() => openPath(item.path)}
                          title={item.label}
                          aria-label={item.label}
                          className={navItemClass(isActive(item.path))}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className={labelClass}>{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openPath(primaryItem.path)}
              title={primaryItem.label}
              aria-label={primaryItem.label}
              className={`${navItemClass(isActive(primaryItem.path))} mb-2`}
            >
              <PrimaryIcon className="size-4 shrink-0" />
              <span className={labelClass}>{primaryItem.label}</span>
            </button>

            <div className="grid gap-1.5">
              {groups.map((group) => {
                const items = allowedItems(group.items)
                if (!items.length) return null
                return (
                <section key={group.label} className="min-w-0">
                  <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-2.5 pb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
                    <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>{group.label}</span>
                  </div>
                  <div className="grid gap-0.5">
                    {items.map((item) => {
                      const Icon = item.icon
                      const active = isActive(item.path)
                      return (
                        <button
                          key={`${item.path}-${item.label}`}
                          type="button"
                          onClick={() => openPath(item.path)}
                          title={item.label}
                          aria-label={item.label}
                          className={navItemClass(active)}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className={labelClass}>{item.label}</span>
                          {'badge' in item && item.badge ? <Badge value={item.badge} collapsed={collapsed} /> : null}
                        </button>
                      )
                    })}
                  </div>
                </section>
                )
              })}
            </div>
          </>
        )}
      </nav>

      <div className="grid shrink-0 gap-1.5 border-t border-[#e2e8f0] px-2 py-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`relative flex h-8 w-full items-center gap-2 rounded-[5px] text-left text-[12px] font-medium tracking-[-0.012em] text-[#6b7280] transition hover:bg-[#f7f8fa] hover:text-[#111827] ${
            collapsed ? 'justify-center px-0' : 'px-3'
          } max-md:hidden`}
        >
          {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronLeft className="size-4 shrink-0" />}
          <span className={labelClass}>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        {!settingsMode ? (
          <button
            type="button"
            onClick={() => openPath('/settings/preferences')}
            title="Settings"
            aria-label="Settings"
            className={navItemClass(isActive('/settings'))}
          >
            <Settings className="size-4" />
            <span className={labelClass}>Settings</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`flex h-10 items-center gap-2 rounded-[5px] text-left transition hover:bg-[#f7f8fa] ${collapsed ? 'justify-center px-0' : 'px-2'} max-md:justify-center max-md:px-0`}
          title={displayName}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{userInitials || 'SB'}</span>
          <span className={`${collapsed ? 'hidden' : 'min-w-0 flex-1'} max-md:hidden`}>
            <span className="block truncate text-[13px] font-semibold text-[#111827]">{displayName}</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-[#9ca3af]">{roleName}</span>
          </span>
        </button>
      </div>
    </aside>
  )
}

import { useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarCheck,
  CalendarRange,
  FlaskConical,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBarChart,
  Globe2,
  GraduationCap,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Palette,
  PlugZap,
  ReceiptText,
  ScrollText,
  Settings,
  Settings2,
  Sparkles,
  UserCircle2,
  UserRound,
  Users,
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

const groups = [
  {
    label: 'School Operations',
    items: [
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
  const userInitials = initialsFor(user)
  const displayName = displayNameFor(user)
  const roleName = roleNameFor(user)
  const primaryItem = canAccessPath(user, dashboardItem.path) ? dashboardItem : canAccessPath(user, studentPortalItem.path) ? studentPortalItem : dashboardItem
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

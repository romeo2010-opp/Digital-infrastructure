import { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBarChart,
  Fuel,
  Gavel,
  Link,
  LayoutDashboard,
  Lock,
  MapPinned,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  WalletCards,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useSidebarStats } from '../hooks/useSidebarStats'
import { usePortal } from '../lib/portalContext'
import { MERA_PERMISSIONS } from '../lib/access'

const sidebarStorageKey = 'meraSidebarCollapsed'

const dashboardItem = {
  label: 'National Dashboard',
  path: '/dashboard',
  icon: LayoutDashboard,
  permissions: [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT],
}

const groups = [
  {
    label: 'Markets',
    icon: WalletCards,
    items: [
      { label: 'Fuel Map', path: '/national-heat-intelligence-map', icon: MapPinned, permissions: [MERA_PERMISSIONS.HEATMAP_VIEW] },
      { label: 'Deliveries', path: '/fuel-deliveries', icon: Truck, permissions: [MERA_PERMISSIONS.DELIVERIES_VIEW] },
      { label: 'Availability', path: '/availability-audit', icon: Fuel, permissions: [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT] },
      { label: 'Market Watch', path: '/hoarding-watchlist', icon: Link, permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT] },
    ],
  },
  {
    label: 'Tasks',
    icon: ClipboardCheck,
    items: [
      { label: 'Task Operations', path: '/tasks', icon: ClipboardCheck, permissions: [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE] },
      { label: 'My Tasks', path: '/tasks/my', icon: ClipboardCheck, permissions: [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK] },
    ],
  },
  {
    label: 'Cases',
    icon: ShieldCheck,
    items: [
      { label: 'Complaints', path: '/complaints-center', icon: ShieldCheck, badgeKey: 'openComplaints', permissions: [MERA_PERMISSIONS.COMPLAINTS_VIEW] },
      { label: 'Flags', path: '/compliance-flags', icon: AlertTriangle, badgeKey: 'activeFlags', permissions: [MERA_PERMISSIONS.FLAGS_VIEW] },
      { label: 'Inspections', path: '/field-inspections', icon: ClipboardCheck, badgeKey: 'avgQueueWait', permissions: [MERA_PERMISSIONS.INSPECTIONS_VIEW] },
      { label: 'Enforcement', path: '/enforcement-actions', icon: Gavel, permissions: [MERA_PERMISSIONS.ENFORCEMENT_VIEW] },
    ],
  },
  {
    label: 'Registry',
    icon: Database,
    items: [
      { label: 'Stations', path: '/station-regulatory-profiles', icon: Lock, badgeKey: 'stationsTotal', permissions: [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT] },
      { label: 'Licenses', path: '/license-registry', icon: FileBarChart, permissions: [MERA_PERMISSIONS.LICENSES_VIEW] },
    ],
  },
  {
    label: 'Intelligence',
    icon: BarChart3,
    items: [
      { label: 'Reports', path: '/reports-intelligence', icon: FileBarChart, permissions: [MERA_PERMISSIONS.REPORTS_VIEW] },
      { label: 'Analytics', path: '/reports-intelligence', icon: BarChart3, permissions: [MERA_PERMISSIONS.REPORTS_VIEW] },
      { label: 'Exports', path: '/reports-intelligence', icon: Database, permissions: [MERA_PERMISSIONS.REPORTS_VIEW] },
    ],
  },
  {
    label: 'Control',
    icon: Bell,
    items: [
      { label: 'Alerts', path: '/compliance-flags', icon: Bell, badgeKey: 'activeFlags', permissions: [MERA_PERMISSIONS.FLAGS_VIEW] },
      { label: 'Audit', path: '/audit-trail', icon: ScrollText, permissions: [MERA_PERMISSIONS.AUDIT_VIEW] },
      { label: 'Access', path: '/user-administration', icon: Users, permissions: [MERA_PERMISSIONS.USERS_VIEW] },
    ],
  },
] as const

function Badge({ value, collapsed }: { value: string; collapsed?: boolean }) {
  return (
    <span
      className={
        collapsed
          ? 'absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e24b4a] px-1 text-[8px] font-bold leading-none text-white'
          : 'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e24b4a] px-1.5 text-[10px] font-bold leading-none text-white'
      }
    >
      {value}
    </span>
  )
}

function initialsFor(user: any) {
  const name = user?.fullName || user?.full_name || user?.email || 'MERA Regulator'
  return String(name)
    .split(/[.@_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function displayNameFor(user: any) {
  return user?.fullName || user?.full_name || user?.name || user?.email || 'MERA Officer'
}

export function Sidebar({ user }: { user?: any; theme?: 'default' | 'light' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { hasAnyPermission } = usePortal()
  const stats = useSidebarStats()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(sidebarStorageKey) === 'true'
  })
  const userInitials = initialsFor(user)
  const displayName = displayNameFor(user)
  const DashboardIcon = dashboardItem.icon

  const dashboardVisible = !dashboardItem.permissions || hasAnyPermission(dashboardItem.permissions)
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item: any) => !item.permissions || hasAnyPermission(item.permissions)),
    }))
    .filter((group) => group.items.length > 0)

  const badgeFor = (key?: string) => {
    if (key === 'stationsTotal') return String(stats.stationsTotal || '')
    if (key === 'avgQueueWait') return stats.avgQueueWait > 20 ? `${Math.round(stats.avgQueueWait)}m` : ''
    if (key === 'openComplaints') return stats.openComplaints > 0 ? String(stats.openComplaints) : ''
    if (key === 'activeFlags') return stats.activeFlags > 0 ? String(stats.activeFlags) : ''
    return ''
  }

  const isActive = (path: string) => {
    if (path === '/tasks') {
      return location.pathname === '/tasks' || location.pathname === '/tasks/new' || /^\/tasks\/TASK-/i.test(location.pathname)
    }
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
  const navItemClass = (active: boolean) =>
    `relative flex h-10 w-full items-center gap-2.5 rounded-[5px] text-left text-[13px] font-semibold transition ${
      collapsed ? 'justify-center px-0' : 'px-3'
    } max-md:justify-center max-md:px-0 ${
      active ? 'bg-[#111827] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]'
    }`
  const labelClass = `${collapsed ? 'hidden' : 'block'} min-w-0 truncate max-md:hidden`

  return (
    <aside
      className={`z-20 flex h-full min-h-0 flex-col overflow-hidden border-r border-[#e2e8f0] bg-white font-['Inter',system-ui,-apple-system,sans-serif] text-[#6b7280] transition-[width,min-width,max-width] duration-200 ${
        collapsed ? 'w-14 min-w-14 max-w-14' : 'w-[256px] min-w-[256px] max-w-[256px]'
      } max-md:w-14 max-md:min-w-14 max-md:max-w-14`}
    >
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin] [scrollbar-color:#cbd5e0_transparent]">
        {dashboardVisible ? (
          <button
            type="button"
            onClick={() => navigate(dashboardItem.path)}
            title={dashboardItem.label}
            aria-label={dashboardItem.label}
            className={`${navItemClass(isActive(dashboardItem.path))} mb-3`}
          >
            <DashboardIcon className="size-4 shrink-0" />
            <span className={labelClass}>{dashboardItem.label}</span>
          </button>
        ) : null}

        <div className="grid gap-3">
          {visibleGroups.map((group) => (
            <section key={group.label} className="min-w-0">
              <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
                <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>{group.label}</span>
              </div>
              <div className="grid gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = isActive(item.path)
                  const badge = badgeFor((item as any).badgeKey)
                  return (
                    <button
                      key={`${item.path}-${item.label}`}
                      type="button"
                      onClick={() => navigate(item.path)}
                      title={item.label}
                      aria-label={item.label}
                      className={navItemClass(active)}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={labelClass}>{item.label}</span>
                      {badge ? <Badge value={badge} collapsed={collapsed} /> : null}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="grid shrink-0 gap-2 border-t border-[#e2e8f0] px-2 py-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`relative flex h-10 w-full items-center gap-2.5 rounded-[5px] text-left text-[13px] font-semibold text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827] ${
            collapsed ? 'justify-center px-0' : 'px-3'
          } max-md:hidden`}
        >
          {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronLeft className="size-4 shrink-0" />}
          <span className={labelClass}>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/settings/preferences')}
          title="Settings"
          aria-label="Settings"
          className={navItemClass(isActive('/settings'))}
        >
          <Settings className="size-4" />
          <span className={labelClass}>Settings</span>
        </button>
        <button
          type="button"
          className={`flex h-11 items-center gap-2 rounded-[5px] text-left transition hover:bg-[#f3f4f6] ${collapsed ? 'justify-center px-0' : 'px-2'} max-md:justify-center max-md:px-0`}
          title={displayName}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{userInitials || 'MR'}</span>
          <span className={`${collapsed ? 'hidden' : 'min-w-0 flex-1'} max-md:hidden`}>
            <span className="block truncate text-[13px] font-semibold text-[#111827]">{displayName}</span>
            <span className="mt-0.5 block text-[11px] font-medium text-[#9ca3af]">Administrator</span>
          </span>
        </button>
      </div>
    </aside>
  )
}

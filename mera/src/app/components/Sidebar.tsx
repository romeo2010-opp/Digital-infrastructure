import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBarChart,
  Fuel,
  Globe2,
  LayoutDashboard,
  Lock,
  MapPinned,
  Palette,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCircle2,
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
  label: 'Command Centre',
  path: '/dashboard',
  icon: LayoutDashboard,
  permissions: [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_COMMAND_CENTRE],
}

const groups = [
  {
    label: 'Network',
    icon: WalletCards,
    items: [
      { label: 'Live Map', path: '/national-heat-intelligence-map', icon: MapPinned, permissions: [MERA_PERMISSIONS.HEATMAP_VIEW, MERA_PERMISSIONS.VIEW_MAP] },
      { label: 'Fuel Supply', path: '/fuel-deliveries', icon: Truck, permissions: [MERA_PERMISSIONS.DELIVERIES_VIEW] },
      { label: 'Stations', path: '/station-regulatory-profiles', icon: Fuel, badgeKey: 'stationsTotal', permissions: [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_STATION_PROFILE] },
      { label: 'Risk Watchlist', path: '/hoarding-watchlist', icon: ShieldCheck, badgeKey: 'activeFlags', permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT, MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.ALERTS_VIEW] },
    ],
  },
  {
    label: 'Regulation',
    icon: ClipboardCheck,
    items: [
      { label: 'Complaints', path: '/complaints-center', icon: ShieldCheck, badgeKey: 'openComplaints', permissions: [MERA_PERMISSIONS.COMPLAINTS_VIEW] },
      { label: 'Cases', path: '/compliance-flags', icon: AlertTriangle, badgeKey: 'activeFlags', permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.MANAGE_CASES] },
      { label: 'Inspections', path: '/field-inspections', icon: ClipboardCheck, permissions: [MERA_PERMISSIONS.INSPECTIONS_VIEW, MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.COMPLETE_INSPECTIONS] },
      { label: 'Licenses', path: '/license-registry', icon: ScrollText, permissions: [MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_CREATE, MERA_PERMISSIONS.LICENSES_UPDATE, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW] },
      { label: 'Price Compliance', path: '/price-compliance', icon: WalletCards, permissions: [MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW] },
    ],
  },
  {
    label: 'Intelligence',
    icon: BarChart3,
    items: [
      { label: 'Reports', path: '/reports-intelligence', icon: FileBarChart, permissions: [MERA_PERMISSIONS.REPORTS_VIEW] },
      { label: 'Public Notices', path: '/public-notices', icon: Bell, permissions: [MERA_PERMISSIONS.PUBLIC_NOTICES_VIEW, MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE, MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE, MERA_PERMISSIONS.PUBLISH_PUBLIC_NOTICE] },
      { label: 'Analytics', path: '/analytics', icon: BarChart3, permissions: [MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW] },
    ],
  },
  {
    label: 'Administration',
    icon: Bell,
    items: [
      { label: 'Settings', path: '/settings/preferences', icon: Settings, permissions: [] },
    ],
  },
] as const

const settingsGroups = [
  {
    label: 'My Account',
    items: [
      { label: 'Profile', path: '/settings/profile', icon: UserCircle2, permissions: [] },
      { label: 'Preferences', path: '/settings/preferences', icon: Palette, permissions: [] },
      { label: 'Notifications', path: '/settings/notifications', icon: Bell, permissions: [] },
    ],
  },
  {
    label: 'Security',
    items: [
      { label: 'Security', path: '/settings/security', icon: Lock, permissions: [] },
      { label: 'Audit Logs', path: '/settings/audit', icon: ScrollText, permissions: [MERA_PERMISSIONS.AUDIT_VIEW, MERA_PERMISSIONS.VIEW_AUDIT_LOGS] },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Users & Roles', path: '/settings/users', icon: Users, permissions: [MERA_PERMISSIONS.USERS_VIEW, MERA_PERMISSIONS.MANAGE_USERS] },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Organization', path: '/settings/organization', icon: Globe2, permissions: [] },
      { label: 'Integrations', path: '/settings/integrations', icon: PlugZap, permissions: [] },
      { label: 'Data Controls', path: '/settings/data', icon: Database, permissions: [] },
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

function roleNameFor(user: any) {
  return user?.roleDisplayName || user?.role_display_name || user?.roleName || user?.role_name || user?.role || user?.role_code || 'Portal operator'
}

export function Sidebar({ user }: { user?: any; theme?: 'default' | 'light' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { hasAnyPermission, requestRoutePackets } = usePortal()
  const stats = useSidebarStats()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(sidebarStorageKey) === 'true'
  })
  const userInitials = initialsFor(user)
  const displayName = displayNameFor(user)
  const roleName = roleNameFor(user)
  const DashboardIcon = dashboardItem.icon

  const dashboardVisible = !dashboardItem.permissions || hasAnyPermission(dashboardItem.permissions)
  const settingsMode = location.pathname.startsWith('/settings')
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item: any) => !item.permissions?.length || hasAnyPermission(item.permissions)),
    }))
    .filter((group) => group.items.length > 0)
  const visibleSettingsGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item: any) => !item.permissions?.length || hasAnyPermission(item.permissions)),
    }))
    .filter((group) => group.items.length > 0)

  const badgeFor = (key?: string) => {
    if (key === 'stationsTotal') return String(stats.stationsTotal || '')
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
  const openPath = (path: string) => {
    requestRoutePackets?.(path, { reason: 'sidebar-navigation' })
    navigate(path)
  }
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
          <div className="grid gap-4">
            <button
              type="button"
              onClick={() => openPath('/dashboard')}
              title="Back to portal"
              aria-label="Back to portal"
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
            <div className="grid gap-2.5">
              {visibleSettingsGroups.map((group) => (
                <section key={group.label} className="min-w-0">
                  <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
                    <span className={`${collapsed ? 'hidden' : ''} max-md:hidden`}>{group.label}</span>
                  </div>
                  <div className="grid gap-1">
                    {group.items.map((item) => {
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
              ))}
            </div>
          </div>
        ) : (
          <>
            {dashboardVisible ? (
              <button
                type="button"
                onClick={() => openPath(dashboardItem.path)}
                title={dashboardItem.label}
                aria-label={dashboardItem.label}
                className={`${navItemClass(isActive(dashboardItem.path))} mb-3`}
              >
                <DashboardIcon className="size-4 shrink-0" />
                <span className={labelClass}>{dashboardItem.label}</span>
              </button>
            ) : null}

            <div className="grid gap-2.5">
              {visibleGroups.map((group) => (
                <section key={group.label} className="min-w-0">
                  <div className={`${collapsed ? 'mx-auto h-px w-7 bg-[#e2e8f0]' : 'px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]'} max-md:mx-auto max-md:h-px max-md:w-7 max-md:bg-[#e2e8f0] max-md:px-0 max-md:pb-0`}>
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
                          onClick={() => openPath(item.path)}
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
          </>
        )}
      </nav>

      <div className="grid shrink-0 gap-2 border-t border-[#e2e8f0] px-2 py-3">
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
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[11px] font-bold text-white">{userInitials || 'MR'}</span>
            <span className={`${collapsed ? 'hidden' : 'min-w-0 flex-1'} max-md:hidden`}>
            <span className="block truncate text-[13px] font-semibold text-[#111827]">{displayName}</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-[#9ca3af]">{roleName}</span>
          </span>
        </button>
      </div>
    </aside>
  )
}

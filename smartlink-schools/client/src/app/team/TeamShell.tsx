import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import {
  Bell,
  Building2,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Headphones,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import type { TeamPrincipal } from './teamApi'
import { shortDate, teamRequest, titleCase } from './teamApi'

const navigation = [
  ['/team/dashboard', 'Dashboard', LayoutDashboard, 'TEAM_DASHBOARD_VIEW'],
  ['/team/schools', 'Schools', Building2, ['SCHOOLS_VIEW_ALL', 'SCHOOLS_VIEW_ASSIGNED']],
  ['/team/pipeline', 'Pipeline', CircleDollarSign, ['OPPORTUNITIES_MANAGE', 'PROPOSALS_MANAGE']],
  ['/team/tasks', 'Tasks', CheckSquare2, 'TASKS_MANAGE'],
  ['/team/meetings', 'Meetings', CalendarDays, 'MEETINGS_MANAGE'],
  ['/team/proposals', 'Proposals', FileCheck2, ['PROPOSALS_MANAGE', 'PROPOSALS_APPROVE']],
  ['/team/onboarding', 'Onboarding', ClipboardCheck, 'ONBOARDING_MANAGE'],
  ['/team/subscriptions', 'Subscriptions', CircleDollarSign, 'SUBSCRIPTIONS_VIEW'],
  ['/team/support', 'Support', Headphones, 'SUPPORT_MANAGE'],
  ['/team/team-members', 'Team members', Users, 'TEAM_DASHBOARD_VIEW'],
  ['/team/reports', 'Reports', LayoutDashboard, 'REPORTS_VIEW'],
  ['/team/audit-log', 'Audit log', ShieldCheck, 'AUDIT_VIEW'],
  ['/team/settings', 'Settings', Settings, ['TEAM_MEMBERS_MANAGE', 'SETTINGS_MANAGE']],
] as const

function allowed(user: TeamPrincipal, requirement: string | readonly string[]) {
  const expected = Array.isArray(requirement) ? requirement : [requirement]
  return expected.some((permission) => user.permissions.includes(permission))
}

export function TeamShell({ user, token, onLogout, children }: { user: TeamPrincipal; token: string; onLogout: () => void; children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('smartlink.team.sidebar.collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openPanel, setOpenPanel] = useState<'notifications' | null>(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const activeTitle = useMemo(() => navigation.find(([path]) => location.pathname.startsWith(path))?.[1] || 'Team Suite', [location.pathname])
  const visibleNavigation = navigation.filter(([, , , permission]) => allowed(user, permission))

  useEffect(() => {
    window.localStorage.setItem('smartlink.team.sidebar.collapsed', String(collapsed))
  }, [collapsed])
  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) { setSearchResults([]); return }
      setSearchLoading(true)
      try {
        const result = await teamRequest(`/search?q=${encodeURIComponent(search.trim())}&page_size=10`, {}, token)
        setSearchResults(result.items || [])
      } catch {
        setSearchResults([])
      } finally { setSearchLoading(false) }
    }, 280)
    return () => window.clearTimeout(timer)
  }, [search, token])

  const loadNotifications = async () => {
    try {
      const result = await teamRequest('/notifications?page_size=12', {}, token)
      setNotifications(result.items || [])
      setUnreadCount(Number(result.unread_count || 0))
    } catch { /* The page-level API error boundary handles session failures. */ }
  }
  useEffect(() => { void loadNotifications() }, [token])

  const initials = user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const sidebar = (
    <aside className={`flex h-full flex-col border-r border-[#dce3ec] bg-[#0f1e2e] text-white transition-[width] duration-200 ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}>
      <div className={`flex h-16 shrink-0 items-center border-b border-white/10 ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'}`}>
        <div className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-white"><img src="/smartlink-mark-tight.png" className="size-8 object-contain" alt="SmartLink" /></div>
        {!collapsed ? <div className="min-w-0"><div className="truncate text-[14px] font-semibold">SmartLink Team Suite</div><div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">Internal operations</div></div> : null}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Team Suite navigation">
        {visibleNavigation.map(([path, label, Icon]) => (
          <NavLink key={path} to={path} title={collapsed ? label : undefined} className={({ isActive }) => `mb-1 flex h-10 items-center rounded-[7px] text-[12px] font-medium transition ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} ${isActive ? 'bg-white text-[#102235] shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
            <Icon className="size-4 shrink-0" />{!collapsed ? <span className="truncate">{label}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-2">
        <button type="button" onClick={() => setCollapsed((value) => !value)} className={`hidden h-9 w-full items-center rounded-[7px] text-slate-300 hover:bg-white/10 hover:text-white lg:flex ${collapsed ? 'justify-center' : 'gap-3 px-3'}`} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /><span className="text-[12px]">Collapse</span></>}
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-[#f3f6f9] text-[#17212b]">
      <div className="hidden h-full lg:block">{sidebar}</div>
      {mobileOpen ? <div className="fixed inset-0 z-50 flex lg:hidden"><button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /><div className="relative h-full">{sidebar}<button type="button" onClick={() => setMobileOpen(false)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white text-slate-900"><X className="size-4" /></button></div></div> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b border-[#dce3ec] bg-white px-3 shadow-[0_1px_8px_rgba(15,30,46,0.04)] sm:px-5">
          <button type="button" className="grid size-9 place-items-center rounded-[7px] border border-slate-200 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-4" /></button>
          <div className="hidden min-w-[130px] sm:block"><div className="text-[14px] font-semibold">{activeTitle}</div><div className="text-[10px] text-slate-500">SmartLink internal workspace</div></div>
          <div className="relative mx-auto w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search schools, contacts, tasks, proposals…" className="h-9 w-full rounded-[7px] border border-slate-200 bg-slate-50 pl-9 pr-3 text-[12px] outline-none transition focus:border-[#1b6ca8] focus:bg-white focus:ring-2 focus:ring-[#1b6ca8]/10" aria-label="Search Team Suite" />
            {search.trim().length >= 2 ? <div className="absolute inset-x-0 top-11 overflow-hidden rounded-[9px] border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{searchLoading ? 'Searching…' : `${searchResults.length} results`}</div>
              {searchResults.length ? searchResults.map((result) => <button key={`${result.entity_type}-${result.entity_ref}`} type="button" onClick={() => { navigate(result.path); setSearch('') }} className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50"><span className="mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">{titleCase(result.entity_type)}</span><span className="min-w-0"><span className="block truncate text-[12px] font-semibold">{result.title}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{result.subtitle}</span></span></button>) : !searchLoading ? <div className="px-4 py-8 text-center text-[12px] text-slate-500">No permitted records matched this search.</div> : null}
            </div> : null}
          </div>
          <div className="relative flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => { setOpenPanel((panel) => panel === 'notifications' ? null : 'notifications'); void loadNotifications() }} className="relative grid size-9 place-items-center rounded-[7px] text-slate-500 hover:bg-slate-100" aria-label="Notifications"><Bell className="size-4" />{unreadCount ? <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-[#d9485f] px-1 text-[9px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}</button>
            <button type="button" onClick={onLogout} title="Sign out" className="flex h-9 items-center gap-2 rounded-[8px] border border-slate-200 bg-white p-1 pr-2.5 hover:bg-slate-50"><span className="grid size-7 place-items-center rounded-full bg-[#0f1e2e] text-[10px] font-bold text-white">{initials}</span><span className="hidden max-w-[120px] truncate text-[11px] font-semibold xl:block">{user.fullName}</span></button>
            {openPanel === 'notifications' ? <div className="absolute right-0 top-12 w-[min(92vw,390px)] overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><div className="text-[13px] font-semibold">Notifications</div><div className="text-[10px] text-slate-500">{unreadCount} unread</div></div><button type="button" className="text-[10px] font-semibold text-[#1b6ca8]" onClick={async () => { await teamRequest('/notifications/read-all', { method: 'POST' }, token); await loadNotifications() }}>Mark all read</button></div>
              <div className="max-h-[430px] overflow-y-auto">{notifications.length ? notifications.map((item) => <button key={item.public_ref} type="button" onClick={async () => { if (!item.read_at) await teamRequest(`/notifications/${item.public_ref}/read`, { method: 'POST' }, token); setOpenPanel(null); if (item.action_path) navigate(item.action_path); await loadNotifications() }} className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 ${item.read_at ? '' : 'bg-blue-50/40'}`}><div className="text-[11px] font-semibold">{item.title}</div><div className="mt-1 text-[11px] leading-4 text-slate-600">{item.message}</div><div className="mt-1.5 text-[9px] text-slate-400">{shortDate(item.created_at, true)}</div></button>) : <div className="px-4 py-10 text-center text-[12px] text-slate-500">No notifications yet.</div>}</div>
            </div> : null}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[1700px] p-4 sm:p-6">{children}</div></main>
      </div>
    </div>
  )
}

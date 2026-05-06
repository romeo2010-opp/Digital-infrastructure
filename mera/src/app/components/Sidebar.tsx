import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flag,
  Grid2X2,
  List,
  MapPinned,
  Settings,
  Truck,
  Users,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useSidebarStats, type SidebarSituation } from '../hooks/useSidebarStats'

const sidebarWidthClass = 'w-[236px] min-w-[236px] max-w-[236px]'

const sections = [
  {
    label: 'Overview',
    items: [
      { label: 'National dashboard', path: '/dashboard', icon: Grid2X2 },
      { label: 'Situation monitor', path: '/situation-monitor', icon: Clock3, badgeKey: 'situation' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Fuel availability map', path: '/fuel-availability-map', icon: MapPinned },
      { label: 'Station registry', path: '/station-registry', icon: Grid2X2, badgeKey: 'stationsTotal' },
      { label: 'Queue monitoring', path: '/queue-monitoring', icon: List, badgeKey: 'avgQueueWait' },
      { label: 'Fuel deliveries', path: '/fuel-deliveries', icon: Truck },
      { label: 'Demand forecasting', path: '/demand-forecasting', icon: BarChart3 },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { label: 'Complaints center', path: '/complaints-center', icon: CheckCircle2, badgeKey: 'openComplaints' },
      { label: 'Compliance flags', path: '/compliance-flags', icon: Flag, badgeKey: 'activeFlags' },
      { label: 'Field inspections', path: '/field-inspections', icon: CalendarDays, badgeKey: 'activeInspections' },
      { label: 'Enforcement actions', path: '/enforcement-actions', icon: AlertTriangle, badgeKey: 'pendingEnforcement' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { label: 'Reports & intelligence', path: '/reports-intelligence', icon: BarChart3 },
      { label: 'Trends & analytics', path: '/trends-analytics', icon: BarChart3 },
      { label: 'Data exports', path: '/data-exports', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', path: '/settings/preferences', icon: Settings },
      { label: 'Audit logs', path: '/audit-logs', icon: List },
      { label: 'Users & roles', path: '/users-roles', icon: Users },
    ],
  },
] as const

function plusLogo() {
  return (
    <div className="flex size-8 items-center justify-center rounded-[6px] bg-[#0F6E56]">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2.2V11.8M2.2 7H11.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function situationPalette(situation: SidebarSituation) {
  if (situation === 'NATIONAL_OUTAGE') {
    return { bg: '#FCEBEB', border: '#E24B4A', label: '#9E2F2E', text: '#7D2121' }
  }
  if (situation === 'STABLE') {
    return { bg: '#EAF3DE', border: '#1D9E75', label: '#3B6D11', text: '#2F5A0D' }
  }
  if (situation === 'PRICE_SPIKE' || situation === 'MONITORING') {
    return { bg: '#E6F1FB', border: '#378ADD', label: '#185FA5', text: '#144B81' }
  }
  return { bg: '#FAEEDA', border: '#EF9F27', label: '#854F0B', text: '#633806' }
}

function syncColor(lastSync: Date | null, hasError: boolean) {
  if (!lastSync || hasError) return '#E24B4A'
  const ageSeconds = (Date.now() - lastSync.getTime()) / 1000
  if (ageSeconds < 60) return '#1D9E75'
  if (ageSeconds <= 120) return '#EF9F27'
  return '#E24B4A'
}

function formatSync(lastSync: Date | null) {
  if (!lastSync) return 'Offline'
  return `Live · ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

function badgeStyles(kind: 'red' | 'amber' | 'blue' | 'green' | 'gray') {
  if (kind === 'red') return { background: '#FCEBEB', color: '#A32D2D' }
  if (kind === 'amber') return { background: '#FAEEDA', color: '#854F0B' }
  if (kind === 'blue') return { background: '#E6F1FB', color: '#185FA5' }
  if (kind === 'green') return { background: '#EAF3DE', color: '#3B6D11' }
  return { background: 'var(--color-secondary)', color: 'var(--color-muted-foreground)' }
}

export function Sidebar({ user }: { user?: any }) {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    stationsOnline,
    stationsTotal,
    outOfStock,
    lowStock,
    avgQueueWait,
    openComplaints,
    activeFlags,
    activeInspections,
    pendingEnforcement,
    nationalSituation,
    situationDetail,
    lastSync,
    hasError,
  } = useSidebarStats()

  const situationColors = situationPalette(nationalSituation)
  const syncTone = syncColor(lastSync, hasError)
  const displayName = user?.fullName || user?.full_name || user?.email || 'MERA Regulator'
  const displayRole = user?.role || 'Portal operator'
  const initialsSource = user?.fullName || user?.full_name || user?.email || 'MR'
  const initials = String(initialsSource)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join('')
    .toUpperCase()

  return (
    <aside className={`flex h-screen ${sidebarWidthClass} flex-col bg-[#f4f7f6] text-foreground`}>
      <div className="shrink-0 px-3 pt-3">
        <div className="flex items-center gap-3 rounded-[6px] bg-white/75 px-2.5 py-2">
          {plusLogo()}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-[-0.02em] leading-none text-foreground">MERA Portal</div>
            <div className="mt-1 truncate text-[10px] font-medium tracking-[0.01em] leading-none text-muted-foreground">Fuel Intelligence & Compliance</div>
          </div>
        </div>

        <div className="mt-3 rounded-[6px] border border-border/60 bg-secondary/85 px-[10px] py-[8px]">
          <div className="grid grid-cols-4 items-center text-center">
            <div className="min-w-0 pr-2">
              <div className="text-[9px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground">Online</div>
              <div className="mt-1 text-[13px] font-semibold tracking-[-0.02em] leading-none text-[#1D9E75]">{stationsOnline}</div>
            </div>
            <div className="min-w-0 border-l border-border/80 px-2">
              <div className="text-[9px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground">Dry</div>
              <div className="mt-1 text-[13px] font-semibold tracking-[-0.02em] leading-none text-[#E24B4A]">{outOfStock}</div>
            </div>
            <div className="min-w-0 border-l border-border/80 px-2">
              <div className="text-[9px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground">Low</div>
              <div className="mt-1 text-[13px] font-semibold tracking-[-0.02em] leading-none text-[#EF9F27]">{lowStock}</div>
            </div>
            <div className="min-w-0 border-l border-border/80 pl-2">
              <div className="text-[9px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground">Live</div>
              <div className="mt-1 flex items-center justify-center gap-1">
                <span className="size-[5px] animate-pulse rounded-full bg-[#1D9E75]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="mx-3 my-2 shrink-0 rounded-[6px] px-[10px] py-[8px]"
        style={{ backgroundColor: situationColors.bg, borderLeft: `3px solid ${situationColors.border}` }}
      >
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: situationColors.label }}>
          National Situation
        </div>
        <div className="mt-1 text-[11px] font-medium leading-4 tracking-[-0.01em]" style={{ color: situationColors.text }}>
          {situationDetail}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-2.5 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">{section.label}</div>
            <div>
              {section.items.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname.startsWith(item.path)

                let badgeText = ''
                let badgeKind: 'red' | 'amber' | 'blue' | 'green' | 'gray' = 'gray'

                if (item.badgeKey === 'situation') {
                  badgeText = nationalSituation.replaceAll('_', ' ')
                  badgeKind =
                    nationalSituation === 'NATIONAL_OUTAGE'
                      ? 'red'
                      : nationalSituation === 'REGIONAL_SHORTAGE'
                        ? 'amber'
                        : nationalSituation === 'STABLE'
                          ? 'green'
                          : 'blue'
                }
                if (item.badgeKey === 'stationsTotal') {
                  badgeText = String(stationsTotal)
                }
                if (item.badgeKey === 'avgQueueWait') {
                  badgeText = `${Math.round(avgQueueWait)}m`
                  badgeKind = avgQueueWait > 15 ? 'amber' : 'gray'
                }
                if (item.badgeKey === 'openComplaints') {
                  badgeText = String(openComplaints)
                  badgeKind = openComplaints > 0 ? 'red' : 'gray'
                }
                if (item.badgeKey === 'activeFlags') {
                  badgeText = String(activeFlags)
                  badgeKind = activeFlags > 0 ? 'red' : 'gray'
                }
                if (item.badgeKey === 'activeInspections') {
                  badgeText = String(activeInspections)
                  badgeKind = 'blue'
                }
                if (item.badgeKey === 'pendingEnforcement') {
                  badgeText = String(pendingEnforcement)
                  badgeKind = pendingEnforcement > 0 ? 'amber' : 'gray'
                }

                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-[7px] text-left transition-colors"
                    style={{
                      backgroundColor: isActive ? '#E1F5EE' : 'transparent',
                      color: isActive ? '#0F6E56' : 'var(--color-muted-foreground)',
                      borderLeft: `2px solid ${isActive ? '#1D9E75' : 'transparent'}`,
                    }}
                    onMouseEnter={(event) => {
                      if (!isActive) event.currentTarget.style.backgroundColor = 'var(--color-secondary)'
                    }}
                    onMouseLeave={(event) => {
                      if (!isActive) event.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <Icon size={13} strokeWidth={2} style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }} />
                    <span className="min-w-0 flex-1 truncate text-[12px] leading-none tracking-[-0.01em]" style={{ fontWeight: isActive ? 600 : 500 }}>
                      {item.label}
                    </span>
                    {badgeText ? (
                      <span
                        className="shrink-0 rounded-[3px] px-[5px] py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] leading-none"
                        style={badgeStyles(badgeKind)}
                      >
                        {badgeText}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border/70 bg-white/55 px-3 py-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-medium uppercase tracking-[0.08em] text-muted-foreground">Portal sync</span>
          <span className="font-semibold tracking-[-0.01em]" style={{ color: syncTone }}>{formatSync(lastSync)}</span>
        </div>

        <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-[6px] px-1 py-1 text-left transition-colors hover:bg-secondary/80">
          <div className="flex size-9 items-center justify-center rounded-full bg-[#0F6E56] text-[11px] font-medium text-white">
            {initials || 'MR'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold tracking-[-0.02em] leading-none text-foreground">{displayName}</div>
            <div className="mt-1 truncate text-[10px] font-medium tracking-[0.01em] leading-none text-muted-foreground">{displayRole}</div>
          </div>
          <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </div>
    </aside>
  )
}

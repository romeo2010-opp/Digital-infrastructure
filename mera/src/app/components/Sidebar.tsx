import { LayoutDashboard, Eye, Truck, FileCheck, AlertCircle, Flag, Clipboard, Gavel, Building2, FileText, BarChart3, Users, ScrollText, Shield } from 'lucide-react'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
}

const menuItems = [
  { id: 'dashboard', label: 'National Dashboard', icon: LayoutDashboard },
  { id: 'hoarding', label: 'Hoarding Watchlist', icon: Eye },
  { id: 'deliveries', label: 'Fuel Deliveries', icon: Truck },
  { id: 'availability', label: 'Availability Audit', icon: FileCheck },
  { id: 'complaints', label: 'Complaints Center', icon: AlertCircle },
  { id: 'compliance', label: 'Compliance Flags', icon: Flag },
  { id: 'inspections', label: 'Field Inspections', icon: Clipboard },
  { id: 'enforcement', label: 'Enforcement Actions', icon: Gavel },
  { id: 'stations', label: 'Station Regulatory Profiles', icon: Building2 },
  { id: 'licenses', label: 'License Registry', icon: FileText },
  { id: 'reports', label: 'Reports & Intelligence', icon: BarChart3 },
  { id: 'users', label: 'User Administration', icon: Users },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
]

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-[#16263d] text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-blue-200/30 bg-blue-50 text-blue-700">
            <Shield className="size-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-[0.08em] text-white">MERA PORTAL</h1>
            <p className="text-xs text-slate-300">Regulatory Enforcement Workstation</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {menuItems.map((item, index) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`mb-1.5 flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? 'border-blue-300/40 bg-blue-500/10 text-white'
                  : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1 leading-5">{item.label}</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {String(index + 1).padStart(2, '0')}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

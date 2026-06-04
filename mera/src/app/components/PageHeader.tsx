import { Bell, RefreshCcw, Settings } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { usePortal } from '../lib/portalContext'
import { GlobalSearch } from './search/GlobalSearch'
import { NotificationDrawer } from './NotificationDrawer'

export function PageHeader({
  user,
  onLogout,
  showSync = false,
  syncLoading = false,
  onSync,
}: {
  title: string
  subtitle: string
  user: any
  loading?: boolean
  onLogout: () => void
  theme?: 'default' | 'light'
  showSync?: boolean
  syncLoading?: boolean
  onSync?: () => void
}) {
  const navigate = useNavigate()
  const { data } = usePortal()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const name = user?.fullName || user?.full_name || user?.email || 'MERA Super Admin'
  const role =
    user?.roleDisplayName ||
    user?.role_display_name ||
    user?.roleName ||
    user?.role_name ||
    user?.role ||
    user?.role_code ||
    'Portal operator'
  const initials = String(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const unreadCount = Number(data?.notifications?.unreadCount || 0)

  return (
    <header className="h-14 shrink-0 border-b border-[#e2e8f0] bg-white px-4 text-[#111827]">
      <NotificationDrawer open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(190px,520px)_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/smartlink-mark-tight.png" className="size-9 shrink-0 object-contain" alt="SmartLink" />
          <div className="min-w-0 max-sm:hidden">
            <div className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-[#111827]">MERA Portal</div>
            <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af]">Regulatory Command</div>
          </div>
        </div>
        <GlobalSearch />

        <div className="flex max-w-full shrink-0 items-center justify-end gap-1">
          <div
            className={`grid overflow-hidden transition-all duration-300 ease-out ${
              showSync ? 'mr-1 max-w-[112px] translate-y-0 opacity-100' : 'max-w-0 -translate-y-1 opacity-0'
            }`}
          >
            <button
              type="button"
              onClick={onSync}
              disabled={!onSync}
              className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-white px-2.5 text-[12px] font-medium tracking-[-0.012em] text-[#6b7280] transition hover:border-[#cbd5e1] hover:bg-[#f7f8fa] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-70"
              aria-label="Sync this page"
            >
              <RefreshCcw className={`size-4 ${syncLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
          <button type="button" className="relative grid size-8 place-items-center rounded-[5px] text-[#6b7280] transition hover:bg-[#f7f8fa] hover:text-[#111827]" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
            <Bell className="size-4" />
            {unreadCount ? (
              <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[#111827] text-[9px] font-bold leading-none text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>
          <button type="button" className="grid size-8 place-items-center rounded-[5px] text-[#6b7280] transition hover:bg-[#f7f8fa] hover:text-[#111827]" aria-label="Settings" onClick={() => navigate('/settings/preferences')}>
            <Settings className="size-4" />
          </button>
          <button type="button" className="flex h-9 items-center gap-2 rounded-[8px] border border-[#e2e8f0] bg-white py-1 pl-1 pr-2.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:border-[#cbd5e1] hover:bg-[#f7f8fa]" onClick={onLogout} title="Sign out">
            <span className="grid size-7 place-items-center rounded-full bg-[#111827] text-[10px] font-bold text-white ring-2 ring-[#f3f4f6]">{initials || 'MS'}</span>
            <span className="hidden min-w-0 lg:block">
              <span className="block max-w-[150px] truncate text-[12px] font-semibold leading-none text-[#111827]">{name}</span>
              <span className="mt-1 block max-w-[150px] truncate text-[10px] font-medium leading-none text-[#9ca3af]">{role}</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

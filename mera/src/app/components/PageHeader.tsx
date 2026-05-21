import { Bell, Settings } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { usePortal } from '../lib/portalContext'
import { GlobalSearch } from './search/GlobalSearch'
import { NotificationDrawer } from './NotificationDrawer'

export function PageHeader({
  user,
  onLogout,
}: {
  title: string
  subtitle: string
  user: any
  loading?: boolean
  onLogout: () => void
  theme?: 'default' | 'light'
}) {
  const navigate = useNavigate()
  const { data } = usePortal()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const name = user?.fullName || user?.full_name || user?.email || 'MERA Super Admin'
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
          <div>
            <img src="/smartlink-mark-tight.png" width={"53"} height={"53"}/>
          </div>
          <div className="min-w-0 max-sm:hidden">
            <div className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-[#111827]">MERA Portal</div>
            <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af]">Regulatory Command</div>
          </div>
        </div>
        <GlobalSearch />

        <div className="flex max-w-full shrink-0 items-center justify-end gap-1">
          <button type="button" className="relative grid size-9 place-items-center rounded-[5px] text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827]" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
            <Bell className="size-4" />
            {unreadCount ? (
              <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[#111827] text-[9px] font-bold leading-none text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>
          <button type="button" className="grid size-9 place-items-center rounded-[5px] text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827]" aria-label="Settings" onClick={() => navigate('/settings/preferences')}>
            <Settings className="size-4" />
          </button>
          <button type="button" className="flex h-9 items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-[#f9fafb] py-1 pl-1 pr-2 text-left transition hover:bg-white" onClick={onLogout} title="Sign out">
            <span className="grid size-7 place-items-center rounded-full bg-[#111827] text-[10px] font-bold text-white">{initials || 'MS'}</span>
            <span className="hidden min-w-0 lg:block">
              <span className="block max-w-[150px] truncate text-[12px] font-semibold leading-none text-[#111827]">{name}</span>
              <span className="mt-1 block text-[10px] font-medium leading-none text-[#9ca3af]">Administrator</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

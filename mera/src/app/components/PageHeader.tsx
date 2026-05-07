import { Bell, LogOut, RefreshCw, SunMedium } from 'lucide-react'
import { Button } from './ui/button'

export function PageHeader({
  title,
  subtitle,
  user,
  loading,
  onLogout,
}: {
  title: string
  subtitle: string
  user: any
  loading?: boolean
  onLogout: () => void
}) {
  return (
    <header className="h-[92px] bg-[#ffffff] px-5">
      <div className="flex h-full items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[0.98rem] font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
          <p className="mt-1 truncate text-[0.82rem] font-medium leading-5 text-slate-500">{subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          <button type="button" className="rounded-[6px] px-2 py-1 text-[0.82rem] font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900">
            Start guide
          </button>
          <button type="button" className="inline-flex h-8 items-center gap-2 rounded-[6px] border border-white/80 bg-white/72 px-2.5 text-[0.82rem] font-medium text-slate-700">
            <span>Live Mode</span>
            <span className="flex h-4 w-7 items-center rounded-full bg-secondary px-0.5">
              <span className="ml-auto size-3 rounded-full bg-white" />
            </span>
          </button>
          <button type="button" className="rounded-[6px] px-2 py-1 text-[0.82rem] font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900">
            Docs
          </button>
          <div className="rounded-[6px] border border-white/70 bg-white/74 px-2.5 py-1.5 text-[0.72rem] font-semibold text-slate-600">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="size-3 animate-spin" />
                Syncing portal data
              </span>
            ) : (
              'Portal synchronized'
            )}
          </div>
          <button className="relative rounded-[6px] p-1.5 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900">
            <Bell className="size-[0.9rem]" />
            <span className="absolute right-[0.28rem] top-[0.28rem] size-1.5 rounded-full bg-blue-600" />
          </button>
          <button className="rounded-[6px] p-1.5 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900">
            <SunMedium className="size-[0.9rem]" />
          </button>
          <div className="flex size-9 items-center justify-center rounded-full bg-[#0F6E56] text-[0.85rem] font-semibold text-white">
            {(user?.fullName || user?.email || 'MO').slice(0, 2).toUpperCase()}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-[6px] border-white/80 bg-white/74 px-3 text-[0.82rem] shadow-none" onClick={onLogout}>
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}

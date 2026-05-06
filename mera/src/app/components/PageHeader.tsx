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
    <header className="h-[92px]  bg-white px-6">
      <div className="flex h-full items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[1rem] font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
          <p className="mt-1 truncate text-[0.88rem] leading-5 text-[#6b84a3]">{subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          <button type="button" className="text-[0.88rem] font-medium text-[#6d7f98] transition-colors hover:text-slate-900">
            Start guide
          </button>
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 px-3 text-[0.9rem] font-medium text-[#405772]">
            <span>Live Mode</span>
            <span className="flex h-4.5 w-8 items-center rounded-full bg-[#eef2f7] px-0.5">
              <span className="ml-auto size-3.5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
          <button type="button" className="text-[0.88rem] font-medium text-[#6d7f98] transition-colors hover:text-slate-900">
            Docs
          </button>
          <div className="rounded-full bg-[#eef2f7] px-3 py-1.5 text-[0.76rem] font-medium text-[#4a6280]">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="size-3 animate-spin" />
                Syncing portal data
              </span>
            ) : (
              'Portal synchronized'
            )}
          </div>
          <button className="relative rounded-full p-1.5 text-[#6d7f98] transition-colors hover:bg-slate-100 hover:text-slate-900">
            <Bell className="size-[0.95rem]" />
            <span className="absolute right-[0.28rem] top-[0.28rem] size-1.5 rounded-full bg-blue-600" />
          </button>
          <button className="rounded-full p-1.5 text-[#6d7f98] transition-colors hover:bg-slate-100 hover:text-slate-900">
            <SunMedium className="size-[0.95rem]" />
          </button>
          <div className="flex size-10 items-center justify-center rounded-full bg-[#43a047] text-[0.95rem] font-medium text-white">
            {(user?.fullName || user?.email || 'MO').slice(0, 2).toUpperCase()}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 rounded-full px-3.5 text-[0.9rem]" onClick={onLogout}>
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}

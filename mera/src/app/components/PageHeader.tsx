import { Bell, LogOut, RefreshCw, Shield, User } from 'lucide-react'
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
    <header className="border-b border-slate-200 bg-white px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-blue-700">
            <Shield className="size-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Malawi Energy Regulatory Authority
            </p>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="size-3 animate-spin" />
                Syncing portal data
              </span>
            ) : (
              'Portal synchronized'
            )}
          </div>
          <button className="relative rounded-md border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
            <Bell className="size-4" />
            <span className="absolute right-1 top-1 size-2 rounded-full bg-blue-600" />
          </button>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <User className="size-4 text-slate-500" />
            <div className="text-xs">
              <div className="font-medium text-slate-800">{user?.fullName || user?.email || 'MERA Officer'}</div>
              <div className="text-slate-500">{user?.role || 'Authenticated session'}</div>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}

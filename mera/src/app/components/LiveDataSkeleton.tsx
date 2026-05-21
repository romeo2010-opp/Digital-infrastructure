export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[6px] bg-[#e5e7eb] ${className}`} />
}

export function KpiSkeletonStrip({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-[6px] border border-[#e2e8f0] bg-white p-4">
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="mt-4 h-8 w-20" />
          <SkeletonBlock className="mt-4 h-4 w-36" />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white">
      <div className="grid gap-3 border-b border-[#f1f5f9] px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, index) => <SkeletonBlock key={index} className="h-3" />)}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3 border-b border-[#f9fafb] px-4 py-3 last:border-b-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, columnIndex) => <SkeletonBlock key={columnIndex} className="h-4" />)}
        </div>
      ))}
    </div>
  )
}

export function PanelSkeleton() {
  return (
    <div className="rounded-[6px] border border-[#e2e8f0] bg-white">
      <div className="border-b border-[#f1f5f9] px-4 py-3">
        <SkeletonBlock className="h-3 w-40" />
      </div>
      <div className="grid gap-3 p-4">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
    </div>
  )
}

export function PortalBootSkeleton() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4f5f7]">
      <header className="h-14 shrink-0 border-b border-[#e2e8f0] bg-white px-4">
        <div className="grid h-full grid-cols-[220px_minmax(220px,520px)_1fr] items-center gap-3">
          <SkeletonBlock className="h-9 w-44" />
          <SkeletonBlock className="h-9 w-full" />
          <div className="flex justify-end gap-2">
            <SkeletonBlock className="h-9 w-9" />
            <SkeletonBlock className="h-9 w-9" />
            <SkeletonBlock className="h-9 w-36" />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[72px] border-r border-[#e2e8f0] bg-white p-3">
          <div className="grid gap-2">
            {Array.from({ length: 10 }).map((_, index) => <SkeletonBlock key={index} className="h-10 w-10" />)}
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden p-4">
          <KpiSkeletonStrip count={4} />
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <TableSkeleton rows={8} columns={5} />
            <PanelSkeleton />
          </div>
        </main>
      </div>
    </div>
  )
}

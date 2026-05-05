export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; meta?: string }>
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <article key={item.label} className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {item.label}
          </span>
          <strong className="mt-1 block text-lg font-semibold text-slate-900">{item.value}</strong>
          {item.meta ? <small className="mt-1 block text-xs text-slate-500">{item.meta}</small> : null}
        </article>
      ))}
    </div>
  )
}

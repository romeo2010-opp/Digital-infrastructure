export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <article
          key={item.label}
          className="min-h-[6.25rem] rounded-[6px] border border-[var(--mera-panel-border)] bg-white px-4 py-3"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--mera-panel-text-muted)]">
            {item.label}
          </span>
          <strong className="mt-5 block text-[1.75rem] leading-none font-bold tracking-[-0.03em] text-[var(--mera-panel-text)]">
            {item.value}
          </strong>
        </article>
      ))}
    </div>
  );
}

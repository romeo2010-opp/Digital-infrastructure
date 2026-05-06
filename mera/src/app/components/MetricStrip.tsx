export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {items.map((item) => (
        <article
          key={item.label}
          className="min-h-[8.8rem] rounded-[1.15rem] border border-slate-100 bg-[#f4f6fb] px-6 py-5"
        >
          <span className="block text-[1.05rem] font-normal text-[#6c7891]">
            {item.label}
          </span>
          <strong className="mt-8 block text-[2.5rem] leading-none font-medium tracking-[-0.05em] text-slate-800">
            {item.value}
          </strong>
        </article>
      ))}
    </div>
  );
}

export function SmartLinkLoadingState({
  label = 'Loading workspace',
  detail = 'Preparing the latest school data.',
  variant = 'panel',
  className = '',
}: {
  label?: string
  detail?: string
  variant?: 'panel' | 'page' | 'overlay' | 'inline'
  className?: string
}) {
  const shellClass = {
    panel: 'grid min-h-[220px] place-items-center rounded-[8px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-6 shadow-[var(--mera-shadow-card)]',
    page: 'grid min-h-[420px] place-items-center p-6',
    overlay: 'grid place-items-center',
    inline: 'grid place-items-center',
  }[variant]

  const cardClass = variant === 'inline'
    ? 'w-full max-w-[360px]'
    : variant === 'overlay'
      ? 'w-full max-w-[360px] shadow-[0_24px_70px_rgba(15,23,42,0.24)]'
      : 'w-full max-w-[420px]'

  return (
    <div className={`${shellClass} ${className}`} role="status" aria-live="polite" aria-busy="true">
      <div className={`${cardClass} overflow-hidden rounded-[8px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)]`}>
        <div className="grid grid-cols-[52px_minmax(0,1fr)]">
          <div className="smartlink-loader-glyph relative grid place-items-center border-r border-[var(--mera-panel-border-soft)] bg-[var(--mera-panel-muted)]">
            <span />
            <span />
            <span />
          </div>
          <div className="min-w-0 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold tracking-[0]">{label}</p>
                <p className="mt-0.5 truncate text-[12px] font-medium text-[var(--mera-panel-text-muted)]">{detail}</p>
              </div>
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#6bdd9e] shadow-[0_0_0_4px_rgba(107,221,158,0.14)]" />
            </div>
            <div className="smartlink-loader-meter mt-3 h-1 overflow-hidden rounded-full bg-[var(--mera-panel-border-soft)]" />
          </div>
        </div>
      </div>
    </div>
  )
}

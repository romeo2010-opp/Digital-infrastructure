import React from 'react'

export function SectionCard({
  title,
  subtitle,
  children,
  actions,
  className = '',
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] shadow-[var(--mera-shadow-card)] ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--mera-panel-border-soft)] px-4 py-3">
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--mera-panel-text)]">{title}</h3>
          {subtitle ? <p className="mt-1 text-[11px] leading-5 text-[var(--mera-panel-text-muted)]">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

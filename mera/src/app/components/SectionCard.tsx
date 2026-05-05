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
    <section className={`rounded-md border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

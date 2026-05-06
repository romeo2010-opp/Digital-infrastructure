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
    <section className={`flex flex-col overflow-hidden rounded-[1.45rem] border border-slate-200/80 bg-white shadow-[0_8px_24px_-22px_rgba(15,23,42,0.18)] ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-[1.02rem] font-semibold tracking-[-0.02em] text-slate-900">{title}</h3>
          {subtitle ? <p className="mt-1 text-[0.95rem] leading-6 text-[#6b7b91]">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

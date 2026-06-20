import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

export function FieldLabel({
  label,
  hint,
  className = '',
}: {
  label: string
  hint?: string
  className?: string
}) {
  return (
    <span className={`mb-1.5 flex items-center gap-1.5 text-[12px] font-medium tracking-[-0.012em] text-[#4b5563] ${className}`}>
      <span>{label}</span>
      {hint ? (
        <span
          className="group relative inline-grid size-4 place-items-center rounded-full border border-[#e2e8f0] bg-white text-[#94a3b8] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827] focus:border-[#cbd5e1] focus:bg-[#f8fafc] focus:text-[#111827] focus:outline-none"
          tabIndex={0}
          aria-label={`${label} help`}
          title={hint}
        >
          <Info className="size-3" aria-hidden="true" />
          <span className="pointer-events-none absolute left-1/2 top-5 z-50 w-60 -translate-x-1/2 translate-y-1 rounded-[6px] border border-[#111827] bg-[#111827] px-3 py-2 text-left text-[11px] font-medium normal-case leading-5 tracking-[-0.01em] text-white opacity-0 shadow-[0_18px_40px_rgba(15,23,42,0.22)] transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100">
            {hint}
          </span>
        </span>
      ) : null}
    </span>
  )
}

export function FieldShell({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <FieldLabel label={label} hint={hint} />
      {children}
    </label>
  )
}

export function FieldControl({
  label,
  hint,
  className = '',
  labelClassName = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  labelClassName?: string
  children: ReactNode
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <FieldLabel label={label} hint={hint} className={labelClassName} />
      {children}
    </div>
  )
}

export function ToolbarField({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <FieldControl
      label={label}
      hint={hint}
      className={`grid min-w-[150px] gap-1 ${className}`}
      labelClassName="mb-0 text-[10px]"
    >
      {children}
    </FieldControl>
  )
}

export function ToggleField({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <FieldLabel label={label} hint={hint} />
      <div className="flex items-center gap-3">
        {children}
      </div>
    </div>
  )
}

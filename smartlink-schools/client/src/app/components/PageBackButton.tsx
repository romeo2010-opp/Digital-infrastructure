import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'

export function PageBackButton({ fallback = '/dashboard', label = 'Back', iconOnly = false, className = '' }: { fallback?: string; label?: string; iconOnly?: boolean; className?: string }) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => {
        const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx : 0
        if (historyIndex && historyIndex > 0) navigate(-1)
        else navigate(fallback)
      }}
      aria-label={label}
      title={label}
      className={`group inline-flex h-9 items-center justify-center gap-2 rounded-[7px] border border-[#d8dee8] bg-white px-3 text-[12px] font-semibold text-[#334155] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:border-[#b8c2d1] hover:bg-[#f8fafc] hover:text-[#0f172a] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#94a3b8]/35 active:translate-y-px ${iconOnly ? 'w-9 px-0' : ''} ${className}`}
    >
      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </button>
  )
}

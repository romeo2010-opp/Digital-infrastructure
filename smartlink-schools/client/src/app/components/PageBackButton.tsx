import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'

export function PageBackButton({ fallback = '/dashboard', label = 'Back' }: { fallback?: string; label?: string }) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => {
        const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx : 0
        if (historyIndex && historyIndex > 0) navigate(-1)
        else navigate(fallback)
      }}
      className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-3 text-xs font-semibold text-[var(--mera-panel-text-soft)] transition hover:bg-[var(--mera-panel-muted)] hover:text-[var(--mera-panel-text)]"
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </button>
  )
}

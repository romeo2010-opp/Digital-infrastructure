import { useEffect, useMemo, useState } from 'react'

function estimatedDuration(label: string) {
  const normalized = label.toLowerCase()
  if (/generat|analys|import|upload/.test(normalized)) return 30
  if (/export|download|report|calculate/.test(normalized)) return 18
  if (/save|creat|updat|publish/.test(normalized)) return 12
  return 15
}

export function ActionLoadingOverlay({
  visible,
  label = 'Completing request...',
}: {
  visible: boolean
  label?: string
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const estimate = useMemo(() => estimatedDuration(label), [label])

  useEffect(() => {
    if (!visible) {
      setElapsedSeconds(0)
      return
    }
    const startedAt = Date.now()
    setElapsedSeconds(0)
    const timer = window.setInterval(() => setElapsedSeconds((Date.now() - startedAt) / 1000), 250)
    return () => window.clearInterval(timer)
  }, [visible, label])

  if (!visible) return null

  const progress = Math.min(94, Math.round(8 + (1 - Math.exp(-elapsedSeconds / Math.max(estimate * 0.55, 1))) * 86))
  const remaining = Math.max(0, Math.ceil(estimate - elapsedSeconds))

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#111827]/28 p-4 backdrop-blur-[2px]">
      <div
        className="w-full max-w-[390px] overflow-hidden rounded-[10px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)] shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Working on it</p>
              <p className="mt-1 text-[12px] font-medium text-[var(--mera-panel-text-muted)]">{label}</p>
            </div>
            <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#185FA5]">{progress}%</span>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--mera-panel-border-soft)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={`${label}: ${progress}% complete`}
          >
            <span className="block h-full rounded-full bg-[#185FA5] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[var(--mera-panel-text-muted)]">
            <span>{Math.floor(elapsedSeconds)}s elapsed</span>
            <span>{remaining > 0 ? `About ${remaining}s remaining` : 'Finishing up…'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

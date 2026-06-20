import { Loader2 } from 'lucide-react'

export function ActionLoadingOverlay({
  visible,
  label = 'Completing request...',
}: {
  visible: boolean
  label?: string
}) {
  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#111827]/28 p-4 backdrop-blur-[2px]">
      <div className="flex min-w-[260px] items-center gap-3 rounded-[8px] border border-[#e2e8f0] bg-white px-4 py-3 text-[#111827] shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
        <Loader2 className="size-5 animate-spin text-[#2563eb]" />
        <div>
          <div className="text-[13px] font-bold">Please wait</div>
          <div className="mt-0.5 text-[12px] font-medium text-[#6b7280]">{label}</div>
        </div>
      </div>
    </div>
  )
}

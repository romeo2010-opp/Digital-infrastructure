import { SmartLinkLoadingState } from './SmartLinkLoadingState'

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
      <SmartLinkLoadingState variant="overlay" label="Please wait" detail={label} />
    </div>
  )
}

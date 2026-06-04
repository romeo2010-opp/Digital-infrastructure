import InternalShell from "../components/InternalShell"
import InternalSettingsModal from "../components/InternalSettingsModal"

export default function SettingsPage({ section = "preferences" }) {
  return (
    <InternalShell title="Settings" contentClassName="internal-page-inner--settings">
      <InternalSettingsModal embedded section={section} />
    </InternalShell>
  )
}

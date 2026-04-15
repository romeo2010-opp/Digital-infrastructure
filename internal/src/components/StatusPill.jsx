import { normalizeTone } from "../utils/display"

export default function StatusPill({ value, tone = null }) {
  const label = String(value || "-").replace(/_/g, " ")
  const resolvedTone = tone || normalizeTone(value)
  return <span className={`status-pill status-pill--${resolvedTone}`}>{label}</span>
}

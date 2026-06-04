import { formatCodeLabel, normalizeTone } from "../utils/display"

export default function StatusPill({ value, tone = null }) {
  const label = formatCodeLabel(value)
  const resolvedTone = tone || normalizeTone(value)
  return <span className={`status-pill status-pill--${resolvedTone}`}>{label}</span>
}

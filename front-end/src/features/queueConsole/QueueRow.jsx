import { useState } from "react"

function badgeClass(status) {
  return `qc-badge qc-badge-${status.toLowerCase().replace(/[^a-z]/g, "-")}`
}

export default function QueueRow({
  entry,
  onMarkServed,
  onMarkNoShow,
  onMarkLate,
  onSkip,
}) {
  const [skipReason, setSkipReason] = useState("")

  return (
    <tr>
      <td>{entry.maskedIdentifier}</td>
      <td>{entry.positionText}</td>
      <td>{entry.joinTime}</td>
      <td>{entry.waitDuration}</td>
      <td><span className={badgeClass(entry.status)}>{entry.status}</span></td>
      <td>{entry.etaLabel}</td>
      <td>
        <div className="qc-row-actions">
          <button type="button" onClick={() => onMarkServed(entry.id)}>Mark Served</button>
          <button type="button" onClick={() => onMarkNoShow(entry.id)}>Mark No-show</button>
          <button type="button" onClick={() => onMarkLate(entry.id)}>Mark Late</button>
          <div className="qc-skip-control">
            <input
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
              placeholder="Skip reason"
            />
            <button
              type="button"
              onClick={() => {
                onSkip(entry.id, skipReason.trim() || "No reason given")
                setSkipReason("")
              }}
            >
              Skip
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

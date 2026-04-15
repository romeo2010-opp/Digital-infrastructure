import { useState } from "react"

export default function QueueControls({ onCallNext, onRecall, onCallPosition }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState("")
  const [reason, setReason] = useState("")

  function submitCallPosition(event) {
    event.preventDefault()
    const parsed = Number(position)
    if (!parsed || parsed < 1) return
    onCallPosition(parsed, reason.trim())
    setPosition("")
    setReason("")
    setOpen(false)
  }

  return (
    <section className="qc-panel qc-controls">
      <h3>Queue Movement</h3>
      <div className="qc-controls-actions">
        <button type="button" onClick={onCallNext}>Call Next</button>
        <button type="button" onClick={onRecall}>Re-call</button>
        <button type="button" onClick={() => setOpen(true)}>Call Specific Position</button>
      </div>

      {open ? (
        <div className="qc-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="qc-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Call specific queue position"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h4>Call Specific Position</h4>
            </header>
            <form onSubmit={submitCallPosition}>
              <label>
                Position Number
                <input
                  type="number"
                  min="1"
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  required
                />
              </label>
              <label>
                Reason
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Manual override"
                />
              </label>
              <div className="qc-modal-actions">
                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit">Call Position</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

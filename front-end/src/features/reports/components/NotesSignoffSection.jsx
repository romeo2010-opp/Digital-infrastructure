import { useState } from "react"
import { getSessionMeta } from "../../../auth/authSession"
import { formatDateTime } from "../../../utils/dateTime"

export default function NotesSignoffSection({
  reportRun,
  notes,
  onAddNote,
  onFinalize,
  onUnfinalize,
}) {
  const [draft, setDraft] = useState("")
  const isFinal = reportRun?.status === "FINAL"
  const sessionMeta = getSessionMeta()
  const preparedBy = sessionMeta?.user?.fullName || "Station Manager"

  function saveDraft() {
    if (!draft.trim()) return
    onAddNote(draft.trim())
    setDraft("")
  }

  return (
    <section className="reports-panel reports-signoff">
      <h3>Notes & Sign-off</h3>
      <label>
        Notes
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a report note"
          disabled={isFinal}
        />
      </label>
      <div className="reports-inline-actions">
        <button type="button" onClick={saveDraft} disabled={isFinal}>Save Draft</button>
        <button type="button" onClick={() => onFinalize(reportRun.id)} disabled={isFinal}>
          Finalize Report
        </button>
        <button type="button" onClick={() => onUnfinalize(reportRun.id)} disabled={!isFinal}>
          Reopen Report
        </button>
      </div>

      <div className="reports-signoff-meta">
        <p><strong>Prepared By:</strong> {preparedBy}</p>
        <p><strong>Reviewed By:</strong> Area Supervisor</p>
        <p><strong>Status:</strong> {reportRun.status}</p>
      </div>

      <ul className="reports-notes-list">
        {notes.map((note) => (
          <li key={note.id}>
            <p>{note.text}</p>
            <small>{note.author} · {formatDateTime(note.createdAt)}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

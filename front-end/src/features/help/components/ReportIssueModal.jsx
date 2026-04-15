import { useMemo, useState } from "react"

const categoryOptions = ["Pump", "Tank", "Queue", "Reservation", "Reports", "Staff", "Network", "Other"]
const severityOptions = ["Low", "Medium", "Critical"]

export default function ReportIssueModal({
  open,
  onClose,
  onSubmit,
  stationId,
  userId,
  lastSyncAt,
  appBuild,
}) {
  const [form, setForm] = useState({
    category: "Pump",
    severity: "Medium",
    title: "",
    description: "",
    screenshotUrl: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const autoContext = useMemo(
    () => ({
      stationId: stationId || "UNKNOWN_STATION",
      userId: userId || "UNKNOWN_USER",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      appBuild: appBuild || "unknown",
      lastSyncAt: lastSyncAt || null,
    }),
    [stationId, userId, appBuild, lastSyncAt]
  )

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      if (!form.title.trim()) {
        throw new Error("Short title is required")
      }
      if (!form.description.trim()) {
        throw new Error("Detailed description is required")
      }
      await onSubmit({
        category: form.category,
        severity: form.severity,
        title: form.title.trim(),
        description: form.description.trim(),
        screenshotUrl: form.screenshotUrl.trim() || undefined,
        context: autoContext,
      })
      setForm({
        category: "Pump",
        severity: "Medium",
        title: "",
        description: "",
        screenshotUrl: "",
      })
      onClose()
    } catch (submitError) {
      setError(submitError?.message || "Failed to submit issue")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="help-v1-modal-backdrop" onClick={onClose}>
      <div className="help-v1-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h4>Report an Issue</h4>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <form className="help-v1-form" onSubmit={submit}>
          <label>
            Issue category
            <select value={form.category} onChange={(event) => update("category", event.target.value)}>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            Severity
            <select value={form.severity} onChange={(event) => update("severity", event.target.value)}>
              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            Short title
            <input
              value={form.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Example: Pump 3 offline while dispensing"
            />
          </label>

          <label>
            Detailed description
            <textarea
              rows={5}
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Include exact time, pump/tank IDs, and actions already tried."
            />
          </label>

          <label>
            Screenshot URL (optional)
            <input
              value={form.screenshotUrl}
              onChange={(event) => update("screenshotUrl", event.target.value)}
              placeholder="Paste screenshot URL if available"
            />
          </label>

          <details className="help-v1-context">
            <summary>Auto-captured context</summary>
            <ul>
              <li>stationId: {autoContext.stationId}</li>
              <li>userId: {autoContext.userId}</li>
              <li>userAgent: {autoContext.userAgent}</li>
              <li>appBuild: {autoContext.appBuild}</li>
              <li>lastSyncAt: {autoContext.lastSyncAt || "unknown"}</li>
            </ul>
          </details>

          {error ? <p className="help-v1-error">{error}</p> : null}

          <div className="help-v1-form-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

import { useMemo, useState } from "react"
import { formatDateTime, formatTime } from "../../../utils/dateTime"

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>
}

export default function ExceptionsAuditSection({ audit, incidents, notes, exceptions }) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return audit
    return audit.filter((row) => row.actionType.toLowerCase().includes(q) || row.summary.toLowerCase().includes(q))
  }, [audit, query])


function parseDate(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  return Number.isNaN(date.getTime()) ? null : date
}

function smartDate(isoString){
  const date = parseDate(isoString)
  if (!date) return "-"

  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const tomorrowUtc = new Date(todayUtc)
  tomorrowUtc.setUTCDate(todayUtc.getUTCDate() + 1)

  const isSameDay = (a,b) =>
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCFullYear() === b.getUTCFullYear()

  if (isSameDay(date, todayUtc)) {
    return `Today · ${formatTime(isoString)}`
  }

  if (isSameDay(date, tomorrowUtc)) {
    return `Tomorrow · ${formatTime(isoString)}`
  }

  return formatDateTime(isoString)
}

  return (
    <section className="reports-panel" id="reports-exceptions-section">
      <header className="reports-section-header">
        <h3>Exceptions & Audit</h3>
        <label>
          Audit Filter
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Action or summary" />
        </label>
      </header>

      {exceptions ? (
        <div className="reports-table-wrap">
          <table className="reports-data-table">
            <thead>
              <tr>
                <th>Exception</th>
                <th className="reports-cell-number">Count</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Transactions missing nozzle_id</td>
                <td className="reports-cell-number">{exceptions.missingNozzleTxCount || 0}</td>
              </tr>
              <tr>
                <td>Offline nozzles</td>
                <td className="reports-cell-number">{(exceptions.offlineNozzles || []).length}</td>
              </tr>
              <tr>
                <td>Voids</td>
                <td className="reports-cell-number">{exceptions.voidCount || 0}</td>
              </tr>
              <tr>
                <td>Overrides</td>
                <td className="reports-cell-number">{exceptions.overrideCount || 0}</td>
              </tr>
              <tr>
                <td>Transactions under review / cancelled</td>
                <td className="reports-cell-number">{exceptions.transactionInspectionCount || 0}</td>
              </tr>
            </tbody>
          </table>
          {(exceptions.warnings || []).length ? (
            <p className="settings-error">{exceptions.warnings.join(" | ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (filtered.map((row) => (
              <tr key={row.id}>
                <td>{smartDate(row.timestamp)}</td>
                <td>{row.actor}</td>
                <td>{row.actionType}</td>
                <td className="reports-cell-wrap">{row.summary}</td>
              </tr>
            ))) : (
              <tr>
                <td className="reports-table-empty" colSpan={4}>
                  No Exceptions or Audit logs at the moment
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h4>Incidents</h4>
      <ul className="reports-incidents-list">
        {incidents.length ? (incidents.map((incident) => (
          <li key={incident.id}>
            <strong>{incident.title}</strong>
            <span>{incident.severity}</span>
            <small>{incident.status}</small>
          </li>
        ))) : <EmptyState message={"No Incidents recorded at the moment"}/>}
      </ul>

      <h4>Variance Explanations & Notes</h4>
      <ul className="reports-notes-list">
        {notes.length ? ((notes || []).map((note) => (
          <li key={note.id}>
            <p>{note.text}</p>
            <small>{note.author} - {formatDateTime(note.createdAt)}</small>
          </li>
        ))) : <EmptyState message={"No notes on variance "} />}
      </ul>
    </section>
  )
}

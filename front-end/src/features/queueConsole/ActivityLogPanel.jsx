import { formatTime } from "../../utils/dateTime"

export default function ActivityLogPanel({ auditLogs }) {
  return (
    <section className="qc-panel qc-activity-log">
      <h3>Activity Log</h3>
      {auditLogs.length ? (
        <ul>
          {auditLogs.slice(0, 20).map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.actionType}</strong>
                <small>{item.summary}</small>
              </div>
              <div>
                <small>{item.actor}</small>
                <small>{formatTime(item.timestamp)}</small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="qc-empty">No activity logs yet.</p>
      )}
    </section>
  )
}

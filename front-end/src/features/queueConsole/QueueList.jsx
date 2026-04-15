import QueueRow from "./QueueRow"

export default function QueueList({
  entries,
  queueLength,
  lastMovementLabel,
  onMarkServed,
  onMarkNoShow,
  onMarkLate,
  onSkip,
}) {
  return (
    <section className="qc-panel qc-queue-list">
      <header className="qc-panel-header">
        <h3>Live Queue Monitoring</h3>
        <div>
          <small>Queue Length: {queueLength}</small>
          <small>Last Movement: {lastMovementLabel}</small>
        </div>
      </header>
      {entries.length ? (
        <div className="qc-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identifier</th>
                <th>Position</th>
                <th>Join Time</th>
                <th>Waiting</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <QueueRow
                  key={entry.id}
                  entry={entry}
                  onMarkServed={onMarkServed}
                  onMarkNoShow={onMarkNoShow}
                  onMarkLate={onMarkLate}
                  onSkip={onSkip}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="qc-empty">No queue entries match current filters.</p>
      )}
    </section>
  )
}

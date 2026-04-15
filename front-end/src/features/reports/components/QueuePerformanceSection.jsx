export default function QueuePerformanceSection({ queue }) {
  return (
    <section className="reports-panel" id="reports-queue-section">
      <header className="reports-section-header">
        <h3>Queue Performance</h3>
      </header>

      {!queue.enabled ? (
        <p className="reports-banner">Queue disabled for this station. Showing last known values.</p>
      ) : null}

      <div className="reports-queue-stats">
        <article><span>Joined</span><strong>{queue.stats.joined}</strong></article>
        <article><span>Served</span><strong>{queue.stats.served}</strong></article>
        <article><span>No-show Rate</span><strong>{queue.stats.noShowRate}%</strong></article>
        <article><span>Avg Wait</span><strong>{queue.stats.avgWaitMin ? `${queue.stats.avgWaitMin} min` : "Not available yet"}</strong></article>
        <article><span>Peak Window</span><strong>{queue.stats.peakWindow}</strong></article>
        <article><span>Peak Queue Size</span><strong>{queue.stats.peakQueueSize}</strong></article>
      </div>

      <article className="reports-chart-placeholder">
        <h4>Queue Throughput by Hour</h4>
        <div>Chart Placeholder</div>
      </article>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Hour</th>
              <th className="reports-cell-number">Joined</th>
              <th className="reports-cell-number">Served</th>
              <th className="reports-cell-number">No-show</th>
              <th className="reports-cell-number">Avg Wait (min)</th>
            </tr>
          </thead>
          <tbody>
            {queue.hourly.map((row) => (
              <tr key={row.hour}>
                <td>{row.hour}</td>
                <td className="reports-cell-number">{row.joined}</td>
                <td className="reports-cell-number">{row.served}</td>
                <td className="reports-cell-number">{row.noShow}</td>
                <td className="reports-cell-number">{row.avgWaitMin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

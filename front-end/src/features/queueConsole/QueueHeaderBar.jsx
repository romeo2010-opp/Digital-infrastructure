export default function QueueHeaderBar({ stationName, stationStatus, lastUpdatedAt, onRefresh }) {
  return (
    <section className="qc-panel qc-header-bar">
      <div>
        <h2>Digital Queue Console</h2>
        <p>Station manager operations and live queue movement.</p>
      </div>

      <div className="qc-header-right">
        <label>
          Station
          <select disabled value={stationName || "Select Station"}>
            <option>{stationName || "Select Station"}</option>
          </select>
        </label>
        <div className="qc-header-meta">
          <strong>Status: {stationStatus}</strong>
          <small>Last Updated: {lastUpdatedAt}</small>
        </div>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>
    </section>
  )
}

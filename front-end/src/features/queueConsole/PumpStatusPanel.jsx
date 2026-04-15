import { Link } from "react-router-dom"

const reasons = ["", "Calibration", "Maintenance", "Network issue", "Sensor fault", "Manual pause"]

export default function PumpStatusPanel({ pumps, onUpdatePumpStatus }) {
  return (
    <section className="qc-panel qc-pump-panel">
      <h3>Pump Control</h3>
      <div className="qc-pump-grid">
        {pumps.map((pump) => (
          <article key={pump.id} className="qc-pump-card">
            <header>
              <strong>{pump.label}</strong>
              <small>{pump.fuelType}</small>
            </header>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {(pump.nozzles || []).map((nozzle) => (
                <span key={nozzle.publicId} style={{ padding: "2px 8px", border: "1px solid #c6d5e5", borderRadius: 999, fontSize: 12 }}>
                  #{nozzle.nozzleNumber} {nozzle.fuelType || "UNK"} {nozzle.status}
                </span>
              ))}
            </div>

            <label>
              Status
              <select
                value={pump.status}
                onChange={(event) => onUpdatePumpStatus(pump.id, event.target.value, pump.reason)}
              >
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Offline">Offline</option>
                <option value="Idle">Idle</option>
                <option value="Degraded">Degraded</option>
                <option value="Dispensing">Dispensing</option>
              </select>
            </label>

            <label>
              Reason
              <select
                value={pump.reason || ""}
                onChange={(event) => onUpdatePumpStatus(pump.id, pump.status, event.target.value)}
              >
                {reasons.map((reason) => (
                  <option key={`${pump.id}-${reason || "none"}`} value={reason}>
                    {reason || "No reason"}
                  </option>
                ))}
              </select>
            </label>

            <Link className="qc-live-monitor-link" to={`/monitoring/pumps/${encodeURIComponent(pump.id)}`}>
              Live Monitor
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

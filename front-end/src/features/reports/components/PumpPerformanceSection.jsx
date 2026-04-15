import { useMemo, useState } from "react"

export default function PumpPerformanceSection({ rows }) {
  const [sortBy, setSortBy] = useState("uptimePct")
  const [sortDir, setSortDir] = useState("desc")
  const [selected, setSelected] = useState(null)

  const sorted = useMemo(() => {
    const cloned = [...rows]
    cloned.sort((a, b) => {
      const first = a[sortBy]
      const second = b[sortBy]
      if (first > second) return sortDir === "asc" ? 1 : -1
      if (first < second) return sortDir === "asc" ? -1 : 1
      return 0
    })
    return cloned
  }, [rows, sortBy, sortDir])

  function setSort(field) {
    if (field === sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortBy(field)
    setSortDir("desc")
  }

  return (
    <section className="reports-panel" id="reports-pumps-section">
      <header className="reports-section-header">
        <h3>Pump Performance</h3>
        <small>Click column headers to sort.</small>
      </header>
      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th className="reports-sortable" onClick={() => setSort("pumpId")}>Pump</th>
              <th className="reports-sortable" onClick={() => setSort("fuelType")}>Fuel</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("uptimePct")}>Uptime %</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("litresDispensed")}>Litres</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("revenue")}>Revenue</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("txCount")}>Tx Count</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("statusChangeCount")}>Status Changes</th>
              <th className="reports-cell-number reports-sortable" onClick={() => setSort("avgTransactionTimeSec")}>Avg Txn (s)</th>
              <th className="reports-cell-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={`${row.pumpPublicId || row.pumpId}-${row.fuelType}`}>
                <td>{row.pumpId}</td>
                <td>{row.fuelType}</td>
                <td className="reports-cell-number">{row.uptimePct}</td>
                <td className="reports-cell-number">{row.litresDispensed.toLocaleString()}</td>
                <td className="reports-cell-number">MWK {row.revenue.toLocaleString()}</td>
                <td className="reports-cell-number">{row.txCount}</td>
                <td className="reports-cell-number">{row.statusChangeCount}</td>
                <td className="reports-cell-number">{row.avgTransactionTimeSec}</td>
                <td className="reports-cell-center">
                  <button type="button" onClick={() => setSelected(row)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className={`reports-drawer ${selected ? "open" : ""}`}>
        <header>
          <h4>Pump Details</h4>
          <button type="button" onClick={() => setSelected(null)}>Close</button>
        </header>
        {selected ? (
          <div className="reports-drawer-body">
            <p><strong>ID:</strong> {selected.pumpId}</p>
            <p><strong>Fuel:</strong> {selected.fuelType}</p>
            <p><strong>Uptime:</strong> {selected.uptimePct}%</p>
            <p><strong>Litres:</strong> {selected.litresDispensed}</p>
            <p><strong>Revenue:</strong> MWK {selected.revenue.toLocaleString()}</p>
            <p><strong>Transactions:</strong> {selected.txCount}</p>
            <p><strong>Status Changes:</strong> {selected.statusChangeCount}</p>
            <p><strong>Avg Txn Time:</strong> {selected.avgTransactionTimeSec}s</p>
            <p><strong>Nozzles:</strong> {(selected.nozzles || []).length}</p>
            {(selected.nozzles || []).map((nozzle) => (
              <p key={nozzle.nozzlePublicId || `${selected.pumpId}-${nozzle.nozzleNumber}`}>
                #{nozzle.nozzleNumber}{nozzle.side ? ` (${nozzle.side})` : ""} {nozzle.fuelType} {nozzle.status} | Tx {nozzle.txCount} | L {nozzle.litresDispensed}
              </p>
            ))}
          </div>
        ) : null}
      </aside>
    </section>
  )
}

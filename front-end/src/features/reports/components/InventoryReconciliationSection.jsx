import { useEffect, useMemo, useState } from "react"

function roundUpToTwoDecimals(value) {
  return Math.ceil(value * 100) / 100
}

function createDefaultArrivalTimeValue() {
  const date = new Date(Date.now() + (30 * 60 * 1000))
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export default function InventoryReconciliationSection({
  rows,
  isReadOnly,
  onAddDelivery,
  onAddReading,
  onExplainVariance,
  onCreateIncident,
}) {
  const [modal, setModal] = useState("")
  const [form, setForm] = useState({
    rowId: rows[0]?.id || "",
    deliveredLitres: "",
    supplierName: "",
    arrivalTime: createDefaultArrivalTimeValue(),
    opening: "",
    closing: "",
    reason: "",
    note: "",
    severity: "LOW",
    title: "",
  })

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function openModal(nextModal) {
    setForm((prev) => ({
      ...prev,
      rowId: prev.rowId || rows[0]?.id || "",
      deliveredLitres: nextModal === "delivery" ? "" : prev.deliveredLitres,
      supplierName: nextModal === "delivery" ? "" : prev.supplierName,
      arrivalTime: nextModal === "delivery" ? createDefaultArrivalTimeValue() : prev.arrivalTime,
    }))
    setModal(nextModal)
  }

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === form.rowId) || rows[0] || null,
    [rows, form.rowId]
  )

  useEffect(() => {
    if (!rows.length) return
    if (!form.rowId) {
      setForm((prev) => ({ ...prev, rowId: rows[0].id }))
    }
  }, [rows, form.rowId])

  useEffect(() => {
    if (modal !== "reading" || !selectedRow) return
    setForm((prev) => ({
      ...prev,
      opening: selectedRow.opening !== null ? String(selectedRow.opening) : "",
      closing: selectedRow.closing !== null ? String(selectedRow.closing) : "",
    }))
  }, [modal, selectedRow])

  function submit(event) {
    event.preventDefault()
    if (modal === "delivery") {
      const arrivalDate = new Date(form.arrivalTime)
      onAddDelivery({
        rowId: form.rowId,
        deliveredLitres: Number(form.deliveredLitres || 0),
        supplierName: form.supplierName?.trim() || undefined,
        arrivalTime: Number.isNaN(arrivalDate.getTime()) ? undefined : arrivalDate.toISOString(),
      })
    }
    if (modal === "reading") onAddReading({ rowId: form.rowId, opening: form.opening, closing: form.closing })
    if (modal === "variance") onExplainVariance(form.rowId, form.reason, form.note)
    if (modal === "incident") onCreateIncident({ severity: form.severity, title: form.title })
    setModal("")
  }

  return (
    <section className="reports-panel" id="reports-inventory-section">
      <header className="reports-section-header">
        <h3>Inventory Reconciliation</h3>
        <div className="reports-inline-actions">
          <button type="button" onClick={() => openModal("delivery")} disabled={isReadOnly}>Add Delivery Record</button>
          <button type="button" onClick={() => openModal("reading")} disabled={isReadOnly}>Add Opening/Closing Reading</button>
          <button type="button" onClick={() => openModal("variance")} disabled={isReadOnly}>Explain Variance</button>
          <button type="button" onClick={() => openModal("incident")} disabled={isReadOnly}>Create Incident</button>
        </div>
      </header>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Tank / Fuel</th>
              <th className="reports-cell-number">Opening</th>
              <th className="reports-cell-number">Deliveries</th>
              <th className="reports-cell-number">Closing</th>
              <th className="reports-cell-number">Book Sales</th>
              <th className="reports-cell-number">Recorded Sales</th>
              <th className="reports-cell-number">Variance (L)</th>
              <th className="reports-cell-number">Variance %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.tank} ({row.fuelType})</td>
                <td className="reports-cell-number reports-cell-number--with-source">
                  <span className="reports-cell-value">
                    {row.opening === null ? "Empty" : row.opening.toLocaleString()}
                  </span>
                  {row.openingSource === "previous_closing" ? (
                    <small className="reports-cell-source-tag">From previous day closing</small>
                  ) : null}
                </td>
                <td className="reports-cell-number">{row.deliveries.toLocaleString()}</td>
                <td className="reports-cell-number">{row.closing === null ? "Empty" : row.closing.toLocaleString()}</td>
                <td className="reports-cell-number">{row.bookSales === null ? "Empty" : row.bookSales.toLocaleString()}</td>
                <td className="reports-cell-number">{row.recordedSales.toLocaleString()}</td>
                <td className="reports-cell-number">{row.varianceLitres === null ? "Empty" : roundUpToTwoDecimals(row.varianceLitres).toFixed(2)}</td>
                <td className="reports-cell-number">{row.variancePct === null ? "Empty" : `${roundUpToTwoDecimals(row.variancePct).toFixed(2)}%`}</td>
                <td>
                  {row.missingData
                    ? `Missing ${row.missingFields.join(", ")}`
                    : row.attention
                      ? "Attention"
                      : "OK"}
                  {row.excludedTransactions ? (
                    <div style={{ marginTop: 6, fontSize: "0.8rem", opacity: 0.75 }}>
                      Excluding {row.excludedTransactions} reviewed tx ({row.excludedLitres.toLocaleString()}L)
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal ? (
        <div className="reports-modal-backdrop" onClick={() => setModal("")}>
          <div className="reports-modal" onClick={(event) => event.stopPropagation()}>
            <h4>
              {modal === "delivery" ? "Add Delivery Record" : ""}
              {modal === "reading" ? "Add Opening/Closing Reading" : ""}
              {modal === "variance" ? "Explain Variance" : ""}
              {modal === "incident" ? "Create Incident" : ""}
            </h4>
            <form onSubmit={submit} className="reports-form-grid">
              {modal !== "incident" ? (
                <label>
                  Row
                  <select value={form.rowId} onChange={(event) => update("rowId", event.target.value)}>
                    {rows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.tank}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {modal === "delivery" ? (
                <>
                  <label>
                    Delivered Litres
                    <input type="number" value={form.deliveredLitres} onChange={(event) => update("deliveredLitres", event.target.value)} />
                  </label>
                  <label>
                    Supplier Name
                    <input value={form.supplierName} onChange={(event) => update("supplierName", event.target.value)} />
                  </label>
                  <label>
                    Expected Arrival
                    <input
                      type="datetime-local"
                      value={form.arrivalTime}
                      onChange={(event) => update("arrivalTime", event.target.value)}
                      required
                    />
                  </label>
                </>
              ) : null}

              {modal === "reading" ? (
                <>
                  <label>
                    Opening
                    <input type="number" value={form.opening} onChange={(event) => update("opening", event.target.value)} />
                  </label>
                  <label>
                    Closing
                    <input type="number" value={form.closing} onChange={(event) => update("closing", event.target.value)} />
                  </label>
                  {selectedRow ? (
                    <small>
                      Current DB values: Opening {selectedRow.opening ?? "N/A"}, Closing {selectedRow.closing ?? "N/A"}
                    </small>
                  ) : null}
                </>
              ) : null}

              {modal === "variance" ? (
                <>
                  <label>
                    Reason
                    <input value={form.reason} onChange={(event) => update("reason", event.target.value)} />
                  </label>
                  <label>
                    Note
                    <input value={form.note} onChange={(event) => update("note", event.target.value)} />
                  </label>
                </>
              ) : null}

              {modal === "incident" ? (
                <>
                  <label>
                    Severity
                    <select value={form.severity} onChange={(event) => update("severity", event.target.value)}>
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </select>
                  </label>
                  <label>
                    Title
                    <input value={form.title} onChange={(event) => update("title", event.target.value)} />
                  </label>
                </>
              ) : null}

              <div className="reports-inline-actions">
                <button type="button" onClick={() => setModal("")}>Cancel</button>
                <button type="submit" disabled={isReadOnly}>Submit</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

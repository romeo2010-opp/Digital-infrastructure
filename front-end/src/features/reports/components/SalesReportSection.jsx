import { useState } from "react"
import { formatDateTime } from "../../../utils/dateTime"

export default function SalesReportSection({ sales }) {
  const [showTransactions, setShowTransactions] = useState(false)

  return (
    <section className="reports-panel" id="reports-sales-section">
      <header className="reports-section-header">
        <h3>Sales Report</h3>
        <button type="button" onClick={() => setShowTransactions(true)}>View Transactions</button>
      </header>

      <div className="reports-chart-grid">
        <article className="reports-chart-placeholder">
          <h4>Sales Trend (Hourly)</h4>
          <div>Chart Placeholder</div>
        </article>
        <article className="reports-chart-placeholder">
          <h4>Sales by Pump</h4>
          <div>Chart Placeholder</div>
        </article>
      </div>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Fuel Type</th>
              <th className="reports-cell-number">Litres</th>
              <th className="reports-cell-number">Revenue</th>
              <th className="reports-cell-number">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {sales.breakdown.map((row) => (
              <tr key={row.fuelType}>
                <td>{row.fuelType}</td>
                <td className="reports-cell-number">{row.litres.toLocaleString()}</td>
                <td className="reports-cell-number">MWK {row.revenue.toLocaleString()}</td>
                <td className="reports-cell-number">{row.transactions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Payment Method</th>
              <th className="reports-cell-number">Litres</th>
              <th className="reports-cell-number">Revenue</th>
              <th className="reports-cell-number">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {(sales.byPayment || []).map((row) => (
              <tr key={row.paymentMethod}>
                <td>{row.paymentMethod}</td>
                <td className="reports-cell-number">{row.litres.toLocaleString()}</td>
                <td className="reports-cell-number">MWK {row.revenue.toLocaleString()}</td>
                <td className="reports-cell-number">{row.transactions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Hour</th>
              <th className="reports-cell-number">Litres</th>
              <th className="reports-cell-number">Revenue</th>
              <th className="reports-cell-number">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {(sales.byHour || []).map((row) => (
              <tr key={row.hour}>
                <td>{row.hour}</td>
                <td className="reports-cell-number">{row.litres.toLocaleString()}</td>
                <td className="reports-cell-number">MWK {row.revenue.toLocaleString()}</td>
                <td className="reports-cell-number">{row.transactions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showTransactions ? (
        <div className="reports-modal-backdrop" onClick={() => setShowTransactions(false)}>
          <div className="reports-modal" onClick={(event) => event.stopPropagation()}>
            <h4>Transactions Viewer</h4>
            <div className="reports-table-wrap">
              <table className="reports-data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Time</th>
                    <th className="reports-cell-number">Litres</th>
                    <th className="reports-cell-number">Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Case</th>
                  </tr>
                </thead>
                <tbody>
                  {(sales.transactions || []).map((tx) => (
                    <tr key={tx.publicId}>
                      <td className="reports-cell-wrap">{tx.publicId}</td>
                      <td>{formatDateTime(tx.occurredAt)}</td>
                      <td className="reports-cell-number">{tx.litres.toLocaleString()}</td>
                      <td className="reports-cell-number">MWK {tx.amount.toLocaleString()}</td>
                      <td>{tx.paymentMethod}</td>
                      <td>
                        {tx.status}
                        {tx.workflowReasonLabel ? (
                          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.75 }}>
                            {tx.workflowReasonLabel}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {tx.complianceCaseStatus || "Clear"}
                        {tx.complianceCasePublicId ? (
                          <div style={{ marginTop: 4, fontSize: "0.8rem", opacity: 0.75 }}>
                            {tx.complianceCasePublicId}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setShowTransactions(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

import { formatDateTime } from "../../../utils/dateTime"

function formatMoney(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

export default function SettlementReportSection({ settlements }) {
  const summary = settlements?.summary || {}
  const items = Array.isArray(settlements?.items) ? settlements.items : []

  return (
    <section className="reports-panel" id="reports-settlements-section">
      <header className="reports-section-header">
        <h3>Settlement Batches</h3>
      </header>

      <div className="reports-settlement-summary">
        <article className="reports-settlement-card">
          <span>Total Batches</span>
          <strong>{Number(summary.settlementCount || 0).toLocaleString()}</strong>
        </article>
        <article className="reports-settlement-card">
          <span>Total Value</span>
          <strong>{formatMoney(summary.settlementValue)}</strong>
        </article>
        <article className="reports-settlement-card">
          <span>Pending</span>
          <strong>{Number(summary.pendingCount || 0).toLocaleString()}</strong>
          <small>{formatMoney(summary.pendingValue)}</small>
        </article>
        <article className="reports-settlement-card">
          <span>Paid</span>
          <strong>{Number(summary.paidCount || 0).toLocaleString()}</strong>
        </article>
      </div>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>User</th>
              <th>Reservation</th>
              <th className="reports-cell-number">Litres</th>
              <th className="reports-cell-number">Net Amount</th>
              <th>Status</th>
              <th>Forecourt Transaction</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item) => (
              <tr key={item.publicId}>
                <td className="reports-cell-wrap">
                  <strong>{item.publicId}</strong>
                  {item.sourceReference ? (
                    <div className="reports-settlement-subline">{item.sourceReference}</div>
                  ) : null}
                </td>
                <td className="reports-cell-wrap">
                  <strong>{item.userName || "Unknown user"}</strong>
                  <div className="reports-settlement-subline">
                    {item.userPublicId || (item.userId ? `User #${item.userId}` : "No user ID")}
                    {item.userPhone ? ` · ${item.userPhone}` : ""}
                  </div>
                </td>
                <td className="reports-cell-wrap">
                  <strong>{item.reservationPublicId || item.queueEntryPublicId || item.relatedEntityId || "-"}</strong>
                  <div className="reports-settlement-subline">
                    {item.fuelCode || item.relatedEntityType || "-"}
                  </div>
                </td>
                <td className="reports-cell-number">
                  {(item.requestedLitres ?? item.forecourtLitres) === null || (item.requestedLitres ?? item.forecourtLitres) === undefined
                    ? "-"
                    : Number(item.requestedLitres ?? item.forecourtLitres).toLocaleString()}
                </td>
                <td className="reports-cell-number">{formatMoney(item.netAmount)}</td>
                <td>{item.status}</td>
                <td className="reports-cell-wrap">
                  {item.forecourtTransactionPublicId || "Pending"}
                  {item.forecourtPaymentMethod ? (
                    <div className="reports-settlement-subline">{item.forecourtPaymentMethod}</div>
                  ) : null}
                </td>
                <td>{formatDateTime(item.createdAt || item.forecourtOccurredAt)}</td>
              </tr>
            )) : (
              <tr>
                <td className="reports-table-empty" colSpan={8}>
                  No settlements found for the selected range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

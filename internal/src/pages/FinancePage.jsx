import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { Panel } from "../components/PanelTable"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import ActionConfirmModal from "../components/ActionConfirmModal"
import RefundInvestigationModal from "../components/RefundInvestigationModal"
import { DataTable } from "../components/PanelTable"
import { formatDateTime, formatMoney, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

const POLL_INTERVAL_MS = 5000

function ModalFrame({ title, subtitle, badges = null, onClose, children }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <div className="internal-modal-header-actions">
            {badges}
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body">{children}</div>
      </div>
    </div>
  )
}

function toCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers.map((header) => toCsvCell(header.label)).join(",")]
  rows.forEach((row) => {
    csv.push(headers.map((header) => toCsvCell(header.value(row))).join(","))
  })

  const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function formatEnumLabel(value, fallback = "-") {
  if (!value) return fallback
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeDateFilterValue(value) {
  return String(value || "").trim()
}

function matchesDateWindow(value, { from = "", to = "" } = {}) {
  const normalizedValue = normalizeDateFilterValue(value)
  const normalizedFrom = normalizeDateFilterValue(from)
  const normalizedTo = normalizeDateFilterValue(to)

  if (!normalizedFrom && !normalizedTo) return true
  if (!normalizedValue) return false
  if (normalizedFrom && normalizedValue < normalizedFrom) return false
  if (normalizedTo && normalizedValue > normalizedTo) return false
  return true
}

function countActiveSettlementHistoryFilters(filters) {
  return [
    normalizeDateFilterValue(filters.batchDateFrom),
    normalizeDateFilterValue(filters.batchDateTo),
    filters.status !== "ALL",
  ].filter(Boolean).length
}

function collectOptionValues(items, getter) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => getter(item))
        .filter(Boolean)
    )
  ).sort((left, right) => String(left).localeCompare(String(right)))
}

function FinanceAuditList({ items }) {
  if (!items?.length) return <p className="empty-cell">No recent finance audit activity.</p>

  return (
    <div className="timeline-list">
      {items.map((item) => (
        <article key={item.publicId} className="timeline-item">
          <div>
            <strong>{item.summary}</strong>
            <p>{item.actionType} · {item.targetType}</p>
          </div>
          <div className="timeline-meta">
            <StatusPill value={item.severity} />
            <time>{formatDateTime(item.createdAt)}</time>
          </div>
        </article>
      ))}
    </div>
  )
}

function CreateSettlementBatchModal({ onClose, onCreate }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    stationPublicId: "",
    batchDate: new Date().toISOString().slice(0, 10),
    grossAmount: "",
  })
  const grossAmount = Number(form.grossAmount || 0)
  const normalizedGrossAmount = Number.isFinite(grossAmount) && grossAmount > 0 ? grossAmount : 0
  const calculatedFeeAmount = Number((normalizedGrossAmount * 0.008).toFixed(2))
  const calculatedNetAmount = Number((normalizedGrossAmount - calculatedFeeAmount).toFixed(2))
  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onCreate({
        stationPublicId: form.stationPublicId.trim(),
        batchDate: form.batchDate,
        grossAmount: Number(form.grossAmount),
      })
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to create settlement batch")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title="Generate Settlement Batch" subtitle="Create a new finance settlement batch for review." onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Station public ID</span>
              <input value={form.stationPublicId} onChange={(event) => setForm((prev) => ({ ...prev, stationPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>Batch date</span>
              <input type="date" value={form.batchDate} onChange={(event) => setForm((prev) => ({ ...prev, batchDate: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>Gross amount (MWK)</span>
              <input type="number" min="0" step="0.01" value={form.grossAmount} onChange={(event) => setForm((prev) => ({ ...prev, grossAmount: event.target.value }))} disabled={working} />
            </label>
          </div>
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Platform fee (0.8%)</span><strong>{formatMoney(calculatedFeeAmount)}</strong></div>
            <div><span>Net settlement</span><strong>{formatMoney(calculatedNetAmount)}</strong></div>
          </div>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              Create Batch
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function StartReconciliationModal({ onClose, onStart }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onStart(note.trim())
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to start reconciliation")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title="Start Reconciliation" subtitle="Open a new finance reconciliation run." onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <label className="settings-form-field">
            <span>Note</span>
            <textarea rows={5} value={note} onChange={(event) => setNote(event.target.value)} disabled={working} />
          </label>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              Start Reconciliation
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function SettlementHistoryFilterModal({
  draftFilters,
  statusOptions,
  activeCount,
  invalidRange,
  onChange,
  onApply,
  onReset,
  onClose,
}) {
  return (
    <ModalFrame
      title="Filter Settlement History"
      subtitle="Narrow approved, paid, and held settlement batches without changing the finance queue."
      badges={<span className="internal-modal-count">{activeCount} active</span>}
      onClose={onClose}
    >
      <div className="stack-grid">
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Batch Date From</span>
              <input
                type="date"
                value={draftFilters.batchDateFrom}
                max={draftFilters.batchDateTo || undefined}
                onChange={(event) => onChange("batchDateFrom", event.target.value)}
              />
            </label>
            <label className="settings-form-field">
              <span>Batch Date To</span>
              <input
                type="date"
                value={draftFilters.batchDateTo}
                min={draftFilters.batchDateFrom || undefined}
                onChange={(event) => onChange("batchDateTo", event.target.value)}
              />
            </label>
            <label className="settings-form-field">
              <span>Status</span>
              <select
                value={draftFilters.status}
                onChange={(event) => onChange("status", event.target.value)}
              >
                <option value="ALL">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{formatEnumLabel(status)}</option>
                ))}
              </select>
            </label>
          </div>
          {invalidRange ? <p className="settings-error">End date cannot be earlier than start date.</p> : null}
          <p className="finance-filter-copy">
            Leave both dates empty to return to the full settlement history list.
          </p>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" onClick={onReset} disabled={!activeCount && !draftFilters.batchDateFrom && !draftFilters.batchDateTo && draftFilters.status === "ALL"}>
              Clear Filters
            </button>
            <button type="button" className="secondary-action" onClick={onApply} disabled={invalidRange}>
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function ReconciliationExceptionModal({ runPublicId, onClose, onSubmit }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    exceptionType: "LEDGER_VARIANCE",
    severity: "MEDIUM",
    summary: "",
    detail: "",
  })

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onSubmit(runPublicId, form)
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to raise reconciliation exception")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title={`Raise Exception ${runPublicId}`} subtitle="Record a reconciliation exception for finance follow-up." onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Exception type</span>
              <select value={form.exceptionType} onChange={(event) => setForm((prev) => ({ ...prev, exceptionType: event.target.value }))} disabled={working}>
                <option value="LEDGER_VARIANCE">Ledger variance</option>
                <option value="SETTLEMENT_DELAY">Settlement delay</option>
                <option value="REFUND_MISMATCH">Refund mismatch</option>
                <option value="WALLET_DRIFT">Wallet drift</option>
              </select>
            </label>
            <label className="settings-form-field">
              <span>Severity</span>
              <select value={form.severity} onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value }))} disabled={working}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="settings-form-field settings-form-field--full">
              <span>Summary</span>
              <input value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} disabled={working} />
            </label>
          </div>
          <label className="settings-form-field">
            <span>Detail</span>
            <textarea rows={5} value={form.detail} onChange={(event) => setForm((prev) => ({ ...prev, detail: event.target.value }))} disabled={working} />
          </label>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              Raise Exception
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function WalletAdjustmentModal({ onClose, onCreate }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    stationPublicId: "",
    amountMwk: "",
    direction: "CREDIT",
    reason: "",
    note: "",
  })

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onCreate({
        ...form,
        amountMwk: Number(form.amountMwk),
      })
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to create wallet adjustment request")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title="Wallet Adjustment Request" subtitle="Create a finance wallet adjustment request." onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Station public ID</span>
              <input value={form.stationPublicId} onChange={(event) => setForm((prev) => ({ ...prev, stationPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>Direction</span>
              <select value={form.direction} onChange={(event) => setForm((prev) => ({ ...prev, direction: event.target.value }))} disabled={working}>
                <option value="CREDIT">Credit</option>
                <option value="DEBIT">Debit</option>
              </select>
            </label>
            <label className="settings-form-field">
              <span>Amount (MWK)</span>
              <input type="number" min="0" step="0.01" value={form.amountMwk} onChange={(event) => setForm((prev) => ({ ...prev, amountMwk: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field settings-form-field--full">
              <span>Reason</span>
              <input value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} disabled={working} />
            </label>
          </div>
          <label className="settings-form-field">
            <span>Note</span>
            <textarea rows={4} value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} disabled={working} />
          </label>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              Create Request
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function SettlementDetailModal({ settlement, canSettle, canReject, onProcessing, onApprove, onReject, onPaid, onClose }) {
  if (!settlement) return null
  const integrityReview = settlement.integrityReview || null

  return (
    <ModalFrame
      title={`Settlement Batch ${settlement.publicId}`}
      subtitle="Review settlement batch value, state, and payout action."
      onClose={onClose}
      badges={
        <>
          <span className="internal-modal-count">{formatMoney(settlement.netAmount)}</span>
          <StatusPill value={settlement.status} />
        </>
      }
    >
      <div className="stack-grid">
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Station</span><strong>{settlement.stationName}</strong></div>
          <div><span>Batch date</span><strong>{settlement.batchDate || "-"}</strong></div>
          <div><span>Source type</span><strong>{formatEnumLabel(settlement.relatedEntityType, "Manual")}</strong></div>
          <div><span>Source reference</span><strong>{settlement.relatedEntityId || "-"}</strong></div>
          <div><span>Created</span><strong>{formatDateTime(settlement.createdAt)}</strong></div>
          <div><span>Approved</span><strong>{formatDateTime(settlement.approvedAt)}</strong></div>
          <div><span>Gross amount</span><strong>{formatMoney(settlement.grossAmount)}</strong></div>
          <div><span>Platform fee</span><strong>{formatMoney(settlement.feeAmount)}</strong></div>
        </div>

        <div className="admin-detail-block">
          <span>Net payout value</span>
          <strong>{formatMoney(settlement.netAmount)}</strong>
        </div>

        {integrityReview?.flagged ? (
          <div className="settings-form-card">
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Integrity review</span><strong>{integrityReview.headline || "Requires review"}</strong></div>
              <div><span>Severity</span><strong>{formatEnumLabel(integrityReview.severity)}</strong></div>
              <div><span>Missing user</span><strong>{formatNumber(integrityReview.missingUserCount)}</strong></div>
              <div><span>Missing queue/reservation</span><strong>{formatNumber(integrityReview.missingJourneyLinkCount)}</strong></div>
            </div>
            <p className="empty-cell">{integrityReview.summary}</p>
            {integrityReview.sampleTransactionPublicIds?.length ? (
              <p className="empty-cell">Sample transactions: {integrityReview.sampleTransactionPublicIds.join(", ")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="inline-action-group inline-action-group--row">
          {canSettle && settlement.status === "PENDING" ? (
            <button type="button" className="secondary-action" onClick={() => onProcessing(settlement.publicId)}>
              Mark Processing
            </button>
          ) : null}
          {canSettle && ["PENDING", "UNDER_REVIEW"].includes(settlement.status) ? (
            <button type="button" className="secondary-action" onClick={() => onApprove(settlement.publicId)}>
              Approve Settlement
            </button>
          ) : null}
          {canReject && ["PENDING", "UNDER_REVIEW"].includes(settlement.status) ? (
            <button type="button" className="secondary-action" onClick={() => onReject(settlement.publicId)}>
              Reject Settlement
            </button>
          ) : null}
          {canSettle && settlement.status === "APPROVED" ? (
            <button type="button" className="secondary-action" onClick={() => onPaid(settlement.publicId)}>
              Mark Paid
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              downloadCsv(`settlement-${settlement.publicId}.csv`, [
                { label: "Batch ID", value: () => settlement.publicId },
                { label: "Station", value: () => settlement.stationName },
                { label: "Batch Date", value: () => settlement.batchDate || "" },
                { label: "Source Type", value: () => settlement.relatedEntityType || "" },
                { label: "Source Reference", value: () => settlement.relatedEntityId || "" },
                { label: "Source Transaction", value: () => settlement.sourceTransactionReference || "" },
                { label: "Status", value: () => settlement.status },
                { label: "Gross Amount", value: () => settlement.grossAmount },
                { label: "Fee Amount", value: () => settlement.feeAmount },
                { label: "Net Amount", value: () => settlement.netAmount },
                { label: "Created At", value: () => settlement.createdAt || "" },
                { label: "Approved At", value: () => settlement.approvedAt || "" },
              ], [settlement])
            }
          >
            Download Settlement Report
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}

function FlaggedSettlementsModal({ rows, onOpenSettlement, onClose }) {
  return (
    <ModalFrame
      title="Flagged Settlement Batches"
      subtitle="Auto-flagged batches that need finance review."
      onClose={onClose}
      badges={<span className="internal-modal-count">{rows.length} batch{rows.length === 1 ? "" : "es"}</span>}
    >
      <DataTable
        compact
        minWidth={760}
        rows={rows}
        emptyLabel="No flagged settlement batches right now."
        onRowClick={(row) => onOpenSettlement(row.publicId)}
        columns={[
          { key: "publicId", label: "Batch ID" },
          { key: "stationName", label: "Station" },
          { key: "batchDate", label: "Batch Date" },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          {
            key: "integritySummary",
            label: "Issue",
            render: (row) => row.integrityReview?.summary || "Needs review",
          },
        ]}
      />
    </ModalFrame>
  )
}

function TransactionDetailModal({
  transaction,
  primaryRole,
  onFlagReview,
  onFinanceReviewAction,
  onCancelFinancialError,
  onClose,
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [severity, setSeverity] = useState("MEDIUM")
  const [financialErrorReason, setFinancialErrorReason] = useState("DUPLICATE_PAYMENT")
  const isFinanceManager = String(primaryRole || "").toUpperCase() === "FINANCE_MANAGER"
  const isClosedTransaction = ["CANCELLED", "REVERSED"].includes(String(transaction?.status || "").toUpperCase())

  if (!transaction) return null

  async function submitFlag() {
    try {
      setWorking(true)
      setError("")
      await onFlagReview(transaction.publicId, { note, severity })
      setNote("")
    } catch (err) {
      setError(err?.message || "Failed to flag transaction for review")
    } finally {
      setWorking(false)
    }
  }

  async function submitFinanceAction(action) {
    try {
      setWorking(true)
      setError("")
      await onFinanceReviewAction(transaction.publicId, { action, note, severity })
      setNote("")
    } catch (err) {
      setError(err?.message || "Failed to update finance transaction workflow")
    } finally {
      setWorking(false)
    }
  }

  async function submitFinancialCancel() {
    try {
      setWorking(true)
      setError("")
      await onCancelFinancialError(transaction.publicId, { note, reasonCode: financialErrorReason })
      setNote("")
    } catch (err) {
      setError(err?.message || "Failed to cancel transaction for financial error")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame
      title={`Transaction ${transaction.publicId}`}
      subtitle="Finance detail view for verification, escalation, and exception-only cancellation."
      onClose={onClose}
      badges={
        <>
          <StatusPill value={transaction.paymentMethod} />
          <StatusPill value={transaction.status || "RECORDED"} />
        </>
      }
    >
      <div className="stack-grid">
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Occurred</span><strong>{formatDateTime(transaction.occurredAt)}</strong></div>
          <div><span>Total amount</span><strong>{formatMoney(transaction.totalAmount)}</strong></div>
          <div><span>Litres</span><strong>{formatNumber(transaction.litres)}</strong></div>
          <div><span>Payment method</span><strong>{transaction.paymentMethod}</strong></div>
          <div><span>Transaction status</span><strong><StatusPill value={transaction.status || "RECORDED"} /></strong></div>
          <div><span>Settlement impact</span><strong><StatusPill value={transaction.settlementImpactStatus || "UNCHANGED"} /></strong></div>
          <div><span>Station</span><strong>{transaction.stationName || transaction.stationId || "-"}</strong></div>
          <div><span>Station ID</span><strong>{transaction.stationPublicId || "-"}</strong></div>
          <div><span>Workflow reason</span><strong>{formatEnumLabel(transaction.workflowReasonCode)}</strong></div>
          <div><span>Cancelled at</span><strong>{formatDateTime(transaction.cancelledAt)}</strong></div>
          <div><span>Case ID</span><strong>{transaction.reviewCase?.publicId || "Not created"}</strong></div>
          <div><span>Case status</span><strong>{transaction.reviewCase?.status ? <StatusPill value={transaction.reviewCase.status} /> : "Not flagged"}</strong></div>
          <div><span>Assigned to</span><strong>{transaction.reviewCase?.assignedOfficer || "Unassigned"}</strong></div>
        </div>
        {transaction.workflowNote ? (
          <div className="admin-detail-block">
            <span>Latest workflow note</span>
            <strong>{transaction.workflowNote}</strong>
          </div>
        ) : null}
        {transaction.reviewCase?.summary ? (
          <div className="admin-detail-block">
            <span>Case summary</span>
            <strong>{transaction.reviewCase.summary}</strong>
          </div>
        ) : null}
        {transaction.reviewCase?.actionTaken ? (
          <div className="admin-detail-block">
            <span>Case notes / actions</span>
            <strong>{transaction.reviewCase.actionTaken}</strong>
          </div>
        ) : null}
        {error ? <p className="settings-error">{error}</p> : null}
        {isFinanceManager && !transaction.reviewCase?.publicId ? (
          <div className="settings-form-card">
            <div className="settings-profile-grid">
              <label className="settings-form-field">
                <span>Review severity</span>
                <select value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={working}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </label>
            </div>
            <label className="settings-form-field">
              <span>Flag note</span>
              <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={working} />
            </label>
            <div className="settings-form-actions">
              <button type="button" className="secondary-action" disabled={working} onClick={submitFlag}>
                Flag Transaction
              </button>
            </div>
          </div>
        ) : null}
        {isFinanceManager ? (
          <div className="settings-form-card">
            <div className="settings-profile-grid">
              <label className="settings-form-field">
                <span>Financial error reason</span>
                <select value={financialErrorReason} onChange={(event) => setFinancialErrorReason(event.target.value)} disabled={working || isClosedTransaction}>
                  <option value="DUPLICATE_PAYMENT">Duplicate payment</option>
                  <option value="PAYMENT_GATEWAY_FAILURE">Payment gateway failure</option>
                  <option value="INCORRECT_TRANSACTION_CAPTURE">Incorrect transaction capture</option>
                </select>
              </label>
            </div>
            <label className="settings-form-field">
              <span>Finance note</span>
              <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={working} />
            </label>
            <div className="settings-form-actions">
              <button type="button" className="secondary-action" disabled={working || isClosedTransaction} onClick={() => submitFinanceAction("REQUEST_CANCELLATION_REVIEW")}>
                Request Cancellation Review
              </button>
              <button type="button" className="secondary-action" disabled={working} onClick={() => submitFinanceAction("ATTACH_FINANCIAL_NOTE")}>
                Attach Financial Notes
              </button>
              <button type="button" className="secondary-action" disabled={working || isClosedTransaction} onClick={() => submitFinanceAction("ESCALATE_TO_COMPLIANCE")}>
                Escalate to Compliance
              </button>
              <button type="button" className="secondary-action" disabled={working || isClosedTransaction} onClick={submitFinancialCancel}>
                Cancel Transaction (Financial Error)
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ModalFrame>
  )
}

function RefundDecisionModal({ refund, onApprove, onReject, onClose }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState(refund?.resolutionNotes || "")

  if (!refund) return null

  async function submit(action) {
    try {
      setWorking(true)
      setError("")
      if (action === "approve") {
        await onApprove(refund.publicId, note)
      } else {
        await onReject(refund.publicId, note)
      }
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to update refund decision")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame
      title={`Refund ${refund.publicId}`}
      subtitle="Finance review for refund decision, evidence, and outcome note."
      onClose={onClose}
      badges={
        <>
          <span className="internal-modal-count">{formatMoney(refund.amountMwk)}</span>
          <StatusPill value={refund.status} />
        </>
      }
    >
      <div className="stack-grid">
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Station</span><strong>{refund.stationName || "-"}</strong></div>
          <div><span>Transaction</span><strong>{refund.transactionPublicId || "Not linked"}</strong></div>
          <div><span>Support case</span><strong>{refund.supportCasePublicId || "Not linked"}</strong></div>
          <div><span>Priority</span><strong><StatusPill value={refund.priority} /></strong></div>
          <div><span>Created</span><strong>{formatDateTime(refund.createdAt)}</strong></div>
          <div><span>Reviewed</span><strong>{formatDateTime(refund.reviewedAt)}</strong></div>
        </div>

        <div className="admin-detail-block">
          <span>Refund reason</span>
          <strong>{refund.reason || "No refund reason recorded."}</strong>
        </div>

        <div className="admin-detail-block">
          <span>Refund evidence</span>
          <strong>
            {refund.evidenceUrl ? (
              <a href={refund.evidenceUrl} target="_blank" rel="noreferrer">{refund.evidenceUrl}</a>
            ) : (
              "No linked evidence attachment."
            )}
          </strong>
        </div>

        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <label className="settings-form-field">
            <span>Decision note</span>
            <textarea rows={5} value={note} onChange={(event) => setNote(event.target.value)} disabled={working} />
          </label>
          <div className="settings-form-actions">
            {refund.status === "PENDING_FINANCE_APPROVAL" ? (
              <>
                <button type="button" className="secondary-action" disabled={working} onClick={() => submit("approve")}>
                  Approve Refund
                </button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => submit("reject")}>
                  Reject Refund
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

export default function FinancePage() {
  const { hasPermission, session } = useInternalAuth()
  const [data, setData] = useState({
    ledger: [],
    settlements: [],
    settlementAlerts: [],
    billingOverview: [],
    refundRequests: [],
    subscriptionBilling: [],
    financeAudit: [],
    walletLedger: [],
    reconciliationRuns: [],
    reconciliationExceptions: [],
    walletAdjustments: [],
    summary: {},
  })
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedSettlementId, setSelectedSettlementId] = useState(null)
  const [selectedTransactionId, setSelectedTransactionId] = useState(null)
  const [selectedRefundId, setSelectedRefundId] = useState(null)
  const [pendingRefundApproval, setPendingRefundApproval] = useState(null)
  const [showCreateSettlement, setShowCreateSettlement] = useState(false)
  const [showStartReconciliation, setShowStartReconciliation] = useState(false)
  const [showWalletAdjustment, setShowWalletAdjustment] = useState(false)
  const [showFlaggedSettlements, setShowFlaggedSettlements] = useState(false)
  const [exceptionRunPublicId, setExceptionRunPublicId] = useState("")
  const [showSettlementHistoryFilters, setShowSettlementHistoryFilters] = useState(false)
  const [settlementHistoryFilters, setSettlementHistoryFilters] = useState({
    batchDateFrom: "",
    batchDateTo: "",
    status: "ALL",
  })
  const [settlementHistoryDraftFilters, setSettlementHistoryDraftFilters] = useState({
    batchDateFrom: "",
    batchDateTo: "",
    status: "ALL",
  })

  async function load() {
    setData(await internalApi.getFinance())
  }

  useEffect(() => {
    let canceled = false
    let intervalId = null

    async function refresh() {
      try {
        const next = await internalApi.getFinance()
        if (!canceled) {
          setData(next)
          setError("")
        }
      } catch (err) {
        if (!canceled) {
          setError(err?.message || "Failed to load finance data")
        }
      }
    }

    refresh()
    intervalId = window.setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      canceled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [])

  async function runAction(action) {
    try {
      setError("")
      const result = await action()
      await load()
      return result
    } catch (err) {
      setError(err?.message || "Failed to update finance workflow")
      throw err
    }
  }

  function handleFinanceRefundApproval(row) {
    const requiresFalsePositiveConfirmation =
      Boolean(row?.complianceCasePublicId)
      && Boolean(row?.complianceMarkedFalsePositive)

    if (requiresFalsePositiveConfirmation) {
      setPendingRefundApproval(row)
      return
    }

    runAction(() => internalApi.approveFinanceRefund(row.publicId, row.resolutionNotes || ""))
  }

  function openSettlementHistoryFilters() {
    setSettlementHistoryDraftFilters(settlementHistoryFilters)
    setShowSettlementHistoryFilters(true)
  }

  function closeSettlementHistoryFilters() {
    setSettlementHistoryDraftFilters(settlementHistoryFilters)
    setShowSettlementHistoryFilters(false)
  }

  function applySettlementHistoryFilters() {
    if (settlementHistoryHasInvalidRange) return
    setSettlementHistoryFilters(settlementHistoryDraftFilters)
    setShowSettlementHistoryFilters(false)
  }

  function resetSettlementHistoryFilters() {
    const cleared = {
      batchDateFrom: "",
      batchDateTo: "",
      status: "ALL",
    }
    setSettlementHistoryDraftFilters(cleared)
    setSettlementHistoryFilters(cleared)
    setShowSettlementHistoryFilters(false)
  }

  function renderSettlementHistoryModalControls() {
    return (
      <div className="settlement-history-modal-controls">
        <div className="settlement-history-modal-controls__copy">
          <strong>Settlement History Filters</strong>
          <span>
            {settlementHistoryActiveFilterCount
              ? `${settlementHistoryActiveFilterCount} filter${settlementHistoryActiveFilterCount === 1 ? "" : "s"} applied`
              : "No filters applied"}
          </span>
        </div>
        <button
          type="button"
          className="secondary-action settlement-history-filter-button"
          onClick={openSettlementHistoryFilters}
        >
          <span>Filter</span>
          {settlementHistoryActiveFilterCount ? (
            <strong>{settlementHistoryActiveFilterCount}</strong>
          ) : null}
        </button>
      </div>
    )
  }

  const canSettle = hasPermission("finance:settle")
  const canRejectSettlement = hasPermission("finance:settlement_reject")
  const canApproveRefund = hasPermission("finance:refund_approve")
  const primaryRole = session?.profile?.primaryRole || ""

  const settlements = data.settlements || []
  const settlementHistoryStatusOptions = useMemo(
    () => collectOptionValues(
      settlements.filter((row) => !["PENDING", "UNDER_REVIEW"].includes(row.status)),
      (row) => row?.status
    ),
    [settlements]
  )
  const settlementHistoryActiveFilterCount = useMemo(
    () => countActiveSettlementHistoryFilters(settlementHistoryFilters),
    [settlementHistoryFilters]
  )
  const settlementHistoryHasInvalidRange = useMemo(() => {
    const from = normalizeDateFilterValue(settlementHistoryDraftFilters.batchDateFrom)
    const to = normalizeDateFilterValue(settlementHistoryDraftFilters.batchDateTo)
    return Boolean(from && to && to < from)
  }, [settlementHistoryDraftFilters])

  function matchesSettlementHistoryFilters(row) {
    if (!matchesDateWindow(row?.batchDate, { from: settlementHistoryFilters.batchDateFrom, to: settlementHistoryFilters.batchDateTo })) {
      return false
    }
    if (settlementHistoryFilters.status !== "ALL" && row?.status !== settlementHistoryFilters.status) {
      return false
    }
    return true
  }

  const flaggedSettlementRows = useMemo(
    () => settlements.filter((row) => row.integrityReview?.flagged),
    [settlements]
  )
  const financeAlerts = useMemo(
    () => (data.settlementAlerts || []).map((item) => ({
      id: item.publicId,
      type: item.severity === "HIGH" || item.severity === "CRITICAL" ? "ERROR" : "WARNING",
      title: item.title || "Settlement Batch Review Required",
      body: item.summary || "Settlement batch needs finance review.",
      meta: [item.stationName, item.batchPublicId].filter(Boolean).join(" · "),
    })),
    [data.settlementAlerts]
  )
  const settlementRows = useMemo(() => {
    const items = settlements.filter((row) => ["PENDING", "UNDER_REVIEW"].includes(row.status))
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.stationName} ${row.publicId} ${row.status} ${row.relatedEntityType || ""} ${row.relatedEntityId || ""} ${row.sourceTransactionReference || ""}`.toLowerCase().includes(needle)
    )
  }, [query, settlements])

  const settlementHistoryRows = useMemo(() => {
    const items = settlements.filter((row) =>
      !["PENDING", "UNDER_REVIEW"].includes(row.status) && matchesSettlementHistoryFilters(row)
    )
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.stationName} ${row.publicId} ${row.status} ${row.relatedEntityType || ""} ${row.relatedEntityId || ""} ${row.sourceTransactionReference || ""}`.toLowerCase().includes(needle)
    )
  }, [query, settlementHistoryFilters, settlements])

  const transactionRows = useMemo(() => {
    const items = data.ledger || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.paymentMethod} ${row.status || ""} ${row.settlementImpactStatus || ""} ${row.stationPublicId || ""} ${row.stationName || ""} ${row.reviewCase?.publicId || ""} ${row.reviewCase?.status || ""}`.toLowerCase().includes(needle)
    )
  }, [data.ledger, query])

  const subscriptionBillingRows = useMemo(() => {
    const items = data.subscriptionBilling || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.stationName} ${row.stationPublicId} ${row.planName} ${row.status}`.toLowerCase().includes(needle)
    )
  }, [data.subscriptionBilling, query])

  const walletLedgerRows = useMemo(() => {
    const items = data.walletLedger || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.type} ${row.stationName} ${row.status}`.toLowerCase().includes(needle)
    )
  }, [data.walletLedger, query])

  const reconciliationRunRows = useMemo(() => {
    const items = data.reconciliationRuns || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.status} ${row.startedByName || ""} ${row.completedByName || ""}`.toLowerCase().includes(needle)
    )
  }, [data.reconciliationRuns, query])

  const reconciliationExceptionRows = useMemo(() => {
    const items = data.reconciliationExceptions || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.runPublicId} ${row.exceptionType} ${row.summary}`.toLowerCase().includes(needle)
    )
  }, [data.reconciliationExceptions, query])

  const walletAdjustmentRows = useMemo(() => {
    const items = data.walletAdjustments || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.stationName} ${row.direction} ${row.status} ${row.reason}`.toLowerCase().includes(needle)
    )
  }, [data.walletAdjustments, query])

  const selectedSettlement = useMemo(
    () => settlements.find((row) => row.publicId === selectedSettlementId) || null,
    [selectedSettlementId, settlements]
  )
  const selectedTransaction = useMemo(
    () => (data.ledger || []).find((row) => row.publicId === selectedTransactionId) || null,
    [data.ledger, selectedTransactionId]
  )
  const selectedRefund = useMemo(
    () => (data.refundRequests || []).find((row) => row.publicId === selectedRefundId) || null,
    [data.refundRequests, selectedRefundId]
  )
  const settlementMetricColumns = useMemo(
    () => [
      { key: "publicId", label: "Batch ID" },
      { key: "stationName", label: "Station" },
      { key: "batchDate", label: "Batch Date" },
      { key: "netAmount", label: "Net Amount", render: (row) => formatMoney(row.netAmount) },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
    ],
    []
  )
  const refundMetricColumns = useMemo(
    () => [
      { key: "publicId", label: "Refund ID" },
      { key: "supportCasePublicId", label: "Case ID", render: (row) => row.supportCasePublicId || "Not linked" },
      { key: "priority", label: "Priority", render: (row) => <StatusPill value={row.priority} /> },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "amountMwk", label: "Amount", render: (row) => formatMoney(row.amountMwk) },
    ],
    []
  )
  const subscriptionMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "stationPublicId", label: "Station ID" },
      { key: "planName", label: "Plan" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "nextBillingDate", label: "Next Billing", render: (row) => row.nextBillingDate || "-" },
      { key: "amountDueMwk", label: "Amount Due", render: (row) => formatMoney(row.amountDueMwk) },
    ],
    []
  )
  const reconciliationMetricColumns = useMemo(
    () => [
      { key: "publicId", label: "Exception ID" },
      { key: "runPublicId", label: "Run ID" },
      { key: "exceptionType", label: "Type" },
      { key: "summary", label: "Summary" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status || "OPEN"} /> },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Today Revenue",
        value: formatMoney(data.summary?.todayRevenue),
        tone: "accent",
        meta: "Today's platform fee revenue from settlement batches",
        drilldown: {
          title: "Today Revenue",
          subtitle: "Recently processed settlement batches contributing to current finance revenue.",
          rows: settlements.filter((row) => ["APPROVED", "PROCESSING", "PAID"].includes(String(row.status || "").toUpperCase())),
          columns: settlementMetricColumns,
          emptyLabel: "No processed settlement batches found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedSettlementId(row.publicId),
        },
      },
      {
        label: "Unsettled Value",
        value: formatMoney(data.summary?.unsettledValue),
        tone: "warning",
        meta: "Awaiting settlement approval",
        drilldown: {
          title: "Unsettled Settlement Batches",
          subtitle: "Settlement batches awaiting finance review or approval.",
          rows: settlementRows,
          columns: settlementMetricColumns,
          emptyLabel: "No unsettled settlement batches found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedSettlementId(row.publicId),
        },
      },
      {
        label: "Pending Payouts",
        value: formatNumber(data.summary?.payoutBatchesPending),
        tone: "neutral",
        meta: "Batches under finance control",
        drilldown: {
          title: "Pending Payout Batches",
          subtitle: "Batches currently moving through the finance payout workflow.",
          rows: settlementRows,
          columns: settlementMetricColumns,
          emptyLabel: "No pending payout batches found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedSettlementId(row.publicId),
        },
      },
      {
        label: "Flagged Batches",
        value: formatNumber(data.summary?.flaggedSettlementBatches),
        tone: data.summary?.flaggedSettlementBatches ? "danger" : "neutral",
        meta: "Auto-flagged for missing user journey linkage",
        onClick: () => setShowFlaggedSettlements(true),
      },
      {
        label: "Refund Review",
        value: formatNumber(data.summary?.refundRequestsPending),
        tone: "danger",
        meta: "Requests requiring decision",
        drilldown: {
          title: "Refund Review Queue",
          subtitle: "Refund requests that still need finance action.",
          rows: (data.refundRequests || []).filter((row) => String(row.status || "").toUpperCase().includes("PENDING")),
          columns: refundMetricColumns,
          emptyLabel: "No refund review requests found.",
          minWidth: 900,
          onRowClick: (row) => setSelectedRefundId(row.publicId),
        },
      },
      {
        label: "Overdue Billing",
        value: formatNumber(data.summary?.overdueAccounts),
        tone: data.summary?.overdueAccounts ? "warning" : "neutral",
        meta: "Subscription accounts requiring finance action",
        drilldown: {
          title: "Overdue Billing Accounts",
          subtitle: "Subscription billing rows that need finance follow-up.",
          rows: subscriptionBillingRows.filter((row) => ["OVERDUE", "GRACE"].includes(String(row.status || "").toUpperCase())),
          columns: subscriptionMetricColumns,
          emptyLabel: "No overdue billing accounts found.",
          minWidth: 920,
        },
      },
      {
        label: "Recon Exceptions",
        value: formatNumber(data.summary?.openReconciliationExceptions),
        tone: data.summary?.openReconciliationExceptions ? "danger" : "neutral",
        meta: "Open reconciliation exceptions",
        drilldown: {
          title: "Reconciliation Exceptions",
          subtitle: "Open reconciliation exceptions requiring investigation.",
          rows: reconciliationExceptionRows,
          columns: reconciliationMetricColumns,
          emptyLabel: "No reconciliation exceptions found.",
          minWidth: 960,
        },
      },
    ],
    [
      data.refundRequests,
      data.summary?.flaggedSettlementBatches,
      data.summary?.openReconciliationExceptions,
      data.summary?.overdueAccounts,
      data.summary?.payoutBatchesPending,
      data.summary?.refundRequestsPending,
      data.summary?.todayRevenue,
      data.summary?.unsettledValue,
      reconciliationExceptionRows,
      reconciliationMetricColumns,
      refundMetricColumns,
      settlementMetricColumns,
      settlementRows,
      settlements,
      subscriptionBillingRows,
      subscriptionMetricColumns,
    ]
  )

  return (
    <InternalShell
      title="Finance & Settlements"
      alerts={[
        ...(error ? [{ id: "finance-error", type: "ERROR", title: "System Error", body: error }] : []),
        ...financeAlerts,
      ]}
    >
      <div className="page-toolbar">
        <input className="page-search" placeholder="Search finance, settlements, transactions, stations, or reconciliation" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="panel-actions">
          {canSettle ? (
            <>
              <button type="button" className="secondary-action" onClick={() => setShowCreateSettlement(true)}>Generate Settlement Batch</button>
              <button type="button" className="secondary-action" onClick={() => setShowStartReconciliation(true)}>Start Reconciliation</button>
              <button type="button" className="secondary-action" onClick={() => setShowWalletAdjustment(true)}>Create Wallet Adjustment</button>
            </>
          ) : null}
        </div>
      </div>

      <MetricGrid items={metricItems} />

      <PreviewTablePanel
        title="Settlement Queue"
        previewLimit={8}
        modalTitle="Pending Settlement Batches"
        emptyLabel="No pending settlement batches awaiting approval."
        modalRows={settlementRows}
        actions={() => (
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              downloadCsv("payout-summary.csv", [
                { label: "Batch ID", value: (row) => row.publicId },
                { label: "Station", value: (row) => row.stationName },
                { label: "Batch Date", value: (row) => row.batchDate || "" },
                { label: "Status", value: (row) => row.status },
                { label: "Gross Amount", value: (row) => row.grossAmount },
                { label: "Fee Amount", value: (row) => row.feeAmount },
                { label: "Net Amount", value: (row) => row.netAmount },
              ], settlements)
            }
          >
            Export Payout Summary
          </button>
        )}
        columns={[
          {
            key: "publicId",
            label: "Batch ID",
            render: (row) => (
              <button type="button" className="secondary-action" onClick={() => setSelectedSettlementId(row.publicId)}>
                {row.publicId}
              </button>
            ),
          },
          { key: "stationName", label: "Station" },
          { key: "batchDate", label: "Batch Date" },
          { key: "netAmount", label: "Net Amount", render: (row) => formatMoney(row.netAmount) },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          {
            key: "integrityReview",
            label: "Review",
            render: (row) =>
              row.integrityReview?.flagged
                ? <StatusPill value={row.integrityReview.severity || "HIGH"} />
                : <span className="empty-cell">Clean</span>,
          },
          {
            key: "actions",
            label: "Actions",
            render: (row) => (
              <div className="inline-action-group inline-action-group--row">
                <button type="button" className="secondary-action" onClick={() => setSelectedSettlementId(row.publicId)}>Open</button>
                {canSettle && row.status === "PENDING" ? (
                  <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.markSettlementProcessing(row.publicId))}>
                    Processing
                  </button>
                ) : null}
                {canSettle && ["PENDING", "UNDER_REVIEW"].includes(row.status) ? (
                  <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.approveSettlement(row.publicId))}>
                    Approve
                  </button>
                ) : null}
                {canRejectSettlement && ["PENDING", "UNDER_REVIEW"].includes(row.status) ? (
                  <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.rejectSettlement(row.publicId))}>
                    Reject
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={settlementRows}
      />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="Transaction Ledger"
          previewLimit={8}
          modalTitle="Full Transaction Ledger"
          actions={() => (
            <button
              type="button"
              className="secondary-action"
              onClick={() =>
                downloadCsv("transactions.csv", [
                  { label: "Transaction ID", value: (row) => row.publicId },
                  { label: "Occurred At", value: (row) => row.occurredAt || "" },
                  { label: "Total Amount", value: (row) => row.totalAmount },
                  { label: "Litres", value: (row) => row.litres },
                  { label: "Payment Method", value: (row) => row.paymentMethod },
                  { label: "Transaction Status", value: (row) => row.status || "" },
                  { label: "Settlement Impact", value: (row) => row.settlementImpactStatus || "" },
                  { label: "Station", value: (row) => row.stationName || "" },
                  { label: "Station ID", value: (row) => row.stationPublicId || "" },
                ], transactionRows)
              }
            >
              Export Transactions
            </button>
          )}
          columns={[
            {
              key: "publicId",
              label: "Transaction ID",
              render: (row) => (
                <button type="button" className="secondary-action" onClick={() => setSelectedTransactionId(row.publicId)}>
                  {row.publicId}
                </button>
              ),
            },
            { key: "occurredAt", label: "Occurred At", render: (row) => formatDateTime(row.occurredAt) },
            { key: "totalAmount", label: "Value", render: (row) => formatMoney(row.totalAmount) },
            { key: "paymentMethod", label: "Method" },
            { key: "status", label: "Txn Status", render: (row) => <StatusPill value={row.status || "RECORDED"} /> },
            {
              key: "reviewCaseStatus",
              label: "Case Status",
              render: (row) => (row.reviewCase?.status ? <StatusPill value={row.reviewCase.status} /> : "Not flagged"),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" onClick={() => setSelectedTransactionId(row.publicId)}>Open</button>
                  <button type="button" className="secondary-action" onClick={() => setSelectedTransactionId(row.publicId)}>
                    {row.reviewCase?.publicId ? "View Case Status" : "Flag Review"}
                  </button>
                </div>
              ),
            },
          ]}
          rows={transactionRows}
        />

        <div className="stack-grid">
          <PreviewTablePanel
            title="Settlement History"
            subtitle={
              settlementHistoryActiveFilterCount
                ? `Filtered by ${settlementHistoryActiveFilterCount} settlement history filter${settlementHistoryActiveFilterCount === 1 ? "" : "s"}.`
                : ""
            }
            previewLimit={5}
            compact
            minWidth={420}
            modalTitle="Approved, Paid, and Held Settlements"
            emptyLabel={
              settlementHistoryActiveFilterCount
                ? "No settlement history found for the selected filters."
                : "No settlement history available."
            }
            modalRows={settlementHistoryRows}
            modalControls={renderSettlementHistoryModalControls()}
            columns={[
              {
                key: "publicId",
                label: "Batch ID",
                render: (row) => (
                  <button type="button" className="secondary-action" onClick={() => setSelectedSettlementId(row.publicId)}>
                    {row.publicId}
                  </button>
                ),
              },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "netAmount", label: "Amount", render: (row) => formatMoney(row.netAmount) },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    <button type="button" className="secondary-action" onClick={() => setSelectedSettlementId(row.publicId)}>Open</button>
                    {canSettle && row.status === "APPROVED" ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.markSettlementPaid(row.publicId))}>
                        Mark Paid
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={settlementHistoryRows}
          />

          <PreviewTablePanel
            title="Refund Approvals"
            previewLimit={5}
            compact
            minWidth={460}
            modalTitle="All Refund Requests"
            columns={[
              {
                key: "publicId",
                label: "Refund ID",
                render: (row) => (
                  <button type="button" className="secondary-action" onClick={() => setSelectedRefundId(row.publicId)}>
                    {row.publicId}
                  </button>
                ),
              },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "amountMwk", label: "Amount", render: (row) => formatMoney(row.amountMwk) },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    <button type="button" className="secondary-action" onClick={() => setSelectedRefundId(row.publicId)}>Open</button>
                    {canApproveRefund && row.status === "PENDING_FINANCE_APPROVAL" && (!row.complianceCasePublicId || row.complianceMarkedFalsePositive) ? (
                      <button type="button" className="secondary-action" onClick={() => handleFinanceRefundApproval(row)}>Approve</button>
                    ) : null}
                    {canApproveRefund && row.status === "PENDING_FINANCE_APPROVAL" ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.rejectFinanceRefund(row.publicId, row.resolutionNotes || ""))}>Reject</button>
                    ) : null}
                    {canApproveRefund && row.status === "PENDING_FINANCE_APPROVAL" && row.complianceCasePublicId && !row.complianceMarkedFalsePositive ? (
                      <span className="empty-cell">Waiting on compliance false positive</span>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={data.refundRequests || []}
          />

          <PreviewTablePanel
            title="Subscription Billing"
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="Station Subscription Billing"
            emptyLabel="No subscription billing accounts available."
            actions={() => (
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  downloadCsv("billing-summary.csv", [
                    { label: "Station ID", value: (row) => row.stationPublicId },
                    { label: "Station", value: (row) => row.stationName },
                    { label: "Plan", value: (row) => row.planName },
                    { label: "Status", value: (row) => row.status },
                    { label: "Monthly Fee MWK", value: (row) => row.monthlyFeeMwk },
                    { label: "Renewal Date", value: (row) => row.renewalDate || "" },
                    { label: "Last Payment At", value: (row) => row.lastPaymentAt || "" },
                  ], subscriptionBillingRows)
                }
              >
                Download Billing Summary
              </button>
            )}
            columns={[
              { key: "stationName", label: "Station" },
              { key: "planName", label: "Plan" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "renewalDate", label: "Renewal" },
              { key: "monthlyFeeMwk", label: "Monthly Fee", render: (row) => formatMoney(row.monthlyFeeMwk) },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    {canSettle && ["OVERDUE", "GRACE"].includes(row.status) ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.updateSubscriptionBillingState(row.stationPublicId, "MARK_INVOICE_PAID"))}>
                        Mark Paid
                      </button>
                    ) : null}
                    {canSettle && ["ACTIVE", "TRIAL", "OVERDUE", "GRACE"].includes(row.status) ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.updateSubscriptionBillingState(row.stationPublicId, "SUSPEND_SUBSCRIPTION"))}>
                        Suspend
                      </button>
                    ) : null}
                    {canSettle && row.status === "PAUSED" ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.updateSubscriptionBillingState(row.stationPublicId, "RESUME_SUBSCRIPTION"))}>
                        Resume
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={subscriptionBillingRows}
          />
        </div>
      </div>

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="Wallet Ledger"
          previewLimit={6}
          compact
          minWidth={520}
          modalTitle="Wallet Ledger"
          emptyLabel="No wallet ledger entries available."
          columns={[
            { key: "publicId", label: "Reference" },
            { key: "type", label: "Entry Type" },
            { key: "stationName", label: "Station" },
            { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
            { key: "amountMwk", label: "Amount", render: (row) => formatMoney(row.amountMwk) },
            { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
          ]}
          rows={walletLedgerRows}
        />

        <div className="stack-grid">
          <PreviewTablePanel
            title="Reconciliation Runs"
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="Finance Reconciliation Runs"
            emptyLabel="No reconciliation runs available."
            actions={() => (
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  downloadCsv("reconciliation-report.csv", [
                    { label: "Run ID", value: (row) => row.publicId },
                    { label: "Status", value: (row) => row.status },
                    { label: "Started At", value: (row) => row.startedAt || "" },
                    { label: "Completed At", value: (row) => row.completedAt || "" },
                    { label: "Started By", value: (row) => row.startedByName || "" },
                    { label: "Completed By", value: (row) => row.completedByName || "" },
                    { label: "Exception Count", value: (row) => row.exceptionCount },
                    { label: "Notes", value: (row) => row.notes || "" },
                  ], reconciliationRunRows)
                }
              >
                Export Reconciliation Report
              </button>
            )}
            columns={[
              { key: "publicId", label: "Run ID" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "startedAt", label: "Started", render: (row) => formatDateTime(row.startedAt) },
              { key: "exceptionCount", label: "Exceptions" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    {canSettle && row.status === "IN_PROGRESS" ? (
                      <>
                        <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.completeFinanceReconciliation(row.publicId))}>
                          Complete
                        </button>
                        <button type="button" className="secondary-action" onClick={() => setExceptionRunPublicId(row.publicId)}>
                          Raise Exception
                        </button>
                      </>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={reconciliationRunRows}
          />

          <PreviewTablePanel
            title="Reconciliation Exceptions"
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="Open and Recent Reconciliation Exceptions"
            emptyLabel="No reconciliation exceptions recorded."
            columns={[
              { key: "publicId", label: "Exception ID" },
              { key: "runPublicId", label: "Run" },
              { key: "exceptionType", label: "Type" },
              { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
              { key: "summary", label: "Summary" },
            ]}
            rows={reconciliationExceptionRows}
          />

          <PreviewTablePanel
            title="Wallet Adjustment Requests"
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="Wallet Adjustment Requests"
            emptyLabel="No wallet adjustment requests available."
            columns={[
              { key: "publicId", label: "Request ID" },
              { key: "stationName", label: "Station" },
              { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
              { key: "amountMwk", label: "Amount", render: (row) => formatMoney(row.amountMwk) },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    {canSettle && row.status === "PENDING" ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.approveWalletAdjustmentRequest(row.publicId))}>
                        Approve
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={walletAdjustmentRows}
          />

          <PreviewTablePanel
            title="Billing Overview"
            previewLimit={5}
            compact
            minWidth={420}
            modalTitle="Billing Overview"
            columns={[
              { key: "billingMonth", label: "Month" },
              { key: "settlementCount", label: "Settlements" },
              { key: "netSettled", label: "Net Settled", render: (row) => formatMoney(row.netSettled) },
              { key: "platformFees", label: "Platform Fees", render: (row) => formatMoney(row.platformFees) },
            ]}
            rows={data.billingOverview || []}
          />
        </div>
      </div>

      <Panel title="Recent Finance Audit">
        <FinanceAuditList items={data.financeAudit || []} />
      </Panel>

      {showCreateSettlement ? (
        <CreateSettlementBatchModal
          onClose={() => setShowCreateSettlement(false)}
          onCreate={(payload) => runAction(() => internalApi.createSettlementBatch(payload))}
        />
      ) : null}

      {showStartReconciliation ? (
        <StartReconciliationModal
          onClose={() => setShowStartReconciliation(false)}
          onStart={(note) => runAction(() => internalApi.startFinanceReconciliation(note))}
        />
      ) : null}

      {showWalletAdjustment ? (
        <WalletAdjustmentModal
          onClose={() => setShowWalletAdjustment(false)}
          onCreate={(payload) => runAction(() => internalApi.createWalletAdjustmentRequest(payload))}
        />
      ) : null}

      {showSettlementHistoryFilters ? (
        <SettlementHistoryFilterModal
          draftFilters={settlementHistoryDraftFilters}
          statusOptions={settlementHistoryStatusOptions}
          activeCount={settlementHistoryActiveFilterCount}
          invalidRange={settlementHistoryHasInvalidRange}
          onChange={(key, value) => setSettlementHistoryDraftFilters((current) => ({ ...current, [key]: value }))}
          onApply={applySettlementHistoryFilters}
          onReset={resetSettlementHistoryFilters}
          onClose={closeSettlementHistoryFilters}
        />
      ) : null}

      {exceptionRunPublicId ? (
        <ReconciliationExceptionModal
          runPublicId={exceptionRunPublicId}
          onClose={() => setExceptionRunPublicId("")}
          onSubmit={(runPublicId, payload) => runAction(() => internalApi.raiseFinanceReconciliationException(runPublicId, payload))}
        />
      ) : null}

      {selectedSettlement ? (
        <SettlementDetailModal
          settlement={selectedSettlement}
          canSettle={canSettle}
          canReject={canRejectSettlement}
          onProcessing={(batchPublicId) => runAction(() => internalApi.markSettlementProcessing(batchPublicId))}
          onApprove={(batchPublicId) => runAction(() => internalApi.approveSettlement(batchPublicId))}
          onReject={(batchPublicId) => runAction(() => internalApi.rejectSettlement(batchPublicId))}
          onPaid={(batchPublicId) => runAction(() => internalApi.markSettlementPaid(batchPublicId))}
          onClose={() => setSelectedSettlementId(null)}
        />
      ) : null}

      {showFlaggedSettlements ? (
        <FlaggedSettlementsModal
          rows={flaggedSettlementRows}
          onOpenSettlement={(batchPublicId) => {
            setShowFlaggedSettlements(false)
            setSelectedSettlementId(batchPublicId)
          }}
          onClose={() => setShowFlaggedSettlements(false)}
        />
      ) : null}

      {selectedTransaction ? (
        <TransactionDetailModal
          transaction={selectedTransaction}
          primaryRole={primaryRole}
          onFlagReview={(transactionPublicId, payload) => runAction(() => internalApi.flagTransactionForReview(transactionPublicId, payload))}
          onFinanceReviewAction={(transactionPublicId, payload) => runAction(() => internalApi.requestTransactionCancellationReview(transactionPublicId, payload))}
          onCancelFinancialError={(transactionPublicId, payload) => runAction(() => internalApi.cancelTransactionFinancialError(transactionPublicId, payload))}
          onClose={() => setSelectedTransactionId(null)}
        />
      ) : null}

      {selectedRefund ? (
        <RefundInvestigationModal
          refundPublicId={selectedRefund.publicId}
          mode="finance"
          allowApprove={canApproveRefund}
          allowReject={canApproveRefund}
          allowComplianceEscalation={canApproveRefund}
          onChanged={load}
          onClose={() => setSelectedRefundId(null)}
        />
      ) : null}

      {pendingRefundApproval ? (
        <ActionConfirmModal
          title="Compliance False Positive"
          message="This refund was previously escalated to compliance and later marked as a false positive. Continue with finance approval?"
          confirmLabel="Continue"
          cancelLabel="Cancel"
          onClose={() => setPendingRefundApproval(null)}
          onConfirm={() => {
            const current = pendingRefundApproval
            setPendingRefundApproval(null)
            return runAction(() => internalApi.approveFinanceRefund(current.publicId, current.resolutionNotes || ""))
          }}
        />
      ) : null}
    </InternalShell>
  )
}

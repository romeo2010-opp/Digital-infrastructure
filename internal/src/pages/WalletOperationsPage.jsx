import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import InternalShell from "../components/InternalShell"
import MetricGrid from "../components/MetricGrid"
import PreviewTablePanel from "../components/PreviewTablePanel"
import { DataTable, Panel } from "../components/PanelTable"
import StatusPill from "../components/StatusPill"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import { formatDateTime, formatMoney, formatNumber, formatRelative } from "../utils/display"

function generateRequestKey(prefix = "wallet-op") {
  const randomSuffix = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${randomSuffix}`
}

function formatEnumLabel(value, fallback = "-") {
  if (!value) return fallback
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function downloadFile(blob, filename = "download.csv") {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

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

function WalletMutationModal({ config, onClose, onSubmit }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState(() => ({ ...(config?.initialValues || {}) }))

  if (!config) return null

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onSubmit(form)
      onClose()
    } catch (err) {
      setError(err?.message || "Request failed")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title={config.title} subtitle={config.subtitle} onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid wallet-console-form-grid">
            {(config.fields || []).map((field) => (
              <label
                key={field.name}
                className={`settings-form-field ${field.fullWidth ? "settings-form-field--full" : ""}`}
              >
                <span>{field.label}</span>
                {field.type === "select" ? (
                  <select
                    value={form[field.name] ?? ""}
                    disabled={working}
                    onChange={(event) => setForm((previous) => ({ ...previous, [field.name]: event.target.value }))}
                  >
                    {(field.options || []).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    rows={field.rows || 4}
                    value={form[field.name] ?? ""}
                    placeholder={field.placeholder || ""}
                    disabled={working}
                    onChange={(event) => setForm((previous) => ({ ...previous, [field.name]: event.target.value }))}
                  />
                ) : (
                  <input
                    type={field.type || "text"}
                    value={form[field.name] ?? ""}
                    placeholder={field.placeholder || ""}
                    min={field.min}
                    step={field.step}
                    disabled={working}
                    onChange={(event) => setForm((previous) => ({ ...previous, [field.name]: event.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              {working ? "Working..." : config.submitLabel || "Submit"}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function WalletRequestDecisionModal({ request, decision, onClose, onSubmit }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [rejectionReason, setRejectionReason] = useState("")

  if (!request) return null

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onSubmit({
        requestId: request.publicId,
        rejectionReason: rejectionReason.trim(),
      })
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to update request")
    } finally {
      setWorking(false)
    }
  }

  const approving = decision === "APPROVE"

  return (
    <ModalFrame
      title={approving ? "Approve Wallet Operation" : "Reject Wallet Operation"}
      subtitle={approving ? "This will execute the pending wallet operation immediately." : "Record the rejection reason for the pending wallet operation."}
      badges={<StatusPill value={request.operationType} />}
      onClose={onClose}
    >
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Request ID</span><strong>{request.publicId}</strong></div>
          <div><span>Wallet</span><strong>{request.walletPublicId}</strong></div>
          <div><span>Operation</span><strong>{formatEnumLabel(request.operationType)}</strong></div>
          <div><span>Requested By</span><strong>{request.requestedByName}</strong></div>
          <div><span>Amount</span><strong>{request.amountMwk === null ? "-" : formatMoney(request.amountMwk)}</strong></div>
          <div><span>Created</span><strong>{formatDateTime(request.createdAt)}</strong></div>
        </div>
        {!approving ? (
          <div className="settings-form-card">
            <label className="settings-form-field">
              <span>Rejection reason</span>
              <textarea
                rows={4}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Explain why this request is being rejected."
                disabled={working}
              />
            </label>
          </div>
        ) : null}
        <div className="settings-form-actions">
          <button type="button" className="secondary-action" disabled={working} onClick={submit}>
            {working ? "Working..." : approving ? "Approve and Execute" : "Reject Request"}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}

export default function WalletOperationsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasPermission } = useInternalAuth()
  const [searchId, setSearchId] = useState(() => searchParams.get("walletId") || "")
  const [walletId, setWalletId] = useState(() => searchParams.get("walletId") || "")
  const [loading, setLoading] = useState(Boolean(searchParams.get("walletId")))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [data, setData] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [pointsHistory, setPointsHistory] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [operationRequests, setOperationRequests] = useState([])
  const [actionModal, setActionModal] = useState(null)
  const [decisionModal, setDecisionModal] = useState(null)

  const canViewTransactions = hasPermission("wallet.transactions.view")
  const canViewPoints = hasPermission("wallet.points.view")
  const canViewAudit = hasPermission("wallet.audit.view")
  const canAdjustPoints = hasPermission("wallet.points.adjust")
  const canRequestRefund = hasPermission("wallet.refund.request")
  const canIssueCredit = hasPermission("wallet.wallet_credit.issue")
  const canAdjustLedger = hasPermission("wallet.ledger.adjust")
  const canTransferBalance = hasPermission("wallet.balance.transfer")
  const canFreeze = hasPermission("wallet.freeze")
  const canUnfreeze = hasPermission("wallet.unfreeze")
  const canMarkReview = hasPermission("wallet.review.mark")
  const canExportStatement = hasPermission("wallet.statement.export")
  const canPlaceHold = hasPermission("wallet.hold.place")
  const canReleaseHold = hasPermission("wallet.hold.release")

  async function loadWallet(nextWalletId, { initial = false } = {}) {
    if (!nextWalletId) return
    const applyLoading = initial ? setLoading : setRefreshing
    applyLoading(true)
    setError("")
    try {
      const [walletConsole, transactionPayload, nextPointsHistory, nextAuditLogs, nextOperationRequests] = await Promise.all([
        internalApi.getWalletConsole(nextWalletId),
        canViewTransactions ? internalApi.getWalletTransactions(nextWalletId, { limit: 80 }) : Promise.resolve({ items: [] }),
        canViewPoints ? internalApi.getWalletPointsHistory(nextWalletId, { limit: 80 }) : Promise.resolve([]),
        canViewAudit ? internalApi.getWalletAuditLogs(nextWalletId, { limit: 80 }) : Promise.resolve([]),
        internalApi.getWalletOperationRequests({ walletId: nextWalletId }),
      ])

      setData(walletConsole || null)
      setTransactions(Array.isArray(transactionPayload?.items) ? transactionPayload.items : [])
      setPointsHistory(Array.isArray(nextPointsHistory) ? nextPointsHistory : [])
      setAuditLogs(Array.isArray(nextAuditLogs) ? nextAuditLogs : [])
      setOperationRequests(Array.isArray(nextOperationRequests) ? nextOperationRequests : [])
      setWalletId(nextWalletId)
      setSearchId(nextWalletId)
      setSearchParams({ walletId: nextWalletId })
    } catch (err) {
      setError(err?.message || "Failed to load wallet console")
      if (initial) {
        setData(null)
        setTransactions([])
        setPointsHistory([])
        setAuditLogs([])
        setOperationRequests([])
      }
    } finally {
      applyLoading(false)
    }
  }

  useEffect(() => {
    const nextWalletId = searchParams.get("walletId") || ""
    if (!nextWalletId) return
    setWalletId(nextWalletId)
    setSearchId(nextWalletId)
    loadWallet(nextWalletId, { initial: true })
  }, [])

  async function handleSearch(event) {
    event.preventDefault()
    const displayId = searchId.trim()
    if (!displayId) return
    setLoading(true)
    setError("")
    try {
      const lookup = await internalApi.lookupWallet(displayId)
      const resolvedWalletId = lookup?.walletPublicId || displayId
      await loadWallet(resolvedWalletId, { initial: true })
    } catch (err) {
      setError(err?.message || "Wallet lookup failed")
      setData(null)
      setTransactions([])
      setPointsHistory([])
      setAuditLogs([])
      setOperationRequests([])
      setLoading(false)
    }
  }

  async function refreshCurrentWallet() {
    if (!walletId) return
    await loadWallet(walletId)
  }

  async function handleExportStatement() {
    if (!walletId) return
    const result = await internalApi.downloadWalletStatement(walletId)
    downloadFile(result.blob, result.filename || `${walletId}.csv`)
  }

  async function handleCopyWalletId() {
    if (!data?.wallet?.walletPublicId) return
    await navigator.clipboard.writeText(data.wallet.walletPublicId)
  }

  function openMutation(config) {
    setActionModal(config)
  }

  async function submitMutation(form) {
    if (!walletId || !actionModal) return
    const payload = {
      reasonCode: form.reasonCode?.trim() || "",
      note: form.note?.trim() || "",
      requestKey: generateRequestKey(actionModal.requestKeyPrefix || "wallet-op"),
    }

    if (actionModal.kind === "pointsAdjust") {
      await internalApi.createWalletPointsAdjustment(walletId, {
        ...payload,
        deltaPoints: Number(form.deltaPoints),
      })
    } else if (actionModal.kind === "refundRequest") {
      await internalApi.createWalletRefundRequest(walletId, {
        ...payload,
        sourceTransactionPublicId: form.sourceTransactionPublicId?.trim() || "",
        amountMwk: Number(form.amountMwk),
      })
    } else if (actionModal.kind === "walletCredit") {
      await internalApi.createWalletCredit(walletId, {
        ...payload,
        amountMwk: Number(form.amountMwk),
      })
    } else if (actionModal.kind === "ledgerAdjustment") {
      await internalApi.createWalletLedgerAdjustment(walletId, {
        ...payload,
        amountMwk: Number(form.amountMwk),
        direction: form.direction,
      })
    } else if (actionModal.kind === "balanceTransfer") {
      await internalApi.createWalletBalanceTransfer(walletId, {
        ...payload,
        amountMwk: Number(form.amountMwk),
        destinationWalletDisplayId: form.destinationWalletDisplayId?.trim() || "",
        destinationSystemAccountCode: form.destinationSystemAccountCode?.trim() || "",
      })
    } else if (actionModal.kind === "freeze") {
      await internalApi.freezeWallet(walletId, payload)
    } else if (actionModal.kind === "unfreeze") {
      await internalApi.unfreezeWallet(walletId, payload)
    } else if (actionModal.kind === "markReview") {
      await internalApi.markWalletUnderReview(walletId, payload)
    } else if (actionModal.kind === "holdPlace") {
      await internalApi.placeWalletHold(walletId, {
        ...payload,
        amountMwk: Number(form.amountMwk),
      })
    } else if (actionModal.kind === "holdRelease") {
      await internalApi.releaseWalletHold(walletId, actionModal.holdId, payload)
    }

    await refreshCurrentWallet()
  }

  async function submitDecision({ requestId, rejectionReason }) {
    if (!decisionModal) return
    if (decisionModal.decision === "APPROVE") {
      await internalApi.approveWalletOperationRequest(requestId)
    } else {
      await internalApi.rejectWalletOperationRequest(requestId, rejectionReason)
    }
    await refreshCurrentWallet()
  }

  const walletProfileRows = useMemo(() => {
    if (!data?.wallet) return []
    return [
      { label: "Wallet Display ID", value: data.wallet.walletPublicId },
      { label: "Customer", value: data.wallet.customerName || "-" },
      { label: "Email", value: data.wallet.email || "-" },
      { label: "Phone", value: data.wallet.phone || "-" },
      { label: "Status", value: formatEnumLabel(data.wallet.status) },
      { label: "KYC Level", value: data.wallet.kycLevel || "-" },
      { label: "Created", value: formatDateTime(data.wallet.createdAt) },
      { label: "Last Activity", value: data.wallet.lastActivityAt ? `${formatDateTime(data.wallet.lastActivityAt)} (${formatRelative(data.wallet.lastActivityAt)})` : "-" },
    ]
  }, [data])

  const transactionRows = useMemo(() => transactions.map((item) => ({
    ...item,
    displayDate: formatDateTime(item.postedAt || item.createdAt),
    linkedReference: item.linkedReference || "-",
  })), [transactions])

  const pointRows = useMemo(() => pointsHistory.map((item) => ({
    ...item,
    displayDate: formatDateTime(item.createdAt),
    displayDelta: item.deltaPoints > 0 ? `+${item.deltaPoints}` : String(item.deltaPoints),
  })), [pointsHistory])

  const auditRows = useMemo(() => auditLogs.map((item) => ({
    ...item,
    displayDate: formatDateTime(item.createdAt),
  })), [auditLogs])

  const requestRows = useMemo(() => operationRequests.map((item) => ({
    ...item,
    createdLabel: formatDateTime(item.createdAt),
  })), [operationRequests])

  const holdRows = useMemo(() => (data?.holds?.items || []).map((item) => ({
    ...item,
    displayCreatedAt: formatDateTime(item.createdAt),
  })), [data])
  const transactionMetricColumns = useMemo(
    () => [
      { key: "displayDate", label: "Datetime" },
      { key: "reference", label: "Ref" },
      { key: "type", label: "Type" },
      { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
      { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
    ],
    []
  )
  const pointMetricColumns = useMemo(
    () => [
      { key: "displayDate", label: "Datetime" },
      { key: "displayDelta", label: "Delta" },
      { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
      { key: "reasonCode", label: "Reason" },
      { key: "createdByName", label: "Actor" },
    ],
    []
  )
  const requestMetricColumns = useMemo(
    () => [
      { key: "publicId", label: "Request ID" },
      { key: "operationType", label: "Operation", render: (row) => formatEnumLabel(row.operationType) },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "amountMwk", label: "Amount", render: (row) => row.amountMwk === null ? "-" : formatMoney(row.amountMwk) },
      { key: "createdLabel", label: "Created" },
    ],
    []
  )
  const holdMetricColumns = useMemo(
    () => [
      { key: "reference", label: "Reference" },
      { key: "holdType", label: "Type" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
      { key: "displayCreatedAt", label: "Created" },
    ],
    []
  )
  const failedTransactionRows = useMemo(
    () => transactionRows.filter((row) => String(row.status || "").toUpperCase().includes("FAIL")),
    [transactionRows]
  )
  const refundRequestRows = useMemo(
    () => requestRows.filter((row) => String(row.operationType || "").toUpperCase().includes("REFUND")),
    [requestRows]
  )
  const manualAdjustmentRows = useMemo(
    () =>
      requestRows.filter((row) =>
        ["WALLET_CREDIT", "LEDGER_ADJUSTMENT", "POINTS_ADJUST", "BALANCE_TRANSFER"].some((token) =>
          String(row.operationType || "").toUpperCase().includes(token)
        )
      ),
    [requestRows]
  )
  const pendingRequestRows = useMemo(
    () => requestRows.filter((row) => String(row.status || "").toUpperCase() === "PENDING"),
    [requestRows]
  )
  const creditPendingRows = useMemo(
    () =>
      pendingRequestRows.filter((row) =>
        ["WALLET_CREDIT", "REFUND", "POINT", "CREDIT"].some((token) => String(row.operationType || "").toUpperCase().includes(token))
      ),
    [pendingRequestRows]
  )
  const debitPendingRows = useMemo(
    () =>
      pendingRequestRows.filter((row) =>
        ["DEBIT", "TRANSFER", "HOLD"].some((token) => String(row.operationType || "").toUpperCase().includes(token))
      ),
    [pendingRequestRows]
  )
  const balanceMetrics = useMemo(() => {
    const balances = data?.balances || {}
    return [
      {
        label: "Available Balance",
        value: formatMoney(balances.availableBalance),
        tone: "success",
        drilldown: {
          title: "Available Balance",
          subtitle: "Current available wallet balance with recent transaction context.",
          content: (
            <div className="stack-grid">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>Available Balance</span><strong>{formatMoney(balances.availableBalance)}</strong></div>
                <div><span>Total Inflow</span><strong>{formatMoney(balances.totalInflow)}</strong></div>
                <div><span>Total Outflow</span><strong>{formatMoney(balances.totalOutflow)}</strong></div>
                <div><span>Held Balance</span><strong>{formatMoney(balances.heldBalance)}</strong></div>
              </div>
              <DataTable columns={transactionMetricColumns} rows={transactionRows.slice(0, 12)} emptyLabel="No recent transactions." compact minWidth={760} />
            </div>
          ),
        },
      },
      {
        label: "Held Balance",
        value: formatMoney(balances.heldBalance),
        tone: balances.heldBalance ? "warning" : "neutral",
        drilldown: {
          title: "Held Balance",
          subtitle: "Current active holds contributing to the held wallet balance.",
          rows: holdRows.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE"),
          columns: holdMetricColumns,
          emptyLabel: "No active holds found.",
          minWidth: 760,
        },
      },
      {
        label: "Pending Credits",
        value: formatMoney(balances.pendingCredits),
        tone: balances.pendingCredits ? "warning" : "neutral",
        drilldown: {
          title: "Pending Credits",
          subtitle: "Pending wallet requests likely to increase wallet value.",
          rows: creditPendingRows,
          columns: requestMetricColumns,
          emptyLabel: "No pending credit requests found.",
          minWidth: 860,
        },
      },
      {
        label: "Pending Debits",
        value: formatMoney(balances.pendingDebits),
        tone: balances.pendingDebits ? "warning" : "neutral",
        drilldown: {
          title: "Pending Debits",
          subtitle: "Pending wallet requests likely to reduce wallet value.",
          rows: debitPendingRows,
          columns: requestMetricColumns,
          emptyLabel: "No pending debit requests found.",
          minWidth: 860,
        },
      },
      {
        label: "Total Inflow",
        value: formatMoney(balances.totalInflow),
        tone: "success",
        drilldown: {
          title: "Total Inflow",
          subtitle: "Wallet transactions contributing to incoming value.",
          rows: transactionRows.filter((row) => ["IN", "CREDIT"].includes(String(row.direction || "").toUpperCase())),
          columns: transactionMetricColumns,
          emptyLabel: "No inflow transactions found.",
          minWidth: 860,
        },
      },
      {
        label: "Total Outflow",
        value: formatMoney(balances.totalOutflow),
        tone: "danger",
        drilldown: {
          title: "Total Outflow",
          subtitle: "Wallet transactions contributing to outgoing value.",
          rows: transactionRows.filter((row) => ["OUT", "DEBIT"].includes(String(row.direction || "").toUpperCase())),
          columns: transactionMetricColumns,
          emptyLabel: "No outflow transactions found.",
          minWidth: 860,
        },
      },
    ]
  }, [creditPendingRows, data?.balances, debitPendingRows, holdMetricColumns, holdRows, requestMetricColumns, transactionMetricColumns, transactionRows])

  const loyaltyMetrics = useMemo(() => {
    const loyalty = data?.loyalty || {}
    return [
      {
        label: "Points Balance",
        value: formatNumber(loyalty.pointsBalance),
        tone: "success",
        drilldown: {
          title: "Points Balance",
          subtitle: "Loyalty points history contributing to the current balance.",
          rows: pointRows,
          columns: pointMetricColumns,
          emptyLabel: "No points history has been recorded.",
          minWidth: 820,
        },
      },
      {
        label: "Current Tier",
        value: formatEnumLabel(loyalty.currentTier),
        tone: "neutral",
        drilldown: {
          title: "Current Loyalty Tier",
          subtitle: "Current loyalty tier with supporting profile context.",
          content: (
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Current Tier</span><strong>{formatEnumLabel(loyalty.currentTier)}</strong></div>
              <div><span>Points Balance</span><strong>{formatNumber(loyalty.pointsBalance)}</strong></div>
              <div><span>Tier Progress</span><strong>{loyalty.tierProgressPercent === null ? "-" : `${Number(loyalty.tierProgressPercent).toFixed(1)}%`}</strong></div>
              <div><span>Last Activity</span><strong>{loyalty.lastActivityAt ? formatDateTime(loyalty.lastActivityAt) : "-"}</strong></div>
            </div>
          ),
        },
      },
      {
        label: "Tier Progress",
        value: loyalty.tierProgressPercent === null ? "-" : `${Number(loyalty.tierProgressPercent).toFixed(1)}%`,
        tone: "neutral",
        drilldown: {
          title: "Tier Progress",
          subtitle: "Current loyalty tier progress and recent points changes.",
          content: (
            <div className="stack-grid">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>Current Tier</span><strong>{formatEnumLabel(loyalty.currentTier)}</strong></div>
                <div><span>Tier Progress</span><strong>{loyalty.tierProgressPercent === null ? "-" : `${Number(loyalty.tierProgressPercent).toFixed(1)}%`}</strong></div>
                <div><span>Points Balance</span><strong>{formatNumber(loyalty.pointsBalance)}</strong></div>
              </div>
              <DataTable columns={pointMetricColumns} rows={pointRows.slice(0, 10)} emptyLabel="No points activity found." compact minWidth={720} />
            </div>
          ),
        },
      },
      {
        label: "Last Points Activity",
        value: loyalty.lastActivityAt ? formatRelative(loyalty.lastActivityAt) : "-",
        tone: "neutral",
        drilldown: {
          title: "Last Points Activity",
          subtitle: "Most recent loyalty activity on the wallet.",
          rows: pointRows,
          columns: pointMetricColumns,
          emptyLabel: "No points activity found.",
          minWidth: 820,
        },
      },
    ]
  }, [data?.loyalty, pointMetricColumns, pointRows])

  const riskMetrics = useMemo(() => {
    const risk = data?.risk || {}
    return [
      {
        label: "Recent Failed Transactions",
        value: formatNumber(risk.recentFailedTransactionsCount),
        tone: risk.recentFailedTransactionsCount ? "danger" : "neutral",
        drilldown: {
          title: "Recent Failed Transactions",
          subtitle: "Recent wallet transactions that failed or require recovery.",
          rows: failedTransactionRows,
          columns: transactionMetricColumns,
          emptyLabel: "No failed transactions found.",
          minWidth: 860,
        },
      },
      {
        label: "Recent Refund Requests",
        value: formatNumber(risk.recentRefundCount),
        tone: risk.recentRefundCount ? "warning" : "neutral",
        drilldown: {
          title: "Recent Refund Requests",
          subtitle: "Recent wallet refund-related requests for this wallet.",
          rows: refundRequestRows,
          columns: requestMetricColumns,
          emptyLabel: "No recent refund requests found.",
          minWidth: 860,
        },
      },
      {
        label: "Manual Adjustments",
        value: formatNumber(risk.manualAdjustmentsCount),
        tone: risk.manualAdjustmentsCount ? "warning" : "neutral",
        drilldown: {
          title: "Manual Adjustments",
          subtitle: "Manual wallet adjustment and correction requests tied to this wallet.",
          rows: manualAdjustmentRows,
          columns: requestMetricColumns,
          emptyLabel: "No manual adjustment requests found.",
          minWidth: 860,
        },
      },
      {
        label: "Under Review",
        value: risk.underReview ? "Yes" : "No",
        tone: risk.underReview ? "warning" : "success",
        drilldown: {
          title: "Under Review Status",
          subtitle: "Operational review state and linked case context for this wallet.",
          content: (
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Under Review</span><strong>{risk.underReview ? "Yes" : "No"}</strong></div>
              <div><span>Review Note</span><strong>{data?.wallet?.underReviewNote || data?.wallet?.suspendedNote || "-"}</strong></div>
              <div><span>Linked Support Cases</span><strong>{risk.linkedSupportCaseReferences?.length ? risk.linkedSupportCaseReferences.join(", ") : "None"}</strong></div>
              <div><span>Wallet Flags</span><strong>{risk.walletFlags?.length ? risk.walletFlags.join(", ") : "No active ops flags"}</strong></div>
            </div>
          ),
        },
      },
    ]
  }, [data?.risk, data?.wallet?.suspendedNote, data?.wallet?.underReviewNote, failedTransactionRows, manualAdjustmentRows, refundRequestRows, requestMetricColumns, transactionMetricColumns])

  const visibleActions = useMemo(() => {
    const actions = [
      {
        key: "copy",
        label: "Copy Wallet ID",
        onClick: handleCopyWalletId,
        visible: Boolean(data?.wallet?.walletPublicId),
      },
      {
        key: "transactions",
        label: "View Transactions",
        onClick: () => document.getElementById("wallet-transactions-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        visible: canViewTransactions,
      },
      {
        key: "points",
        label: "View Points History",
        onClick: () => document.getElementById("wallet-points-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        visible: canViewPoints,
      },
      {
        key: "export",
        label: "Export Statement",
        onClick: handleExportStatement,
        visible: canExportStatement,
      },
      {
        key: "escalate",
        label: "Escalate Case",
        onClick: () => navigate("/support-disputes"),
        visible: hasPermission("support:escalate"),
      },
      {
        key: "adjust-points",
        label: "Adjust Points",
        onClick: () => openMutation({
          kind: "pointsAdjust",
          title: "Adjust Wallet Points",
          subtitle: "Apply a manual points credit or deduction with a reasoned audit trail.",
          submitLabel: "Apply Points Adjustment",
          requestKeyPrefix: "wallet-points",
          fields: [
            { name: "deltaPoints", label: "Delta points", type: "number", step: "1", placeholder: "e.g. 150 or -50" },
            { name: "reasonCode", label: "Reason code", placeholder: "LOYALTY_REMEDIATION" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain why the points balance is changing." },
          ],
        }),
        visible: canAdjustPoints,
      },
      {
        key: "refund",
        label: "Request Refund",
        onClick: () => openMutation({
          kind: "refundRequest",
          title: "Request Wallet Refund",
          subtitle: "Create a customer refund request tied to a source transaction.",
          submitLabel: "Create Refund Request",
          requestKeyPrefix: "wallet-refund",
          fields: [
            { name: "sourceTransactionPublicId", label: "Source transaction ID", placeholder: "TXN-PAY-..." },
            { name: "amountMwk", label: "Amount (MWK)", type: "number", min: "0", step: "0.01" },
            { name: "reasonCode", label: "Reason code", placeholder: "DISPENSE_FAILURE" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Summarize the refund rationale and evidence." },
          ],
        }),
        visible: canRequestRefund,
      },
      {
        key: "credit",
        label: "Issue Wallet Credit",
        onClick: () => openMutation({
          kind: "walletCredit",
          title: "Issue Wallet Credit",
          subtitle: "Apply a compensation or goodwill credit to the wallet.",
          submitLabel: "Create Credit Request",
          requestKeyPrefix: "wallet-credit",
          fields: [
            { name: "amountMwk", label: "Amount (MWK)", type: "number", min: "0", step: "0.01" },
            { name: "reasonCode", label: "Reason code", placeholder: "GOODWILL_COMPENSATION" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain the remediation or compensation rationale." },
          ],
        }),
        visible: canIssueCredit,
      },
      {
        key: "review",
        label: "Mark Under Review",
        onClick: () => openMutation({
          kind: "markReview",
          title: "Mark Wallet Under Review",
          subtitle: "Restrict the wallet for ops follow-up with an auditable reason.",
          submitLabel: "Mark Under Review",
          requestKeyPrefix: "wallet-review",
          fields: [
            { name: "reasonCode", label: "Reason code", placeholder: "OPS_REVIEW" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Describe the operational concern or investigation trigger." },
          ],
        }),
        visible: canMarkReview,
      },
      {
        key: "freeze",
        label: "Freeze Wallet",
        onClick: () => openMutation({
          kind: "freeze",
          title: "Freeze Wallet",
          subtitle: "Freeze wallet activity. This action is audited and blocks active wallet use.",
          submitLabel: "Freeze Wallet",
          requestKeyPrefix: "wallet-freeze",
          fields: [
            { name: "reasonCode", label: "Reason code", placeholder: "RISK_FREEZE" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain why the wallet is being frozen." },
          ],
        }),
        visible: canFreeze && data?.wallet?.status !== "FROZEN",
      },
      {
        key: "unfreeze",
        label: "Unfreeze Wallet",
        onClick: () => openMutation({
          kind: "unfreeze",
          title: "Unfreeze Wallet",
          subtitle: "Restore wallet activity after review and record the reason.",
          submitLabel: "Unfreeze Wallet",
          requestKeyPrefix: "wallet-unfreeze",
          fields: [
            { name: "reasonCode", label: "Reason code", placeholder: "RISK_CLEARANCE" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain why the freeze is being lifted." },
          ],
        }),
        visible: canUnfreeze && data?.wallet?.status === "FROZEN",
      },
      {
        key: "ledger-adjust",
        label: "Create Ledger Adjustment",
        onClick: () => openMutation({
          kind: "ledgerAdjustment",
          title: "Create Ledger Adjustment",
          subtitle: "Post an internal accounting correction request with explicit direction and rationale.",
          submitLabel: "Create Adjustment Request",
          requestKeyPrefix: "wallet-ledger",
          fields: [
            { name: "direction", label: "Direction", type: "select", options: [{ value: "CREDIT", label: "Credit" }, { value: "DEBIT", label: "Debit" }] },
            { name: "amountMwk", label: "Amount (MWK)", type: "number", min: "0", step: "0.01" },
            { name: "reasonCode", label: "Reason code", placeholder: "LEDGER_CORRECTION" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain the accounting correction and supporting evidence." },
          ],
          initialValues: { direction: "CREDIT" },
        }),
        visible: canAdjustLedger,
      },
      {
        key: "transfer",
        label: "Move Balance",
        onClick: () => openMutation({
          kind: "balanceTransfer",
          title: "Move Wallet Balance",
          subtitle: "Move MWK balance to another wallet or an approved system account.",
          submitLabel: "Create Transfer Request",
          requestKeyPrefix: "wallet-transfer",
          fields: [
            { name: "amountMwk", label: "Amount (MWK)", type: "number", min: "0", step: "0.01" },
            { name: "destinationWalletDisplayId", label: "Destination wallet ID", placeholder: "SLW-XXXX-XXXX" },
            { name: "destinationSystemAccountCode", label: "Destination system account", placeholder: "MANUAL_ADJUSTMENTS_MAIN" },
            { name: "reasonCode", label: "Reason code", placeholder: "BALANCE_REASSIGNMENT" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain the balance movement and the control context." },
          ],
        }),
        visible: canTransferBalance,
      },
      {
        key: "hold",
        label: "Place Hold",
        onClick: () => openMutation({
          kind: "holdPlace",
          title: "Place Manual Hold",
          subtitle: "Reserve wallet funds without moving them out of the ledger.",
          submitLabel: "Place Hold",
          requestKeyPrefix: "wallet-hold",
          fields: [
            { name: "amountMwk", label: "Amount (MWK)", type: "number", min: "0", step: "0.01" },
            { name: "reasonCode", label: "Reason code", placeholder: "INVESTIGATION_HOLD" },
            { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain why the hold is needed." },
          ],
        }),
        visible: canPlaceHold,
      },
    ]

    return actions.filter((item) => item.visible)
  }, [
    canAdjustLedger,
    canAdjustPoints,
    canExportStatement,
    canFreeze,
    canIssueCredit,
    canMarkReview,
    canPlaceHold,
    canRequestRefund,
    canTransferBalance,
    canUnfreeze,
    canViewPoints,
    canViewTransactions,
    data,
    hasPermission,
    navigate,
  ])

  return (
    <InternalShell title="Wallet Operations" alerts={error ? [{ id: "wallet-ops-error", type: "ERROR", title: "Wallet Console Error", body: error }] : []}>
      <div className="wallet-console-page">
        <Panel
          title="Wallet Lookup"
          subtitle="Search by SmartLink wallet display ID to inspect balances, loyalty, audit history, and privileged operations."
          actions={
            <form className="inline-action-group wallet-console-search" onSubmit={handleSearch}>
              <input
                value={searchId}
                onChange={(event) => setSearchId(event.target.value.toUpperCase())}
                placeholder="SLW-XXXX-XXXX"
                aria-label="Wallet display ID"
              />
              <button type="submit" className="secondary-action" disabled={loading}>
                {loading ? "Searching..." : "Search Wallet"}
              </button>
              {walletId ? (
                <button type="button" className="secondary-action" disabled={refreshing} onClick={refreshCurrentWallet}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              ) : null}
            </form>
          }
        >
          {!walletId && !loading ? <p className="empty-cell">Enter a wallet display ID to open the operations console.</p> : null}
          {loading ? <p className="empty-cell">Loading wallet console...</p> : null}
        </Panel>

        {data?.wallet ? (
          <>
            <section className="wallet-console-hero">
              <div className="wallet-console-hero-copy">
                <span className="topbar-kicker">Wallet Operations Console</span>
                <h2>{data.wallet.walletPublicId}</h2>
                <p>{data.wallet.customerName || "Unknown user"} · {data.wallet.email || data.wallet.phone || "No direct contact on file"}</p>
              </div>
              <div className="wallet-console-hero-meta">
                <StatusPill value={data.wallet.status} />
                <div className="wallet-console-action-grid">
                  {visibleActions.map((action) => (
                    <button key={action.key} type="button" className="secondary-action" onClick={action.onClick}>
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="wallet-console-grid">
              <Panel title="Wallet Profile" subtitle="Primary wallet ownership and lifecycle data.">
                <div className="settings-summary-list admin-detail-grid">
                  {walletProfileRows.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Risk And Ops" subtitle="Review flags, support links, and recent operational signals.">
                <MetricGrid items={riskMetrics} />
                <div className="wallet-console-block-list">
                  <article className="wallet-console-block">
                    <span>Wallet Flags</span>
                    <strong>{data.risk?.walletFlags?.length ? data.risk.walletFlags.join(", ") : "No active ops flags"}</strong>
                  </article>
                  <article className="wallet-console-block">
                    <span>Linked Support Cases</span>
                    <strong>{data.risk?.linkedSupportCaseReferences?.length ? data.risk.linkedSupportCaseReferences.join(", ") : "No linked support cases"}</strong>
                  </article>
                  <article className="wallet-console-block">
                    <span>Review Note</span>
                    <strong>{data.wallet.underReviewNote || data.wallet.suspendedNote || "-"}</strong>
                  </article>
                </div>
              </Panel>
            </div>

            <Panel title="Balance Block" subtitle="Current wallet balance state derived from the cached wallet read model and active holds.">
              <MetricGrid items={balanceMetrics} />
            </Panel>

            <Panel title="Loyalty Block" subtitle="Lightweight loyalty profile for support and ops actions.">
              <MetricGrid items={loyaltyMetrics} />
            </Panel>

            <div id="wallet-transactions-panel">
              <PreviewTablePanel
                title="Recent Transactions"
                subtitle="Latest ledger-visible wallet transactions and linked references."
                previewLimit={8}
                compact
                minWidth={920}
                modalTitle="Wallet Transaction History"
                rows={transactionRows}
                emptyLabel="No wallet transactions were found."
                columns={[
                  { key: "displayDate", label: "Datetime" },
                  { key: "reference", label: "Ref" },
                  { key: "type", label: "Type" },
                  { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
                  { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
                  { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
                  { key: "sourceChannel", label: "Source" },
                  { key: "linkedReference", label: "Linked Ref" },
                ]}
              />
            </div>

            <div className="wallet-console-grid wallet-console-grid--lower">
              {canViewPoints ? (
                <div id="wallet-points-panel">
                  <PreviewTablePanel
                    title="Points History"
                    subtitle="Recent operator points actions and loyalty balance changes."
                    previewLimit={6}
                    compact
                    minWidth={760}
                    modalTitle="Wallet Points History"
                    rows={pointRows}
                    emptyLabel="No points history has been recorded."
                    columns={[
                      { key: "displayDate", label: "Datetime" },
                      { key: "displayDelta", label: "Delta" },
                      { key: "direction", label: "Direction", render: (row) => <StatusPill value={row.direction} /> },
                      { key: "reasonCode", label: "Reason" },
                      { key: "createdByName", label: "Actor" },
                    ]}
                  />
                </div>
              ) : null}

              <PreviewTablePanel
                title="Manual Holds"
                subtitle="Reservation and manual hold visibility for available balance review."
                previewLimit={6}
                compact
                minWidth={760}
                modalTitle="Wallet Holds"
                rows={holdRows}
                emptyLabel="No active wallet holds."
                columns={[
                  { key: "reference", label: "Reference" },
                  { key: "holdType", label: "Type" },
                  { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
                  { key: "amount", label: "Amount", render: (row) => formatMoney(row.amount) },
                  { key: "displayCreatedAt", label: "Created" },
                  {
                    key: "actions",
                    label: "Actions",
                    render: (row) => (
                      canReleaseHold && row.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => openMutation({
                            kind: "holdRelease",
                            holdId: row.id,
                            title: `Release Hold ${row.reference}`,
                            subtitle: "Release the selected manual hold and restore available balance.",
                            submitLabel: "Release Hold",
                            requestKeyPrefix: "wallet-release-hold",
                            fields: [
                              { name: "reasonCode", label: "Reason code", placeholder: "HOLD_RELEASE_APPROVED" },
                              { name: "note", label: "Note", type: "textarea", rows: 4, fullWidth: true, placeholder: "Explain why the hold is being released." },
                            ],
                          })}
                        >
                          Release Hold
                        </button>
                      ) : "-"
                    ),
                  },
                ]}
              />
            </div>

            <PreviewTablePanel
              title="Wallet Operation Requests"
              subtitle="Approval-driven refund, credit, transfer, and ledger adjustment requests."
              previewLimit={6}
              compact
              minWidth={980}
              modalTitle="Wallet Operation Requests"
              rows={requestRows}
              emptyLabel="No wallet operation requests recorded."
              columns={[
                { key: "publicId", label: "Request ID" },
                { key: "operationType", label: "Operation", render: (row) => formatEnumLabel(row.operationType) },
                { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
                { key: "amountMwk", label: "Amount", render: (row) => row.amountMwk === null ? "-" : formatMoney(row.amountMwk) },
                { key: "requestedByName", label: "Requested By" },
                { key: "createdLabel", label: "Created" },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => row.canApprove ? (
                    <div className="inline-action-group inline-action-group--row">
                      <button type="button" className="secondary-action" onClick={() => setDecisionModal({ request: row, decision: "APPROVE" })}>
                        Approve
                      </button>
                      <button type="button" className="secondary-action" onClick={() => setDecisionModal({ request: row, decision: "REJECT" })}>
                        Reject
                      </button>
                    </div>
                  ) : "-"
                },
              ]}
            />

            {canViewAudit ? (
              <PreviewTablePanel
                title="Wallet Audit Trail"
                subtitle="Immutable wallet-level audit records for operational and financial changes."
                previewLimit={6}
                compact
                minWidth={980}
                modalTitle="Wallet Audit Trail"
                rows={auditRows}
                emptyLabel="No wallet audit records found."
                columns={[
                  { key: "displayDate", label: "Datetime" },
                  { key: "actionType", label: "Action" },
                  { key: "actorName", label: "Actor" },
                  { key: "reasonCode", label: "Reason" },
                  { key: "amountDeltaMwk", label: "MWK Delta", render: (row) => row.amountDeltaMwk === null ? "-" : formatMoney(row.amountDeltaMwk) },
                  { key: "pointsDelta", label: "Points Delta", render: (row) => row.pointsDelta === null ? "-" : formatNumber(row.pointsDelta) },
                  { key: "actionSummary", label: "Summary" },
                ]}
              />
            ) : null}
          </>
        ) : null}
      </div>

      {actionModal ? (
        <WalletMutationModal
          config={actionModal}
          onClose={() => setActionModal(null)}
          onSubmit={submitMutation}
        />
      ) : null}

      {decisionModal ? (
        <WalletRequestDecisionModal
          request={decisionModal.request}
          decision={decisionModal.decision}
          onClose={() => setDecisionModal(null)}
          onSubmit={submitDecision}
        />
      ) : null}
    </InternalShell>
  )
}

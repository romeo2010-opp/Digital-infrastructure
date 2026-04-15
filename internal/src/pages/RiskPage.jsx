import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { Panel } from "../components/PanelTable"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatNumber, formatRelative } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

function formatEnumLabel(value, fallback = "-") {
  if (!value) return fallback
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
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

function AlertDetailModal({ alert, onClose }) {
  if (!alert) return null

  return (
    <ModalFrame
      title={alert.title}
      subtitle="Risk alert detail for fraud and anomaly review."
      onClose={onClose}
      badges={<StatusPill value={alert.severity} />}
    >
      <div className="stack-grid">
        <div className="admin-detail-block">
          <span>Summary</span>
          <strong>{alert.summary}</strong>
        </div>
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Status</span><strong><StatusPill value={alert.status} /></strong></div>
          <div><span>Created</span><strong>{formatDateTime(alert.createdAt)}</strong></div>
          <div><span>Alert ID</span><strong>{alert.publicId}</strong></div>
        </div>
      </div>
    </ModalFrame>
  )
}

function CreateComplianceCaseModal({ riskOfficers, onClose, onCreate }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    category: "FRAUD_ALERT",
    severity: "MEDIUM",
    summary: "",
    stationPublicId: "",
    userPublicId: "",
    assigneeUserPublicId: riskOfficers[0]?.publicId || "",
    note: "",
  })

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await onCreate(form)
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to create compliance case")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame title="Create Compliance Case" subtitle="Open a fraud, station, or account compliance case." onClose={onClose}>
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Category</span>
              <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} disabled={working}>
                <option value="FRAUD_ALERT">Fraud alert</option>
                <option value="SUSPICIOUS_TRANSACTION">Suspicious transaction</option>
                <option value="SUSPICIOUS_STATION">Suspicious station</option>
                <option value="ACCOUNT_ACCESS">Account access issue</option>
                <option value="COMPLIANCE_REVIEW">Compliance review</option>
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
            <label className="settings-form-field">
              <span>Station public ID</span>
              <input value={form.stationPublicId} onChange={(event) => setForm((prev) => ({ ...prev, stationPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>User public ID</span>
              <input value={form.userPublicId} onChange={(event) => setForm((prev) => ({ ...prev, userPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field settings-form-field--full">
              <span>Assign officer</span>
              <select value={form.assigneeUserPublicId} onChange={(event) => setForm((prev) => ({ ...prev, assigneeUserPublicId: event.target.value }))} disabled={working}>
                <option value="">Unassigned</option>
                {riskOfficers.map((officer) => (
                  <option key={officer.publicId} value={officer.publicId}>{officer.fullName}</option>
                ))}
              </select>
            </label>
            <label className="settings-form-field settings-form-field--full">
              <span>Summary</span>
              <input value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} disabled={working} />
            </label>
          </div>
          <label className="settings-form-field">
            <span>Case note</span>
            <textarea rows={5} value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} disabled={working} />
          </label>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" onClick={submit} disabled={working}>Create Compliance Case</button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function ComplianceCaseDetailModal({
  item,
  primaryRole,
  riskOfficers,
  canFreeze,
  canUnfreeze,
  canOverride,
  onTransactionAction,
  onWorkflow,
  onFreezeCase,
  onFreezeAccount,
  onFreezeStation,
  onUnfreezeCase,
  onUnfreezeAccount,
  onUnfreezeStation,
  onApproveOverride,
  onClose,
}) {
  const [note, setNote] = useState("")
  const [assigneeUserPublicId, setAssigneeUserPublicId] = useState(item.assignedUserPublicId || "")
  const [reasonCode, setReasonCode] = useState("CONFIRMED_FRAUD")
  const [overrideStatus, setOverrideStatus] = useState("RESOLVED")
  const [confirmationText, setConfirmationText] = useState("")
  const normalizedPrimaryRole = String(primaryRole || "").toUpperCase()
  const isRiskOfficer = normalizedPrimaryRole === "RISK_COMPLIANCE_OFFICER"
  const isPlatformOwner = normalizedPrimaryRole === "PLATFORM_OWNER"

  if (!item) return null

  return (
    <ModalFrame
      title={`Compliance Case ${item.publicId}`}
      subtitle="Review fraud and compliance details, then take enforcement or workflow action."
      onClose={onClose}
      badges={
        <>
          <StatusPill value={item.severity} />
          <StatusPill value={item.status} />
        </>
      }
    >
      <div className="stack-grid">
        <div className="settings-summary-list admin-detail-grid">
          <div><span>Category</span><strong>{item.category}</strong></div>
          <div><span>Assigned officer</span><strong>{item.assignedOfficer || "Unassigned"}</strong></div>
          <div><span>Station</span><strong>{item.stationName || "Not linked"}</strong></div>
          <div><span>Station ID</span><strong>{item.stationPublicId || "Not linked"}</strong></div>
          <div><span>User</span><strong>{item.userName || "Not linked"}</strong></div>
          <div><span>User ID</span><strong>{item.userPublicId || "Not linked"}</strong></div>
          <div><span>Transaction</span><strong>{item.transactionPublicId || "Not linked"}</strong></div>
          <div><span>Transaction status</span><strong>{item.transactionStatus ? <StatusPill value={item.transactionStatus} /> : "Not linked"}</strong></div>
          <div><span>Settlement impact</span><strong>{item.transactionSettlementImpactStatus ? <StatusPill value={item.transactionSettlementImpactStatus} /> : "Not linked"}</strong></div>
          <div><span>Workflow reason</span><strong>{formatEnumLabel(item.transactionWorkflowReasonCode)}</strong></div>
          <div><span>Created</span><strong>{formatDateTime(item.createdAt)}</strong></div>
        </div>

        <div className="admin-detail-block">
          <span>Summary</span>
          <strong>{item.summary}</strong>
        </div>

        <div className="admin-detail-block">
          <span>Case notes / actions</span>
          <strong>{item.actionTaken || "No case notes recorded."}</strong>
        </div>

        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Assign officer</span>
              <select value={assigneeUserPublicId} onChange={(event) => setAssigneeUserPublicId(event.target.value)}>
                <option value="">Unassigned</option>
                {riskOfficers.map((officer) => (
                  <option key={officer.publicId} value={officer.publicId}>{officer.fullName}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="settings-form-field">
            <span>Workflow note</span>
            <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="inline-action-group inline-action-group--row">
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "ASSIGN_CASE", assigneeUserPublicId, note })}>Assign</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "ADD_CASE_NOTE", note })}>Add Note</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "ESCALATE_CASE", note })}>Escalate</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "RESOLVE_CASE", note })}>Resolve</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "REOPEN_CASE", note })}>Reopen</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "MARK_CONFIRMED", note })}>Mark Confirmed</button>
            <button type="button" className="secondary-action" onClick={() => onWorkflow(item.publicId, { action: "MARK_FALSE_POSITIVE", note })}>False Positive</button>
          </div>
        </div>

        {item.transactionPublicId ? (
          <div className="settings-form-card">
            <div className="settings-profile-grid">
              <label className="settings-form-field">
                <span>Transaction reason</span>
                <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                  <option value="CONFIRMED_FRAUD">Confirmed fraud</option>
                  <option value="PUMP_MANIPULATION">Pump manipulation</option>
                  <option value="FAKE_TRANSACTION_RECORD">Fake transaction record</option>
                  <option value="DUPLICATE_SYSTEM_TRANSACTION">Duplicate system transaction</option>
                  <option value="STATION_ABUSE_SMARTLINK">Station abuse of SmartLink system</option>
                  <option value="SYSTEM_MALFUNCTION">System malfunction</option>
                  <option value="CRITICAL_FINANCIAL_INCIDENT">Critical financial incident</option>
                  <option value="COMPLIANCE_ESCALATION">Compliance escalation</option>
                  <option value="REGULATOR_REQUEST">Regulator request</option>
                </select>
              </label>
              {isPlatformOwner ? (
                <label className="settings-form-field">
                  <span>Override case status</span>
                  <select value={overrideStatus} onChange={(event) => setOverrideStatus(event.target.value)}>
                    <option value="OPEN">Open</option>
                    <option value="INVESTIGATING">Investigating</option>
                    <option value="FROZEN">Frozen</option>
                    <option value="FRAUD_CONFIRMED">Fraud Confirmed</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                </label>
              ) : null}
              {isPlatformOwner ? (
                <label className="settings-form-field settings-form-field--full">
                  <span>Strong confirmation</span>
                  <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={`Type ${item.transactionPublicId}`} />
                </label>
              ) : null}
            </div>
            <label className="settings-form-field">
              <span>Transaction action note</span>
              <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div className="inline-action-group inline-action-group--row">
              <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "OPEN_COMPLIANCE_CASE", note, reasonCode })}>
                Open Compliance Case
              </button>
              <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "ATTACH_COMPLIANCE_NOTES", note, reasonCode })}>
                Attach Compliance Notes
              </button>
              <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "FREEZE_RELATED_TRANSACTIONS", note, reasonCode })}>
                Freeze Related Transactions
              </button>
              <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "MARK_TRANSACTION_FRAUDULENT", note, reasonCode })}>
                Mark Transaction Fraudulent
              </button>
              {isRiskOfficer ? (
                <>
                  <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "CANCEL_TRANSACTION", note, reasonCode })}>
                    Cancel Transaction
                  </button>
                  <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "REVERSE_TRANSACTION", note, reasonCode })}>
                    Reverse Transaction
                  </button>
                </>
              ) : null}
              {isPlatformOwner ? (
                <>
                  <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "FORCE_CANCEL_TRANSACTION", note, reasonCode, confirmationText })}>
                    Force Cancel Transaction
                  </button>
                  <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "REVERSE_SETTLEMENT", note, reasonCode, confirmationText })}>
                    Reverse Settlement
                  </button>
                  <button type="button" className="secondary-action" onClick={() => onTransactionAction(item.transactionPublicId, { action: "OVERRIDE_CASE_STATUS", note, confirmationText, overrideStatus })}>
                    Override Case Status
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="inline-action-group inline-action-group--row">
          {canFreeze && item.status !== "FROZEN" ? (
            <button type="button" className="secondary-action" onClick={() => onFreezeCase(item.publicId)}>Freeze Case</button>
          ) : null}
          {canFreeze && item.userPublicId ? (
            <button type="button" className="secondary-action" onClick={() => onFreezeAccount(item.publicId)}>Freeze Account</button>
          ) : null}
          {canFreeze && item.stationPublicId ? (
            <button type="button" className="secondary-action" onClick={() => onFreezeStation(item.publicId)}>Freeze Station</button>
          ) : null}
          {canUnfreeze && item.status === "FROZEN" ? (
            <button type="button" className="secondary-action" onClick={() => onUnfreezeCase(item.publicId)}>Unfreeze Case</button>
          ) : null}
          {canUnfreeze && item.userPublicId ? (
            <button type="button" className="secondary-action" onClick={() => onUnfreezeAccount(item.publicId)}>Unfreeze Account</button>
          ) : null}
          {canUnfreeze && item.stationPublicId ? (
            <button type="button" className="secondary-action" onClick={() => onUnfreezeStation(item.publicId)}>Unfreeze Station</button>
          ) : null}
          {canOverride && ["HIGH", "CRITICAL"].includes(String(item.severity || "").toUpperCase()) && ["OPEN", "INVESTIGATING", "FROZEN"].includes(String(item.status || "").toUpperCase()) ? (
            <button type="button" className="secondary-action" onClick={() => onApproveOverride(item.publicId)}>Approve Override</button>
          ) : null}
        </div>
      </div>
    </ModalFrame>
  )
}

export default function RiskPage() {
  const { hasPermission, session } = useInternalAuth()
  const [data, setData] = useState({ items: [], alertFeed: [], frozenEntities: [], summary: {}, riskOfficers: [] })
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const primaryRole = session?.profile?.primaryRole || ""

  async function load() {
    setData(await internalApi.getRisk())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load compliance cases"))
  }, [])

  async function runAction(action) {
    try {
      setError("")
      await action()
      await load()
    } catch (err) {
      setError(err?.message || "Failed to update risk case")
    }
  }

  const rows = useMemo(() => {
    const items = data.items || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.publicId} ${row.category} ${row.summary} ${row.stationName || ""} ${row.userName || ""} ${row.assignedOfficer || ""} ${row.transactionPublicId || ""} ${row.transactionStatus || ""}`
        .toLowerCase()
        .includes(needle)
    )
  }, [data.items, query])

  const selectedCase = useMemo(() => rows.find((row) => row.publicId === selectedCaseId) || (data.items || []).find((row) => row.publicId === selectedCaseId) || null, [rows, data.items, selectedCaseId])
  const selectedAlert = useMemo(() => (data.alertFeed || []).find((row) => row.publicId === selectedAlertId) || null, [data.alertFeed, selectedAlertId])
  const riskCaseColumns = useMemo(
    () => [
      { key: "publicId", label: "Case ID" },
      { key: "category", label: "Category" },
      { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "summary", label: "Summary" },
      { key: "stationName", label: "Station" },
    ],
    []
  )
  const riskAlertColumns = useMemo(
    () => [
      { key: "title", label: "Alert" },
      { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
      { key: "summary", label: "Summary" },
      { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Suspicious Transactions",
        value: formatNumber(data.summary?.suspiciousTransactions),
        drilldown: {
          title: "Suspicious Transaction Cases",
          subtitle: "Open compliance cases linked to suspicious transaction activity.",
          rows: (data.items || []).filter((row) =>
            ["SUSPICIOUS_TRANSACTIONS", "SUSPICIOUS_TRANSACTION", "TRANSACTION_REVIEW"].includes(row.category)
            && row.status !== "RESOLVED"
          ),
          columns: riskCaseColumns,
          emptyLabel: "No suspicious transaction cases found.",
          minWidth: 860,
        },
      },
      {
        label: "Frozen Entities",
        value: formatNumber(data.summary?.frozenEntities),
        drilldown: {
          title: "Frozen Entities",
          subtitle: "Compliance cases that currently have a frozen status.",
          rows: data.frozenEntities || [],
          columns: riskCaseColumns,
          emptyLabel: "No frozen entities found.",
          minWidth: 860,
        },
      },
      {
        label: "Unresolved Cases",
        value: formatNumber(data.summary?.unresolvedCases),
        drilldown: {
          title: "Unresolved Compliance Cases",
          subtitle: "Every compliance case that is still open, investigating, or frozen.",
          rows: (data.items || []).filter((row) => row.status !== "RESOLVED"),
          columns: riskCaseColumns,
          emptyLabel: "No unresolved compliance cases found.",
          minWidth: 860,
        },
      },
      {
        label: "Anomaly Alerts",
        value: formatNumber(data.summary?.anomalyAlerts),
        drilldown: {
          title: "Anomaly Alert Feed",
          subtitle: "Open anomaly and fraud alerts flowing into risk review.",
          rows: data.alertFeed || [],
          columns: riskAlertColumns,
          emptyLabel: "No anomaly alerts found.",
          minWidth: 820,
        },
      },
    ],
    [data.alertFeed, data.frozenEntities, data.items, data.summary?.anomalyAlerts, data.summary?.frozenEntities, data.summary?.suspiciousTransactions, data.summary?.unresolvedCases, riskAlertColumns, riskCaseColumns]
  )

  return (
    <InternalShell title="Risk & Compliance" alerts={error ? [{ id: "risk-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar">
        <input className="page-search" placeholder="Search compliance cases, actors, stations, or users" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={() => setShowCreateModal(true)}>Create Compliance Case</button>
        </div>
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="Compliance Cases"
          previewLimit={8}
          modalTitle="All Compliance Cases"
          columns={[
            {
              key: "publicId",
              label: "Case ID",
              render: (row) => (
                <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.publicId)}>
                  {row.publicId}
                </button>
              ),
            },
            { key: "category", label: "Category" },
            { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            { key: "summary", label: "Summary" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.publicId)}>Open</button>
                  {hasPermission("risk:freeze") && row.status !== "FROZEN" ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.freezeComplianceCase(row.publicId))}>Freeze</button>
                  ) : null}
                  {hasPermission("risk:unfreeze") && row.status === "FROZEN" ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.unfreezeComplianceCase(row.publicId))}>Unfreeze</button>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={rows}
        />

        <div className="stack-grid">
          <Panel title="Fraud Alert Feed">
            <div className="timeline-list">
              {(data.alertFeed || []).map((row) => (
                <article key={row.publicId} className="timeline-item">
                  <div>
                    <strong>{row.title}</strong>
                    <p>{row.summary}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={row.severity} />
                    <time>{formatRelative(row.createdAt)}</time>
                    <button type="button" className="secondary-action" onClick={() => setSelectedAlertId(row.publicId)}>
                      Open
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <PreviewTablePanel
            title="Frozen Entities"
            previewLimit={5}
            compact
            minWidth={420}
            modalTitle="All Frozen Entities"
            columns={[
              { key: "publicId", label: "Case ID" },
              { key: "category", label: "Category" },
              { key: "summary", label: "Summary" },
              { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
            ]}
            rows={data.frozenEntities || []}
          />
        </div>
      </div>

      {showCreateModal ? (
        <CreateComplianceCaseModal
          riskOfficers={data.riskOfficers || []}
          onClose={() => setShowCreateModal(false)}
          onCreate={(payload) => runAction(() => internalApi.createComplianceCase(payload))}
        />
      ) : null}

      {selectedCase ? (
        <ComplianceCaseDetailModal
          item={selectedCase}
          primaryRole={primaryRole}
          riskOfficers={data.riskOfficers || []}
          canFreeze={hasPermission("risk:freeze")}
          canUnfreeze={hasPermission("risk:unfreeze")}
          canOverride={hasPermission("risk:override_approve")}
          onTransactionAction={(transactionPublicId, payload) => runAction(() => internalApi.handleRiskTransactionAction(transactionPublicId, payload))}
          onWorkflow={(casePublicId, payload) => runAction(() => internalApi.updateComplianceCaseWorkflow(casePublicId, payload))}
          onFreezeCase={(casePublicId) => runAction(() => internalApi.freezeComplianceCase(casePublicId))}
          onFreezeAccount={(casePublicId) => runAction(() => internalApi.freezeComplianceAccount(casePublicId))}
          onFreezeStation={(casePublicId) => runAction(() => internalApi.freezeComplianceStation(casePublicId))}
          onUnfreezeCase={(casePublicId) => runAction(() => internalApi.unfreezeComplianceCase(casePublicId))}
          onUnfreezeAccount={(casePublicId) => runAction(() => internalApi.unfreezeComplianceAccount(casePublicId))}
          onUnfreezeStation={(casePublicId) => runAction(() => internalApi.unfreezeComplianceStation(casePublicId))}
          onApproveOverride={(casePublicId) => runAction(() => internalApi.approveHighRiskOverride(casePublicId))}
          onClose={() => setSelectedCaseId(null)}
        />
      ) : null}

      {selectedAlert ? <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlertId(null)} /> : null}
    </InternalShell>
  )
}

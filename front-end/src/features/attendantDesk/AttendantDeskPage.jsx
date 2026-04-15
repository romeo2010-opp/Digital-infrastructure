import { useCallback, useEffect, useMemo, useState } from "react"
import Navbar from "../../components/Navbar"
import { attendantApi } from "../../api/attendantApi"
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher"
import { formatDateTime } from "../../utils/dateTime"
import { pushSystemAlert } from "../../utils/systemAlerts"
import "./attendantDesk.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const REJECTION_REASONS = [
  "customer_not_present",
  "reservation_expired",
  "wrong_fuel_selected",
  "pump_unavailable",
  "fuel_unavailable",
  "duplicate_order",
  "safety_issue",
  "system_mismatch_requires_review",
]

const ISSUE_REASONS = [
  "telemetry_missing",
  "telemetry_mismatch",
  "payment_captured_no_dispense",
  "partial_dispense",
  "customer_dispute",
  "manual_review_required",
  "safety_issue",
  "other_requires_review",
]

const REFUND_REASONS = [
  "customer_not_present",
  "reservation_expired",
  "wrong_fuel_selected",
  "pump_unavailable",
  "fuel_unavailable",
  "telemetry_missing_no_service_started",
  "telemetry_mismatch",
  "duplicate_order",
  "payment_captured_no_dispense",
  "partial_dispense",
  "safety_issue",
  "other_requires_review",
]

function humanize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function timerLabel(value) {
  const endsAt = Date.parse(String(value || ""))
  if (!Number.isFinite(endsAt)) return "-"
  const diffMs = endsAt - Date.now()
  const sign = diffMs >= 0 ? "" : "-"
  const totalMinutes = Math.floor(Math.abs(diffMs) / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${sign}${hours ? `${hours}h ` : ""}${minutes}m`
}

function elapsedLabel(value) {
  const startedAt = Date.parse(String(value || ""))
  if (!Number.isFinite(startedAt)) return "-"
  const diffMs = Date.now() - startedAt
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours ? `${hours}h ` : ""}${minutes}m`
}

function canDo(order, action) {
  return Array.isArray(order?.availableActions) && order.availableActions.includes(action)
}

function isUrgentTimer(value, thresholdMinutes = 10) {
  const endsAt = Date.parse(String(value || ""))
  if (!Number.isFinite(endsAt)) return false
  return endsAt - Date.now() <= thresholdMinutes * 60000
}

function orderStateTone(value) {
  if (value === "dispensing") return "warning"
  if (["exception_review", "refund_requested", "rejected"].includes(value)) return "danger"
  if (["accepted", "customer_arrived", "pump_assigned", "completed"].includes(value)) return "success"
  return "info"
}

function deriveNextStep(order) {
  if (canDo(order, "accept")) return "Accept and claim the order"
  if (canDo(order, "mark_customer_arrived")) return "Confirm customer arrival at station"
  if (canDo(order, "assign_pump")) {
    return order.selectedPump?.pumpPublicId
      ? "Pump can still be changed before fueling starts"
      : "Assign a matching pump and nozzle"
  }
  if (canDo(order, "start_service")) return "Authorize pump when ready to begin fueling"
  if (canDo(order, "complete_service")) return "Capture final litres and complete service"
  if (order.state === "refund_requested") return "Refund request is waiting on review"
  if (order.state === "exception_review") return "Issue needs evidence or downstream review"
  return "Monitor and use audit if anything changes"
}

function StatusPill({ value, tone = "neutral" }) {
  return <span className={`ad-pill ad-pill-${tone}`}>{humanize(value) || "-"}</span>
}

function SummaryCard({ label, value, helper, accent = "blue", detail = "" }) {
  return (
    <article className={`ad-summary-card ad-summary-card-${accent}`}>
      <div className="ad-summary-card-top">
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </div>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  )
}

function PulseStat({ label, value, tone = "neutral" }) {
  return (
    <div className={`ad-pulse-stat ad-pulse-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DeskPulse({
  snapshot,
  liveOrders,
  filteredOrders,
  activePumpSessions,
  urgentOrders,
  telemetryAttentionCount,
  openRefunds,
  onRefresh,
  loading,
}) {
  const serviceReadyCount = liveOrders.filter((order) =>
    ["accepted", "customer_arrived", "pump_assigned"].includes(order.state)
  ).length

  return (
    <section className="ad-pulse">
      <div className="ad-pulse-hero">
        <div className="ad-pulse-copy">
          <small>Attendant Manager</small>
          <h2>{snapshot?.station?.name || "Station"} Operations Desk</h2>
          <p>Fast queue execution, pump awareness, and exception handling for the current station shift.</p>
        </div>
        <div className="ad-pulse-meta">
          <div className="ad-pulse-meta-card">
            <span>Desk refreshed</span>
            <strong>{formatDateTime(snapshot?.generatedAt || snapshot?.lastUpdatedAt)}</strong>
          </div>
          <button type="button" onClick={() => onRefresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Desk"}
          </button>
        </div>
      </div>

      <div className="ad-pulse-stats">
        <PulseStat label="Visible Orders" value={filteredOrders.length} tone="blue" />
        <PulseStat label="Service Ready" value={serviceReadyCount} tone="green" />
        <PulseStat label="Urgent Timers" value={urgentOrders.length} tone={urgentOrders.length ? "amber" : "neutral"} />
        <PulseStat label="Pump Activity" value={activePumpSessions.length} tone="blue" />
        <PulseStat label="Telemetry Attention" value={telemetryAttentionCount} tone={telemetryAttentionCount ? "red" : "neutral"} />
        <PulseStat label="Open Refunds" value={openRefunds} tone={openRefunds ? "amber" : "neutral"} />
      </div>
    </section>
  )
}

function OrderCard({ order, pumps, actionBusyId, onAction, onOpenAudit }) {
  const availablePumps = (pumps || []).filter((pump) =>
    Array.isArray(pump?.fuelTypes) && pump.fuelTypes.includes(order.fuelType)
  )
  const hasAssignedPump = Boolean(order.selectedPump?.pumpPublicId)
  const urgent = isUrgentTimer(order.reservationTimer)

  return (
    <article className="ad-order-card">
      <header className="ad-order-card-header">
        <div className="ad-order-headline">
          <div className="ad-order-title">
            <small>{order.orderType}</small>
            <h3>{order.orderPublicId}</h3>
          </div>
          <p>{order.customerName}</p>
        </div>
        <div className="ad-order-header-side">
          <StatusPill value={order.state} tone={orderStateTone(order.state)} />
          {urgent ? <StatusPill value="Urgent Timer" tone="warning" /> : null}
        </div>
      </header>

      <div className="ad-order-metrics">
        <div>
          <span>Fuel</span>
          <strong>{order.fuelType || "-"}</strong>
        </div>
        <div>
          <span>Litres</span>
          <strong>{order.requestedLitres ?? "-"}</strong>
        </div>
        <div>
          <span>Payment</span>
          <strong>{humanize(order.paymentStatus)}</strong>
        </div>
        <div>
          <span>Timer</span>
          <strong>{timerLabel(order.reservationTimer)}</strong>
        </div>
      </div>

      <div className="ad-order-tags">
        <StatusPill value={order.queueStatus} />
        <StatusPill value={order.telemetryStatus} tone={order.telemetryStatus === "online" ? "success" : order.telemetryStatus === "delayed" ? "warning" : "danger"} />
        {order.selectedPump?.pumpPublicId ? (
          <StatusPill value={`Pump ${order.selectedPump.pumpNumber || "-"} / N${order.selectedPump.nozzleNumber || "-"}`} tone="info" />
        ) : null}
        {order.attendantAssignment?.name ? (
          <StatusPill value={`Assigned ${order.attendantAssignment.name}`} tone="success" />
        ) : null}
      </div>

      <div className="ad-order-priority">
        <div>
          <span>Next Step</span>
          <strong>{deriveNextStep(order)}</strong>
        </div>
        <div>
          <span>Reservation Clock</span>
          <strong className={urgent ? "ad-text-warning" : ""}>{timerLabel(order.reservationTimer)}</strong>
        </div>
      </div>

      <div className="ad-order-assignment">
        <span>Assigned Pump</span>
        <strong>
          {hasAssignedPump
            ? `Pump ${order.selectedPump.pumpNumber || "-"} · Nozzle ${order.selectedPump.nozzleNumber || "-"}`
            : "Not assigned yet"}
        </strong>
        <small>
          {hasAssignedPump
            ? "Attendant can still change this pump or nozzle before service completion."
            : "Assign the best available pump and matching nozzle for this fuel type."}
        </small>
      </div>

      <div className="ad-order-actions">
        <button type="button" disabled={!canDo(order, "accept") || actionBusyId === `${order.orderType}:${order.orderPublicId}:accept`} onClick={() => onAction("accept", order)}>
          Accept
        </button>
        <button type="button" disabled={!canDo(order, "reject")} onClick={() => onAction("reject", order)}>
          Reject
        </button>
        <button type="button" disabled={!canDo(order, "mark_customer_arrived") || actionBusyId === `${order.orderType}:${order.orderPublicId}:arrived`} onClick={() => onAction("arrived", order)}>
          Arrived
        </button>
        <button type="button" disabled={!canDo(order, "assign_pump") || !availablePumps.length} onClick={() => onAction("assign", order)}>
          {hasAssignedPump ? "Change Pump" : "Assign Pump"}
        </button>
        <button type="button" disabled={!canDo(order, "start_service")} onClick={() => onAction("start", order)}>
          Authorize Pump
        </button>
        <button type="button" disabled={!canDo(order, "complete_service")} onClick={() => onAction("complete", order)}>
          Complete
        </button>
        <button type="button" onClick={() => onAction("issue", order)}>
          Raise Issue
        </button>
        <button type="button" onClick={() => onAction("refund", order)}>
          Refund Request
        </button>
        <button type="button" className="secondary" onClick={() => onOpenAudit(order)}>
          Audit
        </button>
      </div>
    </article>
  )
}

function ModalForm({ modal, pumps, onClose, onSubmit, submitting }) {
  const initialForm = useMemo(() => ({
    reasonCode: "",
    note: "",
    pumpPublicId: "",
    nozzlePublicId: "",
    manualMode: false,
    manualReason: "",
    litres: "",
    amount: "",
    paymentMethod: "OTHER",
    evidenceUrl: "",
    amountMwk: "",
    manualLitres: "",
  }), [])
  const [form, setForm] = useState(() => ({
    ...initialForm,
    pumpPublicId: modal?.order?.selectedPump?.pumpPublicId || "",
    nozzlePublicId: modal?.order?.selectedPump?.nozzlePublicId || "",
  }))

  if (!modal?.order) return null

  const pumpOptions = (pumps || []).filter((pump) =>
    Array.isArray(pump?.fuelTypes) && pump.fuelTypes.includes(modal.order.fuelType)
  )
  const selectedPump = pumpOptions.find((pump) => pump.pumpPublicId === form.pumpPublicId)

  async function handleSubmit(event) {
    event.preventDefault()
    const payload = {
      ...form,
      litres: form.litres ? Number(form.litres) : undefined,
      amount: form.amount ? Number(form.amount) : undefined,
      amountMwk: form.amountMwk ? Number(form.amountMwk) : undefined,
      manualLitres: form.manualLitres ? Number(form.manualLitres) : undefined,
    }
    await onSubmit(payload)
  }

  const reasonOptions =
    modal.type === "reject"
      ? REJECTION_REASONS
      : modal.type === "issue"
        ? ISSUE_REASONS
        : REFUND_REASONS

  return (
    <div className="ad-modal-backdrop" role="presentation">
      <div className="ad-modal">
        <header>
          <div>
            <small>{modal.order.orderType}</small>
            <h3>{modal.title}</h3>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </header>

        <form onSubmit={handleSubmit} className="ad-modal-form">
          {(modal.type === "reject" || modal.type === "issue" || modal.type === "refund") ? (
            <label>
              Reason Code
              <select value={form.reasonCode} onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value }))} required>
                <option value="">Select reason</option>
                {reasonOptions.map((item) => (
                  <option key={item} value={item}>{humanize(item)}</option>
                ))}
              </select>
            </label>
          ) : null}

          {modal.type === "assign" ? (
            <>
              <label>
                Pump
                <select value={form.pumpPublicId} onChange={(event) => setForm((current) => ({ ...current, pumpPublicId: event.target.value, nozzlePublicId: "" }))} required>
                  <option value="">Select pump</option>
                  {pumpOptions.map((pump) => (
                    <option key={pump.pumpPublicId} value={pump.pumpPublicId}>
                      Pump {pump.pumpNumber} · {pump.fuelTypes.join(", ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Preferred Nozzle
                <select value={form.nozzlePublicId} onChange={(event) => setForm((current) => ({ ...current, nozzlePublicId: event.target.value }))}>
                  <option value="">Auto-pick free nozzle</option>
                  {(selectedPump?.nozzles || [])
                    .filter((item) => item.fuelType === modal.order.fuelType)
                    .map((item) => (
                      <option key={item.nozzlePublicId} value={item.nozzlePublicId}>
                        Nozzle {item.nozzleNumber} · {humanize(item.status)}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : null}

          {modal.type === "start" ? (
            <>
              <label className="ad-checkbox">
                <input type="checkbox" checked={form.manualMode} onChange={(event) => setForm((current) => ({ ...current, manualMode: event.target.checked }))} />
                Start in manual/unverified mode
              </label>
              {form.manualMode ? (
                <label>
                  Manual Reason
                  <textarea value={form.manualReason} onChange={(event) => setForm((current) => ({ ...current, manualReason: event.target.value }))} required />
                </label>
              ) : null}
            </>
          ) : null}

          {modal.type === "complete" ? (
            <>
              <label>
                Litres
                <input type="number" min="0" step="0.01" value={form.litres} onChange={(event) => setForm((current) => ({ ...current, litres: event.target.value }))} />
              </label>
              <label>
                Amount (MWK)
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
              </label>
              <label>
                Payment Method
                <select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}>
                  <option value="OTHER">Other</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="MOBILE_MONEY">Mobile Money</option>
                </select>
              </label>
            </>
          ) : null}

          {(modal.type === "reject" || modal.type === "issue" || modal.type === "refund" || modal.type === "complete") ? (
            <label>
              Note
              <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} required={modal.type === "issue" || modal.type === "refund"} />
            </label>
          ) : null}

          {modal.type === "issue" || modal.type === "refund" ? (
            <label>
              Evidence URL / Upload Hook
              <input type="text" value={form.evidenceUrl} onChange={(event) => setForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="Paste uploaded file URL or evidence reference" />
            </label>
          ) : null}

          {modal.type === "refund" ? (
            <>
              <label>
                Refund Amount (MWK)
                <input type="number" min="0" step="0.01" value={form.amountMwk} onChange={(event) => setForm((current) => ({ ...current, amountMwk: event.target.value }))} />
              </label>
              <label>
                Manual Litres
                <input type="number" min="0" step="0.01" value={form.manualLitres} onChange={(event) => setForm((current) => ({ ...current, manualLitres: event.target.value }))} />
              </label>
            </>
          ) : null}

          <footer>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : modal.submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function AuditPanel({ audit, loading, onClose }) {
  if (!audit) return null

  return (
    <div className="ad-modal-backdrop" role="presentation">
      <div className="ad-modal ad-modal-audit">
        <header>
          <div>
            <small>{audit.order.orderType}</small>
            <h3>Audit Timeline</h3>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </header>

        {loading ? <p className="ad-empty">Loading audit trail...</p> : null}
        {!loading && !(audit.items || []).length ? <p className="ad-empty">No audit events recorded yet.</p> : null}

        {!loading ? (
          <div className="ad-audit-list">
            {(audit.items || []).map((item) => (
              <article key={item.id} className="ad-audit-item">
                <strong>{humanize(item.actionType)}</strong>
                <small>{formatDateTime(item.createdAt)}</small>
                <pre>{JSON.stringify(item.payload || {}, null, 2)}</pre>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function AttendantDeskPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionBusyId, setActionBusyId] = useState("")
  const [searchText, setSearchText] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [modal, setModal] = useState(null)
  const [audit, setAudit] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)

  const refreshDashboard = useCallback(async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      const next = await attendantApi.getDashboard()
      setSnapshot(next)
      setError("")
    } catch (loadError) {
      setError(loadError?.message || "Failed to load attendant dashboard.")
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshDashboard()
  }, [refreshDashboard])

  useStationChangeWatcher({
    onChange: async () => {
      await refreshDashboard({ showLoader: false })
    },
  })

  const liveOrders = useMemo(() => snapshot?.liveOrders ?? [], [snapshot?.liveOrders])
  const activePumpSessions = useMemo(() => snapshot?.activePumpSessions ?? [], [snapshot?.activePumpSessions])
  const exceptions = useMemo(() => snapshot?.exceptions ?? [], [snapshot?.exceptions])
  const refundRequests = useMemo(() => snapshot?.refundRequests ?? [], [snapshot?.refundRequests])
  const filteredOrders = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return liveOrders.filter((order) => {
      const matchesStatus = statusFilter === "all" || order.state === statusFilter
      const matchesQuery =
        !q
        || order.orderPublicId.toLowerCase().includes(q)
        || String(order.customerName || "").toLowerCase().includes(q)
        || String(order.fuelType || "").toLowerCase().includes(q)
      return matchesStatus && matchesQuery
    })
  }, [liveOrders, searchText, statusFilter])
  const urgentOrders = useMemo(
    () => liveOrders.filter((order) => isUrgentTimer(order.reservationTimer)),
    [liveOrders]
  )
  const telemetryAttentionCount = useMemo(
    () =>
      liveOrders.filter((order) => ["offline", "delayed", "unverified_manual_mode"].includes(String(order.telemetryStatus || "").toLowerCase())).length
      + activePumpSessions.filter((session) => ["offline", "delayed", "unverified_manual_mode"].includes(String(session.telemetryStatus || "").toLowerCase())).length,
    [liveOrders, activePumpSessions]
  )
  const assignedOrders = useMemo(
    () => liveOrders.filter((order) => Boolean(order.selectedPump?.pumpPublicId)).length,
    [liveOrders]
  )
  const openRefunds = useMemo(
    () => refundRequests.filter((item) => ["PENDING_SUPPORT_REVIEW", "PENDING_FINANCE_APPROVAL"].includes(String(item.status || "").toUpperCase())).length,
    [refundRequests]
  )

  async function runSimpleAction(actionName, order, handler) {
    const busyId = `${order.orderType}:${order.orderPublicId}:${actionName}`
    try {
      setActionBusyId(busyId)
      const next = await handler()
      setSnapshot(next)
      setError("")
      pushSystemAlert({
        type: "INFO",
        title: "Operation Updated",
        body: `${humanize(actionName)} recorded for ${order.orderPublicId}.`,
      })
    } catch (actionError) {
      setError(actionError?.message || "Unable to complete action.")
    } finally {
      setActionBusyId("")
    }
  }

  function onAction(type, order) {
    if (type === "accept") {
      runSimpleAction("accept", order, () => attendantApi.acceptOrder(order.orderType, order.orderPublicId))
      return
    }
    if (type === "arrived") {
      runSimpleAction("customer arrived", order, () =>
        attendantApi.markCustomerArrived(order.orderType, order.orderPublicId, {})
      )
      return
    }

    const configByType = {
      reject: { title: "Reject Order", submitLabel: "Reject Order" },
      assign: { title: "Assign Pump", submitLabel: "Confirm Pump" },
      start: { title: "Authorize Pump", submitLabel: "Authorize Pump" },
      complete: { title: "Complete Service", submitLabel: "Complete Service" },
      issue: { title: "Raise Exception", submitLabel: "Create Exception" },
      refund: { title: "Create Refund Request", submitLabel: "Submit Refund Request" },
    }
    setModal({
      type,
      order,
      ...configByType[type],
    })
  }

  async function submitModal(payload) {
    if (!modal?.order) return
    const order = modal.order
    const busyId = `${order.orderType}:${order.orderPublicId}:${modal.type}`

    try {
      setActionBusyId(busyId)
      let next
      if (modal.type === "reject") {
        next = await attendantApi.rejectOrder(order.orderType, order.orderPublicId, {
          reasonCode: payload.reasonCode,
          note: payload.note,
        })
      } else if (modal.type === "assign") {
        next = await attendantApi.assignPump(order.orderType, order.orderPublicId, {
          pumpPublicId: payload.pumpPublicId,
          nozzlePublicId: payload.nozzlePublicId || undefined,
          note: payload.note,
        })
      } else if (modal.type === "start") {
        next = await attendantApi.startService(order.orderType, order.orderPublicId, {
          manualMode: payload.manualMode,
          manualReason: payload.manualReason,
        })
      } else if (modal.type === "complete") {
        next = await attendantApi.completeService(order.orderType, order.orderPublicId, {
          litres: payload.litres,
          amount: payload.amount,
          paymentMethod: payload.paymentMethod,
          note: payload.note,
        })
      } else if (modal.type === "issue") {
        next = await attendantApi.raiseIssue(order.orderType, order.orderPublicId, {
          reasonCode: payload.reasonCode,
          note: payload.note,
          evidenceUrl: payload.evidenceUrl,
        })
      } else if (modal.type === "refund") {
        next = await attendantApi.createRefundRequest(order.orderType, order.orderPublicId, {
          reasonCode: payload.reasonCode,
          note: payload.note,
          evidenceUrl: payload.evidenceUrl,
          amountMwk: payload.amountMwk,
          manualLitres: payload.manualLitres,
        })
      }

      setSnapshot(next)
      setModal(null)
      setError("")
      pushSystemAlert({
        type: "INFO",
        title: "Attendant Action Saved",
        body: `${modal.title} completed for ${order.orderPublicId}.`,
      })
    } catch (actionError) {
      setError(actionError?.message || "Unable to complete action.")
    } finally {
      setActionBusyId("")
    }
  }

  async function openAudit(order) {
    try {
      setAudit({ order, items: [] })
      setAuditLoading(true)
      const result = await attendantApi.getOrderAudit(order.orderType, order.orderPublicId)
      setAudit({ order, items: result.items || [] })
    } catch (auditError) {
      setError(auditError?.message || "Unable to load audit trail.")
    } finally {
      setAuditLoading(false)
    }
  }

  if (loading && !snapshot) {
    return (
      <div className="ad-page">
        <Navbar pagetitle="Attendant Manager" image={avatar} count={0} />
        <section className="ad-shell">
          <p className="ad-empty">Loading attendant operations...</p>
        </section>
      </div>
    )
  }

  return (
    <div className="ad-page">
      <Navbar pagetitle="Attendant Manager" image={avatar} count={snapshot?.summary?.liveOrders || 0} />

      <section className="ad-shell">
        <DeskPulse
          snapshot={snapshot}
          liveOrders={liveOrders}
          filteredOrders={filteredOrders}
          activePumpSessions={activePumpSessions}
          urgentOrders={urgentOrders}
          telemetryAttentionCount={telemetryAttentionCount}
          openRefunds={openRefunds}
          onRefresh={refreshDashboard}
          loading={loading}
        />

        {error ? <p className="ad-error">{error}</p> : null}

        <div className="ad-summary-grid">
          <SummaryCard
            label="Live Orders"
            value={snapshot?.summary?.liveOrders || 0}
            helper="Orders currently visible on the operations board"
            detail={`${assignedOrders} already assigned`}
            accent="blue"
          />
          <SummaryCard
            label="Dispensing"
            value={snapshot?.summary?.dispensing || 0}
            helper="Orders actively in fueling or immediate service flow"
            detail={`${activePumpSessions.length} pump sessions active`}
            accent="green"
          />
          <SummaryCard
            label="Exceptions"
            value={snapshot?.summary?.exceptions || 0}
            helper="Cases needing evidence, notes, or supervisor review"
            detail={`${urgentOrders.length} timers running hot`}
            accent="amber"
          />
          <SummaryCard
            label="Refund Requests"
            value={snapshot?.summary?.refundRequests || 0}
            helper="Requests already passed into downstream review"
            detail={`${refundRequests.filter((item) => item.requestedByCurrentAttendant).length} created by you`}
            accent="red"
          />
        </div>

        <div className="ad-toolbar">
          <input
            type="search"
            placeholder="Search order id, customer, fuel type"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All states</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="customer_arrived">Customer Arrived</option>
            <option value="pump_assigned">Pump Assigned</option>
            <option value="dispensing">Dispensing</option>
            <option value="exception_review">Exception Review</option>
            <option value="refund_requested">Refund Requested</option>
          </select>
        </div>

        <section className="ad-section">
          <div className="ad-section-header">
            <h3>Live Orders</h3>
            <small>{filteredOrders.length} visible</small>
          </div>
          <div className="ad-order-grid">
            {filteredOrders.length ? (
              filteredOrders.map((order) => (
                <OrderCard
                  key={`${order.orderType}:${order.orderPublicId}`}
                  order={order}
                  pumps={snapshot?.pumps || []}
                  actionBusyId={actionBusyId}
                  onAction={onAction}
                  onOpenAudit={openAudit}
                />
              ))
            ) : (
              <p className="ad-empty">No live orders matched the current filters.</p>
            )}
          </div>
        </section>

        <div className="ad-section-grid">
          <section className="ad-section">
            <div className="ad-section-header">
              <h3>Active Pump Sessions</h3>
              <small>{(snapshot?.activePumpSessions || []).length} active</small>
            </div>
            <div className="ad-list">
              {activePumpSessions.length ? (
                activePumpSessions.map((session) => (
                  <article key={session.id} className="ad-list-card">
                    <div>
                      <strong>Pump {session.pumpNumber || "-"}</strong>
                      <p>Nozzle {session.nozzleNumber || "-"} · {session.fuelType || "-"}</p>
                    </div>
                    <div className="ad-list-meta">
                      <StatusPill value={session.status} tone={session.status === "dispensing" ? "warning" : "info"} />
                      <StatusPill value={session.telemetryStatus} tone={session.telemetryStatus === "online" ? "success" : "warning"} />
                      <small>Live litres: {session.currentLiveLitres ?? "-"}</small>
                      <small>Elapsed: {elapsedLabel(session.elapsedTimeStartedAt)}</small>
                      {session.linkedOrder ? (
                        <small>{session.linkedOrder.orderType} · {session.linkedOrder.orderPublicId}</small>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="ad-empty">No reserved or dispensing pump sessions are active right now.</p>
              )}
            </div>
          </section>

          <section className="ad-section">
            <div className="ad-section-header">
              <h3>Exceptions / Issues</h3>
              <small>{(snapshot?.exceptions || []).length} open</small>
            </div>
            <div className="ad-list">
              {exceptions.length ? (
                exceptions.map((item) => (
                  <article key={item.id} className="ad-list-card">
                    <div>
                      <strong>{humanize(item.reasonCode)}</strong>
                      <p>{item.orderType} · {item.orderPublicId}</p>
                    </div>
                    <div className="ad-list-meta">
                      <StatusPill value={item.status} tone={item.status === "open" ? "danger" : "success"} />
                      <small>{item.customerName}</small>
                      <small>{formatDateTime(item.createdAt)}</small>
                      <small>{item.note}</small>
                      {item.supportTicketId ? <small>Support ticket: {item.supportTicketId}</small> : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="ad-empty">No exception cases have been raised for this station view.</p>
              )}
            </div>
          </section>
        </div>

        <section className="ad-section">
          <div className="ad-section-header">
            <h3>Refund Requests</h3>
            <small>{(snapshot?.refundRequests || []).length} tracked</small>
          </div>
            <div className="ad-list">
            {refundRequests.length ? (
              refundRequests.map((item) => (
                <article key={item.publicId} className="ad-list-card">
                  <div>
                    <strong>{item.publicId}</strong>
                    <p>{humanize(item.refundReasonCode)}</p>
                  </div>
                  <div className="ad-list-meta">
                    <StatusPill value={item.status} tone={item.status === "PENDING_SUPPORT_REVIEW" ? "warning" : "info"} />
                    <StatusPill value={item.reviewStage} tone="info" />
                    <small>Amount: MWK {item.amountMwk ?? "-"}</small>
                    <small>{item.requestedByCurrentAttendant ? "Created by you" : item.requestedByName || "Station workflow"}</small>
                    <small>{formatDateTime(item.requestedAt)}</small>
                    {item.orderReference ? <small>{item.orderReference}</small> : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="ad-empty">No refund requests are currently tied to this station view.</p>
            )}
          </div>
        </section>
      </section>

      <ModalForm
        key={modal ? `${modal.type}:${modal.order?.orderType}:${modal.order?.orderPublicId}` : "closed"}
        modal={modal}
        pumps={snapshot?.pumps || []}
        onClose={() => setModal(null)}
        onSubmit={submitModal}
        submitting={Boolean(actionBusyId)}
      />

      <AuditPanel audit={audit} loading={auditLoading} onClose={() => setAudit(null)} />
    </div>
  )
}

import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { Panel } from "../components/PanelTable"
import RefundInvestigationModal from "../components/RefundInvestigationModal"
import { formatDateTime, formatMoney, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

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

function selectSuggestedRefundHistoryItem(items = []) {
  const candidates = (Array.isArray(items) ? items : []).filter((item) => item?.transactionPublicId)
  if (!candidates.length) return null

  const distinctTransactionPublicIds = new Set(candidates.map((item) => item.transactionPublicId))
  if (distinctTransactionPublicIds.size !== 1) return null

  return candidates[0]
}

function CreateSupportCaseModal({ caseType, supportAgents, onClose, onCreated }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    priority: "MEDIUM",
    category: caseType === "DISPUTE" ? "QUEUE_DISPUTE" : "GENERAL",
    subject: "",
    summary: "",
    stationPublicId: "",
    userPublicId: "",
    assigneeUserPublicId: supportAgents[0]?.publicId || "",
  })

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await internalApi.createSupportCase({ caseType, ...form })
      await onCreated()
      onClose()
    } catch (err) {
      setError(err?.message || `Failed to create ${caseType.toLowerCase()} case`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <ModalFrame
      title={caseType === "DISPUTE" ? "Create Dispute Case" : "Create Ticket"}
      subtitle="Create a new internal support workflow record."
      onClose={onClose}
    >
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="settings-form-card">
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Priority</span>
              <select value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))} disabled={working}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="settings-form-field">
              <span>Category</span>
              <input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value.toUpperCase() }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>Station public ID</span>
              <input value={form.stationPublicId} onChange={(event) => setForm((prev) => ({ ...prev, stationPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>User public ID</span>
              <input value={form.userPublicId} onChange={(event) => setForm((prev) => ({ ...prev, userPublicId: event.target.value }))} disabled={working} />
            </label>
            <label className="settings-form-field">
              <span>Assign to</span>
              <select value={form.assigneeUserPublicId} onChange={(event) => setForm((prev) => ({ ...prev, assigneeUserPublicId: event.target.value }))} disabled={working}>
                <option value="">Unassigned</option>
                {supportAgents.map((agent) => (
                  <option key={agent.publicId} value={agent.publicId}>
                    {agent.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-form-field">
              <span>Subject</span>
              <input value={form.subject} onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))} disabled={working} />
            </label>
          </div>
          <label className="settings-form-field">
            <span>Summary</span>
            <textarea rows={5} value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} disabled={working} />
          </label>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={working} onClick={submit}>
              {caseType === "DISPUTE" ? "Create Dispute Case" : "Create Ticket"}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function RefundRequestDetailModal({ refund, canApproveRefund, canManageRefunds, onApprove, onReject, onClose }) {
  const [rejectReason, setRejectReason] = useState("")

  if (!refund) return null

  return (
    <ModalFrame
      title={`Refund Request ${refund.publicId}`}
      subtitle="Review, approve within threshold, or reject the refund request."
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
          <div><span>Priority</span><strong><StatusPill value={refund.priority} /></strong></div>
          <div><span>Station</span><strong>{refund.stationName || "Not linked"}</strong></div>
          <div><span>Submitted</span><strong>{formatDateTime(refund.createdAt)}</strong></div>
          <div><span>Reviewed</span><strong>{formatDateTime(refund.reviewedAt)}</strong></div>
          <div><span>Reviewer</span><strong>{refund.reviewedByName || "Unassigned"}</strong></div>
          <div><span>Support case</span><strong>{refund.supportCasePublicId || "Not linked"}</strong></div>
          <div><span>Transaction</span><strong>{refund.transactionPublicId || "Not linked"}</strong></div>
        </div>
        <div className="admin-detail-block">
          <span>Refund reason</span>
          <strong>{refund.reason || "No refund reason provided."}</strong>
        </div>
        <div className="admin-detail-block">
          <span>Review notes</span>
          <strong>{refund.resolutionNotes || "No refund notes recorded."}</strong>
        </div>
        {canManageRefunds ? (
          <div className="settings-form-card">
            <label className="settings-form-field">
              <span>Reject reason</span>
              <textarea rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
            </label>
            <div className="inline-action-group inline-action-group--row">
              {canApproveRefund && refund.status === "PENDING_SUPPORT_REVIEW" ? (
                <button type="button" className="secondary-action" onClick={() => onApprove(refund.publicId)}>
                  Approve or forward
                </button>
              ) : null}
              {refund.status === "PENDING_SUPPORT_REVIEW" ? (
                <button type="button" className="secondary-action" onClick={() => onReject(refund.publicId, rejectReason)}>
                  Reject refund
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </ModalFrame>
  )
}

function TimelineList({ items, emptyLabel, renderItem }) {
  const safeItems = Array.isArray(items) ? items : []

  return (
    <div className="timeline-list">
      {safeItems.length
        ? safeItems.map((item, index) => renderItem(item, index))
        : <p className="empty-cell">{emptyLabel}</p>}
    </div>
  )
}

function SupportCaseDetailModal({
  supportCase,
  supportAgents,
  canRespond,
  canResolve,
  canEscalate,
  canManageRefunds,
  onRefresh,
  onClose,
}) {
  const [context, setContext] = useState(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [working, setWorking] = useState(false)
  const [responseMessage, setResponseMessage] = useState("")
  const [conversationMessage, setConversationMessage] = useState("")
  const [internalNote, setInternalNote] = useState("")
  const [assigneeUserPublicId, setAssigneeUserPublicId] = useState("")
  const [refundDraft, setRefundDraft] = useState({
    amountMwk: "",
    priority: "MEDIUM",
    reason: "",
    transactionPublicId: "",
  })

  useEffect(() => {
    if (!supportCase) return

    setError("")
    setFeedback("")
    setResponseMessage(supportCase.resolution_notes || "")
    setConversationMessage("")
    setInternalNote("")
    setAssigneeUserPublicId(supportCase.assigned_user_id ? supportCase.assigned_user_public_id || "" : "")
    setRefundDraft({ amountMwk: "", priority: "MEDIUM", reason: "", transactionPublicId: "" })
    setContext(null)

    ;(async () => {
      try {
        setLoadingContext(true)
        const next = await internalApi.getSupportCaseContext(supportCase.public_id)
        setContext(next)
      } catch (err) {
        setError(err?.message || "Failed to load support context")
      } finally {
        setLoadingContext(false)
      }
    })()
  }, [supportCase])

  useEffect(() => {
    const suggestedRefund = selectSuggestedRefundHistoryItem(context?.refundHistory || [])
    if (!suggestedRefund?.transactionPublicId) return

    setRefundDraft((prev) => ({
      ...prev,
      amountMwk: prev.amountMwk || (suggestedRefund.amountMwk ? String(suggestedRefund.amountMwk) : ""),
      reason: prev.reason || `Follow-up on attendant refund request ${suggestedRefund.publicId}`,
      transactionPublicId: prev.transactionPublicId || suggestedRefund.transactionPublicId,
    }))
  }, [context?.refundHistory])

  if (!supportCase) return null

  async function runWorkflow(action, payload = {}) {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.updateSupportCaseWorkflow(supportCase.public_id, {
        action,
        note: payload.note || internalNote,
        assigneeUserPublicId: payload.assigneeUserPublicId || assigneeUserPublicId,
        escalationTarget: payload.escalationTarget || "",
      })
      setInternalNote("")
      await onRefresh()
      const next = await internalApi.getSupportCaseContext(supportCase.public_id)
      setContext(next)
      setFeedback("Support workflow updated.")
    } catch (err) {
      setError(err?.message || "Failed to update support workflow")
    } finally {
      setWorking(false)
    }
  }

  async function sendResponse() {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.respondSupportCase(supportCase.public_id, responseMessage)
      await onRefresh()
      setFeedback("Reply sent to the ticket.")
    } catch (err) {
      setError(err?.message || "Failed to send ticket reply")
    } finally {
      setWorking(false)
    }
  }

  async function sendConversationReply() {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.sendSupportCaseMessage(supportCase.public_id, conversationMessage)
      setConversationMessage("")
      await onRefresh()
      const next = await internalApi.getSupportCaseContext(supportCase.public_id)
      setContext(next)
      setFeedback("Conversation message sent.")
    } catch (err) {
      setError(err?.message || "Failed to send support message")
    } finally {
      setWorking(false)
    }
  }

  async function resolveOnly() {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.resolveSupportCase(supportCase.public_id)
      await onRefresh()
      setFeedback("Support case resolved.")
    } catch (err) {
      setError(err?.message || "Failed to resolve support case")
    } finally {
      setWorking(false)
    }
  }

  async function createRefund(mode) {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.createSupportRefund({
        supportCasePublicId: supportCase.public_id,
        stationPublicId: supportCase.station_public_id || context?.stationProfile?.publicId || "",
        userPublicId: supportCase.user_public_id || context?.userProfile?.publicId || "",
        amountMwk: refundDraft.amountMwk,
        priority: refundDraft.priority,
        reason: refundDraft.reason,
        mode,
        transactionPublicId: refundDraft.transactionPublicId,
      })
      setRefundDraft({ amountMwk: "", priority: "MEDIUM", reason: "", transactionPublicId: "" })
      await onRefresh()
      setFeedback(mode === "ISSUE" ? "Refund issued within support threshold." : "Refund submitted for approval.")
    } catch (err) {
      setError(err?.message || "Failed to create refund request")
    } finally {
      setWorking(false)
    }
  }

  function applyRefundHistoryItem(item) {
    setRefundDraft((prev) => ({
      ...prev,
      amountMwk: prev.amountMwk || (item?.amountMwk ? String(item.amountMwk) : ""),
      reason: prev.reason || `Follow-up on attendant refund request ${item?.publicId || ""}`.trim(),
      transactionPublicId: item?.transactionPublicId || prev.transactionPublicId,
    }))
  }

  return (
    <ModalFrame
      title={supportCase.subject}
      subtitle="Ticket handling, disputes, refunds, and customer assistance context."
      onClose={onClose}
      badges={
        <>
          <StatusPill value={supportCase.priority} />
          <StatusPill value={supportCase.status} />
        </>
      }
    >
      <div className="stack-grid">
        {error ? <p className="settings-error">{error}</p> : null}
        {feedback ? <p className="settings-inline-feedback">{feedback}</p> : null}

        <div className="settings-summary-list admin-detail-grid">
          <div><span>Case ID</span><strong>{supportCase.public_id}</strong></div>
          <div><span>Type</span><strong>{String(supportCase.category || "").includes("DISPUTE") ? "Dispute" : "Ticket"}</strong></div>
          <div><span>Source ticket</span><strong>{supportCase.source_ticket_id || "Manual case"}</strong></div>
          <div><span>Station</span><strong>{supportCase.station_name || context?.stationProfile?.name || "Not linked"}</strong></div>
          <div><span>Customer</span><strong>{supportCase.user_name || context?.userProfile?.fullName || "Not linked"}</strong></div>
          <div><span>Opened</span><strong>{formatDateTime(supportCase.created_at)}</strong></div>
        </div>

        <div className="admin-detail-block">
          <span>Summary</span>
          <strong>{supportCase.summary || "No case summary recorded."}</strong>
        </div>

        {context?.escalationState?.awaitingSupportDecision ? (
          <div className="settings-form-card">
            <h4 style={{ margin: 0, color: "#1a314b" }}>Escalation Response</h4>
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Responded by</span><strong>{context.escalationState.respondedByRoleCode || "Department"}</strong></div>
              <div><span>Responded at</span><strong>{formatDateTime(context.escalationState.respondedAt)}</strong></div>
              <div><span>Escalated to</span><strong>{context.escalationState.originalOwnerRoleCode || "-"}</strong></div>
              <div><span>Alert</span><strong>{context.escalationState.alertPublicId || "-"}</strong></div>
            </div>
            <div className="admin-detail-block">
              <span>Department response</span>
              <strong>{context.escalationState.responseMessage || "No response message recorded."}</strong>
            </div>
            <div className="inline-action-group inline-action-group--row">
              {canResolve ? (
                <>
                  <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("APPROVE_ESCALATION_RESPONSE", { note: internalNote })}>
                    Approve Response
                  </button>
                  <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("REJECT_ESCALATION_RESPONSE", { note: internalNote })}>
                    Reject Response
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="settings-form-card">
          <h4 style={{ margin: 0, color: "#1a314b" }}>Ticket handling</h4>
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Assign to</span>
              <select value={assigneeUserPublicId} onChange={(event) => setAssigneeUserPublicId(event.target.value)} disabled={!canResolve || working}>
                <option value="">Select support agent</option>
                {supportAgents.map((agent) => (
                  <option key={agent.publicId} value={agent.publicId}>
                    {agent.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-form-field">
              <span>Internal note</span>
              <textarea rows={4} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} disabled={!canResolve || working} />
            </label>
            <label className="settings-form-field">
              <span>Conversation message</span>
              <textarea rows={4} value={conversationMessage} onChange={(event) => setConversationMessage(event.target.value)} disabled={!canRespond || working || supportCase.status === "RESOLVED"} />
            </label>
            <label className="settings-form-field">
              <span>Reply to ticket</span>
              <textarea rows={4} value={responseMessage} onChange={(event) => setResponseMessage(event.target.value)} disabled={!canRespond || working} />
            </label>
          </div>
          <div className="inline-action-group inline-action-group--row">
            {canResolve ? (
              <>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("ASSIGN_TICKET")}>Assign Ticket</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("REASSIGN_TICKET")}>Reassign Ticket</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("ADD_INTERNAL_NOTE")}>Add Internal Note</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("MARK_IN_PROGRESS")}>Mark In Progress</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("MARK_WAITING_ON_USER")}>Waiting on User</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("REOPEN_TICKET")}>Reopen Ticket</button>
              </>
            ) : null}
            {canRespond && supportCase.source_ticket_id ? (
              <button type="button" className="secondary-action" disabled={working || !conversationMessage.trim() || supportCase.status === "RESOLVED"} onClick={sendConversationReply}>Send Message</button>
            ) : null}
            {canRespond && supportCase.source_ticket_id ? (
              <button type="button" className="secondary-action" disabled={working} onClick={sendResponse}>Reply to Ticket</button>
            ) : null}
            {canResolve && supportCase.status !== "RESOLVED" ? (
              <button type="button" className="secondary-action" disabled={working} onClick={resolveOnly}>Resolve Ticket</button>
            ) : null}
            {canEscalate ? (
              <>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("ESCALATE_TO_FINANCE")}>Escalate to Finance</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("ESCALATE_TO_OPERATIONS")}>Escalate to Operations</button>
              </>
            ) : null}
            {canResolve && String(supportCase.category || "").includes("DISPUTE") ? (
              <button type="button" className="secondary-action" disabled={working} onClick={() => runWorkflow("CLOSE_DISPUTE")}>Close Dispute</button>
            ) : null}
          </div>
        </div>

        <div className="settings-form-card">
          <h4 style={{ margin: 0, color: "#1a314b" }}>Ticket conversation</h4>
          {loadingContext ? <p>Loading support context...</p> : null}
          {!loadingContext && Array.isArray(context?.ticketMessages) && context.ticketMessages.length ? (
            <div className="support-thread-list">
              {context.ticketMessages.map((item) => (
                <article key={item.publicId} className="support-thread-item">
                  <div className="support-thread-meta">
                    <strong>{item.senderName || item.senderRoleCode || item.senderScope}</strong>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </div>
                  {item.title ? <h5>{item.title}</h5> : null}
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          ) : null}
          {!loadingContext && !(context?.ticketMessages || []).length ? <p>No ticket conversation recorded yet.</p> : null}
        </div>

        <div className="settings-form-card">
          <h4 style={{ margin: 0, color: "#1a314b" }}>Refunds</h4>
          <div className="settings-profile-grid">
            <label className="settings-form-field">
              <span>Amount (MWK)</span>
              <input type="number" min="1" value={refundDraft.amountMwk} onChange={(event) => setRefundDraft((prev) => ({ ...prev, amountMwk: event.target.value }))} disabled={!canManageRefunds || working} />
            </label>
            <label className="settings-form-field">
              <span>Priority</span>
              <select value={refundDraft.priority} onChange={(event) => setRefundDraft((prev) => ({ ...prev, priority: event.target.value }))} disabled={!canManageRefunds || working}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="settings-form-field">
              <span>Transaction public ID</span>
              <input value={refundDraft.transactionPublicId} onChange={(event) => setRefundDraft((prev) => ({ ...prev, transactionPublicId: event.target.value }))} disabled={!canManageRefunds || working} />
            </label>
            <label className="settings-form-field">
              <span>Refund reason</span>
              <textarea rows={4} value={refundDraft.reason} onChange={(event) => setRefundDraft((prev) => ({ ...prev, reason: event.target.value }))} disabled={!canManageRefunds || working} />
            </label>
          </div>
          <div className="inline-action-group inline-action-group--row">
            {canManageRefunds ? (
              <>
                <button type="button" className="secondary-action" disabled={working} onClick={() => createRefund("ISSUE")}>Issue Refund</button>
                <button type="button" className="secondary-action" disabled={working} onClick={() => createRefund("SUBMIT_APPROVAL")}>Submit Refund for Approval</button>
              </>
            ) : (
              <strong>No refund actions available for your role.</strong>
            )}
          </div>
        </div>

        <div className="internal-page-grid internal-page-grid--two-thirds">
          <Panel title="Driver Profile">
            {loadingContext ? <p>Loading support context...</p> : null}
            <div className="settings-summary-list">
              <div><span>User ID</span><strong>{context?.userProfile?.publicId || "Not linked"}</strong></div>
              <div><span>Name</span><strong>{context?.userProfile?.fullName || "Not linked"}</strong></div>
              <div><span>Email</span><strong>{context?.userProfile?.email || "-"}</strong></div>
              <div><span>Phone</span><strong>{context?.userProfile?.phone || "-"}</strong></div>
            </div>
          </Panel>
          <Panel title="Station Profile">
            <div className="settings-summary-list">
              <div><span>Station ID</span><strong>{context?.stationProfile?.publicId || "Not linked"}</strong></div>
              <div><span>Name</span><strong>{context?.stationProfile?.name || "Not linked"}</strong></div>
              <div><span>Operator</span><strong>{context?.stationProfile?.operatorName || "-"}</strong></div>
              <div><span>City</span><strong>{context?.stationProfile?.city || "-"}</strong></div>
              <div><span>Address</span><strong>{context?.stationProfile?.address || "-"}</strong></div>
              <div><span>Status</span><strong>{context?.stationProfile ? <StatusPill value={context.stationProfile.isActive ? "ACTIVE" : "INACTIVE"} /> : "-"}</strong></div>
            </div>
          </Panel>
        </div>

        <div className="internal-page-grid internal-page-grid--two-thirds">
          <Panel title="Transaction History">
            <TimelineList
              items={context?.transactions}
              emptyLabel="No transaction history linked to this support case yet."
              renderItem={(item) => (
                <article key={item.publicId} className="timeline-item">
                  <div>
                    <strong>{item.publicId}</strong>
                    <p>{item.stationName}</p>
                  </div>
                  <div className="timeline-meta">
                    <span>{formatMoney(item.totalAmount)}</span>
                    <span>{formatDateTime(item.occurredAt)}</span>
                  </div>
                </article>
              )}
            />
          </Panel>
          <Panel title="Reservation History">
            <TimelineList
              items={context?.reservationHistory}
              emptyLabel="No reservation history linked to this support case yet."
              renderItem={(item) => (
                <article key={item.publicId} className="timeline-item">
                  <div>
                    <strong>{item.publicId}</strong>
                    <p>{item.stationName}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={item.status} />
                    <span>{formatDateTime(item.slotStart)}</span>
                  </div>
                </article>
              )}
            />
          </Panel>
        </div>

        <div className="internal-page-grid internal-page-grid--two-thirds">
          <Panel title="Queue History">
            <TimelineList
              items={context?.queueHistory}
              emptyLabel="No queue history linked to this support case yet."
              renderItem={(item) => (
                <article key={item.publicId} className="timeline-item">
                  <div>
                    <strong>{item.publicId}</strong>
                    <p>{item.stationName}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={item.status} />
                    <span>Position {item.position}</span>
                  </div>
                </article>
              )}
            />
          </Panel>
          <Panel title="Refund History">
            <TimelineList
              items={context?.refundHistory}
              emptyLabel="No refund history linked to this support case yet."
              renderItem={(item) => (
                <article key={item.publicId} className="timeline-item">
                  <div>
                    <strong>{item.publicId}</strong>
                    <p>{item.reason || item.stationName || "Refund request"}</p>
                    <p>Transaction: {item.transactionPublicId || "Not linked"}</p>
                  </div>
                  <div className="timeline-meta">
                    <span>{formatMoney(item.amountMwk)}</span>
                    <StatusPill value={item.status} />
                    <span>{formatDateTime(item.createdAt)}</span>
                    {canManageRefunds && item.transactionPublicId ? (
                      <button type="button" className="secondary-action" onClick={() => applyRefundHistoryItem(item)}>
                        Use Transaction
                      </button>
                    ) : null}
                  </div>
                </article>
              )}
            />
          </Panel>
          <Panel title="Support History">
            <TimelineList
              items={context?.supportHistory}
              emptyLabel="No related support history linked to this case yet."
              renderItem={(item) => (
                <article key={item.publicId} className="timeline-item">
                  <div>
                    <strong>{item.subject}</strong>
                    <p>{item.publicId}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={item.status} />
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                </article>
              )}
            />
          </Panel>
        </div>
      </div>
    </ModalFrame>
  )
}

export default function SupportPage() {
  const { hasPermission, session } = useInternalAuth()
  const [data, setData] = useState({ cases: [], inboundTickets: [], refundRequests: [], supportAgents: [], summary: {} })
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const [selectedRefundId, setSelectedRefundId] = useState(null)
  const [createMode, setCreateMode] = useState("")

  async function load() {
    setData(await internalApi.getSupport())
  }

  useEffect(() => {
    let cancelled = false

    internalApi
      .getSupport()
      .then((next) => {
        if (cancelled) return
        setData(next)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || "Failed to load support cases")
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function runAction(action) {
    try {
      setError("")
      await action()
      await load()
    } catch (err) {
      setError(err?.message || "Failed to update support workflow")
    }
  }

  const primaryRole = String(session?.profile?.primaryRole || "").toUpperCase()
  const isSupportAgent = primaryRole === "CUSTOMER_SUPPORT_AGENT"

  const filteredCases = useMemo(() => {
    const items = data.cases || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.public_id || ""} ${row.subject} ${row.summary} ${row.station_name || ""} ${row.user_name || ""} ${row.status || ""} ${row.category || ""} ${row.linked_refund_public_id || ""} ${row.linked_refund_status || ""} ${row.linked_refund_reason || ""}`
        .toLowerCase()
        .includes(needle)
    )
  }, [data, query])

  const queueCases = useMemo(() => {
    if (!isSupportAgent) return filteredCases
    return filteredCases.filter((row) => !["RESOLVED", "CLOSED"].includes(row.status))
  }, [filteredCases, isSupportAgent])

  const resolvedCases = useMemo(() => {
    if (!isSupportAgent) return []
    return filteredCases.filter((row) => ["RESOLVED", "CLOSED"].includes(row.status))
  }, [filteredCases, isSupportAgent])

  const selectedCase = useMemo(
    () => (data.cases || []).find((row) => row.public_id === selectedCaseId) || null,
    [data.cases, selectedCaseId]
  )

  const selectedRefund = useMemo(
    () => (data.refundRequests || []).find((row) => row.publicId === selectedRefundId) || null,
    [data.refundRequests, selectedRefundId]
  )
  const supportCaseMetricColumns = useMemo(
    () => [
      { key: "public_id", label: "Case ID" },
      { key: "priority", label: "Priority", render: (row) => <StatusPill value={row.priority} /> },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "subject", label: "Subject" },
      { key: "station_name", label: "Station" },
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
  const metricItems = useMemo(
    () => [
      {
        label: "Open Cases",
        value: formatNumber(data.summary?.openCases),
        drilldown: {
          title: isSupportAgent ? "Active Support Queue" : "Open Support Cases",
          subtitle: "Support cases still active in the current queue.",
          rows: queueCases,
          columns: supportCaseMetricColumns,
          emptyLabel: "No open support cases found.",
          minWidth: 920,
          onRowClick: (row) => setSelectedCaseId(row.public_id),
        },
      },
      {
        label: "Escalated",
        value: formatNumber(data.summary?.escalatedDisputes),
        drilldown: {
          title: "Escalated Support Cases",
          subtitle: "Support cases escalated for deeper operational review.",
          rows: filteredCases.filter((row) => String(row.status || "").toUpperCase() === "ESCALATED"),
          columns: supportCaseMetricColumns,
          emptyLabel: "No escalated support cases found.",
          minWidth: 920,
          onRowClick: (row) => setSelectedCaseId(row.public_id),
        },
      },
      {
        label: "Failed Payments",
        value: formatNumber(data.summary?.failedPaymentIssues),
        drilldown: {
          title: "Failed Payment Issues",
          subtitle: "Support cases related to failed or disputed payment journeys.",
          rows: filteredCases.filter((row) => {
            const haystack = `${row.category || ""} ${row.subject || ""} ${row.summary || ""}`.toLowerCase()
            return haystack.includes("payment") || haystack.includes("failed")
          }),
          columns: supportCaseMetricColumns,
          emptyLabel: "No failed payment support cases found.",
          minWidth: 920,
          onRowClick: (row) => setSelectedCaseId(row.public_id),
        },
      },
      {
        label: "Refunds Pending",
        value: formatNumber(data.summary?.refundsPendingApproval),
        drilldown: {
          title: "Refunds Pending Approval",
          subtitle: "Refund requests still awaiting support review or approval.",
          rows: (data.refundRequests || []).filter((row) => String(row.status || "").toUpperCase().includes("PENDING")),
          columns: refundMetricColumns,
          emptyLabel: "No pending refunds found.",
          minWidth: 900,
          onRowClick: (row) => setSelectedRefundId(row.publicId),
        },
      },
    ],
    [
      data.refundRequests,
      data.summary?.escalatedDisputes,
      data.summary?.failedPaymentIssues,
      data.summary?.openCases,
      data.summary?.refundsPendingApproval,
      filteredCases,
      isSupportAgent,
      queueCases,
      refundMetricColumns,
      supportCaseMetricColumns,
    ]
  )

  const canManageCases = hasPermission("support:resolve")
  const canEscalateCases = hasPermission("support:escalate")
  const canManageRefunds = hasPermission("support:refund_limited")

  return (
    <InternalShell title="Support & Disputes" alerts={error ? [{ id: "support-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar">
        <input className="page-search" placeholder="Search support cases or case ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        {canManageCases ? (
          <>
            <button type="button" className="secondary-action" onClick={() => setCreateMode("TICKET")}>
              Create Ticket
            </button>
            <button type="button" className="secondary-action" onClick={() => setCreateMode("DISPUTE")}>
              Create Dispute Case
            </button>
          </>
        ) : null}
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title={isSupportAgent ? "Active Support Queue" : "Support Queue"}
          previewLimit={8}
          modalTitle={isSupportAgent ? "All Active Support Cases" : "All Support Cases"}
          columns={[
            {
              key: "public_id",
              label: "Case ID",
              render: (row) => (
                <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.public_id)}>
                  {row.public_id}
                </button>
              ),
            },
            { key: "priority", label: "Priority", render: (row) => <StatusPill value={row.priority} /> },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            { key: "subject", label: "Subject" },
            {
              key: "linked_refund_public_id",
              label: "Refund",
              render: (row) =>
                row.linked_refund_public_id ? (
                  <button type="button" className="secondary-action" onClick={() => setSelectedRefundId(row.linked_refund_public_id)}>
                    {row.linked_refund_public_id}
                  </button>
                ) : (
                  "None"
                ),
            },
            { key: "station_name", label: "Station" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.public_id)}>Open</button>
                  {canManageCases && row.status !== "IN_PROGRESS" ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.updateSupportCaseWorkflow(row.public_id, { action: "MARK_IN_PROGRESS" }))}>
                      In Progress
                    </button>
                  ) : null}
                  {canEscalateCases && row.status !== "ESCALATED" ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.updateSupportCaseWorkflow(row.public_id, { action: "ESCALATE_TO_OPERATIONS" }))}>
                      Escalate
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={queueCases}
        />

        <div className="stack-grid">
          {isSupportAgent ? (
            <PreviewTablePanel
              title="Resolved Support Cases"
              previewLimit={5}
              compact
              minWidth={420}
              modalTitle="All Resolved Support Cases"
              columns={[
                {
                  key: "public_id",
                  label: "Case ID",
                  render: (row) => (
                    <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.public_id)}>
                      {row.public_id}
                    </button>
                  ),
                },
                { key: "subject", label: "Subject" },
                { key: "station_name", label: "Station" },
                { key: "resolved_at", label: "Resolved", render: (row) => formatDateTime(row.resolved_at) },
              ]}
              rows={resolvedCases}
            />
          ) : null}

          <PreviewTablePanel
            title="Refund Review Queue"
            previewLimit={5}
            compact
            minWidth={460}
            modalTitle="All Refund Review Requests"
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
              {
                key: "supportCasePublicId",
                label: "Case ID",
                render: (row) =>
                  row.supportCasePublicId ? (
                    <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.supportCasePublicId)}>
                      {row.supportCasePublicId}
                    </button>
                  ) : (
                    "Not linked"
                  ),
              },
              { key: "priority", label: "Priority", render: (row) => <StatusPill value={row.priority} /> },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "amountMwk", label: "Amount", render: (row) => formatMoney(row.amountMwk) },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="inline-action-group inline-action-group--row">
                    <button type="button" className="secondary-action" onClick={() => setSelectedRefundId(row.publicId)}>Open</button>
                    {row.supportCasePublicId ? (
                      <button type="button" className="secondary-action" onClick={() => setSelectedCaseId(row.supportCasePublicId)}>Open Case</button>
                    ) : null}
                    {canManageRefunds && row.status === "PENDING_SUPPORT_REVIEW" ? (
                      <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.approveSupportRefund(row.publicId))}>Approve / Forward</button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            rows={data.refundRequests || []}
          />

          <Panel title="Inbound Support Tickets">
            <div className="timeline-list">
              {(data.inboundTickets || []).map((row) => (
                <article key={row.id} className="timeline-item">
                  <div>
                    <strong>{row.title}</strong>
                    <p>{row.category}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={row.status} />
                    <span>{formatDateTime(row.created_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {createMode ? (
        <CreateSupportCaseModal
          caseType={createMode}
          supportAgents={data.supportAgents || []}
          onClose={() => setCreateMode("")}
          onCreated={load}
        />
      ) : null}

      {selectedRefund ? (
        <RefundInvestigationModal
          refundPublicId={selectedRefund.publicId}
          mode="support"
          allowApprove={canManageRefunds}
          allowReject={canManageRefunds}
          allowComplianceEscalation={canEscalateCases}
          onChanged={load}
          onClose={() => setSelectedRefundId(null)}
        />
      ) : null}

      {selectedCase ? (
        <SupportCaseDetailModal
          supportCase={selectedCase}
          supportAgents={data.supportAgents || []}
          canRespond={canManageCases && Boolean(selectedCase.source_ticket_id)}
          canResolve={canManageCases}
          canEscalate={canEscalateCases}
          canManageRefunds={canManageRefunds}
          onRefresh={load}
          onClose={() => setSelectedCaseId(null)}
        />
      ) : null}
    </InternalShell>
  )
}

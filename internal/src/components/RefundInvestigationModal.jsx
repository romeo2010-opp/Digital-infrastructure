import { useEffect, useRef, useState } from "react"
import { internalApi } from "../api/internalApi"
import ActionConfirmModal from "./ActionConfirmModal"
import MetricGrid from "./MetricGrid"
import StatusPill from "./StatusPill"
import { formatDateTime, formatMoney, formatNumber } from "../utils/display"

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
      <div className="internal-modal admin-modal refund-investigation-modal" onClick={(event) => event.stopPropagation()}>
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

function SummaryGrid({ items }) {
  return (
    <div className="settings-summary-list admin-detail-grid refund-investigation-summary-grid">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

function InvestigationSection({ title, subtitle, className = "", children }) {
  return (
    <section className={`settings-form-card refund-investigation-section ${className}`.trim()}>
      <div className="refund-investigation-section-head">
        <div>
          <h4>{title}</h4>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function TimelineSection({ title, subtitle, items, render, className = "" }) {
  return (
    <InvestigationSection title={title} subtitle={subtitle} className={className}>
      {items?.length ? (
        <div className="timeline-list">
          {items.map((item, index) => render(item, index))}
        </div>
      ) : (
        <p className="empty-cell">No records.</p>
      )}
    </InvestigationSection>
  )
}

export default function RefundInvestigationModal({
  refundPublicId,
  mode = "support",
  allowApprove = false,
  allowReject = false,
  allowComplianceEscalation = false,
  onClose,
  onChanged,
}) {
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [working, setWorking] = useState(false)
  const [showFinanceApprovalConfirm, setShowFinanceApprovalConfirm] = useState(false)
  const [decisionNote, setDecisionNote] = useState("")
  const [evidenceType, setEvidenceType] = useState("ATTENDANT_CONFIRMATION")
  const [evidenceSummary, setEvidenceSummary] = useState("")
  const decisionNoteDirtyRef = useRef(false)

  async function load({ syncDecisionNote = false } = {}) {
    setLoading(true)
    setError("")
    try {
      const next = await internalApi.getRefundInvestigation(refundPublicId)
      setBundle(next)
      if (syncDecisionNote || !decisionNoteDirtyRef.current) {
        setDecisionNote(next?.refund?.resolutionNotes || "")
        decisionNoteDirtyRef.current = false
      }
    } catch (err) {
      setError(err?.message || "Failed to load refund investigation")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    decisionNoteDirtyRef.current = false
    setDecisionNote("")
    setBundle(null)
    setLoading(true)
    setError("")
    load({ syncDecisionNote: true })
  }, [refundPublicId])

  async function runAction(action) {
    try {
      setWorking(true)
      setError("")
      await action()
      await load({ syncDecisionNote: true })
      await onChanged?.()
    } catch (err) {
      setError(err?.message || "Refund investigation action failed")
    } finally {
      setWorking(false)
    }
  }

  if (!refundPublicId) return null

  const refund = bundle?.refund
  const transaction = bundle?.transaction
  const pumpSession = bundle?.pumpSession
  const assessment = bundle?.assessment
  const qrValidation = bundle?.context?.qrValidation
  const complianceCase = bundle?.complianceCase
  const complianceApprovalLocked =
    mode === "finance"
    && Boolean(refund?.complianceCasePublicId)
    && !Boolean(refund?.complianceMarkedFalsePositive)
  const financeApprovalNeedsConfirmation =
    mode === "finance"
    && Boolean(refund?.complianceCasePublicId)
    && Boolean(refund?.complianceMarkedFalsePositive)
  const escalateRefundToComplianceAction =
    mode === "support"
      ? internalApi.supportEscalateRefundToCompliance
      : internalApi.escalateRefundToCompliance
  const recommendationLabel = (assessment?.recommendation || "NEED_MORE_EVIDENCE").replaceAll("_", " ")
  const confidenceLabel = assessment?.confidenceLabel || "LOW"
  const overviewMetrics = refund ? [
    {
      label: "Requested Amount",
      value: formatMoney(refund.amountMwk),
      tone: "accent",
      meta: `Requested ${formatDateTime(refund.requestedAt)}`,
    },
    {
      label: "Confidence",
      value: confidenceLabel,
      tone: confidenceLabel === "HIGH" ? "success" : confidenceLabel === "MEDIUM" ? "warning" : "neutral",
      meta: `Score ${formatNumber(assessment?.confidenceScore || 0)}`,
    },
    {
      label: "Evidence Records",
      value: formatNumber(bundle?.evidenceBundle?.length || 0),
      tone: "neutral",
      meta: `${formatNumber(bundle?.telemetryTimeline?.length || 0)} telemetry events correlated`,
    },
    {
      label: "Review Activity",
      value: formatNumber(bundle?.reviews?.length || 0),
      tone: bundle?.reviews?.length ? "warning" : "neutral",
      meta: `${formatNumber(bundle?.auditTrail?.length || 0)} audit events tracked`,
    },
  ] : []

  function runFinanceApproval() {
    return runAction(() => internalApi.approveFinanceRefund(refundPublicId, decisionNote))
  }

  function handleFinanceApprove() {
    if (financeApprovalNeedsConfirmation) {
      setShowFinanceApprovalConfirm(true)
      return
    }
    runFinanceApproval()
  }

  return (
    <>
      <ModalFrame
        title={`Refund Investigation ${refundPublicId}`}
        subtitle="Correlated refund evidence across transaction, queue, reservation, pump session, telemetry, and audit review."
        onClose={onClose}
        badges={
          refund ? (
            <>
              <span className="internal-modal-count">{formatMoney(refund.amountMwk)}</span>
              <StatusPill value={refund.legacyStatus} />
            </>
          ) : null
        }
      >
        <div className="stack-grid refund-investigation-layout">
          {error ? <p className="settings-error">{error}</p> : null}
          {loading ? <p>Loading investigation bundle...</p> : null}

          {!loading && bundle ? (
            <>
              <section className="refund-investigation-hero">
                <div className="refund-investigation-hero-copy">
                  <span className="refund-investigation-kicker">Refund investigation workspace</span>
                  <h4>{recommendationLabel}</h4>
                  <p>
                    Confidence {confidenceLabel} ({formatNumber(assessment?.confidenceScore || 0)}). Review the
                    correlated payment, queue, pump telemetry, and audit signals before progressing the case.
                  </p>
                  <div className="refund-recommendation-badges">
                    <StatusPill value={refund?.investigationStatus || refund?.legacyStatus} />
                    <StatusPill value={refund?.reviewStage || "-"} />
                    {refund?.priority ? <StatusPill value={refund.priority} /> : null}
                  </div>
                </div>
                <div className="refund-investigation-hero-aside">
                  <div className="admin-detail-block refund-investigation-callout">
                    <span>User statement</span>
                    <strong>{refund.userStatement || "No user statement recorded."}</strong>
                  </div>
                  {complianceCase?.actionTaken ? (
                    <div className="admin-detail-block refund-investigation-callout">
                      <span>Compliance action trail</span>
                      <strong>{complianceCase.actionTaken}</strong>
                    </div>
                  ) : null}
                </div>
              </section>

              <div className="refund-investigation-metrics">
                <MetricGrid items={overviewMetrics} />
              </div>

              <div className="refund-investigation-main-grid">
                <InvestigationSection
                  title="Refund Request Summary"
                  subtitle="Customer case context, linked investigations, and request metadata."
                >
                  <section className="refund-recommendation-banner">
                    <div>
                      <strong>{assessment?.recommendation || "NEED_MORE_EVIDENCE"}</strong>
                      <p>Primary automated recommendation for this case bundle.</p>
                    </div>
                    <div className="refund-recommendation-badges">
                      <StatusPill value={refund?.legacyStatus} />
                      {refund?.complianceCaseStatus ? <StatusPill value={refund.complianceCaseStatus} /> : null}
                    </div>
                  </section>
                  <SummaryGrid
                    items={[
                      { label: "Refund ID", value: refund.publicId },
                      { label: "User", value: refund.userName || refund.userPublicId || "Not linked" },
                      { label: "Amount", value: formatMoney(refund.amountMwk) },
                      { label: "Priority", value: <StatusPill value={refund.priority} /> },
                      { label: "Reason", value: refund.reason || "-" },
                      { label: "Requested", value: formatDateTime(refund.requestedAt) },
                      { label: "Support Case", value: refund.supportCasePublicId || "Not linked" },
                      { label: "Compliance Case", value: refund.complianceCasePublicId || "Not linked" },
                      { label: "Compliance Status", value: refund.complianceCaseStatus ? <StatusPill value={refund.complianceCaseStatus} /> : "-" },
                      { label: "Compliance Outcome", value: refund.complianceMarkedFalsePositive ? "False positive" : refund.complianceCasePublicId ? "Approval locked" : "-" },
                    ]}
                  />
                </InvestigationSection>

                <InvestigationSection
                  title="Decision Workspace"
                  subtitle="Record the review note and action the case using the current workflow permissions."
                >
                  <label className="settings-form-field">
                    <span>Decision / review note</span>
                    <textarea
                      rows={6}
                      value={decisionNote}
                      onChange={(event) => {
                        decisionNoteDirtyRef.current = true
                        setDecisionNote(event.target.value)
                      }}
                      disabled={working}
                    />
                  </label>
                  {assessment?.flags?.length ? (
                    <div className="refund-investigation-flags">
                      {assessment.flags.map((flag) => <p key={flag}>{flag}</p>)}
                    </div>
                  ) : null}
                  {assessment?.reasons?.length ? (
                    <div className="refund-investigation-reasons">
                      {assessment.reasons.map((reason) => <p key={reason}>{reason}</p>)}
                    </div>
                  ) : null}
                  {complianceApprovalLocked ? (
                    <div className="refund-investigation-flags">
                      <p>Finance approval is locked until compliance resolves the linked case as a false positive.</p>
                    </div>
                  ) : null}
                  <div className="settings-form-actions refund-investigation-actions">
                    {mode === "support" && allowApprove && refund?.legacyStatus === "PENDING_SUPPORT_REVIEW" ? (
                      <button type="button" className="secondary-action" disabled={working} onClick={() => runAction(() => internalApi.approveSupportRefund(refundPublicId))}>
                        Approve / Forward
                      </button>
                    ) : null}
                    {mode === "support" && allowReject && refund?.legacyStatus === "PENDING_SUPPORT_REVIEW" ? (
                      <button type="button" className="secondary-action" disabled={working} onClick={() => runAction(() => internalApi.rejectSupportRefund(refundPublicId, decisionNote))}>
                        Reject Refund
                      </button>
                    ) : null}
                    {mode === "finance" && allowApprove && refund?.legacyStatus === "PENDING_FINANCE_APPROVAL" && !complianceApprovalLocked ? (
                      <button type="button" className="secondary-action" disabled={working} onClick={handleFinanceApprove}>
                        Approve Refund
                      </button>
                    ) : null}
                    {mode === "finance" && allowReject && refund?.legacyStatus === "PENDING_FINANCE_APPROVAL" ? (
                      <button type="button" className="secondary-action" disabled={working} onClick={() => runAction(() => internalApi.rejectFinanceRefund(refundPublicId, decisionNote))}>
                        Reject Refund
                      </button>
                    ) : null}
                    {(mode === "finance" || mode === "support") && allowComplianceEscalation ? (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={working}
                        onClick={() => runAction(() => escalateRefundToComplianceAction(refundPublicId, { note: decisionNote, severity: "HIGH" }))}
                      >
                        Escalate to Compliance
                      </button>
                    ) : null}
                  </div>
                </InvestigationSection>
              </div>

              <div className="refund-investigation-grid refund-investigation-grid--detail-cards">
                <InvestigationSection
                  title="Transaction Summary"
                  subtitle="Payment reference, device linkage, and settlement context."
                >
                <SummaryGrid
                  items={[
                    { label: "Transaction", value: transaction?.publicId || "Not linked" },
                    { label: "Payment Ref", value: transaction?.paymentReference || bundle?.paymentRecord?.transactionReference || "Not linked" },
                    { label: "Amount", value: transaction ? formatMoney(transaction.amountMwk || 0) : "-" },
                    { label: "Fuel Type", value: transaction?.fuelType || "-" },
                    { label: "Pump", value: transaction?.pumpPublicId ? `${transaction.pumpPublicId} / #${transaction.pumpNumber || "-"}` : "-" },
                    { label: "Nozzle", value: transaction?.nozzlePublicId ? `${transaction.nozzlePublicId} / #${transaction.nozzleNumber || "-"}` : "-" },
                    { label: "Status", value: transaction?.status ? <StatusPill value={transaction.status} /> : "-" },
                    { label: "Occurred", value: formatDateTime(transaction?.occurredAt) },
                  ]}
                />
                </InvestigationSection>

                <InvestigationSection
                  title="Pump Session Summary"
                  subtitle="Dispense timing, correlation identifiers, and equipment health signals."
                >
                  <SummaryGrid
                  items={[
                    { label: "Session", value: pumpSession?.sessionReference || "Not linked" },
                    { label: "Status", value: pumpSession?.status ? <StatusPill value={pumpSession.status} /> : "-" },
                    { label: "Dispensed", value: `${formatNumber(pumpSession?.dispensedLitres || 0)} L` },
                    { label: "Duration", value: pumpSession?.durationSeconds ? `${formatNumber(pumpSession.durationSeconds)} s` : "-" },
                    { label: "Start", value: formatDateTime(pumpSession?.startTime) },
                    { label: "End", value: formatDateTime(pumpSession?.endTime) },
                    { label: "Error Code", value: pumpSession?.errorCode || "-" },
                    { label: "Correlation ID", value: pumpSession?.telemetryCorrelationId || "-" },
                  ]}
                />
                  <div className="admin-detail-block refund-investigation-callout">
                    <span>Error message</span>
                    <strong>{pumpSession?.errorMessage || "No pump session error recorded."}</strong>
                  </div>
                </InvestigationSection>

                <InvestigationSection
                  title="Queue / Reservation / QR Evidence"
                  subtitle="Journey linkage and check-in evidence associated with the refund."
                >
                  <SummaryGrid
                    items={[
                      { label: "Queue Entry", value: bundle?.context?.queue?.publicId || "Not linked" },
                      { label: "Queue Status", value: bundle?.context?.queue?.status ? <StatusPill value={bundle.context.queue.status} /> : "-" },
                      { label: "Queue Position", value: bundle?.context?.queue?.position ?? "-" },
                      { label: "Reservation", value: bundle?.context?.reservation?.publicId || "Not linked" },
                      { label: "Reservation Status", value: bundle?.context?.reservation?.status ? <StatusPill value={bundle.context.reservation.status} /> : "-" },
                      { label: "Requested Litres", value: bundle?.context?.reservation ? `${formatNumber(bundle.context.reservation.requestedLitres || 0)} L` : "-" },
                      { label: "QR Evidence", value: qrValidation?.type || "Not linked" },
                      { label: "QR Time", value: formatDateTime(qrValidation?.scannedAt || qrValidation?.checkedInAt) },
                    ]}
                  />
                </InvestigationSection>
              </div>

              <div className="refund-investigation-grid refund-investigation-grid--timeline-panels">
                <TimelineSection
                  title="Telemetry Timeline"
                  subtitle="Ordered dispenser and pump telemetry events correlated to the refund."
                  className="refund-investigation-timeline-panel"
                  items={bundle.telemetryTimeline || []}
                  render={(item, index) => (
                    <article key={`${item.publicId || item.eventType}-${index}`} className="timeline-item refund-telemetry-item">
                      <div>
                        <strong>{item.eventType}</strong>
                        <p>{item.message || "Telemetry event captured."}</p>
                        <p>
                          Litres {item.litresValue === null ? "-" : formatNumber(item.litresValue)} ·
                          Flow {item.flowRate === null ? "-" : formatNumber(item.flowRate)}
                        </p>
                      </div>
                      <div className="timeline-meta">
                        <StatusPill value={item.severity} />
                        <time>{formatDateTime(item.happenedAt)}</time>
                      </div>
                    </article>
                  )}
                />

                <TimelineSection
                  title="Evidence Bundle"
                  subtitle="Analyst notes and derived supporting evidence linked to this case."
                  className="refund-investigation-timeline-panel"
                  items={bundle.evidenceBundle || []}
                  render={(item) => (
                    <article key={item.publicId} className="timeline-item">
                      <div>
                        <strong>{item.evidenceType}</strong>
                        <p>{item.summary}</p>
                        <p>{item.sourceType} · {item.sourceId || "Derived evidence"}</p>
                      </div>
                      <div className="timeline-meta">
                        <span>{item.confidenceWeight === null ? "-" : formatNumber(item.confidenceWeight)}</span>
                        <time>{formatDateTime(item.createdAt)}</time>
                      </div>
                    </article>
                  )}
                />
              </div>

              <div className="refund-investigation-grid refund-investigation-grid--timeline-panels">
                <TimelineSection
                  title="Review History"
                  subtitle="Support, finance, and compliance decisions made on the refund."
                  className="refund-investigation-timeline-panel"
                  items={bundle.reviews || []}
                  render={(item) => (
                    <article key={item.publicId} className="timeline-item">
                      <div>
                        <strong>{item.decision}</strong>
                        <p>{item.reviewerName} · {item.reviewerRole}</p>
                        <p>{item.notes || "No review notes."}</p>
                      </div>
                      <div className="timeline-meta">
                        <StatusPill value={item.decision} />
                        <time>{formatDateTime(item.createdAt)}</time>
                      </div>
                    </article>
                  )}
                />

                <TimelineSection
                  title="Audit History"
                  subtitle="System actions and workflow events recorded for the linked entities."
                  className="refund-investigation-timeline-panel"
                  items={bundle.auditTrail || []}
                  render={(item) => (
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
                  )}
                />

                <InvestigationSection
                  title="Add Evidence Note"
                  subtitle="Append a structured internal note to the current evidence bundle."
                  className="refund-investigation-note-panel"
                >
                  <div className="settings-profile-grid">
                    <label className="settings-form-field">
                      <span>Evidence type</span>
                      <select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} disabled={working}>
                        <option value="ATTENDANT_CONFIRMATION">Attendant confirmation</option>
                        <option value="AUDIT_EVENT">Audit event</option>
                        <option value="PAYMENT_RECORD">Payment record</option>
                        <option value="TELEMETRY_ERROR">Telemetry error</option>
                      </select>
                    </label>
                    <label className="settings-form-field">
                      <span>Evidence summary</span>
                      <textarea rows={4} value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} disabled={working} />
                    </label>
                  </div>
                  <div className="settings-form-actions refund-investigation-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={working || !evidenceSummary.trim()}
                      onClick={() =>
                        runAction(() =>
                          internalApi.attachRefundEvidence(refundPublicId, {
                            evidenceType,
                            summary: evidenceSummary,
                            sourceType: "INTERNAL_NOTE",
                          })
                        ).then(() => setEvidenceSummary(""))
                      }
                    >
                      Add Evidence Note
                    </button>
                  </div>
                </InvestigationSection>
              </div>
            </>
          ) : null}
        </div>
      </ModalFrame>
      {showFinanceApprovalConfirm ? (
        <ActionConfirmModal
          title="Compliance False Positive"
          message="This refund was previously escalated to compliance and later marked as a false positive. Continue with finance approval?"
          confirmLabel="Continue"
          cancelLabel="Cancel"
          onClose={() => setShowFinanceApprovalConfirm(false)}
          onConfirm={() => {
            setShowFinanceApprovalConfirm(false)
            runFinanceApproval()
          }}
        />
      ) : null}
    </>
  )
}

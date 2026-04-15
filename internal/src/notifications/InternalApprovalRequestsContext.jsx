import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import { formatDateTime, formatRelative } from "../utils/display"
import StatusPill from "../components/StatusPill"

const POLL_INTERVAL_MS = 5000
const DISMISSED_STORAGE_KEY = "smartlink.internal.dismissedStationApprovalRequests"

const InternalApprovalRequestsContext = createContext(null)

function readDismissedIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_STORAGE_KEY) || "[]")
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [])
  } catch {
    return new Set()
  }
}

function writeDismissedIds(ids) {
  window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]))
}

function getApprovalActionLabel(request, decision) {
  const requestType = String(request?.requestType || "").toUpperCase()
  if (requestType === "STATION_DELETE") {
    return decision === "APPROVE" ? "Approve station deletion" : "Reject deletion request"
  }
  return decision === "APPROVE" ? "Approve deactivation" : "Reject request"
}

function StationApprovalRequestModal({ request, error, onClose, onDecision, deciding }) {
  useEffect(() => {
    if (!request) return undefined

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
  }, [request, onClose])

  if (!request) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Station approval request" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{request.stationName}</h3>
            <p>{request.requestType === "STATION_DELETE" ? "Station deletion approval workflow and request detail." : "Station deactivation approval workflow and request detail."}</p>
          </div>
          <div className="internal-modal-header-actions">
            <StatusPill value={request.status} />
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          {error ? <p className="empty-cell">{error}</p> : null}
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Request</span><strong>{request.publicId}</strong></div>
            <div><span>Request Type</span><strong>{String(request.requestType || "").replace(/_/g, " ") || "-"}</strong></div>
            <div><span>Station</span><strong>{request.stationName}</strong></div>
            <div><span>City</span><strong>{request.city || "Unknown"}</strong></div>
            <div><span>Requested by</span><strong>{request.requesterName}</strong></div>
            <div><span>Role</span><strong>{request.requestedByRoleCode || "Internal user"}</strong></div>
            <div><span>Approver</span><strong>{request.ownerRoleCode || "-"}</strong></div>
            <div><span>Submitted</span><strong>{formatDateTime(request.createdAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Request summary</span>
            <strong>{request.summary}</strong>
          </div>

          <div className="admin-detail-block">
            <span>Status detail</span>
            <strong>
              {request.decision
                ? `${request.decision} ${request.decidedAt ? `on ${formatDateTime(request.decidedAt)}` : ""}`.trim()
                : `Pending review. Submitted ${formatRelative(request.createdAt)}.`}
            </strong>
          </div>

          <div className="admin-detail-block">
            <span>Actions</span>
            <div className="inline-action-group inline-action-group--row">
              {request.canApprove ? (
                <>
                  <button type="button" className="secondary-action" disabled={deciding} onClick={() => onDecision(request.publicId, "APPROVE")}>
                    {deciding ? "Working..." : getApprovalActionLabel(request, "APPROVE")}
                  </button>
                  <button type="button" className="secondary-action" disabled={deciding} onClick={() => onDecision(request.publicId, "REJECT")}>
                    {deciding ? "Working..." : getApprovalActionLabel(request, "REJECT")}
                  </button>
                </>
              ) : (
                <strong>{request.status === "OPEN" ? `Waiting for ${String(request.ownerRoleCode || "approver").replace(/_/g, " ")} review.` : "Decision recorded."}</strong>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SupportEscalationRequestModal({ request, error, onClose, onRespond, onApprove, onReject, responding }) {
  const [responseMessage, setResponseMessage] = useState("")
  const [context, setContext] = useState(null)

  useEffect(() => {
    if (!request) return undefined

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
  }, [request, onClose])

  useEffect(() => {
    if (!request?.casePublicId) {
      setContext(null)
      return
    }

    setResponseMessage("")
    setContext(null)
    internalApi
      .getSupportCaseContext(request.casePublicId)
      .then((payload) => setContext(payload || null))
      .catch(() => setContext(null))
  }, [request?.casePublicId])

  if (!request) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Escalated support ticket" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{request.subject}</h3>
            <p>Escalated support ticket assigned to {String(request.ownerRoleCode || "this role").replace(/_/g, " ").toLowerCase()}.</p>
          </div>
          <div className="internal-modal-header-actions">
            <StatusPill value={request.casePriority} />
            <StatusPill value={request.caseStatus} />
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          {error ? <p className="empty-cell">{error}</p> : null}
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Case ID</span><strong>{request.casePublicId}</strong></div>
            <div><span>Alert</span><strong>{request.alertPublicId}</strong></div>
            <div><span>Station</span><strong>{request.stationName || context?.stationProfile?.name || "Not linked"}</strong></div>
            <div><span>Customer</span><strong>{request.userName || context?.userProfile?.fullName || "Not linked"}</strong></div>
            <div><span>Category</span><strong>{request.category || "-"}</strong></div>
            <div><span>Escalated</span><strong>{formatDateTime(request.createdAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Case summary</span>
            <strong>{request.caseSummary || request.summary || "No support summary recorded."}</strong>
          </div>

          <div className="admin-detail-block">
            <span>Escalation note</span>
            <strong>{request.escalationNote || "No escalation note was added."}</strong>
          </div>

          {request.awaitingSupportDecision ? (
            <div className="admin-detail-block">
              <span>Department response</span>
              <strong>{request.responseMessage || "No response message recorded."}</strong>
            </div>
          ) : null}

          <div className="settings-summary-list admin-detail-grid">
            <div><span>User ID</span><strong>{context?.userProfile?.publicId || request.userPublicId || "-"}</strong></div>
            <div><span>Station ID</span><strong>{context?.stationProfile?.publicId || request.stationPublicId || "-"}</strong></div>
            <div><span>Email</span><strong>{context?.userProfile?.email || "-"}</strong></div>
            <div><span>Phone</span><strong>{context?.userProfile?.phone || "-"}</strong></div>
          </div>

          <div className="settings-form-card">
            {request.awaitingSupportDecision ? (
              <div className="inline-action-group inline-action-group--row">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={responding}
                  onClick={() => onApprove(request.casePublicId)}
                >
                  {responding ? "Working..." : "Approve Response"}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={responding}
                  onClick={() => onReject(request.casePublicId)}
                >
                  {responding ? "Working..." : "Reject Response"}
                </button>
              </div>
            ) : (
              <>
                <label className="settings-form-field">
                  <span>Department response</span>
                  <textarea
                    rows={5}
                    value={responseMessage}
                    onChange={(event) => setResponseMessage(event.target.value)}
                    placeholder="Write the response that should return to support for approval."
                    disabled={responding}
                  />
                </label>
                <div className="inline-action-group inline-action-group--row">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={responding || !responseMessage.trim()}
                    onClick={() => onRespond(request.alertPublicId, responseMessage)}
                  >
                    {responding ? "Sending..." : "Submit Response"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function InternalApprovalRequestsProvider({ children }) {
  const navigate = useNavigate()
  const { isAuthenticated, hasPermission, session } = useInternalAuth()
  const [requests, setRequests] = useState([])
  const [activeRequestId, setActiveRequestId] = useState(null)
  const [supportEscalations, setSupportEscalations] = useState([])
  const [walletApprovalRequests, setWalletApprovalRequests] = useState([])
  const [activeSupportAlertId, setActiveSupportAlertId] = useState(null)
  const [deciding, setDeciding] = useState(false)
  const [respondingSupport, setRespondingSupport] = useState(false)
  const [decisionError, setDecisionError] = useState("")
  const [supportError, setSupportError] = useState("")
  const knownOpenRequestIdsRef = useRef(new Set())
  const knownOpenSupportAlertIdsRef = useRef(new Set())
  const knownOpenWalletRequestIdsRef = useRef(new Set())
  const dismissedIdsRef = useRef(typeof window === "undefined" ? new Set() : readDismissedIds())

  const canUseApprovalRequests = isAuthenticated && hasPermission("stations:activate")
  const canUseWalletApprovalRequests = isAuthenticated && (
    hasPermission("wallet.refund.request")
    || hasPermission("wallet.wallet_credit.issue")
    || hasPermission("wallet.ledger.adjust")
    || hasPermission("wallet.balance.transfer")
  )
  const primaryRole = String(session?.profile?.primaryRole || "").toUpperCase()

  async function refreshRequests() {
    if (!canUseApprovalRequests) {
      setRequests([])
      return []
    }

    const payload = await internalApi.getStationDeactivationRequests()
    const nextRequests = Array.isArray(payload) ? payload : []
    setRequests(nextRequests)

    const openIds = new Set(nextRequests.filter((item) => item.status === "OPEN").map((item) => item.publicId))
    const nextDismissedIds = new Set([...dismissedIdsRef.current].filter((id) => openIds.has(id)))
    dismissedIdsRef.current = nextDismissedIds
    writeDismissedIds(nextDismissedIds)

      if (["PLATFORM_OWNER", "STATION_ONBOARDING_MANAGER"].includes(primaryRole)) {
        const newestPending = nextRequests.find(
          (item) => item.status === "OPEN"
          && item.canApprove
          && !knownOpenRequestIdsRef.current.has(item.publicId)
          && !dismissedIdsRef.current.has(item.publicId)
        )
      if (newestPending?.publicId) {
        setActiveRequestId(newestPending.publicId)
      }
    }

    knownOpenRequestIdsRef.current = openIds
    return nextRequests
  }

  async function refreshSupportEscalations() {
    if (!isAuthenticated) {
      setSupportEscalations([])
      return []
    }

    const payload = await internalApi.getSupportEscalationRequests()
    const nextEscalations = Array.isArray(payload) ? payload : []
    setSupportEscalations(nextEscalations)

    const openIds = new Set(nextEscalations.map((item) => item.alertPublicId))
    const nextDismissedIds = new Set([...dismissedIdsRef.current].filter((id) => openIds.has(id) || knownOpenRequestIdsRef.current.has(id)))
    dismissedIdsRef.current = nextDismissedIds
    writeDismissedIds(nextDismissedIds)

    const newestEscalation = nextEscalations.find(
      (item) =>
        !knownOpenSupportAlertIdsRef.current.has(item.alertPublicId)
        && !dismissedIdsRef.current.has(item.alertPublicId)
    )

    if (newestEscalation?.alertPublicId) {
      setActiveSupportAlertId(newestEscalation.alertPublicId)
    }

    knownOpenSupportAlertIdsRef.current = openIds
    return nextEscalations
  }

  async function refreshWalletApprovalRequests() {
    if (!canUseWalletApprovalRequests) {
      setWalletApprovalRequests([])
      return []
    }

    const payload = await internalApi.getWalletOperationRequests({ status: "PENDING" })
    const nextRequests = (Array.isArray(payload) ? payload : []).filter((item) => item?.canApprove)
    setWalletApprovalRequests(nextRequests)

    const openIds = new Set(nextRequests.map((item) => item.publicId))
    const nextDismissedIds = new Set(
      [...dismissedIdsRef.current].filter(
        (id) =>
          openIds.has(id)
          || knownOpenRequestIdsRef.current.has(id)
          || knownOpenSupportAlertIdsRef.current.has(id)
      )
    )
    dismissedIdsRef.current = nextDismissedIds
    writeDismissedIds(nextDismissedIds)
    knownOpenWalletRequestIdsRef.current = openIds
    return nextRequests
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setRequests([])
      setActiveRequestId(null)
      setSupportEscalations([])
      setWalletApprovalRequests([])
      setActiveSupportAlertId(null)
      return undefined
    }

    let canceled = false
    let intervalId = null

    async function load() {
      try {
        const [nextRequests, nextEscalations] = await Promise.all([
          refreshRequests(),
          refreshSupportEscalations(),
          refreshWalletApprovalRequests(),
        ])
        if (canceled) return
        if (activeRequestId && !nextRequests.some((item) => item.publicId === activeRequestId && item.status === "OPEN")) {
          setActiveRequestId(null)
        }
        if (activeSupportAlertId && !nextEscalations.some((item) => item.alertPublicId === activeSupportAlertId)) {
          setActiveSupportAlertId(null)
        }
      } catch {
        if (!canceled) {
          setRequests((previous) => previous)
          setSupportEscalations((previous) => previous)
          setWalletApprovalRequests((previous) => previous)
        }
      }
    }

    load()
    intervalId = window.setInterval(load, POLL_INTERVAL_MS)

    return () => {
      canceled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [activeRequestId, activeSupportAlertId, canUseApprovalRequests, canUseWalletApprovalRequests, isAuthenticated, primaryRole])

  const activeRequest = useMemo(
    () => requests.find((item) => item.publicId === activeRequestId) || null,
    [activeRequestId, requests]
  )

  const activeSupportEscalation = useMemo(
    () => supportEscalations.find((item) => item.alertPublicId === activeSupportAlertId) || null,
    [activeSupportAlertId, supportEscalations]
  )

  const notificationItems = useMemo(
    () =>
      [
        ...requests.map((item) => ({
          id: item.publicId,
          type: item.status === "OPEN" ? "ADMIN" : "INFO",
          title: item.title,
          body: `${item.stationName} · ${String(item.requestType || "REQUEST").replace(/_/g, " ")} · requested by ${item.requesterName}`,
          meta: item.decision ? `${item.decision} · ${formatDateTime(item.decidedAt || item.updatedAt)}` : formatRelative(item.createdAt),
          isActionable: true,
          onOpen: () => setActiveRequestId(item.publicId),
        })),
        ...supportEscalations.map((item) => ({
          id: item.alertPublicId,
          type: "ADMIN",
          title: item.title || "Escalated support ticket",
          body: `${item.subject} · ${item.stationName || "No station"} · ${item.userName || "No customer"}`,
          meta: item.awaitingSupportDecision
            ? `Awaiting support approval · ${formatRelative(item.updatedAt || item.createdAt)}`
            : `Escalated ${formatRelative(item.createdAt)}`,
          isActionable: true,
          onOpen: () => setActiveSupportAlertId(item.alertPublicId),
        })),
        ...walletApprovalRequests.map((item) => ({
          id: item.publicId,
          type: "ADMIN",
          title: `${item.operationType === "REFUND_REQUEST" ? "Wallet refund approval" : "Wallet operation approval"}`,
          body: `${item.walletPublicId} · ${item.walletOwnerName || "Unknown customer"} · ${String(item.operationType || "").replace(/_/g, " ")}`,
          meta: `Pending ${formatRelative(item.createdAt)}`,
          isActionable: true,
          onOpen: () => navigate(`/wallet-operations?walletId=${encodeURIComponent(item.walletPublicId)}`),
        })),
      ],
    [navigate, requests, supportEscalations, walletApprovalRequests]
  )

  async function decideRequest(requestPublicId, decision) {
    setDeciding(true)
    setDecisionError("")
    try {
      await internalApi.decideStationDeactivationRequest(requestPublicId, decision)
      await refreshRequests()
      setActiveRequestId(null)
    } catch (error) {
      setDecisionError(error?.message || "Failed to update station approval request")
    } finally {
      setDeciding(false)
    }
  }

  function openRequest(requestPublicId) {
    setActiveRequestId(requestPublicId)
  }

  function closeRequest(requestPublicId = activeRequestId) {
    const scopedId = String(requestPublicId || "").trim()
    if (scopedId) {
      const nextDismissedIds = new Set(dismissedIdsRef.current)
      nextDismissedIds.add(scopedId)
      dismissedIdsRef.current = nextDismissedIds
      writeDismissedIds(nextDismissedIds)
    }
    setDecisionError("")
    setActiveRequestId(null)
  }

  async function respondToSupportEscalation(alertPublicId, message) {
    setRespondingSupport(true)
    setSupportError("")
    try {
      await internalApi.respondToEscalatedSupportCase(alertPublicId, message)
      await refreshSupportEscalations()
      setActiveSupportAlertId(null)
    } catch (error) {
      setSupportError(error?.message || "Failed to respond to escalated support ticket")
    } finally {
      setRespondingSupport(false)
    }
  }

  async function decideSupportEscalation(casePublicId, action) {
    setRespondingSupport(true)
    setSupportError("")
    try {
      await internalApi.updateSupportCaseWorkflow(casePublicId, { action, note: "" })
      await refreshSupportEscalations()
      setActiveSupportAlertId(null)
    } catch (error) {
      setSupportError(error?.message || "Failed to update escalated support response")
    } finally {
      setRespondingSupport(false)
    }
  }

  function openSupportEscalation(alertPublicId) {
    setActiveSupportAlertId(alertPublicId)
  }

  function closeSupportEscalation(alertPublicId = activeSupportAlertId) {
    const scopedId = String(alertPublicId || "").trim()
    if (scopedId) {
      const nextDismissedIds = new Set(dismissedIdsRef.current)
      nextDismissedIds.add(scopedId)
      dismissedIdsRef.current = nextDismissedIds
      writeDismissedIds(nextDismissedIds)
    }
    setSupportError("")
    setActiveSupportAlertId(null)
  }

  const value = useMemo(
    () => ({
      requests,
      activeRequest,
      supportEscalations,
      walletApprovalRequests,
      activeSupportEscalation,
      notificationItems,
      refreshRequests,
      openRequest,
      closeRequest,
      openSupportEscalation,
      closeSupportEscalation,
    }),
    [activeRequest, activeSupportEscalation, notificationItems, requests, supportEscalations, walletApprovalRequests]
  )

  return (
    <InternalApprovalRequestsContext.Provider value={value}>
      {children}
      <StationApprovalRequestModal
        request={activeRequest}
        error={decisionError}
        deciding={deciding}
        onDecision={decideRequest}
        onClose={() => closeRequest()}
      />
      <SupportEscalationRequestModal
        request={activeSupportEscalation}
        error={supportError}
        responding={respondingSupport}
        onRespond={respondToSupportEscalation}
        onApprove={(casePublicId) => decideSupportEscalation(casePublicId, "APPROVE_ESCALATION_RESPONSE")}
        onReject={(casePublicId) => decideSupportEscalation(casePublicId, "REJECT_ESCALATION_RESPONSE")}
        onClose={() => closeSupportEscalation()}
      />
    </InternalApprovalRequestsContext.Provider>
  )
}

export function useInternalApprovalRequests() {
  const context = useContext(InternalApprovalRequestsContext)
  if (!context) throw new Error("useInternalApprovalRequests must be used within InternalApprovalRequestsProvider")
  return context
}

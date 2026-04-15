import { useEffect, useMemo, useRef, useState } from "react"
import Navbar from "../../components/Navbar"
import { useAuth } from "../../auth/AuthContext"
import { helpContent } from "../../data/helpContent"
import { supportApi } from "../../api/supportApi"
import { defaultSupportConfig } from "../../config/supportConfig"
import { getOfflineState, subscribeOfflineState } from "../../offline/network"
import { syncNow } from "../../offline/sync"
import QuickHelpActions from "./components/QuickHelpActions"
import HelpSearchBar from "./components/HelpSearchBar"
import HelpCategoryAccordion from "./components/HelpCategoryAccordion"
import ScenarioCards from "./components/ScenarioCards"
import SupportContacts from "./components/SupportContacts"
import ReportIssueModal from "./components/ReportIssueModal"
import "./help.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

function normalize(value) {
  return String(value || "").trim().toLowerCase()
}

function buildSearchBlob(item) {
  return [
    item.title,
    item.symptoms,
    ...(item.steps || []),
    item.escalateText,
  ]
    .join(" ")
    .toLowerCase()
}

function buildScenarioSearchBlob(item) {
  return [item.title, ...(item.checklist || [])].join(" ").toLowerCase()
}

function formatTicketDate(value) {
  if (!value) return "Not available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not available"
  return date.toLocaleString()
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return "Amount pending"
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "MWK",
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatReasonCode(value) {
  const parts = String(value || "").trim().toLowerCase().split("_").filter(Boolean)
  if (!parts.length) return "Refund request"
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

function SupportTicketDetailModal({ ticket, onClose }) {
  if (!ticket) return null

  return (
    <div className="help-v1-modal-backdrop" onClick={onClose}>
      <div className="help-v1-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h4>{ticket.title}</h4>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="help-v1-modal-body help-v1-ticket-detail">
          <div className="help-v1-ticket-meta">
            <span>{ticket.id}</span>
            <strong>{ticket.status}</strong>
          </div>
          <p>{ticket.description}</p>
          <div className="help-v1-ticket-grid">
            <div><span>Category</span><strong>{ticket.category}</strong></div>
            <div><span>Severity</span><strong>{ticket.severity}</strong></div>
            <div><span>Submitted</span><strong>{formatTicketDate(ticket.createdAt)}</strong></div>
            <div><span>Last update</span><strong>{formatTicketDate(ticket.updatedAt)}</strong></div>
          </div>
          <div className="help-v1-ticket-response">
            <span>Support response</span>
            {ticket.responseMessage ? (
              <>
                <strong>{ticket.responderName ? `From ${ticket.responderName}` : "From support"}</strong>
                <p>{ticket.responseMessage}</p>
                <small>{ticket.respondedAt ? `Sent ${formatTicketDate(ticket.respondedAt)}` : ""}</small>
              </>
            ) : (
              <strong>Support has not replied yet.</strong>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GetHelpPage() {
  const { session } = useAuth()
  const [query, setQuery] = useState("")
  const [offlineState, setOfflineState] = useState(getOfflineState())
  const [supportConfig, setSupportConfig] = useState(defaultSupportConfig)
  const [tickets, setTickets] = useState([])
  const [refundRequests, setRefundRequests] = useState([])
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState("")
  const categorySectionRef = useRef(null)

  useEffect(() => {
    supportApi.getConfig().then(setSupportConfig).catch(() => setSupportConfig(defaultSupportConfig))
  }, [])

  async function loadSupportItems() {
    const [ticketsResult, refundsResult] = await Promise.allSettled([
      supportApi.getTickets(),
      supportApi.getRefundRequests(),
    ])

    setTickets(
      ticketsResult.status === "fulfilled" && Array.isArray(ticketsResult.value)
        ? ticketsResult.value
        : []
    )
    setRefundRequests(
      refundsResult.status === "fulfilled" && Array.isArray(refundsResult.value)
        ? refundsResult.value
        : []
    )
  }

  useEffect(() => {
    loadSupportItems()
  }, [])

  useEffect(() => subscribeOfflineState(setOfflineState), [])

  const filteredCategories = useMemo(() => {
    const q = normalize(query)
    if (!q) return helpContent.categories

    return helpContent.categories
      .map((category) => {
        const filteredItems = category.items.filter((item) => {
          const haystack = `${category.title} ${buildSearchBlob(item)}`
          return haystack.includes(q)
        })
        return {
          ...category,
          items: filteredItems,
        }
      })
      .filter((category) => category.items.length > 0)
  }, [query])

  const filteredScenarios = useMemo(() => {
    const q = normalize(query)
    if (!q) return helpContent.scenarios
    return helpContent.scenarios.filter((scenario) => buildScenarioSearchBlob(scenario).includes(q))
  }, [query])

  function showFeedback(message) {
    setFeedback(message)
    window.clearTimeout(showFeedback.timerId)
    showFeedback.timerId = window.setTimeout(() => setFeedback(""), 2500)
  }
  showFeedback.timerId = showFeedback.timerId || 0

  async function submitIssue(payload) {
    setError("")
    const created = await supportApi.createTicket(payload)
    await loadSupportItems()
    showFeedback(`We received your report. Ticket ID: ${created.id}`)
    return created
  }

  function handleOfflineProcedure() {
    setQuery("offline")
    categorySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  async function handleRetrySync() {
    setError("")
    const result = await syncNow({ force: true }).catch(() => ({ healthy: false }))
    if (!result?.healthy) {
      setError("Unable to reach server for sync retry.")
      return
    }

    const ackedCount = Array.isArray(result?.ackedEventIds) ? result.ackedEventIds.length : 0
    const failedCount = Number(result?.failedCount || 0)
    if (failedCount > 0) {
      const reason = result?.lastError ? `: ${result.lastError}` : "."
      setError(`Sync retry failed for ${failedCount} event(s)${reason}`)
      return
    }
    if (ackedCount > 0) {
      showFeedback(`Synced ${ackedCount} pending event(s).`)
      return
    }
    showFeedback("No pending offline events to sync.")
  }

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  )

  return (
    <div className="help-v1-page">
      <Navbar pagetitle="Get Help" image={avatar} />
      <section className="help-v1-shell">
        <QuickHelpActions
          supportConfig={supportConfig}
          offlineState={offlineState}
          onOpenReportIssue={() => setReportOpen(true)}
          onRetrySync={handleRetrySync}
          onViewOfflineProcedure={handleOfflineProcedure}
        />
        <HelpSearchBar value={query} onChange={setQuery} />

        {feedback ? <p className="help-v1-feedback-ok">{feedback}</p> : null}
        {error ? <p className="help-v1-feedback-error">{error}</p> : null}

        <section className="help-v1-panel">
          <div className="help-v1-ticket-head">
            <h3>Refund Requests</h3>
            <span>{refundRequests.length} tracked</span>
          </div>
          {refundRequests.length ? (
            <div className="help-v1-ticket-list">
              {refundRequests.map((refund) => (
                <article key={refund.publicId} className="help-v1-ticket-card">
                  <div className="help-v1-ticket-meta">
                    <span>{refund.publicId}</span>
                    <strong>{refund.status || "PENDING"}</strong>
                  </div>
                  <h4>{formatReasonCode(refund.reasonCode)}</h4>
                  <p>{refund.resolutionNotes || refund.userStatement || "Your refund request is being reviewed by support."}</p>
                  <div className="help-v1-ticket-grid">
                    <div><span>Amount</span><strong>{formatMoney(refund.amountMwk)}</strong></div>
                    <div><span>Station</span><strong>{refund.stationName || "Assigned station"}</strong></div>
                    <div><span>Transaction</span><strong>{refund.transactionPublicId || "Pending link"}</strong></div>
                    <div><span>Requested</span><strong>{formatTicketDate(refund.requestedAt)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="help-v1-empty">No refund requests have been submitted for your account yet.</p>
          )}
        </section>

        <section className="help-v1-panel">
          <div className="help-v1-ticket-head">
            <h3>Recent Support Tickets</h3>
            <span>{tickets.length} tracked</span>
          </div>
          {tickets.length ? (
            <div className="help-v1-ticket-list">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="help-v1-ticket-card">
                  <div className="help-v1-ticket-meta">
                    <span>{ticket.id}</span>
                    <strong>{ticket.status}</strong>
                  </div>
                  <h4>{ticket.title}</h4>
                  <p>{ticket.responseMessage ? ticket.responseMessage : ticket.description}</p>
                  <div className="help-v1-ticket-actions">
                    <small>{formatTicketDate(ticket.createdAt)}</small>
                    <button type="button" onClick={() => setSelectedTicketId(ticket.id)}>
                      Open
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="help-v1-empty">No support tickets yet for this station view.</p>
          )}
        </section>

        <div ref={categorySectionRef}>
          <HelpCategoryAccordion categories={filteredCategories} />
        </div>
        <ScenarioCards scenarios={filteredScenarios} />
        <SupportContacts config={supportConfig} />
      </section>

      <ReportIssueModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitIssue}
        stationId={session?.station?.publicId}
        userId={session?.user?.publicId}
        lastSyncAt={offlineState.lastSyncAt}
        appBuild={import.meta.env.VITE_APP_VERSION || import.meta.env.MODE}
      />
      <SupportTicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicketId(null)} />
    </div>
  )
}

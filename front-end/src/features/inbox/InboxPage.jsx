import { useEffect, useMemo, useState } from "react"
import Navbar from "../../components/Navbar"
import { useAuth } from "../../auth/AuthContext"
import { supportApi } from "../../api/supportApi"
import { defaultSupportConfig } from "../../config/supportConfig"
import { getOfflineState, subscribeOfflineState } from "../../offline/network"
import ReportIssueModal from "../help/components/ReportIssueModal"
import SupportContacts from "../help/components/SupportContacts"
import "../help/help.css"
import "./inbox.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

function formatDateTime(value) {
  if (!value) return "Not available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not available"
  return date.toLocaleString()
}

function toSeverityClass(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "CRITICAL" || normalized === "HIGH") return "critical"
  if (normalized === "MEDIUM" || normalized === "WARNING") return "warning"
  return "normal"
}

function isOpenTicket(ticket) {
  const caseStatus = String(ticket?.caseStatus || "").trim().toUpperCase()
  if (caseStatus) return caseStatus !== "RESOLVED"
  return String(ticket?.status || "").trim().toUpperCase() !== "RESPONDED"
}

function SupportConversationModal({
  ticket,
  thread,
  loading,
  error,
  draftMessage,
  onDraftChange,
  onSend,
  sending,
  onClose,
}) {
  if (!ticket) return null
  const conversationOpen = isOpenTicket(ticket)

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
            <div><span>Submitted</span><strong>{formatDateTime(ticket.createdAt)}</strong></div>
            <div><span>Last update</span><strong>{formatDateTime(ticket.updatedAt)}</strong></div>
          </div>
          <div className="inbox-conversation-thread">
            <span>Conversation</span>
            {loading ? <p>Loading conversation...</p> : null}
            {error ? <p className="help-v1-error">{error}</p> : null}
            {!loading && !error && Array.isArray(thread) && thread.length ? (
              <div className="inbox-thread-list">
                {thread.map((item) => (
                  <article
                    key={item.publicId}
                    className={`inbox-thread-item ${String(item.senderScope || "").toUpperCase() === "SUPPORT" ? "support" : "station"}`}
                  >
                    <div className="inbox-thread-meta">
                      <strong>{item.senderName || item.senderRoleCode || item.senderScope || "Support"}</strong>
                      <small>{formatDateTime(item.createdAt)}</small>
                    </div>
                    {item.title ? <h5>{item.title}</h5> : null}
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {!loading && !error && !thread.length ? <p>No conversation messages yet.</p> : null}
          </div>

          {conversationOpen ? (
            <div className="inbox-conversation-compose">
              <span>Reply to support</span>
              <textarea
                rows={4}
                value={draftMessage}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="Write the update or question you want support to see."
              />
              <div className="help-v1-form-actions">
                <button type="button" onClick={onClose}>Close</button>
                <button type="button" disabled={sending || !draftMessage.trim()} onClick={onSend}>
                  {sending ? "Sending..." : "Send Message"}
                </button>
              </div>
            </div>
          ) : (
            <div className="help-v1-ticket-response">
              <span>Status</span>
              <strong>This support conversation is closed.</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function InboxPage() {
  const { session } = useAuth()
  const canContactSupport = ["MANAGER", "ATTENDANT"].includes(String(session?.role || "").toUpperCase())
  const [offlineState, setOfflineState] = useState(getOfflineState())
  const [supportConfig, setSupportConfig] = useState(defaultSupportConfig)
  const [messages, setMessages] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [reportOpen, setReportOpen] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [ticketThread, setTicketThread] = useState([])
  const [ticketThreadLoading, setTicketThreadLoading] = useState(false)
  const [ticketThreadError, setTicketThreadError] = useState("")
  const [ticketDraftMessage, setTicketDraftMessage] = useState("")
  const [sendingTicketMessage, setSendingTicketMessage] = useState(false)

  useEffect(() => subscribeOfflineState(setOfflineState), [])

  useEffect(() => {
    async function loadInbox() {
      try {
        setLoading(true)
        setError("")
        let nextError = ""
        const [inboxResult, configResult, ticketsResult] = await Promise.allSettled([
          supportApi.getInbox(),
          supportApi.getConfig(),
          canContactSupport ? supportApi.getTickets() : Promise.resolve([]),
        ])

        if (inboxResult.status === "fulfilled") {
          setMessages(Array.isArray(inboxResult.value?.messages) ? inboxResult.value.messages : [])
        } else {
          setMessages([])
          nextError = inboxResult.reason?.message || "Unable to load admin messages"
        }

        if (configResult.status === "fulfilled") {
          setSupportConfig({
            ...defaultSupportConfig,
            ...(configResult.value || {}),
          })
        } else {
          setSupportConfig(defaultSupportConfig)
        }

        if (ticketsResult.status === "fulfilled") {
          setTickets(Array.isArray(ticketsResult.value) ? ticketsResult.value : [])
        } else {
          setTickets([])
        }

        if (nextError) setError(nextError)
      } finally {
        setLoading(false)
      }
    }

    loadInbox()
  }, [canContactSupport])

  function showFeedback(message) {
    setFeedback(message)
    window.clearTimeout(showFeedback.timerId)
    showFeedback.timerId = window.setTimeout(() => setFeedback(""), 2400)
  }
  showFeedback.timerId = showFeedback.timerId || 0

  async function submitIssue(payload) {
    setError("")
    const created = await supportApi.createTicket(payload)
    const nextTickets = await supportApi.getTickets().catch(() => tickets)
    setTickets(Array.isArray(nextTickets) ? nextTickets : [])
    showFeedback(`Support request submitted. Ticket ID: ${created.id}`)
    return created
  }

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  )

  const openTickets = useMemo(
    () => tickets.filter((ticket) => isOpenTicket(ticket)),
    [tickets]
  )

  useEffect(() => {
    if (!selectedTicketId) {
      setTicketThread([])
      setTicketThreadError("")
      setTicketDraftMessage("")
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        setTicketThreadLoading(true)
        setTicketThreadError("")
        const thread = await supportApi.getTicketMessages(selectedTicketId)
        if (cancelled) return
        setTicketThread(Array.isArray(thread?.messages) ? thread.messages : [])
      } catch (threadError) {
        if (cancelled) return
        setTicketThread([])
        setTicketThreadError(threadError?.message || "Unable to load ticket conversation")
      } finally {
        if (!cancelled) setTicketThreadLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedTicketId])

  async function sendTicketMessage() {
    if (!selectedTicketId) return
    try {
      setSendingTicketMessage(true)
      setTicketThreadError("")
      const result = await supportApi.sendTicketMessage(selectedTicketId, ticketDraftMessage)
      setTicketThread(Array.isArray(result?.thread?.messages) ? result.thread.messages : [])
      setTicketDraftMessage("")
      const nextTickets = await supportApi.getTickets().catch(() => tickets)
      setTickets(Array.isArray(nextTickets) ? nextTickets : [])
      showFeedback("Message sent to support.")
    } catch (sendError) {
      setTicketThreadError(sendError?.message || "Unable to send message to support")
    } finally {
      setSendingTicketMessage(false)
    }
  }

  const navbarAlerts = useMemo(
    () =>
      (messages || [])
        .filter((item) => String(item.status || "").toUpperCase() !== "RESOLVED")
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          type: String(item.severity || "INFO").toUpperCase(),
          title: item.title,
          body: item.body,
          meta: item.createdAt ? formatDateTime(item.createdAt) : item.senderRole,
        })),
    [messages]
  )

  return (
    <div className="inbox-page">
      <Navbar
        pagetitle="Inbox"
        image={avatar}
        alerts={navbarAlerts}
        count={navbarAlerts.length}
      />

      <section className="inbox-shell">
        <section className="inbox-hero">
          <div>
            <p className="inbox-eyebrow">Station communication</p>
            <h2>{session?.station?.name || "Station"} inbox</h2>
            <p>
              Read admin updates for your station and contact support from one place.
            </p>
          </div>
          <div className="inbox-hero-status">
            <span>{messages.length} admin message{messages.length === 1 ? "" : "s"}</span>
            <strong>{offlineState.network}</strong>
          </div>
        </section>

        {feedback ? <p className="help-v1-feedback-ok">{feedback}</p> : null}
        {error ? <p className="help-v1-feedback-error">{error}</p> : null}

        <div className="inbox-layout">
          <section className="help-v1-panel inbox-panel">
            <div className="inbox-section-head">
              <div>
                <h3>Admin Messages</h3>
                <p>Operational updates and escalations sent to this station.</p>
              </div>
            </div>

            {loading ? (
              <div className="inbox-message-list">
                {Array.from({ length: 3 }).map((_, index) => (
                  <article key={`skeleton-${index}`} className="inbox-message-card inbox-message-card-skeleton">
                    <span />
                    <span />
                    <span />
                  </article>
                ))}
              </div>
            ) : messages.length ? (
              <div className="inbox-message-list">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`inbox-message-card ${toSeverityClass(message.severity)}`}
                  >
                    <div className="inbox-message-meta">
                      <span>{message.senderName || message.senderRole || "Platform Admin"}</span>
                      <strong>{message.severity}</strong>
                    </div>
                    <h4>{message.title}</h4>
                    <p>{message.body}</p>
                    <div className="inbox-message-footer">
                      <small>{formatDateTime(message.createdAt)}</small>
                      <small>{message.status}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="inbox-empty">No admin messages for this station yet.</p>
            )}
          </section>

          <div className="inbox-side">
            <section className="help-v1-panel inbox-panel">
              <div className="inbox-section-head">
                <div>
                  <h3>Contact Support</h3>
                  <p>Raise an issue for SmartLink support and continue the conversation while the ticket is open.</p>
                </div>
                {canContactSupport ? (
                  <button type="button" className="inbox-primary-btn" onClick={() => setReportOpen(true)}>
                    New Support Ticket
                  </button>
                ) : null}
              </div>

              {!canContactSupport ? (
                <p className="inbox-empty">Support requests are available for manager and attendant accounts only.</p>
              ) : openTickets.length ? (
                <div className="inbox-ticket-list">
                  {openTickets.slice(0, 8).map((ticket) => (
                    <article key={ticket.id} className="inbox-ticket-card">
                      <div className="inbox-message-meta">
                        <span>{ticket.id}</span>
                        <strong>{ticket.status}</strong>
                      </div>
                      <h4>{ticket.title}</h4>
                      <p>{ticket.responseMessage || ticket.description}</p>
                      <div className="inbox-ticket-actions">
                        <small>{formatDateTime(ticket.createdAt)}</small>
                        <button type="button" onClick={() => setSelectedTicketId(ticket.id)}>
                          Open Chat
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="inbox-empty">No open support conversations right now. Open a ticket when the station needs help.</p>
              )}
            </section>

            <SupportContacts config={supportConfig} />
          </div>
        </div>
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
      <SupportConversationModal
        ticket={selectedTicket}
        thread={ticketThread}
        loading={ticketThreadLoading}
        error={ticketThreadError}
        draftMessage={ticketDraftMessage}
        onDraftChange={setTicketDraftMessage}
        onSend={sendTicketMessage}
        sending={sendingTicketMessage}
        onClose={() => setSelectedTicketId(null)}
      />
    </div>
  )
}

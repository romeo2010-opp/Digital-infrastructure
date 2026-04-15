import { useCallback, useEffect, useMemo, useState } from 'react'
import { userQueueApi } from '../api/userQueueApi'
import { queueMockService } from '../queueMockService'
import { formatDateTime } from '../dateTime'

function normalizeTicketRow(row, index = 0) {
  const id = String(row?.id || `support-${index}`).trim() || `support-${index}`
  const status = String(row?.caseStatus || row?.status || 'OPEN').trim().toUpperCase()
  const severity = String(row?.casePriority || row?.severity || 'MEDIUM').trim().toUpperCase()

  return {
    id,
    title: String(row?.title || 'Support request').trim() || 'Support request',
    description: String(row?.description || '').trim(),
    category: String(row?.category || 'General').trim(),
    status,
    severity,
    stationName: String(row?.stationName || '').trim() || 'Station',
    stationPublicId: String(row?.stationPublicId || '').trim() || null,
    createdAt: row?.createdAt || row?.created_at || null,
    updatedAt: row?.updatedAt || row?.updated_at || null,
    responseMessage: String(row?.responseMessage || '').trim() || null,
    respondedAt: row?.respondedAt || row?.responded_at || null,
    responderName: String(row?.responderName || '').trim() || null,
    casePublicId: String(row?.casePublicId || '').trim() || null,
  }
}

function supportStatusLabel(status) {
  const normalized = String(status || '').trim().toUpperCase()
  if (normalized === 'WAITING_ON_USER') return 'Waiting on you'
  if (normalized === 'IN_PROGRESS') return 'In progress'
  if (normalized === 'RESPONDED') return 'Responded'
  if (normalized === 'RESOLVED') return 'Resolved'
  if (normalized === 'ESCALATED') return 'Escalated'
  return 'Open'
}

export function HelpScreen() {
  const supportData = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : queueMockService), [])
  const [config, setConfig] = useState(null)
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextTickets] = await Promise.all([
        typeof supportData.getSupportConfig === 'function' ? supportData.getSupportConfig({ signal }) : Promise.resolve({}),
        typeof supportData.getSupportTickets === 'function' ? supportData.getSupportTickets({ signal }) : Promise.resolve([]),
      ])
      const rows = Array.isArray(nextTickets) ? nextTickets : Array.isArray(nextTickets?.items) ? nextTickets.items : []
      setConfig(nextConfig || {})
      setTickets(rows.map(normalizeTicketRow))
    } catch (requestError) {
      if (signal?.aborted) return
      setError(requestError?.message || 'Unable to load support requests.')
      setConfig(null)
      setTickets([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [supportData])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  return (
    <section className='help-screen'>
      <header className='screen-header'>
        <h2>Help</h2>
        <p>{loading ? 'Loading…' : `${tickets.length} support request${tickets.length === 1 ? '' : 's'}`}</p>
      </header>

      <section className='station-card help-contact-card'>
        <h3>Contact support</h3>
        <p>Support updates will appear here when your request is under review, waiting on you, or resolved.</p>
        <div className='help-contact-grid'>
          <div>
            <span>Phone</span>
            <strong>{config?.phone || '-'}</strong>
          </div>
          <div>
            <span>WhatsApp</span>
            <strong>{config?.whatsapp || '-'}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{config?.email || '-'}</strong>
          </div>
          <div>
            <span>Hours</span>
            <strong>{config?.hours || '-'}</strong>
          </div>
        </div>
      </section>

      {error ? (
        <section className='station-card coming-soon'>
          <h3>Unable to load support</h3>
          <p>{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className='station-card coming-soon'>
          <h3>Loading support requests</h3>
          <p>Fetching your current and past help cases.</p>
        </section>
      ) : null}

      {!loading && !error && tickets.length ? (
        <div className='help-ticket-list'>
          {tickets.map((ticket) => (
            <article key={ticket.id} className='station-card help-ticket-card'>
              <div className='station-card-top'>
                <div>
                  <h3>{ticket.title}</h3>
                  <p>{ticket.stationName}</p>
                </div>
                <div className='help-ticket-badges'>
                  <span className={`help-ticket-pill is-${ticket.severity.toLowerCase()}`}>{ticket.severity}</span>
                  <span className='help-ticket-pill is-status'>{supportStatusLabel(ticket.status)}</span>
                </div>
              </div>
              <p>{ticket.description || 'No extra details were provided for this request.'}</p>
              <div className='station-meta split'>
                <span>{ticket.category}</span>
                <span>{formatDateTime(ticket.createdAt)}</span>
              </div>
              {ticket.responseMessage ? (
                <div className='help-ticket-response'>
                  <strong>{ticket.responderName ? `Reply from ${ticket.responderName}` : 'Support reply'}</strong>
                  <p>{ticket.responseMessage}</p>
                </div>
              ) : (
                <div className='help-ticket-response is-pending'>
                  <strong>Current update</strong>
                  <p>
                    {ticket.status === 'IN_PROGRESS'
                      ? 'A support agent is currently reviewing this request.'
                      : ticket.status === 'WAITING_ON_USER'
                        ? 'Support is waiting on more information from you.'
                        : ticket.status === 'ESCALATED'
                          ? 'This request has been escalated for deeper review.'
                          : 'Your request has been received and queued for review.'}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && !tickets.length ? (
        <section className='station-card coming-soon'>
          <h3>No support requests yet</h3>
          <p>Issues you report from queue or reservation flows will appear here for follow-up.</p>
        </section>
      ) : null}
    </section>
  )
}

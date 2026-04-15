import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { userQueueApi } from '../api/userQueueApi'
import { queueMockService } from '../queueMockService'
import { formatDateTime } from '../dateTime'
import { maskPublicId } from '../../utils/masking'

const ALERTS_RECONNECT_BACKOFF_MS = [1200, 2500, 5000, 9000, 15000]

function normalizeAlert(item, index = 0) {
  const publicId = String(item?.publicId || item?.id || `alert-${index}`).trim() || `alert-${index}`
  const createdAt = item?.createdAt || item?.created_at || new Date().toISOString()
  const readAt = item?.readAt || item?.read_at || null
  const archivedAt = item?.archivedAt || item?.archived_at || null
  const statusRaw = String(item?.status || (readAt ? 'READ' : 'UNREAD')).trim().toUpperCase()
  const title = String(item?.title || 'Alert').trim() || 'Alert'
  const message = String(item?.message || item?.body || '').trim() || 'You have a new alert.'
  const category = String(item?.category || 'SYSTEM').trim().toUpperCase()
  const station = item?.station || {}
  const stationName = String(station?.name || item?.stationName || '').trim()
  const stationArea = String(station?.area || item?.stationArea || '').trim()
  const reservationPublicId = String(item?.reservationPublicId || '').trim() || null
  const archivedReason = String(item?.archivedReason || item?.archived_reason || '').trim() || null
  const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}

  return {
    publicId,
    title,
    message,
    category,
    status: statusRaw === 'READ' ? 'READ' : 'UNREAD',
    isRead: statusRaw === 'READ',
    createdAt,
    readAt,
    archivedAt,
    archivedReason,
    stationName,
    stationArea,
    reservationPublicId,
    metadata,
  }
}

function sortAlertsNewest(a, b) {
  const timeA = new Date(a?.archivedAt || a?.createdAt || 0).getTime()
  const timeB = new Date(b?.archivedAt || b?.createdAt || 0).getTime()
  return timeB - timeA
}

function upsertAlert(list, incoming) {
  const normalizedIncoming = normalizeAlert(incoming)
  const next = Array.isArray(list) ? [...list] : []
  const index = next.findIndex((item) => item.publicId === normalizedIncoming.publicId)
  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...normalizedIncoming,
    }
  } else {
    next.unshift(normalizedIncoming)
  }
  return next.sort(sortAlertsNewest)
}

export function AlertsScreen() {
  const alertsData = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : queueMockService), [])
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(0)
  const unsubscribeSocketRef = useRef(() => {})

  const [alerts, setAlerts] = useState([])
  const [archivedAlerts, setArchivedAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [error, setError] = useState('')
  const [archiveError, setArchiveError] = useState('')
  const [busyState, setBusyState] = useState({ alertId: '', action: '' })
  const [isConnected, setIsConnected] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const unreadCount = useMemo(() => alerts.reduce((sum, item) => sum + (item.isRead ? 0 : 1), 0), [alerts])

  const disconnectSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = 0
    }
    if (typeof unsubscribeSocketRef.current === 'function') {
      unsubscribeSocketRef.current()
    }
    unsubscribeSocketRef.current = () => {}
    setIsConnected(false)
    setIsReconnecting(false)
  }, [])

  const loadAlerts = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    try {
      if (typeof alertsData.getAlerts !== 'function') {
        setAlerts([])
        return
      }
      const payload = await alertsData.getAlerts({ signal })
      const rows = Array.isArray(payload?.items) ? payload.items : []
      setAlerts(rows.map((item, index) => normalizeAlert(item, index)).sort(sortAlertsNewest))
    } catch (requestError) {
      if (signal?.aborted) return
      setAlerts([])
      setError(requestError?.message || 'Unable to load alerts.')
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [alertsData])

  const loadArchivedAlerts = useCallback(async ({ signal } = {}) => {
    setArchiveLoading(true)
    setArchiveError('')
    try {
      if (typeof alertsData.getArchivedAlerts !== 'function') {
        setArchivedAlerts([])
        return
      }
      const payload = await alertsData.getArchivedAlerts({ signal, limit: 200 })
      const rows = Array.isArray(payload?.items) ? payload.items : []
      setArchivedAlerts(rows.map((item, index) => normalizeAlert(item, index)).sort(sortAlertsNewest))
    } catch (requestError) {
      if (signal?.aborted) return
      setArchivedAlerts([])
      setArchiveError(requestError?.message || 'Unable to load archived alerts.')
    } finally {
      if (!signal?.aborted) {
        setArchiveLoading(false)
      }
    }
  }, [alertsData])

  useEffect(() => {
    const controller = new AbortController()
    loadAlerts({ signal: controller.signal })
    return () => {
      controller.abort()
    }
  }, [loadAlerts])

  useEffect(() => {
    if (!archiveOpen) return undefined
    const controller = new AbortController()
    loadArchivedAlerts({ signal: controller.signal })
    return () => {
      controller.abort()
    }
  }, [archiveOpen, loadArchivedAlerts])

  useEffect(() => {
    if (typeof alertsData.connectUserAlertsSocket !== 'function') return undefined

    let mounted = true

    const connect = () => {
      if (!mounted) return
      try {
        const unsubscribe = alertsData.connectUserAlertsSocket({
          onOpen: () => {
            if (!mounted) return
            reconnectAttemptRef.current = 0
            setIsConnected(true)
            setIsReconnecting(false)
            setIsStale(false)
          },
          onClose: () => {
            if (!mounted) return
            setIsConnected(false)
            setIsStale(true)
            const attempt = reconnectAttemptRef.current
            const delay = ALERTS_RECONNECT_BACKOFF_MS[Math.min(attempt, ALERTS_RECONNECT_BACKOFF_MS.length - 1)]
            reconnectAttemptRef.current = attempt + 1
            setIsReconnecting(true)
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = 0
              connect()
            }, delay)
          },
          onError: () => {
            if (!mounted) return
            setIsConnected(false)
            setIsStale(true)
          },
          onMessage: (message) => {
            if (!mounted || !message || typeof message !== 'object') return
            if (message.type === 'user_alert:new' && message.data) {
              setAlerts((current) => upsertAlert(current, message.data))
              return
            }
            if (message.type === 'user_alert:read' && message.data?.publicId) {
              const readId = String(message.data.publicId).trim()
              const readAt = message.data.readAt || new Date().toISOString()
              setAlerts((current) =>
                current.map((item) =>
                  item.publicId === readId
                    ? { ...item, isRead: true, status: 'READ', readAt }
                    : item,
                  ),
              )
              return
            }
            if (message.type === 'user_alert:archived' && message.data?.publicId) {
              const archivedId = String(message.data.publicId).trim()
              setAlerts((current) => current.filter((item) => item.publicId !== archivedId))
            }
          },
        })
        unsubscribeSocketRef.current = unsubscribe
      } catch {
        setIsConnected(false)
        setIsStale(true)
      }
    }

    connect()

    return () => {
      mounted = false
      disconnectSocket()
    }
  }, [alertsData, disconnectSocket])

  const markAsRead = useCallback(async (publicId) => {
    const scopedId = String(publicId || '').trim()
    if (!scopedId) return
    const target = alerts.find((item) => item.publicId === scopedId)
    if (!target || target.isRead) return
    if (typeof alertsData.markAlertRead !== 'function') {
      setAlerts((current) =>
        current.map((item) =>
          item.publicId === scopedId
            ? { ...item, isRead: true, status: 'READ', readAt: new Date().toISOString() }
            : item,
        ),
      )
      return
    }

    setBusyState({ alertId: scopedId, action: 'read' })
    setError('')
    try {
      const payload = await alertsData.markAlertRead(scopedId)
      const alert = payload?.alert || null
      if (alert) {
        setAlerts((current) => upsertAlert(current, alert))
      } else {
        setAlerts((current) =>
          current.map((item) =>
            item.publicId === scopedId
              ? { ...item, isRead: true, status: 'READ', readAt: new Date().toISOString() }
              : item,
          ),
        )
      }
    } catch (requestError) {
      setError(requestError?.message || 'Failed to update alert.')
    } finally {
      setBusyState({ alertId: '', action: '' })
    }
  }, [alerts, alertsData])

  const archiveAlert = useCallback(async (publicId) => {
    const scopedId = String(publicId || '').trim()
    if (!scopedId) return
    const target = alerts.find((item) => item.publicId === scopedId)
    if (!target) return

    if (typeof alertsData.archiveAlert !== 'function') {
      setAlerts((current) => current.filter((item) => item.publicId !== scopedId))
      return
    }

    setBusyState({ alertId: scopedId, action: 'archive' })
    setError('')
    try {
      await alertsData.archiveAlert(scopedId)
      setAlerts((current) => current.filter((item) => item.publicId !== scopedId))
      setArchivedAlerts((current) => {
        const nextItem = normalizeAlert({
          ...target,
          status: 'READ',
          isRead: true,
          archivedAt: new Date().toISOString(),
          archivedReason: 'USER_ACTION',
        })
        return upsertAlert(current, nextItem)
      })
    } catch (requestError) {
      setError(requestError?.message || 'Failed to archive alert.')
    } finally {
      setBusyState({ alertId: '', action: '' })
    }
  }, [alerts, alertsData])

  const isBusy = useCallback(
    (alertId, action = '') => busyState.alertId === alertId && (!action || busyState.action === action),
    [busyState]
  )

  return (
    <section className='alerts-screen'>
      <header className='screen-header screen-header--with-action'>
        <div>
          <h2>Alerts</h2>
          <p>{loading ? 'Loading…' : `${unreadCount} unread`}</p>
        </div>
        <button
          type='button'
          className='archive-toggle-button'
          aria-label='Open archived alerts'
          onClick={() => setArchiveOpen(true)}
        >
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <path d='M4 5h16v4H4zM6 11h12v8H6zM10 14h4' />
          </svg>
        </button>
      </header>

      {isReconnecting ? (
        <section className='queue-reconnect-banner'>Reconnecting live alerts…</section>
      ) : null}
      {isStale && !isConnected ? (
        <section className='queue-stale-banner'>Showing last known alerts.</section>
      ) : null}

      {error ? (
        <section className='station-card coming-soon'>
          <h3>Unable to load alerts</h3>
          <p>{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className='station-card coming-soon'>
          <h3>Loading alerts</h3>
          <p>Fetching your latest station notifications.</p>
        </section>
      ) : null}

      {!loading && !error && alerts.length ? (
        <div className='alerts-list'>
          {alerts.map((alert) => (
            <article
              key={alert.publicId}
              className={`alert-card ${alert.isRead ? 'is-read' : 'is-unread'}`}
            >
              <div className='alert-card-top'>
                <h3>{alert.title}</h3>
                <span className={`alert-pill ${alert.isRead ? 'is-read' : 'is-unread'}`}>
                  {alert.isRead ? 'Read' : 'New'}
                </span>
              </div>

              <p className='alert-message'>{alert.message}</p>

              <div className='alert-meta-row'>
                <span>{formatDateTime(alert.createdAt, undefined, '—')}</span>
                {alert.stationName ? (
                  <strong>
                    {alert.stationName}
                    {alert.stationArea ? ` · ${alert.stationArea}` : ''}
                  </strong>
                ) : null}
              </div>

              {alert.reservationPublicId ? (
                <div className='alert-meta-row'>
                  <span>Reservation</span>
                  <strong>{maskPublicId(alert.reservationPublicId, { prefix: 4, suffix: 4 })}</strong>
                </div>
              ) : null}

              <div className='alert-action-row'>
                {!alert.isRead ? (
                  <button
                    type='button'
                    className='details-action-button is-primary'
                    onClick={() => markAsRead(alert.publicId)}
                    disabled={busyState.alertId === alert.publicId}
                  >
                    {isBusy(alert.publicId, 'read') ? 'Updating…' : 'Mark as read'}
                  </button>
                ) : null}
                <button
                  type='button'
                  className='details-action-button is-secondary'
                  onClick={() => archiveAlert(alert.publicId)}
                  disabled={busyState.alertId === alert.publicId}
                >
                  {isBusy(alert.publicId, 'archive') ? 'Archiving…' : 'Archive'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && !alerts.length ? (
        <section className='station-card coming-soon'>
          <h3>No alerts</h3>
          <p>Manager notifications and updates will appear here in real time.</p>
        </section>
      ) : null}

      {archiveOpen ? (
        <div className='archive-modal-backdrop' role='dialog' aria-modal='true' aria-label='Archived alerts' onClick={() => setArchiveOpen(false)}>
          <div className='archive-modal' onClick={(event) => event.stopPropagation()}>
            <header className='archive-modal-header'>
              <div>
                <h3>Archived Alerts</h3>
                <p>{archiveLoading ? 'Loading archive…' : `${archivedAlerts.length} archived`}</p>
              </div>
              <button type='button' className='archive-toggle-button archive-toggle-button--secondary' aria-label='Close archived alerts' onClick={() => setArchiveOpen(false)}>
                <svg viewBox='0 0 24 24' aria-hidden='true'>
                  <path d='M6 6l12 12M18 6L6 18' />
                </svg>
              </button>
            </header>

            <div className='archive-modal-body'>
              {archiveError ? (
                <section className='station-card coming-soon'>
                  <h3>Unable to load archive</h3>
                  <p>{archiveError}</p>
                </section>
              ) : null}

              {archiveLoading ? (
                <section className='station-card coming-soon'>
                  <h3>Loading archive</h3>
                  <p>Fetching your archived alerts.</p>
                </section>
              ) : null}

              {!archiveLoading && !archiveError && archivedAlerts.length ? (
                <div className='alerts-list'>
                  {archivedAlerts.map((alert) => (
                    <article key={alert.publicId} className='alert-card is-read'>
                      <div className='alert-card-top'>
                        <h3>{alert.title}</h3>
                        <span className='alert-pill is-read'>Archived</span>
                      </div>

                      <p className='alert-message'>{alert.message}</p>

                      <div className='alert-meta-row'>
                        <span>{formatDateTime(alert.archivedAt || alert.readAt || alert.createdAt, undefined, '—')}</span>
                        {alert.stationName ? (
                          <strong>
                            {alert.stationName}
                            {alert.stationArea ? ` · ${alert.stationArea}` : ''}
                          </strong>
                        ) : null}
                      </div>

                      {alert.reservationPublicId ? (
                        <div className='alert-meta-row'>
                          <span>Reservation</span>
                          <strong>{maskPublicId(alert.reservationPublicId, { prefix: 4, suffix: 4 })}</strong>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}

              {!archiveLoading && !archiveError && !archivedAlerts.length ? (
                <section className='station-card coming-soon'>
                  <h3>No archived alerts</h3>
                  <p>Alerts you archive will appear here.</p>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

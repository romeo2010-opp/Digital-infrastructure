import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoginScreen } from '../mobile/screens/LoginScreen'
import { QueueStatusScreen } from '../mobile/screens/QueueStatusScreen'
import { ReservationsScreen } from '../mobile/screens/ReservationsScreen'
import { HistoryScreen } from '../mobile/screens/HistoryScreen'
import { HelpScreen } from '../mobile/screens/HelpScreen'
import { AlertsScreen } from '../mobile/screens/AlertsScreen'
import { StationDetailsScreen } from '../mobile/screens/StationDetailsScreen'
import { WalletScreen } from '../mobile/screens/WalletScreen'
import { SendCreditScreen } from '../mobile/screens/SendCreditScreen'
import { useMiniRouter } from '../mobile/useMiniRouter'
import { stations as mockStations } from '../mobile/mockStations'
import { stationsApi } from '../mobile/api/stationsApi'
import { userAuthApi } from '../mobile/api/userAuthApi'
import { userQueueApi } from '../mobile/api/userQueueApi'
import { queueMockService } from '../mobile/queueMockService'
import {
  ensurePushSubscription,
  isPushSupported,
  registerSmartlinkServiceWorker,
  unsubscribePushSubscription,
} from '../mobile/pushNotifications'
import { maskPublicId } from '../utils/masking'
import {
  clearStoredActiveQueueJoinId,
  clearStoredAuthSession,
  getStoredAccessToken,
  getStoredActiveQueueJoinId,
  getStoredFavoriteStationIds,
  getStoredNotificationsPreference,
  getStoredSessionMeta,
  setStoredAccessToken,
  setStoredActiveQueueJoinId,
  setStoredFavoriteStationIds,
  setStoredNotificationsEnabled,
  setStoredSessionMeta,
  upsertStoredQueueHistoryItem,
} from '../mobile/authSession'
import { subscribeUserQueueSessionSync } from '../mobile/userQueueSessionEvents'
import {
  assertUserAppAccessToken,
  assertUserAppSessionMeta,
  buildUserAppRoleError,
  isRealtimeAuthClose,
} from '../mobile/userSessionGuard'
import {
  emitWalletTransferCelebration,
  isWalletTransferReceivedAlert,
} from '../mobile/walletTransferCelebration'
import { playSmartlinkCue, SMARTLINK_AUDIO_CUES } from '../utils/smartlinkAudio'
import { UserAccountOverview } from '../features/settings/UserAccountOverview'
import { UserSettingsWorkspace } from '../features/settings/UserSettingsWorkspace'
import { AssistantScreen } from '../features/assistant/AssistantScreen'
import { DesktopPlaceholderPage } from './DesktopPlaceholderPage'
import { UserDesktopLayout } from './UserDesktopLayout'
import { matchDesktopRoute, DESKTOP_NAV_ITEMS } from './desktopNav'
import './desktop.css'

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'smartlink.sidebarCollapsed'
const ALERTS_RECONNECT_BACKOFF_MS = [1200, 2500, 5000, 9000, 15000]
const requiresAuth = stationsApi.isApiMode()

function isSessionExpiryError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return (
    message.includes('session expired') ||
    message.includes('invalid refresh session') ||
    message.includes('session revoked or expired') ||
    message.includes('invalid or expired token') ||
    message.includes('missing access token')
  )
}

function readSidebarCollapsed() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === 'true'
}

function formatDistance(distanceKm) {
  const value = Number(distanceKm)
  if (!Number.isFinite(value)) return 'N/A'
  return `${value.toFixed(1)} km`
}

function formatFuelType(fuelType) {
  const normalized = String(fuelType || '').toUpperCase()
  return normalized === 'DIESEL' ? 'Diesel' : normalized === 'PETROL' ? 'Petrol' : 'Unknown'
}

function queueStatusLabel(status) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'WAITING') return 'Waiting'
  if (normalized === 'CALLED') return 'Called'
  if (normalized === 'LATE') return 'Late'
  if (normalized === 'SERVED') return 'Served'
  if (normalized === 'CANCELLED') return 'Cancelled'
  return 'Unknown'
}

function queueStatusTone(status) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'WAITING') return 'safe'
  if (normalized === 'CALLED') return 'warning'
  if (normalized === 'LATE') return 'warning'
  if (normalized === 'SERVED') return 'safe'
  if (normalized === 'CANCELLED') return 'muted'
  return 'muted'
}

function renderStationStatus(status) {
  const scoped = String(status || 'Available')
  const tone = scoped.toLowerCase() === 'in use' ? 'warning' : 'safe'
  return <span className={`desktop-status-chip tone-${tone}`}>{scoped}</span>
}

function toPushSubscriptionPayload(subscription) {
  if (!subscription || typeof subscription !== 'object') return null
  const raw = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription
  const endpoint = String(raw?.endpoint || '').trim()
  const p256dh = String(raw?.keys?.p256dh || '').trim()
  const auth = String(raw?.keys?.auth || '').trim()
  if (!endpoint || !p256dh || !auth) return null
  return {
    endpoint,
    expirationTime:
      raw?.expirationTime !== undefined && raw?.expirationTime !== null ? Number(raw.expirationTime) : null,
    keys: {
      p256dh,
      auth,
    },
  }
}

function buildDirectionsUrl(station) {
  const lat = Number(station?.lat)
  const lng = Number(station?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const params = new URLSearchParams({
    api: '1',
    destination: `${lat},${lng}`,
    travelmode: 'driving',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function OverviewPage({
  stations,
  stationsLoading,
  stationsError,
  activeQueueJoinId,
  activeQueueSnapshot,
  activeQueueLoading,
  activeQueueError,
  onOpenStations,
  onOpenQueue,
  onRetry,
}) {
  const availableStations = stations.filter((station) => station.status === 'Available').length
  const inUseStations = stations.filter((station) => station.status === 'In Use').length
  const avgRating =
    stations.length > 0
      ? (stations.reduce((total, station) => total + Number(station.rating || 0), 0) / stations.length).toFixed(1)
      : '0.0'
  const nearestStations = [...stations].sort((a, b) => Number(a.distanceKm || 999) - Number(b.distanceKm || 999)).slice(0, 5)

  const queueStatus = String(activeQueueSnapshot?.queueStatus || '').toUpperCase()
  const queueLabel = activeQueueSnapshot ? queueStatusLabel(queueStatus) : 'No active queue'
  const maskedQueueId = activeQueueJoinId ? maskPublicId(activeQueueJoinId) : ''

  return (
    <section className='desktop-overview'>
      <div className='desktop-overview-metrics'>
        <article className='desktop-metric-card'>
          <p>Stations discovered</p>
          <strong>{stationsLoading ? '...' : stations.length}</strong>
          <small>Data source: {stationsApi.isApiMode() ? 'Live API' : 'Mock dataset'}</small>
        </article>
        <article className='desktop-metric-card'>
          <p>Available now</p>
          <strong>{stationsLoading ? '...' : availableStations}</strong>
          <small>{stationsLoading ? 'Checking live status' : `${inUseStations} currently in use`}</small>
        </article>
        <article className='desktop-metric-card'>
          <p>Average rating</p>
          <strong>{stationsLoading ? '...' : avgRating}</strong>
          <small>Across visible stations</small>
        </article>
        <article className='desktop-metric-card'>
          <p>Queue status</p>
          <strong>{activeQueueLoading ? '...' : queueLabel}</strong>
          <small>{activeQueueJoinId ? `Queue ID: ${maskedQueueId}` : 'No queue linked yet'}</small>
        </article>
      </div>

      <div className='desktop-overview-panels'>
        <article className='desktop-panel'>
          <header>
            <h3>Active Queue</h3>
            {activeQueueSnapshot ? (
              <span className={`desktop-status-chip tone-${queueStatusTone(queueStatus)}`}>{queueStatusLabel(queueStatus)}</span>
            ) : null}
          </header>

          {activeQueueLoading ? <p className='desktop-empty-copy'>Loading active queue...</p> : null}
          {!activeQueueLoading && activeQueueError ? <p className='desktop-error-copy'>{activeQueueError}</p> : null}

          {!activeQueueLoading && !activeQueueError && activeQueueSnapshot ? (
            <div className='desktop-queue-summary-grid'>
              <p>
                <span>Station</span>
                <strong>{activeQueueSnapshot.station?.name || 'Unknown station'}</strong>
              </p>
              <p>
                <span>Fuel</span>
                <strong>{formatFuelType(activeQueueSnapshot.fuelType)}</strong>
              </p>
              <p>
                <span>Position</span>
                <strong>{activeQueueSnapshot.position ? `#${activeQueueSnapshot.position}` : '-'}</strong>
              </p>
              <p>
                <span>ETA</span>
                <strong>{Number(activeQueueSnapshot.etaMinutes || 0)} min</strong>
              </p>
            </div>
          ) : null}

          {!activeQueueLoading && !activeQueueError && !activeQueueSnapshot ? (
            <p className='desktop-empty-copy'>You are not in an active queue.</p>
          ) : null}

          <div className='desktop-panel-actions'>
            <button type='button' className='desktop-primary-button' onClick={onOpenQueue}>
              Open Active Queue
            </button>
            <button type='button' className='desktop-secondary-button' onClick={onRetry}>
              Refresh data
            </button>
          </div>
        </article>

        <article className='desktop-panel'>
          <header>
            <h3>Nearest Stations</h3>
            <button type='button' className='desktop-inline-button' onClick={onOpenStations}>
              View all
            </button>
          </header>

          {stationsLoading ? <p className='desktop-empty-copy'>Loading station catalog...</p> : null}
          {!stationsLoading && stationsError ? <p className='desktop-error-copy'>{stationsError}</p> : null}

          {!stationsLoading && !stationsError ? (
            <div className='desktop-compact-table-wrap'>
              <table className='desktop-compact-table'>
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Distance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nearestStations.map((station) => (
                    <tr key={station.id}>
                      <td>{station.name}</td>
                      <td>{formatDistance(station.distanceKm)}</td>
                      <td>{renderStationStatus(station.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  )
}

function StationsPage({ stations, loading, error, query, onQueryChange, onOpenStation, onRetry }) {
  const filteredStations = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase()
    if (!normalizedQuery) return stations
    return stations.filter((station) => {
      return (
        station.name?.toLowerCase().includes(normalizedQuery) ||
        station.address?.toLowerCase().includes(normalizedQuery) ||
        station.status?.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [stations, query])

  return (
    <DesktopPlaceholderPage title='Stations' description='Live station discovery feed from the SmartLink API.'>
      <div className='desktop-stations-toolbar'>
        <input
          type='search'
          className='desktop-search-input'
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder='Search by station, address, or status'
          aria-label='Search stations'
        />
        <button type='button' className='desktop-secondary-button' onClick={onRetry}>
          Refresh
        </button>
      </div>

      {loading ? <p className='desktop-empty-copy'>Loading stations...</p> : null}
      {!loading && error ? <p className='desktop-error-copy'>{error}</p> : null}

      {!loading && !error ? (
        <div className='desktop-table-wrap'>
          <table className='desktop-table'>
            <thead>
              <tr>
                <th>Station</th>
                <th>Address</th>
                <th>Distance</th>
                <th>ETA</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStations.map((station) => (
                <tr key={station.id}>
                  <td>{station.name}</td>
                  <td>{station.address}</td>
                  <td>{formatDistance(station.distanceKm)}</td>
                  <td>{Number(station.etaMin || 0)} min</td>
                  <td>{renderStationStatus(station.status)}</td>
                  <td>
                    <button type='button' className='desktop-inline-button' onClick={() => onOpenStation(station.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredStations.length ? <p className='desktop-empty-copy'>No stations matched your search.</p> : null}
        </div>
      ) : null}
    </DesktopPlaceholderPage>
  )
}

function LoginSurface({ onAuthenticated }) {
  return (
    <section className='desktop-login-surface'>
      <LoginScreen onAuthenticated={onAuthenticated} />
    </section>
  )
}

export function DesktopApp({ theme = 'light', onThemeChange }) {
  const { pathname, navigate } = useMiniRouter()
  const route = useMemo(() => matchDesktopRoute(pathname), [pathname])
  const queueData = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : queueMockService), [])
  const queueJoinIdFromPath = useMemo(() => {
    const match = String(pathname || '').match(/^\/d\/queue\/([^/]+)$/)
    if (!match?.[1]) return ''
    return decodeURIComponent(match[1]).trim()
  }, [pathname])
  const stationIdFromPath = useMemo(() => {
    const match = String(pathname || '').match(/^\/d\/stations\/([^/]+)$/)
    if (!match?.[1]) return ''
    return decodeURIComponent(match[1]).trim()
  }, [pathname])

  const [accessToken, setAccessToken] = useState(() => getStoredAccessToken())
  const [sessionMeta, setSessionMeta] = useState(() => getStoredSessionMeta())
  const [activeQueueJoinId, setActiveQueueJoinId] = useState(() => getStoredActiveQueueJoinId())
  const [activeQueueSnapshot, setActiveQueueSnapshot] = useState(null)
  const [activeQueueLoading, setActiveQueueLoading] = useState(false)
  const [activeQueueError, setActiveQueueError] = useState('')
  const [stationsData, setStationsData] = useState(() => (stationsApi.isApiMode() ? [] : mockStations))
  const [stationsLoading, setStationsLoading] = useState(() => stationsApi.isApiMode())
  const [stationsError, setStationsError] = useState('')
  const [stationQuery, setStationQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(readSidebarCollapsed)
  const [favoriteStationIds, setFavoriteStationIds] = useState(() => getStoredFavoriteStationIds())
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0)
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    const storedPreference = getStoredNotificationsPreference()
    if (storedPreference !== null) return storedPreference
    if (!isPushSupported()) return false
    return String(window.Notification.permission || 'default') === 'granted'
  })
  const [notificationsPermission, setNotificationsPermission] = useState(() =>
    isPushSupported()
      ? String(window.Notification.permission || 'default')
      : 'unsupported'
  )

  const alertsReconnectAttemptRef = useRef(0)
  const alertsReconnectTimerRef = useRef(0)
  const unsubscribeAlertsSocketRef = useRef(() => {})

  const isAuthenticated = !requiresAuth || Boolean(accessToken)
  const selectedStation = useMemo(() => {
    if (!stationIdFromPath) return null
    return stationsData.find((station) => {
      return String(station.id || '').trim() === stationIdFromPath || String(station.publicId || '').trim() === stationIdFromPath
    }) || null
  }, [stationIdFromPath, stationsData])

  const disconnectAlertsSocket = useCallback(() => {
    if (alertsReconnectTimerRef.current) {
      window.clearTimeout(alertsReconnectTimerRef.current)
      alertsReconnectTimerRef.current = 0
    }
    if (typeof unsubscribeAlertsSocketRef.current === 'function') {
      unsubscribeAlertsSocketRef.current()
    }
    unsubscribeAlertsSocketRef.current = () => {}
  }, [])

  const clearSession = useCallback(() => {
    clearStoredAuthSession()
    clearStoredActiveQueueJoinId()
    setAccessToken('')
    setSessionMeta(null)
    setActiveQueueJoinId('')
    setActiveQueueSnapshot(null)
    setActiveQueueError('')
    setUnreadAlertsCount(0)
  }, [])

  const redirectToLogin = useCallback(() => {
    clearSession()
    navigate('/d/login', { replace: true })
  }, [clearSession, navigate])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(isCollapsed))
  }, [isCollapsed])

  useEffect(() => {
    setStoredFavoriteStationIds(favoriteStationIds)
  }, [favoriteStationIds])

  useEffect(() => {
    if (!queueJoinIdFromPath) return
    setStoredActiveQueueJoinId(queueJoinIdFromPath)
    setActiveQueueJoinId(queueJoinIdFromPath)
  }, [queueJoinIdFromPath])

  const refreshUnreadAlertsCount = useCallback(async () => {
    if (!userQueueApi.isApiMode() || !isAuthenticated || typeof userQueueApi.getAlerts !== 'function') {
      setUnreadAlertsCount(0)
      return 0
    }

    try {
      const payload = await userQueueApi.getAlerts({ limit: 100 })
      const directUnreadCount = Number(payload?.unreadCount)
      if (Number.isFinite(directUnreadCount) && directUnreadCount >= 0) {
        const nextCount = Math.floor(directUnreadCount)
        setUnreadAlertsCount(nextCount)
        return nextCount
      }

      const rows = Array.isArray(payload?.items) ? payload.items : []
      const fallbackUnreadCount = rows.reduce((sum, item) => {
        const status = String(item?.status || '').trim().toUpperCase()
        const isRead = Boolean(item?.isRead) || status === 'READ'
        return sum + (isRead ? 0 : 1)
      }, 0)
      setUnreadAlertsCount(fallbackUnreadCount)
      return fallbackUnreadCount
    } catch {
      setUnreadAlertsCount(0)
      return 0
    }
  }, [isAuthenticated])

  const handleAuthenticated = useCallback(
    ({ accessToken: nextToken, session }) => {
      const normalizedToken = String(nextToken || '').trim()
      assertUserAppAccessToken(normalizedToken)
      if (session) {
        assertUserAppSessionMeta(session)
      }
      setStoredAccessToken(normalizedToken)
      setAccessToken(normalizedToken)
      if (session) {
        setStoredSessionMeta(session)
        setSessionMeta(session)
      } else {
        setSessionMeta(getStoredSessionMeta())
      }
      navigate('/d/overview', { replace: true })
    },
    [navigate]
  )

  const handleLogout = useCallback(async () => {
    disconnectAlertsSocket()
    try {
      if (requiresAuth && accessToken) {
        await userAuthApi.logout(accessToken)
      }
    } catch {
      // best-effort logout
    } finally {
      clearSession()
      navigate('/d/login', { replace: true })
    }
  }, [accessToken, clearSession, disconnectAlertsSocket, navigate])

  useEffect(() => {
    if (!requiresAuth || !accessToken) return

    try {
      const payload = assertUserAppAccessToken(accessToken)
      if (sessionMeta) {
        assertUserAppSessionMeta(sessionMeta)
      } else if (String(payload?.role || '').trim().toUpperCase() !== 'USER') {
        throw new Error(
          buildUserAppRoleError({
            role: payload?.role,
            stationPublicId: payload?.stationPublicId,
          })
        )
      }
    } catch {
      redirectToLogin()
    }
  }, [accessToken, redirectToLogin, sessionMeta])

  const handleProfileSave = useCallback(
    async (payload) => {
      if (requiresAuth && !accessToken) {
        throw new Error('Session expired. Please sign in again.')
      }

      const response = await userAuthApi.updateProfile(payload, accessToken)
      const nextSession = {
        user: response?.user || null,
        station: response?.station || null,
        role: response?.role || sessionMeta?.role || null,
        stationMemberships: response?.stationMemberships || sessionMeta?.stationMemberships || [],
        loginAt: sessionMeta?.loginAt || new Date().toISOString(),
      }

      setStoredSessionMeta(nextSession)
      setSessionMeta(nextSession)
      return nextSession
    },
    [accessToken, sessionMeta?.loginAt, sessionMeta?.role, sessionMeta?.stationMemberships]
  )

  const handleNotificationsToggle = useCallback(async () => {
    if (!isPushSupported()) {
      throw new Error('Notifications are not supported on this browser.')
    }
    if (typeof userQueueApi.getPushPublicKey !== 'function') {
      throw new Error('Push setup is not available in this app mode.')
    }

    if (notificationsEnabled) {
      let endpoint = ''
      try {
        const result = await unsubscribePushSubscription()
        endpoint = String(result?.endpoint || '').trim()
      } catch {
        // best-effort browser unsubscription
      }
      try {
        await userQueueApi.unsubscribePush(endpoint || undefined)
      } catch {
        // best-effort backend unsubscription
      }
      setNotificationsEnabled(false)
      setStoredNotificationsEnabled(false)
      return { enabled: false }
    }

    const permission = await window.Notification.requestPermission()
    setNotificationsPermission(permission)

    if (permission !== 'granted') {
      setNotificationsEnabled(false)
      setStoredNotificationsEnabled(false)
      throw new Error('Notification permission was denied. Enable it in browser settings.')
    }

    const pushConfig = await userQueueApi.getPushPublicKey()
    if (!pushConfig?.enabled || !pushConfig?.publicKey) {
      throw new Error('Push notifications are not configured on the server.')
    }

    await registerSmartlinkServiceWorker()
    const subscription = await ensurePushSubscription({
      vapidPublicKey: pushConfig.publicKey,
    })
    const payload = toPushSubscriptionPayload(subscription)
    if (!payload) {
      throw new Error('Unable to create a valid push subscription.')
    }
    await userQueueApi.subscribePush(payload)

    setNotificationsEnabled(true)
    setStoredNotificationsEnabled(true)
    return { enabled: true }
  }, [notificationsEnabled])

  const toggleFavoriteStation = useCallback((stationId) => {
    const normalizedStationId = String(stationId || '').trim()
    if (!normalizedStationId) return
    setFavoriteStationIds((current) => {
      if (current.includes(normalizedStationId)) {
        return current.filter((item) => item !== normalizedStationId)
      }
      return [normalizedStationId, ...current]
    })
  }, [])

  const joinQueueFromStation = useCallback(
    async (station, options = {}) => {
      if (!station) {
        throw new Error('Station not found')
      }

      const stationPublicId = userQueueApi.isApiMode()
        ? String(station.publicId || sessionMeta?.station?.publicId || '').trim()
        : String(station.publicId || station.id || '').trim()
      if (!stationPublicId) {
        throw new Error('Station publicId is missing for API queue join.')
      }

      const response = await queueData.joinQueue({
        stationPublicId,
        fuelType: options.fuelType || 'PETROL',
        maskedPlate: options.maskedPlate,
        requestedLiters: options.requestedLiters,
        prepay: options.prepay,
      })

      const queueJoinId = String(response?.queueJoinId || response?.status?.queueJoinId || '').trim()
      if (!queueJoinId) {
        throw new Error('Queue join did not return a queueJoinId')
      }

      setStoredActiveQueueJoinId(queueJoinId)
      setActiveQueueJoinId(queueJoinId)
      setActiveQueueSnapshot(response?.status || null)
      upsertStoredQueueHistoryItem({
        queueJoinId,
        stationPublicId,
        stationName: String(station?.name || station?.stationName || 'Unknown station').trim() || 'Unknown station',
        fuelType: String(options.fuelType || 'PETROL').trim().toUpperCase() || 'PETROL',
        requestedLiters: options.requestedLiters,
        paymentMode: options.prepay ? 'PREPAY' : 'PAY_AT_PUMP',
        queueStatus: String(response?.status?.queueStatus || 'WAITING').trim().toUpperCase() || 'WAITING',
        joinedAt: new Date().toISOString(),
      })
      navigate(`/d/queue/${encodeURIComponent(queueJoinId)}`)
      return queueJoinId
    },
    [navigate, queueData, sessionMeta?.station?.publicId]
  )

  const createReservationFromStation = useCallback(
    async (station, options = {}) => {
      if (!station) {
        throw new Error('Station not found')
      }

      const stationPublicId = userQueueApi.isApiMode()
        ? String(station.publicId || sessionMeta?.station?.publicId || '').trim()
        : String(station.publicId || station.id || '').trim()
      if (!stationPublicId) {
        throw new Error('Station publicId is missing for reservation.')
      }

      if (typeof queueData.createReservation !== 'function') {
        throw new Error('Reservation flow is unavailable in current mode.')
      }

      const response = await queueData.createReservation({
        stationPublicId,
        fuelType: options.fuelType || 'PETROL',
        expectedLiters: options.expectedLiters,
        slotStart: options.slotStart,
        slotEnd: options.slotEnd,
        identifier: options.identifier,
        depositAmount: options.depositAmount,
        userLat: options.userLat,
        userLng: options.userLng,
      })
      const softError = String(response?.error || '').trim()
      if (response?.ok === false || softError) {
        throw new Error(softError || 'Unable to create reservation')
      }
      const reservationId = response?.reservationId || response?.reservation?.id
      if (!reservationId) {
        throw new Error('Reservation was not created. Please try again.')
      }
      navigate('/d/reservations')
      return response
    },
    [navigate, queueData, sessionMeta?.station?.publicId]
  )

  const getReservationSlotsForStation = useCallback(
    async (station, { fuelType = 'PETROL', lookAhead = 8 } = {}) => {
      if (!station) {
        throw new Error('Station not found')
      }
      const stationPublicId = userQueueApi.isApiMode()
        ? String(station.publicId || sessionMeta?.station?.publicId || '').trim()
        : String(station.publicId || station.id || '').trim()
      if (!stationPublicId) {
        throw new Error('Station publicId is missing for reservation slots.')
      }
      if (typeof queueData.getReservationSlots !== 'function') {
        throw new Error('Reservation slots are unavailable in current mode.')
      }
      return queueData.getReservationSlots(stationPublicId, { fuelType, lookAhead })
    },
    [queueData, sessionMeta?.station?.publicId]
  )

  const connectReservationSlotRealtime = useCallback(
    (station, handlers = {}) => {
      const stationPublicId = userQueueApi.isApiMode()
        ? String(station?.publicId || sessionMeta?.station?.publicId || '').trim()
        : String(station?.publicId || station?.id || '').trim()
      if (!stationPublicId) return () => {}
      if (typeof queueData.connectStationChangesSocket !== 'function') return () => {}
      return queueData.connectStationChangesSocket({
        stationPublicId,
        ...handlers,
      })
    },
    [queueData, sessionMeta?.station?.publicId]
  )

  const refreshStations = useCallback(async () => {
    if (!isAuthenticated) {
      setStationsData([])
      setStationsLoading(false)
      setStationsError('')
      return
    }

    if (!stationsApi.isApiMode()) {
      setStationsData(mockStations)
      setStationsLoading(false)
      setStationsError('')
      return
    }

    setStationsLoading(true)
    setStationsError('')
    try {
      const rows = await stationsApi.listStations()
      setStationsData(rows)
    } catch (error) {
      if (requiresAuth && isSessionExpiryError(error)) {
        redirectToLogin()
        return
      }

      setStationsData([])
      setStationsError(error?.message || 'Unable to load stations from API.')
    } finally {
      setStationsLoading(false)
    }
  }, [isAuthenticated, redirectToLogin])

  const refreshActiveQueue = useCallback(
    async ({ silent = false } = {}) => {
      if (!isAuthenticated) {
        setActiveQueueJoinId('')
        setActiveQueueSnapshot(null)
        setActiveQueueError('')
        setActiveQueueLoading(false)
        return
      }

      if (!silent) {
        setActiveQueueLoading(true)
      }
      setActiveQueueError('')

      try {
        if (queueData === userQueueApi) {
          const payload = await userQueueApi.getActiveQueue()
          const queueJoinId = String(payload?.queueJoinId || payload?.status?.queueJoinId || '').trim()
          const snapshot = payload?.status || null

          if (queueJoinId) {
            setStoredActiveQueueJoinId(queueJoinId)
            setActiveQueueJoinId(queueJoinId)
          } else {
            clearStoredActiveQueueJoinId()
            setActiveQueueJoinId('')
          }

          setActiveQueueSnapshot(snapshot)
          return
        }

        const persistedJoinId = String(getStoredActiveQueueJoinId() || '').trim()
        if (!persistedJoinId) {
          setActiveQueueJoinId('')
          setActiveQueueSnapshot(null)
          return
        }

        const snapshot = await queueMockService.getStatus(persistedJoinId)
        setActiveQueueJoinId(persistedJoinId)
        setActiveQueueSnapshot(snapshot)
      } catch (error) {
        if (requiresAuth && isSessionExpiryError(error)) {
          redirectToLogin()
          return
        }

        setActiveQueueError(error?.message || 'Unable to load active queue')
      } finally {
        if (!silent) {
          setActiveQueueLoading(false)
        }
      }
    },
    [isAuthenticated, queueData, redirectToLogin]
  )

  useEffect(() => {
    if (pathname === '/d') {
      navigate('/d/overview', { replace: true })
      return
    }

    if (!pathname.startsWith('/d/')) {
      navigate('/d/overview', { replace: true })
      return
    }

    if (requiresAuth && !isAuthenticated && pathname !== '/d/login') {
      navigate('/d/login', { replace: true })
      return
    }

    if (requiresAuth && isAuthenticated && pathname === '/d/login') {
      navigate('/d/overview', { replace: true })
    }
  }, [isAuthenticated, navigate, pathname])

  useEffect(() => {
    const routeTitle = route.title || 'Overview'
    document.title = `${routeTitle} | SmartLink User App`
  }, [route.title])

  useEffect(() => {
    refreshStations()
  }, [accessToken, refreshStations])

  useEffect(() => {
    refreshActiveQueue()

    const timerId = window.setInterval(() => {
      refreshActiveQueue({ silent: true })
    }, 30000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [accessToken, refreshActiveQueue])

  useEffect(() => {
    if (!isAuthenticated) return undefined

    return subscribeUserQueueSessionSync(({ queueJoinId, known }) => {
      if (!known) return

      if (queueJoinId) {
        setStoredActiveQueueJoinId(queueJoinId)
        setActiveQueueJoinId(queueJoinId)
      } else {
        clearStoredActiveQueueJoinId()
        setActiveQueueJoinId('')
        setActiveQueueSnapshot(null)
      }

      void refreshActiveQueue({ silent: true })
    })
  }, [isAuthenticated, refreshActiveQueue])

  useEffect(() => {
    refreshUnreadAlertsCount()
  }, [accessToken, refreshUnreadAlertsCount])

  useEffect(() => {
    if (notificationsPermission === 'granted') {
      const storedPreference = getStoredNotificationsPreference()
      if (storedPreference !== null) {
        setNotificationsEnabled(storedPreference)
      }
      return
    }
    if (notificationsPermission === 'unsupported') return
    setNotificationsEnabled(false)
  }, [notificationsPermission])

  useEffect(() => {
    if (!isAuthenticated || !userQueueApi.isApiMode() || typeof userQueueApi.connectUserAlertsSocket !== 'function') {
      disconnectAlertsSocket()
      setUnreadAlertsCount(0)
      return undefined
    }

    let mounted = true

    const connect = () => {
      if (!mounted) return
      try {
        const unsubscribe = userQueueApi.connectUserAlertsSocket({
          onOpen: () => {
            if (!mounted) return
            alertsReconnectAttemptRef.current = 0
            refreshUnreadAlertsCount()
          },
          onClose: (event) => {
            if (!mounted) return
            if (isRealtimeAuthClose(event)) {
              redirectToLogin()
              return
            }
            const attempt = alertsReconnectAttemptRef.current
            const delay = ALERTS_RECONNECT_BACKOFF_MS[Math.min(attempt, ALERTS_RECONNECT_BACKOFF_MS.length - 1)]
            alertsReconnectAttemptRef.current = attempt + 1
            alertsReconnectTimerRef.current = window.setTimeout(() => {
              alertsReconnectTimerRef.current = 0
              connect()
            }, delay)
          },
          onError: () => {
            if (!mounted) return
            refreshUnreadAlertsCount()
          },
          onMessage: (message) => {
            if (!mounted) return
            if (message?.type === 'user_alert:new') {
              if (isWalletTransferReceivedAlert(message?.data || {})) {
                emitWalletTransferCelebration(message.data || {})
              } else {
                playSmartlinkCue(SMARTLINK_AUDIO_CUES.IN_APP_NOTIFICATION)
              }
            }
            refreshUnreadAlertsCount()
          },
        })
        unsubscribeAlertsSocketRef.current = unsubscribe
      } catch {
        refreshUnreadAlertsCount()
      }
    }

    connect()

    return () => {
      mounted = false
      disconnectAlertsSocket()
    }
  }, [disconnectAlertsSocket, isAuthenticated, redirectToLogin, refreshUnreadAlertsCount])

  if (route.name === 'login') {
    return <LoginSurface onAuthenticated={handleAuthenticated} />
  }

  const resolvedQueueJoinId = queueJoinIdFromPath || activeQueueJoinId
  const profileName = sessionMeta?.user?.fullName || sessionMeta?.user?.email || 'User'

  let content = null

  if (route.name === 'overview') {
    content = (
      <OverviewPage
        stations={stationsData}
        stationsLoading={stationsLoading}
        stationsError={stationsError}
        activeQueueJoinId={resolvedQueueJoinId}
        activeQueueSnapshot={activeQueueSnapshot}
        activeQueueLoading={activeQueueLoading}
        activeQueueError={activeQueueError}
        onOpenStations={() => navigate('/d/stations')}
        onOpenQueue={() => navigate('/d/queue')}
        onRetry={() => {
          refreshStations()
          refreshActiveQueue()
          refreshUnreadAlertsCount()
        }}
      />
    )
  } else if (route.name === 'stations') {
    content = (
      <StationsPage
        stations={stationsData}
        loading={stationsLoading}
        error={stationsError}
        query={stationQuery}
        onQueryChange={setStationQuery}
        onRetry={refreshStations}
        onOpenStation={(stationId) => navigate(`/d/stations/${encodeURIComponent(stationId)}`)}
      />
    )
  } else if (route.name === 'station-details') {
    if (stationsLoading && !selectedStation) {
      content = (
        <DesktopPlaceholderPage title='Station Details' description='Loading station details from the SmartLink API.'>
          <p className='desktop-empty-copy'>Loading station details...</p>
        </DesktopPlaceholderPage>
      )
    } else {
      content = (
        <section className='desktop-station-details-surface'>
          <StationDetailsScreen
            station={selectedStation}
            onBack={() => navigate('/d/stations')}
            onDirections={() => {
              const directionsUrl = buildDirectionsUrl(selectedStation)
              if (!directionsUrl) return
              window.open(directionsUrl, '_blank', 'noopener,noreferrer')
            }}
            onJoinQueue={joinQueueFromStation}
            onReserve={createReservationFromStation}
            onGetReservationSlots={getReservationSlotsForStation}
            onConnectReservationRealtime={connectReservationSlotRealtime}
            isFavorite={favoriteStationIds.includes(String(selectedStation?.id || '').trim())}
            onToggleFavorite={toggleFavoriteStation}
          />
        </section>
      )
    }
  } else if (route.name === 'active-queue') {
    if (resolvedQueueJoinId) {
      content = (
        <section className='desktop-queue-surface'>
          <QueueStatusScreen
            queueJoinId={resolvedQueueJoinId}
            onLeaveComplete={() => {
              clearStoredActiveQueueJoinId()
              setActiveQueueJoinId('')
              setActiveQueueSnapshot(null)
              navigate('/d/queue', { replace: true })
            }}
          />
        </section>
      )
    } else {
      content = (
        <DesktopPlaceholderPage
          title='Active Queue'
          description='No active queue found for this account. Join a queue from station details to track it here.'
        >
          {activeQueueLoading ? <p className='desktop-empty-copy'>Checking queue state...</p> : null}
          {!activeQueueLoading && activeQueueError ? <p className='desktop-error-copy'>{activeQueueError}</p> : null}
          <button type='button' className='desktop-primary-button' onClick={() => navigate('/d/stations')}>
            Browse Stations
          </button>
        </DesktopPlaceholderPage>
      )
    }
  } else if (route.name === 'reservations') {
    content = (
      <section className='desktop-mobile-surface'>
        <ReservationsScreen />
      </section>
    )
  } else if (route.name === 'assistant') {
    content = (
      <section className='desktop-assistant-surface'>
        <AssistantScreen layout='desktop' />
      </section>
    )
  } else if (route.name === 'transactions') {
    content = (
      <div className='desktop-surface-stack'>
        <section className='desktop-mobile-surface desktop-wallet-surface'>
          <WalletScreen onOpenSendCredit={() => navigate('/d/transactions/send-credit')} />
        </section>
        <section className='desktop-mobile-surface'>
          <HistoryScreen
            activeQueueJoinId={resolvedQueueJoinId}
            onOpenQueue={(queueJoinId) => navigate(`/d/queue/${encodeURIComponent(queueJoinId)}`)}
          />
        </section>
      </div>
    )
  } else if (route.name === 'send-credit') {
    content = (
      <section className='desktop-mobile-surface desktop-wallet-surface'>
        <SendCreditScreen
          onBack={() => navigate('/d/transactions')}
          stations={stationsData}
        />
      </section>
    )
  } else if (route.name === 'alerts') {
    content = (
      <section className='desktop-mobile-surface'>
        <AlertsScreen />
      </section>
    )
  } else if (route.name === 'help') {
    content = (
      <section className='desktop-mobile-surface'>
        <HelpScreen />
      </section>
    )
  } else if (route.name === 'settings') {
    content = (
      <DesktopPlaceholderPage title='Settings' description='Manage your identity, alerts, and billing.'>
        <UserSettingsWorkspace
          layout='desktop'
          profile={sessionMeta?.user || null}
          station={sessionMeta?.station || null}
          theme={theme}
          notificationsEnabled={notificationsEnabled}
          notificationsPermission={notificationsPermission}
          onToggleNotifications={handleNotificationsToggle}
          onSaveProfile={handleProfileSave}
          onOpenWallet={() => navigate('/d/transactions')}
          onLogout={handleLogout}
          onThemeChange={onThemeChange}
        />
      </DesktopPlaceholderPage>
    )
  } else if (route.name === 'legal') {
    content = <DesktopPlaceholderPage title='Legal / Privacy' description='Review SmartLink terms, policies, and compliance notices.' />
  } else if (route.name === 'account') {
    content = (
      <DesktopPlaceholderPage title='My Account' description='Account details and quick access to settings and billing.'>
        <UserAccountOverview
          profile={sessionMeta?.user || null}
          station={sessionMeta?.station || null}
          onOpenSettings={() => navigate('/d/settings')}
          onOpenWallet={() => navigate('/d/transactions')}
          onLogout={handleLogout}
        />
      </DesktopPlaceholderPage>
    )
  } else {
    content = (
      <OverviewPage
        stations={stationsData}
        stationsLoading={stationsLoading}
        stationsError={stationsError}
        activeQueueJoinId={resolvedQueueJoinId}
        activeQueueSnapshot={activeQueueSnapshot}
        activeQueueLoading={activeQueueLoading}
        activeQueueError={activeQueueError}
        onOpenStations={() => navigate('/d/stations')}
        onOpenQueue={() => navigate('/d/queue')}
        onRetry={() => {
          refreshStations()
          refreshActiveQueue()
          refreshUnreadAlertsCount()
        }}
      />
    )
  }

  let subtitle = route.path
  if (route.name === 'active-queue' && resolvedQueueJoinId) {
    subtitle = `Queue ID: ${maskPublicId(resolvedQueueJoinId)}`
  } else if (route.name === 'station-details') {
    subtitle = selectedStation?.address || selectedStation?.name || '/d/stations'
  } else if (route.name === 'send-credit') {
    subtitle = 'Transfer SmartLink wallet credit to another user'
  } else if (route.name === 'alerts') {
    subtitle = unreadAlertsCount ? `${unreadAlertsCount} unread alert${unreadAlertsCount === 1 ? '' : 's'}` : 'Notifications and archived alerts'
  }

  const activePath = route.name === 'send-credit' ? '/d/transactions' : route.path

  return (
    <UserDesktopLayout
      navItems={DESKTOP_NAV_ITEMS}
      activePath={activePath}
      title={route.title}
      subtitle={subtitle}
      profileName={profileName}
      isCollapsed={isCollapsed}
      unreadAlertsCount={unreadAlertsCount}
      onToggleCollapse={() => setIsCollapsed((value) => !value)}
      onNavigate={navigate}
      onOpenAlerts={() => navigate('/d/alerts')}
      onProfileAction={(item) => {
        if (item.action === 'logout') {
          handleLogout()
          return
        }
        if (item.path) {
          navigate(item.path)
        }
      }}
    >
      {content}
    </UserDesktopLayout>
  )
}

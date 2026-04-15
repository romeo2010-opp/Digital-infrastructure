import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileShell } from './mobile/MobileShell'
import { useMiniRouter } from './mobile/useMiniRouter'
import { useMobileViewport } from './mobile/useMobileViewport'
import { stations as mockStations } from './mobile/mockStations'
import { MapHomeScreen } from './mobile/screens/MapHomeScreen'
import { ReservationsScreen } from './mobile/screens/ReservationsScreen'
import { SavedScreen } from './mobile/screens/SavedScreen'
import { StationsScreen } from './mobile/screens/StationsScreen'
import { StationDetailsScreen } from './mobile/screens/StationDetailsScreen'
import { DirectionsScreen } from './mobile/screens/DirectionsScreen'
import { AccountScreen } from './mobile/screens/AccountScreen'
import { WalletScreen } from './mobile/screens/WalletScreen'
import { OrdersScreen } from './mobile/screens/OrdersScreen'
import { SendCreditScreen } from './mobile/screens/SendCreditScreen'
import { QueueStatusScreen } from './mobile/screens/QueueStatusScreen'
import { LoginScreen } from './mobile/screens/LoginScreen'
import { HistoryScreen } from './mobile/screens/HistoryScreen'
import { MoreScreen } from './mobile/screens/MoreScreen'
import { AlertsScreen } from './mobile/screens/AlertsScreen'
import { HelpScreen } from './mobile/screens/HelpScreen'
import { SettingsScreen } from './mobile/screens/SettingsScreen'
import { AssistantScreen } from './features/assistant/AssistantScreen'
import { userQueueApi } from './mobile/api/userQueueApi'
import { userAuthApi } from './mobile/api/userAuthApi'
import { stationsApi } from './mobile/api/stationsApi'
import { queueMockService } from './mobile/queueMockService'
import {
  ensurePushSubscription,
  isPushSupported,
  registerSmartlinkServiceWorker,
  unsubscribePushSubscription,
} from './mobile/pushNotifications'
import { DesktopApp } from './desktop/DesktopApp'
import { LandingPage } from './pages/Landing/LandingPage'
import {
  clearStoredActiveQueueJoinId,
  clearStoredAuthSession,
  getStoredActiveQueueJoinId,
  getStoredAccessToken,
  getStoredNotificationsPreference,
  getStoredFavoriteStationIds,
  getStoredSessionMeta,
  getStoredThemePreference,
  setStoredActiveQueueJoinId,
  setStoredAccessToken,
  setStoredFavoriteStationIds,
  setStoredNotificationsEnabled,
  setStoredSessionMeta,
  setStoredThemePreference,
  upsertStoredQueueHistoryItem,
} from './mobile/authSession'
import {
  assertUserAppAccessToken,
  assertUserAppSessionMeta,
  buildUserAppRoleError,
  isQueueRealtimeScopeClose,
  isRealtimeAuthClose,
} from './mobile/userSessionGuard'
import {
  APP_AIRDROP_CELEBRATION_DURATION_MS,
  APP_AIRDROP_CELEBRATION_EVENT,
  emitWalletTransferCelebration,
  isWalletTransferReceivedAlert,
} from './mobile/walletTransferCelebration'
import { emitSmartlinkUserAlert } from './mobile/userAlertEvents'
import { subscribeUserQueueSessionSync } from './mobile/userQueueSessionEvents'
import { playSmartlinkCue, SMARTLINK_AUDIO_CUES } from './utils/smartlinkAudio'
import './mobile/mobile.css'

const APP_TITLE = 'SmartLink User App'
const APP_BOOT_WORDS = ['stations', 'routes', 'queue', 'updates']
const APP_STATION_WORDS = ['station', 'details', 'fuel']
const APP_ROUTE_WORDS = ['route', 'direction', 'roads']
const APP_QUEUE_WORDS = ['queue', 'position', 'status']
const APP_RESERVATION_WORDS = ['reservation', 'slot', 'deposit']
const APP_BOOT_LOADER_MS = 2000
const APP_TRANSITION_LOADER_MS = 1020
const APP_QUEUE_TRANSITION_LOADER_MS = 2080
const ALERTS_RECONNECT_BACKOFF_MS = [1200, 2500, 5000, 9000, 15000]
const QUEUE_BG_RECONNECT_BACKOFF_MS = [1200, 2500, 5000, 9000, 15000]
const STATION_PRICE_REFRESH_MS = 60000
const ALERT_NOTIFICATION_ICON = '/smartlogo.png'
const queueData = userQueueApi.isApiMode() ? userQueueApi : queueMockService
const requiresAuth = userQueueApi.isApiMode()

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

function isQueueEntryMissingError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return message.includes('queue entry not found')
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values.reduce((result, value) => {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) return result
    seen.add(normalized)
    result.push(normalized)
    return result
  }, [])
}

function mergeStringLists(...lists) {
  return normalizeStringList(lists.flat())
}

function sameStringList(left, right) {
  const leftValues = normalizeStringList(left)
  const rightValues = normalizeStringList(right)
  if (leftValues.length !== rightValues.length) return false
  return leftValues.every((value, index) => value === rightValues[index])
}

function matchMobileRoute(pathname) {
  if (pathname === '/m/login') return { name: 'login', params: {} }
  if (pathname === '/m/home') return { name: 'home', params: {} }
  if (pathname === '/m/map') return { name: 'orders', params: {} }
  if (pathname === '/m/orders') return { name: 'orders', params: {} }
  if (pathname === '/m/activity') return { name: 'activity', params: {} }
  if (pathname === '/m/stations') return { name: 'stations', params: {} }
  if (pathname === '/m/more') return { name: 'more', params: {} }
  if (pathname === '/m/reservations') return { name: 'reservations', params: {} }
  if (pathname === '/m/history') return { name: 'history', params: {} }
  if (pathname === '/m/alerts') return { name: 'alerts', params: {} }
  if (pathname === '/m/help') return { name: 'help', params: {} }
  if (pathname === '/m/settings') return { name: 'settings', params: {} }
  if (pathname === '/m/account') return { name: 'account', params: {} }
  if (pathname === '/m/assistant') return { name: 'assistant', params: {} }
  if (pathname === '/m/saved') return { name: 'saved', params: {} }
  if (pathname === '/m/wallet') return { name: 'wallet', params: {} }
  if (pathname === '/m/wallet/send-credit') return { name: 'send-credit', params: {} }

  const stationMatch = pathname.match(/^\/m\/stations\/([^/]+)$/)
  if (stationMatch) {
    return {
      name: 'station-details',
      params: { id: decodeURIComponent(stationMatch[1]) },
    }
  }

  const directionMatch = pathname.match(/^\/m\/directions\/([^/]+)$/)
  if (directionMatch) {
    return {
      name: 'directions',
      params: { id: decodeURIComponent(directionMatch[1]) },
    }
  }

  const queueMatch = pathname.match(/^\/m\/queue\/([^/]+)$/)
  if (queueMatch) {
    return {
      name: 'queue-status',
      params: { id: decodeURIComponent(queueMatch[1]) },
    }
  }

  return { name: 'home', params: {} }
}

function activeTabForRoute(routeName) {
  if (routeName === 'login') return 'home'
  if (routeName === 'home') return 'home'
  if (routeName === 'orders') return 'orders'
  if (routeName === 'stations' || routeName === 'station-details' || routeName === 'directions') return 'home'
  if (routeName === 'activity' || routeName === 'queue-status') return 'activity'
  if (routeName === 'wallet' || routeName === 'send-credit') return 'wallet'
  if (routeName === 'assistant') return ''
  if (
    routeName === 'saved' ||
    routeName === 'more' ||
    routeName === 'reservations' ||
    routeName === 'history' ||
    routeName === 'alerts' ||
    routeName === 'help' ||
    routeName === 'settings' ||
    routeName === 'account'
  ) {
    return 'more'
  }
  return 'home'
}

function titleForRoute(routeName) {
  const routeTitleMap = {
    login: 'Login',
    home: 'Home',
    orders: 'Orders',
    activity: 'Queue Activity',
    stations: 'Stations',
    'station-details': 'Station Details',
    directions: 'Directions',
    'queue-status': 'Queue Status',
    more: 'More',
    saved: 'Saved Stations',
    reservations: 'Reservations',
    history: 'History',
    alerts: 'Alerts',
    help: 'Help',
    settings: 'Settings',
    assistant: 'Assistant',
    wallet: 'Wallet',
    'send-credit': 'Send Credit',
    account: 'Account',
  }

  return `${routeTitleMap[routeName] || 'Home'} | ${APP_TITLE}`
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

function GlobalWalletTransferCelebration() {
  const timerRef = useRef(0)
  const [celebration, setCelebration] = useState(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleCelebration = (event) => {
      const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {}
      setCelebration({
        key: `${detail.alertPublicId || detail.queueJoinId || detail.variant || 'celebration'}-${Date.now()}`,
        variant: String(detail.variant || '').trim().toLowerCase() || 'wallet-transfer',
        title: String(detail.title || 'Funds Received').trim() || 'Funds Received',
        subtitle: String(detail.subtitle || 'SmartLink credit received').trim() || 'SmartLink credit received',
        transferMode: String(detail.transferMode || '').trim().toUpperCase() || 'NORMAL',
      })

      playSmartlinkCue(
        String(detail.variant || '').trim().toLowerCase() === 'queue-served'
          ? SMARTLINK_AUDIO_CUES.QUEUE_SERVED
          : SMARTLINK_AUDIO_CUES.WALLET_TRANSFER_RECEIVED
      )

      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0
        setCelebration(null)
      }, APP_AIRDROP_CELEBRATION_DURATION_MS)
    }

    window.addEventListener(APP_AIRDROP_CELEBRATION_EVENT, handleCelebration)
    return () => {
      window.removeEventListener(APP_AIRDROP_CELEBRATION_EVENT, handleCelebration)
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  if (!celebration) return null

  return (
    <div className='app-airdrop-success-layer' aria-hidden='true'>
      <div
        key={celebration.key}
        className={`app-airdrop-success ${celebration.variant === 'queue-served' ? 'is-queue-served' : ''}`}
      >
        <span className='app-airdrop-ring app-airdrop-ring--outer' />
        <span className='app-airdrop-ring app-airdrop-ring--mid' />
        <span className='app-airdrop-ring app-airdrop-ring--inner' />
        <div className='app-airdrop-core'>
          {celebration.variant === 'queue-served' ? (
            <>
              <span className='app-airdrop-station-tile'>
                <span className='app-airdrop-station-pump' />
              </span>
              <span className='app-airdrop-success-badge'>
                <span className='app-airdrop-success-check' />
              </span>
            </>
          ) : (
            <>
              <span className='app-airdrop-avatar-orb'>
                <span className='app-airdrop-avatar-head' />
                <span className='app-airdrop-avatar-body' />
              </span>
              <span className='app-airdrop-wallet-badge'>
                <span className='app-airdrop-wallet-glyph' />
              </span>
            </>
          )}
        </div>
        <div className='app-airdrop-copy'>
          <strong>{celebration.title}</strong>
          <span>{celebration.subtitle}</span>
        </div>
      </div>
    </div>
  )
}

function mergeQueueRealtimeSnapshot(previous, message) {
  if (!message || typeof message !== 'object') return previous
  if (message.type === 'queue:snapshot' && message.data) {
    return message.data
  }

  if (!previous) return previous
  if (message.type === 'queue:update' && message.data) {
    return {
      ...previous,
      queueStatus: message.data.queueStatus ?? previous.queueStatus,
      position: message.data.position ?? previous.position,
      carsAhead: message.data.carsAhead ?? previous.carsAhead,
      totalQueued: message.data.totalQueued ?? previous.totalQueued,
      etaMinutes: message.data.etaMinutes ?? previous.etaMinutes,
    }
  }

  if (message.type === 'queue:movement' && message.data) {
    return {
      ...previous,
      nowServing: message.data.nowServing ?? previous.nowServing,
      lastMovementAt: message.data.lastMovementAt ?? previous.lastMovementAt,
      movementState: message.data.movementState ?? previous.movementState,
      pauseReason: message.data.pauseReason ?? previous.pauseReason,
      expectedResumeAt: message.data.expectedResumeAt ?? previous.expectedResumeAt,
    }
  }

  return previous
}

function MobileApp({ theme = 'light', onThemeChange }) {
  const { pathname, navigate } = useMiniRouter()
  const [accessToken, setAccessToken] = useState(() => getStoredAccessToken())
  const [sessionMeta, setSessionMeta] = useState(() => getStoredSessionMeta())
  const [activeQueueJoinId, setActiveQueueJoinId] = useState(() => getStoredActiveQueueJoinId())
  const [showQueueStationPicker, setShowQueueStationPicker] = useState(false)
  const [pendingJoinStationId, setPendingJoinStationId] = useState('')
  const [stationsData, setStationsData] = useState(() => (stationsApi.isApiMode() ? [] : mockStations))
  const [favoriteStationIds, setFavoriteStationIds] = useState(() => getStoredFavoriteStationIds())
  const [stationsLoading, setStationsLoading] = useState(() => stationsApi.isApiMode())
  const [stationsError, setStationsError] = useState('')
  const [bootReady, setBootReady] = useState(false)
  const [loaderWordIndex, setLoaderWordIndex] = useState(0)
  const [loaderWords, setLoaderWords] = useState(APP_BOOT_WORDS)
  const [isTransitionLoading, setIsTransitionLoading] = useState(false)
  const transitionTimerRef = useRef(0)
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
  const unreadAlertsReconnectAttemptRef = useRef(0)
  const unreadAlertsReconnectTimerRef = useRef(0)
  const unsubscribeAlertsSocketRef = useRef(() => {})
  const queueBgReconnectAttemptRef = useRef(0)
  const queueBgReconnectTimerRef = useRef(0)
  const unsubscribeQueueBgSocketRef = useRef(() => {})
  const queueBgSnapshotRef = useRef(null)
  const previousStationsSnapshotRef = useRef(stationsApi.isApiMode() ? [] : mockStations)
  const remoteFavoriteStationIdsRef = useRef([])
  const favoriteSyncReadyRef = useRef(false)
  const queueBgNotificationStateRef = useRef({
    queueJoinId: '',
    calledNotified: false,
    approachingTop3Notified: false,
  })
  const shownNotificationIdsRef = useRef(new Set())
  const resetInvalidUserSessionRef = useRef(() => {})
  const clearActiveQueueScopeRef = useRef(() => {})
  const favoriteStationIdsRef = useRef(favoriteStationIds)
  const isAuthenticated = !requiresAuth || Boolean(accessToken)
  const isQueueScreenActive = /^\/m\/queue\/[^/]+$/.test(pathname)

  const disconnectAlertsSocket = useCallback(() => {
    if (unreadAlertsReconnectTimerRef.current) {
      window.clearTimeout(unreadAlertsReconnectTimerRef.current)
      unreadAlertsReconnectTimerRef.current = 0
    }
    if (typeof unsubscribeAlertsSocketRef.current === 'function') {
      unsubscribeAlertsSocketRef.current()
    }
    unsubscribeAlertsSocketRef.current = () => {}
  }, [])

  const disconnectQueueBackgroundSocket = useCallback(() => {
    if (queueBgReconnectTimerRef.current) {
      window.clearTimeout(queueBgReconnectTimerRef.current)
      queueBgReconnectTimerRef.current = 0
    }
    if (typeof unsubscribeQueueBgSocketRef.current === 'function') {
      unsubscribeQueueBgSocketRef.current()
    }
    unsubscribeQueueBgSocketRef.current = () => {}
    queueBgSnapshotRef.current = null
  }, [])

  const resetInvalidUserSession = useCallback(() => {
    disconnectAlertsSocket()
    disconnectQueueBackgroundSocket()
    clearStoredAuthSession()
    clearStoredActiveQueueJoinId()
    setAccessToken('')
    setSessionMeta(null)
    setActiveQueueJoinId('')
    setUnreadAlertsCount(0)
    setShowQueueStationPicker(false)
    setPendingJoinStationId('')
    if (pathname !== '/m/login') {
      navigate('/m/login', { replace: true })
    }
  }, [disconnectAlertsSocket, disconnectQueueBackgroundSocket, navigate, pathname])

  const clearActiveQueueScope = useCallback(() => {
    disconnectQueueBackgroundSocket()
    clearStoredActiveQueueJoinId()
    setActiveQueueJoinId('')
  }, [disconnectQueueBackgroundSocket])

  useEffect(() => {
    resetInvalidUserSessionRef.current = resetInvalidUserSession
  }, [resetInvalidUserSession])

  useEffect(() => {
    clearActiveQueueScopeRef.current = clearActiveQueueScope
  }, [clearActiveQueueScope])

  useEffect(() => {
    favoriteStationIdsRef.current = favoriteStationIds
  }, [favoriteStationIds])

  const refreshUnreadAlertsCount = useCallback(async () => {
    if (!userQueueApi.isApiMode() || !isAuthenticated) {
      setUnreadAlertsCount(0)
      return 0
    }
    if (typeof userQueueApi.getAlerts !== 'function') {
      setUnreadAlertsCount(0)
      return 0
    }

    const payload = await userQueueApi.getAlerts({ limit: 100 })
    const directUnreadCount = Number(payload?.unreadCount)
    if (Number.isFinite(directUnreadCount) && directUnreadCount >= 0) {
      setUnreadAlertsCount(Math.floor(directUnreadCount))
      return Math.floor(directUnreadCount)
    }

    const rows = Array.isArray(payload?.items) ? payload.items : []
    const fallbackUnreadCount = rows.reduce((sum, item) => {
      const status = String(item?.status || '').trim().toUpperCase()
      const isRead = Boolean(item?.isRead) || status === 'READ'
      return sum + (isRead ? 0 : 1)
    }, 0)
    setUnreadAlertsCount(fallbackUnreadCount)
    return fallbackUnreadCount
  }, [isAuthenticated])

  const stopTransitionLoader = useCallback(
    (delayMs = 0) => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = 0
      }

      transitionTimerRef.current = window.setTimeout(() => {
        setIsTransitionLoading(false)
        setLoaderWords(APP_BOOT_WORDS)
      }, Math.max(0, Number(delayMs) || 0))
    },
    []
  )

  const startTransitionLoader = useCallback((words = APP_BOOT_WORDS) => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = 0
    }
    setLoaderWords(Array.isArray(words) && words.length ? words : APP_BOOT_WORDS)
    setLoaderWordIndex(0)
    setIsTransitionLoading(true)
  }, [])

  const navigateWithTransition = useCallback(
    (to, { options, words = APP_BOOT_WORDS, holdMs = APP_TRANSITION_LOADER_MS } = {}) => {
      startTransitionLoader(words)
      navigate(to, options)
      stopTransitionLoader(holdMs)
    },
    [navigate, startTransitionLoader, stopTransitionLoader]
  )

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
      navigate('/m/home', { replace: true })
    },
    [navigate]
  )

  const handleLogout = useCallback(async () => {
    disconnectAlertsSocket()
    disconnectQueueBackgroundSocket()
    try {
      if (requiresAuth && accessToken) {
        await userAuthApi.logout(accessToken)
      }
    } catch {
      // best-effort logout
    } finally {
      clearStoredAuthSession()
      clearStoredActiveQueueJoinId()
      setAccessToken('')
      setSessionMeta(null)
      setActiveQueueJoinId('')
      setUnreadAlertsCount(0)
      setShowQueueStationPicker(false)
      setPendingJoinStationId('')
      navigate('/m/login', { replace: true })
    }
  }, [accessToken, disconnectAlertsSocket, disconnectQueueBackgroundSocket, navigate])

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
      resetInvalidUserSession()
    }
  }, [accessToken, resetInvalidUserSession, sessionMeta])

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
      throw new Error('Phone notifications are not supported on this browser.')
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

  const showBrowserNotification = useCallback(
    ({ notificationId = '', title = 'SmartLink Alert', message = 'You have a new alert.', path = '/m/home' } = {}) => {
      if (
        !notificationsEnabled ||
        notificationsPermission !== 'granted' ||
        typeof window === 'undefined' ||
        typeof window.Notification !== 'function'
      ) {
        return
      }

      const scopedNotificationId = String(notificationId || '').trim()
      if (scopedNotificationId && shownNotificationIdsRef.current.has(scopedNotificationId)) {
        return
      }
      if (scopedNotificationId) {
        shownNotificationIdsRef.current.add(scopedNotificationId)
      }

      const notificationTitle = String(title || 'SmartLink Alert').trim() || 'SmartLink Alert'
      const notificationBody = String(message || '').trim() || 'You have a new alert.'
      const onClickPath = String(path || '/m/home').trim() || '/m/home'

      try {
        const notification = new window.Notification(notificationTitle, {
          body: notificationBody,
          icon: ALERT_NOTIFICATION_ICON,
          badge: ALERT_NOTIFICATION_ICON,
          tag: scopedNotificationId || `smartlink-alert-${Date.now()}`,
        })

        notification.onclick = () => {
          try {
            window.focus()
          } catch {
            // noop
          }
          navigate(onClickPath)
          try {
            notification.close()
          } catch {
            // noop
          }
        }
      } catch {
        // Ignore notification rendering errors.
      }
    },
    [navigate, notificationsEnabled, notificationsPermission]
  )

  const showSystemAlertNotification = useCallback(
    (alertPayload) => {
      const alertPublicId = String(alertPayload?.publicId || '').trim()
      const metadataPath = String(alertPayload?.metadata?.path || '').trim()
      const isWalletTransferAlert = isWalletTransferReceivedAlert(alertPayload)
      if (isWalletTransferAlert) {
        emitWalletTransferCelebration(alertPayload)
      } else {
        playSmartlinkCue(SMARTLINK_AUDIO_CUES.IN_APP_NOTIFICATION)
      }
      showBrowserNotification({
        notificationId: alertPublicId ? `alert:${alertPublicId}` : '',
        title: String(alertPayload?.title || 'SmartLink Alert').trim() || 'SmartLink Alert',
        message: String(alertPayload?.message || alertPayload?.body || '').trim() || 'You have a new alert.',
        path: metadataPath || '/m/alerts',
      })
    },
    [showBrowserNotification]
  )

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

      const queueJoinId = response?.queueJoinId || response?.status?.queueJoinId
      if (!queueJoinId) {
        throw new Error('Queue join did not return a queueJoinId')
      }

      startTransitionLoader(APP_QUEUE_WORDS)
      setStoredActiveQueueJoinId(queueJoinId)
      setActiveQueueJoinId(queueJoinId)
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
      navigate(`/m/queue/${encodeURIComponent(queueJoinId)}`)
      stopTransitionLoader(APP_QUEUE_TRANSITION_LOADER_MS)
      return queueJoinId
    },
    [navigate, sessionMeta?.station?.publicId, startTransitionLoader, stopTransitionLoader]
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

      try {
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
        startTransitionLoader(APP_RESERVATION_WORDS)
        navigate('/m/reservations')
        stopTransitionLoader(APP_TRANSITION_LOADER_MS)
        return response
      } catch (error) {
        stopTransitionLoader(0)
        throw error
      }
    },
    [navigate, sessionMeta?.station?.publicId, startTransitionLoader, stopTransitionLoader]
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
    [sessionMeta?.station?.publicId]
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
    [sessionMeta?.station?.publicId]
  )

  const refreshActiveQueue = useCallback(async () => {
    if (!isAuthenticated) {
      clearStoredActiveQueueJoinId()
      setActiveQueueJoinId('')
      return null
    }

    try {
      if (queueData === userQueueApi) {
        const payload = await userQueueApi.getActiveQueue()
        const queueJoinId = String(payload?.queueJoinId || payload?.status?.queueJoinId || '').trim()

        if (queueJoinId) {
          setStoredActiveQueueJoinId(queueJoinId)
          setActiveQueueJoinId(queueJoinId)
        } else {
          clearStoredActiveQueueJoinId()
          setActiveQueueJoinId('')
        }

        return payload?.status || null
      }

      const persistedJoinId = String(getStoredActiveQueueJoinId() || '').trim()
      if (!persistedJoinId) {
        setActiveQueueJoinId('')
        return null
      }

      const snapshot = await queueMockService.getStatus(persistedJoinId)
      setActiveQueueJoinId(persistedJoinId)
      return snapshot
    } catch (error) {
      if (requiresAuth && isSessionExpiryError(error)) {
        resetInvalidUserSessionRef.current()
        return null
      }

      if (isQueueEntryMissingError(error)) {
        clearActiveQueueScopeRef.current()
      }

      return null
    }
  }, [isAuthenticated])

  const isSendCreditRouteActive = pathname === '/m/wallet/send-credit'

  useEffect(() => {
    let cancelled = false
    let refreshTimerId = 0
    let requestInFlight = false

    const loadStations = async () => {
      if (requestInFlight) return
      requestInFlight = true

      if (requiresAuth && !isAuthenticated) {
        if (!cancelled) {
          previousStationsSnapshotRef.current = []
          setStationsData([])
          setStationsLoading(false)
          setStationsError('')
        }
        requestInFlight = false
        return
      }

      if (!stationsApi.isApiMode()) {
        if (!cancelled) {
          previousStationsSnapshotRef.current = mockStations
          setStationsData(mockStations)
          setStationsLoading(false)
          setStationsError('')
        }
        requestInFlight = false
        return
      }

      if (!cancelled) {
        setStationsLoading(true)
        setStationsError('')
      }

      try {
        const rows = await stationsApi.listStations()
        if (cancelled) return
        previousStationsSnapshotRef.current = rows
        setStationsData(rows)
      } catch (error) {
        if (cancelled) return

        if (requiresAuth && isSessionExpiryError(error)) {
          clearStoredAuthSession()
          previousStationsSnapshotRef.current = []
          setAccessToken('')
          setSessionMeta(null)
          setStationsData([])
          setStationsError('')
          setStationsLoading(false)
          navigate('/m/login', { replace: true })
          return
        }

        previousStationsSnapshotRef.current = []
        setStationsData([])
        setStationsError(error?.message || 'Unable to load stations from API.')
      } finally {
        if (!cancelled) {
          setStationsLoading(false)
        }
        requestInFlight = false
      }
    }

    loadStations()

    if (stationsApi.isApiMode() && isAuthenticated && favoriteStationIds.length && !isSendCreditRouteActive) {
      refreshTimerId = window.setInterval(() => {
        loadStations()
      }, STATION_PRICE_REFRESH_MS)
    }

    return () => {
      cancelled = true
      if (refreshTimerId) {
        window.clearInterval(refreshTimerId)
      }
    }
  }, [accessToken, favoriteStationIds.length, isAuthenticated, isSendCreditRouteActive, navigate])

  useEffect(() => {
    if (!isPushSupported()) {
      setNotificationsPermission('unsupported')
      return
    }
    setNotificationsPermission(String(window.Notification.permission || 'default'))
  }, [])

  useEffect(() => {
    if (!isPushSupported()) {
      setNotificationsEnabled(false)
      setStoredNotificationsEnabled(false)
      return
    }
    if (notificationsPermission === 'granted') {
      const storedPreference = getStoredNotificationsPreference()
      if (storedPreference === null) {
        setNotificationsEnabled(true)
        setStoredNotificationsEnabled(true)
      }
      return
    }
    setNotificationsEnabled(false)
    setStoredNotificationsEnabled(false)
  }, [notificationsPermission])

  useEffect(() => {
    if (!userQueueApi.isApiMode()) return
    if (!isAuthenticated || !notificationsEnabled || notificationsPermission !== 'granted') return
    if (!isPushSupported()) return

    let cancelled = false
    const syncPushSubscription = async () => {
      try {
        const pushConfig = await userQueueApi.getPushPublicKey()
        if (!pushConfig?.enabled || !pushConfig?.publicKey) return
        await registerSmartlinkServiceWorker()
        const subscription = await ensurePushSubscription({
          vapidPublicKey: pushConfig.publicKey,
        })
        const payload = toPushSubscriptionPayload(subscription)
        if (!payload || cancelled) return
        await userQueueApi.subscribePush(payload)
      } catch {
        // Keep silent; UI toggle will surface actionable setup errors.
      }
    }

    syncPushSubscription()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, notificationsEnabled, notificationsPermission])

  useEffect(() => {
    if (!notificationsEnabled) {
      shownNotificationIdsRef.current.clear()
    }
  }, [notificationsEnabled])

  useEffect(() => {
    if (!isAuthenticated) {
      clearStoredActiveQueueJoinId()
      setActiveQueueJoinId('')
      return undefined
    }

    void refreshActiveQueue()
    const timerId = window.setInterval(() => {
      void refreshActiveQueue()
    }, 30000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [accessToken, isAuthenticated, refreshActiveQueue])

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
      }

      void refreshActiveQueue()
    })
  }, [isAuthenticated, refreshActiveQueue])

  useEffect(() => {
    const scopedQueueJoinId = String(activeQueueJoinId || '').trim()
    queueBgSnapshotRef.current = null
    queueBgNotificationStateRef.current = {
      queueJoinId: scopedQueueJoinId,
      calledNotified: false,
      approachingTop3Notified: false,
    }
  }, [activeQueueJoinId])

  useEffect(() => {
    if (!userQueueApi.isApiMode() || !isAuthenticated || !accessToken) {
      disconnectAlertsSocket()
      setUnreadAlertsCount(0)
      return undefined
    }
    if (typeof userQueueApi.connectUserAlertsSocket !== 'function') {
      return undefined
    }

    let mounted = true

    const safeRefreshUnreadAlertsCount = async () => {
      try {
        await refreshUnreadAlertsCount()
      } catch (error) {
        if (!mounted) return
        if (isSessionExpiryError(error)) {
          resetInvalidUserSessionRef.current()
          return
        }
      }
    }

    const scheduleReconnect = () => {
      if (!mounted || unreadAlertsReconnectTimerRef.current) return
      const attempt = unreadAlertsReconnectAttemptRef.current
      const delay = ALERTS_RECONNECT_BACKOFF_MS[Math.min(attempt, ALERTS_RECONNECT_BACKOFF_MS.length - 1)]
      unreadAlertsReconnectAttemptRef.current = attempt + 1
      unreadAlertsReconnectTimerRef.current = window.setTimeout(() => {
        unreadAlertsReconnectTimerRef.current = 0
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      if (!mounted) return
      try {
        const unsubscribe = userQueueApi.connectUserAlertsSocket({
          onOpen: () => {
            if (!mounted) return
            unreadAlertsReconnectAttemptRef.current = 0
            safeRefreshUnreadAlertsCount()
          },
          onClose: (event) => {
            if (!mounted) return
            if (isRealtimeAuthClose(event)) {
              resetInvalidUserSessionRef.current()
              return
            }
            scheduleReconnect()
          },
          onError: () => {
            if (!mounted) return
            scheduleReconnect()
          },
          onMessage: (message) => {
            if (!mounted || !message || typeof message !== 'object') return
            if (message.type === 'user_alert:new') {
              showSystemAlertNotification(message.data || {})
              emitSmartlinkUserAlert(message.data || {})
              safeRefreshUnreadAlertsCount()
            } else if (message.type === 'user_alert:read' || message.type === 'user_alert:archived') {
              safeRefreshUnreadAlertsCount()
            }
          },
        })
        unsubscribeAlertsSocketRef.current = unsubscribe
      } catch {
        scheduleReconnect()
      }
    }

    safeRefreshUnreadAlertsCount()
    connectSocket()

    return () => {
      mounted = false
      disconnectAlertsSocket()
    }
  }, [
    accessToken,
    disconnectAlertsSocket,
    isAuthenticated,
    navigate,
    refreshUnreadAlertsCount,
    showSystemAlertNotification,
  ])

  useEffect(() => {
    const scopedQueueJoinId = String(activeQueueJoinId || '').trim()
    if (
      !userQueueApi.isApiMode() ||
      !isAuthenticated ||
      !accessToken ||
      !scopedQueueJoinId ||
      isQueueScreenActive
    ) {
      disconnectQueueBackgroundSocket()
      return undefined
    }
    if (typeof userQueueApi.connectQueueSocket !== 'function') {
      return undefined
    }

    let mounted = true

    const maybeNotifyQueueStatus = (snapshot) => {
      if (!snapshot || !mounted) return

      const state = queueBgNotificationStateRef.current
      if (state.queueJoinId !== scopedQueueJoinId) {
        state.queueJoinId = scopedQueueJoinId
        state.calledNotified = false
        state.approachingTop3Notified = false
      }

      const queueStatus = String(snapshot.queueStatus || '').trim().toUpperCase()
      const position = Number(snapshot.position)

      if (queueStatus === 'CALLED' && !state.calledNotified) {
        showBrowserNotification({
          notificationId: `queue:${scopedQueueJoinId}:called`,
          title: "It's your turn",
          message: 'Proceed to the station now.',
          path: `/m/queue/${encodeURIComponent(scopedQueueJoinId)}`,
        })
        state.calledNotified = true
      }

      if (Number.isFinite(position) && position > 0 && position <= 3 && !state.approachingTop3Notified) {
        showBrowserNotification({
          notificationId: `queue:${scopedQueueJoinId}:near-top-3`,
          title: 'You are approaching the pump',
          message: `Queue position #${position}. Please get ready.`,
          path: `/m/queue/${encodeURIComponent(scopedQueueJoinId)}`,
        })
        state.approachingTop3Notified = true
      }
    }

    const scheduleReconnect = () => {
      if (!mounted || queueBgReconnectTimerRef.current) return
      const attempt = queueBgReconnectAttemptRef.current
      const delay = QUEUE_BG_RECONNECT_BACKOFF_MS[Math.min(attempt, QUEUE_BG_RECONNECT_BACKOFF_MS.length - 1)]
      queueBgReconnectAttemptRef.current = attempt + 1
      queueBgReconnectTimerRef.current = window.setTimeout(() => {
        queueBgReconnectTimerRef.current = 0
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      if (!mounted) return
      try {
        const unsubscribe = userQueueApi.connectQueueSocket({
          queueJoinId: scopedQueueJoinId,
          onOpen: () => {
            if (!mounted) return
            queueBgReconnectAttemptRef.current = 0
          },
          onClose: (event) => {
            if (!mounted) return
            if (isRealtimeAuthClose(event)) {
              resetInvalidUserSessionRef.current()
              return
            }
            if (isQueueRealtimeScopeClose(event)) {
              clearActiveQueueScopeRef.current()
              return
            }
            scheduleReconnect()
          },
          onError: () => {
            if (!mounted) return
            scheduleReconnect()
          },
          onMessage: (message) => {
            if (!mounted || !message || typeof message !== 'object') return
            const mergedSnapshot = mergeQueueRealtimeSnapshot(queueBgSnapshotRef.current, message)
            if (mergedSnapshot) {
              queueBgSnapshotRef.current = mergedSnapshot
              maybeNotifyQueueStatus(mergedSnapshot)
            }
          },
        })
        unsubscribeQueueBgSocketRef.current = unsubscribe
      } catch {
        scheduleReconnect()
      }
    }

    const bootstrapQueueSnapshot = async () => {
      try {
        const initialSnapshot = await userQueueApi.getStatus(scopedQueueJoinId)
        if (!mounted || !initialSnapshot) return
        queueBgSnapshotRef.current = initialSnapshot
        maybeNotifyQueueStatus(initialSnapshot)
      } catch (error) {
        if (!mounted) return
        if (isSessionExpiryError(error)) {
          resetInvalidUserSessionRef.current()
          return
        }
        if (isQueueEntryMissingError(error)) {
          clearActiveQueueScopeRef.current()
        }
      }
    }

    bootstrapQueueSnapshot()
    connectSocket()

    return () => {
      mounted = false
      disconnectQueueBackgroundSocket()
    }
  }, [
    accessToken,
    activeQueueJoinId,
    disconnectQueueBackgroundSocket,
    isAuthenticated,
    isQueueScreenActive,
    navigate,
    showBrowserNotification,
  ])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setBootReady(true)
    }, APP_BOOT_LOADER_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  useEffect(() => {
    if (bootReady && !isTransitionLoading) return undefined
    const timerId = window.setInterval(() => {
      setLoaderWordIndex((index) => (index + 1) % loaderWords.length)
    }, 650)

    return () => {
      window.clearInterval(timerId)
    }
  }, [bootReady, isTransitionLoading, loaderWords])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (pathname === '/m') {
      navigate(isAuthenticated ? '/m/home' : '/m/login', { replace: true })
      return
    }

    if (!pathname.startsWith('/m/')) {
      navigate(isAuthenticated ? '/m/home' : '/m/login', { replace: true })
      return
    }

    if (requiresAuth && !isAuthenticated && pathname !== '/m/login') {
      navigate('/m/login', { replace: true })
      return
    }

    if (requiresAuth && isAuthenticated && pathname === '/m/login') {
      navigate('/m/home', { replace: true })
    }
  }, [isAuthenticated, navigate, pathname])

  const route = matchMobileRoute(pathname)
  const routeParamId = route.params?.id

  useEffect(() => {
    const storedQueueJoinId = getStoredActiveQueueJoinId()
    if (!storedQueueJoinId || storedQueueJoinId === activeQueueJoinId) return
    setActiveQueueJoinId(storedQueueJoinId)
  }, [activeQueueJoinId, pathname])

  useEffect(() => {
    setStoredFavoriteStationIds(favoriteStationIds)
  }, [favoriteStationIds])

  useEffect(() => {
    if (!stationsApi.isApiMode() || !isAuthenticated) {
      favoriteSyncReadyRef.current = false
      remoteFavoriteStationIdsRef.current = []
      return undefined
    }

    let cancelled = false

    const loadRemotePreferences = async () => {
      try {
        const preferences = await userAuthApi.getPreferences()
        if (cancelled) return

        const remoteFavoriteStationIds = normalizeStringList(preferences?.favoriteStationPublicIds)
        const mergedFavoriteStationIds = mergeStringLists(
          remoteFavoriteStationIds,
          favoriteStationIdsRef.current
        )

        remoteFavoriteStationIdsRef.current = mergedFavoriteStationIds
        favoriteSyncReadyRef.current = true

        if (!sameStringList(mergedFavoriteStationIds, favoriteStationIdsRef.current)) {
          setFavoriteStationIds(mergedFavoriteStationIds)
        }

        if (!sameStringList(remoteFavoriteStationIds, mergedFavoriteStationIds)) {
          await userAuthApi.updatePreferences({
            favoriteStationPublicIds: mergedFavoriteStationIds,
          }).catch(() => {})
        }
      } catch {
        if (cancelled) return
        favoriteSyncReadyRef.current = true
        await userAuthApi.updatePreferences({
          favoriteStationPublicIds: favoriteStationIdsRef.current,
        }).catch(() => {})
      }
    }

    loadRemotePreferences()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!stationsApi.isApiMode() || !isAuthenticated) return
    if (!favoriteSyncReadyRef.current) return
    if (sameStringList(remoteFavoriteStationIdsRef.current, favoriteStationIds)) return

    let cancelled = false

    const syncRemoteFavorites = async () => {
      try {
        await userAuthApi.updatePreferences({
          favoriteStationPublicIds: favoriteStationIds,
        })
        if (cancelled) return
        remoteFavoriteStationIdsRef.current = [...favoriteStationIds]
      } catch {
        // Keep local favorites even if remote sync fails.
      }
    }

    syncRemoteFavorites()

    return () => {
      cancelled = true
    }
  }, [favoriteStationIds, isAuthenticated])

  useEffect(() => {
    if (route.name !== 'queue-status') return
    if (!routeParamId) return
    setStoredActiveQueueJoinId(routeParamId)
    setActiveQueueJoinId(routeParamId)
  }, [route.name, routeParamId])

  useEffect(() => {
    document.title = titleForRoute(route.name)
  }, [route.name])

  useEffect(() => {
    const rootElement = document.getElementById('root')
    if (!rootElement) return undefined

    const lockOverflow = route.name === 'home'
    rootElement.classList.toggle('home-no-overflow', lockOverflow)

    return () => {
      rootElement.classList.remove('home-no-overflow')
    }
  }, [route.name])

  useEffect(() => {
    if (route.name === 'activity') return
    setShowQueueStationPicker(false)
  }, [route.name])

  const station = routeParamId ? stationsData.find((item) => item.id === routeParamId) || null : null
  const favoriteStations = favoriteStationIds
    .map((favoriteId) => stationsData.find((item) => item.id === favoriteId) || null)
    .filter(Boolean)
  const queuePickerStations = [...stationsData]
    .sort((a, b) => Number(a.distanceKm || 999) - Number(b.distanceKm || 999))
    .slice(0, 12)
  const showStationBootstrap = stationsApi.isApiMode() && route.name !== 'login' && route.name !== 'queue-status'
  const showAppLoader =
    !bootReady ||
    isTransitionLoading ||
    (showStationBootstrap && stationsLoading && !stationsError && !stationsData.length)

  if (showAppLoader) {
    return (
      <section className='app-loader-screen' role='status' aria-live='polite' aria-label='Loading SmartLink app'>
        <article className='app-loader-card'>
          <img src='/smartlogo.png' alt='SmartLink' className='app-loader-logo' />
          <h2>SmartLink User</h2>
          <p>
            Loading{' '}
            <span key={loaderWords[loaderWordIndex]} className='app-loader-word'>
              {loaderWords[loaderWordIndex]}
            </span>
          </p>
          <div className='app-loader-bars' aria-hidden='true'>
            <span />
            <span />
            <span />
          </div>
        </article>
      </section>
    )
  }

  let screen = null

  if (showStationBootstrap && stationsLoading) {
    screen = (
      <section className='queue-loading-card'>
        <h3>Loading Data...</h3>
        <p>Please wait, results in few minutes </p>
      </section>
    )
  } else if (showStationBootstrap && stationsError) {
    screen = (
      <section className='queue-loading-card'>
        <h3>Unable to load stations</h3>
        <p>{stationsError}</p>
      </section>
    )
  } else if (showStationBootstrap && !stationsData.length) {
    screen = (
      <section className='queue-loading-card'>
        <h3>No stations available</h3>
        <p>Add active stations in the database and refresh.</p>
      </section>
    )
  } else if (route.name === 'login') {
    screen = <LoginScreen onAuthenticated={handleAuthenticated} />
  } else if (route.name === 'home') {
    screen = (
      <MapHomeScreen
        theme={theme}
        stations={stationsData}
        onViewStation={(id) => navigateWithTransition(`/m/stations/${id}`, { words: APP_STATION_WORDS })}
      />
    )
  } else if (route.name === 'orders') {
    screen = <OrdersScreen />
  } else if (route.name === 'activity') {
    screen = activeQueueJoinId ? (
      <QueueStatusScreen
        queueJoinId={activeQueueJoinId}
        onBack={() => navigate('/m/home')}
        onLeaveComplete={() => {
          clearStoredActiveQueueJoinId()
          setActiveQueueJoinId('')
          navigate('/m/activity', { replace: true })
        }}
      />
    ) : (
      <>
        <section className='station-card coming-soon'>
          <h3>No active queue</h3>
          <p>Join a station queue to track your position here.</p>
          <button type='button' className='primary-button' onClick={() => setShowQueueStationPicker(true)}>
            Browse Stations
          </button>
        </section>

        {showQueueStationPicker ? (
          <div
            className='queue-modal-backdrop'
            role='presentation'
            onClick={() => setShowQueueStationPicker(false)}
          >
            <div
              className='queue-modal'
              role='dialog'
              aria-modal='true'
              aria-label='Choose station'
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <h3>Choose Station</h3>
                <button type='button' onClick={() => setShowQueueStationPicker(false)}>
                  Close
                </button>
              </header>

              <div className='queue-station-picker'>
                {queuePickerStations.length ? (
                  queuePickerStations.map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      className='queue-station-picker-item'
                      onClick={() => {
                        setShowQueueStationPicker(false)
                        setPendingJoinStationId(item.id)
                        navigateWithTransition(`/m/stations/${item.id}`, { words: APP_STATION_WORDS })
                      }}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.address}</small>
                      </span>
                      <em>{Number(item.distanceKm || 0).toFixed(1)} km</em>
                    </button>
                  ))
                ) : (
                  <p className='queue-station-picker-empty'>No stations available right now.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  } else if (route.name === 'stations') {
    screen = (
      <StationsScreen
        stations={stationsData}
        onSelectStation={(id) => navigateWithTransition(`/m/stations/${id}`, { words: APP_STATION_WORDS })}
      />
    )
  } else if (route.name === 'station-details') {
    screen = (
      <StationDetailsScreen
        station={station}
        onBack={() => navigate('/m/home')}
        onDirections={(id) => navigateWithTransition(`/m/directions/${id}`, { words: APP_ROUTE_WORDS })}
        onJoinQueue={joinQueueFromStation}
        onReserve={createReservationFromStation}
        onGetReservationSlots={getReservationSlotsForStation}
        onConnectReservationRealtime={connectReservationSlotRealtime}
        isFavorite={Boolean(station && favoriteStationIds.includes(station.id))}
        onToggleFavorite={toggleFavoriteStation}
        autoOpenJoinModal={Boolean(station && pendingJoinStationId === station.id)}
        onAutoOpenJoinConsumed={() => setPendingJoinStationId('')}
      />
    )
  } else if (route.name === 'saved') {
    screen = (
      <SavedScreen
        stations={favoriteStations}
        onSelectStation={(id) => navigateWithTransition(`/m/stations/${id}`, { words: APP_STATION_WORDS })}
      />
    )
  } else if (route.name === 'directions') {
    screen = <DirectionsScreen station={station} onBack={() => navigate(`/m/stations/${routeParamId || ''}`)} />
  } else if (route.name === 'queue-status') {
    screen = (
      <QueueStatusScreen
        queueJoinId={routeParamId}
        onBack={() => navigate('/m/stations')}
        onLeaveComplete={() => {
          upsertStoredQueueHistoryItem({
            queueJoinId: routeParamId,
            queueStatus: 'LEFT',
            leftAt: new Date().toISOString(),
          })
          clearStoredActiveQueueJoinId()
          navigate('/m/home', { replace: true })
        }}
      />
    )
  } else if (route.name === 'wallet') {
    screen = <WalletScreen onOpenSendCredit={() => navigate('/m/wallet/send-credit')} />
  } else if (route.name === 'send-credit') {
    screen = (
      <SendCreditScreen
        stations={stationsData}
        onBack={() => navigate('/m/wallet')}
      />
    )
  } else if (route.name === 'more') {
    screen = (
      <MoreScreen
        onNavigate={(path) => navigate(path)}
        onLogout={handleLogout}
        unreadAlertsCount={unreadAlertsCount}
      />
    )
  } else if (route.name === 'reservations') {
    screen = <ReservationsScreen />
  } else if (route.name === 'history') {
    screen = (
      <HistoryScreen
        activeQueueJoinId={activeQueueJoinId}
        onOpenQueue={(queueJoinId) => navigate(`/m/queue/${encodeURIComponent(queueJoinId)}`)}
      />
    )
  } else if (route.name === 'alerts') {
    screen = <AlertsScreen />
  } else if (route.name === 'help') {
    screen = <HelpScreen />
  } else if (route.name === 'settings') {
    screen = (
      <SettingsScreen
        profile={sessionMeta?.user || null}
        station={sessionMeta?.station || null}
        theme={theme}
        notificationsEnabled={notificationsEnabled}
        notificationsPermission={notificationsPermission}
        onToggleNotifications={handleNotificationsToggle}
        onSaveProfile={handleProfileSave}
        onOpenWallet={() => navigate('/m/wallet')}
        onLogout={handleLogout}
        onThemeChange={onThemeChange}
      />
    )
  } else if (route.name === 'assistant') {
    screen = <AssistantScreen layout='mobile' onBack={() => navigate('/m/home')} />
  } else {
    screen = (
      <AccountScreen
        onLogout={handleLogout}
        onNavigate={navigate}
        profile={sessionMeta?.user || null}
        station={sessionMeta?.station || null}
      />
    )
  }

  return (
    <MobileShell
      activeTab={activeTabForRoute(route.name)}
      onNavigate={navigate}
      showTabBar={route.name !== 'station-details' && route.name !== 'queue-status' && route.name !== 'login'}
      showAssistantLauncher={route.name !== 'assistant' && route.name !== 'login'}
      onOpenAssistant={() => navigate('/m/assistant')}
      unreadAlertsCount={unreadAlertsCount}
    >
      {screen}
    </MobileShell>
  )
}

function App() {
  const { pathname, navigate } = useMiniRouter()
  const isMobile = useMobileViewport(768)
  const [theme, setTheme] = useState(() => getStoredThemePreference())
  const normalizedPath = String(pathname || '').trim()
  const isPublicEntryRoute =
    normalizedPath === '/' ||
    normalizedPath === '/landing'
  const handleThemeChange = useCallback((nextTheme) => {
    const normalizedTheme = nextTheme === 'dark' ? 'dark' : 'light'
    setStoredThemePreference(normalizedTheme)
    setTheme(normalizedTheme)
  }, [])

  let content = null

  useEffect(() => {
    const root = document.documentElement
    const { body } = document
    if (!root || !body) return undefined

    if (isPublicEntryRoute) {
      delete body.dataset.userTheme
      root.style.colorScheme = ''
      return undefined
    }

    const normalizedTheme = theme === 'dark' ? 'dark' : 'light'
    body.dataset.userTheme = normalizedTheme
    root.style.colorScheme = normalizedTheme

    return () => {
      if (body.dataset.userTheme === normalizedTheme) {
        delete body.dataset.userTheme
      }
      if (root.style.colorScheme === normalizedTheme) {
        root.style.colorScheme = ''
      }
    }
  }, [isPublicEntryRoute, theme])

  if (isPublicEntryRoute) {
    const loginPath = isMobile ? '/m/login' : '/d/login'
    const mapPath = isMobile ? '/m/home' : '/d/stations'
    content = (
      <LandingPage
        onOpenMap={() => navigate(mapPath)}
        onLogin={() => navigate(loginPath)}
        onSignUp={() => navigate(loginPath)}
      />
    )
  } else if (isMobile) {
    content = <MobileApp theme={theme} onThemeChange={handleThemeChange} />
  } else {
    content = <DesktopApp theme={theme} onThemeChange={handleThemeChange} />
  }

  return (
    <>
      <GlobalWalletTransferCelebration />
      {content}
    </>
  )
}

export default App

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { canAccessPath, firstAccessiblePath, hasAnyPermission, hasPermission } from './access'
import { clearSession, portalApi, readStoredSession, resolvePortalWebSocketUrl, storeSession } from './portalApi'
import { writeLastLoginAppearance } from './loginAppearanceCache'
import { MERA_PACKET_KEYS, filterPacketKeysForUser, normalizePacketKeys, routePacketKeys, routeSyncPacketKeys, type MeraPacketKey, type MeraPacketStatus, type MeraRealtimeMode } from './packetRegistry'

const PortalContext = createContext<any>(null)

export type MeraAppearance = 'light' | 'system' | 'dark' | 'black-white'

const defaultPreferences = {
  appearance: 'light' as MeraAppearance,
  density: 'comfortable',
  landingPage: 'dashboard',
  compactTables: false,
  shortageAlerts: true,
  complaintsAlerts: true,
  dailyDigest: true,
  browserNotifications: false,
  sessionTimeout: '30',
  requireStepUp: true,
  trustedDevice: false,
  dashboardBackgroundEnabled: false,
  dashboardBackgroundImage: '',
  dashboardBackgroundName: '',
  dashboardBackgroundMode: 'cover',
  dashboardBackgroundX: 50,
  dashboardBackgroundY: 50,
  dashboardBackgroundScale: 100,
  dashboardBackgroundDim: 74,
  transparentSectionsEnabled: true,
  sectionTransparency: 18,
  sectionBlur: 10,
  accentTone: 'smartlink',
  pageRhythm: 'balanced',
  numberEmphasis: 'standard',
  dashboardFocus: 'standard',
  motionStyle: 'calm',
}

const SOCKET_TIMEOUT_MS = 5000
const POLL_INTERVAL_MS = 12000
const HEARTBEAT_INTERVAL_MS = 25000
const FALLBACK_RECONNECT_INTERVAL_MS = 7000
const RETRY_BACKOFF_MS = [2000, 5000, 10000, 15000]
const PACKET_REQUEST_TIMEOUT_MS = 10000
const INVALIDATION_DEBOUNCE_MS = 250
const PORTAL_RESOURCE_KEYS = new Set(['preferences', 'schoolData', 'studentPortal', 'timetables', 'examLab'])
type PacketRequestOptions = {
  paramsByKey?: Record<string, any>
  reason?: string
  force?: boolean
  timeoutMs?: number
  primaryOnly?: boolean
  preferHttp?: boolean
}

function makeRequestId() {
  return `mera-packets-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function packetParams(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function currentRoutePacketKeys() {
  if (typeof window === 'undefined') return MERA_PACKET_KEYS.slice()
  return routePacketKeys(window.location.pathname)
}

function hasPacketValue(data: any, key: string) {
  return Object.prototype.hasOwnProperty.call(data || {}, key) && data?.[key] !== undefined
}

function normalizePortalResources(resources?: readonly string[] | string | null): string[] {
  const raw = Array.isArray(resources) ? resources : String(resources || '').split(',')
  return [...new Set(raw.map((resource) => String(resource || '').trim()).filter((resource) => PORTAL_RESOURCE_KEYS.has(resource)))]
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(() => readStoredSession())
  const [data, setData] = useState<any>({})
  const [packetStatus, setPacketStatus] = useState<Record<string, MeraPacketStatus>>({})
  const [packetErrors, setPacketErrors] = useState<Record<string, string>>({})
  const [realtimeMode, setRealtimeMode] = useState<MeraRealtimeMode>('disabled')
  const [selectedProfile, setSelectedProfile] = useState<any>(null)
  const [selectedProfileEnforcement, setSelectedProfileEnforcement] = useState<any>({ items: [] })
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionLabel, setActionLabel] = useState('Completing request...')
  const [bootLoading, setBootLoading] = useState(false)
  const [loginSuccessGate, setLoginSuccessGate] = useState(false)
  const [loginPreloadSettled, setLoginPreloadSettled] = useState(false)
  const [realtimePulse, setRealtimePulse] = useState(0)
  const [portalSyncEvent, setPortalSyncEvent] = useState<any>({ pulse: 0, keys: [], resources: [], reason: '' })
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [pendingLoginChallenge, setPendingLoginChallenge] = useState<any>(null)
  const [preferences, setPreferences] = useState<any>(defaultPreferences)
  const [preferencesLoading, setPreferencesLoading] = useState(false)

  const token = session?.accessToken || ''
  const user = session?.user || null
  const permissionSignature = JSON.stringify(user?.permissions || [])
  const actionLoadingRef = useRef(false)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingPacketRequestsRef = useRef(new Map<string, { keys: MeraPacketKey[]; resolve: (value: any) => void; timer?: number }>())
  const pendingInvalidationKeysRef = useRef<MeraPacketKey[]>([])
  const invalidationTimerRef = useRef(0)
  const pollingKeysRef = useRef<MeraPacketKey[]>([])
  const httpRequestSeqRef = useRef(0)
  const dataRef = useRef<any>({})
  const packetStatusRef = useRef<Record<string, MeraPacketStatus>>({})

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    packetStatusRef.current = packetStatus
  }, [packetStatus])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const appearance = String(preferences?.appearance || 'light') as MeraAppearance
    const useBlackTheme = appearance === 'dark' || appearance === 'black-white'

    if (useBlackTheme) {
      root.classList.add('dark')
      root.dataset.meraTheme = 'black'
      root.dataset.theme = 'dark'
      return
    }

    root.classList.remove('dark')
    delete root.dataset.meraTheme
    delete root.dataset.theme
  }, [preferences?.appearance])

  const refreshSession = useCallback(async (accessToken = token) => {
    if (!accessToken) return null
    try {
      const payload = await portalApi.me(accessToken)
      setSession((current: any) => {
        const next = {
          ...(current || {}),
          accessToken,
          sessionPublicId: payload?.sessionPublicId || current?.sessionPublicId || null,
          user: payload?.user || current?.user || null,
        }
        storeSession(next)
        return next
      })
      return payload
    } catch {
      return null
    }
  }, [token])

  const markPacketsLoading = useCallback((keys: MeraPacketKey[]) => {
    if (!keys.length) return
    setPacketStatus((current) => {
      const next = { ...current }
      keys.forEach((key) => {
        next[key] = 'loading'
      })
      return next
    })
    setPacketErrors((current) => {
      const next = { ...current }
      keys.forEach((key) => {
        delete next[key]
      })
      return next
    })
    setLoading(true)
  }, [])

  const applyPacketResult = useCallback((result: any) => {
    const key = String(result?.key || '').trim() as MeraPacketKey
    if (!normalizePacketKeys([key]).length) return

    const status = String(result?.status || (result?.error ? 'error' : 'ready')) as MeraPacketStatus
    if (status === 'ready') {
      setData((current: any) => ({ ...current, [key]: result.data }))
      setPacketStatus((current) => ({ ...current, [key]: 'ready' }))
      setPacketErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setRealtimePulse(Date.now())
      return
    }

    setPacketStatus((current) => ({ ...current, [key]: status === 'forbidden' ? 'forbidden' : 'error' }))
    setPacketErrors((current) => ({ ...current, [key]: result?.error || 'Unable to load MERA data packet.' }))
  }, [])

  const completePacketRequest = useCallback((keys: MeraPacketKey[], message: any = {}) => {
    const errors = Array.isArray(message?.errors) ? message.errors : []
    const forbidden = new Set(normalizePacketKeys(message?.forbidden))
    const errorByKey = new Map<string, string>()
    const genericError = errors.find((item: any) => !item?.key)?.error || errors.find((item: any) => !item?.key)?.message || ''

    errors.forEach((item: any) => {
      const [key] = normalizePacketKeys([item?.key])
      if (key) errorByKey.set(key, item?.error || item?.message || 'Unable to load MERA data packet.')
    })

    setPacketStatus((current) => {
      const next = { ...current }
      keys.forEach((key) => {
        if (next[key] !== 'loading') return
        if (forbidden.has(key)) next[key] = 'forbidden'
        else if (errorByKey.has(key) || genericError) next[key] = 'error'
        else next[key] = hasPacketValue(dataRef.current, key) ? 'ready' : 'error'
      })
      return next
    })

    setPacketErrors((current) => {
      const next = { ...current }
      keys.forEach((key) => {
        if (forbidden.has(key)) next[key] = 'Forbidden MERA packet.'
        else if (errorByKey.has(key)) next[key] = errorByKey.get(key) || 'Unable to load MERA data packet.'
        else if (genericError && !hasPacketValue(dataRef.current, key)) next[key] = genericError
      })
      return next
    })
  }, [])

  const selectPacketRequestKeys = useCallback((keys: MeraPacketKey[], force = false) => {
    if (force) return keys
    const currentData = dataRef.current
    const currentStatus = packetStatusRef.current
    return keys.filter((key) => {
      if (currentStatus[key] === 'loading') return false
      if (currentStatus[key] === 'forbidden' && !hasPacketValue(currentData, key)) return false
      return !hasPacketValue(currentData, key)
    })
  }, [])

  const fetchPacketsViaHttp = useCallback(async (
    keysInput?: readonly string[] | string | null,
    options: PacketRequestOptions = {},
  ) => {
    if (!token) return []
    const requestedKeys = normalizePacketKeys(keysInput).length ? normalizePacketKeys(keysInput) : MERA_PACKET_KEYS.slice()
    const keys = filterPacketKeysForUser(requestedKeys, user)
    if (!keys.length) return []

    const requestSeq = httpRequestSeqRef.current + 1
    httpRequestSeqRef.current = requestSeq
    markPacketsLoading(keys)
    const paramsByKey = packetParams(options.paramsByKey)

    const results = await Promise.all(keys.map(async (key) => {
      try {
        const payload = await portalApi.getPacket(token, key, packetParams(paramsByKey[key]))
        const result = { key, status: 'ready', data: payload }
        if (httpRequestSeqRef.current === requestSeq) applyPacketResult(result)
        return result
      } catch (packetError: any) {
        const result = {
          key,
          status: packetError?.message?.toLowerCase?.().includes('forbidden') ? 'forbidden' : 'error',
          error: packetError?.message || 'Unable to load MERA data packet.',
        }
        if (httpRequestSeqRef.current === requestSeq) applyPacketResult(result)
        return result
      }
    }))

    if (httpRequestSeqRef.current === requestSeq) {
      setLoading(false)
    }

    return results
  }, [applyPacketResult, markPacketsLoading, token, user])

  const requestPackets = useCallback(async (
    keysInput?: readonly string[] | string | null,
    options: PacketRequestOptions = {},
  ) => {
    if (!token) return []
    const requestedKeys = normalizePacketKeys(keysInput).length ? normalizePacketKeys(keysInput) : MERA_PACKET_KEYS.slice()
    const permittedKeys = filterPacketKeysForUser(requestedKeys, user)
    const keys = selectPacketRequestKeys(permittedKeys, Boolean(options.force))
    if (!keys.length) return []

    if (options.preferHttp) {
      return fetchPacketsViaHttp(keys, options)
    }

    const socket = socketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      const requestId = makeRequestId()
      markPacketsLoading(keys)
      return new Promise((resolve) => {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(3000, Number(options.timeoutMs)) : PACKET_REQUEST_TIMEOUT_MS
        const timer = typeof window !== 'undefined'
          ? window.setTimeout(() => {
              pendingPacketRequestsRef.current.delete(requestId)
              fetchPacketsViaHttp(keys, { ...options, reason: `${options.reason || 'manual'}-timeout` }).then(resolve)
            }, timeoutMs)
          : undefined

        pendingPacketRequestsRef.current.set(requestId, { keys, resolve, timer })
        try {
          socket.send(JSON.stringify({
            type: 'mera_portal_packets_request',
            requestId,
            keys,
            paramsByKey: packetParams(options.paramsByKey),
            reason: options.reason || 'manual',
            force: Boolean(options.force),
          }))
        } catch {
          if (timer) window.clearTimeout(timer)
          pendingPacketRequestsRef.current.delete(requestId)
          fetchPacketsViaHttp(keys, options).then(resolve)
        }
      })
    }

    return fetchPacketsViaHttp(keys, options)
  }, [fetchPacketsViaHttp, markPacketsLoading, selectPacketRequestKeys, token, user])

  const requestRoutePackets = useCallback((pathname: string, options: PacketRequestOptions = {}) => {
    const keys = options.primaryOnly ? routeSyncPacketKeys(pathname) : routePacketKeys(pathname)
    pollingKeysRef.current = keys
    if (!keys.length) return Promise.resolve([])
    return requestPackets(keys, {
      paramsByKey: options.paramsByKey,
      force: options.force,
      timeoutMs: options.timeoutMs,
      preferHttp: options.preferHttp,
      reason: options.reason || 'route-packets',
    })
  }, [requestPackets])

  const refreshVisibleModules = useCallback((options: PacketRequestOptions & { keys?: readonly string[] } = {}) => {
    const keys = normalizePacketKeys(options.keys).length ? normalizePacketKeys(options.keys) : currentRoutePacketKeys()
    pollingKeysRef.current = keys
    if (!keys.length) return Promise.resolve([])
    return requestPackets(keys, { paramsByKey: options.paramsByKey, force: options.force, timeoutMs: options.timeoutMs, preferHttp: options.preferHttp, reason: options.reason || 'visible-refresh' })
  }, [requestPackets])

  const loadPreferences = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!token) {
      setPreferences(defaultPreferences)
      return defaultPreferences
    }

    const quiet = Boolean(options.quiet)
    if (!quiet) setPreferencesLoading(true)
    try {
      const payload = await portalApi.getMyPreferences(token)
      const merged = { ...defaultPreferences, ...(payload || {}) }
      setPreferences(merged)
      writeLastLoginAppearance(merged, user)
      return merged
    } catch {
      if (!quiet) setPreferences(defaultPreferences)
      return null
    } finally {
      if (!quiet) setPreferencesLoading(false)
    }
  }, [token, user])

  const schedulePacketInvalidation = useCallback((keysInput?: readonly string[] | string | null, reason = 'socket-invalidate') => {
    const keys = filterPacketKeysForUser(normalizePacketKeys(keysInput), user)
    if (!keys.length) return

    pendingInvalidationKeysRef.current = Array.from(new Set([
      ...pendingInvalidationKeysRef.current,
      ...keys,
    ]))

    if (typeof window === 'undefined') {
      const packetKeys = pendingInvalidationKeysRef.current
      pendingInvalidationKeysRef.current = []
      requestPackets(packetKeys, { reason, force: true }).catch(() => {})
      return
    }

    if (invalidationTimerRef.current) window.clearTimeout(invalidationTimerRef.current)
    invalidationTimerRef.current = window.setTimeout(() => {
      const packetKeys = pendingInvalidationKeysRef.current
      pendingInvalidationKeysRef.current = []
      invalidationTimerRef.current = 0
      requestPackets(packetKeys, { reason, force: true }).catch(() => {})
    }, INVALIDATION_DEBOUNCE_MS)
  }, [requestPackets, user])

  useEffect(() => {
    if (!token || typeof window === 'undefined') {
      setRealtimeMode('disabled')
      return undefined
    }

    let active = true
    let socket: WebSocket | null = null
    let connectTimeout = 0
    let reconnectTimer = 0
    let fallbackPollTimer = 0
    let fallbackReconnectTimer = 0
    let heartbeatTimer = 0
    let retryIndex = 0

    function clearTimer(timer: number) {
      if (timer) window.clearTimeout(timer)
    }

    function clearIntervalTimer(timer: number) {
      if (timer) window.clearInterval(timer)
    }

    function stopSocket() {
      if (!socket) return
      const current = socket
      current.onopen = null
      current.onmessage = null
      current.onclose = null
      current.onerror = null
      try {
        if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) {
          current.close(1000, 'client_disconnect')
        }
      } catch {
        // noop
      }
      socket = null
      socketRef.current = null
    }

    function pollOnce(reason = 'polling') {
      const keys = pollingKeysRef.current.length ? pollingKeysRef.current : currentRoutePacketKeys()
      fetchPacketsViaHttp(keys, { reason, force: false }).catch(() => {})
    }

    function startFallbackPolling(reason = 'websocket_unavailable') {
      if (!active) return
      setRealtimeMode('polling')
      pollOnce(reason)
      if (!fallbackPollTimer) {
        fallbackPollTimer = window.setInterval(() => pollOnce('polling-tick'), POLL_INTERVAL_MS)
      }
      if (!fallbackReconnectTimer) {
        fallbackReconnectTimer = window.setInterval(() => {
          if (!active || reconnectTimer) return
          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
          connectSocket()
        }, FALLBACK_RECONNECT_INTERVAL_MS)
      }
    }

    function startHeartbeat() {
      clearIntervalTimer(heartbeatTimer)
      heartbeatTimer = window.setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        try {
          socket.send(JSON.stringify({ type: 'ping', at: new Date().toISOString() }))
        } catch {
          startFallbackPolling('heartbeat_failed')
          stopSocket()
          scheduleReconnect()
        }
      }, HEARTBEAT_INTERVAL_MS)
    }

    function scheduleReconnect() {
      clearTimer(reconnectTimer)
      if (!active) return
      const waitMs = RETRY_BACKOFF_MS[Math.min(retryIndex, RETRY_BACKOFF_MS.length - 1)]
      retryIndex += 1
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connectSocket()
      }, waitMs)
    }

    function connectSocket() {
      if (!active) return
      if (typeof window.WebSocket !== 'function') {
        startFallbackPolling('websocket_unsupported')
        scheduleReconnect()
        return
      }

      stopSocket()
      clearTimer(connectTimeout)
      clearIntervalTimer(heartbeatTimer)
      if (!fallbackPollTimer) setRealtimeMode('connecting')

      try {
        socket = new WebSocket(resolvePortalWebSocketUrl('/ws/mera-dashboard', { accessToken: token }))
        socketRef.current = socket
      } catch {
        startFallbackPolling('websocket_create_failed')
        scheduleReconnect()
        return
      }

      let opened = false
      connectTimeout = window.setTimeout(() => {
        if (!active || opened) return
        startFallbackPolling('websocket_connect_timeout')
        stopSocket()
        scheduleReconnect()
      }, SOCKET_TIMEOUT_MS)

      socket.onopen = () => {
        if (!active) return
        opened = true
        retryIndex = 0
        clearTimer(connectTimeout)
        clearIntervalTimer(fallbackPollTimer)
        clearIntervalTimer(fallbackReconnectTimer)
        fallbackPollTimer = 0
        fallbackReconnectTimer = 0
        setRealtimeMode('websocket')
        startHeartbeat()
        requestPackets(currentRoutePacketKeys(), { reason: 'websocket-connected', force: true }).catch(() => {})
      }

      socket.onmessage = (event) => {
        if (!active) return
        try {
          const message = JSON.parse(String(event.data || '{}'))
          if (message?.type === 'pong' || message?.type === 'mera_portal_packets_ready') return
          if (message?.type === 'mera_portal_packet') {
            applyPacketResult(message)
            return
          }
          if (message?.type === 'mera_portal_packets_complete') {
            const requestId = String(message.requestId || '')
            const pending = pendingPacketRequestsRef.current.get(requestId)
            if (pending?.timer) window.clearTimeout(pending.timer)
            if (pending) completePacketRequest(pending.keys, message)
            pending?.resolve(message)
            pendingPacketRequestsRef.current.delete(requestId)
            setLoading(pendingPacketRequestsRef.current.size > 0)
            return
          }
          if (message?.type === 'smartlink_notification' && message.data) {
            const item = message.data
            setData((current: any) => ({ ...current, notifications: { items: [item, ...((current.notifications?.items || []).filter((existing: any) => existing.publicId !== item.publicId))], unreadCount: Number(current.notifications?.unreadCount || 0) + 1 } }))
            setPortalSyncEvent({ pulse: Date.now(), keys: [], resources: ['notifications', 'tasks'], reason: 'notification-received' })
            toast.info(item.title || 'New notification', { description: item.message || 'A new follow-up requires your attention.' })
            return
          }
          if (message?.type === 'mera_portal_invalidate' || message?.type === 'mera_dashboard_refresh') {
            const resources = normalizePortalResources(message.resources)
            const explicitKeys = normalizePacketKeys(message.keys)
            const keys = explicitKeys.length ? explicitKeys : resources.length ? [] : currentRoutePacketKeys()
            const reason = String(message.reason || 'socket-invalidate')
            const isMutation = reason !== 'server-push' && (resources.length || keys.length)
            if (isMutation) {
              setPortalSyncEvent({
                pulse: Date.now(),
                keys,
                resources,
                reason,
              })
            }
            if (resources.includes('preferences')) {
              loadPreferences({ quiet: true }).catch(() => {})
            }
            schedulePacketInvalidation(keys, reason)
          }
        } catch {
          // Ignore malformed realtime messages.
        }
      }

      socket.onerror = () => {
        // close drives fallback/retry
      }

      socket.onclose = (event) => {
        if (!active) return
        clearTimer(connectTimeout)
        clearIntervalTimer(heartbeatTimer)
        socketRef.current = null
        pendingPacketRequestsRef.current.forEach((pending) => {
          if (pending.timer) window.clearTimeout(pending.timer)
          completePacketRequest(pending.keys, { errors: [{ message: 'Realtime connection closed before packets completed.' }] })
          pending.resolve([])
        })
        pendingPacketRequestsRef.current.clear()
        if (event.code === 4401) {
          setRealtimeMode('disabled')
          clearSession()
          setSession(null)
          setData({})
          setPacketStatus({})
          setPacketErrors({})
          return
        }
        startFallbackPolling(opened ? 'websocket_closed' : 'websocket_failed_to_open')
        scheduleReconnect()
      }
    }

    pollingKeysRef.current = currentRoutePacketKeys()
    connectSocket()

    return () => {
      active = false
      clearTimer(connectTimeout)
      clearTimer(reconnectTimer)
      clearTimer(invalidationTimerRef.current)
      invalidationTimerRef.current = 0
      pendingInvalidationKeysRef.current = []
      clearIntervalTimer(fallbackPollTimer)
      clearIntervalTimer(fallbackReconnectTimer)
      clearIntervalTimer(heartbeatTimer)
      pendingPacketRequestsRef.current.forEach((pending) => {
        if (pending.timer) window.clearTimeout(pending.timer)
        completePacketRequest(pending.keys, { errors: [{ message: 'Realtime connection closed before packets completed.' }] })
        pending.resolve([])
      })
      pendingPacketRequestsRef.current.clear()
      stopSocket()
    }
  }, [applyPacketResult, completePacketRequest, fetchPacketsViaHttp, loadPreferences, requestPackets, schedulePacketInvalidation, token])

  useEffect(() => {
    if (!token || typeof window === 'undefined') return undefined
    const verifySession = async () => {
      const payload = await refreshSession(token)
      if (payload) return
      clearSession()
      setSession(null)
      setData({})
      setPacketStatus({})
      setPacketErrors({})
      setSelectedProfile(null)
      setSelectedProfileEnforcement({ items: [] })
    }
    verifySession()
    const timer = window.setInterval(verifySession, 60000)
    return () => window.clearInterval(timer)
  }, [refreshSession, token])

  useEffect(() => {
    if (!token) {
      setPreferences(defaultPreferences)
      return
    }

    loadPreferences().catch(() => {})
    portalApi.listNotifications(token).then((payload: any) => setData((current: any) => ({ ...current, notifications: payload?.notifications || { items: [], unreadCount: 0 } }))).catch(() => {})
  }, [loadPreferences, token])

  const preloadLoginPackets = useCallback(async (accessToken: string, preloadUser?: any) => {
    if (!accessToken) {
      setLoginPreloadSettled(true)
      return []
    }

    const keys = filterPacketKeysForUser(MERA_PACKET_KEYS, preloadUser || user)
    setLoginPreloadSettled(false)
    markPacketsLoading(keys)

    const results = await Promise.all(keys.map(async (key) => {
      try {
        const payload = await portalApi.getPacket(accessToken, key, {})
        return { key, status: 'ready' as MeraPacketStatus, data: payload }
      } catch (packetError: any) {
        const message = packetError?.message || 'Unable to load MERA data packet.'
        return {
          key,
          status: String(message).toLowerCase().includes('forbidden') ? 'forbidden' as MeraPacketStatus : 'error' as MeraPacketStatus,
          error: message,
        }
      }
    }))

    const nextData: Record<string, any> = {}
    const nextStatus: Record<string, MeraPacketStatus> = {}
    const nextErrors: Record<string, string> = {}

    results.forEach((result) => {
      nextStatus[result.key] = result.status
      if (result.status === 'ready') nextData[result.key] = result.data
      else nextErrors[result.key] = result.error || 'Unable to load MERA data packet.'
    })

    setData((current: any) => ({ ...current, ...nextData }))
    setPacketStatus((current) => ({ ...current, ...nextStatus }))
    setPacketErrors((current) => {
      const next = { ...current }
      keys.forEach((key) => {
        if (nextErrors[key]) next[key] = nextErrors[key]
        else delete next[key]
      })
      return next
    })
    setLoading(false)
    setRealtimePulse(Date.now())
    setLoginPreloadSettled(true)
    return results
  }, [markPacketsLoading, user])

  const completeLogin = async (payload: any, options: { preload?: boolean; successGate?: boolean } = {}) => {
    const shouldPreload = options.preload !== false
    const shouldShowSuccessGate = options.successGate !== false
    setPendingLoginChallenge(null)
    setData({})
    setPacketStatus({})
    setPacketErrors({})
    setLoginSuccessGate(shouldShowSuccessGate)
    setLoginPreloadSettled(!shouldPreload)
    setSession(payload)
    storeSession(payload)
    if (shouldPreload) await preloadLoginPackets(payload?.accessToken, payload?.user)
  }

  const login = async (credentials: { email?: string; studentCode?: string; student_code?: string; password: string; loginType?: string; login_type?: string }) => {
    setBootLoading(true)
    setLoginError('')
    setLoginSuccessGate(false)
    setLoginPreloadSettled(false)
    try {
      const payload = await portalApi.login(credentials)
      if (payload?.challengeRequired) {
        setPendingLoginChallenge(payload)
        return payload
      }
      if (payload?.user?.mustChangePassword) {
        await completeLogin(payload, { preload: false, successGate: false })
        return payload
      }
      await completeLogin(payload)
      return payload
    } catch (loginErr: any) {
      setLoginError(loginErr?.message || 'Unable to sign in.')
    } finally {
      setBootLoading(false)
    }
  }

  const verifyLoginCode = async (payload: { challengeId: string; code: string; trustDevice?: boolean }) => {
    setBootLoading(true)
    setLoginError('')
    try {
      const sessionPayload = await portalApi.verifyLoginCode(payload)
      await completeLogin(sessionPayload)
      return sessionPayload
    } catch (loginErr: any) {
      setLoginError(loginErr?.message || 'Unable to verify login code.')
      throw loginErr
    } finally {
      setBootLoading(false)
    }
  }

  const resendLoginCode = async (payload?: { challengeId?: string }) => {
    const challengeId = payload?.challengeId || pendingLoginChallenge?.challengeId
    if (!challengeId) return null
    setBootLoading(true)
    setLoginError('')
    try {
      const nextChallenge = await portalApi.resendLoginCode({ challengeId })
      setPendingLoginChallenge(nextChallenge)
      return nextChallenge
    } catch (loginErr: any) {
      setLoginError(loginErr?.message || 'Unable to resend login code.')
      throw loginErr
    } finally {
      setBootLoading(false)
    }
  }

  const cancelLoginChallenge = () => {
    setPendingLoginChallenge(null)
    setLoginError('')
    setLoginSuccessGate(false)
    setLoginPreloadSettled(false)
  }

  const finishLoginSuccessGate = useCallback(() => {
    setLoginSuccessGate(false)
  }, [])

  const logout = async () => {
    try {
      if (token) await portalApi.logout(token)
    } catch {
      // best effort
    }
    clearSession()
    setSession(null)
    setPendingLoginChallenge(null)
    setLoginSuccessGate(false)
    setLoginPreloadSettled(false)
    setData({})
    setPacketStatus({})
    setPacketErrors({})
    setActionLoading(false)
    actionLoadingRef.current = false
    setSelectedProfile(null)
    setSelectedProfileEnforcement({ items: [] })
    setRealtimeMode('disabled')
    setPortalSyncEvent({ pulse: 0, keys: [], resources: [], reason: '' })
  }

  const changePassword = async (payload: { current_password: string; new_password: string; confirm_password?: string }) => {
    if (!token) return null
    setBootLoading(true)
    setLoginError('')
    try {
      const nextSession = await portalApi.changePassword(token, payload)
      await completeLogin(nextSession, { preload: true, successGate: false })
      toast.success('Password changed. Welcome in.')
      return nextSession
    } catch (passwordError: any) {
      const message = passwordError?.message || 'Unable to change password.'
      setLoginError(message)
      toast.error(message)
      throw passwordError
    } finally {
      setBootLoading(false)
    }
  }

  const runAction = async (
    runner: () => Promise<any>,
    label = 'Completing request...',
    options: { refresh?: 'snapshot' | 'full' | false } = {},
  ) => {
    if (!token) return null
    if (actionLoadingRef.current) return null
    actionLoadingRef.current = true
    const refreshMode = options.refresh ?? 'snapshot'
    setActionLabel(label)
    setActionLoading(true)
    setLoading(true)
    setError('')
    try {
      const result = await runner()
      if (refreshMode === 'full') {
        await requestPackets(MERA_PACKET_KEYS, { reason: 'action-full-refresh', force: true })
      } else if (refreshMode === 'snapshot') {
        await refreshVisibleModules({ reason: 'action-visible-refresh', force: true })
      }
      toast.success(label === 'Completing request...' ? 'Request completed.' : label.replace(/\.\.\.$/, ' complete.'))
      return result
    } catch (actionError: any) {
      setError(actionError?.message || 'Unable to complete the request.')
      toast.error(actionError?.message || 'Unable to complete the request.')
      throw actionError
    } finally {
      setLoading(false)
      setActionLoading(false)
      actionLoadingRef.current = false
    }
  }

  const updatePreferences = async (patch: any) => {
    if (!token) return null
    if (actionLoadingRef.current) return null
    actionLoadingRef.current = true
    const previous = preferences
    const preferencePatch = patch || {}
    const next = { ...preferences, ...preferencePatch }
    setPreferences(next)
    setActionLabel('Saving preferences...')
    setActionLoading(true)
    setLoading(true)
    setError('')
    try {
      const result = await portalApi.updateMyPreferences(token, preferencePatch)
      const merged = { ...defaultPreferences, ...result }
      setPreferences(merged)
      writeLastLoginAppearance(merged, user)
      toast.success('Preferences saved.')
      return merged
    } catch (actionError: any) {
      setPreferences(previous)
      setError(actionError?.message || 'Unable to update MERA preferences.')
      toast.error(actionError?.message || 'Unable to update MERA preferences.')
      throw actionError
    } finally {
      setLoading(false)
      setActionLoading(false)
      actionLoadingRef.current = false
    }
  }

  const setAppearance = (appearance: MeraAppearance) => updatePreferences({ appearance })

  const previewPreferences = useCallback((patch: any) => {
    if (!patch || typeof patch !== 'object') return
    setPreferences((current: any) => ({ ...current, ...patch }))
  }, [])

  const updatePortalData = (updater: (current: any) => any) => {
    setData((current: any) => updater(current))
  }

  const openProfile = useCallback(async (stationPublicId: string) => {
    if (!token) return null
    const [profile, enforcement] = await Promise.all([
      portalApi.getProfile(token, stationPublicId),
      portalApi.getStationEnforcementHistory(token, stationPublicId),
    ])
    setSelectedProfile(profile)
    setSelectedProfileEnforcement(enforcement)
    return { profile, enforcement }
  }, [token])

  useEffect(() => {
    const firstProfileId = Array.isArray(data.profiles) ? data.profiles?.[0]?.public_id : null
    if (!token || selectedProfile || !firstProfileId) return
    openProfile(firstProfileId).catch(() => {})
  }, [data.profiles, openProfile, selectedProfile, token])

  const packetLoading = Object.values(packetStatus).some((status) => status === 'loading')
  const liveDataLoading = MERA_PACKET_KEYS.some((key) => packetStatus[key] === 'loading' && !hasPacketValue(data, key))

  const usePortalPacket = useCallback((key: MeraPacketKey) => ({
    data: data?.[key],
    status: packetStatus[key] || 'idle',
    error: packetErrors[key] || '',
    loading: (packetStatus[key] || 'idle') === 'loading' && !hasPacketValue(data, key),
    refreshing: (packetStatus[key] || 'idle') === 'loading' && hasPacketValue(data, key),
    reload: (params?: Record<string, any>) => requestPackets([key], { paramsByKey: params ? { [key]: params } : undefined, force: true, reason: 'packet-reload' }),
  }), [data, packetErrors, packetStatus, requestPackets])

  const value = useMemo(
    () => ({
      session,
      user,
      token,
      data,
      packetStatus,
      packetErrors,
      realtimeMode,
      realtimePulse,
      portalSyncEvent,
      portalMutationPulse: portalSyncEvent.pulse,
      loading: loading || packetLoading,
      snapshotLoading: packetLoading,
      hasLoadedSnapshot: Boolean(token),
      liveDataLoading,
      actionLoading,
      actionLabel,
      bootLoading,
      loginSuccessGate,
      loginPreloadSettled,
      error,
      loginError,
      pendingLoginChallenge,
      selectedProfile,
      selectedProfileEnforcement,
      preferences,
      preferencesLoading,
      appearance: preferences?.appearance || 'light',
      login,
      verifyLoginCode,
      resendLoginCode,
      cancelLoginChallenge,
      finishLoginSuccessGate,
      logout,
      changePassword,
      refresh: () => refreshVisibleModules({ reason: 'legacy-refresh', force: true }),
      refreshFull: () => requestPackets(MERA_PACKET_KEYS, { reason: 'legacy-full-refresh', force: true }),
      refreshSnapshot: () => refreshVisibleModules({ reason: 'legacy-snapshot-refresh', force: true }),
      refreshVisibleModules,
      requestRoutePackets,
      requestPackets,
      usePortalPacket,
      refreshNationalOperations: (availabilityInterval?: string) =>
        requestPackets(['nationalOperations'], {
          paramsByKey: availabilityInterval ? { nationalOperations: { availabilityInterval } } : undefined,
          reason: 'national-operations-refresh',
          force: true,
        }).then(() => data.nationalOperations),
      refreshSession,
      runAction,
      updatePortalData,
      updatePreferences,
      previewPreferences,
      setAppearance,
      openProfile,
      hasPermission: (permission: any) => hasPermission(user, permission),
      hasAnyPermission: (permissions: any[]) => hasAnyPermission(user, permissions),
      canAccessPath: (pathname: string) => canAccessPath(user, pathname),
      firstAccessiblePath: () => firstAccessiblePath(user),
      getHoardingWatchlistDetail: (stationPublicId: string) =>
        portalApi.getHoardingWatchlistDetail(token, stationPublicId),
      api: portalApi,
    }),
    [session, user, token, data, packetStatus, packetErrors, realtimeMode, realtimePulse, portalSyncEvent, loading, packetLoading, liveDataLoading, actionLoading, actionLabel, bootLoading, loginSuccessGate, loginPreloadSettled, error, loginError, pendingLoginChallenge, selectedProfile, selectedProfileEnforcement, preferences, preferencesLoading, requestPackets, requestRoutePackets, refreshVisibleModules, refreshSession, usePortalPacket, openProfile, finishLoginSuccessGate, previewPreferences],
  )

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function usePortal() {
  const context = useContext(PortalContext)
  if (!context) {
    throw new Error('usePortal must be used within PortalProvider')
  }
  return context
}

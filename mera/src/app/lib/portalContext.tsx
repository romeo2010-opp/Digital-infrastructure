import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { canAccessPath, firstAccessiblePath, hasAnyPermission, hasPermission, MERA_PERMISSIONS } from './access'
import { clearSession, portalApi, readStoredSession, resolvePortalWebSocketUrl, storeSession } from './portalApi'

const PortalContext = createContext<any>(null)

export type MeraAppearance = 'light' | 'system' | 'dark' | 'black-white'

const defaultPreferences = {
  appearance: 'system' as MeraAppearance,
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
}

const initialData = {
  overview: null,
  flaggedStations: [],
  heatmap: [],
  complaintMetrics: null,
  inspectionMetrics: null,
  demandForecastSummary: null,
  nationalOperations: null,
  opsPredictions: { items: [], errors: [] },
  tasks: { items: [] },
  myTasks: { items: [], counts: { byStatus: {}, byPriority: {} } },
  taskStats: null,
  assignableUsers: [],
  notifications: { unreadCount: 0, items: [] },
  hoardingWatchlist: { items: [] },
  fuelDeliveryLogs: { items: [] },
  availabilityReports: { items: [] },
  complaints: { items: [] },
  flags: { items: [] },
  inspections: { items: [] },
  enforcementActions: { items: [] },
  profiles: [],
  licenseRegistry: { items: [] },
  expiryAlerts: [],
  topComplaintStations: [],
  districtShortages: [],
  repeatedOffenders: [],
  monthlyReports: [],
  users: [],
  auditLogs: { items: [] },
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(() => readStoredSession())
  const [data, setData] = useState<any>(initialData)
  const [selectedProfile, setSelectedProfile] = useState<any>(null)
  const [selectedProfileEnforcement, setSelectedProfileEnforcement] = useState<any>({ items: [] })
  const [loading, setLoading] = useState(false)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [hasLoadedSnapshot, setHasLoadedSnapshot] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionLabel, setActionLabel] = useState('Completing request...')
  const [bootLoading, setBootLoading] = useState(false)
  const [realtimePulse, setRealtimePulse] = useState(0)
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [pendingLoginChallenge, setPendingLoginChallenge] = useState<any>(null)
  const [preferences, setPreferences] = useState<any>(defaultPreferences)
  const [preferencesLoading, setPreferencesLoading] = useState(false)
  const token = session?.accessToken || ''
  const user = session?.user || null
  const permissionSignature = JSON.stringify(user?.permissions || [])
  const snapshotInFlightRef = useRef('')
  const actionLoadingRef = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const root = document.documentElement
    const applyAppearance = () => {
      const appearance = preferences.appearance || 'system'
      const systemDark =
        appearance === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches
      const resolved = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance

      root.dataset.meraTheme = resolved
      root.classList.toggle('dark', resolved === 'dark')
    }

    applyAppearance()

    if (preferences.appearance !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return undefined
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener?.('change', applyAppearance)
    return () => media.removeEventListener?.('change', applyAppearance)
  }, [preferences.appearance])

  const refreshSession = async (accessToken = token) => {
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
  }

  const applySnapshotPayload = async (payload: any, accessToken: string) => {
    const { _errors: loadErrors = [], ...snapshotData } = payload || {}
    const nextData = { ...initialData, ...snapshotData }
    setData(nextData)
    setHasLoadedSnapshot(true)

    if (Array.isArray(loadErrors) && loadErrors.length) {
      setError(`Some MERA modules could not load: ${loadErrors.slice(0, 4).map((item: any) => `${item.key}: ${item.message}`).join(' | ')}`)
    }

    const activeProfilePublicId = selectedProfile?.station?.public_id || nextData.profiles?.[0]?.public_id || null
    if (activeProfilePublicId) {
      Promise.all([
        portalApi.getProfile(accessToken, activeProfilePublicId),
        portalApi.getStationEnforcementHistory(accessToken, activeProfilePublicId),
      ])
        .then(([profile, enforcement]) => {
          setSelectedProfile(profile)
          setSelectedProfileEnforcement(enforcement)
        })
        .catch(() => {
          // The registry can still render its list while profile detail loads later.
        })
    }
  }

  const loadPortalSnapshot = async (accessToken = token) => {
    if (!accessToken) return null
    if (snapshotInFlightRef.current === accessToken) return null
    snapshotInFlightRef.current = accessToken
    setSnapshotLoading(true)
    setLoading(true)
    setError('')
    try {
      const payload = await portalApi.getSnapshot(accessToken)
      await applySnapshotPayload(payload, accessToken)
      return payload
    } catch (snapshotError: any) {
      setError(snapshotError?.message || 'Unable to load MERA portal snapshot.')
      setHasLoadedSnapshot(true)
      return null
    } finally {
      if (snapshotInFlightRef.current === accessToken) snapshotInFlightRef.current = ''
      setSnapshotLoading(false)
      setLoading(false)
    }
  }

  const loadPortalData = async (accessToken = token) => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const requests = [
        [
          'overview',
          hasAnyPermission(user, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
          () => portalApi.getDashboardOverview(accessToken),
          initialData.overview,
        ],
        ['flaggedStations', hasPermission(user, MERA_PERMISSIONS.FLAGS_VIEW), () => portalApi.getFlaggedStations(accessToken), initialData.flaggedStations],
        ['heatmap', hasPermission(user, MERA_PERMISSIONS.HEATMAP_VIEW), () => portalApi.getShortageHeatmap(accessToken), initialData.heatmap],
        ['complaintMetrics', hasPermission(user, MERA_PERMISSIONS.COMPLAINTS_VIEW), () => portalApi.getComplaintMetrics(accessToken), initialData.complaintMetrics],
        ['inspectionMetrics', hasPermission(user, MERA_PERMISSIONS.INSPECTIONS_VIEW), () => portalApi.getInspectionMetrics(accessToken), initialData.inspectionMetrics],
        ['demandForecastSummary', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getDemandForecastSummary(accessToken), initialData.demandForecastSummary],
        ['opsPredictions', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getOpsPredictions(accessToken), initialData.opsPredictions],
        [
          'nationalOperations',
          hasAnyPermission(user, [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT]),
          () => portalApi.getNationalOperationsDashboard(accessToken),
          initialData.nationalOperations,
        ],
        [
          'tasks',
          hasAnyPermission(user, [
            MERA_PERMISSIONS.TASKS_VIEW_ALL,
            MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
          ]),
          () => portalApi.listTasks(accessToken, { limit: 75 }),
          initialData.tasks,
        ],
        [
          'myTasks',
          hasAnyPermission(user, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK]),
          () => portalApi.listMyTasks(accessToken, { limit: 50 }),
          initialData.myTasks,
        ],
        [
          'taskStats',
          hasAnyPermission(user, [
            MERA_PERMISSIONS.TASKS_STATS_VIEW,
            MERA_PERMISSIONS.TASKS_VIEW_ALL,
            MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
            MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
          ]),
          () => portalApi.getTaskStatsOverview(accessToken),
          initialData.taskStats,
        ],
        [
          'assignableUsers',
          hasAnyPermission(user, [MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_MANAGE]),
          () => portalApi.listAssignableUsers(accessToken),
          initialData.assignableUsers,
        ],
        [
          'notifications',
          hasAnyPermission(user, [
            MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED,
            MERA_PERMISSIONS.TASKS_VIEW_ALL,
            MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE,
          ]),
          () => portalApi.listNotifications(accessToken, 12),
          initialData.notifications,
        ],
        ['hoardingWatchlist', hasAnyPermission(user, [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]), () => portalApi.getHoardingWatchlist(accessToken), initialData.hoardingWatchlist],
        ['fuelDeliveryLogs', hasPermission(user, MERA_PERMISSIONS.DELIVERIES_VIEW), () => portalApi.listFuelDeliveryLogs(accessToken), initialData.fuelDeliveryLogs],
        ['availabilityReports', hasAnyPermission(user, [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]), () => portalApi.listAvailabilityReports(accessToken), initialData.availabilityReports],
        ['complaints', hasPermission(user, MERA_PERMISSIONS.COMPLAINTS_VIEW), () => portalApi.listComplaints(accessToken), initialData.complaints],
        ['flags', hasPermission(user, MERA_PERMISSIONS.FLAGS_VIEW), () => portalApi.listFlags(accessToken), initialData.flags],
        ['inspections', hasPermission(user, MERA_PERMISSIONS.INSPECTIONS_VIEW), () => portalApi.listInspections(accessToken), initialData.inspections],
        ['enforcementActions', hasPermission(user, MERA_PERMISSIONS.ENFORCEMENT_VIEW), () => portalApi.listEnforcementActions(accessToken), initialData.enforcementActions],
        ['profiles', hasAnyPermission(user, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT]), () => portalApi.listProfiles(accessToken), initialData.profiles],
        ['licenseRegistry', hasPermission(user, MERA_PERMISSIONS.LICENSES_VIEW), () => portalApi.listLicenseRegistry(accessToken), initialData.licenseRegistry],
        ['expiryAlerts', hasAnyPermission(user, [MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW]), () => portalApi.getExpiryAlerts(accessToken), initialData.expiryAlerts],
        ['topComplaintStations', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getTopComplaintStations(accessToken), initialData.topComplaintStations],
        ['districtShortages', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getDistrictShortageSummaries(accessToken), initialData.districtShortages],
        ['repeatedOffenders', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getRepeatedOffenders(accessToken), initialData.repeatedOffenders],
        ['monthlyReports', hasPermission(user, MERA_PERMISSIONS.REPORTS_VIEW), () => portalApi.getMonthlyReports(accessToken), initialData.monthlyReports],
        ['users', hasPermission(user, MERA_PERMISSIONS.USERS_VIEW), () => portalApi.listUsers(accessToken), initialData.users],
        ['auditLogs', hasPermission(user, MERA_PERMISSIONS.AUDIT_VIEW), () => portalApi.listAuditLogs(accessToken), initialData.auditLogs],
      ] as const

      const settled = await Promise.allSettled(
        requests.map(([, allowed, request, fallback]) => (allowed ? request() : Promise.resolve(fallback))),
      )
      const nextData: any = { ...initialData }
      const loadErrors: string[] = []

      requests.forEach(([key, allowed, _request, fallback], index) => {
        const result = settled[index]
        if (!allowed) {
          nextData[key] = fallback
          return
        }
        if (result.status === 'fulfilled') {
          nextData[key] = result.value
        } else {
          nextData[key] = fallback
          loadErrors.push(`${key}: ${result.reason?.message || 'request failed'}`)
        }
      })

      setData(nextData)

      if (loadErrors.length) {
        setError(`Some MERA modules could not load: ${loadErrors.slice(0, 4).join(' | ')}`)
      }

      const activeProfilePublicId = selectedProfile?.station?.public_id || nextData.profiles?.[0]?.public_id || null
      if (activeProfilePublicId) {
        const profile = await portalApi.getProfile(accessToken, activeProfilePublicId)
        const enforcement = await portalApi.getStationEnforcementHistory(accessToken, activeProfilePublicId)
        setSelectedProfile(profile)
        setSelectedProfileEnforcement(enforcement)
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load MERA portal data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadPortalSnapshot(token)
  }, [token])

  useEffect(() => {
    if (!token || typeof window === 'undefined') return undefined
    const timer = window.setInterval(async () => {
      const payload = await refreshSession(token)
      if (payload) return
      clearSession()
      setSession(null)
      setData(initialData)
      setHasLoadedSnapshot(false)
      setSelectedProfile(null)
      setSelectedProfileEnforcement({ items: [] })
    }, 60000)
    return () => window.clearInterval(timer)
  }, [token])

  useEffect(() => {
    if (!token) {
      setPreferences(defaultPreferences)
      return
    }

    let cancelled = false
    const loadPreferences = async () => {
      setPreferencesLoading(true)
      try {
        const payload = await portalApi.getMyPreferences(token)
        if (!cancelled && payload) {
          setPreferences({ ...defaultPreferences, ...payload, appearance: payload.appearance || 'system' })
        }
      } catch {
        if (!cancelled) setPreferences(defaultPreferences)
      } finally {
        if (!cancelled) setPreferencesLoading(false)
      }
    }

    loadPreferences()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    const canViewDashboard = hasAnyPermission(user, [
      MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL,
      MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT,
    ])
    if (!token || !canViewDashboard || typeof window === 'undefined' || !('WebSocket' in window)) return undefined

    let disposed = false
    let reconnectTimer: ReturnType<typeof window.setTimeout> | undefined
    let refreshTimer: ReturnType<typeof window.setTimeout> | undefined
    let pollTimer: ReturnType<typeof window.setInterval> | undefined
    let socket: WebSocket | null = null

    const clearReconnect = () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }

    const refreshNationalOperations = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        if (disposed) return
        setRealtimePulse(Date.now())
        portalApi
          .getNationalOperationsDashboard(token)
          .then((payload) => {
            if (disposed) return
            setData((current: any) => ({ ...current, nationalOperations: payload }))
          })
          .catch(() => {
            // The normal dashboard request path will surface errors; keep the socket quiet.
          })
      }, 250)
    }

    const connect = () => {
      clearReconnect()
      if (disposed) return

      socket = new WebSocket(resolvePortalWebSocketUrl('/ws/mera-dashboard', { accessToken: token }))

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}'))
          if (message?.type === 'mera_dashboard_refresh') refreshNationalOperations()
        } catch {
          // Ignore malformed realtime messages.
        }
      }

      socket.onclose = (event) => {
        socket = null
        if (disposed || event.code === 4401) return
        reconnectTimer = window.setTimeout(connect, 5000)
      }

      socket.onerror = () => {
        try {
          socket?.close()
        } catch {
          // noop
        }
      }
    }

    connect()
    pollTimer = window.setInterval(refreshNationalOperations, 30000)

    return () => {
      disposed = true
      clearReconnect()
      if (refreshTimer) window.clearTimeout(refreshTimer)
      if (pollTimer) window.clearInterval(pollTimer)
      try {
        socket?.close(1000, 'MERA portal closed')
      } catch {
        // noop
      }
    }
  }, [token, user?.publicId, permissionSignature])

  const completeLogin = async (payload: any) => {
    setPendingLoginChallenge(null)
    setSession(payload)
    storeSession(payload)
    await loadPortalSnapshot(payload?.accessToken)
  }

  const login = async (credentials: { email: string; password: string }) => {
    setBootLoading(true)
    setLoginError('')
    try {
      const payload = await portalApi.login(credentials)
      if (payload?.challengeRequired) {
        setPendingLoginChallenge(payload)
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
  }

  const logout = async () => {
    try {
      if (token) await portalApi.logout(token)
    } catch {
      // best effort
    }
    clearSession()
    setSession(null)
    setPendingLoginChallenge(null)
    setData(initialData)
    setHasLoadedSnapshot(false)
    setSnapshotLoading(false)
    setActionLoading(false)
    actionLoadingRef.current = false
    setSelectedProfile(null)
    setSelectedProfileEnforcement({ items: [] })
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
        await loadPortalData(token)
      } else if (refreshMode === 'snapshot') {
        await loadPortalSnapshot(token)
      }
      return result
    } catch (actionError: any) {
      setError(actionError?.message || 'Unable to complete the request.')
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
    const next = { ...preferences, ...patch }
    setPreferences(next)
    setActionLabel('Saving preferences...')
    setActionLoading(true)
    setLoading(true)
    setError('')
    try {
      const result = await portalApi.updateMyPreferences(token, patch)
      const merged = { ...defaultPreferences, ...result }
      setPreferences(merged)
      return merged
    } catch (actionError: any) {
      setPreferences(previous)
      setError(actionError?.message || 'Unable to update MERA preferences.')
      throw actionError
    } finally {
      setLoading(false)
      setActionLoading(false)
      actionLoadingRef.current = false
    }
  }

  const setAppearance = (appearance: MeraAppearance) => updatePreferences({ appearance })

  const updatePortalData = (updater: (current: any) => any) => {
    setData((current: any) => updater(current))
  }

  const openProfile = async (stationPublicId: string) => {
    if (!token) return null
    const [profile, enforcement] = await Promise.all([
      portalApi.getProfile(token, stationPublicId),
      portalApi.getStationEnforcementHistory(token, stationPublicId),
    ])
    setSelectedProfile(profile)
    setSelectedProfileEnforcement(enforcement)
    return { profile, enforcement }
  }

  const value = useMemo(
    () => ({
      session,
      user,
      token,
      data,
      realtimePulse,
      loading,
      snapshotLoading,
      hasLoadedSnapshot,
      liveDataLoading: snapshotLoading && !hasLoadedSnapshot,
      actionLoading,
      actionLabel,
      bootLoading,
      error,
      loginError,
      pendingLoginChallenge,
      selectedProfile,
      selectedProfileEnforcement,
      preferences,
      preferencesLoading,
      appearance: preferences.appearance,
      login,
      verifyLoginCode,
      resendLoginCode,
      cancelLoginChallenge,
      logout,
      refresh: () => loadPortalSnapshot(token),
      refreshFull: () => loadPortalData(token),
      refreshSnapshot: () => loadPortalSnapshot(token),
      refreshNationalOperations: (availabilityInterval?: string) =>
        portalApi.getNationalOperationsDashboard(token, availabilityInterval).then((payload) => {
          setData((current: any) => ({ ...current, nationalOperations: payload }))
          return payload
        }),
      refreshSession,
      runAction,
      updatePortalData,
      updatePreferences,
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
    [session, user, token, data, realtimePulse, loading, snapshotLoading, hasLoadedSnapshot, actionLoading, actionLabel, bootLoading, error, loginError, pendingLoginChallenge, selectedProfile, selectedProfileEnforcement, preferences, preferencesLoading],
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

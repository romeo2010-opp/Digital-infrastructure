import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { canAccessPath, firstAccessiblePath, hasAnyPermission, hasPermission, MERA_PERMISSIONS } from './access'
import { clearSession, portalApi, readStoredSession, storeSession } from './portalApi'

const PortalContext = createContext<any>(null)

const initialData = {
  overview: null,
  flaggedStations: [],
  heatmap: [],
  complaintMetrics: null,
  inspectionMetrics: null,
  demandForecastSummary: null,
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
  const [bootLoading, setBootLoading] = useState(false)
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const token = session?.accessToken || ''
  const user = session?.user || null

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
    loadPortalData(token)
  }, [token])

  const login = async (credentials: { email: string; password: string }) => {
    setBootLoading(true)
    setLoginError('')
    try {
      const payload = await portalApi.login(credentials)
      setSession(payload)
      storeSession(payload)
    } catch (loginErr: any) {
      setLoginError(loginErr?.message || 'Unable to sign in.')
    } finally {
      setBootLoading(false)
    }
  }

  const logout = async () => {
    try {
      if (token) await portalApi.logout(token)
    } catch {
      // best effort
    }
    clearSession()
    setSession(null)
    setData(initialData)
    setSelectedProfile(null)
    setSelectedProfileEnforcement({ items: [] })
  }

  const runAction = async (runner: () => Promise<any>) => {
    if (!token) return null
    setLoading(true)
    setError('')
    try {
      const result = await runner()
      await refreshSession(token)
      await loadPortalData(token)
      return result
    } catch (actionError: any) {
      setError(actionError?.message || 'Unable to complete the request.')
      throw actionError
    } finally {
      setLoading(false)
    }
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
      loading,
      bootLoading,
      error,
      loginError,
      selectedProfile,
      selectedProfileEnforcement,
      login,
      logout,
      refresh: () => loadPortalData(token),
      refreshSession,
      runAction,
      openProfile,
      hasPermission: (permission: any) => hasPermission(user, permission),
      hasAnyPermission: (permissions: any[]) => hasAnyPermission(user, permissions),
      canAccessPath: (pathname: string) => canAccessPath(user, pathname),
      firstAccessiblePath: () => firstAccessiblePath(user),
      getHoardingWatchlistDetail: (stationPublicId: string) =>
        portalApi.getHoardingWatchlistDetail(token, stationPublicId),
      api: portalApi,
    }),
    [session, user, token, data, loading, bootLoading, error, loginError, selectedProfile, selectedProfileEnforcement],
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

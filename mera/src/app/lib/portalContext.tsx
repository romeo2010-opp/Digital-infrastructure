import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { clearSession, portalApi, readStoredSession, storeSession } from './portalApi'

const PortalContext = createContext<any>(null)

const initialData = {
  overview: null,
  flaggedStations: [],
  heatmap: [],
  complaintMetrics: null,
  inspectionMetrics: null,
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
        ['overview', portalApi.getDashboardOverview(accessToken), initialData.overview],
        ['flaggedStations', portalApi.getFlaggedStations(accessToken), initialData.flaggedStations],
        ['heatmap', portalApi.getShortageHeatmap(accessToken), initialData.heatmap],
        ['complaintMetrics', portalApi.getComplaintMetrics(accessToken), initialData.complaintMetrics],
        ['inspectionMetrics', portalApi.getInspectionMetrics(accessToken), initialData.inspectionMetrics],
        ['hoardingWatchlist', portalApi.getHoardingWatchlist(accessToken), initialData.hoardingWatchlist],
        ['fuelDeliveryLogs', portalApi.listFuelDeliveryLogs(accessToken), initialData.fuelDeliveryLogs],
        ['availabilityReports', portalApi.listAvailabilityReports(accessToken), initialData.availabilityReports],
        ['complaints', portalApi.listComplaints(accessToken), initialData.complaints],
        ['flags', portalApi.listFlags(accessToken), initialData.flags],
        ['inspections', portalApi.listInspections(accessToken), initialData.inspections],
        ['enforcementActions', portalApi.listEnforcementActions(accessToken), initialData.enforcementActions],
        ['profiles', portalApi.listProfiles(accessToken), initialData.profiles],
        ['licenseRegistry', portalApi.listLicenseRegistry(accessToken), initialData.licenseRegistry],
        ['expiryAlerts', portalApi.getExpiryAlerts(accessToken), initialData.expiryAlerts],
        ['topComplaintStations', portalApi.getTopComplaintStations(accessToken), initialData.topComplaintStations],
        ['districtShortages', portalApi.getDistrictShortageSummaries(accessToken), initialData.districtShortages],
        ['repeatedOffenders', portalApi.getRepeatedOffenders(accessToken), initialData.repeatedOffenders],
        ['monthlyReports', portalApi.getMonthlyReports(accessToken), initialData.monthlyReports],
        ['users', portalApi.listUsers(accessToken), initialData.users],
        ['auditLogs', portalApi.listAuditLogs(accessToken), initialData.auditLogs],
      ] as const

      const settled = await Promise.allSettled(requests.map(([, request]) => request))
      const nextData: any = { ...initialData }
      const loadErrors: string[] = []

      requests.forEach(([key, _request, fallback], index) => {
        const result = settled[index]
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
      user: session?.user || null,
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
      getHoardingWatchlistDetail: (stationPublicId: string) =>
        portalApi.getHoardingWatchlistDetail(token, stationPublicId),
      api: portalApi,
    }),
    [session, token, data, loading, bootLoading, error, loginError, selectedProfile, selectedProfileEnforcement],
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

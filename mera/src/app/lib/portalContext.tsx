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

  const loadPortalData = async (accessToken = token) => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const [
        overview,
        flaggedStations,
        heatmap,
        complaintMetrics,
        inspectionMetrics,
        hoardingWatchlist,
        fuelDeliveryLogs,
        availabilityReports,
        complaints,
        flags,
        inspections,
        enforcementActions,
        profiles,
        licenseRegistry,
        expiryAlerts,
        topComplaintStations,
        districtShortages,
        repeatedOffenders,
        monthlyReports,
        users,
        auditLogs,
      ] = await Promise.all([
        portalApi.getDashboardOverview(accessToken),
        portalApi.getFlaggedStations(accessToken),
        portalApi.getShortageHeatmap(accessToken),
        portalApi.getComplaintMetrics(accessToken),
        portalApi.getInspectionMetrics(accessToken),
        portalApi.getHoardingWatchlist(accessToken),
        portalApi.listFuelDeliveryLogs(accessToken),
        portalApi.listAvailabilityReports(accessToken),
        portalApi.listComplaints(accessToken),
        portalApi.listFlags(accessToken),
        portalApi.listInspections(accessToken),
        portalApi.listEnforcementActions(accessToken),
        portalApi.listProfiles(accessToken),
        portalApi.listLicenseRegistry(accessToken),
        portalApi.getExpiryAlerts(accessToken),
        portalApi.getTopComplaintStations(accessToken),
        portalApi.getDistrictShortageSummaries(accessToken),
        portalApi.getRepeatedOffenders(accessToken),
        portalApi.getMonthlyReports(accessToken),
        portalApi.listUsers(accessToken),
        portalApi.listAuditLogs(accessToken),
      ])

      setData({
        overview,
        flaggedStations,
        heatmap,
        complaintMetrics,
        inspectionMetrics,
        hoardingWatchlist,
        fuelDeliveryLogs,
        availabilityReports,
        complaints,
        flags,
        inspections,
        enforcementActions,
        profiles,
        licenseRegistry,
        expiryAlerts,
        topComplaintStations,
        districtShortages,
        repeatedOffenders,
        monthlyReports,
        users,
        auditLogs,
      })

      if (!selectedProfile && profiles?.[0]?.public_id) {
        const profile = await portalApi.getProfile(accessToken, profiles[0].public_id)
        const enforcement = await portalApi.getStationEnforcementHistory(accessToken, profiles[0].public_id)
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

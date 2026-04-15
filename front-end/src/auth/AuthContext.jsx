import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { authApi } from "../api/authApi"
import {
  clearAuthSession,
  getSessionMeta,
  getTokenClaims,
  setAccessToken,
  setSessionMeta,
} from "./authSession"

const AuthContext = createContext(null)
const STAFF_ROLES = new Set(["MANAGER", "ATTENDANT", "VIEWER"])
const AUTH_EXPIRED_EVENT = "smartlink:auth-expired"
const TOKEN_REFRESH_LEAD_MS = 2 * 60 * 1000
const TOKEN_REFRESH_MIN_DELAY_MS = 30 * 1000

function assertStationManagerSession(me) {
  const role = String(me?.role || "").trim().toUpperCase()
  const stationPublicId = String(me?.station?.publicId || "").trim()
  if (!stationPublicId || !STAFF_ROLES.has(role)) {
    throw new Error("This account is not a station staff account. Use manager/attendant credentials.")
  }
}

export function AuthProvider({ children }) {
  const dataSource = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase()
  const isApiMode = dataSource === "api"
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [session, setSession] = useState(getSessionMeta())
  const [showStationPicker, setShowStationPicker] = useState(false)
  const refreshTimerRef = useRef(0)

  function clearRefreshTimer() {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = 0
    }
  }

  function getRefreshDelayMs() {
    const claims = getTokenClaims()
    const expSeconds = Number(claims?.exp || 0)
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null

    const expiresAtMs = expSeconds * 1000
    const delayMs = expiresAtMs - Date.now() - TOKEN_REFRESH_LEAD_MS
    return Math.max(TOKEN_REFRESH_MIN_DELAY_MS, delayMs)
  }

  async function refreshSessionSilently() {
    if (!isApiMode) return null

    const refreshed = await authApi.refresh()
    setAccessToken(refreshed.accessToken)
    return refreshed
  }

  function scheduleTokenRefresh() {
    if (!isApiMode || typeof window === "undefined") return
    clearRefreshTimer()

    const delayMs = getRefreshDelayMs()
    if (delayMs === null) return

    refreshTimerRef.current = window.setTimeout(async () => {
      try {
        await refreshSessionSilently()
        scheduleTokenRefresh()
      } catch (_error) {
        clearAuthSession()
        setSession(getSessionMeta())
        setIsAuthenticated(false)
        setShowStationPicker(false)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
        }
      }
    }, delayMs)
  }

  function applySessionState(payload, { promptStationSelection = false } = {}) {
    const nextSession = {
      user: payload?.user || null,
      station: payload?.station || null,
      role: payload?.role || null,
      stationMemberships: Array.isArray(payload?.stationMemberships) ? payload.stationMemberships : [],
    }
    setSessionMeta(nextSession)
    setSession(nextSession)
    setIsAuthenticated(true)
    setShowStationPicker(promptStationSelection && nextSession.stationMemberships.length > 1)
    scheduleTokenRefresh()
    return nextSession
  }

  async function bootstrapApiAuth() {
    try {
      const refreshed = await authApi.refresh()
      setAccessToken(refreshed.accessToken)
      const me = await authApi.me(refreshed.accessToken)
      assertStationManagerSession(me)
      applySessionState(me)
    } catch (_error) {
      clearAuthSession()
      setSession(getSessionMeta())
      setIsAuthenticated(false)
      setShowStationPicker(false)
      clearRefreshTimer()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isApiMode) {
      const mockSession = {
        user: { publicId: "MOCK-USER", fullName: "Mock Manager" },
        station: { publicId: "MOCK-STATION", name: "Mock Station", timezone: "Africa/Blantyre" },
        role: "MANAGER",
        stationMemberships: [
          {
            station: { publicId: "MOCK-STATION", name: "Mock Station", timezone: "Africa/Blantyre" },
            role: "MANAGER",
            isCurrent: true,
          },
        ],
      }
      applySessionState(mockSession)
      setLoading(false)
      return
    }

    bootstrapApiAuth()
  }, [isApiMode])

  useEffect(() => {
    if (!isApiMode || typeof window === "undefined") return undefined

    const handleAuthExpired = () => {
      clearRefreshTimer()
      clearAuthSession()
      setSession(getSessionMeta())
      setIsAuthenticated(false)
      setShowStationPicker(false)
      setLoading(false)
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [isApiMode])

  useEffect(() => {
    if (!isApiMode || typeof window === "undefined") return undefined

    const handleVisibilityRefresh = async () => {
      if (document.visibilityState !== "visible") return
      if (!isAuthenticated) return

      const delayMs = getRefreshDelayMs()
      if (delayMs !== null && delayMs > TOKEN_REFRESH_MIN_DELAY_MS) return

      try {
        await refreshSessionSilently()
        scheduleTokenRefresh()
      } catch (_error) {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
      }
    }

    window.addEventListener("focus", handleVisibilityRefresh)
    document.addEventListener("visibilitychange", handleVisibilityRefresh)

    return () => {
      window.removeEventListener("focus", handleVisibilityRefresh)
      document.removeEventListener("visibilitychange", handleVisibilityRefresh)
    }
  }, [isApiMode, isAuthenticated])

  useEffect(() => () => clearRefreshTimer(), [])

  async function login(credentials) {
    try {
      const data = await authApi.login(credentials)
      setAccessToken(data.accessToken)
      const me = await authApi.me(data.accessToken)
      assertStationManagerSession(me)
      applySessionState(
        {
          user: me.user || data.user,
          station: me.station || data.station,
          role: me.role || data.role,
          stationMemberships: me.stationMemberships || data.stationMemberships,
        },
        { promptStationSelection: true }
      )
    } catch (error) {
      clearAuthSession()
      setSession(getSessionMeta())
      setIsAuthenticated(false)
      setShowStationPicker(false)
      clearRefreshTimer()
      throw error
    }
  }

  async function switchStation(stationPublicId) {
    const switched = await authApi.switchStation({ stationPublicId })
    setAccessToken(switched.accessToken)
    const me = await authApi.me(switched.accessToken)
    assertStationManagerSession(me)
    applySessionState(
      {
        user: me.user || session?.user,
        station: me.station || switched.station,
        role: me.role || switched.role,
        stationMemberships: me.stationMemberships || switched.stationMemberships,
      },
      { promptStationSelection: false }
    )
    if (typeof window !== "undefined") {
      window.location.reload()
      return me
    }
    return me
  }

  async function logout(options = {}) {
    const skipRemote = options?.skipRemote === true
    if (isApiMode && !skipRemote) {
      try {
        await authApi.logout()
      } catch (_error) {
        // noop
      }
    }
    clearRefreshTimer()
    clearAuthSession()
    setSession(getSessionMeta())
    setIsAuthenticated(false)
    setShowStationPicker(false)
  }

  function updateSessionStation(patch) {
    setSession((current) => {
      const nextSession = {
        ...current,
        station: current?.station
          ? {
              ...current.station,
              ...patch,
            }
          : patch || null,
      }
      setSessionMeta(nextSession)
      return nextSession
    })
  }

  const value = useMemo(
    () => ({
      loading,
      isAuthenticated,
      session,
      login,
      switchStation,
      logout,
      showStationPicker,
      openStationPicker: () => setShowStationPicker(true),
      closeStationPicker: () => setShowStationPicker(false),
      updateSessionStation,
      isApiMode,
    }),
    [loading, isAuthenticated, session, isApiMode, showStationPicker]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return value
}

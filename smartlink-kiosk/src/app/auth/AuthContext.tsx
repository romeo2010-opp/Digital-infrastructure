import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { authApi } from "../api/authApi"
import { AUTH_EXPIRED_EVENT } from "../api/httpClient"
import {
  clearAuthSession,
  getSessionMeta,
  getTokenClaims,
  setAccessToken,
  setSessionMeta,
} from "./authSession"

const AuthContext = createContext<null | {
  loading: boolean
  isAuthenticated: boolean
  session: ReturnType<typeof getSessionMeta>
  isApiMode: boolean
  login: (credentials: { email?: string; phone?: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  switchStation: (stationPublicId: string) => Promise<void>
}>(null)

const STAFF_ROLES = new Set(["MANAGER", "ATTENDANT", "VIEWER"])
const TOKEN_REFRESH_LEAD_MS = 2 * 60 * 1000
const TOKEN_REFRESH_MIN_DELAY_MS = 30 * 1000

function assertStaffSession(me: {
  role?: string | null
  station?: { publicId?: string | null } | null
}) {
  const role = String(me?.role || "").trim().toUpperCase()
  const stationPublicId = String(me?.station?.publicId || "").trim()
  if (!stationPublicId || !STAFF_ROLES.has(role)) {
    throw new Error("This account is not a station staff account.")
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dataSource = String(import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase()
  const isApiMode = dataSource !== "mock"
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [session, setSession] = useState(getSessionMeta())
  const refreshTimerRef = useRef<number>(0)

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

  function applySessionState(payload: ReturnType<typeof getSessionMeta>) {
    const nextSession = {
      user: payload?.user || null,
      station: payload?.station || null,
      role: payload?.role || null,
      stationMemberships: Array.isArray(payload?.stationMemberships) ? payload.stationMemberships : [],
    }
    setSessionMeta(nextSession)
    setSession(nextSession)
    setIsAuthenticated(true)
    scheduleTokenRefresh()
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
      } catch {
        clearAuthSession()
        setSession(getSessionMeta())
        setIsAuthenticated(false)
      }
    }, delayMs)
  }

  useEffect(() => {
    if (!isApiMode) {
      applySessionState({
        user: { publicId: "MOCK-USER", fullName: "Mock Attendant" },
        station: { publicId: "MOCK-STATION", name: "Mock Station", timezone: "Africa/Blantyre" },
        role: "ATTENDANT",
        stationMemberships: [
          {
            station: { publicId: "MOCK-STATION", name: "Mock Station", timezone: "Africa/Blantyre" },
            role: "ATTENDANT",
            isCurrent: true,
          },
        ],
      })
      setLoading(false)
      return
    }

    authApi.refresh()
      .then(async (refreshed) => {
        setAccessToken(refreshed.accessToken)
        const me = await authApi.me(refreshed.accessToken)
        assertStaffSession(me)
        applySessionState(me)
      })
      .catch(() => {
        clearAuthSession()
        setSession(getSessionMeta())
        setIsAuthenticated(false)
      })
      .finally(() => setLoading(false))
  }, [isApiMode])

  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const handleAuthExpired = () => {
      clearRefreshTimer()
      clearAuthSession()
      setSession(getSessionMeta())
      setIsAuthenticated(false)
      setLoading(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  useEffect(() => () => clearRefreshTimer(), [])

  async function login(credentials: { email?: string; phone?: string; password: string }) {
    const data = await authApi.login(credentials)
    setAccessToken(data.accessToken)
    const me = await authApi.me(data.accessToken)
    assertStaffSession(me)
    applySessionState({
      user: me.user || data.user,
      station: me.station || data.station,
      role: me.role || data.role,
      stationMemberships: me.stationMemberships || data.stationMemberships,
    })
  }

  async function switchStation(stationPublicId: string) {
    const switched = await authApi.switchStation({ stationPublicId })
    setAccessToken(switched.accessToken)
    const me = await authApi.me(switched.accessToken)
    assertStaffSession(me)
    applySessionState({
      user: me.user || session?.user,
      station: me.station || switched.station,
      role: me.role || switched.role,
      stationMemberships: me.stationMemberships || switched.stationMemberships,
    })
  }

  async function logout() {
    if (isApiMode) {
      try {
        await authApi.logout()
      } catch {
        // noop
      }
    }
    clearRefreshTimer()
    clearAuthSession()
    setSession(getSessionMeta())
    setIsAuthenticated(false)
  }

  const value = useMemo(
    () => ({
      loading,
      isAuthenticated,
      session,
      isApiMode,
      login,
      logout,
      switchStation,
    }),
    [loading, isAuthenticated, session, isApiMode]
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

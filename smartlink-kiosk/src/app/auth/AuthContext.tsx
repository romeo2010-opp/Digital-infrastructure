import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { AUTH_EXPIRED_EVENT } from "../api/httpClient"
import { kioskAuthApi } from "../api/kioskAuthApi"
import {
  clearAuthSession,
  getKioskSessionId,
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
  completeKioskAuthorization: (kioskSession: Record<string, any>) => void
  login: (credentials: { email?: string; phone?: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  switchStation: (stationPublicId: string) => Promise<void>
}>(null)

const TOKEN_REFRESH_LEAD_MS = 2 * 60 * 1000
const TOKEN_REFRESH_MIN_DELAY_MS = 30 * 1000
const KIOSK_IDLE_TIMEOUT_MS = Number(import.meta.env.VITE_KIOSK_IDLE_TIMEOUT_MINUTES || 30) * 60 * 1000
const KIOSK_HEARTBEAT_MS = Math.max(10_000, Number(import.meta.env.VITE_KIOSK_HEARTBEAT_SECONDS || 20) * 1000)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dataSource = String(import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase()
  const isApiMode = dataSource !== "mock"
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [session, setSession] = useState(getSessionMeta())
  const refreshTimerRef = useRef<number>(0)
  const heartbeatTimerRef = useRef<number>(0)
  const lastActivityRef = useRef(Date.now())

  function clearRefreshTimer() {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = 0
    }
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = 0
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
      kiosk: payload?.kiosk || null,
      stationMemberships: Array.isArray(payload?.stationMemberships) ? payload.stationMemberships : [],
    }
    setSessionMeta(nextSession)
    setSession(nextSession)
    setIsAuthenticated(true)
    if (!nextSession.kiosk) {
      scheduleTokenRefresh()
    }
  }

  async function refreshSessionSilently() {
    return null
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

    clearAuthSession()
    setSession(getSessionMeta())
    setIsAuthenticated(false)
    setLoading(false)
  }, [isApiMode])

  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const handleAuthExpired = () => {
      clearRefreshTimer()
      clearHeartbeatTimer()
      clearAuthSession()
      setSession(getSessionMeta())
      setIsAuthenticated(false)
      setLoading(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  useEffect(() => () => clearRefreshTimer(), [])
  useEffect(() => () => clearHeartbeatTimer(), [])

  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const markActivity = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener("click", markActivity)
    window.addEventListener("keydown", markActivity)
    window.addEventListener("touchstart", markActivity)
    window.addEventListener("pointerdown", markActivity)
    return () => {
      window.removeEventListener("click", markActivity)
      window.removeEventListener("keydown", markActivity)
      window.removeEventListener("touchstart", markActivity)
      window.removeEventListener("pointerdown", markActivity)
    }
  }, [])

  useEffect(() => {
    clearHeartbeatTimer()
    if (!isAuthenticated || !isApiMode || typeof window === "undefined") return
    const sessionId = getKioskSessionId()
    if (!sessionId) return

    heartbeatTimerRef.current = window.setInterval(async () => {
      if (Date.now() - lastActivityRef.current > KIOSK_IDLE_TIMEOUT_MS) {
        await logout()
        return
      }

      try {
        const result = await kioskAuthApi.heartbeat(sessionId)
        if (String(result?.status || "").toLowerCase() !== "active") {
          throw new Error("Kiosk session is no longer active")
        }
      } catch {
        clearAuthSession()
        setSession(getSessionMeta())
        setIsAuthenticated(false)
        clearHeartbeatTimer()
      }
    }, KIOSK_HEARTBEAT_MS)
  }, [isAuthenticated, isApiMode, session?.kiosk?.sessionId])

  async function login(credentials: { email?: string; phone?: string; password: string }) {
    void credentials
    throw new Error("This kiosk uses QR authorization. Scan the kiosk code with a staff phone.")
  }

  async function switchStation(stationPublicId: string) {
    void stationPublicId
    throw new Error("Station switching is not available in kiosk mode.")
  }

  function completeKioskAuthorization(kioskSession: Record<string, any>) {
    setAccessToken(String(kioskSession?.accessToken || ""))
    lastActivityRef.current = Date.now()
    applySessionState({
      user: {
        publicId: kioskSession?.approvedBy?.userPublicId || null,
        fullName: kioskSession?.approvedBy?.fullName || "Station Staff",
      },
      station: kioskSession?.station || null,
      role: kioskSession?.roleScope || "ATTENDANT",
      kiosk: {
        sessionId: kioskSession?.sessionId || null,
        kioskName: kioskSession?.kiosk?.name || "Station kiosk",
        locationLabel: kioskSession?.kiosk?.locationLabel || null,
        permissions: Array.isArray(kioskSession?.permissions) ? kioskSession.permissions : [],
        expiresAt: kioskSession?.expiresAt || null,
      },
      stationMemberships: [],
    })
  }

  async function logout() {
    const sessionId = getKioskSessionId()
    if (isApiMode && sessionId) {
      try {
        await kioskAuthApi.revoke(sessionId)
      } catch {
        // noop
      }
    }
    clearRefreshTimer()
    clearHeartbeatTimer()
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
      completeKioskAuthorization,
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

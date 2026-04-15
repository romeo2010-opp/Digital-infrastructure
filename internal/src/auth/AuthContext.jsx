import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { authApi } from "../api/authApi"
import { clearSession, readSession, writeSession } from "./session"

const AuthContext = createContext(null)

export function InternalAuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession())
  const [loading, setLoading] = useState(Boolean(readSession()?.accessToken))

  async function refreshProfile(currentSession = session) {
    if (!currentSession?.accessToken) return null

    const me = await authApi.me()
    const nextSession = {
      ...currentSession,
      profile: me,
    }

    writeSession(nextSession)
    setSession(nextSession)
    return me
  }

  useEffect(() => {
    function handleExpired() {
      clearSession()
      setSession(null)
    }
    window.addEventListener("smartlink:internal-auth-expired", handleExpired)
    return () => window.removeEventListener("smartlink:internal-auth-expired", handleExpired)
  }, [])

  useEffect(() => {
    if (!session?.accessToken) {
      setLoading(false)
      return
    }
    let canceled = false
    ;(async () => {
      try {
        const me = await refreshProfile(session)
        if (canceled) return
        if (!me) return
      } catch {
        if (!canceled) {
          clearSession()
          setSession(null)
        }
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => {
      canceled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      isAuthenticated: Boolean(session?.accessToken),
      permissions: new Set(session?.profile?.permissions || []),
      async login(credentials) {
        const data = await authApi.login(credentials)
        const nextSession = {
          accessToken: data.accessToken,
          profile: {
            user: data.user,
            primaryRole: data.primaryRole,
            roles: data.roles,
            permissions: data.permissions,
            navigation: data.navigation,
            sessionPublicId: data.sessionPublicId,
          },
        }
        writeSession(nextSession)
        setSession(nextSession)
      },
      async logout() {
        try {
          await authApi.logout()
        } catch {
          // noop
        }
        clearSession()
        setSession(null)
      },
      refreshProfile,
      hasPermission(permissionCode) {
        return new Set(session?.profile?.permissions || []).has(permissionCode)
      },
    }),
    [loading, session]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useInternalAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useInternalAuth must be used within InternalAuthProvider")
  return context
}

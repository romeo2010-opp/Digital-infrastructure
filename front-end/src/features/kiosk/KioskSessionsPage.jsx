import { useCallback, useEffect, useMemo, useState } from "react"
import { kioskApi } from "../../api/kioskApi"
import { useAuth } from "../../auth/AuthContext"
import "./kiosk.css"

function formatDateTime(value) {
  if (!value) return "N/A"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function KioskSessionsPage() {
  const { session } = useAuth()
  const role = String(session?.role || "").toUpperCase()
  const canManage = ["MANAGER", "SUPERVISOR", "ADMIN"].includes(role)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busySession, setBusySession] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const summary = useMemo(() => {
    const now = Date.now()
    return {
      active: sessions.length,
      expiringSoon: sessions.filter((item) => new Date(item.expiresAt).getTime() - now < 30 * 60 * 1000).length,
      managers: sessions.filter((item) => String(item.roleScope || "").toUpperCase() === "MANAGER").length,
    }
  }, [sessions])

  const loadSessions = useCallback(async () => {
    if (!canManage) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError("")
      const data = await kioskApi.listActiveSessions()
      setSessions(data?.sessions || [])
    } catch (loadError) {
      setError(loadError?.message || "Unable to load kiosk sessions.")
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  async function revoke(sessionId) {
    try {
      setBusySession(sessionId)
      setError("")
      setMessage("")
      await kioskApi.revokeSession(sessionId)
      setMessage("Kiosk session revoked.")
      await loadSessions()
    } catch (revokeError) {
      setError(revokeError?.message || "Unable to revoke kiosk session.")
    } finally {
      setBusySession("")
    }
  }

  return (
    <section className="kiosk-page">
      <div className="kiosk-sessions-shell">
        <header className="kiosk-sessions-header">
          <div>
            <span>Station Security</span>
            <h2>Kiosk sessions</h2>
            <p>View and revoke active SmartLink station kiosk sessions.</p>
          </div>
          <button type="button" onClick={loadSessions} disabled={loading || !canManage}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {!canManage ? (
          <div className="kiosk-panel kiosk-muted">Manager access is required to view active kiosk sessions.</div>
        ) : (
          <>
            <div className="kiosk-summary-grid">
              <article>
                <span>Active</span>
                <strong>{summary.active}</strong>
              </article>
              <article>
                <span>Expiring soon</span>
                <strong>{summary.expiringSoon}</strong>
              </article>
              <article>
                <span>Manager scope</span>
                <strong>{summary.managers}</strong>
              </article>
            </div>

            {error ? <p className="kiosk-feedback kiosk-feedback-error">{error}</p> : null}
            {message ? <p className="kiosk-feedback kiosk-feedback-ok">{message}</p> : null}

            <div className="kiosk-table-wrap">
              <table className="kiosk-table">
                <thead>
                  <tr>
                    <th>Kiosk</th>
                    <th>Station</th>
                    <th>Approved by</th>
                    <th>Role</th>
                    <th>Started</th>
                    <th>Expires</th>
                    <th>Heartbeat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((item) => (
                    <tr key={item.sessionId}>
                      <td>{[item.kiosk?.name, item.kiosk?.locationLabel].filter(Boolean).join(" · ") || "Station kiosk"}</td>
                      <td>{item.station?.name || "Station"}</td>
                      <td>{item.approvedBy?.fullName || "Station staff"}</td>
                      <td>{item.roleScope || "ATTENDANT"}</td>
                      <td>{formatDateTime(item.startedAt)}</td>
                      <td>{formatDateTime(item.expiresAt)}</td>
                      <td>{formatDateTime(item.lastHeartbeatAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="kiosk-table-revoke"
                          disabled={busySession === item.sessionId}
                          onClick={() => revoke(item.sessionId)}
                        >
                          {busySession === item.sessionId ? "Revoking..." : "Revoke"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && sessions.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="kiosk-empty">No active kiosk sessions.</td>
                    </tr>
                  ) : null}
                  {loading ? (
                    <tr>
                      <td colSpan="8" className="kiosk-empty">Loading sessions...</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
import { kioskApi } from "../../api/kioskApi"
import "./kiosk.css"

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(min-width: 900px)").matches
  })

  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)")
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return isDesktop
}

function formatExpiry(value) {
  if (!value) return "N/A"
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export default function KioskApprovalPage() {
  const location = useLocation()
  const isDesktop = useIsDesktop()
  const challengeId = useMemo(() => new URLSearchParams(location.search).get("challenge") || "", [location.search])
  const [challenge, setChallenge] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const loadChallenge = useCallback(async () => {
    if (!challengeId) {
      setError("Kiosk challenge is missing.")
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError("")
      const data = await kioskApi.getChallenge(challengeId)
      setChallenge(data)
    } catch (loadError) {
      setError(loadError?.message || "Unable to load kiosk challenge.")
    } finally {
      setLoading(false)
    }
  }, [challengeId])

  useEffect(() => {
    loadChallenge()
  }, [loadChallenge])

  async function approve() {
    try {
      setBusyAction("approve")
      setError("")
      setMessage("")
      await kioskApi.approveChallenge(challengeId)
      setMessage("Kiosk session approved.")
      await loadChallenge()
    } catch (approveError) {
      setError(approveError?.message || "Unable to approve kiosk session.")
    } finally {
      setBusyAction("")
    }
  }

  async function deny() {
    try {
      setBusyAction("deny")
      setError("")
      setMessage("")
      await kioskApi.denyChallenge(challengeId)
      setMessage("Kiosk request denied.")
      await loadChallenge()
    } catch (denyError) {
      setError(denyError?.message || "Unable to deny kiosk request.")
    } finally {
      setBusyAction("")
    }
  }

  const status = String(challenge?.status || "").toLowerCase()
  const canAct = status === "pending" && !busyAction

  return (
    <section className="kiosk-page kiosk-approval-page">
      <div className="kiosk-phone-shell">
        <header className="kiosk-approval-header">
          <span>SmartLink Kiosk</span>
          <h2>Approve kiosk access</h2>
          <p>Only approve if you are physically near this kiosk.</p>
        </header>

        {isDesktop ? (
          <div className="kiosk-warning">Phone authorization required</div>
        ) : null}

        {loading ? <div className="kiosk-panel kiosk-muted">Loading kiosk request...</div> : null}

        {!loading && challenge ? (
          <div className="kiosk-panel">
            <div className="kiosk-detail-row">
              <span>Station</span>
              <strong>{challenge.stationName || "Station"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Kiosk</span>
              <strong>{[challenge.kioskName, challenge.locationLabel].filter(Boolean).join(" · ") || "Station kiosk"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Display code</span>
              <strong className="kiosk-display-code">{challenge.displayCode || "--- ---"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Requested access</span>
              <strong>{challenge.requestedAccessLevel || "Station kiosk operations"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Approval scope</span>
              <strong>{challenge.approverRoleScope || "Station staff"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Status</span>
              <strong className={`kiosk-status kiosk-status-${status || "pending"}`}>{status || "pending"}</strong>
            </div>
            <div className="kiosk-detail-row">
              <span>Expires</span>
              <strong>{formatExpiry(challenge.expiresAt)}</strong>
            </div>
          </div>
        ) : null}

        {error ? <p className="kiosk-feedback kiosk-feedback-error">{error}</p> : null}
        {message ? <p className="kiosk-feedback kiosk-feedback-ok">{message}</p> : null}

        <div className="kiosk-approval-actions">
          <button type="button" className="kiosk-deny" disabled={!canAct} onClick={deny}>
            {busyAction === "deny" ? "Denying..." : "Deny"}
          </button>
          <button type="button" className="kiosk-approve" disabled={!canAct} onClick={approve}>
            {busyAction === "approve" ? "Approving..." : "Approve"}
          </button>
        </div>
      </div>
    </section>
  )
}

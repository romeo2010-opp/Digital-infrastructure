import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import StatusPill from "../components/StatusPill"
import { formatDateTime } from "../utils/display"

function maskHash(value) {
  const normalized = String(value || "").trim()
  if (normalized.length <= 18) return normalized || "-"
  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

function defaultKioskName(challenge) {
  const code = String(challenge?.displayCode || "").replace(/[^A-Z0-9]/gi, "")
  return code ? `SmartLink Kiosk ${code}` : "SmartLink Kiosk"
}

export default function KioskRegistrationPage() {
  const [searchParams] = useSearchParams()
  const challengeId = String(searchParams.get("challenge") || "").trim()
  const [challenge, setChallenge] = useState(null)
  const [stations, setStations] = useState([])
  const [form, setForm] = useState({ stationPublicId: "", name: "", locationLabel: "" })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const activeStations = useMemo(() => stations.filter((station) => Number(station.is_active) === 1), [stations])
  const isPending = String(challenge?.status || "").toLowerCase() === "pending"

  async function load() {
    if (!challengeId) {
      setError("Kiosk registration challenge is missing.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    const [challengeData, stationData] = await Promise.all([
      internalApi.getKioskRegistrationChallenge(challengeId),
      internalApi.getKioskRegistrationStations(),
    ])
    setChallenge(challengeData)
    setStations(stationData?.items || [])
    setForm((current) => ({
      stationPublicId: current.stationPublicId || stationData?.items?.[0]?.public_id || "",
      name: current.name || defaultKioskName(challengeData),
      locationLabel: current.locationLabel,
    }))
    setLoading(false)
  }

  useEffect(() => {
    load().catch((err) => {
      setError(err?.message || "Failed to load kiosk registration challenge.")
      setLoading(false)
    })
  }, [challengeId])

  async function handleApprove(event) {
    event.preventDefault()
    if (!isPending) return
    if (!form.stationPublicId) {
      setError("Select a station before approving this kiosk.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const result = await internalApi.approveKioskRegistrationChallenge(challengeId, form)
      setSuccess(`Kiosk registered for ${result?.kiosk?.stationName || "selected station"}.`)
      await load()
    } catch (err) {
      setError(err?.message || "Failed to approve kiosk registration.")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeny() {
    if (!isPending) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      await internalApi.denyKioskRegistrationChallenge(challengeId)
      setSuccess("Kiosk registration denied.")
      await load()
    } catch (err) {
      setError(err?.message || "Failed to deny kiosk registration.")
    } finally {
      setSaving(false)
    }
  }

  const alerts = [
    error ? { id: "kiosk-registration-error", type: "ERROR", title: "Registration Error", body: error } : null,
    success ? { id: "kiosk-registration-success", type: "SUCCESS", title: "Registration Updated", body: success } : null,
  ].filter(Boolean)

  return (
    <InternalShell title="Kiosk Registration" alerts={alerts}>
      <div className="kiosk-registration-page">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>SmartLink Kiosk Setup</h2>
              <p>Internal technical registration for a station kiosk device.</p>
            </div>
            {challenge?.status ? <StatusPill value={challenge.status} /> : null}
          </div>
          <div className="panel-body">
            {loading ? (
              <div className="module-intro">Loading registration challenge...</div>
            ) : (
              <div className="kiosk-registration-layout">
                <div className="kiosk-registration-summary">
                  <div className="kiosk-registration-code">
                    <span>Display code</span>
                    <strong>{challenge?.displayCode || "--- ---"}</strong>
                  </div>
                  <div className="kiosk-registration-warning">
                    Only approve if you are physically near this kiosk and the code matches the kiosk screen.
                  </div>
                  <div className="kiosk-registration-meta">
                    <div>
                      <span>Status</span>
                      <strong>{challenge?.status || "-"}</strong>
                    </div>
                    <div>
                      <span>Expires</span>
                      <strong>{formatDateTime(challenge?.expiresAt)}</strong>
                    </div>
                    <div>
                      <span>Device hash</span>
                      <strong title={challenge?.deviceFingerprintHash || ""}>{maskHash(challenge?.deviceFingerprintHash)}</strong>
                    </div>
                    <div>
                      <span>IP address</span>
                      <strong>{challenge?.ipAddress || "-"}</strong>
                    </div>
                  </div>
                  <div className="kiosk-registration-user-agent">
                    <span>User agent</span>
                    <strong>{challenge?.userAgent || "-"}</strong>
                  </div>
                </div>

                <form className="kiosk-registration-form" onSubmit={handleApprove}>
                  <label>
                    <span>Station</span>
                    <select
                      value={form.stationPublicId}
                      onChange={(event) => setForm((current) => ({ ...current, stationPublicId: event.target.value }))}
                      disabled={!isPending || saving}
                    >
                      {activeStations.map((station) => (
                        <option key={station.public_id} value={station.public_id}>
                          {station.name} {station.city ? `- ${station.city}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Kiosk name</span>
                    <input
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="SmartLink Kiosk 01"
                      disabled={!isPending || saving}
                    />
                  </label>

                  <label>
                    <span>Location label</span>
                    <input
                      value={form.locationLabel}
                      onChange={(event) => setForm((current) => ({ ...current, locationLabel: event.target.value }))}
                      placeholder="Forecourt counter"
                      disabled={!isPending || saving}
                    />
                  </label>

                  {challenge?.kiosk ? (
                    <div className="kiosk-registration-result">
                      Registered as {challenge.kiosk.name} at {challenge.kiosk.stationName}.
                    </div>
                  ) : null}

                  <div className="kiosk-registration-actions">
                    <button type="submit" className="primary-action" disabled={!isPending || saving || !activeStations.length}>
                      {saving ? "Approving..." : "Approve"}
                    </button>
                    <button type="button" className="secondary-action" onClick={handleDeny} disabled={!isPending || saving}>
                      Deny
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </InternalShell>
  )
}

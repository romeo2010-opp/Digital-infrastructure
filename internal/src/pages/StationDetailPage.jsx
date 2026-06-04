import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Fuel, Gauge, RadioTower, Users } from "lucide-react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import StatusPill from "../components/StatusPill"
import { formatCodeLabel, formatDateTime, formatMoney, formatNumber } from "../utils/display"

function DetailStat({ label, value, icon: Icon }) {
  return (
    <div className="internal-detail-stat">
      <span className="internal-detail-stat__icon">{Icon ? <Icon aria-hidden="true" /> : null}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DetailSection({ title, subtitle, children, actions = null }) {
  return (
    <section className="internal-detail-section">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export default function StationDetailPage() {
  const { stationPublicId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError("")
    internalApi
      .getStationSetup(stationPublicId)
      .then((payload) => {
        if (!disposed) setData(payload)
      })
      .catch((err) => {
        if (!disposed) setError(err?.message || "Failed to load station detail")
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [stationPublicId])

  const station = data?.station || {}
  const tanks = data?.tanks || []
  const pumps = data?.pumps || []
  const staff = data?.staff || data?.staffMembers || []
  const checklist = useMemo(() => {
    const raw = data?.onboarding?.checklist || data?.onboardingChecklist || station?.onboarding_checklist
    if (Array.isArray(raw)) return raw
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([key, value]) => ({ key, label: formatCodeLabel(key), completed: Boolean(value) }))
    }
    return []
  }, [data, station])

  return (
    <InternalShell
      title="Station Detail"
      alerts={error ? [{ id: "station-detail-error", type: "ERROR", title: "Station Error", body: error }] : []}
      contentClassName="internal-page-inner--detail"
    >
      <button type="button" className="internal-detail-back" onClick={() => navigate("/stations")}>
        <ArrowLeft aria-hidden="true" />
        Back to stations
      </button>

      {loading ? <div className="dashboard-loading-card">Loading station dossier...</div> : null}

      {!loading && station ? (
        <>
          <section className="internal-detail-hero">
            <div>
              <span className="internal-detail-kicker">Station dossier</span>
              <h1>{station.name || "Station Detail"}</h1>
              <p>{station.address || station.city || station.public_id || stationPublicId}</p>
              <div className="internal-detail-pills">
                <StatusPill value={Number(station.is_active) === 1 ? "ACTIVE" : "INACTIVE"} />
                <StatusPill value={station.onboarding_status || data?.onboarding?.status || "-"} />
                <StatusPill value={data?.subscription?.status || station.subscription_status || "-"} />
              </div>
            </div>
            <div className="internal-detail-hero__meta">
              <span>Station ID</span>
              <strong>{station.public_id || stationPublicId}</strong>
              <span>Operator</span>
              <strong>{station.operator_name || station.operatorName || "-"}</strong>
            </div>
          </section>

          <div className="internal-detail-stat-grid">
            <DetailStat label="Tanks" value={formatNumber(tanks.length)} icon={Fuel} />
            <DetailStat label="Pumps" value={formatNumber(pumps.length)} icon={Gauge} />
            <DetailStat label="Nozzles" value={formatNumber(pumps.reduce((sum, pump) => sum + (pump.nozzles?.length || 0), 0))} icon={RadioTower} />
            <DetailStat label="Staff" value={formatNumber(staff.length)} icon={Users} />
          </div>

          <div className="internal-detail-grid">
            <DetailSection title="Station Summary" subtitle="Identity, location, operating posture, and timestamps.">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>City</span><strong>{station.city || "-"}</strong></div>
                <div><span>Country</span><strong>{station.country_code || "MW"}</strong></div>
                <div><span>Timezone</span><strong>{station.timezone || "Africa/Blantyre"}</strong></div>
                <div><span>Operating hours</span><strong>{station.open_24h ? "Open 24h" : `${String(station.opening_time || "-").slice(0, 5)} - ${String(station.closing_time || "-").slice(0, 5)}`}</strong></div>
                <div><span>Created</span><strong>{formatDateTime(station.created_at)}</strong></div>
                <div><span>Updated</span><strong>{formatDateTime(station.updated_at)}</strong></div>
              </div>
            </DetailSection>

            <DetailSection title="Subscription" subtitle="Current billing package and renewal state.">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>Plan</span><strong>{data?.subscription?.planName || data?.subscription?.planCode || station.subscription_plan || "-"}</strong></div>
                <div><span>Status</span><strong>{formatCodeLabel(data?.subscription?.status || station.subscription_status)}</strong></div>
                <div><span>Monthly fee</span><strong>{formatMoney(data?.subscription?.monthlyFeeMwk || 0)}</strong></div>
                <div><span>Renewal</span><strong>{formatDateTime(data?.subscription?.renewalDate)}</strong></div>
              </div>
            </DetailSection>
          </div>

          <DetailSection title="Tank Inventory" subtitle="Fuel storage linked to station pumps.">
            <div className="internal-detail-table-wrap">
              <table className="data-table">
                <thead><tr><th>Tank</th><th>Fuel</th><th>Capacity</th><th>Status</th></tr></thead>
                <tbody>
                  {tanks.length ? tanks.map((tank) => (
                    <tr key={tank.public_id || tank.id}>
                      <td>{tank.name || tank.public_id}</td>
                      <td>{formatCodeLabel(tank.fuel_code || tank.fuelType)}</td>
                      <td>{formatNumber(tank.capacity_litres)} L</td>
                      <td><StatusPill value={tank.is_active ? "ACTIVE" : "INACTIVE"} /></td>
                    </tr>
                  )) : <tr><td colSpan="4" className="empty-cell">No tanks recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </DetailSection>

          <DetailSection title="Pumps & Nozzles" subtitle="Pump hardware and nozzle product mapping.">
            <div className="internal-detail-pump-grid">
              {pumps.length ? pumps.map((pump) => (
                <article key={pump.public_id || pump.id} className="internal-detail-pump-card">
                  <header>
                    <strong>Pump {pump.pump_number || "-"}</strong>
                    <StatusPill value={pump.status || "-"} />
                  </header>
                  <span>{pump.public_id}</span>
                  <div>
                    {(pump.nozzles || []).length ? pump.nozzles.map((nozzle) => (
                      <div key={nozzle.public_id || nozzle.id}>
                        <span>Nozzle {nozzle.nozzle_number || "-"}</span>
                        <strong>{formatCodeLabel(nozzle.fuel_code || nozzle.fuelType)} · {formatCodeLabel(nozzle.status)}</strong>
                      </div>
                    )) : <p className="empty-cell">No nozzles recorded.</p>}
                  </div>
                </article>
              )) : <p className="empty-cell">No pumps recorded.</p>}
            </div>
          </DetailSection>

          <div className="internal-detail-grid">
            <DetailSection title="Station Staff" subtitle="Users currently assigned to this station.">
              <div className="timeline-list">
                {staff.length ? staff.map((member) => (
                  <article key={member.id || member.public_id || member.email} className="timeline-item">
                    <div>
                      <strong>{member.full_name || member.email || member.phone_e164 || "Station user"}</strong>
                      <p>{formatCodeLabel(member.role_code || member.role)} · {member.email || member.phone_e164 || "-"}</p>
                    </div>
                    <StatusPill value={member.is_active ? "ACTIVE" : "INACTIVE"} />
                  </article>
                )) : <p className="empty-cell">No staff assigned.</p>}
              </div>
            </DetailSection>

            <DetailSection title="Onboarding Checklist" subtitle="Readiness checkpoints for this station.">
              <div className="timeline-list">
                {checklist.length ? checklist.map((item, index) => (
                  <article key={item.key || item.id || index} className="timeline-item">
                    <div>
                      <strong>{formatCodeLabel(item.label || item.key || `Checklist item ${index + 1}`)}</strong>
                      <p>{item.note || "Station readiness checkpoint."}</p>
                    </div>
                    <StatusPill value={item.completed || item.status === "COMPLETED" ? "COMPLETED" : item.status || "PENDING"} />
                  </article>
                )) : <p className="empty-cell">No onboarding checklist recorded.</p>}
              </div>
            </DetailSection>
          </div>
        </>
      ) : null}
    </InternalShell>
  )
}

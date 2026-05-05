import { useMemo } from 'react'
import { MetricStrip } from '../components/MetricStrip'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function NationalDashboard() {
  const { data } = usePortal()

  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)
  const incidentRows = normalizeRows(data.auditLogs?.items).slice(0, 10)
  const districtRows = normalizeRows(data.districtShortages)
    .slice()
    .sort((a: any, b: any) => Number(b.shortage_stations || 0) - Number(a.shortage_stations || 0))
    .slice(0, 5)

  const criticalRows = useMemo(
    () =>
      watchlistRows
        .slice()
        .sort((a: any, b: any) => Number(b.riskScore || 0) - Number(a.riskScore || 0))
        .slice(0, 8),
    [watchlistRows],
  )

  const metrics = [
    { label: 'Active Licensed Stations', value: data.overview?.totalStations || 0, meta: 'Regulated national network' },
    { label: 'High Risk Stations', value: watchlistRows.filter((row: any) => ['HIGH', 'CRITICAL'].includes(String(row.escalationStatus || '').toUpperCase())).length, meta: 'Hoarding threshold exceeded' },
    { label: 'Open Complaints', value: data.overview?.openComplaints || 0, meta: 'Complaint casework in progress' },
    { label: 'Active Enforcement Cases', value: data.overview?.activeEnforcementActions || 0, meta: 'Legal interventions underway' },
    { label: "Today's Deliveries", value: normalizeRows(data.fuelDeliveryLogs?.items).length, meta: 'Logged tanker references' },
    { label: 'Districts Under Stress', value: districtRows.length, meta: 'Shortage or constrained supply' },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <MetricStrip items={metrics} />

      <div className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <SectionCard title="Critical Stations Requiring Attention" subtitle="National escalation queue">
          <PortalTable
            columns={[
              { key: 'stationName', label: 'Station' },
              { key: 'district', label: 'District' },
              { key: 'currentDeclaredAvailability', label: 'Current Status', render: (row) => renderPill(row.currentDeclaredAvailability) },
              { key: 'escalationStatus', label: 'Risk Level', render: (row) => renderPill(row.escalationStatus) },
              { key: 'complaints24h', label: 'Open Complaints' },
              { key: 'lastDeliveryLogged', label: 'Last Delivery', render: (row) => normalizeDate(row.lastDeliveryLogged) },
              { key: 'riskScore', label: 'Action', render: (row) => <span className="font-mono text-[11px] text-blue-700">RSK-{row.riskScore}</span> },
            ]}
            rows={criticalRows}
          />
        </SectionCard>

        <div className="grid gap-4">
          <SectionCard title="National Fuel Pressure Snapshot" subtitle="Top 5 stressed districts and supply pressure">
            <PortalTable
              columns={[
                { key: 'district', label: 'District' },
                { key: 'shortage_stations', label: 'Dry / Partial' },
                { key: 'total_stations', label: 'Total Stations' },
              ]}
              rows={districtRows}
            />
            <div className="grid gap-2 border-t border-slate-200 px-4 py-3 text-xs md:grid-cols-3">
              <div>
                <span className="block uppercase tracking-[0.08em] text-slate-500">Total dry stations</span>
                <strong className="text-sm text-slate-900">
                  {normalizeRows(data.heatmap).filter((row: any) => String(row.availability_status).toUpperCase() === 'DRY').length}
                </strong>
              </div>
              <div>
                <span className="block uppercase tracking-[0.08em] text-slate-500">Partial supply stations</span>
                <strong className="text-sm text-slate-900">
                  {normalizeRows(data.heatmap).filter((row: any) => String(row.availability_status).toUpperCase() === 'LIMITED').length}
                </strong>
              </div>
              <div>
                <span className="block uppercase tracking-[0.08em] text-slate-500">Tanker arrivals today</span>
                <strong className="text-sm text-slate-900">{normalizeRows(data.fuelDeliveryLogs?.items).length}</strong>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent Regulatory Incidents Log" subtitle="Chronological internal enforcement activity">
            <PortalTable
              columns={[
                { key: 'created_at', label: 'Timestamp', render: (row) => normalizeDate(row.created_at) },
                { key: 'action_type', label: 'Incident Type' },
                { key: 'actor_name', label: 'Officer', render: (row) => row.actor_name || 'System' },
                { key: 'action_description', label: 'Notes' },
              ]}
              rows={incidentRows}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

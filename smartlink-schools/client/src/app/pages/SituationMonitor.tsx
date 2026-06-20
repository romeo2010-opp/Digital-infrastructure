import { AlertTriangle, MapPinned, ShieldAlert } from 'lucide-react'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { MeraFuelHeatmap } from '../components/MeraFuelHeatmap'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function SituationMonitor() {
  const { data } = usePortal()

  const heatmapRows = normalizeRows(data.heatmap)
  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)
  const rootOpsRows = normalizeRows(data.opsPredictions?.items)
  const nationalOpsRows = normalizeRows(data.nationalOperations?.opsPredictions?.items)
  const forecastOpsRows = normalizeRows(data.demandForecastSummary?.opsPredictions?.items)
  const opsPredictionRows = rootOpsRows.length ? rootOpsRows : nationalOpsRows.length ? nationalOpsRows : forecastOpsRows
  const districtRows = normalizeRows(data.districtShortages)
    .slice()
    .sort((a: any, b: any) => Number(b.shortage_stations || 0) - Number(a.shortage_stations || 0))
    .slice(0, 8)

  const liveAlerts = watchlistRows
    .filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase()))
    .slice(0, 6)
  const shortageDistrictRows = districtRows.filter((row: any) => Number(row.shortage_stations || 0) > 0)
  const highSeverityAlertRows = watchlistRows.filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase()))
  const dryDeclarationRows = heatmapRows.filter((row: any) => String(row.availability_status || '').toUpperCase() === 'DRY')
  const criticalOpsRows = opsPredictionRows.filter((row: any) => {
    const prediction = row.prediction || {}
    return (
      String(prediction.congestion_level || '').toUpperCase() === 'CRITICAL' ||
      String(prediction.stockout_risk || '').toUpperCase() === 'CRITICAL'
    )
  })
  const recentSignalRows = heatmapRows.slice(0, 25)
  const districtColumns = [
    { key: 'district', label: 'District' },
    { key: 'shortage_stations', label: 'Dry / Limited' },
    { key: 'total_stations', label: 'Stations' },
  ]
  const alertColumns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'riskScore', label: 'Risk Score' },
    { key: 'escalationStatus', label: 'Escalation', render: (row: any) => row.escalationStatus || '-' },
  ]
  const signalColumns = [
    { key: 'name', label: 'Station' },
    { key: 'city', label: 'District' },
    { key: 'availability_status', label: 'Availability', render: (row: any) => row.availability_status || '-' },
    { key: 'petrol_status', label: 'Petrol', render: (row: any) => row.petrol_status || '-' },
    { key: 'diesel_status', label: 'Diesel', render: (row: any) => row.diesel_status || '-' },
  ]
  const opsColumns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'fuelType', label: 'Fuel' },
    { key: 'congestion', label: 'Congestion', render: (row: any) => row.prediction?.congestion_level || '-' },
    { key: 'stockoutRisk', label: 'Stockout', render: (row: any) => row.prediction?.stockout_risk || '-' },
  ]
  const situationAlerts = [
    ...criticalOpsRows.slice(0, 3).map((row: any) => ({
      key: `ml-${row.stationPublicId}-${row.fuelType}`,
      stationName: row.stationName,
      district: row.district,
      status: row.prediction?.congestion_level || row.prediction?.stockout_risk || 'CRITICAL',
      detail: row.prediction?.mera_summary || 'Operational pressure is elevated and requires review.',
      timestamp: row.generatedAt,
      source: 'ML operations forecast',
    })),
    ...liveAlerts.map((row: any) => ({
      key: `watch-${row.stationPublicId}-${row.riskScore}`,
      stationName: row.stationName,
      district: row.district,
      status: row.escalationStatus,
      detail: `Risk score ${row.riskScore} • ${row.currentDeclaredAvailability || 'Unknown status'}`,
      timestamp: row.lastDeliveryLogged,
      source: 'Regulatory watchlist',
    })),
  ].slice(0, 6)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <SectionKpiStrip
        items={[
          { label: 'Shortage Districts', value: shortageDistrictRows.length, rows: shortageDistrictRows, columns: districtColumns, tone: shortageDistrictRows.length ? 'warn' : 'good', accent: '#f59e0b' },
          { label: 'High-severity Alerts', value: highSeverityAlertRows.length, rows: highSeverityAlertRows, columns: alertColumns, tone: highSeverityAlertRows.length ? 'bad' : 'good', accent: '#dc2626' },
          { label: 'ML Critical Ops', value: criticalOpsRows.length, rows: criticalOpsRows, columns: opsColumns, tone: criticalOpsRows.length ? 'bad' : 'good', accent: '#0f766e' },
          { label: 'Dry Declarations', value: dryDeclarationRows.length, rows: dryDeclarationRows, columns: signalColumns, tone: dryDeclarationRows.length ? 'bad' : 'good', accent: '#111827' },
          { label: 'Recent Signals', value: recentSignalRows.length, rows: recentSignalRows, columns: signalColumns, accent: '#2563eb' },
        ]}
      />

      <MeraFuelHeatmap rows={heatmapRows} title="Fuel Availability Map" className="h-[560px]" />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Regional Situation Table" subtitle="District-level pressure signals ranked by live shortage load">
          <PortalTable
            rows={districtRows}
            columns={[
              { key: 'district', label: 'District' },
              { key: 'shortage_stations', label: 'Dry / Limited' },
              { key: 'total_stations', label: 'Stations' },
              {
                key: 'pressure',
                label: 'Pressure',
                render: (row) => {
                  const total = Number(row.total_stations || 0)
                  const shortage = Number(row.shortage_stations || 0)
                  const score = total > 0 ? Math.round((shortage / total) * 100) : 0
                  return renderPill(score >= 60 ? 'CRITICAL' : score >= 35 ? 'ELEVATED' : 'STABLE')
                },
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Situation Alerts" subtitle="High-severity watchlist and oversight prompts">
          <div className="space-y-3 px-4 py-4">
            {situationAlerts.length ? (
              situationAlerts.map((row: any) => (
                <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-8 items-center justify-center rounded-full bg-red-50 text-red-600">
                        <ShieldAlert className="size-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{row.stationName}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.district || 'Unknown district'}</div>
                      </div>
                    </div>
                    {renderPill(row.status)}
                  </div>
                  <div className="mt-3 text-xs text-slate-600">
                    {row.detail}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">{row.source} • {normalizeDate(row.timestamp)}</div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No elevated situation alerts are active right now.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="National Posture Summary" subtitle="Live interpretation of current fuel stress conditions">
          <div className="space-y-3 px-5 py-5 text-sm text-slate-600">
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <MapPinned className="mt-0.5 size-4 text-blue-700" />
              <div>
                <div className="font-semibold text-slate-900">Regional fuel stress</div>
                <p className="mt-1">District pressure is derived from live shortage summaries and station availability reports already flowing through the MERA portal.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
              <div>
                <div className="font-semibold text-slate-900">Escalation conditions</div>
                <p className="mt-1">Critical station alerts are pulled from the hoarding watchlist and presented here as regulator-level situation prompts.</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Recent Availability Signals" subtitle="Latest national shortage-heatmap records in operational order">
          <PortalTable
            rows={heatmapRows.slice(0, 8)}
            columns={[
              { key: 'name', label: 'Station', render: (row) => row.name || '-' },
              { key: 'city', label: 'District', render: (row) => row.city || '-' },
              { key: 'availability_status', label: 'Availability', render: (row) => renderPill(row.availability_status) },
              { key: 'petrol_status', label: 'Petrol', render: (row) => renderPill(row.petrol_status) },
              { key: 'diesel_status', label: 'Diesel', render: (row) => renderPill(row.diesel_status) },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  )
}

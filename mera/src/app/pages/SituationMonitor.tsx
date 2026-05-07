import { useMemo } from 'react'
import { AlertTriangle, MapPinned, ShieldAlert } from 'lucide-react'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function SituationMonitor() {
  const { data } = usePortal()

  const heatmapRows = normalizeRows(data.heatmap)
  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)
  const districtRows = normalizeRows(data.districtShortages)
    .slice()
    .sort((a: any, b: any) => Number(b.shortage_stations || 0) - Number(a.shortage_stations || 0))
    .slice(0, 8)

  const totals = useMemo(() => {
    const dry = heatmapRows.filter((row: any) => String(row.availability_status || '').toUpperCase() === 'DRY').length
    const limited = heatmapRows.filter((row: any) => String(row.availability_status || '').toUpperCase() === 'LIMITED').length
    const available = heatmapRows.filter((row: any) => String(row.availability_status || '').toUpperCase() === 'AVAILABLE').length
    const critical = watchlistRows.filter((row: any) => String(row.escalationStatus || '').toUpperCase() === 'CRITICAL').length
    return { dry, limited, available, critical }
  }, [heatmapRows, watchlistRows])

  const liveAlerts = watchlistRows
    .filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase()))
    .slice(0, 6)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Stations Available', totals.available, 'Reported live across the network'],
          ['Dry Stations', totals.dry, 'Confirmed out-of-stock locations'],
          ['Limited Supply', totals.limited, 'Stations under constrained supply'],
          ['Critical Alerts', totals.critical, 'Sites requiring regulator attention'],
        ].map(([label, value, note]) => (
          <SectionCard key={String(label)} title={String(label)} subtitle={String(note)}>
            <div className="px-5 py-5">
              <div className="text-[2.15rem] font-semibold tracking-[-0.04em] text-slate-900">{value}</div>
            </div>
          </SectionCard>
        ))}
      </div>

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
            {liveAlerts.length ? (
              liveAlerts.map((row: any) => (
                <div key={`${row.stationPublicId}-${row.riskScore}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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
                    {renderPill(row.escalationStatus)}
                  </div>
                  <div className="mt-3 text-xs text-slate-600">
                    Risk score {row.riskScore} • {row.currentDeclaredAvailability || 'Unknown status'}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">{normalizeDate(row.lastDeliveryLogged)}</div>
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

import { Activity, ArrowRight, TrendingUp } from 'lucide-react'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.round(value)}%`
}

function formatLitres(value: number) {
  if (!Number.isFinite(value)) return '0 L'
  return `${Math.round(value).toLocaleString()} L`
}

export function DemandForecasting() {
  const { data } = usePortal()

  const forecastPayload = data.demandForecastSummary || {}
  const forecastRows = normalizeRows(forecastPayload.rows)
  const summary = forecastPayload.summary || {}
  const topDistrict = forecastRows[0] || null

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Demand Outlook Summary" subtitle="Smart forecast model derived from live inventory, transactions, queues, complaints, flags, and recent deliveries">
          <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">National demand signal</div>
              <div className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-slate-900">{formatPercent(Number(summary.nationalSignal || 0))}</div>
              <div className="mt-2 text-xs text-slate-500">Blended from live inventory coverage, outages, demand velocity, and pressure signals.</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Constrained stations</div>
              <div className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-slate-900">{Number(summary.constrainedStations || 0)}</div>
              <div className="mt-2 text-xs text-slate-500">Full dry stations plus partial-fuel outage stations in the current model.</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Projected 6h demand</div>
              <div className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-slate-900">{formatLitres(Number(summary.totalProjectedDemandLitres || 0))}</div>
              <div className="mt-2 text-xs text-slate-500">Expected district demand in the next six hours from the forecast engine.</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Forecasting Notes" subtitle="Model interpretation for market planners and regulator response teams">
          <div className="space-y-3 px-5 py-5">
            {[
              {
                icon: TrendingUp,
                title: 'Demand is forecast from real transaction rhythms',
                body: 'The engine uses the last seven days of hourly litres sold, then projects the next six hours by district.',
              },
              {
                icon: Activity,
                title: 'Inventory coverage tempers the signal',
                body: 'Latest remaining litres per active tank are compared against projected demand to estimate how many hours of cover remain.',
              },
              {
                icon: ArrowRight,
                title: 'Relief and stress factors both count',
                body: summary.explanation || 'Queues, complaints, active flags, shortages, and recent deliveries all shift the district pressure score.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-blue-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.body}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="District Demand Forecast Register" subtitle="Pressure-ranked districts with projected demand, coverage, outage load, and response guidance">
          <PortalTable
            rows={forecastRows}
            columns={[
              { key: 'district', label: 'District' },
              { key: 'totalStations', label: 'Stations' },
              { key: 'shortageStations', label: 'Dry / Limited' },
              { key: 'outOfStockStations', label: 'Dry' },
              { key: 'partialOutageStations', label: 'Partial' },
              { key: 'projectedDemandLitres', label: '6h Demand', render: (row) => formatLitres(Number(row.projectedDemandLitres || 0)) },
              {
                key: 'coverageHours',
                label: 'Coverage',
                render: (row) =>
                  row.coverageHours === null || row.coverageHours === undefined ? '-' : `${Number(row.coverageHours).toFixed(1)}h`,
              },
              { key: 'pressureScore', label: 'Pressure', render: (row) => `${row.pressureScore}%` },
              { key: 'outlook', label: 'Outlook', render: (row) => renderPill(row.outlook) },
              { key: 'nextDelivery', label: 'Latest Delivery', render: (row) => normalizeDate(row.nextDelivery) },
            ]}
          />
        </SectionCard>

        <SectionCard title="Priority District" subtitle="Highest-pressure district from the current forecast run">
          <div className="space-y-3 px-5 py-5">
            {topDistrict ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{topDistrict.district}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="text-[2rem] font-semibold tracking-[-0.04em] text-slate-900">{topDistrict.pressureScore}%</div>
                    {renderPill(topDistrict.outlook)}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">{topDistrict.recommendation}</div>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Inventory</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{formatLitres(Number(topDistrict.inventoryLitres || 0))}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Projected 6h demand</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{formatLitres(Number(topDistrict.projectedDemandLitres || 0))}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Avg wait</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{Number(topDistrict.avgWaitMinutes || 0)} min</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">Open complaints</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{Number(topDistrict.openComplaints || 0)}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No district forecast data is available yet.
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

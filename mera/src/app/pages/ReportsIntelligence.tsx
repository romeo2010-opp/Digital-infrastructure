import { useMemo, useState } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { KpiDrilldownCard, KpiDrilldownDrawer, type DrilldownConfig } from '../components/KpiDrilldown'
import { KpiSkeletonStrip, PanelSkeleton, TableSkeleton } from '../components/LiveDataSkeleton'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const reportColumns = [
  { key: 'name', label: 'Report Name' },
  { key: 'type', label: 'Type', render: (row: any) => renderPill(row.type) },
  { key: 'period', label: 'Period' },
  { key: 'generated', label: 'Generated', render: (row: any) => normalizeDate(row.generated) },
  { key: 'source', label: 'Source Summary' },
]

export function ReportsIntelligence() {
  const { data, refresh, runAction, hasPermission, liveDataLoading, actionLoading } = usePortal()
  const [range, setRange] = useState('30d')
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const canExport = hasPermission(MERA_PERMISSIONS.REPORTS_EXPORT)
  const canGenerate = hasPermission(MERA_PERMISSIONS.REPORTS_GENERATE)
  const demandRows = normalizeRows(data.demandForecastSummary?.rows)
  const hoardingRows = normalizeRows(data.hoardingWatchlist?.items)
  const districtRows = normalizeRows(data.districtShortages)
  const offenderRows = normalizeRows(data.repeatedOffenders)
  const enforcementRows = normalizeRows(data.enforcementActions?.items)
  const complaintRows = normalizeRows(data.complaints?.items)
  const isInitialLoading = liveDataLoading && !demandRows.length && !districtRows.length && !hoardingRows.length

  const reportRows = useMemo(() => [
    {
      name: 'Monthly Hoarding Report',
      type: 'Enforcement',
      period: normalizeRows(data.monthlyReports).at(-1)?.month_bucket || 'Current cycle',
      generated: new Date().toISOString(),
      source: `${hoardingRows.length} watchlist records`,
    },
    {
      name: 'District Fuel Stress Report',
      type: 'Analytics',
      period: 'Live national snapshot',
      generated: new Date().toISOString(),
      source: `${districtRows.length} district summaries`,
    },
    {
      name: 'Repeat Offenders Report',
      type: 'Enforcement',
      period: 'Current offenders set',
      generated: new Date().toISOString(),
      source: `${offenderRows.length} repeat offender stations`,
    },
    {
      name: 'Enforcement Outcome Report',
      type: 'Compliance',
      period: 'Current action ledger',
      generated: new Date().toISOString(),
      source: `${enforcementRows.length} enforcement actions`,
    },
    {
      name: 'Complaint Analytics',
      type: 'Analytics',
      period: 'Current complaint cycle',
      generated: new Date().toISOString(),
      source: `${complaintRows.length} complaint records`,
    },
  ], [complaintRows.length, data.monthlyReports, districtRows.length, enforcementRows.length, hoardingRows.length, offenderRows.length])

  const avgWait = demandRows.length
    ? Math.round(demandRows.reduce((sum: number, row: any) => sum + Number(row.avgWaitMinutes || row.avg_wait_minutes || 0), 0) / demandRows.length)
    : 0
  const criticalDistricts = districtRows.filter((row: any) => Number(row.shortage_count || row.shortageCount || row.value || 0) > 0)
  const topDistrict = criticalDistricts[0]?.district || criticalDistricts[0]?.city || 'Stable'
  const projectedShortfall = demandRows.length ? `${Math.max(1, Math.round(avgWait / 12))}.0d` : '0d'

  const intelligenceRows = [
    { title: 'Generate Hoarding Intelligence', summary: 'Refresh live hoarding watchlist, factors, and escalations.', rows: hoardingRows },
    { title: 'Generate District Fuel Stress Report', summary: 'Recompute district shortage summaries and pressure rankings.', rows: districtRows },
    { title: 'Generate Repeat Offenders Report', summary: 'Refresh stations with repeated flags or enforcement activity.', rows: offenderRows },
    { title: 'Generate Enforcement Outcome Report', summary: 'Update action status coverage and current legal exposure.', rows: enforcementRows },
    { title: 'Generate Complaint Analytics', summary: 'Rebuild live complaint metrics and type distributions.', rows: complaintRows },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f4f5f7] p-4 text-[#111827]">
      {isInitialLoading ? (
        <>
          <KpiSkeletonStrip count={4} />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
            <TableSkeleton rows={6} columns={5} />
            <PanelSkeleton />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {['7d', '30d', '90d', '1y'].map((item) => (
                <button key={item} type="button" onClick={() => setRange(item)} className={`h-8 rounded-[4px] border px-3 text-[11px] font-bold uppercase ${range === item ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#e2e8f0] bg-white text-[#6b7280] hover:bg-[#f9fafb]'}`}>
                  {item}
                </button>
              ))}
            </div>
            <Toolbar>
              {canExport ? (
                <Button type="button" variant="outline" size="sm">
                  <Download className="size-4" />
                  Export Report
                </Button>
              ) : null}
            </Toolbar>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <KpiDrilldownCard label="Avg Wait Signal" value={`${avgWait} min`} delta={range} helper="forecast average" accent="#2563eb" onClick={() => setDrilldown({ title: 'Average wait signal', value: `${avgWait} min`, subtitle: 'Demand forecasting rows represented by this KPI.', note: 'Calculated as the average avgWaitMinutes from demand forecast summary rows.', rows: demandRows, columns: [{ key: 'station', label: 'Station', render: (row: any) => row.stationName || row.station || row.district || '-' }, { key: 'avgWaitMinutes', label: 'Avg Wait', render: (row: any) => row.avgWaitMinutes || row.avg_wait_minutes || '-' }, { key: 'fuelType', label: 'Fuel', render: (row: any) => row.fuelType || row.fuel_type || '-' }] })} />
            <KpiDrilldownCard label="Peak Risk District" value={topDistrict} delta={`${criticalDistricts.length} areas`} helper="shortage pressure" tone={criticalDistricts.length ? 'warn' : 'good'} accent="#10b981" onClick={() => setDrilldown({ title: 'Peak risk district', value: topDistrict, subtitle: 'District shortage summaries represented by this KPI.', rows: criticalDistricts, columns: [{ key: 'district', label: 'District', render: (row: any) => row.district || row.city || '-' }, { key: 'value', label: 'Pressure', render: (row: any) => row.shortage_count || row.shortageCount || row.value || 0 }] })} />
            <KpiDrilldownCard label="Supply Risk Index" value={criticalDistricts.length ? 'Medium' : 'Low'} delta={criticalDistricts.length ? 'elevated' : 'stable'} helper="district stress" tone={criticalDistricts.length ? 'warn' : 'good'} accent="#f59e0b" onClick={() => setDrilldown({ title: 'Supply risk index', value: criticalDistricts.length ? 'Medium' : 'Low', subtitle: 'District shortage summaries contributing to risk.', rows: criticalDistricts, columns: [{ key: 'district', label: 'District', render: (row: any) => row.district || row.city || '-' }, { key: 'value', label: 'Pressure', render: (row: any) => row.shortage_count || row.shortageCount || row.value || 0 }] })} />
            <KpiDrilldownCard label="Projected Shortfall" value={projectedShortfall} delta="forecast" helper="at current pressure" tone={demandRows.length ? 'bad' : 'neutral'} accent="#dc2626" onClick={() => setDrilldown({ title: 'Projected shortfall', value: projectedShortfall, subtitle: 'Demand forecast rows behind the projected shortfall signal.', note: 'This dashboard signal uses live demand forecast rows; production forecasting logic can replace this derived UI estimate when available.', rows: demandRows, columns: [{ key: 'station', label: 'Station', render: (row: any) => row.stationName || row.station || row.district || '-' }, { key: 'avgWaitMinutes', label: 'Avg Wait', render: (row: any) => row.avgWaitMinutes || row.avg_wait_minutes || '-' }] })} />
          </div>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
            <SectionCard title="Downloadable Report Ledger" subtitle="Document-style live intelligence outputs for regulatory operations">
              <PortalTable
                rows={reportRows}
                columns={[
                  ...reportColumns,
                  {
                    key: 'action',
                    label: 'Action',
                    render: () => (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563eb]">
                        <Download className="size-3.5" />
                        Download
                      </span>
                    ),
                  },
                ]}
              />
            </SectionCard>

            <SectionCard title="Intelligence Generation" subtitle="Operational refresh actions for derived national reports">
              <div className="space-y-2 px-4 py-3">
                {intelligenceRows.map((item) => (
                  <div key={item.title} className="rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] p-3">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 size-4 text-[#2563eb]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#111827]">{item.title}</div>
                        <div className="mt-1 text-xs text-[#6b7280]">{item.summary}</div>
                      </div>
                    </div>
                    {canGenerate ? (
                      <Button type="button" size="sm" className="mt-3 bg-[#111827] hover:bg-[#1f2937]" disabled={actionLoading} onClick={() => runAction(() => Promise.resolve(refresh()), `Generating ${item.title}...`, { refresh: false })}>
                        <RefreshCw className="size-4" />
                        Generate
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />
    </div>
  )
}

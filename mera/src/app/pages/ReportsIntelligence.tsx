import { Download, FileText, RefreshCw } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function ReportsIntelligence() {
  const { data, refresh, hasPermission } = usePortal()
  const canExport = hasPermission(MERA_PERMISSIONS.REPORTS_EXPORT)
  const canGenerate = hasPermission(MERA_PERMISSIONS.REPORTS_GENERATE)

  const reportRows = [
    {
      name: 'Monthly Hoarding Report',
      type: 'Enforcement',
      period: normalizeRows(data.monthlyReports).at(-1)?.month_bucket || 'Current cycle',
      generated: new Date().toISOString(),
      source: `${normalizeRows(data.hoardingWatchlist?.items).length} watchlist records`,
    },
    {
      name: 'District Fuel Stress Report',
      type: 'Analytics',
      period: 'Live national snapshot',
      generated: new Date().toISOString(),
      source: `${normalizeRows(data.districtShortages).length} district summaries`,
    },
    {
      name: 'Repeat Offenders Report',
      type: 'Enforcement',
      period: 'Current offenders set',
      generated: new Date().toISOString(),
      source: `${normalizeRows(data.repeatedOffenders).length} repeat offender stations`,
    },
    {
      name: 'Enforcement Outcome Report',
      type: 'Compliance',
      period: 'Current action ledger',
      generated: new Date().toISOString(),
      source: `${normalizeRows(data.enforcementActions?.items).length} enforcement actions`,
    },
    {
      name: 'Complaint Analytics',
      type: 'Analytics',
      period: 'Current complaint cycle',
      generated: new Date().toISOString(),
      source: `${normalizeRows(data.complaints?.items).length} complaint records`,
    },
  ]

  const intelligenceRows = [
    { title: 'Generate Hoarding Intelligence', summary: 'Refresh live hoarding watchlist, factors, and escalations.', action: refresh },
    { title: 'Generate District Fuel Stress Report', summary: 'Recompute district shortage summaries and pressure rankings.', action: refresh },
    { title: 'Generate Repeat Offenders Report', summary: 'Refresh stations with repeated flags or enforcement activity.', action: refresh },
    { title: 'Generate Enforcement Outcome Report', summary: 'Update action status coverage and current legal exposure.', action: refresh },
    { title: 'Generate Complaint Analytics', summary: 'Rebuild live complaint metrics and type distributions.', action: refresh },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canExport ? (
          <Button type="button" variant="outline" size="sm">
            <Download className="size-4" />
            Export Intelligence
          </Button>
        ) : null}
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard title="Downloadable Report Ledger" subtitle="Document-style live intelligence outputs for regulatory operations">
          <PortalTable
            rows={reportRows}
            columns={[
              { key: 'name', label: 'Report Name' },
              { key: 'type', label: 'Type', render: (row) => renderPill(row.type) },
              { key: 'period', label: 'Period' },
              { key: 'generated', label: 'Generated', render: (row) => normalizeDate(row.generated) },
              { key: 'source', label: 'Source Summary' },
              {
                key: 'action',
                label: 'Action',
                render: () => (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
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
              <div key={item.title} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 size-4 text-blue-700" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.summary}</div>
                  </div>
                </div>
                {canGenerate ? (
                  <Button type="button" size="sm" className="mt-3 bg-blue-700 hover:bg-blue-800" onClick={item.action}>
                    <RefreshCw className="size-4" />
                    Generate
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

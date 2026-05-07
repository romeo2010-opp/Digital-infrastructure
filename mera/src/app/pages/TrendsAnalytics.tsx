import { BarChart3, Clock3, ShieldAlert } from 'lucide-react'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { usePortal } from '../lib/portalContext'
import { normalizeRows, renderPill } from '../lib/portalUtils'

function average(numbers: number[]) {
  if (!numbers.length) return 0
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)
}

export function TrendsAnalytics() {
  const { data } = usePortal()

  const monthlyRows = normalizeRows(data.monthlyReports)
  const complaintRows = normalizeRows(data.complaints?.items)
  const enforcementRows = normalizeRows(data.enforcementActions?.items)
  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)
  const inspectionRows = normalizeRows(data.inspections?.items)

  const monthlyTrendRows = monthlyRows
    .slice()
    .sort((a: any, b: any) => String(b.month_bucket || '').localeCompare(String(a.month_bucket || '')))
    .slice(0, 6)
    .map((row: any) => ({
      month: row.month_bucket || '-',
      complaints: Number(row.complaints_total || row.complaint_count || 0),
      flags: Number(row.flags_total || row.flag_count || 0),
      inspections: Number(row.inspections_total || row.inspection_count || 0),
      actions: Number(row.enforcement_total || row.enforcement_count || 0),
      posture:
        Number(row.flags_total || row.flag_count || 0) > 10
          ? 'Elevated'
          : Number(row.complaints_total || row.complaint_count || 0) > 10
            ? 'Watch'
            : 'Stable',
    }))

  const unresolvedComplaints = complaintRows.filter((row: any) => !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(String(row.complaintStatus || '').toUpperCase())).length
  const activeInvestigations = enforcementRows.filter((row: any) => ['PENDING', 'OPEN', 'IN_PROGRESS'].includes(String(row.actionStatus || row.status || '').toUpperCase())).length
  const highRiskStations = watchlistRows.filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase())).length
  const avgInspectionQueue = average(inspectionRows.map((row: any) => Number(row.queueLength || 0)).filter((value) => Number.isFinite(value)))

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Open complaints', unresolvedComplaints, 'Current unresolved case pressure', Clock3],
          ['Active investigations', activeInvestigations, 'Pending enforcement workflows', ShieldAlert],
          ['High risk stations', highRiskStations, 'Critical or high watchlist sites', BarChart3],
          ['Avg inspection queue', avgInspectionQueue, 'Mean queued cases per inspection record', Clock3],
        ].map(([label, value, note, Icon]) => (
          <SectionCard key={String(label)} title={String(label)} subtitle={String(note)}>
            <div className="flex items-center justify-between px-5 py-5">
              <div className="text-[2rem] font-semibold tracking-[-0.04em] text-slate-900">{value}</div>
              <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <Icon className="size-4" />
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Monthly Trend Ledger" subtitle="Cross-module trend records surfaced from the monthly MERA reporting feed">
          <PortalTable
            rows={monthlyTrendRows}
            columns={[
              { key: 'month', label: 'Month' },
              { key: 'complaints', label: 'Complaints' },
              { key: 'flags', label: 'Flags' },
              { key: 'inspections', label: 'Inspections' },
              { key: 'actions', label: 'Enforcement' },
              { key: 'posture', label: 'Posture', render: (row) => renderPill(row.posture) },
            ]}
          />
        </SectionCard>

        <SectionCard title="Analyst Notes" subtitle="Fast interpretation of the current trend picture">
          <div className="space-y-3 px-5 py-5">
            {[
              ['Complaint pressure', `${unresolvedComplaints} unresolved complaints are still active across the national queue.`],
              ['Enforcement posture', `${activeInvestigations} actions are awaiting follow-through or closure.`],
              ['Risk concentration', `${highRiskStations} stations remain in high-severity anomaly review.`],
            ].map(([title, body]) => (
              <div key={String(title)} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{body}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

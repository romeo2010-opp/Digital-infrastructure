import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { PortalTable } from '../components/PortalTable'
import { usePortal } from '../lib/portalContext'
import { normalizeRows, renderPill } from '../lib/portalUtils'

export function TrendsAnalytics() {
  const { data } = usePortal()

  const monthlyRows = normalizeRows(data.monthlyReports)
  const complaintRows = normalizeRows(data.complaints?.items)
  const enforcementRows = normalizeRows(data.enforcementActions?.items)
  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)

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

  const unresolvedComplaintRows = complaintRows.filter((row: any) => !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(String(row.complaintStatus || '').toUpperCase()))
  const activeInvestigationRows = enforcementRows.filter((row: any) => ['PENDING', 'OPEN', 'IN_PROGRESS'].includes(String(row.actionStatus || row.status || '').toUpperCase()))
  const highRiskStationRows = watchlistRows.filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase()))
  const repeatOffenderRows = watchlistRows.filter((row: any) => Number(row.complaints24h || 0) >= 2 || Number(row.inspectionFailures || 0) >= 2 || Number(row.riskScore || 0) >= 75)
  const trendColumns = [
    { key: 'month', label: 'Month' },
    { key: 'complaints', label: 'Complaints' },
    { key: 'flags', label: 'Flags' },
    { key: 'inspections', label: 'Inspections' },
    { key: 'actions', label: 'Enforcement' },
  ]
  const complaintColumns = [
    { key: 'publicId', label: 'Complaint' },
    { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
    { key: 'complaintStatus', label: 'Status', render: (row: any) => row.complaintStatus || '-' },
    { key: 'complaintType', label: 'Type', render: (row: any) => row.complaintType || '-' },
  ]
  const stationRiskColumns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'riskScore', label: 'Risk Score' },
    { key: 'escalationStatus', label: 'Escalation', render: (row: any) => row.escalationStatus || '-' },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <SectionKpiStrip
        items={[
          { label: 'Monthly Reports', value: monthlyTrendRows.length, rows: monthlyTrendRows, columns: trendColumns, accent: '#2563eb' },
          { label: 'Shortage Trend', value: highRiskStationRows.length, rows: highRiskStationRows, columns: stationRiskColumns, tone: highRiskStationRows.length ? 'warn' : 'good', accent: '#f59e0b' },
          { label: 'Complaint Trend', value: unresolvedComplaintRows.length, rows: unresolvedComplaintRows, columns: complaintColumns, tone: unresolvedComplaintRows.length ? 'warn' : 'good', accent: '#7c3aed' },
          { label: 'Repeat Offenders', value: repeatOffenderRows.length, rows: repeatOffenderRows, columns: stationRiskColumns, tone: repeatOffenderRows.length ? 'bad' : 'good', accent: '#dc2626' },
        ]}
      />

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
              ['Complaint pressure', `${unresolvedComplaintRows.length} unresolved complaints are still active across the national queue.`],
              ['Enforcement posture', `${activeInvestigationRows.length} actions are awaiting follow-through or closure.`],
              ['Risk concentration', `${highRiskStationRows.length} stations remain in high-severity anomaly review.`],
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

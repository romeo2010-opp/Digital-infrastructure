import { useMemo } from 'react'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows } from '../lib/portalUtils'

type Tone = 'good' | 'bad' | 'neutral' | 'info'

const panelClass = 'rounded-[6px] border border-border/80 bg-background p-[14px]'
const cardClass = 'rounded-[4px] bg-secondary px-3 py-2'

function toneStyles(tone: Tone) {
  if (tone === 'good') {
    return {
      color: 'var(--color-chart-2)',
      surface: 'color-mix(in srgb, var(--color-chart-2) 12%, var(--color-background))',
    }
  }
  if (tone === 'bad') {
    return {
      color: 'var(--color-destructive)',
      surface: 'color-mix(in srgb, var(--color-destructive) 12%, var(--color-background))',
    }
  }
  if (tone === 'info') {
    return {
      color: 'var(--color-chart-3)',
      surface: 'color-mix(in srgb, var(--color-chart-3) 12%, var(--color-background))',
    }
  }
  return {
    color: 'var(--color-chart-4)',
    surface: 'color-mix(in srgb, var(--color-chart-4) 14%, var(--color-background))',
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 min'
  return `${Math.round(value)} min`
}

function shortTimestamp(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getComplaintStatus(complaint: any) {
  return String(complaint?.complaintStatus || '').toUpperCase()
}

function getInspectionStatus(inspection: any) {
  return String(inspection?.inspectionStatus || '').toUpperCase()
}

function getQueueWaitMinutes(inspection: any) {
  if (Number.isFinite(Number(inspection?.avgWaitMinutes))) return Number(inspection.avgWaitMinutes)
  const queueLength = Number(inspection?.queueLength || 0)
  return queueLength * 3
}

function DashboardMetricCard({
  label,
  value,
  sublabel,
  trend,
  tone,
  progress,
}: {
  label: string
  value: string | number
  sublabel: string
  trend: string
  tone: Tone
  progress?: number
}) {
  const styles = toneStyles(tone)

  return (
    <div className={cardClass}>
      <div className="text-[11px] leading-none text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-medium leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{sublabel}</div>
      {typeof progress === 'number' ? (
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-accent">
          <div className="h-full rounded-full" style={{ width: `${clampPercent(progress)}%`, backgroundColor: styles.color }} />
        </div>
      ) : null}
      <div className="mt-2 text-[10px] font-medium leading-none" style={{ color: styles.color }}>
        {trend}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sublabel,
  trend,
  tone,
}: {
  label: string
  value: string | number
  sublabel: string
  trend: string
  tone: Tone
}) {
  const styles = toneStyles(tone)
  return (
    <div className={cardClass}>
      <div className="text-[10px] leading-none text-muted-foreground">{label}</div>
      <div className="mt-1 text-[18px] font-medium leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{sublabel}</div>
      <div className="mt-1 text-[10px] font-medium leading-none" style={{ color: styles.color }}>
        {trend}
      </div>
    </div>
  )
}

export function NationalDashboard() {
  const { data } = usePortal()

  const heatmapRows = normalizeRows(data.heatmap)
  const watchlistRows = normalizeRows(data.hoardingWatchlist?.items)
  const complaintRows = normalizeRows(data.complaints?.items)
  const inspectionRows = normalizeRows(data.inspections?.items)
  const districtRows = normalizeRows(data.districtShortages)
  const availabilityRows = normalizeRows(data.availabilityReports?.items)
  const auditRows = normalizeRows(data.auditLogs?.items)

  const stationTotal = Number(data.overview?.totalStations || heatmapRows.length || 0)
  const onlineStations = heatmapRows.filter((row: any) => !['DRY', 'OFFLINE', 'OUT_OF_STOCK'].includes(String(row.availability_status || '').toUpperCase())).length
  const outOfStockStations = heatmapRows.filter((row: any) => String(row.availability_status || '').toUpperCase() === 'DRY').length
  const lowStockStations = heatmapRows.filter((row: any) => ['LIMITED', 'LOW', 'PARTIAL'].includes(String(row.availability_status || '').toUpperCase())).length
  const criticalAlerts = watchlistRows.filter((row: any) => String(row.escalationStatus || '').toUpperCase() === 'CRITICAL').length

  const queueRows = useMemo(
    () =>
      inspectionRows
        .filter((row: any) => Number(row.queueLength || 0) > 0)
        .map((row: any) => ({
          station: row.station?.name || '-',
          district: row.station?.city || row.station?.district || '-',
          queueCount: Number(row.queueLength || 0),
          avgWait: getQueueWaitMinutes(row),
          createdAt: row.createdAt,
        }))
        .sort((a: any, b: any) => b.queueCount - a.queueCount)
        .slice(0, 5),
    [inspectionRows],
  )

  const avgQueueWait =
    queueRows.length > 0
      ? queueRows.reduce((sum: number, row: any) => sum + Number(row.avgWait || 0), 0) / queueRows.length
      : 0

  const openComplaintRows = complaintRows.filter((row: any) => !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(getComplaintStatus(row)))
  const resolvedComplaintRows = complaintRows.filter((row: any) => ['RESOLVED', 'CLOSED'].includes(getComplaintStatus(row)))
  const autoFlaggedComplaints = complaintRows.filter((row: any) => ['HOARDING', 'REFUSAL_TO_SELL'].includes(String(row.complaintType || '').toUpperCase())).length
  const compliantInspections = inspectionRows.filter((row: any) => ['PASSED', 'CLOSED'].includes(getInspectionStatus(row))).length
  const warningInspections = inspectionRows.filter((row: any) => ['OPEN', 'FOLLOW_UP', 'ESCALATED'].includes(getInspectionStatus(row))).length
  const violationInspections = inspectionRows.filter((row: any) => ['FAILED', 'ESCALATED'].includes(getInspectionStatus(row))).length

  const liveAlerts = useMemo(() => {
    const watchlistAlerts = watchlistRows
      .filter((row: any) => ['CRITICAL', 'HIGH'].includes(String(row.escalationStatus || '').toUpperCase()))
      .slice(0, 3)
      .map((row: any) => ({
        tone: String(row.escalationStatus || '').toUpperCase() === 'CRITICAL' ? 'bad' : 'neutral',
        title: row.stationName || 'Station alert',
        description: `${row.district || 'Unknown district'} • score ${row.riskScore || 0} • ${row.currentDeclaredAvailability || 'status pending'}`,
        timestamp: shortTimestamp(row.lastDeliveryLogged || row.updatedAt || row.createdAt),
      }))

    const complaintAlerts = openComplaintRows.slice(0, 1).map((row: any) => ({
      tone: 'neutral' as Tone,
      title: row.station?.name || 'Complaint escalation',
      description: `${String(row.complaintType || 'Complaint').replaceAll('_', ' ')} awaiting action`,
      timestamp: shortTimestamp(row.createdAt),
    }))

    const auditAlerts = auditRows.slice(0, 2).map((row: any) => ({
      tone: 'info' as Tone,
      title: row.action_type || 'Audit update',
      description: row.action_description || 'Recent oversight activity recorded.',
      timestamp: shortTimestamp(row.created_at),
    }))

    return [...watchlistAlerts, ...complaintAlerts, ...auditAlerts].slice(0, 5)
  }, [auditRows, openComplaintRows, watchlistRows])

  const pressureRows = districtRows
    .slice()
    .sort((a: any, b: any) => Number(b.shortage_stations || 0) - Number(a.shortage_stations || 0))
    .slice(0, 5)
    .map((row: any) => {
      const score = row.total_stations ? Math.round((Number(row.shortage_stations || 0) / Number(row.total_stations || 1)) * 100) : 0
      const tone: Tone = score > 80 ? 'bad' : score >= 50 ? 'neutral' : 'good'
      return {
        district: row.district || 'Unknown',
        score,
        status: score > 80 ? 'Critical' : score >= 50 ? 'Stressed' : 'Stable',
        tone,
      }
    })

  const fuelAvailability = useMemo(() => {
    const totalAvailabilityRows = availabilityRows.length || 1
    const petrolAvailable = availabilityRows.filter((row: any) => Boolean(row.petrolAvailable)).length
    const dieselAvailable = availabilityRows.filter((row: any) => Boolean(row.dieselAvailable)).length
    const keroseneEstimate = Math.max(0, Math.min(totalAvailabilityRows, Math.round((petrolAvailable + dieselAvailable) / 2)))

    return [
      { label: 'Petrol', value: petrolAvailable, total: totalAvailabilityRows, tone: 'good' as Tone },
      { label: 'Diesel', value: dieselAvailable, total: totalAvailabilityRows, tone: 'info' as Tone },
      { label: 'Kerosene', value: keroseneEstimate, total: totalAvailabilityRows, tone: 'neutral' as Tone },
      { label: 'Out of Stock', value: outOfStockStations, total: stationTotal || 1, tone: 'bad' as Tone },
    ]
  }, [availabilityRows, outOfStockStations, stationTotal])

  const recentActivity = auditRows.slice(0, 10).map((row: any) => {
    const type = String(row.action_type || '').toUpperCase()
    const tone: Tone =
      type.includes('FAILED') || type.includes('ESCALAT') || type.includes('SUSPEND')
        ? 'bad'
        : type.includes('REVIEW') || type.includes('ASSIGN') || type.includes('PENDING')
          ? 'neutral'
          : 'info'

    return {
      tone,
      text: row.action_description || row.action_type || 'Portal activity recorded',
      timestamp: shortTimestamp(row.created_at),
    }
  })

  const kpis = [
    {
      label: 'Total Stations',
      value: stationTotal,
      sublabel: `${heatmapRows.length} reporting records live`,
      trend: stationTotal > 0 ? 'National registry loaded' : 'Awaiting registry sync',
      tone: 'info' as Tone,
      progress: stationTotal > 0 ? (heatmapRows.length / stationTotal) * 100 : 0,
    },
    {
      label: 'Stations Online',
      value: onlineStations,
      sublabel: `${stationTotal > 0 ? Math.round((onlineStations / stationTotal) * 100) : 0}% reporting live`,
      trend: onlineStations >= outOfStockStations ? 'Healthy reporting state' : 'Watch live declarations',
      tone: 'good' as Tone,
      progress: stationTotal > 0 ? (onlineStations / stationTotal) * 100 : 0,
    },
    {
      label: 'Out of Stock',
      value: outOfStockStations,
      sublabel: 'Dry stations confirmed',
      trend: outOfStockStations > 0 ? 'Escalation pressure rising' : 'No dry stations flagged',
      tone: 'bad' as Tone,
      progress: stationTotal > 0 ? (outOfStockStations / stationTotal) * 100 : 0,
    },
    {
      label: 'Low Stock',
      value: lowStockStations,
      sublabel: 'Limited supply declarations',
      trend: lowStockStations > 0 ? 'Monitor replenishment windows' : 'No limited-stock cases',
      tone: 'neutral' as Tone,
      progress: stationTotal > 0 ? (lowStockStations / stationTotal) * 100 : 0,
    },
    {
      label: 'Avg Queue Wait',
      value: formatMinutes(avgQueueWait),
      sublabel: `${queueRows.length} queues sampled`,
      trend: avgQueueWait > 25 ? 'Queues above tolerance' : avgQueueWait > 15 ? 'Queue pressure building' : 'Queue times stable',
      tone: avgQueueWait > 25 ? 'bad' : avgQueueWait > 15 ? 'neutral' : 'good',
    },
    {
      label: 'Critical Alerts',
      value: criticalAlerts,
      sublabel: `${watchlistRows.length} risk flags in watchlist`,
      trend: criticalAlerts > 0 ? 'Immediate attention required' : 'No critical triggers',
      tone: criticalAlerts > 0 ? 'bad' : 'good',
    },
  ]

  const complianceCards = [
    {
      label: 'Inspections',
      value: inspectionRows.length,
      sublabel: 'Inspection records loaded',
      trend: 'Field activity synced',
      tone: 'info' as Tone,
    },
    {
      label: 'Compliant',
      value: compliantInspections,
      sublabel: 'Passed or closed outcomes',
      trend: inspectionRows.length ? `${Math.round((compliantInspections / inspectionRows.length) * 100)}% compliant` : 'No inspections yet',
      tone: 'good' as Tone,
    },
    {
      label: 'Warnings Issued',
      value: warningInspections,
      sublabel: 'Follow-up action required',
      trend: warningInspections > 0 ? 'Review pending outcomes' : 'No active warnings',
      tone: 'neutral' as Tone,
    },
    {
      label: 'Violations',
      value: violationInspections,
      sublabel: 'Failed or escalated checks',
      trend: violationInspections > 0 ? 'Enforcement follow-through needed' : 'No fresh violations',
      tone: violationInspections > 0 ? 'bad' : 'good',
    },
  ]

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-background px-6 py-4">
      <div className="grid gap-2 xl:grid-cols-6">
        {kpis.map((item) => (
          <DashboardMetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-2 xl:grid-cols-4">
        {complianceCards.map((item) => (
          <SummaryCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <section className={panelClass}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-medium leading-none text-foreground">Live Alerts</h3>
            <span className="text-[10px] text-muted-foreground">5 max</span>
          </div>
          <div>
            {liveAlerts.map((alert, index) => {
              const styles = toneStyles(alert.tone)
              return (
                <div key={`${alert.title}-${index}`} className={`flex items-start gap-2 py-2 ${index > 0 ? 'border-t border-border/70' : ''}`}>
                  <span className="mt-[5px] size-[6px] rounded-full" style={{ backgroundColor: styles.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold leading-4 text-foreground">{alert.title}</div>
                    <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{alert.description}</div>
                  </div>
                  <div className="shrink-0 text-[10px] leading-4 text-muted-foreground">{alert.timestamp}</div>
                </div>
              )
            })}
          </div>
        </section>

        <section className={panelClass}>
          <div className="mb-2 text-[12px] font-medium leading-none text-foreground">District Pressure Index</div>
          <div className="space-y-2">
            {pressureRows.map((row) => {
              const styles = toneStyles(row.tone)
              return (
                <div key={row.district} className="flex items-center gap-2">
                  <div className="w-[90px] truncate text-[11px] text-foreground">{row.district}</div>
                  <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-accent">
                    <div className="h-full rounded-full" style={{ width: `${clampPercent(row.score)}%`, backgroundColor: styles.color }} />
                  </div>
                  <div className="w-8 text-right text-[11px] font-medium text-foreground">{row.score}</div>
                  <span
                    className="inline-flex min-w-[54px] justify-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ color: styles.color, backgroundColor: styles.surface }}
                  >
                    {row.status}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <section className={panelClass}>
          <div className="mb-2 text-[12px] font-medium leading-none text-foreground">Top Long Queues</div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left">
              <thead>
                <tr className="border-b border-border/70">
                  <th className="pb-2 text-[11px] font-medium text-muted-foreground">Station</th>
                  <th className="pb-2 text-[11px] font-medium text-muted-foreground">District</th>
                  <th className="pb-2 text-[11px] font-medium text-muted-foreground">Queue count</th>
                  <th className="pb-2 text-[11px] font-medium text-muted-foreground">Avg Wait</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.map((row, index) => {
                  const tone: Tone = row.avgWait > 25 ? 'bad' : row.avgWait > 15 ? 'neutral' : 'good'
                  const styles = toneStyles(tone)
                  return (
                    <tr key={`${row.station}-${index}`} className={index > 0 ? 'border-t border-border/70' : ''}>
                      <td className="py-2 pr-2 text-[11px] font-medium text-foreground">{row.station}</td>
                      <td className="py-2 pr-2 text-[11px] text-muted-foreground">{row.district}</td>
                      <td className="py-2 pr-2 text-[11px] text-foreground">{row.queueCount}</td>
                      <td className="py-2 text-[11px] font-medium" style={{ color: styles.color }}>
                        {formatMinutes(row.avgWait)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${panelClass} flex flex-col gap-2`}>
          <div>
            <div className="mb-2 text-[12px] font-medium leading-none text-foreground">Fuel Availability by Type</div>
            <div className="space-y-2">
              {fuelAvailability.map((row) => {
                const styles = toneStyles(row.tone)
                const percent = row.total > 0 ? (row.value / row.total) * 100 : 0
                return (
                  <div key={row.label} className="flex items-center gap-2">
                    <div className="w-[86px] text-[11px] text-foreground">{row.label}</div>
                    <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-accent">
                      <div className="h-full rounded-full" style={{ width: `${clampPercent(percent)}%`, backgroundColor: styles.color }} />
                    </div>
                    <div className="w-10 text-right text-[11px] font-medium text-foreground">{Math.round(percent)}%</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="border-t border-border/70 pt-2">
            <div className="mb-2 text-[12px] font-medium leading-none text-foreground">Complaint Cycle Summary</div>
            <div className="grid grid-cols-2 gap-2">
              <SummaryCard label="Total" value={complaintRows.length} sublabel="All complaint records" trend="Portal intake loaded" tone="info" />
              <SummaryCard label="Open" value={openComplaintRows.length} sublabel="Awaiting closure" trend="Casework in progress" tone={openComplaintRows.length > 0 ? 'neutral' : 'good'} />
              <SummaryCard label="Auto-flagged" value={autoFlaggedComplaints} sublabel="Triggered by high-risk types" trend="Complaint intelligence watch" tone={autoFlaggedComplaints > 0 ? 'neutral' : 'good'} />
              <SummaryCard label="Resolved" value={resolvedComplaintRows.length} sublabel="Closed or resolved" trend="Resolution throughput" tone="good" />
            </div>
          </div>
        </section>
      </div>

      <section className={`${cardClass} overflow-x-auto`}>
        <div className="flex min-w-max items-center gap-4">
          {recentActivity.map((item, index) => {
            const styles = toneStyles(item.tone)
            return (
              <div key={`${item.text}-${index}`} className="flex items-center gap-2 text-[11px] text-foreground">
                <span className="size-[6px] rounded-full" style={{ backgroundColor: styles.color }} />
                <span className="max-w-[280px] truncate">{item.text}</span>
                <span className="text-[10px] text-muted-foreground">{item.timestamp}</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

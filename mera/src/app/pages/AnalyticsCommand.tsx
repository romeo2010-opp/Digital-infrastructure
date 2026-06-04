import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, RefreshCcw, Search } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeRows, renderPill } from '../lib/portalUtils'

export function AnalyticsCommand() {
  const { token, api, runAction, data, requestPackets, packetStatus, packetErrors } = usePortal()
  const [search, setSearch] = useState('')

  const packet = data.analytics || {}
  const stress = packet.stress || { byDistrict: [] }
  const districts = packet.districts || { items: [] }
  const stations = packet.stations || { items: [] }
  const trends = packet.trends || {}
  const loading = packetStatus.analytics === 'loading' && data.analytics === undefined
  const refreshing = packetStatus.analytics === 'loading'
  const error = packetErrors.analytics || ''

  const load = () => {
    if (!token) return
    requestPackets(['analytics'], { reason: 'analytics-command-refresh', force: true })
  }

  useEffect(() => {
    if (!token || data.analytics !== undefined) return
    load()
  }, [data.analytics, token])

  const districtRows = normalizeRows(districts.items)
  const stationRows = useMemo(() => normalizeRows(stations.items).filter((row: any) => matchesSearch(row, search)), [stations, search])
  const criticalStations = stationRows.filter((row: any) => Number(row.riskScore || 0) >= 91)
  const highRiskStations = stationRows.filter((row: any) => Number(row.riskScore || 0) >= 76)
  const pressureDistricts = districtRows.filter((row: any) => Number(row.fuelStressIndex || 0) >= 55)
  const stationColumns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'riskScore', label: 'Risk' },
    { key: 'riskLevel', label: 'Level', render: (row: any) => renderPill(row.riskLevel) },
    { key: 'recommendedAction', label: 'Action' },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f9fafb] p-4 text-[#111827]">
      <SectionKpiStrip
        columns={stationColumns}
        items={[
          { label: 'Fuel Stress Index', value: stress.national ?? 0, rows: districtRows, accent: '#185FA5' },
          { label: 'Pressure Districts', value: pressureDistricts.length, rows: pressureDistricts, tone: pressureDistricts.length ? 'warn' : 'good', accent: '#EF9F27' },
          { label: 'High Risk Stations', value: highRiskStations.length, rows: highRiskStations, tone: highRiskStations.length ? 'bad' : 'good', accent: '#E24B4A' },
          { label: 'Critical Stations', value: criticalStations.length, rows: criticalStations, tone: criticalStations.length ? 'bad' : 'good', accent: '#E24B4A' },
        ]}
      />

      <Toolbar>
        <ToolbarField label="Search analytics" hint="Filter station analytics by station, district, risk level, or recommended action. Example: critical or Blantyre. " className="min-w-[260px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-[#6b7280]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter station analytics..." />
        </div>
        </ToolbarField>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCcw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction(() => api.generateReport(token, { type: 'National Fuel Availability Report', filters: { section: 'analytics' } }), 'Generating analytics report...', { refresh: false })}
        >
          <Download className="size-4" />
          Report
        </Button>
      </Toolbar>

      {error ? <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="District Fuel Stress Index" subtitle="National, regional, district, and fuel-pressure trend view">
          <div className="h-[320px] px-4 py-4">
            {districtRows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={districtRows.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mera-chart-grid)" />
                  <XAxis dataKey="district" tick={{ fill: 'var(--mera-chart-axis)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--mera-chart-axis)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'var(--mera-chart-tooltip-bg)', border: '1px solid var(--mera-chart-tooltip-border)', borderRadius: 8, color: 'var(--mera-chart-tooltip-text)' }} />
                  <Bar dataKey="fuelStressIndex" fill={'#185FA5'} radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-md border border-dashed border-[#e2e8f0] bg-[#f9fafb] text-sm text-[#6b7280]">
                {loading ? 'Loading analytics...' : 'No district stress analytics available.'}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Trend Signals" subtitle="Complaint, delivery, price, and risk signals">
          <div className="grid gap-2 px-4 py-4 text-sm">
            {[
              ['Complaint trend records', normalizeRows(trends.complaintVolume).length],
              ['Delivery timeline events', normalizeRows(trends.deliveryEvents).length],
              ['Price violations', trends.priceViolationCount || 0],
              ['Station analytics rows', stationRows.length],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-3">
                <span className="flex items-center gap-2 text-[#6b7280]"><BarChart3 className="size-4 text-[#2563eb]" />{label}</span>
                <span className="font-medium text-[#111827]">{value}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="District Analytics" subtitle="Fuel stress and availability pressure by district">
          <PortalTable
            rows={districtRows}
            columns={[
              { key: 'district', label: 'District' },
              { key: 'stations', label: 'Stations' },
              { key: 'averageRiskScore', label: 'Avg Risk' },
              { key: 'fuelStressIndex', label: 'Stress Index' },
              { key: 'availabilityPressure', label: 'Pressure Stations' },
            ]}
          />
        </SectionCard>

        <SectionCard title="Station Analytics" subtitle="Station risk, stockout projection, and recommended action">
          <PortalTable rows={stationRows} columns={stationColumns} />
        </SectionCard>
      </div>
    </div>
  )
}

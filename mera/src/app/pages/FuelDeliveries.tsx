import { useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { KpiDrilldownCard, KpiDrilldownDrawer, type DrilldownConfig } from '../components/KpiDrilldown'
import { KpiSkeletonStrip, PanelSkeleton, TableSkeleton } from '../components/LiveDataSkeleton'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-[#e2e8f0] bg-white px-3 text-[12px] font-semibold text-[#374151]'
const deliveryColumns = [
  { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
  { key: 'fuelType', label: 'Fuel' },
  { key: 'estimatedVolume', label: 'Volume', render: (row: any) => row.estimatedVolume ? `${Number(row.estimatedVolume).toLocaleString()} L` : '-' },
  { key: 'deliveryTime', label: 'Time', render: (row: any) => normalizeDate(row.deliveryTime) },
  { key: 'verificationStatus', label: 'Status', render: (row: any) => renderPill(row.verificationStatus || 'PENDING_REVIEW') },
]

function sumVolume(rows: any[]) {
  return rows.reduce((sum, row) => sum + Number(row.estimatedVolume || row.estimated_volume || 0), 0)
}

export function FuelDeliveries() {
  const { data, runAction, api, token, hasPermission, liveDataLoading, actionLoading } = usePortal()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const [form, setForm] = useState({
    stationPublicId: '',
    deliveryTime: '',
    fuelType: 'PETROL',
    estimatedVolume: '',
    sourceType: 'TANKER_MANIFEST',
    reportedBy: '',
  })

  const allRows = useMemo(() => normalizeRows(data.fuelDeliveryLogs?.items), [data.fuelDeliveryLogs])
  const rows = useMemo(
    () => allRows.filter((row: any) => matchesSearch(row, search)),
    [allRows, search],
  )
  const isInitialLoading = liveDataLoading && !allRows.length
  const delayedRows = rows.filter((row: any) => /DELAY|PENDING|REVIEW/i.test(String(row.verificationStatus || '')))
  const verifiedRows = rows.filter((row: any) => /VERIFIED|MATCHED|APPROVED/i.test(String(row.verificationStatus || '')))
  const recentRows = rows.slice(0, 8)
  const canCreate = hasPermission(MERA_PERMISSIONS.DELIVERIES_CREATE)
  const canVerify = hasPermission(MERA_PERMISSIONS.DELIVERIES_VERIFY)

  const openDrilldown = (config: DrilldownConfig) => setDrilldown(config)

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f4f5f7] p-4 text-[#111827]">
      {isInitialLoading ? (
        <>
          <KpiSkeletonStrip count={4} />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.7fr_0.9fr]">
            <TableSkeleton rows={8} columns={5} />
            <PanelSkeleton />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <KpiDrilldownCard
              label="Active Deliveries"
              value={rows.length.toLocaleString()}
              delta={`${recentRows.length} recent`}
              helper="visible records"
              accent="#2563eb"
              onClick={() => openDrilldown({
                title: 'Active deliveries',
                value: rows.length.toLocaleString(),
                subtitle: 'Delivery rows currently represented by the ledger filters.',
                rows,
                columns: deliveryColumns,
              })}
            />
            <KpiDrilldownCard
              label="In Transit Volume"
              value={`${Math.round(sumVolume(rows) / 1000).toLocaleString()} kL`}
              delta={`${sumVolume(rows).toLocaleString()} L`}
              helper="estimated total"
              tone="good"
              accent="#10b981"
              onClick={() => openDrilldown({
                title: 'In transit volume',
                value: `${sumVolume(rows).toLocaleString()} L`,
                subtitle: 'Estimated litres represented by the visible delivery records.',
                note: 'Calculated by summing estimatedVolume across the current delivery rows.',
                rows,
                columns: deliveryColumns,
              })}
            />
            <KpiDrilldownCard
              label="Delayed / Pending"
              value={delayedRows.length.toLocaleString()}
              delta={`${delayedRows.length} review`}
              helper="needs verification"
              tone={delayedRows.length ? 'warn' : 'good'}
              accent="#f59e0b"
              onClick={() => openDrilldown({
                title: 'Delayed and pending deliveries',
                value: delayedRows.length.toLocaleString(),
                subtitle: 'Rows whose verification status indicates delay, pending review, or review.',
                rows: delayedRows,
                columns: deliveryColumns,
              })}
            />
            <KpiDrilldownCard
              label="Verified Deliveries"
              value={verifiedRows.length.toLocaleString()}
              delta={`${rows.length ? Math.round((verifiedRows.length / rows.length) * 100) : 0}%`}
              helper="verified share"
              tone="good"
              accent="#64748b"
              onClick={() => openDrilldown({
                title: 'Verified deliveries',
                value: verifiedRows.length.toLocaleString(),
                subtitle: 'Delivery rows with verified, matched, or approved status.',
                rows: verifiedRows,
                columns: deliveryColumns,
              })}
            />
          </div>

          <Toolbar>
            {canCreate ? (
              <Button type="button" size="sm" className="bg-[#111827] hover:bg-[#1f2937]" onClick={() => setModalOpen(true)} disabled={actionLoading}>
                <Plus className="size-4" />
                Log Delivery
              </Button>
            ) : null}
            <div className="flex min-w-[260px] flex-1 items-center gap-2">
              <Search className="size-4 text-[#9ca3af]" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by station or district..." />
            </div>
            <input type="date" className={fieldClass} />
            <select className={fieldClass}><option>All Districts</option></select>
            <Button type="button" variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </Toolbar>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.7fr_0.9fr]">
            <SectionCard title="Fuel Delivery Ledger" subtitle={`${rows.length.toLocaleString()} delivery records represented`}>
              <PortalTable
                rows={rows}
                columns={[
                  ...deliveryColumns,
                  { key: 'sourceType', label: 'Source Type' },
                  { key: 'reportedBy', label: 'Reported By' },
                  {
                    key: 'verificationAction',
                    label: 'Action',
                    render: () => canVerify ? <span className="text-[11px] font-semibold text-[#2563eb]">Verify Delivery</span> : <span className="text-[11px] text-[#9ca3af]">View</span>,
                  },
                ]}
              />
            </SectionCard>

            <SectionCard title="Delivery Irregularity Notices" subtitle="Pending review and suspicious delivery records">
              <div className="space-y-2 px-4 py-3 text-xs">
                {delayedRows.length ? (
                  delayedRows.slice(0, 8).map((item: any) => (
                    <button
                      type="button"
                      key={`${item.id}-${item.deliveryTime}`}
                      onClick={() => openDrilldown({
                        title: item.station?.name || 'Delivery detail',
                        value: item.estimatedVolume ? `${Number(item.estimatedVolume).toLocaleString()} L` : '-',
                        subtitle: 'Single delivery record represented by this notice.',
                        rows: [item],
                        columns: deliveryColumns,
                      })}
                      className="w-full rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] p-3 text-left transition hover:bg-white"
                    >
                      <div className="font-semibold text-[#111827]">{item.station?.name || '-'}</div>
                      <div className="mt-1 text-[#6b7280]">{item.fuelType} - {normalizeDate(item.deliveryTime)}</div>
                      <div className="mt-1 text-[#9ca3af]">{item.reportedBy || 'Unspecified source'}</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[6px] border border-dashed border-[#cbd5e0] bg-[#f9fafb] p-3 text-[#6b7280]">
                    No delivery irregularity notices are active.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Add Fuel Delivery Log"
        description="Create a new tanker delivery record for MERA verification."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={actionLoading}>Cancel</Button>
            <Button
              type="button"
              className="bg-[#111827] hover:bg-[#1f2937]"
              disabled={actionLoading}
              onClick={async () => {
                await runAction(() => api.createFuelDeliveryLog(token, form), 'Saving delivery...')
                setModalOpen(false)
              }}
            >
              Save Delivery
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <select className={fieldClass} value={form.stationPublicId} onChange={(event) => setForm({ ...form, stationPublicId: event.target.value })}>
            <option value="">Select station</option>
            {normalizeRows(data.profiles).map((station: any) => (
              <option key={station.public_id} value={station.public_id}>
                {station.name} {station.city ? `- ${station.city}` : ''}
              </option>
            ))}
          </select>
          <input type="datetime-local" className={fieldClass} value={form.deliveryTime} onChange={(event) => setForm({ ...form, deliveryTime: event.target.value })} />
          <Input value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value })} placeholder="Fuel type" />
          <Input value={form.estimatedVolume} onChange={(event) => setForm({ ...form, estimatedVolume: event.target.value })} placeholder="Estimated volume in litres" />
          <Input value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })} placeholder="Source type" />
          <Input value={form.reportedBy} onChange={(event) => setForm({ ...form, reportedBy: event.target.value })} placeholder="Reported by" />
        </div>
      </ModalShell>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function FuelDeliveries() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({
    stationPublicId: '',
    deliveryTime: '',
    fuelType: 'PETROL',
    estimatedVolume: '',
    sourceType: 'TANKER_MANIFEST',
    reportedBy: '',
  })

  const rows = useMemo(
    () => normalizeRows(data.fuelDeliveryLogs?.items).filter((row: any) => matchesSearch(row, search)),
    [data.fuelDeliveryLogs, search],
  )

  const irregularities = rows
    .filter((row: any) => String(row.verificationStatus || '').toUpperCase().includes('PENDING'))
    .slice(0, 6)
  const canCreate = hasPermission(MERA_PERMISSIONS.DELIVERIES_CREATE)
  const canVerify = hasPermission(MERA_PERMISSIONS.DELIVERIES_VERIFY)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canCreate ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Log Delivery
          </Button>
        ) : null}
        <div className="flex min-w-[260px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by station or district..." />
        </div>
        <input type="date" className={fieldClass} />
        <select className={fieldClass}><option>All Districts</option></select>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
        <SectionCard title="Fuel Delivery Ledger" subtitle="Reported tanker deliveries and verification status">
          <PortalTable
            rows={rows}
            columns={[
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'fuelType', label: 'Fuel Type' },
              { key: 'deliveryTime', label: 'Delivery Time', render: (row) => normalizeDate(row.deliveryTime) },
              { key: 'estimatedVolume', label: 'Estimated Volume', render: (row) => row.estimatedVolume ? `${row.estimatedVolume} L` : '-' },
              { key: 'sourceType', label: 'Source Type' },
              { key: 'reportedBy', label: 'Reported By' },
              {
                key: 'verificationStatus',
                label: 'Verification Status',
                render: (row) => (
                  <div className="flex items-center gap-2">
                    {renderPill(row.verificationStatus || 'PENDING_REVIEW')}
                    {canVerify ? <span className="text-[11px] font-medium text-blue-700">Verify Delivery</span> : null}
                  </div>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Delivery Irregularity Notices" subtitle="Pending review or suspicious delivery records">
          <div className="space-y-2 px-4 py-3 text-xs">
            {irregularities.length ? (
              irregularities.map((item: any) => (
                <div key={`${item.id}-${item.deliveryTime}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="font-medium text-slate-800">{item.station?.name || '-'}</div>
                  <div className="mt-1 text-slate-500">
                    {item.fuelType} • {normalizeDate(item.deliveryTime)}
                  </div>
                  <div className="mt-1 text-slate-500">{item.reportedBy || 'Unspecified source'}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                No delivery irregularity notices are active.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Add Fuel Delivery Log"
        description="Create a new tanker delivery record for MERA verification."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createFuelDeliveryLog(token, form))
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

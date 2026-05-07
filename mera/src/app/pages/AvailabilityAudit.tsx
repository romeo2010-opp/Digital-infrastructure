import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Plus, Search } from 'lucide-react'
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

export function AvailabilityAudit() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({
    stationPublicId: '',
    petrolAvailable: true,
    dieselAvailable: true,
    activePumps: '',
    reportedBy: '',
  })

  const rows = useMemo(() => {
    const base = normalizeRows(data.availabilityReports?.items).filter((row: any) => matchesSearch(row, search))
    return mismatchOnly ? base.filter((row: any) => row.mismatchIndicator === 'CONFLICT') : base
  }, [data.availabilityReports, mismatchOnly, search])

  const suspicious = rows
    .slice()
    .sort((a: any, b: any) => Number(b.mismatchTotal || 0) - Number(a.mismatchTotal || 0))
    .slice(0, 6)
  const canLog = hasPermission(MERA_PERMISSIONS.AVAILABILITY_LOG)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search station or record..." />
        </div>
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
          <input type="checkbox" checked={mismatchOnly} onChange={(event) => setMismatchOnly(event.target.checked)} />
          Mismatch only
        </label>
        <input type="date" className={fieldClass} />
        {canLog ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Add Declaration
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export Declarations
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.8fr_0.9fr]">
        <SectionCard title="Station Declaration Audit Ledger" subtitle="Live station availability declarations and conflict detection">
          <PortalTable
            rows={rows}
            columns={[
              { key: 'recordId', label: 'Record ID' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'district', label: 'District', render: (row) => row.station?.city || '-' },
              { key: 'petrolAvailable', label: 'Petrol', render: (row) => renderPill(row.petrolAvailable ? 'AVAILABLE' : 'DRY') },
              { key: 'dieselAvailable', label: 'Diesel', render: (row) => renderPill(row.dieselAvailable ? 'AVAILABLE' : 'DRY') },
              { key: 'activePumps', label: 'Active Pumps', render: (row) => row.activePumps ?? '-' },
              { key: 'reportedBy', label: 'Reported By' },
              { key: 'createdAt', label: 'Timestamp', render: (row) => normalizeDate(row.createdAt) },
              { key: 'complaintConflict', label: 'Complaint Conflict', render: (row) => row.mismatchIndicator === 'CONFLICT' ? <AlertTriangle className="size-4 text-amber-600" /> : 'Clear' },
              { key: 'deliveryConflict', label: 'Delivery Conflict', render: (row) => Number(row.mismatchTotal || 0) > 1 ? <AlertTriangle className="size-4 text-red-600" /> : 'Clear' },
              { key: 'mismatchIndicator', label: 'Mismatch Severity', render: (row) => renderPill(row.mismatchIndicator) },
            ]}
          />
        </SectionCard>

        <SectionCard title="Most Suspicious Declarations" subtitle="Reports with the highest complaint conflict weight">
          <div className="space-y-2 px-4 py-3 text-xs">
            {suspicious.length ? (
              suspicious.map((row: any) => (
                <div key={row.recordId} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-800">{row.station?.name}</div>
                      <div className="mt-1 text-slate-500">{row.station?.city || 'Unassigned district'}</div>
                    </div>
                    {renderPill(row.mismatchIndicator)}
                  </div>
                  <div className="mt-2 text-slate-600">
                    Complaints in conflict window: <span className="font-medium">{row.mismatchTotal || 0}</span>
                  </div>
                  <div className="mt-1 text-slate-500">{normalizeDate(row.createdAt)}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                No suspicious declarations found.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Record Availability Declaration"
        description="Write a station availability declaration into the audit ledger and live station status."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() =>
                  api.createAvailabilityReport(token, {
                    ...form,
                    activePumps: form.activePumps === '' ? null : Number(form.activePumps),
                  }),
                )
                setModalOpen(false)
              }}
            >
              Save Declaration
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
          <div className="grid gap-3 md:grid-cols-2">
            <label className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.petrolAvailable} onChange={(event) => setForm({ ...form, petrolAvailable: event.target.checked })} />
              <span className="ml-2">Petrol available</span>
            </label>
            <label className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.dieselAvailable} onChange={(event) => setForm({ ...form, dieselAvailable: event.target.checked })} />
              <span className="ml-2">Diesel available</span>
            </label>
          </div>
          <Input value={form.activePumps} onChange={(event) => setForm({ ...form, activePumps: event.target.value })} placeholder="Active pumps" />
          <Input value={form.reportedBy} onChange={(event) => setForm({ ...form, reportedBy: event.target.value })} placeholder="Reported by" />
        </div>
      </ModalShell>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Download, MapPin, Plus } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function FieldInspections() {
  const { data, runAction, api, token } = usePortal()
  const [typeFilter, setTypeFilter] = useState('')
  const [officerFilter, setOfficerFilter] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [selectedInspection, setSelectedInspection] = useState<any>(null)
  const [form, setForm] = useState({
    stationPublicId: '',
    officerPublicId: '',
    inspectionType: 'COMPLAINT_RESPONSE',
    queueLength: '',
    stockVisible: true,
    pumpsActive: '',
    displayedPrice: '',
    illegalVendingDetected: false,
    geotagLat: '',
    geotagLng: '',
    officerNotes: '',
    inspectionStatus: 'OPEN',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.inspections?.items).filter((row: any) => {
      if (typeFilter && row.inspectionType !== typeFilter) return false
      if (officerFilter && row.officer?.publicId !== officerFilter) return false
      return true
    })
  }, [data.inspections, officerFilter, typeFilter])

  const evidenceRows = rows
    .filter((row: any) => row.geotagLat || row.geotagLng)
    .slice(0, 10)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setScheduleOpen(true)}>
          <Plus className="size-4" />
          Schedule Inspection
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
          <Plus className="size-4" />
          Assign Officer
        </Button>
        <select className={fieldClass} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All Types</option>
          <option value="ROUTINE">Routine</option>
          <option value="FOLLOW_UP">Follow Up</option>
          <option value="SPOT_CHECK">Spot Check</option>
          <option value="SHORTAGE_RESPONSE">Shortage Response</option>
          <option value="COMPLAINT_RESPONSE">Complaint Response</option>
        </select>
        <select className={fieldClass} value={officerFilter} onChange={(event) => setOfficerFilter(event.target.value)}>
          <option value="">All Officers</option>
          {normalizeRows(data.users).map((user: any) => (
            <option key={user.public_id} value={user.public_id}>
              {user.full_name}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4">
        <SectionCard title="Field Inspection Log" subtitle="Inspection queue, assigned officers, and live outcomes">
          <PortalTable
            rows={rows}
            onRowClick={setSelectedInspection}
            columns={[
              { key: 'publicId', label: 'Inspection Ref' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'district', label: 'District', render: (row) => row.station?.city || '-' },
              { key: 'officer', label: 'Officer', render: (row) => row.officer?.fullName || '-' },
              { key: 'inspectionType', label: 'Inspection Type', render: (row) => renderPill(row.inspectionType) },
              { key: 'queueLength', label: 'Queue Length', render: (row) => row.queueLength ?? 0 },
              { key: 'pumpsActive', label: 'Pumps Active', render: (row) => row.pumpsActive ?? '-' },
              { key: 'illegalVendingDetected', label: 'Illegal Vending', render: (row) => renderPill(row.illegalVendingDetected ? 'YES' : 'NO') },
              { key: 'inspectionStatus', label: 'Result', render: (row) => renderPill(row.inspectionStatus) },
              { key: 'createdAt', label: 'Created At', render: (row) => normalizeDate(row.createdAt) },
              { key: 'action', label: 'Action', render: () => <span className="text-[11px] font-medium text-blue-700">Details</span> },
            ]}
          />
          {selectedInspection ? (
            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
              {selectedInspection.publicId} • {selectedInspection.officerNotes || 'No officer note recorded.'}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Uploaded Geotagged Evidence Ledger" subtitle="Inspections with location-tagged field evidence coordinates">
          <PortalTable
            rows={evidenceRows}
            columns={[
              { key: 'publicId', label: 'Evidence Ref', render: (row) => `GEO-${String(row.publicId).slice(-8)}` },
              { key: 'type', label: 'Type', render: () => 'Inspection Geo Record' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'officer', label: 'Officer', render: (row) => row.officer?.fullName || '-' },
              { key: 'createdAt', label: 'Timestamp', render: (row) => normalizeDate(row.createdAt) },
              {
                key: 'location',
                label: 'Location Verified',
                render: (row) => (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <MapPin className="size-3.5" />
                    {row.geotagLat && row.geotagLng ? `${row.geotagLat}, ${row.geotagLng}` : 'Pending'}
                  </span>
                ),
              },
              { key: 'action', label: 'Action', render: () => <span className="text-[11px] font-medium text-blue-700">View</span> },
            ]}
          />
        </SectionCard>
      </div>

      <ModalShell
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        title="Schedule Field Inspection"
        description="Create and assign a new field inspection record."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() =>
                  api.createInspection(token, {
                    ...form,
                    queueLength: form.queueLength === '' ? null : Number(form.queueLength),
                    pumpsActive: form.pumpsActive === '' ? null : Number(form.pumpsActive),
                    displayedPrice: form.displayedPrice === '' ? null : Number(form.displayedPrice),
                    geotagLat: form.geotagLat === '' ? null : Number(form.geotagLat),
                    geotagLng: form.geotagLng === '' ? null : Number(form.geotagLng),
                    officerPublicId: form.officerPublicId || null,
                  }),
                )
                setScheduleOpen(false)
              }}
            >
              Save Inspection
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
          <select className={fieldClass} value={form.officerPublicId} onChange={(event) => setForm({ ...form, officerPublicId: event.target.value })}>
            <option value="">Default to current officer</option>
            {normalizeRows(data.users).map((user: any) => (
              <option key={user.public_id} value={user.public_id}>
                {user.full_name} • {user.role_name}
              </option>
            ))}
          </select>
          <select className={fieldClass} value={form.inspectionType} onChange={(event) => setForm({ ...form, inspectionType: event.target.value })}>
            <option value="ROUTINE">Routine</option>
            <option value="FOLLOW_UP">Follow Up</option>
            <option value="SPOT_CHECK">Spot Check</option>
            <option value="SHORTAGE_RESPONSE">Shortage Response</option>
            <option value="COMPLAINT_RESPONSE">Complaint Response</option>
          </select>
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={form.queueLength} onChange={(event) => setForm({ ...form, queueLength: event.target.value })} placeholder="Queue length" />
            <Input value={form.pumpsActive} onChange={(event) => setForm({ ...form, pumpsActive: event.target.value })} placeholder="Pumps active" />
          </div>
          <Input value={form.displayedPrice} onChange={(event) => setForm({ ...form, displayedPrice: event.target.value })} placeholder="Displayed price" />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.stockVisible} onChange={(event) => setForm({ ...form, stockVisible: event.target.checked })} />
              <span className="ml-2">Stock visible</span>
            </label>
            <label className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.illegalVendingDetected} onChange={(event) => setForm({ ...form, illegalVendingDetected: event.target.checked })} />
              <span className="ml-2">Illegal vending detected</span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={form.geotagLat} onChange={(event) => setForm({ ...form, geotagLat: event.target.value })} placeholder="Latitude" />
            <Input value={form.geotagLng} onChange={(event) => setForm({ ...form, geotagLng: event.target.value })} placeholder="Longitude" />
          </div>
          <select className={fieldClass} value={form.inspectionStatus} onChange={(event) => setForm({ ...form, inspectionStatus: event.target.value })}>
            <option value="OPEN">Open</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
            <option value="ESCALATED">Escalated</option>
            <option value="CLOSED">Closed</option>
          </select>
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={form.officerNotes}
            onChange={(event) => setForm({ ...form, officerNotes: event.target.value })}
            placeholder="Officer notes..."
          />
        </div>
      </ModalShell>
    </div>
  )
}

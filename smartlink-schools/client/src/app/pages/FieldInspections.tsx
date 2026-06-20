import { useEffect, useMemo, useState } from 'react'
import { Download, MapPin, Plus } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { FieldLabel, FieldShell, ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-[#e2e8f0] bg-white px-3 text-sm text-[#111827]'

export function FieldInspections() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const navigate = useNavigate()
  const location = useLocation()
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
  const canAssign = hasPermission(MERA_PERMISSIONS.INSPECTIONS_ASSIGN)
  const canCreate = hasPermission(MERA_PERMISSIONS.INSPECTIONS_CREATE)
  const canExport = hasPermission(MERA_PERMISSIONS.REPORTS_EXPORT)
  const canCreateTask = hasPermission(MERA_PERMISSIONS.TASKS_CREATE) || hasPermission(MERA_PERMISSIONS.TASKS_ASSIGN) || hasPermission(MERA_PERMISSIONS.TASKS_MANAGE)
  const completedRows = rows.filter((row: any) => ['COMPLETED', 'PASSED', 'CLOSED'].includes(String(row.inspectionStatus || '').toUpperCase()))
  const failedRows = rows.filter((row: any) => ['FAILED', 'NON_COMPLIANT', 'ESCALATED'].includes(String(row.inspectionStatus || '').toUpperCase()) || row.illegalVendingDetected)
  const scheduledRows = rows.filter((row: any) => ['OPEN', 'SCHEDULED', 'ASSIGNED'].includes(String(row.inspectionStatus || '').toUpperCase()))
  const inspectionColumns = [
    { key: 'publicId', label: 'Inspection' },
    { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
    { key: 'officer', label: 'Officer', render: (row: any) => row.officer?.fullName || '-' },
    { key: 'inspectionStatus', label: 'Status', render: (row: any) => row.inspectionStatus || '-' },
    { key: 'createdAt', label: 'Created', render: (row: any) => normalizeDate(row.createdAt) },
  ]

  useEffect(() => {
    const stationPublicId = new URLSearchParams(location.search).get('station') || ''
    if (!stationPublicId || (!canCreate && !canAssign)) return
    setForm((current) => ({
      ...current,
      stationPublicId,
      inspectionType: current.inspectionType || 'SPOT_CHECK',
    }))
    setScheduleOpen(true)
  }, [canAssign, canCreate, location.search])

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canCreate ? (
          <Button type="button" size="sm" className="bg-accent-primary hover:bg-accent-primary" onClick={() => setScheduleOpen(true)}>
            <Plus className="size-4" />
            Schedule Inspection
          </Button>
        ) : null}
        {canAssign ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
            <Plus className="size-4" />
            Assign Officer
          </Button>
        ) : null}
        <ToolbarField label="Inspection type" hint="Filter visits by why the inspection was created. Example: complaint response or shortage response.">
        <select className={fieldClass} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All Types</option>
          <option value="ROUTINE">Routine</option>
          <option value="FOLLOW_UP">Follow Up</option>
          <option value="SPOT_CHECK">Spot Check</option>
          <option value="SHORTAGE_RESPONSE">Shortage Response</option>
          <option value="COMPLAINT_RESPONSE">Complaint Response</option>
        </select>
        </ToolbarField>
        <ToolbarField label="Officer" hint="Filter inspections by assigned MERA officer. Example: view inspections assigned to one field officer.">
        <select className={fieldClass} value={officerFilter} onChange={(event) => setOfficerFilter(event.target.value)}>
          <option value="">All Officers</option>
          {normalizeRows(data.users).map((user: any, index) => {
            const publicId = user.public_id || user.publicId || user.id || user.email || `officer-${index}`
            return (
            <option key={publicId} value={publicId}>
              {user.full_name || user.fullName || user.name || user.email || 'MERA officer'}
            </option>
            )
          })}
        </select>
        </ToolbarField>
        {canExport ? (
          <Button type="button" variant="outline" size="sm">
            <Download className="size-4" />
            Export
          </Button>
        ) : null}
      </Toolbar>

      <SectionKpiStrip
        columns={inspectionColumns}
        items={[
          { label: 'Scheduled', value: scheduledRows.length, rows: scheduledRows, accent: '#185FA5' },
          { label: 'Completed', value: completedRows.length, rows: completedRows, tone: 'good', accent: '#1D9E75' },
          { label: 'Failed / Non-compliant', value: failedRows.length, rows: failedRows, tone: failedRows.length ? 'bad' : 'good', accent: '#E24B4A' },
          { label: 'Geotagged Evidence', value: evidenceRows.length, rows: evidenceRows, tone: evidenceRows.length ? 'good' : 'neutral', accent: '#185FA5' },
        ]}
      />

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
              { key: 'task', label: 'Origin Task', render: (row) => row.task?.taskNumber ? <button type="button" className="font-medium text-[#2563eb]" onClick={(event) => { event.stopPropagation(); navigate(`/tasks/${row.task.taskNumber}`) }}>{row.task.taskNumber}</button> : '-' },
              { key: 'inspectionType', label: 'Inspection Type', render: (row) => renderPill(row.task?.type || row.inspectionType) },
              { key: 'taskStatus', label: 'Task Status', render: (row) => row.task?.status ? renderPill(row.task.status) : '-' },
              { key: 'queueLength', label: 'Queue Length', render: (row) => row.queueLength ?? 0 },
              { key: 'pumpsActive', label: 'Pumps Active', render: (row) => row.pumpsActive ?? '-' },
              { key: 'illegalVendingDetected', label: 'Illegal Vending', render: (row) => renderPill(row.illegalVendingDetected ? 'YES' : 'NO') },
              { key: 'inspectionStatus', label: 'Result', render: (row) => renderPill(row.inspectionStatus) },
              { key: 'createdAt', label: 'Created At', render: (row) => normalizeDate(row.createdAt) },
              {
                key: 'action',
                label: 'Action',
                render: (row) => (
                  <div className="flex gap-2">
                    <span className="text-[11px] font-medium text-[#2563eb]">Details</span>
                    {row.task?.taskNumber ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-[#2563eb]"
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/tasks/${row.task.taskNumber}`)
                        }}
                      >
                        Open Task
                      </button>
                    ) : canCreateTask ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-[#2563eb]"
                        onClick={(event) => {
                          event.stopPropagation()
                          const params = new URLSearchParams({
                            linkedEntityType: 'INSPECTION',
                            linkedEntityId: row.publicId,
                            stationPublicId: row.station?.publicId || '',
                            stationName: row.station?.name || '',
                            district: row.station?.city || '',
                            type: 'FIELD_VISIT',
                            title: `Follow up inspection ${row.publicId}`,
                            description: row.officerNotes || 'Follow up on field inspection findings.',
                          })
                          navigate(`/tasks/new?${params.toString()}`)
                        }}
                      >
                        Create Task
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
          {selectedInspection ? (
            <div className="border-t border-[#e2e8f0] px-4 py-3 text-xs text-[#6b7280]">
              <div className="font-medium text-[#111827]">{selectedInspection.publicId}</div>
              <div className="mt-1">{selectedInspection.task?.description || selectedInspection.officerNotes || 'No officer note recorded.'}</div>
              {selectedInspection.task ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {renderPill(selectedInspection.task.status)}
                  {renderPill(selectedInspection.task.priority)}
                  <button type="button" className="font-medium text-[#2563eb]" onClick={() => navigate(`/tasks/${selectedInspection.task.taskNumber}`)}>
                    Open originating task
                  </button>
                </div>
              ) : null}
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
                  <span className="inline-flex items-center gap-1 text-[#059669]">
                    <MapPin className="size-3.5" />
                    {row.geotagLat && row.geotagLng ? `${row.geotagLat}, ${row.geotagLng}` : 'Pending'}
                  </span>
                ),
              },
              { key: 'action', label: 'Action', render: () => <span className="text-[11px] font-medium text-[#2563eb]">View</span> },
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
              className="bg-accent-primary hover:bg-accent-primary"
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
          <FieldShell label="Station" hint="Choose the station being inspected. Example: select the outlet named in a public complaint or risk alert.">
            <select className={`${fieldClass} w-full`} value={form.stationPublicId} onChange={(event) => setForm({ ...form, stationPublicId: event.target.value })}>
              <option value="">Select station</option>
              {normalizeRows(data.profiles).map((station: any, index) => {
                const publicId = station.public_id || station.publicId || station.id || station.station_id || station.stationId || `station-${index}`
                const stationName = station.name || station.station_name || station.stationName || 'Station'
                return (
                <option key={publicId} value={publicId}>
                  {stationName} {station.city ? `- ${station.city}` : ''}
                </option>
                )
              })}
            </select>
          </FieldShell>
          {canAssign ? (
            <FieldShell label="Assigned officer" hint="Assign the field officer responsible for the inspection. Example: choose the officer covering the station district.">
              <select className={`${fieldClass} w-full`} value={form.officerPublicId} onChange={(event) => setForm({ ...form, officerPublicId: event.target.value })}>
                <option value="">Default to current officer</option>
                {normalizeRows(data.users).map((user: any, index) => {
                  const publicId = user.public_id || user.publicId || user.id || user.email || `officer-${index}`
                  return (
                  <option key={publicId} value={publicId}>
                    {user.full_name || user.fullName || user.name || user.email || 'MERA officer'} • {user.role_display_name || user.roleDisplayName || user.role_code || user.role || 'Officer'}
                  </option>
                  )
                })}
              </select>
            </FieldShell>
          ) : null}
          <FieldShell label="Inspection type" hint="Select why the visit is happening. Example: COMPLAINT_RESPONSE for a public report, SPOT_CHECK for random compliance.">
            <select className={`${fieldClass} w-full`} value={form.inspectionType} onChange={(event) => setForm({ ...form, inspectionType: event.target.value })}>
              <option value="ROUTINE">Routine</option>
              <option value="FOLLOW_UP">Follow Up</option>
              <option value="SPOT_CHECK">Spot Check</option>
              <option value="SHORTAGE_RESPONSE">Shortage Response</option>
              <option value="COMPLAINT_RESPONSE">Complaint Response</option>
            </select>
          </FieldShell>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldShell label="Queue length" hint="Enter the observed number of vehicles or people waiting. Example: 42 vehicles in the petrol queue.">
              <Input value={form.queueLength} onChange={(event) => setForm({ ...form, queueLength: event.target.value })} placeholder="Queue length" />
            </FieldShell>
            <FieldShell label="Pumps active" hint="Record how many pumps are serving customers during inspection. Example: 2 active petrol pumps, 1 diesel pump offline.">
              <Input value={form.pumpsActive} onChange={(event) => setForm({ ...form, pumpsActive: event.target.value })} placeholder="Pumps active" />
            </FieldShell>
          </div>
          <FieldShell label="Displayed price" hint="Capture the price shown at the pump or price board. Example: 2530.00 for petrol per litre.">
            <Input value={form.displayedPrice} onChange={(event) => setForm({ ...form, displayedPrice: event.target.value })} placeholder="Displayed price" />
          </FieldShell>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827]">
              <FieldLabel label="Stock visible" hint="Mark this when fuel stock, active dispensing, or credible stock evidence is visible. Example: tanker offload or active pump flow observed." />
              <input type="checkbox" checked={form.stockVisible} onChange={(event) => setForm({ ...form, stockVisible: event.target.checked })} />
              <span className="ml-2">Yes</span>
            </label>
            <label className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827]">
              <FieldLabel label="Illegal vending detected" hint="Mark this when inspectors observe unlicensed resale, side-selling, or diversion evidence. Example: jerrycan resale outside the station." />
              <input type="checkbox" checked={form.illegalVendingDetected} onChange={(event) => setForm({ ...form, illegalVendingDetected: event.target.checked })} />
              <span className="ml-2">Yes</span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldShell label="Latitude" hint="Enter the inspection latitude if GPS is available. Example: -13.9626.">
              <Input value={form.geotagLat} onChange={(event) => setForm({ ...form, geotagLat: event.target.value })} placeholder="Latitude" />
            </FieldShell>
            <FieldShell label="Longitude" hint="Enter the inspection longitude if GPS is available. Example: 33.7741.">
              <Input value={form.geotagLng} onChange={(event) => setForm({ ...form, geotagLng: event.target.value })} placeholder="Longitude" />
            </FieldShell>
          </div>
          <FieldShell label="Inspection status" hint="Set the current outcome. Example: FAILED if overpricing is confirmed, ESCALATED if legal action is needed.">
            <select className={`${fieldClass} w-full`} value={form.inspectionStatus} onChange={(event) => setForm({ ...form, inspectionStatus: event.target.value })}>
              <option value="OPEN">Open</option>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
              <option value="ESCALATED">Escalated</option>
              <option value="CLOSED">Closed</option>
            </select>
          </FieldShell>
          <FieldShell label="Officer notes" hint="Describe what was checked and what evidence was collected. Example: Pump board showed official price; no illegal vending observed.">
            <textarea
              className="min-h-28 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#111827]"
              value={form.officerNotes}
              onChange={(event) => setForm({ ...form, officerNotes: event.target.value })}
              placeholder="Officer notes..."
            />
          </FieldShell>
        </div>
      </ModalShell>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Plus, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { FieldShell, ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function LicenseRegistry() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedLicense, setSelectedLicense] = useState<any>(null)
  const [createForm, setCreateForm] = useState({
    stationPublicId: '',
    licenseNumber: '',
    issueDate: '',
    expiryDate: '',
    licenseStatus: 'ACTIVE',
    complianceConditions: '',
  })
  const [editForm, setEditForm] = useState({
    issueDate: '',
    expiryDate: '',
    licenseStatus: 'ACTIVE',
    complianceConditions: '',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.licenseRegistry?.items).filter((row: any) => {
      if (status && row.licenseStatus !== status) return false
      return matchesSearch(row, search)
    })
  }, [data.licenseRegistry, search, status])

  const alerts = normalizeRows(data.expiryAlerts).slice(0, 8)
  const canCreate = hasPermission(MERA_PERMISSIONS.LICENSES_CREATE)
  const canUpdate = hasPermission(MERA_PERMISSIONS.LICENSES_UPDATE)
  const activeRows = rows.filter((row: any) => String(row.licenseStatus || '').toUpperCase() === 'ACTIVE')
  const pendingRows = rows.filter((row: any) => String(row.licenseStatus || '').toUpperCase() === 'PENDING_RENEWAL')
  const expiredRows = rows.filter((row: any) => String(row.licenseStatus || '').toUpperCase() === 'EXPIRED')
  const restrictedRows = rows.filter((row: any) => ['REVOKED', 'SUSPENDED'].includes(String(row.licenseStatus || '').toUpperCase()))
  const licenseColumns = [
    { key: 'licenseNumber', label: 'License' },
    { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
    { key: 'district', label: 'District', render: (row: any) => row.station?.city || '-' },
    { key: 'licenseStatus', label: 'Status', render: (row: any) => row.licenseStatus || '-' },
    { key: 'expiryDate', label: 'Expiry', render: (row: any) => normalizeDate(row.expiryDate) },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <ToolbarField label="Search licences" hint="Filter licence records by licence number, station, owner, district, or status. Example: expired or station name." className="min-w-[280px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search licenses or stations..." />
        </div>
        </ToolbarField>
        <ToolbarField label="Licence status" hint="Filter by current licence standing. Example: Pending Renewal or Suspended.">
        <select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_RENEWAL">Pending Renewal</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REVOKED">Revoked</option>
          <option value="EXPIRED">Expired</option>
        </select>
        </ToolbarField>
        {canCreate ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Add License
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <SectionKpiStrip
        columns={licenseColumns}
        items={[
          { label: 'Active Licenses', value: activeRows.length, rows: activeRows, tone: 'good', accent: '#10b981' },
          { label: 'Pending Renewal', value: pendingRows.length, rows: pendingRows, tone: pendingRows.length ? 'warn' : 'neutral', accent: '#f59e0b' },
          { label: 'Expired', value: expiredRows.length, rows: expiredRows, tone: expiredRows.length ? 'bad' : 'good', accent: '#dc2626' },
          { label: 'Revoked / Suspended', value: restrictedRows.length, rows: restrictedRows, tone: restrictedRows.length ? 'bad' : 'neutral', accent: '#111827' },
        ]}
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.8fr_0.9fr]">
        <SectionCard title="Petroleum Station License Registry" subtitle="National license, renewal, and compliance register">
          <PortalTable
            rows={rows}
            columns={[
              { key: 'licenseNumber', label: 'License No' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'owner', label: 'Owner', render: (row) => row.station?.operatorName || '-' },
              { key: 'district', label: 'District', render: (row) => row.station?.city || '-' },
              { key: 'issueDate', label: 'Issue Date', render: (row) => normalizeDate(row.issueDate) },
              { key: 'expiryDate', label: 'Expiry Date', render: (row) => normalizeDate(row.expiryDate) },
              { key: 'licenseStatus', label: 'Compliance Status', render: (row) => renderPill(row.licenseStatus) },
              {
                key: 'renewalAlert',
                label: 'Renewal Alert',
                render: (row) =>
                  alerts.some((alert: any) => alert.license_number === row.licenseNumber) ? <AlertTriangle className="size-4 text-amber-600" /> : 'Clear',
              },
              {
                key: 'action',
                label: 'Action',
                render: (row) => (
                  <button
                    type="button"
                    className="text-[11px] font-medium text-blue-700"
                    onClick={() => {
                      if (!canUpdate) return
                      setSelectedLicense(row)
                      setEditForm({
                        issueDate: String(row.issueDate || '').slice(0, 10),
                        expiryDate: String(row.expiryDate || '').slice(0, 10),
                        licenseStatus: row.licenseStatus || 'ACTIVE',
                        complianceConditions: row.complianceConditions || '',
                      })
                      setEditOpen(true)
                    }}
                  >
                    {canUpdate ? 'Update License' : 'View'}
                  </button>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Renewal Alert Queue" subtitle="Licenses approaching expiry or pending renewal action">
          <div className="space-y-2 px-4 py-3 text-xs">
            {alerts.length ? (
              alerts.map((item: any) => (
                <div key={`${item.id}-${item.license_number}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="font-medium text-slate-800">{item.station_name}</div>
                  <div className="mt-1 text-slate-600">{item.license_number}</div>
                  <div className="mt-1 text-slate-500">Expiry: {normalizeDate(item.expiry_date)}</div>
                  <div className="mt-2">{renderPill(item.license_status)}</div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                No expiry alerts are active.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Attach License"
        description="Create a new fuel station license record."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.attachLicense(token, createForm))
                setModalOpen(false)
              }}
            >
              Save License
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FieldShell label="Station" hint="Choose the licensed station. Example: select the operator outlet this licence authorizes.">
            <select className={`${fieldClass} w-full`} value={createForm.stationPublicId} onChange={(event) => setCreateForm({ ...createForm, stationPublicId: event.target.value })}>
              <option value="">Select station</option>
              {normalizeRows(data.profiles).map((station: any) => (
                <option key={station.public_id} value={station.public_id}>
                  {station.name} {station.city ? `- ${station.city}` : ''}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="License number" hint="Enter the official licence reference exactly as issued. Example: MERA-FS-LIL-2026-0142.">
            <Input value={createForm.licenseNumber} onChange={(event) => setCreateForm({ ...createForm, licenseNumber: event.target.value })} placeholder="License number" />
          </FieldShell>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldShell label="Issue date" hint="Record when the licence became valid. Example: the date on the MERA approval letter.">
              <input type="date" className={`${fieldClass} w-full`} value={createForm.issueDate} onChange={(event) => setCreateForm({ ...createForm, issueDate: event.target.value })} />
            </FieldShell>
            <FieldShell label="Expiry date" hint="Record the final valid date for renewal tracking. Example: the expiry date printed on the licence certificate.">
              <input type="date" className={`${fieldClass} w-full`} value={createForm.expiryDate} onChange={(event) => setCreateForm({ ...createForm, expiryDate: event.target.value })} />
            </FieldShell>
          </div>
          <FieldShell label="License status" hint="Set the current compliance standing. Example: Active for valid licences, Suspended for restricted operation.">
            <select className={`${fieldClass} w-full`} value={createForm.licenseStatus} onChange={(event) => setCreateForm({ ...createForm, licenseStatus: event.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_RENEWAL">Pending Renewal</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REVOKED">Revoked</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </FieldShell>
          <FieldShell label="Compliance conditions" hint="Capture operating conditions or renewal requirements. Example: submit tank calibration certificate before renewal.">
            <textarea
              className="min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
              value={createForm.complianceConditions}
              onChange={(event) => setCreateForm({ ...createForm, complianceConditions: event.target.value })}
              placeholder="Compliance conditions..."
            />
          </FieldShell>
        </div>
      </ModalShell>

      <ModalShell
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit License Record"
        description={selectedLicense ? `Update license ${selectedLicense.licenseNumber}.` : 'Update a license.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                if (!selectedLicense) return
                await runAction(() => api.updateLicense(token, selectedLicense.id, editForm))
                setEditOpen(false)
              }}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {selectedLicense?.licenseNumber || 'License'}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldShell label="Issue date" hint="Update the licence start date when the source record changes. Example: corrected issue date from the signed certificate.">
              <input type="date" className={`${fieldClass} w-full`} value={editForm.issueDate} onChange={(event) => setEditForm({ ...editForm, issueDate: event.target.value })} />
            </FieldShell>
            <FieldShell label="Expiry date" hint="Update the renewal deadline used by alerts. Example: revised expiry after renewal approval.">
              <input type="date" className={`${fieldClass} w-full`} value={editForm.expiryDate} onChange={(event) => setEditForm({ ...editForm, expiryDate: event.target.value })} />
            </FieldShell>
          </div>
          <FieldShell label="License status" hint="Set the latest operating status. Example: Pending Renewal during renewal review, Revoked after final enforcement decision.">
            <select className={`${fieldClass} w-full`} value={editForm.licenseStatus} onChange={(event) => setEditForm({ ...editForm, licenseStatus: event.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_RENEWAL">Pending Renewal</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REVOKED">Revoked</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </FieldShell>
          <FieldShell label="Compliance conditions" hint="Update any binding conditions the station must satisfy. Example: resolve storage safety defect before reinstatement.">
            <textarea
              className="min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
              value={editForm.complianceConditions}
              onChange={(event) => setEditForm({ ...editForm, complianceConditions: event.target.value })}
              placeholder="Compliance conditions..."
            />
          </FieldShell>
        </div>
      </ModalShell>
    </div>
  )
}

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

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search licenses or stations..." />
        </div>
        <select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_RENEWAL">Pending Renewal</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REVOKED">Revoked</option>
          <option value="EXPIRED">Expired</option>
        </select>
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
          <select className={fieldClass} value={createForm.stationPublicId} onChange={(event) => setCreateForm({ ...createForm, stationPublicId: event.target.value })}>
            <option value="">Select station</option>
            {normalizeRows(data.profiles).map((station: any) => (
              <option key={station.public_id} value={station.public_id}>
                {station.name} {station.city ? `- ${station.city}` : ''}
              </option>
            ))}
          </select>
          <Input value={createForm.licenseNumber} onChange={(event) => setCreateForm({ ...createForm, licenseNumber: event.target.value })} placeholder="License number" />
          <div className="grid gap-3 md:grid-cols-2">
            <input type="date" className={fieldClass} value={createForm.issueDate} onChange={(event) => setCreateForm({ ...createForm, issueDate: event.target.value })} />
            <input type="date" className={fieldClass} value={createForm.expiryDate} onChange={(event) => setCreateForm({ ...createForm, expiryDate: event.target.value })} />
          </div>
          <select className={fieldClass} value={createForm.licenseStatus} onChange={(event) => setCreateForm({ ...createForm, licenseStatus: event.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_RENEWAL">Pending Renewal</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="REVOKED">Revoked</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={createForm.complianceConditions}
            onChange={(event) => setCreateForm({ ...createForm, complianceConditions: event.target.value })}
            placeholder="Compliance conditions..."
          />
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
            <input type="date" className={fieldClass} value={editForm.issueDate} onChange={(event) => setEditForm({ ...editForm, issueDate: event.target.value })} />
            <input type="date" className={fieldClass} value={editForm.expiryDate} onChange={(event) => setEditForm({ ...editForm, expiryDate: event.target.value })} />
          </div>
          <select className={fieldClass} value={editForm.licenseStatus} onChange={(event) => setEditForm({ ...editForm, licenseStatus: event.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_RENEWAL">Pending Renewal</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="REVOKED">Revoked</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={editForm.complianceConditions}
            onChange={(event) => setEditForm({ ...editForm, complianceConditions: event.target.value })}
            placeholder="Compliance conditions..."
          />
        </div>
      </ModalShell>
    </div>
  )
}

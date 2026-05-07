import { useMemo, useState } from 'react'
import { Download, Plus, Search, X } from 'lucide-react'
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

export function ComplianceFlags() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [selectedFlag, setSelectedFlag] = useState<any>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolveStatus, setResolveStatus] = useState('UNDER_REVIEW')
  const [form, setForm] = useState({
    stationPublicId: '',
    flagType: 'MANUAL_REVIEW',
    severity: 'MEDIUM',
    generatedReason: '',
    sourceReference: '',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.flags?.items).filter((row: any) => {
      if (severity && String(row.severity || '').toUpperCase() !== severity) return false
      return matchesSearch(row, search)
    })
  }, [data.flags, search, severity])
  const canCreate = hasPermission(MERA_PERMISSIONS.FLAGS_CREATE)
  const canResolve = hasPermission(MERA_PERMISSIONS.FLAGS_RESOLVE)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search flags, stations, or references..." />
        </div>
        <select className={fieldClass} value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="">All Severities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        {canCreate ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            New Flag
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard title="Compliance Flag Registry" subtitle="Generated and manual compliance alerts with resolution workflow">
          <PortalTable
            rows={rows}
            onRowClick={setSelectedFlag}
            columns={[
              { key: 'publicId', label: 'Flag ID' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'flagType', label: 'Flag Type', render: (row) => renderPill(row.flagType) },
              { key: 'severity', label: 'Severity', render: (row) => renderPill(row.severity) },
              { key: 'sourceReference', label: 'Generated Source', render: (row) => row.sourceReference || 'System intelligence' },
              { key: 'createdAt', label: 'Created At', render: (row) => normalizeDate(row.createdAt) },
              { key: 'resolvedBy', label: 'Assigned To', render: (row) => row.resolvedBy?.fullName || 'Open queue' },
              { key: 'resolvedStatus', label: 'Resolution Status', render: (row) => renderPill(row.resolvedStatus) },
              {
                key: 'action',
                label: 'Action',
                render: (row) =>
                  canResolve ? (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-blue-700"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedFlag(row)
                        setResolveStatus(row.resolvedStatus || 'UNDER_REVIEW')
                        setResolveOpen(true)
                      }}
                    >
                      Resolve
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-500">View</span>
                  ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Flag Evidence Chain"
          subtitle="Source references, reasons, timestamps, and compliance narrative"
          actions={
            selectedFlag ? (
              <button type="button" className="text-slate-500" onClick={() => setSelectedFlag(null)}>
                <X className="size-4" />
              </button>
            ) : null
          }
        >
          <div className="max-h-[calc(100vh-260px)] space-y-3 overflow-y-auto px-4 py-3 text-xs">
            {selectedFlag ? (
              <>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="font-medium text-slate-800">{selectedFlag.station?.name}</div>
                  <div className="mt-1 text-slate-500">{selectedFlag.publicId} • {selectedFlag.station?.publicId}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Flag Details</div>
                  <div className="mt-2 space-y-2 text-slate-700">
                    <div>{renderPill(selectedFlag.flagType)}</div>
                    <div>{renderPill(selectedFlag.severity)}</div>
                    <div>{renderPill(selectedFlag.resolvedStatus)}</div>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Generated Reason</div>
                  <p className="mt-2 text-slate-700">{selectedFlag.generatedReason || 'No narrative attached.'}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Evidence Chain</div>
                  <div className="mt-2 space-y-2 text-slate-600">
                    <div>Created: {normalizeDate(selectedFlag.createdAt)}</div>
                    <div>Source Reference: {selectedFlag.sourceReference || 'System-derived'}</div>
                    <div>Resolved At: {normalizeDate(selectedFlag.resolvedAt)}</div>
                    <div>Resolved By: {selectedFlag.resolvedBy?.fullName || 'Pending assignment'}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                Select a flag row to review the evidence chain.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Create Manual Compliance Flag"
        description="Submit a manual intelligence flag into the MERA compliance queue."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createFlag(token, form))
                setModalOpen(false)
              }}
            >
              Save Flag
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
          <select className={fieldClass} value={form.flagType} onChange={(event) => setForm({ ...form, flagType: event.target.value })}>
            <option value="MANUAL_REVIEW">Manual Review</option>
            <option value="POSSIBLE_HOARDING">Possible Hoarding</option>
            <option value="COMPLAINT_SURGE">Complaint Surge</option>
            <option value="REFUSAL_MISMATCH">Refusal Mismatch</option>
            <option value="REPEATED_INSPECTION_FAILURE">Inspection Failure</option>
            <option value="PROLONGED_DRY_STATUS">Prolonged Dry Status</option>
          </select>
          <select className={fieldClass} value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <Input value={form.sourceReference} onChange={(event) => setForm({ ...form, sourceReference: event.target.value })} placeholder="Source reference" />
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={form.generatedReason}
            onChange={(event) => setForm({ ...form, generatedReason: event.target.value })}
            placeholder="Generated reason or evidence summary..."
          />
        </div>
      </ModalShell>

      <ModalShell
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title="Resolve Compliance Flag"
        description={selectedFlag ? `Update the resolution status for ${selectedFlag.publicId}.` : 'Update resolution status.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setResolveOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                if (!selectedFlag) return
                await runAction(() => api.resolveFlag(token, selectedFlag.publicId, resolveStatus))
                setResolveOpen(false)
              }}
            >
              Save Resolution
            </Button>
          </>
        }
      >
        <select className={fieldClass} value={resolveStatus} onChange={(event) => setResolveStatus(event.target.value)}>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </ModalShell>
    </div>
  )
}

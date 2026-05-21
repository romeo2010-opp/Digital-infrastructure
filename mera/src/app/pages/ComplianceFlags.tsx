import { useMemo, useState } from 'react'
import { Download, Plus, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router'
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
const flagColumns = [
  { key: 'publicId', label: 'Case ID' },
  { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
  { key: 'flagType', label: 'Violation', render: (row: any) => renderPill(row.flagType) },
  { key: 'severity', label: 'Severity', render: (row: any) => renderPill(row.severity) },
  { key: 'createdAt', label: 'Opened', render: (row: any) => normalizeDate(row.createdAt) },
  { key: 'resolvedStatus', label: 'Status', render: (row: any) => renderPill(row.resolvedStatus || 'OPEN') },
]

function isOpenFlag(row: any) {
  return !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(String(row.resolvedStatus || '').toUpperCase())
}

export function ComplianceFlags() {
  const { data, runAction, api, token, hasPermission, liveDataLoading, actionLoading } = usePortal()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [selectedFlag, setSelectedFlag] = useState<any>(null)
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
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

  const allRows = useMemo(() => normalizeRows(data.flags?.items), [data.flags])
  const rows = useMemo(() => {
    return allRows.filter((row: any) => {
      if (severity && String(row.severity || '').toUpperCase() !== severity) return false
      return matchesSearch(row, search)
    })
  }, [allRows, search, severity])
  const isInitialLoading = liveDataLoading && !allRows.length
  const openRows = rows.filter(isOpenFlag)
  const reviewRows = rows.filter((row: any) => String(row.resolvedStatus || '').toUpperCase() === 'UNDER_REVIEW')
  const closedRows = rows.filter((row: any) => !isOpenFlag(row))
  const criticalRows = rows.filter((row: any) => String(row.severity || '').toUpperCase() === 'CRITICAL')
  const canCreate = hasPermission(MERA_PERMISSIONS.FLAGS_CREATE)
  const canResolve = hasPermission(MERA_PERMISSIONS.FLAGS_RESOLVE)
  const canCreateTask = hasPermission(MERA_PERMISSIONS.TASKS_CREATE) || hasPermission(MERA_PERMISSIONS.TASKS_ASSIGN) || hasPermission(MERA_PERMISSIONS.TASKS_MANAGE)

  const openTaskForFlag = (row: any) => {
    const params = new URLSearchParams({
      linkedEntityType: 'COMPLIANCE_FLAG',
      linkedEntityId: row.publicId,
      stationPublicId: row.station?.publicId || '',
      stationName: row.station?.name || '',
      district: row.station?.city || '',
      type: row.flagType === 'POSSIBLE_HOARDING' ? 'HOARDING_INVESTIGATION' : 'CASE_REVIEW',
      priority: row.severity || 'MEDIUM',
      title: `Review compliance flag ${row.publicId}`,
      description: row.generatedReason || 'Compliance flag review assignment.',
    })
    navigate(`/tasks/new?${params.toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f4f5f7] p-4 text-[#111827]">
      {isInitialLoading ? (
        <>
          <KpiSkeletonStrip count={4} />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
            <TableSkeleton rows={8} columns={6} />
            <PanelSkeleton />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <KpiDrilldownCard label="Open Cases" value={openRows.length} delta="+ live" helper="unresolved flags" tone={openRows.length ? 'bad' : 'good'} accent="#dc2626" onClick={() => setDrilldown({ title: 'Open cases', value: openRows.length, subtitle: 'Unresolved compliance flags represented by the Cases KPI.', rows: openRows, columns: flagColumns })} />
            <KpiDrilldownCard label="Under Investigation" value={reviewRows.length} delta="review" helper="active triage" tone="warn" accent="#f59e0b" onClick={() => setDrilldown({ title: 'Under investigation', value: reviewRows.length, subtitle: 'Flags currently marked under review.', rows: reviewRows, columns: flagColumns })} />
            <KpiDrilldownCard label="Closed This Month" value={closedRows.length} delta="closed" helper="resolved set" tone="good" accent="#10b981" onClick={() => setDrilldown({ title: 'Closed cases', value: closedRows.length, subtitle: 'Flags represented by the closed case count.', rows: closedRows, columns: flagColumns })} />
            <KpiDrilldownCard label="Critical Severity" value={criticalRows.length} delta="critical" helper="highest risk" tone={criticalRows.length ? 'bad' : 'neutral'} accent="#111827" onClick={() => setDrilldown({ title: 'Critical severity cases', value: criticalRows.length, subtitle: 'Flags with CRITICAL severity.', rows: criticalRows, columns: flagColumns })} />
          </div>

          <Toolbar>
            <div className="flex min-w-[280px] flex-1 items-center gap-2">
              <Search className="size-4 text-[#9ca3af]" />
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
              <Button type="button" size="sm" className="bg-[#111827] hover:bg-[#1f2937]" onClick={() => setModalOpen(true)} disabled={actionLoading}>
                <Plus className="size-4" />
                Open Case
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </Toolbar>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
            <SectionCard title="All Cases" subtitle={`${rows.length.toLocaleString()} total records`}>
              <PortalTable
                rows={rows}
                onRowClick={(row) => navigate(`/cases/flag-${row.publicId}`)}
                columns={[
                  ...flagColumns,
                  {
                    key: 'action',
                    label: 'Action',
                    render: (row) => (
                      <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                        <button type="button" className="text-[11px] font-semibold text-[#2563eb]" onClick={() => navigate(`/cases/flag-${row.publicId}`)}>
                          Details
                        </button>
                        {canResolve ? (
                          <button type="button" className="text-[11px] font-semibold text-[#2563eb]" disabled={actionLoading} onClick={() => { setSelectedFlag(row); setResolveStatus(row.resolvedStatus || 'UNDER_REVIEW'); setResolveOpen(true) }}>
                            Resolve
                          </button>
                        ) : <span className="text-[11px] text-[#9ca3af]">View</span>}
                        {canCreateTask ? (
                          <button type="button" className="text-[11px] font-semibold text-[#2563eb]" disabled={actionLoading} onClick={() => openTaskForFlag(row)}>
                            Create Task
                          </button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </SectionCard>

            <div className="grid content-start gap-4">
              <SectionCard title="Violations by Type" subtitle="Grouped from the visible case register">
                <div className="divide-y divide-[#f9fafb]">
                  {Object.entries(rows.reduce((acc: Record<string, number>, row: any) => {
                    const key = String(row.flagType || 'UNSPECIFIED')
                    acc[key] = (acc[key] || 0) + 1
                    return acc
                  }, {})).map(([label, value]) => (
                    <button key={label} type="button" onClick={() => setDrilldown({ title: label, value, rows: rows.filter((row: any) => String(row.flagType || 'UNSPECIFIED') === label), columns: flagColumns })} className="grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-3 px-4 py-3 text-left hover:bg-[#f9fafb]">
                      <span className="truncate text-[12px] font-semibold text-[#374151]">{label}</span>
                      <span className="text-right text-[13px] font-bold text-[#111827]">{value}</span>
                    </button>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Flag Evidence Chain"
                subtitle="Source references, reasons, timestamps, and compliance narrative"
                actions={selectedFlag ? <button type="button" className="text-[#6b7280]" onClick={() => setSelectedFlag(null)}><X className="size-4" /></button> : null}
              >
                <div className="max-h-[calc(100vh-360px)] space-y-3 overflow-y-auto px-4 py-3 text-xs">
                  {selectedFlag ? (
                    <>
                      <div className="rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] p-3">
                        <div className="font-semibold text-[#111827]">{selectedFlag.station?.name}</div>
                        <div className="mt-1 text-[#9ca3af]">{selectedFlag.publicId} - {selectedFlag.station?.publicId}</div>
                      </div>
                      <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Generated Reason</div>
                        <p className="mt-2 leading-5 text-[#374151]">{selectedFlag.generatedReason || 'No narrative attached.'}</p>
                      </div>
                      <div className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Evidence Chain</div>
                        <div className="mt-2 space-y-2 text-[#6b7280]">
                          <div>Created: {normalizeDate(selectedFlag.createdAt)}</div>
                          <div>Source Reference: {selectedFlag.sourceReference || 'System-derived'}</div>
                          <div>Resolved At: {normalizeDate(selectedFlag.resolvedAt)}</div>
                          <div>Resolved By: {selectedFlag.resolvedBy?.fullName || 'Pending assignment'}</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[6px] border border-dashed border-[#cbd5e0] bg-[#f9fafb] p-3 text-[#6b7280]">
                      Select a case row to review the evidence chain.
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>
          </div>
        </>
      )}

      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Create Manual Compliance Flag"
        description="Submit a manual intelligence flag into the MERA compliance queue."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={actionLoading}>Cancel</Button>
            <Button type="button" className="bg-[#111827] hover:bg-[#1f2937]" disabled={actionLoading} onClick={async () => { await runAction(() => api.createFlag(token, form), 'Saving case...'); setModalOpen(false) }}>
              Save Case
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <select className={fieldClass} value={form.stationPublicId} onChange={(event) => setForm({ ...form, stationPublicId: event.target.value })}>
            <option value="">Select station</option>
            {normalizeRows(data.profiles).map((station: any) => (
              <option key={station.public_id} value={station.public_id}>{station.name} {station.city ? `- ${station.city}` : ''}</option>
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
          <textarea className="min-h-28 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#374151]" value={form.generatedReason} onChange={(event) => setForm({ ...form, generatedReason: event.target.value })} placeholder="Generated reason or evidence summary..." />
        </div>
      </ModalShell>

      <ModalShell
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title="Resolve Compliance Flag"
        description={selectedFlag ? `Update the resolution status for ${selectedFlag.publicId}.` : 'Update resolution status.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setResolveOpen(false)} disabled={actionLoading}>Cancel</Button>
            <Button type="button" className="bg-[#111827] hover:bg-[#1f2937]" disabled={actionLoading} onClick={async () => { if (!selectedFlag) return; await runAction(() => api.resolveFlag(token, selectedFlag.publicId, resolveStatus), 'Saving resolution...'); setResolveOpen(false) }}>
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

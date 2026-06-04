import { useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
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

export function EnforcementActions() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [actionType, setActionType] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<any>(null)
  const [form, setForm] = useState({
    stationPublicId: '',
    relatedFlagPublicId: '',
    actionType: 'WARNING',
    actionNotes: '',
    actionStatus: 'OPEN',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.enforcementActions?.items).filter((row: any) => {
      if (actionType && row.actionType !== actionType) return false
      return matchesSearch(row, search)
    })
  }, [actionType, data.enforcementActions, search])
  const relatedFlagOptions = useMemo(() => {
    const flags = normalizeRows(data.flags?.items)
    if (!form.stationPublicId) return flags
    return flags.filter((flag: any) => String(flag.station?.publicId || flag.station_public_id || '') === form.stationPublicId)
  }, [data.flags, form.stationPublicId])
  const stationFailureFlags = useMemo(() => {
    const targetStation = form.stationPublicId || selectedAction?.station?.publicId || ''
    return normalizeRows(data.flags?.items)
      .filter((flag: any) => String(flag.station?.publicId || flag.station_public_id || '') === targetStation)
      .filter((flag: any) => !['RESOLVED', 'DISMISSED'].includes(String(flag.resolvedStatus || flag.resolved_status || '').toUpperCase()))
      .slice(0, 5)
  }, [data.flags, form.stationPublicId, selectedAction])

  const pendingSuspensions = rows
    .filter((row: any) => row.actionType === 'SUSPENSION' || row.actionStatus === 'ESCALATED')
    .slice(0, 6)
  const canCreateWarning = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING)
  const canCreateFine = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_FINE)
  const canCreateSuspension = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_SUSPENSION)
  const canApprove = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_APPROVE)
  const openRows = rows.filter((row: any) => !['COMPLIED', 'CLOSED'].includes(String(row.actionStatus || '').toUpperCase()))
  const escalatedRows = rows.filter((row: any) => String(row.actionStatus || '').toUpperCase() === 'ESCALATED')
  const suspensionRows = rows.filter((row: any) => String(row.actionType || '').toUpperCase() === 'SUSPENSION')
  const fineWarningRows = rows.filter((row: any) => ['FINE', 'WARNING'].includes(String(row.actionType || '').toUpperCase()))
  const enforcementColumns = [
    { key: 'publicId', label: 'Action' },
    { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
    { key: 'actionType', label: 'Type', render: (row: any) => row.actionType || '-' },
    { key: 'actionStatus', label: 'Status', render: (row: any) => row.actionStatus || '-' },
    { key: 'issuedAt', label: 'Issued', render: (row: any) => normalizeDate(row.issuedAt) },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canCreateWarning || canCreateFine || canCreateSuspension ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Issue Action
          </Button>
        ) : null}
        <ToolbarField label="Search actions" hint="Filter enforcement actions by action ID, station, flag reference, officer, or notes. Example: suspension or a station name." className="min-w-[280px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actions, stations, or flags..." />
        </div>
        </ToolbarField>
        <ToolbarField label="Action type" hint="Filter legal interventions by enforcement type. Example: fine, warning, suspension, or closure notice.">
        <select className={fieldClass} value={actionType} onChange={(event) => setActionType(event.target.value)}>
          <option value="">All Types</option>
          <option value="WARNING">Warning</option>
          <option value="FINE">Fine</option>
          <option value="SUSPENSION">Suspension</option>
          <option value="CLOSURE_NOTICE">Closure Notice</option>
          <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option>
        </select>
        </ToolbarField>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <SectionKpiStrip
        columns={enforcementColumns}
        items={[
          { label: 'Open Actions', value: openRows.length, rows: openRows, tone: openRows.length ? 'warn' : 'good', accent: '#f59e0b' },
          { label: 'Escalated', value: escalatedRows.length, rows: escalatedRows, tone: escalatedRows.length ? 'bad' : 'good', accent: '#dc2626' },
          { label: 'Suspensions', value: suspensionRows.length, rows: suspensionRows, tone: suspensionRows.length ? 'bad' : 'neutral', accent: '#111827' },
          { label: 'Fines / Warnings', value: fineWarningRows.length, rows: fineWarningRows, accent: '#2563eb' },
        ]}
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.8fr_0.9fr]">
        <SectionCard title="Enforcement Action Registry" subtitle="Issued legal actions, deadlines, statuses, and references">
          <PortalTable
            rows={rows}
            columns={[
              { key: 'publicId', label: 'Action Ref' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'legalBasis', label: 'Legal Basis', render: (row) => row.relatedFlagPublicId ? `Related flag ${row.relatedFlagPublicId}` : 'Regulatory directive' },
              { key: 'actionType', label: 'Action Type', render: (row) => renderPill(row.actionType) },
              { key: 'actor', label: 'Issued By', render: (row) => row.actor?.fullName || '-' },
              { key: 'issuedAt', label: 'Issue Date', render: (row) => normalizeDate(row.issuedAt) },
              { key: 'deadline', label: 'Compliance Deadline', render: (row) => normalizeDate(row.resolvedAt || row.issuedAt) },
              { key: 'actionStatus', label: 'Current Status', render: (row) => renderPill(row.actionStatus) },
              {
                key: 'action',
                label: 'Action',
                render: (row) => (
                  <button type="button" className="text-[11px] font-semibold text-[#111827] underline underline-offset-4" onClick={() => setSelectedAction(row)}>
                    View
                  </button>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Pending Suspensions Summary" subtitle="Cases moving toward suspension or escalated legal review">
          <div className="space-y-2 px-4 py-3 text-xs">
            {pendingSuspensions.length ? (
              pendingSuspensions.map((row: any) => (
                <div key={row.publicId} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="font-medium text-slate-800">{row.station?.name || '-'}</div>
                  <div className="mt-1 text-slate-500">{row.station?.city || 'No district'}</div>
                  <div className="mt-2">{renderPill(row.actionType)}</div>
                  <div className="mt-2 text-slate-600">Officer: {row.actor?.fullName || 'Unknown'}</div>
                  {canApprove && row.actionType === 'SUSPENSION' ? (
                    <button type="button" className="mt-3 text-[11px] font-semibold text-blue-700">
                      Approve Suspension
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                No pending suspension summaries at this time.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Issue Enforcement Action"
        description="Create a legal or compliance action against a regulated station."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createEnforcementAction(token, form))
                setModalOpen(false)
              }}
            >
              Save Action
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FieldShell label="Station" hint="Select the regulated station the action applies to. Example: choose the station linked to a verified overpricing flag.">
            <select className={`${fieldClass} w-full`} value={form.stationPublicId} onChange={(event) => setForm({ ...form, stationPublicId: event.target.value })}>
              <option value="">Select station</option>
              {normalizeRows(data.profiles).map((station: any) => (
                <option key={station.public_id} value={station.public_id}>
                  {station.name} {station.city ? `- ${station.city}` : ''}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Related flag" hint="Link the compliance flag that supports this action. Example: attach a HIGH severity overpricing or hoarding flag.">
            <select className={`${fieldClass} w-full`} value={form.relatedFlagPublicId} onChange={(event) => setForm({ ...form, relatedFlagPublicId: event.target.value })}>
              <option value="">No related flag</option>
              {relatedFlagOptions.map((flag: any) => (
                <option key={flag.publicId} value={flag.publicId}>
                  {flag.publicId} - {flag.station?.name || 'Station'} - {flag.flagType || 'Flag'} - {flag.severity || 'MEDIUM'}
                </option>
              ))}
            </select>
          </FieldShell>
          {stationFailureFlags.length ? (
            <div className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] p-3">
              <div className="text-[12px] font-semibold text-[#111827]">Compliance failures for this station</div>
              <div className="mt-2 grid gap-2">
                {stationFailureFlags.map((flag: any) => (
                  <button
                    key={flag.publicId}
                    type="button"
                    onClick={() => setForm({ ...form, relatedFlagPublicId: flag.publicId })}
                    className={`rounded-[6px] border px-3 py-2 text-left text-[12px] transition ${form.relatedFlagPublicId === flag.publicId ? 'border-[#111827] bg-white' : 'border-[#e5e7eb] bg-white hover:border-[#111827]'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#111827]">{flag.flagType || 'Compliance flag'}</span>
                      {renderPill(flag.severity || 'MEDIUM')}
                      <span className="text-[#6b7280]">{flag.publicId}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[#6b7280]">{flag.generatedReason || flag.sourceReference || 'No evidence summary captured.'}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <FieldShell label="Action type" hint="Choose the enforcement tool being issued. Example: Warning for first breach, Fine for verified offence, Suspension for severe non-compliance.">
            <select className={`${fieldClass} w-full`} value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })}>
              {canCreateWarning ? <option value="WARNING">Warning</option> : null}
              {canCreateFine ? <option value="FINE">Fine</option> : null}
              {canCreateSuspension ? <option value="SUSPENSION">Suspension</option> : null}
              {canCreateWarning ? <option value="CLOSURE_NOTICE">Closure Notice</option> : null}
              {canCreateWarning ? <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option> : null}
            </select>
          </FieldShell>
          <FieldShell label="Action status" hint="Set the current lifecycle state. Example: Open when issued, Escalated when legal review is needed, Closed after compliance.">
            <select className={`${fieldClass} w-full`} value={form.actionStatus} onChange={(event) => setForm({ ...form, actionStatus: event.target.value })}>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLIED">Complied</option>
              <option value="ESCALATED">Escalated</option>
              <option value="CLOSED">Closed</option>
            </select>
          </FieldShell>
          <FieldShell label="Action notes" hint="Record the legal basis, facts, and required remedy. Example: Pump board exceeded official diesel price by MWK 120/litre on inspection.">
            <textarea
              className="min-h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
              value={form.actionNotes}
              onChange={(event) => setForm({ ...form, actionNotes: event.target.value })}
              placeholder="Legal basis, issue notes, or enforcement narrative..."
            />
          </FieldShell>
        </div>
      </ModalShell>
      <ModalShell
        open={Boolean(selectedAction)}
        onOpenChange={(open) => !open && setSelectedAction(null)}
        title={selectedAction?.publicId || 'Enforcement action'}
        description={selectedAction?.station?.name ? `${selectedAction.station.name}${selectedAction.station.city ? ` - ${selectedAction.station.city}` : ''}` : 'Action detail'}
        footer={<Button type="button" variant="outline" onClick={() => setSelectedAction(null)}>Close</Button>}
      >
        {selectedAction ? (
          <div className="grid gap-4 text-[13px]">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Type', selectedAction.actionType],
                ['Status', selectedAction.actionStatus],
                ['Issued', normalizeDate(selectedAction.issuedAt)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[8px] border border-[#e5e7eb] bg-white p-3">
                  <div className="text-[11px] font-semibold text-[#6b7280]">{label}</div>
                  <div className="mt-1 font-semibold text-[#111827]">{value || '-'}</div>
                </div>
              ))}
            </div>
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
              <div className="text-[12px] font-semibold text-[#111827]">Action notes</div>
              <p className="mt-2 whitespace-pre-wrap text-[#4b5563]">{selectedAction.actionNotes || 'No notes captured.'}</p>
            </div>
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
              <div className="text-[12px] font-semibold text-[#111827]">Related compliance flag</div>
              {selectedAction.relatedFlag ? (
                <div className="mt-2 grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#111827]">{selectedAction.relatedFlag.publicId}</span>
                    {renderPill(selectedAction.relatedFlag.flagType)}
                    {renderPill(selectedAction.relatedFlag.severity)}
                  </div>
                  <p className="text-[#4b5563]">{selectedAction.relatedFlag.generatedReason || selectedAction.relatedFlag.sourceReference || 'No evidence summary captured.'}</p>
                </div>
              ) : (
                <div className="mt-2 text-[#6b7280]">No related flag linked to this action.</div>
              )}
            </div>
          </div>
        ) : null}
      </ModalShell>
    </div>
  )
}

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

export function EnforcementActions() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [actionType, setActionType] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
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

  const pendingSuspensions = rows
    .filter((row: any) => row.actionType === 'SUSPENSION' || row.actionStatus === 'ESCALATED')
    .slice(0, 6)
  const canCreateWarning = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING)
  const canCreateFine = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_FINE)
  const canCreateSuspension = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_SUSPENSION)
  const canApprove = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_APPROVE)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canCreateWarning || canCreateFine || canCreateSuspension ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Issue Action
          </Button>
        ) : null}
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actions, stations, or flags..." />
        </div>
        <select className={fieldClass} value={actionType} onChange={(event) => setActionType(event.target.value)}>
          <option value="">All Types</option>
          <option value="WARNING">Warning</option>
          <option value="FINE">Fine</option>
          <option value="SUSPENSION">Suspension</option>
          <option value="CLOSURE_NOTICE">Closure Notice</option>
          <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option>
        </select>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

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
              { key: 'action', label: 'Action', render: () => <span className="text-[11px] font-medium text-blue-700">View</span> },
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
          <select className={fieldClass} value={form.stationPublicId} onChange={(event) => setForm({ ...form, stationPublicId: event.target.value })}>
            <option value="">Select station</option>
            {normalizeRows(data.profiles).map((station: any) => (
              <option key={station.public_id} value={station.public_id}>
                {station.name} {station.city ? `- ${station.city}` : ''}
              </option>
            ))}
          </select>
          <select className={fieldClass} value={form.relatedFlagPublicId} onChange={(event) => setForm({ ...form, relatedFlagPublicId: event.target.value })}>
            <option value="">No related flag</option>
            {normalizeRows(data.flags?.items).map((flag: any) => (
              <option key={flag.publicId} value={flag.publicId}>
                {flag.publicId} • {flag.station?.name}
              </option>
            ))}
          </select>
          <select className={fieldClass} value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })}>
            {canCreateWarning ? <option value="WARNING">Warning</option> : null}
            {canCreateFine ? <option value="FINE">Fine</option> : null}
            {canCreateSuspension ? <option value="SUSPENSION">Suspension</option> : null}
            {canCreateWarning ? <option value="CLOSURE_NOTICE">Closure Notice</option> : null}
            {canCreateWarning ? <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option> : null}
          </select>
          <select className={fieldClass} value={form.actionStatus} onChange={(event) => setForm({ ...form, actionStatus: event.target.value })}>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLIED">Complied</option>
            <option value="ESCALATED">Escalated</option>
            <option value="CLOSED">Closed</option>
          </select>
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={form.actionNotes}
            onChange={(event) => setForm({ ...form, actionNotes: event.target.value })}
            placeholder="Legal basis, issue notes, or enforcement narrative..."
          />
        </div>
      </ModalShell>
    </div>
  )
}

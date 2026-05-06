import { useMemo, useState } from 'react'
import { Download, Eye, Gavel, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { ModalShell } from '../components/ModalShell'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function HoardingWatchlist() {
  const { data, runAction, api, token, getHoardingWatchlistDetail } = usePortal()
  const [search, setSearch] = useState('')
  const [selectedRow, setSelectedRow] = useState<any>(null)
  const [selectedDetail, setSelectedDetail] = useState<any>(null)
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [enforcementForm, setEnforcementForm] = useState({
    stationPublicId: '',
    relatedFlagPublicId: '',
    actionType: 'WARNING',
    actionNotes: '',
    actionStatus: 'OPEN',
  })

  const rows = useMemo(
    () => normalizeRows(data.hoardingWatchlist?.items).filter((row: any) => matchesSearch(row, search)),
    [data.hoardingWatchlist, search],
  )

  const selectRow = async (row: any) => {
    setSelectedRow(row)
    setEnforcementForm((current) => ({
      ...current,
      stationPublicId: row.stationPublicId,
      relatedFlagPublicId: row.latestFlagPublicId || '',
    }))
    const detail = await getHoardingWatchlistDetail(row.stationPublicId)
    setSelectedDetail(detail)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search station or district..." />
        </div>
        <select className={fieldClass}>
          <option>All Districts</option>
        </select>
        <select className={fieldClass}>
          <option>All Risk Bands</option>
          <option>Low</option>
          <option>Moderate</option>
          <option>High</option>
          <option>Critical</option>
        </select>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export Watchlist
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
        <SectionCard
          title="Hoarding Watchlist"
          subtitle="Professional searchable surveillance table"
          className="flex min-h-0 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <PortalTable
              rows={rows}
              onRowClick={selectRow}
              columns={[
                { key: 'stationName', label: 'Station Name' },
                { key: 'district', label: 'District' },
                { key: 'lastDeliveryLogged', label: 'Last Delivery Logged', render: (row) => normalizeDate(row.lastDeliveryLogged) },
                { key: 'currentDeclaredAvailability', label: 'Current Declared Availability', render: (row) => renderPill(row.currentDeclaredAvailability) },
                { key: 'complaints24h', label: 'Complaints (24h)' },
                { key: 'inspectionFailures', label: 'Inspection Failures' },
                { key: 'riskScore', label: 'Risk Score' },
                { key: 'escalationStatus', label: 'Escalation Status', render: (row) => renderPill(row.escalationStatus) },
                { key: 'action', label: 'Action', render: () => <Eye className="size-4 text-blue-700" /> },
              ]}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Case Detail Panel"
          subtitle="Complaint history, delivery timeline, declarations, inspections, and enforcement"
          actions={
            selectedRow ? (
              <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setActionModalOpen(true)}>
                <Gavel className="size-4" />
                New Action
              </Button>
            ) : null
          }
        >
          <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto px-4 py-3 text-xs">
            {selectedDetail ? (
              <>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <h4 className="font-semibold text-slate-900">{selectedDetail.station?.name}</h4>
                  <p className="mt-1 text-slate-500">
                    {selectedDetail.station?.district} • Score {selectedDetail.riskScore} • {selectedDetail.escalationStatus}
                  </p>
                </div>

                {[
                  ['Complaint History', normalizeRows(selectedDetail.complaintHistory).map((item: any) => `${item.ref} • ${item.type} • ${normalizeDate(item.createdAt)}`)],
                  ['Delivery Timeline', normalizeRows(selectedDetail.deliveryTimeline).map((item: any) => `${item.ref} • ${item.fuelType} • ${normalizeDate(item.deliveryTime)}`)],
                  ['Availability Declaration Timeline', normalizeRows(selectedDetail.availabilityTimeline).map((item: any) => `${item.ref} • Pumps ${item.activePumps ?? '-'} • ${normalizeDate(item.createdAt)}`)],
                  ['Officer Inspections', normalizeRows(selectedDetail.officerInspections).map((item: any) => `${item.ref} • ${item.result} • ${item.officerName}`)],
                  ['Generated Reasons For Suspicion', normalizeRows(selectedDetail.generatedReasons).map((item: any) => `${item.rule}: ${item.evidence}`)],
                  ['Enforcement Actions Taken', normalizeRows(selectedDetail.enforcementActions).map((item: any) => `${item.ref} • ${item.actionType} • ${item.actionStatus}`)],
                ].map(([title, items]: any) => (
                  <div key={title}>
                    <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</h5>
                    <div className="space-y-2">
                      {items.length ? (
                        items.map((item: string) => (
                          <div key={item} className="rounded-md border border-slate-200 bg-white p-2 text-slate-700">
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-dashed border-slate-200 bg-white p-2 text-slate-500">
                          No records available.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-slate-500">
                Select a watchlist row to load the regulatory detail panel.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        title="Create Enforcement Action"
        description="Open a legal or compliance action against the selected station."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setActionModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createEnforcementAction(token, enforcementForm))
                setActionModalOpen(false)
              }}
            >
              Save Action
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input value={enforcementForm.stationPublicId} onChange={(event) => setEnforcementForm({ ...enforcementForm, stationPublicId: event.target.value })} placeholder="Station Public ID" />
          <Input value={enforcementForm.relatedFlagPublicId} onChange={(event) => setEnforcementForm({ ...enforcementForm, relatedFlagPublicId: event.target.value })} placeholder="Related Flag Public ID" />
          <select className={fieldClass} value={enforcementForm.actionType} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionType: event.target.value })}>
            <option value="WARNING">Warning</option>
            <option value="FINE">Fine</option>
            <option value="SUSPENSION">Suspension</option>
            <option value="CLOSURE_NOTICE">Closure Notice</option>
            <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option>
          </select>
          <select className={fieldClass} value={enforcementForm.actionStatus} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionStatus: event.target.value })}>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLIED">Complied</option>
            <option value="ESCALATED">Escalated</option>
            <option value="CLOSED">Closed</option>
          </select>
          <textarea className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700" value={enforcementForm.actionNotes} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionNotes: event.target.value })} placeholder="Legal basis, direction issued, or enforcement note..." />
        </div>
      </ModalShell>
    </div>
  )
}

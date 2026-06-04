import { useEffect, useMemo, useState } from 'react'
import { Bell, Download, Eye, Gavel, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { ModalShell } from '../components/ModalShell'
import { FieldShell, ToolbarField } from '../components/FieldLabel'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-[#e2e8f0] bg-white px-3 text-sm text-[#111827]'

export function HoardingWatchlist() {
  const { data, runAction, api, token, getHoardingWatchlistDetail, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [selectedRow, setSelectedRow] = useState<any>(null)
  const [selectedDetail, setSelectedDetail] = useState<any>(null)
  const [riskPayload, setRiskPayload] = useState<any>({ items: [] })
  const [alertPayload, setAlertPayload] = useState<any>({ items: [] })
  const [intelligenceError, setIntelligenceError] = useState('')
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [enforcementForm, setEnforcementForm] = useState({
    stationPublicId: '',
    relatedFlagPublicId: '',
    actionType: 'WARNING',
    actionNotes: '',
    actionStatus: 'OPEN',
  })

  const loadIntelligence = () => {
    if (!token) return
    Promise.all([api.getRiskWatchlist(token, { limit: 100 }), api.listAlerts(token, { limit: 30 })])
      .then(([risk, alerts]) => {
        setRiskPayload(risk || { items: [] })
        setAlertPayload(alerts || { items: [] })
        setIntelligenceError('')
      })
      .catch((error: any) => setIntelligenceError(error?.message || 'Risk intelligence endpoints are unavailable.'))
  }

  useEffect(loadIntelligence, [token])

  const rows = useMemo(
    () => {
      const riskRows = normalizeRows(riskPayload?.items)
      const sourceRows = riskRows.length ? riskRows : normalizeRows(data.hoardingWatchlist?.items)
      return sourceRows.filter((row: any) => matchesSearch(row, search))
    },
    [data.hoardingWatchlist, riskPayload, search],
  )
  const canCreateWarning = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_WARNING)
  const canCreateFine = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_FINE)
  const canCreateSuspension = hasPermission(MERA_PERMISSIONS.ENFORCEMENT_CREATE_SUSPENSION)
  const alertRows = normalizeRows(alertPayload.items)
  const highRiskRows = rows.filter((row: any) => Number(row.riskScore || 0) >= 76 || String(row.escalationStatus || row.riskLevel || '').toUpperCase() === 'HIGH')
  const criticalRiskRows = rows.filter((row: any) => Number(row.riskScore || 0) >= 91 || String(row.escalationStatus || row.riskLevel || '').toUpperCase().includes('CRITICAL'))
  const complaint24hRows = rows.filter((row: any) => Number(row.complaints24h || row.complaints_24h || 0) > 0)
  const openEnforcementRows = alertRows.filter((row: any) => !['dismissed', 'converted_to_case'].includes(String(row.status || '').toLowerCase()))
  const watchlistColumns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'riskScore', label: 'Risk Score' },
    { key: 'riskLevel', label: 'Risk Level', render: (row: any) => row.riskLevel || row.escalationStatus || '-' },
    { key: 'recommendedAction', label: 'Action', render: (row: any) => row.recommendedAction || '-' },
  ]

  const selectRow = async (row: any) => {
    const stationPublicId = row.stationPublicId || row.station_public_id || row.publicId || row.public_id || row.stationId || row.station_id || ''
    setSelectedRow(row)
    setEnforcementForm((current) => ({
      ...current,
      stationPublicId,
      relatedFlagPublicId: row.latestFlagPublicId || '',
    }))
    if (stationPublicId && row.mainReasons) {
      setSelectedDetail({
        station: { name: row.stationName, district: row.district },
        riskScore: row.riskScore,
        escalationStatus: row.riskLevel,
        generatedReasons: (row.mainReasons || []).map((reason: string) => ({ rule: 'Risk engine', evidence: reason })),
        deliveryTimeline: normalizeRows(row.evidence).filter((item: any) => String(item.type || '').includes('delivery')),
        complaintHistory: normalizeRows(row.evidence).filter((item: any) => String(item.type || '').includes('complaint')),
        officerInspections: [],
        enforcementActions: [],
      })
      return
    }
    const detail = await getHoardingWatchlistDetail(stationPublicId)
    setSelectedDetail(detail)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <ToolbarField label="Search watchlist" hint="Filter risk rows by station, district, marker status, risk reason, or recommended action. Example: critical or Lilongwe. " className="min-w-[280px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-[#6b7280]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search station or district..." />
        </div>
        </ToolbarField>
        <ToolbarField label="District" hint="Limit the watchlist to a district. Example: All Districts for national risk review.">
        <select className={fieldClass}>
          <option>All Districts</option>
        </select>
        </ToolbarField>
        <ToolbarField label="Risk band" hint="Limit rows by risk severity. Example: Critical for urgent hoarding investigation.">
        <select className={fieldClass}>
          <option>All Risk Bands</option>
          <option>Low</option>
          <option>Moderate</option>
          <option>High</option>
          <option>Critical</option>
        </select>
        </ToolbarField>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction(() => api.generateReport(token, { type: 'Hoarding Suspicion Report', filters: { search } }), 'Generating watchlist report...', { refresh: false })}
        >
          <Download className="size-4" />
          Export Watchlist
        </Button>
      </Toolbar>

      {intelligenceError ? <div className="rounded-md border border-[#e2e8f0] bg-[#fffbeb] px-3 py-2 text-sm text-[#d97706]">{intelligenceError}</div> : null}

      <SectionKpiStrip
        columns={watchlistColumns}
        items={[
          { label: 'High Risk', value: highRiskRows.length, rows: highRiskRows, tone: highRiskRows.length ? 'warn' : 'neutral', accent: '#EF9F27' },
          { label: 'Critical Risk', value: criticalRiskRows.length, rows: criticalRiskRows, tone: criticalRiskRows.length ? 'bad' : 'good', accent: '#E24B4A' },
          { label: '24h Complaints', value: complaint24hRows.length, rows: complaint24hRows, tone: complaint24hRows.length ? 'warn' : 'neutral', accent: '#185FA5' },
          { label: 'Open Enforcement', value: openEnforcementRows.length, rows: openEnforcementRows, tone: openEnforcementRows.length ? 'warn' : 'good', accent: '#185FA5' },
        ]}
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
        <SectionCard
          title="Risk Watchlist"
          subtitle="Risk-engine surveillance table for hoarding, queue manipulation, price, delivery, and offline behaviour"
          className="flex min-h-0 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <PortalTable
              rows={rows}
              onRowClick={selectRow}
              columns={[
                { key: 'stationName', label: 'Station Name' },
                { key: 'district', label: 'District' },
                { key: 'markerStatus', label: 'Marker Status', render: (row) => renderPill(row.markerStatus || row.currentDeclaredAvailability) },
                { key: 'petrolStatus', label: 'Petrol', render: (row) => renderPill(row.petrolStatus || row.petrol_status) },
                { key: 'dieselStatus', label: 'Diesel', render: (row) => renderPill(row.dieselStatus || row.diesel_status) },
                { key: 'riskScore', label: 'Risk Score' },
                { key: 'riskLevel', label: 'Risk Level', render: (row) => renderPill(row.riskLevel || row.escalationStatus) },
                { key: 'action', label: 'Action', render: () => <Eye className="size-4 text-[#2563eb]" /> },
              ]}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Alert & Case Detail Panel"
          subtitle="Risk evidence, complaint history, delivery timeline, declarations, inspections, and enforcement"
          actions={
            selectedRow && (canCreateWarning || canCreateFine || canCreateSuspension) ? (
              <Button type="button" size="sm" className="bg-[#111827] hover:bg-accent-primary" onClick={() => setActionModalOpen(true)}>
                <Gavel className="size-4" />
                New Action
              </Button>
            ) : null
          }
        >
          <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto px-4 py-3 text-xs">
            {selectedDetail ? (
              <>
                <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] p-3">
                  <h4 className="font-medium text-[#111827]">{selectedDetail.station?.name}</h4>
                  <p className="mt-1 text-[#6b7280]">
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
                    <h5 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{title}</h5>
                    <div className="space-y-2">
                      {items.length ? (
                        items.map((item: string) => (
                          <div key={item} className="rounded-md border border-[#e2e8f0] bg-white p-2 text-[#111827]">
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-dashed border-[#e2e8f0] bg-white p-2 text-[#6b7280]">
                          No records available.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-[#e2e8f0] bg-[#f9fafb] p-4 text-[#6b7280]">
                Select a watchlist row to load the regulatory detail panel.
              </div>
            )}
            <div>
              <h5 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">Intelligence Alert Feed</h5>
              <div className="space-y-2">
                {alertRows.slice(0, 5).map((alert: any, index) => {
                  const alertId = alert.id || alert.publicId || alert.public_id || `alert-${index}`
                  return (
                  <div key={alertId} className="rounded-md border border-[#e2e8f0] bg-white p-2">
                    <div className="flex items-start gap-2">
                      <Bell className="mt-0.5 size-3.5 text-[#dc2626]" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#111827]">{alert.title}</div>
                        <div className="mt-1 text-[#6b7280]">{alert.district} • {alert.recommendedAction}</div>
                      </div>
                      {renderPill(alert.severity)}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <button type="button" className="rounded border border-[#e2e8f0] px-2 py-1 text-[10px] font-medium text-[#6b7280]" onClick={() => runAction(() => api.acknowledgeAlert(token, alertId), 'Acknowledging alert...', { refresh: false }).then(loadIntelligence)}>Ack</button>
                      <button type="button" className="rounded border border-[#e2e8f0] px-2 py-1 text-[10px] font-medium text-[#2563eb]" onClick={() => runAction(() => api.openCaseFromAlert(token, alertId), 'Opening case...', { refresh: false }).then(loadIntelligence)}>Case</button>
                      <button type="button" className="rounded border border-[#e2e8f0] px-2 py-1 text-[10px] font-medium text-[#d97706]" onClick={() => runAction(() => api.assignInspectionFromAlert(token, alertId), 'Assigning inspection...', { refresh: false }).then(loadIntelligence)}>Inspect</button>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
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
              className="bg-accent-primary hover:bg-accent-primary"
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
          <FieldShell label="Station public ID" hint="This should be the station record being watched. Example: it is prefilled when you select a watchlist row.">
            <Input value={enforcementForm.stationPublicId} onChange={(event) => setEnforcementForm({ ...enforcementForm, stationPublicId: event.target.value })} placeholder="Station Public ID" />
          </FieldShell>
          <FieldShell label="Related flag public ID" hint="Link the generated or manual flag behind this watchlist action. Example: a hoarding risk flag created from repeated complaints.">
            <Input value={enforcementForm.relatedFlagPublicId} onChange={(event) => setEnforcementForm({ ...enforcementForm, relatedFlagPublicId: event.target.value })} placeholder="Related Flag Public ID" />
          </FieldShell>
          <FieldShell label="Action type" hint="Choose the enforcement response. Example: Warning for initial action, Suspension for critical and repeated hoarding evidence.">
            <select className={`${fieldClass} w-full`} value={enforcementForm.actionType} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionType: event.target.value })}>
              {canCreateWarning ? <option value="WARNING">Warning</option> : null}
              {canCreateFine ? <option value="FINE">Fine</option> : null}
              {canCreateSuspension ? <option value="SUSPENSION">Suspension</option> : null}
              {canCreateWarning ? <option value="CLOSURE_NOTICE">Closure Notice</option> : null}
              {canCreateWarning ? <option value="FOLLOW_UP_DIRECTIVE">Follow-up Directive</option> : null}
            </select>
          </FieldShell>
          <FieldShell label="Action status" hint="Set the starting state for the legal action. Example: Open while investigation starts, Escalated for supervisor/legal review.">
            <select className={`${fieldClass} w-full`} value={enforcementForm.actionStatus} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionStatus: event.target.value })}>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLIED">Complied</option>
              <option value="ESCALATED">Escalated</option>
              <option value="CLOSED">Closed</option>
            </select>
          </FieldShell>
          <FieldShell label="Action notes" hint="Summarize the risk evidence and the required remedy. Example: two deliveries recorded but station declared no stock within 24 hours.">
            <textarea className="min-h-28 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#111827]" value={enforcementForm.actionNotes} onChange={(event) => setEnforcementForm({ ...enforcementForm, actionNotes: event.target.value })} placeholder="Legal basis, direction issued, or enforcement note..." />
          </FieldShell>
        </div>
      </ModalShell>
    </div>
  )
}

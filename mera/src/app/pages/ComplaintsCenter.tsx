import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Download, ExternalLink, FileImage, Plus, RefreshCw } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { resolvePortalAssetUrl } from '../lib/portalApi'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

function extractEvidenceName(mediaUrl: string) {
  const assetUrl = resolvePortalAssetUrl(mediaUrl)
  try {
    const pathname = new URL(assetUrl).pathname
    const filename = pathname.split('/').filter(Boolean).pop() || 'evidence-file'
    return decodeURIComponent(filename)
  } catch {
    return String(mediaUrl || '').split('/').filter(Boolean).pop() || 'evidence-file'
  }
}

function getComplainantName(complaint: any) {
  const complainant = complaint?.complainant
  return (
    complainant?.fullName ||
    complainant?.full_name ||
    complainant?.name ||
    complainant?.email ||
    complainant?.phoneNumber ||
    complainant?.phone ||
    'Anonymous reporter'
  )
}

function renderEvidencePreview(mediaUrl: string) {
  const url = resolvePortalAssetUrl(mediaUrl)
  const lower = url.toLowerCase()

  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(lower)) {
    return (
      <img
        src={url}
        alt="Complaint evidence"
        className="max-h-full max-w-full rounded-2xl border border-white/60 bg-white/80 object-contain shadow-[0_20px_60px_-24px_rgba(15,23,42,0.55)]"
      />
    )
  }

  if (/\.(mp4|webm|ogg|mov)(\?|$)/.test(lower)) {
    return (
      <video
        src={url}
        controls
        className="max-h-full max-w-full rounded-2xl border border-slate-700/60 bg-slate-950 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.8)]"
      />
    )
  }

  if (/\.(mp3|wav|m4a|aac|oga)(\?|$)/.test(lower)) {
    return (
      <div className="flex min-h-[18rem] w-full items-center justify-center rounded-[1.75rem] border border-white/60 bg-white/85 p-8 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.45)] backdrop-blur">
        <audio src={url} controls className="w-full max-w-2xl" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[18rem] w-full flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-slate-300/80 bg-white/75 p-8 text-center shadow-[0_20px_60px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
        <FileImage className="size-7" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-800">Preview unavailable in portal</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Open the original evidence file in a separate tab for full inspection.</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
      >
        <ExternalLink className="size-3.5" />
        Open Evidence
      </a>
    </div>
  )
}

export function ComplaintsCenter() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const navigate = useNavigate()
  const [complaintType, setComplaintType] = useState('')
  const [officerFilter, setOfficerFilter] = useState('')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const [selectedComplaint, setSelectedComplaint] = useState<any>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [intakeForm, setIntakeForm] = useState({
    stationPublicId: '',
    complaintType: 'HOARDING',
    complaintDescription: '',
  })
  const [assignOfficerPublicId, setAssignOfficerPublicId] = useState('')
  const [statusValue, setStatusValue] = useState('UNDER_INVESTIGATION')

  const rows = useMemo(() => {
    return normalizeRows(data.complaints?.items).filter((row: any) => {
      const status = String(row.complaintStatus || '').toUpperCase()
      const type = String(row.complaintType || '').toUpperCase()
      const officerId = row.assignedOfficer?.publicId || ''
      if (complaintType && type !== complaintType) return false
      if (officerFilter && officerId !== officerFilter) return false
      if (unresolvedOnly && ['RESOLVED', 'DISMISSED'].includes(status)) return false
      return true
    })
  }, [complaintType, data.complaints, officerFilter, unresolvedOnly])

  const evidenceQueue = rows.filter((row: any) => row.mediaUrl).slice(0, 8)
  const selectedEvidenceUrl = selectedComplaint?.mediaUrl ? resolvePortalAssetUrl(selectedComplaint.mediaUrl) : ''
  const selectedEvidenceName = selectedComplaint?.mediaUrl ? extractEvidenceName(selectedComplaint.mediaUrl) : ''
  const canAssign = hasPermission(MERA_PERMISSIONS.COMPLAINTS_ASSIGN)
  const canTriage = hasPermission(MERA_PERMISSIONS.COMPLAINTS_TRIAGE)
  const canEscalate = hasPermission(MERA_PERMISSIONS.COMPLAINTS_ESCALATE)
  const canClose = hasPermission(MERA_PERMISSIONS.COMPLAINTS_CLOSE)
  const canCreateTask = hasPermission(MERA_PERMISSIONS.TASKS_CREATE) || hasPermission(MERA_PERMISSIONS.TASKS_ASSIGN) || hasPermission(MERA_PERMISSIONS.TASKS_MANAGE)
  const openRows = rows.filter((row: any) => !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(String(row.complaintStatus || '').toUpperCase()))
  const investigationRows = rows.filter((row: any) => ['ESCALATED', 'UNDER_INVESTIGATION', 'ASSIGNED'].includes(String(row.complaintStatus || '').toUpperCase()))
  const complaintColumns = [
    { key: 'publicId', label: 'Complaint' },
    { key: 'station', label: 'Station', render: (row: any) => row.station?.name || '-' },
    { key: 'complaintType', label: 'Type', render: (row: any) => row.complaintType || '-' },
    { key: 'complaintStatus', label: 'Status', render: (row: any) => row.complaintStatus || '-' },
    { key: 'createdAt', label: 'Submitted', render: (row: any) => normalizeDate(row.createdAt) },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {canAssign || canTriage || canEscalate || canClose ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setIntakeOpen(true)}>
            <Plus className="size-4" />
            New Complaint Intake
          </Button>
        ) : null}
        <select className={fieldClass} value={complaintType} onChange={(event) => setComplaintType(event.target.value)}>
          <option value="">All Types</option>
          <option value="HOARDING">Hoarding</option>
          <option value="REFUSAL_TO_SELL">Refusal To Sell</option>
          <option value="OVERPRICING">Overpricing</option>
          <option value="ILLEGAL_VENDING">Illegal Vending</option>
          <option value="SUSPICIOUS_QUEUE_MANIPULATION">Queue Manipulation</option>
          <option value="OTHER">Other</option>
        </select>
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
          <input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
          Unresolved only
        </label>
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

      <SectionKpiStrip
        columns={complaintColumns}
        items={[
          { label: 'Total Complaints', value: rows.length, rows, accent: '#2563eb' },
          { label: 'Open Complaints', value: openRows.length, rows: openRows, tone: openRows.length ? 'warn' : 'good', accent: '#f59e0b' },
          { label: 'Under Investigation', value: investigationRows.length, rows: investigationRows, tone: investigationRows.length ? 'bad' : 'neutral', accent: '#dc2626' },
          { label: 'With Evidence', value: evidenceQueue.length, rows: evidenceQueue, tone: evidenceQueue.length ? 'good' : 'neutral', accent: '#10b981' },
        ]}
      />

      <div className="grid min-h-0 flex-1 gap-4">
        <SectionCard title="Complaint Registry" subtitle="Live complaints from the public complaint app and MERA case intake">
          <PortalTable
            rows={rows}
            onRowClick={(row) => {
              navigate(`/complaints/${row.publicId}`)
            }}
            columns={[
              { key: 'publicId', label: 'Complaint ID' },
              { key: 'station', label: 'Station', render: (row) => row.station?.name || '-' },
              { key: 'complainant', label: 'Filed By', render: (row) => getComplainantName(row) },
              { key: 'complaintType', label: 'Complaint Type', render: (row) => renderPill(row.complaintType) },
              { key: 'reporterSource', label: 'Reporter Source', render: (row) => (row.complainant?.publicId ? 'USER APP' : 'PUBLIC PORTAL') },
              { key: 'district', label: 'District', render: (row) => row.station?.city || '-' },
              { key: 'createdAt', label: 'Submitted Time', render: (row) => normalizeDate(row.createdAt) },
              { key: 'assignedOfficer', label: 'Assigned Officer', render: (row) => row.assignedOfficer?.fullName || 'Unassigned' },
              { key: 'complaintStatus', label: 'Status', render: (row) => renderPill(row.complaintStatus) },
              { key: 'priority', label: 'Priority', render: (row) => renderPill(['HOARDING', 'REFUSAL_TO_SELL'].includes(row.complaintType) ? 'HIGH' : 'MODERATE') },
              {
                key: 'action',
                label: 'Action',
                render: (row) => (
                  <div className="flex gap-2">
                    {canAssign ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-blue-700"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedComplaint(row)
                          setAssignOfficerPublicId(row.assignedOfficer?.publicId || '')
                          setAssignOpen(true)
                        }}
                      >
                        Assign
                      </button>
                    ) : null}
                    {canTriage || canEscalate || canClose ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-blue-700"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedComplaint(row)
                          setStatusValue(row.complaintStatus || 'UNDER_INVESTIGATION')
                          setStatusOpen(true)
                        }}
                      >
                        Update
                      </button>
                    ) : null}
                    {canCreateTask ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-blue-700"
                        onClick={(event) => {
                          event.stopPropagation()
                          const params = new URLSearchParams({
                            linkedEntityType: 'COMPLAINT',
                            linkedEntityId: row.publicId,
                            type: 'COMPLAINT_REVIEW',
                            priority: ['HOARDING', 'REFUSAL_TO_SELL', 'OVERPRICING'].includes(row.complaintType) ? 'HIGH' : 'MEDIUM',
                            title: `Review complaint ${row.publicId}`,
                            description: row.description || row.complaintDescription || 'Complaint review assignment.',
                          })
                          if (row.station?.publicId) params.set('stationPublicId', row.station.publicId)
                          if (row.station?.name) params.set('stationName', row.station.name)
                          if (row.station?.city) params.set('district', row.station.city)
                          navigate(`/tasks/new?${params.toString()}`)
                        }}
                      >
                        Assign Review Task
                      </button>
                    ) : null}
                    {row.mediaUrl ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-blue-700"
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/documents/complaint-media/${row.publicId}`)
                        }}
                      >
                        Evidence
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Recent Citizen Evidence / Media Queue" subtitle="Submitted evidence references linked to complaint intake">
          <div className="grid gap-3 px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
            {evidenceQueue.length ? (
              evidenceQueue.map((item: any) => (
                <div key={item.publicId} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-700">
                    <FileImage className="size-4 text-blue-700" />
                    <span className="font-medium">{item.publicId}</span>
                  </div>
                  <div className="mt-2 text-slate-600">{item.station?.name || '-'}</div>
                  <div className="mt-1 truncate text-slate-500">{extractEvidenceName(item.mediaUrl)}</div>
                  <div className="mt-1 text-slate-500">{normalizeDate(item.createdAt)}</div>
                  <button
                    type="button"
                    className="mt-2 inline-block text-blue-700 underline"
                    onClick={() => {
                      navigate(`/documents/complaint-media/${item.publicId}`)
                    }}
                  >
                    Review Media
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
                No recent citizen evidence is attached to complaint records.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        title={selectedComplaint ? `Evidence Review - ${selectedComplaint.publicId}` : 'Evidence Review'}
        description="Review submitted media and the linked complaint details."
        className="max-h-[92vh] overflow-y-auto border-slate-200/90 bg-white/95 sm:max-w-5xl"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEvidenceOpen(false)}>Close</Button>
            {selectedEvidenceUrl ? (
              <a
                href={selectedEvidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
              >
                <ExternalLink className="size-4" />
                Open Original
              </a>
            ) : null}
          </>
        }
      >
        {selectedComplaint ? (
          <div className="space-y-5">
            <div className="rounded-[1.5rem] border border-slate-200 bg-linear-to-br from-slate-50 via-white to-blue-50 px-5 py-4 text-xs text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Complaint Evidence</p>
                  <div className="mt-2 text-lg font-semibold text-slate-900">{selectedComplaint.station?.name || '-'}</div>
                  <div className="mt-1 text-slate-500">{normalizeDate(selectedComplaint.createdAt)}</div>
                  <div className="mt-2 text-sm text-slate-600">
                    Filed by <span className="font-semibold text-slate-800">{getComplainantName(selectedComplaint)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderPill(selectedComplaint.complaintType)}
                  {renderPill(selectedComplaint.complaintStatus)}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-200/80 pt-4">
                <div>
                  <span className="text-slate-500">File:</span> <span className="font-medium text-slate-700">{selectedEvidenceName || 'Unnamed evidence file'}</span>
                </div>
                <div>
                  <span className="text-slate-500">District:</span> <span className="font-medium text-slate-700">{selectedComplaint.station?.city || '-'}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.9fr)]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Evidence Preview</p>
                    <p className="mt-1 text-xs text-slate-500">A clearer review surface for submitted complaint media.</p>
                  </div>
                  {selectedComplaint.mediaUrl ? (
                    <a
                      href={selectedEvidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                    >
                      <ExternalLink className="size-3.5" />
                      Open full file
                    </a>
                  ) : null}
                </div>

                <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(145deg,_#f8fafc_0%,_#e2e8f0_100%)] p-3 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)]">
                  <div className="flex min-h-[24rem] items-center justify-center overflow-hidden rounded-[1.35rem] border border-white/70 bg-slate-100/70 px-4 py-4 md:min-h-[30rem]">
                    {selectedComplaint.mediaUrl ? renderEvidencePreview(selectedComplaint.mediaUrl) : (
                      <div className="flex h-full min-h-[18rem] w-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-300 bg-white/80 text-sm text-slate-500">
                        No evidence file attached to this complaint.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Complaint Details</p>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    <div><span className="text-slate-500">Complaint ID:</span> {selectedComplaint.publicId}</div>
                    <div><span className="text-slate-500">Filed By:</span> {getComplainantName(selectedComplaint)}</div>
                    <div><span className="text-slate-500">Source:</span> {selectedComplaint.complainant?.publicId ? 'USER APP' : 'PUBLIC PORTAL'}</div>
                    <div><span className="text-slate-500">Assigned Officer:</span> {selectedComplaint.assignedOfficer?.fullName || 'Unassigned'}</div>
                    <div><span className="text-slate-500">Station:</span> {selectedComplaint.station?.name || '-'}</div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Complaint Narrative</p>
                  <p className="mt-4 text-sm leading-6 text-slate-700">{selectedComplaint.description || 'No narrative provided.'}</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </ModalShell>

      <ModalShell
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        title="New Complaint Intake"
        description="Register a complaint directly into the MERA complaint service."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setIntakeOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createComplaint(intakeForm))
                setIntakeOpen(false)
              }}
            >
              Save Complaint
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <select className={fieldClass} value={intakeForm.stationPublicId} onChange={(event) => setIntakeForm({ ...intakeForm, stationPublicId: event.target.value })}>
            <option value="">Select station</option>
            {normalizeRows(data.profiles).map((station: any) => (
              <option key={station.public_id} value={station.public_id}>
                {station.name} {station.city ? `- ${station.city}` : ''}
              </option>
            ))}
          </select>
          <select className={fieldClass} value={intakeForm.complaintType} onChange={(event) => setIntakeForm({ ...intakeForm, complaintType: event.target.value })}>
            <option value="HOARDING">Hoarding</option>
            <option value="REFUSAL_TO_SELL">Refusal To Sell</option>
            <option value="OVERPRICING">Overpricing</option>
            <option value="ILLEGAL_VENDING">Illegal Vending</option>
            <option value="SUSPICIOUS_QUEUE_MANIPULATION">Queue Manipulation</option>
            <option value="OTHER">Other</option>
          </select>
          <textarea
            className="min-h-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
            value={intakeForm.complaintDescription}
            onChange={(event) => setIntakeForm({ ...intakeForm, complaintDescription: event.target.value })}
            placeholder="Complaint narrative..."
          />
        </div>
      </ModalShell>

      <ModalShell
        open={assignOpen}
        onOpenChange={setAssignOpen}
        title="Assign Complaint Officer"
        description={selectedComplaint ? `Route ${selectedComplaint.publicId} to a MERA officer.` : 'Assign a complaint.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                if (!selectedComplaint) return
                await runAction(() => api.assignComplaint(token, selectedComplaint.publicId, assignOfficerPublicId))
                setAssignOpen(false)
              }}
            >
              Assign Officer
            </Button>
          </>
        }
      >
        <select className={fieldClass} value={assignOfficerPublicId} onChange={(event) => setAssignOfficerPublicId(event.target.value)}>
          <option value="">Select officer</option>
          {normalizeRows(data.users).map((user: any) => (
            <option key={user.public_id} value={user.public_id}>
              {user.full_name} • {user.role_display_name || user.role_code}
            </option>
          ))}
        </select>
      </ModalShell>

      <ModalShell
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Update Complaint Status"
        description={selectedComplaint ? `Move ${selectedComplaint.publicId} through the compliance workflow.` : 'Update complaint status.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                if (!selectedComplaint) return
                await runAction(() => api.updateComplaintStatus(token, selectedComplaint.publicId, statusValue))
                setStatusOpen(false)
              }}
            >
              <RefreshCw className="size-4" />
              Save Status
            </Button>
          </>
        }
      >
        <select className={fieldClass} value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
          {canTriage ? <option value="NEW">New</option> : null}
          {canTriage ? <option value="REVIEWING">Reviewing</option> : null}
          {canTriage ? <option value="VERIFIED">Verified</option> : null}
          {canTriage ? <option value="TRIAGED">Triaged</option> : null}
          {canTriage ? <option value="UNDER_INVESTIGATION">Under Investigation</option> : null}
          {canEscalate ? <option value="ESCALATED">Escalated</option> : null}
          {canClose ? <option value="RESOLVED">Resolved</option> : null}
          {canClose ? <option value="REJECTED">Rejected</option> : null}
          {canClose ? <option value="DISMISSED">Dismissed</option> : null}
        </select>
      </ModalShell>
    </div>
  )
}

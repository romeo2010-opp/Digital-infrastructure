import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Download, ExternalLink, Loader2, Plus } from 'lucide-react'
import { PageBackButton } from '../components/PageBackButton'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Button } from '../components/ui/button'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'
import { MERA_PERMISSIONS } from '../lib/access'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

function LoadingState() {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" />
      Loading...
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

function formatMetric(value: any, suffix = '') {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return `0${suffix}`
  return `${Math.round(numeric).toLocaleString()}${suffix}`
}

function formatMoney(value: any) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 'MWK 0'
  return `MWK ${Math.round(numeric).toLocaleString()}`
}

function resolveDocumentRoute(row: any) {
  if (row?.documentRoute || row?.document_route) return row.documentRoute || row.document_route
  if (row?.documentType === 'COMPLAINT_MEDIA' || row?.document_type === 'COMPLAINT_MEDIA' || row?.complaint_public_id || row?.complaintPublicId) {
    const publicId = row.complaint_public_id || row.complaintPublicId || row.public_id || row.id
    return publicId ? `/documents/complaint-media/${publicId}` : ''
  }
  return row?.id ? `/documents/task-evidence/${row.id}` : ''
}

function renderFilePreview(fileUrl: string, title = 'Evidence file') {
  const url = resolvePortalAssetUrl(fileUrl)
  const lower = url.toLowerCase()
  if (!url) {
    return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No file is attached to this record.</div>
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(lower)) {
    return <img src={url} alt={title} className="max-h-[460px] w-full rounded-lg border border-slate-200 bg-white object-contain" />
  }
  if (/\.(mp4|webm|ogg|mov)(\?|$)/.test(lower)) {
    return <video src={url} controls className="max-h-[460px] w-full rounded-lg border border-slate-200 bg-slate-950" />
  }
  if (/\.(mp3|wav|m4a|aac|oga)(\?|$)/.test(lower)) {
    return <audio src={url} controls className="w-full" />
  }
  if (/\.pdf(\?|$)/.test(lower)) {
    return <iframe src={url} title={title} className="h-[520px] w-full rounded-lg border border-slate-200 bg-white" />
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
      Preview is not available for this file type.
    </div>
  )
}

function DetailShell({
  fallback,
  title,
  subtitle,
  children,
}: {
  fallback: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PageBackButton fallback={fallback} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-[var(--mera-panel-text)]">{title}</h1>
            {subtitle ? <p className="mt-1 text-xs text-[var(--mera-panel-text-muted)]">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

function useDetailLoader<T>(loader: (signal: AbortSignal) => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loader(controller.signal)
      .then(setData)
      .catch((requestError: any) => {
        if (controller.signal.aborted) return
        setError(requestError?.message || 'Unable to load this record.')
        setData(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [...deps, refreshKey])

  return { data, loading, error, retry: () => setRefreshKey((value) => value + 1) }
}

export function LicenseDetailPage() {
  const { licenseId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { token, api, hasPermission, hasAnyPermission } = usePortal()
  const { data, loading, error, retry } = useDetailLoader(
    (signal) => api.getLicenseDetail(token, licenseId, location.state?.fromSearch ? { fromSearch: 'true' } : {}, signal),
    [api, token, licenseId, location.state?.fromSearch],
  )
  const licence = data?.licence
  const station = data?.station
  const compliance = data?.compliance || {}

  return (
    <DetailShell fallback="/license-registry" title={licence?.licenseNumber || 'Licence Detail'} subtitle={station?.name ? `${station.name} · ${station.city || 'No district'}` : 'Licence record'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard
            title="Licence Summary"
            subtitle="Station licence details, compliance conditions, and current status"
            actions={licence?.status ? renderPill(licence.status) : null}
          >
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              {[
                ['Licence No', licence?.licenseNumber],
                ['Type', licence?.licenseType || licence?.licenceType],
                ['Issue Date', normalizeDate(licence?.issueDate)],
                ['Expiry Date', normalizeDate(licence?.expiryDate)],
                ['Owner / Operator', licence?.ownerOperator || station?.operatorName || '-'],
                ['Station', station?.name || '-'],
                ['District', station?.city || licence?.district || '-'],
                ['Location', station?.address || licence?.location || '-'],
                ['Last Updated', normalizeDate(licence?.updatedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</div>
                  <div className="mt-1 text-slate-800">{value || '-'}</div>
                </div>
              ))}
              <div className="md:col-span-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Compliance Conditions</div>
                <div className="mt-1 text-slate-700">{licence?.complianceConditions || 'No licence-specific conditions recorded.'}</div>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
            <SectionCard title="Linked Station" subtitle="Operational station context for this licence">
              <div className="grid gap-3 px-4 py-3 text-xs md:grid-cols-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Station</div>
                  <div className="mt-1 font-medium text-slate-900">{station?.name || '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</div>
                  <div className="mt-1">{renderPill(station?.isActive ? 'ACTIVE' : 'INACTIVE')}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Station Code</div>
                  <div className="mt-1 text-slate-700">{station?.publicId || '-'}</div>
                </div>
              </div>
              <div className="border-t border-slate-200 px-4 py-3">
                <Button type="button" variant="outline" size="sm" onClick={() => station?.publicId && navigate(`/stations/${station.publicId}`)}>
                  <ExternalLink className="size-4" />
                  Open Station
                </Button>
              </div>
            </SectionCard>

            <SectionCard title="Compliance Status" subtitle="Derived from linked station activity">
              <div className="grid gap-3 px-4 py-3 text-xs">
                {[
                  ['Compliance Score', compliance.score ?? '-'],
                  ['Active Violations', compliance.activeViolations ?? 0],
                  ['Pending Tasks', compliance.pendingTasks ?? 0],
                  ['Overdue Tasks', compliance.overdueTasks ?? 0],
                  ['Last Inspection', normalizeDate(compliance.lastInspectionDate)],
                  ['Last Complaint', normalizeDate(compliance.lastComplaintDate)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Actions" subtitle="Role-aware actions for this licence record">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {hasAnyPermission([MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_MANAGE]) ? (
                <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => navigate(`/tasks/new?stationPublicId=${station?.publicId || ''}&licenseId=${licence?.id || ''}`)}>
                  <Plus className="size-4" />
                  Create Task
                </Button>
              ) : null}
              {hasPermission(MERA_PERMISSIONS.INSPECTIONS_CREATE) ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate('/field-inspections')}>Schedule Inspection</Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => station?.publicId && navigate(`/stations/${station.publicId}`)}>View Station</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Download className="size-4" />
                Export Licence Summary
              </Button>
              <Button type="button" variant="outline" size="sm" disabled>Open Compliance Case</Button>
              <Button type="button" variant="outline" size="sm" disabled>Add Note</Button>
              <Button type="button" variant="outline" size="sm" disabled>Mark for Review</Button>
            </div>
          </SectionCard>

          <RelatedTables data={data} />
        </>
      ) : null}
    </DetailShell>
  )
}

function RelatedTables({ data }: { data: any }) {
  const navigate = useNavigate()
  return (
    <div className="grid gap-4">
      <SectionCard title="Station Licences" subtitle="Licence records linked to this station or manager">
        <PortalTable
          rows={normalizeRows(data.relatedLicences || data.licences)}
          emptyMessage="No linked licence records found."
          onRowClick={(row) => row.id && navigate(`/licences/${row.id}`)}
          columns={[
            { key: 'license_number', label: 'Licence No', render: (row) => row.license_number || row.licence_number || '-' },
            { key: 'station_name', label: 'Station', render: (row) => row.station_name || '-' },
            { key: 'license_status', label: 'Status', render: (row) => renderPill(row.license_status || row.status) },
            { key: 'city', label: 'District', render: (row) => row.city || row.district || '-' },
            { key: 'expiry_date', label: 'Expiry', render: (row) => normalizeDate(row.expiry_date || row.expiryDate) },
          ]}
        />
      </SectionCard>
      <SectionCard title="Related Tasks" subtitle="Tasks linked to this licence or station">
        <PortalTable
          rows={normalizeRows(data.relatedTasks || data.tasks)}
          emptyMessage="No related tasks found."
          onRowClick={(row) => row.task_number && navigate(`/tasks/${row.task_number}`)}
          columns={[
            { key: 'task_number', label: 'Task No' },
            { key: 'title', label: 'Title' },
            { key: 'priority', label: 'Priority', render: (row) => renderPill(row.priority) },
            { key: 'status', label: 'Status', render: (row) => renderPill(row.status) },
            { key: 'assigned_to_name', label: 'Assigned Officer', render: (row) => row.assigned_to_name || '-' },
            { key: 'due_at', label: 'Due Date', render: (row) => normalizeDate(row.due_at) },
          ]}
        />
      </SectionCard>
      <SectionCard title="Related Cases" subtitle="Compliance flags and enforcement actions">
        <PortalTable
          rows={normalizeRows(data.relatedCases || data.cases)}
          emptyMessage="No related cases found."
          onRowClick={(row) => row.public_id && navigate(`/cases/${row.caseType === 'ENFORCEMENT_ACTION' ? 'enforcement' : 'flag'}-${row.public_id}`)}
          columns={[
            { key: 'public_id', label: 'Case Ref' },
            { key: 'caseType', label: 'Type', render: (row) => renderPill(row.caseType || row.flag_type || row.action_type) },
            { key: 'severity', label: 'Severity', render: (row) => row.severity ? renderPill(row.severity) : '-' },
            { key: 'status', label: 'Status', render: (row) => renderPill(row.resolved_status || row.action_status) },
            { key: 'created', label: 'Created', render: (row) => normalizeDate(row.created_at || row.issued_at) },
          ]}
        />
      </SectionCard>
      <SectionCard title="Related Complaints" subtitle="Complaints linked to the station">
        <PortalTable
          rows={normalizeRows(data.relatedComplaints || data.complaints)}
          emptyMessage="No related complaints found."
          onRowClick={(row) => row.public_id && navigate(`/complaints/${row.public_id}`)}
          columns={[
            { key: 'public_id', label: 'Complaint Ref' },
            { key: 'complaint_type', label: 'Category', render: (row) => renderPill(row.complaint_type) },
            { key: 'complaint_status', label: 'Status', render: (row) => renderPill(row.complaint_status) },
            { key: 'created_at', label: 'Created', render: (row) => normalizeDate(row.created_at) },
          ]}
        />
      </SectionCard>
      <SectionCard title="Documents / Evidence" subtitle="Linked evidence where available">
        <PortalTable
          rows={normalizeRows(data.documents)}
          emptyMessage="No documents or evidence are linked to this record."
          onRowClick={(row) => {
            const route = resolveDocumentRoute(row)
            if (route) navigate(route)
          }}
          columns={[
            { key: 'title', label: 'Title', render: (row) => row.title || row.file_url || '-' },
            { key: 'evidence_type', label: 'Type', render: (row) => renderPill(row.evidence_type || row.file_type || 'DOCUMENT') },
            { key: 'task_number', label: 'Linked Task', render: (row) => row.task_number || '-' },
            { key: 'created_at', label: 'Created', render: (row) => normalizeDate(row.created_at || row.uploaded_at) },
            { key: 'action', label: 'Action', render: () => <span className="text-[11px] font-medium text-blue-700">Open</span> },
          ]}
        />
      </SectionCard>
      <SectionCard title="Activity / Audit Timeline" subtitle="Recent lifecycle and audit activity">
        <div className="divide-y divide-slate-200">
          {normalizeRows(data.activity).length ? normalizeRows(data.activity).map((item: any, index) => (
            <div key={`${item.action}-${item.createdAt || item.created_at}-${index}`} className="px-4 py-3 text-xs">
              <div className="font-semibold text-slate-900">{item.action || item.action_type}</div>
              <div className="mt-1 text-slate-600">{item.description || item.action_description || '-'}</div>
              <div className="mt-1 text-slate-500">{normalizeDate(item.createdAt || item.created_at)}</div>
            </div>
          )) : <div className="px-4 py-6 text-sm text-slate-500">No activity is available.</div>}
        </div>
      </SectionCard>
    </div>
  )
}

export function StationManagerDetailPage() {
  const { userPublicId = '' } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const { data, loading, error, retry } = useDetailLoader(
    (signal) => api.getStationManagerDetail(token, userPublicId, signal),
    [api, token, userPublicId],
  )
  const manager = data?.manager
  return (
    <DetailShell fallback="/station-regulatory-profiles" title={manager?.fullName || 'Station Manager'} subtitle={manager?.email || manager?.phone || 'Manager profile'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.4fr]">
            <SectionCard title="Manager Profile" subtitle="Station manager contact and account status" actions={renderPill(manager?.isActive ? 'ACTIVE' : 'INACTIVE')}>
              <div className="grid gap-3 px-4 py-3 text-xs">
                <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{manager?.fullName || '-'}</span></div>
                <div><span className="text-slate-500">Email:</span> {manager?.email || '-'}</div>
                <div><span className="text-slate-500">Phone:</span> {manager?.phone || '-'}</div>
                <div><span className="text-slate-500">User ID:</span> {manager?.publicId || '-'}</div>
              </div>
            </SectionCard>
            <SectionCard title="Managed / Owned Stations" subtitle="Active station manager assignments">
              <PortalTable
                rows={normalizeRows(data.stations)}
                emptyMessage="No accessible station assignments found."
                onRowClick={(row) => navigate(`/stations/${row.public_id}`)}
                columns={[
                  { key: 'name', label: 'Station' },
                  { key: 'operator_name', label: 'Owner / Operator', render: (row) => row.operator_name || '-' },
                  { key: 'city', label: 'District', render: (row) => row.city || '-' },
                  { key: 'address', label: 'Location', render: (row) => row.address || '-' },
                  { key: 'is_active', label: 'Status', render: (row) => renderPill(Number(row.is_active) === 1 ? 'ACTIVE' : 'INACTIVE') },
                ]}
              />
            </SectionCard>
          </div>
          <RelatedTables data={data} />
        </>
      ) : null}
    </DetailShell>
  )
}

export function StationDetailPage() {
  const { stationPublicId = '' } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const { data, loading, error, retry } = useDetailLoader((signal) => api.getStationDetail(token, stationPublicId, signal), [api, token, stationPublicId])
  const station = data?.station
  const operations = data?.operations || {}
  const currentAvailability = data?.fuelAvailability?.current || {}
  const deliveries = normalizeRows(data?.deliveries)
  const availabilityReports = normalizeRows(data?.fuelAvailability?.reports)
  return (
    <DetailShell fallback="/station-regulatory-profiles" title={station?.name || 'Station Detail'} subtitle={station?.city || 'Station dossier'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard title="Station Summary" subtitle="Station identity, operator, managers, and linked regulatory records">
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              <div><div className="text-slate-500">Station ID</div><div className="mt-1 font-medium">{station?.public_id}</div></div>
              <div><div className="text-slate-500">Owner / Operator</div><div className="mt-1">{station?.operator_name || '-'}</div></div>
              <div><div className="text-slate-500">District</div><div className="mt-1">{station?.city || '-'}</div></div>
              <div><div className="text-slate-500">Status</div><div className="mt-1">{renderPill(Number(station?.is_active) === 1 ? 'ACTIVE' : 'INACTIVE')}</div></div>
              <div className="md:col-span-4"><div className="text-slate-500">Location</div><div className="mt-1">{station?.address || '-'}</div></div>
            </div>
          </SectionCard>
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <SectionCard title="Fuel & Dispensed Metrics" subtitle="Recent transactional and current fuel posture where live data exists">
              <div className="grid gap-3 px-4 py-3 text-xs md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-slate-500">Dispensed Litres</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{formatMetric(operations.dispensed_litres, ' L')}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-slate-500">Pump Sessions / Transactions</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{formatMetric(operations.transaction_count)}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-slate-500">Recorded Sales</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{formatMoney(operations.total_sales_amount)}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-slate-500">Last Dispensed</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{normalizeDate(operations.last_dispensed_at)}</div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Fuel Availability" subtitle="Current declaration and recent station reports">
              <div className="grid gap-3 px-4 py-3 text-xs md:grid-cols-3">
                <div><div className="text-slate-500">Overall</div><div className="mt-1">{renderPill(currentAvailability.availability_status || 'UNKNOWN')}</div></div>
                <div><div className="text-slate-500">Petrol</div><div className="mt-1">{renderPill(currentAvailability.petrol_status || 'UNKNOWN')}</div></div>
                <div><div className="text-slate-500">Diesel</div><div className="mt-1">{renderPill(currentAvailability.diesel_status || 'UNKNOWN')}</div></div>
                <div><div className="text-slate-500">Live Litres</div><div className="mt-1 font-medium text-slate-900">{formatMetric(currentAvailability.total_live_litres, ' L')}</div></div>
                <div><div className="text-slate-500">Latest Delivery</div><div className="mt-1 text-slate-800">{normalizeDate(currentAvailability.latest_delivery_time)}</div></div>
                <div><div className="text-slate-500">Updated</div><div className="mt-1 text-slate-800">{normalizeDate(currentAvailability.updated_at || currentAvailability.last_logged_at)}</div></div>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Delivery Summary" subtitle="Recent fuel delivery records tied to this station">
              <PortalTable
                rows={deliveries}
                emptyMessage="No delivery records are available for this station."
                columns={[
                  { key: 'delivery_time', label: 'Delivery', render: (row) => normalizeDate(row.delivery_time) },
                  { key: 'fuel_type', label: 'Fuel', render: (row) => renderPill(row.fuel_type) },
                  { key: 'estimated_volume', label: 'Volume', render: (row) => formatMetric(row.estimated_volume, ' L') },
                  { key: 'source_type', label: 'Source', render: (row) => row.source_type || '-' },
                ]}
              />
            </SectionCard>
            <SectionCard title="Availability Reports" subtitle="Officer and station availability declarations">
              <PortalTable
                rows={availabilityReports}
                emptyMessage="No availability reports are available for this station."
                columns={[
                  { key: 'created_at', label: 'Reported', render: (row) => normalizeDate(row.created_at) },
                  { key: 'petrol_available', label: 'Petrol', render: (row) => renderPill(Number(row.petrol_available) === 1 ? 'AVAILABLE' : 'DRY') },
                  { key: 'diesel_available', label: 'Diesel', render: (row) => renderPill(Number(row.diesel_available) === 1 ? 'AVAILABLE' : 'DRY') },
                  { key: 'active_pumps', label: 'Pumps', render: (row) => row.active_pumps ?? '-' },
                ]}
              />
            </SectionCard>
          </div>

          <SectionCard title="Station Managers" subtitle="Active staff assignments at this station">
            <PortalTable
              rows={normalizeRows(data.managers)}
              emptyMessage="No managers are assigned to this station."
              onRowClick={(row) => navigate(`/station-managers/${row.public_id}`)}
              columns={[
                { key: 'full_name', label: 'Name' },
                { key: 'email', label: 'Email', render: (row) => row.email || '-' },
                { key: 'phone_e164', label: 'Phone', render: (row) => row.phone_e164 || '-' },
                { key: 'role_name', label: 'Role', render: (row) => renderPill(row.role_name) },
              ]}
            />
          </SectionCard>
          <RelatedTables data={data} />
        </>
      ) : null}
    </DetailShell>
  )
}

export function ComplaintDetailPage() {
  const { complaintPublicId = '' } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const { data, loading, error, retry } = useDetailLoader((signal) => api.getComplaintDetail(token, complaintPublicId, signal), [api, token, complaintPublicId])
  const complaint = data?.complaint
  const mediaDocument = normalizeRows(data?.documents).find((row: any) => row.document_type === 'COMPLAINT_MEDIA' || row.documentType === 'COMPLAINT_MEDIA')
  return (
    <DetailShell fallback="/complaints-center" title={complaint?.public_id || 'Complaint Detail'} subtitle={complaint?.station_name ? `${complaint.station_name} · ${complaint.city || 'No district'}` : 'Complaint record'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard title="Complaint Summary" subtitle="Complaint status, station, assignment, and narrative" actions={complaint?.complaint_status ? renderPill(complaint.complaint_status) : null}>
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              <div><div className="text-slate-500">Type</div><div className="mt-1">{renderPill(complaint?.complaint_type)}</div></div>
              <div><div className="text-slate-500">Station</div><div className="mt-1">{complaint?.station_name || '-'}</div></div>
              <div><div className="text-slate-500">Assigned Officer</div><div className="mt-1">{complaint?.officer_name || 'Unassigned'}</div></div>
              <div><div className="text-slate-500">Submitted</div><div className="mt-1">{normalizeDate(complaint?.created_at)}</div></div>
              <div><div className="text-slate-500">Complainant</div><div className="mt-1">{complaint?.complainant_name || complaint?.complainant_email || complaint?.complainant_phone || 'Anonymous reporter'}</div></div>
              <div><div className="text-slate-500">Updated</div><div className="mt-1">{normalizeDate(complaint?.updated_at)}</div></div>
              <div><div className="text-slate-500">Geo Coordinates</div><div className="mt-1">{complaint?.geo_lat && complaint?.geo_lng ? `${complaint.geo_lat}, ${complaint.geo_lng}` : '-'}</div></div>
              <div><div className="text-slate-500">Evidence</div><div className="mt-1">{complaint?.media_url ? 'Media attached' : 'No media attached'}</div></div>
              <div className="md:col-span-4"><div className="text-slate-500">Narrative</div><div className="mt-1 leading-6">{complaint?.complaint_description || '-'}</div></div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
              {complaint?.station_public_id ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/stations/${complaint.station_public_id}`)}>Open Station</Button>
              ) : null}
              {complaint?.media_url ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/documents/complaint-media/${complaint.public_id}`)}>
                  <ExternalLink className="size-4" />
                  Open Evidence
                </Button>
              ) : null}
            </div>
          </SectionCard>
          {mediaDocument ? (
            <SectionCard title="Complaint Evidence Preview" subtitle="Media, file link, and submitted context">
              <div className="space-y-3 px-4 py-3">
                {renderFilePreview(mediaDocument.file_url || mediaDocument.fileUrl, mediaDocument.title || 'Complaint evidence')}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => navigate(resolveDocumentRoute(mediaDocument))}>Open Evidence Detail</Button>
                  {mediaDocument.file_url ? (
                    <a className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-blue-700" href={resolvePortalAssetUrl(mediaDocument.file_url)} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      Open File
                    </a>
                  ) : null}
                </div>
              </div>
            </SectionCard>
          ) : null}
          <RelatedTables data={data} />
        </>
      ) : null}
    </DetailShell>
  )
}

export function CaseDetailPage() {
  const { caseId = '' } = useParams()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const { data, loading, error, retry } = useDetailLoader((signal) => api.getCaseDetail(token, caseId, signal), [api, token, caseId])
  const caseRecord = data?.case
  const evidenceRows = normalizeRows(data?.documents)
  return (
    <DetailShell fallback="/compliance-flags" title={caseRecord?.public_id || 'Regulatory Case'} subtitle={caseRecord?.station_name ? `${caseRecord.station_name} · ${caseRecord.city || 'No district'}` : 'Case record'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard title="Case Summary" subtitle="Compliance flag or enforcement action opened from search">
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              <div><div className="text-slate-500">Type</div><div className="mt-1">{renderPill(caseRecord?.caseType || caseRecord?.flag_type || caseRecord?.action_type)}</div></div>
              <div><div className="text-slate-500">Status</div><div className="mt-1">{renderPill(caseRecord?.resolved_status || caseRecord?.action_status)}</div></div>
              <div><div className="text-slate-500">Station</div><div className="mt-1">{caseRecord?.station_name || '-'}</div></div>
              <div><div className="text-slate-500">Created</div><div className="mt-1">{normalizeDate(caseRecord?.created_at || caseRecord?.issued_at)}</div></div>
              <div><div className="text-slate-500">Severity</div><div className="mt-1">{caseRecord?.severity ? renderPill(caseRecord.severity) : '-'}</div></div>
              <div><div className="text-slate-500">Related Flag</div><div className="mt-1">{caseRecord?.related_flag_public_id || caseRecord?.source_reference || '-'}</div></div>
              <div><div className="text-slate-500">Resolved</div><div className="mt-1">{normalizeDate(caseRecord?.resolved_at)}</div></div>
              <div><div className="text-slate-500">Evidence Files</div><div className="mt-1">{evidenceRows.length}</div></div>
              <div className="md:col-span-4"><div className="text-slate-500">Narrative</div><div className="mt-1 leading-6">{caseRecord?.generated_reason || caseRecord?.action_notes || 'No case narrative recorded.'}</div></div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
              {caseRecord?.station_public_id ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/stations/${caseRecord.station_public_id}`)}>Open Station</Button>
              ) : null}
              {caseRecord?.related_flag_public_id ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/cases/flag-${caseRecord.related_flag_public_id}`)}>Open Related Flag</Button>
              ) : null}
              {evidenceRows[0] ? (
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(resolveDocumentRoute(evidenceRows[0]))}>Open First Evidence</Button>
              ) : null}
            </div>
          </SectionCard>
          <RelatedTables data={data} />
        </>
      ) : null}
    </DetailShell>
  )
}

export function DocumentDetailPage() {
  const { evidenceId = '', complaintPublicId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { token, api } = usePortal()
  const isComplaintMedia = location.pathname.includes('/complaint-media/')
  const { data, loading, error, retry } = useDetailLoader(
    (signal) =>
      isComplaintMedia
        ? api.getComplaintMediaDetail(token, complaintPublicId, signal)
        : api.getTaskEvidenceDetail(token, evidenceId, signal),
    [api, token, evidenceId, complaintPublicId, isComplaintMedia],
  )
  const document = data?.document
  const linkedTask = data?.linkedTask
  const complaint = data?.complaint
  const station = data?.station
  const fileUrl = document?.fileUrl || document?.file_url || ''

  return (
    <DetailShell fallback={isComplaintMedia ? '/complaints-center' : '/tasks'} title={document?.title || 'Document Detail'} subtitle={document?.evidenceType || document?.documentType || 'Evidence record'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard title="Document Summary" subtitle="Evidence metadata, source, and linked operational record" actions={renderPill(document?.evidenceType || document?.documentType || 'DOCUMENT')}>
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              <div><div className="text-slate-500">Document ID</div><div className="mt-1 font-medium text-slate-900">{document?.id || '-'}</div></div>
              <div><div className="text-slate-500">Type</div><div className="mt-1">{renderPill(document?.evidenceType || document?.documentType || 'DOCUMENT')}</div></div>
              <div><div className="text-slate-500">Created</div><div className="mt-1">{normalizeDate(document?.createdAt || document?.created_at)}</div></div>
              <div><div className="text-slate-500">Uploader / Source</div><div className="mt-1">{document?.uploadedBy?.fullName || document?.uploadedBy?.email || document?.uploadedBy?.phone || 'Unknown source'}</div></div>
              <div className="md:col-span-4"><div className="text-slate-500">Description</div><div className="mt-1 leading-6">{document?.description || 'No description recorded.'}</div></div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
              {fileUrl ? (
                <a className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-blue-700" href={resolvePortalAssetUrl(fileUrl)} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Open File
                </a>
              ) : null}
              {linkedTask?.taskNumber ? <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/tasks/${linkedTask.taskNumber}`)}>Open Task</Button> : null}
              {complaint?.public_id ? <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/complaints/${complaint.public_id}`)}>Open Complaint</Button> : null}
              {station?.publicId ? <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/stations/${station.publicId}`)}>Open Station</Button> : null}
            </div>
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <SectionCard title="File Preview" subtitle="Network-hosted upload preview or download fallback">
              <div className="px-4 py-3">{renderFilePreview(fileUrl, document?.title || 'Evidence file')}</div>
            </SectionCard>

            <SectionCard title="Linked Record" subtitle="Operational record connected to this evidence">
              <div className="space-y-3 px-4 py-3 text-xs">
                {linkedTask ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="font-semibold text-slate-900">{linkedTask.taskNumber}</div>
                    <div className="mt-1 text-slate-600">{linkedTask.title}</div>
                    <div className="mt-2 flex flex-wrap gap-2">{renderPill(linkedTask.priority)} {renderPill(linkedTask.status)}</div>
                  </div>
                ) : null}
                {complaint ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="font-semibold text-slate-900">{complaint.public_id}</div>
                    <div className="mt-1 text-slate-600">{complaint.complaint_description || '-'}</div>
                    <div className="mt-2">{renderPill(complaint.complaint_status)}</div>
                  </div>
                ) : null}
                {station ? (
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="text-slate-500">Station</div>
                    <div className="mt-1 font-semibold text-slate-900">{station.name || '-'}</div>
                    <div className="mt-1 text-slate-500">{station.city || 'No district'}</div>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Document Activity" subtitle="Evidence and linked record timeline">
            <div className="divide-y divide-slate-200">
              {normalizeRows(data.activity).length ? normalizeRows(data.activity).map((item: any, index) => (
                <div key={`${item.action || item.action_type}-${index}`} className="px-4 py-3 text-xs">
                  <div className="font-semibold text-slate-900">{item.action || item.action_type}</div>
                  <div className="mt-1 text-slate-600">{item.description || item.action_description || item.old_value || '-'}</div>
                  <div className="mt-1 text-slate-500">{normalizeDate(item.createdAt || item.created_at)}</div>
                </div>
              )) : <div className="px-4 py-6 text-sm text-slate-500">No activity is available.</div>}
            </div>
          </SectionCard>
        </>
      ) : null}
    </DetailShell>
  )
}

export function UserDetailPage() {
  const { userPublicId = '' } = useParams()
  const { token, api } = usePortal()
  const { data, loading, error, retry } = useDetailLoader((signal) => api.getUserDetail(token, userPublicId, signal), [api, token, userPublicId])
  const user = data?.user
  return (
    <DetailShell fallback="/user-administration" title={user?.full_name || 'MERA User'} subtitle={user?.email || user?.role_display_name || 'Officer record'}>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={retry} /> : data ? (
        <>
          <SectionCard title="Officer Summary" subtitle="MERA user account, scope, and recent work">
            <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
              <div><div className="text-slate-500">Role</div><div className="mt-1">{renderPill(user?.role_display_name || user?.role_code)}</div></div>
              <div><div className="text-slate-500">Status</div><div className="mt-1">{renderPill(user?.account_status)}</div></div>
              <div><div className="text-slate-500">District</div><div className="mt-1">{user?.district_scope || 'National scope'}</div></div>
              <div><div className="text-slate-500">Phone</div><div className="mt-1">{user?.phone || '-'}</div></div>
            </div>
          </SectionCard>
          <SectionCard title="Assigned Tasks" subtitle="Recent tasks assigned to this MERA user">
            <PortalTable
              rows={normalizeRows(data.tasks)}
              emptyMessage="No tasks are assigned to this user."
              columns={[
                { key: 'task_number', label: 'Task No' },
                { key: 'title', label: 'Title' },
                { key: 'priority', label: 'Priority', render: (row) => renderPill(row.priority) },
                { key: 'status', label: 'Status', render: (row) => renderPill(row.status) },
                { key: 'due_at', label: 'Due', render: (row) => normalizeDate(row.due_at) },
              ]}
            />
          </SectionCard>
          <SectionCard title="Audit History" subtitle="Recent audit activity visible to your role">
            <div className="divide-y divide-slate-200">
              {normalizeRows(data.audit).length ? normalizeRows(data.audit).map((row: any, index) => (
                <div key={`${row.action_type}-${index}`} className="px-4 py-3 text-xs">
                  <div className="font-semibold text-slate-900">{row.action_type}</div>
                  <div className="mt-1 text-slate-600">{row.action_description || '-'}</div>
                  <div className="mt-1 text-slate-500">{normalizeDate(row.created_at)}</div>
                </div>
              )) : <div className="px-4 py-6 text-sm text-slate-500">No audit history is available.</div>}
            </div>
          </SectionCard>
        </>
      ) : null}
    </DetailShell>
  )
}

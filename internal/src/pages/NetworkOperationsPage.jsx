import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { DataTable } from "../components/PanelTable"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatMoney, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

const INCIDENT_ASSIGNMENT_OPTIONS = [
  { code: "NETWORK_OPERATIONS_MANAGER", label: "Network Operations" },
  { code: "FIELD_AGENT", label: "Field Agent" },
  { code: "PLATFORM_INFRASTRUCTURE_ENGINEER", label: "Platform Engineering" },
]

function exportCsv(filename, headers, rows) {
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const content = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ].join("\n")

  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function StationDetailModal({ station, telemetry, transactions, statusHistory, onClose }) {
  if (!station) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Station detail" onClick={onClose}>
      <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{station.stationName}</h3>
            <p>{station.region} region operational view.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Status</span><strong>{station.isActive ? "ACTIVE" : "OFFLINE"}</strong></div>
            <div><span>Queue depth</span><strong>{formatNumber(station.queueDepth)}</strong></div>
            <div><span>Pumps offline</span><strong>{formatNumber(station.pumpsOffline)}</strong></div>
            <div><span>Last transaction</span><strong>{formatDateTime(station.lastTransactionAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Live pump activity</span>
            <DataTable
              columns={[
                { key: "pumpPublicId", label: "Pump" },
                { key: "nozzlePublicId", label: "Nozzle" },
                { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
                { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
              ]}
              rows={telemetry}
              emptyLabel="No telemetry for this station."
              compact
              minWidth={520}
            />
          </div>

          <div className="admin-detail-block">
            <span>Operational transactions</span>
            <DataTable
              columns={[
                { key: "publicId", label: "Transaction" },
                { key: "pumpPublicId", label: "Pump" },
                { key: "totalAmount", label: "Amount", render: (row) => formatMoney(row.totalAmount) },
                { key: "paymentMethod", label: "Method" },
                { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
              ]}
              rows={transactions}
              emptyLabel="No recent operational transactions."
              compact
              minWidth={620}
            />
          </div>

          <div className="admin-detail-block">
            <span>Station status history</span>
            <DataTable
              columns={[
                { key: "title", label: "Event" },
                { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
                { key: "status", label: "State", render: (row) => <StatusPill value={row.status} /> },
                { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
              ]}
              rows={statusHistory}
              emptyLabel="No station history available."
              compact
              minWidth={620}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldVisitRequestModal({ station, reason, setReason, onClose, onSubmit }) {
  if (!station) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Request field visit" onClick={onClose}>
      <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Request Field Visit</h3>
            <p>State why {station.stationName} needs an on-site field visit.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-form-card">
            <label className="settings-form-field">
              <span>Reason for field visit</span>
              <textarea
                rows={5}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain the operational issue, observed risk, or why on-site support is needed."
              />
            </label>
            <div className="settings-form-actions">
              <button type="button" className="secondary-action" disabled={!reason.trim()} onClick={onSubmit}>
                Request Field Visit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function IncidentDetailModal({
  incident,
  assignRole,
  setAssignRole,
  noteDraft,
  setNoteDraft,
  onClose,
  onAction,
  canManageIncidents,
}) {
  if (!incident) return null

  const notes = Array.isArray(incident.metadata?.notes) ? incident.metadata.notes : []

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Incident detail" onClick={onClose}>
      <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{incident.title}</h3>
            <p>Operational incident timeline and actions.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Severity</span><strong>{incident.severity}</strong></div>
            <div><span>Status</span><strong>{incident.status}</strong></div>
            <div><span>Assigned role</span><strong>{incident.ownerRoleCode || "-"}</strong></div>
            <div><span>Created</span><strong>{formatDateTime(incident.createdAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Summary</span>
            <strong>{incident.summary}</strong>
          </div>

          <div className="admin-detail-block">
            <span>Incident timeline</span>
            <pre className="admin-json-block">{JSON.stringify(incident.metadata || {}, null, 2)}</pre>
          </div>

          <div className="admin-detail-block">
            <span>Incident notes</span>
            {notes.length ? (
              <div className="timeline-list">
                {notes.map((note, index) => (
                  <article key={`${note.createdAt}-${index}`} className="timeline-item">
                    <div>
                      <strong>{note.actorRoleCode || "Internal User"}</strong>
                      <p>{note.note}</p>
                    </div>
                    <div className="timeline-meta">
                      <time>{formatDateTime(note.createdAt)}</time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-cell">No incident notes yet.</p>
            )}
          </div>

          {canManageIncidents ? (
            <div className="admin-form-grid">
              <label className="settings-form-field">
                <span>Assign incident</span>
                <select value={assignRole} onChange={(event) => setAssignRole(event.target.value)}>
                  <option value="">Select role</option>
                  {INCIDENT_ASSIGNMENT_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="settings-form-field">
                <span>Add incident note</span>
                <input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add note..." />
              </label>
            </div>
          ) : null}

          {canManageIncidents ? (
            <div className="inline-action-group inline-action-group--row">
              <button type="button" className="secondary-action" onClick={() => onAction(() => internalApi.acknowledgeOperationalAlert(incident.publicId))}>Acknowledge</button>
              <button type="button" className="secondary-action" onClick={() => onAction(() => internalApi.markOperationalIncidentUnderReview(incident.publicId))}>Under review</button>
              <button type="button" className="secondary-action" onClick={() => onAction(() => internalApi.resolveOperationalIncident(incident.publicId))}>Resolve</button>
              <button type="button" className="secondary-action" onClick={() => onAction(() => internalApi.reopenOperationalIncident(incident.publicId))}>Reopen</button>
              <button type="button" className="secondary-action" onClick={() => onAction(() => internalApi.escalateOperationalIncident(incident.publicId))}>Escalate</button>
              <button
                type="button"
                className="secondary-action"
                disabled={!assignRole}
                onClick={() => onAction(() => internalApi.assignOperationalIncident(incident.publicId, assignRole))}
              >
                Assign
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={!noteDraft.trim()}
                onClick={() => onAction(() => internalApi.addOperationalIncidentNote(incident.publicId, noteDraft.trim()), () => setNoteDraft(""))}
              >
                Add note
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function NetworkOperationsPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [selectedStation, setSelectedStation] = useState(null)
  const [selectedIncident, setSelectedIncident] = useState(null)
  const [fieldVisitRequestStation, setFieldVisitRequestStation] = useState(null)
  const [fieldVisitReason, setFieldVisitReason] = useState("")
  const [assignRole, setAssignRole] = useState("")
  const [noteDraft, setNoteDraft] = useState("")

  const canManageIncidents = hasPermission("network:incident_manage")
  const canRunStationActions = hasPermission("network:station_action")
  const canExport = hasPermission("network:export")

  async function load() {
    setData(await internalApi.getNetworkOperations())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load network operations"))
  }, [])

  async function runAction(action, after = null) {
    try {
      setError("")
      await action()
      await load()
      if (typeof after === "function") after()
    } catch (err) {
      setError(err?.message || "Failed to update network operations")
    }
  }

  const stationRows = useMemo(() => {
    const items = data?.stationLiveStatus || []
    return items.filter((row) => {
      const textMatch = !query.trim() || `${row.stationName} ${row.city} ${row.region}`.toLowerCase().includes(query.trim().toLowerCase())
      const statusMatch = !statusFilter
        || (statusFilter === "OFFLINE" ? !row.isActive : statusFilter === "ACTIVE" ? row.isActive : statusFilter === "QUEUE_ALERT" ? row.queueDepth >= 5 : row.pumpsOffline > 0)
      return textMatch && statusMatch
    })
  }, [data?.stationLiveStatus, query, statusFilter])

  const incidentRows = data?.incidentQueue || []
  const telemetryRows = data?.telemetry || []
  const operationalTransactions = data?.operationalTransactions || []
  const stationHistory = data?.stationStatusHistory || []
  const stationMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "region", label: "Region" },
      { key: "queueDepth", label: "Queue Depth", render: (row) => formatNumber(row.queueDepth) },
      { key: "pumpsOffline", label: "Pumps Offline", render: (row) => formatNumber(row.pumpsOffline) },
      { key: "isActive", label: "Status", render: (row) => <StatusPill value={row.isActive ? "ACTIVE" : "OFFLINE"} /> },
      { key: "lastTransactionAt", label: "Last Transaction", render: (row) => formatDateTime(row.lastTransactionAt) },
    ],
    []
  )
  const incidentMetricColumns = useMemo(
    () => [
      { key: "title", label: "Incident" },
      { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "ownerRoleCode", label: "Owner" },
      { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    ],
    []
  )
  const assetMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "pumpPublicId", label: "Pump" },
      { key: "nozzlePublicId", label: "Nozzle" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status || row.telemetryStatus || "OPEN"} /> },
      { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt || row.createdAt) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Active Stations",
        value: formatNumber(data?.summary?.activeStations),
        drilldown: {
          title: "Active Stations",
          subtitle: "Stations currently operating and visible in the network.",
          rows: (data?.stationLiveStatus || []).filter((row) => Boolean(row.isActive)),
          columns: stationMetricColumns,
          emptyLabel: "No active stations found.",
          minWidth: 900,
        },
      },
      {
        label: "Offline Stations",
        value: formatNumber(data?.summary?.offlineStations),
        drilldown: {
          title: "Offline Stations",
          subtitle: "Stations currently marked offline in network operations.",
          rows: (data?.stationLiveStatus || []).filter((row) => !row.isActive),
          columns: stationMetricColumns,
          emptyLabel: "No offline stations found.",
          minWidth: 900,
        },
      },
      {
        label: "Offline Pumps",
        value: formatNumber(data?.summary?.offlinePumps),
        drilldown: {
          title: "Offline Pumps",
          subtitle: "Pump assets currently unavailable across the network.",
          rows: data?.offlinePumps || [],
          columns: assetMetricColumns,
          emptyLabel: "No offline pumps found.",
          minWidth: 860,
        },
      },
      {
        label: "Missing Telemetry",
        value: formatNumber(data?.summary?.missingTelemetry),
        drilldown: {
          title: "Missing Telemetry",
          subtitle: "Stations or assets missing expected telemetry updates.",
          rows: data?.missingTelemetry || [],
          columns: assetMetricColumns,
          emptyLabel: "No telemetry gaps found.",
          minWidth: 860,
        },
      },
      {
        label: "Open Incidents",
        value: formatNumber(data?.summary?.openOperationalIncidents),
        drilldown: {
          title: "Open Operational Incidents",
          subtitle: "Current network incidents awaiting action or resolution.",
          rows: incidentRows.filter((row) => String(row.status || "").toUpperCase() === "OPEN"),
          columns: incidentMetricColumns,
          emptyLabel: "No open operational incidents.",
          minWidth: 880,
        },
      },
    ],
    [assetMetricColumns, data?.missingTelemetry, data?.offlinePumps, data?.stationLiveStatus, data?.summary?.activeStations, data?.summary?.missingTelemetry, data?.summary?.offlinePumps, data?.summary?.offlineStations, data?.summary?.openOperationalIncidents, incidentMetricColumns, incidentRows, stationMetricColumns]
  )

  const selectedStationTelemetry = useMemo(
    () => telemetryRows.filter((row) => row.stationPublicId === selectedStation?.publicId),
    [selectedStation?.publicId, telemetryRows]
  )
  const selectedStationTransactions = useMemo(
    () => operationalTransactions.filter((row) => row.stationPublicId === selectedStation?.publicId),
    [operationalTransactions, selectedStation?.publicId]
  )
  const selectedStationHistory = useMemo(
    () => stationHistory.filter((row) => row.stationPublicId === selectedStation?.publicId),
    [selectedStation?.publicId, stationHistory]
  )

  function exportOperationalReport() {
    exportCsv(
      `network-operations-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Station", "Region", "State", "Queue Depth", "Pumps Offline", "Last Transaction"],
      stationRows.map((row) => [
        row.stationName,
        row.region,
        row.isActive ? "ACTIVE" : "OFFLINE",
        row.queueDepth,
        row.pumpsOffline,
        row.lastTransactionAt,
      ])
    )
  }

  function exportIncidentSummary() {
    exportCsv(
      `network-incidents-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Title", "Severity", "Status", "Station", "Assigned Role", "Created"],
      incidentRows.map((row) => [
        row.title,
        row.severity,
        row.status,
        row.stationName || row.region || "System",
        row.ownerRoleCode || "",
        row.createdAt,
      ])
    )
  }

  useEffect(() => {
    if (!selectedIncident) return
    setAssignRole(selectedIncident.ownerRoleCode || "")
    setNoteDraft("")
  }, [selectedIncident])

  useEffect(() => {
    if (!fieldVisitRequestStation) {
      setFieldVisitReason("")
    }
  }, [fieldVisitRequestStation])

  async function submitFieldVisitRequest() {
    const note = fieldVisitReason.trim()
    if (!fieldVisitRequestStation?.publicId || !note) return

    await runAction(
      () => internalApi.requestNetworkFieldVisit(fieldVisitRequestStation.publicId, note),
      () => {
        setFieldVisitRequestStation(null)
        setFieldVisitReason("")
      }
    )
  }

  const stationPreviewColumns = [
    { key: "stationName", label: "Station" },
    { key: "region", label: "Region" },
    { key: "isActive", label: "State", render: (row) => <StatusPill value={row.isActive ? "ACTIVE" : "OFFLINE"} /> },
    { key: "queueDepth", label: "Queue" },
    { key: "pumpsOffline", label: "Pumps Offline" },
    { key: "lastTransactionAt", label: "Last Transaction", render: (row) => formatDateTime(row.lastTransactionAt) },
  ]

  const stationModalColumns = [
    ...stationPreviewColumns,
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <div className="inline-action-group inline-action-group--row">
          <button type="button" className="secondary-action" onClick={() => setSelectedStation(row)}>Open</button>
          {canRunStationActions ? (
            <>
              <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.markStationNeedsReview(row.publicId))}>Needs review</button>
              <button type="button" className="secondary-action" onClick={() => setFieldVisitRequestStation(row)}>Field visit</button>
              <button type="button" className="secondary-action" onClick={() => runAction(() => internalApi.requestTechnicalInvestigation(row.publicId))}>Tech investigation</button>
            </>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <InternalShell title="Network Operations" alerts={error ? [{ id: "network-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar owner-filter-row">
        <input className="page-search" placeholder="Search station or region" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="page-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All station states</option>
          <option value="ACTIVE">Active</option>
          <option value="OFFLINE">Offline</option>
          <option value="QUEUE_ALERT">Queue Alert</option>
          <option value="OFFLINE_PUMPS">Offline Pumps</option>
        </select>
        {canExport ? <button type="button" className="secondary-action" onClick={exportOperationalReport}>Export ops report</button> : null}
        {canExport ? <button type="button" className="secondary-action" onClick={exportIncidentSummary}>Export incidents</button> : null}
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <div className="stack-grid">
          <PreviewTablePanel
            title="Station Live Status"
            subtitle="Operational view of network availability, queue pressure, and last activity."
            previewLimit={8}
            modalTitle="All Station Live Status"
            columns={stationPreviewColumns}
            modalColumns={stationModalColumns}
            rows={stationRows}
          />

          <PreviewTablePanel
            title="Operational Transactions"
            previewLimit={6}
            modalTitle="All Operational Transactions"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "pumpPublicId", label: "Pump" },
              { key: "totalAmount", label: "Amount", render: (row) => formatMoney(row.totalAmount) },
              { key: "litres", label: "Litres" },
              { key: "paymentMethod", label: "Method" },
              { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
            ]}
            rows={operationalTransactions}
          />

          <PreviewTablePanel
            title="Regional Incident Summary"
            previewLimit={6}
            modalTitle="Full Regional Incident Summary"
            columns={[
              { key: "region", label: "Region" },
              { key: "city", label: "City" },
              { key: "incidentCount", label: "Incidents" },
              { key: "openIncidents", label: "Open" },
              { key: "criticalIncidents", label: "Critical" },
            ]}
            rows={data?.regionalIncidentSummary || []}
          />
        </div>

        <div className="stack-grid">
          <PreviewTablePanel
            title="Incident Queue"
            previewLimit={6}
            modalTitle="All Operational Incidents"
            columns={[
              { key: "title", label: "Incident" },
              { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "stationName", label: "Station" },
              { key: "ownerRoleCode", label: "Assigned Role" },
              {
                key: "open",
                label: "Open",
                render: (row) => (
                  <button type="button" className="secondary-action" onClick={() => setSelectedIncident(row)}>
                    Open
                  </button>
                ),
              },
            ]}
            rows={incidentRows}
          />

          <PreviewTablePanel
            title="Pump Telemetry"
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="All Pump / Nozzle Telemetry"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "pumpPublicId", label: "Pump" },
              { key: "nozzlePublicId", label: "Nozzle" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
            ]}
            rows={telemetryRows}
          />

          <PreviewTablePanel
            title="Offline Pumps"
            previewLimit={5}
            compact
            minWidth={480}
            modalTitle="All Offline Pumps"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "pumpNumber", label: "Pump Number" },
              { key: "region", label: "Region" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            ]}
            rows={data?.offlinePumps || []}
          />

          <PreviewTablePanel
            title="Missing Telemetry"
            previewLimit={5}
            compact
            minWidth={480}
            modalTitle="All Missing Telemetry"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "pumpPublicId", label: "Pump" },
              { key: "nozzlePublicId", label: "Nozzle" },
              { key: "updatedAt", label: "Last Seen", render: (row) => formatDateTime(row.updatedAt) },
            ]}
            rows={data?.missingTelemetry || []}
          />

          <PreviewTablePanel
            title="Queue Alerts"
            previewLimit={5}
            compact
            minWidth={460}
            modalTitle="All Queue Alerts"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "region", label: "Region" },
              { key: "queueDepth", label: "Queue Depth" },
              { key: "pumpsOffline", label: "Offline Pumps" },
            ]}
            rows={data?.queueAlerts || []}
          />
        </div>
      </div>

      <StationDetailModal
        station={selectedStation}
        telemetry={selectedStationTelemetry}
        transactions={selectedStationTransactions}
        statusHistory={selectedStationHistory}
        onClose={() => setSelectedStation(null)}
      />

      <FieldVisitRequestModal
        station={fieldVisitRequestStation}
        reason={fieldVisitReason}
        setReason={setFieldVisitReason}
        onClose={() => setFieldVisitRequestStation(null)}
        onSubmit={submitFieldVisitRequest}
      />

      <IncidentDetailModal
        incident={selectedIncident}
        assignRole={assignRole}
        setAssignRole={setAssignRole}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        canManageIncidents={canManageIncidents}
        onClose={() => setSelectedIncident(null)}
        onAction={async (action, after = null) => {
          await runAction(action, after)
          const refreshed = await internalApi.getNetworkOperations()
          setData(refreshed)
          const nextIncident = (refreshed.incidentQueue || []).find((row) => row.publicId === selectedIncident?.publicId)
          setSelectedIncident(nextIncident || null)
        }}
      />
    </InternalShell>
  )
}

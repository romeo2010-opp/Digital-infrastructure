import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

function downloadAuditCsv(rows) {
  const headers = ["Public ID", "Actor", "Role", "Action", "Target Type", "Target ID", "Severity", "Summary", "Created At", "Metadata"]
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) =>
      [
        row.publicId,
        row.actorName,
        row.actorRoleCode,
        row.actionType,
        row.targetType,
        row.targetPublicId,
        row.severity,
        row.summary,
        row.createdAt,
        JSON.stringify(row.metadata || {}),
      ]
        .map(escapeCell)
        .join(",")
    ),
  ]

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `internal-audit-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function AuditEventModal({ event, onClose }) {
  if (!event) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Audit event details" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Audit Event</h3>
            <p>Actor, target, and metadata for the selected change.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Actor</span><strong>{event.actorName || "System"}</strong></div>
            <div><span>Role</span><strong>{event.actorRoleCode || "-"}</strong></div>
            <div><span>Action</span><strong>{event.actionType || "-"}</strong></div>
            <div><span>Severity</span><strong>{event.severity || "-"}</strong></div>
            <div><span>Target Type</span><strong>{event.targetType || "-"}</strong></div>
            <div><span>Target ID</span><strong>{event.targetPublicId || "-"}</strong></div>
            <div><span>Timestamp</span><strong>{formatDateTime(event.createdAt)}</strong></div>
            <div><span>Event ID</span><strong>{event.publicId || "-"}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Summary</span>
            <strong>{event.summary || "-"}</strong>
          </div>

          <div className="admin-detail-block">
            <span>Change metadata</span>
            <pre className="admin-json-block">{JSON.stringify(event.metadata || {}, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuditLogsPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [actorFilter, setActorFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(() => {
    internalApi.getAuditLogs().then(setData).catch((err) => setError(err?.message || "Failed to load audit logs"))
  }, [])

  const actorOptions = useMemo(
    () => [...new Set((data?.items || []).map((row) => row.actorName).filter(Boolean))].sort(),
    [data]
  )
  const actionOptions = useMemo(
    () => [...new Set((data?.items || []).map((row) => row.actionType).filter(Boolean))].sort(),
    [data]
  )
  const severityOptions = useMemo(
    () => [...new Set((data?.items || []).map((row) => row.severity).filter(Boolean))],
    [data]
  )

  const rows = useMemo(() => {
    const items = data?.items || []
    return items.filter((row) => {
      const textMatches = !query.trim()
        || `${row.actorName} ${row.actionType} ${row.targetType} ${row.summary} ${row.targetPublicId}`.toLowerCase().includes(query.trim().toLowerCase())
      const actorMatches = !actorFilter || row.actorName === actorFilter
      const actionMatches = !actionFilter || row.actionType === actionFilter
      const severityMatches = !severityFilter || row.severity === severityFilter
      return textMatches && actorMatches && actionMatches && severityMatches
    })
  }, [actionFilter, actorFilter, data, query, severityFilter])
  const auditColumns = useMemo(
    () => [
      { key: "publicId", label: "Event ID" },
      { key: "actorName", label: "Actor" },
      { key: "actionType", label: "Action" },
      { key: "targetType", label: "Target Type" },
      { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
      { key: "createdAt", label: "Timestamp", render: (row) => formatDateTime(row.createdAt) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Total Events",
        value: formatNumber(data?.summary?.totalEvents),
        drilldown: {
          title: "All Audit Events",
          subtitle: "Full audit stream for the current internal filters.",
          rows,
          columns: auditColumns,
          emptyLabel: "No audit events found.",
          minWidth: 940,
          onRowClick: (row) => setSelectedEvent(row),
        },
      },
      {
        label: "Critical Events",
        value: formatNumber(data?.summary?.criticalEvents),
        drilldown: {
          title: "Critical Audit Events",
          subtitle: "Highest-severity audit events requiring attention.",
          rows: rows.filter((row) => String(row.severity || "").toUpperCase() === "CRITICAL"),
          columns: auditColumns,
          emptyLabel: "No critical audit events found.",
          minWidth: 940,
          onRowClick: (row) => setSelectedEvent(row),
        },
      },
      {
        label: "High Severity Events",
        value: formatNumber(data?.summary?.highEvents),
        drilldown: {
          title: "High Severity Audit Events",
          subtitle: "High-priority audit events in the current filtered stream.",
          rows: rows.filter((row) => ["HIGH", "CRITICAL"].includes(String(row.severity || "").toUpperCase())),
          columns: auditColumns,
          emptyLabel: "No high severity audit events found.",
          minWidth: 940,
          onRowClick: (row) => setSelectedEvent(row),
        },
      },
      {
        label: "Filtered",
        value: formatNumber(rows.length),
        drilldown: {
          title: "Filtered Audit Events",
          subtitle: "Audit events matching the current actor, action, severity, and text filters.",
          rows,
          columns: auditColumns,
          emptyLabel: "No filtered audit events found.",
          minWidth: 940,
          onRowClick: (row) => setSelectedEvent(row),
        },
      },
    ],
    [auditColumns, data?.summary?.criticalEvents, data?.summary?.highEvents, data?.summary?.totalEvents, rows]
  )

  return (
    <InternalShell title="Audit Logs" alerts={error ? [{ id: "audit-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar owner-filter-row">
        <input className="page-search" placeholder="Search actor, action, target, or summary" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="page-select" value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
          <option value="">All actors</option>
          {actorOptions.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
        </select>
        <select className="page-select" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
          <option value="">All actions</option>
          {actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}
        </select>
        <select className="page-select" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
          <option value="">All severities</option>
          {severityOptions.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </select>
      </div>

      <MetricGrid items={metricItems} />

      <PreviewTablePanel
        title="Audit Event Stream"
        previewLimit={8}
        modalTitle="All Audit Events"
        actions={
          hasPermission("audit:export") ? (
            <button type="button" className="secondary-action" onClick={() => downloadAuditCsv(rows)}>
              Export CSV
            </button>
          ) : null
        }
        columns={[
          { key: "actorName", label: "Actor" },
          { key: "actionType", label: "Action" },
          { key: "targetType", label: "Target Type" },
          { key: "targetPublicId", label: "Target ID" },
          { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
          { key: "createdAt", label: "Timestamp", render: (row) => formatDateTime(row.createdAt) },
          {
            key: "open",
            label: "Event",
            render: (row) => (
              <button type="button" className="secondary-action" onClick={() => setSelectedEvent(row)}>
                Open
              </button>
            ),
          },
        ]}
        rows={rows}
      />

      <AuditEventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </InternalShell>
  )
}

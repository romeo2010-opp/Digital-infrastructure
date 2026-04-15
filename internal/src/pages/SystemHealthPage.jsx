import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import InternalShell from "../components/InternalShell"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import { Panel } from "../components/PanelTable"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatNumber } from "../utils/display"

function SecurityEventModal({
  event,
  canOpenDetail,
  canUseEngineeringTools,
  onClose,
  onAcknowledge,
  onCreateBugNote,
  onLinkIncident,
}) {
  const [bugNote, setBugNote] = useState("")
  const [incidentPublicId, setIncidentPublicId] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setBugNote("")
    setIncidentPublicId("")
    setError("")
    setWorking(false)
  }, [event?.publicId])

  if (!event) return null

  async function run(action) {
    try {
      setWorking(true)
      setError("")
      await action()
      setBugNote("")
      setIncidentPublicId("")
    } catch (err) {
      setError(err?.message || "Failed to update engineering workflow")
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Security event details" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Debug Event Detail</h3>
            <p>Engineering review surface for stack trace, request signals, bug notes, and incident links.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Service</span><strong>{event.serviceKey || "-"}</strong></div>
            <div><span>Environment</span><strong>{event.environmentKey || "-"}</strong></div>
            <div><span>Severity</span><strong>{event.severity || "-"}</strong></div>
            <div><span>Status</span><strong>{event.status || "-"}</strong></div>
            <div><span>Source</span><strong>{event.sourceKey || "-"}</strong></div>
            <div><span>Event ID</span><strong>{event.publicId || "-"}</strong></div>
            <div><span>Created</span><strong>{formatDateTime(event.createdAt)}</strong></div>
            <div><span>Resolved</span><strong>{formatDateTime(event.resolvedAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Summary</span>
            <strong>{event.summary || "-"}</strong>
          </div>

          {canOpenDetail ? (
            <div className="admin-detail-block">
              <span>Stack trace / detail</span>
              <pre className="admin-json-block">{event.detail || "No additional detail recorded."}</pre>
            </div>
          ) : null}

          <div className="settings-summary-list admin-detail-grid">
            <div><span>Linked incident</span><strong>{event.linkedIncidentPublicId || "Not linked"}</strong></div>
            <div><span>Bug notes</span><strong>{formatNumber((event.bugNotes || []).length)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Engineering notes</span>
            <strong>
              {(event.bugNotes || []).length
                ? event.bugNotes.map((note) => `${formatDateTime(note.createdAt)} · ${note.note || note.summary}`).join("\n")
                : "No engineering notes recorded."}
            </strong>
          </div>

          {canUseEngineeringTools ? (
            <div className="settings-form-card">
              {error ? <p className="settings-error">{error}</p> : null}
              <div className="settings-profile-grid">
                <label className="settings-form-field">
                  <span>Create bug note</span>
                  <textarea rows={4} value={bugNote} onChange={(eventChange) => setBugNote(eventChange.target.value)} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Link incident public ID</span>
                  <input value={incidentPublicId} onChange={(eventChange) => setIncidentPublicId(eventChange.target.value)} disabled={working} />
                </label>
              </div>
              <div className="settings-form-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={working || !bugNote.trim()}
                  onClick={() => run(() => onCreateBugNote(event.publicId, bugNote.trim()))}
                >
                  Create Bug Note
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={working || !incidentPublicId.trim()}
                  onClick={() => run(() => onLinkIncident(event.publicId, incidentPublicId.trim()))}
                >
                  Link Incident to Error
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={working || event.status === "ACKNOWLEDGED" || event.status === "RESOLVED"}
                  onClick={() => run(() => onAcknowledge(event.publicId))}
                >
                  Mark Bug Acknowledged
                </button>
                <button type="button" className="secondary-action" disabled title="Retry pipeline is not exposed in this architecture yet">
                  Retry Failed Job
                </button>
                <button type="button" className="secondary-action" disabled title="Impersonation is not available in production engineering flows">
                  Impersonation Request
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function SystemHealthPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [selectedEvent, setSelectedEvent] = useState(null)
  const canUseEngineeringTools = hasPermission("engineering.logs:view")
  const canOpenDetail = hasPermission("security:event_detail")

  async function load() {
    setData(await internalApi.getSystemHealth())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load system health"))
  }, [])

  async function runAction(action) {
    try {
      setError("")
      await action()
      const refreshed = await internalApi.getSystemHealth()
      setData(refreshed)
      if (selectedEvent?.publicId) {
        const nextEvent = (refreshed.events || []).find((row) => row.publicId === selectedEvent.publicId) || null
        setSelectedEvent(nextEvent)
      }
    } catch (err) {
      setError(err?.message || "Failed to update engineering action")
      throw err
    }
  }

  const engineeringAuditRows = useMemo(() => data?.engineeringAudit || [], [data])
  const serviceColumns = useMemo(
    () => [
      { key: "service", label: "Service" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "detail", label: "Detail" },
    ],
    []
  )
  const eventColumns = useMemo(
    () => [
      { key: "serviceKey", label: "Service" },
      { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
      { key: "status", label: "State", render: (row) => <StatusPill value={row.status} /> },
      { key: "summary", label: "Summary" },
      { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Queued Events (24h)",
        value: formatNumber(data?.summary?.queuedEvents24h),
        drilldown: {
          title: "Queued Events In The Last 24 Hours",
          subtitle: "Recent system health events entering the internal engineering stream.",
          rows: data?.events || [],
          columns: eventColumns,
          emptyLabel: "No queued events found.",
          minWidth: 860,
        },
      },
      {
        label: "Internal Sessions",
        value: formatNumber(data?.summary?.activeInternalSessions),
        drilldown: {
          title: "Active Internal Sessions",
          subtitle: "Current internal session footprint and deployment context.",
          content: (
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Active Internal Sessions</span><strong>{formatNumber(data?.summary?.activeInternalSessions)}</strong></div>
              <div><span>Environment</span><strong>{data?.deployment?.environment || "-"}</strong></div>
              <div><span>API Health</span><strong>{data?.debugTools?.apiHealth || "-"}</strong></div>
              <div><span>Request Log Access</span><strong>{formatNumber(data?.debugTools?.requestLogAccess)}</strong></div>
            </div>
          ),
        },
      },
      {
        label: "Ingest Lag (min)",
        value: formatNumber(data?.summary?.transactionIngestLagMinutes),
        drilldown: {
          title: "Transaction Ingest Lag",
          subtitle: "Current ingestion lag paired with service health signals.",
          content: (
            <div className="stack-grid">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>Current Lag</span><strong>{formatNumber(data?.summary?.transactionIngestLagMinutes)} min</strong></div>
                <div><span>Queued Events (24h)</span><strong>{formatNumber(data?.summary?.queuedEvents24h)}</strong></div>
                <div><span>Environment</span><strong>{data?.deployment?.environment || "-"}</strong></div>
              </div>
              <DataTable columns={serviceColumns} rows={data?.services || []} emptyLabel="No service health rows." compact minWidth={640} />
            </div>
          ),
        },
      },
      {
        label: "Degraded Services",
        value: formatNumber(data?.summary?.degradedServices),
        drilldown: {
          title: "Degraded Services",
          subtitle: "Services currently outside a healthy state.",
          rows: (data?.services || []).filter((row) => row.status !== "healthy"),
          columns: serviceColumns,
          emptyLabel: "No degraded services found.",
          minWidth: 720,
        },
      },
      {
        label: "Error Logs",
        value: formatNumber((data?.errorLogs || []).length),
        drilldown: {
          title: "Error Logs",
          subtitle: "Critical and high-severity engineering logs.",
          rows: data?.errorLogs || [],
          columns: eventColumns,
          emptyLabel: "No error logs found.",
          minWidth: 860,
        },
      },
      {
        label: "Failed Jobs",
        value: formatNumber((data?.failedJobs || []).length),
        drilldown: {
          title: "Failed Jobs",
          subtitle: "System events associated with failed job, queue, or worker activity.",
          rows: data?.failedJobs || [],
          columns: eventColumns,
          emptyLabel: "No failed jobs found.",
          minWidth: 860,
        },
      },
    ],
    [data, eventColumns, serviceColumns]
  )

  return (
    <InternalShell title="System Health" alerts={error ? [{ id: "health-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="API Health"
          subtitle="Read-only service health and deployment-facing technical signals."
          previewLimit={6}
          modalTitle="All Service Status"
          columns={[
            { key: "service", label: "Service" },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            { key: "detail", label: "Detail" },
          ]}
          rows={data?.services || []}
        />

        <div className="stack-grid">
          <PreviewTablePanel
            title="Recent Debug Events"
            subtitle="Engineering-facing event stream with stack traces and request details."
            previewLimit={5}
            compact
            minWidth={520}
            modalTitle="All Recent Debug Events"
            columns={[
              { key: "serviceKey", label: "Service" },
              { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
              { key: "status", label: "State", render: (row) => <StatusPill value={row.status} /> },
              { key: "summary", label: "Summary" },
              { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
              {
                key: "details",
                label: "Details",
                render: (row) =>
                  canOpenDetail ? (
                    <button type="button" className="secondary-action" onClick={() => setSelectedEvent(row)}>
                      Open
                    </button>
                  ) : (
                    "-"
                  ),
              },
            ]}
            rows={data?.events || []}
          />

          <Panel title="Deployment History" subtitle="Read-only deployment and environment context for engineering diagnosis.">
            <div className="settings-summary-list admin-detail-grid">
              {(data?.deploymentHistory || []).map((item, index) => (
                <div key={`${item.environment}-${index}`}>
                  <span>{item.environment}</span>
                  <strong>{item.version} · {formatDateTime(item.deployedAt)} · {item.apiHealth}</strong>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {canUseEngineeringTools ? (
        <>
          <div className="internal-page-grid internal-page-grid--two-thirds">
            <PreviewTablePanel
              title="Error Logs"
              subtitle="Critical and high-severity engineering logs."
              previewLimit={6}
              modalTitle="All Error Logs"
              columns={[
                { key: "serviceKey", label: "Service" },
                { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
                { key: "summary", label: "Summary" },
                { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
                { key: "open", label: "Open", render: (row) => <button type="button" className="secondary-action" onClick={() => setSelectedEvent(row)}>Open</button> },
              ]}
              rows={data?.errorLogs || []}
            />

            <div className="stack-grid">
              <PreviewTablePanel
                title="Request Logs"
                subtitle="Request-path and sync related technical events."
                previewLimit={5}
                compact
                modalTitle="All Request Logs"
                columns={[
                  { key: "serviceKey", label: "Service" },
                  { key: "sourceKey", label: "Source" },
                  { key: "summary", label: "Summary" },
                  { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
                ]}
                rows={data?.requestLogs || []}
              />

              <PreviewTablePanel
                title="Failed Jobs"
                subtitle="Job, worker, queue, and retry-related technical failures."
                previewLimit={5}
                compact
                modalTitle="All Failed Jobs"
                columns={[
                  { key: "serviceKey", label: "Service" },
                  { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
                  { key: "summary", label: "Summary" },
                  { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
                ]}
                rows={data?.failedJobs || []}
              />
            </div>
          </div>

          <div className="internal-page-grid internal-page-grid--two-thirds">
            <Panel title="Debug Tools" subtitle="Read-only technical capabilities exposed to the engineering debug role.">
              <div className="snapshot-stat-grid">
                <div><span>Error logs</span><strong>{formatNumber(data?.debugTools?.errorLogAccess)}</strong></div>
                <div><span>Request logs</span><strong>{formatNumber(data?.debugTools?.requestLogAccess)}</strong></div>
                <div><span>Failed jobs</span><strong>{formatNumber(data?.debugTools?.failedJobs)}</strong></div>
                <div><span>Stack traces</span><strong>{formatNumber(data?.debugTools?.stackTraceAvailable)}</strong></div>
                <div><span>API health</span><strong>{data?.debugTools?.apiHealth || "-"}</strong></div>
              </div>
            </Panel>

            <div className="stack-grid">
              <Panel title="Staging Tools" subtitle="Safe technical configuration surfaces for debugging workflows.">
                <div className="settings-summary-list admin-detail-grid">
                  <div><span>Environment</span><strong>{data?.stagingTools?.environment || "-"}</strong></div>
                  <div><span>Quick tunnel host</span><strong>{data?.stagingTools?.quickTunnelHost ? "Enabled" : "Disabled"}</strong></div>
                  <div><span>Internal access policy</span><strong>{data?.stagingTools?.internalAccessPolicy || "-"}</strong></div>
                  <div><span>Emergency override</span><strong>{data?.stagingTools?.emergencyOverrideEnabled ? "Enabled" : "Disabled"}</strong></div>
                </div>
              </Panel>

              <PreviewTablePanel
                title="Limited Audit Surface"
                subtitle="Engineering-only bug notes and incident links for system health events."
                previewLimit={5}
                compact
                modalTitle="Engineering Audit Surface"
                columns={[
                  { key: "actionType", label: "Action" },
                  { key: "summary", label: "Summary" },
                  { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
                  { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
                ]}
                rows={engineeringAuditRows}
              />
            </div>
          </div>
        </>
      ) : null}

      <SecurityEventModal
        event={selectedEvent}
        canOpenDetail={canOpenDetail}
        canUseEngineeringTools={canUseEngineeringTools}
        onClose={() => setSelectedEvent(null)}
        onAcknowledge={(eventPublicId) => runAction(() => internalApi.acknowledgeSystemHealthEvent(eventPublicId))}
        onCreateBugNote={(eventPublicId, note) => runAction(() => internalApi.createSystemHealthBugNote(eventPublicId, note))}
        onLinkIncident={(eventPublicId, incidentPublicId) =>
          runAction(() => internalApi.linkIncidentToSystemHealthEvent(eventPublicId, incidentPublicId))
        }
      />
    </InternalShell>
  )
}

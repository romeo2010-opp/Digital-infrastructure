import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { Panel } from "../components/PanelTable"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

function OnboardingDetailModal({ record, canManageOnboarding, canActivateStation, onAction, onClose }) {
  useEffect(() => {
    if (!record) return undefined

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [record, onClose])

  if (!record) return null

  const pendingItems = record.pendingChecklistItems || []
  const checklistComplete = pendingItems.length === 0

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Onboarding record detail" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{record.stationName}</h3>
            <p>Station onboarding review, checklist visibility, and activation controls.</p>
          </div>
          <div className="internal-modal-header-actions">
            <StatusPill value={record.status} />
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Operator</span><strong>{record.operatorName || "Not set"}</strong></div>
            <div><span>Region</span><strong>{record.region}</strong></div>
            <div><span>Assigned user</span><strong>{record.assignedUserName || "Unassigned"}</strong></div>
            <div><span>Evidence uploads</span><strong>{formatNumber(record.evidenceCount)}</strong></div>
            <div><span>Created</span><strong>{formatDateTime(record.createdAt)}</strong></div>
            <div><span>Updated</span><strong>{formatDateTime(record.updatedAt)}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Pending onboarding checklist</span>
            {pendingItems.length ? (
              <div className="timeline-list">
                {pendingItems.map((item) => (
                  <article key={item} className="timeline-item">
                    <div>
                      <strong>{item.replace(/_/g, " ")}</strong>
                      <p>Still requires completion before activation can be fully cleared.</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <strong>All checklist items are currently complete.</strong>
            )}
          </div>

          <div className="admin-detail-block">
            <span>Notes</span>
            <strong>{record.notes || "No onboarding notes recorded."}</strong>
          </div>

          <div className="admin-detail-block">
            <span>Workflow actions</span>
            <div className="inline-action-group inline-action-group--row">
              {canManageOnboarding ? (
                <>
                  {record.status !== "READY_FOR_ACTIVATION" && record.status !== "ACTIVATED" && checklistComplete ? (
                    <button type="button" className="secondary-action" onClick={() => onAction(record.publicId, "APPROVE_READINESS")}>Approve readiness</button>
                  ) : null}
                  {record.status !== "REVIEW" ? (
                    <button type="button" className="secondary-action" onClick={() => onAction(record.publicId, "RETURN_FOR_CORRECTION")}>Return for correction</button>
                  ) : null}
                  {record.status !== "SUBMITTED" ? (
                    <button type="button" className="secondary-action" onClick={() => onAction(record.publicId, "MARK_INCOMPLETE")}>Mark incomplete</button>
                  ) : null}
                  {record.status !== "REVIEW" ? (
                    <button type="button" className="secondary-action" onClick={() => onAction(record.publicId, "MARK_VERIFICATION_PENDING")}>Mark verification pending</button>
                  ) : null}
                </>
              ) : null}
              {canActivateStation && record.stationPublicId && record.status === "READY_FOR_ACTIVATION" && checklistComplete ? (
                <button type="button" className="secondary-action" onClick={() => onAction(record.publicId, "ACTIVATE_STATION")}>Activate station</button>
              ) : null}
              {(canManageOnboarding || canActivateStation) && !checklistComplete ? (
                <strong>Checklist completion is required before readiness approval or activation.</strong>
              ) : null}
              {!canManageOnboarding && !(canActivateStation && record.stationPublicId && record.status === "READY_FOR_ACTIVATION") ? (
                <strong>No onboarding actions available for your role.</strong>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StationOnboardingPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [selectedRecordId, setSelectedRecordId] = useState(null)

  async function load() {
    setData(await internalApi.getOnboarding())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load onboarding workflow"))
  }, [])

  async function runAction(onboardingPublicId, action) {
    try {
      setError("")
      await internalApi.updateOnboardingWorkflow(onboardingPublicId, action)
      await load()
    } catch (err) {
      setError(err?.message || "Failed to update onboarding workflow")
    }
  }

  const rows = useMemo(() => {
    const items = data?.items || []
    if (statusFilter === "ALL") return items
    return items.filter((row) => row.status === statusFilter)
  }, [data, statusFilter])

  const selectedRecord = useMemo(
    () => (data?.items || []).find((row) => row.publicId === selectedRecordId) || null,
    [data?.items, selectedRecordId]
  )
  const onboardingMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "operatorName", label: "Operator" },
      { key: "region", label: "Region" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "pendingChecklistItems", label: "Pending Checklist", render: (row) => row.pendingChecklistItems?.join(", ") || "-" },
      { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Total Records",
        value: formatNumber(data?.summary?.total),
        drilldown: {
          title: "All Onboarding Records",
          subtitle: "Every onboarding workflow record currently tracked.",
          rows: data?.items || [],
          columns: onboardingMetricColumns,
          emptyLabel: "No onboarding records found.",
          minWidth: 860,
        },
      },
      {
        label: "Ready for Activation",
        value: formatNumber(data?.summary?.readyForActivation),
        drilldown: {
          title: "Ready For Activation",
          subtitle: "Stations that have passed onboarding and are ready to activate.",
          rows: (data?.items || []).filter((row) => row.status === "READY_FOR_ACTIVATION"),
          columns: onboardingMetricColumns,
          emptyLabel: "No onboarding records are ready for activation.",
          minWidth: 860,
        },
      },
      {
        label: "Awaiting Assignment",
        value: formatNumber(data?.summary?.awaitingManagerAssignment),
        drilldown: {
          title: "Awaiting Manager Assignment",
          subtitle: "Stations still waiting for staff assignment in onboarding.",
          rows: (data?.items || []).filter((row) => row.pendingChecklistItems?.includes("STAFF_ASSIGNMENTS")),
          columns: onboardingMetricColumns,
          emptyLabel: "No onboarding records are waiting for staff assignment.",
          minWidth: 860,
        },
      },
      {
        label: "Delayed",
        value: formatNumber(data?.summary?.delayedItems),
        drilldown: {
          title: "Delayed Onboarding Items",
          subtitle: "Onboarding records delayed beyond the expected review window.",
          rows: data?.delayedItems || [],
          columns: onboardingMetricColumns,
          emptyLabel: "No delayed onboarding items.",
          minWidth: 860,
        },
      },
    ],
    [data, onboardingMetricColumns]
  )

  const canManageOnboarding = hasPermission("onboarding:manage")
  const canActivateStation = hasPermission("stations:activate")

  return (
    <InternalShell title="Station Onboarding" alerts={error ? [{ id: "onboarding-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar">
        <select className="page-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="REVIEW">Review</option>
          <option value="READY_FOR_ACTIVATION">Ready for activation</option>
          <option value="ACTIVATED">Activated</option>
        </select>
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="Onboarding Workflow"
          previewLimit={8}
          modalTitle="All Onboarding Workflow Records"
          columns={[
            {
              key: "stationName",
              label: "Station",
              render: (row) => (
                <button type="button" className="secondary-action" onClick={() => setSelectedRecordId(row.publicId)}>
                  {row.stationName}
                </button>
              ),
            },
            { key: "operatorName", label: "Operator" },
            { key: "region", label: "Region" },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            { key: "pendingChecklistItems", label: "Pending Checklist", render: (row) => row.pendingChecklistItems?.join(", ") || "-" },
            { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" onClick={() => setSelectedRecordId(row.publicId)}>Open</button>
                  {canManageOnboarding && row.status !== "READY_FOR_ACTIVATION" && row.status !== "ACTIVATED" && !(row.pendingChecklistItems?.length) ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(row.publicId, "APPROVE_READINESS")}>Ready</button>
                  ) : null}
                  {canActivateStation && row.stationPublicId && row.status === "READY_FOR_ACTIVATION" && !(row.pendingChecklistItems?.length) ? (
                    <button type="button" className="secondary-action" onClick={() => runAction(row.publicId, "ACTIVATE_STATION")}>Activate</button>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={rows}
        />

        <div className="stack-grid">
          <Panel title="Delayed Items">
            <div className="timeline-list">
              {(data?.delayedItems || []).map((row) => (
                <article key={row.publicId} className="timeline-item">
                  <div>
                    <strong>{row.stationName}</strong>
                    <p>{row.pendingChecklistItems?.join(", ") || "Checklist pending"}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={row.status} />
                    <span>{row.delayedHours}h delayed</span>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <OnboardingDetailModal
        record={selectedRecord}
        canManageOnboarding={canManageOnboarding}
        canActivateStation={canActivateStation}
        onAction={runAction}
        onClose={() => setSelectedRecordId(null)}
      />
    </InternalShell>
  )
}

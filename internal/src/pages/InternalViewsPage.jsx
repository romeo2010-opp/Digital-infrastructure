import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { BarChart3, Copy, Eye, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import InternalShell from "../components/InternalShell"
import MetricGrid from "../components/MetricGrid"
import PreviewTablePanel from "../components/PreviewTablePanel"
import StatusPill from "../components/StatusPill"
import {
  INTERNAL_MAX_CUSTOM_VIEWS,
  INTERNAL_VIEW_BUILDER_EVENT,
  INTERNAL_VIEW_CHANGE_EVENT,
  cloneInternalBlocks,
  createInternalViewId,
  getVisibleInternalBuiltinViews,
  internalViewBlockLibrary,
  internalViewColorPresets,
  normalizeInternalCustomView,
  pathForInternalView,
  readInternalViewState,
  saveInternalViewState,
  uniqueInternalViewLabel,
} from "../views/internalViews"
import { formatDateTime, formatNumber } from "../utils/display"

function readViews() {
  return readInternalViewState().customViews
}

function blockType(block) {
  return typeof block === "string" ? block : block?.type
}

function blockTitle(block, fallback) {
  return String(typeof block === "object" && block?.title ? block.title : fallback)
}

function blockAccent(block) {
  const preset = typeof block === "object" ? block.colorPreset : "slate"
  return internalViewColorPresets[preset]?.accent || internalViewColorPresets.slate.accent
}

function libraryItemFor(block) {
  const type = blockType(block)
  return internalViewBlockLibrary.find((item) => item.type === type) || null
}

function metricForBlock(block, data) {
  const type = blockType(block)
  const libraryItem = libraryItemFor(block)
  const title = blockTitle(block, libraryItem?.title || "Internal Block")
  const accent = blockAccent(block)
  const modalKey = `${type || "block"}-${typeof block === "object" ? block.id : title}`

  if (type === "overview-kpis") {
    const summary = data.overview?.summary || data.overview || {}
    const value = summary.openTasks || summary.activeIncidents || summary.totalEvents || 0
    return {
      label: title,
      value: formatNumber(value),
      helper: "workspace signal",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(value),
        content: <pre className="admin-json-block">{JSON.stringify(summary, null, 2)}</pre>,
      },
    }
  }

  if (type === "network-incidents") {
    const rows = data.networkOperations?.incidentQueue || []
    const summary = data.networkOperations?.summary || {}
    return {
      label: title,
      value: formatNumber(summary.openOperationalIncidents || rows.filter((row) => String(row.status || "").toUpperCase() === "OPEN").length),
      helper: "open incidents",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "title", label: "Incident" },
          { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "ownerRoleCode", label: "Owner" },
          { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
        ],
      },
    }
  }

  if (type === "station-summary") {
    const rows = data.stations?.items || []
    return {
      label: title,
      value: formatNumber(data.stations?.summary?.totalStations || rows.length),
      helper: "registry rows",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "name", label: "Station" },
          { key: "city", label: "City" },
          { key: "subscription_status", label: "Subscription", render: (row) => <StatusPill value={row.subscription_status} /> },
          { key: "last_transaction_at", label: "Last Transaction", render: (row) => formatDateTime(row.last_transaction_at) },
        ],
      },
    }
  }

  if (type === "field-operations") {
    const rows = data.fieldOperations?.items || []
    const summary = data.fieldOperations?.summary || {}
    return {
      label: title,
      value: formatNumber(summary.scheduled || summary.inProgress || summary.blocked || rows.length),
      helper: "field work",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "publicId", label: "Visit" },
          { key: "stationName", label: "Station" },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "scheduledFor", label: "Scheduled", render: (row) => formatDateTime(row.scheduledFor) },
        ],
      },
    }
  }

  if (type === "support-queue") {
    const rows = data.support?.cases || data.support?.items || []
    return {
      label: title,
      value: formatNumber(data.support?.summary?.openCases || rows.length),
      helper: "service work",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "public_id", label: "Case", render: (row) => row.public_id || row.publicId },
          { key: "subject", label: "Subject", render: (row) => row.subject || row.title },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "created_at", label: "Created", render: (row) => formatDateTime(row.created_at || row.createdAt) },
        ],
      },
    }
  }

  if (type === "finance-watch") {
    const rows = data.finance?.settlements || data.finance?.transactions || []
    const summary = data.finance?.summary || {}
    return {
      label: title,
      value: formatNumber(summary.payoutBatchesPending || summary.flaggedSettlementBatches || summary.refundRequestsPending || rows.length),
      helper: "finance work",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "publicId", label: "Record" },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "amountMwk", label: "Amount" },
          { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt || row.created_at) },
        ],
      },
    }
  }

  if (type === "risk-watch") {
    const rows = data.risk?.cases || data.risk?.alerts || []
    return {
      label: title,
      value: formatNumber(data.risk?.summary?.openCases || rows.length),
      helper: "review signals",
      accent,
      modalKey,
      drilldown: {
        title,
        value: formatNumber(rows.length),
        rows,
        columns: [
          { key: "publicId", label: "Case" },
          { key: "category", label: "Category" },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity} /> },
        ],
      },
    }
  }

  const rows = data.systemHealth?.events || data.systemHealth?.items || []
  return {
    label: title,
    value: formatNumber(data.systemHealth?.summary?.degradedServices || rows.length),
    helper: "platform health",
    accent,
    modalKey,
    drilldown: {
      title,
      value: formatNumber(rows.length),
      rows,
      columns: [
        { key: "service", label: "Service" },
        { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
        { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt || row.created_at) },
      ],
    },
  }
}

export default function InternalViewsPage() {
  const { viewId } = useParams()
  const navigate = useNavigate()
  const { session } = useInternalAuth()
  const [views, setViews] = useState(() => readViews())
  const [data, setData] = useState({})
  const [error, setError] = useState("")
  const builtinViews = useMemo(
    () => getVisibleInternalBuiltinViews(session?.profile?.navigation || []),
    [session?.profile?.navigation],
  )
  const allViews = useMemo(() => [...builtinViews, ...views], [builtinViews, views])

  useEffect(() => {
    const refreshViews = () => setViews(readViews())
    window.addEventListener("storage", refreshViews)
    window.addEventListener(INTERNAL_VIEW_CHANGE_EVENT, refreshViews)
    window.addEventListener("smartlink:internal-dashboard-refresh", refreshViews)
    return () => {
      window.removeEventListener("storage", refreshViews)
      window.removeEventListener(INTERNAL_VIEW_CHANGE_EVENT, refreshViews)
      window.removeEventListener("smartlink:internal-dashboard-refresh", refreshViews)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    Promise.allSettled([
      internalApi.getOverview(),
      internalApi.getNetworkOperations(),
      internalApi.getStations(),
      internalApi.getFieldOperations(),
      internalApi.getSupport(),
      internalApi.getFinance(),
      internalApi.getRisk(),
      internalApi.getSystemHealth(),
    ]).then((results) => {
      if (disposed) return
      const [overview, networkOperations, stations, fieldOperations, support, finance, risk, systemHealth] = results.map((result) => result.status === "fulfilled" ? result.value : null)
      setData({ overview, networkOperations, stations, fieldOperations, support, finance, risk, systemHealth })
      const rejected = results.find((result) => result.status === "rejected")
      if (rejected) setError(rejected.reason?.message || "Some view data could not be loaded")
    })
    return () => {
      disposed = true
    }
  }, [])

  const activeView = allViews.find((view) => view.id === viewId) || null
  const metrics = useMemo(() => (activeView?.blocks || []).map((block) => metricForBlock(block, data)), [activeView, data])

  function persistCustomViews(nextViews) {
    const current = readInternalViewState()
    const saved = saveInternalViewState({ ...current, customViews: nextViews })
    setViews(saved.customViews)
    return saved.customViews
  }

  function openCreateView() {
    window.dispatchEvent(new CustomEvent(INTERNAL_VIEW_BUILDER_EVENT, { detail: { mode: "create" } }))
  }

  function openEditView(view) {
    if (!view || view.kind !== "custom") return
    window.dispatchEvent(new CustomEvent(INTERNAL_VIEW_BUILDER_EVENT, { detail: { mode: "edit", viewId: view.id, view } }))
  }

  function duplicateView(view) {
    if (!view || views.length >= INTERNAL_MAX_CUSTOM_VIEWS) return
    const labels = [...builtinViews.map((item) => item.label), ...views.map((item) => item.label)]
    const now = new Date().toISOString()
    const nextView = normalizeInternalCustomView({
      ...view,
      id: createInternalViewId("view"),
      kind: "custom",
      label: uniqueInternalViewLabel(`${view.label} Copy`, labels),
      blocks: cloneInternalBlocks(view.blocks),
      createdAt: now,
      updatedAt: now,
    })
    if (!nextView) return
    persistCustomViews([...views, nextView])
    navigate(`/views/${nextView.id}`)
    window.dispatchEvent(new CustomEvent(INTERNAL_VIEW_BUILDER_EVENT, { detail: { mode: "edit", viewId: nextView.id, view: nextView } }))
  }

  function deleteView(view) {
    if (!view || view.kind !== "custom") return
    if (!window.confirm(`Delete "${view.label}"?`)) return
    const nextViews = persistCustomViews(views.filter((item) => item.id !== view.id))
    if (!nextViews.some((item) => item.id === viewId)) navigate("/views")
  }

  if (!viewId) {
    return (
      <InternalShell title="Views" alerts={error ? [{ id: "views-error", type: "WARNING", title: "View Data", body: error }] : []}>
        <section className="internal-views-library">
          <header>
            <div>
              <span>Saved Views</span>
              <h1>Internal views</h1>
              <p>Built-in locked views and browser-saved custom command surfaces for internal operations.</p>
            </div>
            <button type="button" className="primary-action" onClick={openCreateView}>
              <Plus aria-hidden="true" />
              New View
            </button>
          </header>
          <div className="internal-views-grid">
            {allViews.length ? allViews.map((view) => {
              const builtin = view.kind === "builtin"
              const preset = internalViewColorPresets[view.colorPreset || "slate"] || internalViewColorPresets.slate
              return (
                <article key={view.id} className={`internal-view-tile ${builtin ? "internal-view-tile--builtin" : ""}`}>
                  <div className="internal-view-tile__heading">
                    <span className="internal-view-tile__dot" style={{ background: preset.accent }} />
                    <strong>{view.label}</strong>
                    <span className="internal-view-tile__badge">{builtin ? "Built-in" : "Saved View"}</span>
                  </div>
                  <span>{view.subtitle || "Custom Internal overview"}</span>
                  <div className="internal-view-tile__meta">
                    <small>{formatNumber(view.blocks?.length || 0)} blocks</small>
                    {builtin ? <small><Lock aria-hidden="true" /> Locked</small> : null}
                  </div>
                  <div className="internal-view-tile__actions">
                    <button type="button" className="primary-action" onClick={() => navigate(pathForInternalView(view))}>
                      <Eye aria-hidden="true" />
                      Open
                    </button>
                    {builtin ? (
                      <button type="button" className="secondary-action" onClick={() => duplicateView(view)} disabled={views.length >= INTERNAL_MAX_CUSTOM_VIEWS}>
                        <Copy aria-hidden="true" />
                        Duplicate
                      </button>
                    ) : (
                      <>
                        <button type="button" className="secondary-action" onClick={() => openEditView(view)}>
                          <Pencil aria-hidden="true" />
                          Edit
                        </button>
                        <button type="button" className="secondary-action internal-view-tile__danger" onClick={() => deleteView(view)}>
                          <Trash2 aria-hidden="true" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </article>
              )
            }) : (
              <div className="internal-view-empty">
                <Plus aria-hidden="true" />
                <strong>No saved views yet</strong>
                <span>Create a custom command view from the view controls.</span>
              </div>
            )}
          </div>
        </section>
      </InternalShell>
    )
  }

  return (
    <InternalShell title={activeView?.label || "View"} alerts={error ? [{ id: "views-error", type: "WARNING", title: "View Data", body: error }] : []}>
      <section className={`internal-custom-view internal-custom-view--${activeView?.colorPreset || "slate"}`}>
        <header>
          <div>
            <span>{activeView?.kind === "builtin" ? "Default View" : "Saved View"}</span>
            <h1>{activeView?.label || "Missing View"}</h1>
            <p>{activeView?.subtitle || "This saved view could not be found in local storage."}</p>
          </div>
          <div className="internal-custom-view__actions">
            {activeView?.kind === "builtin" ? (
              <>
                <span className="internal-view-locked-badge"><Lock aria-hidden="true" /> Locked</span>
                <button type="button" className="secondary-action" onClick={() => duplicateView(activeView)} disabled={views.length >= INTERNAL_MAX_CUSTOM_VIEWS}>
                  <Copy aria-hidden="true" />
                  Duplicate
                </button>
              </>
            ) : activeView ? (
              <>
                <button type="button" className="secondary-action" onClick={() => openEditView(activeView)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </button>
                <button type="button" className="secondary-action internal-view-tile__danger" onClick={() => deleteView(activeView)}>
                  <Trash2 aria-hidden="true" />
                  Delete
                </button>
              </>
            ) : null}
            <BarChart3 aria-hidden="true" />
          </div>
        </header>
        {activeView ? <MetricGrid items={metrics} /> : null}
        {activeView ? (
          <PreviewTablePanel
            title="View Blocks"
            subtitle="Data sources included in this command overview."
            previewLimit={12}
            columns={[
              { key: "label", label: "Block" },
              { key: "helper", label: "Source" },
              { key: "value", label: "Value" },
            ]}
            rows={metrics}
          />
        ) : null}
      </section>
    </InternalShell>
  )
}

import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Gauge,
  MapPin,
  RadioTower,
  ShieldAlert,
  WalletCards,
} from "lucide-react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { DataTable, Panel } from "../components/PanelTable"
import PreviewListPanel from "../components/PreviewListPanel"
import StatusPill from "../components/StatusPill"
import { formatCodeLabel, formatDateTime, formatMoney, formatNumber, formatRelative } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"
import { InternalKpiDrilldownDrawer } from "../components/InternalKpiDrilldown"

function safeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function percentOf(value, total) {
  const denominator = safeNumber(total)
  if (!denominator) return 0
  return Math.max(0, Math.min(100, Math.round((safeNumber(value) / denominator) * 100)))
}

function toneForCount(value, fallback = "neutral") {
  return safeNumber(value) > 0 ? fallback : "success"
}

function formatCompactMoney(value) {
  const amount = safeNumber(value)
  const absolute = Math.abs(amount)
  if (absolute >= 1_000_000_000) return `MWK ${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`
  if (absolute >= 1_000_000) return `MWK ${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (absolute >= 1_000) return `MWK ${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return formatMoney(amount)
}

const focusIconMap = {
  stations: CheckCircle2,
  transactions: CircleDollarSign,
  attention: AlertTriangle,
  settlements: Banknote,
}

const signalIconMap = {
  Gauge,
  RadioTower,
  ShieldAlert,
  WalletCards,
  Activity,
  MapPin,
}

function FocusCard({ item, onClick }) {
  const Icon = focusIconMap[item.icon] || Gauge
  const progress = typeof item.progress === "number" ? item.progress : null

  return (
    <button type="button" className={`overview-focus-card overview-focus-card--${item.tone || "neutral"}`} onClick={onClick}>
      <span className="overview-focus-card__icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="overview-focus-card__copy">
        <span className="overview-focus-card__label">{item.label}</span>
        <strong>{item.value}</strong>
        <span className="overview-focus-card__detail">{item.detail}</span>
      </span>
      <span className="overview-focus-card__meta">
        {item.badge ? <span>{item.badge}</span> : null}
        <ArrowRight aria-hidden="true" />
      </span>
      {progress !== null ? (
        <span className="overview-focus-card__meter" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      ) : null}
    </button>
  )
}

function SignalCard({ item, onClick }) {
  const Icon = signalIconMap[item.icon] || Activity

  return (
    <button type="button" className={`overview-signal-card overview-signal-card--${item.tone || "neutral"}`} onClick={onClick}>
      <span className="overview-signal-card__top">
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
      </span>
      <strong>{item.value}</strong>
      <small>{item.detail}</small>
    </button>
  )
}

function SnapshotMetricGrid({ items }) {
  return (
    <div className="overview-snapshot-grid">
      {items.map((item) => (
        <div key={item.label} className={`overview-snapshot-metric overview-snapshot-metric--${item.tone || "neutral"}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.detail ? <small>{item.detail}</small> : null}
        </div>
      ))}
    </div>
  )
}

function RegionCell({ row }) {
  return (
    <div className="overview-region-cell">
      <strong>{row.region}</strong>
      <span>{row.city || "Regional cluster"}</span>
    </div>
  )
}

function AvailabilityCell({ row }) {
  const progress = percentOf(row.activeCount, row.stationCount)

  return (
    <div className="overview-progress-cell">
      <div>
        <strong>{formatNumber(row.activeCount)}</strong>
        <span>of {formatNumber(row.stationCount)}</span>
      </div>
      <span className="overview-progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </span>
    </div>
  )
}

function SnapshotList({ items, emptyLabel = "No items available." }) {
  if (!items?.length) return <p className="empty-cell">{emptyLabel}</p>
  return (
    <div className="timeline-list">
      {items.map((item) => (
        <article key={item.publicId || `${item.title}-${item.createdAt}`} className="timeline-item">
          <div>
            <strong>{item.title || item.summary || item.actionType || item.stationName}</strong>
            <p>{formatCodeLabel(item.summary || item.note || item.targetPublicId || item.stationName || "-")}</p>
          </div>
          <div className="timeline-meta">
            {item.severity ? <StatusPill value={item.severity} /> : null}
            {item.stationName ? <span>{item.stationName}</span> : null}
            {item.createdAt ? <time>{formatRelative(item.createdAt)}</time> : null}
          </div>
        </article>
      ))}
    </div>
  )
}

function AuditActivityList({ items, emptyLabel = "No audit activity available." }) {
  if (!items?.length) return <p className="empty-cell">{emptyLabel}</p>
  return (
    <div className="timeline-list">
      {items.map((item) => (
        <article key={item.publicId} className="timeline-item">
          <div>
            <strong>{item.summary}</strong>
            <p>{item.actorName} · {formatCodeLabel(item.actionType)}</p>
          </div>
          <div className="timeline-meta">
            <StatusPill value={item.severity} />
            <time>{formatDateTime(item.createdAt)}</time>
          </div>
        </article>
      ))}
    </div>
  )
}

function RecentChangesList({ items, emptyLabel = "No recent changes available." }) {
  if (!items?.length) return <p className="empty-cell">{emptyLabel}</p>
  return (
    <div className="timeline-list">
      {items.map((item) => (
        <article key={item.publicId} className="timeline-item">
          <div>
            <strong>{item.summary}</strong>
            <p>{formatCodeLabel(item.actionType)} · {formatCodeLabel(item.targetType)}</p>
          </div>
          <div className="timeline-meta">
            <StatusPill value={item.severity} />
            <time>{formatRelative(item.createdAt)}</time>
          </div>
        </article>
      ))}
    </div>
  )
}

export default function OverviewPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeSummary, setActiveSummary] = useState(null)
  const [showAllSummary, setShowAllSummary] = useState(false)

  useEffect(() => {
    let canceled = false
    internalApi
      .getOverview()
      .then((payload) => {
        if (!canceled) setData(payload)
      })
      .catch((err) => {
        if (!canceled) setError(err?.message || "Failed to load overview")
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })

    return () => {
      canceled = true
    }
  }, [])

  const metrics = data?.metrics || {}

  const activeStations = safeNumber(metrics.totalActiveStations)
  const totalStations = safeNumber(metrics.totalStations)
  const networkOnlinePercent = percentOf(activeStations, totalStations)
  const attentionLoad =
    safeNumber(metrics.stationsOffline) +
    safeNumber(metrics.livePumpAlerts) +
    safeNumber(metrics.highRiskAlerts) +
    safeNumber(metrics.criticalSupportTickets)

  const focusItems = [
    {
      label: "Active network",
      value: formatNumber(activeStations),
      detail: `${formatNumber(totalStations)} total stations`,
      badge: `${networkOnlinePercent}% online`,
      tone: safeNumber(metrics.stationsOffline) ? "warning" : "success",
      icon: "stations",
      progress: networkOnlinePercent,
      note: "Station availability is calculated from active stations against total registered stations.",
    },
    {
      label: "Today's throughput",
      value: formatCompactMoney(metrics.todayTransactionValue),
      detail: `${formatNumber(metrics.todayTransactionCount)} transactions`,
      badge: "Today",
      tone: "neutral",
      icon: "transactions",
      note: "Transaction value and count are scoped to the current business day.",
    },
    {
      label: "Attention queue",
      value: formatNumber(attentionLoad),
      detail: `${formatNumber(data?.needsAttention?.length)} prioritized records`,
      badge: attentionLoad ? "Review" : "Clear",
      tone: attentionLoad ? "danger" : "success",
      icon: "attention",
      note: "This combines offline stations, pump alerts, high-risk alerts, and critical support tickets.",
    },
    {
      label: "Settlement exposure",
      value: formatCompactMoney(metrics.pendingSettlementValue),
      detail: `${formatNumber(metrics.pendingSettlements)} batches pending`,
      badge: safeNumber(metrics.pendingSettlements) ? "Finance" : "Clear",
      tone: safeNumber(metrics.pendingSettlements) ? "warning" : "success",
      icon: "settlements",
      note: "Pending settlement value reflects batches still awaiting review or payout movement.",
    },
  ]

  const signalItems = [
    {
      label: "System health",
      value: metrics.systemHealthStatus || "-",
      detail: data?.systemHealthSummary?.latestEventAt ? `Latest ${formatRelative(data.systemHealthSummary.latestEventAt)}` : "No recent system event",
      tone: metrics.systemHealthStatus === "Operational" ? "success" : metrics.systemHealthStatus === "Degraded" ? "danger" : "warning",
      icon: "Activity",
    },
    {
      label: "Offline stations",
      value: formatNumber(metrics.stationsOffline),
      detail: `${formatNumber(totalStations)} stations tracked`,
      tone: toneForCount(metrics.stationsOffline, "danger"),
      icon: "RadioTower",
    },
    {
      label: "Pump alerts",
      value: formatNumber(metrics.livePumpAlerts),
      detail: "Offline, paused, or degraded",
      tone: toneForCount(metrics.livePumpAlerts, "danger"),
      icon: "Gauge",
    },
    {
      label: "Active queues",
      value: formatNumber(metrics.activeQueues),
      detail: "Waiting, called, or late",
      tone: toneForCount(metrics.activeQueues, "warning"),
      icon: "MapPin",
    },
    {
      label: "Pending activations",
      value: formatNumber(metrics.stationsPendingActivation),
      detail: "Submitted or under review",
      tone: toneForCount(metrics.stationsPendingActivation, "warning"),
      icon: "RadioTower",
    },
    {
      label: "High-risk alerts",
      value: formatNumber(metrics.highRiskAlerts),
      detail: "Compliance watchlist",
      tone: toneForCount(metrics.highRiskAlerts, "danger"),
      icon: "ShieldAlert",
    },
    {
      label: "Critical support",
      value: formatNumber(metrics.criticalSupportTickets),
      detail: "Open priority cases",
      tone: toneForCount(metrics.criticalSupportTickets, "danger"),
      icon: "Activity",
    },
    {
      label: "Subscription revenue",
      value: formatCompactMoney(metrics.subscriptionRevenueSnapshot),
      detail: "Monthly active plan total",
      tone: "neutral",
      icon: "WalletCards",
    },
  ]
  const signalLimit = 6
  const visibleSignalItems = showAllSummary ? signalItems : signalItems.slice(0, signalLimit)

  const panelRegistry = useMemo(() => {
    if (!data) return []
    const regions = data.regionalOperations?.items || []
    const base = {
      needsAttention: (
        <PreviewListPanel
          key="needsAttention"
          title="Attention Queue"
          subtitle="Highest-priority operational and commercial records."
          items={data.needsAttention}
          previewLimit={5}
          modalTitle="All Attention Queue Items"
          renderContent={(items) => <SnapshotList items={items} emptyLabel="No urgent items in the queue." />}
        />
      ),
      regionalOperations: (
        <Panel key="regionalOperations" title="Regional Operations" subtitle="Station availability, queues, incidents, and value by cluster.">
          <DataTable
            columns={[
              { key: "region", label: "Region", render: (row) => <RegionCell row={row} /> },
              { key: "availability", label: "Availability", render: (row) => <AvailabilityCell row={row} /> },
              { key: "offlineCount", label: "Offline", render: (row) => formatNumber(row.offlineCount) },
              { key: "queuePressure", label: "Queues", render: (row) => formatNumber(row.queuePressure) },
              { key: "incidentCount", label: "Incidents", render: (row) => formatNumber(row.incidentCount) },
              { key: "transactionValue", label: "Value", render: (row) => formatCompactMoney(row.transactionValue) },
            ]}
            rows={regions}
            minWidth={560}
            compact
          />
          {data.regionalOperations?.highestDemandRegion ? (
            <p className="panel-note">Highest-demand region today: <strong>{data.regionalOperations.highestDemandRegion}</strong></p>
          ) : null}
        </Panel>
      ),
      liveIncidents: (
        <PreviewListPanel
          key="liveIncidents"
          title="Live Incidents"
          subtitle="Open alerts sorted by severity and recency."
          items={data.liveIncidents}
          previewLimit={4}
          modalTitle="All Live Incidents"
          renderContent={(items) => <SnapshotList items={items} emptyLabel="No live incidents at the moment." />}
        />
      ),
      pendingOnboarding: hasPermission("onboarding:view") ? (
        <PreviewListPanel
          key="pendingOnboarding"
          title="Pending Onboarding / Activation"
          items={data.pendingOnboarding?.items}
          previewLimit={4}
          modalTitle="All Pending Onboarding Items"
          renderContent={(items) => (
            <>
              <div className="snapshot-stat-grid">
                <div><span>Awaiting verification</span><strong>{formatNumber(data.pendingOnboarding?.summary?.awaitingVerification)}</strong></div>
                <div><span>Activation review</span><strong>{formatNumber(data.pendingOnboarding?.summary?.activationReview)}</strong></div>
                <div><span>Delayed items</span><strong>{formatNumber(data.pendingOnboarding?.summary?.delayedItems)}</strong></div>
              </div>
              <SnapshotList items={items} emptyLabel="No onboarding blockers surfaced." />
            </>
          )}
        />
      ) : null,
      supportSnapshot: hasPermission("support:view") ? (
        <Panel key="supportSnapshot" title="Support & Dispute Snapshot">
          <SnapshotMetricGrid
            items={[
              { label: "Open tickets", value: formatNumber(data.supportSnapshot?.openTickets), tone: toneForCount(data.supportSnapshot?.openTickets, "warning") },
              { label: "Escalated disputes", value: formatNumber(data.supportSnapshot?.escalatedDisputes), tone: toneForCount(data.supportSnapshot?.escalatedDisputes, "danger") },
              { label: "Payment issues", value: formatNumber(data.supportSnapshot?.failedPaymentIssues), tone: toneForCount(data.supportSnapshot?.failedPaymentIssues, "warning") },
              { label: "Refund approvals", value: formatNumber(data.supportSnapshot?.refundsPendingApproval), tone: toneForCount(data.supportSnapshot?.refundsPendingApproval, "warning") },
            ]}
          />
        </Panel>
      ) : null,
      financeSnapshot: hasPermission("finance:view") ? (
        <Panel key="financeSnapshot" title="Finance Snapshot">
          <SnapshotMetricGrid
            items={[
              { label: "Platform revenue", value: formatCompactMoney(data.financeSnapshot?.todayRevenue), detail: "Today" },
              { label: "Unsettled value", value: formatCompactMoney(data.financeSnapshot?.unsettledValue), tone: toneForCount(data.financeSnapshot?.unsettledValue, "warning") },
              { label: "Pending payouts", value: formatNumber(data.financeSnapshot?.payoutBatchesPending), tone: toneForCount(data.financeSnapshot?.payoutBatchesPending, "warning") },
              { label: "Refund outflow", value: formatCompactMoney(data.financeSnapshot?.refundOutflowToday), detail: "Today" },
            ]}
          />
        </Panel>
      ) : null,
      riskSnapshot: hasPermission("risk:view") ? (
        <Panel key="riskSnapshot" title="Risk & Compliance Snapshot">
          <SnapshotMetricGrid
            items={[
              { label: "Suspicious tx", value: formatNumber(data.riskSnapshot?.suspiciousTransactionsCount), tone: toneForCount(data.riskSnapshot?.suspiciousTransactionsCount, "warning") },
              { label: "Frozen entities", value: formatNumber(data.riskSnapshot?.frozenAccountsOrStations), tone: toneForCount(data.riskSnapshot?.frozenAccountsOrStations, "danger") },
              { label: "Unresolved cases", value: formatNumber(data.riskSnapshot?.unresolvedComplianceCases), tone: toneForCount(data.riskSnapshot?.unresolvedComplianceCases, "warning") },
              { label: "Anomaly alerts", value: formatNumber(data.riskSnapshot?.anomalyAlerts), tone: toneForCount(data.riskSnapshot?.anomalyAlerts, "danger") },
            ]}
          />
        </Panel>
      ) : null,
      latestAuditActivity: hasPermission("audit:view") ? (
        <PreviewListPanel
          key="latestAuditActivity"
          title="Latest Audit Activity"
          items={data.latestAuditActivity}
          previewLimit={4}
          modalTitle="All Latest Audit Activity"
          renderContent={(items) => <AuditActivityList items={items} />}
        />
      ) : null,
      systemHealthSummary: hasPermission("system_health:view") ? (
        <Panel key="systemHealthSummary" title="System Health Summary">
          <SnapshotMetricGrid
            items={[
              { label: "Status", value: data.systemHealthSummary?.status || "-", tone: data.systemHealthSummary?.status === "Operational" ? "success" : "warning" },
              { label: "Degraded services", value: formatNumber(data.systemHealthSummary?.degradedServices), tone: toneForCount(data.systemHealthSummary?.degradedServices, "danger") },
              { label: "Latest event", value: formatDateTime(data.systemHealthSummary?.latestEventAt), detail: "System stream" },
            ]}
          />
        </Panel>
      ) : null,
      subscriptionCommercial: hasPermission("finance:view") || hasPermission("stations:view") ? (
        <Panel key="subscriptionCommercial" title="Subscription & Commercial Snapshot">
          <SnapshotMetricGrid
            items={[
              { label: "Recent renewals", value: formatNumber(data.subscriptionCommercial?.recentRenewals) },
              { label: "At-risk accounts", value: formatNumber(data.subscriptionCommercial?.atRiskStationAccounts), tone: toneForCount(data.subscriptionCommercial?.atRiskStationAccounts, "warning") },
            ]}
          />
          <DataTable
            columns={[
              { key: "planName", label: "Plan" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "stationCount", label: "Stations" },
              { key: "monthlyFeeTotal", label: "Monthly Fees", render: (row) => formatMoney(row.monthlyFeeTotal) },
            ]}
            rows={data.subscriptionCommercial?.activeSubscriptionsByPlan || []}
            minWidth={620}
            compact
          />
        </Panel>
      ) : null,
      recentChanges: (
        <PreviewListPanel
          key="recentChanges"
          title="Recent Changes / Timeline"
          items={data.recentChanges}
          previewLimit={4}
          modalTitle="All Recent Changes"
          renderContent={(items) => <RecentChangesList items={items} />}
        />
      ),
    }

    return (data.panelOrder || []).map((key) => base[key]).filter(Boolean)
  }, [data, hasPermission])

  const overviewColumns = useMemo(() => {
    return panelRegistry.reduce(
      (columns, panel, index) => {
        columns[index % 2 === 0 ? "left" : "right"].push(panel)
        return columns
      },
      { left: [], right: [] }
    )
  }, [panelRegistry])

  return (
    <InternalShell title="Overview" alerts={error ? [{ id: "internal-overview-error", type: "ERROR", title: "System Error", body: error }] : []}>
      {loading ? (
        <section className="dashboard-loading-shell" aria-live="polite">
          <div className="dashboard-loading-card">
            <span className="dashboard-loading-spinner" aria-hidden="true" />
            <p>Loading dashboard...</p>
          </div>
        </section>
      ) : (
        <div className="overview-page overview-page--modern">
          <section className="overview-focus-grid" aria-label="Overview focus metrics">
            {focusItems.map((item) => (
              <FocusCard key={item.label} item={item} onClick={() => setActiveSummary(item)} />
            ))}
          </section>

          <section className="overview-signal-section">
            <div className="overview-section-heading">
              <div>
                <h2>Operational Signals</h2>
                <p>Live status across stations, queues, support, risk, and finance.</p>
              </div>
              {signalItems.length > signalLimit ? (
                <button type="button" className="metric-grid-view-all" onClick={() => setShowAllSummary((prev) => !prev)}>
                  {showAllSummary ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  <span>{showAllSummary ? "Show less" : `View ${signalItems.length}`}</span>
                </button>
              ) : null}
            </div>
            <div className="overview-signal-grid" aria-label="Secondary operational metrics">
              {visibleSignalItems.map((item) => (
                <SignalCard key={item.label} item={item} onClick={() => setActiveSummary(item)} />
              ))}
            </div>
          </section>

          <InternalKpiDrilldownDrawer
            open={Boolean(activeSummary)}
            onOpenChange={(open) => !open && setActiveSummary(null)}
            drilldown={activeSummary ? {
              title: activeSummary.label,
              value: activeSummary.value,
              subtitle: activeSummary.detail || "Live overview metric from the internal command workspace.",
              note: activeSummary.note || "Use the related workspace panels below for the operational records behind this value.",
            } : null}
          />

          <div className="dashboard-grid internal-overview-layout">
            <div className="col-left internal-dashboard-column">
              {overviewColumns.left}
            </div>
            <div className="col-right internal-dashboard-column">
              {overviewColumns.right}
            </div>
          </div>
        </div>
      )}
    </InternalShell>
  )
}

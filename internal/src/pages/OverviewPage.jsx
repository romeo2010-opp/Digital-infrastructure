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

const metricBreakdownColumns = [
  { key: "metric", label: "Metric" },
  { key: "value", label: "Value", align: "right" },
  { key: "note", label: "Context" },
]

const regionalDrilldownColumns = [
  { key: "region", label: "Region" },
  { key: "activeCount", label: "Active", align: "right", render: (row) => formatNumber(row.activeCount) },
  { key: "stationCount", label: "Stations", align: "right", render: (row) => formatNumber(row.stationCount) },
  { key: "offlineCount", label: "Offline", align: "right", render: (row) => formatNumber(row.offlineCount) },
  { key: "queuePressure", label: "Queues", align: "right", render: (row) => formatNumber(row.queuePressure) },
  { key: "incidentCount", label: "Alerts", align: "right", render: (row) => formatNumber(row.incidentCount) },
]

const throughputDrilldownColumns = [
  { key: "region", label: "Region" },
  { key: "transactionValue", label: "Today value", align: "right", render: (row) => formatCompactMoney(row.transactionValue) },
  { key: "queuePressure", label: "Queue load", align: "right", render: (row) => formatNumber(row.queuePressure) },
  { key: "incidentCount", label: "Alerts", align: "right", render: (row) => formatNumber(row.incidentCount) },
]

const attentionDrilldownColumns = [
  { key: "title", label: "Record" },
  { key: "severity", label: "Severity", render: (row) => <StatusPill value={row.severity || "INFO"} /> },
  { key: "category", label: "Category", render: (row) => formatCodeLabel(row.category || row.ownerRoleCode || row.entityType || "-") },
  { key: "stationName", label: "Station", render: (row) => row.stationName || row.entityPublicId || "-" },
  { key: "createdAt", label: "Age", align: "right", render: (row) => formatRelative(row.createdAt) },
]

const subscriptionDrilldownColumns = [
  { key: "planName", label: "Plan" },
  { key: "status", label: "Status", render: (row) => <StatusPill value={row.status || "ACTIVE"} /> },
  { key: "stationCount", label: "Stations", align: "right", render: (row) => formatNumber(row.stationCount) },
  { key: "monthlyFeeTotal", label: "Monthly fees", align: "right", render: (row) => formatCompactMoney(row.monthlyFeeTotal) },
]

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

function SnapshotList({ items, emptyLabel = "No items available.", className = "" }) {
  if (!items?.length) return <p className="empty-cell">{emptyLabel}</p>
  return (
    <div className={["timeline-list", className].filter(Boolean).join(" ")}>
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
  const regionalItems = Array.isArray(data?.regionalOperations?.items) ? data.regionalOperations.items : []
  const attentionItems = Array.isArray(data?.needsAttention) ? data.needsAttention : []
  const liveIncidentItems = Array.isArray(data?.liveIncidents) ? data.liveIncidents : []
  const onboardingItems = Array.isArray(data?.pendingOnboarding?.items) ? data.pendingOnboarding.items : []
  const subscriptionItems = Array.isArray(data?.subscriptionCommercial?.activeSubscriptionsByPlan)
    ? data.subscriptionCommercial.activeSubscriptionsByPlan
    : []
  const attentionLoad =
    safeNumber(metrics.stationsOffline) +
    safeNumber(metrics.livePumpAlerts) +
    safeNumber(metrics.highRiskAlerts) +
    safeNumber(metrics.criticalSupportTickets)
  const networkDrilldownRows = regionalItems.length
    ? regionalItems
    : [{
      region: "Network total",
      activeCount: activeStations,
      stationCount: totalStations,
      offlineCount: safeNumber(metrics.stationsOffline),
      queuePressure: safeNumber(metrics.activeQueues),
      incidentCount: safeNumber(metrics.livePumpAlerts) + safeNumber(metrics.highRiskAlerts),
    }]
  const throughputDrilldownRows = regionalItems.length
    ? regionalItems
    : [{
      region: "Today",
      transactionValue: safeNumber(metrics.todayTransactionValue),
      queuePressure: safeNumber(metrics.activeQueues),
      incidentCount: safeNumber(metrics.livePumpAlerts) + safeNumber(metrics.highRiskAlerts),
    }]
  const attentionBreakdownRows = [
    { id: "offline-stations", metric: "Offline stations", value: formatNumber(metrics.stationsOffline), note: "Stations currently marked inactive or offline." },
    { id: "pump-alerts", metric: "Pump alerts", value: formatNumber(metrics.livePumpAlerts), note: "Offline, paused, or degraded pump states." },
    { id: "risk-alerts", metric: "High-risk alerts", value: formatNumber(metrics.highRiskAlerts), note: "Compliance and risk cases on the watchlist." },
    { id: "critical-support", metric: "Critical support tickets", value: formatNumber(metrics.criticalSupportTickets), note: "Open priority support cases needing action." },
  ]
  const financeBreakdownRows = [
    { id: "pending-value", metric: "Pending settlement value", value: formatCompactMoney(metrics.pendingSettlementValue), note: "Settlement value awaiting review or payout movement." },
    { id: "pending-batches", metric: "Pending settlement batches", value: formatNumber(metrics.pendingSettlements), note: "Batches currently pending or under review." },
    { id: "held-batches", metric: "Held settlements", value: formatNumber(data?.financeSnapshot?.heldSettlements), note: "Settlement batches currently held." },
    { id: "today-revenue", metric: "Platform revenue today", value: formatCompactMoney(data?.financeSnapshot?.todayRevenue), note: "Settlement fee revenue posted today." },
    { id: "refund-outflow", metric: "Refund outflow today", value: formatCompactMoney(data?.financeSnapshot?.refundOutflowToday), note: "Approved or paid refund outflow for today." },
  ]
  const supportBreakdownRows = [
    { id: "open-tickets", metric: "Open tickets", value: formatNumber(data?.supportSnapshot?.openTickets), note: "Open, in-progress, or escalated cases." },
    { id: "escalated-disputes", metric: "Escalated disputes", value: formatNumber(data?.supportSnapshot?.escalatedDisputes), note: "Cases currently escalated." },
    { id: "payment-issues", metric: "Payment issues", value: formatNumber(data?.supportSnapshot?.failedPaymentIssues), note: "Open payment failure cases." },
    { id: "refund-approvals", metric: "Refund approvals", value: formatNumber(data?.supportSnapshot?.refundsPendingApproval), note: "Refunds waiting on support or finance approval." },
  ]
  const riskBreakdownRows = [
    { id: "suspicious-transactions", metric: "Suspicious transactions", value: formatNumber(data?.riskSnapshot?.suspiciousTransactionsCount), note: "Transactions or cases flagged by compliance rules." },
    { id: "frozen-entities", metric: "Frozen entities", value: formatNumber(data?.riskSnapshot?.frozenAccountsOrStations), note: "Accounts or stations currently frozen." },
    { id: "unresolved-cases", metric: "Unresolved compliance cases", value: formatNumber(data?.riskSnapshot?.unresolvedComplianceCases), note: "Open, investigating, or frozen compliance cases." },
    { id: "anomaly-alerts", metric: "Anomaly alerts", value: formatNumber(data?.riskSnapshot?.anomalyAlerts), note: "High or critical unresolved anomaly alerts." },
  ]
  const systemBreakdownRows = [
    { id: "status", metric: "System status", value: metrics.systemHealthStatus || "-", note: "Current system health rollup." },
    { id: "degraded-services", metric: "Degraded services", value: formatNumber(data?.systemHealthSummary?.degradedServices), note: "Open critical or persistent warning health events." },
    { id: "latest-event", metric: "Latest event", value: formatDateTime(data?.systemHealthSummary?.latestEventAt), note: "Most recent system health event." },
  ]
  const onboardingBreakdownRows = [
    { id: "awaiting-verification", metric: "Awaiting verification", value: formatNumber(data?.pendingOnboarding?.summary?.awaitingVerification), note: "Submitted or review onboarding records." },
    { id: "activation-review", metric: "Activation review", value: formatNumber(data?.pendingOnboarding?.summary?.activationReview), note: "Stations ready for activation review." },
    { id: "delayed-items", metric: "Delayed items", value: formatNumber(data?.pendingOnboarding?.summary?.delayedItems), note: "Onboarding records older than the SLA window." },
  ]
  const subscriptionBreakdownRows = subscriptionItems.length
    ? subscriptionItems
    : [{ planName: "Active plans", status: "ACTIVE", stationCount: 0, monthlyFeeTotal: safeNumber(metrics.subscriptionRevenueSnapshot) }]
  const alertSourceItems = [...attentionItems, ...liveIncidentItems]
  const alertMatches = (item, terms) => terms.some((term) => `${item?.category || ""} ${item?.title || ""} ${item?.summary || ""} ${item?.ownerRoleCode || ""}`.toLowerCase().includes(term))
  const pumpAlertItems = alertSourceItems.filter((item) => alertMatches(item, ["pump", "nozzle", "telemetry", "degraded", "offline"])).slice(0, 8)
  const riskAlertItems = alertSourceItems.filter((item) => alertMatches(item, ["risk", "compliance", "fraud", "suspicious", "transaction"])).slice(0, 8)
  const supportAlertItems = alertSourceItems.filter((item) => alertMatches(item, ["support", "ticket", "dispute", "refund"])).slice(0, 8)
  const alertDrilldown = (rows, fallbackRows = attentionBreakdownRows) => (
    rows.length
      ? { columns: attentionDrilldownColumns, rows }
      : { columns: metricBreakdownColumns, rows: fallbackRows }
  )

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
      drilldown: {
        subtitle: "Station availability by region.",
        note: "These rows show active, offline, queue, and alert pressure by regional cluster.",
        columns: regionalDrilldownColumns,
        rows: networkDrilldownRows,
      },
    },
    {
      label: "Today's throughput",
      value: formatCompactMoney(metrics.todayTransactionValue),
      detail: `${formatNumber(metrics.todayTransactionCount)} transactions`,
      badge: "Today",
      tone: "neutral",
      icon: "transactions",
      note: "Transaction value and count are scoped to the current business day.",
      drilldown: {
        subtitle: `${formatNumber(metrics.todayTransactionCount)} transactions posted today.`,
        note: "Regional value is calculated from transactions with today's occurrence date.",
        columns: throughputDrilldownColumns,
        rows: throughputDrilldownRows,
      },
    },
    {
      label: "Attention queue",
      value: formatNumber(attentionLoad),
      detail: `${formatNumber(attentionItems.length)} prioritized records`,
      badge: attentionLoad ? "Review" : "Clear",
      tone: attentionLoad ? "danger" : "success",
      icon: "attention",
      note: "This combines offline stations, pump alerts, high-risk alerts, and critical support tickets.",
      drilldown: {
        subtitle: `${formatNumber(attentionItems.length)} highest-priority records plus metric composition.`,
        note: "The metric value is the total operational load; the table shows the latest prioritized records when available.",
        ...alertDrilldown(attentionItems, attentionBreakdownRows),
      },
    },
    {
      label: "Settlement exposure",
      value: formatCompactMoney(metrics.pendingSettlementValue),
      detail: `${formatNumber(metrics.pendingSettlements)} batches pending`,
      badge: safeNumber(metrics.pendingSettlements) ? "Finance" : "Clear",
      tone: safeNumber(metrics.pendingSettlements) ? "warning" : "success",
      icon: "settlements",
      note: "Pending settlement value reflects batches still awaiting review or payout movement.",
      drilldown: {
        subtitle: "Finance exposure and settlement movement.",
        note: "These values come from settlement batches and refund request snapshots.",
        columns: metricBreakdownColumns,
        rows: financeBreakdownRows,
      },
    },
  ]

  const signalItems = [
    {
      label: "System health",
      value: metrics.systemHealthStatus || "-",
      detail: data?.systemHealthSummary?.latestEventAt ? `Latest ${formatRelative(data.systemHealthSummary.latestEventAt)}` : "No recent system event",
      tone: metrics.systemHealthStatus === "Operational" ? "success" : metrics.systemHealthStatus === "Degraded" ? "danger" : "warning",
      icon: "Activity",
      drilldown: {
        subtitle: "Current system health rollup.",
        note: "Persistent warning events are counted as degraded after the configured health window.",
        columns: metricBreakdownColumns,
        rows: systemBreakdownRows,
      },
    },
    {
      label: "Offline stations",
      value: formatNumber(metrics.stationsOffline),
      detail: `${formatNumber(totalStations)} stations tracked`,
      tone: toneForCount(metrics.stationsOffline, "danger"),
      icon: "RadioTower",
      drilldown: {
        subtitle: "Offline station pressure by region.",
        note: "Rows are grouped by station city/region and include active queues plus open alerts.",
        columns: regionalDrilldownColumns,
        rows: networkDrilldownRows.filter((row) => safeNumber(row.offlineCount) > 0).length
          ? networkDrilldownRows.filter((row) => safeNumber(row.offlineCount) > 0)
          : networkDrilldownRows,
      },
    },
    {
      label: "Pump alerts",
      value: formatNumber(metrics.livePumpAlerts),
      detail: "Offline, paused, or degraded",
      tone: toneForCount(metrics.livePumpAlerts, "danger"),
      icon: "Gauge",
      drilldown: {
        subtitle: "Pump and telemetry records behind the alert count.",
        note: "When row-level pump alerts are present, they appear here; otherwise the card shows the metric composition.",
        ...alertDrilldown(pumpAlertItems, [
          { id: "pump-alerts", metric: "Live pump alerts", value: formatNumber(metrics.livePumpAlerts), note: "Offline, paused, or degraded pump states." },
          { id: "open-incidents", metric: "Open incidents", value: formatNumber(liveIncidentItems.length), note: "Open dashboard alerts available in the overview packet." },
        ]),
      },
    },
    {
      label: "Active queues",
      value: formatNumber(metrics.activeQueues),
      detail: "Waiting, called, or late",
      tone: toneForCount(metrics.activeQueues, "warning"),
      icon: "MapPin",
      drilldown: {
        subtitle: "Active queue pressure by region.",
        note: "Queue pressure counts waiting, called, or late queue entries.",
        columns: regionalDrilldownColumns,
        rows: regionalItems.filter((row) => safeNumber(row.queuePressure) > 0).length
          ? regionalItems.filter((row) => safeNumber(row.queuePressure) > 0)
          : networkDrilldownRows,
      },
    },
    {
      label: "Pending activations",
      value: formatNumber(metrics.stationsPendingActivation),
      detail: "Submitted or under review",
      tone: toneForCount(metrics.stationsPendingActivation, "warning"),
      icon: "RadioTower",
      drilldown: {
        subtitle: "Onboarding items awaiting activation movement.",
        note: "Summary rows are shown when the overview packet has no individual onboarding alert rows.",
        ...(onboardingItems.length
          ? { columns: attentionDrilldownColumns, rows: onboardingItems }
          : { columns: metricBreakdownColumns, rows: onboardingBreakdownRows }),
      },
    },
    {
      label: "High-risk alerts",
      value: formatNumber(metrics.highRiskAlerts),
      detail: "Compliance watchlist",
      tone: toneForCount(metrics.highRiskAlerts, "danger"),
      icon: "ShieldAlert",
      drilldown: {
        subtitle: "Risk and compliance snapshot.",
        note: "Rows show available risk records first, with aggregate compliance metrics as fallback.",
        ...alertDrilldown(riskAlertItems, riskBreakdownRows),
      },
    },
    {
      label: "Critical support",
      value: formatNumber(metrics.criticalSupportTickets),
      detail: "Open priority cases",
      tone: toneForCount(metrics.criticalSupportTickets, "danger"),
      icon: "Activity",
      drilldown: {
        subtitle: "Support and dispute workload.",
        note: "Rows show available support records first, with support snapshot metrics as fallback.",
        ...alertDrilldown(supportAlertItems, supportBreakdownRows),
      },
    },
    {
      label: "Subscription revenue",
      value: formatCompactMoney(metrics.subscriptionRevenueSnapshot),
      detail: "Monthly active plan total",
      tone: "neutral",
      icon: "WalletCards",
      drilldown: {
        subtitle: "Subscription revenue by plan and status.",
        note: "Monthly fee totals are grouped from station subscription statuses.",
        columns: subscriptionDrilldownColumns,
        rows: subscriptionBreakdownRows,
      },
    },
  ]
  const signalLimit = 4
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
          renderContent={(items) => (
            <SnapshotList
              items={items}
              emptyLabel="No urgent items in the queue."
              className="timeline-list--attention"
            />
          )}
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
              subtitle: activeSummary.drilldown?.subtitle || activeSummary.detail || "Live overview metric from the internal command workspace.",
              note: activeSummary.drilldown?.note || activeSummary.note || "Use the related workspace panels below for the operational records behind this value.",
              rows: activeSummary.drilldown?.rows || [],
              columns: activeSummary.drilldown?.columns || [],
              content: activeSummary.drilldown?.content,
              renderContent: activeSummary.drilldown?.renderContent,
              actionLabel: activeSummary.drilldown?.actionLabel,
              onAction: activeSummary.drilldown?.onAction,
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

import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { DataTable, Panel } from "../components/PanelTable"
import PreviewListPanel from "../components/PreviewListPanel"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatMoney, formatNumber, formatRelative } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

function SummaryIcon({ type }) {
  if (type === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m8 12 2.6 2.8L16 9.5" />
      </svg>
    )
  }

  if (type === "alert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5" />
        <circle cx="12" cy="17" r="1" />
      </svg>
    )
  }

  if (type === "wallet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <circle cx="16" cy="14" r="1" />
      </svg>
    )
  }

  if (type === "car") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13h14l-1.2-4H6.2L5 13Z" />
        <circle cx="8" cy="16.5" r="1.5" />
        <circle cx="16" cy="16.5" r="1.5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h6" />
    </svg>
  )
}

function resolveSummaryTone(tone = "neutral") {
  switch (tone) {
    case "success":
      return "green"
    case "warning":
      return "teal"
    case "danger":
      return "red"
    case "neutral":
    default:
      return "indigo"
  }
}

function SummaryTile({ label, value, tone = "neutral", icon = "fuel" }) {
  const resolvedTone = resolveSummaryTone(tone)
  return (
    <article className="kpi-card">
      <div className={`kpi-icon ${resolvedTone}`}>
        <SummaryIcon type={icon} />
      </div>
      <div className="kpi-copy">
        <div className="kpi-value">{value}</div>
        <p>{label}</p>
      </div>
    </article>
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
            <p>{item.summary || item.note || item.targetPublicId || item.stationName || "-"}</p>
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
            <p>{item.actorName} · {item.actionType}</p>
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
            <p>{item.actionType} · {item.targetType}</p>
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

  const summaryItems = [
    { label: "Active Stations", value: formatNumber(metrics.totalActiveStations), tone: "success", icon: "check" },
    { label: "Pending Activations", value: formatNumber(metrics.stationsPendingActivation), tone: "warning", icon: "fuel" },
    { label: "Offline Stations", value: formatNumber(metrics.stationsOffline), tone: metrics.stationsOffline ? "danger" : "neutral", icon: "car" },
    { label: "Live Pump Alerts", value: formatNumber(metrics.livePumpAlerts), tone: metrics.livePumpAlerts ? "danger" : "neutral", icon: "alert" },
    { label: "Today's Transactions", value: formatNumber(metrics.todayTransactionCount), tone: "neutral", icon: "car" },
    { label: "Today's Value", value: formatMoney(metrics.todayTransactionValue), tone: "neutral", icon: "wallet" },
    { label: "Pending Settlements", value: formatNumber(metrics.pendingSettlements), tone: metrics.pendingSettlements ? "warning" : "neutral", icon: "wallet" },
    { label: "High-Risk Alerts", value: formatNumber(metrics.highRiskAlerts), tone: metrics.highRiskAlerts ? "danger" : "neutral", icon: "alert" },
    { label: "Critical Support", value: formatNumber(metrics.criticalSupportTickets), tone: metrics.criticalSupportTickets ? "danger" : "neutral", icon: "fuel" },
    {
      label: "System Health",
      value: metrics.systemHealthStatus || "-",
      tone:
        metrics.systemHealthStatus === "Operational"
          ? "success"
          : metrics.systemHealthStatus === "Degraded"
            ? "danger"
            : "warning",
      icon: "check",
    },
  ]

  const panelRegistry = useMemo(() => {
    if (!data) return []
    const regions = data.regionalOperations?.items || []
    const base = {
      needsAttention: (
        <PreviewListPanel
          key="needsAttention"
          title="Needs Attention"
          subtitle="Prioritized operational and commercial items requiring action."
          items={data.needsAttention}
          previewLimit={4}
          modalTitle="All Needs Attention Items"
          renderContent={(items) => <SnapshotList items={items} emptyLabel="No urgent items in the queue." />}
        />
      ),
      regionalOperations: (
        <Panel key="regionalOperations" title="Regional Operations Summary">
          <DataTable
            columns={[
              { key: "region", label: "Region" },
              { key: "stationCount", label: "Stations" },
              { key: "activeCount", label: "Active" },
              { key: "offlineCount", label: "Offline" },
              { key: "queuePressure", label: "Queue Pressure" },
              { key: "incidentCount", label: "Incidents" },
              { key: "transactionValue", label: "Value", render: (row) => formatMoney(row.transactionValue) },
            ]}
            rows={regions}
          />
          {data.regionalOperations?.highestDemandRegion ? (
            <p className="panel-note">Highest-demand region today: <strong>{data.regionalOperations.highestDemandRegion}</strong></p>
          ) : null}
        </Panel>
      ),
      liveIncidents: (
        <PreviewListPanel
          key="liveIncidents"
          title="Live Incidents Feed"
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
          <div className="snapshot-stat-grid">
            <div><span>Open tickets</span><strong>{formatNumber(data.supportSnapshot?.openTickets)}</strong></div>
            <div><span>Escalated disputes</span><strong>{formatNumber(data.supportSnapshot?.escalatedDisputes)}</strong></div>
            <div><span>Failed payment issues</span><strong>{formatNumber(data.supportSnapshot?.failedPaymentIssues)}</strong></div>
            <div><span>Refunds pending approval</span><strong>{formatNumber(data.supportSnapshot?.refundsPendingApproval)}</strong></div>
          </div>
        </Panel>
      ) : null,
      financeSnapshot: hasPermission("finance:view") ? (
        <Panel key="financeSnapshot" title="Finance Snapshot">
          <div className="snapshot-stat-grid">
            <div><span>Today platform revenue</span><strong>{formatMoney(data.financeSnapshot?.todayRevenue)}</strong></div>
            <div><span>Unsettled value</span><strong>{formatMoney(data.financeSnapshot?.unsettledValue)}</strong></div>
            <div><span>Pending payouts</span><strong>{formatNumber(data.financeSnapshot?.payoutBatchesPending)}</strong></div>
            <div><span>Refund outflow</span><strong>{formatMoney(data.financeSnapshot?.refundOutflowToday)}</strong></div>
          </div>
        </Panel>
      ) : null,
      riskSnapshot: hasPermission("risk:view") ? (
        <Panel key="riskSnapshot" title="Risk & Compliance Snapshot">
          <div className="snapshot-stat-grid">
            <div><span>Suspicious transactions</span><strong>{formatNumber(data.riskSnapshot?.suspiciousTransactionsCount)}</strong></div>
            <div><span>Frozen entities</span><strong>{formatNumber(data.riskSnapshot?.frozenAccountsOrStations)}</strong></div>
            <div><span>Unresolved cases</span><strong>{formatNumber(data.riskSnapshot?.unresolvedComplianceCases)}</strong></div>
            <div><span>Anomaly alerts</span><strong>{formatNumber(data.riskSnapshot?.anomalyAlerts)}</strong></div>
          </div>
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
          <div className="snapshot-stat-grid">
            <div><span>Status</span><strong>{data.systemHealthSummary?.status || "-"}</strong></div>
            <div><span>Degraded services</span><strong>{formatNumber(data.systemHealthSummary?.degradedServices)}</strong></div>
            <div><span>Latest event</span><strong>{formatDateTime(data.systemHealthSummary?.latestEventAt)}</strong></div>
          </div>
        </Panel>
      ) : null,
      subscriptionCommercial: hasPermission("finance:view") || hasPermission("stations:view") ? (
        <Panel key="subscriptionCommercial" title="Subscription & Commercial Snapshot">
          <div className="snapshot-stat-grid">
            <div><span>Recent renewals</span><strong>{formatNumber(data.subscriptionCommercial?.recentRenewals)}</strong></div>
            <div><span>At-risk accounts</span><strong>{formatNumber(data.subscriptionCommercial?.atRiskStationAccounts)}</strong></div>
          </div>
          <DataTable
            columns={[
              { key: "planName", label: "Plan" },
              { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
              { key: "stationCount", label: "Stations" },
              { key: "monthlyFeeTotal", label: "Monthly Fees", render: (row) => formatMoney(row.monthlyFeeTotal) },
            ]}
            rows={data.subscriptionCommercial?.activeSubscriptionsByPlan || []}
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
        <div className="overview-page overview-page--classic">
          <section className="internal-summary-strip">
            {summaryItems.map((item) => (
              <SummaryTile key={item.label} {...item} />
            ))}
          </section>

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

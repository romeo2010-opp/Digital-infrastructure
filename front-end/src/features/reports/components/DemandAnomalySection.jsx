import { useMemo, useState } from "react"
import { formatDateTime } from "../../../utils/dateTime"

const WINDOW_OPTIONS = [
  { id: "15m", label: "15 min" },
  { id: "1h", label: "1 hour" },
  { id: "6h", label: "6 hours" },
]

function toSeverityClass(value) {
  const scoped = String(value || "NONE").toUpperCase()
  if (scoped === "CRITICAL") return "critical"
  if (scoped === "WARNING") return "warning"
  return "normal"
}

function toSeverityText(value) {
  const scoped = String(value || "NONE").toUpperCase()
  if (scoped === "CRITICAL") return "Critical"
  if (scoped === "WARNING") return "Warning"
  return "Normal"
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "0%"
  return `${Math.max(0, Number(value)).toFixed(1)}%`
}

function formatRate(value, unit = "L/h") {
  if (!Number.isFinite(Number(value))) return `0.00 ${unit}`
  return `${Number(value).toFixed(2)} ${unit}`
}

function LineGraph({ metrics = [] }) {
  const width = 760
  const height = 230
  const padding = { top: 24, right: 28, bottom: 44, left: 56 }
  const graphWidth = width - padding.left - padding.right
  const graphHeight = height - padding.top - padding.bottom

  const rows = (metrics || []).map((row, index) => ({
    id: row.fuelType || `F${index + 1}`,
    baseline: Number(row.expectedMeanLph || 0),
    current: Number(row.salesVelocityLph || 0),
  }))

  const maxY = Math.max(
    1,
    ...rows.flatMap((row) => [row.baseline, row.current])
  ) * 1.1

  function x(index) {
    if (rows.length <= 1) return padding.left + (graphWidth / 2)
    return padding.left + ((index / (rows.length - 1)) * graphWidth)
  }

  function y(value) {
    return padding.top + graphHeight - ((Math.max(0, value) / maxY) * graphHeight)
  }

  function pathFor(key) {
    return rows
      .map((row, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(row[key])}`)
      .join(" ")
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((factor) => Number((maxY * factor).toFixed(0)))

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Velocity versus baseline line graph by fuel type"
      className="reports-anomaly-line-graph"
    >
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" rx="8" />

      {yTicks.map((tick) => (
        <g key={`tick-${tick}`}>
          <line
            x1={padding.left}
            y1={y(tick)}
            x2={width - padding.right}
            y2={y(tick)}
            stroke="#e3ecf7"
            strokeWidth="1"
          />
          <text x={padding.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#6382a3">
            {tick}
          </text>
        </g>
      ))}

      <path d={pathFor("baseline")} fill="none" stroke="#8fb0d1" strokeWidth="2.5" />
      <path d={pathFor("current")} fill="none" stroke="#2f68a3" strokeWidth="2.5" />

      {rows.map((row, index) => (
        <g key={`pt-${row.id}`}>
          <circle cx={x(index)} cy={y(row.baseline)} r="4" fill="#8fb0d1" />
          <circle cx={x(index)} cy={y(row.current)} r="4.5" fill="#2f68a3" />
          <text
            x={x(index)}
            y={height - 16}
            textAnchor="middle"
            fontSize="11"
            fill="#4e6f91"
          >
            {row.id}
          </text>
        </g>
      ))}

      <g transform={`translate(${padding.left}, ${height - 30})`}>
        <line x1="0" y1="0" x2="18" y2="0" stroke="#8fb0d1" strokeWidth="2.5" />
        <text x="24" y="4" fontSize="11" fill="#4e6f91">Baseline</text>
        <line x1="100" y1="0" x2="118" y2="0" stroke="#2f68a3" strokeWidth="2.5" />
        <text x="124" y="4" fontSize="11" fill="#4e6f91">Current</text>
      </g>
    </svg>
  )
}

export default function DemandAnomalySection({
  metrics = [],
  events = [],
  loading = false,
  error = "",
  windowValue = "15m",
  onWindowChange,
  generatedAt = null,
}) {
  const [sortBy, setSortBy] = useState("startTime")
  const [sortDirection, setSortDirection] = useState("desc")

  const sortedEvents = useMemo(() => {
    const rows = [...events]
    rows.sort((a, b) => {
      if (sortBy === "severity") {
        const weight = { CRITICAL: 2, WARNING: 1, NONE: 0 }
        const left = weight[String(a.severity || "NONE").toUpperCase()] || 0
        const right = weight[String(b.severity || "NONE").toUpperCase()] || 0
        return sortDirection === "asc" ? left - right : right - left
      }

      const left = Date.parse(a.startTime || "") || 0
      const right = Date.parse(b.startTime || "") || 0
      return sortDirection === "asc" ? left - right : right - left
    })
    return rows
  }, [events, sortBy, sortDirection])

  const topSeverity = useMemo(() => {
    if (metrics.some((row) => String(row.severity || "").toUpperCase() === "CRITICAL")) return "CRITICAL"
    if (metrics.some((row) => String(row.severity || "").toUpperCase() === "WARNING")) return "WARNING"
    return "NONE"
  }, [metrics])

  const recommendedActions = useMemo(() => {
    if (topSeverity === "CRITICAL") {
      return [
        "Check dispenser throughput and verify nozzles for partial blockages.",
        "Validate tank readings and delivery reconciliation immediately.",
        "Notify on-shift team lead and prepare contingency queue controls.",
      ]
    }
    if (topSeverity === "WARNING") {
      return [
        "Monitor live throughput for the next 15 minutes before intervention.",
        "Confirm pump uptime and verify pending maintenance alerts.",
        "Review queue flow and reservation pacing for demand spikes.",
      ]
    }
    return [
      "No active demand anomalies detected in the selected window.",
      "Keep monitoring enabled and review trend table during peak hours.",
      "Continue standard station operations.",
    ]
  }, [topSeverity])

  function handleSort(nextSortBy) {
    if (nextSortBy === sortBy) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortBy(nextSortBy)
    setSortDirection("desc")
  }

  return (
    <section className="reports-panel" id="reports-demand-anomaly-section">
      <header className="reports-section-header">
        <h3>Demand Anomaly Detection</h3>
        <div className="reports-inline-actions">
          <label>
            Window
            <select
              value={windowValue}
              onChange={(event) => onWindowChange?.(event.target.value)}
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {generatedAt ? (
        <p className="reports-banner">
          Last computed {formatDateTime(generatedAt)} · detection state {toSeverityText(topSeverity)}
        </p>
      ) : null}

      {error ? <p className="settings-error">{error}</p> : null}

      <div className="reports-anomaly-status-grid">
        {(metrics.length ? metrics : [{ fuelType: "PETROL" }, { fuelType: "DIESEL" }]).map((metric) => (
          <article
            key={metric.fuelType}
            className={`reports-anomaly-card ${toSeverityClass(metric.severity)}`}
          >
            <h4>{metric.fuelType || "Fuel"}</h4>
            {loading ? (
              <div className="reports-anomaly-skeleton">
                <span />
                <span />
                <span />
              </div>
            ) : (
              <>
                <p className="reports-anomaly-severity">{toSeverityText(metric.severity)}</p>
                <p>Velocity: <strong>{formatRate(metric.salesVelocityLph)}</strong></p>
                <p>Expected: <strong>{formatRate(metric.expectedMeanLph)}</strong></p>
                <p>Tx Rate: <strong>{formatRate(metric.txRateTph, "tx/h")}</strong></p>
                <p>z-score: <strong>{Number(metric.zScore || 0).toFixed(2)}</strong></p>
                <p>EWMA Shift: <strong>{Number(metric.ewmaShiftScore || 0).toFixed(2)}</strong></p>
                {metric.persistencePending ? (
                  <small>Persistence gate active (pending confirmation)</small>
                ) : null}
              </>
            )}
          </article>
        ))}
      </div>

      <article className="reports-chart-placeholder reports-anomaly-chart">
        <h4>Velocity vs Baseline</h4>
        {loading ? (
          <div className="reports-anomaly-chart-loading">Preparing anomaly trend...</div>
        ) : (
          metrics.length ? <LineGraph metrics={metrics} /> : <div>No data available.</div>
        )}
      </article>

      <div className="reports-table-wrap">
        <table className="reports-data-table">
          <thead>
            <tr>
              <th className="reports-sortable" onClick={() => handleSort("severity")}>
                Severity
              </th>
              <th>Fuel Type</th>
              <th className="reports-sortable" onClick={() => handleSort("startTime")}>
                Start
              </th>
              <th>End</th>
              <th className="reports-cell-number">Velocity (L/h)</th>
              <th className="reports-cell-number">Expected Mean</th>
              <th className="reports-cell-number">z-score</th>
              <th>Rules</th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.length ? (
              sortedEvents.map((row) => (
                <tr key={`event-${row.id}`}>
                  <td>{toSeverityText(row.severity)}</td>
                  <td>{row.fuelType}</td>
                  <td>{formatDateTime(row.startTime)}</td>
                  <td>{row.endTime ? formatDateTime(row.endTime) : "Open"}</td>
                  <td className="reports-cell-number">{formatRate(row.currentVelocity).replace(" L/h", "")}</td>
                  <td className="reports-cell-number">{formatRate(row.expectedMean).replace(" L/h", "")}</td>
                  <td className="reports-cell-number">{Number(row.zScore || 0).toFixed(2)}</td>
                  <td>{(row.rulesTriggered || []).join(", ") || "n/a"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="reports-table-empty" colSpan={8}>
                  No anomaly events found for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <article className="reports-panel reports-anomaly-actions">
        <header className="reports-section-header">
          <h3>Recommended Actions</h3>
        </header>
        <ul className="reports-anomaly-recommendations">
          {recommendedActions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>
    </section>
  )
}

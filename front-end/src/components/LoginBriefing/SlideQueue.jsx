import React, { useMemo } from "react"
import BarChart from "./BarChart"
import MetricCard from "./MetricCard"

export default function SlideQueue({ queue, insight }) {
  const safeQueue = queue || {}
  const safeInsight = insight || {}
  const peakRows = useMemo(
    () =>
      (Array.isArray(safeQueue.peakHours) ? safeQueue.peakHours : []).map((row) => ({
        id: row.hour,
        label: row.hour,
        value: Number(row.vehicleCount || 0),
      })),
    [safeQueue.peakHours]
  )

  return (
    <section className="briefing-slide" aria-live="polite">
      <div className="briefing-card">
        <p className="briefing-slide__label">Slide 4 of 5 - Queue intelligence</p>
        <h2 className="briefing-slide__title">Driver activity & queue performance</h2>

        <div className="briefing-metric-grid">
          <MetricCard label="Drivers served" value={safeQueue.driversServed || 0} />
          <MetricCard label="Avg wait time" value={`${Number(safeQueue.avgWaitMinutes || 0).toLocaleString()} min`} helper={`Target ${Number(safeQueue.targetWaitMinutes || 0).toLocaleString()} min`} />
          <MetricCard label="Drop-offs" value={safeQueue.dropOffs || 0} helper={Number(safeQueue.dropOffs || 0) > 10 ? "high — investigate" : "within normal range"} />
        </div>

        <p className="briefing-slide__label briefing-slide__label--section">Peak queue hours</p>
        <BarChart rows={peakRows} />

        <article className="briefing-priority">
          <p className="briefing-priority__label">✦ Priority note</p>
          <p>{safeInsight.priority || "No priority action was generated."}</p>
          <small>{safeInsight.note || "No secondary note was generated."}</small>
        </article>
      </div>
    </section>
  )
}

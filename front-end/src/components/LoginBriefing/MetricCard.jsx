import React from "react"

function formatValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return value ?? "-"
}

export default function MetricCard({ label, value, helper, delta }) {
  const numericDelta = Number(delta)
  const hasDelta = Number.isFinite(numericDelta) && numericDelta !== 0
  const isUp = numericDelta > 0

  return (
    <article className="briefing-metric">
      <div className="briefing-metric__top">
        <div>
          <p>{label}</p>
          <strong>{formatValue(value)}</strong>
        </div>
        {hasDelta ? (
          <span className={`briefing-metric__delta ${isUp ? "is-up" : "is-down"}`}>
            {isUp ? "↑" : "↓"} {Math.abs(numericDelta).toFixed(1)}% vs yesterday
          </span>
        ) : null}
      </div>
      {helper ? <small>{helper}</small> : null}
      {!helper && !hasDelta ? <small className="briefing-metric__neutral">flat vs avg</small> : null}
    </article>
  )
}

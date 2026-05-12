import React, { useMemo } from "react"

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export default function BarChart({ rows, labelKey = "label", valueKey = "value", valueSuffix = "" }) {
  const normalizedRows = useMemo(() => {
    const source = Array.isArray(rows) ? rows : []
    const maxValue = Math.max(1, ...source.map((row) => toNumber(row?.[valueKey])))
    return source.map((row, index) => {
      const value = toNumber(row?.[valueKey])
      return {
        id: row?.id ?? row?.[labelKey] ?? index,
        label: row?.[labelKey] ?? "-",
        value,
        width: `${Math.max(3, (value / maxValue) * 100)}%`,
      }
    })
  }, [labelKey, rows, valueKey])

  if (!normalizedRows.length) {
    return (
      <p className="briefing-empty briefing-empty--compact">
        No chart data available.
      </p>
    )
  }

  return (
    <div className="briefing-chart">
      {normalizedRows.map((row) => (
        <div key={row.id} className="briefing-chart__row">
          <span className="briefing-chart__label">{row.label}</span>
          <div className="briefing-chart__track">
            <div className="briefing-chart__bar" style={{ width: row.width }} />
          </div>
          <strong className="briefing-chart__value">
            {row.value.toLocaleString()}{valueSuffix}
          </strong>
        </div>
      ))}
    </div>
  )
}

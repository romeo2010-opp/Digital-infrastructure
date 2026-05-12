import React, { useMemo } from "react"
import BarChart from "./BarChart"
import MetricCard from "./MetricCard"

function money(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

export default function SlideSales({ sales }) {
  const safeSales = sales || {}
  const chartRows = useMemo(
    () =>
      (Array.isArray(safeSales.byFuelType) ? safeSales.byFuelType : []).map((row) => ({
        id: row.fuelType,
        label: row.fuelType,
        value: Number(row.litres || 0),
      })),
    [safeSales.byFuelType]
  )

  return (
    <section className="briefing-slide" aria-live="polite">
      <div className="briefing-card">
        <p className="briefing-slide__label">Slide 3 of 5 - Sales summary</p>
        <h2 className="briefing-slide__title">Revenue & volume since your last session</h2>

        <div className="briefing-metric-grid">
          <MetricCard label="Total revenue" value={money(safeSales.totalRevenueMWK)} delta={safeSales.revenueChangePct} />
          <MetricCard label="Litres dispensed" value={`${Number(safeSales.totalLitres || 0).toLocaleString()} L`} delta={safeSales.litresChangePct} />
          <MetricCard label="Transactions" value={safeSales.transactionCount || 0} />
        </div>

        <p className="briefing-slide__label briefing-slide__label--section">Fuel-type breakdown</p>
        <BarChart rows={chartRows} valueSuffix=" L" />
      </div>
    </section>
  )
}

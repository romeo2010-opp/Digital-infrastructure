const kpiMeta = [
  { key: "totalLitres", label: "Total Litres", tab: "SALES", tooltip: "Total litres sold for selected filters" },
  { key: "revenue", label: "Revenue", tab: "SALES", tooltip: "Total revenue in selected period" },
  { key: "transactions", label: "Transactions", tab: "SALES", tooltip: "Completed transaction count" },
  { key: "avgPricePerLitre", label: "Avg Price/Litre", tab: "SALES", tooltip: "Average realized unit price" },
  { key: "bookSales", label: "Book Sales", tab: "INVENTORY", tooltip: "Expected litres sold from Opening + Deliveries - Closing" },
  { key: "varianceLitres", label: "Variance Litres", tab: "INVENTORY", tooltip: "Book Sales - Recorded Sales litres" },
  { key: "variancePct", label: "Variance %", tab: "INVENTORY", tooltip: "Variance / Book Sales" },
  { key: "queueAvgWaitMin", label: "Avg Wait (min)", tab: "QUEUE", tooltip: "Average queue wait in minutes" },
  { key: "queueNoShowRate", label: "No-show Rate", tab: "QUEUE", tooltip: "Queue customers not showing up" },
]

function roundUpToTwoDecimals(value) {
  return Math.ceil(Number(value) * 100) / 100
}

function formatValue(key, value) {
  if ((key === "bookSales" || key === "varianceLitres" || key === "variancePct") && (value === null || value === undefined)) {
    return "N/A"
  }
  if (key === "revenue") return `MWK ${Number(value).toLocaleString()}`
  if (key === "variancePct") return `${roundUpToTwoDecimals(value).toFixed(2)}%`
  if (key === "queueNoShowRate") return `${value}%`
  if (key === "queueAvgWaitMin") return `${Number(value).toFixed(1)} min`
  if (key === "avgPricePerLitre") return `MWK ${Number(value).toLocaleString()}`
  if (key === "varianceLitres") return `${roundUpToTwoDecimals(value).toFixed(2)} L`
  if (key === "bookSales") return `${Number(value).toLocaleString()} L`
  return Number(value).toLocaleString()
}

export default function KpiSummaryRow({ kpis, onSelectTab, allowedTabs = null }) {
  const tabs = Array.isArray(allowedTabs) && allowedTabs.length ? new Set(allowedTabs) : null

  return (
    <section className="reports-kpi-row">
      {kpiMeta.filter((item) => !tabs || tabs.has(item.tab)).map((item) => (
        <button
          key={item.key}
          type="button"
          className="reports-kpi-card"
          title={item.tooltip}
          onClick={() => onSelectTab(item.tab)}
        >
          <span>{item.label}</span>
          <strong>{formatValue(item.key, kpis[item.key])}</strong>
        </button>
      ))}
    </section>
  )
}

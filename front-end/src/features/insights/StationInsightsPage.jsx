import { useEffect, useMemo, useState } from "react"
import Navbar from "../../components/Navbar"
import { insightsApi } from "../../api/insightsApi"
import { utcTodayISO } from "../../utils/dateTime"
import "./insights.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const subtitleText = `The Insights module provides predictive analytics and operational intelligence for station managers.
It uses pump telemetry, tank levels, and transaction history to forecast fuel demand and optimize station operations.`

function formatLitres(value, digits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "N/A"
  return `${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} L`
}

function formatCurrency(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "N/A"
  return `MWK ${numeric.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`
}

function formatPercent(value, digits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "N/A"
  return `${numeric.toFixed(digits)}%`
}

function formatMinutes(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "N/A"
  return `${Math.max(0, Math.round(numeric))} min`
}

function severityClassName(severity) {
  const key = String(severity || "INFO").toUpperCase()
  if (key === "CRITICAL" || key === "HIGH") return "critical"
  if (key === "WARNING" || key === "MEDIUM") return "warning"
  return "info"
}

function renderNoDataRow(colSpan, text = "No data available.") {
  return (
    <tr>
      <td colSpan={colSpan}>{text}</td>
    </tr>
  )
}

export default function StationInsightsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [isExporting, setIsExporting] = useState(false)

  const [summary, setSummary] = useState(null)
  const [salesVelocity, setSalesVelocity] = useState(null)
  const [pumpUtilization, setPumpUtilization] = useState(null)
  const [inventoryPrediction, setInventoryPrediction] = useState(null)
  const [queuePrediction, setQueuePrediction] = useState(null)
  const [demandForecast, setDemandForecast] = useState(null)
  const [operationalAlerts, setOperationalAlerts] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadInsights() {
      setLoading(true)
      setError("")

      const date = utcTodayISO()
      const requests = await Promise.allSettled([
        insightsApi.getSummary({ date }),
        insightsApi.getSalesVelocity({ window: "1h" }),
        insightsApi.getPumpUtilization({ window: "6h" }),
        insightsApi.getInventoryPrediction(),
        insightsApi.getQueuePrediction(),
        insightsApi.getDemandForecast({ hours: 6 }),
        insightsApi.getAlerts(),
      ])

      if (cancelled) return

      const [summaryResult, velocityResult, utilizationResult, inventoryResult, queueResult, forecastResult, alertsResult] = requests

      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value)
      if (velocityResult.status === "fulfilled") setSalesVelocity(velocityResult.value)
      if (utilizationResult.status === "fulfilled") setPumpUtilization(utilizationResult.value)
      if (inventoryResult.status === "fulfilled") setInventoryPrediction(inventoryResult.value)
      if (queueResult.status === "fulfilled") setQueuePrediction(queueResult.value)
      if (forecastResult.status === "fulfilled") setDemandForecast(forecastResult.value)
      if (alertsResult.status === "fulfilled") setOperationalAlerts(alertsResult.value)

      const failures = requests.filter((result) => result.status === "rejected")
      if (failures.length) {
        const firstError = failures[0]?.reason?.message || "Some insights sources are unavailable."
        setError(firstError)
      }

      setLoading(false)
    }

    loadInsights()
    return () => {
      cancelled = true
    }
  }, [])

  const navbarAlerts = useMemo(() => {
    if (!error) return []
    return [
      {
        id: "insights-error",
        type: "ERROR",
        title: "Insights Warning",
        body: error,
      },
    ]
  }, [error])

  const keyMetricsRows = useMemo(
    () => [
      ["Petrol Sold Today", formatLitres(summary?.keyMetrics?.petrolSoldTodayLitres)],
      ["Diesel Sold Today", formatLitres(summary?.keyMetrics?.dieselSoldTodayLitres)],
      ["Total Revenue", formatCurrency(summary?.keyMetrics?.totalRevenue)],
      [
        "Active Pumps",
        Number.isFinite(Number(summary?.keyMetrics?.activePumps))
          ? Number(summary?.keyMetrics?.activePumps).toLocaleString()
          : "N/A",
      ],
      [
        "Current Queue",
        Number.isFinite(Number(summary?.keyMetrics?.currentQueue))
          ? Number(summary?.keyMetrics?.currentQueue).toLocaleString()
          : "N/A",
      ],
    ],
    [summary]
  )

  const forecastRows = demandForecast?.rows || []
  const reorderRows = inventoryPrediction?.reorder?.rows || []

  async function handleDownloadInsights() {
    try {
      setIsExporting(true)
      await insightsApi.exportPdf({ date: utcTodayISO() })
    } catch (downloadError) {
      setError(downloadError?.message || "Unable to export insights PDF.")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="insights-page">
      <Navbar pagetitle="Insights" image={avatar} alerts={navbarAlerts} />

      <section className="insights-shell">
        <header className="insights-header">
          <div className="insights-header-row">
            <div>
              <h2>SmartLink Station Manager — Insights</h2>
              <p>{subtitleText}</p>
            </div>
            <button
              type="button"
              className="insights-download-button"
              onClick={handleDownloadInsights}
              disabled={isExporting}
            >
              {isExporting ? "Preparing PDF..." : "Download Insights"}
            </button>
          </div>
        </header>

        {loading ? (
          <section className="insights-panel insights-skeleton" aria-label="Loading insights">
            <div className="insights-skeleton-row" />
            <div className="insights-skeleton-row" />
            <div className="insights-skeleton-row" />
          </section>
        ) : null}

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Dashboard Overview</h3>
          </div>
          <h4>Key Metrics</h4>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <tbody>
                {keyMetricsRows.map((row) => (
                  <tr key={row[0]}>
                    <th>{row[0]}</th>
                    <td>{row[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Fuel Demand Overview</h3>
          </div>
          <h4>Sales Velocity</h4>
          <p className="insights-formula">Sales Velocity = Total Litres Sold / Time Period</p>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Fuel Type</th>
                  <th>Total Litres</th>
                  <th>Window</th>
                  <th>Sales Velocity (L/hour)</th>
                </tr>
              </thead>
              <tbody>
                {(salesVelocity?.rows || []).map((row) => (
                  <tr key={row.fuelType}>
                    <td>{row.fuelType}</td>
                    <td>{formatLitres(row.totalLitresSold)}</td>
                    <td>{row.windowHours} hr</td>
                    <td>{Number(row.salesVelocityLph || 0).toFixed(2)}</td>
                  </tr>
                ))}
                {!(salesVelocity?.rows || []).length ? renderNoDataRow(4) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Pump Utilization</h3>
          </div>
          <p className="insights-formula">Pump Utilization = Dispensing Time / Total Time</p>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Pump</th>
                  <th>Fuel Type</th>
                  <th>Utilization</th>
                  <th>Litres Sold</th>
                </tr>
              </thead>
              <tbody>
                {(pumpUtilization?.rows || []).map((row) => (
                  <tr key={row.pumpPublicId || row.pumpNumber}>
                    <td>Pump {row.pumpNumber}</td>
                    <td>{row.fuelType}</td>
                    <td>{Number.isFinite(row.utilizationPercent) ? formatPercent(row.utilizationPercent) : "N/A"}</td>
                    <td>{formatLitres(row.litresSold)}</td>
                  </tr>
                ))}
                {!(pumpUtilization?.rows || []).length ? renderNoDataRow(4) : null}
              </tbody>
            </table>
          </div>
          <ul className="insights-bullets">
            {(pumpUtilization?.insights || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Fuel Inventory Prediction</h3>
          </div>
          <p className="insights-formula">Time Until Empty = Tank Remaining / Sales Velocity</p>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Tank</th>
                  <th>Remaining</th>
                  <th>Velocity</th>
                  <th>Stockout Estimate</th>
                  <th>Alert Level</th>
                </tr>
              </thead>
              <tbody>
                {(inventoryPrediction?.rows || []).map((row) => (
                  <tr key={row.tankPublicId || row.tankName}>
                    <td>{row.tankName}</td>
                    <td>{row.remainingLitres === null ? "N/A" : formatLitres(row.remainingLitres)}</td>
                    <td>{Number(row.velocityLph || 0).toFixed(2)} L/h</td>
                    <td>{row.stockoutEstimate || "Unavailable"}</td>
                    <td>
                      <span className={`insights-badge ${severityClassName(row.alertLevel)}`}>{row.alertLevel || "UNKNOWN"}</span>
                    </td>
                  </tr>
                ))}
                {!(inventoryPrediction?.rows || []).length ? renderNoDataRow(5) : null}
              </tbody>
            </table>
          </div>
          <h4>Alert Levels</h4>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Threshold</th>
                </tr>
              </thead>
              <tbody>
                {(inventoryPrediction?.alertLevels || []).map((row) => (
                  <tr key={row.level}>
                    <td>{row.level}</td>
                    <td>{row.criteria}</td>
                  </tr>
                ))}
                {!(inventoryPrediction?.alertLevels || []).length ? renderNoDataRow(2) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Queue Demand Prediction</h3>
          </div>
          <p className="insights-formula">Cars Per Hour = Sales Velocity / Average Litres Per Car</p>
          <div className="insights-example-block">
            <strong>Calculation</strong>
            <p>
              {Number.isFinite(Number(queuePrediction?.exampleCalculation?.salesVelocityLph))
                ? Number(queuePrediction?.exampleCalculation?.salesVelocityLph).toFixed(2)
                : "N/A"}{" "}
              L/h ÷{" "}
              {Number.isFinite(Number(queuePrediction?.exampleCalculation?.avgLitresPerCar))
                ? Number(queuePrediction?.exampleCalculation?.avgLitresPerCar).toFixed(2)
                : "N/A"}{" "}
              L/car ={" "}
              {Number.isFinite(Number(queuePrediction?.exampleCalculation?.carsPerHour))
                ? Number(queuePrediction?.exampleCalculation?.carsPerHour).toFixed(2)
                : "N/A"}{" "}
              cars/hour
            </p>
            <small>{queuePrediction?.exampleCalculation?.note || "No live throughput data available."}</small>
          </div>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Vehicles in Queue</th>
                  <th>Estimated Wait</th>
                </tr>
              </thead>
              <tbody>
                {(queuePrediction?.queueExamples || []).map((row) => (
                  <tr key={`${row.vehiclesInQueue}-${row.estimatedWaitMinutes}`}>
                    <td>{row.vehiclesInQueue}</td>
                    <td>{formatMinutes(row.estimatedWaitMinutes)}</td>
                  </tr>
                ))}
                {!(queuePrediction?.queueExamples || []).length ? renderNoDataRow(2) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Demand Forecast (Next 6 Hours)</h3>
          </div>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Expected Demand Level</th>
                  <th>Expected Litres</th>
                </tr>
              </thead>
              <tbody>
                {forecastRows.map((row) => (
                  <tr key={row.time}>
                    <td>{row.time}</td>
                    <td>{row.demandLevel}</td>
                    <td>{row.expectedLitres !== undefined ? formatLitres(row.expectedLitres) : "N/A"}</td>
                  </tr>
                ))}
                {!forecastRows.length ? renderNoDataRow(3) : null}
              </tbody>
            </table>
          </div>
          <p className="insights-recommendation">
            {demandForecast?.recommendation || "No forecast recommendation available."}
          </p>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Fuel Reorder Recommendation</h3>
          </div>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Fuel Type</th>
                  <th>Remaining</th>
                  <th>Estimated Empty</th>
                  <th>Recommended Reorder</th>
                </tr>
              </thead>
              <tbody>
                {reorderRows.map((row) => (
                  <tr key={row.fuelType}>
                    <td>{row.fuelType}</td>
                    <td>{formatLitres(row.remainingLitres)}</td>
                    <td>{row.estimatedEmpty}</td>
                    <td>{row.recommendedReorder}</td>
                  </tr>
                ))}
                {!reorderRows.length ? renderNoDataRow(4) : null}
              </tbody>
            </table>
          </div>
          <p className="insights-recommendation">
            {inventoryPrediction?.reorder?.reason || "No reorder recommendation available."}
          </p>
        </section>

        <section className="insights-panel">
          <div className="insights-section-title-row">
            <h3>Operational Alerts</h3>
          </div>
          <ul className="insights-alert-list">
            {(operationalAlerts?.alerts || []).map((alert) => (
              <li key={alert.id}>
                <span className={`insights-badge ${severityClassName(alert.severity)}`}>{alert.severity}</span>
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.message}</p>
                </div>
              </li>
            ))}
            {!(operationalAlerts?.alerts || []).length ? <li>No active alerts.</li> : null}
          </ul>
        </section>

        <section className="insights-panel">
          <h3>Sales Performance Summary</h3>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <tbody>
                <tr>
                  <th>Total Fuel Sold</th>
                  <td>{formatLitres(summary?.salesPerformance?.totalFuelSoldLitres)}</td>
                </tr>
                <tr>
                  <th>Petrol Transactions</th>
                  <td>
                    {Number.isFinite(Number(summary?.salesPerformance?.petrolTransactions))
                      ? Number(summary?.salesPerformance?.petrolTransactions).toLocaleString()
                      : "N/A"}
                  </td>
                </tr>
                <tr>
                  <th>Diesel Transactions</th>
                  <td>
                    {Number.isFinite(Number(summary?.salesPerformance?.dieselTransactions))
                      ? Number(summary?.salesPerformance?.dieselTransactions).toLocaleString()
                      : "N/A"}
                  </td>
                </tr>
                <tr>
                  <th>Average Fuel per Vehicle</th>
                  <td>{formatLitres(summary?.salesPerformance?.averageFuelPerVehicleLitres)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="insights-panel">
          <h3>Demand Heatmap</h3>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Demand Level</th>
                </tr>
              </thead>
              <tbody>
                {(demandForecast?.heatmap?.rows || []).map((row) => (
                  <tr key={row.time}>
                    <td>{row.time}</td>
                    <td>{row.demandLevel}</td>
                  </tr>
                ))}
                {!(demandForecast?.heatmap?.rows || []).length ? renderNoDataRow(2) : null}
              </tbody>
            </table>
          </div>
          <p className="insights-purpose">
            {demandForecast?.heatmap?.purpose || "No heatmap guidance available."}
          </p>
        </section>

        <section className="insights-panel insights-key-insight">
          <h3>Key Insight</h3>
          <p>{operationalAlerts?.keyInsight?.headline || "No key insight available."}</p>
          <p>{operationalAlerts?.keyInsight?.detail || "No detail available."}</p>
          <p>
            <strong>Recommended Action:</strong> {operationalAlerts?.keyInsight?.action || "No action available."}
          </p>
        </section>
      </section>
    </div>
  )
}

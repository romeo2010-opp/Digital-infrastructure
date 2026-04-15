import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import CursorActionMenu from "../components/CursorActionMenu"
import InternalShell from "../components/InternalShell"
import MetricGrid from "../components/MetricGrid"
import PreviewTablePanel from "../components/PreviewTablePanel"
import { DataTable, Panel } from "../components/PanelTable"
import { formatDateTime, formatMoney, formatNumber } from "../utils/display"

const REPORT_HISTORY_KEY = "smartlink:analytics-report-history"
const PERIOD_OPTIONS = [
  { label: "Last 7 Days", value: 7 },
  { label: "Last 14 Days", value: 14 },
  { label: "Last 30 Days", value: 30 },
]

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function readReportHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REPORT_HISTORY_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeReportHistory(items) {
  window.localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(items.slice(0, 12)))
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

export default function AnalyticsForecastingPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [periodDays, setPeriodDays] = useState(30)
  const [regionFilter, setRegionFilter] = useState("ALL")
  const [fuelFilter, setFuelFilter] = useState("ALL")
  const [compareStationA, setCompareStationA] = useState("")
  const [compareStationB, setCompareStationB] = useState("")
  const [forecastRunAt, setForecastRunAt] = useState(null)
  const [reportHistory, setReportHistory] = useState([])
  const [optionsMenu, setOptionsMenu] = useState(null)
  const canExport = hasPermission("analytics:export")

  useEffect(() => {
    internalApi.getAnalytics().then(setData).catch((err) => setError(err?.message || "Failed to load analytics"))
    setReportHistory(readReportHistory())
  }, [])

  const regionOptions = useMemo(
    () => [...new Set((data?.stationPerformance || []).map((row) => row.region).filter(Boolean))].sort(),
    [data]
  )
  const fuelOptions = useMemo(
    () => [...new Set((data?.fuelBreakdown || []).map((row) => row.fuelType).filter((row) => row && row !== "UNKNOWN"))].sort(),
    [data]
  )

  const filteredStationSegments = useMemo(() => {
    const items = data?.stationPerformance || []
    return items.filter((row) => {
      const regionMatches = regionFilter === "ALL" || row.region === regionFilter
      const fuelMatches = fuelFilter === "ALL" || row.fuelType === fuelFilter
      return regionMatches && fuelMatches
    })
  }, [data, fuelFilter, regionFilter])

  const stationRows = useMemo(() => {
    const grouped = filteredStationSegments.reduce((accumulator, row) => {
      const key = row.stationPublicId || row.stationName
      const current = accumulator.get(key) || {
        stationPublicId: row.stationPublicId,
        stationName: row.stationName,
        city: row.city,
        region: row.region,
        transactionCount: 0,
        transactionValue: 0,
        litresSold: 0,
      }
      current.transactionCount += Number(row.transactionCount || 0)
      current.transactionValue += Number(row.transactionValue || 0)
      current.litresSold += Number(row.litresSold || 0)
      accumulator.set(key, current)
      return accumulator
    }, new Map())

    return [...grouped.values()].sort((a, b) => b.transactionValue - a.transactionValue || a.stationName.localeCompare(b.stationName))
  }, [filteredStationSegments])

  const filteredRegionalSegments = useMemo(() => {
    const items = data?.regionalComparison || []
    return items.filter((row) => {
      const regionMatches = regionFilter === "ALL" || row.region === regionFilter
      const fuelMatches = fuelFilter === "ALL" || row.fuelType === fuelFilter
      return regionMatches && fuelMatches
    })
  }, [data, fuelFilter, regionFilter])

  const regionalRows = useMemo(() => {
    const grouped = filteredRegionalSegments.reduce((accumulator, row) => {
      const key = `${row.city}:${row.region}`
      const current = accumulator.get(key) || {
        city: row.city,
        region: row.region,
        stationCount: 0,
        transactionValue: 0,
        litresSold: 0,
      }
      current.stationCount = Math.max(current.stationCount, Number(row.stationCount || 0))
      current.transactionValue += Number(row.transactionValue || 0)
      current.litresSold += Number(row.litresSold || 0)
      accumulator.set(key, current)
      return accumulator
    }, new Map())

    return [...grouped.values()].sort((a, b) => b.transactionValue - a.transactionValue || a.city.localeCompare(b.city))
  }, [filteredRegionalSegments])

  const filteredTrendRows = useMemo(() => {
    const grouped = (data?.demandTrend || [])
      .filter((row) => fuelFilter === "ALL" || row.fuelType === fuelFilter)
      .reduce((accumulator, row) => {
        const key = String(row.activityDate || "")
        const current = accumulator.get(key) || {
          activityDate: key,
          transactionCount: 0,
          transactionValue: 0,
          litresSold: 0,
        }
        current.transactionCount += Number(row.transactionCount || 0)
        current.transactionValue += Number(row.transactionValue || 0)
        current.litresSold += Number(row.litresSold || 0)
        accumulator.set(key, current)
        return accumulator
      }, new Map())

    return [...grouped.values()]
      .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())
      .slice(-periodDays)
  }, [data, fuelFilter, periodDays])

  const previousTrendRows = useMemo(() => {
    const grouped = (data?.demandTrend || [])
      .filter((row) => fuelFilter === "ALL" || row.fuelType === fuelFilter)
      .reduce((accumulator, row) => {
        const key = String(row.activityDate || "")
        const current = accumulator.get(key) || {
          activityDate: key,
          transactionCount: 0,
          transactionValue: 0,
          litresSold: 0,
        }
        current.transactionCount += Number(row.transactionCount || 0)
        current.transactionValue += Number(row.transactionValue || 0)
        current.litresSold += Number(row.litresSold || 0)
        accumulator.set(key, current)
        return accumulator
      }, new Map())

    const rows = [...grouped.values()].sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())
    return rows.slice(Math.max(0, rows.length - (periodDays * 2)), Math.max(0, rows.length - periodDays))
  }, [data, fuelFilter, periodDays])

  const forecastRows = useMemo(() => {
    if (!forecastRunAt) return []
    const seedRows = filteredTrendRows.slice(-Math.min(7, filteredTrendRows.length))
    if (!seedRows.length) return []

    const averageValue = seedRows.reduce((sum, row) => sum + Number(row.transactionValue || 0), 0) / seedRows.length
    const averageLitres = seedRows.reduce((sum, row) => sum + Number(row.litresSold || 0), 0) / seedRows.length
    const averageTransactions = seedRows.reduce((sum, row) => sum + Number(row.transactionCount || 0), 0) / seedRows.length
    const trendLift = seedRows.length > 1
      ? (Number(seedRows.at(-1)?.transactionValue || 0) - Number(seedRows[0]?.transactionValue || 0)) / (seedRows.length - 1)
      : 0
    const lastDate = new Date(seedRows.at(-1)?.activityDate || new Date())

    return Array.from({ length: 7 }, (_, index) => {
      const nextDate = new Date(lastDate)
      nextDate.setDate(nextDate.getDate() + index + 1)
      return {
        activityDate: nextDate.toISOString().slice(0, 10),
        forecastValue: Math.max(0, averageValue + trendLift * (index + 1)),
        forecastLitres: Math.max(0, averageLitres),
        forecastTransactions: Math.max(0, averageTransactions),
      }
    })
  }, [filteredTrendRows, forecastRunAt])

  const comparedStations = useMemo(() => {
    const first = stationRows.find((row) => row.stationPublicId === compareStationA) || null
    const second = stationRows.find((row) => row.stationPublicId === compareStationB) || null
    return [first, second].filter(Boolean)
  }, [compareStationA, compareStationB, stationRows])

  const summary = useMemo(() => {
    const totalValue = filteredTrendRows.reduce((sum, row) => sum + Number(row.transactionValue || 0), 0)
    const totalLitres = filteredTrendRows.reduce((sum, row) => sum + Number(row.litresSold || 0), 0)
    const transactionCount = filteredTrendRows.reduce((sum, row) => sum + Number(row.transactionCount || 0), 0)
    const previousValue = previousTrendRows.reduce((sum, row) => sum + Number(row.transactionValue || 0), 0)
    const bestStation = stationRows[0]?.stationName || "-"
    const regionalLeader = regionalRows[0]?.city || "-"
    const delta = previousValue > 0 ? ((totalValue - previousValue) / previousValue) * 100 : 0

    return {
      totalValue,
      totalLitres,
      transactionCount,
      previousValue,
      bestStation,
      regionalLeader,
      delta,
    }
  }, [filteredTrendRows, previousTrendRows, regionalRows, stationRows])

  const currentReport = useMemo(() => ({
    periodLabel: PERIOD_OPTIONS.find((option) => option.value === periodDays)?.label || `${periodDays} days`,
    regionLabel: regionFilter === "ALL" ? "All regions" : regionFilter,
    fuelLabel: fuelFilter === "ALL" ? "All fuel types" : fuelFilter,
    summary: {
      totalValue: formatMoney(summary.totalValue),
      totalLitres: formatNumber(summary.totalLitres),
      transactionCount: formatNumber(summary.transactionCount),
      bestStation: summary.bestStation,
      regionalLeader: summary.regionalLeader,
      currentPeriodValue: formatMoney(summary.totalValue),
      previousPeriodValue: formatMoney(summary.previousValue),
    },
    stationRows: stationRows.slice(0, 10).map((row) => ({
      ...row,
      transactionCount: formatNumber(row.transactionCount),
      transactionValue: formatMoney(row.transactionValue),
      litresSold: formatNumber(row.litresSold),
    })),
    regionalRows: regionalRows.slice(0, 10).map((row) => ({
      ...row,
      stationCount: formatNumber(row.stationCount),
      transactionValue: formatMoney(row.transactionValue),
      litresSold: formatNumber(row.litresSold),
    })),
  }), [fuelFilter, periodDays, regionFilter, regionalRows, stationRows, summary])

  function generateReport() {
    const nextReport = {
      id: `analytics-${Date.now()}`,
      createdAt: new Date().toISOString(),
      title: `${currentReport.periodLabel} Intelligence Report`,
      ...currentReport,
    }
    const nextHistory = [nextReport, ...reportHistory]
    setReportHistory(nextHistory)
    writeReportHistory(nextHistory)
  }

  function buildExportParams() {
    return {
      periodDays,
      region: regionFilter,
      fuelType: fuelFilter,
    }
  }

  async function exportFile(format, fallbackExtension) {
    try {
      setError("")
      const { blob, filename } = await internalApi.downloadAnalyticsExport(format, buildExportParams())
      const fallbackName = `analytics-report-${new Date().toISOString().slice(0, 10)}.${fallbackExtension}`
      downloadBlob(filename || fallbackName, blob)
    } catch (err) {
      setError(err?.message || `Failed to export analytics ${String(format || "").toUpperCase()}`)
    }
  }

  function exportCsv() {
    void exportFile("csv", "csv")
  }

  function exportXlsx() {
    void exportFile("xlsx", "xls")
  }

  function exportPdf() {
    void exportFile("pdf", "pdf")
  }

  function openOptionsMenu(event) {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const items = [
      { id: "trend", label: "Explore: Trend Dashboard", onSelect: () => scrollToSection("trend-dashboard") },
      { id: "regional", label: "Explore: Regional Analysis", onSelect: () => scrollToSection("regional-analysis") },
      { id: "stations", label: "Explore: Station Comparison", onSelect: () => scrollToSection("station-comparison") },
      { id: "performance", label: "Explore: Performance Report", onSelect: () => scrollToSection("performance-report") },
      { id: "forecast-view", label: "Forecasting: Demand Forecast", onSelect: () => scrollToSection("demand-forecast") },
      {
        id: "forecast-run",
        label: forecastRunAt ? "Forecasting: Rerun Forecast Model" : "Forecasting: Run Forecast Model",
        onSelect: () => setForecastRunAt(new Date().toISOString()),
      },
      { id: "history", label: "Reporting: Historical Reports", onSelect: () => scrollToSection("historical-reports") },
      ...(canExport
        ? [
            { id: "generate", label: "Reporting: Generate Report", onSelect: generateReport },
            { id: "csv", label: "Export: CSV", onSelect: exportCsv },
            { id: "pdf", label: "Export: PDF", onSelect: exportPdf },
            { id: "xlsx", label: "Export: XLSX", onSelect: exportXlsx },
            { id: "schedule", label: "Automation: Schedule Report (Planned)", onSelect: () => {}, disabled: true },
          ]
        : []),
    ]

    setOptionsMenu({
      x: rect.right - 12,
      y: rect.bottom + 8,
      title: "Analytics Options",
      items,
    })
  }

  const stationMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "region", label: "Region" },
      { key: "transactionCount", label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
      { key: "litresSold", label: "Litres Sold", render: (row) => formatNumber(row.litresSold) },
      { key: "transactionValue", label: "Transaction Value", render: (row) => formatMoney(row.transactionValue) },
    ],
    []
  )
  const regionalMetricColumns = useMemo(
    () => [
      { key: "city", label: "City" },
      { key: "region", label: "Region" },
      { key: "stationCount", label: "Stations", render: (row) => formatNumber(row.stationCount) },
      { key: "litresSold", label: "Litres", render: (row) => formatNumber(row.litresSold) },
      { key: "transactionValue", label: "Value", render: (row) => formatMoney(row.transactionValue) },
    ],
    []
  )
  const trendMetricColumns = useMemo(
    () => [
      { key: "activityDate", label: "Date" },
      { key: "transactionCount", label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
      { key: "litresSold", label: "Litres", render: (row) => formatNumber(row.litresSold) },
      { key: "transactionValue", label: "Value", render: (row) => formatMoney(row.transactionValue) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Best Performing Station",
        value: summary.bestStation,
        drilldown: {
          title: "Best Performing Stations",
          subtitle: "Station ranking for the currently applied region, fuel, and period filters.",
          rows: stationRows,
          columns: stationMetricColumns,
          emptyLabel: "No station performance data found.",
          minWidth: 900,
        },
      },
      {
        label: "Regional Leader",
        value: summary.regionalLeader,
        drilldown: {
          title: "Regional Leaders",
          subtitle: "Regional comparison ranked by transaction value.",
          rows: regionalRows,
          columns: regionalMetricColumns,
          emptyLabel: "No regional comparison data found.",
          minWidth: 860,
        },
      },
      {
        label: "Total Litres",
        value: formatNumber(summary.totalLitres),
        drilldown: {
          title: "Total Litres Detail",
          subtitle: "Daily trend rows contributing to the current litres total.",
          rows: filteredTrendRows,
          columns: trendMetricColumns,
          emptyLabel: "No trend rows found for the current scope.",
          minWidth: 820,
        },
      },
      {
        label: "Total Value",
        value: formatMoney(summary.totalValue),
        drilldown: {
          title: "Total Value Detail",
          subtitle: "Daily trend rows contributing to the current transaction value total.",
          rows: filteredTrendRows,
          columns: trendMetricColumns,
          emptyLabel: "No trend rows found for the current scope.",
          minWidth: 820,
        },
      },
      {
        label: "Transactions",
        value: formatNumber(summary.transactionCount),
        drilldown: {
          title: "Transaction Count Detail",
          subtitle: "Daily trend rows contributing to the current transaction count.",
          rows: filteredTrendRows,
          columns: trendMetricColumns,
          emptyLabel: "No trend rows found for the current scope.",
          minWidth: 820,
        },
      },
      {
        label: "Period Delta",
        value: `${summary.delta >= 0 ? "+" : ""}${summary.delta.toFixed(1)}%`,
        tone: summary.delta >= 0 ? "success" : "warning",
        drilldown: {
          title: "Period Delta Detail",
          subtitle: "Current period value compared with the previous matching period window.",
          content: (
            <div className="stack-grid">
              <div className="settings-summary-list admin-detail-grid">
                <div><span>Current Period</span><strong>{formatMoney(summary.totalValue)}</strong></div>
                <div><span>Previous Period</span><strong>{formatMoney(summary.previousValue)}</strong></div>
                <div><span>Delta</span><strong>{`${summary.delta >= 0 ? "+" : ""}${summary.delta.toFixed(1)}%`}</strong></div>
                <div><span>Scope</span><strong>{currentReport.periodLabel} · {currentReport.regionLabel} · {currentReport.fuelLabel}</strong></div>
              </div>
              <DataTable columns={trendMetricColumns} rows={filteredTrendRows} emptyLabel="No current period trend rows." compact minWidth={760} />
            </div>
          ),
        },
      },
    ],
    [
      currentReport.fuelLabel,
      currentReport.periodLabel,
      currentReport.regionLabel,
      filteredTrendRows,
      regionalMetricColumns,
      regionalRows,
      stationMetricColumns,
      stationRows,
      summary.bestStation,
      summary.delta,
      summary.previousValue,
      summary.regionalLeader,
      summary.totalLitres,
      summary.totalValue,
      summary.transactionCount,
      trendMetricColumns,
    ]
  )

  return (
    <InternalShell title="Analytics & Forecasting" alerts={error ? [{ id: "analytics-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar owner-filter-row">
        <select className="page-select" value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>
          {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="page-select" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
          <option value="ALL">All Regions</option>
          {regionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select className="page-select" value={fuelFilter} onChange={(event) => setFuelFilter(event.target.value)}>
          <option value="ALL">All Fuel Types</option>
          {fuelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={openOptionsMenu}>Options</button>
        </div>
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid">
        <Panel title="Applied Filters" subtitle="Read-only intelligence filters for date, region, fuel type, station comparison, and period comparison.">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Date Filter</span><strong>{currentReport.periodLabel}</strong></div>
            <div><span>Region Filter</span><strong>{currentReport.regionLabel}</strong></div>
            <div><span>Fuel Type Filter</span><strong>{currentReport.fuelLabel}</strong></div>
            <div><span>Compare Time Periods</span><strong>{formatMoney(summary.totalValue)} vs {formatMoney(summary.previousValue)}</strong></div>
          </div>
        </Panel>

        <Panel title="Fuel Mix" subtitle="Thirty-day fuel mix for the current analytical scope.">
          <div className="settings-summary-list admin-detail-grid">
            {(data?.fuelBreakdown || []).map((row) => (
              <div key={row.fuelType}>
                <span>{row.fuelType}</span>
                <strong>{formatMoney(row.transactionValue)}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div id="trend-dashboard">
        <PreviewTablePanel
          title="Demand Trend Dashboard"
          subtitle="Trend dashboard for the selected period and fuel scope."
          previewLimit={8}
          modalTitle="Demand Trend Dashboard"
          columns={[
            { key: "activityDate", label: "Date" },
            { key: "transactionCount", label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
            { key: "litresSold", label: "Litres", render: (row) => formatNumber(row.litresSold) },
            { key: "transactionValue", label: "Value", render: (row) => formatMoney(row.transactionValue) },
          ]}
          rows={filteredTrendRows}
        />
      </div>

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <div id="regional-analysis">
          <PreviewTablePanel
            title="Regional Analysis"
            subtitle="Regional comparison for the selected filters."
            previewLimit={6}
            modalTitle="Regional Analysis"
            columns={[
              { key: "city", label: "City" },
              { key: "region", label: "Region" },
              { key: "stationCount", label: "Stations", render: (row) => formatNumber(row.stationCount) },
              { key: "litresSold", label: "Litres", render: (row) => formatNumber(row.litresSold) },
              { key: "transactionValue", label: "Value", render: (row) => formatMoney(row.transactionValue) },
            ]}
            rows={regionalRows}
          />
        </div>

        <div className="stack-grid" id="demand-forecast">
          <PreviewTablePanel
            title="Demand Forecast"
            subtitle={forecastRunAt ? `Forecast model last run ${formatDateTime(forecastRunAt)}.` : "Run the forecast model to generate the next 7-day demand outlook."}
            previewLimit={7}
            compact
            modalTitle="Demand Forecast"
            columns={[
              { key: "activityDate", label: "Date" },
              { key: "forecastTransactions", label: "Transactions", render: (row) => formatNumber(row.forecastTransactions) },
              { key: "forecastLitres", label: "Litres", render: (row) => formatNumber(row.forecastLitres) },
              { key: "forecastValue", label: "Value", render: (row) => formatMoney(row.forecastValue) },
            ]}
            rows={forecastRows}
            emptyLabel="Forecast not generated yet."
          />

          <Panel title="Historical Reports" subtitle="Generated reports kept locally for analyst review." actions={<button type="button" className="secondary-action" onClick={() => scrollToSection("historical-reports")}>Open</button>}>
            <div className="settings-summary-list admin-detail-grid">
              <div><span>Saved Reports</span><strong>{formatNumber(reportHistory.length)}</strong></div>
              <div><span>Latest Generated</span><strong>{reportHistory[0] ? formatDateTime(reportHistory[0].createdAt) : "-"}</strong></div>
            </div>
          </Panel>
        </div>
      </div>

      <div id="station-comparison">
        <Panel title="Station Comparison" subtitle="Compare stations without edit or workflow controls.">
          <div className="page-toolbar owner-filter-row">
            <select className="page-select" value={compareStationA} onChange={(event) => setCompareStationA(event.target.value)}>
              <option value="">Select station A</option>
              {stationRows.map((row) => <option key={row.stationPublicId} value={row.stationPublicId}>{row.stationName}</option>)}
            </select>
            <select className="page-select" value={compareStationB} onChange={(event) => setCompareStationB(event.target.value)}>
              <option value="">Select station B</option>
              {stationRows.map((row) => <option key={row.stationPublicId} value={row.stationPublicId}>{row.stationName}</option>)}
            </select>
          </div>
          <div className="settings-summary-list admin-detail-grid">
            {comparedStations.length ? comparedStations.map((row) => (
              <div key={row.stationPublicId}>
                <span>{row.stationName}</span>
                <strong>{formatMoney(row.transactionValue)} | {formatNumber(row.litresSold)} L</strong>
              </div>
            )) : <div><span>Compare Stations</span><strong>Select one or two stations to compare.</strong></div>}
          </div>
          <PreviewTablePanel
            title="Station Performance"
            subtitle="Performance report view across the current analytical scope."
            previewLimit={8}
            modalTitle="Station Performance Comparison"
            columns={[
              { key: "stationName", label: "Station" },
              { key: "region", label: "Region" },
              { key: "transactionCount", label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
              { key: "litresSold", label: "Litres Sold", render: (row) => formatNumber(row.litresSold) },
              { key: "transactionValue", label: "Transaction Value", render: (row) => formatMoney(row.transactionValue) },
            ]}
            rows={stationRows}
          />
        </Panel>
      </div>

      <div id="performance-report">
        <Panel title="Performance Report" subtitle="Generated from the current comparison scope and ready for export.">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>Report Scope</span><strong>{currentReport.periodLabel}</strong></div>
            <div><span>Top Station</span><strong>{summary.bestStation}</strong></div>
            <div><span>Top Region</span><strong>{summary.regionalLeader}</strong></div>
            <div><span>Current Period Value</span><strong>{formatMoney(summary.totalValue)}</strong></div>
            <div><span>Previous Period Value</span><strong>{formatMoney(summary.previousValue)}</strong></div>
            <div><span>Forecast Ready</span><strong>{forecastRows.length ? "Yes" : "No"}</strong></div>
          </div>
        </Panel>
      </div>

      <div id="historical-reports">
        <PreviewTablePanel
          title="Historical Reports"
          subtitle="Local read-only history of generated analytics reports."
          previewLimit={6}
          modalTitle="Historical Reports"
          columns={[
            { key: "title", label: "Report" },
            { key: "periodLabel", label: "Period" },
            { key: "regionLabel", label: "Region" },
            { key: "fuelLabel", label: "Fuel" },
            { key: "createdAt", label: "Generated", render: (row) => formatDateTime(row.createdAt) },
          ]}
          rows={reportHistory}
          emptyLabel="No historical reports generated yet."
        />
      </div>
      <CursorActionMenu menu={optionsMenu} onClose={() => setOptionsMenu(null)} />
    </InternalShell>
  )
}

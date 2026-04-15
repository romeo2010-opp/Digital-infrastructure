import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import KpiCards from "./KpiCards"
import { queueData, reportsData } from "../../config/dataSource"
import { reservationsApi } from "../../api/reservationsApi"
import { formatTime, utcTodayISO } from "../../utils/dateTime"
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher"
import { pushSystemAlert } from "../../utils/systemAlerts"
import { STATION_PLAN_FEATURES } from "../../subscription/planCatalog"
import { useStationPlan } from "../../subscription/useStationPlan"

const fallbackPumpCards = []
const fallbackQueueRows = []
const fallbackExceptionRows = []
const fallbackFeedRows = []
const fallbackReadingRows = []
const fallbackSummaryRows = []
const fallbackSalesRows = []
const AUTO_FLIP_INTERVAL_MS = 10000

const fallbackChartBars = Array.from({ length: 14 }, (_, index) => ({
  id: index,
  height: `${20 + (index % 7) * 8}px`,
}))

function toneFromPumpStatus(status) {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "ACTIVE") return "pump-teal"
  if (normalized === "PAUSED") return "pump-orange"
  if (normalized === "OFFLINE") return "pump-cyan"
  if (normalized === "IDLE") return "pump-idle"
  return "pump-navy"
}

function ToneDot({ tone = "blue" }) {
  return <span className={`tone-dot ${tone}`} />
}

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>
}

function formatDisplayDateTime(value) {
  if (!value) return "-"
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))
  } catch {
    return "-"
  }
}

function formatMoney(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function formatLitres(value) {
  return `${Number(value || 0).toLocaleString()} L`
}

function DetailField({ label, value }) {
  return (
    <div className="dashboard-detail-field">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  )
}

function AutoFitPumpValue({ value, title }) {
  const containerRef = useRef(null)
  const textRef = useRef(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return

    const MIN_FONT_SIZE = 12
    const MAX_FONT_SIZE = 31
    const MAX_LINES = 2

    const fit = () => {
      const availableWidth = container.clientWidth
      if (!availableWidth) return

      let nextSize = MAX_FONT_SIZE
      text.style.fontSize = `${nextSize}px`
      let computed = window.getComputedStyle(text)
      let lineHeight = Number.parseFloat(computed.lineHeight)
      let allowedHeight = Number.isFinite(lineHeight) ? (lineHeight * MAX_LINES) + 0.5 : Infinity

      while (
        nextSize > MIN_FONT_SIZE &&
        (text.scrollWidth > availableWidth || text.scrollHeight > allowedHeight)
      ) {
        nextSize -= 1
        text.style.fontSize = `${nextSize}px`
        computed = window.getComputedStyle(text)
        lineHeight = Number.parseFloat(computed.lineHeight)
        allowedHeight = Number.isFinite(lineHeight) ? (lineHeight * MAX_LINES) + 0.5 : Infinity
      }
    }

    fit()

    let resizeObserver = null
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fit())
      resizeObserver.observe(container)
    }
    window.addEventListener("resize", fit)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", fit)
    }
  }, [value])

  return (
    <span ref={containerRef} className="pump-value-fit">
      <p ref={textRef} title={title}>{value}</p>
    </span>
  )
}

export default function DashboardReplica() {
  const isApiMode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase() === "api"
  const stationPlan = useStationPlan()
  const [showReservations, setShowReservations] = useState(false)
  const [showPumpTotals, setShowPumpTotals] = useState(false)
  const [queueSnapshot, setQueueSnapshot] = useState(null)
  const [reportSnapshot, setReportSnapshot] = useState(null)
  const [reservationSnapshot, setReservationSnapshot] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [selectedInspectionItem, setSelectedInspectionItem] = useState(null)
  const mountedRef = useRef(true)
  const lastCriticalAnomalyRef = useRef("")

  const toggleQueueReservationCard = () => {
    setShowReservations((prev) => !prev)
  }
  const togglePumpTotalsCard = () => {
    setShowPumpTotals((prev) => !prev)
  }

  const dashboardFilters = useMemo(() => {
    const today = utcTodayISO()
    return {
      preset: "TODAY",
      fromDate: today,
      toDate: today,
      shift: "ALL",
      fuelType: "ALL",
      pumpId: "ALL",
    }
  }, [])

  const loadDashboardData = useCallback(async ({ finishInitialLoad = false } = {}) => {
    try {
      const queueEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
      const reservationsEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS)
      const [queueResult, reportsResult, reservationsResult] = await Promise.allSettled([
        queueEnabled ? queueData.getSnapshot() : Promise.resolve(null),
        reportsData.getReportSnapshot(dashboardFilters),
        isApiMode && reservationsEnabled ? reservationsApi.getList() : Promise.resolve({ items: [] }),
      ])

      if (!mountedRef.current) return

      if (queueResult.status === "fulfilled") {
        setQueueSnapshot(queueResult.value)
      } else if (finishInitialLoad) {
        setQueueSnapshot(null)
      }

      if (reportsResult.status === "fulfilled") {
        setReportSnapshot(reportsResult.value)
      } else if (finishInitialLoad) {
        setReportSnapshot(null)
      }

      if (reservationsResult.status === "fulfilled") {
        setReservationSnapshot(reservationsResult.value?.items || [])
      } else if (finishInitialLoad) {
        setReservationSnapshot([])
      }
    } finally {
      if (finishInitialLoad && mountedRef.current) {
        setInitialLoading(false)
      }
    }
  }, [dashboardFilters, isApiMode, stationPlan])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    loadDashboardData({ finishInitialLoad: true })
  }, [loadDashboardData])

  useEffect(() => {
    if (initialLoading) return undefined
    const timerId = window.setTimeout(() => {
      setShowPumpTotals((prev) => !prev)
    }, AUTO_FLIP_INTERVAL_MS)
    return () => window.clearTimeout(timerId)
  }, [initialLoading, showPumpTotals])

  useEffect(() => {
    if (initialLoading) return undefined
    const timerId = window.setTimeout(() => {
      setShowReservations((prev) => !prev)
    }, AUTO_FLIP_INTERVAL_MS)
    return () => window.clearTimeout(timerId)
  }, [initialLoading, showReservations])

  useStationChangeWatcher({
    onChange: async () => {
      await loadDashboardData()
    },
  })

  useEffect(() => {
    if (!stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)) {
      lastCriticalAnomalyRef.current = ""
      return
    }
    const criticalRows = (reportSnapshot?.demandAnomaly?.metrics || []).filter(
      (row) => String(row.severity || "").toUpperCase() === "CRITICAL"
    )
    if (!criticalRows.length) {
      lastCriticalAnomalyRef.current = ""
      return
    }

    const fingerprint = criticalRows
      .map((row) => `${row.fuelType}:${Number(row.zScore || 0).toFixed(2)}`)
      .join("|")
    if (fingerprint === lastCriticalAnomalyRef.current) return
    lastCriticalAnomalyRef.current = fingerprint

    const body = criticalRows
      .map((row) => `${row.fuelType} z=${Number(row.zScore || 0).toFixed(2)}`)
      .join(" · ")
    pushSystemAlert(
      {
        type: "ERROR",
        title: "Critical Demand Anomaly",
        body,
      },
      {
        source: "DASHBOARD",
        incrementOnRepeat: false,
      }
    )
  }, [reportSnapshot, stationPlan])

  const pumpCards = useMemo(() => {
    if (!reportSnapshot?.pumps?.length) return fallbackPumpCards

    return reportSnapshot.pumps
      .filter((pump) => pump?.pumpId || pump?.pumpPublicId)
      .slice(0, 6)
      .map((pump) => {
        const isIdle = String(pump.status || "").toUpperCase() === "IDLE"
        return {
          id: String(pump.pumpId || pump.pumpPublicId),
          title: String(pump.status || "UNKNOWN"),
          volume: isIdle
            ? `MWK ${Number(pump.lastSaleAmount || 0).toLocaleString()}`
            : `${Number(pump.litresDispensed || 0).toLocaleString()} L`,
          detail: isIdle
            ? "Last sale value"
            : `${Number(pump.uptimePct || 0).toFixed(1)}% uptime`,
          footerA: isIdle ? "Last Txn" : "Avg Txn",
          footerB: isIdle
            ? (pump.lastSaleAt
              ? formatTime(pump.lastSaleAt, { hour: "2-digit", minute: "2-digit" })
              : "N/A")
            : `${Number(pump.avgTransactionTimeSec || 0)}s`,
          tone: toneFromPumpStatus(pump.status),
        }
      })
  }, [reportSnapshot])

  const pumpTotalCards = useMemo(() => {
    if (!reportSnapshot?.pumps?.length) return fallbackPumpCards

    return reportSnapshot.pumps
      .filter((pump) => pump?.pumpId || pump?.pumpPublicId)
      .slice(0, 6)
      .map((pump) => ({
        id: String(pump.pumpId || pump.pumpPublicId),
        title: String(pump.status || "UNKNOWN"),
        volume: `${Number(pump.litresDispensed || 0).toLocaleString()} L`,
        detail: "Total litres sold",
        footerA: "Revenue",
        footerB: `MWK ${Number(pump.revenue || 0).toLocaleString()}`,
        tone: toneFromPumpStatus(pump.status),
      }))
  }, [reportSnapshot])

  const queueRows = useMemo(() => {
    if (!queueSnapshot?.entries?.length) return fallbackQueueRows

    return queueSnapshot.entries
      .filter((entry) => ["Waiting", "Called", "Ready on site", "Assigned", "Fueling", "Late"].includes(entry.status))
      .slice(0, 6)
      .map((entry, index) => ({
        id: entry.maskedIdentifier || entry.id,
        time: formatTime(entry.joinedAt, { hour: "2-digit", minute: "2-digit" }),
        pctA: Math.max(8, Math.min(100, 18 + index * 14)),
        pctB: 0,
      }))
  }, [queueSnapshot])

  const reservationRows = useMemo(() => {
    if (reservationSnapshot?.length) {
      return reservationSnapshot.slice(0, 6).map((entry) => ({
        id: entry.id,
        name: entry.customer || entry.id,
        slot: entry.slot || "No slot",
        status: entry.status || "Pending",
      }))
    }

    if (isApiMode) {
      return []
    }

    if (!queueSnapshot?.entries?.length) {
      return [
        { id: "RSV-1001", name: "A. Banda", slot: "10:30 AM", status: "Confirmed" },
        { id: "RSV-1002", name: "M. Phiri", slot: "11:00 AM", status: "Arriving" },
      ]
    }

    return queueSnapshot.entries.slice(0, 6).map((entry) => ({
      id: entry.id,
      name: entry.maskedIdentifier || entry.id,
      slot: formatTime(entry.joinedAt, { hour: "2-digit", minute: "2-digit" }),
      status: entry.status,
    }))
  }, [isApiMode, queueSnapshot, reservationSnapshot])

  const exceptionRows = useMemo(() => {
    const incidentRows = (reportSnapshot?.incidents || []).slice(0, 4).map((incident) => ({
      kind: "incident",
      item: incident.title,
      value: incident.severity,
    }))
    const inspectionRows = (reportSnapshot?.exceptions?.transactionInspectionItems || []).slice(0, 4).map((row) => ({
      kind: "transactionInspection",
      id: row.publicId,
      item: `Transaction ${row.publicId}`,
      value: row.complianceCaseStatus || row.status,
      detail: row.workflowReasonLabel || "Under review",
      inspection: row,
    }))
    const rows = [...inspectionRows, ...incidentRows].slice(0, 6)
    return rows.length ? rows : fallbackExceptionRows
  }, [reportSnapshot])

  useEffect(() => {
    if (!selectedInspectionItem) return

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSelectedInspectionItem(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedInspectionItem])

  const latestReadingRows = useMemo(() => {
    const rows = reportSnapshot?.inventoryReadings || []
    if (!rows.length) return fallbackReadingRows
    return rows.slice(0, 6).map((row, index) => ({
      id: row.id || `READ-${index}`,
      tank: row.tankName || `Tank ${index + 1}`,
      readingType: row.readingType || "-",
      litres: Number(row.litres || 0),
      time: formatTime(row.readingTime, { hour: "2-digit", minute: "2-digit" }),
    }))
  }, [reportSnapshot])

  const recentTransactionRows = useMemo(() => {
    const rows = reportSnapshot?.sales?.transactions || []
    if (!rows.length) return fallbackFeedRows

    return rows.slice(0, 4).map((tx, index) => ({
      id: tx.publicId || `TX-${index}`,
      amount: `MWK ${Number(tx.amount || 0).toLocaleString()}`,
      name: `${Number(tx.litres || 0).toFixed(1)} L`,
      sub: tx.paymentMethod || "PAYMENT",
      time: formatTime(tx.occurredAt, { hour: "2-digit", minute: "2-digit" }),
      tone: "blue",
    }))
  }, [reportSnapshot])

  const summaryRows = useMemo(() => {
    if (!reportSnapshot?.kpis) return fallbackSummaryRows
    return [
      { label: "Total Sold", value: `${Number(reportSnapshot.kpis.totalLitres || 0).toLocaleString()} L` },
      { label: "Revenue", value: `MWK ${Number(reportSnapshot.kpis.revenue || 0).toLocaleString()}` },
      { label: "No-show Rate", value: `${Number(reportSnapshot.kpis.queueNoShowRate || 0).toFixed(1)}%` },
    ]
  }, [reportSnapshot])

  const salesRows = useMemo(() => {
    if (!reportSnapshot?.kpis) return fallbackSalesRows
    return [
      { label: "Avg Price/L", value: `MWK ${Number(reportSnapshot.kpis.avgPricePerLitre || 0).toLocaleString()}` },
      { label: "Transactions", value: Number(reportSnapshot.kpis.transactions || 0).toLocaleString() },
    ]
  }, [reportSnapshot])

  const chartBars = useMemo(() => {
    const rows = reportSnapshot?.sales?.trendDaily || []
    if (!rows.length) return fallbackChartBars
    const max = Math.max(...rows.map((item) => Number(item.value || 0)), 1)
    return rows.slice(0, 14).map((item, index) => ({
      id: index,
      height: `${Math.max(20, Math.round((Number(item.value || 0) / max) * 126))}px`,
    }))
  }, [reportSnapshot])

  const reconciliationRows = reportSnapshot?.reconciliation || []

  function toSentenceCase(text) {
  if (!text) return ""
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

  if (initialLoading) {
    return (
      <section className="dashboard-loading-shell" aria-live="polite">
        <div className="dashboard-loading-card">
          <span className="dashboard-loading-spinner" aria-hidden="true" />
          <p>Loading dashboard...</p>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-replica">
      <KpiCards snapshot={reportSnapshot} />

      <div className="dashboard-grid">
        <div className="col-left">
          <article
            className={`panel pump-toggle-panel ${showPumpTotals ? "is-flipped" : ""}`}
            role="button"
            tabIndex={0}
            onClick={togglePumpTotalsCard}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                togglePumpTotalsCard()
              }
            }}
            aria-label="Toggle between pump status and total litres sold"
          >
            <div className="pump-flip-inner">
              <div className="pump-flip-face pump-flip-face-front">
                <header className="panel-header split">
                  <h2>Pump Status</h2>
                  <span>Tap for totals</span>
                </header>
                {pumpCards.length ? (
                  <div className="pump-grid">
                    {pumpCards.map((card, idx) => (
                      <article key={`${card.id}-${idx}`} className={`pump-card ${card.tone}`}>
                        <header>
                          <strong>{card.id}</strong>
                          <h3 title={card.title}>{toSentenceCase(card.title)}</h3>
                        </header>
                        <div className="pump-main">
                          <AutoFitPumpValue value={card.volume} title={card.volume} />
                          <span title={card.detail}>{card.detail}</span>
                        </div>
                        <footer>
                          <small title={card.footerA}>{card.footerA}</small>
                          <small title={card.footerB}>{card.footerB}</small>
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No pump status data at the moment." />
                )}
              </div>

              <div className="pump-flip-face pump-flip-face-back">
                <header className="panel-header split">
                  <h2>Total Litres Sold</h2>
                  <span>Tap for status</span>
                </header>
                {pumpTotalCards.length ? (
                  <div className="pump-grid">
                    {pumpTotalCards.map((card, idx) => (
                      <article key={`${card.id}-${idx}`} className={`pump-card ${card.tone}`}>
                        <header>
                          <strong>{card.id}</strong>
                          <h3 title={card.title}>{toSentenceCase(card.title)}</h3>
                        </header>
                        <div className="pump-main">
                          <AutoFitPumpValue value={card.volume} title={card.volume} />
                          <span title={card.detail}>{card.detail}</span>
                        </div>
                        <footer>
                          <small title={card.footerA}>{card.footerA}</small>
                          <small title={card.footerB}>{card.footerB}</small>
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No pump totals data at the moment." />
                )}
              </div>
            </div>
          </article>

          <div className="left-lower-grid">
            <article className="panel">
              <header className="panel-header split">
                <h2>Alerts &amp; Exceptions</h2>
                <span>{exceptionRows.length} Active</span>
              </header>
              {exceptionRows.length ? (
                <div className="exception-list">
                  {exceptionRows.map((row) => (
                    <div
                      key={row.id || `${row.item}-${row.value}`}
                      className={`exception-row ${row.kind === "transactionInspection" ? "is-clickable" : ""}`}
                      role={row.kind === "transactionInspection" ? "button" : undefined}
                      tabIndex={row.kind === "transactionInspection" ? 0 : undefined}
                      onClick={row.kind === "transactionInspection" ? () => setSelectedInspectionItem(row.inspection) : undefined}
                      onKeyDown={
                        row.kind === "transactionInspection"
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                setSelectedInspectionItem(row.inspection)
                              }
                            }
                          : undefined
                      }
                    >
                      <div className="exception-item">
                        <ToneDot tone="yellow" />
                        <p>
                          {row.item}
                          {row.detail ? (
                            <span style={{ display: "block", marginTop: 4, fontSize: "0.8rem", opacity: 0.75 }}>
                              {row.detail}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="exception-meta">
                        <span>{row.value}</span>
                        {row.kind === "transactionInspection" ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedInspectionItem(row.inspection)
                            }}
                          >
                            View details
                          </button>
                        ) : (
                          <button type="button">Resolve</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No alerts or exceptions at the moment." />
              )}
            </article>

            <article className="panel compact">
              <header className="panel-header">
                <h2>Today&apos;s Summary</h2>
              </header>
              {summaryRows.length ? (
                <div className="mini-list">
                  {summaryRows.map((row) => (
                    <div key={row.label}>
                      <p>{row.label}</p>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No summary data available right now." />
              )}
            </article>

            <article className="panel chart">
              <header className="panel-header split">
                <h2>Sales Today</h2>
                <span>MWK {Number(reportSnapshot?.kpis?.revenue || 0).toLocaleString()}</span>
              </header>
              {chartBars.length ? (
                <div className="fake-bars">
                  {chartBars.map((bar) => (
                    <span key={bar.id} style={{ height: bar.height }} />
                  ))}
                </div>
              ) : (
                <EmptyState message="No sales chart data available right now." />
              )}
            </article>

            <article className="panel compact">
              <header className="panel-header">
                <h2>Sales Stats</h2>
              </header>
              {salesRows.length ? (
                <div className="mini-list">
                  {salesRows.map((row) => (
                    <div key={row.label}>
                      <p>{row.label}</p>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No sales data at the moment." />
              )}
            </article>
          </div>
        </div>

        <div className="col-right">
          <article
            className={`panel flip-panel ${showReservations ? "is-flipped" : ""}`}
            role="button"
            tabIndex={0}
            onClick={toggleQueueReservationCard}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                toggleQueueReservationCard()
              }
            }}
            aria-label="Toggle between queue and reservations widgets"
          >
            <div className="flip-card-inner">
              <div className="flip-face flip-face-front">
                <header className="panel-header split">
                  <h2>Queue Widget</h2>
                  <span>Live</span>
                </header>
                <div className="queue-head">{queueRows.length} cars in Queue</div>
                {queueRows.length ? (
                  <div className="queue-list">
                    {queueRows.slice(0, 4).map((row, idx) => (
                      <div key={`${row.id}-${idx}`} className="queue-row">
                        <strong>{row.id}</strong>
                        <span>{row.time}</span>
                        <div className="queue-meter">
                          <em style={{ width: `${row.pctA}%` }} />
                        </div>
                        <small>{row.pctA}%</small>
                        <small>{row.pctB ? `${row.pctB}%` : ""}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message={stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE) ? "No cars in queue at the moment." : "Queue operations unlock on Growth Operations."} />
                )}
              </div>

              <div className="flip-face flip-face-back">
                <header className="panel-header split">
                  <h2>Reservations Widget</h2>
                  <span>{reservationRows.length} Active</span>
                </header>
                <div className="queue-head">Upcoming Reservations</div>
                {reservationRows.length ? (
                  <div className="reservation-list">
                    {reservationRows.slice(0, 3).map((row) => (
                      <div key={row.id} className="reservation-row">
                        <strong>{row.name}</strong>
                        <span>{row.slot}</span>
                        <small>{row.id}</small>
                        <em>{row.status}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message={stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS) ? "No reservations at the moment." : "Reservations unlock on Growth Operations."} />
                )}
              </div>
            </div>
          </article>

          <article className="panel">
            <header className="panel-header">
              <h2>Deliveries &amp; Tank Levels</h2>
            </header>
            <div className="tank-list">
              {(reconciliationRows.length ? reconciliationRows : [{ id: "T1", tank: "Tank 1", actual: 56 }]).slice(0, 3).map((row, idx) => {
                const pctSource = row.tankLevelPercent ?? row.actual ?? 0
                const pct = Math.max(1, Math.min(100, Number(pctSource)))
                const danger = pct < 30
                return (
                  <div key={row.id || row.tank || idx} className={`tank-row ${danger ? "danger" : ""}`}>
                    <p>{row.tank || `Tank ${idx + 1}`}</p>
                    <span>{row.fuelType || "Fuel"}</span>
                    <div className="tank-bar"><em style={{ width: `${pct}%` }} /></div>
                    <strong>{pct}%</strong>
                  </div>
                )
              })}
            </div>
          </article>

          <div className="feed-grid">
            <article className="panel">
              <header className="panel-header">
                <h2>Latest Tank Readings</h2>
              </header>
              {latestReadingRows.length ? (
                <div className="feed-list">
                  {latestReadingRows.map((row, index) => (
                    <div key={`lr-${row.id || `row-${index}-${row.tank}`}`} className="feed-row">
                      <ToneDot tone="blue" />
                      <strong>{row.tank}</strong>
                      <div>
                        <p>{row.readingType}</p>
                        <small>{row.litres.toLocaleString()} L</small>
                      </div>
                      <span>{row.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No tank readings at the moment." />
              )}
            </article>

            <article className="panel">
              <header className="panel-header">
                <h2>Recent Transactions</h2>
              </header>
              {recentTransactionRows.length ? (
                <div className="feed-list">
                  {recentTransactionRows.map((row, index) => (
                    <div key={`r-${row.id || `row-${index}-${row.amount}`}`} className="feed-row">
                      <ToneDot tone="blue" />
                      <strong>{row.amount}</strong>
                      <div>
                        <p>{row.name}</p>
                        <small>{row.sub}</small>
                      </div>
                      <span>{row.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No recent transactions at the moment." />
              )}
            </article>
          </div>
        </div>
      </div>

      {selectedInspectionItem ? (
        <div
          className="dashboard-inspection-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedInspectionItem(null)}
        >
          <div
            className="dashboard-inspection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-inspection-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dashboard-inspection-modal-header">
              <div>
                <p>Transaction exception</p>
                <h3 id="dashboard-inspection-modal-title">
                  {selectedInspectionItem.publicId || "Inspection details"}
                </h3>
              </div>
              <button type="button" onClick={() => setSelectedInspectionItem(null)} aria-label="Close details">
                Close
              </button>
            </header>

            <div className="dashboard-inspection-modal-grid">
              <DetailField label="Status" value={selectedInspectionItem.status} />
              <DetailField
                label="Case status"
                value={selectedInspectionItem.complianceCaseStatus || "Not linked"}
              />
              <DetailField
                label="Case ID"
                value={selectedInspectionItem.complianceCasePublicId || "Not linked"}
              />
              <DetailField
                label="Occurred"
                value={formatDisplayDateTime(selectedInspectionItem.occurredAt)}
              />
              <DetailField label="Pump" value={selectedInspectionItem.pumpNumber ? `Pump ${selectedInspectionItem.pumpNumber}` : selectedInspectionItem.pumpPublicId} />
              <DetailField
                label="Nozzle"
                value={
                  selectedInspectionItem.nozzleNumber
                    ? `Nozzle ${selectedInspectionItem.nozzleNumber}${selectedInspectionItem.nozzleSide ? ` (${selectedInspectionItem.nozzleSide})` : ""}`
                    : selectedInspectionItem.nozzlePublicId
                }
              />
              <DetailField label="Fuel" value={selectedInspectionItem.fuelCode} />
              <DetailField label="Litres" value={formatLitres(selectedInspectionItem.litres)} />
              <DetailField label="Amount" value={formatMoney(selectedInspectionItem.totalAmount)} />
              <DetailField label="Payment" value={selectedInspectionItem.paymentMethod} />
              <DetailField
                label="Settlement impact"
                value={selectedInspectionItem.settlementImpactStatus}
              />
              <DetailField
                label="Case reason"
                value={selectedInspectionItem.workflowReasonLabel || selectedInspectionItem.workflowReasonCode}
              />
            </div>

            <div className="dashboard-inspection-modal-notes">
              <div>
                <span>Workflow note</span>
                <p>{selectedInspectionItem.workflowNote || "No workflow note recorded."}</p>
              </div>
              <div>
                <span>Case notes / actions</span>
                <p>{selectedInspectionItem.complianceCaseActionTaken || "No case actions recorded yet."}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

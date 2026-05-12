import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { queueData, reportsData } from "../../config/dataSource"
import { reservationsApi } from "../../api/reservationsApi"
import { formatTime, utcTodayISO } from "../../utils/dateTime"
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher"
import { pushSystemAlert } from "../../utils/systemAlerts"
import { STATION_PLAN_FEATURES } from "../../subscription/planCatalog"
import { useStationPlan } from "../../subscription/useStationPlan"
import { useAuth } from "../../auth/AuthContext"
import { useTopLoading } from "../../layout/TopLoadingContext"
import LoginBriefing from "../LoginBriefing"
import { useNavigate } from "react-router-dom"
import {
  BUSINESS_MOOD_OPTIONS,
  clearBusinessMood,
  readBusinessMood,
  writeBusinessMood,
} from "../../utils/businessMood"

const fallbackPumpCards = []
const fallbackFeedRows = []
const AUTO_FLIP_INTERVAL_MS = 10000
const KPI_SLIDE_INTERVAL_MS = 9000
const KPI_TOPBAR_MIN_MS = 450
const KPI_COUNT_DURATION_MS = 850

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function countDashboardReservations({ isApiMode, queueSnapshot, reservationSnapshot }) {
  if (reservationSnapshot?.length) return reservationSnapshot.slice(0, 6).length
  if (isApiMode) return 0
  if (!queueSnapshot?.entries?.length) return 2
  return queueSnapshot.entries.slice(0, 6).length
}

function countDashboardProducts(reportSnapshot) {
  const inventoryCount = reportSnapshot?.inventoryReadings?.length || 0
  if (inventoryCount) return inventoryCount
  return (reportSnapshot?.pumps || [])
    .filter((pump) => pump?.pumpId || pump?.pumpPublicId)
    .slice(0, 6).length
}

function buildDashboardKpiSignature({ isApiMode, queueSnapshot, reportSnapshot, reservationSnapshot }) {
  const kpis = reportSnapshot?.kpis || {}
  const queueStats = reportSnapshot?.queue?.stats || {}
  const pumpRows = Array.isArray(reportSnapshot?.pumps) ? reportSnapshot.pumps : []
  const activePumps = pumpRows.filter((pump) => {
    const status = String(pump?.status || "ACTIVE").toUpperCase()
    return status !== "OFFLINE" && status !== "PAUSED"
  }).length
  const varianceLitres = Number.isFinite(Number(kpis.varianceLitres))
    ? Number(kpis.varianceLitres)
    : (reportSnapshot?.reconciliation || []).reduce((sum, row) => (
      sum + Number(row?.variance || row?.varianceLitres || 0)
    ), 0)

  return [
    Number(kpis.totalLitres || 0).toFixed(2),
    Number(kpis.revenue || 0).toFixed(2),
    Number(reportSnapshot?.kpis?.transactions || 0),
    Number(kpis.avgPricePerLitre || 0).toFixed(2),
    Number(queueStats.served || 0),
    Number(queueStats.avgWaitMin || kpis.queueAvgWaitMin || 0).toFixed(1),
    Number(queueStats.noShowRate || kpis.queueNoShowRate || 0).toFixed(1),
    `${activePumps}/${pumpRows.length}`,
    Number(reportSnapshot?.inventoryReadings?.length || 0),
    varianceLitres.toFixed(2),
    (reportSnapshot?.reconciliation || []).length,
    countDashboardReservations({ isApiMode, queueSnapshot, reservationSnapshot }),
    countDashboardProducts(reportSnapshot),
  ].join("|")
}

function toneFromPumpStatus(status) {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "ACTIVE") return "pump-teal"
  if (normalized === "PAUSED") return "pump-orange"
  if (normalized === "OFFLINE") return "pump-cyan"
  if (normalized === "IDLE") return "pump-idle"
  return "pump-navy"
}

function ToneDot({ tone = "teal" }) {
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

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function formatAnimatedDashboardValue(value, format = "number", meta = {}) {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0
  const roundedValue = Math.round(numericValue)

  if (format === "money") {
    return `MWK ${roundedValue.toLocaleString()}`
  }
  if (format === "litres") {
    return `${roundedValue.toLocaleString()} L`
  }
  if (format === "percent") {
    return `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  }
  if (format === "percentInteger") {
    return `${roundedValue.toLocaleString()}%`
  }
  if (format === "minutes") {
    return `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`
  }
  if (format === "ratio") {
    return `${roundedValue.toLocaleString()}/${Number(meta.total || 0).toLocaleString()}`
  }
  return roundedValue.toLocaleString()
}

function normalizeAnimatedNumber(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function AnimatedDashboardValue({
  as = "strong",
  value,
  format = "number",
  meta,
  className = "",
  durationMs = KPI_COUNT_DURATION_MS,
}) {
  const initialValue = normalizeAnimatedNumber(value)
  const [displayValue, setDisplayValue] = useState(initialValue)
  const [isCounting, setIsCounting] = useState(false)
  const displayValueRef = useRef(initialValue)
  const frameRef = useRef(0)

  useEffect(() => {
    const targetValue = normalizeAnimatedNumber(value)
    const startValue = displayValueRef.current

    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }

    if (startValue === targetValue || typeof window === "undefined") {
      return undefined
    }

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    let startedAt = 0

    const finish = () => {
      displayValueRef.current = targetValue
      setDisplayValue(targetValue)
      setIsCounting(false)
      frameRef.current = 0
    }

    if (prefersReducedMotion || durationMs <= 0) {
      frameRef.current = window.requestAnimationFrame(finish)
      return () => {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      }
    }

    const tick = (timestamp) => {
      if (!startedAt) {
        startedAt = timestamp
        setIsCounting(true)
      }

      const progress = Math.min(1, (timestamp - startedAt) / durationMs)
      const easedProgress = 1 - ((1 - progress) ** 3)
      const nextValue = startValue + ((targetValue - startValue) * easedProgress)
      displayValueRef.current = nextValue
      setDisplayValue(nextValue)

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick)
      } else {
        finish()
      }
    }

    frameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    }
  }, [durationMs, value])

  const content = formatAnimatedDashboardValue(displayValue, format, meta)
  const accessibleValue = formatAnimatedDashboardValue(value, format, meta)
  const valueClassName = `dashboard-live-number ${isCounting ? "is-counting" : ""} ${className}`.trim()
  const valueProps = {
    className: valueClassName,
    "aria-label": accessibleValue,
  }

  if (as === "span") {
    return <span {...valueProps}>{content}</span>
  }

  return (
    <strong {...valueProps}>{content}</strong>
  )
}

function average(values) {
  const numericValues = values.map(Number).filter(Number.isFinite)
  if (!numericValues.length) return 0
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

function normalizeFuelBreakdown(reportSnapshot) {
  return (Array.isArray(reportSnapshot?.sales?.breakdown) ? reportSnapshot.sales.breakdown : [])
    .map((row) => ({
      fuelType: row?.fuelType || row?.fuel_type || "Fuel",
      litres: Number(row?.litres || 0),
      revenueMWK: Number(row?.revenue || row?.revenueMWK || row?.revenue_mwk || 0),
    }))
}

function normalizePeakHours(reportSnapshot) {
  const hourlyRows = Array.isArray(reportSnapshot?.queue?.hourly) ? reportSnapshot.queue.hourly : []
  return hourlyRows.slice(0, 5).map((row) => ({
    hour: row?.hour || "-",
    vehicleCount: Number(row?.joined || row?.served || 0),
  }))
}

function buildStationOverviewBriefing({
  currentStationName,
  mood,
  reportSnapshot,
  reservationRows,
}) {
  const kpis = reportSnapshot?.kpis || {}
  const queueStats = reportSnapshot?.queue?.stats || {}
  const pumpRows = Array.isArray(reportSnapshot?.pumps) ? reportSnapshot.pumps : []
  const avgWaitMinutes = Number(queueStats.avgWaitMin || kpis.queueAvgWaitMin || 0)
  const noShowRate = Number(queueStats.noShowRate || kpis.queueNoShowRate || 0)
  const varianceLitres = Number(kpis.varianceLitres || 0)
  const avgPumpUptime = average(pumpRows.map((pump) => pump?.uptimePct))
  const reservationCount = Array.isArray(reservationRows) ? reservationRows.length : 0
  const activePumps = pumpRows.filter((pump) => {
    const status = String(pump?.status || "ACTIVE").toUpperCase()
    return status !== "OFFLINE" && status !== "PAUSED"
  }).length
  const pumpCount = pumpRows.length
  const moodLabel = mood?.label || "Unrated"

  return {
    absenceHours: 0,
    alerts: [
      {
        severity: mood?.id === "good" || mood?.id === "great" ? "success" : "info",
        category: "business-pulse",
        title: `Today's business mood: ${moodLabel}`,
        description: mood?.response || "Business mood has not been rated yet.",
      },
      {
        severity: avgWaitMinutes > 15 ? "warning" : "info",
        category: "operations-news",
        title: "Forecourt flow news",
        description: avgWaitMinutes > 15
          ? `Average wait is ${avgWaitMinutes.toLocaleString()} minutes. Add queue triage before the next peak.`
          : `Average wait is ${avgWaitMinutes.toLocaleString()} minutes. Current forecourt flow is within the target band.`,
      },
      {
        severity: reservationCount > 0 ? "info" : "success",
        category: "reservation-news",
        title: "Reservation load",
        description: reservationCount > 0
          ? `${reservationCount.toLocaleString()} visible reservations need timing checks against pump availability.`
          : "No visible reservations are waiting, so attendants can focus on walk-in flow.",
      },
      {
        severity: Math.abs(varianceLitres) > 100 ? "warning" : "success",
        category: "inventory-news",
        title: "Inventory control signal",
        description: Math.abs(varianceLitres) > 100
          ? `Variance is ${formatLitres(varianceLitres)}. Reconcile tank readings before close.`
          : "Tank variance is controlled. Keep logging opening, delivery, and closing readings.",
      },
    ],
    sales: {
      totalRevenueMWK: Number(kpis.revenue || 0),
      totalLitres: Number(kpis.totalLitres || 0),
      transactionCount: Number(kpis.transactions || 0),
      revenueChangePct: 0,
      litresChangePct: 0,
      byFuelType: normalizeFuelBreakdown(reportSnapshot),
    },
    queue: {
      driversServed: Number(queueStats.served || 0),
      avgWaitMinutes,
      targetWaitMinutes: 10,
      dropOffs: Math.round(Number(queueStats.joined || 0) * (noShowRate / 100)),
      peakHours: normalizePeakHours(reportSnapshot),
    },
    insight: {
      priority: avgWaitMinutes > 15
        ? "Put one attendant on queue validation and pre-check payment method before vehicles reach the pump."
        : "Keep one attendant watching the next three vehicles so pump handovers stay tight.",
      note: "Use the readiness slide after this briefing to check pump uptime and tank variance before the next rush.",
    },
    market: {
      marketNote: `Station overview news for ${currentStationName}: review queue flow, pump readiness, and tank variance before the next high-demand window.`,
      supplyAlert: noShowRate > 8
        ? "Queue no-shows are elevated. Confirm driver readiness earlier and tighten call timing."
        : "",
      fetchedAt: new Date().toISOString(),
      sources: [
        { source: "Dashboard KPI feed", reliability: "station_data" },
        { source: "Queue snapshot", reliability: "live_operations" },
        { source: "Station reports", reliability: "sales_and_inventory" },
      ],
    },
    aiAdvice: {
      marketOpportunity: "Use the current mood rating as a quick manager signal, then compare it with litres sold, queue wait, and pump uptime.",
      riskFlag: Math.abs(varianceLitres) > 100
        ? "Inventory variance is high enough to review tank readings and excluded transactions."
        : "",
      recommendations: [
        {
          title: "Stage staff around the next queue peak",
          reasoning: "Shorter handovers reduce idle pump time and make the queue feel faster for drivers.",
          action: "Assign one person to verify the next vehicle, payment method, and fuel type before pump arrival.",
          revenueImpact: "Forecourt efficiency",
        },
        {
          title: "Protect high-volume pump uptime",
          reasoning: pumpCount
            ? `${activePumps}/${pumpCount} pumps are currently counted as service-ready and average uptime is ${formatPercent(avgPumpUptime)}.`
            : "Pump readiness data is limited, so staff should confirm pump state manually.",
          action: "Check paused or offline pumps first, then move attendants to the fastest working lanes.",
          revenueImpact: "Throughput lift",
        },
        {
          title: "Reconcile stock before close",
          reasoning: "Tank variance affects margin confidence and can hide meter or recording problems.",
          action: "Compare book sales, recorded litres, and latest tank readings before ending the shift.",
          revenueImpact: "Loss control",
        },
      ],
    },
  }
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
  const { session } = useAuth()
  const { setTopLoading } = useTopLoading()
  const navigate = useNavigate()
  const stationPublicId = session?.station?.publicId || "default"
  const [showPumpTotals, setShowPumpTotals] = useState(false)
  const [queueSnapshot, setQueueSnapshot] = useState(null)
  const [reportSnapshot, setReportSnapshot] = useState(null)
  const [reservationSnapshot, setReservationSnapshot] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [currentKpiSlide, setCurrentKpiSlide] = useState(0)
  const [businessMoodId, setBusinessMoodId] = useState(() => readBusinessMood(stationPublicId)?.id || "")
  const [showStationOverviewBriefing, setShowStationOverviewBriefing] = useState(false)
  const [selectedInspectionItem, setSelectedInspectionItem] = useState(null)
  const mountedRef = useRef(true)
  const lastCriticalAnomalyRef = useRef("")
  const dashboardKpiSignatureRef = useRef("")
  const dashboardKpiLoadIdRef = useRef(0)

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

  const fetchDashboardData = useCallback(async () => {
    const queueEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
    const reservationsEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS)
    const [queueResult, reportsResult, reservationsResult] = await Promise.allSettled([
      queueEnabled ? queueData.getSnapshot() : Promise.resolve(null),
      reportsData.getReportSnapshot(dashboardFilters),
      isApiMode && reservationsEnabled ? reservationsApi.getList() : Promise.resolve({ items: [] }),
    ])
    return { queueResult, reportsResult, reservationsResult }
  }, [dashboardFilters, isApiMode, stationPlan])

  const applyDashboardData = useCallback((results, { finishInitialLoad = false } = {}) => {
    if (!mountedRef.current) return

    const { queueResult, reportsResult, reservationsResult } = results

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
  }, [])

  const loadDashboardData = useCallback(async ({ finishInitialLoad = false } = {}) => {
    try {
      const results = await fetchDashboardData()
      applyDashboardData(results, { finishInitialLoad })
    } finally {
      if (finishInitialLoad && mountedRef.current) {
        setInitialLoading(false)
      }
    }
  }, [applyDashboardData, fetchDashboardData])

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
    setTopLoading("dashboard", initialLoading)
  }, [initialLoading, setTopLoading])

  useEffect(() => {
    return () => {
      setTopLoading("dashboard-kpis", false)
    }
  }, [setTopLoading])

  const dashboardKpiSignature = useMemo(() => buildDashboardKpiSignature({
    isApiMode,
    queueSnapshot,
    reportSnapshot,
    reservationSnapshot,
  }), [isApiMode, queueSnapshot, reportSnapshot, reservationSnapshot])

  useEffect(() => {
    dashboardKpiSignatureRef.current = dashboardKpiSignature
  }, [dashboardKpiSignature])

  useStationChangeWatcher({
    onChange: async () => {
      if (initialLoading) {
        await loadDashboardData()
        return
      }

      const results = await fetchDashboardData()
      if (!mountedRef.current) return

      const nextQueueSnapshot = results.queueResult.status === "fulfilled"
        ? results.queueResult.value
        : queueSnapshot
      const nextReportSnapshot = results.reportsResult.status === "fulfilled"
        ? results.reportsResult.value
        : reportSnapshot
      const nextReservationSnapshot = results.reservationsResult.status === "fulfilled"
        ? results.reservationsResult.value?.items || []
        : reservationSnapshot
      const nextSignature = buildDashboardKpiSignature({
        isApiMode,
        queueSnapshot: nextQueueSnapshot,
        reportSnapshot: nextReportSnapshot,
        reservationSnapshot: nextReservationSnapshot,
      })
      const currentSignature = dashboardKpiSignatureRef.current
      const kpisChanged = currentSignature && nextSignature !== currentSignature

      if (!kpisChanged) {
        applyDashboardData(results)
        dashboardKpiSignatureRef.current = nextSignature
        return
      }

      const loadId = dashboardKpiLoadIdRef.current + 1
      dashboardKpiLoadIdRef.current = loadId
      const startedAt = Date.now()
      setTopLoading("dashboard-kpis", true)
      try {
        applyDashboardData(results)
        dashboardKpiSignatureRef.current = nextSignature
        const remainingMs = KPI_TOPBAR_MIN_MS - (Date.now() - startedAt)
        if (remainingMs > 0) await wait(remainingMs)
      } finally {
        if (mountedRef.current && dashboardKpiLoadIdRef.current === loadId) {
          setTopLoading("dashboard-kpis", false)
        }
      }
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

  const recentTransactionRows = useMemo(() => {
    const rows = reportSnapshot?.sales?.transactions || []
    if (!rows.length) return fallbackFeedRows

    return rows.slice(0, 4).map((tx, index) => ({
      id: tx.publicId || `TX-${index}`,
      amount: `MWK ${Number(tx.amount || 0).toLocaleString()}`,
      name: `${Number(tx.litres || 0).toFixed(1)} L`,
      sub: tx.paymentMethod || "PAYMENT",
      time: formatTime(tx.occurredAt, { hour: "2-digit", minute: "2-digit" }),
      tone: "teal",
    }))
  }, [reportSnapshot])

  const reconciliationRows = useMemo(() => reportSnapshot?.reconciliation || [], [reportSnapshot])
  const greetingName = session?.user?.fullName || "Station Manager"
  const currentStationName = session?.station?.name || "Current station"
  const memberRows = (session?.stationMemberships || []).slice(0, 3)
  const selectedBusinessMood = BUSINESS_MOOD_OPTIONS.find((item) => item.id === businessMoodId)
  const stationOverviewBriefing = useMemo(() => buildStationOverviewBriefing({
    currentStationName,
    mood: selectedBusinessMood,
    reportSnapshot,
    reservationRows,
  }), [currentStationName, reportSnapshot, reservationRows, selectedBusinessMood])
  const kpiSlides = useMemo(() => {
    const kpis = reportSnapshot?.kpis || {}
    const queueStats = reportSnapshot?.queue?.stats || {}
    const pumpRows = Array.isArray(reportSnapshot?.pumps) ? reportSnapshot.pumps : []
    const configuredPumps = pumpRows.length || pumpCards.length
    const activePumpCount = pumpRows.filter((pump) => {
      const status = String(pump?.status || "ACTIVE").toUpperCase()
      return status !== "OFFLINE" && status !== "PAUSED"
    }).length
    const activePumps = pumpRows.length ? activePumpCount : configuredPumps
    const avgPumpUptime = average(pumpRows.map((pump) => pump?.uptimePct))
    const varianceLitres = Number.isFinite(Number(kpis.varianceLitres))
      ? Number(kpis.varianceLitres)
      : reconciliationRows.reduce((sum, row) => sum + Number(row?.variance || row?.varianceLitres || 0), 0)

    return [
      {
        title: "Sales performance",
        label: "Slide 1 of 3",
        cards: [
          { label: "Total litres sold", value: Number(kpis.totalLitres || 0), format: "litres", helper: "Recorded today", icon: "fuel" },
          { label: "Gross revenue", value: Number(kpis.revenue || 0), format: "money", helper: "Before settlement adjustments", icon: "money" },
          { label: "Transactions", value: Number(kpis.transactions || 0), format: "number", helper: "Completed sales", icon: "txn" },
          { label: "Avg price / litre", value: Number(kpis.avgPricePerLitre || 0), format: "money", helper: "Blended across fuels", icon: "gauge" },
        ],
      },
      {
        title: "Queue and reservations",
        label: "Slide 2 of 3",
        cards: [
          { label: "Reservations", value: Number(reservationRows.length || 0), format: "number", helper: "Visible bookings", icon: "link" },
          { label: "Drivers served", value: Number(queueStats.served || 0), format: "number", helper: "Queue throughput", icon: "queue" },
          { label: "Average wait", value: Number(queueStats.avgWaitMin || kpis.queueAvgWaitMin || 0), format: "minutes", helper: "Current reporting window", icon: "gauge" },
          { label: "No-show rate", value: Number(queueStats.noShowRate || kpis.queueNoShowRate || 0), format: "percent", helper: "Queue reliability", icon: "alert" },
        ],
      },
      {
        title: "Forecourt readiness",
        label: "Slide 3 of 3",
        cards: [
          { label: "Pumps online", value: Number(activePumps || 0), format: "ratio", meta: { total: configuredPumps || 0 }, helper: "Available for service", icon: "pump" },
          { label: "Avg pump uptime", value: Number(avgPumpUptime || 0), format: "percent", helper: "Across configured pumps", icon: "gauge" },
          { label: "Inventory checks", value: Number(reportSnapshot?.inventoryReadings?.length || reconciliationRows.length || 0), format: "number", helper: "Tank readings reviewed", icon: "tank" },
          { label: "Variance litres", value: Number(varianceLitres || 0), format: "litres", helper: "Book vs recorded sales", icon: "variance" },
        ],
      },
    ]
  }, [pumpCards.length, reconciliationRows, reportSnapshot, reservationRows.length])
  const activeKpiSlide = kpiSlides[currentKpiSlide] || kpiSlides[0]
  const quickActions = [
    { label: "Reservations", action: () => navigate("/reservations"), icon: "link" },
    { label: "Reports", action: () => navigate("/reports"), icon: "charge" },
    { label: "Recharge", action: () => navigate("/help"), icon: "phone" },
  ]

  useEffect(() => {
    setBusinessMoodId(readBusinessMood(stationPublicId)?.id || "")
    setShowStationOverviewBriefing(false)
  }, [stationPublicId])

  const handleBusinessMoodRate = useCallback(
    (moodId) => {
      const nextMood = writeBusinessMood(stationPublicId, moodId)
      if (nextMood) {
        setBusinessMoodId(nextMood.id)
      }
    },
    [stationPublicId]
  )

  const handleBusinessMoodReset = useCallback(() => {
    clearBusinessMood(stationPublicId)
    setShowStationOverviewBriefing(false)
    setBusinessMoodId("")
  }, [stationPublicId])

  useEffect(() => {
    if (initialLoading || kpiSlides.length <= 1) return undefined
    const timerId = window.setTimeout(() => {
      setCurrentKpiSlide((prev) => (prev + 1) % kpiSlides.length)
    }, KPI_SLIDE_INTERVAL_MS)
    return () => window.clearTimeout(timerId)
  }, [currentKpiSlide, initialLoading, kpiSlides.length])

  const goToKpiSlide = useCallback(
    (slideIndex) => {
      setCurrentKpiSlide(Math.min(kpiSlides.length - 1, Math.max(0, slideIndex)))
    },
    [kpiSlides.length]
  )

  const goPreviousKpiSlide = useCallback(() => {
    setCurrentKpiSlide((prev) => (prev - 1 + kpiSlides.length) % kpiSlides.length)
  }, [kpiSlides.length])

  const goNextKpiSlide = useCallback(() => {
    setCurrentKpiSlide((prev) => (prev + 1) % kpiSlides.length)
  }, [kpiSlides.length])

  function StatGlyph({ type }) {
    if (type === "fuel") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />
        </svg>
      )
    }
    if (type === "money") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 9v6M18 9v6" />
        </svg>
      )
    }
    if (type === "pump") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4h8v16H6V4Z" />
          <path d="M8 8h4M14 8h2.5L19 11v6a2 2 0 0 0 2 2" />
        </svg>
      )
    }
    if (type === "gauge") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 14a8 8 0 1 1 16 0" />
          <path d="m12 14 4-4" />
          <path d="M7 18h10" />
        </svg>
      )
    }
    if (type === "queue") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <circle cx="17" cy="10" r="2.4" />
          <path d="M3 19a5 5 0 0 1 10 0" />
          <path d="M14 18a4 4 0 0 1 6-3.4" />
        </svg>
      )
    }
    if (type === "alert") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 21 20H3L12 3Z" />
          <path d="M12 9v5M12 17h.01" />
        </svg>
      )
    }
    if (type === "tank") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7c0-2 12-2 12 0v10c0 2-12 2-12 0V7Z" />
          <path d="M6 7c0 2 12 2 12 0" />
          <path d="M6 13c0 2 12 2 12 0" />
        </svg>
      )
    }
    if (type === "variance") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 16h4l3-8 3 8h6" />
          <path d="M6 8h4M14 8h4" />
        </svg>
      )
    }
    if (type === "invoice") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5" />
        </svg>
      )
    }
    if (type === "link") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.5 13.5 13.5 10.5" />
          <path d="M7.5 16.5a4 4 0 0 1 0-5.7l2.1-2.1a4 4 0 1 1 5.7 5.7l-.9.9" />
          <path d="M16.5 7.5a4 4 0 0 1 0 5.7l-2.1 2.1a4 4 0 1 1-5.7-5.7l.9-.9" />
        </svg>
      )
    }
    if (type === "bag") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 8h12l-1 11H7L6 8Z" />
          <path d="M9 9V7a3 3 0 0 1 6 0v2" />
        </svg>
      )
    }
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    )
  }

  return (
    <section className={`dashboard-replica ${initialLoading ? "is-loading" : ""}`} aria-busy={initialLoading}>
      <div className="dashboard-hero">
        <h1>Hi, {greetingName}</h1>
        <p>What would you like to do today?</p>
      </div>
      {initialLoading ? (
        <div className="dashboard-inline-loader" aria-live="polite">
          <span className="sm-skeleton-line" />
          <span className="sm-skeleton-line short" />
        </div>
      ) : null}

      <div className="dashboard-grid dashboard-grid-v2">
        <div className="dashboard-main-column">
          <article className="dashboard-verify-card dashboard-mood-card">
            <div className="dashboard-mood-swipe-viewport">
              <div className={`dashboard-mood-swipe-track ${selectedBusinessMood ? "is-overview" : ""}`}>
                <div className="dashboard-mood-pane" aria-hidden={selectedBusinessMood ? true : undefined}>
                  <div className="dashboard-mood-head">
                    <div>
                      <span className="dashboard-mood-eyebrow">Business pulse</span>
                      <h2>Rate how your business is going!</h2>
                    </div>
                  </div>
                  <div className="dashboard-mood-options" aria-label="Rate how your business is going">
                    {BUSINESS_MOOD_OPTIONS.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        style={{ "--mood-index": index }}
                        onClick={() => handleBusinessMoodRate(item.id)}
                        tabIndex={selectedBusinessMood ? -1 : 0}
                        aria-label={`${item.label}: ${item.response}`}
                      >
                        <picture className="dashboard-mood-animation">
                          <source srcSet={item.webpSrc} type="image/webp" />
                          <img src={item.gifSrc} alt={item.emoji} width="42" height="42" />
                        </picture>
                        <small>{item.label}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dashboard-mood-pane" aria-hidden={selectedBusinessMood ? undefined : true}>
                  {selectedBusinessMood ? (
                    <div className="dashboard-overview-prompt">
                      <div>
                        <span className="dashboard-mood-eyebrow">Today's status</span>
                        <h2>Check overview for the station</h2>
                      </div>
                      <div className="dashboard-overview-actions">
                        <span className="dashboard-mood-pill">
                          <picture className="dashboard-mood-animation">
                            <source srcSet={selectedBusinessMood.webpSrc} type="image/webp" />
                            <img src={selectedBusinessMood.gifSrc} alt={selectedBusinessMood.emoji} width="32" height="32" />
                          </picture>
                          {selectedBusinessMood.label}
                        </span>
                        <button
                          type="button"
                          className="dashboard-primary-btn"
                          onClick={() => setShowStationOverviewBriefing(true)}
                        >
                          Open AI briefing
                        </button>
                        <button
                          type="button"
                          className="dashboard-mood-reset"
                          onClick={handleBusinessMoodReset}
                        >
                          Change rating
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </article>

          <section className="dashboard-kpi-slider" aria-label="Operational KPI slides">
            <header className="dashboard-kpi-slider-head">
              <div>
                <h3>{activeKpiSlide.title}</h3>
              </div>
              <div className="dashboard-kpi-nav">
                <button type="button" onClick={goPreviousKpiSlide} aria-label="View previous KPI slide">
                  Previous
                </button>
                <button type="button" onClick={goNextKpiSlide} aria-label="View next KPI slide">
                  Next
                </button>
              </div>
            </header>

            <div className="dashboard-kpi-viewport">
              <div className="dashboard-kpi-track" style={{ transform: `translateX(-${currentKpiSlide * 100}%)` }}>
                {kpiSlides.map((slide, slideIndex) => (
                  <article
                    key={slide.title}
                    className="dashboard-kpi-slide"
                    aria-hidden={currentKpiSlide !== slideIndex}
                  >
                    <div className="dashboard-stat-grid dashboard-kpi-grid">
                      {slide.cards.map((item) => (
                        <article key={item.label} className="dashboard-stat-card dashboard-kpi-card">
                          <div className="dashboard-stat-top">
                            <span>{item.label}</span>
                            <span className="dashboard-stat-glyph"><StatGlyph type={item.icon} /></span>
                          </div>
                          <AnimatedDashboardValue value={item.value} format={item.format} meta={item.meta} />
                          <small>{item.helper}</small>
                        </article>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <footer className="dashboard-kpi-footer">
              <div className="dashboard-kpi-dots" aria-label="KPI slide indicators">
                {kpiSlides.map((slide, index) => (
                  <button
                    key={slide.title}
                    type="button"
                    className={currentKpiSlide === index ? "is-active" : ""}
                    onClick={() => goToKpiSlide(index)}
                    aria-label={`View ${slide.title} KPI slide`}
                    aria-current={currentKpiSlide === index ? "step" : undefined}
                  />
                ))}
              </div>
              <span>{currentKpiSlide + 1} / {kpiSlides.length}</span>
            </footer>
          </section>

          <div className="dashboard-lower-grid">
            <article className="dashboard-surface-card">
              <header className="dashboard-section-head">
                <h3>Recent Transactions</h3>
                <button type="button" className="dashboard-ghost-btn" onClick={() => navigate("/transactions")}>View all</button>
              </header>
              {recentTransactionRows.length ? (
                <div className="dashboard-activity-list">
                  {recentTransactionRows.slice(0, 4).map((row, index) => (
                    <div key={`tx-${row.id || index}`} className="dashboard-activity-row">
                      <span className="dashboard-activity-dot" />
                      <div className="dashboard-activity-copy">
                        <strong>{row.amount}</strong>
                        <p>{row.name} · {row.sub}</p>
                      </div>
                      <span>{row.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No recent transactions at the moment." />
              )}
            </article>

            <article className="dashboard-surface-card">
              <header className="dashboard-section-head">
                <h3>Tank Levels</h3>
                <button type="button" className="dashboard-ghost-btn" onClick={togglePumpTotalsCard}>{showPumpTotals ? "Status view" : "Totals view"}</button>
              </header>
              <div className="dashboard-tank-list">
                {(reconciliationRows.length ? reconciliationRows : [{ id: "T1", tank: "Tank 1", actual: 56 }, { id: "T2", tank: "Tank 2", actual: 72 }, { id: "T3", tank: "Tank 3", actual: 34 }]).slice(0, 3).map((row, idx) => {
                  const pctSource = row.tankLevelPercent ?? row.actual ?? 0
                  const pct = Math.max(1, Math.min(100, Number(pctSource)))
                  return (
                    <div key={row.id || row.tank || idx} className="dashboard-tank-row">
                      <div>
                        <strong>{row.tank || `Tank ${idx + 1}`}</strong>
                        <p>{row.fuelType || "Fuel"}</p>
                      </div>
                      <div className="dashboard-tank-meter"><em style={{ width: `${pct}%` }} /></div>
                      <AnimatedDashboardValue as="span" value={pct} format="percentInteger" />
                    </div>
                  )
                })}
              </div>
            </article>
          </div>
        </div>

        <aside className="dashboard-side-column">
          <article className="dashboard-quick-card">
            <h3>Quick Actions</h3>
            <div className="dashboard-quick-list">
              {quickActions.map((item) => (
                <button key={item.label} type="button" className="dashboard-quick-action" onClick={item.action}>
                  <span className="dashboard-quick-icon"><StatGlyph type={item.icon} /></span>
                  <span>{item.label}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
          </article>

          <article className="dashboard-members-card">
            <div className="dashboard-members-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="9" cy="9" r="3" />
                <path d="M4 19a5 5 0 0 1 10 0" />
                <circle cx="17.5" cy="8" r="2.3" />
              </svg>
            </div>
            <div className="dashboard-members-divider" />
            <div className="dashboard-members-copy">
              <h3>Business members</h3>
              <p>{currentStationName}</p>
            </div>
            <div className="dashboard-members-list">
              {(memberRows.length ? memberRows : [{ station: { name: currentStationName }, role: session?.role || "MANAGER" }]).map((row, index) => (
                <div key={`${row.station?.publicId || row.role}-${index}`} className="dashboard-member-row">
                  <span className="dashboard-member-avatar">{(greetingName || "SM").slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{session?.user?.fullName || "Station Manager"}</strong>
                    <p>{row.role || "MANAGER"}</p>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="dashboard-fab" onClick={() => navigate("/account")} aria-label="Open team space">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M5 12h10M5 17h8" />
              </svg>
            </button>
          </article>
        </aside>
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
      {showStationOverviewBriefing ? (
        <div className="login-briefing-backdrop" aria-modal="true">
          <LoginBriefing
            briefing={stationOverviewBriefing}
            managerName={greetingName}
            onDismiss={() => setShowStationOverviewBriefing(false)}
          />
        </div>
      ) : null}
    </section>
  )
}

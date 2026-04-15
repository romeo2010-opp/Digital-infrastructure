import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Navbar from "../../components/Navbar"
import { ReportTabEnum } from "./types"
import { reportsData } from "../../config/dataSource"
import ReportsHeaderBar from "./components/ReportsHeaderBar"
import ReportsActionsBar from "./components/ReportsActionsBar"
import KpiSummaryRow from "./components/KpiSummaryRow"
import ReportsTabs from "./components/ReportsTabs"
import SalesReportSection from "./components/SalesReportSection"
import InventoryReconciliationSection from "./components/InventoryReconciliationSection"
import PumpPerformanceSection from "./components/PumpPerformanceSection"
import QueuePerformanceSection from "./components/QueuePerformanceSection"
import SettlementReportSection from "./components/SettlementReportSection"
import DemandAnomalySection from "./components/DemandAnomalySection"
import ExceptionsAuditSection from "./components/ExceptionsAuditSection"
import NotesSignoffSection from "./components/NotesSignoffSection"
import { formatDateTime, getAppTimeZone, utcTodayISO, zonedDateTimeToUtcMs } from "../../utils/dateTime"
import { subscribeOfflineState } from "../../offline/network"
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher"
import { STATION_PLAN_FEATURES } from "../../subscription/planCatalog"
import { useStationPlan } from "../../subscription/useStationPlan"
import "./reports.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

function todayISO() {
  return utcTodayISO()
}

function toStationBoundaryIso(datePart, timePart) {
  const utcMs = zonedDateTimeToUtcMs(datePart, timePart, getAppTimeZone())
  return Number.isFinite(utcMs) ? new Date(utcMs).toISOString() : null
}

export default function StationReportsPage() {
  const stationPlan = useStationPlan()
  const [filters, setFilters] = useState({
    preset: "TODAY",
    fromDate: todayISO(),
    toDate: todayISO(),
    shift: "ALL",
    fuelType: "ALL",
    pumpId: "ALL",
  })
  const [snapshot, setSnapshot] = useState(null)
  const [activeTab, setActiveTab] = useState(ReportTabEnum.INVENTORY)
  const [toast, setToast] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [includeAuditInPdf, setIncludeAuditInPdf] = useState(true)
  const [exportStatusMessage, setExportStatusMessage] = useState("")
  const salesRef = useRef(null)
  const inventoryRef = useRef(null)
  const pumpsRef = useRef(null)
  const queueRef = useRef(null)
  const settlementsRef = useRef(null)
  const demandRef = useRef(null)
  const exceptionsRef = useRef(null)
  const [anomalyWindow, setAnomalyWindow] = useState("15m")
  const [anomalyMetrics, setAnomalyMetrics] = useState([])
  const [anomalyEvents, setAnomalyEvents] = useState([])
  const [anomalyGeneratedAt, setAnomalyGeneratedAt] = useState(null)
  const [anomalyLoading, setAnomalyLoading] = useState(false)
  const [anomalyError, setAnomalyError] = useState("")
  const anomalyWindowRef = useRef(anomalyWindow)

  const sectionRefByTab = useMemo(
    () => ({
      SALES: salesRef,
      INVENTORY: inventoryRef,
      PUMPS: pumpsRef,
      QUEUE: queueRef,
      SETTLEMENTS: settlementsRef,
      DEMAND: demandRef,
      EXCEPTIONS: exceptionsRef,
    }),
    []
  )

  function showToast(message) {
    setToast(message)
    window.clearTimeout(showToast.timerId)
    showToast.timerId = window.setTimeout(() => setToast(""), 2200)
  }
  showToast.timerId = showToast.timerId || 0

  const showError = useCallback((error) => {
    const message = error?.message || "Something went wrong. Please try again."
    setErrorMessage(message)
  }, [])

  const refresh = useCallback(async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      setAnomalyError("")
      const insightsEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)
      setAnomalyLoading(insightsEnabled)
      const fromIso = toStationBoundaryIso(filters.fromDate, "00:00:00")
      const toIso = toStationBoundaryIso(filters.toDate, "23:59:59")
      const [snapshotResult, metricsResult, eventsResult] = await Promise.allSettled([
        reportsData.getReportSnapshot(filters),
        insightsEnabled
          ? reportsData.getDemandMetrics({ window: anomalyWindowRef.current })
          : Promise.resolve({ metrics: [], generatedAt: null }),
        insightsEnabled
          ? reportsData.getDemandAnomalies({ from: fromIso, to: toIso })
          : Promise.resolve({ items: [] }),
      ])

      if (snapshotResult.status !== "fulfilled") {
        throw snapshotResult.reason
      }

      setSnapshot(snapshotResult.value)

      if (metricsResult.status === "fulfilled") {
        setAnomalyMetrics(metricsResult.value?.metrics || [])
        setAnomalyGeneratedAt(metricsResult.value?.generatedAt || null)
      } else {
        setAnomalyMetrics([])
        setAnomalyGeneratedAt(null)
        setAnomalyError(metricsResult.reason?.message || "Unable to load anomaly metrics")
      }

      if (eventsResult.status === "fulfilled") {
        setAnomalyEvents(eventsResult.value?.items || [])
      } else {
        setAnomalyEvents([])
        if (!metricsResult.reason) {
          setAnomalyError(eventsResult.reason?.message || "Unable to load anomaly events")
        }
      }
    } catch (error) {
      showError(error)
    } finally {
      setAnomalyLoading(false)
      if (showLoader) setLoading(false)
    }
  }, [filters, showError, stationPlan])

  async function runAction(action, successMessage = "") {
    try {
      // TODO: route through API client and centralized error handling once backend is ready.
      const result = await action()
      const isQueued = Boolean(result?.queued)
      if (isQueued) {
        if (typeof result?.optimisticUpdater === "function") {
          setSnapshot((prev) => result.optimisticUpdater(prev))
        }
        if (successMessage) showToast(`${successMessage} (queued)`)
        return
      }

      const next = await reportsData.getReportSnapshot(filters)
      setSnapshot(next)
      const fromIso = toStationBoundaryIso(filters.fromDate, "00:00:00")
      const toIso = toStationBoundaryIso(filters.toDate, "23:59:59")
      const insightsEnabled = stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)
      const [metricsResult, eventsResult] = await Promise.allSettled([
        insightsEnabled
          ? reportsData.getDemandMetrics({ window: anomalyWindowRef.current })
          : Promise.resolve({ metrics: [], generatedAt: null }),
        insightsEnabled
          ? reportsData.getDemandAnomalies({ from: fromIso, to: toIso })
          : Promise.resolve({ items: [] }),
      ])
      if (metricsResult.status === "fulfilled") {
        setAnomalyMetrics(metricsResult.value?.metrics || [])
        setAnomalyGeneratedAt(metricsResult.value?.generatedAt || null)
      }
      if (eventsResult.status === "fulfilled") {
        setAnomalyEvents(eventsResult.value?.items || [])
      }
      if (successMessage) showToast(successMessage)
    } catch (error) {
      showError(error)
    }
  }

  const visibleTabs = useMemo(() => {
    const tabs = [
      { id: ReportTabEnum.INVENTORY, label: "Reconciliation" },
      { id: ReportTabEnum.SALES, label: "Sales" },
    ]

    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE)) {
      tabs.push({ id: ReportTabEnum.PUMPS, label: "Pumps" })
      tabs.push({ id: ReportTabEnum.EXCEPTIONS, label: "Exceptions & Audit" })
    }
    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)) {
      tabs.push({ id: ReportTabEnum.QUEUE, label: "Queue" })
    }
    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS)) {
      tabs.push({ id: ReportTabEnum.SETTLEMENTS, label: "Settlements" })
    }
    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)) {
      tabs.push({ id: ReportTabEnum.DEMAND, label: "Demand Anomalies" })
    }

    return tabs
  }, [stationPlan])

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return
    setActiveTab(visibleTabs[0]?.id || ReportTabEnum.INVENTORY)
  }, [activeTab, visibleTabs])

  async function runExport(action, successMessage = "") {
    try {
      setExportStatusMessage("Almost ready. Preparing your download...")
      await action()
      if (successMessage) showToast(successMessage)
    } catch (error) {
      showError(error)
    } finally {
      setExportStatusMessage("")
    }
  }

  function selectTab(tab) {
    setActiveTab(tab)
    window.setTimeout(() => {
      sectionRefByTab[tab]?.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 10)
  }

  useEffect(() => {
    anomalyWindowRef.current = anomalyWindow
  }, [anomalyWindow])

  useEffect(() => {
    refresh({ showLoader: true })
  }, [refresh])

  useEffect(() => {
    if (!snapshot) return
    refresh({ showLoader: false })
  }, [anomalyWindow]) // eslint-disable-line react-hooks/exhaustive-deps

  useStationChangeWatcher({
    onChange: async () => {
      await refresh({ showLoader: false })
    },
  })

  useEffect(() => subscribeOfflineState((state) => setPendingSyncCount(state.pendingCount || 0)), [])

  const navbarAlerts = useMemo(() => {
    const alerts = []
    if (errorMessage) {
      alerts.push({
        id: "reports-error",
        type: "ERROR",
        title: "System Error",
        body: errorMessage,
      })
    }

    const warningRows = snapshot?.exceptions?.warnings || []
    warningRows.forEach((warning, index) => {
      alerts.push({
        id: `report-warning-${index}`,
        type: "ERROR",
        title: "Report Warning",
        body: warning,
      })
    })

    const incidentRows = snapshot?.incidents || []
    incidentRows.forEach((incident) => {
      alerts.push({
        id: `incident-${incident.id}`,
        type: "ERROR",
        title: `Incident: ${incident.title}`,
        body: `${incident.severity} · ${incident.status}`,
        meta: formatDateTime(incident.createdAt),
      })
    })

    const noteRows = (snapshot?.notes || []).slice(0, 10)
    noteRows.forEach((note) => {
      alerts.push({
        id: `note-${note.id}`,
        type: "ADMIN",
        title: `Admin Message: ${note.author || "Manager"}`,
        body: note.text,
        meta: formatDateTime(note.createdAt),
      })
    })

    const criticalDemandRows = (anomalyMetrics || []).filter(
      (metric) => String(metric.severity || "").toUpperCase() === "CRITICAL"
    )
    criticalDemandRows.forEach((metric) => {
      alerts.push({
        id: `critical-demand-${metric.fuelType}`,
        type: "ERROR",
        title: `Critical demand anomaly (${metric.fuelType})`,
        body: `Velocity ${Number(metric.salesVelocityLph || 0).toFixed(2)} L/h vs expected ${Number(metric.expectedMeanLph || 0).toFixed(2)} L/h`,
        meta: anomalyGeneratedAt ? formatDateTime(anomalyGeneratedAt) : "",
      })
    })

    return alerts.slice(0, 25)
  }, [anomalyGeneratedAt, anomalyMetrics, snapshot, errorMessage])

  if (!snapshot || loading) {
    return (
      <div className="reports-page">
        <Navbar pagetitle="Station Reports" image={avatar} count={navbarAlerts.length} alerts={navbarAlerts} />
        <section className="reports-shell">
          <p className="reports-empty">Loading reports...</p>
        </section>
      </div>
    )
  }

  const isFinal = snapshot.reportRun.status === "FINAL"

  return (
    <div className="reports-page">
      <Navbar pagetitle="Station Reports" image={avatar} count={navbarAlerts.length} alerts={navbarAlerts} />

      <section className="reports-shell">
        {pendingSyncCount > 0 ? (
          <p className="reports-offline-pending">Offline data pending sync</p>
        ) : null}
        
        <p className="reports-offline-pending">
          Active plan: {stationPlan.planName}. {stationPlan.hasFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT) ? "Advanced report export is enabled." : "Advanced report export unlocks on Enterprise Network."}
        </p>
        <ReportsHeaderBar filters={filters} pumps={snapshot.pumps} onChange={setFilters} />
        <ReportsActionsBar
          run={snapshot.reportRun}
          isFinal={isFinal}
          isExporting={Boolean(exportStatusMessage)}
          canExport={stationPlan.hasFeature(STATION_PLAN_FEATURES.REPORTS_EXPORT)}
          exportNotice="Advanced report exports unlock on Enterprise Network."
          toast={toast}
          includeAuditInPdf={includeAuditInPdf}
          onIncludeAuditChange={setIncludeAuditInPdf}
          onGenerate={() => runAction(() => reportsData.generateReport(filters), "Report run generated")}
          onRefresh={() => runAction(() => Promise.resolve(), "Snapshot refreshed")}
          onExportCsv={() =>
            runExport(
              () => reportsData.exportCsv(activeTab.toLowerCase(), filters),
              "CSV download started"
            )
          }
          onExportPdf={() =>
            runExport(
              () => reportsData.exportPdf(filters, { includeAudit: includeAuditInPdf }),
              `PDF download started${includeAuditInPdf ? " (with audit logs)" : " (without audit logs)"}`
            )
          }
        />
        <KpiSummaryRow kpis={snapshot.kpis} onSelectTab={selectTab} allowedTabs={visibleTabs.map((tab) => tab.id)} />
        <ReportsTabs activeTab={activeTab} onChange={setActiveTab} tabs={visibleTabs} />

        <div ref={salesRef}>
          {activeTab === ReportTabEnum.SALES ? <SalesReportSection sales={snapshot.sales} /> : null}
        </div>
        <div ref={inventoryRef}>
          {activeTab === ReportTabEnum.INVENTORY ? (
            <InventoryReconciliationSection
              rows={snapshot.reconciliation}
              isReadOnly={isFinal}
              onAddDelivery={(payload) => runAction(() => reportsData.addDeliveryRecord(payload), "Delivery added")}
              onAddReading={(payload) => runAction(() => reportsData.addOpeningClosingReadings(payload), "Readings updated")}
              onExplainVariance={(rowId, reason, note) =>
                runAction(() => reportsData.explainVariance(rowId, reason, note), "Variance explanation saved")
              }
              onCreateIncident={(payload) =>
                runAction(() => reportsData.createIncident(payload), "Incident created")
              }
            />
          ) : null}
        </div>
        <div ref={pumpsRef}>
          {activeTab === ReportTabEnum.PUMPS && stationPlan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE)
            ? <PumpPerformanceSection rows={snapshot.pumps} />
            : null}
        </div>
        <div ref={queueRef}>
          {activeTab === ReportTabEnum.QUEUE && stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
            ? <QueuePerformanceSection queue={snapshot.queue} />
            : null}
        </div>
        <div ref={settlementsRef}>
          {activeTab === ReportTabEnum.SETTLEMENTS && stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS)
            ? <SettlementReportSection settlements={snapshot.settlements} />
            : null}
        </div>
        <div ref={demandRef}>
          {activeTab === ReportTabEnum.DEMAND && stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS) ? (
            <DemandAnomalySection
              metrics={anomalyMetrics}
              events={anomalyEvents}
              loading={anomalyLoading}
              error={anomalyError}
              windowValue={anomalyWindow}
              generatedAt={anomalyGeneratedAt}
              onWindowChange={(nextWindow) => setAnomalyWindow(nextWindow)}
            />
          ) : null}
        </div>
        <div ref={exceptionsRef}>
          {activeTab === ReportTabEnum.EXCEPTIONS && stationPlan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE) ? (
            <ExceptionsAuditSection audit={snapshot.audit} incidents={snapshot.incidents} notes={snapshot.notes} exceptions={snapshot.exceptions} />
          ) : null}
        </div>

        <NotesSignoffSection
          reportRun={snapshot.reportRun}
          notes={snapshot.notes}
          onAddNote={(text) => runAction(() => reportsData.addNote(text), "Draft note saved")}
          onFinalize={(reportRunId) =>
            runAction(() => reportsData.finalizeReport(reportRunId, filters), "Report finalized")
          }
          onUnfinalize={(reportRunId) =>
            runAction(() => reportsData.unfinalizeReport(reportRunId, filters), "Report reopened")
          }
        />
      </section>

      {errorMessage ? (
        <div className="reports-error-backdrop" role="alertdialog" aria-modal="true" aria-label="Error">
          <div className="reports-error-modal">
            <h3>Action failed</h3>
            <p>{errorMessage}</p>
            <div className="reports-error-actions">
              <button type="button" onClick={() => setErrorMessage("")}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {exportStatusMessage ? (
        <div className="reports-export-backdrop" role="status" aria-live="polite" aria-label="Preparing download">
          <div className="reports-export-loading">
            <h3>Almost Ready</h3>
            <p>{exportStatusMessage}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

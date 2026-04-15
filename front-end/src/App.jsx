import { useEffect, useMemo, useState } from "react"
import { BrowserRouter as Router, Routes, Route, matchPath, useLocation, useNavigate } from "react-router-dom";
import './assets/sidebar.css'
import Sidebar from './components/SideBar'
import Dashboard from './pages/Dashboard'
import Reservations from './pages/Reservations'
import DigitalQueue from './pages/DigitalQueue'
import StationReportsPage from './features/reports/StationReportsPage'
import StationInsightsPage from "./features/insights/StationInsightsPage"
import StationSettingsPage from './features/settings/StationSettingsPage'
import StationPromotionsPage from "./features/promotions/StationPromotionsPage"
import InboxPage from "./features/inbox/InboxPage"
import GetHelpPage from "./features/help/GetHelpPage"
import MyAccountPage from "./features/account/MyAccountPage"
import TransactionsTestPage from "./pages/TransactionsTestPage"
import LivePumpMonitoringPage from "./features/monitoring/LivePumpMonitoringPage"
import Login from './pages/Login'
import { useAuth } from "./auth/AuthContext";
import { accountApi } from "./api/accountApi";
import { applyThemePreference, getStoredThemePreference } from "./utils/theme";
import { startSyncEngine, stopSyncEngine } from "./offline/sync";
import { AppShellProvider, useAppShell } from "./layout/AppShellContext";
import PlanLockedPage from "./subscription/PlanLockedPage";
import { STATION_PLAN_FEATURES } from "./subscription/planCatalog";
import { useStationPlan } from "./subscription/useStationPlan";

const APP_NAME = "SmartLink"
const ROUTE_TITLES = [
  { path: "/", title: "Dashboard" },
  { path: "/reservations", title: "Reservations" },
  { path: "/digitalQueue", title: "Digital Queue" },
  { path: "/reports", title: "Reports" },
  { path: "/insights", title: "Insights" },
  { path: "/promotions", title: "Promotions" },
  { path: "/settings", title: "Settings" },
  { path: "/inbox", title: "Inbox" },
  { path: "/help", title: "Help" },
  { path: "/account", title: "My Account" },
  { path: "/transactions-test", title: "Transactions" },
  { path: "/monitoring/pumps/:pumpId", title: "Live Monitoring" },
]

function resolveRouteTitle(pathname, isAuthenticated) {
  if (!isAuthenticated) return "Login"

  for (const route of ROUTE_TITLES) {
    if (matchPath({ path: route.path, end: true }, pathname)) {
      return route.title
    }
  }

  return "Dashboard"
}

function RouteTitleSync({ isAuthenticated }) {
  const location = useLocation()

  useEffect(() => {
    const pageTitle = resolveRouteTitle(location.pathname, isAuthenticated)
    document.title = `${pageTitle} | ${APP_NAME}`
  }, [location.pathname, isAuthenticated])

  return null
}

function buildWelcomeTourSteps(plan) {
  const steps = [
    {
      title: "Welcome to your station workspace",
      body: "This dashboard gives you the fastest view of station performance, operational movement, and current activity.",
      items: ["Use Dashboard for your daily snapshot.", "Watch alerts and current activity before opening operations."],
    },
    {
      title: "Use the tools in your plan",
      body: `${plan.planName} is currently active for this station at ${plan.priceLabel}.`,
      items: [
        "Use Reports, Get Help, and My Account as your daily management baseline.",
        plan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE)
          ? "Your plan includes station setup controls in Settings."
          : "Your current plan does not include full setup controls yet.",
        plan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
          ? "Digital Queue and Reservations are available for live operations."
          : "Digital Queue and Reservations unlock on Growth Operations.",
      ],
    },
  ]

  if (plan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)) {
    steps.push({
      title: "Advanced intelligence is enabled",
      body: "Enterprise features are active for this station.",
      items: [
        "Use Insights for forecasting, anomaly detection, and advanced operational analytics.",
        "Download advanced reports directly from the Reports and Insights modules.",
      ],
    })
  } else {
    steps.push({
      title: "Upgrade path",
      body: "Some advanced SmartLink modules are plan-gated.",
      items: [
        "Growth unlocks queue operations, reservations, transaction tracking, and live monitoring.",
        "Enterprise adds SmartLink Insights and advanced report exports.",
      ],
    })
  }

  return steps
}

function StationSelectionDialog({ memberships, currentStationPublicId, onSelect, onClose }) {
  const [pendingStationId, setPendingStationId] = useState("")
  const [error, setError] = useState("")

  async function handleSelect(stationPublicId) {
    if (!stationPublicId || stationPublicId === pendingStationId) return
    setPendingStationId(stationPublicId)
    setError("")
    try {
      await onSelect(stationPublicId)
    } catch (selectError) {
      setError(selectError?.message || "Unable to switch station")
    } finally {
      setPendingStationId("")
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1600,
        background: "rgba(15, 23, 42, 0.42)",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          borderRadius: "16px",
          border: "1px solid #d9e3ef",
          background: "linear-gradient(180deg, #fbfdff 0%, #f1f5fa 100%)",
          boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
          padding: "22px",
          boxSizing: "border-box",
        }}
      >
        <header style={{ marginBottom: "16px", textAlign: "left" }}>
          <h2 style={{ margin: 0, color: "#16385f", fontSize: "24px", fontWeight: 700 }}>Choose a station</h2>
          <p style={{ margin: "8px 0 0", color: "#547293", fontSize: "14px", lineHeight: 1.45 }}>
            This account is linked to multiple stations. Select the station workspace you want to enter.
          </p>
        </header>

        <div style={{ display: "grid", gap: "12px" }}>
          {memberships.map((membership) => {
            const stationPublicId = membership?.station?.publicId || ""
            const isCurrent = stationPublicId === currentStationPublicId
            const isPending = pendingStationId === stationPublicId
            return (
              <button
                key={stationPublicId}
                type="button"
                onClick={() => handleSelect(stationPublicId)}
                disabled={isPending}
                style={{
                  textAlign: "left",
                  borderRadius: "14px",
                  border: isCurrent ? "1px solid #8fb4dc" : "1px solid #d5e1ef",
                  background: isCurrent ? "#eaf3ff" : "#ffffff",
                  padding: "16px 18px",
                  cursor: isPending ? "wait" : "pointer",
                }}
              >
                <strong style={{ display: "block", color: "#1a416c", fontSize: "16px" }}>
                  {membership?.station?.name || "Unnamed station"}
                </strong>
                <span style={{ display: "block", marginTop: "4px", color: "#5f7e9f", fontSize: "13px" }}>
                  Role: {membership?.role || "VIEWER"}
                </span>
                {isCurrent ? (
                  <span style={{ display: "inline-block", marginTop: "8px", color: "#23588f", fontSize: "12px", fontWeight: 700 }}>
                    Current station
                  </span>
                ) : null}
                {isPending ? (
                  <span style={{ display: "inline-block", marginTop: "8px", color: "#23588f", fontSize: "12px", fontWeight: 700 }}>
                    Switching...
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {error ? (
          <p style={{ margin: "14px 0 0", color: "#a13030", fontSize: "13px", textAlign: "left" }}>{error}</p>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(pendingStationId)}
            style={{
              height: "38px",
              borderRadius: "10px",
              border: "1px solid #cad8e8",
              background: "#ffffff",
              color: "#2d557e",
              padding: "0 14px",
              fontWeight: 600,
              cursor: pendingStationId ? "not-allowed" : "pointer",
            }}
          >
            Continue with current station
          </button>
        </div>
      </div>
    </div>
  )
}

function WelcomeTourModal({ open, stepIndex, saving, error, onNext, onBack, onFinish }) {
  if (!open) return null
  const steps = open.steps || []
  const step = steps[stepIndex] || steps[0]
  const isLastStep = stepIndex >= steps.length - 1

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1700,
        background: "rgba(15, 23, 42, 0.52)",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "min(680px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          borderRadius: "20px",
          border: "1px solid #d9e3ef",
          background: "linear-gradient(180deg, #fbfdff 0%, #f1f5fa 100%)",
          boxShadow: "0 28px 56px rgba(15, 23, 42, 0.22)",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        <header style={{ display: "grid", gap: "8px", marginBottom: "18px" }}>
          <span style={{ color: "#5b7a9a", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            First Login Tour · Step {stepIndex + 1} of {steps.length}
          </span>
          <h2 style={{ margin: 0, color: "#16385f", fontSize: "26px", fontWeight: 800 }}>{step.title}</h2>
          <p style={{ margin: 0, color: "#547293", fontSize: "14px", lineHeight: 1.55 }}>{step.body}</p>
        </header>

        <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
          {step.items.map((item) => (
            <div
              key={item}
              style={{
                borderRadius: "14px",
                border: "1px solid #d9e3ef",
                background: "#ffffff",
                padding: "14px 16px",
                color: "#24476d",
                fontSize: "14px",
                lineHeight: 1.45,
              }}
            >
              {item}
            </div>
          ))}
        </div>

        {error ? <p style={{ margin: "0 0 14px", color: "#a13030", fontSize: "13px" }}>{error}</p> : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onBack}
            disabled={saving || stepIndex === 0}
            style={{
              height: "40px",
              borderRadius: "10px",
              border: "1px solid #cad8e8",
              background: "#ffffff",
              color: "#2d557e",
              padding: "0 14px",
              fontWeight: 600,
              cursor: saving || stepIndex === 0 ? "not-allowed" : "pointer",
            }}
          >
            Back
          </button>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {!isLastStep ? (
              <button
                type="button"
                onClick={onFinish}
                disabled={saving}
                style={{
                  height: "40px",
                  borderRadius: "10px",
                  border: "1px solid #cad8e8",
                  background: "#ffffff",
                  color: "#2d557e",
                  padding: "0 14px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Skip tour"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={isLastStep ? onFinish : onNext}
              disabled={saving}
              style={{
                height: "40px",
                borderRadius: "10px",
                border: "1px solid #1f4e89",
                background: "#1f4e89",
                color: "#ffffff",
                padding: "0 16px",
                fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving..." : isLastStep ? "Finish tour" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AppRouterFrame({
  loading,
  isAuthenticated,
  session,
  showStationPicker,
  closeStationPicker,
  switchStation,
  welcomeTourSteps,
  welcomeTourOpen,
  welcomeTourStep,
  welcomeTourSaving,
  welcomeTourError,
  setWelcomeTourStep,
  finishWelcomeTour,
}) {
  const stationPlan = useStationPlan()
  const { isMobile, isSidebarOpen } = useAppShell()
  const location = useLocation()
  const navigate = useNavigate()
  const backgroundLocation = location.state?.backgroundLocation || null
  const isSettingsModalOpen = isAuthenticated && location.pathname === "/settings"

  function closeSettingsModal() {
    if (backgroundLocation) {
      navigate(-1)
      return
    }
    navigate("/", { replace: true })
  }

  return (
    <>
      <RouteTitleSync isAuthenticated={isAuthenticated} />
      {isAuthenticated ? <Sidebar /> : null}
      <main
        className={`app-main ${isAuthenticated ? "app-main--auth" : ""} ${
          isMobile && isSidebarOpen ? "app-main--nav-open" : ""
        }`}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          gridColumn: isAuthenticated ? "auto" : "1 / -1",
        }}
      >
        {isAuthenticated ? (
          <Routes location={backgroundLocation || location}>
            <Route path="/" element={<Dashboard />} />
            <Route
              path="/reservations"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.RESERVATIONS)
                  ? <Reservations />
                  : <PlanLockedPage title="Reservations" featureName="Reservations" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.RESERVATIONS)} />
              }
            />
            <Route
              path="/digitalQueue"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)
                  ? <DigitalQueue />
                  : <PlanLockedPage title="Digital Queue" featureName="Digital Queue" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.DIGITAL_QUEUE)} />
              }
            />
            <Route path="/reports" element={<StationReportsPage />} />
            <Route
              path="/insights"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.INSIGHTS)
                  ? <StationInsightsPage />
                  : <PlanLockedPage title="Insights" featureName="SmartLink Insights" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.INSIGHTS)} />
              }
            />
            <Route
              path="/promotions"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD)
                  ? <StationPromotionsPage />
                  : <PlanLockedPage title="Promotions" featureName="Promotion management" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD)} />
              }
            />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/help" element={<GetHelpPage />} />
            <Route path="/account" element={<MyAccountPage />} />
            <Route
              path="/transactions-test"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD)
                  ? <TransactionsTestPage />
                  : <PlanLockedPage title="Transactions" featureName="Transaction recording" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.TRANSACTIONS_RECORD)} />
              }
            />
            <Route
              path="/monitoring/pumps/:pumpId"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.MONITORING)
                  ? <LivePumpMonitoringPage />
                  : <PlanLockedPage title="Live Monitoring" featureName="Live monitoring" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.MONITORING)} />
              }
            />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="*" element={<Login bootstrapping={loading} />} />
          </Routes>
        )}
      </main>
      {isSettingsModalOpen ? <StationSettingsPage modal onClose={closeSettingsModal} /> : null}
      {isAuthenticated && showStationPicker ? (
        <StationSelectionDialog
          memberships={session?.stationMemberships || []}
          currentStationPublicId={session?.station?.publicId || ""}
          onSelect={switchStation}
          onClose={closeStationPicker}
        />
      ) : null}
      <WelcomeTourModal
        open={Boolean(isAuthenticated && welcomeTourOpen && !showStationPicker) ? { steps: welcomeTourSteps } : null}
        stepIndex={welcomeTourStep}
        saving={welcomeTourSaving}
        error={welcomeTourError}
        onBack={() => setWelcomeTourStep((current) => Math.max(0, current - 1))}
        onNext={() => setWelcomeTourStep((current) => Math.min(welcomeTourSteps.length - 1, current + 1))}
        onFinish={finishWelcomeTour}
      />
    </>
  )
}

function AppContent() {
  const {
    loading,
    isAuthenticated,
    isApiMode,
    session,
    showStationPicker,
    closeStationPicker,
    switchStation,
  } = useAuth()
  const stationPlan = useStationPlan()
  const welcomeTourSteps = useMemo(() => buildWelcomeTourSteps(stationPlan), [stationPlan])
  const [preferences, setPreferences] = useState(null)
  const [welcomeTourOpen, setWelcomeTourOpen] = useState(false)
  const [welcomeTourStep, setWelcomeTourStep] = useState(0)
  const [welcomeTourSaving, setWelcomeTourSaving] = useState(false)
  const [welcomeTourError, setWelcomeTourError] = useState("")

  useEffect(() => {
    const storedPreference = getStoredThemePreference() || "SYSTEM"
    applyThemePreference(storedPreference)

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const onMediaChange = () => {
      const preference = getStoredThemePreference() || "SYSTEM"
      if (preference === "SYSTEM") {
        applyThemePreference("SYSTEM")
      }
    }
    mediaQuery.addEventListener("change", onMediaChange)
    return () => mediaQuery.removeEventListener("change", onMediaChange)
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !isApiMode) return
    let canceled = false
    ;(async () => {
      try {
        const preferences = await accountApi.getPreferences()
        if (canceled) return
        setPreferences(preferences || null)
        applyThemePreference(preferences?.theme || "SYSTEM")
      } catch {
        // noop: keep stored or system theme
      }
    })()
    return () => {
      canceled = true
    }
  }, [isAuthenticated, isApiMode])

  useEffect(() => {
    if (!isAuthenticated || !isApiMode) {
      setWelcomeTourOpen(false)
      return
    }
    if (showStationPicker) return
    if (preferences && !preferences.completedWelcomeTour) {
      setWelcomeTourStep(0)
      setWelcomeTourOpen(true)
      setWelcomeTourError("")
    }
  }, [isApiMode, isAuthenticated, preferences, showStationPicker])

  async function finishWelcomeTour() {
    if (!isApiMode) {
      setWelcomeTourOpen(false)
      return
    }
    setWelcomeTourSaving(true)
    setWelcomeTourError("")
    try {
      const updated = await accountApi.updatePreferences({ completedWelcomeTour: true })
      setPreferences(updated || { ...(preferences || {}), completedWelcomeTour: true })
      setWelcomeTourOpen(false)
    } catch (error) {
      setWelcomeTourError(error?.message || "Unable to save welcome tour progress")
    } finally {
      setWelcomeTourSaving(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated && isApiMode) {
      startSyncEngine()
      return () => stopSyncEngine()
    }
    stopSyncEngine()
    return undefined
  }, [isAuthenticated, isApiMode])

  return (
    <Router>
      <AppRouterFrame
        loading={loading}
        isAuthenticated={isAuthenticated}
        isApiMode={isApiMode}
        session={session}
        showStationPicker={showStationPicker}
        closeStationPicker={closeStationPicker}
        switchStation={switchStation}
        welcomeTourSteps={welcomeTourSteps}
        welcomeTourOpen={welcomeTourOpen}
        welcomeTourStep={welcomeTourStep}
        welcomeTourSaving={welcomeTourSaving}
        welcomeTourError={welcomeTourError}
        setWelcomeTourStep={setWelcomeTourStep}
        finishWelcomeTour={finishWelcomeTour}
      />
    </Router>
  )
}

function App() {
  return (
    <AppShellProvider>
      <AppContent />
    </AppShellProvider>
  )
}

export default App

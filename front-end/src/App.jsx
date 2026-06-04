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
import SettlementsPage from "./pages/SettlementsPage"
import LivePumpMonitoringPage from "./features/monitoring/LivePumpMonitoringPage"
import KioskApprovalPage from "./features/kiosk/KioskApprovalPage"
import KioskSessionsPage from "./features/kiosk/KioskSessionsPage"
import Login from './pages/Login'
import LoginBriefing from "./components/LoginBriefing"
import { useAuth } from "./auth/AuthContext";
import { accountApi } from "./api/accountApi";
import { briefingApi } from "./api/briefingApi";
import { applyThemePreference, getStoredThemePreference } from "./utils/theme";
import { startSyncEngine, stopSyncEngine } from "./offline/sync";
import { AppShellProvider, useAppShell } from "./layout/AppShellContext";
import { TopLoadingProvider, useTopLoading } from "./layout/TopLoadingContext";
import PlanLockedPage from "./subscription/PlanLockedPage";
import { STATION_PLAN_FEATURES } from "./subscription/planCatalog";
import { useStationPlan } from "./subscription/useStationPlan";
import './assets/station-theme.css'

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
  { path: "/transactions", title: "Transactions" },
  { path: "/transactions-test", title: "Transactions" },
  { path: "/settlements", title: "Settlements" },
  { path: "/monitoring/pumps/:pumpId", title: "Live Monitoring" },
  { path: "/kiosk/approve", title: "Kiosk Approval" },
  { path: "/kiosk/sessions", title: "Kiosk Sessions" },
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

function StationSelectionDialog({ memberships, currentStationPublicId, intent = "manual", onSelect, onClose }) {
  const normalizedMemberships = useMemo(
    () =>
      (Array.isArray(memberships) ? memberships : [])
        .filter((membership) => membership?.station?.publicId)
        .map((membership) => ({
          ...membership,
          stationPublicId: membership.station.publicId,
          stationName: membership.station.name || "Unnamed station",
          role: membership.role || "VIEWER",
        })),
    [memberships]
  )
  const defaultStationId = currentStationPublicId || normalizedMemberships[0]?.stationPublicId || ""
  const [selectedStationId, setSelectedStationId] = useState(defaultStationId)
  const [pendingStationId, setPendingStationId] = useState("")
  const [error, setError] = useState("")
  const isLoginIntent = intent === "login"
  const selectedMembership = normalizedMemberships.find((membership) => membership.stationPublicId === selectedStationId)
  const selectedIsCurrent = selectedStationId && selectedStationId === currentStationPublicId
  const isPending = Boolean(pendingStationId)

  useEffect(() => {
    setSelectedStationId(defaultStationId)
    setError("")
  }, [defaultStationId])

  async function handleContinue() {
    if (!selectedStationId || isPending) return
    if (selectedIsCurrent) {
      onClose()
      return
    }

    setPendingStationId(selectedStationId)
    setError("")
    try {
      await onSelect(selectedStationId)
      onClose()
    } catch (selectError) {
      setError(selectError?.message || "Unable to switch station")
    } finally {
      setPendingStationId("")
    }
  }

  return (
    <div className="station-picker-backdrop" role="presentation">
      <div className="station-picker-modal">
        <header className="station-picker-header">
          <span>{isLoginIntent ? "Station access" : "Station switcher"}</span>
          <h2>{isLoginIntent ? "Choose your station" : "Switch station"}</h2>
          <p>
            {isLoginIntent
              ? "This account is linked to multiple stations. Confirm the workspace you want to enter."
              : "Select a station first, then switch when you are ready. The current page will refresh its data without reloading the browser."}
          </p>
        </header>

        <div className="station-picker-list">
          {normalizedMemberships.map((membership) => {
            const stationPublicId = membership.stationPublicId
            const isCurrent = stationPublicId === currentStationPublicId
            const isSelected = stationPublicId === selectedStationId
            const optionPending = pendingStationId === stationPublicId
            return (
              <button
                key={stationPublicId}
                type="button"
                onClick={() => {
                  if (isPending) return
                  setSelectedStationId(stationPublicId)
                  setError("")
                }}
                disabled={isPending}
                aria-pressed={isSelected}
                className={`station-picker-option ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""} ${optionPending ? "is-pending" : ""}`}
              >
                <span className="station-picker-option-main">
                  <strong>{membership.stationName}</strong>
                  <small>{stationPublicId} · {membership.role}</small>
                </span>
                <span className="station-picker-option-meta">
                  <span className="station-picker-role-chip">{membership.role}</span>
                  <span className="station-picker-option-status">
                    {optionPending ? "Switching..." : isCurrent ? "Current" : isSelected ? "Selected" : "Available"}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {error ? (
          <p className="station-picker-error">{error}</p>
        ) : null}

        <div className="station-picker-actions">
          <button
            type="button"
            className="station-picker-secondary"
            onClick={onClose}
            disabled={isPending}
          >
            {isLoginIntent ? "Continue with current station" : "Cancel"}
          </button>
          <button
            type="button"
            className="station-picker-primary"
            onClick={handleContinue}
            disabled={!selectedMembership || isPending}
          >
            {isPending
              ? "Switching..."
              : selectedIsCurrent
                ? "Continue with current station"
                : isLoginIntent
                  ? "Enter station"
                  : "Switch station"}
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
          border: "1px solid #e0e3e6",
          background: "#ffffff",
          boxShadow: "0 28px 56px rgba(15, 23, 42, 0.22)",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        <header style={{ display: "grid", gap: "8px", marginBottom: "18px" }}>
          <span style={{ color: "#747984", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            First Login Tour · Step {stepIndex + 1} of {steps.length}
          </span>
          <h2 style={{ margin: 0, color: "#16191f", fontSize: "26px", fontWeight: 800 }}>{step.title}</h2>
          <p style={{ margin: 0, color: "#747984", fontSize: "14px", lineHeight: 1.55 }}>{step.body}</p>
        </header>

        <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
          {step.items.map((item) => (
            <div
              key={item}
              style={{
                borderRadius: "14px",
                border: "1px solid #e0e3e6",
                background: "#ffffff",
                padding: "14px 16px",
                color: "#4d535d",
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
              border: "1px solid #d1d7dd",
              background: "#ffffff",
              color: "#4d535d",
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
                  border: "1px solid #d1d7dd",
                  background: "#ffffff",
                  color: "#4d535d",
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
                border: "1px solid #078c83",
                background: "#078c83",
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

function LoginBriefingModal({ briefing, managerName, onDismiss }) {
  if (!briefing) return null

  return (
    <div
      className="login-briefing-backdrop"
      aria-modal="true"
    >
      <LoginBriefing briefing={briefing} managerName={managerName} onDismiss={onDismiss} />
    </div>
  )
}

function AppRouterFrame({
  loading,
  isAuthenticated,
  session,
  showStationPicker,
  stationPickerIntent,
  closeStationPicker,
  switchStation,
  welcomeTourSteps,
  welcomeTourOpen,
  welcomeTourStep,
  welcomeTourSaving,
  welcomeTourError,
  loginBriefing,
  loginBriefingOpen,
  dismissLoginBriefing,
  setWelcomeTourStep,
  finishWelcomeTour,
}) {
  const stationPlan = useStationPlan()
  const { isMobile, isSidebarOpen } = useAppShell()
  const location = useLocation()
  const navigate = useNavigate()
  const backgroundLocation = location.state?.backgroundLocation || null
  const isSettingsModalOpen = isAuthenticated && location.pathname === "/settings"
  const stationRouteKey = isAuthenticated ? (session?.station?.publicId || "station") : "public"

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
          <Routes key={stationRouteKey} location={backgroundLocation || location}>
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
              path="/transactions"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)
                  ? <TransactionsTestPage />
                  : <PlanLockedPage title="Transactions" featureName="Transaction history" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)} />
              }
            />
            <Route
              path="/transactions-test"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)
                  ? <TransactionsTestPage />
                  : <PlanLockedPage title="Transactions" featureName="Transaction history" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)} />
              }
            />
            <Route
              path="/settlements"
              element={
                stationPlan.hasFeature(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)
                  ? <SettlementsPage />
                  : <PlanLockedPage title="Settlements" featureName="Settlement status" requiredPlan={stationPlan.getRequirement(STATION_PLAN_FEATURES.TRANSACTIONS_VIEW)} />
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
            <Route path="/kiosk/approve" element={<KioskApprovalPage />} />
            <Route path="/kiosk/sessions" element={<KioskSessionsPage />} />
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
          intent={stationPickerIntent}
          onSelect={switchStation}
          onClose={closeStationPicker}
        />
      ) : null}
      {isAuthenticated && !showStationPicker && loginBriefingOpen ? (
        <LoginBriefingModal
          briefing={loginBriefing}
          managerName={session?.user?.fullName || "Manager"}
          onDismiss={dismissLoginBriefing}
        />
      ) : null}
      <WelcomeTourModal
        open={Boolean(isAuthenticated && welcomeTourOpen && !showStationPicker && !loginBriefingOpen) ? { steps: welcomeTourSteps } : null}
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
    stationPickerIntent,
    closeStationPicker,
    switchStation,
  } = useAuth()
  const stationPlan = useStationPlan()
  const { setTopLoading } = useTopLoading()
  const welcomeTourSteps = useMemo(() => buildWelcomeTourSteps(stationPlan), [stationPlan])
  const [preferences, setPreferences] = useState(null)
  const [welcomeTourOpen, setWelcomeTourOpen] = useState(false)
  const [welcomeTourStep, setWelcomeTourStep] = useState(0)
  const [welcomeTourSaving, setWelcomeTourSaving] = useState(false)
  const [welcomeTourError, setWelcomeTourError] = useState("")
  const [loginBriefing, setLoginBriefing] = useState(null)
  const [loginBriefingOpen, setLoginBriefingOpen] = useState(false)
  const [loginBriefingReady, setLoginBriefingReady] = useState(false)

  const briefingStorageKey = useMemo(() => {
    const stationPublicId = String(session?.station?.publicId || "").trim()
    const userPublicId = String(session?.user?.publicId || "").trim()
    if (!stationPublicId || !userPublicId) return ""
    return `smartlink:login-briefing:${userPublicId}:${stationPublicId}`
  }, [session?.station?.publicId, session?.user?.publicId])

  useEffect(() => {
    setTopLoading("auth", loading)
  }, [loading, setTopLoading])

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
    if (!loginBriefingReady) return
    if (preferences && !preferences.completedWelcomeTour) {
      setWelcomeTourStep(0)
      setWelcomeTourOpen(true)
      setWelcomeTourError("")
    }
  }, [isApiMode, isAuthenticated, loginBriefingReady, preferences, showStationPicker])

  useEffect(() => {
    setLoginBriefing(null)
    setLoginBriefingOpen(false)
    setLoginBriefingReady(false)
  }, [briefingStorageKey])

  useEffect(() => {
    if (!isAuthenticated || !isApiMode) {
      setLoginBriefingReady(true)
      return undefined
    }
    if (showStationPicker) return undefined
    const stationPublicId = String(session?.station?.publicId || "").trim()
    if (!stationPublicId || !briefingStorageKey) return undefined

    if (window.sessionStorage.getItem(briefingStorageKey)) {
      setLoginBriefingReady(true)
      return undefined
    }

    let canceled = false
    setTopLoading("login-briefing", true)
    ;(async () => {
      try {
        const payload = await briefingApi.getStationBriefing(stationPublicId)
        if (canceled) return
        setLoginBriefing(payload?.briefing || null)
        setLoginBriefingOpen(Boolean(payload?.briefing))
        setLoginBriefingReady(false)
      } catch {
        if (canceled) return
        setLoginBriefing(null)
        setLoginBriefingOpen(false)
        setLoginBriefingReady(true)
      } finally {
        if (!canceled) setTopLoading("login-briefing", false)
      }
    })()

    return () => {
      canceled = true
      setTopLoading("login-briefing", false)
    }
  }, [briefingStorageKey, isApiMode, isAuthenticated, session?.station?.publicId, setTopLoading, showStationPicker])

  function dismissLoginBriefing(details = {}) {
    if (briefingStorageKey) {
      window.sessionStorage.setItem(
        briefingStorageKey,
        JSON.stringify({
          dismissedAt: new Date().toISOString(),
          slidesViewed: Array.isArray(details?.slidesViewed) ? details.slidesViewed : [],
        })
      )
    }
    setLoginBriefingOpen(false)
    setLoginBriefingReady(true)
  }

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

  async function switchStationWithLoading(stationPublicId) {
    setTopLoading("station-switch", true)
    try {
      return await switchStation(stationPublicId)
    } finally {
      setTopLoading("station-switch", false)
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
        stationPickerIntent={stationPickerIntent}
        closeStationPicker={closeStationPicker}
        switchStation={switchStationWithLoading}
        welcomeTourSteps={welcomeTourSteps}
        welcomeTourOpen={welcomeTourOpen}
        welcomeTourStep={welcomeTourStep}
        welcomeTourSaving={welcomeTourSaving}
        welcomeTourError={welcomeTourError}
        loginBriefing={loginBriefing}
        loginBriefingOpen={loginBriefingOpen}
        dismissLoginBriefing={dismissLoginBriefing}
        setWelcomeTourStep={setWelcomeTourStep}
        finishWelcomeTour={finishWelcomeTour}
      />
    </Router>
  )
}

function App() {
  return (
    <AppShellProvider>
      <TopLoadingProvider>
        <AppContent />
      </TopLoadingProvider>
    </AppShellProvider>
  )
}

export default App

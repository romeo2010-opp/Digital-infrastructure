import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useInternalAuth } from "./auth/AuthContext"
import LoginPage from "./pages/LoginPage"
import OverviewPage from "./pages/OverviewPage"
import InternalViewsPage from "./pages/InternalViewsPage"
import TeamChatPage from "./pages/TeamChatPage"
import StationsPage from "./pages/StationsPage"
import StationDetailPage from "./pages/StationDetailPage"
import SupportPage from "./pages/SupportPage"
import FinancePage from "./pages/FinancePage"
import WalletOperationsPage from "./pages/WalletOperationsPage"
import RiskPage from "./pages/RiskPage"
import StaffPage from "./pages/StaffPage"
import NetworkOperationsPage from "./pages/NetworkOperationsPage"
import StationOnboardingPage from "./pages/StationOnboardingPage"
import FieldOperationsPage from "./pages/FieldOperationsPage"
import AnalyticsForecastingPage from "./pages/AnalyticsForecastingPage"
import AuditLogsPage from "./pages/AuditLogsPage"
import SystemHealthPage from "./pages/SystemHealthPage"
import KioskRegistrationPage from "./pages/KioskRegistrationPage"
import SettingsPage from "./pages/SettingsPage"
import InternalSearchResultsPage from "./pages/InternalSearchResultsPage"
import InternalRecordDetailPage from "./pages/InternalRecordDetailPage"
import { navigationItems } from "./config/navigation"
import InternalChatToasts from "./components/InternalChatToasts"

function resolveInternalHomePath(navigation = []) {
  const allowed = new Set(Array.isArray(navigation) ? navigation : [])
  const firstVisible = navigationItems.find((item) => allowed.has(item.key))
  return firstVisible?.path || "/"
}

function PrivateRoute({ children, navKey = null }) {
  const { isAuthenticated, loading, session } = useInternalAuth()
  const location = useLocation()
  if (loading) return <div className="loading-screen">Loading internal workspace...</div>
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ returnTo: `${location.pathname}${location.search}` }} />
  }
  if (navKey && !session?.profile?.navigation?.includes(navKey)) {
    return <Navigate to={resolveInternalHomePath(session?.profile?.navigation)} replace />
  }
  return children
}

function InternalIndexRedirect() {
  const { session } = useInternalAuth()
  return <Navigate to={resolveInternalHomePath(session?.profile?.navigation)} replace />
}

export default function App() {
  return (
    <>
      <InternalChatToasts />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute navKey="overview"><OverviewPage /></PrivateRoute>} />
        <Route path="/views" element={<PrivateRoute><InternalViewsPage /></PrivateRoute>} />
        <Route path="/views/:viewId" element={<PrivateRoute><InternalViewsPage /></PrivateRoute>} />
        <Route path="/search" element={<PrivateRoute><InternalSearchResultsPage /></PrivateRoute>} />
        <Route path="/details/:entityType/:recordId" element={<PrivateRoute><InternalRecordDetailPage /></PrivateRoute>} />
        <Route path="/team-chat" element={<PrivateRoute navKey="chat"><TeamChatPage /></PrivateRoute>} />
        <Route path="/network-operations" element={<PrivateRoute navKey="networkOperations"><NetworkOperationsPage /></PrivateRoute>} />
        <Route path="/stations/:stationPublicId" element={<PrivateRoute navKey="stations"><StationDetailPage /></PrivateRoute>} />
        <Route path="/stations" element={<PrivateRoute navKey="stations"><StationsPage /></PrivateRoute>} />
        <Route path="/station-onboarding" element={<PrivateRoute navKey="stationOnboarding"><StationOnboardingPage /></PrivateRoute>} />
        <Route path="/field-operations" element={<PrivateRoute navKey="fieldOperations"><FieldOperationsPage /></PrivateRoute>} />
        <Route path="/support-disputes" element={<PrivateRoute navKey="support"><SupportPage /></PrivateRoute>} />
        <Route path="/finance-settlements" element={<PrivateRoute navKey="finance"><FinancePage /></PrivateRoute>} />
        <Route path="/risk-compliance" element={<PrivateRoute navKey="risk"><RiskPage /></PrivateRoute>} />
        <Route path="/wallet-operations" element={<PrivateRoute navKey="walletOperations"><WalletOperationsPage /></PrivateRoute>} />
        <Route path="/analytics-forecasting" element={<PrivateRoute navKey="analytics"><AnalyticsForecastingPage /></PrivateRoute>} />
        <Route path="/audit-logs" element={<PrivateRoute navKey="audit"><AuditLogsPage /></PrivateRoute>} />
        <Route path="/internal-staff" element={<PrivateRoute navKey="staff"><StaffPage /></PrivateRoute>} />
        <Route path="/system-health" element={<PrivateRoute navKey="systemHealth"><SystemHealthPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute navKey="settings"><Navigate to="/settings/preferences" replace /></PrivateRoute>} />
        <Route path="/settings/profile" element={<PrivateRoute navKey="settings"><SettingsPage section="profile" /></PrivateRoute>} />
        <Route path="/settings/preferences" element={<PrivateRoute navKey="settings"><SettingsPage section="preferences" /></PrivateRoute>} />
        <Route path="/settings/notifications" element={<PrivateRoute navKey="settings"><SettingsPage section="notifications" /></PrivateRoute>} />
        <Route path="/settings/security" element={<PrivateRoute navKey="settings"><SettingsPage section="security" /></PrivateRoute>} />
        <Route path="/settings/users" element={<PrivateRoute navKey="settings"><SettingsPage section="users" /></PrivateRoute>} />
        <Route path="/settings/audit" element={<PrivateRoute navKey="settings"><SettingsPage section="audit" /></PrivateRoute>} />
        <Route path="/settings/organization" element={<PrivateRoute navKey="settings"><SettingsPage section="organization" /></PrivateRoute>} />
        <Route path="/settings/integrations" element={<PrivateRoute navKey="settings"><SettingsPage section="integrations" /></PrivateRoute>} />
        <Route path="/settings/data" element={<PrivateRoute navKey="settings"><SettingsPage section="data" /></PrivateRoute>} />
        <Route path="/kiosk/register" element={<PrivateRoute><KioskRegistrationPage /></PrivateRoute>} />
        <Route path="*" element={<PrivateRoute><InternalIndexRedirect /></PrivateRoute>} />
      </Routes>
    </>
  )
}

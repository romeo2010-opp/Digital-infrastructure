import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { PageHeader } from './components/PageHeader'
import { LoginScreen } from './components/LoginScreen'
import { canAccessPath, firstAccessiblePath } from './lib/access'
import { PortalProvider, usePortal } from './lib/portalContext'
import { NationalDashboard } from './pages/NationalDashboard'
import { FuelDeliveries } from './pages/FuelDeliveries'
import { AvailabilityAudit } from './pages/AvailabilityAudit'
import { ComplaintsCenter } from './pages/ComplaintsCenter'
import { ComplianceFlags } from './pages/ComplianceFlags'
import { FieldInspections } from './pages/FieldInspections'
import { EnforcementActions } from './pages/EnforcementActions'
import { SituationMonitor } from './pages/SituationMonitor'
import { HoardingWatchlist } from './pages/HoardingWatchlist'
import { StationProfiles } from './pages/StationProfiles'
import { LicenseRegistry } from './pages/LicenseRegistry'
import { ReportsIntelligence } from './pages/ReportsIntelligence'
import { UserAdministration } from './pages/UserAdministration'
import { AuditTrail } from './pages/AuditTrail'
import { SettingsCenter } from './pages/SettingsCenter'

const routeMeta = [
  { path: '/dashboard', title: 'National Dashboard', subtitle: 'National command summary' },
  { path: '/national-heat-intelligence-map', title: 'National Heat Intelligence Map', subtitle: 'Live shortage posture and geographic heat signals' },
  { path: '/hoarding-watchlist', title: 'Hoarding Watchlist', subtitle: 'Suspicious shortage behaviour and risk escalation' },
  { path: '/station-regulatory-profiles', title: 'Station Regulatory Profiles', subtitle: 'Full station dossiers and case files' },
  { path: '/fuel-deliveries', title: 'Fuel Deliveries', subtitle: 'Tanker and supply verification ledger' },
  { path: '/availability-audit', title: 'Availability Audit', subtitle: 'Station declaration audit register' },
  { path: '/complaints-center', title: 'Complaints Center', subtitle: 'Citizen and officer complaint casework' },
  { path: '/compliance-flags', title: 'Compliance Flags', subtitle: 'Flag review and evidence chain' },
  { path: '/field-inspections', title: 'Field Inspections', subtitle: 'Operational field inspection queue' },
  { path: '/enforcement-actions', title: 'Enforcement Actions', subtitle: 'Legal interventions and status tracking' },
  { path: '/license-registry', title: 'License Registry', subtitle: 'Station licensing and compliance condition register' },
  { path: '/reports-intelligence', title: 'Reports & Intelligence', subtitle: 'Generated regulatory outputs and downloads' },
  { path: '/user-administration', title: 'User Administration', subtitle: 'MERA officer access and role management' },
  { path: '/audit-trail', title: 'Audit Trail', subtitle: 'Chronological compliance and oversight log' },
  { path: '/settings', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/preferences', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/notifications', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/security', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/users', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/audit', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
] as const

function resolveMeta(pathname: string) {
  return (
    routeMeta
      .slice()
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => pathname.startsWith(item.path)) || { title: 'MERA Portal', subtitle: '' }
  )
}

function NoAccessState({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef3f1] p-6">
      <div className="w-full max-w-xl rounded-[1.5rem] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-900">MERA access is not provisioned yet</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This account is authenticated, but no MERA portal permissions were returned for it. That usually means the RBAC migration or seed has not been applied yet, or this browser is still using an older session.
        </p>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Apply `061_mera_rbac.sql` and `062_seed_mera_rbac_demo.sql`, then sign out and log back in.
        </div>
        <button
          type="button"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          onClick={onLogout}
        >
          Sign out
        </button>
      </div>
    </main>
  )
}

function PortalShell() {
  const location = useLocation()
  const { session, user, login, logout, bootLoading, loginError, loading } = usePortal()
  const activeMeta = resolveMeta(location.pathname)
  const landingPath = firstAccessiblePath(user)

  if (!session?.accessToken) {
    return <LoginScreen onLogin={login} loading={bootLoading} error={loginError} />
  }

  if (!landingPath) {
    return <NoAccessState onLogout={logout} />
  }

  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to={landingPath} replace />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef3f1] text-slate-900">
      <Sidebar user={user} />
      <div className="min-w-0 flex-1 overflow-hidden p-3 pl-1.5">
        <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#f6faf8] shadow-none">
          <PageHeader title={activeMeta.title} subtitle={activeMeta.subtitle} user={user} loading={loading} onLogout={logout} />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to={landingPath} replace />} />
              <Route path="/dashboard" element={<NationalDashboard />} />
              <Route path="/national-heat-intelligence-map" element={<SituationMonitor />} />
              <Route path="/hoarding-watchlist" element={<HoardingWatchlist />} />
              <Route path="/station-regulatory-profiles" element={<StationProfiles />} />
              <Route path="/fuel-deliveries" element={<FuelDeliveries />} />
              <Route path="/availability-audit" element={<AvailabilityAudit />} />
              <Route path="/complaints-center" element={<ComplaintsCenter />} />
              <Route path="/compliance-flags" element={<ComplianceFlags />} />
              <Route path="/field-inspections" element={<FieldInspections />} />
              <Route path="/enforcement-actions" element={<EnforcementActions />} />
              <Route path="/license-registry" element={<LicenseRegistry />} />
              <Route path="/reports-intelligence" element={<ReportsIntelligence />} />
              <Route path="/user-administration" element={<UserAdministration />} />
              <Route path="/audit-trail" element={<AuditTrail />} />
              <Route path="/settings" element={<Navigate to="/settings/preferences" replace />} />
              <Route path="/settings/preferences" element={<SettingsCenter section="preferences" />} />
              <Route path="/settings/notifications" element={<SettingsCenter section="notifications" />} />
              <Route path="/settings/security" element={<SettingsCenter section="security" />} />
              <Route path="/settings/users" element={<SettingsCenter section="users" />} />
              <Route path="/settings/audit" element={<SettingsCenter section="audit" />} />
              <Route path="/situation-monitor" element={<Navigate to="/national-heat-intelligence-map" replace />} />
              <Route path="/fuel-availability-map" element={<Navigate to="/national-heat-intelligence-map" replace />} />
              <Route path="/station-registry" element={<Navigate to="/station-regulatory-profiles" replace />} />
              <Route path="/queue-monitoring" element={<Navigate to="/field-inspections" replace />} />
              <Route path="/demand-forecasting" element={<Navigate to="/reports-intelligence" replace />} />
              <Route path="/trends-analytics" element={<Navigate to="/reports-intelligence" replace />} />
              <Route path="/data-exports" element={<Navigate to="/reports-intelligence" replace />} />
              <Route path="/audit-logs" element={<Navigate to="/audit-trail" replace />} />
              <Route path="/users-roles" element={<Navigate to="/user-administration" replace />} />
              <Route path="*" element={<Navigate to={landingPath} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <PortalProvider>
      <BrowserRouter>
        <PortalShell />
      </BrowserRouter>
    </PortalProvider>
  )
}

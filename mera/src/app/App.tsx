import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { PageHeader } from './components/PageHeader'
import { LoginScreen } from './components/LoginScreen'
import { PortalProvider, usePortal } from './lib/portalContext'
import { NationalDashboard } from './pages/NationalDashboard'
import { FuelDeliveries } from './pages/FuelDeliveries'
import { AvailabilityAudit } from './pages/AvailabilityAudit'
import { ComplaintsCenter } from './pages/ComplaintsCenter'
import { ComplianceFlags } from './pages/ComplianceFlags'
import { FieldInspections } from './pages/FieldInspections'
import { EnforcementActions } from './pages/EnforcementActions'
import { StationProfiles } from './pages/StationProfiles'
import { ReportsIntelligence } from './pages/ReportsIntelligence'
import { UserAdministration } from './pages/UserAdministration'
import { AuditTrail } from './pages/AuditTrail'
import { SettingsCenter } from './pages/SettingsCenter'

const routeMeta = [
  { path: '/dashboard', title: 'National Dashboard', subtitle: 'National command summary' },
  { path: '/situation-monitor', title: 'Situation Monitor', subtitle: 'Live shortage posture and escalation signals' },
  { path: '/fuel-availability-map', title: 'Fuel Availability Map', subtitle: 'Station declaration audit register' },
  { path: '/station-registry', title: 'Station Registry', subtitle: 'Full station dossiers and case files' },
  { path: '/queue-monitoring', title: 'Queue Monitoring', subtitle: 'Inspection queue and active waiting pressure' },
  { path: '/fuel-deliveries', title: 'Fuel Deliveries', subtitle: 'Tanker and supply verification ledger' },
  { path: '/demand-forecasting', title: 'Demand Forecasting', subtitle: 'Demand and shortage intelligence models' },
  { path: '/complaints-center', title: 'Complaints Center', subtitle: 'Citizen and officer complaint casework' },
  { path: '/compliance-flags', title: 'Compliance Flags', subtitle: 'Flag review and evidence chain' },
  { path: '/field-inspections', title: 'Field Inspections', subtitle: 'Operational field inspection queue' },
  { path: '/enforcement-actions', title: 'Enforcement Actions', subtitle: 'Legal interventions and status tracking' },
  { path: '/reports-intelligence', title: 'Reports & Intelligence', subtitle: 'Generated regulatory outputs and downloads' },
  { path: '/trends-analytics', title: 'Trends & Analytics', subtitle: 'Cross-module trendlines and performance telemetry' },
  { path: '/data-exports', title: 'Data Exports', subtitle: 'Structured exports and downstream intelligence feeds' },
  { path: '/settings', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/preferences', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/notifications', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/security', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/users', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/settings/audit', title: 'Settings', subtitle: 'Workspace preferences and account controls' },
  { path: '/audit-logs', title: 'Audit Logs', subtitle: 'Chronological compliance actions log' },
  { path: '/users-roles', title: 'Users & Roles', subtitle: 'MERA officer administration' },
] as const

function resolveMeta(pathname: string) {
  return (
    routeMeta
      .slice()
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => pathname.startsWith(item.path)) || { title: 'MERA Portal', subtitle: '' }
  )
}

function PortalShell() {
  const location = useLocation()
  const { session, user, login, logout, bootLoading, loginError, loading } = usePortal()
  const activeMeta = resolveMeta(location.pathname)

  if (!session?.accessToken) {
    return <LoginScreen onLogin={login} loading={bootLoading} error={loginError} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef3f1] text-slate-900">
      <Sidebar user={user} />
      <div className="min-w-0 flex-1 overflow-hidden p-4 pl-2">
        <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.65rem] border border-slate-200/90 bg-white shadow-[0_14px_40px_-28px_rgba(15,23,42,0.24)]">
          <PageHeader title={activeMeta.title} subtitle={activeMeta.subtitle} user={user} loading={loading} onLogout={logout} />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<NationalDashboard />} />
              <Route path="/situation-monitor" element={<NationalDashboard />} />
              <Route path="/fuel-availability-map" element={<AvailabilityAudit />} />
              <Route path="/station-registry" element={<StationProfiles />} />
              <Route path="/queue-monitoring" element={<FieldInspections />} />
              <Route path="/fuel-deliveries" element={<FuelDeliveries />} />
              <Route path="/demand-forecasting" element={<ReportsIntelligence />} />
              <Route path="/complaints-center" element={<ComplaintsCenter />} />
              <Route path="/compliance-flags" element={<ComplianceFlags />} />
              <Route path="/field-inspections" element={<FieldInspections />} />
              <Route path="/enforcement-actions" element={<EnforcementActions />} />
              <Route path="/reports-intelligence" element={<ReportsIntelligence />} />
              <Route path="/trends-analytics" element={<ReportsIntelligence />} />
              <Route path="/data-exports" element={<ReportsIntelligence />} />
              <Route path="/settings" element={<Navigate to="/settings/preferences" replace />} />
              <Route path="/settings/preferences" element={<SettingsCenter section="preferences" />} />
              <Route path="/settings/notifications" element={<SettingsCenter section="notifications" />} />
              <Route path="/settings/security" element={<SettingsCenter section="security" />} />
              <Route path="/settings/users" element={<SettingsCenter section="users" />} />
              <Route path="/settings/audit" element={<SettingsCenter section="audit" />} />
              <Route path="/audit-logs" element={<AuditTrail />} />
              <Route path="/users-roles" element={<UserAdministration />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
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

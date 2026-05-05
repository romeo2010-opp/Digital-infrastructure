import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { PageHeader } from './components/PageHeader'
import { LoginScreen } from './components/LoginScreen'
import { PortalProvider, usePortal } from './lib/portalContext'
import { NationalDashboard } from './pages/NationalDashboard'
import { HoardingWatchlist } from './pages/HoardingWatchlist'
import { FuelDeliveries } from './pages/FuelDeliveries'
import { AvailabilityAudit } from './pages/AvailabilityAudit'
import { ComplaintsCenter } from './pages/ComplaintsCenter'
import { ComplianceFlags } from './pages/ComplianceFlags'
import { FieldInspections } from './pages/FieldInspections'
import { EnforcementActions } from './pages/EnforcementActions'
import { StationProfiles } from './pages/StationProfiles'
import { LicenseRegistry } from './pages/LicenseRegistry'
import { ReportsIntelligence } from './pages/ReportsIntelligence'
import { UserAdministration } from './pages/UserAdministration'
import { AuditTrail } from './pages/AuditTrail'

function PortalShell() {
  const [currentPage, setCurrentPage] = useState('dashboard')
  const { session, user, login, logout, bootLoading, loginError, loading } = usePortal()

  const pageMeta: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'National Dashboard', subtitle: 'National command summary' },
    hoarding: { title: 'Hoarding Watchlist', subtitle: 'Anti-hoarding surveillance ledger' },
    deliveries: { title: 'Fuel Deliveries', subtitle: 'Tanker and supply verification ledger' },
    availability: { title: 'Availability Audit', subtitle: 'Station declaration audit register' },
    complaints: { title: 'Complaints Center', subtitle: 'Citizen and officer complaint casework' },
    compliance: { title: 'Compliance Flags', subtitle: 'Flag review and evidence chain' },
    inspections: { title: 'Field Inspections', subtitle: 'Operational field inspection queue' },
    enforcement: { title: 'Enforcement Actions', subtitle: 'Legal interventions and status tracking' },
    stations: { title: 'Station Regulatory Profiles', subtitle: 'Full station dossiers and case files' },
    licenses: { title: 'License Registry', subtitle: 'National licensing and renewal register' },
    reports: { title: 'Reports & Intelligence', subtitle: 'Generated regulatory outputs and downloads' },
    users: { title: 'User Administration', subtitle: 'MERA officer administration' },
    audit: { title: 'Audit Trail', subtitle: 'Chronological compliance actions log' },
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <NationalDashboard />
      case 'hoarding':
        return <HoardingWatchlist />
      case 'deliveries':
        return <FuelDeliveries />
      case 'availability':
        return <AvailabilityAudit />
      case 'complaints':
        return <ComplaintsCenter />
      case 'compliance':
        return <ComplianceFlags />
      case 'inspections':
        return <FieldInspections />
      case 'enforcement':
        return <EnforcementActions />
      case 'stations':
        return <StationProfiles />
      case 'licenses':
        return <LicenseRegistry />
      case 'reports':
        return <ReportsIntelligence />
      case 'users':
        return <UserAdministration />
      case 'audit':
        return <AuditTrail />
      default:
        return <NationalDashboard />
    }
  }

  if (!session?.accessToken) {
    return <LoginScreen onLogin={login} loading={bootLoading} error={loginError} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f6f8] text-slate-900">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={pageMeta[currentPage]?.title || 'MERA Portal'}
          subtitle={pageMeta[currentPage]?.subtitle || ''}
          user={user}
          loading={loading}
          onLogout={logout}
        />
        <main className="min-h-0 flex-1 overflow-hidden">{renderPage()}</main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <PortalProvider>
      <PortalShell />
    </PortalProvider>
  )
}

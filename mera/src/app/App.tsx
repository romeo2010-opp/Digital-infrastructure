import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, LayoutDashboard, Pencil, Pin, Plus, RefreshCcw, Trash2 } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { PageHeader } from './components/PageHeader'
import { LoginScreen } from './components/LoginScreen'
import { ActionLoadingOverlay } from './components/ActionLoadingOverlay'
import { PortalBootSkeleton } from './components/LiveDataSkeleton'
import { canAccessPath, firstAccessiblePath } from './lib/access'
import { PortalProvider, usePortal } from './lib/portalContext'
import { DashboardChromeProvider, useDashboardChrome } from './lib/dashboardChrome'
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
import { CreateTask, MyTasks, TaskDetails, TaskOperations } from './pages/TaskAssignments'
import { SearchResultsPage } from './pages/SearchResults'
import {
  CaseDetailPage,
  ComplaintDetailPage,
  DocumentDetailPage,
  LicenseDetailPage,
  StationDetailPage,
  StationManagerDetailPage,
  UserDetailPage,
} from './pages/RegulatorDetailPages'

const routeMeta = [
  { path: '/dashboard', title: 'MERA National Operations', subtitle: 'Regulatory command view for fuel availability, compliance, incidents and enforcement' },
  { path: '/search', title: 'Search Results', subtitle: 'Search regulator navigation and records' },
  { path: '/tasks/my', title: 'My Assigned Tasks', subtitle: 'Officer regulatory work queue and task completion workflow' },
  { path: '/tasks/new', title: 'Create Assignment', subtitle: 'Supervisor task assignment and officer dispatch workflow' },
  { path: '/tasks', title: 'Task Operations', subtitle: 'Regulatory assignment tracking, workload, escalation and overdue actions' },
  { path: '/cases', title: 'Regulatory Case Detail', subtitle: 'Compliance flag and enforcement case record' },
  { path: '/complaints', title: 'Complaint Detail', subtitle: 'Complaint casework record' },
  { path: '/documents', title: 'Document Detail', subtitle: 'Evidence and linked regulatory record' },
  { path: '/stations', title: 'Station Detail', subtitle: 'Station regulatory dossier' },
  { path: '/station-managers', title: 'Station Manager Detail', subtitle: 'Station manager assignments and linked records' },
  { path: '/licences', title: 'Licence Detail', subtitle: 'Station licence dossier and linked records' },
  { path: '/licenses', title: 'Licence Detail', subtitle: 'Station licence dossier and linked records' },
  { path: '/users', title: 'MERA User Detail', subtitle: 'Officer profile and recent work' },
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--mera-panel-muted)] p-6">
      <div className="w-full max-w-xl rounded-[1.5rem] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--mera-panel-text)]">MERA access is not provisioned yet</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--mera-panel-text-muted)]">
          This account is authenticated, but no MERA portal permissions were returned for it. That usually means the RBAC migration or seed has not been applied yet, or this browser is still using an older session.
        </p>
        <div className="mt-5 rounded-xl border border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] p-4 text-sm text-[var(--mera-panel-text-soft)]">
          Apply `061_mera_rbac.sql` and `062_seed_mera_rbac_demo.sql`, then sign out and log back in.
        </div>
        <button
          type="button"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
          onClick={onLogout}
        >
          Sign out
        </button>
      </div>
    </main>
  )
}

const dashboardFallbackTabs = [
  { id: 'builtin-my-view', label: 'My View', kind: 'builtin' as const },
  { id: 'builtin-national-overview', label: 'National Overview', kind: 'builtin' as const },
  { id: 'builtin-fuel-supply', label: 'Fuel Supply', kind: 'builtin' as const },
  { id: 'builtin-compliance-watch', label: 'Compliance Watch', kind: 'builtin' as const },
  { id: 'builtin-enforcement', label: 'Enforcement', kind: 'builtin' as const },
]

function dashboardSyncLabel(value?: string) {
  if (!value) return 'Sync pending'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Last sync now'
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'Last sync now'
  if (minutes < 60) return `Last sync ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Last sync ${hours}h`
  return `Last sync ${Math.round(hours / 24)}d`
}

function DashboardViewStrip() {
  const { chrome } = useDashboardChrome()
  const tabs = chrome?.tabs?.length ? chrome.tabs : dashboardFallbackTabs
  const activeTabId = chrome?.activeTabId || 'builtin-my-view'
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const pinnedTabIds = chrome?.pinnedTabIds || []
  const onTabChange = chrome?.onTabChange || (() => {})
  const onRefresh = chrome?.onRefresh || (() => {})
  const onCreateView = chrome?.onCreateView || (() => {})
  const onEditView = chrome?.onEditView
  const onDeleteView = chrome?.onDeleteView
  const onDuplicateTab = chrome?.onDuplicateTab
  const onCopyTab = chrome?.onCopyTab
  const onPinTab = chrome?.onPinTab
  const [contextMenu, setContextMenu] = useState<{ tab: (typeof tabs)[number]; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const runContextAction = (action: () => void) => {
    action()
    setContextMenu(null)
  }

  const copyTab = (tab: (typeof tabs)[number]) => {
    if (onCopyTab) {
      onCopyTab(tab.id)
      return
    }
    navigator.clipboard?.writeText(tab.label).catch(() => {})
  }

  return (
    <div className="flex h-11 min-h-11 w-full shrink-0 items-center overflow-hidden border-b border-[#dbe3ee] bg-white text-[#111827]">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <div className="flex min-w-max items-stretch gap-1 px-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setContextMenu({ tab, x: event.clientX, y: event.clientY })
              }}
              className={`relative flex h-11 items-center gap-1 whitespace-nowrap border-b-[3px] px-3.5 text-[13px] font-semibold transition ${
                activeTabId === tab.id
                  ? 'border-[#111827] bg-[#f3f4f6] text-[#030712]'
                  : 'border-transparent text-[#4b5563] hover:bg-[#f9fafb] hover:text-[#111827]'
              }`}
            >
              {tab.label}
              {pinnedTabIds.includes(tab.id) ? <Pin className="ml-1 size-3 text-[#2563eb]" /> : null}
              {tab.kind === 'custom' ? <span className="ml-1 rounded-[3px] bg-[#e5e7eb] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#6b7280]">Custom</span> : null}
            </button>
          ))}
          <button
            type="button"
            onClick={onCreateView}
            className="flex h-11 items-center gap-1 whitespace-nowrap border-b-[3px] border-transparent px-3 text-[13px] font-semibold text-[#4b5563] transition hover:bg-[#f9fafb] hover:text-[#111827]"
          >
            <Plus className="size-3.5" />
            New View
          </button>
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1.5 bg-white px-3">
        <span className="hidden items-center gap-1 text-[11px] font-medium text-[#9ca3af] lg:inline-flex">
          <span className={`size-1.5 rounded-full ${chrome?.loading ? 'animate-pulse bg-[#f59e0b]' : 'bg-[#10b981]'}`} />
          {dashboardSyncLabel(chrome?.lastSync)}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]"
          aria-label="Refresh national operations"
        >
          <RefreshCcw className={`size-3.5 ${chrome?.loading ? 'animate-spin' : ''}`} />
        </button>
        {activeTab?.kind === 'custom' && onDeleteView ? (
          <button
            type="button"
            onClick={() => onDeleteView(activeTab.id)}
            className="hidden size-7 place-items-center rounded-[4px] border border-[#fecaca] bg-white text-[#dc2626] transition hover:bg-[#fef2f2] sm:grid"
            aria-label="Delete custom view"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (activeTab?.kind === 'custom' && onEditView ? onEditView(activeTab.id) : onCreateView())}
          className="inline-flex h-7 items-center gap-1 rounded-[4px] bg-[#111827] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#1f2937]"
        >
          {activeTab?.kind === 'custom' ? <Pencil className="size-3.5" /> : <LayoutDashboard className="size-3.5" />}
          <span className="hidden sm:inline">{activeTab?.kind === 'custom' ? 'Edit View' : 'New View'}</span>
          <ChevronDown className="hidden size-3 sm:block" />
        </button>
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 w-[216px] overflow-hidden rounded-[11px] bg-black/78 p-1.5 text-[13px] font-medium text-white shadow-[0_18px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 250)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => onPinTab && runContextAction(() => onPinTab(contextMenu.tab.id))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left transition hover:bg-[#0a84ff] disabled:opacity-45" disabled={!onPinTab}>
            {pinnedTabIds.includes(contextMenu.tab.id) ? <Check className="size-4" /> : <Pin className="size-4" />}
            {pinnedTabIds.includes(contextMenu.tab.id) ? 'Unpin Tab' : 'Pin Tab'}
          </button>
          <button type="button" onClick={() => onDuplicateTab && runContextAction(() => onDuplicateTab(contextMenu.tab.id))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left transition hover:bg-[#0a84ff] disabled:opacity-45" disabled={!onDuplicateTab}>
            <Copy className="size-4" />
            Duplicate
          </button>
          <button type="button" onClick={() => runContextAction(() => copyTab(contextMenu.tab))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left transition hover:bg-[#0a84ff]">
            <Copy className="size-4" />
            Copy
          </button>
          {contextMenu.tab.kind === 'custom' ? (
            <button type="button" onClick={() => onEditView && runContextAction(() => onEditView(contextMenu.tab.id))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left transition hover:bg-[#0a84ff] disabled:opacity-45" disabled={!onEditView}>
              <Pencil className="size-4" />
              Edit
            </button>
          ) : null}
          <div className="my-1 h-px bg-white/12" />
          <button type="button" onClick={() => contextMenu.tab.kind === 'custom' && onDeleteView && runContextAction(() => onDeleteView(contextMenu.tab.id))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[#ffb4b4] transition hover:bg-[#0a84ff] hover:text-white disabled:opacity-35" disabled={contextMenu.tab.kind !== 'custom' || !onDeleteView}>
            <Trash2 className="size-4" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

function PortalRoutes({ landingPath }: { landingPath: string }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={landingPath} replace />} />
      <Route path="/dashboard" element={<NationalDashboard />} />
      <Route path="/search" element={<SearchResultsPage />} />
      <Route path="/tasks/my" element={<MyTasks />} />
      <Route path="/tasks/new" element={<CreateTask />} />
      <Route path="/tasks/:taskNumber" element={<TaskDetails />} />
      <Route path="/tasks" element={<TaskOperations />} />
      <Route path="/licences/:licenseId" element={<LicenseDetailPage />} />
      <Route path="/licenses/:licenseId" element={<LicenseDetailPage />} />
      <Route path="/licences" element={<Navigate to="/license-registry" replace />} />
      <Route path="/licenses" element={<Navigate to="/license-registry" replace />} />
      <Route path="/stations/:stationPublicId" element={<StationDetailPage />} />
      <Route path="/stations" element={<Navigate to="/station-regulatory-profiles" replace />} />
      <Route path="/station-managers/:userPublicId" element={<StationManagerDetailPage />} />
      <Route path="/cases/:caseId" element={<CaseDetailPage />} />
      <Route path="/cases" element={<Navigate to="/compliance-flags" replace />} />
      <Route path="/complaints/:complaintPublicId" element={<ComplaintDetailPage />} />
      <Route path="/complaints" element={<Navigate to="/complaints-center" replace />} />
      <Route path="/documents/task-evidence/:evidenceId" element={<DocumentDetailPage />} />
      <Route path="/documents/complaint-media/:complaintPublicId" element={<DocumentDetailPage />} />
      <Route path="/users/:userPublicId" element={<UserDetailPage />} />
      <Route path="/users" element={<Navigate to="/user-administration" replace />} />
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
  )
}

function PortalShell() {
  const location = useLocation()
  const {
    session,
    user,
    login,
    verifyLoginCode,
    resendLoginCode,
    cancelLoginChallenge,
    pendingLoginChallenge,
    logout,
    bootLoading,
    loginError,
    loading,
    hasLoadedSnapshot,
    actionLoading,
    actionLabel,
  } = usePortal()
  const activeMeta = resolveMeta(location.pathname)
  const landingPath = firstAccessiblePath(user)

  if (!session?.accessToken) {
    return (
      <LoginScreen
        onLogin={login}
        onVerifyCode={verifyLoginCode}
        onResendCode={resendLoginCode}
        onCancelCode={cancelLoginChallenge}
        pendingChallenge={pendingLoginChallenge}
        loading={bootLoading}
        error={loginError}
      />
    )
  }

  if (!hasLoadedSnapshot) {
    return <PortalBootSkeleton />
  }

  if (!landingPath) {
    return <NoAccessState onLogout={logout} />
  }

  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to={landingPath} replace />
  }

  const isDashboardRoute = location.pathname.startsWith('/dashboard')

  return (
    <div className="mera-app-root flex h-screen flex-col overflow-hidden text-[var(--mera-text)]">
      <ActionLoadingOverlay visible={actionLoading} label={actionLabel} />
      <PageHeader title={activeMeta.title} subtitle={activeMeta.subtitle} user={user} loading={loading} onLogout={logout} />
      {isDashboardRoute ? <DashboardViewStrip /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
        <Sidebar user={user} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <PortalRoutes landingPath={landingPath} />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <PortalProvider>
      <BrowserRouter>
        <DashboardChromeProvider>
          <PortalShell />
        </DashboardChromeProvider>
      </BrowserRouter>
    </PortalProvider>
  )
}

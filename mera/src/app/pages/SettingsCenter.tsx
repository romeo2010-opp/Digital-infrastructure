import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Database, Globe2, KeyRound, Laptop, Lock, LogOut, Palette, PlugZap, RefreshCw, Save, Search, Shield, Star, UserCheck, UserCircle2, Users } from 'lucide-react'
import { ModalShell } from '../components/ModalShell'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { FieldLabel, FieldShell } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Switch } from '../components/ui/switch'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export type SettingsSection = 'preferences' | 'notifications' | 'security' | 'profile' | 'users' | 'audit' | 'organization' | 'integrations' | 'data'

function isSeriousAuditLog(row: any) {
  const actionType = String(row?.action_type || '').toUpperCase()
  const actorRole = String(row?.actor_role || '').toUpperCase()
  const description = String(row?.action_description || '').toUpperCase()

  if (actorRole.includes('ADMIN') || actorRole.includes('SUPERVISOR')) return true
  if (actionType.includes('DELETE') || actionType.includes('DISMISS') || actionType.includes('SUSPEND')) return true
  if (actionType.includes('ESCALAT') || actionType.includes('RESOLVE') || actionType.includes('ENFORC')) return true
  if (actionType.includes('ASSIGN') || actionType.includes('STATUS')) return true
  if (description.includes('WARNING') || description.includes('FINE') || description.includes('CLOSURE')) return true
  if (description.includes('COMPLIANCE') || description.includes('VIOLATION') || description.includes('HIGH RISK')) return true
  return false
}

const roleOptions = [
  ['SUPER_ADMIN', 'Super Admin'],
  ['NATIONAL_OPERATIONS_ANALYST', 'National Operations Analyst'],
  ['REGIONAL_COMPLIANCE_SUPERVISOR', 'Regional Compliance Supervisor'],
  ['FIELD_COMPLIANCE_OFFICER', 'Field Compliance Officer'],
  ['PUBLIC_COMPLAINTS_ANALYST', 'Public Complaints Analyst'],
  ['LEGAL_ENFORCEMENT_OFFICER', 'Legal & Enforcement Officer'],
  ['LICENSING_OFFICER', 'Licensing Officer'],
  ['MARKET_SUPPLY_ANALYST', 'Market / Fuel Supply Analyst'],
  ['EXECUTIVE_VIEWER', 'Executive Viewer'],
] as const

function calculateAge(value: any) {
  if (!value) return null
  const birthDate = new Date(value)
  if (Number.isNaN(birthDate.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDelta = today.getMonth() - birthDate.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

function userDisplayName(row: any) {
  return row?.full_name || row?.fullName || row?.name || row?.email || 'MERA user'
}

function normalizeTaskRows(data: any) {
  return normalizeRows(data?.tasks?.items || data?.tasks || data?.myTasks?.items || data?.myTasks)
}

function taskBelongsToUser(task: any, user: any) {
  const publicId = String(user?.public_id || user?.publicId || '').trim()
  const email = String(user?.email || '').trim().toLowerCase()
  const name = String(userDisplayName(user)).trim().toLowerCase()
  const haystack = [
    task?.assigned_to_public_id,
    task?.assignedToPublicId,
    task?.assigned_to_user_public_id,
    task?.assignee_public_id,
    task?.assigned_to_email,
    task?.assignedToEmail,
    task?.assignee_email,
    task?.assigned_to_name,
    task?.assignedToName,
    task?.assignee_name,
    task?.assigned_to,
    task?.assignedTo,
  ].map((value) => String(value || '').trim().toLowerCase())

  return Boolean(
    (publicId && haystack.includes(publicId.toLowerCase())) ||
      (email && haystack.includes(email)) ||
      (name && haystack.includes(name)),
  )
}

function buildUserPerformance(user: any, data: any, detail: any) {
  const allTasks = [...normalizeRows(detail?.tasks), ...normalizeTaskRows(data)].filter((task, index, rows) => {
    const key = task?.task_number || task?.taskNumber || `${task?.title || 'task'}-${task?.created_at || index}`
    return rows.findIndex((candidate) => (candidate?.task_number || candidate?.taskNumber || `${candidate?.title || 'task'}-${candidate?.created_at || index}`) === key) === index
  })
  const tasks = allTasks.filter((task) => taskBelongsToUser(task, user) || normalizeRows(detail?.tasks).includes(task))
  const completed = tasks.filter((task) => ['COMPLETED', 'CLOSED', 'RESOLVED'].includes(String(task?.status || '').toUpperCase()))
  const now = Date.now()
  const overdue = tasks.filter((task) => {
    const due = task?.due_at || task?.dueAt
    if (!due) return false
    const dueMs = new Date(due).getTime()
    if (!Number.isFinite(dueMs)) return false
    const completedAt = task?.completed_at || task?.completedAt
    if (completedAt) return new Date(completedAt).getTime() > dueMs
    return dueMs < now && !['COMPLETED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(String(task?.status || '').toUpperCase())
  })
  const assigned = tasks.length
  const completionRate = assigned ? completed.length / assigned : 0
  const overdueRate = assigned ? overdue.length / assigned : 0
  const score = Math.max(0, Math.min(100, Math.round(completionRate * 82 + Math.min(completed.length, 18) - overdueRate * 38)))
  const tier = score >= 90 ? 'Platinum' : score >= 76 ? 'Gold' : score >= 58 ? 'Silver' : score >= 40 ? 'Bronze' : 'Needs support'

  return { tasks, assigned, completed: completed.length, overdue: overdue.length, score, tier }
}

export function SettingsCenter({ section }: { section: SettingsSection }) {
  const { data, user, token, api, runAction, requestPackets, preferences, updatePreferences, preferencesLoading, actionLoading } = usePortal()
  const [savedMessage, setSavedMessage] = useState('')
  const [settings, setSettings] = useState({
    appearance: 'light',
    density: 'comfortable',
    landingPage: 'dashboard',
    compactTables: false,
    shortageAlerts: true,
    complaintsAlerts: true,
    dailyDigest: true,
    browserNotifications: false,
    sessionTimeout: '30',
    requireStepUp: true,
    trustedDevice: false,
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [profileForm, setProfileForm] = useState({
    fullName: user?.fullName || user?.full_name || '',
    email: user?.email || '',
    role: user?.roleDisplayName || user?.role_display_name || user?.roleName || user?.role || 'Portal operator',
    phone: user?.phone || '',
  })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsMessage, setSessionsMessage] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [selectedAdminUser, setSelectedAdminUser] = useState<any>(null)
  const [selectedUserDetail, setSelectedUserDetail] = useState<any>(null)
  const [selectedUserLoading, setSelectedUserLoading] = useState(false)
  const [adminMessage, setAdminMessage] = useState('')
  const [permissionForm, setPermissionForm] = useState({
    roleName: 'FIELD_COMPLIANCE_OFFICER',
    districtScope: '',
    regionScope: '',
    accountStatus: 'ACTIVE',
  })

  const seriousLogs = useMemo(
    () => normalizeRows(data.auditLogs?.items).filter((row: any) => isSeriousAuditLog(row)).slice(0, 12),
    [data.auditLogs],
  )
  const users = useMemo(() => normalizeRows(data.users), [data.users])
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return users
    return users.filter((row: any) =>
      [row.full_name, row.email, row.role_display_name, row.role_code, row.district_scope, row.account_status]
        .some((value) => String(value || '').toLowerCase().includes(query)),
    )
  }, [userSearch, users])
  const activeUsers = users.filter((row: any) => String(row.account_status || '').toUpperCase() === 'ACTIVE')
  const adminUsers = users.filter((row: any) => /ADMIN|SUPERVISOR/.test(String(row.role_code || row.role_display_name || '').toUpperCase()))
  const districtScopedUsers = users.filter((row: any) => Boolean(row.district_scope))

  useEffect(() => {
    setProfileForm({
      fullName: user?.fullName || user?.full_name || 'MERA Regulator',
      email: user?.email || '',
      role: user?.roleDisplayName || user?.role_display_name || user?.roleName || user?.role || 'Portal operator',
      phone: user?.phone || '',
    })
  }, [user])

  useEffect(() => {
    if (!savedMessage) return
    const timeout = window.setTimeout(() => setSavedMessage(''), 2500)
    return () => window.clearTimeout(timeout)
  }, [savedMessage])

  useEffect(() => {
    if (!preferences) return
    setSettings({
      appearance: preferences.appearance === 'light' ? 'light' : 'black-white',
      density: preferences.density || 'comfortable',
      landingPage: preferences.landingPage || 'dashboard',
      compactTables: Boolean(preferences.compactTables),
      shortageAlerts: Boolean(preferences.shortageAlerts),
      complaintsAlerts: Boolean(preferences.complaintsAlerts),
      dailyDigest: Boolean(preferences.dailyDigest),
      browserNotifications: Boolean(preferences.browserNotifications),
      sessionTimeout: String(preferences.sessionTimeout || '30'),
      requireStepUp: Boolean(preferences.requireStepUp),
      trustedDevice: Boolean(preferences.trustedDevice),
    })
  }, [preferences])

  const loadSessions = async () => {
    if (!token) return
    setSessionsLoading(true)
    setSessionsMessage('')
    try {
      const payload = await api.listSessions(token)
      setSessions(normalizeRows(payload?.items || payload))
    } catch (err: any) {
      setSessionsMessage(err?.message || 'Unable to load active sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }

  const openUserDetail = async (row: any) => {
    setSelectedAdminUser(row)
    setSelectedUserDetail(null)
    setAdminMessage('')
    setPermissionForm({
      roleName: row?.role_code || 'FIELD_COMPLIANCE_OFFICER',
      districtScope: row?.district_scope || '',
      regionScope: row?.region_scope || '',
      accountStatus: row?.account_status || 'ACTIVE',
    })
    if (!token || !row?.public_id) return
    setSelectedUserLoading(true)
    try {
      const detail = await api.getUserDetail(token, row.public_id)
      setSelectedUserDetail(detail)
      const detailUser = detail?.user || row
      setPermissionForm({
        roleName: detailUser?.role_code || row?.role_code || 'FIELD_COMPLIANCE_OFFICER',
        districtScope: detailUser?.district_scope || '',
        regionScope: detailUser?.region_scope || '',
        accountStatus: detailUser?.account_status || row?.account_status || 'ACTIVE',
      })
    } catch (err: any) {
      setAdminMessage(err?.message || 'Unable to load user detail.')
    } finally {
      setSelectedUserLoading(false)
    }
  }

  useEffect(() => {
    if (section === 'security' && token) loadSessions()
  }, [section, token])

  useEffect(() => {
    if (!token) return
    if (section === 'users') {
      requestPackets(['users', 'tasks', 'myTasks', 'taskStats'], { reason: 'settings-users-performance', force: true })
    } else if (section === 'profile') {
      requestPackets(['myTasks', 'taskStats'], { reason: 'settings-profile-rating', force: true })
    }
  }, [requestPackets, section, token])

  const saveSettings = (message: string) => {
    setSavedMessage(message)
  }

  const renderPreferences = () => (
    <SectionCard title="Workspace" subtitle="Adjust how the portal behaves for this device">
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-[1rem] bg-[var(--mera-panel-muted)] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[var(--mera-panel)] p-2.5 text-[var(--mera-panel-text-soft)]">
              <Palette className="size-4" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--mera-panel-text)]">Display</h2>
          </div>

          <div className="space-y-3">
            <FieldLabel label="Theme" hint="Choose the MERA colour mode for this device." />
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['light', 'Light'],
                ['black-white', 'Government charcoal'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings((current: any) => ({ ...current, appearance: value }))}
                  className={`rounded-[15px] border px-4 py-3 text-sm font-semibold transition-colors ${
                    settings.appearance === value ? 'border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)]' : 'border-transparent bg-[rgb(255_255_255/0.7)] text-[var(--mera-panel-text-muted)] hover:bg-[var(--mera-panel)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <FieldLabel label="Display density" hint="Choose how much vertical space tables and panels use. Example: Compact shows more rows on smaller screens." />
            <div className="grid gap-2 sm:grid-cols-2">
              {['comfortable', 'compact'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings((current: any) => ({ ...current, density: value }))}
                  className={`rounded-[15px] border px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                    settings.density === value ? 'border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)]' : 'border-transparent bg-[rgb(255_255_255/0.7)] text-[var(--mera-panel-text-muted)] hover:bg-[var(--mera-panel)]'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 rounded-[1rem] bg-[var(--mera-panel-muted)] p-5">
          <h2 className="text-lg font-semibold text-[var(--mera-panel-text)]">Workspace behavior</h2>

          <FieldShell label="Default landing page" hint="Choose which MERA workspace opens after sign-in. Example: Dashboard for national monitoring, Complaints Center for triage teams.">
            <select
              value={settings.landingPage}
              onChange={(event) => setSettings((current: any) => ({ ...current, landingPage: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-sm text-[var(--mera-panel-text-soft)]"
            >
              <option value="dashboard">Dashboard</option>
              <option value="tasks">My Tasks</option>
              <option value="complaints">Complaints Center</option>
              <option value="hoarding">Hoarding Watchlist</option>
              <option value="inspections">Inspections</option>
              <option value="enforcement">Enforcement Actions</option>
              <option value="priceCompliance">Price Compliance</option>
              <option value="reports">Reports & Intelligence</option>
              <option value="audit">Audit Trail</option>
              <option value="users">Users & Roles</option>
              <option value="profile">Profile</option>
            </select>
          </FieldShell>

          <div className="grid gap-2 rounded-[15px] bg-[var(--mera-panel)] px-4 py-3">
            <FieldLabel label="Compact tables" hint="Reduce table row height across dense registers. Example: use compact mode when reviewing many complaints or audit logs." />
            <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">Compact tables</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">Reduce row height across dashboards and reports.</div>
            </div>
            <Switch
              checked={settings.compactTables}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, compactTables: checked }))}
            />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--mera-panel-border-soft)] px-5 py-4">
        <Button
          type="button"
          onClick={async () => {
            await updatePreferences(settings)
            saveSettings('Workspace preferences saved')
          }}
          disabled={preferencesLoading || actionLoading}
        >
          <Save className="size-4" />
          Save preferences
        </Button>
      </div>
    </SectionCard>
  )

  const renderNotifications = () => (
    <SectionCard title="Notifications" subtitle="Control which alerts and summaries reach the operator">
      <div className="grid gap-4 px-5 py-5">
        {[
          ['shortageAlerts', 'Shortage alerts', 'Notify when district supply pressure crosses a critical threshold.'],
          ['complaintsAlerts', 'Complaint escalations', 'Notify when unresolved complaint pressure triggers case escalation.'],
          ['dailyDigest', 'Daily digest', 'Send a daily summary of enforcement, supply, and complaint activity.'],
          ['browserNotifications', 'Browser notifications', 'Allow local desktop notifications on this device.'],
        ].map(([key, title, description]) => (
          <div key={key} className="grid gap-2 rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
            <FieldLabel label={title} hint={`${description} Example: turn this on for operational roles that need this alert type.`} />
            <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">{title}</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">{description}</div>
            </div>
            <Switch
              checked={Boolean((settings as any)[key])}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, [key]: checked }))}
            />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--mera-panel-border-soft)] px-5 py-4">
        <Button
          type="button"
          onClick={async () => {
            await updatePreferences(settings)
            saveSettings('Notification settings saved')
          }}
          disabled={preferencesLoading || actionLoading}
        >
          <Save className="size-4" />
          Save notifications
        </Button>
      </div>
    </SectionCard>
  )

  const renderSecurity = () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <SectionCard title="Change Password" subtitle="Update your MERA password and revoke other active sessions automatically">
        <form
          className="grid gap-4 px-5 py-5"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
              setPasswordMessage('Fill in all password fields first.')
              return
            }
            if (passwordForm.newPassword.length < 8) {
              setPasswordMessage('New password must be at least 8 characters.')
              return
            }
            if (passwordForm.newPassword !== passwordForm.confirmPassword) {
              setPasswordMessage('New password and confirmation do not match.')
              return
            }
            await runAction(() =>
              api.changePassword(token, {
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
              }),
              'Updating password...',
            )
            setPasswordMessage('Password updated successfully.')
            setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
          }}
        >
          <FieldShell label="Current password" hint="Enter the password currently used for this MERA account. Example: your existing portal password.">
            <Input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
              placeholder="Current password"
              className="h-11 rounded-[15px]"
            />
          </FieldShell>
          <FieldShell label="New password" hint="Use at least 8 characters and avoid reused passwords. Example: a long phrase with numbers or symbols.">
            <Input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
              placeholder="New password"
              className="h-11 rounded-[15px]"
            />
          </FieldShell>
          <FieldShell label="Confirm new password" hint="Repeat the new password to prevent accidental lockout from a typo.">
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
              placeholder="Confirm new password"
              className="h-11 rounded-[15px]"
            />
          </FieldShell>
          {passwordMessage ? <p className="text-sm text-slate-600">{passwordMessage}</p> : null}
          <Button type="submit" disabled={actionLoading}>
            <Lock className="size-4" />
            Update password
          </Button>
        </form>
      </SectionCard>

      <SectionCard title="Session Controls" subtitle="Controls that affect access verification on this device">
        <div className="grid gap-4 px-5 py-5">
          <FieldShell label="Session timeout" hint="Choose how long the portal can be idle before re-authentication. Example: 15 minutes for shared workstations.">
            <select
              value={settings.sessionTimeout}
              onChange={(event) => setSettings((current: any) => ({ ...current, sessionTimeout: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-sm text-[var(--mera-panel-text-soft)]"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </select>
          </FieldShell>

          <div className="grid gap-2 rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
            <FieldLabel label="Step-up verification" hint="Require an extra verification step before sensitive changes. Example: enforcement approval or role changes." />
            <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">Step-up verification</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">Require extra verification for sensitive actions.</div>
            </div>
            <Switch
              checked={settings.requireStepUp}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, requireStepUp: checked }))}
            />
            </div>
          </div>

          <div className="grid gap-2 rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
            <FieldLabel label="Trust this device" hint="Reduce repeated prompts only on a secure MERA workstation. Example: your assigned office laptop." />
            <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">Trust this device</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">Reduce repeated prompts on this workstation.</div>
            </div>
            <Switch
              checked={settings.trustedDevice}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, trustedDevice: checked }))}
            />
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--mera-panel-border-soft)] px-5 py-4">
          <Button
            type="button"
            onClick={async () => {
              await updatePreferences(settings)
              saveSettings('Security preferences saved')
            }}
            disabled={preferencesLoading || actionLoading}
          >
            <Shield className="size-4" />
            Save security
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Active Sessions" subtitle="Review signed-in devices and immediately revoke access where needed" className="lg:col-span-2">
        <div className="grid gap-4 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[var(--mera-panel-text-muted)]">
              {sessionsLoading ? 'Loading sessions...' : `${sessions.length} active ${sessions.length === 1 ? 'session' : 'sessions'}`}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={loadSessions} disabled={sessionsLoading || actionLoading}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-red-700 hover:bg-red-800"
                disabled={sessionsLoading || actionLoading || !sessions.some((item) => !item.current)}
                onClick={async () => {
                  await runAction(() => api.revokeOtherSessions(token), 'Signing out other devices...')
                  await loadSessions()
                  setSessionsMessage('Other devices signed out.')
                }}
              >
                <LogOut className="size-4" />
                Sign out other devices
              </Button>
            </div>
          </div>

          {sessionsMessage ? <div className="rounded-[8px] bg-slate-50 px-3 py-2 text-sm text-slate-600">{sessionsMessage}</div> : null}

          {sessionsLoading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse rounded-[8px] border border-slate-200 bg-white p-4">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="mt-3 h-3 w-1/2 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {sessions.map((session) => (
                <div key={session.publicId} className="grid gap-3 rounded-[8px] border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Laptop className="size-4 text-slate-500" />
                      <div className="truncate text-sm font-semibold text-slate-900">{session.userAgent || 'Unknown device'}</div>
                      {session.current ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Current device</span> : null}
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <span>IP: {session.ipAddress || '-'}</span>
                      <span>Last seen: {normalizeDate(session.lastSeenAt)}</span>
                      <span>Created: {normalizeDate(session.createdAt)}</span>
                      <span>Expires: {normalizeDate(session.expiresAt)}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start border-red-200 text-red-700 hover:bg-red-50"
                    disabled={session.current || actionLoading || sessionsLoading}
                    onClick={async () => {
                      await runAction(() => api.revokeSession(token, session.publicId), 'Revoking session...')
                      await loadSessions()
                      setSessionsMessage('Session revoked.')
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              {!sessions.length ? <div className="rounded-[8px] border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No active sessions found.</div> : null}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )

  const renderUsers = () => {
    const detailUser = selectedUserDetail?.user || selectedAdminUser
    const performance = buildUserPerformance(detailUser, data, selectedUserDetail)
    const age = calculateAge(detailUser?.date_of_birth || detailUser?.dateOfBirth || detailUser?.dob)

    return (
      <>
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ['Total users', users.length, Users],
              ['Active users', activeUsers.length, UserCheck],
              ['Admins', adminUsers.length, Shield],
              ['District scoped', districtScopedUsers.length, Globe2],
            ].map(([label, value, Icon]: any) => (
              <div key={label} className="rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12px] font-medium tracking-[-0.012em] text-[#6b7280]">{label}</div>
                  <Icon className="size-4 text-[#111827]" />
                </div>
                <div className="mt-3 text-[24px] font-semibold tracking-[-0.045em] text-[#111827]">{value}</div>
              </div>
            ))}
          </div>

          <SectionCard title="Users & Roles" subtitle="Manage operator access, role scope, sessions, and operational performance">
            <div className="border-b border-[#e5e7eb] px-5 py-4">
              <div className="flex h-10 items-center gap-2 rounded-[8px] border border-[#d1d5db] bg-white px-3">
                <Search className="size-4 text-[#6b7280]" />
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Search users, roles, districts..."
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[#111827] outline-none placeholder:text-[#9ca3af]"
                />
              </div>
            </div>
            <PortalTable
              rows={filteredUsers}
              columns={[
                { key: 'full_name', label: 'Name', render: (row) => <button type="button" className="text-left font-semibold text-[#111827]" onClick={() => openUserDetail(row)}>{userDisplayName(row)}</button> },
                { key: 'email', label: 'Email' },
                { key: 'role_display_name', label: 'Role', render: (row) => renderPill(row.role_display_name || row.role_code) },
                { key: 'district_scope', label: 'District scope', render: (row) => row.district_scope || 'National' },
                { key: 'last_login_at', label: 'Last login', render: (row) => normalizeDate(row.last_login_at) },
                { key: 'account_status', label: 'Status', render: (row) => renderPill(row.account_status) },
                {
                  key: 'action',
                  label: 'Action',
                  render: (row) => (
                    <Button type="button" variant="outline" size="sm" onClick={() => openUserDetail(row)}>
                      View
                    </Button>
                  ),
                },
              ]}
            />
          </SectionCard>
        </div>

        <ModalShell
          open={Boolean(selectedAdminUser)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedAdminUser(null)
              setSelectedUserDetail(null)
              setAdminMessage('')
            }
          }}
          title={detailUser ? userDisplayName(detailUser) : 'User detail'}
          description={detailUser?.email || 'Inspect account scope, permissions, task performance, and sessions.'}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => selectedAdminUser && openUserDetail(selectedAdminUser)} disabled={selectedUserLoading}>
                <RefreshCw className={`size-4 ${selectedUserLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                type="button"
                className="bg-[#111111] hover:bg-[#2a2a2a]"
                disabled={!detailUser || actionLoading}
                onClick={async () => {
                  await runAction(() => api.updateUserPermissions(token, detailUser.public_id, permissionForm), 'Updating user access...')
                  setAdminMessage('User access updated.')
                  await openUserDetail(detailUser)
                }}
              >
                <KeyRound className="size-4" />
                Save access
              </Button>
            </>
          }
        >
          <div className="max-h-[72vh] overflow-y-auto pr-1">
            {adminMessage ? <div className="mb-4 rounded-[8px] bg-[#f3f4f6] px-3 py-2 text-[12px] font-medium text-[#374151]">{adminMessage}</div> : null}
            {selectedUserLoading && !selectedUserDetail ? (
              <div className="rounded-[8px] border border-dashed border-[#d1d5db] p-6 text-center text-sm text-[#6b7280]">Loading user detail...</div>
            ) : detailUser ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    ['Tasks assigned', performance.assigned],
                    ['Tasks completed', performance.completed],
                    ['Overdue handled', performance.overdue],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3">
                      <div className="text-[12px] font-medium text-[#6b7280]">{label}</div>
                      <div className="mt-2 text-[22px] font-semibold tracking-[-0.04em] text-[#111827]">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-medium text-[#6b7280]">System reward rating</div>
                      <div className="mt-1 flex items-center gap-2 text-[22px] font-semibold tracking-[-0.04em] text-[#111827]">
                        <Star className="size-5 fill-[#111827] text-[#111827]" />
                        {performance.score}/100
                      </div>
                    </div>
                    {renderPill(performance.tier)}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f3f4f6]">
                    <div className="h-full rounded-full bg-[#111111]" style={{ width: `${performance.score}%` }} />
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                    <div className="mb-3 text-[13px] font-semibold text-[#111827]">Identity</div>
                    <dl className="grid gap-2 text-[12px]">
                      {[
                        ['Name', userDisplayName(detailUser)],
                        ['Email', detailUser.email || '-'],
                        ['Date of birth', detailUser.date_of_birth || detailUser.dateOfBirth || 'Not captured'],
                        ['Gender', detailUser.gender || 'Not captured'],
                        ['Current age', age ?? 'Not captured'],
                        ['District scope', detailUser.district_scope || 'National'],
                      ].map(([label, value]) => (
                        <div key={label} className="grid gap-1 border-b border-[#f3f4f6] pb-2 last:border-0 last:pb-0 sm:grid-cols-[130px_minmax(0,1fr)]">
                          <dt className="font-medium text-[#6b7280]">{label}</dt>
                          <dd className="min-w-0 break-words font-semibold text-[#111827] sm:text-right">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                    <div className="mb-3 text-[13px] font-semibold text-[#111827]">Access</div>
                    <div className="grid gap-3">
                      <FieldShell label="Role" hint="Changing the role changes the permission set this user receives.">
                        <select className="h-10 w-full rounded-[8px] border border-[#d1d5db] bg-white px-3 text-sm text-[#111827]" value={permissionForm.roleName} onChange={(event) => setPermissionForm((current) => ({ ...current, roleName: event.target.value }))}>
                          {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </FieldShell>
                      <FieldShell label="District scope" hint="Leave blank for national access, or enter a district for scoped access.">
                        <Input className="h-10 rounded-[8px]" value={permissionForm.districtScope} onChange={(event) => setPermissionForm((current) => ({ ...current, districtScope: event.target.value }))} placeholder="National" />
                      </FieldShell>
                      <FieldShell label="Region scope" hint="Optional regional label used for oversight grouping.">
                        <Input className="h-10 rounded-[8px]" value={permissionForm.regionScope} onChange={(event) => setPermissionForm((current) => ({ ...current, regionScope: event.target.value }))} placeholder="Region scope" />
                      </FieldShell>
                      <FieldShell label="Account status" hint="Disable or suspend an account when access should stop.">
                        <select className="h-10 w-full rounded-[8px] border border-[#d1d5db] bg-white px-3 text-sm text-[#111827]" value={permissionForm.accountStatus} onChange={(event) => setPermissionForm((current) => ({ ...current, accountStatus: event.target.value }))}>
                          <option value="ACTIVE">Active</option>
                          <option value="INVITED">Invited</option>
                          <option value="SUSPENDED">Suspended</option>
                          <option value="DISABLED">Disabled</option>
                        </select>
                      </FieldShell>
                    </div>
                  </div>
                </div>

                <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-[#111827]">Admin actions</div>
                      <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Immediate controls for compromised or stale access.</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-red-200 text-red-700 hover:bg-red-50"
                      disabled={actionLoading}
                      onClick={async () => {
                        await runAction(() => api.revokeUserSessions(token, detailUser.public_id), 'Revoking user sessions...')
                        setAdminMessage('Active sessions revoked for this user.')
                      }}
                    >
                      <LogOut className="size-4" />
                      Revoke sessions
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                    <div className="mb-3 text-[13px] font-semibold text-[#111827]">Recent tasks</div>
                    <div className="grid gap-2">
                      {performance.tasks.slice(0, 6).map((task: any) => (
                        <div key={task.task_number || task.taskNumber || task.title} className="rounded-[8px] bg-[#f9fafb] px-3 py-2">
                          <div className="text-[12px] font-semibold text-[#111827]">{task.title || task.task_number || task.taskNumber}</div>
                          <div className="mt-1 text-[11px] font-medium text-[#6b7280]">{task.status || '-'} · Due {normalizeDate(task.due_at || task.dueAt)}</div>
                        </div>
                      ))}
                      {!performance.tasks.length ? <div className="text-[12px] font-medium text-[#6b7280]">No tasks found for this user.</div> : null}
                    </div>
                  </div>

                  <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-4">
                    <div className="mb-3 text-[13px] font-semibold text-[#111827]">Recent audit activity</div>
                    <div className="grid gap-2">
                      {normalizeRows(selectedUserDetail?.audit).slice(0, 6).map((row: any) => (
                        <div key={`${row.action_type}-${row.created_at}`} className="rounded-[8px] bg-[#f9fafb] px-3 py-2">
                          <div className="text-[12px] font-semibold text-[#111827]">{row.action_type}</div>
                          <div className="mt-1 text-[11px] font-medium text-[#6b7280]">{normalizeDate(row.created_at)}</div>
                        </div>
                      ))}
                      {!normalizeRows(selectedUserDetail?.audit).length ? <div className="text-[12px] font-medium text-[#6b7280]">No audit activity found.</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ModalShell>
      </>
    )
  }

  const renderProfile = () => {
    const profilePerformance = buildUserPerformance(user, data, { tasks: normalizeRows(data.myTasks?.items || data.myTasks) })
    return (
    <SectionCard title="Profile" subtitle="Update personal operator information used throughout the portal">
      <div className="grid gap-3 px-5 pt-5 md:grid-cols-4">
        {[
          ['Rating', `${profilePerformance.score}/100`],
          ['Reward tier', profilePerformance.tier],
          ['Completed', profilePerformance.completed],
          ['Overdue handled', profilePerformance.overdue],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3">
            <div className="text-[12px] font-medium text-[#6b7280]">{label}</div>
            <div className="mt-2 break-words text-[20px] font-semibold tracking-[-0.04em] text-[#111827]">{value}</div>
          </div>
        ))}
      </div>
      <form
        className="grid gap-4 px-5 py-5 lg:max-w-2xl"
        onSubmit={async (event) => {
          event.preventDefault()
          await runAction(() =>
            api.updateMe(token, {
              fullName: profileForm.fullName,
              email: profileForm.email,
              phone: profileForm.phone || null,
            }),
            'Saving profile...',
          )
          saveSettings('Profile details saved')
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Full name" hint="This name appears in task activity, audit logs, and enforcement records.">
            <Input
              value={profileForm.fullName}
              onChange={(event) => setProfileForm({ ...profileForm, fullName: event.target.value })}
              placeholder="Full name"
              className="h-11 rounded-[8px]"
            />
          </FieldShell>
          <FieldShell label="Email address" hint="This is the account email used for sign-in and official portal contact.">
            <Input
              value={profileForm.email}
              onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
              placeholder="Email address"
              className="h-11 rounded-[8px]"
            />
          </FieldShell>
        </div>

        <FieldShell label="Phone number" hint="Optional number for operational follow-up.">
          <Input
            value={profileForm.phone}
            onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })}
            placeholder="Phone number"
            className="h-11 rounded-[8px]"
          />
        </FieldShell>

        <FieldShell label="Role" hint="Shown for context; role changes are managed from Users & Roles.">
          <Input value={profileForm.role} readOnly className="h-11 rounded-[8px] bg-[#f9fafb]" />
        </FieldShell>

        <label className="grid gap-2 rounded-[8px] bg-[var(--mera-panel-muted)] px-4 py-4 text-sm text-[var(--mera-panel-text-soft)]">
          <FieldLabel label="Audit visibility" hint="Keep this on when your name should appear on enforcement and audit records you create." />
          <span className="flex items-center gap-3">
            <Checkbox checked />
            Show my name in audit and enforcement records
          </span>
        </label>

        <Button type="submit" className="w-fit bg-[#111111] hover:bg-[#2a2a2a]" disabled={actionLoading}>
          <UserCircle2 className="size-4" />
          Save profile
        </Button>
      </form>
    </SectionCard>
    )
  }

  const renderAudit = () => (
    <SectionCard title="Audit Logs" subtitle="Material audit entries only, focused on serious oversight and enforcement actions">
      <PortalTable
        rows={seriousLogs}
        columns={[
          { key: 'created_at', label: 'When', render: (row) => normalizeDate(row.created_at) },
          { key: 'action_type', label: 'Event', render: (row) => renderPill(row.action_type) },
          { key: 'actor_name', label: 'By', render: (row) => row.actor_name || 'System' },
          { key: 'actor_role', label: 'Role', render: (row) => row.actor_role || '-' },
          { key: 'action_description', label: 'Message' },
        ]}
      />
    </SectionCard>
  )

  const renderOrganization = () => (
    <SectionCard title="Organization" subtitle="Configure MERA identity details used across official portal activity">
      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        <FieldShell label="Organization name" hint="Official name shown in reports and notices. Example: Malawi Energy Regulatory Authority.">
          <Input value="Malawi Energy Regulatory Authority" readOnly className="h-11 rounded-[8px] bg-white" />
        </FieldShell>
        <FieldShell label="Default region" hint="Used when a workflow needs a national default scope. Example: National operations.">
          <Input value="National operations" readOnly className="h-11 rounded-[8px] bg-white" />
        </FieldShell>
        <FieldShell label="Public contact email" hint="Contact shown on public notices and generated documents.">
          <Input value="info@mera.mw" readOnly className="h-11 rounded-[8px] bg-white" />
        </FieldShell>
        <FieldShell label="Report footer" hint="Short footer appended to exported regulatory reports.">
          <Input value="Generated by SmartLink MERA Command Centre" readOnly className="h-11 rounded-[8px] bg-white" />
        </FieldShell>
      </div>
    </SectionCard>
  )

  const renderIntegrations = () => (
    <SectionCard title="Integrations" subtitle="Manage connected services for alerts, data exchange and developer access">
      <div className="grid gap-4 px-5 py-5">
        {[
          ['SmartLink API', 'Active', 'Secure station, task and compliance packet exchange.'],
          ['Email delivery', 'Active', 'Login codes, notifications and public notice delivery.'],
          ['Webhook events', 'Not configured', 'Send task, case and enforcement updates to external systems.'],
        ].map(([title, status, description]) => (
          <div key={title} className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#e2e8f0] bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold tracking-[-0.018em] text-[#111827]">{title}</div>
              <div className="mt-1 text-[12px] font-medium tracking-[-0.012em] text-[#6b7280]">{description}</div>
            </div>
            <div className="flex items-center gap-2">
              {renderPill(status)}
              <Button type="button" variant="outline" size="sm">
                Configure
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )

  const renderDataControls = () => (
    <SectionCard title="Data Controls" subtitle="Set retention, exports and operational data handling preferences">
      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        <FieldShell label="Audit retention" hint="How long material audit records should remain available in the portal.">
          <select className="h-11 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-4 text-sm text-[#374151]" defaultValue="7y">
            <option value="3y">3 years</option>
            <option value="7y">7 years</option>
            <option value="forever">Indefinite</option>
          </select>
        </FieldShell>
        <FieldShell label="Export format" hint="Default format for generated operational reports.">
          <select className="h-11 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-4 text-sm text-[#374151]" defaultValue="pdf">
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
            <option value="xlsx">Excel</option>
          </select>
        </FieldShell>
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white px-4 py-3">
          <FieldLabel label="Daily backup checks" hint="Confirm that packet snapshots and audit records are available for recovery." />
          <div className="flex items-center justify-between gap-4">
            <div className="text-[12px] font-medium text-[#6b7280]">Run integrity checks every day.</div>
            <Switch checked />
          </div>
        </div>
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white px-4 py-3">
          <FieldLabel label="Sensitive exports" hint="Require step-up verification before exporting sensitive compliance or citizen records." />
          <div className="flex items-center justify-between gap-4">
            <div className="text-[12px] font-medium text-[#6b7280]">Protect high-risk exports.</div>
            <Switch checked />
          </div>
        </div>
      </div>
    </SectionCard>
  )

  const sectionConfig = {
    preferences: {
      title: 'Preferences',
      subtitle: 'Adjust appearance, density, and workspace defaults.',
      icon: Palette,
      content: renderPreferences(),
    },
    notifications: {
      title: 'Notifications',
      subtitle: 'Choose which incident and complaint alerts should reach you.',
      icon: Bell,
      content: renderNotifications(),
    },
    security: {
      title: 'Security',
      subtitle: 'Change your password and manage session controls.',
      icon: Lock,
      content: renderSecurity(),
    },
    profile: {
      title: 'Profile',
      subtitle: 'Manage your personal MERA account details.',
      icon: UserCircle2,
      content: renderProfile(),
    },
    users: {
      title: 'Users & Roles',
      subtitle: 'Manage MERA operator access, sessions, role scope, and performance.',
      icon: Users,
      content: renderUsers(),
    },
    audit: {
      title: 'Audit Logs',
      subtitle: 'Review material actions that matter for oversight.',
      icon: Shield,
      content: renderAudit(),
    },
    organization: {
      title: 'Organization',
      subtitle: 'Manage official workspace identity and report defaults.',
      icon: Globe2,
      content: renderOrganization(),
    },
    integrations: {
      title: 'Integrations',
      subtitle: 'Configure APIs, webhooks and delivery channels.',
      icon: PlugZap,
      content: renderIntegrations(),
    },
    data: {
      title: 'Data Controls',
      subtitle: 'Configure retention, exports and backup handling.',
      icon: Database,
      content: renderDataControls(),
    },
  } as const

  const current = sectionConfig[section]
  return (
    <div className="h-full overflow-hidden bg-white">
      <main className="min-w-0 overflow-y-auto px-5 py-6 lg:px-8">
        <div className="mx-auto grid max-w-[1064px] gap-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-medium tracking-[-0.012em] text-[#6b7280]">
                {(() => {
                  const Icon = current.icon
                  return <Icon className="size-4" />
                })()}
                Settings
              </div>
              <h1 className="mt-2 text-[25px] font-semibold tracking-[-0.05em] text-[#111827]">{current.title}</h1>
              <p className="mt-1 max-w-[42rem] text-[13px] font-medium tracking-[-0.012em] text-[#6b7280]">{current.subtitle}</p>
            </div>
            {savedMessage ? (
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-4" />
                {savedMessage}
              </div>
            ) : null}
          </header>

          {current.content}
        </div>
      </main>
    </div>
  )
}

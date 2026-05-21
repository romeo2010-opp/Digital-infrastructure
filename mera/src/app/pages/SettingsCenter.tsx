import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Laptop, Lock, LogOut, Palette, RefreshCw, Save, Shield, UserCircle2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Switch } from '../components/ui/switch'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export type SettingsSection = 'preferences' | 'notifications' | 'security' | 'users' | 'audit'

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

export function SettingsCenter({ section }: { section: SettingsSection }) {
  const { data, user, token, api, runAction, preferences, updatePreferences, preferencesLoading, actionLoading } = usePortal()
  const [savedMessage, setSavedMessage] = useState('')
  const [settings, setSettings] = useState({
    appearance: 'system',
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
  const [profileForm, setProfileForm] = useState({
    fullName: user?.fullName ,
    email: user?.email || '',
    role: user?.role || 'Portal operator',
    phone: user?.phone || '',
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsMessage, setSessionsMessage] = useState('')

  const seriousLogs = useMemo(
    () => normalizeRows(data.auditLogs?.items).filter((row: any) => isSeriousAuditLog(row)).slice(0, 12),
    [data.auditLogs],
  )

  useEffect(() => {
    setProfileForm({
      fullName: user?.fullName || user?.full_name || 'MERA Regulator',
      email: user?.email || '',
      role: user?.role || 'Portal operator',
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
      appearance: preferences.appearance || 'system',
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

  useEffect(() => {
    if (section === 'security' && token) loadSessions()
  }, [section, token])

  const saveSettings = (message: string) => {
    setSavedMessage(message)
  }

  const renderPreferences = () => (
    <SectionCard title="Appearance & Workspace" subtitle="Adjust how the portal looks and behaves for this device">
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-[1rem] bg-[var(--mera-panel-muted)] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[var(--mera-panel)] p-2.5 text-[var(--mera-panel-text-soft)]">
              <Palette className="size-4" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--mera-panel-text)]">Appearance</h2>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-[var(--mera-panel-text-soft)]">Theme</label>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ['light', 'Light'],
                ['system', 'System'],
                ['dark', 'Dark'],
                ['black-white', 'Black/White'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings((current: any) => ({ ...current, appearance: value }))}
                  className={`rounded-[15px] border px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                    settings.appearance === value ? 'border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)]' : 'border-transparent bg-[rgb(255_255_255/0.7)] text-[var(--mera-panel-text-muted)] hover:bg-[var(--mera-panel)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-[var(--mera-panel-text-soft)]">Display density</label>
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

          <div>
            <label className="mb-2 block text-sm font-semibold text-[var(--mera-panel-text-soft)]">Default landing page</label>
            <select
              value={settings.landingPage}
              onChange={(event) => setSettings((current: any) => ({ ...current, landingPage: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-sm text-[var(--mera-panel-text-soft)]"
            >
              <option value="dashboard">Dashboard</option>
              <option value="complaints">Complaints Center</option>
              <option value="hoarding">Hoarding Watchlist</option>
              <option value="audit">Audit Trail</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-[var(--mera-panel)] px-4 py-3">
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

      <div className="border-t border-[var(--mera-panel-border-soft)] px-5 py-4">
        <Button
          type="button"
          onClick={async () => {
            await updatePreferences(settings)
            saveSettings('Appearance preferences saved')
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
          <div key={key} className="flex items-center justify-between rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">{title}</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">{description}</div>
            </div>
            <Switch
              checked={Boolean((settings as any)[key])}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, [key]: checked }))}
            />
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
          <Input
            type="password"
            value={passwordForm.currentPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
            placeholder="Current password"
            className="h-11 rounded-[15px]"
          />
          <Input
            type="password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
            placeholder="New password"
            className="h-11 rounded-[15px]"
          />
          <Input
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
            placeholder="Confirm new password"
            className="h-11 rounded-[15px]"
          />
          {passwordMessage ? <p className="text-sm text-slate-600">{passwordMessage}</p> : null}
          <Button type="submit" disabled={actionLoading}>
            <Lock className="size-4" />
            Update password
          </Button>
        </form>
      </SectionCard>

      <SectionCard title="Session Controls" subtitle="Controls that affect access verification on this device">
        <div className="grid gap-4 px-5 py-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-[var(--mera-panel-text-soft)]">Session timeout</label>
            <select
              value={settings.sessionTimeout}
              onChange={(event) => setSettings((current: any) => ({ ...current, sessionTimeout: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-sm text-[var(--mera-panel-text-soft)]"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-[var(--mera-panel-text)]">Step-up verification</div>
              <div className="text-sm text-[var(--mera-panel-text-muted)]">Require extra verification for sensitive actions.</div>
            </div>
            <Switch
              checked={settings.requireStepUp}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, requireStepUp: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4">
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

  const renderUsers = () => (
    <SectionCard title="User Profile" subtitle="Update personal operator information used throughout the portal">
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
          <Input
            value={profileForm.fullName}
            onChange={(event) => setProfileForm({ ...profileForm, fullName: event.target.value })}
            placeholder="Full name"
            className="h-11 rounded-[15px]"
          />
          <Input
            value={profileForm.email}
            onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
            placeholder="Email address"
            className="h-11 rounded-[15px]"
          />
        </div>

        <Input
          value={profileForm.phone}
          onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })}
          placeholder="Phone number"
          className="h-11 rounded-[15px]"
        />

        <Input
          value={profileForm.role}
          onChange={(event) => setProfileForm({ ...profileForm, role: event.target.value })}
          placeholder="Role"
          className="h-11 rounded-[15px]"
        />

        <label className="flex items-center gap-3 rounded-[15px] bg-[var(--mera-panel-muted)] px-4 py-4 text-sm text-[var(--mera-panel-text-soft)]">
          <Checkbox checked />
          Show my name in audit and enforcement records
        </label>

        <Button type="submit" className="w-fit" disabled={actionLoading}>
          <UserCircle2 className="size-4" />
          Save profile
        </Button>
      </form>
    </SectionCard>
  )

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
    users: {
      title: 'Users',
      subtitle: 'Update personal account details used by the portal.',
      icon: UserCircle2,
      content: renderUsers(),
    },
    audit: {
      title: 'Audit Logs',
      subtitle: 'Review material actions that matter for oversight.',
      icon: Shield,
      content: renderAudit(),
    },
  } as const

  const current = sectionConfig[section]

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-6">
      {savedMessage ? (
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="size-4" />
          {savedMessage}
        </div>
      ) : null}

      {current.content}
    </div>
  )
}

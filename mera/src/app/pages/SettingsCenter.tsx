import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Lock, Palette, Save, Shield, UserCircle2 } from 'lucide-react'
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
  const { data, user, token, api, runAction } = usePortal()
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
  const [loadingPreferences, setLoadingPreferences] = useState(false)

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
    if (!token) return
    let cancelled = false
    const loadPreferences = async () => {
      setLoadingPreferences(true)
      try {
        const payload = await api.getMyPreferences(token)
        if (!cancelled && payload) {
          setSettings({
            appearance: payload.appearance || 'system',
            density: payload.density || 'comfortable',
            landingPage: payload.landingPage || 'dashboard',
            compactTables: Boolean(payload.compactTables),
            shortageAlerts: Boolean(payload.shortageAlerts),
            complaintsAlerts: Boolean(payload.complaintsAlerts),
            dailyDigest: Boolean(payload.dailyDigest),
            browserNotifications: Boolean(payload.browserNotifications),
            sessionTimeout: String(payload.sessionTimeout || '30'),
            requireStepUp: Boolean(payload.requireStepUp),
            trustedDevice: Boolean(payload.trustedDevice),
          })
        }
      } catch {
        // leave defaults in place if preferences are not yet available
      } finally {
        if (!cancelled) setLoadingPreferences(false)
      }
    }
    loadPreferences()
    return () => {
      cancelled = true
    }
  }, [api, token])

  const saveSettings = (message: string) => {
    setSavedMessage(message)
  }

  const renderPreferences = () => (
    <SectionCard title="Appearance & Workspace" subtitle="Adjust how the portal looks and behaves for this device">
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-[1rem] bg-[#f4f6fb] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white p-2.5 text-slate-700">
              <Palette className="size-4" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Appearance</h2>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">Theme</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {['light', 'system', 'dark'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings((current: any) => ({ ...current, appearance: value }))}
                  className={`rounded-[15px] border px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                    settings.appearance === value ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-white/70 text-slate-500 hover:bg-white'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">Display density</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {['comfortable', 'compact'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings((current: any) => ({ ...current, density: value }))}
                  className={`rounded-[15px] border px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                    settings.density === value ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-white/70 text-slate-500 hover:bg-white'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 rounded-[1rem] bg-[#f4f6fb] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Workspace behavior</h2>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Default landing page</label>
            <select
              value={settings.landingPage}
              onChange={(event) => setSettings((current: any) => ({ ...current, landingPage: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-slate-200 bg-white px-4 text-sm text-slate-700"
            >
              <option value="dashboard">Dashboard</option>
              <option value="complaints">Complaints Center</option>
              <option value="hoarding">Hoarding Watchlist</option>
              <option value="audit">Audit Trail</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-white px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Compact tables</div>
              <div className="text-sm text-slate-500">Reduce row height across dashboards and reports.</div>
            </div>
            <Switch
              checked={settings.compactTables}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, compactTables: checked }))}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <Button
          type="button"
          onClick={async () => {
            await runAction(() => api.updateMyPreferences(token, settings))
            saveSettings('Appearance preferences saved')
          }}
          disabled={loadingPreferences}
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
          <div key={key} className="flex items-center justify-between rounded-[15px] bg-[#f4f6fb] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-800">{title}</div>
              <div className="text-sm text-slate-500">{description}</div>
            </div>
            <Switch
              checked={Boolean((settings as any)[key])}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, [key]: checked }))}
            />
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <Button
          type="button"
          onClick={async () => {
            await runAction(() => api.updateMyPreferences(token, settings))
            saveSettings('Notification settings saved')
          }}
          disabled={loadingPreferences}
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
          <Button type="submit">
            <Lock className="size-4" />
            Update password
          </Button>
        </form>
      </SectionCard>

      <SectionCard title="Session Controls" subtitle="Controls that affect access verification on this device">
        <div className="grid gap-4 px-5 py-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Session timeout</label>
            <select
              value={settings.sessionTimeout}
              onChange={(event) => setSettings((current: any) => ({ ...current, sessionTimeout: event.target.value }))}
              className="h-11 w-full rounded-[15px] border border-slate-200 bg-white px-4 text-sm text-slate-700"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-[#f4f6fb] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-800">Step-up verification</div>
              <div className="text-sm text-slate-500">Require extra verification for sensitive actions.</div>
            </div>
            <Switch
              checked={settings.requireStepUp}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, requireStepUp: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-[15px] bg-[#f4f6fb] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-800">Trust this device</div>
              <div className="text-sm text-slate-500">Reduce repeated prompts on this workstation.</div>
            </div>
            <Switch
              checked={settings.trustedDevice}
              onCheckedChange={(checked) => setSettings((current: any) => ({ ...current, trustedDevice: checked }))}
            />
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <Button
            type="button"
            onClick={async () => {
              await runAction(() => api.updateMyPreferences(token, settings))
              saveSettings('Security preferences saved')
            }}
          >
            <Shield className="size-4" />
            Save security
          </Button>
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

        <label className="flex items-center gap-3 rounded-[15px] bg-[#f4f6fb] px-4 py-4 text-sm text-slate-700">
          <Checkbox checked />
          Show my name in audit and enforcement records
        </label>

        <Button type="submit" className="w-fit">
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

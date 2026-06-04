import { useEffect, useMemo, useState } from "react"
import { authApi } from "../api/authApi"
import { internalApi } from "../api/internalApi"
import { formatDateTime, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"
import MetricGrid from "./MetricGrid"

function SectionIcon({ name }) {
  const common = {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }

  switch (name) {
    case "general":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 1-2 0 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 1 0-2 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.03 4.3l.06.06A1.7 1.7 0 0 0 9 4.6c.39 0 .77-.14 1-.6a1.7 1.7 0 0 1 2 0c.23.46.61.6 1 .6a1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c0 .39.14.77.6 1a1.7 1.7 0 0 1 0 2c-.46.23-.6.61-.6 1Z" /></svg>
    case "workspace":
      return <svg {...common}><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="15" width="7" height="7" rx="1.5" /><rect x="14" y="15" width="7" height="7" rx="1.5" /></svg>
    case "security":
      return <svg {...common}><path d="M12 3 5 6v6c0 4.9 3.1 8.2 7 9 3.9-.8 7-4.1 7-9V6l-7-3Z" /><path d="M12 11v3" /><circle cx="12" cy="8.5" r=".8" fill="currentColor" stroke="none" /></svg>
    case "sync":
      return <svg {...common}><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 16v5h5" /><path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" /><path d="M21 8V3h-5" /></svg>
    case "account":
      return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.5-3.2 4.1-4.8 7-4.8s5.5 1.6 7 4.8" /></svg>
    case "controls":
      return <svg {...common}><path d="M4 7h16M7 12h10M10 17h4" /><circle cx="8" cy="7" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" /></svg>
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>
  }
}

const BASE_SETTINGS_SECTIONS = [
  { key: "profile", label: "Profile", description: "Name, phone, and your internal identity.", icon: "account" },
  { key: "preferences", label: "Preferences", description: "Visible modules and workspace presentation.", icon: "workspace" },
  { key: "notifications", label: "Notifications", description: "Internal alert delivery and approval request visibility.", icon: "general" },
  { key: "security", label: "Security", description: "Session details and account protection.", icon: "security" },
  { key: "users", label: "Users & Roles", description: "Roles, permissions, and access scope for this account.", icon: "workspace" },
  { key: "audit", label: "Audit", description: "Read-only session and profile audit metadata.", icon: "sync" },
  { key: "organization", label: "Organization", description: "Workspace identity and account metadata.", icon: "account" },
  { key: "integrations", label: "Integrations", description: "Connected services and operational integration posture.", icon: "controls" },
  { key: "data", label: "Data Controls", description: "Sync workspace data and manage governance controls.", icon: "controls" },
]

const OWNER_CONTROL_SPECS = [
  { key: "support_refund_threshold_mwk", label: "Refund threshold", description: "Upper support refund limit before finance or owner intervention is required." },
  { key: "escalation_policy_window_minutes", label: "Escalation policy", description: "Minutes before high-priority internal issues must escalate." },
  { key: "audit_retention_days", label: "Audit retention", description: "How long internal audit events remain in retained control storage." },
  { key: "internal_access_policy", label: "Internal access policy", description: "Policy mode governing internal access posture and restrictions." },
  { key: "emergency_override_enabled", label: "Emergency override", description: "Global emergency override switch for exceptional operational control." },
  { key: "allow_quick_tunnel_host", label: "Quick tunnel host", description: "Allow temporary tunnel hosting for internal debugging workflows." },
]

function SettingsRow({ label, description = "", control }) {
  return (
    <div className="settings-modal-row">
      <div className="settings-modal-row-copy">
        <strong>{label}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-modal-row-control">{control}</div>
    </div>
  )
}

export default function InternalSettingsModal({ onClose = () => {}, embedded = false, section = "profile" }) {
  const { session, refreshProfile, logout } = useInternalAuth()
  const [activeSection, setActiveSection] = useState(section || "profile")
  const [draft, setDraft] = useState({ fullName: "", phone: "" })
  const [controlDrafts, setControlDrafts] = useState({})
  const [settingsData, setSettingsData] = useState({ items: [], summary: {} })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState("")
  const [controlSavingKey, setControlSavingKey] = useState("")
  const [savedMessage, setSavedMessage] = useState("")

  const profile = session?.profile || {}
  const user = profile.user || {}
  const roles = profile.roles || []
  const permissions = profile.permissions || []
  const navigation = profile.navigation || []
  const canViewInternalSettings = permissions.includes("settings:view")
  const canEditInternalSettings = permissions.includes("settings:edit")
  const settingsSections = BASE_SETTINGS_SECTIONS

  useEffect(() => {
    if (!section) return
    setActiveSection(section)
  }, [section])

  useEffect(() => {
    if (embedded) return undefined

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [embedded, onClose])

  useEffect(() => {
    setDraft({
      fullName: user.fullName || "",
      phone: user.phone || "",
    })
  }, [user.fullName, user.phone])

  useEffect(() => {
    if (!canViewInternalSettings) return
    internalApi
      .getSettings()
      .then((payload) => {
        setSettingsData(payload)
        setControlDrafts(
          Object.fromEntries((payload?.items || []).map((item) => [item.settingKey, String(item.settingValue ?? "")]))
        )
      })
      .catch((fetchError) => setError(fetchError?.message || "Failed to load internal controls"))
  }, [canViewInternalSettings])

  async function saveProfile() {
    setSaving(true)
    setError("")
    setSavedMessage("")

    try {
      await authApi.updateMe({
        fullName: draft.fullName,
        phone: draft.phone.trim() ? draft.phone.trim() : null,
      })
      await refreshProfile()
      setSavedMessage("Changes saved.")
    } catch (err) {
      setError(err?.message || "Failed to update profile")
    } finally {
      setSaving(false)
    }
  }

  const activeMeta = settingsSections.find((section) => section.key === activeSection) || settingsSections[0]
  const assignedRoleNames = useMemo(() => roles.map((role) => role.name), [roles])
  const settingsMap = useMemo(
    () => Object.fromEntries((settingsData.items || []).map((item) => [item.settingKey, item])),
    [settingsData.items]
  )
  const settingsKpis = useMemo(() => [
    {
      label: "Roles",
      value: formatNumber(roles.length),
      helper: roles[0]?.name || profile.primaryRole || "active role set",
      drilldown: {
        title: "Assigned Roles",
        value: formatNumber(roles.length),
        rows: roles,
        columns: [
          { key: "name", label: "Role", render: (row) => row.name || row.code || "-" },
          { key: "code", label: "Code" },
          { key: "department", label: "Department" },
        ],
      },
    },
    {
      label: "Permissions",
      value: formatNumber(permissions.length),
      helper: "current account scope",
      drilldown: {
        title: "Permissions",
        value: formatNumber(permissions.length),
        rows: permissions.map((permission) => ({ permission })),
        columns: [{ key: "permission", label: "Permission" }],
      },
    },
    {
      label: "Modules",
      value: formatNumber(navigation.length),
      helper: "visible sidebar areas",
      drilldown: {
        title: "Visible Modules",
        value: formatNumber(navigation.length),
        rows: navigation.map((moduleKey) => ({ moduleKey })),
        columns: [{ key: "moduleKey", label: "Module" }],
      },
    },
    {
      label: "Controls",
      value: canViewInternalSettings ? formatNumber(settingsData.summary?.editableSettings || settingsData.items?.length || 0) : "No access",
      helper: canEditInternalSettings ? "editable governance settings" : "read-only or unavailable",
      tone: canEditInternalSettings ? "warning" : "neutral",
      drilldown: canViewInternalSettings ? {
        title: "Internal Controls",
        value: formatNumber(settingsData.summary?.editableSettings || settingsData.items?.length || 0),
        rows: settingsData.items || [],
        columns: [
          { key: "settingKey", label: "Setting" },
          { key: "settingValue", label: "Value" },
          { key: "updatedAt", label: "Updated", render: (row) => formatDateTime(row.updatedAt) },
        ],
      } : null,
    },
  ], [canEditInternalSettings, canViewInternalSettings, navigation, permissions, profile.primaryRole, roles, settingsData.items, settingsData.summary?.editableSettings])

  async function saveControl(settingKey) {
    setControlSavingKey(settingKey)
    setError("")
    setSavedMessage("")
    try {
      await internalApi.updateSetting(settingKey, controlDrafts[settingKey] ?? "")
      const payload = await internalApi.getSettings()
      setSettingsData(payload)
      setControlDrafts(Object.fromEntries((payload?.items || []).map((item) => [item.settingKey, String(item.settingValue ?? "")])))
      setSavedMessage("Controls updated.")
    } catch (saveError) {
      setError(saveError?.message || "Failed to update internal control")
    } finally {
      setControlSavingKey("")
    }
  }

  async function syncWorkspaceData() {
    setSyncing(true)
    setError("")
    setSavedMessage("")
    try {
      await refreshProfile()
      if (canViewInternalSettings) {
        const payload = await internalApi.getSettings()
        setSettingsData(payload)
        setControlDrafts(Object.fromEntries((payload?.items || []).map((item) => [item.settingKey, String(item.settingValue ?? "")])))
      }
      const syncedAt = new Date().toISOString()
      setLastSyncAt(syncedAt)
      setSavedMessage("Workspace data synced.")
    } catch (syncError) {
      setError(syncError?.message || "Failed to sync workspace data")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div
      className={embedded ? "settings-modal-page-host" : "internal-modal-backdrop"}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label="Settings"
      onClick={embedded ? undefined : onClose}
    >
      <div className={`settings-modal-shell ${embedded ? "settings-modal-shell--page" : ""}`} onClick={(event) => event.stopPropagation()}>
        {!embedded ? <aside className="settings-modal-sidebar">
          {!embedded ? (
            <button type="button" className="settings-modal-close" aria-label="Close settings" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          ) : null}

          <nav className="settings-modal-nav" role="tablist" aria-label="Settings sections">
            {settingsSections.map((section) => {
              const active = section.key === activeSection
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`settings-modal-nav-item ${active ? "active" : ""}`}
                  onClick={() => setActiveSection(section.key)}
                >
                  <span className="settings-modal-nav-icon"><SectionIcon name={section.icon} /></span>
                  <span>{section.label}</span>
                </button>
              )
            })}
          </nav>
        </aside> : null}

        <div className="settings-modal-content">
          <header className="settings-modal-header">
            <div>
              <h2>{activeMeta.label}</h2>
              <p>{activeMeta.description}</p>
              {error ? <p className="settings-modal-error">{error}</p> : null}
            </div>
            {savedMessage ? <span className="settings-modal-status">{savedMessage}</span> : null}
          </header>

          <div className="settings-modal-body">
            <section className="settings-command-summary">
              <header>
                <div>
                  <span>Command Settings</span>
                  <h3>{activeMeta.label} control centre</h3>
                  <p>Account scope, access posture, module visibility, and governance controls for this internal workspace.</p>
                </div>
              </header>
              <MetricGrid items={settingsKpis} />
            </section>

            {activeSection === "profile" ? (
              <>
                <div className="settings-modal-banner">
                  <div>
                    <strong>{user.fullName || "Internal User"}</strong>
                    <p>{user.email || "internal@smartlink"}</p>
                  </div>
                  <button type="button" className="secondary-action" disabled={saving} onClick={saveProfile}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>

                <SettingsRow
                  label="Full name"
                  description="Shown across the internal workspace, including the navbar and sidebar."
                  control={<input value={draft.fullName} onChange={(event) => setDraft((prev) => ({ ...prev, fullName: event.target.value }))} />}
                />

                <SettingsRow
                  label="Phone number"
                  description="Internal contact number for support escalation and coordination."
                  control={<input value={draft.phone} onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))} placeholder="+265..." />}
                />

                <SettingsRow
                  label="Email address"
                  description="Used for account identity and sign-in."
                  control={<div className="settings-modal-value">{user.email || "-"}</div>}
                />
              </>
            ) : null}

            {activeSection === "preferences" ? (
              <>
                <div className="settings-modal-row settings-modal-row--stacked">
                  <div className="settings-modal-row-copy">
                    <strong>Visible modules</strong>
                    <p>Sections currently available in your internal sidebar.</p>
                  </div>
                  <div className="settings-chip-row">
                    {navigation.length ? navigation.map((item) => <span key={item} className="settings-chip settings-chip--soft">{item}</span>) : <span className="settings-chip">No modules</span>}
                  </div>
                </div>

                <SettingsRow
                  label="Display density"
                  description="Internal follows the comfortable MERA density for this shell port."
                  control={<div className="settings-modal-value">Comfortable</div>}
                />
              </>
            ) : null}

            {activeSection === "notifications" ? (
              <>
                <SettingsRow
                  label="Approval requests"
                  description="Actionable approval, support escalation, and wallet operation requests appear in the notification drawer."
                  control={<div className="settings-modal-value">Enabled</div>}
                />
                <SettingsRow
                  label="Notification drawer"
                  description="Notifications open in the MERA-style right drawer with list and detail views."
                  control={<div className="settings-modal-value">Right drawer</div>}
                />
              </>
            ) : null}

            {activeSection === "security" ? (
              <>
                <div className="settings-modal-banner settings-modal-banner--plain">
                  <div>
                    <strong>Secure your internal access</strong>
                    <p>Password rotation is not exposed in this workspace yet. Sign out on shared devices and use backend admin flows for credential changes.</p>
                  </div>
                </div>

                <SettingsRow
                  label="Session public ID"
                  description="Identifier for your current internal session."
                  control={<div className="settings-modal-value">{profile.sessionPublicId || "-"}</div>}
                />

                <SettingsRow
                  label="Scope"
                  description="Where this account is currently authenticated."
                  control={<div className="settings-modal-value">Internal workspace</div>}
                />

                <SettingsRow
                  label="Current session"
                  description="End your current session on this device."
                  control={<button type="button" className="secondary-action" onClick={logout}>Log out</button>}
                />
              </>
            ) : null}

            {activeSection === "users" ? (
              <>
                <SettingsRow
                  label="Primary role"
                  description="Your default internal role in this workspace."
                  control={<div className="settings-modal-value">{roles[0]?.name || profile.primaryRole || "-"}</div>}
                />

                <div className="settings-modal-row settings-modal-row--stacked">
                  <div className="settings-modal-row-copy">
                    <strong>Assigned roles</strong>
                    <p>Roles attached to this internal account.</p>
                  </div>
                  <div className="settings-chip-row">
                    {assignedRoleNames.length ? assignedRoleNames.map((role) => <span key={role} className="settings-chip">{role}</span>) : <span className="settings-chip">No roles</span>}
                  </div>
                </div>

                <SettingsRow
                  label="Permissions"
                  description="Total internal permissions attached to your active role set."
                  control={<div className="settings-modal-value">{formatNumber(permissions.length)}</div>}
                />
              </>
            ) : null}

            {activeSection === "data" ? (
              <>
                <div className="settings-modal-banner settings-modal-banner--plain">
                  <div>
                    <strong>Manage data sync</strong>
                    <p>Refresh your internal profile, roles, permissions, visible modules, and available control settings without changing access rules.</p>
                  </div>
                  <button type="button" className="secondary-action" disabled={syncing} onClick={syncWorkspaceData}>
                    {syncing ? "Syncing..." : "Sync now"}
                  </button>
                </div>

                <SettingsRow
                  label="Profile and permissions"
                  description="Reloads your authenticated profile and active permission map."
                  control={<div className="settings-modal-value">{syncing ? "Refreshing" : "Ready"}</div>}
                />

                <SettingsRow
                  label="Control settings"
                  description="Refreshes governance controls when your role has settings access."
                  control={<div className="settings-modal-value">{canViewInternalSettings ? "Included" : "No access"}</div>}
                />

                <SettingsRow
                  label="Last manual sync"
                  description="Most recent sync triggered from this settings panel."
                  control={<div className="settings-modal-value">{lastSyncAt ? formatDateTime(lastSyncAt) : "Not synced yet"}</div>}
                />

                {canViewInternalSettings ? (
                  <>
                    <div className="settings-modal-banner settings-modal-banner--plain">
                      <div>
                        <strong>Internal system config</strong>
                        <p>Owner-facing controls for governance, security posture, and exceptional platform operations.</p>
                      </div>
                    </div>

                    {OWNER_CONTROL_SPECS.map((control) => {
                      const item = settingsMap[control.key]
                      return (
                        <SettingsRow
                          key={control.key}
                          label={control.label}
                          description={control.description}
                          control={
                            <div className="settings-modal-control-stack">
                              <input
                                value={controlDrafts[control.key] ?? ""}
                                onChange={(event) => setControlDrafts((prev) => ({ ...prev, [control.key]: event.target.value }))}
                                disabled={!canEditInternalSettings}
                              />
                              {canEditInternalSettings ? (
                                <button
                                  type="button"
                                  className="secondary-action"
                                  disabled={controlSavingKey === control.key}
                                  onClick={() => saveControl(control.key)}
                                >
                                  {controlSavingKey === control.key ? "Saving..." : "Update"}
                                </button>
                              ) : null}
                              <small className="settings-modal-inline-note">
                                {item?.updatedAt ? `Updated ${formatDateTime(item.updatedAt)}` : "Not yet updated"}
                              </small>
                            </div>
                          }
                        />
                      )
                    })}
                  </>
                ) : null}
              </>
            ) : null}

            {activeSection === "audit" ? (
              <>
                <SettingsRow
                  label="Session public ID"
                  description="Identifier for your current internal session."
                  control={<div className="settings-modal-value">{profile.sessionPublicId || "-"}</div>}
                />

                <SettingsRow
                  label="Last updated"
                  description="Most recent profile change timestamp."
                  control={<div className="settings-modal-value">{formatDateTime(user.updatedAt)}</div>}
                />
              </>
            ) : null}

            {activeSection === "organization" ? (
              <>
                <SettingsRow
                  label="Public ID"
                  description="Stable account identifier used internally."
                  control={<div className="settings-modal-value">{user.publicId || "-"}</div>}
                />

                <SettingsRow
                  label="Role count"
                  description="Number of active internal roles on this account."
                  control={<div className="settings-modal-value">{formatNumber(roles.length)}</div>}
                />
              </>
            ) : null}

            {activeSection === "integrations" ? (
              <>
                <SettingsRow
                  label="Integration posture"
                  description="Internal integrations continue to use existing SmartLink backend services."
                  control={<div className="settings-modal-value">Operational</div>}
                />
                <SettingsRow
                  label="Editable internal settings"
                  description="Total internal governance settings available to this workspace."
                  control={<div className="settings-modal-value">{canViewInternalSettings ? formatNumber(settingsData.summary?.editableSettings) : "No access"}</div>}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

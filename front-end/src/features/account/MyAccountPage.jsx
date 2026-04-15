import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import Navbar from "../../components/Navbar"
import { useAuth } from "../../auth/AuthContext"
import { accountApi } from "../../api/accountApi"
import { formatDateTime as formatDateTimeUtc } from "../../utils/dateTime"
import { applyThemePreference } from "../../utils/theme"
import "./account.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const sections = [
  { key: "profile", label: "Profile", helper: "Identity, role and station links" },
  { key: "security", label: "Security", helper: "Password and auth controls" },
  { key: "sessions", label: "Sessions & Devices", helper: "Current and remote sessions" },
  { key: "preferences", label: "Preferences", helper: "Theme and defaults" },
  { key: "privacy", label: "Data & Privacy", helper: "Exports and deletion requests" },
  { key: "support", label: "Help / Support", helper: "Version and support contacts" },
]

function formatDateTime(value) {
  return formatDateTimeUtc(value, undefined, "N/A")
}

function getPasswordStrength(password) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  if (score <= 2) return { score, label: "Weak" }
  if (score <= 4) return { score, label: "Moderate" }
  return { score, label: "Strong" }
}

function Feedback({ error, message }) {
  return (
    <>
      {error ? <p className="account-v3-feedback account-v3-feedback-error">{error}</p> : null}
      {message ? <p className="account-v3-feedback account-v3-feedback-ok">{message}</p> : null}
    </>
  )
}

export default function MyAccountPage() {
  const { session, logout } = useAuth()
  const location = useLocation()
  const [activeSection, setActiveSection] = useState("profile")

  const [profile, setProfile] = useState(null)
  const [profileDraft, setProfileDraft] = useState("")
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState("")
  const [profileMessage, setProfileMessage] = useState("")

  const [securityForm, setSecurityForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [securitySaving, setSecuritySaving] = useState(false)
  const [securityError, setSecurityError] = useState("")
  const [securityMessage, setSecurityMessage] = useState("")

  const [sessionsState, setSessionsState] = useState({ currentSession: null, otherSessions: [] })
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsBusy, setSessionsBusy] = useState(false)
  const [sessionsError, setSessionsError] = useState("")
  const [sessionsMessage, setSessionsMessage] = useState("")

  const [preferences, setPreferences] = useState(null)
  const [preferencesDraft, setPreferencesDraft] = useState(null)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [preferencesError, setPreferencesError] = useState("")
  const [preferencesMessage, setPreferencesMessage] = useState("")

  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyReason, setPrivacyReason] = useState("")
  const [privacyError, setPrivacyError] = useState("")
  const [privacyMessage, setPrivacyMessage] = useState("")

  async function loadProfile() {
    try {
      setProfileLoading(true)
      setProfileError("")
      const data = await accountApi.getMe()
      setProfile(data)
      setProfileDraft(data?.user?.fullName || "")
    } catch (error) {
      setProfileError(error?.message || "Failed to load profile")
    } finally {
      setProfileLoading(false)
    }
  }

  async function loadSessions() {
    try {
      setSessionsLoading(true)
      setSessionsError("")
      const data = await accountApi.listSessions()
      setSessionsState({
        currentSession: data?.currentSession || null,
        otherSessions: data?.otherSessions || [],
      })
    } catch (error) {
      setSessionsError(error?.message || "Failed to load sessions")
    } finally {
      setSessionsLoading(false)
    }
  }

  async function loadPreferences() {
    try {
      setPreferencesLoading(true)
      setPreferencesError("")
      const data = await accountApi.getPreferences()
      setPreferences(data)
      setPreferencesDraft(data)
    } catch (error) {
      setPreferencesError(error?.message || "Failed to load preferences")
    } finally {
      setPreferencesLoading(false)
    }
  }

  async function refreshAll() {
    await Promise.all([loadProfile(), loadSessions(), loadPreferences()])
  }

  useEffect(() => {
    refreshAll()
  }, [])

  const activeMeta = useMemo(
    () => sections.find((section) => section.key === activeSection) || sections[0],
    [activeSection]
  )

  const displayName = profile?.user?.fullName || session?.user?.fullName || "Account User"
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0].toUpperCase())
    .join("")

  const profileDirty = useMemo(() => {
    const base = profile?.user?.fullName || ""
    return profileDraft.trim() !== base.trim()
  }, [profile, profileDraft])

  const profileNameInvalid = profileDraft.trim().length < 2

  async function handleSaveProfile() {
    if (!profileDirty || profileNameInvalid) return
    try {
      setProfileSaving(true)
      setProfileError("")
      setProfileMessage("")
      await accountApi.updateProfile({ fullName: profileDraft.trim() })
      await loadProfile()
      setProfileMessage("Profile updated")
    } catch (error) {
      setProfileError(error?.message || "Failed to update profile")
    } finally {
      setProfileSaving(false)
    }
  }

  const passwordMismatch =
    securityForm.newPassword.length > 0 && securityForm.confirmPassword.length > 0
      ? securityForm.newPassword !== securityForm.confirmPassword
      : false
  const passwordStrength = getPasswordStrength(securityForm.newPassword)
  const passwordChecks = useMemo(
    () => ({
      length: securityForm.newPassword.length >= 8,
      uppercase: /[A-Z]/.test(securityForm.newPassword),
      lowercase: /[a-z]/.test(securityForm.newPassword),
      number: /[0-9]/.test(securityForm.newPassword),
    }),
    [securityForm.newPassword]
  )
  const passwordPolicyValid = Object.values(passwordChecks).every(Boolean)

  async function handleChangePassword() {
    setSecurityError("")
    setSecurityMessage("")

    if (securityForm.currentPassword.length < 5) {
      setSecurityError("Enter your current password.")
      return
    }
    if (!passwordPolicyValid) {
      setSecurityError("New password must be at least 8 characters and include uppercase, lowercase, and a number.")
      return
    }
    if (passwordMismatch) {
      setSecurityError("New password and confirmation do not match.")
      return
    }
    if (securityForm.currentPassword === securityForm.newPassword) {
      setSecurityError("New password must be different from your current password.")
      return
    }

    try {
      setSecuritySaving(true)
      await accountApi.changePassword({
        currentPassword: securityForm.currentPassword,
        newPassword: securityForm.newPassword,
      })
      setSecurityForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
      setSecurityMessage("Password changed. Other active sessions were signed out.")
      await loadSessions()
    } catch (error) {
      setSecurityError(error?.message || "Failed to change password")
    } finally {
      setSecuritySaving(false)
    }
  }

  async function handleSignOutCurrentDevice() {
    if (!window.confirm("Sign out this device now?")) return
    try {
      setSessionsBusy(true)
      await accountApi.logout()
      await logout({ skipRemote: true })
    } catch (error) {
      setSessionsError(error?.message || "Failed to sign out this device")
    } finally {
      setSessionsBusy(false)
    }
  }

  async function handleSignOutOthersOnly() {
    if (!window.confirm("Sign out all other active devices?")) return
    try {
      setSessionsBusy(true)
      setSessionsError("")
      setSessionsMessage("")
      const data = await accountApi.logoutOthers()
      setSessionsMessage(`Signed out ${Number(data?.revokedCount || 0)} other session(s).`)
      await loadSessions()
    } catch (error) {
      setSessionsError(error?.message || "Failed to sign out other devices")
    } finally {
      setSessionsBusy(false)
    }
  }

  async function handleSignOutAllDevices() {
    if (!window.confirm("Sign out all active devices, including this one?")) return
    try {
      setSessionsBusy(true)
      setSessionsError("")
      setSessionsMessage("")
      await accountApi.logoutOthers()
      await logout()
    } catch (error) {
      setSessionsError(error?.message || "Failed to sign out all devices")
    } finally {
      setSessionsBusy(false)
    }
  }

  const preferencesDirty = useMemo(() => {
    if (!preferences || !preferencesDraft) return false
    return JSON.stringify(preferences) !== JSON.stringify(preferencesDraft)
  }, [preferences, preferencesDraft])

  async function handleSavePreferences() {
    if (!preferencesDirty || !preferencesDraft) return
    try {
      setPreferencesSaving(true)
      setPreferencesError("")
      setPreferencesMessage("")
      const updated = await accountApi.updatePreferences({
        theme: preferencesDraft.theme,
        defaultReportRange: preferencesDraft.defaultReportRange,
        defaultFuelType: preferencesDraft.defaultFuelType,
        notifyInApp: Boolean(preferencesDraft.notifyInApp),
        notifyEmail: Boolean(preferencesDraft.notifyEmail),
      })
      setPreferences(updated)
      setPreferencesDraft(updated)
      applyThemePreference(updated?.theme || "SYSTEM")
      setPreferencesMessage("Preferences saved")
    } catch (error) {
      setPreferencesError(error?.message || "Failed to save preferences")
    } finally {
      setPreferencesSaving(false)
    }
  }

  async function handleExportData() {
    try {
      setPrivacyBusy(true)
      setPrivacyError("")
      setPrivacyMessage("")
      const data = await accountApi.exportMyData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "smartlink_my_data.json"
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setPrivacyMessage("Your data export is ready.")
    } catch (error) {
      setPrivacyError(error?.message || "Failed to export data")
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function handleDeleteRequest() {
    if (!window.confirm("Submit account deletion request to support?")) return
    try {
      setPrivacyBusy(true)
      setPrivacyError("")
      setPrivacyMessage("")
      const response = await accountApi.requestDelete({
        reason: privacyReason.trim() || undefined,
      })
      setPrivacyMessage(response?.message || "Deletion request submitted.")
      setPrivacyReason("")
    } catch (error) {
      setPrivacyError(error?.message || "Failed to submit deletion request")
    } finally {
      setPrivacyBusy(false)
    }
  }

  const appVersion = import.meta.env.VITE_APP_VERSION || import.meta.env.MODE || "dev"
  const sessionCount = Number(sessionsState.otherSessions.length) + (sessionsState.currentSession ? 1 : 0)
  const recentActivity = sessionsState.currentSession?.lastActiveAt || profile?.user?.updatedAt

  function renderSectionBody() {
    if (activeSection === "profile") {
      return (
        <>
          <Feedback error={profileError} message={profileMessage} />
          {profileLoading ? <p className="account-v3-loading">Loading profile...</p> : null}
          {!profileLoading && profile ? (
            <>
              <div className="account-v3-form-grid">
                <label>
                  Full Name
                  <input
                    value={profileDraft}
                    onChange={(event) => setProfileDraft(event.target.value)}
                    aria-invalid={profileNameInvalid ? "true" : "false"}
                  />
                  {profileNameInvalid ? <small className="account-v3-inline-error">Enter at least 2 characters.</small> : null}
                </label>
                <label>
                  Email
                  <input value={profile.user?.email || "N/A"} disabled />
                </label>
                <label>
                  Phone
                  <input value={profile.user?.phone || "N/A"} disabled />
                </label>
                <label>
                  Role
                  <input value={profile.role || session?.role || "N/A"} disabled />
                </label>
              </div>
              <div className="account-v3-footer-row">
                <span>Last updated: {formatDateTime(profile.user?.updatedAt)}</span>
                <button
                  className="account-v3-btn-primary"
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={profileSaving || !profileDirty || profileNameInvalid}
                >
                  {profileSaving ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </>
          ) : null}
        </>
      )
    }

    if (activeSection === "security") {
      return (
        <>
          <Feedback error={securityError} message={securityMessage} />
          <div className="account-v3-security-layout">
            <section className="account-v3-block account-v3-security-main">
              <h4>Change Password</h4>
              <p>Confirm your current password before updating credentials.</p>
              <div className="account-v3-security-form">
                <label>
                  Current Password
                  <input
                    type="password"
                    value={securityForm.currentPassword}
                    onChange={(event) => setSecurityForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                  />
                </label>
                <div className="account-v3-security-row">
                  <label>
                    New Password
                    <input
                      type="password"
                      value={securityForm.newPassword}
                      onChange={(event) => setSecurityForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                    />
                  </label>
                  <label>
                    Confirm New Password
                    <input
                      type="password"
                      value={securityForm.confirmPassword}
                      onChange={(event) => setSecurityForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                      aria-invalid={passwordMismatch ? "true" : "false"}
                    />
                    {passwordMismatch ? <small className="account-v3-inline-error">Passwords do not match.</small> : null}
                  </label>
                </div>
                <div className="account-v3-strength">
                  <span>Password strength: {passwordStrength.label}</span>
                  <div className="account-v3-strength-track">
                    <em style={{ width: `${Math.max(passwordStrength.score, 1) * 20}%` }} />
                  </div>
                </div>
                <ul className="account-v3-password-rules">
                  <li className={passwordChecks.length ? "ok" : ""}>At least 8 characters</li>
                  <li className={passwordChecks.uppercase ? "ok" : ""}>One uppercase letter</li>
                  <li className={passwordChecks.lowercase ? "ok" : ""}>One lowercase letter</li>
                  <li className={passwordChecks.number ? "ok" : ""}>One number</li>
                </ul>
              </div>
              <div className="account-v3-security-actions">
                <button className="account-v3-btn-primary" type="button" onClick={handleChangePassword} disabled={securitySaving}>
                  {securitySaving ? "Updating..." : "Change Password"}
                </button>
              </div>
            </section>

            <section className="account-v3-block account-v3-security-side">
              <h4>MFA / 2FA</h4>
              <p>Authenticator app setup and recovery code management are scheduled for a future release.</p>
              <div className="account-v3-status-chip">Coming soon</div>
              <p className="account-v3-security-note">Recovery codes and authenticator onboarding will appear here.</p>
            </section>
          </div>
        </>
      )
    }

    if (activeSection === "sessions") {
      return (
        <>
          <Feedback error={sessionsError} message={sessionsMessage} />
          {sessionsLoading ? <p className="account-v3-loading">Loading sessions...</p> : null}
          {!sessionsLoading ? (
            <>
              <div className="account-v3-split">
                <section className="account-v3-block">
                  <h4>Current Session</h4>
                  {sessionsState.currentSession ? (
                    <dl className="account-v3-metric-list">
                      <div><dt>Device</dt><dd>{sessionsState.currentSession.userAgent}</dd></div>
                      <div><dt>IP</dt><dd>{sessionsState.currentSession.ipAddress}</dd></div>
                      <div><dt>Last Active</dt><dd>{formatDateTime(sessionsState.currentSession.lastActiveAt)}</dd></div>
                      <div><dt>Signed In</dt><dd>{formatDateTime(sessionsState.currentSession.createdAt)}</dd></div>
                    </dl>
                  ) : (
                    <p className="account-v3-empty">Current session metadata unavailable.</p>
                  )}
                </section>

                <section className="account-v3-block">
                  <h4>Other Active Sessions</h4>
                  {sessionsState.otherSessions.length ? (
                    <div className="account-v3-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Device</th>
                            <th>IP</th>
                            <th>Last Active</th>
                            <th>Signed In</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessionsState.otherSessions.map((sessionRow) => (
                            <tr key={sessionRow.sessionPublicId}>
                              <td>{sessionRow.userAgent}</td>
                              <td>{sessionRow.ipAddress}</td>
                              <td>{formatDateTime(sessionRow.lastActiveAt)}</td>
                              <td>{formatDateTime(sessionRow.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="account-v3-empty">No other active sessions.</p>
                  )}
                </section>
              </div>

              <div className="account-v3-footer-row">
                <button className="account-v3-btn-secondary" type="button" onClick={handleSignOutCurrentDevice} disabled={sessionsBusy}>
                  Sign out this device
                </button>
                <button className="account-v3-btn-secondary" type="button" onClick={handleSignOutOthersOnly} disabled={sessionsBusy}>
                  Sign out other devices
                </button>
                <button className="account-v3-btn-danger" type="button" onClick={handleSignOutAllDevices} disabled={sessionsBusy}>
                  Sign out all devices
                </button>
              </div>
            </>
          ) : null}
        </>
      )
    }

    if (activeSection === "preferences") {
      return (
        <>
          <Feedback error={preferencesError} message={preferencesMessage} />
          {preferencesLoading ? <p className="account-v3-loading">Loading preferences...</p> : null}
          {!preferencesLoading && preferencesDraft ? (
            <>
              <div className="account-v3-form-grid">
                <label>
                  Theme
                  <select
                    value={preferencesDraft.theme}
                    onChange={(event) => setPreferencesDraft((prev) => ({ ...prev, theme: event.target.value }))}
                  >
                    <option value="SYSTEM">System</option>
                    <option value="LIGHT">Light</option>
                    <option value="DARK">Dark</option>
                  </select>
                </label>
                <label>
                  Default Report Date Range
                  <select
                    value={preferencesDraft.defaultReportRange}
                    onChange={(event) => setPreferencesDraft((prev) => ({ ...prev, defaultReportRange: event.target.value }))}
                  >
                    <option value="TODAY">Today</option>
                    <option value="LAST_7_DAYS">Last 7 days</option>
                    <option value="LAST_30_DAYS">Last 30 days</option>
                  </select>
                </label>
                <label>
                  Default Fuel Filter
                  <select
                    value={preferencesDraft.defaultFuelType}
                    onChange={(event) => setPreferencesDraft((prev) => ({ ...prev, defaultFuelType: event.target.value }))}
                  >
                    <option value="ALL">All</option>
                    <option value="PETROL">Petrol</option>
                    <option value="DIESEL">Diesel</option>
                  </select>
                </label>
              </div>

              <div className="account-v3-toggle-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(preferencesDraft.notifyInApp)}
                    onChange={(event) => setPreferencesDraft((prev) => ({ ...prev, notifyInApp: event.target.checked }))}
                  />
                  <span>In-app alerts</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(preferencesDraft.notifyEmail)}
                    onChange={(event) => setPreferencesDraft((prev) => ({ ...prev, notifyEmail: event.target.checked }))}
                  />
                  <span>Email notifications</span>
                </label>
              </div>

              <div className="account-v3-footer-row">
                <span>Last updated: {formatDateTime(preferences?.updatedAt)}</span>
                <button className="account-v3-btn-primary" type="button" onClick={handleSavePreferences} disabled={preferencesSaving || !preferencesDirty}>
                  {preferencesSaving ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </>
          ) : null}
        </>
      )
    }

    if (activeSection === "privacy") {
      return (
        <>
          <Feedback error={privacyError} message={privacyMessage} />
          <div className="account-v3-split">
            <section className="account-v3-block">
              <h4>Download My Data</h4>
              <p>Export your account information as a JSON file.</p>
              <button className="account-v3-btn-primary" type="button" onClick={handleExportData} disabled={privacyBusy}>
                {privacyBusy ? "Preparing export..." : "Download JSON Export"}
              </button>
            </section>

            <section className="account-v3-block account-v3-danger-zone">
              <h4>Request Account Deletion</h4>
              <p>Submit a request to support. A manual review will follow.</p>
              <label>
                Reason (optional)
                <input
                  value={privacyReason}
                  onChange={(event) => setPrivacyReason(event.target.value)}
                  placeholder="Optional context for support"
                />
              </label>
              <button className="account-v3-btn-danger" type="button" onClick={handleDeleteRequest} disabled={privacyBusy}>
                Submit Deletion Request
              </button>
            </section>
          </div>
        </>
      )
    }

    return (
      <div className="account-v3-split">
        <section className="account-v3-block">
          <h4>App Version</h4>
          <p>Current build loaded in your browser.</p>
          <div className="account-v3-status-chip">{appVersion}</div>
        </section>
        <section className="account-v3-block">
          <h4>Support</h4>
          <p>Need help with account or access issues?</p>
          <a className="account-v3-btn-secondary account-v3-inline-link" href="mailto:support@smartlink.local">
            Contact support
          </a>
        </section>
      </div>
    )
  }

  return (
    <div className="account-page account-page-v3">
      <Navbar pagetitle="My Account" image={avatar} count={0} />
      <section className="account-shell account-shell-v3">
        <header className="account-v3-ribbon">
          <div className="account-v3-ribbon-copy">
            <h2>Account Studio</h2>
            <p>Control profile, access, and privacy from a single operator workspace.</p>
          </div>
          <div className="account-v3-ribbon-actions">
            <button className="account-v3-btn-secondary" type="button" onClick={refreshAll}>
              Refresh Data
            </button>
            <Link className="account-v3-btn-primary account-v3-inline-link" to="/settings" state={{ backgroundLocation: location }}>
              Station Settings
            </Link>
          </div>
        </header>

        <div className="account-v3-kpi-strip">
          <article>
            <span>Role</span>
            <strong>{profile?.role || session?.role || "N/A"}</strong>
          </article>
          <article>
            <span>Station</span>
            <strong>{profile?.station?.name || session?.station?.name || "N/A"}</strong>
          </article>
          <article>
            <span>Active Sessions</span>
            <strong>{sessionsLoading ? "..." : sessionCount}</strong>
          </article>
          <article>
            <span>Theme</span>
            <strong>{preferences?.theme || "SYSTEM"}</strong>
          </article>
        </div>

        <div className="account-v3-workgrid">
          <section className="account-v3-main">
            <nav className="account-v3-nav-tabs" aria-label="Account Sections">
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={activeSection === section.key ? "active" : ""}
                  onClick={() => setActiveSection(section.key)}
                  aria-current={activeSection === section.key ? "page" : undefined}
                >
                  <span>{section.label}</span>
                  <small>{section.helper}</small>
                </button>
              ))}
            </nav>

            <article className="account-v3-stage">
              <header className="account-v3-stage-head">
                <div>
                  <h3>{activeMeta.label}</h3>
                  <p>{activeMeta.helper}</p>
                </div>
                <span className="account-v3-stage-meta">Last activity: {formatDateTime(recentActivity)}</span>
              </header>
              {renderSectionBody()}
            </article>
          </section>

          <aside className="account-v3-side">
            <article className="account-v3-profile-card">
              <div className="account-v3-identity">
                <div className="account-v3-avatar">{initials || "U"}</div>
                <div>
                  <h3>{displayName}</h3>
                  <p>{profile?.user?.email || session?.user?.email || "No email"}</p>
                </div>
              </div>
              <span className="account-v3-role-badge">{profile?.role || session?.role || "N/A"}</span>
              <dl className="account-v3-info-grid">
                <div><dt>Phone</dt><dd>{profile?.user?.phone || "N/A"}</dd></div>
                <div><dt>Station</dt><dd>{profile?.station?.name || session?.station?.name || "N/A"}</dd></div>
                <div><dt>Last Activity</dt><dd>{formatDateTime(recentActivity)}</dd></div>
              </dl>
            </article>

            <article className="account-v3-mini-card">
              <h4>Quick Context</h4>
              <ul>
                <li>
                  <span>Current Section</span>
                  <strong>{activeMeta.label}</strong>
                </li>
                <li>
                  <span>App Version</span>
                  <strong>{appVersion}</strong>
                </li>
                <li>
                  <span>Support</span>
                  <a className="account-v3-inline-link" href="mailto:support@smartlink.local">
                    support@smartlink.local
                  </a>
                </li>
              </ul>
            </article>
          </aside>
        </div>
      </section>
    </div>
  )
}

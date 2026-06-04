import { useMemo, useState } from "react"
import { Bell, ChevronDown, LogOut, RefreshCcw, Settings, SunMedium } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"
import { useInternalApprovalRequests } from "../notifications/InternalApprovalRequestsContext"
import { applyInternalLightTheme } from "../utils/internalTheme"
import InternalNotificationDrawer from "./InternalNotificationDrawer"
import InternalGlobalSearch from "./InternalGlobalSearch"

function initialsFor(name) {
  return String(name || "Internal User")
    .split(/[.@_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export default function InternalPageHeader({ title = "Overview", alerts = [], onSync, syncLoading = false }) {
  const navigate = useNavigate()
  const { session, logout, refreshProfile } = useInternalAuth()
  const { notificationItems, refreshRequests, refreshSupportEscalations } = useInternalApprovalRequests()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const profile = session?.profile || {}
  const user = profile.user || {}
  const name = user.fullName || user.email || "Internal User"
  const role = profile.roles?.[0]?.name || profile.primaryRole || "Internal role"
  const allowed = useMemo(() => new Set(profile.navigation || []), [profile.navigation])
  const notifications = useMemo(
    () => [
      ...(Array.isArray(alerts) ? alerts : []),
      ...(Array.isArray(notificationItems) ? notificationItems : []),
    ],
    [alerts, notificationItems],
  )

  async function syncCurrentPage() {
    if (typeof onSync === "function") {
      await onSync()
      return
    }
    await Promise.allSettled([
      refreshProfile(),
      typeof refreshRequests === "function" ? refreshRequests() : null,
      typeof refreshSupportEscalations === "function" ? refreshSupportEscalations() : null,
    ])
  }

  return (
    <header className="internal-page-header">
      <InternalNotificationDrawer open={notificationsOpen} onOpenChange={setNotificationsOpen} items={notifications} />
      <div className="internal-page-header__brand">
        <img src="/smartlink-mark-tight.png" alt="SmartLink" />
        <div>
          <strong>SmartLink Internal</strong>
          <span>{title}</span>
        </div>
      </div>

      <InternalGlobalSearch />

      <div className="internal-page-header__actions">
        <button type="button" className="internal-icon-button internal-sync-button" onClick={syncCurrentPage} aria-label="Sync this page">
          <RefreshCcw className={syncLoading ? "is-spinning" : ""} aria-hidden="true" />
          <span>Sync</span>
        </button>
        <button type="button" className="internal-icon-button internal-theme-button" onClick={applyInternalLightTheme} aria-label="Use MERA light theme">
          <SunMedium aria-hidden="true" />
          <span>Light</span>
        </button>
        <button type="button" className="internal-icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
          <Bell aria-hidden="true" />
          {notifications.length ? <span className="internal-header-badge">{notifications.length > 9 ? "9+" : notifications.length}</span> : null}
        </button>
        {allowed.has("settings") ? (
          <button type="button" className="internal-icon-button" aria-label="Settings" onClick={() => navigate("/settings")}>
            <Settings aria-hidden="true" />
          </button>
        ) : null}
        <div className="internal-user-menu">
          <button type="button" className="internal-user-button" onClick={() => setUserMenuOpen((value) => !value)} aria-expanded={userMenuOpen}>
            <span className="internal-user-avatar">{initialsFor(name) || "SL"}</span>
            <span className="internal-user-copy">
              <strong>{name}</strong>
              <small>{role}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </button>
          {userMenuOpen ? (
            <div className="internal-user-popover">
              <div>
                <strong>{user.email || "internal@smartlink"}</strong>
                <small>{role}</small>
              </div>
              {allowed.has("settings") ? (
                <button type="button" onClick={() => { setUserMenuOpen(false); navigate("/settings") }}>
                  <Settings aria-hidden="true" />
                  Settings
                </button>
              ) : null}
              <button type="button" className="is-danger" onClick={() => { setUserMenuOpen(false); logout() }}>
                <LogOut aria-hidden="true" />
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

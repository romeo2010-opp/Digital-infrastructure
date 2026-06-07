import { useMemo } from "react"
import {
  AlertTriangle,
  BarChart3,
  ArrowLeft,
  ClipboardCheck,
  Database,
  Gauge,
  Globe2,
  HeartPulse,
  LayoutDashboard,
  Lock,
  MapPinned,
  MessageSquare,
  Palette,
  PlugZap,
  RadioTower,
  ScrollText,
  Settings,
  UserCircle2,
  Users,
  WalletCards,
  Bell,
} from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { navigationItems } from "../config/navigation"
import { useInternalAuth } from "../auth/AuthContext"

const settingsItems = [
  { label: "Profile", path: "/settings/profile", icon: UserCircle2 },
  { label: "Preferences", path: "/settings/preferences", icon: Palette },
  { label: "Notifications", path: "/settings/notifications", icon: Bell },
  { label: "Security", path: "/settings/security", icon: Lock },
  { label: "Users & Roles", path: "/settings/users", icon: Users },
  { label: "Audit", path: "/settings/audit", icon: ScrollText },
  { label: "Organization", path: "/settings/organization", icon: Globe2 },
  { label: "Integrations", path: "/settings/integrations", icon: PlugZap },
  { label: "Data Controls", path: "/settings/data", icon: Database },
]

const navIcons = {
  overview: LayoutDashboard,
  chat: MessageSquare,
  network: RadioTower,
  stations: MapPinned,
  onboarding: ClipboardCheck,
  field: ClipboardCheck,
  support: MessageSquare,
  finance: WalletCards,
  risk: AlertTriangle,
  analytics: BarChart3,
  audit: ScrollText,
  staff: Users,
  health: HeartPulse,
}

function initialsFor(name) {
  return String(name || "Internal Staff")
    .split(/[.@_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function isActivePath(pathname, path) {
  if (path === "/") return pathname === "/"
  return pathname.startsWith(path)
}

export default function InternalMeraSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useInternalAuth()
  const profile = session?.profile || {}
  const allowed = useMemo(() => new Set(profile.navigation || []), [profile.navigation])
  const settingsMode = location.pathname.startsWith("/settings")
  const visibleItems = useMemo(() => navigationItems.filter((item) => allowed.has(item.key)), [allowed])
  const groupedItems = useMemo(() => {
    const sections = ["Command Center", "Operations", "Oversight", "Intelligence", "Governance"]
    return sections
      .map((section) => ({ section, items: visibleItems.filter((item) => item.section === section) }))
      .filter((group) => group.items.length)
  }, [visibleItems])
  const fullName = profile.user?.fullName || profile.user?.email || "Internal Staff"
  const roleName = profile.roles?.[0]?.name || profile.primaryRole || "Internal role"
  const sidebarWidth = "var(--sidebar-width)"
  const sidebarStyle = {
    flex: `0 0 ${sidebarWidth}`,
    width: sidebarWidth,
    minWidth: sidebarWidth,
    maxWidth: sidebarWidth,
  }

  return (
    <aside className="internal-mera-sidebar" style={sidebarStyle}>
        <nav className="internal-mera-sidebar__nav" aria-label={settingsMode ? "Internal settings navigation" : "Internal navigation"}>
          {settingsMode ? (
            <div className="internal-settings-nav-mode">
              <button
                type="button"
                className="internal-mera-nav-item internal-mera-nav-item--back"
                onClick={() => navigate("/")}
                title="Back to internal"
                aria-label="Back to internal"
              >
                <ArrowLeft aria-hidden="true" />
                <span>Back</span>
              </button>
              <div className="internal-settings-nav-heading">
                <span>Settings</span>
              </div>
              <section className="internal-mera-sidebar__section">
                <div className="internal-mera-sidebar__items">
                  {settingsItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.path}
                        type="button"
                        className={`internal-mera-nav-item ${isActivePath(location.pathname, item.path) ? "is-active" : ""}`}
                        onClick={() => navigate(item.path)}
                        title={item.label}
                        aria-label={item.label}
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          ) : (
          <>
          {visibleItems.some((item) => item.key === "overview") ? (
            <button
              type="button"
              className={`internal-mera-nav-item ${isActivePath(location.pathname, "/") ? "is-active" : ""}`}
              onClick={() => navigate("/")}
              title="Overview"
              aria-label="Overview"
            >
              <Gauge aria-hidden="true" />
              <span>Overview</span>
            </button>
          ) : null}

          {groupedItems.map((group) => {
            return (
              <section key={group.section} className="internal-mera-sidebar__section">
                <div className="internal-mera-sidebar__section-title">
                  <span>{group.section}</span>
                </div>
                <div className="internal-mera-sidebar__items">
                  {group.items.filter((item) => item.key !== "overview").map((item) => {
                    const Icon = navIcons[item.icon] || LayoutDashboard
                    const active = isActivePath(location.pathname, item.path)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`internal-mera-nav-item ${active ? "is-active" : ""}`}
                        onClick={() => navigate(item.path)}
                        title={item.label}
                        aria-label={item.label}
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
          </>
          )}
        </nav>

        <div className="internal-mera-sidebar__footer">
          {!settingsMode && allowed.has("settings") ? (
            <button type="button" className={`internal-mera-nav-item ${isActivePath(location.pathname, "/settings") ? "is-active" : ""}`} onClick={() => navigate("/settings")}>
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </button>
          ) : null}
          <button type="button" className="internal-mera-user" onClick={() => navigate(allowed.has("settings") ? "/settings" : location.pathname)} title={fullName}>
            <span className="internal-mera-user__avatar">{initialsFor(fullName) || "SL"}</span>
            <span className="internal-mera-user__copy">
              <strong>{fullName}</strong>
              <small>{roleName}</small>
            </span>
            <UserCircle2 aria-hidden="true" />
          </button>
        </div>
      </aside>
  )
}

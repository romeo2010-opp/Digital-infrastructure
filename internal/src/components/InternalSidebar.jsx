import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { navigationItems } from "../config/navigation"
import { useInternalAuth } from "../auth/AuthContext"
import { useAppShell } from "../layout/AppShellContext"
import InternalSettingsModal from "./InternalSettingsModal"

const orderedSections = ["Command Center", "Operations", "Oversight", "Intelligence", "Governance"]

function NavIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }

  switch (name) {
    case "overview":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case "network":
      return <svg {...common}><path d="M4 19h16" /><path d="M7 17V9" /><path d="M12 17V5" /><path d="M17 17v-6" /></svg>
    case "chat":
      return <svg {...common}><path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /><path d="M8 11h8M8 14h5" /></svg>
    case "stations":
      return <svg {...common}><path d="M4 20V7l8-3 8 3v13" /><path d="M9 20v-5h6v5" /><path d="M8 9h.01M12 9h.01M16 9h.01" /></svg>
    case "onboarding":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5M8 17h8" /></svg>
    case "field":
      return <svg {...common}><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10Z" /><circle cx="12" cy="11" r="2.5" /></svg>
    case "support":
      return <svg {...common}><path d="M7 18h10a2 2 0 0 0 2-2V6H5v10a2 2 0 0 0 2 2Z" /><path d="M9 10h6M9 13h4" /></svg>
    case "finance":
      return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
    case "risk":
      return <svg {...common}><path d="M12 3 4 7v5c0 5 3 7.9 8 9 5-1.1 8-4 8-9V7l-8-4Z" /><path d="M12 8v5M12 16h.01" /></svg>
    case "analytics":
      return <svg {...common}><path d="M4 19h16" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-3" /></svg>
    case "audit":
      return <svg {...common}><path d="M6 4h9l3 3v13H6z" /><path d="M15 4v4h4" /><path d="M9 12h6M9 16h6" /></svg>
    case "staff":
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>
    case "health":
      return <svg {...common}><path d="M4 12h3l2-5 4 10 2-5h5" /></svg>
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.03 4.3l.06.06A1.65 1.65 0 0 0 9 4.6c.39 0 .77-.14 1-.6a1.65 1.65 0 0 1 2 0c.23.46.61.6 1 .6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .39.14.77.6 1a1.65 1.65 0 0 1 0 2c-.46.23-.6.61-.6 1Z" /></svg>
    case "collapseLeft":
      return <svg {...common}><path d="M15 18 9 12l6-6" /><path d="M4 4v16" /></svg>
    case "collapseRight":
      return <svg {...common}><path d="m9 18 6-6-6-6" /><path d="M20 4v16" /></svg>
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>
  }
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

function SidebarButton({ icon, label, active = false, collapsed = false, onClick }) {
  return (
    <button
      type="button"
      className={`sidebar__item ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className="icon">{icon}</span>
      <span className={collapsed ? "sidebar__label sidebar__label--hidden" : "sidebar__label"}>{label}</span>
    </button>
  )
}

export default function InternalSidebar() {
  const { session } = useInternalAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { isMobile, isSidebarOpen, isSidebarCollapsed, toggleNavigation, closeSidebar } = useAppShell()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const collapsed = isSidebarCollapsed && !isMobile

  useEffect(() => {
    if (isMobile && isSidebarOpen) closeSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const allowed = useMemo(() => new Set(session?.profile?.navigation || []), [session?.profile?.navigation])
  const items = useMemo(() => navigationItems.filter((item) => allowed.has(item.key)), [allowed])
  const groupedItems = useMemo(
    () =>
      orderedSections
        .map((section) => ({
          section,
          items: items.filter((item) => item.section === section),
        }))
        .filter((group) => group.items.length),
    [items]
  )
  const fullName = session?.profile?.user?.fullName || "Internal Staff"
  const roleName = session?.profile?.roles?.[0]?.name || session?.profile?.primaryRole || "Internal role"
  const userInitials = initialsFor(fullName)

  function openPath(path) {
    navigate(path)
  }

  return (
    <>
      {isMobile && isSidebarOpen ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={closeSidebar} />
      ) : null}
      <aside className={`sidebar ${isMobile ? "sidebar--mobile" : ""} ${isMobile && isSidebarOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
        <nav className="sidebar__content" aria-label="Internal navigation">
          {groupedItems.map((group) => (
            <section key={group.section} className="sidebar__section">
              <div className="sidebar__title">
                <span>{group.section}</span>
              </div>
              <div className="sidebar__section-items">
                {group.items.map((item) => (
                  <SidebarButton
                    key={item.key}
                    label={item.label}
                    icon={<NavIcon name={item.icon} />}
                    active={isActivePath(location.pathname, item.path)}
                    collapsed={collapsed}
                    onClick={() => openPath(item.path)}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="sidebar__footer">
          <SidebarButton
            label={collapsed ? "Expand" : "Collapse"}
            icon={<NavIcon name={collapsed ? "collapseRight" : "collapseLeft"} />}
            collapsed={collapsed}
            onClick={toggleNavigation}
          />
          {allowed.has("settings") ? (
            <SidebarButton
              label="Settings"
              icon={<NavIcon name="settings" />}
              collapsed={collapsed}
              active={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            />
          ) : null}
          <button type="button" className="sidebar__user sidebar__user-button" onClick={() => setSettingsOpen(true)} title={fullName}>
            <span className="avatar">{userInitials || "SL"}</span>
            <span className={collapsed ? "sidebar__user-copy sidebar__label--hidden" : "sidebar__user-copy"}>
              <strong>{fullName}</strong>
              <small>{roleName}</small>
            </span>
          </button>
        </div>
      </aside>

      {settingsOpen ? <InternalSettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </>
  )
}

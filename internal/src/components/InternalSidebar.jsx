import React from "react"
import { Link, useLocation } from "react-router-dom"
import { navigationItems } from "../config/navigation"
import { useInternalAuth } from "../auth/AuthContext"
import { useAppShell } from "../layout/AppShellContext"
import InternalSettingsModal from "./InternalSettingsModal"

function SmartLinkLogoMark() {
  return (
    <svg width="55" height="40" viewBox="0 0 64 48" aria-hidden="true">
      <defs>
        <linearGradient id="internalLogoBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f8fd9" />
          <stop offset="100%" stopColor="#234b76" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="18" fill="#ffffff" stroke="#d7e3f2" />
      <path d="M15 24c0-6 4.8-10.8 10.8-10.8 2.6 0 5 .9 6.8 2.4l-4.5 4.4c-.7-.5-1.5-.8-2.4-.8-2.6 0-4.8 2.1-4.8 4.8H15Z" fill="url(#internalLogoBlue)" />
      <path d="M33 24c0 6-4.8 10.8-10.8 10.8-2.6 0-5-.9-6.8-2.4l4.5-4.4c.7.5 1.5.8 2.4.8 2.6 0 4.8-2.1 4.8-4.8H33Z" fill="#1d314d" />
    </svg>
  )
}

function NavIcon({ name }) {
  const common = {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }

  switch (name) {
    case "overview":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case "network":
      return <svg {...common}><path d="M4 18h16" /><path d="M7 18V6" /><path d="M12 18V10" /><path d="M17 18V4" /><path d="m5 7 4-2 4 3 6-2" /></svg>
    case "chat":
      return <svg {...common}><path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /><path d="M8 11h8M8 14h5" /></svg>
    case "stations":
      return <svg {...common}><path d="M4 20V7l8-3 8 3v13" /><path d="M9 20v-5h6v5" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01" /></svg>
    case "onboarding":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M8 9h8M8 13h5M8 17h8" /></svg>
    case "field":
      return <svg {...common}><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10Z" /><circle cx="12" cy="11" r="2.5" /></svg>
    case "support":
      return <svg {...common}><path d="M7 18h10a2 2 0 0 0 2-2V6H5v10a2 2 0 0 0 2 2Z" /><path d="M9 10h6M9 13h4" /><path d="M8 6V4h8v2" /></svg>
    case "finance":
      return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
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
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>
  }
}

function SidebarItem({ icon, label, to, action, onAction }) {
  const location = useLocation()
  const isActive = location.pathname === to

  if (!to) {
    return (
      <button
        type="button"
        onClick={() => onAction?.(action)}
        className={`sidebar__item ${isActive ? "active" : ""}`}
        title={label}
        style={{ border: "none", background: "transparent", width: "100%", textAlign: "left", cursor: "pointer" }}
      >
        <span className="icon">{icon}</span>
        <span>{label}</span>
      </button>
    )
  }

  return (
    <Link
      to={to}
      title={label}
      style={{ textDecoration: "none", color: "inherit" }}
      className={`sidebar__item ${isActive ? "active" : ""}`}
    >
      <span className="icon">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

export default function InternalSidebar() {
  const { logout, session } = useInternalAuth()
  const { isMobile, isSidebarOpen, isSidebarCollapsed, desktopSidebarWidth, setDesktopSidebarWidth, closeSidebar } =
    useAppShell()
  const sidebarRef = React.useRef(null)
  const isResizing = React.useRef(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const location = useLocation()

  React.useEffect(() => {
    if (isMobile && isSidebarOpen) closeSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  React.useEffect(() => {
    const handleMouseMove = (event) => {
      if (isMobile || isSidebarCollapsed) return
      if (!isResizing.current) return
      const nextWidth = event.clientX
      if (nextWidth > 200 && nextWidth < 500) setDesktopSidebarWidth(nextWidth)
    }

    const handleMouseUp = () => {
      isResizing.current = false
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isMobile, isSidebarCollapsed, setDesktopSidebarWidth])

  const allowed = new Set(session?.profile?.navigation || [])
  const items = navigationItems.filter((item) => item.key !== "settings" && allowed.has(item.key))
  const groupedItems = items.reduce((accumulator, item) => {
    const section = item.section || "Main Menu"
    if (!accumulator[section]) accumulator[section] = []
    accumulator[section].push(item)
    return accumulator
  }, {})
  const orderedSections = ["Command Center", "Operations", "Oversight", "Intelligence", "Governance"]
  const shouldGroupItems = items.length > 5
  const fullName = session?.profile?.user?.fullName || "Internal Staff"
  const email = session?.profile?.user?.email || "internal@smartlink"
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0].toUpperCase())
    .join("")

  const resolvedWidth = isMobile ? 280 : isSidebarCollapsed ? 88 : desktopSidebarWidth

  return (
    <>
      {isMobile && isSidebarOpen ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={closeSidebar} />
      ) : null}
      <aside
        ref={sidebarRef}
        className={`sidebar ${isMobile && isSidebarOpen ? "open" : ""} ${isSidebarCollapsed && !isMobile ? "collapsed" : ""}`}
        style={{ width: resolvedWidth }}
      >
        <div className="sidebar__brand">
          <SmartLinkLogoMark />
          <div className="sidebar__brand-copy">
            <h1>SmartLink</h1>
            <p>Fuel Infrastructure</p>
          </div>
        </div>

        <div className="sidebar__content">
          {shouldGroupItems ? (
            orderedSections
              .filter((section) => Array.isArray(groupedItems[section]) && groupedItems[section].length)
              .map((section) => (
                <nav key={section} className="sidebar__section">
                  <p className="sidebar__title">{section}</p>
                  {groupedItems[section].map((item) => (
                    <SidebarItem key={item.key} label={item.label} to={item.path} icon={<NavIcon name={item.icon} />} />
                  ))}
                </nav>
              ))
          ) : (
            <nav className="sidebar__section sidebar__section--flat">
              {items.map((item) => (
                <SidebarItem key={item.key} label={item.label} to={item.path} icon={<NavIcon name={item.icon} />} />
              ))}
            </nav>
          )}

          <nav className="sidebar__section sidebar__section--bottom">
            <SidebarItem
              label="Log Out"
              action="logout"
              icon={<NavIcon name="settings" />}
              onAction={(nextAction) => {
                if (nextAction === "logout") logout()
              }}
            />
          </nav>
        </div>

        <button type="button" className="sidebar__user sidebar__user-button" onClick={() => setSettingsOpen(true)}>
          <div className="avatar">{initials || "SL"}</div>
          <div className="sidebar__user-copy">
            <strong>{fullName}</strong>
            <small>{email}</small>
          </div>
        </button>

        <div className="sidebar__resizer" onMouseDown={() => (isResizing.current = true)} />
      </aside>

      {settingsOpen ? <InternalSettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </>
  )
}

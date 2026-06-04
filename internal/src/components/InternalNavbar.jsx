import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"
import { useAppShell } from "../layout/AppShellContext"
import { useInternalApprovalRequests } from "../notifications/InternalApprovalRequestsContext"
import { navigationItems } from "../config/navigation"
import InternalSettingsModal from "./InternalSettingsModal"

function HeaderIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }

  if (name === "menu") {
    return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
  }

  if (name === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  }

  if (name === "bell") {
    return <svg {...common}><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" /><path d="M9.5 17a2.5 2.5 0 0 0 5 0" /></svg>
  }

  if (name === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.03 4.3l.06.06A1.65 1.65 0 0 0 9 4.6c.39 0 .77-.14 1-.6a1.65 1.65 0 0 1 2 0c.23.46.61.6 1 .6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .39.14.77.6 1a1.65 1.65 0 0 1 0 2c-.46.23-.6.61-.6 1Z" /></svg>
  }

  if (name === "chevron") {
    return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>
  }

  return null
}

function initialsFor(name) {
  return String(name || "Internal User")
    .split(/[.@_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export default function InternalNavbar({ pagetitle = "Overview", alerts = null }) {
  const navigate = useNavigate()
  const { session, logout } = useInternalAuth()
  const { toggleNavigation } = useAppShell()
  const { notificationItems } = useInternalApprovalRequests()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const alertsRef = useRef(null)
  const userMenuRef = useRef(null)
  const searchRef = useRef(null)
  const resolvedUserName = session?.profile?.user?.fullName || "Internal User"
  const resolvedRoleName = session?.profile?.roles?.[0]?.name || session?.profile?.primaryRole || "Internal role"
  const userInitials = initialsFor(resolvedUserName)

  const normalizedAlerts = useMemo(
    () =>
      [
        ...(Array.isArray(alerts) ? alerts : []),
        ...(Array.isArray(notificationItems) ? notificationItems : []),
      ]
        .filter(Boolean)
        .map((item, index) => ({
          id: item.id || `alert-${index}`,
          type: String(item.type || "INFO").toUpperCase(),
          title: item.title || "System Message",
          body: item.body || item.message || "",
          meta: item.meta || "",
          isActionable: Boolean(item.isActionable),
          onOpen: typeof item.onOpen === "function" ? item.onOpen : null,
        })),
    [alerts, notificationItems]
  )

  const allowed = useMemo(() => new Set(session?.profile?.navigation || []), [session?.profile?.navigation])
  const searchableItems = useMemo(() => navigationItems.filter((item) => allowed.has(item.key)), [allowed])
  const searchResults = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    const source = needle
      ? searchableItems.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(needle))
      : searchableItems.slice(0, 5)
    return source.slice(0, 7)
  }, [searchTerm, searchableItems])

  useEffect(() => {
    function onPointerDown(event) {
      if (alertsRef.current && !alertsRef.current.contains(event.target)) setShowAlerts(false)
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) setShowUserMenu(false)
      if (searchRef.current && !searchRef.current.contains(event.target)) setSearchFocused(false)
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowAlerts(false)
        setShowUserMenu(false)
        setSearchFocused(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  function openSearchResult(item) {
    if (!item) return
    setSearchTerm("")
    setSearchFocused(false)
    navigate(item.path)
  }

  function submitSearch(event) {
    event.preventDefault()
    openSearchResult(searchResults[0])
  }

  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="topbar-start">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={toggleNavigation}>
            <HeaderIcon name="menu" />
          </button>
          <div className="topbar-brand">
            <img src="/smartlink-mark-tight.png" alt="SmartLink" />
            <div className="topbar-brand-copy">
              <strong>SmartLink Internal</strong>
              <span>{pagetitle}</span>
            </div>
          </div>
        </div>

        <form className="topbar-search" ref={searchRef} onSubmit={submitSearch}>
          <HeaderIcon name="search" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            placeholder="Search internal workspace"
            aria-label="Search internal workspace"
          />
          {searchFocused ? (
            <div className="topbar-search-popover">
              {searchResults.length ? (
                searchResults.map((item) => (
                  <button key={item.key} type="button" onClick={() => openSearchResult(item)}>
                    <strong>{item.label}</strong>
                    <span>{item.section}</span>
                  </button>
                ))
              ) : (
                <p>No matching internal views.</p>
              )}
            </div>
          ) : null}
        </form>

        <div className="topbar-end">
          <div className="topbar-messages" ref={alertsRef}>
            <button
              type="button"
              className={`icon-btn has-badge ${showAlerts ? "active" : ""}`}
              aria-label="Notifications"
              aria-expanded={showAlerts}
              onClick={() => setShowAlerts((prev) => !prev)}
            >
              <HeaderIcon name="bell" />
              {normalizedAlerts.length ? <span className="badge">{normalizedAlerts.length > 9 ? "9+" : normalizedAlerts.length}</span> : null}
            </button>

            {showAlerts ? (
              <div className="topbar-messages-popover" role="dialog" aria-label="System messages">
                <header>
                  <strong>System Messages</strong>
                  <small>{normalizedAlerts.length} item{normalizedAlerts.length === 1 ? "" : "s"}</small>
                </header>
                <div className="topbar-messages-list">
                  {normalizedAlerts.length ? (
                    normalizedAlerts.map((item) => (
                      <article
                        key={item.id}
                        className={`topbar-message-item topbar-message-${item.type.toLowerCase()} ${item.isActionable ? "topbar-message-item-actionable" : ""}`}
                      >
                        <h4>{item.title}</h4>
                        <p>{item.body || "-"}</p>
                        {item.meta ? <small>{item.meta}</small> : null}
                        {item.isActionable && item.onOpen ? (
                          <button
                            type="button"
                            className="topbar-message-open"
                            onClick={() => {
                              setShowAlerts(false)
                              item.onOpen()
                            }}
                          >
                            Open request
                          </button>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <p className="topbar-messages-empty">No current errors or admin messages.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {allowed.has("settings") ? (
            <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
              <HeaderIcon name="settings" />
            </button>
          ) : null}

          <div className="topbar-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`topbar-user ${showUserMenu ? "open" : ""}`}
              aria-label="Account menu"
              aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu((prev) => !prev)}
            >
              <span className="topbar-user-avatar">{userInitials || "SL"}</span>
              <span className="topbar-user-copy">
                <strong>{resolvedUserName}</strong>
                <small>{resolvedRoleName}</small>
              </span>
              <HeaderIcon name="chevron" />
            </button>

            {showUserMenu ? (
              <div className="topbar-user-popover" role="menu" aria-label="Account options">
                <div className="topbar-user-popover-section">
                  <strong>{session?.profile?.user?.email || "internal@smartlink"}</strong>
                  <small>{resolvedRoleName}</small>
                </div>
                {allowed.has("settings") ? (
                  <button
                    type="button"
                    className="topbar-user-action"
                    onClick={() => {
                      setShowUserMenu(false)
                      setSettingsOpen(true)
                    }}
                  >
                    Settings
                  </button>
                ) : null}
                <button
                  type="button"
                  className="topbar-user-action topbar-user-action-danger"
                  onClick={() => {
                    setShowUserMenu(false)
                    logout()
                  }}
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {settingsOpen ? <InternalSettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </header>
  )
}

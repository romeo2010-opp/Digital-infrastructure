import { useEffect, useMemo, useRef, useState } from "react"
import '../assets/navbar.css'
import { useAuth } from '../auth/AuthContext'
import { useAppShell } from "../layout/AppShellContext"
import { getOfflineState, subscribeOfflineState } from "../offline/network"
import {
  clearSystemAlerts,
  getSystemAlerts,
  pushSystemAlerts,
  subscribeSystemAlerts,
} from "../utils/systemAlerts"

function alertIdentityKey(item) {
  return [
    String(item?.type || "").toUpperCase(),
    String(item?.title || "").trim(),
    String(item?.body || "").trim(),
    String(item?.source || "").trim().toUpperCase(),
  ].join("|")
}

function Navbar({
  pagetitle = 'Dashboard',
  image,
  userName,
  onMenuClick,
  count,
  alerts = null,
}) {
  const { session, logout, openStationPicker } = useAuth()
  const { toggleNavigation } = useAppShell()
  const resolvedUserName = userName || session?.user?.fullName || 'User'
  const [showAlerts, setShowAlerts] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const alertsRef = useRef(null)
  const userMenuRef = useRef(null)
  const [globalAlerts, setGlobalAlerts] = useState(() => getSystemAlerts())
  const [offlineState, setOfflineState] = useState(getOfflineState())
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState(() => new Set())

  const normalizedAlerts = useMemo(
    () =>
      (Array.isArray(alerts) ? alerts : [])
        .filter(Boolean)
        .map((item, index) => {
          if (typeof item === "string") {
            return {
              id: `alert-${index}`,
              type: "INFO",
              title: "Message",
              body: item,
              meta: "",
            }
          }
          const upperType = String(item.type || "INFO").toUpperCase()
          return {
            id: item.id || `alert-${index}`,
            type: upperType,
            title: item.title || (upperType === "ERROR" ? "System Error" : "Administrator Message"),
            body: item.body || item.message || "",
            meta: item.meta || item.timestamp || "",
          }
        }),
    [alerts]
  )

  useEffect(() => {
    return subscribeSystemAlerts((next) => setGlobalAlerts(Array.isArray(next) ? next : []))
  }, [])

  const visibleNormalizedAlerts = useMemo(
    () => normalizedAlerts.filter((item) => !dismissedAlertKeys.has(alertIdentityKey(item))),
    [dismissedAlertKeys, normalizedAlerts]
  )

  const visibleGlobalAlerts = useMemo(
    () =>
      (Array.isArray(globalAlerts) ? globalAlerts : [])
        .filter((item) => !dismissedAlertKeys.has(alertIdentityKey(item))),
    [dismissedAlertKeys, globalAlerts]
  )

  useEffect(() => {
    if (!visibleNormalizedAlerts.length) return
    pushSystemAlerts(visibleNormalizedAlerts, { source: pagetitle || "SYSTEM", incrementOnRepeat: false })
  }, [visibleNormalizedAlerts, pagetitle])

  const mergedAlerts = useMemo(() => {
    const rows = [...visibleNormalizedAlerts, ...visibleGlobalAlerts]
    const seen = new Set()
    const merged = []
    for (const item of rows) {
      const key = `${item.type}|${item.title}|${item.body}|${item.source || ""}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
    return merged
  }, [visibleNormalizedAlerts, visibleGlobalAlerts])

  const fallbackCount = Number.isFinite(Number(count)) ? Number(count) : 0
  const hasExplicitAlerts = Array.isArray(alerts)
  const badgeCount = hasExplicitAlerts ? mergedAlerts.length : (mergedAlerts.length > 0 ? mergedAlerts.length : fallbackCount)

  useEffect(() => {
    function onPointerDown(event) {
      if (!alertsRef.current) return
      if (!alertsRef.current.contains(event.target)) {
        setShowAlerts(false)
      }
      if (!userMenuRef.current) return
      if (!userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false)
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowAlerts(false)
        setShowUserMenu(false)
      }
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  useEffect(() => subscribeOfflineState(setOfflineState), [])

  function handleClearAllMessages() {
    setDismissedAlertKeys((prev) => {
      const next = new Set(prev)
      mergedAlerts.forEach((item) => next.add(alertIdentityKey(item)))
      return next
    })
    clearSystemAlerts()
  }

  return (
    <nav className="topbar">
      <div className="topbar-main">
        <div className="topbar-start">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            onClick={onMenuClick || toggleNavigation}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="topbar-title">{pagetitle}</h1>
        </div>

        <div className="topbar-end">
          <div className="topbar-connectivity" role="status" aria-live="polite">
            <span
              className={`topbar-connectivity-state ${
                offlineState.sync === "SYNCING"
                  ? "syncing"
                  : offlineState.network === "ONLINE"
                    ? "online"
                    : "offline"
              }`}
            >
              {offlineState.sync === "SYNCING" ? "SYNCING" : offlineState.network}
            </span>
            <span className="topbar-connectivity-pending">Pending {offlineState.pendingCount}</span>
          </div>

          <button type="button" className="icon-btn" aria-label="Notifications">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
              <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
            </svg>
          </button>

          <div className="topbar-messages" ref={alertsRef}>
            <button
              type="button"
              className={`icon-btn has-badge ${showAlerts ? "active" : ""}`}
              aria-label="Messages"
              aria-expanded={showAlerts}
              onClick={() => setShowAlerts((prev) => !prev)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16v12H4z" />
                <path d="m4 8 8 6 8-6" />
              </svg>
              <span className="badge">{badgeCount}</span>
            </button>

            {showAlerts ? (
              <div className="topbar-messages-popover" role="dialog" aria-label="System messages">
                <header>
                  <strong>System Messages</strong>
                  <small>{mergedAlerts.length} item{mergedAlerts.length === 1 ? "" : "s"}</small>
                </header>
                {mergedAlerts.length ? (
                  <div className="topbar-messages-tools">
                    <button
                      type="button"
                      className="topbar-messages-clear"
                      onClick={handleClearAllMessages}
                    >
                      Clear All
                    </button>
                  </div>
                ) : null}
                <div className="topbar-messages-list">
                  {mergedAlerts.length ? (
                    mergedAlerts.map((item) => (
                      <article key={item.id} className={`topbar-message-item topbar-message-${item.type.toLowerCase()}`}>
                        <h4>{item.title}</h4>
                        <p>{item.body || "-"}</p>
                        {item.meta || item.occurrences > 1 ? (
                          <small>
                            {[item.meta || "", item.occurrences > 1 ? `x${item.occurrences}` : ""].filter(Boolean).join(" · ")}
                          </small>
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

          <button type="button" className="icon-btn" aria-label="Help">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.4 9.2a2.7 2.7 0 1 1 4.2 2.3c-.9.6-1.4 1.1-1.4 2.1" />
              <circle cx="12" cy="16.9" r=".6" />
            </svg>
          </button>

          <div className="topbar-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`topbar-user ${showUserMenu ? "open" : ""}`}
              aria-label="Account menu"
              aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu((prev) => !prev)}
            >
              <img src={image} alt={resolvedUserName} />
              <span>{resolvedUserName}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m5 7 5 5 5-5" />
              </svg>
            </button>

            {showUserMenu ? (
              <div className="topbar-user-popover" role="menu" aria-label="Account options">
                <div className="topbar-user-popover-section">
                  <strong>{session?.station?.name || "No active station"}</strong>
                  <small>{session?.role || "VIEWER"}</small>
                </div>

                <button
                  type="button"
                  className="topbar-user-action"
                  onClick={() => {
                    setShowUserMenu(false)
                    openStationPicker()
                  }}
                >
                  Switch station
                </button>

                <button
                  type="button"
                  className="topbar-user-action"
                  onClick={() => {
                    setShowUserMenu(false)
                    logout()
                  }}
                >
                  Switch account
                </button>

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
    </nav>
  )
}

export default Navbar

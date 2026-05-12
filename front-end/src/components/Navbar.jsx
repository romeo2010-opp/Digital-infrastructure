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
import { readBusinessMood, subscribeBusinessMood } from "../utils/businessMood"

function alertIdentityKey(item) {
  return [
    String(item?.type || "").toUpperCase(),
    String(item?.title || "").trim(),
    String(item?.body || "").trim(),
    String(item?.source || "").trim().toUpperCase(),
  ].join("|")
}

function useTimedDisclosure(open, durationMs = 180) {
  const [shouldRender, setShouldRender] = useState(open)
  const [phase, setPhase] = useState(open ? "is-open" : "is-closed")

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setPhase("is-opening")
      const timerId = window.setTimeout(() => setPhase("is-open"), 16)
      return () => window.clearTimeout(timerId)
    }

    if (!shouldRender) {
      setPhase("is-closed")
      return undefined
    }

    setPhase("is-closing")
    const timerId = window.setTimeout(() => {
      setShouldRender(false)
      setPhase("is-closed")
    }, durationMs)
    return () => window.clearTimeout(timerId)
  }, [durationMs, open, shouldRender])

  return { shouldRender, phase }
}

function Navbar({
  pagetitle = 'Dashboard',
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
  const stationPublicId = session?.station?.publicId || "default"
  const [businessMood, setBusinessMood] = useState(() => readBusinessMood(stationPublicId))
  const userInitials = resolvedUserName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "SU"
  const stationMembershipCount = Array.isArray(session?.stationMemberships) ? session.stationMemberships.length : 0
  const canSwitchStation = stationMembershipCount > 1
  const stationName = session?.station?.name || "No active station"
  const stationPublicIdLabel = session?.station?.publicId || "No station ID"
  const roleLabel = session?.role || "VIEWER"
  const alertsDisclosure = useTimedDisclosure(showAlerts)
  const userMenuDisclosure = useTimedDisclosure(showUserMenu)

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

  useEffect(() => subscribeBusinessMood(stationPublicId, setBusinessMood), [stationPublicId])

  function handleClearAllMessages() {
    setDismissedAlertKeys((prev) => {
      const next = new Set(prev)
      mergedAlerts.forEach((item) => next.add(alertIdentityKey(item)))
      return next
    })
    clearSystemAlerts()
  }

  const connectivityLabel = offlineState.network === "OFFLINE"
    ? "Offline"
    : offlineState.sync === "SYNCING"
      ? "Syncing"
      : "Online"

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
        </div>

        <div className="topbar-end">
          <button type="button" className="topbar-text-btn">Start guide</button>
          <button
            type="button"
            className="topbar-mode-toggle"
            aria-label="Toggle test mode"
          >
            <span>Test Mode</span>
            <span className="topbar-switch" aria-hidden="true">
              <span className="topbar-switch-thumb" />
            </span>
          </button>
          <button type="button" className="topbar-text-btn">Docs</button>

          <span className={`topbar-status-pill ${businessMood ? "has-mood" : ""}`} title={businessMood ? `Today's mood: ${businessMood.label}` : connectivityLabel}>
            {businessMood ? (
              <>
                <picture className="topbar-status-gif">
                  <source srcSet={businessMood.webpSrc} type="image/webp" />
                  <img src={businessMood.gifSrc} alt={businessMood.emoji} width="22" height="22" />
                </picture>
                <span>Today: {businessMood.label}</span>
              </>
            ) : (
              <>
                <span className={`topbar-status-dot ${offlineState.network === "OFFLINE" ? "is-offline" : "is-online"}`} aria-hidden="true" />
                <span>{connectivityLabel}</span>
              </>
            )}
          </span>

          <div className="topbar-messages" ref={alertsRef}>
            <button
              type="button"
              className={`icon-btn has-badge topbar-utility-btn ${showAlerts ? "active" : ""}`}
              aria-label="Notifications"
              aria-expanded={showAlerts}
              onClick={() => {
                setShowUserMenu(false)
                setShowAlerts((prev) => !prev)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16v12H4z" />
                <path d="m4 8 8 6 8-6" />
              </svg>
              <span className="badge">{badgeCount}</span>
            </button>

            {alertsDisclosure.shouldRender ? (
              <div className={`topbar-messages-popover ${alertsDisclosure.phase}`} role="dialog" aria-label="System messages">
                <header className="topbar-popover-header">
                  <div>
                    <strong>System alerts</strong>
                    <small>{mergedAlerts.length ? `${mergedAlerts.length} active message${mergedAlerts.length === 1 ? "" : "s"}` : "No active messages"}</small>
                  </div>
                  <span className="topbar-popover-count">{badgeCount}</span>
                </header>
                {mergedAlerts.length ? (
                  <div className="topbar-messages-tools">
                    <button
                      type="button"
                      className="topbar-messages-clear"
                      onClick={handleClearAllMessages}
                    >
                      Clear all
                    </button>
                  </div>
                ) : null}
                <div className="topbar-messages-list">
                  {mergedAlerts.length ? (
                    mergedAlerts.map((item) => (
                      <article key={item.id} className={`topbar-message-item topbar-message-${item.type.toLowerCase()}`}>
                        <div className="topbar-message-title-row">
                          <span className="topbar-message-severity-dot" aria-hidden="true" />
                          <h4>{item.title}</h4>
                        </div>
                        <p>{item.body || "-"}</p>
                        <small>
                          {[item.source || pagetitle || "SYSTEM", item.meta || "", item.occurrences > 1 ? `x${item.occurrences}` : ""].filter(Boolean).join(" · ")}
                        </small>
                      </article>
                    ))
                  ) : (
                    <p className="topbar-messages-empty">No current errors or admin messages.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <button type="button" className="icon-btn topbar-utility-btn" aria-label="Theme">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
            </svg>
          </button>
          <div className="topbar-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`topbar-user ${showUserMenu ? "open" : ""}`}
              aria-label="Account menu"
              aria-expanded={showUserMenu}
              onClick={() => {
                setShowAlerts(false)
                setShowUserMenu((prev) => !prev)
              }}
            >
              <span className="topbar-user-avatar" aria-hidden="true">{userInitials}</span>
            </button>

            {userMenuDisclosure.shouldRender ? (
              <div className={`topbar-user-popover ${userMenuDisclosure.phase}`} role="menu" aria-label="Account options">
                <div className="topbar-user-popover-section">
                  <span className="topbar-user-popover-avatar" aria-hidden="true">{userInitials}</span>
                  <div className="topbar-user-popover-copy">
                    <strong>{resolvedUserName}</strong>
                    <small>{stationName}</small>
                    <span className="topbar-user-station-id">{stationPublicIdLabel}</span>
                  </div>
                  <span className="topbar-user-role-chip">{roleLabel}</span>
                </div>

                <button
                  type="button"
                  className="topbar-user-action"
                  disabled={!canSwitchStation}
                  onClick={() => {
                    if (!canSwitchStation) return
                    setShowUserMenu(false)
                    openStationPicker("manual")
                  }}
                >
                  <span>Switch station</span>
                  <small>{canSwitchStation ? `${stationMembershipCount} linked stations` : "Only one station linked"}</small>
                </button>

                <button
                  type="button"
                  className="topbar-user-action"
                  onClick={() => {
                    setShowUserMenu(false)
                    logout()
                  }}
                >
                  <span>Switch account</span>
                  <small>Return to login</small>
                </button>

                <button
                  type="button"
                  className="topbar-user-action topbar-user-action-danger"
                  onClick={() => {
                    setShowUserMenu(false)
                    logout()
                  }}
                >
                  <span>Log out</span>
                  <small>End this session</small>
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

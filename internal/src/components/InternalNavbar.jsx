import { useEffect, useMemo, useRef, useState } from "react";
import { useInternalAuth } from "../auth/AuthContext";
import { useAppShell } from "../layout/AppShellContext";
import { useInternalApprovalRequests } from "../notifications/InternalApprovalRequestsContext";

function buildAvatarDataUrl() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E";
}

export default function InternalNavbar({
  pagetitle = "Overview",
  alerts = null,
}) {
  const { session, logout } = useInternalAuth();
  const { toggleNavigation } = useAppShell();
  const { notificationItems } = useInternalApprovalRequests();
  const [showAlerts, setShowAlerts] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const alertsRef = useRef(null);
  const userMenuRef = useRef(null);
  const resolvedUserName = session?.profile?.user?.fullName || "Internal User";
  const resolvedRoleName =
    session?.profile?.roles?.[0]?.name ||
    session?.profile?.primaryRole ||
    "Internal role";
  const avatar = buildAvatarDataUrl();
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
    [alerts, notificationItems],
  );

  useEffect(() => {
    function onPointerDown(event) {
      if (alertsRef.current && !alertsRef.current.contains(event.target))
        setShowAlerts(false);
      if (userMenuRef.current && !userMenuRef.current.contains(event.target))
        setShowUserMenu(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowAlerts(false);
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <nav className="topbar">
      <div className="topbar-main">
        <div className="topbar-start">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            onClick={toggleNavigation}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="topbar-title-block">
            <h1 className="topbar-title">{pagetitle}</h1>
          </div>
        </div>

        <div className="topbar-end">
          <div className="topbar-connectivity" role="status" aria-live="polite">
            <span className="topbar-connectivity-dot" aria-hidden="true" />
            <div className="topbar-connectivity-copy">
              <span className="topbar-connectivity-state online">
                Internal Network Live
              </span>
              <span className="topbar-connectivity-pending">
                {resolvedRoleName}
              </span>
            </div>
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
              <span className="badge">{normalizedAlerts.length}</span>
            </button>

            {showAlerts ? (
              <div
                className="topbar-messages-popover"
                role="dialog"
                aria-label="System messages"
              >
                <header>
                  <strong>System Messages</strong>
                  <small>
                    {normalizedAlerts.length} item
                    {normalizedAlerts.length === 1 ? "" : "s"}
                  </small>
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
                              setShowAlerts(false);
                              item.onOpen();
                            }}
                          >
                            Open request
                          </button>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <p className="topbar-messages-empty">
                      No current errors or admin messages.
                    </p>
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
              <img src={avatar} alt={resolvedUserName} />
              <span>{resolvedUserName}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m5 7 5 5 5-5" />
              </svg>
            </button>

            {showUserMenu ? (
              <div
                className="topbar-user-popover"
                role="menu"
                aria-label="Account options"
              >
                <div className="topbar-user-popover-section">
                  <strong>
                    {session?.profile?.user?.email || "internal@smartlink"}
                  </strong>
                  <small>{resolvedRoleName}</small>
                </div>

                <button
                  type="button"
                  className="topbar-user-action topbar-user-action-danger"
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
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
  );
}

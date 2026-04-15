import InternalNavbar from "./InternalNavbar"
import InternalSidebar from "./InternalSidebar"
import { useAppShell } from "../layout/AppShellContext"

export default function InternalShell({
  title,
  alerts = null,
  children,
  hideNavbar = false,
  hideSidebar = false,
  fullBleed = false,
  contentClassName = "",
}) {
  const { isMobile, isSidebarOpen } = useAppShell()
  const mainOverflowY = fullBleed ? "hidden" : "auto"
  return (
    <div className={`internal-shell ${hideSidebar ? "internal-shell--no-sidebar" : ""}`}>
      {!hideSidebar ? <InternalSidebar /> : null}
      <main
        className={`app-main app-main--auth ${isMobile && isSidebarOpen ? "app-main--nav-open" : ""} ${fullBleed ? "app-main--fullbleed" : ""}`}
        style={{ flex: 1, overflowY: mainOverflowY, overflowX: "hidden", scrollbarGutter: "stable both-edges", gridColumn: "auto" }}
      >
        {hideNavbar ? (
          <div className={`internal-page-standalone ${fullBleed ? "internal-page-standalone--fullbleed" : ""}`}>{children}</div>
        ) : (
          <div className="dashboard internal-dashboard">
            <InternalNavbar pagetitle={title} alerts={alerts} />
            <div className={`dashboard-replica internal-page-inner ${contentClassName}`.trim()}>{children}</div>
          </div>
        )}
      </main>
    </div>
  )
}

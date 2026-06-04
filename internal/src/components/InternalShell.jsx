import InternalPageHeader from "./InternalPageHeader"
import InternalMeraSidebar from "./InternalMeraSidebar"
import InternalDashboardViewStrip from "./InternalDashboardViewStrip"
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

  if (hideNavbar) {
    return (
      <div className={`internal-shell ${hideSidebar ? "internal-shell--no-sidebar" : ""} ${fullBleed ? "internal-shell--fullbleed" : ""}`}>
        <div className="internal-shell__body">
          {!hideSidebar ? <InternalMeraSidebar /> : null}
          <main
            className={`app-main app-main--auth ${isMobile && isSidebarOpen ? "app-main--nav-open" : ""} ${fullBleed ? "app-main--fullbleed" : ""}`}
            style={{ flex: 1, overflowY: mainOverflowY, overflowX: "hidden", scrollbarGutter: "stable both-edges" }}
          >
            <div className={`internal-page-standalone ${fullBleed ? "internal-page-standalone--fullbleed" : ""}`}>{children}</div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className={`internal-shell ${hideSidebar ? "internal-shell--no-sidebar" : ""} ${fullBleed ? "internal-shell--fullbleed" : ""}`}>
      <InternalPageHeader title={title} alerts={alerts} />
      {!hideSidebar ? <InternalDashboardViewStrip /> : null}
      <div className="internal-shell__body">
        {!hideSidebar ? <InternalMeraSidebar /> : null}
        <main
          className={`app-main app-main--auth ${isMobile && isSidebarOpen ? "app-main--nav-open" : ""} ${fullBleed ? "app-main--fullbleed" : ""}`}
          style={{ flex: 1, overflowY: mainOverflowY, overflowX: "hidden", scrollbarGutter: "stable both-edges" }}
        >
          <div className="dashboard internal-dashboard">
            <div className={`dashboard-replica internal-page-inner ${contentClassName}`.trim()}>{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}

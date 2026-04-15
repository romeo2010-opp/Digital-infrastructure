import React from "react";
import {
  DashboardIcon,
  OrdersIcon,
  BillingIcon,
  CustomersIcon,
  SettingsIcon,
  AccountIcon,
  InboxIcon,
  SmartLinkLogo,HelpIcon,
  ReportIcon,
  LogOut,
  LockIcon,
} from "../utils/icons";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useAppShell } from "../layout/AppShellContext";
import { STATION_PLAN_FEATURES } from "../subscription/planCatalog";
import { useStationPlan } from "../subscription/useStationPlan";

const mainMenu = [
  { label: "Dashboard", icon: <DashboardIcon />, to: "/" },
  { label: "Reservations", icon: <OrdersIcon />, to: "/reservations", feature: STATION_PLAN_FEATURES.RESERVATIONS },
  { label: "Digital Queue", icon: <CustomersIcon />, to: "/digitalQueue", feature: STATION_PLAN_FEATURES.DIGITAL_QUEUE },
  { label: "Insights", icon: <ReportIcon />, to: "/insights", feature: STATION_PLAN_FEATURES.INSIGHTS },
  { label: "Promotions", icon: <BillingIcon />, to: "/promotions", feature: STATION_PLAN_FEATURES.TRANSACTIONS_RECORD },
  { label: "Billing", icon: <BillingIcon /> }  
];

const systemMenu = [
  { label: "Settings", icon: <SettingsIcon />, to: "/settings" },
  { label : "Log Out", icon: <LogOut/>, action: "logout"}
];


const accountMenu = [
  { label: "Inbox", icon: <InboxIcon/>, to: "/inbox" },
  { label: "My Account", icon: <AccountIcon/>, to: "/account" },
  { label: "Get Help", icon: <HelpIcon/>, to: "/help" },
  { label: "Report", icon: <ReportIcon/>, to: "/reports" },
  { label: "Transactions", icon: <BillingIcon />, to: "/transactions-test", feature: STATION_PLAN_FEATURES.TRANSACTIONS_RECORD },
];

export default function Sidebar() {
  const { logout, session } = useAuth()
  const stationPlan = useStationPlan()
  const {
    isMobile,
    isSidebarOpen,
    isSidebarCollapsed,
    desktopSidebarWidth,
    setDesktopSidebarWidth,
    closeSidebar,
  } = useAppShell()
  const sidebarRef = React.useRef(null);
  const isResizing = React.useRef(false);
  const location = useLocation()

  React.useEffect(() => {
    if (isMobile && isSidebarOpen) {
      closeSidebar()
    }
    // only react to route changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Mouse move
  React.useEffect(() => {
    const handleMouseMove = (e) => {
      if (isMobile || isSidebarCollapsed) return;
      if (!isResizing.current) return;
      const newWidth = e.clientX;
      if (newWidth > 200 && newWidth < 500) { // min/max width
        setDesktopSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const fullName = session?.user?.fullName || "Station User"
  const email = session?.user?.email || session?.user?.phone || "signed-in@smartlink"
  const initials = (fullName || "S")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0].toUpperCase())
    .join("")

  const resolvedWidth = isMobile ? 280 : isSidebarCollapsed ? 88 : desktopSidebarWidth
  return (
    <>
      {isMobile && isSidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={closeSidebar}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        className={`sidebar ${isMobile && isSidebarOpen ? "open" : ""} ${
          isSidebarCollapsed && !isMobile ? "collapsed" : ""
        }`}
        style={{ width: resolvedWidth }}
      >
      {/* App Identity */}
      <div className="sidebar__brand">
        <SmartLinkLogo/>
        <div className="sidebar__brand-copy">
          <h1>SmartLink</h1>
          <p>Fuel Infrastructure</p>
        </div>
      </div>
      <div className="sidebar__content">
        <p className="sidebar__title">MAIN MENU</p>
        <nav className="sidebar__section">
          {mainMenu.map((item) => (
            <SidebarItem key={item.label} {...item} stationPlan={stationPlan} />
          ))}
        </nav>

        <nav className="sidebar__section">
          <p className="sidebar__title">ACCOUNT</p>
          {accountMenu.map((item) => (
            <SidebarItem key={item.label} {...item} stationPlan={stationPlan} />
          ))}
        </nav>

        <nav className="sidebar__section sidebar__section--bottom">
          {systemMenu.map((item) => (
            <SidebarItem
              key={item.label}
              {...item}
              stationPlan={stationPlan}
              onAction={(action) => {
                if (action === "logout") {
                  logout()
                }
              }}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar__user">
        <div className="avatar">{initials}</div>
        <div className="sidebar__user-copy">
          <strong>{fullName}</strong>
          <small>{email}</small>
          <small>{stationPlan.planName}</small>
        </div>
      </div>

      {/* Drag handle */}
      <div
        className="sidebar__resizer"
        onMouseDown={() => (isResizing.current = true)}
      />
      </aside>
    </>
  );
}

function SidebarItem({ icon, label, to, action, onAction, feature, stationPlan }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  const linkState = to === "/settings" ? { backgroundLocation: location } : undefined;
  const isLocked = Boolean(feature) && !stationPlan?.hasFeature(feature)
  const requiredPlan = feature ? stationPlan?.getRequirement(feature) : null
  const itemClassName = `sidebar__item ${isActive ? "active" : ""} ${isLocked ? "sidebar__item--locked" : ""}`.trim()
  const description = isLocked && requiredPlan ? `Requires ${requiredPlan.name}` : undefined

  if (!to) {
    return (
      <button
        type="button"
        onClick={() => onAction?.(action)}
        className={itemClassName}
        title={description || label}
        style={{ border: "none", background: "transparent", width: "100%", textAlign: "left", cursor: "pointer" }}
      >
        <span className="icon">{icon}</span>
        <span className="sidebar__item-copy">
          <span className="sidebar__item-label-row">
            <span>{label}</span>
            {isLocked ? (
              <span className="sidebar__lock-pill">
                <LockIcon />
                <span>Locked</span>
              </span>
            ) : null}
          </span>
          {isLocked && requiredPlan ? <small>Requires {requiredPlan.name}</small> : null}
        </span>
      </button>
    )
  }

  return (
    <Link
      to={to}
      state={linkState}
      title={description || label}
      style={{ textDecoration: "none", color: "inherit" }}
      className={itemClassName}
      aria-disabled={isLocked ? "true" : undefined}
    >
      <span className="icon">{icon}</span>
      <span className="sidebar__item-copy">
        <span className="sidebar__item-label-row">
          <span>{label}</span>
          {isLocked ? (
            <span className="sidebar__lock-pill">
              <LockIcon />
              <span>Locked</span>
            </span>
          ) : null}
        </span>
        {isLocked && requiredPlan ? <small>Requires {requiredPlan.name}</small> : null}
      </span>
    </Link>
  );
}

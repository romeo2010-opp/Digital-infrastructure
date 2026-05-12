import React from "react";
import {
  DashboardIcon,
  OrdersIcon,
  BillingIcon,
  CustomersIcon,
  SettingsIcon,
  AccountIcon,
  InboxIcon,
  SmartLinkLogo,HelpIcon, SmartLinkBlack, SmartLinkWhite,
  ReportIcon,
  LogOut,
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
  { label: "Transactions", icon: <BillingIcon />, to: "/transactions", feature: STATION_PLAN_FEATURES.TRANSACTIONS_VIEW },
  { label: "Settlements", icon: <BillingIcon />, to: "/settlements", feature: STATION_PLAN_FEATURES.TRANSACTIONS_VIEW },
  { label: "Promotions", icon: <BillingIcon />, to: "/promotions", feature: STATION_PLAN_FEATURES.TRANSACTIONS_RECORD },
  { label: "Billing", icon: <BillingIcon /> }  
];

const systemMenu = [
  { label: "Settings", icon: <SettingsIcon />, to: "/settings" },
];


const accountMenu = [
  { label: "Inbox", icon: <InboxIcon/>, to: "/inbox" },
  { label: "My Account", icon: <AccountIcon/>, to: "/account" },
  { label: "Get Help", icon: <HelpIcon/>, to: "/help" },
  { label: "Report", icon: <ReportIcon/>, to: "/reports" },
];

function ChevronRightIcon({ className = "" }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

function ChevronDownIcon({ className = "" }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export default function Sidebar() {
  const { logout, session } = useAuth()
  const stationPlan = useStationPlan()
  const {
    isMobile,
    isSidebarOpen,
    isSidebarCollapsed,
    desktopSidebarWidth,
    closeSidebar,
  } = useAppShell()
  const location = useLocation()

  React.useEffect(() => {
    if (isMobile && isSidebarOpen) {
      closeSidebar()
    }
    // only react to route changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const fullName = session?.user?.fullName || "Station User"
  const email = session?.user?.email || session?.user?.phone || "signed-in@smartlink"
  const initials = (fullName || "S")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0].toUpperCase())
    .join("")
  const primaryMenu = [...mainMenu, ...accountMenu]

  const resolvedWidth = isMobile ? 256 : isSidebarCollapsed ? 88 : desktopSidebarWidth
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
        className={`sidebar ${isMobile && isSidebarOpen ? "open" : ""} ${
          isSidebarCollapsed && !isMobile ? "collapsed" : ""
        }`}
        style={{ width: resolvedWidth }}
      >
        <div className="sidebar__brand">
          <div className="sidebar__brand-mark">
            <SmartLinkWhite/>
          </div>
          <div className="sidebar__brand-copy">
            <h1>SmartLink</h1>
          </div>
        </div>

        <div className="sidebar__content">
          <nav className="sidebar__nav">
            {primaryMenu.map((item) => (
              <SidebarItem key={item.label} {...item} stationPlan={stationPlan} />
            ))}
          </nav>
        </div>

        <div className="sidebar__footer">
          <nav className="sidebar__footer-nav">
            {systemMenu.map((item) => (
              <SidebarItem
                key={item.label}
                {...item}
                stationPlan={stationPlan}
              />
            ))}
          </nav>

          <div className="sidebar__user">
            <div className="avatar">{initials}</div>
            <div className="sidebar__user-copy">
              <strong>{fullName}</strong>
              <small>{stationPlan.planName}</small>
            </div>
            <button
              type="button"
              className="sidebar__logout"
              aria-label="Sign out"
              title={`Sign out ${email}`}
              onClick={logout}
            >
              <LogOut />
            </button>
            <ChevronDownIcon className="sidebar__footer-chevron" />
          </div>
        </div>
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
        <span className="sidebar__item-icon">{icon}</span>
        <span className="sidebar__item-copy">
          <span className="sidebar__item-label">{label}</span>
          {isLocked && requiredPlan ? <small>{requiredPlan.name}</small> : null}
        </span>
        <ChevronRightIcon className="sidebar__item-chevron" />
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
      <span className="sidebar__item-icon">{icon}</span>
      <span className="sidebar__item-copy">
        <span className="sidebar__item-label">{label}</span>
        {isLocked && requiredPlan ? <small>{requiredPlan.name}</small> : null}
      </span>
      {!isActive ? <ChevronRightIcon className="sidebar__item-chevron" /> : null}
    </Link>
  );
}

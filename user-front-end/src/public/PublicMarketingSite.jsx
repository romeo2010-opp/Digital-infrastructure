import { useEffect, useMemo, useState } from "react";
import "./publicMarketing.css";

const PUBLIC_MARKETING_PATHS = new Set([
  "/",
  "/landing",
  "/platform",
  "/station-manager",
  "/driver-app",
  "/analytics-suite",
  "/supplier-portal",
  "/about",
  "/docs",
  "/developers/api-reference",
  "/websocket-guide",
  "/status",
  "/changelog",
  "/investors",
  "/contact",
  "/careers",
]);

const NAV_LINKS = [
  { label: "Platform", to: "/platform" },
  { label: "API", to: "/docs" },
  { label: "About", to: "/about" },
  { label: "Investors", to: "/investors" },
  { label: "Contact", to: "/contact" },
];

const TRUSTED_BY = [
  "NOCMA",
  "MERA",
  "TotalEnergies",
  "Puma Energy",
  "Petroda",
  "MBS",
  "OILCOM",
];

const CAPABILITIES = [
  {
    accent: "orange",
    icon: "P",
    title: "Real-Time Pump Monitoring",
    body: "Live nozzle state, dispense volumes, downtime alerts, and manager actions across every connected forecourt.",
  },
  {
    accent: "green",
    icon: "T",
    title: "Tank Capacity Intelligence",
    body: "Tank-level visibility with low-stock alerts, reorder signals, and supplier-facing demand posture.",
  },
  {
    accent: "blue",
    icon: "M",
    title: "Driver Mobile Platform",
    body: "Drivers discover available fuel, join digital queues, reserve service windows, and pay through one flow.",
  },
  {
    accent: "purple",
    icon: "F",
    title: "Predictive Demand Forecasting",
    body: "Forecasting models surface station and district demand signals before outages become public pressure.",
  },
  {
    accent: "teal",
    icon: "A",
    title: "Open Infrastructure API",
    body: "REST and realtime interfaces for partners building on station availability, queues, telemetry, and events.",
  },
  {
    accent: "yellow",
    icon: "C",
    title: "Compliance & Audit Trails",
    body: "Every critical operating event is traceable, exportable, and ready for regulator-grade reporting.",
  },
];

const HOW_STEPS = [
  {
    number: "01",
    title: "Station Sensors & Tank Telemetry",
    body: "SmartLink integrates station activity, pump readiness, tank status, and operator updates into one live operating layer.",
  },
  {
    number: "02",
    title: "Digital Queue Formation",
    body: "Drivers join approved station queues remotely and receive slot, position, and service-window updates.",
  },
  {
    number: "03",
    title: "AI Demand Forecasting",
    body: "Historical purchase patterns and live consumption signals produce 24-72 hour demand and restocking insight.",
  },
  {
    number: "04",
    title: "QR Validation at the Pump",
    body: "Dynamic queue and transaction records can be verified at the forecourt, reducing manual disputes and fraud.",
  },
  {
    number: "05",
    title: "Supplier Coordination Layer",
    body: "Suppliers and partners see aggregate demand posture, station readiness, and delivery pressure before the last mile breaks.",
  },
];

const METRICS = [
  {
    label: "Stations Onboarded",
    value: "340",
    change: "18% this quarter",
  },
  {
    label: "Queue Transactions",
    value: "1.2M",
    change: "41% month over month",
  },
  {
    label: "API Uptime SLA",
    value: "99.97%",
    change: "30-day rolling average",
  },
  {
    label: "Avg Wait Reduction",
    value: "67%",
    change: "vs. manual forecourt ops",
  },
];

const API_SERVICES = [
  {
    name: "Station Feed API",
    icon: "SF",
    latency: "42ms",
    status: "Operational",
    uptime: "99.97% / 90d",
    incidentIndex: 8,
  },
  {
    name: "Geolocation API",
    icon: "G",
    latency: "18ms",
    status: "Operational",
    uptime: "100% / 90d",
  },
  {
    name: "Queue Notification WS",
    icon: "WS",
    latency: "3ms",
    status: "Operational",
    uptime: "99.99% / 90d",
  },
  {
    name: "Analytics & Forecasting",
    icon: "AF",
    latency: "210ms",
    status: "Maintenance",
    uptime: "99.82% / 90d",
    incidentIndex: 10,
  },
  {
    name: "Auth & Identity",
    icon: "ID",
    latency: "29ms",
    status: "Operational",
    uptime: "100% / 90d",
  },
];

const TEAM = [
  {
    name: "Romeo Favour Mbeya",
    role: "Founder & Product Architect",
    image: "/landing/team/romeo-mbeya.png",
    bio: "Malawi-based builder focused on real-time station visibility, queue coordination, regulatory-grade data, and practical digital infrastructure for African fuel markets.",
  },
  {
    name: "Thandiwe Kachere",
    role: "Operations & Station Partnerships",
    image: "/landing/team/thandiwe-kachere.png",
    bio: "Leads station onboarding, partner success, and the operating playbooks that make SmartLink useful at the forecourt.",
  },
  {
    name: "Brian Phiri",
    role: "Lead Platform Engineer",
    image: "/landing/team/brian-phiri.png",
    bio: "Designs the resilient data services, realtime events, and platform foundations behind SmartLink's infrastructure layer.",
  },
  {
    name: "Chikondi Banda",
    role: "Data & Forecasting Lead",
    image: "/landing/team/chikondi-banda.png",
    bio: "Turns station activity, demand pressure, and supply patterns into forecasting tools for operators and partners.",
  },
  {
    name: "Miriam Nkhoma",
    role: "Compliance & Public Sector Partnerships",
    image: "/landing/team/miriam-nkhoma.png",
    bio: "Aligns SmartLink reporting, audit trails, and public-sector workflows with the trust standards fuel infrastructure needs.",
  },
  {
    name: "Daniel Mbewe",
    role: "Product Design & Driver Experience",
    image: "/landing/team/daniel-mbewe.png",
    bio: "Shapes the driver and station-facing product experience so complex fuel operations feel simple, fast, and calm.",
  },
];

const DOC_NAV = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "base-url", label: "Base URL" },
  { id: "stations", label: "Stations" },
  { id: "queues", label: "Queues" },
  { id: "webhooks", label: "Webhooks" },
  { id: "errors", label: "Errors" },
  { id: "limits", label: "Rate Limits" },
];

const MISSION =
  "To build Africa's trusted fuel infrastructure intelligence layer, giving drivers, stations, suppliers, and regulators the live data they need to move fuel more efficiently, transparently, and fairly.";

const FOOTER_DETAIL_PAGES = {
  "/station-manager": {
    eyebrow: "Station Manager",
    title: "A live operating console for connected fuel stations.",
    body: "Station Manager gives attendants, supervisors, and owners one place to coordinate pump readiness, queues, stock posture, alerts, and reporting.",
    primary: "Request Station Access",
    secondary: "View Platform",
    secondaryPath: "/platform",
    sections: [
      ["Forecourt Control", "Monitor pump and nozzle readiness, queue pressure, service windows, and active operator actions from a single command view."],
      ["Stock Posture", "Track fuel availability, low-stock signals, and delivery context so station teams can act before drivers arrive."],
      ["Manager Workflows", "Coordinate queue pauses, service notices, exception handling, and audit-ready updates without scattered messaging."],
      ["Reporting", "Export operational history for finance, partner review, and regulator-ready visibility."],
    ],
    flow: [
      "Connect station profile and operator users",
      "Publish live service readiness",
      "Coordinate demand and queue movement",
      "Resolve exceptions with an audit trail",
    ],
  },
  "/driver-app": {
    eyebrow: "Driver App",
    title: "Fuel discovery, queues, reservations, and wallet context for drivers.",
    body: "The SmartLink driver app turns uncertain fuel trips into clear decisions with live station availability and queue guidance.",
    primary: "Open Driver Login",
    secondary: "View Platform",
    secondaryPath: "/platform",
    sections: [
      ["Live Discovery", "Compare nearby stations by availability, distance, queue pressure, and service status before moving."],
      ["Digital Queues", "Join eligible station queues remotely and receive movement, ETA, and service-window updates."],
      ["Reservations", "Reserve controlled slots when stations open appointment windows for specific fuel types."],
      ["Receipts and Wallet", "Keep transaction, prepay, and queue history in one account surface."],
    ],
    flow: [
      "Find a verified station",
      "Join a queue or reserve a slot",
      "Receive movement alerts",
      "Arrive with cleaner service expectations",
    ],
  },
  "/analytics-suite": {
    eyebrow: "Analytics Suite",
    title: "Demand intelligence for station networks and fuel partners.",
    body: "SmartLink analytics converts station activity, queue pressure, deliveries, and driver demand into practical operating intelligence.",
    primary: "Request Analytics Access",
    secondary: "Read API Guide",
    secondaryPath: "/docs",
    sections: [
      ["Demand Forecasts", "Surface fuel demand signals by station, district, route, and time window."],
      ["Operational Trends", "Track queue pressure, service disruptions, low-stock patterns, and station responsiveness."],
      ["Network Reporting", "Package live and historical metrics for partners, operators, and public-sector visibility."],
      ["Export Workflows", "Prepare clean datasets for reconciliation, regulatory reporting, and investor dashboards."],
    ],
    flow: [
      "Ingest station and queue events",
      "Normalize live operational data",
      "Generate forecasts and summaries",
      "Export reports for decision makers",
    ],
  },
  "/supplier-portal": {
    eyebrow: "Supplier Portal",
    title: "A coordination surface for fuel delivery and restocking pressure.",
    body: "Supplier Portal helps distribution partners understand where demand is forming, which stations need attention, and how delivery actions affect queues.",
    primary: "Talk to Partnerships",
    primaryPath: "/contact",
    secondary: "View Platform",
    secondaryPath: "/platform",
    sections: [
      ["Restocking Signals", "Prioritize dispatch based on station posture, low-stock alerts, queue pressure, and historical consumption."],
      ["Delivery Visibility", "Connect tanker movement, delivery logs, and station confirmation into a shared operating record."],
      ["Demand Heat", "Understand regional fuel pressure before it becomes a public queue problem."],
      ["Partner APIs", "Use SmartLink data interfaces to connect dispatch, finance, and monitoring systems."],
    ],
    flow: [
      "Review demand and station posture",
      "Prioritize delivery routes",
      "Confirm station handoff",
      "Measure queue and availability impact",
    ],
  },
  "/developers/api-reference": {
    eyebrow: "API Reference",
    title: "REST endpoints for SmartLink station, queue, and reporting data.",
    body: "The API reference gives partners a quick map of the intended SmartLink integration surface.",
    primary: "Read Full Docs",
    primaryPath: "/docs",
    secondary: "Get API Key",
    secondaryPath: "/contact",
    sections: [
      ["Stations", "Fetch station profiles, live status, fuel levels, queue depth, service readiness, and pump availability."],
      ["Queues", "Create queue entries, inspect movement, update status, and receive ETA changes."],
      ["Reports", "Request availability, delivery, queue, and compliance summaries for approved scopes."],
      ["Authentication", "Use bearer API keys with role-based scopes for stations, suppliers, regulators, and partners."],
    ],
    flow: [
      "Create a scoped API key",
      "Call versioned v1 endpoints",
      "Handle stable error responses",
      "Subscribe to events for realtime updates",
    ],
  },
  "/websocket-guide": {
    eyebrow: "WebSocket Guide",
    title: "Realtime station and queue events for partner systems.",
    body: "SmartLink realtime streams are designed for systems that need queue movement, station status, delivery, and alert updates without polling.",
    primary: "Read API Docs",
    primaryPath: "/docs",
    secondary: "Contact Developers",
    secondaryPath: "/contact",
    sections: [
      ["Queue Movement", "Receive events when positions, ETAs, pauses, or service calls change."],
      ["Station Status", "Track availability, pump readiness, and service notices as operators update the network."],
      ["Delivery Events", "Subscribe to dispatch, arrival, confirmation, and reconciliation updates."],
      ["Connection Health", "Use heartbeat, reconnect, and replay strategies for resilient integrations."],
    ],
    flow: [
      "Authenticate the socket",
      "Subscribe to scoped channels",
      "Process event payloads",
      "Reconnect with last-event recovery",
    ],
  },
  "/status": {
    eyebrow: "Status Page",
    title: "Operational visibility for SmartLink services.",
    body: "The public status page summarizes the intended health posture for SmartLink APIs, realtime services, station feeds, and analytics.",
    primary: "View API Guide",
    primaryPath: "/docs",
    secondary: "Report an Issue",
    secondaryPath: "/contact",
    sections: [
      ["Station Feed API", "Operational with monitored latency and uptime posture."],
      ["Queue Notification WS", "Operational for realtime queue, alert, and movement events."],
      ["Analytics and Forecasting", "Maintenance-aware service for forecasting and reporting workloads."],
      ["Auth and Identity", "Operational authentication surface for account and API access."],
    ],
    flow: [
      "Monitor public service health",
      "Review scheduled maintenance",
      "Subscribe to incident updates",
      "Escalate partner-impacting issues",
    ],
  },
  "/changelog": {
    eyebrow: "Changelog",
    title: "Product and API updates across the SmartLink network.",
    body: "The changelog keeps partners aligned on public product direction, integration changes, and infrastructure milestones.",
    primary: "Read Docs",
    primaryPath: "/docs",
    secondary: "Contact Product",
    secondaryPath: "/contact",
    sections: [
      ["Public Site Rebuild", "Added the SmartLink marketing surface, About page, API guide, and investor/contact pages."],
      ["API Guide Draft", "Documented mock REST, WebSocket, error, and rate-limit interfaces for partner planning."],
      ["Team Story", "Introduced Romeo Favour Mbeya and the reimagined multidisciplinary SmartLink team."],
      ["Platform Messaging", "Clarified station manager, driver app, analytics, supplier, and regulator workflows."],
    ],
    flow: [
      "Publish release notes",
      "Document integration changes",
      "Highlight operational milestones",
      "Share partner-facing next steps",
    ],
  },
  "/careers": {
    eyebrow: "Careers",
    title: "Build infrastructure that makes fuel movement calmer and more accountable.",
    body: "SmartLink is for people who care about essential systems, practical software, and the future of African infrastructure.",
    primary: "Start a Conversation",
    primaryPath: "/contact",
    secondary: "Meet the Team",
    secondaryPath: "/about",
    sections: [
      ["Engineering", "Build realtime services, APIs, data pipelines, and resilient product surfaces for station and driver workflows."],
      ["Operations", "Work directly with station teams, suppliers, and partners to make the network useful in the real world."],
      ["Data and Forecasting", "Turn fuel movement, queue pressure, and station posture into decision-grade intelligence."],
      ["Product and Design", "Shape simple experiences for drivers and dense operating tools for station teams."],
    ],
    flow: [
      "Send a short note about your interest",
      "Share relevant work or operating experience",
      "Meet the SmartLink team",
      "Find the right infrastructure problem to own",
    ],
  },
};

export function isPublicMarketingPath(pathname) {
  return PUBLIC_MARKETING_PATHS.has(String(pathname || "").trim() || "/");
}

function MarketingLink({ to, onNavigate, onClick, className, children }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button !== 0 ||
          to.startsWith("#") ||
          to.startsWith("mailto:")
        ) {
          onClick?.();
          return;
        }
        event.preventDefault();
        onClick?.();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

function Logo() {
  return (
    <span className="marketing-logo">
      <span className="marketing-logo-mark">
        <img src="/smartlogo.png" alt="" />
      </span>
      <span>SmartLink</span>
    </span>
  );
}

function MarketingShell({
  currentPath,
  onNavigate,
  loginPath,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPath]);

  return (
    <main className="marketing-root">
      <header className="marketing-nav">
        <div className="marketing-nav-inner">
          <MarketingLink
            to="/"
            className="marketing-nav-brand"
            onNavigate={onNavigate}
          >
            <Logo />
          </MarketingLink>

          <nav className="marketing-nav-links" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <MarketingLink
                key={link.to}
                to={link.to}
                onNavigate={onNavigate}
                className={currentPath === link.to ? "is-active" : ""}
              >
                {link.label}
              </MarketingLink>
            ))}
          </nav>

          <div className="marketing-nav-actions">
            <button
              type="button"
              className="marketing-btn ghost"
              onClick={() => onNavigate(loginPath)}
            >
              Sign in
            </button>
            <button
              type="button"
              className="marketing-btn primary"
              onClick={() => onNavigate(loginPath)}
            >
              Get Started
            </button>
          </div>

          <button
            type="button"
            className="marketing-menu-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        <div className={`marketing-mobile-panel ${menuOpen ? "is-open" : ""}`}>
          {NAV_LINKS.map((link) => (
            <MarketingLink
              key={link.to}
              to={link.to}
              onNavigate={onNavigate}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </MarketingLink>
          ))}
          <div className="marketing-mobile-actions">
            <button
              type="button"
              className="marketing-btn ghost"
              onClick={() => onNavigate(loginPath)}
            >
              Sign in
            </button>
            <button
              type="button"
              className="marketing-btn primary"
              onClick={() => onNavigate(loginPath)}
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {children}
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

function SectionHeading({ eyebrow, title, body, align = "left" }) {
  return (
    <div className={`marketing-section-heading align-${align}`}>
      <p className="marketing-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {body ? <p className="marketing-section-sub">{body}</p> : null}
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8h10M8 3l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function HeroMockup() {
  const pins = [
    { className: "safe", left: "34%", top: "30%", label: "Area 18 - Open" },
    { className: "busy", left: "58%", top: "46%", label: "Limbe - Queue: 14" },
    { className: "low", left: "23%", top: "60%", label: "Blantyre - Low Stock" },
    { className: "safe", left: "72%", top: "26%", label: "Lilongwe - Open" },
  ];

  return (
    <div className="hero-visual">
      <div className="hero-mockup">
        <div className="hero-mockup-bar">
          <span className="mockup-dot red" />
          <span className="mockup-dot yellow" />
          <span className="mockup-dot green" />
          <small>SmartLink Station Manager - Live Dashboard</small>
        </div>
        <div className="hero-map-area">
          <div className="hero-map-grid" />
          <div className="hero-map-route route-one" />
          <div className="hero-map-route route-two" />
          <div className="hero-map-route route-three" />
          {pins.map((pin) => (
            <div
              key={pin.label}
              className={`map-pin map-pin-${pin.className}`}
              style={{ left: pin.left, top: pin.top }}
            >
              <span className="map-pin-dot" />
              <span className="map-pin-label">{pin.label}</span>
            </div>
          ))}
        </div>
        <div className="mock-stats-row">
          <div>
            <strong>47</strong>
            <span>Active Queues</span>
          </div>
          <div>
            <strong className="green">82%</strong>
            <span>Stations Online</span>
          </div>
          <div>
            <strong>8 min</strong>
            <span>Avg Wait</span>
          </div>
        </div>
      </div>
      <div className="hero-float-card float-card-left">
        <span>Fuel Demand Forecast</span>
        <strong>23%</strong>
        <small>Next 48h prediction</small>
      </div>
      <div className="hero-float-card float-card-right">
        <span>Queue Efficiency</span>
        <strong>3.4x</strong>
        <small>vs. manual ops</small>
      </div>
    </div>
  );
}

function LandingPage({ onNavigate, loginPath }) {
  const [activeTab, setActiveTab] = useState("station");

  return (
    <>
      <section className="marketing-hero">
        <div className="hero-copy">
          <p className="hero-eyebrow">
            <span />
            Live Across Malawi - Expanding to Africa
          </p>
          <h1>
            The Fuel
            <br />
            Infrastructure
            <br />
            <em>Intelligence Layer</em>
          </h1>
          <p className="hero-sub">
            SmartLink connects fuel stations, drivers, suppliers, and regulators
            into a single realtime coordination network, digitizing Africa's fuel
            ecosystem from the pump up.
          </p>
          <div className="marketing-actions">
            <button
              type="button"
              className="marketing-btn hero"
              onClick={() => onNavigate(loginPath)}
            >
              Request Access
              <ArrowIcon />
            </button>
            <a className="marketing-link-btn" href="#platform-overview">
              See How It Works
              <ArrowIcon />
            </a>
          </div>
          <div className="hero-stats">
            <div>
              <strong>340+</strong>
              <span>Stations Monitored</span>
            </div>
            <div>
              <strong>99.97%</strong>
              <span>API Uptime</span>
            </div>
            <div>
              <strong>1.2M+</strong>
              <span>Transactions Tracked</span>
            </div>
          </div>
        </div>
        <HeroMockup />
      </section>

      <div className="logos-band">
        <span>Trusted Infrastructure For</span>
        <div>
          {TRUSTED_BY.map((item) => (
            <strong key={item}>{item}</strong>
          ))}
        </div>
      </div>

      <section className="marketing-section">
        <div className="split-heading">
          <SectionHeading
            eyebrow="Traction"
            title="Infrastructure at scale, growing every day."
          />
          <p>
            From a single station dashboard to a national coordination network,
            SmartLink processes operating signals that keep Malawi's fuel economy
            moving.
          </p>
        </div>
        <div className="metrics-grid">
          {METRICS.map((metric) => (
            <article key={metric.label} className="metric-card">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.change}</small>
            </article>
          ))}
        </div>
      </section>

      <section id="platform-overview" className="marketing-section band">
        <SectionHeading
          eyebrow="How It Works"
          title="End-to-end coordination, from tank to driver."
        />
        <div className="how-grid">
          <div className="how-steps">
            {HOW_STEPS.map((step) => (
              <article key={step.number}>
                <span>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="how-visual">
            <div className="how-visual-map" />
            <div>
              <span>Live: Blantyre CBD</span>
              <strong>
                12 drivers in queue
                <br />
                Est. clearance: 34 min
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section dark" id="features">
        <SectionHeading
          align="center"
          eyebrow="Platform Capabilities"
          title="Everything the fuel ecosystem needs."
          body="SmartLink is built like banking infrastructure: reliable, auditable, and mission-critical at every layer."
        />
        <div className="features-grid">
          {CAPABILITIES.map((item) => (
            <article key={item.title} className="feature-card">
              <span className={`feature-icon ${item.accent}`}>{item.icon}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="platform">
        <SectionHeading
          eyebrow="Two Platforms. One Network."
          title="Built for stations. Loved by drivers."
        />
        <div className="platform-tabs">
          {["station", "driver", "partner"].map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "is-active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "station"
                ? "Station Manager"
                : tab === "driver"
                  ? "Driver App"
                  : "Supplier Layer"}
            </button>
          ))}
        </div>
        <PlatformPanel activeTab={activeTab} />
      </section>

      <section className="marketing-section band" id="api">
        <SectionHeading
          eyebrow="System Status & API"
          title="Infrastructure you can build a business on."
        />
        <ApiPreview onNavigate={onNavigate} loginPath={loginPath} />
      </section>

      <section className="marketing-section" id="about">
        <div className="about-preview-grid">
          <ImageStack />
          <div>
            <SectionHeading
              eyebrow="About SmartLink"
              title="We're building Africa's fuel OS."
            />
            <p>
              Sub-Saharan Africa loses billions annually to fuel supply chain
              inefficiency: long queues, opaque station status, unplanned
              outages, and limited distribution-layer data. SmartLink was built
              to fix that from the ground up.
            </p>
            <p>
              Founded in Blantyre, Malawi, SmartLink is engineering the digital
              infrastructure layer that the fuel ecosystem cannot operate
              without.
            </p>
            <div className="about-values">
              <ValueItem
                title="Infrastructure First"
                body="Reliable, scalable systems that become the layer other tools run on."
              />
              <ValueItem
                title="Africa-Native"
                body="Built for intermittent connectivity, cash realities, and regulatory complexity."
              />
              <ValueItem
                title="Trust-Grade Engineering"
                body="Every event is designed to be verified, audited, and operationally useful."
              />
            </div>
            <button
              type="button"
              className="marketing-btn primary inline"
              onClick={() => onNavigate("/about")}
            >
              Meet the Team
            </button>
          </div>
        </div>
      </section>

      <InvestorsBand onNavigate={onNavigate} />
    </>
  );
}

function PlatformPanel({ activeTab }) {
  const content = {
    station: {
      title: "Station teams get one clear control room.",
      imageLabel: "Station Manager",
      points: [
        ["Live Operations Dashboard", "All pumps, nozzles, queues, and tank levels in one operating view."],
        ["Revenue & Sales Analytics", "Daily, weekly, and monthly sales signals by station, fuel type, and channel."],
        ["Queue Management Console", "Approve, redirect, pause, or prioritize demand before drivers crowd the forecourt."],
        ["Smart Alert System", "Pump faults, tank thresholds, and fraud signals sent to the right operators fast."],
      ],
    },
    driver: {
      title: "Drivers choose the right station before they move.",
      imageLabel: "Driver App",
      points: [
        ["Real-Time Station Discovery", "Compare availability, distance, queue pressure, and station readiness."],
        ["Digital Queues & Slots", "Join approved queues or reserve eligible service windows ahead of arrival."],
        ["QR Pump Validation", "Connect queue identity, payment context, and pump handoff in one flow."],
        ["Fuel Spend History", "Keep a clean digital receipt trail for personal, business, and fleet use."],
      ],
    },
    partner: {
      title: "Suppliers and partners see demand before it becomes noise.",
      imageLabel: "Partner Layer",
      points: [
        ["Demand Intelligence", "Aggregate pressure by district, station, route, and fuel type."],
        ["Delivery Coordination", "Use station posture to prioritize restocking and reduce wasted routes."],
        ["Regulator Reporting", "Export auditable data for fuel availability, incidents, and compliance."],
        ["Integration Surface", "Build partner workflows with APIs, webhooks, and realtime event streams."],
      ],
    },
  }[activeTab];

  return (
    <div className="platform-content">
      <div className="platform-list">
        <h3>{content.title}</h3>
        {content.points.map(([title, body]) => (
          <article key={title}>
            <span>{title.charAt(0)}</span>
            <div>
              <h4>{title}</h4>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="platform-visual">
        <span>{content.imageLabel}</span>
        <div className="platform-screen-lines">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

function ApiPreview({ onNavigate, loginPath }) {
  return (
    <div className="api-grid">
      <div className="api-status-board">
        <header>
          <strong>Service Status</strong>
          <span>
            <i />
            All systems operational
          </span>
        </header>
        {API_SERVICES.map((service) => (
          <article key={service.name}>
            <div className="api-service-name">
              <span>{service.icon}</span>
              {service.name}
            </div>
            <div className="api-service-meta">
              <UptimeBar incidentIndex={service.incidentIndex} />
              <small>{service.uptime}</small>
              <em>{service.latency}</em>
              <strong
                className={
                  service.status === "Maintenance" ? "is-maintenance" : ""
                }
              >
                {service.status}
              </strong>
            </div>
          </article>
        ))}
      </div>
      <div className="api-docs-card">
        <p>Developer API</p>
        <h3>Build on the fuel infrastructure layer.</h3>
        <span>
          Programmatic access to live station data, queue state, demand
          forecasts, and transaction records.
        </span>
        <CodeBlock
          code={`// Fetch live station status
GET /v1/stations/SL-BT-0042/status

{
  "station_id": "SL-BT-0042",
  "fuel_level": 68.4,
  "queue_depth": 12,
  "est_wait_min": 23,
  "pumps_active": "4/4"
}`}
        />
        <div className="marketing-actions">
          <button
            type="button"
            className="marketing-btn primary"
            onClick={() => onNavigate("/docs")}
          >
            Read the Docs
          </button>
          <button
            type="button"
            className="marketing-btn ghost dark"
            onClick={() => onNavigate(loginPath)}
          >
            Get API Key
          </button>
        </div>
      </div>
    </div>
  );
}

function UptimeBar({ incidentIndex }) {
  return (
    <span className="uptime-bar" aria-hidden="true">
      {Array.from({ length: 15 }).map((_, index) => (
        <i
          key={index}
          className={index === incidentIndex ? "incident" : "up"}
        />
      ))}
    </span>
  );
}

function CodeBlock({ code }) {
  return <pre className="marketing-code">{code}</pre>;
}

function ImageStack() {
  return (
    <div className="about-image-stack">
      <div className="about-image-main">
        <img src="/landing/team/team-group.png" alt="SmartLink team" />
      </div>
      <div className="about-image-accent">
        <img src="/landing/team/romeo-mbeya.png" alt="Romeo Favour Mbeya" />
      </div>
      <div className="about-mission-badge">
        <strong>2024</strong>
        <span>Founded in Blantyre, Malawi</span>
      </div>
    </div>
  );
}

function ValueItem({ title, body }) {
  return (
    <article className="value-item">
      <span />
      <div>
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
    </article>
  );
}

function InvestorsBand({ onNavigate }) {
  return (
    <section className="marketing-section investors-band" id="investors">
      <SectionHeading
        align="center"
        eyebrow="Investor Relations"
        title="A once-in-a-decade infrastructure bet."
        body="Africa's fuel sector processes massive economic value with limited realtime coordination. SmartLink is positioned to own the operating intelligence layer."
      />
      <div className="investor-grid">
        <InvestorCard
          label="TAM"
          title="Total Addressable Market"
          body="Fuel retail, logistics coordination, demand intelligence, and data licensing create a deep infrastructure opportunity."
          metric="$200B+"
          metricLabel="SSA fuel market annually"
        />
        <InvestorCard
          label="NF"
          title="Defensible Network Effects"
          body="Every station increases driver value. Every driver increases station insight. The network compounds once embedded."
          metric="4x"
          metricLabel="Value per station as network grows"
        />
        <InvestorCard
          label="RS"
          title="Multiple Revenue Streams"
          body="Station SaaS, transaction fees, analytics licensing, supplier access, and public-sector reporting create resilient upside."
          metric="6"
          metricLabel="Distinct revenue lines"
        />
      </div>
      <div className="cta-bar">
        <strong>Ready to power the continent's fuel future?</strong>
        <button
          type="button"
          className="marketing-btn light"
          onClick={() => onNavigate("/contact")}
        >
          Contact Investor Relations
        </button>
      </div>
    </section>
  );
}

function InvestorCard({ label, title, body, metric, metricLabel }) {
  return (
    <article className="investor-card">
      <span>{label}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      <strong>{metric}</strong>
      <small>{metricLabel}</small>
    </article>
  );
}

function PlatformPage({ onNavigate, loginPath }) {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        title="One network for drivers, stations, suppliers, and regulators."
        body="SmartLink gives every participant a clear operating surface: live station status, queue posture, payments context, telemetry, and auditable reporting."
        primary="Request Access"
        secondary="Read API Guide"
        onPrimary={() => onNavigate(loginPath)}
        onSecondary={() => onNavigate("/docs")}
      />
      <section className="marketing-section">
        <div className="platform-page-grid">
          {[
            ["Station Manager", "A dense control room for pumps, queues, stock posture, service windows, delivery logs, and manager actions."],
            ["Driver App", "A simple mobile journey for station discovery, queue joining, reservations, wallet flows, alerts, and receipt history."],
            ["Supplier Layer", "Aggregated demand and stock signals that help suppliers prioritize dispatch before stations run dry."],
            ["Regulatory Intelligence", "Auditable availability, queue, delivery, complaint, and compliance data built for public-sector visibility."],
          ].map(([title, body]) => (
            <article key={title} className="platform-page-card">
              <span>{title.charAt(0)}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section band">
        <SectionHeading
          eyebrow="Operating Flow"
          title="From live station signal to verified service."
          body="The platform is designed around the real chain of decisions made by station teams and drivers every day."
        />
        <div className="timeline-grid">
          {[
            "Ingest station and operator signals",
            "Publish verified availability and queue posture",
            "Route driver demand through digital queue controls",
            "Validate service and reconcile transaction context",
            "Export data for partners, suppliers, and regulators",
          ].map((item, index) => (
            <article key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section">
        <ApiPreview onNavigate={onNavigate} loginPath={loginPath} />
      </section>
    </>
  );
}

function AboutPage({ onNavigate }) {
  return (
    <>
      <PageHero
        eyebrow="About SmartLink"
        title="Built in Malawi for the fuel systems Africa depends on."
        body="SmartLink is a practical infrastructure company, not a brochure app. We build realtime operating tools for a sector where every delay becomes public pressure."
        primary="Contact the Team"
        secondary="API Guide"
        onPrimary={() => onNavigate("/contact")}
        onSecondary={() => onNavigate("/docs")}
      />

      <section className="marketing-section">
        <div className="about-hero-image">
          <img src="/landing/team/team-group.png" alt="SmartLink team together" />
        </div>
      </section>

      <section className="marketing-section about-story-grid">
        <div>
          <SectionHeading
            eyebrow="Our Story"
            title="A cleaner operating layer for a critical market."
          />
          <p>
            SmartLink started from a simple observation: fuel queues are not only
            a driver inconvenience, they are a signal that the market is missing
            realtime coordination. Stations need cleaner demand visibility.
            Drivers need trustworthy availability. Regulators and suppliers need
            auditable data.
          </p>
          <p>
            Romeo Favour Mbeya founded SmartLink to turn those disconnected
            signals into a single infrastructure layer for Africa's fuel economy.
            The product brings together station telemetry, queue tools,
            forecasting, payments context, and compliance-ready records.
          </p>
        </div>
        <aside className="mission-quote">
          <span>Mission</span>
          <strong>{MISSION}</strong>
        </aside>
      </section>

      <section className="marketing-section founder-section">
        <img src="/landing/team/romeo-mbeya.png" alt="Romeo Favour Mbeya" />
        <div>
          <p className="marketing-eyebrow">Founder</p>
          <h2>Romeo Favour Mbeya</h2>
          <h3>Founder & Product Architect</h3>
          <p>
            Romeo is a Malawi-based builder focused on fuel infrastructure,
            real-time station visibility, queue coordination, regulatory-grade
            data, and practical digital systems for African markets. His work on
            SmartLink is grounded in the belief that essential services need
            reliable operating systems, not disconnected dashboards.
          </p>
        </div>
      </section>

      <section className="marketing-section dark">
        <SectionHeading
          align="center"
          eyebrow="Our Dream Team"
          title="The reimagined team behind the network."
          body="A compact, multidisciplinary team built around operations, engineering, data, compliance, and experience design."
        />
        <div className="team-grid">
          {TEAM.map((member) => (
            <article key={member.name} className="team-card">
              <img src={member.image} alt={member.name} />
              <div>
                <h3>{member.name}</h3>
                <span>{member.role}</span>
                <p>{member.bio}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="values-grid">
          <ValueItem
            title="Operate with truth"
            body="We value live, verifiable data over informal updates and guesswork."
          />
          <ValueItem
            title="Design for real conditions"
            body="SmartLink is built for African infrastructure realities, including fragmented connectivity and complex coordination."
          />
          <ValueItem
            title="Build systems that last"
            body="Fuel infrastructure deserves reliable, audited, partner-ready software."
          />
        </div>
        <div className="join-team-cta">
          <h2>Want to build the fuel OS with us?</h2>
          <p>
            We are looking for people who care about infrastructure,
            accountability, and practical technology for essential markets.
          </p>
          <button
            type="button"
            className="marketing-btn primary"
            onClick={() => onNavigate("/contact")}
          >
            Start a Conversation
          </button>
        </div>
      </section>
    </>
  );
}

function DocsPage({ onNavigate, loginPath }) {
  return (
    <>
      <PageHero
        eyebrow="Developer API"
        title="Build with SmartLink's mock infrastructure API."
        body="A modern guide for station availability, queue state, realtime events, webhooks, and reporting integrations."
        primary="Get API Key"
        secondary="Contact Support"
        onPrimary={() => onNavigate(loginPath)}
        onSecondary={() => onNavigate("/contact")}
      />
      <section className="docs-layout">
        <aside className="docs-sidebar">
          <strong>API Guide</strong>
          {DOC_NAV.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.label}
            </a>
          ))}
        </aside>
        <div className="docs-content">
          <DocsSection
            id="overview"
            title="Overview"
            body="The SmartLink API is a mock public guide for how partners will access station availability, queue state, telemetry, and forecast-ready fuel infrastructure data."
          >
            <div className="docs-callout">
              This page documents the intended public interface. It is not wired
              to production credentials yet.
            </div>
          </DocsSection>

          <DocsSection
            id="authentication"
            title="Authentication"
            body="Send an API key in the Authorization header. Use scoped keys for station, partner, or regulator access."
          >
            <CodeBlock
              code={`Authorization: Bearer sk_live_smartlink_example
Content-Type: application/json`}
            />
          </DocsSection>

          <DocsSection
            id="base-url"
            title="Base URL"
            body="Version every request under the v1 namespace."
          >
            <CodeBlock code="https://api.smartlink.mw/v1" />
          </DocsSection>

          <DocsSection
            id="stations"
            title="Stations"
            body="Fetch station status, pump readiness, fuel availability, and queue pressure."
          >
            <CodeBlock
              code={`GET /v1/stations/SL-BT-0042/status

{
  "station_id": "SL-BT-0042",
  "name": "SmartLink Blantyre Pilot",
  "status": "OPEN",
  "fuel": {
    "petrol": { "available": true, "level_percent": 68.4 },
    "diesel": { "available": true, "level_percent": 52.1 }
  },
  "queue_depth": 12,
  "estimated_wait_minutes": 23
}`}
            />
          </DocsSection>

          <DocsSection
            id="queues"
            title="Queues"
            body="Create, inspect, and update queue entries for driver and fleet workflows."
          >
            <CodeBlock
              code={`POST /v1/queues

{
  "station_id": "SL-BT-0042",
  "fuel_type": "PETROL",
  "requested_liters": 35,
  "identifier": "masked-plate-or-fleet-id"
}`}
            />
          </DocsSection>

          <DocsSection
            id="webhooks"
            title="Webhooks and Realtime"
            body="Subscribe to queue movement, station status changes, and delivery updates."
          >
            <CodeBlock
              code={`wss://api.smartlink.mw/v1/events

{
  "type": "queue.moved",
  "station_id": "SL-BT-0042",
  "queue_id": "q_9r4...",
  "position": 4,
  "eta_minutes": 16
}`}
            />
          </DocsSection>

          <DocsSection
            id="errors"
            title="Errors"
            body="Errors return a stable code, human-readable message, and request identifier."
          >
            <CodeBlock
              code={`{
  "error": {
    "code": "station_unavailable",
    "message": "The selected station is not accepting queue entries.",
    "request_id": "req_01HY..."
  }
}`}
            />
          </DocsSection>

          <DocsSection
            id="limits"
            title="Rate Limits"
            body="Mock defaults are 600 requests per minute per key, with higher limits for partner and regulator contracts."
          >
            <div className="docs-table">
              <span>Header</span>
              <strong>X-RateLimit-Limit</strong>
              <span>Remaining</span>
              <strong>X-RateLimit-Remaining</strong>
              <span>Reset</span>
              <strong>X-RateLimit-Reset</strong>
            </div>
          </DocsSection>
        </div>
      </section>
    </>
  );
}

function DocsSection({ id, title, body, children }) {
  return (
    <article id={id} className="docs-section">
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </article>
  );
}

function InvestorsPage({ onNavigate }) {
  return (
    <>
      <PageHero
        eyebrow="Investors"
        title="The infrastructure layer beneath Africa's fuel movement."
        body="SmartLink sits at the intersection of fuel retail, realtime coordination, payments context, regulatory data, and supplier intelligence."
        primary="Contact Investors"
        secondary="View Platform"
        onPrimary={() => onNavigate("/contact")}
        onSecondary={() => onNavigate("/platform")}
      />
      <InvestorsBand onNavigate={onNavigate} />
      <section className="marketing-section">
        <div className="investor-thesis">
          {[
            ["Market urgency", "Fuel availability affects public mobility, commerce, and trust in essential services."],
            ["Data advantage", "Station, queue, delivery, and driver signals become more valuable as coverage grows."],
            ["Expansion path", "The same coordination layer can expand from Malawi into regional fuel corridors."],
          ].map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ContactPage({ loginPath, onNavigate }) {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to SmartLink about stations, partnerships, API access, or investment."
        body="Send a note to the right team and we will route it to operations, platform, partnerships, or investor relations."
        primary="Request Access"
        secondary="Read Docs"
        onPrimary={() => onNavigate(loginPath)}
        onSecondary={() => onNavigate("/docs")}
      />
      <section className="marketing-section contact-grid">
        <article>
          <span>Partnerships</span>
          <h3>Station and supplier onboarding</h3>
          <p>
            For station networks, fleet operators, suppliers, and infrastructure
            partners preparing to coordinate live fuel movement.
          </p>
          <a href="mailto:partners@smartlink.mw">partners@smartlink.mw</a>
        </article>
        <article>
          <span>Developers</span>
          <h3>API and integration access</h3>
          <p>
            For teams building with station status, queue events, forecasts, and
            operational reporting.
          </p>
          <a href="mailto:developers@smartlink.mw">developers@smartlink.mw</a>
        </article>
        <article>
          <span>Investors</span>
          <h3>Investor relations</h3>
          <p>
            For investors interested in SmartLink's fuel infrastructure
            coordination layer.
          </p>
          <a href="mailto:investors@smartlink.mw">investors@smartlink.mw</a>
        </article>
      </section>
    </>
  );
}

function FooterDetailPage({ detail, loginPath, onNavigate }) {
  return (
    <>
      <PageHero
        eyebrow={detail.eyebrow}
        title={detail.title}
        body={detail.body}
        primary={detail.primary}
        secondary={detail.secondary}
        onPrimary={() => onNavigate(detail.primaryPath || loginPath)}
        onSecondary={() => onNavigate(detail.secondaryPath)}
      />
      <section className="marketing-section">
        <div className="platform-page-grid">
          {detail.sections.map(([title, body]) => (
            <article key={title} className="platform-page-card">
              <span>{title.charAt(0)}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section band">
        <SectionHeading
          eyebrow="How it works"
          title={`${detail.eyebrow} workflow`}
          body="A compact operating view for the page you selected from the footer."
        />
        <div className="timeline-grid compact">
          {detail.flow.map((item, index) => (
            <article key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-section">
        <div className="join-team-cta">
          <h2>Want this connected to your operation?</h2>
          <p>
            SmartLink can shape the right access path for stations, suppliers,
            developers, fleet partners, and public-sector teams.
          </p>
          <button
            type="button"
            className="marketing-btn primary"
            onClick={() => onNavigate("/contact")}
          >
            Contact SmartLink
          </button>
        </div>
      </section>
    </>
  );
}

function PageHero({
  eyebrow,
  title,
  body,
  primary,
  secondary,
  onPrimary,
  onSecondary,
}) {
  return (
    <section className="page-hero">
      <p className="hero-eyebrow">
        <span />
        {eyebrow}
      </p>
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="marketing-actions">
        <button type="button" className="marketing-btn hero" onClick={onPrimary}>
          {primary}
          <ArrowIcon />
        </button>
        <button
          type="button"
          className="marketing-btn ghost page"
          onClick={onSecondary}
        >
          {secondary}
        </button>
      </div>
    </section>
  );
}

function Footer({ onNavigate }) {
  return (
    <footer className="marketing-footer">
      <div className="footer-grid">
        <div>
          <MarketingLink
            to="/"
            onNavigate={onNavigate}
            className="footer-brand"
          >
            <Logo />
          </MarketingLink>
          <p>
            Africa's fuel infrastructure coordination platform. Real-time
            intelligence from tank to driver, built in Malawi for the continent.
          </p>
          <div className="footer-social">
            <a href="mailto:hello@smartlink.mw">mail</a>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">
              in
            </a>
            <a href="https://github.com" target="_blank" rel="noreferrer">
              gh
            </a>
          </div>
        </div>
        <FooterColumn
          title="Platform"
          links={[
            ["Station Manager", "/station-manager"],
            ["Driver App", "/driver-app"],
            ["Analytics Suite", "/analytics-suite"],
            ["Supplier Portal", "/supplier-portal"],
          ]}
          onNavigate={onNavigate}
        />
        <FooterColumn
          title="Developers"
          links={[
            ["API Reference", "/developers/api-reference"],
            ["WebSocket Guide", "/websocket-guide"],
            ["Status Page", "/status"],
            ["Changelog", "/changelog"],
          ]}
          onNavigate={onNavigate}
        />
        <FooterColumn
          title="Company"
          links={[
            ["About", "/about"],
            ["Investors", "/investors"],
            ["Contact", "/contact"],
            ["Careers", "/careers"],
          ]}
          onNavigate={onNavigate}
        />
      </div>
      <div className="footer-bottom">
        <span>2026 SmartLink Technologies Ltd. Registered in Malawi.</span>
        <div>
          <span>MERA Ready</span>
          <span>API First</span>
          <span>Audit Grade</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links, onNavigate }) {
  return (
    <div>
      <h3>{title}</h3>
      {links.map(([label, to]) => (
        <MarketingLink key={label} to={to} onNavigate={onNavigate}>
          {label}
        </MarketingLink>
      ))}
    </div>
  );
}

export function PublicMarketingSite({
  currentPath,
  onNavigate,
  loginPath,
}) {
  const normalizedPath = currentPath === "/landing" ? "/" : currentPath;
  const page = useMemo(() => {
    if (normalizedPath === "/platform") {
      return (
        <PlatformPage onNavigate={onNavigate} loginPath={loginPath} />
      );
    }
    if (normalizedPath === "/about") {
      return <AboutPage onNavigate={onNavigate} />;
    }
    if (normalizedPath === "/docs") {
      return <DocsPage onNavigate={onNavigate} loginPath={loginPath} />;
    }
    if (normalizedPath === "/investors") {
      return <InvestorsPage onNavigate={onNavigate} />;
    }
    if (normalizedPath === "/contact") {
      return <ContactPage onNavigate={onNavigate} loginPath={loginPath} />;
    }
    if (FOOTER_DETAIL_PAGES[normalizedPath]) {
      return (
        <FooterDetailPage
          detail={FOOTER_DETAIL_PAGES[normalizedPath]}
          onNavigate={onNavigate}
          loginPath={loginPath}
        />
      );
    }
    return <LandingPage onNavigate={onNavigate} loginPath={loginPath} />;
  }, [loginPath, normalizedPath, onNavigate]);

  useEffect(() => {
    const titleMap = {
      "/": "SmartLink - Fuel Infrastructure Intelligence",
      "/platform": "Platform | SmartLink",
      "/about": "About | SmartLink",
      "/docs": "API Guide | SmartLink",
      "/investors": "Investors | SmartLink",
      "/contact": "Contact | SmartLink",
      ...Object.fromEntries(
        Object.entries(FOOTER_DETAIL_PAGES).map(([path, detail]) => [
          path,
          `${detail.eyebrow} | SmartLink`,
        ]),
      ),
    };
    document.title = titleMap[normalizedPath] || titleMap["/"];
  }, [normalizedPath]);

  return (
    <MarketingShell
      currentPath={normalizedPath}
      onNavigate={onNavigate}
      loginPath={loginPath}
    >
      {page}
    </MarketingShell>
  );
}

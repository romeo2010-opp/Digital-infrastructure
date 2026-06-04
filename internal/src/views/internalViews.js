export const INTERNAL_VIEW_STORAGE_KEY = "smartlink.internal.dashboardViews"
export const INTERNAL_VIEW_CHANGE_EVENT = "smartlink:internal-dashboard-views-changed"
export const INTERNAL_VIEW_BUILDER_EVENT = "smartlink:internal-dashboard-open-builder"
export const INTERNAL_MAX_CUSTOM_VIEWS = 10
export const INTERNAL_MAX_BLOCKS_PER_VIEW = 12

export const internalViewColorPresets = {
  slate: { label: "Slate", accent: "#111827" },
  blue: { label: "Blue", accent: "#2563eb" },
  green: { label: "Green", accent: "#10b981" },
  amber: { label: "Amber", accent: "#f59e0b" },
  red: { label: "Red", accent: "#ef4444" },
  teal: { label: "Teal", accent: "#0f766e" },
}

export const internalViewBlockLibrary = [
  {
    type: "overview-kpis",
    title: "Overview KPI Cards",
    description: "Core internal health, activity, workload, and command-centre counters.",
    size: "wide",
    displayMode: "metric",
    modes: ["metric"],
    colorPreset: "slate",
  },
  {
    type: "network-incidents",
    title: "Network Incidents",
    description: "Live station state, offline pumps, telemetry gaps, and open operational incidents.",
    size: "wide",
    displayMode: "table",
    modes: ["metric", "table"],
    colorPreset: "blue",
  },
  {
    type: "station-summary",
    title: "Station Summary",
    description: "Station registry counts, subscription state, activation, and onboarding posture.",
    size: "medium",
    displayMode: "table",
    modes: ["metric", "table"],
    colorPreset: "green",
  },
  {
    type: "field-operations",
    title: "Field Operations",
    description: "Scheduled, active, blocked, and completed field setup or inspection work.",
    size: "medium",
    displayMode: "table",
    modes: ["metric", "table"],
    colorPreset: "teal",
  },
  {
    type: "support-queue",
    title: "Support Queue",
    description: "Open support, escalations, refunds, failed-payment issues, and response signals.",
    size: "medium",
    displayMode: "list",
    modes: ["metric", "list", "table"],
    colorPreset: "amber",
  },
  {
    type: "finance-watch",
    title: "Finance Watch",
    description: "Settlements, reconciliation, refund, wallet, and billing operational indicators.",
    size: "medium",
    displayMode: "table",
    modes: ["metric", "table"],
    colorPreset: "green",
  },
  {
    type: "risk-watch",
    title: "Risk Watch",
    description: "Fraud, compliance, suspicious transaction, and manual review signals.",
    size: "medium",
    displayMode: "table",
    modes: ["metric", "list", "table"],
    colorPreset: "red",
  },
  {
    type: "system-health",
    title: "System Health",
    description: "Service posture, degraded components, bug notes, and recent platform events.",
    size: "medium",
    displayMode: "list",
    modes: ["metric", "list", "table"],
    colorPreset: "slate",
  },
]

export const internalBuiltinTabs = [
  { id: "builtin-my-view", label: "My View", kind: "builtin", path: "/", locked: true, navigationKeys: ["overview"] },
  { id: "builtin-operations", label: "Operations", kind: "builtin", path: "/views/builtin-operations", locked: true, navigationKeys: ["networkOperations", "fieldOperations", "stations"] },
  { id: "builtin-station-command", label: "Stations", kind: "builtin", path: "/views/builtin-station-command", locked: true, navigationKeys: ["stations", "fieldOperations"] },
  { id: "builtin-support", label: "Support", kind: "builtin", path: "/views/builtin-support", locked: true, navigationKeys: ["support"] },
  { id: "builtin-finance", label: "Finance", kind: "builtin", path: "/views/builtin-finance", locked: true, navigationKeys: ["finance", "walletOperations"] },
  { id: "builtin-risk", label: "Risk", kind: "builtin", path: "/views/builtin-risk", locked: true, navigationKeys: ["risk"] },
  { id: "builtin-system-health", label: "System", kind: "builtin", path: "/views/builtin-system-health", locked: true, navigationKeys: ["systemHealth"] },
  { id: "builtin-views", label: "Views", kind: "builtin", path: "/views", locked: true },
]

function nowIso() {
  return new Date().toISOString()
}

export function createInternalViewId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function uniqueInternalViewLabel(base, existingLabels = []) {
  const cleaned = String(base || "").trim() || "Custom View"
  if (!existingLabels.some((label) => String(label || "").toLowerCase() === cleaned.toLowerCase())) return cleaned
  let index = 2
  while (existingLabels.some((label) => String(label || "").toLowerCase() === `${cleaned} ${index}`.toLowerCase())) {
    index += 1
  }
  return `${cleaned} ${index}`
}

function validColorPreset(value, fallback = "slate") {
  return Object.prototype.hasOwnProperty.call(internalViewColorPresets, value) ? value : fallback
}

function blockTemplateFor(value) {
  return internalViewBlockLibrary.find((item) => item.type === value) || null
}

export function defaultInternalBlocks() {
  return ["overview-kpis", "network-incidents", "station-summary"].map((type) => {
    const template = blockTemplateFor(type)
    return {
      id: createInternalViewId("block"),
      type: template.type,
      title: template.title,
      size: template.size,
      displayMode: template.displayMode,
      colorPreset: template.colorPreset,
    }
  })
}

export function normalizeInternalViewBlock(input) {
  const rawType = typeof input === "string" ? input : input?.type || input?.id
  const template = blockTemplateFor(rawType)
  if (!template) return null
  const modes = template.modes || [template.displayMode]
  const size = ["small", "medium", "wide"].includes(input?.size) ? input.size : template.size
  const displayMode = modes.includes(input?.displayMode) ? input.displayMode : template.displayMode
  return {
    id: String(input?.id || createInternalViewId("block")),
    type: template.type,
    title: String(input?.title || input?.label || template.title),
    size,
    displayMode,
    colorPreset: validColorPreset(input?.colorPreset || input?.accent, template.colorPreset),
  }
}

export function normalizeInternalCustomView(input) {
  const label = String(input?.label || "").trim()
  if (!label) return null
  const blocks = Array.isArray(input?.blocks)
    ? input.blocks.map(normalizeInternalViewBlock).filter(Boolean).slice(0, INTERNAL_MAX_BLOCKS_PER_VIEW)
    : defaultInternalBlocks()
  const createdAt = String(input?.createdAt || nowIso())
  return {
    id: String(input?.id || createInternalViewId("view")),
    kind: "custom",
    label,
    subtitle: String(input?.subtitle || "Custom Internal overview."),
    colorPreset: validColorPreset(input?.colorPreset || input?.accent, "slate"),
    blocks: blocks.length ? blocks : defaultInternalBlocks(),
    createdAt,
    updatedAt: String(input?.updatedAt || createdAt),
  }
}

export function readInternalViewState() {
  if (typeof window === "undefined") return { customViews: [], pinnedTabIds: [] }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTERNAL_VIEW_STORAGE_KEY) || "{}")
    const customSource = Array.isArray(parsed) ? parsed : parsed.customViews
    const pinnedSource = Array.isArray(parsed?.pinnedTabIds) ? parsed.pinnedTabIds : []
    return {
      customViews: Array.isArray(customSource)
        ? customSource.map(normalizeInternalCustomView).filter(Boolean).slice(0, INTERNAL_MAX_CUSTOM_VIEWS)
        : [],
      pinnedTabIds: pinnedSource.map(String),
    }
  } catch {
    return { customViews: [], pinnedTabIds: [] }
  }
}

export function saveInternalViewState(state) {
  if (typeof window === "undefined") return { customViews: [], pinnedTabIds: [] }
  const nextState = {
    customViews: Array.isArray(state?.customViews)
      ? state.customViews.map(normalizeInternalCustomView).filter(Boolean).slice(0, INTERNAL_MAX_CUSTOM_VIEWS)
      : [],
    pinnedTabIds: Array.isArray(state?.pinnedTabIds) ? state.pinnedTabIds.map(String) : [],
  }
  window.localStorage.setItem(INTERNAL_VIEW_STORAGE_KEY, JSON.stringify(nextState))
  window.dispatchEvent(new CustomEvent(INTERNAL_VIEW_CHANGE_EVENT, { detail: nextState }))
  return nextState
}

export function createInternalViewDraft(existingLabels = []) {
  const timestamp = nowIso()
  return {
    id: createInternalViewId("view"),
    kind: "custom",
    label: uniqueInternalViewLabel("Area Overview", existingLabels),
    subtitle: "Custom internal command view for the selected operating area.",
    colorPreset: "slate",
    blocks: defaultInternalBlocks(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function cloneInternalBlocks(blocks = []) {
  const normalized = blocks.map(normalizeInternalViewBlock).filter(Boolean)
  return (normalized.length ? normalized : defaultInternalBlocks()).map((block) => ({
    ...block,
    id: createInternalViewId("block"),
  }))
}

const internalBuiltinViewTemplates = {
  "builtin-my-view": {
    id: "builtin-my-view",
    label: "My View",
    subtitle: "Locked default overview for the signed-in internal operator.",
    colorPreset: "slate",
    blocks: defaultInternalBlocks(),
  },
  "builtin-operations": {
    id: "builtin-operations",
    label: "Operations",
    subtitle: "Locked default command view for station state, field execution, and operational incidents.",
    colorPreset: "blue",
    blocks: [
      { id: "operations-network", type: "network-incidents", title: "Network Incidents", size: "wide", displayMode: "table", colorPreset: "blue" },
      { id: "operations-field", type: "field-operations", title: "Field Operations", size: "medium", displayMode: "table", colorPreset: "teal" },
      { id: "operations-stations", type: "station-summary", title: "Station Summary", size: "medium", displayMode: "table", colorPreset: "green" },
      { id: "operations-health", type: "system-health", title: "System Health", size: "medium", displayMode: "list", colorPreset: "slate" },
    ],
  },
  "builtin-station-command": {
    id: "builtin-station-command",
    label: "Stations",
    subtitle: "Locked default station command view for registry, activation, and field readiness.",
    colorPreset: "green",
    blocks: [
      { id: "stations-summary", type: "station-summary", title: "Station Registry", size: "wide", displayMode: "table", colorPreset: "green" },
      { id: "stations-network", type: "network-incidents", title: "Live Station State", size: "medium", displayMode: "table", colorPreset: "blue" },
      { id: "stations-field", type: "field-operations", title: "Field Readiness", size: "medium", displayMode: "table", colorPreset: "teal" },
      { id: "stations-support", type: "support-queue", title: "Station Support", size: "medium", displayMode: "list", colorPreset: "amber" },
    ],
  },
  "builtin-support": {
    id: "builtin-support",
    label: "Support",
    subtitle: "Locked default support view for open cases, escalations, payment issues, and refund work.",
    colorPreset: "amber",
    blocks: [
      { id: "support-open", type: "support-queue", title: "Support Queue", size: "wide", displayMode: "list", colorPreset: "amber" },
      { id: "support-risk", type: "risk-watch", title: "Risk Links", size: "medium", displayMode: "table", colorPreset: "red" },
      { id: "support-finance", type: "finance-watch", title: "Refund Finance", size: "medium", displayMode: "table", colorPreset: "green" },
    ],
  },
  "builtin-finance": {
    id: "builtin-finance",
    label: "Finance",
    subtitle: "Locked default finance command view for settlement, refunds, reconciliation, and review exposure.",
    colorPreset: "green",
    blocks: [
      { id: "finance-settlements", type: "finance-watch", title: "Finance Watch", size: "wide", displayMode: "table", colorPreset: "green" },
      { id: "finance-support", type: "support-queue", title: "Refund Queue", size: "medium", displayMode: "list", colorPreset: "amber" },
      { id: "finance-risk", type: "risk-watch", title: "Financial Risk", size: "medium", displayMode: "table", colorPreset: "red" },
    ],
  },
  "builtin-risk": {
    id: "builtin-risk",
    label: "Risk",
    subtitle: "Locked default risk and compliance view for suspicious activity, cases, and system evidence.",
    colorPreset: "red",
    blocks: [
      { id: "risk-cases", type: "risk-watch", title: "Risk Watch", size: "wide", displayMode: "table", colorPreset: "red" },
      { id: "risk-finance", type: "finance-watch", title: "Finance Exposure", size: "medium", displayMode: "table", colorPreset: "green" },
      { id: "risk-support", type: "support-queue", title: "Escalated Support", size: "medium", displayMode: "list", colorPreset: "amber" },
      { id: "risk-health", type: "system-health", title: "Evidence Health", size: "medium", displayMode: "list", colorPreset: "slate" },
    ],
  },
  "builtin-system-health": {
    id: "builtin-system-health",
    label: "System",
    subtitle: "Locked default system view for platform health, telemetry posture, and operational reliability.",
    colorPreset: "slate",
    blocks: [
      { id: "system-health-events", type: "system-health", title: "System Health", size: "wide", displayMode: "list", colorPreset: "slate" },
      { id: "system-network", type: "network-incidents", title: "Telemetry Impact", size: "medium", displayMode: "table", colorPreset: "blue" },
      { id: "system-overview", type: "overview-kpis", title: "Workspace Signal", size: "medium", displayMode: "metric", colorPreset: "slate" },
    ],
  },
}

export function internalBuiltinViewFor(id) {
  const template = internalBuiltinViewTemplates[id]
  if (!template) return null
  const tab = internalBuiltinTabs.find((item) => item.id === id)
  return {
    ...template,
    kind: "builtin",
    locked: true,
    path: tab?.path || `/views/${template.id}`,
    blocks: template.blocks.map(normalizeInternalViewBlock).filter(Boolean),
    createdAt: "",
    updatedAt: "",
  }
}

export function getVisibleInternalBuiltinTabs(navigation = []) {
  const allowed = new Set(Array.isArray(navigation) ? navigation : [])
  return internalBuiltinTabs.filter((tab) => {
    if (!tab.navigationKeys?.length) return true
    return tab.navigationKeys.some((key) => allowed.has(key))
  })
}

export function getVisibleInternalBuiltinViews(navigation = []) {
  return getVisibleInternalBuiltinTabs(navigation)
    .filter((tab) => tab.id !== "builtin-views")
    .map((tab) => internalBuiltinViewFor(tab.id))
    .filter(Boolean)
}

export function pathForInternalView(view) {
  if (!view) return "/views"
  if (view.path) return view.path
  return `/views/${view.id}`
}

export const MERA_ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  NATIONAL_OPERATIONS_ANALYST: "NATIONAL_OPERATIONS_ANALYST",
  REGIONAL_COMPLIANCE_SUPERVISOR: "REGIONAL_COMPLIANCE_SUPERVISOR",
  FIELD_COMPLIANCE_OFFICER: "FIELD_COMPLIANCE_OFFICER",
  PUBLIC_COMPLAINTS_ANALYST: "PUBLIC_COMPLAINTS_ANALYST",
  LEGAL_ENFORCEMENT_OFFICER: "LEGAL_ENFORCEMENT_OFFICER",
  LICENSING_OFFICER: "LICENSING_OFFICER",
  MARKET_SUPPLY_ANALYST: "MARKET_SUPPLY_ANALYST",
  EXECUTIVE_VIEWER: "EXECUTIVE_VIEWER",
})

export const MERA_ROLE_METADATA = Object.freeze({
  [MERA_ROLES.SUPER_ADMIN]: {
    displayName: "Super Admin / Director",
    description: "Highest system authority with full regulatory oversight.",
  },
  [MERA_ROLES.NATIONAL_OPERATIONS_ANALYST]: {
    displayName: "National Operations Analyst",
    description: "National petroleum intelligence monitoring and reporting.",
  },
  [MERA_ROLES.REGIONAL_COMPLIANCE_SUPERVISOR]: {
    displayName: "Regional Compliance Supervisor",
    description: "District and regional compliance command supervision.",
  },
  [MERA_ROLES.FIELD_COMPLIANCE_OFFICER]: {
    displayName: "Field Compliance Officer",
    description: "On-ground inspection, evidence capture, and reporting.",
  },
  [MERA_ROLES.PUBLIC_COMPLAINTS_ANALYST]: {
    displayName: "Public Complaints Analyst",
    description: "Complaint triage, verification, and inspection referral.",
  },
  [MERA_ROLES.LEGAL_ENFORCEMENT_OFFICER]: {
    displayName: "Legal & Enforcement Officer",
    description: "Formal legal enforcement action management.",
  },
  [MERA_ROLES.LICENSING_OFFICER]: {
    displayName: "Licensing Officer",
    description: "Station licensing and compliance-condition management.",
  },
  [MERA_ROLES.MARKET_SUPPLY_ANALYST]: {
    displayName: "Market / Fuel Supply Analyst",
    description: "Fuel availability, delivery, pricing, and hoarding analysis.",
  },
  [MERA_ROLES.EXECUTIVE_VIEWER]: {
    displayName: "Executive Viewer",
    description: "Senior read-only oversight across national operations.",
  },
})

export const MERA_PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW_NATIONAL: "DASHBOARD_VIEW_NATIONAL",
  DASHBOARD_VIEW_DISTRICT: "DASHBOARD_VIEW_DISTRICT",
  HEATMAP_VIEW: "HEATMAP_VIEW",
  HEATMAP_EXPORT: "HEATMAP_EXPORT",
  REPORTS_VIEW: "REPORTS_VIEW",
  REPORTS_EXPORT: "REPORTS_EXPORT",
  REPORTS_GENERATE: "REPORTS_GENERATE",
  USERS_VIEW: "USERS_VIEW",
  USERS_CREATE: "USERS_CREATE",
  USERS_UPDATE: "USERS_UPDATE",
  USERS_DISABLE: "USERS_DISABLE",
  ROLES_MANAGE: "ROLES_MANAGE",
  COMPLAINTS_VIEW: "COMPLAINTS_VIEW",
  COMPLAINTS_TRIAGE: "COMPLAINTS_TRIAGE",
  COMPLAINTS_ASSIGN: "COMPLAINTS_ASSIGN",
  COMPLAINTS_ESCALATE: "COMPLAINTS_ESCALATE",
  COMPLAINTS_CLOSE: "COMPLAINTS_CLOSE",
  INSPECTIONS_VIEW: "INSPECTIONS_VIEW",
  INSPECTIONS_ASSIGN: "INSPECTIONS_ASSIGN",
  INSPECTIONS_CREATE: "INSPECTIONS_CREATE",
  INSPECTIONS_REVIEW: "INSPECTIONS_REVIEW",
  EVIDENCE_UPLOAD: "EVIDENCE_UPLOAD",
  FLAGS_VIEW: "FLAGS_VIEW",
  FLAGS_CREATE: "FLAGS_CREATE",
  FLAGS_ASSIGN: "FLAGS_ASSIGN",
  FLAGS_RESOLVE: "FLAGS_RESOLVE",
  FLAGS_ESCALATE: "FLAGS_ESCALATE",
  ENFORCEMENT_VIEW: "ENFORCEMENT_VIEW",
  ENFORCEMENT_CREATE_WARNING: "ENFORCEMENT_CREATE_WARNING",
  ENFORCEMENT_CREATE_FINE: "ENFORCEMENT_CREATE_FINE",
  ENFORCEMENT_CREATE_SUSPENSION: "ENFORCEMENT_CREATE_SUSPENSION",
  ENFORCEMENT_UPDATE_STATUS: "ENFORCEMENT_UPDATE_STATUS",
  ENFORCEMENT_APPROVE: "ENFORCEMENT_APPROVE",
  LICENSES_VIEW: "LICENSES_VIEW",
  LICENSES_CREATE: "LICENSES_CREATE",
  LICENSES_UPDATE: "LICENSES_UPDATE",
  LICENSES_EXPIRE_REVIEW: "LICENSES_EXPIRE_REVIEW",
  DELIVERIES_VIEW: "DELIVERIES_VIEW",
  DELIVERIES_CREATE: "DELIVERIES_CREATE",
  DELIVERIES_VERIFY: "DELIVERIES_VERIFY",
  AVAILABILITY_VIEW: "AVAILABILITY_VIEW",
  AVAILABILITY_AUDIT: "AVAILABILITY_AUDIT",
  AVAILABILITY_LOG: "AVAILABILITY_LOG",
  STATIONS_VIEW: "STATIONS_VIEW",
  STATIONS_VIEW_DISTRICT: "STATIONS_VIEW_DISTRICT",
  STATIONS_UPDATE_REGULATORY_PROFILE: "STATIONS_UPDATE_REGULATORY_PROFILE",
  AUDIT_VIEW: "AUDIT_VIEW",
  TASKS_VIEW_ASSIGNED: "TASKS_VIEW_ASSIGNED",
  TASKS_VIEW_ALL: "TASKS_VIEW_ALL",
  TASKS_VIEW_EXECUTIVE: "TASKS_VIEW_EXECUTIVE",
  TASKS_CREATE: "TASKS_CREATE",
  TASKS_ASSIGN: "TASKS_ASSIGN",
  TASKS_MANAGE: "TASKS_MANAGE",
  TASKS_WORK: "TASKS_WORK",
  TASKS_ADD_EVIDENCE: "TASKS_ADD_EVIDENCE",
  TASKS_STATS_VIEW: "TASKS_STATS_VIEW",
})

export const MERA_ROLE_SET = new Set(Object.values(MERA_ROLES))
export const MERA_PERMISSION_SET = new Set(Object.values(MERA_PERMISSIONS))

export const MERA_GLOBAL_SCOPE_ROLES = new Set([
  MERA_ROLES.SUPER_ADMIN,
  MERA_ROLES.NATIONAL_OPERATIONS_ANALYST,
  MERA_ROLES.EXECUTIVE_VIEWER,
  MERA_ROLES.MARKET_SUPPLY_ANALYST,
  MERA_ROLES.LICENSING_OFFICER,
  MERA_ROLES.LEGAL_ENFORCEMENT_OFFICER,
])

export function normalizeRoleList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item, index, array) => item && array.indexOf(item) === index && MERA_ROLE_SET.has(item))
}

export function normalizePermissionList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item, index, array) => item && array.indexOf(item) === index && MERA_PERMISSION_SET.has(item))
}

export function hasMeraPermission(auth, permissionCode) {
  const scopedPermission = String(permissionCode || "").trim().toUpperCase()
  if (!scopedPermission) return false
  return normalizePermissionList(auth?.permissions).includes(scopedPermission)
}

export function isDistrictScopedMeraUser(auth) {
  if (!auth?.role) return false
  if (MERA_GLOBAL_SCOPE_ROLES.has(String(auth.role).trim().toUpperCase())) return false
  return Boolean(String(auth?.districtScope || "").trim())
}

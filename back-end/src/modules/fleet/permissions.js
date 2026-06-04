export const FLEET_ROLES = Object.freeze({
  OWNER: "owner",
  ADMIN: "admin",
  FINANCE: "finance",
  DISPATCHER: "dispatcher",
  DRIVER: "driver",
  AUDITOR: "auditor",
})

export const FLEET_MEMBER_STATUSES = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REMOVED: "removed",
})

export const FLEET_ACCOUNT_STATUSES = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
})

export const FLEET_PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: "dashboard:view",
  MEMBERS_MANAGE: "members:manage",
  DEPARTMENTS_MANAGE: "departments:manage",
  VEHICLES_MANAGE: "vehicles:manage",
  ASSIGNMENTS_MANAGE: "assignments:manage",
  ALLOCATIONS_VIEW: "allocations:view",
  ALLOCATIONS_MANAGE: "allocations:manage",
  WALLET_VIEW: "wallet:view",
  WALLET_MANAGE: "wallet:manage",
  REQUESTS_VIEW: "requests:view",
  REQUESTS_APPROVE: "requests:approve",
  FUEL_NOW_COMPLETE: "fuel-now:complete",
  FUEL_CARDS_VIEW: "fuel-cards:view",
  FUEL_CARDS_MANAGE: "fuel-cards:manage",
  TRANSACTIONS_VIEW: "transactions:view",
  TRANSACTIONS_CREATE: "transactions:create",
  POLICIES_MANAGE: "policies:manage",
  REPORTS_VIEW: "reports:view",
  ALERTS_MANAGE: "alerts:manage",
  SETTINGS_MANAGE: "settings:manage",
  AUDIT_VIEW: "audit:view",
  DRIVER_MODE: "driver:mode",
})

const ROLE_PERMISSION_MAP = Object.freeze({
  [FLEET_ROLES.OWNER]: new Set(Object.values(FLEET_PERMISSIONS)),
  [FLEET_ROLES.ADMIN]: new Set([
    FLEET_PERMISSIONS.DASHBOARD_VIEW,
    FLEET_PERMISSIONS.MEMBERS_MANAGE,
    FLEET_PERMISSIONS.DEPARTMENTS_MANAGE,
    FLEET_PERMISSIONS.VEHICLES_MANAGE,
    FLEET_PERMISSIONS.ASSIGNMENTS_MANAGE,
    FLEET_PERMISSIONS.ALLOCATIONS_VIEW,
    FLEET_PERMISSIONS.ALLOCATIONS_MANAGE,
    FLEET_PERMISSIONS.REQUESTS_VIEW,
    FLEET_PERMISSIONS.REQUESTS_APPROVE,
    FLEET_PERMISSIONS.FUEL_NOW_COMPLETE,
    FLEET_PERMISSIONS.FUEL_CARDS_VIEW,
    FLEET_PERMISSIONS.FUEL_CARDS_MANAGE,
    FLEET_PERMISSIONS.TRANSACTIONS_VIEW,
    FLEET_PERMISSIONS.TRANSACTIONS_CREATE,
    FLEET_PERMISSIONS.POLICIES_MANAGE,
    FLEET_PERMISSIONS.REPORTS_VIEW,
    FLEET_PERMISSIONS.ALERTS_MANAGE,
    FLEET_PERMISSIONS.SETTINGS_MANAGE,
    FLEET_PERMISSIONS.AUDIT_VIEW,
  ]),
  [FLEET_ROLES.FINANCE]: new Set([
    FLEET_PERMISSIONS.DASHBOARD_VIEW,
    FLEET_PERMISSIONS.WALLET_VIEW,
    FLEET_PERMISSIONS.WALLET_MANAGE,
    FLEET_PERMISSIONS.ALLOCATIONS_VIEW,
    FLEET_PERMISSIONS.ALLOCATIONS_MANAGE,
    FLEET_PERMISSIONS.FUEL_CARDS_VIEW,
    FLEET_PERMISSIONS.FUEL_CARDS_MANAGE,
    FLEET_PERMISSIONS.TRANSACTIONS_VIEW,
    FLEET_PERMISSIONS.REPORTS_VIEW,
    FLEET_PERMISSIONS.AUDIT_VIEW,
  ]),
  [FLEET_ROLES.DISPATCHER]: new Set([
    FLEET_PERMISSIONS.DASHBOARD_VIEW,
    FLEET_PERMISSIONS.DEPARTMENTS_MANAGE,
    FLEET_PERMISSIONS.VEHICLES_MANAGE,
    FLEET_PERMISSIONS.ASSIGNMENTS_MANAGE,
    FLEET_PERMISSIONS.ALLOCATIONS_VIEW,
    FLEET_PERMISSIONS.REQUESTS_VIEW,
    FLEET_PERMISSIONS.REQUESTS_APPROVE,
    FLEET_PERMISSIONS.FUEL_NOW_COMPLETE,
    FLEET_PERMISSIONS.FUEL_CARDS_VIEW,
    FLEET_PERMISSIONS.TRANSACTIONS_VIEW,
    FLEET_PERMISSIONS.TRANSACTIONS_CREATE,
    FLEET_PERMISSIONS.ALERTS_MANAGE,
  ]),
  [FLEET_ROLES.DRIVER]: new Set([
    FLEET_PERMISSIONS.DRIVER_MODE,
  ]),
  [FLEET_ROLES.AUDITOR]: new Set([
    FLEET_PERMISSIONS.DASHBOARD_VIEW,
    FLEET_PERMISSIONS.WALLET_VIEW,
    FLEET_PERMISSIONS.ALLOCATIONS_VIEW,
    FLEET_PERMISSIONS.FUEL_CARDS_VIEW,
    FLEET_PERMISSIONS.REQUESTS_VIEW,
    FLEET_PERMISSIONS.TRANSACTIONS_VIEW,
    FLEET_PERMISSIONS.REPORTS_VIEW,
    FLEET_PERMISSIONS.AUDIT_VIEW,
  ]),
})

const MANAGER_DASHBOARD_ROLES = new Set([
  FLEET_ROLES.OWNER,
  FLEET_ROLES.ADMIN,
  FLEET_ROLES.FINANCE,
  FLEET_ROLES.DISPATCHER,
  FLEET_ROLES.AUDITOR,
])

export function normalizeFleetRole(role) {
  const normalized = String(role || "").trim().toLowerCase()
  return Object.values(FLEET_ROLES).includes(normalized) ? normalized : ""
}

export function normalizeFleetStatus(status) {
  return String(status || "").trim().toLowerCase()
}

export function isFleetManagerRole(role) {
  return MANAGER_DASHBOARD_ROLES.has(normalizeFleetRole(role))
}

export function roleHasFleetPermission(role, permission) {
  const normalizedRole = normalizeFleetRole(role)
  const normalizedPermission = String(permission || "").trim()
  if (!normalizedRole || !normalizedPermission) return false
  return ROLE_PERMISSION_MAP[normalizedRole]?.has(normalizedPermission) || false
}

export function describeFleetRole(role) {
  switch (normalizeFleetRole(role)) {
    case FLEET_ROLES.OWNER:
      return "Owner"
    case FLEET_ROLES.ADMIN:
      return "Admin"
    case FLEET_ROLES.FINANCE:
      return "Finance"
    case FLEET_ROLES.DISPATCHER:
      return "Dispatcher"
    case FLEET_ROLES.DRIVER:
      return "Driver"
    case FLEET_ROLES.AUDITOR:
      return "Auditor"
    default:
      return "Fleet member"
  }
}

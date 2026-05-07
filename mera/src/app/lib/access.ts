export const MERA_PERMISSIONS = {
  DASHBOARD_VIEW_NATIONAL: 'DASHBOARD_VIEW_NATIONAL',
  DASHBOARD_VIEW_DISTRICT: 'DASHBOARD_VIEW_DISTRICT',
  HEATMAP_VIEW: 'HEATMAP_VIEW',
  HEATMAP_EXPORT: 'HEATMAP_EXPORT',
  REPORTS_VIEW: 'REPORTS_VIEW',
  REPORTS_EXPORT: 'REPORTS_EXPORT',
  REPORTS_GENERATE: 'REPORTS_GENERATE',
  USERS_VIEW: 'USERS_VIEW',
  USERS_CREATE: 'USERS_CREATE',
  USERS_UPDATE: 'USERS_UPDATE',
  USERS_DISABLE: 'USERS_DISABLE',
  ROLES_MANAGE: 'ROLES_MANAGE',
  COMPLAINTS_VIEW: 'COMPLAINTS_VIEW',
  COMPLAINTS_TRIAGE: 'COMPLAINTS_TRIAGE',
  COMPLAINTS_ASSIGN: 'COMPLAINTS_ASSIGN',
  COMPLAINTS_ESCALATE: 'COMPLAINTS_ESCALATE',
  COMPLAINTS_CLOSE: 'COMPLAINTS_CLOSE',
  INSPECTIONS_VIEW: 'INSPECTIONS_VIEW',
  INSPECTIONS_ASSIGN: 'INSPECTIONS_ASSIGN',
  INSPECTIONS_CREATE: 'INSPECTIONS_CREATE',
  INSPECTIONS_REVIEW: 'INSPECTIONS_REVIEW',
  EVIDENCE_UPLOAD: 'EVIDENCE_UPLOAD',
  FLAGS_VIEW: 'FLAGS_VIEW',
  FLAGS_CREATE: 'FLAGS_CREATE',
  FLAGS_ASSIGN: 'FLAGS_ASSIGN',
  FLAGS_RESOLVE: 'FLAGS_RESOLVE',
  FLAGS_ESCALATE: 'FLAGS_ESCALATE',
  ENFORCEMENT_VIEW: 'ENFORCEMENT_VIEW',
  ENFORCEMENT_CREATE_WARNING: 'ENFORCEMENT_CREATE_WARNING',
  ENFORCEMENT_CREATE_FINE: 'ENFORCEMENT_CREATE_FINE',
  ENFORCEMENT_CREATE_SUSPENSION: 'ENFORCEMENT_CREATE_SUSPENSION',
  ENFORCEMENT_UPDATE_STATUS: 'ENFORCEMENT_UPDATE_STATUS',
  ENFORCEMENT_APPROVE: 'ENFORCEMENT_APPROVE',
  LICENSES_VIEW: 'LICENSES_VIEW',
  LICENSES_CREATE: 'LICENSES_CREATE',
  LICENSES_UPDATE: 'LICENSES_UPDATE',
  LICENSES_EXPIRE_REVIEW: 'LICENSES_EXPIRE_REVIEW',
  DELIVERIES_VIEW: 'DELIVERIES_VIEW',
  DELIVERIES_CREATE: 'DELIVERIES_CREATE',
  DELIVERIES_VERIFY: 'DELIVERIES_VERIFY',
  AVAILABILITY_VIEW: 'AVAILABILITY_VIEW',
  AVAILABILITY_AUDIT: 'AVAILABILITY_AUDIT',
  AVAILABILITY_LOG: 'AVAILABILITY_LOG',
  STATIONS_VIEW: 'STATIONS_VIEW',
  STATIONS_VIEW_DISTRICT: 'STATIONS_VIEW_DISTRICT',
  STATIONS_UPDATE_REGULATORY_PROFILE: 'STATIONS_UPDATE_REGULATORY_PROFILE',
  AUDIT_VIEW: 'AUDIT_VIEW',
} as const

export type MeraPermission = (typeof MERA_PERMISSIONS)[keyof typeof MERA_PERMISSIONS]

function normalizePermissions(permissions: unknown) {
  if (!Array.isArray(permissions)) return []
  return permissions.map((permission) => String(permission || '').trim().toUpperCase()).filter(Boolean)
}

export function hasPermission(user: any, permission: MeraPermission) {
  return normalizePermissions(user?.permissions).includes(permission)
}

export function hasAnyPermission(user: any, permissions: MeraPermission[]) {
  return permissions.some((permission) => hasPermission(user, permission))
}

export function isReadOnlyExecutive(user: any) {
  return String(user?.role || '').trim().toUpperCase() === 'EXECUTIVE_VIEWER'
}

export const routePermissions = [
  {
    path: '/dashboard',
    permissions: [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT],
  },
  {
    path: '/national-heat-intelligence-map',
    permissions: [MERA_PERMISSIONS.HEATMAP_VIEW],
  },
  {
    path: '/hoarding-watchlist',
    permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT],
  },
  {
    path: '/fuel-deliveries',
    permissions: [MERA_PERMISSIONS.DELIVERIES_VIEW],
  },
  {
    path: '/availability-audit',
    permissions: [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT],
  },
  {
    path: '/complaints-center',
    permissions: [MERA_PERMISSIONS.COMPLAINTS_VIEW],
  },
  {
    path: '/compliance-flags',
    permissions: [MERA_PERMISSIONS.FLAGS_VIEW],
  },
  {
    path: '/field-inspections',
    permissions: [MERA_PERMISSIONS.INSPECTIONS_VIEW],
  },
  {
    path: '/enforcement-actions',
    permissions: [MERA_PERMISSIONS.ENFORCEMENT_VIEW],
  },
  {
    path: '/station-regulatory-profiles',
    permissions: [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT],
  },
  {
    path: '/license-registry',
    permissions: [MERA_PERMISSIONS.LICENSES_VIEW],
  },
  {
    path: '/reports-intelligence',
    permissions: [MERA_PERMISSIONS.REPORTS_VIEW],
  },
  {
    path: '/user-administration',
    permissions: [MERA_PERMISSIONS.USERS_VIEW],
  },
  {
    path: '/audit-trail',
    permissions: [MERA_PERMISSIONS.AUDIT_VIEW],
  },
]

export function canAccessPath(user: any, pathname: string) {
  const match = routePermissions
    .slice()
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname.startsWith(item.path))

  if (!match) return true
  return hasAnyPermission(user, match.permissions as MeraPermission[])
}

export function firstAccessiblePath(user: any) {
  return routePermissions.find((item) => hasAnyPermission(user, item.permissions as MeraPermission[]))?.path || null
}

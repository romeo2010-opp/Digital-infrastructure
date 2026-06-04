import { MERA_PERMISSIONS } from './access'

export const MERA_PACKET_KEYS = [
  'overview',
  'flaggedStations',
  'heatmap',
  'complaintMetrics',
  'inspectionMetrics',
  'demandForecastSummary',
  'nationalOperations',
  'opsPredictions',
  'tasks',
  'myTasks',
  'taskStats',
  'assignableUsers',
  'notifications',
  'hoardingWatchlist',
  'fuelDeliveryLogs',
  'availabilityReports',
  'complaints',
  'flags',
  'inspections',
  'enforcementActions',
  'profiles',
  'licenseRegistry',
  'expiryAlerts',
  'topComplaintStations',
  'districtShortages',
  'repeatedOffenders',
  'monthlyReports',
  'users',
  'auditLogs',
  'reports',
  'publicNotices',
  'priceCompliance',
  'analytics',
] as const

export type MeraPacketKey = (typeof MERA_PACKET_KEYS)[number]
export type MeraPacketStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'
export type MeraRealtimeMode = 'connecting' | 'websocket' | 'polling' | 'disabled'

const allPacketKeys = new Set<string>(MERA_PACKET_KEYS)

const packetPermissionGroups: Partial<Record<MeraPacketKey, readonly string[][]>> = {
  overview: [[MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_COMMAND_CENTRE]],
  flaggedStations: [[MERA_PERMISSIONS.FLAGS_VIEW]],
  heatmap: [[MERA_PERMISSIONS.HEATMAP_VIEW, MERA_PERMISSIONS.VIEW_MAP]],
  complaintMetrics: [[MERA_PERMISSIONS.COMPLAINTS_VIEW]],
  inspectionMetrics: [[MERA_PERMISSIONS.INSPECTIONS_VIEW]],
  demandForecastSummary: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  opsPredictions: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  nationalOperations: [[MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_COMMAND_CENTRE]],
  tasks: [[MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]],
  myTasks: [[MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK]],
  taskStats: [[MERA_PERMISSIONS.TASKS_STATS_VIEW, MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]],
  assignableUsers: [[MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_MANAGE]],
  notifications: [[MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]],
  hoardingWatchlist: [[MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT, MERA_PERMISSIONS.RISK_VIEW, MERA_PERMISSIONS.ALERTS_VIEW]],
  fuelDeliveryLogs: [[MERA_PERMISSIONS.DELIVERIES_VIEW]],
  availabilityReports: [[MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT]],
  complaints: [[MERA_PERMISSIONS.COMPLAINTS_VIEW]],
  flags: [[MERA_PERMISSIONS.FLAGS_VIEW]],
  inspections: [[MERA_PERMISSIONS.INSPECTIONS_VIEW, MERA_PERMISSIONS.ASSIGN_INSPECTIONS, MERA_PERMISSIONS.COMPLETE_INSPECTIONS]],
  enforcementActions: [[MERA_PERMISSIONS.ENFORCEMENT_VIEW]],
  profiles: [[MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT, MERA_PERMISSIONS.VIEW_STATION_PROFILE]],
  licenseRegistry: [[MERA_PERMISSIONS.LICENSES_VIEW]],
  expiryAlerts: [[MERA_PERMISSIONS.LICENSES_VIEW, MERA_PERMISSIONS.LICENSES_EXPIRE_REVIEW]],
  topComplaintStations: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  districtShortages: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  repeatedOffenders: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  monthlyReports: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  users: [[MERA_PERMISSIONS.USERS_VIEW]],
  auditLogs: [[MERA_PERMISSIONS.AUDIT_VIEW, MERA_PERMISSIONS.VIEW_AUDIT_LOGS]],
  reports: [[MERA_PERMISSIONS.REPORTS_VIEW]],
  publicNotices: [[MERA_PERMISSIONS.PUBLIC_NOTICES_VIEW, MERA_PERMISSIONS.CREATE_PUBLIC_NOTICE, MERA_PERMISSIONS.APPROVE_PUBLIC_NOTICE, MERA_PERMISSIONS.PUBLISH_PUBLIC_NOTICE]],
  priceCompliance: [[MERA_PERMISSIONS.MANAGE_PRICE_COMPLIANCE, MERA_PERMISSIONS.REPORTS_VIEW]],
  analytics: [[MERA_PERMISSIONS.ANALYTICS_VIEW, MERA_PERMISSIONS.REPORTS_VIEW]],
}

function userHasAnyPermission(user: any, permissions: readonly string[]) {
  const userPermissions = new Set((Array.isArray(user?.permissions) ? user.permissions : []).map((permission) => String(permission || '').trim().toUpperCase()))
  return permissions.some((permission) => userPermissions.has(String(permission || '').trim().toUpperCase()))
}

export function normalizePacketKeys(keys?: readonly string[] | string | null): MeraPacketKey[] {
  const raw = Array.isArray(keys) ? keys : String(keys || '').split(',')
  return [...new Set(raw.map((key) => String(key || '').trim()).filter((key): key is MeraPacketKey => allPacketKeys.has(key)))]
}

export function filterPacketKeysForUser(keys: readonly MeraPacketKey[], user: any): MeraPacketKey[] {
  return normalizePacketKeys(keys).filter((key) => {
    const permissionGroups = packetPermissionGroups[key]
    if (!permissionGroups?.length) return true
    return permissionGroups.some((permissions) => userHasAnyPermission(user, permissions))
  })
}

export function routePacketKeys(pathname: string): MeraPacketKey[] {
  const path = String(pathname || '')
  if (path.startsWith('/dashboard') || path.startsWith('/command-centre')) {
    return ['overview', 'nationalOperations', 'heatmap', 'notifications', 'tasks', 'myTasks', 'taskStats', 'inspections', 'fuelDeliveryLogs', 'complaints', 'flags', 'enforcementActions', 'demandForecastSummary', 'districtShortages', 'priceCompliance']
  }
  if (path.includes('heat') || path.includes('map')) return ['heatmap', 'nationalOperations', 'hoardingWatchlist', 'flags']
  if (path.includes('hoarding') || path.includes('risk-watchlist')) return ['hoardingWatchlist', 'flags', 'heatmap']
  if (path.includes('fuel-deliveries') || path.includes('fuel-supply')) return ['fuelDeliveryLogs', 'nationalOperations', 'profiles']
  if (path.includes('availability')) return ['availabilityReports', 'heatmap', 'profiles']
  if (path.includes('complaints')) return ['complaints', 'complaintMetrics', 'users', 'profiles']
  if (path.includes('compliance-flags') || path.includes('/cases')) return ['flags', 'flaggedStations', 'profiles', 'tasks', 'notifications']
  if (path.includes('inspections')) return ['inspections', 'inspectionMetrics', 'users', 'profiles', 'tasks']
  if (path.includes('enforcement')) return ['enforcementActions', 'flags', 'profiles']
  if (path.includes('station-regulatory-profiles') || path.startsWith('/stations')) return ['profiles', 'heatmap', 'tasks', 'myTasks']
  if (path.includes('license')) return ['licenseRegistry', 'expiryAlerts', 'profiles']
  if (path.includes('reports')) return ['reports', 'monthlyReports', 'demandForecastSummary', 'topComplaintStations', 'districtShortages', 'repeatedOffenders', 'hoardingWatchlist', 'enforcementActions', 'complaints']
  if (path.includes('price-compliance')) return ['priceCompliance']
  if (path.includes('public-notices')) return ['publicNotices']
  if (path.includes('analytics')) return ['analytics', 'districtShortages', 'topComplaintStations', 'repeatedOffenders']
  if (path.includes('user-administration') || path.includes('settings/users') || path.startsWith('/users')) return ['users', 'complaints', 'auditLogs', 'tasks']
  if (path.includes('audit')) return ['auditLogs', 'users']
  if (path.includes('settings')) return ['auditLogs', 'users', 'notifications', 'tasks']
  if (path.includes('/tasks')) return ['tasks', 'myTasks', 'taskStats', 'assignableUsers', 'notifications']
  return ['overview', 'notifications']
}

export function routeSyncPacketKeys(pathname: string): MeraPacketKey[] {
  const path = String(pathname || '')
  if (path.startsWith('/dashboard') || path.startsWith('/command-centre')) return ['overview', 'nationalOperations', 'heatmap', 'flags', 'enforcementActions', 'priceCompliance']
  if (path.includes('heat') || path.includes('map')) return ['heatmap', 'nationalOperations']
  if (path.includes('hoarding') || path.includes('risk-watchlist')) return ['hoardingWatchlist', 'flags']
  if (path.includes('fuel-deliveries') || path.includes('fuel-supply')) return ['fuelDeliveryLogs', 'nationalOperations']
  if (path.includes('availability')) return ['availabilityReports', 'heatmap']
  if (path.includes('complaints')) return ['complaints', 'complaintMetrics']
  if (path.includes('compliance-flags') || path.includes('/cases')) return ['flags', 'flaggedStations']
  if (path.includes('inspections')) return ['inspections', 'inspectionMetrics']
  if (path.includes('enforcement')) return ['enforcementActions', 'flags']
  if (path.includes('station-regulatory-profiles') || path.startsWith('/stations')) return ['profiles', 'heatmap']
  if (path.includes('license')) return ['licenseRegistry', 'expiryAlerts']
  if (path.includes('reports')) return ['reports', 'monthlyReports', 'demandForecastSummary', 'districtShortages']
  if (path.includes('price-compliance')) return ['priceCompliance']
  if (path.includes('public-notices')) return ['publicNotices']
  if (path.includes('analytics')) return ['analytics']
  if (path.includes('user-administration') || path.includes('settings/users') || path.startsWith('/users')) return ['users', 'tasks']
  if (path.includes('audit')) return ['auditLogs']
  if (path.includes('settings')) return ['notifications']
  if (path.includes('/tasks')) return ['tasks', 'myTasks', 'taskStats']
  return ['overview', 'notifications']
}

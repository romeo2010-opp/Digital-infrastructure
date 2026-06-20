export const MERA_PERMISSIONS = {
  SCHOOL_DASHBOARD: 'SCHOOL_DASHBOARD',
  STUDENTS_MANAGE: 'STUDENTS_MANAGE',
  FEES_MANAGE: 'FEES_MANAGE',
  ATTENDANCE_MANAGE: 'ATTENDANCE_MANAGE',
  ACADEMICS_MANAGE: 'ACADEMICS_MANAGE',
  MESSAGES_MANAGE: 'MESSAGES_MANAGE',
  REPORTS_VIEW: 'REPORTS_VIEW',
  USERS_MANAGE: 'USERS_MANAGE',
} as const

export type MeraPermission = (typeof MERA_PERMISSIONS)[keyof typeof MERA_PERMISSIONS] | string

function normalizePermissions(permissions: unknown) {
  if (!Array.isArray(permissions)) return []
  return permissions.map((permission) => String(permission || '').trim().toUpperCase()).filter(Boolean)
}

export function hasPermission(user: any, permission: MeraPermission) {
  if (!permission) return true
  return normalizePermissions(user?.permissions).includes(String(permission).toUpperCase())
}

export function hasAnyPermission(user: any, permissions: MeraPermission[] = []) {
  if (!permissions.length) return true
  return permissions.some((permission) => hasPermission(user, permission))
}

export function isReadOnlyExecutive() {
  return false
}

export const routePermissions: Array<{ path: string; permissions: MeraPermission[] }> = []

const roleRoutePrefixes: Record<string, string[]> = {
  super_admin: ['/'],
  school_owner: ['/'],
  headteacher: ['/'],
  bursar: [
    '/dashboard',
    '/search',
    '/classes',
    '/students',
    '/parents',
    '/calendar',
    '/fees',
    '/messages',
    '/reports',
    '/settings/profile',
    '/settings/preferences',
    '/settings/notifications',
    '/settings/security',
    '/settings/audit',
    '/settings/data',
  ],
  teacher: [
    '/dashboard',
    '/search',
    '/academic-sessions',
    '/classes',
    '/students',
    '/parents',
    '/calendar',
    '/attendance',
    '/homework',
    '/results',
    '/exam-sessions',
    '/assessment-insights',
    '/syllabus',
    '/exam-builder',
    '/daily-drill',
    '/exam-forecast',
    '/messages',
    '/reports',
    '/settings/profile',
    '/settings/preferences',
    '/settings/notifications',
    '/settings/security',
  ],
  parent: ['/dashboard', '/homework', '/messages', '/settings/profile', '/settings/preferences', '/settings/notifications', '/settings/security'],
  student: ['/student-portal', '/settings/profile', '/settings/preferences', '/settings/security'],
}

const roleLandingPath: Record<string, string> = {
  bursar: '/fees',
  teacher: '/dashboard',
  parent: '/homework',
  student: '/student-portal',
}

function roleFor(user: any) {
  return String(user?.role || '').toLowerCase()
}

export function canAccessPath(user: any, pathname = '/') {
  const role = roleFor(user)
  const prefixes = roleRoutePrefixes[role] || roleRoutePrefixes.teacher
  if (prefixes.includes('/')) return true
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function firstAccessiblePath(user?: any) {
  return roleLandingPath[roleFor(user)] || '/dashboard'
}

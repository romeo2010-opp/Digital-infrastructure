export const MERA_PERMISSIONS = {
  SCHOOL_DASHBOARD: 'SCHOOL_DASHBOARD',
  STUDENTS_MANAGE: 'STUDENTS_MANAGE',
  FEES_MANAGE: 'FEES_MANAGE',
  ATTENDANCE_MANAGE: 'ATTENDANCE_MANAGE',
  ACADEMICS_MANAGE: 'ACADEMICS_MANAGE',
  MESSAGES_MANAGE: 'MESSAGES_MANAGE',
  REPORTS_VIEW: 'REPORTS_VIEW',
  USERS_MANAGE: 'USERS_MANAGE',
  AWARE_SEARCH: 'AWARE_SEARCH',
  PAYROLL_VIEW: 'PAYROLL_VIEW',
  PAYROLL_MANAGE: 'PAYROLL_MANAGE',
  PAYROLL_APPROVE: 'PAYROLL_APPROVE',
  LEAVE_VIEW: 'LEAVE_VIEW',
  LEAVE_MANAGE: 'LEAVE_MANAGE',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  LIBRARY_DASHBOARD_VIEW: 'LIBRARY_DASHBOARD_VIEW',
  LIBRARY_BOOK_VIEW: 'LIBRARY_BOOK_VIEW',
  LIBRARY_LOAN_VIEW: 'LIBRARY_LOAN_VIEW',
  TEACHING_RESOURCE_VIEW: 'TEACHING_RESOURCE_VIEW',
  PRINT_REQUEST_VIEW: 'PRINT_REQUEST_VIEW',
  ARCHIVED_TERM_VIEW: 'ARCHIVED_TERM_VIEW',
  ACADEMIC_INTELLIGENCE_VIEW: 'ACADEMIC_INTELLIGENCE_VIEW',
  CLASSROOM_MODE_USE: 'CLASSROOM_MODE_USE',
} as const

export type MeraPermission = (typeof MERA_PERMISSIONS)[keyof typeof MERA_PERMISSIONS] | string

export const DEFAULT_SCHOOL_FEATURES = {
  school_timetables: true,
  exam_timetables: true,
  personal_timetable_views: true,
  student_exam_views: true,
  invigilation_views: true,
  timetable_generation: true,
  timetable_publication: true,
  daily_adjustments: false,
} as const

export const schoolFeatureDefinitions = [
  {
    key: 'school_timetables',
    title: 'School Timetables',
    detail: 'Class timetable setup, versions, conflicts and publication.',
    audience: 'Leadership, academic office, teachers',
  },
  {
    key: 'exam_timetables',
    title: 'Exam Timetables',
    detail: 'Exam sessions, timetable review, rooms and invigilation planning.',
    audience: 'Leadership, exam office, teachers',
  },
  {
    key: 'personal_timetable_views',
    title: 'Personal Timetable Views',
    detail: 'Published lesson schedules for teachers and learners.',
    audience: 'Teachers, students, guardians',
  },
  {
    key: 'student_exam_views',
    title: 'Student Exam Views',
    detail: 'Published examination schedules for learners and guardians.',
    audience: 'Students, guardians',
  },
  {
    key: 'invigilation_views',
    title: 'Invigilation Views',
    detail: 'Personal invigilation duties for assigned staff.',
    audience: 'Teachers, exam office',
  },
  {
    key: 'timetable_generation',
    title: 'Automatic Generation',
    detail: 'Queue assisted timetable generation jobs.',
    audience: 'Leadership, academic office',
  },
  {
    key: 'timetable_publication',
    title: 'Publication Workflow',
    detail: 'Approve and publish immutable timetable versions.',
    audience: 'Headteacher, school owner',
  },
  {
    key: 'daily_adjustments',
    title: 'Daily Adjustments',
    detail: 'Substitutions, room changes and emergency schedule changes.',
    audience: 'Leadership, teachers',
  },
] as const

export type SchoolFeatureKey = keyof typeof DEFAULT_SCHOOL_FEATURES

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

export const routePermissions: Array<{ path: string; permissions: MeraPermission[] }> = [
  { path: '/finance/payroll', permissions: [MERA_PERMISSIONS.PAYROLL_VIEW] },
  { path: '/staff/leave', permissions: [MERA_PERMISSIONS.LEAVE_VIEW] },
  { path: '/search', permissions: [MERA_PERMISSIONS.AWARE_SEARCH] },
  { path: '/settings/users', permissions: [MERA_PERMISSIONS.USERS_MANAGE] },
  { path: '/library/dashboard', permissions: [MERA_PERMISSIONS.LIBRARY_DASHBOARD_VIEW] },
  { path: '/library/catalogue', permissions: [MERA_PERMISSIONS.LIBRARY_BOOK_VIEW] },
  { path: '/library/loans', permissions: [MERA_PERMISSIONS.LIBRARY_LOAN_VIEW] },
  { path: '/library/computers', permissions: ['LIBRARY_COMPUTER_VIEW'] },
  { path: '/library/resources', permissions: [MERA_PERMISSIONS.TEACHING_RESOURCE_VIEW] },
  { path: '/library/resource-requests', permissions: [MERA_PERMISSIONS.TEACHING_RESOURCE_REVIEW] },
  { path: '/library/print-requests', permissions: [MERA_PERMISSIONS.PRINT_REQUEST_VIEW, 'TEACHING_RESOURCE_PRINT'] },
  { path: '/library/archive', permissions: [MERA_PERMISSIONS.ARCHIVED_TERM_VIEW] },
  { path: '/academic-intelligence', permissions: [MERA_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW] },
  { path: '/learner-support', permissions: [MERA_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW] },
  { path: '/classroom', permissions: [MERA_PERMISSIONS.CLASSROOM_MODE_USE] },
]

function normalizeSchoolFeatures(value: any) {
  const source = value?.features && typeof value.features === 'object' ? value.features : value
  return Object.fromEntries(
    Object.entries(DEFAULT_SCHOOL_FEATURES).map(([key, defaultValue]) => [
      key,
      source?.[key] === undefined ? defaultValue : Boolean(source[key]),
    ]),
  ) as Record<SchoolFeatureKey, boolean>
}

export function getUserSchoolFeatures(user: any) {
  return normalizeSchoolFeatures(user?.schoolFeatures || user?.school_features || {})
}

export function isSchoolFeatureEnabled(user: any, key: SchoolFeatureKey) {
  if (String(user?.role || '').toLowerCase() === 'super_admin') return true
  return getUserSchoolFeatures(user)[key] !== false
}

const routeFeatureRequirements: Array<{ path: string; feature: SchoolFeatureKey }> = [
  { path: '/timetables', feature: 'school_timetables' },
  { path: '/exam-timetables', feature: 'exam_timetables' },
  { path: '/my-timetable', feature: 'personal_timetable_views' },
  { path: '/my-exams', feature: 'student_exam_views' },
  { path: '/my-invigilation', feature: 'invigilation_views' },
]

function routeFeatureEnabled(user: any, pathname = '/') {
  const match = routeFeatureRequirements.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
  return match ? isSchoolFeatureEnabled(user, match.feature) : true
}

const roleRoutePrefixes: Record<string, string[]> = {
  super_admin: ['/'],
  school_owner: ['/'],
  director: ['/'],
  owner: ['/'],
  headteacher: ['/'],
  bursar: [
    '/tasks',
    '/my-leave',
    '/search',
    '/fees',
    '/finance/payroll',
    '/exam-intelligence',
    '/settings/profile',
    '/settings/my-leave',
    '/settings/preferences',
    '/settings/personalized',
    '/settings/notifications',
    '/settings/security',
  ],
  librarian: [
    '/dashboard',
    '/tasks',
    '/my-leave',
    '/search',
    '/library/dashboard',
    '/library/catalogue',
    '/library/loans',
    '/library/computers',
    '/library/resources',
    '/library/resource-requests',
    '/library/archive',
    '/library/print-requests',
    '/settings/profile',
    '/settings/my-leave',
    '/settings/preferences',
    '/settings/personalized',
    '/settings/notifications',
    '/settings/security',
  ],
  teacher: [
    '/tasks',
    '/my-leave',
    '/dashboard',
    '/search',
    '/academic-sessions',
    '/classes',
    '/students',
    '/parents',
    '/calendar',
    '/timetables',
    '/exam-timetables',
    '/my-timetable',
    '/my-exams',
    '/my-invigilation',
    '/attendance',
    '/homework',
    '/teacher/lesson-log',
    '/teacher/classes',
    '/classroom',
    '/academic-intelligence',
    '/learner-support',
    '/library/resources',
    '/library/print-requests',
    '/results',
    '/exam-sessions',
    '/assessment-insights',
    '/syllabus',
    '/questions/bank',
    '/questions/batches',
    '/exam-builder',
    '/assessments',
    '/daily-drill',
    '/exam-forecast',
    '/exam-intelligence',
    '/messages',
    '/reports',
    '/settings/profile',
    '/settings/my-leave',
    '/settings/preferences',
    '/settings/personalized',
    '/settings/notifications',
    '/settings/security',
  ],
  parent: ['/student-portal', '/parent-insights', '/my-timetable', '/my-exams', '/homework', '/exam-intelligence', '/messages', '/settings/profile', '/settings/preferences', '/settings/personalized', '/settings/notifications', '/settings/security'],
  student: ['/student-portal', '/my-timetable', '/my-exams', '/exam-intelligence', '/settings/profile', '/settings/preferences', '/settings/personalized', '/settings/security'],
}

const roleLandingPath: Record<string, string> = {
  school_owner: '/overview',
  director: '/overview',
  owner: '/overview',
  bursar: '/fees/dashboard',
  librarian: '/library/dashboard',
  teacher: '/dashboard',
  parent: '/student-portal',
  student: '/student-portal',
}

function roleFor(user: any) {
  const role = String(user?.role || '').toLowerCase()
  if (role === 'director' || role === 'owner') return role
  return role
}

const internalRouteRoles = new Set(['super_admin', 'founder', 'developer', 'system_admin'])

export function canAccessPath(user: any, pathname = '/') {
  const role = roleFor(user)
  if ((pathname === '/classroom' || pathname.startsWith('/classroom/')) && role !== 'teacher') return false
  if (pathname === '/internal' || pathname.startsWith('/internal/')) {
    return internalRouteRoles.has(role)
  }
  const prefixes = roleRoutePrefixes[role] || roleRoutePrefixes.teacher
  const roleAllowed = prefixes.includes('/') || prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const permissionRule = routePermissions.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
  const permissionAllowed = !permissionRule || hasAnyPermission(user, permissionRule.permissions)
  return roleAllowed && permissionAllowed && routeFeatureEnabled(user, pathname)
}

export function firstAccessiblePath(user?: any) {
  return roleLandingPath[roleFor(user)] || '/dashboard'
}

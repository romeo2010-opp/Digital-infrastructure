import { HttpError } from "../../utils/http.js"

export const TIMETABLE_PERMISSIONS = {
  VIEW: "timetable.view",
  CONFIGURE: "timetable.configure",
  CREATE: "timetable.create",
  EDIT: "timetable.edit",
  GENERATE: "timetable.generate",
  REVIEW: "timetable.review",
  APPROVE: "timetable.approve",
  PUBLISH: "timetable.publish",
  ARCHIVE: "timetable.archive",
  EXPORT: "timetable.export",
  MANAGE_CONSTRAINTS: "timetable.manage_constraints",
  MANAGE_DAILY_ADJUSTMENTS: "timetable.manage_daily_adjustments",
  MANAGE_SUBSTITUTIONS: "timetable.manage_substitutions",
  EXAM_VIEW: "exam_timetable.view",
  EXAM_CONFIGURE: "exam_timetable.configure",
  EXAM_CREATE: "exam_timetable.create",
  EXAM_EDIT: "exam_timetable.edit",
  EXAM_GENERATE: "exam_timetable.generate",
  EXAM_MANAGE_ROOMS: "exam_timetable.manage_rooms",
  EXAM_MANAGE_INVIGILATORS: "exam_timetable.manage_invigilators",
  EXAM_MANAGE_SEATING: "exam_timetable.manage_seating",
  EXAM_APPROVE: "exam_timetable.approve",
  EXAM_PUBLISH: "exam_timetable.publish",
  EXAM_EXPORT: "exam_timetable.export",
}

const allPermissions = Object.values(TIMETABLE_PERMISSIONS)
const managementRoles = ["super_admin", "school_owner", "headteacher"]
const teacherReadPermissions = [
  TIMETABLE_PERMISSIONS.VIEW,
  TIMETABLE_PERMISSIONS.EXAM_VIEW,
]
const bursarReadPermissions = [
  TIMETABLE_PERMISSIONS.VIEW,
]

function roleFor(req) {
  return String(req.user?.role || "").toLowerCase()
}

export function permissionsForRole(role) {
  const normalized = String(role || "").toLowerCase()
  if (normalized === "super_admin" || normalized === "school_owner") return allPermissions
  if (normalized === "headteacher") return allPermissions
  if (normalized === "teacher") return teacherReadPermissions
  if (normalized === "bursar") return bursarReadPermissions
  if (normalized === "student") return [TIMETABLE_PERMISSIONS.VIEW, TIMETABLE_PERMISSIONS.EXAM_VIEW]
  if (normalized === "parent") return [TIMETABLE_PERMISSIONS.VIEW, TIMETABLE_PERMISSIONS.EXAM_VIEW]
  return []
}

export function canUseTimetablePermission(req, permission) {
  return permissionsForRole(roleFor(req)).includes(permission)
}

export function requireTimetablePermission(req, permission) {
  if (canUseTimetablePermission(req, permission)) return
  throw new HttpError(403, "You do not have permission to perform this timetable action")
}

export function requireTimetableManager(req) {
  if (managementRoles.includes(roleFor(req))) return
  throw new HttpError(403, "Timetable management is restricted to school leadership")
}

export function permissionForType(timetableType, action) {
  const type = String(timetableType || "").toUpperCase()
  const suffix = String(action || "").toUpperCase()
  if (type === "EXAM_TIMETABLE") {
    return TIMETABLE_PERMISSIONS[`EXAM_${suffix}`] || TIMETABLE_PERMISSIONS.EXAM_VIEW
  }
  return TIMETABLE_PERMISSIONS[suffix] || TIMETABLE_PERMISSIONS.VIEW
}

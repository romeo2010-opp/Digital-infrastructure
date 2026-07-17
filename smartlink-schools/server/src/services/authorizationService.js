import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

export const SCHOOL_PERMISSIONS = Object.freeze({
  SCHOOL_DASHBOARD: "SCHOOL_DASHBOARD",
  AWARE_SEARCH: "AWARE_SEARCH",
  STUDENTS_VIEW: "STUDENTS_VIEW",
  STUDENTS_MANAGE: "STUDENTS_MANAGE",
  FEES_VIEW: "FEES_VIEW",
  FEES_MANAGE: "FEES_MANAGE",
  DISCOUNTS_APPROVE: "DISCOUNTS_APPROVE",
  PAYROLL_VIEW: "PAYROLL_VIEW",
  PAYROLL_MANAGE: "PAYROLL_MANAGE",
  PAYROLL_APPROVE: "PAYROLL_APPROVE",
  LEAVE_VIEW: "LEAVE_VIEW",
  LEAVE_MANAGE: "LEAVE_MANAGE",
  LEAVE_APPROVE: "LEAVE_APPROVE",
  ATTENDANCE_MANAGE: "ATTENDANCE_MANAGE",
  ACADEMICS_MANAGE: "ACADEMICS_MANAGE",
  MESSAGES_MANAGE: "MESSAGES_MANAGE",
  REPORTS_VIEW: "REPORTS_VIEW",
  USERS_MANAGE: "USERS_MANAGE",
  LIBRARY_DASHBOARD_VIEW: "LIBRARY_DASHBOARD_VIEW",
  LIBRARY_BOOK_VIEW: "LIBRARY_BOOK_VIEW",
  LIBRARY_BOOK_CREATE: "LIBRARY_BOOK_CREATE",
  LIBRARY_BOOK_UPDATE: "LIBRARY_BOOK_UPDATE",
  LIBRARY_BOOK_ARCHIVE: "LIBRARY_BOOK_ARCHIVE",
  LIBRARY_LOAN_VIEW: "LIBRARY_LOAN_VIEW",
  LIBRARY_LOAN_CREATE: "LIBRARY_LOAN_CREATE",
  LIBRARY_LOAN_RETURN: "LIBRARY_LOAN_RETURN",
  LIBRARY_LOAN_OVERRIDE: "LIBRARY_LOAN_OVERRIDE",
  TEACHING_RESOURCE_VIEW: "TEACHING_RESOURCE_VIEW",
  TEACHING_RESOURCE_CREATE: "TEACHING_RESOURCE_CREATE",
  TEACHING_RESOURCE_UPDATE: "TEACHING_RESOURCE_UPDATE",
  TEACHING_RESOURCE_REVIEW: "TEACHING_RESOURCE_REVIEW",
  TEACHING_RESOURCE_APPROVE: "TEACHING_RESOURCE_APPROVE",
  TEACHING_RESOURCE_ARCHIVE: "TEACHING_RESOURCE_ARCHIVE",
  TEACHING_RESOURCE_DOWNLOAD: "TEACHING_RESOURCE_DOWNLOAD",
  TEACHING_RESOURCE_PRINT: "TEACHING_RESOURCE_PRINT",
  ARCHIVED_TERM_VIEW: "ARCHIVED_TERM_VIEW",
  ARCHIVED_SYLLABUS_VIEW: "ARCHIVED_SYLLABUS_VIEW",
  ARCHIVED_ASSESSMENT_VIEW: "ARCHIVED_ASSESSMENT_VIEW",
  ARCHIVED_MARKING_SCHEME_VIEW: "ARCHIVED_MARKING_SCHEME_VIEW",
  ARCHIVED_TEACHING_RESOURCE_VIEW: "ARCHIVED_TEACHING_RESOURCE_VIEW",
  ARCHIVED_TIMETABLE_VIEW: "ARCHIVED_TIMETABLE_VIEW",
  ARCHIVED_PUBLICATION_VIEW: "ARCHIVED_PUBLICATION_VIEW",
  ARCHIVED_NAMED_RESULTS_VIEW: "ARCHIVED_NAMED_RESULTS_VIEW",
  ARCHIVED_STUDENT_PROFILE_VIEW: "ARCHIVED_STUDENT_PROFILE_VIEW",
  ARCHIVED_INTERVENTION_VIEW: "ARCHIVED_INTERVENTION_VIEW",
  INSTITUTIONAL_ARCHIVE_MANAGE: "INSTITUTIONAL_ARCHIVE_MANAGE",
  ARCHIVE_METADATA_UPDATE: "ARCHIVE_METADATA_UPDATE",
  ARCHIVE_DUPLICATE_REVIEW: "ARCHIVE_DUPLICATE_REVIEW",
  ARCHIVE_RESTORE_RESOURCE: "ARCHIVE_RESTORE_RESOURCE",
  ARCHIVE_PERMANENT_DELETE: "ARCHIVE_PERMANENT_DELETE",
  HISTORICAL_RESULT_MODIFY: "HISTORICAL_RESULT_MODIFY",
  PRINT_REQUEST_VIEW: "PRINT_REQUEST_VIEW",
  PRINT_REQUEST_PROCESS: "PRINT_REQUEST_PROCESS",
  PRINT_REQUEST_COMPLETE: "PRINT_REQUEST_COMPLETE",
  LIBRARY_COMPUTER_VIEW: "LIBRARY_COMPUTER_VIEW",
  LIBRARY_COMPUTER_MANAGE: "LIBRARY_COMPUTER_MANAGE",
  ACADEMIC_INTELLIGENCE_VIEW: "ACADEMIC_INTELLIGENCE_VIEW",
  ACADEMIC_INTELLIGENCE_MANAGE: "ACADEMIC_INTELLIGENCE_MANAGE",
  ACADEMIC_INTERVENTION_MANAGE: "ACADEMIC_INTERVENTION_MANAGE",
  CLASSROOM_MODE_USE: "CLASSROOM_MODE_USE",
})

export const PERMISSION_DEFINITIONS = [
  [SCHOOL_PERMISSIONS.SCHOOL_DASHBOARD, "School dashboard", "View the school operating dashboard."],
  [SCHOOL_PERMISSIONS.AWARE_SEARCH, "Aware search", "Search permitted school records using plain language."],
  [SCHOOL_PERMISSIONS.STUDENTS_VIEW, "View students", "View learner profiles inside the user’s school scope."],
  [SCHOOL_PERMISSIONS.STUDENTS_MANAGE, "Manage students", "Create and update learner records."],
  [SCHOOL_PERMISSIONS.FEES_VIEW, "View finance", "View fee accounts, payments and balances."],
  [SCHOOL_PERMISSIONS.FEES_MANAGE, "Manage finance", "Post payments and manage fee operations."],
  [SCHOOL_PERMISSIONS.DISCOUNTS_APPROVE, "Approve discounts", "Approve or reject discount and bursary requests."],
  [SCHOOL_PERMISSIONS.PAYROLL_VIEW, "View payroll", "View salary profiles, payroll runs and staff pay."],
  [SCHOOL_PERMISSIONS.PAYROLL_MANAGE, "Manage payroll", "Create payroll runs and edit draft payroll items."],
  [SCHOOL_PERMISSIONS.PAYROLL_APPROVE, "Approve payroll", "Approve, pay or cancel payroll runs."],
  [SCHOOL_PERMISSIONS.LEAVE_VIEW, "View staff leave", "View staff leave requests and coverage."],
  [SCHOOL_PERMISSIONS.LEAVE_MANAGE, "Manage staff leave", "Create requests and assign coverage."],
  [SCHOOL_PERMISSIONS.LEAVE_APPROVE, "Approve staff leave", "Approve, reject, cancel and complete leave."],
  [SCHOOL_PERMISSIONS.ATTENDANCE_MANAGE, "Manage attendance", "Record and review attendance."],
  [SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, "Manage academics", "Manage assessments, results and academic setup."],
  [SCHOOL_PERMISSIONS.MESSAGES_MANAGE, "Manage messages", "Publish school communications."],
  [SCHOOL_PERMISSIONS.REPORTS_VIEW, "View reports", "View and export school reports."],
  [SCHOOL_PERMISSIONS.USERS_MANAGE, "Manage users", "Change users and their permission overrides."],
  [SCHOOL_PERMISSIONS.LIBRARY_DASHBOARD_VIEW, "Library dashboard", "View actionable library, archive, print and resource queues."],
  [SCHOOL_PERMISSIONS.LIBRARY_BOOK_VIEW, "View physical library", "View the school physical-resource catalogue."],
  [SCHOOL_PERMISSIONS.LIBRARY_BOOK_CREATE, "Create physical resources", "Register books and other physical resources."],
  [SCHOOL_PERMISSIONS.LIBRARY_BOOK_UPDATE, "Update physical resources", "Update physical resource metadata and copies."],
  [SCHOOL_PERMISSIONS.LIBRARY_BOOK_ARCHIVE, "Archive physical resources", "Archive withdrawn physical resources."],
  [SCHOOL_PERMISSIONS.LIBRARY_LOAN_VIEW, "View loans", "View school library borrowing and overdue records."],
  [SCHOOL_PERMISSIONS.LIBRARY_LOAN_CREATE, "Issue loans", "Issue available library copies to borrowers."],
  [SCHOOL_PERMISSIONS.LIBRARY_LOAN_RETURN, "Receive returns", "Record returned, lost or damaged copies."],
  [SCHOOL_PERMISSIONS.LIBRARY_LOAN_OVERRIDE, "Override loans", "Override exceptional library-loan states."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_VIEW, "View teaching resources", "Search approved school teaching resources."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_CREATE, "Create teaching resources", "Upload and classify teaching resources."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_UPDATE, "Update teaching resources", "Update resource metadata and create versions."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_REVIEW, "Review teaching resources", "Review file quality and archive metadata."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_APPROVE, "Approve teaching resources", "Approve academic suitability after required reviews."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_ARCHIVE, "Archive teaching resources", "Archive superseded teaching-resource versions."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_DOWNLOAD, "Download teaching resources", "Download permitted resource files."],
  [SCHOOL_PERMISSIONS.TEACHING_RESOURCE_PRINT, "Request resource printing", "Create print requests for permitted resources."],
  [SCHOOL_PERMISSIONS.ARCHIVED_TERM_VIEW, "View archived terms", "Browse archived academic terms."],
  [SCHOOL_PERMISSIONS.ARCHIVED_SYLLABUS_VIEW, "View archived syllabuses", "Browse historical syllabus metadata and files."],
  [SCHOOL_PERMISSIONS.ARCHIVED_ASSESSMENT_VIEW, "View archived assessments", "View archived assessment papers without named marks."],
  [SCHOOL_PERMISSIONS.ARCHIVED_MARKING_SCHEME_VIEW, "View archived marking schemes", "View restricted archived marking-scheme files."],
  [SCHOOL_PERMISSIONS.ARCHIVED_TEACHING_RESOURCE_VIEW, "View archived resources", "Browse archived teaching resources."],
  [SCHOOL_PERMISSIONS.ARCHIVED_TIMETABLE_VIEW, "View archived timetables", "Browse historical timetable records."],
  [SCHOOL_PERMISSIONS.ARCHIVED_PUBLICATION_VIEW, "View archived publications", "Browse historical school publications."],
  [SCHOOL_PERMISSIONS.ARCHIVED_NAMED_RESULTS_VIEW, "View named archived results", "Sensitive access to named historical student marks."],
  [SCHOOL_PERMISSIONS.ARCHIVED_STUDENT_PROFILE_VIEW, "View archived learner profiles", "Sensitive access to historical learner profiles."],
  [SCHOOL_PERMISSIONS.ARCHIVED_INTERVENTION_VIEW, "View archived interventions", "Sensitive access to historical learner interventions."],
  [SCHOOL_PERMISSIONS.INSTITUTIONAL_ARCHIVE_MANAGE, "Manage institutional archive", "Prepare and classify institutional archive records."],
  [SCHOOL_PERMISSIONS.ARCHIVE_METADATA_UPDATE, "Update archive metadata", "Correct classification metadata without changing official records."],
  [SCHOOL_PERMISSIONS.ARCHIVE_DUPLICATE_REVIEW, "Review archive duplicates", "Review possible duplicate archive resources."],
  [SCHOOL_PERMISSIONS.ARCHIVE_RESTORE_RESOURCE, "Restore archived resources", "Restore an archived resource as a new active version."],
  [SCHOOL_PERMISSIONS.ARCHIVE_PERMANENT_DELETE, "Permanently delete archive records", "Highly sensitive permanent archive deletion."],
  [SCHOOL_PERMISSIONS.HISTORICAL_RESULT_MODIFY, "Modify historical results", "Highly sensitive correction of official historical marks."],
  [SCHOOL_PERMISSIONS.PRINT_REQUEST_VIEW, "View print requests", "View school printing requests."],
  [SCHOOL_PERMISSIONS.PRINT_REQUEST_PROCESS, "Process print requests", "Approve, queue and print requested materials."],
  [SCHOOL_PERMISSIONS.PRINT_REQUEST_COMPLETE, "Complete print requests", "Mark printed resources ready and collected."],
  [SCHOOL_PERMISSIONS.LIBRARY_COMPUTER_VIEW, "View library computers", "View tracked library computers and availability."],
  [SCHOOL_PERMISSIONS.LIBRARY_COMPUTER_MANAGE, "Manage library computers", "Update library-computer status and maintenance notes."],
  [SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW, "View academic intelligence", "View explainable mastery, pacing, readiness and next actions."],
  [SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_MANAGE, "Manage academic intelligence", "Configure lifecycle rules and academic thresholds."],
  [SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE, "Manage academic interventions", "Create and monitor evidence-based interventions."],
  [SCHOOL_PERMISSIONS.CLASSROOM_MODE_USE, "Use Classroom Mode", "Run teacher-operated physical classroom sessions."],
].map(([code, label, description]) => ({ code, label, description }))

const allCodes = PERMISSION_DEFINITIONS.map((item) => item.code)
const headteacherOperationalPermissions = new Set([
  "LIBRARY_BOOK_VIEW", "LIBRARY_BOOK_CREATE", "LIBRARY_BOOK_UPDATE", "LIBRARY_BOOK_ARCHIVE",
  "LIBRARY_LOAN_VIEW", "LIBRARY_LOAN_CREATE", "LIBRARY_LOAN_RETURN", "LIBRARY_LOAN_OVERRIDE",
  "TEACHING_RESOURCE_CREATE", "TEACHING_RESOURCE_UPDATE", "TEACHING_RESOURCE_REVIEW", "TEACHING_RESOURCE_ARCHIVE", "TEACHING_RESOURCE_PRINT",
  "ARCHIVED_TERM_VIEW", "ARCHIVED_SYLLABUS_VIEW", "ARCHIVED_ASSESSMENT_VIEW", "ARCHIVED_MARKING_SCHEME_VIEW",
  "ARCHIVED_TEACHING_RESOURCE_VIEW", "ARCHIVED_TIMETABLE_VIEW", "ARCHIVED_PUBLICATION_VIEW", "ARCHIVED_NAMED_RESULTS_VIEW",
  "ARCHIVED_STUDENT_PROFILE_VIEW", "ARCHIVED_INTERVENTION_VIEW", "INSTITUTIONAL_ARCHIVE_MANAGE", "ARCHIVE_METADATA_UPDATE",
  "ARCHIVE_DUPLICATE_REVIEW", "ARCHIVE_RESTORE_RESOURCE", "ARCHIVE_PERMANENT_DELETE", "HISTORICAL_RESULT_MODIFY",
  "PRINT_REQUEST_VIEW", "PRINT_REQUEST_PROCESS", "PRINT_REQUEST_COMPLETE", "LIBRARY_COMPUTER_VIEW", "LIBRARY_COMPUTER_MANAGE",
])
const defaults = {
  super_admin: allCodes,
  school_owner: allCodes,
  director: allCodes,
  owner: allCodes,
  headteacher: allCodes.filter((code) => !code.startsWith("PAYROLL_") && !headteacherOperationalPermissions.has(code)),
  bursar: ["SCHOOL_DASHBOARD", "AWARE_SEARCH", "STUDENTS_VIEW", "FEES_VIEW", "FEES_MANAGE", "REPORTS_VIEW"],
  librarian: [
    "SCHOOL_DASHBOARD", "AWARE_SEARCH", "LIBRARY_DASHBOARD_VIEW", "LIBRARY_BOOK_VIEW", "LIBRARY_BOOK_CREATE",
    "LIBRARY_BOOK_UPDATE", "LIBRARY_BOOK_ARCHIVE", "LIBRARY_LOAN_VIEW", "LIBRARY_LOAN_CREATE", "LIBRARY_LOAN_RETURN",
    "TEACHING_RESOURCE_VIEW", "TEACHING_RESOURCE_CREATE", "TEACHING_RESOURCE_UPDATE", "TEACHING_RESOURCE_REVIEW",
    "TEACHING_RESOURCE_ARCHIVE", "TEACHING_RESOURCE_DOWNLOAD", "TEACHING_RESOURCE_PRINT", "ARCHIVED_TERM_VIEW",
    "ARCHIVED_SYLLABUS_VIEW", "ARCHIVED_ASSESSMENT_VIEW", "ARCHIVED_TEACHING_RESOURCE_VIEW", "ARCHIVED_TIMETABLE_VIEW",
    "ARCHIVED_PUBLICATION_VIEW", "INSTITUTIONAL_ARCHIVE_MANAGE", "ARCHIVE_METADATA_UPDATE", "ARCHIVE_DUPLICATE_REVIEW",
    "ARCHIVE_RESTORE_RESOURCE", "PRINT_REQUEST_VIEW", "PRINT_REQUEST_PROCESS", "PRINT_REQUEST_COMPLETE",
    "LIBRARY_COMPUTER_VIEW", "LIBRARY_COMPUTER_MANAGE",
  ],
  teacher: ["SCHOOL_DASHBOARD", "AWARE_SEARCH", "STUDENTS_VIEW", "ATTENDANCE_MANAGE", "ACADEMICS_MANAGE", "MESSAGES_MANAGE", "REPORTS_VIEW", "TEACHING_RESOURCE_VIEW", "TEACHING_RESOURCE_CREATE", "TEACHING_RESOURCE_UPDATE", "TEACHING_RESOURCE_DOWNLOAD", "TEACHING_RESOURCE_PRINT", "ACADEMIC_INTELLIGENCE_VIEW", "ACADEMIC_INTERVENTION_MANAGE", "CLASSROOM_MODE_USE"],
  parent: ["SCHOOL_DASHBOARD"],
  student: ["SCHOOL_DASHBOARD"],
}

export function defaultPermissionsForRole(role) {
  return [...(defaults[String(role || "").toLowerCase()] || [])]
}

export async function getEffectivePermissions(schoolId, userId, role) {
  const effective = new Set(defaultPermissionsForRole(role))
  if (!schoolId || !userId || String(role).toLowerCase() === "student") return [...effective]
  try {
    const [rows] = await pool.query(
      "SELECT permission_code, is_allowed FROM user_permissions WHERE school_id=? AND user_id=?",
      [schoolId, userId],
    )
    for (const row of rows) {
      const code = String(row.permission_code || "").toUpperCase()
      if (!allCodes.includes(code)) continue
      if (row.is_allowed) effective.add(code)
      else effective.delete(code)
    }
    if (String(role).toLowerCase() === "bursar") {
      const [[settings]] = await pool.query("SELECT allow_bursar_payroll_access FROM school_hr_settings WHERE school_id=?", [schoolId])
      if (settings?.allow_bursar_payroll_access) {
        effective.add(SCHOOL_PERMISSIONS.PAYROLL_VIEW)
        effective.add(SCHOOL_PERMISSIONS.PAYROLL_MANAGE)
      }
    }
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error
  }
  return [...effective]
}

export async function userHasPermission(user, code) {
  if (!user) return false
  const permissions = await getEffectivePermissions(user.schoolId || user.school_id, user.id, user.role)
  return permissions.includes(String(code || "").toUpperCase())
}

export function requireSchoolPermission(code) {
  return function permissionGuard(req, _res, next) {
    if (!req.user) return next(new HttpError(401, "Authentication required"))
    userHasPermission(req.user, code)
      .then((allowed) => allowed ? next() : next(new HttpError(403, "You do not have permission to perform this action")))
      .catch(next)
  }
}

export async function listPermissionState(schoolId, userRef) {
  const [[user]] = await pool.query("SELECT id,public_ref,full_name,email,role,is_active FROM users WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, userRef])
  if (!user) throw new HttpError(404, "User was not found")
  const [overrides] = await pool.query("SELECT permission_code,is_allowed,updated_at FROM user_permissions WHERE school_id=? AND user_id=?", [schoolId, user.id])
  const overrideMap = new Map(overrides.map((item) => [item.permission_code, Boolean(item.is_allowed)]))
  const roleDefaults = new Set(defaultPermissionsForRole(user.role))
  return {
    user: { public_ref: user.public_ref, full_name: user.full_name, email: user.email, role: user.role, is_active: Boolean(user.is_active) },
    permissions: PERMISSION_DEFINITIONS.map((item) => ({
      ...item,
      role_default: roleDefaults.has(item.code),
      override: overrideMap.has(item.code) ? overrideMap.get(item.code) : null,
      allowed: overrideMap.has(item.code) ? overrideMap.get(item.code) : roleDefaults.has(item.code),
    })),
  }
}

export async function replacePermissionOverrides(schoolId, userRef, actorId, permissions = []) {
  const [[target]] = await pool.query("SELECT id,role FROM users WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId, userRef])
  if (!target) throw new HttpError(404, "User was not found")
  if (["school_owner", "director", "owner"].includes(String(target.role).toLowerCase())) {
    throw new HttpError(400, "Owner-level access cannot be reduced from this screen")
  }
  const requested = new Map()
  for (const item of permissions) {
    const code = String(item?.code || item?.permission_code || "").toUpperCase()
    if (allCodes.includes(code)) requested.set(code, Boolean(item.allowed))
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query("DELETE FROM user_permissions WHERE school_id=? AND user_id=?", [schoolId, target.id])
    const roleDefaults = new Set(defaultPermissionsForRole(target.role))
    for (const [code, allowed] of requested) {
      if (allowed === roleDefaults.has(code)) continue
      await connection.query(
        "INSERT INTO user_permissions (public_ref,school_id,user_id,permission_code,is_allowed,granted_by) VALUES (UUID(),?,?,?,?,?)",
        [schoolId, target.id, code, allowed ? 1 : 0, actorId],
      )
    }
    await connection.query(
      "INSERT INTO audit_logs (school_id,actor_user_id,action,entity_type,entity_id,after_value) VALUES (?,?,\"USER_PERMISSIONS_UPDATED\",\"user\",?,?)",
      [schoolId, actorId, target.id, JSON.stringify(Object.fromEntries(requested))],
    ).catch((error) => { if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error })
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return listPermissionState(schoolId, userRef)
}

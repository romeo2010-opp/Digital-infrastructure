import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

export const TEAM_PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: "TEAM_DASHBOARD_VIEW",
  SCHOOLS_VIEW_ALL: "SCHOOLS_VIEW_ALL",
  SCHOOLS_VIEW_ASSIGNED: "SCHOOLS_VIEW_ASSIGNED",
  SCHOOLS_CREATE: "SCHOOLS_CREATE",
  SCHOOLS_UPDATE: "SCHOOLS_UPDATE",
  SCHOOLS_ASSIGN: "SCHOOLS_ASSIGN",
  CONTACTS_MANAGE: "CONTACTS_MANAGE",
  ACTIVITIES_MANAGE: "ACTIVITIES_MANAGE",
  OPPORTUNITIES_MANAGE: "OPPORTUNITIES_MANAGE",
  OPPORTUNITIES_ADVANCE_LATE: "OPPORTUNITIES_ADVANCE_LATE",
  TASKS_MANAGE: "TASKS_MANAGE",
  MEETINGS_MANAGE: "MEETINGS_MANAGE",
  PROPOSALS_MANAGE: "PROPOSALS_MANAGE",
  PROPOSALS_APPROVE: "PROPOSALS_APPROVE",
  DISCOUNTS_APPROVE: "DISCOUNTS_APPROVE",
  ONBOARDING_MANAGE: "ONBOARDING_MANAGE",
  ONBOARDING_APPROVE_GO_LIVE: "ONBOARDING_APPROVE_GO_LIVE",
  SUBSCRIPTIONS_VIEW: "SUBSCRIPTIONS_VIEW",
  SUBSCRIPTIONS_MANAGE: "SUBSCRIPTIONS_MANAGE",
  PAYMENTS_CONFIRM: "PAYMENTS_CONFIRM",
  SUPPORT_MANAGE: "SUPPORT_MANAGE",
  SUPPORT_VIEW_ALL: "SUPPORT_VIEW_ALL",
  TEAM_MEMBERS_MANAGE: "TEAM_MEMBERS_MANAGE",
  REPORTS_VIEW: "REPORTS_VIEW",
  FINANCE_VIEW: "FINANCE_VIEW",
  AUDIT_VIEW: "AUDIT_VIEW",
  SETTINGS_MANAGE: "SETTINGS_MANAGE",
  DATA_EXPORT: "DATA_EXPORT",
})

export function hasTeamPermission(user, permission) {
  const expected = String(permission || "").toUpperCase()
  return Array.isArray(user?.permissions) && user.permissions.includes(expected)
}

export function hasAnyTeamPermission(user, permissions = []) {
  return permissions.some((permission) => hasTeamPermission(user, permission))
}

export function isPlatformOwner(user) {
  return Array.isArray(user?.roles) && user.roles.includes("platform_owner")
}

function migrationRequired(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code)
}

export async function loadTeamPrincipal(userId, connection = pool) {
  try {
    const [[user], [roles], [permissions]] = await Promise.all([
      connection.query(
        `SELECT id,public_ref,full_name,email,job_title,phone,must_change_password,is_active,last_login_at
         FROM team_users WHERE id=? LIMIT 1`,
        [userId],
      ),
      connection.query(
        `SELECT role.code,role.name
         FROM team_user_roles user_role
         JOIN team_roles role ON role.id=user_role.role_id
         WHERE user_role.user_id=? ORDER BY role.name`,
        [userId],
      ),
      connection.query(
        `SELECT DISTINCT permission.code
         FROM team_user_roles user_role
         JOIN team_role_permissions role_permission ON role_permission.role_id=user_role.role_id
         JOIN team_permissions permission ON permission.id=role_permission.permission_id
         WHERE user_role.user_id=? ORDER BY permission.code`,
        [userId],
      ),
    ])
    if (!user || !user.is_active) throw new HttpError(401, "This Team Suite account is disabled or unavailable")
    return {
      id: Number(user.id),
      publicRef: user.public_ref,
      fullName: user.full_name,
      email: user.email,
      jobTitle: user.job_title,
      phone: user.phone,
      mustChangePassword: Boolean(user.must_change_password),
      roles: roles.map((item) => item.code),
      roleLabels: roles.map((item) => item.name),
      permissions: permissions.map((item) => item.code),
      lastLoginAt: user.last_login_at,
      workspace: "team",
    }
  } catch (error) {
    if (migrationRequired(error)) {
      throw new HttpError(503, "SmartLink Team Suite is not installed yet. Apply database migration 066.", {
        code: "TEAM_SUITE_MIGRATION_REQUIRED",
      })
    }
    throw error
  }
}

export function requireTeamPermission(...allowedPermissions) {
  return function teamPermissionGuard(req, _res, next) {
    if (!req.teamUser) throw new HttpError(401, "Team authentication required")
    if (!hasAnyTeamPermission(req.teamUser, allowedPermissions)) {
      throw new HttpError(403, "You do not have permission to perform this Team Suite action")
    }
    next()
  }
}

export async function resolveTeamSchool(connection, publicRef) {
  const [[school]] = await connection.query(
    `SELECT * FROM team_school_prospects WHERE public_ref=? AND archived_at IS NULL LIMIT 1`,
    [String(publicRef || "")],
  )
  if (!school) throw new HttpError(404, "School prospect was not found")
  return school
}

export async function canAccessTeamSchool(connection, user, schoolId) {
  if (hasTeamPermission(user, TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL)) return true
  if (!hasTeamPermission(user, TEAM_PERMISSIONS.SCHOOLS_VIEW_ASSIGNED)) return false
  const [[scope]] = await connection.query(
    `SELECT EXISTS(
       SELECT 1 FROM team_school_prospects school
       WHERE school.id=? AND school.archived_at IS NULL AND school.assigned_user_id=?
       UNION ALL
       SELECT 1 FROM team_sales_opportunities opportunity
       WHERE opportunity.school_id=? AND (opportunity.assigned_owner_id=? OR opportunity.implementation_owner_id=?) AND opportunity.archived_at IS NULL
       UNION ALL
       SELECT 1 FROM team_onboarding_projects onboarding
       WHERE onboarding.school_id=? AND onboarding.implementation_owner_id=?
       UNION ALL
       SELECT 1 FROM team_support_tickets ticket
       WHERE ticket.school_id=? AND ticket.assigned_user_id=?
     ) allowed`,
    [schoolId, user.id, schoolId, user.id, user.id, schoolId, user.id, schoolId, user.id],
  )
  return Boolean(scope?.allowed)
}

export async function assertTeamSchoolAccess(connection, user, schoolId) {
  if (!(await canAccessTeamSchool(connection, user, schoolId))) {
    // Intentionally return 404 so record existence is not disclosed across assignments.
    throw new HttpError(404, "School prospect was not found")
  }
}


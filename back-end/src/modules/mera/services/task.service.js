import { prisma } from "../../../db/prisma.js"
import { badRequest, notFound } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"
import { hasMeraPermission, MERA_PERMISSIONS, MERA_ROLES } from "../permissions.js"
import { logMeraAudit } from "./audit.service.js"

export const TASK_TYPES = Object.freeze([
  "CASE_REVIEW",
  "COMPLAINT_REVIEW",
  "STATION_INSPECTION",
  "HOARDING_INVESTIGATION",
  "PRICE_VIOLATION_REVIEW",
  "QUEUE_DISORDER_REVIEW",
  "TELEMETRY_MISMATCH_REVIEW",
  "FIELD_VISIT",
  "MANUAL_TASK",
])

export const TASK_PRIORITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
export const TASK_STATUSES = Object.freeze([
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "NEEDS_MORE_INFO",
  "ESCALATED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
])

const CLOSED_STATUSES = new Set(["COMPLETED", "CANCELLED", "REJECTED"])
const COMPLETABLE_STATUSES = new Set(["IN_PROGRESS", "ESCALATED", "NEEDS_MORE_INFO"])
const MANAGER_ROLES = new Set([MERA_ROLES.SUPER_ADMIN, MERA_ROLES.REGIONAL_COMPLIANCE_SUPERVISOR])
const WORKING_ROLES = new Set([
  MERA_ROLES.SUPER_ADMIN,
  MERA_ROLES.NATIONAL_OPERATIONS_ANALYST,
  MERA_ROLES.REGIONAL_COMPLIANCE_SUPERVISOR,
  MERA_ROLES.FIELD_COMPLIANCE_OFFICER,
  MERA_ROLES.PUBLIC_COMPLAINTS_ANALYST,
  MERA_ROLES.LEGAL_ENFORCEMENT_OFFICER,
  MERA_ROLES.LICENSING_OFFICER,
  MERA_ROLES.MARKET_SUPPLY_ANALYST,
])

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  ASSIGNED: new Set(["ACKNOWLEDGED", "IN_PROGRESS", "CANCELLED"]),
  ACKNOWLEDGED: new Set(["IN_PROGRESS", "NEEDS_MORE_INFO", "ESCALATED", "CANCELLED"]),
  IN_PROGRESS: new Set(["NEEDS_MORE_INFO", "ESCALATED", "COMPLETED", "CANCELLED"]),
  NEEDS_MORE_INFO: new Set(["IN_PROGRESS", "ESCALATED", "CANCELLED"]),
  ESCALATED: new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  COMPLETED: new Set(["IN_PROGRESS"]),
  REJECTED: new Set([]),
  CANCELLED: new Set([]),
})

function forbidden(message = "Forbidden") {
  const error = new Error(message)
  error.status = 403
  return error
}

function toInteger(value, fallback = 0) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) ? normalized : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizePagination({ page = 1, limit = 20 } = {}) {
  const normalizedPage = clamp(toInteger(page, 1), 1, 500)
  const normalizedLimit = clamp(toInteger(limit, 20), 1, 100)
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  }
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase()
}

function normalizeOptionalString(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

function toDateOrNull(value, label = "date") {
  if (value === undefined || value === null || String(value).trim() === "") return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${label}`)
  return date
}

function districtFilterValue(auth) {
  return String(auth?.districtScope || "").trim()
}

function hasDistrictScope(auth) {
  return Boolean(districtFilterValue(auth))
}

function ensureDistrictAccess(auth, district, label = "record") {
  if (!hasDistrictScope(auth)) return
  const actorDistrict = districtFilterValue(auth).toLowerCase()
  const targetDistrict = String(district || "").trim().toLowerCase()
  if (!targetDistrict || actorDistrict !== targetDistrict) {
    throw forbidden(`You do not have access to this ${label}`)
  }
}

function actorAuditContext(actor = null, overrides = {}) {
  return {
    actorId: actor?.userId || null,
    actorName: actor?.fullName || null,
    actorRole: actor?.role || null,
    permissionUsed: actor?.permissionUsed || null,
    ipAddress: actor?.ipAddress || null,
    deviceInfo: actor?.deviceInfo || null,
    ...overrides,
  }
}

function canManageTasks(auth) {
  const role = normalizeUpper(auth?.role)
  return (
    MANAGER_ROLES.has(role) ||
    hasMeraPermission(auth, MERA_PERMISSIONS.TASKS_MANAGE) ||
    hasMeraPermission(auth, MERA_PERMISSIONS.TASKS_ASSIGN)
  )
}

function canViewAllTasks(auth) {
  return canManageTasks(auth) || hasMeraPermission(auth, MERA_PERMISSIONS.TASKS_VIEW_ALL)
}

function canExecutiveViewTasks(auth) {
  return hasMeraPermission(auth, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE)
}

function canWorkTasks(auth) {
  const role = normalizeUpper(auth?.role)
  return WORKING_ROLES.has(role) || hasMeraPermission(auth, MERA_PERMISSIONS.TASKS_WORK)
}

function isOverdueTask(task) {
  if (!task?.due_at && !task?.dueAt) return false
  const status = normalizeUpper(task?.status)
  if (CLOSED_STATUSES.has(status)) return false
  const due = new Date(task.due_at || task.dueAt)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

function isExecutiveVisibleTask(task) {
  const status = normalizeUpper(task?.status)
  const priority = normalizeUpper(task?.priority)
  return priority === "HIGH" || priority === "CRITICAL" || status === "COMPLETED" || isOverdueTask(task)
}

function validateEnum(value, allowed, label) {
  const normalized = normalizeUpper(value)
  if (!allowed.includes(normalized)) throw badRequest(`Invalid ${label}`)
  return normalized
}

function normalizeLinkedEntityType(value) {
  const normalized = normalizeUpper(value)
  if (!normalized) return null
  if (normalized === "FLAG") return "COMPLIANCE_FLAG"
  if (normalized === "HOARDING_ALERT") return "HOARDING_RISK_ALERT"
  return normalized
}

function normalizeTaskNumber(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (!scoped) throw badRequest("taskNumber is required")
  return scoped
}

async function resolveMeraUserByPublicId(userPublicId, label = "MERA user") {
  const scopedPublicId = normalizeOptionalString(userPublicId)
  if (!scopedPublicId) throw badRequest(`${label} is required`)
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.district_scope,
      mu.account_status,
      mr.code AS role_code,
      mr.display_name AS role_display_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.public_id = ${scopedPublicId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw notFound(`${label} not found`)
  return user
}

async function resolveStationByPublicId(stationPublicId) {
  const scopedPublicId = normalizeOptionalString(stationPublicId)
  if (!scopedPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address
    FROM stations
    WHERE public_id = ${scopedPublicId}
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  return station
}

async function generateTaskNumber() {
  const year = new Date().getFullYear()
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(MAX(CAST(SUBSTRING(task_number, 11) AS UNSIGNED)), 0) + 1 AS next_number
    FROM regulator_tasks
    WHERE task_number LIKE ${`TASK-${year}-%`}
  `
  const nextNumber = Number(rows?.[0]?.next_number || 1)
  return `TASK-${year}-${String(nextNumber).padStart(6, "0")}`
}

async function logTaskActivity({
  taskId,
  actorUserId = null,
  action,
  oldValue = null,
  newValue = null,
  metadata = null,
  db = prisma,
}) {
  await db.$executeRaw`
    INSERT INTO regulator_task_activity_logs (
      task_id,
      actor_user_id,
      action,
      old_value,
      new_value,
      metadata_json
    )
    VALUES (
      ${taskId},
      ${actorUserId || null},
      ${String(action || "").trim().toUpperCase()},
      ${oldValue === undefined ? null : oldValue},
      ${newValue === undefined ? null : newValue},
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `
}

async function createNotification({
  userId,
  type,
  title,
  message,
  linkedEntityType = "REGULATOR_TASK",
  linkedEntityId = null,
  db = prisma,
}) {
  if (!userId) return null
  const allowedNotificationTypes = new Set([
    "TASK_ASSIGNED",
    "TASK_REASSIGNED",
    "TASK_DUE_SOON",
    "TASK_OVERDUE",
    "TASK_STATUS_CHANGED",
    "TASK_ESCALATED",
    "TASK_COMPLETED",
  ])
  const requestedType = normalizeUpper(type)
  const notificationType = allowedNotificationTypes.has(requestedType) ? requestedType : "TASK_STATUS_CHANGED"
  const publicId = createPublicId()
  const scopedTitle = String(title || "").trim().slice(0, 180) || "MERA task update"
  const scopedMessage = String(message || "").trim() || "A MERA task was updated."
  const scopedLinkedEntityType = normalizeOptionalString(linkedEntityType)
  const scopedLinkedEntityId = normalizeOptionalString(linkedEntityId)

  const insertNotification = (scopedType) => db.$executeRaw`
    INSERT INTO mera_notifications (
      public_id,
      user_id,
      type,
      title,
      message,
      linked_entity_type,
      linked_entity_id
    )
    VALUES (
      ${publicId},
      ${userId},
      ${scopedType},
      ${scopedTitle},
      ${scopedMessage},
      ${scopedLinkedEntityType},
      ${scopedLinkedEntityId}
    )
  `

  try {
    await insertNotification(notificationType)
  } catch (error) {
    const messageText = String(error?.message || "")
    if (!messageText.includes("Data truncated for column 'type'") || notificationType !== "TASK_STATUS_CHANGED") {
      throw error
    }
    await insertNotification("TASK_ASSIGNED")
  }
  return publicId
}

function formatTaskStatusLabel(status) {
  return normalizeUpper(status).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function notificationTypeForTaskStatus(status) {
  const normalized = normalizeUpper(status)
  if (normalized === "COMPLETED") return "TASK_COMPLETED"
  if (normalized === "ESCALATED") return "TASK_ESCALATED"
  return "TASK_STATUS_CHANGED"
}

async function notifyTaskStatusParticipants(task, actor, nextStatus, { reason = null, db = prisma } = {}) {
  const recipientIds = Array.from(
    new Set([task.assigned_to_user_id, task.assigned_by_user_id]
      .map((value) => Number(value || 0))
      .filter((value) => value && value !== Number(actor?.userId || 0)))
  )
  if (!recipientIds.length) return

  const statusLabel = formatTaskStatusLabel(nextStatus)
  const actorName = actor?.fullName || "A MERA officer"
  const reasonSuffix = reason ? ` Reason: ${reason}` : ""

  for (const userId of recipientIds) {
    await createNotification({
      userId,
      type: notificationTypeForTaskStatus(nextStatus),
      title: `Task ${statusLabel}: ${task.task_number}`,
      message: `${actorName} changed ${task.title} from ${formatTaskStatusLabel(task.status)} to ${statusLabel}.${reasonSuffix}`,
      linkedEntityId: task.task_number,
      db,
    })
  }
}

async function listSupervisorUsersForTask(task) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT mu.id, mu.public_id, mu.full_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    INNER JOIN mera_role_permissions mrp ON mrp.role_id = mr.id
    INNER JOIN mera_permissions mp ON mp.id = mrp.permission_id
    WHERE mu.account_status = 'ACTIVE'
      AND mp.code IN ('TASKS_VIEW_ALL', 'TASKS_MANAGE')
      AND (
        ${String(task?.district || "").trim() === ""} = TRUE
        OR mu.district_scope IS NULL
        OR mu.district_scope = ''
        OR mu.district_scope = ${String(task?.district || "").trim()}
      )
  `
  return rows || []
}

async function notifySupervisors(task, notification, excludedUserIds = []) {
  const excluded = new Set(
    [task?.assigned_to_user_id, ...excludedUserIds]
      .map((value) => Number(value || 0))
      .filter(Boolean)
  )
  const users = await listSupervisorUsersForTask(task)
  await Promise.all(
    users
      .filter((user) => !excluded.has(Number(user.id)))
      .map((user) =>
        createNotification({
          userId: user.id,
          linkedEntityId: task.task_number,
          ...notification,
        }).catch(() => null)
      )
  )
}

function mapTaskRow(row) {
  if (!row) return null
  const dueAt = row.due_at || null
  const status = normalizeUpper(row.status)
  return {
    id: row.id,
    taskNumber: row.task_number,
    title: row.title,
    description: row.description,
    type: row.type,
    category: row.category || null,
    priority: row.priority,
    status,
    district: row.district || null,
    stationId: row.station_public_id || null,
    stationPublicId: row.station_public_id || null,
    stationName: row.station_name || row.task_station_name || null,
    linkedEntityType: row.linked_entity_type || null,
    linkedEntityId: row.linked_entity_id || null,
    evidenceSummary: row.evidence_summary || null,
    dueAt,
    acknowledgedAt: row.acknowledged_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    escalatedAt: row.escalated_at || null,
    completionNotes: row.completion_notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    isOverdue: isOverdueTask({ due_at: dueAt, status }),
    assignedTo: row.assigned_to_public_id
      ? {
          publicId: row.assigned_to_public_id,
          fullName: row.assigned_to_name,
          email: row.assigned_to_email || null,
          role: row.assigned_to_role || null,
          roleDisplayName: row.assigned_to_role_display_name || null,
          district: row.assigned_to_district || null,
        }
      : null,
    assignedBy: row.assigned_by_public_id
      ? {
          publicId: row.assigned_by_public_id,
          fullName: row.assigned_by_name,
          email: row.assigned_by_email || null,
          role: row.assigned_by_role || null,
          roleDisplayName: row.assigned_by_role_display_name || null,
        }
      : null,
  }
}

async function getTaskRowByNumber(taskNumber) {
  const rows = await prisma.$queryRaw`
    SELECT
      rt.*,
      s.public_id AS station_public_id,
      s.name AS task_station_name,
      assigned_to.public_id AS assigned_to_public_id,
      assigned_to.full_name AS assigned_to_name,
      assigned_to.email AS assigned_to_email,
      assigned_to.district_scope AS assigned_to_district,
      assigned_to_role.code AS assigned_to_role,
      assigned_to_role.display_name AS assigned_to_role_display_name,
      assigned_by.public_id AS assigned_by_public_id,
      assigned_by.full_name AS assigned_by_name,
      assigned_by.email AS assigned_by_email,
      assigned_by_role.code AS assigned_by_role,
      assigned_by_role.display_name AS assigned_by_role_display_name
    FROM regulator_tasks rt
    LEFT JOIN stations s ON s.id = rt.station_id
    INNER JOIN mera_users assigned_to ON assigned_to.id = rt.assigned_to_user_id
    INNER JOIN mera_roles assigned_to_role ON assigned_to_role.id = assigned_to.role_id
    INNER JOIN mera_users assigned_by ON assigned_by.id = rt.assigned_by_user_id
    INNER JOIN mera_roles assigned_by_role ON assigned_by_role.id = assigned_by.role_id
    WHERE rt.task_number = ${normalizeTaskNumber(taskNumber)}
      AND rt.deleted_at IS NULL
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) throw notFound("Task not found")
  return row
}

function ensureTaskVisible(auth, task) {
  if (canViewAllTasks(auth)) {
    ensureDistrictAccess(auth, task.district, "task")
    return
  }
  if (Number(task.assigned_to_user_id) === Number(auth?.userId || 0)) return
  if (canExecutiveViewTasks(auth) && isExecutiveVisibleTask(task)) return
  throw forbidden("You do not have access to this task")
}

function ensureTaskWorker(auth, task) {
  if (canManageTasks(auth)) {
    ensureDistrictAccess(auth, task.district, "task")
    return
  }
  if (Number(task.assigned_to_user_id) === Number(auth?.userId || 0) && canWorkTasks(auth)) return
  throw forbidden("You cannot update this task")
}

function ensureAssignableUser(user, actor) {
  const status = normalizeUpper(user.account_status)
  if (status !== "ACTIVE") throw badRequest("Assigned MERA user must be active")
  const role = normalizeUpper(user.role_code)
  if (!WORKING_ROLES.has(role)) throw badRequest("Selected MERA user cannot receive task assignments")
  if (hasDistrictScope(actor)) ensureDistrictAccess(actor, user.district_scope, "assignee")
}

async function getLinkedEntitySummary(linkedEntityType, linkedEntityId, auth = null) {
  const type = normalizeLinkedEntityType(linkedEntityType)
  const id = normalizeOptionalString(linkedEntityId)
  if (!type || !id) return null

  if (type === "COMPLAINT") {
    const rows = await prisma.$queryRaw`
      SELECT
        pc.public_id,
        pc.complaint_type,
        pc.complaint_status,
        pc.complaint_description,
        pc.created_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city AS district
      FROM public_complaints pc
      INNER JOIN stations s ON s.id = pc.station_id
      WHERE pc.public_id = ${id}
      LIMIT 1
    `
    const row = rows?.[0]
    if (!row) return { type, id }
    ensureDistrictAccess(auth, row.district, "linked complaint")
    return {
      type,
      id: row.public_id,
      title: `${row.complaint_type} complaint`,
      status: row.complaint_status,
      description: row.complaint_description,
      station: { publicId: row.station_public_id, name: row.station_name, district: row.district || null },
      createdAt: row.created_at,
    }
  }

  if (type === "STATION" || type === "HOARDING_RISK_ALERT") {
    const rows = await prisma.$queryRaw`
      SELECT
        s.public_id,
        s.name,
        s.city,
        s.address,
        scs.availability_status
      FROM stations s
      LEFT JOIN station_current_status scs ON scs.station_id = s.id
      WHERE s.public_id = ${id}
      LIMIT 1
    `
    const row = rows?.[0]
    if (!row) return { type, id }
    ensureDistrictAccess(auth, row.city, "linked station")
    return {
      type,
      id: row.public_id,
      title: row.name,
      status: row.availability_status || null,
      station: { publicId: row.public_id, name: row.name, district: row.city || null, address: row.address || null },
    }
  }

  if (type === "INSPECTION") {
    const rows = await prisma.$queryRaw`
      SELECT
        i.public_id,
        i.inspection_type,
        i.inspection_status,
        i.officer_notes,
        i.created_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city AS district
      FROM inspections i
      INNER JOIN stations s ON s.id = i.station_id
      WHERE i.public_id = ${id}
      LIMIT 1
    `
    const row = rows?.[0]
    if (!row) return { type, id }
    ensureDistrictAccess(auth, row.district, "linked inspection")
    return {
      type,
      id: row.public_id,
      title: `${row.inspection_type} inspection`,
      status: row.inspection_status,
      description: row.officer_notes || null,
      station: { publicId: row.station_public_id, name: row.station_name, district: row.district || null },
      createdAt: row.created_at,
    }
  }

  if (type === "COMPLIANCE_FLAG") {
    const rows = await prisma.$queryRaw`
      SELECT
        cf.public_id,
        cf.flag_type,
        cf.severity,
        cf.resolved_status,
        cf.generated_reason,
        cf.created_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city AS district
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.public_id = ${id}
      LIMIT 1
    `
    const row = rows?.[0]
    if (!row) return { type, id }
    ensureDistrictAccess(auth, row.district, "linked flag")
    return {
      type,
      id: row.public_id,
      title: `${row.flag_type} flag`,
      status: row.resolved_status,
      priority: row.severity,
      description: row.generated_reason,
      station: { publicId: row.station_public_id, name: row.station_name, district: row.district || null },
      createdAt: row.created_at,
    }
  }

  if (type === "ENFORCEMENT_ACTION") {
    const rows = await prisma.$queryRaw`
      SELECT
        ea.public_id,
        ea.action_type,
        ea.action_status,
        ea.action_notes,
        ea.issued_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city AS district
      FROM enforcement_actions ea
      INNER JOIN stations s ON s.id = ea.station_id
      WHERE ea.public_id = ${id}
      LIMIT 1
    `
    const row = rows?.[0]
    if (!row) return { type, id }
    ensureDistrictAccess(auth, row.district, "linked enforcement action")
    return {
      type,
      id: row.public_id,
      title: `${row.action_type} enforcement action`,
      status: row.action_status,
      description: row.action_notes || null,
      station: { publicId: row.station_public_id, name: row.station_name, district: row.district || null },
      createdAt: row.issued_at,
    }
  }

  return { type, id, title: `${type} ${id}` }
}

async function getTaskDetails(task, auth) {
  const canSeeSupervisorOnly = canManageTasks(auth)
  const [noteRows, activityRows, evidenceRows, linkedEntitySummary] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        rtn.id,
        rtn.note,
        rtn.visibility,
        rtn.created_at,
        rtn.updated_at,
        mu.public_id AS author_public_id,
        mu.full_name AS author_name,
        mr.code AS author_role
      FROM regulator_task_notes rtn
      INNER JOIN mera_users mu ON mu.id = rtn.author_user_id
      INNER JOIN mera_roles mr ON mr.id = mu.role_id
      WHERE rtn.task_id = ${task.id}
        AND (${canSeeSupervisorOnly} = TRUE OR rtn.visibility = 'INTERNAL')
      ORDER BY rtn.created_at ASC
    `,
    prisma.$queryRaw`
      SELECT
        rtal.id,
        rtal.action,
        rtal.old_value,
        rtal.new_value,
        rtal.metadata_json,
        rtal.created_at,
        mu.public_id AS actor_public_id,
        mu.full_name AS actor_name,
        mr.code AS actor_role
      FROM regulator_task_activity_logs rtal
      LEFT JOIN mera_users mu ON mu.id = rtal.actor_user_id
      LEFT JOIN mera_roles mr ON mr.id = mu.role_id
      WHERE rtal.task_id = ${task.id}
      ORDER BY rtal.created_at ASC
    `,
    prisma.$queryRaw`
      SELECT
        rte.id,
        rte.evidence_type,
        rte.title,
        rte.description,
        rte.file_url,
        rte.linked_existing_evidence_id,
        rte.created_at,
        mu.public_id AS uploaded_by_public_id,
        mu.full_name AS uploaded_by_name
      FROM regulator_task_evidence rte
      INNER JOIN mera_users mu ON mu.id = rte.uploaded_by_user_id
      WHERE rte.task_id = ${task.id}
      ORDER BY rte.created_at DESC
    `,
    getLinkedEntitySummary(task.linked_entity_type, task.linked_entity_id, auth).catch(() => null),
  ])

  return {
    ...mapTaskRow(task),
    linkedEntitySummary,
    notes: (noteRows || []).map((row) => ({
      id: row.id,
      note: row.note,
      visibility: row.visibility,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: {
        publicId: row.author_public_id,
        fullName: row.author_name,
        role: row.author_role,
      },
    })),
    activityLogs: (activityRows || []).map((row) => ({
      id: row.id,
      action: row.action,
      oldValue: row.old_value || null,
      newValue: row.new_value || null,
      metadata: row.metadata_json || null,
      createdAt: row.created_at,
      actor: row.actor_public_id
        ? {
            publicId: row.actor_public_id,
            fullName: row.actor_name,
            role: row.actor_role,
          }
        : null,
    })),
    evidence: (evidenceRows || []).map((row) => ({
      id: row.id,
      evidenceType: row.evidence_type,
      title: row.title,
      description: row.description || null,
      fileUrl: row.file_url || null,
      linkedExistingEvidenceId: row.linked_existing_evidence_id || null,
      createdAt: row.created_at,
      uploadedBy: {
        publicId: row.uploaded_by_public_id,
        fullName: row.uploaded_by_name,
      },
    })),
  }
}

export async function listTasks(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = normalizeUpper(filters.status)
  const priorityFilter = normalizeUpper(filters.priority)
  const typeFilter = normalizeUpper(filters.type)
  const districtFilter = normalizeOptionalString(filters.district)
  const stationFilter = normalizeOptionalString(filters.stationId || filters.stationPublicId)
  const assignedToFilter = normalizeOptionalString(filters.assignedTo || filters.assignedToUserPublicId)
  const linkedEntityTypeFilter = normalizeLinkedEntityType(filters.linkedEntityType)
  const linkedEntityIdFilter = normalizeOptionalString(filters.linkedEntityId)
  const search = normalizeOptionalString(filters.search)
  const searchLike = search ? `%${search}%` : ""
  const overdueOnly = String(filters.overdue || "").trim().toLowerCase() === "true"
  const fromDate = toDateOrNull(filters.from, "from date")
  const toDate = toDateOrNull(filters.to, "to date")
  const scopedDistrict = districtFilterValue(auth)
  const viewAll = canViewAllTasks(auth)
  const executiveView = canExecutiveViewTasks(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      rt.*,
      s.public_id AS station_public_id,
      s.name AS task_station_name,
      assigned_to.public_id AS assigned_to_public_id,
      assigned_to.full_name AS assigned_to_name,
      assigned_to.email AS assigned_to_email,
      assigned_to.district_scope AS assigned_to_district,
      assigned_to_role.code AS assigned_to_role,
      assigned_to_role.display_name AS assigned_to_role_display_name,
      assigned_by.public_id AS assigned_by_public_id,
      assigned_by.full_name AS assigned_by_name,
      assigned_by.email AS assigned_by_email,
      assigned_by_role.code AS assigned_by_role,
      assigned_by_role.display_name AS assigned_by_role_display_name
    FROM regulator_tasks rt
    LEFT JOIN stations s ON s.id = rt.station_id
    INNER JOIN mera_users assigned_to ON assigned_to.id = rt.assigned_to_user_id
    INNER JOIN mera_roles assigned_to_role ON assigned_to_role.id = assigned_to.role_id
    INNER JOIN mera_users assigned_by ON assigned_by.id = rt.assigned_by_user_id
    INNER JOIN mera_roles assigned_by_role ON assigned_by_role.id = assigned_by.role_id
    WHERE rt.deleted_at IS NULL
      AND (${statusFilter === ""} = TRUE OR rt.status = ${statusFilter})
      AND (${priorityFilter === ""} = TRUE OR rt.priority = ${priorityFilter})
      AND (${typeFilter === ""} = TRUE OR rt.type = ${typeFilter})
      AND (${districtFilter === null} = TRUE OR rt.district = ${districtFilter})
      AND (${stationFilter === null} = TRUE OR s.public_id = ${stationFilter} OR CAST(rt.station_id AS CHAR) = ${stationFilter})
      AND (${assignedToFilter === null} = TRUE OR assigned_to.public_id = ${assignedToFilter})
      AND (${linkedEntityTypeFilter === null} = TRUE OR rt.linked_entity_type = ${linkedEntityTypeFilter})
      AND (${linkedEntityIdFilter === null} = TRUE OR rt.linked_entity_id = ${linkedEntityIdFilter})
      AND (${overdueOnly === false} = TRUE OR (rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')))
      AND (${fromDate === null} = TRUE OR rt.created_at >= ${fromDate})
      AND (${toDate === null} = TRUE OR rt.created_at <= ${toDate})
      AND (${search === null} = TRUE OR (
        rt.task_number LIKE ${searchLike}
        OR rt.title LIKE ${searchLike}
        OR rt.description LIKE ${searchLike}
        OR COALESCE(rt.station_name, s.name, '') LIKE ${searchLike}
        OR COALESCE(rt.district, '') LIKE ${searchLike}
      ))
      AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
      AND (
        ${viewAll} = TRUE
        OR rt.assigned_to_user_id = ${auth?.userId || 0}
        OR (
          ${executiveView} = TRUE
          AND (
            rt.priority IN ('HIGH', 'CRITICAL')
            OR rt.status = 'COMPLETED'
            OR (rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED'))
          )
        )
      )
    ORDER BY
      CASE rt.priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4
      END,
      COALESCE(rt.due_at, rt.created_at) ASC,
      rt.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map(mapTaskRow),
  }
}

async function groupCounts(whereAssignedToCurrentUser, auth) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT 'status' AS bucket, rt.status AS label, COUNT(*) AS value
    FROM regulator_tasks rt
    WHERE rt.deleted_at IS NULL
      AND (${whereAssignedToCurrentUser} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
    GROUP BY rt.status
    UNION ALL
    SELECT 'priority' AS bucket, rt.priority AS label, COUNT(*) AS value
    FROM regulator_tasks rt
    WHERE rt.deleted_at IS NULL
      AND (${whereAssignedToCurrentUser} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
    GROUP BY rt.priority
  `
  return {
    byStatus: Object.fromEntries((rows || []).filter((row) => row.bucket === "status").map((row) => [row.label, Number(row.value || 0)])),
    byPriority: Object.fromEntries((rows || []).filter((row) => row.bucket === "priority").map((row) => [row.label, Number(row.value || 0)])),
  }
}

export async function listMyTasks(filters = {}, auth = null) {
  const tasks = await listTasks({ ...filters, assignedTo: auth?.userPublicId }, auth)
  const counts = await groupCounts(true, auth)
  return {
    ...tasks,
    counts,
  }
}

export async function getTask(taskNumber, auth = null) {
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskVisible(auth, task)
  return getTaskDetails(task, auth)
}

export async function createTask(payload, actor) {
  if (!canManageTasks(actor) && !hasMeraPermission(actor, MERA_PERMISSIONS.TASKS_CREATE)) {
    throw forbidden("You cannot create tasks")
  }
  const assignedPublicId = payload.assignedToUserPublicId || payload.assignedToUserId
  const assignee = await resolveMeraUserByPublicId(assignedPublicId, "Assigned officer")
  ensureAssignableUser(assignee, actor)

  const station = await resolveStationByPublicId(payload.stationPublicId || payload.stationId)
  if (station) ensureDistrictAccess(actor, station.city, "station")
  const district = normalizeOptionalString(payload.district) || station?.city || assignee.district_scope || null
  if (district) ensureDistrictAccess(actor, district, "task district")

  const taskNumber = await generateTaskNumber()
  const type = validateEnum(payload.type, TASK_TYPES, "task type")
  const priority = validateEnum(payload.priority || "MEDIUM", TASK_PRIORITIES, "task priority")
  const dueAt = toDateOrNull(payload.dueAt, "due date")
  const linkedEntityType = normalizeLinkedEntityType(payload.linkedEntityType)
  const linkedEntityId = normalizeOptionalString(payload.linkedEntityId)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO regulator_tasks (
        task_number,
        title,
        description,
        type,
        category,
        priority,
        status,
        district,
        station_id,
        station_name,
        linked_entity_type,
        linked_entity_id,
        evidence_summary,
        assigned_to_user_id,
        assigned_by_user_id,
        due_at
      )
      VALUES (
        ${taskNumber},
        ${payload.title},
        ${payload.description},
        ${type},
        ${normalizeOptionalString(payload.category)},
        ${priority},
        'ASSIGNED',
        ${district},
        ${station?.id || null},
        ${normalizeOptionalString(payload.stationName) || station?.name || null},
        ${linkedEntityType},
        ${linkedEntityId},
        ${normalizeOptionalString(payload.evidenceSummary)},
        ${assignee.id},
        ${actor.userId},
        ${dueAt}
      )
    `
    const rows = await tx.$queryRaw`
      SELECT id
      FROM regulator_tasks
      WHERE task_number = ${taskNumber}
      LIMIT 1
    `
    const taskId = rows?.[0]?.id
    if (!linkedEntityId && ["STATION_INSPECTION", "FIELD_VISIT"].includes(type) && station?.id) {
      const inspectionPublicId = createPublicId()
      await tx.$executeRaw`
        INSERT INTO inspections (
          public_id,
          station_id,
          officer_id,
          inspection_type,
          reason,
          priority,
          scheduled_at,
          status,
          inspection_status,
          stock_visible,
          illegal_vending_detected
        )
        VALUES (
          ${inspectionPublicId},
          ${station.id},
          ${assignee.id},
          ${type === "STATION_INSPECTION" ? "ROUTINE" : "SPOT_CHECK"},
          ${payload.description || payload.title || "Inspection task"},
          ${String(priority || "MEDIUM").toLowerCase()},
          ${dueAt},
          'scheduled',
          'OPEN',
          1,
          0
        )
      `
      await tx.$executeRaw`
        UPDATE regulator_tasks
        SET linked_entity_type = 'INSPECTION',
            linked_entity_id = ${inspectionPublicId},
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${taskId}
      `
    }
    await logTaskActivity({
      taskId,
      actorUserId: actor.userId,
      action: "TASK_CREATED",
      newValue: taskNumber,
      metadata: {
        assignedTo: assignee.public_id,
        type,
        priority,
      },
      db: tx,
    })
    await tx.$executeRaw`
      INSERT IGNORE INTO regulator_task_watchers (task_id, user_id)
      VALUES (${taskId}, ${actor.userId})
    `
    await createNotification({
      userId: assignee.id,
      type: "TASK_ASSIGNED",
      title: `Task assigned: ${taskNumber}`,
      message: `${actor.fullName || "A MERA supervisor"} assigned you ${payload.title}.`,
      linkedEntityId: taskNumber,
      db: tx,
    })
  })

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_TASK_CREATED",
    actionDescription: `Task ${taskNumber} assigned to ${assignee.full_name}.`,
    affectedEntity: taskNumber,
  })

  return getTask(taskNumber, actor)
}

export async function updateTask(taskNumber, payload, actor) {
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  const manager = canManageTasks(actor)
  const updates = {}

  if (!manager) {
    const allowedOfficerKeys = new Set(["evidenceSummary"])
    const invalidKey = Object.keys(payload || {}).find((key) => !allowedOfficerKeys.has(key))
    if (invalidKey) throw forbidden("Only supervisors can edit task assignment details")
  }

  if (payload.title !== undefined) updates.title = String(payload.title || "").trim()
  if (payload.description !== undefined) updates.description = String(payload.description || "").trim()
  if (payload.type !== undefined) updates.type = validateEnum(payload.type, TASK_TYPES, "task type")
  if (payload.category !== undefined) updates.category = normalizeOptionalString(payload.category)
  if (payload.priority !== undefined) updates.priority = validateEnum(payload.priority, TASK_PRIORITIES, "task priority")
  if (payload.dueAt !== undefined) updates.dueAt = toDateOrNull(payload.dueAt, "due date")
  if (payload.district !== undefined) updates.district = normalizeOptionalString(payload.district)
  if (payload.stationName !== undefined) updates.stationName = normalizeOptionalString(payload.stationName)
  if (payload.linkedEntityType !== undefined) updates.linkedEntityType = normalizeLinkedEntityType(payload.linkedEntityType)
  if (payload.linkedEntityId !== undefined) updates.linkedEntityId = normalizeOptionalString(payload.linkedEntityId)
  if (payload.evidenceSummary !== undefined) updates.evidenceSummary = normalizeOptionalString(payload.evidenceSummary)

  let newAssignee = null
  if (payload.assignedToUserPublicId !== undefined || payload.assignedToUserId !== undefined) {
    if (!manager) throw forbidden("Only supervisors can reassign tasks")
    newAssignee = await resolveMeraUserByPublicId(payload.assignedToUserPublicId || payload.assignedToUserId, "Assigned officer")
    ensureAssignableUser(newAssignee, actor)
  }

  let newStation = null
  if (payload.stationPublicId !== undefined || payload.stationId !== undefined) {
    if (!manager) throw forbidden("Only supervisors can change linked station")
    newStation = await resolveStationByPublicId(payload.stationPublicId || payload.stationId)
    if (newStation) {
      ensureDistrictAccess(actor, newStation.city, "station")
      updates.district = updates.district || newStation.city || null
      updates.stationName = updates.stationName || newStation.name || null
    }
  }
  if (updates.district) ensureDistrictAccess(actor, updates.district, "task district")

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE regulator_tasks
      SET
        title = COALESCE(${updates.title ?? null}, title),
        description = COALESCE(${updates.description ?? null}, description),
        type = COALESCE(${updates.type ?? null}, type),
        category = ${updates.category === undefined ? task.category : updates.category},
        priority = COALESCE(${updates.priority ?? null}, priority),
        district = ${updates.district === undefined ? task.district : updates.district},
        station_id = ${newStation === null ? task.station_id : newStation?.id || null},
        station_name = ${updates.stationName === undefined ? task.station_name : updates.stationName},
        linked_entity_type = ${updates.linkedEntityType === undefined ? task.linked_entity_type : updates.linkedEntityType},
        linked_entity_id = ${updates.linkedEntityId === undefined ? task.linked_entity_id : updates.linkedEntityId},
        evidence_summary = ${updates.evidenceSummary === undefined ? task.evidence_summary : updates.evidenceSummary},
        assigned_to_user_id = ${newAssignee?.id || task.assigned_to_user_id},
        due_at = ${updates.dueAt === undefined ? task.due_at : updates.dueAt},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${task.id}
    `
    if (newAssignee && Number(newAssignee.id) !== Number(task.assigned_to_user_id)) {
      await logTaskActivity({
        taskId: task.id,
        actorUserId: actor.userId,
        action: "TASK_REASSIGNED",
        oldValue: task.assigned_to_public_id,
        newValue: newAssignee.public_id,
        db: tx,
      })
      await createNotification({
        userId: newAssignee.id,
        type: "TASK_REASSIGNED",
        title: `Task reassigned: ${task.task_number}`,
        message: `${actor.fullName || "A MERA supervisor"} reassigned ${task.title} to you.`,
        linkedEntityId: task.task_number,
        db: tx,
      })
    } else {
      await logTaskActivity({
        taskId: task.id,
        actorUserId: actor.userId,
        action: "TASK_UPDATED",
        metadata: Object.keys(updates),
        db: tx,
      })
    }
  })

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_TASK_UPDATED",
    actionDescription: `Task ${task.task_number} updated.`,
    affectedEntity: task.task_number,
  })

  return getTask(task.task_number, actor)
}

function assertTransitionAllowed(currentStatus, nextStatus, actor, reason) {
  const current = normalizeUpper(currentStatus)
  const next = validateEnum(nextStatus, TASK_STATUSES, "task status")
  if (current === next) return next
  if (current === "COMPLETED" && next === "IN_PROGRESS") {
    if (!canManageTasks(actor)) throw forbidden("Only supervisors can reopen completed tasks")
    if (!String(reason || "").trim()) throw badRequest("A reopen reason is required")
    return next
  }
  if (!ALLOWED_STATUS_TRANSITIONS[current]?.has(next)) {
    throw badRequest(`Cannot move task from ${current} to ${next}`)
  }
  if (next === "COMPLETED") {
    throw badRequest("Use the complete endpoint with completion notes")
  }
  if (next === "ESCALATED" && !String(reason || "").trim()) {
    throw badRequest("Escalation reason is required")
  }
  if (next === "CANCELLED" && !canManageTasks(actor)) {
    throw forbidden("Only supervisors can cancel tasks")
  }
  return next
}

export async function changeTaskStatus(taskNumber, payload, actor) {
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  const nextStatus = assertTransitionAllowed(task.status, payload.status, actor, payload.reason)
  const now = new Date()
  const reason = normalizeOptionalString(payload.reason)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE regulator_tasks
      SET
        status = ${nextStatus},
        acknowledged_at = CASE WHEN ${nextStatus} = 'ACKNOWLEDGED' AND acknowledged_at IS NULL THEN ${now} ELSE acknowledged_at END,
        started_at = CASE WHEN ${nextStatus} = 'IN_PROGRESS' AND started_at IS NULL THEN ${now} ELSE started_at END,
        escalated_at = CASE WHEN ${nextStatus} = 'ESCALATED' THEN ${now} ELSE escalated_at END,
        cancelled_at = CASE WHEN ${nextStatus} = 'CANCELLED' THEN ${now} ELSE cancelled_at END,
        completed_at = CASE WHEN ${task.status} = 'COMPLETED' AND ${nextStatus} = 'IN_PROGRESS' THEN NULL ELSE completed_at END,
        completion_notes = CASE WHEN ${task.status} = 'COMPLETED' AND ${nextStatus} = 'IN_PROGRESS' THEN NULL ELSE completion_notes END,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${task.id}
    `
    if (String(task.linked_entity_type || "").toUpperCase() === "INSPECTION" && task.linked_entity_id) {
      await tx.$executeRaw`
        UPDATE inspections
        SET
          status = ${String(nextStatus).toLowerCase()},
          inspection_status = CASE
            WHEN ${nextStatus} = 'ESCALATED' THEN 'ESCALATED'
            WHEN ${nextStatus} IN ('CANCELLED', 'REJECTED') THEN 'CLOSED'
            ELSE 'OPEN'
          END,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE public_id = ${task.linked_entity_id}
      `
    }
    await logTaskActivity({
      taskId: task.id,
      actorUserId: actor.userId,
      action: nextStatus === "IN_PROGRESS" && task.status === "COMPLETED" ? "TASK_REOPENED" : "TASK_STATUS_CHANGED",
      oldValue: task.status,
      newValue: nextStatus,
      metadata: reason ? { reason } : null,
      db: tx,
    })
    if (reason && nextStatus !== "ESCALATED") {
      await tx.$executeRaw`
        INSERT INTO regulator_task_notes (task_id, author_user_id, note, visibility)
        VALUES (${task.id}, ${actor.userId}, ${reason}, 'INTERNAL')
      `
    }
    await notifyTaskStatusParticipants(task, actor, nextStatus, { reason, db: tx })
  })

  if (nextStatus === "ESCALATED") {
    const updated = await getTaskRowByNumber(task.task_number)
    await notifySupervisors(updated, {
      type: "TASK_ESCALATED",
      title: `Task escalated: ${task.task_number}`,
      message: `${actor.fullName || "A MERA officer"} escalated ${task.title}.`,
    }, [actor?.userId, task.assigned_by_user_id])
  }

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_TASK_STATUS_CHANGED",
    actionDescription: `Task ${task.task_number} moved from ${task.status} to ${nextStatus}.`,
    affectedEntity: task.task_number,
  })

  return getTask(task.task_number, actor)
}

export async function addTaskNote(taskNumber, payload, actor) {
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  const visibility = normalizeUpper(payload.visibility || "INTERNAL")
  if (!["INTERNAL", "SUPERVISOR_ONLY"].includes(visibility)) throw badRequest("Invalid note visibility")
  const note = String(payload.note || "").trim()
  if (!note) throw badRequest("Note is required")

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO regulator_task_notes (task_id, author_user_id, note, visibility)
      VALUES (${task.id}, ${actor.userId}, ${note}, ${visibility})
    `
    await logTaskActivity({
      taskId: task.id,
      actorUserId: actor.userId,
      action: "TASK_NOTE_ADDED",
      metadata: { visibility },
      db: tx,
    })
  })

  return getTask(task.task_number, actor)
}

export async function addTaskEvidence(taskNumber, payload, actor) {
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  if (!hasMeraPermission(actor, MERA_PERMISSIONS.TASKS_ADD_EVIDENCE) && !canManageTasks(actor)) {
    throw forbidden("You cannot add task evidence")
  }

  const evidenceType = normalizeOptionalString(payload.evidenceType) || "DOCUMENT"
  const title = normalizeOptionalString(payload.title) || "Task evidence"
  const fileUrl = normalizeOptionalString(payload.fileUrl)
  const linkedExistingEvidenceId = normalizeOptionalString(payload.linkedExistingEvidenceId)
  if (!fileUrl && !linkedExistingEvidenceId) throw badRequest("Evidence requires a file or linked evidence reference")

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO regulator_task_evidence (
        task_id,
        uploaded_by_user_id,
        evidence_type,
        title,
        description,
        file_url,
        linked_existing_evidence_id
      )
      VALUES (
        ${task.id},
        ${actor.userId},
        ${evidenceType},
        ${title},
        ${normalizeOptionalString(payload.description)},
        ${fileUrl},
        ${linkedExistingEvidenceId}
      )
    `
    await logTaskActivity({
      taskId: task.id,
      actorUserId: actor.userId,
      action: "TASK_EVIDENCE_ADDED",
      newValue: title,
      db: tx,
    })
  })

  return getTask(task.task_number, actor)
}

export async function escalateTask(taskNumber, payload, actor) {
  const reason = String(payload.reason || "").trim()
  if (!reason) throw badRequest("Escalation reason is required")
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  assertTransitionAllowed(task.status, "ESCALATED", actor, reason)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE regulator_tasks
      SET
        status = 'ESCALATED',
        escalated_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${task.id}
    `
    await tx.$executeRaw`
      INSERT INTO regulator_task_notes (task_id, author_user_id, note, visibility)
      VALUES (${task.id}, ${actor.userId}, ${payload.note ? `${reason}\n\n${payload.note}` : reason}, 'SUPERVISOR_ONLY')
    `
    await logTaskActivity({
      taskId: task.id,
      actorUserId: actor.userId,
      action: "TASK_ESCALATED",
      oldValue: task.status,
      newValue: "ESCALATED",
      metadata: { reason },
      db: tx,
    })
    await notifyTaskStatusParticipants(task, actor, "ESCALATED", { reason, db: tx })
  })

  const updated = await getTaskRowByNumber(task.task_number)
  await notifySupervisors(updated, {
    type: "TASK_ESCALATED",
    title: `Task escalated: ${task.task_number}`,
    message: `${actor.fullName || "A MERA officer"} escalated ${task.title}: ${reason}`,
  }, [actor?.userId, task.assigned_by_user_id])

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_TASK_ESCALATED",
    actionDescription: `Task ${task.task_number} escalated.`,
    affectedEntity: task.task_number,
  })

  return getTask(task.task_number, actor)
}

export async function completeTask(taskNumber, payload, actor) {
  const completionNotes = String(payload.completionNotes || "").trim()
  if (!completionNotes) throw badRequest("Completion notes are required")
  const task = await getTaskRowByNumber(taskNumber)
  ensureTaskWorker(actor, task)
  if (!COMPLETABLE_STATUSES.has(normalizeUpper(task.status))) {
    throw badRequest("Task must be in progress, escalated, or waiting for more information before completion")
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE regulator_tasks
      SET
        status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP(3),
        completion_notes = ${completionNotes},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${task.id}
    `
    if (String(task.linked_entity_type || "").toUpperCase() === "INSPECTION" && task.linked_entity_id) {
      await tx.$executeRaw`
        UPDATE inspections
        SET
          status = 'completed',
          inspection_status = 'CLOSED',
          completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP(3)),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE public_id = ${task.linked_entity_id}
      `
    }
    await logTaskActivity({
      taskId: task.id,
      actorUserId: actor.userId,
      action: "TASK_COMPLETED",
      oldValue: task.status,
      newValue: "COMPLETED",
      db: tx,
    })
    await notifyTaskStatusParticipants(task, actor, "COMPLETED", { reason: completionNotes, db: tx })
  })

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_TASK_COMPLETED",
    actionDescription: `Task ${task.task_number} completed.`,
    affectedEntity: task.task_number,
  })

  return getTask(task.task_number, actor)
}

export async function getTaskStatsOverview(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const viewAll = canViewAllTasks(auth)
  const executiveView = canExecutiveViewTasks(auth)
  const currentUserOnly = !viewAll && !executiveView

  const [summaryRows, groupRows, workloadRows, districtRows, typeRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS total_assigned,
        SUM(CASE WHEN rt.assigned_to_user_id = ${auth?.userId || 0} THEN 1 ELSE 0 END) AS my_assigned,
        SUM(CASE WHEN rt.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED','CANCELLED','REJECTED') THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN rt.priority = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN rt.completed_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS completed_this_week,
        SUM(CASE WHEN DATE(rt.completed_at) = CURRENT_DATE() THEN 1 ELSE 0 END) AS completed_today,
        AVG(CASE WHEN rt.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, rt.started_at, rt.completed_at) ELSE NULL END) AS avg_completion_minutes
      FROM regulator_tasks rt
      WHERE rt.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (${currentUserOnly} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (
          ${!executiveView || viewAll} = TRUE
          OR rt.priority IN ('HIGH', 'CRITICAL')
          OR rt.status = 'COMPLETED'
          OR (rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED'))
        )
    `,
    prisma.$queryRaw`
      SELECT 'status' AS bucket, rt.status AS label, COUNT(*) AS value
      FROM regulator_tasks rt
      WHERE rt.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (${currentUserOnly} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      GROUP BY rt.status
      UNION ALL
      SELECT 'priority' AS bucket, rt.priority AS label, COUNT(*) AS value
      FROM regulator_tasks rt
      WHERE rt.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (${currentUserOnly} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      GROUP BY rt.priority
    `,
    prisma.$queryRaw`
      SELECT
        mu.public_id,
        mu.full_name,
        mr.code AS role,
        mu.district_scope,
        COUNT(rt.id) AS total_tasks,
        SUM(CASE WHEN rt.status NOT IN ('COMPLETED','CANCELLED','REJECTED') THEN 1 ELSE 0 END) AS open_tasks,
        SUM(CASE WHEN rt.status = 'ASSIGNED' THEN 1 ELSE 0 END) AS pending_acknowledgement,
        SUM(CASE WHEN rt.status = 'ESCALATED' THEN 1 ELSE 0 END) AS escalated_tasks,
        SUM(CASE WHEN rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED','CANCELLED','REJECTED') THEN 1 ELSE 0 END) AS overdue_tasks
      FROM regulator_tasks rt
      INNER JOIN mera_users mu ON mu.id = rt.assigned_to_user_id
      INNER JOIN mera_roles mr ON mr.id = mu.role_id
      WHERE rt.deleted_at IS NULL
        AND ${viewAll} = TRUE
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict})
      GROUP BY mu.public_id, mu.full_name, mr.code, mu.district_scope
      ORDER BY open_tasks DESC, overdue_tasks DESC, mu.full_name ASC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT COALESCE(rt.district, 'Unspecified') AS district, COUNT(*) AS value
      FROM regulator_tasks rt
      WHERE rt.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (${currentUserOnly} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      GROUP BY COALESCE(rt.district, 'Unspecified')
      ORDER BY value DESC
      LIMIT 20
    `,
    prisma.$queryRaw`
      SELECT rt.type AS type, COUNT(*) AS value
      FROM regulator_tasks rt
      WHERE rt.deleted_at IS NULL
        AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
        AND (${currentUserOnly} = FALSE OR rt.assigned_to_user_id = ${auth?.userId || 0})
      GROUP BY rt.type
      ORDER BY value DESC
    `,
  ])

  const summary = summaryRows?.[0] || {}
  return {
    totalAssigned: Number(summary.total_assigned || 0),
    myAssigned: Number(summary.my_assigned || 0),
    inProgress: Number(summary.in_progress || 0),
    overdue: Number(summary.overdue || 0),
    critical: Number(summary.critical || 0),
    completedThisWeek: Number(summary.completed_this_week || 0),
    completedToday: Number(summary.completed_today || 0),
    averageCompletionMinutes: summary.avg_completion_minutes === null ? null : Number(summary.avg_completion_minutes || 0),
    byStatus: Object.fromEntries((groupRows || []).filter((row) => row.bucket === "status").map((row) => [row.label, Number(row.value || 0)])),
    byPriority: Object.fromEntries((groupRows || []).filter((row) => row.bucket === "priority").map((row) => [row.label, Number(row.value || 0)])),
    byType: (typeRows || []).map((row) => ({ type: row.type, value: Number(row.value || 0) })),
    byDistrict: (districtRows || []).map((row) => ({ district: row.district, value: Number(row.value || 0) })),
    workloadByOfficer: (workloadRows || []).map((row) => ({
      publicId: row.public_id,
      fullName: row.full_name,
      role: row.role,
      district: row.district_scope || null,
      totalTasks: Number(row.total_tasks || 0),
      openTasks: Number(row.open_tasks || 0),
      pendingAcknowledgement: Number(row.pending_acknowledgement || 0),
      escalatedTasks: Number(row.escalated_tasks || 0),
      overdueTasks: Number(row.overdue_tasks || 0),
    })),
  }
}

export async function listAssignableUsers(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district_scope,
      mu.region_scope,
      mr.code AS role,
      mr.display_name AS role_display_name,
      COUNT(rt.id) AS open_tasks
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    LEFT JOIN regulator_tasks rt
      ON rt.assigned_to_user_id = mu.id
      AND rt.deleted_at IS NULL
      AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')
    WHERE mu.account_status = 'ACTIVE'
      AND mr.code IN (
        'SUPER_ADMIN',
        'NATIONAL_OPERATIONS_ANALYST',
        'REGIONAL_COMPLIANCE_SUPERVISOR',
        'FIELD_COMPLIANCE_OFFICER',
        'PUBLIC_COMPLAINTS_ANALYST',
        'LEGAL_ENFORCEMENT_OFFICER',
        'LICENSING_OFFICER',
        'MARKET_SUPPLY_ANALYST'
      )
      AND (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
    GROUP BY mu.public_id, mu.full_name, mu.email, mu.phone, mu.district_scope, mu.region_scope, mr.code, mr.display_name
    ORDER BY mu.full_name ASC
  `
  return (rows || []).map((row) => ({
    publicId: row.public_id,
    name: row.full_name,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone || null,
    role: row.role,
    roleDisplayName: row.role_display_name || row.role,
    district: row.district_scope || null,
    region: row.region_scope || null,
    openTasks: Number(row.open_tasks || 0),
  }))
}

async function ensureOverdueNotifications(auth = null) {
  const rows = await prisma.$queryRaw`
    SELECT rt.id, rt.task_number, rt.title, rt.assigned_to_user_id
    FROM regulator_tasks rt
    WHERE rt.assigned_to_user_id = ${auth?.userId || 0}
      AND rt.deleted_at IS NULL
      AND rt.due_at < CURRENT_TIMESTAMP(3)
      AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')
      AND NOT EXISTS (
        SELECT 1
        FROM mera_notifications mn
        WHERE mn.user_id = rt.assigned_to_user_id
          AND mn.type = 'TASK_OVERDUE'
          AND mn.linked_entity_id = rt.task_number
      )
    LIMIT 20
  `
  await Promise.all(
    (rows || []).map((row) =>
      createNotification({
        userId: row.assigned_to_user_id,
        type: "TASK_OVERDUE",
        title: `Task overdue: ${row.task_number}`,
        message: `${row.title} is overdue and requires action.`,
        linkedEntityId: row.task_number,
      }).catch(() => null)
    )
  )
}

export async function listNotifications(filters = {}, auth = null) {
  await ensureOverdueNotifications(auth).catch(() => null)
  const limit = clamp(toInteger(filters.limit, 20), 1, 100)
  const rows = await prisma.$queryRaw`
    SELECT public_id, type, title, message, linked_entity_type, linked_entity_id, read_at, created_at
    FROM mera_notifications
    WHERE user_id = ${auth?.userId || 0}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
  const unreadRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS unread_count
    FROM mera_notifications
    WHERE user_id = ${auth?.userId || 0}
      AND read_at IS NULL
  `
  return {
    unreadCount: Number(unreadRows?.[0]?.unread_count || 0),
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      type: row.type,
      title: row.title,
      message: row.message,
      linkedEntityType: row.linked_entity_type || null,
      linkedEntityId: row.linked_entity_id || null,
      readAt: row.read_at || null,
      createdAt: row.created_at,
    })),
  }
}

export async function markNotificationRead(publicId, auth = null) {
  const scopedPublicId = normalizeOptionalString(publicId)
  if (!scopedPublicId) throw badRequest("notification publicId is required")
  await prisma.$executeRaw`
    UPDATE mera_notifications
    SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3))
    WHERE public_id = ${scopedPublicId}
      AND user_id = ${auth?.userId || 0}
  `
  return { publicId: scopedPublicId, read: true }
}

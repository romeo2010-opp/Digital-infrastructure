import { pool } from "../../config/db.js"
import { jsonString } from "./timetabling.helpers.js"

export async function recordTimetableAudit({
  connection = pool,
  schoolId,
  timetableId = null,
  timetableVersionId = null,
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  previousValues = null,
  newValues = null,
  reason = null,
  correlationId = null,
}) {
  await connection.query(
    `INSERT INTO timetable_audit_events (
      school_id, timetable_id, timetable_version_id, actor_user_id, action, entity_type, entity_id,
      previous_values, new_values, reason, correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      timetableId,
      timetableVersionId,
      actorUserId,
      action,
      entityType,
      entityId,
      previousValues ? jsonString(previousValues, {}) : null,
      newValues ? jsonString(newValues, {}) : null,
      reason,
      correlationId,
    ],
  )
}

export async function listTimetableAudit(connection, schoolId, timetableId, limit = 100) {
  const [rows] = await connection.query(
    `SELECT a.*, u.full_name AS actor_name
     FROM timetable_audit_events a
     LEFT JOIN users u ON u.id = a.actor_user_id AND u.school_id = a.school_id
     WHERE a.school_id = ? AND (? IS NULL OR a.timetable_id = ?)
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`,
    [schoolId, timetableId || null, timetableId || null, Math.min(200, Math.max(20, Number(limit || 100)))],
  )
  return rows
}

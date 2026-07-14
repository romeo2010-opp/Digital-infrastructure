import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { broadcastUserEvent } from "../realtime/websocketServer.js"

const categories = new Set(["finance", "academics", "staff", "admissions", "operations", "general"])
const priorities = new Set(["low", "medium", "high", "urgent"])
const statuses = new Set(["open", "in_progress", "completed", "cancelled"])

async function scopedAssignee(connection, schoolId, userId) {
  if (!userId) return null
  const [[user]] = await connection.query("SELECT id FROM users WHERE school_id = ? AND id = ? AND is_active = 1 LIMIT 1", [schoolId, userId])
  if (!user) throw new HttpError(400, "Assigned staff member was not found in this school.")
  return user.id
}

export async function listDirectorTasks(schoolId, query = {}, viewer = {}) {
  const filters = ["dt.school_id = ?", "dt.deleted_at IS NULL"]
  const params = [schoolId]
  if (query.status && statuses.has(query.status)) { filters.push("dt.status = ?"); params.push(query.status) }
  if (query.category && categories.has(query.category)) { filters.push("dt.category = ?"); params.push(query.category) }
  const leadership = ["school_owner", "director", "owner", "headteacher"].includes(String(viewer.role || ""))
  if (!leadership || query.assigned_to === "me") { filters.push("dt.assigned_to_user_id = ?"); params.push(viewer.id) }
  const [tasks] = await pool.query(
    `SELECT dt.public_ref AS id, dt.title, dt.description, dt.category, dt.priority, dt.status, dt.due_date,
       dt.linked_entity_type, dt.context_snapshot, dt.created_at, dt.updated_at, dt.completed_at, dt.completion_notes, dt.completion_data,
       assignee.full_name AS assigned_to_name, assigner.full_name AS assigned_by_name,
       CASE WHEN dt.status IN ('open','in_progress') AND dt.due_date < CURDATE() THEN 1 ELSE 0 END AS is_overdue
     FROM director_tasks dt
     LEFT JOIN users assignee ON assignee.id = dt.assigned_to_user_id AND assignee.school_id = dt.school_id
     JOIN users assigner ON assigner.id = dt.assigned_by_user_id AND assigner.school_id = dt.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY FIELD(dt.status,'open','in_progress','completed','cancelled'), FIELD(dt.priority,'urgent','high','medium','low'), dt.due_date IS NULL, dt.due_date, dt.created_at DESC
     LIMIT 300`, params)
  return tasks
}

export async function getDirectorTask(schoolId, taskRef, viewer = {}) {
  const leadership = ["school_owner", "director", "owner", "headteacher"].includes(String(viewer.role || ""))
  const [[task]] = await pool.query(`SELECT dt.public_ref AS id,dt.assigned_by_user_id,dt.title,dt.description,dt.category,dt.priority,dt.status,dt.due_date,dt.linked_entity_type,dt.context_snapshot,dt.created_at,dt.updated_at,dt.completed_at,dt.completion_notes,dt.completion_data,assignee.full_name assigned_to_name,assigner.full_name assigned_by_name
    FROM director_tasks dt LEFT JOIN users assignee ON assignee.id=dt.assigned_to_user_id JOIN users assigner ON assigner.id=dt.assigned_by_user_id
    WHERE dt.school_id=? AND dt.public_ref=? ${leadership ? "" : "AND dt.assigned_to_user_id=?"} LIMIT 1`, leadership ? [schoolId,taskRef] : [schoolId,taskRef,viewer.id])
  if (!task) throw new HttpError(404,"Follow-up was not found.")
  task.is_owner = Number(task.assigned_by_user_id)===Number(viewer.id)||["school_owner","director","owner"].includes(String(viewer.role||""))
  delete task.assigned_by_user_id
  const [evidence] = await pool.query("SELECT public_ref AS id,evidence_type,label,reference_value,url,metadata,created_at FROM director_task_evidence WHERE school_id=? AND task_id=(SELECT id FROM director_tasks WHERE school_id=? AND public_ref=?) ORDER BY created_at", [schoolId,schoolId,taskRef])
  const [activity] = await pool.query(`SELECT a.public_ref AS id,a.action,a.detail,a.created_at,u.full_name actor_name FROM director_task_activity a JOIN users u ON u.id=a.actor_user_id WHERE a.school_id=? AND a.task_id=(SELECT id FROM director_tasks WHERE school_id=? AND public_ref=?) ORDER BY a.created_at`, [schoolId,schoolId,taskRef])
  return { ...task, evidence, activity }
}
export async function deleteDirectorTask(schoolId,taskRef,actor) {
  const [[task]]=await pool.query("SELECT id,assigned_by_user_id,status FROM director_tasks WHERE school_id=? AND public_ref=? AND deleted_at IS NULL",[schoolId,taskRef]); if(!task) throw new HttpError(404,"Follow-up was not found.")
  const allowed=Number(task.assigned_by_user_id)===Number(actor.id)||["school_owner","director","owner"].includes(String(actor.role||"")); if(!allowed) throw new HttpError(403,"Only the follow-up owner can delete it.")
  await pool.query("UPDATE director_tasks SET deleted_at=CURRENT_TIMESTAMP,deleted_by=? WHERE school_id=? AND id=?",[actor.id,schoolId,task.id]); await pool.query("INSERT INTO director_task_activity (public_ref,school_id,task_id,actor_user_id,action,detail) VALUES (UUID(),?,?,?,'cancelled','Follow-up deleted by owner')",[schoolId,task.id,actor.id]); return {ok:true}
}

export async function listUserNotifications(schoolId, userId) {
  const [items] = await pool.query(`SELECT public_ref AS publicId,title,message,category AS type,priority,status,created_at AS createdAt,read_at AS readAt,linked_entity_type AS linkedEntityType,
    CASE
      WHEN linked_entity_type='director_task' THEN (SELECT public_ref FROM director_tasks WHERE id=notifications.linked_entity_id AND school_id=notifications.school_id)
      WHEN linked_entity_type='staff_leave' THEN (SELECT public_ref FROM staff_leave_requests WHERE id=notifications.linked_entity_id AND school_id=notifications.school_id)
      WHEN linked_entity_type='payroll_run' THEN (SELECT public_ref FROM payroll_runs WHERE id=notifications.linked_entity_id AND school_id=notifications.school_id)
      WHEN linked_entity_type='timetable' THEN (SELECT public_ref FROM timetables WHERE id=notifications.linked_entity_id AND school_id=notifications.school_id)
      ELSE NULL
    END AS linkedEntityId
    FROM notifications WHERE school_id=? AND recipient_user_id=? AND status<>'dismissed' ORDER BY created_at DESC LIMIT 100`, [schoolId,userId])
  return { items, unreadCount: items.filter((item)=>!item.readAt).length }
}
export async function getUnreadNotificationCount(schoolId,userId) { const [[row]]=await pool.query("SELECT COUNT(*) total FROM notifications WHERE school_id=? AND recipient_user_id=? AND status NOT IN ('read','dismissed')",[schoolId,userId]); return Number(row?.total||0) }

export async function markUserNotification(schoolId,userId,publicRef,status="read") {
  await pool.query(`UPDATE notifications SET status=?,read_at=${status === "read" ? "CURRENT_TIMESTAMP" : "read_at"} WHERE school_id=? AND recipient_user_id=? AND public_ref=?`, [status,schoolId,userId,publicRef])
  return { ok:true }
}

export async function createDirectorTask(schoolId, actorId, body = {}) {
  const title = String(body.title || "").trim()
  if (!title) throw new HttpError(400, "Task title is required.")
  const category = categories.has(body.category) ? body.category : "general"
  const priority = priorities.has(body.priority) ? body.priority : "medium"
  const connection = await pool.getConnection()
  try {
    const assignee = await scopedAssignee(connection, schoolId, body.assigned_to_user_id)
    const [result] = await connection.query(
      `INSERT INTO director_tasks (public_ref,school_id,title,description,category,priority,assigned_to_user_id,assigned_by_user_id,due_date,linked_entity_type,linked_entity_id,context_snapshot)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?)`,
      [schoolId, title, body.description || null, category, priority, assignee, actorId, body.due_date || null, body.linked_entity_type || null, body.linked_entity_id || null, body.context_snapshot ? JSON.stringify(body.context_snapshot) : null])
    await connection.query("INSERT INTO director_task_activity (public_ref,school_id,task_id,actor_user_id,action,detail) VALUES (UUID(),?,?,?,'created',?)", [schoolId,result.insertId,actorId,body.description||null])
    let notification = null
    if (assignee) {
      const [notificationResult] = await connection.query(
      `INSERT INTO notifications (public_ref,school_id,recipient_user_id,title,message,category,priority,channel,status,linked_entity_type,linked_entity_id,created_by,sent_at)
       VALUES (UUID(),?,?,?,?,?,?,'in_app','sent','director_task',?,?,CURRENT_TIMESTAMP)`,
      [schoolId,assignee,"New follow-up assigned",title,category === "general" ? "system" : category,priority,result.insertId,actorId])
      const [[notice]] = await connection.query("SELECT public_ref AS publicId,title,message,category AS type,priority,created_at AS createdAt,linked_entity_type AS linkedEntityType FROM notifications WHERE id=?", [notificationResult.insertId])
      notification = notice
    }
    const [[task]] = await connection.query("SELECT public_ref AS id,title,description,category,priority,status,due_date,linked_entity_type,context_snapshot,created_at FROM director_tasks WHERE school_id = ? AND id = ?", [schoolId, result.insertId])
    if (assignee && notification) broadcastUserEvent({ schoolId, userId: assignee, type: "smartlink_notification", data: { ...notification, linkedEntityId: task.id, task } })
    return task
  } finally { connection.release() }
}

export async function updateDirectorTask(schoolId, taskId, actor, body = {}) {
  const connection = await pool.getConnection()
  try {
    const [[task]] = await connection.query("SELECT * FROM director_tasks WHERE school_id = ? AND public_ref = ? LIMIT 1", [schoolId, taskId])
    if (!task) throw new HttpError(404, "Director task was not found.")
    const leadership = ["school_owner", "director", "owner", "headteacher"].includes(String(actor.role || ""))
    if (!leadership && Number(task.assigned_to_user_id) !== Number(actor.id)) throw new HttpError(403, "You can only update tasks assigned to you.")
    const assignee = body.assigned_to_user_id === undefined ? task.assigned_to_user_id : await scopedAssignee(connection, schoolId, body.assigned_to_user_id)
    const status = statuses.has(body.status) ? body.status : task.status
    await connection.query(
      `UPDATE director_tasks SET title=?,description=?,category=?,priority=?,status=?,assigned_to_user_id=?,due_date=?,completed_at=?,completion_notes=?,completion_data=? WHERE school_id=? AND id=?`,
      [body.title?.trim() || task.title, body.description ?? task.description, categories.has(body.category) ? body.category : task.category, priorities.has(body.priority) ? body.priority : task.priority, status, assignee, body.due_date === undefined ? task.due_date : body.due_date || null, status === "completed" ? new Date() : null, status === "completed" ? body.completion_notes || null : task.completion_notes, status === "completed" && body.completion_data ? JSON.stringify(body.completion_data) : task.completion_data, schoolId, task.id])
    for (const evidence of Array.isArray(body.evidence) ? body.evidence : []) {
      if (!String(evidence?.label || "").trim()) continue
      await connection.query(`INSERT INTO director_task_evidence (public_ref,school_id,task_id,evidence_type,label,reference_value,url,metadata,added_by) VALUES (UUID(),?,?,?,?,?,?,?,?)`, [schoolId,task.id,["student","receipt","payment","document","link","note","metric","other"].includes(evidence.type)?evidence.type:"other",String(evidence.label).trim(),evidence.reference_value||null,evidence.url||null,evidence.metadata?JSON.stringify(evidence.metadata):null,actor.id])
    }
    const action = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : status === "in_progress" && task.status === "open" ? "started" : "updated"
    await connection.query("INSERT INTO director_task_activity (public_ref,school_id,task_id,actor_user_id,action,detail) VALUES (UUID(),?,?,?,?,?)", [schoolId,task.id,actor.id,action,body.completion_notes||body.description||null])
    let completionNotification = null
    if (status === "completed" && Number(task.assigned_by_user_id) !== Number(actor.id)) {
      const [noticeResult] = await connection.query(`INSERT INTO notifications (public_ref,school_id,recipient_user_id,title,message,category,priority,channel,status,linked_entity_type,linked_entity_id,created_by,sent_at) VALUES (UUID(),?,?,?,?,?,?,'in_app','sent','director_task',?,?,CURRENT_TIMESTAMP)`, [schoolId,task.assigned_by_user_id,"Follow-up completed",`${task.title} was completed by the assigned staff member.`,task.category==="general"?"system":task.category,task.priority,task.id,actor.id])
      const [[notice]] = await connection.query("SELECT public_ref AS publicId,title,message,category AS type,priority,created_at AS createdAt FROM notifications WHERE id=?", [noticeResult.insertId])
      completionNotification = notice
    }
    const [[updated]] = await connection.query("SELECT public_ref AS id,title,description,category,priority,status,due_date,linked_entity_type,context_snapshot,completion_notes,completion_data,completed_at FROM director_tasks WHERE school_id = ? AND id = ?", [schoolId, task.id])
    if (completionNotification) broadcastUserEvent({ schoolId, userId: task.assigned_by_user_id, type: "smartlink_notification", data: { ...completionNotification, linkedEntityType: "director_task", linkedEntityId: updated.id, task: updated } })
    return updated
  } finally { connection.release() }
}

export async function getDailyClosure(schoolId, date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(`${day}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowDay = tomorrow.toISOString().slice(0, 10)
  const count = async (sql, params) => {
    try { const [[row]] = await pool.query(sql, params); return { configured: true, value: Number(row?.total || 0) } }
    catch (error) { if (["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error?.code)) return { configured: false, value: 0 }; throw error }
  }
  const [studentAttendance, staffAttendance, payments, incidents, complaints, tomorrowExams, reviewResult] = await Promise.all([
    count("SELECT COUNT(*) total FROM attendance_records WHERE school_id=? AND attendance_date=?", [schoolId,day]),
    count("SELECT COUNT(*) total FROM staff_attendance WHERE school_id=? AND attendance_date=?", [schoolId,day]),
    count("SELECT COUNT(*) total FROM fee_payments WHERE school_id=? AND DATE(COALESCE(paid_on,paid_at))=?", [schoolId,day]),
    count("SELECT COUNT(*) total FROM school_incidents WHERE school_id=? AND status IN ('open','investigating')", [schoolId]),
    count("SELECT COUNT(*) total FROM school_complaints WHERE school_id=? AND status IN ('open','in_progress')", [schoolId]),
    count("SELECT COUNT(*) total FROM exam_timetable_entries WHERE school_id=? AND exam_date=? AND status<>'cancelled'", [schoolId,tomorrowDay]),
    pool.query("SELECT dc.*, u.full_name AS completed_by_name FROM director_daily_closures dc JOIN users u ON u.id=dc.completed_by WHERE dc.school_id=? AND dc.closure_date=?", [schoolId, day]),
  ])
  const reviewRows = reviewResult[0] || []
  const item = (key, label, configured, complete, description, actionRoute) => ({ key, label, status: !configured ? "not_configured" : complete ? "complete" : "incomplete", description, actionLabel: "Review", actionRoute })
  return { date: day, reviewed: reviewRows[0] || null, items: [
    item("student_attendance", "Student attendance completed", studentAttendance.configured, studentAttendance.value>0, `${studentAttendance.value} attendance records today`, "/attendance"),
    item("staff_attendance", "Staff attendance completed", staffAttendance.configured, staffAttendance.value>0, staffAttendance.configured ? `${staffAttendance.value} staff records today` : "Staff attendance module not configured", "/director/staff/attendance"),
    item("payments", "Payments recorded or reconciled", payments.configured, payments.value>0, `${payments.value} payments today`, "/director/finance/fee-collection"),
    item("incidents", "Open incidents reviewed", incidents.configured, incidents.value===0, incidents.configured ? `${incidents.value} unresolved incidents` : "Incident module not configured", "/director/operations/incidents"),
    item("complaints", "Open complaints reviewed", complaints.configured, complaints.value===0, complaints.configured ? `${complaints.value} unresolved complaints` : "Complaint module not configured", "/director/operations/complaints"),
    item("tomorrow_exams", "Tomorrow's exams ready", tomorrowExams.configured && tomorrowExams.value>0, tomorrowExams.value>0, tomorrowExams.value ? `${tomorrowExams.value} exams scheduled tomorrow` : "No exams configured for tomorrow", "/exam-sessions"),
  ] }
}

export async function reviewDailyClosure(schoolId, actorId, body = {}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? body.date : new Date().toISOString().slice(0,10)
  await pool.query(`INSERT INTO director_daily_closures (school_id,closure_date,completed_by,notes) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE completed_by=VALUES(completed_by),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP`, [schoolId,date,actorId,body.notes||null])
  return getDailyClosure(schoolId,date)
}

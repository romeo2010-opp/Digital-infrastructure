import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { assertTeacherCanUseClass, getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"

export async function listHomework(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ homework: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "h.class_id")
  const [rows] = await pool.query(
    `SELECT h.id, h.title, h.instructions, h.due_date, h.status, c.name AS class_name, s.name AS subject_name
     FROM homework h
     JOIN classes c ON c.id = h.class_id AND c.school_id = h.school_id
     JOIN subjects s ON s.id = h.subject_id AND s.school_id = h.school_id
     WHERE h.school_id = ? AND h.due_date BETWEEN ? AND ?${classScope.clause}
     ORDER BY h.due_date ASC`,
    [schoolId, session.term.start_date, session.term.end_date, ...classScope.params],
  )
  res.json({ homework: rows, session: sessionPayload(session), setup_required: false })
}

export async function createHomework(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { class_id, subject_id, title, instructions, due_date } = req.body
  if (!class_id || !subject_id || !title || !due_date) {
    throw new HttpError(400, "class_id, subject_id, title, and due_date are required")
  }
  await assertTeacherCanUseClass(req, schoolId, class_id)

  const [result] = await pool.query(
    `INSERT INTO homework (school_id, class_id, subject_id, title, instructions, due_date, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [schoolId, class_id, subject_id, title, instructions || "", due_date, req.user.id],
  )
  res.status(201).json({ id: result.insertId })
}

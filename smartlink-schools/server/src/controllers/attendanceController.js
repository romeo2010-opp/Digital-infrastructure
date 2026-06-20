import { pool } from "../config/db.js"
import { assertTeacherCanUseClass, getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"

export async function listAttendance(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ attendance: [], date: req.query.date || new Date().toISOString().slice(0, 10), session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const date = req.query.date || new Date().toISOString().slice(0, 10)
  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, c.id AS class_id, c.name AS class_name,
      COALESCE(ar.status, 'unmarked') AS status, ar.note, ar.attendance_date
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.school_id = s.school_id AND ar.attendance_date = ?
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
      AND se.enrollment_status = 'active' AND s.status = 'active'${classScope.clause}
     ORDER BY c.name, s.last_name, s.first_name`,
    [date, schoolId, session.academicYearId, session.termId, ...classScope.params],
  )
  res.json({ attendance: rows, date, session: sessionPayload(session), setup_required: false })
}

export async function markAttendance(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { attendance_date, class_id, records = [] } = req.body
  await assertTeacherCanUseClass(req, schoolId, class_id)

  const values = records.map((record) => [
    schoolId,
    class_id,
    record.student_id,
    attendance_date,
    record.status,
    record.note || null,
    req.user.id,
  ])

  if (values.length) {
    await pool.query(
      `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, note, marked_by)
       VALUES ?
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), marked_by = VALUES(marked_by)`,
      [values],
    )
  }

  res.json({ saved: values.length })
}

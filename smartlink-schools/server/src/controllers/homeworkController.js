import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { assertTeacherCanUseSubjectInClass, getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, requireActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

export async function listHomework(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ homework: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "h.class_id")
  const [rows] = await pool.query(
    `SELECT h.id, h.title, h.instructions, h.due_date, h.status, c.name AS class_name, s.name AS subject_name,
      COUNT(DISTINCT hs.id) AS assigned_count,
      SUM(CASE WHEN hs.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count
     FROM homework h
     JOIN classes c ON c.id = h.class_id AND c.school_id = h.school_id
     JOIN subjects s ON s.id = h.subject_id AND s.school_id = h.school_id
     LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.school_id = h.school_id
     WHERE h.school_id = ? AND h.due_date BETWEEN ? AND ?${classScope.clause}
     GROUP BY h.id, h.title, h.instructions, h.due_date, h.status, c.name, s.name
     ORDER BY h.due_date ASC`,
    [schoolId, session.term.start_date, session.term.end_date, ...classScope.params],
  )
  res.json({ homework: rows, session: sessionPayload(session), setup_required: false })
}

export async function createHomework(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.body?.class_id || 0)
  const subjectId = Number(req.body?.subject_id || 0)
  const title = String(req.body?.title || "").trim()
  const instructions = String(req.body?.instructions || "").trim()
  const dueDate = dateOnly(req.body?.due_date)

  if (!classId || !subjectId || !title || !dueDate) {
    throw new HttpError(400, "class_id, subject_id, title, and due_date are required")
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const session = await requireActiveAcademicSession(schoolId, connection)
    if (dueDate < dateOnly(session.term.start_date) || dueDate > dateOnly(session.term.end_date)) {
      throw new HttpError(400, "Homework due date must be inside the active term.")
    }

    const [[scope]] = await connection.query(
      `SELECT c.id AS class_id, c.name AS class_name, s.id AS subject_id, s.name AS subject_name
       FROM classes c
       JOIN subjects s ON s.school_id = c.school_id AND s.id = ?
       WHERE c.school_id = ? AND c.id = ?
       LIMIT 1`,
      [subjectId, schoolId, classId],
    )
    if (!scope) throw new HttpError(400, "Select a valid class and subject from this school.")

    await assertTeacherCanUseSubjectInClass(req, schoolId, classId, subjectId)

    const [result] = await connection.query(
      `INSERT INTO homework (school_id, class_id, subject_id, title, instructions, due_date, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [schoolId, classId, subjectId, title, instructions, dueDate, req.user.id],
    )
    const homeworkId = Number(result.insertId)

    const [assignmentResult] = await connection.query(
      `INSERT IGNORE INTO homework_submissions (school_id, homework_id, student_id, status)
       SELECT ?, ?, se.student_id, 'pending'
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id AND st.school_id = se.school_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
         AND se.class_id = ? AND se.enrollment_status = 'active' AND st.status = 'active'`,
      [schoolId, homeworkId, schoolId, session.academicYearId, session.termId, classId],
    )

    await connection.commit()
    res.status(201).json({
      homework: {
        id: homeworkId,
        title,
        instructions,
        due_date: dueDate,
        status: "pending",
        class_id: classId,
        class_name: scope.class_name,
        subject_id: subjectId,
        subject_name: scope.subject_name,
        assigned_count: Number(assignmentResult.affectedRows || 0),
        submitted_count: 0,
      },
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

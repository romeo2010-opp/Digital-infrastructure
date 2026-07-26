import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassIds, isTeacher, scopedInClause } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import {
  assertAssignmentScope,
  assertNoDuplicateActiveAssignment,
  normalizeAssignmentPayload,
} from "../services/teacherAssignmentService.js"

function rowToAssignment(row) {
  return {
    id: Number(row.id),
    teacher_id: Number(row.teacher_id),
    teacher_name: row.teacher_name,
    class_id: Number(row.class_id),
    class_name: row.class_name,
    subject_id: row.subject_id ? Number(row.subject_id) : null,
    subject_name: row.subject_name,
    stream_section: row.stream_section,
    academic_year_id: row.academic_year_id ? Number(row.academic_year_id) : null,
    term_id: row.term_id ? Number(row.term_id) : null,
    academic_year: row.academic_year,
    academic_year_name: row.academic_year_name,
    term: row.term,
    term_name: row.term_name,
    role: row.role,
    is_active: Boolean(row.is_active),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listTeacherAssignments(req, res) {
  const schoolId = getScopedSchoolId(req)
  const includeHistory = !isTeacher(req) && String(req.query.include_history || req.query.includeHistory || "").toLowerCase() === "true"
  const session = await getActiveAcademicSession(schoolId)
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "a.class_id")
  const sessionClause = includeHistory
    ? ""
    : session.setupRequired
      ? " AND 1 = 0"
      : " AND a.academic_year_id = ? AND a.term_id = ?"
  const sessionParams = includeHistory || session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT a.*, u.full_name AS teacher_name, c.name AS class_name, subj.name AS subject_name,
       ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ?${classScope.clause}${sessionClause}
     ORDER BY c.name, a.role, subj.name, u.full_name`,
    [schoolId, ...classScope.params, ...sessionParams],
  )
  res.json({ assignments: rows.map(rowToAssignment), session: sessionPayload(session), setup_required: session.setupRequired })
}

export async function createTeacherAssignment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assignment = normalizeAssignmentPayload(req.body)
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const session = await getActiveAcademicSession(schoolId, connection)
    if (!session.setupRequired && !assignment.academicYearId && !assignment.termId) {
      assignment.academicYearId = session.academicYearId
      assignment.termId = session.termId
      assignment.academicYear = session.academicYear.name
      assignment.term = session.term.name
    }
    if (assignment.isActive && (!assignment.academicYearId || !assignment.termId)) {
      throw new HttpError(409, session.message || "Active teacher assignments require an academic year and term")
    }
    await assertAssignmentScope(connection, schoolId, assignment)
    await assertNoDuplicateActiveAssignment(connection, schoolId, assignment)

    const [result] = await connection.query(
      `INSERT INTO teacher_class_subject_assignments (
        school_id, teacher_id, class_id, subject_id, stream_section,
        academic_year_id, term_id, academic_year, term, role, is_active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        assignment.teacherId,
        assignment.classId,
        assignment.subjectId,
        assignment.streamSection,
        assignment.academicYearId,
        assignment.termId,
        assignment.academicYear,
        assignment.term,
        assignment.role,
        assignment.isActive ? 1 : 0,
        assignment.notes,
      ],
    )

    if (assignment.role === "class_teacher" && assignment.isActive) {
      await connection.query("UPDATE classes SET teacher_user_id = ? WHERE id = ? AND school_id = ?", [assignment.teacherId, assignment.classId, schoolId])
    }

    await connection.commit()
    res.status(201).json({ id: Number(result.insertId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateTeacherAssignment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assignmentId = Number(req.params.id || 0)
  if (!assignmentId) throw new HttpError(400, "Assignment id is required")

  const assignment = normalizeAssignmentPayload(req.body)
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.query("SELECT id FROM teacher_class_subject_assignments WHERE id = ? AND school_id = ? LIMIT 1", [assignmentId, schoolId])
    if (!existing) throw new HttpError(404, "Teacher assignment was not found")

    const session = await getActiveAcademicSession(schoolId, connection)
    if (!session.setupRequired && !assignment.academicYearId && !assignment.termId) {
      assignment.academicYearId = session.academicYearId
      assignment.termId = session.termId
      assignment.academicYear = session.academicYear.name
      assignment.term = session.term.name
    }
    if (assignment.isActive && (!assignment.academicYearId || !assignment.termId)) {
      throw new HttpError(409, session.message || "Active teacher assignments require an academic year and term")
    }
    await assertAssignmentScope(connection, schoolId, assignment)
    await assertNoDuplicateActiveAssignment(connection, schoolId, assignment, assignmentId)

    await connection.query(
      `UPDATE teacher_class_subject_assignments
       SET teacher_id = ?, class_id = ?, subject_id = ?, stream_section = ?,
         academic_year_id = ?, term_id = ?, academic_year = ?, term = ?, role = ?, is_active = ?, notes = ?
       WHERE id = ? AND school_id = ?`,
      [
        assignment.teacherId,
        assignment.classId,
        assignment.subjectId,
        assignment.streamSection,
        assignment.academicYearId,
        assignment.termId,
        assignment.academicYear,
        assignment.term,
        assignment.role,
        assignment.isActive ? 1 : 0,
        assignment.notes,
        assignmentId,
        schoolId,
      ],
    )

    if (assignment.role === "class_teacher" && assignment.isActive) {
      await connection.query("UPDATE classes SET teacher_user_id = ? WHERE id = ? AND school_id = ?", [assignment.teacherId, assignment.classId, schoolId])
    }

    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deactivateTeacherAssignment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assignmentId = Number(req.params.id || 0)
  if (!assignmentId) throw new HttpError(400, "Assignment id is required")

  const [result] = await pool.query(
    "UPDATE teacher_class_subject_assignments SET is_active = 0 WHERE id = ? AND school_id = ?",
    [assignmentId, schoolId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Teacher assignment was not found")
  res.json({ ok: true })
}

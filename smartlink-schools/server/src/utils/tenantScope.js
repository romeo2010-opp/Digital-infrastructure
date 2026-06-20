import { HttpError } from "./http.js"
import { pool } from "../config/db.js"
import { getActiveAcademicSession } from "../services/academicSessionService.js"

export function getScopedSchoolId(req) {
  if (req.user?.role === "super_admin") {
    const requestedSchoolId = req.query.school_id || req.body.school_id || req.headers["x-school-id"]
    if (!requestedSchoolId) {
      throw new HttpError(400, "school_id is required for super_admin scoped requests")
    }
    return Number(requestedSchoolId)
  }

  if (!req.user?.schoolId) {
    throw new HttpError(403, "User is not assigned to a school")
  }

  return Number(req.user.schoolId)
}

export function assertSameSchool(req, schoolId) {
  if (req.user?.role === "super_admin") return
  if (Number(req.user?.schoolId) !== Number(schoolId)) {
    throw new HttpError(403, "Cross-school access is not allowed")
  }
}

export function isTeacher(req) {
  return req.user?.role === "teacher"
}

export async function getTeacherClassIds(req, schoolId) {
  if (!isTeacher(req)) return null
  const session = await getActiveAcademicSession(schoolId)
  const sessionClause = session.setupRequired
    ? ""
    : " AND (academic_year_id = ? OR academic_year_id IS NULL) AND (term_id = ? OR term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT id FROM classes WHERE school_id = ? AND teacher_user_id = ?
     UNION
     SELECT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND is_active = 1${sessionClause}`,
    [schoolId, req.user.id, schoolId, req.user.id, ...sessionParams],
  )
  return rows.map((row) => Number(row.id))
}

export async function assertTeacherCanUseClass(req, schoolId, classId) {
  if (!isTeacher(req)) return
  const session = await getActiveAcademicSession(schoolId)
  const sessionClause = session.setupRequired
    ? ""
    : " AND (academic_year_id = ? OR academic_year_id IS NULL) AND (term_id = ? OR term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT id FROM classes WHERE school_id = ? AND id = ? AND teacher_user_id = ?
     UNION
     SELECT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND teacher_id = ? AND is_active = 1${sessionClause}
     LIMIT 1`,
    [schoolId, classId, req.user.id, schoolId, classId, req.user.id, ...sessionParams],
  )
  if (!rows.length) throw new HttpError(403, "Teachers can only access classes they teach")
}

export async function assertTeacherCanUseSubjectInClass(req, schoolId, classId, subjectId) {
  if (!isTeacher(req)) return
  const session = await getActiveAcademicSession(schoolId)
  const sessionClause = session.setupRequired
    ? ""
    : " AND (academic_year_id = ? OR academic_year_id IS NULL) AND (term_id = ? OR term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT id FROM classes WHERE school_id = ? AND id = ? AND teacher_user_id = ?
     UNION
     SELECT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND teacher_id = ? AND subject_id = ? AND is_active = 1${sessionClause}
     LIMIT 1`,
    [schoolId, classId, req.user.id, schoolId, classId, req.user.id, subjectId, ...sessionParams],
  )
  if (!rows.length) throw new HttpError(403, "Teachers can only access subjects/classes assigned to them")
}

export async function getTeacherClassSubjectPairs(req, schoolId) {
  if (!isTeacher(req)) return null
  const session = await getActiveAcademicSession(schoolId)
  const sessionClause = session.setupRequired
    ? ""
    : " AND (academic_year_id = ? OR academic_year_id IS NULL) AND (term_id = ? OR term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT class_id, subject_id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND role = 'subject_teacher'
       AND subject_id IS NOT NULL AND is_active = 1${sessionClause}`,
    [schoolId, req.user.id, ...sessionParams],
  )
  return rows.map((row) => ({
    classId: Number(row.class_id),
    subjectId: Number(row.subject_id),
  }))
}

export async function assertTeacherCanTeachSubject(req, schoolId, classId, subjectId, termId = null) {
  if (!isTeacher(req)) return
  const session = await getActiveAcademicSession(schoolId)
  const activeTermId = termId || (session.setupRequired ? null : session.termId)
  const activeYearId = session.setupRequired ? null : session.academicYearId
  const params = [schoolId, classId, subjectId, req.user.id]
  const yearClause = activeYearId ? " AND (academic_year_id = ? OR academic_year_id IS NULL)" : ""
  const termClause = activeTermId ? " AND (term_id = ? OR term_id IS NULL)" : ""
  if (activeYearId) params.push(activeYearId)
  if (activeTermId) params.push(activeTermId)
  const [rows] = await pool.query(
    `SELECT id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ?
       AND role = 'subject_teacher' AND is_active = 1${yearClause}${termClause}
     LIMIT 1`,
    params,
  )
  if (!rows.length) throw new HttpError(403, "Teachers can only use assigned class and subject combinations")
}

export function scopedInClause(ids, columnName) {
  if (!Array.isArray(ids)) return { clause: "", params: [] }
  if (!ids.length) return { clause: " AND 1 = 0", params: [] }
  return {
    clause: ` AND ${columnName} IN (${ids.map(() => "?").join(", ")})`,
    params: ids,
  }
}

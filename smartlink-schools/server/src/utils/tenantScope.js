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

async function activeTeacherAssignmentContext(schoolId, options = {}) {
  const db = options.db || pool
  const session = options.session || await getActiveAcademicSession(schoolId, db)
  if (session.setupRequired || !Number(session.academicYearId || 0) || !Number(session.termId || 0)) return null
  return {
    db,
    academicYearId: Number(session.academicYearId),
    termId: Number(session.termId),
  }
}

function noCurrentTeacherAssignment() {
  return new HttpError(403, "Teachers require an explicit assignment for the current academic year and term")
}

export async function getTeacherClassIds(req, schoolId, options = {}) {
  if (!isTeacher(req)) return null
  const context = await activeTeacherAssignmentContext(schoolId, options)
  if (!context) return []
  const [rows] = await context.db.query(
    `SELECT DISTINCT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND is_active = 1
       AND academic_year_id = ? AND term_id = ?`,
    [schoolId, req.user.id, context.academicYearId, context.termId],
  )
  return rows.map((row) => Number(row.id))
}

export async function assertTeacherCanUseClass(req, schoolId, classId, options = {}) {
  if (!isTeacher(req)) return
  const context = await activeTeacherAssignmentContext(schoolId, options)
  if (!context) throw noCurrentTeacherAssignment()
  const [rows] = await context.db.query(
    `SELECT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND teacher_id = ? AND is_active = 1
       AND academic_year_id = ? AND term_id = ?
     LIMIT 1`,
    [schoolId, classId, req.user.id, context.academicYearId, context.termId],
  )
  if (!rows.length) throw new HttpError(403, "Teachers can only access classes they teach")
}

export async function assertTeacherCanUseSubjectInClass(req, schoolId, classId, subjectId, options = {}) {
  if (!isTeacher(req)) return
  const context = await activeTeacherAssignmentContext(schoolId, options)
  if (!context) throw noCurrentTeacherAssignment()
  const [rows] = await context.db.query(
    `SELECT class_id AS id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND teacher_id = ? AND subject_id = ?
       AND role = 'subject_teacher' AND is_active = 1
       AND academic_year_id = ? AND term_id = ?
     LIMIT 1`,
    [schoolId, classId, req.user.id, subjectId, context.academicYearId, context.termId],
  )
  if (!rows.length) throw new HttpError(403, "Teachers can only access subjects/classes assigned to them")
}

export async function getTeacherClassSubjectPairs(req, schoolId, options = {}) {
  if (!isTeacher(req)) return null
  const context = await activeTeacherAssignmentContext(schoolId, options)
  if (!context) return []
  const [rows] = await context.db.query(
    `SELECT class_id, subject_id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND role = 'subject_teacher'
       AND subject_id IS NOT NULL AND is_active = 1
       AND academic_year_id = ? AND term_id = ?`,
    [schoolId, req.user.id, context.academicYearId, context.termId],
  )
  return rows.map((row) => ({
    classId: Number(row.class_id),
    subjectId: Number(row.subject_id),
  }))
}

/**
 * Returns the current class/subject/year-level combinations a subject teacher
 * may author academic content for. Question-bank and syllabus records do not
 * carry a class id, so the class grade is resolved through the canonical
 * grade-level row before an authoring write is accepted.
 *
 * `options` is injectable to keep this boundary independently testable; normal
 * request handlers use the application pool and active academic session.
 */
export async function getTeacherSubjectGradeScopes(req, schoolId, options = {}) {
  if (!isTeacher(req)) return null
  const db = options.db || pool
  const session = options.session || await getActiveAcademicSession(schoolId, db)
  if (session.setupRequired || !Number(session.academicYearId || 0) || !Number(session.termId || 0)) return []
  const sessionClause = " AND assignment.academic_year_id = ? AND assignment.term_id = ?"
  const sessionParams = [session.academicYearId, session.termId]
  const [rows] = await db.query(
    `SELECT DISTINCT assignment.class_id, assignment.subject_id, grade.id AS grade_id
     FROM teacher_class_subject_assignments assignment
     JOIN classes class_record
       ON class_record.school_id = assignment.school_id AND class_record.id = assignment.class_id
     LEFT JOIN grade_levels grade
       ON grade.school_id = class_record.school_id AND LOWER(TRIM(grade.name)) = LOWER(TRIM(class_record.grade_level))
     WHERE assignment.school_id = ? AND assignment.teacher_id = ?
       AND assignment.subject_id IS NOT NULL AND assignment.role = 'subject_teacher'
       AND assignment.is_active = 1${sessionClause}`,
    [schoolId, req.user.id, ...sessionParams],
  )
  return rows.map((row) => ({
    classId: Number(row.class_id),
    subjectId: Number(row.subject_id),
    gradeId: row.grade_id === null || row.grade_id === undefined ? null : Number(row.grade_id),
  }))
}

export async function assertTeacherCanAuthorSubjectGrade(req, schoolId, scope = {}, options = {}) {
  if (!isTeacher(req)) return
  const { subjectId, gradeId = null, createdBy } = scope
  if (Object.prototype.hasOwnProperty.call(scope, "createdBy") && Number(createdBy) !== Number(req.user.id)) {
    throw new HttpError(403, "Teachers can only edit academic content they created")
  }
  const subject = Number(subjectId || 0)
  const grade = gradeId === null || gradeId === undefined || gradeId === "" ? null : Number(gradeId || 0)
  if (!subject || (grade !== null && !grade)) throw new HttpError(400, "Select a valid subject and year level")
  const scopes = await getTeacherSubjectGradeScopes(req, schoolId, options)
  const allowed = scopes.some((scope) => (
    scope.subjectId === subject && (grade === null || scope.gradeId === grade)
  ))
  if (!allowed) {
    throw new HttpError(403, "Teachers can only author content for their currently assigned subject and class year level")
  }
}

export async function assertTeacherCanTeachSubject(req, schoolId, classId, subjectId, termId = null, options = {}) {
  if (!isTeacher(req)) return
  const context = await activeTeacherAssignmentContext(schoolId, options)
  if (!context) throw noCurrentTeacherAssignment()
  if (termId && Number(termId) !== context.termId) throw noCurrentTeacherAssignment()
  const [rows] = await context.db.query(
    `SELECT id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ?
       AND role = 'subject_teacher' AND is_active = 1
       AND academic_year_id = ? AND term_id = ?
     LIMIT 1`,
    [schoolId, classId, subjectId, req.user.id, context.academicYearId, context.termId],
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

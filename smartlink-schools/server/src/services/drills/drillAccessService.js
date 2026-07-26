import { pool } from "../../config/db.js"
import { HttpError } from "../../utils/http.js"

const DRILL_ADMIN_ROLES = new Set(["super_admin", "school_owner", "director", "owner", "headteacher"])
const PARENT_READ_ACTIONS = new Set(["list", "view", "summary", "history"])

function numberIds(values) {
  return [...new Set((values || []).map(Number).filter((value) => Number.isInteger(value) && value > 0))]
}

export function isDrillAdministrator(actor) {
  return DRILL_ADMIN_ROLES.has(String(actor?.role || ""))
}

export function drillActorScopeSql(actor, aliases = {}) {
  const sessionAlias = aliases.session || "ds"
  const enrollmentAlias = aliases.enrollment || "se"
  const role = String(actor?.role || "")

  if (isDrillAdministrator(actor)) return { clause: "", params: [] }
  if (role === "teacher") {
    return {
      clause: ` AND EXISTS (
        SELECT 1
        FROM teacher_class_subject_assignments drill_tcsa
        WHERE drill_tcsa.school_id = ${sessionAlias}.school_id
          AND drill_tcsa.teacher_id = ?
          AND drill_tcsa.class_id = ${enrollmentAlias}.class_id
          AND drill_tcsa.subject_id = ${sessionAlias}.subject_id
          AND drill_tcsa.role = 'subject_teacher'
          AND drill_tcsa.is_active = 1
          AND drill_tcsa.academic_year_id = ${enrollmentAlias}.academic_year_id
          AND drill_tcsa.term_id = ${enrollmentAlias}.term_id
      )`,
      params: [Number(actor?.id || 0)],
    }
  }
  if (role === "parent") {
    return {
      clause: ` AND EXISTS (
        SELECT 1
        FROM student_guardians drill_guardian
        WHERE drill_guardian.school_id = ${sessionAlias}.school_id
          AND drill_guardian.student_id = ${sessionAlias}.student_id
          AND drill_guardian.user_id = ?
      )`,
      params: [Number(actor?.id || 0)],
    }
  }
  if (role === "student") {
    return {
      clause: ` AND ${sessionAlias}.student_id = ?`,
      params: [Number(actor?.studentId || actor?.id || 0)],
    }
  }
  return { clause: " AND 1 = 0", params: [] }
}

function academicSessionSql(academicYearId, termId, alias) {
  const clauses = []
  const params = []
  if (Number(academicYearId || 0)) {
    clauses.push(` AND ${alias}.academic_year_id = ?`)
    params.push(Number(academicYearId))
  }
  if (Number(termId || 0)) {
    clauses.push(` AND ${alias}.term_id = ?`)
    params.push(Number(termId))
  }
  return { clause: clauses.join(""), params }
}

export async function getTeacherSubjectIdsForClass({
  db = pool,
  schoolId,
  teacherId,
  classId,
  academicYearId = null,
  termId = null,
}) {
  const sessionScope = academicSessionSql(academicYearId, termId, "tcsa")
  const [rows] = await db.query(
    `SELECT DISTINCT tcsa.subject_id
     FROM teacher_class_subject_assignments tcsa
     WHERE tcsa.school_id = ? AND tcsa.teacher_id = ? AND tcsa.class_id = ?
       AND tcsa.subject_id IS NOT NULL
       AND tcsa.role = 'subject_teacher' AND tcsa.is_active = 1${sessionScope.clause}
     ORDER BY tcsa.subject_id`,
    [Number(schoolId), Number(teacherId), Number(classId), ...sessionScope.params],
  )
  return numberIds(rows.map((row) => row.subject_id))
}

async function teacherLearnerAssignments({
  db,
  schoolId,
  teacherId,
  studentId,
  subjectId = null,
  academicYearId = null,
  termId = null,
}) {
  const enrollmentScope = academicSessionSql(academicYearId, termId, "se")
  const requestedSubjectId = Number(subjectId || 0)
  const subjectClause = requestedSubjectId ? " AND tcsa.subject_id = ?" : ""
  const [rows] = await db.query(
    `SELECT DISTINCT se.class_id, tcsa.subject_id
     FROM students s
     JOIN student_enrollments se ON se.school_id = s.school_id AND se.student_id = s.id
       AND se.enrollment_status = 'active'
     JOIN teacher_class_subject_assignments tcsa ON tcsa.school_id = se.school_id
       AND tcsa.teacher_id = ?
       AND tcsa.class_id = se.class_id
       AND tcsa.role = 'subject_teacher'
       AND tcsa.subject_id IS NOT NULL
       AND tcsa.is_active = 1
       AND tcsa.academic_year_id = se.academic_year_id
       AND tcsa.term_id = se.term_id
     WHERE s.school_id = ? AND s.id = ? AND s.status = 'active'${enrollmentScope.clause}${subjectClause}
     ORDER BY se.class_id, tcsa.subject_id`,
    [
      Number(teacherId),
      Number(schoolId),
      Number(studentId),
      ...enrollmentScope.params,
      ...(requestedSubjectId ? [requestedSubjectId] : []),
    ],
  )
  return rows
}

export async function assertDrillLearnerAccess({
  db = pool,
  actor,
  schoolId,
  studentId,
  subjectId = null,
  academicYearId = null,
  termId = null,
  action = "view",
}) {
  const role = String(actor?.role || "")
  const requestedStudentId = Number(studentId || 0)
  if (!requestedStudentId) throw new HttpError(400, "Student is required")

  if (isDrillAdministrator(actor)) {
    return { unrestricted: true, allowedSubjectIds: null, classIds: null }
  }

  if (role === "student") {
    if (requestedStudentId !== Number(actor?.studentId || actor?.id || 0)) {
      throw new HttpError(403, "Students can only access their own Daily Drills")
    }
    return { unrestricted: false, allowedSubjectIds: null, classIds: null }
  }

  if (role === "parent") {
    if (!PARENT_READ_ACTIONS.has(String(action || ""))) {
      throw new HttpError(403, "Parents can only view Daily Drills for linked learners")
    }
    const [[guardian]] = await db.query(
      `SELECT sg.id
       FROM student_guardians sg
       JOIN students s ON s.id = sg.student_id AND s.school_id = sg.school_id
       WHERE sg.school_id = ? AND sg.student_id = ? AND sg.user_id = ?
       LIMIT 1`,
      [Number(schoolId), requestedStudentId, Number(actor?.id || 0)],
    )
    if (!guardian) throw new HttpError(403, "Parents can only view Daily Drills for their linked learners")
    return { unrestricted: false, allowedSubjectIds: null, classIds: null }
  }

  if (role === "teacher") {
    const assignments = await teacherLearnerAssignments({
      db,
      schoolId,
      teacherId: actor?.id,
      studentId: requestedStudentId,
      subjectId,
      academicYearId,
      termId,
    })
    if (!assignments.length) {
      throw new HttpError(403, "Teachers can only access Daily Drills for actively assigned learners and subjects")
    }
    return {
      unrestricted: false,
      allowedSubjectIds: numberIds(assignments.map((row) => row.subject_id)),
      classIds: numberIds(assignments.map((row) => row.class_id)),
    }
  }

  throw new HttpError(403, "You do not have access to this learner's Daily Drills")
}

export async function assertDrillSessionAccess({
  db = pool,
  actor,
  schoolId,
  sessionId,
  academicYearId = null,
  termId = null,
  action = "view",
}) {
  const [[session]] = await db.query(
    `SELECT id, student_id, subject_id, status
     FROM drill_sessions
     WHERE school_id = ? AND id = ?
     LIMIT 1`,
    [Number(schoolId), Number(sessionId)],
  )
  if (!session) throw new HttpError(404, "Drill session was not found")
  const access = await assertDrillLearnerAccess({
    db,
    actor,
    schoolId,
    studentId: session.student_id,
    subjectId: session.subject_id,
    academicYearId,
    termId,
    action,
  })
  return { session, ...access }
}

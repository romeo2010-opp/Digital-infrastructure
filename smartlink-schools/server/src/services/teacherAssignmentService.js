import { HttpError } from "../utils/http.js"

export function normalizeAssignmentPayload(payload = {}) {
  const role = String(payload.role || "subject_teacher").trim()
  const teacherId = Number(payload.teacher_id || payload.teacherId || 0)
  const classId = Number(payload.class_id || payload.classId || 0)
  const subjectId = payload.subject_id || payload.subjectId ? Number(payload.subject_id || payload.subjectId) : null
  const academicYearId = payload.academic_year_id || payload.academicYearId ? Number(payload.academic_year_id || payload.academicYearId) : null
  const termId = payload.term_id || payload.termId ? Number(payload.term_id || payload.termId) : null
  const academicYear = String(payload.academic_year || payload.academicYear || new Date().getFullYear()).trim()
  const term = String(payload.term || "").trim()
  const streamSection = String(payload.stream_section || payload.streamSection || "").trim() || null
  const notes = String(payload.notes || "").trim() || null
  const isActive = payload.is_active === undefined ? true : Boolean(payload.is_active)

  if (!["subject_teacher", "class_teacher"].includes(role)) throw new HttpError(400, "Assignment role is invalid")
  if (!teacherId) throw new HttpError(400, "Teacher is required")
  if (!classId) throw new HttpError(400, "Class is required")
  if (!academicYear) throw new HttpError(400, "Academic year is required")
  if (role === "subject_teacher" && !subjectId) throw new HttpError(400, "Subject is required for subject teacher assignments")

  return {
    role,
    teacherId,
    classId,
    subjectId: role === "class_teacher" ? null : subjectId,
    academicYearId,
    termId,
    academicYear,
    term,
    streamSection,
    notes,
    isActive,
  }
}

export async function assertAssignmentScope(connection, schoolId, assignment) {
  const [[teacher]] = await connection.query(
    "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND is_active = 1 LIMIT 1",
    [assignment.teacherId, schoolId],
  )
  if (!teacher) throw new HttpError(400, "Select an active teacher from this school")

  const [[classRow]] = await connection.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [assignment.classId, schoolId])
  if (!classRow) throw new HttpError(400, "Select a class from this school")

  if (assignment.subjectId) {
    const [[subject]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [assignment.subjectId, schoolId])
    if (!subject) throw new HttpError(400, "Select a subject from this school")
  }

  if (assignment.academicYearId) {
    const [[year]] = await connection.query("SELECT id, name FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1", [assignment.academicYearId, schoolId])
    if (!year) throw new HttpError(400, "Select an academic year from this school")
    assignment.academicYear = String(year.name || assignment.academicYear || "").trim()
  }

  if (assignment.termId) {
    const termParams = [assignment.termId, schoolId]
    const yearClause = assignment.academicYearId ? " AND academic_year_id = ?" : ""
    if (assignment.academicYearId) termParams.push(assignment.academicYearId)
    const [[term]] = await connection.query(
      `SELECT id, name FROM terms WHERE id = ? AND school_id = ?${yearClause} LIMIT 1`,
      termParams,
    )
    if (!term) throw new HttpError(400, "Select a term that belongs to the selected academic year")
    assignment.term = String(term.name || assignment.term || "").trim()
  }
}

export async function assertNoDuplicateActiveAssignment(connection, schoolId, assignment, ignoreId = null) {
  if (!assignment.isActive) return

  if (assignment.role === "class_teacher") {
    const [rows] = await connection.query(
      `SELECT id FROM teacher_class_subject_assignments
       WHERE school_id = ? AND class_id = ? AND role = 'class_teacher'
        AND COALESCE(academic_year_id, 0) = COALESCE(?, 0)
        AND COALESCE(term_id, 0) = COALESCE(?, 0)
        AND is_active = 1
        ${ignoreId ? "AND id <> ?" : ""}
       LIMIT 1`,
      ignoreId
        ? [schoolId, assignment.classId, assignment.academicYearId, assignment.termId, ignoreId]
        : [schoolId, assignment.classId, assignment.academicYearId, assignment.termId],
    )
    if (rows.length) throw new HttpError(409, "This class already has an active class teacher for the selected year and term")
    return
  }

  const [exactDuplicates] = await connection.query(
    `SELECT id FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND class_id = ? AND subject_id = ?
      AND role = 'subject_teacher'
      AND COALESCE(academic_year_id, 0) = COALESCE(?, 0)
      AND COALESCE(term_id, 0) = COALESCE(?, 0)
      AND is_active = 1
      ${ignoreId ? "AND id <> ?" : ""}
     LIMIT 1`,
    ignoreId
      ? [schoolId, assignment.teacherId, assignment.classId, assignment.subjectId, assignment.academicYearId, assignment.termId, ignoreId]
      : [schoolId, assignment.teacherId, assignment.classId, assignment.subjectId, assignment.academicYearId, assignment.termId],
  )
  if (exactDuplicates.length) throw new HttpError(409, "This active teacher/class/subject assignment already exists")

  const [subjectDuplicates] = await connection.query(
    `SELECT id FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND subject_id = ?
      AND role = 'subject_teacher'
      AND COALESCE(academic_year_id, 0) = COALESCE(?, 0)
      AND COALESCE(term_id, 0) = COALESCE(?, 0)
      AND is_active = 1
      ${ignoreId ? "AND id <> ?" : ""}
     LIMIT 1`,
    ignoreId
      ? [schoolId, assignment.classId, assignment.subjectId, assignment.academicYearId, assignment.termId, ignoreId]
      : [schoolId, assignment.classId, assignment.subjectId, assignment.academicYearId, assignment.termId],
  )
  if (subjectDuplicates.length) throw new HttpError(409, "This subject already has an active teacher in the selected class, year, and term")
}

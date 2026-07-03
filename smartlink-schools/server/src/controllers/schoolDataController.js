import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

export async function listClasses(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "c.id")
  const [classRows] = await pool.query(
    `SELECT c.id, c.name, c.grade_level, c.teacher_user_id, u.full_name AS teacher_name,
      COUNT(DISTINCT s.id) AS student_count
     FROM classes c
     LEFT JOIN users u ON u.id = c.teacher_user_id AND u.school_id = c.school_id
     LEFT JOIN student_enrollments se ON se.class_id = c.id AND se.school_id = c.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     WHERE c.school_id = ?${classScope.clause}
     GROUP BY c.id, c.name, c.grade_level, c.teacher_user_id, u.full_name
     ORDER BY c.name`,
    [session.academicYearId, session.termId, schoolId, ...classScope.params],
  )

  const classIds = classRows.map((row) => Number(row.id))
  if (!classIds.length) return res.json({ classes: [], session: sessionPayload(session), setup_required: session.setupRequired })

  const [studentRows] = await pool.query(
    `SELECT s.id, se.class_id, COALESCE(s.student_id, s.admission_no) AS student_id, s.admission_no,
      s.first_name, s.last_name, s.gender, s.status, COALESCE(se.stream_section, s.stream_section) AS stream_section
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
      AND se.enrollment_status = 'active' AND se.class_id IN (${classIds.map(() => "?").join(", ")})
      AND s.status = 'active'
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [schoolId, session.academicYearId, session.termId, ...classIds],
  )

  const assignmentSessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const assignmentSessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [assignmentRows] = await pool.query(
    `SELECT a.id, a.teacher_id, a.class_id, a.subject_id, a.academic_year_id, a.term_id,
      a.academic_year, a.term, a.role, a.is_active, a.notes,
      u.full_name AS teacher_name, subj.name AS subject_name,
      ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND a.class_id IN (${classIds.map(() => "?").join(", ")}) AND a.is_active = 1${assignmentSessionClause}
     ORDER BY a.role, subj.name, u.full_name`,
    [schoolId, ...classIds, ...assignmentSessionParams],
  )

  const studentsByClass = new Map()
  studentRows.forEach((student) => {
    const key = Number(student.class_id)
    const rows = studentsByClass.get(key) || []
    rows.push(student)
    studentsByClass.set(key, rows)
  })

  const assignmentsByClass = new Map()
  assignmentRows.forEach((assignment) => {
    const key = Number(assignment.class_id)
    const rows = assignmentsByClass.get(key) || []
    rows.push(assignment)
    assignmentsByClass.set(key, rows)
  })

  res.json({
    classes: classRows.map((row) => {
      const students = studentsByClass.get(Number(row.id)) || []
      const assignments = assignmentsByClass.get(Number(row.id)) || []
      const classTeacherAssignment = assignments.find((assignment) => assignment.role === "class_teacher")
      const subjectAssignments = assignments.filter((assignment) => assignment.role === "subject_teacher")
      return {
        ...row,
        class_teacher: classTeacherAssignment?.teacher_name || row.teacher_name || null,
        subject_assignments: subjectAssignments,
        subject_assignment_summary: subjectAssignments.map((assignment) => `${assignment.subject_name} - ${assignment.teacher_name}`).join(", "),
        student_count: Number(row.student_count || students.length || 0),
        students,
        student_names: students.map((student) => `${student.first_name} ${student.last_name}`).join(", "),
      }
    }),
    session: sessionPayload(session),
    setup_required: session.setupRequired,
  })
}

export async function getClass(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.params.id || 0)
  const session = await getActiveAcademicSession(schoolId)
  if (!classId) throw new HttpError(400, "Class id is required")
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  if (Array.isArray(teacherClassIds) && !teacherClassIds.includes(classId)) {
    throw new HttpError(403, "Teachers can only view assigned classes")
  }

  const [[classRow]] = await pool.query(
    `SELECT c.id, c.name, c.grade_level, c.teacher_user_id, u.full_name AS teacher_name
     FROM classes c
     LEFT JOIN users u ON u.id = c.teacher_user_id AND u.school_id = c.school_id
     WHERE c.school_id = ? AND c.id = ? LIMIT 1`,
    [schoolId, classId],
  )
  if (!classRow) throw new HttpError(404, "Class was not found")

  const [students] = await pool.query(
    `SELECT s.id, COALESCE(s.student_id, s.admission_no) AS student_id, s.first_name, s.last_name,
      s.gender, s.status, COALESCE(se.stream_section, s.stream_section) AS stream_section
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
      AND se.class_id = ? AND se.enrollment_status = 'active' AND s.status = 'active'
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [schoolId, session.academicYearId, session.termId, classId],
  )
  const assignmentSessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const assignmentSessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [assignments] = await pool.query(
    `SELECT a.id, a.role, a.is_active, a.academic_year, a.term, a.notes,
      a.academic_year_id, a.term_id, u.full_name AS teacher_name,
      subj.name AS subject_name, ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND a.class_id = ?${assignmentSessionClause}
     ORDER BY a.is_active DESC, a.role, subj.name`,
    [schoolId, classId, ...assignmentSessionParams],
  )
  res.json({ class: { ...classRow, students, assignments }, session: sessionPayload(session), setup_required: session.setupRequired })
}

export async function createClass(req, res) {
  const schoolId = getScopedSchoolId(req)
  const name = String(req.body.name || "").trim()
  const gradeLevel = String(req.body.grade_level || "").trim() || null
  const teacherUserId = req.body.teacher_user_id ? Number(req.body.teacher_user_id) : null

  if (!name) throw new HttpError(400, "Class name is required")

  if (teacherUserId) {
    const [teachers] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND is_active = 1 LIMIT 1",
      [teacherUserId, schoolId],
    )
    if (!teachers.length) throw new HttpError(400, "Select an active teacher from this school")
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO classes (school_id, name, grade_level, teacher_user_id) VALUES (?, ?, ?, ?)",
      [schoolId, name, gradeLevel, teacherUserId],
    )
    res.status(201).json({
      class: {
        id: Number(result.insertId),
        school_id: schoolId,
        name,
        grade_level: gradeLevel,
        teacher_user_id: teacherUserId,
        students: [],
        student_count: 0,
      },
    })
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A class with this name already exists")
    throw error
  }
}

export async function listSubjects(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [rows] = await pool.query("SELECT id, name, code FROM subjects WHERE school_id = ? ORDER BY name", [schoolId])
  res.json({ subjects: rows })
}

export async function createSubject(req, res) {
  const schoolId = getScopedSchoolId(req)
  const name = String(req.body.name || "").trim()
  const code = String(req.body.code || "").trim().toUpperCase() || null
  if (!name) throw new HttpError(400, "Subject name is required")

  try {
    const [result] = await pool.query(
      "INSERT INTO subjects (school_id, name, code) VALUES (?, ?, ?)",
      [schoolId, name, code],
    )
    res.status(201).json({ subject: { id: Number(result.insertId), school_id: schoolId, name, code } })
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A subject with this name already exists")
    throw error
  }
}

export async function updateSubject(req, res) {
  const schoolId = getScopedSchoolId(req)
  const subjectId = Number(req.params.id || 0)
  const name = String(req.body.name || "").trim()
  const code = String(req.body.code || "").trim().toUpperCase() || null
  if (!subjectId) throw new HttpError(400, "Subject id is required")
  if (!name) throw new HttpError(400, "Subject name is required")

  try {
    const [result] = await pool.query(
      "UPDATE subjects SET name = ?, code = ? WHERE id = ? AND school_id = ?",
      [name, code, subjectId, schoolId],
    )
    if (!result.affectedRows) throw new HttpError(404, "Subject was not found")
    res.json({ ok: true, subject: { id: subjectId, school_id: schoolId, name, code } })
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A subject with this name already exists")
    throw error
  }
}

export async function deleteSubject(req, res) {
  const schoolId = getScopedSchoolId(req)
  const subjectId = Number(req.params.id || 0)
  if (!subjectId) throw new HttpError(400, "Subject id is required")

  try {
    const [result] = await pool.query("DELETE FROM subjects WHERE id = ? AND school_id = ?", [subjectId, schoolId])
    if (!result.affectedRows) throw new HttpError(404, "Subject was not found")
    res.json({ ok: true })
  } catch (error) {
    if (error?.code === "ER_ROW_IS_REFERENCED_2") {
      throw new HttpError(409, "This subject is already used by classes, homework or assessments. Rename it instead.")
    }
    throw error
  }
}

export async function listParents(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ parents: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const [rows] = await pool.query(
    `SELECT l.id, u.full_name AS parent_name, u.email, u.phone, l.relationship,
      s.first_name, s.last_name, c.name AS class_name
     FROM parent_student_links l
     JOIN users u ON u.id = l.parent_user_id AND u.school_id = l.school_id
     JOIN students s ON s.id = l.student_id AND s.school_id = l.school_id
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     WHERE l.school_id = ? AND s.status = 'active'${classScope.clause}
     ORDER BY u.full_name, ${studentCodeSortSql("s")}, s.last_name`,
    [session.academicYearId, session.termId, schoolId, ...classScope.params],
  )
  res.json({ parents: rows, session: sessionPayload(session), setup_required: false })
}

export async function listResults(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ results: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "a.class_id")
  const [rows] = await pool.query(
    `SELECT a.id, a.name AS assessment_name, a.assessment_type, a.status, es.name AS exam_session_name,
      c.name AS class_name, subj.name AS subject_name,
      a.term_name, a.total_marks,
      COALESCE(
        ROUND(AVG((re.score / NULLIF(a.total_marks, 0)) * 100), 1),
        ROUND(AVG((atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100), 1)
      ) AS average_score,
      CASE WHEN COUNT(DISTINCT re.student_id) > 0 THEN COUNT(DISTINCT re.student_id) ELSE COUNT(DISTINCT atm.student_id) END AS marked_students
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN assessment_topics at ON at.assessment_id = a.id AND at.school_id = a.school_id
     LEFT JOIN assessment_topic_marks atm ON atm.assessment_topic_id = at.id AND atm.school_id = at.school_id
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id
     WHERE a.school_id = ? AND a.academic_year_id = ? AND a.term_id = ?${classScope.clause}
     GROUP BY a.id, a.name, a.assessment_type, a.status, es.name, c.name, subj.name, a.term_name, a.total_marks
     ORDER BY a.created_at DESC`,
    [schoolId, session.academicYearId, session.termId, ...classScope.params],
  )
  res.json({ results: rows, session: sessionPayload(session), setup_required: false })
}

export async function listReports(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({
      reports: [
        { id: "students", report: "Student Register", scope: "Setup required", value: 0, status: "Needs active term" },
        { id: "fees", report: "Fee Arrears", scope: "Setup required", value: 0, status: "Needs active term" },
        { id: "attendance", report: "Attendance Risk", scope: "Setup required", value: 0, status: "Needs active term" },
        { id: "homework", report: "Homework Due", scope: "Setup required", value: 0, status: "Needs active term" },
      ],
      session: sessionPayload(session),
      setup_required: true,
    })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const attendanceClassScope = scopedInClause(teacherClassIds, "ar.class_id")
  const homeworkClassScope = scopedInClause(teacherClassIds, "h.class_id")
  const [[students], [fees], [attendance], [homework], [reportCards]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total
       FROM student_enrollments se
       JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
        AND se.enrollment_status = 'active' AND s.status = 'active'${classScope.clause}`,
      [schoolId, session.academicYearId, session.termId, ...classScope.params],
    ),
    pool.query(
      `SELECT COALESCE(SUM(f.amount_due - f.amount_paid), 0) AS outstanding
       FROM fee_accounts f
       JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
       JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       WHERE f.school_id = ? AND s.status = 'active'${classScope.clause}`,
      [session.academicYearId, session.termId, schoolId, ...classScope.params],
    ),
    pool.query(
      `SELECT COUNT(*) AS marked, SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent
       FROM attendance_records ar
       JOIN student_enrollments se ON se.student_id = ar.student_id AND se.school_id = ar.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
       WHERE ar.school_id = ? AND ar.attendance_date = CURRENT_DATE${attendanceClassScope.clause}`,
      [session.academicYearId, session.termId, schoolId, ...attendanceClassScope.params],
    ),
    pool.query(
      `SELECT COUNT(DISTINCT h.id) AS pending
       FROM homework h
       WHERE h.school_id = ? AND h.due_date BETWEEN ? AND ?${homeworkClassScope.clause}`,
      [schoolId, session.term.start_date, session.term.end_date, ...homeworkClassScope.params],
    ),
    pool.query(
      `SELECT COUNT(*) AS generated
       FROM report_cards
       WHERE school_id = ? AND academic_year_id = ? AND term_id = ? AND status IN ('generated', 'approved', 'locked')`,
      [schoolId, session.academicYearId, session.termId],
    ),
  ])

  res.json({
    reports: [
      { id: "students", report: "Student Register", scope: teacherClassIds ? "My classes" : "Whole school", value: Number(students[0]?.total || 0), status: "Ready" },
      { id: "fees", report: "Fee Arrears", scope: teacherClassIds ? "My classes" : "Whole school", value: Number(fees[0]?.outstanding || 0), status: "Ready" },
      { id: "attendance", report: "Attendance Risk", scope: "Today", value: Number(attendance[0]?.absent || 0), status: "Ready" },
      { id: "homework", report: "Homework Due", scope: "Current term", value: Number(homework[0]?.pending || 0), status: "Draft" },
      { id: "report_cards", report: "Report Cards", scope: "Approved exam results", value: Number(reportCards[0]?.generated || 0), status: "Ready" },
    ],
    session: sessionPayload(session),
    setup_required: false,
  })
}

export async function listUsers(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [rows] = await pool.query(
    `SELECT id, full_name, email, role, phone, is_active
     FROM users
     WHERE school_id = ? OR (? IS NULL AND role = 'super_admin')
     ORDER BY role, full_name`,
    [schoolId, req.user.schoolId],
  )
  res.json({ users: rows })
}

export async function quickSearch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const homeworkClassScope = scopedInClause(teacherClassIds, "h.class_id")
  const classTableScope = scopedInClause(teacherClassIds, "c.id")
  const query = `%${String(req.query.q || "").trim()}%`
  const limit = Math.min(20, Math.max(5, Number(req.query.limit || 10)))

  const [students] = session.setupRequired
    ? [[]]
    : await pool.query(
      `SELECT s.id, CONCAT(s.first_name, ' ', s.last_name) AS title, c.name AS class_name, s.admission_no
       FROM student_enrollments se
       JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
        AND se.enrollment_status = 'active' AND s.status = 'active'
        AND CONCAT(s.first_name, ' ', s.last_name, ' ', s.admission_no, ' ', COALESCE(s.student_id, ''), ' ', COALESCE(c.name, '')) LIKE ?${classScope.clause}
       ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name LIMIT ?`,
      [schoolId, session.academicYearId, session.termId, query, ...classScope.params, limit],
    )
  const [homework] = await pool.query(
    `SELECT h.id, h.title, c.name AS class_name, subj.name AS subject_name, h.status
     FROM homework h
     JOIN classes c ON c.id = h.class_id AND c.school_id = h.school_id
     JOIN subjects subj ON subj.id = h.subject_id AND subj.school_id = h.school_id
     WHERE h.school_id = ? AND CONCAT(h.title, ' ', c.name, ' ', subj.name) LIKE ?${homeworkClassScope.clause}
      ${session.setupRequired ? "" : "AND h.due_date BETWEEN ? AND ?"}
     ORDER BY h.due_date LIMIT ?`,
    session.setupRequired
      ? [schoolId, query, ...homeworkClassScope.params, limit]
      : [schoolId, query, ...homeworkClassScope.params, session.term.start_date, session.term.end_date, limit],
  )
  const [classes] = session.setupRequired
    ? [[]]
    : await pool.query(
      `SELECT c.id, c.name, c.grade_level, u.full_name AS teacher_name, COUNT(DISTINCT s.id) AS student_count
       FROM classes c
       LEFT JOIN users u ON u.id = c.teacher_user_id AND u.school_id = c.school_id
       LEFT JOIN student_enrollments se ON se.class_id = c.id AND se.school_id = c.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
       WHERE c.school_id = ? AND CONCAT(c.name, ' ', COALESCE(c.grade_level, ''), ' ', COALESCE(u.full_name, '')) LIKE ?${classTableScope.clause}
       GROUP BY c.id, c.name, c.grade_level, u.full_name
       ORDER BY c.name LIMIT ?`,
      [session.academicYearId, session.termId, schoolId, query, ...classTableScope.params, limit],
    )
  const assignmentSessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const [teachers] = req.user?.role === "teacher"
    ? [[]]
    : await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.employment_status,
        GROUP_CONCAT(DISTINCT CONCAT(c.name, ' ', COALESCE(subj.name, 'Class teacher')) ORDER BY c.name SEPARATOR ', ') AS assignment_summary
       FROM users u
       LEFT JOIN teacher_class_subject_assignments a ON a.teacher_id = u.id AND a.school_id = u.school_id AND a.is_active = 1${assignmentSessionClause}
       LEFT JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
       WHERE u.school_id = ? AND u.role IN ('teacher', 'headteacher')
         AND CONCAT(u.full_name, ' ', COALESCE(u.email, ''), ' ', COALESCE(u.phone, ''), ' ', COALESCE(u.employee_id, ''), ' ', COALESCE(u.specialization, '')) LIKE ?
       GROUP BY u.id, u.full_name, u.email, u.phone, u.employment_status
       ORDER BY u.full_name LIMIT ?`,
      session.setupRequired ? [schoolId, query, limit] : [session.academicYearId, session.termId, schoolId, query, limit],
    )
  const [fees] = req.user?.role === "teacher"
    ? [[]]
    : session.setupRequired
      ? [[]]
    : await pool.query(
      `SELECT f.id, CONCAT(s.first_name, ' ', s.last_name) AS title, c.name AS class_name, f.status, f.amount_due - f.amount_paid AS balance
       FROM fee_accounts f
       JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
       JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
       WHERE f.school_id = ? AND s.status = 'active'
        AND CONCAT(s.first_name, ' ', s.last_name, ' ', f.status, ' ', COALESCE(c.name, '')) LIKE ?${classScope.clause}
       ORDER BY balance DESC, ${studentCodeSortSql("s")} LIMIT ?`,
      [session.academicYearId, session.termId, schoolId, query, ...classScope.params, limit],
    )

  const groups = [
      {
        type: "students",
        label: "Learners",
        results: students.map((row) => ({
          id: String(row.id),
          title: row.title,
          subtitle: `${row.class_name || "No class"} · ${row.admission_no}`,
          resultType: "STUDENT",
          className: row.class_name,
          route: `/students/${row.id}`,
        })),
      },
      {
        type: "teachers",
        label: "Teachers",
        results: teachers.map((row) => ({
          id: String(row.id),
          title: row.full_name,
          subtitle: `${row.phone || row.email || "No contact"} · ${row.assignment_summary || "No active assignments"}`,
          resultType: "TEACHER",
          status: row.employment_status,
          route: `/teachers/${row.id}`,
        })),
      },
      {
        type: "classes",
        label: "Classes",
        results: classes.map((row) => ({
          id: String(row.id),
          title: row.name,
          subtitle: `${row.grade_level || "Class"} · ${Number(row.student_count || 0).toLocaleString()} learners`,
          resultType: "CLASS",
          status: row.teacher_name || "Unassigned",
          route: `/classes/${row.id}`,
        })),
      },
      {
        type: "fees",
        label: "Fees",
        results: fees.map((row) => ({
          id: String(row.id),
          title: row.title,
          subtitle: `${row.class_name || "No class"} · MWK ${Number(row.balance || 0).toLocaleString()}`,
          resultType: "FEE",
          status: row.status,
          className: row.class_name,
          route: "/fees",
        })),
      },
      {
        type: "homework",
        label: "Homework",
        results: homework.map((row) => ({
          id: String(row.id),
          title: row.title,
          subtitle: `${row.class_name} · ${row.subject_name}`,
          resultType: "HOMEWORK",
          status: row.status,
          className: row.class_name,
          route: "/homework",
        })),
      },
    ].filter((group) => group.results.length)
  const results = groups.flatMap((group) =>
    group.results.map((row) => ({ ...row, groupType: group.type, groupLabel: group.label })),
  )
  res.json({ groups, results, total: results.length, session: sessionPayload(session), setup_required: session.setupRequired })
}

import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { listLearnerSupportIndicators } from "../services/academicSupportService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"
import { randomUUID } from "crypto"
import bcrypt from "bcryptjs"
import { getEffectivePermissions, listPermissionState, replacePermissionOverrides } from "../services/authorizationService.js"
import { interpretAwareSearch } from "../services/awareSearchService.js"
import { searchSchoolRecords } from "../services/schoolSearchService.js"

const STAFF_INVITE_ROLES = new Set(["teacher", "headteacher", "bursar", "librarian", "parent"])

function splitStaffName(value) {
  const parts = String(value || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean)
  return {
    fullName: parts.join(" "),
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || null,
  }
}

function temporaryStaffPassword(name) {
  const safeName = String(name || "Staff").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "Staff"
  return `${safeName.slice(0, 1).toUpperCase()}${safeName.slice(1).toLowerCase()}@${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`
}

export async function listClasses(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "c.id")
  const [classRows] = await pool.query(
    `SELECT c.id, c.public_ref, c.name, c.grade_level, c.teacher_user_id, u.full_name AS teacher_name,
      COUNT(DISTINCT s.id) AS student_count
     FROM classes c
     LEFT JOIN users u ON u.id = c.teacher_user_id AND u.school_id = c.school_id
     LEFT JOIN student_enrollments se ON se.class_id = c.id AND se.school_id = c.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     WHERE c.school_id = ?${classScope.clause}
     GROUP BY c.id, c.public_ref, c.name, c.grade_level, c.teacher_user_id, u.full_name
     ORDER BY c.name`,
    [session.academicYearId, session.termId, schoolId, ...classScope.params],
  )

  const classIds = classRows.map((row) => Number(row.id))
  if (!classIds.length) return res.json({ classes: [], session: sessionPayload(session), setup_required: session.setupRequired })

  const [studentRows] = await pool.query(
    `SELECT s.id, s.public_ref, se.class_id, COALESCE(s.student_id, s.admission_no) AS student_id, s.admission_no,
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
    ? " AND 1 = 0"
    : " AND a.academic_year_id = ? AND a.term_id = ?"
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
        class_teacher: classTeacherAssignment?.teacher_name || null,
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
  const [[classReference]] = await pool.query("SELECT id FROM classes WHERE school_id = ? AND public_ref = ? LIMIT 1", [schoolId, String(req.params.id || "")])
  const classId = Number(classReference?.id || 0)
  const session = await getActiveAcademicSession(schoolId)
  if (!classId) throw new HttpError(400, "Class id is required")
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  if (Array.isArray(teacherClassIds) && !teacherClassIds.includes(classId)) {
    throw new HttpError(403, "Teachers can only view assigned classes")
  }

  const [[classRow]] = await pool.query(
    `SELECT c.id, c.public_ref, c.name, c.grade_level, c.teacher_user_id, u.full_name AS teacher_name
     FROM classes c
     LEFT JOIN users u ON u.id = c.teacher_user_id AND u.school_id = c.school_id
     WHERE c.school_id = ? AND c.id = ? LIMIT 1`,
    [schoolId, classId],
  )
  if (!classRow) throw new HttpError(404, "Class was not found")

  const [students] = await pool.query(
    `SELECT s.id, s.public_ref, COALESCE(s.student_id, s.admission_no) AS student_id, s.first_name, s.last_name,
      s.gender, s.status, COALESCE(se.stream_section, s.stream_section) AS stream_section
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
      AND se.class_id = ? AND se.enrollment_status = 'active' AND s.status = 'active'
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [schoolId, session.academicYearId, session.termId, classId],
  )
  const supportIndicators = await listLearnerSupportIndicators(schoolId, req.user, classId)
  const supportByLearner = new Map(supportIndicators.map((item) => [item.learner_ref, item]))
  const assignmentSessionClause = session.setupRequired
    ? " AND 1 = 0"
    : " AND a.academic_year_id = ? AND a.term_id = ?"
  const assignmentSessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [assignments] = await pool.query(
    `SELECT a.id, a.teacher_id, a.role, a.is_active, a.academic_year, a.term, a.notes,
      a.academic_year_id, a.term_id, u.full_name AS teacher_name,
      subj.name AS subject_name, ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND a.class_id = ? AND a.is_active = 1${assignmentSessionClause}
     ORDER BY a.is_active DESC, a.role, subj.name`,
    [schoolId, classId, ...assignmentSessionParams],
  )
  const classTeacherAssignment = assignments.find((assignment) => assignment.role === "class_teacher") || null
  res.json({
    class: {
      ...classRow,
      teacher_user_id: classTeacherAssignment?.teacher_id ? Number(classTeacherAssignment.teacher_id) : null,
      teacher_name: classTeacherAssignment?.teacher_name || null,
      students: students.map((student) => ({ ...student, learner_support: supportByLearner.get(student.public_ref) || null })),
      assignments,
    },
    session: sessionPayload(session),
    setup_required: session.setupRequired,
  })
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
      "INSERT INTO classes (public_ref, school_id, name, grade_level, teacher_user_id) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), schoolId, name, gradeLevel, teacherUserId],
    )
    const [[createdClass]] = await pool.query("SELECT public_ref FROM classes WHERE id=? AND school_id=?", [result.insertId,schoolId])
    res.status(201).json({
      class: {
        public_ref: createdClass.public_ref,
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
    `SELECT sg.id, sg.public_ref AS guardian_ref, COALESCE(sg.guardian_number,1) guardian_number,
      COALESCE(sg.full_name,'Guardian not recorded') AS parent_name,
      sg.full_name AS guardian_name, sg.relationship,
      COALESCE(sg.primary_phone, u.phone) AS phone,
      COALESCE(sg.email, u.email) AS email,
      sg.primary_phone AS guardian_phone, sg.email AS guardian_email,
      u.public_ref AS parent_ref, u.full_name AS login_name, u.email AS login_email, u.is_active AS account_active,
      s.public_ref AS student_ref, s.admission_no, s.first_name, s.last_name,
      c.name AS class_name
     FROM students s
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.school_id = s.school_id
     LEFT JOIN users u ON u.id = sg.user_id AND u.school_id = sg.school_id AND u.role = 'parent'
     WHERE s.school_id = ? AND s.status = 'active'${classScope.clause}
     ORDER BY sg.full_name IS NULL,sg.full_name,${studentCodeSortSql("s")},s.last_name,sg.guardian_number`,
    [session.academicYearId, session.termId, schoolId, ...classScope.params],
  )
  res.json({
    parents: rows.map((row) => ({
      ...row,
      account_active: row.parent_ref ? Boolean(row.account_active) : false,
      account_status: !row.guardian_ref ? "guardian_missing" : row.parent_ref ? (row.account_active ? "linked" : "disabled") : "not_linked",
      guardian_missing: !row.guardian_ref,
    })),
    session: sessionPayload(session),
    setup_required: false,
  })
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
    `SELECT id, public_ref, full_name, email, role, phone, is_active
     FROM users
     WHERE school_id = ? OR (? IS NULL AND role = 'super_admin')
     ORDER BY role, full_name`,
    [schoolId, req.user.schoolId],
  )
  const users = await Promise.all(rows.map(async (row) => ({
    public_ref: row.public_ref,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    is_active: Boolean(row.is_active),
    permissions: await getEffectivePermissions(schoolId, row.id, row.role),
  })))
  res.json({ users })
}

export async function createSchoolUser(req, res) {
  const schoolId = getScopedSchoolId(req)
  const role = String(req.body?.role || "").trim().toLowerCase()
  const email = String(req.body?.email || "").trim().toLowerCase()
  let phone = String(req.body?.phone || "").trim() || null
  let name = splitStaffName(req.body?.full_name)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid staff email address")
  if (!STAFF_INVITE_ROLES.has(role)) throw new HttpError(400, "Select a supported school staff role")
  if (role === "parent" && !req.body?.student_ref) throw new HttpError(400, "Select the learner and guardian record for this parent login")
  if (role === "parent") {
    const guardianNumber = Math.max(1, Math.min(2, Number(req.body.guardian_number || 1)))
    const [[guardianIdentity]] = await pool.query(`SELECT sg.full_name,sg.primary_phone
      FROM students s LEFT JOIN student_guardians sg ON sg.school_id=s.school_id AND sg.student_id=s.id AND sg.guardian_number=?
      WHERE s.school_id=? AND s.public_ref=? LIMIT 1`, [guardianNumber, schoolId, String(req.body.student_ref)])
    if (!guardianIdentity) throw new HttpError(400, "The selected learner was not found")
    if (guardianIdentity.full_name) name = splitStaffName(guardianIdentity.full_name)
    phone = phone || guardianIdentity.primary_phone || null
  }
  if (!name.fullName || name.fullName.length < 2) throw new HttpError(400, role === "parent" ? "The recorded guardian must have a full name" : "Enter the staff member's full name")

  const temporaryPassword = temporaryStaffPassword(name.firstName)
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)
  const publicRef = randomUUID()
  const roleType = role === "headteacher" ? "headteacher" : "teacher"
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [insert] = await connection.query(
      `INSERT INTO users (
        public_ref,school_id,role,full_name,first_name,last_name,email,password_hash,must_change_password,phone,
        employment_status,role_type,is_active
      ) VALUES (?,?,?,?,?,?,?,?,1,?,'active',?,1)`,
      [publicRef, schoolId, role, name.fullName, name.firstName, name.lastName, email, passwordHash, phone, roleType],
    )
    if(role==='parent'&&req.body?.student_ref){
      const [[student]]=await connection.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,String(req.body.student_ref)])
      if(!student)throw new HttpError(400,'The student selected for this guardian account was not found.')
      const guardianNumber=Math.max(1,Math.min(2,Number(req.body.guardian_number||1)))
      const [[guardian]]=await connection.query("SELECT id,user_id FROM student_guardians WHERE school_id=? AND student_id=? AND guardian_number=? LIMIT 1 FOR UPDATE",[schoolId,student.id,guardianNumber])
      if(guardian?.user_id)throw new HttpError(409,'That guardian already has a parent login. Link another guardian record or use the existing account.')
      if(guardian)await connection.query("UPDATE student_guardians SET user_id=? WHERE id=? AND school_id=? AND user_id IS NULL",[insert.insertId,guardian.id,schoolId])
      else await connection.query(`INSERT INTO student_guardians (public_ref,school_id,student_id,user_id,guardian_number,full_name,relationship,primary_phone,email)
        VALUES (?,?,?,?,?,?,?,?,?)`,[randomUUID(),schoolId,student.id,insert.insertId,guardianNumber,name.fullName,String(req.body.relationship||'guardian').trim().slice(0,60)||'guardian',phone,email])
    }
    await connection.query(
      `INSERT INTO audit_logs (school_id,actor_user_id,actor_role,action,entity_type,entity_id,after_value)
       VALUES (?,?,?,'SCHOOL_USER_CREATED','user',?,?)`,
      [schoolId, req.user.id, req.user.role, insert.insertId, JSON.stringify({ public_ref: publicRef, role, email })],
    ).catch((error) => { if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error })
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A user with that email already exists")
    throw error
  } finally {
    connection.release()
  }

  res.status(201).json({
    user: { public_ref: publicRef, full_name: name.fullName, email, phone, role, is_active: true, must_change_password: true },
    temporary_password: temporaryPassword,
    temporary_password_notice: "Share this password securely once. The user must replace it at first login.",
  })
}

export async function linkParentGuardian(req,res) {
  const schoolId=getScopedSchoolId(req)
  const userRef=String(req.params.userRef||'')
  const studentRef=String(req.body?.student_ref||'')
  const guardianNumber=Math.max(1,Math.min(2,Number(req.body?.guardian_number||1)))
  const connection=await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[parent]]=await connection.query("SELECT id,role,full_name,email FROM users WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,userRef])
    if(!parent||parent.role!=='parent')throw new HttpError(400,'Select a parent or guardian user account.')
    const [[student]]=await connection.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,studentRef])
    if(!student)throw new HttpError(404,'Student was not found.')
    const [[guardian]]=await connection.query("SELECT id,user_id,full_name,email FROM student_guardians WHERE school_id=? AND student_id=? AND guardian_number=? LIMIT 1 FOR UPDATE",[schoolId,student.id,guardianNumber])
    if(!guardian)throw new HttpError(404,'That guardian record is not available on the student profile.')
    const sameName=String(parent.full_name||'').trim().toLowerCase()===String(guardian.full_name||'').trim().toLowerCase()
    const sameEmail=guardian.email&&String(parent.email||'').trim().toLowerCase()===String(guardian.email).trim().toLowerCase()
    if(!sameName&&!sameEmail)throw new HttpError(409,'The selected login does not match this learner’s recorded guardian name or email.')
    if(guardian.user_id&&Number(guardian.user_id)!==Number(parent.id))throw new HttpError(409,'That guardian is already linked to a different parent login.')
    if(!guardian.user_id)await connection.query("UPDATE student_guardians SET user_id=? WHERE id=? AND school_id=? AND user_id IS NULL",[parent.id,guardian.id,schoolId])
    await connection.query("INSERT INTO audit_logs (school_id,actor_user_id,actor_role,action,entity_type,entity_id,after_value) VALUES (?,?,?,'PARENT_GUARDIAN_LINKED','student',?,?)",[schoolId,req.user.id,req.user.role,student.id,JSON.stringify({parent_ref:userRef,student_ref:studentRef,guardian_number:guardianNumber})]).catch((error)=>{if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code))throw error})
    await connection.commit()
  } catch(error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  res.json({linked:true,parent_ref:userRef,student_ref:studentRef,guardian_number:guardianNumber})
}

export async function getUserPermissions(req, res) {
  res.json(await listPermissionState(getScopedSchoolId(req), String(req.params.userRef || "")))
}

export async function updateUserPermissions(req, res) {
  res.json(await replacePermissionOverrides(
    getScopedSchoolId(req),
    String(req.params.userRef || ""),
    req.user.id,
    Array.isArray(req.body.permissions) ? req.body.permissions : [],
  ))
}

export async function quickSearch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const rawQuery = String(req.query.q || "").trim()
  if (rawQuery.length < 2) throw new HttpError(400, "Enter at least two characters to search.")
  const limit = Math.min(50, Math.max(5, Number(req.query.limit || 10)))
  const interpretation = interpretAwareSearch(rawQuery, { type: req.query.type })
  const permissions = await getEffectivePermissions(schoolId, req.user.id, req.user.role)
  const search = await searchSchoolRecords({ db: pool, schoolId, session, user: req.user, teacherClassIds, permissions, interpretation, limit })
  res.json({ ...search, interpretation: interpretation.label, understood: interpretation, session: sessionPayload(session), setup_required: session.setupRequired })
}

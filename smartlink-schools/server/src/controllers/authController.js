import bcrypt from "bcryptjs"
import { pool } from "../config/db.js"
import { signSession } from "../middleware/auth.js"
import { HttpError } from "../utils/http.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"

async function decorateSessionUser(user) {
  if (!user?.schoolId) return user
  const session = await getActiveAcademicSession(user.schoolId)
  const [[school]] = await pool.query(
    "SELECT name, city, country FROM schools WHERE id = ? LIMIT 1",
    [user.schoolId],
  )
  const baseUser = {
    ...user,
    schoolName: school?.name || null,
    schoolCity: school?.city || null,
    schoolCountry: school?.country || null,
    academicSession: sessionPayload(session),
    mustChangePassword: Boolean(user.mustChangePassword),
  }

  if (user.role === "student") {
    const sessionJoin = session.setupRequired
      ? ""
      : "AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'"
    const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
    const studentId = Number(user.studentId || user.id || 0)
    const [students] = await pool.query(
      `SELECT s.id, COALESCE(s.student_id, s.admission_no) AS student_code, s.admission_no,
        s.first_name, s.last_name, s.stream_section,
        COALESCE(se.class_id, s.class_id) AS class_id,
        COALESCE(se.stream_section, s.stream_section) AS current_stream_section,
        c.name AS class_name
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id ${sessionJoin}
       LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
       WHERE s.school_id = ? AND s.id = ? AND s.status = 'active'
       ORDER BY se.id IS NULL, s.id
       LIMIT 1`,
      [...sessionParams, user.schoolId, studentId],
    )
    const student = students[0]
    return {
      ...baseUser,
      id: student ? Number(student.id) : studentId || user.id,
      studentId: student ? Number(student.id) : user.studentId || null,
      studentCode: student?.student_code || user.studentCode || null,
      admissionNo: student?.admission_no || user.admissionNo || null,
      classId: student?.class_id ? Number(student.class_id) : user.classId || null,
      className: student?.class_name || user.className || null,
      streamSection: student?.current_stream_section || student?.stream_section || user.streamSection || null,
    }
  }

  if (user.role !== "teacher") return baseUser
  const sessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [classes] = await pool.query(
    `SELECT id, name FROM classes WHERE school_id = ? AND teacher_user_id = ?
     UNION
     SELECT c.id, c.name
     FROM teacher_class_subject_assignments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     WHERE a.school_id = ? AND a.teacher_id = ? AND a.is_active = 1${sessionClause}
     ORDER BY name`,
    [user.schoolId, user.id, user.schoolId, user.id, ...sessionParams],
  )
  return {
    ...baseUser,
    classIds: classes.map((row) => Number(row.id)),
    classes: classes.map((row) => ({ id: Number(row.id), name: row.name })),
  }
}

async function loginStudent(req) {
  const studentCode = String(
    req.body.student_code || req.body.studentCode || req.body.admission_no || req.body.admissionNo || req.body.email || "",
  ).trim()
  const password = String(req.body.password || "")
  if (!studentCode || !password) throw new HttpError(401, "Invalid credentials")

  const [rows] = await pool.query(
    `SELECT s.id, s.school_id, 'student' AS role, NULL AS email,
      CONCAT(s.first_name, ' ', s.last_name) AS full_name, 0 AS must_change_password,
      s.id AS student_db_id, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.admission_no, s.date_of_birth, COALESCE(se.class_id, s.class_id) AS class_id, c.name AS class_name
     FROM students s
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.enrollment_status = 'active'
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
     WHERE s.status = 'active'
       AND (s.student_id = ? OR s.admission_no = ?)
     ORDER BY se.created_at DESC, se.id DESC
     LIMIT 1`,
    [studentCode, studentCode],
  )
  const user = rows[0]
  if (!user || !studentDatePasswordCandidates(user.date_of_birth).has(password.trim())) {
    throw new HttpError(401, "Invalid credentials")
  }
  return user
}

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

function studentDatePasswordCandidates(dateOfBirth) {
  const iso = dateOnly(dateOfBirth)
  const [year, month, day] = iso.split("-")
  if (!year || !month || !day) return new Set()
  return new Set([
    `${year}-${month}-${day}`,
    `${year}/${month}/${day}`,
    `${day}-${month}-${year}`,
    `${day}/${month}/${year}`,
    `${year}${month}${day}`,
    `${day}${month}${year}`,
  ])
}

async function loginStaff(req) {
  const email = String(req.body.email || "").trim()
  const password = String(req.body.password || "")
  if (!email || !password) throw new HttpError(401, "Invalid credentials")

  const [rows] = await pool.query(
    "SELECT id, school_id, role, email, full_name, password_hash, must_change_password FROM users WHERE email = ? AND role <> 'student' AND is_active = 1 LIMIT 1",
    [email],
  )
  const user = rows[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, "Invalid credentials")
  }
  return user
}

export async function login(req, res) {
  const loginType = String(req.body.login_type || req.body.loginType || "").toLowerCase()
  const hasStudentCode = Boolean(req.body.student_code || req.body.studentCode || req.body.admission_no || req.body.admissionNo)
  const user = loginType === "student" || hasStudentCode ? await loginStudent(req) : await loginStaff(req)

  const sessionUser = {
    id: user.id,
    schoolId: user.school_id,
    role: user.role,
    email: user.email,
    fullName: user.full_name,
    mustChangePassword: Boolean(user.must_change_password),
    studentId: user.student_db_id ? Number(user.student_db_id) : null,
    studentCode: user.student_code || null,
    admissionNo: user.admission_no || null,
    classId: user.class_id ? Number(user.class_id) : null,
    className: user.class_name || null,
  }

  const decoratedUser = await decorateSessionUser(sessionUser)
  res.json({ token: signSession(decoratedUser), user: decoratedUser })
}

export async function me(req, res) {
  res.json({ user: await decorateSessionUser(req.user) })
}

function validateNewPassword(password) {
  const value = String(password || "")
  if (value.length < 8) throw new HttpError(400, "New password must be at least 8 characters")
  if (!/[A-Z]/.test(value)) throw new HttpError(400, "New password needs an uppercase letter")
  if (!/[a-z]/.test(value)) throw new HttpError(400, "New password needs a lowercase letter")
  if (!/[0-9]/.test(value)) throw new HttpError(400, "New password needs a number")
  if (!/[^A-Za-z0-9]/.test(value)) throw new HttpError(400, "New password needs a symbol")
  return value
}

export async function changePassword(req, res) {
  const currentPassword = String(req.body.current_password || req.body.currentPassword || "")
  const newPassword = validateNewPassword(req.body.new_password || req.body.newPassword)
  const confirmPassword = String(req.body.confirm_password || req.body.confirmPassword || newPassword)
  if (newPassword !== confirmPassword) throw new HttpError(400, "New passwords do not match")

  const [rows] = await pool.query(
    "SELECT id, school_id, role, email, full_name, password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1",
    [req.user.id],
  )
  const user = rows[0]
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(401, "Current password is incorrect")
  }
  if (await bcrypt.compare(newPassword, user.password_hash)) {
    throw new HttpError(400, "Choose a new password that is different from the temporary password")
  }

  const nextHash = await bcrypt.hash(newPassword, 10)
  await pool.query(
    "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextHash, user.id],
  )

  const sessionUser = {
    id: user.id,
    schoolId: user.school_id,
    role: user.role,
    email: user.email,
    fullName: user.full_name,
    mustChangePassword: false,
  }
  const decoratedUser = await decorateSessionUser(sessionUser)
  res.json({ token: signSession(decoratedUser), user: decoratedUser })
}

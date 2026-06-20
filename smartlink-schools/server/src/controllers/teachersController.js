import bcrypt from "bcryptjs"
import crypto from "crypto"
import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"

function splitName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim()
}

function normalizeTeacherPayload(payload = {}) {
  const firstName = String(payload.first_name || payload.firstName || "").trim()
  const lastName = String(payload.last_name || payload.lastName || "").trim()
  const phone = String(payload.phone || "").trim()
  const email = String(payload.email || "").trim().toLowerCase()
  const employeeId = String(payload.employee_id || payload.employeeId || "").trim() || null
  const roleType = String(payload.role_type || payload.roleType || "teacher").trim()
  const employmentStatus = String(payload.employment_status || payload.employmentStatus || "active").trim()

  if (!firstName) throw new HttpError(400, "First name is required")
  if (!lastName) throw new HttpError(400, "Last name is required")
  if (!phone) throw new HttpError(400, "Phone is required")
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid teacher email")
  if (!["teacher", "headteacher", "deputy_headteacher", "admin_teacher"].includes(roleType)) throw new HttpError(400, "Teacher role type is invalid")
  if (!["active", "inactive", "suspended", "left"].includes(employmentStatus)) throw new HttpError(400, "Employment status is invalid")

  return {
    firstName,
    lastName,
    fullName: splitName(firstName, lastName),
    phone,
    email,
    employeeId,
    roleType,
    role: roleType === "headteacher" ? "headteacher" : "teacher",
    employmentStatus,
    gender: String(payload.gender || "").trim() || null,
    dateOfBirth: String(payload.date_of_birth || payload.dateOfBirth || "").trim() || null,
    nationalId: String(payload.national_id || payload.nationalId || "").trim() || null,
    qualification: String(payload.qualification || "").trim() || null,
    specialization: String(payload.specialization || "").trim() || null,
    address: String(payload.address || "").trim() || null,
    profilePhotoUrl: String(payload.profile_photo_url || payload.profilePhotoUrl || "").trim() || null,
  }
}

function generatedTeacherEmail(schoolId) {
  return `teacher-${schoolId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@smartlink.local`
}

function passwordNamePart(value) {
  const cleaned = String(value || "Teacher").replace(/[^a-z0-9]/gi, "")
  const safe = cleaned || "Teacher"
  return `${safe.slice(0, 1).toUpperCase()}${safe.slice(1, 9).toLowerCase()}`
}

function passwordYearPart(dateValue) {
  const date = new Date(dateValue)
  if (!dateValue || Number.isNaN(date.getTime())) return "School"
  return String(date.getFullYear())
}

function generatedTemporaryPassword(teacher) {
  const namePart = passwordNamePart(teacher.firstName || teacher.lastName)
  const yearPart = passwordYearPart(teacher.dateOfBirth)
  const randomPart = crypto.randomBytes(2).toString("hex").toUpperCase()
  return `${namePart}${yearPart}@${randomPart}`
}

function teacherSelect() {
  return `id, school_id, role, full_name, first_name, last_name, email, must_change_password, phone, gender, date_of_birth,
    national_id, employee_id, qualification, specialization, address, profile_photo_url,
    employment_status, role_type, is_active, created_at, updated_at`
}

export async function listTeachers(req, res) {
  const schoolId = getScopedSchoolId(req)
  const search = `%${String(req.query.search || "").trim()}%`
  const [rows] = await pool.query(
    `SELECT ${teacherSelect()}
     FROM users
     WHERE school_id = ? AND role IN ('teacher', 'headteacher')
       AND CONCAT(full_name, ' ', COALESCE(email, ''), ' ', COALESCE(phone, ''), ' ', COALESCE(employee_id, ''), ' ', COALESCE(specialization, '')) LIKE ?
     ORDER BY COALESCE(last_name, SUBSTRING_INDEX(full_name, ' ', -1)), COALESCE(first_name, SUBSTRING_INDEX(full_name, ' ', 1)), full_name`,
    [schoolId, search],
  )
  res.json({ teachers: rows })
}

export async function createTeacher(req, res) {
  const schoolId = getScopedSchoolId(req)
  const teacher = normalizeTeacherPayload(req.body)
  const email = teacher.email || generatedTeacherEmail(schoolId)
  const temporaryPassword = generatedTemporaryPassword(teacher)
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  try {
    const [result] = await pool.query(
      `INSERT INTO users (
        school_id, role, full_name, first_name, last_name, email, password_hash, must_change_password, phone,
        gender, date_of_birth, national_id, employee_id, qualification, specialization, address,
        profile_photo_url, employment_status, role_type, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        teacher.role,
        teacher.fullName,
        teacher.firstName,
        teacher.lastName,
        email,
        passwordHash,
        1,
        teacher.phone,
        teacher.gender,
        teacher.dateOfBirth,
        teacher.nationalId,
        teacher.employeeId,
        teacher.qualification,
        teacher.specialization,
        teacher.address,
        teacher.profilePhotoUrl,
        teacher.employmentStatus,
        teacher.roleType,
        teacher.employmentStatus === "active" ? 1 : 0,
      ],
    )
    res.status(201).json({
      teacher: {
        id: Number(result.insertId),
        school_id: schoolId,
        role: teacher.role,
        role_type: teacher.roleType,
        full_name: teacher.fullName,
        first_name: teacher.firstName,
        last_name: teacher.lastName,
        email,
        phone: teacher.phone,
        employee_id: teacher.employeeId,
        employment_status: teacher.employmentStatus,
        must_change_password: true,
      },
      temporary_password: temporaryPassword,
      temporary_password_notice: "Share this temporary password once. The teacher must change it at first login.",
    })
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "Teacher email or employee ID already exists")
    throw error
  }
}

export async function getTeacher(req, res) {
  const schoolId = getScopedSchoolId(req)
  const teacherId = Number(req.params.id || 0)
  if (!teacherId) throw new HttpError(400, "Teacher id is required")

  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  if (teacherClassIds && Number(req.user.id) !== teacherId) {
    const scope = scopedInClause(teacherClassIds, "a.class_id")
    const [sharedRows] = await pool.query(
      `SELECT a.id FROM teacher_class_subject_assignments a WHERE a.school_id = ? AND a.teacher_id = ?${scope.clause} LIMIT 1`,
      [schoolId, teacherId, ...scope.params],
    )
    if (!sharedRows.length) throw new HttpError(403, "Teachers can only view assigned teacher context")
  }

  const [rows] = await pool.query(
    `SELECT ${teacherSelect()}
     FROM users
     WHERE school_id = ? AND id = ? AND role IN ('teacher', 'headteacher')
     LIMIT 1`,
    [schoolId, teacherId],
  )
  const teacher = rows[0]
  if (!teacher) throw new HttpError(404, "Teacher was not found")

  const [assignments] = await pool.query(
    `SELECT a.id, a.role, a.is_active, a.academic_year, a.term, a.notes,
      a.academic_year_id, a.term_id, c.name AS class_name, c.grade_level,
      subj.name AS subject_name, ay.name AS academic_year_name, t.name AS term_name
     FROM teacher_class_subject_assignments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND a.teacher_id = ?
     ORDER BY a.is_active DESC, c.name, subj.name`,
    [schoolId, teacherId],
  )

  res.json({ teacher: { ...teacher, assignments } })
}

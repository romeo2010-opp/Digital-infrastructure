import { pool } from "../config/db.js"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { generateStudentId, validateStudentSetupPayload } from "../services/studentSetupService.js"
import { getActiveAcademicSession, requireActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

const STUDENT_PHOTO_TYPES = new Set(["image/png", "image/jpeg"])
const STUDENT_PHOTO_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
}
const STUDENT_STATUSES = new Set(["active", "suspended", "transferred_out", "withdrawn", "graduated", "archived"])
const STUDENT_TYPES = new Set(["new", "returning", "transfer"])

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function cleanOptionalText(value, maxLength = 255) {
  const text = cleanText(value)
  return text ? text.slice(0, maxLength) : null
}

function cleanRequiredText(value, fieldName, maxLength = 100) {
  const text = cleanText(value)
  if (!text) throw new HttpError(400, `${fieldName} is required`)
  return text.slice(0, maxLength)
}

function cleanDate(value, fieldName) {
  const text = cleanText(value)
  if (!text) throw new HttpError(400, `${fieldName} is required`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${fieldName} must use YYYY-MM-DD`)
  return text
}

function cleanOptionalDate(value, fieldName) {
  const text = cleanText(value)
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${fieldName} must use YYYY-MM-DD`)
  return text
}

function pickBodyValue(body, snakeKey, camelKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(body, snakeKey)) return body[snakeKey]
  if (Object.prototype.hasOwnProperty.call(body, camelKey)) return body[camelKey]
  return fallback
}

export async function listStudents(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({
      students: [],
      unassigned_students: [],
      setup_required: true,
      message: session.message,
      session: sessionPayload(session),
    })
  }

  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const search = `%${req.query.search || ""}%`
  const status = String(req.query.status || "active")
  const allowedStatus = ["active", "suspended", "transferred_out", "withdrawn", "graduated", "archived"]
  const studentStatus = allowedStatus.includes(status) ? status : "active"

  if (status === "unassigned") {
    if (Array.isArray(teacherClassIds)) {
      return res.json({
        students: [],
        unassigned_students: [],
        setup_required: false,
        session: sessionPayload(session),
      })
    }
    const [unassignedRows] = await pool.query(
      `SELECT s.id, s.class_id, COALESCE(s.student_id, s.admission_no) AS student_id, s.admission_no,
        s.first_name, s.last_name, s.date_of_birth, s.gender, s.status,
        s.stream_section, s.enrollment_date, s.student_type, s.previous_school,
        NULL AS current_enrollment_id, NULL AS class_name, NULL AS academic_year_name, NULL AS term_name,
        g.primary_phone AS guardian_phone, 0 AS fee_balance
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ?
       LEFT JOIN student_guardians g ON g.student_id = s.id AND g.school_id = s.school_id AND g.guardian_number = 1
       WHERE s.school_id = ? AND s.status = 'active' AND se.id IS NULL
        AND CONCAT(s.first_name, ' ', s.last_name, ' ', COALESCE(s.student_id, ''), ' ', s.admission_no) LIKE ?
       ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name
       LIMIT 100`,
      [session.academicYearId, session.termId, schoolId, search],
    )
    return res.json({
      students: [],
      unassigned_students: unassignedRows,
      setup_required: false,
      session: sessionPayload(session),
    })
  }

  const [rows] = await pool.query(
    `SELECT s.id, se.class_id, COALESCE(s.student_id, s.admission_no) AS student_id, s.admission_no,
      s.first_name, s.last_name, s.date_of_birth, s.gender, s.status,
      COALESCE(se.stream_section, s.stream_section) AS stream_section, s.enrollment_date, s.student_type, s.previous_school,
      se.id AS current_enrollment_id, se.enrollment_type, se.enrollment_status,
      c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name,
      g.primary_phone AS guardian_phone, COALESCE(f.fee_balance, 0) AS fee_balance
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN terms t ON t.id = se.term_id AND t.school_id = se.school_id
     JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN student_guardians g ON g.student_id = s.id AND g.school_id = s.school_id AND g.guardian_number = 1
     LEFT JOIN (
       SELECT school_id, student_id, SUM(amount_due - amount_paid) AS fee_balance
       FROM fee_accounts
       GROUP BY school_id, student_id
     ) f ON f.student_id = s.id AND f.school_id = s.school_id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
       AND se.enrollment_status = 'active' AND s.status = ?
       AND CONCAT(s.first_name, ' ', s.last_name, ' ', COALESCE(s.student_id, ''), ' ', s.admission_no, ' ', c.name) LIKE ?${classScope.clause}
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name
     LIMIT 100`,
    [schoolId, session.academicYearId, session.termId, studentStatus, search, ...classScope.params],
  )
  const [[unassignedCount]] = Array.isArray(teacherClassIds)
    ? [[{ total: 0 }]]
    : await pool.query(
      `SELECT COUNT(*) AS total
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ?
       WHERE s.school_id = ? AND s.status = 'active' AND se.id IS NULL`,
      [session.academicYearId, session.termId, schoolId],
    )
  res.json({
    students: rows,
    unassigned_count: Number(unassignedCount?.total || 0),
    setup_required: false,
    session: sessionPayload(session),
  })
}

export async function getStudent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = Number(req.params.id || 0)
  if (!studentId) throw new HttpError(400, "Student id is required")

  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const session = await getActiveAcademicSession(schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const [rows] = await pool.query(
    `SELECT s.*, c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name,
      se.id AS current_enrollment_id, se.enrollment_type, se.enrollment_status,
      fp.fee_category, fp.payment_plan, fp.discount_percent, fp.discount_reason
     FROM students s
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status <> 'superseded'
     LEFT JOIN terms t ON t.id = se.term_id AND t.school_id = se.school_id
     LEFT JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
     LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.school_id = s.school_id
     WHERE s.school_id = ? AND s.id = ?${classScope.clause}
     LIMIT 1`,
    [session.academicYearId, session.termId, schoolId, studentId, ...classScope.params],
  )
  const student = rows[0]
  if (!student) throw new HttpError(404, "Student was not found")

  const [guardians] = await pool.query(
    `SELECT guardian_number, full_name, relationship, primary_phone, secondary_phone, email, national_id
     FROM student_guardians
     WHERE school_id = ? AND student_id = ?
     ORDER BY guardian_number`,
    [schoolId, studentId],
  )
  const [enrollments] = await pool.query(
    `SELECT se.*, c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name
     FROM student_enrollments se
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
     JOIN terms t ON t.id = se.term_id AND t.school_id = se.school_id
     WHERE se.school_id = ? AND se.student_id = ?
     ORDER BY ay.start_date DESC, t.term_number DESC`,
    [schoolId, studentId],
  )
  const [examReports] = await pool.query(
    `SELECT rc.id, rc.id AS report_card_id, rc.exam_session_id, rc.status AS report_status,
      rc.generated_at, rc.term_result_id,
      sch.name AS school_name, sch.city AS school_city, sch.country AS school_country,
      es.name AS exam_session_name, es.exam_type, es.status AS exam_session_status,
      es.start_date AS exam_start_date, es.end_date AS exam_end_date,
      ay.name AS academic_year_name, ay.start_date AS academic_year_start_date,
      t.name AS term_name, t.term_number, t.start_date AS term_start_date, t.end_date AS term_end_date,
      c.name AS class_name, tr.total_score, tr.average_score, tr.grade, tr.position, tr.status AS result_status,
      (
        SELECT COUNT(DISTINCT se2.student_id)
        FROM student_enrollments se2
        WHERE se2.school_id = rc.school_id
          AND se2.academic_year_id = rc.academic_year_id
          AND se2.term_id = rc.term_id
          AND se2.class_id = tr.class_id
          AND se2.enrollment_status = 'active'
      ) AS class_total,
      (
        SELECT COUNT(*)
        FROM attendance_records ar
        WHERE ar.school_id = rc.school_id
          AND ar.student_id = rc.student_id
          AND ar.attendance_date BETWEEN t.start_date AND t.end_date
      ) AS attendance_days,
      (
        SELECT COUNT(*)
        FROM attendance_records ar
        WHERE ar.school_id = rc.school_id
          AND ar.student_id = rc.student_id
          AND ar.attendance_date BETWEEN t.start_date AND t.end_date
          AND ar.status IN ('present', 'late')
      ) AS attended_days
     FROM report_cards rc
     JOIN schools sch ON sch.id = rc.school_id
     JOIN academic_years ay ON ay.id = rc.academic_year_id AND ay.school_id = rc.school_id
     JOIN terms t ON t.id = rc.term_id AND t.school_id = rc.school_id
     LEFT JOIN exam_sessions es ON es.id = rc.exam_session_id AND es.school_id = rc.school_id
     LEFT JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
     LEFT JOIN student_enrollments se ON se.id = rc.enrollment_id AND se.school_id = rc.school_id
     LEFT JOIN classes c ON c.id = COALESCE(tr.class_id, se.class_id) AND c.school_id = rc.school_id
     WHERE rc.school_id = ? AND rc.student_id = ?
       AND rc.status <> 'archived'
     ORDER BY ay.start_date DESC, t.term_number DESC, es.start_date DESC, rc.generated_at DESC`,
    [schoolId, studentId],
  )
  const [subjectResults] = await pool.query(
    `SELECT rc.id AS report_card_id, sr.id, sr.score, sr.grade, sr.comment,
      subj.code AS subject_code, subj.name AS subject_name,
      u.full_name AS teacher_name,
      a.name AS assessment_name, a.assessment_type, a.total_marks,
      rb.status AS batch_status, re.score AS raw_score, re.grade AS raw_grade,
      re.status AS entry_status, re.last_saved_at
     FROM report_cards rc
     JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
     JOIN subject_results sr ON sr.term_result_id = tr.id AND sr.school_id = tr.school_id
     JOIN subjects subj ON subj.id = sr.subject_id AND subj.school_id = sr.school_id
     LEFT JOIN users u ON u.id = sr.teacher_id AND u.school_id = sr.school_id
     LEFT JOIN assessments a ON a.id = sr.assessment_id AND a.school_id = sr.school_id
     LEFT JOIN result_batches rb ON rb.id = sr.result_batch_id AND rb.school_id = sr.school_id
     LEFT JOIN result_entries re ON re.school_id = sr.school_id
       AND re.result_batch_id = sr.result_batch_id
       AND re.student_id = rc.student_id
     WHERE rc.school_id = ? AND rc.student_id = ?
       AND rc.status <> 'archived'
       AND (sr.result_batch_id IS NULL OR rb.exam_session_id <=> rc.exam_session_id)
     ORDER BY rc.generated_at DESC, subj.name`,
    [schoolId, studentId],
  )
  const reportsById = new Map(examReports.map((report) => {
    const attendanceDays = Number(report.attendance_days || 0)
    const attendedDays = Number(report.attended_days || 0)
    const averageScore = report.average_score === null ? null : Number(report.average_score)
    return [Number(report.id), {
      ...report,
      average_score: averageScore,
      total_score: report.total_score === null ? null : Number(report.total_score),
      position: report.position === null ? null : Number(report.position),
      class_total: Number(report.class_total || 0),
      attendance_days: attendanceDays,
      attended_days: attendedDays,
      attendance_percent: attendanceDays ? Number(((attendedDays / attendanceDays) * 100).toFixed(1)) : null,
      subjects: [],
    }]
  }))
  for (const row of subjectResults) {
    const report = reportsById.get(Number(row.report_card_id))
    if (!report) continue
    const score = row.score === null ? null : Number(row.score)
    const rawScore = row.raw_score === null ? score : Number(row.raw_score)
    const totalMarks = row.total_marks === null ? null : Number(row.total_marks)
    report.subjects.push({
      ...row,
      score,
      raw_score: rawScore,
      total_marks: totalMarks,
      total_percent: score,
    })
  }
  const results = [...reportsById.values()].map((report) => {
    const failedSubjects = report.subjects.filter((subject) => Number(subject.total_percent || 0) < 50).length
    const subjectCount = report.subjects.length
    const averageScore = report.average_score === null ? null : Number(report.average_score)
    return {
      ...report,
      subject_count: subjectCount,
      passed_subjects: Math.max(subjectCount - failedSubjects, 0),
      failed_subjects: failedSubjects,
      remark: failedSubjects > 0 || (averageScore !== null && averageScore < 50) ? "FAIL" : "PASS",
    }
  })
  const [recurringAssessments] = await pool.query(
    `SELECT air.id, air.score, air.comment, air.status, air.last_saved_at,
      ai.title AS assessment_name, ai.total_marks, ai.instance_date,
      rat.assessment_type, subj.name AS subject_name, c.name AS class_name,
      ay.name AS academic_year_name, t.name AS term_name, teacher.full_name AS teacher_name
     FROM assessment_instance_results air
     JOIN assessment_instances ai ON ai.id = air.assessment_instance_id AND ai.school_id = air.school_id
     LEFT JOIN recurring_assessment_templates rat ON rat.id = ai.template_id AND rat.school_id = ai.school_id
     JOIN subjects subj ON subj.id = ai.subject_id AND subj.school_id = ai.school_id
     JOIN classes c ON c.id = ai.class_id AND c.school_id = ai.school_id
     JOIN academic_years ay ON ay.id = ai.academic_year_id AND ay.school_id = ai.school_id
     JOIN terms t ON t.id = ai.term_id AND t.school_id = ai.school_id
     JOIN users teacher ON teacher.id = ai.teacher_id AND teacher.school_id = ai.school_id
     WHERE air.school_id = ? AND air.student_id = ?
     ORDER BY ai.instance_date DESC, subj.name`,
    [schoolId, studentId],
  )
  const [formalAssessments] = await pool.query(
    `SELECT re.id, re.result_batch_id, re.score, re.grade, re.comment, re.status, re.last_saved_at,
      a.id AS assessment_id, a.name AS assessment_name, a.assessment_type, a.total_marks,
      a.exam_session_id, es.name AS exam_session_name, es.exam_type,
      ay.name AS academic_year_name, t.name AS term_name, c.name AS class_name,
      subj.name AS subject_name, subj.code AS subject_code, teacher.full_name AS teacher_name,
      ett.exam_date, rb.status AS batch_status
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN academic_years ay ON ay.id = rb.academic_year_id AND ay.school_id = rb.school_id
     JOIN terms t ON t.id = rb.term_id AND t.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users teacher ON teacher.id = rb.teacher_id AND teacher.school_id = rb.school_id
     LEFT JOIN exam_sessions es ON es.id = rb.exam_session_id AND es.school_id = rb.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.school_id = rb.school_id
      AND ett.exam_session_id <=> rb.exam_session_id
      AND ett.assessment_id = rb.assessment_id
      AND ett.class_id = rb.class_id
     WHERE re.school_id = ? AND re.student_id = ?
     ORDER BY ay.start_date DESC, t.term_number DESC, COALESCE(ett.exam_date, re.last_saved_at, re.updated_at) DESC, subj.name`,
    [schoolId, studentId],
  )
  const assessmentResults = [
    ...formalAssessments.map((row) => {
      const score = row.score === null ? null : Number(row.score)
      const totalMarks = row.total_marks === null ? null : Number(row.total_marks)
      const percentage = score === null || !totalMarks ? null : Number(((score / totalMarks) * 100).toFixed(1))
      return {
        ...row,
        id: `formal-${row.id}`,
        source_type: "formal_assessment",
        source_label: row.exam_session_id ? "Exam / formal paper" : "Class assessment",
        score,
        total_marks: totalMarks,
        percentage,
        result_date: row.exam_date || row.last_saved_at,
      }
    }),
    ...recurringAssessments.map((row) => {
      const score = row.score === null ? null : Number(row.score)
      const totalMarks = row.total_marks === null ? null : Number(row.total_marks)
      const percentage = score === null || !totalMarks ? null : Number(((score / totalMarks) * 100).toFixed(1))
      return {
        ...row,
        id: `recurring-${row.id}`,
        source_type: "recurring_assessment",
        source_label: "Recurring assessment",
        score,
        total_marks: totalMarks,
        percentage,
        result_date: row.instance_date || row.last_saved_at,
      }
    }),
  ].sort((a, b) => {
    const aTime = Date.parse(a.result_date || a.last_saved_at || "") || 0
    const bTime = Date.parse(b.result_date || b.last_saved_at || "") || 0
    return bTime - aTime || String(a.assessment_name || "").localeCompare(String(b.assessment_name || ""))
  })
  const [attendance] = await pool.query(
    `SELECT attendance_date, status, note
     FROM attendance_records
     WHERE school_id = ? AND student_id = ?
     ORDER BY attendance_date DESC
     LIMIT 20`,
    [schoolId, studentId],
  )
  const [fees] = await pool.query(
    `SELECT term_name, amount_due, amount_paid, status, due_date
     FROM fee_accounts
     WHERE school_id = ? AND student_id = ?
     ORDER BY due_date DESC`,
    [schoolId, studentId],
  )
  res.json({
    student: {
      ...student,
      guardians,
      enrollments,
      results,
      exam_reports: results,
      formal_assessment_results: formalAssessments,
      recurring_assessments: recurringAssessments,
      assessment_results: assessmentResults,
      attendance,
      fees,
    },
  })
}

export async function updateStudent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = Number(req.params.id || 0)
  if (!studentId) throw new HttpError(400, "Student id is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.query(
      "SELECT * FROM students WHERE school_id = ? AND id = ? LIMIT 1 FOR UPDATE",
      [schoolId, studentId],
    )
    if (!existing) throw new HttpError(404, "Student was not found")

    const body = req.body || {}
    const classIdValue = pickBodyValue(body, "class_id", "classId", existing.class_id)
    const classId = classIdValue === null || classIdValue === "" || classIdValue === undefined ? null : Number(classIdValue)
    if (classId !== null && (!Number.isFinite(classId) || classId <= 0)) throw new HttpError(400, "Class is invalid")
    if (classId !== null) {
      const [[classRow]] = await connection.query("SELECT id FROM classes WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, classId])
      if (!classRow) throw new HttpError(400, "Selected class does not belong to this school")
    }

    const studentType = cleanText(pickBodyValue(body, "student_type", "studentType", existing.student_type || "new"))
    if (!STUDENT_TYPES.has(studentType)) throw new HttpError(400, "Student type is invalid")
    const status = cleanText(pickBodyValue(body, "status", "status", existing.status || "active"))
    if (!STUDENT_STATUSES.has(status)) throw new HttpError(400, "Student status is invalid")

    const nextStudent = {
      class_id: classId,
      first_name: cleanRequiredText(pickBodyValue(body, "first_name", "firstName", existing.first_name), "First name"),
      last_name: cleanRequiredText(pickBodyValue(body, "last_name", "lastName", existing.last_name), "Last name"),
      date_of_birth: cleanDate(pickBodyValue(body, "date_of_birth", "dateOfBirth", existing.date_of_birth?.toISOString?.().slice(0, 10) || existing.date_of_birth), "Date of birth"),
      gender: cleanRequiredText(pickBodyValue(body, "gender", "gender", existing.gender), "Gender", 30),
      national_id: cleanOptionalText(pickBodyValue(body, "national_id", "nationalId", existing.national_id), 80),
      profile_photo_url: cleanOptionalText(pickBodyValue(body, "profile_photo_url", "profilePhotoUrl", existing.profile_photo_url), 255),
      stream_section: cleanOptionalText(pickBodyValue(body, "stream_section", "streamSection", existing.stream_section), 80),
      enrollment_date: cleanOptionalDate(pickBodyValue(body, "enrollment_date", "enrollmentDate", existing.enrollment_date?.toISOString?.().slice(0, 10) || existing.enrollment_date), "Enrollment date"),
      student_type: studentType,
      previous_school: cleanOptionalText(pickBodyValue(body, "previous_school", "previousSchool", existing.previous_school), 160),
      status,
    }

    await connection.query(
      `UPDATE students
       SET class_id = ?, first_name = ?, last_name = ?, date_of_birth = ?, gender = ?,
        national_id = ?, profile_photo_url = ?, stream_section = ?, enrollment_date = ?,
        student_type = ?, previous_school = ?, status = ?
       WHERE school_id = ? AND id = ?`,
      [
        nextStudent.class_id,
        nextStudent.first_name,
        nextStudent.last_name,
        nextStudent.date_of_birth,
        nextStudent.gender,
        nextStudent.national_id,
        nextStudent.profile_photo_url,
        nextStudent.stream_section,
        nextStudent.enrollment_date,
        nextStudent.student_type,
        nextStudent.previous_school,
        nextStudent.status,
        schoolId,
        studentId,
      ],
    )

    const session = await getActiveAcademicSession(schoolId, connection)
    if (!session.setupRequired && nextStudent.class_id) {
      const enrollmentStatus = nextStudent.status === "archived" ? "superseded" : nextStudent.status
      await connection.query(
        `UPDATE student_enrollments
         SET class_id = ?, stream_section = ?, enrollment_status = ?
         WHERE school_id = ? AND student_id = ? AND academic_year_id = ? AND term_id = ?`,
        [
          nextStudent.class_id,
          nextStudent.stream_section,
          enrollmentStatus,
          schoolId,
          studentId,
          session.academicYearId,
          session.termId,
        ],
      )
    }

    await connection.commit()
    res.json({ ok: true, student: { id: studentId, ...nextStudent } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createStudent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const student = validateStudentSetupPayload(req.body)
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const [[classRow]] = await connection.query("SELECT id, name FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [student.classId, schoolId])
    if (!classRow) throw new HttpError(400, "Selected class does not belong to this school")

    const studentId = await generateStudentId(connection, schoolId, student.enrollmentDate)
    const [result] = await connection.query(
      `INSERT INTO students (
        school_id, class_id, student_id, admission_no, first_name, last_name, date_of_birth, gender,
        national_id, profile_photo_url, stream_section, enrollment_date, student_type, previous_school, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        schoolId,
        student.classId,
        studentId,
        studentId,
        student.firstName,
        student.lastName,
        student.dateOfBirth,
        student.gender,
        student.nationalId,
        student.profilePhotoUrl,
        student.streamSection,
        student.enrollmentDate,
        student.studentType,
        student.previousSchool,
      ],
    )
    const dbStudentId = Number(result.insertId)

    for (const guardian of [student.guardian1, student.guardian2].filter(Boolean)) {
      await connection.query(
        `INSERT INTO student_guardians (
          school_id, student_id, guardian_number, full_name, relationship,
          primary_phone, secondary_phone, email, national_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          dbStudentId,
          guardian.guardianNumber,
          guardian.fullName,
          guardian.relationship,
          guardian.primaryPhone,
          guardian.secondaryPhone,
          guardian.email,
          guardian.nationalId,
        ],
      )
    }

    await connection.query(
      `INSERT INTO student_fee_profiles (
        school_id, student_id, fee_category, payment_plan, discount_percent, discount_reason
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        dbStudentId,
        student.feeProfile.feeCategory,
        student.feeProfile.paymentPlan,
        student.feeProfile.discountPercent,
        student.feeProfile.discountReason,
      ],
    )

    const activeSession = await requireActiveAcademicSession(schoolId, connection)
    await connection.query(
      `INSERT INTO student_enrollments (
        school_id, student_id, academic_year_id, term_id, class_id, stream_section,
        enrollment_type, enrollment_status, start_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      ON DUPLICATE KEY UPDATE class_id = VALUES(class_id),
        stream_section = VALUES(stream_section),
        enrollment_status = 'active',
        start_date = VALUES(start_date)`,
      [
        schoolId,
        dbStudentId,
        activeSession.academicYearId,
        activeSession.termId,
        student.classId,
        student.streamSection,
        student.studentType,
        student.enrollmentDate || activeSession.term.start_date,
      ],
    )

    await connection.commit()
    res.status(201).json({
      student: {
        id: dbStudentId,
        student_id: studentId,
        admission_no: studentId,
        first_name: student.firstName,
        last_name: student.lastName,
        class_id: student.classId,
        class_name: classRow.name,
        stream_section: student.streamSection,
        enrollment_date: student.enrollmentDate,
        profile_photo_url: student.profilePhotoUrl,
        guardian1: student.guardian1,
        fee_profile: student.feeProfile,
      },
    })
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "Generated student ID already exists. Please try again.")
    throw error
  } finally {
    connection.release()
  }
}

export async function uploadStudentPhoto(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fileName = cleanText(req.body.file_name || req.body.fileName || "student-photo")
  const fileType = cleanText(req.body.file_type || req.body.fileType)
  const dataUrl = cleanText(req.body.data_url || req.body.dataUrl)

  if (!STUDENT_PHOTO_TYPES.has(fileType)) {
    throw new HttpError(400, "Only PNG and JPEG student photos are supported")
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new HttpError(400, "Student photo upload payload is invalid")
  if (match[1] !== fileType) throw new HttpError(400, "Student photo type does not match the upload payload")

  const buffer = Buffer.from(match[2], "base64")
  if (!buffer.length) throw new HttpError(400, "Student photo file is empty")
  if (buffer.length > 4 * 1024 * 1024) throw new HttpError(400, "Student photo must be 4MB or smaller")

  const extension = STUDENT_PHOTO_EXTENSIONS[fileType] || "img"
  const safeName = fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "student-photo"
  const baseName = path.basename(safeName, path.extname(safeName)).slice(0, 60) || "student-photo"
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}.${extension}`
  const folder = path.resolve(process.cwd(), "uploads", "student-photos", String(schoolId))
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, storedName), buffer)

  res.status(201).json({
    profile_photo_url: `/uploads/student-photos/${schoolId}/${storedName}`,
    file_name: fileName,
    content_type: fileType,
    size: buffer.length,
  })
}

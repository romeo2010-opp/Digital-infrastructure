import { pool } from "../config/db.js"
import { assertTeacherCanUseClass, getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

const DEFAULT_FIRST_PERIOD_END_MINUTES = (8 * 60) + 10

function timezoneParts(timezone = "Africa/Blantyre") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())
  return parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value
    return acc
  }, {})
}

function todayInSchoolTimezone() {
  const parts = timezoneParts(process.env.SCHOOL_TIMEZONE || "Africa/Blantyre")
  return `${parts.year}-${parts.month}-${parts.day}`
}

function schoolClockMinutes() {
  const parts = timezoneParts(process.env.SCHOOL_TIMEZONE || "Africa/Blantyre")
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
}

function clockMinutes(value) {
  if (!value) return null
  const [hours, minutes] = String(value).split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return (hours * 60) + minutes
}

async function firstTeachingPeriodEndMinutes(schoolId) {
  const [[slot]] = await pool.query(
    `SELECT s.end_time
     FROM bell_schedule_slots s
     JOIN bell_schedule_templates b ON b.id = s.template_id
     WHERE b.school_id = ? AND b.active = 1
       AND s.teaching_allowed = 1
       AND s.slot_type IN ('TEACHING_PERIOD', 'CUSTOM', 'STUDY')
     ORDER BY b.is_default DESC, s.sort_order ASC, s.start_time ASC
     LIMIT 1`,
    [schoolId],
  )
  return clockMinutes(slot?.end_time) ?? DEFAULT_FIRST_PERIOD_END_MINUTES
}

async function shouldAutoMarkPresent(schoolId, date) {
  if (String(date).slice(0, 10) !== todayInSchoolTimezone()) return false
  const firstPeriodEnd = await firstTeachingPeriodEndMinutes(schoolId)
  return schoolClockMinutes() >= firstPeriodEnd
}

async function ensurePresentAfterFirstPeriod(req, schoolId, session, date, classScope) {
  if (!(await shouldAutoMarkPresent(schoolId, date))) return 0
  const [result] = await pool.query(
    `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, note, marked_by)
     SELECT se.school_id, se.class_id, se.student_id, ?, 'present', NULL, ?
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     LEFT JOIN attendance_records ar ON ar.student_id = se.student_id AND ar.school_id = se.school_id AND ar.attendance_date = ?
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
       AND se.enrollment_status = 'active' AND s.status = 'active'${classScope.clause}
       AND ar.id IS NULL`,
    [date, req.user.id, date, schoolId, session.academicYearId, session.termId, ...classScope.params],
  )
  return result.affectedRows || 0
}

export async function listAttendance(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ attendance: [], date: req.query.date || new Date().toISOString().slice(0, 10), session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
  const date = req.query.date || new Date().toISOString().slice(0, 10)
  const autoMarkedPresent = await ensurePresentAfterFirstPeriod(req, schoolId, session, date, classScope)
  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, c.id AS class_id, c.name AS class_name,
      COALESCE(ar.status, 'unmarked') AS status, ar.note, ar.attendance_date
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.school_id = s.school_id AND ar.attendance_date = ?
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
      AND se.enrollment_status = 'active' AND s.status = 'active'${classScope.clause}
     ORDER BY c.name, ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [date, schoolId, session.academicYearId, session.termId, ...classScope.params],
  )
  res.json({ attendance: rows, date, auto_marked_present: autoMarkedPresent, session: sessionPayload(session), setup_required: false })
}

export async function markAttendance(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { attendance_date, class_id, records = [] } = req.body
  await assertTeacherCanUseClass(req, schoolId, class_id)

  const values = records.map((record) => [
    schoolId,
    class_id,
    record.student_id,
    attendance_date,
    record.status,
    record.note || null,
    req.user.id,
  ])

  if (values.length) {
    await pool.query(
      `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, note, marked_by)
       VALUES ?
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), marked_by = VALUES(marked_by)`,
      [values],
    )
  }

  res.json({ saved: values.length })
}

import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

export function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
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

function normalizeWithdrawalType(value) {
  const type = cleanText(value || "temporary").toLowerCase()
  if (!["temporary", "permanent"].includes(type)) throw new HttpError(400, "Withdrawal type is invalid")
  return type
}

function compareDate(left, right) {
  return String(dateOnly(left)).localeCompare(String(dateOnly(right)))
}

export function computedWithdrawalStatus(row, asOfDate = todayIso()) {
  const status = cleanText(row?.status || "active")
  if (status === "cancelled") return "cancelled"
  if (status === "expired") return "expired"
  const type = cleanText(row?.withdrawal_type || row?.withdrawalType || "temporary")
  const endDate = dateOnly(row?.end_date || row?.endDate)
  if (type === "temporary" && endDate && compareDate(endDate, asOfDate) < 0) return "expired"
  return "active"
}

export function isWithdrawalEffectiveOnDate(row, targetDate) {
  const date = dateOnly(targetDate)
  if (!date || cleanText(row?.status) === "cancelled") return false
  const startDate = dateOnly(row?.start_date || row?.startDate)
  const endDate = dateOnly(row?.end_date || row?.endDate)
  const type = cleanText(row?.withdrawal_type || row?.withdrawalType || "temporary")
  if (!startDate || compareDate(startDate, date) > 0) return false
  return type === "permanent" || !endDate || compareDate(date, endDate) <= 0
}

export function serializeWithdrawal(row, asOfDate = todayIso()) {
  if (!row) return null
  const startDate = dateOnly(row.start_date)
  const endDate = dateOnly(row.end_date)
  const type = cleanText(row.withdrawal_type || "temporary")
  return {
    ...row,
    id: Number(row.id),
    school_id: Number(row.school_id),
    student_id: Number(row.student_id),
    class_id: row.class_id ? Number(row.class_id) : null,
    created_by: row.created_by ? Number(row.created_by) : null,
    cancelled_by: row.cancelled_by ? Number(row.cancelled_by) : null,
    withdrawal_type: type,
    student_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    start_date: startDate,
    end_date: endDate || null,
    computed_status: computedWithdrawalStatus(row, asOfDate),
    status_label: computedWithdrawalStatus(row, asOfDate).replace(/_/g, " "),
    duration_label: type === "permanent" ? "Permanent" : [startDate, endDate].filter(Boolean).join(" to "),
  }
}

function normalizePayload(body = {}) {
  const reason = cleanText(body.reason).slice(0, 255)
  if (!reason) throw new HttpError(400, "Withdrawal reason is required")
  const withdrawalType = normalizeWithdrawalType(body.withdrawal_type || body.withdrawalType)
  const startDate = cleanDate(body.start_date || body.startDate, "Withdrawal start date")
  const endDate = withdrawalType === "permanent"
    ? null
    : cleanOptionalDate(body.end_date || body.endDate, "Withdrawal end date")
  if (withdrawalType === "temporary" && !endDate) throw new HttpError(400, "Temporary withdrawals require an end date")
  if (endDate && compareDate(endDate, startDate) < 0) throw new HttpError(400, "Withdrawal end date cannot be before the start date")
  const notes = cleanText(body.notes).slice(0, 5000) || null
  return { reason, withdrawalType, startDate, endDate, notes }
}

async function assertStudentInSchool(connection, schoolId, studentId) {
  const [[student]] = await connection.query(
    `SELECT s.id, s.school_id, s.status, s.class_id, s.first_name, s.last_name,
      COALESCE(s.student_id, s.admission_no) AS student_code
     FROM students s
     WHERE s.school_id = ? AND s.id = ?
     LIMIT 1`,
    [schoolId, studentId],
  )
  if (!student) throw new HttpError(404, "Student was not found")
  return student
}

async function assertNoOverlap(connection, schoolId, studentId, startDate, endDate) {
  const effectiveEnd = endDate || "9999-12-31"
  const [rows] = await connection.query(
    `SELECT id, start_date, end_date, withdrawal_type
     FROM student_withdrawals
     WHERE school_id = ? AND student_id = ? AND status <> 'cancelled'
       AND start_date <= ?
       AND COALESCE(end_date, '9999-12-31') >= ?
     LIMIT 1`,
    [schoolId, studentId, effectiveEnd, startDate],
  )
  if (rows.length) throw new HttpError(409, "This student already has a withdrawal in that date range")
}

async function refreshPermanentStudentStatus(connection, schoolId, studentId) {
  const today = todayIso()
  const [[effective]] = await connection.query(
    `SELECT id
     FROM student_withdrawals
     WHERE school_id = ? AND student_id = ? AND status <> 'cancelled'
       AND start_date <= ?
       AND (withdrawal_type = 'permanent' OR COALESCE(end_date, '9999-12-31') >= ?)
     LIMIT 1`,
    [schoolId, studentId, today, today],
  )
  if (effective) return
  await connection.query(
    "UPDATE students SET status = 'active' WHERE school_id = ? AND id = ? AND status = 'withdrawn'",
    [schoolId, studentId],
  )
  await connection.query(
    `UPDATE student_enrollments
     SET enrollment_status = 'active'
     WHERE school_id = ? AND student_id = ? AND enrollment_status = 'withdrawn'`,
    [schoolId, studentId],
  )
}

export async function createStudentWithdrawalRecord({ schoolId, studentId, payload, userId, connection = pool }) {
  const normalized = normalizePayload(payload)
  await assertStudentInSchool(connection, schoolId, studentId)
  await assertNoOverlap(connection, schoolId, studentId, normalized.startDate, normalized.endDate)
  const [result] = await connection.query(
    `INSERT INTO student_withdrawals (
      school_id, student_id, reason, notes, withdrawal_type, start_date, end_date, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      schoolId,
      studentId,
      normalized.reason,
      normalized.notes,
      normalized.withdrawalType,
      normalized.startDate,
      normalized.endDate,
      userId,
    ],
  )

  if (normalized.withdrawalType === "permanent" && compareDate(normalized.startDate, todayIso()) <= 0) {
    await connection.query("UPDATE students SET status = 'withdrawn' WHERE school_id = ? AND id = ?", [schoolId, studentId])
    await connection.query(
      `UPDATE student_enrollments
       SET enrollment_status = 'withdrawn', end_date = COALESCE(end_date, ?)
       WHERE school_id = ? AND student_id = ? AND enrollment_status = 'active'`,
      [normalized.startDate, schoolId, studentId],
    )
  }

  return getWithdrawalById(connection, schoolId, Number(result.insertId))
}

export async function getWithdrawalById(connection, schoolId, withdrawalId) {
  const [[row]] = await connection.query(
    `SELECT sw.*, s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.admission_no, c.name AS class_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      creator.full_name AS created_by_name, canceller.full_name AS cancelled_by_name
     FROM student_withdrawals sw
     JOIN students s ON s.id = sw.student_id AND s.school_id = sw.school_id
     LEFT JOIN (
       SELECT school_id, student_id, MAX(id) AS enrollment_id
       FROM student_enrollments
       GROUP BY school_id, student_id
     ) latest ON latest.school_id = sw.school_id AND latest.student_id = sw.student_id
     LEFT JOIN student_enrollments se ON se.id = latest.enrollment_id AND se.school_id = latest.school_id
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = sw.school_id
     LEFT JOIN users creator ON creator.id = sw.created_by AND creator.school_id <=> sw.school_id
     LEFT JOIN users canceller ON canceller.id = sw.cancelled_by AND canceller.school_id <=> sw.school_id
     WHERE sw.school_id = ? AND sw.id = ?
     LIMIT 1`,
    [schoolId, withdrawalId],
  )
  if (!row) throw new HttpError(404, "Withdrawal was not found")
  return serializeWithdrawal(row)
}

export async function cancelStudentWithdrawalRecord({ schoolId, studentId, withdrawalId, userId, reason, connection = pool }) {
  const cancelReason = cleanText(reason).slice(0, 255) || null
  const [[withdrawal]] = await connection.query(
    "SELECT * FROM student_withdrawals WHERE school_id = ? AND student_id = ? AND id = ? LIMIT 1 FOR UPDATE",
    [schoolId, studentId, withdrawalId],
  )
  if (!withdrawal) throw new HttpError(404, "Withdrawal was not found")
  if (withdrawal.status === "cancelled") throw new HttpError(409, "Withdrawal is already cancelled")
  await connection.query(
    `UPDATE result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN exam_timetable_entries ett ON ett.school_id = a.school_id
       AND ett.assessment_id = a.id
       AND ett.class_id = a.class_id
       AND ett.subject_id = a.subject_id
       AND ett.status <> 'cancelled'
     SET re.status = 'draft', re.comment = NULL
     WHERE re.school_id = ? AND re.student_id = ? AND re.status = 'absent' AND re.score IS NULL
       AND ett.exam_date >= ?
       AND ett.exam_date <= COALESCE(?, '9999-12-31')`,
    [schoolId, studentId, dateOnly(withdrawal.start_date), dateOnly(withdrawal.end_date)],
  )
  await connection.query(
    `UPDATE student_withdrawals
     SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?
     WHERE school_id = ? AND student_id = ? AND id = ?`,
    [userId, cancelReason, schoolId, studentId, withdrawalId],
  )
  if (withdrawal.withdrawal_type === "permanent") {
    await refreshPermanentStudentStatus(connection, schoolId, studentId)
  }
  return getWithdrawalById(connection, schoolId, withdrawalId)
}

export async function getStudentWithdrawalHistory(connection, schoolId, studentId) {
  await assertStudentInSchool(connection, schoolId, studentId)
  const [rows] = await connection.query(
    `SELECT sw.*, s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.admission_no, c.name AS class_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      creator.full_name AS created_by_name, canceller.full_name AS cancelled_by_name
     FROM student_withdrawals sw
     JOIN students s ON s.id = sw.student_id AND s.school_id = sw.school_id
     LEFT JOIN (
       SELECT school_id, student_id, MAX(id) AS enrollment_id
       FROM student_enrollments
       GROUP BY school_id, student_id
     ) latest ON latest.school_id = sw.school_id AND latest.student_id = sw.student_id
     LEFT JOIN student_enrollments se ON se.id = latest.enrollment_id AND se.school_id = latest.school_id
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = sw.school_id
     LEFT JOIN users creator ON creator.id = sw.created_by AND creator.school_id <=> sw.school_id
     LEFT JOIN users canceller ON canceller.id = sw.cancelled_by AND canceller.school_id <=> sw.school_id
     WHERE sw.school_id = ? AND sw.student_id = ?
     ORDER BY sw.start_date DESC, sw.created_at DESC`,
    [schoolId, studentId],
  )
  return rows.map((row) => serializeWithdrawal(row))
}

export async function listStudentWithdrawals(connection, schoolId, filters = {}) {
  const where = ["sw.school_id = ?"]
  const params = [schoolId]
  const status = cleanText(filters.status).toLowerCase()
  const type = cleanText(filters.type || filters.withdrawal_type).toLowerCase()
  const classId = Number(filters.class_id || filters.classId || 0)
  const search = cleanText(filters.search || filters.q)
  const dateFrom = cleanOptionalDate(filters.date_from || filters.dateFrom, "Date from")
  const dateTo = cleanOptionalDate(filters.date_to || filters.dateTo, "Date to")

  if (status === "active") where.push("sw.status = 'active' AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= CURDATE())")
  else if (status === "expired") where.push("(sw.status = 'expired' OR (sw.status = 'active' AND sw.withdrawal_type = 'temporary' AND sw.end_date < CURDATE()))")
  else if (status === "cancelled") where.push("sw.status = 'cancelled'")

  if (["temporary", "permanent"].includes(type)) {
    where.push("sw.withdrawal_type = ?")
    params.push(type)
  }
  if (classId) {
    where.push("COALESCE(se.class_id, s.class_id) = ?")
    params.push(classId)
  }
  if (search) {
    where.push("CONCAT(s.first_name, ' ', s.last_name, ' ', COALESCE(s.student_id, ''), ' ', s.admission_no) LIKE ?")
    params.push(`%${search}%`)
  }
  if (dateFrom && dateTo) {
    where.push("sw.start_date <= ? AND COALESCE(sw.end_date, '9999-12-31') >= ?")
    params.push(dateTo, dateFrom)
  } else if (dateFrom) {
    where.push("COALESCE(sw.end_date, '9999-12-31') >= ?")
    params.push(dateFrom)
  } else if (dateTo) {
    where.push("sw.start_date <= ?")
    params.push(dateTo)
  }

  const [rows] = await connection.query(
    `SELECT sw.*, s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.admission_no, c.id AS class_id, c.name AS class_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      creator.full_name AS created_by_name, canceller.full_name AS cancelled_by_name
     FROM student_withdrawals sw
     JOIN students s ON s.id = sw.student_id AND s.school_id = sw.school_id
     LEFT JOIN (
       SELECT school_id, student_id, MAX(id) AS enrollment_id
       FROM student_enrollments
       GROUP BY school_id, student_id
     ) latest ON latest.school_id = sw.school_id AND latest.student_id = sw.student_id
     LEFT JOIN student_enrollments se ON se.id = latest.enrollment_id AND se.school_id = latest.school_id
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = sw.school_id
     LEFT JOIN users creator ON creator.id = sw.created_by AND creator.school_id <=> sw.school_id
     LEFT JOIN users canceller ON canceller.id = sw.cancelled_by AND canceller.school_id <=> sw.school_id
     WHERE ${where.join(" AND ")}
     ORDER BY sw.start_date DESC, sw.created_at DESC
     LIMIT 300`,
    params,
  )
  return rows.map((row) => serializeWithdrawal(row))
}

export async function getWithdrawalForStudentOnDate(connection, schoolId, studentId, targetDate) {
  const date = cleanDate(targetDate, "Date")
  const [rows] = await connection.query(
    `SELECT sw.*
     FROM student_withdrawals sw
     WHERE sw.school_id = ? AND sw.student_id = ? AND sw.status <> 'cancelled'
       AND sw.start_date <= ?
       AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ?)
     ORDER BY sw.start_date DESC, sw.id DESC
     LIMIT 1`,
    [schoolId, studentId, date, date],
  )
  return rows[0] ? serializeWithdrawal(rows[0], date) : null
}

export async function getWithdrawalsForStudentsOnDate(connection, schoolId, studentIds = [], targetDate) {
  const date = dateOnly(targetDate)
  const ids = [...new Set((studentIds || []).map((id) => Number(id || 0)).filter(Boolean))]
  if (!date || !ids.length) return new Map()
  const [rows] = await connection.query(
    `SELECT sw.*
     FROM student_withdrawals sw
     WHERE sw.school_id = ? AND sw.student_id IN (${ids.map(() => "?").join(", ")})
       AND sw.status <> 'cancelled'
       AND sw.start_date <= ?
       AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ?)
     ORDER BY sw.student_id, sw.start_date DESC, sw.id DESC`,
    [schoolId, ...ids, date, date],
  )
  const map = new Map()
  for (const row of rows) {
    const key = Number(row.student_id)
    if (!map.has(key)) map.set(key, serializeWithdrawal(row, date))
  }
  return map
}

export function absentCommentForWithdrawal(withdrawal) {
  if (!withdrawal) return "Absent"
  return `Absent - ${withdrawal.reason || "withdrawn"}`
}

import { pool } from "../config/db.js"
import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import {
  assertTeacherCanTeachSubject,
  getScopedSchoolId,
  getTeacherClassSubjectPairs,
  isTeacher,
} from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { studentCodeSortSql } from "../utils/studentSort.js"
import { getReportPdfTemplateForSchool, normalizeReportPdfTemplateId } from "../services/reportSettingsService.js"

const FORMAL_ASSESSMENT_TYPES = new Set(["mid_term", "end_of_term_exam", "mock_exam", "final_exam"])
const EXAM_TYPES = new Set(["end_of_term", "mid_term", "mock", "final", "custom"])
const EXAM_STATUSES = new Set(["draft", "scheduled", "in_progress", "marking", "results_submitted", "results_approved", "locked", "archived"])
const PAPER_STATUSES = new Set(["draft", "open", "ready_for_review", "approved", "scheduled", "marking", "results_submitted", "results_approved", "returned", "locked", "archived"])
const NORMAL_TIMETABLE_SESSION_STATUSES = new Set(["marking", "results_submitted", "results_approved", "locked", "archived"])

function cleanText(value) {
  return String(value || "").trim()
}

function normalizeDate(value, label) {
  const text = cleanText(value)
  if (!text) throw new HttpError(400, `${label} is required`)
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} must be a valid date`)
  return text.slice(0, 10)
}

async function restoreNormalScheduleAfterExamSession(connection, schoolId, sessionId) {
  const [timetableResult] = await connection.query(
    "UPDATE exam_timetable_entries SET status = 'written' WHERE school_id = ? AND exam_session_id = ? AND status = 'scheduled'",
    [schoolId, sessionId],
  )
  await connection.query(
    "UPDATE exam_sessions SET operating_mode = 'NORMAL_LESSONS_CONTINUE' WHERE school_id = ? AND id = ?",
    [schoolId, sessionId],
  )
  return { exam_timetable_entries_written: Number(timetableResult.affectedRows || 0) }
}

function teacherPairsClause(pairs, classColumn = "a.class_id", subjectColumn = "a.subject_id") {
  if (!Array.isArray(pairs)) return { clause: "", params: [] }
  if (!pairs.length) return { clause: " AND 1 = 0", params: [] }
  return {
    clause: ` AND (${pairs.map(() => `(${classColumn} = ? AND ${subjectColumn} = ?)`).join(" OR ")})`,
    params: pairs.flatMap((pair) => [pair.classId, pair.subjectId]),
  }
}

function examTypeToAssessmentType(examType) {
  if (examType === "mid_term") return "mid_term"
  if (examType === "mock") return "mock_exam"
  if (examType === "final") return "final_exam"
  return "end_of_term_exam"
}

function paperNameFromPattern(pattern, values) {
  const template = cleanText(pattern) || "{class} {subject} Exam"
  return template
    .replaceAll("{class}", values.className)
    .replaceAll("{subject}", values.subjectName)
    .replaceAll("{session}", values.sessionName)
    .replaceAll("{type}", values.assessmentTypeLabel)
    .trim()
}

function assessmentTypeLabel(value) {
  return String(value || "exam").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function getExamSessionOrThrow(connection, schoolId, sessionId) {
  const [[session]] = await connection.query(
    `SELECT es.*, ay.name AS academic_year_name, t.name AS term_name, t.status AS term_status
     FROM exam_sessions es
     JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.school_id = es.school_id
     JOIN terms t ON t.id = es.term_id AND t.school_id = es.school_id
     WHERE es.school_id = ? AND es.id = ?
     LIMIT 1`,
    [schoolId, sessionId],
  )
  if (!session) throw new HttpError(404, "Exam session was not found")
  return session
}

async function assertTeacherCanViewExamSession(req, schoolId, sessionId) {
  if (!isTeacher(req)) return
  const [rows] = await pool.query(
    `SELECT id
     FROM exam_sessions
     WHERE school_id = ? AND id = ? AND status <> 'archived'
     LIMIT 1`,
    [schoolId, sessionId],
  )
  if (!rows.length) throw new HttpError(404, "Exam session was not found")
}

async function assertYearAndTerm(connection, schoolId, academicYearId, termId) {
  const [[row]] = await connection.query(
    `SELECT ay.id AS academic_year_id, ay.name AS academic_year_name, t.id AS term_id, t.name AS term_name, t.status AS term_status
     FROM academic_years ay
     JOIN terms t ON t.academic_year_id = ay.id AND t.school_id = ay.school_id
     WHERE ay.school_id = ? AND ay.id = ? AND t.id = ?
     LIMIT 1`,
    [schoolId, academicYearId, termId],
  )
  if (!row) throw new HttpError(400, "Academic year and term must belong to this school")
  return row
}

async function getAssignedSubjectTeacher(connection, schoolId, classId, subjectId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT a.teacher_id, u.full_name AS teacher_name
     FROM teacher_class_subject_assignments a
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.class_id = ? AND a.subject_id = ?
       AND a.role = 'subject_teacher' AND a.is_active = 1
       AND (a.academic_year_id = ? OR a.academic_year_id IS NULL)
       AND (a.term_id = ? OR a.term_id IS NULL)
       AND u.role = 'teacher' AND u.is_active = 1
     ORDER BY (a.academic_year_id = ?) DESC, (a.term_id = ?) DESC, a.updated_at DESC, a.id DESC
     LIMIT 1`,
    [schoolId, classId, subjectId, academicYearId, termId, academicYearId, termId],
  )
  return rows[0] || null
}

async function assertExamAdministrator(connection, schoolId, teacherId) {
  if (!teacherId) return null
  const [[teacher]] = await connection.query(
    `SELECT id, full_name
     FROM users
     WHERE id = ? AND school_id = ? AND role IN ('teacher', 'headteacher') AND is_active = 1
     LIMIT 1`,
    [teacherId, schoolId],
  )
  if (!teacher) throw new HttpError(400, "Exam administrator must be an active teacher from this school")
  return teacher
}

async function getAssessmentForSession(connection, schoolId, sessionId, assessmentId) {
  const [[assessment]] = await connection.query(
    `SELECT a.*, c.name AS class_name, subj.name AS subject_name, es.status AS exam_session_status
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     WHERE a.school_id = ? AND a.exam_session_id = ? AND a.id = ?
     LIMIT 1`,
    [schoolId, sessionId, assessmentId],
  )
  if (!assessment) throw new HttpError(404, "Exam paper was not found in this session")
  return assessment
}

async function buildIssues(connection, schoolId, sessionId) {
  const [draftPapers] = await connection.query(
    `SELECT a.id, a.name, a.status, c.name AS class_name, subj.name AS subject_name
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     WHERE a.school_id = ? AND a.exam_session_id = ?
       AND a.status IN ('draft', 'open', 'ready_for_review', 'returned')
     ORDER BY c.name, subj.name, a.name`,
    [schoolId, sessionId],
  )
  const [pendingBatches] = await connection.query(
    `SELECT rb.id, rb.status, a.name AS assessment_name, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     WHERE rb.school_id = ? AND rb.exam_session_id = ?
       AND rb.status IN ('draft', 'submitted', 'returned')
     ORDER BY rb.updated_at DESC`,
    [schoolId, sessionId],
  )
  const [missingMarks] = await connection.query(
    `SELECT a.id, a.name, c.name AS class_name, subj.name AS subject_name,
       COUNT(DISTINCT se.student_id) AS expected_students,
       COUNT(DISTINCT CASE WHEN re.score IS NOT NULL THEN re.student_id END) AS marked_students
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN student_enrollments se ON se.school_id = a.school_id
       AND se.academic_year_id = a.academic_year_id
       AND se.term_id = a.term_id
       AND se.class_id = a.class_id
       AND (a.exam_session_id IS NULL OR COALESCE(se.stream_section, '') = COALESCE(se.stream_section, ''))
       AND se.enrollment_status = 'active'
     LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     LEFT JOIN result_batches rb ON rb.school_id = a.school_id AND rb.assessment_id = a.id
     LEFT JOIN result_entries re ON re.school_id = rb.school_id AND re.result_batch_id = rb.id AND re.student_id = se.student_id
     WHERE a.school_id = ? AND a.exam_session_id = ?
     GROUP BY a.id, a.name, c.name, subj.name
     HAVING expected_students > marked_students
     ORDER BY c.name, subj.name, a.name`,
    [schoolId, sessionId],
  )
  return {
    draft_papers: draftPapers,
    pending_batches: pendingBatches,
    missing_marks: missingMarks.map((row) => ({
      ...row,
      missing_marks: Math.max(0, Number(row.expected_students || 0) - Number(row.marked_students || 0)),
    })),
  }
}

export async function listExamSessions(req, res) {
  const schoolId = getScopedSchoolId(req)
  const activeSession = await getActiveAcademicSession(schoolId)
  if (activeSession.setupRequired && !req.query.academic_year_id && !req.query.term_id) {
    return res.json({ sessions: [], session: sessionPayload(activeSession), setup_required: true })
  }

  const includeArchived = String(req.query.include_archived || "") === "true"
  const academicYearId = Number(req.query.academic_year_id || activeSession.academicYearId || 0)
  const termId = Number(req.query.term_id || activeSession.termId || 0)
  const where = ["es.school_id = ?"]
  const params = [schoolId]
  if (academicYearId) {
    where.push("es.academic_year_id = ?")
    params.push(academicYearId)
  }
  if (termId) {
    where.push("es.term_id = ?")
    params.push(termId)
  }
  if (!includeArchived) where.push("es.status <> 'archived'")

  const teacherPairs = await getTeacherClassSubjectPairs(req, schoolId)
  const teacherScope = teacherPairsClause(teacherPairs, "a.class_id", "a.subject_id")

  const [rows] = await pool.query(
    `SELECT es.*, ay.name AS academic_year_name, t.name AS term_name,
      COUNT(DISTINCT a.id) AS paper_count,
      COUNT(DISTINCT CASE WHEN ${Array.isArray(teacherPairs) ? teacherScope.clause.replace(/^ AND /, "") : "1 = 1"} THEN a.id END) AS teacher_visible_papers,
      COUNT(DISTINCT rb.id) AS result_batch_count,
      SUM(CASE WHEN a.status IN ('draft', 'open') THEN 1 ELSE 0 END) AS draft_papers,
      SUM(CASE WHEN a.status = 'ready_for_review' THEN 1 ELSE 0 END) AS ready_for_review_papers,
      SUM(CASE WHEN a.status IN ('approved', 'scheduled') THEN 1 ELSE 0 END) AS approved_papers,
      SUM(CASE WHEN a.status = 'marking' THEN 1 ELSE 0 END) AS marking_papers,
      SUM(CASE WHEN rb.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_batches,
      SUM(CASE WHEN rb.status IN ('approved', 'locked') THEN 1 ELSE 0 END) AS approved_batches,
      ROUND((SUM(CASE WHEN a.status IN ('results_approved', 'locked') THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT a.id), 0)) * 100, 0) AS completion_percent
     FROM exam_sessions es
     JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.school_id = es.school_id
     JOIN terms t ON t.id = es.term_id AND t.school_id = es.school_id
     LEFT JOIN assessments a ON a.exam_session_id = es.id AND a.school_id = es.school_id
     LEFT JOIN result_batches rb ON rb.exam_session_id = es.id AND rb.school_id = es.school_id
     WHERE ${where.join(" AND ")}
     GROUP BY es.id, ay.name, t.name
     ORDER BY es.start_date DESC, es.id DESC`,
    [...params, ...teacherScope.params],
  )

  res.json({
    sessions: rows.map((row) => ({
      ...row,
      completion_percent: row.completion_percent === null ? (Number(row.paper_count || 0) ? 0 : 100) : Number(row.completion_percent),
    })),
    session: sessionPayload(activeSession),
    setup_required: false,
  })
}

export async function createExamSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const name = cleanText(req.body.name)
  const academicYearId = Number(req.body.academic_year_id || 0)
  const termId = Number(req.body.term_id || 0)
  const examType = EXAM_TYPES.has(cleanText(req.body.exam_type)) ? cleanText(req.body.exam_type) : "end_of_term"
  const startDate = normalizeDate(req.body.start_date, "Start date")
  const endDate = normalizeDate(req.body.end_date, "End date")
  const notes = cleanText(req.body.notes) || null
  if (!name) throw new HttpError(400, "Name is required")
  if (!academicYearId) throw new HttpError(400, "Academic year is required")
  if (!termId) throw new HttpError(400, "Term is required")
  if (new Date(endDate) < new Date(startDate)) throw new HttpError(400, "End date cannot be before start date")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await assertYearAndTerm(connection, schoolId, academicYearId, termId)
    if (examType === "end_of_term" && !req.body.allow_additional) {
      const [[existing]] = await connection.query(
        `SELECT id, name FROM exam_sessions
         WHERE school_id = ? AND academic_year_id = ? AND term_id = ?
           AND exam_type = 'end_of_term' AND status <> 'archived'
         LIMIT 1`,
        [schoolId, academicYearId, termId],
      )
      if (existing) throw new HttpError(409, `An end-of-term exam session already exists for this term: ${existing.name}`)
    }
    const [result] = await connection.query(
      `INSERT INTO exam_sessions (
        school_id, academic_year_id, term_id, name, exam_type, status, start_date, end_date, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [schoolId, academicYearId, termId, name, examType, startDate, endDate, notes, req.user.id],
    )
    await connection.commit()
    res.status(201).json({ exam_session: { id: Number(result.insertId), school_id: schoolId, academic_year_id: academicYearId, term_id: termId, name, exam_type: examType, status: "draft", start_date: startDate, end_date: endDate, notes } })
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "An exam session with this name already exists for the selected term")
    throw error
  } finally {
    connection.release()
  }
}

export async function getExamSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || 0)
  if (!sessionId) throw new HttpError(400, "Exam session id is required")
  await assertTeacherCanViewExamSession(req, schoolId, sessionId)

  const teacherPairs = await getTeacherClassSubjectPairs(req, schoolId)
  const paperScope = teacherPairsClause(teacherPairs, "a.class_id", "a.subject_id")
  const batchScope = isTeacher(req) ? " AND rb.teacher_id = ?" : ""
  const batchParams = isTeacher(req) ? [req.user.id] : []

  const connection = pool
  const examSession = await getExamSessionOrThrow(connection, schoolId, sessionId)
  const [papers] = await connection.query(
    `SELECT a.*, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name,
      admin.full_name AS administering_teacher_name,
      COUNT(DISTINCT rb.id) AS result_batch_count,
      COUNT(DISTINCT CASE WHEN rb.status IN ('approved', 'locked') THEN rb.id END) AS approved_batch_count
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN users admin ON admin.id = a.administering_teacher_id AND admin.school_id = a.school_id
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     WHERE a.school_id = ? AND a.exam_session_id = ?${paperScope.clause}
     GROUP BY a.id, c.name, subj.name, u.full_name, admin.full_name
     ORDER BY c.name, subj.name, a.name`,
    [schoolId, sessionId, ...paperScope.params],
  )
  const [timetable] = await connection.query(
    `SELECT ete.*, a.name AS assessment_name, c.name AS class_name, subj.name AS subject_name,
      u.full_name AS invigilator_name
     FROM exam_timetable_entries ete
     JOIN assessments a ON a.id = ete.assessment_id AND a.school_id = ete.school_id
     JOIN classes c ON c.id = ete.class_id AND c.school_id = ete.school_id
     JOIN subjects subj ON subj.id = ete.subject_id AND subj.school_id = ete.school_id
     LEFT JOIN users u ON u.id = ete.invigilator_teacher_id AND u.school_id = ete.school_id
     WHERE ete.school_id = ? AND ete.exam_session_id = ?${paperScope.clause}
     ORDER BY ete.exam_date, ete.start_time`,
    [schoolId, sessionId, ...paperScope.params],
  )
  const [batches] = await connection.query(
    `SELECT rb.*, a.name AS assessment_name, a.total_marks, c.name AS class_name, subj.name AS subject_name,
      u.full_name AS teacher_name,
      COUNT(re.id) AS saved_marks,
      SUM(CASE WHEN re.score IS NULL THEN 1 ELSE 0 END) AS missing_marks
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id
     WHERE rb.school_id = ? AND rb.exam_session_id = ?${batchScope}
     GROUP BY rb.id, a.name, a.total_marks, c.name, subj.name, u.full_name
     ORDER BY rb.updated_at DESC`,
    [schoolId, sessionId, ...batchParams],
  )
  const [reportCards] = isTeacher(req)
    ? [[]]
    : await connection.query(
      `SELECT rc.*, s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
        c.name AS class_name, tr.average_score, tr.grade
       FROM report_cards rc
       JOIN students s ON s.id = rc.student_id AND s.school_id = rc.school_id
       LEFT JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
       LEFT JOIN classes c ON c.id = tr.class_id AND c.school_id = tr.school_id
       WHERE rc.school_id = ? AND rc.exam_session_id = ?
       ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
      [schoolId, sessionId],
    )
  const issues = isTeacher(req) ? { draft_papers: [], pending_batches: [], missing_marks: [] } : await buildIssues(connection, schoolId, sessionId)

  res.json({ exam_session: examSession, papers, timetable, batches, report_cards: reportCards, issues })
}

export async function updateExamSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || 0)
  const name = cleanText(req.body.name)
  const startDate = normalizeDate(req.body.start_date, "Start date")
  const endDate = normalizeDate(req.body.end_date, "End date")
  const notes = cleanText(req.body.notes) || null
  if (!sessionId) throw new HttpError(400, "Exam session id is required")
  if (!name) throw new HttpError(400, "Name is required")
  if (new Date(endDate) < new Date(startDate)) throw new HttpError(400, "End date cannot be before start date")

  const [[current]] = await pool.query("SELECT status FROM exam_sessions WHERE id = ? AND school_id = ? LIMIT 1", [sessionId, schoolId])
  if (!current) throw new HttpError(404, "Exam session was not found")
  if (["locked", "archived"].includes(current.status)) throw new HttpError(409, "Locked or archived exam sessions are read-only")
  await pool.query(
    "UPDATE exam_sessions SET name = ?, start_date = ?, end_date = ?, notes = ? WHERE id = ? AND school_id = ?",
    [name, startDate, endDate, notes, sessionId, schoolId],
  )
  res.json({ ok: true })
}

export async function transitionExamSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || 0)
  const status = cleanText(req.body.status)
  if (!sessionId) throw new HttpError(400, "Exam session id is required")
  if (!EXAM_STATUSES.has(status)) throw new HttpError(400, "Exam session status is invalid")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT status FROM exam_sessions WHERE id = ? AND school_id = ? LIMIT 1", [sessionId, schoolId])
    if (!current) throw new HttpError(404, "Exam session was not found")
    if (current.status === "archived") throw new HttpError(409, "Archived exam sessions are read-only")
    if (current.status === "locked" && status !== "archived") throw new HttpError(409, "Locked exam sessions can only be archived")
    await connection.query("UPDATE exam_sessions SET status = ? WHERE id = ? AND school_id = ?", [status, sessionId, schoolId])
    const scheduleReset = NORMAL_TIMETABLE_SESSION_STATUSES.has(status)
      ? await restoreNormalScheduleAfterExamSession(connection, schoolId, sessionId)
      : null
    if (status === "locked") {
      await connection.query("UPDATE assessments SET status = 'locked' WHERE school_id = ? AND exam_session_id = ? AND status <> 'archived'", [schoolId, sessionId])
      await connection.query("UPDATE result_batches SET status = 'locked' WHERE school_id = ? AND exam_session_id = ? AND status = 'approved'", [schoolId, sessionId])
      await connection.query(
        `UPDATE result_entries re
         JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
         SET re.status = 'locked'
         WHERE re.school_id = ? AND rb.exam_session_id = ? AND re.status = 'approved'`,
        [schoolId, sessionId],
      )
    }
    await connection.commit()
    res.json({ ok: true, schedule_reset: scheduleReset })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createExamPaper(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || req.body.exam_session_id || 0)
  if (!sessionId) throw new HttpError(400, "Exam session is required")
  const name = cleanText(req.body.name || req.body.title)
  const classId = Number(req.body.class_id || 0)
  const subjectId = Number(req.body.subject_id || 0)
  const administeringTeacherId = req.body.administering_teacher_id || req.body.administeringTeacherId
    ? Number(req.body.administering_teacher_id || req.body.administeringTeacherId)
    : null
  const totalMarks = Number(req.body.total_marks || 0)
  const durationMinutes = Number(req.body.duration_minutes || 0)
  const instructions = cleanText(req.body.instructions) || null
  if (!name) throw new HttpError(400, "Paper name is required")
  if (!classId) throw new HttpError(400, "Class is required")
  if (!subjectId) throw new HttpError(400, "Subject is required")
  if (!totalMarks || totalMarks <= 0) throw new HttpError(400, "Total marks are required")
  if (!durationMinutes || durationMinutes <= 0) throw new HttpError(400, "Duration is required")
  await assertTeacherCanTeachSubject(req, schoolId, classId, subjectId, null)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const examSession = await getExamSessionOrThrow(connection, schoolId, sessionId)
    if (["locked", "archived"].includes(examSession.status)) throw new HttpError(409, "Locked or archived exam sessions are read-only")
    const [[classRow]] = await connection.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [classId, schoolId])
    const [[subjectRow]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [subjectId, schoolId])
    if (!classRow) throw new HttpError(400, "Class does not belong to this school")
    if (!subjectRow) throw new HttpError(400, "Subject does not belong to this school")
    const assignedTeacher = await getAssignedSubjectTeacher(connection, schoolId, classId, subjectId, examSession.academic_year_id, examSession.term_id)
    const teacherId = isTeacher(req) ? req.user.id : Number(assignedTeacher?.teacher_id || 0)
    if (!teacherId) throw new HttpError(400, "Assign an active subject teacher to this class and subject before creating the paper")
    await assertExamAdministrator(connection, schoolId, administeringTeacherId)
    const assessmentType = FORMAL_ASSESSMENT_TYPES.has(cleanText(req.body.assessment_type))
      ? cleanText(req.body.assessment_type)
      : examTypeToAssessmentType(examSession.exam_type)
    const [result] = await connection.query(
      `INSERT INTO assessments (
        school_id, exam_session_id, class_id, subject_id, academic_year_id, term_id, teacher_id, administering_teacher_id,
        name, assessment_type, term_name, total_marks, duration_minutes, instructions, expected_difficulty, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Medium', 'draft', ?)`,
      [
        schoolId,
        sessionId,
        classId,
        subjectId,
        examSession.academic_year_id,
        examSession.term_id,
        teacherId,
        administeringTeacherId,
        name,
        assessmentType,
        examSession.term_name,
        totalMarks,
        durationMinutes,
        instructions,
        req.user.id,
      ],
    )
    await connection.commit()
    res.status(201).json({
      paper: {
        id: Number(result.insertId),
        exam_session_id: sessionId,
        name,
        assessment_type: assessmentType,
        teacher_id: teacherId,
        teacher_name: assignedTeacher?.teacher_name || null,
        administering_teacher_id: administeringTeacherId,
        status: "draft",
      },
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createBulkExamPapers(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || req.body.exam_session_id || 0)
  if (!sessionId) throw new HttpError(400, "Exam session is required")
  const totalMarks = Number(req.body.total_marks || 0)
  const durationMinutes = Number(req.body.duration_minutes || 0)
  const instructions = cleanText(req.body.instructions) || null
  const namePattern = cleanText(req.body.name_pattern)
  const administeringTeacherId = req.body.administering_teacher_id || req.body.administeringTeacherId
    ? Number(req.body.administering_teacher_id || req.body.administeringTeacherId)
    : null
  const classIds = Array.isArray(req.body.class_ids) ? req.body.class_ids.map(Number).filter(Boolean) : []
  const subjectIds = Array.isArray(req.body.subject_ids) ? req.body.subject_ids.map(Number).filter(Boolean) : []
  if (!totalMarks || totalMarks <= 0) throw new HttpError(400, "Total marks are required")
  if (!durationMinutes || durationMinutes <= 0) throw new HttpError(400, "Duration is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const examSession = await getExamSessionOrThrow(connection, schoolId, sessionId)
    if (["locked", "archived"].includes(examSession.status)) throw new HttpError(409, "Locked or archived exam sessions are read-only")
    const assessmentType = FORMAL_ASSESSMENT_TYPES.has(cleanText(req.body.assessment_type))
      ? cleanText(req.body.assessment_type)
      : examTypeToAssessmentType(examSession.exam_type)
    await assertExamAdministrator(connection, schoolId, administeringTeacherId)

    const classFilter = classIds.length ? ` AND a.class_id IN (${classIds.map(() => "?").join(", ")})` : ""
    const subjectFilter = subjectIds.length ? ` AND a.subject_id IN (${subjectIds.map(() => "?").join(", ")})` : ""
    const [assignmentRows] = await connection.query(
      `SELECT a.class_id, a.subject_id, a.teacher_id, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name
       FROM teacher_class_subject_assignments a
       JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
       JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
       WHERE a.school_id = ?
         AND a.role = 'subject_teacher'
         AND a.subject_id IS NOT NULL
         AND a.is_active = 1
         AND (a.academic_year_id = ? OR a.academic_year_id IS NULL)
         AND (a.term_id = ? OR a.term_id IS NULL)
         AND u.role = 'teacher' AND u.is_active = 1${classFilter}${subjectFilter}
       ORDER BY c.name, subj.name, (a.academic_year_id = ?) DESC, (a.term_id = ?) DESC, a.updated_at DESC, a.id DESC`,
      [schoolId, examSession.academic_year_id, examSession.term_id, ...classIds, ...subjectIds, examSession.academic_year_id, examSession.term_id],
    )

    const uniqueAssignments = []
    const seenAssignments = new Set()
    for (const row of assignmentRows) {
      const key = `${row.class_id}:${row.subject_id}`
      if (seenAssignments.has(key)) continue
      seenAssignments.add(key)
      uniqueAssignments.push(row)
    }

    if (!uniqueAssignments.length) {
      throw new HttpError(400, "No active subject teacher assignments were found for this exam session")
    }

    const [existingRows] = await connection.query(
      `SELECT class_id, subject_id, name
       FROM assessments
       WHERE school_id = ? AND exam_session_id = ? AND status <> 'archived'`,
      [schoolId, sessionId],
    )
    const existing = new Map(existingRows.map((row) => [`${row.class_id}:${row.subject_id}`, row]))
    const created = []
    const skipped = []

    for (const row of uniqueAssignments) {
      const key = `${row.class_id}:${row.subject_id}`
      if (existing.has(key)) {
        skipped.push({
          class_id: Number(row.class_id),
          subject_id: Number(row.subject_id),
          class_name: row.class_name,
          subject_name: row.subject_name,
          reason: "paper_exists",
        })
        continue
      }

      const paperName = paperNameFromPattern(namePattern, {
        className: row.class_name,
        subjectName: row.subject_name,
        sessionName: examSession.name,
        assessmentTypeLabel: assessmentTypeLabel(assessmentType),
      })
      const [result] = await connection.query(
        `INSERT INTO assessments (
          school_id, exam_session_id, class_id, subject_id, academic_year_id, term_id, teacher_id, administering_teacher_id,
          name, assessment_type, term_name, total_marks, duration_minutes, instructions, expected_difficulty, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Medium', 'draft', ?)`,
        [
          schoolId,
          sessionId,
          row.class_id,
          row.subject_id,
          examSession.academic_year_id,
          examSession.term_id,
          row.teacher_id,
          administeringTeacherId,
          paperName,
          assessmentType,
          examSession.term_name,
          totalMarks,
          durationMinutes,
          instructions,
          req.user.id,
        ],
      )
      created.push({
        id: Number(result.insertId),
        class_id: Number(row.class_id),
        subject_id: Number(row.subject_id),
        teacher_id: Number(row.teacher_id),
        class_name: row.class_name,
        subject_name: row.subject_name,
        teacher_name: row.teacher_name,
        name: paperName,
      })
    }

    await connection.commit()
    res.status(201).json({
      created,
      skipped,
      created_count: created.length,
      skipped_count: skipped.length,
      message: `${created.length} exam paper${created.length === 1 ? "" : "s"} created.`,
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function transitionExamPaper(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || 0)
  const paperId = Number(req.params.paperId || 0)
  const status = cleanText(req.body.status)
  if (!sessionId || !paperId) throw new HttpError(400, "Exam session and paper are required")
  if (!PAPER_STATUSES.has(status)) throw new HttpError(400, "Paper status is invalid")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const paper = await getAssessmentForSession(connection, schoolId, sessionId, paperId)
    if (["locked", "archived"].includes(paper.exam_session_status) || ["locked", "archived"].includes(paper.status)) {
      throw new HttpError(409, "Locked or archived papers are read-only")
    }
    await assertTeacherCanTeachSubject(req, schoolId, paper.class_id, paper.subject_id, paper.term_id)
    if (isTeacher(req)) {
      if (status !== "ready_for_review") throw new HttpError(403, "Teachers can only submit papers for review")
      if (!["draft", "open", "returned"].includes(paper.status)) throw new HttpError(409, "Only draft or returned papers can be submitted for review")
    }
    if (!isTeacher(req) && status === "returned") {
      await connection.query("UPDATE assessments SET status = 'returned' WHERE id = ? AND school_id = ?", [paperId, schoolId])
    } else {
      await connection.query("UPDATE assessments SET status = ? WHERE id = ? AND school_id = ?", [status, paperId, schoolId])
    }
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createTimetableEntry(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || req.body.exam_session_id || 0)
  const assessmentId = Number(req.body.assessment_id || 0)
  const examDate = normalizeDate(req.body.exam_date, "Exam date")
  const startTime = cleanText(req.body.start_time)
  const endTime = cleanText(req.body.end_time)
  const room = cleanText(req.body.room) || null
  const invigilatorTeacherId = req.body.invigilator_teacher_id ? Number(req.body.invigilator_teacher_id) : null
  if (!sessionId || !assessmentId) throw new HttpError(400, "Exam session and paper are required")
  if (!startTime || !endTime) throw new HttpError(400, "Start and end time are required")
  if (startTime >= endTime) throw new HttpError(400, "Start time must be before end time")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const examSession = await getExamSessionOrThrow(connection, schoolId, sessionId)
    if (new Date(examDate) < new Date(examSession.start_date) || new Date(examDate) > new Date(examSession.end_date)) {
      throw new HttpError(400, "Exam date must fall within the exam session dates")
    }
    const paper = await getAssessmentForSession(connection, schoolId, sessionId, assessmentId)
    if (!["approved", "scheduled", "marking"].includes(paper.status)) throw new HttpError(400, "Only approved papers can be scheduled")
    const [conflicts] = await connection.query(
      `SELECT ete.*, c.name AS class_name, u.full_name AS invigilator_name
       FROM exam_timetable_entries ete
       JOIN classes c ON c.id = ete.class_id AND c.school_id = ete.school_id
       LEFT JOIN users u ON u.id = ete.invigilator_teacher_id AND u.school_id = ete.school_id
       WHERE ete.school_id = ? AND ete.exam_date = ?
         AND ete.start_time < ? AND ete.end_time > ?
         AND (ete.class_id = ? OR (? IS NOT NULL AND ete.invigilator_teacher_id = ?))`,
      [schoolId, examDate, endTime, startTime, paper.class_id, invigilatorTeacherId, invigilatorTeacherId],
    )
    const [result] = await connection.query(
      `INSERT INTO exam_timetable_entries (
        school_id, exam_session_id, assessment_id, academic_year_id, term_id, class_id, stream_section,
        subject_id, exam_date, start_time, end_time, room, invigilator_teacher_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        sessionId,
        assessmentId,
        paper.academic_year_id,
        paper.term_id,
        paper.class_id,
        null,
        paper.subject_id,
        examDate,
        startTime,
        endTime,
        room,
        invigilatorTeacherId,
      ],
    )
    await connection.query("UPDATE assessments SET status = 'scheduled' WHERE id = ? AND school_id = ? AND status = 'approved'", [assessmentId, schoolId])
    await connection.commit()
    res.status(201).json({
      timetable_entry: { id: Number(result.insertId) },
      warnings: conflicts.map((row) => row.invigilator_teacher_id === invigilatorTeacherId
        ? `Invigilator ${row.invigilator_name || ""} already has an exam in this time range.`
        : `${row.class_name} already has an exam in this time range.`),
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteTimetableEntry(req, res) {
  const schoolId = getScopedSchoolId(req)
  const entryId = Number(req.params.entryId || 0)
  if (!entryId) throw new HttpError(400, "Timetable entry id is required")
  const [result] = await pool.query("DELETE FROM exam_timetable_entries WHERE id = ? AND school_id = ?", [entryId, schoolId])
  if (!result.affectedRows) throw new HttpError(404, "Timetable entry was not found")
  res.json({ ok: true })
}

function dateLabel(value) {
  return value?.toISOString?.().slice(0, 10) || String(value || "-").slice(0, 10)
}

function scoreLabel(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "-"
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`
}

function percentLabel(value) {
  return value === null || value === undefined || value === "" ? "N/A" : scoreLabel(value, "%")
}

function valueLabel(value) {
  return String(value || "-").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function reportFileName(report) {
  const student = [report.first_name, report.last_name].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return `report-card-${student || report.id}.pdf`
}

function resolveLocalUploadPath(publicUrl) {
  const raw = String(publicUrl || "").trim()
  if (!raw.startsWith("/uploads/")) return null
  const uploadsRoot = path.resolve(process.cwd(), "uploads")
  const filePath = path.resolve(process.cwd(), raw.replace(/^\/+/, ""))
  if (filePath !== uploadsRoot && !filePath.startsWith(`${uploadsRoot}${path.sep}`)) return null
  return filePath
}

function studentInitials(report) {
  return [report.first_name, report.last_name]
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => String(part)[0])
    .join("")
    .toUpperCase() || "ST"
}

async function loadReportCardPayload(schoolId, cardId) {
  const [[card]] = await pool.query(
    `SELECT rc.*, s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.admission_no, s.gender, s.date_of_birth, s.profile_photo_url,
      sch.name AS school_name, sch.code AS school_code, sch.school_prefix,
      sch.city AS school_city, sch.country AS school_country,
      c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name,
      t.term_number, t.start_date AS term_start_date, t.end_date AS term_end_date,
      es.name AS exam_session_name, es.exam_type, es.start_date AS exam_start_date, es.end_date AS exam_end_date,
      tr.total_score, tr.average_score, tr.grade, tr.position,
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
     JOIN students s ON s.id = rc.student_id AND s.school_id = rc.school_id
     JOIN academic_years ay ON ay.id = rc.academic_year_id AND ay.school_id = rc.school_id
     JOIN terms t ON t.id = rc.term_id AND t.school_id = rc.school_id
     LEFT JOIN exam_sessions es ON es.id = rc.exam_session_id AND es.school_id = rc.school_id
     LEFT JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
     LEFT JOIN classes c ON c.id = tr.class_id AND c.school_id = tr.school_id
     WHERE rc.school_id = ? AND rc.id = ?
     LIMIT 1`,
    [schoolId, cardId],
  )
  if (!card) throw new HttpError(404, "Report card was not found")
  const [subjects] = await pool.query(
    `SELECT sr.*, subj.code AS subject_code, subj.name AS subject_name,
      u.full_name AS teacher_name, a.name AS assessment_name, a.assessment_type, a.total_marks,
      rb.status AS batch_status, re.score AS raw_score, re.grade AS raw_grade, re.status AS entry_status
     FROM subject_results sr
     JOIN subjects subj ON subj.id = sr.subject_id AND subj.school_id = sr.school_id
     LEFT JOIN users u ON u.id = sr.teacher_id AND u.school_id = sr.school_id
     LEFT JOIN assessments a ON a.id = sr.assessment_id AND a.school_id = sr.school_id
     LEFT JOIN result_batches rb ON rb.id = sr.result_batch_id AND rb.school_id = sr.school_id
     LEFT JOIN result_entries re ON re.school_id = sr.school_id
       AND re.result_batch_id = sr.result_batch_id
       AND re.student_id = ?
     WHERE sr.school_id = ? AND sr.term_result_id = ?
       AND (sr.result_batch_id IS NULL OR rb.exam_session_id <=> ?)
     ORDER BY subj.name`,
    [card.student_id, schoolId, card.term_result_id, card.exam_session_id],
  )
  const attendanceDays = Number(card.attendance_days || 0)
  const attendedDays = Number(card.attended_days || 0)
  const normalizedSubjects = subjects.map((subject) => ({
    ...subject,
    score: subject.score === null ? null : Number(subject.score),
    raw_score: subject.raw_score === null ? subject.score === null ? null : Number(subject.score) : Number(subject.raw_score),
    total_marks: subject.total_marks === null ? null : Number(subject.total_marks),
    total_percent: subject.score === null ? null : Number(subject.score),
  }))
  const [formalAssessmentRows] = await pool.query(
    `SELECT re.id, re.score, re.grade, re.comment, re.status, re.last_saved_at, re.updated_at,
      rb.id AS result_batch_id, rb.exam_session_id, rb.academic_year_id, rb.term_id,
      a.id AS assessment_id, a.name AS assessment_name, a.assessment_type, a.total_marks,
      es.name AS exam_session_name, es.exam_type,
      subj.code AS subject_code, subj.name AS subject_name,
      teacher.full_name AS teacher_name, ett.exam_date
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     LEFT JOIN users teacher ON teacher.id = rb.teacher_id AND teacher.school_id = rb.school_id
     LEFT JOIN exam_sessions es ON es.id = rb.exam_session_id AND es.school_id = rb.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.school_id = rb.school_id
       AND ett.exam_session_id <=> rb.exam_session_id
       AND ett.assessment_id = rb.assessment_id
       AND ett.class_id = rb.class_id
       AND ett.subject_id = rb.subject_id
     WHERE re.school_id = ? AND re.student_id = ?
       AND rb.academic_year_id = ? AND rb.term_id = ?
     ORDER BY COALESCE(ett.exam_date, re.last_saved_at, re.updated_at) ASC, subj.name`,
    [schoolId, card.student_id, card.academic_year_id, card.term_id],
  )
  const [recurringAssessmentRows] = await pool.query(
    `SELECT air.id, air.score, air.comment, air.status, air.last_saved_at, air.updated_at,
      ai.title AS assessment_name, ai.total_marks, ai.instance_date,
      rat.assessment_type, subj.code AS subject_code, subj.name AS subject_name,
      teacher.full_name AS teacher_name
     FROM assessment_instance_results air
     JOIN assessment_instances ai ON ai.id = air.assessment_instance_id AND ai.school_id = air.school_id
     LEFT JOIN recurring_assessment_templates rat ON rat.id = ai.template_id AND rat.school_id = ai.school_id
     JOIN subjects subj ON subj.id = ai.subject_id AND subj.school_id = ai.school_id
     LEFT JOIN users teacher ON teacher.id = ai.teacher_id AND teacher.school_id = ai.school_id
     WHERE air.school_id = ? AND air.student_id = ?
       AND ai.academic_year_id = ? AND ai.term_id = ?
     ORDER BY ai.instance_date ASC, subj.name`,
    [schoolId, card.student_id, card.academic_year_id, card.term_id],
  )
  const normalizeAssessmentRow = (row, sourceType) => {
    const score = row.score === null ? null : Number(row.score)
    const totalMarks = row.total_marks === null ? null : Number(row.total_marks)
    const percentage = score === null || !totalMarks ? null : Number(((score / totalMarks) * 100).toFixed(1))
    return {
      ...row,
      source_type: sourceType,
      score,
      raw_score: score,
      total_marks: totalMarks,
      total_percent: percentage,
      result_date: row.exam_date || row.instance_date || row.last_saved_at || row.updated_at,
    }
  }
  const assessmentItems = [
    ...formalAssessmentRows.map((row) => normalizeAssessmentRow(row, "formal_assessment")),
    ...recurringAssessmentRows.map((row) => normalizeAssessmentRow(row, "recurring_assessment")),
  ]
  const failedSubjects = normalizedSubjects.filter((subject) => Number(subject.total_percent || 0) < 50).length
  const averageScore = card.average_score === null ? null : Number(card.average_score)
  return {
    ...card,
    average_score: averageScore,
    total_score: card.total_score === null ? null : Number(card.total_score),
    position: card.position === null ? null : Number(card.position),
    class_total: Number(card.class_total || 0),
    attended_days: attendedDays,
    attendance_days: attendanceDays,
    attendance_percent: attendanceDays ? Number(((attendedDays / attendanceDays) * 100).toFixed(1)) : null,
    subject_count: normalizedSubjects.length,
    passed_subjects: Math.max(normalizedSubjects.length - failedSubjects, 0),
    failed_subjects: failedSubjects,
    remark: failedSubjects > 0 || (averageScore !== null && averageScore < 50) ? "FAIL" : "PASS",
    subjects: normalizedSubjects,
    assessment_items: assessmentItems,
  }
}

async function assertReportCardVisibleToUser(report, user) {
  if (user?.role !== "student") return
  const studentId = Number(user.studentId || user.id || 0)
  if (!studentId || Number(report.student_id) !== studentId) {
    throw new HttpError(404, "Report card was not found")
  }
}

function drawField(doc, label, value, x, y, width = 220) {
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#4b5563").text(`${label}:`, x, y, { width: 86 })
  doc.font("Helvetica").fontSize(9.5).fillColor("#111827").text(String(value || "-"), x + 88, y, { width: width - 88 })
}

function drawStudentPhoto(doc, report, x, y, size) {
  const localPath = resolveLocalUploadPath(report.profile_photo_url)
  if (localPath && fs.existsSync(localPath)) {
    try {
      doc.image(localPath, x, y, { fit: [size, size], align: "center", valign: "center" })
      doc.rect(x, y, size, size).lineWidth(0.8).strokeColor("#cbd5e1").stroke()
      return
    } catch {
      // Fall through to the initials placeholder if PDFKit cannot read the image.
    }
  }

  doc.rect(x, y, size, size).fillAndStroke("#f3f4f6", "#cbd5e1")
  doc.font("Helvetica-Bold").fontSize(17).fillColor("#475569")
    .text(studentInitials(report), x, y + (size / 2) - 9, { width: size, align: "center" })
}

const REPORT_COLORS = Object.freeze({
  navy: "#052a63",
  yellow: "#f4c542",
  cream: "#fff2cc",
  red: "#e60000",
  black: "#111111",
  muted: "#3f3f46",
})

const REPORT_FONT_REGULAR = "/usr/share/fonts/truetype/msttcorefonts/Comic_Sans_MS.ttf"
const REPORT_FONT_BOLD = "/usr/share/fonts/truetype/msttcorefonts/Comic_Sans_MS_Bold.ttf"
const REPORT_SANS_FONT_REGULAR = "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf"
const REPORT_SANS_FONT_BOLD = "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf"
const RIA_REFERENCE_HEADER_PATH = path.resolve(process.cwd(), "src/assets/report-templates/ria-reference-header-000.jpg")
const RIA_REFERENCE_HEADER_RATIO = 472 / 1675
const REPORT_COLUMNS = Object.freeze([112, 50, 48, 260, 70])
const REPORT_GRADING_KEY = Object.freeze([
  ["Outstanding", "90 - 100", "A*"],
  ["High", "80 - 89", "B"],
  ["Good", "70 - 79", "C"],
  ["Aspiring", "60 - 69", "D"],
  ["Basic", "50 - 59", "E"],
  ["Unclassified", "40 - 49", "F"],
  ["Below Standard", "0 - 39", "U"],
])

function registerReportFonts(doc) {
  try {
    if (fs.existsSync(REPORT_FONT_REGULAR) && fs.existsSync(REPORT_FONT_BOLD)) {
      doc.registerFont("ReportBody", REPORT_FONT_REGULAR)
      doc.registerFont("ReportBold", REPORT_FONT_BOLD)
      return { regular: "ReportBody", bold: "ReportBold" }
    }
  } catch {
    // Built-in PDF fonts are the safe fallback if the server font is unavailable.
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" }
}

function registerReportSansFonts(doc) {
  try {
    if (fs.existsSync(REPORT_SANS_FONT_REGULAR) && fs.existsSync(REPORT_SANS_FONT_BOLD)) {
      doc.registerFont("ReportSans", REPORT_SANS_FONT_REGULAR)
      doc.registerFont("ReportSansBold", REPORT_SANS_FONT_BOLD)
      return { regular: "ReportSans", bold: "ReportSansBold" }
    }
  } catch {
    // Built-in PDF fonts are the safe fallback if the server font is unavailable.
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" }
}

function reportText(value, fallback = "-") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text || fallback
}

function reportStudentName(report) {
  const reversedName = [report.last_name, report.first_name].filter(Boolean).join(" ")
  return reportText(reversedName || report.student_code || report.admission_no).toUpperCase()
}

function reportGradeFromPercentage(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  if (numeric >= 90) return "A*"
  if (numeric >= 80) return "B"
  if (numeric >= 70) return "C"
  if (numeric >= 60) return "D"
  if (numeric >= 50) return "E"
  if (numeric >= 40) return "F"
  return "U"
}

function normalizeReportGrade(row) {
  const percentage = Number(row.total_percent ?? row.percentage)
  if (Number.isFinite(percentage)) return reportGradeFromPercentage(percentage)
  const explicitGrade = reportText(row.grade || row.raw_grade, "")
  if (explicitGrade) return explicitGrade
  return "-"
}

function isWeakReportResult(row) {
  const grade = normalizeReportGrade(row).toUpperCase()
  const percentage = Number(row.total_percent ?? row.percentage)
  return grade === "U" || (Number.isFinite(percentage) && percentage < 50)
}

function reportTeacherNames(report) {
  const names = [
    ...(report.assessment_items || []).map((item) => item.teacher_name),
    ...(report.subjects || []).map((subject) => subject.teacher_name),
  ]
  return [...new Set(names.map((name) => reportText(name, "")).filter(Boolean))]
}

function drawReportCrest(doc, report, fonts, x, y, size) {
  const prefix = reportText(report.school_prefix || report.school_code || report.school_name, "SL").slice(0, 3).toUpperCase()
  doc.save()
  doc.moveTo(x + size / 2, y)
    .lineTo(x + size - 7, y + 14)
    .lineTo(x + size - 13, y + size - 12)
    .lineTo(x + size / 2, y + size)
    .lineTo(x + 13, y + size - 12)
    .lineTo(x + 7, y + 14)
    .closePath()
    .fillAndStroke(REPORT_COLORS.navy, REPORT_COLORS.black)
  doc.circle(x + size / 2, y + size / 2, size * 0.29).fill(REPORT_COLORS.yellow)
  doc.font(fonts.bold).fontSize(13).fillColor(REPORT_COLORS.navy)
    .text(prefix, x, y + size / 2 - 8, { width: size, align: "center" })
  doc.font(fonts.bold).fontSize(6.6).fillColor(REPORT_COLORS.navy)
    .text(reportText(report.school_name, "School").toUpperCase(), x - 20, y + size + 4, { width: size + 40, align: "center" })
  doc.restore()
}

function schoolReportContactLines(report) {
  const schoolName = `${report.school_name || ""} ${report.school_code || ""} ${report.school_prefix || ""}`
  if (/reign|ria/i.test(schoolName)) {
    return [
      ["P", "Chileka-10 Miles P.O Box 3004, Blantyre"],
      ["D", "Directors office: 0998 723 023"],
      ["A", "Administrator: 0881 507 135"],
      ["F", "Accounts: 0989 074 506"],
      ["E", "reignacademymw21@gmail.com"],
    ]
  }
  return [
    ["P", [report.school_city, report.school_country].filter(Boolean).join(", ") || reportText(report.school_name, "School")],
    ["D", reportText(report.school_name, "School")],
  ]
}

function drawContactLine(doc, fonts, label, value, x, y, width) {
  doc.circle(x + 4, y + 5, 4).fill(REPORT_COLORS.yellow)
  doc.font(fonts.bold).fontSize(5.5).fillColor(REPORT_COLORS.navy)
    .text(label, x + 1, y + 2, { width: 6, align: "center" })
  doc.font(fonts.regular).fontSize(7.6).fillColor(REPORT_COLORS.black)
  const height = Math.max(11, doc.heightOfString(value, { width }))
  doc.text(value, x + 15, y, { width })
  return y + height + 1
}

function drawReportLetterhead(doc, report, fonts) {
  const pageWidth = doc.page.width
  const margin = 36
  doc.rect(margin, 26, 450, 8).fill(REPORT_COLORS.navy)
  doc.rect(margin, 43, 485, 7).fill(REPORT_COLORS.yellow)
  doc.polygon([503, 26], [576, 26], [552, 34], [503, 34]).fill(REPORT_COLORS.navy)
  doc.polygon([532, 43], [576, 43], [552, 50], [532, 50]).fill(REPORT_COLORS.yellow)

  drawReportCrest(doc, report, fonts, 58, 58, 64)

  let contactY = 59
  for (const [label, value] of schoolReportContactLines(report)) {
    contactY = drawContactLine(doc, fonts, label, value, 360, contactY, 190)
  }

  doc.font(fonts.bold).fontSize(14.2).fillColor(REPORT_COLORS.navy)
    .text("ASSESSMENT AND MIDTERM REPORT", margin, 134, { width: pageWidth - (margin * 2), align: "center" })
  return 166
}

function drawRiaExactLetterhead(doc, report, fonts, headingFonts) {
  const pageWidth = doc.page.width
  if (!fs.existsSync(RIA_REFERENCE_HEADER_PATH)) {
    return drawReportLetterhead(doc, report, fonts)
  }
  const imageHeight = pageWidth * RIA_REFERENCE_HEADER_RATIO
  doc.image(RIA_REFERENCE_HEADER_PATH, 0, 0, { width: pageWidth })
  doc.font(headingFonts.bold).fontSize(10.4).fillColor(REPORT_COLORS.navy)
    .text("ASSESSMENT AND MIDTERM REPORT", 36, imageHeight + 5, { width: pageWidth - 72, align: "center" })
  return imageHeight + 36
}

function drawModernAcademicLetterhead(doc, report, fonts) {
  const pageWidth = doc.page.width
  const margin = 36
  doc.rect(0, 0, pageWidth, 92).fill("#f8fafc")
  doc.rect(0, 0, 16, 136).fill(REPORT_COLORS.navy)
  doc.rect(16, 0, 4, 136).fill(REPORT_COLORS.yellow)
  doc.font(fonts.bold).fontSize(14).fillColor(REPORT_COLORS.navy)
    .text(reportText(report.school_name, "School").toUpperCase(), margin, 32, { width: 320 })
  doc.font(fonts.regular).fontSize(8.8).fillColor(REPORT_COLORS.muted)
    .text([report.school_city, report.school_country].filter(Boolean).join(", "), margin, 53, { width: 300 })
  doc.font(fonts.bold).fontSize(12).fillColor(REPORT_COLORS.black)
    .text("ASSESSMENT AND MIDTERM REPORT", margin, 102, { width: pageWidth - 72, align: "center" })
  return 136
}

function drawCompactFormalLetterhead(doc, report, fonts) {
  const pageWidth = doc.page.width
  const margin = 42
  doc.moveTo(margin, 42).lineTo(pageWidth - margin, 42).lineWidth(1.1).strokeColor(REPORT_COLORS.black).stroke()
  doc.font(fonts.bold).fontSize(13).fillColor(REPORT_COLORS.black)
    .text(reportText(report.school_name, "School").toUpperCase(), margin, 52, { width: pageWidth - (margin * 2), align: "center" })
  doc.font(fonts.regular).fontSize(8.6).fillColor(REPORT_COLORS.muted)
    .text([report.school_city, report.school_country].filter(Boolean).join(", "), margin, 72, { width: pageWidth - (margin * 2), align: "center" })
  doc.moveTo(margin, 90).lineTo(pageWidth - margin, 90).lineWidth(0.9).strokeColor(REPORT_COLORS.black).stroke()
  doc.font(fonts.bold).fontSize(11).fillColor(REPORT_COLORS.navy)
    .text("ASSESSMENT AND MIDTERM REPORT", margin, 104, { width: pageWidth - (margin * 2), align: "center" })
  return 132
}

function drawTemplateLetterhead(doc, report, fonts, templateId, headingFonts = fonts) {
  if (templateId === "ria_exact") return drawRiaExactLetterhead(doc, report, fonts, headingFonts)
  if (templateId === "modern_academic") return drawModernAcademicLetterhead(doc, report, fonts)
  if (templateId === "compact_formal") return drawCompactFormalLetterhead(doc, report, fonts)
  return drawReportLetterhead(doc, report, fonts)
}

function drawMetaField(doc, fonts, label, value, x, y, labelWidth, valueWidth) {
  doc.font(fonts.bold).fontSize(8.8).fillColor(REPORT_COLORS.black)
    .text(label, x, y, { width: labelWidth })
  doc.font(fonts.regular).fontSize(8.8).fillColor(REPORT_COLORS.black)
    .text(reportText(value), x + labelWidth, y, { width: valueWidth })
}

function drawReportStudentDetails(doc, report, fonts, y) {
  const teachers = reportTeacherNames(report)
  drawMetaField(doc, fonts, "STUDENT NAME:", reportStudentName(report), 72, y, 103, 185)
  drawMetaField(doc, fonts, "CLASS:", report.class_name, 378, y, 48, 112)
  y += 19
  drawMetaField(doc, fonts, "ACADEMIC YEAR:", report.academic_year_name, 72, y, 112, 150)
  drawMetaField(doc, fonts, "LEAD TEACHER:", teachers[0] || "-", 328, y, 103, 125)
  y += 19
  drawMetaField(doc, fonts, "ASSISTANT/SUBJECT TEACHER:", teachers[1] || teachers[0] || "-", 72, y, 182, 265)
  return y + 28
}

function reportAssessmentNumber(value) {
  const match = String(value || "").match(/(?:continuous\s*)?assessment\s*(\d+)|\bca\s*(\d+)\b/i)
  if (!match) return null
  const number = Number(match[1] || match[2])
  return Number.isFinite(number) ? number : null
}

function reportExamSectionTitle(examType, sessionName, assessmentType) {
  const type = String(examType || "").toLowerCase()
  const name = reportText(sessionName, "")
  if (type.includes("mid") || /mid/i.test(name)) return "MIDTERM REPORT"
  if (name) {
    const upperName = name.toUpperCase()
    return upperName.endsWith("REPORT") ? upperName : `${upperName} REPORT`
  }
  return `${assessmentTypeLabel(assessmentType || examType || "assessment").toUpperCase()} REPORT`
}

function reportSectionMeta(item, report) {
  const assessmentNumber = reportAssessmentNumber(item.assessment_name)
  if (assessmentNumber) {
    return {
      key: `continuous:${assessmentNumber}`,
      title: `CONTINUOUS ASSESSMENT ${assessmentNumber} REPORT`,
      sort: assessmentNumber < 3 ? 100 + assessmentNumber : 350 + assessmentNumber,
    }
  }

  const examType = item.exam_type || report.exam_type
  const sessionName = item.exam_session_name || report.exam_session_name
  const assessmentType = item.assessment_type
  const isExam = item.exam_session_id || examType || String(assessmentType || "").includes("term") || String(assessmentType || "").includes("exam")
  if (isExam) {
    const title = reportExamSectionTitle(examType, sessionName, assessmentType)
    return {
      key: `exam:${item.exam_session_id || report.exam_session_id || title}`,
      title,
      sort: title === "MIDTERM REPORT" ? 300 : 320,
    }
  }

  const titleBase = assessmentTypeLabel(assessmentType || (item.source_type === "recurring_assessment" ? "recurring assessment" : "continuous assessment"))
    .toUpperCase()
  return {
    key: `${item.source_type || "assessment"}:${assessmentType || titleBase}`,
    title: titleBase.endsWith("REPORT") ? titleBase : `${titleBase} REPORT`,
    sort: item.source_type === "recurring_assessment" ? 420 : 240,
  }
}

function buildReportSections(report) {
  const sourceRows = (report.assessment_items || []).length
    ? report.assessment_items
    : (report.subjects || []).map((subject) => ({
      ...subject,
      source_type: "report_card",
      assessment_name: report.exam_session_name,
      assessment_type: report.exam_type,
      exam_session_id: report.exam_session_id,
      exam_session_name: report.exam_session_name,
      exam_type: report.exam_type,
    }))

  const sections = new Map()
  for (const row of sourceRows) {
    const meta = reportSectionMeta(row, report)
    const section = sections.get(meta.key) || { ...meta, rows: [] }
    section.rows.push(row)
    sections.set(meta.key, section)
  }

  if (!sections.size) {
    const meta = reportSectionMeta({ source_type: "report_card", exam_type: report.exam_type, exam_session_name: report.exam_session_name }, report)
    sections.set(meta.key, { ...meta, rows: [] })
  }

  return [...sections.values()]
    .map((section) => ({
      ...section,
      rows: section.rows.sort((a, b) => reportText(a.subject_name).localeCompare(reportText(b.subject_name))),
    }))
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
}

function drawReportGrid(doc, x, y, widths, height, fillColor = null) {
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  if (fillColor) doc.rect(x, y, totalWidth, height).fill(fillColor)
  doc.lineWidth(0.65).strokeColor(REPORT_COLORS.black).rect(x, y, totalWidth, height).stroke()
  let cursor = x
  for (let index = 0; index < widths.length - 1; index += 1) {
    cursor += widths[index]
    doc.moveTo(cursor, y).lineTo(cursor, y + height).stroke()
  }
}

function reportTextHeight(doc, fonts, text, width, size = 8.2, bold = false) {
  doc.font(bold ? fonts.bold : fonts.regular).fontSize(size)
  return doc.heightOfString(reportText(text), { width })
}

function drawReportTableHeader(doc, fonts, title, x, y, widths) {
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  doc.rect(x, y, totalWidth, 18).fillAndStroke(REPORT_COLORS.navy, REPORT_COLORS.black)
  doc.font(fonts.bold).fontSize(8.8).fillColor("#ffffff")
    .text(title, x + 4, y + 4.5, { width: totalWidth - 8, align: "center" })
  y += 18
  drawReportGrid(doc, x, y, widths, 23, REPORT_COLORS.cream)
  const labels = ["Subjects", "Mark", "Grade", "Comments", "Teacher"]
  let cursor = x
  labels.forEach((label, index) => {
    doc.font(fonts.bold).fontSize(8.2).fillColor(REPORT_COLORS.black)
      .text(label, cursor + 4, y + 7, { width: widths[index] - 8, align: "center" })
    cursor += widths[index]
  })
  return y + 23
}

function ensureReportSpace(doc, y, neededHeight, topY = 42) {
  if (y + neededHeight <= doc.page.height - 36) return y
  doc.addPage()
  return topY
}

function drawReportResultRow(doc, fonts, row, x, y, widths) {
  const subject = reportText(row.subject_name || row.subject_code)
  const mark = scoreLabel(row.raw_score ?? row.score)
  const grade = normalizeReportGrade(row)
  const comment = reportText(row.comment)
  const teacher = reportText(row.teacher_name)
  const weak = isWeakReportResult(row)
  const innerWidths = widths.map((width) => width - 8)
  const rowHeight = Math.max(
    29,
    reportTextHeight(doc, fonts, subject, innerWidths[0]) + 12,
    reportTextHeight(doc, fonts, comment, innerWidths[3]) + 12,
    reportTextHeight(doc, fonts, teacher, innerWidths[4]) + 12,
  )
  drawReportGrid(doc, x, y, widths, rowHeight)
  let cursor = x
  doc.font(fonts.regular).fontSize(8.2).fillColor(REPORT_COLORS.black)
    .text(subject, cursor + 4, y + 6, { width: innerWidths[0] })
  cursor += widths[0]
  doc.fillColor(weak ? REPORT_COLORS.red : REPORT_COLORS.black)
    .text(mark, cursor + 4, y + 6, { width: innerWidths[1], align: "center" })
  cursor += widths[1]
  doc.font(fonts.bold).fillColor(weak ? REPORT_COLORS.red : REPORT_COLORS.black)
    .text(grade, cursor + 4, y + 6, { width: innerWidths[2], align: "center" })
  cursor += widths[2]
  doc.font(fonts.regular).fillColor(weak ? REPORT_COLORS.red : REPORT_COLORS.black)
    .text(comment, cursor + 4, y + 6, { width: innerWidths[3] })
  cursor += widths[3]
  doc.fillColor(REPORT_COLORS.black)
    .text(teacher, cursor + 4, y + 6, { width: innerWidths[4] })
  return y + rowHeight
}

function reportOverallComment(report, rows) {
  const firstName = reportText(report.first_name, "The learner")
  const weakRows = rows.filter(isWeakReportResult)
  if (!rows.length) return "Results will appear here once assessment marks have been captured and approved."
  if (weakRows.length) {
    const subjects = weakRows.slice(0, 2).map((row) => reportText(row.subject_name)).join(" and ")
    return `${firstName} should continue focused revision in ${subjects} while maintaining regular practice across all subjects.`
  }
  return `${firstName} has shown steady progress across the assessed subjects. Continued practice and active participation will help maintain this performance.`
}

function drawOverallCommentRow(doc, fonts, report, rows, x, y, widths) {
  const labelWidth = widths[0] + widths[1] + widths[2]
  const commentWidth = widths[3] + widths[4]
  const comment = reportOverallComment(report, rows)
  const rowHeight = Math.max(47, reportTextHeight(doc, fonts, comment, commentWidth - 10) + 16)
  drawReportGrid(doc, x, y, [labelWidth, commentWidth], rowHeight)
  doc.font(fonts.bold).fontSize(8.2).fillColor(REPORT_COLORS.black)
    .text("TEACHER'S OVERALL\nCOMMENTS:", x + 6, y + 10, { width: labelWidth - 12, align: "center" })
  doc.font(fonts.regular).fontSize(8.2).fillColor(rows.some(isWeakReportResult) ? REPORT_COLORS.red : REPORT_COLORS.black)
    .text(comment, x + labelWidth + 6, y + 9, { width: commentWidth - 12 })
  return y + rowHeight
}

function drawAssessmentSection(doc, fonts, report, section, startY) {
  const x = 36
  let y = ensureReportSpace(doc, startY, 96)
  y = drawReportTableHeader(doc, fonts, section.title, x, y, REPORT_COLUMNS)
  const rows = section.rows.length ? section.rows : [{ subject_name: "-", comment: "-", teacher_name: "-" }]
  for (const row of rows) {
    const estimate = Math.max(
      29,
      reportTextHeight(doc, fonts, row.subject_name || row.subject_code, REPORT_COLUMNS[0] - 8) + 12,
      reportTextHeight(doc, fonts, row.comment, REPORT_COLUMNS[3] - 8) + 12,
      reportTextHeight(doc, fonts, row.teacher_name, REPORT_COLUMNS[4] - 8) + 12,
    )
    if (y + estimate > doc.page.height - 90) {
      doc.addPage()
      y = drawReportTableHeader(doc, fonts, section.title, x, 42, REPORT_COLUMNS)
    }
    y = drawReportResultRow(doc, fonts, row, x, y, REPORT_COLUMNS)
  }
  if (y + 58 > doc.page.height - 36) {
    doc.addPage()
    y = drawReportTableHeader(doc, fonts, section.title, x, 42, REPORT_COLUMNS)
  }
  y = drawOverallCommentRow(doc, fonts, report, section.rows, x, y, REPORT_COLUMNS)
  return y + 18
}

function drawGradingKey(doc, fonts) {
  doc.addPage()
  const x = 62
  let y = 58
  doc.roundedRect(x, y, 118, 24, 2).fill(REPORT_COLORS.navy)
  doc.font(fonts.bold).fontSize(10).fillColor("#ffffff")
    .text("GRADING KEY", x, y + 6, { width: 118, align: "center" })
  y += 56

  const widths = [225, 160, 90]
  drawReportGrid(doc, x, y, widths, 28, REPORT_COLORS.navy)
  let cursor = x
  ;["Grading Scale", "Mark", "Grade"].forEach((label, index) => {
    doc.font(fonts.bold).fontSize(9).fillColor("#ffffff")
      .text(label, cursor + 5, y + 8, { width: widths[index] - 10, align: "center" })
    cursor += widths[index]
  })
  y += 28

  for (const [scale, mark, grade] of REPORT_GRADING_KEY) {
    drawReportGrid(doc, x, y, widths, 29)
    doc.rect(x, y, widths[0], 29).fill(REPORT_COLORS.cream)
    doc.lineWidth(0.65).strokeColor(REPORT_COLORS.black).rect(x, y, widths[0], 29).stroke()
    doc.font(fonts.regular).fontSize(8.8).fillColor(REPORT_COLORS.black)
      .text(scale, x + 6, y + 8, { width: widths[0] - 12 })
      .text(mark, x + widths[0] + 6, y + 8, { width: widths[1] - 12, align: "center" })
    doc.font(fonts.bold)
      .text(grade, x + widths[0] + widths[1] + 6, y + 8, { width: widths[2] - 12, align: "center" })
    y += 29
  }
}

function drawReportCardPdf(report, res, options = {}) {
  const templateId = normalizeReportPdfTemplateId(options.template, report)
  const doc = new PDFDocument({ size: "LETTER", margin: 36 })
  const filename = reportFileName(report)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
  doc.pipe(res)

  const headingFonts = registerReportSansFonts(doc)
  const fonts = ["modern_academic", "compact_formal"].includes(templateId)
    ? headingFonts
    : registerReportFonts(doc)
  let y = drawTemplateLetterhead(doc, report, fonts, templateId, headingFonts)
  y = drawReportStudentDetails(doc, report, fonts, y)
  for (const section of buildReportSections(report)) {
    y = drawAssessmentSection(doc, fonts, report, section, y)
  }
  drawGradingKey(doc, fonts)
  doc.end()
}

export async function getReportCard(req, res) {
  const schoolId = getScopedSchoolId(req)
  const cardId = Number(req.params.id || 0)
  if (!cardId) throw new HttpError(400, "Report card id is required")
  const reportCard = await loadReportCardPayload(schoolId, cardId)
  await assertReportCardVisibleToUser(reportCard, req.user)
  res.json({ report_card: reportCard })
}

export async function getReportCardPdf(req, res) {
  const schoolId = getScopedSchoolId(req)
  const cardId = Number(req.params.id || 0)
  if (!cardId) throw new HttpError(400, "Report card id is required")
  const reportCard = await loadReportCardPayload(schoolId, cardId)
  await assertReportCardVisibleToUser(reportCard, req.user)
  const requestedTemplate = String(req.query?.template || "").trim()
  const template = requestedTemplate
    ? normalizeReportPdfTemplateId(requestedTemplate, reportCard)
    : await getReportPdfTemplateForSchool(pool, schoolId, reportCard)
  drawReportCardPdf(reportCard, res, { template })
}

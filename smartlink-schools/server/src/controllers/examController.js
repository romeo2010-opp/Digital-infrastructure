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

const FORMAL_ASSESSMENT_TYPES = new Set(["mid_term", "end_of_term_exam", "mock_exam", "final_exam"])
const EXAM_TYPES = new Set(["end_of_term", "mid_term", "mock", "final", "custom"])
const EXAM_STATUSES = new Set(["draft", "scheduled", "in_progress", "marking", "results_submitted", "results_approved", "locked", "archived"])
const PAPER_STATUSES = new Set(["draft", "open", "ready_for_review", "approved", "scheduled", "marking", "results_submitted", "results_approved", "returned", "locked", "archived"])

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
       ORDER BY s.last_name, s.first_name`,
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
  const [[current]] = await pool.query("SELECT status FROM exam_sessions WHERE id = ? AND school_id = ? LIMIT 1", [sessionId, schoolId])
  if (!current) throw new HttpError(404, "Exam session was not found")
  if (current.status === "archived") throw new HttpError(409, "Archived exam sessions are read-only")
  if (current.status === "locked" && status !== "archived") throw new HttpError(409, "Locked exam sessions can only be archived")
  await pool.query("UPDATE exam_sessions SET status = ? WHERE id = ? AND school_id = ?", [status, sessionId, schoolId])
  if (status === "locked") {
    await pool.query("UPDATE assessments SET status = 'locked' WHERE school_id = ? AND exam_session_id = ? AND status <> 'archived'", [schoolId, sessionId])
    await pool.query("UPDATE result_batches SET status = 'locked' WHERE school_id = ? AND exam_session_id = ? AND status = 'approved'", [schoolId, sessionId])
    await pool.query(
      `UPDATE result_entries re
       JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
       SET re.status = 'locked'
       WHERE re.school_id = ? AND rb.exam_session_id = ? AND re.status = 'approved'`,
      [schoolId, sessionId],
    )
  }
  res.json({ ok: true })
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
      sch.name AS school_name, sch.city AS school_city, sch.country AS school_country,
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

function drawReportCardPdf(report, res) {
  const doc = new PDFDocument({ size: "A4", margin: 42 })
  const filename = reportFileName(report)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
  doc.pipe(res)

  const pageWidth = doc.page.width
  const margin = doc.page.margins.left
  const contentWidth = pageWidth - (margin * 2)
  const fullName = [report.first_name, report.last_name].filter(Boolean).join(" ")

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827")
    .text(String(report.school_name || "School").toUpperCase(), margin, 46, { width: contentWidth, align: "center" })
  doc.font("Helvetica").fontSize(9).fillColor("#475569")
    .text([report.school_city, report.school_country].filter(Boolean).join(", "), margin, 66, { width: contentWidth, align: "center" })
  doc.moveTo(margin, 88).lineTo(pageWidth - margin, 88).lineWidth(1.2).strokeColor("#111827").stroke()
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827")
    .text("EXAMINATION RESULTS", margin, 98, { width: contentWidth, align: "center" })
  doc.font("Helvetica").fontSize(9.5).fillColor("#475569")
    .text(report.exam_session_name || report.term_name || "Exam Session", margin, 115, { width: contentWidth, align: "center" })

  const leftX = margin
  const rightX = margin + 270
  const rightFieldWidth = 168
  const photoSize = 64
  drawStudentPhoto(doc, report, pageWidth - margin - photoSize, 145, photoSize)
  let y = 145
  drawField(doc, "Name", fullName, leftX, y)
  drawField(doc, "Term", report.term_name, rightX, y, rightFieldWidth)
  y += 18
  drawField(doc, "Student ID", report.student_code || report.admission_no, leftX, y)
  drawField(doc, "Academic Year", report.academic_year_name, rightX, y, rightFieldWidth)
  y += 18
  drawField(doc, "Class", report.class_name, leftX, y)
  drawField(doc, "Exam Type", valueLabel(report.exam_type), rightX, y, rightFieldWidth)
  y += 18
  drawField(doc, "Attendance", percentLabel(report.attendance_percent), leftX, y)
  drawField(doc, "Generated", dateLabel(report.generated_at), rightX, y, rightFieldWidth)
  y += 18
  drawField(doc, "Average", percentLabel(report.average_score), leftX, y)
  drawField(doc, "Grade", report.grade, rightX, y, rightFieldWidth)
  y += 18
  drawField(doc, "Position", report.position ? `${report.position} / ${report.class_total || "-"}` : "-", leftX, y)
  drawField(doc, "Total Students", report.class_total || "-", rightX, y, rightFieldWidth)

  y += 34
  const columns = [
    { label: "Subject Code", x: margin, width: 82 },
    { label: "Subject Name", x: margin + 86, width: 188 },
    { label: "Exam Mark", x: margin + 278, width: 72, align: "right" },
    { label: "Total", x: margin + 354, width: 58, align: "right" },
    { label: "Grade", x: margin + 418, width: 48 },
    { label: "Comment", x: margin + 470, width: 82 },
  ]
  doc.rect(margin, y, contentWidth, 22).fillAndStroke("#f3f4f6", "#d1d5db")
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#374151")
  columns.forEach((column) => doc.text(column.label, column.x + 4, y + 7, { width: column.width - 8, align: column.align || "left" }))
  y += 22

  const rows = report.subjects || []
  for (const subject of rows) {
    if (y > 735) {
      doc.addPage()
      y = 48
    }
    doc.rect(margin, y, contentWidth, 24).strokeColor("#e5e7eb").stroke()
    doc.font("Helvetica").fontSize(8.5).fillColor("#111827")
    doc.text(subject.subject_code || "-", columns[0].x + 4, y + 7, { width: columns[0].width - 8 })
    doc.text(subject.subject_name || "-", columns[1].x + 4, y + 7, { width: columns[1].width - 8 })
    doc.text(`${scoreLabel(subject.raw_score)} / ${scoreLabel(subject.total_marks || 100)}`, columns[2].x + 4, y + 7, { width: columns[2].width - 8, align: "right" })
    doc.font("Helvetica-Bold").text(percentLabel(subject.total_percent), columns[3].x + 4, y + 7, { width: columns[3].width - 8, align: "right" })
    doc.text(subject.grade || "-", columns[4].x + 4, y + 7, { width: columns[4].width - 8 })
    doc.font("Helvetica").fillColor("#4b5563").text(subject.comment || "-", columns[5].x + 4, y + 7, { width: columns[5].width - 8 })
    y += 24
  }

  y += 18
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(1.2).strokeColor("#111827").stroke()
  y += 12
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111827").text(`Subjects Below 50: ${report.failed_subjects || 0}`, margin, y)
  doc.text(`Remarks: ${report.remark || "-"}`, margin + 220, y)
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Report Card #${report.id}`, margin, y + 24)

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
  drawReportCardPdf(reportCard, res)
}

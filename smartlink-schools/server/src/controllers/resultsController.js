import { pool } from "../config/db.js"
import {
  assertTeacherCanTeachSubject,
  getScopedSchoolId,
  getTeacherClassSubjectPairs,
  isTeacher,
} from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { createInAppNotification } from "../services/operationalCommunicationService.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"
import { absentCommentForWithdrawal, getWithdrawalsForStudentsOnDate } from "../services/studentWithdrawalService.js"
import { ingestApprovedResultBatch } from "../services/academicIntelligenceEngine.js"

function gradeFor(score, totalMarks) {
  if (score === null || score === undefined || score === "") return null
  const percentage = (Number(score) / Math.max(Number(totalMarks || 0), 1)) * 100
  if (percentage >= 80) return "A"
  if (percentage >= 70) return "B"
  if (percentage >= 60) return "C"
  if (percentage >= 50) return "D"
  return "E"
}

async function refreshTermResultPositions(connection, schoolId, academicYearId, termId, classId = null) {
  const classFilter = classId ? " AND class_id = ?" : ""
  const params = [schoolId, academicYearId, termId, ...(classId ? [classId] : [])]
  const [rankedRows] = await connection.query(
    `SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY class_id
        ORDER BY average_score DESC, total_score DESC, student_id ASC
      ) AS position
     FROM term_results
     WHERE school_id = ? AND academic_year_id = ? AND term_id = ?
       AND status IN ('generated', 'approved', 'locked')${classFilter}`,
    params,
  )
  for (const row of rankedRows) {
    await connection.query(
      "UPDATE term_results SET position = ? WHERE id = ? AND school_id = ?",
      [Number(row.position), row.id, schoolId],
    )
  }
  return rankedRows.length
}

function isFormalAssessment(assessment) {
  return ["mid_term", "end_of_term_exam", "mock_exam", "final_exam"].includes(String(assessment?.assessment_type || ""))
}

function assertAssessmentAllowsResultEntry(req, assessment) {
  if (["locked", "archived"].includes(String(assessment.status || ""))) {
    throw new HttpError(409, "This assessment is locked")
  }
  if (!isFormalAssessment(assessment)) return
  const allowed = ["approved", "scheduled", "marking", "results_submitted", "returned"]
  if (!allowed.includes(String(assessment.status || ""))) {
    throw new HttpError(400, "Formal exam papers must be approved or scheduled before marks can be entered")
  }
  if (isTeacher(req) && String(assessment.status || "") === "results_submitted") {
    throw new HttpError(409, "Submitted formal results cannot be edited unless returned")
  }
}

async function getAssessmentOrThrow(schoolId, assessmentId) {
  const [[assessment]] = await pool.query(
    `SELECT a.*, c.name AS class_name, subj.name AS subject_name,
      ay.name AS academic_year_name, t.name AS term_name
      , es.name AS exam_session_name, es.status AS exam_session_status,
      ett.exam_date
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.school_id = a.school_id
       AND ett.assessment_id = a.id
       AND ett.class_id = a.class_id
       AND ett.subject_id = a.subject_id
       AND ett.status <> 'cancelled'
     WHERE a.school_id = ? AND a.id = ? LIMIT 1`,
    [schoolId, assessmentId],
  )
  if (!assessment) throw new HttpError(404, "Assessment was not found")
  if (!assessment.academic_year_id || !assessment.term_id) throw new HttpError(400, "Assessment must be linked to an academic year and term")
  return assessment
}

function teacherScopeClause(pairs, classColumn = "a.class_id", subjectColumn = "a.subject_id") {
  if (!Array.isArray(pairs)) return { clause: "", params: [] }
  if (!pairs.length) return { clause: " AND 1 = 0", params: [] }
  return {
    clause: ` AND (${pairs.map(() => `(${classColumn} = ? AND ${subjectColumn} = ?)`).join(" OR ")})`,
    params: pairs.flatMap((pair) => [pair.classId, pair.subjectId]),
  }
}

async function ensureBatch(connection, schoolId, assessment, teacherId) {
  const [[existing]] = await connection.query(
    `SELECT * FROM result_batches
     WHERE school_id = ? AND assessment_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ? AND term_id = ?
     LIMIT 1`,
    [schoolId, assessment.id, assessment.class_id, assessment.subject_id, teacherId, assessment.term_id],
  )
  if (existing) return existing

  const [result] = await connection.query(
    `INSERT INTO result_batches (
      school_id, exam_session_id, assessment_id, academic_year_id, term_id, class_id, stream_section, subject_id, teacher_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      schoolId,
      assessment.exam_session_id || null,
      assessment.id,
      assessment.academic_year_id,
      assessment.term_id,
      assessment.class_id,
      assessment.stream_section || null,
      assessment.subject_id,
      teacherId,
    ],
  )
  return {
    id: Number(result.insertId),
    school_id: schoolId,
    exam_session_id: assessment.exam_session_id || null,
    assessment_id: assessment.id,
    academic_year_id: assessment.academic_year_id,
    term_id: assessment.term_id,
    class_id: assessment.class_id,
    stream_section: assessment.stream_section || null,
    subject_id: assessment.subject_id,
    teacher_id: teacherId,
    status: "draft",
  }
}

async function loadSheetRows(schoolId, assessment, batchId) {
  const assessmentDate = assessment.exam_date || null
  const [students] = await pool.query(
    `SELECT se.id AS enrollment_id, s.id, COALESCE(s.student_id, s.admission_no) AS student_id, s.admission_no,
      s.first_name, s.last_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      se.enrollment_status, c.name AS class_name
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN student_withdrawals sw ON sw.school_id = se.school_id
      AND sw.student_id = s.id
      AND sw.status <> 'cancelled'
      AND ? IS NOT NULL
      AND sw.start_date <= ?
      AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ?)
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
      AND ((se.enrollment_status = 'active' AND s.status = 'active') OR sw.id IS NOT NULL)
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [assessmentDate, assessmentDate, assessmentDate, schoolId, assessment.academic_year_id, assessment.term_id, assessment.class_id],
  )
  const [entries] = batchId
    ? await pool.query("SELECT * FROM result_entries WHERE school_id = ? AND result_batch_id = ?", [schoolId, batchId])
    : [[]]
  const entriesByStudent = new Map(entries.map((entry) => [Number(entry.student_id), entry]))
  const withdrawalsByStudent = await getWithdrawalsForStudentsOnDate(pool, schoolId, students.map((student) => student.id), assessmentDate)
  return students.map((student) => {
    const entry = entriesByStudent.get(Number(student.id))
    const withdrawal = withdrawalsByStudent.get(Number(student.id)) || null
    const absent = Boolean(withdrawal)
    return {
      ...student,
      result_entry_id: entry?.id || null,
      enrollment_id: entry?.enrollment_id || student.enrollment_id || null,
      score: absent ? "" : entry?.score ?? "",
      grade: absent ? "" : entry?.grade || "",
      comment: entry?.comment || "",
      status: absent ? "absent" : entry?.status === "absent" ? "draft" : entry?.status || "draft",
      withdrawal_status: withdrawal ? { withdrawn: true, ...withdrawal } : null,
      absent,
      last_saved_at: entry?.last_saved_at || null,
    }
  })
}

export async function listResultsSetup(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const teacherPairs = await getTeacherClassSubjectPairs(req, schoolId)
  const assessmentScope = teacherScopeClause(teacherPairs, "a.class_id", "a.subject_id")
  const [years] = await pool.query("SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC", [schoolId])
  const [terms] = await pool.query("SELECT * FROM terms WHERE school_id = ? ORDER BY start_date DESC", [schoolId])
  const teacherAssignmentSessionClause = session.setupRequired
    ? ""
    : " AND (a.academic_year_id = ? OR a.academic_year_id IS NULL) AND (a.term_id = ? OR a.term_id IS NULL)"
  const teacherAssignmentSessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [classes] = Array.isArray(teacherPairs)
    ? await pool.query(
      `SELECT DISTINCT c.id, c.name, c.grade_level
       FROM classes c
       JOIN teacher_class_subject_assignments a ON a.class_id = c.id AND a.school_id = c.school_id
       WHERE c.school_id = ? AND a.teacher_id = ? AND a.role = 'subject_teacher' AND a.is_active = 1${teacherAssignmentSessionClause}
       ORDER BY c.name`,
      [schoolId, req.user.id, ...teacherAssignmentSessionParams],
    )
    : await pool.query("SELECT id, name, grade_level FROM classes WHERE school_id = ? ORDER BY name", [schoolId])
  const [subjects] = Array.isArray(teacherPairs)
    ? await pool.query(
      `SELECT DISTINCT subj.id, subj.name, subj.code
       FROM subjects subj
       JOIN teacher_class_subject_assignments a ON a.subject_id = subj.id AND a.school_id = subj.school_id
       WHERE subj.school_id = ? AND a.teacher_id = ? AND a.role = 'subject_teacher' AND a.is_active = 1${teacherAssignmentSessionClause}
       ORDER BY subj.name`,
      [schoolId, req.user.id, ...teacherAssignmentSessionParams],
    )
    : await pool.query("SELECT id, name, code FROM subjects WHERE school_id = ? ORDER BY name", [schoolId])
  const [assessments] = session.setupRequired ? [[]] : await pool.query(
    `SELECT a.id, a.name, a.class_id, a.subject_id, a.academic_year_id, a.term_id, a.teacher_id,
      a.exam_session_id, a.assessment_type, a.term_name, a.total_marks, a.duration_minutes, a.status,
      c.name AS class_name, subj.name AS subject_name,
      ay.name AS academic_year_name, t.name AS term_label, es.name AS exam_session_name
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     WHERE a.school_id = ? AND a.academic_year_id = ? AND a.term_id = ?${assessmentScope.clause}
       AND a.status NOT IN ('archived', 'locked')
     ORDER BY ay.start_date DESC, t.term_number DESC, c.name, subj.name, a.name`,
    [schoolId, session.academicYearId, session.termId, ...assessmentScope.params],
  )
  const [examSessions] = session.setupRequired ? [[]] : await pool.query(
    `SELECT es.*, ay.name AS academic_year_name, t.name AS term_name,
      COUNT(DISTINCT a.id) AS paper_count
     FROM exam_sessions es
     JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.school_id = es.school_id
     JOIN terms t ON t.id = es.term_id AND t.school_id = es.school_id
     LEFT JOIN assessments a ON a.exam_session_id = es.id AND a.school_id = es.school_id
     WHERE es.school_id = ? AND es.academic_year_id = ? AND es.term_id = ? AND es.status <> 'archived'
     GROUP BY es.id, ay.name, t.name
     ORDER BY es.start_date DESC`,
    [schoolId, session.academicYearId, session.termId],
  )
  const [batches] = session.setupRequired ? [[]] : await pool.query(
    `SELECT rb.*, a.name AS assessment_name, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name,
      COUNT(re.id) AS completed_marks,
      SUM(CASE WHEN re.score IS NULL AND COALESCE(re.status, '') <> 'absent' THEN 1 ELSE 0 END) AS missing_marks,
      SUM(CASE WHEN re.status = 'absent' THEN 1 ELSE 0 END) AS absent_marks
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id
     WHERE rb.school_id = ? AND rb.academic_year_id = ? AND rb.term_id = ?${isTeacher(req) ? " AND rb.teacher_id = ?" : ""}
     GROUP BY rb.id, a.name, c.name, subj.name, u.full_name
     ORDER BY rb.updated_at DESC`,
    isTeacher(req) ? [schoolId, session.academicYearId, session.termId, req.user.id] : [schoolId, session.academicYearId, session.termId],
  )
  res.json({ years, terms, classes, subjects, assessments, exam_sessions: examSessions, batches, session: sessionPayload(session), setup_required: session.setupRequired })
}

export async function listResultBatches(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ batches: [], session: sessionPayload(session), setup_required: true })
  }
  const [rows] = await pool.query(
    `SELECT rb.*, a.name AS assessment_name, a.total_marks, c.name AS class_name, subj.name AS subject_name,
      u.full_name AS teacher_name, ay.name AS academic_year_name, t.name AS term_name, es.name AS exam_session_name,
      COUNT(re.id) AS saved_marks,
      SUM(CASE WHEN re.score IS NULL AND COALESCE(re.status, '') <> 'absent' THEN 1 ELSE 0 END) AS missing_marks,
      SUM(CASE WHEN re.status = 'absent' THEN 1 ELSE 0 END) AS absent_marks
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     JOIN academic_years ay ON ay.id = rb.academic_year_id AND ay.school_id = rb.school_id
     JOIN terms t ON t.id = rb.term_id AND t.school_id = rb.school_id
     LEFT JOIN exam_sessions es ON es.id = rb.exam_session_id AND es.school_id = rb.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id
     WHERE rb.school_id = ? AND rb.academic_year_id = ? AND rb.term_id = ?${isTeacher(req) ? " AND rb.teacher_id = ?" : ""}
     GROUP BY rb.id, a.name, a.total_marks, c.name, subj.name, u.full_name, ay.name, t.name, es.name
     ORDER BY rb.updated_at DESC`,
    isTeacher(req) ? [schoolId, session.academicYearId, session.termId, req.user.id] : [schoolId, session.academicYearId, session.termId],
  )
  res.json({ batches: rows, session: sessionPayload(session), setup_required: false })
}

export async function getResultSheet(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = Number(req.query.assessment_id || req.params.assessmentId || 0)
  if (!assessmentId) throw new HttpError(400, "Assessment is required")
  const assessment = await getAssessmentOrThrow(schoolId, assessmentId)
  await assertTeacherCanTeachSubject(req, schoolId, assessment.class_id, assessment.subject_id, assessment.term_id)
  assertAssessmentAllowsResultEntry(req, assessment)
  const teacherId = isTeacher(req) ? req.user.id : Number(req.query.teacher_id || assessment.teacher_id || assessment.created_by)
  const [[batch]] = await pool.query(
    `SELECT * FROM result_batches
     WHERE school_id = ? AND assessment_id = ? AND teacher_id = ? AND term_id = ?
     LIMIT 1`,
    [schoolId, assessmentId, teacherId, assessment.term_id],
  )
  const rows = await loadSheetRows(schoolId, assessment, batch?.id)
  res.json({ assessment, batch: batch || null, rows })
}

export async function getClassResultSheet(req, res) {
  const schoolId = getScopedSchoolId(req)
  const activeSession = await getActiveAcademicSession(schoolId)
  if (activeSession.setupRequired && (!req.query.academic_year_id || !req.query.term_id)) {
    return res.json({ rows: [], papers: [], setup_required: true, session: sessionPayload(activeSession) })
  }

  const academicYearId = Number(req.query.academic_year_id || activeSession.academicYearId || 0)
  const termId = Number(req.query.term_id || activeSession.termId || 0)
  const classId = Number(req.query.class_id || 0)
  const examSessionId = req.query.exam_session_id ? Number(req.query.exam_session_id) : null
  if (!academicYearId || !termId) throw new HttpError(400, "Academic year and term are required")
  if (!classId) throw new HttpError(400, "Class is required")

  const [[classRow]] = await pool.query(
    "SELECT id, name, grade_level FROM classes WHERE id = ? AND school_id = ? LIMIT 1",
    [classId, schoolId],
  )
  if (!classRow) throw new HttpError(404, "Class was not found")

  let examSession = null
  if (examSessionId) {
    const [[examSessionRow]] = await pool.query(
      `SELECT id, name, exam_type, status
       FROM exam_sessions
       WHERE id = ? AND school_id = ? AND academic_year_id = ? AND term_id = ?
       LIMIT 1`,
      [examSessionId, schoolId, academicYearId, termId],
    )
    examSession = examSessionRow || null
  }
  if (examSessionId && !examSession) throw new HttpError(404, "Exam session was not found")

  const assessmentParams = [schoolId, academicYearId, termId, classId]
  let examSessionClause = ""
  if (examSessionId) {
    examSessionClause = " AND a.exam_session_id = ?"
    assessmentParams.push(examSessionId)
  }

  const [papers] = await pool.query(
    `SELECT a.id, a.name AS assessment_name, a.assessment_type, a.status AS assessment_status,
      a.total_marks, a.exam_session_id, es.name AS exam_session_name,
      ett.exam_date,
      subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
      rb.id AS result_batch_id, rb.status AS batch_status, u.full_name AS teacher_name
     FROM assessments a
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.school_id = a.school_id
       AND ett.assessment_id = a.id
       AND ett.class_id = a.class_id
       AND ett.subject_id = a.subject_id
       AND ett.status <> 'cancelled'
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     LEFT JOIN users u ON u.id = COALESCE(rb.teacher_id, a.teacher_id) AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.academic_year_id = ? AND a.term_id = ? AND a.class_id = ?
       AND a.status <> 'archived'${examSessionClause}
     GROUP BY a.id, a.name, a.assessment_type, a.status, a.total_marks, a.exam_session_id,
       es.name, ett.exam_date, subj.id, subj.name, subj.code, rb.id, rb.status, u.full_name
     ORDER BY subj.name, a.name`,
    assessmentParams,
  )

  const examDates = papers.map((paper) => paper.exam_date).filter(Boolean).map((value) => String(value).slice(0, 10)).sort()
  const firstExamDate = examDates[0] || null
  const lastExamDate = examDates[examDates.length - 1] || null
  const [students] = await pool.query(
    `SELECT se.id AS enrollment_id, s.id AS student_pk, COALESCE(s.student_id, s.admission_no) AS student_id,
      s.admission_no, s.first_name, s.last_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      se.enrollment_status, c.name AS class_name
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN student_withdrawals sw ON sw.school_id = se.school_id
      AND sw.student_id = se.student_id
      AND sw.status <> 'cancelled'
      AND ? IS NOT NULL
      AND sw.start_date <= ?
      AND COALESCE(sw.end_date, '9999-12-31') >= ?
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
       AND ((se.enrollment_status = 'active' AND s.status = 'active') OR sw.id IS NOT NULL)
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [firstExamDate, lastExamDate, firstExamDate, schoolId, academicYearId, termId, classId],
  )

  const entriesParams = [schoolId, academicYearId, termId, classId]
  let entryExamClause = ""
  if (examSessionId) {
    entryExamClause = " AND rb.exam_session_id = ?"
    entriesParams.push(examSessionId)
  }
  const [entries] = await pool.query(
    `SELECT re.student_id, re.score, re.grade, re.comment, re.status, re.last_saved_at,
      rb.assessment_id, rb.status AS batch_status, a.total_marks
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     WHERE re.school_id = ? AND rb.academic_year_id = ? AND rb.term_id = ? AND rb.class_id = ?${entryExamClause}`,
    entriesParams,
  )

  const entriesByStudent = new Map()
  entries.forEach((entry) => {
    const studentKey = Number(entry.student_id)
    const resultMap = entriesByStudent.get(studentKey) || new Map()
    const score = entry.score === null || entry.score === undefined ? null : Number(entry.score)
    const grade = entry.grade || gradeFor(score, entry.total_marks)
    const percentage = score === null ? null : Number(((score / Math.max(Number(entry.total_marks || 0), 1)) * 100).toFixed(1))
    resultMap.set(Number(entry.assessment_id), {
      score,
      grade,
      percentage,
      comment: entry.comment || "",
      status: entry.status || entry.batch_status || "draft",
      batch_status: entry.batch_status || "",
      last_saved_at: entry.last_saved_at || null,
    })
    entriesByStudent.set(studentKey, resultMap)
  })

  const paperIds = papers.map((paper) => Number(paper.id))
  const withdrawalMapsByPaper = new Map()
  for (const paper of papers) {
    if (!paper.exam_date) continue
    withdrawalMapsByPaper.set(
      Number(paper.id),
      await getWithdrawalsForStudentsOnDate(pool, schoolId, students.map((student) => student.student_pk), paper.exam_date),
    )
  }
  const rows = students.map((student) => {
    const resultMap = entriesByStudent.get(Number(student.student_pk)) || new Map()
    const results = {}
    let totalPercentage = 0
    let marked = 0
    let absent = 0
    paperIds.forEach((paperId) => {
      const withdrawal = withdrawalMapsByPaper.get(paperId)?.get(Number(student.student_pk)) || null
      const result = resultMap.get(paperId) || null
      if (withdrawal) {
        absent += 1
        results[paperId] = {
          ...(result || {}),
          score: null,
          grade: "",
          percentage: null,
          comment: result?.comment || absentCommentForWithdrawal(withdrawal),
          status: "absent",
          withdrawal_status: { withdrawn: true, ...withdrawal },
        }
      } else if (result && String(result.status || "").toLowerCase() !== "absent") {
        results[paperId] = result
        if (result.percentage !== null) {
          totalPercentage += Number(result.percentage)
          marked += 1
        }
      } else {
        results[paperId] = null
      }
    })
    const averageScore = marked ? Number((totalPercentage / marked).toFixed(1)) : null
    return {
      ...student,
      id: student.student_pk,
      results,
      marked_subjects: marked,
      absent_subjects: absent,
      missing_subjects: Math.max(0, paperIds.length - marked - absent),
      average_score: averageScore,
      average_grade: averageScore === null ? null : gradeFor(averageScore, 100),
    }
  })

  res.json({
    class: classRow,
    exam_session: examSession || null,
    papers,
    rows,
    summary: {
      students: rows.length,
      papers: papers.length,
      complete_students: rows.filter((row) => row.missing_subjects === 0 && papers.length > 0).length,
      missing_marks: rows.reduce((sum, row) => sum + Number(row.missing_subjects || 0), 0),
    },
    session: sessionPayload(activeSession),
    setup_required: false,
  })
}

async function saveEntries(connection, schoolId, batch, assessment, entries, status = "draft") {
  const assessmentDate = assessment.exam_date || null
  const withdrawalsByStudent = await getWithdrawalsForStudentsOnDate(
    connection,
    schoolId,
    entries.map((entry) => entry.student_id),
    assessmentDate,
  )
  for (const entry of entries) {
    const studentId = Number(entry.student_id || 0)
    if (!studentId) continue
    const enrollmentId = entry.enrollment_id ? Number(entry.enrollment_id) : null
    const withdrawal = withdrawalsByStudent.get(studentId) || null
    const absent = Boolean(withdrawal)
    const scoreValue = absent || entry.score === "" || entry.score === null || entry.score === undefined ? null : Number(entry.score)
    if (scoreValue !== null && (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > Number(assessment.total_marks))) {
      throw new HttpError(400, `Score for student ${studentId} must be between 0 and ${assessment.total_marks}`)
    }
    await connection.query(
      `INSERT INTO result_entries (
        school_id, result_batch_id, student_id, enrollment_id, score, grade, comment, status, last_saved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE enrollment_id = VALUES(enrollment_id), score = VALUES(score), grade = VALUES(grade), comment = VALUES(comment), status = VALUES(status), last_saved_at = CURRENT_TIMESTAMP`,
      [
        schoolId,
        batch.id,
        studentId,
        enrollmentId,
        scoreValue,
        absent ? null : gradeFor(scoreValue, assessment.total_marks),
        String(entry.comment || "").trim() || (absent ? absentCommentForWithdrawal(withdrawal) : null),
        absent ? "absent" : status,
      ],
    )
  }
}

async function generateOfficialResultsForBatch(connection, schoolId, batchId, generatedBy) {
  const [[batch]] = await connection.query(
    `SELECT rb.*, a.total_marks, a.assessment_type
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     WHERE rb.school_id = ? AND rb.id = ?
     LIMIT 1`,
    [schoolId, batchId],
  )
  if (!batch) throw new HttpError(404, "Result batch was not found")

  const [entries] = await connection.query(
    `SELECT re.*, COALESCE(re.enrollment_id, se.id) AS resolved_enrollment_id,
      COALESCE(se.class_id, rb.class_id) AS resolved_class_id,
      COALESCE(se.stream_section, rb.stream_section) AS resolved_stream_section
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     LEFT JOIN student_enrollments se ON se.school_id = re.school_id
       AND se.student_id = re.student_id
       AND se.academic_year_id = rb.academic_year_id
       AND se.term_id = rb.term_id
       AND se.enrollment_status = 'active'
     WHERE re.school_id = ? AND re.result_batch_id = ? AND re.status = 'approved' AND re.score IS NOT NULL`,
    [schoolId, batchId],
  )

  let generated = 0
  for (const entry of entries) {
    const enrollmentId = entry.resolved_enrollment_id || null
    const classId = entry.resolved_class_id || batch.class_id
    const percentage = Number((((Number(entry.score) || 0) / Math.max(Number(batch.total_marks || 0), 1)) * 100).toFixed(1))
    const grade = gradeFor(percentage, 100)

    await connection.query(
      `INSERT INTO term_results (
        school_id, student_id, enrollment_id, academic_year_id, term_id, class_id, stream_section,
        total_score, average_score, grade, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')
      ON DUPLICATE KEY UPDATE class_id = VALUES(class_id),
        stream_section = VALUES(stream_section),
        total_score = IF(status = 'locked', total_score, VALUES(total_score)),
        average_score = IF(status = 'locked', average_score, VALUES(average_score)),
        grade = IF(status = 'locked', grade, VALUES(grade)),
        status = IF(status = 'locked', status, 'generated')`,
      [
        schoolId,
        entry.student_id,
        enrollmentId,
        batch.academic_year_id,
        batch.term_id,
        classId,
        entry.resolved_stream_section || null,
        percentage,
        percentage,
        grade,
      ],
    )

    const [[termResult]] = await connection.query(
      `SELECT id, status
       FROM term_results
       WHERE school_id = ? AND student_id = ? AND academic_year_id = ? AND term_id = ? AND enrollment_id <=> ?
       LIMIT 1`,
      [schoolId, entry.student_id, batch.academic_year_id, batch.term_id, enrollmentId],
    )
    if (!termResult || termResult.status === "locked") continue

    await connection.query(
      `INSERT INTO subject_results (
        school_id, term_result_id, subject_id, teacher_id, assessment_id, result_batch_id, score, grade, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE teacher_id = VALUES(teacher_id),
        result_batch_id = VALUES(result_batch_id),
        score = VALUES(score),
        grade = VALUES(grade),
        comment = VALUES(comment)`,
      [
        schoolId,
        termResult.id,
        batch.subject_id,
        batch.teacher_id,
        batch.assessment_id,
        batchId,
        percentage,
        grade,
        entry.comment || null,
      ],
    )

    const [[aggregate]] = await connection.query(
      "SELECT COALESCE(SUM(score), 0) AS total_score, COALESCE(AVG(score), 0) AS average_score FROM subject_results WHERE school_id = ? AND term_result_id = ?",
      [schoolId, termResult.id],
    )
    const average = Number(Number(aggregate?.average_score || 0).toFixed(1))
    await connection.query(
      `UPDATE term_results
       SET total_score = ?, average_score = ?, grade = ?
       WHERE school_id = ? AND id = ? AND status <> 'locked'`,
      [
        Number(Number(aggregate?.total_score || 0).toFixed(1)),
        average,
        gradeFor(average, 100),
        schoolId,
        termResult.id,
      ],
    )

    if (batch.exam_session_id) {
      await connection.query(
        `INSERT INTO report_cards (
          school_id, student_id, enrollment_id, academic_year_id, term_id, exam_session_id,
          term_result_id, status, generated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?)
        ON DUPLICATE KEY UPDATE term_result_id = VALUES(term_result_id),
          status = IF(status = 'locked', status, 'generated'),
          generated_by = VALUES(generated_by),
          generated_at = CURRENT_TIMESTAMP`,
        [
          schoolId,
          entry.student_id,
          enrollmentId,
          batch.academic_year_id,
          batch.term_id,
          batch.exam_session_id,
          termResult.id,
          generatedBy,
        ],
      )
    }
    generated += 1
  }

  const positionsUpdated = await refreshTermResultPositions(connection, schoolId, batch.academic_year_id, batch.term_id, batch.class_id)
  return { term_results_touched: generated, positions_updated: positionsUpdated }
}

export async function saveResultDraft(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = Number(req.body.assessment_id || 0)
  const entries = Array.isArray(req.body.entries) ? req.body.entries : []
  if (!assessmentId) throw new HttpError(400, "Assessment is required")
  const assessment = await getAssessmentOrThrow(schoolId, assessmentId)
  await assertTeacherCanTeachSubject(req, schoolId, assessment.class_id, assessment.subject_id, assessment.term_id)
  assertAssessmentAllowsResultEntry(req, assessment)
  const teacherId = isTeacher(req) ? req.user.id : Number(req.body.teacher_id || assessment.teacher_id || assessment.created_by)
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const batch = await ensureBatch(connection, schoolId, assessment, teacherId)
    if (["submitted", "approved", "locked"].includes(batch.status) && isTeacher(req)) {
      throw new HttpError(409, "Submitted or approved results cannot be edited by teachers")
    }
    await saveEntries(connection, schoolId, batch, assessment, entries, "draft")
    if (isFormalAssessment(assessment) && ["approved", "scheduled"].includes(String(assessment.status || ""))) {
      await connection.query("UPDATE assessments SET status = 'marking' WHERE id = ? AND school_id = ?", [assessment.id, schoolId])
    }
    await connection.query("UPDATE result_batches SET status = 'draft', return_reason = NULL WHERE id = ? AND school_id = ?", [batch.id, schoolId])
    await connection.commit()
    try {
      const [headteachers] = await pool.query("SELECT id FROM users WHERE school_id=? AND role='headteacher' AND is_active=1", [schoolId])
      const [[context]] = await pool.query(`SELECT c.name class_name,subj.name subject_name,u.full_name teacher_name,a.name assessment_name FROM assessments a JOIN classes c ON c.id=a.class_id JOIN subjects subj ON subj.id=a.subject_id LEFT JOIN users u ON u.id=? WHERE a.school_id=? AND a.id=?`, [teacherId,schoolId,assessmentId])
      for (const headteacher of headteachers) await createInAppNotification({ schoolId, recipientUserId: headteacher.id, title: "Results submitted for review", message: `${context?.teacher_name || "A teacher"} submitted ${context?.class_name || "class"} ${context?.subject_name || "subject"} results for ${context?.assessment_name || "an assessment"}.`, category: "academics", priority: "high", linkedEntityType: "result_batch", linkedEntityId: batch.id, createdBy: req.user.id })
    } catch {
      // Result submission remains successful if optional notification delivery is unavailable.
    }
    res.json({ ok: true, batch_id: batch.id })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function submitResults(req, res) {
  const schoolId = getScopedSchoolId(req)
  const assessmentId = Number(req.body.assessment_id || 0)
  const entries = Array.isArray(req.body.entries) ? req.body.entries : []
  const assessment = await getAssessmentOrThrow(schoolId, assessmentId)
  await assertTeacherCanTeachSubject(req, schoolId, assessment.class_id, assessment.subject_id, assessment.term_id)
  assertAssessmentAllowsResultEntry(req, assessment)
  const teacherId = isTeacher(req) ? req.user.id : Number(req.body.teacher_id || assessment.teacher_id || assessment.created_by)
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const batch = await ensureBatch(connection, schoolId, assessment, teacherId)
    if (batch.status === "locked" || batch.status === "approved" || (batch.status === "submitted" && isTeacher(req))) {
      throw new HttpError(409, "These results are locked")
    }
    if (entries.length) await saveEntries(connection, schoolId, batch, assessment, entries, "draft")
    const [[enrolled]] = await connection.query(
      `SELECT COUNT(DISTINCT se.student_id) AS total
       FROM student_enrollments se
       LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       LEFT JOIN student_withdrawals sw ON sw.school_id = se.school_id
        AND sw.student_id = se.student_id
        AND sw.status <> 'cancelled'
        AND ? IS NOT NULL
        AND sw.start_date <= ?
        AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ?)
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
        AND ((se.enrollment_status = 'active' AND s.status = 'active') OR sw.id IS NOT NULL)`,
      [assessment.exam_date || null, assessment.exam_date || null, assessment.exam_date || null, schoolId, assessment.academic_year_id, assessment.term_id, assessment.class_id],
    )
    const expectedTotal = Number(enrolled?.total || 0)
    const [[completed]] = await connection.query(
      `SELECT COUNT(DISTINCT re.student_id) AS total
       FROM result_entries re
       LEFT JOIN student_withdrawals sw ON sw.school_id = re.school_id
        AND sw.student_id = re.student_id
        AND sw.status <> 'cancelled'
        AND ? IS NOT NULL
        AND sw.start_date <= ?
        AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ?)
       WHERE re.school_id = ? AND re.result_batch_id = ?
        AND (re.score IS NOT NULL OR (re.status = 'absent' AND sw.id IS NOT NULL))`,
      [assessment.exam_date || null, assessment.exam_date || null, assessment.exam_date || null, schoolId, batch.id],
    )
    const missingCount = Math.max(0, expectedTotal - Number(completed?.total || 0))
    if (missingCount) throw new HttpError(400, `${missingCount} students are missing marks`)
    await connection.query(
      `UPDATE result_batches
       SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, submitted_by = ?, return_reason = NULL
       WHERE id = ? AND school_id = ?`,
      [req.user.id, batch.id, schoolId],
    )
    await connection.query("UPDATE result_entries SET status = CASE WHEN status = 'absent' THEN 'absent' ELSE 'submitted' END WHERE school_id = ? AND result_batch_id = ?", [schoolId, batch.id])
    await connection.query("UPDATE assessments SET status = 'results_submitted' WHERE id = ? AND school_id = ? AND exam_session_id IS NOT NULL", [assessmentId, schoolId])
    await connection.commit()
    const intelligence = await ingestApprovedResultBatch(schoolId, batch.id, req.user).catch((error) => ({ queued: true, warning: error.message }))
    res.json({ ok: true, batch_id: batch.id, academic_intelligence: intelligence })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function approveResultBatch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const batchId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[batch]] = await connection.query(
      `SELECT rb.*, a.total_marks, a.name AS assessment_name
       FROM result_batches rb
       JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
       WHERE rb.id = ? AND rb.school_id = ? FOR UPDATE`,
      [batchId, schoolId],
    )
    if (!batch || batch.status !== "submitted") throw new HttpError(400, "Only submitted results can be approved")
    const [[missing]] = await connection.query(
      `SELECT COUNT(DISTINCT se.student_id) - COUNT(DISTINCT CASE WHEN re.score IS NOT NULL OR (re.status = 'absent' AND sw.id IS NOT NULL) THEN re.student_id END) AS total
       FROM student_enrollments se
       LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       LEFT JOIN result_batches rb ON rb.id = ? AND rb.school_id = se.school_id
       LEFT JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
       LEFT JOIN exam_timetable_entries ett ON ett.school_id = a.school_id
        AND ett.assessment_id = a.id
        AND ett.class_id = a.class_id
        AND ett.subject_id = a.subject_id
        AND ett.status <> 'cancelled'
       LEFT JOIN student_withdrawals sw ON sw.school_id = se.school_id
        AND sw.student_id = se.student_id
        AND sw.status <> 'cancelled'
        AND ett.exam_date IS NOT NULL
        AND sw.start_date <= ett.exam_date
        AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ett.exam_date)
       LEFT JOIN result_entries re ON re.school_id = se.school_id AND re.result_batch_id = rb.id AND re.student_id = se.student_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
         AND ((se.enrollment_status = 'active' AND s.status = 'active') OR sw.id IS NOT NULL)`,
      [batchId, schoolId, batch.academic_year_id, batch.term_id, batch.class_id],
    )
    if (Number(missing?.total || 0) > 0) throw new HttpError(400, `${Number(missing.total)} students are missing marks`)
    await connection.query(
      `UPDATE result_batches
       SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ?
       WHERE id = ? AND school_id = ?`,
      [req.user.id, batchId, schoolId],
    )
    await connection.query("UPDATE result_entries SET status = CASE WHEN status = 'absent' THEN 'absent' ELSE 'approved' END WHERE school_id = ? AND result_batch_id = ?", [schoolId, batchId])
    await connection.query("UPDATE assessments SET status = 'results_approved' WHERE id = ? AND school_id = ? AND exam_session_id IS NOT NULL", [batch.assessment_id, schoolId])
    const generated = await generateOfficialResultsForBatch(connection, schoolId, batchId, req.user.id)
    await connection.commit()
    const intelligence = await ingestApprovedResultBatch(schoolId, batchId, req.user).catch((error) => ({ queued: true, warning: error.message }))
    res.json({ ok: true, generated, academic_intelligence: intelligence })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function returnResultBatch(req, res) {
  const schoolId = getScopedSchoolId(req)
  const batchId = Number(req.params.id || 0)
  const reason = String(req.body.reason || "").trim()
  if (!reason) throw new HttpError(400, "Return reason is required")
  const [result] = await pool.query(
    `UPDATE result_batches
     SET status = 'returned', returned_at = CURRENT_TIMESTAMP, returned_by = ?, return_reason = ?
     WHERE id = ? AND school_id = ? AND status IN ('submitted', 'approved')`,
    [req.user.id, reason, batchId, schoolId],
  )
  if (!result.affectedRows) throw new HttpError(400, "Only submitted or approved results can be returned")
  await pool.query("UPDATE result_entries SET status = CASE WHEN status = 'absent' THEN 'absent' ELSE 'returned' END WHERE school_id = ? AND result_batch_id = ?", [schoolId, batchId])
  await pool.query(
    `UPDATE assessments a
     JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     SET a.status = 'marking'
     WHERE rb.id = ? AND rb.school_id = ? AND a.exam_session_id IS NOT NULL`,
    [batchId, schoolId],
  )
  res.json({ ok: true })
}

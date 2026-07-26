import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { generateDailyDrill, markAnswer, updateMasteryFromAnswer } from "../services/drills/dailyDrillGenerator.js"
import {
  assertDrillLearnerAccess,
  assertDrillSessionAccess,
  drillActorScopeSql,
  getTeacherSubjectIdsForClass,
} from "../services/drills/drillAccessService.js"
import { recalculateQuestionAnalytics, recalculateStudentMastery } from "../services/academicIntelligenceEngine.js"
import { markAnswerWithAi } from "../services/drills/aiAnswerMarker.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

function structuredTableCell(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return String(value.text ?? value.value ?? value.label ?? "").trim().slice(0, 1000)
  return String(value).trim().slice(0, 1000)
}

function structuredTableEntries(value) {
  const parsed = parseJson(value, [])
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== "object") return []
  if (String(parsed.type || "").toLowerCase() === "table" || String(parsed.asset_type || "").toLowerCase() === "structured_table") {
    return [parsed]
  }
  const nested = [
    ...(Array.isArray(parsed.assets) ? parsed.assets : []),
    ...(Array.isArray(parsed.tables) ? parsed.tables : []),
  ]
  if (nested.length) return nested
  return Object.values(parsed).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
}

export function structuredTablesFromAssets(value) {
  return structuredTableEntries(value)
    .filter((entry) => {
      const type = String(entry?.type || "").toLowerCase()
      const assetType = String(entry?.asset_type || "").toLowerCase()
      return type === "table" || assetType === "structured_table"
    })
    .slice(0, 12)
    .map((entry, tableIndex) => {
      const headerSource = entry.column_headers || entry.columnHeaders || entry.headers || (Array.isArray(entry.columns) ? entry.columns : [])
      const headers = Array.isArray(headerSource) ? headerSource.slice(0, 12).map(structuredTableCell) : []
      const cellSource = Array.isArray(entry.cells) ? entry.cells : (Array.isArray(entry.rows) ? entry.rows : [])
      let cells = cellSource.slice(0, 60).map((row) => Array.isArray(row) ? row.slice(0, 12).map(structuredTableCell) : [])
      const requestedColumns = Number(Array.isArray(entry.columns) ? 0 : entry.columns || entry.column_count || entry.columnCount) || 0
      const columnCount = Math.min(12, Math.max(1, requestedColumns, headers.length, ...cells.map((row) => row.length)))
      const requestedRows = Math.min(60, Math.max(0, Number(entry.row_count || entry.rowCount || (typeof entry.rows === "number" ? entry.rows : 0)) || 0))
      const headerRow = entry.header_row === true || entry.headerRow === true || entry.header_row === 1 || entry.headerRow === 1 || String(entry.header_row ?? entry.headerRow ?? "").toLowerCase() === "true" || headers.some(Boolean)
      if (headers.length && (!cells.length || headers.some((cell, column) => cell !== cells[0]?.[column]))) cells = [headers, ...cells]
      const rowCount = Math.min(60, Math.max(1, requestedRows, cells.length))
      cells = Array.from({ length: rowCount }, (_, row) =>
        Array.from({ length: columnCount }, (_, column) => structuredTableCell(cells[row]?.[column])),
      )
      return {
        table_id: String(entry.table_id || entry.tableId || entry.local_id || `table-${tableIndex + 1}`).slice(0, 80),
        caption: String(entry.caption || entry.title || "").trim().slice(0, 300),
        rows: rowCount,
        columns: columnCount,
        cells,
        header_row: headerRow,
      }
    })
}

export async function resolveDrillMasterySessionScope(connection, schoolId, studentId, activeSession) {
  if (activeSession?.setupRequired || !Number(activeSession?.academicYearId) || !Number(activeSession?.termId)) {
    throw new HttpError(409, activeSession?.message || "An active academic year and term are required before recording Daily Drill evidence")
  }
  const [[enrollment]] = await connection.query(
    `SELECT enrollment.academic_year_id,enrollment.term_id,enrollment.class_id
     FROM student_enrollments enrollment
     JOIN students student ON student.school_id=enrollment.school_id AND student.id=enrollment.student_id
       AND student.status='active'
     JOIN academic_years academic_year ON academic_year.school_id=enrollment.school_id
       AND academic_year.id=enrollment.academic_year_id AND academic_year.is_active=1 AND academic_year.status<>'archived'
     JOIN terms term ON term.school_id=enrollment.school_id AND term.id=enrollment.term_id
       AND term.academic_year_id=academic_year.id AND term.status IN ('open','marking')
     WHERE enrollment.school_id=? AND enrollment.student_id=?
       AND enrollment.academic_year_id=? AND enrollment.term_id=?
       AND enrollment.enrollment_status='active'
     ORDER BY enrollment.id DESC
     LIMIT 1`,
    [schoolId, studentId, activeSession.academicYearId, activeSession.termId],
  )
  if (!enrollment) {
    throw new HttpError(409, "The learner must have an active enrollment in the current academic year and term before Daily Drill evidence can be recorded")
  }
  return {
    academicYearId: Number(enrollment.academic_year_id),
    termId: Number(enrollment.term_id),
    classId: Number(enrollment.class_id),
  }
}

function studentIdForRequest(req) {
  if (req.user?.role === "student") return Number(req.user.studentId || req.user.id || 0)
  return Number(req.params.studentId || req.params.student_id || req.query.student_id || req.body.student_id || 0)
}

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function percentValue(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? Number(number.toFixed(1)) : null
}

function learnerProfileFromDrills(row) {
  const completed = Number(row.completed_drills || 0)
  const average = Number(row.average_score || 0)
  const improvement = row.improvement_points === null || row.improvement_points === undefined ? null : Number(row.improvement_points)
  const structuredAttempts = Number(row.structured_attempts || 0)
  const structuredCorrect = Number(row.structured_correct || 0)
  const blankAnswers = Number(row.blank_answers || 0)
  const answeredQuestions = Number(row.answered_questions || 0)
  const shortAnswerRate = answeredQuestions ? blankAnswers / answeredQuestions : 0

  if (completed < 2) {
    return {
      profile_key: "needs_more_evidence",
      profile_label: "Needs more evidence",
      profile_tone: "warn",
      evidence_summary: "Not enough completed drills yet for a confident learning pattern.",
      recommended_teacher_action: "Encourage the learner to complete the next few Daily Drills consistently.",
    }
  }
  if (improvement !== null && improvement >= 8) {
    return {
      profile_key: "improving",
      profile_label: "Improving learner",
      profile_tone: "good",
      evidence_summary: `Recent drill average improved by ${improvement.toFixed(1)} points.`,
      recommended_teacher_action: "Praise the improvement and keep the learner on slightly challenging practice.",
    }
  }
  if (structuredAttempts >= 3 && structuredCorrect / Math.max(1, structuredAttempts) >= 0.65) {
    return {
      profile_key: "problem_solver",
      profile_label: "Problem solver",
      profile_tone: "good",
      evidence_summary: "Structured and reasoning questions are being handled well.",
      recommended_teacher_action: "Give extension questions that require explanation and transfer.",
    }
  }
  if (average >= 85) {
    return {
      profile_key: "smart",
      profile_label: "Smart / quick learner",
      profile_tone: "good",
      evidence_summary: `Average Daily Drill score is ${average.toFixed(1)}%.`,
      recommended_teacher_action: "Use enrichment tasks so the learner stays stretched.",
    }
  }
  if (average < 50 && shortAnswerRate >= 0.25) {
    return {
      profile_key: "playful",
      profile_label: "Playful / rushing",
      profile_tone: "bad",
      evidence_summary: "Several answers are blank or very short while scores are low.",
      recommended_teacher_action: "Check whether the learner is rushing, guessing, or needs closer support during practice.",
    }
  }
  if (average >= 65) {
    return {
      profile_key: "steady",
      profile_label: "Steady learner",
      profile_tone: "neutral",
      evidence_summary: `Average Daily Drill score is ${average.toFixed(1)}% with regular attempts.`,
      recommended_teacher_action: "Keep the learner on routine practice and monitor weak topics.",
    }
  }
  return {
    profile_key: "needs_support",
    profile_label: "Needs support",
    profile_tone: "warn",
    evidence_summary: `Average Daily Drill score is ${average.toFixed(1)}%.`,
    recommended_teacher_action: "Review the weakest topics and give shorter guided practice.",
  }
}

function activeDrillWindow(session) {
  const today = new Date().toISOString().slice(0, 10)
  if (session.setupRequired) return { start: "1900-01-01", end: today }
  const status = String(session.activeTermStatus || session.term?.status || "").toLowerCase()
  return {
    start: session.term?.start_date || "1900-01-01",
    end: ["open", "marking"].includes(status) ? "9999-12-31" : session.term?.end_date || today,
  }
}

async function loadDrillSession(schoolId, sessionId, options = {}) {
  const [[session]] = await pool.query(
    `SELECT ds.*, s.first_name, s.last_name, subj.name AS subject_name, gl.name AS grade_name,
      st.topic_name AS focus_topic_name
     FROM drill_sessions ds
     JOIN students s ON s.id = ds.student_id AND s.school_id = ds.school_id
     JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = ds.school_id
     LEFT JOIN grade_levels gl ON gl.id = ds.grade_id AND gl.school_id = ds.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.id = ?
     LIMIT 1`,
    [schoolId, sessionId],
  )
  if (!session) throw new HttpError(404, "Drill session was not found")
  const [questions] = await pool.query(
    `SELECT dsq.id AS session_question_id, dsq.order_number, dsq.student_answer, dsq.is_correct,
      dsq.marks_awarded, dsq.mistake_type, dsq.ai_feedback, dsq.answered_at, dsq.reason,
      q.id AS question_id, q.question_type, q.question_text, q.options_json, q.correct_answer,
      q.accepted_answers_json, q.explanation, q.difficulty, q.skill_type, q.marks, q.assets_json,
      st.topic_name
     FROM drill_session_questions dsq
     JOIN question_bank q ON q.id = dsq.question_id
     LEFT JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
     WHERE dsq.drill_session_id = ?
     ORDER BY dsq.order_number, dsq.id`,
    [sessionId],
  )
  const includeInternalAnswers = Boolean(options.includeAnswers)
  const canReviewAnswers = includeInternalAnswers || session.status === "completed"
  return {
    ...session,
    questions: questions.map((question) => {
      const { assets_json: assetsJson, ...publicQuestion } = question
      return {
        ...publicQuestion,
        options_json: parseJson(question.options_json, []),
        tables: structuredTablesFromAssets(assetsJson),
        is_correct: canReviewAnswers ? question.is_correct : null,
        marks_awarded: canReviewAnswers ? question.marks_awarded : null,
        mistake_type: canReviewAnswers ? question.mistake_type : null,
        ai_feedback: canReviewAnswers ? question.ai_feedback : null,
        correct_answer: includeInternalAnswers ? question.correct_answer : null,
        accepted_answers_json: includeInternalAnswers ? parseJson(question.accepted_answers_json, []) : [],
        explanation: canReviewAnswers ? question.explanation : null,
      }
    }),
  }
}

function requestedSubjectId(req) {
  return Number(req.body?.subject_id || req.query?.subject_id || 0)
}

function activeSessionIds(session) {
  return session.setupRequired
    ? { academicYearId: null, termId: null }
    : { academicYearId: session.academicYearId, termId: session.termId }
}

async function learnerDrillAccess(req, schoolId, studentId, options = {}) {
  const session = options.session || await getActiveAcademicSession(schoolId)
  return assertDrillLearnerAccess({
    db: options.db || pool,
    actor: req.user,
    schoolId,
    studentId,
    subjectId: options.subjectId || null,
    action: options.action || "view",
    ...activeSessionIds(session),
  })
}

async function teacherSubjectScope(req, schoolId, classId, session) {
  if (req.user?.role !== "teacher") return null
  const subjectIds = await getTeacherSubjectIdsForClass({
    schoolId,
    teacherId: req.user.id,
    classId,
    ...activeSessionIds(session),
  })
  if (!subjectIds.length) {
    throw new HttpError(403, "Teachers can only access Daily Drills for actively assigned classes and subjects")
  }
  return subjectIds
}

export async function listDrills(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ drills: [], session: sessionPayload(session), setup_required: true })
  }
  const actorScope = drillActorScopeSql(req.user)
  const [rows] = await pool.query(
    `SELECT ds.id, ds.student_id, s.first_name, s.last_name, c.name AS class_name,
      st.topic_name, q.question_text AS prompt, ds.status, ds.score, ds.percentage, ds.scheduled_date
     FROM drill_sessions ds
     JOIN students s ON s.id = ds.student_id AND s.school_id = ds.school_id
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     LEFT JOIN drill_session_questions dsq ON dsq.drill_session_id = ds.id AND dsq.order_number = 1
     LEFT JOIN question_bank q ON q.id = dsq.question_id
     WHERE ds.school_id = ? AND s.status = 'active'${actorScope.clause}
     ORDER BY ds.scheduled_date DESC, ds.created_at DESC
     LIMIT 100`,
    [session.academicYearId, session.termId, schoolId, ...actorScope.params],
  )
  res.json({ drills: rows, session: sessionPayload(session), setup_required: false })
}

export async function generateDrillForStudent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const session = await getActiveAcademicSession(schoolId)
  const subjectId = requestedSubjectId(req)
  const access = await learnerDrillAccess(req, schoolId, studentId, {
    session,
    subjectId,
    action: "generate",
  })
  const connection = await pool.getConnection()
  let transactionOpen = false
  try {
    await connection.beginTransaction()
    transactionOpen = true
    const generated = await generateDailyDrill(connection, schoolId, studentId, {
      academicYearId: session.setupRequired ? null : session.academicYearId,
      termId: session.setupRequired ? null : session.termId,
      subjectId: subjectId || null,
      allowedSubjectIds: access.allowedSubjectIds,
      topicId: req.body.topic_id || req.query.topic_id,
      scheduledDate: req.body.scheduled_date || req.query.scheduled_date,
      limit: req.body.limit || 5,
    })
    if (!generated.ok) {
      await connection.rollback()
      transactionOpen = false
      return res.status(409).json({
        success: false,
        error: "Daily Drill generation failed",
        reason: generated.reason || "Unable to generate drill.",
      })
    }
    await connection.commit()
    transactionOpen = false
    res.status(201).json(generated)
  } catch (error) {
    if (transactionOpen) await connection.rollback().catch(() => {})
    const status = error.status && Number(error.status) < 500 ? Number(error.status) : 500
    const reason = error.sqlMessage || error.message || "Unable to generate drill."
    if (status >= 500) {
      console.error("[daily-drill] generation failed", {
        school_id: schoolId,
        student_id: studentId,
        code: error.code,
        message: error.message,
        sqlMessage: error.sqlMessage,
        stack: error.stack,
      })
    }
    res.status(status).json({
      success: false,
      error: "Daily Drill generation failed",
      reason,
    })
  } finally {
    connection.release()
  }
}

export async function generateDrillsForClass(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.params.classId || req.params.class_id || req.body.class_id || 0)
  if (!classId) throw new HttpError(400, "Class is required")
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) throw new HttpError(409, session.message)
  const allowedSubjectIds = await teacherSubjectScope(req, schoolId, classId, session)
  const subjectId = requestedSubjectId(req)
  if (subjectId && allowedSubjectIds && !allowedSubjectIds.includes(subjectId)) {
    throw new HttpError(403, "Teachers can only generate drills for actively assigned classes and subjects")
  }
  const scheduledDate = req.body.scheduled_date || req.query.scheduled_date || todayIso()
  const [students] = await pool.query(
    `SELECT s.id
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     WHERE se.school_id = ? AND se.class_id = ? AND se.academic_year_id = ? AND se.term_id = ?
       AND se.enrollment_status = 'active'
     ORDER BY ${studentCodeSortSql("s")}, s.first_name, s.last_name`,
    [schoolId, classId, session.academicYearId, session.termId],
  )
  if (!students.length) throw new HttpError(409, "No active students were found in this class.")

  const summary = {
    class_id: classId,
    scheduled_date: scheduledDate,
    total_students: students.length,
    generated: 0,
    skipped: 0,
    failed: 0,
    insufficient_questions: 0,
    results: [],
  }

  for (const student of students) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const generated = await generateDailyDrill(connection, schoolId, student.id, {
        academicYearId: session.academicYearId,
        termId: session.termId,
        subjectId: subjectId || null,
        allowedSubjectIds,
        topicId: req.body.topic_id || req.query.topic_id,
        scheduledDate,
        limit: req.body.limit || 5,
        minimumQuestions: req.body.minimum_questions || 1,
      })
      if (!generated.ok) {
        await connection.rollback()
        const reason = generated.reason || "Unable to generate drill."
        if (/not enough|approved questions/i.test(reason)) summary.insufficient_questions += 1
        else summary.failed += 1
        summary.results.push({ student_id: Number(student.id), ok: false, reason })
      } else {
        await connection.commit()
        if (generated.existing) summary.skipped += 1
        else summary.generated += 1
        summary.results.push({ student_id: Number(student.id), ok: true, ...generated })
      }
    } catch (error) {
      await connection.rollback()
      summary.failed += 1
      summary.results.push({ student_id: Number(student.id), ok: false, reason: error.message || "Unable to generate drill." })
    } finally {
      connection.release()
    }
  }

  res.status(201).json(summary)
}

export async function getTodayDrill(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const activeSession = await getActiveAcademicSession(schoolId)
  const access = await learnerDrillAccess(req, schoolId, studentId, { session: activeSession, action: "view" })
  const date = req.query.date || todayIso()
  const subjectScope = scopedInClause(access.allowedSubjectIds, "subject_id")
  const [[existing]] = await pool.query(
    `SELECT id FROM drill_sessions
     WHERE school_id = ? AND student_id = ? AND scheduled_date = ? AND status <> 'missed'${subjectScope.clause}
     ORDER BY FIELD(status, 'in_progress', 'pending', 'completed', 'missed'), id DESC
     LIMIT 1`,
    [schoolId, studentId, date, ...subjectScope.params],
  )
  let sessionId = existing?.id
  let generation = null
  if (!sessionId) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      generation = await generateDailyDrill(connection, schoolId, studentId, {
        academicYearId: activeSession.setupRequired ? null : activeSession.academicYearId,
        termId: activeSession.setupRequired ? null : activeSession.termId,
        scheduledDate: date,
        limit: 5,
        allowedSubjectIds: access.allowedSubjectIds,
      })
      await connection.commit()
      if (generation.ok) sessionId = generation.session_id
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
  if (!sessionId) {
    return res.json({
      drill: null,
      action_required: generation?.reason || "No Daily Drill is ready yet. A teacher may need to approve syllabus questions first.",
    })
  }
  const drill = await loadDrillSession(schoolId, sessionId, { includeAnswers: req.user.role !== "student" })
  if (drill.status === "pending") {
    await pool.query("UPDATE drill_sessions SET status = 'in_progress' WHERE id = ? AND school_id = ?", [sessionId, schoolId])
    drill.status = "in_progress"
  }
  res.json({ drill })
}

export async function answerDrillQuestion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || req.params.sessionId || 0)
  const sessionQuestionId = Number(req.body.session_question_id || req.body.sessionQuestionId || 0)
  const questionId = Number(req.body.question_id || req.body.questionId || 0)
  const answer = req.body.answer ?? req.body.student_answer ?? ""
  if (!sessionId) throw new HttpError(400, "Drill session is required")
  if (!sessionQuestionId && !questionId) throw new HttpError(400, "Question is required")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const activeSession = await getActiveAcademicSession(schoolId, connection)
    const [[row]] = await connection.query(
      `SELECT ds.student_id, ds.subject_id AS drill_subject_id, ds.status, dsq.id AS session_question_id, q.*
       FROM drill_sessions ds
       JOIN drill_session_questions dsq ON dsq.drill_session_id = ds.id
       JOIN question_bank q ON q.id = dsq.question_id AND q.school_id = ds.school_id AND q.subject_id = ds.subject_id
       WHERE ds.school_id = ? AND ds.id = ?
         AND (${sessionQuestionId ? "dsq.id = ?" : "q.id = ?"})
       LIMIT 1 FOR UPDATE`,
      [schoolId, sessionId, sessionQuestionId || questionId],
    )
    if (!row) throw new HttpError(404, "Drill question was not found")
    await learnerDrillAccess(req, schoolId, row.student_id, {
      db: connection,
      session: activeSession,
      subjectId: row.drill_subject_id,
      action: "answer",
    })
    const masterySession = await resolveDrillMasterySessionScope(connection, schoolId, row.student_id, activeSession)
    if (row.status === "completed") throw new HttpError(409, "This drill has already been submitted")
    let mark = markAnswer(row, answer)
    if (
      ["structured", "essay"].includes(String(row.question_type || ""))
      || (String(row.question_type || "") === "short_answer" && mark.is_correct === false)
    ) {
      const aiMark = await markAnswerWithAi({
        question: row,
        studentAnswer: answer,
        schoolId,
        userId: req.user.role === "student" ? null : req.user.id,
      })
      if (aiMark) mark = aiMark
    }
    await connection.query(
      `UPDATE drill_session_questions
       SET student_answer = ?, is_correct = ?, marks_awarded = ?, mistake_type = ?, ai_feedback = ?, answered_at = CURRENT_TIMESTAMP
       WHERE id = ? AND drill_session_id = ?`,
      [String(answer), mark.is_correct, mark.marks_awarded, mark.mistake_type, mark.ai_feedback || null, row.session_question_id, sessionId],
    )
    await updateMasteryFromAnswer(connection, schoolId, row.student_id, row, mark)
    if (mark.is_correct !== null && mark.is_correct !== undefined) {
      const maxMarks=Math.max(1,Number(row.marks||1))
      const awarded=Math.max(0,Number(mark.marks_awarded||0))
      const scorePercentage=Number(((awarded/maxMarks)*100).toFixed(2))
      const responseStatus=mark.is_correct?'correct':awarded>0?'partially_correct':'incorrect'
      await connection.query(`INSERT INTO question_attempts (
        public_ref,school_id,student_id,question_id,drill_session_id,subject_id,topic_id,subtopic_id,learning_objective_id,
        response_text,response_status,marks_awarded,marks_available,attempt_context,misconception_code,attempted_at
      ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,'daily_drill',?,CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE response_text=VALUES(response_text),response_status=VALUES(response_status),
        marks_awarded=VALUES(marks_awarded),marks_available=VALUES(marks_available),misconception_code=VALUES(misconception_code),attempted_at=CURRENT_TIMESTAMP`,
      [schoolId,row.student_id,row.id,sessionId,row.subject_id,row.topic_id,row.subtopic_id||null,row.learning_objective_id||null,String(answer),responseStatus,awarded,maxMarks,mark.mistake_type||null])
      await connection.query(`INSERT INTO mastery_evidence (
        public_ref,school_id,academic_year_id,term_id,student_id,class_id,subject_id,topic_id,subtopic_id,learning_objective_id,evidence_type,
        source_entity_type,source_entity_id,score_percentage,marks_awarded,marks_available,difficulty_weight,
        assessment_weight,independence_weight,evidence_granularity,evidence_at,metadata_json
      ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,'daily_drill','drill_session_question',?,?,?,?,?,0.5,1,?,CURRENT_TIMESTAMP,?)
      ON DUPLICATE KEY UPDATE academic_year_id=VALUES(academic_year_id),term_id=VALUES(term_id),class_id=VALUES(class_id),
        score_percentage=VALUES(score_percentage),marks_awarded=VALUES(marks_awarded),marks_available=VALUES(marks_available),
        publication_state='published',evidence_status='valid',evidence_at=CURRENT_TIMESTAMP,metadata_json=VALUES(metadata_json)`,
      [schoolId,masterySession.academicYearId,masterySession.termId,row.student_id,masterySession.classId,row.subject_id,row.topic_id,row.subtopic_id||null,row.learning_objective_id||null,row.session_question_id,scorePercentage,awarded,maxMarks,row.difficulty==='hard'?1.2:row.difficulty==='medium'?1:0.85,row.learning_objective_id?'objective':row.subtopic_id?'subtopic':'topic',JSON.stringify({mistake_type:mark.mistake_type||null,reason:row.reason||null,drill_session_id:sessionId})])
      const academicScope={academic_year_id:masterySession.academicYearId,term_id:masterySession.termId}
      await recalculateStudentMastery(schoolId,row.student_id,row.subject_id,{...academicScope,topic_id:row.topic_id},connection)
      if(row.subtopic_id)await recalculateStudentMastery(schoolId,row.student_id,row.subject_id,{...academicScope,topic_id:row.topic_id,subtopic_id:row.subtopic_id},connection)
      if(row.learning_objective_id)await recalculateStudentMastery(schoolId,row.student_id,row.subject_id,{...academicScope,topic_id:row.topic_id,subtopic_id:row.subtopic_id||null,learning_objective_id:row.learning_objective_id},connection)
      await recalculateQuestionAnalytics(schoolId,row.id,connection)
    }
    await connection.commit()
    res.json({
      ok: true,
      mark: req.user.role === "student"
        ? {
          teacher_review_required: Boolean(mark.teacher_review_required || mark.needs_review),
          ai_feedback: mark.ai_feedback || "",
          marks_awarded: mark.marks_awarded,
          max_marks: Number(row.marks || 1),
          is_correct: mark.is_correct,
          mistake_type: mark.mistake_type,
        }
        : mark,
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function submitDrill(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || 0)
  const [[session]] = await pool.query("SELECT * FROM drill_sessions WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, sessionId])
  if (!session) throw new HttpError(404, "Drill session was not found")
  const activeSession = await getActiveAcademicSession(schoolId)
  await learnerDrillAccess(req, schoolId, session.student_id, {
    session: activeSession,
    subjectId: session.subject_id,
    action: "submit",
  })
  const [[aggregate]] = await pool.query(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS answered,
      COALESCE(SUM(marks_awarded), 0) AS score,
      COALESCE(SUM(q.marks), 0) AS possible
     FROM drill_session_questions dsq
     JOIN question_bank q ON q.id = dsq.question_id
     WHERE dsq.drill_session_id = ?`,
    [sessionId],
  )
  const score = Number(aggregate?.score || 0)
  const possible = Math.max(1, Number(aggregate?.possible || 0))
  const percentage = Number(((score / possible) * 100).toFixed(2))
  await pool.query(
    `UPDATE drill_sessions
     SET status = 'completed', score = ?, percentage = ?, total_questions = ?
     WHERE school_id = ? AND id = ?`,
    [score, percentage, Number(aggregate?.total || 0), schoolId, sessionId],
  )
  res.json({
    ok: true,
    score,
    percentage,
    answered: Number(aggregate?.answered || 0),
    total: Number(aggregate?.total || 0),
    drill: await loadDrillSession(schoolId, sessionId, { includeAnswers: req.user.role !== "student" }),
  })
}

export async function getDrillSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sessionId = Number(req.params.id || req.params.sessionId || 0)
  if (!sessionId) throw new HttpError(400, "Drill session is required")
  const activeSession = await getActiveAcademicSession(schoolId)
  await assertDrillSessionAccess({
    actor: req.user,
    schoolId,
    sessionId,
    action: "view",
    ...activeSessionIds(activeSession),
  })
  const drill = await loadDrillSession(schoolId, sessionId, { includeAnswers: !["student", "parent"].includes(String(req.user.role || "")) })
  res.json({ drill })
}

export async function getDrillHistory(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const activeSession = await getActiveAcademicSession(schoolId)
  const access = await learnerDrillAccess(req, schoolId, studentId, { session: activeSession, action: "history" })
  const subjectScope = scopedInClause(access.allowedSubjectIds, "ds.subject_id")
  const [sessions] = await pool.query(
    `SELECT ds.*, subj.name AS subject_name, st.topic_name AS focus_topic_name
     FROM drill_sessions ds
     JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = ds.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.student_id = ?${subjectScope.clause}
     ORDER BY ds.scheduled_date DESC
     LIMIT 60`,
    [schoolId, studentId, ...subjectScope.params],
  )
  res.json({ sessions })
}

export async function getTeacherDrillInsights(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.params.classId || req.params.class_id || 0)
  if (!classId) throw new HttpError(400, "Class is required")
  const session = await getActiveAcademicSession(schoolId)
  const teacherSubjectIds = await teacherSubjectScope(req, schoolId, classId, session)
  const summarySubjectScope = scopedInClause(teacherSubjectIds, "ds.subject_id")
  const masterySubjectScope = scopedInClause(teacherSubjectIds, "stm.subject_id")
  const questionSubjectScope = scopedInClause(teacherSubjectIds, "q.subject_id")
  const drillWindow = activeDrillWindow(session)
  const [[summary]] = await pool.query(
    `SELECT COUNT(DISTINCT ds.id) AS sessions,
      COUNT(DISTINCT CASE WHEN ds.status = 'completed' THEN ds.id END) AS completed,
      AVG(ds.percentage) AS average_score
     FROM drill_sessions ds
     JOIN student_enrollments se ON se.student_id = ds.student_id AND se.school_id = ds.school_id
     WHERE ds.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'
       ${session.setupRequired ? "" : "AND se.academic_year_id = ? AND se.term_id = ?"}
       AND ds.scheduled_date BETWEEN ? AND ?${summarySubjectScope.clause}`,
    [schoolId, classId, ...(session.setupRequired ? [] : [session.academicYearId, session.termId]), drillWindow.start, drillWindow.end, ...summarySubjectScope.params],
  )
  const [weakTopics] = await pool.query(
    `SELECT st.topic_name, subj.name AS subject_name, COUNT(*) AS weak_students, AVG(stm.mastery_score) AS average_mastery
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     JOIN student_enrollments se ON se.student_id = stm.student_id AND se.school_id = stm.school_id
     WHERE stm.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'
       ${session.setupRequired ? "" : "AND se.academic_year_id = ? AND se.term_id = ?"}
       AND stm.mastery_label IN ('weak', 'developing')${masterySubjectScope.clause}
     GROUP BY st.id, st.topic_name, subj.name
     ORDER BY weak_students DESC, average_mastery ASC
     LIMIT 10`,
    [schoolId, classId, ...(session.setupRequired ? [] : [session.academicYearId, session.termId]), ...masterySubjectScope.params],
  )
  const [missed] = await pool.query(
    `SELECT s.id, s.first_name, s.last_name, COUNT(ds.id) AS missed_drills
     FROM drill_sessions ds
     JOIN students s ON s.id = ds.student_id AND s.school_id = ds.school_id
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
     WHERE ds.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'
       ${session.setupRequired ? "" : "AND se.academic_year_id = ? AND se.term_id = ?"}
       AND ds.scheduled_date BETWEEN ? AND ? AND ds.status = 'missed'${summarySubjectScope.clause}
     GROUP BY s.id, s.student_id, s.admission_no, s.first_name, s.last_name
     ORDER BY missed_drills DESC
     LIMIT 10`,
    [schoolId, classId, ...(session.setupRequired ? [] : [session.academicYearId, session.termId]), drillWindow.start, drillWindow.end, ...summarySubjectScope.params],
  )
  let interventions = []
  let questionWarnings = []
  try {
    const [interventionRows] = await pool.query(
      `SELECT s.id AS student_id, s.first_name, s.last_name, subj.name AS subject_name,
        st.topic_name, stm.mastery_score, stm.mastery_label, stm.consecutive_failures,
        stm.intervention_reason, stm.next_review_at
       FROM student_topic_mastery stm
       JOIN students s ON s.id = stm.student_id AND s.school_id = stm.school_id
       JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
       JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
       JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
       WHERE stm.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'
         ${masterySubjectScope.clause}
         ${session.setupRequired ? "" : "AND se.academic_year_id = ? AND se.term_id = ?"}
         AND (stm.intervention_needed = 1 OR stm.consecutive_failures >= 3)
       ORDER BY stm.consecutive_failures DESC, stm.mastery_score ASC
       LIMIT 20`,
      [schoolId, classId, ...masterySubjectScope.params, ...(session.setupRequired ? [] : [session.academicYearId, session.termId])],
    )
    interventions = interventionRows.map((row) => ({
      ...row,
      student_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      mastery_score: percentValue(row.mastery_score),
      consecutive_failures: Number(row.consecutive_failures || 0),
      next_review_at: dateOnly(row.next_review_at),
      recommended_action: row.consecutive_failures >= 3
        ? `Use prerequisite recovery and guided reteaching for ${row.topic_name}.`
        : `Give short support practice for ${row.topic_name}.`,
    }))
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error
  }
  try {
    const [warningRows] = await pool.query(
      `SELECT q.id AS question_id, q.question_text, q.question_type, q.difficulty,
        q.times_attempted, q.percent_correct, q.flag_count, subj.name AS subject_name,
        st.topic_name
       FROM question_bank q
       JOIN subjects subj ON subj.id = q.subject_id AND subj.school_id = q.school_id
       JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
       WHERE q.school_id = ?
         AND q.approval_status = 'approved'
         AND q.times_attempted >= 5
         AND (q.percent_correct <= 20 OR q.percent_correct >= 95 OR q.flag_count > 0)${questionSubjectScope.clause}
       ORDER BY q.flag_count DESC, q.times_attempted DESC
       LIMIT 20`,
      [schoolId, ...questionSubjectScope.params],
    )
    questionWarnings = warningRows.map((row) => ({
      ...row,
      warning: Number(row.flag_count || 0) > 0
        ? "Question has been flagged."
        : Number(row.percent_correct || 0) <= 20
          ? "Most learners are failing this question."
          : "Question may be too easy for its level.",
    }))
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error
  }
  const [learnerRows] = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name,
       COUNT(DISTINCT CASE WHEN ds.status = 'completed' THEN ds.id END) AS completed_drills,
       AVG(CASE WHEN ds.status = 'completed' THEN ds.percentage END) AS average_score,
       AVG(CASE WHEN ds.status = 'completed' AND ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN ds.percentage END) AS recent_score,
       AVG(CASE WHEN ds.status = 'completed'
                 AND ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
                 AND ds.scheduled_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                THEN ds.percentage END) AS prior_recent_score,
       COUNT(CASE WHEN dsq.answered_at IS NOT NULL THEN dsq.id END) AS answered_questions,
       SUM(CASE WHEN dsq.answered_at IS NOT NULL AND LENGTH(TRIM(COALESCE(dsq.student_answer, ''))) <= 2 THEN 1 ELSE 0 END) AS blank_answers,
       SUM(CASE WHEN q.question_type IN ('structured', 'essay', 'calculation') AND dsq.answered_at IS NOT NULL THEN 1 ELSE 0 END) AS structured_attempts,
       SUM(CASE WHEN q.question_type IN ('structured', 'essay', 'calculation') AND dsq.is_correct = 1 THEN 1 ELSE 0 END) AS structured_correct,
       MAX(ds.scheduled_date) AS latest_drill_date
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     LEFT JOIN drill_sessions ds ON ds.school_id = se.school_id
      AND ds.student_id = s.id
      AND ds.scheduled_date BETWEEN ? AND ?
      ${summarySubjectScope.clause}
     LEFT JOIN drill_session_questions dsq ON dsq.drill_session_id = ds.id
     LEFT JOIN question_bank q ON q.id = dsq.question_id AND q.school_id = ds.school_id
     WHERE se.school_id = ?
       AND se.class_id = ?
       AND se.enrollment_status = 'active'
       ${session.setupRequired ? "" : "AND se.academic_year_id = ? AND se.term_id = ?"}
     GROUP BY s.id, s.first_name, s.last_name
     ORDER BY average_score DESC, completed_drills DESC, ${studentCodeSortSql("s")}, s.first_name, s.last_name`,
    [drillWindow.start, drillWindow.end, ...summarySubjectScope.params, schoolId, classId, ...(session.setupRequired ? [] : [session.academicYearId, session.termId])],
  )
  const learnerProfiles = learnerRows.map((row) => {
    const recentScore = percentValue(row.recent_score)
    const priorRecentScore = percentValue(row.prior_recent_score)
    const improvement = recentScore !== null && priorRecentScore !== null ? Number((recentScore - priorRecentScore).toFixed(1)) : null
    const base = {
      student_id: Number(row.student_id),
      student_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      completed_drills: Number(row.completed_drills || 0),
      average_score: percentValue(row.average_score),
      recent_score: recentScore,
      prior_recent_score: priorRecentScore,
      improvement_points: improvement,
      answered_questions: Number(row.answered_questions || 0),
      latest_drill_date: dateOnly(row.latest_drill_date),
      structured_attempts: Number(row.structured_attempts || 0),
      structured_correct: Number(row.structured_correct || 0),
      blank_answers: Number(row.blank_answers || 0),
    }
    return { ...base, ...learnerProfileFromDrills(base) }
  })
  const improvementAwards = learnerProfiles
    .filter((row) => Number(row.improvement_points || 0) >= 5)
    .sort((a, b) => Number(b.improvement_points || 0) - Number(a.improvement_points || 0))
    .slice(0, 5)
    .map((row, index) => ({
      ...row,
      award: index === 0 ? "Most improved" : "Improvement award",
    }))
  res.json({
    summary: {
      sessions: Number(summary?.sessions || 0),
      completed: Number(summary?.completed || 0),
      completion_rate: Number(summary?.sessions || 0) ? Number(((Number(summary.completed || 0) / Number(summary.sessions || 1)) * 100).toFixed(1)) : 0,
      average_score: summary?.average_score === null ? null : Number(Number(summary.average_score || 0).toFixed(1)),
    },
    weak_topics: weakTopics,
    missed_students: missed,
    intervention_students: interventions,
    question_quality_warnings: questionWarnings,
    learner_profiles: learnerProfiles,
    improvement_awards: improvementAwards,
    insight: interventions[0]
      ? `${interventions[0].student_name} needs intervention in ${interventions[0].topic_name}. Use prerequisite recovery or a guided reteach before the next drill.`
      : weakTopics[0]
        ? `${weakTopics[0].subject_name}: ${weakTopics[0].weak_students} learner${Number(weakTopics[0].weak_students) === 1 ? "" : "s"} need support in ${weakTopics[0].topic_name}. Consider reteaching this topic.`
        : "No weak drill topic has been detected yet.",
  })
}

export async function getGuardianDrillSummary(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = Number(req.params.studentId || req.params.student_id || 0)
  if (!studentId) throw new HttpError(400, "Student is required")
  const activeSession = await getActiveAcademicSession(schoolId)
  const access = await learnerDrillAccess(req, schoolId, studentId, {
    session: activeSession,
    action: "summary",
  })
  const sessionSubjectScope = scopedInClause(access.allowedSubjectIds, "ds.subject_id")
  const masterySubjectScope = scopedInClause(access.allowedSubjectIds, "stm.subject_id")
  const [sessions] = await pool.query(
    `SELECT ds.*, subj.name AS subject_name, st.topic_name AS focus_topic_name
     FROM drill_sessions ds
     JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = ds.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.student_id = ? AND ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)${sessionSubjectScope.clause}
     ORDER BY ds.scheduled_date DESC`,
    [schoolId, studentId, ...sessionSubjectScope.params],
  )
  const [weak] = await pool.query(
    `SELECT st.topic_name, subj.name AS subject_name, stm.mastery_score
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     WHERE stm.school_id = ? AND stm.student_id = ?${masterySubjectScope.clause}
     ORDER BY stm.mastery_score ASC
     LIMIT 1`,
    [schoolId, studentId, ...masterySubjectScope.params],
  )
  const [strong] = await pool.query(
    `SELECT subj.name AS subject_name, AVG(stm.mastery_score) AS score
     FROM student_topic_mastery stm
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     WHERE stm.school_id = ? AND stm.student_id = ?${masterySubjectScope.clause}
     GROUP BY subj.id, subj.name
     ORDER BY score DESC
     LIMIT 1`,
    [schoolId, studentId, ...masterySubjectScope.params],
  )
  const completed = sessions.filter((row) => row.status === "completed").length
  const missed = sessions.filter((row) => row.status === "missed").length
  res.json({
    sessions,
    summary: {
      completed,
      missed,
      strongest_subject: strong[0]?.subject_name || null,
      weakest_topic: weak[0]?.topic_name || null,
      weakest_subject: weak[0]?.subject_name || null,
      recommended_action: weak[0] ? `Spend 15 minutes revising ${weak[0].topic_name} twice this week.` : "Keep completing daily drills.",
      message: weak[0]
        ? `This learner completed ${completed} of ${sessions.length} drills this week. Strongest area: ${strong[0]?.subject_name || "not enough data yet"}. Needs more practice in ${weak[0].topic_name}.`
        : `This learner completed ${completed} of ${sessions.length} drills this week. Keep the routine going.`,
    },
  })
}

import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { generateDailyDrill, markAnswer, updateMasteryFromAnswer } from "../services/drills/dailyDrillGenerator.js"

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

function studentIdForRequest(req) {
  if (req.user?.role === "student") return Number(req.user.studentId || req.user.id || 0)
  return Number(req.params.studentId || req.params.student_id || req.query.student_id || req.body.student_id || 0)
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
      dsq.marks_awarded, dsq.mistake_type, dsq.answered_at, dsq.reason,
      q.id AS question_id, q.question_type, q.question_text, q.options_json, q.correct_answer,
      q.accepted_answers_json, q.explanation, q.difficulty, q.skill_type, q.marks,
      st.topic_name
     FROM drill_session_questions dsq
     JOIN question_bank q ON q.id = dsq.question_id
     LEFT JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
     WHERE dsq.drill_session_id = ?
     ORDER BY dsq.order_number, dsq.id`,
    [sessionId],
  )
  const canReviewAnswers = Boolean(options.includeAnswers) || session.status === "completed"
  return {
    ...session,
    questions: questions.map((question) => ({
      ...question,
      options_json: parseJson(question.options_json, []),
      is_correct: canReviewAnswers ? question.is_correct : null,
      marks_awarded: canReviewAnswers ? question.marks_awarded : null,
      mistake_type: canReviewAnswers ? question.mistake_type : null,
      correct_answer: canReviewAnswers ? question.correct_answer : null,
      accepted_answers_json: canReviewAnswers ? parseJson(question.accepted_answers_json, []) : [],
      explanation: canReviewAnswers ? question.explanation : null,
    })),
  }
}

export async function listDrills(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ drills: [], session: sessionPayload(session), setup_required: true })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const classScope = scopedInClause(teacherClassIds, "se.class_id")
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
     WHERE ds.school_id = ? AND s.status = 'active'${classScope.clause}
     ORDER BY ds.scheduled_date DESC, ds.created_at DESC
     LIMIT 100`,
    [session.academicYearId, session.termId, schoolId, ...classScope.params],
  )
  res.json({ drills: rows, session: sessionPayload(session), setup_required: false })
}

export async function generateDrillForStudent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const generated = await generateDailyDrill(connection, schoolId, studentId, {
      subjectId: req.body.subject_id || req.query.subject_id,
      topicId: req.body.topic_id || req.query.topic_id,
      scheduledDate: req.body.scheduled_date || req.query.scheduled_date,
      limit: req.body.limit || 5,
    })
    await connection.commit()
    if (!generated.ok) throw new HttpError(409, generated.reason)
    res.status(201).json(generated)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getTodayDrill(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const date = req.query.date || todayIso()
  const [[existing]] = await pool.query(
    `SELECT id FROM drill_sessions
     WHERE school_id = ? AND student_id = ? AND scheduled_date = ?
     ORDER BY FIELD(status, 'in_progress', 'pending', 'completed', 'missed'), id DESC
     LIMIT 1`,
    [schoolId, studentId, date],
  )
  let sessionId = existing?.id
  let generation = null
  if (!sessionId) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      generation = await generateDailyDrill(connection, schoolId, studentId, { scheduledDate: date, limit: 5 })
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
      action_required: generation?.reason || "Not enough approved questions for this topic. Generate AI drafts or upload materials.",
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
    const [[row]] = await connection.query(
      `SELECT ds.student_id, ds.status, dsq.id AS session_question_id, q.*
       FROM drill_sessions ds
       JOIN drill_session_questions dsq ON dsq.drill_session_id = ds.id
       JOIN question_bank q ON q.id = dsq.question_id
       WHERE ds.school_id = ? AND ds.id = ?
         AND (${sessionQuestionId ? "dsq.id = ?" : "q.id = ?"})
       LIMIT 1 FOR UPDATE`,
      [schoolId, sessionId, sessionQuestionId || questionId],
    )
    if (!row) throw new HttpError(404, "Drill question was not found")
    if (req.user.role === "student" && Number(row.student_id) !== Number(req.user.studentId || req.user.id)) {
      throw new HttpError(403, "Students can only answer their own drills")
    }
    if (row.status === "completed") throw new HttpError(409, "This drill has already been submitted")
    const mark = markAnswer(row, answer)
    await connection.query(
      `UPDATE drill_session_questions
       SET student_answer = ?, is_correct = ?, marks_awarded = ?, mistake_type = ?, answered_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [String(answer), mark.is_correct, mark.marks_awarded, mark.mistake_type, row.session_question_id],
    )
    await updateMasteryFromAnswer(connection, schoolId, row.student_id, row, mark)
    await connection.commit()
    res.json({
      ok: true,
      mark: req.user.role === "student"
        ? { teacher_review_required: Boolean(mark.teacher_review_required) }
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
  if (req.user.role === "student" && Number(session.student_id) !== Number(req.user.studentId || req.user.id)) {
    throw new HttpError(403, "Students can only submit their own drills")
  }
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
  const drill = await loadDrillSession(schoolId, sessionId, { includeAnswers: req.user.role !== "student" })
  if (req.user.role === "student" && Number(drill.student_id) !== Number(req.user.studentId || req.user.id)) {
    throw new HttpError(403, "Students can only view their own drills")
  }
  res.json({ drill })
}

export async function getDrillHistory(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = studentIdForRequest(req)
  if (!studentId) throw new HttpError(400, "Student is required")
  const [sessions] = await pool.query(
    `SELECT ds.*, subj.name AS subject_name, st.topic_name AS focus_topic_name
     FROM drill_sessions ds
     JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = ds.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.student_id = ?
     ORDER BY ds.scheduled_date DESC
     LIMIT 60`,
    [schoolId, studentId],
  )
  res.json({ sessions })
}

export async function getTeacherDrillInsights(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.params.classId || req.params.class_id || 0)
  if (!classId) throw new HttpError(400, "Class is required")
  const [[summary]] = await pool.query(
    `SELECT COUNT(DISTINCT ds.id) AS sessions,
      SUM(CASE WHEN ds.status = 'completed' THEN 1 ELSE 0 END) AS completed,
      AVG(ds.percentage) AS average_score
     FROM drill_sessions ds
     JOIN student_enrollments se ON se.student_id = ds.student_id AND se.school_id = ds.school_id
     WHERE ds.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'`,
    [schoolId, classId],
  )
  const [weakTopics] = await pool.query(
    `SELECT st.topic_name, subj.name AS subject_name, COUNT(*) AS weak_students, AVG(stm.mastery_score) AS average_mastery
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     JOIN student_enrollments se ON se.student_id = stm.student_id AND se.school_id = stm.school_id
     WHERE stm.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'
       AND stm.mastery_label IN ('weak', 'developing')
     GROUP BY st.id, st.topic_name, subj.name
     ORDER BY weak_students DESC, average_mastery ASC
     LIMIT 10`,
    [schoolId, classId],
  )
  const [missed] = await pool.query(
    `SELECT s.id, s.first_name, s.last_name, COUNT(ds.id) AS missed_drills
     FROM drill_sessions ds
     JOIN students s ON s.id = ds.student_id AND s.school_id = ds.school_id
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
     WHERE ds.school_id = ? AND se.class_id = ? AND ds.status = 'missed'
     GROUP BY s.id, s.first_name, s.last_name
     ORDER BY missed_drills DESC
     LIMIT 10`,
    [schoolId, classId],
  )
  res.json({
    summary: {
      sessions: Number(summary?.sessions || 0),
      completed: Number(summary?.completed || 0),
      completion_rate: Number(summary?.sessions || 0) ? Number(((Number(summary.completed || 0) / Number(summary.sessions || 1)) * 100).toFixed(1)) : 0,
      average_score: summary?.average_score === null ? null : Number(Number(summary.average_score || 0).toFixed(1)),
    },
    weak_topics: weakTopics,
    missed_students: missed,
    insight: weakTopics[0]
      ? `${weakTopics[0].subject_name}: ${weakTopics[0].weak_students} learner${Number(weakTopics[0].weak_students) === 1 ? "" : "s"} need support in ${weakTopics[0].topic_name}. Consider reteaching this topic.`
      : "No weak drill topic has been detected yet.",
  })
}

export async function getGuardianDrillSummary(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = Number(req.params.studentId || req.params.student_id || 0)
  if (!studentId) throw new HttpError(400, "Student is required")
  const [sessions] = await pool.query(
    `SELECT ds.*, subj.name AS subject_name, st.topic_name AS focus_topic_name
     FROM drill_sessions ds
     JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = ds.school_id
     LEFT JOIN syllabus_topics st ON st.id = ds.focus_topic_id AND st.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.student_id = ? AND ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     ORDER BY ds.scheduled_date DESC`,
    [schoolId, studentId],
  )
  const [weak] = await pool.query(
    `SELECT st.topic_name, subj.name AS subject_name, stm.mastery_score
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     WHERE stm.school_id = ? AND stm.student_id = ?
     ORDER BY stm.mastery_score ASC
     LIMIT 1`,
    [schoolId, studentId],
  )
  const [strong] = await pool.query(
    `SELECT subj.name AS subject_name, AVG(stm.mastery_score) AS score
     FROM student_topic_mastery stm
     JOIN subjects subj ON subj.id = stm.subject_id AND subj.school_id = stm.school_id
     WHERE stm.school_id = ? AND stm.student_id = ?
     GROUP BY subj.id, subj.name
     ORDER BY score DESC
     LIMIT 1`,
    [schoolId, studentId],
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

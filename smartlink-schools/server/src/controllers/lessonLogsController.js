import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import {
  assertTeacherCanUseSubjectInClass,
  getScopedSchoolId,
  getTeacherClassIds,
  isTeacher,
  scopedInClause,
} from "../utils/tenantScope.js"
import { getActiveAcademicSession, requireActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { getLessonLogSuggestions } from "../services/lessons/lessonLogSuggestionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"
import { syncCurriculumFromLesson } from "../services/academicIntelligenceEngine.js"

const coverageStatuses = new Set(["introduced", "partially_taught", "fully_taught", "revised", "assessed", "postponed"])
const lessonOutcomes = new Set(["students_understood", "mixed_understanding", "students_struggled", "not_assessed"])
const difficultyLevels = new Set(["none", "low", "medium", "high"])
const lessonStatuses = new Set(["draft", "finalized", "reopened", "cancelled"])
const topicRoles = new Set(["main", "supporting", "prerequisite", "revision"])
const priorityOverrides = new Set(["low", "normal", "high"])
const objectiveStatuses = new Set(["not_started", "partially_achieved", "achieved", "not_assessed"])
const studentStatuses = new Set(["understood", "needs_support", "absent", "not_assessed"])

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function idValue(value, fallback = null) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function intRange(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function enumValue(value, allowed, fallback) {
  const normalized = cleanText(value || fallback)
  return allowed.has(normalized) ? normalized : fallback
}

function isAcademicLeader(req) {
  return ["super_admin", "school_owner", "headteacher", "academic_admin", "school_admin"].includes(String(req.user?.role || "").toLowerCase())
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

function normalizeTopics(payload) {
  const rows = []
  const mainTopicId = idValue(payload.main_topic_id || payload.mainTopicId)
  if (mainTopicId) {
    rows.push({
      syllabus_topic_id: mainTopicId,
      syllabus_subtopic_id: null,
      topic_role: "main",
      coverage_percentage: intRange(payload.coverage_percentage, null, 0, 100),
      difficulty_observed: enumValue(payload.difficulty_observed, difficultyLevels, "none"),
      drill_priority_override: payload.drill_priority_override && priorityOverrides.has(payload.drill_priority_override) ? payload.drill_priority_override : "normal",
    })
  }

  const subtopicIds = Array.isArray(payload.subtopic_ids || payload.subtopicIds)
    ? (payload.subtopic_ids || payload.subtopicIds)
    : []
  subtopicIds.forEach((value) => {
    const subtopicId = idValue(value)
    if (!subtopicId) return
    rows.push({
      syllabus_topic_id: mainTopicId || subtopicId,
      syllabus_subtopic_id: mainTopicId ? subtopicId : null,
      topic_role: "supporting",
      coverage_percentage: intRange(payload.coverage_percentage, null, 0, 100),
      difficulty_observed: enumValue(payload.difficulty_observed, difficultyLevels, "none"),
      drill_priority_override: "normal",
    })
  })

  const explicit = Array.isArray(payload.topics) ? payload.topics : []
  explicit.forEach((topic) => {
    const topicId = idValue(topic.syllabus_topic_id || topic.topic_id || topic.id)
    const subtopicId = idValue(topic.syllabus_subtopic_id || topic.subtopic_id)
    if (!topicId && !subtopicId) return
    rows.push({
      syllabus_topic_id: topicId || subtopicId,
      syllabus_subtopic_id: subtopicId || null,
      topic_role: enumValue(topic.topic_role || topic.role, topicRoles, topicId === mainTopicId ? "main" : "supporting"),
      coverage_percentage: topic.coverage_percentage === null || topic.coverage_percentage === undefined
        ? null
        : intRange(topic.coverage_percentage, null, 0, 100),
      difficulty_observed: topic.difficulty_observed && difficultyLevels.has(topic.difficulty_observed) ? topic.difficulty_observed : null,
      drill_priority_override: topic.drill_priority_override && priorityOverrides.has(topic.drill_priority_override) ? topic.drill_priority_override : null,
    })
  })

  const seen = new Set()
  return rows.filter((row) => {
    const key = `${row.syllabus_topic_id}:${row.syllabus_subtopic_id || ""}:${row.topic_role}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeObjectives(payload) {
  const raw = Array.isArray(payload.objectives || payload.objective_ids || payload.objectiveIds)
    ? (payload.objectives || payload.objective_ids || payload.objectiveIds)
    : []
  return raw
    .map((item) => ({
      learning_objective_id: idValue(typeof item === "object" ? item.learning_objective_id || item.objective_id || item.id : item),
      achievement_status: enumValue(typeof item === "object" ? item.achievement_status : null, objectiveStatuses, "not_assessed"),
    }))
    .filter((item) => item.learning_objective_id)
}

function normalizeStudentExceptions(payload) {
  const raw = Array.isArray(payload.student_exceptions || payload.students) ? (payload.student_exceptions || payload.students) : []
  return raw
    .map((item) => ({
      student_id: idValue(item.student_id || item.id),
      understanding_status: enumValue(item.understanding_status || item.status, studentStatuses, "not_assessed"),
      teacher_note: cleanText(item.teacher_note || item.note) || null,
    }))
    .filter((item) => item.student_id)
}

function lessonLogFields(payload, session, req) {
  const status = enumValue(payload.status, lessonStatuses, "draft")
  const coverageStatus = enumValue(payload.coverage_status, coverageStatuses, "introduced")
  return {
    academic_year_id: idValue(payload.academic_year_id) || session.academicYearId,
    term_id: idValue(payload.term_id) || session.termId,
    teacher_id: idValue(payload.teacher_id) || req.user.id,
    class_id: idValue(payload.class_id),
    subject_id: idValue(payload.subject_id),
    timetable_entry_id: idValue(payload.timetable_entry_id),
    lesson_date: cleanText(payload.lesson_date || todayIso()),
    started_at: cleanText(payload.started_at) || null,
    ended_at: cleanText(payload.ended_at) || null,
    status,
    main_topic_id: idValue(payload.main_topic_id || payload.mainTopicId),
    coverage_status: coverageStatus,
    coverage_percentage: coverageStatus === "postponed" ? 0 : intRange(payload.coverage_percentage, 0, 0, 100),
    lesson_outcome: enumValue(payload.lesson_outcome, lessonOutcomes, "not_assessed"),
    difficulty_observed: enumValue(payload.difficulty_observed, difficultyLevels, "none"),
    lesson_notes: cleanText(payload.lesson_notes) || null,
    misconceptions_observed: cleanText(payload.misconceptions_observed) || null,
    homework_assigned: cleanText(payload.homework_assigned) || null,
    recommended_drill_focus: cleanText(payload.recommended_drill_focus) || null,
    next_lesson_action: cleanText(payload.next_lesson_action) || null,
  }
}

async function audit(connection, schoolId, lessonLogId, actorUserId, action, previousValues, newValues) {
  await connection.query(
    `INSERT INTO lesson_log_audit_events (school_id, lesson_log_id, actor_user_id, action, previous_values_json, new_values_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      lessonLogId,
      actorUserId,
      action,
      previousValues ? JSON.stringify(previousValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ],
  )
}

async function assertTopicsBelongToScope(connection, schoolId, subjectId, topicRows) {
  const ids = [
    ...new Set(topicRows.flatMap((row) => [row.syllabus_topic_id, row.syllabus_subtopic_id]).filter(Boolean).map(Number)),
  ]
  if (!ids.length) return
  const [rows] = await connection.query(
    `SELECT id,parent_topic_id FROM syllabus_topics
     WHERE school_id = ? AND subject_id = ? AND is_active = 1
       AND id IN (${ids.map(() => "?").join(",")})`,
    [schoolId, subjectId, ...ids],
  )
  if (rows.length !== ids.length) throw new HttpError(400, "One or more selected topics do not belong to this subject.")
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  for (const topic of topicRows) {
    if (topic.syllabus_subtopic_id && Number(byId.get(Number(topic.syllabus_subtopic_id))?.parent_topic_id) !== Number(topic.syllabus_topic_id)) {
      throw new HttpError(400, "One or more selected subtopics do not belong to their main topic.")
    }
  }
}

async function assertObjectivesBelongToScope(connection, schoolId, subjectId, topicIds, objectiveRows) {
  const ids = [...new Set(objectiveRows.map((row) => Number(row.learning_objective_id)).filter(Boolean))]
  if (!ids.length) return
  if (!topicIds.length) throw new HttpError(400, "Select a lesson topic before selecting learning objectives.")
  const [rows] = await connection.query(
    `SELECT id FROM learning_objectives
     WHERE school_id = ? AND subject_id = ? AND is_active = 1
       AND topic_id IN (${topicIds.map(() => "?").join(",")})
       AND id IN (${ids.map(() => "?").join(",")})`,
    [schoolId, subjectId, ...topicIds, ...ids],
  )
  if (rows.length !== ids.length) throw new HttpError(400, "One or more selected learning objectives do not belong to this subject.")
}

async function assertStudentsBelongToClass(connection, schoolId, scope, studentRows) {
  const ids = [...new Set(studentRows.map((row) => Number(row.student_id)).filter(Boolean))]
  if (!ids.length) return
  const [rows] = await connection.query(
    `SELECT DISTINCT student.id
     FROM students student
     JOIN student_enrollments enrollment
       ON enrollment.school_id = student.school_id AND enrollment.student_id = student.id
     WHERE student.school_id = ? AND enrollment.class_id = ?
       AND enrollment.academic_year_id = ? AND enrollment.term_id = ?
       AND enrollment.enrollment_status = 'active'
       AND student.id IN (${ids.map(() => "?").join(",")})`,
    [schoolId, scope.class_id, scope.academic_year_id, scope.term_id, ...ids],
  )
  if (rows.length !== ids.length) throw new HttpError(400, "One or more selected learners are not enrolled in this class for the active session.")
}

async function assertLessonLogEntityScope(connection, schoolId, scope) {
  const [[validScope]] = await connection.query(`SELECT class.id
    FROM classes class
    JOIN subjects subject ON subject.school_id=class.school_id AND subject.id=?
    JOIN users teacher ON teacher.school_id=class.school_id AND teacher.id=?
      AND teacher.role IN ('teacher','headteacher') AND teacher.is_active=1 AND teacher.employment_status='active'
    JOIN academic_years academic_year ON academic_year.school_id=class.school_id AND academic_year.id=?
    JOIN terms term ON term.school_id=class.school_id AND term.id=? AND term.academic_year_id=academic_year.id
    WHERE class.school_id=? AND class.id=? LIMIT 1`, [scope.subject_id, scope.teacher_id,
    scope.academic_year_id, scope.term_id, schoolId, scope.class_id])
  if (!validScope) throw new HttpError(400, "The lesson teacher, class, subject or academic session does not belong to this school.")
  if (!scope.timetable_entry_id) return
  const [[period]] = await connection.query(`SELECT entry.id FROM timetable_entries entry
    JOIN timetable_versions version ON version.id=entry.timetable_version_id
    JOIN timetables timetable ON timetable.id=version.timetable_id AND timetable.school_id=?
    WHERE entry.id=? AND entry.teacher_id=? AND entry.class_id=? AND entry.subject_id=? LIMIT 1`,
  [schoolId, scope.timetable_entry_id, scope.teacher_id, scope.class_id, scope.subject_id])
  if (!period) throw new HttpError(400, "The selected timetable period does not belong to this lesson's school, teacher, class and subject.")
}

async function replaceLessonChildren(connection, schoolId, lessonLogId, scope, payload) {
  const topicRows = normalizeTopics(payload)
  const topicsForValidation = scope.main_topic_id
    ? [{ syllabus_topic_id: scope.main_topic_id, syllabus_subtopic_id: null }, ...topicRows]
    : topicRows
  await assertTopicsBelongToScope(connection, schoolId, scope.subject_id, topicsForValidation)
  const objectives = normalizeObjectives(payload)
  const objectiveTopicIds = [...new Set([scope.main_topic_id, ...topicRows.flatMap((row) => [row.syllabus_topic_id, row.syllabus_subtopic_id])].map(Number).filter(Boolean))]
  await assertObjectivesBelongToScope(connection, schoolId, scope.subject_id, objectiveTopicIds, objectives)
  const studentRows = normalizeStudentExceptions(payload)
  await assertStudentsBelongToClass(connection, schoolId, scope, studentRows)
  await connection.query("DELETE FROM teacher_lesson_log_topics WHERE lesson_log_id = ?", [lessonLogId])
  for (const topic of topicRows) {
    await connection.query(
      `INSERT INTO teacher_lesson_log_topics (
        lesson_log_id, syllabus_topic_id, syllabus_subtopic_id, topic_role, coverage_percentage, difficulty_observed, drill_priority_override
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lessonLogId,
        topic.syllabus_topic_id,
        topic.syllabus_subtopic_id,
        topic.topic_role,
        topic.coverage_percentage,
        topic.difficulty_observed,
        topic.drill_priority_override,
      ],
    )
  }

  await connection.query("DELETE FROM teacher_lesson_log_objectives WHERE lesson_log_id = ?", [lessonLogId])
  for (const objective of objectives) {
    await connection.query(
      `INSERT INTO teacher_lesson_log_objectives (lesson_log_id, learning_objective_id, achievement_status)
       VALUES (?, ?, ?)`,
      [lessonLogId, objective.learning_objective_id, objective.achievement_status],
    )
  }

  await connection.query("DELETE FROM teacher_lesson_log_students WHERE lesson_log_id = ?", [lessonLogId])
  for (const row of studentRows) {
    await connection.query(
      `INSERT INTO teacher_lesson_log_students (lesson_log_id, student_id, understanding_status, teacher_note)
       VALUES (?, ?, ?, ?)`,
      [lessonLogId, row.student_id, row.understanding_status, row.teacher_note],
    )
  }
}

async function loadLessonLogById(connection, schoolId, lessonLogId) {
  const [[log]] = await connection.query(
    `SELECT l.*, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name,
      st.topic_name AS main_topic_name
     FROM teacher_lesson_logs l
     JOIN classes c ON c.id = l.class_id AND c.school_id = l.school_id
     JOIN subjects subj ON subj.id = l.subject_id AND subj.school_id = l.school_id
     JOIN users u ON u.id = l.teacher_id AND u.school_id = l.school_id
     LEFT JOIN syllabus_topics st ON st.id = l.main_topic_id AND st.school_id = l.school_id
     WHERE l.school_id = ? AND l.id = ?
     LIMIT 1`,
    [schoolId, lessonLogId],
  )
  if (!log) throw new HttpError(404, "Lesson log was not found")

  const [topics] = await connection.query(
    `SELECT tlt.*, topic.topic_name, subtopic.topic_name AS subtopic_name
     FROM teacher_lesson_log_topics tlt
     JOIN teacher_lesson_logs scoped_log ON scoped_log.id = tlt.lesson_log_id AND scoped_log.school_id = ?
     JOIN syllabus_topics topic ON topic.id = tlt.syllabus_topic_id AND topic.school_id = scoped_log.school_id AND topic.subject_id = scoped_log.subject_id
     LEFT JOIN syllabus_topics subtopic ON subtopic.id = tlt.syllabus_subtopic_id AND subtopic.school_id = scoped_log.school_id AND subtopic.subject_id = scoped_log.subject_id AND subtopic.parent_topic_id = topic.id
     WHERE tlt.lesson_log_id = ?
     ORDER BY FIELD(tlt.topic_role, 'main', 'supporting', 'revision', 'prerequisite'), tlt.id`,
    [schoolId, lessonLogId],
  )
  const [objectives] = await connection.query(
     `SELECT tlo.*, lo.objective_text, lo.skill_type
     FROM teacher_lesson_log_objectives tlo
     JOIN teacher_lesson_logs scoped_log ON scoped_log.id = tlo.lesson_log_id AND scoped_log.school_id = ?
     JOIN learning_objectives lo ON lo.id = tlo.learning_objective_id AND lo.school_id = scoped_log.school_id AND lo.subject_id = scoped_log.subject_id
     WHERE tlo.lesson_log_id = ? AND (lo.topic_id = scoped_log.main_topic_id OR EXISTS (
       SELECT 1 FROM teacher_lesson_log_topics scoped_topic
       WHERE scoped_topic.lesson_log_id = scoped_log.id
         AND lo.topic_id IN (scoped_topic.syllabus_topic_id,scoped_topic.syllabus_subtopic_id)
     ))
     ORDER BY tlo.id`,
    [schoolId, lessonLogId],
  )
  const [students] = await connection.query(
     `SELECT tls.*, s.first_name, s.last_name, s.admission_no
     FROM teacher_lesson_log_students tls
     JOIN teacher_lesson_logs scoped_log ON scoped_log.id = tls.lesson_log_id AND scoped_log.school_id = ?
     JOIN students s ON s.id = tls.student_id AND s.school_id = scoped_log.school_id
     WHERE tls.lesson_log_id = ? AND EXISTS (
       SELECT 1 FROM student_enrollments enrollment
       WHERE enrollment.school_id = scoped_log.school_id AND enrollment.student_id = s.id
         AND enrollment.class_id = scoped_log.class_id
         AND enrollment.academic_year_id = scoped_log.academic_year_id AND enrollment.term_id = scoped_log.term_id
         AND enrollment.enrollment_status = 'active'
     )
     ORDER BY ${studentCodeSortSql("s")}, s.first_name, s.last_name`,
    [schoolId, lessonLogId],
  )
  const [auditEvents] = await connection.query(
    `SELECT a.*, u.full_name AS actor_name
     FROM lesson_log_audit_events a
     JOIN users u ON u.id = a.actor_user_id AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.lesson_log_id = ?
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 25`,
    [schoolId, lessonLogId],
  )

  return {
    ...log,
    topics,
    objectives,
    student_exceptions: students,
    audit_events: auditEvents.map((event) => ({
      ...event,
      previous_values_json: parseJson(event.previous_values_json, null),
      new_values_json: parseJson(event.new_values_json, null),
    })),
  }
}

async function assertCanReadLessonLog(req, schoolId, log) {
  if (!isTeacher(req)) return
  if (Number(log.teacher_id) === Number(req.user.id)) return
  const classIds = await getTeacherClassIds(req, schoolId)
  if (classIds.map(Number).includes(Number(log.class_id))) return
  throw new HttpError(403, "Teachers can only view lesson logs for their assigned classes.")
}

async function assertCanEditLessonLog(req, log) {
  if (isAcademicLeader(req)) return
  if (Number(log.teacher_id) !== Number(req.user.id)) throw new HttpError(403, "Teachers can only edit their own lesson logs.")
  if (log.status === "finalized") throw new HttpError(409, "Finalized lesson logs must be reopened before editing.")
}

function listFilterClause(req, schoolId) {
  const where = ["l.school_id = ?"]
  const params = [schoolId]
  const filters = [
    ["class_id", "l.class_id"],
    ["subject_id", "l.subject_id"],
    ["teacher_id", "l.teacher_id"],
    ["term_id", "l.term_id"],
    ["status", "l.status"],
  ]
  filters.forEach(([queryKey, column]) => {
    if (!req.query[queryKey]) return
    where.push(`${column} = ?`)
    params.push(req.query[queryKey])
  })
  if (req.query.from_date) {
    where.push("l.lesson_date >= ?")
    params.push(req.query.from_date)
  }
  if (req.query.to_date) {
    where.push("l.lesson_date <= ?")
    params.push(req.query.to_date)
  }
  return { where, params }
}

export async function getTeacherToday(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({
      session: sessionPayload(session),
      scheduled_lessons: [],
      logs: [],
      summary: { scheduled: 0, logged: 0, missing: 0, drafts: 0, finalized: 0, drills_generated: 0 },
      reminders: [session.message],
    })
  }

  const connection = pool
  const suggestions = await getLessonLogSuggestions(connection, schoolId, req.user, session, { lesson_date: todayIso() })
  const assignments = suggestions.assignments || []
  const classIds = isTeacher(req) ? await getTeacherClassIds(req, schoolId) : null
  const classScope = scopedInClause(classIds, "l.class_id")
  const [logs] = await pool.query(
    `SELECT l.*, c.name AS class_name, subj.name AS subject_name, st.topic_name AS main_topic_name
     FROM teacher_lesson_logs l
     JOIN classes c ON c.id = l.class_id AND c.school_id = l.school_id
     JOIN subjects subj ON subj.id = l.subject_id AND subj.school_id = l.school_id
     LEFT JOIN syllabus_topics st ON st.id = l.main_topic_id AND st.school_id = l.school_id
     WHERE l.school_id = ? AND l.lesson_date = ?${classScope.clause}
     ORDER BY l.created_at DESC`,
    [schoolId, todayIso(), ...classScope.params],
  )
  const logKey = new Map(logs.map((log) => [`${log.class_id}:${log.subject_id}`, log]))
  const scheduledLessons = assignments.map((assignment) => {
    const log = logKey.get(`${assignment.class_id}:${assignment.subject_id}`) || null
    return {
      ...assignment,
      lesson_date: todayIso(),
      log_id: log?.id || null,
      log_status: log?.status || "not_logged",
      coverage_status: log?.coverage_status || "",
      planned_topic_name: "",
      quick_action: log ? "Open lesson log" : "Log lesson",
    }
  })
  const [drills] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM drill_sessions ds
     JOIN student_enrollments se ON se.student_id = ds.student_id AND se.school_id = ds.school_id
     WHERE ds.school_id = ? AND ds.scheduled_date = ?
       AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'`,
    [schoolId, todayIso(), session.academicYearId, session.termId],
  )
  const draftCount = logs.filter((log) => log.status === "draft" || log.status === "reopened").length
  const finalizedCount = logs.filter((log) => log.status === "finalized").length
  const missing = Math.max(0, scheduledLessons.length - logs.length)
  const reminders = []
  if (missing) reminders.push(`${missing} assigned lesson${missing === 1 ? "" : "s"} still need a lesson log today.`)
  if (draftCount) reminders.push(`${draftCount} draft lesson log${draftCount === 1 ? "" : "s"} will not influence Daily Drills until finalized.`)
  res.json({
    session: sessionPayload(session),
    scheduled_lessons: scheduledLessons,
    logs,
    summary: {
      scheduled: scheduledLessons.length,
      logged: logs.length,
      missing,
      drafts: draftCount,
      finalized: finalizedCount,
      drills_generated: Number(drills[0]?.total || 0),
    },
    reminders,
  })
}

export async function getLessonLogSuggestionsController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const suggestions = await getLessonLogSuggestions(pool, schoolId, req.user, session, req.query)
  res.json({ session: sessionPayload(session), suggestions })
}

export async function listLessonLogs(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { where, params } = listFilterClause(req, schoolId)
  if (isTeacher(req)) {
    const classIds = await getTeacherClassIds(req, schoolId)
    const classScope = scopedInClause(classIds, "l.class_id")
    where.push(`(l.teacher_id = ?${classScope.clause ? ` OR ${classScope.clause.slice(5)}` : ""})`)
    params.push(req.user.id, ...classScope.params)
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)))
  const [rows] = await pool.query(
    `SELECT l.*, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name,
      st.topic_name AS main_topic_name
     FROM teacher_lesson_logs l
     JOIN classes c ON c.id = l.class_id AND c.school_id = l.school_id
     JOIN subjects subj ON subj.id = l.subject_id AND subj.school_id = l.school_id
     JOIN users u ON u.id = l.teacher_id
     LEFT JOIN syllabus_topics st ON st.id = l.main_topic_id AND st.school_id = l.school_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.lesson_date DESC, l.updated_at DESC
     LIMIT ?`,
    [...params, limit],
  )
  res.json({ lesson_logs: rows })
}

export async function getLessonLog(req, res) {
  const schoolId = getScopedSchoolId(req)
  const lessonLogId = Number(req.params.id || 0)
  const log = await loadLessonLogById(pool, schoolId, lessonLogId)
  await assertCanReadLessonLog(req, schoolId, log)
  res.json({ lesson_log: log })
}

export async function createLessonLog(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await requireActiveAcademicSession(schoolId)
  const fields = lessonLogFields(req.body, session, req)
  fields.academic_year_id = session.academicYearId
  fields.term_id = session.termId
  if (!fields.class_id || !fields.subject_id) throw new HttpError(400, "Class and subject are required.")
  if (isTeacher(req) && Number(fields.teacher_id) !== Number(req.user.id)) throw new HttpError(403, "Teachers can only create their own lesson logs.")
  await assertTeacherCanUseSubjectInClass(req, schoolId, fields.class_id, fields.subject_id)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await assertLessonLogEntityScope(connection, schoolId, fields)
    const shouldFinalize = Boolean(req.body.finalize)
    const status = shouldFinalize ? "finalized" : fields.status === "finalized" ? "draft" : fields.status
    const [result] = await connection.query(
      `INSERT INTO teacher_lesson_logs (
        school_id, academic_year_id, term_id, teacher_id, class_id, subject_id, timetable_entry_id,
        lesson_date, started_at, ended_at, status, main_topic_id, coverage_status, coverage_percentage,
        lesson_outcome, difficulty_observed, lesson_notes, misconceptions_observed, homework_assigned,
        recommended_drill_focus, next_lesson_action, finalized_at, finalized_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${shouldFinalize ? "CURRENT_TIMESTAMP" : "NULL"}, ?)`,
      [
        schoolId,
        fields.academic_year_id,
        fields.term_id,
        fields.teacher_id,
        fields.class_id,
        fields.subject_id,
        fields.timetable_entry_id,
        fields.lesson_date,
        fields.started_at,
        fields.ended_at,
        status,
        fields.main_topic_id,
        fields.coverage_status,
        fields.coverage_percentage,
        fields.lesson_outcome,
        fields.difficulty_observed,
        fields.lesson_notes,
        fields.misconceptions_observed,
        fields.homework_assigned,
        fields.recommended_drill_focus,
        fields.next_lesson_action,
        shouldFinalize ? req.user.id : null,
      ],
    )
    const lessonLogId = Number(result.insertId)
    await replaceLessonChildren(connection, schoolId, lessonLogId, fields, req.body)
    await audit(connection, schoolId, lessonLogId, req.user.id, "created", null, { ...fields, status })
    if (shouldFinalize) await audit(connection, schoolId, lessonLogId, req.user.id, "finalized", null, { status: "finalized" })
    await connection.commit()
    res.status(201).json({ lesson_log: await loadLessonLogById(pool, schoolId, lessonLogId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateLessonLog(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const lessonLogId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const existing = await loadLessonLogById(connection, schoolId, lessonLogId)
    await assertCanEditLessonLog(req, existing)
    const fields = lessonLogFields({ ...existing, ...req.body }, session, req)
    if (isTeacher(req) && Number(fields.teacher_id) !== Number(req.user.id)) throw new HttpError(403, "Teachers can only keep lesson logs under their own account.")
    await assertTeacherCanUseSubjectInClass(req, schoolId, fields.class_id, fields.subject_id)
    await assertLessonLogEntityScope(connection, schoolId, fields)
    await connection.query(
      `UPDATE teacher_lesson_logs
       SET teacher_id = ?, class_id = ?, subject_id = ?, timetable_entry_id = ?, lesson_date = ?,
         started_at = ?, ended_at = ?, main_topic_id = ?, coverage_status = ?, coverage_percentage = ?,
         lesson_outcome = ?, difficulty_observed = ?, lesson_notes = ?, misconceptions_observed = ?,
         homework_assigned = ?, recommended_drill_focus = ?, next_lesson_action = ?,
         status = IF(status = 'reopened', 'reopened', ?)
       WHERE school_id = ? AND id = ?`,
      [
        fields.teacher_id,
        fields.class_id,
        fields.subject_id,
        fields.timetable_entry_id,
        fields.lesson_date,
        fields.started_at,
        fields.ended_at,
        fields.main_topic_id,
        fields.coverage_status,
        fields.coverage_percentage,
        fields.lesson_outcome,
        fields.difficulty_observed,
        fields.lesson_notes,
        fields.misconceptions_observed,
        fields.homework_assigned,
        fields.recommended_drill_focus,
        fields.next_lesson_action,
        fields.status === "finalized" ? "draft" : fields.status,
        schoolId,
        lessonLogId,
      ],
    )
    await replaceLessonChildren(connection, schoolId, lessonLogId, fields, req.body)
    await audit(connection, schoolId, lessonLogId, req.user.id, "updated", existing, fields)
    await connection.commit()
    res.json({ lesson_log: await loadLessonLogById(pool, schoolId, lessonLogId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function finalizeLessonLog(req, res) {
  const schoolId = getScopedSchoolId(req)
  const lessonLogId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const existing = await loadLessonLogById(connection, schoolId, lessonLogId)
    await assertCanEditLessonLog(req, existing)
    if (existing.coverage_status !== "postponed" && !existing.main_topic_id && !existing.topics.length) {
      throw new HttpError(400, "Select at least one approved syllabus topic before finalizing.")
    }
    await connection.query(
      `UPDATE teacher_lesson_logs
       SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP, finalized_by = ?, reopened_at = NULL, reopened_by = NULL
       WHERE school_id = ? AND id = ?`,
      [req.user.id, schoolId, lessonLogId],
    )
    await audit(connection, schoolId, lessonLogId, req.user.id, "finalized", { status: existing.status }, { status: "finalized" })
    await connection.commit()
    const curriculumUpdate = await syncCurriculumFromLesson(schoolId, lessonLogId, req.user).catch((error) => ({ updated: false, warning: error.message }))
    res.json({
      lesson_log: await loadLessonLogById(pool, schoolId, lessonLogId),
      drill_generation_available: true,
      curriculum_update: curriculumUpdate,
      message: "Lesson log finalized. Daily Drills can now use the taught topic.",
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function reopenLessonLog(req, res) {
  if (!isAcademicLeader(req)) throw new HttpError(403, "Only academic leaders can reopen finalized lesson logs.")
  const schoolId = getScopedSchoolId(req)
  const lessonLogId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const existing = await loadLessonLogById(connection, schoolId, lessonLogId)
    await connection.query(
      `UPDATE teacher_lesson_logs
       SET status = 'reopened', reopened_at = CURRENT_TIMESTAMP, reopened_by = ?
       WHERE school_id = ? AND id = ?`,
      [req.user.id, schoolId, lessonLogId],
    )
    await audit(connection, schoolId, lessonLogId, req.user.id, "reopened", { status: existing.status }, { status: "reopened" })
    await connection.commit()
    res.json({ lesson_log: await loadLessonLogById(pool, schoolId, lessonLogId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function cancelLessonLog(req, res) {
  const schoolId = getScopedSchoolId(req)
  const lessonLogId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const existing = await loadLessonLogById(connection, schoolId, lessonLogId)
    await assertCanEditLessonLog(req, existing)
    const reason = cleanText(req.body.reason || req.body.notes || existing.next_lesson_action)
    await connection.query(
      `UPDATE teacher_lesson_logs
       SET status = 'cancelled', coverage_status = 'postponed', coverage_percentage = 0,
         next_lesson_action = COALESCE(?, next_lesson_action)
       WHERE school_id = ? AND id = ?`,
      [reason || null, schoolId, lessonLogId],
    )
    await audit(connection, schoolId, lessonLogId, req.user.id, "cancelled", { status: existing.status }, { status: "cancelled", reason })
    await connection.commit()
    res.json({ lesson_log: await loadLessonLogById(pool, schoolId, lessonLogId) })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getClassLessonHistory(req, res) {
  req.query.class_id = req.params.classId
  req.query.subject_id = req.params.subjectId
  req.query.limit = req.query.limit || 80
  return listLessonLogs(req, res)
}

export async function getClassSubjectCoverage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const classId = Number(req.params.classId || req.query.class_id || 0)
  const subjectId = Number(req.params.subjectId || req.query.subject_id || 0)
  if (!classId || !subjectId) throw new HttpError(400, "Class and subject are required.")
  await assertTeacherCanUseSubjectInClass(req, schoolId, classId, subjectId)
  const session = await getActiveAcademicSession(schoolId)
  const params = [schoolId, classId, subjectId]
  let planClause = ""
  if (!session.setupRequired) {
    planClause = " AND (ttp.start_date BETWEEN ? AND ? OR ttp.end_date BETWEEN ? AND ? OR ttp.end_date IS NULL)"
    params.push(session.term.start_date, session.term.end_date, session.term.start_date, session.term.end_date)
  }
  const [planned] = await pool.query(
    `SELECT ttp.id AS plan_id, ttp.topic_id, st.topic_name, ttp.start_date, ttp.end_date, ttp.is_current
     FROM teacher_topic_plan ttp
     JOIN syllabus_topics st ON st.id = ttp.topic_id AND st.school_id = ttp.school_id
     WHERE ttp.school_id = ? AND ttp.class_id = ? AND ttp.subject_id = ?${planClause}
     ORDER BY ttp.start_date, st.order_number, st.topic_name`,
    params,
  )
  const actualParams = [schoolId, classId, subjectId]
  let actualClause = ""
  if (!session.setupRequired) {
    actualClause = " AND l.term_id = ?"
    actualParams.push(session.termId)
  }
  const [actual] = await pool.query(
    `SELECT l.id AS lesson_log_id, l.lesson_date, l.coverage_status, l.coverage_percentage,
      l.lesson_outcome, l.difficulty_observed, l.lesson_notes, l.main_topic_id AS topic_id,
      st.topic_name, COUNT(DISTINCT q.id) AS approved_question_count
     FROM teacher_lesson_logs l
     LEFT JOIN syllabus_topics st ON st.id = l.main_topic_id AND st.school_id = l.school_id
     LEFT JOIN question_bank q ON q.school_id = l.school_id AND q.subject_id = l.subject_id
      AND q.approval_status = 'approved' AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
      AND (q.topic_id = l.main_topic_id OR q.subtopic_id = l.main_topic_id)
     WHERE l.school_id = ? AND l.class_id = ? AND l.subject_id = ?
       AND l.status = 'finalized' AND l.coverage_status <> 'postponed'${actualClause}
     GROUP BY l.id, l.lesson_date, l.coverage_status, l.coverage_percentage, l.lesson_outcome,
       l.difficulty_observed, l.lesson_notes, l.main_topic_id, st.topic_name
     ORDER BY l.lesson_date DESC`,
    actualParams,
  )
  const actualByTopic = new Map(actual.map((row) => [Number(row.topic_id || 0), row]))
  const today = todayIso()
  const rows = planned.map((row) => {
    const taught = actualByTopic.get(Number(row.topic_id)) || null
    const delayed = !taught && row.end_date && String(row.end_date).slice(0, 10) < today
    return {
      ...row,
      actual_lesson_log_id: taught?.lesson_log_id || null,
      actual_taught_date: taught?.lesson_date || null,
      actual_coverage_status: taught?.coverage_status || (delayed ? "delayed" : "planned"),
      actual_coverage_percentage: taught?.coverage_percentage || 0,
      teacher_notes: taught?.lesson_notes || "",
      approved_question_count: Number(taught?.approved_question_count || 0),
      assessment_readiness: Number(taught?.approved_question_count || 0) >= 5 ? "ready" : "needs_questions",
    }
  })
  const unplannedActual = actual.filter((row) => row.topic_id && !planned.some((plan) => Number(plan.topic_id) === Number(row.topic_id)))
  const completedCount = rows.filter((row) => ["fully_taught", "revised", "assessed"].includes(row.actual_coverage_status)).length
  const averageCoverage = actual.length
    ? Number((actual.reduce((sum, row) => sum + Number(row.coverage_percentage || 0), 0) / actual.length).toFixed(1))
    : 0
  res.json({
    session: sessionPayload(session),
    coverage: {
      class_id: classId,
      subject_id: subjectId,
      planned_topics: planned,
      actual_logs: actual,
      timeline: rows,
      unplanned_actual: unplannedActual,
      summary: {
        planned_count: planned.length,
        finalized_lessons: actual.length,
        completed_planned_topics: completedCount,
        delayed_count: rows.filter((row) => row.actual_coverage_status === "delayed").length,
        average_coverage_percentage: averageCoverage,
        term_syllabus_covered_percentage: planned.length ? Number(((completedCount / planned.length) * 100).toFixed(1)) : 0,
      },
    },
  })
}

export async function getAcademicCoverage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const classIds = isTeacher(req) ? await getTeacherClassIds(req, schoolId) : null
  const classScope = scopedInClause(classIds, "l.class_id")
  const [rows] = await pool.query(
    `SELECT c.id AS class_id, c.name AS class_name, subj.id AS subject_id, subj.name AS subject_name,
      COUNT(DISTINCT l.id) AS finalized_lessons,
      COUNT(DISTINCT l.main_topic_id) AS taught_topics,
      AVG(l.coverage_percentage) AS average_coverage,
      SUM(CASE WHEN l.lesson_outcome = 'students_struggled' THEN 1 ELSE 0 END) AS struggling_lessons
     FROM teacher_lesson_logs l
     JOIN classes c ON c.id = l.class_id AND c.school_id = l.school_id
     JOIN subjects subj ON subj.id = l.subject_id AND subj.school_id = l.school_id
     WHERE l.school_id = ? AND l.status = 'finalized'
       ${session.setupRequired ? "" : "AND l.term_id = ?"}${classScope.clause}
     GROUP BY c.id, c.name, subj.id, subj.name
     ORDER BY c.name, subj.name`,
    [schoolId, ...(session.setupRequired ? [] : [session.termId]), ...classScope.params],
  )
  res.json({ session: sessionPayload(session), coverage: rows })
}

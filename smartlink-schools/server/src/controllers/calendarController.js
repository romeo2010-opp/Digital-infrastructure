import { pool } from "../config/db.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import {
  assertTeacherCanTeachSubject,
  assertTeacherCanUseClass,
  getScopedSchoolId,
  isTeacher,
} from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

const ADMIN_ROLES = new Set(["school_owner", "headteacher", "super_admin"])
const EVENT_TYPES = new Set([
  "school_event",
  "academic_deadline",
  "holiday",
  "closure",
  "meeting",
  "sports",
  "exam_session",
  "exam_paper",
  "recurring_assessment",
  "weekly_test",
  "revision_week",
  "exam_week",
  "marking_week",
  "term_closing_week",
  "custom",
])
const EVENT_STATUSES = new Set(["draft", "scheduled", "active", "completed", "cancelled", "archived"])
const VISIBILITIES = new Set(["whole_school", "teachers_only", "students", "parents", "class_only", "staff_only"])
const TEMPLATE_TYPES = new Set(["weekly_spelling_test", "weekly_test", "quiz", "reading_check", "mental_maths", "vocabulary_test", "custom"])
const TEMPLATE_STATUSES = new Set(["draft", "active", "paused", "completed", "archived"])
const FREQUENCIES = new Set(["weekly", "biweekly", "monthly", "custom"])
const INSTANCE_STATUSES = new Set(["upcoming", "draft", "in_progress", "completed", "cancelled", "archived"])

function isAdmin(req) {
  return ADMIN_ROLES.has(String(req.user?.role || ""))
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function idValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

function boolValue(value) {
  return value === true || String(value || "").toLowerCase() === "true" || String(value || "") === "1"
}

function decimalValue(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, `${label} must be a valid non-negative number`)
  return number
}

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

function normalizeDateFields(row, fields) {
  if (!row) return row
  return fields.reduce((current, field) => ({
    ...current,
    [field]: current[field] ? dateOnly(current[field]) : current[field],
  }), { ...row })
}

function parseDate(value, label = "Date") {
  const text = dateOnly(value)
  const date = new Date(`${text}T00:00:00Z`)
  if (!text || Number.isNaN(date.getTime())) throw new HttpError(400, `${label} must be a valid date`)
  return date
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b
}

function termBounds(term) {
  const start = parseDate(term.start_date)
  const end = parseDate(term.end_date || term.start_date)
  const lower = minDate(start, end)
  const upper = maxDate(start, end)
  return {
    start: lower,
    end: upper,
    start_date: formatDate(lower),
    end_date: formatDate(upper),
    inverted: start.getTime() > end.getTime(),
  }
}

function daysBetween(start, end) {
  const startDate = parseDate(start)
  const endDate = parseDate(end)
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000)
}

function overlaps(startA, endA, startB, endB) {
  return parseDate(startA).getTime() <= parseDate(endB).getTime()
    && parseDate(endA).getTime() >= parseDate(startB).getTime()
}

function normalizeDate(value, label) {
  return formatDate(parseDate(value, label))
}

function normalizeTime(value, label = "Time", allowEmpty = true) {
  const text = cleanText(value)
  if (!text && allowEmpty) return null
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new HttpError(400, `${label} must be HH:MM`)
  return text.length === 5 ? `${text}:00` : text
}

function normalizeDateTime(value, fallbackDate, fallbackTime = "08:00:00", allDay = false, label = "Date/time") {
  const raw = cleanText(value)
  if (raw) {
    const normalized = raw.replace("T", " ").replace("Z", "")
    const date = new Date(raw.includes("T") ? raw : normalized.replace(" ", "T"))
    if (Number.isNaN(date.getTime()) && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
      throw new HttpError(400, `${label} must be valid`)
    }
    return normalized.length === 10 ? `${normalized} 00:00:00` : normalized.slice(0, 19)
  }
  const date = normalizeDate(fallbackDate, label)
  const time = allDay ? "00:00:00" : normalizeTime(fallbackTime || "08:00:00", label, false)
  return `${date} ${time}`
}

function labelize(value) {
  return String(value || "-").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function eventDate(row) {
  return dateOnly(row.start_datetime || row.instance_date || row.exam_date || row.start_date)
}

function weekNumberFor(term, value) {
  const start = termBounds(term).start
  const current = parseDate(value)
  return Math.max(1, Math.floor((current.getTime() - start.getTime()) / (7 * 86400000)) + 1)
}

function teacherPairsCondition(scope, classColumn, subjectColumn, teacherColumn = null) {
  if (!scope) return { clause: "", params: [] }
  const parts = []
  const params = []
  if (teacherColumn) {
    parts.push(`${teacherColumn} = ?`)
    params.push(scope.teacherId)
  }
  if (scope.pairs.length) {
    parts.push(`(${scope.pairs.map(() => `(${classColumn} = ? AND ${subjectColumn} = ?)`).join(" OR ")})`)
    params.push(...scope.pairs.flatMap((pair) => [pair.classId, pair.subjectId]))
  }
  if (!parts.length) return { clause: " AND 1 = 0", params: [] }
  return { clause: ` AND (${parts.join(" OR ")})`, params }
}

function teacherEventCondition(scope) {
  if (!scope) return { clause: "", params: [] }
  const params = [scope.teacherId, scope.teacherId]
  const classParts = []
  if (scope.classIds.length) {
    classParts.push(`(e.class_id IN (${scope.classIds.map(() => "?").join(", ")}) AND e.subject_id IS NULL)`)
    params.push(...scope.classIds)
  }
  if (scope.pairs.length) {
    classParts.push(`(${scope.pairs.map(() => "(e.class_id = ? AND e.subject_id = ?)").join(" OR ")})`)
    params.push(...scope.pairs.flatMap((pair) => [pair.classId, pair.subjectId]))
  }
  return {
    clause: ` AND (
      (e.class_id IS NULL AND e.visibility IN ('whole_school', 'teachers_only', 'staff_only'))
      OR e.teacher_id = ?
      OR e.created_by = ?
      ${classParts.length ? `OR ${classParts.join(" OR ")}` : ""}
    )`,
    params,
  }
}

async function loadTeacherScope(connection, req, schoolId, academicYearId, termId) {
  if (!isTeacher(req)) return null
  const params = [schoolId, req.user.id]
  let sessionClause = ""
  if (academicYearId) {
    sessionClause += " AND (academic_year_id = ? OR academic_year_id IS NULL)"
    params.push(academicYearId)
  }
  if (termId) {
    sessionClause += " AND (term_id = ? OR term_id IS NULL)"
    params.push(termId)
  }
  const [pairs] = await connection.query(
    `SELECT class_id, subject_id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND role = 'subject_teacher'
       AND subject_id IS NOT NULL AND is_active = 1${sessionClause}`,
    params,
  )
  const [classes] = await connection.query(
    `SELECT id AS class_id
     FROM classes
     WHERE school_id = ? AND teacher_user_id = ?
     UNION
     SELECT class_id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND teacher_id = ? AND is_active = 1${sessionClause}`,
    [schoolId, req.user.id, schoolId, req.user.id, ...params.slice(2)],
  )
  return {
    teacherId: Number(req.user.id),
    pairs: pairs.map((row) => ({ classId: Number(row.class_id), subjectId: Number(row.subject_id) })),
    classIds: [...new Set(classes.map((row) => Number(row.class_id)))],
  }
}

async function loadTerm(connection, schoolId, academicYearId, termId) {
  const [[term]] = await connection.query(
    `SELECT t.*, ay.name AS academic_year_name
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.school_id = ? AND t.academic_year_id = ? AND t.id = ?
     LIMIT 1`,
    [schoolId, academicYearId, termId],
  )
  return normalizeDateFields(term, [
    "start_date",
    "end_date",
    "revision_start_date",
    "revision_end_date",
    "exam_start_date",
    "exam_end_date",
    "marking_start_date",
    "marking_end_date",
    "closing_date",
  ]) || null
}

async function loadSetupOptions(connection, schoolId, teacherScope) {
  const [years] = await connection.query(
    `SELECT id, name, start_date, end_date, status, is_active
     FROM academic_years
     WHERE school_id = ?
     ORDER BY start_date DESC, id DESC`,
    [schoolId],
  )
  const [terms] = await connection.query(
    `SELECT t.id, t.academic_year_id, t.name, t.term_number, t.start_date, t.end_date, t.status, ay.name AS academic_year_name
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.school_id = ?
     ORDER BY ay.start_date DESC, t.term_number DESC`,
    [schoolId],
  )

  let classesSql = "SELECT id, name, grade_level FROM classes WHERE school_id = ?"
  let classesParams = [schoolId]
  if (teacherScope) {
    if (!teacherScope.classIds.length) classesSql += " AND 1 = 0"
    else {
      classesSql += ` AND id IN (${teacherScope.classIds.map(() => "?").join(", ")})`
      classesParams = [schoolId, ...teacherScope.classIds]
    }
  }
  const [classes] = await connection.query(`${classesSql} ORDER BY name`, classesParams)

  let subjectsSql = "SELECT id, name, code FROM subjects WHERE school_id = ?"
  let subjectsParams = [schoolId]
  if (teacherScope) {
    const subjectIds = [...new Set(teacherScope.pairs.map((pair) => pair.subjectId))]
    if (!subjectIds.length) subjectsSql += " AND 1 = 0"
    else {
      subjectsSql += ` AND id IN (${subjectIds.map(() => "?").join(", ")})`
      subjectsParams = [schoolId, ...subjectIds]
    }
  }
  const [subjects] = await connection.query(`${subjectsSql} ORDER BY name`, subjectsParams)

  const [teachers] = teacherScope
    ? await connection.query("SELECT id, full_name, email FROM users WHERE id = ? AND school_id = ? LIMIT 1", [teacherScope.teacherId, schoolId])
    : await connection.query(
      `SELECT id, full_name, email
       FROM users
       WHERE school_id = ? AND role IN ('teacher', 'headteacher') AND is_active = 1
       ORDER BY full_name`,
      [schoolId],
    )

  return {
    years: years.map((row) => normalizeDateFields(row, ["start_date", "end_date"])),
    terms: terms.map((row) => normalizeDateFields(row, ["start_date", "end_date"])),
    classes,
    subjects,
    teachers,
  }
}

function buildCalendarEvent(source, row, patch = {}) {
  return {
    source,
    source_id: Number(row.id || row.source_id || 0),
    id: `${source}-${row.id || row.source_id}`,
    assessment_id: row.assessment_id ? Number(row.assessment_id) : null,
    exam_session_id: row.exam_session_id ? Number(row.exam_session_id) : null,
    title: row.title || row.name,
    type: row.event_type || patch.type || "school_event",
    subtype: patch.subtype || row.assessment_type || row.exam_type || null,
    start_datetime: row.start_datetime || (row.instance_date ? `${dateOnly(row.instance_date)} ${row.start_time || "00:00:00"}` : `${dateOnly(row.start_date)} 00:00:00`),
    end_datetime: row.end_datetime || (row.end_date ? `${dateOnly(row.end_date)} 23:59:59` : null),
    all_day: Boolean(row.all_day ?? patch.all_day ?? true),
    class_id: row.class_id ? Number(row.class_id) : null,
    class_name: row.class_name || null,
    stream_section: row.stream_section || "",
    subject_id: row.subject_id ? Number(row.subject_id) : null,
    subject_name: row.subject_name || null,
    teacher_id: row.teacher_id ? Number(row.teacher_id) : null,
    teacher_name: row.teacher_name || null,
    status: row.status || "scheduled",
    visibility: row.visibility || null,
    recurrence: patch.recurrence || row.recurrence_rule || null,
    description: row.description || row.notes || "",
    can_open_marks: Boolean(patch.can_open_marks),
    can_open_exam_paper: Boolean(patch.can_open_exam_paper),
    can_open_exam_session: Boolean(patch.can_open_exam_session),
  }
}

function markerEvent(term, title, type, startDate, endDate = startDate) {
  if (!startDate) return null
  return buildCalendarEvent("timeline", {
    id: `${type}-${dateOnly(startDate)}`,
    title,
    event_type: type,
    start_datetime: `${dateOnly(startDate)} 00:00:00`,
    end_datetime: `${dateOnly(endDate || startDate)} 23:59:59`,
    all_day: true,
    status: "scheduled",
    academic_year_id: term.academic_year_id,
    term_id: term.id,
  })
}

function fixedMarkers(term, examRange = null) {
  const examStart = term.exam_start_date || examRange?.start_date
  const examEnd = term.exam_end_date || examRange?.end_date || examStart
  return [
    markerEvent(term, "Revision Week", "revision_week", term.revision_start_date, term.revision_end_date || term.revision_start_date),
    markerEvent(term, "End-of-Term Exams Start", "exam_week", examStart, examStart),
    examEnd && examEnd !== examStart ? markerEvent(term, "End-of-Term Exams End", "exam_week", examEnd, examEnd) : null,
    markerEvent(term, "Marking Week", "marking_week", term.marking_start_date, term.marking_end_date || term.marking_start_date),
    markerEvent(term, "Term Closing", "term_closing_week", term.closing_date, term.closing_date),
  ].filter(Boolean)
}

function buildTimeline(term, customMarkers = [], calendarEvents = [], examRange = null) {
  const bounds = termBounds(term)
  const start = bounds.start
  const end = bounds.end
  const markerRanges = [
    term.revision_start_date ? { type: "revision_week", label: "Revision Week", start_date: dateOnly(term.revision_start_date), end_date: dateOnly(term.revision_end_date || term.revision_start_date) } : null,
    (term.exam_start_date || examRange?.start_date) ? { type: "exam_week", label: "Exam Week", start_date: dateOnly(term.exam_start_date || examRange.start_date), end_date: dateOnly(term.exam_end_date || examRange?.end_date || term.exam_start_date || examRange.start_date) } : null,
    term.marking_start_date ? { type: "marking_week", label: "Marking Week", start_date: dateOnly(term.marking_start_date), end_date: dateOnly(term.marking_end_date || term.marking_start_date) } : null,
    term.closing_date ? { type: "closing_week", label: "Term Closing", start_date: dateOnly(term.closing_date), end_date: dateOnly(term.closing_date) } : null,
    ...customMarkers.map((marker) => ({
      type: marker.marker_type,
      label: marker.title,
      start_date: dateOnly(marker.start_date),
      end_date: dateOnly(marker.end_date),
    })),
  ].filter(Boolean)

  const segments = []
  let cursor = start
  let weekNumber = 1
  while (cursor.getTime() <= end.getTime()) {
    const weekStart = cursor
    const weekEnd = minDate(addDays(cursor, 6), end)
    const startText = formatDate(weekStart)
    const endText = formatDate(weekEnd)
    const matched = markerRanges.find((marker) => overlaps(startText, endText, marker.start_date, marker.end_date))
    const segmentEvents = calendarEvents.filter((event) => {
      const startDate = eventDate(event)
      return startDate && overlaps(startDate, startDate, startText, endText)
    })
    segments.push({
      id: `week-${weekNumber}`,
      week_number: weekNumber,
      title: matched?.label || `Week ${weekNumber}`,
      marker_type: matched?.type || "normal_week",
      start_date: startText,
      end_date: endText,
      events_count: segmentEvents.filter((event) => !["recurring", "exam_timetable"].includes(event.source)).length,
      assessments_count: segmentEvents.filter((event) => event.source === "recurring").length,
      exam_count: segmentEvents.filter((event) => event.source === "exam_session" || event.source === "exam_timetable" || event.type === "exam_week").length,
    })
    cursor = addDays(cursor, 7)
    weekNumber += 1
  }
  return segments
}

async function getExamRange(connection, schoolId, academicYearId, termId, includeArchived) {
  const where = ["school_id = ?", "academic_year_id = ?", "term_id = ?"]
  const params = [schoolId, academicYearId, termId]
  if (!includeArchived) where.push("status <> 'archived'")
  const [[range]] = await connection.query(
    `SELECT MIN(start_date) AS start_date, MAX(end_date) AS end_date
     FROM exam_sessions
     WHERE ${where.join(" AND ")}`,
    params,
  )
  if (!range?.start_date) return null
  return { start_date: dateOnly(range.start_date), end_date: dateOnly(range.end_date || range.start_date) }
}

function addSearchFilter(where, params, columns, query) {
  const text = cleanText(query)
  if (!text) return
  where.push(`(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`)
  params.push(...columns.map(() => `%${text}%`))
}

function addCommonFilters(where, params, alias, filters, includeTeacher = true) {
  if (filters.classId) {
    where.push(`${alias}.class_id = ?`)
    params.push(filters.classId)
  }
  if (filters.subjectId) {
    where.push(`${alias}.subject_id = ?`)
    params.push(filters.subjectId)
  }
  if (includeTeacher && filters.teacherId) {
    where.push(`${alias}.teacher_id = ?`)
    params.push(filters.teacherId)
  }
}

async function listManualEvents(connection, schoolId, term, filters, teacherScope) {
  const bounds = termBounds(term)
  const where = [
    "e.school_id = ?",
    `((e.academic_year_id = ? AND e.term_id = ?) OR (e.academic_year_id IS NULL AND e.term_id IS NULL AND DATE(e.start_datetime) BETWEEN ? AND ?))`,
  ]
  const params = [schoolId, term.academic_year_id, term.id, bounds.start_date, bounds.end_date]
  if (!filters.includeArchived) where.push("e.status <> 'archived'")
  if (filters.eventType) {
    where.push("e.event_type = ?")
    params.push(filters.eventType)
  }
  addSearchFilter(where, params, ["e.title", "e.description"], filters.q)
  addCommonFilters(where, params, "e", filters)
  const teacherCondition = teacherEventCondition(teacherScope)
  where.push(teacherCondition.clause.replace(/^ AND /, ""))
  params.push(...teacherCondition.params)
  const [rows] = await connection.query(
    `SELECT e.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name
     FROM school_events e
     LEFT JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id
     LEFT JOIN subjects subj ON subj.id = e.subject_id AND subj.school_id = e.school_id
     LEFT JOIN users teacher ON teacher.id = e.teacher_id AND teacher.school_id = e.school_id
     WHERE ${where.filter(Boolean).join(" AND ")}
     ORDER BY e.start_datetime ASC, e.id ASC`,
    params,
  )
  return rows.map((row) => buildCalendarEvent("manual", row, { all_day: row.all_day }))
}

async function listRecurringEvents(connection, schoolId, term, filters, teacherScope) {
  if (filters.eventType && !["recurring_assessment", "weekly_test"].includes(filters.eventType)) return []
  const where = ["ai.school_id = ?", "ai.academic_year_id = ?", "ai.term_id = ?"]
  const params = [schoolId, term.academic_year_id, term.id]
  if (!filters.includeArchived) {
    where.push("ai.status <> 'archived'")
    where.push("rat.status <> 'archived'")
  }
  if (filters.eventType === "weekly_test") where.push("rat.assessment_type IN ('weekly_spelling_test', 'weekly_test')")
  addSearchFilter(where, params, ["ai.title", "rat.title", "rat.description"], filters.q)
  addCommonFilters(where, params, "ai", filters)
  const teacherCondition = teacherPairsCondition(teacherScope, "ai.class_id", "ai.subject_id", "ai.teacher_id")
  where.push(teacherCondition.clause.replace(/^ AND /, ""))
  params.push(...teacherCondition.params)
  const [rows] = await connection.query(
    `SELECT ai.*, rat.assessment_type, rat.frequency, rat.title AS template_title, rat.description,
       c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name
     FROM assessment_instances ai
     LEFT JOIN recurring_assessment_templates rat ON rat.id = ai.template_id AND rat.school_id = ai.school_id
     JOIN classes c ON c.id = ai.class_id AND c.school_id = ai.school_id
     JOIN subjects subj ON subj.id = ai.subject_id AND subj.school_id = ai.school_id
     JOIN users teacher ON teacher.id = ai.teacher_id AND teacher.school_id = ai.school_id
     WHERE ${where.filter(Boolean).join(" AND ")}
     ORDER BY ai.instance_date ASC, ai.start_time ASC, ai.id ASC`,
    params,
  )
  return rows.map((row) => buildCalendarEvent("recurring", row, {
    type: row.assessment_type === "weekly_spelling_test" || row.assessment_type === "weekly_test" ? "weekly_test" : "recurring_assessment",
    subtype: row.assessment_type,
    recurrence: row.frequency ? labelize(row.frequency) : null,
    can_open_marks: true,
  }))
}

async function listExamSessionEvents(connection, schoolId, term, filters, teacherScope) {
  if (filters.eventType && filters.eventType !== "exam_session") return []
  const where = ["es.school_id = ?", "es.academic_year_id = ?", "es.term_id = ?"]
  const params = [schoolId, term.academic_year_id, term.id]
  if (!filters.includeArchived) where.push("es.status <> 'archived'")
  addSearchFilter(where, params, ["es.name", "es.notes"], filters.q)
  const teacherCondition = teacherPairsCondition(teacherScope, "a.class_id", "a.subject_id", "a.teacher_id")
  let teacherSql = ""
  if (teacherScope) {
    teacherSql = ` AND EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.school_id = es.school_id AND a.exam_session_id = es.id${teacherCondition.clause}
    )`
    params.push(...teacherCondition.params)
  }
  const [rows] = await connection.query(
    `SELECT es.id, es.name AS title, es.exam_type, es.status, es.start_date, es.end_date, es.notes AS description
     FROM exam_sessions es
     WHERE ${where.join(" AND ")}${teacherSql}
     ORDER BY es.start_date ASC, es.id ASC`,
    params,
  )
  return rows.map((row) => buildCalendarEvent("exam_session", row, {
    type: "exam_session",
    all_day: true,
    can_open_exam_session: true,
  }))
}

async function listExamTimetableEvents(connection, schoolId, term, filters, teacherScope) {
  if (filters.eventType && filters.eventType !== "exam_paper") return []
  const where = ["ett.school_id = ?", "ett.academic_year_id = ?", "ett.term_id = ?"]
  const params = [schoolId, term.academic_year_id, term.id]
  if (!filters.includeArchived) {
    where.push("ett.status <> 'cancelled'")
    where.push("es.status <> 'archived'")
    where.push("a.status <> 'archived'")
  }
  addSearchFilter(where, params, ["a.name", "es.name", "c.name", "subj.name"], filters.q)
  addCommonFilters(where, params, "ett", filters, false)
  if (filters.teacherId) {
    where.push("(a.teacher_id = ? OR ett.invigilator_teacher_id = ?)")
    params.push(filters.teacherId, filters.teacherId)
  }
  const teacherCondition = teacherPairsCondition(teacherScope, "ett.class_id", "ett.subject_id", "a.teacher_id")
  where.push(teacherCondition.clause.replace(/^ AND /, ""))
  params.push(...teacherCondition.params)
  const [rows] = await connection.query(
    `SELECT ett.*, a.name AS title, a.teacher_id, es.name AS exam_session_name,
       c.name AS class_name, subj.name AS subject_name,
       COALESCE(invigilator.full_name, teacher.full_name) AS teacher_name,
       CONCAT(ett.exam_date, ' ', ett.start_time) AS start_datetime,
       CONCAT(ett.exam_date, ' ', ett.end_time) AS end_datetime
     FROM exam_timetable_entries ett
     JOIN assessments a ON a.id = ett.assessment_id AND a.school_id = ett.school_id
     JOIN exam_sessions es ON es.id = ett.exam_session_id AND es.school_id = ett.school_id
     JOIN classes c ON c.id = ett.class_id AND c.school_id = ett.school_id
     JOIN subjects subj ON subj.id = ett.subject_id AND subj.school_id = ett.school_id
     LEFT JOIN users teacher ON teacher.id = a.teacher_id AND teacher.school_id = a.school_id
     LEFT JOIN users invigilator ON invigilator.id = ett.invigilator_teacher_id AND invigilator.school_id = ett.school_id
     WHERE ${where.filter(Boolean).join(" AND ")}
     ORDER BY ett.exam_date ASC, ett.start_time ASC`,
    params,
  )
  return rows.map((row) => buildCalendarEvent("exam_timetable", row, {
    type: "exam_paper",
    all_day: false,
    can_open_exam_paper: true,
  }))
}

async function listCustomMarkers(connection, schoolId, term, includeArchived) {
  const where = ["school_id = ?", "academic_year_id = ?", "term_id = ?"]
  const params = [schoolId, term.academic_year_id, term.id]
  if (!includeArchived) where.push("status <> 'archived'")
  const [rows] = await connection.query(
    `SELECT *
     FROM term_timeline_markers
     WHERE ${where.join(" AND ")}
     ORDER BY start_date ASC, id ASC`,
    params,
  )
  return rows
}

function buildSummary(term, events) {
  const bounds = termBounds(term)
  const today = formatDate(new Date())
  const currentWeek = today >= bounds.start_date && today <= bounds.end_date ? weekNumberFor(term, today) : null
  const totalWeeks = Math.max(1, Math.ceil((daysBetween(bounds.start_date, bounds.end_date) + 1) / 7))
  const upcoming = events.filter((event) => eventDate(event) >= today && !["cancelled", "archived"].includes(String(event.status || "")))
  const weekStart = currentWeek ? formatDate(addDays(bounds.start, (currentWeek - 1) * 7)) : today
  const weekEnd = currentWeek ? formatDate(addDays(parseDate(weekStart), 6)) : today
  const thisWeek = events.filter((event) => {
    const start = eventDate(event)
    return start && start >= weekStart && start <= weekEnd
  })
  const examStart = dateOnly(term.exam_start_date) || events.find((event) => event.type === "exam_session")?.start_datetime?.slice(0, 10)
  const examStartsIn = examStart ? daysBetween(today, examStart) : null
  const progressPercent = currentWeek ? Math.min(100, Math.round((currentWeek / totalWeeks) * 100)) : 0
  return {
    current_week: currentWeek,
    total_weeks: totalWeeks,
    progress_percent: progressPercent,
    upcoming_events: upcoming.slice(0, 6),
    upcoming_events_count: upcoming.length,
    this_week_assessments: thisWeek.filter((event) => event.source === "recurring").length,
    this_week_events: thisWeek.filter((event) => event.source !== "recurring").length,
    exam_start_date: examStart || null,
    exam_starts_in_days: examStartsIn === null ? null : examStartsIn,
  }
}

export async function getSchoolCalendar(req, res) {
  const schoolId = getScopedSchoolId(req)
  const connection = await pool.getConnection()
  try {
    const activeSession = await getActiveAcademicSession(schoolId, connection)
    const academicYearId = idValue(req.query.academic_year_id) || activeSession.academicYearId
    const termId = idValue(req.query.term_id) || activeSession.termId
    const includeArchived = boolValue(req.query.include_archived)
    if (!academicYearId || !termId) {
      const setup = await loadSetupOptions(connection, schoolId, null)
      return res.json({
        events: [],
        timeline: [],
        templates: [],
        setup,
        session: sessionPayload(activeSession),
        setup_required: true,
        message: activeSession.message || "No active academic term found. Open a term to use the calendar.",
      })
    }

    const term = await loadTerm(connection, schoolId, academicYearId, termId)
    if (!term || (!includeArchived && term.status === "archived")) {
      const setup = await loadSetupOptions(connection, schoolId, null)
      return res.json({
        events: [],
        timeline: [],
        templates: [],
        setup,
        session: sessionPayload(activeSession),
        setup_required: false,
        message: "No visible term was found for the selected filters.",
      })
    }

    const teacherScope = await loadTeacherScope(connection, req, schoolId, academicYearId, termId)
    const setup = await loadSetupOptions(connection, schoolId, teacherScope)
    const eventType = cleanText(req.query.event_type)
    const filters = {
      q: cleanText(req.query.q || req.query.search),
      eventType: EVENT_TYPES.has(eventType) ? eventType : "",
      classId: idValue(req.query.class_id),
      subjectId: idValue(req.query.subject_id),
      teacherId: isTeacher(req) ? null : idValue(req.query.teacher_id),
      includeArchived,
    }

    const examRange = await getExamRange(connection, schoolId, academicYearId, termId, includeArchived)
    const [manual, recurring, sessions, timetable, customMarkers] = await Promise.all([
      listManualEvents(connection, schoolId, term, filters, teacherScope),
      listRecurringEvents(connection, schoolId, term, filters, teacherScope),
      listExamSessionEvents(connection, schoolId, term, filters, teacherScope),
      listExamTimetableEvents(connection, schoolId, term, filters, teacherScope),
      listCustomMarkers(connection, schoolId, term, includeArchived),
    ])
    const markerEvents = filters.eventType && !["revision_week", "exam_week", "marking_week", "term_closing_week", "custom"].includes(filters.eventType)
      ? []
      : [
        ...fixedMarkers(term, examRange),
        ...customMarkers.map((marker) => buildCalendarEvent("timeline", {
          id: marker.id,
          title: marker.title,
          event_type: marker.marker_type === "closing_week" ? "term_closing_week" : marker.marker_type,
          start_datetime: `${dateOnly(marker.start_date)} 00:00:00`,
          end_datetime: `${dateOnly(marker.end_date)} 23:59:59`,
          status: marker.status,
        })),
      ].filter((event) => !filters.eventType || event.type === filters.eventType)

    const events = [...markerEvents, ...manual, ...recurring, ...sessions, ...timetable]
      .sort((a, b) => String(a.start_datetime).localeCompare(String(b.start_datetime)) || String(a.title).localeCompare(String(b.title)))
    const timeline = buildTimeline(term, customMarkers, events, examRange)

    const templateCondition = teacherPairsCondition(teacherScope, "rat.class_id", "rat.subject_id", "rat.teacher_id")
    const templateWhere = ["rat.school_id = ?", "rat.academic_year_id = ?", "rat.term_id = ?"]
    const templateParams = [schoolId, academicYearId, termId]
    if (!includeArchived) templateWhere.push("rat.status <> 'archived'")
    templateWhere.push(templateCondition.clause.replace(/^ AND /, ""))
    templateParams.push(...templateCondition.params)
    const [templates] = await connection.query(
      `SELECT rat.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
        COUNT(ai.id) AS instance_count
       FROM recurring_assessment_templates rat
       JOIN classes c ON c.id = rat.class_id AND c.school_id = rat.school_id
       JOIN subjects subj ON subj.id = rat.subject_id AND subj.school_id = rat.school_id
       JOIN users teacher ON teacher.id = rat.teacher_id AND teacher.school_id = rat.school_id
       LEFT JOIN assessment_instances ai ON ai.template_id = rat.id AND ai.school_id = rat.school_id
       WHERE ${templateWhere.filter(Boolean).join(" AND ")}
       GROUP BY rat.id, c.name, subj.name, teacher.full_name
       ORDER BY rat.start_date DESC, rat.title`,
      templateParams,
    )

    res.json({
      events,
      timeline,
      templates,
      summary: buildSummary(term, events),
      setup,
      term,
      session: sessionPayload(activeSession),
      setup_required: false,
    })
  } finally {
    connection.release()
  }
}

async function validateSchoolRelations(connection, schoolId, values) {
  const [[year]] = await connection.query("SELECT id FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1", [values.academicYearId, schoolId])
  if (!year) throw new HttpError(400, "Select an academic year from this school")
  const [[term]] = await connection.query("SELECT id FROM terms WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1", [values.termId, schoolId, values.academicYearId])
  if (!term) throw new HttpError(400, "Select a term from this school")
  if (values.classId) {
    const [[row]] = await connection.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [values.classId, schoolId])
    if (!row) throw new HttpError(400, "Select a class from this school")
  }
  if (values.subjectId) {
    const [[row]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [values.subjectId, schoolId])
    if (!row) throw new HttpError(400, "Select a subject from this school")
  }
  if (values.teacherId) {
    const [[row]] = await connection.query(
      "SELECT id FROM users WHERE id = ? AND school_id = ? AND role IN ('teacher', 'headteacher') AND is_active = 1 LIMIT 1",
      [values.teacherId, schoolId],
    )
    if (!row) throw new HttpError(400, "Select an active teacher from this school")
  }
}

export async function createSchoolEvent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const activeSession = await getActiveAcademicSession(schoolId)
  if (activeSession.setupRequired && (!req.body.academic_year_id || !req.body.term_id)) throw new HttpError(409, activeSession.message)

  const connection = await pool.getConnection()
  try {
    const title = cleanText(req.body.title)
    if (!title) throw new HttpError(400, "Event title is required")
    const eventType = EVENT_TYPES.has(cleanText(req.body.event_type)) ? cleanText(req.body.event_type) : "school_event"
    const status = EVENT_STATUSES.has(cleanText(req.body.status)) ? cleanText(req.body.status) : "scheduled"
    const visibility = VISIBILITIES.has(cleanText(req.body.visibility)) ? cleanText(req.body.visibility) : "whole_school"
    const allDay = boolValue(req.body.all_day)
    const academicYearId = idValue(req.body.academic_year_id) || activeSession.academicYearId
    const termId = idValue(req.body.term_id) || activeSession.termId
    const classId = idValue(req.body.class_id)
    const subjectId = idValue(req.body.subject_id)
    const teacherId = isTeacher(req) ? Number(req.user.id) : idValue(req.body.teacher_id)

    await validateSchoolRelations(connection, schoolId, { academicYearId, termId, classId, subjectId, teacherId })
    if (isTeacher(req)) {
      if (subjectId && classId) await assertTeacherCanTeachSubject(req, schoolId, classId, subjectId, termId)
      else if (classId) await assertTeacherCanUseClass(req, schoolId, classId)
    }

    const startDatetime = normalizeDateTime(req.body.start_datetime, req.body.date || req.body.start_date, req.body.start_time, allDay, "Start date")
    const endDatetime = req.body.end_datetime || req.body.end_date
      ? normalizeDateTime(req.body.end_datetime, req.body.end_date || req.body.date || req.body.start_date, req.body.end_time || req.body.start_time, allDay, "End date")
      : null

    const [result] = await connection.query(
      `INSERT INTO school_events (
        school_id, academic_year_id, term_id, title, description, event_type, start_datetime, end_datetime,
        all_day, class_id, stream_section, subject_id, teacher_id, created_by, visibility,
        recurrence_rule, recurrence_end_date, source_type, source_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?)`,
      [
        schoolId,
        academicYearId,
        termId,
        title,
        cleanText(req.body.description) || null,
        eventType,
        startDatetime,
        endDatetime,
        allDay ? 1 : 0,
        classId,
        cleanText(req.body.stream_section) || null,
        subjectId,
        teacherId,
        req.user.id,
        visibility,
        cleanText(req.body.recurrence_rule) || null,
        req.body.recurrence_end_date ? normalizeDate(req.body.recurrence_end_date, "Recurrence end date") : null,
        status,
      ],
    )
    res.status(201).json({ id: Number(result.insertId), message: "Calendar event created." })
  } finally {
    connection.release()
  }
}

export async function updateSchoolEvent(req, res) {
  const schoolId = getScopedSchoolId(req)
  const eventId = Number(req.params.id || 0)
  if (!eventId) throw new HttpError(400, "Event id is required")
  const connection = await pool.getConnection()
  try {
    const [[event]] = await connection.query("SELECT * FROM school_events WHERE id = ? AND school_id = ? LIMIT 1", [eventId, schoolId])
    if (!event) throw new HttpError(404, "Calendar event was not found")
    if (isTeacher(req) && Number(event.created_by) !== Number(req.user.id) && Number(event.teacher_id) !== Number(req.user.id)) {
      throw new HttpError(403, "Teachers can only edit events they created or own")
    }
    const patch = {
      title: req.body.title !== undefined ? cleanText(req.body.title) : event.title,
      description: req.body.description !== undefined ? cleanText(req.body.description) || null : event.description,
      event_type: req.body.event_type !== undefined && EVENT_TYPES.has(cleanText(req.body.event_type)) ? cleanText(req.body.event_type) : event.event_type,
      visibility: req.body.visibility !== undefined && VISIBILITIES.has(cleanText(req.body.visibility)) ? cleanText(req.body.visibility) : event.visibility,
      status: req.body.status !== undefined && EVENT_STATUSES.has(cleanText(req.body.status)) ? cleanText(req.body.status) : event.status,
      all_day: req.body.all_day !== undefined ? (boolValue(req.body.all_day) ? 1 : 0) : event.all_day,
      start_datetime: req.body.start_datetime || req.body.date || req.body.start_date
        ? normalizeDateTime(req.body.start_datetime, req.body.date || req.body.start_date || dateOnly(event.start_datetime), req.body.start_time, boolValue(req.body.all_day ?? event.all_day), "Start date")
        : event.start_datetime,
      end_datetime: req.body.end_datetime || req.body.end_date
        ? normalizeDateTime(req.body.end_datetime, req.body.end_date || req.body.date || req.body.start_date || dateOnly(event.end_datetime || event.start_datetime), req.body.end_time || req.body.start_time, boolValue(req.body.all_day ?? event.all_day), "End date")
        : event.end_datetime,
    }
    await connection.query(
      `UPDATE school_events
       SET title = ?, description = ?, event_type = ?, visibility = ?, status = ?, all_day = ?, start_datetime = ?, end_datetime = ?
       WHERE id = ? AND school_id = ?`,
      [patch.title, patch.description, patch.event_type, patch.visibility, patch.status, patch.all_day, patch.start_datetime, patch.end_datetime, eventId, schoolId],
    )
    res.json({ id: eventId, message: "Calendar event updated." })
  } finally {
    connection.release()
  }
}

async function resolveTemplateTeacher(connection, req, schoolId, classId, subjectId, academicYearId, termId, requestedTeacherId) {
  if (isTeacher(req)) {
    await assertTeacherCanTeachSubject(req, schoolId, classId, subjectId, termId)
    return Number(req.user.id)
  }
  if (requestedTeacherId) return requestedTeacherId
  const [[assignment]] = await connection.query(
    `SELECT teacher_id
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND class_id = ? AND subject_id = ? AND role = 'subject_teacher' AND is_active = 1
       AND (academic_year_id = ? OR academic_year_id IS NULL)
       AND (term_id = ? OR term_id IS NULL)
     ORDER BY (academic_year_id = ?) DESC, (term_id = ?) DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [schoolId, classId, subjectId, academicYearId, termId, academicYearId, termId],
  )
  if (!assignment) throw new HttpError(400, "No assigned subject teacher was found for this class and subject")
  return Number(assignment.teacher_id)
}

function nextDateForDay(start, dayOfWeek) {
  if (dayOfWeek === null || dayOfWeek === undefined || dayOfWeek === "") return start
  const target = Number(dayOfWeek)
  const current = start.getUTCDay()
  const delta = (target - current + 7) % 7
  return addDays(start, delta)
}

async function generateInstancesForTemplate(connection, schoolId, templateId) {
  const [[template]] = await connection.query(
    `SELECT rat.*, t.start_date AS term_start_date, t.end_date AS term_end_date
     FROM recurring_assessment_templates rat
     JOIN terms t ON t.id = rat.term_id AND t.school_id = rat.school_id
     WHERE rat.school_id = ? AND rat.id = ?
     LIMIT 1`,
    [schoolId, templateId],
  )
  if (!template) throw new HttpError(404, "Recurring assessment template was not found")
  if (["paused", "completed", "archived"].includes(String(template.status))) return 0

  const termRange = termBounds({ start_date: template.term_start_date, end_date: template.term_end_date })
  const start = maxDate(parseDate(template.start_date), termRange.start)
  const end = minDate(parseDate(template.end_date), termRange.end)
  if (start.getTime() > end.getTime()) return 0

  const dates = []
  if (template.frequency === "monthly") {
    let cursor = nextDateForDay(start, template.day_of_week)
    while (cursor.getTime() <= end.getTime()) {
      dates.push(cursor)
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()))
    }
  } else {
    const step = template.frequency === "biweekly" ? 14 : 7
    let cursor = nextDateForDay(start, template.day_of_week)
    while (cursor.getTime() <= end.getTime()) {
      dates.push(cursor)
      cursor = addDays(cursor, step)
    }
  }

  let created = 0
  for (const date of dates) {
    const instanceDate = formatDate(date)
    const week = weekNumberFor({ start_date: template.term_start_date }, instanceDate)
    const title = `${template.title} - Week ${week}`
    const [result] = await connection.query(
      `INSERT INTO assessment_instances (
        school_id, template_id, academic_year_id, term_id, class_id, stream_section, subject_id, teacher_id,
        title, instance_date, start_time, duration_minutes, total_marks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
      ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [
        schoolId,
        template.id,
        template.academic_year_id,
        template.term_id,
        template.class_id,
        template.stream_section,
        template.subject_id,
        template.teacher_id,
        title,
        instanceDate,
        template.default_start_time,
        template.default_duration_minutes,
        template.total_marks,
      ],
    )
    if (result.affectedRows === 1) created += 1
  }
  return created
}

export async function createRecurringAssessmentTemplate(req, res) {
  const schoolId = getScopedSchoolId(req)
  const activeSession = await getActiveAcademicSession(schoolId)
  if (activeSession.setupRequired && (!req.body.academic_year_id || !req.body.term_id)) throw new HttpError(409, activeSession.message)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const title = cleanText(req.body.title)
    if (!title) throw new HttpError(400, "Assessment title is required")
    const assessmentType = TEMPLATE_TYPES.has(cleanText(req.body.assessment_type)) ? cleanText(req.body.assessment_type) : "weekly_test"
    const frequency = FREQUENCIES.has(cleanText(req.body.frequency)) ? cleanText(req.body.frequency) : "weekly"
    const status = TEMPLATE_STATUSES.has(cleanText(req.body.status)) ? cleanText(req.body.status) : "active"
    const academicYearId = idValue(req.body.academic_year_id) || activeSession.academicYearId
    const termId = idValue(req.body.term_id) || activeSession.termId
    const classId = idValue(req.body.class_id)
    const subjectId = idValue(req.body.subject_id)
    if (!classId || !subjectId) throw new HttpError(400, "Class and subject are required")
    const totalMarks = decimalValue(req.body.total_marks, "Total marks", 10)
    if (totalMarks <= 0) throw new HttpError(400, "Total marks must be greater than 0")
    const startDate = normalizeDate(req.body.start_date || activeSession.term?.start_date, "Start date")
    const endDate = normalizeDate(req.body.end_date || activeSession.term?.end_date, "End date")
    if (parseDate(startDate).getTime() > parseDate(endDate).getTime()) throw new HttpError(400, "End date must be after start date")
    const dayOfWeek = req.body.day_of_week === "" || req.body.day_of_week === undefined ? null : Number(req.body.day_of_week)
    if (dayOfWeek !== null && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) throw new HttpError(400, "Day of week must be between 0 and 6")
    const teacherId = await resolveTemplateTeacher(connection, req, schoolId, classId, subjectId, academicYearId, termId, idValue(req.body.teacher_id))
    await validateSchoolRelations(connection, schoolId, { academicYearId, termId, classId, subjectId, teacherId })

    const [result] = await connection.query(
      `INSERT INTO recurring_assessment_templates (
        school_id, academic_year_id, term_id, title, description, assessment_type, class_id, stream_section,
        subject_id, teacher_id, total_marks, frequency, day_of_week, start_date, end_date,
        default_start_time, default_duration_minutes, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        academicYearId,
        termId,
        title,
        cleanText(req.body.description) || null,
        assessmentType,
        classId,
        cleanText(req.body.stream_section) || null,
        subjectId,
        teacherId,
        totalMarks,
        frequency,
        dayOfWeek,
        startDate,
        endDate,
        normalizeTime(req.body.default_start_time, "Default start time"),
        idValue(req.body.default_duration_minutes),
        status,
        req.user.id,
      ],
    )
    const templateId = Number(result.insertId)
    const generated = await generateInstancesForTemplate(connection, schoolId, templateId)
    await connection.commit()
    res.status(201).json({ id: templateId, generated_instances: generated, message: "Recurring assessment created." })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function generateRecurringAssessmentInstances(req, res) {
  const schoolId = getScopedSchoolId(req)
  const templateId = Number(req.params.id || 0)
  if (!templateId) throw new HttpError(400, "Template id is required")
  const connection = await pool.getConnection()
  try {
    const [[template]] = await connection.query("SELECT * FROM recurring_assessment_templates WHERE id = ? AND school_id = ? LIMIT 1", [templateId, schoolId])
    if (!template) throw new HttpError(404, "Recurring assessment template was not found")
    if (isTeacher(req) && Number(template.teacher_id) !== Number(req.user.id)) {
      await assertTeacherCanTeachSubject(req, schoolId, Number(template.class_id), Number(template.subject_id), Number(template.term_id))
    }
    const generated = await generateInstancesForTemplate(connection, schoolId, templateId)
    res.json({ id: templateId, generated_instances: generated, message: generated ? "Assessment instances generated." : "No new instances were needed." })
  } finally {
    connection.release()
  }
}

async function getInstanceBase(connection, schoolId, instanceId) {
  const [[instance]] = await connection.query(
    `SELECT ai.*, rat.assessment_type, rat.frequency, rat.description AS template_description,
      c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
      ay.name AS academic_year_name, t.name AS term_name
     FROM assessment_instances ai
     LEFT JOIN recurring_assessment_templates rat ON rat.id = ai.template_id AND rat.school_id = ai.school_id
     JOIN classes c ON c.id = ai.class_id AND c.school_id = ai.school_id
     JOIN subjects subj ON subj.id = ai.subject_id AND subj.school_id = ai.school_id
     JOIN users teacher ON teacher.id = ai.teacher_id AND teacher.school_id = ai.school_id
     JOIN academic_years ay ON ay.id = ai.academic_year_id AND ay.school_id = ai.school_id
     JOIN terms t ON t.id = ai.term_id AND t.school_id = ai.school_id
     WHERE ai.id = ? AND ai.school_id = ?
     LIMIT 1`,
    [instanceId, schoolId],
  )
  if (!instance) throw new HttpError(404, "Assessment instance was not found")
  return instance
}

async function assertInstanceReadable(req, schoolId, instance) {
  if (!isTeacher(req)) return
  if (Number(instance.teacher_id) === Number(req.user.id)) return
  await assertTeacherCanTeachSubject(req, schoolId, Number(instance.class_id), Number(instance.subject_id), Number(instance.term_id))
}

async function loadInstanceDetail(connection, req, schoolId, instanceId) {
  const instance = await getInstanceBase(connection, schoolId, instanceId)
  await assertInstanceReadable(req, schoolId, instance)
  const [items] = await connection.query(
    `SELECT id, item_text, item_type, sort_order
     FROM assessment_instance_items
     WHERE school_id = ? AND assessment_instance_id = ?
     ORDER BY sort_order, id`,
    [schoolId, instanceId],
  )
  const [students] = await connection.query(
    `SELECT se.id AS enrollment_id, s.id AS student_id, COALESCE(s.student_id, s.admission_no) AS student_number,
       s.first_name, s.last_name, CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       air.id AS result_id, air.score, air.comment, air.status, air.last_saved_at
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     LEFT JOIN assessment_instance_results air ON air.school_id = se.school_id
       AND air.assessment_instance_id = ? AND air.student_id = s.id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
       AND se.enrollment_status = 'active' AND s.status = 'active'
       AND (? IS NULL OR COALESCE(se.stream_section, '') = COALESCE(?, ''))
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [
      instanceId,
      schoolId,
      instance.academic_year_id,
      instance.term_id,
      instance.class_id,
      instance.stream_section || null,
      instance.stream_section || null,
    ],
  )
  return { instance, items, students }
}

export async function getAssessmentInstance(req, res) {
  const schoolId = getScopedSchoolId(req)
  const instanceId = Number(req.params.id || 0)
  if (!instanceId) throw new HttpError(400, "Assessment instance id is required")
  const connection = await pool.getConnection()
  try {
    const payload = await loadInstanceDetail(connection, req, schoolId, instanceId)
    res.json(payload)
  } finally {
    connection.release()
  }
}

export async function saveAssessmentInstanceResults(req, res) {
  const schoolId = getScopedSchoolId(req)
  const instanceId = Number(req.params.id || 0)
  if (!instanceId) throw new HttpError(400, "Assessment instance id is required")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const instance = await getInstanceBase(connection, schoolId, instanceId)
    await assertInstanceReadable(req, schoolId, instance)
    if (isTeacher(req) && ["completed", "archived"].includes(String(instance.status))) {
      throw new HttpError(409, "Completed or archived assessment instances are read-only for teachers")
    }

    if (Array.isArray(req.body.items)) {
      await connection.query("DELETE FROM assessment_instance_items WHERE school_id = ? AND assessment_instance_id = ?", [schoolId, instanceId])
      for (const [index, item] of req.body.items.entries()) {
        const text = cleanText(item.item_text || item.text)
        if (!text) continue
        const type = ["word", "question", "instruction"].includes(cleanText(item.item_type)) ? cleanText(item.item_type) : "word"
        await connection.query(
          `INSERT INTO assessment_instance_items (school_id, assessment_instance_id, item_text, item_type, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [schoolId, instanceId, text, type, index + 1],
        )
      }
    }

    const [enrollments] = await connection.query(
      `SELECT se.id AS enrollment_id, se.student_id
       FROM student_enrollments se
       JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
         AND se.enrollment_status = 'active' AND s.status = 'active'
         AND (? IS NULL OR COALESCE(se.stream_section, '') = COALESCE(?, ''))`,
      [schoolId, instance.academic_year_id, instance.term_id, instance.class_id, instance.stream_section || null, instance.stream_section || null],
    )
    const enrollmentByStudent = new Map(enrollments.map((row) => [Number(row.student_id), Number(row.enrollment_id)]))
    const requestedStatus = cleanText(req.body.status)
    const resultStatus = requestedStatus === "completed" ? "completed" : requestedStatus === "submitted" ? "submitted" : "draft"
    for (const row of Array.isArray(req.body.results) ? req.body.results : []) {
      const studentId = Number(row.student_id || 0)
      if (!enrollmentByStudent.has(studentId)) continue
      const score = row.score === "" || row.score === null || row.score === undefined ? null : decimalValue(row.score, "Score", null)
      if (score !== null && score > Number(instance.total_marks || 0)) throw new HttpError(400, "Score cannot exceed total marks")
      await connection.query(
        `INSERT INTO assessment_instance_results (
          school_id, assessment_instance_id, student_id, enrollment_id, score, comment, status, last_saved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          enrollment_id = VALUES(enrollment_id),
          score = VALUES(score),
          comment = VALUES(comment),
          status = VALUES(status),
          last_saved_at = CURRENT_TIMESTAMP`,
        [
          schoolId,
          instanceId,
          studentId,
          enrollmentByStudent.get(studentId),
          score,
          cleanText(row.comment) || null,
          resultStatus,
        ],
      )
    }
    const instanceStatus = INSTANCE_STATUSES.has(requestedStatus) ? requestedStatus : (resultStatus === "completed" ? "completed" : "draft")
    await connection.query("UPDATE assessment_instances SET status = ? WHERE id = ? AND school_id = ?", [instanceStatus, instanceId, schoolId])
    await connection.commit()
    const payload = await loadInstanceDetail(connection, req, schoolId, instanceId)
    res.json({ ...payload, message: resultStatus === "completed" ? "Assessment results completed." : "Assessment results saved as draft." })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateTermTimeline(req, res) {
  const schoolId = getScopedSchoolId(req)
  if (!isAdmin(req)) throw new HttpError(403, "Only school leadership can update term timeline markers")
  const termId = idValue(req.body.term_id || req.params.termId)
  if (!termId) throw new HttpError(400, "Term id is required")
  const connection = await pool.getConnection()
  try {
    const [[term]] = await connection.query("SELECT * FROM terms WHERE id = ? AND school_id = ? LIMIT 1", [termId, schoolId])
    if (!term) throw new HttpError(404, "Term was not found")
    const patch = {
      revision_start_date: req.body.revision_start_date ? normalizeDate(req.body.revision_start_date, "Revision start date") : null,
      revision_end_date: req.body.revision_end_date ? normalizeDate(req.body.revision_end_date, "Revision end date") : null,
      exam_start_date: req.body.exam_start_date ? normalizeDate(req.body.exam_start_date, "Exam start date") : null,
      exam_end_date: req.body.exam_end_date ? normalizeDate(req.body.exam_end_date, "Exam end date") : null,
      marking_start_date: req.body.marking_start_date ? normalizeDate(req.body.marking_start_date, "Marking start date") : null,
      marking_end_date: req.body.marking_end_date ? normalizeDate(req.body.marking_end_date, "Marking end date") : null,
      closing_date: req.body.closing_date ? normalizeDate(req.body.closing_date, "Closing date") : null,
    }
    await connection.query(
      `UPDATE terms
       SET revision_start_date = ?, revision_end_date = ?, exam_start_date = ?, exam_end_date = ?,
         marking_start_date = ?, marking_end_date = ?, closing_date = ?
       WHERE id = ? AND school_id = ?`,
      [
        patch.revision_start_date,
        patch.revision_end_date,
        patch.exam_start_date,
        patch.exam_end_date,
        patch.marking_start_date,
        patch.marking_end_date,
        patch.closing_date,
        termId,
        schoolId,
      ],
    )
    res.json({ term_id: termId, message: "Term timeline updated." })
  } finally {
    connection.release()
  }
}

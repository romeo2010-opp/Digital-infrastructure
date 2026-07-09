import { pool } from "../../config/db.js"
import { getActiveAcademicSession, sessionPayload } from "../../services/academicSessionService.js"
import { getScopedSchoolId } from "../../utils/tenantScope.js"
import { TimetableSolverClient } from "./solverClient.service.js"

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value ? String(value).slice(0, 10) : null
}

function timeText(value) {
  return value ? String(value).slice(0, 8) : null
}

function weekdayFromDate(value) {
  const date = new Date(`${dateText(value)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

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

function todayInTimezone(timezone = "Africa/Blantyre") {
  const parts = timezoneParts(timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function minutesInTimezone(timezone = "Africa/Blantyre") {
  const parts = timezoneParts(timezone)
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
}

function clockMinutes(value) {
  if (!value) return null
  const [hours, minutes] = String(value).split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function isLearningEntry(entry) {
  return Boolean(entry?.classId && (entry.subjectId || entry.teacherId || String(entry.entryType || "").includes("LESSON")))
}

function activeNow(entries, timezone) {
  const minutes = minutesInTimezone(timezone)
  return entries.filter((entry) => {
    const start = clockMinutes(entry.startTime || entry.start_time)
    const end = clockMinutes(entry.endTime || entry.end_time)
    return start !== null && end !== null && start <= minutes && minutes < end
  })
}

function nowMinutes(timezone) {
  return minutesInTimezone(timezone)
}

function sortByStartTime(entries) {
  return [...(entries || [])].sort((a, b) => {
    const startA = clockMinutes(a.startTime || a.start_time) ?? 0
    const startB = clockMinutes(b.startTime || b.start_time) ?? 0
    return startA - startB
  })
}

function upcomingAfterNow(entries, timezone) {
  const current = nowMinutes(timezone)
  return sortByStartTime(entries || []).filter((entry) => {
    const start = clockMinutes(entry.startTime || entry.start_time)
    return start !== null && start > current
  })
}

function groupBy(entries, key) {
  return (entries || []).reduce((acc, item) => {
    const value = item[key]
    if (value === null || value === undefined || value === "") return acc
    acc[String(value)] = [...(acc[String(value)] || []), item]
    return acc
  }, {})
}

function classImpactFromClosure(row) {
  return String(row?.class_impact || (Number(row?.blocks_lessons) ? "ALL_CLASSES_SUSPENDED" : "NO_CLASSES_SUSPENDED")).toUpperCase()
}

function operationImpact(payload) {
  const closures = payload.schoolClosures || []
  const allSuspended = closures.find((row) => classImpactFromClosure(row) === "ALL_CLASSES_SUSPENDED")
  if (allSuspended) {
    return {
      classImpact: "ALL_CLASSES_SUSPENDED",
      schoolStatus: "CLOSED",
      operatingMode: "HOLIDAY_ALL_CLASSES_SUSPENDED",
      message: `Holiday: All classes suspended today.${allSuspended.title ? ` ${allSuspended.title}.` : ""}`,
      alertCode: "HOLIDAY_ALL_CLASSES_SUSPENDED",
      severity: "WARNING",
    }
  }
  const halfDay = closures.find((row) => classImpactFromClosure(row) === "HALF_DAY")
  if (halfDay) {
    return {
      classImpact: "HALF_DAY",
      schoolStatus: "HALF_DAY",
      operatingMode: "HOLIDAY_HALF_DAY",
      halfDayClosingTime: timeText(halfDay.half_day_closing_time || "12:00:00"),
      message: `Holiday: Half-day operations today.${halfDay.title ? ` ${halfDay.title}.` : ""}`,
      alertCode: "HOLIDAY_HALF_DAY",
      severity: "INFO",
    }
  }
  const infoEvent = (payload.events || []).find((event) => String(event.class_impact || "").toUpperCase() === "NO_CLASSES_SUSPENDED")
  if (infoEvent) {
    return {
      classImpact: "NO_CLASSES_SUSPENDED",
      schoolStatus: null,
      operatingMode: null,
      message: `Event today: Classes continue as normal.${infoEvent.title ? ` ${infoEvent.title}.` : ""}`,
      alertCode: "EVENT_CLASSES_CONTINUE",
      severity: "INFO",
    }
  }
  return null
}

function lessonsForImpact(lessons, impact) {
  if (!impact) return { activeLessons: lessons, suspendedLessons: [] }
  if (impact.classImpact === "ALL_CLASSES_SUSPENDED") {
    return { activeLessons: [], suspendedLessons: lessons }
  }
  if (impact.classImpact === "HALF_DAY") {
    const cutoff = clockMinutes(impact.halfDayClosingTime || "12:00:00")
    return (lessons || []).reduce((acc, lesson) => {
      const end = clockMinutes(lesson.endTime || lesson.end_time)
      if (cutoff !== null && end !== null && end > cutoff) acc.suspendedLessons.push(lesson)
      else acc.activeLessons.push(lesson)
      return acc
    }, { activeLessons: [], suspendedLessons: [] })
  }
  return { activeLessons: lessons, suspendedLessons: [] }
}

function lessonSummary(lesson) {
  if (!lesson) return null
  return {
    id: lesson.id,
    title: lesson.title || lesson.subjectName || lesson.entryType || "Lesson",
    classId: lesson.classId || null,
    className: lesson.className || "Class",
    subjectId: lesson.subjectId || null,
    subjectName: lesson.subjectName || lesson.title || "Lesson",
    teacherId: lesson.teacherId || null,
    teacherName: lesson.teacherName || "Unassigned teacher",
    facilityId: lesson.facilityId || null,
    facilityName: lesson.facilityName || null,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    startSlotName: lesson.startSlotName,
    endSlotName: lesson.endSlotName,
  }
}

async function loadPublishedSchoolEntries(connection, schoolId, date, weekday) {
  const [rows] = await connection.query(
    `SELECT e.id, e.cycle_week, e.entry_type, e.title, e.calendar_date, e.subject_id, e.class_id, e.stream_section, e.teacher_id,
      e.facility_id, e.room_id, c.name AS className, subj.name AS subjectName, teacher.full_name AS teacherName,
      sf.name AS facilityName, sf.facility_type AS facilityType, ss.start_time, es.end_time,
      ss.display_name AS startSlotName, es.display_name AS endSlotName
     FROM (
       SELECT pub.id
       FROM timetable_publications pub
       JOIN timetables tt ON tt.id = pub.timetable_id AND tt.school_id = pub.school_id AND tt.timetable_type = 'SCHOOL_TIMETABLE'
       WHERE pub.school_id = ? AND pub.publication_status = 'ACTIVE'
       ORDER BY pub.published_at DESC, pub.id DESC
       LIMIT 1
     ) active_pub
     JOIN timetable_publications pub ON pub.id = active_pub.id
     JOIN timetables tt ON tt.id = pub.timetable_id AND tt.school_id = pub.school_id AND tt.timetable_type = 'SCHOOL_TIMETABLE'
     JOIN timetable_entries e ON e.timetable_version_id = pub.timetable_version_id
     LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
     LEFT JOIN bell_schedule_slots ss ON ss.id = e.slot_start_id
     LEFT JOIN bell_schedule_slots es ON es.id = e.slot_end_id
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN subjects subj ON subj.id = e.subject_id
     LEFT JOIN users teacher ON teacher.id = e.teacher_id
     LEFT JOIN school_facilities sf ON sf.id = e.facility_id
     WHERE e.calendar_date = ?
      OR (
        e.calendar_date IS NULL
        AND cd.weekday = ?
        AND COALESCE(e.cycle_week, 1) = MOD(TIMESTAMPDIFF(WEEK, tt.effective_from, ?), GREATEST(COALESCE(tt.timetable_cycle_weeks, 1), 1)) + 1
      )
     ORDER BY ss.sort_order, e.id`,
    [schoolId, date, weekday, date],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    cycleWeek: Number(row.cycle_week || 1),
    entryType: row.entry_type,
    title: row.title || row.subjectName || row.entry_type,
    calendarDate: dateText(row.calendar_date) || date,
    classId: row.class_id ? String(row.class_id) : null,
    className: row.className,
    subjectId: row.subject_id ? String(row.subject_id) : null,
    subjectName: row.subjectName,
    teacherId: row.teacher_id ? String(row.teacher_id) : null,
    teacherName: row.teacherName,
    facilityId: row.facility_id ? String(row.facility_id) : null,
    facilityName: row.facilityName,
    facilityType: row.facilityType,
    startTime: timeText(row.start_time),
    endTime: timeText(row.end_time),
    startSlotName: row.startSlotName,
    endSlotName: row.endSlotName,
  }))
}

async function loadExamEntries(connection, schoolId, date) {
  const [rows] = await connection.query(
    `SELECT ete.*, a.name AS assessmentName, c.name AS className, subj.name AS subjectName, sf.name AS facilityName, sf.facility_type AS facilityType
     FROM exam_timetable_entries ete
     JOIN exam_sessions es ON es.id = ete.exam_session_id AND es.school_id = ete.school_id
     JOIN assessments a ON a.id = ete.assessment_id AND a.school_id = ete.school_id
     JOIN classes c ON c.id = ete.class_id
     JOIN subjects subj ON subj.id = ete.subject_id
     LEFT JOIN school_facilities sf ON sf.id = ete.facility_id
     WHERE ete.school_id = ? AND ete.exam_date = ? AND ete.status = 'scheduled'
       AND es.status IN ('scheduled', 'in_progress')
     ORDER BY ete.start_time, ete.id`,
    [schoolId, date],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.assessmentName || row.subjectName || "Exam",
    date: dateText(row.exam_date),
    classId: row.class_id ? String(row.class_id) : null,
    className: row.className,
    subjectId: row.subject_id ? String(row.subject_id) : null,
    subjectName: row.subjectName,
    facilityId: row.facility_id ? String(row.facility_id) : null,
    facilityName: row.facilityName || row.room,
    facilityType: row.facilityType,
    startTime: timeText(row.start_time),
    endTime: timeText(row.end_time),
  }))
}

async function buildTodayPayload(schoolId, date) {
  const weekday = weekdayFromDate(date)
  const session = await getActiveAcademicSession(schoolId)
  const [schoolEntries, examEntries, weeklyActivities, closures, events, attendance, lessonLogs, maintenance] = await Promise.all([
    loadPublishedSchoolEntries(pool, schoolId, date, weekday),
    loadExamEntries(pool, schoolId, date),
    pool.query(
      `SELECT *
       FROM weekly_school_activities
       WHERE school_id = ? AND active = 1
        AND (? IS NULL OR academic_year_id = ?)
        AND (? IS NULL OR term_id IS NULL OR term_id = ?)
        AND (weekday IS NULL OR weekday = ?)`,
      [schoolId, session.academicYearId, session.academicYearId, session.termId, session.termId, weekday],
    ).then(([rows]) => rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      activityType: row.activity_type,
      scopeType: row.scope_type,
      startTime: timeText(row.start_time),
      endTime: timeText(row.end_time),
      startSlotId: row.start_slot_id ? String(row.start_slot_id) : null,
      endSlotId: row.end_slot_id ? String(row.end_slot_id) : null,
      examPolicy: row.exam_policy,
    }))),
    pool.query("SELECT * FROM school_closure_dates WHERE school_id = ? AND closure_date = ? AND active = 1", [schoolId, date]).then(([rows]) => rows),
    pool.query(
      `SELECT *
       FROM school_events
       WHERE school_id = ? AND DATE(start_datetime) <= ? AND DATE(COALESCE(end_datetime, start_datetime)) >= ? AND status IN ('scheduled', 'active')
       ORDER BY start_datetime`,
      [schoolId, date, date],
    ).then(([rows]) => rows),
    pool.query("SELECT class_id, COUNT(*) AS marked FROM attendance_records WHERE school_id = ? AND attendance_date = ? GROUP BY class_id", [schoolId, date]).then(([rows]) => rows),
    pool.query("SELECT id, timetable_entry_id, teacher_id, class_id, subject_id, status FROM teacher_lesson_logs WHERE school_id = ? AND lesson_date = ? AND status <> 'cancelled'", [schoolId, date]).then(([rows]) => rows).catch(() => []),
    pool.query(
      `SELECT *
       FROM facility_availability_rules
       WHERE school_id = ? AND availability_status = 'MAINTENANCE'
        AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)
        AND approved_status = 'APPROVED'`,
      [schoolId, date, date],
    ).then(([rows]) => rows),
  ])
  return {
    schoolId: String(schoolId),
    date,
    timezone: process.env.SCHOOL_TIMEZONE || "Africa/Blantyre",
    activeAcademicYear: session.academicYear || null,
    activeTerm: session.term || null,
    todayBellSchedule: [],
    publishedSchoolTimetableEntries: schoolEntries,
    weeklyActivities,
    dailyAdjustments: [],
    teacherAbsences: [],
    substitutions: [],
    publishedExamTimetableEntries: examEntries,
    examSessions: [],
    facilityMaintenance: maintenance.map((row) => ({ facilityId: String(row.facility_id), reason: row.reason })),
    schoolClosures: closures,
    events,
    attendanceSessions: attendance,
    lessonLogs,
    notifications: [],
    calendarEntries: events,
    occupancy: [],
    session: sessionPayload(session),
  }
}

function fallbackToday(payload) {
  const exams = payload.publishedExamTimetableEntries || []
  const lessons = payload.publishedSchoolTimetableEntries || []
  const impact = operationImpact(payload)
  const { activeLessons: learningEntries, suspendedLessons } = lessonsForImpact(lessons.filter(isLearningEntry), impact)
  const closures = payload.schoolClosures || []
  const classesWritingExams = [...new Set(exams.map((item) => item.classId).filter(Boolean))]
  const lessonClassIds = [...new Set(learningEntries.map((item) => item.classId).filter(Boolean))]
  const classesContinuingNormalLessons = lessonClassIds.filter((id) => !classesWritingExams.includes(id))
  const closed = impact?.classImpact === "ALL_CLASSES_SUSPENDED" || closures.some((row) => Number(row.blocks_lessons) && classImpactFromClosure(row) === "ALL_CLASSES_SUSPENDED")
  const schoolStatus = impact?.schoolStatus || (closed ? "CLOSED" : exams.length ? (classesContinuingNormalLessons.length ? "PARTIAL_EXAM_DAY" : "EXAM_DAY") : "NORMAL_SCHOOL_DAY")
  const operatingMode = impact?.operatingMode || (closed ? "CLOSED" : exams.length ? (classesContinuingNormalLessons.length ? "NORMAL_WITH_EXAMS" : "EXAM_MODE_FULL_SUSPENSION") : "NORMAL_TIMETABLE")
  const alerts = []
  if (impact?.message) alerts.push({ code: impact.alertCode, message: impact.message, severity: impact.severity })
  if (exams.length) alerts.push({ code: "EXAMS_TODAY", message: `${exams.length} exam session(s) are scheduled today.`, severity: "INFO" })
  if (payload.facilityMaintenance?.length) alerts.push({ code: "FACILITY_MAINTENANCE", message: `${payload.facilityMaintenance.length} facility maintenance block(s) are active today.`, severity: "WARNING" })
  const activeLessonsNow = activeNow(learningEntries, payload.timezone).map(lessonSummary).filter(Boolean)
  const upcomingLessons = upcomingAfterNow(learningEntries, payload.timezone).map(lessonSummary).filter(Boolean)
  const teacherSchedules = groupBy(learningEntries, "teacherId")
  const currentLessonsByTeacher = groupBy(activeLessonsNow, "teacherId")
  const nextLessonsByTeacher = upcomingLessons.reduce((acc, lesson) => {
    if (lesson.teacherId && !acc[String(lesson.teacherId)]) acc[String(lesson.teacherId)] = lesson
    return acc
  }, {})
  return {
    date: payload.date,
    schoolStatus,
    operatingMode,
    activeAcademicYear: payload.activeAcademicYear,
    activeTerm: payload.activeTerm,
    operationsMessage: impact?.message || null,
    classImpact: impact?.classImpact || null,
    halfDayClosingTime: impact?.halfDayClosingTime || null,
    todayBellSchedule: [],
    currentTimeBlock: activeNow([...lessons, ...exams], payload.timezone)[0] || null,
    nextTimeBlock: null,
    wholeSchoolActivities: activeNow(payload.weeklyActivities || [], payload.timezone),
    classSchedules: learningEntries.reduce((acc, item) => {
      if (item.classId) acc[item.classId] = [...(acc[item.classId] || []), item]
      return acc
    }, {}),
    teacherSchedules,
    facilitySchedules: {},
    laboratorySchedules: {},
    examSessionsToday: exams,
    classesWritingExams,
    classesContinuingNormalLessons,
    suspendedLessons,
    substitutions: [],
    teacherAbsences: [],
    roomChanges: [],
    cancelledLessons: [],
    pendingAttendanceRegisters: payload.attendanceSessions || [],
    lessonsExpectedToBeTaught: learningEntries,
    lessonsAlreadyLogged: payload.lessonLogs || [],
    missedOrUnloggedLessons: learningEntries.filter((lesson) => !payload.lessonLogs?.some((log) => String(log.timetable_entry_id) === String(lesson.id))),
    activeLessonsNow,
    upcomingLessons,
    classesLearningNow: activeLessonsNow,
    currentLessonsByTeacher,
    nextLessonsByTeacher,
    facilitiesInUseNow: activeNow([...lessons, ...exams], payload.timezone),
    laboratoriesInUseNow: activeNow([...lessons, ...exams].filter((item) => String(item.facilityType || "").includes("LABORATORY")), payload.timezone),
    upcomingCriticalEvents: payload.events || [],
    alerts,
    recommendations: impact?.classImpact === "ALL_CLASSES_SUSPENDED"
      ? ["Keep normal lesson registers closed for today's suspended timetable."]
      : impact?.classImpact === "HALF_DAY"
        ? [`Use the morning timetable only; lessons after ${String(impact.halfDayClosingTime || "12:00").slice(0, 5)} are suspended.`]
        : alerts.some((item) => item.severity === "WARNING") ? ["Review today's operational alerts before the next period."] : [],
    solverUnavailable: true,
  }
}

function enrichTodaySnapshot(snapshot, payload) {
  const impact = operationImpact(payload)
  const { activeLessons: lessons, suspendedLessons } = lessonsForImpact((payload.publishedSchoolTimetableEntries || []).filter(isLearningEntry), impact)
  const activeLessonsNow = activeNow(lessons, payload.timezone).map(lessonSummary).filter(Boolean)
  const upcomingLessons = upcomingAfterNow(lessons, payload.timezone).map(lessonSummary).filter(Boolean)
  const classesLearningNow = activeLessonsNow
  const classesWritingExams = [...new Set((payload.publishedExamTimetableEntries || []).map((item) => item.classId).filter(Boolean))]
  const classesContinuingNormalLessons = [...new Set(lessons.map((item) => item.classId).filter(Boolean))].filter((id) => !classesWritingExams.includes(id))
  const teacherSchedules = Object.keys(snapshot.teacherSchedules || {}).length ? snapshot.teacherSchedules : groupBy(lessons, "teacherId")
  const currentLessonsByTeacher = groupBy(activeLessonsNow, "teacherId")
  const nextLessonsByTeacher = upcomingLessons.reduce((acc, lesson) => {
    if (lesson.teacherId && !acc[String(lesson.teacherId)]) acc[String(lesson.teacherId)] = lesson
    return acc
  }, {})
  return {
    ...snapshot,
    schoolStatus: impact?.schoolStatus || snapshot.schoolStatus,
    operatingMode: impact?.operatingMode || snapshot.operatingMode,
    operationsMessage: impact?.message || snapshot.operationsMessage || null,
    classImpact: impact?.classImpact || snapshot.classImpact || null,
    halfDayClosingTime: impact?.halfDayClosingTime || snapshot.halfDayClosingTime || null,
    teacherSchedules,
    classSchedules: groupBy(lessons, "classId"),
    classesContinuingNormalLessons,
    lessonsExpectedToBeTaught: lessons,
    suspendedLessons,
    alerts: impact?.message
      ? [{ code: impact.alertCode, message: impact.message, severity: impact.severity }, ...(snapshot.alerts || []).filter((item) => item.code !== impact.alertCode)]
      : snapshot.alerts,
    activeLessonsNow,
    upcomingLessons,
    classesLearningNow,
    currentLessonsByTeacher,
    nextLessonsByTeacher,
  }
}

function filterToday(snapshot, type, id) {
  if (!id) return snapshot
  const key = String(id)
  if (type === "class") {
    return {
      ...snapshot,
      classSchedules: { [key]: snapshot.classSchedules?.[key] || [] },
      examSessionsToday: (snapshot.examSessionsToday || []).filter((item) => String(item.classId) === key),
    }
  }
  if (type === "teacher") {
    return {
      ...snapshot,
      teacherSchedules: { [key]: snapshot.teacherSchedules?.[key] || [] },
      activeLessonNow: snapshot.currentLessonsByTeacher?.[key]?.[0] || null,
      upcomingLesson: snapshot.nextLessonsByTeacher?.[key] || null,
    }
  }
  if (type === "facility") {
    return {
      ...snapshot,
      facilitySchedules: { [key]: snapshot.facilitySchedules?.[key] || [] },
      examSessionsToday: (snapshot.examSessionsToday || []).filter((item) => String(item.facilityId) === key),
    }
  }
  return snapshot
}

export async function getSchoolToday(req, filter = {}) {
  const schoolId = getScopedSchoolId(req)
  const timezone = process.env.SCHOOL_TIMEZONE || "Africa/Blantyre"
  const date = req.query.date ? dateText(req.query.date) : todayInTimezone(timezone)
  const payload = await buildTodayPayload(schoolId, date)
  let snapshot
  try {
    snapshot = await TimetableSolverClient.getTodayIntelligence(payload)
  } catch (_error) {
    snapshot = fallbackToday(payload)
  }
  snapshot = enrichTodaySnapshot(snapshot, payload)
  return { today: filterToday(snapshot, filter.type, filter.id), source_payload_summary: { date, school_id: schoolId, solver_unavailable: Boolean(snapshot.solverUnavailable) } }
}

export async function getTodayExams(req) {
  const response = await getSchoolToday(req)
  return { exams: response.today.examSessionsToday || [], alerts: response.today.alerts || [] }
}

export async function getTodayAlerts(req) {
  const response = await getSchoolToday(req)
  return { alerts: response.today.alerts || [], recommendations: response.today.recommendations || [] }
}

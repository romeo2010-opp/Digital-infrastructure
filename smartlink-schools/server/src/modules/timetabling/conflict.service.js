import { pool } from "../../config/db.js"
import { HttpError } from "../../utils/http.js"
import { idValue } from "./timetabling.helpers.js"

function conflict(code, severity, title, message, metadata = {}) {
  return {
    conflictCode: code,
    severity,
    title,
    humanReadableMessage: message,
    affectedEntities: metadata.affectedEntities || [],
    affectedEntries: metadata.affectedEntries || [],
    blocking: severity === "HARD",
    suggestedAlternatives: metadata.suggestedAlternatives || [],
    metadata,
  }
}

function parseJson(value, fallback = []) {
  if (!value) return fallback
  if (Array.isArray(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

function sameText(left, right) {
  if (!left || !right) return false
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase()
}

function idMatches(ruleValue, actualValue) {
  if (!ruleValue) return true
  if (!actualValue) return false
  return Number(ruleValue) === Number(actualValue)
}

function codeSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").toUpperCase()).filter(Boolean))
}

async function loadSlot(connection, slotId) {
  const [[slot]] = await connection.query(
    `SELECT s.*, t.school_id
     FROM bell_schedule_slots s
     JOIN bell_schedule_templates t ON t.id = s.template_id
     WHERE s.id = ?
     LIMIT 1`,
    [slotId],
  )
  return slot || null
}

async function loadClassContext(connection, schoolId, classId) {
  if (!classId) return null
  const [[row]] = await connection.query("SELECT id, name, grade_level FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [classId, schoolId])
  return row || null
}

function focusAssignmentMatches(assignment, subjectId, classId, streamSection, gradeLevel) {
  if (Number(assignment.subject_id) !== Number(subjectId)) return false
  if (assignment.class_id && Number(assignment.class_id) !== Number(classId || 0)) return false
  if (assignment.stream_section && !sameText(assignment.stream_section, streamSection)) return false
  if (assignment.grade_level && !sameText(assignment.grade_level, gradeLevel)) return false
  return true
}

function focusRuleMatches(rule, assignments, subjectId, classId, streamSection, gradeLevel) {
  if (rule.subject_id && Number(rule.subject_id) !== Number(subjectId)) return false
  if (rule.focus_category_id) {
    const hasAssignment = assignments.some((assignment) => (
      Number(assignment.focus_category_id) === Number(rule.focus_category_id)
      && focusAssignmentMatches(assignment, subjectId, classId, streamSection, gradeLevel)
    ))
    if (!hasAssignment) return false
  }
  if (!rule.subject_id && !rule.focus_category_id) return false
  if (rule.class_id && Number(rule.class_id) !== Number(classId || 0)) return false
  if (rule.stream_section && !sameText(rule.stream_section, streamSection)) return false
  if (rule.grade_level && !sameText(rule.grade_level, gradeLevel)) return false
  if (rule.scope_type === "CLASS" && rule.scope_reference_id && Number(rule.scope_reference_id) !== Number(classId || 0)) return false
  if (rule.scope_type === "STREAM" && rule.scope_value && !sameText(rule.scope_value, streamSection)) return false
  if (rule.scope_type === "GRADE" && rule.scope_value && !sameText(rule.scope_value, gradeLevel)) return false
  if (rule.scope_type === "SUBJECT" && rule.scope_reference_id && Number(rule.scope_reference_id) !== Number(subjectId || 0)) return false
  return true
}

async function validateSubjectFocusRules(connection, schoolId, timetable, payload, slotContext) {
  const subjectId = idValue(payload.subject_id || payload.subjectId)
  if (!subjectId || !slotContext.startSlot || !slotContext.endSlot) return []
  const classId = idValue(payload.class_id || payload.classId)
  const streamSection = String(payload.stream_section || payload.streamSection || "").trim() || null
  const classContext = await loadClassContext(connection, schoolId, classId)
  const gradeLevel = classContext?.grade_level || null
  const [tagRows] = await connection.query(
    `SELECT bst.tag_code
     FROM bell_schedule_slot_tags bst
     JOIN bell_schedule_slots s ON s.id = bst.bell_schedule_slot_id
     WHERE bst.school_id = ? AND bst.active = 1 AND s.template_id = ?
      AND s.slot_number BETWEEN ? AND ?`,
    [schoolId, slotContext.startSlot.template_id, slotContext.startSlot.slot_number, slotContext.endSlot.slot_number],
  )
  const tags = codeSet(tagRows.map((row) => row.tag_code))
  const [[assignments], [rules]] = await Promise.all([
    connection.query(
      `SELECT *
       FROM subject_focus_assignments
       WHERE school_id = ? AND active = 1
        AND (academic_year_id IS NULL OR academic_year_id = ?)
        AND (term_id IS NULL OR term_id = ?)`,
      [schoolId, timetable.academic_year_id, timetable.term_id],
    ),
    connection.query(
      `SELECT *
       FROM subject_focus_rules
       WHERE school_id = ? AND active = 1
        AND (academic_year_id IS NULL OR academic_year_id = ?)
        AND (term_id IS NULL OR term_id = ?)`,
      [schoolId, timetable.academic_year_id, timetable.term_id],
    ),
  ])
  const conflicts = []
  rules
    .filter((rule) => focusRuleMatches(rule, assignments, subjectId, classId, streamSection, gradeLevel))
    .forEach((rule) => {
      const preferredTags = codeSet(parseJson(rule.preferred_slot_tags, []))
      const avoidedTags = codeSet(parseJson(rule.avoided_slot_tags, []))
      const preferredSlotIds = new Set(parseJson(rule.preferred_slot_ids, []).map((id) => Number(id)))
      const avoidedSlotIds = new Set(parseJson(rule.avoided_slot_ids, []).map((id) => Number(id)))
      const preferredConfigured = preferredTags.size > 0 || preferredSlotIds.size > 0
      const preferred = preferredSlotIds.has(Number(slotContext.startSlot.id)) || [...preferredTags].some((tag) => tags.has(tag))
      const avoided = avoidedSlotIds.has(Number(slotContext.startSlot.id)) || avoidedSlotIds.has(Number(slotContext.endSlot.id)) || [...avoidedTags].some((tag) => tags.has(tag))
      if (!avoided && (!preferredConfigured || preferred)) return
      const overrideAllowed = Boolean(rule.allow_override)
      const hard = rule.severity === "HARD" && (avoided || !overrideAllowed)
      conflicts.push(conflict(
        hard ? "SUBJECT_FOCUS_HARD_VIOLATION" : "SUBJECT_FOCUS_SOFT_WARNING",
        hard ? "HARD" : "SOFT",
        hard ? "Subject focus rule blocks this period" : "Subject focus warning",
        avoided
          ? `${rule.name} avoids this period's tags (${[...tags].join(", ") || "untagged period"}).`
          : `${rule.name} prefers this subject in a different tagged period.`,
        {
          affectedEntities: [{ type: "subject", id: subjectId }],
          ruleId: Number(rule.id),
          ruleName: rule.name,
          slotTags: [...tags],
          allowOverride: overrideAllowed,
        },
      ))
    })
  return conflicts
}

function streamRuleMatches(rule, subjectId, classId, streamSection, gradeLevel) {
  if (!streamSection || !subjectId) return false
  if (!idMatches(rule.subject_id, subjectId)) return false
  if (!idMatches(rule.class_id, classId)) return false
  if (rule.stream_section && !sameText(rule.stream_section, streamSection)) return false
  if (rule.grade_level && !sameText(rule.grade_level, gradeLevel)) return false
  if (rule.scope_type === "CLASS" && rule.scope_reference_id && Number(rule.scope_reference_id) !== Number(classId || 0)) return false
  if (rule.scope_type === "STREAM" && rule.scope_value && !sameText(rule.scope_value, streamSection)) return false
  if (rule.scope_type === "GRADE" && rule.scope_value && !sameText(rule.scope_value, gradeLevel)) return false
  if (rule.scope_type === "SUBJECT" && rule.scope_reference_id && Number(rule.scope_reference_id) !== Number(subjectId || 0)) return false
  return true
}

async function validateStreamSchedulingRules(connection, schoolId, timetable, version, payload, slotContext, entryId) {
  const subjectId = idValue(payload.subject_id || payload.subjectId)
  const classId = idValue(payload.class_id || payload.classId)
  const streamSection = String(payload.stream_section || payload.streamSection || "").trim() || null
  if (!subjectId || !streamSection || !slotContext.startSlot || !slotContext.endSlot) return []
  const teacherId = idValue(payload.teacher_id || payload.teacherId)
  const roomId = idValue(payload.room_id || payload.roomId)
  const facilityId = idValue(payload.facility_id || payload.facilityId)
  const cycleDayId = idValue(payload.cycle_day_id || payload.cycleDayId)
  const calendarDate = payload.calendar_date || payload.calendarDate || null
  const classContext = await loadClassContext(connection, schoolId, classId)
  const gradeLevel = classContext?.grade_level || null
  const [rules] = await connection.query(
    `SELECT *
     FROM stream_scheduling_rules
     WHERE school_id = ? AND active = 1
      AND (academic_year_id IS NULL OR academic_year_id = ?)
      AND (term_id IS NULL OR term_id = ?)`,
    [schoolId, timetable.academic_year_id, timetable.term_id],
  )
  const matchingRules = rules.filter((rule) => streamRuleMatches(rule, subjectId, classId, streamSection, gradeLevel) && rule.policy !== "ALLOW_PARALLEL_SAME_SUBJECT")
  if (!matchingRules.length) return []
  const dayClause = cycleDayId ? "e.cycle_day_id = ?" : "e.calendar_date = ?"
  const params = [version.id, subjectId, cycleDayId || calendarDate, slotContext.endSlot.slot_number, slotContext.startSlot.slot_number]
  const excludeClause = entryId ? "AND e.id <> ?" : ""
  if (entryId) params.push(entryId)
  const [parallelRows] = await connection.query(
    `SELECT e.id, e.teacher_id, e.room_id, e.facility_id, e.class_id, e.stream_section, c.grade_level,
      st.display_name AS start_slot_name, en.display_name AS end_slot_name
     FROM timetable_entries e
     JOIN bell_schedule_slots st ON st.id = e.slot_start_id
     JOIN bell_schedule_slots en ON en.id = e.slot_end_id
     LEFT JOIN classes c ON c.id = e.class_id
     WHERE e.timetable_version_id = ? AND e.subject_id = ? AND ${dayClause}
      AND e.stream_section IS NOT NULL AND e.stream_section <> ?
      AND st.slot_number <= ? AND en.slot_number >= ?
      ${excludeClause}`,
    [params[0], params[1], params[2], streamSection, params[3], params[4], ...params.slice(5)],
  )
  const conflicts = []
  matchingRules.forEach((rule) => {
    const scopedRows = parallelRows.filter((row) => {
      if (rule.class_id && Number(row.class_id) !== Number(rule.class_id)) return false
      if (rule.grade_level && !sameText(row.grade_level, rule.grade_level)) return false
      if (rule.scope_type === "GRADE" && rule.scope_value && !sameText(row.grade_level, rule.scope_value)) return false
      if (rule.scope_type === "CLASS" && rule.scope_reference_id && Number(row.class_id) !== Number(rule.scope_reference_id)) return false
      return true
    })
    if (!scopedRows.length) return
    const hard = rule.severity === "HARD"
    const severity = hard ? "HARD" : "SOFT"
    const affectedEntries = scopedRows.map((row) => Number(row.id))
    if (rule.policy === "ALLOW_ONLY_WITH_DIFFERENT_TEACHERS") {
      const teacherClash = scopedRows.find((row) => !teacherId || !row.teacher_id || Number(row.teacher_id) === Number(teacherId))
      if (teacherClash) {
        conflicts.push(conflict("STREAM_PARALLEL_SUBJECT_REQUIRES_DIFFERENT_TEACHERS", severity, "Parallel stream teacher rule", `${rule.name} requires streams taking this subject at the same time to use different teachers.`, { affectedEntries, ruleId: Number(rule.id) }))
      }
      return
    }
    if (rule.policy === "ALLOW_ONLY_WITH_DIFFERENT_ROOMS") {
      const roomClash = scopedRows.find((row) => {
        const selectedRoom = roomId || facilityId
        const existingRoom = row.room_id || row.facility_id
        return !selectedRoom || !existingRoom || Number(existingRoom) === Number(selectedRoom)
      })
      if (roomClash) {
        conflicts.push(conflict("STREAM_PARALLEL_SUBJECT_REQUIRES_DIFFERENT_ROOMS", severity, "Parallel stream room rule", `${rule.name} requires streams taking this subject at the same time to use different rooms.`, { affectedEntries, ruleId: Number(rule.id) }))
      }
      return
    }
    const limit = rule.policy === "LIMIT_PARALLEL_SAME_SUBJECT" && rule.max_parallel_count !== null ? Number(rule.max_parallel_count || 1) : 1
    if (scopedRows.length + 1 > Math.max(1, limit)) {
      conflicts.push(conflict(
        rule.policy === "LIMIT_PARALLEL_SAME_SUBJECT" ? "STREAM_PARALLEL_SUBJECT_LIMIT_EXCEEDED" : "STREAM_PARALLEL_SUBJECT_FORBIDDEN",
        severity,
        "Parallel stream subject rule",
        rule.policy === "LIMIT_PARALLEL_SAME_SUBJECT"
          ? `${rule.name} allows only ${limit} stream(s) to take this subject at the same time.`
          : `${rule.name} does not allow streams to take this subject at the same time.`,
        { affectedEntries, ruleId: Number(rule.id), allowedCount: limit, selectedCount: scopedRows.length + 1 },
      ))
    }
  })
  return conflicts
}

async function loadDayTemplate(connection, timetableId, cycleDayId) {
  if (!cycleDayId) return null
  const [[template]] = await connection.query(
    `SELECT dt.bell_template_id, cd.display_name AS day_name, b.name AS template_name
     FROM timetable_day_templates dt
     JOIN timetable_cycle_days cd ON cd.id = dt.cycle_day_id
     JOIN bell_schedule_templates b ON b.id = dt.bell_template_id
     WHERE dt.timetable_id = ? AND dt.cycle_day_id = ? AND dt.active = 1
     LIMIT 1`,
    [timetableId, cycleDayId],
  )
  return template || null
}

export async function validateTimetableEntry(connection, schoolId, timetable, version, payload, options = {}) {
  const entryId = idValue(payload.id || payload.entry_id)
  const ignoredWeeklyActivityId = idValue(options.ignoreWeeklyActivityId || options.ignore_weekly_activity_id)
  const slotStartId = idValue(payload.slot_start_id || payload.slotStartId, "slot_start_id", true)
  const slotEndId = idValue(payload.slot_end_id || payload.slotEndId || slotStartId, "slot_end_id", true)
  const cycleDayId = idValue(payload.cycle_day_id || payload.cycleDayId)
  const classId = idValue(payload.class_id || payload.classId)
  const teacherId = idValue(payload.teacher_id || payload.teacherId)
  const roomId = idValue(payload.room_id || payload.roomId)
  const facilityId = idValue(payload.facility_id || payload.facilityId)
  const subjectId = idValue(payload.subject_id || payload.subjectId)
  const streamSection = String(payload.stream_section || payload.streamSection || "").trim() || null
  const calendarDate = payload.calendar_date || payload.calendarDate || null
  const entryType = String(payload.entry_type || payload.entryType || "LESSON").toUpperCase()
  const conflicts = []

  const [startSlot, endSlot, dayTemplate] = await Promise.all([
    loadSlot(connection, slotStartId),
    loadSlot(connection, slotEndId),
    loadDayTemplate(connection, timetable.id, cycleDayId),
  ])
  if (!startSlot || Number(startSlot.school_id) !== Number(schoolId)) {
    conflicts.push(conflict("INVALID_START_SLOT", "HARD", "Invalid start slot", "The selected start period does not belong to this school."))
  }
  if (!endSlot || Number(endSlot.school_id) !== Number(schoolId)) {
    conflicts.push(conflict("INVALID_END_SLOT", "HARD", "Invalid end slot", "The selected end period does not belong to this school."))
  }
  if (startSlot && endSlot && Number(endSlot.slot_number) < Number(startSlot.slot_number)) {
    conflicts.push(conflict("INVALID_SLOT_RANGE", "HARD", "Invalid period range", "The ending period must be the same as or after the starting period."))
  }
  if (startSlot && endSlot && entryType === "LESSON" && (!startSlot.teaching_allowed || !endSlot.teaching_allowed)) {
    conflicts.push(conflict("NON_TEACHING_SLOT", "HARD", "Non-teaching period", "Ordinary lessons cannot be placed inside break, lunch or closed periods."))
  }
  if (dayTemplate && startSlot && endSlot && (Number(startSlot.template_id) !== Number(dayTemplate.bell_template_id) || Number(endSlot.template_id) !== Number(dayTemplate.bell_template_id))) {
    conflicts.push(conflict(
      "DAY_BELL_TEMPLATE_MISMATCH",
      "HARD",
      "Period is not available on this day",
      `${dayTemplate.day_name || "This day"} uses ${dayTemplate.template_name || "a different bell schedule"}. Pick a period from that day's bell schedule.`,
      { affectedEntities: [{ type: "cycle_day", id: cycleDayId }, { type: "bell_template", id: Number(dayTemplate.bell_template_id) }] },
    ))
  }

  if (cycleDayId) {
    const [[cycleDay]] = await connection.query(
      "SELECT id FROM timetable_cycle_days WHERE id = ? AND timetable_id = ? AND active = 1 LIMIT 1",
      [cycleDayId, timetable.id],
    )
    if (!cycleDay) conflicts.push(conflict("INVALID_CYCLE_DAY", "HARD", "Invalid cycle day", "The selected cycle day does not belong to this timetable."))
  }

  if (!cycleDayId && !calendarDate) {
    conflicts.push(conflict("MISSING_DAY", "HARD", "Missing timetable day", "Select a cycle day or calendar date for this timetable entry."))
  }

  if (classId) {
    const [[row]] = await connection.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [classId, schoolId])
    if (!row) conflicts.push(conflict("INVALID_CLASS", "HARD", "Invalid class", "The selected class does not belong to this school."))
  }
  if (subjectId) {
    const [[row]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [subjectId, schoolId])
    if (!row) conflicts.push(conflict("INVALID_SUBJECT", "HARD", "Invalid subject", "The selected subject does not belong to this school."))
  }
  if (teacherId) {
    const [[row]] = await connection.query(
      "SELECT id, full_name FROM users WHERE id = ? AND school_id = ? AND role IN ('teacher', 'headteacher', 'school_owner') AND is_active = 1 LIMIT 1",
      [teacherId, schoolId],
    )
    if (!row) conflicts.push(conflict("INVALID_TEACHER", "HARD", "Invalid teacher", "The selected teacher is not active in this school."))
  }
  if (roomId) {
    const [[row]] = await connection.query("SELECT id FROM timetable_rooms WHERE id = ? AND school_id = ? AND active = 1 LIMIT 1", [roomId, schoolId])
    if (!row) conflicts.push(conflict("INVALID_ROOM", "HARD", "Invalid room", "The selected room does not belong to this school."))
  }
  if (facilityId) {
    const [[row]] = await connection.query("SELECT * FROM school_facilities WHERE id = ? AND school_id = ? AND active = 1 LIMIT 1", [facilityId, schoolId])
    if (!row) {
      conflicts.push(conflict("INVALID_FACILITY", "HARD", "Invalid facility", "The selected facility is not active in this school."))
    } else {
      if (entryType.includes("EXAM") && !Number(row.can_host_examinations)) {
        conflicts.push(conflict("FACILITY_NOT_EXAM_ENABLED", "HARD", "Facility cannot host exams", `${row.name} is not enabled for examinations.`, { affectedEntities: [{ type: "facility", id: facilityId }] }))
      }
      if (!entryType.includes("EXAM") && !Number(row.can_host_normal_lessons)) {
        conflicts.push(conflict("FACILITY_NOT_LESSON_ENABLED", "HARD", "Facility cannot host lessons", `${row.name} is not enabled for normal lessons.`, { affectedEntities: [{ type: "facility", id: facilityId }] }))
      }
      if ((entryType.includes("LABORATORY") || entryType.includes("PRACTICAL")) && !String(row.facility_type || "").includes("LABORATORY") && !["WORKSHOP", "HOME_ECONOMICS_ROOM", "AGRICULTURE_FACILITY"].includes(String(row.facility_type || ""))) {
        conflicts.push(conflict("FACILITY_NOT_LABORATORY", "HARD", "Laboratory required", `${row.name} is not configured as a laboratory or practical facility.`, { affectedEntities: [{ type: "facility", id: facilityId }] }))
      }
      if (subjectId) {
        const [[eligibilityCount]] = await connection.query("SELECT COUNT(*) AS total FROM facility_subject_eligibility WHERE school_id = ? AND facility_id = ? AND active = 1", [schoolId, facilityId])
        if (Number(eligibilityCount.total || 0) > 0) {
          const [[eligible]] = await connection.query(
            "SELECT id FROM facility_subject_eligibility WHERE school_id = ? AND facility_id = ? AND subject_id = ? AND active = 1 LIMIT 1",
            [schoolId, facilityId, subjectId],
          )
          if (!eligible) {
            conflicts.push(conflict("SUBJECT_NOT_SUPPORTED_BY_FACILITY", "HARD", "Subject not supported", `${row.name} is not configured to support this subject.`, { affectedEntities: [{ type: "facility", id: facilityId }] }))
          }
        }
      }
      if (classId && row.normal_capacity) {
        const [[classSize]] = await connection.query(
          `SELECT COUNT(*) AS students
           FROM student_enrollments
           WHERE school_id = ? AND class_id = ? AND enrollment_status = 'active'`,
          [schoolId, classId],
        )
        if (Number(classSize.students || 0) > Number(row.normal_capacity || 0)) {
          conflicts.push(conflict("FACILITY_CAPACITY_EXCEEDED", "HARD", "Facility capacity exceeded", `${row.name} holds ${row.normal_capacity} learners, but this class has ${Number(classSize.students || 0)} active learners.`, { affectedEntities: [{ type: "facility", id: facilityId }] }))
        }
      }
    }
  }

  if (conflicts.some((item) => item.blocking)) return conflicts

  const dayClause = cycleDayId
    ? "e.cycle_day_id = ?"
    : "e.calendar_date = ?"
  const dayParam = cycleDayId || calendarDate
  const entryExclusion = entryId ? " AND e.id <> ?" : ""
  const sourceActivityExclusion = ignoredWeeklyActivityId ? " AND (e.source_weekly_activity_id IS NULL OR e.source_weekly_activity_id <> ?)" : ""
  const params = [timetable.id, version.id, dayParam, endSlot.slot_number, startSlot.slot_number, ...(entryId ? [entryId] : []), ...(ignoredWeeklyActivityId ? [ignoredWeeklyActivityId] : [])]
  const skipVersionEntryOverlaps = Boolean(options.skipVersionEntryOverlaps || options.skip_version_entry_overlaps)

  const [overlaps] = skipVersionEntryOverlaps
    ? [[]]
    : await connection.query(
      `SELECT e.id, e.title, e.entry_type, e.teacher_id, e.class_id, e.stream_section, e.room_id, e.facility_id,
        st.slot_number AS start_number, en.slot_number AS end_number,
        teacher.full_name AS teacher_name, c.name AS class_name, r.name AS room_name, sf.name AS facility_name
       FROM timetable_entries e
       JOIN bell_schedule_slots st ON st.id = e.slot_start_id
       JOIN bell_schedule_slots en ON en.id = e.slot_end_id
       LEFT JOIN timetable_day_templates edt ON edt.timetable_id = ? AND edt.cycle_day_id = e.cycle_day_id AND edt.active = 1
       LEFT JOIN users teacher ON teacher.id = e.teacher_id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN timetable_rooms r ON r.id = e.room_id
       LEFT JOIN school_facilities sf ON sf.id = e.facility_id
       WHERE e.timetable_version_id = ? AND ${dayClause}
         AND (edt.bell_template_id IS NULL OR (st.template_id = edt.bell_template_id AND en.template_id = edt.bell_template_id))
         AND st.slot_number <= ? AND en.slot_number >= ?${entryExclusion}${sourceActivityExclusion}`,
      params,
    )

  overlaps.forEach((row) => {
    if (teacherId && Number(row.teacher_id) === Number(teacherId)) {
      conflicts.push(conflict(
        "TEACHER_TIME_CLASH",
        "HARD",
        "Teacher clash",
        `${row.teacher_name || "This teacher"} is already assigned during this period.`,
        { affectedEntries: [Number(row.id)], affectedEntities: [{ type: "teacher", id: teacherId }] },
      ))
    }
    if (classId && Number(row.class_id) === Number(classId) && (!streamSection || !row.stream_section || String(row.stream_section) === streamSection)) {
      conflicts.push(conflict(
        "CLASS_TIME_CLASH",
        "HARD",
        "Class clash",
        `${row.class_name || "This class"} already has a timetable entry during this period.`,
        { affectedEntries: [Number(row.id)], affectedEntities: [{ type: "class", id: classId }] },
      ))
    }
    if (roomId && Number(row.room_id) === Number(roomId)) {
      conflicts.push(conflict(
        "ROOM_TIME_CLASH",
        "HARD",
        "Room clash",
        `${row.room_name || "This room"} is already occupied during this period.`,
        { affectedEntries: [Number(row.id)], affectedEntities: [{ type: "room", id: roomId }] },
      ))
    }
    if (facilityId && Number(row.facility_id) === Number(facilityId)) {
      conflicts.push(conflict(
        "FACILITY_TIME_CLASH",
        "HARD",
        "Facility clash",
        `${row.facility_name || "This facility"} is already reserved during this period.`,
        { affectedEntries: [Number(row.id)], affectedEntities: [{ type: "facility", id: facilityId }] },
      ))
    }
  })

  if (facilityId || classId || teacherId) {
    const [activityRows] = await connection.query(
      `SELECT wsa.id, wsa.name, wsa.scope_type, wsa.facility_id, wsa.responsible_teacher_id,
        ss.display_name AS start_slot_name, es.display_name AS end_slot_name
       FROM weekly_school_activities wsa
       LEFT JOIN bell_schedule_slots ss ON ss.id = wsa.start_slot_id
       LEFT JOIN bell_schedule_slots es ON es.id = wsa.end_slot_id
       WHERE wsa.school_id = ? AND wsa.active = 1 AND wsa.blocks_normal_lessons = 1
        AND (? IS NULL OR wsa.id <> ?)
        AND (? IS NULL OR wsa.cycle_day_id IS NULL OR wsa.cycle_day_id = ?)
        AND (? IS NULL OR wsa.weekday IS NULL)
        AND (wsa.start_slot_id IS NULL OR wsa.end_slot_id IS NULL OR (
          (SELECT slot_number FROM bell_schedule_slots WHERE id = wsa.start_slot_id) <= ?
          AND (SELECT slot_number FROM bell_schedule_slots WHERE id = wsa.end_slot_id) >= ?
        ))
        AND (
          (? IS NOT NULL AND wsa.facility_id = ?)
          OR (? IS NOT NULL AND wsa.responsible_teacher_id = ?)
          OR (? IS NOT NULL AND wsa.scope_type = 'WHOLE_SCHOOL')
          OR (? IS NOT NULL AND EXISTS (
            SELECT 1 FROM weekly_school_activity_scope_assignments scope
            WHERE scope.activity_id = wsa.id AND scope.scope_type = 'SELECTED_CLASSES' AND scope.scope_reference_id = ?
          ))
        )
       LIMIT 10`,
      [
        schoolId,
        ignoredWeeklyActivityId,
        ignoredWeeklyActivityId,
        cycleDayId,
        cycleDayId,
        calendarDate,
        endSlot.slot_number,
        startSlot.slot_number,
        facilityId,
        facilityId,
        teacherId,
        teacherId,
        classId,
        classId,
        classId,
      ],
    )
    activityRows.forEach((row) => {
      conflicts.push(conflict(
        "WEEKLY_ACTIVITY_BLOCK",
        "HARD",
        "Weekly activity conflict",
        `${row.name} blocks this timetable slot${row.start_slot_name ? ` from ${row.start_slot_name} to ${row.end_slot_name || row.start_slot_name}` : ""}.`,
        { affectedEntries: [], affectedEntities: [{ type: "weekly_activity", id: Number(row.id) }] },
      ))
    })
  }

  if (teacherId) {
    const [blockedRules] = await connection.query(
      `SELECT id, reason
       FROM teacher_availability_rules
       WHERE school_id = ? AND teacher_id = ? AND approved_status = 'APPROVED'
        AND availability_status = 'UNAVAILABLE'
        AND (? IS NULL OR cycle_day_id IS NULL OR cycle_day_id = ?)
        AND (? IS NULL OR weekday IS NULL)
        AND (slot_start_id IS NULL OR slot_end_id IS NULL OR (
          (SELECT slot_number FROM bell_schedule_slots WHERE id = slot_start_id) <= ?
          AND (SELECT slot_number FROM bell_schedule_slots WHERE id = slot_end_id) >= ?
        ))
       LIMIT 5`,
      [schoolId, teacherId, cycleDayId, cycleDayId, calendarDate, endSlot.slot_number, startSlot.slot_number],
    )
    blockedRules.forEach((rule) => {
      conflicts.push(conflict(
        "TEACHER_UNAVAILABLE",
        "HARD",
        "Teacher unavailable",
        rule.reason || "The selected teacher is unavailable during this period.",
        { affectedEntities: [{ type: "teacher", id: teacherId }] },
      ))
    })
  }

  conflicts.push(...await validateSubjectFocusRules(connection, schoolId, timetable, payload, { startSlot, endSlot }))
  conflicts.push(...await validateStreamSchedulingRules(connection, schoolId, timetable, version, payload, { startSlot, endSlot }, entryId))

  if (options.persistSoftWarnings && conflicts.length) {
    await persistConflicts(connection, schoolId, version.id, conflicts)
  }
  return conflicts
}

export async function persistConflicts(connection, schoolId, versionId, conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return
  await connection.query("DELETE FROM timetable_conflicts WHERE school_id = ? AND timetable_version_id = ? AND resolved = 0", [schoolId, versionId])
  for (const item of conflicts) {
    await connection.query(
      `INSERT INTO timetable_conflicts (
        school_id, timetable_version_id, conflict_code, severity, affected_entity_type,
        affected_entity_ids, entry_ids, human_message, resolution_suggestions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        versionId,
        item.conflictCode,
        item.severity,
        item.affectedEntities?.[0]?.type || "timetable",
        JSON.stringify(item.affectedEntities || []),
        JSON.stringify(item.affectedEntries || []),
        item.humanReadableMessage,
        JSON.stringify(item.suggestedAlternatives || []),
      ],
    )
  }
}

export async function listVersionConflicts(schoolId, versionId) {
  const [rows] = await pool.query(
    `SELECT *
     FROM timetable_conflicts
     WHERE school_id = ? AND timetable_version_id = ?
     ORDER BY resolved ASC, severity ASC, created_at DESC`,
    [schoolId, versionId],
  )
  return rows.map((row) => ({
    ...row,
    message: row.human_message,
    title: row.conflict_code,
    affected_entity_ids: row.affected_entity_ids ? JSON.parse(row.affected_entity_ids) : [],
    entry_ids: row.entry_ids ? JSON.parse(row.entry_ids) : [],
    resolution_suggestions: row.resolution_suggestions ? JSON.parse(row.resolution_suggestions) : [],
  }))
}

export function assertNoBlockingConflicts(conflicts) {
  const firstHardConflict = conflicts.find((item) => item.blocking || item.severity === "HARD")
  if (firstHardConflict) {
    const reason = firstHardConflict.humanReadableMessage || firstHardConflict.human_message || firstHardConflict.message || firstHardConflict.conflict_code || firstHardConflict.conflictCode
    throw new HttpError(409, `Resolve hard timetable conflicts before continuing: ${reason}`)
  }
}

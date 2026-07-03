import { pool } from "../../config/db.js"
import { HttpError } from "../../utils/http.js"
import { getScopedSchoolId } from "../../utils/tenantScope.js"
import { recordTimetableAudit } from "./audit.service.js"
import { validateTimetableEntry, assertNoBlockingConflicts } from "./conflict.service.js"
import { editableVersionOrThrow, normalizeTimetable, normalizeVersion } from "./timetabling.helpers.js"

const FACILITY_TYPES = new Set([
  "CLASSROOM",
  "SCIENCE_LABORATORY",
  "BIOLOGY_LABORATORY",
  "CHEMISTRY_LABORATORY",
  "PHYSICS_LABORATORY",
  "GENERAL_LABORATORY",
  "COMPUTER_LABORATORY",
  "LANGUAGE_LABORATORY",
  "LIBRARY",
  "WORKSHOP",
  "ART_ROOM",
  "MUSIC_ROOM",
  "HOME_ECONOMICS_ROOM",
  "AGRICULTURE_FACILITY",
  "SPORTS_GROUND",
  "HALL",
  "MEETING_ROOM",
  "SPECIAL_NEEDS_ROOM",
  "EXAMINATION_ROOM",
  "CUSTOM",
])

const ACTIVITY_TYPES = new Set([
  "ASSEMBLY",
  "CHAPEL",
  "RELIGIOUS_PROGRAMME",
  "CLUB",
  "SPORTS",
  "GUIDANCE_COUNSELLING",
  "LIBRARY_PROGRAMME",
  "WEEKLY_TEST",
  "REMEDIAL",
  "STAFF_MEETING",
  "DEPARTMENT_MEETING",
  "STUDY",
  "CLEANING",
  "BROADCAST",
  "STUDENT_LEADERSHIP",
  "CUSTOM",
])

const EXAM_POLICIES = new Set([
  "CONTINUE_DURING_EXAMS",
  "SUSPEND_DURING_EXAMS",
  "REQUIRE_MANUAL_DECISION",
  "MOVE_TO_ALTERNATIVE_TIME",
  "EXAMS_CANNOT_OVERRIDE",
])

const CURRICULUM_ENTRY_TYPES = new Set([
  "LESSON",
  "SUBJECT_LESSON",
  "PRACTICAL_LESSON",
  "LABORATORY_LESSON",
  "COMPUTER_LESSON",
  "STUDY",
  "CUSTOM",
])

const BELL_SLOT_TYPES = new Set([
  "TEACHING_PERIOD",
  "BREAK",
  "LUNCH",
  "ASSEMBLY",
  "CHAPEL",
  "CLUB",
  "SPORTS",
  "STAFF_MEETING",
  "STUDY",
  "CUSTOM",
  "CLOSED",
])

const BELL_SLOT_TAGS = new Set([
  "MORNING_FOCUS",
  "EARLY_MORNING",
  "LATE_MORNING",
  "BEFORE_LUNCH",
  "AFTER_LUNCH",
  "AFTERNOON",
  "LAST_PERIOD",
  "DOUBLE_PERIOD_FRIENDLY",
  "PRACTICAL_FRIENDLY",
  "LOW_FOCUS",
  "CUSTOM",
])

const SUBJECT_FOCUS_SCOPE_TYPES = new Set([
  "WHOLE_SCHOOL",
  "GRADE",
  "CLASS",
  "STREAM",
  "SUBJECT",
  "DEPARTMENT",
  "CUSTOM",
])

const RULE_SEVERITIES = new Set(["HARD", "SOFT"])

const STREAM_RULE_SCOPE_TYPES = new Set([
  "WHOLE_SCHOOL",
  "GRADE",
  "CLASS",
  "STREAM",
  "SUBJECT",
  "CUSTOM",
])

const STREAM_RULE_POLICIES = new Set([
  "DISALLOW_PARALLEL_SAME_SUBJECT",
  "ALLOW_PARALLEL_SAME_SUBJECT",
  "ALLOW_ONLY_WITH_DIFFERENT_TEACHERS",
  "ALLOW_ONLY_WITH_DIFFERENT_ROOMS",
  "LIMIT_PARALLEL_SAME_SUBJECT",
])

const TAG_LABELS = {
  MORNING_FOCUS: "Morning focus",
  EARLY_MORNING: "Early morning",
  LATE_MORNING: "Late morning",
  BEFORE_LUNCH: "Before lunch",
  AFTER_LUNCH: "After lunch",
  AFTERNOON: "Afternoon",
  LAST_PERIOD: "Last period",
  DOUBLE_PERIOD_FRIENDLY: "Double period friendly",
  PRACTICAL_FRIENDLY: "Practical friendly",
  LOW_FOCUS: "Low focus",
  CUSTOM: "Custom",
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim()
  return text || fallback
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true"
}

function idValue(value, label = "id", required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${label} is required`)
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new HttpError(400, `${label} must be a valid id`)
  return parsed
}

function intValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

function positiveIntValue(value, label, fallback = 1) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new HttpError(400, `${label} must be greater than zero`)
  return Math.floor(parsed)
}

function optionalIntValue(value, label) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new HttpError(400, `${label} must be zero or greater`)
  return Math.floor(parsed)
}

function jsonText(value, fallback = null) {
  if (value === undefined) return fallback === null ? null : JSON.stringify(fallback)
  if (value === null) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

function jsonArrayText(value) {
  if (value === undefined || value === null || value === "") return JSON.stringify([])
  if (Array.isArray(value)) return JSON.stringify(value.filter((item) => item !== undefined && item !== null && item !== ""))
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return JSON.stringify([])
    if (text.startsWith("[") || text.startsWith("{")) return text
    return JSON.stringify(text.split(",").map((item) => item.trim()).filter(Boolean))
  }
  return JSON.stringify([value])
}

function codeArray(value, allowed = null) {
  const parsed = parseJson(jsonArrayText(value), [])
  return [...new Set(
    (Array.isArray(parsed) ? parsed : [])
      .map((item) => cleanText(typeof item === "object" ? item.tag_code || item.code : item).toUpperCase())
      .filter((item) => item && (!allowed || allowed.has(item))),
  )]
}

function enumValue(value, values, fallback) {
  const normalized = cleanText(value, fallback).toUpperCase()
  return values.has(normalized) ? normalized : fallback
}

function dateOnly(value) {
  if (!value) return null
  return String(value).slice(0, 10)
}

function timeText(value) {
  if (!value) return null
  return String(value).slice(0, 8)
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

function isLaboratoryType(type) {
  return String(type || "").includes("LABORATORY") || ["WORKSHOP", "HOME_ECONOMICS_ROOM", "AGRICULTURE_FACILITY"].includes(String(type || ""))
}

function defaultCanHostWrittenExams(type) {
  return isLaboratoryType(type) || ["CLASSROOM", "HALL", "LIBRARY", "MEETING_ROOM", "EXAMINATION_ROOM"].includes(String(type || ""))
}

function activityEntryType(type) {
  if (["ASSEMBLY", "CHAPEL", "SPORTS", "CLUB", "STUDY", "STAFF_MEETING"].includes(type)) return type
  if (type === "RELIGIOUS_PROGRAMME") return "RELIGIOUS_PROGRAMME"
  return "WEEKLY_ACTIVITY"
}

async function loadFacility(connection, schoolId, facilityId) {
  const [[facility]] = await connection.query(
    "SELECT * FROM school_facilities WHERE school_id = ? AND id = ? LIMIT 1",
    [schoolId, facilityId],
  )
  return normalizeFacility(facility)
}

function normalizeFacility(row) {
  if (!row) return null
  return {
    ...row,
    accessible: row.accessible ?? row.is_accessible ?? 0,
  }
}

async function loadTimetable(connection, schoolId, timetableId) {
  const [[row]] = await connection.query(
    `SELECT tt.*, ay.name AS academic_year_name, t.name AS term_name
     FROM timetables tt
     JOIN academic_years ay ON ay.id = tt.academic_year_id AND ay.school_id = tt.school_id
     LEFT JOIN terms t ON t.id = tt.term_id AND t.school_id = tt.school_id
     WHERE tt.school_id = ? AND tt.id = ?
     LIMIT 1`,
    [schoolId, timetableId],
  )
  return normalizeTimetable(row)
}

async function loadVersion(connection, timetableId, versionId) {
  const [[row]] = await connection.query("SELECT * FROM timetable_versions WHERE timetable_id = ? AND id = ? LIMIT 1", [timetableId, versionId])
  return normalizeVersion(row)
}

async function loadSlot(connection, slotId) {
  if (!slotId) return null
  const [[slot]] = await connection.query(
    `SELECT s.*, b.school_id, b.timetable_id
     FROM bell_schedule_slots s
     JOIN bell_schedule_templates b ON b.id = s.template_id
     WHERE s.id = ?
     LIMIT 1`,
    [slotId],
  )
  return slot || null
}

async function loadBellTemplate(connection, schoolId, templateId) {
  const [[template]] = await connection.query(
    `SELECT b.*, tt.name AS timetable_name, tt.timetable_type
     FROM bell_schedule_templates b
     LEFT JOIN timetables tt ON tt.id = b.timetable_id AND tt.school_id = b.school_id
     WHERE b.school_id = ? AND b.id = ?
     LIMIT 1`,
    [schoolId, templateId],
  )
  return template || null
}

async function requireScopedRow(connection, sql, params, message) {
  const [[row]] = await connection.query(sql, params)
  if (!row) throw new HttpError(400, message)
  return row
}

function timeMinutes(value) {
  const text = timeText(value)
  if (!text) return null
  const [hours, minutes, seconds] = text.split(":").map((part) => Number(part || 0))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  return hours * 60 + minutes + Math.floor(seconds / 60)
}

async function assertTimetableForBellTemplate(connection, schoolId, timetableId) {
  if (!timetableId) return null
  const [[timetable]] = await connection.query("SELECT id, name, timetable_type FROM timetables WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, timetableId])
  if (!timetable) throw new HttpError(400, "Timetable was not found for this school.")
  return timetable
}

function bellTemplatePayload(req, schoolId, current = {}) {
  const name = cleanText(req.body.name || current.name)
  if (!name) throw new HttpError(400, "Bell schedule name is required")
  return {
    school_id: schoolId,
    timetable_id: idValue(req.body.timetable_id || req.body.timetableId || current.timetable_id),
    name,
    description: cleanText(req.body.description || current.description) || null,
    shift_id: cleanText(req.body.shift_id || req.body.shiftId || current.shift_id) || null,
    is_default: boolValue(req.body.is_default ?? req.body.isDefault, Boolean(current.is_default)),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
  }
}

function defaultTeachingAllowed(slotType, value, fallback) {
  if (value !== undefined && value !== null && value !== "") return boolValue(value)
  if (fallback !== undefined) return Boolean(fallback)
  return !["BREAK", "LUNCH", "CLOSED"].includes(slotType)
}

function bellSlotPayload(req, current = {}) {
  const slotType = enumValue(req.body.slot_type || req.body.slotType || current.slot_type, BELL_SLOT_TYPES, current.slot_type || "TEACHING_PERIOD")
  const startTime = timeText(req.body.start_time || req.body.startTime || current.start_time)
  const endTime = timeText(req.body.end_time || req.body.endTime || current.end_time)
  const startMinutes = timeMinutes(startTime)
  const endMinutes = timeMinutes(endTime)
  if (startMinutes === null) throw new HttpError(400, "Start time is required")
  if (endMinutes === null) throw new HttpError(400, "End time is required")
  if (endMinutes <= startMinutes) throw new HttpError(400, "Period end time must be after start time")
  const slotNumber = positiveIntValue(req.body.slot_number ?? req.body.slotNumber ?? current.slot_number, "slot_number", 1)
  const code = cleanText(req.body.code || current.code, `P${slotNumber}`).toUpperCase()
  const displayName = cleanText(req.body.display_name || req.body.displayName || current.display_name, code)
  return {
    slot_number: slotNumber,
    code,
    display_name: displayName,
    start_time: startTime,
    end_time: endTime,
    slot_type: slotType,
    teaching_allowed: defaultTeachingAllowed(slotType, req.body.teaching_allowed ?? req.body.teachingAllowed, current.teaching_allowed) ? 1 : 0,
    can_span: boolValue(req.body.can_span ?? req.body.canSpan, current.can_span === undefined ? !["BREAK", "LUNCH", "CLOSED"].includes(slotType) : Boolean(current.can_span)) ? 1 : 0,
    sort_order: intValue(req.body.sort_order ?? req.body.sortOrder ?? current.sort_order, slotNumber),
  }
}

async function assertNoBellSlotOverlap(connection, templateId, payload, excludeSlotId = null) {
  const startMinutes = timeMinutes(payload.start_time)
  const endMinutes = timeMinutes(payload.end_time)
  const [slots] = await connection.query(
    `SELECT id, display_name, start_time, end_time
     FROM bell_schedule_slots
     WHERE template_id = ?
     ORDER BY start_time, sort_order, slot_number`,
    [templateId],
  )
  const overlap = slots.find((slot) => {
    if (excludeSlotId && Number(slot.id) === Number(excludeSlotId)) return false
    const slotStart = timeMinutes(slot.start_time)
    const slotEnd = timeMinutes(slot.end_time)
    if (slotStart === null || slotEnd === null || startMinutes === null || endMinutes === null) return false
    return slotStart < endMinutes && slotEnd > startMinutes
  })
  if (overlap) {
    throw new HttpError(409, `${payload.display_name} (${timeText(payload.start_time)}-${timeText(payload.end_time)}) overlaps ${overlap.display_name} (${timeText(overlap.start_time)}-${timeText(overlap.end_time)}).`)
  }
}

async function assertBellSlotCanDelete(connection, slotId) {
  const [[entryCount], [activityCount], [availabilityCount], [adjustmentCount], [dayTemplateCount]] = await Promise.all([
    connection.query("SELECT COUNT(*) AS total FROM timetable_entries WHERE slot_start_id = ? OR slot_end_id = ?", [slotId, slotId]),
    connection.query("SELECT COUNT(*) AS total FROM weekly_school_activities WHERE start_slot_id = ? OR end_slot_id = ?", [slotId, slotId]),
    connection.query("SELECT COUNT(*) AS total FROM facility_availability_rules WHERE slot_start_id = ? OR slot_end_id = ?", [slotId, slotId]),
    connection.query("SELECT COUNT(*) AS total FROM daily_schedule_adjustments WHERE replacement_slot_start_id = ? OR replacement_slot_end_id = ?", [slotId, slotId]),
    connection.query(
      `SELECT COUNT(*) AS total
       FROM timetable_day_templates dt
       JOIN bell_schedule_slots s ON s.template_id = dt.bell_template_id
       WHERE s.id = ?`,
      [slotId],
    ),
  ])
  const uses = [
    ["timetable entries", Number(entryCount[0]?.total || 0)],
    ["weekly activities", Number(activityCount[0]?.total || 0)],
    ["facility availability rules", Number(availabilityCount[0]?.total || 0)],
    ["daily adjustments", Number(adjustmentCount[0]?.total || 0)],
    ["assigned day templates", Number(dayTemplateCount[0]?.total || 0)],
  ].filter(([, total]) => total > 0)
  if (uses.length) {
    throw new HttpError(409, `This period is already used by ${uses.map(([label]) => label).join(", ")}. Edit it instead of deleting it.`)
  }
}

function curriculumPayload(req, schoolId, current = {}) {
  const entryType = enumValue(req.body.entry_type || req.body.entryType || current.entry_type, CURRICULUM_ENTRY_TYPES, current.entry_type || "LESSON")
  const classId = idValue(req.body.class_id || req.body.classId || current.class_id)
  const streamSection = cleanText(req.body.stream_section || req.body.streamSection || current.stream_section) || null
  const studentGroupId = idValue(req.body.student_group_id || req.body.studentGroupId || current.student_group_id)
  const subjectId = idValue(req.body.subject_id || req.body.subjectId || current.subject_id)
  const teacherId = idValue(req.body.teacher_id || req.body.teacherId || current.teacher_id)
  const blockLength = positiveIntValue(req.body.block_length ?? req.body.blockLength ?? current.block_length, "block_length", 1)
  const periodsPerCycle = positiveIntValue(req.body.periods_per_cycle ?? req.body.periodsPerCycle ?? current.periods_per_cycle, "periods_per_cycle", blockLength)
  if (!classId && !streamSection && !studentGroupId) throw new HttpError(400, "Choose a class, stream, or student group for the curriculum requirement.")
  if (!subjectId && !["STUDY", "CUSTOM"].includes(entryType)) throw new HttpError(400, "Subject is required for lesson requirements.")
  if (blockLength > periodsPerCycle) throw new HttpError(400, "block_length cannot be greater than periods_per_cycle.")

  return {
    school_id: schoolId,
    academic_year_id: idValue(req.body.academic_year_id || req.body.academicYearId || current.academic_year_id, "academic_year_id", true),
    term_id: idValue(req.body.term_id || req.body.termId || current.term_id),
    timetable_id: idValue(req.body.timetable_id || req.body.timetableId || current.timetable_id),
    class_id: classId,
    stream_section: streamSection,
    student_group_id: studentGroupId,
    subject_id: subjectId,
    teacher_id: teacherId,
    assistant_teacher_id: idValue(req.body.assistant_teacher_id || req.body.assistantTeacherId || current.assistant_teacher_id),
    entry_type: entryType,
    periods_per_cycle: periodsPerCycle,
    block_length: blockLength,
    required_facility_id: idValue(req.body.required_facility_id || req.body.requiredFacilityId || current.required_facility_id),
    required_facility_type: cleanText(req.body.required_facility_type || req.body.requiredFacilityType || current.required_facility_type) || null,
    preferred_facility_ids: jsonArrayText(req.body.preferred_facility_ids ?? req.body.preferredFacilityIds ?? current.preferred_facility_ids),
    required_equipment_json: jsonArrayText(req.body.required_equipment_json ?? req.body.equipmentIds ?? req.body.requiredEquipmentJson ?? current.required_equipment_json),
    allowed_cycle_day_ids: jsonArrayText(req.body.allowed_cycle_day_ids ?? req.body.allowedCycleDayIds ?? current.allowed_cycle_day_ids),
    preferred_cycle_day_ids: jsonArrayText(req.body.preferred_cycle_day_ids ?? req.body.preferredCycleDayIds ?? current.preferred_cycle_day_ids),
    avoided_cycle_day_ids: jsonArrayText(req.body.avoided_cycle_day_ids ?? req.body.avoidedCycleDayIds ?? current.avoided_cycle_day_ids),
    allowed_slot_ids: jsonArrayText(req.body.allowed_slot_ids ?? req.body.allowedSlotIds ?? current.allowed_slot_ids),
    preferred_slot_ids: jsonArrayText(req.body.preferred_slot_ids ?? req.body.preferredSlotIds ?? current.preferred_slot_ids),
    avoided_slot_ids: jsonArrayText(req.body.avoided_slot_ids ?? req.body.avoidedSlotIds ?? current.avoided_slot_ids),
    required_capacity: intValue(req.body.required_capacity ?? req.body.requiredCapacity ?? current.required_capacity, 0) || null,
    priority: intValue(req.body.priority ?? current.priority, 50),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
    metadata: jsonText(req.body.metadata ?? current.metadata ?? {}, {}),
  }
}

async function validateCurriculumPayload(connection, payload) {
  await requireScopedRow(connection, "SELECT id FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id], "Academic year was not found for this school.")
  if (payload.term_id) {
    await requireScopedRow(connection, "SELECT id FROM terms WHERE school_id = ? AND academic_year_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id, payload.term_id], "Term was not found for this academic year.")
  }
  if (payload.timetable_id) {
    await requireScopedRow(connection, "SELECT id FROM timetables WHERE school_id = ? AND academic_year_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id, payload.timetable_id], "Timetable was not found for this academic year.")
  }
  if (payload.class_id) {
    await requireScopedRow(connection, "SELECT id FROM classes WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.class_id], "Class was not found for this school.")
  }
  if (payload.subject_id) {
    await requireScopedRow(connection, "SELECT id FROM subjects WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.subject_id], "Subject was not found for this school.")
  }
  if (payload.teacher_id) {
    await requireScopedRow(connection, "SELECT id FROM users WHERE school_id = ? AND id = ? AND role IN ('teacher', 'headteacher', 'school_owner') LIMIT 1", [payload.school_id, payload.teacher_id], "Teacher was not found for this school.")
  }
  if (payload.assistant_teacher_id) {
    await requireScopedRow(connection, "SELECT id FROM users WHERE school_id = ? AND id = ? AND role IN ('teacher', 'headteacher', 'school_owner') LIMIT 1", [payload.school_id, payload.assistant_teacher_id], "Assistant teacher was not found for this school.")
  }
  if (payload.required_facility_id) {
    await requireScopedRow(connection, "SELECT id FROM school_facilities WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.required_facility_id], "Required facility was not found for this school.")
  }
}

function normalizeCurriculumRequirement(row) {
  if (!row) return null
  return {
    ...row,
    preferred_facility_ids: parseJson(row.preferred_facility_ids, []),
    required_equipment_json: parseJson(row.required_equipment_json, []),
    allowed_cycle_day_ids: parseJson(row.allowed_cycle_day_ids, []),
    preferred_cycle_day_ids: parseJson(row.preferred_cycle_day_ids, []),
    avoided_cycle_day_ids: parseJson(row.avoided_cycle_day_ids, []),
    allowed_slot_ids: parseJson(row.allowed_slot_ids, []),
    preferred_slot_ids: parseJson(row.preferred_slot_ids, []),
    avoided_slot_ids: parseJson(row.avoided_slot_ids, []),
    metadata: parseJson(row.metadata, {}),
  }
}

function facilityPayload(req, schoolId, current = {}) {
  const facilityType = enumValue(req.body.facility_type || req.body.facilityType || current.facility_type, FACILITY_TYPES, current.facility_type || "CLASSROOM")
  const code = cleanText(req.body.facility_code || req.body.facilityCode || req.body.code || current.facility_code)
  const name = cleanText(req.body.name || current.name)
  if (!code) throw new HttpError(400, "Facility code is required")
  if (!name) throw new HttpError(400, "Facility name is required")
  return {
    school_id: schoolId,
    campus_id: idValue(req.body.campus_id || req.body.campusId),
    facility_code: code.toUpperCase(),
    name,
    facility_type: facilityType,
    facility_type_label: cleanText(req.body.facility_type_label || req.body.facilityTypeLabel || current.facility_type_label) || null,
    description: cleanText(req.body.description || current.description) || null,
    building: cleanText(req.body.building || current.building) || null,
    floor_label: cleanText(req.body.floor_label || req.body.floor || current.floor_label) || null,
    normal_capacity: intValue(req.body.normal_capacity ?? req.body.normalCapacity ?? current.normal_capacity, 0) || null,
    examination_capacity: intValue(req.body.examination_capacity ?? req.body.examinationCapacity ?? current.examination_capacity, 0) || null,
    workstation_count: intValue(req.body.workstation_count ?? req.body.workstationCount ?? current.workstation_count, 0) || null,
    functional_computer_count: intValue(req.body.functional_computer_count ?? req.body.functionalComputerCount ?? current.functional_computer_count, 0) || null,
    accessible: boolValue(req.body.accessible ?? req.body.is_accessible ?? req.body.isAccessible, Boolean(current.accessible ?? current.is_accessible)),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
    can_host_normal_lessons: boolValue(req.body.can_host_normal_lessons ?? req.body.canHostNormalLessons, current.can_host_normal_lessons === undefined ? true : Boolean(current.can_host_normal_lessons)),
    can_host_examinations: boolValue(req.body.can_host_examinations ?? req.body.canHostExaminations, current.can_host_examinations === undefined ? defaultCanHostWrittenExams(facilityType) : Boolean(current.can_host_examinations)),
    can_host_practical_examinations: boolValue(req.body.can_host_practical_examinations ?? req.body.canHostPracticalExaminations, isLaboratoryType(facilityType) || Boolean(current.can_host_practical_examinations)),
    can_host_computer_examinations: boolValue(req.body.can_host_computer_examinations ?? req.body.canHostComputerExaminations, facilityType === "COMPUTER_LABORATORY" || Boolean(current.can_host_computer_examinations)),
    can_host_listening_examinations: boolValue(req.body.can_host_listening_examinations ?? req.body.canHostListeningExaminations, Boolean(current.can_host_listening_examinations)),
    can_host_multiple_groups: boolValue(req.body.can_host_multiple_groups ?? req.body.canHostMultipleGroups, Boolean(current.can_host_multiple_groups)),
    requires_supervision: boolValue(req.body.requires_supervision ?? req.body.requiresSupervision, isLaboratoryType(facilityType) || Boolean(current.requires_supervision)),
    booking_required: boolValue(req.body.booking_required ?? req.body.bookingRequired, isLaboratoryType(facilityType) || Boolean(current.booking_required)),
    power_required: boolValue(req.body.power_required ?? req.body.powerRequired, facilityType === "COMPUTER_LABORATORY" || Boolean(current.power_required)),
    network_required: boolValue(req.body.network_required ?? req.body.networkRequired, facilityType === "COMPUTER_LABORATORY" || Boolean(current.network_required)),
    setup_buffer_minutes: intValue(req.body.setup_buffer_minutes ?? req.body.setupBufferMinutes ?? current.setup_buffer_minutes, 0),
    cleanup_buffer_minutes: intValue(req.body.cleanup_buffer_minutes ?? req.body.cleanupBufferMinutes ?? current.cleanup_buffer_minutes, 0),
    default_technician_id: idValue(req.body.default_technician_id || req.body.defaultTechnicianId),
    notes: cleanText(req.body.notes || current.notes) || null,
    metadata: jsonText(req.body.metadata || current.metadata || {}, {}),
  }
}

export async function listBellSchedules(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.query.timetable_id || req.query.timetableId)
  const includeInactive = boolValue(req.query.include_inactive || req.query.includeInactive)
  const params = [schoolId]
  const filters = ["b.school_id = ?"]
  if (timetableId) {
    filters.push("(b.timetable_id IS NULL OR b.timetable_id = ?)")
    params.push(timetableId)
  }
  if (!includeInactive) filters.push("b.active = 1")
  const [templates] = await pool.query(
    `SELECT b.*, tt.name AS timetable_name, tt.timetable_type, COUNT(s.id) AS slot_count
     FROM bell_schedule_templates b
     LEFT JOIN timetables tt ON tt.id = b.timetable_id AND tt.school_id = b.school_id
     LEFT JOIN bell_schedule_slots s ON s.template_id = b.id
     WHERE ${filters.join(" AND ")}
     GROUP BY b.id, tt.name, tt.timetable_type
     ORDER BY b.active DESC, b.is_default DESC, tt.updated_at DESC, b.name
     LIMIT 100`,
    params,
  )
  const templateIds = templates.map((row) => Number(row.id))
  const [slots] = templateIds.length
    ? await pool.query(
      `SELECT s.*
       FROM bell_schedule_slots s
       WHERE s.template_id IN (${templateIds.map(() => "?").join(",")})
       ORDER BY s.template_id, s.sort_order, s.slot_number`,
      templateIds,
    )
    : [[]]
  const slotsByTemplate = new Map()
  slots.forEach((slot) => {
    const key = Number(slot.template_id)
    slotsByTemplate.set(key, [...(slotsByTemplate.get(key) || []), slot])
  })
  return {
    templates: templates.map((row) => ({
      ...row,
      slot_count: Number(row.slot_count || 0),
      slots: slotsByTemplate.get(Number(row.id)) || [],
    })),
  }
}

export async function listTimetableDayTemplates(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.timetableId || req.query.timetable_id || req.query.timetableId, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")

  const [[cycleDays], [templates], [dayTemplates]] = await Promise.all([
    pool.query(
      `SELECT *
       FROM timetable_cycle_days
       WHERE timetable_id = ?
       ORDER BY sort_order, cycle_day_number`,
      [timetableId],
    ),
    pool.query(
      `SELECT b.*, COUNT(s.id) AS slot_count, MIN(s.start_time) AS day_start_time, MAX(s.end_time) AS day_end_time
       FROM bell_schedule_templates b
       LEFT JOIN bell_schedule_slots s ON s.template_id = b.id
       WHERE b.school_id = ? AND b.active = 1 AND (b.timetable_id IS NULL OR b.timetable_id = ?)
       GROUP BY b.id
       ORDER BY b.timetable_id IS NULL, b.is_default DESC, b.name`,
      [schoolId, timetableId],
    ),
    pool.query(
      `SELECT cd.id AS cycle_day_id, cd.display_name AS cycle_day_name, cd.code AS cycle_day_code,
        cd.weekday, cd.sort_order, cd.active AS cycle_day_active,
        dt.id, dt.bell_template_id, dt.active,
        b.name AS bell_template_name, b.description AS bell_template_description,
        COUNT(s.id) AS slot_count, MIN(s.start_time) AS day_start_time, MAX(s.end_time) AS day_end_time
       FROM timetable_cycle_days cd
       LEFT JOIN timetable_day_templates dt ON dt.timetable_id = ? AND dt.cycle_day_id = cd.id
       LEFT JOIN bell_schedule_templates b ON b.id = dt.bell_template_id
       LEFT JOIN bell_schedule_slots s ON s.template_id = b.id
       WHERE cd.timetable_id = ?
       GROUP BY cd.id, dt.id, b.id
       ORDER BY cd.sort_order, cd.cycle_day_number`,
      [timetableId, timetableId],
    ),
  ])

  return {
    timetable,
    cycle_days: cycleDays,
    templates: templates.map((row) => ({ ...row, slot_count: Number(row.slot_count || 0) })),
    day_templates: dayTemplates.map((row) => ({
      ...row,
      slot_count: Number(row.slot_count || 0),
      active: row.active === null || row.active === undefined ? 0 : Number(row.active),
      cycle_day_active: Number(row.cycle_day_active || 0),
    })),
  }
}

export async function setTimetableDayTemplate(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.timetableId, "timetable id", true)
  const cycleDayId = idValue(req.params.cycleDayId, "cycle day id", true)
  const bellTemplateId = idValue(req.body.bell_template_id || req.body.bellTemplateId, "bell_template_id", true)
  const active = boolValue(req.body.active, true) ? 1 : 0
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const timetable = await loadTimetable(connection, schoolId, timetableId)
    if (!timetable) throw new HttpError(404, "Timetable was not found")
    const [[cycleDay]] = await connection.query(
      "SELECT * FROM timetable_cycle_days WHERE timetable_id = ? AND id = ? LIMIT 1",
      [timetableId, cycleDayId],
    )
    if (!cycleDay) throw new HttpError(404, "Cycle day was not found for this timetable")
    const [[template]] = await connection.query(
      `SELECT *
       FROM bell_schedule_templates
       WHERE school_id = ? AND id = ? AND active = 1 AND (timetable_id IS NULL OR timetable_id = ?)
       LIMIT 1`,
      [schoolId, bellTemplateId, timetableId],
    )
    if (!template) throw new HttpError(400, "Bell schedule is not available for this timetable")
    const [[previous]] = await connection.query(
      "SELECT * FROM timetable_day_templates WHERE timetable_id = ? AND cycle_day_id = ? LIMIT 1",
      [timetableId, cycleDayId],
    )
    await connection.query(
      `INSERT INTO timetable_day_templates (timetable_id, cycle_day_id, bell_template_id, active)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bell_template_id = VALUES(bell_template_id), active = VALUES(active)`,
      [timetableId, cycleDayId, bellTemplateId, active],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId,
      actorUserId: req.user.id,
      action: "TIMETABLE_DAY_TEMPLATE_UPDATED",
      entityType: "timetable_day_template",
      entityId: previous?.id || cycleDayId,
      previousValues: previous || null,
      newValues: { timetable_id: timetableId, cycle_day_id: cycleDayId, bell_template_id: bellTemplateId, active },
    })
    await connection.commit()
    return { day_template: { timetable_id: timetableId, cycle_day_id: cycleDayId, bell_template_id: bellTemplateId, active } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createBellSchedule(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = bellTemplatePayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await assertTimetableForBellTemplate(connection, schoolId, payload.timetable_id)
    if (payload.is_default) {
      await connection.query("UPDATE bell_schedule_templates SET is_default = 0 WHERE school_id = ? AND (timetable_id <=> ?)", [schoolId, payload.timetable_id])
    }
    const [result] = await connection.query(
      `INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, shift_id, is_default, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, payload.timetable_id, payload.name, payload.description, payload.shift_id, payload.is_default ? 1 : 0, payload.active ? 1 : 0, req.user.id],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: payload.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_CREATED",
      entityType: "bell_schedule_template",
      entityId: result.insertId,
      newValues: payload,
    })
    await connection.commit()
    return { template: { id: Number(result.insertId), ...payload } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateBellSchedule(req) {
  const schoolId = getScopedSchoolId(req)
  const templateId = idValue(req.params.id, "bell schedule id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const current = await loadBellTemplate(connection, schoolId, templateId)
    if (!current) throw new HttpError(404, "Bell schedule was not found")
    const payload = bellTemplatePayload(req, schoolId, current)
    await assertTimetableForBellTemplate(connection, schoolId, payload.timetable_id)
    if (payload.is_default) {
      await connection.query("UPDATE bell_schedule_templates SET is_default = 0 WHERE school_id = ? AND (timetable_id <=> ?) AND id <> ?", [schoolId, payload.timetable_id, templateId])
    }
    await connection.query(
      `UPDATE bell_schedule_templates
       SET timetable_id = ?, name = ?, description = ?, shift_id = ?, is_default = ?, active = ?
       WHERE school_id = ? AND id = ?`,
      [payload.timetable_id, payload.name, payload.description, payload.shift_id, payload.is_default ? 1 : 0, payload.active ? 1 : 0, schoolId, templateId],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: payload.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_UPDATED",
      entityType: "bell_schedule_template",
      entityId: templateId,
      previousValues: current,
      newValues: payload,
    })
    await connection.commit()
    return { template: { id: templateId, ...payload } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveBellSchedule(req) {
  const schoolId = getScopedSchoolId(req)
  const templateId = idValue(req.params.id, "bell schedule id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const current = await loadBellTemplate(connection, schoolId, templateId)
    if (!current) throw new HttpError(404, "Bell schedule was not found")
    await connection.query("UPDATE bell_schedule_templates SET active = 0, is_default = 0 WHERE school_id = ? AND id = ?", [schoolId, templateId])
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: current.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_ARCHIVED",
      entityType: "bell_schedule_template",
      entityId: templateId,
      previousValues: current,
    })
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createBellScheduleSlot(req) {
  const schoolId = getScopedSchoolId(req)
  const templateId = idValue(req.params.id, "bell schedule id", true)
  const payload = bellSlotPayload(req)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const template = await loadBellTemplate(connection, schoolId, templateId)
    if (!template) throw new HttpError(404, "Bell schedule was not found")
    await assertNoBellSlotOverlap(connection, templateId, payload)
    const [result] = await connection.query(
      `INSERT INTO bell_schedule_slots (
        template_id, slot_number, code, display_name, start_time, end_time, slot_type, teaching_allowed, can_span, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, payload.slot_number, payload.code, payload.display_name, payload.start_time, payload.end_time, payload.slot_type, payload.teaching_allowed, payload.can_span, payload.sort_order],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: template.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_SLOT_CREATED",
      entityType: "bell_schedule_slot",
      entityId: result.insertId,
      newValues: { template_id: templateId, ...payload },
    })
    await connection.commit()
    return { slot: { id: Number(result.insertId), template_id: templateId, ...payload } }
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A period with this number or code already exists in this bell schedule.")
    throw error
  } finally {
    connection.release()
  }
}

export async function updateBellScheduleSlot(req) {
  const schoolId = getScopedSchoolId(req)
  const slotId = idValue(req.params.slotId, "period id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const current = await loadSlot(connection, slotId)
    if (!current || Number(current.school_id) !== Number(schoolId)) throw new HttpError(404, "Period was not found")
    const payload = bellSlotPayload(req, current)
    await assertNoBellSlotOverlap(connection, current.template_id, payload, slotId)
    await connection.query(
      `UPDATE bell_schedule_slots
       SET slot_number = ?, code = ?, display_name = ?, start_time = ?, end_time = ?, slot_type = ?, teaching_allowed = ?, can_span = ?, sort_order = ?
       WHERE id = ?`,
      [payload.slot_number, payload.code, payload.display_name, payload.start_time, payload.end_time, payload.slot_type, payload.teaching_allowed, payload.can_span, payload.sort_order, slotId],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: current.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_SLOT_UPDATED",
      entityType: "bell_schedule_slot",
      entityId: slotId,
      previousValues: current,
      newValues: payload,
    })
    await connection.commit()
    return { slot: { id: slotId, template_id: current.template_id, ...payload } }
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A period with this number or code already exists in this bell schedule.")
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteBellScheduleSlot(req) {
  const schoolId = getScopedSchoolId(req)
  const slotId = idValue(req.params.slotId, "period id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const current = await loadSlot(connection, slotId)
    if (!current || Number(current.school_id) !== Number(schoolId)) throw new HttpError(404, "Period was not found")
    await assertBellSlotCanDelete(connection, slotId)
    await connection.query("DELETE FROM bell_schedule_slots WHERE id = ?", [slotId])
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: current.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_SLOT_DELETED",
      entityType: "bell_schedule_slot",
      entityId: slotId,
      previousValues: current,
    })
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listFacilities(req) {
  const schoolId = getScopedSchoolId(req)
  const type = cleanText(req.query.type).toUpperCase()
  const search = cleanText(req.query.search).toLowerCase()
  const laboratoryOnly = boolValue(req.query.laboratory)
  const includeInactive = boolValue(req.query.include_inactive || req.query.includeInactive)
  const params = [schoolId]
  const filters = ["sf.school_id = ?"]
  if (FACILITY_TYPES.has(type)) {
    filters.push("sf.facility_type = ?")
    params.push(type)
  }
  if (laboratoryOnly) {
    filters.push("(sf.facility_type LIKE '%LABORATORY' OR sf.facility_type IN ('WORKSHOP', 'HOME_ECONOMICS_ROOM', 'AGRICULTURE_FACILITY'))")
  }
  if (!includeInactive) filters.push("sf.active = 1")
  if (search) {
    filters.push("(LOWER(name) LIKE ? OR LOWER(facility_code) LIKE ? OR LOWER(COALESCE(building, '')) LIKE ?)")
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const [rows] = await pool.query(
    `SELECT sf.*,
      COUNT(DISTINCT fea.equipment_id) AS equipment_count,
      COUNT(DISTINCT fse.subject_id) AS subject_count
     FROM school_facilities sf
     LEFT JOIN facility_equipment_assignments fea ON fea.facility_id = sf.id
     LEFT JOIN facility_subject_eligibility fse ON fse.facility_id = sf.id AND fse.active = 1
     WHERE ${filters.join(" AND ")}
     GROUP BY sf.id
     ORDER BY sf.active DESC, sf.facility_type, sf.name
     LIMIT 300`,
    params,
  )
  return { facilities: rows.map((row) => ({ ...normalizeFacility(row), metadata: parseJson(row.metadata, {}), equipment_count: Number(row.equipment_count || 0), subject_count: Number(row.subject_count || 0) })) }
}

export async function createFacility(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = facilityPayload(req, schoolId)
  const [result] = await pool.query(
    `INSERT INTO school_facilities (
      school_id, campus_id, facility_code, name, facility_type, facility_type_label, description, building, floor_label,
      normal_capacity, examination_capacity, workstation_count, functional_computer_count, is_accessible, active,
      can_host_normal_lessons, can_host_examinations, can_host_practical_examinations, can_host_computer_examinations,
      can_host_listening_examinations, can_host_multiple_groups, requires_supervision, booking_required, power_required,
      network_required, setup_buffer_minutes, cleanup_buffer_minutes, default_technician_id, notes, metadata, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      payload.campus_id,
      payload.facility_code,
      payload.name,
      payload.facility_type,
      payload.facility_type_label,
      payload.description,
      payload.building,
      payload.floor_label,
      payload.normal_capacity,
      payload.examination_capacity,
      payload.workstation_count,
      payload.functional_computer_count,
      payload.accessible ? 1 : 0,
      payload.active ? 1 : 0,
      payload.can_host_normal_lessons ? 1 : 0,
      payload.can_host_examinations ? 1 : 0,
      payload.can_host_practical_examinations ? 1 : 0,
      payload.can_host_computer_examinations ? 1 : 0,
      payload.can_host_listening_examinations ? 1 : 0,
      payload.can_host_multiple_groups ? 1 : 0,
      payload.requires_supervision ? 1 : 0,
      payload.booking_required ? 1 : 0,
      payload.power_required ? 1 : 0,
      payload.network_required ? 1 : 0,
      payload.setup_buffer_minutes,
      payload.cleanup_buffer_minutes,
      payload.default_technician_id,
      payload.notes,
      payload.metadata,
      req.user.id,
      req.user.id,
    ],
  )
  return { facility: await loadFacility(pool, schoolId, Number(result.insertId)) }
}

export async function updateFacility(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const current = await loadFacility(pool, schoolId, facilityId)
  if (!current) throw new HttpError(404, "Facility was not found")
  const payload = facilityPayload(req, schoolId, current)
  await pool.query(
    `UPDATE school_facilities
     SET campus_id = ?, facility_code = ?, name = ?, facility_type = ?, facility_type_label = ?, description = ?,
      building = ?, floor_label = ?, normal_capacity = ?, examination_capacity = ?, workstation_count = ?,
      functional_computer_count = ?, is_accessible = ?, active = ?, can_host_normal_lessons = ?,
      can_host_examinations = ?, can_host_practical_examinations = ?, can_host_computer_examinations = ?,
      can_host_listening_examinations = ?, can_host_multiple_groups = ?, requires_supervision = ?,
      booking_required = ?, power_required = ?, network_required = ?, setup_buffer_minutes = ?,
      cleanup_buffer_minutes = ?, default_technician_id = ?, notes = ?, metadata = ?, updated_by = ?
     WHERE school_id = ? AND id = ?`,
    [
      payload.campus_id,
      payload.facility_code,
      payload.name,
      payload.facility_type,
      payload.facility_type_label,
      payload.description,
      payload.building,
      payload.floor_label,
      payload.normal_capacity,
      payload.examination_capacity,
      payload.workstation_count,
      payload.functional_computer_count,
      payload.accessible ? 1 : 0,
      payload.active ? 1 : 0,
      payload.can_host_normal_lessons ? 1 : 0,
      payload.can_host_examinations ? 1 : 0,
      payload.can_host_practical_examinations ? 1 : 0,
      payload.can_host_computer_examinations ? 1 : 0,
      payload.can_host_listening_examinations ? 1 : 0,
      payload.can_host_multiple_groups ? 1 : 0,
      payload.requires_supervision ? 1 : 0,
      payload.booking_required ? 1 : 0,
      payload.power_required ? 1 : 0,
      payload.network_required ? 1 : 0,
      payload.setup_buffer_minutes,
      payload.cleanup_buffer_minutes,
      payload.default_technician_id,
      payload.notes,
      payload.metadata,
      req.user.id,
      schoolId,
      facilityId,
    ],
  )
  return { facility: await loadFacility(pool, schoolId, facilityId) }
}

export async function archiveFacility(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const [result] = await pool.query("UPDATE school_facilities SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, facilityId])
  if (!result.affectedRows) throw new HttpError(404, "Facility was not found")
  return { archived: true }
}

export async function duplicateFacility(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const current = await loadFacility(pool, schoolId, facilityId)
  if (!current) throw new HttpError(404, "Facility was not found")
  const code = cleanText(req.body.facility_code || req.body.code || `${current.facility_code}-COPY`).toUpperCase()
  const name = cleanText(req.body.name || `${current.name} Copy`)
  const [result] = await pool.query(
    `INSERT INTO school_facilities (
      school_id, campus_id, facility_code, name, facility_type, facility_type_label, description, building, floor_label,
      normal_capacity, examination_capacity, workstation_count, functional_computer_count, is_accessible, active,
      can_host_normal_lessons, can_host_examinations, can_host_practical_examinations, can_host_computer_examinations,
      can_host_listening_examinations, can_host_multiple_groups, requires_supervision, booking_required, power_required,
      network_required, setup_buffer_minutes, cleanup_buffer_minutes, default_technician_id, notes, metadata, created_by, updated_by
    )
    SELECT school_id, campus_id, ?, ?, facility_type, facility_type_label, description, building, floor_label,
      normal_capacity, examination_capacity, workstation_count, functional_computer_count, is_accessible, 1,
      can_host_normal_lessons, can_host_examinations, can_host_practical_examinations, can_host_computer_examinations,
      can_host_listening_examinations, can_host_multiple_groups, requires_supervision, booking_required, power_required,
      network_required, setup_buffer_minutes, cleanup_buffer_minutes, default_technician_id, notes, metadata, ?, ?
    FROM school_facilities WHERE school_id = ? AND id = ?`,
    [code, name, req.user.id, req.user.id, schoolId, facilityId],
  )
  return { facility: await loadFacility(pool, schoolId, Number(result.insertId)) }
}

export async function listEquipment(req) {
  const schoolId = getScopedSchoolId(req)
  const [rows] = await pool.query(
    `SELECT * FROM facility_equipment
     WHERE school_id = ? AND (? = 1 OR active = 1)
     ORDER BY active DESC, category, name`,
    [schoolId, boolValue(req.query.include_inactive || req.query.includeInactive) ? 1 : 0],
  )
  return { equipment: rows }
}

export async function createEquipment(req) {
  const schoolId = getScopedSchoolId(req)
  const name = cleanText(req.body.name)
  if (!name) throw new HttpError(400, "Equipment name is required")
  const [result] = await pool.query(
    `INSERT INTO facility_equipment (school_id, name, category, total_quantity, usable_quantity, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      name,
      cleanText(req.body.category, "general"),
      intValue(req.body.total_quantity ?? req.body.totalQuantity, 0),
      intValue(req.body.usable_quantity ?? req.body.usableQuantity ?? req.body.total_quantity ?? req.body.totalQuantity, 0),
      req.body.active === undefined ? 1 : (boolValue(req.body.active) ? 1 : 0),
      req.user.id,
    ],
  )
  const [[equipment]] = await pool.query("SELECT * FROM facility_equipment WHERE id = ? AND school_id = ?", [Number(result.insertId), schoolId])
  return { equipment }
}

export async function assignEquipment(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const equipmentId = idValue(req.body.equipment_id || req.body.equipmentId, "equipment id", true)
  const facility = await loadFacility(pool, schoolId, facilityId)
  if (!facility) throw new HttpError(404, "Facility was not found")
  const [[equipment]] = await pool.query("SELECT id FROM facility_equipment WHERE id = ? AND school_id = ? LIMIT 1", [equipmentId, schoolId])
  if (!equipment) throw new HttpError(404, "Equipment was not found")
  await pool.query(
    `INSERT INTO facility_equipment_assignments (facility_id, equipment_id, quantity, condition_status, available_for_exams, available_for_lessons, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), condition_status = VALUES(condition_status),
      available_for_exams = VALUES(available_for_exams), available_for_lessons = VALUES(available_for_lessons), notes = VALUES(notes)`,
    [
      facilityId,
      equipmentId,
      intValue(req.body.quantity, 1),
      enumValue(req.body.condition_status || req.body.conditionStatus, new Set(["GOOD", "FAIR", "DAMAGED", "MAINTENANCE", "RETIRED"]), "GOOD"),
      boolValue(req.body.available_for_exams ?? req.body.availableForExams, true) ? 1 : 0,
      boolValue(req.body.available_for_lessons ?? req.body.availableForLessons, true) ? 1 : 0,
      cleanText(req.body.notes) || null,
    ],
  )
  return getFacilityDetail({ ...req, params: { id: facilityId } })
}

export async function setFacilitySubjectEligibility(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const subjectId = idValue(req.body.subject_id || req.body.subjectId, "subject id", true)
  const facility = await loadFacility(pool, schoolId, facilityId)
  if (!facility) throw new HttpError(404, "Facility was not found")
  const [[subject]] = await pool.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [subjectId, schoolId])
  if (!subject) throw new HttpError(404, "Subject was not found")
  await pool.query(
    `INSERT INTO facility_subject_eligibility (
      school_id, facility_id, subject_id, allowed_lesson_types, allowed_exam_types, preferred, required_equipment, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE allowed_lesson_types = VALUES(allowed_lesson_types), allowed_exam_types = VALUES(allowed_exam_types),
      preferred = VALUES(preferred), required_equipment = VALUES(required_equipment), active = VALUES(active)`,
    [
      schoolId,
      facilityId,
      subjectId,
      jsonText(req.body.allowed_lesson_types || req.body.allowedLessonTypes || [], []),
      jsonText(req.body.allowed_exam_types || req.body.allowedExamTypes || [], []),
      boolValue(req.body.preferred) ? 1 : 0,
      jsonText(req.body.required_equipment || req.body.requiredEquipment || [], []),
      req.body.active === undefined ? 1 : (boolValue(req.body.active) ? 1 : 0),
    ],
  )
  return getFacilityDetail({ ...req, params: { id: facilityId } })
}

export async function setFacilityAvailability(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const facility = await loadFacility(pool, schoolId, facilityId)
  if (!facility) throw new HttpError(404, "Facility was not found")
  const availabilityStatus = enumValue(req.body.availability_status || req.body.availabilityStatus, new Set(["AVAILABLE", "PREFERRED", "RESTRICTED", "UNAVAILABLE", "MAINTENANCE"]), "AVAILABLE")
  const [result] = await pool.query(
    `INSERT INTO facility_availability_rules (
      school_id, facility_id, academic_year_id, term_id, cycle_day_id, weekday, slot_start_id, slot_end_id,
      start_time, end_time, availability_status, reason, effective_from, effective_to, recurring, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      facilityId,
      idValue(req.body.academic_year_id || req.body.academicYearId),
      idValue(req.body.term_id || req.body.termId),
      idValue(req.body.cycle_day_id || req.body.cycleDayId),
      req.body.weekday === undefined || req.body.weekday === "" ? null : intValue(req.body.weekday, 0),
      idValue(req.body.slot_start_id || req.body.slotStartId),
      idValue(req.body.slot_end_id || req.body.slotEndId),
      timeText(req.body.start_time || req.body.startTime),
      timeText(req.body.end_time || req.body.endTime),
      availabilityStatus,
      cleanText(req.body.reason) || null,
      dateOnly(req.body.effective_from || req.body.effectiveFrom),
      dateOnly(req.body.effective_to || req.body.effectiveTo),
      boolValue(req.body.recurring, true) ? 1 : 0,
      req.user.id,
    ],
  )
  return { availability_rule_id: Number(result.insertId), facility: await getFacilityDetail({ ...req, params: { id: facilityId } }).then((payload) => payload.facility) }
}

export async function getFacilityDetail(req) {
  const schoolId = getScopedSchoolId(req)
  const facilityId = idValue(req.params.id, "facility id", true)
  const facility = await loadFacility(pool, schoolId, facilityId)
  if (!facility) throw new HttpError(404, "Facility was not found")
  const [[equipment], [subjects], [availability]] = await Promise.all([
    pool.query(
      `SELECT fe.*, fea.quantity, fea.condition_status, fea.available_for_exams, fea.available_for_lessons, fea.notes AS assignment_notes
       FROM facility_equipment_assignments fea
       JOIN facility_equipment fe ON fe.id = fea.equipment_id
       WHERE fea.facility_id = ?
       ORDER BY fe.category, fe.name`,
      [facilityId],
    ),
    pool.query(
      `SELECT fse.*, s.name AS subject_name, s.code AS subject_code
       FROM facility_subject_eligibility fse
       JOIN subjects s ON s.id = fse.subject_id AND s.school_id = fse.school_id
       WHERE fse.school_id = ? AND fse.facility_id = ?
       ORDER BY s.name`,
      [schoolId, facilityId],
    ),
    pool.query(
      `SELECT far.*, cd.display_name AS cycle_day_name, ss.display_name AS start_slot_name, es.display_name AS end_slot_name
       FROM facility_availability_rules far
       LEFT JOIN timetable_cycle_days cd ON cd.id = far.cycle_day_id
       LEFT JOIN bell_schedule_slots ss ON ss.id = far.slot_start_id
       LEFT JOIN bell_schedule_slots es ON es.id = far.slot_end_id
       WHERE far.school_id = ? AND far.facility_id = ?
       ORDER BY far.created_at DESC
       LIMIT 50`,
      [schoolId, facilityId],
    ),
  ])
  return {
    facility: { ...facility, metadata: parseJson(facility.metadata, {}) },
    equipment,
    subjects: subjects.map((row) => ({
      ...row,
      allowed_lesson_types: parseJson(row.allowed_lesson_types, []),
      allowed_exam_types: parseJson(row.allowed_exam_types, []),
      required_equipment: parseJson(row.required_equipment, []),
    })),
    availability,
  }
}

export async function validateFacilityUse(req) {
  const schoolId = getScopedSchoolId(req)
  const conflicts = await validateFacilityUsePayload(pool, schoolId, req.body || {})
  return { valid: !conflicts.some((item) => item.severity === "HARD"), conflicts }
}

export async function validateFacilityUsePayload(connection, schoolId, payload) {
  const facilityId = idValue(payload.facility_id || payload.facilityId)
  if (!facilityId) return []
  const conflicts = []
  const facility = await loadFacility(connection, schoolId, facilityId)
  if (!facility || !Number(facility.active)) {
    return [{
      code: "INVALID_FACILITY",
      severity: "HARD",
      message: "The selected facility is not active in this school.",
      resourceType: "facility",
      resourceId: facilityId,
    }]
  }

  const entryType = cleanText(payload.entry_type || payload.entryType || "LESSON").toUpperCase()
  const subjectId = idValue(payload.subject_id || payload.subjectId)
  const classId = idValue(payload.class_id || payload.classId)
  const slotStartId = idValue(payload.slot_start_id || payload.slotStartId)
  const slotEndId = idValue(payload.slot_end_id || payload.slotEndId || slotStartId)
  const cycleDayId = idValue(payload.cycle_day_id || payload.cycleDayId)
  const calendarDate = dateOnly(payload.calendar_date || payload.calendarDate)
  const versionId = idValue(payload.timetable_version_id || payload.timetableVersionId)

  if (entryType.includes("EXAM") && !Number(facility.can_host_examinations)) {
    conflicts.push({ code: "FACILITY_NOT_EXAM_ENABLED", severity: "HARD", message: `${facility.name} is not enabled for examinations.`, resourceType: "facility", resourceId: facilityId })
  }
  if (!entryType.includes("EXAM") && !Number(facility.can_host_normal_lessons)) {
    conflicts.push({ code: "FACILITY_NOT_LESSON_ENABLED", severity: "HARD", message: `${facility.name} is not enabled for normal lessons.`, resourceType: "facility", resourceId: facilityId })
  }
  if ((entryType.includes("LABORATORY") || entryType.includes("PRACTICAL")) && !isLaboratoryType(facility.facility_type)) {
    conflicts.push({ code: "FACILITY_NOT_LABORATORY", severity: "HARD", message: `${facility.name} is not configured as a laboratory or practical facility.`, resourceType: "facility", resourceId: facilityId })
  }
  if (entryType.includes("COMPUTER") && !Number(facility.can_host_computer_examinations) && facility.facility_type !== "COMPUTER_LABORATORY") {
    conflicts.push({ code: "FACILITY_NOT_COMPUTER_READY", severity: "HARD", message: `${facility.name} is not configured for computer-based work.`, resourceType: "facility", resourceId: facilityId })
  }

  if (subjectId) {
    const [[eligibilityCount]] = await connection.query("SELECT COUNT(*) AS total FROM facility_subject_eligibility WHERE school_id = ? AND facility_id = ? AND active = 1", [schoolId, facilityId])
    if (Number(eligibilityCount.total || 0) > 0) {
      const [[eligible]] = await connection.query(
        "SELECT id FROM facility_subject_eligibility WHERE school_id = ? AND facility_id = ? AND subject_id = ? AND active = 1 LIMIT 1",
        [schoolId, facilityId, subjectId],
      )
      if (!eligible) conflicts.push({ code: "SUBJECT_NOT_SUPPORTED_BY_FACILITY", severity: "HARD", message: `${facility.name} is not configured to support the selected subject.`, resourceType: "facility", resourceId: facilityId })
    }
  }

  if (classId && facility.normal_capacity) {
    const [[classSize]] = await connection.query(
      `SELECT COUNT(*) AS students
       FROM student_enrollments se
       WHERE se.school_id = ? AND se.class_id = ? AND se.enrollment_status = 'active'`,
      [schoolId, classId],
    )
    if (Number(classSize.students || 0) > Number(facility.normal_capacity || 0)) {
      conflicts.push({ code: "FACILITY_CAPACITY_EXCEEDED", severity: "HARD", message: `${facility.name} holds ${facility.normal_capacity} learners, but this class has ${Number(classSize.students || 0)} active learners.`, resourceType: "facility", resourceId: facilityId })
    }
  }

  if (slotStartId && slotEndId) {
    const [startSlot, endSlot] = await Promise.all([loadSlot(connection, slotStartId), loadSlot(connection, slotEndId)])
    if (startSlot && endSlot) {
      const dayClause = cycleDayId ? "far.cycle_day_id = ?" : calendarDate ? "(far.weekday IS NULL OR far.weekday = DAYOFWEEK(?) - 1)" : "1 = 1"
      const dayParams = cycleDayId ? [cycleDayId] : calendarDate ? [calendarDate] : []
      const [availabilityRows] = await connection.query(
        `SELECT far.*
         FROM facility_availability_rules far
         LEFT JOIN bell_schedule_slots ss ON ss.id = far.slot_start_id
         LEFT JOIN bell_schedule_slots es ON es.id = far.slot_end_id
         WHERE far.school_id = ? AND far.facility_id = ? AND far.approved_status = 'APPROVED'
          AND far.availability_status IN ('UNAVAILABLE', 'MAINTENANCE', 'RESTRICTED')
          AND ${dayClause}
          AND (far.effective_from IS NULL OR ? IS NULL OR far.effective_from <= ?)
          AND (far.effective_to IS NULL OR ? IS NULL OR far.effective_to >= ?)
          AND (
            far.slot_start_id IS NULL OR far.slot_end_id IS NULL OR
            (ss.slot_number <= ? AND es.slot_number >= ?)
          )
         LIMIT 5`,
        [schoolId, facilityId, ...dayParams, calendarDate, calendarDate, calendarDate, calendarDate, endSlot.slot_number, startSlot.slot_number],
      )
      availabilityRows.forEach((rule) => {
        conflicts.push({ code: `FACILITY_${rule.availability_status}`, severity: "HARD", message: rule.reason || `${facility.name} is ${String(rule.availability_status).toLowerCase()} during the selected time.`, resourceType: "facility", resourceId: facilityId })
      })

      if (versionId && (cycleDayId || calendarDate)) {
        const overlapParams = [versionId, facilityId, cycleDayId || calendarDate, endSlot.slot_number, startSlot.slot_number]
        const dayEntryClause = cycleDayId ? "e.cycle_day_id = ?" : "e.calendar_date = ?"
        const [overlaps] = await connection.query(
          `SELECT e.id, e.title, e.entry_type, st.display_name AS start_slot, en.display_name AS end_slot
           FROM timetable_entries e
           JOIN bell_schedule_slots st ON st.id = e.slot_start_id
           JOIN bell_schedule_slots en ON en.id = e.slot_end_id
           WHERE e.timetable_version_id = ? AND e.facility_id = ? AND ${dayEntryClause}
            AND st.slot_number <= ? AND en.slot_number >= ?
           LIMIT 5`,
          overlapParams,
        )
        overlaps.forEach((row) => {
          conflicts.push({ code: "FACILITY_TIME_CLASH", severity: "HARD", message: `${facility.name} is already reserved for ${row.title || row.entry_type} from ${row.start_slot} to ${row.end_slot}.`, resourceType: "facility", resourceId: facilityId, sourceEntityType: "timetable_entry", sourceEntityId: Number(row.id) })
        })
      }
    }
  }

  return conflicts
}

export async function listCurriculumRequirements(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["cpr.school_id = ?"]
  const academicYearId = idValue(req.query.academic_year_id || req.query.academicYearId)
  const termId = idValue(req.query.term_id || req.query.termId)
  const timetableId = idValue(req.query.timetable_id || req.query.timetableId)
  const classId = idValue(req.query.class_id || req.query.classId)
  const includeInactive = boolValue(req.query.include_inactive || req.query.includeInactive)
  if (academicYearId) {
    filters.push("cpr.academic_year_id = ?")
    params.push(academicYearId)
  }
  if (termId) {
    filters.push("(cpr.term_id IS NULL OR cpr.term_id = ?)")
    params.push(termId)
  }
  if (timetableId) {
    filters.push("(cpr.timetable_id IS NULL OR cpr.timetable_id = ?)")
    params.push(timetableId)
  }
  if (classId) {
    filters.push("cpr.class_id = ?")
    params.push(classId)
  }
  if (!includeInactive) filters.push("cpr.active = 1")

  const [rows] = await pool.query(
    `SELECT cpr.*,
      ay.name AS academic_year_name,
      t.name AS term_name,
      tt.name AS timetable_name,
      c.name AS class_name,
      s.name AS subject_name,
      s.code AS subject_code,
      teacher.full_name AS teacher_name,
      assistant.full_name AS assistant_teacher_name,
      sf.name AS required_facility_name,
      sf.facility_type AS resolved_facility_type
     FROM curriculum_period_requirements cpr
     JOIN academic_years ay ON ay.id = cpr.academic_year_id AND ay.school_id = cpr.school_id
     LEFT JOIN terms t ON t.id = cpr.term_id AND t.school_id = cpr.school_id
     LEFT JOIN timetables tt ON tt.id = cpr.timetable_id AND tt.school_id = cpr.school_id
     LEFT JOIN classes c ON c.id = cpr.class_id AND c.school_id = cpr.school_id
     LEFT JOIN subjects s ON s.id = cpr.subject_id AND s.school_id = cpr.school_id
     LEFT JOIN users teacher ON teacher.id = cpr.teacher_id AND teacher.school_id = cpr.school_id
     LEFT JOIN users assistant ON assistant.id = cpr.assistant_teacher_id AND assistant.school_id = cpr.school_id
     LEFT JOIN school_facilities sf ON sf.id = cpr.required_facility_id AND sf.school_id = cpr.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY cpr.active DESC, ay.start_date DESC, t.term_number, c.name, cpr.priority DESC, s.name, cpr.id
     LIMIT 500`,
    params,
  )
  return { requirements: rows.map(normalizeCurriculumRequirement) }
}

export async function createCurriculumRequirement(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = curriculumPayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await validateCurriculumPayload(connection, payload)
    const [result] = await connection.query(
      `INSERT INTO curriculum_period_requirements (
        school_id, academic_year_id, term_id, timetable_id, class_id, stream_section, student_group_id,
        subject_id, teacher_id, assistant_teacher_id, entry_type, periods_per_cycle, block_length,
        required_facility_id, required_facility_type, preferred_facility_ids, required_equipment_json,
        allowed_cycle_day_ids, preferred_cycle_day_ids, avoided_cycle_day_ids, allowed_slot_ids,
        preferred_slot_ids, avoided_slot_ids, required_capacity, priority, active, metadata, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        payload.academic_year_id,
        payload.term_id,
        payload.timetable_id,
        payload.class_id,
        payload.stream_section,
        payload.student_group_id,
        payload.subject_id,
        payload.teacher_id,
        payload.assistant_teacher_id,
        payload.entry_type,
        payload.periods_per_cycle,
        payload.block_length,
        payload.required_facility_id,
        payload.required_facility_type,
        payload.preferred_facility_ids,
        payload.required_equipment_json,
        payload.allowed_cycle_day_ids,
        payload.preferred_cycle_day_ids,
        payload.avoided_cycle_day_ids,
        payload.allowed_slot_ids,
        payload.preferred_slot_ids,
        payload.avoided_slot_ids,
        payload.required_capacity,
        payload.priority,
        payload.active ? 1 : 0,
        payload.metadata,
        req.user.id,
        req.user.id,
      ],
    )
    await recordTimetableAudit({
      connection,
      timetableId: payload.timetable_id,
      timetableVersionId: null,
      schoolId,
      actorUserId: req.user.id,
      action: "CURRICULUM_REQUIREMENT_CREATED",
      entityType: "curriculum_period_requirement",
      entityId: result.insertId,
      newValues: payload,
    })
    await connection.commit()
    return { requirement: { id: result.insertId, ...payload } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateCurriculumRequirement(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM curriculum_period_requirements WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
    if (!current) throw new HttpError(404, "Curriculum requirement was not found")
    const payload = curriculumPayload(req, schoolId, current)
    await validateCurriculumPayload(connection, payload)
    await connection.query(
      `UPDATE curriculum_period_requirements
       SET academic_year_id = ?, term_id = ?, timetable_id = ?, class_id = ?, stream_section = ?, student_group_id = ?,
        subject_id = ?, teacher_id = ?, assistant_teacher_id = ?, entry_type = ?, periods_per_cycle = ?, block_length = ?,
        required_facility_id = ?, required_facility_type = ?, preferred_facility_ids = ?, required_equipment_json = ?,
        allowed_cycle_day_ids = ?, preferred_cycle_day_ids = ?, avoided_cycle_day_ids = ?, allowed_slot_ids = ?,
        preferred_slot_ids = ?, avoided_slot_ids = ?, required_capacity = ?, priority = ?, active = ?, metadata = ?, updated_by = ?
       WHERE school_id = ? AND id = ?`,
      [
        payload.academic_year_id,
        payload.term_id,
        payload.timetable_id,
        payload.class_id,
        payload.stream_section,
        payload.student_group_id,
        payload.subject_id,
        payload.teacher_id,
        payload.assistant_teacher_id,
        payload.entry_type,
        payload.periods_per_cycle,
        payload.block_length,
        payload.required_facility_id,
        payload.required_facility_type,
        payload.preferred_facility_ids,
        payload.required_equipment_json,
        payload.allowed_cycle_day_ids,
        payload.preferred_cycle_day_ids,
        payload.avoided_cycle_day_ids,
        payload.allowed_slot_ids,
        payload.preferred_slot_ids,
        payload.avoided_slot_ids,
        payload.required_capacity,
        payload.priority,
        payload.active ? 1 : 0,
        payload.metadata,
        req.user.id,
        schoolId,
        id,
      ],
    )
    await recordTimetableAudit({
      connection,
      timetableId: payload.timetable_id,
      timetableVersionId: null,
      schoolId,
      actorUserId: req.user.id,
      action: "CURRICULUM_REQUIREMENT_UPDATED",
      entityType: "curriculum_period_requirement",
      entityId: id,
      previousValues: current,
      newValues: payload,
    })
    await connection.commit()
    return { requirement: { id, ...payload } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveCurriculumRequirement(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM curriculum_period_requirements WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
    if (!current) throw new HttpError(404, "Curriculum requirement was not found")
    await connection.query("UPDATE curriculum_period_requirements SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, id])
    await recordTimetableAudit({
      connection,
      timetableId: current.timetable_id,
      timetableVersionId: null,
      schoolId,
      actorUserId: req.user.id,
      action: "CURRICULUM_REQUIREMENT_ARCHIVED",
      entityType: "curriculum_period_requirement",
      entityId: id,
      previousValues: current,
    })
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function slotTagPayloads(value) {
  const source = value === undefined ? [] : value
  if (!Array.isArray(source)) {
    return codeArray(source, BELL_SLOT_TAGS).map((code, index) => ({
      tag_code: code,
      tag_name: TAG_LABELS[code] || code,
      priority: 50 + index,
    }))
  }
  return [...new Map(source
    .map((item, index) => {
      const code = cleanText(typeof item === "object" ? item.tag_code || item.tagCode || item.code : item).toUpperCase()
      if (!BELL_SLOT_TAGS.has(code)) return null
      return [code, {
        tag_code: code,
        tag_name: cleanText(typeof item === "object" ? item.tag_name || item.tagName || item.name : null, TAG_LABELS[code] || code),
        priority: intValue(typeof item === "object" ? item.priority : undefined, 50 + index),
      }]
    })
    .filter(Boolean)).values()]
}

function normalizeFocusCategory(row) {
  if (!row) return null
  return {
    ...row,
    default_priority: Number(row.default_priority || 0),
    active: Number(row.active || 0),
  }
}

function normalizeFocusAssignment(row) {
  if (!row) return null
  return {
    ...row,
    active: Number(row.active || 0),
  }
}

function normalizeFocusRule(row) {
  if (!row) return null
  return {
    ...row,
    preferred_slot_tags: parseJson(row.preferred_slot_tags, []),
    avoided_slot_tags: parseJson(row.avoided_slot_tags, []),
    preferred_slot_ids: parseJson(row.preferred_slot_ids, []),
    avoided_slot_ids: parseJson(row.avoided_slot_ids, []),
    penalty_weight: Number(row.penalty_weight || 0),
    max_after_lunch_per_cycle: row.max_after_lunch_per_cycle === null || row.max_after_lunch_per_cycle === undefined ? null : Number(row.max_after_lunch_per_cycle),
    max_last_period_per_cycle: row.max_last_period_per_cycle === null || row.max_last_period_per_cycle === undefined ? null : Number(row.max_last_period_per_cycle),
    minimum_preferred_per_cycle: row.minimum_preferred_per_cycle === null || row.minimum_preferred_per_cycle === undefined ? null : Number(row.minimum_preferred_per_cycle),
    allow_override: Number(row.allow_override || 0),
    active: Number(row.active || 0),
  }
}

function normalizeStreamRule(row) {
  if (!row) return null
  return {
    ...row,
    penalty_weight: Number(row.penalty_weight || 0),
    max_parallel_count: row.max_parallel_count === null || row.max_parallel_count === undefined ? null : Number(row.max_parallel_count),
    require_different_teachers: Number(row.require_different_teachers || 0),
    require_different_rooms: Number(row.require_different_rooms || 0),
    allow_override: Number(row.allow_override || 0),
    active: Number(row.active || 0),
  }
}

function focusCategoryPayload(req, schoolId, current = {}) {
  const name = cleanText(req.body.name || current.name)
  if (!name) throw new HttpError(400, "Focus category name is required")
  const code = cleanText(req.body.code || current.code || name).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  if (!code) throw new HttpError(400, "Focus category code is required")
  return {
    school_id: schoolId,
    name,
    code,
    description: cleanText(req.body.description || current.description) || null,
    default_priority: intValue(req.body.default_priority ?? req.body.defaultPriority ?? current.default_priority, 50),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
  }
}

function focusAssignmentPayload(req, schoolId, current = {}) {
  return {
    school_id: schoolId,
    subject_id: idValue(req.body.subject_id || req.body.subjectId || current.subject_id, "subject_id", true),
    focus_category_id: idValue(req.body.focus_category_id || req.body.focusCategoryId || current.focus_category_id, "focus_category_id", true),
    academic_year_id: idValue(req.body.academic_year_id || req.body.academicYearId || current.academic_year_id),
    term_id: idValue(req.body.term_id || req.body.termId || current.term_id),
    grade_level: cleanText(req.body.grade_level || req.body.gradeLevel || current.grade_level) || null,
    class_id: idValue(req.body.class_id || req.body.classId || current.class_id),
    stream_section: cleanText(req.body.stream_section || req.body.streamSection || current.stream_section) || null,
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
  }
}

function focusRulePayload(req, schoolId, current = {}) {
  const name = cleanText(req.body.name || current.name)
  if (!name) throw new HttpError(400, "Focus rule name is required")
  const focusCategoryId = idValue(req.body.focus_category_id || req.body.focusCategoryId || current.focus_category_id)
  const subjectId = idValue(req.body.subject_id || req.body.subjectId || current.subject_id)
  if (!focusCategoryId && !subjectId) throw new HttpError(400, "Choose a focus category or subject for this rule.")
  const preferredTags = codeArray(req.body.preferred_slot_tags ?? req.body.preferredSlotTags ?? current.preferred_slot_tags, BELL_SLOT_TAGS)
  const avoidedTags = codeArray(req.body.avoided_slot_tags ?? req.body.avoidedSlotTags ?? current.avoided_slot_tags, BELL_SLOT_TAGS)
  return {
    school_id: schoolId,
    name,
    description: cleanText(req.body.description || current.description) || null,
    focus_category_id: focusCategoryId,
    subject_id: subjectId,
    academic_year_id: idValue(req.body.academic_year_id || req.body.academicYearId || current.academic_year_id),
    term_id: idValue(req.body.term_id || req.body.termId || current.term_id),
    scope_type: enumValue(req.body.scope_type || req.body.scopeType || current.scope_type, SUBJECT_FOCUS_SCOPE_TYPES, current.scope_type || "WHOLE_SCHOOL"),
    scope_reference_id: idValue(req.body.scope_reference_id || req.body.scopeReferenceId || current.scope_reference_id),
    scope_value: cleanText(req.body.scope_value || req.body.scopeValue || current.scope_value) || null,
    class_id: idValue(req.body.class_id || req.body.classId || current.class_id),
    stream_section: cleanText(req.body.stream_section || req.body.streamSection || current.stream_section) || null,
    grade_level: cleanText(req.body.grade_level || req.body.gradeLevel || current.grade_level) || null,
    preferred_slot_tags: JSON.stringify(preferredTags),
    avoided_slot_tags: JSON.stringify(avoidedTags),
    preferred_slot_ids: jsonArrayText(req.body.preferred_slot_ids ?? req.body.preferredSlotIds ?? current.preferred_slot_ids),
    avoided_slot_ids: jsonArrayText(req.body.avoided_slot_ids ?? req.body.avoidedSlotIds ?? current.avoided_slot_ids),
    severity: enumValue(req.body.severity || current.severity, RULE_SEVERITIES, current.severity || "SOFT"),
    penalty_weight: intValue(req.body.penalty_weight ?? req.body.penaltyWeight ?? current.penalty_weight, 50),
    max_after_lunch_per_cycle: optionalIntValue(req.body.max_after_lunch_per_cycle ?? req.body.maxAfterLunchPerCycle ?? current.max_after_lunch_per_cycle, "max_after_lunch_per_cycle"),
    max_last_period_per_cycle: optionalIntValue(req.body.max_last_period_per_cycle ?? req.body.maxLastPeriodPerCycle ?? current.max_last_period_per_cycle, "max_last_period_per_cycle"),
    minimum_preferred_per_cycle: optionalIntValue(req.body.minimum_preferred_per_cycle ?? req.body.minimumPreferredPerCycle ?? current.minimum_preferred_per_cycle, "minimum_preferred_per_cycle"),
    allow_override: boolValue(req.body.allow_override ?? req.body.allowOverride, current.allow_override === undefined ? true : Boolean(current.allow_override)),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
  }
}

function streamRulePayload(req, schoolId, current = {}) {
  const name = cleanText(req.body.name || current.name)
  if (!name) throw new HttpError(400, "Stream rule name is required")
  const policy = enumValue(req.body.policy || current.policy, STREAM_RULE_POLICIES, current.policy || "DISALLOW_PARALLEL_SAME_SUBJECT")
  return {
    school_id: schoolId,
    name,
    description: cleanText(req.body.description || current.description) || null,
    academic_year_id: idValue(req.body.academic_year_id || req.body.academicYearId || current.academic_year_id),
    term_id: idValue(req.body.term_id || req.body.termId || current.term_id),
    scope_type: enumValue(req.body.scope_type || req.body.scopeType || current.scope_type, STREAM_RULE_SCOPE_TYPES, current.scope_type || "WHOLE_SCHOOL"),
    scope_reference_id: idValue(req.body.scope_reference_id || req.body.scopeReferenceId || current.scope_reference_id),
    scope_value: cleanText(req.body.scope_value || req.body.scopeValue || current.scope_value) || null,
    grade_level: cleanText(req.body.grade_level || req.body.gradeLevel || current.grade_level) || null,
    class_id: idValue(req.body.class_id || req.body.classId || current.class_id),
    stream_section: cleanText(req.body.stream_section || req.body.streamSection || current.stream_section) || null,
    subject_id: idValue(req.body.subject_id || req.body.subjectId || current.subject_id),
    policy,
    severity: enumValue(req.body.severity || current.severity, RULE_SEVERITIES, current.severity || "HARD"),
    penalty_weight: intValue(req.body.penalty_weight ?? req.body.penaltyWeight ?? current.penalty_weight, 80),
    max_parallel_count: optionalIntValue(req.body.max_parallel_count ?? req.body.maxParallelCount ?? current.max_parallel_count, "max_parallel_count"),
    require_different_teachers: policy === "ALLOW_ONLY_WITH_DIFFERENT_TEACHERS" || boolValue(req.body.require_different_teachers ?? req.body.requireDifferentTeachers, Boolean(current.require_different_teachers)),
    require_different_rooms: policy === "ALLOW_ONLY_WITH_DIFFERENT_ROOMS" || boolValue(req.body.require_different_rooms ?? req.body.requireDifferentRooms, Boolean(current.require_different_rooms)),
    allow_override: boolValue(req.body.allow_override ?? req.body.allowOverride, Boolean(current.allow_override)),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
  }
}

async function validateFocusAssignmentPayload(connection, payload) {
  await requireScopedRow(connection, "SELECT id FROM subjects WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.subject_id], "Subject was not found for this school.")
  await requireScopedRow(connection, "SELECT id FROM subject_focus_categories WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.focus_category_id], "Focus category was not found for this school.")
  if (payload.academic_year_id) await requireScopedRow(connection, "SELECT id FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id], "Academic year was not found for this school.")
  if (payload.term_id) await requireScopedRow(connection, "SELECT id FROM terms WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.term_id], "Term was not found for this school.")
  if (payload.class_id) await requireScopedRow(connection, "SELECT id FROM classes WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.class_id], "Class was not found for this school.")
}

async function validateFocusRulePayload(connection, payload) {
  if (payload.focus_category_id) await requireScopedRow(connection, "SELECT id FROM subject_focus_categories WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.focus_category_id], "Focus category was not found for this school.")
  if (payload.subject_id) await requireScopedRow(connection, "SELECT id FROM subjects WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.subject_id], "Subject was not found for this school.")
  if (payload.academic_year_id) await requireScopedRow(connection, "SELECT id FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id], "Academic year was not found for this school.")
  if (payload.term_id) await requireScopedRow(connection, "SELECT id FROM terms WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.term_id], "Term was not found for this school.")
  if (payload.class_id) await requireScopedRow(connection, "SELECT id FROM classes WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.class_id], "Class was not found for this school.")
}

async function validateStreamRulePayload(connection, payload) {
  if (payload.academic_year_id) await requireScopedRow(connection, "SELECT id FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.academic_year_id], "Academic year was not found for this school.")
  if (payload.term_id) await requireScopedRow(connection, "SELECT id FROM terms WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.term_id], "Term was not found for this school.")
  if (payload.class_id) await requireScopedRow(connection, "SELECT id FROM classes WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.class_id], "Class was not found for this school.")
  if (payload.subject_id) await requireScopedRow(connection, "SELECT id FROM subjects WHERE school_id = ? AND id = ? LIMIT 1", [payload.school_id, payload.subject_id], "Subject was not found for this school.")
}

export async function listBellSlotTags(req) {
  const schoolId = getScopedSchoolId(req)
  const templateId = idValue(req.query.bell_schedule_id || req.query.bellScheduleId || req.query.template_id || req.query.templateId)
  const params = [schoolId]
  const filters = ["bst.school_id = ?"]
  if (templateId) {
    filters.push("s.template_id = ?")
    params.push(templateId)
  }
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("bst.active = 1")
  const [rows] = await pool.query(
    `SELECT bst.*, s.template_id, s.slot_number, s.display_name AS slot_name, b.name AS bell_schedule_name
     FROM bell_schedule_slot_tags bst
     JOIN bell_schedule_slots s ON s.id = bst.bell_schedule_slot_id
     JOIN bell_schedule_templates b ON b.id = s.template_id AND b.school_id = bst.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY b.name, s.sort_order, bst.priority, bst.tag_name`,
    params,
  )
  return {
    available_tags: Array.from(BELL_SLOT_TAGS).map((code) => ({ code, name: TAG_LABELS[code] || code })),
    tags: rows.map((row) => ({ ...row, priority: Number(row.priority || 0), active: Number(row.active || 0) })),
  }
}

export async function setBellScheduleSlotTags(req) {
  const schoolId = getScopedSchoolId(req)
  const templateId = idValue(req.params.id, "bell schedule id", true)
  const slotId = idValue(req.body.bell_schedule_slot_id || req.body.bellScheduleSlotId || req.body.slot_id || req.body.slotId, "slot id", true)
  const tags = slotTagPayloads(req.body.tags ?? req.body.tag_codes ?? req.body.tagCodes)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const template = await loadBellTemplate(connection, schoolId, templateId)
    if (!template) throw new HttpError(404, "Bell schedule was not found")
    const slot = await loadSlot(connection, slotId)
    if (!slot || Number(slot.school_id) !== Number(schoolId) || Number(slot.template_id) !== Number(templateId)) throw new HttpError(404, "Period was not found in this bell schedule.")
    await connection.query("UPDATE bell_schedule_slot_tags SET active = 0, updated_by = ? WHERE school_id = ? AND bell_schedule_slot_id = ?", [req.user.id, schoolId, slotId])
    for (const tag of tags) {
      await connection.query(
        `INSERT INTO bell_schedule_slot_tags (
          school_id, bell_schedule_slot_id, tag_code, tag_name, priority, active, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON DUPLICATE KEY UPDATE tag_name = VALUES(tag_name), priority = VALUES(priority), active = 1, updated_by = VALUES(updated_by)`,
        [schoolId, slotId, tag.tag_code, tag.tag_name, tag.priority, req.user.id, req.user.id],
      )
    }
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId: template.timetable_id,
      actorUserId: req.user.id,
      action: "BELL_SCHEDULE_SLOT_TAGS_UPDATED",
      entityType: "bell_schedule_slot",
      entityId: slotId,
      newValues: { tags },
    })
    await connection.commit()
    return listBellSlotTags({ ...req, query: { bell_schedule_id: templateId } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listSubjectFocusCategories(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["school_id = ?"]
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("active = 1")
  const [rows] = await pool.query(
    `SELECT *
     FROM subject_focus_categories
     WHERE ${filters.join(" AND ")}
     ORDER BY active DESC, default_priority DESC, name
     LIMIT 200`,
    params,
  )
  return { categories: rows.map(normalizeFocusCategory) }
}

export async function createSubjectFocusCategory(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = focusCategoryPayload(req, schoolId)
  const [result] = await pool.query(
    `INSERT INTO subject_focus_categories (school_id, name, code, description, default_priority, active, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [schoolId, payload.name, payload.code, payload.description, payload.default_priority, payload.active ? 1 : 0, req.user.id, req.user.id],
  )
  return { category: normalizeFocusCategory({ id: Number(result.insertId), ...payload, active: payload.active ? 1 : 0 }) }
}

export async function updateSubjectFocusCategory(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus category id", true)
  const [[current]] = await pool.query("SELECT * FROM subject_focus_categories WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
  if (!current) throw new HttpError(404, "Focus category was not found")
  const payload = focusCategoryPayload(req, schoolId, current)
  await pool.query(
    `UPDATE subject_focus_categories
     SET name = ?, code = ?, description = ?, default_priority = ?, active = ?, updated_by = ?
     WHERE school_id = ? AND id = ?`,
    [payload.name, payload.code, payload.description, payload.default_priority, payload.active ? 1 : 0, req.user.id, schoolId, id],
  )
  return { category: normalizeFocusCategory({ id, ...payload, active: payload.active ? 1 : 0 }) }
}

export async function archiveSubjectFocusCategory(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus category id", true)
  const [result] = await pool.query("UPDATE subject_focus_categories SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, id])
  if (!result.affectedRows) throw new HttpError(404, "Focus category was not found")
  return { archived: true }
}

export async function listSubjectFocusAssignments(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["sfa.school_id = ?"]
  const subjectId = idValue(req.query.subject_id || req.query.subjectId)
  const categoryId = idValue(req.query.focus_category_id || req.query.focusCategoryId)
  const classId = idValue(req.query.class_id || req.query.classId)
  if (subjectId) {
    filters.push("sfa.subject_id = ?")
    params.push(subjectId)
  }
  if (categoryId) {
    filters.push("sfa.focus_category_id = ?")
    params.push(categoryId)
  }
  if (classId) {
    filters.push("(sfa.class_id IS NULL OR sfa.class_id = ?)")
    params.push(classId)
  }
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("sfa.active = 1")
  const [rows] = await pool.query(
    `SELECT sfa.*, subj.name AS subject_name, subj.code AS subject_code, cat.name AS focus_category_name,
      cat.code AS focus_category_code, ay.name AS academic_year_name, t.name AS term_name, c.name AS class_name
     FROM subject_focus_assignments sfa
     JOIN subjects subj ON subj.id = sfa.subject_id AND subj.school_id = sfa.school_id
     JOIN subject_focus_categories cat ON cat.id = sfa.focus_category_id AND cat.school_id = sfa.school_id
     LEFT JOIN academic_years ay ON ay.id = sfa.academic_year_id AND ay.school_id = sfa.school_id
     LEFT JOIN terms t ON t.id = sfa.term_id AND t.school_id = sfa.school_id
     LEFT JOIN classes c ON c.id = sfa.class_id AND c.school_id = sfa.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY sfa.active DESC, cat.default_priority DESC, subj.name, c.name, sfa.stream_section
     LIMIT 500`,
    params,
  )
  return { assignments: rows.map(normalizeFocusAssignment) }
}

export async function createSubjectFocusAssignment(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = focusAssignmentPayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await validateFocusAssignmentPayload(connection, payload)
    const [result] = await connection.query(
      `INSERT INTO subject_focus_assignments (
        school_id, subject_id, focus_category_id, academic_year_id, term_id, grade_level, class_id, stream_section, active, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, payload.subject_id, payload.focus_category_id, payload.academic_year_id, payload.term_id, payload.grade_level, payload.class_id, payload.stream_section, payload.active ? 1 : 0, req.user.id, req.user.id],
    )
    await connection.commit()
    return { assignment: normalizeFocusAssignment({ id: Number(result.insertId), ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateSubjectFocusAssignment(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus assignment id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM subject_focus_assignments WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
    if (!current) throw new HttpError(404, "Focus assignment was not found")
    const payload = focusAssignmentPayload(req, schoolId, current)
    await validateFocusAssignmentPayload(connection, payload)
    await connection.query(
      `UPDATE subject_focus_assignments
       SET subject_id = ?, focus_category_id = ?, academic_year_id = ?, term_id = ?, grade_level = ?, class_id = ?,
        stream_section = ?, active = ?, updated_by = ?
       WHERE school_id = ? AND id = ?`,
      [payload.subject_id, payload.focus_category_id, payload.academic_year_id, payload.term_id, payload.grade_level, payload.class_id, payload.stream_section, payload.active ? 1 : 0, req.user.id, schoolId, id],
    )
    await connection.commit()
    return { assignment: normalizeFocusAssignment({ id, ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveSubjectFocusAssignment(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus assignment id", true)
  const [result] = await pool.query("UPDATE subject_focus_assignments SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, id])
  if (!result.affectedRows) throw new HttpError(404, "Focus assignment was not found")
  return { archived: true }
}

export async function listSubjectFocusRules(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["sfr.school_id = ?"]
  const subjectId = idValue(req.query.subject_id || req.query.subjectId)
  const categoryId = idValue(req.query.focus_category_id || req.query.focusCategoryId)
  if (subjectId) {
    filters.push("(sfr.subject_id IS NULL OR sfr.subject_id = ?)")
    params.push(subjectId)
  }
  if (categoryId) {
    filters.push("(sfr.focus_category_id IS NULL OR sfr.focus_category_id = ?)")
    params.push(categoryId)
  }
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("sfr.active = 1")
  const [rows] = await pool.query(
    `SELECT sfr.*, cat.name AS focus_category_name, cat.code AS focus_category_code,
      subj.name AS subject_name, subj.code AS subject_code, ay.name AS academic_year_name, t.name AS term_name,
      c.name AS class_name
     FROM subject_focus_rules sfr
     LEFT JOIN subject_focus_categories cat ON cat.id = sfr.focus_category_id AND cat.school_id = sfr.school_id
     LEFT JOIN subjects subj ON subj.id = sfr.subject_id AND subj.school_id = sfr.school_id
     LEFT JOIN academic_years ay ON ay.id = sfr.academic_year_id AND ay.school_id = sfr.school_id
     LEFT JOIN terms t ON t.id = sfr.term_id AND t.school_id = sfr.school_id
     LEFT JOIN classes c ON c.id = sfr.class_id AND c.school_id = sfr.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY sfr.active DESC, sfr.severity, sfr.penalty_weight DESC, sfr.name
     LIMIT 500`,
    params,
  )
  return { rules: rows.map(normalizeFocusRule) }
}

export async function createSubjectFocusRule(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = focusRulePayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await validateFocusRulePayload(connection, payload)
    const [result] = await connection.query(
      `INSERT INTO subject_focus_rules (
        school_id, name, description, focus_category_id, subject_id, academic_year_id, term_id, scope_type,
        scope_reference_id, scope_value, class_id, stream_section, grade_level, preferred_slot_tags, avoided_slot_tags,
        preferred_slot_ids, avoided_slot_ids, severity, penalty_weight, max_after_lunch_per_cycle,
        max_last_period_per_cycle, minimum_preferred_per_cycle, allow_override, active, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId, payload.name, payload.description, payload.focus_category_id, payload.subject_id, payload.academic_year_id,
        payload.term_id, payload.scope_type, payload.scope_reference_id, payload.scope_value, payload.class_id,
        payload.stream_section, payload.grade_level, payload.preferred_slot_tags, payload.avoided_slot_tags,
        payload.preferred_slot_ids, payload.avoided_slot_ids, payload.severity, payload.penalty_weight,
        payload.max_after_lunch_per_cycle, payload.max_last_period_per_cycle, payload.minimum_preferred_per_cycle,
        payload.allow_override ? 1 : 0, payload.active ? 1 : 0, req.user.id, req.user.id,
      ],
    )
    await connection.commit()
    return { rule: normalizeFocusRule({ id: Number(result.insertId), ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateSubjectFocusRule(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus rule id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM subject_focus_rules WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
    if (!current) throw new HttpError(404, "Focus rule was not found")
    const payload = focusRulePayload(req, schoolId, current)
    await validateFocusRulePayload(connection, payload)
    await connection.query(
      `UPDATE subject_focus_rules
       SET name = ?, description = ?, focus_category_id = ?, subject_id = ?, academic_year_id = ?, term_id = ?,
        scope_type = ?, scope_reference_id = ?, scope_value = ?, class_id = ?, stream_section = ?, grade_level = ?,
        preferred_slot_tags = ?, avoided_slot_tags = ?, preferred_slot_ids = ?, avoided_slot_ids = ?, severity = ?,
        penalty_weight = ?, max_after_lunch_per_cycle = ?, max_last_period_per_cycle = ?,
        minimum_preferred_per_cycle = ?, allow_override = ?, active = ?, updated_by = ?
       WHERE school_id = ? AND id = ?`,
      [
        payload.name, payload.description, payload.focus_category_id, payload.subject_id, payload.academic_year_id,
        payload.term_id, payload.scope_type, payload.scope_reference_id, payload.scope_value, payload.class_id,
        payload.stream_section, payload.grade_level, payload.preferred_slot_tags, payload.avoided_slot_tags,
        payload.preferred_slot_ids, payload.avoided_slot_ids, payload.severity, payload.penalty_weight,
        payload.max_after_lunch_per_cycle, payload.max_last_period_per_cycle, payload.minimum_preferred_per_cycle,
        payload.allow_override ? 1 : 0, payload.active ? 1 : 0, req.user.id, schoolId, id,
      ],
    )
    await connection.commit()
    return { rule: normalizeFocusRule({ id, ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveSubjectFocusRule(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "focus rule id", true)
  const [result] = await pool.query("UPDATE subject_focus_rules SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, id])
  if (!result.affectedRows) throw new HttpError(404, "Focus rule was not found")
  return { archived: true }
}

export async function listStreamSchedulingRules(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["ssr.school_id = ?"]
  const subjectId = idValue(req.query.subject_id || req.query.subjectId)
  const classId = idValue(req.query.class_id || req.query.classId)
  if (subjectId) {
    filters.push("(ssr.subject_id IS NULL OR ssr.subject_id = ?)")
    params.push(subjectId)
  }
  if (classId) {
    filters.push("(ssr.class_id IS NULL OR ssr.class_id = ?)")
    params.push(classId)
  }
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("ssr.active = 1")
  const [rows] = await pool.query(
    `SELECT ssr.*, subj.name AS subject_name, subj.code AS subject_code, ay.name AS academic_year_name,
      t.name AS term_name, c.name AS class_name
     FROM stream_scheduling_rules ssr
     LEFT JOIN subjects subj ON subj.id = ssr.subject_id AND subj.school_id = ssr.school_id
     LEFT JOIN academic_years ay ON ay.id = ssr.academic_year_id AND ay.school_id = ssr.school_id
     LEFT JOIN terms t ON t.id = ssr.term_id AND t.school_id = ssr.school_id
     LEFT JOIN classes c ON c.id = ssr.class_id AND c.school_id = ssr.school_id
     WHERE ${filters.join(" AND ")}
     ORDER BY ssr.active DESC, ssr.severity, ssr.penalty_weight DESC, ssr.name
     LIMIT 500`,
    params,
  )
  return { rules: rows.map(normalizeStreamRule) }
}

export async function createStreamSchedulingRule(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = streamRulePayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await validateStreamRulePayload(connection, payload)
    const [result] = await connection.query(
      `INSERT INTO stream_scheduling_rules (
        school_id, name, description, academic_year_id, term_id, scope_type, scope_reference_id, scope_value,
        grade_level, class_id, stream_section, subject_id, policy, severity, penalty_weight, max_parallel_count,
        require_different_teachers, require_different_rooms, allow_override, active, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId, payload.name, payload.description, payload.academic_year_id, payload.term_id, payload.scope_type,
        payload.scope_reference_id, payload.scope_value, payload.grade_level, payload.class_id, payload.stream_section,
        payload.subject_id, payload.policy, payload.severity, payload.penalty_weight, payload.max_parallel_count,
        payload.require_different_teachers ? 1 : 0, payload.require_different_rooms ? 1 : 0, payload.allow_override ? 1 : 0,
        payload.active ? 1 : 0, req.user.id, req.user.id,
      ],
    )
    await connection.commit()
    return { rule: normalizeStreamRule({ id: Number(result.insertId), ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateStreamSchedulingRule(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "stream rule id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM stream_scheduling_rules WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, id])
    if (!current) throw new HttpError(404, "Stream scheduling rule was not found")
    const payload = streamRulePayload(req, schoolId, current)
    await validateStreamRulePayload(connection, payload)
    await connection.query(
      `UPDATE stream_scheduling_rules
       SET name = ?, description = ?, academic_year_id = ?, term_id = ?, scope_type = ?, scope_reference_id = ?,
        scope_value = ?, grade_level = ?, class_id = ?, stream_section = ?, subject_id = ?, policy = ?, severity = ?,
        penalty_weight = ?, max_parallel_count = ?, require_different_teachers = ?, require_different_rooms = ?,
        allow_override = ?, active = ?, updated_by = ?
       WHERE school_id = ? AND id = ?`,
      [
        payload.name, payload.description, payload.academic_year_id, payload.term_id, payload.scope_type,
        payload.scope_reference_id, payload.scope_value, payload.grade_level, payload.class_id, payload.stream_section,
        payload.subject_id, payload.policy, payload.severity, payload.penalty_weight, payload.max_parallel_count,
        payload.require_different_teachers ? 1 : 0, payload.require_different_rooms ? 1 : 0, payload.allow_override ? 1 : 0,
        payload.active ? 1 : 0, req.user.id, schoolId, id,
      ],
    )
    await connection.commit()
    return { rule: normalizeStreamRule({ id, ...payload, active: payload.active ? 1 : 0 }) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveStreamSchedulingRule(req) {
  const schoolId = getScopedSchoolId(req)
  const id = idValue(req.params.id, "stream rule id", true)
  const [result] = await pool.query("UPDATE stream_scheduling_rules SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, id])
  if (!result.affectedRows) throw new HttpError(404, "Stream scheduling rule was not found")
  return { archived: true }
}

function weeklyActivityPayload(req, schoolId, current = {}) {
  const name = cleanText(req.body.name || current.name)
  if (!name) throw new HttpError(400, "Activity name is required")
  return {
    school_id: schoolId,
    academic_year_id: idValue(req.body.academic_year_id || req.body.academicYearId || current.academic_year_id, "academic_year_id", true),
    term_id: idValue(req.body.term_id || req.body.termId || current.term_id),
    name,
    activity_type: enumValue(req.body.activity_type || req.body.activityType || current.activity_type, ACTIVITY_TYPES, current.activity_type || "CUSTOM"),
    activity_type_label: cleanText(req.body.activity_type_label || req.body.activityTypeLabel || current.activity_type_label) || null,
    description: cleanText(req.body.description || current.description) || null,
    recurrence_type: enumValue(req.body.recurrence_type || req.body.recurrenceType || current.recurrence_type, new Set(["WEEKLY", "CYCLE_DAY", "WEEK_A", "WEEK_B", "EVERY_N_WEEKS", "SELECTED_DATES", "TERM_RANGE", "CUSTOM"]), current.recurrence_type || "WEEKLY"),
    recurrence_interval: intValue(req.body.recurrence_interval ?? req.body.recurrenceInterval ?? current.recurrence_interval, 0) || null,
    selected_dates: jsonText(req.body.selected_dates || req.body.selectedDates || current.selected_dates || [], []),
    weekday: req.body.weekday === undefined || req.body.weekday === "" ? (current.weekday ?? null) : intValue(req.body.weekday, 0),
    cycle_day_id: idValue(req.body.cycle_day_id || req.body.cycleDayId || current.cycle_day_id),
    start_slot_id: idValue(req.body.start_slot_id || req.body.startSlotId || current.start_slot_id),
    end_slot_id: idValue(req.body.end_slot_id || req.body.endSlotId || current.end_slot_id),
    start_time: timeText(req.body.start_time || req.body.startTime || current.start_time),
    end_time: timeText(req.body.end_time || req.body.endTime || current.end_time),
    scope_type: enumValue(req.body.scope_type || req.body.scopeType || current.scope_type, new Set(["WHOLE_SCHOOL", "SELECTED_GRADES", "SELECTED_CLASSES", "SELECTED_STREAMS", "SELECTED_STUDENT_GROUPS", "SELECTED_DEPARTMENTS", "STAFF_ONLY", "CUSTOM"]), current.scope_type || "WHOLE_SCHOOL"),
    facility_id: idValue(req.body.facility_id || req.body.facilityId || current.facility_id),
    responsible_teacher_id: idValue(req.body.responsible_teacher_id || req.body.responsibleTeacherId || current.responsible_teacher_id),
    attendance_required: boolValue(req.body.attendance_required ?? req.body.attendanceRequired, Boolean(current.attendance_required)),
    blocks_normal_lessons: boolValue(req.body.blocks_normal_lessons ?? req.body.blocksNormalLessons, current.blocks_normal_lessons === undefined ? true : Boolean(current.blocks_normal_lessons)),
    allows_exam_override: boolValue(req.body.allows_exam_override ?? req.body.allowsExamOverride, current.allows_exam_override === undefined ? true : Boolean(current.allows_exam_override)),
    exam_policy: enumValue(req.body.exam_policy || req.body.examPolicy || current.exam_policy, EXAM_POLICIES, current.exam_policy || "REQUIRE_MANUAL_DECISION"),
    appears_on_student_timetables: boolValue(req.body.appears_on_student_timetables ?? req.body.appearsOnStudentTimetables, current.appears_on_student_timetables === undefined ? true : Boolean(current.appears_on_student_timetables)),
    appears_on_teacher_timetables: boolValue(req.body.appears_on_teacher_timetables ?? req.body.appearsOnTeacherTimetables, current.appears_on_teacher_timetables === undefined ? true : Boolean(current.appears_on_teacher_timetables)),
    notify_on_change: boolValue(req.body.notify_on_change ?? req.body.notifyOnChange, Boolean(current.notify_on_change)),
    priority: intValue(req.body.priority ?? current.priority, 50),
    locked_by_default: boolValue(req.body.locked_by_default ?? req.body.lockedByDefault, current.locked_by_default === undefined ? true : Boolean(current.locked_by_default)),
    active: req.body.active === undefined ? (current.active === undefined ? true : Boolean(current.active)) : boolValue(req.body.active),
    effective_from: dateOnly(req.body.effective_from || req.body.effectiveFrom || current.effective_from),
    effective_to: dateOnly(req.body.effective_to || req.body.effectiveTo || current.effective_to),
    scope_assignments: Array.isArray(req.body.scope_assignments || req.body.scopeAssignments) ? (req.body.scope_assignments || req.body.scopeAssignments) : [],
  }
}

async function saveActivityScopes(connection, schoolId, activityId, scopeType, scopeAssignments = []) {
  await connection.query("DELETE FROM weekly_school_activity_scope_assignments WHERE school_id = ? AND activity_id = ?", [schoolId, activityId])
  for (const item of scopeAssignments) {
    const referenceId = idValue(item.scope_reference_id || item.scopeReferenceId || item.id)
    const scopeValue = cleanText(item.scope_value || item.scopeValue || item.value) || null
    if (!referenceId && !scopeValue) continue
    await connection.query(
      `INSERT INTO weekly_school_activity_scope_assignments (school_id, activity_id, scope_type, scope_reference_id, scope_value)
       VALUES (?, ?, ?, ?, ?)`,
      [schoolId, activityId, cleanText(item.scope_type || item.scopeType || scopeType).toUpperCase(), referenceId, scopeValue],
    )
  }
}

export async function listWeeklyActivities(req) {
  const schoolId = getScopedSchoolId(req)
  const params = [schoolId]
  const filters = ["wsa.school_id = ?"]
  if (!boolValue(req.query.include_inactive || req.query.includeInactive)) filters.push("wsa.active = 1")
  const academicYearId = idValue(req.query.academic_year_id || req.query.academicYearId)
  const termId = idValue(req.query.term_id || req.query.termId)
  if (academicYearId) {
    filters.push("wsa.academic_year_id = ?")
    params.push(academicYearId)
  }
  if (termId) {
    filters.push("(wsa.term_id = ? OR wsa.term_id IS NULL)")
    params.push(termId)
  }
  const [rows] = await pool.query(
    `SELECT wsa.*, ay.name AS academic_year_name, t.name AS term_name, sf.name AS facility_name, u.full_name AS responsible_teacher_name,
      ss.display_name AS start_slot_name, es.display_name AS end_slot_name, cd.display_name AS cycle_day_name,
      COUNT(DISTINCT scope.id) AS scope_count
     FROM weekly_school_activities wsa
     JOIN academic_years ay ON ay.id = wsa.academic_year_id AND ay.school_id = wsa.school_id
     LEFT JOIN terms t ON t.id = wsa.term_id AND t.school_id = wsa.school_id
     LEFT JOIN school_facilities sf ON sf.id = wsa.facility_id AND sf.school_id = wsa.school_id
     LEFT JOIN users u ON u.id = wsa.responsible_teacher_id
     LEFT JOIN bell_schedule_slots ss ON ss.id = wsa.start_slot_id
     LEFT JOIN bell_schedule_slots es ON es.id = wsa.end_slot_id
     LEFT JOIN timetable_cycle_days cd ON cd.id = wsa.cycle_day_id
     LEFT JOIN weekly_school_activity_scope_assignments scope ON scope.activity_id = wsa.id
     WHERE ${filters.join(" AND ")}
     GROUP BY wsa.id
     ORDER BY wsa.active DESC, wsa.priority DESC, wsa.name`,
    params,
  )
  return { activities: rows.map((row) => ({ ...row, selected_dates: parseJson(row.selected_dates, []), scope_count: Number(row.scope_count || 0) })) }
}

export async function getWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const activityId = idValue(req.params.id, "activity id", true)
  const [[activity]] = await pool.query("SELECT * FROM weekly_school_activities WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, activityId])
  if (!activity) throw new HttpError(404, "Weekly activity was not found")
  const [scopes] = await pool.query("SELECT * FROM weekly_school_activity_scope_assignments WHERE school_id = ? AND activity_id = ? ORDER BY scope_type, scope_value", [schoolId, activityId])
  return { activity: { ...activity, selected_dates: parseJson(activity.selected_dates, []) }, scopes }
}

export async function createWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = weeklyActivityPayload(req, schoolId)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO weekly_school_activities (
        school_id, academic_year_id, term_id, name, activity_type, activity_type_label, description, recurrence_type,
        recurrence_interval, selected_dates, weekday, cycle_day_id, start_slot_id, end_slot_id, start_time, end_time,
        scope_type, facility_id, responsible_teacher_id, attendance_required, blocks_normal_lessons, allows_exam_override,
        exam_policy, appears_on_student_timetables, appears_on_teacher_timetables, notify_on_change, priority,
        locked_by_default, active, effective_from, effective_to, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        payload.academic_year_id,
        payload.term_id,
        payload.name,
        payload.activity_type,
        payload.activity_type_label,
        payload.description,
        payload.recurrence_type,
        payload.recurrence_interval,
        payload.selected_dates,
        payload.weekday,
        payload.cycle_day_id,
        payload.start_slot_id,
        payload.end_slot_id,
        payload.start_time,
        payload.end_time,
        payload.scope_type,
        payload.facility_id,
        payload.responsible_teacher_id,
        payload.attendance_required ? 1 : 0,
        payload.blocks_normal_lessons ? 1 : 0,
        payload.allows_exam_override ? 1 : 0,
        payload.exam_policy,
        payload.appears_on_student_timetables ? 1 : 0,
        payload.appears_on_teacher_timetables ? 1 : 0,
        payload.notify_on_change ? 1 : 0,
        payload.priority,
        payload.locked_by_default ? 1 : 0,
        payload.active ? 1 : 0,
        payload.effective_from,
        payload.effective_to,
        req.user.id,
        req.user.id,
      ],
    )
    const activityId = Number(result.insertId)
    await saveActivityScopes(connection, schoolId, activityId, payload.scope_type, payload.scope_assignments)
    await connection.commit()
    return getWeeklyActivity({ ...req, params: { id: activityId } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const activityId = idValue(req.params.id, "activity id", true)
  const current = await getWeeklyActivity(req).then((payload) => payload.activity)
  const payload = weeklyActivityPayload(req, schoolId, current)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query(
      `UPDATE weekly_school_activities
       SET academic_year_id = ?, term_id = ?, name = ?, activity_type = ?, activity_type_label = ?, description = ?,
        recurrence_type = ?, recurrence_interval = ?, selected_dates = ?, weekday = ?, cycle_day_id = ?,
        start_slot_id = ?, end_slot_id = ?, start_time = ?, end_time = ?, scope_type = ?, facility_id = ?,
        responsible_teacher_id = ?, attendance_required = ?, blocks_normal_lessons = ?, allows_exam_override = ?,
        exam_policy = ?, appears_on_student_timetables = ?, appears_on_teacher_timetables = ?, notify_on_change = ?,
        priority = ?, locked_by_default = ?, active = ?, effective_from = ?, effective_to = ?, updated_by = ?
       WHERE school_id = ? AND id = ?`,
      [
        payload.academic_year_id,
        payload.term_id,
        payload.name,
        payload.activity_type,
        payload.activity_type_label,
        payload.description,
        payload.recurrence_type,
        payload.recurrence_interval,
        payload.selected_dates,
        payload.weekday,
        payload.cycle_day_id,
        payload.start_slot_id,
        payload.end_slot_id,
        payload.start_time,
        payload.end_time,
        payload.scope_type,
        payload.facility_id,
        payload.responsible_teacher_id,
        payload.attendance_required ? 1 : 0,
        payload.blocks_normal_lessons ? 1 : 0,
        payload.allows_exam_override ? 1 : 0,
        payload.exam_policy,
        payload.appears_on_student_timetables ? 1 : 0,
        payload.appears_on_teacher_timetables ? 1 : 0,
        payload.notify_on_change ? 1 : 0,
        payload.priority,
        payload.locked_by_default ? 1 : 0,
        payload.active ? 1 : 0,
        payload.effective_from,
        payload.effective_to,
        req.user.id,
        schoolId,
        activityId,
      ],
    )
    await saveActivityScopes(connection, schoolId, activityId, payload.scope_type, payload.scope_assignments)
    await connection.commit()
    return getWeeklyActivity(req)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const activityId = idValue(req.params.id, "activity id", true)
  const [result] = await pool.query("UPDATE weekly_school_activities SET active = 0, updated_by = ? WHERE school_id = ? AND id = ?", [req.user.id, schoolId, activityId])
  if (!result.affectedRows) throw new HttpError(404, "Weekly activity was not found")
  return { archived: true }
}

export async function duplicateWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const activityId = idValue(req.params.id, "activity id", true)
  const currentPayload = await getWeeklyActivity(req)
  const current = currentPayload.activity
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO weekly_school_activities (
        school_id, academic_year_id, term_id, name, activity_type, activity_type_label, description, recurrence_type,
        recurrence_interval, selected_dates, weekday, cycle_day_id, start_slot_id, end_slot_id, start_time, end_time,
        scope_type, facility_id, responsible_teacher_id, attendance_required, blocks_normal_lessons, allows_exam_override,
        exam_policy, appears_on_student_timetables, appears_on_teacher_timetables, notify_on_change, priority,
        locked_by_default, active, effective_from, effective_to, created_by, updated_by
      )
      SELECT school_id, academic_year_id, term_id, ?, activity_type, activity_type_label, description, recurrence_type,
        recurrence_interval, selected_dates, weekday, cycle_day_id, start_slot_id, end_slot_id, start_time, end_time,
        scope_type, facility_id, responsible_teacher_id, attendance_required, blocks_normal_lessons, allows_exam_override,
        exam_policy, appears_on_student_timetables, appears_on_teacher_timetables, notify_on_change, priority,
        locked_by_default, active, effective_from, effective_to, ?, ?
      FROM weekly_school_activities WHERE school_id = ? AND id = ?`,
      [cleanText(req.body.name || `${current.name} Copy`), req.user.id, req.user.id, schoolId, activityId],
    )
    const nextId = Number(result.insertId)
    for (const scope of currentPayload.scopes) {
      await connection.query(
        `INSERT INTO weekly_school_activity_scope_assignments (school_id, activity_id, scope_type, scope_reference_id, scope_value)
         VALUES (?, ?, ?, ?, ?)`,
        [schoolId, nextId, scope.scope_type, scope.scope_reference_id, scope.scope_value],
      )
    }
    await connection.commit()
    return getWeeklyActivity({ ...req, params: { id: nextId } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function activityScopeClasses(connection, schoolId, activity) {
  if (activity.scope_type === "STAFF_ONLY") return []
  if (activity.scope_type === "WHOLE_SCHOOL") {
    const [classes] = await connection.query("SELECT id, name FROM classes WHERE school_id = ? ORDER BY name", [schoolId])
    return classes
  }
  const [scopes] = await connection.query("SELECT * FROM weekly_school_activity_scope_assignments WHERE school_id = ? AND activity_id = ?", [schoolId, activity.id])
  if (activity.scope_type === "SELECTED_CLASSES") {
    const classIds = scopes.map((scope) => Number(scope.scope_reference_id)).filter(Boolean)
    if (!classIds.length) return []
    const [classes] = await connection.query(`SELECT id, name FROM classes WHERE school_id = ? AND id IN (${classIds.map(() => "?").join(",")}) ORDER BY name`, [schoolId, ...classIds])
    return classes
  }
  if (activity.scope_type === "SELECTED_GRADES") {
    const grades = scopes.map((scope) => scope.scope_value).filter(Boolean)
    if (!grades.length) return []
    const [classes] = await connection.query(`SELECT id, name FROM classes WHERE school_id = ? AND grade_level IN (${grades.map(() => "?").join(",")}) ORDER BY name`, [schoolId, ...grades])
    return classes
  }
  return []
}

async function activityCycleDay(connection, timetableId, activity) {
  if (activity.cycle_day_id) return activity.cycle_day_id
  if (activity.weekday !== null && activity.weekday !== undefined) {
    const [[day]] = await connection.query(
      "SELECT id FROM timetable_cycle_days WHERE timetable_id = ? AND weekday = ? AND active = 1 ORDER BY sort_order LIMIT 1",
      [timetableId, activity.weekday],
    )
    return day?.id || null
  }
  return null
}

export async function validateWeeklyActivity(req) {
  const schoolId = getScopedSchoolId(req)
  const payload = weeklyActivityPayload(req, schoolId)
  const conflicts = []
  if (!payload.start_slot_id && !payload.start_time) conflicts.push({ code: "MISSING_ACTIVITY_START", severity: "HARD", message: "Select a start period or start time for this activity." })
  if (!payload.end_slot_id && !payload.end_time) conflicts.push({ code: "MISSING_ACTIVITY_END", severity: "HARD", message: "Select an end period or end time for this activity." })
  if (payload.facility_id) conflicts.push(...await validateFacilityUsePayload(pool, schoolId, { ...payload, facility_id: payload.facility_id, entry_type: "WEEKLY_ACTIVITY" }))
  return { valid: !conflicts.some((item) => item.severity === "HARD"), conflicts }
}

export async function applyWeeklyActivitiesToVersion(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const preview = boolValue(req.body.preview ?? req.query.preview, false)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const timetable = await loadTimetable(connection, schoolId, timetableId)
    if (!timetable) throw new HttpError(404, "Timetable was not found")
    if (timetable.timetable_type !== "SCHOOL_TIMETABLE") throw new HttpError(400, "Weekly activities can only be applied to school timetables")
    const version = await loadVersion(connection, timetableId, versionId)
    if (!version) throw new HttpError(404, "Timetable version was not found")
    editableVersionOrThrow(version)

    const [activities] = await connection.query(
      `SELECT *
       FROM weekly_school_activities
       WHERE school_id = ? AND academic_year_id = ? AND (term_id = ? OR term_id IS NULL)
        AND active = 1
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY priority DESC, name`,
      [schoolId, timetable.academic_year_id, timetable.term_id, timetable.effective_to, timetable.effective_from],
    )

    const previewRows = []
    const conflicts = []
    if (!preview) {
      await connection.query("DELETE FROM timetable_entries WHERE timetable_version_id = ? AND source_weekly_activity_id IS NOT NULL", [versionId])
    }
    for (const activity of activities) {
      const cycleDayId = await activityCycleDay(connection, timetableId, activity)
      if (!cycleDayId) {
        conflicts.push({ code: "ACTIVITY_DAY_NOT_MAPPED", severity: "HARD", message: `${activity.name} does not map to an active timetable cycle day.`, activity_id: Number(activity.id) })
        continue
      }
      if (!activity.start_slot_id) {
        conflicts.push({ code: "ACTIVITY_SLOT_NOT_MAPPED", severity: "HARD", message: `${activity.name} must use bell periods before it can be applied to a timetable version.`, activity_id: Number(activity.id) })
        continue
      }
      const classes = await activityScopeClasses(connection, schoolId, activity)
      const row = {
        activity_id: Number(activity.id),
        title: activity.name,
        activity_type: activity.activity_type,
        cycle_day_id: cycleDayId,
        slot_start_id: activity.start_slot_id,
        slot_end_id: activity.end_slot_id || activity.start_slot_id,
        facility_id: activity.facility_id,
        teacher_id: activity.responsible_teacher_id,
        class_count: classes.length,
        scope_type: activity.scope_type,
      }
      previewRows.push(row)
      const validation = await validateTimetableEntry(connection, schoolId, timetable, version, {
        cycle_day_id: cycleDayId,
        slot_start_id: activity.start_slot_id,
        slot_end_id: activity.end_slot_id || activity.start_slot_id,
        teacher_id: activity.responsible_teacher_id,
        facility_id: activity.facility_id,
        entry_type: activityEntryType(activity.activity_type),
        title: activity.name,
      }, {
        ignoreWeeklyActivityId: activity.id,
      })
      const facilityConflicts = await validateFacilityUsePayload(connection, schoolId, {
        timetable_version_id: versionId,
        cycle_day_id: cycleDayId,
        slot_start_id: activity.start_slot_id,
        slot_end_id: activity.end_slot_id || activity.start_slot_id,
        facility_id: activity.facility_id,
        teacher_id: activity.responsible_teacher_id,
        entry_type: activityEntryType(activity.activity_type),
        title: activity.name,
      })
      conflicts.push(...validation.map((item) => ({ ...item, activity_id: Number(activity.id) })), ...facilityConflicts.map((item) => ({ ...item, activity_id: Number(activity.id) })))
    }

    if (preview) {
      await connection.rollback()
      return { preview: previewRows, conflicts, committed: false }
    }
    assertNoBlockingConflicts(conflicts)

    for (const row of previewRows) {
      await connection.query(
        `INSERT INTO timetable_entries (
          timetable_version_id, cycle_day_id, slot_start_id, slot_end_id, entry_type, teacher_id, facility_id,
          source_weekly_activity_id, title, locked, manually_modified, modification_reason, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'Applied from weekly activity settings', ?, ?)`,
        [
          versionId,
          row.cycle_day_id,
          row.slot_start_id,
          row.slot_end_id,
          activityEntryType(row.activity_type),
          row.teacher_id,
          row.facility_id,
          row.activity_id,
          row.title,
          req.user.id,
          req.user.id,
        ],
      )
    }
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId,
      timetableVersionId: versionId,
      actorUserId: req.user.id,
      action: "WEEKLY_ACTIVITIES_APPLIED",
      entityType: "timetable_version",
      entityId: versionId,
      newValues: { applied_count: previewRows.length },
    })
    await connection.commit()
    return { applied: previewRows.length, conflicts: [], committed: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listOccupancy(req) {
  const schoolId = getScopedSchoolId(req)
  const resourceType = cleanText(req.query.resource_type || req.query.resourceType).toUpperCase()
  const resourceId = idValue(req.query.resource_id || req.query.resourceId)
  const date = dateOnly(req.query.date)
  const versionId = idValue(req.query.timetable_version_id || req.query.timetableVersionId)
  const params = [schoolId]
  const rows = []

  const timetableFilters = ["tt.school_id = ?"]
  if (versionId) {
    timetableFilters.push("e.timetable_version_id = ?")
    params.push(versionId)
  }
  if (resourceType === "FACILITY" && resourceId) {
    timetableFilters.push("e.facility_id = ?")
    params.push(resourceId)
  }
  if (resourceType === "TEACHER" && resourceId) {
    timetableFilters.push("e.teacher_id = ?")
    params.push(resourceId)
  }
  if (resourceType === "CLASS" && resourceId) {
    timetableFilters.push("e.class_id = ?")
    params.push(resourceId)
  }
  if (date) {
    timetableFilters.push("(e.calendar_date = ? OR cd.weekday = DAYOFWEEK(?) - 1)")
    params.push(date, date)
  }
  const [timetableRows] = await pool.query(
    `SELECT e.id, e.title, e.entry_type, e.calendar_date, cd.weekday, cd.display_name AS cycle_day_name,
      ss.start_time, es.end_time, e.teacher_id, e.class_id, e.facility_id, e.room_id,
      tt.id AS timetable_id, tv.id AS version_id, tv.status AS version_status
     FROM timetable_entries e
     JOIN timetable_versions tv ON tv.id = e.timetable_version_id
     JOIN timetables tt ON tt.id = tv.timetable_id
     LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
     JOIN bell_schedule_slots ss ON ss.id = e.slot_start_id
     JOIN bell_schedule_slots es ON es.id = e.slot_end_id
     WHERE ${timetableFilters.join(" AND ")}
     ORDER BY COALESCE(e.calendar_date, '9999-12-31'), cd.sort_order, ss.start_time
     LIMIT 500`,
    params,
  )
  timetableRows.forEach((row) => rows.push({
    resourceType: row.facility_id ? "FACILITY" : row.teacher_id ? "TEACHER" : "TIMETABLE",
    resourceId: row.facility_id || row.teacher_id || row.class_id || null,
    date: row.calendar_date || date || null,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    occupancyType: row.entry_type,
    sourceEntityType: "timetable_entry",
    sourceEntityId: Number(row.id),
    title: row.title || row.entry_type,
    blocking: true,
    canOverride: row.version_status !== "PUBLISHED",
    overridePermission: "timetable.edit_manual",
    metadata: row,
  }))

  const activityParams = [schoolId]
  const activityFilters = ["wsa.school_id = ?", "wsa.active = 1"]
  if (resourceType === "FACILITY" && resourceId) {
    activityFilters.push("wsa.facility_id = ?")
    activityParams.push(resourceId)
  }
  if (resourceType === "TEACHER" && resourceId) {
    activityFilters.push("wsa.responsible_teacher_id = ?")
    activityParams.push(resourceId)
  }
  if (date) {
    activityFilters.push("(wsa.weekday IS NULL OR wsa.weekday = DAYOFWEEK(?) - 1)")
    activityParams.push(date)
  }
  const [activityRows] = await pool.query(
    `SELECT wsa.*, ss.start_time AS slot_start_time, es.end_time AS slot_end_time
     FROM weekly_school_activities wsa
     LEFT JOIN bell_schedule_slots ss ON ss.id = wsa.start_slot_id
     LEFT JOIN bell_schedule_slots es ON es.id = wsa.end_slot_id
     WHERE ${activityFilters.join(" AND ")}
     ORDER BY wsa.priority DESC, wsa.name
     LIMIT 300`,
    activityParams,
  )
  activityRows.forEach((row) => rows.push({
    resourceType: row.facility_id ? "FACILITY" : row.responsible_teacher_id ? "TEACHER" : "SCHOOL",
    resourceId: row.facility_id || row.responsible_teacher_id || schoolId,
    date: date || null,
    weekday: row.weekday,
    startTime: row.start_time || row.slot_start_time,
    endTime: row.end_time || row.slot_end_time,
    occupancyType: "WEEKLY_ACTIVITY",
    sourceEntityType: "weekly_school_activity",
    sourceEntityId: Number(row.id),
    title: row.name,
    blocking: Boolean(row.blocks_normal_lessons),
    canOverride: Boolean(row.allows_exam_override),
    overridePermission: row.allows_exam_override ? "exam_timetable.override_weekly_activity" : null,
    metadata: { exam_policy: row.exam_policy, scope_type: row.scope_type },
  }))

  if (date) {
    const [examRows] = await pool.query(
      `SELECT ete.*, a.name AS assessment_name, es.name AS exam_session_name
       FROM exam_timetable_entries ete
       JOIN assessments a ON a.id = ete.assessment_id AND a.school_id = ete.school_id
       JOIN exam_sessions es ON es.id = ete.exam_session_id AND es.school_id = ete.school_id
       WHERE ete.school_id = ? AND ete.exam_date = ?
        AND (? <> 'FACILITY' OR ete.facility_id = ?)
        AND (? <> 'TEACHER' OR ete.invigilator_teacher_id = ?)
        AND (? <> 'CLASS' OR ete.class_id = ?)
       ORDER BY ete.start_time`,
      [schoolId, date, resourceType, resourceId || 0, resourceType, resourceId || 0, resourceType, resourceId || 0],
    )
    examRows.forEach((row) => rows.push({
      resourceType: row.facility_id ? "FACILITY" : "EXAM",
      resourceId: row.facility_id || row.exam_session_id,
      date: row.exam_date,
      startTime: row.start_time,
      endTime: row.end_time,
      occupancyType: "EXAM_SESSION",
      sourceEntityType: "exam_timetable_entry",
      sourceEntityId: Number(row.id),
      title: row.assessment_name || row.exam_session_name,
      blocking: true,
      canOverride: false,
      overridePermission: null,
      metadata: row,
    }))
  }

  return { occupancy: rows }
}

export async function calculateExamAvailabilityWindows(req) {
  const schoolId = getScopedSchoolId(req)
  const examSessionId = idValue(req.query.exam_session_id || req.query.examSessionId || req.body.exam_session_id || req.body.examSessionId, "exam_session_id", true)
  const [[session]] = await pool.query("SELECT * FROM exam_sessions WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, examSessionId])
  if (!session) throw new HttpError(404, "Exam session was not found")
  const [slots] = await pool.query(
    `SELECT DISTINCT s.start_time, s.end_time, s.display_name, s.slot_type
     FROM bell_schedule_slots s
     JOIN bell_schedule_templates b ON b.id = s.template_id
     WHERE b.school_id = ? AND b.active = 1 AND s.teaching_allowed = 1
     ORDER BY s.start_time`,
    [schoolId],
  )
  const windows = slots.length ? [
    { name: "Morning", start_time: slots[0].start_time, end_time: slots[Math.min(2, slots.length - 1)].end_time, source: "bell_schedule" },
    { name: "Midday", start_time: slots[Math.min(3, slots.length - 1)].start_time, end_time: slots[Math.min(5, slots.length - 1)].end_time, source: "bell_schedule" },
    { name: "Afternoon", start_time: slots[Math.max(0, slots.length - 2)].start_time, end_time: slots[slots.length - 1].end_time, source: "bell_schedule" },
  ] : [
    { name: "Morning", start_time: "08:00:00", end_time: "10:00:00", source: "default" },
    { name: "Midday", start_time: "10:30:00", end_time: "12:30:00", source: "default" },
    { name: "Afternoon", start_time: "13:30:00", end_time: "15:30:00", source: "default" },
  ]
  const [closures] = await pool.query(
    `SELECT closure_date, title, blocks_exams
     FROM school_closure_dates
     WHERE school_id = ? AND closure_date BETWEEN ? AND ? AND active = 1 AND blocks_exams = 1`,
    [schoolId, session.start_date, session.end_date],
  )
  return { exam_session: session, windows, closures }
}

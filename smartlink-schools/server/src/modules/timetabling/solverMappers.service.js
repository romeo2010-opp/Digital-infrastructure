import { HttpError } from "../../utils/http.js"
import { parseJson } from "./timetabling.helpers.js"

function sid(value) {
  return value === null || value === undefined ? null : String(value)
}

function bool(value) {
  return value === true || value === 1 || value === "1"
}

function timeText(value) {
  return value ? String(value).slice(0, 8) : null
}

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value ? String(value).slice(0, 10) : null
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function roomLabelMatches(source, label) {
  const text = String(source || "").toLowerCase()
  const words = String(label || "").toLowerCase().match(/[a-z0-9]+/g) || []
  if (!text || !words.length) return false
  const pattern = words.map(escapeRegExp).join("[\\s._-]*")
  return new RegExp(`(^|\\b)${pattern}(\\b|\\s|$)`, "i").test(text)
}

function inferClassHomeFacilities(classes, facilities) {
  const homeByClass = new Map()
  const classrooms = facilities.filter((facility) => facility.active && facility.canHostNormalLessons && String(facility.facilityType || "").toUpperCase() === "CLASSROOM")
  classes.forEach((classRow) => {
    const labels = [classRow.name, classRow.gradeLevel].filter(Boolean)
    const matches = classrooms
      .map((facility) => {
        const facilityText = `${facility.name || ""} ${facility.facilityCode || ""}`
        const score = labels.reduce((best, label, index) => {
          if (!roomLabelMatches(facilityText, label)) return best
          const startsWithLabel = roomLabelMatches(String(facility.name || "").split(/\b(class|classroom|room)\b/i)[0], label)
          return Math.min(best, (startsWithLabel ? 0 : 10) + index)
        }, 99)
        return { facility, score }
      })
      .filter((item) => item.score < 99)
      .sort((left, right) => left.score - right.score || String(left.facility.name || "").length - String(right.facility.name || "").length)
    if (matches[0]?.facility?.id) homeByClass.set(String(classRow.id), String(matches[0].facility.id))
  })
  return homeByClass
}

function requirementNeedsSpecialistFacility(requirement) {
  const entryType = String(requirement.entryType || "").toUpperCase()
  return /PRACTICAL|LABORATORY|COMPUTER|EXAM/.test(entryType)
    || Boolean(requirement.requiredFacilityId || requirement.requiredFacilityType)
    || Boolean(requirement.equipmentIds?.length)
    || Boolean(requirement.preferredFacilityIds?.length)
}

function applyClassHomeRoomsToRequirements(requirements, classHomeFacilityIds) {
  return requirements.map((requirement) => {
    if (!requirement.classId || requirementNeedsSpecialistFacility(requirement)) return requirement
    const homeFacilityId = classHomeFacilityIds.get(String(requirement.classId))
    if (!homeFacilityId) return requirement
    return {
      ...requirement,
      requiredFacilityId: homeFacilityId,
      metadata: {
        ...(requirement.metadata || {}),
        homeFacilityId,
        homeFacilityPolicy: "CLASS_HOME_ROOM",
      },
    }
  })
}

function applyClassHomeRoomsToExamPapers(papers, classHomeFacilityIds, facilities) {
  const facilityById = new Map(facilities.map((facility) => [String(facility.id), facility]))
  return papers.map((paper) => {
    if (!paper.classId || paper.requiresLab || paper.requiresComputer || paper.requiresListening || paper.allowedFacilityIds?.length) return paper
    const homeFacilityId = classHomeFacilityIds.get(String(paper.classId))
    const homeFacility = homeFacilityId ? facilityById.get(String(homeFacilityId)) : null
    if (!homeFacility?.canHostExaminations) return paper
    return {
      ...paper,
      allowedFacilityIds: [homeFacilityId],
      metadata: {
        ...(paper.metadata || {}),
        homeFacilityId,
        homeFacilityPolicy: "CLASS_HOME_ROOM",
      },
    }
  })
}

function truthyMetadataFlag(metadata, keys) {
  return keys.some((key) => metadata?.[key] === true || metadata?.[key] === 1 || metadata?.[key] === "1")
}

function examDescriptor(row, metadata = {}) {
  return [
    row.name,
    row.subject_name,
    row.assessment_type,
    row.paper_type,
    row.exam_mode,
    metadata.examType,
    metadata.paperType,
    metadata.mode,
    metadata.facilityType,
  ].filter(Boolean).join(" ")
}

function paperRequiresLab(row) {
  const metadata = parseJson(row.metadata, {}) || {}
  if (truthyMetadataFlag(metadata, ["requiresLab", "requires_lab", "requiresPracticalFacility", "requires_practical_facility"])) return true
  return /practical|laboratory|\blab\b|experiment|specimen/i.test(examDescriptor(row, metadata))
}

function paperRequiresComputer(row) {
  const metadata = parseJson(row.metadata, {}) || {}
  if (truthyMetadataFlag(metadata, ["requiresComputer", "requires_computer", "computerBased", "computer_based"])) return true
  return /computer[- ]based|\bcbt\b|computer practical|ict practical|coding practical/i.test(examDescriptor(row, metadata))
}

function jsonArray(value) {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed.map((item) => sid(item)).filter(Boolean) : []
}

function curriculumSourceId(requirementId) {
  const text = String(requirementId || "")
  if (!text.startsWith("curriculum:")) return null
  const parsed = Number(text.slice("curriculum:".length))
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null
}

function sameOptionalValue(left, right) {
  if (!left || !right) return true
  return String(left) === String(right)
}

function lessonEntryCompatible(requirementEntryType, entryType) {
  const required = String(requirementEntryType || "LESSON").toUpperCase()
  const actual = String(entryType || "LESSON").toUpperCase()
  if (required === actual) return true
  if (required.includes("LESSON") && actual.includes("LESSON")) return true
  return required === "SUBJECT_LESSON" && actual === "LESSON"
}

function fixedEntryMatchesRequirement(entry, requirement) {
  const sourceId = curriculumSourceId(requirement.id)
  if (sourceId && entry.requirementId && String(entry.requirementId) === sourceId) return true
  if (!lessonEntryCompatible(requirement.entryType, entry.entryType)) return false
  if (requirement.classId && String(entry.classId || "") !== String(requirement.classId)) return false
  if (requirement.subjectId && String(entry.subjectId || "") !== String(requirement.subjectId)) return false
  if (!sameOptionalValue(requirement.streamId, entry.streamId)) return false
  if (requirement.teacherId && entry.teacherId && String(entry.teacherId) !== String(requirement.teacherId)) return false
  return Boolean(entry.classId || entry.subjectId || entry.teacherId)
}

function withLockedAssignments(requirements, fixedEntries) {
  const lockedEntries = (fixedEntries || []).filter((entry) => entry.locked || entry.manuallyModified)
  return requirements.map((requirement) => ({
    ...requirement,
    lockedAssignments: lockedEntries
      .filter((entry) => fixedEntryMatchesRequirement(entry, requirement))
      .sort((a, b) => {
        const weekA = Number(a.cycleWeek || 1)
        const weekB = Number(b.cycleWeek || 1)
        if (weekA !== weekB) return weekA - weekB
        const dayA = Number(a.cycleDayId || 0)
        const dayB = Number(b.cycleDayId || 0)
        if (dayA !== dayB) return dayA - dayB
        return Number(a.slotStartId || 0) - Number(b.slotStartId || 0)
      })
      .slice(0, Math.max(0, Number(requirement.periodsPerCycle || 0))),
  }))
}

function slotIsAvailableOnDay(slot, cycleDayId) {
  if (!slot) return false
  const dayIds = Array.isArray(slot.cycleDayIds) ? slot.cycleDayIds.map((value) => String(value)) : []
  return !dayIds.length || dayIds.includes(String(cycleDayId))
}

function entryFitsBellContext(entry, bellContext) {
  if (!entry?.cycleDayId || !entry?.slotStartId) return false
  const slotsById = new Map((bellContext?.bellScheduleSlots || []).map((slot) => [String(slot.id), slot]))
  const startSlot = slotsById.get(String(entry.slotStartId))
  const endSlot = slotsById.get(String(entry.slotEndId || entry.slotStartId))
  return slotIsAvailableOnDay(startSlot, entry.cycleDayId) && slotIsAvailableOnDay(endSlot, entry.cycleDayId)
}

function filterFixedEntriesForBellContext(fixedEntries, bellContext) {
  return (fixedEntries || []).filter((entry) => entryFitsBellContext(entry, bellContext))
}

function weekdayFromDate(value) {
  const date = new Date(`${dateText(value)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

function dateRange(start, end) {
  const dates = []
  const current = new Date(`${dateText(start)}T00:00:00Z`)
  const last = new Date(`${dateText(end)}T00:00:00Z`)
  while (!Number.isNaN(current.getTime()) && !Number.isNaN(last.getTime()) && current <= last) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function timetableCycleWeeks(timetable) {
  const parsed = Number(timetable?.timetable_cycle_weeks || timetable?.timetableCycleWeeks || 1)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function cycleWeekForDate(timetable, value) {
  const cycleWeeks = timetableCycleWeeks(timetable)
  const start = new Date(`${dateText(timetable?.effective_from)}T00:00:00Z`)
  const current = new Date(`${dateText(value)}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime()) || current < start) return 1
  const weekIndex = Math.floor((current.getTime() - start.getTime()) / (7 * 86400000))
  return (weekIndex % cycleWeeks) + 1
}

function cycleWeekRows(count) {
  return Array.from({ length: Math.max(1, Number(count || 1)) }, (_, index) => ({
    weekNumber: index + 1,
    name: `Week ${index + 1}`,
  }))
}

function slotEndAfter(slot, cutoff) {
  if (!slot?.endTime || !cutoff) return false
  return String(slot.endTime).slice(0, 8) > String(cutoff).slice(0, 8)
}

async function loadFacilities(connection, schoolId) {
  const [facilities] = await connection.query(
    `SELECT *
     FROM school_facilities
     WHERE school_id = ? AND active = 1
     ORDER BY facility_type, name`,
    [schoolId],
  )
  const [equipmentRows] = await connection.query(
    `SELECT facility_id, equipment_id
     FROM facility_equipment_assignments
     WHERE facility_id IN (SELECT id FROM school_facilities WHERE school_id = ?)`,
    [schoolId],
  )
  const [subjectRows] = await connection.query(
    `SELECT facility_id, subject_id
     FROM facility_subject_eligibility
     WHERE school_id = ? AND active = 1`,
    [schoolId],
  )
  const equipmentByFacility = new Map()
  const subjectsByFacility = new Map()
  equipmentRows.forEach((row) => {
    const key = Number(row.facility_id)
    equipmentByFacility.set(key, [...(equipmentByFacility.get(key) || []), sid(row.equipment_id)])
  })
  subjectRows.forEach((row) => {
    const key = Number(row.facility_id)
    subjectsByFacility.set(key, [...(subjectsByFacility.get(key) || []), sid(row.subject_id)])
  })
  return facilities.map((row) => ({
    id: sid(row.id),
    facilityCode: row.facility_code,
    name: row.name,
    facilityType: row.facility_type,
    normalCapacity: row.normal_capacity === null ? null : Number(row.normal_capacity),
    examinationCapacity: row.examination_capacity === null ? null : Number(row.examination_capacity),
    workstationCount: row.workstation_count === null ? null : Number(row.workstation_count),
    functionalComputerCount: row.functional_computer_count === null ? null : Number(row.functional_computer_count),
    accessible: bool(row.is_accessible),
    active: bool(row.active),
    canHostNormalLessons: bool(row.can_host_normal_lessons),
    canHostExaminations: bool(row.can_host_examinations),
    canHostPracticalExaminations: bool(row.can_host_practical_examinations),
    canHostComputerExaminations: bool(row.can_host_computer_examinations),
    canHostListeningExaminations: bool(row.can_host_listening_examinations),
    canHostMultipleGroups: bool(row.can_host_multiple_groups),
    equipmentIds: equipmentByFacility.get(Number(row.id)) || [],
    supportedSubjectIds: subjectsByFacility.get(Number(row.id)) || [],
  }))
}

async function loadClasses(connection, schoolId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT c.*, COUNT(se.id) AS active_students
     FROM classes c
     LEFT JOIN student_enrollments se ON se.school_id = c.school_id AND se.class_id = c.id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     WHERE c.school_id = ?
     GROUP BY c.id
     ORDER BY c.name`,
    [academicYearId, termId, schoolId],
  )
  return rows.map((row) => ({
    id: sid(row.id),
    name: row.name,
    gradeLevel: row.grade_level,
    size: Number(row.active_students || 0),
    teacherId: sid(row.teacher_user_id),
    active: true,
  }))
}

async function loadBellContext(connection, schoolId, timetableId) {
  const [[cycleDays], [dayTemplateRows]] = await Promise.all([
    connection.query("SELECT * FROM timetable_cycle_days WHERE timetable_id = ? AND active = 1 ORDER BY sort_order, cycle_day_number", [timetableId]),
    connection.query(
      `SELECT dt.cycle_day_id, dt.bell_template_id, b.name AS bell_template_name
       FROM timetable_day_templates dt
       JOIN bell_schedule_templates b ON b.id = dt.bell_template_id
       WHERE dt.timetable_id = ? AND dt.active = 1 AND b.school_id = ? AND b.active = 1
        AND (b.timetable_id = ? OR b.timetable_id IS NULL)
       ORDER BY dt.cycle_day_id`,
      [timetableId, schoolId, timetableId],
    ),
  ])
  const assignedTemplateIds = [...new Set(dayTemplateRows.map((row) => Number(row.bell_template_id)).filter((value) => Number.isFinite(value) && value > 0))]
  const [fallbackTemplates] = assignedTemplateIds.length
    ? [[]]
    : await connection.query(
      `SELECT b.*
       FROM bell_schedule_templates b
       WHERE b.school_id = ? AND b.active = 1 AND (b.timetable_id = ? OR b.timetable_id IS NULL)
       ORDER BY CASE WHEN b.timetable_id = ? THEN 0 ELSE 1 END, b.is_default DESC, b.updated_at DESC, b.id DESC
       LIMIT 1`,
      [schoolId, timetableId, timetableId],
    )
  const selectedTemplateIds = assignedTemplateIds.length
    ? assignedTemplateIds
    : fallbackTemplates.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0)
  const [slots] = selectedTemplateIds.length
    ? await connection.query(
      `SELECT s.*
       FROM bell_schedule_slots s
       WHERE s.template_id IN (${selectedTemplateIds.map(() => "?").join(", ")})
       ORDER BY s.template_id, s.sort_order, s.slot_number`,
      selectedTemplateIds,
    )
    : [[]]
  const allCycleDayIds = cycleDays.map((row) => sid(row.id)).filter(Boolean)
  const dayIdsByTemplate = new Map()
  if (assignedTemplateIds.length) {
    dayTemplateRows.forEach((row) => {
      const key = Number(row.bell_template_id)
      dayIdsByTemplate.set(key, [...(dayIdsByTemplate.get(key) || []), sid(row.cycle_day_id)].filter(Boolean))
    })
  } else {
    selectedTemplateIds.forEach((templateId) => dayIdsByTemplate.set(templateId, allCycleDayIds))
  }
  return {
    cycleDays: cycleDays.map((row) => ({
      id: sid(row.id),
      code: row.code,
      name: row.display_name,
      weekday: row.weekday === null ? null : Number(row.weekday),
      sortOrder: Number(row.sort_order || row.cycle_day_number || 0),
      active: bool(row.active),
    })),
    bellScheduleSlots: slots.map((row) => ({
      id: sid(row.id),
      templateId: sid(row.template_id),
      code: row.code,
      name: row.display_name,
      startTime: timeText(row.start_time),
      endTime: timeText(row.end_time),
      slotNumber: Number(row.slot_number || 0),
      sortOrder: Number(row.sort_order || row.slot_number || 0),
      slotType: row.slot_type,
      teachingAllowed: bool(row.teaching_allowed),
      canSpan: bool(row.can_span),
      cycleDayIds: dayIdsByTemplate.get(Number(row.template_id)) || allCycleDayIds,
    })),
    rawSlots: slots,
    selectedTemplateId: sid(selectedTemplateIds[0]),
    selectedTemplateIds: selectedTemplateIds.map((value) => sid(value)).filter(Boolean),
  }
}

async function loadBellSlotTags(connection, schoolId, templateIds) {
  const ids = templateIds.map(Number).filter((value) => Number.isFinite(value) && value > 0)
  if (!ids.length) return []
  const [rows] = await connection.query(
    `SELECT bst.bell_schedule_slot_id, bst.tag_code, bst.tag_name, bst.priority
     FROM bell_schedule_slot_tags bst
     JOIN bell_schedule_slots s ON s.id = bst.bell_schedule_slot_id
     JOIN bell_schedule_templates b ON b.id = s.template_id AND b.school_id = bst.school_id
     WHERE bst.school_id = ? AND b.id IN (${ids.map(() => "?").join(", ")}) AND bst.active = 1
     ORDER BY s.template_id, s.sort_order, bst.priority, bst.tag_code`,
    [schoolId, ...ids],
  )
  const tagsBySlot = new Map()
  rows.forEach((row) => {
    const key = sid(row.bell_schedule_slot_id)
    tagsBySlot.set(key, [...(tagsBySlot.get(key) || []), {
      tagCode: row.tag_code,
      tagName: row.tag_name,
      priority: Number(row.priority || 0),
    }])
  })
  return [...tagsBySlot.entries()].map(([slotId, tags]) => ({
    slotId,
    tagCodes: tags.map((tag) => tag.tagCode),
    tags,
  }))
}

async function loadLessonSuspensionOccupancy(connection, schoolId, timetable, bellContext) {
  const [rows] = await connection.query(
    `SELECT *
     FROM school_closure_dates
     WHERE school_id = ? AND active = 1 AND blocks_lessons = 1
      AND closure_date BETWEEN ? AND ?
      AND (academic_year_id IS NULL OR academic_year_id = ?)
      AND (term_id IS NULL OR term_id = ?)`,
    [schoolId, dateText(timetable.effective_from), dateText(timetable.effective_to), timetable.academic_year_id, timetable.term_id],
  )
  const dayByWeekday = new Map((bellContext.cycleDays || []).filter((day) => day.weekday).map((day) => [Number(day.weekday), day]))
  const slotsForDay = (dayId) => (bellContext.bellScheduleSlots || [])
    .filter((slot) => slot.teachingAllowed && (!slot.cycleDayIds?.length || slot.cycleDayIds.includes(String(dayId))))
    .sort((left, right) => Number(left.sortOrder || left.slotNumber || 0) - Number(right.sortOrder || right.slotNumber || 0))
  const occupancy = []
  rows.forEach((row) => {
    const impact = String(row.class_impact || (row.blocks_lessons ? "ALL_CLASSES_SUSPENDED" : "NO_CLASSES_SUSPENDED")).toUpperCase()
    if (impact === "NO_CLASSES_SUSPENDED") return
    const day = dayByWeekday.get(Number(weekdayFromDate(row.closure_date)))
    if (!day?.id) return
    const daySlots = slotsForDay(day.id)
    if (!daySlots.length) return
    const blockedSlots = impact === "HALF_DAY"
      ? daySlots.filter((slot) => slotEndAfter(slot, row.half_day_closing_time || "12:00:00"))
      : daySlots
    if (!blockedSlots.length) return
    occupancy.push({
      resourceType: "SCHOOL",
      resourceId: sid(schoolId),
      date: dateText(row.closure_date),
      cycleWeek: cycleWeekForDate(timetable, row.closure_date),
      cycleDayId: day.id,
      startSlotId: blockedSlots[0].id,
      endSlotId: blockedSlots[blockedSlots.length - 1].id,
      occupancyType: impact,
      sourceEntityType: "school_closure_date",
      sourceEntityId: sid(row.id),
      title: row.title || (impact === "HALF_DAY" ? "Half-day holiday" : "Holiday"),
      blocking: true,
      canOverride: false,
      priority: 100,
      metadata: {
        classImpact: impact,
        halfDayClosingTime: row.half_day_closing_time || null,
      },
    })
  })
  return occupancy
}

async function loadSubjectFocusSettings(connection, schoolId, academicYearId, termId) {
  const [[categories], [assignments], [rules]] = await Promise.all([
    connection.query(
      `SELECT *
       FROM subject_focus_categories
       WHERE school_id = ? AND active = 1
       ORDER BY default_priority DESC, name`,
      [schoolId],
    ),
    connection.query(
      `SELECT sfa.*
       FROM subject_focus_assignments sfa
       WHERE sfa.school_id = ? AND sfa.active = 1
        AND (sfa.academic_year_id IS NULL OR sfa.academic_year_id = ?)
        AND (sfa.term_id IS NULL OR sfa.term_id = ?)
       ORDER BY sfa.id`,
      [schoolId, academicYearId, termId],
    ),
    connection.query(
      `SELECT sfr.*
       FROM subject_focus_rules sfr
       WHERE sfr.school_id = ? AND sfr.active = 1
        AND (sfr.academic_year_id IS NULL OR sfr.academic_year_id = ?)
        AND (sfr.term_id IS NULL OR sfr.term_id = ?)
       ORDER BY FIELD(sfr.severity, 'HARD', 'SOFT'), sfr.penalty_weight DESC, sfr.id`,
      [schoolId, academicYearId, termId],
    ),
  ])
  return {
    subjectFocusCategories: categories.map((row) => ({
      id: sid(row.id),
      code: row.code,
      name: row.name,
      defaultPriority: Number(row.default_priority || 0),
    })),
    subjectFocusAssignments: assignments.map((row) => ({
      id: sid(row.id),
      subjectId: sid(row.subject_id),
      focusCategoryId: sid(row.focus_category_id),
      academicYearId: sid(row.academic_year_id),
      termId: sid(row.term_id),
      gradeLevel: row.grade_level || null,
      classId: sid(row.class_id),
      streamId: row.stream_section || null,
    })),
    subjectFocusRules: rules.map((row) => ({
      id: sid(row.id),
      name: row.name,
      focusCategoryId: sid(row.focus_category_id),
      subjectId: sid(row.subject_id),
      academicYearId: sid(row.academic_year_id),
      termId: sid(row.term_id),
      scopeType: row.scope_type,
      scopeReferenceId: sid(row.scope_reference_id),
      scopeValue: row.scope_value || null,
      classId: sid(row.class_id),
      streamId: row.stream_section || null,
      gradeLevel: row.grade_level || null,
      preferredSlotTags: jsonArray(row.preferred_slot_tags),
      avoidedSlotTags: jsonArray(row.avoided_slot_tags),
      preferredSlotIds: jsonArray(row.preferred_slot_ids),
      avoidedSlotIds: jsonArray(row.avoided_slot_ids),
      severity: row.severity,
      penaltyWeight: Number(row.penalty_weight || 0),
      maxAfterLunchPerCycle: row.max_after_lunch_per_cycle === null ? null : Number(row.max_after_lunch_per_cycle),
      maxLastPeriodPerCycle: row.max_last_period_per_cycle === null ? null : Number(row.max_last_period_per_cycle),
      minimumPreferredPerCycle: row.minimum_preferred_per_cycle === null ? null : Number(row.minimum_preferred_per_cycle),
      allowOverride: bool(row.allow_override),
    })),
  }
}

async function loadStreamSchedulingRules(connection, schoolId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM stream_scheduling_rules
     WHERE school_id = ? AND active = 1
      AND (academic_year_id IS NULL OR academic_year_id = ?)
      AND (term_id IS NULL OR term_id = ?)
     ORDER BY FIELD(severity, 'HARD', 'SOFT'), penalty_weight DESC, id`,
    [schoolId, academicYearId, termId],
  )
  return rows.map((row) => ({
    id: sid(row.id),
    name: row.name,
    academicYearId: sid(row.academic_year_id),
    termId: sid(row.term_id),
    scopeType: row.scope_type,
    scopeReferenceId: sid(row.scope_reference_id),
    scopeValue: row.scope_value || null,
    gradeLevel: row.grade_level || null,
    classId: sid(row.class_id),
    streamId: row.stream_section || null,
    subjectId: sid(row.subject_id),
    policy: row.policy,
    severity: row.severity,
    penaltyWeight: Number(row.penalty_weight || 0),
    maxParallelCount: row.max_parallel_count === null ? null : Number(row.max_parallel_count),
    requireDifferentTeachers: bool(row.require_different_teachers),
    requireDifferentRooms: bool(row.require_different_rooms),
    allowOverride: bool(row.allow_override),
  }))
}

async function loadWeeklyActivities(connection, schoolId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT wsa.*
     FROM weekly_school_activities wsa
     WHERE wsa.school_id = ? AND wsa.academic_year_id = ? AND (wsa.term_id IS NULL OR wsa.term_id = ?) AND wsa.active = 1
     ORDER BY wsa.priority DESC, wsa.name`,
    [schoolId, academicYearId, termId],
  )
  const activityIds = rows.map((row) => Number(row.id)).filter(Boolean)
  const [scopeRows] = activityIds.length
    ? await connection.query(
      `SELECT activity_id, scope_type, scope_reference_id, scope_value
       FROM weekly_school_activity_scope_assignments
       WHERE activity_id IN (${activityIds.map(() => "?").join(", ")})
       ORDER BY activity_id, id`,
      activityIds,
    )
    : [[]]
  const scopesByActivity = new Map()
  scopeRows.forEach((row) => {
    const key = Number(row.activity_id)
    scopesByActivity.set(key, [...(scopesByActivity.get(key) || []), row])
  })
  return rows.map((row) => {
    const scopes = scopesByActivity.get(Number(row.id)) || []
    return {
      id: sid(row.id),
      name: row.name,
      activityType: row.activity_type,
      cycleDayId: sid(row.cycle_day_id),
      weekday: row.weekday === null ? null : Number(row.weekday),
      startSlotId: sid(row.start_slot_id),
      endSlotId: sid(row.end_slot_id || row.start_slot_id),
      scopeType: row.scope_type,
      classIds: scopes.filter((item) => item.scope_type === "SELECTED_CLASSES").map((item) => sid(item.scope_reference_id)).filter(Boolean),
      studentGroupIds: scopes.filter((item) => item.scope_type === "SELECTED_STUDENT_GROUPS").map((item) => sid(item.scope_reference_id)).filter(Boolean),
      teacherId: sid(row.responsible_teacher_id),
      facilityId: sid(row.facility_id),
      blocksNormalLessons: bool(row.blocks_normal_lessons),
      allowsExamOverride: bool(row.allows_exam_override),
      examPolicy: row.exam_policy,
      active: bool(row.active),
    }
  })
}

async function loadTeacherAvailability(connection, schoolId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM teacher_availability_rules
     WHERE school_id = ? AND academic_year_id = ? AND (term_id IS NULL OR term_id = ?) AND approved_status = 'APPROVED'`,
    [schoolId, academicYearId, termId],
  )
  return rows.map((row) => ({
    resourceType: "TEACHER",
    resourceId: sid(row.teacher_id),
    cycleDayId: sid(row.cycle_day_id),
    weekday: row.weekday === null ? null : Number(row.weekday),
    startSlotId: sid(row.slot_start_id),
    endSlotId: sid(row.slot_end_id || row.slot_start_id),
    status: row.availability_status,
    reason: row.reason,
  }))
}

async function loadFacilityAvailability(connection, schoolId, academicYearId, termId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM facility_availability_rules
     WHERE school_id = ? AND (academic_year_id IS NULL OR academic_year_id = ?) AND (term_id IS NULL OR term_id = ?) AND approved_status = 'APPROVED'`,
    [schoolId, academicYearId, termId],
  )
  return rows.map((row) => ({
    resourceType: "FACILITY",
    resourceId: sid(row.facility_id),
    cycleDayId: sid(row.cycle_day_id),
    weekday: row.weekday === null ? null : Number(row.weekday),
    startSlotId: sid(row.slot_start_id),
    endSlotId: sid(row.slot_end_id || row.slot_start_id),
    status: row.availability_status,
    reason: row.reason,
  }))
}

async function loadFixedEntries(connection, versionId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM timetable_entries
     WHERE timetable_version_id = ? AND (locked = 1 OR manually_modified = 1)
     ORDER BY id`,
    [versionId],
  )
  return rows.map((row) => ({
    requirementId: sid(row.source_requirement_id),
    entryType: row.entry_type,
    subjectId: sid(row.subject_id),
    classId: sid(row.class_id),
    streamId: row.stream_section || null,
    studentGroupIds: row.student_group_id ? [sid(row.student_group_id)] : [],
    teacherId: sid(row.teacher_id),
    assistantTeacherId: sid(row.assistant_teacher_id),
    facilityId: sid(row.facility_id),
    equipmentIds: jsonArray(row.required_equipment_json),
    cycleWeek: Number(row.cycle_week || 1),
    cycleDayId: sid(row.cycle_day_id),
    slotStartId: sid(row.slot_start_id),
    slotEndId: sid(row.slot_end_id || row.slot_start_id),
    locked: bool(row.locked),
    manuallyModified: bool(row.manually_modified),
    sourceWeeklyActivityId: sid(row.source_weekly_activity_id),
    notes: row.title,
  }))
}

async function loadCurriculumRequirements(connection, schoolId, timetable) {
  const [rows] = await connection.query(
    `SELECT *
     FROM curriculum_period_requirements
     WHERE school_id = ? AND academic_year_id = ? AND (term_id IS NULL OR term_id = ?)
      AND (timetable_id IS NULL OR timetable_id = ?) AND active = 1
     ORDER BY priority DESC, class_id, subject_id, id`,
    [schoolId, timetable.academic_year_id, timetable.term_id, timetable.id],
  )
  if (!rows.length) {
    throw new HttpError(409, "Add curriculum period requirements before automatic timetable generation.")
  }
  const [teacherAssignments] = await connection.query(
    `SELECT teacher_id, class_id, subject_id, stream_section
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND is_active = 1
      AND academic_year_id = ?
      AND term_id = ?`,
    [schoolId, timetable.academic_year_id, timetable.term_id],
  )
  const eligibleTeachersFor = (row) => {
    if (row.teacher_id) return []
    return teacherAssignments
      .filter((assignment) => {
        if (row.class_id && Number(assignment.class_id) !== Number(row.class_id)) return false
        if (row.subject_id && assignment.subject_id && Number(assignment.subject_id) !== Number(row.subject_id)) return false
        if (row.stream_section && assignment.stream_section && String(assignment.stream_section) !== String(row.stream_section)) return false
        return true
      })
      .map((assignment) => sid(assignment.teacher_id))
      .filter(Boolean)
  }
  return rows.map((row) => ({
    id: `curriculum:${row.id}`,
    entryType: row.entry_type,
    subjectId: sid(row.subject_id),
    classId: sid(row.class_id),
    streamId: row.stream_section || null,
    studentGroupIds: row.student_group_id ? [sid(row.student_group_id)] : [],
    teacherId: sid(row.teacher_id),
    eligibleTeacherIds: [...new Set(eligibleTeachersFor(row))],
    assistantTeacherId: sid(row.assistant_teacher_id),
    requiredFacilityId: sid(row.required_facility_id),
    preferredFacilityIds: jsonArray(row.preferred_facility_ids),
    requiredFacilityType: row.required_facility_type || null,
    equipmentIds: jsonArray(row.required_equipment_json),
    periodsPerCycle: Number(row.periods_per_cycle || 1),
    blockLength: Number(row.block_length || 1),
    priority: Number(row.priority || 50),
    allowedCycleDayIds: jsonArray(row.allowed_cycle_day_ids),
    preferredCycleDayIds: jsonArray(row.preferred_cycle_day_ids),
    avoidedCycleDayIds: jsonArray(row.avoided_cycle_day_ids),
    allowedSlotIds: jsonArray(row.allowed_slot_ids),
    preferredSlotIds: jsonArray(row.preferred_slot_ids),
    avoidedSlotIds: jsonArray(row.avoided_slot_ids),
    requiredCapacity: row.required_capacity === null ? null : Number(row.required_capacity),
    metadata: { ...(parseJson(row.metadata, {}) || {}), curriculumRequirementId: Number(row.id) },
  }))
}

async function loadEquipment(connection, schoolId) {
  const [rows] = await connection.query(
    "SELECT id, name, usable_quantity, active FROM facility_equipment WHERE school_id = ? AND active = 1 ORDER BY category, name",
    [schoolId],
  )
  return rows.map((row) => ({
    id: sid(row.id),
    name: row.name,
    usableQuantity: Number(row.usable_quantity || 0),
    active: bool(row.active),
  }))
}

async function loadTeachers(connection, schoolId) {
  const [rows] = await connection.query(
    "SELECT id, full_name, is_active FROM users WHERE school_id = ? AND role IN ('teacher', 'headteacher', 'school_owner') AND is_active = 1 ORDER BY full_name",
    [schoolId],
  )
  return rows.map((row) => ({
    id: sid(row.id),
    name: row.full_name,
    active: bool(row.is_active),
  }))
}

async function loadSubjects(connection, schoolId) {
  const [rows] = await connection.query("SELECT id, name, code FROM subjects WHERE school_id = ? ORDER BY name", [schoolId])
  return rows.map((row) => ({ id: sid(row.id), name: row.name, code: row.code }))
}

export async function buildSchoolTimetableSolverPayload(connection, schoolId, timetable, version, options = {}) {
  const bellContext = await loadBellContext(connection, schoolId, timetable.id)
  const includeExistingEntries = options.includeExistingEntries !== false
  const cycleWeekCount = timetableCycleWeeks(timetable)
  const [teachers, classes, subjects, facilities, equipment, weeklyActivities, rawFixedEntries, teacherAvailability, facilityAvailability, rawCurriculumRequirements, bellScheduleSlotTags, focusSettings, streamSchedulingRules, lessonSuspensions] = await Promise.all([
    loadTeachers(connection, schoolId),
    loadClasses(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadSubjects(connection, schoolId),
    loadFacilities(connection, schoolId),
    loadEquipment(connection, schoolId),
    loadWeeklyActivities(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadFixedEntries(connection, version.id),
    loadTeacherAvailability(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadFacilityAvailability(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadCurriculumRequirements(connection, schoolId, timetable),
    loadBellSlotTags(connection, schoolId, bellContext.selectedTemplateIds),
    loadSubjectFocusSettings(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadStreamSchedulingRules(connection, schoolId, timetable.academic_year_id, timetable.term_id),
    loadLessonSuspensionOccupancy(connection, schoolId, timetable, bellContext),
  ])
  const fixedEntries = includeExistingEntries ? filterFixedEntriesForBellContext(rawFixedEntries, bellContext) : []
  const classHomeFacilityIds = inferClassHomeFacilities(classes, facilities)
  const curriculumRequirements = withLockedAssignments(applyClassHomeRoomsToRequirements(rawCurriculumRequirements, classHomeFacilityIds), fixedEntries)
  return {
    schoolId: sid(schoolId),
    academicYearId: sid(timetable.academic_year_id),
    termId: sid(timetable.term_id),
    timetableVersionId: sid(version.id),
    timetableCycleWeeks: cycleWeekCount,
    cycleWeeks: cycleWeekRows(cycleWeekCount),
    cycleDays: bellContext.cycleDays,
    bellScheduleSlots: bellContext.bellScheduleSlots,
    bellScheduleSlotTags,
    teachers,
    classes,
    streams: [],
    studentGroups: [],
    subjects,
    facilities,
    laboratories: facilities.filter((facility) => String(facility.facilityType).includes("LABORATORY")),
    equipment,
    weeklyActivities,
    fixedEntries,
    lockedEntries: fixedEntries.filter((entry) => entry.locked),
    curriculumRequirements,
    subjectFocusCategories: focusSettings.subjectFocusCategories,
    subjectFocusAssignments: focusSettings.subjectFocusAssignments,
    subjectFocusRules: focusSettings.subjectFocusRules,
    streamSchedulingRules,
    teacherAvailability,
    facilityAvailability,
    existingOccupancy: lessonSuspensions,
    hardConstraints: [],
    softConstraints: [],
    strategy: String(options.strategy || "BALANCED").toUpperCase(),
    allowPartialTimetable: options.allowPartialTimetable === undefined ? true : bool(options.allowPartialTimetable),
    maxAlternatives: Number(process.env.TIMETABLE_SOLVER_MAX_ALTERNATIVES || options.maxAlternatives || 1),
    timeLimitSeconds: Number(process.env.TIMETABLE_SOLVER_DEFAULT_TIME_LIMIT_SECONDS || options.timeLimitSeconds || 20),
  }
}

async function loadExamSession(connection, schoolId, examSeriesId) {
  const [[session]] = await connection.query(
    "SELECT * FROM exam_sessions WHERE school_id = ? AND id = ? LIMIT 1",
    [schoolId, examSeriesId],
  )
  if (!session) throw new HttpError(404, "Exam session was not found")
  return session
}

async function loadExamWindows(connection, schoolId, timetableId, session, options = {}) {
  const [[templateRows], [slotRows]] = await Promise.all([
    connection.query(
      "SELECT * FROM exam_session_templates WHERE school_id = ? AND (exam_session_id IS NULL OR exam_session_id = ?) AND active = 1 ORDER BY session_date, start_time",
      [schoolId, session.id],
    ),
    connection.query(
      `SELECT s.*
       FROM bell_schedule_slots s
       JOIN bell_schedule_templates b ON b.id = s.template_id
       WHERE b.school_id = ? AND b.timetable_id = ? AND b.active = 1
       ORDER BY s.sort_order, s.slot_number`,
      [schoolId, timetableId],
    ),
  ])
  const range = options.dateRange || { startDate: dateText(session.start_date), endDate: dateText(session.end_date) }
  if (templateRows.length) {
    return templateRows
      .filter((row) => !row.session_date || (dateText(row.session_date) >= range.startDate && dateText(row.session_date) <= range.endDate))
      .map((row) => {
        const matchingSlot = slotRows.find((slot) => timeText(slot.start_time) === timeText(row.start_time) && timeText(slot.end_time) === timeText(row.end_time)) || slotRows[0]
        return {
          id: `template:${row.id}`,
          date: dateText(row.session_date || range.startDate),
          startTime: timeText(row.start_time),
          endTime: timeText(row.end_time),
          name: row.name,
          slotStartId: sid(matchingSlot?.id),
          slotEndId: sid(matchingSlot?.id),
        }
      })
  }
  const slots = slotRows.length ? slotRows : [
    { id: "am", code: "AM", display_name: "Morning session", start_time: "08:00:00", end_time: "10:00:00" },
    { id: "pm", code: "PM", display_name: "Afternoon session", start_time: "13:30:00", end_time: "15:30:00" },
  ]
  return dateRange(range.startDate, range.endDate)
    .filter((date) => weekdayFromDate(date) <= 5)
    .flatMap((date) => slots.map((slot) => ({
      id: `${date}:${slot.id}`,
      date,
      startTime: timeText(slot.start_time),
      endTime: timeText(slot.end_time),
      name: slot.display_name || slot.code,
      slotStartId: sid(slot.id),
      slotEndId: sid(slot.id),
    })))
}

async function loadExamPapers(connection, schoolId, session, scopeType, scopeReferenceIds) {
  const refs = scopeReferenceIds.map(Number).filter((value) => Number.isFinite(value) && value > 0)
  const filters = ["a.school_id = ?", "a.exam_session_id = ?"]
  const params = [schoolId, session.id]
  if (scopeType === "CLASS" && refs.length) {
    filters.push(`a.class_id IN (${refs.map(() => "?").join(", ")})`)
    params.push(...refs)
  }
  if (scopeType === "SUBJECT" && refs.length) {
    filters.push(`a.subject_id IN (${refs.map(() => "?").join(", ")})`)
    params.push(...refs)
  }
  const [rows] = await connection.query(
    `SELECT a.*, c.grade_level, c.name AS class_name, subj.name AS subject_name
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     WHERE ${filters.join(" AND ")} AND a.status <> 'archived'
     ORDER BY c.name, subj.name`,
    params,
  )
  if (!rows.length) throw new HttpError(409, "No assessments/papers were found for the selected exam scope.")
  const classIds = [...new Set(rows.map((row) => Number(row.class_id)))]
  const [enrollments] = await connection.query(
    `SELECT student_id, class_id
     FROM student_enrollments
     WHERE school_id = ? AND academic_year_id = ? AND term_id = ? AND enrollment_status = 'active'
      AND class_id IN (${classIds.map(() => "?").join(", ")})`,
    [schoolId, session.academic_year_id, session.term_id, ...classIds],
  )
  const candidatesByClass = new Map()
  enrollments.forEach((row) => {
    const key = Number(row.class_id)
    candidatesByClass.set(key, [...(candidatesByClass.get(key) || []), sid(row.student_id)])
  })
  return rows.map((row) => ({
    id: `assessment:${row.id}`,
    name: row.name,
    subjectId: sid(row.subject_id),
    classId: sid(row.class_id),
    gradeLevel: row.grade_level || null,
    streamId: row.stream_section || null,
    candidateIds: candidatesByClass.get(Number(row.class_id)) || [],
    durationMinutes: Number(row.duration_minutes || 120),
    requiresLab: paperRequiresLab(row),
    requiresComputer: paperRequiresComputer(row),
    majorPaper: /math|english|science/i.test(String(row.subject_name || "")),
    metadata: { assessmentId: Number(row.id) },
  }))
}

async function loadSchoolClosures(connection, schoolId, session) {
  const [rows] = await connection.query(
    "SELECT closure_date FROM school_closure_dates WHERE school_id = ? AND (academic_year_id IS NULL OR academic_year_id = ?) AND (term_id IS NULL OR term_id = ?) AND active = 1 AND blocks_exams = 1",
    [schoolId, session.academic_year_id, session.term_id],
  )
  return rows.map((row) => dateText(row.closure_date))
}

export async function buildExamTimetableSolverPayload(connection, schoolId, timetable, version, options = {}) {
  const examSeriesId = Number(options.examSeriesId || options.exam_series_id || timetable.setup_progress?.exam_session_id || timetable.setup_progress?.examSessionId || 0)
  if (!examSeriesId) throw new HttpError(400, "examSeriesId is required for exam timetable generation")
  const session = await loadExamSession(connection, schoolId, examSeriesId)
  const scopeType = String(options.scopeType || options.scope_type || "WHOLE_SCHOOL").toUpperCase()
  const scopeReferenceIds = Array.isArray(options.scopeReferenceIds || options.scope_reference_ids)
    ? (options.scopeReferenceIds || options.scope_reference_ids).map(sid).filter(Boolean)
    : []
  const [facilities, weeklyActivities, windows, rawPapers, closureDates] = await Promise.all([
    loadFacilities(connection, schoolId),
    loadWeeklyActivities(connection, schoolId, session.academic_year_id, session.term_id),
    loadExamWindows(connection, schoolId, timetable.id, session, options),
    loadExamPapers(connection, schoolId, session, scopeType, scopeReferenceIds),
    loadSchoolClosures(connection, schoolId, session),
  ])
  const classes = await loadClasses(connection, schoolId, session.academic_year_id, session.term_id)
  const classHomeFacilityIds = inferClassHomeFacilities(classes, facilities)
  const papers = applyClassHomeRoomsToExamPapers(rawPapers, classHomeFacilityIds, facilities)
  return {
    schoolId: sid(schoolId),
    academicYearId: sid(session.academic_year_id),
    termId: sid(session.term_id),
    examSeriesId: sid(session.id),
    scopeType,
    scopeReferenceIds,
    operatingMode: String(options.operatingMode || options.operating_mode || session.operating_mode || "NORMAL_LESSONS_CONTINUE").toUpperCase(),
    dateRange: {
      startDate: dateText(options.dateRange?.startDate || session.start_date),
      endDate: dateText(options.dateRange?.endDate || session.end_date),
    },
    schoolClosureDates: closureDates,
    availableExamWindows: windows,
    weeklyActivities,
    activityExamPolicies: [],
    normalSchoolTimetableOccupancy: [],
    dailyAdjustments: [],
    facilities: facilities.filter((facility) => facility.canHostExaminations),
    laboratories: facilities.filter((facility) => String(facility.facilityType).includes("LABORATORY")),
    computerLabs: facilities.filter((facility) => facility.facilityType === "COMPUTER_LABORATORY"),
    equipment: await loadEquipment(connection, schoolId),
    papers,
    candidateRegistrations: [],
    candidateGroups: [],
    accommodations: [],
    invigilators: await loadTeachers(connection, schoolId),
    teacherAvailability: await loadTeacherAvailability(connection, schoolId, session.academic_year_id, session.term_id),
    facilityAvailability: await loadFacilityAvailability(connection, schoolId, session.academic_year_id, session.term_id),
    existingExamSessions: [],
    existingFacilityReservations: [],
    hardConstraints: [],
    softConstraints: [],
    strategy: String(options.strategy || "CANDIDATE_FRIENDLY").toUpperCase(),
    maxAlternatives: Number(process.env.TIMETABLE_SOLVER_MAX_ALTERNATIVES || options.maxAlternatives || 1),
    timeLimitSeconds: Number(process.env.TIMETABLE_SOLVER_DEFAULT_TIME_LIMIT_SECONDS || options.timeLimitSeconds || 20),
  }
}

export const solverMapperUtils = {
  sid,
  bool,
  timeText,
  dateText,
  numberValue,
}

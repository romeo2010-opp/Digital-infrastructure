import { pool } from "../../config/db.js"
import { HttpError } from "../../utils/http.js"
import { getScopedSchoolId } from "../../utils/tenantScope.js"
import { assertSchoolFeatureEnabled, enabledTimetableTypes, getSchoolFeatures, timetableFeatureKey } from "../../services/schoolFeaturesService.js"
import { recordTimetableAudit, listTimetableAudit } from "./audit.service.js"
import { validateTimetableEntry, listVersionConflicts, assertNoBlockingConflicts } from "./conflict.service.js"
import { runTimetableReadinessAudit } from "./readiness.service.js"
import {
  assertVersionBelongsToTimetable,
  cleanText,
  dateOnly,
  editableVersionOrThrow,
  enumValue,
  idValue,
  jsonString,
  normalizeTimetable,
  normalizeVersion,
  parseJson,
  sourceHash,
} from "./timetabling.helpers.js"

const TIMETABLE_TYPES = ["SCHOOL_TIMETABLE", "EXAM_TIMETABLE"]
const CYCLE_TYPES = ["NORMAL_WEEK", "WEEK_A_WEEK_B", "ROTATING_CYCLE", "DATED_EXAM_SESSIONS", "CUSTOM"]
const CREATION_METHODS = ["MANUAL", "ASSISTED", "AUTOMATIC", "CLONED", "IMPORTED"]

function positiveInt(value, fallback = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
}

async function loadTimetablePolicy(connection, schoolId) {
  const [[row]] = await connection.query(
    "SELECT setting_value FROM school_settings WHERE school_id = ? AND setting_key = 'timetable_policy' LIMIT 1",
    [schoolId],
  )
  return {
    timetable_cycle_weeks: 1,
    max_timetable_cycle_weeks: 4,
    allow_duplicate_weeks: false,
    default_half_day_closing_time: "12:00:00",
    ...(parseJson(row?.setting_value, {}) || {}),
  }
}

function normalizeCycleWeeks(value, fallback = 1, policy = {}) {
  const maxWeeks = Math.max(1, Math.min(52, positiveInt(policy.max_timetable_cycle_weeks ?? policy.maxTimetableCycleWeeks, 4)))
  const weeks = positiveInt(value, positiveInt(fallback, 1))
  if (weeks > maxWeeks) throw new HttpError(400, `timetable_cycle_weeks cannot exceed ${maxWeeks} for this school policy`)
  return Math.max(1, weeks)
}

async function assertTimetableTypeFeature(connection, schoolId, timetableType) {
  return assertSchoolFeatureEnabled(connection, schoolId, timetableFeatureKey(timetableType))
}

async function assertTimetableFeature(connection, schoolId, timetable) {
  return assertTimetableTypeFeature(connection, schoolId, timetable?.timetable_type)
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
  const [[row]] = await connection.query(
    "SELECT * FROM timetable_versions WHERE timetable_id = ? AND id = ? LIMIT 1",
    [timetableId, versionId],
  )
  return normalizeVersion(row)
}

async function nextVersionNumber(connection, timetableId) {
  const [[row]] = await connection.query("SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number FROM timetable_versions WHERE timetable_id = ?", [timetableId])
  return Number(row?.next_number || 1)
}

async function assertAcademicContext(connection, schoolId, academicYearId, termId = null) {
  const [[year]] = await connection.query("SELECT id, start_date, end_date FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1", [academicYearId, schoolId])
  if (!year) throw new HttpError(400, "Academic year does not belong to this school")
  if (termId) {
    const [[term]] = await connection.query("SELECT id, start_date, end_date FROM terms WHERE id = ? AND academic_year_id = ? AND school_id = ? LIMIT 1", [termId, academicYearId, schoolId])
    if (!term) throw new HttpError(400, "Term does not belong to the selected academic year")
    return { year, term }
  }
  return { year, term: null }
}

async function seedDefaultSchoolCycle(connection, schoolId, timetableId, userId) {
  const days = [
    [1, "MON", "Monday", 1, 1],
    [2, "TUE", "Tuesday", 2, 2],
    [3, "WED", "Wednesday", 3, 3],
    [4, "THU", "Thursday", 4, 4],
    [5, "FRI", "Friday", 5, 5],
  ]
  for (const day of days) {
    await connection.query(
      `INSERT INTO timetable_cycle_days (timetable_id, cycle_day_number, code, display_name, weekday, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), weekday = VALUES(weekday), sort_order = VALUES(sort_order), active = 1`,
      [timetableId, ...day],
    )
  }

  const [templateResult] = await connection.query(
    `INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, is_default, active, created_by)
     VALUES (?, ?, 'Standard School Day', 'Default Monday to Friday teaching day.', 1, 1, ?)`,
    [schoolId, timetableId, userId],
  )
  const templateId = Number(templateResult.insertId)
  const slots = [
    [1, "P1", "Period 1", "07:30:00", "08:10:00", "TEACHING_PERIOD", 1, 1, 1],
    [2, "P2", "Period 2", "08:10:00", "08:50:00", "TEACHING_PERIOD", 1, 1, 2],
    [3, "P3", "Period 3", "08:50:00", "09:30:00", "TEACHING_PERIOD", 1, 1, 3],
    [4, "BREAK", "Break", "09:30:00", "09:50:00", "BREAK", 0, 0, 4],
    [5, "P4", "Period 4", "09:50:00", "10:30:00", "TEACHING_PERIOD", 1, 1, 5],
    [6, "P5", "Period 5", "10:30:00", "11:10:00", "TEACHING_PERIOD", 1, 1, 6],
    [7, "P6", "Period 6", "11:10:00", "11:50:00", "TEACHING_PERIOD", 1, 1, 7],
    [8, "LUNCH", "Lunch", "11:50:00", "12:30:00", "LUNCH", 0, 0, 8],
    [9, "P7", "Period 7", "12:30:00", "13:10:00", "TEACHING_PERIOD", 1, 1, 9],
    [10, "P8", "Period 8", "13:10:00", "13:50:00", "TEACHING_PERIOD", 1, 1, 10],
  ]
  for (const slot of slots) {
    await connection.query(
      `INSERT INTO bell_schedule_slots (
        template_id, slot_number, code, display_name, start_time, end_time, slot_type, teaching_allowed, can_span, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, ...slot],
    )
  }

  const [cycleRows] = await connection.query("SELECT id FROM timetable_cycle_days WHERE timetable_id = ? AND active = 1", [timetableId])
  for (const row of cycleRows) {
    await connection.query(
      `INSERT INTO timetable_day_templates (timetable_id, cycle_day_id, bell_template_id, active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE bell_template_id = VALUES(bell_template_id), active = 1`,
      [timetableId, row.id, templateId],
    )
  }
}

async function seedDefaultExamSlots(connection, schoolId, timetableId, userId) {
  const [templateResult] = await connection.query(
    `INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, is_default, active, created_by)
     VALUES (?, ?, 'Exam Day Sessions', 'Default morning and afternoon examination sessions.', 1, 1, ?)`,
    [schoolId, timetableId, userId],
  )
  const templateId = Number(templateResult.insertId)
  const slots = [
    [1, "AM", "Morning session", "08:00:00", "10:00:00", "CUSTOM", 1, 1, 1],
    [2, "MID", "Late morning session", "10:30:00", "12:30:00", "CUSTOM", 1, 1, 2],
    [3, "PM", "Afternoon session", "13:30:00", "15:30:00", "CUSTOM", 1, 1, 3],
  ]
  for (const slot of slots) {
    await connection.query(
      `INSERT INTO bell_schedule_slots (
        template_id, slot_number, code, display_name, start_time, end_time, slot_type, teaching_allowed, can_span, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, ...slot],
    )
  }
}

export async function listTimetables(req) {
  const schoolId = getScopedSchoolId(req)
  const type = cleanText(req.query.type).toUpperCase()
  const status = cleanText(req.query.status).toUpperCase()
  const params = [schoolId]
  let filters = "tt.school_id = ?"
  if (TIMETABLE_TYPES.includes(type)) {
    await assertTimetableTypeFeature(pool, schoolId, type)
    filters += " AND tt.timetable_type = ?"
    params.push(type)
  } else {
    const enabledTypes = await enabledTimetableTypes(pool, schoolId)
    if (!enabledTypes.length) return { timetables: [] }
    filters += ` AND tt.timetable_type IN (${enabledTypes.map(() => "?").join(", ")})`
    params.push(...enabledTypes)
  }
  if (status) {
    filters += " AND tt.status = ?"
    params.push(status)
  }

  const [rows] = await pool.query(
    `SELECT tt.*, ay.name AS academic_year_name, t.name AS term_name,
      creator.full_name AS created_by_name,
      COUNT(DISTINCT tv.id) AS version_count,
      MAX(tv.version_number) AS latest_version_number
     FROM timetables tt
     JOIN academic_years ay ON ay.id = tt.academic_year_id AND ay.school_id = tt.school_id
     LEFT JOIN terms t ON t.id = tt.term_id AND t.school_id = tt.school_id
     LEFT JOIN users creator ON creator.id = tt.created_by
     LEFT JOIN timetable_versions tv ON tv.timetable_id = tt.id
     WHERE ${filters}
     GROUP BY tt.id, ay.name, t.name, creator.full_name
     ORDER BY tt.updated_at DESC, tt.id DESC
     LIMIT 100`,
    params,
  )
  return { timetables: rows.map((row) => ({ ...normalizeTimetable(row), version_count: Number(row.version_count || 0), latest_version_number: Number(row.latest_version_number || 0) })) }
}

export async function getTimetableSetupOptions(req) {
  const schoolId = getScopedSchoolId(req)
  const features = await getSchoolFeatures(pool, schoolId)
  const availableTypes = await enabledTimetableTypes(pool, schoolId)
  if (!availableTypes.length) throw new HttpError(403, "Timetable features are disabled in school settings")
  const [[years], [terms], [classes], [subjects], [teachers], [rooms], [facilities], [equipment], [weeklyActivities], [bellTemplates], [bellSlots], [examSessions], [assessments], timetablePolicy] = await Promise.all([
    pool.query("SELECT id, name, start_date, end_date, status, is_active FROM academic_years WHERE school_id = ? ORDER BY start_date DESC", [schoolId]),
    pool.query("SELECT id, academic_year_id, name, term_number, start_date, end_date, status FROM terms WHERE school_id = ? ORDER BY start_date DESC", [schoolId]),
    pool.query("SELECT id, name, grade_level, teacher_user_id FROM classes WHERE school_id = ? ORDER BY name", [schoolId]),
    pool.query("SELECT id, name, code FROM subjects WHERE school_id = ? ORDER BY name", [schoolId]),
    pool.query("SELECT id, full_name, specialization, role_type FROM users WHERE school_id = ? AND role IN ('teacher', 'headteacher', 'school_owner') AND is_active = 1 ORDER BY full_name", [schoolId]),
    pool.query("SELECT id, facility_id, code, name, room_type, capacity, exam_capacity, active FROM timetable_rooms WHERE school_id = ? ORDER BY name", [schoolId]),
    pool.query("SELECT id, facility_code, name, facility_type, facility_type_label, normal_capacity, examination_capacity, active, can_host_normal_lessons, can_host_examinations FROM school_facilities WHERE school_id = ? ORDER BY active DESC, facility_type, name", [schoolId]),
    pool.query("SELECT id, name, category, total_quantity, usable_quantity, active FROM facility_equipment WHERE school_id = ? ORDER BY category, name", [schoolId]),
    pool.query("SELECT id, name, activity_type, scope_type, weekday, cycle_day_id, start_slot_id, end_slot_id, facility_id, responsible_teacher_id, exam_policy, active FROM weekly_school_activities WHERE school_id = ? AND active = 1 ORDER BY priority DESC, name", [schoolId]),
    pool.query(
      `SELECT b.id, b.timetable_id, b.name, b.description, b.is_default, b.active, tt.name AS timetable_name, tt.timetable_type, tt.status AS timetable_status
       FROM bell_schedule_templates b
       LEFT JOIN timetables tt ON tt.id = b.timetable_id AND tt.school_id = b.school_id
       WHERE b.school_id = ? AND b.active = 1
       ORDER BY b.is_default DESC, tt.updated_at DESC, b.name
       LIMIT 30`,
      [schoolId],
    ),
    pool.query(
      `SELECT s.*, b.name AS template_name, b.timetable_id, tt.name AS timetable_name, tt.timetable_type, tt.status AS timetable_status
       FROM bell_schedule_slots s
       JOIN bell_schedule_templates b ON b.id = s.template_id
       LEFT JOIN timetables tt ON tt.id = b.timetable_id AND tt.school_id = b.school_id
       WHERE b.school_id = ? AND b.active = 1
       ORDER BY b.is_default DESC, tt.updated_at DESC, b.name, s.sort_order, s.slot_number
       LIMIT 120`,
      [schoolId],
    ),
    pool.query("SELECT id, name, academic_year_id, term_id, exam_type, start_date, end_date, status FROM exam_sessions WHERE school_id = ? ORDER BY start_date DESC", [schoolId]),
    pool.query("SELECT id, name, exam_session_id, academic_year_id, term_id, class_id, subject_id, total_marks, duration_minutes, status FROM assessments WHERE school_id = ? AND status <> 'archived' ORDER BY updated_at DESC LIMIT 200", [schoolId]),
    loadTimetablePolicy(pool, schoolId),
  ])
  return { years, terms, classes, subjects, teachers, rooms, facilities, equipment, weekly_activities: weeklyActivities, bell_templates: bellTemplates, bell_slots: bellSlots, exam_sessions: examSessions, assessments, timetable_policy: timetablePolicy, features, available_types: availableTypes }
}

export async function createTimetable(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableType = enumValue(req.body.timetable_type || req.body.timetableType, TIMETABLE_TYPES, "SCHOOL_TIMETABLE", "timetable_type")
  await assertTimetableTypeFeature(pool, schoolId, timetableType)
  const timetablePolicy = await loadTimetablePolicy(pool, schoolId)
  const timetableCycleWeeks = timetableType === "SCHOOL_TIMETABLE"
    ? normalizeCycleWeeks(req.body.timetable_cycle_weeks || req.body.timetableCycleWeeks, timetablePolicy.timetable_cycle_weeks || 1, timetablePolicy)
    : 1
  const defaultCycleType = timetableType === "EXAM_TIMETABLE" ? "DATED_EXAM_SESSIONS" : timetableCycleWeeks > 1 ? "ROTATING_CYCLE" : "NORMAL_WEEK"
  const cycleType = enumValue(req.body.cycle_type || req.body.cycleType, CYCLE_TYPES, defaultCycleType, "cycle_type")
  const name = cleanText(req.body.name)
  if (!name) throw new HttpError(400, "Timetable name is required")
  const academicYearId = idValue(req.body.academic_year_id || req.body.academicYearId, "academic_year_id", true)
  const termId = idValue(req.body.term_id || req.body.termId)
  const context = await assertAcademicContext(pool, schoolId, academicYearId, termId)
  const effectiveFrom = dateOnly(req.body.effective_from || req.body.effectiveFrom || context.term?.start_date || context.year.start_date, "effective_from", true)
  const effectiveTo = dateOnly(req.body.effective_to || req.body.effectiveTo || context.term?.end_date || context.year.end_date, "effective_to", true)
  if (effectiveTo < effectiveFrom) throw new HttpError(400, "Timetable effective_to must be after effective_from")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO timetables (
        school_id, timetable_type, name, academic_year_id, term_id, cycle_type, timetable_cycle_weeks, effective_from, effective_to,
        status, setup_progress, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SETUP', ?, ?)`,
      [schoolId, timetableType, name, academicYearId, termId, cycleType, timetableCycleWeeks, effectiveFrom, effectiveTo, jsonString(req.body.setup_progress || req.body.setupProgress || {}, {}), req.user.id],
    )
    const timetableId = Number(result.insertId)
    const [versionResult] = await connection.query(
      `INSERT INTO timetable_versions (
        timetable_id, version_number, status, creation_method, configuration_snapshot, source_snapshot_hash, created_by
      ) VALUES (?, 1, 'SETUP', 'MANUAL', ?, ?, ?)`,
      [timetableId, jsonString({ created_from: "initial_setup", timetable_cycle_weeks: timetableCycleWeeks }, {}), sourceHash({ schoolId, timetableType, academicYearId, termId, effectiveFrom, effectiveTo, timetableCycleWeeks }), req.user.id],
    )
    if (req.body.create_default_schedule !== false) {
      if (timetableType === "SCHOOL_TIMETABLE") await seedDefaultSchoolCycle(connection, schoolId, timetableId, req.user.id)
      else await seedDefaultExamSlots(connection, schoolId, timetableId, req.user.id)
    }
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId,
      timetableVersionId: Number(versionResult.insertId),
      actorUserId: req.user.id,
      action: "TIMETABLE_CREATED",
      entityType: "timetable",
      entityId: timetableId,
      newValues: { timetable_type: timetableType, name, academic_year_id: academicYearId, term_id: termId, timetable_cycle_weeks: timetableCycleWeeks },
    })
    await connection.commit()
    return getTimetableById({ ...req, params: { id: timetableId } })
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "A timetable with this name already exists for the selected academic context")
    throw error
  } finally {
    connection.release()
  }
}

export async function getTimetableById(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)

  const [[versions], [cycleDays], [templates], [slots], [dayTemplates], [entries]] = await Promise.all([
    pool.query("SELECT * FROM timetable_versions WHERE timetable_id = ? ORDER BY version_number DESC", [timetableId]),
    pool.query("SELECT * FROM timetable_cycle_days WHERE timetable_id = ? ORDER BY sort_order, cycle_day_number", [timetableId]),
    pool.query(
      `SELECT b.*, COUNT(s.id) AS slot_count
       FROM bell_schedule_templates b
       LEFT JOIN bell_schedule_slots s ON s.template_id = b.id
       WHERE b.school_id = ? AND (b.timetable_id IS NULL OR b.timetable_id = ?)
       GROUP BY b.id
       ORDER BY b.is_default DESC, b.name`,
      [schoolId, timetableId],
    ),
    pool.query(
      `SELECT s.*
       FROM bell_schedule_slots s
       JOIN bell_schedule_templates b ON b.id = s.template_id
       WHERE b.school_id = ? AND (b.timetable_id IS NULL OR b.timetable_id = ?)
       ORDER BY b.is_default DESC, b.name, s.sort_order, s.slot_number`,
      [schoolId, timetableId],
    ),
    pool.query(
      `SELECT dt.*, cd.display_name AS cycle_day_name, cd.code AS cycle_day_code, b.name AS bell_template_name
       FROM timetable_day_templates dt
       JOIN timetable_cycle_days cd ON cd.id = dt.cycle_day_id
       JOIN bell_schedule_templates b ON b.id = dt.bell_template_id
       WHERE dt.timetable_id = ?
       ORDER BY cd.sort_order, cd.cycle_day_number`,
      [timetableId],
    ),
    pool.query(
      `SELECT e.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
        r.name AS room_name, sf.name AS facility_name, sf.facility_type, cd.display_name AS cycle_day_name, ss.display_name AS start_slot_name, es.display_name AS end_slot_name,
        wsa.name AS weekly_activity_name
       FROM timetable_entries e
       JOIN timetable_versions tv ON tv.id = e.timetable_version_id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN subjects subj ON subj.id = e.subject_id
       LEFT JOIN users teacher ON teacher.id = e.teacher_id
       LEFT JOIN timetable_rooms r ON r.id = e.room_id
       LEFT JOIN school_facilities sf ON sf.id = e.facility_id
       LEFT JOIN weekly_school_activities wsa ON wsa.id = e.source_weekly_activity_id
       LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
       LEFT JOIN bell_schedule_slots ss ON ss.id = e.slot_start_id
       LEFT JOIN bell_schedule_slots es ON es.id = e.slot_end_id
       WHERE tv.timetable_id = ?
       ORDER BY tv.version_number DESC, COALESCE(e.cycle_week, 1), cd.sort_order, ss.sort_order
       LIMIT 300`,
      [timetableId],
    ),
  ])

  return {
    timetable,
    versions: versions.map(normalizeVersion),
    cycle_days: cycleDays,
    bell_templates: templates.map((row) => ({ ...row, slot_count: Number(row.slot_count || 0) })),
    bell_slots: slots,
    day_templates: dayTemplates,
    entries,
  }
}

export async function updateTimetableSetup(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  if (["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(timetable.status)) throw new HttpError(409, "Published or archived timetables cannot be edited directly")

  const timetablePolicy = await loadTimetablePolicy(pool, schoolId)
  const patch = {
    name: cleanText(req.body.name || timetable.name),
    cycle_type: req.body.cycle_type || req.body.cycleType ? enumValue(req.body.cycle_type || req.body.cycleType, CYCLE_TYPES, timetable.cycle_type, "cycle_type") : timetable.cycle_type,
    timetable_cycle_weeks: timetable.timetable_type === "SCHOOL_TIMETABLE"
      ? normalizeCycleWeeks(req.body.timetable_cycle_weeks ?? req.body.timetableCycleWeeks, timetable.timetable_cycle_weeks || 1, timetablePolicy)
      : 1,
    effective_from: dateOnly(req.body.effective_from || req.body.effectiveFrom || timetable.effective_from, "effective_from", true),
    effective_to: dateOnly(req.body.effective_to || req.body.effectiveTo || timetable.effective_to, "effective_to", true),
    setup_progress: req.body.setup_progress || req.body.setupProgress || timetable.setup_progress || {},
  }
  if (patch.effective_to < patch.effective_from) throw new HttpError(400, "Timetable effective_to must be after effective_from")

  await pool.query(
    `UPDATE timetables
     SET name = ?, cycle_type = ?, timetable_cycle_weeks = ?, effective_from = ?, effective_to = ?, setup_progress = ?, status = 'VALIDATION_REQUIRED'
     WHERE school_id = ? AND id = ?`,
    [patch.name, patch.cycle_type, patch.timetable_cycle_weeks, patch.effective_from, patch.effective_to, jsonString(patch.setup_progress, {}), schoolId, timetableId],
  )
  await recordTimetableAudit({
    schoolId,
    timetableId,
    actorUserId: req.user.id,
    action: "TIMETABLE_SETUP_UPDATED",
    entityType: "timetable",
    entityId: timetableId,
    previousValues: timetable,
    newValues: patch,
  })
  return getTimetableById(req)
}

export async function archiveTimetable(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const [result] = await pool.query("UPDATE timetables SET status = 'ARCHIVED' WHERE school_id = ? AND id = ? AND status <> 'ARCHIVED'", [schoolId, timetableId])
  if (!result.affectedRows) throw new HttpError(404, "Timetable was not found or already archived")
  await recordTimetableAudit({ schoolId, timetableId, actorUserId: req.user.id, action: "TIMETABLE_ARCHIVED", entityType: "timetable", entityId: timetableId })
  return { archived: true }
}

export async function listVersions(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const [versions] = await pool.query("SELECT * FROM timetable_versions WHERE timetable_id = ? ORDER BY version_number DESC", [timetableId])
  return { timetable, versions: versions.map(normalizeVersion) }
}

export async function createVersion(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const parentVersionId = idValue(req.body.parent_version_id || req.body.parentVersionId)
  const creationMethod = enumValue(req.body.creation_method || req.body.creationMethod, CREATION_METHODS, parentVersionId ? "CLONED" : "MANUAL", "creation_method")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const versionNumber = await nextVersionNumber(connection, timetableId)
    let parent = null
    if (parentVersionId) {
      parent = await loadVersion(connection, timetableId, parentVersionId)
      assertVersionBelongsToTimetable(parent, timetableId)
    }
    const [result] = await connection.query(
      `INSERT INTO timetable_versions (
        timetable_id, version_number, parent_version_id, status, creation_method,
        configuration_snapshot, constraint_snapshot, source_snapshot_hash, change_summary, created_by
      ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
      [
        timetableId,
        versionNumber,
        parentVersionId,
        creationMethod,
        jsonString(parent?.configuration_snapshot || req.body.configuration_snapshot || {}, {}),
        jsonString(parent?.constraint_snapshot || req.body.constraint_snapshot || {}, {}),
        sourceHash({ timetableId, parentVersionId, versionNumber }),
        cleanText(req.body.change_summary || req.body.changeSummary || (parent ? `Cloned from version ${parent.version_number}` : "New draft version")),
        req.user.id,
      ],
    )
    const versionId = Number(result.insertId)
    if (parentVersionId) {
      await connection.query(
        `INSERT INTO timetable_entries (
          timetable_version_id, cycle_week, cycle_day_id, calendar_date, slot_start_id, slot_end_id, entry_type, subject_id,
          class_id, stream_section, student_group_id, teacher_id, room_id, facility_id, source_requirement_id, source_weekly_activity_id,
          assessment_id, exam_session_id, title, locked, lock_reason, manually_modified, modification_reason, created_by
        )
        SELECT ?, COALESCE(cycle_week, 1), cycle_day_id, calendar_date, slot_start_id, slot_end_id, entry_type, subject_id,
          class_id, stream_section, student_group_id, teacher_id, room_id, facility_id, source_requirement_id, source_weekly_activity_id,
          assessment_id, exam_session_id, title, locked, lock_reason, manually_modified, modification_reason, ?
        FROM timetable_entries
        WHERE timetable_version_id = ?`,
        [versionId, req.user.id, parentVersionId],
      )
    }
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId,
      timetableVersionId: versionId,
      actorUserId: req.user.id,
      action: parentVersionId ? "VERSION_CLONED" : "VERSION_CREATED",
      entityType: "timetable_version",
      entityId: versionId,
      newValues: { version_number: versionNumber, parent_version_id: parentVersionId, creation_method: creationMethod },
    })
    await connection.commit()
    return getVersionById({ ...req, params: { id: timetableId, versionId } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getVersionById(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  const [entries] = await pool.query(
    `SELECT e.*, c.name AS class_name, subj.name AS subject_name, teacher.full_name AS teacher_name,
      r.name AS room_name, sf.name AS facility_name, sf.facility_type, cd.display_name AS cycle_day_name, ss.display_name AS start_slot_name, es.display_name AS end_slot_name,
      wsa.name AS weekly_activity_name
     FROM timetable_entries e
     LEFT JOIN classes c ON c.id = e.class_id
     LEFT JOIN subjects subj ON subj.id = e.subject_id
     LEFT JOIN users teacher ON teacher.id = e.teacher_id
     LEFT JOIN timetable_rooms r ON r.id = e.room_id
     LEFT JOIN school_facilities sf ON sf.id = e.facility_id
     LEFT JOIN weekly_school_activities wsa ON wsa.id = e.source_weekly_activity_id
     LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
     LEFT JOIN bell_schedule_slots ss ON ss.id = e.slot_start_id
     LEFT JOIN bell_schedule_slots es ON es.id = e.slot_end_id
     WHERE e.timetable_version_id = ?
     ORDER BY COALESCE(e.calendar_date, '9999-12-31'), COALESCE(e.cycle_week, 1), cd.sort_order, ss.sort_order, e.id`,
    [versionId],
  )
  const [slots] = await pool.query(
    `SELECT s.*
     FROM bell_schedule_slots s
     JOIN bell_schedule_templates b ON b.id = s.template_id
     WHERE b.school_id = ? AND (b.timetable_id IS NULL OR b.timetable_id = ?)
     ORDER BY b.is_default DESC, b.name, s.sort_order, s.slot_number`,
    [schoolId, timetableId],
  )
  const [cycleDays] = await pool.query("SELECT * FROM timetable_cycle_days WHERE timetable_id = ? AND active = 1 ORDER BY sort_order, cycle_day_number", [timetableId])
  const [dayTemplates] = await pool.query(
    `SELECT dt.*, cd.display_name AS cycle_day_name, cd.code AS cycle_day_code, b.name AS bell_template_name
     FROM timetable_day_templates dt
     JOIN timetable_cycle_days cd ON cd.id = dt.cycle_day_id
     JOIN bell_schedule_templates b ON b.id = dt.bell_template_id
     WHERE dt.timetable_id = ?
     ORDER BY cd.sort_order, cd.cycle_day_number`,
    [timetableId],
  )
  return { timetable, version, entries, bell_slots: slots, cycle_days: cycleDays, day_templates: dayTemplates }
}

function parseArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function tagSet(text) {
  return new Set(String(text || "").split(",").map((item) => item.trim()).filter(Boolean))
}

async function assertReportVersion(schoolId, timetableId, versionId) {
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  return { timetable, version }
}

export async function getFocusReport(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const { timetable, version } = await assertReportVersion(schoolId, timetableId, versionId)
  const [[assignments], [rules], [entries]] = await Promise.all([
    pool.query(
      `SELECT *
       FROM subject_focus_assignments
       WHERE school_id = ? AND active = 1
        AND (academic_year_id IS NULL OR academic_year_id = ?)
        AND (term_id IS NULL OR term_id = ?)`,
      [schoolId, timetable.academic_year_id, timetable.term_id],
    ),
    pool.query(
      `SELECT *
       FROM subject_focus_rules
       WHERE school_id = ? AND active = 1
        AND (academic_year_id IS NULL OR academic_year_id = ?)
        AND (term_id IS NULL OR term_id = ?)`,
      [schoolId, timetable.academic_year_id, timetable.term_id],
    ),
    pool.query(
      `SELECT e.id, e.subject_id, e.class_id, e.stream_section, subj.name AS subject_name, c.name AS class_name,
        cd.display_name AS cycle_day_name, st.display_name AS start_slot_name, GROUP_CONCAT(DISTINCT bst.tag_code ORDER BY bst.priority, bst.tag_code) AS slot_tags
       FROM timetable_entries e
       JOIN bell_schedule_slots st ON st.id = e.slot_start_id
       JOIN bell_schedule_slots en ON en.id = e.slot_end_id
       LEFT JOIN bell_schedule_slots occupied ON occupied.template_id = st.template_id AND occupied.slot_number BETWEEN st.slot_number AND en.slot_number
       LEFT JOIN bell_schedule_slot_tags bst ON bst.bell_schedule_slot_id = occupied.id AND bst.school_id = ? AND bst.active = 1
       LEFT JOIN subjects subj ON subj.id = e.subject_id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
       WHERE e.timetable_version_id = ? AND e.subject_id IS NOT NULL
       GROUP BY e.id
       ORDER BY cd.sort_order, st.sort_order, e.id`,
      [schoolId, versionId],
    ),
  ])
  const focusedSubjectIds = new Set(assignments.map((row) => Number(row.subject_id)))
  const preferredTags = new Set(rules.flatMap((rule) => parseArray(rule.preferred_slot_tags)).map(String))
  const avoidedTags = new Set(rules.flatMap((rule) => parseArray(rule.avoided_slot_tags)).map(String))
  const rows = entries.map((entry) => {
    const tags = tagSet(entry.slot_tags)
    const isFocused = focusedSubjectIds.has(Number(entry.subject_id))
    const preferred = [...preferredTags].some((tag) => tags.has(tag))
    const avoided = [...avoidedTags].some((tag) => tags.has(tag))
    return {
      ...entry,
      focused: isFocused,
      slot_tags: [...tags],
      focus_status: !isFocused ? "NOT_FOCUS_SUBJECT" : avoided ? "AVOIDED_TAG" : preferred ? "PREFERRED_TAG" : "NEUTRAL_TAG",
    }
  })
  return {
    timetable,
    version,
    summary: {
      focus_subject_entries: rows.filter((row) => row.focused).length,
      preferred_tag_entries: rows.filter((row) => row.focus_status === "PREFERRED_TAG").length,
      avoided_tag_entries: rows.filter((row) => row.focus_status === "AVOIDED_TAG").length,
      neutral_tag_entries: rows.filter((row) => row.focus_status === "NEUTRAL_TAG").length,
      configured_rules: rules.length,
    },
    entries: rows,
  }
}

export async function getStreamRuleReport(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const { timetable, version } = await assertReportVersion(schoolId, timetableId, versionId)
  const [[rules], [entries]] = await Promise.all([
    pool.query(
      `SELECT *
       FROM stream_scheduling_rules
       WHERE school_id = ? AND active = 1
        AND (academic_year_id IS NULL OR academic_year_id = ?)
        AND (term_id IS NULL OR term_id = ?)`,
      [schoolId, timetable.academic_year_id, timetable.term_id],
    ),
    pool.query(
      `SELECT e.id, e.cycle_week, e.subject_id, e.class_id, e.stream_section, subj.name AS subject_name, c.name AS class_name,
        c.grade_level, cd.display_name AS cycle_day_name, st.id AS slot_start_id, st.display_name AS start_slot_name
       FROM timetable_entries e
       JOIN bell_schedule_slots st ON st.id = e.slot_start_id
       LEFT JOIN subjects subj ON subj.id = e.subject_id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN timetable_cycle_days cd ON cd.id = e.cycle_day_id
       WHERE e.timetable_version_id = ? AND e.subject_id IS NOT NULL AND e.stream_section IS NOT NULL
       ORDER BY cd.sort_order, st.sort_order, subj.name, c.name`,
      [versionId],
    ),
  ])
  const groups = new Map()
  entries.forEach((entry) => {
    const key = [entry.class_id || entry.grade_level || "school", entry.subject_id, entry.cycle_week || 1, entry.cycle_day_name, entry.slot_start_id].join(":")
    groups.set(key, [...(groups.get(key) || []), entry])
  })
  const parallelGroups = [...groups.values()].filter((items) => new Set(items.map((item) => item.stream_section)).size > 1)
  return {
    timetable,
    version,
    summary: {
      configured_rules: rules.length,
      stream_entries: entries.length,
      parallel_same_subject_groups: parallelGroups.length,
      hard_rules: rules.filter((rule) => rule.severity === "HARD").length,
      soft_rules: rules.filter((rule) => rule.severity === "SOFT").length,
    },
    groups: parallelGroups.map((items) => ({
      subject_id: items[0].subject_id,
      subject_name: items[0].subject_name,
      class_id: items[0].class_id,
      class_name: items[0].class_name,
      cycle_week: Number(items[0].cycle_week || 1),
      cycle_day_name: items[0].cycle_day_name,
      slot_start_id: items[0].slot_start_id,
      start_slot_name: items[0].start_slot_name,
      streams: items.map((item) => ({ entry_id: Number(item.id), stream_section: item.stream_section })),
    })),
  }
}

export async function getReadiness(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = versionId ? await loadVersion(pool, timetableId, versionId) : null
  if (versionId) assertVersionBelongsToTimetable(version, timetableId)
  return runTimetableReadinessAudit(pool, schoolId, timetable, version)
}

export async function validateEntry(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  const conflicts = await validateTimetableEntry(pool, schoolId, timetable, version, req.body || {})
  return { valid: !conflicts.some((item) => item.blocking), conflicts }
}

export async function createEntry(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  editableVersionOrThrow(version)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const conflicts = await validateTimetableEntry(connection, schoolId, timetable, version, req.body || {})
    assertNoBlockingConflicts(conflicts)
    const [result] = await connection.query(
      `INSERT INTO timetable_entries (
        timetable_version_id, cycle_week, cycle_day_id, calendar_date, slot_start_id, slot_end_id, entry_type,
        subject_id, class_id, stream_section, teacher_id, assistant_teacher_id, room_id, facility_id, source_requirement_id,
        source_weekly_activity_id, required_equipment_json, assessment_id, exam_session_id, title, locked, manually_modified,
        modification_reason, created_by, updated_by, notify_on_publication
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        versionId,
        normalizeCycleWeeks(req.body.cycle_week || req.body.cycleWeek, 1, { max_timetable_cycle_weeks: timetable.timetable_cycle_weeks || 1 }),
        idValue(req.body.cycle_day_id || req.body.cycleDayId),
        req.body.calendar_date || req.body.calendarDate || null,
        idValue(req.body.slot_start_id || req.body.slotStartId, "slot_start_id", true),
        idValue(req.body.slot_end_id || req.body.slotEndId || req.body.slot_start_id || req.body.slotStartId, "slot_end_id", true),
        cleanText(req.body.entry_type || req.body.entryType || "LESSON").toUpperCase(),
        idValue(req.body.subject_id || req.body.subjectId),
        idValue(req.body.class_id || req.body.classId),
        cleanText(req.body.stream_section || req.body.streamSection) || null,
        idValue(req.body.teacher_id || req.body.teacherId),
        idValue(req.body.assistant_teacher_id || req.body.assistantTeacherId),
        idValue(req.body.room_id || req.body.roomId),
        idValue(req.body.facility_id || req.body.facilityId),
        idValue(req.body.source_requirement_id || req.body.sourceRequirementId),
        idValue(req.body.source_weekly_activity_id || req.body.sourceWeeklyActivityId),
        jsonString(req.body.required_equipment_json || req.body.requiredEquipment || [], []),
        idValue(req.body.assessment_id || req.body.assessmentId),
        idValue(req.body.exam_session_id || req.body.examSessionId),
        cleanText(req.body.title) || null,
        req.body.locked ? 1 : 0,
        cleanText(req.body.modification_reason || req.body.modificationReason) || null,
        req.user.id,
        req.user.id,
        req.body.notify_on_publication || req.body.notifyOnPublication ? 1 : 0,
      ],
    )
    await recordTimetableAudit({
      connection,
      schoolId,
      timetableId,
      timetableVersionId: versionId,
      actorUserId: req.user.id,
      action: "ENTRY_ADDED",
      entityType: "timetable_entry",
      entityId: Number(result.insertId),
      newValues: req.body,
    })
    await connection.commit()
    return getVersionById({ ...req, params: { id: timetableId, versionId } })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listConflicts(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  return { conflicts: await listVersionConflicts(schoolId, versionId) }
}

function entryPayload(row) {
  return {
    id: row.id,
    entry_id: row.id,
    cycle_week: row.cycle_week || 1,
    entry_type: row.entry_type,
    title: row.title,
    calendar_date: row.calendar_date,
    cycle_day_id: row.cycle_day_id,
    slot_start_id: row.slot_start_id,
    slot_end_id: row.slot_end_id,
    class_id: row.class_id,
    subject_id: row.subject_id,
    teacher_id: row.teacher_id,
    room_id: row.room_id,
    facility_id: row.facility_id,
    stream_section: row.stream_section,
  }
}

function conflictStorageValues(schoolId, versionId, item) {
  return [
    schoolId,
    versionId,
    item.conflictCode || item.conflict_code,
    item.severity,
    item.affectedEntities?.[0]?.type || "timetable",
    JSON.stringify(item.affectedEntities || []),
    JSON.stringify(item.affectedEntries || []),
    item.humanReadableMessage || item.human_message || item.message,
    JSON.stringify(item.suggestedAlternatives || []),
  ]
}

function conflictKey(item) {
  return JSON.stringify({
    code: item.conflictCode || item.conflict_code,
    message: item.humanReadableMessage || item.human_message || item.message,
    entries: [...(item.affectedEntries || [])].map(Number).sort((a, b) => a - b),
    entities: item.affectedEntities || [],
  })
}

async function auditVersionBlockingConflicts(connection, schoolId, timetable, version) {
  const [entries] = await connection.query(
    `SELECT id, entry_type, title, calendar_date, cycle_day_id, slot_start_id, slot_end_id,
      class_id, subject_id, teacher_id, room_id, facility_id, stream_section
     FROM timetable_entries
     WHERE timetable_version_id = ?
     ORDER BY id`,
    [version.id],
  )
  const seen = new Set()
  const hardConflicts = []
  for (const row of entries) {
    const conflicts = await validateTimetableEntry(connection, schoolId, timetable, version, entryPayload(row))
    conflicts
      .filter((item) => item.blocking || item.severity === "HARD")
      .forEach((item) => {
        const key = conflictKey(item)
        if (seen.has(key)) return
        seen.add(key)
        hardConflicts.push(item)
      })
  }

  await connection.query(
    "DELETE FROM timetable_conflicts WHERE school_id = ? AND timetable_version_id = ? AND resolved = 0 AND severity = 'HARD'",
    [schoolId, version.id],
  )
  for (const item of hardConflicts) {
    await connection.query(
      `INSERT INTO timetable_conflicts (
        school_id, timetable_version_id, conflict_code, severity, affected_entity_type,
        affected_entity_ids, entry_ids, human_message, resolution_suggestions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      conflictStorageValues(schoolId, version.id, item),
    )
  }
  return hardConflicts
}

async function transitionVersion(req, targetStatus, action, options = {}) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  if (options.requireReadiness) {
    const readiness = await runTimetableReadinessAudit(pool, schoolId, timetable, version)
    if (!readiness.ready) throw new HttpError(409, readiness.errors[0]?.message || "Timetable is not ready")
  }
  if (options.requireNoConflicts) {
    const conflicts = await auditVersionBlockingConflicts(pool, schoolId, timetable, version)
    const firstHardConflict = conflicts[0]
    if (firstHardConflict) {
      const reason = firstHardConflict.humanReadableMessage || firstHardConflict.message || firstHardConflict.human_message || firstHardConflict.conflict_code || firstHardConflict.conflictCode
      throw new HttpError(409, `Resolve hard timetable conflicts before continuing: ${reason}`)
    }
  }

  await pool.query(
    `UPDATE timetable_versions
     SET status = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = CASE WHEN ? = 'UNDER_REVIEW' THEN CURRENT_TIMESTAMP ELSE reviewed_at END,
      approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END,
      change_summary = COALESCE(?, change_summary)
     WHERE timetable_id = ? AND id = ?`,
    [
      targetStatus,
      req.user.id,
      targetStatus,
      targetStatus,
      req.user.id,
      targetStatus,
      cleanText(req.body?.change_summary || req.body?.changeSummary) || null,
      timetableId,
      versionId,
    ],
  )
  await pool.query("UPDATE timetables SET status = ? WHERE school_id = ? AND id = ?", [targetStatus, schoolId, timetableId])
  if (req.body?.comment || req.body?.reason) {
    await pool.query(
      `INSERT INTO timetable_review_comments (school_id, timetable_version_id, comment_type, body, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [schoolId, versionId, targetStatus === "CHANGES_REQUESTED" ? "CHANGE_REQUEST" : "COMMENT", cleanText(req.body.comment || req.body.reason), req.user.id],
    )
  }
  await recordTimetableAudit({ schoolId, timetableId, timetableVersionId: versionId, actorUserId: req.user.id, action, entityType: "timetable_version", entityId: versionId, newValues: { status: targetStatus } })
  return getVersionById(req)
}

export const submitForReview = (req) => transitionVersion(req, "UNDER_REVIEW", "REVIEW_SUBMITTED", { requireReadiness: true })
export const requestChanges = (req) => transitionVersion(req, "CHANGES_REQUESTED", "CHANGES_REQUESTED")
export const approveVersion = (req) => transitionVersion(req, "APPROVED", "APPROVAL_GRANTED", { requireReadiness: true, requireNoConflicts: true })

export async function publishVersion(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const timetable = await loadTimetable(connection, schoolId, timetableId)
    if (!timetable) throw new HttpError(404, "Timetable was not found")
    await assertTimetableFeature(connection, schoolId, timetable)
    await assertSchoolFeatureEnabled(connection, schoolId, "timetable_publication")
    const version = await loadVersion(connection, timetableId, versionId)
    assertVersionBelongsToTimetable(version, timetableId)
    if (version.status !== "APPROVED") throw new HttpError(409, "Only approved timetable versions can be published")
    const readiness = await runTimetableReadinessAudit(connection, schoolId, timetable, version)
    if (!readiness.ready) throw new HttpError(409, readiness.errors[0]?.message || "Timetable is not ready for publication")
    const blockingConflicts = await auditVersionBlockingConflicts(connection, schoolId, timetable, version)
    if (blockingConflicts.length) {
      const reason = blockingConflicts[0].humanReadableMessage || blockingConflicts[0].message || blockingConflicts[0].conflictCode || "Resolve hard timetable conflicts before publishing"
      throw new HttpError(409, `Resolve hard timetable conflicts before publishing: ${reason}`)
    }
    const [entries] = await connection.query("SELECT * FROM timetable_entries WHERE timetable_version_id = ? ORDER BY id", [versionId])
    const snapshot = { timetable, version, entries, published_at: new Date().toISOString(), publication_notes: cleanText(req.body.publication_notes || req.body.publicationNotes) || null }

    if (timetable.timetable_type === "SCHOOL_TIMETABLE") {
      await connection.query(
        `UPDATE timetable_publications pub
         JOIN timetables tt ON tt.id = pub.timetable_id AND tt.school_id = pub.school_id
         SET pub.publication_status = 'SUPERSEDED', pub.superseded_at = CURRENT_TIMESTAMP
         WHERE pub.school_id = ? AND tt.timetable_type = 'SCHOOL_TIMETABLE' AND pub.publication_status = 'ACTIVE'`,
        [schoolId],
      )
      await connection.query(
        `UPDATE timetable_versions tv
         JOIN timetables tt ON tt.id = tv.timetable_id
         SET tv.status = 'SUPERSEDED'
         WHERE tt.school_id = ? AND tt.timetable_type = 'SCHOOL_TIMETABLE' AND tv.status = 'PUBLISHED' AND tv.id <> ?`,
        [schoolId, versionId],
      )
      await connection.query(
        `UPDATE timetables
         SET status = 'SUPERSEDED', current_published_version_id = NULL
         WHERE school_id = ? AND timetable_type = 'SCHOOL_TIMETABLE' AND status = 'PUBLISHED' AND id <> ?`,
        [schoolId, timetableId],
      )
    } else {
      await connection.query(
        `UPDATE timetable_publications
         SET publication_status = 'SUPERSEDED', superseded_at = CURRENT_TIMESTAMP
         WHERE school_id = ? AND timetable_id = ? AND publication_status = 'ACTIVE'`,
        [schoolId, timetableId],
      )
      await connection.query(
        `UPDATE timetable_versions
         SET status = 'SUPERSEDED'
         WHERE timetable_id = ? AND status = 'PUBLISHED' AND id <> ?`,
        [timetableId, versionId],
      )
    }
    await connection.query(
      `INSERT INTO timetable_publications (school_id, timetable_id, timetable_version_id, audience_scope, snapshot, published_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, timetableId, versionId, jsonString(req.body.audience_scope || req.body.audienceScope || { type: "school" }, {}), jsonString(snapshot, {}), req.user.id],
    )
    await connection.query(
      `UPDATE timetable_versions SET status = 'PUBLISHED', published_by = ?, published_at = CURRENT_TIMESTAMP, publication_notes = ? WHERE id = ?`,
      [req.user.id, cleanText(req.body.publication_notes || req.body.publicationNotes) || null, versionId],
    )
    await connection.query(
      `UPDATE timetables SET status = 'PUBLISHED', current_published_version_id = ? WHERE school_id = ? AND id = ?`,
      [versionId, schoolId, timetableId],
    )
    await connection.query(
      `INSERT INTO messages (school_id, message_type, subject, body, recipient_scope, channel, delivery_status, created_by)
       VALUES (?, 'announcement', ?, ?, ?, 'in_app', 'pending', ?)`,
      [
        schoolId,
        `${timetable.name} published`,
        `A new ${timetable.timetable_type === "EXAM_TIMETABLE" ? "exam" : "school"} timetable version has been published.`,
        jsonString({ type: "school", source: "timetable", timetable_id: timetableId, version_id: versionId }, {}),
        req.user.id,
      ],
    )
    await recordTimetableAudit({ connection, schoolId, timetableId, timetableVersionId: versionId, actorUserId: req.user.id, action: "PUBLICATION_COMPLETED", entityType: "timetable_version", entityId: versionId, newValues: { status: "PUBLISHED" } })
    await connection.commit()
    return getVersionById(req)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function startGeneration(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertTimetableFeature(pool, schoolId, timetable)
  await assertSchoolFeatureEnabled(pool, schoolId, "timetable_generation")
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  if (!["READY", "DRAFT"].includes(version.status)) throw new HttpError(409, "Only ready or draft versions can be sent for generation")
  const readiness = await runTimetableReadinessAudit(pool, schoolId, timetable, version)
  if (!readiness.ready) throw new HttpError(409, readiness.errors[0]?.message || "Timetable is not ready for generation")
  const strategy = cleanText(req.body.strategy || req.body.generation_strategy || "BALANCED").toUpperCase()
  const [result] = await pool.query(
    `INSERT INTO timetable_generation_jobs (
      school_id, timetable_id, timetable_version_id, job_status, progress_stage, requested_by, generation_strategy, user_message
    ) VALUES (?, ?, ?, 'QUEUED', 'PREPARING_INPUT', ?, ?, 'Generation is queued for the timetable solver worker.')`,
    [schoolId, timetableId, versionId, req.user.id, strategy],
  )
  await pool.query("UPDATE timetable_versions SET status = 'GENERATING', generation_strategy = ? WHERE id = ?", [strategy, versionId])
  await pool.query("UPDATE timetables SET status = 'GENERATING' WHERE id = ? AND school_id = ?", [timetableId, schoolId])
  await recordTimetableAudit({ schoolId, timetableId, timetableVersionId: versionId, actorUserId: req.user.id, action: "GENERATION_STARTED", entityType: "timetable_generation_job", entityId: Number(result.insertId), newValues: { strategy } })
  return { job: { id: Number(result.insertId), status: "QUEUED", progress_stage: "PREPARING_INPUT", strategy } }
}

export async function getGenerationJob(req) {
  const schoolId = getScopedSchoolId(req)
  const jobId = idValue(req.params.jobId, "job id", true)
  const [[job]] = await pool.query(
    `SELECT j.*, tt.timetable_type
     FROM timetable_generation_jobs j
     JOIN timetables tt ON tt.id = j.timetable_id AND tt.school_id = j.school_id
     WHERE j.school_id = ? AND j.id = ?
     LIMIT 1`,
    [schoolId, jobId],
  )
  if (!job) throw new HttpError(404, "Generation job was not found")
  await assertTimetableTypeFeature(pool, schoolId, job.timetable_type)
  return { job }
}

export async function getAudit(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id)
  if (timetableId) {
    const timetable = await loadTimetable(pool, schoolId, timetableId)
    if (!timetable) throw new HttpError(404, "Timetable was not found")
    await assertTimetableFeature(pool, schoolId, timetable)
  }
  return { audit_events: await listTimetableAudit(pool, schoolId, timetableId, req.query.limit) }
}

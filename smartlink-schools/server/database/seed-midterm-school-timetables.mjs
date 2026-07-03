import mysql from "mysql2/promise"

const config = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL, multipleStatements: true, dateStrings: ["DATE"] }
  : {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "smartlink_schools",
      multipleStatements: true,
      dateStrings: ["DATE"],
    }

const schoolName = process.env.SEED_SCHOOL_NAME || "Greenhill Cambridge Primary School"
const examSessionName = process.env.SEED_EXAM_SESSION_NAME || "Mid Term 1"
const schoolTimetableName = process.env.SEED_SCHOOL_TIMETABLE_NAME || "Greenhill Class Timetable Draft"
const examTimetableName = process.env.SEED_EXAM_TIMETABLE_NAME || "Mid Term 1 Draft Exam Timetable"

const weekDays = [
  [1, "MON", "Monday", 1, 1],
  [2, "TUE", "Tuesday", 2, 2],
  [3, "WED", "Wednesday", 3, 3],
  [4, "THU", "Thursday", 4, 4],
  [5, "FRI", "Friday", 5, 5],
]

const schoolSlots = [
  [1, "P1", "Period 1", "07:30:00", "08:10:00", "TEACHING_PERIOD", 1, 1, 1],
  [2, "P2", "Period 2", "08:10:00", "08:50:00", "TEACHING_PERIOD", 1, 1, 2],
  [3, "P3", "Period 3", "08:50:00", "09:30:00", "TEACHING_PERIOD", 1, 1, 3],
  [4, "BREAK", "Break", "09:30:00", "09:50:00", "BREAK", 0, 0, 4],
  [5, "P4", "Period 4", "09:50:00", "10:30:00", "TEACHING_PERIOD", 1, 1, 5],
  [6, "P5", "Period 5", "10:30:00", "11:10:00", "TEACHING_PERIOD", 1, 1, 6],
  [7, "P6", "Period 6", "11:10:00", "11:50:00", "TEACHING_PERIOD", 1, 1, 7],
  [8, "LUNCH", "Lunch", "11:50:00", "12:30:00", "LUNCH", 0, 0, 8],
  [9, "P7", "Period 7", "12:30:00", "13:10:00", "TEACHING_PERIOD", 1, 1, 9],
]

const examSlots = [
  [1, "AM", "Morning paper", "08:00:00", "10:00:00", "CUSTOM", 1, 1, 1],
  [2, "MID", "Late morning paper", "10:30:00", "12:30:00", "CUSTOM", 1, 1, 2],
  [3, "PM", "Afternoon paper", "13:30:00", "15:30:00", "CUSTOM", 1, 1, 3],
]

const coreSubjectCodes = ["ENG", "MATH", "SCI", "CHI", "SOC"]
const examSubjectCodes = ["ENG", "MATH", "SCI"]
const examDayByCode = {
  ENG: 0,
  MATH: 1,
  SCI: 2,
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function roomCodeForClass(className) {
  return `ROOM-${String(className || "CLASS").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`
}

async function one(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows[0] || null
}

async function ensureTimetable(connection, { schoolId, name, type, academicYearId, termId, cycleType, effectiveFrom, effectiveTo, userId }) {
  let timetable = await one(
    connection,
    "SELECT * FROM timetables WHERE school_id = ? AND timetable_type = ? AND academic_year_id = ? AND term_id <=> ? AND name = ? LIMIT 1",
    [schoolId, type, academicYearId, termId, name],
  )
  if (!timetable) {
    const [result] = await connection.query(
      `INSERT INTO timetables (
        school_id, timetable_type, name, academic_year_id, term_id, cycle_type, effective_from, effective_to,
        status, setup_progress, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      [schoolId, type, name, academicYearId, termId, cycleType, effectiveFrom, effectiveTo, JSON.stringify({ seeded: true }), userId],
    )
    timetable = await one(connection, "SELECT * FROM timetables WHERE id = ?", [result.insertId])
  } else {
    await connection.query(
      `UPDATE timetables
       SET cycle_type = ?, effective_from = ?, effective_to = ?, status = 'DRAFT', setup_progress = ?
       WHERE id = ?`,
      [cycleType, effectiveFrom, effectiveTo, JSON.stringify({ seeded: true, refreshed_at: new Date().toISOString() }), timetable.id],
    )
  }

  let version = await one(connection, "SELECT * FROM timetable_versions WHERE timetable_id = ? AND version_number = 1 LIMIT 1", [timetable.id])
  if (!version) {
    const [versionResult] = await connection.query(
      `INSERT INTO timetable_versions (timetable_id, version_number, status, creation_method, configuration_snapshot, source_snapshot_hash, created_by)
       VALUES (?, 1, 'DRAFT', 'MANUAL', ?, ?, ?)`,
      [timetable.id, JSON.stringify({ seeded: true }), `seed-${type.toLowerCase()}-${Date.now()}`, userId],
    )
    version = await one(connection, "SELECT * FROM timetable_versions WHERE id = ?", [versionResult.insertId])
  } else {
    await connection.query(
      "UPDATE timetable_versions SET status = 'DRAFT', creation_method = 'MANUAL', configuration_snapshot = ? WHERE id = ?",
      [JSON.stringify({ seeded: true, refreshed_at: new Date().toISOString() }), version.id],
    )
  }
  return { timetable, version }
}

async function ensureCycleDays(connection, timetableId) {
  const idsByWeekday = new Map()
  for (const day of weekDays) {
    await connection.query(
      `INSERT INTO timetable_cycle_days (timetable_id, cycle_day_number, code, display_name, weekday, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), weekday = VALUES(weekday), sort_order = VALUES(sort_order), active = 1`,
      [timetableId, ...day],
    )
  }
  const [rows] = await connection.query("SELECT id, weekday FROM timetable_cycle_days WHERE timetable_id = ? AND active = 1", [timetableId])
  rows.forEach((row) => idsByWeekday.set(Number(row.weekday), Number(row.id)))
  return idsByWeekday
}

async function ensureBellSlots(connection, { schoolId, timetableId, templateName, slots, userId }) {
  let template = await one(
    connection,
    "SELECT * FROM bell_schedule_templates WHERE school_id = ? AND timetable_id = ? AND name = ? LIMIT 1",
    [schoolId, timetableId, templateName],
  )
  if (!template) {
    const [result] = await connection.query(
      `INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, is_default, active, created_by)
       VALUES (?, ?, ?, 'Seeded draft schedule.', 1, 1, ?)`,
      [schoolId, timetableId, templateName, userId],
    )
    template = await one(connection, "SELECT * FROM bell_schedule_templates WHERE id = ?", [result.insertId])
  }

  for (const slot of slots) {
    await connection.query(
      `INSERT INTO bell_schedule_slots (
        template_id, slot_number, code, display_name, start_time, end_time, slot_type, teaching_allowed, can_span, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE code = VALUES(code), display_name = VALUES(display_name), start_time = VALUES(start_time),
        end_time = VALUES(end_time), slot_type = VALUES(slot_type), teaching_allowed = VALUES(teaching_allowed),
        can_span = VALUES(can_span), sort_order = VALUES(sort_order)`,
      [template.id, ...slot],
    )
  }
  const [rows] = await connection.query("SELECT * FROM bell_schedule_slots WHERE template_id = ? ORDER BY sort_order", [template.id])
  return {
    template,
    slotsByCode: new Map(rows.map((row) => [row.code, row])),
    teachingSlots: rows.filter((row) => Number(row.teaching_allowed) === 1),
  }
}

async function ensureDayTemplates(connection, timetableId, cycleDayIds, templateId) {
  for (const cycleDayId of cycleDayIds.values()) {
    await connection.query(
      `INSERT INTO timetable_day_templates (timetable_id, cycle_day_id, bell_template_id, active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE bell_template_id = VALUES(bell_template_id), active = 1`,
      [timetableId, cycleDayId, templateId],
    )
  }
}

async function main() {
  const connection = await mysql.createConnection(config)
  try {
    await connection.beginTransaction()
    const school = await one(connection, "SELECT id, name FROM schools WHERE name = ? LIMIT 1", [schoolName])
    if (!school) throw new Error(`School not found: ${schoolName}`)
    const admin = await one(
      connection,
      "SELECT id FROM users WHERE school_id = ? AND role IN ('school_owner', 'headteacher') AND is_active = 1 ORDER BY FIELD(role, 'school_owner', 'headteacher'), id LIMIT 1",
      [school.id],
    )
    if (!admin) throw new Error(`No school owner/headteacher found for ${school.name}`)

    await connection.query("DELETE FROM school_facilities WHERE school_id = ? AND facility_code LIKE 'TEST-FAC-%'", [school.id])

    let examSession = await one(
      connection,
      "SELECT * FROM exam_sessions WHERE school_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
      [school.id, examSessionName],
    )
    const academicYear = examSession
      ? await one(connection, "SELECT * FROM academic_years WHERE id = ?", [examSession.academic_year_id])
      : await one(connection, "SELECT * FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY start_date DESC LIMIT 1", [school.id])
    if (!academicYear) throw new Error("No active academic year found")
    const term = examSession
      ? await one(connection, "SELECT * FROM terms WHERE id = ?", [examSession.term_id])
      : await one(connection, "SELECT * FROM terms WHERE school_id = ? AND academic_year_id = ? ORDER BY term_number LIMIT 1", [school.id, academicYear.id])
    if (!term) throw new Error("No term found for Mid Term 1")

    if (!examSession) {
      const [sessionResult] = await connection.query(
        `INSERT INTO exam_sessions (school_id, academic_year_id, term_id, name, exam_type, status, start_date, end_date, notes, created_by)
         VALUES (?, ?, ?, ?, 'mid_term', 'draft', ?, ?, 'Seeded Mid Term 1 session.', ?)`,
        [school.id, academicYear.id, term.id, examSessionName, addDays(term.start_date, 10), addDays(term.start_date, 16), admin.id],
      )
      examSession = await one(connection, "SELECT * FROM exam_sessions WHERE id = ?", [sessionResult.insertId])
    }

    const [classes] = await connection.query(
      "SELECT id, name, grade_level, teacher_user_id FROM classes WHERE school_id = ? ORDER BY CAST(REGEXP_REPLACE(name, '[^0-9]', '') AS UNSIGNED), name",
      [school.id],
    )
    const [subjects] = await connection.query(
      `SELECT id, name, code FROM subjects WHERE school_id = ? AND code IN (${coreSubjectCodes.map(() => "?").join(",")})`,
      [school.id, ...coreSubjectCodes],
    )
    const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))
    const usableSubjectCodes = coreSubjectCodes.filter((code) => subjectByCode.has(code))
    const examCodes = examSubjectCodes.filter((code) => subjectByCode.has(code))
    if (!classes.length || !usableSubjectCodes.length) throw new Error("Classes or core subjects are missing")

    const facilityByClassId = new Map()
    for (const row of classes) {
      const code = roomCodeForClass(row.name)
      await connection.query(
        `INSERT INTO school_facilities (
          school_id, facility_code, name, facility_type, facility_type_label, normal_capacity, examination_capacity,
          is_accessible, active, can_host_normal_lessons, can_host_examinations, created_by, updated_by, metadata
        ) VALUES (?, ?, ?, 'CLASSROOM', NULL, 40, 30, 1, 1, 1, 1, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), normal_capacity = VALUES(normal_capacity),
          examination_capacity = VALUES(examination_capacity), is_accessible = VALUES(is_accessible),
          can_host_normal_lessons = 1, can_host_examinations = 1, active = 1, updated_by = VALUES(updated_by)`,
        [school.id, code, `${row.name} Classroom`, admin.id, admin.id, JSON.stringify({ seeded: true, class_id: row.id })],
      )
      const facility = await one(connection, "SELECT id FROM school_facilities WHERE school_id = ? AND facility_code = ? LIMIT 1", [school.id, code])
      facilityByClassId.set(Number(row.id), facility.id)
    }

    for (const row of classes) {
      for (const code of examCodes) {
        const subject = subjectByCode.get(code)
        const existing = await one(
          connection,
          "SELECT id FROM assessments WHERE school_id = ? AND exam_session_id = ? AND class_id = ? AND subject_id = ? LIMIT 1",
          [school.id, examSession.id, row.id, subject.id],
        )
        if (!existing) {
          await connection.query(
            `INSERT INTO assessments (
              school_id, exam_session_id, class_id, subject_id, academic_year_id, term_id, teacher_id,
              name, assessment_type, term_name, total_marks, duration_minutes, expected_difficulty, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mid_term', ?, 100, 120, 'Medium', 'draft', ?)`,
            [school.id, examSession.id, row.id, subject.id, academicYear.id, term.id, row.teacher_user_id, `${row.name} ${subject.name} Exam`, term.name, admin.id],
          )
        }
      }
    }

    const schoolDraft = await ensureTimetable(connection, {
      schoolId: school.id,
      name: schoolTimetableName,
      type: "SCHOOL_TIMETABLE",
      academicYearId: academicYear.id,
      termId: term.id,
      cycleType: "NORMAL_WEEK",
      effectiveFrom: term.start_date,
      effectiveTo: term.end_date,
      userId: admin.id,
    })
    const cycleDayIds = await ensureCycleDays(connection, schoolDraft.timetable.id)
    const schoolBell = await ensureBellSlots(connection, {
      schoolId: school.id,
      timetableId: schoolDraft.timetable.id,
      templateName: "Seeded Standard School Day",
      slots: schoolSlots,
      userId: admin.id,
    })
    await ensureDayTemplates(connection, schoolDraft.timetable.id, cycleDayIds, schoolBell.template.id)
    await connection.query("DELETE FROM timetable_entries WHERE timetable_version_id = ?", [schoolDraft.version.id])

    const teachingSlots = schoolBell.teachingSlots.slice(0, 6)
    for (const classRow of classes) {
      for (let dayIndex = 0; dayIndex < weekDays.length; dayIndex += 1) {
        const cycleDayId = cycleDayIds.get(weekDays[dayIndex][3])
        for (let slotIndex = 0; slotIndex < teachingSlots.length; slotIndex += 1) {
          const code = usableSubjectCodes[(dayIndex + slotIndex) % usableSubjectCodes.length]
          const subject = subjectByCode.get(code)
          const slot = teachingSlots[slotIndex]
          await connection.query(
            `INSERT INTO timetable_entries (
              timetable_version_id, cycle_day_id, slot_start_id, slot_end_id, entry_type, subject_id, class_id,
              teacher_id, facility_id, title, locked, manually_modified, modification_reason, created_by, updated_by
            ) VALUES (?, ?, ?, ?, 'SUBJECT_LESSON', ?, ?, ?, ?, ?, 0, 1, 'Seeded class timetable draft', ?, ?)`,
            [
              schoolDraft.version.id,
              cycleDayId,
              slot.id,
              slot.id,
              subject.id,
              classRow.id,
              classRow.teacher_user_id,
              facilityByClassId.get(Number(classRow.id)),
              `${classRow.name} ${subject.name}`,
              admin.id,
              admin.id,
            ],
          )
        }
      }
    }

    const examDraft = await ensureTimetable(connection, {
      schoolId: school.id,
      name: examTimetableName,
      type: "EXAM_TIMETABLE",
      academicYearId: academicYear.id,
      termId: term.id,
      cycleType: "DATED_EXAM_SESSIONS",
      effectiveFrom: examSession.start_date,
      effectiveTo: examSession.end_date,
      userId: admin.id,
    })
    const examBell = await ensureBellSlots(connection, {
      schoolId: school.id,
      timetableId: examDraft.timetable.id,
      templateName: "Seeded Exam Day Sessions",
      slots: examSlots,
      userId: admin.id,
    })
    await connection.query("DELETE FROM timetable_entries WHERE timetable_version_id = ?", [examDraft.version.id])

    const [examAssessments] = await connection.query(
      `SELECT a.*, s.code AS subject_code, s.name AS subject_name, c.name AS class_name, c.teacher_user_id
       FROM assessments a
       JOIN subjects s ON s.id = a.subject_id AND s.school_id = a.school_id
       JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       WHERE a.school_id = ? AND a.exam_session_id = ? AND s.code IN (${examCodes.map(() => "?").join(",")})
       ORDER BY FIELD(s.code, ${examCodes.map(() => "?").join(",")}), c.name`,
      [school.id, examSession.id, ...examCodes, ...examCodes],
    )
    const amSlot = examBell.slotsByCode.get("AM") || examBell.teachingSlots[0]
    await connection.query("DELETE FROM exam_timetable_entries WHERE school_id = ? AND exam_session_id = ?", [school.id, examSession.id])
    for (const assessment of examAssessments) {
      const examDate = addDays(examSession.start_date, examDayByCode[assessment.subject_code] ?? 0)
      const facilityId = facilityByClassId.get(Number(assessment.class_id))
      await connection.query(
        `INSERT INTO timetable_entries (
          timetable_version_id, calendar_date, slot_start_id, slot_end_id, entry_type, subject_id, class_id, teacher_id,
          facility_id, assessment_id, exam_session_id, title, locked, manually_modified, modification_reason, created_by, updated_by
        ) VALUES (?, ?, ?, ?, 'EXAM_PAPER', ?, ?, ?, ?, ?, ?, ?, 1, 1, 'Seeded Mid Term 1 exam timetable draft', ?, ?)`,
        [
          examDraft.version.id,
          examDate,
          amSlot.id,
          amSlot.id,
          assessment.subject_id,
          assessment.class_id,
          assessment.teacher_user_id,
          facilityId,
          assessment.id,
          examSession.id,
          assessment.name,
          admin.id,
          admin.id,
        ],
      )
      await connection.query(
        `INSERT INTO exam_timetable_entries (
          school_id, exam_session_id, assessment_id, academic_year_id, term_id, class_id, subject_id, exam_date,
          start_time, end_time, facility_id, room, invigilator_teacher_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
        [
          school.id,
          examSession.id,
          assessment.id,
          academicYear.id,
          term.id,
          assessment.class_id,
          assessment.subject_id,
          examDate,
          amSlot.start_time,
          amSlot.end_time,
          facilityId,
          `${assessment.class_name} Classroom`,
          assessment.teacher_user_id,
        ],
      )
    }

    await connection.commit()
    console.log(JSON.stringify({
      school: school.name,
      school_timetable: { id: schoolDraft.timetable.id, version_id: schoolDraft.version.id, entries: classes.length * weekDays.length * teachingSlots.length },
      exam_timetable: { id: examDraft.timetable.id, version_id: examDraft.version.id, entries: examAssessments.length },
      exam_session: { id: examSession.id, name: examSession.name, entries: examAssessments.length },
      facilities_ready: facilityByClassId.size,
    }, null, 2))
  } catch (error) {
    await connection.rollback()
    console.error(error)
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}

main()

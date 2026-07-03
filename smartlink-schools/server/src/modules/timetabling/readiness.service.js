import { pool } from "../../config/db.js"

function check(code, level, message, step = "setup", metadata = {}) {
  return { code, level, message, step, metadata, blocking: level === "error" }
}

export async function runTimetableReadinessAudit(connection = pool, schoolId, timetable, version = null) {
  const checks = []
  const [[context]] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM timetable_cycle_days WHERE timetable_id = ? AND active = 1) AS cycle_days,
      (SELECT COUNT(*) FROM bell_schedule_templates WHERE school_id = ? AND (timetable_id = ? OR timetable_id IS NULL) AND active = 1) AS bell_templates,
      (SELECT COUNT(*)
       FROM bell_schedule_slots s
       JOIN bell_schedule_templates b ON b.id = s.template_id
       WHERE b.school_id = ? AND (b.timetable_id = ? OR b.timetable_id IS NULL) AND b.active = 1 AND s.teaching_allowed = 1) AS teaching_slots,
      (SELECT COUNT(*)
       FROM curriculum_period_requirements
       WHERE school_id = ? AND academic_year_id = ? AND (term_id IS NULL OR term_id = ?) AND (timetable_id IS NULL OR timetable_id = ?) AND active = 1) AS requirements,
      (SELECT COUNT(*) FROM school_facilities WHERE school_id = ? AND active = 1 AND can_host_normal_lessons = 1) AS rooms,
      (SELECT COUNT(*) FROM classes WHERE school_id = ?) AS classes,
      (SELECT COUNT(*) FROM subjects WHERE school_id = ?) AS subjects,
      (SELECT COUNT(*) FROM teacher_class_subject_assignments WHERE school_id = ? AND is_active = 1) AS teacher_assignments`,
    [
      timetable.id,
      schoolId,
      timetable.id,
      schoolId,
      timetable.id,
      schoolId,
      timetable.academic_year_id,
      timetable.term_id,
      timetable.id,
      schoolId,
      schoolId,
      schoolId,
      schoolId,
    ],
  )

  if (!timetable.academic_year_id) checks.push(check("MISSING_ACADEMIC_YEAR", "error", "Select an academic year for this timetable.", "basic-information"))
  if (timetable.timetable_type === "SCHOOL_TIMETABLE" && !timetable.term_id) checks.push(check("MISSING_TERM", "error", "Select a term for the school timetable.", "basic-information"))
  if (!timetable.effective_from || !timetable.effective_to) checks.push(check("MISSING_EFFECTIVE_DATES", "error", "Set the timetable effective start and end dates.", "basic-information"))
  if (timetable.effective_from && timetable.effective_to && String(timetable.effective_to) < String(timetable.effective_from)) {
    checks.push(check("INVALID_EFFECTIVE_RANGE", "error", "The timetable end date must be after the start date.", "basic-information"))
  }

  if (timetable.timetable_type === "SCHOOL_TIMETABLE") {
    if (!Number(context.cycle_days || 0)) checks.push(check("NO_CYCLE_DAYS", "error", "Add at least one active teaching day to the timetable cycle.", "school-week"))
    if (!Number(context.bell_templates || 0)) checks.push(check("NO_BELL_TEMPLATE", "error", "Create a bell schedule template before generation.", "school-week"))
    if (!Number(context.teaching_slots || 0)) checks.push(check("NO_TEACHING_SLOTS", "error", "Add teaching periods to the bell schedule.", "school-week"))
    if (!Number(context.classes || 0)) checks.push(check("NO_CLASSES", "error", "Create or select active classes for this school.", "classes-groups"))
    if (!Number(context.subjects || 0)) checks.push(check("NO_SUBJECTS", "error", "Create subjects before building curriculum requirements.", "curriculum"))
    if (!Number(context.teacher_assignments || 0)) checks.push(check("NO_TEACHER_ASSIGNMENTS", "warning", "Teacher class-subject assignments are missing; generation may be infeasible.", "teacher-allocation"))
    if (!Number(context.requirements || 0)) checks.push(check("NO_CURRICULUM_REQUIREMENTS", "error", "Add curriculum period requirements before automatic generation.", "curriculum"))
    if (!Number(context.rooms || 0)) checks.push(check("NO_FACILITIES", "warning", "No shared facilities are configured. Manual entries can be saved without facilities, but facility conflicts cannot be audited.", "rooms-resources"))

    const [overloadedClasses] = await connection.query(
      `SELECT c.id, c.name, COALESCE(SUM(r.periods_per_cycle), 0) AS required_periods
       FROM classes c
       JOIN curriculum_period_requirements r ON r.class_id = c.id AND r.school_id = c.school_id
        AND r.academic_year_id = ? AND (r.term_id IS NULL OR r.term_id = ?) AND (r.timetable_id IS NULL OR r.timetable_id = ?) AND r.active = 1
       WHERE c.school_id = ?
       GROUP BY c.id, c.name
       HAVING required_periods > ?`,
      [timetable.academic_year_id, timetable.term_id, timetable.id, schoolId, Math.max(0, Number(context.cycle_days || 0) * Number(context.teaching_slots || 0))],
    )
    overloadedClasses.forEach((row) => {
      checks.push(check(
        "CLASS_PERIOD_DEMAND_EXCEEDS_CAPACITY",
        "error",
        `${row.name} requires ${Number(row.required_periods)} teaching periods, but the configured cycle has only ${Number(context.cycle_days || 0) * Number(context.teaching_slots || 0)} usable periods.`,
        "curriculum",
        { class_id: Number(row.id) },
      ))
    })
  } else {
    const [[examContext]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM exam_sessions WHERE school_id = ? AND academic_year_id = ? AND (? IS NULL OR term_id = ?)) AS exam_sessions,
        (SELECT COUNT(*) FROM assessments WHERE school_id = ? AND academic_year_id = ? AND (? IS NULL OR term_id = ?) AND assessment_type IN ('mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam') AND status <> 'archived') AS papers`,
      [schoolId, timetable.academic_year_id, timetable.term_id, timetable.term_id, schoolId, timetable.academic_year_id, timetable.term_id, timetable.term_id],
    )
    if (!Number(examContext.exam_sessions || 0)) checks.push(check("NO_EXAM_SERIES", "error", "Create an examination session before building an exam timetable.", "exam-series"))
    if (!Number(examContext.papers || 0)) checks.push(check("NO_EXAM_PAPERS", "error", "Create approved exam papers before scheduling examination sessions.", "exam-papers"))
    if (!Number(context.rooms || 0)) checks.push(check("NO_EXAM_FACILITIES", "warning", "No shared exam facilities are configured yet. Exam room allocation will be incomplete.", "exam-rooms"))
  }

  if (version) {
    const [[entryStats]] = await connection.query(
      `SELECT COUNT(*) AS entries
       FROM timetable_entries
       WHERE timetable_version_id = ?`,
      [version.id],
    )
    if (Number(entryStats.entries || 0) === 0 && ["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(version.status)) {
      checks.push(check("EMPTY_VERSION", "warning", "This version has no timetable entries yet.", "editor"))
    }
  }

  const errors = checks.filter((item) => item.level === "error")
  const warnings = checks.filter((item) => item.level === "warning")
  const passed = [
    check("TENANCY_SCOPE", "passed", "Timetable belongs to the authenticated school scope.", "security"),
    ...(errors.length ? [] : [check("MANDATORY_READINESS", "passed", "Mandatory timetable setup checks passed.", "feasibility-audit")]),
  ]

  return {
    ready: errors.length === 0,
    passed,
    errors,
    warnings,
    checks: [...passed, ...errors, ...warnings],
  }
}

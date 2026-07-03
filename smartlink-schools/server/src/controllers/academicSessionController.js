import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassSubjectPairs, isTeacher } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

function normalizeDate(value, label) {
  const text = String(value || "").trim()
  if (!text) throw new HttpError(400, `${label} is required`)
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} must be a valid date`)
  return text.slice(0, 10)
}

const DEFAULT_PROGRESSION_POLICY = {
  minimum_average: 50,
  enforce_threshold: true,
}

function dateOnly(value) {
  if (!value) return null
  return String(value).slice(0, 10)
}

function weeksBetween(startDate, endDate) {
  const start = new Date(dateOnly(startDate))
  const end = new Date(dateOnly(endDate))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  return Number((days / 7).toFixed(1))
}

function teacherPairsClause(pairs, classColumn = "a.class_id", subjectColumn = "a.subject_id") {
  if (!Array.isArray(pairs)) return { clause: "", params: [] }
  if (!pairs.length) return { clause: " AND 1 = 0", params: [] }
  return {
    clause: ` AND (${pairs.map(() => `(${classColumn} = ? AND ${subjectColumn} = ?)`).join(" OR ")})`,
    params: pairs.flatMap((pair) => [pair.classId, pair.subjectId]),
  }
}

function parseSettingValue(value) {
  if (!value) return {}
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return {}
  }
}

function normalizeProgressionPolicy(value) {
  const parsed = parseSettingValue(value)
  const rawAverage = Number(parsed.minimum_average ?? parsed.minimumAverage ?? DEFAULT_PROGRESSION_POLICY.minimum_average)
  const minimumAverage = Number.isFinite(rawAverage) ? Math.min(100, Math.max(0, rawAverage)) : DEFAULT_PROGRESSION_POLICY.minimum_average
  return {
    minimum_average: Number(minimumAverage.toFixed(1)),
    enforce_threshold: parsed.enforce_threshold === undefined ? true : Boolean(parsed.enforce_threshold),
  }
}

async function getProgressionPolicyForSchool(connection, schoolId) {
  const [[row]] = await connection.query(
    "SELECT setting_value FROM school_settings WHERE school_id = ? AND setting_key = 'progression_policy' LIMIT 1",
    [schoolId],
  )
  return normalizeProgressionPolicy(row?.setting_value)
}

async function saveProgressionPolicyForSchool(connection, schoolId, policy) {
  const normalized = normalizeProgressionPolicy(policy)
  await connection.query(
    `INSERT INTO school_settings (school_id, setting_key, setting_value)
     VALUES (?, 'progression_policy', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [schoolId, JSON.stringify(normalized)],
  )
  return normalized
}

async function buildTermWarnings(connection, schoolId, termId) {
  const [[drafts]] = await connection.query(
    "SELECT COUNT(*) AS total FROM result_batches WHERE school_id = ? AND term_id = ? AND status = 'draft'",
    [schoolId, termId],
  )
  const [[submitted]] = await connection.query(
    "SELECT COUNT(*) AS total FROM result_batches WHERE school_id = ? AND term_id = ? AND status = 'submitted'",
    [schoolId, termId],
  )
  const [[returned]] = await connection.query(
    "SELECT COUNT(*) AS total FROM result_batches WHERE school_id = ? AND term_id = ? AND status = 'returned'",
    [schoolId, termId],
  )
  const [[examSessions]] = await connection.query(
    "SELECT COUNT(*) AS total FROM exam_sessions WHERE school_id = ? AND term_id = ? AND status <> 'archived'",
    [schoolId, termId],
  )
  const [[draftExamPapers]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM assessments
     WHERE school_id = ? AND term_id = ?
       AND assessment_type IN ('mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam')
       AND status IN ('draft', 'open', 'ready_for_review', 'returned')`,
    [schoolId, termId],
  )
  const [[unapprovedExamPapers]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM assessments
     WHERE school_id = ? AND term_id = ?
       AND assessment_type IN ('mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam')
       AND status NOT IN ('results_approved', 'locked', 'archived')`,
    [schoolId, termId],
  )
  const [missingRows] = await connection.query(
    `SELECT a.id, a.name, c.name AS class_name, subj.name AS subject_name
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     WHERE a.school_id = ? AND a.term_id = ? AND rb.id IS NULL
     ORDER BY c.name, subj.name, a.name
     LIMIT 20`,
    [schoolId, termId],
  )
  const [missingMarkRows] = await connection.query(
    `SELECT a.id, a.name, c.name AS class_name, subj.name AS subject_name,
      COUNT(DISTINCT se.student_id) AS expected_students,
      COUNT(DISTINCT CASE WHEN re.score IS NOT NULL THEN re.student_id END) AS marked_students
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN student_enrollments se ON se.school_id = a.school_id
       AND se.academic_year_id = a.academic_year_id
       AND se.term_id = a.term_id
       AND se.class_id = a.class_id
       AND se.enrollment_status = 'active'
     LEFT JOIN result_batches rb ON rb.school_id = a.school_id AND rb.assessment_id = a.id
     LEFT JOIN result_entries re ON re.school_id = rb.school_id AND re.result_batch_id = rb.id AND re.student_id = se.student_id
     WHERE a.school_id = ? AND a.term_id = ?
       AND a.assessment_type IN ('mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam')
     GROUP BY a.id, a.name, c.name, subj.name
     HAVING expected_students > marked_students
     ORDER BY c.name, subj.name, a.name
     LIMIT 20`,
    [schoolId, termId],
  )
  return {
    draft_batches: Number(drafts?.total || 0),
    submitted_unapproved_batches: Number(submitted?.total || 0),
    returned_batches: Number(returned?.total || 0),
    exam_sessions: Number(examSessions?.total || 0),
    draft_exam_papers: Number(draftExamPapers?.total || 0),
    unapproved_exam_papers: Number(unapprovedExamPapers?.total || 0),
    missing_result_batches: missingRows.length,
    missing_result_examples: missingRows,
    missing_exam_marks: missingMarkRows.reduce((sum, row) => sum + Math.max(0, Number(row.expected_students || 0) - Number(row.marked_students || 0)), 0),
    missing_exam_mark_examples: missingMarkRows.map((row) => ({
      ...row,
      missing_marks: Math.max(0, Number(row.expected_students || 0) - Number(row.marked_students || 0)),
    })),
  }
}

async function carryForwardEnrollments(connection, schoolId, fromTermId, toAcademicYearId, toTermId, startDate) {
  const [[eligible]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     WHERE se.school_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       AND s.status = 'active'`,
    [schoolId, fromTermId],
  )
  const [result] = await connection.query(
    `INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, term_id, class_id, stream_section,
      enrollment_type, enrollment_status, start_date
    )
    SELECT se.school_id, se.student_id, ?, ?, se.class_id, se.stream_section, 'continued', 'active', ?
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
    WHERE se.school_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
      AND s.status = 'active'
    ON DUPLICATE KEY UPDATE class_id = VALUES(class_id),
      stream_section = VALUES(stream_section),
      enrollment_type = VALUES(enrollment_type),
      enrollment_status = VALUES(enrollment_status),
      start_date = VALUES(start_date)`,
    [toAcademicYearId, toTermId, startDate, schoolId, fromTermId],
  )
  return { eligible: Number(eligible?.total || 0), touched: Number(result.affectedRows || 0) }
}

async function carryForwardTeacherAssignments(connection, schoolId, fromTermId, toAcademicYearId, toTermId) {
  const [[target]] = await connection.query(
    `SELECT t.id, t.name AS term_name, CAST(YEAR(ay.start_date) AS CHAR) AS academic_year_label
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.id = ? AND t.school_id = ? AND t.academic_year_id = ?
     LIMIT 1`,
    [toTermId, schoolId, toAcademicYearId],
  )
  if (!target) throw new HttpError(400, "Target term does not belong to the selected academic year")

  const [[eligible]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM teacher_class_subject_assignments
     WHERE school_id = ? AND term_id = ? AND is_active = 1`,
    [schoolId, fromTermId],
  )

  const [result] = await connection.query(
    `INSERT INTO teacher_class_subject_assignments (
      school_id, teacher_id, class_id, subject_id, stream_section,
      academic_year_id, term_id, academic_year, term, role, is_active, notes
    )
    SELECT a.school_id, a.teacher_id, a.class_id, a.subject_id, a.stream_section,
      ?, ?, ?, ?, a.role, 1, a.notes
    FROM teacher_class_subject_assignments a
    WHERE a.school_id = ? AND a.term_id = ? AND a.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM teacher_class_subject_assignments existing
        WHERE existing.school_id = a.school_id
          AND existing.academic_year_id = ?
          AND existing.term_id = ?
          AND existing.class_id = a.class_id
          AND existing.role = a.role
          AND COALESCE(existing.subject_id, 0) = COALESCE(a.subject_id, 0)
          AND existing.is_active = 1
        LIMIT 1
      )`,
    [
      toAcademicYearId,
      toTermId,
      target.academic_year_label,
      target.term_name,
      schoolId,
      fromTermId,
      toAcademicYearId,
      toTermId,
    ],
  )

  return { eligible: Number(eligible?.total || 0), touched: Number(result.affectedRows || 0) }
}

async function findPreviousProgressionSourceYear(connection, schoolId, targetAcademicYearId, targetStartDate) {
  const [[year]] = await connection.query(
    `SELECT ay.id, COUNT(DISTINCT se.student_id) AS active_enrollments
     FROM academic_years ay
     JOIN terms t ON t.school_id = ay.school_id
       AND t.academic_year_id = ay.id
       AND t.status IN ('open', 'marking', 'closed', 'archived')
     JOIN student_enrollments se ON se.school_id = t.school_id
       AND se.term_id = t.id
       AND se.enrollment_status = 'active'
     JOIN students s ON s.id = se.student_id
       AND s.school_id = se.school_id
       AND s.status = 'active'
     WHERE ay.school_id = ?
       AND ay.id <> ?
       AND ay.start_date < ?
     GROUP BY ay.id
     HAVING active_enrollments > 0
     ORDER BY ay.start_date DESC, MAX(t.term_number) DESC, MAX(t.end_date) DESC, ay.id DESC
     LIMIT 1`,
    [schoolId, targetAcademicYearId, targetStartDate],
  )
  return year || null
}

async function getTermOrThrow(connection, schoolId, termId) {
  const [[term]] = await connection.query(
    `SELECT t.*, ay.name AS academic_year_name, ay.start_date AS academic_year_start_date, ay.end_date AS academic_year_end_date
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.id = ? AND t.school_id = ?
     LIMIT 1`,
    [termId, schoolId],
  )
  if (!term) throw new HttpError(404, "Term was not found")
  return term
}

async function inferProgressionTargetTerm(connection, schoolId, sourceTerm, requestedTermId = null) {
  if (requestedTermId) {
    const [[target]] = await connection.query(
      `SELECT t.*, ay.name AS academic_year_name
       FROM terms t
       JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
       WHERE t.id = ? AND t.school_id = ?
       LIMIT 1`,
      [requestedTermId, schoolId],
    )
    if (!target) throw new HttpError(400, "Target term was not found")
    return target
  }

  const [[target]] = await connection.query(
    `SELECT t.*, ay.name AS academic_year_name
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = t.school_id
     WHERE t.school_id = ?
       AND t.id <> ?
       AND t.status IN ('open', 'marking')
       AND (ay.start_date > ? OR t.start_date > ?)
     ORDER BY ay.start_date ASC, t.term_number ASC, t.start_date ASC, t.id ASC
     LIMIT 1`,
    [schoolId, sourceTerm.id, sourceTerm.academic_year_start_date || sourceTerm.start_date, sourceTerm.start_date],
  )
  return target || null
}

function summarizeProgressionClasses(rows) {
  const byClass = new Map()
  rows.forEach((row) => {
    const id = Number(row.from_class_id)
    const current = byClass.get(id) || {
      id,
      name: row.from_class_name,
      total: 0,
      approved: 0,
      flagged: 0,
      pending: 0,
    }
    current.total += 1
    if (row.approved_decision) current.approved += 1
    else current.pending += 1
    if (row.progression_flag === "below_threshold") current.flagged += 1
    byClass.set(id, current)
  })
  return [...byClass.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
}

async function buildProgressionPreviewRows(connection, schoolId, fromAcademicYearId, toAcademicYearId, targetTermId, options = {}) {
  const policy = await getProgressionPolicyForSchool(connection, schoolId)
  let sourceTerm
  if (options.sourceTermId) {
    const [[exactTerm]] = await connection.query(
      `SELECT t.*, COUNT(DISTINCT CASE WHEN se.enrollment_status = 'active' AND s.status = 'active' THEN se.student_id END) AS active_enrollments
       FROM terms t
       LEFT JOIN student_enrollments se ON se.school_id = t.school_id AND se.term_id = t.id
       LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       WHERE t.school_id = ? AND t.academic_year_id = ? AND t.id = ?
       GROUP BY t.id
       LIMIT 1`,
      [schoolId, fromAcademicYearId, Number(options.sourceTermId)],
    )
    sourceTerm = exactTerm
  } else {
    const [[latestTerm]] = await connection.query(
      `SELECT t.*, COUNT(DISTINCT CASE WHEN se.enrollment_status = 'active' AND s.status = 'active' THEN se.student_id END) AS active_enrollments
       FROM terms t
       LEFT JOIN student_enrollments se ON se.school_id = t.school_id AND se.term_id = t.id
       LEFT JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       WHERE t.school_id = ? AND t.academic_year_id = ? AND t.status IN ('open', 'marking', 'closed', 'archived')
       GROUP BY t.id
       ORDER BY (COUNT(DISTINCT CASE WHEN se.enrollment_status = 'active' AND s.status = 'active' THEN se.student_id END) > 0) DESC,
         t.term_number DESC, t.end_date DESC, t.id DESC
       LIMIT 1`,
      [schoolId, fromAcademicYearId],
    )
    sourceTerm = latestTerm
  }
  if (!sourceTerm) return { sourceTerm: null, rows: [] }

  const [rows] = await connection.query(
    `SELECT se.student_id, se.class_id AS from_class_id, se.stream_section,
      s.first_name, s.last_name, COALESCE(s.student_id, s.admission_no) AS student_code,
      s.status AS student_status, c.name AS from_class_name,
      r.id AS rule_id, r.to_class_id, r.is_terminal_class, r.default_decision,
      next_c.name AS to_class_name,
      COALESCE(pd_target.decision, pd_preapproved.decision) AS approved_decision,
      COALESCE(pd_target.to_class_id, pd_preapproved.to_class_id) AS approved_to_class_id,
      COALESCE(pd_target.reason, pd_preapproved.reason) AS approved_reason,
      COALESCE(pd_target.approved_at, pd_preapproved.approved_at) AS progression_approved_at,
      approved_c.name AS approved_to_class_name,
      MAX(CASE WHEN tr.status IN ('generated', 'approved', 'locked') THEN tr.average_score END) AS official_average_score,
      COUNT(DISTINCT CASE WHEN tr.status IN ('generated', 'approved', 'locked') THEN sr.id END) AS official_subject_results,
      COUNT(DISTINCT CASE WHEN tr.status IN ('generated', 'approved', 'locked') AND sr.score IS NOT NULL THEN sr.id END) AS official_marked_subjects,
      COUNT(DISTINCT CASE WHEN rc.status IN ('generated', 'approved', 'locked') THEN rc.id END) AS official_report_cards,
      ROUND(AVG(CASE WHEN rb.status IN ('approved', 'locked') AND re.score IS NOT NULL THEN (re.score / NULLIF(a.total_marks, 0)) * 100 END), 1) AS average_score,
      COUNT(DISTINCT a.id) AS expected_assessments,
      COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND rb.id IS NULL THEN a.id END) AS missing_result_batches,
      COUNT(DISTINCT CASE WHEN rb.id IS NOT NULL AND rb.status NOT IN ('approved', 'locked') THEN rb.id END) AS pending_batches,
      COUNT(DISTINCT CASE WHEN rb.status IN ('approved', 'locked') THEN rb.id END) AS completed_batches,
      COUNT(DISTINCT CASE WHEN rb.status IN ('approved', 'locked') AND re.score IS NOT NULL THEN rb.id END) AS marked_completed_batches,
      COUNT(DISTINCT CASE WHEN re.score IS NOT NULL THEN re.id END) AS result_entries
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     LEFT JOIN class_progression_rules r ON r.school_id = se.school_id AND r.from_class_id = se.class_id AND r.is_active = 1
     LEFT JOIN classes next_c ON next_c.id = r.to_class_id AND next_c.school_id = r.school_id
     LEFT JOIN promotion_decisions pd_target ON pd_target.school_id = se.school_id
       AND pd_target.student_id = se.student_id
       AND pd_target.from_academic_year_id = ?
       AND pd_target.to_academic_year_id = ?
     LEFT JOIN promotion_decisions pd_preapproved ON pd_preapproved.school_id = se.school_id
       AND pd_preapproved.student_id = se.student_id
       AND pd_preapproved.from_academic_year_id = ?
       AND pd_preapproved.to_academic_year_id = ?
     LEFT JOIN classes approved_c ON approved_c.id = COALESCE(pd_target.to_class_id, pd_preapproved.to_class_id)
       AND approved_c.school_id = se.school_id
     LEFT JOIN term_results tr ON tr.school_id = se.school_id
       AND tr.student_id = se.student_id
       AND tr.academic_year_id = se.academic_year_id
       AND tr.term_id = se.term_id
       AND tr.class_id = se.class_id
       AND (tr.enrollment_id = se.id OR tr.enrollment_id IS NULL)
       AND tr.status IN ('generated', 'approved', 'locked')
     LEFT JOIN subject_results sr ON sr.school_id = tr.school_id
       AND sr.term_result_id = tr.id
     LEFT JOIN report_cards rc ON rc.school_id = se.school_id
       AND rc.term_result_id = tr.id
       AND rc.status IN ('generated', 'approved', 'locked')
     LEFT JOIN assessments a ON a.school_id = se.school_id
       AND a.term_id = se.term_id
       AND a.class_id = se.class_id
       AND a.status <> 'archived'
       AND (a.stream_section IS NULL OR se.stream_section IS NULL OR a.stream_section = se.stream_section)
     LEFT JOIN result_batches rb ON rb.school_id = se.school_id
       AND rb.assessment_id = a.id
       AND rb.class_id = se.class_id
     LEFT JOIN result_entries re ON re.school_id = rb.school_id AND re.result_batch_id = rb.id AND re.student_id = se.student_id
     WHERE se.school_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
       AND s.status = 'active'
     GROUP BY se.student_id, se.class_id, se.stream_section, s.student_id, s.admission_no, s.first_name, s.last_name, student_code,
       s.status, c.name, r.id, r.to_class_id, r.is_terminal_class, r.default_decision, next_c.name,
       pd_target.decision, pd_target.to_class_id, pd_target.reason, pd_target.approved_at,
       pd_preapproved.decision, pd_preapproved.to_class_id, pd_preapproved.reason, pd_preapproved.approved_at,
       approved_c.name
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [fromAcademicYearId, toAcademicYearId, fromAcademicYearId, fromAcademicYearId, schoolId, sourceTerm.id],
  )

  return {
    sourceTerm,
    rows: rows.map((row) => {
      const officialAverageScore = row.official_average_score === null ? null : Number(row.official_average_score)
      const entryAverageScore = row.average_score === null ? null : Number(row.average_score)
      const officialMarkedSubjects = Number(row.official_marked_subjects || 0)
      const officialReportCards = Number(row.official_report_cards || 0)
      const hasOfficialResult = officialAverageScore !== null && (officialMarkedSubjects > 0 || officialReportCards > 0)
      const averageScore = hasOfficialResult ? officialAverageScore : entryAverageScore
      const expectedAssessments = Number(row.expected_assessments || 0)
      const missingResultBatches = Number(row.missing_result_batches || 0)
      const pendingBatches = Number(row.pending_batches || 0)
      const markedCompletedBatches = Number(row.marked_completed_batches || 0)
      const resultStatus = hasOfficialResult
        ? "complete"
        : expectedAssessments === 0 || markedCompletedBatches === 0
          ? "no_results"
          : missingResultBatches > 0 || pendingBatches > 0 || markedCompletedBatches < expectedAssessments
            ? "pending_results"
            : "complete"
      const belowThreshold = resultStatus === "complete"
        && policy.enforce_threshold
        && averageScore !== null
        && averageScore < Number(policy.minimum_average)
      let suggestedDecision = "pending_review"
      let finalStatus = "pending_review"
      let reason = ""
      let progressionFlag = ""
      let requiresOverrideReason = false
      let suggestedToClassId = row.to_class_id || null
      let suggestedToClassName = row.to_class_name || null

      if (resultStatus !== "complete") {
        reason = resultStatus === "no_results"
          ? "No completed result history found."
          : "Some assessments are missing completed marks or approval."
      } else if (belowThreshold) {
        suggestedDecision = "repeated"
        finalStatus = "active"
        suggestedToClassId = row.from_class_id
        suggestedToClassName = row.from_class_name
        progressionFlag = "below_threshold"
        requiresOverrideReason = true
        reason = `Average below minimum promotion threshold (${averageScore}% < ${policy.minimum_average}%).`
      } else if (Number(row.is_terminal_class || 0) || row.default_decision === "graduate") {
        suggestedDecision = "graduated"
        finalStatus = "graduated"
        reason = "Terminal class progression rule."
      } else if (row.to_class_id) {
        suggestedDecision = "promoted"
        finalStatus = "active"
        reason = "Progression rule found."
      } else {
        reason = "No progression rule configured for this class."
      }

      return {
        ...row,
        source_term_id: sourceTerm.id,
        to_academic_year_id: toAcademicYearId,
        target_term_id: targetTermId,
        average_score: averageScore,
        minimum_average: policy.minimum_average,
        expected_assessments: expectedAssessments,
        official_subject_results: Number(row.official_subject_results || 0),
        official_marked_subjects: officialMarkedSubjects,
        official_report_cards: officialReportCards,
        missing_result_batches: missingResultBatches,
        pending_batches: pendingBatches,
        marked_completed_batches: markedCompletedBatches,
        rule_to_class_id: row.to_class_id || null,
        rule_to_class_name: row.to_class_name || null,
        to_class_id: suggestedToClassId,
        to_class_name: suggestedToClassName,
        approved_decision: row.approved_decision || null,
        approved_to_class_id: row.approved_to_class_id || null,
        approved_to_class_name: row.approved_to_class_name || null,
        approved_reason: row.approved_reason || null,
        progression_approved_at: row.progression_approved_at || null,
        approval_status: row.approved_decision ? "approved" : "pending",
        result_status: resultStatus,
        suggested_decision: suggestedDecision,
        final_status: finalStatus,
        progression_flag: progressionFlag,
        requires_override_reason: requiresOverrideReason,
        reason,
      }
    }),
  }
}

async function applyProgressionRows(connection, schoolId, fromAcademicYearId, toAcademicYearId, targetTermId, options = {}) {
  const recordOnly = Boolean(options.recordOnly)
  let targetTerm = null
  if (!recordOnly) {
    const [[row]] = await connection.query(
      "SELECT id, start_date FROM terms WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1",
      [targetTermId, schoolId, toAcademicYearId],
    )
    targetTerm = row || null
    if (!targetTerm) throw new HttpError(400, "Target term does not belong to the selected academic year")
  }

  const preview = await buildProgressionPreviewRows(connection, schoolId, fromAcademicYearId, toAcademicYearId, targetTermId, {
    sourceTermId: options.sourceTermId,
  })
  const overrides = new Map((options.overrides || []).map((row) => [Number(row.student_id), row]))
  const classId = options.classId ? Number(options.classId) : null
  const rowsToApply = classId ? preview.rows.filter((row) => Number(row.from_class_id) === classId) : preview.rows
  if (!recordOnly && options.requireApproved) {
    const pendingApprovalRows = rowsToApply.filter((row) => !row.approved_decision)
    if (pendingApprovalRows.length) {
      const classNames = [...new Set(pendingApprovalRows.map((row) => row.from_class_name).filter(Boolean))]
      const classText = classNames.length ? ` (${classNames.join(", ")})` : ""
      throw new HttpError(
        409,
        `Approve progression for all classes before opening the next academic year term. ${pendingApprovalRows.length} learner${pendingApprovalRows.length === 1 ? "" : "s"} still pending${classText}.`,
      )
    }
  }
  let promoted = 0
  let repeated = 0
  let graduated = 0
  let pendingReview = 0

  for (const baseRow of rowsToApply) {
    const override = overrides.get(Number(baseRow.student_id)) || {}
    const decision = override.decision || baseRow.approved_decision || baseRow.suggested_decision
    if (!["promoted", "repeated", "graduated", "transferred_out", "withdrawn", "suspended", "pending_review"].includes(decision)) {
      throw new HttpError(400, "Promotion decision is invalid")
    }
    const configuredNextClassId = baseRow.approved_to_class_id || baseRow.rule_to_class_id || baseRow.to_class_id
    const toClassId = override.to_class_id
      ? Number(override.to_class_id)
      : decision === "repeated"
        ? baseRow.from_class_id
        : ["graduated", "transferred_out", "withdrawn", "suspended", "pending_review"].includes(decision)
          ? null
          : configuredNextClassId
    if (decision === "promoted" && !toClassId) {
      const studentName = `${baseRow.first_name || ""} ${baseRow.last_name || ""}`.trim() || baseRow.student_code || "This learner"
      throw new HttpError(400, `${studentName} needs a next class before promotion.`)
    }
    const overrideReason = String(override.reason || "").trim()
    if (baseRow.progression_flag === "below_threshold" && ["promoted", "graduated"].includes(decision) && !overrideReason) {
      const studentName = `${baseRow.first_name || ""} ${baseRow.last_name || ""}`.trim() || baseRow.student_code || "This learner"
      throw new HttpError(400, `${studentName} is below the minimum promotion average. Add a reason before overriding the repeat recommendation.`)
    }
    const reason = baseRow.progression_flag === "below_threshold" && ["promoted", "graduated"].includes(decision)
      ? `Below-threshold override: ${overrideReason}`
      : overrideReason || baseRow.reason

    await connection.query(
      `INSERT INTO promotion_decisions (
        school_id, student_id, from_academic_year_id, to_academic_year_id, from_class_id, to_class_id,
        decision, recommended_decision, reason, approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE to_class_id = VALUES(to_class_id),
        decision = VALUES(decision),
        recommended_decision = VALUES(recommended_decision),
        reason = VALUES(reason),
        approved_by = VALUES(approved_by),
        approved_at = CURRENT_TIMESTAMP`,
      [
        schoolId,
        baseRow.student_id,
        fromAcademicYearId,
        toAcademicYearId,
        baseRow.from_class_id,
        toClassId || null,
        decision,
        baseRow.suggested_decision,
        reason,
        options.approvedBy || null,
      ],
    )

    if (recordOnly) {
      if (decision === "promoted") promoted += 1
      else if (decision === "repeated") repeated += 1
      else if (decision === "graduated") graduated += 1
      else if (decision === "pending_review") pendingReview += 1
      continue
    }

    if (decision === "promoted" && toClassId) {
      await connection.query(
        `INSERT INTO student_enrollments (
          school_id, student_id, academic_year_id, term_id, class_id, stream_section,
          enrollment_type, enrollment_status, start_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'promoted', 'active', ?)
        ON DUPLICATE KEY UPDATE class_id = VALUES(class_id),
          stream_section = VALUES(stream_section),
          enrollment_type = VALUES(enrollment_type),
          enrollment_status = 'active',
          start_date = VALUES(start_date)`,
        [schoolId, baseRow.student_id, toAcademicYearId, targetTermId, toClassId, baseRow.stream_section, targetTerm.start_date],
      )
      promoted += 1
    } else if (decision === "repeated") {
      await connection.query(
        `INSERT INTO student_enrollments (
          school_id, student_id, academic_year_id, term_id, class_id, stream_section,
          enrollment_type, enrollment_status, start_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'repeated', 'active', ?)
        ON DUPLICATE KEY UPDATE class_id = VALUES(class_id),
          stream_section = VALUES(stream_section),
          enrollment_type = VALUES(enrollment_type),
          enrollment_status = 'active',
          start_date = VALUES(start_date)`,
        [schoolId, baseRow.student_id, toAcademicYearId, targetTermId, baseRow.from_class_id, baseRow.stream_section, targetTerm.start_date],
      )
      repeated += 1
    } else if (decision === "graduated") {
      await connection.query("UPDATE students SET status = 'graduated' WHERE id = ? AND school_id = ?", [baseRow.student_id, schoolId])
      graduated += 1
    } else if (decision === "transferred_out" || decision === "withdrawn" || decision === "suspended") {
      await connection.query("UPDATE students SET status = ? WHERE id = ? AND school_id = ?", [decision, baseRow.student_id, schoolId])
    } else {
      pendingReview += 1
    }
  }

  if (!recordOnly && fromAcademicYearId !== toAcademicYearId && rowsToApply.length) {
    const studentIds = rowsToApply.map((row) => Number(row.student_id)).filter(Boolean)
    const placeholders = studentIds.map(() => "?").join(", ")
    await connection.query(
      `DELETE FROM promotion_decisions
       WHERE school_id = ?
         AND from_academic_year_id = ?
         AND to_academic_year_id = ?
         AND student_id IN (${placeholders})`,
      [schoolId, fromAcademicYearId, fromAcademicYearId, ...studentIds],
    )
  }

  return { promoted, repeated, graduated, pending_review: pendingReview, source_term_id: preview.sourceTerm?.id || null, processed: rowsToApply.length, class_id: classId }
}

export async function getAcademicSessionSummary(req, res) {
  const schoolId = getScopedSchoolId(req)
  const connection = pool
  const session = await getActiveAcademicSession(schoolId, connection)
  const policy = await getProgressionPolicyForSchool(connection, schoolId)
  const { academicYear, term } = session
  const [[students], [classes], [pendingResults], [pendingPromotions], [years], [terms]] = await Promise.all([
    term
      ? pool.query("SELECT COUNT(*) AS total FROM student_enrollments WHERE school_id = ? AND academic_year_id = ? AND term_id = ? AND enrollment_status = 'active'", [schoolId, academicYear.id, term.id])
      : [[{ total: 0 }]],
    pool.query("SELECT COUNT(*) AS total FROM classes WHERE school_id = ?", [schoolId]),
    term
      ? pool.query("SELECT COUNT(*) AS total FROM result_batches WHERE school_id = ? AND term_id = ? AND status IN ('draft', 'submitted', 'returned')", [schoolId, term.id])
      : [[{ total: 0 }]],
    academicYear
      ? pool.query("SELECT COUNT(*) AS total FROM promotion_decisions WHERE school_id = ? AND from_academic_year_id = ? AND decision = 'pending_review'", [schoolId, academicYear.id])
      : [[{ total: 0 }]],
    pool.query("SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC", [schoolId]),
    pool.query("SELECT t.*, ay.name AS academic_year_name FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.school_id = ? ORDER BY ay.start_date DESC, t.term_number DESC", [schoolId]),
  ])
  const [yearStats] = await pool.query(
    `SELECT ay.id AS academic_year_id,
      COUNT(DISTINCT t.id) AS term_count,
      COUNT(DISTINCT se.student_id) AS enrolled_students,
      COUNT(DISTINCT tr.id) AS result_count,
      COUNT(DISTINCT CASE WHEN tr.average_score >= ? THEN tr.id END) AS passed_count
     FROM academic_years ay
     LEFT JOIN terms t ON t.academic_year_id = ay.id AND t.school_id = ay.school_id
     LEFT JOIN student_enrollments se ON se.academic_year_id = ay.id AND se.school_id = ay.school_id AND se.enrollment_status = 'active'
     LEFT JOIN term_results tr ON tr.academic_year_id = ay.id AND tr.school_id = ay.school_id AND tr.status IN ('generated', 'approved', 'locked')
     WHERE ay.school_id = ?
     GROUP BY ay.id`,
    [policy.minimum_average, schoolId],
  )
  const statsByYear = new Map(yearStats.map((row) => [Number(row.academic_year_id), row]))
  const decoratedYears = years.map((year) => {
    const stats = statsByYear.get(Number(year.id)) || {}
    const resultCount = Number(stats.result_count || 0)
    const passedCount = Number(stats.passed_count || 0)
    return {
      ...year,
      length_weeks: weeksBetween(year.start_date, year.end_date),
      term_count: Number(stats.term_count || 0),
      enrolled_students: Number(stats.enrolled_students || 0),
      result_count: resultCount,
      passed_count: passedCount,
      pass_rate: resultCount ? Number(((passedCount / resultCount) * 100).toFixed(1)) : null,
      minimum_average: policy.minimum_average,
    }
  })

  const warnings = term ? await buildTermWarnings(connection, schoolId, term.id) : null
  res.json({
    current: { academic_year: academicYear || null, term: term || null },
    session: sessionPayload(session),
    metrics: {
      active_students: Number(students[0]?.total || 0),
      classes: Number(classes[0]?.total || 0),
      pending_results: Number(pendingResults[0]?.total || 0),
      pending_promotions: Number(pendingPromotions[0]?.total || 0),
    },
    years: decoratedYears,
    terms,
    closure_warnings: warnings,
  })
}

export async function getCurrentAcademicSession(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  res.json({ session: sessionPayload(session) })
}

export async function getAcademicTermDetail(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  if (!termId) throw new HttpError(400, "Term id is required")
  const term = await getTermOrThrow(pool, schoolId, termId)
  const teacherPairs = await getTeacherClassSubjectPairs(req, schoolId)
  const assessmentScope = teacherPairsClause(teacherPairs, "a.class_id", "a.subject_id")

  const [assessments] = await pool.query(
    `SELECT a.id, a.name, a.assessment_type, a.status, a.total_marks, a.duration_minutes,
      a.exam_session_id, a.class_id, a.subject_id, a.teacher_id, a.administering_teacher_id,
      c.name AS class_name, subj.name AS subject_name, es.name AS exam_session_name,
      es.exam_type AS exam_session_type, es.status AS exam_session_status,
      u.full_name AS teacher_name, admin.full_name AS administering_teacher_name,
      COUNT(DISTINCT rb.id) AS result_batch_count,
      COUNT(DISTINCT CASE WHEN rb.status IN ('approved', 'locked') THEN rb.id END) AS completed_result_batches,
      COUNT(DISTINCT re.id) AS saved_marks
     FROM assessments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN users admin ON admin.id = a.administering_teacher_id AND admin.school_id = a.school_id
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id AND re.score IS NOT NULL
     WHERE a.school_id = ? AND a.term_id = ? AND a.status <> 'archived'${assessmentScope.clause}
     GROUP BY a.id, a.name, a.assessment_type, a.status, a.total_marks, a.duration_minutes,
       a.exam_session_id, a.class_id, a.subject_id, a.teacher_id, a.administering_teacher_id,
       c.name, subj.name, es.name, es.exam_type, es.status, u.full_name, admin.full_name
     ORDER BY FIELD(a.assessment_type, 'end_of_term_exam', 'mid_term', 'mock_exam', 'final_exam', 'class_test', 'quiz', 'assignment'),
       c.name, subj.name, a.name`,
    [schoolId, termId, ...assessmentScope.params],
  )

  const [examSessions] = await pool.query(
    `SELECT es.*, COUNT(DISTINCT a.id) AS paper_count
     FROM exam_sessions es
     LEFT JOIN assessments a ON a.exam_session_id = es.id AND a.school_id = es.school_id
     WHERE es.school_id = ? AND es.term_id = ? AND es.status <> 'archived'
     GROUP BY es.id
     ORDER BY es.start_date, es.name`,
    [schoolId, termId],
  )

  const [events] = await pool.query(
    `SELECT e.id, e.title, e.description, e.event_type, e.start_datetime, e.end_datetime,
      e.all_day, e.visibility, e.status, c.name AS class_name, subj.name AS subject_name,
      u.full_name AS teacher_name
     FROM school_events e
     LEFT JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id
     LEFT JOIN subjects subj ON subj.id = e.subject_id AND subj.school_id = e.school_id
     LEFT JOIN users u ON u.id = e.teacher_id AND u.school_id = e.school_id
     WHERE e.school_id = ? AND e.term_id = ? AND e.status <> 'archived'
     ORDER BY e.start_datetime, e.title`,
    [schoolId, termId],
  )

  const [instances] = await pool.query(
    `SELECT ai.id, ai.title, ai.status, ai.instance_date, ai.start_time, ai.duration_minutes,
      ai.total_marks, c.name AS class_name, subj.name AS subject_name, u.full_name AS teacher_name
     FROM assessment_instances ai
     JOIN classes c ON c.id = ai.class_id AND c.school_id = ai.school_id
     JOIN subjects subj ON subj.id = ai.subject_id AND subj.school_id = ai.school_id
     JOIN users u ON u.id = ai.teacher_id AND u.school_id = ai.school_id
     WHERE ai.school_id = ? AND ai.term_id = ? AND ai.status <> 'archived'
     ORDER BY ai.instance_date, ai.start_time, ai.title`,
    [schoolId, termId],
  )

  const warnings = await buildTermWarnings(pool, schoolId, termId)
  res.json({
    term: { ...term, length_weeks: weeksBetween(term.start_date, term.end_date) },
    assessments,
    exam_sessions: examSessions,
    events,
    assessment_instances: instances,
    warnings,
    summary: {
      assessments: assessments.length,
      exam_sessions: examSessions.length,
      events: events.length + instances.length,
      completed_results: assessments.filter((row) => Number(row.completed_result_batches || 0) > 0).length,
    },
  })
}

export async function getTermResultView(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || req.query.term_id || 0)
  const assessmentId = req.query.assessment_id ? Number(req.query.assessment_id) : null
  const requestedClassId = req.query.class_id ? Number(req.query.class_id) : null
  const search = String(req.query.search || "").trim().toLowerCase()
  if (!termId) throw new HttpError(400, "Term id is required")
  const term = await getTermOrThrow(pool, schoolId, termId)
  const teacherPairs = await getTeacherClassSubjectPairs(req, schoolId)
  const assessmentScope = teacherPairsClause(teacherPairs, "a.class_id", "a.subject_id")

  let selectedAssessment = null
  if (assessmentId) {
    const [[assessment]] = await pool.query(
      `SELECT a.*, c.name AS class_name, subj.name AS subject_name, es.name AS exam_session_name
       FROM assessments a
       JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
       JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
       LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
       WHERE a.school_id = ? AND a.term_id = ? AND a.id = ?${assessmentScope.clause}
       LIMIT 1`,
      [schoolId, termId, assessmentId, ...assessmentScope.params],
    )
    if (!assessment) throw new HttpError(404, "Assessment was not found")
    selectedAssessment = assessment
  }

  const [classes] = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.grade_level
     FROM classes c
     LEFT JOIN student_enrollments se ON se.class_id = c.id AND se.school_id = c.school_id AND se.term_id = ?
     LEFT JOIN assessments a ON a.class_id = c.id AND a.school_id = c.school_id AND a.term_id = ?
     WHERE c.school_id = ?
       AND (se.id IS NOT NULL OR a.id IS NOT NULL)
       ${Array.isArray(teacherPairs) && teacherPairs.length ? `AND c.id IN (${[...new Set(teacherPairs.map((pair) => pair.classId))].map(() => "?").join(",")})` : Array.isArray(teacherPairs) ? "AND 1 = 0" : ""}
     ORDER BY c.name`,
    [
      termId,
      termId,
      schoolId,
      ...(Array.isArray(teacherPairs) && teacherPairs.length ? [...new Set(teacherPairs.map((pair) => pair.classId))] : []),
    ],
  )
  const classId = selectedAssessment?.class_id || requestedClassId || classes[0]?.id || null
  if (!classId) {
    return res.json({ term, classes, class: null, assessment: selectedAssessment, papers: [], rows: [], summary: { students: 0, papers: 0, missing_marks: 0 } })
  }
  const [[classRow]] = await pool.query("SELECT id, name, grade_level FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [classId, schoolId])
  if (!classRow) throw new HttpError(404, "Class was not found")

  const paperParams = [schoolId, term.academic_year_id, termId, classId]
  let assessmentClause = ""
  if (selectedAssessment) {
    assessmentClause = " AND a.id = ?"
    paperParams.push(Number(selectedAssessment.id))
  }
  const [papers] = await pool.query(
    `SELECT a.id, a.name AS assessment_name, a.assessment_type, a.status AS assessment_status,
      a.total_marks, a.exam_session_id, es.name AS exam_session_name,
      subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
      rb.id AS result_batch_id, rb.status AS batch_status, u.full_name AS teacher_name
     FROM assessments a
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN exam_sessions es ON es.id = a.exam_session_id AND es.school_id = a.school_id
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     LEFT JOIN users u ON u.id = COALESCE(rb.teacher_id, a.teacher_id) AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.academic_year_id = ? AND a.term_id = ? AND a.class_id = ?
       AND a.status <> 'archived'${assessmentClause}${assessmentScope.clause}
     GROUP BY a.id, a.name, a.assessment_type, a.status, a.total_marks, a.exam_session_id,
       es.name, subj.id, subj.name, subj.code, rb.id, rb.status, u.full_name
     ORDER BY subj.name, a.name`,
    [...paperParams, ...assessmentScope.params],
  )

  const [students] = await pool.query(
    `SELECT se.id AS enrollment_id, s.id AS student_pk, COALESCE(s.student_id, s.admission_no) AS student_id,
      s.admission_no, s.first_name, s.last_name, COALESCE(se.stream_section, s.stream_section) AS stream_section,
      se.enrollment_status, c.name AS class_name
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ? AND se.class_id = ?
       AND se.enrollment_status = 'active' AND s.status = 'active'
     ORDER BY ${studentCodeSortSql("s")}, s.last_name, s.first_name`,
    [schoolId, term.academic_year_id, termId, classId],
  )

  const entriesParams = [schoolId, term.academic_year_id, termId, classId]
  let entryAssessmentClause = ""
  if (selectedAssessment) {
    entryAssessmentClause = " AND rb.assessment_id = ?"
    entriesParams.push(Number(selectedAssessment.id))
  }
  const [entries] = await pool.query(
    `SELECT re.student_id, re.score, re.grade, re.comment, re.status, re.last_saved_at,
      rb.assessment_id, rb.status AS batch_status, a.total_marks
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     WHERE re.school_id = ? AND rb.academic_year_id = ? AND rb.term_id = ? AND rb.class_id = ?${entryAssessmentClause}`,
    entriesParams,
  )

  const entriesByStudent = new Map()
  entries.forEach((entry) => {
    const studentKey = Number(entry.student_id)
    const resultMap = entriesByStudent.get(studentKey) || new Map()
    const score = entry.score === null || entry.score === undefined ? null : Number(entry.score)
    const percentage = score === null ? null : Number(((score / Math.max(Number(entry.total_marks || 0), 1)) * 100).toFixed(1))
    resultMap.set(Number(entry.assessment_id), {
      score,
      grade: entry.grade || null,
      percentage,
      comment: entry.comment || "",
      status: entry.status || entry.batch_status || "draft",
      batch_status: entry.batch_status || "",
      last_saved_at: entry.last_saved_at || null,
    })
    entriesByStudent.set(studentKey, resultMap)
  })

  const paperIds = papers.map((paper) => Number(paper.id))
  const rows = students.map((student) => {
    const resultMap = entriesByStudent.get(Number(student.student_pk)) || new Map()
    const results = {}
    let totalPercentage = 0
    let marked = 0
    paperIds.forEach((paperId) => {
      const result = resultMap.get(paperId) || null
      results[paperId] = result
      if (result?.percentage !== null && result?.percentage !== undefined) {
        totalPercentage += Number(result.percentage)
        marked += 1
      }
    })
    return {
      ...student,
      id: student.student_pk,
      results,
      marked_subjects: marked,
      missing_subjects: Math.max(0, paperIds.length - marked),
      average_score: marked ? Number((totalPercentage / marked).toFixed(1)) : null,
    }
  }).filter((row) => {
    if (!search) return true
    const haystack = `${row.student_id || ""} ${row.admission_no || ""} ${row.first_name || ""} ${row.last_name || ""}`.toLowerCase()
    return haystack.includes(search)
  })

  res.json({
    term,
    class: classRow,
    classes,
    assessment: selectedAssessment,
    papers,
    rows,
    summary: {
      students: rows.length,
      papers: papers.length,
      complete_students: rows.filter((row) => row.missing_subjects === 0 && papers.length > 0).length,
      missing_marks: rows.reduce((sum, row) => sum + Number(row.missing_subjects || 0), 0),
    },
  })
}

export async function getTermCloseChecks(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  if (!termId) throw new HttpError(400, "Term id is required")
  const term = await getTermOrThrow(pool, schoolId, termId)
  const warnings = await buildTermWarnings(pool, schoolId, termId)
  const critical_count = Number(warnings.draft_batches || 0)
    + Number(warnings.submitted_unapproved_batches || 0)
    + Number(warnings.returned_batches || 0)
    + Number(warnings.missing_result_batches || 0)
    + Number(warnings.draft_exam_papers || 0)
    + Number(warnings.unapproved_exam_papers || 0)
    + Number(warnings.missing_exam_marks || 0)
  res.json({ term, warnings, critical_count, can_proceed: critical_count === 0 })
}

export async function getTermProgressionPreview(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sourceTermId = Number(req.params.id || 0)
  const classId = req.query.class_id ? Number(req.query.class_id) : null
  if (!sourceTermId) throw new HttpError(400, "Term id is required")
  const sourceTerm = await getTermOrThrow(pool, schoolId, sourceTermId)
  const targetTerm = await inferProgressionTargetTerm(pool, schoolId, sourceTerm, req.query.to_term_id ? Number(req.query.to_term_id) : null)
  const targetAcademicYearId = targetTerm?.academic_year_id || sourceTerm.academic_year_id
  const preview = await buildProgressionPreviewRows(pool, schoolId, sourceTerm.academic_year_id, targetAcademicYearId, targetTerm?.id || null, {
    sourceTermId,
  })
  const classes = summarizeProgressionClasses(preview.rows)
  const selectedClassId = classId || classes[0]?.id || null
  const selectedRows = selectedClassId ? preview.rows.filter((row) => Number(row.from_class_id) === Number(selectedClassId)) : preview.rows
  res.json({
    source_term: preview.sourceTerm || sourceTerm,
    target_term: targetTerm,
    classes,
    selected_class_id: selectedClassId,
    rows: selectedRows,
    ready: true,
    message: targetTerm
      ? "Progression can be approved now; the open target term will receive enrollments when applied."
      : "Progression can be approved now. Open the next academic year term afterward to carry learners forward.",
    summary: {
      total: selectedRows.length,
      threshold_flags: selectedRows.filter((row) => row.progression_flag === "below_threshold").length,
      approved: selectedRows.filter((row) => row.approved_decision).length,
      pending: selectedRows.filter((row) => !row.approved_decision).length,
      clean_recommendations: selectedRows.filter((row) => row.result_status === "complete" && row.progression_flag !== "below_threshold").length,
    },
  })
}

export async function approveTermProgressionClass(req, res) {
  const schoolId = getScopedSchoolId(req)
  const sourceTermId = Number(req.params.id || 0)
  const classId = Number(req.params.classId || req.body.class_id || 0)
  if (!sourceTermId || !classId) throw new HttpError(400, "Term and class are required")
  const sourceTerm = await getTermOrThrow(pool, schoolId, sourceTermId)
  const targetTerm = await inferProgressionTargetTerm(pool, schoolId, sourceTerm, req.body.to_term_id ? Number(req.body.to_term_id) : null)
  const targetAcademicYearId = targetTerm?.academic_year_id || sourceTerm.academic_year_id

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const summary = await applyProgressionRows(connection, schoolId, sourceTerm.academic_year_id, targetAcademicYearId, targetTerm?.id || null, {
      approvedBy: req.user.id,
      overrides: Array.isArray(req.body.overrides) ? req.body.overrides : [],
      sourceTermId,
      classId,
      recordOnly: true,
    })
    await connection.commit()
    res.json({ ok: true, summary, target_term: targetTerm })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function createAcademicYear(req, res) {
  const schoolId = getScopedSchoolId(req)
  const name = String(req.body.name || "").trim()
  const startDate = normalizeDate(req.body.start_date, "Start date")
  const endDate = normalizeDate(req.body.end_date, "End date")
  const activate = Boolean(req.body.is_active)
  if (!name) throw new HttpError(400, "Academic year name is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (activate) {
      await connection.query("UPDATE academic_years SET is_active = 0, status = IF(status = 'active', 'closed', status) WHERE school_id = ?", [schoolId])
    }
    const [result] = await connection.query(
      "INSERT INTO academic_years (school_id, name, start_date, end_date, status, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [schoolId, name, startDate, endDate, activate ? "active" : "upcoming", activate ? 1 : 0],
    )
    await connection.commit()
    res.status(201).json({ academic_year: { id: Number(result.insertId), school_id: schoolId, name, start_date: startDate, end_date: endDate, status: activate ? "active" : "upcoming", is_active: activate } })
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "Academic year already exists")
    throw error
  } finally {
    connection.release()
  }
}

export async function openTerm(req, res) {
  const schoolId = getScopedSchoolId(req)
  const academicYearId = Number(req.body.academic_year_id || 0)
  const name = String(req.body.name || "").trim()
  const termNumber = Number(req.body.term_number || 0)
  const startDate = normalizeDate(req.body.start_date, "Start date")
  const endDate = normalizeDate(req.body.end_date, "End date")
  if (!academicYearId) throw new HttpError(400, "Academic year is required")
  if (!name) throw new HttpError(400, "Term name is required")
  if (!termNumber) throw new HttpError(400, "Term number is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[year]] = await connection.query("SELECT * FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1", [academicYearId, schoolId])
    if (!year) throw new HttpError(400, "Select an academic year from this school")
    const [[openExisting]] = await connection.query("SELECT id FROM terms WHERE school_id = ? AND status IN ('open', 'marking') LIMIT 1", [schoolId])
    if (openExisting) throw new HttpError(409, "Close or archive the current open term before opening another term")

    await connection.query("UPDATE academic_years SET is_active = 0 WHERE school_id = ?", [schoolId])
    await connection.query("UPDATE academic_years SET is_active = 1, status = 'active' WHERE id = ? AND school_id = ?", [academicYearId, schoolId])
    const [result] = await connection.query(
      "INSERT INTO terms (school_id, academic_year_id, name, term_number, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
      [schoolId, academicYearId, name, termNumber, startDate, endDate],
    )
    const termId = Number(result.insertId)
    let openingSummary = {
      mode: "initial",
      carried_forward: 0,
      promoted: 0,
      repeated: 0,
      graduated: 0,
      pending_review: 0,
      source_term_id: null,
      teacher_assignments_carried_forward: 0,
      teacher_assignments_touched: 0,
    }

    const [[previousSameYearTerm]] = await connection.query(
      `SELECT id FROM terms
       WHERE school_id = ? AND academic_year_id = ? AND id <> ? AND status IN ('closed', 'archived')
       ORDER BY term_number DESC, end_date DESC, id DESC LIMIT 1`,
      [schoolId, academicYearId, termId],
    )
    if (previousSameYearTerm) {
      const carried = await carryForwardEnrollments(connection, schoolId, previousSameYearTerm.id, academicYearId, termId, startDate)
      const teacherAssignments = await carryForwardTeacherAssignments(connection, schoolId, previousSameYearTerm.id, academicYearId, termId)
      openingSummary = {
        ...openingSummary,
        mode: "carry_forward",
        carried_forward: carried.eligible,
        touched: carried.touched,
        source_term_id: previousSameYearTerm.id,
        teacher_assignments_carried_forward: teacherAssignments.eligible,
        teacher_assignments_touched: teacherAssignments.touched,
      }
    } else {
      const previousAcademicYear = await findPreviousProgressionSourceYear(connection, schoolId, academicYearId, year.start_date)
      if (previousAcademicYear) {
        const progression = await applyProgressionRows(connection, schoolId, previousAcademicYear.id, academicYearId, termId, {
          approvedBy: req.user.id,
          requireApproved: true,
        })
        if (progression.source_term_id) {
          const teacherAssignments = await carryForwardTeacherAssignments(connection, schoolId, progression.source_term_id, academicYearId, termId)
          openingSummary = {
            ...openingSummary,
            mode: "year_progression",
            ...progression,
            teacher_assignments_carried_forward: teacherAssignments.eligible,
            teacher_assignments_touched: teacherAssignments.touched,
          }
        } else {
          openingSummary = { ...openingSummary, mode: "year_progression", ...progression }
        }
      } else {
        const [seedResult] = await connection.query(
          `INSERT INTO student_enrollments (
            school_id, student_id, academic_year_id, term_id, class_id, stream_section,
            enrollment_type, enrollment_status, start_date
          )
          SELECT school_id, id, ?, ?, class_id, stream_section, COALESCE(student_type, 'continued'), 'active', COALESCE(enrollment_date, ?)
          FROM students
          WHERE school_id = ? AND status = 'active' AND class_id IS NOT NULL
          ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), stream_section = VALUES(stream_section), enrollment_status = VALUES(enrollment_status)`,
          [academicYearId, termId, startDate, schoolId],
        )
        openingSummary = { ...openingSummary, mode: "initial_seed", carried_forward: Number(seedResult.affectedRows || 0) }
      }
    }

    await connection.query(
      `UPDATE teacher_class_subject_assignments
       SET academic_year_id = COALESCE(academic_year_id, ?), term_id = COALESCE(term_id, ?)
       WHERE school_id = ? AND is_active = 1`,
      [academicYearId, termId, schoolId],
    )
    await connection.commit()
    res.status(201).json({
      term: { id: termId, school_id: schoolId, academic_year_id: academicYearId, name, term_number: termNumber, start_date: startDate, end_date: endDate, status: "open" },
      opening_summary: openingSummary,
    })
  } catch (error) {
    await connection.rollback()
    if (error?.code === "ER_DUP_ENTRY") throw new HttpError(409, "That term already exists for the selected academic year")
    throw error
  } finally {
    connection.release()
  }
}

export async function moveTermToMarking(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  const [result] = await pool.query("UPDATE terms SET status = 'marking' WHERE id = ? AND school_id = ? AND status = 'open'", [termId, schoolId])
  if (!result.affectedRows) throw new HttpError(400, "Only an open term can move to marking")
  res.json({ ok: true })
}

export async function closeTerm(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  const confirmExceptions = Boolean(req.body.confirm_exceptions)
  const notes = String(req.body.notes || "").trim() || null
  if (!termId) throw new HttpError(400, "Term id is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[term]] = await connection.query("SELECT * FROM terms WHERE id = ? AND school_id = ? FOR UPDATE", [termId, schoolId])
    if (!term) throw new HttpError(404, "Term was not found")
    if (term.status === "closed") throw new HttpError(400, "Term is already closed")
    const warnings = await buildTermWarnings(connection, schoolId, termId)
    const hasCriticalWarnings = warnings.draft_batches
      || warnings.submitted_unapproved_batches
      || warnings.returned_batches
      || warnings.missing_result_batches
      || warnings.draft_exam_papers
      || warnings.unapproved_exam_papers
      || warnings.missing_exam_marks
    if (hasCriticalWarnings && !confirmExceptions) {
      throw new HttpError(409, "Term has incomplete result data. Review warnings or confirm closure with exceptions.")
    }

    await connection.query("UPDATE terms SET status = 'closed' WHERE id = ? AND school_id = ?", [termId, schoolId])
    await connection.query("UPDATE assessments SET status = 'locked' WHERE school_id = ? AND term_id = ?", [schoolId, termId])
    await connection.query("UPDATE exam_sessions SET status = 'locked' WHERE school_id = ? AND term_id = ? AND status <> 'archived'", [schoolId, termId])
    await connection.query("UPDATE result_batches SET status = 'locked' WHERE school_id = ? AND term_id = ? AND status = 'approved'", [schoolId, termId])
    await connection.query("UPDATE result_entries re JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id SET re.status = 'locked' WHERE re.school_id = ? AND rb.term_id = ? AND re.status = 'approved'", [schoolId, termId])
    await connection.query("UPDATE term_results SET status = 'locked' WHERE school_id = ? AND term_id = ? AND status IN ('generated', 'approved')", [schoolId, termId])
    await connection.query("UPDATE report_cards SET status = 'locked' WHERE school_id = ? AND term_id = ? AND status IN ('generated', 'approved')", [schoolId, termId])
    await connection.query(
      `INSERT INTO term_closures (school_id, academic_year_id, term_id, closed_by, closed_at, status, notes)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'closed', ?)`,
      [schoolId, term.academic_year_id, termId, req.user.id, notes],
    )
    await connection.commit()
    res.json({ ok: true, warnings })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function reopenTerm(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  const reason = String(req.body.reason || "").trim()
  if (!reason) throw new HttpError(400, "A reopen reason is required")

  const [result] = await pool.query("UPDATE terms SET status = 'marking' WHERE id = ? AND school_id = ? AND status = 'closed'", [termId, schoolId])
  if (!result.affectedRows) throw new HttpError(400, "Only a closed term can be reopened")
  await pool.query(
    `INSERT INTO term_closures (school_id, academic_year_id, term_id, closed_by, reopened_by, reopened_at, status, notes)
     SELECT school_id, academic_year_id, id, ?, ?, CURRENT_TIMESTAMP, 'reopened', ?
     FROM terms WHERE id = ? AND school_id = ?`,
    [req.user.id, req.user.id, reason, termId, schoolId],
  )
  await pool.query("UPDATE assessments SET status = 'open' WHERE school_id = ? AND term_id = ? AND status = 'locked'", [schoolId, termId])
  res.json({ ok: true })
}

export async function archiveTerm(req, res) {
  const schoolId = getScopedSchoolId(req)
  const termId = Number(req.params.id || 0)
  if (!termId) throw new HttpError(400, "Term id is required")
  const [result] = await pool.query(
    "UPDATE terms SET status = 'archived' WHERE id = ? AND school_id = ? AND status = 'closed'",
    [termId, schoolId],
  )
  if (!result.affectedRows) throw new HttpError(400, "Only a closed term can be archived")
  await pool.query("UPDATE exam_sessions SET status = 'archived' WHERE school_id = ? AND term_id = ? AND status = 'locked'", [schoolId, termId])
  await pool.query("UPDATE report_cards SET status = 'archived' WHERE school_id = ? AND term_id = ? AND status = 'locked'", [schoolId, termId])
  res.json({ ok: true })
}

export async function listClassProgressionRules(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [rows, policy] = await Promise.all([
    pool.query(
    `SELECT r.*, from_c.name AS from_class_name, to_c.name AS to_class_name
     FROM class_progression_rules r
     JOIN classes from_c ON from_c.id = r.from_class_id AND from_c.school_id = r.school_id
     LEFT JOIN classes to_c ON to_c.id = r.to_class_id AND to_c.school_id = r.school_id
     WHERE r.school_id = ?
     ORDER BY from_c.name`,
    [schoolId],
    ),
    getProgressionPolicyForSchool(pool, schoolId),
  ])
  res.json({ rules: rows[0], policy })
}

export async function getProgressionPolicy(req, res) {
  const schoolId = getScopedSchoolId(req)
  const policy = await getProgressionPolicyForSchool(pool, schoolId)
  res.json({ policy })
}

export async function saveProgressionPolicy(req, res) {
  const schoolId = getScopedSchoolId(req)
  const policy = await saveProgressionPolicyForSchool(pool, schoolId, req.body || {})
  res.json({ policy })
}

export async function saveClassProgressionRule(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fromClassId = Number(req.body.from_class_id || 0)
  const toClassId = req.body.to_class_id ? Number(req.body.to_class_id) : null
  const isTerminalClass = Boolean(req.body.is_terminal_class)
  const defaultDecision = isTerminalClass ? "graduate" : String(req.body.default_decision || "promote")
  const isActive = req.body.is_active === undefined ? true : Boolean(req.body.is_active)
  if (!fromClassId) throw new HttpError(400, "From class is required")
  if (!["promote", "graduate"].includes(defaultDecision)) throw new HttpError(400, "Default decision is invalid")
  if (!isTerminalClass && !toClassId && defaultDecision === "promote") throw new HttpError(400, "Select a next class or mark this as a terminal class")

  const [[fromClass]] = await pool.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [fromClassId, schoolId])
  if (!fromClass) throw new HttpError(400, "From class does not belong to this school")
  if (toClassId) {
    const [[toClass]] = await pool.query("SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1", [toClassId, schoolId])
    if (!toClass) throw new HttpError(400, "Next class does not belong to this school")
  }

  const [result] = await pool.query(
    `INSERT INTO class_progression_rules (
      school_id, from_class_id, to_class_id, is_terminal_class, default_decision, is_active
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE to_class_id = VALUES(to_class_id),
      is_terminal_class = VALUES(is_terminal_class),
      default_decision = VALUES(default_decision),
      is_active = VALUES(is_active)`,
    [schoolId, fromClassId, toClassId, isTerminalClass ? 1 : 0, defaultDecision, isActive ? 1 : 0],
  )
  res.status(result.insertId ? 201 : 200).json({ ok: true, id: Number(result.insertId || 0) })
}

export async function getProgressionPreview(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fromAcademicYearId = Number(req.params.id || req.query.from_academic_year_id || 0)
  const toAcademicYearId = Number(req.query.to_academic_year_id || 0)
  const targetTermId = Number(req.query.to_term_id || 0)
  if (!fromAcademicYearId || !toAcademicYearId || !targetTermId) throw new HttpError(400, "From year, to year and target term are required")
  const preview = await buildProgressionPreviewRows(pool, schoolId, fromAcademicYearId, toAcademicYearId, targetTermId)
  const thresholdFlags = preview.rows.filter((row) => row.progression_flag === "below_threshold").length
  const exceptions = preview.rows.filter((row) => row.suggested_decision === "pending_review" || row.progression_flag === "below_threshold").length
  const clean = preview.rows.length - exceptions
  res.json({
    source_term: preview.sourceTerm,
    rows: preview.rows,
    summary: {
      total: preview.rows.length,
      clean_recommendations: clean,
      threshold_flags: thresholdFlags,
      exceptions,
    },
  })
}

export async function progressAcademicYear(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fromAcademicYearId = Number(req.params.id || 0)
  const toAcademicYearId = Number(req.body.to_academic_year_id || 0)
  const targetTermId = Number(req.body.to_term_id || 0)
  if (!fromAcademicYearId || !toAcademicYearId || !targetTermId) throw new HttpError(400, "From year, to year and target term are required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const summary = await applyProgressionRows(connection, schoolId, fromAcademicYearId, toAcademicYearId, targetTermId, {
      approvedBy: req.user.id,
      overrides: Array.isArray(req.body.overrides) ? req.body.overrides : [],
    })
    await connection.commit()
    res.json({ ok: true, summary })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function startPromotion(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fromAcademicYearId = Number(req.body.from_academic_year_id || 0)
  const toAcademicYearId = Number(req.body.to_academic_year_id || 0)
  const targetTermId = Number(req.body.to_term_id || 0)
  const decisions = Array.isArray(req.body.decisions) ? req.body.decisions : []
  if (!fromAcademicYearId || !toAcademicYearId || !targetTermId) throw new HttpError(400, "From year, to year and target term are required")
  if (!decisions.length) throw new HttpError(400, "At least one promotion decision is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[targetTerm]] = await connection.query("SELECT id, start_date FROM terms WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1", [targetTermId, schoolId, toAcademicYearId])
    if (!targetTerm) throw new HttpError(400, "Target term does not belong to the selected academic year")

    for (const row of decisions) {
      const studentId = Number(row.student_id || 0)
      const fromClassId = Number(row.from_class_id || 0)
      const toClassId = row.to_class_id ? Number(row.to_class_id) : null
      const decision = String(row.decision || "pending_review")
      if (!studentId || !fromClassId) throw new HttpError(400, "Each decision needs a student and source class")
      if (!["promoted", "repeated", "graduated", "transferred_out", "withdrawn", "suspended", "pending_review"].includes(decision)) throw new HttpError(400, "Promotion decision is invalid")

      await connection.query(
        `INSERT INTO promotion_decisions (
          school_id, student_id, from_academic_year_id, to_academic_year_id, from_class_id, to_class_id,
          decision, recommended_decision, reason, approved_by, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE to_class_id = VALUES(to_class_id),
          decision = VALUES(decision),
          recommended_decision = VALUES(recommended_decision),
          reason = VALUES(reason),
          approved_by = VALUES(approved_by),
          approved_at = CURRENT_TIMESTAMP`,
        [schoolId, studentId, fromAcademicYearId, toAcademicYearId, fromClassId, toClassId, decision, row.recommended_decision || null, row.reason || null, req.user.id],
      )

      if (["promoted", "repeated"].includes(decision)) {
        const nextClassId = toClassId || fromClassId
        await connection.query(
          `INSERT INTO student_enrollments (
            school_id, student_id, academic_year_id, term_id, class_id, stream_section,
            enrollment_type, enrollment_status, start_date
          )
          SELECT ?, ?, ?, ?, ?, s.stream_section, ?, 'active', ?
          FROM students s WHERE s.id = ? AND s.school_id = ?
          ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), enrollment_type = VALUES(enrollment_type), enrollment_status = 'active'`,
          [schoolId, studentId, toAcademicYearId, targetTermId, nextClassId, decision, targetTerm.start_date, studentId, schoolId],
        )
      } else if (decision !== "pending_review") {
        await connection.query(
          "UPDATE students SET status = ? WHERE id = ? AND school_id = ?",
          [decision, studentId, schoolId],
        )
      }
    }
    await connection.commit()
    res.json({ ok: true, processed: decisions.length })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

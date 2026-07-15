import { pool } from "../config/db.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { HttpError } from "../utils/http.js"

function numberValue(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function dateTimeIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function isOnOrBeforeToday(value) {
  const date = dateOnly(value)
  if (!date) return false
  return date <= new Date().toISOString().slice(0, 10)
}

function valueLabel(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function parseJsonObject(value) {
  if (!value) return {}
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function announcementMessageId(value) {
  return Number(String(value || "").replace(/^message-/, "") || 0)
}

function announcementReactions(scope) {
  return Array.isArray(scope.reactions) && scope.reactions.length ? scope.reactions : ["Like", "Love", "Seen"]
}

function engagementPayload(scope, studentId) {
  const engagement = parseJsonObject(scope.engagement)
  const reactionRows = engagement.reactions && typeof engagement.reactions === "object" ? engagement.reactions : {}
  const pollRows = engagement.poll_votes && typeof engagement.poll_votes === "object" ? engagement.poll_votes : {}
  const reactionCounts = {}
  Object.values(reactionRows).forEach((value) => {
    const key = String(value || "")
    if (!key) return
    reactionCounts[key] = Number(reactionCounts[key] || 0) + 1
  })
  const pollResults = {}
  Object.values(pollRows).forEach((value) => {
    const key = String(value || "")
    if (!key) return
    pollResults[key] = Number(pollResults[key] || 0) + 1
  })
  const pollVote = pollRows[String(studentId)] || ""
  return {
    reaction_counts: reactionCounts,
    poll_results: pollVote ? pollResults : {},
    my_reaction: reactionRows[String(studentId)] || "",
    poll_vote: pollVote,
  }
}

async function guardianStudentsForPortal(req, schoolId, session) {
  const sessionClause = session.setupRequired
    ? "AND se2.enrollment_status = 'active'"
    : "AND se2.academic_year_id = ? AND se2.term_id = ? AND se2.enrollment_status = 'active'"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT DISTINCT s.id, s.public_ref, s.first_name, s.last_name, s.profile_photo_url,
      COALESCE(se.class_id, s.class_id) AS class_id,
      COALESCE(se.stream_section, s.stream_section) AS stream_section,
      c.name AS class_name
     FROM student_guardians sg
     JOIN students s ON s.id = sg.student_id AND s.school_id = sg.school_id
     LEFT JOIN student_enrollments se ON se.id = (
       SELECT se2.id
       FROM student_enrollments se2
       WHERE se2.school_id = s.school_id AND se2.student_id = s.id ${sessionClause}
       ORDER BY se2.created_at DESC, se2.id DESC
       LIMIT 1
     )
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
     WHERE sg.school_id = ? AND sg.user_id = ? AND s.status = 'active'
     ORDER BY s.first_name, s.last_name, s.id`,
    [...sessionParams, schoolId, Number(req.user?.id || 0)],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    public_ref: row.public_ref,
    full_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    class_id: row.class_id ? Number(row.class_id) : null,
    class_name: row.class_name || null,
    stream_section: row.stream_section || null,
    profile_photo_url: row.profile_photo_url || null,
  }))
}

async function resolveStudent(req, schoolId, session) {
  const isParent = String(req.user?.role || "").toLowerCase() === "parent"
  let linkedStudents = []
  let studentId = Number(req.user?.studentId || req.user?.id || 0)
  if (isParent) {
    linkedStudents = await guardianStudentsForPortal(req, schoolId, session)
    if (!linkedStudents.length) {
      throw new HttpError(404, "No active learner is linked to this parent account")
    }
    const requestedRef = String(req.query?.student_ref || req.query?.studentRef || "").trim()
    const selected = requestedRef
      ? linkedStudents.find((row) => String(row.public_ref) === requestedRef)
      : linkedStudents[0]
    if (!selected) throw new HttpError(404, "The linked learner was not found")
    studentId = selected.id
  }
  const sessionJoin = session.setupRequired
    ? "AND se.enrollment_status = 'active'"
    : "AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT s.id, s.public_ref, s.school_id, s.class_id AS fallback_class_id,
      COALESCE(s.student_id, s.admission_no) AS student_code, s.admission_no,
      s.first_name, s.last_name, s.date_of_birth, s.gender, s.profile_photo_url,
      s.stream_section, s.enrollment_date, s.student_type, s.status,
      se.id AS current_enrollment_id, se.academic_year_id, se.term_id,
      COALESCE(se.class_id, s.class_id) AS current_class_id,
      COALESCE(se.stream_section, s.stream_section) AS current_stream_section,
      se.enrollment_type, se.enrollment_status,
      c.name AS class_name, ay.name AS academic_year_name, t.name AS term_name
     FROM students s
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id ${sessionJoin}
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
     LEFT JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
     LEFT JOIN terms t ON t.id = se.term_id AND t.school_id = se.school_id
     WHERE s.school_id = ? AND s.id = ? AND s.status = 'active'
     ORDER BY se.id IS NULL, se.created_at DESC, se.id DESC
     LIMIT 1`,
    [...sessionParams, schoolId, studentId],
  )
  const student = rows[0]
  if (!student) throw new HttpError(404, "No active student profile was found")
  const resolvedStudent = {
    ...student,
    id: Number(student.id),
    current_enrollment_id: student.current_enrollment_id ? Number(student.current_enrollment_id) : null,
    current_class_id: student.current_class_id ? Number(student.current_class_id) : null,
  }
  return {
    student: resolvedStudent,
    guardianContext: isParent
      ? {
          is_parent: true,
          selected_student_ref: resolvedStudent.public_ref,
          available_students: linkedStudents.map(({ id: _id, class_id: _classId, ...student }) => student),
        }
      : {
          is_parent: false,
          selected_student_ref: resolvedStudent.public_ref,
          available_students: [],
        },
  }
}

async function loadResults(schoolId, studentId) {
  const [reports] = await pool.query(
    `SELECT rc.id, rc.id AS report_card_id, rc.exam_session_id, rc.status AS report_status,
      rc.generated_at, rc.term_result_id,
      es.name AS exam_session_name, es.exam_type, es.status AS exam_session_status,
      es.start_date AS exam_start_date, es.end_date AS exam_end_date,
      ay.name AS academic_year_name, ay.start_date AS academic_year_start_date,
      t.name AS term_name, t.term_number, t.start_date AS term_start_date, t.end_date AS term_end_date,
      c.name AS class_name, tr.class_id, tr.total_score, tr.average_score, tr.grade, tr.position, tr.status AS result_status,
      (
        SELECT COUNT(DISTINCT se2.student_id)
        FROM student_enrollments se2
        WHERE se2.school_id = rc.school_id
          AND se2.academic_year_id = rc.academic_year_id
          AND se2.term_id = rc.term_id
          AND se2.class_id = tr.class_id
          AND se2.enrollment_status = 'active'
      ) AS class_total
     FROM report_cards rc
     JOIN academic_years ay ON ay.id = rc.academic_year_id AND ay.school_id = rc.school_id
     JOIN terms t ON t.id = rc.term_id AND t.school_id = rc.school_id
     LEFT JOIN exam_sessions es ON es.id = rc.exam_session_id AND es.school_id = rc.school_id
     LEFT JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
     LEFT JOIN student_enrollments se ON se.id = rc.enrollment_id AND se.school_id = rc.school_id
     LEFT JOIN classes c ON c.id = COALESCE(tr.class_id, se.class_id) AND c.school_id = rc.school_id
     WHERE rc.school_id = ? AND rc.student_id = ? AND rc.status <> 'archived'
     ORDER BY ay.start_date DESC, t.term_number DESC, es.start_date DESC, rc.generated_at DESC`,
    [schoolId, studentId],
  )
  const [subjects] = await pool.query(
    `SELECT rc.id AS report_card_id, sr.id, sr.score, sr.grade, sr.comment,
      subj.code AS subject_code, subj.name AS subject_name,
      u.full_name AS teacher_name,
      a.name AS assessment_name, a.assessment_type, a.total_marks,
      rb.status AS batch_status, re.score AS raw_score, re.grade AS raw_grade,
      re.status AS entry_status, re.last_saved_at
     FROM report_cards rc
     JOIN term_results tr ON tr.id = rc.term_result_id AND tr.school_id = rc.school_id
     JOIN subject_results sr ON sr.term_result_id = tr.id AND sr.school_id = tr.school_id
     JOIN subjects subj ON subj.id = sr.subject_id AND subj.school_id = sr.school_id
     LEFT JOIN users u ON u.id = sr.teacher_id AND u.school_id = sr.school_id
     LEFT JOIN assessments a ON a.id = sr.assessment_id AND a.school_id = sr.school_id
     LEFT JOIN result_batches rb ON rb.id = sr.result_batch_id AND rb.school_id = sr.school_id
     LEFT JOIN result_entries re ON re.school_id = sr.school_id
       AND re.result_batch_id = sr.result_batch_id
       AND re.student_id = rc.student_id
     WHERE rc.school_id = ? AND rc.student_id = ?
       AND rc.status <> 'archived'
       AND (sr.result_batch_id IS NULL OR rb.exam_session_id <=> rc.exam_session_id)
     ORDER BY rc.generated_at DESC, subj.name`,
    [schoolId, studentId],
  )

  const reportsById = new Map(reports.map((report) => [Number(report.id), {
    ...report,
    id: Number(report.id),
    report_card_id: Number(report.report_card_id),
    total_score: nullableNumber(report.total_score),
    average_score: nullableNumber(report.average_score),
    position: nullableNumber(report.position),
    class_total: numberValue(report.class_total),
    generated_at: dateTimeIso(report.generated_at),
    subjects: [],
  }]))

  subjects.forEach((subject) => {
    const report = reportsById.get(Number(subject.report_card_id))
    if (!report) return
    const absent = String(subject.entry_status || "").toLowerCase() === "absent"
    const score = absent ? null : nullableNumber(subject.score)
    const rawScore = absent || subject.raw_score === null ? score : nullableNumber(subject.raw_score)
    report.subjects.push({
      ...subject,
      id: Number(subject.id),
      absent,
      score,
      raw_score: rawScore,
      total_marks: nullableNumber(subject.total_marks),
      total_percent: score,
      last_saved_at: dateTimeIso(subject.last_saved_at),
    })
  })

  const normalizedReports = [...reportsById.values()].map((report) => {
    const failedSubjects = report.subjects.filter((subject) => !subject.absent && numberValue(subject.total_percent) < 50).length
    const subjectCount = report.subjects.length
    const averageScore = nullableNumber(report.average_score)
    return {
      ...report,
      subject_count: subjectCount,
      passed_subjects: Math.max(subjectCount - failedSubjects, 0),
      failed_subjects: failedSubjects,
      remark: failedSubjects > 0 || (averageScore !== null && averageScore < 50) ? "FAIL" : "PASS",
    }
  })

  const trendBySubject = new Map()
  normalizedReports.slice().reverse().forEach((report) => {
    report.subjects.forEach((subject) => {
      const key = subject.subject_name || subject.subject_code || String(subject.subject_id)
      if (!trendBySubject.has(key)) {
        trendBySubject.set(key, {
          subject_name: subject.subject_name || key,
          subject_code: subject.subject_code || "",
          direction: "steady",
          points: [],
        })
      }
      trendBySubject.get(key).points.push({
        report_card_id: report.report_card_id,
        exam_session_name: report.exam_session_name,
        term_name: report.term_name,
        generated_at: report.generated_at,
        score: subject.absent ? null : nullableNumber(subject.total_percent),
      })
    })
  })
  const trends = [...trendBySubject.values()].map((trend) => {
    const valid = trend.points.map((point) => point.score).filter((score) => score !== null)
    const first = valid[0]
    const last = valid[valid.length - 1]
    return {
      ...trend,
      direction: first === undefined || last === undefined || first === last ? "steady" : last > first ? "improving" : "declining",
      change: first === undefined || last === undefined ? null : Number((last - first).toFixed(1)),
    }
  })

  return {
    latest_report: normalizedReports[0] || null,
    reports: normalizedReports,
    performance_trends: trends,
    position_enabled: normalizedReports.some((report) => report.position !== null),
  }
}

async function loadFees(schoolId, studentId, currentTermName) {
  const [accounts] = await pool.query(
    `SELECT id, term_name, amount_due, amount_paid,
      GREATEST(amount_due - amount_paid, 0) AS balance,
      status, due_date, created_at
     FROM fee_accounts
     WHERE school_id = ? AND student_id = ?
     ORDER BY due_date DESC, created_at DESC`,
    [schoolId, studentId],
  )
  const [payments] = await pool.query(
    `SELECT fp.id, fp.amount, fp.payment_method, fp.reference, fp.receipt_no, fp.paid_at,
      fa.term_name
     FROM fee_payments fp
     JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
     WHERE fp.school_id = ? AND fa.student_id = ?
     ORDER BY fp.paid_at DESC
     LIMIT 50`,
    [schoolId, studentId],
  )
  const normalizedAccounts = accounts.map((account) => ({
    ...account,
    id: Number(account.id),
    amount_due: numberValue(account.amount_due),
    amount_paid: numberValue(account.amount_paid),
    balance: numberValue(account.balance),
    due_date: dateOnly(account.due_date),
    overdue: numberValue(account.balance) > 0 && isOnOrBeforeToday(account.due_date),
  }))
  const currentAccounts = normalizedAccounts.filter((account) => account.term_name === currentTermName)
  const scopedAccounts = currentAccounts.length ? currentAccounts : normalizedAccounts
  const totalDue = scopedAccounts.reduce((sum, account) => sum + account.amount_due, 0)
  const paidToDate = scopedAccounts.reduce((sum, account) => sum + account.amount_paid, 0)
  const outstanding = scopedAccounts.reduce((sum, account) => sum + account.balance, 0)

  return {
    summary: {
      term_name: currentTermName || scopedAccounts[0]?.term_name || "",
      total_due: totalDue,
      amount_paid: paidToDate,
      outstanding_balance: outstanding,
      next_due_date: scopedAccounts.find((account) => account.balance > 0)?.due_date || null,
      overdue: scopedAccounts.some((account) => account.overdue),
    },
    accounts: normalizedAccounts,
    payments: payments.map((payment) => ({
      ...payment,
      id: Number(payment.id),
      amount: numberValue(payment.amount),
      paid_at: dateTimeIso(payment.paid_at),
    })),
  }
}

async function loadHomework(schoolId, student, session) {
  if (!student.current_class_id || session.setupRequired) return { assignments: [] }
  const [rows] = await pool.query(
    `SELECT h.id, h.title, h.instructions, h.due_date, h.status,
      subj.name AS subject_name, c.name AS class_name, creator.full_name AS teacher_name,
      hs.status AS submission_status, hs.submitted_at
     FROM homework h
     JOIN subjects subj ON subj.id = h.subject_id AND subj.school_id = h.school_id
     JOIN classes c ON c.id = h.class_id AND c.school_id = h.school_id
     LEFT JOIN users creator ON creator.id = h.created_by AND creator.school_id = h.school_id
     LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.school_id = h.school_id
       AND hs.student_id = ?
     WHERE h.school_id = ? AND h.class_id = ?
       AND h.due_date BETWEEN ? AND ?
     ORDER BY h.due_date ASC, h.created_at DESC`,
    [student.id, schoolId, student.current_class_id, session.term.start_date, session.term.end_date],
  )
  return {
    assignments: rows.map((row) => {
      const submittedStatus = row.submission_status || ""
      const status = submittedStatus || (row.status === "closed" ? "closed" : isOnOrBeforeToday(row.due_date) ? "overdue" : "pending")
      return {
        ...row,
        id: Number(row.id),
        due_date: dateOnly(row.due_date),
        submitted_at: dateTimeIso(row.submitted_at),
        submission_status: status,
        teacher_feedback: null,
      }
    }),
  }
}

async function loadAttendance(schoolId, student, session) {
  if (session.setupRequired) return { summary: { marked_days: 0, attended_days: 0, absences: 0, attendance_percent: null }, records: [], absences: [] }
  const [rows] = await pool.query(
    `SELECT attendance_date, status, note
     FROM attendance_records
     WHERE school_id = ? AND student_id = ?
       AND attendance_date BETWEEN ? AND ?
     ORDER BY attendance_date DESC`,
    [schoolId, student.id, session.term.start_date, session.term.end_date],
  )
  const records = rows.map((row) => ({
    ...row,
    attendance_date: dateOnly(row.attendance_date),
  }))
  const markedDays = records.length
  const attendedDays = records.filter((record) => ["present", "late"].includes(record.status)).length
  const absences = records.filter((record) => ["absent", "sick"].includes(record.status))
  return {
    summary: {
      marked_days: markedDays,
      attended_days: attendedDays,
      absences: absences.length,
      attendance_percent: markedDays ? Number(((attendedDays / markedDays) * 100).toFixed(1)) : null,
    },
    records,
    absences,
  }
}

async function loadTimetable(schoolId, student, session) {
  if (!student.current_class_id || session.setupRequired) return { entries: [] }
  const [rows] = await pool.query(
    `SELECT ete.id, ete.exam_date, ete.start_time, ete.end_time, ete.room, ete.status,
      subj.name AS subject_name, subj.code AS subject_code,
      c.name AS class_name, inv.full_name AS teacher_name,
      a.name AS assessment_name, es.name AS exam_session_name, es.exam_type
     FROM exam_timetable_entries ete
     JOIN subjects subj ON subj.id = ete.subject_id AND subj.school_id = ete.school_id
     JOIN classes c ON c.id = ete.class_id AND c.school_id = ete.school_id
     LEFT JOIN users inv ON inv.id = ete.invigilator_teacher_id AND inv.school_id = ete.school_id
     LEFT JOIN assessments a ON a.id = ete.assessment_id AND a.school_id = ete.school_id
     LEFT JOIN exam_sessions es ON es.id = ete.exam_session_id AND es.school_id = ete.school_id
     WHERE ete.school_id = ? AND ete.class_id = ?
       AND ete.academic_year_id = ? AND ete.term_id = ?
       AND ete.status <> 'cancelled'
     ORDER BY ete.exam_date ASC, ete.start_time ASC`,
    [schoolId, student.current_class_id, session.academicYearId, session.termId],
  )
  return {
    entries: rows.map((row) => ({
      ...row,
      id: Number(row.id),
      exam_date: dateOnly(row.exam_date),
      type: "exam",
    })),
  }
}

function normalizePercent(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? Number(number.toFixed(1)) : null
}

function rankingAward(row) {
  if (Number(row.completed_drills || 0) < 2) return null
  if (row.streak_active) return "Practice streak"
  if (Number(row.improvement_points || 0) >= 8) return "Improving star"
  if (Number(row.average_score || 0) >= 85) return "Top performer"
  if (Number(row.recent_completed || 0) >= 4) return "Practice streak"
  return null
}

function formatPlacement(position) {
  const value = Number(position || 0)
  return value > 0 ? `#${value}` : "-"
}

function formatAverage(value) {
  return value === null || value === undefined ? "-" : `${value}%`
}

function rankingCelebrations(row) {
  const completedDrills = Number(row.completed_drills || 0)
  if (completedDrills <= 0) return []
  const studentKey = Number(row.student_id || 0)
  const latestKey = row.latest_drill_date || row.streak_latest_date || "latest"
  const events = []

  if (completedDrills === 1 && row.latest_drill_date) {
    events.push({
      type: "first_drill",
      key: `first-drill:${studentKey}:${row.latest_drill_date}`,
      title: "First Daily Drill completed",
      message: "Your Daily Drill journey has started. Keep practising and your ranking will keep growing.",
      stats: [
        { label: "Completed", value: "1 drill" },
        { label: "Class rank", value: formatPlacement(row.position) },
      ],
    })
  }

  if (row.streak_started) {
    const streakDays = Number(row.current_streak_days || 0)
    events.push({
      type: "streak_started",
      key: `streak-started:${studentKey}:${row.streak_latest_date || latestKey}:${streakDays}`,
      title: streakDays === 2 ? "Daily Drill streak started" : `${streakDays}-day Daily Drill streak`,
      message: streakDays === 2
        ? "You have completed Daily Drills on consecutive days. That habit is now building."
        : "You kept your Daily Drill streak going. Keep showing up and stacking progress.",
      stats: [
        { label: "Streak", value: `${streakDays} days` },
        { label: "Average", value: formatAverage(row.average_score) },
      ],
    })
  }

  if (Number(row.movement || 0) > 0 && row.previous_position) {
    const places = Number(row.movement || 0)
    events.push({
      type: "rank_climb",
      key: `rank-climb:${studentKey}:${latestKey}:${row.previous_position}:${row.position}`,
      title: `You moved up ${places} ${places === 1 ? "place" : "places"}`,
      message: `You passed ${places} ${places === 1 ? "classmate" : "classmates"} on the Daily Drill ranking.`,
      stats: [
        { label: "Now", value: formatPlacement(row.position) },
        { label: "Before", value: formatPlacement(row.previous_position) },
      ],
    })
  }

  return events
}

function activeDrillWindow(session) {
  const today = new Date().toISOString().slice(0, 10)
  const start = session.term?.start_date || "1900-01-01"
  const status = String(session.activeTermStatus || session.term?.status || "").toLowerCase()
  const end = ["open", "marking"].includes(status) ? "9999-12-31" : session.term?.end_date || today
  return { start, end }
}

function dateToUtcMs(value) {
  const date = dateOnly(value)
  if (!date) return null
  const time = Date.parse(`${date}T00:00:00Z`)
  return Number.isNaN(time) ? null : time
}

function dateAddDays(value, days) {
  const time = dateToUtcMs(value)
  if (time === null) return ""
  return new Date(time + days * 86400000).toISOString().slice(0, 10)
}

function daysFromTo(fromValue, toValue) {
  const from = dateToUtcMs(fromValue)
  const to = dateToUtcMs(toValue)
  if (from === null || to === null) return null
  return Math.round((to - from) / 86400000)
}

function currentPracticeStreak(datesCsv) {
  const dates = [...new Set(String(datesCsv || "").split(",").map(dateOnly).filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)))
  if (!dates.length) return { days: 0, active: false, latest: "" }
  const latest = dates[0]
  const today = new Date().toISOString().slice(0, 10)
  const daysSinceLatest = daysFromTo(latest, today)
  let expected = latest
  let streak = 0
  for (const date of dates) {
    if (date !== expected) break
    streak += 1
    expected = dateAddDays(expected, -1)
  }
  return {
    days: streak,
    active: daysSinceLatest === null ? false : daysSinceLatest <= 1,
    latest,
  }
}

async function loadDrillRanking(schoolId, student, session) {
  if (!student.current_class_id || session.setupRequired) {
    return { leaderboard: [], movements: [], awards: [], summary: { class_size: 0, current_position: null } }
  }
  const drillWindow = activeDrillWindow(session)
  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, s.profile_photo_url,
       COUNT(ds.id) AS completed_drills,
       AVG(ds.percentage) AS average_score,
       SUM(ds.score) AS total_score,
       MAX(ds.scheduled_date) AS latest_drill_date,
       GROUP_CONCAT(DISTINCT ds.scheduled_date ORDER BY ds.scheduled_date DESC) AS completed_dates_csv,
       SUM(CASE WHEN ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS recent_completed,
       AVG(CASE WHEN ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN ds.percentage END) AS recent_score,
       AVG(CASE WHEN ds.scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
                 AND ds.scheduled_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                THEN ds.percentage END) AS prior_recent_score
     FROM student_enrollments se
     JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id AND s.status = 'active'
     LEFT JOIN drill_sessions ds ON ds.school_id = se.school_id
      AND ds.student_id = s.id
      AND ds.status = 'completed'
      AND ds.scheduled_date BETWEEN ? AND ?
     WHERE se.school_id = ?
       AND se.academic_year_id = ?
       AND se.term_id = ?
       AND se.class_id = ?
       AND se.enrollment_status = 'active'
    GROUP BY s.id, s.first_name, s.last_name, s.profile_photo_url`,
    [
      drillWindow.start,
      drillWindow.end,
      schoolId,
      session.academicYearId,
      session.termId,
      student.current_class_id,
    ],
  )
  const previousRanked = [...rows]
    .filter((row) => row.prior_recent_score !== null)
    .sort((a, b) =>
      Number(b.prior_recent_score || 0) - Number(a.prior_recent_score || 0)
      || Number(b.completed_drills || 0) - Number(a.completed_drills || 0)
      || String(a.first_name || "").localeCompare(String(b.first_name || "")),
    )
  const previousPositions = new Map(previousRanked.map((row, index) => [Number(row.student_id), index + 1]))
  const hasAnyCompletedDrill = rows.some((row) => Number(row.completed_drills || 0) > 0)
  const ranked = [...rows]
    .sort((a, b) =>
      (Number(b.completed_drills || 0) > 0 ? 1 : 0) - (Number(a.completed_drills || 0) > 0 ? 1 : 0)
      || Number(b.average_score || 0) - Number(a.average_score || 0)
      || Number(b.completed_drills || 0) - Number(a.completed_drills || 0)
      || Number(b.total_score || 0) - Number(a.total_score || 0)
      || String(a.first_name || "").localeCompare(String(b.first_name || "")),
    )
    .map((row, index) => {
      const completedDrills = Number(row.completed_drills || 0)
      const position = index + 1
      const previousPosition = completedDrills > 0 ? previousPositions.get(Number(row.student_id)) || null : null
      const movement = previousPosition && position ? previousPosition - position : 0
      const recentScore = normalizePercent(row.recent_score)
      const priorRecentScore = normalizePercent(row.prior_recent_score)
      const improvement = recentScore !== null && priorRecentScore !== null
        ? Number((recentScore - priorRecentScore).toFixed(1))
        : null
      const streak = currentPracticeStreak(row.completed_dates_csv)
      const streakActive = completedDrills > 0
        && streak.active
        && (streak.days >= 2 || Number(row.recent_completed || 0) >= 4)
      const streakStarted = completedDrills > 1 && streak.active && streak.days >= 2
      const normalized = {
        student_id: Number(row.student_id),
        full_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
        profile_photo_url: row.profile_photo_url || null,
        position,
        previous_position: previousPosition,
        movement,
        movement_direction: completedDrills <= 0 ? "not_started" : movement > 0 ? "up" : movement < 0 ? "down" : previousPosition ? "steady" : "new",
        medal: hasAnyCompletedDrill && completedDrills > 0 && position === 1 ? "gold" : hasAnyCompletedDrill && completedDrills > 0 && position === 2 ? "silver" : hasAnyCompletedDrill && completedDrills > 0 && position === 3 ? "bronze" : null,
        completed_drills: completedDrills,
        recent_completed: Number(row.recent_completed || 0),
        average_score: normalizePercent(row.average_score),
        recent_score: recentScore,
        prior_recent_score: priorRecentScore,
        improvement_points: improvement,
        latest_drill_date: dateOnly(row.latest_drill_date),
        current_streak_days: streak.days,
        streak_active: streakActive,
        streak_started: streakStarted,
        streak_latest_date: streak.latest,
        streak_key: streakActive ? `${row.student_id}:${streak.latest}:${streak.days}:${Number(row.recent_completed || 0)}` : null,
        is_current_student: Number(row.student_id) === Number(student.id),
      }
      normalized.award = rankingAward(normalized)
      normalized.celebrations = rankingCelebrations(normalized)
      return normalized
    })
  const current = ranked.find((row) => row.is_current_student) || null
  const leader = ranked.find((row) => Number(row.completed_drills || 0) > 0) || null
  const participantCount = ranked.filter((row) => Number(row.completed_drills || 0) > 0).length
  return {
    class_id: Number(student.current_class_id),
    class_name: student.class_name || "",
    generated_at: new Date().toISOString(),
    summary: {
      class_size: ranked.length,
      participant_count: participantCount,
      current_position: current?.position || null,
      current_average: current?.average_score ?? null,
      current_completed: current?.completed_drills || 0,
      current_movement: current?.movement || 0,
      current_award: current?.award || null,
      leader_name: leader?.full_name || null,
      leader_average: leader?.average_score ?? null,
    },
    celebrations: current?.celebrations || [],
    leaderboard: ranked,
    movements: ranked
      .filter((row) => row.movement_direction === "up" || row.movement_direction === "down")
      .sort((a, b) => Math.abs(Number(b.movement || 0)) - Math.abs(Number(a.movement || 0)))
      .slice(0, 8),
    awards: ranked
      .filter((row) => row.award)
      .sort((a, b) => Number(b.improvement_points || 0) - Number(a.improvement_points || 0) || a.position - b.position)
      .slice(0, 6),
  }
}

function messageIsVisibleToStudent(message, student) {
  if (message.message_type !== "announcement") return false
  const scope = parseJsonObject(message.recipient_scope)
  const type = String(scope.type || scope.scope || "").toLowerCase()
  if (["school", "whole_school", "students", "student_body"].includes(type)) return true
  if (type === "class" && Number(scope.class_id || scope.classId) === Number(student.current_class_id)) return true
  if (type === "classes" && Array.isArray(scope.class_ids)) {
    return scope.class_ids.map(Number).includes(Number(student.current_class_id))
  }
  return false
}

async function loadNotices(schoolId, student, session) {
  const [events] = await pool.query(
    `SELECT e.id, e.title, e.description, e.event_type, e.start_datetime, e.end_datetime,
      e.all_day, e.visibility, e.status, e.created_at, c.name AS class_name, subj.name AS subject_name
     FROM school_events e
     LEFT JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id
     LEFT JOIN subjects subj ON subj.id = e.subject_id AND subj.school_id = e.school_id
     WHERE e.school_id = ?
       AND e.status NOT IN ('draft', 'cancelled', 'archived')
       AND (e.term_id IS NULL OR e.term_id = ?)
       AND (
         e.visibility IN ('whole_school', 'students')
         OR (e.visibility = 'class_only' AND e.class_id = ?)
       )
     ORDER BY e.start_datetime DESC
     LIMIT 30`,
    [schoolId, session.termId || null, student.current_class_id || 0],
  )
  const [messages] = await pool.query(
    `SELECT id, message_type, subject, body, recipient_scope, channel, delivery_status, created_at
     FROM messages
     WHERE school_id = ? AND message_type = 'announcement'
     ORDER BY created_at DESC
     LIMIT 50`,
    [schoolId],
  )
  const eventNotices = events.map((event) => ({
    id: `event-${event.id}`,
    title: event.title,
    body: event.description,
    type: valueLabel(event.event_type),
    date: dateTimeIso(event.start_datetime),
    ends_at: dateTimeIso(event.end_datetime),
    scope: event.visibility,
    status: event.status,
    source: "calendar",
  }))
  const messageNotices = messages
    .filter((message) => messageIsVisibleToStudent(message, student))
    .map((message) => {
      const scope = parseJsonObject(message.recipient_scope)
      return {
        id: `message-${message.id}`,
        title: message.subject,
        body: message.body,
        type: valueLabel(message.message_type),
        date: dateTimeIso(message.created_at),
        ends_at: null,
        scope: scope.type || "school",
        status: message.delivery_status,
        source: "announcement",
        image_url: scope.image_url || null,
        poll: scope.poll || null,
        reactions: announcementReactions(scope),
        responsible_teacher_id: scope.responsible_teacher_id || null,
        responsible_teacher_name: scope.responsible_teacher_name || null,
        ...engagementPayload(scope, student.id),
      }
    })
  return { items: [...eventNotices, ...messageNotices].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))) }
}

async function updateAnnouncementEngagement(req, updater) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const student = await resolveStudent(req, schoolId, session)
  const messageId = announcementMessageId(req.params.id)
  if (!messageId) throw new HttpError(400, "Announcement id is required")

  const [[message]] = await pool.query(
    `SELECT id, message_type, recipient_scope
     FROM messages
     WHERE school_id = ? AND id = ? AND message_type = 'announcement'
     LIMIT 1`,
    [schoolId, messageId],
  )
  if (!message || !messageIsVisibleToStudent(message, student)) throw new HttpError(404, "Announcement was not found")

  const scope = parseJsonObject(message.recipient_scope)
  const engagement = parseJsonObject(scope.engagement)
  engagement.reactions = engagement.reactions && typeof engagement.reactions === "object" ? engagement.reactions : {}
  engagement.poll_votes = engagement.poll_votes && typeof engagement.poll_votes === "object" ? engagement.poll_votes : {}
  updater(scope, engagement, student)
  scope.engagement = engagement

  await pool.query(
    "UPDATE messages SET recipient_scope = ? WHERE school_id = ? AND id = ?",
    [JSON.stringify(scope), schoolId, messageId],
  )
  return {
    id: messageId,
    ...engagementPayload(scope, student.id),
  }
}

export async function reactToAnnouncement(req, res) {
  const payload = await updateAnnouncementEngagement(req, (scope, engagement, student) => {
    const reaction = String(req.body.reaction || "").trim()
    const allowed = announcementReactions(scope)
    if (reaction && !allowed.includes(reaction)) throw new HttpError(400, "Reaction is not available for this announcement")
    if (reaction) engagement.reactions[String(student.id)] = reaction
    else delete engagement.reactions[String(student.id)]
  })
  res.json({ announcement: payload })
}

export async function voteAnnouncementPoll(req, res) {
  const payload = await updateAnnouncementEngagement(req, (scope, engagement, student) => {
    const optionId = String(req.body.option_id || req.body.optionId || "").trim()
    const options = Array.isArray(scope.poll?.options) ? scope.poll.options : []
    if (!optionId || !options.some((option) => String(option.id) === optionId)) {
      throw new HttpError(400, "Select a valid poll option")
    }
    engagement.poll_votes[String(student.id)] = optionId
  })
  res.json({ announcement: payload })
}

function buildUrgent({ fees, results, homework, attendance }) {
  const overdueFee = fees.accounts.find((account) => account.overdue)
  if (overdueFee) {
    return {
      type: "fees_overdue",
      tone: "bad",
      title: "Fees overdue",
      message: `${overdueFee.term_name}: MWK ${overdueFee.balance.toLocaleString()} outstanding.`,
    }
  }

  if (results.latest_report) {
    const report = results.latest_report
    return {
      type: "latest_results",
      tone: report.remark === "PASS" ? "good" : "warn",
      title: "Latest result is ready",
      message: `${report.exam_session_name || report.term_name}: ${report.average_score ?? "-"}% average${report.position ? `, position ${report.position} of ${report.class_total}` : ""}.`,
      report_card_id: report.report_card_id,
    }
  }

  const overdueHomework = homework.assignments.find((assignment) => assignment.submission_status === "overdue")
  if (overdueHomework) {
    return {
      type: "homework_overdue",
      tone: "warn",
      title: "Homework overdue",
      message: `${overdueHomework.subject_name}: ${overdueHomework.title} was due on ${overdueHomework.due_date}.`,
    }
  }

  if (attendance.summary.attendance_percent !== null && attendance.summary.attendance_percent < 85) {
    return {
      type: "attendance_attention",
      tone: "warn",
      title: "Attendance needs attention",
      message: `Attendance is ${attendance.summary.attendance_percent}% this term with ${attendance.summary.absences} absence records.`,
    }
  }

  return {
    type: "all_clear",
    tone: "good",
    title: "Everything looks current",
    message: "No overdue fee, homework, or attendance alert is waiting right now.",
  }
}

export async function getStudentPortal(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  const { student, guardianContext } = await resolveStudent(req, schoolId, session)
  const [guardians] = await pool.query(
    `SELECT guardian_number, full_name, relationship, primary_phone, secondary_phone, email
     FROM student_guardians
     WHERE school_id = ? AND student_id = ?
     ORDER BY guardian_number`,
    [schoolId, student.id],
  )

  const [results, fees, homework, attendance, timetable, notices, ranking] = await Promise.all([
    loadResults(schoolId, student.id),
    loadFees(schoolId, student.id, session.term?.name || student.term_name || ""),
    loadHomework(schoolId, student, session),
    loadAttendance(schoolId, student, session),
    loadTimetable(schoolId, student, session),
    loadNotices(schoolId, student, session),
    loadDrillRanking(schoolId, student, session),
  ])

  const payload = {
    generated_at: new Date().toISOString(),
    viewer: {
      role: guardianContext.is_parent ? "parent" : "student",
      guardian_context: guardianContext,
    },
    setup_required: Boolean(session.setupRequired),
    session: sessionPayload(session),
    profile: {
      id: student.id,
      student_id: student.student_code,
      admission_no: student.admission_no,
      first_name: student.first_name,
      last_name: student.last_name,
      full_name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      date_of_birth: dateOnly(student.date_of_birth),
      gender: student.gender,
      profile_photo_url: student.profile_photo_url || null,
      class_id: student.current_class_id,
      class_name: student.class_name,
      stream_section: student.current_stream_section,
      academic_year_name: student.academic_year_name || session.academicYear?.name || null,
      term_name: student.term_name || session.term?.name || null,
      enrollment_status: student.enrollment_status,
      guardians,
    },
    urgent: buildUrgent({ fees, results, homework, attendance }),
    results,
    fees,
    timetable,
    homework,
    attendance,
    notices,
    ranking,
  }

  res.json({ student_portal: payload })
}

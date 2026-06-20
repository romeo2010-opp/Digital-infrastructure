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

async function resolveStudent(req, schoolId, session) {
  const studentId = Number(req.user?.studentId || req.user?.id || 0)
  const sessionJoin = session.setupRequired
    ? "AND se.enrollment_status = 'active'"
    : "AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'"
  const sessionParams = session.setupRequired ? [] : [session.academicYearId, session.termId]
  const [rows] = await pool.query(
    `SELECT s.id, s.school_id, s.class_id AS fallback_class_id,
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
  return {
    ...student,
    id: Number(student.id),
    current_enrollment_id: student.current_enrollment_id ? Number(student.current_enrollment_id) : null,
    current_class_id: student.current_class_id ? Number(student.current_class_id) : null,
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
    const score = nullableNumber(subject.score)
    const rawScore = subject.raw_score === null ? score : nullableNumber(subject.raw_score)
    report.subjects.push({
      ...subject,
      id: Number(subject.id),
      score,
      raw_score: rawScore,
      total_marks: nullableNumber(subject.total_marks),
      total_percent: score,
      last_saved_at: dateTimeIso(subject.last_saved_at),
    })
  })

  const normalizedReports = [...reportsById.values()].map((report) => {
    const failedSubjects = report.subjects.filter((subject) => numberValue(subject.total_percent) < 50).length
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
        score: nullableNumber(subject.total_percent),
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
  const student = await resolveStudent(req, schoolId, session)
  const [guardians] = await pool.query(
    `SELECT guardian_number, full_name, relationship, primary_phone, secondary_phone, email
     FROM student_guardians
     WHERE school_id = ? AND student_id = ?
     ORDER BY guardian_number`,
    [schoolId, student.id],
  )

  const [results, fees, homework, attendance, timetable, notices] = await Promise.all([
    loadResults(schoolId, student.id),
    loadFees(schoolId, student.id, session.term?.name || student.term_name || ""),
    loadHomework(schoolId, student, session),
    loadAttendance(schoolId, student, session),
    loadTimetable(schoolId, student, session),
    loadNotices(schoolId, student, session),
  ])

  const payload = {
    generated_at: new Date().toISOString(),
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
  }

  res.json({ student_portal: payload })
}

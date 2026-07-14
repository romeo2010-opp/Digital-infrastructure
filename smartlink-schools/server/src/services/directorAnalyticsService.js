import { pool } from "../config/db.js"
import { getActiveAcademicSession, sessionPayload } from "./academicSessionService.js"
import { getWithdrawalById, listStudentWithdrawals } from "./studentWithdrawalService.js"
import {
  generateAcademicInsights,
  generateCapacityInsights,
  generateFinanceInsights,
  generateMarksSubmissionInsights,
  generateOperationsInsights,
  generateStaffInsights,
  generateSubjectInsights,
  generateWithdrawalInsights,
} from "./directorInsightService.js"

const DETAIL_SECTIONS = new Set([
  "academics-subject-trends",
  "academics-marks-submission",
  "admissions-class-capacity",
  "admissions-withdrawals",
  "staff-teacher-compliance",
  "academics-at-risk-students",
])

const DIRECTOR_DEFAULTS = {
  academic_pass_mark: 50,
  at_risk_score_threshold: 25,
  critical_risk_threshold: 75,
  fee_collection_target_percent: 80,
  overdue_balance_threshold: 1,
  high_debt_threshold: 500000,
  default_class_capacity: 30,
  capacity_warning_threshold: 90,
  complaint_overdue_days: 7,
  incident_escalation_threshold: 2,
}

export const directorEndpointSections = {
  "/finance/fee-collection": "finance-fee-collection",
  "/finance/outstanding-balances": "finance-outstanding-balances",
  "/finance/discounts-bursaries": "finance-discounts-bursaries",
  "/finance/expenses": "finance-expenses",
  "/finance/financial-reports": "finance-financial-reports",
  "/admissions/enrollment-pipeline": "admissions-enrollment-pipeline",
  "/admissions/class-capacity": "admissions-class-capacity",
  "/admissions/withdrawals": "admissions-withdrawals",
  "/academics/performance-overview": "academics-performance-overview",
  "/academics/at-risk-students": "academics-at-risk-students",
  "/academics/subject-trends": "academics-subject-trends",
  "/academics/marks-submission": "academics-marks-submission",
  "/staff/teacher-compliance": "staff-teacher-compliance",
  "/staff/attendance": "staff-attendance",
  "/staff/workload": "staff-workload",
  "/operations/incidents": "operations-incidents",
  "/operations/complaints": "operations-complaints",
  "/operations/approvals": "operations-approvals",
  "/reports/director-report": "reports-director-report",
  "/reports/term-report": "reports-term-report",
  "/reports/export-center": "reports-export-center",
  "/audit-security": "audit-security",
  "/settings": "settings",
}

function optionalDataError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_SP_DOES_NOT_EXIST"].includes(error?.code)
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params)
    return rows
  } catch (error) {
    if (optionalDataError(error)) return fallback
    throw error
  }
}

async function safeOne(sql, params = [], fallback = {}) {
  const rows = await safeQuery(sql, params, [fallback])
  return rows[0] || fallback
}

function numberValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function moneyValue(value) {
  return Number(numberValue(value).toFixed(2))
}

function percentValue(part, whole) {
  const denominator = numberValue(whole)
  if (denominator <= 0) return 0
  return Number(((numberValue(part) / denominator) * 100).toFixed(1))
}

function moneyLabel(value) {
  return `MWK ${moneyValue(value).toLocaleString()}`
}

function percentLabel(value) {
  return `${numberValue(value).toFixed(1)}%`
}

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function daysBetween(from, to) {
  const start = new Date(`${dateOnly(from)}T00:00:00Z`)
  const end = new Date(`${dateOnly(to)}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function normalizeStatusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ")
}

function kpi(label, value, helper = "", tone = "neutral", extra = {}) {
  return { label, value, helper, tone, ...extra }
}

function table(title, rows, columns, options = {}) {
  return {
    title,
    subtitle: options.subtitle || `${rows.length} record${rows.length === 1 ? "" : "s"}`,
    rows,
    columns,
    empty_state: options.empty_state || null,
  }
}

function chart(type, title, data, config = {}) {
  return {
    type,
    title,
    data,
    xKey: config.xKey || "name",
    series: config.series || [{ key: "value", label: "Value" }],
    empty_state: config.empty_state || null,
  }
}

function makePage({ section, title, description, session, kpis = [], insights = [], charts = [], tables = [], filters = [], report_sections = [], detail = null, empty_state = null }) {
  const firstTable = tables[0] || { rows: [], columns: [] }
  const selectedKpis = [...new Map(kpis.map((item) => [String(item?.label || "").trim().toLowerCase(), item])).values()]
    .slice(0, 4)
    .map((item) => ({ ...item, id: `${section}:${String(item.label || "metric").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` }))
  return {
    section,
    title,
    description,
    session: sessionPayload(session),
    kpis: selectedKpis,
    insights,
    charts,
    tables,
    filters,
    report_sections,
    detail,
    rows: firstTable.rows || [],
    columns: firstTable.columns || [],
    empty_state: empty_state || firstTable.empty_state || {
      title: "No records available yet",
      message: "This Director page is connected to SmartLink Schools data and will populate when records are available.",
    },
  }
}

function termFilter(alias, session, includeNullLegacy = true) {
  if (session.setupRequired || !session.academicYearId || !session.termId) return { clause: "", params: [] }
  const prefix = alias ? `${alias}.` : ""
  if (includeNullLegacy) {
    return {
      clause: ` AND (${prefix}academic_year_id = ? OR ${prefix}academic_year_id IS NULL) AND (${prefix}term_id = ? OR ${prefix}term_id IS NULL)`,
      params: [session.academicYearId, session.termId],
    }
  }
  return {
    clause: ` AND ${prefix}academic_year_id = ? AND ${prefix}term_id = ?`,
    params: [session.academicYearId, session.termId],
  }
}

function resultDateExpression() {
  return "COALESCE(ett.exam_date, DATE(rb.submitted_at), DATE(rb.updated_at), DATE(a.updated_at), DATE(a.created_at))"
}

export function normalizeDirectorSection(value) {
  const normalized = String(value || "overview")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^director\/?/, "")
    .split("/")
    .filter(Boolean)
  if (!normalized.length) return { section: "overview", detailId: null }
  if (normalized[0] === "overview") return { section: "overview", detailId: normalized[1] || null }
  if (normalized[0] === "audit-security" || normalized[0] === "settings") return { section: normalized[0], detailId: normalized[1] || null }
  const section = normalized.length >= 2 ? `${normalized[0]}-${normalized[1]}` : normalized[0]
  return { section, detailId: normalized[2] || null }
}

async function getDirectorSettings(schoolId) {
  const rows = await safeQuery("SELECT setting_key, setting_value FROM director_settings WHERE school_id = ?", [schoolId])
  const settings = { ...DIRECTOR_DEFAULTS }
  for (const row of rows) {
    if (row.setting_key in settings) settings[row.setting_key] = Number(row.setting_value)
  }
  return settings
}

export async function saveDirectorSettings(schoolId, userId, payload = {}) {
  const allowed = Object.keys(DIRECTOR_DEFAULTS)
  const entries = allowed
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== "")
    .map((key) => [schoolId, key, String(Number(payload[key])), userId || null])
    .filter((entry) => Number.isFinite(Number(entry[2])))
  if (!entries.length) return getDirectorSettings(schoolId)
  await pool.query(
    `INSERT INTO director_settings (school_id, setting_key, setting_value, updated_by)
     VALUES ${entries.map(() => "(?, ?, ?, ?)").join(", ")}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    entries.flat(),
  )
  return getDirectorSettings(schoolId)
}

async function getFinanceCore(schoolId, session, settings) {
  const feeTerm = termFilter("fa", session, true)
  const paymentTerm = termFilter("fa", session, true)
  const total = await safeOne(
    `SELECT
       COUNT(DISTINCT fa.student_id) AS students_with_accounts,
       COUNT(DISTINCT CASE WHEN (fa.amount_due - fa.amount_paid) > 0 THEN fa.student_id END) AS students_with_balances,
       COUNT(DISTINCT CASE WHEN fa.amount_due > 0 AND fa.amount_paid >= fa.amount_due THEN fa.student_id END) AS fully_paid_students,
       COUNT(DISTINCT CASE WHEN fa.amount_paid > 0 AND fa.amount_paid < fa.amount_due THEN fa.student_id END) AS partially_paid_students,
       COUNT(DISTINCT CASE WHEN fa.amount_paid <= 0 AND fa.amount_due > 0 THEN fa.student_id END) AS unpaid_students,
       COALESCE(SUM(fa.amount_due), 0) AS total_billed,
       COALESCE(SUM(fa.amount_paid), 0) AS total_collected,
       COALESCE(SUM(GREATEST(fa.amount_due - fa.amount_paid, 0)), 0) AS total_outstanding,
       COALESCE(SUM(CASE WHEN fa.due_date IS NOT NULL AND fa.due_date < CURDATE() THEN GREATEST(fa.amount_due - fa.amount_paid, 0) ELSE 0 END), 0) AS overdue_balance,
       COALESCE(MAX(GREATEST(fa.amount_due - fa.amount_paid, 0)), 0) AS highest_balance
     FROM fee_accounts fa
     WHERE fa.school_id = ?${feeTerm.clause}`,
    [schoolId, ...feeTerm.params],
    {},
  )
  const today = await safeOne(
    `SELECT
       COALESCE(SUM(CASE WHEN DATE(COALESCE(fp.paid_on, fp.paid_at)) = CURDATE() THEN fp.amount ELSE 0 END), 0) AS collected_today,
       COALESCE(SUM(CASE WHEN DATE(COALESCE(fp.paid_on, fp.paid_at)) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN fp.amount ELSE 0 END), 0) AS collected_week,
       COUNT(*) AS payment_count
     FROM fee_payments fp
     JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
     WHERE fp.school_id = ? AND (fp.status IS NULL OR fp.status = 'posted')${paymentTerm.clause}`,
    [schoolId, ...paymentTerm.params],
    {},
  )
  const classRows = await safeQuery(
    `SELECT c.id AS class_id, c.public_ref AS class_public_ref, c.name AS class_name, c.grade_level,
       COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END) AS active_students,
       COALESCE(SUM(fa.amount_due), 0) AS total_billed,
       COALESCE(SUM(fa.amount_paid), 0) AS total_collected,
       COALESCE(SUM(GREATEST(fa.amount_due - fa.amount_paid, 0)), 0) AS outstanding
     FROM classes c
     LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id
     LEFT JOIN fee_accounts fa ON fa.student_id = s.id AND fa.school_id = s.school_id${feeTerm.clause}
     WHERE c.school_id = ?
     GROUP BY c.id, c.name, c.grade_level
     ORDER BY outstanding DESC, c.name`,
    [...feeTerm.params, schoolId],
  )
  const classes = classRows.map((row) => ({
    ...row,
    active_students: numberValue(row.active_students),
    total_billed: moneyValue(row.total_billed),
    total_collected: moneyValue(row.total_collected),
    outstanding: moneyValue(row.outstanding),
    collection_rate: percentValue(row.total_collected, row.total_billed),
    detail_path: `/admissions/class-capacity/${row.class_public_ref}`,
  }))
  const trend = await safeQuery(
    `SELECT DATE(COALESCE(fp.paid_on, fp.paid_at)) AS payment_date,
       COALESCE(SUM(fp.amount), 0) AS collected
     FROM fee_payments fp
     JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
     WHERE fp.school_id = ? AND (fp.status IS NULL OR fp.status = 'posted')${paymentTerm.clause}
     GROUP BY DATE(COALESCE(fp.paid_on, fp.paid_at))
     ORDER BY payment_date
     LIMIT 60`,
    [schoolId, ...paymentTerm.params],
  )
  const recentPayments = await safeQuery(
    `SELECT fp.id, DATE(COALESCE(fp.paid_on, fp.paid_at)) AS payment_date, fp.amount,
       fp.payment_method, fp.reference, fp.receipt_no,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.public_ref AS student_public_ref,
       COALESCE(s.student_id, s.admission_no) AS student_code,
       c.name AS class_name,
       u.full_name AS recorded_by_name
     FROM fee_payments fp
     JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
     JOIN students s ON s.id = fa.student_id AND s.school_id = fa.school_id
     LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     LEFT JOIN users u ON u.id = fp.recorded_by AND u.school_id = fp.school_id
     WHERE fp.school_id = ? AND (fp.status IS NULL OR fp.status = 'posted')${paymentTerm.clause}
     ORDER BY payment_date DESC, fp.id DESC
     LIMIT 100`,
    [schoolId, ...paymentTerm.params],
  )
  const owingRows = await safeQuery(
    `SELECT s.id AS student_id, s.public_ref AS student_public_ref, COALESCE(s.student_id, s.admission_no) AS student_code,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       c.name AS class_name,
       sg.primary_phone AS guardian_contact,
       COALESCE(SUM(fa.amount_due), 0) AS total_billed,
       COALESCE(SUM(fa.amount_paid), 0) AS paid,
       COALESCE(SUM(GREATEST(fa.amount_due - fa.amount_paid, 0)), 0) AS balance,
       MAX(DATE(COALESCE(fp.paid_on, fp.paid_at))) AS last_payment_date,
       CASE
         WHEN COALESCE(SUM(fa.amount_paid), 0) <= 0 THEN 'unpaid'
         WHEN COALESCE(SUM(GREATEST(fa.amount_due - fa.amount_paid, 0)), 0) <= 0 THEN 'paid'
         ELSE 'partial'
       END AS payment_status
     FROM fee_accounts fa
     JOIN students s ON s.id = fa.student_id AND s.school_id = fa.school_id
     LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.school_id = s.school_id AND sg.guardian_number = 1
     LEFT JOIN fee_payments fp ON fp.fee_account_id = fa.id AND fp.school_id = fa.school_id AND (fp.status IS NULL OR fp.status = 'posted')
     WHERE fa.school_id = ?${feeTerm.clause}
     GROUP BY s.id, s.public_ref, s.student_id, s.admission_no, s.first_name, s.last_name, c.name, sg.primary_phone
     HAVING balance > 0
     ORDER BY balance DESC
     LIMIT 200`,
    [schoolId, ...feeTerm.params],
  )
  const owingStudents = owingRows.map((row) => ({
    ...row,
    total_billed: moneyValue(row.total_billed),
    paid: moneyValue(row.paid),
    balance: moneyValue(row.balance),
    status: row.payment_status,
    detail_path: `/students/${row.student_public_ref}`,
  }))
  const methodBreakdown = await safeQuery(
    `SELECT COALESCE(NULLIF(fp.payment_method, ''), 'unspecified') AS method, COALESCE(SUM(fp.amount), 0) AS amount, COUNT(*) AS payments
     FROM fee_payments fp
     JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
     WHERE fp.school_id = ? AND (fp.status IS NULL OR fp.status = 'posted')${paymentTerm.clause}
     GROUP BY COALESCE(NULLIF(fp.payment_method, ''), 'unspecified')
     ORDER BY amount DESC`,
    [schoolId, ...paymentTerm.params],
  )
  const highDebtStudents = owingStudents.filter((row) => numberValue(row.balance) >= numberValue(settings.high_debt_threshold)).length
  const totalBilled = moneyValue(total.total_billed)
  const totalCollected = moneyValue(total.total_collected)
  const totalOutstanding = moneyValue(total.total_outstanding)
  const topOutstandingClass = [...classes].sort((a, b) => numberValue(b.outstanding) - numberValue(a.outstanding))[0] || null
  const weakestClass = [...classes].filter((row) => numberValue(row.total_billed) > 0).sort((a, b) => numberValue(a.collection_rate) - numberValue(b.collection_rate))[0] || null
  return {
    totals: {
      ...total,
      ...today,
      total_billed: totalBilled,
      total_collected: totalCollected,
      total_outstanding: totalOutstanding,
      overdue_balance: moneyValue(total.overdue_balance),
      highest_balance: moneyValue(total.highest_balance),
      collection_rate: percentValue(totalCollected, totalBilled),
      students_with_accounts: numberValue(total.students_with_accounts),
      students_with_balances: numberValue(total.students_with_balances),
      fully_paid_students: numberValue(total.fully_paid_students),
      partially_paid_students: numberValue(total.partially_paid_students),
      unpaid_students: numberValue(total.unpaid_students),
      collected_today: moneyValue(today.collected_today),
      collected_week: moneyValue(today.collected_week),
      payment_count: numberValue(today.payment_count),
      high_debt_students: highDebtStudents,
    },
    classes,
    trend: trend.map((row) => ({ payment_date: dateOnly(row.payment_date), collected: moneyValue(row.collected) })),
    recentPayments: recentPayments.map((row) => ({ ...row, amount: moneyValue(row.amount), detail_path: row.student_public_ref ? `/students/${row.student_public_ref}` : undefined })),
    owingStudents,
    methodBreakdown: methodBreakdown.map((row) => ({ ...row, amount: moneyValue(row.amount), payments: numberValue(row.payments) })),
    insightMetrics: {
      totalBilled,
      totalCollected,
      totalOutstanding,
      collectionRate: percentValue(totalCollected, totalBilled),
      targetRate: settings.fee_collection_target_percent,
      highDebtStudents,
      highDebtThreshold: settings.high_debt_threshold,
      topOutstandingClass,
      weakestClass,
    },
  }
}

async function getDiscountAnalytics(schoolId, session) {
  const feeTerm = termFilter("fa", session, true)
  const rows = await safeQuery(
    `SELECT fd.id, fd.discount_type, fd.amount_type, fd.amount_value,
       CASE WHEN fd.amount_type = 'percent' THEN COALESCE(fa.amount_due, 0) * fd.amount_value / 100 ELSE fd.amount_value END AS discount_amount,
       fd.status, fd.reason, fd.created_at,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.public_ref AS student_public_ref,
       COALESCE(s.student_id, s.admission_no) AS student_code,
       c.name AS class_name,
       requester.full_name AS requested_by_name,
       approver.full_name AS approved_by_name
     FROM finance_discounts fd
     JOIN students s ON s.id = fd.student_id AND s.school_id = fd.school_id
     LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
     LEFT JOIN fee_accounts fa ON fa.id = fd.fee_account_id AND fa.school_id = fd.school_id${feeTerm.clause}
     LEFT JOIN users requester ON requester.id = fd.requested_by AND requester.school_id = fd.school_id
     LEFT JOIN users approver ON approver.id = fd.approved_by AND approver.school_id = fd.school_id
     WHERE fd.school_id = ?
     ORDER BY fd.created_at DESC
     LIMIT 200`,
    [...feeTerm.params, schoolId],
  )
  const discountRows = rows.map((row) => ({
    ...row,
    discount_amount: moneyValue(row.discount_amount),
    amount_value: numberValue(row.amount_value),
    detail_path: row.student_public_ref ? `/students/${row.student_public_ref}` : undefined,
  }))
  const totalDiscounts = discountRows.reduce((sum, row) => sum + numberValue(row.discount_amount), 0)
  const pending = discountRows.filter((row) => row.status === "pending").length
  const largest = Math.max(0, ...discountRows.map((row) => numberValue(row.discount_amount)))
  const students = new Set(discountRows.map((row) => row.student_code).filter(Boolean)).size
  const byClassMap = new Map()
  for (const row of discountRows) {
    const key = row.class_name || "Unassigned"
    byClassMap.set(key, numberValue(byClassMap.get(key)) + numberValue(row.discount_amount))
  }
  const byClass = [...byClassMap.entries()].map(([class_name, amount]) => ({ class_name, amount: moneyValue(amount) })).sort((a, b) => numberValue(b.amount) - numberValue(a.amount))
  return { rows: discountRows, totalDiscounts, pending, largest, students, byClass }
}

async function getExpenseAnalytics(schoolId, session) {
  const rows = await safeQuery(
    `SELECT fe.id, fe.title, fe.category, fe.supplier, fe.amount, fe.expense_date, fe.status,
       fe.description, requester.full_name AS requested_by_name, approver.full_name AS approved_by_name
     FROM finance_expenses fe
     LEFT JOIN users requester ON requester.id = fe.created_by AND requester.school_id = fe.school_id
     LEFT JOIN users approver ON approver.id = fe.approved_by AND approver.school_id = fe.school_id
     WHERE fe.school_id = ?${session.setupRequired ? "" : " AND fe.expense_date BETWEEN ? AND ?"}
     ORDER BY fe.expense_date DESC, fe.id DESC
     LIMIT 200`,
    session.setupRequired ? [schoolId] : [schoolId, dateOnly(session.term.start_date), dateOnly(session.term.end_date)],
  )
  const expenseRows = rows.map((row) => ({ ...row, amount: moneyValue(row.amount), expense_date: dateOnly(row.expense_date) }))
  const total = expenseRows.reduce((sum, row) => sum + numberValue(row.amount), 0)
  const pending = expenseRows.filter((row) => row.status === "pending_approval" || row.status === "draft").reduce((sum, row) => sum + numberValue(row.amount), 0)
  const approved = expenseRows.filter((row) => row.status === "approved" || row.status === "paid").reduce((sum, row) => sum + numberValue(row.amount), 0)
  const largest = Math.max(0, ...expenseRows.map((row) => numberValue(row.amount)))
  const byCategoryMap = new Map()
  const trendMap = new Map()
  for (const row of expenseRows) {
    const category = normalizeStatusLabel(row.category)
    byCategoryMap.set(category, numberValue(byCategoryMap.get(category)) + numberValue(row.amount))
    const date = row.expense_date || "Unscheduled"
    trendMap.set(date, numberValue(trendMap.get(date)) + numberValue(row.amount))
  }
  const byCategory = [...byCategoryMap.entries()].map(([category, amount]) => ({ category, amount: moneyValue(amount) })).sort((a, b) => numberValue(b.amount) - numberValue(a.amount))
  const trend = [...trendMap.entries()].map(([expense_date, amount]) => ({ expense_date, amount: moneyValue(amount) })).sort((a, b) => String(a.expense_date).localeCompare(String(b.expense_date)))
  return { rows: expenseRows, total: moneyValue(total), pending: moneyValue(pending), approved: moneyValue(approved), largest: moneyValue(largest), byCategory, trend }
}

async function getAcademicCore(schoolId, session, settings) {
  const rbTerm = termFilter("rb", session, false)
  const passMark = numberValue(settings.academic_pass_mark)
  const rows = await safeQuery(
    `SELECT re.id, re.student_id, s.public_ref AS student_public_ref, rb.id AS batch_id, rb.public_ref AS batch_public_ref, rb.subject_id, rb.class_id, rb.teacher_id,
       rb.status AS batch_status, re.status AS entry_status, re.score, a.total_marks,
       a.name AS assessment_name, subj.name AS subject_name, subj.public_ref AS subject_public_ref, c.name AS class_name, c.public_ref AS class_public_ref,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       COALESCE(s.student_id, s.admission_no) AS student_code,
       u.full_name AS teacher_name,
       ${resultDateExpression()} AS assessment_date,
       CASE WHEN sw.id IS NULL THEN 0 ELSE 1 END AS withdrawal_absence
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN students s ON s.id = re.student_id AND s.school_id = re.school_id
     LEFT JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.assessment_id = a.id AND ett.school_id = a.school_id AND ett.status <> 'cancelled'
     LEFT JOIN student_withdrawals sw ON sw.school_id = re.school_id AND sw.student_id = re.student_id AND sw.status <> 'cancelled'
       AND sw.start_date <= ${resultDateExpression()}
       AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ${resultDateExpression()})
     WHERE re.school_id = ?${rbTerm.clause}
     ORDER BY assessment_date DESC, re.id DESC`,
    [schoolId, ...rbTerm.params],
  )
  const normalized = rows.map((row) => {
    const totalMarks = Math.max(1, numberValue(row.total_marks || 100))
    const absent = row.entry_status === "absent"
    const scorePercent = absent || row.score === null || row.score === undefined ? null : Number(((numberValue(row.score) / totalMarks) * 100).toFixed(1))
    return {
      ...row,
      assessment_date: dateOnly(row.assessment_date),
      score_percent: scorePercent,
      is_absent: absent,
      withdrawal_absence: numberValue(row.withdrawal_absence),
    }
  })
  const scored = normalized.filter((row) => row.score_percent !== null)
  const overallAverage = scored.length ? Number((scored.reduce((sum, row) => sum + numberValue(row.score_percent), 0) / scored.length).toFixed(1)) : 0
  const passCount = scored.filter((row) => numberValue(row.score_percent) >= passMark).length
  const passRate = percentValue(passCount, scored.length)
  const failRate = scored.length ? Number((100 - passRate).toFixed(1)) : 0
  const classMap = new Map()
  const subjectAssessmentMap = new Map()
  const subjectStudentLatest = new Map()
  for (const row of normalized) {
    if (!classMap.has(row.class_id)) classMap.set(row.class_id, { class_id: row.class_id, class_public_ref: row.class_public_ref, class_name: row.class_name, scores: [], passes: 0, total: 0, absent_count: 0 })
    const classItem = classMap.get(row.class_id)
    if (row.is_absent) classItem.absent_count += 1
    if (row.score_percent !== null) {
      classItem.scores.push(row.score_percent)
      classItem.total += 1
      if (row.score_percent >= passMark) classItem.passes += 1
    }
    const assessmentKey = `${row.subject_id}:${row.batch_id}`
    if (!subjectAssessmentMap.has(assessmentKey)) {
      subjectAssessmentMap.set(assessmentKey, {
        subject_id: row.subject_id,
        subject_name: row.subject_name,
        subject_public_ref: row.subject_public_ref,
        assessment_id: row.batch_id,
        assessment_name: row.assessment_name,
        assessment_date: row.assessment_date,
        scores: [],
        pass_count: 0,
        fail_count: 0,
        absent_count: 0,
        withdrawal_absences: 0,
      })
    }
    const subjectAssessment = subjectAssessmentMap.get(assessmentKey)
    if (row.is_absent) {
      subjectAssessment.absent_count += 1
      subjectAssessment.withdrawal_absences += numberValue(row.withdrawal_absence) ? 1 : 0
    } else if (row.score_percent !== null) {
      subjectAssessment.scores.push(row.score_percent)
      if (row.score_percent >= passMark) subjectAssessment.pass_count += 1
      else subjectAssessment.fail_count += 1
    }
    const studentSubjectKey = `${row.subject_id}:${row.student_id}`
    const currentLatest = subjectStudentLatest.get(studentSubjectKey)
    if (!currentLatest || String(row.assessment_date).localeCompare(String(currentLatest.assessment_date || "")) >= 0) {
      subjectStudentLatest.set(studentSubjectKey, row)
    }
  }
  const classPerformance = [...classMap.values()].map((row) => ({
    class_id: row.class_id,
    class_name: row.class_name,
    average_score: row.scores.length ? Number((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length).toFixed(1)) : 0,
    pass_rate: percentValue(row.passes, row.total),
    absent_count: row.absent_count,
    result_count: row.total,
    detail_path: `/admissions/class-capacity/${row.class_public_ref}`,
  })).sort((a, b) => numberValue(b.average_score) - numberValue(a.average_score))
  const subjectAssessments = [...subjectAssessmentMap.values()].map((row) => ({
    ...row,
    average_score: row.scores.length ? Number((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length).toFixed(1)) : 0,
    pass_rate: percentValue(row.pass_count, row.scores.length),
    result_count: row.scores.length,
  })).sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)))
  const subjectRows = buildSubjectTrendRows(subjectAssessments, [...subjectStudentLatest.values()], passMark)
  const weakestSubject = [...subjectRows].filter((row) => numberValue(row.assessment_count) > 0).sort((a, b) => numberValue(a.current_average) - numberValue(b.current_average))[0] || null
  const bestSubject = [...subjectRows].filter((row) => numberValue(row.assessment_count) > 0).sort((a, b) => numberValue(b.current_average) - numberValue(a.current_average))[0] || null
  const mostImprovedSubject = [...subjectRows].sort((a, b) => numberValue(b.change) - numberValue(a.change))[0] || null
  const mostDeclinedSubject = [...subjectRows].sort((a, b) => numberValue(a.change) - numberValue(b.change))[0] || null
  const totalBelowPass = subjectRows.reduce((sum, row) => sum + numberValue(row.fail_count), 0)
  return {
    entries: normalized,
    scored,
    overallAverage,
    passRate,
    failRate,
    classPerformance,
    subjectAssessments,
    subjectRows,
    passMark,
    insightMetrics: {
      resultCount: scored.length,
      overallAverage,
      passRate,
      passMark,
      weakestSubject,
      weakestClass: [...classPerformance].sort((a, b) => numberValue(a.average_score) - numberValue(b.average_score))[0] || null,
      bestSubject,
      mostImprovedSubject,
      mostDeclinedSubject,
      totalBelowPass,
    },
  }
}

function buildSubjectTrendRows(assessments, latestStudentRows, passMark) {
  const bySubject = new Map()
  for (const row of assessments) {
    if (!bySubject.has(row.subject_id)) bySubject.set(row.subject_id, { subject_id: row.subject_id, subject_public_ref: row.subject_public_ref, subject_name: row.subject_name, assessments: [] })
    bySubject.get(row.subject_id).assessments.push(row)
  }
  const latestBySubject = new Map()
  for (const row of latestStudentRows) {
    if (!latestBySubject.has(row.subject_id)) latestBySubject.set(row.subject_id, [])
    latestBySubject.get(row.subject_id).push(row)
  }
  return [...bySubject.values()].map((subject) => {
    const sorted = subject.assessments.sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)))
    const current = sorted[sorted.length - 1] || {}
    const previous = sorted[sorted.length - 2] || {}
    const latestStudents = latestBySubject.get(subject.subject_id) || []
    const failCount = latestStudents.filter((row) => row.score_percent !== null && numberValue(row.score_percent) < passMark).length
    const absentCount = latestStudents.filter((row) => row.is_absent).length
    const currentAverage = numberValue(current.average_score)
    const previousAverage = sorted.length > 1 ? numberValue(previous.average_score) : 0
    const change = sorted.length > 1 ? Number((currentAverage - previousAverage).toFixed(1)) : 0
    const status = currentAverage < passMark || numberValue(current.pass_rate) < 50
      ? "critical"
      : change >= 3
        ? "improving"
        : change <= -3
          ? "declining"
          : "stable"
    return {
      subject_id: subject.subject_id,
      subject_name: subject.subject_name,
      current_average: currentAverage,
      previous_average: previousAverage,
      change,
      pass_rate: numberValue(current.pass_rate),
      fail_count: failCount,
      absent_count: absentCount,
      assessment_count: sorted.length,
      latest_assessment_date: current.assessment_date || null,
      status,
      detail_path: `/academics/subject-trends/${subject.subject_public_ref}`,
    }
  }).sort((a, b) => numberValue(a.current_average) - numberValue(b.current_average))
}

export async function getAtRiskStudents(schoolId, session, settings, academicCore = null, financeCore = null) {
  const academics = academicCore || await getAcademicCore(schoolId, session, settings)
  const finance = financeCore || await getFinanceCore(schoolId, session, settings)
  const passMark = numberValue(settings.academic_pass_mark)
  const studentMap = new Map()
  for (const row of academics.entries) {
    if (!studentMap.has(row.student_id)) {
      studentMap.set(row.student_id, {
        student_id: row.student_id,
        student_public_ref: row.student_public_ref,
        student_code: row.student_code,
        student_name: row.student_name,
        class_name: row.class_name,
        scores: [],
        subjectScores: new Map(),
        absent_assessments: 0,
        withdrawal_absences: 0,
      })
    }
    const item = studentMap.get(row.student_id)
    if (row.is_absent) {
      item.absent_assessments += 1
      item.withdrawal_absences += numberValue(row.withdrawal_absence) ? 1 : 0
    } else if (row.score_percent !== null) {
      item.scores.push(row.score_percent)
      if (!item.subjectScores.has(row.subject_id)) item.subjectScores.set(row.subject_id, [])
      item.subjectScores.get(row.subject_id).push(row.score_percent)
    }
  }
  const balanceMap = new Map(finance.owingStudents.map((row) => [Number(row.student_id), numberValue(row.balance)]))
  const riskRows = [...studentMap.values()].map((student) => {
    const averageScore = student.scores.length ? Number((student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length).toFixed(1)) : 0
    const failedSubjects = [...student.subjectScores.values()].filter((scores) => {
      const average = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)
      return average < passMark
    }).length
    const outstandingBalance = balanceMap.get(Number(student.student_id)) || 0
    let riskScore = 0
    const reasons = []
    if (student.scores.length && averageScore < passMark) {
      riskScore += 30
      reasons.push("average below pass mark")
    }
    if (failedSubjects >= 2) {
      riskScore += 20
      reasons.push("failing two or more subjects")
    }
    if (student.absent_assessments > 0) {
      riskScore += 15
      reasons.push("assessment absences")
    }
    if (student.withdrawal_absences > 0) {
      riskScore += 15
      reasons.push("withdrawal during assessment period")
    }
    if (outstandingBalance >= numberValue(settings.high_debt_threshold)) {
      riskScore += 10
      reasons.push("high fee balance")
    }
    const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low"
    const recommendedAction = student.withdrawal_absences > 0
      ? "director review"
      : failedSubjects >= 2
        ? "subject intervention"
        : averageScore < passMark
          ? "academic support"
          : outstandingBalance >= numberValue(settings.high_debt_threshold)
            ? "fee follow-up"
            : student.absent_assessments > 0
              ? "parent meeting"
              : "monitor"
    return {
      student_id: student.student_id,
      student_code: student.student_code,
      student_name: student.student_name,
      class_name: student.class_name,
      average_score: averageScore,
      failed_subjects_count: failedSubjects,
      absent_assessments: student.absent_assessments,
      withdrawal_absences: student.withdrawal_absences,
      outstanding_balance: moneyValue(outstandingBalance),
      risk_score: riskScore,
      risk_level: riskLevel,
      recommended_action: recommendedAction,
      risk_factors: reasons.join(", ") || "monitoring",
      detail_path: `/academics/at-risk-students/${student.student_public_ref}`,
    }
  })
  return riskRows.filter((row) => row.risk_score >= numberValue(settings.at_risk_score_threshold)).sort((a, b) => numberValue(b.risk_score) - numberValue(a.risk_score))
}

async function getMarksSubmissionAnalytics(schoolId, session) {
  const rbTerm = termFilter("rb", session, false)
  const rows = await safeQuery(
    `SELECT rb.id AS batch_id, rb.public_ref AS batch_public_ref, a.name AS assessment_name, c.name AS class_name, subj.name AS subject_name,
       u.id AS teacher_id, u.public_ref AS teacher_public_ref, u.full_name AS teacher_name, rb.status,
       ${resultDateExpression()} AS assessment_date,
       rb.submitted_at, rb.approved_at AS locked_at,
       COUNT(DISTINCT CASE WHEN s.status IN ('active', 'withdrawn') THEN s.id END) AS entries_expected,
       COUNT(DISTINCT re.id) AS entries_created,
       SUM(CASE WHEN re.score IS NOT NULL THEN 1 ELSE 0 END) AS entries_marked,
       SUM(CASE WHEN re.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
       SUM(CASE WHEN re.status = 'absent' AND sw.id IS NOT NULL THEN 1 ELSE 0 END) AS withdrawal_absent_count
     FROM result_batches rb
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN classes c ON c.id = rb.class_id AND c.school_id = rb.school_id
     JOIN subjects subj ON subj.id = rb.subject_id AND subj.school_id = rb.school_id
     JOIN users u ON u.id = rb.teacher_id AND u.school_id = rb.school_id
     LEFT JOIN students s ON s.class_id = rb.class_id AND s.school_id = rb.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id AND re.student_id = s.id
     LEFT JOIN exam_timetable_entries ett ON ett.assessment_id = a.id AND ett.school_id = a.school_id AND ett.status <> 'cancelled'
     LEFT JOIN student_withdrawals sw ON sw.school_id = re.school_id AND sw.student_id = re.student_id AND sw.status <> 'cancelled'
       AND sw.start_date <= ${resultDateExpression()}
       AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ${resultDateExpression()})
     WHERE rb.school_id = ?${rbTerm.clause}
     GROUP BY rb.id, a.name, c.name, subj.name, u.id, u.full_name, rb.status, assessment_date, rb.submitted_at, rb.approved_at
     ORDER BY assessment_date DESC, rb.updated_at DESC
     LIMIT 300`,
    [schoolId, ...rbTerm.params],
  )
  const today = dateOnly(new Date())
  const batches = rows.map((row) => {
    const expected = numberValue(row.entries_expected)
    const marked = numberValue(row.entries_marked)
    const absent = numberValue(row.absent_count)
    const done = marked + absent
    const completion = percentValue(done, expected)
    const locked = ["approved", "locked"].includes(String(row.status))
    const submitted = ["submitted", "approved", "locked"].includes(String(row.status))
    const overdue = !submitted && row.assessment_date && String(dateOnly(row.assessment_date)).localeCompare(today) < 0
    return {
      ...row,
      assessment_date: dateOnly(row.assessment_date),
      entries_expected: expected,
      entries_marked: marked,
      absent_count: absent,
      withdrawal_absent_count: numberValue(row.withdrawal_absent_count),
      missing_marks: Math.max(0, expected - done),
      completion_percent: completion,
      submission_status: overdue ? "overdue" : locked ? "locked" : submitted ? "submitted" : done > 0 ? "draft" : "missing",
      detail_path: `/academics/marks-submission/${row.batch_public_ref}`,
    }
  })
  const teacherMap = new Map()
  for (const row of batches) {
    if (!teacherMap.has(row.teacher_id)) teacherMap.set(row.teacher_id, { teacher_id: row.teacher_id, teacher_public_ref: row.teacher_public_ref, teacher_name: row.teacher_name, expected: 0, submitted: 0, pending_marks: 0, absent_count: 0 })
    const teacher = teacherMap.get(row.teacher_id)
    teacher.expected += 1
    if (["submitted", "locked"].includes(row.submission_status)) teacher.submitted += 1
    if (!["submitted", "locked"].includes(row.submission_status)) teacher.pending_marks += 1
    teacher.absent_count += numberValue(row.absent_count)
  }
  const byTeacher = [...teacherMap.values()].map((row) => ({
    ...row,
    submission_rate: percentValue(row.submitted, row.expected),
    detail_path: `/staff/teacher-compliance/${row.teacher_public_ref}`,
  })).sort((a, b) => numberValue(b.pending_marks) - numberValue(a.pending_marks))
  const metrics = {
    totalExpectedBatches: batches.length,
    submittedBatches: batches.filter((row) => row.submission_status === "submitted").length,
    lockedBatches: batches.filter((row) => row.submission_status === "locked").length,
    draftBatches: batches.filter((row) => row.submission_status === "draft").length,
    pendingBatches: batches.filter((row) => row.submission_status === "missing").length,
    overdueBatches: batches.filter((row) => row.submission_status === "overdue").length,
    totalExpectedEntries: batches.reduce((sum, row) => sum + numberValue(row.entries_expected), 0),
    totalMarkedEntries: batches.reduce((sum, row) => sum + numberValue(row.entries_marked), 0),
    totalAbsentEntries: batches.reduce((sum, row) => sum + numberValue(row.absent_count), 0),
    withdrawalAbsentEntries: batches.reduce((sum, row) => sum + numberValue(row.withdrawal_absent_count), 0),
    topPendingTeacher: byTeacher[0] || null,
  }
  return { batches, byTeacher, metrics }
}

async function getCapacityAnalytics(schoolId, session, settings) {
  const feeTerm = termFilter("fa", session, true)
  const rows = await safeQuery(
    `SELECT c.id AS class_id, c.public_ref AS class_public_ref, c.name AS class_name, c.grade_level,
       teacher.full_name AS class_teacher,
       COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END) AS active_students,
       COUNT(DISTINCT CASE WHEN s.status = 'withdrawn' THEN s.id END) AS withdrawn_students,
       COALESCE(SUM(fa.amount_due), 0) AS billed
     FROM classes c
     LEFT JOIN users teacher ON teacher.id = c.teacher_user_id AND teacher.school_id = c.school_id
     LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id
     LEFT JOIN fee_accounts fa ON fa.student_id = s.id AND fa.school_id = s.school_id${feeTerm.clause}
     WHERE c.school_id = ?
     GROUP BY c.id, c.name, c.grade_level, teacher.full_name
     ORDER BY c.name`,
    [...feeTerm.params, schoolId],
  )
  const facilities = await safeQuery(
    `SELECT id AS facility_id, name AS facility_name, normal_capacity
     FROM school_facilities
     WHERE school_id = ? AND active = 1
       AND (UPPER(facility_type) = 'CLASSROOM' OR can_host_normal_lessons = 1)
       AND normal_capacity IS NOT NULL AND normal_capacity > 0
     ORDER BY UPPER(facility_type) = 'CLASSROOM' DESC, id`,
    [schoolId],
  )
  const capacityNameKey = (value) => String(value || "")
    .toLowerCase()
    .replace(/\b(classroom|class|room)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
  const facilitiesByName = new Map()
  for (const facility of facilities) {
    const key = capacityNameKey(facility.facility_name)
    if (key && !facilitiesByName.has(key)) facilitiesByName.set(key, facility)
  }
  const classes = rows.map((row) => {
    const facility = facilitiesByName.get(capacityNameKey(row.class_name)) || null
    const configuredCapacity = numberValue(facility?.normal_capacity)
    const maxCapacity = configuredCapacity || numberValue(settings.default_class_capacity)
    const active = numberValue(row.active_students)
    const emptySeats = Math.max(0, maxCapacity - active)
    const occupancy = maxCapacity > 0 ? percentValue(active, maxCapacity) : 0
    const avgFee = active > 0 ? numberValue(row.billed) / active : 0
    const status = maxCapacity <= 0
      ? "unconfigured"
      : active > maxCapacity
        ? "over capacity"
        : occupancy >= 100
          ? "full"
          : occupancy >= numberValue(settings.capacity_warning_threshold)
            ? "near capacity"
            : occupancy < 60
              ? "underfilled"
              : "healthy"
    return {
      ...row,
      active_students: active,
      withdrawn_students: numberValue(row.withdrawn_students),
      facility_id: facility?.facility_id || null,
      facility_name: facility?.facility_name || "Not linked",
      capacity_source: facility ? "classroom facility" : "director default",
      max_capacity: maxCapacity,
      configured_capacity: configuredCapacity,
      empty_seats: emptySeats,
      occupancy_percent: occupancy,
      estimated_lost_revenue: moneyValue(emptySeats * avgFee),
      status,
      detail_path: `/admissions/class-capacity/${row.class_public_ref}`,
    }
  })
  const totalCapacity = classes.reduce((sum, row) => sum + numberValue(row.max_capacity), 0)
  const activeStudents = classes.reduce((sum, row) => sum + numberValue(row.active_students), 0)
  const emptySeats = classes.reduce((sum, row) => sum + numberValue(row.empty_seats), 0)
  return {
    classes,
    metrics: {
      totalCapacity,
      activeStudents,
      emptySeats,
      occupancyRate: percentValue(activeStudents, totalCapacity),
      nearFullClasses: classes.filter((row) => row.status === "near capacity").length,
      fullClasses: classes.filter((row) => row.status === "full" || row.status === "over capacity").length,
      overCapacityClasses: classes.filter((row) => row.status === "over capacity").length,
      estimatedLostRevenue: classes.reduce((sum, row) => sum + numberValue(row.estimated_lost_revenue), 0),
      topEmptyClass: [...classes].sort((a, b) => numberValue(b.empty_seats) - numberValue(a.empty_seats))[0] || null,
      configuredClasses: classes.filter((row) => numberValue(row.configured_capacity) > 0).length,
    },
  }
}

async function getWithdrawalAnalytics(schoolId, session, query = {}) {
  const rows = await listStudentWithdrawals(pool, schoolId, query)
  const enrichedRows = []
  for (const row of rows) {
    const [[affected]] = await pool.query(
      `SELECT COUNT(DISTINCT a.id) AS exams_affected
       FROM assessments a
       JOIN exam_timetable_entries ett ON ett.assessment_id = a.id AND ett.school_id = a.school_id AND ett.status <> 'cancelled'
       WHERE a.school_id = ? AND a.class_id = ?
         AND ett.exam_date >= ?
         AND ( ? = 'permanent' OR ett.exam_date <= COALESCE(?, '9999-12-31'))`,
      [schoolId, row.class_id || 0, row.start_date, row.withdrawal_type, row.end_date],
    ).catch(() => [[{ exams_affected: 0 }]])
    enrichedRows.push({
      ...row,
      exams_affected: numberValue(affected?.exams_affected),
      duration_days: row.withdrawal_type === "permanent" ? "Permanent" : daysBetween(row.start_date, row.end_date) ?? "-",
      detail_path: `/admissions/withdrawals/${row.public_ref}`,
    })
  }
  const today = dateOnly(new Date())
  const metrics = {
    activeWithdrawals: enrichedRows.filter((row) => row.computed_status === "active").length,
    temporaryWithdrawals: enrichedRows.filter((row) => row.computed_status === "active" && row.withdrawal_type === "temporary").length,
    permanentThisTerm: enrichedRows.filter((row) => row.withdrawal_type === "permanent" && (!session.term || String(row.start_date) >= dateOnly(session.term.start_date))).length,
    endingSoon: enrichedRows.filter((row) => row.withdrawal_type === "temporary" && row.computed_status === "active" && row.end_date && daysBetween(today, row.end_date) <= 7 && daysBetween(today, row.end_date) >= 0).length,
    examsAffected: enrichedRows.reduce((sum, row) => sum + numberValue(row.exams_affected), 0),
    returnedThisTerm: enrichedRows.filter((row) => row.computed_status === "expired" && session.term && String(row.end_date || "") >= dateOnly(session.term.start_date)).length,
  }
  return { rows: enrichedRows, metrics }
}

async function getStudentCounts(schoolId, session) {
  const statusRows = await safeQuery(
    "SELECT status, COUNT(*) AS total FROM students WHERE school_id = ? GROUP BY status",
    [schoolId],
  )
  const counts = Object.fromEntries(statusRows.map((row) => [row.status, numberValue(row.total)]))
  const newAdmissions = await safeOne(
    `SELECT COUNT(*) AS total
     FROM students
     WHERE school_id = ?${session.setupRequired ? "" : " AND enrollment_date BETWEEN ? AND ?"}`,
    session.setupRequired ? [schoolId] : [schoolId, dateOnly(session.term.start_date), dateOnly(session.term.end_date)],
  )
  return {
    active: counts.active || 0,
    withdrawn: counts.withdrawn || 0,
    suspended: counts.suspended || 0,
    graduated: counts.graduated || 0,
    archived: counts.archived || 0,
    total: Object.values(counts).reduce((sum, value) => sum + numberValue(value), 0),
    newAdmissions: numberValue(newAdmissions.total),
  }
}

async function getStaffAnalytics(schoolId, session, marksAnalytics = null) {
  const marks = marksAnalytics || await getMarksSubmissionAnalytics(schoolId, session)
  const rows = await safeQuery(
    `SELECT u.id AS teacher_id, u.public_ref AS teacher_public_ref, u.full_name AS teacher_name, u.email, u.employment_status,
       COUNT(DISTINCT a.class_id) AS classes_assigned,
       COUNT(DISTINCT a.subject_id) AS subjects_assigned,
       COUNT(DISTINCT a.id) AS assignment_count,
       COUNT(DISTINCT ll.id) AS lesson_logs_submitted
     FROM users u
     LEFT JOIN teacher_class_subject_assignments a ON a.teacher_id = u.id AND a.school_id = u.school_id AND a.is_active = 1
     LEFT JOIN teacher_lesson_logs ll ON ll.teacher_id = u.id AND ll.school_id = u.school_id${session.setupRequired ? "" : " AND ll.lesson_date BETWEEN ? AND ?"}
     WHERE u.school_id = ? AND u.role = 'teacher' AND u.is_active = 1
     GROUP BY u.id, u.full_name, u.email, u.employment_status
     ORDER BY u.full_name`,
    session.setupRequired ? [schoolId] : [dateOnly(session.term.start_date), dateOnly(session.term.end_date), schoolId],
  )
  const markMap = new Map(marks.byTeacher.map((row) => [Number(row.teacher_id), row]))
  const teachers = rows.map((row) => {
    const markStats = markMap.get(Number(row.teacher_id)) || { expected: 0, submitted: 0, pending_marks: 0 }
    const complianceScore = Math.max(0, Math.round((percentValue(markStats.submitted, markStats.expected || 1) + Math.min(100, numberValue(row.lesson_logs_submitted) * 20)) / 2))
    return {
      ...row,
      classes_assigned: numberValue(row.classes_assigned),
      subjects_assigned: numberValue(row.subjects_assigned),
      assignment_count: numberValue(row.assignment_count),
      marks_submitted: numberValue(markStats.submitted),
      pending_marks: numberValue(markStats.pending_marks),
      lesson_logs_submitted: numberValue(row.lesson_logs_submitted),
      syllabus_progress: "-",
      compliance_score: complianceScore,
      status: numberValue(markStats.pending_marks) > 0 ? "pending" : complianceScore >= 80 ? "healthy" : "watch",
      detail_path: `/staff/teacher-compliance/${row.teacher_public_ref}`,
    }
  })
  return {
    teachers,
    metrics: {
      totalTeachers: teachers.length,
      fullyCompliantTeachers: teachers.filter((row) => row.status === "healthy").length,
      teachersWithPendingMarks: teachers.filter((row) => numberValue(row.pending_marks) > 0).length,
      missingLessonLogs: teachers.filter((row) => numberValue(row.lesson_logs_submitted) === 0).length,
      highestWorkloadTeacher: [...teachers].sort((a, b) => numberValue(b.assignment_count) - numberValue(a.assignment_count))[0] || null,
    },
  }
}

async function getOperationsAnalytics(schoolId, session) {
  const createdAtClause = (alias) => session.setupRequired ? "" : ` AND ${alias}.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`
  const dateParams = session.setupRequired ? [] : [dateOnly(session.term.start_date), dateOnly(session.term.end_date)]
  const incidents = await safeQuery(
    `SELECT si.id, si.title, si.incident_type, si.severity, si.incident_date, si.status,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       staff.full_name AS staff_name,
       reporter.full_name AS reported_by_name
     FROM school_incidents si
     LEFT JOIN students s ON s.id = si.student_id AND s.school_id = si.school_id
     LEFT JOIN users staff ON staff.id = si.staff_id AND staff.school_id = si.school_id
     LEFT JOIN users reporter ON reporter.id = si.reported_by AND reporter.school_id = si.school_id
     WHERE si.school_id = ?${session.setupRequired ? "" : " AND si.incident_date BETWEEN ? AND ?"}
     ORDER BY si.incident_date DESC, si.id DESC
     LIMIT 200`,
    session.setupRequired ? [schoolId] : [schoolId, dateOnly(session.term.start_date), dateOnly(session.term.end_date)],
  )
  const complaints = await safeQuery(
    `SELECT sc.id, sc.complainant_name, sc.complainant_contact, sc.category, sc.priority, sc.status, sc.created_at,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       assignee.full_name AS assigned_to_name
     FROM school_complaints sc
     LEFT JOIN students s ON s.id = sc.student_id AND s.school_id = sc.school_id
     LEFT JOIN users assignee ON assignee.id = sc.assigned_to AND assignee.school_id = sc.school_id
     WHERE sc.school_id = ?${createdAtClause("sc")}
     ORDER BY sc.created_at DESC, sc.id DESC
     LIMIT 200`,
    [schoolId, ...dateParams],
  )
  const directorApprovals = await safeQuery(
    `SELECT da.id, da.approval_type, da.entity_type, da.entity_id, da.status, da.urgency, da.reason, da.created_at,
       requester.full_name AS requested_by_name, decider.full_name AS decided_by_name
     FROM director_approvals da
     LEFT JOIN users requester ON requester.id = da.requested_by AND requester.school_id = da.school_id
     LEFT JOIN users decider ON decider.id = da.decided_by AND decider.school_id = da.school_id
     WHERE da.school_id = ?${createdAtClause("da")}
     ORDER BY da.created_at DESC
     LIMIT 200`,
    [schoolId, ...dateParams],
  )
  const financeDiscountApprovals = await safeQuery(
    "SELECT id, 'fee_discount' AS approval_type, 'finance_discount' AS entity_type, id AS entity_id, status, 'normal' AS urgency, reason, created_at FROM finance_discounts WHERE school_id = ? AND status = 'pending' LIMIT 100",
    [schoolId],
  )
  const financeExpenseApprovals = await safeQuery(
    "SELECT id, 'expense' AS approval_type, 'finance_expense' AS entity_type, id AS entity_id, status, 'normal' AS urgency, description AS reason, created_at FROM finance_expenses WHERE school_id = ? AND status = 'pending_approval' LIMIT 100",
    [schoolId],
  )
  const leaveApprovals = await safeQuery(
    "SELECT public_ref AS id,'staff_leave' AS approval_type,'staff_leave' AS entity_type,public_ref AS entity_id,status,'high' AS urgency,reason,created_at FROM staff_leave_requests WHERE school_id=? AND status='pending' LIMIT 100",
    [schoolId],
  )
  const payrollApprovals = await safeQuery(
    "SELECT public_ref AS id,'payroll' AS approval_type,'payroll_run' AS entity_type,public_ref AS entity_id,status,'high' AS urgency,title AS reason,created_at FROM payroll_runs WHERE school_id=? AND status='pending_approval' LIMIT 100",
    [schoolId],
  )
  const approvals = [...directorApprovals, ...financeDiscountApprovals, ...financeExpenseApprovals, ...leaveApprovals, ...payrollApprovals]
  return {
    incidents,
    complaints,
    approvals,
    metrics: {
      openIncidents: incidents.filter((row) => ["open", "investigating"].includes(row.status)).length,
      criticalIncidents: incidents.filter((row) => row.severity === "critical" && ["open", "investigating"].includes(row.status)).length,
      resolvedIncidents: incidents.filter((row) => row.status === "resolved").length,
      openComplaints: complaints.filter((row) => ["open", "in_progress"].includes(row.status)).length,
      urgentComplaints: complaints.filter((row) => row.priority === "urgent" && ["open", "in_progress"].includes(row.status)).length,
      resolvedComplaints: complaints.filter((row) => row.status === "resolved").length,
      pendingApprovals: approvals.filter((row) => row.status === "pending" || row.status === "pending_approval").length,
      approvedThisTerm: approvals.filter((row) => row.status === "approved").length,
      rejectedThisTerm: approvals.filter((row) => row.status === "rejected").length,
    },
  }
}

export async function directorSummary(schoolId) {
  const session = await getActiveAcademicSession(schoolId)
  const settings = await getDirectorSettings(schoolId)
  const [students, finance, academics, marks, operations] = await Promise.all([
    getStudentCounts(schoolId, session),
    getFinanceCore(schoolId, session, settings),
    getAcademicCore(schoolId, session, settings),
    getMarksSubmissionAnalytics(schoolId, session),
    getOperationsAnalytics(schoolId, session),
  ])
  const risks = await getAtRiskStudents(schoolId, session, settings, academics, finance)
  return {
    session: sessionPayload(session),
    students,
    finance: finance.totals,
    academics: {
      overall_average: academics.overallAverage,
      pass_rate: academics.passRate,
      fail_rate: academics.failRate,
      at_risk_students: risks.length,
      result_count: academics.scored.length,
    },
    staff: {
      expected_submissions: marks.metrics.totalExpectedBatches,
      submitted_batches: marks.metrics.submittedBatches + marks.metrics.lockedBatches,
      pending_actions: marks.metrics.draftBatches + marks.metrics.pendingBatches + marks.metrics.overdueBatches,
    },
    approvals: { pending: operations.metrics.pendingApprovals },
  }
}

export async function buildDirectorPage(schoolId, rawSection = "overview", query = {}) {
  const parsed = normalizeDirectorSection(rawSection)
  let detailId = query.detail_id || query.detailId || parsed.detailId
  const section = parsed.section
  const session = await getActiveAcademicSession(schoolId)
  const settings = await getDirectorSettings(schoolId)
  if (detailId && DETAIL_SECTIONS.has(section)) {
    const detailTables = {
      "academics-subject-trends": "subjects",
      "academics-marks-submission": "result_batches",
      "admissions-class-capacity": "classes",
      "admissions-withdrawals": "student_withdrawals",
      "staff-teacher-compliance": "users",
      "academics-at-risk-students": "students",
    }
    const tableName = detailTables[section]
    const reference = await safeOne(`SELECT id FROM ${tableName} WHERE school_id = ? AND public_ref = ? LIMIT 1`, [schoolId, String(detailId)], {})
    detailId = reference.id || null
    if (!detailId) return makePage({ section, title: "Record not found", description: "This public reference is invalid or does not belong to your school.", session, empty_state: { title: "Record unavailable", message: "The requested record could not be resolved within this school." } })
    return buildDirectorDetailPage(schoolId, section, detailId, session, settings)
  }

  if (section === "overview") return buildOverviewPage(schoolId, session, settings)
  if (section.startsWith("finance-")) return buildFinancePage(schoolId, section, session, settings)
  if (section.startsWith("admissions-")) return buildAdmissionsPage(schoolId, section, session, settings, query)
  if (section.startsWith("academics-")) return buildAcademicsPage(schoolId, section, session, settings)
  if (section.startsWith("staff-")) return buildStaffPage(schoolId, section, session, settings)
  if (section.startsWith("operations-")) return buildOperationsPage(schoolId, section, session, settings)
  if (section.startsWith("reports-")) return buildReportsPage(schoolId, section, session, settings)
  if (section === "audit-security") return buildAuditPage(schoolId, session, settings)
  if (section === "settings") return buildSettingsPage(schoolId, session, settings)

  return makePage({
    section,
    title: "Director Page",
    description: "This Director page is connected and ready for data expansion.",
    session,
    empty_state: { title: "No records available yet", message: "No data source has been configured for this page yet." },
  })
}

async function buildOverviewPage(schoolId, session, settings) {
  const [students, finance, academics, marks, capacity, withdrawals, operations, taskMetrics, leaveRows] = await Promise.all([
    getStudentCounts(schoolId, session),
    getFinanceCore(schoolId, session, settings),
    getAcademicCore(schoolId, session, settings),
    getMarksSubmissionAnalytics(schoolId, session),
    getCapacityAnalytics(schoolId, session, settings),
    getWithdrawalAnalytics(schoolId, session, {}),
    getOperationsAnalytics(schoolId, session),
    safeOne(`SELECT
      SUM(status IN ('open','in_progress')) AS open_tasks,
      SUM(status IN ('open','in_progress') AND due_date < CURDATE()) AS overdue_tasks,
      SUM(status IN ('open','in_progress') AND due_date = CURDATE()) AS due_today,
      SUM(status='completed' AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS completed_week
      FROM director_tasks WHERE school_id = ?`, [schoolId], {}),
    safeQuery(`SELECT lr.public_ref,lr.leave_type,lr.start_date,lr.end_date,lr.status,u.full_name staff_name,coverage.full_name coverage_name
      FROM staff_leave_requests lr JOIN users u ON u.id=lr.staff_user_id AND u.school_id=lr.school_id
      LEFT JOIN users coverage ON coverage.id=lr.coverage_staff_user_id
      WHERE lr.school_id=? AND (lr.status='pending' OR (lr.status='approved' AND lr.end_date>=CURDATE()))
      ORDER BY FIELD(lr.status,'pending','approved'),lr.end_date LIMIT 50`,[schoolId]),
  ])
  const risks = await getAtRiskStudents(schoolId, session, settings, academics, finance)
  const staffComplianceRate = percentValue(marks.metrics.submittedBatches + marks.metrics.lockedBatches, marks.metrics.totalExpectedBatches)
  return makePage({
    section: "overview",
    title: "Today Command Center",
    description: "Operational priorities, delegated follow-ups, approvals and daily closure by exception.",
    session,
    kpis: [
      kpi("Open Director Tasks", numberValue(taskMetrics.open_tasks), `${numberValue(taskMetrics.due_today)} due today`, taskMetrics.open_tasks ? "warn" : "good"),
      kpi("Leadership Decisions Waiting", operations.metrics.pendingApprovals, "decisions waiting", operations.metrics.pendingApprovals ? "warn" : "good"),
      kpi("Overdue Follow-Ups", numberValue(taskMetrics.overdue_tasks), "past due", taskMetrics.overdue_tasks ? "bad" : "good"),
      kpi("Today's Fee Collection", moneyLabel(finance.totals.collected_today), `${moneyLabel(finance.totals.collected_week)} this week`, "neutral"),
      kpi("Pending Marks", marks.metrics.draftBatches + marks.metrics.pendingBatches + marks.metrics.overdueBatches, "teacher submissions", marks.metrics.overdueBatches ? "bad" : "warn"),
      kpi("Active Critical Alerts", risks.filter((row) => row.risk_level === "critical").length + operations.metrics.criticalIncidents + operations.metrics.urgentComplaints, "students and operations", "bad"),
      kpi("Teachers on Leave", leaveRows.filter((row) => row.status === "approved" && dateOnly(row.start_date) <= dateOnly(new Date()) && dateOnly(row.end_date) >= dateOnly(new Date())).length, `${leaveRows.filter((row) => row.status === "pending").length} requests pending`, leaveRows.some((row) => row.status === "pending") ? "warn" : "neutral"),
    ],
    insights: [
      ...generateFinanceInsights(finance.insightMetrics),
      ...generateAcademicInsights({ ...academics.insightMetrics, atRiskStudents: risks.length }),
      ...generateMarksSubmissionInsights(marks.metrics),
      ...generateOperationsInsights(operations.metrics),
      ...(leaveRows.some((row) => row.status === "pending") ? [{ tone: "warn", message: `${leaveRows.filter((row) => row.status === "pending").length} staff leave request${leaveRows.filter((row) => row.status === "pending").length === 1 ? "" : "s"} require approval.`, metric: "leave_pending" }] : []),
      ...(leaveRows.some((row) => row.status === "approved" && !row.coverage_name) ? [{ tone: "bad", message: `${leaveRows.filter((row) => row.status === "approved" && !row.coverage_name).length} approved leave record${leaveRows.filter((row) => row.status === "approved" && !row.coverage_name).length === 1 ? " has" : "s have"} no coverage assigned.`, metric: "leave_coverage" }] : []),
    ].slice(0, 6),
    charts: [
      chart("line", "Fee Collection Trend", finance.trend, { xKey: "payment_date", series: [{ key: "collected", label: "Collected" }] }),
      chart("bar", "Class Fee Performance", finance.classes.slice(0, 8), { xKey: "class_name", series: [{ key: "total_collected", label: "Collected" }, { key: "outstanding", label: "Outstanding" }] }),
      chart("bar", "Academic Performance by Class", academics.classPerformance, { xKey: "class_name", series: [{ key: "average_score", label: "Average score" }, { key: "pass_rate", label: "Pass rate" }] }),
      chart("bar", "Class Capacity", capacity.classes, { xKey: "class_name", series: [{ key: "active_students", label: "Active students" }, { key: "empty_seats", label: "Empty seats" }] }),
    ],
    tables: [
      table("Recent Director Alerts", [
        ...finance.owingStudents.slice(0, 5).map((row) => ({ id: `fee-${row.student_id}`, alert: `${row.student_name} has an outstanding balance`, area: "Finance", severity: numberValue(row.balance) >= settings.high_debt_threshold ? "critical" : "warning", value: moneyLabel(row.balance), detail_path: row.detail_path })),
        ...risks.slice(0, 5).map((row) => ({ id: `risk-${row.student_id}`, alert: `${row.student_name} is ${row.risk_level} risk`, area: "Academics", severity: row.risk_level, value: row.recommended_action, detail_path: row.detail_path })),
        ...withdrawals.rows.filter((row) => row.computed_status === "active").slice(0, 5).map((row) => ({ id: `withdrawal-${row.id}`, alert: `${row.student_name} is in an active ${row.withdrawal_type} withdrawal`, area: "Admissions", severity: "warning", value: row.reason, detail_path: row.detail_path })),
      ], ["area", "alert", "severity", "value"], { empty_state: { title: "No director alerts", message: "No finance, academic or withdrawal alerts are visible right now." } }),
      table("Approvals Queue", operations.approvals.filter((row) => row.status === "pending" || row.status === "pending_approval"), ["approval_type", "entity_type", "urgency", "reason", "requested_by_name", "created_at", "status"], { empty_state: { title: "No pending approvals", message: "No sensitive decisions are waiting for Director review." } }),
      table("Staff Leave Attention", leaveRows.map((row) => ({...row,detail_path:`/staff/leave/${row.public_ref}`})), ["staff_name","leave_type","start_date","end_date","coverage_name","status"], { empty_state: { title: "No leave attention needed", message: "No current or pending leave records require attention." } }),
      table("Class Fee Performance", finance.classes, ["class_name", "active_students", "total_billed", "total_collected", "outstanding", "collection_rate"]),
      table("Class Academic Performance", academics.classPerformance, ["class_name", "average_score", "pass_rate", "absent_count", "result_count"]),
    ],
  })
}

async function buildFinancePage(schoolId, section, session, settings) {
  const finance = await getFinanceCore(schoolId, session, settings)
  if (section === "finance-fee-collection") {
    return makePage({
      section,
      title: "Fee Collection",
      description: "Shows how much money the school has collected and where collections are weak.",
      session,
      kpis: [
        kpi("Total Billed This Term", moneyLabel(finance.totals.total_billed), "fee accounts", "neutral"),
        kpi("Total Collected This Term", moneyLabel(finance.totals.total_collected), `${finance.totals.payment_count} payments`, "good"),
        kpi("Collection Rate", percentLabel(finance.totals.collection_rate), `${percentLabel(settings.fee_collection_target_percent)} target`, finance.totals.collection_rate >= settings.fee_collection_target_percent ? "good" : "warn"),
        kpi("Collected Today", moneyLabel(finance.totals.collected_today), `${moneyLabel(finance.totals.collected_week)} this week`, "neutral"),
        kpi("Paid Students", finance.totals.fully_paid_students, "fully paid accounts", "good"),
        kpi("Partial / Unpaid", finance.totals.partially_paid_students + finance.totals.unpaid_students, "students needing follow-up", finance.totals.partially_paid_students + finance.totals.unpaid_students ? "warn" : "good"),
      ],
      insights: generateFinanceInsights(finance.insightMetrics),
      charts: [
        chart("line", "Collection Trend", finance.trend, { xKey: "payment_date", series: [{ key: "collected", label: "Collected" }] }),
        chart("bar", "Collection by Class", finance.classes, { xKey: "class_name", series: [{ key: "total_collected", label: "Collected" }, { key: "outstanding", label: "Outstanding" }] }),
        chart("pie", "Payment Method Breakdown", finance.methodBreakdown, { xKey: "method", series: [{ key: "amount", label: "Amount" }] }),
      ],
      tables: [
        table("Recent Payments", finance.recentPayments, ["payment_date", "student_name", "student_code", "class_name", "amount", "payment_method", "receipt_no", "recorded_by_name"], { empty_state: { title: "No fee records", message: "No fee records are available for this term yet. Once invoices or payments are recorded, collection analytics will appear here." } }),
        table("Classes Behind Target", finance.classes.filter((row) => numberValue(row.collection_rate) < numberValue(settings.fee_collection_target_percent)), ["class_name", "active_students", "total_billed", "total_collected", "outstanding", "collection_rate"]),
        table("Top Unpaid Students", finance.owingStudents.slice(0, 25), ["student_name", "student_code", "class_name", "guardian_contact", "total_billed", "paid", "balance", "last_payment_date", "status"]),
      ],
    })
  }
  if (section === "finance-outstanding-balances") {
    const bandRows = [
      { band: "0", students: finance.totals.fully_paid_students },
      { band: "1 to 50,000", students: finance.owingStudents.filter((row) => numberValue(row.balance) > 0 && numberValue(row.balance) <= 50000).length },
      { band: "50,001 to 250,000", students: finance.owingStudents.filter((row) => numberValue(row.balance) > 50000 && numberValue(row.balance) <= 250000).length },
      { band: "250,001 to 500,000", students: finance.owingStudents.filter((row) => numberValue(row.balance) > 250000 && numberValue(row.balance) <= 500000).length },
      { band: "500,000+", students: finance.owingStudents.filter((row) => numberValue(row.balance) > 500000).length },
    ]
    return makePage({
      section,
      title: "Outstanding Balances",
      description: "Shows who owes money and where the biggest collection risk sits.",
      session,
      kpis: [
        kpi("Total Outstanding Balance", moneyLabel(finance.totals.total_outstanding), "all unpaid accounts", finance.totals.total_outstanding > 0 ? "warn" : "good"),
        kpi("Students With Balances", finance.totals.students_with_balances, "owing students", finance.totals.students_with_balances ? "warn" : "good"),
        kpi("Overdue Balance", moneyLabel(finance.totals.overdue_balance), "past due dates", finance.totals.overdue_balance > 0 ? "bad" : "good"),
        kpi("Highest Individual Balance", moneyLabel(finance.totals.highest_balance), "single account", finance.totals.highest_balance >= settings.high_debt_threshold ? "bad" : "neutral"),
        kpi("Average Owing Balance", moneyLabel(finance.totals.students_with_balances ? finance.totals.total_outstanding / finance.totals.students_with_balances : 0), "per owing student", "neutral"),
        kpi("Fully Paid", percentLabel(percentValue(finance.totals.fully_paid_students, finance.totals.students_with_accounts)), "of billed students", "good"),
      ],
      insights: generateFinanceInsights(finance.insightMetrics),
      charts: [
        chart("bar", "Outstanding Balance by Class", finance.classes, { xKey: "class_name", series: [{ key: "outstanding", label: "Outstanding" }] }),
        chart("bar", "Outstanding Balance Bands", bandRows, { xKey: "band", series: [{ key: "students", label: "Students" }] }),
      ],
      tables: [table("Outstanding Student Accounts", finance.owingStudents, ["student_name", "student_code", "class_name", "guardian_contact", "total_billed", "paid", "balance", "last_payment_date", "status"])],
    })
  }
  if (section === "finance-discounts-bursaries") {
    const discounts = await getDiscountAnalytics(schoolId, session)
    const billed = finance.totals.total_billed
    return makePage({
      section,
      title: "Discounts & Bursaries",
      description: "Protects expected revenue by showing scholarships, discounts, bursaries and approval exposure.",
      session,
      kpis: [
        kpi("Total Discounts Granted", moneyLabel(discounts.totalDiscounts), "estimated reduction", "warn"),
        kpi("Students on Discount", discounts.students, "unique learners", "neutral"),
        kpi("Discount Value %", percentLabel(percentValue(discounts.totalDiscounts, billed)), "of billed fees", percentValue(discounts.totalDiscounts, billed) > 10 ? "warn" : "neutral"),
        kpi("Discount Decisions Waiting", discounts.pending, "discount records", discounts.pending ? "warn" : "good"),
        kpi("Largest Discount", moneyLabel(discounts.largest), "single discount", "neutral"),
        kpi("Scholarship/Bursary Count", discounts.rows.filter((row) => ["scholarship", "hardship"].includes(row.discount_type)).length, "support categories", "neutral"),
      ],
      insights: [
        { tone: discounts.totalDiscounts > 0 ? "warn" : "neutral", message: `Discounts currently reduce expected revenue by ${moneyLabel(discounts.totalDiscounts)}.`, metric: "discount_total" },
        ...(discounts.byClass[0] ? [{ tone: "warn", message: `${discounts.byClass[0].class_name} has the highest discount exposure at ${moneyLabel(discounts.byClass[0].amount)}.`, metric: "discount_class" }] : []),
        { tone: discounts.pending ? "warn" : "good", message: `${discounts.pending} bursary or discount record${discounts.pending === 1 ? "" : "s"} are pending approval.`, metric: "discount_pending" },
      ],
      charts: [chart("bar", "Discount Exposure by Class", discounts.byClass, { xKey: "class_name", series: [{ key: "amount", label: "Discount amount" }] })],
      tables: [table("Discount and Bursary Records", discounts.rows, ["student_name", "student_code", "class_name", "discount_type", "amount_type", "amount_value", "discount_amount", "status", "reason", "requested_by_name", "approved_by_name", "created_at"])],
    })
  }
  if (section === "finance-expenses") {
    const expenses = await getExpenseAnalytics(schoolId, session)
    return makePage({
      section,
      title: "Expenses",
      description: "Shows school spending, approvals and expense pressure against collections.",
      session,
      kpis: [
        kpi("Total Expenses This Term", moneyLabel(expenses.total), "recorded spending", expenses.total > finance.totals.total_collected ? "warn" : "neutral"),
        kpi("Pending Expenses", moneyLabel(expenses.pending), "draft or approval queue", expenses.pending ? "warn" : "good"),
        kpi("Approved Expenses", moneyLabel(expenses.approved), "approved or paid", "neutral"),
        kpi("Largest Expense", moneyLabel(expenses.largest), "single record", "neutral"),
        kpi("Expense-to-Collection", percentLabel(percentValue(expenses.total, finance.totals.total_collected)), "of collections", percentValue(expenses.total, finance.totals.total_collected) > 70 ? "warn" : "neutral"),
        kpi("Top Category", expenses.byCategory[0]?.category || "-", expenses.byCategory[0] ? moneyLabel(expenses.byCategory[0].amount) : "no spending", "neutral"),
      ],
      insights: [
        { tone: expenses.total > finance.totals.total_collected ? "bad" : "neutral", message: `Expenses total ${moneyLabel(expenses.total)} against ${moneyLabel(finance.totals.total_collected)} collected.`, metric: "expense_ratio" },
        ...(expenses.byCategory[0] ? [{ tone: "neutral", message: `${expenses.byCategory[0].category} is the largest expense category at ${moneyLabel(expenses.byCategory[0].amount)}.`, metric: "expense_category" }] : []),
      ],
      charts: [
        chart("bar", "Expenses by Category", expenses.byCategory, { xKey: "category", series: [{ key: "amount", label: "Amount" }] }),
        chart("line", "Expenses Over Time", expenses.trend, { xKey: "expense_date", series: [{ key: "amount", label: "Amount" }] }),
      ],
      tables: [table("Expense Records", expenses.rows, ["expense_date", "title", "category", "supplier", "amount", "status", "requested_by_name", "approved_by_name"])],
    })
  }
  const discounts = await getDiscountAnalytics(schoolId, session)
  const expenses = await getExpenseAnalytics(schoolId, session)
  return makePage({
    section,
    title: "Financial Reports",
    description: "Export-ready financial summary for ownership review.",
    session,
    kpis: [
      kpi("Total Billed", moneyLabel(finance.totals.total_billed), "fee accounts", "neutral"),
      kpi("Total Collected", moneyLabel(finance.totals.total_collected), "payments and account totals", "good"),
      kpi("Total Outstanding", moneyLabel(finance.totals.total_outstanding), "unpaid balances", finance.totals.total_outstanding ? "warn" : "good"),
      kpi("Total Discounts", moneyLabel(discounts.totalDiscounts), "revenue reduction", "warn"),
      kpi("Total Expenses", moneyLabel(expenses.total), "term spending", "neutral"),
      kpi("Net Position", moneyLabel(finance.totals.total_collected - expenses.total), "collected minus expenses", finance.totals.total_collected >= expenses.total ? "good" : "bad"),
    ],
    insights: generateFinanceInsights(finance.insightMetrics),
    charts: [
      chart("bar", "Collection by Class", finance.classes, { xKey: "class_name", series: [{ key: "total_collected", label: "Collected" }, { key: "outstanding", label: "Outstanding" }] }),
      chart("bar", "Expenses Summary", expenses.byCategory, { xKey: "category", series: [{ key: "amount", label: "Amount" }] }),
    ],
    report_sections: [
      { title: "Term Finance Summary", body: `The school billed ${moneyLabel(finance.totals.total_billed)} and collected ${moneyLabel(finance.totals.total_collected)}, giving a collection rate of ${percentLabel(finance.totals.collection_rate)}.` },
      { title: "Outstanding Balances", body: `${finance.totals.students_with_balances} learner${finance.totals.students_with_balances === 1 ? "" : "s"} currently have balances totaling ${moneyLabel(finance.totals.total_outstanding)}.` },
      { title: "Discounts and Expenses", body: `Discounts reduce expected revenue by ${moneyLabel(discounts.totalDiscounts)}. Expenses recorded this term total ${moneyLabel(expenses.total)}.` },
    ],
    tables: [
      table("Collection by Class", finance.classes, ["class_name", "total_billed", "total_collected", "outstanding", "collection_rate"]),
      table("Outstanding Balances by Student", finance.owingStudents.slice(0, 50), ["student_name", "class_name", "balance", "last_payment_date", "status"]),
      table("Expenses Summary", expenses.byCategory, ["category", "amount"]),
    ],
  })
}

async function buildAdmissionsPage(schoolId, section, session, settings, query) {
  if (section === "admissions-enrollment-pipeline") {
    const rows = await safeQuery(
      `SELECT al.id, al.student_name, al.guardian_name, al.guardian_phone, c.name AS intended_class,
        al.stage, al.expected_fee_amount, al.notes, al.created_at, creator.full_name AS created_by_name
       FROM admission_leads al
       LEFT JOIN classes c ON c.id = al.intended_class_id AND c.school_id = al.school_id
       LEFT JOIN users creator ON creator.id = al.created_by AND creator.school_id = al.school_id
       WHERE al.school_id = ?${session.setupRequired ? "" : " AND al.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)"}
       ORDER BY al.created_at DESC
       LIMIT 200`,
      session.setupRequired ? [schoolId] : [schoolId, dateOnly(session.term.start_date), dateOnly(session.term.end_date)],
    )
    const pipelineRows = rows.map((row) => ({ ...row, expected_fee_amount: moneyValue(row.expected_fee_amount) }))
    const stageCounts = ["inquiry", "assessment", "accepted", "registered", "lost"].map((stage) => ({
      stage,
      leads: pipelineRows.filter((row) => row.stage === stage).length,
      projected_revenue: moneyValue(pipelineRows.filter((row) => row.stage === stage).reduce((sum, row) => sum + numberValue(row.expected_fee_amount), 0)),
    }))
    const accepted = stageCounts.find((row) => row.stage === "accepted")?.leads || 0
    const registered = stageCounts.find((row) => row.stage === "registered")?.leads || 0
    return makePage({
      section,
      title: "Enrollment Pipeline",
      description: "Tracks admissions growth, conversion and projected term revenue.",
      session,
      kpis: [
        kpi("New Inquiries This Term", stageCounts.find((row) => row.stage === "inquiry")?.leads || 0, "pipeline stage", "neutral"),
        kpi("Accepted Applications", accepted, "not necessarily registered", "good"),
        kpi("Registered Students", registered, "pipeline completions", "good"),
        kpi("Lost Leads", stageCounts.find((row) => row.stage === "lost")?.leads || 0, "missed opportunities", "warn"),
        kpi("Conversion Rate", percentLabel(percentValue(registered, pipelineRows.length)), "registered from leads", "neutral"),
        kpi("Projected Revenue", moneyLabel(pipelineRows.reduce((sum, row) => sum + numberValue(row.expected_fee_amount), 0)), "from active pipeline", "neutral"),
      ],
      insights: [
        ...(stageCounts[0].leads ? [{ tone: "neutral", message: `${stageCounts[0].leads} new admissions inquiries are currently in the pipeline.`, metric: "inquiries" }] : []),
        ...(accepted > registered ? [{ tone: "warn", message: `${accepted - registered} accepted student${accepted - registered === 1 ? "" : "s"} have not completed registration.`, metric: "accepted_gap" }] : []),
      ],
      charts: [
        chart("bar", "Pipeline Funnel", stageCounts, { xKey: "stage", series: [{ key: "leads", label: "Leads" }] }),
        chart("bar", "Projected Revenue by Stage", stageCounts, { xKey: "stage", series: [{ key: "projected_revenue", label: "Projected revenue" }] }),
      ],
      tables: [table("Admissions Leads", pipelineRows, ["student_name", "guardian_name", "guardian_phone", "intended_class", "stage", "expected_fee_amount", "created_by_name", "created_at"], { empty_state: { title: "No admissions leads", message: "No admission leads are recorded yet. Add inquiries to track pipeline conversion and projected revenue." } })],
    })
  }
  if (section === "admissions-class-capacity") {
    const capacity = await getCapacityAnalytics(schoolId, session, settings)
    return makePage({
      section,
      title: "Class Capacity",
      description: "Shows empty seats, overcrowding and possible lost revenue by class.",
      session,
      kpis: [
        kpi("Total Capacity", capacity.metrics.totalCapacity, `${capacity.metrics.configuredClasses} classes configured`, "neutral"),
        kpi("Active Students", capacity.metrics.activeStudents, "current class population", "good"),
        kpi("Empty Seats", capacity.metrics.emptySeats, "available seats", capacity.metrics.emptySeats ? "warn" : "good"),
        kpi("Overall Occupancy", percentLabel(capacity.metrics.occupancyRate), "active versus capacity", capacity.metrics.occupancyRate >= settings.capacity_warning_threshold ? "warn" : "good"),
        kpi("Full / Near-Full Classes", capacity.metrics.fullClasses + capacity.metrics.nearFullClasses, "capacity pressure", capacity.metrics.fullClasses ? "bad" : "neutral"),
        kpi("Lost Revenue Estimate", moneyLabel(capacity.metrics.estimatedLostRevenue), "from empty seats", capacity.metrics.estimatedLostRevenue ? "warn" : "neutral"),
      ],
      insights: generateCapacityInsights(capacity.metrics),
      charts: [
        chart("bar", "Occupancy by Class", capacity.classes, { xKey: "class_name", series: [{ key: "occupancy_percent", label: "Occupancy %" }] }),
        chart("bar", "Empty Seats by Class", capacity.classes, { xKey: "class_name", series: [{ key: "empty_seats", label: "Empty seats" }] }),
      ],
      tables: [table("Class Capacity", capacity.classes, ["class_name", "grade_level", "class_teacher", "facility_name", "capacity_source", "active_students", "configured_capacity", "max_capacity", "empty_seats", "occupancy_percent", "estimated_lost_revenue", "status"], { empty_state: { title: "No classes found", message: "No classes are available yet. Configure classes and classroom facilities to calculate occupancy." } })],
    })
  }
  const withdrawals = await getWithdrawalAnalytics(schoolId, session, query)
  return makePage({
    section,
    title: "Withdrawals",
    description: "Tracks withdrawn students and the operational impact on exams/results.",
    session,
    filters: [
      { key: "search", label: "Search", type: "search" },
      { key: "status", label: "Status", type: "select", options: ["", "active", "expired", "cancelled"] },
      { key: "type", label: "Type", type: "select", options: ["", "temporary", "permanent"] },
      { key: "class_id", label: "Class", type: "class" },
      { key: "date_from", label: "From", type: "date" },
      { key: "date_to", label: "To", type: "date" },
    ],
    kpis: [
      kpi("Active Withdrawals", withdrawals.metrics.activeWithdrawals, "current periods", withdrawals.metrics.activeWithdrawals ? "warn" : "good"),
      kpi("Temporary Withdrawals", withdrawals.metrics.temporaryWithdrawals, "active temporary", withdrawals.metrics.temporaryWithdrawals ? "warn" : "neutral"),
      kpi("Permanent This Term", withdrawals.metrics.permanentThisTerm, "permanent exits", withdrawals.metrics.permanentThisTerm ? "bad" : "good"),
      kpi("Ending Soon", withdrawals.metrics.endingSoon, "next 7 days", withdrawals.metrics.endingSoon ? "warn" : "neutral"),
      kpi("Exams Affected", withdrawals.metrics.examsAffected, "scheduled overlaps", withdrawals.metrics.examsAffected ? "warn" : "good"),
      kpi("Returned This Term", withdrawals.metrics.returnedThisTerm, "expired temporary withdrawals", "good"),
    ],
    insights: generateWithdrawalInsights(withdrawals.metrics),
    charts: [
      chart("bar", "Withdrawals by Type", [
        { type: "temporary", withdrawals: withdrawals.rows.filter((row) => row.withdrawal_type === "temporary").length },
        { type: "permanent", withdrawals: withdrawals.rows.filter((row) => row.withdrawal_type === "permanent").length },
      ], { xKey: "type", series: [{ key: "withdrawals", label: "Withdrawals" }] }),
      chart("bar", "Withdrawal Status", [
        { status: "active", withdrawals: withdrawals.rows.filter((row) => row.computed_status === "active").length },
        { status: "expired", withdrawals: withdrawals.rows.filter((row) => row.computed_status === "expired").length },
        { status: "cancelled", withdrawals: withdrawals.rows.filter((row) => row.computed_status === "cancelled").length },
      ], { xKey: "status", series: [{ key: "withdrawals", label: "Withdrawals" }] }),
    ],
    tables: [table("Withdrawal Records", withdrawals.rows, ["student_code", "student_name", "class_name", "withdrawal_type", "start_date", "end_date", "duration_days", "reason", "computed_status", "exams_affected", "created_by_name", "created_at"], { empty_state: { title: "No withdrawals", message: "No student withdrawals have been recorded for this school." } })],
  })
}

async function buildAcademicsPage(schoolId, section, session, settings) {
  const [academic, finance, marks] = await Promise.all([
    getAcademicCore(schoolId, session, settings),
    getFinanceCore(schoolId, session, settings),
    getMarksSubmissionAnalytics(schoolId, session),
  ])
  const risks = await getAtRiskStudents(schoolId, session, settings, academic, finance)
  if (section === "academics-performance-overview") {
    return makePage({
      section,
      title: "Performance Overview",
      description: "Shows academic quality at school, class and subject level.",
      session,
      kpis: [
        kpi("Overall Average Score", percentLabel(academic.overallAverage), "scored entries only", academic.overallAverage >= settings.academic_pass_mark ? "good" : "warn"),
        kpi("Pass Rate", percentLabel(academic.passRate), `${percentLabel(settings.academic_pass_mark)} pass mark`, academic.passRate >= 70 ? "good" : "warn"),
        kpi("Failure Rate", percentLabel(academic.failRate), "scored entries", academic.failRate > 30 ? "bad" : "neutral"),
        kpi("At-Risk Students", risks.length, "calculated risk", risks.length ? "warn" : "good"),
        kpi("Best Class", academic.classPerformance[0]?.class_name || "-", academic.classPerformance[0] ? percentLabel(academic.classPerformance[0].average_score) : "no results", "good"),
        kpi("Weakest Subject", academic.insightMetrics.weakestSubject?.subject_name || "-", academic.insightMetrics.weakestSubject ? percentLabel(academic.insightMetrics.weakestSubject.current_average) : "no results", "warn"),
      ],
      insights: generateAcademicInsights({ ...academic.insightMetrics, atRiskStudents: risks.length }),
      charts: [
        chart("line", "Average Score Trend", academic.subjectAssessments, { xKey: "assessment_date", series: [{ key: "average_score", label: "Average score" }] }),
        chart("bar", "Performance by Class", academic.classPerformance, { xKey: "class_name", series: [{ key: "average_score", label: "Average score" }, { key: "pass_rate", label: "Pass rate" }] }),
        chart("bar", "Performance by Subject", academic.subjectRows, { xKey: "subject_name", series: [{ key: "current_average", label: "Current average" }, { key: "pass_rate", label: "Pass rate" }] }),
      ],
      tables: [
        table("Class Performance Ranking", academic.classPerformance, ["class_name", "average_score", "pass_rate", "absent_count", "result_count"]),
        table("Subject Performance Ranking", academic.subjectRows, ["subject_name", "current_average", "previous_average", "change", "pass_rate", "fail_count", "absent_count", "status"]),
      ],
    })
  }
  if (section === "academics-at-risk-students") {
    return makePage({
      section,
      title: "At-Risk Students",
      description: "Shows learners who need academic, finance, absence or withdrawal intervention.",
      session,
      kpis: [
        kpi("Total At-Risk Students", risks.length, "risk score threshold", risks.length ? "warn" : "good"),
        kpi("Critical Risk Students", risks.filter((row) => row.risk_level === "critical").length, "director review", risks.some((row) => row.risk_level === "critical") ? "bad" : "good"),
        kpi("Academic Risk Only", risks.filter((row) => row.average_score < settings.academic_pass_mark && row.outstanding_balance < settings.high_debt_threshold).length, "below pass mark", "warn"),
        kpi("Finance + Academic", risks.filter((row) => row.average_score < settings.academic_pass_mark && row.outstanding_balance >= settings.high_debt_threshold).length, "combined risk", "bad"),
        kpi("Failing 2+ Subjects", risks.filter((row) => row.failed_subjects_count >= 2).length, "subject intervention", "warn"),
        kpi("Assessment Absences", risks.filter((row) => row.absent_assessments > 0).length, "absence factor", "warn"),
      ],
      insights: generateAcademicInsights({ ...academic.insightMetrics, atRiskStudents: risks.length }),
      charts: [
        chart("bar", "Risk Level Distribution", ["medium", "high", "critical"].map((level) => ({ risk_level: level, students: risks.filter((row) => row.risk_level === level).length })), { xKey: "risk_level", series: [{ key: "students", label: "Students" }] }),
      ],
      tables: [table("At-Risk Students", risks, ["student_name", "student_code", "class_name", "average_score", "failed_subjects_count", "absent_assessments", "outstanding_balance", "risk_score", "risk_level", "recommended_action", "risk_factors"], { empty_state: { title: "No at-risk students", message: "No students currently cross the configured at-risk threshold." } })],
    })
  }
  if (section === "academics-subject-trends") {
    return makePage({
      section,
      title: "Subject Trends",
      description: "Shows subject performance over time and where intervention is needed.",
      session,
      kpis: [
        kpi("Best Subject", academic.insightMetrics.bestSubject?.subject_name || "-", academic.insightMetrics.bestSubject ? percentLabel(academic.insightMetrics.bestSubject.current_average) : "no results", "good"),
        kpi("Weakest Subject", academic.insightMetrics.weakestSubject?.subject_name || "-", academic.insightMetrics.weakestSubject ? percentLabel(academic.insightMetrics.weakestSubject.current_average) : "no results", "warn"),
        kpi("Most Improved", academic.insightMetrics.mostImprovedSubject?.subject_name || "-", academic.insightMetrics.mostImprovedSubject ? percentLabel(academic.insightMetrics.mostImprovedSubject.change) : "no comparison", "good"),
        kpi("Most Declined", academic.insightMetrics.mostDeclinedSubject?.subject_name || "-", academic.insightMetrics.mostDeclinedSubject ? percentLabel(academic.insightMetrics.mostDeclinedSubject.change) : "no comparison", "bad"),
        kpi("Average Pass Rate", percentLabel(academic.subjectRows.length ? academic.subjectRows.reduce((sum, row) => sum + numberValue(row.pass_rate), 0) / academic.subjectRows.length : 0), "subject average", "neutral"),
        kpi("Below Pass Mark", academic.insightMetrics.totalBelowPass, "latest subject results", academic.insightMetrics.totalBelowPass ? "warn" : "good"),
      ],
      insights: generateSubjectInsights(academic.insightMetrics),
      charts: [
        chart("bar", "Current Average by Subject", academic.subjectRows, { xKey: "subject_name", series: [{ key: "current_average", label: "Current average" }] }),
        chart("bar", "Pass Rate by Subject", academic.subjectRows, { xKey: "subject_name", series: [{ key: "pass_rate", label: "Pass rate" }] }),
      ],
      tables: [table("Subject Trend Table", academic.subjectRows, ["subject_name", "current_average", "previous_average", "change", "pass_rate", "fail_count", "absent_count", "assessment_count", "latest_assessment_date", "status"], { empty_state: { title: "No submitted academic results", message: "No submitted academic results are available yet. Subject trends will appear after marks are submitted and locked." } })],
    })
  }
  return makePage({
    section,
    title: "Marks Submission",
    description: "Staff accountability view for submitted, pending, missing and withdrawal-affected marks.",
    session,
    kpis: [
      kpi("Expected Submissions", marks.metrics.totalExpectedBatches, "result batches", "neutral"),
      kpi("Submitted / Locked", marks.metrics.submittedBatches + marks.metrics.lockedBatches, "completed batches", "good"),
      kpi("Draft Batches", marks.metrics.draftBatches, "in progress", marks.metrics.draftBatches ? "warn" : "good"),
      kpi("Pending / Missing", marks.metrics.pendingBatches, "not started", marks.metrics.pendingBatches ? "warn" : "good"),
      kpi("Total Absent Entries", marks.metrics.totalAbsentEntries, "marked absent", marks.metrics.totalAbsentEntries ? "warn" : "neutral"),
      kpi("Late Submissions", marks.metrics.overdueBatches, "past exam date", marks.metrics.overdueBatches ? "bad" : "good"),
    ],
    insights: generateMarksSubmissionInsights(marks.metrics),
    charts: [
      chart("bar", "Submissions by Teacher", marks.byTeacher, { xKey: "teacher_name", series: [{ key: "submitted", label: "Submitted" }, { key: "pending_marks", label: "Pending" }] }),
      chart("bar", "Completion by Batch", marks.batches.slice(0, 20), { xKey: "assessment_name", series: [{ key: "completion_percent", label: "Completion %" }] }),
    ],
    tables: [
      table("Marks Submission Batches", marks.batches, ["assessment_name", "class_name", "subject_name", "teacher_name", "submission_status", "entries_expected", "entries_marked", "absent_count", "withdrawal_absent_count", "missing_marks", "completion_percent", "submitted_at", "locked_at"], { empty_state: { title: "No result batches", message: "No result batches are available yet. Marks submission analytics will appear after assessments are created." } }),
      table("Teacher Submission Accountability", marks.byTeacher, ["teacher_name", "expected", "submitted", "pending_marks", "absent_count", "submission_rate"]),
    ],
  })
}

async function buildStaffPage(schoolId, section, session) {
  const marks = await getMarksSubmissionAnalytics(schoolId, session)
  const staff = await getStaffAnalytics(schoolId, session, marks)
  if (section === "staff-attendance") {
    const attendance = await safeQuery(
      `SELECT sa.id, u.public_ref AS staff_ref, u.full_name AS staff_member, u.full_name AS teacher_name, COALESCE(sa.attendance_date,CURDATE()) attendance_date,
       COALESCE(sa.status,CASE WHEN lr.id IS NOT NULL THEN 'on_leave' ELSE 'unrecorded' END) status, sa.check_in_time, sa.notes, recorder.full_name AS recorded_by_name,
       lr.public_ref leave_ref,lr.leave_type,lr.end_date leave_end_date
       FROM users u
       LEFT JOIN staff_attendance sa ON sa.staff_user_id=u.id AND sa.school_id=u.school_id AND sa.attendance_date=CURDATE()
       LEFT JOIN staff_leave_requests lr ON lr.staff_user_id=u.id AND lr.school_id=u.school_id AND lr.status='approved' AND CURDATE() BETWEEN lr.start_date AND lr.end_date
       LEFT JOIN users recorder ON recorder.id = sa.recorded_by AND recorder.school_id = sa.school_id
       WHERE u.school_id = ? AND u.role IN ('teacher','headteacher') AND u.is_active=1
       ORDER BY u.full_name`,
      [schoolId],
    )
    const todayRows = attendance.filter((row) => dateOnly(row.attendance_date) === dateOnly(new Date()))
    return makePage({
      section,
      title: "Staff Attendance",
      description: "Tracks present, absent, late and excused staff records where attendance is configured.",
      session,
      kpis: [
        kpi("Present Today", todayRows.filter((row) => row.status === "present").length, "staff attendance", "good"),
        kpi("Absent Today", todayRows.filter((row) => row.status === "absent").length, "today", todayRows.some((row) => row.status === "absent") ? "bad" : "good"),
        kpi("Late Today", todayRows.filter((row) => row.status === "late").length, "today", todayRows.some((row) => row.status === "late") ? "warn" : "good"),
        kpi("On Leave", todayRows.filter((row) => row.status === "on_leave").length, "approved staff leave", "neutral"),
        kpi("Attendance Rate", percentLabel(percentValue(todayRows.filter((row) => ["present","late"].includes(row.status)).length, todayRows.length)), "today", "neutral"),
        kpi("Most Absent Staff", "-", "available after records", "neutral"),
        kpi("Unrecorded Attendance", todayRows.filter((row) => row.status === "unrecorded").length, "teachers without today record", "warn"),
      ],
      insights: attendance.length ? generateStaffInsights(staff.metrics) : [{ tone: "neutral", message: "No staff attendance records are available yet. Attendance analytics will appear after daily staff records are captured.", metric: "empty" }],
      charts: [chart("bar", "Attendance Breakdown", ["present", "absent", "late", "excused"].map((status) => ({ status, records: attendance.filter((row) => row.status === status).length })), { xKey: "status", series: [{ key: "records", label: "Records" }] })],
      tables: [table("Staff Attendance Records", attendance, ["staff_member", "attendance_date", "status", "check_in_time", "notes", "recorded_by_name"], { empty_state: { title: "No staff attendance records", message: "No staff attendance module records are available yet." } })],
    })
  }
  if (section === "staff-workload") {
    const workload = staff.teachers.map((row) => ({
      ...row,
      workload_level: row.assignment_count >= 6 ? "overloaded" : row.assignment_count >= 4 ? "heavy" : row.assignment_count >= 1 ? "normal" : "light",
    }))
    return makePage({
      section,
      title: "Workload",
      description: "Shows whether classes, subjects and assessments are balanced across teachers.",
      session,
      kpis: [
        kpi("Average Classes / Teacher", staff.metrics.totalTeachers ? Number((workload.reduce((sum, row) => sum + row.classes_assigned, 0) / staff.metrics.totalTeachers).toFixed(1)) : 0, "class assignments", "neutral"),
        kpi("Highest Workload", staff.metrics.highestWorkloadTeacher?.teacher_name || "-", `${staff.metrics.highestWorkloadTeacher?.assignment_count || 0} assignments`, "warn"),
        kpi("No Assignments", workload.filter((row) => row.assignment_count === 0).length, "teachers", "warn"),
        kpi("Total Subject Assignments", workload.reduce((sum, row) => sum + row.subjects_assigned, 0), "visible assignments", "neutral"),
        kpi("Assessments / Teacher", staff.metrics.totalTeachers ? Number((marks.metrics.totalExpectedBatches / staff.metrics.totalTeachers).toFixed(1)) : 0, "result batches", "neutral"),
        kpi("Students / Teacher", "-", "requires class allocation model", "neutral"),
      ],
      insights: generateStaffInsights(staff.metrics),
      charts: [chart("bar", "Teacher Workload", workload, { xKey: "teacher_name", series: [{ key: "assignment_count", label: "Assignments" }, { key: "pending_marks", label: "Pending marks" }] })],
      tables: [table("Teacher Workload", workload, ["teacher_name", "classes_assigned", "subjects_assigned", "assignment_count", "marks_submitted", "pending_marks", "lesson_logs_submitted", "workload_level"])],
    })
  }
  return makePage({
    section,
    title: "Teacher Compliance",
    description: "Shows whether teachers are completing academic responsibilities.",
    session,
    kpis: [
      kpi("Total Teachers", staff.metrics.totalTeachers, "active teachers", "neutral"),
      kpi("Fully Compliant", staff.metrics.fullyCompliantTeachers, "no visible pending marks", "good"),
      kpi("Pending Marks", staff.metrics.teachersWithPendingMarks, "teachers", staff.metrics.teachersWithPendingMarks ? "warn" : "good"),
      kpi("Missing Lesson Logs", staff.metrics.missingLessonLogs, "current term", staff.metrics.missingLessonLogs ? "warn" : "good"),
      kpi("Average Submission Delay", marks.metrics.overdueBatches, "overdue batches", marks.metrics.overdueBatches ? "bad" : "good"),
      kpi("Behind Syllabus", "-", "syllabus progress not configured", "neutral"),
    ],
    insights: generateStaffInsights(staff.metrics),
    charts: [chart("bar", "Teacher Compliance", staff.teachers, { xKey: "teacher_name", series: [{ key: "compliance_score", label: "Compliance score" }, { key: "pending_marks", label: "Pending marks" }] })],
    tables: [table("Teacher Compliance", staff.teachers, ["teacher_name", "classes_assigned", "subjects_assigned", "marks_submitted", "pending_marks", "lesson_logs_submitted", "syllabus_progress", "compliance_score", "status"])],
  })
}

async function buildOperationsPage(schoolId, section, session, settings) {
  const operations = await getOperationsAnalytics(schoolId, session)
  if (section === "operations-incidents") {
    return makePage({
      section,
      title: "Incidents",
      description: "Tracks serious student, staff and school incidents.",
      session,
      kpis: [
        kpi("Open Incidents", operations.metrics.openIncidents, "open or investigating", operations.metrics.openIncidents ? "warn" : "good"),
        kpi("Critical Incidents", operations.metrics.criticalIncidents, "director attention", operations.metrics.criticalIncidents ? "bad" : "good"),
        kpi("Incident Resolutions This Term", operations.metrics.resolvedIncidents, "closed incidents", "good"),
        kpi("Repeat Student Incidents", "-", "requires repeat analysis", "neutral"),
        kpi("Escalation Threshold", settings.incident_escalation_threshold, "critical trigger", "neutral"),
        kpi("Incidents This Week", operations.incidents.filter((row) => daysBetween(row.incident_date, new Date()) <= 7).length, "last 7 days", "neutral"),
      ],
      insights: generateOperationsInsights(operations.metrics),
      charts: [chart("bar", "Incidents by Severity", ["low", "medium", "high", "critical"].map((severity) => ({ severity, incidents: operations.incidents.filter((row) => row.severity === severity).length })), { xKey: "severity", series: [{ key: "incidents", label: "Incidents" }] })],
      tables: [table("Incident Records", operations.incidents, ["title", "incident_type", "severity", "student_name", "staff_name", "incident_date", "status", "reported_by_name"], { empty_state: { title: "No incidents", message: "No incident records are available yet." } })],
    })
  }
  if (section === "operations-complaints") {
    return makePage({
      section,
      title: "Complaints",
      description: "Tracks parent/guardian complaints and school reputation risk.",
      session,
      kpis: [
        kpi("Open Complaints", operations.metrics.openComplaints, "open or in progress", operations.metrics.openComplaints ? "warn" : "good"),
        kpi("Urgent Complaints", operations.metrics.urgentComplaints, "priority urgent", operations.metrics.urgentComplaints ? "bad" : "good"),
        kpi("Complaint Resolutions This Term", operations.metrics.resolvedComplaints, "resolved complaints", "good"),
        kpi("Overdue Days", settings.complaint_overdue_days, "director threshold", "neutral"),
        kpi("Older Than Threshold", operations.complaints.filter((row) => ["open", "in_progress"].includes(row.status) && daysBetween(row.created_at, new Date()) > settings.complaint_overdue_days).length, "needs follow-up", "warn"),
        kpi("Top Category", operations.complaints[0]?.category || "-", "current records", "neutral"),
      ],
      insights: generateOperationsInsights(operations.metrics),
      charts: [chart("bar", "Complaints by Category", ["fees", "teacher", "academics", "bullying", "transport", "communication", "other"].map((category) => ({ category, complaints: operations.complaints.filter((row) => row.category === category).length })), { xKey: "category", series: [{ key: "complaints", label: "Complaints" }] })],
      tables: [table("Complaint Records", operations.complaints, ["complainant_name", "complainant_contact", "category", "priority", "student_name", "status", "assigned_to_name", "created_at"], { empty_state: { title: "No complaints", message: "No parent or guardian complaints are currently recorded." } })],
    })
  }
  return makePage({
    section,
    title: "Approvals",
    description: "Centralizes actions requiring director approval.",
    session,
    kpis: [
      kpi("Pending Approvals", operations.metrics.pendingApprovals, "waiting review", operations.metrics.pendingApprovals ? "warn" : "good"),
      kpi("Approved This Term", operations.metrics.approvedThisTerm, "approved records", "good"),
      kpi("Rejected This Term", operations.metrics.rejectedThisTerm, "rejected records", "neutral"),
      kpi("Urgent Approvals", operations.approvals.filter((row) => row.urgency === "urgent").length, "urgent flag", "warn"),
      kpi("Oldest Pending", operations.approvals.filter((row) => row.status === "pending")[0]?.created_at ? `${daysBetween(operations.approvals.filter((row) => row.status === "pending")[0].created_at, new Date())} days` : "-", "age", "neutral"),
      kpi("Approval Types", new Set(operations.approvals.map((row) => row.approval_type)).size, "categories", "neutral"),
    ],
    insights: generateOperationsInsights(operations.metrics),
    charts: [chart("bar", "Approvals by Type", [...new Set(operations.approvals.map((row) => row.approval_type))].map((approval_type) => ({ approval_type, approvals: operations.approvals.filter((row) => row.approval_type === approval_type).length })), { xKey: "approval_type", series: [{ key: "approvals", label: "Approvals" }] })],
    tables: [table("Director Approvals", operations.approvals, ["approval_type", "entity_type", "requested_by_name", "reason", "status", "urgency", "created_at"], { empty_state: { title: "No pending approvals", message: "No director approvals are currently pending." } })],
  })
}

async function buildReportsPage(schoolId, section, session, settings) {
  const [students, finance, academic, capacity, withdrawals, marks, operations] = await Promise.all([
    getStudentCounts(schoolId, session),
    getFinanceCore(schoolId, session, settings),
    getAcademicCore(schoolId, session, settings),
    getCapacityAnalytics(schoolId, session, settings),
    getWithdrawalAnalytics(schoolId, session, {}),
    getMarksSubmissionAnalytics(schoolId, session),
    getOperationsAnalytics(schoolId, session),
  ])
  const risks = await getAtRiskStudents(schoolId, session, settings, academic, finance)
  const reportPrefix = section === "reports-term-report" ? "Term" : "Director"
  const commonKpis = [
    kpi(`${reportPrefix} Review Areas`, 6, "finance, enrollment, academics, staff and risk", "neutral"),
    kpi(`${reportPrefix} Evidence Tables`, 2, "risk and class capacity", "good"),
    kpi(`${reportPrefix} Charts Ready`, 2, "finance and academic summaries", "good"),
    kpi(`${reportPrefix} Priority Risk Items`, risks.length + operations.metrics.pendingApprovals, "learner risks plus pending decisions", risks.length || operations.metrics.pendingApprovals ? "warn" : "good"),
  ]
  if (section === "reports-export-center") {
    const exports = [
      { id: "finance-summary", export_name: "Finance summary", description: "Billed, collected, outstanding, discounts and expenses.", supported_formats: "CSV", status: "ready" },
      { id: "outstanding-balances", export_name: "Outstanding balances", description: "Student fee balances and guardian contacts.", supported_formats: "CSV", status: "ready" },
      { id: "subject-trends", export_name: "Subject trends", description: "Subject averages, pass rates, decline and absence counts.", supported_formats: "CSV", status: "ready" },
      { id: "at-risk-students", export_name: "At-risk students", description: "Calculated risk score and recommended action.", supported_formats: "CSV", status: "ready" },
      { id: "marks-submission", export_name: "Marks submission status", description: "Teacher batch completion, missing marks and absences.", supported_formats: "CSV", status: "ready" },
      { id: "withdrawals", export_name: "Withdrawals", description: "Withdrawal periods, reasons and affected exams.", supported_formats: "CSV", status: "ready" },
      { id: "incidents", export_name: "Incidents", description: "Incident log for the term.", supported_formats: "CSV", status: "ready" },
      { id: "complaints", export_name: "Complaints", description: "Complaint log for the term.", supported_formats: "CSV", status: "ready" },
      { id: "approvals", export_name: "Approvals", description: "Director approval queue and decisions.", supported_formats: "CSV", status: "ready" },
      { id: "audit-logs", export_name: "Audit logs", description: "Sensitive activity logs if configured.", supported_formats: "CSV", status: "ready" },
    ]
    return makePage({
      section,
      title: "Export Center",
      description: "Export important Director records. CSV is enabled first; PDF exports can be layered onto existing print infrastructure later.",
      session,
      kpis: [
        kpi("Export Options", exports.length, "available datasets", "neutral"),
        kpi("CSV Ready", exports.filter((row) => row.status === "ready").length, "supported now", "good"),
        kpi("PDF Ready", 0, "not enabled yet", "neutral"),
        kpi("Protected Export Areas", new Set(exports.map((row) => row.id.split("-")[0])).size, "permission-scoped data groups", "neutral"),
      ],
      insights: [{ tone: "neutral", message: "CSV export datasets are defined from actual Director analytics. PDF export remains disabled until print templates are added.", metric: "exports" }],
      tables: [table("Export Options", exports, ["export_name", "description", "supported_formats", "status"])],
    })
  }
  return makePage({
    section,
    title: section === "reports-term-report" ? "Term Report" : "Director Report",
    description: section === "reports-term-report" ? "Term-level school performance and closing recommendations." : "Readable executive report from current school data.",
    session,
    kpis: commonKpis,
    insights: [
      ...generateFinanceInsights(finance.insightMetrics),
      ...generateAcademicInsights({ ...academic.insightMetrics, atRiskStudents: risks.length }),
      ...generateWithdrawalInsights(withdrawals.metrics),
      ...generateOperationsInsights(operations.metrics),
    ].slice(0, 6),
    report_sections: [
      { title: "Executive Summary", body: `During the selected term, the school billed ${moneyLabel(finance.totals.total_billed)} and collected ${moneyLabel(finance.totals.total_collected)}, giving a collection rate of ${percentLabel(finance.totals.collection_rate)}. Academic pass rate is ${percentLabel(academic.passRate)} with ${risks.length} learners requiring intervention.` },
      { title: "Finance Summary", body: `Outstanding balances total ${moneyLabel(finance.totals.total_outstanding)} across ${finance.totals.students_with_balances} owing students. Recorded expenses total ${moneyLabel((await getExpenseAnalytics(schoolId, session)).total)}.` },
      { title: "Enrollment Summary", body: `${students.active} learners are active. Class capacity shows ${capacity.metrics.emptySeats} empty seats and an estimated ${moneyLabel(capacity.metrics.estimatedLostRevenue)} in possible term revenue.` },
      { title: "Academic Summary", body: `The school average is ${percentLabel(academic.overallAverage)}. The weakest subject is ${academic.insightMetrics.weakestSubject?.subject_name || "not yet available"}.` },
      { title: "Staff Compliance Summary", body: `${marks.metrics.submittedBatches + marks.metrics.lockedBatches} of ${marks.metrics.totalExpectedBatches} expected mark batches are submitted or locked.` },
      { title: "Risks and Recommended Actions", body: `${risks.length} students require intervention. ${operations.metrics.pendingApprovals} approvals are waiting for director review.` },
    ],
    charts: [
      chart("bar", "Finance Summary", [{ label: "Billed", amount: finance.totals.total_billed }, { label: "Collected", amount: finance.totals.total_collected }, { label: "Outstanding", amount: finance.totals.total_outstanding }], { xKey: "label", series: [{ key: "amount", label: "Amount" }] }),
      chart("bar", "Academic by Class", academic.classPerformance, { xKey: "class_name", series: [{ key: "average_score", label: "Average" }, { key: "pass_rate", label: "Pass rate" }] }),
    ],
    tables: [
      table("Risk Register", risks.slice(0, 20), ["student_name", "class_name", "risk_level", "risk_score", "recommended_action"]),
      table("Class Capacity Summary", capacity.classes, ["class_name", "active_students", "max_capacity", "empty_seats", "occupancy_percent", "status"]),
    ],
  })
}

async function buildAuditPage(schoolId, session) {
  const auditRows = await safeQuery(
    `SELECT al.id, al.created_at, u.full_name AS actor_name, al.actor_role, al.action, al.entity_type, al.entity_id
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id AND u.school_id = al.school_id
     WHERE al.school_id = ?
     ORDER BY al.created_at DESC
     LIMIT 200`,
    [schoolId],
  )
  const financeRows = await safeQuery(
    `SELECT l.id, l.created_at, u.full_name AS actor_name, l.user_role AS actor_role, l.action, l.entity_type, l.entity_id
     FROM finance_audit_logs l
     LEFT JOIN users u ON u.id = l.user_id AND u.school_id = l.school_id
     WHERE l.school_id = ?
     ORDER BY l.created_at DESC
     LIMIT 200`,
    [schoolId],
  )
  const rows = [...auditRows, ...financeRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200)
  return makePage({
    section: "audit-security",
    title: "Audit & Security",
    description: "Gives ownership visibility into sensitive finance, withdrawal, result and approval activity.",
    session,
    kpis: [
      kpi("Sensitive Actions This Week", rows.filter((row) => daysBetween(row.created_at, new Date()) <= 7).length, "audit events", "neutral"),
      kpi("Failed Login Attempts", "-", "auth audit not configured", "neutral"),
      kpi("Mark Edits", rows.filter((row) => /result|mark/i.test(row.action || row.entity_type || "")).length, "result activity", "warn"),
      kpi("Fee Edits", rows.filter((row) => /fee|payment|invoice|discount/i.test(row.action || row.entity_type || "")).length, "finance activity", "warn"),
      kpi("Withdrawal Actions", rows.filter((row) => /withdrawal/i.test(row.action || row.entity_type || "")).length, "student withdrawals", "warn"),
      kpi("Approval Decisions", rows.filter((row) => /approval|approved|rejected/i.test(row.action || row.entity_type || "")).length, "leadership decisions", "neutral"),
    ],
    insights: rows.length ? [{ tone: "neutral", message: `${rows.length} sensitive activity record${rows.length === 1 ? "" : "s"} are available for review.`, metric: "audit" }] : [{ tone: "good", message: "No sensitive actions were recorded this week.", metric: "audit_empty" }],
    tables: [table("Audit Activity", rows, ["created_at", "actor_name", "actor_role", "action", "entity_type", "entity_id"], { empty_state: { title: "No audit records", message: "No sensitive audit activity is currently recorded." } })],
  })
}

async function buildSettingsPage(schoolId, session, settings) {
  const rows = Object.entries(settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))
  return makePage({
    section: "settings",
    title: "Director Settings",
    description: "Director-level thresholds for finance, academics, admissions and operations analytics.",
    session,
    kpis: [
      kpi("Academic Pass Mark", percentLabel(settings.academic_pass_mark), "score threshold", "neutral"),
      kpi("At-Risk Threshold", settings.at_risk_score_threshold, "risk score", "neutral"),
      kpi("Critical Risk", settings.critical_risk_threshold, "risk score", "warn"),
      kpi("Collection Target", percentLabel(settings.fee_collection_target_percent), "finance target", "neutral"),
      kpi("High Debt Threshold", moneyLabel(settings.high_debt_threshold), "student balance", "warn"),
      kpi("Default Capacity", settings.default_class_capacity, "seats per class", "neutral"),
    ],
    insights: [{ tone: "neutral", message: "Settings are scoped to this school and used by Director analytics calculations.", metric: "settings" }],
    tables: [table("Director Settings", rows, ["setting_key", "setting_value"])],
  })
}

async function buildDirectorDetailPage(schoolId, section, detailId, session, settings) {
  if (section === "academics-subject-trends") return buildSubjectDetailPage(schoolId, detailId, session, settings)
  if (section === "academics-marks-submission") return buildMarksSubmissionDetailPage(schoolId, detailId, session, settings)
  if (section === "admissions-class-capacity") return buildClassCapacityDetailPage(schoolId, detailId, session, settings)
  if (section === "admissions-withdrawals") return buildWithdrawalDetailPage(schoolId, detailId, session, settings)
  if (section === "staff-teacher-compliance") return buildTeacherComplianceDetailPage(schoolId, detailId, session, settings)
  if (section === "academics-at-risk-students") return buildStudentRiskDetailPage(schoolId, detailId, session, settings)
  return buildDirectorPage(schoolId, section, {})
}

async function buildSubjectDetailPage(schoolId, subjectId, session, settings) {
  const academic = await getAcademicCore(schoolId, session, settings)
  const subjectRows = academic.entries.filter((row) => Number(row.subject_id) === Number(subjectId))
  const subjectName = subjectRows[0]?.subject_name || "Subject"
  const assessments = academic.subjectAssessments.filter((row) => Number(row.subject_id) === Number(subjectId))
  const latestByStudent = new Map()
  for (const row of subjectRows) {
    const previous = latestByStudent.get(row.student_id)
    if (!previous || String(row.assessment_date).localeCompare(String(previous.assessment_date || "")) >= 0) latestByStudent.set(row.student_id, row)
  }
  const latest = [...latestByStudent.values()]
  const scored = latest.filter((row) => row.score_percent !== null)
  const failRows = latest.filter((row) => row.score_percent !== null && row.score_percent < academic.passMark).map((row) => ({
    student_name: row.student_name,
    student_code: row.student_code,
    class_name: row.class_name,
    latest_score: row.score_percent,
    average_score: row.score_percent,
    absences: subjectRows.filter((item) => item.student_id === row.student_id && item.is_absent).length,
    recommendation: "subject intervention",
    detail_path: `/students/${row.student_public_ref}`,
  }))
  const distribution = [
    { range: "0-39", students: scored.filter((row) => row.score_percent <= 39).length },
    { range: "40-49", students: scored.filter((row) => row.score_percent >= 40 && row.score_percent <= 49).length },
    { range: "50-59", students: scored.filter((row) => row.score_percent >= 50 && row.score_percent <= 59).length },
    { range: "60-69", students: scored.filter((row) => row.score_percent >= 60 && row.score_percent <= 69).length },
    { range: "70-79", students: scored.filter((row) => row.score_percent >= 70 && row.score_percent <= 79).length },
    { range: "80-100", students: scored.filter((row) => row.score_percent >= 80).length },
  ]
  const classMap = new Map()
  for (const row of subjectRows) {
    if (!classMap.has(row.class_id)) classMap.set(row.class_id, { class_name: row.class_name, scores: [], pass: 0, total: 0, absent_count: 0 })
    const item = classMap.get(row.class_id)
    if (row.is_absent) item.absent_count += 1
    if (row.score_percent !== null) {
      item.scores.push(row.score_percent)
      item.total += 1
      if (row.score_percent >= academic.passMark) item.pass += 1
    }
  }
  const classComparison = [...classMap.values()].map((row) => ({
    class_name: row.class_name,
    average_score: row.scores.length ? Number((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length).toFixed(1)) : 0,
    pass_rate: percentValue(row.pass, row.total),
    absent_count: row.absent_count,
  }))
  const currentAverage = scored.length ? Number((scored.reduce((sum, row) => sum + numberValue(row.score_percent), 0) / scored.length).toFixed(1)) : 0
  const passRate = percentValue(scored.filter((row) => row.score_percent >= academic.passMark).length, scored.length)
  const trend = academic.subjectRows.find((row) => Number(row.subject_id) === Number(subjectId))
  return makePage({
    section: "academics-subject-trends",
    title: `${subjectName} Detail`,
    description: "Subject trend, pass rate, failing learners, class comparison and withdrawal-related absences.",
    session,
    detail: { type: "subject", id: subjectId, back_path: "/academics/subject-trends" },
    kpis: [
      kpi("Current Average", percentLabel(currentAverage), "latest student scores", currentAverage >= academic.passMark ? "good" : "warn"),
      kpi("Pass Rate", percentLabel(passRate), `${percentLabel(academic.passMark)} pass mark`, passRate >= 70 ? "good" : "warn"),
      kpi("Fail Count", failRows.length, "students below pass mark", failRows.length ? "warn" : "good"),
      kpi("Students Below Pass", failRows.length, "latest subject result", failRows.length ? "warn" : "good"),
      kpi("Absent Count", latest.filter((row) => row.is_absent).length, "latest subject entries", "warn"),
      kpi("Trend Direction", trend?.status || "stable", trend ? `${percentLabel(trend.change)} change` : "no comparison", trend?.status === "declining" || trend?.status === "critical" ? "bad" : "good"),
    ],
    insights: generateSubjectInsights({
      passMark: academic.passMark,
      weakestSubject: trend,
      bestSubject: trend,
      totalBelowPass: failRows.length,
      mostDeclinedSubject: trend?.change < 0 ? trend : null,
      mostImprovedSubject: trend?.change > 0 ? trend : null,
    }),
    charts: [
      chart("line", "Average Score Over Time", assessments, { xKey: "assessment_date", series: [{ key: "average_score", label: "Average score" }] }),
      chart("line", "Pass Rate Over Time", assessments, { xKey: "assessment_date", series: [{ key: "pass_rate", label: "Pass rate" }] }),
      chart("bar", "Class Comparison", classComparison, { xKey: "class_name", series: [{ key: "average_score", label: "Average score" }, { key: "pass_rate", label: "Pass rate" }] }),
      chart("bar", "Score Distribution", distribution, { xKey: "range", series: [{ key: "students", label: "Students" }] }),
    ],
    tables: [
      table("Students Failing This Subject", failRows, ["student_name", "student_code", "class_name", "latest_score", "average_score", "absences", "recommendation"]),
      table("Assessment Breakdown", assessments.map((row) => ({ ...row, status: row.pass_rate >= 70 ? "healthy" : row.pass_rate < 50 ? "critical" : "watch" })), ["assessment_name", "assessment_date", "average_score", "pass_rate", "absent_count", "withdrawal_absences", "result_count", "status"]),
      table("Teacher/Class Comparison", classComparison, ["class_name", "average_score", "pass_rate", "absent_count"]),
    ],
  })
}

async function buildMarksSubmissionDetailPage(schoolId, batchId, session, settings) {
  const marks = await getMarksSubmissionAnalytics(schoolId, session)
  const batch = marks.batches.find((row) => Number(row.batch_id) === Number(batchId))
  const entries = await safeQuery(
    `SELECT re.id, CONCAT(s.first_name, ' ', s.last_name) AS student_name, COALESCE(s.student_id, s.admission_no) AS student_code,
       re.score, re.status, re.comment,
       CASE WHEN sw.id IS NULL THEN 0 ELSE 1 END AS withdrawal_absence,
       sw.reason AS withdrawal_reason
     FROM result_entries re
     JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
     JOIN assessments a ON a.id = rb.assessment_id AND a.school_id = rb.school_id
     JOIN students s ON s.id = re.student_id AND s.school_id = re.school_id
     LEFT JOIN exam_timetable_entries ett ON ett.assessment_id = a.id AND ett.school_id = a.school_id AND ett.status <> 'cancelled'
     LEFT JOIN student_withdrawals sw ON sw.school_id = re.school_id AND sw.student_id = re.student_id AND sw.status <> 'cancelled'
       AND sw.start_date <= ${resultDateExpression()}
       AND (sw.withdrawal_type = 'permanent' OR sw.end_date >= ${resultDateExpression()})
     WHERE re.school_id = ? AND re.result_batch_id = ?
     ORDER BY student_name`,
    [schoolId, batchId],
  )
  const missingRows = entries.filter((row) => row.score === null && row.status !== "absent")
  const absentRows = entries.filter((row) => row.status === "absent")
  return makePage({
    section: "academics-marks-submission",
    title: batch ? `${batch.assessment_name} Submission` : "Marks Submission Detail",
    description: "Submission detail showing marked entries, absent entries, withdrawal-caused absences and missing marks.",
    session,
    detail: { type: "marks_submission", id: batchId, back_path: "/academics/marks-submission" },
    kpis: [
      kpi("Entries Expected", batch?.entries_expected || entries.length, "students", "neutral"),
      kpi("Marked Entries", batch?.entries_marked || entries.filter((row) => row.score !== null).length, "scores captured", "good"),
      kpi("Absent Entries", absentRows.length, "marked absent", absentRows.length ? "warn" : "good"),
      kpi("Withdrawal Absences", absentRows.filter((row) => row.withdrawal_absence).length, "withdrawal linked", "warn"),
      kpi("Missing Marks", missingRows.length, "no score/absence", missingRows.length ? "bad" : "good"),
      kpi("Status", batch?.submission_status || "unknown", batch?.teacher_name || "", batch?.submission_status === "overdue" ? "bad" : "neutral"),
    ],
    insights: generateMarksSubmissionInsights({
      draftBatches: batch?.submission_status === "draft" ? 1 : 0,
      pendingBatches: batch?.submission_status === "missing" ? 1 : 0,
      overdueBatches: batch?.submission_status === "overdue" ? 1 : 0,
      totalAbsentEntries: absentRows.length,
      withdrawalAbsentEntries: absentRows.filter((row) => row.withdrawal_absence).length,
    }),
    tables: [
      table("Submission Entries", entries, ["student_name", "student_code", "score", "status", "comment", "withdrawal_absence", "withdrawal_reason"]),
      table("Students Missing Marks", missingRows, ["student_name", "student_code", "status", "comment"]),
      table("Withdrawn Students Marked Absent", absentRows.filter((row) => row.withdrawal_absence), ["student_name", "student_code", "status", "withdrawal_reason"]),
    ],
  })
}

async function buildClassCapacityDetailPage(schoolId, classId, session, settings) {
  const capacity = await getCapacityAnalytics(schoolId, session, settings)
  const classRow = capacity.classes.find((row) => Number(row.class_id) === Number(classId))
  const students = await safeQuery(
    `SELECT s.id AS student_id, s.public_ref AS student_public_ref, COALESCE(s.student_id, s.admission_no) AS student_code,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.gender, s.status, sfp.fee_category,
       COALESCE(SUM(fa.amount_due), 0) AS billed,
       COALESCE(SUM(fa.amount_paid), 0) AS paid
     FROM students s
     LEFT JOIN student_fee_profiles sfp ON sfp.student_id = s.id AND sfp.school_id = s.school_id
     LEFT JOIN fee_accounts fa ON fa.student_id = s.id AND fa.school_id = s.school_id
     WHERE s.school_id = ? AND s.class_id = ?
     GROUP BY s.id, s.public_ref, s.student_id, s.admission_no, s.first_name, s.last_name, s.gender, s.status, sfp.fee_category
     ORDER BY s.status, student_name`,
    [schoolId, classId],
  )
  const rows = students.map((row) => ({ ...row, billed: moneyValue(row.billed), paid: moneyValue(row.paid), balance: moneyValue(numberValue(row.billed) - numberValue(row.paid)), detail_path: `/students/${row.student_public_ref}` }))
  const genderRows = [...new Set(rows.map((row) => row.gender || "unspecified"))].map((gender) => ({ gender, students: rows.filter((row) => (row.gender || "unspecified") === gender).length }))
  const feeRows = [...new Set(rows.map((row) => row.fee_category || "standard"))].map((fee_category) => ({ fee_category, students: rows.filter((row) => (row.fee_category || "standard") === fee_category).length }))
  return makePage({
    section: "admissions-class-capacity",
    title: `${classRow?.class_name || "Class"} Capacity Detail`,
    description: "Class population, withdrawal count, gender mix, fee category mix and empty seat revenue opportunity.",
    session,
    detail: { type: "class_capacity", id: classId, back_path: "/admissions/class-capacity" },
    kpis: [
      kpi("Active Students", classRow?.active_students || 0, "current class", "good"),
      kpi("Withdrawn Students", classRow?.withdrawn_students || 0, "student status", classRow?.withdrawn_students ? "warn" : "good"),
      kpi("Max Capacity", classRow?.max_capacity || 0, classRow?.configured_capacity ? "configured" : "default setting", "neutral"),
      kpi("Empty Seats", classRow?.empty_seats || 0, "available", classRow?.empty_seats ? "warn" : "good"),
      kpi("Occupancy", percentLabel(classRow?.occupancy_percent || 0), classRow?.status || "unconfigured", classRow?.status === "over capacity" ? "bad" : "neutral"),
      kpi("Revenue Opportunity", moneyLabel(classRow?.estimated_lost_revenue || 0), "empty seats", classRow?.estimated_lost_revenue ? "warn" : "neutral"),
    ],
    insights: generateCapacityInsights({ ...capacity.metrics, topEmptyClass: classRow }),
    charts: [
      chart("bar", "Gender Breakdown", genderRows, { xKey: "gender", series: [{ key: "students", label: "Students" }] }),
      chart("bar", "Fee Category Breakdown", feeRows, { xKey: "fee_category", series: [{ key: "students", label: "Students" }] }),
    ],
    tables: [table("Class Student List", rows, ["student_name", "student_code", "gender", "status", "fee_category", "billed", "paid", "balance"])],
  })
}

async function buildWithdrawalDetailPage(schoolId, withdrawalId, session, settings) {
  const withdrawal = await getWithdrawalById(pool, schoolId, withdrawalId)
  const affected = await safeQuery(
    `SELECT a.id AS assessment_id, a.name AS assessment_name, subj.name AS subject_name, c.name AS class_name,
       ett.exam_date, rb.id AS batch_id, re.id AS result_entry_id, re.status AS result_status, re.score, re.comment
     FROM assessments a
     JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     JOIN exam_timetable_entries ett ON ett.assessment_id = a.id AND ett.school_id = a.school_id AND ett.status <> 'cancelled'
     LEFT JOIN result_batches rb ON rb.assessment_id = a.id AND rb.school_id = a.school_id
     LEFT JOIN result_entries re ON re.result_batch_id = rb.id AND re.school_id = rb.school_id AND re.student_id = ?
     WHERE a.school_id = ? AND a.class_id = ?
       AND ett.exam_date >= ?
       AND (? = 'permanent' OR ett.exam_date <= COALESCE(?, '9999-12-31'))
     ORDER BY ett.exam_date`,
    [withdrawal.student_id, schoolId, withdrawal.class_id || 0, withdrawal.start_date, withdrawal.withdrawal_type, withdrawal.end_date],
  )
  return makePage({
    section: "admissions-withdrawals",
    title: `${withdrawal.student_name} Withdrawal`,
    description: "Withdrawal reason, timeline, affected exams and result records marked absent.",
    session,
    detail: { type: "withdrawal", id: withdrawalId, back_path: "/admissions/withdrawals", withdrawal },
    kpis: [
      kpi("Withdrawal Type", withdrawal.withdrawal_type, withdrawal.computed_status, withdrawal.computed_status === "cancelled" ? "neutral" : "warn"),
      kpi("Start Date", withdrawal.start_date, "effective from", "neutral"),
      kpi("End Date", withdrawal.end_date || "Permanent", "effective until", "neutral"),
      kpi("Exams Affected", affected.length, "scheduled overlaps", affected.length ? "warn" : "good"),
      kpi("Absent Result Records", affected.filter((row) => row.result_status === "absent").length, "marked absent", "warn"),
      kpi("Created By", withdrawal.created_by_name || "-", withdrawal.created_at, "neutral"),
    ],
    insights: generateWithdrawalInsights({ activeWithdrawals: withdrawal.computed_status === "active" ? 1 : 0, temporaryWithdrawals: withdrawal.withdrawal_type === "temporary" && withdrawal.computed_status === "active" ? 1 : 0, examsAffected: affected.length }),
    report_sections: [
      { title: "Reason", body: withdrawal.reason || "No reason recorded." },
      { title: "Notes", body: withdrawal.notes || "No notes recorded." },
      { title: "Timeline", body: `${withdrawal.start_date} to ${withdrawal.end_date || "permanent"}; current status is ${withdrawal.computed_status}.` },
    ],
    tables: [table("Affected Exams and Results", affected, ["exam_date", "assessment_name", "subject_name", "class_name", "result_status", "score", "comment"], { empty_state: { title: "No affected exams", message: "No scheduled exams overlap this withdrawal period." } })],
  })
}

async function buildTeacherComplianceDetailPage(schoolId, teacherId, session) {
  const marks = await getMarksSubmissionAnalytics(schoolId, session)
  const staff = await getStaffAnalytics(schoolId, session, marks)
  const teacher = staff.teachers.find((row) => Number(row.teacher_id) === Number(teacherId))
  const batches = marks.batches.filter((row) => Number(row.teacher_id) === Number(teacherId))
  return makePage({
    section: "staff-teacher-compliance",
    title: `${teacher?.teacher_name || "Teacher"} Compliance`,
    description: "Teacher-level marks, assignments, lesson logs and pending accountability items.",
    session,
    detail: { type: "teacher_compliance", id: teacherId, back_path: "/staff/teacher-compliance" },
    kpis: [
      kpi("Assigned Classes", teacher?.classes_assigned || 0, "classes", "neutral"),
      kpi("Assigned Subjects", teacher?.subjects_assigned || 0, "subjects", "neutral"),
      kpi("Marks Submitted", teacher?.marks_submitted || 0, "batches", "good"),
      kpi("Pending Marks", teacher?.pending_marks || 0, "batches", teacher?.pending_marks ? "warn" : "good"),
      kpi("Lesson Logs", teacher?.lesson_logs_submitted || 0, "current term", "neutral"),
      kpi("Compliance Score", teacher?.compliance_score || 0, teacher?.status || "unknown", teacher?.status === "healthy" ? "good" : "warn"),
    ],
    insights: generateStaffInsights({ ...staff.metrics, highestWorkloadTeacher: teacher || staff.metrics.highestWorkloadTeacher }),
    tables: [table("Teacher Mark Batches", batches, ["assessment_name", "class_name", "subject_name", "submission_status", "entries_expected", "entries_marked", "absent_count", "completion_percent", "submitted_at", "locked_at"])],
  })
}

async function buildStudentRiskDetailPage(schoolId, studentId, session, settings) {
  const academic = await getAcademicCore(schoolId, session, settings)
  const finance = await getFinanceCore(schoolId, session, settings)
  const risks = await getAtRiskStudents(schoolId, session, settings, academic, finance)
  const risk = risks.find((row) => Number(row.student_id) === Number(studentId))
  const entries = academic.entries
    .filter((row) => Number(row.student_id) === Number(studentId))
    .sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)) || Number(a.id) - Number(b.id))
  const assignmentHistory = await safeQuery(
    `SELECT a.id AS assignment_id, subj.name AS subject_name, u.full_name AS teacher_name,
       ay.name AS academic_year, t.name AS term, a.is_active, a.created_at AS assigned_at,
       a.updated_at AS last_changed_at, a.notes
     FROM teacher_class_subject_assignments a
     JOIN students s ON s.class_id = a.class_id AND s.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     LEFT JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.school_id = a.school_id
     LEFT JOIN terms t ON t.id = a.term_id AND t.school_id = a.school_id
     WHERE a.school_id = ? AND s.id = ? AND a.subject_id IS NOT NULL
     ORDER BY subj.name, a.created_at, a.id`,
    [schoolId, studentId],
  )
  const subjectMap = new Map()
  for (const entry of entries) {
    if (!subjectMap.has(entry.subject_id)) subjectMap.set(entry.subject_id, { subject_id: entry.subject_id, subject_name: entry.subject_name, scores: [], teachers: new Set(), latest: null })
    const subject = subjectMap.get(entry.subject_id)
    if (entry.score_percent !== null) subject.scores.push(entry.score_percent)
    if (entry.teacher_name) subject.teachers.add(entry.teacher_name)
    subject.latest = entry
  }
  const subjectSummary = [...subjectMap.values()].map((subject) => {
    const first = subject.scores[0] ?? null
    const latest = subject.scores[subject.scores.length - 1] ?? null
    return {
      subject_name: subject.subject_name,
      current_teacher: subject.latest?.teacher_name || "Unassigned",
      teachers_seen: [...subject.teachers].join(" → ") || "Unassigned",
      assessment_count: subject.scores.length,
      average_score: subject.scores.length ? Number((subject.scores.reduce((sum, value) => sum + numberValue(value), 0) / subject.scores.length).toFixed(1)) : 0,
      latest_score: latest,
      change_from_first: first === null || latest === null ? 0 : Number((latest - first).toFixed(1)),
    }
  })
  const trendRows = entries.map((entry) => ({
    assessment: `${entry.assessment_name}${entry.assessment_date ? ` · ${entry.assessment_date}` : ""}`,
    score: entry.score_percent,
    pass_mark: settings.academic_pass_mark,
    subject: entry.subject_name,
    teacher: entry.teacher_name || "Unassigned",
  }))
  const teacherChanges = subjectSummary.filter((row) => row.teachers_seen.includes("→")).length
  return makePage({
    section: "academics-at-risk-students",
    title: `${risk?.student_name || "Student"} Risk Detail`,
    description: "Student-level academic, absence, withdrawal and finance risk evidence.",
    session,
    detail: { type: "student_risk", id: studentId, back_path: "/academics/at-risk-students" },
    kpis: [
      kpi("Risk Score", risk?.risk_score || 0, risk?.risk_level || "below threshold", risk?.risk_level === "critical" ? "bad" : "warn"),
      kpi("Average Score", percentLabel(risk?.average_score || 0), "scored entries", (risk?.average_score || 0) < settings.academic_pass_mark ? "warn" : "good"),
      kpi("Failed Subjects", risk?.failed_subjects_count || 0, "subject averages", risk?.failed_subjects_count ? "warn" : "good"),
      kpi("Assessment Absences", risk?.absent_assessments || 0, "absent entries", risk?.absent_assessments ? "warn" : "good"),
      kpi("Outstanding Balance", moneyLabel(risk?.outstanding_balance || 0), "fee risk", numberValue(risk?.outstanding_balance) >= settings.high_debt_threshold ? "bad" : "neutral"),
      kpi("Recommended Action", risk?.recommended_action || "monitor", "next step", "neutral"),
    ],
    insights: [
      { tone: risk?.risk_level === "critical" ? "bad" : "warn", metric: "student_risk", headline: `${risk?.risk_level || "Low"} learner risk requires ${risk?.recommended_action || "monitoring"}.`, detail: risk?.risk_factors || "No current risk factors recorded.", value: `${risk?.risk_score || 0}/100` },
      { tone: teacherChanges ? "warn" : "neutral", metric: "teacher_changes", headline: teacherChanges ? `Teacher changes appear in ${teacherChanges} subject${teacherChanges === 1 ? "" : "s"}.` : "No teacher change appears in submitted assessment evidence.", detail: "Teacher history combines class-subject assignments with the teacher recorded on each result batch.", value: String(teacherChanges) },
      { tone: (risk?.average_score || 0) < settings.academic_pass_mark ? "bad" : "good", metric: "academic_average", headline: `Overall performance is ${percentLabel(risk?.average_score || 0)} across all recorded assessments.`, detail: `The configured pass mark is ${percentLabel(settings.academic_pass_mark)}.`, value: percentLabel(risk?.average_score || 0) },
    ],
    charts: trendRows.length ? [chart("line", "Assessment Performance Trend", trendRows, { xKey: "assessment", series: [{ key: "score", label: "Student score %" }, { key: "pass_mark", label: "Pass mark %" }] })] : [],
    tables: [
      table("Performance by Subject", subjectSummary, ["subject_name", "current_teacher", "teachers_seen", "assessment_count", "average_score", "latest_score", "change_from_first"]),
      table("Teacher Assignment History", assignmentHistory, ["subject_name", "teacher_name", "academic_year", "term", "is_active", "assigned_at", "last_changed_at", "notes"]),
      table("All Assessment Evidence", entries, ["assessment_date", "assessment_name", "subject_name", "teacher_name", "class_name", "score_percent", "entry_status", "withdrawal_absence"]),
    ],
  })
}

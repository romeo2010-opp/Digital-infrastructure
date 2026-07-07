import { pool } from "../config/db.js"
import { getActiveAcademicSession } from "./academicSessionService.js"

function numberValue(value) {
  return Number(Number(value || 0).toFixed(2))
}

function termNameFromSession(session) {
  return [session.term?.name, session.academicYear?.name].filter(Boolean).join(" ") || "Current Term"
}

function accountStatus(amountDue, dueDate) {
  if (numberValue(amountDue) <= 0) return "paid"
  if (dueDate && String(dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10)) return "overdue"
  return "unpaid"
}

function earliestDate(values) {
  return values
    .map((value) => (value ? String(value).slice(0, 10) : ""))
    .filter(Boolean)
    .sort()[0] || null
}

export async function ensureFeeAccountsForActiveStudents(schoolId, options = {}) {
  const connection = options.connection || pool
  const session = options.session || await getActiveAcademicSession(schoolId, connection)
  if (session.setupRequired) {
    return { created: 0, updated: 0, skipped: 0, setupRequired: true }
  }

  const studentIds = Array.isArray(options.studentIds)
    ? options.studentIds.map((id) => Number(id || 0)).filter(Boolean)
    : []
  const studentConditions = ["s.school_id = ?", "s.status = 'active'"]
  const studentParams = [schoolId]
  if (studentIds.length) {
    studentConditions.push(`s.id IN (${studentIds.map(() => "?").join(",")})`)
    studentParams.push(...studentIds)
  }

  const [students] = await connection.query(
    `SELECT s.id, COALESCE(se.class_id, s.class_id) AS class_id
     FROM students s
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     WHERE ${studentConditions.join(" AND ")}`,
    [session.academicYearId, session.termId, ...studentParams],
  )
  if (!students.length) return { created: 0, updated: 0, skipped: 0, setupRequired: false }

  const [structures] = await connection.query(
    `SELECT fs.id, fs.class_id, fs.due_date, COALESCE(SUM(fi.amount), 0) AS total_amount
     FROM finance_fee_structures fs
     LEFT JOIN finance_fee_structure_items fi ON fi.fee_structure_id = fs.id AND fi.school_id = fs.school_id
     WHERE fs.school_id = ?
      AND fs.status = 'active'
      AND (fs.academic_year_id IS NULL OR fs.academic_year_id = ?)
      AND (fs.term_id IS NULL OR fs.term_id = ?)
     GROUP BY fs.id, fs.class_id, fs.due_date
     ORDER BY fs.class_id IS NULL DESC, fs.id ASC`,
    [schoolId, session.academicYearId, session.termId],
  )

  const termName = termNameFromSession(session)
  let created = 0
  let updated = 0
  let skipped = 0

  for (const student of students) {
    const applicable = structures.filter((structure) => !structure.class_id || Number(structure.class_id) === Number(student.class_id || 0))
    const amountDue = applicable.reduce((sum, structure) => sum + numberValue(structure.total_amount), 0)
    const dueDate = earliestDate(applicable.map((structure) => structure.due_date))
    const feeStructureId = applicable.length === 1 ? Number(applicable[0].id) : null
    const [result] = await connection.query(
      `INSERT INTO fee_accounts (
        school_id, student_id, academic_year_id, term_id, class_id, fee_structure_id,
        term_name, amount_due, amount_paid, discount_amount, penalty_amount, status, due_date, finance_notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'Auto-created by SmartLink finance account sync.')
       ON DUPLICATE KEY UPDATE
        academic_year_id = VALUES(academic_year_id),
        term_id = VALUES(term_id),
        class_id = COALESCE(fee_accounts.class_id, VALUES(class_id)),
        fee_structure_id = COALESCE(fee_accounts.fee_structure_id, VALUES(fee_structure_id)),
        amount_due = CASE
          WHEN fee_accounts.amount_due = 0 AND fee_accounts.amount_paid = 0 THEN VALUES(amount_due)
          ELSE fee_accounts.amount_due
        END,
        due_date = COALESCE(fee_accounts.due_date, VALUES(due_date)),
        status = CASE
          WHEN (CASE WHEN fee_accounts.amount_due = 0 AND fee_accounts.amount_paid = 0 THEN VALUES(amount_due) ELSE fee_accounts.amount_due END)
            + fee_accounts.penalty_amount - fee_accounts.discount_amount - fee_accounts.amount_paid <= 0 THEN 'paid'
          WHEN COALESCE(fee_accounts.due_date, VALUES(due_date)) IS NOT NULL
            AND COALESCE(fee_accounts.due_date, VALUES(due_date)) < CURRENT_DATE THEN 'overdue'
          WHEN fee_accounts.amount_paid > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        finance_notes = COALESCE(fee_accounts.finance_notes, VALUES(finance_notes))`,
      [
        schoolId,
        student.id,
        session.academicYearId,
        session.termId,
        student.class_id || null,
        feeStructureId,
        termName,
        amountDue,
        accountStatus(amountDue, dueDate),
        dueDate,
      ],
    )

    if (result.affectedRows === 1) created += 1
    else if (result.affectedRows === 2) updated += 1
    else skipped += 1
  }

  return { created, updated, skipped, setupRequired: false }
}

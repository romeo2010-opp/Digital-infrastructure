import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"
import { studentCodeSortSql } from "../utils/studentSort.js"

export async function listFeeAccounts(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({ feeAccounts: [], session: sessionPayload(session), setup_required: true })
  }
  const [rows] = await pool.query(
    `SELECT f.id, s.first_name, s.last_name, c.name AS class_name, f.term_name, f.amount_due,
      f.amount_paid, (f.amount_due - f.amount_paid) AS balance, f.status
     FROM fee_accounts f
     JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
     JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
     JOIN classes c ON c.id = se.class_id AND c.school_id = se.school_id
     WHERE f.school_id = ? AND s.status = 'active'
     ORDER BY balance DESC, ${studentCodeSortSql("s")}, s.last_name`,
    [session.academicYearId, session.termId, schoolId],
  )
  res.json({ feeAccounts: rows, session: sessionPayload(session), setup_required: false })
}

export async function recordPayment(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { fee_account_id, amount, payment_method, reference } = req.body
  if (!fee_account_id || !amount) throw new HttpError(400, "fee_account_id and amount are required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[account]] = await connection.query("SELECT id FROM fee_accounts WHERE id = ? AND school_id = ? FOR UPDATE", [fee_account_id, schoolId])
    if (!account) throw new HttpError(404, "Fee account not found")

    const receiptNo = `SLR-${Date.now()}`
    await connection.query(
      `INSERT INTO fee_payments (school_id, fee_account_id, amount, payment_method, reference, receipt_no, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, fee_account_id, amount, payment_method || "cash", reference || null, receiptNo, req.user.id],
    )
    await connection.query(
      `UPDATE fee_accounts
       SET amount_paid = amount_paid + ?,
           status = CASE WHEN amount_paid + ? >= amount_due THEN 'paid' ELSE 'partial' END
       WHERE id = ? AND school_id = ?`,
      [amount, amount, fee_account_id, schoolId],
    )
    await connection.commit()
    res.status(201).json({ receiptNo })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

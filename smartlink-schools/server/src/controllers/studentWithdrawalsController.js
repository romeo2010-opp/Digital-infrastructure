import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"

async function resolveStudentReference(schoolId, value) {
  const [[row]] = await pool.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1", [schoolId,String(value||"")])
  if (!row) throw new HttpError(404,"Student was not found")
  return Number(row.id)
}
import {
  cancelStudentWithdrawalRecord,
  createStudentWithdrawalRecord,
  getStudentWithdrawalHistory,
  getWithdrawalForStudentOnDate,
  listStudentWithdrawals,
} from "../services/studentWithdrawalService.js"

function requireWithdrawalManager(req) {
  const role = String(req.user?.role || "")
  if (["super_admin", "school_owner", "director", "owner", "headteacher"].includes(role)) return
  throw new HttpError(403, "Only school leadership can manage student withdrawals")
}

export async function createStudentWithdrawal(req, res) {
  requireWithdrawalManager(req)
  const schoolId = getScopedSchoolId(req)
  const studentId = await resolveStudentReference(schoolId, req.params.studentId || req.params.id)
  if (!studentId) throw new HttpError(400, "Student id is required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const withdrawal = await createStudentWithdrawalRecord({
      schoolId,
      studentId,
      payload: req.body || {},
      userId: req.user.id,
      connection,
    })
    await connection.commit()
    res.status(201).json({ withdrawal })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listStudentWithdrawalHistory(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = await resolveStudentReference(schoolId, req.params.studentId || req.params.id)
  if (!studentId) throw new HttpError(400, "Student id is required")
  const withdrawals = await getStudentWithdrawalHistory(pool, schoolId, studentId)
  res.json({ withdrawals })
}

export async function listDirectorWithdrawals(req, res) {
  const schoolId = getScopedSchoolId(req)
  const withdrawals = await listStudentWithdrawals(pool, schoolId, req.query || {})
  res.json({ withdrawals })
}

export async function cancelStudentWithdrawal(req, res) {
  requireWithdrawalManager(req)
  const schoolId = getScopedSchoolId(req)
  const studentId = await resolveStudentReference(schoolId, req.params.studentId || req.params.id)
  const withdrawalId = Number(req.params.withdrawalId || 0)
  if (!studentId || !withdrawalId) throw new HttpError(400, "Student and withdrawal ids are required")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const withdrawal = await cancelStudentWithdrawalRecord({
      schoolId,
      studentId,
      withdrawalId,
      userId: req.user.id,
      reason: req.body?.reason || req.body?.cancel_reason || req.body?.cancelReason,
      connection,
    })
    await connection.commit()
    res.json({ withdrawal })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getStudentWithdrawalStatus(req, res) {
  const schoolId = getScopedSchoolId(req)
  const studentId = await resolveStudentReference(schoolId, req.params.studentId || req.params.id)
  const date = req.query.date
  if (!studentId) throw new HttpError(400, "Student id is required")
  if (!date) throw new HttpError(400, "Date is required")
  const withdrawal = await getWithdrawalForStudentOnDate(pool, schoolId, studentId, date)
  res.json({
    withdrawn: Boolean(withdrawal),
    withdrawal,
    date: String(date).slice(0, 10),
  })
}

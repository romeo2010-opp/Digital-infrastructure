import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

export async function getActiveAcademicSession(schoolId, connection = pool) {
  const [[academicYear]] = await connection.query(
    `SELECT *
     FROM academic_years
     WHERE school_id = ? AND is_active = 1 AND status <> 'archived'
     ORDER BY status = 'active' DESC, start_date DESC, id DESC
     LIMIT 1`,
    [schoolId],
  )

  if (!academicYear) {
    return {
      academicYear: null,
      term: null,
      academicYearId: null,
      termId: null,
      activeTermStatus: null,
      setupRequired: true,
      message: "No active academic year is configured for this school.",
    }
  }

  const [[term]] = await connection.query(
    `SELECT *
     FROM terms
     WHERE school_id = ? AND academic_year_id = ? AND status IN ('open', 'marking')
     ORDER BY FIELD(status, 'open', 'marking'), term_number DESC, id DESC
     LIMIT 1`,
    [schoolId, academicYear.id],
  )

  if (!term) {
    return {
      academicYear,
      term: null,
      academicYearId: Number(academicYear.id),
      termId: null,
      activeTermStatus: null,
      setupRequired: true,
      message: "No open or marking term is configured for the active academic year.",
    }
  }

  return {
    academicYear,
    term,
    academicYearId: Number(academicYear.id),
    termId: Number(term.id),
    activeTermStatus: term.status,
    setupRequired: false,
    message: "",
  }
}

export async function requireActiveAcademicSession(schoolId, connection = pool) {
  const session = await getActiveAcademicSession(schoolId, connection)
  if (session.setupRequired) throw new HttpError(409, session.message)
  return session
}

export function sessionPayload(session) {
  return {
    academic_year: session.academicYear || null,
    term: session.term || null,
    academic_year_id: session.academicYearId || null,
    term_id: session.termId || null,
    active_term_status: session.activeTermStatus || null,
    setup_required: Boolean(session.setupRequired),
    message: session.message || "",
  }
}

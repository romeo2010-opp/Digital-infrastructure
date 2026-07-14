import { pool } from "../config/db.js"
import { databaseErrorDiagnostic } from "../utils/databaseErrors.js"

export async function recordSystemError({ errorId, error, req, status }) {
  const diagnostic = databaseErrorDiagnostic(error)
  try {
    await pool.query(
      `INSERT INTO system_error_logs (
        error_id, school_id, user_id, http_method, request_path, http_status,
        error_code, constraint_name, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        errorId,
        Number(req?.user?.school_id || req?.user?.schoolId) || null,
        Number(req?.user?.id) || null,
        String(req?.method || "").slice(0, 10) || null,
        String(req?.originalUrl || req?.url || "").slice(0, 500) || null,
        Number(status) || 500,
        String(diagnostic.database_code || error?.code || "").slice(0, 80) || null,
        String(diagnostic.constraint_name || "").slice(0, 160) || null,
        String(error?.message || "Unexpected server error").slice(0, 2000),
      ],
    )
  } catch (loggingError) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(loggingError?.code)) {
      console.warn("[smartlink-schools] unable to persist error diagnostic", loggingError?.code || loggingError?.message)
    }
  }
}

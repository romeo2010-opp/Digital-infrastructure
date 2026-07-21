import "dotenv/config"
import mysql from "mysql2/promise"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const requestedDays = Number(process.argv[2] || 30)
const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, Math.trunc(requestedDays))) : 30
const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true })

function normalizePath(value) {
  return String(value || "")
    .replace(/\?.*$/, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":ref")
    .replace(/\/(\d+)(?=\/|$)/g, "/:id")
}

function normalizeMessage(value) {
  return String(value || "Unknown error")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":ref")
    .replace(/\bat line \d+\b/gi, "at line ?")
    .slice(0, 1000)
}

try {
  await connection.query("SET SESSION TRANSACTION READ ONLY")
  await connection.query("START TRANSACTION READ ONLY")
  const [[identity]] = await connection.query(
    "SELECT DATABASE() database_name, VERSION() server_version, @@version_comment version_comment",
  )
  const [[tableStatus]] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_error_logs'`,
  )
  if (!Number(tableStatus.table_count)) {
    console.log(JSON.stringify({ identity, days, status: "unavailable", reason: "system_error_logs is missing" }, null, 2))
  } else {
    const [errors] = await connection.query(
      `SELECT error_id, http_method, request_path, http_status, error_code, error_message, created_at
         FROM system_error_logs
        WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        ORDER BY created_at DESC
        LIMIT 1000`,
      [days],
    )
    const groups = new Map()
    for (const error of errors) {
      const path = normalizePath(error.request_path)
      const message = normalizeMessage(error.error_message)
      const key = [error.error_code || "UNCLASSIFIED", error.http_method || "", path, message].join("|")
      const current = groups.get(key) || {
        error_code: error.error_code || null,
        http_method: error.http_method || null,
        request_path: path || null,
        http_status: Number(error.http_status || 500),
        error_message: message,
        count: 0,
        first_seen: error.created_at,
        last_seen: error.created_at,
        latest_error_id: error.error_id,
      }
      current.count += 1
      if (String(error.created_at) < String(current.first_seen)) current.first_seen = error.created_at
      if (String(error.created_at) > String(current.last_seen)) {
        current.last_seen = error.created_at
        current.latest_error_id = error.error_id
      }
      groups.set(key, current)
    }
    const errorGroups = [...groups.values()].sort((left, right) =>
      right.count - left.count || String(right.last_seen).localeCompare(String(left.last_seen)),
    )
    console.log(JSON.stringify({
      identity,
      days,
      recorded_errors: errors.length,
      distinct_error_groups: errorGroups.length,
      error_groups: errorGroups,
    }, null, 2))
  }
  await connection.query("ROLLBACK")
} finally {
  await connection.end()
}

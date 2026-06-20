import mysql from "mysql2/promise"

const config = process.env.DATABASE_URL || {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "smartlink_schools",
  multipleStatements: false,
}

const connection = await mysql.createConnection(config)
const changes = []

async function hasColumn(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  )
  return rows.length > 0
}

try {
  if (!(await hasColumn("users", "must_change_password"))) {
    await connection.query("ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash")
    changes.push("users.must_change_password")
  }

  if (!(await hasColumn("users", "password_changed_at"))) {
    await connection.query("ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL AFTER must_change_password")
    changes.push("users.password_changed_at")
  }

  console.log(changes.length ? `Applied: ${changes.join(", ")}` : "No password policy changes needed.")
} finally {
  await connection.end()
}

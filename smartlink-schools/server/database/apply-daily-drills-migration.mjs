import fs from "fs/promises"
import path from "path"
import dotenv from "dotenv"
import mysql from "mysql2/promise"

dotenv.config()

const config = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL, multipleStatements: true, dateStrings: ["DATE"] }
  : {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "smartlink_schools",
      multipleStatements: true,
      dateStrings: ["DATE"],
    }

const connection = await mysql.createConnection(config)

try {
  const migrations = [
    "007_daily_drills_syllabus_intelligence.sql",
    "008_gemini_ai_pilot.sql",
    "009_greenhill_cambridge_primary.sql",
    "010_manual_syllabus_entries.sql",
    "011_manual_syllabus_drafts.sql",
    "012_ai_tts_usage.sql",
  ]
  for (const migration of migrations) {
    const sqlPath = path.resolve("database", migration)
    const sql = await fs.readFile(sqlPath, "utf8")
    await connection.query(sql)
    console.log(`${migration} applied.`)
  }
} finally {
  await connection.end()
}

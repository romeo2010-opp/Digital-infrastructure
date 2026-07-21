import fs from "fs/promises"
import path from "path"
import dotenv from "dotenv"
import mysql from "mysql2/promise"
import { DAILY_DRILL_SCHEMA_MIGRATIONS, validateDatabaseFileSelection } from "../scripts/lib/databaseFilePolicy.mjs"
import { applyPortableSql } from "../scripts/lib/portableSql.mjs"

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

const migrations = validateDatabaseFileSelection(DAILY_DRILL_SCHEMA_MIGRATIONS, { seedOnly: false })
const connection = await mysql.createConnection(config)

try {
  for (const migration of migrations) {
    const sqlPath = path.resolve("database", migration)
    const sql = await fs.readFile(sqlPath, "utf8")
    const result = await applyPortableSql(connection, sql, { source: migration, log: console.log })
    console.log(`${migration} applied (${result.applied} statements, ${result.skipped} existing objects, ${result.dialect}).`)
  }
} finally {
  await connection.end()
}

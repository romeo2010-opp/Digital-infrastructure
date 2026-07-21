import fs from "fs"
import path from "path"
import mysql from "mysql2/promise"
import { applyPortableSql } from "./lib/portableSql.mjs"
import { validateDatabaseFileSelection } from "./lib/databaseFilePolicy.mjs"

const args = process.argv.slice(2)
const relaxedForeignKeys = args.includes("--relaxed-foreign-keys")
const seedOnly = args.includes("--seed-only")
const files = args.filter((arg) => !arg.startsWith("--"))
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required, for example: DATABASE_URL='mysql://user:pass@host:3306/database' npm run db:apply -- database/schema.sql")
  process.exit(1)
}

if (!files.length) {
  console.error("Pass one or more SQL files to apply.")
  process.exit(1)
}

try {
  validateDatabaseFileSelection(files, { seedOnly })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const connection = await mysql.createConnection({
  uri: databaseUrl,
})

try {
  if (seedOnly) console.log("Explicit seed-only database mode enabled.")
  if (relaxedForeignKeys) {
    console.log("Foreign key checks disabled for this import.")
    await connection.query("SET FOREIGN_KEY_CHECKS = 0")
  }
  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file)
    const sql = fs.readFileSync(filePath, "utf8")
    if (!sql.trim()) {
      console.log(`Skipped empty SQL file: ${file}`)
      continue
    }
    console.log(`Applying ${file}`)
    const result = await applyPortableSql(connection, sql, { source: file, log: console.log })
    console.log(`Applied ${result.applied} statements; skipped ${result.skipped} existing objects (${result.dialect}).`)
  }
  if (relaxedForeignKeys) {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1")
  }
  console.log("Database SQL applied successfully.")
} finally {
  if (relaxedForeignKeys) {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {})
  }
  await connection.end()
}

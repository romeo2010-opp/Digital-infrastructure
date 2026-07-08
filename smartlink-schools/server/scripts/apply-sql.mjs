import fs from "fs"
import path from "path"
import mysql from "mysql2/promise"

const files = process.argv.slice(2)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required, for example: DATABASE_URL='mysql://user:pass@host:3306/database' npm run db:apply -- database/schema.sql")
  process.exit(1)
}

if (!files.length) {
  console.error("Pass one or more SQL files to apply.")
  process.exit(1)
}

function sanitizeSql(sql) {
  return sql
    .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+smartlink_schools\b[^;]*;\s*/gim, "")
    .replace(/^\s*USE\s+smartlink_schools\s*;\s*/gim, "")
}

const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: true,
})

try {
  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file)
    const sql = sanitizeSql(fs.readFileSync(filePath, "utf8"))
    if (!sql.trim()) {
      console.log(`Skipped empty SQL file: ${file}`)
      continue
    }
    console.log(`Applying ${file}`)
    await connection.query(sql)
  }
  console.log("Database SQL applied successfully.")
} finally {
  await connection.end()
}

import "dotenv/config"
import fs from "fs"
import path from "path"
import mysql from "mysql2/promise"

const sourceUrl = process.env.DATABASE_URL
if (!sourceUrl) throw new Error("DATABASE_URL is required")
const parsed = new URL(sourceUrl)
const sourceDatabase = parsed.pathname.replace(/^\//, "")
const validationDatabase = `smartlink_support_migration_${process.pid}_${Date.now()}`
if (!sourceDatabase || !validationDatabase.startsWith("smartlink_support_migration_")) throw new Error("Unsafe migration validation database name")
parsed.pathname = "/"

const connection = await mysql.createConnection({ uri: parsed.toString(), multipleStatements: true })
const quote = (value) => `\`${String(value).replaceAll("`", "``")}\``
const requiredSourceTables = [
  "schools", "academic_years", "terms", "classes", "students", "subjects", "syllabus_topics",
  "learning_objectives", "users", "assessments", "assessment_questions", "mastery_evidence",
  "academic_mastery_records", "academic_interventions", "generated_assessments", "academic_mark_sheets",
  "academic_intervention_reassessments", "student_guardians", "result_batches",
]

try {
  const [staleDatabases] = await connection.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'smartlink\\_support\\_migration\\_%'")
  for (const { schema_name: stale } of staleDatabases) await connection.query(`DROP DATABASE ${quote(stale)}`)
  await connection.query(`CREATE DATABASE ${quote(validationDatabase)}`)
  const [tables] = await connection.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' AND table_name IN (${requiredSourceTables.map(() => "?").join(",")}) ORDER BY table_name`, [sourceDatabase, ...requiredSourceTables])
  if (tables.length !== requiredSourceTables.length) throw new Error(`Migration validation is missing source tables: ${requiredSourceTables.filter((name) => !tables.some((row) => row.table_name === name)).join(", ")}`)
  for (const table of requiredSourceTables) await connection.query(`CREATE TABLE ${quote(validationDatabase)}.${quote(table)} LIKE ${quote(sourceDatabase)}.${quote(table)}`)
  await connection.query(`USE ${quote(validationDatabase)}`)
  const migrationPath = path.resolve(process.cwd(), "database/060_learner_support_cases.sql")
  const sql = fs.readFileSync(migrationPath, "utf8").replace(/^\s*USE\s+smartlink_schools\s*;\s*/im, "")
  await connection.query(sql)
  const [supportTables] = await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND (table_name LIKE '%support%' OR table_name IN ('intervention_cycles','intervention_sessions','intervention_strategy_types','academic_review_meetings','guardian_review_records','escalation_policies','escalation_decisions')) ORDER BY table_name", [validationDatabase])
  const [masteryColumns] = await connection.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=? AND ((table_name='mastery_evidence' AND column_name IN ('assessment_id','question_id','evidence_precision','publication_state','evidence_status','recorded_at')) OR (table_name='academic_mastery_records' AND column_name IN ('academic_year_id','term_id','session_scope_key'))) ORDER BY table_name,column_name", [validationDatabase])
  console.log(JSON.stringify({ status: "passed", source_database: sourceDatabase, cloned_tables: tables.length, support_tables: supportTables.map((row) => row.table_name), mastery_columns: masteryColumns }, null, 2))
} finally {
  if (validationDatabase.startsWith("smartlink_support_migration_")) await connection.query(`DROP DATABASE IF EXISTS ${quote(validationDatabase)}`)
  await connection.end()
}

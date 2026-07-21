import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  DAILY_DRILL_SCHEMA_MIGRATIONS,
  TENANT_SEED_ONLY_FILES,
  isSchemaContractDefinitionFile,
  isSchemaMigrationFile,
  isSeedOnlyDatabaseFile,
  validateDatabaseFileSelection,
} from "../scripts/lib/databaseFilePolicy.mjs"
import { splitSqlStatements } from "../scripts/lib/portableSql.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const expectedTenantSeeds = [
  "009_greenhill_cambridge_primary.sql",
  "020_reign_internation_academy.sql",
  "021_ria_friday_half_day_schedule.sql",
  "052_romeo_jfk_international_academy_demo.sql",
]

const expectedAcceptedSeedFiles = [
  "seed.sql",
  "seed-school-demo.sql",
  "seed-academic-progression-demo.sql",
  "seed-academic-library-classroom-demo.sql",
  ...expectedTenantSeeds,
].sort()

const acceptedSeedFiles = fs.readdirSync(path.join(root, "database"))
  .filter((file) => file.toLowerCase().endsWith(".sql") && isSeedOnlyDatabaseFile(file))
  .sort()

function seedSql(file) {
  return fs.readFileSync(path.join(root, "database", file), "utf8")
}

function insertedEntity(statement) {
  const match = String(statement).match(/^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z_]\w*)`?\s*\(([\s\S]*?)\)\s*(?:VALUES|SELECT)\b/i)
  if (!match) return null
  return {
    table: match[1].toLowerCase(),
    columns: match[2].split(",").map((column) => column.replaceAll("`", "").trim().toLowerCase()),
  }
}

test("tenant and demo SQL files are excluded from every schema classification", () => {
  assert.deepEqual(TENANT_SEED_ONLY_FILES, expectedTenantSeeds)
  for (const file of expectedTenantSeeds) {
    assert.equal(isSeedOnlyDatabaseFile(file), true)
    assert.equal(isSchemaMigrationFile(file), false)
    assert.equal(isSchemaContractDefinitionFile(file), false)
    assert.throws(
      () => validateDatabaseFileSelection([path.join("database", file)]),
      (error) => error?.code === "SEED_FILE_REQUIRES_OPT_IN",
    )
  }
})

test("seed-only mode is explicit and cannot be mixed with schema migrations", () => {
  assert.deepEqual(acceptedSeedFiles, expectedAcceptedSeedFiles)
  assert.deepEqual(
    validateDatabaseFileSelection(acceptedSeedFiles, { seedOnly: true }),
    acceptedSeedFiles,
  )
  assert.throws(
    () => validateDatabaseFileSelection(["060_learner_support_cases.sql"], { seedOnly: true }),
    (error) => error?.code === "SCHEMA_FILE_IN_SEED_MODE",
  )
  assert.equal(isSeedOnlyDatabaseFile("database/seed.sql"), true)
  assert.equal(isSeedOnlyDatabaseFile("database/seed-school-demo.sql"), true)
})

test("schema mode rejects database dumps and unnumbered ad-hoc SQL", () => {
  assert.deepEqual(validateDatabaseFileSelection(["database/schema.sql"]), ["database/schema.sql"])
  assert.deepEqual(validateDatabaseFileSelection(["database/062_teacher_learner_support_access.sql"]), ["database/062_teacher_learner_support_access.sql"])
  for (const file of ["database/smartlink_schools2.sql", "database/manual-hotfix.sql"]) {
    assert.throws(
      () => validateDatabaseFileSelection([file]),
      (error) => error?.code === "UNREGISTERED_SCHEMA_FILE",
    )
  }
})

test("daily-drill schema manifest contains only portable feature migrations", () => {
  assert.deepEqual(DAILY_DRILL_SCHEMA_MIGRATIONS, [
    "007_daily_drills_syllabus_intelligence.sql",
    "008_gemini_ai_pilot.sql",
    "010_manual_syllabus_entries.sql",
    "011_manual_syllabus_drafts.sql",
    "012_ai_tts_usage.sql",
    "013_drill_ai_feedback.sql",
    "014_teacher_lesson_logs_drill_engine.sql",
    "015_drill_scoring_interventions.sql",
  ])
  for (const file of DAILY_DRILL_SCHEMA_MIGRATIONS) {
    assert.equal(isSchemaMigrationFile(file), true)
    assert.equal(isSeedOnlyDatabaseFile(file), false)
    assert.equal(fs.existsSync(path.join(root, "database", file)), true)
  }
})

test("database entry points share the seed-only policy", () => {
  const applySql = fs.readFileSync(path.join(root, "scripts", "apply-sql.mjs"), "utf8")
  const dailyDrills = fs.readFileSync(path.join(root, "database", "apply-daily-drills-migration.mjs"), "utf8")
  const schemaAudit = fs.readFileSync(path.join(root, "scripts", "audit-schema-contracts.mjs"), "utf8")
  assert.match(applySql, /validateDatabaseFileSelection\(files, \{ seedOnly \}\)/)
  assert.match(dailyDrills, /DAILY_DRILL_SCHEMA_MIGRATIONS/)
  assert.match(dailyDrills, /validateDatabaseFileSelection/)
  assert.match(schemaAudit, /\.filter\(isSchemaContractDefinitionFile\)/)
})

test("accepted seeds preserve identity and credential safety contracts", () => {
  const inserted = { users: 0, students: 0, student_guardians: 0 }
  for (const file of acceptedSeedFiles) {
    const sql = seedSql(file)
    assert.doesNotMatch(sql, /\buser_id\b/i, `${file} still refers to the removed students.user_id contract`)
    for (const statement of splitSqlStatements(sql)) {
      const entity = insertedEntity(statement)
      if (entity && Object.hasOwn(inserted, entity.table)) {
        inserted[entity.table] += 1
        assert.equal(entity.columns.includes("public_ref"), true, `${file} must assign public_ref when inserting ${entity.table}`)
      }
      if (entity?.table === "users") {
        assert.equal(entity.columns.includes("password_hash"), true, `${file} user seeds must declare password_hash`)
        assert.equal(entity.columns.includes("must_change_password"), true, `${file} user seeds must declare must_change_password`)
        assert.match(statement, /(?:@[a-z0-9_]*password_hash|'\$2[aby]\$[^']+')\s*,\s*1\b/i, `${file} must force password change for newly inserted demo users`)
        assert.doesNotMatch(statement, /(?:@[a-z0-9_]*password_hash|'\$2[aby]\$[^']+')\s*,\s*(?:0|false)\b/i, `${file} cannot create a demo user with password change disabled`)
        const duplicateClause = statement.match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/i)?.[1] || ""
        assert.doesNotMatch(duplicateClause, /\b(?:password_hash|must_change_password)\b/i, `${file} cannot reset credentials during an idempotent rerun`)
      }
      if (/^\s*UPDATE\s+`?users`?\b/i.test(statement)) {
        assert.doesNotMatch(statement, /\b(?:password_hash|must_change_password)\s*=/i, `${file} cannot reset credentials during a rerun`)
      }
    }
  }
  assert.ok(inserted.users > 0)
  assert.ok(inserted.students > 0)
  assert.ok(inserted.student_guardians > 0)
})

test("every accepted seed file splits into complete SQL statements", () => {
  const statementStart = /^\s*(?:SET|START|COMMIT|ROLLBACK|SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|TRUNCATE|WITH|CALL)\b/i
  for (const file of acceptedSeedFiles) {
    assert.equal(isSeedOnlyDatabaseFile(file), true)
    assert.equal(fs.existsSync(path.join(root, "database", file)), true)
    const statements = splitSqlStatements(seedSql(file))
    assert.ok(statements.length > 0, `${file} did not produce any SQL statements`)
    for (const [index, statement] of statements.entries()) {
      assert.match(statement, statementStart, `${file} statement ${index + 1} is not a complete seed statement`)
    }
  }
})

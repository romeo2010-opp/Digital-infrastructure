import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  applyPortableSql,
  expandAlterStatement,
  portableStatement,
  splitSqlStatements,
} from "../scripts/lib/portableSql.mjs"

test("SQL statement splitting respects strings, comments, and nested commas", () => {
  const statements = splitSqlStatements(`
    -- a comment with ; punctuation
    INSERT INTO sample (label, amount) VALUES ('A;B', DECIMAL(5,2));
    /* another ; comment */
    UPDATE sample SET label='C'';D' /* inline comment */ WHERE id=1;
  `)
  assert.equal(statements.length, 2)
  assert.match(statements[0], /A;B/)
  assert.match(statements[1], /C'';D/)
})

test("compound ALTER statements are split only at top-level commas", () => {
  const statements = expandAlterStatement(`ALTER TABLE sample
    ADD COLUMN IF NOT EXISTS ratio DECIMAL(5,2) NULL,
    ADD COLUMN IF NOT EXISTS state ENUM('a','b') NULL,
    ADD CONSTRAINT fk_sample_parent FOREIGN KEY (parent_id) REFERENCES parent(id)`)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /DECIMAL\(5,2\)/)
  assert.match(statements[1], /ENUM\('a','b'\)/)
  assert.match(statements[2], /ADD CONSTRAINT/)
})

test("MySQL portability removes unsupported idempotency clauses", () => {
  const column = portableStatement("ALTER TABLE sample ADD COLUMN IF NOT EXISTS public_ref CHAR(36)", "mysql")
  assert.equal(column.sql, "ALTER TABLE sample ADD COLUMN public_ref CHAR(36)")
  assert.ok(column.ignoreCodes.has("ER_DUP_FIELDNAME"))

  const index = portableStatement("ALTER TABLE sample ADD UNIQUE KEY IF NOT EXISTS uq_sample (public_ref)", "mysql")
  assert.equal(index.sql, "ALTER TABLE sample ADD UNIQUE KEY uq_sample (public_ref)")
  assert.ok(index.ignoreCodes.has("ER_DUP_KEYNAME"))

  const maria = portableStatement("ALTER TABLE sample ADD COLUMN IF NOT EXISTS public_ref CHAR(36)", "mariadb")
  assert.match(maria.sql, /IF NOT EXISTS/)

  const foreignKey = portableStatement("ALTER TABLE sample DROP FOREIGN KEY IF EXISTS fk_sample_parent", "mysql")
  assert.equal(foreignKey.sql, "ALTER TABLE sample DROP FOREIGN KEY fk_sample_parent")
  assert.ok(foreignKey.ignoreCodes.has("ER_CANT_DROP_FIELD_OR_KEY"))
})

test("portable application continues after an explicitly idempotent duplicate", async () => {
  const calls = []
  const connection = {
    async query(sql) {
      calls.push(sql)
      if (/old_column/.test(sql)) {
        const error = new Error("duplicate")
        error.code = "ER_DUP_FIELDNAME"
        throw error
      }
      return [[], []]
    },
  }
  const result = await applyPortableSql(connection, `ALTER TABLE sample
    ADD COLUMN IF NOT EXISTS old_column INT,
    ADD COLUMN IF NOT EXISTS new_column INT;`, { dialect: "mysql" })
  assert.equal(result.skipped, 1)
  assert.equal(result.applied, 1)
  assert.equal(calls.length, 2)
})

test("teacher learner-support migration expands into MySQL-compatible statements", async () => {
  const source = await readFile(new URL("../database/062_teacher_learner_support_access.sql", import.meta.url), "utf8")
  const calls = []
  const connection = { async query(sql) { calls.push(sql); return [[], []] } }
  const result = await applyPortableSql(connection, source, { dialect: "mysql" })
  assert.ok(result.applied >= 10)
  assert.ok(calls.some((sql) => /MODIFY COLUMN status ENUM/.test(sql)))
  assert.ok(calls.some((sql) => /ADD CONSTRAINT fk_intervention_session_topic/.test(sql)))
  assert.ok(calls.every((sql) => !/ADD COLUMN IF NOT EXISTS/i.test(sql)))
})

test("lesson-log timetable correction is idempotent and targets the school timetable", async () => {
  const source = await readFile(new URL("../database/064_lesson_log_timetable_scope.sql", import.meta.url), "utf8")
  const calls = []
  const connection = { async query(sql) { calls.push(sql); return [[], []] } }
  const result = await applyPortableSql(connection, source, { dialect: "mysql" })
  assert.equal(result.applied, 3)
  assert.ok(calls.some((sql) => /information_schema\.key_column_usage/.test(sql)))
  assert.ok(calls.some((sql) => /referenced_table_name='exam_timetable_entries'/.test(sql)))
  assert.ok(calls.some((sql) => /DROP FOREIGN KEY fk_lesson_logs_timetable/.test(sql)))
  assert.ok(calls.some((sql) => /REFERENCES timetable_entries\(id\)/.test(sql)))
  assert.ok(calls.every((sql) => !/REFERENCES exam_timetable_entries\(id\)/.test(sql)))
})

test("legacy teacher assignments are backfilled only into a deterministic session", async () => {
  const source = await readFile(new URL("../database/065_teacher_assignment_session_backfill.sql", import.meta.url), "utf8")
  const calls = []
  const connection = { async query(sql) { calls.push(sql); return [[], []] } }
  const result = await applyPortableSql(connection, source, { dialect: "mysql" })
  assert.equal(result.applied, 3)
  assert.equal(calls.length, 3)
  assert.ok(calls.some((sql) => /JOIN terms term[\s\S]*term\.id=assignment\.term_id/.test(sql)))
  const labelSession = calls.find((sql) => /resolved_session/.test(sql))
  assert.ok(labelSession)
  assert.match(labelSession, /HAVING COUNT\(DISTINCT academic_year\.id\)=1/)
  assert.match(labelSession, /COUNT\(DISTINCT term\.id\)=1/)
  const activeSession = calls.find((sql) => /active_session/.test(sql))
  assert.ok(activeSession)
  assert.match(activeSession, /HAVING COUNT\(DISTINCT id\)=1/)
  assert.match(activeSession, /HAVING COUNT\(DISTINCT term\.id\)=1/)
  assert.match(activeSession, /assignment\.academic_year_id IS NULL/)
  assert.match(activeSession, /assignment\.term_id IS NULL/)
  assert.match(activeSession, /TRIM\(COALESCE\(assignment\.academic_year,''\)\)=''/)
  assert.match(activeSession, /TRIM\(COALESCE\(assignment\.term,''\)\)=''/)
})

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { resolveDrillMasterySessionScope } from "../src/controllers/drillsController.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("Daily Drill mastery evidence resolves an exact active enrollment session", async () => {
  let capturedSql = ""
  let capturedParams = []
  const db = {
    async query(sql, params) {
      capturedSql = sql
      capturedParams = params
      return [[{ academic_year_id: 6, term_id: 9, class_id: 8 }]]
    },
  }
  const scope = await resolveDrillMasterySessionScope(db, 3, 44, {
    setupRequired: false,
    academicYearId: 6,
    termId: 9,
  })
  assert.deepEqual(scope, { academicYearId: 6, termId: 9, classId: 8 })
  assert.match(capturedSql, /enrollment\.school_id=\? AND enrollment\.student_id=\?/)
  assert.match(capturedSql, /enrollment\.academic_year_id=\? AND enrollment\.term_id=\?/)
  assert.match(capturedSql, /enrollment\.enrollment_status='active'/)
  assert.match(capturedSql, /student\.status='active'/)
  assert.match(capturedSql, /term\.status IN \('open','marking'\)/)
  assert.deepEqual(capturedParams, [3, 44, 6, 9])
})

test("Daily Drill mastery evidence rejects missing session setup or enrollment", async () => {
  await assert.rejects(
    resolveDrillMasterySessionScope({ query: async () => { throw new Error("must not query") } }, 3, 44, {
      setupRequired: true,
      academicYearId: 6,
      termId: null,
      message: "No open term.",
    }),
    (error) => error?.status === 409 && /No open term/.test(error.message),
  )
  await assert.rejects(
    resolveDrillMasterySessionScope({ query: async () => [[]] }, 3, 44, {
      setupRequired: false,
      academicYearId: 6,
      termId: 9,
    }),
    (error) => error?.status === 409 && /active enrollment/.test(error.message),
  )
})

test("Daily Drill answer persistence carries exact session and tenant scope into canonical evidence", () => {
  const source = fs.readFileSync(path.join(root, "src/controllers/drillsController.js"), "utf8")
  assert.match(source, /JOIN question_bank q ON q\.id = dsq\.question_id AND q\.school_id = ds\.school_id AND q\.subject_id = ds\.subject_id/)
  assert.match(source, /WHERE id = \? AND drill_session_id = \?/)
  assert.match(source, /public_ref,school_id,academic_year_id,term_id,student_id,class_id,subject_id/)
  assert.match(source, /academic_year_id=VALUES\(academic_year_id\),term_id=VALUES\(term_id\),class_id=VALUES\(class_id\)/)
  assert.match(source, /const academicScope=\{academic_year_id:masterySession\.academicYearId,term_id:masterySession\.termId\}/)
  assert.ok((source.match(/recalculateStudentMastery\([^\n]+\{\.\.\.academicScope/g) || []).length >= 3)
})

import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../src/controllers/academicIntelligenceController.js", import.meta.url), "utf8")

test("teacher class intelligence reads require the current exact assignment session", () => {
  const start = source.indexOf("export async function academicClassDetail")
  const end = source.indexOf("export async function academicSubjects", start)
  const detail = source.slice(start, end)
  assert.match(detail, /await requireActiveAcademicSession\(schoolId\)/)
  assert.match(detail, /tcsa\.academic_year_id=\? AND tcsa\.term_id=\?/)
  assert.match(detail, /ams\.academic_year_id=\? AND ams\.term_id=\?/)
  assert.match(detail, /tcsa\.academic_year_id=ams\.academic_year_id AND tcsa\.term_id=ams\.term_id/)
  assert.match(detail, /amr\.academic_year_id=\? AND amr\.term_id=\?/)
  assert.match(detail, /se\.academic_year_id=amr\.academic_year_id AND se\.term_id=amr\.term_id/)
  assert.match(detail, /a\.academic_year_id=\? AND a\.term_id=\?/)
  assert.doesNotMatch(detail, /academic_year_id IS NULL|term_id IS NULL/)
})

test("teacher topic intelligence and delivery reads require the current exact assignment session", () => {
  const start = source.indexOf("export async function academicTopicDetail")
  const end = source.indexOf("export async function academicEvidence", start)
  const detail = source.slice(start, end)
  assert.match(detail, /await requireActiveAcademicSession\(schoolId\)/)
  assert.match(detail, /tcsa\.academic_year_id=\? AND tcsa\.term_id=\?/)
  assert.match(detail, /cdr\.academic_year_id=\? AND cdr\.term_id=\?/)
  assert.match(detail, /tcsa\.academic_year_id=cdr\.academic_year_id AND tcsa\.term_id=cdr\.term_id/)
  assert.doesNotMatch(detail, /academic_year_id IS NULL|term_id IS NULL/)
})

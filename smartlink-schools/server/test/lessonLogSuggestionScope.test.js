import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { getLessonLogSuggestions } from "../src/services/lessons/lessonLogSuggestionService.js"

test("lesson suggestions reject a teacher-supplied class or subject outside the exact assignment", async () => {
  let calls = 0
  const db = {
    async query(sql) {
      calls += 1
      if (/FROM teacher_class_subject_assignments a/.test(String(sql))) {
        return [[{
          class_id: 20,
          class_name: "Year 6",
          grade_level: "Year 6",
          subject_id: 10,
          subject_name: "Mathematics",
          teacher_id: 60,
          teacher_name: "Teacher",
        }]]
      }
      throw new Error(`Unexpected query after scope rejection: ${sql}`)
    },
  }
  await assert.rejects(
    getLessonLogSuggestions(db, 1, { id: 60, role: "teacher" }, {
      setupRequired: false,
      academicYearId: 50,
      termId: 40,
    }, { class_id: 20, subject_id: 11 }),
    (error) => error?.status === 403 && /currently assigned class and subject/i.test(error.message),
  )
  assert.equal(calls, 1)
})

test("lesson suggestions use exact assignment, lesson-log, and assessment sessions", async () => {
  const source = await readFile(new URL("../src/services/lessons/lessonLogSuggestionService.js", import.meta.url), "utf8")
  assert.match(source, /academic_year_id = \? AND \$\{alias\}\.term_id = \?/)
  assert.match(source, /AND 1=0/)
  assert.doesNotMatch(source, /academic_year_id IS NULL|term_id IS NULL/)
  assert.doesNotMatch(source, /classTeacherRows|c\.teacher_user_id = \?/)
  assert.match(source, /l\.academic_year_id=\? AND l\.term_id=\?/)
  assert.match(source, /academic_year_id=\? AND term_id=\?\s+AND status NOT IN/)
})

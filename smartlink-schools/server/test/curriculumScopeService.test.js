import test from "node:test"
import assert from "node:assert/strict"
import { validateSyllabusTopicScope } from "../src/services/curriculumScopeService.js"

function topicDb(rows) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params })
      const requested = new Set(params.slice(2).map(Number))
      return [rows.filter((row) => requested.has(Number(row.id)))]
    },
  }
}

test("syllabus topic scope resolves a valid parent and child inside one tenant subject", async () => {
  const db = topicDb([
    { id: 10, school_id: 7, subject_id: 4, curriculum_id: 2, grade_id: 3, parent_topic_id: null, topic_name: "Maps", is_active: 1 },
    { id: 11, school_id: 7, subject_id: 4, curriculum_id: 2, grade_id: 3, parent_topic_id: 10, topic_name: "Contours", is_active: 1 },
  ])
  const result = await validateSyllabusTopicScope(db, { schoolId: 7, subjectId: 4, topicId: 10, subtopicId: 11, requireTopic: true })
  assert.equal(result.topicId, 10)
  assert.equal(result.subtopicId, 11)
  assert.deepEqual(db.calls[0].params, [7, 4, 10, 11])
})

test("syllabus topic scope rejects an id hidden by the school and subject predicate", async () => {
  const db = topicDb([])
  await assert.rejects(
    validateSyllabusTopicScope(db, { schoolId: 7, subjectId: 4, topicId: 999, requireTopic: true }),
    (error) => error?.status === 400 && /does not belong to this school and subject/i.test(error.message),
  )
})

test("syllabus topic scope rejects an unrelated child topic", async () => {
  const db = topicDb([
    { id: 10, school_id: 7, subject_id: 4, parent_topic_id: null, topic_name: "Maps", is_active: 1 },
    { id: 12, school_id: 7, subject_id: 4, parent_topic_id: 99, topic_name: "Weather", is_active: 1 },
  ])
  await assert.rejects(
    validateSyllabusTopicScope(db, { schoolId: 7, subjectId: 4, topicId: 10, subtopicId: 12 }),
    (error) => error?.status === 400 && /does not belong to the selected main topic/i.test(error.message),
  )
})

test("syllabus topic scope rejects a child from another curriculum or year", async () => {
  const db = topicDb([
    { id: 10, school_id: 7, subject_id: 4, curriculum_id: 2, grade_id: 3, parent_topic_id: null, topic_name: "Maps", is_active: 1 },
    { id: 13, school_id: 7, subject_id: 4, curriculum_id: 2, grade_id: 5, parent_topic_id: 10, topic_name: "Advanced contours", is_active: 1 },
  ])
  await assert.rejects(
    validateSyllabusTopicScope(db, { schoolId: 7, subjectId: 4, topicId: 10, subtopicId: 13 }),
    (error) => error?.status === 400 && /curriculum and year level/i.test(error.message),
  )
})

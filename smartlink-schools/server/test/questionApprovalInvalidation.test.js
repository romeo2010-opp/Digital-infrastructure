import test from "node:test"
import assert from "node:assert/strict"
import { pool } from "../src/config/db.js"
import { updateQuestion } from "../src/controllers/questionsController.js"

test("material edits transactionally invalidate question and explanation approvals for leadership", { concurrency: false }, async () => {
  const calls = []
  let began = false
  let committed = false
  let rolledBack = false
  let released = false
  const connection = {
    async beginTransaction() { began = true },
    async commit() { committed = true },
    async rollback() { rolledBack = true },
    release() { released = true },
    async query(source, params = []) {
      const sql = String(source)
      calls.push({ sql, params })
      if (sql.includes("FROM question_bank") && sql.includes("FOR UPDATE")) {
        return [[{
          id: 41,
          subject_id: 8,
          topic_id: 11,
          subtopic_id: null,
          created_by: 3,
          approval_status: "approved",
        }]]
      }
      if (sql.includes("FROM syllabus_topics")) {
        return [[{
          id: 11,
          school_id: 1,
          subject_id: 8,
          curriculum_id: 2,
          grade_id: 4,
          parent_topic_id: null,
          topic_name: "Map work",
          is_active: 1,
        }]]
      }
      if (sql.includes("UPDATE question_bank")) return [{ affectedRows: 1 }]
      if (sql.includes("UPDATE question_explanations")) return [{ affectedRows: 1 }]
      throw new Error(`Unhandled query: ${sql}`)
    },
  }
  const originalGetConnection = pool.getConnection
  pool.getConnection = async () => connection
  let response = null
  try {
    await updateQuestion(
      {
        params: { id: "41" },
        body: { correct_answer: "Updated answer" },
        query: {},
        headers: {},
        user: { id: 9, schoolId: 1, role: "director" },
      },
      { json(payload) { response = payload } },
    )
  } finally {
    pool.getConnection = originalGetConnection
  }

  assert.equal(began, true)
  assert.equal(committed, true)
  assert.equal(rolledBack, false)
  assert.equal(released, true)
  assert.deepEqual(response, { ok: true, approval_status: "pending_review" })

  const questionUpdate = calls.find((call) => call.sql.includes("UPDATE question_bank"))
  assert.ok(questionUpdate)
  assert.match(questionUpdate.sql, /approval_status = CASE WHEN \? = 1 THEN 'pending_review'/)
  assert.deepEqual(questionUpdate.params.slice(-5), [1, 1, 1, 1, 41])

  const explanationUpdate = calls.find((call) => call.sql.includes("UPDATE question_explanations"))
  assert.ok(explanationUpdate)
  assert.match(explanationUpdate.sql, /approval_status='pending_review',approved_by=NULL/)
  assert.deepEqual(explanationUpdate.params, [41])
})

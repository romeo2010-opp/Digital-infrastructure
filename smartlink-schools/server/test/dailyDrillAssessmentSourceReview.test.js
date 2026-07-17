import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { assessmentMarkingKey, mapAssessmentQuestionTables } from "../src/controllers/questionsController.js"

const here = path.dirname(fileURLToPath(import.meta.url))

test("assessment sourcing creates an approval-safe explanation from an answer key", () => {
  const key = assessmentMarkingKey({ correct_answer: "Lake Malawi", marking_scheme: "", explanation: "" })
  assert.deepEqual(key, {
    correctAnswer: "Lake Malawi",
    acceptedAnswers: ["Lake Malawi"],
    explanation: "Correct answer: Lake Malawi",
  })
})

test("assessment sourcing keeps structured tables with their printed question reference", () => {
  const tablesByQuestion = mapAssessmentQuestionTables(
    [{ id: 44, assessment_id: 9, display_number: "4. (a)", question_number: 4 }],
    [{
      id: 88,
      assessment_id: 9,
      block_type: "question",
      sort_order: 10,
      content_json: {
        question_number: "4(a)",
        content_parts: [{
          type: "table",
          local_id: "rainfall",
          caption: "Monthly rainfall",
          header_row: true,
          rows: 2,
          columns: 2,
          cells: [["Month", "mm"], ["January", "82"]],
        }],
      },
      metadata_json: {},
    }],
  )

  const [table] = tablesByQuestion.get(44)
  assert.equal(table.asset_type, "structured_table")
  assert.equal(table.type, "table")
  assert.equal(table.source_display_number, "4. (a)")
  assert.deepEqual(table.cells, [["Month", "mm"], ["January", "82"]])
})

test("question-bank sourcing opens a review modal with approve and reject actions", async () => {
  const source = await fs.readFile(path.resolve(here, "../../client/src/app/pages/QuestionBankPage.tsx"), "utf8")
  assert.match(source, /Review Sourced Assessment Questions/)
  assert.match(source, /api\.approveQuestion\(token, questionId\)/)
  assert.match(source, /api\.rejectQuestion\(token, questionId\)/)
  assert.match(source, /Approve Selected/)
})

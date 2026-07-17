import test from "node:test"
import assert from "node:assert/strict"
import { buildExportBlocks, validateAssessmentExportContent } from "../src/services/assessmentExportService.js"

const assessment = { name: "Agriculture Paper 1", total_marks: 10 }

test("assessment export rejects blank papers and incomplete questions", () => {
  assert.throws(
    () => validateAssessmentExportContent({ assessment, questions: [] }),
    (error) => error?.status === 422 && error?.code === "ASSESSMENT_HAS_NO_QUESTIONS",
  )
  assert.throws(
    () => validateAssessmentExportContent({ assessment, questions: [{ display_number: "1", question_text: "", marks: 10 }] }),
    (error) => error?.code === "ASSESSMENT_QUESTION_CONTENT_REQUIRED",
  )
  assert.throws(
    () => validateAssessmentExportContent({ assessment, questions: [{ display_number: "1", question_text: "Name one crop.", marks: 5 }] }),
    (error) => error?.code === "ASSESSMENT_MARKS_MISMATCH",
  )
})

test("assessment export trims orphan page breaks and marks the final question", () => {
  const questions = [
    { id: 1, display_number: "1", question_text: "Name one crop.", marks: 4, sort_order: 20 },
    { id: 2, display_number: "2", question_text: "Explain crop rotation.", marks: 6, sort_order: 40 },
  ]
  assert.deepEqual(validateAssessmentExportContent({ assessment, questions }), { question_count: 2, total_marks: 10 })
  const blocks = buildExportBlocks(assessment, questions, [
    { id: 10, block_type: "page_break", sort_order: 1, content_json: {}, style_json: {}, metadata_json: {} },
    { id: 11, block_type: "page_break", sort_order: 2, content_json: {}, style_json: {}, metadata_json: {} },
    { id: 12, block_type: "section", sort_order: 10, content_json: { title: "Section A" }, style_json: {}, metadata_json: {} },
    { id: 13, block_type: "page_break", sort_order: 50, content_json: {}, style_json: {}, metadata_json: {} },
  ])
  assert.notEqual(blocks[0]?.block_type, "page_break")
  assert.notEqual(blocks.at(-1)?.block_type, "page_break")
  assert.equal(blocks.filter((block) => block.block_type === "page_break").length, 0)
  const exportedQuestions = blocks.filter((block) => block.block_type === "question")
  assert.equal(exportedQuestions[0].metadata_json.is_last_question, false)
  assert.equal(exportedQuestions[1].metadata_json.is_last_question, true)
})

test("assessment export preserves a structured table inside a question", () => {
  const tableOnlyAssessment = { name: "Geography Paper", total_marks: 4 }
  const questions = [{
    id: 8,
    display_number: "4(a)",
    question_text: "Use the rainfall table to answer the question.",
    marks: 4,
    sort_order: 10,
  }]
  const blocks = [{
    id: 21,
    block_type: "question",
    sort_order: 10,
    content_json: {
      question_number: "4(a)",
      question_text: "Use the rainfall table to answer the question.",
      marks: 4,
      content_parts: [
        { type: "text", text: "Use the rainfall table to answer the question." },
        {
          type: "table",
          local_id: "rainfall-table",
          caption: "Rainfall by month",
          header_row: true,
          rows: 3,
          columns: 2,
          cells: [["Month", "mm"], ["Jan", "82"], ["Feb", "75"]],
        },
      ],
    },
    style_json: {},
    metadata_json: {},
  }]

  assert.deepEqual(validateAssessmentExportContent({ assessment: tableOnlyAssessment, questions }), { question_count: 1, total_marks: 4 })
  const [questionBlock] = buildExportBlocks(tableOnlyAssessment, questions, blocks)
  const table = questionBlock.content_json.content_parts.find((part) => part.type === "table")
  assert.ok(table)
  assert.equal(table.rows, 3)
  assert.equal(table.columns, 2)
  assert.deepEqual(table.cells[2], ["Feb", "75"])
})

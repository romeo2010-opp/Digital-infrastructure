import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { normalizeStructuredTables, structuredTableParts } from "../src/services/assessmentImportService.js"
import { structuredTablesFromAssets } from "../src/controllers/drillsController.js"

const here = path.dirname(fileURLToPath(import.meta.url))

test("assessment extraction normalizes table headings into a rectangular cell matrix", () => {
  const [table] = normalizeStructuredTables([{
    tableId: "rainfall",
    caption: "Monthly rainfall",
    pageNumber: 3,
    headerRow: true,
    columnHeaders: ["Month", "Rainfall (mm)", "Notes"],
    rows: [
      ["January", "82"],
      ["February", "", "Estimated"],
    ],
    confidence: 0.94,
  }])

  assert.equal(table.table_id, "rainfall")
  assert.equal(table.rows, 3)
  assert.equal(table.columns, 3)
  assert.equal(table.header_row, true)
  assert.deepEqual(table.cells, [
    ["Month", "Rainfall (mm)", "Notes"],
    ["January", "82", ""],
    ["February", "", "Estimated"],
  ])
})

test("assessment table parts retain explicit rows and columns for the builder", () => {
  const [part] = structuredTableParts([{
    table_id: "budget",
    caption: "Farm budget",
    header_row: true,
    cells: [["Item", "Cost"], ["Seed", 5000]],
  }])

  assert.equal(part.type, "table")
  assert.equal(part.local_id, "budget")
  assert.equal(part.rows, 2)
  assert.equal(part.columns, 2)
  assert.deepEqual(part.cells[1], ["Seed", "5000"])
})

test("invalid table values are ignored without disturbing other extracted questions", () => {
  assert.deepEqual(normalizeStructuredTables(null), [])
  assert.deepEqual(normalizeStructuredTables([null, "not-a-table", { rows: [] }]), [])
})

test("Daily Drill delivery exposes table rows while ignoring unrelated stored assets", () => {
  const tables = structuredTablesFromAssets(JSON.stringify([
    { asset_type: "diagram", url: "/uploads/map.png" },
    {
      asset_type: "structured_table",
      type: "table",
      table_id: "population",
      caption: "Population by district",
      header_row: true,
      cells: [["District", "Population"], ["North", 12000]],
    },
  ]))

  assert.equal(tables.length, 1)
  assert.equal(tables[0].table_id, "population")
  assert.equal(tables[0].header_row, true)
  assert.deepEqual(tables[0].cells, [["District", "Population"], ["North", "12000"]])
})

test("assessment review, builder, and learner drill UI expose structured tables", async () => {
  const [review, builder, learner] = await Promise.all([
    fs.readFile(path.resolve(here, "../../client/src/app/pages/AssessmentImportPage.tsx"), "utf8"),
    fs.readFile(path.resolve(here, "../../client/src/app/pages/ExamPaperDocumentPage.tsx"), "utf8"),
    fs.readFile(path.resolve(here, "../../client/src/app/pages/StudentPortalPage.tsx"), "utf8"),
  ])
  assert.match(review, /StructuredTablesEditor/)
  assert.match(review, /tables: normalizeImportTables/)
  assert.match(builder, /Question Table/)
  assert.match(builder, /part\.type === 'table'/)
  assert.match(learner, /drillQuestionTables/)
})

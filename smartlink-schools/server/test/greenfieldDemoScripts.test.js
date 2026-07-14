import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = new URL("../", import.meta.url)
const read = (name) => readFileSync(new URL(name, root), "utf8")

test("Greenfield demo tools are protected and wired", () => {
  const seed = read("scripts/seed-greenfield-demo.mjs")
  const recalculate = read("scripts/recalculate-greenfield-demo.mjs")
  const validate = read("scripts/validate-greenfield-demo.mjs")
  const control = read("scripts/greenfield-demo-control.mjs")
  const academicLoop = read("scripts/run-academic-operations-demo.mjs")
  const packageJson = JSON.parse(read("package.json"))
  assert.match(seed, /ENABLE_DEMO_DATA_TOOLS/)
  assert.match(recalculate, /ingestApprovedResultBatch/)
  assert.match(validate, /Syllabus prerequisite graph is acyclic/)
  assert.match(control, /publish.*generate.*archive/s)
  assert.match(academicLoop, /createTargetedAssessmentDraft/)
  assert.match(academicLoop, /publishAcademicMarkSheet/)
  assert.match(academicLoop, /Expected exactly 10 affected/)
  assert.equal(typeof packageJson.scripts["demo:greenfield"], "string")
  assert.equal(typeof packageJson.scripts["demo:validate"], "string")
  assert.equal(typeof packageJson.scripts["demo:control"], "string")
  assert.equal(typeof packageJson.scripts["demo:academic-loop"], "string")
})

test("Greenfield demo controls refuse production without the explicit flag", () => {
  const script = fileURLToPath(new URL("../scripts/greenfield-demo-control.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [script, "validate"], { encoding: "utf8", env: { ...process.env, NODE_ENV: "production", ENABLE_DEMO_DATA_TOOLS: "false" } })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stderr}${result.stdout}`, /disabled in production/i)
})

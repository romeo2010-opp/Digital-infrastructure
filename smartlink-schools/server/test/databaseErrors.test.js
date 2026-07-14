import test from "node:test"
import assert from "node:assert/strict"
import { normalizeDatabaseError } from "../src/utils/databaseErrors.js"
import { HttpError } from "../src/utils/http.js"

test("foreign-key delete errors become descriptive conflicts", () => {
  const error = Object.assign(new Error("Cannot delete parent row"), {
    code: "ER_ROW_IS_REFERENCED_2",
    sqlMessage: "Cannot delete or update a parent row: a foreign key constraint fails (`smartlink_schools`.`result_batches`, CONSTRAINT `fk_result_batches_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`id`))",
  })
  const mapped = normalizeDatabaseError(error)
  assert.equal(mapped.status, 409)
  assert.equal(mapped.code, "RESOURCE_IN_USE")
  assert.match(mapped.message, /result-submission batch/i)
  assert.equal(mapped.details.constraint, "fk_result_batches_assessment")
})

test("deadlocks return a retryable service response", () => {
  const mapped = normalizeDatabaseError(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }))
  assert.equal(mapped.status, 503)
  assert.equal(mapped.code, "DATABASE_BUSY")
  assert.equal(mapped.details.retryable, true)
})

test("wrapped database constraints are still translated", () => {
  const cause = Object.assign(new Error("Cannot delete parent"), { code: "ER_ROW_IS_REFERENCED_2", sqlMessage: "CONSTRAINT `fk_task_evidence_task` FOREIGN KEY" })
  const mapped = normalizeDatabaseError(new HttpError(500, "Save failed", { cause }))
  assert.equal(mapped.status, 409)
  assert.equal(mapped.code, "RESOURCE_IN_USE")
  assert.match(mapped.message, /submitted evidence/i)
})

test("schema mismatches return a descriptive logged service error", () => {
  const mapped = normalizeDatabaseError(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }))
  assert.equal(mapped.status, 500)
  assert.equal(mapped.code, "FEATURE_SCHEMA_MISMATCH")
  assert.equal(mapped.expose, true)
  assert.match(mapped.message, /out of sync with the current database structure/i)
})

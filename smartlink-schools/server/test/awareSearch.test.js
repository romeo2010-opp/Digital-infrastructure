import test from "node:test"
import assert from "node:assert/strict"
import { interpretAwareSearch, normalizeSearchText, rankSearchResults } from "../src/services/awareSearchService.js"

test("aware search composes intent without relying on one exact phrase", () => {
  for (const query of [
    "learners owing tuition",
    "please find children with unpaid balances",
    "show me fee debtors",
    "pupils that have not paid",
  ]) {
    const intent = interpretAwareSearch(query)
    assert.equal(intent.primaryEntity, "fees", query)
    assert.equal(intent.primaryState, "outstanding", query)
  }
})

test("aware search tolerates domain typos and retains unknown names as search terms", () => {
  const intent = interpretAwareSearch("studnts called Chimwemwe with pendng homewrok")
  assert.ok(intent.entities.includes("students"))
  assert.ok(intent.entities.includes("homework"))
  assert.ok(intent.states.includes("pending"))
  assert.deepEqual(intent.searchTerms, ["chimwemwe"])
  assert.ok(intent.corrections.length >= 2)
})

test("aware search understands freely ordered academic and operational concepts", () => {
  assert.equal(interpretAwareSearch("published mathematics exam papers").primaryEntity, "assessments")
  assert.equal(interpretAwareSearch("who was missing from class today").primaryEntity, "attendance")
  assert.equal(interpretAwareSearch("open intervention cases for fractions").primaryEntity, "support")
  assert.equal(interpretAwareSearch("salary runs waiting for approval").primaryEntity, "payroll")
  assert.equal(interpretAwareSearch("staff currently on leave").primaryEntity, "leave")
  assert.equal(interpretAwareSearch("student results").primaryEntity, "results")
  assert.deepEqual(interpretAwareSearch("pending discount approvals").searchTerms, [])
  assert.deepEqual(interpretAwareSearch("school messages").searchTerms, [])
})

test("normalization handles punctuation, accents and casing", () => {
  assert.equal(normalizeSearchText("  Find: Chisomo’s RÉSULTS! "), "find chisomos results")
})

test("ranking prefers the intended entity and fuzzy content match", () => {
  const intent = interpretAwareSearch("chimwemwe learner")
  const ranked = rankSearchResults([
    { id: "1", resultType: "TEACHER", title: "Chimwemwe Banda" },
    { id: "2", resultType: "STUDENT", title: "Chimweme Phiri", className: "Year 5" },
    { id: "3", resultType: "STUDENT", title: "Martha Kalua", className: "Year 5" },
  ], intent)
  assert.deepEqual(ranked.map((result) => result.id), ["2"])
})

test("ranking removes same-category records that do not match the user's content", () => {
  const intent = interpretAwareSearch("mathematics subjects")
  const ranked = rankSearchResults([
    { id: "nav", resultType: "NAVIGATION", searchEntity: "subjects", title: "Subjects" },
    { id: "math", resultType: "SUBJECT", title: "Mathematics" },
    { id: "history", resultType: "SUBJECT", title: "History" },
  ], intent)
  assert.deepEqual(ranked.map((result) => result.id), ["math", "nav"])
})

test("workflow intent suppresses incidental entity and state-only navigation matches", () => {
  const leave = rankSearchResults([
    { id: "leave", resultType: "NAVIGATION", searchEntity: "leave", title: "Staff Leave" },
    { id: "teacher", resultType: "TEACHER", title: "Andrew Gondwe", status: "active" },
  ], interpretAwareSearch("staff currently on leave"))
  assert.deepEqual(leave.map((result) => result.id), ["leave"])

  const discounts = rankSearchResults([
    { id: "discounts", resultType: "NAVIGATION", searchEntity: "discounts", title: "Discounts and Bursaries" },
    { id: "homework", resultType: "NAVIGATION", searchEntity: "homework", title: "Homework", keywords: "pending" },
  ], interpretAwareSearch("pending discount approvals"))
  assert.deepEqual(discounts.map((result) => result.id), ["discounts"])
})

import test from "node:test"
import assert from "node:assert/strict"
import { validateSupportReassessmentEvidence } from "../src/services/academicSupportService.js"

const record = {
  id: 7,
  learner_id: 30,
  class_id: 20,
  subject_id: 10,
  primary_topic_id: 70,
  academic_year_id: 50,
  current_term_id: 40,
}

function evidenceDb({ generated = [{ id: 80, public_ref: "generated-80", status: "approved" }], baseline = [{ id: 90 }], members = [], matchedLearners = 1 } = {}) {
  return {
    async query(source) {
      const sql = String(source).replace(/\s+/g, " ").trim()
      if (/ FROM generated_assessments generated /i.test(` ${sql} `)) return [generated]
      if (/ FROM academic_mark_sheets marksheet /i.test(` ${sql} `)) return [baseline]
      if (/ FROM learner_support_case_members /i.test(` ${sql} `)) return [members]
      if (/ FROM student_enrollments /i.test(` ${sql} `)) return [[]]
      if (/ FROM learner_assessment_entries /i.test(` ${sql} `)) return [[{ matched_learners: matchedLearners }]]
      throw new Error(`Unhandled reassessment validation query: ${sql}`)
    },
  }
}

test("support reassessments require a targeted assessment in the case's exact academic scope", async () => {
  await assert.rejects(
    validateSupportReassessmentEvidence(evidenceDb(), 1, record, {}),
    /approved targeted assessment is required/i,
  )
  await assert.rejects(
    validateSupportReassessmentEvidence(evidenceDb({ generated: [] }), 1, record, { generated_assessment_id: 80 }),
    /match this support case's class, subject, topic and academic session/i,
  )
})

test("baseline evidence must be published in scope and cover every support-case learner", async () => {
  await assert.rejects(
    validateSupportReassessmentEvidence(evidenceDb({ baseline: [] }), 1, record, { generated_assessment_id: 80, baseline_mark_sheet_id: 90 }),
    /published evidence for this case's class, subject, topic and academic session/i,
  )
  await assert.rejects(
    validateSupportReassessmentEvidence(evidenceDb({ members: [{ learner_id: 31 }], matchedLearners: 1 }), 1, record, { generated_assessment_id: 80, baseline_mark_sheet_id: 90 }),
    /every learner in this support case/i,
  )
  const result = await validateSupportReassessmentEvidence(evidenceDb({ members: [{ learner_id: 31 }], matchedLearners: 2 }), 1, record, {
    generated_assessment_id: 80,
    baseline_mark_sheet_id: 90,
  })
  assert.equal(result.generated.id, 80)
  assert.equal(result.baselineMarkSheetId, 90)
})

test("support reassessment queries encode the required tenant, session, topic and learner contracts", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/services/academicSupportService.js", import.meta.url), "utf8"))
  const start = source.indexOf("export async function validateSupportReassessmentEvidence")
  const end = source.indexOf("export async function scheduleSupportReassessment", start)
  const validator = source.slice(start, end)
  for (const contract of [
    "generated.class_id=? AND generated.subject_id=?",
    "generated.academic_year_id=? AND generated.term_id=?",
    "generated.topic_id=?",
    "marksheet.status IN ('published','locked')",
    "marksheet.academic_year_id=? AND marksheet.term_id=?",
    "question_topic_mappings",
    "learner_support_case_members",
    "learner_assessment_entries",
    "is_official=1",
  ]) assert.ok(validator.includes(contract), `missing reassessment contract: ${contract}`)
})

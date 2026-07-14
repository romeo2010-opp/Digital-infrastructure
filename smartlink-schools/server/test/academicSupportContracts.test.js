import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(root, "..")
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8")

test("every required academic-support API route is mounted", () => {
  const routes = read(root, "src/routes/index.js")
  const paths = [
    "/academic-support/cases", "/academic-support/learners/:learnerId", "/academic-support/escalation-policy",
    "/academic-support/cases/:caseId/timeline", "/academic-support/cases/:caseId/evidence", "/academic-support/cases/:caseId/interventions",
    "/academic-support/cases/:caseId/assign", "/academic-support/cases/:caseId/create-intervention", "/academic-support/cases/:caseId/record-session",
    "/academic-support/cases/:caseId/schedule-reassessment", "/academic-support/cases/:caseId/review-outcome", "/academic-support/cases/:caseId/escalate",
    "/academic-support/cases/:caseId/resolve", "/academic-support/cases/:caseId/carry-forward", "/academic-support/cases/:caseId/request-academic-review",
    "/academic-support/cases/:caseId/draft-guardian-summary",
  ]
  for (const route of paths) assert.ok(routes.includes(route), `Missing route ${route}`)
})

test("client contracts and routes expose the support centre", () => {
  const api = read(repo, "client/src/app/lib/portalApi.ts")
  const app = read(repo, "client/src/app/App.tsx")
  const page = read(repo, "client/src/app/pages/LearnerSupportPage.tsx")
  for (const method of ["listSupportCases", "getSupportCase", "recordSupportSession", "scheduleSupportReassessment", "reviewSupportOutcome", "carryForwardSupportCase", "draftGuardianSupportSummary"]) assert.ok(api.includes(method), `Missing client API ${method}`)
  assert.ok(app.includes('path="/learner-support"'))
  assert.ok(app.includes('path="/learner-support/:caseId"'))
  assert.match(page, /Case timeline/)
  assert.match(page, /Intervention cycles/)
  assert.match(page, /Resolution safeguards/)
})

test("support migration contains durable tenant-safe structures", () => {
  const migration = read(root, "database/060_learner_support_cases.sql")
  for (const table of ["learner_support_cases", "learner_support_case_evidence", "learner_support_case_events", "intervention_cycles", "intervention_sessions", "intervention_session_attendance", "academic_review_meetings", "guardian_review_records", "escalation_policies", "escalation_decisions", "support_case_notifications", "support_case_term_transfers"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  assert.match(migration, /UNIQUE KEY uq_support_case_identity \(school_id,identity_key\)/)
  assert.match(migration, /UNIQUE KEY uq_support_notification_dedupe \(school_id,deduplication_key\)/)
  assert.match(migration, /session_scope_key/)
})

test("draft result submission no longer ingests official mastery", () => {
  const controller = read(root, "src/controllers/resultsController.js")
  const submitStart = controller.indexOf("export async function submitResults")
  const approveStart = controller.indexOf("export async function approveResultBatch")
  const submitBody = controller.slice(submitStart, approveStart)
  assert.ok(submitStart >= 0 && approveStart > submitStart)
  assert.doesNotMatch(submitBody, /ingestApprovedResultBatch\s*\(/)
  assert.match(submitBody, /awaiting[_ ]approval/i)
})

test("teacher intelligence reads and support cases use assignment scope", () => {
  const engine = read(root, "src/services/academicIntelligenceEngine.js")
  const support = read(root, "src/services/academicSupportService.js")
  const controller = read(root, "src/controllers/academicIntelligenceController.js")
  assert.match(engine, /teacher_class_subject_assignments tcsa/)
  assert.match(support, /teacherScopeSql/)
  assert.match(support, /tcsa\.teacher_id=\?/)
  assert.doesNotMatch(engine, /tcsa\.subject_id IS NULL OR tcsa\.subject_id/)
  assert.doesNotMatch(support, /tcsa\.subject_id IS NULL OR tcsa\.subject_id/)
  assert.match(controller, /getCanonicalAcademicEvidence\([^\n]+req\.user/)
  assert.match(controller, /getStudentAcademicIntelligence\([^\n]+req\.user/)
})

test("targeted assessment publication creates a marksheet and has a legacy backfill", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  const migration = read(root, "database/061_generated_assessment_marksheets.sql")
  const start = operations.indexOf("export async function publishTargetedAssessment")
  const end = operations.indexOf("export async function listTargetedAssessments")
  assert.match(operations.slice(start, end), /ensureMarkSheet/)
  assert.match(migration, /INSERT INTO academic_mark_sheets/)
  assert.match(migration, /ga\.status='published'/)
})

test("question evidence derives the overall results and published evidence has an audited correction path", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  const results = read(root, "src/controllers/resultsController.js")
  const routes = read(root, "src/routes/index.js")
  assert.match(operations, /syncDerivedOverallResults/)
  assert.match(operations, /result_entries/)
  assert.match(operations, /ACADEMIC_MARK_SHEET_REOPENED/)
  assert.match(operations, /publication_state='invalidated',evidence_status='invalidated'/)
  assert.match(results, /learner_assessment_entries lae/)
  assert.match(routes, /academic-mark-sheet\/reopen/)
})

test("marksheet UI is tenant branded and prevents duplicate overall entry", () => {
  const page = read(repo, "client/src/app/pages/ResultsEntryPage.tsx")
  const panel = read(repo, "client/src/app/components/AcademicMarkSheetPanel.tsx")
  assert.doesNotMatch(page, /Greenhill|GREENHILL|REIGN INTERNATIONAL ACADEMY/)
  assert.match(page, /user\?\.schoolName/)
  assert.doesNotMatch(page, /title="Overall marksheet"/)
  assert.match(page, /school-marksheet-print-area[^\n]+hidden/)
  assert.match(panel, /deriveQuestionEntry/)
  assert.match(panel, /overallReady && !wasOverallReady\.current\) setMode\('overall'\)/)
  assert.match(panel, /Reopen for correction/)
  assert.match(panel, /mode !== sourceMode/)
})

test("support evidence history includes detection events and their assessment names", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const page = read(repo, "client/src/app/pages/LearnerSupportPage.tsx")
  const seed = read(root, "scripts/seed-greenfield-support-scenarios.mjs")
  assert.match(support, /multi_subject_review_detected/)
  assert.match(support, /case_assessments/)
  assert.match(support, /'case_event' evidence_kind/)
  assert.match(page, /item\.event_type \|\| item\.evidence_role/)
  assert.match(page, /Assessments: \{item\.assessment_name\}/)
  assert.match(seed, /assessment_id,evidence_role/)
  assert.match(seed, /crossSubjectEvidence/)
})

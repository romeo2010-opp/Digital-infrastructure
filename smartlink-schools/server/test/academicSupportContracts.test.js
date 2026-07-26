import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { reassessmentOutcomeCountDelta } from "../src/services/academicOperationsService.js"

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
  assert.match(support, /learnerSupportScopeSql/)
  assert.match(support, /support_subject_assignment\.teacher_id=\?/)
  assert.doesNotMatch(engine, /tcsa\.subject_id IS NULL OR tcsa\.subject_id/)
  assert.doesNotMatch(support, /support_subject_assignment\.subject_id IS NULL OR support_subject_assignment\.subject_id/)
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

test("published reassessments update the canonical support cycle and case", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  const support = read(root, "src/services/academicSupportService.js")
  const start = operations.indexOf("async function evaluateLinkedReassessment")
  const end = operations.indexOf("export async function publishAcademicMarkSheet")
  const evaluator = operations.slice(start, end)
  assert.match(evaluator, /derivePersistedSupportCycleOutcome/)
  assert.match(evaluator, /UPDATE intervention_cycles SET status=\?,outcome=\?/)
  assert.match(evaluator, /UPDATE learner_support_cases SET status=\?/)
  assert.match(evaluator, /reassessment_outcome_evaluated/)
  assert.match(support, /export async function getInterventionDeliveryMetrics/)
  assert.match(support, /export async function derivePersistedSupportCycleOutcome/)
})

test("support outcomes and resolution derive their evidence from persisted official records", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const reviewStart = support.indexOf("export async function reviewSupportOutcome")
  const reviewEnd = support.indexOf("async function simpleCaseTransition", reviewStart)
  const review = support.slice(reviewStart, reviewEnd)
  const resolutionStart = support.indexOf("export const resolveSupportCase")
  const resolutionEnd = support.indexOf("export async function carryForwardSupportCase", resolutionStart)
  const resolution = support.slice(resolutionStart, resolutionEnd)
  assert.match(support, /academic_intervention_reassessments reassessment/)
  assert.match(support, /academic_mark_sheets marksheet/)
  assert.match(support, /learner_topic_results topic_result/)
  assert.match(support, /compareAcademicEvidence\(baseline, candidate/)
  assert.match(review, /derivePersistedSupportCycleOutcome/)
  assert.doesNotMatch(review, /body\.(?:reassessment_published|reassessment_comparable|baseline_score|reassessment_score|improved_components|unchanged_components|strategy_repeated)/)
  assert.match(resolution, /derivePersistedResolutionEvidence/)
  assert.doesNotMatch(resolution, /input\.(?:reassessment_published|comparable_success_count|teacher_review_completed)/)
})

test("manual and automatic partially-effective persistence use the same transition", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const operations = read(root, "src/services/academicOperationsService.js")
  assert.match(support, /deriveSupportCaseOutcomeTransition\(record, diagnostic, policy\)/)
  assert.match(operations, /derivePersistedSupportCycleOutcome\(connection, schoolId, supportCase, cycle, supportPolicy, \{ reassessmentId: link\.id \}\)/)
  assert.doesNotMatch(operations, /deriveSupportCaseOutcomeTransition\(supportCase/)
})

test("automatic support reassessment classification cannot bypass official evidence comparability", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  const support = read(root, "src/services/academicSupportService.js")
  const evaluatorStart = operations.indexOf("async function evaluateLinkedReassessment")
  const supportBranchStart = operations.indexOf("if (link.support_case_id && link.intervention_cycle_id)", evaluatorStart)
  const legacyBranchStart = operations.indexOf("if (!link.baseline_mark_sheet_id)", supportBranchStart)
  const supportBranch = operations.slice(supportBranchStart, legacyBranchStart)
  const helperStart = support.indexOf("export async function derivePersistedSupportCycleOutcome")
  const helperEnd = support.indexOf("async function derivePersistedResolutionEvidence", helperStart)
  const helper = support.slice(helperStart, helperEnd)
  assert.match(supportBranch, /derivePersistedSupportCycleOutcome/)
  assert.match(supportBranch, /reassessmentId: link\.id/)
  assert.match(supportBranch, /evidence\.reassessmentComparable/)
  assert.match(supportBranch, /evidence\.targetedLearnerCoverage/)
  assert.match(supportBranch, /if \(!outcomeWasAlreadyApplied\)/)
  assert.doesNotMatch(supportBranch, /evaluateInterventionEffectiveness/)
  assert.match(helper, /persistedReassessmentContext/)
  assert.match(helper, /getInterventionDeliveryMetrics/)
  assert.match(helper, /evaluateInterventionDelivery/)
  assert.match(helper, /deriveSupportCaseOutcomeTransition/)
})

test("reopening a linked reassessment retracts its derived state without count drift", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  const reopenStart = operations.indexOf("export async function reopenAcademicMarkSheet")
  const reopenEnd = operations.indexOf("const TARGETED_REFERENCE_SPECS", reopenStart)
  const reopen = operations.slice(reopenStart, reopenEnd)
  const rollbackStart = operations.indexOf("async function retractLinkedReassessmentForCorrection")
  const rollbackEnd = operations.indexOf("export async function reopenAcademicMarkSheet", rollbackStart)
  const rollback = operations.slice(rollbackStart, rollbackEnd)
  assert.match(reopen, /retractLinkedReassessmentForCorrection\(connection, schoolId, sheet, actor\)/)
  assert.match(reopen, /linked_reassessment_rollback: reassessmentRollback/)
  assert.match(rollback, /reassessment_mark_sheet_id=NULL,outcome='pending'/)
  assert.match(rollback, /evaluated_at=NULL,evaluated_by=NULL/)
  assert.match(rollback, /UPDATE intervention_cycles SET status='awaiting_reassessment',outcome='pending'/)
  assert.match(rollback, /reassessment_outcome_retracted_for_correction/)
  assert.match(rollback, /MAX\(cycle_number\) latest_cycle_number/)
  assert.match(rollback, /Math\.max\(0, Number\(supportCase\.successful_cycle_count/)
  assert.match(operations, /published-reassessment:\$\{link\.id\}:\$\{sheet\.id\}:\$\{sheet\.version_number\}/)
  assert.deepEqual(reassessmentOutcomeCountDelta({ previousCaseState: { successfulCycleCount: 1, unsuccessfulCycleCount: 2 }, appliedTransition: { successfulCycles: 2, unsuccessfulCycles: 2 } }), { successful: 1, unsuccessful: 0 })
  assert.deepEqual(reassessmentOutcomeCountDelta({ outcome: "partially_effective", recommendedEscalation: "continued_support" }), { successful: 0, unsuccessful: 0 })
  assert.deepEqual(reassessmentOutcomeCountDelta({ outcome: "partially_effective", recommendedEscalation: "strategy_review" }), { successful: 0, unsuccessful: 1 })
})

test("generated reassessments cannot be moved across support cases or cycles", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const start = support.indexOf("export async function scheduleSupportReassessment")
  const end = support.indexOf("async function supportCaseLearnerIds", start)
  const schedule = support.slice(start, end)
  assert.match(schedule, /FROM academic_intervention_reassessments WHERE school_id=\? AND generated_assessment_id=\? LIMIT 1 FOR UPDATE/)
  assert.match(schedule, /SUPPORT_REASSESSMENT_ALREADY_LINKED/)
  assert.match(schedule, /existingLink\.support_case_id/)
  assert.match(schedule, /existingLink\.intervention_cycle_id/)
  assert.match(schedule, /existingLink\.baseline_mark_sheet_id/)
  assert.doesNotMatch(schedule, /ON DUPLICATE KEY UPDATE support_case_id/)
})

test("publishing a support-case assessment before scheduling cannot create a conflicting legacy link", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const operations = read(root, "src/services/academicOperationsService.js")
  const publishStart = operations.indexOf("export async function publishTargetedAssessment")
  const publishEnd = operations.indexOf("export async function listTargetedAssessments", publishStart)
  const publish = operations.slice(publishStart, publishEnd)
  const scheduleStart = support.indexOf("export async function scheduleSupportReassessment")
  const scheduleEnd = support.indexOf("async function supportCaseLearnerIds", scheduleStart)
  const schedule = support.slice(scheduleStart, scheduleEnd)
  assert.match(publish, /generatedSupportCaseRef/)
  assert.match(publish, /intervention_reassessment" && !generatedSupportCaseRef/)
  assert.match(schedule, /generatedSupportCaseRef === String\(record\.public_ref\)/)
  assert.match(schedule, /support_case_id IS NULL AND intervention_cycle_id IS NULL/)
  assert.match(schedule, /existingLink\.baseline_mark_sheet_id/)
  assert.match(schedule, /STALE_SUPPORT_REASSESSMENT_LINK/)
})

test("all school leadership roles have global learner-support scope", () => {
  const support = read(root, "src/services/academicSupportService.js")
  assert.match(support, /LEARNER_SUPPORT_LEADERSHIP_ROLES = new Set\(\["super_admin", "school_owner", "owner", "director", "headteacher"\]\)/)
  assert.match(support, /LEARNER_SUPPORT_LEADERSHIP_ROLES\.has\(role\)/)
  assert.match(support, /LEARNER_SUPPORT_LEADERSHIP_ROLES\.has\(String\(actor\.role/)
})

test("teacher learner-support assignment scope requires the case session", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const clauseStart = support.indexOf("function activeAssignmentClause")
  const clauseEnd = support.indexOf("function learnerSupportScopeSql", clauseStart)
  const clause = support.slice(clauseStart, clauseEnd)
  const accessStart = support.indexOf("export async function canAccessLearnerSupportCase")
  const accessEnd = support.indexOf("async function lockedCase", accessStart)
  const access = support.slice(accessStart, accessEnd)
  assert.match(clause, /\$\{caseAlias\}\.academic_year_id IS NOT NULL/)
  assert.match(clause, /\$\{caseAlias\}\.current_term_id IS NOT NULL/)
  assert.match(clause, /academic_year_id=\$\{caseAlias\}\.academic_year_id/)
  assert.match(clause, /term_id=\$\{caseAlias\}\.current_term_id/)
  assert.doesNotMatch(clause, /assignmentAlias\}\.academic_year_id IS NULL/)
  assert.doesNotMatch(clause, /assignmentAlias\}\.term_id IS NULL/)
  assert.doesNotMatch(access, /academic_year_id IS NULL OR \? IS NULL/)
  assert.doesNotMatch(access, /term_id IS NULL OR \? IS NULL/)
  assert.doesNotMatch(access, /\? IS NULL OR academic_year_id/)
  assert.doesNotMatch(access, /\? IS NULL OR term_id/)
})

test("published evidence cannot move a learner-support case into another session", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const start = support.indexOf("export async function syncSupportCasesFromPublishedAssessment")
  const sync = support.slice(start)
  assert.match(sync, /const baseIdentity/)
  assert.match(sync, /:academic-year:\$\{assessment\.academic_year_id \?\? "none"\}:term:\$\{assessment\.term_id \?\? "none"\}/)
  assert.match(sync, /WHERE school_id=\? AND academic_year_id<=>\? AND current_term_id<=>\?/)
  assert.match(sync, /class_id<=>\? AND learner_id<=>\? AND subject_id<=>\? AND primary_topic_id<=>\?/)
  const caseUpdates = [...sync.matchAll(/UPDATE learner_support_cases SET ([^"]+)/g)].map((match) => match[1])
  assert.ok(caseUpdates.length > 0)
  for (const fields of caseUpdates) assert.doesNotMatch(fields, /academic_year_id|current_term_id/)
})

test("marksheet correction revalidates support evidence and reconciles case triggers", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const operations = read(root, "src/services/academicOperationsService.js")
  const syncStart = support.indexOf("export async function syncSupportCasesFromPublishedAssessment")
  const sync = support.slice(syncStart)
  const reopenStart = operations.indexOf("export async function reopenAcademicMarkSheet")
  const reopenEnd = operations.indexOf("const TARGETED_REFERENCE_SPECS", reopenStart)
  const reopen = operations.slice(reopenStart, reopenEnd)
  assert.match(sync, /evidence_precision=VALUES\(evidence_precision\)/)
  assert.match(sync, /marks_awarded=VALUES\(marks_awarded\),marks_available=VALUES\(marks_available\)/)
  assert.match(sync, /evidence_status='valid',observed_at=VALUES\(observed_at\)/)
  assert.match(sync, /reconcileSupportCasesForAssessmentEvidence/)
  assert.match(support, /status: "closed_inconclusive"/)
  assert.match(reopen, /WHERE school_id=\? AND assessment_id=\? AND evidence_status='valid'/)
  assert.match(reopen, /reconcileSupportCasesForAssessmentEvidence\(connection, schoolId, assessment, actor/)
  assert.ok(reopen.indexOf("evidence_status='invalidated'") < reopen.indexOf("reconcileSupportCasesForAssessmentEvidence"))
  assert.match(reopen, /support_evidence_reconciliation: supportEvidenceReconciliation/)
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

test("support case reassessment query avoids MySQL reserved aliases", () => {
  const support = read(root, "src/services/academicSupportService.js")
  const start = support.indexOf("const reassessmentSql")
  const end = support.indexOf("const [members", start)
  const reassessmentQuery = support.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.doesNotMatch(reassessmentQuery, /generated_assessments\s+generated\b/i)
  assert.match(reassessmentQuery, /generated_assessments\s+generated_assessment\b/i)
})

test("support schema capability detection is portable across MySQL metadata casing", () => {
  const support = read(root, "src/services/academicSupportService.js")
  assert.match(support, /TABLE_NAME AS table_name,COLUMN_NAME AS column_name/)
  for (const column of ["delivery_method", "target_topic_id", "target_objective_id"]) {
    assert.match(support, new RegExp(`sessionDetails:[^\\n]+${column}`))
  }
})

test("schema-dependent support writes fail clearly instead of issuing invalid SQL", () => {
  const support = read(root, "src/services/academicSupportService.js")
  assert.match(support, /LEARNER_SUPPORT_SCHEMA_UPGRADE_REQUIRED/)
  for (const capability of ["assignments", "notes", "sessionDetails", "reassessmentDueAt"]) {
    assert.match(support, new RegExp(`requireSupportSchemaCapability\\(db, "${capability}"\\)`))
  }
  assert.match(support, /generated\.public_ref/)
  assert.doesNotMatch(support, /linkedRef: String\(body\.generated_assessment_id\)/)
})

test("cross-subject support cases cannot start a malformed targeted assessment", () => {
  const support = read(root, "src/services/academicSupportService.js")
  assert.match(support, /record\.case_type === "multi_subject_decline"/)
  assert.match(support, /SUBJECT_SPECIFIC_SUPPORT_CASE_REQUIRED/)
})

test("teacher learner-support extension reuses canonical support structures", () => {
  const migration = read(root, "database/062_teacher_learner_support_access.sql")
  const support = read(root, "src/services/academicSupportService.js")
  for (const table of ["learner_support_case_assignments", "learner_support_case_notes"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS learner_support_cases/)
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS intervention_cycles/)
  assert.match(support, /canAccessLearnerSupportCase/)
  assert.match(support, /learnerSupportActionAllowed/)
})

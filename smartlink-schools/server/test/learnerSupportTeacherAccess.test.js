import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  canAccessLearnerSupportCase,
  learnerSupportActionAllowed,
} from "../src/services/academicSupportService.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function fakeDb({ schoolId = 1, actor = {}, caseRecord = {}, relationships = {} } = {}) {
  const record = { id: 41, public_ref: "case-41", school_id: schoolId, academic_year_id: 7, current_term_id: 9, class_id: 12, subject_id: 14, owner_user_id: null, status: "intervention_active", ...caseRecord }
  return {
    async query(sql, params) {
      if (sql.includes("FROM learner_support_cases c WHERE")) return Number(params[0]) === Number(schoolId) ? [[record]] : [[]]
      if (sql.includes("FROM users WHERE school_id")) return [[{ id: params[1], role: "teacher", role_type: "teacher", is_active: 1, employment_status: "active", ...actor }]]
      if (sql.includes("FROM intervention_cycles")) return [relationships.owner ? [{ ok: 1 }] : []]
      if (sql.includes("FROM learner_support_case_assignments")) return [relationships.support ? [{ assignment_type: "support_teacher", assignment_status: "acknowledged" }] : relationships.action ? [{ assignment_type: "action", assignment_status: "assigned" }] : []]
      if (sql.includes("role='subject_teacher'")) return [relationships.subject ? [{ ok: 1 }] : []]
      if (sql.includes("role='class_teacher'")) return [relationships.classTeacher ? [{ ok: 1 }] : []]
      if (sql.includes("FROM classes WHERE")) return [relationships.primaryClassTeacher ? [{ ok: 1 }] : []]
      throw new Error(`Unexpected test query: ${sql}`)
    },
  }
}

test("an unrelated teacher cannot view or mutate a guessed case id", async () => {
  const access = await canAccessLearnerSupportCase({ userId: 5, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb() })
  assert.equal(access.allowed, false)
  assert.deepEqual(access.relationships, [])
  assert.equal(learnerSupportActionAllowed(access, "record_session", access.case), false)
})

test("cross-school case lookup is rejected before relationship checks", async () => {
  const access = await canAccessLearnerSupportCase({ userId: 5, schoolId: 2, caseId: "case-41", actorRole: "teacher", db: fakeDb({ schoolId: 1, relationships: { subject: true } }) })
  assert.equal(access.allowed, false)
  assert.equal(access.reason, "not_found")
})

test("a current subject teacher can view and record only relationship-safe work", async () => {
  const access = await canAccessLearnerSupportCase({ userId: 5, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ relationships: { subject: true } }) })
  assert.equal(access.allowed, true)
  assert.ok(access.relationships.includes("subject_teacher"))
  assert.equal(learnerSupportActionAllowed(access, "record_session", access.case), true)
  assert.equal(learnerSupportActionAllowed(access, "guardian_summary", access.case), false)
  assert.equal(learnerSupportActionAllowed(access, "resolve", access.case), false)
})

test("class teachers and explicitly assigned support teachers receive their canonical relationships", async () => {
  const classAccess = await canAccessLearnerSupportCase({ userId: 5, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ relationships: { classTeacher: true } }) })
  const supportAccess = await canAccessLearnerSupportCase({ userId: 6, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ relationships: { support: true } }) })
  assert.ok(classAccess.relationships.includes("class_teacher"))
  assert.ok(supportAccess.relationships.includes("support_teacher"))
  assert.equal(learnerSupportActionAllowed(supportAccess, "acknowledge", supportAccess.case), true)
  assert.equal(learnerSupportActionAllowed(supportAccess, "complete_assignment", supportAccess.case), true)
})

test("removed assignments revoke access and archived cases still require a relationship", async () => {
  const removed = await canAccessLearnerSupportCase({ userId: 5, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ caseRecord: { status: "resolved" } }) })
  const archivedAssigned = await canAccessLearnerSupportCase({ userId: 6, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ caseRecord: { status: "resolved" }, relationships: { support: true } }) })
  assert.equal(removed.allowed, false)
  assert.equal(archivedAssigned.allowed, true)
})

test("coordinator and headteacher actions remain distinct from teacher actions", async () => {
  const coordinator = await canAccessLearnerSupportCase({ userId: 7, schoolId: 1, caseId: "case-41", actorRole: "teacher", db: fakeDb({ actor: { role_type: "admin_teacher" } }) })
  const headteacher = await canAccessLearnerSupportCase({ userId: 8, schoolId: 1, caseId: "case-41", actorRole: "headteacher", db: fakeDb({ actor: { role: "headteacher", role_type: "headteacher" } }) })
  assert.equal(learnerSupportActionAllowed(coordinator, "assign", coordinator.case), true)
  assert.equal(learnerSupportActionAllowed(coordinator, "guardian_summary", coordinator.case), false)
  assert.equal(learnerSupportActionAllowed(headteacher, "guardian_summary", headteacher.case), true)
})

test("teacher responses filter restricted notes and support session statuses are durable", () => {
  const service = fs.readFileSync(path.join(root, "src/services/academicSupportService.js"), "utf8")
  const migration = fs.readFileSync(path.join(root, "database/062_teacher_learner_support_access.sql"), "utf8")
  assert.match(service, /noteVisibility = access\.isHeadteacher/)
  assert.match(service, /\["teacher_academic"\]/)
  assert.match(service, /note\.visibility IN/)
  assert.doesNotMatch(service, /SELECT note\.\*/)
  for (const status of ["planned", "completed", "partially_completed", "cancelled", "learner_absent", "teacher_absent", "rescheduled"]) assert.match(migration, new RegExp(status))
  assert.match(service, /idempotency_key/)
  assert.match(service, /intervention_session_attendance/)
})

test("teacher portal uses canonical learner-support routes and no duplicate case endpoint", () => {
  const routes = fs.readFileSync(path.join(root, "src/routes/index.js"), "utf8")
  const page = fs.readFileSync(path.resolve(root, "../client/src/app/pages/LearnerSupportPage.tsx"), "utf8")
  const access = fs.readFileSync(path.resolve(root, "../client/src/app/lib/access.ts"), "utf8")
  assert.match(routes, /academic-support\/summary/)
  assert.match(routes, /cases\/:caseId\/acknowledge/)
  assert.match(routes, /cases\/:caseId\/complete-assignment/)
  assert.match(routes, /cases\/:caseId\/record-session/)
  assert.match(routes, /cases\/:caseId\/add-note/)
  assert.match(page, /TargetedAssessmentWorkflow/)
  assert.match(page, /Learner attendance/)
  assert.match(page, /Recently improved/)
  const teacherPrefixes = access.slice(access.indexOf("teacher: ["), access.indexOf("parent: ["))
  assert.match(teacherPrefixes, /'\/learner-support'/)
  assert.match(access, /path: '\/learner-support', permissions: \[MERA_PERMISSIONS\.ACADEMIC_INTELLIGENCE_VIEW\]/)
  assert.doesNotMatch(routes, /teacher\/learner-support/)
})

test("the canonical reminder engine covers support-session and reassessment due work", () => {
  const reminders = fs.readFileSync(path.join(root, "src/services/reminderEngine.js"), "utf8")
  assert.match(reminders, /support_session_due/)
  assert.match(reminders, /support_session_overdue/)
  assert.match(reminders, /support_reassessment_due/)
  assert.match(reminders, /dedupeWindow/)
})

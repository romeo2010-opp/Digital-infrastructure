import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("learner-support detail survives optional feed failures and hides invalid assessment authoring", async () => {
  const page = await source("client/src/app/pages/LearnerSupportPage.tsx")
  assert.match(page, /Promise\.allSettled/)
  assert.match(page, /caseResult\.status === 'rejected'/)
  assert.match(page, /timelineResult\.status === 'fulfilled'/)
  assert.match(page, /evidenceResult\.status === 'fulfilled'/)
  assert.match(page, /hasTargetedAssessmentScope/)
  assert.match(page, /record\.case_type !== 'multi_subject_decline'/)
  assert.match(page, /actions\.has\('create_assessment'\) && hasTargetedAssessmentScope/)
})

test("learner-support search uses the same read permission as its page and API", async () => {
  const search = await source("server/src/services/schoolSearchService.js")
  const catalogEntry = search.split("\n").find((line) => line.includes('id: "learner-support"')) || ""
  assert.match(catalogEntry, /ACADEMIC_INTELLIGENCE_VIEW/)
  assert.match(search, /const canSupport = hasPermission\(permissions, SCHOOL_PERMISSIONS\.ACADEMIC_INTELLIGENCE_VIEW\)/)
})

test("leave self-service honors school policy and assigned coverage can be cleared", async () => {
  const [service, controller, client] = await Promise.all([
    source("server/src/services/hrOperationsService.js"),
    source("server/src/controllers/hrOperationsController.js"),
    source("client/src/app/pages/HrOperationsPage.tsx"),
  ])
  assert.match(service, /teacherLeaveRequestsAllowed/)
  assert.match(service, /Teacher leave requests are disabled by the school's leave settings/)
  assert.match(service, /can_request_leave:teacherLeaveRequestsAllowed/)
  assert.match(controller, /getOwnLeaveDashboard\(school\(req\),req\.user\)/)
  assert.match(service, /coverageProvided=Object\.prototype\.hasOwnProperty\.call\(body,"coverage_staff_ref"\)/)
  assert.match(service, /updates\.push\("coverage_staff_user_id=\?"\)/)
  assert.doesNotMatch(service.slice(service.indexOf("export async function updateLeaveRequest")), /coverage_staff_user_id=COALESCE/)
  assert.match(client, /data\.can_request_leave !== false/)
  assert.match(client, /Allow teachers to request leave/)
  assert.match(client, /value=\{coverage\}/)
})

import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("unfinished payroll is hidden from navigation and aware-search discovery", async () => {
  const [sidebar, search] = await Promise.all([
    source("client/src/app/components/Sidebar.tsx"),
    source("server/src/services/schoolSearchService.js"),
  ])
  assert.doesNotMatch(sidebar, /label:\s*['"]Payroll['"]/)
  assert.doesNotMatch(search, /id:\s*["']payroll["']/)
})

test("staff leave self-service is owner-scoped and separately routed from leadership review", async () => {
  const [routes, service, client, app] = await Promise.all([
    source("server/src/routes/index.js"),
    source("server/src/services/hrOperationsService.js"),
    source("client/src/app/pages/HrOperationsPage.tsx"),
    source("client/src/app/App.tsx"),
  ])
  assert.match(routes, /\/staff\/leave\/me/)
  assert.match(service, /lr\.staff_user_id=\?/)
  assert.match(service, /You can only cancel your own leave request/)
  assert.match(client, /export function MyLeavePage/)
  assert.match(app, /path="\/my-leave"/)
})

test("leadership KPI strips keep four unique cards", async () => {
  const [strip, analytics] = await Promise.all([
    source("client/src/app/components/SectionKpiStrip.tsx"),
    source("server/src/services/directorAnalyticsService.js"),
  ])
  assert.match(strip, /new Map<string, SectionKpiItem>/)
  assert.match(strip, /slice\(0, 4\)/)
  assert.match(analytics, /selectedKpis/)
  assert.match(analytics, /slice\(0, 4\)/)
})

test("director navigation is an accordion and blank syllabus creation is explicit", async () => {
  const [sidebar, syllabus] = await Promise.all([
    source("client/src/app/components/Sidebar.tsx"),
    source("client/src/app/pages/SyllabusIntelligencePage.tsx"),
  ])
  assert.match(sidebar, /current\[label\] \? \{\} : \{ \[label\]: true \}/)
  assert.match(syllabus, /New blank document/)
  assert.match(syllabus, /Uploading material is optional/)
  assert.match(syllabus, /navigate\('\/syllabus\/create'\)/)
})

test("parent creation and linking use canonical guardian records", async () => {
  const [controller, modal, workspace] = await Promise.all([
    source("server/src/controllers/schoolDataController.js"),
    source("client/src/app/components/SchoolActionModal.tsx"),
    source("client/src/app/pages/SchoolWorkspace.tsx"),
  ])
  assert.match(controller, /JOIN student_guardians sg/)
  assert.match(controller, /guardian_missing/)
  assert.match(controller, /INSERT INTO student_guardians \(public_ref,school_id,student_id,user_id/)
  assert.match(controller, /Select the learner and guardian record for this parent login/)
  assert.match(controller, /guardian\.user_id.*different parent login/)
  assert.match(modal, /Activate login for this guardian/)
  assert.match(modal, /does not create a separate parent record/)
  assert.match(modal, /linkParentGuardian/)
  assert.match(modal, /temporary_password/)
  assert.match(workspace, /pageKey === "parents"\) return "parent"/)
})

test("parents use the canonical student portal with guardian-scoped learner switching", async () => {
  const [studentPortal, routes, reportCards, app, access, portalPage, api, intelligence, intelligenceController, studentProfile, portalContext] = await Promise.all([
    source("server/src/controllers/studentPortalController.js"),
    source("server/src/routes/index.js"),
    source("server/src/controllers/examController.js"),
    source("client/src/app/App.tsx"),
    source("client/src/app/lib/access.ts"),
    source("client/src/app/pages/StudentPortalPage.tsx"),
    source("client/src/app/lib/portalApi.ts"),
    source("server/src/services/academicIntelligenceEngine.js"),
    source("server/src/controllers/academicIntelligenceController.js"),
    source("client/src/app/pages/StudentProfilePage.tsx"),
    source("client/src/app/lib/portalContext.tsx"),
  ])
  assert.match(routes, /\/student-portal[^\n]+requireRole\("student", "parent"\)/)
  assert.match(studentPortal, /FROM student_guardians sg[\s\S]*sg\.user_id = \?/)
  assert.match(studentPortal, /selected_student_ref/)
  assert.match(studentPortal, /The linked learner was not found/)
  assert.match(reportCards, /role === "parent"[\s\S]*student_guardians sg[\s\S]*sg\.user_id = \?/)
  assert.match(access, /parent:\s*'\/student-portal'/)
  assert.match(app, /path="\/parent-insights" element=\{<Navigate to="\/student-portal" replace \/>\}/)
  assert.doesNotMatch(app, /ParentAcademicInsightsPage/)
  assert.match(portalPage, /Family portal/)
  assert.match(portalPage, /available_students/)
  assert.match(portalPage, /canRespond=\{!isParent\}/)
  assert.match(api, /student_ref: studentRef/)
  assert.match(intelligence, /pai\.status IN \('approved','published'\)/)
  assert.match(intelligence, /pai\.student_id IN \(\$\{placeholders\}\)/)
  assert.match(intelligence, /becameParentVisible/)
  assert.match(intelligenceController, /req\.user,req\.query\|\|\{\}/)
  assert.match(studentProfile, /Approve & share/)
  assert.match(api, /subscribePortalRequestActivity/)
  assert.match(api, /updateRequestActivity\(1\)[\s\S]*finally[\s\S]*updateRequestActivity\(-1\)/)
  assert.match(portalContext, /pendingRequestCount/)
  assert.match(app, /GlobalRequestActivity/)
})

test("Classroom Mode prioritises the active timetable subject over stale lessons", async () => {
  const [service, client, migration] = await Promise.all([
    source("server/src/services/libraryClassroomService.js"),
    source("client/src/app/pages/ClassroomModePage.tsx"),
    source("server/database/064_lesson_log_timetable_scope.sql"),
  ])
  assert.match(service, /activeMatchesPeriod/)
  assert.match(service, /unfinished_lesson/)
  assert.match(service, /selected timetable period is not active for this class and subject/)
  assert.match(service, /teacher_lesson_logs[\s\S]*timetableEntryId,lessonDate/)
  assert.match(service, /classroom_sessions[\s\S]*timetableEntryId/)
  assert.match(service, /role='subject_teacher'[\s\S]*academic_year_id IS NULL[\s\S]*term_id IS NULL/)
  assert.match(service, /DELETE objective_link FROM teacher_lesson_log_objectives/)
  assert.match(migration, /REFERENCES timetable_entries\(id\)/)
  assert.doesNotMatch(migration, /REFERENCES exam_timetable_entries\(id\)/)
  assert.match(client, /current\.subject_ref/)
  assert.match(client, /selectedIsCurrent/)
  assert.doesNotMatch(client, /setSubjectRef\(['"]English['"]\)/)
})

test("Learner Support opens safely while the teacher-access migration is pending", async () => {
  const [service, client] = await Promise.all([
    source("server/src/services/academicSupportService.js"),
    source("client/src/app/pages/LearnerSupportPage.tsx"),
  ])
  assert.match(service, /supportSchemaCapabilities/)
  assert.match(service, /compatibility_read_only/)
  assert.match(service, /optionalRows/)
  assert.doesNotMatch(service, /JSON_ARRAYAGG/)
  assert.match(client, /database compatibility mode/)
})

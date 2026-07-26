import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { assertAssignmentScope } from "../src/services/teacherAssignmentService.js"

const root = new URL("../../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("assessment and exam authorization require exact current-session teacher assignments", async () => {
  const [assessments, exams] = await Promise.all([
    source("server/src/controllers/assessmentController.js"),
    source("server/src/controllers/examController.js"),
  ])

  assert.match(assessments, /activeSession\.setupRequired[\s\S]*Teachers can only access assessments in the current academic term/)
  assert.match(assessments, /const includeHistory = !isTeacher\(req\)/)
  assert.match(assessments, /academic_year_id = \? AND term_id = \?[\s\S]*role = 'subject_teacher' AND is_active = 1/)
  assert.match(assessments, /ta\.academic_year_id = a\.academic_year_id[\s\S]*ta\.term_id = a\.term_id/)
  assert.doesNotMatch(assessments, /a\.academic_year_id = \? OR a\.academic_year_id IS NULL/)
  assert.doesNotMatch(assessments, /ta\.academic_year_id = a\.academic_year_id OR ta\.academic_year_id IS NULL/)

  assert.match(exams, /academic_year_id = \? AND a\.term_id = \?/)
  assert.match(exams, /Teachers can only view exam sessions in the current academic term/)
  assert.match(exams, /assertTeacherCanTeachSubject\(req, schoolId, classId, subjectId, examSession\.term_id\)/)
  assert.doesNotMatch(exams, /a\.academic_year_id = \? OR a\.academic_year_id IS NULL/)
})

test("results, session decoration and current school data fail closed instead of treating NULL assignments as global", async () => {
  const [results, auth, assignments, schoolData] = await Promise.all([
    source("server/src/controllers/resultsController.js"),
    source("server/src/controllers/authController.js"),
    source("server/src/controllers/teacherAssignmentsController.js"),
    source("server/src/controllers/schoolDataController.js"),
  ])

  assert.match(results, /assignment\.academic_year_id = \? AND assignment\.term_id = \?/)
  assert.match(results, /tcsa\.academic_year_id=rb\.academic_year_id AND tcsa\.term_id=rb\.term_id/)
  assert.doesNotMatch(results, /a\.academic_year_id = \? OR a\.academic_year_id IS NULL/)

  for (const controller of [auth, assignments, schoolData]) {
    assert.match(controller, /AND 1 = 0/)
    assert.match(controller, /a\.academic_year_id = \? AND a\.term_id = \?/)
    assert.doesNotMatch(controller, /a\.academic_year_id = \? OR a\.academic_year_id IS NULL/)
  }
  assert.match(assignments, /const includeHistory = !isTeacher\(req\)/)
  assert.match(assignments, /Active teacher assignments require an academic year and term/)
  assert.doesNotMatch(auth, /WHERE school_id = \? AND teacher_user_id = \?[\s\S]*UNION/)
})

test("calendar, aware search and timetable solving use the exact selected session", async () => {
  const [calendar, search, solver] = await Promise.all([
    source("server/src/controllers/calendarController.js"),
    source("server/src/services/schoolSearchService.js"),
    source("server/src/modules/timetabling/solverMappers.service.js"),
  ])

  assert.match(calendar, /academic_year_id = \? AND term_id = \?/)
  assert.match(calendar, /Teachers can only view the current academic term calendar/)
  assert.match(calendar, /Teachers can only edit events in the current academic term/)
  assert.doesNotMatch(calendar, /\(academic_year_id = \? OR academic_year_id IS NULL\)/)

  assert.match(search, /tcsa\.academic_year_id=a\.academic_year_id AND tcsa\.term_id=a\.term_id/)
  assert.match(search, /tcsa\.academic_year_id=rb\.academic_year_id AND tcsa\.term_id=rb\.term_id/)
  assert.match(search, /tcsa\.academic_year_id=lsc\.academic_year_id AND tcsa\.term_id=lsc\.current_term_id/)
  assert.doesNotMatch(search, /a\.teacher_id=\? OR a\.created_by=\? OR EXISTS/)
  assert.doesNotMatch(search, /lsc\.owner_user_id=\? OR EXISTS/)

  assert.match(solver, /FROM teacher_class_subject_assignments[\s\S]*academic_year_id = \?[\s\S]*term_id = \?/)
  assert.doesNotMatch(solver, /FROM teacher_class_subject_assignments[\s\S]{0,200}academic_year_id IS NULL/)
})

test("teacher assignments validate the term as a child of the selected academic year", async () => {
  const calls = []
  const assignment = {
    teacherId: 11,
    classId: 22,
    subjectId: 33,
    academicYearId: 44,
    termId: 55,
    academicYear: "spoofed year",
    term: "spoofed term",
  }
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (/FROM users/.test(sql)) return [[{ id: 11 }], []]
      if (/FROM classes/.test(sql)) return [[{ id: 22 }], []]
      if (/FROM subjects/.test(sql)) return [[{ id: 33 }], []]
      if (/FROM academic_years/.test(sql)) return [[{ id: 44, name: "2026" }], []]
      if (/FROM terms/.test(sql)) return [[{ id: 55, name: "Term 2" }], []]
      throw new Error(`Unexpected query: ${sql}`)
    },
  }

  await assertAssignmentScope(connection, 7, assignment)
  const termCall = calls.find(({ sql }) => /FROM terms/.test(sql))
  assert.match(termCall.sql, /academic_year_id = \?/)
  assert.deepEqual(termCall.params, [55, 7, 44])
  assert.equal(assignment.academicYear, "2026")
  assert.equal(assignment.term, "Term 2")

  const mismatched = {
    ...connection,
    async query(sql, params) {
      if (/FROM terms/.test(sql)) return [[], []]
      return connection.query(sql, params)
    },
  }
  await assert.rejects(
    () => assertAssignmentScope(mismatched, 7, { ...assignment }),
    /belongs to the selected academic year/,
  )
})

test("active assignment duplicate guards use canonical session ids instead of editable labels", async () => {
  const assignmentService = await source("server/src/services/teacherAssignmentService.js")
  assert.doesNotMatch(assignmentService, /AND academic_year = \? AND term = \? AND is_active = 1/)
  assert.match(assignmentService, /COALESCE\(academic_year_id, 0\) = COALESCE\(\?, 0\)[\s\S]*COALESCE\(term_id, 0\) = COALESCE\(\?, 0\)[\s\S]*AND is_active = 1/)
})

test("opening a term does not authorize ambiguous legacy teacher assignments", async () => {
  const academicSession = await source("server/src/controllers/academicSessionController.js")
  assert.doesNotMatch(academicSession, /UPDATE teacher_class_subject_assignments[\s\S]{0,180}SET academic_year_id = COALESCE\(academic_year_id, \?\), term_id = COALESCE\(term_id, \?\)/)
  assert.doesNotMatch(academicSession, /WHERE school_id = \? AND is_active = 1[\s\S]{0,80}COALESCE\(academic_year_id/)
})

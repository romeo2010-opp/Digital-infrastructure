import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  assertTeacherCanAuthorSubjectGrade,
  assertTeacherCanTeachSubject,
  assertTeacherCanUseClass,
  assertTeacherCanUseSubjectInClass,
  getTeacherClassIds,
  getTeacherClassSubjectPairs,
  getTeacherSubjectGradeScopes,
} from "../src/utils/tenantScope.js"
import { canReviewQuestionBank } from "../src/controllers/questionsController.js"
import {
  assertTeacherSyllabusUploadScope,
  resolveSyllabusUploadReferences,
} from "../src/controllers/syllabusController.js"
import {
  importedQuestionBankModeration,
  importedQuestionExplanation,
} from "../src/services/assessmentImportService.js"
import { assertTeacherLibraryAssignment } from "../src/services/libraryClassroomService.js"

const activeSession = { setupRequired: false, academicYearId: 2026, termId: 3 }

function teacherRequest(id = 7) {
  return { user: { id, schoolId: 1, role: "teacher" } }
}

function assignmentDb(rows) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql: String(sql), params })
      return [rows]
    },
  }
}

test("teacher authoring scopes use active exact class-subject assignments and canonical class grades", async () => {
  const db = assignmentDb([{ class_id: 20, subject_id: 10, grade_id: 4 }])
  const scopes = await getTeacherSubjectGradeScopes(teacherRequest(), 1, { db, session: activeSession })
  assert.deepEqual(scopes, [{ classId: 20, subjectId: 10, gradeId: 4 }])
  assert.match(db.calls[0].sql, /assignment\.role = 'subject_teacher'/)
  assert.match(db.calls[0].sql, /assignment\.is_active = 1/)
  assert.match(db.calls[0].sql, /assignment\.academic_year_id = \?/)
  assert.match(db.calls[0].sql, /assignment\.term_id = \?/)
  assert.doesNotMatch(db.calls[0].sql, /academic_year_id IS NULL|term_id IS NULL/)
  assert.match(db.calls[0].sql, /grade\.name.*class_record\.grade_level/)
  assert.deepEqual(db.calls[0].params, [1, 7, 2026, 3])
})

test("teacher authoring fails closed when the school has no active academic session", async () => {
  const db = assignmentDb([{ class_id: 20, subject_id: 10, grade_id: 4 }])
  const scopes = await getTeacherSubjectGradeScopes(teacherRequest(), 1, {
    db,
    session: { setupRequired: true, academicYearId: null, termId: null },
  })
  assert.deepEqual(scopes, [])
  assert.equal(db.calls.length, 0)
})

test("shared teacher class and subject guards require the exact active session", async () => {
  const db = assignmentDb([{ id: 1, class_id: 20, subject_id: 10 }])
  assert.deepEqual(await getTeacherClassIds(teacherRequest(), 1, { db, session: activeSession }), [1])
  assert.deepEqual(await getTeacherClassSubjectPairs(teacherRequest(), 1, { db, session: activeSession }), [{ classId: 20, subjectId: 10 }])
  await assert.doesNotReject(assertTeacherCanUseClass(teacherRequest(), 1, 20, { db, session: activeSession }))
  await assert.doesNotReject(assertTeacherCanUseSubjectInClass(teacherRequest(), 1, 20, 10, { db, session: activeSession }))
  await assert.doesNotReject(assertTeacherCanTeachSubject(teacherRequest(), 1, 20, 10, 3, { db, session: activeSession }))
  for (const call of db.calls) {
    assert.match(call.sql, /academic_year_id = \? AND term_id = \?/)
    assert.doesNotMatch(call.sql, /academic_year_id IS NULL|term_id IS NULL|teacher_user_id/)
    assert.deepEqual(call.params.slice(-2), [2026, 3])
  }
  await assert.rejects(
    assertTeacherCanTeachSubject(teacherRequest(), 1, 20, 10, 4, { db, session: activeSession }),
    (error) => error?.status === 403 && /current academic year and term/i.test(error.message),
  )
})

test("shared teacher class and subject guards fail closed without an active session", async () => {
  const db = { async query() { throw new Error("assignment query must not run without a session") } }
  const noSession = { setupRequired: true, academicYearId: null, termId: null }
  assert.deepEqual(await getTeacherClassIds(teacherRequest(), 1, { db, session: noSession }), [])
  assert.deepEqual(await getTeacherClassSubjectPairs(teacherRequest(), 1, { db, session: noSession }), [])
  await assert.rejects(
    assertTeacherCanUseClass(teacherRequest(), 1, 20, { db, session: noSession }),
    (error) => error?.status === 403 && /explicit assignment/i.test(error.message),
  )
  await assert.rejects(
    assertTeacherCanUseSubjectInClass(teacherRequest(), 1, 20, 10, { db, session: noSession }),
    (error) => error?.status === 403 && /explicit assignment/i.test(error.message),
  )
})

test("teachers may author only their assigned subject and matching class year", async () => {
  const db = assignmentDb([{ class_id: 20, subject_id: 10, grade_id: 4 }])
  await assert.doesNotReject(assertTeacherCanAuthorSubjectGrade(
    teacherRequest(),
    1,
    { subjectId: 10, gradeId: 4, createdBy: 7 },
    { db, session: activeSession },
  ))
  await assert.rejects(
    assertTeacherCanAuthorSubjectGrade(
      teacherRequest(),
      1,
      { subjectId: 10, gradeId: 5, createdBy: 7 },
      { db, session: activeSession },
    ),
    (error) => error?.status === 403 && /currently assigned subject and class year level/i.test(error.message),
  )
  await assert.rejects(
    assertTeacherCanAuthorSubjectGrade(
      teacherRequest(),
      1,
      { subjectId: 10, gradeId: 4, createdBy: 99 },
      { db, session: activeSession },
    ),
    (error) => error?.status === 403 && /content they created/i.test(error.message),
  )
  await assert.rejects(
    assertTeacherCanAuthorSubjectGrade(
      teacherRequest(),
      1,
      { subjectId: 10, gradeId: 4, createdBy: null },
      { db, session: activeSession },
    ),
    (error) => error?.status === 403 && /content they created/i.test(error.message),
  )
})

test("question-bank moderation is limited to academic leadership", () => {
  for (const role of ["super_admin", "school_owner", "owner", "director", "headteacher"]) {
    assert.equal(canReviewQuestionBank({ user: { role } }), true, `${role} should review`)
  }
  for (const role of ["teacher", "bursar", "librarian", "parent", "student"]) {
    assert.equal(canReviewQuestionBank({ user: { role } }), false, `${role} should not review`)
  }
})

test("assessment imports only auto-approve complete Daily Drill question-bank rows", () => {
  assert.equal(importedQuestionExplanation("Lilongwe", []), "Correct answer: Lilongwe")
  assert.equal(
    importedQuestionExplanation("Lilongwe", [{ text: "Award one mark for Lilongwe." }]),
    "Award one mark for Lilongwe.",
  )
  const complete = {
    correctAnswer: "Lilongwe",
    explanation: "Award one mark for Lilongwe.",
    topicId: 12,
    gradeId: 4,
    subjectId: 10,
  }
  assert.deepEqual(importedQuestionBankModeration({ actorRole: "director", ...complete }), {
    approvalStatus: "approved",
    approvalReady: true,
    missing: [],
  })
  assert.equal(importedQuestionBankModeration({ actorRole: "teacher", ...complete }).approvalStatus, "pending_review")
  const invalid = importedQuestionBankModeration({ actorRole: "school_owner", ...complete, correctAnswer: "", gradeId: null })
  assert.equal(invalid.approvalStatus, "pending_review")
  assert.deepEqual(invalid.missing, ["correct answer", "grade"])
})

test("teacher library authoring requires an exact current subject and class assignment", async () => {
  const db = assignmentDb([{ id: 41 }])
  await assert.doesNotReject(assertTeacherLibraryAssignment(db, 1, teacherRequest().user, {
    subjectId: 10,
    classId: 20,
    academicYearId: 2026,
    termId: 3,
  }, { session: activeSession }))
  assert.match(db.calls[0].sql, /academic_year_id=\? AND term_id=\?/)
  assert.match(db.calls[0].sql, /role='subject_teacher'/)
  assert.doesNotMatch(db.calls[0].sql, /academic_year_id IS NULL|term_id IS NULL/)
  assert.deepEqual(db.calls[0].params, [1, 7, 10, 2026, 3, 20])
  await assert.rejects(
    assertTeacherLibraryAssignment(db, 1, teacherRequest().user, { subjectId: 10, academicYearId: 2025 }, { session: activeSession }),
    (error) => error?.status === 403 && /current academic year and term/i.test(error.message),
  )
  await assert.rejects(
    assertTeacherLibraryAssignment(db, 1, teacherRequest().user, { subjectId: 10 }, { session: { setupRequired: true } }),
    (error) => error?.status === 403 && /explicit library assignment/i.test(error.message),
  )
})

test("syllabus upload references are tenant-resolved and term-bound to the selected year", async () => {
  const db = {
    async query(source, params) {
      const sql = String(source).replace(/\s+/g, " ")
      if (sql.includes("FROM subjects")) return [[{ id: 10 }]]
      if (sql.includes("FROM curricula")) return [[{ id: 2 }]]
      if (sql.includes("FROM grade_levels")) return [[{ id: 4, curriculum_id: 2 }]]
      if (sql.includes("FROM academic_years")) return [[{ id: 2026 }]]
      if (sql.includes("FROM terms")) return [[{ id: 3, academic_year_id: Number(params[0]) === 1 ? 2026 : 999 }]]
      throw new Error(`Unhandled reference query: ${sql}`)
    },
  }
  assert.deepEqual(
    await resolveSyllabusUploadReferences(db, 1, {
      subject_id: 10,
      curriculum_id: 2,
      grade_id: 4,
      academic_year_id: 2026,
      term_id: 3,
    }),
    { subjectId: 10, curriculumId: 2, gradeId: 4, academicYearId: 2026, termId: 3 },
  )
  const wrongTermDb = { ...db, query: async (source, params) => String(source).includes("FROM terms") ? [[{ id: 3, academic_year_id: 2025 }]] : db.query(source, params) }
  await assert.rejects(
    resolveSyllabusUploadReferences(wrongTermDb, 1, { subject_id: 10, curriculum_id: 2, grade_id: 4, academic_year_id: 2026, term_id: 3 }),
    /Term does not belong to the selected school academic year/i,
  )
})

test("teacher syllabus upload access requires ownership, active session, subject and class year", async () => {
  const upload = { id: 30, uploaded_by: 7, subject_id: 10, grade_id: 4, curriculum_id: 2, academic_year_id: 2026, term_id: 3, processing_status: "pending_review" }
  const db = {
    async query(source) {
      const sql = String(source)
      if (sql.includes("FROM syllabus_uploads")) return [[upload]]
      if (sql.includes("FROM teacher_class_subject_assignments")) return [[{ class_id: 20, subject_id: 10, grade_id: 4 }]]
      throw new Error(`Unhandled upload scope query: ${sql}`)
    },
  }
  assert.equal((await assertTeacherSyllabusUploadScope(teacherRequest(), 1, 30, db, { session: activeSession })).id, 30)
  await assert.rejects(
    assertTeacherSyllabusUploadScope(teacherRequest(8), 1, 30, db, { session: activeSession }),
    (error) => error?.status === 404 && /current assigned scope/i.test(error.message),
  )
  await assert.rejects(
    assertTeacherSyllabusUploadScope(teacherRequest(), 1, 30, db, { session: { ...activeSession, termId: 4 } }),
    (error) => error?.status === 403 && /active academic year and term/i.test(error.message),
  )
})

test("question and syllabus handlers enforce ownership, active scope, and leadership-only review routes", async () => {
  const [questions, syllabus, assessmentImports, importController, library, routes, syllabusUi] = await Promise.all([
    readFile(new URL("../src/controllers/questionsController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/syllabusController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/assessmentImportService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/assessmentImportController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/libraryClassroomService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/index.js", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/app/pages/SyllabusIntelligencePage.tsx", import.meta.url), "utf8"),
  ])

  const questionUpdate = questions.slice(
    questions.indexOf("export async function updateQuestion"),
    questions.indexOf("export async function approveQuestion"),
  )
  assert.match(questionUpdate, /created_by,approval_status/)
  assert.match(questionUpdate, /assertTeacherCanAuthorSubjectGrade/)
  assert.match(questionUpdate, /createdBy: current\.created_by/)
  assert.match(questionUpdate, /materialFields/)
  assert.match(questionUpdate, /approval_status = CASE WHEN \? = 1 THEN 'pending_review'/)
  assert.match(questionUpdate, /UPDATE question_explanations[\s\S]*approval_status='pending_review',approved_by=NULL/)
  assert.match(questionUpdate, /beginTransaction\(\)[\s\S]*commit\(\)[\s\S]*rollback\(\)/)
  assert.match(questions, /const approvalStatus = isTeacher\(req\) \? "pending_review" : requestedStatus/)
  assert.match(questions, /getTeacherSubjectGradeScopes\(req, schoolId\)/)
  assert.match(questions, /gqb\.teacher_id = \?/)
  const sourceQuestions = questions.slice(
    questions.indexOf("export async function sourceAssessmentQuestions"),
    questions.indexOf("export async function generateDraftQuestionBatch"),
  )
  assert.match(sourceQuestions, /getTeacherSubjectGradeScopes/)
  assert.match(sourceQuestions, /assertTeacherCanAuthorSubjectGrade/)
  assert.match(sourceQuestions, /scope\.classId === Number\(question\.class_id\)/)
  assert.doesNotMatch(sourceQuestions, /a\.teacher_id = \? OR a\.created_by = \?/)
  assert.match(assessmentImports, /importedQuestionBankModeration/)
  assert.match(assessmentImports, /curriculum_id,grade_id,subject_id,topic_id/)
  assert.match(assessmentImports, /correct_answer,explanation,difficulty/)
  assert.match(assessmentImports, /topicScope\?\.topic\?\.grade_id/)
  assert.match(assessmentImports, /assignment\.academic_year_id=\? AND assignment\.term_id=\?/)
  assert.doesNotMatch(assessmentImports, /academic_year_id IS NULL|term_id IS NULL/)
  assert.match(assessmentImports, /approved_at\s*\) VALUES[^`]+CASE WHEN \? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END/)
  assert.match(importController, /approveAssessmentImport\(school\(req\),req\.user,req\.params\.importRef\)/)
  assert.match(library, /assertTeacherLibraryAssignment/)
  assert.match(library, /ta\.academic_year_id=\? AND ta\.term_id=\?/)
  assert.match(library, /a\.academic_year_id=\? AND a\.term_id=\?/)
  assert.doesNotMatch(library, /academic_year_id IS NULL|term_id IS NULL/)

  const topicList = syllabus.slice(
    syllabus.indexOf("export async function listSyllabusTopics"),
    syllabus.indexOf("export async function createSyllabusTopic"),
  )
  const topicCreate = syllabus.slice(
    syllabus.indexOf("export async function createSyllabusTopic"),
    syllabus.indexOf("export async function updateSyllabusTopic"),
  )
  const topicUpdate = syllabus.slice(syllabus.indexOf("export async function updateSyllabusTopic"))
  assert.match(topicList, /getTeacherSubjectGradeScopes/)
  assert.match(topicList, /addTeacherSubjectGradeFilter/)
  assert.match(topicCreate, /assertTeacherCanAuthorSubjectGrade/)
  assert.match(topicUpdate, /assertTeacherCanAuthorSubjectGrade/)
  assert.match(syllabusUi, /function canReprocessSyllabusUpload/)
  assert.match(syllabusUi, /processing_status \|\| ''\)\.toLowerCase\(\) !== 'approved'/)
  assert.match(syllabusUi, /canReprocessSyllabusUpload\(user, row\)/)
  assert.match(syllabusUi, /canReprocessSyllabusUpload\(user, review\.upload\)/)

  const approveRoute = routes.match(/router\.post\("\/questions\/:id\/approve"[^\n]+/u)?.[0] || ""
  const rejectRoute = routes.match(/router\.post\("\/questions\/:id\/reject"[^\n]+/u)?.[0] || ""
  for (const route of [approveRoute, rejectRoute]) {
    assert.match(route, /"super_admin"/)
    assert.match(route, /"school_owner"/)
    assert.match(route, /"director"/)
    assert.match(route, /"headteacher"/)
    assert.doesNotMatch(route, /"teacher"/)
  }
  for (const action of ["approve", "reject"]) {
    const route = routes.match(new RegExp(`router\\.post\\("/syllabus/manual-entries/:id/${action}"[^\\n]+`, "u"))?.[0] || ""
    for (const role of ["super_admin", "school_owner", "owner", "director", "headteacher"]) assert.ok(route.includes(`"${role}"`), `${role} missing from manual syllabus ${action} route`)
    assert.doesNotMatch(route, /"teacher"/)
  }
  for (const action of ["approve-bulk", ":id/approve", ":id/reject", ":id/merge"]) {
    const route = routes.split("\n").find((line) => line.includes(`/syllabus/extracted-items/${action}`)) || ""
    assert.doesNotMatch(route, /"teacher"/)
    assert.match(route, /"director"/)
  }
  assert.match(syllabus, /resolveSyllabusUploadReferences\(pool, schoolId, req\.body\)/)
  assert.match(syllabus, /su\.uploaded_by = \?/)
  assert.match(syllabus, /assertTeacherSyllabusUploadScope\(req, schoolId, uploadId\)/)
  assert.match(syllabus, /assertTeacherSyllabusItemScope\(req, schoolId, itemId\)/)
  assert.match(syllabus, /Target topic must belong to the upload's school, subject, curriculum and year level/)
  assert.match(syllabusUi, /canReviewManualEntries \? <button[\s\S]{0,500}?approveItem\(row\)/)
  assert.match(syllabus, /\["super_admin", "school_owner", "owner", "director", "headteacher"\]/)
})

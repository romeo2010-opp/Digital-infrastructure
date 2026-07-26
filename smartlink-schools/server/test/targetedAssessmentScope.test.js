import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  assertTargetedAssessmentMutationAccess,
  assertTeacherAssessmentAccess,
  resolveCanonicalTargetedLearners,
  resolveTargetedAssessmentDraftScope,
  resolveTargetedAssessmentLinks,
} from "../src/services/academicOperationsService.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const operationsSource = fs.readFileSync(path.join(root, "src/services/academicOperationsService.js"), "utf8")
const operationsControllerSource = fs.readFileSync(path.join(root, "src/controllers/academicOperationsController.js"), "utf8")
const targetedScope = { classId: 20, subjectId: 10, topicId: 70, targetTopicId: 71, academicYearId: 50, termId: 40 }
const scopeDbDataIntervention = () => ({ id: 90, school_id: 1, public_ref: "intervention-ref", class_id: 20, subject_id: 10, topic_id: 70, term_id: 40, assigned_teacher_id: 60, status: "active" })

function scopeDb(overrides = {}) {
  const data = {
    years: [{ id: 50, school_id: 1, name: "2026", status: "active", is_active: 1, virtual_ref: "year-ref" }],
    terms: [{ id: 40, school_id: 1, academic_year_id: 50, name: "Term 2", status: "open", virtual_ref: "term-ref" }],
    classes: [{ id: 20, school_id: 1, public_ref: "class-ref", name: "Year 6 A", grade_level: "Year 6" }],
    subjects: [{ id: 10, school_id: 1, public_ref: "subject-ref", name: "Mathematics" }],
    topics: [
      { id: 70, school_id: 1, public_ref: "topic-ref", subject_id: 10, parent_topic_id: null, curriculum_id: 1, grade_id: 5, is_active: 1 },
      { id: 71, school_id: 1, public_ref: "subtopic-ref", subject_id: 10, parent_topic_id: 70, curriculum_id: 1, grade_id: 5, is_active: 1 },
    ],
    grades: [{ id: 5, school_id: 1, name: "Year 6" }],
    students: [{ id: 30, school_id: 1, public_ref: "student-ref", status: "active", class_id: 20 }],
    enrollments: [{ id: 1, school_id: 1, student_id: 30, class_id: 20, academic_year_id: 50, term_id: 40, enrollment_status: "active" }],
    assignments: [{ id: 2, school_id: 1, teacher_id: 60, class_id: 20, subject_id: 10, academic_year_id: 50, term_id: 40, role: "subject_teacher", is_active: 1 }],
    interventions: [scopeDbDataIntervention()],
    alerts: [{ public_ref: "alert-ref", school_id: 1, class_id: 20, subject_id: 10, topic_id: 71, term_id: 40 }],
    recommendations: [{ public_ref: "recommendation-ref", school_id: 1, class_id: 20, subject_id: 10, topic_id: 70, term_id: 40 }],
    ...overrides,
  }
  const calls = []

  const scopedRecord = (rows, sql, params, refPattern, virtual = false) => {
    let index = 1
    let id = null
    let ref = null
    if (/\bid=\?/i.test(sql)) id = Number(params[index++])
    if (refPattern.test(sql)) ref = String(params[index++])
    return rows.filter((row) => row.school_id === Number(params[0])
      && (id === null || row.id === id)
      && (ref === null || String(virtual ? row.virtual_ref : row.public_ref) === ref))
  }

  return {
    calls,
    async query(source, params = []) {
      const sql = String(source).replace(/\s+/g, " ").trim()
      calls.push({ sql, params })
      if (!/^SELECT\b/i.test(sql)) throw new Error(`Unexpected write in targeted assessment scope test: ${sql}`)
      if (/FROM academic_years/i.test(sql) && /is_active\s*=\s*1/i.test(sql)) {
        return [data.years.filter((row) => row.school_id === Number(params[0]) && row.is_active === 1 && row.status !== "archived")]
      }
      if (/FROM terms/i.test(sql) && /status IN \('open', 'marking'\)/i.test(sql)) {
        return [data.terms.filter((row) => row.school_id === Number(params[0]) && row.academic_year_id === Number(params[1]) && ["open", "marking"].includes(row.status))]
      }
      if (/FROM academic_years/i.test(sql)) return [scopedRecord(data.years, sql, params, /SHA2\(CONCAT\('academic-year:'/i, true)]
      if (/FROM terms/i.test(sql)) return [scopedRecord(data.terms, sql, params, /SHA2\(CONCAT\('term:'/i, true)]
      if (/FROM academic_alerts/i.test(sql) && /UNION ALL/i.test(sql) && /FROM academic_recommendations/i.test(sql)) {
        const rows = [
          ...data.alerts.filter((row) => row.school_id === Number(params[0]) && row.public_ref === String(params[1])).map((row) => ({ ...row, finding_type: "alert" })),
          ...data.recommendations.filter((row) => row.school_id === Number(params[2]) && row.public_ref === String(params[3])).map((row) => ({ ...row, finding_type: "recommendation" })),
        ]
        return [rows.slice(0, 1)]
      }
      if (/FROM classes/i.test(sql)) return [scopedRecord(data.classes, sql, params, /public_ref=\?/i)]
      if (/FROM subjects/i.test(sql)) return [scopedRecord(data.subjects, sql, params, /public_ref=\?/i)]
      if (/FROM syllabus_topics/i.test(sql)) return [scopedRecord(data.topics, sql, params, /public_ref=\?/i).filter((row) => row.is_active === 1)]
      if (/FROM students/i.test(sql)) return [scopedRecord(data.students, sql, params, /public_ref=\?/i)]
      if (/FROM academic_interventions/i.test(sql)) return [scopedRecord(data.interventions, sql, params, /public_ref=\?/i)]
      if (/FROM grade_levels/i.test(sql)) {
        return [data.grades.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]) && row.name === String(params[2]))]
      }
      if (/FROM teacher_class_subject_assignments/i.test(sql)) {
        const [schoolId, teacherId, classId, subjectId, academicYearId, termId] = params.map(Number)
        return [data.assignments.filter((row) => row.school_id === schoolId && row.teacher_id === teacherId
          && row.class_id === classId && row.subject_id === subjectId && row.academic_year_id === academicYearId
          && row.term_id === termId && row.role === "subject_teacher" && row.is_active === 1)]
      }
      if (/FROM student_enrollments/i.test(sql)) {
        const [schoolId, studentId, classId, academicYearId, termId] = params.map(Number)
        return [data.enrollments.filter((row) => row.school_id === schoolId && row.student_id === studentId
          && row.class_id === classId && row.academic_year_id === academicYearId && row.term_id === termId
          && row.enrollment_status === "active")]
      }
      throw new Error(`Unhandled targeted assessment scope query: ${sql}`)
    },
  }
}

test("targeted assessment draft references resolve inside the current tenant session", async () => {
  const db = scopeDb()
  const scope = await resolveTargetedAssessmentDraftScope(db, 1, { id: 60, role: "teacher" }, {
    class_ref: "class-ref",
    subject_ref: "subject-ref",
    topic_ref: "topic-ref",
    subtopic_ref: "subtopic-ref",
    academic_year_ref: "year-ref",
    term_ref: "term-ref",
  })
  assert.deepEqual(scope, {
    classId: 20,
    subjectId: 10,
    topicId: 70,
    subtopicId: 71,
    targetTopicId: 71,
    academicYearId: 50,
    termId: 40,
  })
  assert.ok(db.calls.some(({ sql }) => /academic_year_id=\? AND term_id=\?/i.test(sql)))
})

test("numeric targeted assessment references cannot bypass tenant or ID-reference consistency", async () => {
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb({ classes: [{ id: 20, school_id: 2, public_ref: "foreign-class", grade_level: "Year 6" }] }), 1, { role: "director" }, {
      class_id: 20, subject_id: 10, topic_id: 70,
    }),
    /class does not belong to this school/i,
  )
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb(), 1, { role: "director" }, {
      class_id: 20, class_ref: "another-class", subject_id: 10, topic_id: 70,
    }),
    /ID and reference do not identify the same record/i,
  )
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb(), 1, { role: "director" }, {
      class_id: "not-an-id", subject_id: 10, topic_id: 70,
    }),
    /class is invalid/i,
  )
})

test("targeted assessment creation rejects stale sessions and broken syllabus relationships", async () => {
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb({ years: [
      { id: 50, school_id: 1, status: "active", is_active: 1, virtual_ref: "year-ref" },
      { id: 51, school_id: 1, status: "closed", is_active: 0, virtual_ref: "old-year" },
    ] }), 1, { role: "director" }, {
      class_id: 20, subject_id: 10, topic_id: 70, academic_year_id: 51,
    }),
    /current open academic session/i,
  )
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb({ topics: [{ id: 70, school_id: 1, public_ref: "topic-ref", subject_id: 11, grade_id: 5, is_active: 1 }] }), 1, { role: "director" }, {
      class_id: 20, subject_id: 10, topic_id: 70,
    }),
    /topic must belong to the selected subject/i,
  )
  await assert.rejects(
    resolveTargetedAssessmentDraftScope(scopeDb({ grades: [{ id: 5, school_id: 1, name: "Year 7" }] }), 1, { role: "director" }, {
      class_id: 20, subject_id: 10, topic_id: 70,
    }),
    /topic does not belong to the selected class year level/i,
  )
})

test("teacher targeted assessment access requires the exact class, subject, year and term assignment", async () => {
  const assessment = { class_id: 20, subject_id: 10, academic_year_id: 50, term_id: 40 }
  await assert.doesNotReject(assertTeacherAssessmentAccess(scopeDb(), 1, assessment, { id: 60, role: "teacher" }))
  await assert.rejects(
    assertTeacherAssessmentAccess(scopeDb({ assignments: [{ id: 2, school_id: 1, teacher_id: 60, class_id: 20, subject_id: 10, academic_year_id: null, term_id: null, role: "subject_teacher", is_active: 1 }] }), 1, assessment, { id: 60, role: "teacher" }),
    /exact active class, subject and academic session assignment/i,
  )
  await assert.rejects(
    assertTeacherAssessmentAccess(scopeDb(), 1, { ...assessment, term_id: null }, { id: 60, role: "teacher" }),
    /does not have an explicit academic session/i,
  )
  await assert.doesNotReject(assertTeacherAssessmentAccess(scopeDb({ assignments: [] }), 1, assessment, { id: 70, role: "director" }))
  await assert.rejects(
    assertTeacherAssessmentAccess(scopeDb({
      years: [{ id: 51, school_id: 1, status: "active", is_active: 1 }],
      terms: [{ id: 41, school_id: 1, academic_year_id: 51, status: "open" }],
    }), 1, assessment, { id: 60, role: "teacher" }),
    /current academic year and term/i,
  )
})

test("academic operations teacher routes enforce current assignment and question ownership", () => {
  const mappingStart = operationsSource.indexOf("export async function saveQuestionMappings")
  const mappingEnd = operationsSource.indexOf("async function loadLearners", mappingStart)
  const mappingSource = operationsSource.slice(mappingStart, mappingEnd)
  assert.match(mappingSource, /assertTeacherAssessmentAccess\(connection, schoolId, assessment, actor\)/)
  assert.ok(mappingSource.indexOf("assertTeacherAssessmentAccess") < mappingSource.indexOf("DELETE FROM question_topic_mappings"))

  const topicStart = operationsSource.indexOf("export async function listAuthoringTopics")
  const topicEnd = operationsSource.indexOf("export async function saveQuestionMappings", topicStart)
  const topicSource = operationsSource.slice(topicStart, topicEnd)
  assert.match(topicSource, /getTeacherSubjectGradeScopes\(\{ user: actor \}, schoolId\)/)
  assert.match(topicSource, /st\.subject_id=\? AND \(st\.grade_id IS NULL OR st\.grade_id <=> \?\)/)
  assert.match(operationsControllerSource, /listAuthoringTopics\(getScopedSchoolId\(req\), req\.query, req\.user\)/)

  const permissionStart = operationsSource.indexOf("export async function updateQuestionSourcePermission")
  const permissionEnd = operationsSource.indexOf("export async function getAssessmentOperationalIntelligence", permissionStart)
  const permissionSource = operationsSource.slice(permissionStart, permissionEnd)
  assert.match(permissionSource, /SELECT id,subject_id,grade_id,created_by FROM question_bank/)
  assert.match(permissionSource, /assertTeacherCanAuthorSubjectGrade\(\{ user: actor \}, schoolId/)
  assert.match(permissionSource, /createdBy: question\.created_by/)

  const listStart = operationsSource.indexOf("export async function listTargetedAssessments")
  const listEnd = operationsSource.indexOf("export async function updateQuestionSourcePermission", listStart)
  const listSource = operationsSource.slice(listStart, listEnd)
  assert.match(listSource, /requireActiveAcademicSession\(schoolId, pool\)/)
  assert.match(listSource, /ga\.academic_year_id=\? AND ga\.term_id=\?/)
})

test("targeted assessment mutations stop when their academic session is no longer current", async () => {
  const assessment = { class_id: 20, subject_id: 10, academic_year_id: 50, term_id: 40 }
  await assert.doesNotReject(assertTargetedAssessmentMutationAccess(scopeDb(), 1, assessment, { id: 60, role: "teacher" }))
  const nextSession = scopeDb({
    years: [{ id: 51, school_id: 1, name: "2027", status: "active", is_active: 1, virtual_ref: "new-year" }],
    terms: [{ id: 41, school_id: 1, academic_year_id: 51, name: "Term 1", status: "open", virtual_ref: "new-term" }],
  })
  await assert.rejects(
    assertTargetedAssessmentMutationAccess(nextSession, 1, assessment, { id: 70, role: "director" }),
    /belongs to a closed academic session/i,
  )
})

test("academic leadership keeps tenant-scoped creation access without a teacher assignment", async () => {
  const scope = await resolveTargetedAssessmentDraftScope(scopeDb({ assignments: [] }), 1, { id: 70, role: "director" }, {
    class_id: 20,
    subject_id: 10,
    topic_id: 70,
  })
  assert.equal(scope.classId, 20)
  assert.equal(scope.subjectId, 10)
  assert.equal(scope.academicYearId, 50)
  assert.equal(scope.termId, 40)
})

test("targeted assessment links resolve canonical in-tenant interventions and findings", async () => {
  const interventionLinks = await resolveTargetedAssessmentLinks(scopeDb(), 1, { id: 60, role: "teacher" }, {
    intervention_id: 90,
    intervention_ref: "intervention-ref",
    finding_ref: "alert-ref",
  }, targetedScope)
  assert.deepEqual(interventionLinks, {
    interventionId: 90,
    interventionRef: "intervention-ref",
    findingRef: "alert-ref",
    findingType: "alert",
  })

  const recommendationLinks = await resolveTargetedAssessmentLinks(scopeDb(), 1, { id: 70, role: "director" }, {
    finding_ref: "recommendation-ref",
  }, targetedScope)
  assert.equal(recommendationLinks.findingRef, "recommendation-ref")
  assert.equal(recommendationLinks.findingType, "recommendation")
})

test("intervention links cannot cross tenants or assessment scope", async () => {
  await assert.rejects(
    resolveTargetedAssessmentLinks(scopeDb({ interventions: [{ id: 90, school_id: 2, public_ref: "foreign-intervention", class_id: 20, subject_id: 10, topic_id: 70, term_id: 40 }] }), 1, { role: "director" }, { intervention_id: 90 }, targetedScope),
    /intervention does not belong to this school/i,
  )
  await assert.rejects(
    resolveTargetedAssessmentLinks(scopeDb(), 1, { role: "director" }, { intervention_id: 90, intervention_ref: "another-intervention" }, targetedScope),
    /ID and reference do not identify the same record/i,
  )
  for (const [patch, expected] of [
    [{ class_id: 21 }, /selected class/i],
    [{ subject_id: 11 }, /selected subject/i],
    [{ topic_id: 72 }, /selected syllabus topic/i],
    [{ term_id: 41 }, /current academic session/i],
  ]) {
    await assert.rejects(
      resolveTargetedAssessmentLinks(scopeDb({ interventions: [{ ...scopeDbDataIntervention(), ...patch }] }), 1, { role: "director" }, { intervention_id: 90 }, targetedScope),
      expected,
    )
  }
})

test("teachers cannot link another teacher's intervention", async () => {
  await assert.rejects(
    resolveTargetedAssessmentLinks(scopeDb({ interventions: [{ ...scopeDbDataIntervention(), assigned_teacher_id: 61 }] }), 1, { id: 60, role: "teacher" }, { intervention_id: 90 }, targetedScope),
    /interventions assigned to them/i,
  )
})

test("finding links must belong to the tenant and exact compatible academic scope", async () => {
  await assert.rejects(
    resolveTargetedAssessmentLinks(scopeDb({ alerts: [{ public_ref: "foreign-alert", school_id: 2, class_id: 20, subject_id: 10, topic_id: 71, term_id: 40 }] }), 1, { role: "director" }, { finding_ref: "foreign-alert" }, targetedScope),
    /finding does not belong to this school/i,
  )
  for (const [patch, expected] of [
    [{ class_id: 21 }, /selected class/i],
    [{ subject_id: 11 }, /selected subject/i],
    [{ topic_id: 72 }, /selected syllabus topic/i],
    [{ term_id: 41 }, /current academic session/i],
  ]) {
    await assert.rejects(
      resolveTargetedAssessmentLinks(scopeDb({ alerts: [{ public_ref: "alert-ref", school_id: 1, class_id: 20, subject_id: 10, topic_id: 71, term_id: 40, ...patch }] }), 1, { role: "director" }, { finding_ref: "alert-ref" }, targetedScope),
      expected,
    )
  }
})

test("mixed learner IDs and public references resolve first and dedupe by canonical student ID", async () => {
  const db = scopeDb()
  const learners = await resolveCanonicalTargetedLearners(db, 1, [
    { student_id: 30, reason: "numeric selection" },
    { student_ref: "student-ref", reason: "public reference selection" },
    { student_id: 30, student_ref: "student-ref", reason: "both forms" },
  ], { classId: 20, academicYearId: 50, termId: 40 })
  assert.equal(learners.length, 1)
  assert.equal(learners[0].student_id, 30)
  assert.equal(learners[0].student_ref, "student-ref")
  assert.equal(db.calls.filter(({ sql }) => /FROM student_enrollments/i.test(sql)).length, 1)
})

test("targeted learners must be active, tenant-owned and enrolled in the exact session", async () => {
  await assert.rejects(
    resolveCanonicalTargetedLearners(scopeDb({ students: [{ id: 30, school_id: 2, public_ref: "student-ref", status: "active" }] }), 1, [{ student_id: 30 }], { classId: 20, academicYearId: 50, termId: 40 }),
    /learner does not belong to this school/i,
  )
  await assert.rejects(
    resolveCanonicalTargetedLearners(scopeDb({ students: [{ id: 30, school_id: 1, public_ref: "student-ref", status: "withdrawn" }] }), 1, [{ student_id: 30 }], { classId: 20, academicYearId: 50, termId: 40 }),
    /learner must be active/i,
  )
  await assert.rejects(
    resolveCanonicalTargetedLearners(scopeDb({ enrollments: [] }), 1, [{ student_ref: "student-ref" }], { classId: 20, academicYearId: 50, termId: 40 }),
    /actively enrolled in the selected class and academic session/i,
  )
})

test("every generated targeted assessment mutation rechecks teacher scope", () => {
  const source = fs.readFileSync(path.join(root, "src/services/academicOperationsService.js"), "utf8")
  const names = [
    "generateTargetedAssessment",
    "saveTargetedAssessmentReview",
    "replaceTargetedAssessmentQuestion",
    "confirmTargetedLearners",
    "approveTargetedAssessment",
    "publishTargetedAssessment",
  ]
  for (const name of names) {
    const start = source.indexOf(`export async function ${name}`)
    const next = source.indexOf("export async function ", start + 1)
    const section = source.slice(start, next < 0 ? source.length : next)
    assert.ok(start >= 0, `missing targeted assessment mutation: ${name}`)
    assert.match(section, /generatedContext\([^\n]+\)\s*\n\s*await assertTargetedAssessmentMutationAccess\(/, `${name} must recheck the current session and teacher assignment`)
  }
})

test("draft inserts use only canonical intervention and finding links", () => {
  const source = fs.readFileSync(path.join(root, "src/services/academicOperationsService.js"), "utf8")
  const start = source.indexOf("export async function createTargetedAssessmentDraft")
  const end = source.indexOf("async function generatedContext", start)
  const create = source.slice(start, end)
  assert.match(create, /const links = await resolveTargetedAssessmentLinks/)
  assert.match(create, /\[ref, schoolId, links\.findingRef, links\.interventionId, academicYearId, termId/)
  assert.doesNotMatch(create, /\[ref, schoolId, body\.finding_ref[^\]]+body\.intervention_id/)
})

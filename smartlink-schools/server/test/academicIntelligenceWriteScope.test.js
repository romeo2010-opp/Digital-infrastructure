import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  assertAcademicActorWriteScope,
  validateAcademicInterventionScope,
  validateRemediationPackScope,
} from "../src/services/academicIntelligenceEngine.js"

function scopeDb(overrides = {}) {
  const data = {
    subjects: [{ id: 10, school_id: 1 }],
    classes: [{ id: 20, school_id: 1, grade_level: "Year 6" }],
    students: [{ id: 30, school_id: 1, class_id: 20, status: "active" }],
    terms: [{ id: 40, school_id: 1, academic_year_id: 50, status: "open" }],
    users: [{ id: 60, school_id: 1, role: "teacher", is_active: 1, employment_status: "active" }],
    topics: [{ id: 70, school_id: 1, subject_id: 10, curriculum_id: 1, grade_id: null, parent_topic_id: null, topic_name: "Fractions", is_active: 1 }],
    grades: [{ id: 5, school_id: 1, curriculum_id: 1, name: "Year 6" }],
    enrollments: [{ id: 1, school_id: 1, student_id: 30, class_id: 20, term_id: 40, academic_year_id: 50, enrollment_status: "active" }],
    assignments: [{ id: 1, school_id: 1, teacher_id: 60, class_id: 20, subject_id: 10, term_id: 40, academic_year_id: 50, role: "subject_teacher", is_active: 1 }],
    recommendations: [{ id: 80, school_id: 1, student_id: 30, class_id: 20, subject_id: 10, topic_id: 70, term_id: 40 }],
    interventions: [{ id: 90, school_id: 1, student_id: 30, class_id: 20, subject_id: 10, topic_id: 70, term_id: 40, assigned_teacher_id: 60 }],
    ...overrides,
  }
  const writes = []
  return {
    writes,
    async query(source, params = []) {
      const sql = String(source).replace(/\s+/g, " ").trim()
      if (!/^SELECT\b/i.test(sql)) {
        writes.push({ sql, params })
        throw new Error(`Unexpected write in validation test: ${sql}`)
      }
      if (/ FROM subjects /i.test(` ${sql} `)) {
        return [data.subjects.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM classes /i.test(` ${sql} `)) {
        return [data.classes.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM students /i.test(` ${sql} `)) {
        return [data.students.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM terms /i.test(` ${sql} `)) {
        return [data.terms.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM academic_years academic_year /i.test(` ${sql} `)) {
        const term = data.terms.find((row) => row.school_id === Number(params[0]) && ["open", "marking"].includes(row.status)) || data.terms[0]
        return [term ? [{ academic_year_id: term.academic_year_id, term_id: term.id }] : []]
      }
      if (/ FROM users /i.test(` ${sql} `)) {
        return [data.users.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]) && Number(row.is_active) === 1 && row.employment_status === "active")]
      }
      if (/ FROM syllabus_topics /i.test(` ${sql} `)) {
        const ids = params.slice(2).map(Number)
        return [data.topics.filter((row) => row.school_id === Number(params[0]) && row.subject_id === Number(params[1]) && ids.includes(Number(row.id)) && Number(row.is_active) === 1)]
      }
      if (/ FROM grade_levels /i.test(` ${sql} `)) {
        return [data.grades.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]) && row.name === String(params[2]))]
      }
      if (/ FROM student_enrollments /i.test(` ${sql} `)) {
        const [schoolId, studentId, classFilter, classId, termFilter, termId, yearFilter, yearId] = params.map((value) => value === null ? null : Number(value))
        return [data.enrollments.filter((row) => row.school_id === schoolId && row.student_id === studentId && row.enrollment_status === "active"
          && (classFilter === null || row.class_id === classId) && (termFilter === null || row.term_id === termId)
          && (yearFilter === null || row.academic_year_id === yearId))]
      }
      if (/ FROM teacher_class_subject_assignments /i.test(` ${sql} `)) {
        if (/teacher_id=\? AND class_id=\? AND subject_id=\?/i.test(sql)) {
          const [schoolId, teacherId, classId, subjectId, academicYearId, termId] = params.map((value) => value === null ? null : Number(value))
          return [data.assignments.filter((row) => row.school_id === schoolId && row.teacher_id === teacherId && row.class_id === classId && row.subject_id === subjectId
            && row.role === "subject_teacher" && Number(row.is_active) === 1
            && row.academic_year_id === academicYearId && row.term_id === termId)]
        }
        const [schoolId, teacherId, subjectId, classFilter, classId, yearFilter, yearId, termFilter, termId] = params.map((value) => value === null ? null : Number(value))
        return [data.assignments.filter((row) => row.school_id === schoolId && row.teacher_id === teacherId && row.subject_id === subjectId && row.role === "subject_teacher" && Number(row.is_active) === 1
          && (classFilter === null || row.class_id === classId)
          && (yearFilter === null || row.academic_year_id === null || row.academic_year_id === yearId)
          && (termFilter === null || row.term_id === null || row.term_id === termId))]
      }
      if (/ FROM academic_recommendations /i.test(` ${sql} `)) {
        return [data.recommendations.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM academic_interventions /i.test(` ${sql} `)) {
        return [data.interventions.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      throw new Error(`Unhandled validation query: ${sql}`)
    },
  }
}

test("academic interventions normalize and validate one coherent tenant scope", async () => {
  const db = scopeDb()
  const scope = await validateAcademicInterventionScope(db, 1, {
    student_id: "30",
    class_id: "20",
    subject_id: "10",
    topic_id: "70",
    term_id: "40",
    assigned_teacher_id: "60",
  })
  assert.deepEqual(
    { studentId: scope.studentId, classId: scope.classId, subjectId: scope.subjectId, topicId: scope.topicId, termId: scope.termId, teacherId: scope.teacherId },
    { studentId: 30, classId: 20, subjectId: 10, topicId: 70, termId: 40, teacherId: 60 },
  )
  assert.equal(db.writes.length, 0)
})

test("academic intervention references cannot cross tenants or subject boundaries", async () => {
  const crossTenantCases = [
    [{ subjects: [{ id: 10, school_id: 2 }] }, { subject_id: 10 }, /subject does not belong to this school/i],
    [{ classes: [{ id: 20, school_id: 2 }] }, { subject_id: 10, class_id: 20 }, /class does not belong to this school/i],
    [{ students: [{ id: 30, school_id: 2, class_id: 20 }] }, { subject_id: 10, student_id: 30 }, /learner does not belong to this school/i],
    [{ terms: [{ id: 40, school_id: 2, academic_year_id: 50 }] }, { subject_id: 10, term_id: 40 }, /term does not belong to this school/i],
    [{ users: [{ id: 60, school_id: 2, is_active: 1, employment_status: "active" }] }, { subject_id: 10, assigned_teacher_id: 60 }, /teacher is not an active user in this school/i],
  ]
  for (const [overrides, body, expected] of crossTenantCases) {
    await assert.rejects(validateAcademicInterventionScope(scopeDb(overrides), 1, body), expected)
  }
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ topics: [{ id: 70, school_id: 1, subject_id: 11, is_active: 1 }] }), 1, { subject_id: 10, topic_id: 70 }),
    /topic does not belong to this school and subject/i,
  )
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb(), 1, { subject_id: 10, class_id: 20, student_id: "not-an-id" }),
    /learner is invalid/i,
  )
})

test("learner enrollment and teacher assignment must match the intervention class and term", async () => {
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ enrollments: [{ id: 1, school_id: 1, student_id: 30, class_id: 21, term_id: 40, enrollment_status: "active" }] }), 1, {
      subject_id: 10, student_id: 30, class_id: 20, term_id: 40,
    }),
    /not actively enrolled in the selected class and term/i,
  )
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ assignments: [{ id: 1, school_id: 1, teacher_id: 60, class_id: 20, subject_id: 11, term_id: 40, academic_year_id: 50, is_active: 1 }] }), 1, {
      subject_id: 10, class_id: 20, term_id: 40, assigned_teacher_id: 60,
    }),
    /teacher is not assigned to the selected class, subject and term/i,
  )
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ enrollments: [{ id: 1, school_id: 1, student_id: 30, class_id: 20, term_id: 40, academic_year_id: 51, enrollment_status: "active" }] }), 1, {
      subject_id: 10, student_id: 30, class_id: 20, term_id: 40,
    }),
    /not actively enrolled in the selected class and term/i,
  )
})

test("learners must be active and enrolled even when a class or term is omitted", async () => {
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ students: [{ id: 30, school_id: 1, class_id: 20, status: "withdrawn" }] }), 1, {
      subject_id: 10, student_id: 30,
    }),
    /learner is not active/i,
  )
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({ enrollments: [] }), 1, { subject_id: 10, student_id: 30 }),
    /does not have an active enrollment/i,
  )
})

test("a class-scoped topic must match the class year level", async () => {
  await assert.rejects(
    validateAcademicInterventionScope(scopeDb({
      topics: [{ id: 70, school_id: 1, subject_id: 10, curriculum_id: 1, grade_id: 5, parent_topic_id: null, topic_name: "Fractions", is_active: 1 }],
      grades: [{ id: 5, school_id: 1, curriculum_id: 1, name: "Year 7" }],
    }), 1, { subject_id: 10, class_id: 20, topic_id: 70 }),
    /topic does not belong to the selected class year level/i,
  )
})

test("teacher actors can write only within their exact active class-subject assignment", async () => {
  const db = scopeDb()
  const allowed = await assertAcademicActorWriteScope(db, 1, { id: 60, role: "teacher" }, {
    classId: 20, subjectId: 10, termId: 40, term: { academic_year_id: 50 }, teacherId: null,
  })
  assert.equal(allowed.assignedTeacherId, 60)
  assert.equal(allowed.academicYearId, 50)
  assert.equal(allowed.termId, 40)
  await assert.rejects(
    assertAcademicActorWriteScope(scopeDb(), 1, { id: 60, role: "teacher" }, { classId: 20, subjectId: 11 }),
    /only manage academic support for their assigned class and subject/i,
  )
  await assert.rejects(
    assertAcademicActorWriteScope(scopeDb(), 1, { id: 60, role: "teacher" }, { classId: 20, subjectId: 10, teacherId: 61 }),
    /cannot assign an academic intervention to another teacher/i,
  )
})

test("remediation packs inherit one consistent scope from tenant-owned linked records", async () => {
  const db = scopeDb()
  const scope = await validateRemediationPackScope(db, 1, {
    recommendation_id: 80,
    intervention_id: 90,
  })
  assert.deepEqual(
    { recommendationId: scope.recommendationId, interventionId: scope.interventionId, studentId: scope.studentId, classId: scope.classId, topicId: scope.topicId, termId: scope.termId, teacherId: scope.teacherId },
    { recommendationId: 80, interventionId: 90, studentId: 30, classId: 20, topicId: 70, termId: 40, teacherId: 60 },
  )
  assert.equal(db.writes.length, 0)
})

test("remediation links must belong to the tenant and share the selected scope", async () => {
  await assert.rejects(
    validateRemediationPackScope(scopeDb({ recommendations: [{ id: 80, school_id: 2, subject_id: 10 }] }), 1, { subject_id: 10, recommendation_id: 80 }),
    /recommendation does not belong to this school/i,
  )
  await assert.rejects(
    validateRemediationPackScope(scopeDb({ interventions: [{ id: 90, school_id: 2, subject_id: 10 }] }), 1, { subject_id: 10, intervention_id: 90 }),
    /intervention does not belong to this school/i,
  )
  await assert.rejects(
    validateRemediationPackScope(scopeDb({ interventions: [{ id: 90, school_id: 1, student_id: 31, class_id: 20, subject_id: 10, topic_id: 70, term_id: 40, assigned_teacher_id: 60 }] }), 1, {
      subject_id: 10, recommendation_id: 80, intervention_id: 90,
    }),
    /do not share the same learner/i,
  )
  await assert.rejects(
    validateRemediationPackScope(scopeDb(), 1, { subject_id: 10, topic_id: 71, recommendation_id: 80 }),
    /topic does not match the linked recommendation or intervention/i,
  )
})

test("teacher blueprint reads and writes use current exact class-subject scope", async () => {
  const [engine, controller] = await Promise.all([
    readFile(new URL("../src/services/academicIntelligenceEngine.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/academicIntelligenceController.js", import.meta.url), "utf8"),
  ])
  const createStart = engine.indexOf("export async function createAssessmentBlueprint")
  const listStart = engine.indexOf("export async function listAssessmentBlueprints", createStart)
  const remediationStart = engine.indexOf("export async function createRemediationPack", listStart)
  const create = engine.slice(createStart, listStart)
  const list = engine.slice(listStart, remediationStart)
  assert.match(create, /validateAcademicInterventionScope/)
  assert.match(create, /assertAcademicActorWriteScope/)
  assert.match(create, /requireActiveAcademicSession/)
  assert.match(create, /activeSession\.academicYearId/)
  assert.match(create, /activeSession\.termId/)
  assert.match(create, /academic_years WHERE school_id=\? AND id=\?/)
  assert.match(create, /LEFT JOIN grade_levels grade/)
  assert.match(create, /LOWER\(TRIM\(grade\.name\)\)=LOWER\(TRIM\(\?\)\)/)
  assert.match(list, /tcsa\.class_id=ab\.class_id AND tcsa\.subject_id=ab\.subject_id/)
  assert.match(list, /tcsa\.role='subject_teacher'/)
  assert.match(list, /current_term\.status IN \('open','marking'\)/)
  assert.match(list, /u\.id=ab\.created_by AND u\.school_id=ab\.school_id/)
  assert.match(controller, /listAssessmentBlueprints\(getScopedSchoolId\(req\),req\.user,req\.query\)/)
  const authoringStart = engine.indexOf("export async function getAcademicAuthoringSetup")
  const authoring = engine.slice(authoringStart, createStart)
  assert.match(authoring, /a\.role='subject_teacher'/)
  assert.match(authoring, /current_term\.status IN \('open','marking'\)/)
  const remediationStartIndex = engine.indexOf("export async function listRemediationPacks")
  const remediation = engine.slice(remediationStartIndex, engine.indexOf("export async function patchRemediationPack", remediationStartIndex))
  assert.match(remediation, /current_year\.is_active=1/)
  assert.match(remediation, /current_term\.status IN \('open','marking'\)/)
})

test("teacher command-centre insights are restricted to the current assignment session", async () => {
  const engine = await readFile(new URL("../src/services/academicIntelligenceEngine.js", import.meta.url), "utf8")
  const start = engine.indexOf("export async function getAcademicCommandCentre")
  const end = engine.indexOf("export async function getAcademicIntelligenceHistory", start)
  const commandCentre = engine.slice(start, end)
  assert.match(commandCentre, /teacherScopePredicate/)
  assert.match(commandCentre, /current_year\.is_active=1/)
  assert.match(commandCentre, /current_term\.status IN \('open','marking'\)/)
  assert.match(commandCentre, /tcsa\.academic_year_id=current_year\.id/)
  assert.match(commandCentre, /tcsa\.term_id=current_term\.id/)
  assert.doesNotMatch(commandCentre, /tcsa\.academic_year_id IS NULL/)
  assert.doesNotMatch(commandCentre, /tcsa\.term_id IS NULL/)
  assert.match(commandCentre, /academic_year_id: "cdr\.academic_year_id"/)
  assert.match(commandCentre, /academic_year_id: 'ers\.academic_year_id'/)
  assert.match(commandCentre, /grade_id: "q\.grade_id"/)
  const explanationStart = engine.indexOf("export async function getAcademicFindingExplanation")
  const explanationEnd = engine.indexOf("export async function queueAcademicRecalculation", explanationStart)
  const explanation = engine.slice(explanationStart, explanationEnd)
  assert.match(explanation, /JOIN academic_years current_year/)
  assert.match(explanation, /JOIN terms current_term/)
  assert.match(explanation, /scope\.academic_year_id, scope\.academic_year_id, scope\.term_id, scope\.term_id/)
})

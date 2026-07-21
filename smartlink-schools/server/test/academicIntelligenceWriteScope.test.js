import test from "node:test"
import assert from "node:assert/strict"
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
          const [schoolId, teacherId, classId, subjectId, yearFilter, yearId, termFilter, termId] = params.map((value) => value === null ? null : Number(value))
          return [data.assignments.filter((row) => row.school_id === schoolId && row.teacher_id === teacherId && row.class_id === classId && row.subject_id === subjectId
            && row.role === "subject_teacher" && Number(row.is_active) === 1
            && (yearFilter === null || row.academic_year_id === null || row.academic_year_id === yearId)
            && (termFilter === null || row.term_id === null || row.term_id === termId))]
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

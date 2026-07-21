import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateTeachingResourceRequestWriteScope,
  validateTeachingResourceWriteScope,
} from '../src/services/libraryClassroomService.js'

function scopeDb(overrides = {}) {
  const data = {
    subjects: [{ id: 10, school_id: 1, public_ref: 'subject-10' }],
    classes: [{ id: 20, school_id: 1, public_ref: 'class-20', grade_level: 'Form 2' }],
    gradeLevels: [{ id: 200, school_id: 1, name: 'Form 2', curriculum_id: 100 }],
    curricula: [{ id: 100, school_id: 1 }],
    academicYears: [{ id: 300, school_id: 1 }],
    terms: [{ id: 400, school_id: 1, academic_year_id: 300 }],
    topics: [
      { id: 30, school_id: 1, public_ref: 'topic-30', subject_id: 10, curriculum_id: 100, grade_id: 200, parent_topic_id: null, topic_name: 'Maps', is_active: 1 },
      { id: 31, school_id: 1, public_ref: 'topic-31', subject_id: 10, curriculum_id: 100, grade_id: 200, parent_topic_id: 30, topic_name: 'Map scales', is_active: 1 },
      { id: 32, school_id: 1, public_ref: 'topic-32', subject_id: 10, curriculum_id: 100, grade_id: 200, parent_topic_id: null, topic_name: 'Weather', is_active: 1 },
    ],
    objectives: [{ id: 40, school_id: 1, subject_id: 10, topic_id: 31, is_active: 1 }],
    ...overrides,
  }
  const writes = []
  return {
    writes,
    async query(source, params = []) {
      const sql = String(source).replace(/\s+/g, ' ').trim()
      if (!/^SELECT\b/i.test(sql)) {
        writes.push({ sql, params })
        throw new Error(`Unexpected write in validation test: ${sql}`)
      }
      if (/ FROM classes c /i.test(` ${sql} `)) {
        const row = data.classes.find((item) => item.school_id === Number(params[0]) && item.id === Number(params[1]))
        if (!row) return [[]]
        const grade = data.gradeLevels.find((item) => item.school_id === row.school_id && item.name === row.grade_level)
        return [[{ ...row, grade_id: grade?.id || null, grade_curriculum_id: grade?.curriculum_id || null }]]
      }
      if (/ FROM classes /i.test(` ${sql} `) && /public_ref/i.test(sql)) {
        return [data.classes.filter((row) => row.school_id === Number(params[0]) && row.public_ref === String(params[1]))]
      }
      if (/ FROM subjects /i.test(` ${sql} `) && /public_ref/i.test(sql)) {
        return [data.subjects.filter((row) => row.school_id === Number(params[0]) && row.public_ref === String(params[1]))]
      }
      if (/ FROM syllabus_topics /i.test(` ${sql} `) && /public_ref/i.test(sql)) {
        return [data.topics.filter((row) => row.school_id === Number(params[0]) && row.public_ref === String(params[1]))]
      }
      if (/ FROM subjects /i.test(` ${sql} `)) {
        return [data.subjects.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM curricula /i.test(` ${sql} `)) {
        return [data.curricula.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM academic_years /i.test(` ${sql} `)) {
        return [data.academicYears.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM terms /i.test(` ${sql} `)) {
        return [data.terms.filter((row) => row.school_id === Number(params[0]) && row.id === Number(params[1]))]
      }
      if (/ FROM syllabus_topics /i.test(` ${sql} `)) {
        const ids = params.slice(2).map(Number)
        return [data.topics.filter((row) => row.school_id === Number(params[0]) && row.subject_id === Number(params[1])
          && ids.includes(Number(row.id)) && Number(row.is_active) === 1)]
      }
      if (/ FROM learning_objectives lo /i.test(` ${sql} `)) {
        return [data.objectives.flatMap((objective) => {
          const topic = data.topics.find((row) => row.id === objective.topic_id && row.school_id === objective.school_id && row.subject_id === objective.subject_id)
          return objective.school_id === Number(params[0]) && objective.id === Number(params[1]) && objective.subject_id === Number(params[2])
            && Number(objective.is_active) === 1 && topic
            ? [{ ...objective, curriculum_id: topic.curriculum_id, grade_id: topic.grade_id }]
            : []
        })]
      }
      throw new Error(`Unhandled validation query: ${sql}`)
    },
  }
}

test('teaching resource scope validates and normalizes every legacy identifier', async () => {
  const db = scopeDb()
  const scope = await validateTeachingResourceWriteScope(db, 1, {
    subject_id: '10',
    class_id: '20',
    curriculum_id: '100',
    topic_id: '30',
    subtopic_id: '31',
    learning_objective_id: '40',
    academic_year_id: '300',
    term_id: '400',
  })
  assert.deepEqual(
    {
      subjectId: scope.subjectId,
      classId: scope.classId,
      curriculumId: scope.curriculumId,
      topicId: scope.topicId,
      subtopicId: scope.subtopicId,
      objectiveId: scope.objectiveId,
      academicYearId: scope.academicYearId,
      termId: scope.termId,
    },
    { subjectId: 10, classId: 20, curriculumId: 100, topicId: 30, subtopicId: 31, objectiveId: 40, academicYearId: 300, termId: 400 },
  )
  assert.equal(db.writes.length, 0)
})

test('teaching resource identifiers cannot cross the school boundary', async () => {
  const cases = [
    [{ subjects: [{ id: 10, school_id: 2 }] }, { subject_id: 10 }, /subject does not belong to this school/i],
    [{ classes: [{ id: 20, school_id: 2 }] }, { class_id: 20 }, /class does not belong to this school/i],
    [{ curricula: [{ id: 100, school_id: 2 }] }, { curriculum_id: 100 }, /curriculum does not belong to this school/i],
    [{ academicYears: [{ id: 300, school_id: 2 }] }, { academic_year_id: 300 }, /academic year does not belong to this school/i],
    [{ terms: [{ id: 400, school_id: 2, academic_year_id: 300 }] }, { term_id: 400 }, /term does not belong to this school/i],
    [{ topics: [{ id: 30, school_id: 2, subject_id: 10, is_active: 1 }] }, { subject_id: 10, topic_id: 30 }, /topic does not belong to this school and subject/i],
    [{ objectives: [{ id: 40, school_id: 2, subject_id: 10, topic_id: 31, is_active: 1 }] }, { subject_id: 10, learning_objective_id: 40 }, /objective does not belong to this school and subject/i],
  ]
  for (const [overrides, body, expected] of cases) {
    await assert.rejects(validateTeachingResourceWriteScope(scopeDb(overrides), 1, body), expected)
  }
  await assert.rejects(validateTeachingResourceWriteScope(scopeDb(), 1, { class_id: 'not-an-id' }), /class is invalid/i)
})

test('teaching resource relationships must share topic hierarchy, grade, curriculum and academic year', async () => {
  await assert.rejects(
    validateTeachingResourceWriteScope(scopeDb({ topics: [
      { id: 30, school_id: 1, subject_id: 10, curriculum_id: 100, grade_id: 200, parent_topic_id: null, is_active: 1 },
      { id: 31, school_id: 1, subject_id: 10, curriculum_id: 100, grade_id: 200, parent_topic_id: 32, is_active: 1 },
    ] }), 1, { subject_id: 10, topic_id: 30, subtopic_id: 31 }),
    /subtopic does not belong to the selected main topic/i,
  )
  await assert.rejects(
    validateTeachingResourceWriteScope(scopeDb({ gradeLevels: [
      { id: 200, school_id: 1, name: 'Form 2', curriculum_id: 100 },
      { id: 201, school_id: 1, name: 'Form 3', curriculum_id: 100 },
    ], topics: [{ id: 30, school_id: 1, subject_id: 10, curriculum_id: 100, grade_id: 201, parent_topic_id: null, is_active: 1 }] }), 1, {
      subject_id: 10, class_id: 20, topic_id: 30,
    }),
    /does not belong to the selected class level/i,
  )
  await assert.rejects(
    validateTeachingResourceWriteScope(scopeDb({ topics: [{ id: 30, school_id: 1, subject_id: 10, curriculum_id: 101, grade_id: 200, parent_topic_id: null, is_active: 1 }] }), 1, {
      subject_id: 10, curriculum_id: 100, topic_id: 30,
    }),
    /does not belong to the selected curriculum/i,
  )
  await assert.rejects(
    validateTeachingResourceWriteScope(scopeDb({ terms: [{ id: 400, school_id: 1, academic_year_id: 301 }] }), 1, { academic_year_id: 300, term_id: 400 }),
    /term does not belong to the selected academic year/i,
  )
  await assert.rejects(
    validateTeachingResourceWriteScope(scopeDb({ objectives: [{ id: 40, school_id: 1, subject_id: 10, topic_id: 32, is_active: 1 }] }), 1, {
      subject_id: 10, topic_id: 30, learning_objective_id: 40,
    }),
    /objective does not belong to the selected topic or subtopic/i,
  )
})

test('resource requests resolve tenant-owned refs and validate topic subject and class scope', async () => {
  const db = scopeDb()
  const scope = await validateTeachingResourceRequestWriteScope(db, 1, {
    class_ref: 'class-20',
    subject_ref: 'subject-10',
    topic_ref: 'topic-30',
  })
  assert.deepEqual(
    { classId: scope.classId, subjectId: scope.subjectId, topicId: scope.topicId },
    { classId: 20, subjectId: 10, topicId: 30 },
  )
  assert.equal(db.writes.length, 0)

  await assert.rejects(
    validateTeachingResourceRequestWriteScope(scopeDb({ topics: [{ id: 30, school_id: 1, public_ref: 'topic-30', subject_id: 11, is_active: 1 }] }), 1, {
      subject_ref: 'subject-10', topic_ref: 'topic-30',
    }),
    /topic does not belong to this school and subject/i,
  )
  await assert.rejects(
    validateTeachingResourceRequestWriteScope(scopeDb(), 1, { class_id: 21, class_ref: 'class-20' }),
    /class identifiers do not match/i,
  )
  await assert.rejects(
    validateTeachingResourceRequestWriteScope(scopeDb(), 1, { topic_ref: 'missing-topic', subject_ref: 'subject-10' }),
    /topic does not belong to this school/i,
  )
})

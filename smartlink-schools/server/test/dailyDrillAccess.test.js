import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  assertDrillLearnerAccess,
  assertDrillSessionAccess,
  drillActorScopeSql,
  getTeacherSubjectIdsForClass,
} from "../src/services/drills/drillAccessService.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function relationshipDb({ teacherAssignments = [], guardianLinked = false, session = null } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM teacher_class_subject_assignments tcsa") && !sql.includes("JOIN teacher_class_subject_assignments")) {
        return [teacherAssignments.map((row) => ({ subject_id: row.subject_id }))]
      }
      if (sql.includes("JOIN teacher_class_subject_assignments tcsa")) return [teacherAssignments]
      if (sql.includes("FROM student_guardians sg")) return guardianLinked ? [[{ id: 91 }]] : [[]]
      if (sql.includes("FROM drill_sessions")) return session ? [[session]] : [[]]
      throw new Error(`Unexpected query in Daily Drill access test: ${sql}`)
    },
  }
}

test("Daily Drill list scope requires an exact active teacher class and subject pair", () => {
  const scope = drillActorScopeSql({ id: 17, role: "teacher" })
  assert.match(scope.clause, /drill_tcsa\.class_id = se\.class_id/)
  assert.match(scope.clause, /drill_tcsa\.subject_id = ds\.subject_id/)
  assert.match(scope.clause, /drill_tcsa\.role = 'subject_teacher'/)
  assert.match(scope.clause, /drill_tcsa\.is_active = 1/)
  assert.match(scope.clause, /drill_tcsa\.academic_year_id = se\.academic_year_id/)
  assert.match(scope.clause, /drill_tcsa\.term_id = se\.term_id/)
  assert.doesNotMatch(scope.clause, /academic_year_id IS NULL/)
  assert.doesNotMatch(scope.clause, /term_id IS NULL/)
  assert.deepEqual(scope.params, [17])
})

test("Daily Drill list scope restricts parents to canonically linked learners", () => {
  const scope = drillActorScopeSql({ id: 23, role: "parent" })
  assert.match(scope.clause, /FROM student_guardians drill_guardian/)
  assert.match(scope.clause, /drill_guardian\.student_id = ds\.student_id/)
  assert.match(scope.clause, /drill_guardian\.user_id = \?/)
  assert.deepEqual(scope.params, [23])
})

test("teacher learner access returns only actively assigned subjects and rejects another subject", async () => {
  const db = relationshipDb({ teacherAssignments: [{ class_id: 8, subject_id: 12 }] })
  const access = await assertDrillLearnerAccess({
    db,
    actor: { id: 17, role: "teacher" },
    schoolId: 3,
    studentId: 44,
    academicYearId: 6,
    termId: 9,
  })
  assert.deepEqual(access.classIds, [8])
  assert.deepEqual(access.allowedSubjectIds, [12])

  await assert.rejects(
    assertDrillLearnerAccess({
      db: relationshipDb(),
      actor: { id: 17, role: "teacher" },
      schoolId: 3,
      studentId: 44,
      subjectId: 99,
      academicYearId: 6,
      termId: 9,
      action: "answer",
    }),
    (error) => error?.status === 403,
  )
})

test("parents can read only linked learner drills and can never mutate them", async () => {
  const actor = { id: 23, role: "parent" }
  await assert.doesNotReject(assertDrillLearnerAccess({
    db: relationshipDb({ guardianLinked: true }),
    actor,
    schoolId: 3,
    studentId: 44,
    action: "summary",
  }))
  await assert.rejects(
    assertDrillLearnerAccess({ db: relationshipDb(), actor, schoolId: 3, studentId: 44, action: "view" }),
    (error) => error?.status === 403,
  )
  await assert.rejects(
    assertDrillLearnerAccess({ db: relationshipDb({ guardianLinked: true }), actor, schoolId: 3, studentId: 44, action: "submit" }),
    (error) => error?.status === 403,
  )
})

test("learner self-access and leadership access remain intact", async () => {
  await assert.doesNotReject(assertDrillLearnerAccess({
    db: relationshipDb(),
    actor: { id: 70, studentId: 44, role: "student" },
    schoolId: 3,
    studentId: 44,
    action: "answer",
  }))
  await assert.rejects(
    assertDrillLearnerAccess({
      db: relationshipDb(),
      actor: { id: 70, studentId: 44, role: "student" },
      schoolId: 3,
      studentId: 45,
      action: "view",
    }),
    (error) => error?.status === 403,
  )
  for (const role of ["school_owner", "director", "owner", "headteacher", "super_admin"]) {
    const access = await assertDrillLearnerAccess({
      db: relationshipDb(),
      actor: { id: 1, role },
      schoolId: 3,
      studentId: 44,
      action: "view",
    })
    assert.equal(access.unrestricted, true)
  }
})

test("session access binds the drill subject to the teacher relationship", async () => {
  const db = relationshipDb({
    session: { id: 101, student_id: 44, subject_id: 12, status: "pending" },
    teacherAssignments: [{ class_id: 8, subject_id: 12 }],
  })
  const access = await assertDrillSessionAccess({
    db,
    actor: { id: 17, role: "teacher" },
    schoolId: 3,
    sessionId: 101,
    academicYearId: 6,
    termId: 9,
    action: "submit",
  })
  assert.equal(access.session.subject_id, 12)
  assert.deepEqual(access.allowedSubjectIds, [12])
})

test("class drill generation uses subject-teacher assignments only", async () => {
  let assignmentSql = ""
  let assignmentParams = []
  const base = relationshipDb({ teacherAssignments: [{ subject_id: 12 }, { subject_id: 12 }, { subject_id: 14 }] })
  const db = {
    async query(sql, params) {
      assignmentSql = sql
      assignmentParams = params
      return base.query(sql, params)
    },
  }
  const ids = await getTeacherSubjectIdsForClass({
    db,
    schoolId: 3,
    teacherId: 17,
    classId: 8,
    academicYearId: 6,
    termId: 9,
  })
  assert.deepEqual(ids, [12, 14])
  assert.match(assignmentSql, /tcsa\.academic_year_id = \?/)
  assert.match(assignmentSql, /tcsa\.term_id = \?/)
  assert.doesNotMatch(assignmentSql, /academic_year_id IS NULL/)
  assert.doesNotMatch(assignmentSql, /term_id IS NULL/)
  assert.deepEqual(assignmentParams, [3, 17, 8, 6, 9])
})

test("Daily Drill controller and generator apply relationship scope on every workflow", () => {
  const controller = fs.readFileSync(path.join(root, "src/controllers/drillsController.js"), "utf8")
  const generator = fs.readFileSync(path.join(root, "src/services/drills/dailyDrillGenerator.js"), "utf8")
  assert.match(controller, /const actorScope = drillActorScopeSql\(req\.user\)/)
  assert.match(controller, /action: "generate"/)
  assert.match(controller, /action: "answer"/)
  assert.match(controller, /action: "submit"/)
  assert.match(controller, /action: "history"/)
  assert.match(controller, /action: "summary"/)
  assert.match(controller, /allowedSubjectIds: access\.allowedSubjectIds/)
  assert.ok((controller.match(/academicYearId: (?:session|activeSession)/g) || []).length >= 3)
  assert.ok((controller.match(/termId: (?:session|activeSession)/g) || []).length >= 3)
  assert.ok((controller.match(/se\.academic_year_id = \? AND se\.term_id = \?/g) || []).length >= 6)
  assert.match(controller, /const teacherSubjectIds = await teacherSubjectScope/)
  assert.match(controller, /!\["student", "parent"\]\.includes/)
  assert.match(generator, /Array\.isArray\(options\.allowedSubjectIds\)/)
  assert.match(generator, /resolveStudentProfile\(connection, schoolId, studentId, options\.academicYearId, options\.termId\)/)
  assert.match(generator, /se\.academic_year_id = \? AND se\.term_id = \?/)
  assert.match(generator, /q\.subject_id IN/)
  assert.match(generator, /subject_id IN/)
})

import test from "node:test"
import assert from "node:assert/strict"
import { validateSupportCaseOwner } from "../src/services/academicSupportService.js"

function ownerDb({ user, assignments = [], primaryClassTeacherId = null } = {}) {
  return {
    async query(source, params = []) {
      const sql = String(source).replace(/\s+/g, " ").trim()
      if (/ FROM users /i.test(` ${sql} `)) {
        const allowed = ["school_owner", "director", "owner", "headteacher", "teacher"]
        return [[user && user.school_id === Number(params[0]) && user.id === Number(params[1])
          && allowed.includes(user.role) && user.is_active === 1 && user.employment_status === "active" ? user : null].filter(Boolean)]
      }
      if (/ FROM teacher_class_subject_assignments /i.test(` ${sql} `)) {
        const [schoolId, teacherId, classId, subjectPresent, subjectId, yearId, termId] = params.map((value) => value === null ? null : Number(value))
        return [assignments.filter((row) => row.school_id === schoolId && row.teacher_id === teacherId && row.class_id === classId && row.is_active === 1
          && ((row.role === "subject_teacher" && subjectPresent !== null && row.subject_id === subjectId) || row.role === "class_teacher")
          && yearId !== null && termId !== null
          && row.academic_year_id === yearId
          && row.term_id === termId)]
      }
      if (/ FROM classes /i.test(` ${sql} `)) {
        return [primaryClassTeacherId === Number(params[2]) ? [{ id: Number(params[1]) }] : []]
      }
      throw new Error(`Unhandled owner validation query: ${sql}`)
    },
  }
}

const record = { class_id: 20, subject_id: 10, academic_year_id: 50, current_term_id: 40 }

test("learner-support ownership accepts academic leaders but rejects parent and student accounts", async () => {
  const headteacher = { id: 2, school_id: 1, role: "headteacher", role_type: "headteacher", is_active: 1, employment_status: "active" }
  assert.equal((await validateSupportCaseOwner(ownerDb({ user: headteacher }), 1, record, 2)).id, 2)
  for (const role of ["parent", "student", "bursar", "librarian"]) {
    const user = { id: 3, school_id: 1, role, role_type: "teacher", is_active: 1, employment_status: "active" }
    await assert.rejects(validateSupportCaseOwner(ownerDb({ user }), 1, record, 3), /active academic staff member/i)
  }
})

test("ordinary teacher owners require the case class-subject or class-teacher relationship", async () => {
  const teacher = { id: 4, school_id: 1, role: "teacher", role_type: "teacher", is_active: 1, employment_status: "active" }
  const assignment = { school_id: 1, teacher_id: 4, class_id: 20, subject_id: 10, role: "subject_teacher", academic_year_id: 50, term_id: 40, is_active: 1 }
  assert.equal((await validateSupportCaseOwner(ownerDb({ user: teacher, assignments: [assignment] }), 1, record, 4)).id, 4)
  await assert.rejects(
    validateSupportCaseOwner(ownerDb({ user: teacher, assignments: [{ ...assignment, subject_id: 11 }] }), 1, record, 4),
    /not assigned to this learner-support class and subject/i,
  )
  await assert.rejects(
    validateSupportCaseOwner(ownerDb({ user: teacher, assignments: [{ ...assignment, academic_year_id: null, term_id: null }] }), 1, record, 4),
    /not assigned to this learner-support class and subject/i,
  )
  await assert.rejects(
    validateSupportCaseOwner(ownerDb({ user: teacher, assignments: [{ ...assignment, academic_year_id: null, term_id: null }] }), 1, { ...record, academic_year_id: null, current_term_id: null }, 4),
    /not assigned to this learner-support class and subject/i,
  )
})

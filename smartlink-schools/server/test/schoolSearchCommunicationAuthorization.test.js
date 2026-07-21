import test from "node:test"
import assert from "node:assert/strict"
import { interpretAwareSearch } from "../src/services/awareSearchService.js"
import { buildCalendarSearchScope, searchSchoolRecords } from "../src/services/schoolSearchService.js"
import { sendFeeReminder } from "../src/services/operationalCommunicationService.js"

const calendarIntent = () => interpretAwareSearch("calendar events")
const activeSession = { setupRequired: false, academicYearId: 12, termId: 34 }

test("calendar search roles and teacher event scope match calendar access", () => {
  assert.deepEqual(buildCalendarSearchScope({ user: { id: 8, role: "bursar" }, teacherClassIds: [4], session: activeSession }), { allowed: false, sql: "", params: [] })
  assert.deepEqual(buildCalendarSearchScope({ user: { id: 8, role: "librarian" }, teacherClassIds: [4], session: activeSession }), { allowed: false, sql: "", params: [] })
  assert.deepEqual(buildCalendarSearchScope({ user: { id: 8, role: "headteacher" }, teacherClassIds: null, session: activeSession }), { allowed: true, sql: "", params: [] })

  const teacher = buildCalendarSearchScope({ user: { id: 8, role: "teacher" }, teacherClassIds: [4, 4, 9], session: activeSession })
  assert.equal(teacher.allowed, true)
  assert.match(teacher.sql, /se\.visibility IN \('whole_school','teachers_only','staff_only'\)/)
  assert.match(teacher.sql, /se\.teacher_id=\?/)
  assert.match(teacher.sql, /se\.created_by=\?/)
  assert.match(teacher.sql, /se\.class_id IN \(\?,\?\).*se\.subject_id IS NULL/)
  assert.match(teacher.sql, /calendar_assignment\.class_id=se\.class_id/)
  assert.match(teacher.sql, /calendar_assignment\.subject_id=se\.subject_id/)
  assert.match(teacher.sql, /calendar_assignment\.role='subject_teacher'/)
  assert.match(teacher.sql, /calendar_assignment\.academic_year_id=\?/)
  assert.match(teacher.sql, /calendar_assignment\.term_id=\?/)
  assert.deepEqual(teacher.params, [8, 8, 4, 9, 8, 12, 34])
})

test("roles without calendar access receive neither calendar records nor navigation", async () => {
  let queryCount = 0
  const result = await searchSchoolRecords({
    db: { query: async () => { queryCount += 1; return [[]] } },
    schoolId: 3,
    session: activeSession,
    user: { id: 18, role: "bursar" },
    teacherClassIds: null,
    permissions: [],
    interpretation: calendarIntent(),
    limit: 10,
  })
  assert.equal(queryCount, 0)
  assert.deepEqual(result.results, [])
  assert.deepEqual(result.groups, [])
})

test("teacher calendar search excludes non-public lifecycle states and applies assignment SQL", async () => {
  const calls = []
  await searchSchoolRecords({
    db: { query: async (sql, params) => { calls.push({ sql, params }); return [[]] } },
    schoolId: 3,
    session: activeSession,
    user: { id: 8, role: "teacher" },
    teacherClassIds: [4, 9],
    permissions: [],
    interpretation: calendarIntent(),
    limit: 10,
  })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /se\.status IN \('scheduled','active','completed'\)/)
  assert.match(calls[0].sql, /calendar_assignment\.teacher_id=\?/)
  assert.deepEqual(calls[0].params, [3, 8, 8, 4, 9, 8, 12, 34, 100])
})

function feeDependencies(row, whatsapp = null) {
  const calls = { notifications: [], whatsapp: [], tasks: [], audits: [] }
  return {
    calls,
    dependencies: {
      db: { query: async () => [[row]] },
      createInAppNotification: async (payload) => { calls.notifications.push(payload); return { publicId: "notification-1" } },
      queueWhatsAppMessage: async (payload) => { calls.whatsapp.push(payload); return whatsapp || { status: "queued", reason: null } },
      createDirectorTask: async (...args) => { calls.tasks.push(args); return { id: 1 } },
      safeAudit: async (...args) => { calls.audits.push(args) },
    },
  }
}

const feeRow = (overrides = {}) => ({ id: 77, public_ref: "student-ref", student_name: "Lindiwe Phiri", guardian_name: "Mary Phiri", guardian_phone: "+265999000111", guardian_user_id: 55, school_name: "Reign Academy", balance: 125000, ...overrides })

test("in-app fee reminders create a real guardian notification", async () => {
  const { calls, dependencies } = feeDependencies(feeRow())
  const result = await sendFeeReminder(3, 8, { student_ref: "student-ref", channel: "in_app", message: "Fee balance reminder" }, dependencies)
  assert.equal(calls.notifications.length, 1)
  assert.equal(calls.notifications[0].recipientUserId, 55)
  assert.equal(calls.notifications[0].category, "finance")
  assert.equal(calls.notifications[0].linkedEntityId, 77)
  assert.equal(calls.whatsapp.length, 0)
  assert.equal(result.message, "In-app fee reminder sent.")
  assert.ok(result.notification)
})

test("in-app fee reminder fails clearly when no guardian login can receive it", async () => {
  const { dependencies } = feeDependencies(feeRow({ guardian_user_id: null }))
  await assert.rejects(
    sendFeeReminder(3, 8, { student_ref: "student-ref", channel: "in_app" }, dependencies),
    /linked, active guardian login/,
  )
})

test("skipped WhatsApp fee reminders retain a real in-app fallback", async () => {
  const { calls, dependencies } = feeDependencies(feeRow(), { status: "skipped", reason: "WhatsApp is not configured for this school." })
  const result = await sendFeeReminder(3, 8, { student_ref: "student-ref", channel: "whatsapp" }, dependencies)
  assert.equal(calls.notifications.length, 1)
  assert.equal(calls.whatsapp.length, 1)
  assert.match(result.message, /In-app reminder sent instead/)
  assert.equal(result.whatsapp.status, "skipped")
})

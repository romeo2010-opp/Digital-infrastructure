import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8")

function insertColumnLists(source, table) {
  const pattern = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]+)\\)`, "gi")
  return [...source.matchAll(pattern)].map((match) =>
    match[1].split(",").map((column) => column.trim().toLowerCase()),
  )
}

test("runtime inserts supply required public references and tenant scope", () => {
  const students = read(root, "src/controllers/studentsController.js")
  const schoolData = read(root, "src/controllers/schoolDataController.js")
  const syllabus = read(root, "src/controllers/syllabusController.js")

  const guardianInserts = [
    ...insertColumnLists(students, "student_guardians"),
    ...insertColumnLists(schoolData, "student_guardians"),
  ]
  assert.ok(guardianInserts.length >= 2)
  for (const columns of guardianInserts) {
    assert.ok(columns.includes("public_ref"))
    assert.ok(columns.includes("school_id"))
  }

  const topicInserts = insertColumnLists(syllabus, "syllabus_topics")
  assert.equal(topicInserts.length, 3)
  for (const columns of topicInserts) {
    assert.ok(columns.includes("public_ref"))
    assert.ok(columns.includes("school_id"))
    assert.ok(columns.includes("subject_id"))
  }

  const objectiveInserts = insertColumnLists(syllabus, "learning_objectives")
  assert.equal(objectiveInserts.length, 1)
  for (const required of ["public_ref", "school_id", "subject_id", "topic_id"]) {
    assert.ok(objectiveInserts[0].includes(required))
  }
})

test("DISTINCT academic queries order only by selected helper fields", () => {
  const operations = read(root, "src/services/academicOperationsService.js")
  assert.match(operations, /COALESCE\(parent\.order_number,st\.order_number,999999\) hierarchy_order/)
  assert.match(operations, /ORDER BY subject_name,hierarchy_order,order_number,topic_name/)
  assert.match(operations, /s\.last_name student_last_name,s\.first_name student_first_name/)
  assert.match(operations, /ORDER BY student_last_name,student_first_name,student_id/)
  assert.doesNotMatch(operations, /SELECT DISTINCT[^`]+ORDER BY s\.last_name,s\.first_name,s\.id/)
})

test("production diagnostic audit is explicitly read only", () => {
  for (const script of ["audit-system-errors.mjs", "audit-schema-contracts.mjs", "audit-academic-system.mjs"]) {
    const audit = read(root, "scripts", script)
    assert.match(audit, /SET SESSION TRANSACTION READ ONLY/)
    assert.match(audit, /START TRANSACTION READ ONLY/)
    assert.match(audit, /ROLLBACK/)
    assert.doesNotMatch(audit, /connection\.query\(["'`]\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i)
  }
})

test("academic diagnostic samples legacy global-id contamination without mutating data", () => {
  const audit = read(root, "scripts", "audit-academic-system.mjs")
  const checks = [
    "question bank topic, subject, or school scope mismatches",
    "question bank assessment-import source scope mismatches",
    "assessment import question topic, subject, or school scope mismatches",
    "assessment question topic, subject, or school scope mismatches",
    "assessment question objective, subject, or school scope mismatches",
    "assessment question topic mapping scope mismatches",
    "lesson log class, subject, or topic scope mismatches",
    "lesson log objective scope or selected-topic mismatches",
    "lesson log learner school or active-enrollment mismatches",
    "academic intervention foreign-school or class-subject-topic mismatches",
    "learner support case foreign-school or primary scope mismatches",
    "learner support case topic record scope mismatches",
    "learner support case member school mismatches",
  ]
  for (const name of checks) assert.ok(audit.includes(`"${name}"`), `missing audit check: ${name}`)
  assert.match(audit, /const integritySampleLimit = 25/)
  assert.match(audit, /SELECT COUNT\(\*\) mismatch_count FROM \(\$\{baseSql\}\) audit_mismatches/)
  assert.match(audit, /const result = await rows\(`\$\{baseSql\}\\nLIMIT \$\{integritySampleLimit\}`/)
  assert.match(audit, /count: mismatchCount, rows: result\.slice\(0, integritySampleLimit\)/)
  assert.ok((audit.match(/LIMIT 25/g) || []).length >= checks.length)
  assert.doesNotMatch(
    audit,
    /safeCheck\(\s*"[^"]+"\s*,\s*`\s*(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)\b/i,
  )
  for (const relationship of [
    "topic.subject_id <> qb.subject_id",
    "topic.subject_id <> assessment.subject_id",
    "enrollment.class_id = lesson.class_id",
    "topic.subject_id <> intervention.subject_id",
    "LOWER(COALESCE(student.status, '')) <> 'active'",
    "enrollment.enrollment_status = 'active'",
    "COALESCE(assigned_teacher.employment_status, '') <> 'active'",
    "FROM teacher_class_subject_assignments assignment",
    "assignment.class_id = intervention.class_id",
    "assignment.subject_id = intervention.subject_id",
    "assignment.role = 'subject_teacher'",
    "assignment.is_active = 1",
    "objective.topic_id <> support_case.primary_topic_id",
  ]) assert.ok(audit.includes(relationship), `missing relationship check: ${relationship}`)
})

test("schema diagnostic compares definitions, indexes, and referential rules", () => {
  const audit = read(root, "scripts", "audit-schema-contracts.mjs")
  for (const metadataField of [
    "COLUMN_TYPE AS column_type",
    "IS_NULLABLE AS is_nullable",
    "COLUMN_DEFAULT AS column_default",
    "information_schema.statistics",
    "information_schema.key_column_usage",
    "information_schema.referential_constraints",
  ]) assert.ok(audit.includes(metadataField), `missing schema metadata: ${metadataField}`)
  for (const outputField of [
    "column_mismatches",
    "missing_indexes",
    "index_mismatches",
    "missing_foreign_keys",
    "foreign_key_mismatches",
  ]) assert.ok(audit.includes(outputField), `missing schema drift output: ${outputField}`)
  assert.match(audit, /compareSchemaContracts\(expected/)
})

test("academic diagnostic explains the MySQL 9 production query shapes without returning user rows", () => {
  const audit = read(root, "scripts", "audit-academic-system.mjs")
  for (const name of [
    "MySQL compatibility: learner-support reassessment alias",
    "MySQL compatibility: authoring topics DISTINCT ordering",
    "MySQL compatibility: academic marksheet learner DISTINCT ordering",
  ]) assert.ok(audit.includes(`"${name}"`), `missing compatibility probe: ${name}`)
  assert.ok((audit.match(/`EXPLAIN\s+SELECT/g) || []).length >= 3)
  assert.ok((audit.match(/WHERE 1 = 0/g) || []).length >= 3)
  assert.match(audit, /generated_assessments generated_assessment/)
  assert.match(audit, /ORDER BY subject_name, hierarchy_order, order_number, topic_name/)
  assert.match(audit, /ORDER BY student_last_name, student_first_name, student_id/)
  assert.match(audit, /compatibility_checks: compatibilityChecks/)
  assert.match(audit, /compatibility_checks: output\.compatibility_checks/)
})

test("legacy child tables validate tenant scope before storing global foreign ids", () => {
  const lessons = read(root, "src/controllers/lessonLogsController.js")
  const questions = read(root, "src/controllers/questionsController.js")
  const imports = read(root, "src/services/assessmentImportService.js")
  const classroom = read(root, "src/services/libraryClassroomService.js")
  assert.match(lessons, /assertObjectivesBelongToScope/)
  assert.match(lessons, /assertStudentsBelongToClass/)
  assert.match(lessons, /enrollment\.school_id = scoped_log\.school_id/)
  assert.match(questions, /validateSyllabusTopicScope/)
  assert.match(imports, /validateSyllabusTopicScope/)
  assert.match(classroom, /validateSyllabusTopicScope/)
})

test("assessment imports keep tenant scope and assign the class subject teacher", () => {
  const imports = read(root, "src/services/assessmentImportService.js")
  assert.match(imports, /resolveImportAssessmentTeacher/)
  assert.match(imports, /teacher_class_subject_assignments assignment/)
  assert.match(imports, /teacher\.school_id=assignment\.school_id/)
  assert.match(imports, /const teacherId=await resolveImportAssessmentTeacher/)
  assert.doesNotMatch(imports, /term\.academic_year_id,job\.term_id,userId,job\.title/)
})

test("reminder engine degrades by support capability instead of dropping all reminders", () => {
  const reminders = read(root, "src/services/reminderEngine.js")
  assert.match(reminders, /learnerSupportReminderCapabilities/)
  assert.match(reminders, /COALESCE\(cycle\.owner_user_id,c\.owner_user_id\)/)
  assert.match(reminders, /supportCapabilities\.reassessmentDueAt\?"reassessment\.due_at":"c\.next_review_at"/)
})

test("published assessment evidence blocks destructive question replacement", () => {
  const assessments = read(root, "src/controllers/assessmentController.js")
  for (const table of ["academic_mark_sheets", "result_batches", "subject_results"]) {
    assert.match(assessments, new RegExp(`EXISTS\\(SELECT 1 FROM ${table}`))
  }
  assert.match(assessments, /ASSESSMENT_EVIDENCE_EXISTS/)
  assert.match(assessments, /marksheet correction workflow/)
})

test("invalid timetable references and classroom enums fail as client errors", () => {
  const routes = read(root, "src/routes/index.js")
  const classroom = read(root, "src/services/libraryClassroomService.js")
  assert.match(routes, /new HttpError\(404, "Timetable reference was not found\."\)/)
  assert.match(routes, /new HttpError\(404, "Timetable version reference was not found\."\)/)
  assert.match(classroom, /UNDERSTANDING_CONFIDENCE_LEVELS/)
  assert.match(classroom, /FORMATIVE_ACTIVITY_TYPES/)
  assert.match(classroom, /Formative activity type is invalid\./)
})

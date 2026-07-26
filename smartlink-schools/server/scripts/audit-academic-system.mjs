import "dotenv/config"
import mysql from "mysql2/promise"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true })

const requiredSupportTables = [
  "learner_support_cases",
  "learner_support_case_topics",
  "learner_support_case_evidence",
  "learner_support_case_events",
  "intervention_cycles",
  "intervention_sessions",
  "intervention_strategy_types",
  "academic_intervention_reassessments",
  "academic_review_meetings",
  "guardian_review_records",
  "escalation_policies",
  "escalation_decisions",
  "support_case_notifications",
  "support_case_term_transfers",
]

const relevantPattern = [
  "academic",
  "assessment",
  "learner",
  "mastery",
  "result",
  "intervention",
  "support",
  "escalation",
  "finding",
  "risk",
  "question",
  "guardian",
].join("|")

const integrityScopeTables = [
  "schools",
  "users",
  "subjects",
  "grade_levels",
  "classes",
  "students",
  "student_enrollments",
  "terms",
  "academic_years",
  "syllabus_topics",
  "learning_objectives",
  "question_bank",
  "assessment_import_jobs",
  "assessment_import_questions",
  "assessments",
  "assessment_questions",
  "question_topic_mappings",
  "teacher_lesson_logs",
  "teacher_lesson_log_topics",
  "teacher_lesson_log_objectives",
  "teacher_lesson_log_students",
  "teacher_class_subject_assignments",
  "academic_interventions",
  "learner_support_cases",
  "learner_support_case_members",
  "learner_support_case_topics",
]

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replaceAll("`", "``")}\``
}

async function scalar(sql, params = []) {
  const [rows] = await connection.query(sql, params)
  const first = rows[0] || {}
  return Number(Object.values(first)[0] || 0)
}

async function rows(sql, params = []) {
  const [result] = await connection.query(sql, params)
  return result
}

const integritySampleLimit = 25

function unboundedCheckSql(sql) {
  return String(sql || "").trim().replace(/;\s*$/, "").replace(/\s+LIMIT\s+\d+\s*$/i, "")
}

async function safeCheck(name, sql, params = [], options = {}) {
  try {
    if (options.probe) {
      const result = await rows(sql, params)
      return { name, status: "checked", count: result.length, rows: result.slice(0, integritySampleLimit) }
    }
    const baseSql = unboundedCheckSql(sql)
    const countRows = await rows(
      `SELECT COUNT(*) mismatch_count FROM (${baseSql}) audit_mismatches`,
      params,
    )
    const mismatchCount = Number(countRows[0]?.mismatch_count || 0)
    const result = await rows(`${baseSql}\nLIMIT ${integritySampleLimit}`, params)
    return { name, status: "checked", count: mismatchCount, rows: result.slice(0, integritySampleLimit) }
  } catch (error) {
    return { name, status: "not_checkable", reason: error.message }
  }
}

try {
  await connection.query("SET SESSION TRANSACTION READ ONLY")
  await connection.query("START TRANSACTION READ ONLY")

  const [[identity]] = await connection.query(
    "SELECT DATABASE() database_name, VERSION() server_version, @@version_comment version_comment, CURRENT_USER() authenticated_user",
  )
  const tables = await rows(
    `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type, ENGINE AS engine, TABLE_ROWS AS table_rows
       FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE()
        AND (TABLE_NAME REGEXP ? OR TABLE_NAME IN (${integrityScopeTables.map(() => "?").join(",")}))
      ORDER BY TABLE_NAME`,
    [relevantPattern, ...integrityScopeTables],
  )
  const tableNames = new Set(tables.map((table) => table.table_name))
  const hasTables = (...names) => names.every((name) => tableNames.has(name))
  const supportTableStatus = Object.fromEntries(
    requiredSupportTables.map((tableName) => [tableName, tableNames.has(tableName)]),
  )

  const keyTables = [
    "assessments",
    "assessment_questions",
    "question_topic_mappings",
    "question_objective_mappings",
    "academic_mark_sheets",
    "learner_assessment_entries",
    "learner_question_marks",
    "learner_topic_results",
    "mastery_evidence",
    "academic_mastery_records",
    "academic_alerts",
    "academic_recommendations",
    "academic_interventions",
    "generated_assessments",
    "academic_intervention_reassessments",
    ...requiredSupportTables,
  ]
  const countTables = keyTables.filter((tableName) => tableNames.has(tableName))
  const countRows = countTables.length
    ? await rows(countTables.map((tableName) =>
      `SELECT '${tableName}' table_name, COUNT(*) row_count FROM ${quoteIdentifier(tableName)}`,
    ).join(" UNION ALL "))
    : []
  const rowCounts = Object.fromEntries(countRows.map((row) => [row.table_name, Number(row.row_count)]))
  const schemaRows = countTables.length
    ? await rows(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type,
              IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, COLUMN_KEY AS column_key
         FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${countTables.map(() => "?").join(",")})
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      countTables,
    )
    : []
  const schema = {}
  for (const column of schemaRows) {
    schema[column.table_name] ||= []
    const { table_name: _tableName, ...details } = column
    schema[column.table_name].push(details)
  }

  const foreignKeys = await rows(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            REFERENCED_TABLE_NAME AS referenced_table_name, REFERENCED_COLUMN_NAME AS referenced_column_name,
            CONSTRAINT_NAME AS constraint_name
       FROM information_schema.key_column_usage
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        AND TABLE_NAME REGEXP ?
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [relevantPattern],
  )
  const indexes = await rows(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
       FROM information_schema.statistics
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP ?
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY TABLE_NAME, INDEX_NAME`,
    [relevantPattern],
  )

  const integrityChecks = []
  if (hasTables("teacher_class_subject_assignments", "academic_years", "terms")) {
    integrityChecks.push(await safeCheck(
      "active teacher assignments without one valid explicit academic session",
      `SELECT assignment.id assignment_id,assignment.school_id,assignment.teacher_id,
              assignment.class_id,assignment.subject_id,assignment.academic_year_id,assignment.term_id,
              academic_year.school_id academic_year_school_id,
              scoped_term.school_id term_school_id,scoped_term.academic_year_id term_academic_year_id
         FROM teacher_class_subject_assignments assignment
         LEFT JOIN academic_years academic_year ON academic_year.id=assignment.academic_year_id
         LEFT JOIN terms scoped_term ON scoped_term.id=assignment.term_id
        WHERE assignment.is_active=1 AND (
              assignment.academic_year_id IS NULL OR assignment.term_id IS NULL
              OR academic_year.id IS NULL OR academic_year.school_id<>assignment.school_id
              OR scoped_term.id IS NULL OR scoped_term.school_id<>assignment.school_id
              OR scoped_term.academic_year_id<>assignment.academic_year_id
        )
        ORDER BY assignment.id`,
    ))
  }
  if (hasTables("teacher_class_subject_assignments", "users", "classes", "subjects")) {
    integrityChecks.push(await safeCheck(
      "teacher assignment tenant, role, class, or subject mismatches",
      `SELECT assignment.id assignment_id,assignment.school_id,assignment.teacher_id,
              assignment.class_id,assignment.subject_id,assignment.role,
              teacher.school_id teacher_school_id,teacher.role teacher_role,
              scoped_class.school_id class_school_id,scoped_subject.school_id subject_school_id
         FROM teacher_class_subject_assignments assignment
         LEFT JOIN users teacher ON teacher.id=assignment.teacher_id
         LEFT JOIN classes scoped_class ON scoped_class.id=assignment.class_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id=assignment.subject_id
        WHERE teacher.id IS NULL OR teacher.school_id<>assignment.school_id OR teacher.role<>'teacher'
           OR scoped_class.id IS NULL OR scoped_class.school_id<>assignment.school_id
           OR (assignment.subject_id IS NOT NULL AND (
                scoped_subject.id IS NULL OR scoped_subject.school_id<>assignment.school_id
           ))
           OR (assignment.role='subject_teacher' AND assignment.subject_id IS NULL)
           OR (assignment.role='class_teacher' AND assignment.subject_id IS NOT NULL)
        ORDER BY assignment.id`,
    ))
    integrityChecks.push(await safeCheck(
      "duplicate active teacher assignment scopes",
      `SELECT school_id,class_id,subject_id,academic_year_id,term_id,role,
              COUNT(*) duplicate_count,GROUP_CONCAT(id ORDER BY id) assignment_ids
         FROM teacher_class_subject_assignments
        WHERE is_active=1 AND academic_year_id IS NOT NULL AND term_id IS NOT NULL
        GROUP BY school_id,class_id,subject_id,academic_year_id,term_id,role
       HAVING COUNT(*)>1`,
    ))
  }
  if (hasTables("question_bank", "subjects", "syllabus_topics")) {
    integrityChecks.push(await safeCheck(
      "question bank topic, subject, or school scope mismatches",
      `SELECT qb.id question_bank_id, qb.school_id, qb.subject_id, qb.topic_id, qb.subtopic_id,
              scoped_subject.school_id subject_school_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              subtopic.school_id subtopic_school_id, subtopic.subject_id subtopic_subject_id,
              subtopic.parent_topic_id subtopic_parent_topic_id
         FROM question_bank qb
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = qb.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = qb.topic_id
         LEFT JOIN syllabus_topics subtopic ON subtopic.id = qb.subtopic_id
        WHERE scoped_subject.id IS NULL OR scoped_subject.school_id <> qb.school_id
           OR topic.id IS NULL OR topic.school_id <> qb.school_id OR topic.subject_id <> qb.subject_id
           OR (qb.subtopic_id IS NOT NULL AND (
                subtopic.id IS NULL OR subtopic.school_id <> qb.school_id
                OR subtopic.subject_id <> qb.subject_id
                OR COALESCE(subtopic.parent_topic_id, 0) <> qb.topic_id
           ))
        ORDER BY qb.id
        LIMIT 25`,
    ))
  }
  if (hasTables("question_bank", "assessment_import_jobs")) {
    integrityChecks.push(await safeCheck(
      "question bank assessment-import source scope mismatches",
      `SELECT qb.id question_bank_id, qb.school_id, qb.subject_id, qb.source_import_job_id,
              source_job.school_id source_job_school_id, source_job.subject_id source_job_subject_id
         FROM question_bank qb
         LEFT JOIN assessment_import_jobs source_job ON source_job.id = qb.source_import_job_id
        WHERE qb.source_import_job_id IS NOT NULL AND (
              source_job.id IS NULL OR source_job.school_id <> qb.school_id
              OR (source_job.subject_id IS NOT NULL AND source_job.subject_id <> qb.subject_id)
        )
        ORDER BY qb.id
        LIMIT 25`,
    ))
  }
  if (hasTables("assessment_import_questions", "assessment_import_jobs", "subjects", "syllabus_topics")) {
    integrityChecks.push(await safeCheck(
      "assessment import question topic, subject, or school scope mismatches",
      `SELECT imported.id import_question_id, imported.school_id, imported.import_job_id,
              job.school_id job_school_id, job.subject_id, imported.topic_id, imported.subtopic_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              subtopic.school_id subtopic_school_id, subtopic.subject_id subtopic_subject_id
         FROM assessment_import_questions imported
         LEFT JOIN assessment_import_jobs job ON job.id = imported.import_job_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = job.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = imported.topic_id
         LEFT JOIN syllabus_topics subtopic ON subtopic.id = imported.subtopic_id
        WHERE job.id IS NULL OR job.school_id <> imported.school_id
           OR (job.subject_id IS NOT NULL AND (
                scoped_subject.id IS NULL OR scoped_subject.school_id <> imported.school_id
           ))
           OR (imported.topic_id IS NOT NULL AND (
                topic.id IS NULL OR topic.school_id <> imported.school_id
                OR (job.subject_id IS NOT NULL AND topic.subject_id <> job.subject_id)
           ))
           OR (imported.subtopic_id IS NOT NULL AND (
                subtopic.id IS NULL OR subtopic.school_id <> imported.school_id
                OR (job.subject_id IS NOT NULL AND subtopic.subject_id <> job.subject_id)
                OR (imported.topic_id IS NOT NULL AND COALESCE(subtopic.parent_topic_id, 0) <> imported.topic_id)
           ))
        ORDER BY imported.id
        LIMIT 25`,
    ))
  }
  if (hasTables("assessment_questions", "assessments", "subjects", "syllabus_topics")) {
    integrityChecks.push(await safeCheck(
      "assessment question topic, subject, or school scope mismatches",
      `SELECT question.id assessment_question_id, question.school_id, question.assessment_id,
              assessment.school_id assessment_school_id, assessment.subject_id,
              question.topic_id, question.subtopic_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              subtopic.school_id subtopic_school_id, subtopic.subject_id subtopic_subject_id
         FROM assessment_questions question
         LEFT JOIN assessments assessment ON assessment.id = question.assessment_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = assessment.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = question.topic_id
         LEFT JOIN syllabus_topics subtopic ON subtopic.id = question.subtopic_id
        WHERE assessment.id IS NULL OR assessment.school_id <> question.school_id
           OR scoped_subject.id IS NULL OR scoped_subject.school_id <> question.school_id
           OR (question.topic_id IS NOT NULL AND (
                topic.id IS NULL OR topic.school_id <> question.school_id
                OR topic.subject_id <> assessment.subject_id
           ))
           OR (question.subtopic_id IS NOT NULL AND (
                subtopic.id IS NULL OR subtopic.school_id <> question.school_id
                OR subtopic.subject_id <> assessment.subject_id
                OR (question.topic_id IS NOT NULL AND COALESCE(subtopic.parent_topic_id, 0) <> question.topic_id)
           ))
        ORDER BY question.id
        LIMIT 25`,
    ))
  }
  if (hasTables("assessment_questions", "assessments", "learning_objectives")) {
    integrityChecks.push(await safeCheck(
      "assessment question objective, subject, or school scope mismatches",
      `SELECT question.id assessment_question_id, question.school_id, question.assessment_id,
              assessment.subject_id, question.topic_id, question.subtopic_id,
              question.learning_objective_id,
              objective.school_id objective_school_id, objective.subject_id objective_subject_id,
              objective.topic_id objective_topic_id
         FROM assessment_questions question
         LEFT JOIN assessments assessment ON assessment.id = question.assessment_id
         LEFT JOIN learning_objectives objective ON objective.id = question.learning_objective_id
        WHERE question.learning_objective_id IS NOT NULL AND (
              assessment.id IS NULL OR assessment.school_id <> question.school_id
              OR objective.id IS NULL OR objective.school_id <> question.school_id
              OR objective.subject_id <> assessment.subject_id
              OR (question.topic_id IS NOT NULL
                  AND objective.topic_id NOT IN (question.topic_id, COALESCE(question.subtopic_id, question.topic_id)))
        )
        ORDER BY question.id
        LIMIT 25`,
    ))
  }
  if (hasTables("question_topic_mappings", "assessment_questions", "assessments", "syllabus_topics")) {
    integrityChecks.push(await safeCheck(
      "assessment question topic mapping scope mismatches",
      `SELECT mapping.id mapping_id, mapping.school_id, mapping.assessment_question_id, mapping.topic_id,
              question.school_id question_school_id, assessment.school_id assessment_school_id,
              assessment.subject_id, topic.school_id topic_school_id, topic.subject_id topic_subject_id
         FROM question_topic_mappings mapping
         LEFT JOIN assessment_questions question ON question.id = mapping.assessment_question_id
         LEFT JOIN assessments assessment ON assessment.id = question.assessment_id
         LEFT JOIN syllabus_topics topic ON topic.id = mapping.topic_id
        WHERE question.id IS NULL OR mapping.school_id <> question.school_id
           OR assessment.id IS NULL OR assessment.school_id <> mapping.school_id
           OR topic.id IS NULL OR topic.school_id <> mapping.school_id
           OR topic.subject_id <> assessment.subject_id
        ORDER BY mapping.id
        LIMIT 25`,
    ))
  }
  if (tableNames.has("question_topic_mappings") && tableNames.has("assessment_questions")) {
    integrityChecks.push(await safeCheck(
      "question topic allocations do not equal question marks",
      `SELECT q.school_id, q.assessment_id, q.id question_id, q.marks question_marks,
              SUM(COALESCE(m.allocated_marks, 0)) mapped_marks,
              SUM(COALESCE(m.allocated_percentage, 0)) mapped_percentage
         FROM assessment_questions q
         JOIN question_topic_mappings m ON m.assessment_question_id = q.id AND m.school_id = q.school_id
        GROUP BY q.school_id, q.assessment_id, q.id, q.marks
       HAVING NOT (
         ABS(SUM(COALESCE(m.allocated_marks, 0)) - q.marks) < 0.001
         OR ABS(SUM(COALESCE(m.allocated_percentage, 0)) - 100) < 0.001
       )`,
    ))
  }
  if (tableNames.has("learner_question_marks") && tableNames.has("assessment_questions")) {
    integrityChecks.push(await safeCheck(
      "question marks above maximum or below zero",
      `SELECT m.school_id, m.mark_sheet_id, m.student_id, m.assessment_question_id,
              m.marks_awarded, q.marks marks_available
         FROM learner_question_marks m
         JOIN assessment_questions q ON q.id = m.assessment_question_id AND q.school_id = m.school_id
        WHERE m.marks_awarded < 0 OR m.marks_awarded > q.marks`,
    ))
  }
  if (tableNames.has("learner_assessment_entries")) {
    integrityChecks.push(await safeCheck(
      "absent or excused entries carrying numeric totals",
      `SELECT school_id, mark_sheet_id, student_id, participation_status, overall_marks, percentage
         FROM learner_assessment_entries
        WHERE participation_status IN ('absent', 'excused')
          AND (overall_marks IS NOT NULL OR percentage IS NOT NULL)`,
    ))
    integrityChecks.push(await safeCheck(
      "non-present learner entries marked official",
      `SELECT school_id, mark_sheet_id, student_id, participation_status, is_official
         FROM learner_assessment_entries
        WHERE participation_status <> 'present' AND is_official = 1`,
    ))
    if (tableNames.has("learner_question_marks")) integrityChecks.push(await safeCheck(
      "absent or excused learners retaining question marks",
      `SELECT e.school_id, e.mark_sheet_id, e.student_id, e.participation_status,
              COUNT(*) marked_question_count
         FROM learner_assessment_entries e
         JOIN learner_question_marks m ON m.learner_entry_id=e.id AND m.school_id=e.school_id
        WHERE e.participation_status IN ('absent','excused') AND m.marks_awarded IS NOT NULL
        GROUP BY e.school_id,e.mark_sheet_id,e.student_id,e.participation_status`,
    ))
  }
  if (hasTables("teacher_lesson_logs", "teacher_lesson_log_topics", "classes", "subjects", "syllabus_topics")) {
    integrityChecks.push(await safeCheck(
      "lesson log class, subject, or topic scope mismatches",
      `SELECT lesson.id lesson_log_id, lesson.school_id, lesson.class_id, lesson.subject_id,
              lesson.main_topic_id, linked_topic.id lesson_topic_link_id,
              linked_topic.syllabus_topic_id, linked_topic.syllabus_subtopic_id,
              main_topic.school_id main_topic_school_id, main_topic.subject_id main_topic_subject_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              subtopic.school_id subtopic_school_id, subtopic.subject_id subtopic_subject_id,
              subtopic.parent_topic_id subtopic_parent_topic_id
         FROM teacher_lesson_logs lesson
         LEFT JOIN classes scoped_class ON scoped_class.id = lesson.class_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = lesson.subject_id
         LEFT JOIN syllabus_topics main_topic ON main_topic.id = lesson.main_topic_id
         LEFT JOIN teacher_lesson_log_topics linked_topic ON linked_topic.lesson_log_id = lesson.id
         LEFT JOIN syllabus_topics topic ON topic.id = linked_topic.syllabus_topic_id
         LEFT JOIN syllabus_topics subtopic ON subtopic.id = linked_topic.syllabus_subtopic_id
        WHERE scoped_class.id IS NULL OR scoped_class.school_id <> lesson.school_id
           OR scoped_subject.id IS NULL OR scoped_subject.school_id <> lesson.school_id
           OR (lesson.main_topic_id IS NOT NULL AND (
                main_topic.id IS NULL OR main_topic.school_id <> lesson.school_id
                OR main_topic.subject_id <> lesson.subject_id
           ))
           OR (linked_topic.id IS NOT NULL AND (
                topic.id IS NULL OR topic.school_id <> lesson.school_id OR topic.subject_id <> lesson.subject_id
                OR (linked_topic.syllabus_subtopic_id IS NOT NULL AND (
                     subtopic.id IS NULL OR subtopic.school_id <> lesson.school_id
                     OR subtopic.subject_id <> lesson.subject_id
                     OR COALESCE(subtopic.parent_topic_id, 0) <> linked_topic.syllabus_topic_id
                ))
           ))
        ORDER BY lesson.id, linked_topic.id
        LIMIT 25`,
    ))
  }
  if (hasTables("teacher_lesson_logs", "teacher_lesson_log_topics", "teacher_lesson_log_objectives", "learning_objectives")) {
    integrityChecks.push(await safeCheck(
      "lesson log objective scope or selected-topic mismatches",
      `SELECT linked_objective.id lesson_objective_link_id, lesson.id lesson_log_id,
              lesson.school_id, lesson.subject_id, lesson.main_topic_id,
              linked_objective.learning_objective_id,
              objective.school_id objective_school_id, objective.subject_id objective_subject_id,
              objective.topic_id objective_topic_id
         FROM teacher_lesson_log_objectives linked_objective
         LEFT JOIN teacher_lesson_logs lesson ON lesson.id = linked_objective.lesson_log_id
         LEFT JOIN learning_objectives objective ON objective.id = linked_objective.learning_objective_id
        WHERE lesson.id IS NULL OR objective.id IS NULL
           OR objective.school_id <> lesson.school_id OR objective.subject_id <> lesson.subject_id
           OR NOT (
                objective.topic_id = lesson.main_topic_id
                OR EXISTS (
                  SELECT 1
                    FROM teacher_lesson_log_topics selected_topic
                   WHERE selected_topic.lesson_log_id = lesson.id
                     AND objective.topic_id IN (selected_topic.syllabus_topic_id, selected_topic.syllabus_subtopic_id)
                )
           )
        ORDER BY linked_objective.id
        LIMIT 25`,
    ))
  }
  if (hasTables("teacher_lesson_logs", "teacher_lesson_log_students", "students", "student_enrollments")) {
    integrityChecks.push(await safeCheck(
      "lesson log learner school or active-enrollment mismatches",
      `SELECT linked_student.id lesson_student_link_id, lesson.id lesson_log_id,
              lesson.school_id, lesson.academic_year_id, lesson.term_id, lesson.class_id,
              linked_student.student_id, student.school_id student_school_id
         FROM teacher_lesson_log_students linked_student
         LEFT JOIN teacher_lesson_logs lesson ON lesson.id = linked_student.lesson_log_id
         LEFT JOIN students student ON student.id = linked_student.student_id
        WHERE lesson.id IS NULL OR student.id IS NULL OR student.school_id <> lesson.school_id
           OR NOT EXISTS (
                SELECT 1
                  FROM student_enrollments enrollment
                 WHERE enrollment.school_id = lesson.school_id
                   AND enrollment.student_id = linked_student.student_id
                   AND enrollment.class_id = lesson.class_id
                   AND enrollment.academic_year_id = lesson.academic_year_id
                   AND enrollment.term_id = lesson.term_id
                   AND enrollment.enrollment_status = 'active'
           )
        ORDER BY linked_student.id
        LIMIT 25`,
    ))
  }
  if (tableNames.has("academic_alerts")) {
    integrityChecks.push(await safeCheck(
      "duplicate open academic alerts for the same scoped rule",
      `SELECT school_id, COALESCE(term_id, 0) term_id, COALESCE(class_id, 0) class_id,
              COALESCE(student_id, 0) student_id,
              COALESCE(subject_id, 0) subject_id, COALESCE(topic_id, 0) topic_id,
              rule_key, COUNT(*) duplicate_count
         FROM academic_alerts
        WHERE status IN ('open', 'acknowledged')
        GROUP BY school_id, COALESCE(term_id, 0), COALESCE(class_id, 0),
                 COALESCE(student_id, 0), COALESCE(subject_id, 0), COALESCE(topic_id, 0), rule_key
       HAVING COUNT(*) > 1`,
    ))
  }
  if (tableNames.has("generated_assessments") && tableNames.has("academic_mark_sheets")) {
    integrityChecks.push(await safeCheck(
      "published generated assessments without a mark sheet",
      `SELECT g.school_id, g.public_ref, g.assessment_id, g.status
         FROM generated_assessments g
         LEFT JOIN academic_mark_sheets s
           ON s.school_id = g.school_id AND s.assessment_id = g.assessment_id
        WHERE g.status = 'published' AND g.assessment_id IS NOT NULL AND s.id IS NULL`,
    ))
  }
  if (hasTables("academic_interventions", "students", "student_enrollments", "classes", "subjects", "syllabus_topics", "terms", "users", "teacher_class_subject_assignments")) {
    integrityChecks.push(await safeCheck(
      "academic intervention foreign-school or class-subject-topic mismatches",
      `SELECT intervention.id intervention_id, intervention.school_id, intervention.student_id,
              intervention.class_id, intervention.subject_id, intervention.topic_id, intervention.term_id,
              intervention.assigned_teacher_id,
              student.school_id student_school_id, scoped_class.school_id class_school_id,
              scoped_subject.school_id subject_school_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              scoped_term.school_id term_school_id, scoped_term.academic_year_id term_academic_year_id,
              student.status student_status,
              assigned_teacher.school_id assigned_teacher_school_id,
              assigned_teacher.role assigned_teacher_role,
              assigned_teacher.is_active assigned_teacher_is_active,
              assigned_teacher.employment_status assigned_teacher_employment_status
         FROM academic_interventions intervention
         LEFT JOIN students student ON student.id = intervention.student_id
         LEFT JOIN classes scoped_class ON scoped_class.id = intervention.class_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = intervention.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = intervention.topic_id
         LEFT JOIN terms scoped_term ON scoped_term.id = intervention.term_id
         LEFT JOIN users assigned_teacher ON assigned_teacher.id = intervention.assigned_teacher_id
        WHERE scoped_subject.id IS NULL OR scoped_subject.school_id <> intervention.school_id
           OR (intervention.student_id IS NOT NULL AND (
                student.id IS NULL OR student.school_id <> intervention.school_id
                OR LOWER(COALESCE(student.status, '')) <> 'active'
           ))
           OR (intervention.class_id IS NOT NULL AND (
                scoped_class.id IS NULL OR scoped_class.school_id <> intervention.school_id
           ))
           OR (intervention.topic_id IS NOT NULL AND (
                topic.id IS NULL OR topic.school_id <> intervention.school_id
                OR topic.subject_id <> intervention.subject_id
           ))
           OR (intervention.term_id IS NOT NULL AND (
                scoped_term.id IS NULL OR scoped_term.school_id <> intervention.school_id
           ))
           OR (intervention.assigned_teacher_id IS NOT NULL AND (
                assigned_teacher.id IS NULL OR assigned_teacher.school_id <> intervention.school_id
                OR COALESCE(assigned_teacher.role, '') <> 'teacher'
                OR COALESCE(assigned_teacher.is_active, 0) <> 1
                OR COALESCE(assigned_teacher.employment_status, '') <> 'active'
           ))
           OR (intervention.student_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM student_enrollments enrollment
                  WHERE enrollment.school_id = intervention.school_id
                    AND enrollment.student_id = intervention.student_id
                    AND (intervention.class_id IS NULL OR enrollment.class_id = intervention.class_id)
                    AND (intervention.term_id IS NULL OR enrollment.term_id = intervention.term_id)
                    AND (scoped_term.academic_year_id IS NULL
                         OR enrollment.academic_year_id = scoped_term.academic_year_id)
                    AND enrollment.enrollment_status = 'active'
               ))
           OR (intervention.assigned_teacher_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM teacher_class_subject_assignments assignment
                  WHERE assignment.school_id = intervention.school_id
                    AND assignment.teacher_id = intervention.assigned_teacher_id
                    AND assignment.subject_id = intervention.subject_id
                    AND assignment.role = 'subject_teacher'
                    AND assignment.is_active = 1
                    AND (intervention.class_id IS NULL OR assignment.class_id = intervention.class_id)
                    AND (intervention.term_id IS NULL OR (
                         assignment.academic_year_id = scoped_term.academic_year_id
                         AND assignment.term_id = intervention.term_id
                    ))
               ))
        ORDER BY intervention.id
        LIMIT 25`,
    ))
  }
  if (hasTables("learner_support_cases", "students", "student_enrollments", "classes", "subjects", "syllabus_topics", "learning_objectives", "terms", "academic_years", "users")) {
    integrityChecks.push(await safeCheck(
      "learner support case foreign-school or primary scope mismatches",
      `SELECT support_case.id case_id, support_case.school_id, support_case.academic_year_id,
              support_case.current_term_id, support_case.class_id, support_case.learner_id,
              support_case.subject_id, support_case.primary_topic_id, support_case.primary_objective_id,
              support_case.owner_user_id,
              learner.school_id learner_school_id, scoped_class.school_id class_school_id,
              scoped_subject.school_id subject_school_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              objective.school_id objective_school_id, objective.subject_id objective_subject_id,
              objective.topic_id objective_topic_id, scoped_term.school_id term_school_id,
              scoped_term.academic_year_id term_academic_year_id, scoped_year.school_id academic_year_school_id,
              case_owner.school_id owner_school_id
         FROM learner_support_cases support_case
         LEFT JOIN students learner ON learner.id = support_case.learner_id
         LEFT JOIN classes scoped_class ON scoped_class.id = support_case.class_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = support_case.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = support_case.primary_topic_id
         LEFT JOIN learning_objectives objective ON objective.id = support_case.primary_objective_id
         LEFT JOIN terms scoped_term ON scoped_term.id = support_case.current_term_id
         LEFT JOIN academic_years scoped_year ON scoped_year.id = support_case.academic_year_id
         LEFT JOIN users case_owner ON case_owner.id = support_case.owner_user_id
        WHERE (support_case.learner_id IS NOT NULL AND (
                learner.id IS NULL OR learner.school_id <> support_case.school_id
              ))
           OR (support_case.class_id IS NOT NULL AND (
                scoped_class.id IS NULL OR scoped_class.school_id <> support_case.school_id
              ))
           OR (support_case.subject_id IS NOT NULL AND (
                scoped_subject.id IS NULL OR scoped_subject.school_id <> support_case.school_id
              ))
           OR (support_case.primary_topic_id IS NOT NULL AND (
                topic.id IS NULL OR topic.school_id <> support_case.school_id
                OR support_case.subject_id IS NULL OR topic.subject_id <> support_case.subject_id
              ))
           OR (support_case.primary_objective_id IS NOT NULL AND (
                objective.id IS NULL OR objective.school_id <> support_case.school_id
                OR support_case.subject_id IS NULL OR objective.subject_id <> support_case.subject_id
                OR (support_case.primary_topic_id IS NOT NULL
                    AND objective.topic_id <> support_case.primary_topic_id)
              ))
           OR (support_case.current_term_id IS NOT NULL AND (
                scoped_term.id IS NULL OR scoped_term.school_id <> support_case.school_id
              ))
           OR (support_case.academic_year_id IS NOT NULL AND (
                scoped_year.id IS NULL OR scoped_year.school_id <> support_case.school_id
              ))
           OR (support_case.owner_user_id IS NOT NULL AND (
                case_owner.id IS NULL OR case_owner.school_id <> support_case.school_id
              ))
           OR (support_case.current_term_id IS NOT NULL AND support_case.academic_year_id IS NOT NULL
               AND scoped_term.academic_year_id <> support_case.academic_year_id)
           OR (support_case.learner_id IS NOT NULL AND support_case.class_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM student_enrollments enrollment
                  WHERE enrollment.school_id = support_case.school_id
                    AND enrollment.student_id = support_case.learner_id
                    AND enrollment.class_id = support_case.class_id
                    AND (support_case.academic_year_id IS NULL
                         OR enrollment.academic_year_id = support_case.academic_year_id)
                    AND (support_case.current_term_id IS NULL
                         OR enrollment.term_id = support_case.current_term_id)
               ))
        ORDER BY support_case.id
        LIMIT 25`,
    ))
  }
  if (hasTables("learner_support_case_topics", "learner_support_cases", "subjects", "syllabus_topics", "learning_objectives")) {
    integrityChecks.push(await safeCheck(
      "learner support case topic record scope mismatches",
      `SELECT case_topic.id case_topic_id, case_topic.school_id, case_topic.case_id,
              case_topic.subject_id, case_topic.topic_id, case_topic.objective_id,
              support_case.school_id case_school_id, support_case.subject_id case_subject_id,
              scoped_subject.school_id subject_school_id,
              topic.school_id topic_school_id, topic.subject_id topic_subject_id,
              objective.school_id objective_school_id, objective.subject_id objective_subject_id,
              objective.topic_id objective_topic_id
         FROM learner_support_case_topics case_topic
         LEFT JOIN learner_support_cases support_case ON support_case.id = case_topic.case_id
         LEFT JOIN subjects scoped_subject ON scoped_subject.id = case_topic.subject_id
         LEFT JOIN syllabus_topics topic ON topic.id = case_topic.topic_id
         LEFT JOIN learning_objectives objective ON objective.id = case_topic.objective_id
        WHERE support_case.id IS NULL OR support_case.school_id <> case_topic.school_id
           OR scoped_subject.id IS NULL OR scoped_subject.school_id <> case_topic.school_id
           OR topic.id IS NULL OR topic.school_id <> case_topic.school_id
           OR topic.subject_id <> case_topic.subject_id
           OR (support_case.subject_id IS NOT NULL AND support_case.subject_id <> case_topic.subject_id)
           OR (case_topic.objective_id IS NOT NULL AND (
                objective.id IS NULL OR objective.school_id <> case_topic.school_id
                OR objective.subject_id <> case_topic.subject_id OR objective.topic_id <> case_topic.topic_id
           ))
        ORDER BY case_topic.id
        LIMIT 25`,
    ))
  }
  if (hasTables("learner_support_case_members", "learner_support_cases", "students")) {
    integrityChecks.push(await safeCheck(
      "learner support case member school mismatches",
      `SELECT case_member.id case_member_id, case_member.school_id, case_member.case_id, case_member.learner_id,
              support_case.school_id case_school_id, learner.school_id learner_school_id
         FROM learner_support_case_members case_member
         LEFT JOIN learner_support_cases support_case ON support_case.id = case_member.case_id
         LEFT JOIN students learner ON learner.id = case_member.learner_id
        WHERE support_case.id IS NULL OR support_case.school_id <> case_member.school_id
           OR learner.id IS NULL OR learner.school_id <> case_member.school_id
        ORDER BY case_member.id
        LIMIT 25`,
    ))
  }
  if (tableNames.has("mastery_evidence")) {
    integrityChecks.push(await safeCheck(
      "operational mastery evidence missing academic session scope",
      `SELECT id, school_id, academic_year_id, term_id, class_id, subject_id, student_id, topic_id,
              evidence_type, source_entity_type
         FROM mastery_evidence
        WHERE source_entity_type IN ('learner_question_mark','learner_topic_result','learner_assessment_entry')
          AND (academic_year_id IS NULL OR term_id IS NULL OR class_id IS NULL)`,
    ))
  }

  const compatibilityChecks = []
  compatibilityChecks.push(await safeCheck(
    "MySQL compatibility: learner-support reassessment alias",
    `EXPLAIN
       SELECT reassessment.public_ref, reassessment.outcome,
              generated_assessment.public_ref assessment_ref,
              generated_assessment.title assessment_title,
              generated_assessment.status assessment_status
         FROM academic_intervention_reassessments reassessment
         LEFT JOIN generated_assessments generated_assessment
           ON generated_assessment.school_id = reassessment.school_id
          AND generated_assessment.id = reassessment.generated_assessment_id
        WHERE 1 = 0
        ORDER BY reassessment.created_at DESC
        LIMIT 1`,
    [],
    { probe: true },
  ))
  compatibilityChecks.push(await safeCheck(
    "MySQL compatibility: authoring topics DISTINCT ordering",
    `EXPLAIN
       SELECT DISTINCT st.id, st.topic_name, st.order_number,
              scoped_subject.name subject_name,
              COALESCE(parent.order_number, st.order_number, 999999) hierarchy_order
         FROM syllabus_topics st
         JOIN subjects scoped_subject ON scoped_subject.id = st.subject_id AND scoped_subject.school_id = st.school_id
         LEFT JOIN syllabus_topics parent ON parent.id = st.parent_topic_id AND parent.school_id = st.school_id
         LEFT JOIN grade_levels grade ON grade.id = st.grade_id AND grade.school_id = st.school_id
         LEFT JOIN learning_objectives objective ON objective.topic_id = st.id AND objective.school_id = st.school_id
        WHERE 1 = 0
        ORDER BY subject_name, hierarchy_order, order_number, topic_name
        LIMIT 1`,
    [],
    { probe: true },
  ))
  compatibilityChecks.push(await safeCheck(
    "MySQL compatibility: academic marksheet learner DISTINCT ordering",
    `EXPLAIN
       SELECT DISTINCT student.id student_id, student.public_ref student_ref,
              CONCAT(student.first_name, ' ', student.last_name) student_name,
              student.last_name student_last_name, student.first_name student_first_name,
              enrollment.id enrollment_id
         FROM student_enrollments enrollment
         JOIN students student ON student.id = enrollment.student_id AND student.school_id = enrollment.school_id
        WHERE 1 = 0
        ORDER BY student_last_name, student_first_name, student_id
        LIMIT 1`,
    [],
    { probe: true },
  ))

  const schoolDistribution = tableNames.has("mastery_evidence")
    ? await rows(`SELECT s.id school_id,s.name school_name,
                         (SELECT COUNT(*) FROM mastery_evidence me WHERE me.school_id=s.id) evidence_count,
                         (SELECT COUNT(*) FROM academic_mastery_records amr WHERE amr.school_id=s.id) mastery_record_count,
                         (SELECT COUNT(*) FROM academic_alerts aa WHERE aa.school_id=s.id) alert_count,
                         (SELECT COUNT(*) FROM academic_interventions ai WHERE ai.school_id=s.id) intervention_count
                    FROM schools s ORDER BY s.id`)
    : []

  const output = {
    generated_at: new Date().toISOString(),
    identity,
    relevant_tables: tables,
    support_table_status: supportTableStatus,
    row_counts: rowCounts,
    schema,
    foreign_keys: foreignKeys,
    indexes,
    integrity_checks: integrityChecks,
    compatibility_checks: compatibilityChecks,
    school_distribution: schoolDistribution,
  }
  const summary = {
    generated_at: output.generated_at,
    identity: output.identity,
    relevant_table_count: output.relevant_tables.length,
    support_table_status: output.support_table_status,
    row_counts: output.row_counts,
    integrity_checks: output.integrity_checks,
    compatibility_checks: output.compatibility_checks,
    school_distribution: output.school_distribution,
  }
  console.log(JSON.stringify(process.argv.includes("--full") ? output : summary, null, 2))
  await connection.query("ROLLBACK")
} finally {
  await connection.end()
}

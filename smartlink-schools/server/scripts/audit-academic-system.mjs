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

async function safeCheck(name, sql, params = []) {
  try {
    const result = await rows(sql, params)
    return { name, status: "checked", count: result.length, rows: result.slice(0, 25) }
  } catch (error) {
    return { name, status: "not_checkable", reason: error.message }
  }
}

try {
  await connection.query("SET SESSION TRANSACTION READ ONLY")
  await connection.query("START TRANSACTION READ ONLY")

  const [[identity]] = await connection.query(
    "SELECT DATABASE() database_name, VERSION() server_version, CURRENT_USER() authenticated_user",
  )
  const tables = await rows(
    `SELECT table_name, table_type, engine, table_rows
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name REGEXP ?
      ORDER BY table_name`,
    [relevantPattern],
  )
  const tableNames = new Set(tables.map((table) => table.table_name))
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
      `SELECT table_name, column_name, column_type, is_nullable, column_default, column_key
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name IN (${countTables.map(() => "?").join(",")})
        ORDER BY table_name, ordinal_position`,
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
    `SELECT table_name, column_name, referenced_table_name, referenced_column_name, constraint_name
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
        AND table_name REGEXP ?
      ORDER BY table_name, constraint_name, ordinal_position`,
    [relevantPattern],
  )
  const indexes = await rows(
    `SELECT table_name, index_name, non_unique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) columns
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name REGEXP ?
      GROUP BY table_name, index_name, non_unique
      ORDER BY table_name, index_name`,
    [relevantPattern],
  )

  const integrityChecks = []
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
    school_distribution: schoolDistribution,
  }
  const summary = {
    generated_at: output.generated_at,
    identity: output.identity,
    relevant_table_count: output.relevant_tables.length,
    support_table_status: output.support_table_status,
    row_counts: output.row_counts,
    integrity_checks: output.integrity_checks,
    school_distribution: output.school_distribution,
  }
  console.log(JSON.stringify(process.argv.includes("--full") ? output : summary, null, 2))
  await connection.query("ROLLBACK")
} finally {
  await connection.end()
}

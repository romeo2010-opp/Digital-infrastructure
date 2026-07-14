import dotenv from "dotenv"
import { pool } from "../src/config/db.js"

dotenv.config()
const DEMO_CODE = "GFA"
if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_DATA_TOOLS !== "true") {
  throw new Error("Greenfield demo validation is disabled in production. Set ENABLE_DEMO_DATA_TOOLS=true for a controlled development run.")
}

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const scalar = async (connection, sql, params = []) => {
  const [[row]] = await connection.query(sql, params)
  return Number(row?.value ?? row?.count ?? row?.n ?? 0)
}

const connection = await pool.getConnection()
try {
  const [[school]] = await connection.query("SELECT id,name,code FROM schools WHERE code=? LIMIT 1", [DEMO_CODE])
  if (!school) throw new Error("Greenfield Academy (GFA) is not seeded. Run npm run demo:greenfield first.")
  const sid = school.id
  const counts = {}
  const countQueries = {
    users: "SELECT COUNT(*) value FROM users WHERE school_id=?",
    teachers: "SELECT COUNT(*) value FROM users WHERE school_id=? AND role='teacher'",
    parents: "SELECT COUNT(*) value FROM users WHERE school_id=? AND role='parent'",
    classes: "SELECT COUNT(*) value FROM classes WHERE school_id=?",
    students: "SELECT COUNT(*) value FROM students WHERE school_id=?",
    guardians: "SELECT COUNT(*) value FROM student_guardians WHERE school_id=?",
    subjects: "SELECT COUNT(*) value FROM subjects WHERE school_id=?",
    syllabus_topics: "SELECT COUNT(*) value FROM syllabus_topics WHERE school_id=?",
    objectives: "SELECT COUNT(*) value FROM learning_objectives WHERE school_id=?",
    lesson_logs: "SELECT COUNT(*) value FROM teacher_lesson_logs WHERE school_id=?",
    student_attendance: "SELECT COUNT(*) value FROM attendance_records WHERE school_id=?",
    staff_attendance: "SELECT COUNT(*) value FROM staff_attendance WHERE school_id=?",
    exam_sessions: "SELECT COUNT(*) value FROM exam_sessions WHERE school_id=?",
    assessments: "SELECT COUNT(*) value FROM assessments WHERE school_id=?",
    assessment_questions: "SELECT COUNT(*) value FROM assessment_questions WHERE school_id=?",
    result_entries: "SELECT COUNT(*) value FROM result_entries WHERE school_id=?",
    report_cards: "SELECT COUNT(*) value FROM report_cards WHERE school_id=?",
    interventions: "SELECT COUNT(*) value FROM academic_interventions WHERE school_id=?",
    timetable_entries: "SELECT COUNT(*) value FROM timetable_entries e JOIN timetable_versions v ON v.id=e.timetable_version_id JOIN timetables t ON t.id=v.timetable_id WHERE t.school_id=?",
    mastery_evidence: "SELECT COUNT(*) value FROM mastery_evidence WHERE school_id=?",
    mastery_records: "SELECT COUNT(*) value FROM academic_mastery_records WHERE school_id=?",
    recommendations: "SELECT COUNT(*) value FROM academic_recommendations WHERE school_id=?",
    alerts: "SELECT COUNT(*) value FROM academic_alerts WHERE school_id=?",
  }
  for (const [name, sql] of Object.entries(countQueries)) counts[name] = await scalar(connection, sql, [sid])
  check("Greenfield school identity", school.name === "Greenfield Academy" && school.code === DEMO_CODE, school)
  check("School structure", counts.classes === 13 && counts.students >= 220 && counts.students <= 280, { classes: counts.classes, students: counts.students })
  check("Staff and family accounts", counts.teachers >= 20 && counts.parents >= 80, { teachers: counts.teachers, parents: counts.parents })
  check("Guardian coverage", counts.guardians >= counts.students, { students: counts.students, guardians: counts.guardians })
  check("Curriculum evidence", counts.subjects >= 8 && counts.syllabus_topics >= 300 && counts.objectives >= counts.syllabus_topics, { subjects: counts.subjects, topics: counts.syllabus_topics, objectives: counts.objectives })
  check("Teaching evidence", counts.lesson_logs >= 100 && counts.student_attendance > 10000 && counts.staff_attendance > 100, { lesson_logs: counts.lesson_logs, student_attendance: counts.student_attendance, staff_attendance: counts.staff_attendance })
  check("Assessment evidence", counts.exam_sessions >= 6 && counts.assessments >= 400 && counts.assessment_questions >= 20 && counts.result_entries >= 5000, { sessions: counts.exam_sessions, assessments: counts.assessments, questions: counts.assessment_questions, result_entries: counts.result_entries })
  check("Reporting and interventions", counts.report_cards >= 200 && counts.interventions >= 4, { report_cards: counts.report_cards, interventions: counts.interventions })
  check("Academic Intelligence evidence", counts.mastery_evidence > 5000 && counts.mastery_records > 500 && counts.recommendations > 0 && counts.alerts > 0, { evidence: counts.mastery_evidence, mastery_records: counts.mastery_records, recommendations: counts.recommendations, alerts: counts.alerts })
  const [[operationalFoundation]] = await connection.query(`SELECT
    (SELECT COUNT(*) FROM question_topic_mappings WHERE school_id=?) mapped_questions,
    (SELECT COUNT(*) FROM question_source_permissions WHERE school_id=? AND reuse_allowed=1) reusable_sources,
    (SELECT COUNT(*) FROM assessment_questions aq JOIN assessments a ON a.id=aq.assessment_id AND a.school_id=aq.school_id JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id LEFT JOIN question_topic_mappings qtm ON qtm.assessment_question_id=aq.id AND qtm.school_id=aq.school_id WHERE aq.school_id=? AND c.name LIKE 'Year 4%' AND s.name='Science' AND qtm.id IS NULL) year4_unmapped,
    (SELECT COUNT(*) FROM academic_interventions ai JOIN classes c ON c.id=ai.class_id AND c.school_id=ai.school_id JOIN subjects s ON s.id=ai.subject_id AND s.school_id=ai.school_id WHERE ai.school_id=? AND c.name='Year 7' AND s.name='Mathematics' AND JSON_EXTRACT(ai.evidence_json,'$.students_affected')=7) year7_hidden_group,
    (SELECT COUNT(*) FROM academic_interventions ai JOIN classes c ON c.id=ai.class_id AND c.school_id=ai.school_id JOIN subjects s ON s.id=ai.subject_id AND s.school_id=ai.school_id WHERE ai.school_id=? AND c.name LIKE 'Year 3%' AND s.name='English' AND ai.status='completed' AND ai.outcome='improved') year3_positive_signal`, [sid,sid,sid,sid,sid])
  check("Operational evidence foundation", Number(operationalFoundation.mapped_questions) >= 15 && Number(operationalFoundation.reusable_sources) >= 20 && Number(operationalFoundation.year4_unmapped) > 0, operationalFoundation)
  check("Greenfield positive and hidden-group scenarios", Number(operationalFoundation.year3_positive_signal) > 0 && Number(operationalFoundation.year7_hidden_group) > 0, { year3_positive_signal: Number(operationalFoundation.year3_positive_signal), year7_hidden_group: Number(operationalFoundation.year7_hidden_group) })
  const [[loop]] = await connection.query(`SELECT ga.public_ref,ga.assessment_id,ga.status,COUNT(DISTINCT gal.student_id) learner_count,COUNT(DISTINCT aq.id) question_count,MAX(air.outcome) reassessment_outcome,MAX(ai.status) intervention_status,MAX(ai.outcome) intervention_outcome
    FROM generated_assessments ga LEFT JOIN generated_assessment_learners gal ON gal.generated_assessment_id=ga.id AND gal.school_id=ga.school_id
    LEFT JOIN assessment_questions aq ON aq.assessment_id=ga.assessment_id AND aq.school_id=ga.school_id
    LEFT JOIN academic_intervention_reassessments air ON air.generated_assessment_id=ga.id AND air.school_id=ga.school_id
    LEFT JOIN academic_interventions ai ON ai.id=air.intervention_id AND ai.school_id=air.school_id
    WHERE ga.school_id=? AND ga.title='Year 5 Equivalent Fractions Support Reassessment' AND ga.status='published'
    GROUP BY ga.id,ga.public_ref,ga.assessment_id,ga.status ORDER BY ga.id DESC LIMIT 1`, [sid])
  check("Year 5 targeted operations loop", !loop || (Number(loop.learner_count) === 10 && Number(loop.question_count) === 5 && ['effective','partially_effective'].includes(loop.reassessment_outcome) && ['improved'].includes(loop.intervention_outcome)), loop || { state: "not_exercised", command: "npm run demo:academic-loop" })
  const [duplicateRecommendations] = await connection.query("SELECT rule_key,term_id,class_id,subject_id,COALESCE(student_id,0) student_key,COUNT(*) n FROM academic_recommendations WHERE school_id=? AND status IN ('NEW','IN_PROGRESS') GROUP BY rule_key,term_id,class_id,subject_id,student_key HAVING COUNT(*)>1", [sid])
  const [duplicateAlerts] = await connection.query("SELECT rule_key,term_id,class_id,subject_id,COALESCE(student_id,0) student_key,COUNT(*) n FROM academic_alerts WHERE school_id=? AND status='open' GROUP BY rule_key,term_id,class_id,subject_id,student_key HAVING COUNT(*)>1", [sid])
  check("Active Academic Intelligence rules are consolidated", duplicateRecommendations.length === 0 && duplicateAlerts.length === 0, { duplicate_recommendations: duplicateRecommendations.slice(0, 3), duplicate_alerts: duplicateAlerts.slice(0, 3) })

  const [terms] = await connection.query("SELECT name,status FROM terms WHERE school_id=? ORDER BY term_number", [sid])
  check("Term lifecycle", terms.some((row) => row.name === "Term 1" && row.status === "archived") && terms.some((row) => row.name === "Term 2" && row.status === "open") && terms.some((row) => row.name === "Term 3" && row.status === "upcoming"), terms)

  const [[missingGuardian]] = await connection.query("SELECT COUNT(*) value FROM students s LEFT JOIN student_guardians g ON g.school_id=s.school_id AND g.student_id=s.id WHERE s.school_id=? AND g.id IS NULL", [sid])
  check("Every learner has a guardian", Number(missingGuardian.value) === 0, { missing: Number(missingGuardian.value) })
  const [[duplicateAdmissions]] = await connection.query("SELECT COUNT(*) value FROM (SELECT admission_no FROM students WHERE school_id=? GROUP BY admission_no HAVING COUNT(*)>1) duplicates", [sid])
  check("Unique admissions", Number(duplicateAdmissions.value) === 0, { duplicate_groups: Number(duplicateAdmissions.value) })

  const [published] = await connection.query("SELECT v.id FROM timetable_versions v JOIN timetables t ON t.id=v.timetable_id WHERE t.school_id=? AND v.status='PUBLISHED'", [sid])
  const versionIds = published.map((row) => row.id)
  check("Published timetable", versionIds.length >= 1 && counts.timetable_entries >= 300, { published_versions: versionIds.length, entries: counts.timetable_entries })
  if (versionIds.length) {
    const marks = versionIds.map(() => "?").join(",")
    for (const [label, field] of [["teacher", "teacher_id"], ["room", "room_id"], ["class", "class_id"]]) {
      const [conflicts] = await connection.query(`SELECT timetable_version_id,cycle_day_id,slot_start_id,${field},COUNT(*) c FROM timetable_entries WHERE timetable_version_id IN (${marks}) AND ${field} IS NOT NULL GROUP BY timetable_version_id,cycle_day_id,slot_start_id,${field} HAVING COUNT(*)>1`, versionIds)
      check(`No published timetable ${label} conflicts`, conflicts.length === 0, conflicts.slice(0, 3))
    }
  }

  const [markMismatches] = await connection.query("SELECT a.id,a.total_marks,ROUND(SUM(aq.marks),2) question_marks FROM assessments a JOIN assessment_questions aq ON aq.assessment_id=a.id AND aq.school_id=a.school_id WHERE a.school_id=? GROUP BY a.id,a.total_marks HAVING ABS(SUM(aq.marks)-a.total_marks)>0.01", [sid])
  check("Detailed paper mark totals", markMismatches.length === 0, markMismatches.slice(0, 3))
  const [studentMarkMismatches] = await connection.query("SELECT re.result_batch_id,re.student_id,re.score,ROUND(SUM(qa.marks_awarded),2) question_score FROM result_entries re JOIN result_batches rb ON rb.id=re.result_batch_id JOIN question_attempts qa ON qa.assessment_id=rb.assessment_id AND qa.student_id=re.student_id AND qa.school_id=re.school_id WHERE re.school_id=? GROUP BY re.result_batch_id,re.student_id,re.score HAVING ABS(re.score-SUM(qa.marks_awarded))>0.01", [sid])
  check("Detailed learner totals equal question marks", studentMarkMismatches.length === 0, studentMarkMismatches.slice(0, 3))
  const [[scoreOverflow]] = await connection.query("SELECT COUNT(*) value FROM result_entries re JOIN result_batches rb ON rb.id=re.result_batch_id JOIN assessments a ON a.id=rb.assessment_id WHERE re.school_id=? AND re.score IS NOT NULL AND re.score>a.total_marks", [sid])
  check("Scores remain within assessment marks", Number(scoreOverflow.value) === 0, { overflow: Number(scoreOverflow.value) })
  const [[absentWithScore]] = await connection.query("SELECT COUNT(*) value FROM result_entries WHERE school_id=? AND status='absent' AND score IS NOT NULL", [sid])
  check("Absent results are not treated as zero", Number(absentWithScore.value) === 0, { absent_with_score: Number(absentWithScore.value) })
  const [averages] = await connection.query("SELECT rb.class_id,ROUND(AVG(re.score/a.total_marks*100),1) average_score FROM result_entries re JOIN result_batches rb ON rb.id=re.result_batch_id JOIN assessments a ON a.id=rb.assessment_id WHERE re.school_id=? AND re.score IS NOT NULL GROUP BY rb.class_id", [sid])
  check("Class results are not a single fallback average", new Set(averages.map((row) => String(row.average_score))).size > 1, averages.slice(0, 4))

  const [edges] = await connection.query("SELECT topic_id,prerequisite_topic_id FROM syllabus_topic_prerequisites WHERE school_id=?", [sid])
  const adjacency = new Map()
  for (const edge of edges) adjacency.set(Number(edge.topic_id), [...(adjacency.get(Number(edge.topic_id)) || []), Number(edge.prerequisite_topic_id)])
  const visiting = new Set(); const visited = new Set(); let cycle = false
  const visit = (node) => { if (visiting.has(node)) { cycle = true; return } if (visited.has(node)) return; visiting.add(node); for (const next of adjacency.get(node) || []) visit(next); visiting.delete(node); visited.add(node) }
  for (const node of adjacency.keys()) visit(node)
  check("Syllabus prerequisite graph is acyclic", !cycle, { edges: edges.length })

  console.log(JSON.stringify({ ok: checks.every((item) => item.pass), school: school.name, school_id: sid, counts, checks }, null, 2))
  if (checks.some((item) => !item.pass)) process.exitCode = 1
} finally {
  connection.release()
  await pool.end()
}

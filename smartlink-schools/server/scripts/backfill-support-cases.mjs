import "dotenv/config"
import { pool } from "../src/config/db.js"
import { syncSupportCasesFromPublishedAssessment } from "../src/services/academicSupportService.js"

const schoolName = process.argv.find((arg) => arg.startsWith("--school="))?.slice(9) || "Greenfield Academy"
const allTerms = process.argv.includes("--all-terms")
const [[school]] = await pool.query("SELECT id,name FROM schools WHERE name=? LIMIT 1", [schoolName])
if (!school) throw new Error(`School not found: ${schoolName}`)
const [[actor]] = await pool.query("SELECT id,role FROM users WHERE school_id=? AND role IN ('headteacher','school_owner') AND employment_status='active' ORDER BY FIELD(role,'headteacher','school_owner'),id LIMIT 1", [school.id])
if (!actor) throw new Error("An active headteacher or school owner is required for support-case audit attribution")
const activeClause = allTerms ? "" : " AND ay.status='active' AND t.status IN ('open','marking')"
const [assessments] = await pool.query(`SELECT DISTINCT a.id,a.name,a.academic_year_id,a.term_id,a.class_id,a.subject_id,c.public_ref class_ref FROM assessments a JOIN academic_mark_sheets ams ON ams.school_id=a.school_id AND ams.assessment_id=a.id AND ams.status IN ('published','locked') JOIN academic_years ay ON ay.school_id=a.school_id AND ay.id=a.academic_year_id JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN mastery_evidence me ON me.school_id=a.school_id AND me.assessment_id=a.id AND me.topic_id IS NOT NULL AND me.publication_state IN ('published','locked') AND me.evidence_status='valid' WHERE a.school_id=?${activeClause} ORDER BY a.id`, [school.id])

let touched = 0
let weakEvidence = 0
for (const assessment of assessments) {
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const result = await syncSupportCasesFromPublishedAssessment(db, school.id, assessment, actor)
    await db.commit()
    touched += result.cases_touched.length
    weakEvidence += result.weak_evidence_count
  } catch (error) {
    await db.rollback()
    throw new Error(`Support backfill failed for assessment ${assessment.id} (${assessment.name}): ${error.message}`, { cause: error })
  } finally { db.release() }
}
const [[counts]] = await pool.query("SELECT COUNT(*) total,SUM(status NOT IN ('resolved','closed_inconclusive')) active,SUM(scope_type='class') class_cases,SUM(scope_type='group') group_cases,SUM(scope_type='learner') learner_cases FROM learner_support_cases WHERE school_id=?", [school.id])
console.log(JSON.stringify({ status: "completed", school: school.name, assessments_reviewed: assessments.length, case_touches: touched, weak_evidence_reviewed: weakEvidence, cases: counts }, null, 2))
await pool.end()

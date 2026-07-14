import dotenv from "dotenv"
import { pool } from "../src/config/db.js"
import { ingestApprovedResultBatch, recalculateQuestionAnalytics } from "../src/services/academicIntelligenceEngine.js"

dotenv.config()
const DEMO_CODE = "GFA"
const DEMO_PASSWORD = "Greenfield#2026"
if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_DATA_TOOLS !== "true") {
  throw new Error("Greenfield demo recalculation is disabled in production. Set ENABLE_DEMO_DATA_TOOLS=true for a controlled development run.")
}

const connection = await pool.getConnection()
try {
  const [[school]] = await connection.query("SELECT id,name FROM schools WHERE code=? LIMIT 1", [DEMO_CODE])
  if (!school) throw new Error(`Demo school ${DEMO_CODE} is not seeded. Run npm run demo:greenfield first.`)
  const [[owner]] = await connection.query("SELECT id,role FROM users WHERE school_id=? AND role='school_owner' ORDER BY id LIMIT 1", [school.id])
  const [batches] = await connection.query("SELECT id FROM result_batches WHERE school_id=? AND status='approved' ORDER BY id", [school.id])
  const [questions] = await connection.query("SELECT id FROM question_bank WHERE school_id=? ORDER BY id", [school.id])
  connection.release()

  const actor = owner ? { id: owner.id, role: owner.role } : null
  let processed = 0
  let students = 0
  for (const batch of batches) {
    const result = await ingestApprovedResultBatch(school.id, batch.id, actor)
    processed += 1
    students += Number(result.students_processed || 0)
  }
  let analytics = 0
  for (const question of questions) {
    await recalculateQuestionAnalytics(school.id, question.id)
    analytics += 1
  }
  console.log(JSON.stringify({ ok: true, school: school.name, school_id: school.id, approved_batches: processed, result_entries_processed: students, question_analytics: analytics, login_password: DEMO_PASSWORD }, null, 2))
} catch (error) {
  try { connection.release() } catch {}
  console.error(error)
  process.exitCode = 1
} finally {
  await pool.end()
}

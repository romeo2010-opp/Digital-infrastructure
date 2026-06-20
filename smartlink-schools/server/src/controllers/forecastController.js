import { pool } from "../config/db.js"
import { calculateExamPriorityScore } from "../services/recommendationService.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"

export async function listForecasts(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [rows] = await pool.query(
    `SELECT exam_track, subject_name, topic_name, frequency_score, marks_weight, recency_gap, weakness_level
     FROM exam_forecast_topics
     WHERE school_id = ?
     ORDER BY subject_name, topic_name`,
    [schoolId],
  )

  res.json({
    forecasts: rows.map((row) => ({
      ...row,
      priority_score: calculateExamPriorityScore(row),
    })),
  })
}

import { getScopedSchoolId } from "../utils/tenantScope.js"
import { pool } from "../config/db.js"
import { getAiStatus, getAiUsageSummary, testConnection } from "../services/ai/aiClient.js"

export async function getAiStatusController(_req, res) {
  res.json({ ai: await getAiStatus() })
}

export async function testAiController(req, res) {
  const result = await testConnection({ schoolId: getScopedSchoolId(req), userId: req.user.id })
  res.json({ ai: result })
}

export async function getAiUsageSummaryController(req, res) {
  res.json({ usage: await getAiUsageSummary(getScopedSchoolId(req)) })
}

export async function updateAiSettingsController(req, res) {
  const schoolId = getScopedSchoolId(req)
  const monthlyBudgetProvided = req.body.ai_monthly_budget_usd !== undefined
  const dailyLimitProvided = req.body.ai_daily_request_limit !== undefined
  const aiEnabled = req.body.ai_enabled === undefined ? null : Number(Boolean(req.body.ai_enabled))
  const monthlyBudget = req.body.ai_monthly_budget_usd === undefined || req.body.ai_monthly_budget_usd === ""
    ? null
    : Number(req.body.ai_monthly_budget_usd)
  const dailyLimit = req.body.ai_daily_request_limit === undefined || req.body.ai_daily_request_limit === ""
    ? null
    : Number(req.body.ai_daily_request_limit)
  await pool.query(
    `INSERT INTO school_ai_settings (
      school_id, ai_enabled, ai_monthly_budget_usd, ai_daily_request_limit, provider, model, updated_by
    ) VALUES (?, COALESCE(?, 1), ?, ?, 'gemini', 'gemini-2.5-flash', ?)
    ON DUPLICATE KEY UPDATE
      ai_enabled = IF(? IS NULL, ai_enabled, VALUES(ai_enabled)),
      ai_monthly_budget_usd = IF(? = 0, ai_monthly_budget_usd, VALUES(ai_monthly_budget_usd)),
      ai_daily_request_limit = IF(? = 0, ai_daily_request_limit, VALUES(ai_daily_request_limit)),
      provider = 'gemini',
      model = 'gemini-2.5-flash',
      updated_by = VALUES(updated_by)`,
    [schoolId, aiEnabled, monthlyBudget, dailyLimit, req.user.id, aiEnabled, monthlyBudgetProvided ? 1 : 0, dailyLimitProvided ? 1 : 0],
  )
  res.json({ usage: await getAiUsageSummary(schoolId) })
}

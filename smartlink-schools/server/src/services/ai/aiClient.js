import { pool } from "../../config/db.js"
import { createGeminiProvider, GEMINI_NOT_CONFIGURED_MESSAGE } from "./providers/geminiProvider.js"
import { createNullProvider } from "./providers/nullProvider.js"

export const AI_LIMIT_MESSAGE = "AI limit reached for this school. Existing approved drills still work."

let lastConnectionTest = {
  status: null,
  error: null,
  checked_at: null,
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

function intFromEnv(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function aiConfig() {
  const provider = String(process.env.AI_PROVIDER || "gemini").toLowerCase()
  return {
    enabled: boolFromEnv(process.env.AI_ENABLED, true),
    provider,
    model: process.env.AI_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY || "",
    timeoutMs: intFromEnv(process.env.AI_TIMEOUT_MS, 60000),
    maxRetries: intFromEnv(process.env.AI_MAX_RETRIES, 1),
    logRawResponses: boolFromEnv(process.env.AI_LOG_RAW_RESPONSES, false),
    requireTeacherApproval: boolFromEnv(process.env.AI_REQUIRE_TEACHER_APPROVAL, true),
  }
}

export function getAiProvider() {
  const config = aiConfig()
  if (!config.enabled) {
    return createNullProvider({
      ...config,
      message: "AI assistance is disabled. Upload, review, and manual approval features are still available.",
    })
  }
  if (config.provider !== "gemini") {
    return createNullProvider({
      ...config,
      provider: "gemini",
      message: "Only Gemini is enabled for this pilot. Set AI_PROVIDER=gemini to use AI assistance.",
    })
  }
  if (!config.apiKey) return createNullProvider(config)
  return createGeminiProvider(config)
}

function parseJson(raw) {
  const text = String(raw || "").trim()
  if (!text) throw new Error("AI returned an empty response")
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (!match) throw new Error("AI response did not contain JSON")
    return JSON.parse(match[0])
  }
}

function addUsage(left = {}, right = {}) {
  const inputTokens = Number(left.inputTokens || 0) + Number(right.inputTokens || 0)
  const outputTokens = Number(left.outputTokens || 0) + Number(right.outputTokens || 0)
  return {
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
  }
}

function estimateGeminiCostUsd({ model, inputTokens, outputTokens }) {
  if (inputTokens === null && outputTokens === null) return null
  const defaultInputPrice = model === "gemini-2.5-flash" ? 0.3 : null
  const defaultOutputPrice = model === "gemini-2.5-flash" ? 2.5 : null
  const inputPrice = Number(process.env.AI_INPUT_COST_PER_1M_USD ?? defaultInputPrice)
  const outputPrice = Number(process.env.AI_OUTPUT_COST_PER_1M_USD ?? defaultOutputPrice)
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null
  return Number((((Number(inputTokens || 0) / 1000000) * inputPrice) + ((Number(outputTokens || 0) / 1000000) * outputPrice)).toFixed(8))
}

function safeDbMissing(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_TABLEACCESS_DENIED_ERROR"].includes(error?.code)
}

async function getSchoolAiSettings(schoolId) {
  if (!schoolId) return { ai_enabled: 1, ai_monthly_budget_usd: null, ai_daily_request_limit: null }
  try {
    const [[settings]] = await pool.query(
      `SELECT ai_enabled, ai_monthly_budget_usd, ai_daily_request_limit
       FROM school_ai_settings
       WHERE school_id = ?
       LIMIT 1`,
      [schoolId],
    )
    return settings || { ai_enabled: 1, ai_monthly_budget_usd: null, ai_daily_request_limit: null }
  } catch (error) {
    if (safeDbMissing(error)) return { ai_enabled: 1, ai_monthly_budget_usd: null, ai_daily_request_limit: null }
    throw error
  }
}

export async function assertSchoolAiAllowed(schoolId) {
  if (!schoolId) return { allowed: true }
  const settings = await getSchoolAiSettings(schoolId)
  if (!Number(settings.ai_enabled)) return { allowed: false, message: AI_LIMIT_MESSAGE, settings }

  try {
    const [[daily]] = await pool.query(
      `SELECT COUNT(*) AS requests_today
       FROM ai_usage_logs
       WHERE school_id = ? AND created_at >= CURDATE()`,
      [schoolId],
    )
    if (settings.ai_daily_request_limit !== null && Number(settings.ai_daily_request_limit) > 0) {
      if (Number(daily?.requests_today || 0) >= Number(settings.ai_daily_request_limit)) {
        return { allowed: false, message: AI_LIMIT_MESSAGE, settings }
      }
    }

    const [[month]] = await pool.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
       FROM ai_usage_logs
       WHERE school_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [schoolId],
    )
    if (settings.ai_monthly_budget_usd !== null && Number(settings.ai_monthly_budget_usd) > 0) {
      if (Number(month?.estimated_cost_usd || 0) >= Number(settings.ai_monthly_budget_usd)) {
        return { allowed: false, message: AI_LIMIT_MESSAGE, settings }
      }
    }
  } catch (error) {
    if (!safeDbMissing(error)) throw error
  }
  return { allowed: true, settings }
}

export async function logAiUsage({ schoolId = null, userId = null, featureName, model, usage = {} }) {
  const inputTokens = usage.inputTokens ?? null
  const outputTokens = usage.outputTokens ?? null
  const estimatedCostUsd = estimateGeminiCostUsd({ model, inputTokens, outputTokens })
  const params = [schoolId || null, userId || null, featureName, model || "gemini-2.5-flash", inputTokens, outputTokens, estimatedCostUsd]
  try {
    await pool.query(
      `INSERT INTO ai_usage_logs (
        school_id, user_id, feature_name, model, input_tokens, output_tokens, estimated_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params,
    )
  } catch (error) {
    if (error?.code === "ER_NO_REFERENCED_ROW_2" && String(error?.message || "").includes("fk_ai_usage_user")) {
      await pool.query(
        `INSERT INTO ai_usage_logs (
          school_id, user_id, feature_name, model, input_tokens, output_tokens, estimated_cost_usd
        ) VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [schoolId || null, featureName, model || "gemini-2.5-flash", inputTokens, outputTokens, estimatedCostUsd],
      )
      return
    }
    if (String(error?.message || "").includes("Data truncated for column 'feature_name'")) {
      console.warn("[smartlink-ai] usage logging skipped because the ai_usage_logs feature enum is outdated.")
      return
    }
    if (!safeDbMissing(error)) throw error
  }
}

function logRawResponseIfEnabled(config, featureName, raw) {
  if (!config.logRawResponses) return
  console.info("[smartlink-ai] raw_response", JSON.stringify({
    feature_name: featureName,
    provider: "gemini",
    model: config.model,
    raw,
  }))
}

async function runStructuredRequest({
  featureName,
  prompt,
  schemaHint,
  responseSchema,
  validate,
  fallback,
  schoolId = null,
  userId = null,
}) {
  const config = aiConfig()
  const provider = getAiProvider()
  const status = await provider.status()
  if (!status.available) {
    return {
      ok: false,
      unavailable: true,
      provider: status.provider,
      model: status.model,
      data: fallback || null,
      raw: "",
      usage: { inputTokens: null, outputTokens: null },
      message: status.message || GEMINI_NOT_CONFIGURED_MESSAGE,
    }
  }

  const limit = await assertSchoolAiAllowed(schoolId)
  if (!limit.allowed) {
    return {
      ok: false,
      blocked: true,
      provider: status.provider,
      model: status.model,
      data: fallback || null,
      raw: "",
      usage: { inputTokens: null, outputTokens: null },
      message: limit.message || AI_LIMIT_MESSAGE,
    }
  }

  let lastError = null
  let raw = ""
  let usage = {}
  const attempts = Math.max(1, config.maxRetries + 1)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await provider.generateJson({
        prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous response was invalid JSON. Return corrected JSON only.`,
        schemaHint,
        responseSchema,
      })
      raw = result.raw || ""
      usage = addUsage(usage, result.usage || {})
      logRawResponseIfEnabled(config, featureName, raw)
      const data = parseJson(raw)
      if (validate) validate(data)
      await logAiUsage({ schoolId, userId, featureName, model: result.model || provider.model, usage })
      return { ok: true, provider: result.provider || provider.name, model: result.model || provider.model, data, raw, usage }
    } catch (error) {
      lastError = error
    }
  }

  await logAiUsage({ schoolId, userId, featureName, model: provider.model, usage })
  return {
    ok: false,
    provider: provider.name,
    model: provider.model,
    data: fallback || null,
    raw,
    usage,
    message: lastError?.message || "AI returned invalid JSON",
  }
}

export async function getAiStatus() {
  const status = await getAiProvider().status()
  return {
    provider: "gemini",
    model: status.model || "gemini-2.5-flash",
    configured: Boolean(status.configured),
    available: Boolean(status.available),
    message: status.message,
    last_test_status: lastConnectionTest.status,
    last_test_error: lastConnectionTest.error,
    last_test_at: lastConnectionTest.checked_at,
  }
}

export async function extractSyllabusStructure(input = {}) {
  return runStructuredRequest({ ...input, featureName: "syllabus_extraction" })
}

export async function generateQuestionDrafts(input = {}) {
  return runStructuredRequest({ ...input, featureName: "question_generation" })
}

export async function generateAnswerExplanation(input = {}) {
  return runStructuredRequest({ ...input, featureName: "question_generation" })
}

export async function adaptExplanationForStudent(input = {}) {
  return runStructuredRequest({ ...input, featureName: "explanation_adaptation" })
}

export async function testConnection({ schoolId = null, userId = null } = {}) {
  const result = await runStructuredRequest({
    featureName: "ai_test",
    schoolId,
    userId,
    prompt: "Return JSON with keys ok and message. Message should be SmartLink AI is ready.",
    schemaHint: '{"ok":true,"message":""}',
    responseSchema: {
      type: "OBJECT",
      properties: {
        ok: { type: "BOOLEAN" },
        message: { type: "STRING" },
      },
      required: ["ok", "message"],
    },
    validate(payload) {
      if (!payload || typeof payload !== "object") throw new Error("Invalid test response")
    },
    fallback: { ok: false, message: GEMINI_NOT_CONFIGURED_MESSAGE },
  })
  lastConnectionTest = {
    status: result.ok ? "ok" : "failed",
    error: result.ok ? null : result.message || "Gemini test failed",
    checked_at: new Date().toISOString(),
  }
  return result
}

export async function getAiUsageSummary(schoolId) {
  const empty = {
    requests_today: 0,
    requests_this_month: 0,
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    estimated_cost_usd: 0,
    top_features: [],
    settings: await getSchoolAiSettings(schoolId),
  }
  try {
    const [[today]] = await pool.query(
      `SELECT COUNT(*) AS requests_today
       FROM ai_usage_logs
       WHERE school_id = ? AND created_at >= CURDATE()`,
      [schoolId],
    )
    const [[month]] = await pool.query(
      `SELECT COUNT(*) AS requests_this_month,
        COALESCE(SUM(input_tokens), 0) AS estimated_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS estimated_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
       FROM ai_usage_logs
       WHERE school_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [schoolId],
    )
    const [topFeatures] = await pool.query(
      `SELECT feature_name, COUNT(*) AS requests, COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
       FROM ai_usage_logs
       WHERE school_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       GROUP BY feature_name
       ORDER BY requests DESC, feature_name
       LIMIT 10`,
      [schoolId],
    )
    return {
      requests_today: Number(today?.requests_today || 0),
      requests_this_month: Number(month?.requests_this_month || 0),
      estimated_input_tokens: Number(month?.estimated_input_tokens || 0),
      estimated_output_tokens: Number(month?.estimated_output_tokens || 0),
      estimated_cost_usd: Number(Number(month?.estimated_cost_usd || 0).toFixed(8)),
      top_features: topFeatures.map((row) => ({
        feature_name: row.feature_name,
        requests: Number(row.requests || 0),
        estimated_cost_usd: Number(Number(row.estimated_cost_usd || 0).toFixed(8)),
      })),
      settings: await getSchoolAiSettings(schoolId),
    }
  } catch (error) {
    if (safeDbMissing(error)) return empty
    throw error
  }
}

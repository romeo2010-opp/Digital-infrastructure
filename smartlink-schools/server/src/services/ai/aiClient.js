import { pool } from "../../config/db.js"
import { createGeminiProvider, GEMINI_NOT_CONFIGURED_MESSAGE } from "./providers/geminiProvider.js"
import { createNullProvider } from "./providers/nullProvider.js"
import { createOpenAiProvider, OPENAI_NOT_CONFIGURED_MESSAGE } from "./providers/openaiProvider.js"
import { createAnthropicProvider, ANTHROPIC_NOT_CONFIGURED_MESSAGE } from "./providers/anthropicProvider.js"

export const AI_LIMIT_MESSAGE = "AI limit reached for this school. Existing approved drills still work."
const DEFAULT_AI_TIMEOUT_MS = 180000
const DEFAULT_AI_LOGIN_CHECK_TIMEOUT_MS = 15000

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

function aiConfig(overrides = {}) {
  const assessmentVision = overrides.featureName === "assessment_pdf_import"
  const academicIntelligence = overrides.featureName === "academic_intelligence"
  const provider = String(overrides.provider || (assessmentVision ? process.env.ASSESSMENT_VISION_AI_PROVIDER : academicIntelligence ? process.env.ACADEMIC_AI_PROVIDER : null) || process.env.AI_PROVIDER || "gemini").toLowerCase()
  const defaultModel = provider === "openai" ? "gpt-5.4" : provider === "anthropic" ? "claude-sonnet-4-20250514" : "gemini-2.5-flash"
  const model = overrides.model || (assessmentVision ? process.env.ASSESSMENT_VISION_AI_MODEL : academicIntelligence ? process.env.ACADEMIC_AI_MODEL : null) || process.env.AI_MODEL || defaultModel
  return {
    enabled: boolFromEnv(academicIntelligence ? process.env.ACADEMIC_AI_ENABLED : process.env.AI_ENABLED, academicIntelligence ? false : true),
    provider,
    model,
    apiKey: provider === "openai" ? process.env.OPENAI_API_KEY || "" : provider === "anthropic" ? process.env.ANTHROPIC_API_KEY || "" : process.env.GEMINI_API_KEY || "",
    timeoutMs: intFromEnv(overrides.timeoutMs ?? (academicIntelligence ? process.env.ACADEMIC_AI_TIMEOUT_MS : null) ?? process.env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS),
    maxRetries: intFromEnv(academicIntelligence ? process.env.ACADEMIC_AI_MAX_RETRIES : process.env.AI_MAX_RETRIES, 1),
    logRawResponses: boolFromEnv(process.env.AI_LOG_RAW_RESPONSES, false),
    requireTeacherApproval: boolFromEnv(process.env.AI_REQUIRE_TEACHER_APPROVAL, true),
    visionDetail: assessmentVision ? String(process.env.ASSESSMENT_VISION_DETAIL || "high").toLowerCase() : "auto",
    maxOutputTokens: intFromEnv(process.env.ASSESSMENT_VISION_MAX_OUTPUT_TOKENS, 60000),
  }
}

function aiLoginCheckTimeoutMs() {
  return intFromEnv(process.env.AI_LOGIN_CHECK_TIMEOUT_MS, DEFAULT_AI_LOGIN_CHECK_TIMEOUT_MS)
}

export function getAiProvider(overrides = {}) {
  const config = aiConfig(overrides)
  if (!config.enabled) {
    return createNullProvider({
      ...config,
      message: "AI assistance is disabled. Upload, review, and manual approval features are still available.",
    })
  }
  if (config.provider === "openai") {
    if (!config.apiKey) return createNullProvider({ ...config, message: OPENAI_NOT_CONFIGURED_MESSAGE })
    return createOpenAiProvider(config)
  }
  if (config.provider === "anthropic") {
    if (!config.apiKey) return createNullProvider({ ...config, message: ANTHROPIC_NOT_CONFIGURED_MESSAGE })
    return createAnthropicProvider(config)
  }
  if (config.provider !== "gemini") {
    return createNullProvider({
      ...config,
      message: `Unsupported AI provider '${config.provider}'. Use openai, gemini, anthropic or disabled deterministic mode.`,
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

export async function assertSchoolAiAllowed(schoolId, featureName = null) {
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
    if (featureName === "academic_intelligence") {
      const dailyBudget = Number(process.env.ACADEMIC_AI_DAILY_BUDGET || 0)
      if (Number.isFinite(dailyBudget) && dailyBudget > 0) {
        const [[academicDaily]] = await pool.query(
          `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
           FROM ai_usage_logs
           WHERE school_id=? AND feature_name='academic_intelligence' AND created_at >= CURDATE()`,
          [schoolId],
        )
        if (Number(academicDaily?.estimated_cost_usd || 0) >= dailyBudget) return { allowed: false, message: 'Academic AI daily budget reached.', settings }
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

function logRawResponseIfEnabled(config, featureName, raw, provider, model) {
  if (!config.logRawResponses) return
  console.info("[smartlink-ai] raw_response", JSON.stringify({
    feature_name: featureName,
    provider,
    model,
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
  timeoutMs = null,
  attachments = [],
}) {
  const config = aiConfig({ timeoutMs, featureName })
  const primaryProvider = getAiProvider({ timeoutMs, featureName })
  const providers = [{ provider: primaryProvider, fallback: false }]
  if (featureName === "assessment_pdf_import") {
    const fallbackName = String(process.env.ASSESSMENT_VISION_FALLBACK_PROVIDER || "gemini").toLowerCase()
    if (fallbackName && fallbackName !== config.provider) {
      providers.push({
        provider: getAiProvider({
          timeoutMs,
          featureName,
          provider: fallbackName,
          model: process.env.ASSESSMENT_VISION_FALLBACK_MODEL || (fallbackName === "openai" ? "gpt-5.4" : "gemini-2.5-flash"),
        }),
        fallback: true,
      })
    }
  }
  const providerStatuses = await Promise.all(providers.map(async (entry) => ({ ...entry, status: await entry.provider.status() })))
  const availableProviders = providerStatuses.filter((entry) => entry.status.available)
  if (!availableProviders.length) {
    const status = providerStatuses[0]?.status || {}
    return {
      ok: false,
      unavailable: true,
      provider: status.provider,
      model: status.model,
      data: fallback || null,
      raw: "",
      usage: { inputTokens: null, outputTokens: null },
      message: providerStatuses.map((entry) => entry.status.message).filter(Boolean).join(" Fallback: ") || GEMINI_NOT_CONFIGURED_MESSAGE,
    }
  }

  const limit = await assertSchoolAiAllowed(schoolId, featureName)
  if (!limit.allowed) {
    const status = availableProviders[0]?.status || {}
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
  const providerErrors = []
  let raw = ""
  let usage = {}
  const attempts = Math.max(1, config.maxRetries + 1)
  let lastProvider = availableProviders[0]?.provider
  for (const providerEntry of availableProviders) {
    const provider = providerEntry.provider
    lastProvider = provider
    let providerLastError = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await provider.generateJson({
          prompt: attempt === 0 ? prompt : `${prompt}\n\nThe previous attempt did not produce valid data. Re-check every PDF page and return corrected JSON only.`,
          schemaHint,
          responseSchema,
          attachments,
        })
        raw = result.raw || ""
        usage = addUsage(usage, result.usage || {})
        logRawResponseIfEnabled(config, featureName, raw, result.provider || provider.name, result.model || provider.model)
        const data = parseJson(raw)
        if (validate) validate(data)
        await logAiUsage({ schoolId, userId, featureName, model: result.model || provider.model, usage })
        return { ok: true, provider: result.provider || provider.name, model: result.model || provider.model, data, raw, usage, fallbackUsed: providerEntry.fallback }
      } catch (error) {
        lastError = error
        providerLastError = error
        if (/quota|billing|invalid api key|authentication|model .*not found|permission/i.test(String(error?.message || ""))) break
      }
    }
    if(providerLastError)providerErrors.push(`${provider.name} (${provider.model}): ${providerLastError.message}`)
  }

  await logAiUsage({ schoolId, userId, featureName, model: lastProvider?.model, usage })
  return {
    ok: false,
    provider: lastProvider?.name || config.provider,
    model: lastProvider?.model || config.model,
    data: fallback || null,
    raw,
    usage,
    message: providerErrors.join(" Fallback: ") || lastError?.message || "AI returned invalid JSON",
    providerErrors,
  }
}

export async function getAiStatus() {
  const provider = getAiProvider()
  const status = await provider.status()
  return {
    provider: status.provider || provider.name,
    model: status.model || provider.model,
    configured: Boolean(status.configured),
    available: Boolean(status.available),
    online: lastConnectionTest.status === null ? null : lastConnectionTest.status === "ok",
    message: status.message,
    last_test_status: lastConnectionTest.status,
    last_test_error: lastConnectionTest.error,
    last_test_at: lastConnectionTest.checked_at,
    timeout_ms: aiConfig().timeoutMs,
    login_check_timeout_ms: aiLoginCheckTimeoutMs(),
  }
}

export async function probeAiConnection({ timeoutMs = null } = {}) {
  const config = aiConfig({ timeoutMs: timeoutMs || aiLoginCheckTimeoutMs() })
  const provider = getAiProvider({ timeoutMs: config.timeoutMs })
  const status = await provider.status()
  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()
  if (!status.available) {
    lastConnectionTest = {
      status: "failed",
      error: status.message || GEMINI_NOT_CONFIGURED_MESSAGE,
      checked_at: checkedAt,
    }
    return {
      ok: false,
      online: false,
      provider: status.provider || "gemini",
      model: status.model || config.model,
      configured: Boolean(status.configured),
      message: status.message || GEMINI_NOT_CONFIGURED_MESSAGE,
      checked_at: checkedAt,
      response_ms: Date.now() - startedAt,
      timeout_ms: config.timeoutMs,
    }
  }

  try {
    const result = await provider.generateJson({
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
    })
    const payload = parseJson(result.raw)
    lastConnectionTest = {
      status: payload?.ok === false ? "failed" : "ok",
      error: payload?.ok === false ? payload?.message || "AI provider test failed" : null,
      checked_at: checkedAt,
    }
    return {
      ok: payload?.ok !== false,
      online: payload?.ok !== false,
      provider: result.provider || provider.name,
      model: result.model || provider.model,
      configured: true,
      message: payload?.message || "SmartLink AI is ready.",
      checked_at: checkedAt,
      response_ms: Date.now() - startedAt,
      timeout_ms: config.timeoutMs,
    }
  } catch (error) {
    const message = error?.message || "AI connection check failed"
    lastConnectionTest = {
      status: "failed",
      error: message,
      checked_at: checkedAt,
    }
    return {
      ok: false,
      online: false,
      provider: provider.name,
      model: provider.model,
      configured: Boolean(provider.configured),
      message,
      checked_at: checkedAt,
      response_ms: Date.now() - startedAt,
      timeout_ms: config.timeoutMs,
    }
  }
}

export async function extractSyllabusStructure(input = {}) {
  return runStructuredRequest({ ...input, featureName: "syllabus_extraction" })
}

export async function extractExamPaperQuestions(input = {}) {
  return runStructuredRequest({ ...input, featureName: "exam_paper_extraction" })
}

export async function parseAssessmentImportDocument(input = {}) {
  return runStructuredRequest({ ...input, featureName: "assessment_pdf_import" })
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

// Academic narration is intentionally a separate feature. It receives only
// validated findings and has a deterministic caller-owned fallback when the
// provider is disabled, unavailable, over budget, or returns invalid JSON.
export async function interpretAcademicFindings(input = {}) {
  return runStructuredRequest({ ...input, featureName: "academic_intelligence" })
}

export async function testConnection({ schoolId = null, userId = null, timeoutMs = null } = {}) {
  const result = await runStructuredRequest({
    featureName: "ai_test",
    schoolId,
    userId,
    timeoutMs,
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

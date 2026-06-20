export const GEMINI_NOT_CONFIGURED_MESSAGE =
  "AI assistance is not configured yet. Upload, review, and manual approval features are still available."

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function safeGeminiError(error, apiKey) {
  const raw = String(error?.message || "Gemini request failed")
  return apiKey ? raw.replaceAll(apiKey, "[redacted]") : raw
}

function textFromGeminiResponse(payload = {}) {
  const parts = []
  for (const candidate of payload.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.text) parts.push(part.text)
    }
  }
  return parts.join("\n").trim()
}

function usageFromGeminiResponse(payload = {}) {
  const usage = payload.usageMetadata || {}
  return {
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? usage.outputTokenCount ?? null,
    totalTokens: usage.totalTokenCount ?? null,
  }
}

export function createGeminiProvider(config = {}) {
  const model = config.model || "gemini-2.5-flash"
  const apiKey = config.apiKey || ""
  const timeoutMs = positiveInt(config.timeoutMs, 60000)

  return {
    name: "gemini",
    model,
    configured: Boolean(apiKey),
    async status() {
      return {
        available: Boolean(apiKey),
        configured: Boolean(apiKey),
        provider: "gemini",
        model,
        message: apiKey ? "Gemini configuration is present." : GEMINI_NOT_CONFIGURED_MESSAGE,
      }
    },
    async generateJson({ prompt, schemaHint, responseSchema }) {
      if (!apiKey) throw new Error(GEMINI_NOT_CONFIGURED_MESSAGE)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const generationConfig = {
          response_mime_type: "application/json",
          temperature: 0.2,
        }
        if (responseSchema) generationConfig.response_schema = responseSchema

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{
                text: `${prompt}\n\nReturn JSON only. ${schemaHint || ""}`.trim(),
              }],
            }],
            generationConfig,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const message = payload?.error?.message || `Gemini request failed (${response.status})`
          throw new Error(message)
        }
        const raw = textFromGeminiResponse(payload)
        return {
          ok: true,
          raw,
          usage: usageFromGeminiResponse(payload),
          model,
          provider: "gemini",
        }
      } catch (error) {
        if (error?.name === "AbortError") throw new Error(`Gemini request timed out after ${timeoutMs}ms`)
        throw new Error(safeGeminiError(error, apiKey))
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

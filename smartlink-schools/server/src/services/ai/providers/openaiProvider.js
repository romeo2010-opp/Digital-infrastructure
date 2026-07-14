export const OPENAI_NOT_CONFIGURED_MESSAGE =
  "OpenAI exam vision is not configured. Add OPENAI_API_KEY or enable the configured fallback provider."

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function safeOpenAiError(error, apiKey) {
  const raw = String(error?.message || "OpenAI request failed")
  return apiKey ? raw.replaceAll(apiKey, "[redacted]") : raw
}

function outputText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim()
  const parts = []
  for (const item of payload.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) parts.push(content.text)
    }
  }
  return parts.join("\n").trim()
}

function usageFromResponse(payload = {}) {
  return {
    inputTokens: payload.usage?.input_tokens ?? null,
    outputTokens: payload.usage?.output_tokens ?? null,
    totalTokens: payload.usage?.total_tokens ?? null,
  }
}

function inputPart(attachment, detail) {
  if (!attachment?.data || !attachment?.mimeType) return null
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`
  if (attachment.mimeType === "application/pdf") {
    return {
      type: "input_file",
      filename: attachment.filename || "assessment.pdf",
      file_data: dataUrl,
      detail,
    }
  }
  if (String(attachment.mimeType).startsWith("image/")) {
    return { type: "input_image", image_url: dataUrl, detail }
  }
  return {
    type: "input_file",
    filename: attachment.filename || "attachment",
    file_data: dataUrl,
  }
}

export function createOpenAiProvider(config = {}) {
  const model = config.model || "gpt-5.4"
  const apiKey = config.apiKey || ""
  const timeoutMs = positiveInt(config.timeoutMs, 240000)
  const maxOutputTokens = positiveInt(config.maxOutputTokens, 60000)
  const detail = ["low", "high", "auto"].includes(config.visionDetail) ? config.visionDetail : "high"

  return {
    name: "openai",
    model,
    configured: Boolean(apiKey),
    async status() {
      return {
        available: Boolean(apiKey),
        configured: Boolean(apiKey),
        provider: "openai",
        model,
        message: apiKey ? "OpenAI exam vision configuration is present." : OPENAI_NOT_CONFIGURED_MESSAGE,
      }
    },
    async generateJson({ prompt, schemaHint, attachments = [] }) {
      if (!apiKey) throw new Error(OPENAI_NOT_CONFIGURED_MESSAGE)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const mediaParts = attachments.map((attachment) => inputPart(attachment, detail)).filter(Boolean)
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            store: false,
            max_output_tokens: maxOutputTokens,
            input: [{
              role: "user",
              content: [
                ...mediaParts,
                {
                  type: "input_text",
                  text: `${prompt}\n\nReturn one valid JSON object only. Required shape: ${schemaHint || "{}"}`,
                },
              ],
            }],
            text: { format: { type: "json_object" } },
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const requestId = response.headers.get("x-request-id")
          const message = payload?.error?.message || `OpenAI request failed (${response.status})`
          throw new Error(`${message}${requestId ? ` [request ${requestId}]` : ""}`)
        }
        const raw = outputText(payload)
        if (!raw) throw new Error("OpenAI returned no structured output")
        return {
          ok: true,
          raw,
          usage: usageFromResponse(payload),
          model: payload.model || model,
          provider: "openai",
          responseId: payload.id || null,
        }
      } catch (error) {
        if (error?.name === "AbortError") throw new Error(`OpenAI exam vision timed out after ${timeoutMs}ms`)
        throw new Error(safeOpenAiError(error, apiKey))
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

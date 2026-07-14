export const ANTHROPIC_NOT_CONFIGURED_MESSAGE =
  'Anthropic AI assistance is not configured. Add ANTHROPIC_API_KEY or use deterministic mode.'

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function safeError(error, apiKey) {
  const raw = String(error?.message || 'Anthropic request failed')
  return apiKey ? raw.replaceAll(apiKey, '[redacted]') : raw
}

function contentParts(attachments = []) {
  return attachments.filter((attachment) => attachment?.data && attachment?.mimeType).map((attachment) => {
    if (String(attachment.mimeType).startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data } }
    if (attachment.mimeType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data }, title: attachment.filename || 'assessment.pdf' }
    return null
  }).filter(Boolean)
}

export function createAnthropicProvider(config = {}) {
  const model = config.model || 'claude-sonnet-4-20250514'
  const apiKey = config.apiKey || ''
  const timeoutMs = positiveInt(config.timeoutMs, 15000)
  const maxTokens = Math.min(positiveInt(config.maxOutputTokens, 8192), 64000)
  return {
    name: 'anthropic',
    model,
    configured: Boolean(apiKey),
    async status() {
      return { available: Boolean(apiKey), configured: Boolean(apiKey), provider: 'anthropic', model, message: apiKey ? 'Anthropic configuration is present.' : ANTHROPIC_NOT_CONFIGURED_MESSAGE }
    },
    async generateJson({ prompt, schemaHint, attachments = [] }) {
      if (!apiKey) throw new Error(ANTHROPIC_NOT_CONFIGURED_MESSAGE)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0.2,
            messages: [{ role: 'user', content: [...contentParts(attachments), { type: 'text', text: `${prompt}\n\nReturn one valid JSON object only. Required shape: ${schemaHint || '{}'}` }] }],
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error?.message || `Anthropic request failed (${response.status})`)
        const raw = (payload.content || []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n').trim()
        if (!raw) throw new Error('Anthropic returned no structured output')
        return { ok: true, raw, usage: { inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null, totalTokens: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0) || null }, model: payload.model || model, provider: 'anthropic', responseId: payload.id || null }
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error(`Anthropic request timed out after ${timeoutMs}ms`)
        throw new Error(safeError(error, apiKey))
      } finally { clearTimeout(timeout) }
    },
  }
}

import { GEMINI_NOT_CONFIGURED_MESSAGE } from "./geminiProvider.js"

export function createNullProvider(config = {}) {
  const provider = config.provider || "gemini"
  const model = config.model || "gemini-2.5-flash"
  const message = config.message || GEMINI_NOT_CONFIGURED_MESSAGE
  return {
    name: "none",
    model,
    configured: false,
    async status() {
      return {
        available: false,
        configured: false,
        provider,
        model,
        message,
      }
    },
    async generateJson() {
      return {
        ok: false,
        unavailable: true,
        raw: "",
        data: null,
        model,
        provider,
        message,
      }
    },
  }
}

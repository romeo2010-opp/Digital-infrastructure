import { getAssistantStarterPrompts } from "./intent-parser.js"

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

export function buildPromptAction(label) {
  return {
    id: `assistant.prompt.${String(label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    label: String(label || "").trim(),
    kind: "prompt",
    prompt: String(label || "").trim(),
    tone: "secondary",
  }
}

export function buildRespondAction({ id, label, payload = {}, tone = "secondary" } = {}) {
  return {
    id,
    label,
    kind: "respond",
    payload,
    tone,
  }
}

export function buildConfirmAction({ label = "Confirm", confirmationToken, tone = "primary" } = {}) {
  return {
    id: "assistant.confirm",
    label,
    kind: "confirm",
    confirmationToken,
    tone,
  }
}

export function buildResetAction(label = "Start over") {
  return {
    id: "assistant.reset",
    label,
    kind: "respond",
    payload: {},
    tone: "secondary",
  }
}

export function buildAssistantResponse({
  type = "text",
  title = "SmartLink Assistant",
  message = "",
  data = null,
  cards = [],
  actions = [],
  suggestions = [],
  requiresConfirmation = false,
  confirmationToken = null,
  errorCode = null,
} = {}) {
  return {
    type,
    title,
    message,
    data,
    cards: normalizeArray(cards),
    actions: normalizeArray(actions),
    suggestions: normalizeArray(suggestions),
    requiresConfirmation: Boolean(requiresConfirmation),
    confirmationToken: confirmationToken || null,
    errorCode: errorCode || null,
  }
}

export function buildWelcomeResponse() {
  return buildAssistantResponse({
    type: "question",
    title: "SmartLink Assistant",
    message: "I can explain SmartLink and help with one real task at a time.",
    suggestions: getAssistantStarterPrompts().map(buildPromptAction),
  })
}

export function buildSystemNoticeCard({ tone = "info", title, message } = {}) {
  return {
    kind: "system_notice",
    tone,
    title,
    message,
  }
}

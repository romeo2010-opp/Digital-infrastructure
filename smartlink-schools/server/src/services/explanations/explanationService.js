import { adaptExplanationForStudent } from "../ai/aiClient.js"
import { gradeToneGuide } from "./gradeTone.js"

const schemaHint = `Expected JSON: {"explanation_text":"","tone":"simple","warnings":[]}`

const explanationResponseSchema = {
  type: "OBJECT",
  properties: {
    explanation_text: { type: "STRING" },
    tone: { type: "STRING" },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["explanation_text", "tone", "warnings"],
}

const modeLabels = {
  simple: "Explain simply",
  step_by_step: "Show step-by-step",
  hint: "Give me a hint",
  common_mistake: "Show common mistake",
  similar_example: "Give similar example",
}

function validate(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Explanation output must be an object")
  if (!payload.explanation_text) throw new Error("explanation_text is required")
}

export function normalizeExplanationMode(value) {
  const mode = String(value || "simple").trim()
  return Object.hasOwn(modeLabels, mode) ? mode : "simple"
}

export async function adaptExplanation({ question, studentAnswer, mode = "simple", masteryLabel = "developing", schoolId = null, userId = null }) {
  const normalizedMode = normalizeExplanationMode(mode)
  const approved = question.approved_explanation || question.explanation || ""
  const toneGuide = gradeToneGuide(question.grade_name || "")
  const fallback = {
    explanation_text: approved || "Ask your teacher to approve an explanation for this question.",
    tone: normalizedMode,
    warnings: ["AI assistance was unavailable; showing the approved explanation."],
  }
  const prompt = `You are helping a student understand an already-approved answer. Do not change the correct answer. Use only the approved answer and approved explanation as the source of truth. Keep it short, clear, and non-shaming.

Requested help: ${modeLabels[normalizedMode]}
Student grade/form: ${question.grade_name || ""}
Grade-aware tone guide: ${toneGuide}
Topic: ${question.topic_name || ""}
Student mastery level: ${masteryLabel}
Approved question: ${question.question_text}
Approved correct answer: ${question.correct_answer}
Approved explanation: ${approved}
Student wrong answer, if any: ${studentAnswer || ""}

Return JSON only. Set tone to a concise label that matches the grade stage and requested help.`

  const result = await adaptExplanationForStudent({
    prompt,
    schemaHint,
    responseSchema: explanationResponseSchema,
    validate,
    fallback,
    schoolId,
    userId,
  })
  return {
    ...result,
    data: {
      explanation_text: String(result.data?.explanation_text || fallback.explanation_text),
      tone: String(result.data?.tone || normalizedMode),
      warnings: Array.isArray(result.data?.warnings) ? result.data.warnings.map(String).slice(0, 8) : [],
    },
  }
}

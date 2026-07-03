import { generateAnswerExplanation } from "../ai/aiClient.js"

const schemaHint = `Expected JSON: {"is_correct":true,"marks_awarded":1,"mistake_type":"","feedback":"","confidence":0.9}`

const responseSchema = {
  type: "OBJECT",
  properties: {
    is_correct: { type: "BOOLEAN" },
    marks_awarded: { type: "NUMBER" },
    mistake_type: { type: "STRING" },
    feedback: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["is_correct", "marks_awarded", "mistake_type", "feedback", "confidence"],
}

function parseJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function validate(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Marking output must be an object")
  if (typeof payload.is_correct !== "boolean") throw new Error("is_correct must be boolean")
  if (!Number.isFinite(Number(payload.marks_awarded))) throw new Error("marks_awarded must be numeric")
}

export async function markAnswerWithAi({ question, studentAnswer, schoolId = null, userId = null }) {
  const maxMarks = Math.max(1, Number(question.marks || 1))
  const prompt = `Mark this learner's Daily Drill answer carefully and fairly.

Question type: ${question.question_type}
Question: ${question.question_text}
Internal answer guide / rubric for marking only: ${question.correct_answer || ""}
Accepted answer hints: ${JSON.stringify(parseJsonArray(question.accepted_answers_json))}
Teacher explanation: ${question.explanation || ""}
Maximum marks: ${maxMarks}
Learner answer: ${studentAnswer || ""}

Marking rules:
- Award marks only for meaning that matches the expected answer or rubric.
- Accept equivalent wording, spelling differences, brief answers, and age-appropriate phrasing when the idea is correct.
- If the learner gives a valid but incomplete idea, award partial credit and set mistake_type to "partial_answer".
- For a multi-mark explanation question, one valid reason usually deserves at least 1 mark even if more detail is needed.
- Do not mark full credit if the learner answer is vague, unrelated, or contradicts the expected answer.
- For structured answers, allow partial credit from 0 to maximum marks.
- Set is_correct true only when the answer deserves full marks.
- Feedback must speak directly to the learner in one or two short sentences.
- Feedback must not quote the rubric, mention "award marks", or show a marking scheme.
- If partial, say what was right and what extra detail would make it complete.
- Use confidence below 0.65 when a teacher should review manually.
- Return JSON only.`

  const result = await generateAnswerExplanation({
    prompt,
    schemaHint,
    responseSchema,
    validate,
    fallback: null,
    schoolId,
    userId,
  })
  if (!result.ok || !result.data) return null
  const confidence = Math.max(0, Math.min(1, Number(result.data.confidence || 0)))
  const marksAwarded = Math.max(0, Math.min(maxMarks, Number(result.data.marks_awarded || 0)))
  if (confidence < 0.65) {
    return {
      is_correct: null,
      marks_awarded: null,
      mistake_type: "teacher_review_required",
      needs_review: true,
      teacher_review_required: true,
      ai_feedback: result.data.feedback || "I need a teacher to review this answer carefully.",
      confidence,
    }
  }
  const fullCredit = marksAwarded >= maxMarks
  return {
    is_correct: fullCredit,
    marks_awarded: marksAwarded,
    mistake_type: fullCredit ? null : (marksAwarded > 0 ? "partial_answer" : result.data.mistake_type || "answer_mismatch"),
    needs_review: false,
    teacher_review_required: false,
    ai_feedback: result.data.feedback || "",
    confidence,
  }
}

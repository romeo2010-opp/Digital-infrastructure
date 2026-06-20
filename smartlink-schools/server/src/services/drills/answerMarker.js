function normalizeAnswer(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
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

export function markAnswer(question, answer) {
  const type = String(question.question_type || "")
  const normalized = normalizeAnswer(answer)
  const correct = normalizeAnswer(question.correct_answer)
  const accepted = parseJsonArray(question.accepted_answers_json).map(normalizeAnswer).filter(Boolean)
  const aliases = new Set([correct, ...accepted].filter(Boolean))

  if (["multiple_choice", "true_false", "short_answer"].includes(type)) {
    const isCorrect = aliases.has(normalized)
    return {
      is_correct: isCorrect,
      marks_awarded: isCorrect ? Number(question.marks || 1) : 0,
      mistake_type: isCorrect ? null : type === "short_answer" ? "answer_mismatch" : "incorrect_option",
      needs_review: false,
    }
  }

  return {
    is_correct: null,
    marks_awarded: null,
    mistake_type: "teacher_review_required",
    needs_review: true,
  }
}

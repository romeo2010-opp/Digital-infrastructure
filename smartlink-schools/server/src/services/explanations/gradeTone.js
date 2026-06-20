function gradeNumber(text, pattern) {
  const match = String(text || "").match(pattern)
  return match ? Number(match[1]) : null
}

export function gradeStage(gradeName = "") {
  const text = String(gradeName || "").toLowerCase()
  const year = gradeNumber(text, /\byear\s*(\d+)/i)
  const grade = gradeNumber(text, /\bgrade\s*(\d+)/i)
  const standard = gradeNumber(text, /\bstandard\s*(\d+)/i)
  const primary = gradeNumber(text, /\bp\.?\s*(\d+)/i)
  const form = gradeNumber(text, /\bform\s*(\d+)/i)
  const level = year ?? grade ?? standard ?? primary

  if (standard || primary || text.includes("primary") || (level && level <= 6)) return "primary"
  if (form && form <= 2) return "lower_secondary"
  if (form && form >= 3) return "upper_secondary"
  if (level && level <= 9) return "lower_secondary"
  if (level && level >= 10) return "upper_secondary"
  if (text.includes("secondary")) return "lower_secondary"
  return "general"
}

export function gradeToneGuide(gradeName = "") {
  const stage = gradeStage(gradeName)
  if (stage === "primary") {
    return "Primary learner: use short friendly sentences, concrete examples, gentle praise, and one idea at a time. Avoid abstract wording unless it is explained immediately."
  }
  if (stage === "lower_secondary") {
    return "Lower secondary learner: sound respectful and encouraging. Use clear subject vocabulary, explain the reasoning, and invite independent thinking without sounding childish."
  }
  if (stage === "upper_secondary") {
    return "Upper secondary learner: use a mature, concise, exam-aware tone. Explain the logic, use correct subject terms, and avoid over-praising."
  }
  return "Use the learner's grade/form to choose an age-appropriate tone. Keep it clear, supportive, and not patronising."
}

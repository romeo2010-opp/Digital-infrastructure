export function classifyDifficulty(averageScore) {
  const score = Number(averageScore)
  if (score >= 70) return "Easy"
  if (score >= 40) return "Medium"
  return "Hard"
}

export function buildTopicRecommendation(topic) {
  const difficulty = classifyDifficulty(topic.average_score)
  if (difficulty === "Hard") {
    return `Schedule teacher-led remediation and daily drills for ${topic.topic_name}.`
  }
  if (difficulty === "Medium") {
    return `Assign short practice sets and review common mistakes in ${topic.topic_name}.`
  }
  return `Keep ${topic.topic_name} in weekly revision so mastery stays fresh.`
}

export function calculateExamPriorityScore({ frequencyScore, marksWeight, recencyGap, weaknessLevel }) {
  return (
    Number(frequencyScore || 0) * 0.3 +
    Number(marksWeight || 0) * 0.25 +
    Number(recencyGap || 0) * 0.2 +
    Number(weaknessLevel || 0) * 0.25
  )
}

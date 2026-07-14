const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "at", "be", "by", "can", "could", "do", "does",
  "approval", "approvals", "called", "find", "for", "from", "give", "have", "i", "in", "is", "list", "me", "named", "of", "on", "or", "please",
  "record", "records", "request", "requests", "run", "runs", "school", "search", "show", "that", "the", "their", "them", "there", "these", "those", "to",
  "up", "want", "was", "were", "what", "where", "which", "who", "with", "would",
])

const ENTITY_CONCEPTS = Object.freeze({
  students: { label: "learners", aliases: ["student", "students", "learner", "learners", "pupil", "pupils", "child", "children", "admission"] },
  teachers: { label: "teachers", aliases: ["teacher", "teachers", "educator", "educators", "lecturer", "lecturers", "faculty", "staff"] },
  guardians: { label: "parents and guardians", aliases: ["parent", "parents", "guardian", "guardians", "mother", "mothers", "father", "fathers", "caregiver", "caregivers"] },
  classes: { label: "classes", aliases: ["class", "classes", "grade", "grades", "form", "forms", "stream", "streams", "year group", "year groups"] },
  subjects: { label: "subjects", aliases: ["subject", "subjects", "course", "courses", "curriculum", "topic", "topics", "syllabus"] },
  fees: { label: "fee accounts", aliases: ["fee", "fees", "balance", "balances", "account", "accounts", "tuition", "arrears", "debtor", "debtors", "owing", "owe", "owed", "unpaid", "paid", "payment", "payments", "receipt", "receipts"] },
  discounts: { label: "discounts and bursaries", aliases: ["discount", "discounts", "bursary", "bursaries", "scholarship", "scholarships", "waiver", "waivers", "concession", "concessions"] },
  leave: { label: "staff leave", aliases: ["leave", "holiday", "vacation", "absence request", "absence requests"] },
  payroll: { label: "payroll", aliases: ["payroll", "salary", "salaries", "wage", "wages", "payslip", "payslips", "compensation"] },
  attendance: { label: "attendance", aliases: ["attendance", "absent", "absence", "present", "late", "sick", "register", "roll call"] },
  homework: { label: "homework", aliases: ["homework", "assignment", "assignments", "task", "tasks", "coursework", "submission", "submissions"] },
  assessments: { label: "assessments", aliases: ["assessment", "assessments", "exam", "exams", "examination", "examinations", "test", "tests", "quiz", "quizzes", "paper", "papers"] },
  results: { label: "results and marks", aliases: ["result", "results", "mark", "marks", "score", "scores", "gradebook", "marksheet", "marksheets", "report card", "report cards"] },
  support: { label: "learner support", aliases: ["support", "intervention", "interventions", "remediation", "reassessment", "reassessments", "learner support", "support case", "support cases"] },
  calendar: { label: "calendar", aliases: ["calendar", "event", "events", "meeting", "meetings", "schedule", "scheduled", "date", "dates"] },
  messages: { label: "messages", aliases: ["message", "messages", "announcement", "announcements", "notice", "notices", "communication", "communications"] },
  reports: { label: "reports", aliases: ["report", "reports", "analytics", "summary", "summaries", "statistics", "dashboard"] },
  library: { label: "library", aliases: ["library", "book", "books", "loan", "loans", "borrowed", "catalogue", "catalog", "resource", "resources"] },
  timetable: { label: "timetables", aliases: ["timetable", "timetables", "schedule", "schedules", "period", "periods", "lesson", "lessons", "invigilation"] },
  settings: { label: "settings", aliases: ["setting", "settings", "configuration", "preferences", "security", "users", "permissions"] },
})

const STATE_CONCEPTS = Object.freeze({
  outstanding: { label: "outstanding", aliases: ["outstanding", "unpaid", "arrears", "owing", "owe", "owed", "debtor", "debtors", "overdue balance"] },
  partial: { label: "partially paid", aliases: ["partial", "partially", "part payment", "part payments", "partly paid"] },
  paid: { label: "fully paid", aliases: ["paid", "settled", "cleared", "fully paid", "zero balance"] },
  pending: { label: "pending", aliases: ["pending", "awaiting", "waiting", "unapproved", "not approved", "not submitted"] },
  overdue: { label: "overdue", aliases: ["overdue", "late", "past due", "missed deadline"] },
  absent: { label: "absent", aliases: ["absent", "absence", "missing", "did not attend", "not present"] },
  present: { label: "present", aliases: ["present", "attended", "in attendance"] },
  active: { label: "active", aliases: ["active", "current", "currently", "open", "ongoing"] },
  inactive: { label: "inactive", aliases: ["inactive", "disabled", "archived", "closed"] },
  published: { label: "published", aliases: ["published", "locked", "official", "approved"] },
  draft: { label: "draft", aliases: ["draft", "unpublished", "editing"] },
  resolved: { label: "resolved", aliases: ["resolved", "completed", "finished", "closed"] },
})

const DATE_CONCEPTS = Object.freeze({
  today: ["today", "current day"],
  yesterday: ["yesterday", "previous day"],
  tomorrow: ["tomorrow", "next day"],
  this_week: ["this week", "current week", "weekly"],
  this_month: ["this month", "current month", "monthly"],
})

const RESULT_ENTITY = Object.freeze({
  STUDENT: "students", TEACHER: "teachers", PARENT: "guardians", GUARDIAN: "guardians", CLASS: "classes",
  SUBJECT: "subjects", FEE: "fees", PAYMENT: "fees", RECEIPT: "fees", DISCOUNT: "discounts", LEAVE: "leave",
  PAYROLL: "payroll", ATTENDANCE: "attendance", HOMEWORK: "homework", ASSESSMENT: "assessments", RESULT: "results",
  MARKS: "results", SUPPORT: "support", EVENT: "calendar", MESSAGE: "messages", REPORT: "reports", LIBRARY: "library",
  TIMETABLE: "timetable", NAVIGATION: "navigation",
})

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stem(value) {
  let token = String(value || "")
  if (token.length > 5 && token.endsWith("ies")) token = `${token.slice(0, -3)}y`
  else if (token.length > 5 && token.endsWith("ing")) token = token.slice(0, -3)
  else if (token.length > 4 && token.endsWith("ed")) token = token.slice(0, -2)
  else if (token.length > 4 && token.endsWith("es")) token = token.slice(0, -2)
  else if (token.length > 3 && token.endsWith("s")) token = token.slice(0, -1)
  return token
}

export function editDistance(left, right) {
  const a = String(left || "")
  const b = String(right || "")
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost)
      }
    }
  }
  return matrix[a.length][b.length]
}

const vocabulary = [...new Set([
  ...Object.values(ENTITY_CONCEPTS).flatMap((concept) => concept.aliases.flatMap((alias) => normalizeSearchText(alias).split(" "))),
  ...Object.values(STATE_CONCEPTS).flatMap((concept) => concept.aliases.flatMap((alias) => normalizeSearchText(alias).split(" "))),
  ...Object.values(DATE_CONCEPTS).flatMap((aliases) => aliases.flatMap((alias) => normalizeSearchText(alias).split(" "))),
])].filter((token) => token.length >= 3)

function correctDomainToken(token) {
  if (token.length < 4 || vocabulary.includes(token) || /^\d+$/.test(token)) return token
  let best = token
  let bestDistance = Infinity
  for (const candidate of vocabulary) {
    if (Math.abs(candidate.length - token.length) > 2 || candidate[0] !== token[0]) continue
    const distance = editDistance(token, candidate)
    if (distance < bestDistance) { best = candidate; bestDistance = distance }
  }
  const threshold = token.length >= 8 ? 2 : 1
  return bestDistance <= threshold ? best : token
}

function conceptScores(tokens, phrase, concepts) {
  const scores = new Map()
  const recognized = new Set()
  for (const [key, concept] of Object.entries(concepts)) {
    let score = 0
    for (const aliasValue of concept.aliases) {
      const alias = normalizeSearchText(aliasValue)
      const aliasTokens = alias.split(" ")
      if (aliasTokens.length > 1 && (` ${phrase} `).includes(` ${alias} `)) {
        score += 8
        aliasTokens.forEach((token) => recognized.add(token))
        continue
      }
      if (aliasTokens.length === 1) {
        const aliasStem = stem(alias)
        for (const token of tokens) {
          if (token === alias) { score += 5; recognized.add(token) }
          else if (stem(token) === aliasStem) { score += 3; recognized.add(token) }
        }
      }
    }
    if (score) scores.set(key, score)
  }
  return { scores, recognized }
}

function sortedConcepts(scores) {
  return [...scores.entries()].sort((left, right) => right[1] - left[1]).map(([key]) => key)
}

export function interpretAwareSearch(value, options = {}) {
  const rawQuery = String(value || "").trim()
  const normalizedQuery = normalizeSearchText(rawQuery)
  const originalTokens = normalizedQuery.split(" ").filter(Boolean)
  const correctedTokens = originalTokens.map(correctDomainToken)
  const correctedQuery = correctedTokens.join(" ")
  const entityMatch = conceptScores(correctedTokens, correctedQuery, ENTITY_CONCEPTS)
  const stateMatch = conceptScores(correctedTokens, correctedQuery, STATE_CONCEPTS)

  const negatedPaid = correctedTokens.some((token, index) => token === "paid" && correctedTokens.slice(Math.max(0, index - 2), index).some((before) => ["not", "never", "without"].includes(before)))
  if (negatedPaid) {
    stateMatch.scores.delete("paid")
    stateMatch.scores.set("outstanding", Math.max(10, stateMatch.scores.get("outstanding") || 0))
    entityMatch.scores.set("fees", Math.max(8, entityMatch.scores.get("fees") || 0))
  }
  if (stateMatch.scores.has("outstanding") || stateMatch.scores.has("partial") || stateMatch.scores.has("paid")) entityMatch.scores.set("fees", Math.max(30, entityMatch.scores.get("fees") || 0))
  if (stateMatch.scores.has("absent") || stateMatch.scores.has("present")) entityMatch.scores.set("attendance", Math.max(30, entityMatch.scores.get("attendance") || 0))
  const mentionsRecordOwner = ["students", "teachers", "guardians", "classes", "subjects"].some((entity) => entityMatch.scores.has(entity))
  if (mentionsRecordOwner) {
    for (const workflow of ["fees", "discounts", "leave", "payroll", "attendance", "homework", "assessments", "results", "support", "calendar", "messages"]) {
      if (entityMatch.scores.has(workflow)) entityMatch.scores.set(workflow, Math.max(20, entityMatch.scores.get(workflow) || 0))
    }
  }
  // A phrase such as "staff currently on leave" mentions both people and a
  // workflow. The workflow is the actionable destination, so it wins.
  if (entityMatch.scores.has("leave")) entityMatch.scores.set("leave", Math.max(40, entityMatch.scores.get("leave") || 0))

  const requestedType = String(options.type || "").toLowerCase()
  const requestedEntity = requestedType && requestedType !== "all" && ENTITY_CONCEPTS[requestedType] ? requestedType : null
  if (requestedEntity) entityMatch.scores.set(requestedEntity, 100)

  const entities = sortedConcepts(entityMatch.scores)
  const states = sortedConcepts(stateMatch.scores)
  let dateRange = null
  for (const [key, aliases] of Object.entries(DATE_CONCEPTS)) {
    if (aliases.some((alias) => (` ${correctedQuery} `).includes(` ${normalizeSearchText(alias)} `))) { dateRange = key; break }
  }

  const recognized = new Set([...entityMatch.recognized, ...stateMatch.recognized, "not", "never", "without"])
  const searchTerms = originalTokens.filter((token, index) => {
    const corrected = correctedTokens[index]
    return !STOP_WORDS.has(token) && !STOP_WORDS.has(corrected) && !recognized.has(corrected) && !Object.values(DATE_CONCEPTS).flat().some((alias) => normalizeSearchText(alias).split(" ").includes(corrected))
  })
  const primaryEntity = entities[0] || null
  const primaryState = states[0] || null
  const entityLabel = primaryEntity ? ENTITY_CONCEPTS[primaryEntity].label : "school records"
  const stateLabel = primaryState ? STATE_CONCEPTS[primaryState].label : null
  const label = [stateLabel, entityLabel, searchTerms.length ? `matching ${searchTerms.join(" ")}` : null].filter(Boolean).join(" ")
  const confidence = Math.min(1, (primaryEntity ? .45 : .15) + (primaryState ? .25 : 0) + (searchTerms.length ? .2 : 0) + (correctedQuery !== normalizedQuery ? .05 : 0))

  return {
    rawQuery,
    requestedEntity,
    normalizedQuery,
    correctedQuery,
    correctedTokens,
    corrections: originalTokens.map((token, index) => token === correctedTokens[index] ? null : { from: token, to: correctedTokens[index] }).filter(Boolean),
    entities,
    entityScores: Object.fromEntries(entityMatch.scores),
    states,
    primaryEntity,
    primaryState,
    dateRange,
    searchTerms,
    label: label || "school-wide search",
    confidence: Number(confidence.toFixed(2)),
  }
}

function tokenSimilarity(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) return 0
  if (queryToken === candidateToken) return 1
  if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) return .88
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return .78
  const longest = Math.max(queryToken.length, candidateToken.length)
  if (longest < 4) return 0
  const distance = editDistance(queryToken, candidateToken)
  if (distance > 2) return 0
  return Math.max(0, 1 - distance / longest)
}

function entityForResult(result) {
  return String(result.searchEntity || "") || RESULT_ENTITY[String(result.resultType || "").toUpperCase()] || String(result.groupType || "")
}

export function scoreSearchResult(result, interpretation) {
  const fields = [result.title, result.subtitle, result.className, result.student, result.parent, result.status, result.matchedField, result.keywords]
    .map(normalizeSearchText).filter(Boolean)
  const haystack = fields.join(" ")
  const haystackTokens = haystack.split(" ").filter(Boolean)
  const resultEntity = entityForResult(result)
  let score = 0
  if (interpretation.primaryEntity && resultEntity === interpretation.primaryEntity) score += 55
  else if (interpretation.entities.includes(resultEntity)) score += 30
  if (interpretation.normalizedQuery && haystack.includes(interpretation.normalizedQuery)) score += 80
  if (fields.some((field) => field.startsWith(interpretation.normalizedQuery))) score += 35
  for (const term of interpretation.searchTerms) {
    const similarity = haystackTokens.reduce((best, candidate) => Math.max(best, tokenSimilarity(normalizeSearchText(term), candidate)), 0)
    score += similarity * 35
    if (similarity < .55) {
      const isPrimaryNavigation = String(result.resultType || "").toUpperCase() === "NAVIGATION" && resultEntity === interpretation.primaryEntity
      score -= isPrimaryNavigation ? 18 : 60
    }
  }
  if (interpretation.primaryState && haystack.includes(normalizeSearchText(STATE_CONCEPTS[interpretation.primaryState]?.label || interpretation.primaryState))) score += 25
  if (result.searchState && interpretation.states.includes(String(result.searchState))) score += 40
  if (result.searchDateMatch) score += 20
  return Number(score.toFixed(2))
}

export function rankSearchResults(results, interpretation, limit = 50) {
  const primaryEntityScore = Number(interpretation.entityScores?.[interpretation.primaryEntity] || 0)
  return results
    .map((result, index) => ({ ...result, relevance: scoreSearchResult(result, interpretation), _searchOrder: index }))
    .filter((result) => {
      if (!interpretation.primaryEntity) return true
      const resultEntity = entityForResult(result)
      if (resultEntity === interpretation.primaryEntity) return true
      if (interpretation.requestedEntity) return false
      const secondaryScore = Number(interpretation.entityScores?.[resultEntity] || 0)
      return secondaryScore > 0 && secondaryScore >= primaryEntityScore - 8
    })
    .filter((result) => (!interpretation.searchTerms.length && !interpretation.primaryEntity) || result.relevance > 5)
    .sort((left, right) => right.relevance - left.relevance || left._searchOrder - right._searchOrder)
    .slice(0, limit)
    .map(({ _searchOrder, ...result }) => result)
}

export const AWARE_SEARCH_ENTITIES = Object.freeze(Object.keys(ENTITY_CONCEPTS))

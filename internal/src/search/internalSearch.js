import { internalApi } from "../api/internalApi"
import { navigationItems } from "../config/navigation"

export const INTERNAL_SEARCH_RECENTS_KEY = "smartlink.internal.globalSearch.recents"

const cacheTtlMs = 45_000
let searchCache = {
  key: "",
  expiresAt: 0,
  promise: null,
  records: [],
}

const resultLabels = {
  NAVIGATION: "Navigation",
  OVERVIEW: "Overview",
  STATION: "Stations",
  LICENSE: "Licenses",
  USER: "Users",
  ROLE: "Roles",
  PERMISSION: "Permissions",
  SUPPORT: "Support",
  REFUND: "Refunds",
  FINANCE: "Finance",
  TRANSACTION: "Transactions",
  SETTLEMENT: "Settlements",
  WALLET: "Wallets",
  RISK: "Risk",
  CASE: "Cases",
  AUDIT: "Audit",
  FIELD: "Field",
  ONBOARDING: "Onboarding",
  NETWORK: "Network",
  SYSTEM: "System",
  ANALYTICS: "Analytics",
  SETTING: "Settings",
  KIOSK: "Kiosk",
  RECORD: "Records",
}

const sourceLoaders = [
  {
    key: "overview",
    label: "Overview",
    navigationKeys: ["overview"],
    load: () => internalApi.getOverview(),
  },
  {
    key: "network",
    label: "Network Operations",
    navigationKeys: ["networkOperations"],
    load: () => internalApi.getNetworkOperations(),
  },
  {
    key: "stations",
    label: "Stations",
    navigationKeys: ["stations"],
    load: () => internalApi.getStations(),
  },
  {
    key: "onboarding",
    label: "Station Onboarding",
    navigationKeys: ["stationOnboarding"],
    load: () => internalApi.getOnboarding(),
  },
  {
    key: "field",
    label: "Field Operations",
    navigationKeys: ["fieldOperations"],
    load: () => internalApi.getFieldOperations(),
  },
  {
    key: "support",
    label: "Support",
    navigationKeys: ["support"],
    load: () => internalApi.getSupport(),
  },
  {
    key: "finance",
    label: "Finance",
    navigationKeys: ["finance"],
    load: () => internalApi.getFinance(),
  },
  {
    key: "walletRequests",
    label: "Wallet Operations",
    navigationKeys: ["walletOperations"],
    load: () => internalApi.getWalletOperationRequests({ limit: 60 }),
  },
  {
    key: "risk",
    label: "Risk",
    navigationKeys: ["risk"],
    load: () => internalApi.getRisk(),
  },
  {
    key: "analytics",
    label: "Analytics",
    navigationKeys: ["analytics"],
    load: () => internalApi.getAnalytics(),
  },
  {
    key: "audit",
    label: "Audit",
    navigationKeys: ["audit"],
    load: () => internalApi.getAuditLogs(),
  },
  {
    key: "staff",
    label: "Internal Staff",
    navigationKeys: ["staff"],
    load: () => internalApi.getStaff(),
  },
  {
    key: "system",
    label: "System Health",
    navigationKeys: ["systemHealth"],
    load: () => internalApi.getSystemHealth(),
  },
  {
    key: "settings",
    label: "Settings",
    navigationKeys: ["settings"],
    load: () => internalApi.getSettings(),
  },
]

function clean(value) {
  return String(value ?? "").trim()
}

function lower(value) {
  return clean(value).toLowerCase()
}

function cacheKeyFor(profile = {}) {
  return JSON.stringify({
    user: profile.user?.publicId || profile.user?.email || "",
    navigation: profile.navigation || [],
    permissions: profile.permissions || [],
  })
}

function canLoadSource(loader, profile = {}) {
  const navigation = new Set(profile.navigation || [])
  if (!loader.navigationKeys?.length) return true
  return loader.navigationKeys.some((key) => navigation.has(key))
}

function scalarEntries(value, prefix = "", depth = 0, entries = []) {
  if (entries.length > 400 || depth > 5 || value === null || value === undefined) return entries
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) {
    const stringValue = clean(value)
    if (stringValue) entries.push({ key: prefix || "value", value: stringValue })
    return entries
  }
  if (value instanceof Date) {
    entries.push({ key: prefix || "date", value: value.toISOString() })
    return entries
  }
  if (Array.isArray(value)) {
    value.slice(0, 18).forEach((item, index) => scalarEntries(item, `${prefix}[${index}]`, depth + 1, entries))
    return entries
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => scalarEntries(item, prefix ? `${prefix}.${key}` : key, depth + 1, entries))
  }
  return entries
}

function collectObjectRecords(value, path = [], records = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object") return records
  if (seen.has(value)) return records
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        records.push({ path: [...path], record: item, index })
        collectObjectRecords(item, [...path, String(index)], records, seen)
      } else {
        collectObjectRecords(item, [...path, String(index)], records, seen)
      }
    })
    return records
  }

  Object.entries(value).forEach(([key, item]) => collectObjectRecords(item, [...path, key], records, seen))
  return records
}

function preferredValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key]
    if (value !== null && value !== undefined && clean(value)) return clean(value)
  }
  return ""
}

function resultId(record, sourceKey, path, index) {
  return preferredValue(record, [
    "publicId",
    "public_id",
    "licenseNumber",
    "license_number",
    "walletPublicId",
    "walletId",
    "transactionPublicId",
    "transaction_public_id",
    "settlementPublicId",
    "runPublicId",
    "casePublicId",
    "taskNumber",
    "requestPublicId",
    "settingKey",
    "code",
    "id",
  ]) || `${sourceKey}-${path.join(".")}-${index}`
}

function resultTitle(record, sourceLabel) {
  return preferredValue(record, [
    "title",
    "subject",
    "name",
    "stationName",
    "station_name",
    "fullName",
    "full_name",
    "email",
    "licenseNumber",
    "license_number",
    "publicId",
    "public_id",
    "taskNumber",
    "settingKey",
    "service",
    "service_key",
    "summary",
  ]) || sourceLabel || "Internal Record"
}

function resultStatus(record) {
  return preferredValue(record, [
    "status",
    "licenseStatus",
    "license_status",
    "subscription_status",
    "reviewStage",
    "severity",
    "priority",
    "isActive",
    "is_active",
  ])
}

function resultSubtitle(record, sourceLabel) {
  const pieces = [
    preferredValue(record, ["summary", "description", "detail", "category", "roleName", "departments"]),
    preferredValue(record, ["stationName", "station_name", "operatorName", "operator_name"]),
    preferredValue(record, ["city", "district", "region"]),
  ].filter(Boolean)
  return pieces.length ? pieces.slice(0, 2).join(" · ") : sourceLabel
}

function linkedIds(entries) {
  const idLike = /(public.?id|_id$|id$|license|reference|transaction|station|wallet|session|challenge|case|task|run|target)/i
  return entries
    .filter((entry) => idLike.test(entry.key) && entry.value.length >= 3)
    .map((entry) => ({ key: entry.key, value: entry.value }))
    .slice(0, 18)
}

function resultTypeFor(sourceKey, path, record) {
  const joined = `${sourceKey} ${path.join(" ")} ${Object.keys(record || {}).join(" ")}`.toLowerCase()
  if (sourceKey === "navigation") return "NAVIGATION"
  if (/license|licence/.test(joined)) return "LICENSE"
  if (/station/.test(joined) && !/staff|manager|subscription|license|licence/.test(joined)) return "STATION"
  if (/staff|user|officer|agent|manager/.test(joined)) return "USER"
  if (/permission/.test(joined)) return "PERMISSION"
  if (/role/.test(joined)) return "ROLE"
  if (/refund/.test(joined)) return "REFUND"
  if (/transaction/.test(joined)) return "TRANSACTION"
  if (/settlement|reconciliation|billing/.test(joined)) return "SETTLEMENT"
  if (/wallet/.test(joined)) return "WALLET"
  if (/case|compliance/.test(joined)) return "CASE"
  if (/risk|fraud|suspicious/.test(joined)) return "RISK"
  if (/audit/.test(joined)) return "AUDIT"
  if (/field|visit/.test(joined)) return "FIELD"
  if (/onboarding/.test(joined)) return "ONBOARDING"
  if (/incident|telemetry|network|pump|nozzle/.test(joined)) return "NETWORK"
  if (/system|health|service|event/.test(joined)) return "SYSTEM"
  if (/analytic|forecast|report/.test(joined)) return "ANALYTICS"
  if (/setting|config|control/.test(joined)) return "SETTING"
  if (/kiosk|device|challenge/.test(joined)) return "KIOSK"
  if (sourceKey === "support") return "SUPPORT"
  if (sourceKey === "finance") return "FINANCE"
  if (sourceKey === "stations") return "STATION"
  return "RECORD"
}

function routeForRecord(result) {
  if (result.resultType === "NAVIGATION" && result.record?.path) return result.record.path
  const id = encodeURIComponent(result.id)
  return `/details/${String(result.resultType || "record").toLowerCase()}/${id}?source=${encodeURIComponent(result.sourceKey || "")}&collection=${encodeURIComponent(result.collectionPath || "")}`
}

function createResult({ sourceKey, sourceLabel, path, record, index }) {
  const entries = scalarEntries(record)
  const id = resultId(record, sourceKey, path, index)
  const resultType = resultTypeFor(sourceKey, path, record)
  const title = resultTitle(record, sourceLabel)
  const result = {
    id,
    title,
    subtitle: resultSubtitle(record, sourceLabel),
    resultType,
    route: "",
    status: resultStatus(record) || null,
    district: preferredValue(record, ["district", "city"]) || null,
    region: preferredValue(record, ["region"]) || null,
    station: preferredValue(record, ["stationName", "station_name", "name"]) || null,
    matchedField: null,
    sourceKey,
    sourceLabel,
    collectionPath: path.join(".") || sourceKey,
    linkedIds: linkedIds(entries),
    scalarEntries: entries,
    record,
    searchText: entries.map((entry) => `${entry.key} ${entry.value}`).join(" ").toLowerCase(),
  }
  result.route = routeForRecord(result)
  return result
}

function navigationRecords(profile = {}) {
  const allowed = new Set(profile.navigation || [])
  return navigationItems
    .filter((item) => allowed.has(item.key))
    .map((item, index) => createResult({
      sourceKey: "navigation",
      sourceLabel: "Navigation",
      path: ["navigation"],
      index,
      record: {
        id: item.key,
        title: item.label,
        section: item.section,
        path: item.path,
        keywords: `${item.label} ${item.section} ${item.key}`,
      },
    }))
}

const stopTerms = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with"])

const domainIntentTerms = new Set([
  "account",
  "admin",
  "agent",
  "alert",
  "approval",
  "audit",
  "billing",
  "case",
  "compliance",
  "config",
  "device",
  "field",
  "finance",
  "id",
  "incident",
  "kiosk",
  "licence",
  "license",
  "manager",
  "network",
  "onboarding",
  "operator",
  "payment",
  "permission",
  "pump",
  "refund",
  "risk",
  "role",
  "setting",
  "settlement",
  "staff",
  "station",
  "support",
  "system",
  "telemetry",
  "ticket",
  "transaction",
  "user",
  "wallet",
])

const searchAliases = {
  account: ["wallet", "profile", "user"],
  admin: ["administrator", "staff", "user", "officer"],
  agent: ["field", "officer", "staff", "user"],
  alert: ["case", "incident", "risk"],
  approval: ["review", "onboarding", "application"],
  audit: ["activity", "event", "log"],
  billing: ["finance", "invoice", "settlement"],
  case: ["alert", "compliance", "incident", "risk", "ticket"],
  compliance: ["case", "risk", "review"],
  config: ["configuration", "control", "setting", "settings"],
  device: ["kiosk", "terminal"],
  field: ["agent", "inspection", "officer", "visit"],
  finance: ["billing", "payment", "reconciliation", "settlement"],
  id: ["identifier", "linked", "public", "reference", "ref"],
  incident: ["alert", "case", "event", "issue"],
  kiosk: ["device", "terminal"],
  licence: ["license", "permit", "registration", "certificate"],
  license: ["licence", "permit", "registration", "certificate"],
  manager: ["admin", "officer", "staff", "user"],
  network: ["pump", "telemetry", "terminal", "uptime"],
  onboarding: ["application", "approval", "review"],
  operator: ["owner", "station", "user"],
  payment: ["finance", "transaction", "wallet"],
  permission: ["access", "control", "role"],
  pump: ["network", "nozzle", "station", "telemetry"],
  refund: ["reversal", "return", "support"],
  risk: ["alert", "case", "compliance", "fraud", "suspicious"],
  role: ["access", "permission", "user"],
  setting: ["config", "configuration", "control", "settings"],
  settlement: ["billing", "finance", "payout", "reconciliation"],
  staff: ["admin", "agent", "manager", "officer", "user"],
  station: ["forecourt", "fuel", "operator", "site"],
  support: ["case", "issue", "ticket"],
  system: ["health", "service", "uptime"],
  telemetry: ["network", "pump", "status"],
  ticket: ["case", "issue", "support"],
  transaction: ["payment", "transfer", "txn", "wallet"],
  user: ["admin", "agent", "manager", "officer", "staff"],
  wallet: ["account", "balance", "payment", "transaction"],
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeSearchValue(value) {
  return lower(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_/\\:;.,()[\]{}"'`~!@#$%^&*=+<>?|]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value) {
  return normalizeSearchValue(value)
    .split(/\s+/)
    .filter((term) => term && (!stopTerms.has(term) || term === "id") && (term.length > 1 || /\d/.test(term)))
}

function singularForms(term) {
  const forms = [term]
  if (term.length > 4 && term.endsWith("ies")) forms.push(`${term.slice(0, -3)}y`)
  if (term.length > 4 && term.endsWith("es")) forms.push(term.slice(0, -2))
  if (term.length > 3 && term.endsWith("s")) forms.push(term.slice(0, -1))
  return unique(forms)
}

function variantsForTerm(term) {
  const baseForms = singularForms(normalizeSearchValue(term))
  const variants = [...baseForms]
  baseForms.forEach((form) => {
    if (searchAliases[form]) variants.push(...searchAliases[form])
    Object.entries(searchAliases).forEach(([key, aliases]) => {
      if (aliases.includes(form)) variants.push(key, ...aliases)
    })
  })
  return unique(variants.map(normalizeSearchValue))
}

function hasDomainIntent(term) {
  return variantsForTerm(term).some((variant) => domainIntentTerms.has(variant))
}

function parseSearchQuery(query) {
  const raw = clean(query)
  const quotedPhrases = []
  const withoutQuoted = raw.replace(/"([^"]+)"|'([^']+)'/g, (_, doubleQuoted, singleQuoted) => {
    const phrase = normalizeSearchValue(doubleQuoted || singleQuoted)
    if (phrase) quotedPhrases.push(phrase)
    return " "
  })
  const normalized = normalizeSearchValue(raw.replace(/["']/g, " "))
  const looseTerms = tokenize(withoutQuoted)
  const terms = unique(looseTerms.length ? looseTerms : tokenize(normalized))
  const phrases = [...quotedPhrases]
  if (terms.length > 1 && normalized) phrases.push(normalized)
  const hasDomainTerms = terms.some(hasDomainIntent)
  const isLikelyPersonName = terms.length >= 2
    && terms.length <= 4
    && terms.every((term) => /^[a-z]+$/.test(term) && term.length >= 2)
    && !hasDomainTerms
  return {
    raw,
    normalized,
    terms,
    hasDomainTerms,
    hasQuotedPhrase: quotedPhrases.length > 0,
    isLikelyPersonName,
    phrases: unique(phrases.filter((phrase) => phrase && tokenize(phrase).length > 1)),
  }
}

function levenshteinDistance(left, right, limit = 2) {
  if (left === right) return 0
  if (!left || !right) return limit + 1
  if (Math.abs(left.length - right.length) > limit) return limit + 1

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1]
    let rowBest = current[0]
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1
      const next = Math.min(
        previous[rightIndex + 1] + 1,
        current[rightIndex] + 1,
        previous[rightIndex] + cost,
      )
      current.push(next)
      rowBest = Math.min(rowBest, next)
    }
    if (rowBest > limit) return limit + 1
    previous = current
  }
  return previous[right.length]
}

function termScoreInText(term, normalizedText) {
  if (!term || !normalizedText) return 0
  const words = normalizedText.split(/\s+/).filter(Boolean)
  let best = 0

  variantsForTerm(term).forEach((variant) => {
    if (!variant) return
    if (normalizedText === variant) best = Math.max(best, 56)
    if (normalizedText.startsWith(`${variant} `) || normalizedText.startsWith(variant)) best = Math.max(best, 46)
    if (normalizedText.includes(variant)) best = Math.max(best, variant.includes(" ") ? 42 : 32)

    if (variant.includes(" ")) return
    words.forEach((word) => {
      if (word === variant) {
        best = Math.max(best, 52)
      } else if (variant.length >= 2 && word.startsWith(variant)) {
        best = Math.max(best, 36)
      } else if (variant.length >= 3 && word.includes(variant)) {
        best = Math.max(best, 25)
      } else if (variant.length >= 4 && word.length >= 4) {
        const distanceLimit = variant.length >= 7 || word.length >= 7 ? 2 : 1
        const distance = levenshteinDistance(variant, word, distanceLimit)
        if (distance <= 1) best = Math.max(best, 24)
        else if (distance <= 2) best = Math.max(best, 16)
      }
    })
  })

  return best
}

function phraseScoreInText(phrase, normalizedText) {
  if (!phrase || !normalizedText) return 0
  if (normalizedText === phrase) return 92
  if (normalizedText.startsWith(`${phrase} `) || normalizedText.startsWith(phrase)) return 78
  if (normalizedText.includes(phrase)) return 66

  const phraseTerms = tokenize(phrase)
  if (phraseTerms.length < 2) return 0
  const matched = phraseTerms.filter((term) => termScoreInText(term, normalizedText) >= 16).length
  const coverage = matched / phraseTerms.length
  if (coverage >= 0.75) return 34 + Math.round(coverage * 18)
  return 0
}

function fieldProfileForEntry(entry) {
  const key = lower(entry?.key)
  if (/(public.?id|_id$|id$|number|code|reference|license|licence|transaction|wallet|phone)/i.test(key)) {
    return { weight: 2.65, category: "id" }
  }
  if (/(email|full.?name|first.?name|last.?name|name|title|subject|operator|owner|manager|contact|applicant|assignee)/i.test(key)) {
    return { weight: 2.45, category: "identity" }
  }
  if (/(summary|description|detail|note|message|reason|comment)/i.test(key)) {
    return { weight: 1.85, category: "description" }
  }
  if (/(status|stage|severity|priority|role|permission|category)/i.test(key)) {
    return { weight: 1.75, category: "status" }
  }
  if (/(district|region|city|address|location|zone|area)/i.test(key)) {
    return { weight: 1.35, category: "location" }
  }
  if (/station/i.test(key)) return { weight: 1.35, category: "station" }
  return { weight: 1, category: "field" }
}

function weightedSearchFields(result) {
  const fields = [
    { key: "id", label: "ID", value: result.id, weight: 3.4, category: "id" },
    { key: "title", label: "Title", value: result.title, weight: 3, category: result.resultType === "USER" ? "identity" : "title" },
    { key: "subtitle", label: "Summary", value: result.subtitle, weight: 2, category: "description" },
    { key: "status", label: "Status", value: result.status, weight: 1.8, category: "status" },
    { key: "district", label: "District", value: result.district, weight: 1.2, category: "location" },
    { key: "region", label: "Region", value: result.region, weight: 1.2, category: "location" },
    { key: "station", label: "Station", value: result.station, weight: result.resultType === "STATION" ? 2.15 : 1.35, category: "station" },
    { key: "type", label: "Type", value: badgeLabelForInternalResult(result), weight: 1.55, category: "type" },
    { key: "source", label: "Source", value: `${result.sourceLabel} ${result.collectionPath} ${result.sourceKey}`, weight: 0.75, category: "source" },
  ]

  result.linkedIds?.forEach((entry) => {
    fields.push({
      key: entry.key,
      label: entry.key,
      value: `${entry.key} ${entry.value}`,
      weight: 2.6,
      category: "linkedId",
    })
  })

  result.scalarEntries?.forEach((entry) => {
    const profile = fieldProfileForEntry(entry)
    fields.push({
      key: entry.key,
      label: entry.key,
      value: `${entry.key} ${entry.value}`,
      weight: profile.weight,
      category: profile.category,
    })
  })

  const seen = new Set()
  return fields.filter((field) => {
    const value = clean(field.value)
    if (!value) return false
    const signature = `${field.category}:${field.key}:${normalizeSearchValue(value)}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function scoreWeightedField(field, parsedQuery) {
  const normalizedText = normalizeSearchValue(`${field.key} ${field.value}`)
  if (!normalizedText) return { score: 0, matchedTerms: [] }

  const phraseScore = parsedQuery.phrases.reduce((best, phrase) => Math.max(best, phraseScoreInText(phrase, normalizedText)), 0)
  const termMatches = parsedQuery.terms
    .map((term) => ({ term, score: termScoreInText(term, normalizedText) }))
    .filter((match) => match.score >= 16)

  if (!phraseScore && !termMatches.length) return { score: 0, matchedTerms: [] }

  const termScore = termMatches.reduce((sum, match) => sum + match.score, 0)
  const coverage = parsedQuery.terms.length ? termMatches.length / parsedQuery.terms.length : 0
  const fieldScore = (phraseScore + termScore + (coverage * 16)) * field.weight
  return {
    score: fieldScore,
    termMatches,
    phraseScore,
  }
}

function scoreResult(result, query) {
  const parsedQuery = typeof query === "string" ? parseSearchQuery(query) : query
  if (!parsedQuery.terms.length && !parsedQuery.phrases.length) return { score: 0, matchedField: null }

  let bestField = null
  let bestFieldScore = 0
  let strongestPhrase = 0
  let strongestIdentityPhrase = 0
  const matchedTerms = new Set()
  const identityTerms = new Set()
  const categories = new Set()
  const bestTermScores = new Map()
  const fieldMatches = []

  weightedSearchFields(result).forEach((field) => {
    const fieldScore = scoreWeightedField(field, parsedQuery)
    if (!fieldScore.score) return
    const cappedFieldScore = Math.min(fieldScore.score, 170)
    fieldMatches.push({ field, score: cappedFieldScore, phraseScore: fieldScore.phraseScore })
    categories.add(field.category)
    strongestPhrase = Math.max(strongestPhrase, fieldScore.phraseScore || 0)
    if (field.category === "identity") strongestIdentityPhrase = Math.max(strongestIdentityPhrase, fieldScore.phraseScore || 0)
    fieldScore.termMatches.forEach((match) => {
      matchedTerms.add(match.term)
      if (field.category === "identity") identityTerms.add(match.term)
      const weightedTermScore = Math.min(match.score * field.weight, 125)
      bestTermScores.set(match.term, Math.max(bestTermScores.get(match.term) || 0, weightedTermScore))
    })
    if (cappedFieldScore > bestFieldScore) {
      bestFieldScore = cappedFieldScore
      bestField = field
    }
  })

  const coverage = parsedQuery.terms.length ? matchedTerms.size / parsedQuery.terms.length : 1
  const identityCoverage = parsedQuery.terms.length ? identityTerms.size / parsedQuery.terms.length : 0
  const onlyWeakScope = [...categories].every((category) => ["source", "type", "location", "station"].includes(category))

  if (!fieldMatches.length) {
    return { score: 0, matchedField: null }
  }

  if (parsedQuery.hasQuotedPhrase && strongestPhrase < 34 && coverage < 0.75) {
    return { score: 0, matchedField: null }
  }

  if (parsedQuery.isLikelyPersonName) {
    const requiredCoverage = parsedQuery.terms.length <= 2 ? 1 : 0.75
    const hasPersonEvidence = result.resultType === "USER" || identityCoverage >= 0.67 || strongestIdentityPhrase >= 34
    const stationHasFullPersonEvidence = result.resultType !== "STATION" || identityCoverage >= requiredCoverage || strongestIdentityPhrase >= 66
    if (coverage < requiredCoverage || !hasPersonEvidence || !stationHasFullPersonEvidence || onlyWeakScope) {
      return { score: 0, matchedField: null }
    }
  } else if (parsedQuery.terms.length > 1) {
    const requiredCoverage = parsedQuery.hasDomainTerms ? 0.5 : 0.6
    if (coverage < requiredCoverage && strongestPhrase < 34) return { score: 0, matchedField: null }
  }

  const sortedFields = fieldMatches.sort((left, right) => right.score - left.score)
  const supportScore = sortedFields.slice(1, 8).reduce((sum, match, index) => {
    const factor = index < 2 ? 0.35 : 0.18
    return sum + (match.score * factor)
  }, 0)
  const termEvidence = [...bestTermScores.values()].reduce((sum, value) => sum + value, 0)
  const coverageBoost = Math.round(coverage * 36)
  const completeMatchBoost = coverage >= 1 ? 28 : 0
  const phraseBoost = Math.round(strongestPhrase * (parsedQuery.hasQuotedPhrase ? 1.65 : 1.15))
  const personBoost = parsedQuery.isLikelyPersonName
    ? (result.resultType === "USER" ? 180 : Math.round(identityCoverage * 90))
    : 0
  const score = Math.round(bestFieldScore + supportScore + termEvidence + coverageBoost + completeMatchBoost + phraseBoost + personBoost)

  return {
    score: score >= 24 ? score : 0,
    matchedField: bestField?.label || null,
  }
}

function applyMatch(result, query) {
  const match = scoreResult(result, query)
  if (!match.score) return null
  return {
    ...result,
    matchedField: match.matchedField || result.matchedField,
    score: match.score,
  }
}

async function loadRecords(profile = {}) {
  const records = [...navigationRecords(profile)]
  const loaders = sourceLoaders.filter((loader) => canLoadSource(loader, profile))
  const settled = await Promise.allSettled(loaders.map((loader) => loader.load().then((payload) => ({ loader, payload }))))

  settled.forEach((result) => {
    if (result.status !== "fulfilled") return
    const { loader, payload } = result.value
    const objectRecords = collectObjectRecords(payload)
    objectRecords.forEach((item) => {
      records.push(createResult({
        sourceKey: loader.key,
        sourceLabel: loader.label,
        path: item.path,
        record: item.record,
        index: item.index,
      }))
    })
  })

  const seen = new Set()
  return records.filter((record) => {
    const key = `${record.resultType}:${record.id}:${record.collectionPath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function loadInternalSearchRecords(profile = {}, { force = false } = {}) {
  const key = cacheKeyFor(profile)
  const now = Date.now()
  if (!force && searchCache.key === key && searchCache.records.length && searchCache.expiresAt > now) {
    return searchCache.records
  }
  if (!force && searchCache.key === key && searchCache.promise) return searchCache.promise

  const promise = loadRecords(profile).then((records) => {
    searchCache = {
      key,
      expiresAt: Date.now() + cacheTtlMs,
      promise: null,
      records,
    }
    return records
  }).catch((error) => {
    searchCache.promise = null
    throw error
  })

  searchCache = { ...searchCache, key, promise }
  return promise
}

export function clearInternalSearchCache() {
  searchCache = { key: "", expiresAt: 0, promise: null, records: [] }
}

export async function quickInternalSearch(profile, query, limit = 10) {
  const value = clean(query)
  if (value.length < 2) return { groups: [], total: 0, query: value }
  const records = await loadInternalSearchRecords(profile)
  const parsedQuery = parseSearchQuery(value)
  const matches = records
    .map((record) => applyMatch(record, parsedQuery))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit * 4)

  const grouped = []
  const byType = new Map()
  matches.forEach((match) => {
    const type = match.resultType || "RECORD"
    if (!byType.has(type)) {
      byType.set(type, {
        type,
        label: resultLabels[type] || type.replaceAll("_", " "),
        results: [],
      })
      grouped.push(byType.get(type))
    }
    if (byType.get(type).results.length < limit) byType.get(type).results.push(match)
  })

  return { groups: grouped.filter((group) => group.results.length), total: matches.length, query: value }
}

export async function fullInternalSearch(profile, { q = "", type = "all", limit = 80 } = {}) {
  const value = clean(q)
  if (value.length < 2) return { results: [], total: 0, query: value }
  const records = await loadInternalSearchRecords(profile)
  const parsedQuery = parseSearchQuery(value)
  const normalizedType = clean(type).toUpperCase()
  const matches = records
    .map((record) => applyMatch(record, parsedQuery))
    .filter(Boolean)
    .filter((record) => normalizedType === "ALL" || !normalizedType || record.resultType === normalizedType)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)

  return { results: matches, total: matches.length, query: value }
}

export async function findInternalSearchRecord(profile, { entityType = "", id = "", source = "", collection = "" } = {}) {
  const records = await loadInternalSearchRecords(profile)
  const type = clean(entityType).toUpperCase()
  const decodedId = decodeURIComponent(clean(id))
  const decodedSource = decodeURIComponent(clean(source))
  const decodedCollection = decodeURIComponent(clean(collection))
  return records.find((record) => (
    (!type || record.resultType === type)
    && clean(record.id) === decodedId
    && (!decodedSource || record.sourceKey === decodedSource)
    && (!decodedCollection || record.collectionPath === decodedCollection)
  )) || records.find((record) => (!type || record.resultType === type) && clean(record.id) === decodedId) || null
}

export function badgeLabelForInternalResult(result) {
  return resultLabels[result?.resultType] || String(result?.resultType || "Result").replaceAll("_", " ")
}

export function routeForInternalSearchResult(result) {
  return result?.route || routeForRecord(result)
}

const INTENT_PATTERNS = [
  {
    intent: "compare_queue_reservation",
    patterns: [
      /\bqueue\s+or\s+reservation\b/i,
      /\bdifference\s+between\s+queue\s+and\s+reservation\b/i,
      /\bcompare\s+(the\s+)?queue\s+(and|vs)\s+reservation\b/i,
      /\bwhich\s+one\s+is\s+better\b/i,
    ],
  },
  {
    intent: "explain_queue",
    patterns: [
      /\bwhat\s+is\s+a?\s*digital\s+queue\b/i,
      /\bwhat\s+is\s+queue\b/i,
      /\bexplain\s+queue\b/i,
      /\bdigital\s+queue\b/i,
    ],
  },
  {
    intent: "explain_reservation",
    patterns: [
      /\bwhat\s+is\s+a?\s*reservation\b/i,
      /\bexplain\s+reservation\b/i,
      /\breservation\s+means\b/i,
    ],
  },
  {
    intent: "find_fuel_nearby",
    patterns: [
      /\bfind\s+fuel\s+near\s+me\b/i,
      /\bnearby\s+stations\b/i,
      /\bfind\s+nearby\s+stations\b/i,
      /\bnear\s+me\b/i,
    ],
  },
  {
    intent: "join_fastest_queue",
    patterns: [
      /\bjoin\s+fastest\s+queue\b/i,
      /\bfastest\s+queue\b/i,
      /\bjoin\s+(a\s+)?queue\b/i,
    ],
  },
  {
    intent: "make_reservation",
    patterns: [
      /\breserve\s+fuel\s+for\s+later\b/i,
      /\bmake\s+(a\s+)?reservation\b/i,
      /\bcreate\s+(a\s+)?reservation\b/i,
      /\breserve\s+fuel\b/i,
    ],
  },
  {
    intent: "check_booking",
    patterns: [
      /\bcheck\s+my\s+booking\b/i,
      /\bmy\s+booking\b/i,
      /\bactive\s+(queue|reservation|booking)\b/i,
      /\bview\s+active\b/i,
    ],
  },
  {
    intent: "cancel_booking",
    patterns: [
      /\bcancel\s+booking\b/i,
      /\bcancel\s+reservation\b/i,
      /\bcancel\s+queue\b/i,
      /\bleave\s+queue\b/i,
    ],
  },
  {
    intent: "wallet_summary",
    patterns: [
      /\bcheck\s+wallet\b/i,
      /\bwallet\s+summary\b/i,
      /\bwallet\s+balance\b/i,
    ],
  },
  {
    intent: "wallet_help",
    patterns: [
      /\bwallet\s+help\b/i,
      /\bhow\s+does\s+wallet\s+work\b/i,
      /\bwallet\s+basics\b/i,
      /\bloyalty\s+points\b/i,
    ],
  },
]

const INTENT_SCORING_RULES = {
  compare_queue_reservation: [
    { patterns: [/\bqueue\b/i, /\breservation\b/i], score: 2 },
    { patterns: [/\b(or|vs|versus|difference|compare|better)\b/i], score: 3 },
    { patterns: [/\bwhich\s+one\b/i], score: 2 },
  ],
  explain_queue: [
    { patterns: [/\bqueue\b/i], score: 2 },
    { patterns: [/\b(digital\s+line|waiting\s+line|line)\b/i], score: 2 },
    { patterns: [/\b(what\s+is|how\s+does|explain|tell\s+me\s+about)\b/i], score: 3 },
  ],
  explain_reservation: [
    { patterns: [/\breservation\b/i], score: 2 },
    { patterns: [/\b(book|booking|time\s*slot|pickup\s*time)\b/i], score: 2 },
    { patterns: [/\b(what\s+is|how\s+does|explain|tell\s+me\s+about)\b/i], score: 3 },
  ],
  find_fuel_nearby: [
    { patterns: [/\b(near|nearby|closest|around\s+me|close\s+by|my\s+location)\b/i], score: 3 },
    { patterns: [/\b(find|show|where|locate|search)\b/i], score: 2 },
    { patterns: [/\b(station|fuel|petrol|diesel)\b/i], score: 1 },
  ],
  join_fastest_queue: [
    { patterns: [/\b(queue|line)\b/i], score: 2 },
    { patterns: [/\b(join|enter|get\s+into|start|take\s+me\s+to)\b/i], score: 3 },
    { patterns: [/\b(fastest|quickest|shortest\s+wait|fuel\s+now|right\s+now|immediately)\b/i], score: 3 },
  ],
  make_reservation: [
    { patterns: [/\breserv/i, /\b(book|schedule|timeslot|time\s*slot)\b/i], score: 3 },
    { patterns: [/\b(later|future|tomorrow|planned|plan\s+ahead)\b/i], score: 3 },
    { patterns: [/\b(pick\s*up|collect)\b/i], score: 1 },
  ],
  check_booking: [
    { patterns: [/\b(check|view|show|see|open)\b/i], score: 2 },
    { patterns: [/\b(my|current|active)\b/i], score: 1 },
    { patterns: [/\b(booking|queue|reservation|status)\b/i], score: 2 },
  ],
  cancel_booking: [
    { patterns: [/\b(cancel|leave|stop|end|remove|exit)\b/i], score: 3 },
    { patterns: [/\b(booking|queue|reservation)\b/i], score: 2 },
  ],
  wallet_summary: [
    { patterns: [/\b(wallet)\b/i], score: 2 },
    { patterns: [/\b(balance|summary|money|funds|available|locked|holds)\b/i], score: 3 },
    { patterns: [/\b(check|show|view|see)\b/i], score: 1 },
  ],
  wallet_help: [
    { patterns: [/\b(wallet|loyalty|points)\b/i], score: 2 },
    { patterns: [/\b(help|basics|work|works|explain|how)\b/i], score: 3 },
  ],
}

function toUpperValue(value) {
  return String(value || "").trim().toUpperCase()
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function extractFuelType(text) {
  const normalized = String(text || "").toLowerCase()
  if (/\bdiesel\b/.test(normalized)) return "DIESEL"
  if (/\bpetrol\b/.test(normalized) || /\bgasoline\b/.test(normalized) || /\bgas\b/.test(normalized)) return "PETROL"
  return null
}

function extractLitres(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(l|lt|ltr|litre|litres|liter|liters)\b/i)
  if (!match?.[1]) return null
  const litres = Number(match[1])
  if (!Number.isFinite(litres) || litres <= 0) return null
  return Number(litres.toFixed(1))
}

function extractRequestedTime(text) {
  const match = String(text || "").match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!match?.[1]) return null

  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const meridiem = String(match[3] || "").trim().toLowerCase()
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (minute < 0 || minute > 59) return null

  if (meridiem === "am" && hour >= 1 && hour <= 12) {
    if (hour === 12) hour = 0
  } else if (meridiem === "pm" && hour >= 1 && hour <= 12) {
    if (hour !== 12) hour += 12
  }

  if (hour < 0 || hour > 23) return null

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function extractBookingKind(text) {
  const normalized = String(text || "").toLowerCase()
  if (normalized.includes("reservation")) return "reservation"
  if (normalized.includes("queue") || normalized.includes("line")) return "queue"
  return null
}

export function normalizeAssistantText(text) {
  return String(text || "").trim()
}

function isGreetingOnlyText(text) {
  const normalized = normalizeAssistantText(text).toLowerCase()
  if (!normalized) return false
  return /^(hey|hi|hello|yo|hola|good\s+morning|good\s+afternoon|good\s+evening|help)\b[!.?]*$/i.test(normalized)
}

function scoreIntent(text, intent) {
  const exactMatch = INTENT_PATTERNS.find((entry) => entry.intent === intent)
  if (exactMatch?.patterns?.some((pattern) => pattern.test(text))) {
    return 100
  }

  const rules = INTENT_SCORING_RULES[intent] || []
  return rules.reduce((total, rule) => {
    const matchesAll = rule.patterns.every((pattern) => pattern.test(text))
    return matchesAll ? total + Number(rule.score || 0) : total
  }, 0)
}

export function parseAssistantIntent(text) {
  const normalizedText = normalizeAssistantText(text)
  const tokens = tokenize(normalizedText)
  const parsed = {
    text: normalizedText,
    intent: null,
    confidence: 0,
    params: {
      fuelType: extractFuelType(normalizedText),
      litres: extractLitres(normalizedText),
      requestedTime: extractRequestedTime(normalizedText),
      bookingKind: extractBookingKind(normalizedText),
      isGreeting: isGreetingOnlyText(normalizedText),
      wantsNow: /\b(now|immediately|right now)\b/i.test(normalizedText),
      wantsLater:
        /\b(later|after|future|book|tomorrow|schedule|plan)\b/i.test(normalizedText) ||
        Boolean(extractRequestedTime(normalizedText)),
    },
  }

  const scoredIntents = Object.keys(INTENT_SCORING_RULES)
    .map((intent) => ({
      intent,
      score: scoreIntent(normalizedText, intent),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const bestMatch = scoredIntents[0] || null
  if (bestMatch && bestMatch.score >= 4) {
    parsed.intent = bestMatch.intent
    parsed.confidence = bestMatch.score
    return parsed
  }

  if (parsed.params.fuelType && /\b(near|closest|nearby|around)\b/i.test(normalizedText)) {
    parsed.intent = "find_fuel_nearby"
    parsed.confidence = 4
    return parsed
  }

  if (parsed.params.bookingKind && /\bcancel\b/i.test(normalizedText)) {
    parsed.intent = "cancel_booking"
    parsed.confidence = 4
    return parsed
  }

  if (parsed.params.bookingKind && /\b(check|view|show)\b/i.test(normalizedText)) {
    parsed.intent = "check_booking"
    parsed.confidence = 4
    return parsed
  }

  if (parsed.params.fuelType && /\b(queue|line)\b/i.test(normalizedText)) {
    parsed.intent = "join_fastest_queue"
    parsed.confidence = 4
    return parsed
  }

  if (parsed.params.fuelType && /\breserv|book|schedule/i.test(normalizedText)) {
    parsed.intent = "make_reservation"
    parsed.confidence = 4
    return parsed
  }

  if (parsed.params.fuelType && parsed.params.wantsNow) {
    parsed.intent = /\b(near|nearby|closest|around)\b/i.test(normalizedText)
      ? "find_fuel_nearby"
      : "join_fastest_queue"
    parsed.confidence = 3
    return parsed
  }

  if (parsed.params.fuelType && parsed.params.wantsLater) {
    parsed.intent = "make_reservation"
    parsed.confidence = 3
    return parsed
  }

  if (
    parsed.params.requestedTime &&
    /\b(station|go|later|book|reserve|fuel)\b/i.test(normalizedText)
  ) {
    parsed.intent = "make_reservation"
    parsed.confidence = 3
    return parsed
  }

  if (tokens.includes("wallet") && (tokens.includes("how") || tokens.includes("work") || tokens.includes("works"))) {
    parsed.intent = "wallet_help"
    parsed.confidence = 3
    return parsed
  }

  if (tokens.includes("wallet")) {
    parsed.intent = "wallet_summary"
    parsed.confidence = 2
    return parsed
  }

  return parsed
}

export function isKnownAssistantIntent(intent) {
  return INTENT_PATTERNS.some((entry) => entry.intent === toUpperValue(intent).toLowerCase())
}

export function getAssistantStarterPrompts() {
  return [
    "Find fuel near me",
    "What is a digital queue?",
    "Queue or reservation?",
    "Join fastest queue",
    "Reserve fuel for later",
    "Check my booking",
    "Check wallet",
  ]
}

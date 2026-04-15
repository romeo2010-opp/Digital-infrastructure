import {
  buildAssistantResponse,
  buildPromptAction,
  buildResetAction,
  buildRespondAction,
} from "./response-builders.js"
import { ASSISTANT_ACTION_IDS } from "./tool-registry.js"

const KNOWLEDGE_ENTRIES = [
  {
    id: "greeting",
    keywords: ["hello", "hi", "hey", "hiya", "moni", "muli bwanji", "uli bwanji", "zili bwanji", "bwanji"],
    response: {
      type: "explainer",
      title: "SmartLink Assistant",
      message: "Hello. I can help with fuel stations, queue, reservations, active bookings, and wallet questions.",
      suggestions: ["Find fuel near me", "Queue or reservation?", "Check my booking", "Check wallet"],
    },
  },
  {
    id: "thanks",
    keywords: ["thanks", "thank you", "thx", "ty", "zikomo", "zikomo kwambiri", "thanks kwambiri"],
    response: {
      type: "explainer",
      title: "You Are Welcome",
      message: "You are welcome. I can keep helping with SmartLink tasks whenever you need.",
      suggestions: ["Find fuel near me", "Check my booking", "Check wallet"],
    },
  },
  {
    id: "goodbye",
    keywords: ["bye", "goodbye", "see you", "later", "cya"],
    response: {
      type: "explainer",
      title: "See You Soon",
      message: "Goodbye. You can come back any time for SmartLink help with stations, queue, reservations, or wallet.",
      suggestions: ["Find fuel near me", "Check my booking"],
    },
  },
  {
    id: "about_smartlink",
    keywords: [
      "what is smartlink",
      "about smartlink",
      "what does smartlink do",
      "how does smartlink work",
      "what can i do on smartlink",
      "what is smartlink malawi",
    ],
    response: {
      type: "explainer",
      title: "About SmartLink",
      message: "SmartLink helps users find fuel stations, compare queue and reservation options, and complete fuel tasks with live system data.",
      suggestions: ["Find fuel near me", "Queue or reservation?", "Check my booking"],
    },
  },
  {
    id: "founder",
    keywords: [
      "who is the founder",
      "who built smartlink",
      "who created smartlink",
      "who is behind smartlink",
      "who made smartlink",
      "tell me about the founder",
      "founder background",
      "creator background",
      "who is romeo",
      "tell me about romeo",
    ],
    response: {
      type: "explainer",
      title: "Founder",
      message:
        "SmartLink Malawi was created by Romeo Favour Mbeya, a young builder from Blantyre focused on using technology to solve everyday service problems. SmartLink is part of that vision: making fuel access and service coordination simpler, faster, and more organized.",
      suggestions: ["Find fuel near me", "What can you do", "Queue or reservation?"],
    },
  },
  {
    id: "capabilities",
    keywords: [
      "help",
      "what can you do",
      "what do you do",
      "how can you help me",
      "what should i ask",
      "first time",
      "new here",
      "how do i start",
      "how to use",
      "suggest",
      "recommend",
      "features",
    ],
    response: {
      type: "explainer",
      title: "What I Can Help With",
      message: "I can explain queue and reservation, find nearby fuel, help you join a queue, make a reservation, check your booking, cancel a booking, and show your wallet summary.",
      suggestions: [
        "Find fuel near me",
        "What is a digital queue?",
        "Reserve fuel for later",
        "Check wallet",
      ],
    },
  },
  {
    id: "emergency_fuel",
    keywords: [
      "emergency fuel",
      "urgent fuel",
      "nearest fuel",
      "closest fuel",
      "fuel nearby",
      "i need fuel urgently",
      "how can i get fuel quickly",
    ],
    response: {
      type: "explainer",
      title: "Get Fuel Quickly",
      message: "The fastest SmartLink path is to find nearby stations and compare live queue options.",
      suggestions: ["Find fuel near me", "Join fastest queue"],
    },
  },
  {
    id: "pricing",
    keywords: ["is smartlink free", "do i pay", "pricing", "cost", "subscription"],
    response: {
      type: "explainer",
      title: "Pricing",
      message: "SmartLink use is intended to be simple for users. For booking or wallet charges, I will only show live values from the backend when they apply.",
      suggestions: ["Check wallet", "Reserve fuel for later"],
    },
  },
  {
    id: "security",
    keywords: ["safe", "security", "is my data safe", "privacy", "secure"],
    response: {
      type: "explainer",
      title: "Safety And Privacy",
      message: "SmartLink uses authenticated access and only shows your own live booking and wallet data in this assistant.",
      suggestions: ["Check my booking", "Check wallet"],
    },
  },
  {
    id: "login_help",
    keywords: ["login problem", "cant login", "can't login", "forgot password", "signin issue", "account problem"],
    response: {
      type: "explainer",
      title: "Login Help",
      message: "If sign-in is not working, first check your login details and session. If you get into the app, I can help with SmartLink tasks from there.",
      suggestions: ["What can you do", "Find fuel near me"],
    },
  },
  {
    id: "signup",
    keywords: ["signup", "register", "create account", "new account", "join smartlink"],
    response: {
      type: "explainer",
      title: "Getting Started",
      message: "Create your SmartLink account, sign in, and then I can help you find stations, manage bookings, and check wallet information.",
      suggestions: ["What can you do", "Find fuel near me"],
    },
  },
  {
    id: "queue_long",
    keywords: ["queue long", "long wait", "waiting time", "busy", "crowded"],
    response: {
      type: "explainer",
      title: "Long Wait Times",
      message: "If queues are long, you can compare live queue options or choose a reservation for later instead of waiting now.",
      suggestions: ["Join fastest queue", "Reserve fuel for later", "Queue or reservation?"],
    },
  },
  {
    id: "reservation_token",
    keywords: ["token", "reservation token", "what is this code", "my token"],
    response: {
      type: "explainer",
      title: "Reservation Token",
      message: "Your reservation token is the booking reference for your reserved slot. You can check the live reservation details from your current booking.",
      suggestions: ["Check my booking"],
    },
  },
  {
    id: "business_onboarding",
    keywords: [
      "add my business",
      "register business",
      "list my business",
      "join smartlink as business",
      "fuel station owner",
      "pharmacy owner",
      "benefits for businesses",
      "why should i join smartlink",
      "is smartlink good for my business",
    ],
    response: {
      type: "explainer",
      title: "Business Onboarding",
      message: "SmartLink can help businesses manage demand and improve customer flow. Business onboarding is separate from the user assistant flows in this app.",
      suggestions: ["What is smartlink", "Find fuel near me"],
    },
  },
  {
    id: "future",
    keywords: ["future", "updates", "new features", "what's next", "roadmap"],
    response: {
      type: "explainer",
      title: "Future Updates",
      message: "SmartLink is still evolving. In this assistant, I focus on current live station, queue, reservation, booking, and wallet tasks.",
      suggestions: ["What can you do", "Find fuel near me"],
    },
  },
]

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function scoreKnowledgeEntry(text, entry) {
  const normalized = normalizeText(text)
  if (!normalized) return 0

  let score = 0
  for (const keyword of entry.keywords || []) {
    const normalizedKeyword = normalizeText(keyword)
    if (!normalizedKeyword) continue
    if (normalized === normalizedKeyword) {
      score = Math.max(score, 100 + normalizedKeyword.length)
      continue
    }
    if (normalized.includes(normalizedKeyword)) {
      score = Math.max(score, 50 + normalizedKeyword.length)
    }
  }
  return score
}

export function matchAssistantKnowledge(text) {
  const normalized = normalizeText(text)
  if (!normalized) return null

  const ranked = KNOWLEDGE_ENTRIES
    .map((entry) => ({
      entry,
      score: scoreKnowledgeEntry(normalized, entry),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  const bestMatch = ranked[0] || null
  if (!bestMatch || bestMatch.score < 54) return null
  return bestMatch.entry
}

export function buildAssistantKnowledgeResponse(entry, { currentState = null } = {}) {
  const response = entry?.response || {}
  const actions = []

  if (currentState?.goal) {
    actions.push(
      buildRespondAction({
        id: ASSISTANT_ACTION_IDS.CONTINUE,
        label: `Continue current task`,
        tone: "primary",
        payload: {},
      }),
      buildResetAction()
    )
  }

  return buildAssistantResponse({
    type: response.type || "explainer",
    title: response.title || "SmartLink Assistant",
    message: response.message || "I can help with SmartLink tasks.",
    actions,
    suggestions: Array.isArray(response.suggestions)
      ? response.suggestions.map((label) => buildPromptAction(label))
      : [],
  })
}

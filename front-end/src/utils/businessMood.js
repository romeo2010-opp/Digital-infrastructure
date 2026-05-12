export const BUSINESS_MOOD_EVENT = "smartlink:business-mood-change"

function notoAnimatedEmoji(codepoint) {
  const baseUrl = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}`
  return {
    webpSrc: `${baseUrl}/512.webp`,
    gifSrc: `${baseUrl}/512.gif`,
  }
}

export const BUSINESS_MOOD_OPTIONS = [
  { id: "hard", emoji: "😞", ...notoAnimatedEmoji("1f61e"), label: "Hard", response: "Hard day noted. Watch stock variance, queue delays, and support requests closely." },
  { id: "slow", emoji: "😐", ...notoAnimatedEmoji("1f610"), label: "Slow", response: "Slow pulse logged. Use the KPI slides to spot where activity is dragging." },
  { id: "steady", emoji: "🙂", ...notoAnimatedEmoji("1f642"), label: "Steady", response: "Steady day. Keep transactions, tank checks, and staff coverage moving." },
  { id: "good", emoji: "😄", ...notoAnimatedEmoji("1f604"), label: "Good", response: "Good momentum. Check the sales slide for ways to keep the pace up." },
  { id: "great", emoji: "🚀", ...notoAnimatedEmoji("1f680"), label: "Great", response: "Great day. Strong operations deserve a quick look at readiness and variance." },
]

const STORAGE_PREFIX = "smartlink:business-mood"

function todayKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function storageKey(stationPublicId) {
  return `${STORAGE_PREFIX}:${String(stationPublicId || "default")}`
}

export function findBusinessMood(id) {
  return BUSINESS_MOOD_OPTIONS.find((item) => item.id === id) || null
}

export function readBusinessMood(stationPublicId) {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(storageKey(stationPublicId))
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (parsed?.date !== todayKey()) return null
    const mood = findBusinessMood(parsed?.id)
    return mood ? { ...mood, ratedAt: parsed.ratedAt, date: parsed.date } : null
  } catch {
    return null
  }
}

export function writeBusinessMood(stationPublicId, moodId) {
  if (typeof window === "undefined") return null
  const mood = findBusinessMood(moodId)
  if (!mood) return null

  const payload = {
    id: mood.id,
    date: todayKey(),
    ratedAt: new Date().toISOString(),
  }

  try {
    window.localStorage.setItem(storageKey(stationPublicId), JSON.stringify(payload))
  } catch {
    // Keep UI state even if storage is unavailable.
  }

  const nextMood = { ...mood, ...payload }
  window.dispatchEvent(new CustomEvent(BUSINESS_MOOD_EVENT, {
    detail: {
      stationPublicId: String(stationPublicId || "default"),
      mood: nextMood,
    },
  }))
  return nextMood
}

export function clearBusinessMood(stationPublicId) {
  if (typeof window === "undefined") return
  const scopedStationId = String(stationPublicId || "default")

  try {
    window.localStorage.removeItem(storageKey(scopedStationId))
  } catch {
    // Storage can fail in private modes; the UI can still clear locally.
  }

  window.dispatchEvent(new CustomEvent(BUSINESS_MOOD_EVENT, {
    detail: {
      stationPublicId: scopedStationId,
      mood: null,
    },
  }))
}

export function subscribeBusinessMood(stationPublicId, listener) {
  if (typeof window === "undefined") return () => {}
  const scopedStationId = String(stationPublicId || "default")

  function handleMoodChange(event) {
    const eventStationId = String(event?.detail?.stationPublicId || "default")
    if (eventStationId !== scopedStationId) return
    listener(readBusinessMood(scopedStationId))
  }

  window.addEventListener(BUSINESS_MOOD_EVENT, handleMoodChange)
  listener(readBusinessMood(scopedStationId))
  return () => window.removeEventListener(BUSINESS_MOOD_EVENT, handleMoodChange)
}

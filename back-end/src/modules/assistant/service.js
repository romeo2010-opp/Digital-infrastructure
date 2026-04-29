import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import { prisma } from "../../db/prisma.js"
import { generatePublicUserId } from "../../utils/generateUserId.js"
import { badRequest } from "../../utils/http.js"
import { getUserWalletSummary, ensureWalletTablesReady, isWalletFoundationTableMissingError } from "../common/wallets.js"
import { hasStationPlanFeature, STATION_PLAN_FEATURES } from "../subscriptions/planCatalog.js"
import { getAverageServiceMinutes, getQueueSettings, buildUserQueueStatusSnapshot } from "../userQueue/service.js"
import {
  ensureReservationsTableReady,
  getActiveReservationForUser,
  resolveStationReservationContext,
  listReservationSlotsForUser,
  listStationFuelStatusesForQueueJoin,
  executeQueueJoinAction,
  executeCreateReservationAction,
  executeCancelReservationAction,
  executeLeaveQueueAction,
} from "../userQueue/routes.js"
import { parseAssistantIntent } from "./intent-parser.js"
import { ASSISTANT_ACTION_IDS, ASSISTANT_TOOL_IDS } from "./tool-registry.js"
import { buildAssistantKnowledgeResponse, matchAssistantKnowledge } from "./knowledge-base.js"
import {
  buildAssistantResponse,
  buildConfirmAction,
  buildPromptAction,
  buildResetAction,
  buildRespondAction,
  buildSystemNoticeCard,
  buildWelcomeResponse,
} from "./response-builders.js"
import { createAssistantAuditLog } from "./audit.service.js"
import {
  getActiveQueueLiveUpdateSubscription,
  getLiveUpdateLanguageLabel,
  LIVE_UPDATE_LANGUAGE_OPTIONS,
  normalizeLiveUpdateLanguage,
  upsertQueueLiveUpdateSubscription,
  deactivateQueueLiveUpdateSubscription,
} from "./live-updates.service.js"

const SESSION_TOKEN_TTL_SECONDS = 30 * 60
const CONFIRMATION_TOKEN_TTL_SECONDS = 10 * 60
const DEFAULT_QUEUE_LITRE_CHOICES = [10, 20, 30, 40]
const DEFAULT_RESERVATION_LITRE_CHOICES = [10, 20, 30, 40]
const DEFAULT_RESERVATION_DEPOSIT = 3000
const DEFAULT_QUEUE_AVG_SERVICE_MINUTES = 4
const STATION_MATCH_STOP_WORDS = new Set([
  "station",
  "fuel",
  "smartlink",
  "service",
  "services",
  "filling",
  "center",
  "centre",
])

function assistantSecret() {
  return process.env.ASSISTANT_TOKEN_SECRET || `${process.env.JWT_ACCESS_SECRET || "smartlink"}:assistant`
}

function toNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function haversineKm(origin, destination) {
  const earthRadiusKm = 6371
  const toRadians = (value) => (value * Math.PI) / 180
  const deltaLat = toRadians(destination.lat - origin.lat)
  const deltaLng = toRadians(destination.lng - origin.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) * Math.sin(deltaLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function sanitizeLocation(location) {
  if (!location || typeof location !== "object") return null
  const lat = toNumberOrNull(location.lat)
  const lng = toNumberOrNull(location.lng)
  if (lat === null || lng === null) return null
  return { lat, lng }
}

function normalizeUssdPhoneNumber(phoneNumber) {
  const raw = String(phoneNumber || "")
  if (!raw.trim()) return null

  let normalized = raw.replace(/\s+/g, "")
  if (normalized.startsWith("265") && !normalized.startsWith("+")) {
    normalized = `+${normalized}`
  }
  return normalized || null
}

function normalizeUssdPin(pin) {
  const normalized = String(pin || "").trim()
  if (!/^\d{4}$/.test(normalized)) return null
  return normalized
}

function formatUssdMoney(amount, currencyCode = "MWK") {
  const normalizedAmount = Number(amount || 0)
  return `${currencyCode} ${normalizedAmount.toLocaleString()}`
}

function signToken(payload, expiresIn) {
  return jwt.sign(payload, assistantSecret(), {
    expiresIn,
  })
}

function verifyToken(token, expectedType, auth) {
  const parsed = jwt.verify(String(token || "").trim(), assistantSecret())
  if (parsed?.typ !== expectedType) {
    throw badRequest("Assistant token is invalid.")
  }
  if (Number(parsed?.uid || 0) !== Number(auth?.userId || 0)) {
    throw badRequest("Assistant token does not belong to this user.")
  }
  if (parsed?.sid && auth?.sessionPublicId && parsed.sid !== auth.sessionPublicId) {
    throw badRequest("Assistant token is no longer valid for this session.")
  }
  return parsed
}

function buildSessionEnvelope(state, auth) {
  if (!state?.goal) return null
  return {
    goal: state.goal,
    step: state.step || null,
    stateToken: signToken(
      {
        typ: "assistant_state",
        uid: Number(auth?.userId || 0),
        sid: auth?.sessionPublicId || null,
        state,
      },
      SESSION_TOKEN_TTL_SECONDS
    ),
  }
}

function buildConfirmationToken({ auth, actionType, intent, params }) {
  return signToken(
    {
      typ: "assistant_confirm",
      uid: Number(auth?.userId || 0),
      sid: auth?.sessionPublicId || null,
      actionType,
      intent,
      params,
    },
    CONFIRMATION_TOKEN_TTL_SECONDS
  )
}

function cloneParams(params = {}) {
  return {
    ...params,
  }
}

function initializeStateFromIntent(parsedIntent, baseParams = {}) {
  const intent = parsedIntent?.intent
  if (!intent) return null
  const params = {
    ...cloneParams(baseParams),
    ...cloneParams(parsedIntent?.params || {}),
  }
  if (intent === ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE || intent === ASSISTANT_TOOL_IDS.MAKE_RESERVATION) {
    params.hasSelectedLitres = params.litres !== null && params.litres !== undefined
  }
  return {
    goal: intent,
    step: null,
    params,
  }
}

function mergeFreeTextIntoState(state, text, resolvedStation = null) {
  if (!state?.goal || !text) return state
  const parsed = parseAssistantIntent(text)
  const params = cloneParams(state.params || {})
  if (parsed?.params?.fuelType) {
    params.fuelType = parsed.params.fuelType
  }
  if (parsed?.params?.litres !== null && parsed?.params?.litres !== undefined) {
    params.litres = parsed.params.litres
    params.hasSelectedLitres = true
  }
  if (parsed?.params?.bookingKind) {
    params.bookingKind = parsed.params.bookingKind
  }
  if (parsed?.params?.languageCode) {
    params.languageCode = parsed.params.languageCode
  }
  if (resolvedStation?.publicId) {
    params.stationPublicId = resolvedStation.publicId
    params.stationName = resolvedStation.name
  }
  if (
    state.goal === ASSISTANT_TOOL_IDS.MAKE_RESERVATION &&
    String(state.step || "").trim() === "enter_identifier" &&
    !parsed.intent &&
    looksLikeReservationIdentifier(text)
  ) {
    params.identifier = String(text || "").trim().slice(0, 64) || null
  }
  return {
    ...state,
    params,
  }
}

export function looksLikeReservationIdentifier(text) {
  const normalized = String(text || "").trim().toUpperCase()
  if (normalized.length < 3 || normalized.length > 24) return false
  if (!/^[A-Z0-9 -]+$/.test(normalized)) return false
  const hasDigit = /\d/.test(normalized)
  const hasLetter = /[A-Z]/.test(normalized)
  return hasDigit || (hasLetter && normalized.includes("-"))
}

function stateTaskLabel(goal) {
  if (goal === ASSISTANT_TOOL_IDS.MAKE_RESERVATION) return "reservation"
  if (goal === ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE) return "queue"
  if (goal === ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST) return "fuel request"
  if (goal === ASSISTANT_TOOL_IDS.CANCEL_BOOKING) return "booking cancellation"
  if (goal === ASSISTANT_TOOL_IDS.LIVE_QUEUE_UPDATES) return "live queue updates"
  return "SmartLink task"
}

export function shouldKeepAssistantStateForMessage({ state, parsedIntent, text, resolvedStation = null } = {}) {
  if (!state?.goal) return false
  if (parsedIntent?.intent) return true
  if (resolvedStation?.publicId) return true

  const params = parsedIntent?.params || {}
  if (params.fuelType || params.litres !== null && params.litres !== undefined || params.bookingKind || params.languageCode) return true
  if (params.requestedTime || params.wantsNow || params.wantsLater) return true

  if (String(state.step || "").trim() === "enter_identifier") {
    return looksLikeReservationIdentifier(text)
  }

  if (params.isGreeting) return false

  const normalized = String(text || "").trim()
  if (!normalized) return false
  if (normalized.split(/\s+/).length <= 2) return false
  return false
}

function buildStateClarificationResponse(state) {
  const taskLabel = stateTaskLabel(state?.goal)
  return buildAssistantResponse({
    type: "question",
    title: "What would you like to do?",
    message: `I can help with one SmartLink task at a time. Do you want to continue your ${taskLabel}, or start something else?`,
    actions: [
      buildRespondAction({
        id: ASSISTANT_ACTION_IDS.CONTINUE,
        label: `Continue ${taskLabel}`,
        tone: "primary",
        payload: {},
      }),
      buildResetAction(),
    ],
    suggestions: [
      buildPromptAction("Find fuel near me"),
      buildPromptAction("Check my booking"),
      buildPromptAction("Check wallet"),
    ],
  })
}

function applyActionToState(state, actionId, payload = {}) {
  const nextState = state ? { ...state, params: cloneParams(state.params || {}) } : null
  if (!nextState) return null

  if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_FUEL_TYPE) {
    nextState.params.fuelType = String(payload.fuelType || "").trim().toUpperCase() || null
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_BOOKING_MODE) {
    const nextGoal = String(payload.goal || "").trim()
    if ([ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE, ASSISTANT_TOOL_IDS.MAKE_RESERVATION].includes(nextGoal)) {
      nextState.goal = nextGoal
      nextState.step = null
      nextState.params.hasSelectedLitres =
        nextState.params.litres !== null && nextState.params.litres !== undefined
    }
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_STATION) {
    nextState.params.stationPublicId = String(payload.stationPublicId || "").trim() || null
    nextState.params.stationName = String(payload.stationName || "").trim() || null
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_LITRES) {
    const litres = payload.litres === null ? null : toNumberOrNull(payload.litres)
    nextState.params.litres = litres
    nextState.params.hasSelectedLitres = true
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_SLOT) {
    nextState.params.stationPublicId = String(payload.stationPublicId || nextState.params.stationPublicId || "").trim() || null
    nextState.params.stationName = String(payload.stationName || nextState.params.stationName || "").trim() || null
    nextState.params.slotStart = String(payload.slotStart || "").trim() || null
    nextState.params.slotEnd = String(payload.slotEnd || "").trim() || null
    nextState.params.slotLabel = String(payload.slotLabel || "").trim() || null
    nextState.params.slotDateLabel = String(payload.slotDateLabel || "").trim() || null
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_CANCEL_TARGET) {
    nextState.params.bookingKind = String(payload.bookingKind || "").trim().toLowerCase() || null
    nextState.params.queueJoinId = String(payload.queueJoinId || "").trim() || null
    nextState.params.reservationPublicId = String(payload.reservationPublicId || "").trim() || null
  } else if (actionId === ASSISTANT_ACTION_IDS.CHOOSE_LIVE_UPDATE_LANGUAGE) {
    nextState.params.languageCode = normalizeLiveUpdateLanguage(payload.languageCode || "en")
  }

  return nextState
}

async function listAssistantStations({ currentLocation = null } = {}) {
  const enhancedQuery = prisma.$queryRaw`
    SELECT
      st.id,
      st.public_id,
      st.name,
      st.city,
      st.address,
      st.latitude,
      st.longitude,
      st.prices_json,
      COALESCE(sss.plan_code, '') AS subscription_plan_code,
      COALESCE(sqs.is_queue_enabled, 1) AS is_queue_enabled,
      COALESCE(sqs.joins_paused, 0) AS joins_paused,
      COALESCE(sqs.petrol_enabled, 1) AS petrol_enabled,
      COALESCE(sqs.diesel_enabled, 1) AS diesel_enabled,
      COALESCE(sqs.reservations_enabled, 1) AS reservations_enabled,
      COALESCE(active_queue.active_count, 0) AS active_queue_count
    FROM stations st
    LEFT JOIN station_subscription_statuses sss ON sss.station_id = st.id
    LEFT JOIN station_queue_settings sqs ON sqs.station_id = st.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS active_count
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY station_id
    ) active_queue ON active_queue.station_id = st.id
    WHERE st.is_active = 1
      AND st.deleted_at IS NULL
    ORDER BY st.name ASC
  `

  let rows = []
  try {
    rows = await enhancedQuery
  } catch {
    rows = await prisma.$queryRaw`
      SELECT
        st.id,
        st.public_id,
        st.name,
        st.city,
        st.address,
        st.latitude,
        st.longitude,
        st.prices_json,
        '' AS subscription_plan_code,
        1 AS is_queue_enabled,
        0 AS joins_paused,
        1 AS petrol_enabled,
        1 AS diesel_enabled,
        1 AS reservations_enabled,
        0 AS active_queue_count
      FROM stations st
      WHERE st.is_active = 1
        AND st.deleted_at IS NULL
      ORDER BY st.name ASC
    `
  }

  return (rows || []).map((row) => {
    const lat = toNumberOrNull(row.latitude)
    const lng = toNumberOrNull(row.longitude)
    const distanceKm =
      currentLocation && lat !== null && lng !== null
        ? Number(haversineKm(currentLocation, { lat, lng }).toFixed(1))
        : null

    return {
      id: Number(row.id || 0),
      publicId: String(row.public_id || "").trim(),
      name: String(row.name || "").trim() || "Station",
      address: [row.address, row.city].filter(Boolean).join(", ") || String(row.name || "").trim() || "Station",
      city: String(row.city || "").trim() || null,
      latitude: lat,
      longitude: lng,
      distanceKm,
      planCode: String(row.subscription_plan_code || "").trim().toUpperCase() || null,
      isQueueEnabled: Boolean(Number(row.is_queue_enabled ?? 1)),
      joinsPaused: Boolean(Number(row.joins_paused ?? 0)),
      petrolEnabled: Boolean(Number(row.petrol_enabled ?? 1)),
      dieselEnabled: Boolean(Number(row.diesel_enabled ?? 1)),
      reservationsEnabled: Boolean(Number(row.reservations_enabled ?? 1)),
      activeQueueCount: Math.max(0, Number(row.active_queue_count || 0)),
      queuePlanEnabled: hasStationPlanFeature(
        String(row.subscription_plan_code || "").trim().toUpperCase(),
        STATION_PLAN_FEATURES.DIGITAL_QUEUE
      ),
      reservationPlanEnabled: hasStationPlanFeature(
        String(row.subscription_plan_code || "").trim().toUpperCase(),
        STATION_PLAN_FEATURES.RESERVATIONS
      ),
    }
  }).sort((left, right) => {
    const leftDistance = left.distanceKm === null ? Number.POSITIVE_INFINITY : left.distanceKm
    const rightDistance = right.distanceKm === null ? Number.POSITIVE_INFINITY : right.distanceKm
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    return left.name.localeCompare(right.name)
  })
}

async function getStationByPublicId(stationPublicId, currentLocation = null) {
  const stations = await listAssistantStations({ currentLocation })
  return stations.find((item) => item.publicId === stationPublicId) || null
}

function normalizeStationLookupText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenizeStationLookupText(value) {
  return normalizeStationLookupText(value)
    .split(" ")
    .filter((token) => token && token.length > 1 && !STATION_MATCH_STOP_WORDS.has(token))
}

function compactStationLookupText(value) {
  return normalizeStationLookupText(value).replace(/\s+/g, "")
}

function scoreStationMatch(text, station) {
  const haystack = normalizeStationLookupText(text)
  if (!haystack) return 0

  const compactHaystack = compactStationLookupText(text)
  const name = normalizeStationLookupText(station?.name)
  const address = normalizeStationLookupText(station?.address)
  const city = normalizeStationLookupText(station?.city)
  const compactName = compactStationLookupText(station?.name)
  const nameTokens = tokenizeStationLookupText(station?.name)
  const addressTokens = tokenizeStationLookupText(`${station?.address || ""} ${station?.city || ""}`)

  let score = 0
  if (name && haystack.includes(name)) score += 12
  if (compactName && compactHaystack.includes(compactName)) score += 10

  const matchedNameTokens = nameTokens.filter((token) => haystack.includes(token))
  if (matchedNameTokens.length >= Math.min(2, nameTokens.length || 0)) {
    score += matchedNameTokens.length * 3
  }

  const matchedAddressTokens = addressTokens.filter((token) => haystack.includes(token))
  if (matchedAddressTokens.length) {
    score += matchedAddressTokens.length * 2
  }

  if (address && haystack.includes(address)) score += 6
  if (city && haystack.includes(city)) score += 2
  if (/\b(from|at|near)\b/i.test(text)) score += 1

  return score
}

async function resolveStationMentionFromText(text, currentLocation = null) {
  const normalizedText = String(text || "").trim()
  if (!normalizedText) return null

  const stations = await listAssistantStations({ currentLocation })
  const ranked = stations
    .map((station) => ({
      station,
      score: scoreStationMatch(normalizedText, station),
    }))
    .filter((entry) => entry.score >= 6)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      const leftDistance = left.station.distanceKm === null ? Number.POSITIVE_INFINITY : left.station.distanceKm
      const rightDistance = right.station.distanceKm === null ? Number.POSITIVE_INFINITY : right.station.distanceKm
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      return left.station.name.localeCompare(right.station.name)
    })

  const bestMatch = ranked[0] || null
  const secondMatch = ranked[1] || null
  if (!bestMatch) return null
  if (secondMatch && bestMatch.score < secondMatch.score + 2) {
    return null
  }
  return bestMatch.station
}

async function getFuelStatusesForStations(stations) {
  const pairs = await Promise.all(
    (stations || []).map(async (station) => {
      const statuses = await listStationFuelStatusesForQueueJoin(station.id).catch(() => [])
      return [station.publicId, Array.isArray(statuses) ? statuses : []]
    })
  )
  return new Map(pairs)
}

function fuelStatusForCode(statuses, fuelType) {
  return (statuses || []).find((item) => String(item?.code || "").trim().toUpperCase() === fuelType) || null
}

async function buildQueueOptions({ fuelType, currentLocation = null, limit = 5 } = {}) {
  const stations = await listAssistantStations({ currentLocation })
  const fuelStatusMap = await getFuelStatusesForStations(stations)

  const candidates = await Promise.all(
    stations
      .filter((station) => station.queuePlanEnabled && station.isQueueEnabled && !station.joinsPaused)
      .filter((station) => (fuelType === "DIESEL" ? station.dieselEnabled : station.petrolEnabled))
      .map(async (station) => {
        const fuelStatus = fuelStatusForCode(fuelStatusMap.get(station.publicId), fuelType)
        if (String(fuelStatus?.status || "").trim().toLowerCase() === "unavailable") {
          return null
        }

        const averageServiceMinutes = await getAverageServiceMinutes(station.id).catch(
          () => DEFAULT_QUEUE_AVG_SERVICE_MINUTES
        )
        const estimatedWaitMinutes = Math.max(
          1,
          Math.round(Number(station.activeQueueCount || 0) * Number(averageServiceMinutes || DEFAULT_QUEUE_AVG_SERVICE_MINUTES))
        )

        return {
          station,
          fuelStatus: fuelStatus || null,
          averageServiceMinutes: Number(averageServiceMinutes || DEFAULT_QUEUE_AVG_SERVICE_MINUTES),
          estimatedWaitMinutes,
        }
      })
  )

  return candidates
    .filter(Boolean)
    .sort((left, right) => {
      if (left.estimatedWaitMinutes !== right.estimatedWaitMinutes) {
        return left.estimatedWaitMinutes - right.estimatedWaitMinutes
      }
      const leftDistance = left.station.distanceKm === null ? Number.POSITIVE_INFINITY : left.station.distanceKm
      const rightDistance = right.station.distanceKm === null ? Number.POSITIVE_INFINITY : right.station.distanceKm
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      return left.station.name.localeCompare(right.station.name)
    })
    .slice(0, limit)
}

async function buildNearbyStations({ fuelType = null, currentLocation = null, limit = 5 } = {}) {
  const stations = await listAssistantStations({ currentLocation })
  const shortlisted = stations.slice(0, Math.max(limit + 2, 8))
  const fuelStatusMap = await getFuelStatusesForStations(shortlisted)

  return shortlisted
    .map((station) => ({
      ...station,
      fuelStatuses: fuelStatusMap.get(station.publicId) || [],
    }))
    .filter((station) => {
      if (!fuelType) return true
      const status = fuelStatusForCode(station.fuelStatuses, fuelType)
      return String(status?.status || "").trim().toLowerCase() !== "unavailable"
    })
    .slice(0, limit)
}

async function ensureWalletReady() {
  try {
    await ensureWalletTablesReady()
  } catch (error) {
    if (isWalletFoundationTableMissingError(error) || String(error?.message || "").includes("migration")) {
      throw badRequest(
        "Wallet storage is unavailable. Run SQL migrations 034_wallet_ledger_foundation.sql and 052_wallet_user_transfers_station_locks.sql."
      )
    }
    throw error
  }
}

async function getActiveQueueForUser(auth) {
  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) return null
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM queue_entries
    WHERE user_id = ${authUserId}
      AND status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY joined_at ASC
    LIMIT 1
  `
  const activeEntry = rows?.[0]
  if (!activeEntry?.public_id) return null
  return buildUserQueueStatusSnapshot({
    queueJoinId: activeEntry.public_id,
    auth,
  })
}

async function getActiveReservationDetails(auth) {
  const authUserId = Number(auth?.userId || 0)
  if (!Number.isFinite(authUserId) || authUserId <= 0) return null

  await ensureReservationsTableReady()
  const rows = await prisma.$queryRaw`
    SELECT
      ur.public_id,
      ur.status,
      ur.requested_litres,
      ur.deposit_amount,
      ur.identifier,
      ur.slot_start,
      ur.slot_end,
      ur.expires_at,
      st.public_id AS station_public_id,
      st.name AS station_name,
      COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area,
      ft.code AS fuel_type
    FROM user_reservations ur
    INNER JOIN stations st ON st.id = ur.station_id
    INNER JOIN fuel_types ft ON ft.id = ur.fuel_type_id
    WHERE ur.user_id = ${authUserId}
      AND ur.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
    ORDER BY ur.created_at DESC, ur.id DESC
    LIMIT 1
  `

  const row = rows?.[0]
  if (!row?.public_id) return null
  return {
    reservationPublicId: String(row.public_id || "").trim(),
    reservationStatus: String(row.status || "").trim().toUpperCase(),
    litres: Number(row.requested_litres || 0) || null,
    depositAmount: Number(row.deposit_amount || 0) || null,
    identifier: String(row.identifier || "").trim() || null,
    slotStart: row.slot_start ? new Date(row.slot_start).toISOString() : null,
    slotEnd: row.slot_end ? new Date(row.slot_end).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    station: {
      publicId: String(row.station_public_id || "").trim() || null,
      name: String(row.station_name || "").trim() || "Station",
      area: String(row.station_area || "").trim() || null,
    },
    fuelType: String(row.fuel_type || "").trim().toUpperCase() || null,
  }
}

function buildQueueBookingCard(snapshot) {
  return {
    kind: "active_booking",
    bookingType: "queue",
    queueJoinId: snapshot.queueJoinId,
    queueStatus: snapshot.queueStatus,
    station: snapshot.station,
    fuelType: snapshot.fuelType,
    position: snapshot.position,
    carsAhead: snapshot.carsAhead,
    etaMinutes: snapshot.etaMinutes,
    requestedLiters: snapshot.requestedLiters,
  }
}

function buildReservationBookingCard(reservation) {
  return {
    kind: "active_booking",
    bookingType: "reservation",
    reservationPublicId: reservation.reservationPublicId,
    reservationStatus: reservation.reservationStatus,
    station: reservation.station,
    fuelType: reservation.fuelType,
    litres: reservation.litres,
    identifier: reservation.identifier,
    slotStart: reservation.slotStart,
    slotEnd: reservation.slotEnd,
    expiresAt: reservation.expiresAt,
  }
}

function queueFuelActions() {
  return ["PETROL", "DIESEL"].map((fuelType) =>
    buildRespondAction({
      id: ASSISTANT_ACTION_IDS.CHOOSE_FUEL_TYPE,
      label: fuelType === "PETROL" ? "Petrol" : "Diesel",
      payload: { fuelType },
    })
  )
}

function litreActions(values, allowSkip = true) {
  const actions = values.map((litres) =>
    buildRespondAction({
      id: ASSISTANT_ACTION_IDS.CHOOSE_LITRES,
      label: `${litres} L`,
      payload: { litres },
    })
  )
  if (allowSkip) {
    actions.push(
      buildRespondAction({
        id: ASSISTANT_ACTION_IDS.CHOOSE_LITRES,
        label: "Skip litres",
        payload: { litres: null },
      })
    )
  }
  return actions
}

function liveUpdateLanguageActions() {
  return LIVE_UPDATE_LANGUAGE_OPTIONS.map((option) =>
    buildRespondAction({
      id: ASSISTANT_ACTION_IDS.CHOOSE_LIVE_UPDATE_LANGUAGE,
      label: option.label,
      payload: {
        languageCode: option.code,
      },
    })
  )
}

async function buildGuidedFuelRequestResponse(state, currentLocation) {
  const params = cloneParams(state?.params || {})
  const station = params.stationPublicId ? await getStationByPublicId(params.stationPublicId, currentLocation) : null
  const cards = []

  if (station?.publicId) {
    const fuelStatuses = await getFuelStatusesForStations([station])
    cards.push({
      kind: "station",
      stationPublicId: station.publicId,
      name: station.name,
      address: station.address,
      distanceKm: station.distanceKm,
      activeQueueCount: station.activeQueueCount,
      fuelStatuses: fuelStatuses.get(station.publicId) || [],
    })
  }

  return {
    state: {
      goal: ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST,
      step: "choose_booking_mode",
      params,
    },
    response: buildAssistantResponse({
      type: "question",
      title: "Fuel Request",
      message: station?.name
        ? `I found ${station.name}. Do you need fuel now or do you want to reserve it for later?`
        : "Do you need fuel now or do you want to reserve it for later?",
      cards,
      actions: [
        buildRespondAction({
          id: ASSISTANT_ACTION_IDS.CHOOSE_BOOKING_MODE,
          label: "Join queue now",
          tone: "primary",
          payload: {
            goal: ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE,
          },
        }),
        buildRespondAction({
          id: ASSISTANT_ACTION_IDS.CHOOSE_BOOKING_MODE,
          label: "Reserve for later",
          payload: {
            goal: ASSISTANT_TOOL_IDS.MAKE_RESERVATION,
          },
        }),
        buildResetAction(),
      ],
      suggestions: [buildPromptAction("Find fuel near me"), buildPromptAction("Check my booking")],
    }),
  }
}

function buildExplainerResponse(intent) {
  if (intent === ASSISTANT_TOOL_IDS.EXPLAIN_QUEUE) {
    return buildAssistantResponse({
      type: "explainer",
      title: "Digital Queue",
      message: "A digital queue lets you join the line before you reach the pump. You keep your place in the app and see your live queue status.",
      actions: [buildPromptAction("Join fastest queue"), buildPromptAction("Check my booking")],
      suggestions: [buildPromptAction("Queue or reservation?"), buildPromptAction("Find fuel near me")],
    })
  }

  if (intent === ASSISTANT_TOOL_IDS.EXPLAIN_RESERVATION) {
    return buildAssistantResponse({
      type: "explainer",
      title: "Reservation",
      message: "A reservation lets you book a fuel pickup time for later. It is best when you want a planned slot instead of waiting in the queue now.",
      actions: [buildPromptAction("Reserve fuel for later"), buildPromptAction("Queue or reservation?")],
      suggestions: [buildPromptAction("Check my booking"), buildPromptAction("Find fuel near me")],
    })
  }

  if (intent === ASSISTANT_TOOL_IDS.COMPARE_QUEUE_RESERVATION) {
    return buildAssistantResponse({
      type: "explainer",
      title: "Queue Or Reservation",
      message:
        "Choose queue when you need fuel now and want the fastest live option. Choose reservation when you want a guaranteed time slot for later.",
      cards: [
        {
          kind: "system_notice",
          tone: "info",
          title: "Choose queue",
          message: "Best if you are near the station and want fuel as soon as possible.",
        },
        {
          kind: "system_notice",
          tone: "info",
          title: "Choose reservation",
          message: "Best if you want to plan ahead and collect fuel later.",
        },
      ],
      actions: [buildPromptAction("Join fastest queue"), buildPromptAction("Reserve fuel for later")],
      suggestions: [buildPromptAction("Find fuel near me"), buildPromptAction("What is a digital queue?")],
    })
  }

  return buildAssistantResponse({
    type: "explainer",
    title: "Wallet Basics",
    message:
      "Your SmartLink wallet shows your real available balance, locked balance, and current holds. In this version I can explain the wallet and show your live summary.",
    cards: [
      buildSystemNoticeCard({
        title: "Loyalty points",
        message: "Rewards depend on active SmartLink promotions. If a promotion gives wallet credit or loyalty rewards, the app will show it when that offer is active.",
      }),
    ],
    actions: [buildPromptAction("Check wallet"), buildPromptAction("Reserve fuel for later")],
  })
}

async function handleWalletSummary(auth) {
  await ensureWalletReady()
  const wallet = await getUserWalletSummary(Number(auth?.userId || 0))

  return buildAssistantResponse({
    type: "wallet_summary",
    title: "Wallet Summary",
    message: "Here is your live SmartLink wallet summary.",
    cards: [
      {
        kind: "wallet_summary",
        wallet,
      },
    ],
    actions: [buildPromptAction("Wallet help"), buildPromptAction("Check my booking")],
    suggestions: [buildPromptAction("Reserve fuel for later"), buildPromptAction("Join fastest queue")],
  })
}

async function handleCheckBooking(auth) {
  const [queueSnapshot, reservation] = await Promise.all([
    getActiveQueueForUser(auth),
    getActiveReservationDetails(auth),
  ])
  const liveUpdateSubscription = queueSnapshot?.queueJoinId
    ? await getActiveQueueLiveUpdateSubscription({
        userId: auth?.userId,
        queueJoinId: queueSnapshot.queueJoinId,
      }).catch(() => null)
    : null

  const cards = []
  if (queueSnapshot) cards.push(buildQueueBookingCard(queueSnapshot))
  if (reservation) cards.push(buildReservationBookingCard(reservation))

  if (!cards.length) {
    return buildAssistantResponse({
      type: "active_booking",
      title: "No Active Booking",
      message: "You do not have an active queue or reservation right now.",
      data: {
        queueJoinId: null,
      },
      actions: [buildPromptAction("Join fastest queue"), buildPromptAction("Reserve fuel for later")],
      suggestions: [buildPromptAction("Find fuel near me"), buildPromptAction("Check wallet")],
    })
  }

  const cancelActions = []
  if (queueSnapshot) {
    cancelActions.push(buildPromptAction("Cancel queue"))
    cancelActions.push(
      buildPromptAction(liveUpdateSubscription?.publicId ? "Change live update language" : "Join live updates")
    )
    if (liveUpdateSubscription?.publicId) {
      cancelActions.push(buildPromptAction("Stop live updates"))
      cards.push(
        buildSystemNoticeCard({
          tone: "info",
          title: "Live voice updates active",
          message: `Language: ${getLiveUpdateLanguageLabel(liveUpdateSubscription.languageCode)}. Calls will react to queue movement and position 4.`,
        })
      )
    }
  }
  if (reservation) {
    cancelActions.push(buildPromptAction("Cancel reservation"))
  }

  return buildAssistantResponse({
    type: "active_booking",
    title: "Current Booking",
    message: cards.length > 1 ? "Here are your current SmartLink bookings." : "Here is your current SmartLink booking.",
    data: {
      queueJoinId: queueSnapshot?.queueJoinId || null,
    },
    cards,
    actions: cancelActions,
    suggestions: [buildPromptAction("Check wallet"), buildPromptAction("Find fuel near me")],
  })
}

async function handleLiveQueueUpdates(state, auth) {
  const queueSnapshot = await getActiveQueueForUser(auth)
  if (!queueSnapshot?.queueJoinId) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Active Queue",
        message: "Live queue updates only work when you have an active queue booking.",
        actions: [buildPromptAction("Join fastest queue"), buildPromptAction("Check my booking")],
      }),
    }
  }

  const existingSubscription = await getActiveQueueLiveUpdateSubscription({
    userId: auth?.userId,
    queueJoinId: queueSnapshot.queueJoinId,
  }).catch((error) => {
    throw badRequest(error?.message || "Live queue update storage is unavailable.")
  })

  const nextState = state || {
    goal: ASSISTANT_TOOL_IDS.LIVE_QUEUE_UPDATES,
    params: {},
  }
  const params = cloneParams(nextState.params || {})

  if (!params.languageCode) {
    nextState.step = "select_live_update_language"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: existingSubscription?.publicId ? "Change Live Update Language" : "Join Live Updates",
        message: existingSubscription?.publicId
          ? "Choose the language for your live queue update calls."
          : "Choose the language for your live queue update calls. SmartLink will react to queue movement, play hold music between spoken updates, and tell you to head to the station from position 4.",
        cards: [
          buildQueueBookingCard(queueSnapshot),
        ],
        actions: liveUpdateLanguageActions(),
        suggestions: [buildPromptAction("Check my booking"), buildResetAction()],
      }),
    }
  }

  const user = await prisma.users.findUnique({
    where: {
      id: Number(auth?.userId || 0),
    },
    select: {
      phone_e164: true,
    },
  })
  const phoneNumber = String(user?.phone_e164 || "").trim()
  if (!phoneNumber) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "Phone Number Needed",
        message: "Your account needs a phone number before SmartLink can place live update calls.",
        actions: [buildPromptAction("Check my booking"), buildResetAction()],
      }),
    }
  }

  const subscription = await upsertQueueLiveUpdateSubscription({
    userId: auth?.userId,
    queueJoinId: queueSnapshot.queueJoinId,
    phoneNumber,
    languageCode: params.languageCode,
  }).catch((error) => {
    throw badRequest(error?.message || "Could not enable live queue updates.")
  })

  return {
    state: null,
    response: buildAssistantResponse({
      type: "active_booking",
      title: "Live Updates Enabled",
      message: `Live queue updates are active in ${getLiveUpdateLanguageLabel(subscription.languageCode)}.`,
      cards: [
        buildQueueBookingCard(queueSnapshot),
        buildSystemNoticeCard({
          tone: "info",
          title: "What will happen",
          message: "SmartLink will react when your position changes, keep hold music between spoken updates, and call you to head to the station from position 4.",
        }),
      ],
      actions: [buildPromptAction("Check my booking"), buildPromptAction("Stop live updates")],
      suggestions: [buildPromptAction("Find fuel near me")],
    }),
  }
}

async function handleStopLiveQueueUpdates(auth) {
  const queueSnapshot = await getActiveQueueForUser(auth)
  if (!queueSnapshot?.queueJoinId) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Active Queue",
        message: "There is no active queue booking to stop live updates for.",
        actions: [buildPromptAction("Check my booking"), buildPromptAction("Join fastest queue")],
      }),
    }
  }

  await deactivateQueueLiveUpdateSubscription({
    userId: auth?.userId,
    queueJoinId: queueSnapshot.queueJoinId,
  }).catch((error) => {
    throw badRequest(error?.message || "Could not stop live queue updates.")
  })

  return {
    state: null,
    response: buildAssistantResponse({
      type: "success",
      title: "Live Updates Stopped",
      message: "SmartLink has stopped your live queue update calls for this booking.",
      actions: [buildPromptAction("Check my booking"), buildPromptAction("Join live updates")],
    }),
  }
}

async function handleFindFuelNearby(state, auth, currentLocation) {
  const fuelType = String(state?.params?.fuelType || "").trim().toUpperCase() || null
  const stations = await buildNearbyStations({
    fuelType,
    currentLocation,
    limit: 5,
  })

  if (!stations.length) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Stations Found",
        message: fuelType
          ? `I could not find a nearby station with ${fuelType === "PETROL" ? "petrol" : "diesel"} right now.`
          : "I could not find nearby stations right now.",
        actions: [buildPromptAction("Find fuel near me"), buildPromptAction("Join fastest queue")],
        suggestions: [buildPromptAction("Reserve fuel for later"), buildPromptAction("Check wallet")],
      }),
    }
  }

  return {
    state: {
      goal: ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST,
      step: "choose_booking_mode",
      params: fuelType ? { fuelType } : {},
    },
    response: buildAssistantResponse({
      type: "station_list",
      title: "Nearby Fuel",
      message: fuelType
        ? `I found ${stations.length} stations with ${fuelType === "PETROL" ? "petrol" : "diesel"}.`
        : `I found ${stations.length} stations you can check now.`,
      cards: stations.map((station) => ({
        kind: "station",
        stationPublicId: station.publicId,
        name: station.name,
        address: station.address,
        distanceKm: station.distanceKm,
        activeQueueCount: station.activeQueueCount,
        fuelStatuses: station.fuelStatuses,
        actions: [
          buildRespondAction({
            id: ASSISTANT_ACTION_IDS.CHOOSE_STATION,
            label: "Choose station",
            payload: {
              stationPublicId: station.publicId,
              stationName: station.name,
            },
          }),
        ],
      })),
      actions: [],
      suggestions: [buildPromptAction("Check my booking")],
    }),
  }
}

async function prepareJoinQueueAction({ auth, stationPublicId, fuelType, litres, currentLocation }) {
  const station = await getStationByPublicId(stationPublicId, currentLocation)
  if (!station?.publicId) {
    throw badRequest("Station not found.")
  }

  const existingQueue = await getActiveQueueForUser(auth)
  if (existingQueue?.queueJoinId) {
    return {
      existingQueue,
    }
  }

  const settings = await getQueueSettings(station.id)
  if (!station.queuePlanEnabled) {
    throw badRequest("Digital queue is not available for this station.")
  }
  if (!Number(settings?.is_queue_enabled || 0)) {
    throw badRequest("Queue is disabled at this station.")
  }
  if (Number(settings?.joins_paused || 0)) {
    throw badRequest("Queue joins are currently paused at this station.")
  }
  if (fuelType === "PETROL" && !Number(settings?.petrol_enabled || 0)) {
    throw badRequest("Petrol queue is disabled at this station.")
  }
  if (fuelType === "DIESEL" && !Number(settings?.diesel_enabled || 0)) {
    throw badRequest("Diesel queue is disabled at this station.")
  }

  const fuelStatuses = await listStationFuelStatusesForQueueJoin(station.id, settings)
  const selectedFuelStatus = fuelStatusForCode(fuelStatuses, fuelType)
  if (String(selectedFuelStatus?.status || "").trim().toLowerCase() === "unavailable") {
    throw badRequest(`${selectedFuelStatus?.label || fuelType} is unavailable at this station right now.`)
  }

  const queueOptions = await buildQueueOptions({ fuelType, currentLocation, limit: 20 })
  const selectedOption = queueOptions.find((item) => item.station.publicId === station.publicId) || null

  return {
    station,
    fuelType,
    litres,
    estimatedWaitMinutes: selectedOption?.estimatedWaitMinutes || null,
    activeQueueCount: selectedOption?.station?.activeQueueCount ?? station.activeQueueCount,
  }
}

async function handleJoinFastestQueue(state, auth, currentLocation) {
  const nextState = state || {
    goal: ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE,
    params: {},
  }
  const params = cloneParams(nextState.params || {})

  if (!params.fuelType) {
    nextState.step = "select_fuel_type"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: "Join Fastest Queue",
        message: "Which fuel do you need?",
        actions: queueFuelActions(),
        suggestions: [buildPromptAction("Find fuel near me"), buildResetAction()],
      }),
    }
  }

  const queueOptions = await buildQueueOptions({
    fuelType: params.fuelType,
    currentLocation,
    limit: 4,
  })

  if (!queueOptions.length) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Queue Option Available",
        message: `I could not find an open ${params.fuelType === "PETROL" ? "petrol" : "diesel"} queue right now.`,
        actions: [buildPromptAction("Find fuel near me"), buildPromptAction("Reserve fuel for later")],
        suggestions: [buildResetAction()],
      }),
    }
  }

  if (!params.stationPublicId) {
    nextState.step = "select_station"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "queue_options",
        title: "Queue Options",
        message: `You need fuel now. Here are the best live queue options I found for ${params.fuelType === "PETROL" ? "petrol" : "diesel"}.`,
        cards: queueOptions.map((option, index) => ({
          kind: "queue_option",
          stationPublicId: option.station.publicId,
          stationName: option.station.name,
          address: option.station.address,
          distanceKm: option.station.distanceKm,
          fuelType: params.fuelType,
          activeQueueCount: option.station.activeQueueCount,
          estimatedWaitMinutes: option.estimatedWaitMinutes,
          recommendation: index === 0 ? "Fastest option" : null,
          actions: [
            buildRespondAction({
              id: ASSISTANT_ACTION_IDS.CHOOSE_STATION,
              label: "Choose this station",
              tone: index === 0 ? "primary" : "secondary",
              payload: {
                stationPublicId: option.station.publicId,
                stationName: option.station.name,
              },
            }),
          ],
        })),
        actions: [buildResetAction()],
      }),
    }
  }

  if (!params.hasSelectedLitres) {
    nextState.step = "select_litres"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: "Fuel Amount",
        message: "How many litres do you need? You can skip this if you are not sure yet.",
        actions: litreActions(DEFAULT_QUEUE_LITRE_CHOICES, true),
        suggestions: [buildResetAction()],
      }),
    }
  }

  const prepared = await prepareJoinQueueAction({
    auth,
    stationPublicId: params.stationPublicId,
    fuelType: params.fuelType,
    litres: params.litres ?? null,
    currentLocation,
  })

  if (prepared.existingQueue) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "active_booking",
        title: "Queue Already Active",
        message: "You already have an active queue. I cannot join another one right now.",
        cards: [buildQueueBookingCard(prepared.existingQueue)],
        actions: [buildPromptAction("Check my booking"), buildPromptAction("Cancel queue")],
      }),
    }
  }

  const confirmationToken = buildConfirmationToken({
    auth,
    actionType: "confirm_join_queue",
    intent: ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE,
    params: {
      stationPublicId: prepared.station.publicId,
      fuelType: prepared.fuelType,
      requestedLiters: prepared.litres,
    },
  })

  return {
    state: null,
    response: buildAssistantResponse({
      type: "confirmation",
      title: "Confirm Queue Join",
      message: "Before I join this queue, please confirm.",
      requiresConfirmation: true,
      confirmationToken,
      cards: [
        {
          kind: "confirmation",
          actionType: "join_queue",
          title: "Join queue",
          summaryLines: [
            prepared.station.name,
            prepared.fuelType === "PETROL" ? "Fuel: Petrol" : "Fuel: Diesel",
            prepared.litres ? `Litres: ${prepared.litres} L` : "Litres: Not set",
            prepared.estimatedWaitMinutes ? `Estimated wait: ${prepared.estimatedWaitMinutes} min` : null,
          ].filter(Boolean),
        },
      ],
      actions: [
        buildConfirmAction({ confirmationToken, label: "Join queue" }),
        buildResetAction("Cancel"),
      ],
      suggestions: [buildPromptAction("Check my booking")],
    }),
  }
}

async function handleMakeReservation(state, auth, currentLocation) {
  const nextState = state || {
    goal: ASSISTANT_TOOL_IDS.MAKE_RESERVATION,
    params: {},
  }
  const params = cloneParams(nextState.params || {})

  if (!params.fuelType) {
    nextState.step = "select_fuel_type"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: "Make Reservation",
        message: "Which fuel do you want to reserve?",
        actions: queueFuelActions(),
        suggestions: [buildResetAction()],
      }),
    }
  }

  const stations = (await buildNearbyStations({
    fuelType: params.fuelType,
    currentLocation,
    limit: 6,
  })).filter((station) => station.reservationPlanEnabled && station.reservationsEnabled)

  if (!stations.length) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Reservation Station Available",
        message: `I could not find an open ${params.fuelType === "PETROL" ? "petrol" : "diesel"} reservation station right now.`,
        actions: [buildPromptAction("Find fuel near me"), buildPromptAction("Join fastest queue")],
        suggestions: [buildResetAction()],
      }),
    }
  }

  if (!params.stationPublicId) {
    nextState.step = "select_station"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "station_list",
        title: "Reservation Stations",
        message: "Choose the station where you want to collect fuel later.",
        cards: stations.map((station) => ({
          kind: "station",
          stationPublicId: station.publicId,
          name: station.name,
          address: station.address,
          distanceKm: station.distanceKm,
          fuelStatuses: station.fuelStatuses,
          actions: [
            buildRespondAction({
              id: ASSISTANT_ACTION_IDS.CHOOSE_STATION,
              label: "Choose station",
              payload: {
                stationPublicId: station.publicId,
                stationName: station.name,
              },
            }),
          ],
        })),
        actions: [buildResetAction()],
      }),
    }
  }

  if (!params.hasSelectedLitres) {
    nextState.step = "select_litres"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: "Reserved Litres",
        message: "How many litres do you want to reserve?",
        actions: litreActions(DEFAULT_RESERVATION_LITRE_CHOICES, false),
        suggestions: [buildResetAction()],
      }),
    }
  }

  if (!String(params.identifier || "").trim()) {
    nextState.step = "enter_identifier"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "question",
        title: "Reservation Identifier",
        message: "Type the vehicle plate or booking identifier you want me to use for this reservation.",
        actions: [buildResetAction()],
        suggestions: [buildPromptAction("Check my booking")],
      }),
    }
  }

  if (String(params.identifier || "").trim().length < 3) {
    nextState.step = "enter_identifier"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "blocked",
        title: "Identifier Needed",
        message: "The identifier is too short. Please enter at least 3 characters.",
        actions: [buildResetAction()],
      }),
    }
  }

  if (!params.slotStart || !params.slotEnd) {
    const slotPayload = await listReservationSlotsForUser({
      stationPublicId: params.stationPublicId,
      auth,
      query: {
        fuelType: params.fuelType,
        lookAhead: 6,
      },
    })
    const availableSlots = (slotPayload.slots || []).filter((slot) => !slot.isFull)
    if (!availableSlots.length) {
      return {
        state: null,
        response: buildAssistantResponse({
          type: "blocked",
          title: "No Reservation Slot Available",
          message: "I could not find an open reservation slot for that station right now.",
          actions: [buildPromptAction("Join fastest queue"), buildResetAction()],
        }),
      }
    }

    nextState.step = "select_slot"
    nextState.params = params
    return {
      state: nextState,
      response: buildAssistantResponse({
        type: "reservation_slots",
        title: "Available Slots",
        message: "Choose a time slot for your reservation.",
        cards: availableSlots.slice(0, 5).map((slot) => ({
          kind: "reservation_slot",
          stationPublicId: params.stationPublicId,
          stationName: params.stationName || "Station",
          fuelType: params.fuelType,
          litres: params.litres,
          slotStart: slot.slotStart,
          slotEnd: slot.slotEnd,
          slotLabel: slot.slotLabel,
          slotDateLabel: slot.slotDateLabel,
          availableSpots: slot.availableSpots,
          actions: [
            buildRespondAction({
              id: ASSISTANT_ACTION_IDS.CHOOSE_SLOT,
              label: "Choose slot",
              payload: {
                stationPublicId: params.stationPublicId,
                stationName: params.stationName || "Station",
                slotStart: slot.slotStart,
                slotEnd: slot.slotEnd,
                slotLabel: slot.slotLabel,
                slotDateLabel: slot.slotDateLabel,
              },
            }),
          ],
        })),
        actions: [buildResetAction()],
      }),
    }
  }

  const context = await resolveStationReservationContext(params.stationPublicId)
  const depositAmount = Math.max(
    DEFAULT_RESERVATION_DEPOSIT,
    Number(context?.settings?.min_deposit_amount || 0) || DEFAULT_RESERVATION_DEPOSIT
  )

  const confirmationToken = buildConfirmationToken({
    auth,
    actionType: "confirm_create_reservation",
    intent: ASSISTANT_TOOL_IDS.MAKE_RESERVATION,
      params: {
        stationPublicId: params.stationPublicId,
        fuelType: params.fuelType,
        expectedLiters: params.litres,
        slotStart: params.slotStart,
        slotEnd: params.slotEnd,
        identifier: String(params.identifier || "").trim(),
        depositAmount,
      },
    })

  return {
    state: null,
    response: buildAssistantResponse({
      type: "confirmation",
      title: "Confirm Reservation",
      message: "Before I make this reservation, please confirm.",
      requiresConfirmation: true,
      confirmationToken,
      cards: [
        {
          kind: "confirmation",
          actionType: "create_reservation",
          title: "Create reservation",
          summaryLines: [
            params.stationName || "Selected station",
            params.fuelType === "PETROL" ? "Fuel: Petrol" : "Fuel: Diesel",
            `Litres: ${params.litres} L`,
            `Identifier: ${params.identifier}`,
            `Slot: ${params.slotDateLabel || ""} ${params.slotLabel || ""}`.trim(),
            `Deposit: MWK ${depositAmount.toLocaleString()}`,
          ],
        },
      ],
      actions: [
        buildConfirmAction({ confirmationToken, label: "Make reservation" }),
        buildResetAction("Cancel"),
      ],
      suggestions: [buildPromptAction("Check my booking")],
    }),
  }
}

async function handleCancelBooking(state, auth) {
  const [queueSnapshot, reservation] = await Promise.all([
    getActiveQueueForUser(auth),
    getActiveReservationDetails(auth),
  ])

  if (!queueSnapshot && !reservation) {
    return {
      state: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "No Active Booking",
        message: "You do not have an active queue or reservation to cancel.",
        actions: [buildPromptAction("Join fastest queue"), buildPromptAction("Reserve fuel for later")],
      }),
    }
  }

  const params = cloneParams(state?.params || {})
  let bookingKind = params.bookingKind || null

  if (!bookingKind) {
    if (queueSnapshot && !reservation) bookingKind = "queue"
    else if (reservation && !queueSnapshot) bookingKind = "reservation"
  }

  if (!bookingKind) {
    return {
      state: {
        goal: ASSISTANT_TOOL_IDS.CANCEL_BOOKING,
        step: "select_cancel_target",
        params,
      },
      response: buildAssistantResponse({
        type: "question",
        title: "Cancel Booking",
        message: "Which booking do you want to cancel?",
        actions: [
          buildRespondAction({
            id: ASSISTANT_ACTION_IDS.CHOOSE_CANCEL_TARGET,
            label: "Cancel queue",
            payload: { bookingKind: "queue", queueJoinId: queueSnapshot?.queueJoinId || null },
            tone: "danger",
          }),
          buildRespondAction({
            id: ASSISTANT_ACTION_IDS.CHOOSE_CANCEL_TARGET,
            label: "Cancel reservation",
            payload: { bookingKind: "reservation", reservationPublicId: reservation?.reservationPublicId || null },
            tone: "danger",
          }),
          buildResetAction(),
        ],
      }),
    }
  }

  if (bookingKind === "queue") {
    if (!queueSnapshot?.queueJoinId) {
      throw badRequest("You do not have an active queue to cancel.")
    }

    const confirmationToken = buildConfirmationToken({
      auth,
      actionType: "confirm_cancel_queue",
      intent: ASSISTANT_TOOL_IDS.CANCEL_BOOKING,
      params: {
        queueJoinId: queueSnapshot.queueJoinId,
      },
    })

    return {
      state: null,
      response: buildAssistantResponse({
        type: "confirmation",
        title: "Confirm Queue Cancellation",
        message: "Before I cancel this queue, please confirm.",
        requiresConfirmation: true,
        confirmationToken,
        cards: [
          {
            kind: "confirmation",
            actionType: "cancel_queue",
            title: "Cancel queue",
            summaryLines: [
              queueSnapshot.station?.name || "Station",
              queueSnapshot.position ? `Position: #${queueSnapshot.position}` : null,
              queueSnapshot.fuelType ? `Fuel: ${queueSnapshot.fuelType}` : null,
            ].filter(Boolean),
          },
        ],
        actions: [
          buildConfirmAction({ confirmationToken, label: "Cancel queue", tone: "danger" }),
          buildResetAction("Keep booking"),
        ],
      }),
    }
  }

  if (!reservation?.reservationPublicId) {
    throw badRequest("You do not have an active reservation to cancel.")
  }

  const confirmationToken = buildConfirmationToken({
    auth,
    actionType: "confirm_cancel_reservation",
    intent: ASSISTANT_TOOL_IDS.CANCEL_BOOKING,
    params: {
      reservationPublicId: reservation.reservationPublicId,
      reason: "assistant_cancel",
    },
  })

  return {
    state: null,
    response: buildAssistantResponse({
      type: "confirmation",
      title: "Confirm Reservation Cancellation",
      message: "Before I cancel this reservation, please confirm.",
      requiresConfirmation: true,
      confirmationToken,
      cards: [
        {
          kind: "confirmation",
          actionType: "cancel_reservation",
          title: "Cancel reservation",
          summaryLines: [
            reservation.station?.name || "Station",
            reservation.fuelType ? `Fuel: ${reservation.fuelType}` : null,
            reservation.slotStart ? `Slot starts: ${new Date(reservation.slotStart).toLocaleString("en-US")}` : null,
          ].filter(Boolean),
        },
      ],
      actions: [
        buildConfirmAction({ confirmationToken, label: "Cancel reservation", tone: "danger" }),
        buildResetAction("Keep booking"),
      ],
    }),
  }
}

async function handleIntent({ state, auth, currentLocation }) {
  switch (state?.goal) {
    case ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST:
      return buildGuidedFuelRequestResponse(state, currentLocation)
    case ASSISTANT_TOOL_IDS.FIND_FUEL_NEARBY:
      return handleFindFuelNearby(state, auth, currentLocation)
    case ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE:
      return handleJoinFastestQueue(state, auth, currentLocation)
    case ASSISTANT_TOOL_IDS.MAKE_RESERVATION:
      return handleMakeReservation(state, auth, currentLocation)
    case ASSISTANT_TOOL_IDS.CHECK_BOOKING:
      return {
        state: null,
        response: await handleCheckBooking(auth),
      }
    case ASSISTANT_TOOL_IDS.LIVE_QUEUE_UPDATES:
      return handleLiveQueueUpdates(state, auth)
    case ASSISTANT_TOOL_IDS.STOP_LIVE_QUEUE_UPDATES:
      return handleStopLiveQueueUpdates(auth)
    case ASSISTANT_TOOL_IDS.CANCEL_BOOKING:
      return handleCancelBooking(state, auth)
    case ASSISTANT_TOOL_IDS.WALLET_SUMMARY:
      return {
        state: null,
        response: await handleWalletSummary(auth),
      }
    case ASSISTANT_TOOL_IDS.EXPLAIN_QUEUE:
    case ASSISTANT_TOOL_IDS.EXPLAIN_RESERVATION:
    case ASSISTANT_TOOL_IDS.COMPARE_QUEUE_RESERVATION:
    case ASSISTANT_TOOL_IDS.WALLET_HELP:
      return {
        state: null,
        response: buildExplainerResponse(state.goal),
      }
    default:
      return {
        state: null,
        response: buildWelcomeResponse(),
      }
  }
}

export async function respondToAssistant({
  auth,
  message = "",
  sessionToken = "",
  actionId = "",
  actionPayload = {},
  currentLocation = null,
} = {}) {
  const scopedLocation = sanitizeLocation(currentLocation)
  const parsedIntent = parseAssistantIntent(message)
  const normalizedActionId = String(actionId || "").trim()
  const normalizedMessage = String(message || "").trim()
  const matchedKnowledge = normalizedMessage ? matchAssistantKnowledge(normalizedMessage) : null
  const resolvedStation = normalizedMessage
    ? await resolveStationMentionFromText(normalizedMessage, scopedLocation).catch(() => null)
    : null

  let state = null
  if (sessionToken) {
    try {
      const parsed = verifyToken(sessionToken, "assistant_state", auth)
      state = parsed?.state || null
    } catch {
      state = null
    }
  }

  if (normalizedActionId === ASSISTANT_ACTION_IDS.RESET) {
    const response = buildWelcomeResponse()
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.respond",
      intent: "reset",
      requestText: normalizedMessage || "reset",
      structuredPayload: { actionId: normalizedActionId },
      outcomeStatus: "SUCCEEDED",
    }).catch(() => {})
    return {
      session: null,
      response,
    }
  }

  if (matchedKnowledge && !parsedIntent.intent && !normalizedActionId) {
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.respond",
      intent: `knowledge:${matchedKnowledge.id}`,
      requestText: normalizedMessage || null,
      structuredPayload: {
        knowledgeId: matchedKnowledge.id,
        currentLocation: scopedLocation,
      },
      outcomeStatus: "SUCCEEDED",
    }).catch(() => {})

    return {
      session: buildSessionEnvelope(state, auth),
      response: buildAssistantKnowledgeResponse(matchedKnowledge, {
        currentState: state,
      }),
    }
  }

  if (normalizedActionId && state) {
    state = applyActionToState(state, normalizedActionId, actionPayload)
  }

  if (normalizedMessage) {
    if (parsedIntent.intent) {
      const carriedParams = {
        ...cloneParams(state?.params || {}),
        ...(resolvedStation?.publicId
          ? {
              stationPublicId: resolvedStation.publicId,
              stationName: resolvedStation.name,
            }
          : {}),
      }
      state = initializeStateFromIntent(parsedIntent, carriedParams)
    } else if (state) {
      if (!shouldKeepAssistantStateForMessage({
        state,
        parsedIntent,
        text: normalizedMessage,
        resolvedStation,
      })) {
        const response = buildStateClarificationResponse(state)
        await createAssistantAuditLog({
          userId: auth?.userId,
          sessionPublicId: auth?.sessionPublicId || null,
          actionType: "assistant.respond",
          intent: state.goal,
          requestText: normalizedMessage || null,
          structuredPayload: {
            actionId: normalizedActionId || null,
            actionPayload,
            currentLocation: scopedLocation,
            reason: "state_clarification_required",
          },
          outcomeStatus: "SUCCEEDED",
        }).catch(() => {})

        return {
          session: buildSessionEnvelope(state, auth),
          response,
        }
      }

      state = mergeFreeTextIntoState(state, normalizedMessage, resolvedStation)
      if (state?.goal === ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST) {
        if (parsedIntent?.params?.wantsNow) {
          state = {
            ...state,
            goal: ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE,
            step: null,
            params: {
              ...cloneParams(state.params || {}),
              hasSelectedLitres:
                state?.params?.litres !== null && state?.params?.litres !== undefined,
            },
          }
        } else if (parsedIntent?.params?.wantsLater) {
          state = {
            ...state,
            goal: ASSISTANT_TOOL_IDS.MAKE_RESERVATION,
            step: null,
            params: {
              ...cloneParams(state.params || {}),
              hasSelectedLitres:
                state?.params?.litres !== null && state?.params?.litres !== undefined,
            },
          }
        }
      }
    }
  }

  if (!state && parsedIntent.intent) {
    state = initializeStateFromIntent(parsedIntent, resolvedStation?.publicId
      ? {
          stationPublicId: resolvedStation.publicId,
          stationName: resolvedStation.name,
        }
      : {})
  }

  if (!state && resolvedStation?.publicId && (parsedIntent?.params?.fuelType || parsedIntent?.params?.litres !== null)) {
    const guidedParams = {
      ...cloneParams(parsedIntent?.params || {}),
      stationPublicId: resolvedStation.publicId,
      stationName: resolvedStation.name,
      hasSelectedLitres: parsedIntent?.params?.litres !== null && parsedIntent?.params?.litres !== undefined,
    }

    if (guidedParams.wantsNow) {
      state = {
        goal: ASSISTANT_TOOL_IDS.JOIN_FASTEST_QUEUE,
        step: null,
        params: guidedParams,
      }
    } else if (guidedParams.wantsLater) {
      state = {
        goal: ASSISTANT_TOOL_IDS.MAKE_RESERVATION,
        step: null,
        params: guidedParams,
      }
    } else {
      state = {
        goal: ASSISTANT_TOOL_IDS.GUIDED_FUEL_REQUEST,
        step: "choose_booking_mode",
        params: guidedParams,
      }
    }
  }

  if (!state) {
    const response = buildWelcomeResponse()
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.respond",
      intent: parsedIntent.intent || null,
      requestText: normalizedMessage || null,
      structuredPayload: {
        actionId: normalizedActionId || null,
        actionPayload,
      },
      outcomeStatus: "SUCCEEDED",
    }).catch(() => {})
    return {
      session: null,
      response,
    }
  }

  try {
    const result = await handleIntent({ state, auth, currentLocation: scopedLocation })
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.respond",
      intent: state.goal,
      requestText: normalizedMessage || null,
      structuredPayload: {
        actionId: normalizedActionId || null,
        actionPayload,
        currentLocation: scopedLocation,
      },
      outcomeStatus: result?.response?.requiresConfirmation ? "PREPARED" : "SUCCEEDED",
    }).catch(() => {})

    return {
      session: buildSessionEnvelope(result?.state || null, auth),
      response: result.response,
    }
  } catch (error) {
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.respond",
      intent: state.goal,
      requestText: normalizedMessage || null,
      structuredPayload: {
        actionId: normalizedActionId || null,
        actionPayload,
        currentLocation: scopedLocation,
      },
      outcomeStatus: "FAILED",
      errorMessage: error?.message || "Assistant request failed",
    }).catch(() => {})

    return {
      session: null,
      response: buildAssistantResponse({
        type: "blocked",
        title: "Action Blocked",
        message: error?.message || "I could not complete that SmartLink task.",
        cards: [
          buildSystemNoticeCard({
            tone: "warning",
            title: "What happened",
            message: error?.message || "I could not complete that SmartLink task.",
          }),
        ],
        actions: [buildResetAction(), buildPromptAction("Check my booking")],
      }),
    }
  }
}

export async function confirmAssistantAction({ auth, confirmationToken } = {}) {
  const parsed = verifyToken(confirmationToken, "assistant_confirm", auth)
  const actionType = String(parsed?.actionType || "").trim()
  const params = parsed?.params && typeof parsed.params === "object" ? parsed.params : {}

  try {
    if (actionType === "confirm_join_queue") {
      const result = await executeQueueJoinAction({
        stationPublicId: params.stationPublicId,
        auth,
        body: {
          fuelType: params.fuelType,
          requestedLiters: params.requestedLiters ?? undefined,
        },
        source: "assistant",
      })

      await createAssistantAuditLog({
        userId: auth?.userId,
        sessionPublicId: auth?.sessionPublicId || null,
        actionType: "assistant.confirm",
        intent: parsed?.intent || null,
        structuredPayload: {
          confirmationActionType: actionType,
          params,
        },
        outcomeStatus: "CONFIRMED",
      }).catch(() => {})

      return {
        session: null,
        response: buildAssistantResponse({
          type: "success",
          title: "Queue Joined",
          message: `You joined the queue at ${result.status?.station?.name || "the station"}.`,
          data: {
            queueJoinId: result.queueJoinId || result.status?.queueJoinId || null,
          },
          cards: [buildQueueBookingCard(result.status)],
          actions: [buildPromptAction("Check my booking")],
          suggestions: [buildPromptAction("Cancel queue"), buildPromptAction("Check wallet")],
        }),
      }
    }

    if (actionType === "confirm_create_reservation") {
      const result = await executeCreateReservationAction({
        stationPublicId: params.stationPublicId,
        auth,
        body: {
          fuelType: params.fuelType,
          expectedLiters: params.expectedLiters,
          slotStart: params.slotStart,
          slotEnd: params.slotEnd,
          identifier: params.identifier,
          depositAmount: params.depositAmount,
        },
        source: "assistant",
      })

      await createAssistantAuditLog({
        userId: auth?.userId,
        sessionPublicId: auth?.sessionPublicId || null,
        actionType: "assistant.confirm",
        intent: parsed?.intent || null,
        structuredPayload: {
          confirmationActionType: actionType,
          params,
        },
        outcomeStatus: "CONFIRMED",
      }).catch(() => {})

      return {
        session: null,
        response: buildAssistantResponse({
          type: "success",
          title: "Reservation Confirmed",
          message: `Your reservation is confirmed for ${result.reservation?.slotLabel || "the selected slot"}.`,
          cards: [buildReservationBookingCard({
            reservationPublicId: result.reservationId,
            reservationStatus: "CONFIRMED",
            litres: result.reservation?.litersReserved || null,
            identifier: result.reservation?.maskedPlate || null,
            slotStart: result.reservation?.slotStart || null,
            slotEnd: result.reservation?.slotEnd || null,
            expiresAt: result.reservation?.expiresAt || null,
            station: result.reservation?.station || {},
            fuelType: result.reservation?.fuelType || null,
          })],
          actions: [buildPromptAction("Check my booking")],
          suggestions: [buildPromptAction("Cancel reservation"), buildPromptAction("Check wallet")],
        }),
      }
    }

    if (actionType === "confirm_cancel_queue") {
      const result = await executeLeaveQueueAction({
        queueJoinId: params.queueJoinId,
        auth,
        body: {
          reason: "assistant_cancel",
        },
        source: "assistant",
      })

      await createAssistantAuditLog({
        userId: auth?.userId,
        sessionPublicId: auth?.sessionPublicId || null,
        actionType: "assistant.confirm",
        intent: parsed?.intent || null,
        structuredPayload: {
          confirmationActionType: actionType,
          params,
        },
        outcomeStatus: "CONFIRMED",
      }).catch(() => {})

      return {
        session: null,
        response: buildAssistantResponse({
          type: "success",
          title: "Queue Cancelled",
          message: result.left ? "Your queue was cancelled." : result.message || "The queue was already closed.",
          data: {
            queueJoinId: null,
          },
          actions: [buildPromptAction("Find fuel near me"), buildPromptAction("Check my booking")],
        }),
      }
    }

    if (actionType === "confirm_cancel_reservation") {
      const result = await executeCancelReservationAction({
        reservationPublicId: params.reservationPublicId,
        auth,
        body: {
          reason: params.reason || "assistant_cancel",
        },
        source: "assistant",
      })

      await createAssistantAuditLog({
        userId: auth?.userId,
        sessionPublicId: auth?.sessionPublicId || null,
        actionType: "assistant.confirm",
        intent: parsed?.intent || null,
        structuredPayload: {
          confirmationActionType: actionType,
          params,
        },
        outcomeStatus: "CONFIRMED",
      }).catch(() => {})

      return {
        session: null,
        response: buildAssistantResponse({
          type: "success",
          title: "Reservation Cancelled",
          message: result.cancelled
            ? `Your reservation was cancelled.${result.refundAmount ? ` Refund: MWK ${Number(result.refundAmount).toLocaleString()}.` : ""}`
            : result.message || "The reservation was already closed.",
          actions: [buildPromptAction("Find fuel near me"), buildPromptAction("Check my booking")],
        }),
      }
    }

    throw badRequest("Assistant confirmation action is not supported.")
  } catch (error) {
    await createAssistantAuditLog({
      userId: auth?.userId,
      sessionPublicId: auth?.sessionPublicId || null,
      actionType: "assistant.confirm",
      intent: parsed?.intent || null,
      structuredPayload: {
        confirmationActionType: actionType,
        params,
      },
      outcomeStatus: "FAILED",
      errorMessage: error?.message || "Assistant confirmation failed",
    }).catch(() => {})

    return {
      session: null,
      response: buildAssistantResponse({
        type: "error",
        title: "Action Failed",
        message: error?.message || "The SmartLink action could not be completed.",
        cards: [
          buildSystemNoticeCard({
            tone: "warning",
            title: "What happened",
            message: error?.message || "The SmartLink action could not be completed.",
          }),
        ],
        actions: [buildPromptAction("Check my booking"), buildResetAction()],
      }),
    }
  }
}

/**
 * Simple in-memory store for USSD sessions.
 * In production, use Redis or a database table.
 */
const ussdSessionStore = new Map()

function normalizeUssdText(value) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function buildUssdTextResponse(prefix, body) {
  const normalizedBody = String(body || "")
    .split("\n")
    .map((line) => normalizeUssdText(line))
    .filter(Boolean)
    .join("\n")
  return `${prefix} ${normalizedBody}`.trim()
}

function buildUssdMenuScreen(title, options = [], { includeBack = true, includeExit = false } = {}) {
  const lines = [title]
  options.forEach((option, index) => {
    lines.push(`${index + 1}. ${normalizeUssdText(option.label)}`)
  })
  if (includeBack) lines.push("00. Back")
  if (includeExit) lines.push("0. Exit")
  return buildUssdTextResponse("CON", lines.join("\n"))
}

function buildUssdHomeOptions() {
  return [
    { kind: "menu", label: "Find fuel", menu: "fuel" },
    { kind: "prompt", label: "My booking", prompt: "Check my booking" },
    { kind: "prompt", label: "My balance", prompt: "Check wallet balance" },
    { kind: "menu", label: "Help", menu: "help" },
  ]
}

function buildUssdFuelOptions() {
  return [
    { kind: "prompt", label: "Fuel now", prompt: "Join fastest queue" },
    { kind: "prompt", label: "Reserve later", prompt: "Reserve fuel for later" },
    { kind: "prompt", label: "Nearby stations", prompt: "Find fuel near me" },
  ]
}

function buildUssdHelpOptions() {
  return [
    { kind: "prompt", label: "Queue or reservation", prompt: "Queue or reservation?" },
    { kind: "prompt", label: "What is queue?", prompt: "What is a digital queue?" },
    { kind: "prompt", label: "Wallet help", prompt: "Wallet help" },
  ]
}

function buildUssdMenuState(menu = "home") {
  if (menu === "fuel") {
    return {
      menu,
      menuOptions: buildUssdFuelOptions(),
      text: buildUssdMenuScreen("Fuel menu", buildUssdFuelOptions()),
    }
  }
  if (menu === "help") {
    return {
      menu,
      menuOptions: buildUssdHelpOptions(),
      text: buildUssdMenuScreen("Help", buildUssdHelpOptions()),
    }
  }
  return {
    menu: "home",
    menuOptions: buildUssdHomeOptions(),
    text: buildUssdMenuScreen("SmartLink", buildUssdHomeOptions(), { includeBack: false, includeExit: true }),
  }
}

export function resolveUssdDirectPrompt(currentInput, session = {}) {
  const normalizedInput = String(currentInput || "").trim()
  if (!normalizedInput || !/^\d+$/.test(normalizedInput)) return normalizedInput

  const indexedOption = Array.isArray(session.menuOptions) ? session.menuOptions[Number(normalizedInput) - 1] : null
  if (indexedOption?.kind === "prompt" && indexedOption.prompt) return String(indexedOption.prompt)
  if (indexedOption?.kind === "menu" && indexedOption.menu === "fuel") return "Find fuel near me"
  if (indexedOption?.kind === "menu" && indexedOption.menu === "help") return "Help"

  const homeOptions = buildUssdHomeOptions()
  const homeOption = homeOptions[Number(normalizedInput) - 1] || null
  if (homeOption?.kind === "prompt" && homeOption.prompt) return String(homeOption.prompt)
  if (homeOption?.kind === "menu" && homeOption.menu === "fuel") return "Find fuel near me"
  if (homeOption?.kind === "menu" && homeOption.menu === "help") return "Help"

  return normalizedInput
}

function clearUssdSession(sessionId) {
  ussdSessionStore.delete(String(sessionId || ""))
}

function getUssdSession(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim()
  if (!normalizedSessionId) {
    return {
      stateToken: "",
      menuOptions: [],
      processedInputs: 0,
    }
  }
  const existing = ussdSessionStore.get(normalizedSessionId)
  if (existing && typeof existing === "object") {
    return {
      stateToken: String(existing.stateToken || ""),
      menuOptions: Array.isArray(existing.menuOptions) ? existing.menuOptions : [],
      processedInputs: Number(existing.processedInputs || 0) || 0,
      registration: existing.registration && typeof existing.registration === "object" ? existing.registration : null,
      menu: String(existing.menu || "home").trim() || "home",
      browser: existing.browser && typeof existing.browser === "object" ? existing.browser : null,
    }
  }
  return {
    stateToken: typeof existing === "string" ? existing : "",
    menuOptions: [],
    processedInputs: 0,
    registration: null,
    menu: "home",
    browser: null,
  }
}

function setUssdSession(sessionId, data = {}) {
  const normalizedSessionId = String(sessionId || "").trim()
  if (!normalizedSessionId) return
  ussdSessionStore.set(normalizedSessionId, {
    stateToken: String(data.stateToken || ""),
    menuOptions: Array.isArray(data.menuOptions) ? data.menuOptions : [],
    processedInputs: Number(data.processedInputs || 0) || 0,
    registration: data.registration && typeof data.registration === "object" ? data.registration : null,
    menu: String(data.menu || "home").trim() || "home",
    browser: data.browser && typeof data.browser === "object" ? data.browser : null,
  })
}

function buildUssdOptionFromAction(action, fallbackLabel = "") {
  if (!action || typeof action !== "object") return null
  const label = normalizeUssdText(action.label || action.prompt || fallbackLabel || "")
  if (action.kind === "confirm" && action.confirmationToken) {
    return {
      label: label || "Confirm",
      kind: "confirm",
      confirmationToken: String(action.confirmationToken),
    }
  }
  if (action.kind === "prompt" && action.prompt) {
    return {
      label: label || String(action.prompt),
      kind: "prompt",
      prompt: String(action.prompt),
    }
  }
  if (action.kind === "respond" && action.id) {
    return {
      label: label || String(action.id),
      kind: "respond",
      actionId: String(action.id),
      actionPayload: action.payload && typeof action.payload === "object" ? action.payload : {},
    }
  }
  return null
}

function extractUssdMenuOptions(response) {
  const directOptions = [...(response.actions || [])]
    .map((action) => buildUssdOptionFromAction(action))
    .filter(Boolean)

  const cardOptions = (response.cards || []).flatMap((card) => {
    const stationLabel = String(card?.stationName || card?.name || "").trim()
    const fuelSummary = buildUssdFuelStatusSummary(card?.fuelStatuses || [])
    const cardLabel = normalizeUssdText(
      stationLabel
        ? `${stationLabel}${fuelSummary ? ` ${fuelSummary}` : ""}`
        : card?.slotLabel || card?.title || card?.message || "Choose"
    ) || "Choose"
    return (card?.actions || [])
      .map((action) => buildUssdOptionFromAction(action, cardLabel))
      .filter(Boolean)
      .map((option) => ({
        ...option,
        label:
          option.kind === "respond" && option.label && /^choose\b/i.test(option.label) && cardLabel
            ? cardLabel
            : option.label,
      }))
  })

  const combinedOptions = [...directOptions, ...cardOptions].filter((option) => option.actionId !== ASSISTANT_ACTION_IDS.RESET)
  if (combinedOptions.length > 0) return combinedOptions

  return [...(response.suggestions || [])]
    .map((action) => buildUssdOptionFromAction(action))
    .filter((option) => option && option.actionId !== ASSISTANT_ACTION_IDS.RESET)
}

function buildUssdWalletSummaryText(wallet) {
  if (!wallet || typeof wallet !== "object") return ""
  const currencyCode = String(wallet.currencyCode || "MWK").trim() || "MWK"
  return [
    "Wallet",
    `Balance: ${formatUssdMoney(wallet.availableBalance, currencyCode)}`,
    `Active hold: ${formatUssdMoney(wallet.activeHoldAmount, currencyCode)}`,
    `Locked: ${formatUssdMoney(wallet.lockedBalance, currencyCode)}`,
    `Ledger: ${formatUssdMoney(wallet.ledgerBalance, currencyCode)}`,
  ].join("\n")
}

function formatUssdIsoDateTime(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, "0")
  const day = String(parsed.getDate()).padStart(2, "0")
  const hour = String(parsed.getHours()).padStart(2, "0")
  const minute = String(parsed.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function buildUssdActiveBookingText(cards = [], fallbackMessage = "") {
  const bookingCards = (Array.isArray(cards) ? cards : []).filter((card) => card?.kind === "active_booking")
  if (!bookingCards.length) return normalizeUssdText(fallbackMessage)

  const lines = []

  bookingCards.forEach((card, index) => {
    if (index > 0) lines.push("")

    const bookingType = String(card.bookingType || "").trim().toLowerCase()
    const stationName = String(card?.station?.name || card?.stationName || "").trim() || "Station"
    const fuelType = String(card.fuelType || "").trim().toUpperCase()

    if (bookingType === "queue") {
      lines.push("Active queue")
      lines.push(`Station: ${stationName}`)
      if (fuelType) lines.push(`Fuel: ${fuelType}`)
      if (card.position !== null && card.position !== undefined) lines.push(`Position: ${card.position}`)
      if (card.carsAhead !== null && card.carsAhead !== undefined) lines.push(`Cars ahead: ${card.carsAhead}`)
      if (card.etaMinutes !== null && card.etaMinutes !== undefined) lines.push(`ETA: ${card.etaMinutes} min`)
      if (card.requestedLiters !== null && card.requestedLiters !== undefined) lines.push(`Litres: ${card.requestedLiters} L`)
      if (card.queueStatus) lines.push(`Status: ${card.queueStatus}`)
      return
    }

    if (bookingType === "reservation") {
      lines.push("Active reservation")
      lines.push(`Station: ${stationName}`)
      if (fuelType) lines.push(`Fuel: ${fuelType}`)
      if (card.litres !== null && card.litres !== undefined) lines.push(`Litres: ${card.litres} L`)
      if (card.identifier) lines.push(`Ref: ${card.identifier}`)
      const slotStart = formatUssdIsoDateTime(card.slotStart)
      const slotEnd = formatUssdIsoDateTime(card.slotEnd)
      if (slotStart && slotEnd) lines.push(`Slot: ${slotStart} to ${slotEnd}`)
      else if (slotStart) lines.push(`Slot: ${slotStart}`)
      const expiresAt = formatUssdIsoDateTime(card.expiresAt)
      if (expiresAt) lines.push(`Expires: ${expiresAt}`)
      if (card.reservationStatus) lines.push(`Status: ${card.reservationStatus}`)
      return
    }

    lines.push(stationName)
  })

  return lines.filter((line) => line !== "").join("\n").trim() || normalizeUssdText(fallbackMessage)
}

function buildUssdFuelStatusSummary(statuses = []) {
  const shortlist = (Array.isArray(statuses) ? statuses : [])
    .map((status) => {
      const label = String(status?.label || status?.fuelType || "").trim()
      const code = label ? label.slice(0, 1).toUpperCase() : ""
      const normalizedStatus = String(status?.status || "").trim().toLowerCase()
      if (!code) return null
      if (normalizedStatus === "available") return `${code}:Yes`
      if (normalizedStatus === "low") return `${code}:Low`
      if (normalizedStatus === "unavailable") return `${code}:No`
      return `${code}:${normalizeUssdText(normalizedStatus)}`
    })
    .filter(Boolean)
    .slice(0, 2)

  return shortlist.join(" ")
}

function buildReadableFuelSummary(statuses = []) {
  return (Array.isArray(statuses) ? statuses : [])
    .map((status) => {
      const label = String(status?.label || status?.fuelType || "").trim()
      const normalizedStatus = String(status?.status || "").trim().toLowerCase()
      if (!label) return null
      if (normalizedStatus === "available") return `${label}: Yes`
      if (normalizedStatus === "low") return `${label}: Low`
      if (normalizedStatus === "unavailable") return `${label}: No`
      return `${label}: ${normalizeUssdText(normalizedStatus)}`
    })
    .filter(Boolean)
    .join(", ")
}

function buildStationBrowserItems(cards = []) {
  return cards
    .filter((card) => card?.stationPublicId && (card?.stationName || card?.name))
    .map((card) => ({
      stationPublicId: String(card.stationPublicId || "").trim(),
      stationName: String(card.stationName || card.name || "").trim() || "Station",
      fuelStatuses: Array.isArray(card.fuelStatuses) ? card.fuelStatuses : [],
    }))
}

async function buildStationBrowserItemsFromDatabase(currentLocation = null) {
  const stations = await listAssistantStations({ currentLocation })
  const fuelStatusMap = await getFuelStatusesForStations(stations)

  return stations.map((station) => ({
    stationPublicId: station.publicId,
    stationName: station.name,
    fuelStatuses: fuelStatusMap.get(station.publicId) || [],
  }))
}

function buildStationBrowserLabel(item) {
  const summary = buildReadableFuelSummary(item?.fuelStatuses || [])
  return normalizeUssdText(summary ? `${item.stationName} - ${summary}` : item.stationName)
}

function levenshteinDistance(left, right) {
  const a = String(left || "")
  const b = String(right || "")
  if (!a) return b.length
  if (!b) return a.length
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row
  for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      )
    }
  }
  return matrix[a.length][b.length]
}

function scoreStationBrowserMatch(item, query = "") {
  const normalizedQuery = normalizeStationLookupText(query)
  if (!normalizedQuery) return 0
  const stationName = normalizeStationLookupText(item?.stationName)
  const stationCompact = compactStationLookupText(item?.stationName)
  const queryCompact = compactStationLookupText(query)

  let score = scoreStationMatch(normalizedQuery, { name: stationName, address: "", city: "" })
  if (stationName.includes(normalizedQuery)) score += 20
  if (stationCompact.includes(queryCompact)) score += 18

  const queryTokens = tokenizeStationLookupText(query)
  const nameTokens = tokenizeStationLookupText(item?.stationName)
  const matchedTokens = queryTokens.filter((token) => nameTokens.some((nameToken) => nameToken.includes(token) || token.includes(nameToken)))
  score += matchedTokens.length * 6

  if (queryCompact && stationCompact) {
    const distance = levenshteinDistance(queryCompact, stationCompact.slice(0, Math.max(queryCompact.length, 1)))
    score += Math.max(0, 14 - distance * 2)
  }

  return score
}

function filterStationBrowserItems(items = [], query = "") {
  const normalizedQuery = normalizeStationLookupText(query)
  if (!normalizedQuery) return items
  return [...items]
    .map((item) => ({
      item,
      score: scoreStationBrowserMatch(item, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return String(left.item.stationName || "").localeCompare(String(right.item.stationName || ""))
    })
    .map((entry) => entry.item)
}

function buildStationBrowserState(items = [], page = 0, searchQuery = "", awaitingSearch = false) {
  const normalizedItems = Array.isArray(items) ? items : []
  const filteredItems = filterStationBrowserItems(normalizedItems, searchQuery)
  const pageSize = 3
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(Math.max(0, page), totalPages - 1)
  const visibleItems = filteredItems.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const menuOptions = visibleItems.map((item) => ({
    kind: "respond",
    label: buildStationBrowserLabel(item),
    actionId: ASSISTANT_ACTION_IDS.CHOOSE_STATION,
    actionPayload: {
      stationPublicId: item.stationPublicId,
      stationName: item.stationName,
    },
  }))

  if (filteredItems.length > (safePage + 1) * pageSize) {
    menuOptions.push({ kind: "browser_next", label: "Next stations" })
  }
  if (safePage > 0) {
    menuOptions.push({ kind: "browser_prev", label: "Previous stations" })
  }
  menuOptions.push({ kind: "browser_search", label: "Search station" })

  const title = searchQuery ? `Stations for "${searchQuery}"` : "Nearby stations"
  const bodyLines = [title]
  if (!filteredItems.length) {
    bodyLines.push("No station match found.")
    bodyLines.push("1. Search again")
    bodyLines.push("00. Back")
    return {
      text: buildUssdTextResponse("CON", bodyLines.join("\n")),
      menuOptions: [{ kind: "browser_search", label: "Search again" }],
      browser: {
        type: "station_list",
        items: normalizedItems,
        page: 0,
        searchQuery,
        awaitingSearch: false,
      },
    }
  }

  visibleItems.forEach((item, index) => {
    bodyLines.push(`${index + 1}. ${buildStationBrowserLabel(item)}`)
  })

  let optionIndex = visibleItems.length
  if (filteredItems.length > (safePage + 1) * pageSize) {
    optionIndex += 1
    bodyLines.push(`${optionIndex}. Next stations`)
  }
  if (safePage > 0) {
    optionIndex += 1
    bodyLines.push(`${optionIndex}. Previous stations`)
  }
  optionIndex += 1
  bodyLines.push(`${optionIndex}. Search station`)
  bodyLines.push("00. Back")

  return {
    text: buildUssdTextResponse("CON", bodyLines.join("\n")),
    menuOptions,
    browser: {
      type: "station_list",
      items: normalizedItems,
      page: safePage,
      searchQuery,
      awaitingSearch,
    },
  }
}

/**
 * Core handler for USSD interactions.
 * Handles registration and menu navigation.
 */
export async function handleUssdRequest({ sessionId, phoneNumber, text, serviceCode, networkCode }) {
  const normalizedSessionId = String(sessionId || "").trim()
  const normalizedPhoneNumber = normalizeUssdPhoneNumber(phoneNumber)
  const inputs = String(text || "")
    .split("*")
    .map((value) => String(value || "").trim())
    .filter(Boolean)
  const lastInput = inputs[inputs.length - 1] || ""
  let session = getUssdSession(normalizedSessionId)

  let user = await prisma.users.findFirst({
    where: normalizedPhoneNumber
      ? {
          OR: [
            { phone_e164: normalizedPhoneNumber },
            { phone_e164: String(phoneNumber || "").trim() || normalizedPhoneNumber },
          ],
        }
      : undefined,
  })

  if (!user) {
    if (inputs.length === 0) {
      const home = buildUssdMenuState("home")
      setUssdSession(normalizedSessionId, {
        stateToken: "",
        menuOptions: home.menuOptions,
        processedInputs: 0,
        registration: null,
        menu: home.menu,
      })
      return buildUssdTextResponse("CON", "Welcome to SmartLink Malawi.\nNot registered.\nEnter your full name:")
    }

    const registration = session.registration || {}

    if (!registration.fullName) {
      const fullName = String(lastInput || "").trim().slice(0, 120)
      if (!fullName) {
        return buildUssdTextResponse("CON", "Enter your full name:")
      }
      setUssdSession(normalizedSessionId, {
        ...session,
        processedInputs: inputs.length,
        registration: {
          fullName,
        },
      })
      return buildUssdTextResponse("CON", "Set your 4-digit PIN:")
    }

    if (!registration.pin) {
      const pin = normalizeUssdPin(lastInput)
      if (!pin) {
        setUssdSession(normalizedSessionId, {
          ...session,
          processedInputs: inputs.length,
          registration: {
            ...registration,
          },
        })
        return buildUssdTextResponse("CON", "Invalid PIN.\nSet a 4-digit PIN:")
      }
      setUssdSession(normalizedSessionId, {
        ...session,
        processedInputs: inputs.length,
        registration: {
          ...registration,
          pin,
        },
      })
      return buildUssdTextResponse("CON", "Confirm your 4-digit PIN:")
    }

    const confirmedPin = normalizeUssdPin(lastInput)
    if (!confirmedPin) {
      setUssdSession(normalizedSessionId, {
        ...session,
        processedInputs: inputs.length,
        registration: {
          fullName: registration.fullName,
          pin: null,
        },
      })
      return buildUssdTextResponse("CON", "Invalid PIN.\nSet your 4-digit PIN again:")
    }

    if (confirmedPin !== registration.pin) {
      setUssdSession(normalizedSessionId, {
        ...session,
        processedInputs: inputs.length,
        registration: {
          fullName: registration.fullName,
          pin: null,
        },
      })
      return buildUssdTextResponse("CON", "PINs do not match.\nSet your 4-digit PIN again:")
    }

    try {
      const home = buildUssdMenuState("home")
      user = await prisma.users.create({
        data: {
          public_id: await generatePublicUserId(),
          phone_e164: normalizedPhoneNumber,
          full_name: registration.fullName,
          password_hash: await bcrypt.hash(confirmedPin, 10),
        },
      })
      setUssdSession(normalizedSessionId, {
        stateToken: "",
        menuOptions: home.menuOptions,
        processedInputs: inputs.length,
        registration: null,
        menu: home.menu,
      })
      return buildUssdTextResponse("CON", `Account created successfully.\nWelcome ${registration.fullName}.\n${home.text.slice(4)}`)
    } catch (err) {
      clearUssdSession(normalizedSessionId)
      return buildUssdTextResponse("END", "Registration failed. Try again later.")
    }
  }

  if (inputs.length === 0) {
    const home = buildUssdMenuState("home")
    setUssdSession(normalizedSessionId, {
      stateToken: "",
      menuOptions: home.menuOptions,
      processedInputs: 0,
      menu: home.menu,
      browser: null,
    })
    return home.text
  }

  if (lastInput === "0") {
    clearUssdSession(normalizedSessionId)
    return buildUssdTextResponse("END", "Zikomo for using SmartLink.")
  }

  if (lastInput === "00") {
    const home = buildUssdMenuState("home")
    setUssdSession(normalizedSessionId, {
      stateToken: "",
      menuOptions: home.menuOptions,
      processedInputs: inputs.length,
      menu: home.menu,
      browser: null,
    })
    return home.text
  }

  const auth = { userId: user.id, sessionPublicId: normalizedSessionId }
  const nextInputIndex = Math.min(session.processedInputs, Math.max(inputs.length - 1, 0))
  const currentInput = inputs[nextInputIndex] || lastInput
  const selectedOption = /^\d+$/.test(currentInput)
    ? session.menuOptions[Number(currentInput) - 1] || null
    : null

  try {
    if (session.browser?.type === "station_list" && session.browser.awaitingSearch) {
      const allStationItems = await buildStationBrowserItemsFromDatabase()
      const browserState = buildStationBrowserState(
        allStationItems,
        0,
        currentInput,
        false
      )
      setUssdSession(normalizedSessionId, {
        ...session,
        stateToken: session.stateToken,
        menuOptions: browserState.menuOptions,
        processedInputs: inputs.length,
        browser: browserState.browser,
      })
      return browserState.text
    }

    let result

    if (selectedOption?.kind === "confirm" && selectedOption.confirmationToken) {
      result = await confirmAssistantAction({
        auth,
        confirmationToken: selectedOption.confirmationToken,
      })
    } else if (selectedOption?.kind === "browser_next" && session.browser?.type === "station_list") {
      const browserState = buildStationBrowserState(
        session.browser.items || [],
        Number(session.browser.page || 0) + 1,
        session.browser.searchQuery || "",
        false
      )
      setUssdSession(normalizedSessionId, {
        ...session,
        menuOptions: browserState.menuOptions,
        processedInputs: inputs.length,
        browser: browserState.browser,
      })
      return browserState.text
    } else if (selectedOption?.kind === "browser_prev" && session.browser?.type === "station_list") {
      const browserState = buildStationBrowserState(
        session.browser.items || [],
        Number(session.browser.page || 0) - 1,
        session.browser.searchQuery || "",
        false
      )
      setUssdSession(normalizedSessionId, {
        ...session,
        menuOptions: browserState.menuOptions,
        processedInputs: inputs.length,
        browser: browserState.browser,
      })
      return browserState.text
    } else if (selectedOption?.kind === "browser_search" && session.browser?.type === "station_list") {
      setUssdSession(normalizedSessionId, {
        ...session,
        processedInputs: inputs.length,
        browser: {
          ...session.browser,
          awaitingSearch: true,
        },
      })
      return buildUssdTextResponse("CON", "Type station name:")
    } else if (selectedOption?.kind === "menu" && selectedOption.menu) {
      const menuState = buildUssdMenuState(selectedOption.menu)
      setUssdSession(normalizedSessionId, {
        ...session,
        stateToken: "",
        menuOptions: menuState.menuOptions,
        processedInputs: inputs.length,
        menu: menuState.menu,
        browser: null,
      })
      return menuState.text
    } else if (selectedOption?.kind === "prompt" && selectedOption.prompt) {
      result = await respondToAssistant({
        auth,
        message: selectedOption.prompt,
        sessionToken: session.stateToken,
      })
    } else if (selectedOption?.kind === "respond" && selectedOption.actionId) {
      result = await respondToAssistant({
        auth,
        actionId: selectedOption.actionId,
        actionPayload: selectedOption.actionPayload || {},
        sessionToken: session.stateToken,
      })
    } else {
      let assistantMessage = currentInput
      if (!session.stateToken) {
        assistantMessage = resolveUssdDirectPrompt(currentInput, session)
      }
      result = await respondToAssistant({
        auth,
        message: assistantMessage,
        sessionToken: session.stateToken,
      })
    }

    const formatted = formatAssistantResponseForUssd(result.response)
    if (formatted.shouldEnd) {
      clearUssdSession(normalizedSessionId)
    } else {
      setUssdSession(normalizedSessionId, {
        stateToken: result.session?.stateToken || "",
        menuOptions: formatted.menuOptions,
        processedInputs: inputs.length,
        browser: formatted.browser || null,
      })
    }

    return formatted.text
  } catch (error) {
    clearUssdSession(normalizedSessionId)
    return buildUssdTextResponse("END", `Error: ${error.message || "Could not process request."}`)
  }
}

/**
 * Translates Assistant JSON into USSD numbered text.
 */
function formatAssistantResponseForUssd(response) {
  if (response.type === "station_list") {
    const browserState = buildStationBrowserState(buildStationBrowserItems(response.cards || []))
    return {
      text: browserState.text,
      menuOptions: browserState.menuOptions,
      browser: browserState.browser,
      shouldEnd: false,
    }
  }

  let output = `${response.message}\n`
  if (response.type === "wallet_summary") {
    const walletCard = (response.cards || []).find((card) => card?.kind === "wallet_summary")
    const walletText = buildUssdWalletSummaryText(walletCard?.wallet)
    if (walletText) {
      output = `${walletText}\n`
    }
  } else if (response.type === "active_booking") {
    const bookingText = buildUssdActiveBookingText(response.cards || [], response.message || "Booking")
    if (bookingText) {
      output = `${bookingText}\n`
    }
  }
  const menuOptions = extractUssdMenuOptions(response)

  if (menuOptions.length > 0) {
    menuOptions.forEach((option, index) => {
      output += `${index + 1}. ${normalizeUssdText(option.label)}\n`
    })
    output += "00. Back\n"
    return {
      text: buildUssdTextResponse("CON", output.trim()),
      menuOptions,
      browser: null,
      shouldEnd: false,
    }
  }

  if (response.type === "question" || response.type === "station_list" || response.type === "queue_options" || response.type === "reservation_slots") {
    output += "00. Back\n"
    return {
      text: buildUssdTextResponse("CON", output.trim()),
      menuOptions: [],
      browser: null,
      shouldEnd: false,
    }
  }

  return {
    text: buildUssdTextResponse("END", output.trim()),
    menuOptions: [],
    browser: null,
    shouldEnd: true,
  }
}

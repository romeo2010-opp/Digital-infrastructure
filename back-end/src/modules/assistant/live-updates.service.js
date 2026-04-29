import { prisma } from "../../db/prisma.js"
import { createPublicId } from "../common/db.js"
import { createUserAlert } from "../common/userAlerts.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"

export const LIVE_UPDATE_LANGUAGE_OPTIONS = Object.freeze([
  { code: "en", label: "English" },
  { code: "ny", label: "Chichewa" },
])

const ACTIVE_QUEUE_STATUSES = new Set(["WAITING", "CALLED", "LATE"])

function isTableMissingError(error) {
  const message = String(error?.message || "")
  return message.includes("queue_live_update_subscriptions")
}

function toNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeLiveUpdateLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "ny" || normalized === "chichewa") return "ny"
  return "en"
}

export function getLiveUpdateLanguageLabel(code) {
  return LIVE_UPDATE_LANGUAGE_OPTIONS.find((option) => option.code === normalizeLiveUpdateLanguage(code))?.label || "English"
}

export function getPreferredLiveUpdateProviderCode() {
  return String(process.env.LIVE_UPDATE_PROVIDER || (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "mock"))
    .trim()
    .toLowerCase() || "mock"
}

function mapSubscriptionRow(row) {
  if (!row) return null
  return {
    publicId: String(row.public_id || "").trim() || null,
    userId: Number(row.user_id || 0) || null,
    stationId: Number(row.station_id || 0) || null,
    queueJoinId: String(row.queue_join_public_id || row.queue_join_id || "").trim() || null,
    phoneNumber: String(row.phone_number || "").trim() || null,
    languageCode: normalizeLiveUpdateLanguage(row.language_code),
    providerCode: String(row.provider_code || "").trim() || "mock",
    isActive: Boolean(Number(row.is_active ?? 0)),
    notifyOnPositionChange: Boolean(Number(row.notify_on_position_change ?? 1)),
    callWhenPositionReached: toNumberOrNull(row.call_when_position_reached),
    playMusicBetweenUpdates: Boolean(Number(row.play_music_between_updates ?? 1)),
    lastKnownPosition: toNumberOrNull(row.last_known_position),
    lastKnownStatus: String(row.last_known_status || "").trim().toUpperCase() || null,
    lastCalledAt: row.last_called_at ? new Date(row.last_called_at).toISOString() : null,
    lastProviderReference: String(row.last_provider_reference || "").trim() || null,
  }
}

export async function ensureQueueLiveUpdatesTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id
      FROM queue_live_update_subscriptions
      LIMIT 1
    `
  } catch (error) {
    if (isTableMissingError(error)) {
      throw new Error(
        "Live queue update storage is unavailable. Run SQL migration 057_queue_live_update_subscriptions.sql."
      )
    }
    throw error
  }
}

export async function getActiveQueueLiveUpdateSubscription({ userId, queueJoinId = null } = {}) {
  const normalizedUserId = Number(userId || 0)
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  await ensureQueueLiveUpdatesTableReady()
  const rows = await prisma.$queryRaw`
    SELECT
      qlus.public_id,
      qlus.user_id,
      qlus.station_id,
      qlus.phone_number,
      qlus.language_code,
      qlus.provider_code,
      qlus.is_active,
      qlus.notify_on_position_change,
      qlus.call_when_position_reached,
      qlus.play_music_between_updates,
      qlus.last_known_position,
      qlus.last_known_status,
      qlus.last_called_at,
      qlus.last_provider_reference,
      qe.public_id AS queue_join_public_id
    FROM queue_live_update_subscriptions qlus
    INNER JOIN queue_entries qe ON qe.id = qlus.queue_entry_id
    WHERE qlus.user_id = ${normalizedUserId}
      AND qlus.is_active = 1
      AND (${scopedQueueJoinId || null} IS NULL OR qe.public_id = ${scopedQueueJoinId || null})
    ORDER BY qlus.updated_at DESC, qlus.id DESC
    LIMIT 1
  `

  return mapSubscriptionRow(rows?.[0] || null)
}

export async function getQueueLiveUpdateSubscriptionByPublicId(subscriptionPublicId) {
  const scopedSubscriptionPublicId = String(subscriptionPublicId || "").trim()
  if (!scopedSubscriptionPublicId) return null

  await ensureQueueLiveUpdatesTableReady()
  const rows = await prisma.$queryRaw`
    SELECT
      qlus.public_id,
      qlus.user_id,
      qlus.station_id,
      qlus.phone_number,
      qlus.language_code,
      qlus.provider_code,
      qlus.is_active,
      qlus.notify_on_position_change,
      qlus.call_when_position_reached,
      qlus.play_music_between_updates,
      qlus.last_known_position,
      qlus.last_known_status,
      qlus.last_called_at,
      qlus.last_provider_reference,
      qe.public_id AS queue_join_public_id
    FROM queue_live_update_subscriptions qlus
    INNER JOIN queue_entries qe ON qe.id = qlus.queue_entry_id
    WHERE qlus.public_id = ${scopedSubscriptionPublicId}
    LIMIT 1
  `
  return mapSubscriptionRow(rows?.[0] || null)
}

export async function upsertQueueLiveUpdateSubscription({
  userId,
  queueJoinId,
  phoneNumber,
  languageCode = "en",
  providerCode = getPreferredLiveUpdateProviderCode(),
  notifyOnPositionChange = true,
  callWhenPositionReached = 4,
  playMusicBetweenUpdates = true,
} = {}) {
  const normalizedUserId = Number(userId || 0)
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  const scopedPhoneNumber = String(phoneNumber || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("Live queue updates require a valid user.")
  }
  if (!scopedQueueJoinId) {
    throw new Error("Live queue updates require an active queue booking.")
  }
  if (!scopedPhoneNumber) {
    throw new Error("Live queue updates require a phone number.")
  }

  await ensureQueueLiveUpdatesTableReady()
  const queueRows = await prisma.$queryRaw`
    SELECT qe.id, qe.station_id, qe.public_id
    FROM queue_entries qe
    WHERE qe.public_id = ${scopedQueueJoinId}
      AND qe.user_id = ${normalizedUserId}
      AND qe.status IN ('WAITING', 'CALLED', 'LATE')
    LIMIT 1
  `

  const queueRow = queueRows?.[0] || null
  if (!queueRow?.id) {
    throw new Error("Active queue booking not found for live updates.")
  }

  const normalizedLanguageCode = normalizeLiveUpdateLanguage(languageCode)
  const normalizedProviderCode = String(providerCode || "mock").trim().toLowerCase() || "mock"
  const existingRows = await prisma.$queryRaw`
    SELECT id, public_id
    FROM queue_live_update_subscriptions
    WHERE queue_entry_id = ${queueRow.id}
    LIMIT 1
    FOR UPDATE
  `
  const existing = existingRows?.[0] || null

  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE queue_live_update_subscriptions
      SET
        user_id = ${normalizedUserId},
        station_id = ${queueRow.station_id},
        phone_number = ${scopedPhoneNumber},
        language_code = ${normalizedLanguageCode},
        provider_code = ${normalizedProviderCode},
        is_active = 1,
        notify_on_position_change = ${notifyOnPositionChange ? 1 : 0},
        call_when_position_reached = ${callWhenPositionReached || 4},
        play_music_between_updates = ${playMusicBetweenUpdates ? 1 : 0},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO queue_live_update_subscriptions (
        public_id,
        user_id,
        station_id,
        queue_entry_id,
        phone_number,
        language_code,
        provider_code,
        is_active,
        notify_on_position_change,
        call_when_position_reached,
        play_music_between_updates
      )
      VALUES (
        ${createPublicId()},
        ${normalizedUserId},
        ${queueRow.station_id},
        ${queueRow.id},
        ${scopedPhoneNumber},
        ${normalizedLanguageCode},
        ${normalizedProviderCode},
        1,
        ${notifyOnPositionChange ? 1 : 0},
        ${callWhenPositionReached || 4},
        ${playMusicBetweenUpdates ? 1 : 0}
      )
    `
  }

  return getActiveQueueLiveUpdateSubscription({
    userId: normalizedUserId,
    queueJoinId: scopedQueueJoinId,
  })
}

export async function deactivateQueueLiveUpdateSubscription({ userId, queueJoinId } = {}) {
  const normalizedUserId = Number(userId || 0)
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !scopedQueueJoinId) return false

  await ensureQueueLiveUpdatesTableReady()
  await prisma.$executeRaw`
    UPDATE queue_live_update_subscriptions qlus
    INNER JOIN queue_entries qe ON qe.id = qlus.queue_entry_id
    SET
      qlus.is_active = 0,
      qlus.updated_at = CURRENT_TIMESTAMP(3)
    WHERE qlus.user_id = ${normalizedUserId}
      AND qe.public_id = ${scopedQueueJoinId}
      AND qlus.is_active = 1
  `

  return true
}

export async function updateQueueLiveUpdateSubscriptionLanguage({
  subscriptionPublicId,
  languageCode,
} = {}) {
  const scopedSubscriptionPublicId = String(subscriptionPublicId || "").trim()
  if (!scopedSubscriptionPublicId) return null

  await ensureQueueLiveUpdatesTableReady()
  await prisma.$executeRaw`
    UPDATE queue_live_update_subscriptions
    SET
      language_code = ${normalizeLiveUpdateLanguage(languageCode)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${scopedSubscriptionPublicId}
  `

  return getQueueLiveUpdateSubscriptionByPublicId(scopedSubscriptionPublicId)
}

export async function listActiveQueueLiveUpdateSubscriptions() {
  await ensureQueueLiveUpdatesTableReady()
  const rows = await prisma.$queryRaw`
    SELECT
      qlus.public_id,
      qlus.user_id,
      qlus.station_id,
      qlus.phone_number,
      qlus.language_code,
      qlus.provider_code,
      qlus.is_active,
      qlus.notify_on_position_change,
      qlus.call_when_position_reached,
      qlus.play_music_between_updates,
      qlus.last_known_position,
      qlus.last_known_status,
      qlus.last_called_at,
      qlus.last_provider_reference,
      qe.public_id AS queue_join_public_id
    FROM queue_live_update_subscriptions qlus
    INNER JOIN queue_entries qe ON qe.id = qlus.queue_entry_id
    WHERE qlus.is_active = 1
      AND qe.status IN ('WAITING', 'CALLED', 'LATE')
    ORDER BY qlus.updated_at ASC, qlus.id ASC
  `

  return (rows || []).map((row) => mapSubscriptionRow(row)).filter(Boolean)
}

export function buildVoiceUpdateScript({ snapshot, previousPosition = null, languageCode = "en" } = {}) {
  const normalizedLanguageCode = normalizeLiveUpdateLanguage(languageCode)
  const position = toNumberOrNull(snapshot?.position)
  const status = String(snapshot?.queueStatus || "").trim().toUpperCase() || "WAITING"
  const stationName = String(snapshot?.station?.name || "your station").trim() || "your station"
  const fuelType = String(snapshot?.fuelType || "").trim().toUpperCase() || null
  const etaMinutes = toNumberOrNull(snapshot?.etaMinutes)
  const targetReached = position !== null && position <= 4
  const positionChanged = position !== null && position !== previousPosition

  if (normalizedLanguageCode === "ny") {
    const lines = ["SmartLink ikukupatsani uthenga wa queue."]
    if (position !== null) lines.push(`Muli pa nambala ${position} pa mzere.`)
    if (fuelType) lines.push(`Mafuta: ${fuelType}.`)
    if (etaMinutes !== null) lines.push(`Nthawi yodikira pafupi ndi mphindi ${etaMinutes}.`)
    if (status === "CALLED") {
      lines.push(`Ndi nthawi yanu tsopano pa ${stationName}.`)
    } else if (targetReached) {
      lines.push(`Chonde yambirani kupita ku ${stationName}. Mukuyandikira kwambiri.`)
    } else if (positionChanged) {
      lines.push("Malo anu asintha. Mverani nyimbo mukudikira uthenga wotsatira.")
    }
    return {
      previewText: lines.join(" "),
      shouldPlayMusic: positionChanged && status !== "CALLED",
      shouldCallToStation: targetReached || status === "CALLED",
    }
  }

  const lines = ["SmartLink live queue update."]
  if (position !== null) lines.push(`You are now at position ${position} in the queue.`)
  if (fuelType) lines.push(`Fuel type ${fuelType}.`)
  if (etaMinutes !== null) lines.push(`Estimated wait ${etaMinutes} minutes.`)
  if (status === "CALLED") {
    lines.push(`It is now your turn at ${stationName}.`)
  } else if (targetReached) {
    lines.push(`Please start heading to ${stationName}. You are close to the front.`)
  } else if (positionChanged) {
    lines.push("Your position has changed. Music should continue while you wait for the next update.")
  }

  return {
    previewText: lines.join(" "),
    shouldPlayMusic: positionChanged && status !== "CALLED",
    shouldCallToStation: targetReached || status === "CALLED",
  }
}

export async function dispatchQueueLiveUpdate({
  subscription,
  snapshot,
  providerCode = null,
} = {}) {
  const scopedProviderCode = String(providerCode || subscription?.providerCode || "mock").trim().toLowerCase() || "mock"
  const script = buildVoiceUpdateScript({
    snapshot,
    previousPosition: subscription?.lastKnownPosition ?? null,
    languageCode: subscription?.languageCode || "en",
  })

  if (scopedProviderCode === "twilio") {
    const { placeTwilioLiveUpdateCall } = await import("./twilio-voice.service.js")
    return placeTwilioLiveUpdateCall({
      subscription,
      snapshot,
    })
  }

  if (scopedProviderCode !== "mock") {
    throw new Error(`Live queue update provider "${scopedProviderCode}" is not configured.`)
  }

  const alert = await createUserAlert({
    userId: subscription.userId,
    stationId: subscription.stationId,
    category: "QUEUE",
    title: "Live queue call",
    body: script.previewText,
    metadata: {
      kind: "queue_live_update_call",
      queueJoinId: subscription.queueJoinId,
      languageCode: subscription.languageCode,
      phoneNumber: subscription.phoneNumber,
      providerCode: scopedProviderCode,
      playMusic: script.shouldPlayMusic,
      callToStation: script.shouldCallToStation,
      snapshot: {
        queueStatus: snapshot?.queueStatus || null,
        position: snapshot?.position ?? null,
        etaMinutes: snapshot?.etaMinutes ?? null,
      },
    },
  })

  publishUserAlert({
    userId: subscription.userId,
    eventType: "user_alert:new",
    data: alert,
  })

  return {
    providerReference: `mock:${Date.now()}`,
    previewText: script.previewText,
    shouldPlayMusic: script.shouldPlayMusic,
    shouldCallToStation: script.shouldCallToStation,
  }
}

export async function recordQueueLiveUpdateDispatch({
  subscriptionPublicId,
  snapshot,
  providerReference = null,
} = {}) {
  const scopedSubscriptionPublicId = String(subscriptionPublicId || "").trim()
  if (!scopedSubscriptionPublicId) return
  const normalizedPosition = toNumberOrNull(snapshot?.position)
  const normalizedStatus = String(snapshot?.queueStatus || "").trim().toUpperCase() || null

  await prisma.$executeRaw`
    UPDATE queue_live_update_subscriptions
    SET
      last_known_position = ${normalizedPosition},
      last_known_status = ${normalizedStatus},
      last_called_at = CURRENT_TIMESTAMP(3),
      last_provider_reference = ${providerReference || null},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${scopedSubscriptionPublicId}
  `
}

export async function deactivateSubscriptionByPublicId(subscriptionPublicId) {
  const scopedSubscriptionPublicId = String(subscriptionPublicId || "").trim()
  if (!scopedSubscriptionPublicId) return
  await prisma.$executeRaw`
    UPDATE queue_live_update_subscriptions
    SET
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${scopedSubscriptionPublicId}
  `
}

export async function recordQueueLiveUpdateProviderReference({
  subscriptionPublicId,
  providerReference,
} = {}) {
  const scopedSubscriptionPublicId = String(subscriptionPublicId || "").trim()
  if (!scopedSubscriptionPublicId) return
  await prisma.$executeRaw`
    UPDATE queue_live_update_subscriptions
    SET
      last_provider_reference = ${providerReference || null},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${scopedSubscriptionPublicId}
  `
}

export function shouldDispatchQueueLiveUpdate(subscription, snapshot) {
  const status = String(snapshot?.queueStatus || "").trim().toUpperCase()
  if (!ACTIVE_QUEUE_STATUSES.has(status)) return false

  const position = toNumberOrNull(snapshot?.position)
  const previousPosition = toNumberOrNull(subscription?.lastKnownPosition)
  const previousStatus = String(subscription?.lastKnownStatus || "").trim().toUpperCase() || null
  const targetPosition = toNumberOrNull(subscription?.callWhenPositionReached) || 4

  if (previousStatus !== status) return true
  if (!subscription?.notifyOnPositionChange) return false
  if (position === null) return false
  if (previousPosition === null) return true
  if (position !== previousPosition) return true
  if (position <= targetPosition && previousPosition > targetPosition) return true
  return false
}

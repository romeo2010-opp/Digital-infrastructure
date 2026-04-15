import { prisma } from "../../db/prisma.js"
import { createPublicId } from "./db.js"

function parseJsonSafe(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function isUserPushSubscriptionsTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("user_push_subscriptions")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table")
  )
}

export async function ensureUserPushSubscriptionsTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, user_id, endpoint, p256dh, auth, status
      FROM user_push_subscriptions
      LIMIT 1
    `
  } catch (error) {
    if (isUserPushSubscriptionsTableMissingError(error)) {
      const wrapped = new Error(
        "Push subscription storage is unavailable. Run SQL migration 019_create_user_push_subscriptions.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

export async function upsertUserPushSubscription({
  userId,
  endpoint,
  p256dh,
  auth,
  userAgent = null,
  metadata = {},
}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("userId is required for push subscription")
  }

  const scopedEndpoint = String(endpoint || "").trim()
  const scopedP256dh = String(p256dh || "").trim()
  const scopedAuth = String(auth || "").trim()
  if (!scopedEndpoint || !scopedP256dh || !scopedAuth) {
    throw new Error("Push subscription must include endpoint, p256dh, and auth")
  }

  const metadataPayload = JSON.stringify(metadata || {})
  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO user_push_subscriptions (
      public_id,
      user_id,
      endpoint,
      p256dh,
      auth,
      status,
      user_agent,
      metadata,
      last_seen_at
    )
    VALUES (
      ${publicId},
      ${normalizedUserId},
      ${scopedEndpoint},
      ${scopedP256dh},
      ${scopedAuth},
      'ACTIVE',
      ${String(userAgent || "").trim() || null},
      ${metadataPayload},
      CURRENT_TIMESTAMP(3)
    )
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      status = 'ACTIVE',
      user_agent = VALUES(user_agent),
      metadata = VALUES(metadata),
      last_seen_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  return {
    endpoint: scopedEndpoint,
    status: "ACTIVE",
  }
}

function mapPushSubscriptionRow(row) {
  return {
    publicId: String(row?.public_id || "").trim(),
    userId: Number(row?.user_id || 0),
    endpoint: String(row?.endpoint || "").trim(),
    keys: {
      p256dh: String(row?.p256dh || "").trim(),
      auth: String(row?.auth || "").trim(),
    },
    status: String(row?.status || "").trim().toUpperCase() || "INACTIVE",
    userAgent: String(row?.user_agent || "").trim() || null,
    metadata: parseJsonSafe(row?.metadata),
  }
}

export async function listActivePushSubscriptionsByUserId(userId) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return []

  const rows = await prisma.$queryRaw`
    SELECT
      public_id,
      user_id,
      endpoint,
      p256dh,
      auth,
      status,
      user_agent,
      metadata
    FROM user_push_subscriptions
    WHERE user_id = ${normalizedUserId}
      AND status = 'ACTIVE'
    ORDER BY updated_at DESC, id DESC
  `

  return (rows || []).map(mapPushSubscriptionRow)
}

export async function deactivatePushSubscriptionByEndpoint(endpoint) {
  const scopedEndpoint = String(endpoint || "").trim()
  if (!scopedEndpoint) return
  await prisma.$executeRaw`
    UPDATE user_push_subscriptions
    SET
      status = 'INACTIVE',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE endpoint = ${scopedEndpoint}
  `
}

export async function deactivatePushSubscriptionsByUserId(userId) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return
  await prisma.$executeRaw`
    UPDATE user_push_subscriptions
    SET
      status = 'INACTIVE',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${normalizedUserId}
  `
}

export async function deactivatePushSubscriptionForUser({ userId, endpoint }) {
  const normalizedUserId = Number(userId || 0)
  const scopedEndpoint = String(endpoint || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !scopedEndpoint) return
  await prisma.$executeRaw`
    UPDATE user_push_subscriptions
    SET
      status = 'INACTIVE',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${normalizedUserId}
      AND endpoint = ${scopedEndpoint}
  `
}

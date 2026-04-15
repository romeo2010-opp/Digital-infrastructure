import { prisma } from "../../db/prisma.js"
import { createPublicId } from "../common/db.js"

function isAssistantAuditTableMissing(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("assistant_action_logs")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table")
  )
}

export async function ensureAssistantAuditTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, public_id, user_id, action_type, outcome_status
      FROM assistant_action_logs
      LIMIT 1
    `
  } catch (error) {
    if (isAssistantAuditTableMissing(error)) {
      const wrapped = new Error(
        "Assistant audit storage is unavailable. Run SQL migration 053_assistant_action_logs.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

export async function createAssistantAuditLog({
  userId,
  sessionPublicId = null,
  actionType,
  intent = null,
  requestText = null,
  structuredPayload = null,
  outcomeStatus = "REQUESTED",
  errorMessage = null,
  source = "assistant",
} = {}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  await ensureAssistantAuditTableReady()

  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO assistant_action_logs (
      public_id,
      user_id,
      session_public_id,
      source,
      action_type,
      intent,
      request_text,
      structured_payload,
      outcome_status,
      error_message
    )
    VALUES (
      ${publicId},
      ${normalizedUserId},
      ${sessionPublicId || null},
      ${String(source || "assistant").trim() || "assistant"},
      ${String(actionType || "").trim() || "assistant.unknown"},
      ${intent || null},
      ${requestText || null},
      ${structuredPayload ? JSON.stringify(structuredPayload) : null},
      ${String(outcomeStatus || "REQUESTED").trim().toUpperCase() || "REQUESTED"},
      ${errorMessage || null}
    )
  `

  return publicId
}

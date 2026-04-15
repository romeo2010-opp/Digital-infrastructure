import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"

function normalizeDateTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function isSupportTicketMessagesTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("support_ticket_messages")) return false
  return (
    message.includes("doesn't exist")
    || message.includes("does not exist")
    || message.includes("unknown table")
  )
}

async function getSupportTicketRow(ticketId, db = prisma) {
  const scopedTicketId = String(ticketId || "").trim()
  if (!scopedTicketId) throw badRequest("support ticket id is required")

  const rows = await db.$queryRaw`
    SELECT
      st.id,
      st.station_id,
      st.user_id,
      st.title,
      st.description,
      st.status,
      st.created_at,
      st.updated_at,
      isc.public_id AS support_case_public_id,
      isc.status AS support_case_status
    FROM support_tickets st
    LEFT JOIN internal_support_cases isc ON isc.source_ticket_id = st.id
    WHERE st.id = ${scopedTicketId}
    LIMIT 1
  `

  const ticket = rows?.[0]
  if (!ticket?.id) throw notFound("Support ticket not found")
  return ticket
}

export async function resolveSupportTicketThread(ticketId, db = prisma) {
  return getSupportTicketRow(ticketId, db)
}

export function isSupportConversationOpen(ticket) {
  const caseStatus = String(ticket?.support_case_status || "").trim().toUpperCase()
  const ticketStatus = String(ticket?.status || "").trim().toUpperCase()
  if (caseStatus) return caseStatus !== "RESOLVED"
  return ticketStatus !== "RESPONDED"
}

export async function listSupportTicketMessages(ticketId, db = prisma) {
  const ticket = await getSupportTicketRow(ticketId, db)
  let rows = []

  try {
    rows = await db.$queryRaw`
      SELECT
        public_id,
        sender_scope,
        sender_user_public_id,
        sender_role_code,
        sender_name,
        body,
        created_at,
        updated_at
      FROM support_ticket_messages
      WHERE support_ticket_id = ${ticket.id}
      ORDER BY created_at ASC, id ASC
    `
  } catch (error) {
    if (!isSupportTicketMessagesTableMissingError(error)) throw error
    rows = []
  }

  const initialMessage = {
    publicId: `${ticket.id}:initial`,
    senderScope: "STATION",
    senderUserPublicId: ticket.user_id || null,
    senderRoleCode: "STATION",
    senderName: "Station team",
    title: ticket.title,
    body: ticket.description,
    createdAt: normalizeDateTime(ticket.created_at),
    updatedAt: normalizeDateTime(ticket.updated_at),
    initial: true,
  }

  const messages = (rows || []).map((row) => ({
    publicId: row.public_id,
    senderScope: String(row.sender_scope || "").trim().toUpperCase() || "STATION",
    senderUserPublicId: String(row.sender_user_public_id || "").trim() || null,
    senderRoleCode: String(row.sender_role_code || "").trim().toUpperCase() || null,
    senderName: String(row.sender_name || "").trim() || null,
    title: null,
    body: String(row.body || "").trim(),
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
    initial: false,
  }))

  return {
    ticket: {
      id: ticket.id,
      stationPublicId: ticket.station_id,
      userPublicId: ticket.user_id,
      title: ticket.title,
      status: ticket.status,
      supportCasePublicId: ticket.support_case_public_id || null,
      supportCaseStatus: ticket.support_case_status || null,
      createdAt: normalizeDateTime(ticket.created_at),
      updatedAt: normalizeDateTime(ticket.updated_at),
      isOpen: isSupportConversationOpen(ticket),
    },
    messages: [initialMessage, ...messages],
  }
}

export async function appendSupportTicketMessage(
  {
    ticketId,
    senderScope,
    senderUserPublicId = null,
    senderRoleCode = null,
    senderName = null,
    body,
    stationPublicId = null,
    supportCasePublicId = null,
    updateTicketStatus = null,
  },
  { db = prisma } = {}
) {
  const ticket = await getSupportTicketRow(ticketId, db)
  const normalizedBody = String(body || "").trim()
  if (!normalizedBody) throw badRequest("Support message body is required")

  const normalizedScope = String(senderScope || "").trim().toUpperCase()
  if (!["STATION", "SUPPORT"].includes(normalizedScope)) {
    throw badRequest("Unsupported support message sender scope")
  }

  const messagePublicId = createPublicId()
  await db.$executeRaw`
    INSERT INTO support_ticket_messages (
      public_id,
      support_ticket_id,
      station_public_id,
      support_case_public_id,
      sender_scope,
      sender_user_public_id,
      sender_role_code,
      sender_name,
      body
    )
    VALUES (
      ${messagePublicId},
      ${ticket.id},
      ${stationPublicId || ticket.station_id},
      ${supportCasePublicId || ticket.support_case_public_id || null},
      ${normalizedScope},
      ${String(senderUserPublicId || "").trim() || null},
      ${String(senderRoleCode || "").trim() || null},
      ${String(senderName || "").trim() || (normalizedScope === "SUPPORT" ? "Support" : "Station team")},
      ${normalizedBody}
    )
  `

  await db.$executeRaw`
    UPDATE support_tickets
    SET
      status = ${updateTicketStatus || ticket.status},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${ticket.id}
  `

  if (ticket.support_case_public_id) {
    await db.$executeRaw`
      UPDATE internal_support_cases
      SET updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${ticket.support_case_public_id}
    `
  }

  return {
    publicId: messagePublicId,
    ticketId: ticket.id,
  }
}

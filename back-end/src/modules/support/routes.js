import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../db/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { createPublicId, createSupportCasePublicId, resolveStationOrThrow, writeAuditLog } from "../common/db.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { requireRole } from "../../middleware/requireAuth.js"
import {
  appendSupportTicketMessage,
  isSupportConversationOpen,
  listSupportTicketMessages,
  resolveSupportTicketThread,
  isSupportTicketMessagesTableMissingError,
} from "./messages.service.js"

const router = Router()

const createTicketSchema = z.object({
  category: z.enum(["Pump", "Tank", "Queue", "Reservation", "Reports", "Staff", "Network", "Other"]),
  severity: z.enum(["Low", "Medium", "Critical"]),
  title: z.string().min(3).max(160),
  description: z.string().min(5).max(4000),
  screenshotUrl: z.string().url().max(1000).optional(),
  context: z
    .object({
      stationId: z.string().optional(),
      userId: z.string().optional(),
      userAgent: z.string().optional(),
      appBuild: z.string().optional(),
      lastSyncAt: z.string().nullable().optional(),
    })
    .optional(),
})

const supportTicketMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
})

function getSupportConfig() {
  const readValue = (value) => {
    const text = String(value ?? "").trim()
    return text.length ? text : null
  }

  const config = {}
  const phone = readValue(process.env.SUPPORT_PHONE)
  const whatsapp = readValue(process.env.SUPPORT_WHATSAPP)
  const email = readValue(process.env.SUPPORT_EMAIL)
  const hours = readValue(process.env.SUPPORT_HOURS)

  if (phone) config.phone = phone
  if (whatsapp) config.whatsapp = whatsapp
  if (email) config.email = email
  if (hours) config.hours = hours

  return config
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function formatOwnerRoleCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  if (!normalized) return null
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ")
}

function isDashboardAlertsTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("dashboard_alerts")) return false
  return (
    message.includes("doesn't exist")
    || message.includes("does not exist")
    || message.includes("unknown table")
  )
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || "").toLowerCase()
  const scopedTableName = String(tableName || "").trim().toLowerCase()
  if (!scopedTableName || !message.includes(scopedTableName)) return false
  return (
    message.includes("doesn't exist")
    || message.includes("does not exist")
    || message.includes("unknown table")
    || message.includes("unknown column")
  )
}

function mapTicketSeverityToPriority(severity) {
  switch (String(severity || "").trim().toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL"
    case "MEDIUM":
      return "MEDIUM"
    case "LOW":
    default:
      return "LOW"
  }
}

function mapTicketCategoryToInternalCategory(category) {
  switch (String(category || "").trim().toUpperCase()) {
    case "QUEUE":
    case "RESERVATION":
      return "QUEUE_DISPUTE"
    case "NETWORK":
    case "PUMP":
    case "TANK":
      return "TECHNICAL"
    case "STAFF":
      return "STATION_COMPLAINT"
    case "REPORTS":
      return "REPORTING"
    case "OTHER":
    default:
      return "GENERAL"
  }
}

function mapTicketToSupportCaseTypeCode({ roleCode, category }) {
  const normalizedRoleCode = String(roleCode || "").trim().toUpperCase()
  const normalizedCategory = String(category || "").trim().toUpperCase()

  switch (normalizedCategory) {
    case "RESERVATION":
      return "RSV"
    case "PAYMENT":
    case "WALLET":
    case "BILLING":
      return "PAY"
    case "ACCOUNT":
    case "ACCESS":
    case "LOGIN":
    case "AUTH":
      return "ACC"
    case "FRAUD":
      return "FRD"
    case "PUMP":
    case "TANK":
    case "NETWORK":
      return normalizedRoleCode === "MANAGER" || normalizedRoleCode === "ATTENDANT" ? "HRD" : "OPS"
    default:
      return normalizedRoleCode === "MANAGER" || normalizedRoleCode === "ATTENDANT" ? "STN" : "DRV"
  }
}

async function resolveInternalSupportAgentUserId() {
  const rows = await prisma.$queryRaw`
    SELECT u.id
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
    INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
    WHERE u.is_active = 1
      AND ir.code = 'CUSTOMER_SUPPORT_AGENT'
    ORDER BY ir.rank_order ASC, u.id ASC
    LIMIT 1
  `

  return rows?.[0]?.id ? Number(rows[0].id) : null
}

async function resolveUserDisplayName(userPublicId) {
  const scopedUserPublicId = String(userPublicId || "").trim()
  if (!scopedUserPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT full_name
    FROM users
    WHERE public_id = ${scopedUserPublicId}
    LIMIT 1
  `
  return String(rows?.[0]?.full_name || "").trim() || null
}

async function resolveAccessibleSupportTicket({ auth, ticketId }) {
  const roleCode = String(auth?.role || "").toUpperCase()
  const stationPublicId = String(auth?.stationPublicId || "").trim()
  const userPublicId = String(auth?.userPublicId || "").trim()
  const ticket = await resolveSupportTicketThread(ticketId)

  if (roleCode === "USER") {
    if (!userPublicId || ticket.user_id !== userPublicId) {
      throw badRequest("Support ticket not found")
    }
    return ticket
  }

  if (!stationPublicId || ticket.station_id !== stationPublicId) {
    throw badRequest("Support ticket not found")
  }

  if (roleCode !== "MANAGER" && ticket.user_id !== userPublicId) {
    throw badRequest("Support ticket not found")
  }

  return ticket
}

async function notifySupportUser({
  userId,
  stationId = null,
  title,
  body,
  metadata = {},
  path = "/m/help",
}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return null
  }

  const alert = await createUserAlert({
    userId: normalizedUserId,
    stationId,
    category: "SYSTEM",
    title,
    body,
    metadata: {
      ...(metadata || {}),
      path,
      route: path,
    },
  })

  publishUserAlert({
    userId: normalizedUserId,
    eventType: "user_alert:new",
    data: alert,
  })

  await sendPushAlertToUser({
    userId: normalizedUserId,
    notification: {
      title: alert.title,
      body: alert.message,
      tag: alert.publicId || `support-${Date.now()}`,
      url: path,
      icon: "/smartlogo.png",
      badge: "/smartlogo.png",
    },
    data: {
      alertPublicId: alert.publicId || null,
      path,
      ...(metadata || {}),
    },
  }).catch(() => {
    // Push is best-effort.
  })

  return alert
}

router.get(
  "/support/config",
  asyncHandler(async (_req, res) => {
    return ok(res, getSupportConfig())
  })
)

router.get(
  "/support/inbox",
  requireRole(["MANAGER", "ATTENDANT", "VIEWER"]),
  asyncHandler(async (req, res) => {
    const stationPublicId = String(req.auth?.stationPublicId || "").trim()
    if (!stationPublicId) throw badRequest("Missing station scope for inbox")

    const station = await resolveStationOrThrow(stationPublicId)
    let rows = []

    try {
      rows = await prisma.$queryRaw`
        SELECT
          da.public_id,
          da.category,
          da.severity,
          da.status,
          da.owner_role_code,
          da.title,
          da.summary,
          da.metadata,
          da.created_at,
          da.updated_at,
          sender.full_name AS sender_name
        FROM dashboard_alerts da
        LEFT JOIN users sender ON sender.id = da.user_id
        WHERE da.station_id = ${station.id}
        ORDER BY
          CASE
            WHEN da.status = 'OPEN' THEN 0
            WHEN da.status = 'ACKNOWLEDGED' THEN 1
            ELSE 2
          END ASC,
          FIELD(da.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW') ASC,
          da.created_at DESC
        LIMIT 50
      `
    } catch (error) {
      if (!isDashboardAlertsTableMissingError(error)) throw error
      rows = []
    }

    return ok(res, {
      stationPublicId,
      messages: (rows || []).map((row) => {
        const metadata = parseJsonObject(row.metadata)
        const note = String(metadata.note || metadata.responseMessage || "").trim() || null
        return {
          id: row.public_id,
          category: String(row.category || "").trim().toUpperCase() || "SYSTEM",
          severity: String(row.severity || "").trim().toUpperCase() || "MEDIUM",
          status: String(row.status || "").trim().toUpperCase() || "OPEN",
          title: String(row.title || "").trim() || "Admin update",
          body: note || String(row.summary || "").trim() || "No message content available.",
          summary: String(row.summary || "").trim() || null,
          senderName: String(row.sender_name || "").trim() || null,
          senderRole: formatOwnerRoleCode(row.owner_role_code) || "Platform Admin",
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        }
      }),
    })
  })
)

router.get(
  "/support/tickets",
  requireRole(["USER", "MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const userPublicId = req.auth?.userPublicId
    const roleCode = String(req.auth?.role || "").toUpperCase()

    if (!userPublicId) throw badRequest("Missing authenticated user for support tickets")
    let rows = []

    if (roleCode === "USER") {
      rows = await prisma.$queryRaw`
        SELECT
          st.id,
          st.station_id,
          st.category,
          st.severity,
          st.status,
          st.title,
          st.description,
          st.screenshot_url,
          st.created_at,
          st.updated_at,
          isc.public_id AS case_public_id,
          isc.priority AS case_priority,
          isc.status AS case_status,
          isc.resolution_notes,
          isc.resolved_at,
          responder.full_name AS responder_name,
          station.name AS station_name
        FROM support_tickets st
        LEFT JOIN internal_support_cases isc ON isc.source_ticket_id = st.id
        LEFT JOIN users responder ON responder.id = isc.assigned_user_id
        LEFT JOIN stations station ON station.public_id = st.station_id
        WHERE st.user_id = ${userPublicId}
        ORDER BY st.created_at DESC
        LIMIT 50
      `
    } else {
      const stationPublicId = req.auth?.stationPublicId
      if (!stationPublicId) throw badRequest("Missing station scope for support tickets")

      rows = await prisma.$queryRaw`
        SELECT
          st.id,
          st.station_id,
          st.category,
          st.severity,
          st.status,
          st.title,
          st.description,
          st.screenshot_url,
          st.created_at,
          st.updated_at,
          isc.public_id AS case_public_id,
          isc.priority AS case_priority,
          isc.status AS case_status,
          isc.resolution_notes,
          isc.resolved_at,
          responder.full_name AS responder_name,
          station.name AS station_name
        FROM support_tickets st
        LEFT JOIN internal_support_cases isc ON isc.source_ticket_id = st.id
        LEFT JOIN users responder ON responder.id = isc.assigned_user_id
        LEFT JOIN stations station ON station.public_id = st.station_id
        WHERE st.station_id = ${stationPublicId}
          AND (${roleCode} = 'MANAGER' OR st.user_id = ${userPublicId})
        ORDER BY st.created_at DESC
        LIMIT 50
      `
    }

    return ok(
      res,
      (rows || []).map((row) => ({
        id: row.id,
        category: row.category,
        severity: row.severity,
        status: row.status,
        title: row.title,
        description: row.description,
        screenshotUrl: row.screenshot_url || null,
        stationPublicId: row.station_id || null,
        stationName: row.station_name || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        casePublicId: row.case_public_id || null,
        casePriority: row.case_priority || null,
        caseStatus: row.case_status || null,
        responseMessage: row.resolution_notes || null,
        respondedAt: row.resolved_at || null,
        responderName: row.responder_name || null,
      }))
    )
  })
)

router.get(
  "/support/refunds",
  requireRole(["USER"]),
  asyncHandler(async (req, res) => {
    const authUserId = Number(req.auth?.userId || 0)
    if (!Number.isFinite(authUserId) || authUserId <= 0) {
      throw badRequest("Missing authenticated user for refund requests")
    }

    let rows = []
    try {
      rows = await prisma.$queryRaw`
        SELECT
          rr.public_id,
          rr.amount_mwk,
          rr.priority,
          rr.status,
          rr.investigation_status,
          rr.review_stage,
          rr.refund_reason_code,
          rr.user_statement,
          rr.resolution_notes,
          rr.transaction_public_id,
          rr.requested_at,
          rr.reviewed_at,
          st.public_id AS station_public_id,
          st.name AS station_name
        FROM refund_requests rr
        LEFT JOIN stations st ON st.id = rr.station_id
        WHERE rr.user_id = ${authUserId}
        ORDER BY COALESCE(rr.requested_at, rr.created_at) DESC, rr.id DESC
        LIMIT 50
      `
    } catch (error) {
      if (!isMissingTableError(error, "refund_requests")) throw error
      rows = []
    }

    return ok(res, (rows || []).map((row) => ({
      publicId: String(row.public_id || "").trim(),
      amountMwk: Number(row.amount_mwk || 0) || null,
      priority: String(row.priority || "").trim() || null,
      status: String(row.status || "").trim() || null,
      investigationStatus: String(row.investigation_status || "").trim() || null,
      reviewStage: String(row.review_stage || "").trim() || null,
      reasonCode: String(row.refund_reason_code || "").trim() || null,
      userStatement: String(row.user_statement || "").trim() || null,
      resolutionNotes: String(row.resolution_notes || "").trim() || null,
      transactionPublicId: String(row.transaction_public_id || "").trim() || null,
      stationPublicId: String(row.station_public_id || "").trim() || null,
      stationName: String(row.station_name || "").trim() || null,
      requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    })))
  })
)

router.get(
  "/support/tickets/:ticketId/messages",
  requireRole(["USER", "MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const ticketId = String(req.params.ticketId || "").trim()
    if (!ticketId) throw badRequest("ticketId is required")
    await resolveAccessibleSupportTicket({ auth: req.auth, ticketId })
    return ok(res, await listSupportTicketMessages(ticketId))
  })
)

router.post(
  "/support/tickets/:ticketId/messages",
  requireRole(["MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const ticketId = String(req.params.ticketId || "").trim()
    if (!ticketId) throw badRequest("ticketId is required")
    const body = supportTicketMessageSchema.parse(req.body || {})
    const ticket = await resolveAccessibleSupportTicket({ auth: req.auth, ticketId })
    if (!isSupportConversationOpen(ticket)) {
      throw badRequest("Only open support tickets can receive messages.")
    }

    const senderName =
      await resolveUserDisplayName(req.auth?.userPublicId)
      || (String(req.auth?.role || "").toUpperCase() === "MANAGER" ? "Station Manager" : "Station Attendant")

    try {
      await appendSupportTicketMessage({
        ticketId: ticket.id,
        stationPublicId: ticket.station_id,
        supportCasePublicId: ticket.support_case_public_id || null,
        senderScope: "STATION",
        senderUserPublicId: req.auth?.userPublicId || null,
        senderRoleCode: req.auth?.role || null,
        senderName,
        body: body.message,
        updateTicketStatus: "OPEN",
      })
    } catch (error) {
      if (isSupportTicketMessagesTableMissingError(error)) {
        throw badRequest("Support conversation storage is unavailable. Run SQL migration 042_create_support_ticket_messages.sql.")
      }
      throw error
    }

    const station = await resolveStationOrThrow(ticket.station_id)
    await writeAuditLog({
      stationId: station.id,
      actionType: "SUPPORT_TICKET_MESSAGE_CREATE",
      payload: {
        ticketId: ticket.id,
        supportCasePublicId: ticket.support_case_public_id || null,
        senderScope: "STATION",
      },
    })

    return ok(res, {
      sent: true,
      thread: await listSupportTicketMessages(ticket.id),
    })
  })
)

router.post(
  "/support/tickets",
  requireRole(["USER", "MANAGER", "ATTENDANT"]),
  asyncHandler(async (req, res) => {
    const body = createTicketSchema.parse(req.body || {})
    const userPublicId = req.auth?.userPublicId
    const roleCode = String(req.auth?.role || "").toUpperCase()
    const stationPublicId =
      roleCode === "USER"
        ? String(body?.context?.stationId || "").trim()
        : req.auth?.stationPublicId

    if (!stationPublicId) throw badRequest("Missing station scope for support ticket")
    if (!userPublicId) throw badRequest("Missing authenticated user for support ticket")

    const station = await resolveStationOrThrow(stationPublicId)
    const ticketId = createPublicId()
    const status = "OPEN"
    const shouldAssignInternalSupport = ["MANAGER", "USER"].includes(roleCode)

    await prisma.$executeRaw`
      INSERT INTO support_tickets (
        id,
        station_id,
        user_id,
        category,
        severity,
        title,
        description,
        screenshot_url,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${ticketId},
        ${stationPublicId},
        ${userPublicId},
        ${body.category},
        ${body.severity},
        ${body.title},
        ${body.description},
        ${body.screenshotUrl || null},
        ${status},
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      )
    `

    if (shouldAssignInternalSupport) {
      const supportAgentUserId = await resolveInternalSupportAgentUserId()
      const casePublicId = await createSupportCasePublicId({
        typeCode: mapTicketToSupportCaseTypeCode({ roleCode, category: body.category }),
      })

      await prisma.$executeRaw`
        INSERT INTO internal_support_cases (
          public_id,
          source_ticket_id,
          station_id,
          user_id,
          category,
          priority,
          status,
          assigned_user_id,
          subject,
          summary
        )
        VALUES (
          ${casePublicId},
          ${ticketId},
          ${station.id},
          ${req.auth.userId || null},
          ${mapTicketCategoryToInternalCategory(body.category)},
          ${mapTicketSeverityToPriority(body.severity)},
          'OPEN',
          ${supportAgentUserId},
          ${body.title},
          ${body.description}
        )
      `

      await notifySupportUser({
        userId: req.auth.userId,
        stationId: station.id,
        title: "Support request received",
        body: `${station.name} issue received. A support agent will review your request shortly.`,
        metadata: {
          supportTicketId: ticketId,
          supportCasePublicId: casePublicId,
          supportStatus: "OPEN",
          stationPublicId: station.public_id,
        },
      })
    }

    await writeAuditLog({
      stationId: station.id,
      actionType: "SUPPORT_TICKET_CREATE",
      payload: {
        id: ticketId,
        category: body.category,
        severity: body.severity,
        title: body.title,
        context: body.context || {},
      },
    })

    return ok(res, { id: ticketId, status }, 201)
  })
)

export default router
